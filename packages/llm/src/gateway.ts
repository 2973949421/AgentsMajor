export type LlmModelTier = "cheap" | "standard" | "strong";
export type LlmResponseFormat = "text" | "json_object";

export type LlmTaskType =
  | "agent_action"
  | "judge"
  | "arbiter"
  | "round_report"
  | "event_builder"
  | "broadcast";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmRequest<TInput = unknown> {
  task: LlmTaskType;
  driverModelId: string;
  input: TInput;
  schemaName: string;
  messages?: LlmMessage[];
  responseFormat?: LlmResponseFormat;
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
