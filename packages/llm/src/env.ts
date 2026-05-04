import { dashscopeOpenAiProviderId } from "./model-registry.js";

export interface AgentMajorLlmConfig {
  enabled: boolean;
  disabledReason?: string;
  providerId: string;
  baseUrl?: string;
  apiKey?: string;
  phase18DriverModelId: string;
  casterDriverModelId: string;
  casterFallbackDriverModelId: string;
  barrageDriverModelId: string;
  barrageFallbackDriverModelId: string;
  timeoutMs: number;
  maxRetries: number;
}

export function loadAgentMajorLlmConfig(env: Record<string, string | undefined> = process.env): AgentMajorLlmConfig {
  const providerId = normalizeProviderId(env.AGENT_MAJOR_LLM_PROVIDER);
  const baseConfig = {
    providerId,
    phase18DriverModelId: env.AGENT_MAJOR_PHASE18_DRIVER_MODEL_ID?.trim() || "driver_qwen_3_max_2026_01_23",
    casterDriverModelId: env.AGENT_MAJOR_CASTER_DRIVER_MODEL_ID?.trim() || "driver_qwen_3_max_2026_01_23",
    casterFallbackDriverModelId: env.AGENT_MAJOR_CASTER_FALLBACK_DRIVER_MODEL_ID?.trim() || "driver_qwen_3_6_plus",
    barrageDriverModelId: env.AGENT_MAJOR_BARRAGE_DRIVER_MODEL_ID?.trim() || "driver_minimax_m2_5",
    barrageFallbackDriverModelId: env.AGENT_MAJOR_BARRAGE_FALLBACK_DRIVER_MODEL_ID?.trim() || "driver_qwen_3_5_plus",
    timeoutMs: parsePositiveInteger(env.AGENT_MAJOR_LLM_TIMEOUT_MS, 300_000),
    maxRetries: parseNonNegativeInteger(env.AGENT_MAJOR_LLM_MAX_RETRIES, 2)
  };

  if (!isTruthy(env.AGENT_MAJOR_REAL_LLM_ENABLED)) {
    return {
      ...baseConfig,
      enabled: false,
      disabledReason: "real_llm_disabled"
    };
  }

  if (providerId !== dashscopeOpenAiProviderId) {
    return {
      ...baseConfig,
      enabled: false,
      disabledReason: "unsupported_provider"
    };
  }

  const baseUrl = env.DASHSCOPE_BASE_URL?.trim();
  if (!baseUrl) {
    return {
      ...baseConfig,
      enabled: false,
      disabledReason: "missing_dashscope_base_url"
    };
  }

  const apiKey = env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) {
    return {
      ...baseConfig,
      enabled: false,
      baseUrl,
      disabledReason: "missing_dashscope_api_key"
    };
  }

  return {
    ...baseConfig,
    enabled: true,
    baseUrl,
    apiKey
  };
}

function normalizeProviderId(value: string | undefined): string {
  return value?.trim() || dashscopeOpenAiProviderId;
}

function isTruthy(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
