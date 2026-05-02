import type { Repositories } from "@agent-major/db";
import type { LlmGateway, LlmResponse } from "@agent-major/llm";
import type { LlmCall } from "@agent-major/shared";

import {
  buildCasterLineBroadcastItem,
  buildRoundBroadcastItems,
  isDisplayableBroadcastItem,
  type BroadcastSourceBundle,
  type CasterLinePayload,
  type RoundBroadcastGenerator,
  type RoundBroadcastItems
} from "./broadcast.js";
import type { ArtifactStore } from "./ports.js";

export interface LlmCasterBroadcastGeneratorOptions {
  llmGateway: LlmGateway;
  driverModelId: string;
  fallbackDriverModelId?: string;
  repositories?: Pick<Repositories, "llmCalls">;
  artifactStore?: ArtifactStore;
  temperature?: number;
  maxOutputTokens?: number;
}

interface CasterLinePromptInput {
  matchId: string;
  mapGameId: string;
  roundId: string;
  mapName: string;
  roundNumber: number;
  teams: {
    teamA: { id: string; displayName: string; shortName: string };
    teamB: { id: string; displayName: string; shortName: string };
  };
  facts: {
    winnerTeamId: string;
    scoreBeforeRound: { teamA: number; teamB: number };
    scoreAfterRound: { teamA: number; teamB: number };
    teamABuyType?: string;
    teamBBuyType?: string;
    economyDelta: { teamA: number; teamB: number };
    judgeReason: string;
    summary: string;
    highlightTags: string[];
    keyEvents: Array<{
      type: string;
      zoneId: string;
      impact: string;
    }>;
  };
  outputContract: {
    language: "zh-CN";
    maxTextChars: number;
    jsonOnly: boolean;
    allowedKeys: ["text", "reason", "tags"];
  };
}

interface CasterAttemptResult {
  payload: CasterLinePayload | undefined;
  response: LlmResponse<string> | undefined;
  rawText: string | undefined;
  error: {
    name: string;
    message: string;
    errorType?: string;
    retryable?: boolean;
  } | undefined;
  latencyMs: number;
}

const forbiddenMetadataTerms = ["drivermodelid", "providerid", "modelname", "authorization", "api key", "apikey"];

export function createLlmCasterBroadcastGenerator(options: LlmCasterBroadcastGeneratorOptions): RoundBroadcastGenerator {
  return new LlmCasterBroadcastGenerator(options);
}

class LlmCasterBroadcastGenerator implements RoundBroadcastGenerator {
  constructor(private readonly options: LlmCasterBroadcastGeneratorOptions) {}

  async build(input: { bundle: BroadcastSourceBundle; createdAt: string }): Promise<RoundBroadcastItems> {
    const fallbackItems = buildRoundBroadcastItems(input);
    const driverModelIds = uniqueDriverModelIds([this.options.driverModelId, this.options.fallbackDriverModelId]);
    const promptInput = buildCasterPromptInput(input.bundle);
    const messages = buildCasterMessages(promptInput);
    const promptHash = hashJson({ messages, input: promptInput });

    for (const [index, driverModelId] of driverModelIds.entries()) {
      const callId = `llm_${safeId(input.bundle.round.id)}_caster_${index + 1}_${safeId(driverModelId)}`;
      const requestArtifactId = await this.writeArtifact({
        callId,
        artifactType: "llm_request",
        suffix: "request",
        bundle: input.bundle,
        createdAt: input.createdAt,
        content: {
          schemaVersion: 1,
          taskType: "broadcast",
          broadcastTask: "caster_line",
          driverModelId,
          schemaName: "CasterLinePayload",
          promptHash,
          messages,
          input: promptInput
        }
      });
      const attempt = await this.tryGenerateCasterLine({
        driverModelId,
        promptInput,
        messages
      });
      const responseArtifactId = await this.writeArtifact({
        callId,
        artifactType: "llm_response",
        suffix: "response",
        bundle: input.bundle,
        createdAt: input.createdAt,
        content: {
          schemaVersion: 1,
          taskType: "broadcast",
          broadcastTask: "caster_line",
          driverModelId,
          ok: Boolean(attempt.payload),
          error: attempt.error,
          latencyMs: attempt.latencyMs,
          rawText: attempt.rawText,
          usage: attempt.response?.usage
        }
      });
      await this.saveLlmCall({
        callId,
        driverModelId,
        promptHash,
        requestArtifactId,
        responseArtifactId,
        bundle: input.bundle,
        createdAt: input.createdAt,
        response: attempt.response
      });

      if (!attempt.payload) {
        continue;
      }

      const casterLine = buildCasterLineBroadcastItem({
        bundle: input.bundle,
        generationMode: "llm",
        fallbackStatus: "ready",
        payload: attempt.payload,
        createdAt: input.createdAt
      });
      if (isDisplayableBroadcastItem(casterLine)) {
        return {
          ...fallbackItems,
          casterLine
        };
      }

      return fallbackItems;
    }

    return fallbackItems;
  }

  private async tryGenerateCasterLine(input: {
    driverModelId: string;
    promptInput: CasterLinePromptInput;
    messages: Array<{ role: "system" | "user"; content: string }>;
  }): Promise<CasterAttemptResult> {
    const startedAt = Date.now();
    try {
      const response = await this.options.llmGateway.generateStructured<string, CasterLinePromptInput>({
        task: "broadcast",
        driverModelId: input.driverModelId,
        input: input.promptInput,
        schemaName: "CasterLinePayload",
        messages: input.messages,
        responseFormat: "text",
        temperature: this.options.temperature ?? 0.6,
        maxOutputTokens: this.options.maxOutputTokens ?? 260
      });
      const rawText = response.rawText ?? String(response.data);
      return {
        payload: parseCasterLinePayload(rawText, input.promptInput),
        response,
        rawText,
        error: undefined,
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      return {
        payload: undefined,
        response: undefined,
        rawText: undefined,
        error: sanitizeError(error),
        latencyMs: Date.now() - startedAt
      };
    }
  }

  private async writeArtifact(input: {
    callId: string;
    artifactType: string;
    suffix: "request" | "response";
    bundle: BroadcastSourceBundle;
    createdAt: string;
    content: unknown;
  }): Promise<string | undefined> {
    if (!this.options.artifactStore) {
      return undefined;
    }

    try {
      const artifact = await this.options.artifactStore.write({
        ownerType: "llm_call",
        ownerId: input.callId,
        artifactType: input.artifactType,
        relativePath: `llm/${input.callId}-${input.suffix}.json`,
        content: `${JSON.stringify(input.content, null, 2)}\n`,
        tournamentId: input.bundle.match.tournamentId,
        matchId: input.bundle.match.id,
        mapGameId: input.bundle.mapGame.id,
        roundId: input.bundle.round.id,
        sourceEventIds: [input.bundle.sourceEventIds.roundReportEventId]
      });
      return artifact.id;
    } catch {
      return undefined;
    }
  }

  private async saveLlmCall(input: {
    callId: string;
    driverModelId: string;
    promptHash: string;
    requestArtifactId: string | undefined;
    responseArtifactId: string | undefined;
    bundle: BroadcastSourceBundle;
    createdAt: string;
    response: LlmResponse<string> | undefined;
  }): Promise<void> {
    if (!this.options.repositories) {
      return;
    }

    const llmCall: LlmCall = removeUndefined({
      id: input.callId,
      tournamentId: input.bundle.match.tournamentId,
      matchId: input.bundle.match.id,
      roundId: input.bundle.round.id,
      driverModelId: input.driverModelId,
      taskType: "broadcast",
      promptHash: input.promptHash,
      requestArtifactId: input.requestArtifactId,
      responseArtifactId: input.responseArtifactId,
      inputTokens: input.response?.usage.promptTokens,
      outputTokens: input.response?.usage.completionTokens,
      createdAt: input.createdAt
    });

    try {
      await this.options.repositories.llmCalls.save(llmCall);
    } catch {
      // Broadcast generation must not fail the round because observability storage failed.
    }
  }
}

function buildCasterPromptInput(bundle: BroadcastSourceBundle): CasterLinePromptInput {
  return {
    matchId: bundle.match.id,
    mapGameId: bundle.mapGame.id,
    roundId: bundle.round.id,
    mapName: bundle.mapGame.mapName,
    roundNumber: bundle.round.roundNumber,
    teams: bundle.teams,
    facts: {
      winnerTeamId: bundle.roundReport.winnerTeamId,
      scoreBeforeRound: bundle.roundReport.scoreBeforeRound,
      scoreAfterRound: bundle.roundReport.scoreAfterRound,
      ...(bundle.round.teamABuyType ? { teamABuyType: bundle.round.teamABuyType } : {}),
      ...(bundle.round.teamBBuyType ? { teamBBuyType: bundle.round.teamBBuyType } : {}),
      economyDelta: bundle.roundReport.economyDelta.teamTotals,
      judgeReason: bundle.roundReport.judgeResult.reason,
      summary: bundle.roundReport.summary,
      highlightTags: bundle.roundReport.highlightTags ?? [],
      keyEvents: (bundle.roundReport.keyEvents as CasterLinePromptInput["facts"]["keyEvents"]).map((event) => ({
        type: event.type,
        zoneId: event.zoneId,
        impact: event.impact
      }))
    },
    outputContract: {
      language: "zh-CN",
      maxTextChars: 180,
      jsonOnly: true,
      allowedKeys: ["text", "reason", "tags"]
    }
  };
}

function buildCasterMessages(input: CasterLinePromptInput): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content:
        "你是 Agent Major 伪直播的官方解说。只能基于给定事实写一条短解说，不得改写比分、胜者、经济或回合事实。只输出 JSON，不要输出模型、供应商、token、cost 或调试信息。"
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "生成一条中文官方解说台词，语气像电竞直播，但必须克制、短、可播。",
        input,
        output: {
          text: "不超过 180 字的中文解说",
          reason: "一句话说明解说依据",
          tags: ["最多 6 个短标签"]
        }
      })
    }
  ];
}

function parseCasterLinePayload(rawText: string, promptInput: CasterLinePromptInput): CasterLinePayload | undefined {
  if (containsForbiddenMetadata(rawText)) {
    return undefined;
  }

  const parsed = parseMaybeJson(rawText);
  const text = typeof parsed === "string" ? parsed : stringField(parsed, "text");
  if (!text || text.trim().length === 0) {
    return undefined;
  }

  const reason = typeof parsed === "object" && parsed !== null ? stringField(parsed, "reason") : undefined;
  const tags = typeof parsed === "object" && parsed !== null ? stringArrayField(parsed, "tags") : [];
  return {
    speakerRole: "main_caster",
    text: clampText(text, promptInput.outputContract.maxTextChars),
    reason: clampText(reason || promptInput.facts.judgeReason, 140),
    tags: sanitizeTags(tags.length > 0 ? tags : promptInput.facts.highlightTags)
  };
}

function parseMaybeJson(rawText: string): unknown {
  const candidate = stripFence(rawText);
  try {
    return JSON.parse(candidate);
  } catch {
    return rawText.trim();
  }
}

function sanitizeError(error: unknown): CasterAttemptResult["error"] {
  if (error instanceof Error) {
    const record = error as Error & { errorType?: string; retryable?: boolean };
    return {
      name: error.name,
      message: sanitizeSensitiveText(error.message),
      ...(record.errorType ? { errorType: record.errorType } : {}),
      ...(typeof record.retryable === "boolean" ? { retryable: record.retryable } : {})
    };
  }

  return {
    name: "UnknownError",
    message: "Unknown LLM generation failure."
  };
}

function sanitizeSensitiveText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/gi, "sk-[redacted]")
    .replace(/(api[_ -]?key["'\s:=]+)([^"',}\s]+)/gi, "$1[redacted]")
    .replace(/(authorization["'\s:=]+)(Bearer\s+)?([^"',}\s]+)/gi, "$1[redacted]");
}

function uniqueDriverModelIds(ids: Array<string | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0))];
}

function stripFence(value: string): string {
  const trimmed = value.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}

function stringField(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : undefined;
}

function stringArrayField(value: unknown, key: string): string[] {
  if (!isRecord(value) || !Array.isArray(value[key])) {
    return [];
  }

  return value[key].filter((item): item is string => typeof item === "string");
}

function sanitizeTags(tags: string[]): string[] {
  return tags
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0 && !containsForbiddenMetadata(tag))
    .slice(0, 6);
}

function containsForbiddenMetadata(value: string): boolean {
  const normalized = value.toLowerCase();
  return forbiddenMetadataTerms.some((term) => normalized.includes(term));
}

function clampText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}…`;
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
}

function hashJson(value: unknown): string {
  const input = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => typeof entry !== "undefined")) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
