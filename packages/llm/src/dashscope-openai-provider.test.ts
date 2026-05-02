import { describe, expect, it } from "vitest";

import { DashScopeOpenAiProvider, LlmProviderError } from "./dashscope-openai-provider.js";
import { loadAgentMajorLlmConfig } from "./env.js";
import { resolveDriverModelConfig } from "./model-registry.js";

describe("Phase 1.5 DashScope OpenAI provider", () => {
  it("keeps real LLM disabled unless explicitly enabled and configured", () => {
    expect(loadAgentMajorLlmConfig({}).enabled).toBe(false);
    expect(loadAgentMajorLlmConfig({ AGENT_MAJOR_REAL_LLM_ENABLED: "true", DASHSCOPE_BASE_URL: "https://example.test/v1" }).enabled).toBe(false);
    expect(
      loadAgentMajorLlmConfig({
        AGENT_MAJOR_REAL_LLM_ENABLED: "true",
        DASHSCOPE_BASE_URL: "https://example.test/v1",
        DASHSCOPE_API_KEY: "local-secret"
      })
    ).toMatchObject({ enabled: true, casterDriverModelId: "driver_qwen_3_max_2026_01_23" });
    expect(
      loadAgentMajorLlmConfig({
        AGENT_MAJOR_REAL_LLM_ENABLED: "true",
        AGENT_MAJOR_LLM_PROVIDER: "other-provider",
        DASHSCOPE_BASE_URL: "https://example.test/v1",
        DASHSCOPE_API_KEY: "local-secret"
      })
    ).toMatchObject({ enabled: false, disabledReason: "unsupported_provider", providerId: "other-provider" });
  });

  it("resolves exact configured model names", () => {
    expect(resolveDriverModelConfig("driver_kimi_k2_5").modelName).toBe("kimi-k2.5");
    expect(resolveDriverModelConfig("driver_qwen_3_6_plus").modelName).toBe("qwen3.6-plus");
    expect(() => resolveDriverModelConfig("driver_missing")).toThrow(/Unknown driver model id/);
  });

  it("sends non-streaming OpenAI-compatible requests and parses usage", async () => {
    const seenBodies: unknown[] = [];
    const fetchFn: typeof fetch = async (_url, init) => {
      seenBodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "{\"text\":\"hello\"}" } }],
          usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };
    const provider = new DashScopeOpenAiProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "secret-key",
      maxRetries: 0,
      fetchFn
    });

    const response = await provider.generateStructured<{ text: string }>({
      task: "broadcast",
      driverModelId: "driver_kimi_k2_5",
      input: { roundId: "round-1" },
      schemaName: "CasterLinePayload",
      responseFormat: "json_object"
    });

    expect(response.data).toEqual({ text: "hello" });
    expect(response.usage).toEqual({ promptTokens: 11, completionTokens: 7, totalTokens: 18 });
    expect(seenBodies[0]).toMatchObject({ model: "kimi-k2.5", stream: false });
  });

  it("classifies provider and timeout failures without leaking secrets", async () => {
    const providerError = new DashScopeOpenAiProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "secret-key",
      maxRetries: 0,
      fetchFn: async () => new Response("provider exploded Authorization: Bearer secret-key sk-sp-secret-token", { status: 500 })
    });

    await expect(
      providerError.generateStructured({
        task: "broadcast",
        driverModelId: "driver_kimi_k2_5",
        input: {},
        schemaName: "CasterLinePayload"
      })
    ).rejects.toMatchObject({ errorType: "provider_error", retryable: true });
    await providerError.generateStructured({
      task: "broadcast",
      driverModelId: "driver_kimi_k2_5",
      input: {},
      schemaName: "CasterLinePayload"
    }).catch((error: unknown) => {
      expect(error).toBeInstanceOf(LlmProviderError);
      expect(JSON.stringify(error)).not.toContain("secret-key");
      expect(JSON.stringify(error)).not.toContain("sk-sp-secret-token");
    });

    const timeoutProvider = new DashScopeOpenAiProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "secret-key",
      maxRetries: 0,
      fetchFn: async () => {
        throw new DOMException("Aborted", "AbortError");
      }
    });

    await expect(
      timeoutProvider.generateStructured({
        task: "broadcast",
        driverModelId: "driver_kimi_k2_5",
        input: {},
        schemaName: "CasterLinePayload"
      })
    ).rejects.toMatchObject({ errorType: "timeout", retryable: true });
  });
});
