import type { LlmGateway, LlmMessage, LlmRequest, LlmResponse, LlmUsage } from "./gateway.js";
import { dashscopeOpenAiProviderId, resolveDriverModelConfig } from "./model-registry.js";

export type LlmProviderErrorType = "timeout" | "rate_limited" | "provider_error" | "invalid_response" | "unknown";

export interface DashScopeOpenAiProviderOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBackoffMs?: number[];
  fetchFn?: typeof fetch;
}

export class LlmProviderError extends Error {
  readonly errorType: LlmProviderErrorType;
  readonly retryable: boolean;
  readonly providerId: string;
  readonly driverModelId: string;
  readonly modelName: string | undefined;
  readonly statusCode: number | undefined;
  readonly rawText: string | undefined;
  readonly usage: LlmUsage | undefined;
  readonly parseCandidate: string | undefined;

  constructor(input: {
    message: string;
    errorType: LlmProviderErrorType;
    retryable: boolean;
    driverModelId: string;
    modelName?: string;
    statusCode?: number;
    rawText?: string;
    usage?: LlmUsage;
    parseCandidate?: string;
  }) {
    super(input.message);
    this.name = "LlmProviderError";
    this.errorType = input.errorType;
    this.retryable = input.retryable;
    this.providerId = dashscopeOpenAiProviderId;
    this.driverModelId = input.driverModelId;
    this.modelName = input.modelName;
    this.statusCode = input.statusCode;
    this.rawText = input.rawText;
    this.usage = input.usage;
    this.parseCandidate = input.parseCandidate;
  }
}

export class DashScopeOpenAiProvider implements LlmGateway {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: number[];
  private readonly fetchFn: typeof fetch;

  constructor(options: DashScopeOpenAiProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 300_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryBackoffMs = options.retryBackoffMs ?? [1_000, 3_000];
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    const modelConfig = resolveDriverModelConfig(request.driverModelId);
    const messages = request.messages ?? buildDefaultMessages(request);
    const url = `${this.baseUrl}/chat/completions`;
    const body = compactObject({
      ...(request.extraParams ?? {}),
      model: modelConfig.modelName,
      messages,
      stream: false,
      temperature: request.temperature ?? modelConfig.defaultTemperature,
      max_tokens: request.maxOutputTokens ?? modelConfig.defaultMaxOutputTokens,
      response_format: request.responseFormat === "json_object" ? { type: "json_object" } : undefined
    });

    let latestError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.sendRequest<TData>({
          url,
          body,
          request,
          modelName: modelConfig.modelName
        });
      } catch (error) {
        latestError = error;
        if (!isRetryableProviderError(error) || attempt >= this.maxRetries) {
          throw error;
        }
        await delay(this.retryBackoffMs[Math.min(attempt, this.retryBackoffMs.length - 1)] ?? 0);
      }
    }

    throw latestError instanceof Error
      ? latestError
      : new LlmProviderError({
          message: "LLM provider failed with an unknown error.",
          errorType: "unknown",
          retryable: false,
          driverModelId: request.driverModelId,
          modelName: modelConfig.modelName
        });
  }

  private async sendRequest<TData>(input: {
    url: string;
    body: Record<string, unknown>;
    request: LlmRequest;
    modelName: string;
  }): Promise<LlmResponse<TData>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(input.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(input.body),
        signal: controller.signal
      });

      if (!response.ok) {
        throw await this.providerHttpError(response, input.request, input.modelName);
      }

      const json = await safeReadJson(response, input.request, input.modelName);
      const rawText = extractMessageContent(json, input.request, input.modelName);
      const usage = extractUsage(json);
      if (input.request.responseFormat !== "json_object") {
        return {
          data: rawText as TData,
          usage,
          rawText
        };
      }

      try {
        return {
          data: parseJsonContent(rawText, input.request, input.modelName) as TData,
          usage,
          rawText
        };
      } catch (error) {
        if (!(error instanceof LlmProviderError)) {
          throw error;
        }

        const repaired = await this.repairJsonContent<TData>({
          url: input.url,
          request: input.request,
          modelName: input.modelName,
          originalRawText: rawText,
          originalUsage: usage,
          parseError: error.message
        });
        return repaired;
      }
    } catch (error) {
      if (isAbortError(error)) {
        throw new LlmProviderError({
          message: "LLM provider request timed out.",
          errorType: "timeout",
          retryable: true,
          driverModelId: input.request.driverModelId,
          modelName: input.modelName
        });
      }

      if (error instanceof LlmProviderError) {
        throw error;
      }

      throw new LlmProviderError({
        message: "LLM provider request failed.",
        errorType: "provider_error",
        retryable: true,
        driverModelId: input.request.driverModelId,
        modelName: input.modelName
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async repairJsonContent<TData>(input: {
    url: string;
    request: LlmRequest;
    modelName: string;
    originalRawText: string;
    originalUsage: LlmUsage;
    parseError: string;
  }): Promise<LlmResponse<TData>> {
    const outputContract = outputContractForSchema(input.request.schemaName);
    const body = compactObject({
      model: input.modelName,
      messages: [
        {
          role: "system",
          content:
            "You repair structured outputs. Return only one valid json object. Do not include markdown, code fences, prose, comments, or copied input."
        },
        {
          role: "user",
          content: [
            `Repair this response into valid JSON for schema ${input.request.schemaName}.`,
            outputContract,
            "Original non-JSON response:",
            input.originalRawText
          ].join("\n")
        }
      ],
      stream: false,
      temperature: 0,
      max_tokens: input.request.maxOutputTokens ?? resolveDriverModelConfig(input.request.driverModelId).defaultMaxOutputTokens,
      response_format: { type: "json_object" }
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const response = await this.fetchFn(input.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      throw await this.providerHttpError(response, input.request, input.modelName);
    }

    const json = await safeReadJson(response, input.request, input.modelName);
    const repairRawText = extractMessageContent(json, input.request, input.modelName);
    const repairUsage = extractUsage(json);
    try {
      return {
        data: parseJsonContent(repairRawText, input.request, input.modelName) as TData,
        usage: combineUsage(input.originalUsage, repairUsage),
        rawText: repairRawText,
        structuredRepair: {
          originalRawText: input.originalRawText,
          repairRawText,
          repairUsage,
          parseError: input.parseError
        }
      };
    } catch (error) {
      if (error instanceof LlmProviderError) {
        throw new LlmProviderError({
          message: error.message,
          errorType: error.errorType,
          retryable: false,
          driverModelId: input.request.driverModelId,
          modelName: input.modelName,
          rawText: input.originalRawText,
          usage: input.originalUsage,
          ...(error.parseCandidate ? { parseCandidate: error.parseCandidate } : {})
        });
      }
      throw error;
    }
  }

  private async providerHttpError(response: Response, request: LlmRequest, modelName: string): Promise<LlmProviderError> {
    const body = sanitizeProviderText(await response.text().catch(() => ""));
    const errorType: LlmProviderErrorType =
      response.status === 429 ? "rate_limited" : response.status >= 500 ? "provider_error" : "invalid_response";
    return new LlmProviderError({
      message: `LLM provider returned HTTP ${response.status}${body ? `: ${body.slice(0, 240)}` : ""}`,
      errorType,
      retryable: response.status === 429 || response.status >= 500,
      driverModelId: request.driverModelId,
      modelName,
      statusCode: response.status
    });
  }
}

function sanitizeProviderText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/gi, "sk-[redacted]")
    .replace(/(api[_ -]?key["'\s:=]+)([^"',}\s]+)/gi, "$1[redacted]")
    .replace(/(authorization["'\s:=]+)(Bearer\s+)?([^"',}\s]+)/gi, "$1[redacted]");
}

function buildDefaultMessages(request: LlmRequest): LlmMessage[] {
  if (request.responseFormat === "json_object") {
    const outputContract = outputContractForSchema(request.schemaName);
    return [
      {
        role: "system",
        content:
          "You are a structured generation engine. Return only valid json that matches the requested schema. Do not include markdown, code fences, or extra commentary. Do not copy the input object unless the output contract asks for the same field."
      },
      {
        role: "user",
        content: [
          `Respond with a json object for schema ${request.schemaName}.`,
          outputContract,
          JSON.stringify({
            task: request.task,
            schemaName: request.schemaName,
            input: request.input
          })
        ].join("\n")
      }
    ];
  }

  return [
      {
        role: "system",
        content: "You are a structured text generation engine. Follow the user task exactly."
      },
    {
      role: "user",
      content: JSON.stringify({
        task: request.task,
        schemaName: request.schemaName,
        input: request.input
      })
    }
  ];
}

function outputContractForSchema(schemaName: string): string {
  if (schemaName === "AgentActionDecision") {
    return [
      "Output contract:",
      "Return exactly one top-level JSON object with these fields:",
      '{"action":"<one concise tactical action string>","confidence":0.0,"fingerprint":"<optional short stable string>"}',
      "Required fields: action, confidence.",
      "Optional field: fingerprint.",
      "Do not return actionDecision. Do not include roundId, agentId, mapName, role, buyType, sideContext, or other copied input fields.",
      "confidence must be a number between 0 and 1."
    ].join("\n");
  }

  if (schemaName === "TeamRoundPlanDecision") {
    return [
      "Output contract:",
      "Return exactly one top-level JSON object with these fields:",
      '{"teamId":"<input teamId>","side":"attack|defense","primaryIntent":"<team tactical intent>","primaryZoneId":"<main zone id>","secondaryZoneId":"<optional zone id>","coordinationSummary":"<how the five players coordinate>","playerDirectives":[{"agentId":"<active player id>","directive":"<individual directive aligned to the team plan>"}],"winCondition":"<how this team wins the round>","risk":"<main tactical risk>","confidence":0.0,"fingerprint":"<optional short stable string>"}',
      "Required fields: teamId, side, primaryIntent, primaryZoneId, coordinationSummary, playerDirectives, winCondition, risk, confidence.",
      "playerDirectives must include exactly one directive for every active player in the input activeAgents list.",
      "side must match the input side. confidence must be a number between 0 and 1.",
      "Do not copy the input object. Do not include opponent restricted plans."
    ].join("\n");
  }

  if (schemaName === "JudgeResult") {
    return [
      "Output contract:",
      "Return exactly one top-level JSON object with these fields:",
      '{"winnerTeamId":"<teamAId or teamBId>","loserTeamId":"<the other team id>","margin":"narrow|standard|decisive","reason":"<brief reason>","mvpAgentId":"<agent id from the winning active roster>","confidence":0.0}',
      "Required fields: winnerTeamId, loserTeamId, margin, reason, mvpAgentId, confidence.",
      "margin must be exactly one of: narrow, standard, decisive. Do not use clear, close, solid, dominant, or other synonyms.",
      "reason must explicitly name both teams and explain the winner success path plus the loser failure path.",
      "For stable validation, include succeeded and failed, or Chinese equivalents 成功 and 失败/未能, in reason.",
      "winnerTeamId must be one of the input team ids. loserTeamId must be the other team id.",
      "mvpAgentId must come from the winning team's active agent id list.",
      "reason must discuss both teams' winCondition and explain why one succeeded while the other failed.",
      "Do not decide from team order, team name fame, current score lead, or first-listed team bias.",
      "confidence must be a number between 0 and 1."
    ].join("\n");
  }

  return "Output contract: return a JSON object only, using the exact top-level fields required by the named schema.";
}

async function safeReadJson(response: Response, request: LlmRequest, modelName: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new LlmProviderError({
      message: "LLM provider returned non-JSON HTTP response.",
      errorType: "invalid_response",
      retryable: false,
      driverModelId: request.driverModelId,
      modelName
    });
  }
}

function extractMessageContent(value: unknown, request: LlmRequest, modelName: string): string {
  if (!isRecord(value)) {
    throw invalidShapeError(request, modelName);
  }

  const choices = value.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw invalidShapeError(request, modelName);
  }

  const firstChoice = choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message) || typeof firstChoice.message.content !== "string") {
    throw invalidShapeError(request, modelName);
  }

  return firstChoice.message.content.trim();
}

function parseJsonContent(rawText: string, request: LlmRequest, modelName: string): unknown {
  const candidate = extractJsonObjectCandidate(rawText);
  try {
    return JSON.parse(candidate);
  } catch {
    throw new LlmProviderError({
      message: "LLM provider returned text that does not parse as JSON.",
      errorType: "invalid_response",
      retryable: false,
      driverModelId: request.driverModelId,
      modelName,
      rawText,
      parseCandidate: candidate
    });
  }
}

function extractUsage(value: unknown): LlmUsage {
  if (!isRecord(value) || !isRecord(value.usage)) {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }

  const promptTokens = numberField(value.usage, "prompt_tokens");
  const completionTokens = numberField(value.usage, "completion_tokens");
  const totalTokens = numberField(value.usage, "total_tokens") || promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

function invalidShapeError(request: LlmRequest, modelName: string): LlmProviderError {
  return new LlmProviderError({
    message: "LLM provider returned an unsupported response shape.",
    errorType: "invalid_response",
    retryable: false,
    driverModelId: request.driverModelId,
    modelName
  });
}

function isRetryableProviderError(error: unknown): error is LlmProviderError {
  return error instanceof LlmProviderError && error.retryable;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException ? error.name === "AbortError" : isRecord(error) && error.name === "AbortError";
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenceMatch?.[1]?.trim() ?? trimmed;
}

function extractJsonObjectCandidate(value: string): string {
  const trimmed = stripJsonFence(value);
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const extracted = extractFirstBalancedJsonObject(trimmed);
  return extracted ?? trimmed;
}

function extractFirstBalancedJsonObject(value: string): string | undefined {
  const start = value.indexOf("{");
  if (start < 0) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1).trim();
      }
    }
  }

  return undefined;
}

function combineUsage(left: LlmUsage, right: LlmUsage): LlmUsage {
  return {
    promptTokens: left.promptTokens + right.promptTokens,
    completionTokens: left.completionTokens + right.completionTokens,
    totalTokens: left.totalTokens + right.totalTokens
  };
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => typeof entry !== "undefined"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
