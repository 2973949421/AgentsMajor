import {
  DashScopeOpenAiProvider,
  loadAgentMajorLlmConfig,
  type LlmProviderDiagnostics,
  type LlmUsage
} from "@agent-major/llm";
import type { HexMapAsset } from "@agent-major/shared";
import type { ArtifactStore } from "../../ports.js";
import type { HexRoundEconomyContext } from "../economy/index.js";
import type { HexRoundMemory } from "../state/index.js";
import {
  buildHexAgentCommandRequest,
  normalizeHexAgentActionDraft,
  type HexAgentActionDraft,
  type HexAgentCommandRequest
} from "./hex-agent-command-boundary.js";
import {
  buildHexAgentFallbackAction,
  validateHexAgentActionDraft,
  type HexValidatedAgentAction
} from "./hex-agent-action-validator.js";

export type HexAgentCommandProviderMode = "fixture" | "real";

export interface HexAgentCommandProviderResult {
  rawDraft: unknown;
  providerMode?: HexAgentCommandProviderMode;
  modelId?: string;
  rawText?: string;
  usage?: LlmUsage;
  providerDiagnostics?: LlmProviderDiagnostics;
}

export type HexAgentCommandProvider =
  (request: HexAgentCommandRequest) => Promise<unknown | HexAgentCommandProviderResult> | unknown | HexAgentCommandProviderResult;

export interface HexAgentCommandArtifactOwner {
  ownerType: string;
  ownerId: string;
  tournamentId?: string;
  matchId?: string;
  mapGameId?: string;
  roundId?: string;
}

export interface RunHexAgentPhaseCommandHarnessInput {
  asset: HexMapAsset;
  memory: HexRoundMemory;
  provider: HexAgentCommandProvider;
  providerMode?: HexAgentCommandProviderMode;
  modelId?: string;
  maxLlmCalls?: number;
  economyContext?: HexRoundEconomyContext;
  artifactStore?: ArtifactStore;
  artifactOwner?: HexAgentCommandArtifactOwner;
  callIdPrefix?: string;
}

export interface HexAgentCommandAudit {
  agentId: string;
  callId: string;
  called: boolean;
  accepted: boolean;
  fallback: boolean;
  fallbackReason?: string;
  ignoredFields: string[];
  repairedFields: string[];
  errors: string[];
  requestArtifactId?: string;
  responseArtifactId?: string;
  providerMode?: HexAgentCommandProviderMode;
  modelId?: string;
  contentLength?: number;
  reasoningContentLength?: number;
}

export interface HexAgentPhaseCommandHarnessResult {
  actions: HexValidatedAgentAction[];
  acceptedActions: HexValidatedAgentAction[];
  fallbackActions: HexValidatedAgentAction[];
  rejectedDrafts: Array<{
    agentId: string;
    errors: string[];
    ignoredFields: string[];
  }>;
  audits: HexAgentCommandAudit[];
  totalCallsAttempted: number;
  fallbackCount: number;
}

export async function runHexAgentPhaseCommandHarness(input: RunHexAgentPhaseCommandHarnessInput): Promise<HexAgentPhaseCommandHarnessResult> {
  const actions: HexValidatedAgentAction[] = [];
  const audits: HexAgentCommandAudit[] = [];
  const rejectedDrafts: HexAgentPhaseCommandHarnessResult["rejectedDrafts"] = [];
  const maxLlmCalls = input.maxLlmCalls ?? Number.POSITIVE_INFINITY;
  let callsAttempted = 0;

  for (const agent of input.memory.agents) {
    const callId = buildCallId(input, agent.agentId);
    if (agent.lifeStatus === "dead" || agent.apRemaining <= 0) {
      const fallback = buildHexAgentFallbackAction({
        memory: input.memory,
        agent,
        reason: agent.lifeStatus === "dead" ? "dead_agent_skipped" : "ap_empty_agent_skipped"
      });
      actions.push(fallback);
      audits.push({
        agentId: agent.agentId,
        callId,
        called: false,
        accepted: false,
        fallback: true,
        fallbackReason: fallback.fallbackReason ?? "agent_skipped",
        ignoredFields: [],
        repairedFields: [],
        errors: [fallback.fallbackReason ?? "agent_skipped"]
      });
      continue;
    }

    if (callsAttempted >= maxLlmCalls) {
      const fallback = buildHexAgentFallbackAction({
        memory: input.memory,
        agent,
        reason: "max_llm_calls_reached"
      });
      actions.push(fallback);
      audits.push({
        agentId: agent.agentId,
        callId,
        called: false,
        accepted: false,
        fallback: true,
        fallbackReason: "max_llm_calls_reached",
        ignoredFields: [],
        repairedFields: [],
        errors: ["max_llm_calls_reached"]
      });
      continue;
    }

    const request = buildHexAgentCommandRequest({
      asset: input.asset,
      memory: input.memory,
      agentId: agent.agentId,
      ...(input.economyContext ? { economyContext: input.economyContext } : {})
    });
    const requestArtifactId = await writeHarnessArtifact(input, {
      callId,
      agentId: agent.agentId,
      suffix: "request",
      artifactType: "hex_llm_request",
      content: {
        schemaVersion: 1,
        callId,
        request
      }
    });

    callsAttempted += 1;
    try {
      const providerResult = normalizeProviderResult(await input.provider(request));
      const normalized = normalizeHexAgentActionDraft({
        rawDraft: providerResult.rawDraft,
        request
      });
      const responseArtifactId = await writeHarnessArtifact(input, {
        callId,
        agentId: agent.agentId,
        suffix: "response",
        artifactType: "hex_llm_response",
        content: {
          schemaVersion: 1,
          callId,
          rawText: providerResult.rawText,
          usage: providerResult.usage,
          providerDiagnostics: providerResult.providerDiagnostics,
          rawDraft: providerResult.rawDraft,
          normalized
        }
      });

      if (!normalized.draft) {
        const fallback = buildHexAgentFallbackAction({
          memory: input.memory,
          agent,
          reason: normalized.errors.join(";") || "invalid_draft"
        });
        actions.push(fallback);
        rejectedDrafts.push({
          agentId: agent.agentId,
          errors: normalized.errors,
          ignoredFields: normalized.ignoredFields
        });
        audits.push(buildAudit({
          agentId: agent.agentId,
          callId,
          called: true,
          action: fallback,
          errors: normalized.errors,
          ignoredFields: normalized.ignoredFields,
          repairedFields: normalized.repairedFields,
          requestArtifactId,
          responseArtifactId,
          providerResult,
          input
        }));
        continue;
      }

      const validated = validateHexAgentActionDraft({
        asset: input.asset,
        memory: input.memory,
        draft: normalized.draft,
        ...(input.economyContext ? { economyContext: input.economyContext } : {})
      });
      actions.push(validated);
      if (!validated.valid) {
        rejectedDrafts.push({
          agentId: agent.agentId,
          errors: validated.validationErrors,
          ignoredFields: normalized.ignoredFields
        });
      }
      audits.push(buildAudit({
        agentId: agent.agentId,
        callId,
        called: true,
        action: validated,
          errors: validated.validationErrors,
          ignoredFields: normalized.ignoredFields,
          repairedFields: normalized.repairedFields,
          requestArtifactId,
          responseArtifactId,
          providerResult,
        input
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const fallback = buildHexAgentFallbackAction({
        memory: input.memory,
        agent,
        reason: `provider_error:${message}`
      });
      actions.push(fallback);
      rejectedDrafts.push({
        agentId: agent.agentId,
        errors: [`provider_error:${message}`],
        ignoredFields: []
      });
      const audit: HexAgentCommandAudit = {
        agentId: agent.agentId,
        callId,
        called: true,
        accepted: false,
        fallback: true,
        ignoredFields: [],
        repairedFields: [],
        errors: [`provider_error:${message}`],
        ...(requestArtifactId ? { requestArtifactId } : {}),
        providerMode: input.providerMode ?? "fixture",
        ...(input.modelId ? { modelId: input.modelId } : {})
      };
      if (fallback.fallbackReason) {
        audit.fallbackReason = fallback.fallbackReason;
      }
      audits.push(audit);
    }
  }

  const acceptedActions = actions.filter((action) => action.valid);
  const fallbackActions = actions.filter((action) => !action.valid);
  return {
    actions,
    acceptedActions,
    fallbackActions,
    rejectedDrafts,
    audits,
    totalCallsAttempted: callsAttempted,
    fallbackCount: fallbackActions.length
  };
}

export function createFixtureHexAgentCommandProvider(): HexAgentCommandProvider {
  return (request) => ({
    providerMode: "fixture",
    modelId: "fixture_hex_agent_command",
    rawDraft: {
      agentId: request.agent.agentId,
      phaseId: request.phaseId,
      currentCellId: request.agent.currentCellId,
      targetCellId: request.reachableCells[0]?.cellId ?? request.agent.currentCellId,
      actionType: "hold_position",
      businessIntent: `${request.agent.teamId}/${request.agent.agentId} uses fixture Hex command to preserve a legal business-plan action.`,
      tacticalIntent: "fixture keeps the agent inside validated Hex state",
      riskNotes: ["fixture"],
      confidence: 0.7
    }
  });
}

export interface EnvHexAgentCommandProviderFactoryResult {
  provider: HexAgentCommandProvider;
  providerMode: "real";
  modelId: string;
}

export function createEnvHexAgentCommandProvider(
  env: Record<string, string | undefined> = process.env
): EnvHexAgentCommandProviderFactoryResult {
  const config = loadAgentMajorLlmConfig(env);
  const modelId = config.phase18DriverModelId;
  if (!config.enabled || !config.baseUrl || !config.apiKey) {
    return {
      providerMode: "real",
      modelId,
      provider: () => {
        throw new Error(`real_llm_disabled:${config.disabledReason ?? "missing_configuration"}`);
      }
    };
  }

  const gateway = new DashScopeOpenAiProvider({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    providerId: config.providerId,
    ...(config.modelName ? { modelName: config.modelName } : {}),
    reasoningMode: config.reasoningMode,
    reasoningEffort: config.reasoningEffort,
    timeoutMs: config.timeoutMs,
    maxRetries: Math.min(config.maxRetries, 1)
  });

  return {
    providerMode: "real",
    modelId: config.modelName ?? modelId,
    provider: async (request) => {
      const response = await gateway.generateStructured<Record<string, unknown>, HexAgentCommandRequest>({
        task: "agent_action",
        driverModelId: modelId,
        input: request,
        schemaName: "HexAgentActionDraft",
        responseFormat: "json_object",
        modelTier: "standard",
        temperature: 0.35,
        maxOutputTokens: 900,
        extraParams: { thinking: { type: "disabled" } },
        messages: buildRealHexAgentCommandMessages(request)
      });
      return {
        providerMode: "real",
        modelId: config.modelName ?? modelId,
        rawDraft: response.data.draft ?? response.data,
        ...(response.rawText !== undefined ? { rawText: response.rawText } : {}),
        usage: response.usage,
        ...(response.providerDiagnostics ? { providerDiagnostics: response.providerDiagnostics } : {})
      };
    }
  };
}

function buildRealHexAgentCommandMessages(request: HexAgentCommandRequest) {
  return [
    {
      role: "system" as const,
      content: [
        "You are a HexGrid CS-business match agent command drafter.",
        "Output one JSON object only.",
        "Do not output winner, kills, damage, bomb result, economy delta, hidden enemy truth, database facts, or round report fields.",
        "Choose only from reachableCells and allowedActionTypes.",
        "lastSeenEnemies are historical hints, not current truth."
      ].join("\n")
    },
    {
      role: "user" as const,
      content: JSON.stringify(request)
    }
  ];
}

function normalizeProviderResult(value: unknown | HexAgentCommandProviderResult): HexAgentCommandProviderResult {
  if (isProviderResult(value)) {
    return value;
  }
  return {
    rawDraft: value
  };
}

function isProviderResult(value: unknown): value is HexAgentCommandProviderResult {
  return typeof value === "object" && value !== null && "rawDraft" in value;
}

async function writeHarnessArtifact(
  input: RunHexAgentPhaseCommandHarnessInput,
  artifact: {
    callId: string;
    agentId: string;
    suffix: "request" | "response";
    artifactType: string;
    content: unknown;
  }
): Promise<string | undefined> {
  if (!input.artifactStore || !input.artifactOwner) {
    return undefined;
  }
  const written = await input.artifactStore.write({
    ownerType: input.artifactOwner.ownerType,
    ownerId: input.artifactOwner.ownerId,
    artifactType: artifact.artifactType,
    relativePath: `hex-agent-command/${artifact.callId}-${artifact.suffix}.json`,
    content: JSON.stringify(artifact.content, null, 2),
    agentId: artifact.agentId,
    ...(input.artifactOwner.tournamentId ? { tournamentId: input.artifactOwner.tournamentId } : {}),
    ...(input.artifactOwner.matchId ? { matchId: input.artifactOwner.matchId } : {}),
    ...(input.artifactOwner.mapGameId ? { mapGameId: input.artifactOwner.mapGameId } : {}),
    ...(input.artifactOwner.roundId ? { roundId: input.artifactOwner.roundId } : {})
  });
  return written.id;
}

function buildAudit(input: {
  agentId: string;
  callId: string;
  called: boolean;
  action: HexValidatedAgentAction;
  errors: readonly string[];
  ignoredFields: readonly string[];
  repairedFields: readonly string[];
  requestArtifactId: string | undefined;
  responseArtifactId: string | undefined;
  providerResult: HexAgentCommandProviderResult;
  input: RunHexAgentPhaseCommandHarnessInput;
}): HexAgentCommandAudit {
  const audit: HexAgentCommandAudit = {
    agentId: input.agentId,
    callId: input.callId,
    called: input.called,
    accepted: input.action.valid,
    fallback: !input.action.valid,
    ignoredFields: [...input.ignoredFields],
    repairedFields: [...input.repairedFields],
    errors: input.errors.map(String),
    providerMode: input.providerResult.providerMode ?? input.input.providerMode ?? "fixture"
  };
  if (input.action.fallbackReason) {
    audit.fallbackReason = input.action.fallbackReason;
  }
  if (input.requestArtifactId) {
    audit.requestArtifactId = input.requestArtifactId;
  }
  if (input.responseArtifactId) {
    audit.responseArtifactId = input.responseArtifactId;
  }
  const modelId = input.providerResult.modelId ?? input.input.modelId;
  if (modelId) {
    audit.modelId = modelId;
  }
  if (input.providerResult.providerDiagnostics?.contentLength !== undefined) {
    audit.contentLength = input.providerResult.providerDiagnostics.contentLength;
  } else if (input.providerResult.rawText !== undefined) {
    audit.contentLength = input.providerResult.rawText.length;
  }
  if (input.providerResult.providerDiagnostics?.reasoningContentLength !== undefined) {
    audit.reasoningContentLength = input.providerResult.providerDiagnostics.reasoningContentLength;
  }
  return audit;
}

function buildCallId(input: RunHexAgentPhaseCommandHarnessInput, agentId: string): string {
  const prefix = input.callIdPrefix ?? "hex_agent_cmd";
  return `${prefix}_${input.memory.phaseIndex}_${agentId}`;
}
