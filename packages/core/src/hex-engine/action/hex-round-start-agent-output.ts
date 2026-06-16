import {
  DashScopeOpenAiProvider,
  loadAgentMajorLlmConfig,
  type LlmProviderDiagnostics,
  type LlmUsage
} from "@agent-major/llm";
import type { ArtifactStore } from "../../ports.js";
import type { HexAgentEconomyContext, HexRoundEconomyContext } from "../economy/index.js";
import type { HexSide } from "../state/index.js";
import type { HexAgentOpeningBrief, HexRoundOpeningBrief } from "./hex-round-opening-brief.js";

export type HexRoundStartAgentOutputSource =
  | "llm_response_artifact"
  | "fixture_response"
  | "provider_error"
  | "invalid_response";

export interface HexRoundStartAgentOutputRequest {
  schemaVersion: 1;
  requestMode: "round_start_agent_output";
  outputLanguage: "zh-CN";
  roundNumber: number;
  topicTitle: string;
  defenseSummaryZh: string;
  attackSummaryZh: string;
  evidenceBoundaryZh: string;
  systemInputCard: HexAgentOpeningBrief;
  agent: {
    agentId: string;
    displayName: string;
    teamId: string;
    teamSide: HexSide;
    role: string;
    financeRole?: string | undefined;
    financeRoleCn?: string | undefined;
  };
  economy?: {
    buyType: string;
    resourceTier: string;
    utilityTier: string;
    spend: number;
    outputBudget: number;
    constraints: string[];
  } | undefined;
  outputSchema: {
    requiredFields: readonly [
      "openingStatementZh",
      "evidenceRefs",
      "riskBoundaryZh",
      "buyConstraintAppliedZh",
      "phaseActionCarryoverZh"
    ];
    optionalFields: readonly ["confidence"];
  };
  constraints: string[];
}

export interface HexRoundStartAgentOutputDraft {
  openingStatementZh: string;
  evidenceRefs: string[];
  riskBoundaryZh: string;
  buyConstraintAppliedZh: string;
  phaseActionCarryoverZh: string;
  confidence?: number | undefined;
}

export interface HexRoundStartAgentOutputForAction {
  outputId: string;
  agentId: string;
  usableForPhaseAction: boolean;
  openingStatementZh: string;
  evidenceRefs: string[];
  riskBoundaryZh: string;
  buyConstraintAppliedZh: string;
  phaseActionCarryoverZh: string;
  source: HexRoundStartAgentOutputSource;
}

export interface HexRoundStartAgentOutput extends HexRoundStartAgentOutputForAction {
  roundNumber: number;
  displayName: string;
  teamSide: HexSide;
  financeRole?: string | undefined;
  financeRoleCn?: string | undefined;
  buyType?: string | undefined;
  resourceTier?: string | undefined;
  requestArtifactId?: string | undefined;
  responseArtifactId?: string | undefined;
  rawOutputSummaryZh: string;
  normalizationSummaryZh: string;
  validationSummaryZh: string;
  technicalRefs: {
    rawTextPreview?: string | undefined;
    rawDraftPreview?: string | undefined;
    normalizedDraftPreview?: string | undefined;
    errors: string[];
    repairedFields: string[];
    providerMode?: string | undefined;
    modelId?: string | undefined;
  };
}

export interface HexRoundStartAgentOutputProviderResult {
  rawDraft: unknown;
  providerMode?: "fixture" | "real" | undefined;
  modelId?: string | undefined;
  rawText?: string | undefined;
  usage?: LlmUsage | undefined;
  providerDiagnostics?: LlmProviderDiagnostics | undefined;
}

export type HexRoundStartAgentOutputProvider =
  (request: HexRoundStartAgentOutputRequest) => Promise<unknown | HexRoundStartAgentOutputProviderResult> | unknown | HexRoundStartAgentOutputProviderResult;

export interface RunHexRoundStartAgentOutputHarnessInput {
  roundId: string;
  roundOpeningBrief: HexRoundOpeningBrief;
  economyContext?: HexRoundEconomyContext | undefined;
  provider: HexRoundStartAgentOutputProvider;
  providerMode?: "fixture" | "real" | undefined;
  modelId?: string | undefined;
  artifactStore?: ArtifactStore | undefined;
  artifactOwner?: {
    ownerType: string;
    ownerId: string;
    tournamentId?: string | undefined;
    matchId?: string | undefined;
    mapGameId?: string | undefined;
    roundId?: string | undefined;
  } | undefined;
}

export async function runHexRoundStartAgentOutputHarness(
  input: RunHexRoundStartAgentOutputHarnessInput
): Promise<HexRoundStartAgentOutput[]> {
  const outputs: HexRoundStartAgentOutput[] = [];
  for (const brief of input.roundOpeningBrief.agentBriefs) {
    const economy = input.economyContext?.agents.find((agent) => agent.agentId === brief.agentId);
    const request = buildHexRoundStartAgentOutputRequest({
      roundOpeningBrief: input.roundOpeningBrief,
      agentOpeningBrief: brief,
      economy
    });
    const callId = `hex_${input.roundId}_round_start_${brief.agentId}`;
    const requestArtifactId = await writeRoundStartArtifact(input, {
      callId,
      agentId: brief.agentId,
      suffix: "request",
      artifactType: "hex_round_start_agent_output_request",
      content: {
        schemaVersion: 1,
        callId,
        request
      }
    });
    try {
      const providerResult = normalizeRoundStartProviderResult(await input.provider(request));
      const normalized = normalizeHexRoundStartAgentOutputDraft(providerResult.rawDraft, {
        allowedEvidenceRefs: request.systemInputCard.evidenceRefs ?? []
      });
      const responseArtifactId = await writeRoundStartArtifact(input, {
        callId,
        agentId: brief.agentId,
        suffix: "response",
        artifactType: "hex_round_start_agent_output_response",
        content: {
          schemaVersion: 1,
          callId,
          rawText: providerResult.rawText,
          usage: providerResult.usage,
          providerDiagnostics: providerResult.providerDiagnostics,
          rawDraft: providerResult.rawDraft,
          normalized
        }
      });
      outputs.push(buildRoundStartOutput({
        request,
        providerResult,
        normalized,
        requestArtifactId,
        responseArtifactId
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outputs.push(buildProviderErrorOutput({
        request,
        requestArtifactId,
        message,
        providerMode: input.providerMode,
        modelId: input.modelId
      }));
    }
  }
  return outputs;
}

export function buildHexRoundStartAgentOutputRequest(input: {
  roundOpeningBrief: HexRoundOpeningBrief;
  agentOpeningBrief: HexAgentOpeningBrief;
  economy?: HexAgentEconomyContext | undefined;
}): HexRoundStartAgentOutputRequest {
  const brief = input.agentOpeningBrief;
  const request: HexRoundStartAgentOutputRequest = {
    schemaVersion: 1,
    requestMode: "round_start_agent_output",
    outputLanguage: "zh-CN",
    roundNumber: input.roundOpeningBrief.roundNumber,
    topicTitle: input.roundOpeningBrief.topicTitle,
    defenseSummaryZh: input.roundOpeningBrief.defenseSummaryZh,
    attackSummaryZh: input.roundOpeningBrief.attackSummaryZh,
    evidenceBoundaryZh: input.roundOpeningBrief.evidenceBoundaryZh,
    systemInputCard: brief,
    agent: {
      agentId: brief.agentId,
      displayName: brief.displayName,
      teamId: brief.teamId,
      teamSide: brief.teamSide,
      role: brief.role,
      financeRole: brief.financeRole,
      financeRoleCn: brief.financeRoleCn
    },
    outputSchema: {
      requiredFields: [
        "openingStatementZh",
        "evidenceRefs",
        "riskBoundaryZh",
        "buyConstraintAppliedZh",
        "phaseActionCarryoverZh"
      ],
      optionalFields: ["confidence"]
    },
    constraints: [
      "这是本 round 开局输出，不是局内行动。",
      "必须基于系统输入卡、可用事实、证据缺口、经济买型和专家角色给出本局判断。",
      "openingStatementZh 应为 120-260 个中文字符，详实但不要写成长作文。",
      "evidenceRefs 只能使用系统输入卡中的 evidenceRefs，不能编造事实编号。",
      "buyConstraintAppliedZh 必须说明本局买型如何裁剪可承担任务。",
      "phaseActionCarryoverZh 必须说明后续 phase 行动如何短句引用本开局输出。",
      "不要输出行动目标、cell id、winner、kill、damage、economyDelta 或数据库事实。"
    ]
  };
  if (input.economy) {
    request.economy = {
      buyType: input.economy.buyType,
      resourceTier: input.economy.resourceTier,
      utilityTier: input.economy.utilityTier,
      spend: input.economy.spend,
      outputBudget: input.economy.outputBudget,
      constraints: [...input.economy.constraints]
    };
  }
  return request;
}

export function createFixtureHexRoundStartAgentOutputProvider(): HexRoundStartAgentOutputProvider {
  return (request) => ({
    providerMode: "fixture",
    modelId: "fixture_hex_round_start_agent_output",
    rawDraft: {
      openingStatementZh: [
        `${request.agent.displayName} 按 ${request.agent.financeRoleCn ?? request.agent.role} 职责处理“${request.topicTitle}”。`,
        request.systemInputCard.roleQuestionZh ?? request.systemInputCard.roundTaskZh,
        (request.systemInputCard.usableFactsZh ?? []).slice(0, 1).join("；") || "当前只使用系统证据切片中的有限事实。"
      ].join(" "),
      evidenceRefs: (request.systemInputCard.evidenceRefs ?? []).slice(0, 3),
      riskBoundaryZh: request.systemInputCard.evidenceBoundaryZh,
      buyConstraintAppliedZh: request.systemInputCard.buyConstraintZh,
      phaseActionCarryoverZh: "后续 phase 只用一两句引用本开局判断，并把重点放在移动、接触、补枪、控图或回撤。",
      confidence: 0.7
    }
  });
}

export function createEnvHexRoundStartAgentOutputProvider(
  env: Record<string, string | undefined> = process.env
): {
  provider: HexRoundStartAgentOutputProvider;
  providerMode: "real";
  modelId: string;
} {
  const config = loadAgentMajorLlmConfig(env);
  const modelId = config.phase18DriverModelId;
  if (!config.enabled || !config.baseUrl || !config.apiKey) {
    return {
      providerMode: "real",
      modelId,
      provider: () => {
        throw new Error(`real_llm_disabled:${config.disabledReason ?? "missing_configuration"}`);
      }
    };
  }
  const gateway = new DashScopeOpenAiProvider({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    providerId: config.providerId,
    ...(config.modelName ? { modelName: config.modelName } : {}),
    reasoningMode: config.reasoningMode,
    reasoningEffort: config.reasoningEffort,
    timeoutMs: config.timeoutMs,
    maxRetries: Math.min(config.maxRetries, 1)
  });
  return {
    providerMode: "real",
    modelId: config.modelName ?? modelId,
    provider: async (request) => {
      const response = await gateway.generateStructured<Record<string, unknown>, HexRoundStartAgentOutputRequest>({
        task: "agent_action",
        driverModelId: modelId,
        input: request,
        schemaName: "HexRoundStartAgentOutputDraft",
        responseFormat: "json_object",
        modelTier: "standard",
        temperature: 0.35,
        maxOutputTokens: 900,
        extraParams: { thinking: { type: "disabled" } },
        messages: buildRealHexRoundStartAgentOutputMessages(request)
      });
      return {
        providerMode: "real",
        modelId: config.modelName ?? modelId,
        rawDraft: response.data.draft ?? response.data,
        ...(response.rawText !== undefined ? { rawText: response.rawText } : {}),
        usage: response.usage,
        ...(response.providerDiagnostics ? { providerDiagnostics: response.providerDiagnostics } : {})
      };
    }
  };
}

export function buildRealHexRoundStartAgentOutputMessages(request: HexRoundStartAgentOutputRequest) {
  return [
    {
      role: "system" as const,
      content: [
        "你是 Finance Major 的选手 agent，正在进行 round 开局准备输出。",
        "这不是局内行动，不要输出地图 cell、击杀、胜负或经济变化。",
        "请根据系统输入卡、经济买型、可用事实和证据缺口，生成本局你自己的专家开局判断。",
        "输出必须是一个 JSON object，字段名保持英文，字段内容必须为中文。",
        "内容要详实但不冗长；后续 phase 只会引用这一份开局输出。"
      ].join("\n")
    },
    {
      role: "user" as const,
      content: JSON.stringify(request)
    }
  ];
}

export function normalizeHexRoundStartAgentOutputDraft(rawDraft: unknown): {
  draft?: HexRoundStartAgentOutputDraft;
  errors: string[];
  repairedFields: string[];
  ignoredFields: string[];
};
export function normalizeHexRoundStartAgentOutputDraft(
  rawDraft: unknown,
  options: { allowedEvidenceRefs?: readonly string[] } = {}
): {
  draft?: HexRoundStartAgentOutputDraft;
  errors: string[];
  repairedFields: string[];
  ignoredFields: string[];
} {
  const errors: string[] = [];
  const repairedFields: string[] = [];
  const ignoredFields: string[] = [];
  const draftObject = extractRoundStartDraftObject(rawDraft);
  if (!isRecord(draftObject)) {
    return { errors: ["round_start:not_object"], repairedFields, ignoredFields };
  }
  for (const key of Object.keys(draftObject)) {
    if (!["openingStatementZh", "evidenceRefs", "riskBoundaryZh", "buyConstraintAppliedZh", "phaseActionCarryoverZh", "confidence"].includes(key)) {
      ignoredFields.push(key);
    }
  }
  const openingStatementZh = readString(draftObject.openingStatementZh);
  const evidenceRefs = readStringArray(draftObject.evidenceRefs);
  const allowedEvidenceRefs = new Set(options.allowedEvidenceRefs ?? []);
  const invalidEvidenceRefs = evidenceRefs.filter((ref) => !allowedEvidenceRefs.has(ref));
  const riskBoundaryZh = readString(draftObject.riskBoundaryZh);
  const buyConstraintAppliedZh = readString(draftObject.buyConstraintAppliedZh);
  const phaseActionCarryoverZh = readString(draftObject.phaseActionCarryoverZh);
  if (!openingStatementZh) errors.push("round_start:missing_openingStatementZh");
  if (!riskBoundaryZh) errors.push("round_start:missing_riskBoundaryZh");
  if (!buyConstraintAppliedZh) errors.push("round_start:missing_buyConstraintAppliedZh");
  if (!phaseActionCarryoverZh) errors.push("round_start:missing_phaseActionCarryoverZh");
  if (containsGarbledText(openingStatementZh) || containsGarbledText(riskBoundaryZh) || containsGarbledText(buyConstraintAppliedZh) || containsGarbledText(phaseActionCarryoverZh)) {
    errors.push("round_start:garbled_text");
  }
  for (const ref of invalidEvidenceRefs) {
    errors.push(`round_start:rejected_invalid_round_start_evidence_ref:${ref}`);
  }
  if (openingStatementZh.replace(/\s+/g, "").length > 420) {
    errors.push("round_start:opening_statement_too_long");
  }
  if (errors.length > 0) {
    return { errors, repairedFields, ignoredFields };
  }
  const draft: HexRoundStartAgentOutputDraft = {
    openingStatementZh,
    evidenceRefs,
    riskBoundaryZh,
    buyConstraintAppliedZh,
    phaseActionCarryoverZh
  };
  const confidence = readConfidence(draftObject.confidence);
  if (confidence !== undefined) {
    draft.confidence = confidence;
  }
  return { draft, errors, repairedFields, ignoredFields };
}

function buildRoundStartOutput(input: {
  request: HexRoundStartAgentOutputRequest;
  providerResult: HexRoundStartAgentOutputProviderResult;
  normalized: ReturnType<typeof normalizeHexRoundStartAgentOutputDraft>;
  requestArtifactId?: string | undefined;
  responseArtifactId?: string | undefined;
}): HexRoundStartAgentOutput {
  const draft = input.normalized.draft;
  const fallbackDraft = buildFallbackDraft(input.request, input.normalized.errors);
  const effectiveDraft = draft ?? fallbackDraft;
  const source: HexRoundStartAgentOutputSource = draft
    ? input.providerResult.providerMode === "fixture"
      ? "fixture_response"
      : "llm_response_artifact"
    : "invalid_response";
  return {
    outputId: `round_start_${input.request.roundNumber}_${input.request.agent.agentId}`,
    roundNumber: input.request.roundNumber,
    agentId: input.request.agent.agentId,
    displayName: input.request.agent.displayName,
    teamSide: input.request.agent.teamSide,
    financeRole: input.request.agent.financeRole,
    financeRoleCn: input.request.agent.financeRoleCn,
    buyType: input.request.economy?.buyType,
    resourceTier: input.request.economy?.resourceTier,
    source,
    usableForPhaseAction: isUsableRoundStartAgentOutputSource(source, input.responseArtifactId, input.normalized.errors),
    requestArtifactId: input.requestArtifactId,
    responseArtifactId: input.responseArtifactId,
    rawOutputSummaryZh: draft
      ? `真实开局输出摘要：${truncateText(draft.openingStatementZh, 220)}`
      : `开局输出未通过规范化：${input.normalized.errors.join("；")}`,
    openingStatementZh: effectiveDraft.openingStatementZh,
    evidenceRefs: [...effectiveDraft.evidenceRefs],
    riskBoundaryZh: effectiveDraft.riskBoundaryZh,
    buyConstraintAppliedZh: effectiveDraft.buyConstraintAppliedZh,
    phaseActionCarryoverZh: effectiveDraft.phaseActionCarryoverZh,
    normalizationSummaryZh: input.normalized.repairedFields.length > 0
      ? `系统修复：${input.normalized.repairedFields.join("；")}`
      : "系统未记录修复。",
    validationSummaryZh: draft ? "开局输出通过结构校验。" : `开局输出未通过结构校验：${input.normalized.errors.join("；")}`,
    technicalRefs: {
      rawTextPreview: truncateText(input.providerResult.rawText, 260),
      rawDraftPreview: previewValue(input.providerResult.rawDraft),
      normalizedDraftPreview: previewValue(input.normalized.draft),
      errors: [...input.normalized.errors],
      repairedFields: [...input.normalized.repairedFields],
      providerMode: input.providerResult.providerMode,
      modelId: input.providerResult.modelId
    }
  };
}

function buildProviderErrorOutput(input: {
  request: HexRoundStartAgentOutputRequest;
  requestArtifactId?: string | undefined;
  message: string;
  providerMode?: string | undefined;
  modelId?: string | undefined;
}): HexRoundStartAgentOutput {
  const fallbackDraft = buildFallbackDraft(input.request, [`provider_error:${input.message}`]);
  return {
    outputId: `round_start_${input.request.roundNumber}_${input.request.agent.agentId}`,
    roundNumber: input.request.roundNumber,
    agentId: input.request.agent.agentId,
    displayName: input.request.agent.displayName,
    teamSide: input.request.agent.teamSide,
    financeRole: input.request.agent.financeRole,
    financeRoleCn: input.request.agent.financeRoleCn,
    buyType: input.request.economy?.buyType,
    resourceTier: input.request.economy?.resourceTier,
    source: "provider_error",
    usableForPhaseAction: false,
    requestArtifactId: input.requestArtifactId,
    rawOutputSummaryZh: `开局真实模型调用失败：${input.message}`,
    openingStatementZh: fallbackDraft.openingStatementZh,
    evidenceRefs: [],
    riskBoundaryZh: fallbackDraft.riskBoundaryZh,
    buyConstraintAppliedZh: fallbackDraft.buyConstraintAppliedZh,
    phaseActionCarryoverZh: fallbackDraft.phaseActionCarryoverZh,
    normalizationSummaryZh: "provider 失败，未产生可规范化开局输出。",
    validationSummaryZh: `开局输出失败：${input.message}`,
    technicalRefs: {
      errors: [`provider_error:${input.message}`],
      repairedFields: [],
      providerMode: input.providerMode,
      modelId: input.modelId
    }
  };
}

export function isUsableRoundStartAgentOutput(
  output: HexRoundStartAgentOutputForAction | undefined
): output is HexRoundStartAgentOutputForAction {
  return Boolean(
    output
    && output.usableForPhaseAction === true
    && (output.source === "fixture_response" || output.source === "llm_response_artifact")
  );
}

function isUsableRoundStartAgentOutputSource(
  source: HexRoundStartAgentOutputSource,
  responseArtifactId: string | undefined,
  errors: readonly string[]
): boolean {
  if (errors.length > 0) {
    return false;
  }
  if (source === "fixture_response") {
    return true;
  }
  return source === "llm_response_artifact" && Boolean(responseArtifactId);
}

function buildFallbackDraft(request: HexRoundStartAgentOutputRequest, errors: readonly string[]): HexRoundStartAgentOutputDraft {
  return {
    openingStatementZh: `本局没有可采信的真实开局输出，原因：${errors.join("；") || "unknown"}。后续行动不能把系统输入卡当作 agent 发言。`,
    evidenceRefs: [],
    riskBoundaryZh: "真实开局输出缺失，裁判只能按后续行动和系统证据边界审计。",
    buyConstraintAppliedZh: request.economy
      ? `买型 ${request.economy.buyType}，资源 ${request.economy.resourceTier}，但本局真实开局输出缺失。`
      : "经济买型未记录，且真实开局输出缺失。",
    phaseActionCarryoverZh: "后续 phase 不得用系统输入卡冒充开局真实输出。"
  };
}

async function writeRoundStartArtifact(
  input: RunHexRoundStartAgentOutputHarnessInput,
  artifact: {
    callId: string;
    agentId: string;
    suffix: "request" | "response";
    artifactType: string;
    content: unknown;
  }
): Promise<string | undefined> {
  if (!input.artifactStore || !input.artifactOwner) {
    return undefined;
  }
  const written = await input.artifactStore.write({
    ownerType: input.artifactOwner.ownerType,
    ownerId: input.artifactOwner.ownerId,
    artifactType: artifact.artifactType,
    relativePath: `hex-round-start-agent-output/${artifact.callId}-${artifact.suffix}.json`,
    content: JSON.stringify(artifact.content, null, 2),
    agentId: artifact.agentId,
    ...(input.artifactOwner.tournamentId ? { tournamentId: input.artifactOwner.tournamentId } : {}),
    ...(input.artifactOwner.matchId ? { matchId: input.artifactOwner.matchId } : {}),
    ...(input.artifactOwner.mapGameId ? { mapGameId: input.artifactOwner.mapGameId } : {}),
    ...(input.artifactOwner.roundId ? { roundId: input.artifactOwner.roundId } : {})
  });
  return written.id;
}

function normalizeRoundStartProviderResult(value: unknown | HexRoundStartAgentOutputProviderResult): HexRoundStartAgentOutputProviderResult {
  if (isRecord(value) && "rawDraft" in value) {
    return value as unknown as HexRoundStartAgentOutputProviderResult;
  }
  return { rawDraft: value };
}

function extractRoundStartDraftObject(rawDraft: unknown): unknown {
  if (isRecord(rawDraft) && isRecord(rawDraft.draft)) {
    return rawDraft.draft;
  }
  return rawDraft;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(readString).filter(Boolean);
}

function readConfidence(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.min(1, value));
}

function containsGarbledText(value: string): boolean {
  return /[�]|(?:Ã.|Â.|å.|æ.|ç.|é.|锟|涓|绛|鐨|鍦|杩|妯|褰|瀹|鏂)/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function previewValue(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return truncateText(JSON.stringify(value), 320);
}

function truncateText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}
