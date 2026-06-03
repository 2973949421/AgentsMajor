import type { DriverModel } from "@agent-major/shared";

export const openAiCompatibleProviderId = "openai_compatible";
export const dashscopeOpenAiProviderId = "dashscope_openai_compatible";
export const envOpenAiCompatibleDriverModelId = "driver_env_openai_compatible";

export type OpenAiCompatibleProviderId = typeof openAiCompatibleProviderId | typeof dashscopeOpenAiProviderId;
export type DriverModelBrand = "qwen" | "zhipu" | "kimi" | "minimax" | "deepseek" | "generic";
export type ReasoningMode = "auto" | "enabled" | "disabled";
export type ReasoningEffort = "low" | "medium" | "high";

export interface DriverModelConfig {
  id: string;
  providerId: OpenAiCompatibleProviderId;
  modelName: string;
  brand: DriverModelBrand;
  capabilities: string[];
  defaultUseCase: string[];
  enabled: boolean;
  defaultTemperature?: number;
  defaultMaxOutputTokens?: number;
  reasoningMode?: ReasoningMode;
  reasoningEffort?: ReasoningEffort;
}

export const defaultDriverModelConfigs = [
  {
    id: "driver_deepseek_v4_flash",
    providerId: dashscopeOpenAiProviderId,
    modelName: "deepseek-v4-flash",
    brand: "deepseek",
    capabilities: ["text_generation", "reasoning"],
    defaultUseCase: ["phase18", "team_plan", "agent_action", "judge", "caster", "barrage", "fallback"],
    enabled: true,
    defaultTemperature: 0.4,
    defaultMaxOutputTokens: 1200,
    reasoningMode: "enabled",
    reasoningEffort: "high"
  },
  {
    id: "driver_qwen_3_6_plus",
    providerId: dashscopeOpenAiProviderId,
    modelName: "qwen3.6-plus",
    brand: "qwen",
    capabilities: ["text_generation", "reasoning", "vision"],
    defaultUseCase: ["caster", "barrage", "fallback"],
    enabled: true,
    defaultTemperature: 0.5,
    defaultMaxOutputTokens: 500
  },
  {
    id: "driver_qwen_3_5_plus",
    providerId: dashscopeOpenAiProviderId,
    modelName: "qwen3.5-plus",
    brand: "qwen",
    capabilities: ["text_generation", "reasoning", "vision"],
    defaultUseCase: ["barrage", "fallback"],
    enabled: true,
    defaultTemperature: 0.5,
    defaultMaxOutputTokens: 500
  },
  {
    id: "driver_qwen_3_max_2026_01_23",
    providerId: dashscopeOpenAiProviderId,
    modelName: "qwen3-max-2026-01-23",
    brand: "qwen",
    capabilities: ["text_generation", "reasoning"],
    defaultUseCase: ["round_report", "event_builder", "summary", "news"],
    enabled: true,
    defaultTemperature: 0.4,
    defaultMaxOutputTokens: 900
  },
  {
    id: "driver_qwen_3_coder_next",
    providerId: dashscopeOpenAiProviderId,
    modelName: "qwen3-coder-next",
    brand: "qwen",
    capabilities: ["text_generation", "code"],
    defaultUseCase: ["agent_action", "repair"],
    enabled: true,
    defaultTemperature: 0.3,
    defaultMaxOutputTokens: 700
  },
  {
    id: "driver_qwen_3_coder_plus",
    providerId: dashscopeOpenAiProviderId,
    modelName: "qwen3-coder-plus",
    brand: "qwen",
    capabilities: ["text_generation", "code"],
    defaultUseCase: ["agent_action", "repair"],
    enabled: true,
    defaultTemperature: 0.3,
    defaultMaxOutputTokens: 700
  },
  {
    id: "driver_glm_5",
    providerId: dashscopeOpenAiProviderId,
    modelName: "glm-5",
    brand: "zhipu",
    capabilities: ["text_generation", "reasoning"],
    defaultUseCase: ["judge", "arbiter", "summary"],
    enabled: true,
    defaultTemperature: 0.2,
    defaultMaxOutputTokens: 900
  },
  {
    id: "driver_glm_4_7",
    providerId: dashscopeOpenAiProviderId,
    modelName: "glm-4.7",
    brand: "zhipu",
    capabilities: ["text_generation", "reasoning"],
    defaultUseCase: ["judge", "fallback"],
    enabled: true,
    defaultTemperature: 0.2,
    defaultMaxOutputTokens: 900
  },
  {
    id: "driver_kimi_k2_5",
    providerId: dashscopeOpenAiProviderId,
    modelName: "kimi-k2.5",
    brand: "kimi",
    capabilities: ["text_generation", "reasoning", "vision"],
    defaultUseCase: ["caster", "news", "interview"],
    enabled: true,
    defaultTemperature: 0.6,
    defaultMaxOutputTokens: 500
  },
  {
    id: "driver_minimax_m2_5",
    providerId: dashscopeOpenAiProviderId,
    modelName: "MiniMax-M2.5",
    brand: "minimax",
    capabilities: ["text_generation", "reasoning"],
    defaultUseCase: ["barrage", "interview"],
    enabled: true,
    defaultTemperature: 0.7,
    defaultMaxOutputTokens: 450
  }
] as const satisfies readonly DriverModelConfig[];

export const defaultDriverModels: DriverModel[] = defaultDriverModelConfigs.map(toDriverModel);

export function createEnvOpenAiCompatibleDriverModel(modelName: string, providerId: OpenAiCompatibleProviderId = openAiCompatibleProviderId): DriverModel {
  return toDriverModel(createEnvOpenAiCompatibleDriverModelConfig(modelName, providerId));
}

export function createEnvOpenAiCompatibleDriverModelConfig(
  modelName: string,
  providerId: OpenAiCompatibleProviderId = openAiCompatibleProviderId
): DriverModelConfig {
  const normalizedModelName = modelName.trim() || "deepseek-v4-flash";
  return {
    id: envOpenAiCompatibleDriverModelId,
    providerId,
    modelName: normalizedModelName,
    brand: inferDriverModelBrand(normalizedModelName),
    capabilities: ["text_generation", "reasoning"],
    defaultUseCase: ["phase18", "team_plan", "agent_action", "judge", "caster", "barrage", "fallback"],
    enabled: true,
    defaultTemperature: 0.4,
    defaultMaxOutputTokens: 1200,
    reasoningMode: inferDriverModelBrand(normalizedModelName) === "deepseek" ? "enabled" : "auto",
    reasoningEffort: inferDriverModelBrand(normalizedModelName) === "deepseek" ? "high" : "medium"
  };
}

export function resolveDriverModelConfig(driverModelId: string, envModelName?: string): DriverModelConfig {
  if (driverModelId === envOpenAiCompatibleDriverModelId) {
    return createEnvOpenAiCompatibleDriverModelConfig(envModelName ?? "deepseek-v4-flash");
  }

  const config = defaultDriverModelConfigs.find((item) => item.id === driverModelId);
  if (!config) {
    throw new Error(`Unknown driver model id: ${driverModelId}`);
  }

  return config;
}

function toDriverModel(config: DriverModelConfig): DriverModel {
  return {
  id: config.id,
  provider: config.providerId,
  modelName: config.modelName,
  capabilities: [...config.capabilities],
  defaultUseCase: [...config.defaultUseCase],
  limits: {
    defaultTemperature: config.defaultTemperature,
    defaultMaxOutputTokens: config.defaultMaxOutputTokens
  },
  enabled: config.enabled,
  createdAt: "2026-05-02T00:00:00.000Z"
  };
}

function inferDriverModelBrand(modelName: string): DriverModelBrand {
  const normalized = modelName.trim().toLowerCase();
  if (normalized.includes("deepseek")) {
    return "deepseek";
  }
  if (normalized.includes("qwen")) {
    return "qwen";
  }
  if (normalized.includes("glm")) {
    return "zhipu";
  }
  if (normalized.includes("kimi")) {
    return "kimi";
  }
  if (normalized.includes("minimax")) {
    return "minimax";
  }
  return "generic";
}
