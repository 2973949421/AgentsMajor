export type LlmModelTier = "cheap" | "standard" | "strong";
export type LlmResponseFormat = "text" | "json_object";

export type LlmTaskType =
  | "team_plan"
  | "agent_action"
  | "judge"
  | "judge_verdict"
  | "judge_narrative"
  | "judge_review"
  | "combat_resolution"
  | "coach_timeout"
  | "coach_post_match_review"
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

export interface LlmProviderDiagnostics {
  finishReason?: string;
  contentLength?: number;
  reasoningContentLength?: number;
  reasoningContentPreview?: string;
  emptyContentWithReasoning?: boolean;
  providerResponseShape?: string;
}

export interface LlmResponse<TData = unknown> {
  data: TData;
  usage: LlmUsage;
  rawText?: string;
  providerDiagnostics?: LlmProviderDiagnostics;
  artifactIds?: string[];
  structuredRepair?: {
    originalRawText: string;
    repairRawText: string;
    repairUsage: LlmUsage;
    repairProviderDiagnostics?: LlmProviderDiagnostics;
    parseError: string;
  };
}

export interface LlmGateway {
  generateStructured<TData = unknown, TInput = unknown>(
    request: LlmRequest<TInput>
  ): Promise<LlmResponse<TData>>;
}
