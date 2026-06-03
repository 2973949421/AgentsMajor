import {
  dashscopeOpenAiProviderId,
  envOpenAiCompatibleDriverModelId,
  openAiCompatibleProviderId,
  type ReasoningEffort,
  type ReasoningMode
} from "./model-registry.js";

const defaultDeepSeekDriverModelId = "driver_deepseek_v4_flash";

export interface AgentMajorLlmConfig {
  enabled: boolean;
  disabledReason?: string;
  providerId: string;
  baseUrl?: string;
  apiKey?: string;
  modelName?: string;
  phase18DriverModelId: string;
  casterDriverModelId: string;
  casterFallbackDriverModelId: string;
  barrageDriverModelId: string;
  barrageFallbackDriverModelId: string;
  reasoningMode: ReasoningMode;
  reasoningEffort: ReasoningEffort;
  timeoutMs: number;
  maxRetries: number;
}

export function loadAgentMajorLlmConfig(env: Record<string, string | undefined> = process.env): AgentMajorLlmConfig {
  const providerId = normalizeProviderId(env.AGENT_MAJOR_LLM_PROVIDER);
  const modelName = env.AGENT_MAJOR_LLM_MODEL?.trim();
  const envDriverModelId = modelName ? envOpenAiCompatibleDriverModelId : defaultDeepSeekDriverModelId;
  const baseConfig = {
    providerId,
    ...(modelName ? { modelName } : {}),
    phase18DriverModelId: env.AGENT_MAJOR_PHASE18_DRIVER_MODEL_ID?.trim() || envDriverModelId,
    casterDriverModelId: env.AGENT_MAJOR_CASTER_DRIVER_MODEL_ID?.trim() || envDriverModelId,
    casterFallbackDriverModelId: env.AGENT_MAJOR_CASTER_FALLBACK_DRIVER_MODEL_ID?.trim() || envDriverModelId,
    barrageDriverModelId: env.AGENT_MAJOR_BARRAGE_DRIVER_MODEL_ID?.trim() || envDriverModelId,
    barrageFallbackDriverModelId: env.AGENT_MAJOR_BARRAGE_FALLBACK_DRIVER_MODEL_ID?.trim() || envDriverModelId,
    reasoningMode: normalizeReasoningMode(env.AGENT_MAJOR_LLM_REASONING_MODE, modelName),
    reasoningEffort: normalizeReasoningEffort(env.AGENT_MAJOR_LLM_REASONING_EFFORT),
    timeoutMs: parsePositiveInteger(env.AGENT_MAJOR_LLM_TIMEOUT_MS, 300_000),
    maxRetries: parseNonNegativeInteger(env.AGENT_MAJOR_LLM_MAX_RETRIES, 4)
  };

  if (!isTruthy(env.AGENT_MAJOR_REAL_LLM_ENABLED)) {
    return {
      ...baseConfig,
      enabled: false,
      disabledReason: "real_llm_disabled"
    };
  }

  if (!isSupportedOpenAiCompatibleProvider(providerId)) {
    return {
      ...baseConfig,
      enabled: false,
      disabledReason: "unsupported_provider"
    };
  }

  const baseUrl = env.AGENT_MAJOR_LLM_BASE_URL?.trim() || env.DASHSCOPE_BASE_URL?.trim();
  if (!baseUrl) {
    return {
      ...baseConfig,
      enabled: false,
      disabledReason: "missing_llm_base_url"
    };
  }

  const apiKey = env.AGENT_MAJOR_LLM_API_KEY?.trim() || env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) {
    return {
      ...baseConfig,
      enabled: false,
      baseUrl,
      disabledReason: "missing_llm_api_key"
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
  return value?.trim() || openAiCompatibleProviderId;
}

function isSupportedOpenAiCompatibleProvider(value: string): boolean {
  return value === openAiCompatibleProviderId || value === dashscopeOpenAiProviderId;
}

function normalizeReasoningMode(value: string | undefined, modelName: string | undefined): ReasoningMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "enabled" || normalized === "on" || normalized === "true") {
    return "enabled";
  }
  if (normalized === "disabled" || normalized === "off" || normalized === "false") {
    return "disabled";
  }
  if (normalized === "auto") {
    return "auto";
  }
  return modelName?.toLowerCase().includes("deepseek") ? "enabled" : "auto";
}

function normalizeReasoningEffort(value: string | undefined): ReasoningEffort {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized;
  }
  return "high";
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
