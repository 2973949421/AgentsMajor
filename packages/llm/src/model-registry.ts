import type { DriverModel } from "@agent-major/shared";

export const dashscopeOpenAiProviderId = "dashscope_openai_compatible";

export interface DriverModelConfig {
  id: string;
  providerId: typeof dashscopeOpenAiProviderId;
  modelName: string;
  brand: "qwen" | "zhipu" | "kimi" | "minimax";
  capabilities: string[];
  defaultUseCase: string[];
  enabled: boolean;
  defaultTemperature?: number;
  defaultMaxOutputTokens?: number;
}

export const defaultDriverModelConfigs = [
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

export const defaultDriverModels: DriverModel[] = defaultDriverModelConfigs.map((config) => ({
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
}));

export function resolveDriverModelConfig(driverModelId: string): DriverModelConfig {
  const config = defaultDriverModelConfigs.find((item) => item.id === driverModelId);
  if (!config) {
    throw new Error(`Unknown driver model id: ${driverModelId}`);
  }

  return config;
}
