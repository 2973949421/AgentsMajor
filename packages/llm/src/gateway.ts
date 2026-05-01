export type LlmModelTier = "cheap" | "standard" | "strong";

export type LlmTaskType =
  | "agent_action"
  | "judge"
  | "arbiter"
  | "round_report"
  | "event_builder"
  | "broadcast";

export interface LlmRequest<TInput = unknown> {
  task: LlmTaskType;
  driverModelId: string;
  input: TInput;
  schemaName: string;
  seed?: string;
  modelTier?: LlmModelTier;
  maxOutputTokens?: number;
  temperature?: number;
  extraParams?: Record<string, unknown>;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmResponse<TData = unknown> {
  data: TData;
  usage: LlmUsage;
  rawText?: string;
  artifactIds?: string[];
}

export interface LlmGateway {
  generateStructured<TData = unknown, TInput = unknown>(
    request: LlmRequest<TInput>
  ): Promise<LlmResponse<TData>>;
}
