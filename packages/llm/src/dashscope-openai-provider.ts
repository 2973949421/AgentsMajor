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

  constructor(input: {
    message: string;
    errorType: LlmProviderErrorType;
    retryable: boolean;
    driverModelId: string;
    modelName?: string;
    statusCode?: number;
  }) {
    super(input.message);
    this.name = "LlmProviderError";
    this.errorType = input.errorType;
    this.retryable = input.retryable;
    this.providerId = dashscopeOpenAiProviderId;
    this.driverModelId = input.driverModelId;
    this.modelName = input.modelName;
    this.statusCode = input.statusCode;
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
      const data = input.request.responseFormat === "json_object" ? parseJsonContent(rawText, input.request, input.modelName) : rawText;
      return {
        data: data as TData,
        usage: extractUsage(json),
        rawText
      };
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
  const candidate = stripJsonFence(rawText);
  try {
    return JSON.parse(candidate);
  } catch {
    throw new LlmProviderError({
      message: "LLM provider returned text that does not parse as JSON.",
      errorType: "invalid_response",
      retryable: false,
      driverModelId: request.driverModelId,
      modelName
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
