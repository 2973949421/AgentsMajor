import type { LlmGateway, LlmRequest, LlmResponse } from "./gateway.js";

export interface FakeProviderOptions {
  providerId?: string;
}

export interface FakeProviderPayload {
  providerId: string;
  task: string;
  driverModelId: string;
  schemaName: string;
  seed: string;
  fingerprint: string;
  placeholder: true;
}

export class FakeProvider implements LlmGateway {
  private readonly providerId: string;

  constructor(options: FakeProviderOptions = {}) {
    this.providerId = options.providerId ?? "fake-provider";
  }

  async generateStructured<TData = unknown, TInput = unknown>(
    request: LlmRequest<TInput>
  ): Promise<LlmResponse<TData>> {
    const seed = request.seed ?? "default";
    const fingerprint = stableFingerprint([
      this.providerId,
      request.task,
      request.driverModelId,
      request.schemaName,
      seed,
      JSON.stringify(request.input)
    ]);

    const payload: FakeProviderPayload = {
      providerId: this.providerId,
      task: request.task,
      driverModelId: request.driverModelId,
      schemaName: request.schemaName,
      seed,
      fingerprint,
      placeholder: true
    };

    const promptTokens = 24 + (fingerprint.charCodeAt(0) % 8);
    const completionTokens = 12 + (fingerprint.charCodeAt(1) % 6);

    return {
      data: payload as TData,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens
      },
      rawText: JSON.stringify(payload)
    };
  }
}

function stableFingerprint(parts: string[]): string {
  const source = parts.join("|");
  let hash = 2166136261;

  for (const char of source) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}
