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

export type HexRoundStartCardKind = "stance" | "challenge";

export interface HexRoundStartClaimCatalogItem {
  claimId: string;
  claimType: string;
  claimZh: string;
  stanceAgentId: string;
  evidenceRefs: string[];
  reasoningBridge: string;
}

export interface HexFinanceCoreClaim {
  claimId: string;
  claimType: string;
  claimZh: string;
  evidenceRefs: string[];
  reasoningBridge: string;
  confidence: number;
  unsupportedIfEvidenceRejected: boolean;
}

export interface HexFinanceStanceCard {
  cardId: string;
  agentId: string;
  teamSide: HexSide;
  decisionQuestionZh: string;
  direction: string;
  target: string;
  horizon: string;
  confidence: number;
  positionSuggestion: string;
  coreClaims: HexFinanceCoreClaim[];
  riskBoundaries: string[];
  invalidatingConditions: string[];
  auditSummaryZh: string;
}

export interface HexFinanceChallenge {
  challengeId: string;
  targetClaimId: string;
  challengeType: string;
  evidenceRefs: string[];
  challengeReasonZh: string;
  expectedEffect: string;
}

export interface HexFinanceChallengeCard {
  cardId: string;
  agentId: string;
  teamSide: HexSide;
  targetClaimId: string;
  challengeType: string;
  challengedAssumption: string;
  evidenceRefs: string[];
  proxyMismatch: string;
  confidenceReduction: number;
  challenges: HexFinanceChallenge[];
  auditSummaryZh: string;
}

export interface HexRoundStartAllowedPhaseRefs {
  claimIds: string[];
  challengeIds: string[];
}

export interface HexRoundStartAgentOutputRequest {
  schemaVersion: 1;
  requestMode: "round_start_agent_output";
  outputLanguage: "zh-CN";
  roundNumber: number;
  topicTitle: string;
  cardKind: HexRoundStartCardKind;
  decisionQuestionZh?: string | undefined;
  allowedStance?: string[] | undefined;
  requiredEvidenceSchema?: Array<{
    requiredKey: string;
    missingEffect: string;
    notWinCondition: true;
  }> | undefined;
  challengePolicyZh?: string | undefined;
  claimCatalog?: HexRoundStartClaimCatalogItem[] | undefined;
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
    requiredFields: readonly string[];
    optionalFields: readonly string[];
  };
  constraints: string[];
}

export interface HexRoundStartAgentOutputDraft {
  cardKind: HexRoundStartCardKind;
  stanceCard?: HexFinanceStanceCard | undefined;
  challengeCard?: HexFinanceChallengeCard | undefined;
  cardSummaryZh: string;
  evidenceRefs: string[];
  riskBoundaryZh: string;
  buyConstraintAppliedZh: string;
  phaseActionCarryoverZh: string;
  allowedPhaseRefs: HexRoundStartAllowedPhaseRefs;
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
  cardKind?: HexRoundStartCardKind | undefined;
  stanceCard?: HexFinanceStanceCard | undefined;
  challengeCard?: HexFinanceChallengeCard | undefined;
  cardSummaryZh?: string | undefined;
  allowedPhaseRefs?: HexRoundStartAllowedPhaseRefs | undefined;
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
  const claimCatalog: HexRoundStartClaimCatalogItem[] = [];
  const stanceBriefs = input.roundOpeningBrief.agentBriefs.filter((brief) => brief.teamSide === "defense");
  const challengeBriefs = input.roundOpeningBrief.agentBriefs.filter((brief) => brief.teamSide === "attack");

  for (const brief of stanceBriefs) {
    const economy = input.economyContext?.agents.find((agent) => agent.agentId === brief.agentId);
    const request = buildHexRoundStartAgentOutputRequest({
      roundOpeningBrief: input.roundOpeningBrief,
      agentOpeningBrief: brief,
      economy,
      claimCatalog
    });
    const output = await runSingleRoundStartOutput({
      input,
      request,
      brief
    });
    outputs.push(output);
    if (isUsableRoundStartAgentOutput(output) && output.stanceCard) {
      claimCatalog.push(...buildClaimCatalogFromStanceCard(output.stanceCard));
    }
  }

  for (const brief of challengeBriefs) {
    const economy = input.economyContext?.agents.find((agent) => agent.agentId === brief.agentId);
    const request = buildHexRoundStartAgentOutputRequest({
      roundOpeningBrief: input.roundOpeningBrief,
      agentOpeningBrief: brief,
      economy,
      claimCatalog
    });
    if (claimCatalog.length === 0) {
      outputs.push(await buildNoValidClaimCatalogOutput({
        input,
        request,
        brief
      }));
      continue;
    }
    outputs.push(await runSingleRoundStartOutput({
      input,
      request,
      brief
    }));
  }

  return outputs;
}

async function runSingleRoundStartOutput(input: {
  input: RunHexRoundStartAgentOutputHarnessInput;
  request: HexRoundStartAgentOutputRequest;
  brief: HexAgentOpeningBrief;
}): Promise<HexRoundStartAgentOutput> {
  const callId = buildRoundStartCallId(input.input.roundId, input.brief.agentId);
  const requestArtifactId = await writeRoundStartArtifact(input.input, {
    callId,
    agentId: input.brief.agentId,
    suffix: "request",
    artifactType: "hex_round_start_agent_output_request",
    content: {
      schemaVersion: 1,
      callId,
      request: input.request
    }
  });
  try {
    const providerResult = normalizeRoundStartProviderResult(await input.input.provider(input.request));
    const normalized = normalizeHexRoundStartAgentOutputDraft(providerResult.rawDraft, {
      allowedEvidenceRefs: input.request.systemInputCard.evidenceRefs ?? [],
      allowedStance: input.request.allowedStance ?? [],
      expectedCardKind: input.request.cardKind,
      agentId: input.request.agent.agentId,
      teamSide: input.request.agent.teamSide,
      decisionQuestionZh: input.request.decisionQuestionZh ?? input.request.topicTitle,
      claimCatalog: input.request.claimCatalog ?? []
    });
    const responseArtifactId = await writeRoundStartArtifact(input.input, {
      callId,
      agentId: input.brief.agentId,
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
    return buildRoundStartOutput({
      request: input.request,
      providerResult,
      normalized,
      requestArtifactId,
      responseArtifactId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildProviderErrorOutput({
      request: input.request,
      requestArtifactId,
      message,
      providerMode: input.input.providerMode,
      modelId: input.input.modelId
    });
  }
}

async function buildNoValidClaimCatalogOutput(input: {
  input: RunHexRoundStartAgentOutputHarnessInput;
  request: HexRoundStartAgentOutputRequest;
  brief: HexAgentOpeningBrief;
}): Promise<HexRoundStartAgentOutput> {
  const callId = buildRoundStartCallId(input.input.roundId, input.brief.agentId);
  const requestArtifactId = await writeRoundStartArtifact(input.input, {
    callId,
    agentId: input.brief.agentId,
    suffix: "request",
    artifactType: "hex_round_start_agent_output_request",
    content: {
      schemaVersion: 1,
      callId,
      skippedReason: "round_start:no_valid_claim_catalog",
      request: input.request
    }
  });
  return buildInvalidRoundStartOutput({
    request: input.request,
    requestArtifactId,
    errors: ["round_start:no_valid_claim_catalog"],
    normalizationSummaryZh: "立场方没有合法 claimCatalog，挑战方未调用真实模型。",
    validationSummaryZh: "phase0 挑战卡未生成：没有可绑定的真实 targetClaimId。",
    providerMode: input.input.providerMode,
    modelId: input.input.modelId
  });
}

function buildRoundStartCallId(roundId: string, agentId: string): string {
  return `hex_${roundId}_round_start_${agentId}`;
}

export function buildHexRoundStartAgentOutputRequest(input: {
  roundOpeningBrief: HexRoundOpeningBrief;
  agentOpeningBrief: HexAgentOpeningBrief;
  economy?: HexAgentEconomyContext | undefined;
  claimCatalog?: readonly HexRoundStartClaimCatalogItem[] | undefined;
}): HexRoundStartAgentOutputRequest {
  const brief = input.agentOpeningBrief;
  const cardKind: HexRoundStartCardKind = brief.teamSide === "defense" ? "stance" : "challenge";
  const request: HexRoundStartAgentOutputRequest = {
    schemaVersion: 1,
    requestMode: "round_start_agent_output",
    outputLanguage: "zh-CN",
    roundNumber: input.roundOpeningBrief.roundNumber,
    topicTitle: input.roundOpeningBrief.topicTitle,
    cardKind,
    decisionQuestionZh: input.roundOpeningBrief.decisionQuestionZh,
    allowedStance: input.roundOpeningBrief.allowedStance ? [...input.roundOpeningBrief.allowedStance] : undefined,
    requiredEvidenceSchema: input.roundOpeningBrief.requiredEvidenceSchema?.map((item) => ({ ...item })),
    challengePolicyZh: input.roundOpeningBrief.challengePolicyZh,
    claimCatalog: cardKind === "challenge" ? [...(input.claimCatalog ?? [])] : undefined,
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
    outputSchema: cardKind === "stance"
      ? {
          requiredFields: ["cardKind", "stanceCard"],
          optionalFields: ["cardSummaryZh"]
        }
      : {
          requiredFields: ["cardKind", "challengeCard"],
          optionalFields: ["cardSummaryZh"]
        },
    constraints: [
      "这是本 round 的 phase0 结构化投资卡片，不是局内行动。",
      "必须输出一个 JSON object，cardKind 必须等于请求中的 cardKind。",
      cardKind === "stance"
        ? "立场方必须输出 stanceCard，并在 allowedStance 中选择方向，不得被迫证明某个固定方向。"
        : "挑战方必须输出 challengeCard，并且 targetClaimId 必须来自 claimCatalog。",
      "所有 evidenceRefs 只能使用系统输入卡中的 evidenceRefs，不能编造事实编号。",
      "unavailable_observation 只能作为证据缺口、风险边界或 score cap，不得支持正向结论。",
      "缺失证据只能触发置信度上限、score cap 或投影限制，不能写成胜利理由。",
      "每个主张必须有 claimType、evidenceRefs 和 reasoningBridge。",
      "后续 phase 只会引用 claimId 或 challengeId，不能重新写金融作文。",
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
  return (request) => {
    const evidenceRefs = (request.systemInputCard.evidenceRefs ?? []).slice(0, 2);
    if (request.cardKind === "stance") {
      return {
        providerMode: "fixture",
        modelId: "fixture_hex_round_start_agent_output",
        rawDraft: {
          cardKind: "stance",
          stanceCard: {
            cardId: `stance_${request.agent.agentId}`,
            agentId: request.agent.agentId,
            teamSide: request.agent.teamSide,
            decisionQuestionZh: request.decisionQuestionZh ?? request.topicTitle,
            direction: request.allowedStance?.includes("structural") ? "structural" : request.allowedStance?.[0] ?? "neutral",
            target: request.decisionQuestionZh ?? request.topicTitle,
            horizon: "1-3 months",
            confidence: 0.58,
            positionSuggestion: "有限仓位参与，等待缺失证据确认后再扩大配置。",
            coreClaims: [{
              claimId: `claim_${request.agent.agentId}_1`,
              claimType: "commodity_price_signal",
              claimZh: `${request.agent.displayName} 基于可用证据给出有限置信度的有色配置主张。`,
              evidenceRefs,
              reasoningBridge: "证据只能支持对应价格或市场代理，不直接证明完整中国国内供需。",
              confidence: 0.58,
              unsupportedIfEvidenceRejected: true
            }],
            riskBoundaries: [request.systemInputCard.evidenceBoundaryZh],
            invalidatingConditions: ["关键证据继续缺失时只能降权或暂不交易。"],
            auditSummaryZh: `${request.agent.displayName} 输出结构化 stanceCard，引用 ${evidenceRefs.join("、") || "无可用证据"}。`
          },
          cardSummaryZh: `${request.agent.displayName} 的立场卡：有限置信度配置，证据不足时降权。`
        }
      };
    }
    const targetClaim = request.claimCatalog?.[0];
    return {
      providerMode: "fixture",
      modelId: "fixture_hex_round_start_agent_output",
      rawDraft: {
        cardKind: "challenge",
        challengeCard: {
          cardId: `challenge_${request.agent.agentId}`,
          agentId: request.agent.agentId,
          teamSide: request.agent.teamSide,
          targetClaimId: targetClaim?.claimId ?? "missing_claim",
          challengeType: "evidence_gap",
          challengedAssumption: targetClaim?.claimZh ?? "没有可挑战的有效 claim。",
          evidenceRefs,
          proxyMismatch: "代理事实只能支持有限 claim，不能外推成完整行业胜负。",
          confidenceReduction: 0.18,
          challenges: [{
            challengeId: `challenge_${request.agent.agentId}_1`,
            targetClaimId: targetClaim?.claimId ?? "missing_claim",
            challengeType: "evidence_gap",
            evidenceRefs,
            challengeReasonZh: "挑战对方是否把代理事实过度外推；缺失证据只能降权，不能直接赢。",
            expectedEffect: "降低置信度和战斗投影强度。"
          }],
          auditSummaryZh: `${request.agent.displayName} 输出结构化 challengeCard，目标 claim 为 ${targetClaim?.claimId ?? "missing_claim"}。`
        },
        cardSummaryZh: `${request.agent.displayName} 的挑战卡：攻击具体 claim 的证据缺口和代理错配。`
      }
    };
  };
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
        schemaName: request.cardKind === "stance" ? "HexFinanceStanceCardDraft" : "HexFinanceChallengeCardDraft",
        responseFormat: "json_object",
        modelTier: "standard",
        temperature: 0.3,
        maxOutputTokens: 1600,
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

function buildRoundStartJsonExample(request: HexRoundStartAgentOutputRequest): Record<string, unknown> {
  const inputEvidenceRefs = request.systemInputCard.evidenceRefs ?? [];
  const firstEvidenceRef = inputEvidenceRefs[0] ?? "NO_AVAILABLE_EVIDENCE_REF";
  const secondEvidenceRef = inputEvidenceRefs[1] ?? firstEvidenceRef;
  if (request.cardKind === "stance") {
    return {
      cardKind: "stance",
      stanceCard: {
        cardId: `stance_${request.agent.agentId}`,
        agentId: request.agent.agentId,
        teamSide: request.agent.teamSide,
        decisionQuestionZh: request.decisionQuestionZh ?? request.topicTitle,
        direction: request.allowedStance?.[0] ?? "neutral",
        target: request.decisionQuestionZh ?? request.topicTitle,
        horizon: "1-3个月",
        confidence: 0.58,
        positionSuggestion: "有限仓位参与，等待关键缺口确认后再扩大。",
        coreClaims: [{
          claimId: `claim_${request.agent.agentId}_1`,
          claimType: "commodity_price_signal",
          claimZh: "可用证据支持有限强度的有色配置判断。",
          evidenceRefs: [firstEvidenceRef, secondEvidenceRef].filter((ref, index, refs) => ref !== "NO_AVAILABLE_EVIDENCE_REF" && refs.indexOf(ref) === index),
          reasoningBridge: "该证据只能支持对应指标方向，不能直接外推成完整行业胜负。",
          confidence: 0.58,
          unsupportedIfEvidenceRejected: true
        }],
        riskBoundaries: ["关键缺失证据会限制置信度和仓位。"],
        invalidatingConditions: ["证据方向反转或关键缺口持续无法验证。"],
        auditSummaryZh: "本卡片给出证据绑定的有限立场。"
      },
      cardSummaryZh: "结构化 stanceCard：有限立场、证据绑定、缺口降权。"
    };
  }
  const targetClaim = request.claimCatalog?.[0];
  return {
    cardKind: "challenge",
    challengeCard: {
      cardId: `challenge_${request.agent.agentId}`,
      agentId: request.agent.agentId,
      teamSide: request.agent.teamSide,
      targetClaimId: targetClaim?.claimId ?? "COPY_A_REAL_CLAIM_ID_FROM_CLAIM_CATALOG",
      challengeType: "proxy_mismatch",
      challengedAssumption: "对方把代理证据外推到更强结论。",
      evidenceRefs: [firstEvidenceRef].filter((ref) => ref !== "NO_AVAILABLE_EVIDENCE_REF"),
      proxyMismatch: "该证据最多支持局部代理，不能直接支持完整配置结论。",
      confidenceReduction: 0.18,
      challenges: [{
        challengeId: `challenge_${request.agent.agentId}_1`,
        targetClaimId: targetClaim?.claimId ?? "COPY_A_REAL_CLAIM_ID_FROM_CLAIM_CATALOG",
        challengeType: "proxy_mismatch",
        evidenceRefs: [firstEvidenceRef].filter((ref) => ref !== "NO_AVAILABLE_EVIDENCE_REF"),
        challengeReasonZh: "挑战对方 claim 的代理错配或推理桥断裂。",
        expectedEffect: "降低置信度并限制金融投影强度。"
      }],
      auditSummaryZh: "本卡片挑战一个真实 targetClaimId。"
    },
    cardSummaryZh: "结构化 challengeCard：绑定 claimId，攻击证据或推理桥。"
  };
}
export function buildRealHexRoundStartAgentOutputMessages(request: HexRoundStartAgentOutputRequest) {
  const example = buildRoundStartJsonExample(request);
  return [
    {
      role: "system" as const,
      content: [
        "你是 Finance Major 的选手 agent，正在输出 phase0 结构化投资卡片。",
        "这不是局内行动，不要输出地图 cell、击杀、胜负、伤害或经济变化。",
        request.cardKind === "stance"
          ? "你是立场方：必须输出 stanceCard，direction 必须从 allowedStance 里复制一个值；coreClaims 只写 1-2 条。"
          : "你是挑战方：必须输出 challengeCard，只写 1 条 challenge；targetClaimId 必须从 claimCatalog 里原样复制。",
        "输出只能是一个 JSON object，不要 Markdown，不要解释段落，不要包裹代码块。",
        "字段名必须严格使用示例里的英文键名；字段内容使用中文。",
        "所有 evidenceRefs 只能从 systemInputCard.evidenceRefs 中原样选择；不能新增证据编号。",
        "缺失证据只能降权或限制置信度，不是直接胜利。",
        "不要输出超过 2 个 claim，不要写长文；每个中文字段尽量 1 句。",
        "phase1+ 只会引用 claimId 或 challengeId，因此必须提供稳定编号。",
        "严格 JSON 示例如下，真实输出必须替换为本请求里的 agent、claimCatalog 和 evidenceRefs：",
        JSON.stringify(example)
      ].join("\n")
    },
    {
      role: "user" as const,
      content: JSON.stringify(request)
    }
  ];
}

export function normalizeHexRoundStartAgentOutputDraft(
  rawDraft: unknown,
  options?: {
    allowedEvidenceRefs?: readonly string[];
    allowedStance?: readonly string[];
    expectedCardKind?: HexRoundStartCardKind;
    agentId?: string;
    teamSide?: HexSide;
    decisionQuestionZh?: string;
    claimCatalog?: readonly HexRoundStartClaimCatalogItem[];
  }
): {
  draft?: HexRoundStartAgentOutputDraft;
  errors: string[];
  repairedFields: string[];
  ignoredFields: string[];
};
export function normalizeHexRoundStartAgentOutputDraft(
  rawDraft: unknown,
  options: {
    allowedEvidenceRefs?: readonly string[];
    allowedStance?: readonly string[];
    expectedCardKind?: HexRoundStartCardKind;
    agentId?: string;
    teamSide?: HexSide;
    decisionQuestionZh?: string;
    claimCatalog?: readonly HexRoundStartClaimCatalogItem[];
  } = {}
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
  const cardKind = readCardKind(draftObject.cardKind)
    ?? (isRecord(draftObject.stanceCard) ? "stance" : isRecord(draftObject.challengeCard) ? "challenge" : undefined);
  if (!cardKind) {
    return { errors: ["round_start:missing_cardKind"], repairedFields, ignoredFields };
  }
  if (options.expectedCardKind && cardKind !== options.expectedCardKind) {
    errors.push(`round_start:invalid_cardKind:${cardKind}`);
  }
  for (const key of Object.keys(draftObject)) {
    if (!["cardKind", "stanceCard", "challengeCard", "cardSummaryZh"].includes(key)) {
      ignoredFields.push(key);
    }
  }

  const context = {
    allowedEvidenceRefs: new Set(options.allowedEvidenceRefs ?? []),
    allowedStance: new Set(options.allowedStance ?? []),
    claimCatalog: new Map((options.claimCatalog ?? []).map((claim) => [claim.claimId, claim])),
    agentId: options.agentId,
    teamSide: options.teamSide,
    decisionQuestionZh: options.decisionQuestionZh ?? ""
  };
  const cardSummaryZh = readString(draftObject.cardSummaryZh);

  if (cardKind === "stance") {
    const stance = normalizeStanceCard(draftObject.stanceCard, context, errors, repairedFields, cardSummaryZh);
    if (containsGarbledText(cardSummaryZh) || (stance && containsGarbledText(stance.auditSummaryZh))) {
      errors.push("round_start:garbled_text");
    }
    if (errors.length > 0 || !stance) {
      return { errors, repairedFields, ignoredFields };
    }
    const evidenceRefs = uniqueStrings(stance.coreClaims.flatMap((claim) => claim.evidenceRefs));
    return {
      draft: {
        cardKind,
        stanceCard: stance,
        cardSummaryZh: cardSummaryZh || stance.auditSummaryZh,
        evidenceRefs,
        riskBoundaryZh: stance.riskBoundaries.join("；"),
        buyConstraintAppliedZh: "买型裁剪已进入 positionSuggestion 和风险边界，局内不得越过资源约束。",
        phaseActionCarryoverZh: `后续 phase 只能短句引用 claimId：${stance.coreClaims.map((claim) => claim.claimId).join("、")}。`,
        allowedPhaseRefs: {
          claimIds: stance.coreClaims.map((claim) => claim.claimId),
          challengeIds: []
        },
        confidence: stance.confidence
      },
      errors,
      repairedFields,
      ignoredFields
    };
  }

  const challenge = normalizeChallengeCard(draftObject.challengeCard, context, errors, repairedFields, cardSummaryZh);
  if (containsGarbledText(cardSummaryZh) || (challenge && containsGarbledText(challenge.auditSummaryZh))) {
    errors.push("round_start:garbled_text");
  }
  if (errors.length > 0 || !challenge) {
    return { errors, repairedFields, ignoredFields };
  }
  const evidenceRefs = uniqueStrings([
    ...challenge.evidenceRefs,
    ...challenge.challenges.flatMap((item) => item.evidenceRefs)
  ]);
  return {
    draft: {
      cardKind,
      challengeCard: challenge,
      cardSummaryZh: cardSummaryZh || challenge.auditSummaryZh,
      evidenceRefs,
      riskBoundaryZh: challenge.proxyMismatch,
      buyConstraintAppliedZh: "买型裁剪已进入挑战强度，局内不得把挑战扩写成新立场。",
      phaseActionCarryoverZh: `后续 phase 只能短句引用 challengeId：${challenge.challenges.map((item) => item.challengeId).join("、")}。`,
      allowedPhaseRefs: {
        claimIds: [],
        challengeIds: challenge.challenges.map((item) => item.challengeId)
      },
      confidence: 1 - challenge.confidenceReduction
    },
    errors,
    repairedFields,
    ignoredFields
  };
}

function normalizeStanceCard(
  raw: unknown,
  context: NormalizeCardContext,
  errors: string[],
  repairedFields: string[],
  cardSummaryZh = ""
): HexFinanceStanceCard | undefined {
  if (!isRecord(raw)) {
    errors.push("round_start:missing_stanceCard");
    return undefined;
  }
  const direction = readStringField(raw, ["direction", "stance", "investmentDirection"], repairedFields, "repaired_stance_direction");
  if (!direction) {
    errors.push("round_start:missing_stance_direction");
  } else if (context.allowedStance.size > 0 && !context.allowedStance.has(direction)) {
    errors.push(`round_start:invalid_stance_direction:${direction}`);
  }
  const coreClaims = normalizeCoreClaims(raw.coreClaims, context, errors, repairedFields);
  const cardId = readString(raw.cardId) || `stance_${context.agentId ?? "unknown"}`;
  if (!readString(raw.cardId)) {
    repairedFields.push("repaired_missing_stance_cardId");
  }
  let auditSummaryZh = readStringField(raw, ["auditSummaryZh"], repairedFields, "repaired_stance_auditSummaryZh");
  if (!auditSummaryZh && cardSummaryZh) {
    auditSummaryZh = cardSummaryZh;
    repairedFields.push("repaired_stance_auditSummaryZh_from_cardSummaryZh");
  }
  if (!auditSummaryZh) {
    errors.push("round_start:missing_stance_auditSummaryZh");
  }
  const riskBoundaries = readStringArrayField(raw, [
    "riskBoundaries",
    "riskRewardBoundary",
    "evidenceBoundaryApplied",
    "missingEvidenceImpact",
    "scoreCapReason"
  ], repairedFields, "repaired_stance_riskBoundaries");
  const invalidatingConditions = readStringArrayField(raw, [
    "invalidatingConditions",
    "triggerConditions",
    "conditionalTriggers"
  ], repairedFields, "repaired_stance_invalidatingConditions");
  const confidence = readConfidenceField(raw, ["confidence", "confidenceScore"], repairedFields, "repaired_stance_confidence");
  let target = readStringField(raw, ["target", "targetAsset", "decisionTarget"], repairedFields, "repaired_stance_target");
  if (!target && context.decisionQuestionZh) {
    target = context.decisionQuestionZh;
    repairedFields.push("repaired_stance_target_from_decisionQuestion");
  }
  let horizon = readStringField(raw, ["horizon", "timeWindow", "holdingPeriod"], repairedFields, "repaired_stance_horizon");
  if (!horizon && /1\s*[-–—至到]\s*3|1-3/.test(context.decisionQuestionZh)) {
    horizon = "1-3个月";
    repairedFields.push("repaired_stance_horizon_from_decisionQuestion");
  }
  const stance: HexFinanceStanceCard = {
    cardId,
    agentId: readString(raw.agentId) || context.agentId || "unknown",
    teamSide: readSide(raw.teamSide) ?? context.teamSide ?? "defense",
    decisionQuestionZh: readString(raw.decisionQuestionZh) || context.decisionQuestionZh,
    direction,
    target,
    horizon,
    confidence: confidence ?? 0.5,
    positionSuggestion: readStringField(raw, ["positionSuggestion", "positionBoundary", "allocationSuggestion"], repairedFields, "repaired_stance_positionSuggestion"),
    coreClaims,
    riskBoundaries,
    invalidatingConditions,
    auditSummaryZh
  };
  if (!stance.target) errors.push("round_start:missing_stance_target");
  if (!stance.horizon) errors.push("round_start:missing_stance_horizon");
  if (!stance.positionSuggestion) errors.push("round_start:missing_positionSuggestion");
  if (stance.coreClaims.length === 0) errors.push("round_start:missing_coreClaims");
  if (stance.riskBoundaries.length === 0) errors.push("round_start:missing_riskBoundaries");
  if (stance.invalidatingConditions.length === 0) errors.push("round_start:missing_invalidatingConditions");
  return stance;
}
function normalizeCoreClaims(
  raw: unknown,
  context: NormalizeCardContext,
  errors: string[],
  repairedFields: string[]
): HexFinanceCoreClaim[] {
  if (!Array.isArray(raw)) {
    errors.push("round_start:missing_coreClaims");
    return [];
  }
  const seen = new Set<string>();
  return raw.map((item, index) => {
    if (!isRecord(item)) {
      errors.push(`round_start:invalid_coreClaim:${index}`);
      return undefined;
    }
    let claimId = readString(item.claimId);
    if (!claimId || seen.has(claimId)) {
      claimId = `claim_${context.agentId ?? "unknown"}_${index + 1}`;
      repairedFields.push("repaired_coreClaim_claimId");
    }
    seen.add(claimId);
    const evidenceRefs = validateEvidenceRefs(readStringArrayField(item, ["evidenceRefs"], repairedFields, `repaired_coreClaim_evidenceRefs:${claimId}`), context, errors);
    const claimType = readString(item.claimType);
    const claimZh = readStringField(item, ["claimZh", "claimText", "claim", "statementZh"], repairedFields, `repaired_claimZh:${claimId}`);
    const reasoningBridge = readStringField(item, ["reasoningBridge", "reasoning", "bridge"], repairedFields, `repaired_reasoningBridge:${claimId}`);
    if (!claimType) errors.push(`round_start:missing_claimType:${claimId}`);
    if (!claimZh) errors.push(`round_start:missing_claimZh:${claimId}`);
    if (evidenceRefs.length === 0) errors.push(`round_start:missing_claimEvidenceRefs:${claimId}`);
    if (!reasoningBridge) errors.push(`round_start:missing_reasoningBridge:${claimId}`);
    return {
      claimId,
      claimType,
      claimZh,
      evidenceRefs,
      reasoningBridge,
      confidence: readConfidenceField(item, ["confidence", "confidenceScore"], repairedFields, `repaired_claim_confidence:${claimId}`) ?? 0.5,
      unsupportedIfEvidenceRejected: readBoolean(item.unsupportedIfEvidenceRejected) ?? true
    };
  }).filter((claim): claim is HexFinanceCoreClaim => Boolean(claim));
}
function normalizeChallengeCard(
  raw: unknown,
  context: NormalizeCardContext,
  errors: string[],
  repairedFields: string[],
  cardSummaryZh = ""
): HexFinanceChallengeCard | undefined {
  if (!isRecord(raw)) {
    errors.push("round_start:missing_challengeCard");
    return undefined;
  }
  const cardId = readString(raw.cardId) || `challenge_${context.agentId ?? "unknown"}`;
  if (!readString(raw.cardId)) {
    repairedFields.push("repaired_missing_challenge_cardId");
  }
  const targetClaimId = readString(raw.targetClaimId);
  if (!targetClaimId) {
    errors.push("round_start:missing_targetClaimId");
  } else if (!context.claimCatalog.has(targetClaimId)) {
    errors.push(`round_start:invalid_targetClaimId:${targetClaimId}`);
  }
  const evidenceRefs = validateEvidenceRefs(
    readStringArrayField(raw, ["evidenceRefs", "observedEvidence"], repairedFields, "repaired_challenge_evidenceRefs"),
    context,
    errors
  );
  const challengeType = readString(raw.challengeType);
  const challengedAssumption = readStringField(raw, ["challengedAssumption", "inference"], repairedFields, "repaired_challengedAssumption");
  const proxyMismatch = readStringField(raw, ["proxyMismatch", "disconfirmingSignal"], repairedFields, "repaired_proxyMismatch");
  let auditSummaryZh = readStringField(raw, ["auditSummaryZh"], repairedFields, "repaired_challenge_auditSummaryZh");
  if (!auditSummaryZh && cardSummaryZh) {
    auditSummaryZh = cardSummaryZh;
    repairedFields.push("repaired_challenge_auditSummaryZh_from_cardSummaryZh");
  }
  const challenges = normalizeChallenges(raw.challenges, {
    cardTargetClaimId: targetClaimId,
    context,
    errors,
    repairedFields,
    fallbackEvidenceRefs: evidenceRefs,
    fallbackChallengeType: challengeType,
    fallbackChallengeReasonZh: readStringField(raw, ["challengeReasonZh", "inference", "disconfirmingSignal"], repairedFields, "repaired_challengeReasonZh"),
    fallbackExpectedEffect: readStringField(raw, ["expectedEffect", "positionBoundary"], repairedFields, "repaired_expectedEffect")
  });
  const challenge: HexFinanceChallengeCard = {
    cardId,
    agentId: readString(raw.agentId) || context.agentId || "unknown",
    teamSide: readSide(raw.teamSide) ?? context.teamSide ?? "attack",
    targetClaimId,
    challengeType,
    challengedAssumption,
    evidenceRefs,
    proxyMismatch,
    confidenceReduction: readConfidenceField(raw, ["confidenceReduction", "confidenceScore", "confidence"], repairedFields, "repaired_confidenceReduction") ?? 0.15,
    challenges,
    auditSummaryZh
  };
  if (!challenge.challengeType) errors.push("round_start:missing_challengeType");
  if (!challenge.challengedAssumption) errors.push("round_start:missing_challengedAssumption");
  if (challenge.evidenceRefs.length === 0) errors.push("round_start:missing_challengeEvidenceRefs");
  if (!challenge.proxyMismatch) errors.push("round_start:missing_proxyMismatch");
  if (challenge.challenges.length === 0) errors.push("round_start:missing_challenges");
  if (!challenge.auditSummaryZh) errors.push("round_start:missing_challenge_auditSummaryZh");
  return challenge;
}

function normalizeChallenges(
  raw: unknown,
  input: {
    cardTargetClaimId: string;
    context: NormalizeCardContext;
    errors: string[];
    repairedFields: string[];
    fallbackEvidenceRefs: string[];
    fallbackChallengeType: string;
    fallbackChallengeReasonZh: string;
    fallbackExpectedEffect: string;
  }
): HexFinanceChallenge[] {
  if (!Array.isArray(raw)) {
    if (
      input.cardTargetClaimId
      && input.context.claimCatalog.has(input.cardTargetClaimId)
      && input.fallbackChallengeType
      && input.fallbackEvidenceRefs.length > 0
      && input.fallbackChallengeReasonZh
      && input.fallbackExpectedEffect
    ) {
      input.repairedFields.push("repaired_challenges_from_top_level");
      return [{
        challengeId: `challenge_${input.context.agentId ?? "unknown"}_1`,
        targetClaimId: input.cardTargetClaimId,
        challengeType: input.fallbackChallengeType,
        evidenceRefs: [...input.fallbackEvidenceRefs],
        challengeReasonZh: input.fallbackChallengeReasonZh,
        expectedEffect: input.fallbackExpectedEffect
      }];
    }
    input.errors.push("round_start:missing_challenges");
    return [];
  }
  const seen = new Set<string>();
  return raw.map((item, index) => {
    if (!isRecord(item)) {
      input.errors.push(`round_start:invalid_challenge:${index}`);
      return undefined;
    }
    let challengeId = readString(item.challengeId);
    if (!challengeId || seen.has(challengeId)) {
      challengeId = `challenge_${input.context.agentId ?? "unknown"}_${index + 1}`;
      input.repairedFields.push("repaired_challengeId");
    }
    seen.add(challengeId);
    const targetClaimId = readString(item.targetClaimId) || input.cardTargetClaimId;
    if (!targetClaimId || !input.context.claimCatalog.has(targetClaimId)) {
      input.errors.push(`round_start:invalid_challenge_targetClaimId:${targetClaimId || "missing"}`);
    }
    let evidenceRefs = validateEvidenceRefs(
      readStringArrayField(item, ["evidenceRefs", "observedEvidence"], input.repairedFields, `repaired_nested_challenge_evidenceRefs:${challengeId}`),
      input.context,
      input.errors
    );
    if (evidenceRefs.length === 0 && input.fallbackEvidenceRefs.length > 0) {
      evidenceRefs = [...input.fallbackEvidenceRefs];
      input.repairedFields.push(`repaired_nested_challenge_evidenceRefs_from_card:${challengeId}`);
    }
    const challengeType = readString(item.challengeType) || input.fallbackChallengeType;
    const challengeReasonZh = readStringField(item, ["challengeReasonZh", "inference", "disconfirmingSignal"], input.repairedFields, `repaired_nested_challengeReasonZh:${challengeId}`) || input.fallbackChallengeReasonZh;
    const expectedEffect = readStringField(item, ["expectedEffect", "positionBoundary"], input.repairedFields, `repaired_nested_expectedEffect:${challengeId}`) || input.fallbackExpectedEffect;
    if (!challengeType) input.errors.push(`round_start:missing_challengeType:${challengeId}`);
    if (evidenceRefs.length === 0) input.errors.push(`round_start:missing_challengeEvidenceRefs:${challengeId}`);
    if (!challengeReasonZh) input.errors.push(`round_start:missing_challengeReasonZh:${challengeId}`);
    if (!expectedEffect) input.errors.push(`round_start:missing_expectedEffect:${challengeId}`);
    return {
      challengeId,
      targetClaimId,
      challengeType,
      evidenceRefs,
      challengeReasonZh,
      expectedEffect
    };
  }).filter((challenge): challenge is HexFinanceChallenge => Boolean(challenge));
}
function validateEvidenceRefs(refs: string[], context: NormalizeCardContext, errors: string[]): string[] {
  const uniqueRefs = uniqueStrings(refs);
  for (const ref of uniqueRefs) {
    if (!context.allowedEvidenceRefs.has(ref)) {
      errors.push(`round_start:rejected_invalid_round_start_evidence_ref:${ref}`);
    }
  }
  return uniqueRefs;
}

interface NormalizeCardContext {
  allowedEvidenceRefs: ReadonlySet<string>;
  allowedStance: ReadonlySet<string>;
  claimCatalog: ReadonlyMap<string, HexRoundStartClaimCatalogItem>;
  agentId?: string | undefined;
  teamSide?: HexSide | undefined;
  decisionQuestionZh: string;
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
  const cardSummary = draft?.cardSummaryZh ?? effectiveDraft.cardSummaryZh;
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
    usableForPhaseAction: isUsableRoundStartAgentOutputSource(source, input.responseArtifactId, input.normalized.errors, draft),
    requestArtifactId: input.requestArtifactId,
    responseArtifactId: input.responseArtifactId,
    rawOutputSummaryZh: draft
      ? `真实 phase0 ${draft.cardKind === "stance" ? "立场卡" : "挑战卡"}摘要：${truncateText(cardSummary, 220)}`
      : `开局输出未通过规范化：${input.normalized.errors.join("；")}`,
    openingStatementZh: cardSummary,
    evidenceRefs: [...effectiveDraft.evidenceRefs],
    riskBoundaryZh: effectiveDraft.riskBoundaryZh,
    buyConstraintAppliedZh: effectiveDraft.buyConstraintAppliedZh,
    phaseActionCarryoverZh: effectiveDraft.phaseActionCarryoverZh,
    cardKind: draft?.cardKind,
    stanceCard: draft?.stanceCard,
    challengeCard: draft?.challengeCard,
    cardSummaryZh: cardSummary,
    allowedPhaseRefs: draft?.allowedPhaseRefs,
    normalizationSummaryZh: input.normalized.repairedFields.length > 0
      ? `系统修复：${input.normalized.repairedFields.join("；")}`
      : "系统未记录修复。",
    validationSummaryZh: draft ? "phase0 结构化卡片通过校验。" : `phase0 结构化卡片未通过校验：${input.normalized.errors.join("；")}`,
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

function buildInvalidRoundStartOutput(input: {
  request: HexRoundStartAgentOutputRequest;
  requestArtifactId?: string | undefined;
  errors: string[];
  normalizationSummaryZh: string;
  validationSummaryZh: string;
  providerMode?: string | undefined;
  modelId?: string | undefined;
}): HexRoundStartAgentOutput {
  const fallbackDraft = buildFallbackDraft(input.request, input.errors);
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
    source: "invalid_response",
    usableForPhaseAction: false,
    requestArtifactId: input.requestArtifactId,
    rawOutputSummaryZh: input.validationSummaryZh,
    openingStatementZh: fallbackDraft.cardSummaryZh,
    evidenceRefs: [],
    riskBoundaryZh: fallbackDraft.riskBoundaryZh,
    buyConstraintAppliedZh: fallbackDraft.buyConstraintAppliedZh,
    phaseActionCarryoverZh: fallbackDraft.phaseActionCarryoverZh,
    cardSummaryZh: fallbackDraft.cardSummaryZh,
    normalizationSummaryZh: input.normalizationSummaryZh,
    validationSummaryZh: input.validationSummaryZh,
    technicalRefs: {
      errors: [...input.errors],
      repairedFields: [],
      providerMode: input.providerMode,
      modelId: input.modelId
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
    rawOutputSummaryZh: `phase0 真实模型调用失败：${input.message}`,
    openingStatementZh: fallbackDraft.cardSummaryZh,
    evidenceRefs: [],
    riskBoundaryZh: fallbackDraft.riskBoundaryZh,
    buyConstraintAppliedZh: fallbackDraft.buyConstraintAppliedZh,
    phaseActionCarryoverZh: fallbackDraft.phaseActionCarryoverZh,
    cardSummaryZh: fallbackDraft.cardSummaryZh,
    normalizationSummaryZh: "provider 失败，未产生可规范化 phase0 卡片。",
    validationSummaryZh: `phase0 输出失败：${input.message}`,
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
    && output.cardKind
    && output.allowedPhaseRefs
  );
}

function isUsableRoundStartAgentOutputSource(
  source: HexRoundStartAgentOutputSource,
  responseArtifactId: string | undefined,
  errors: readonly string[],
  draft: HexRoundStartAgentOutputDraft | undefined
): boolean {
  if (errors.length > 0 || !draft) {
    return false;
  }
  if (!draft.cardKind || !draft.allowedPhaseRefs) {
    return false;
  }
  if (source === "fixture_response") {
    return true;
  }
  return source === "llm_response_artifact" && Boolean(responseArtifactId);
}

function buildFallbackDraft(request: HexRoundStartAgentOutputRequest, errors: readonly string[]): HexRoundStartAgentOutputDraft {
  return {
    cardKind: request.cardKind,
    cardSummaryZh: `本局没有可采信的真实 phase0 结构化卡片，原因：${errors.join("；") || "unknown"}。后续行动不能把系统输入卡当作 agent 发言。`,
    evidenceRefs: [],
    riskBoundaryZh: "真实 phase0 卡片缺失，裁判只能按后续行动和系统证据边界审计。",
    buyConstraintAppliedZh: request.economy
      ? `买型 ${request.economy.buyType}，资源 ${request.economy.resourceTier}，但本局真实 phase0 卡片缺失。`
      : "经济买型未记录，且真实 phase0 卡片缺失。",
    phaseActionCarryoverZh: "后续 phase 不得用系统输入卡冒充 phase0 真实输出。",
    allowedPhaseRefs: { claimIds: [], challengeIds: [] }
  };
}

export function buildClaimCatalogFromStanceCard(card: HexFinanceStanceCard): HexRoundStartClaimCatalogItem[] {
  return card.coreClaims.map((claim) => ({
    claimId: claim.claimId,
    claimType: claim.claimType,
    claimZh: claim.claimZh,
    stanceAgentId: card.agentId,
    evidenceRefs: [...claim.evidenceRefs],
    reasoningBridge: claim.reasoningBridge
  }));
}

export function collectRoundStartAllowedPhaseRefIds(output: HexRoundStartAgentOutputForAction | undefined): string[] {
  if (!output?.allowedPhaseRefs) {
    return [];
  }
  return [...output.allowedPhaseRefs.claimIds, ...output.allowedPhaseRefs.challengeIds];
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

function readStringField(
  record: Record<string, unknown>,
  keys: readonly string[],
  repairedFields: string[],
  repairPrefix: string
): string {
  for (const [index, key] of keys.entries()) {
    const value = readString(record[key]);
    if (value) {
      if (index > 0) {
        repairedFields.push(`${repairPrefix}_from_${key}`);
      }
      return value;
    }
  }
  return "";
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(readTextValues).map((item) => item.trim()).filter(Boolean);
  }
  return readTextValues(value).map((item) => item.trim()).filter(Boolean);
}

function readStringArrayField(
  record: Record<string, unknown>,
  keys: readonly string[],
  repairedFields: string[],
  repairPrefix: string
): string[] {
  for (const [index, key] of keys.entries()) {
    const values = readStringArray(record[key]);
    if (values.length > 0) {
      if (index > 0) {
        repairedFields.push(`${repairPrefix}_from_${key}`);
      }
      return values;
    }
  }
  return [];
}

function readTextValues(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(readTextValues);
  }
  if (!isRecord(value)) {
    return [];
  }
  return Object.values(value).flatMap((item) => {
    if (typeof item === "string") {
      return [item];
    }
    if (Array.isArray(item)) {
      return item.flatMap(readTextValues);
    }
    return [];
  });
}

function readConfidence(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = value > 1 && value <= 100 ? value / 100 : value;
  return Math.max(0, Math.min(1, normalized));
}

function readConfidenceField(
  record: Record<string, unknown>,
  keys: readonly string[],
  repairedFields: string[],
  repairPrefix: string
): number | undefined {
  for (const [index, key] of keys.entries()) {
    const value = readConfidence(record[key]);
    if (value !== undefined) {
      if (index > 0) {
        repairedFields.push(`${repairPrefix}_from_${key}`);
      }
      return value;
    }
  }
  return undefined;
}
function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readCardKind(value: unknown): HexRoundStartCardKind | undefined {
  return value === "stance" || value === "challenge" ? value : undefined;
}

function readSide(value: unknown): HexSide | undefined {
  return value === "attack" || value === "defense" ? value : undefined;
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

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
