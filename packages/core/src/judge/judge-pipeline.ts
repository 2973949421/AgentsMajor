import type { LlmResponse } from "@agent-major/llm";
import type {
  Agent,
  AgentOutput,
  BuyType,
  DefenderThesisContext,
  EconomyPosture,
  JudgeNarrativeDecision,
  JudgeResult,
  JudgeRubricProfile,
  JudgeVerdictDecision,
  MapGame,
  Match,
  Round,
  ScorePair,
  SideAssignment,
  TacticalCollision,
  Team,
  TeamRoundPlanDecision
} from "@agent-major/shared";

import type { LlmStageRetryMode, LlmStageRunner } from "../llm/llm-stage-runner.js";
import {
  buildJudgePromptContext,
  buildJudgeNarrativeRepairRequest,
  buildJudgeNarrativeRequest,
  buildJudgeReviewRequest,
  buildJudgeVerdictRepairRequest,
  compactJudgeEvaluationOrder
} from "./judge-boundary.js";
import {
  composeJudgeResultFromStages,
  hasDetailedLoserPlanExplanation,
  shouldAttemptJudgeRepair,
  shouldRetryStructuredJsonWithoutThinking,
  shouldUseLocalJudgeNarrativeFallback,
  validateJudgeNarrativeData,
  validateJudgeReviewData,
  validateJudgeVerdictData
} from "./judge-validation.js";

export interface JudgePipelinePromptContext {
  requestInput: Record<string, unknown>;
}

export interface Phase18JudgePromptContext {
  requestInput: {
    sideAssignment: SideAssignment;
    buyTypesByTeam: Record<string, BuyType>;
    economyContextByTeam?: Record<string, { posture: EconomyPosture; lossCount: number; totalCash: number; postureReason: string }>;
    competitiveParityNote?: string | undefined;
    recentPublicRoundRecapPolicy?: string | undefined;
    mapSemanticContext?: Record<string, unknown>;
    judgeRubricContext?: Record<string, unknown>;
    defenderThesisContext?: DefenderThesisContext;
    rubricProfile?: JudgeRubricProfile;
    tacticalCollision?: TacticalCollision;
    evaluationOrder: Array<{
      teamId: string;
      teamName: string;
      activeAgents: Array<{ id: string; role: string }>;
      teamPlan?: TeamRoundPlanDecision;
      initialProposalSummary?: Record<string, unknown>;
      coachContext?: Record<string, unknown>;
    }>;
    teamAId: string;
    teamBId: string;
    teamAName: string;
    teamBName: string;
    activeTeamAAgentIds: string[];
    activeTeamBAgentIds: string[];
    judgeEvidenceDigest: Record<
      string,
      {
        maxItems: number;
        maxEvidencePerItem: number;
        items: Array<{
          agentId: string;
          outputBudget?: number;
          economyPosture?: string;
          omittedFieldCount: number;
          evidence: string[];
        }>;
      }
    >;
    recentPublicRoundSummaries: string[];
  };
  actualTeamPlans?: Record<string, TeamRoundPlanDecision>;
  actualAgentOutputs: AgentOutput[];
  validateAndTranslate(judgeResult: JudgeResult): JudgeResult;
  translatePromptText(value: string): string;
}

export interface JudgePipelineInput {
  judgeRequestInput?: unknown;
  judgePromptContext?: Phase18JudgePromptContext;
  match: Match;
  mapGame: MapGame;
  round: Round;
  roundNumber: number;
  scoreBeforeRound?: ScorePair | undefined;
  observabilityAttempt: number;
  driverModelId: string;
  retryMode?: LlmStageRetryMode | undefined;
  stageRunner: LlmStageRunner;
  sideAssignment: SideAssignment;
  teamA: Team;
  teamB: Team;
  activeA: Agent[];
  activeB: Agent[];
  teamABuyType?: BuyType | undefined;
  teamBBuyType?: BuyType | undefined;
  teamEconomyPlans?: Record<
    string,
    { posture: EconomyPosture; lossCount: number; totalCash: number; postureReason: string }
  > | undefined;
  competitiveParityNote?: string | undefined;
  teamPlans?: Record<string, TeamRoundPlanDecision> | undefined;
  agentOutputs: AgentOutput[];
  tacticalCollision?: TacticalCollision | undefined;
  recentPublicRoundSummaries?: string[] | undefined;
  rubricProfile?: JudgeRubricProfile | undefined;
  scoreTensionGuardrail?: Record<string, unknown> | undefined;
  appliedCoachCorrection?: Record<string, unknown> | undefined;
  teamAInitialProposalSummary?: Record<string, unknown> | undefined;
  teamBInitialProposalSummary?: Record<string, unknown> | undefined;
  teamACoachContext?: Record<string, unknown> | undefined;
  teamBCoachContext?: Record<string, unknown> | undefined;
  mapSemanticContext?: Record<string, unknown> | undefined;
  judgeRubricContext?: Record<string, unknown> | undefined;
  recentWinnerTeamIds: string[];
  useJudgeBiasGuardrail?: boolean | undefined;
}

type PreparedJudgePipelineInput = Omit<JudgePipelineInput, "judgePromptContext" | "judgeRequestInput"> & {
  judgeRequestInput: unknown;
  judgePromptContext: Phase18JudgePromptContext;
};

const llmThinkingDisabledParams = {
  thinking: { type: "disabled" }
} satisfies Record<string, unknown>;

const llmThinkingEnabledParams = {
  thinking: { type: "enabled" },
  reasoning_effort: "high"
} satisfies Record<string, unknown>;

export async function runJudgePipeline(input: JudgePipelineInput): Promise<JudgeResult> {
  const preparedInput = prepareJudgePipelineInput(input);
  const verdictResponse = await generateJudgeVerdict(preparedInput);
  const narrativeResponse = await generateJudgeNarrative(preparedInput, verdictResponse.data);
  const authoritativeJudgeResult = composeJudgeResultFromStages({
    verdict: verdictResponse.data,
    narrative: narrativeResponse.data,
    judgePromptContext: preparedInput.judgePromptContext,
    roundNumber: preparedInput.roundNumber,
    sideAssignment: preparedInput.sideAssignment,
    teamA: preparedInput.teamA,
    teamB: preparedInput.teamB,
    teamPlans: preparedInput.teamPlans,
    agentOutputs: preparedInput.agentOutputs,
    mapSemanticContext: preparedInput.mapSemanticContext
  });
  if (!preparedInput.useJudgeBiasGuardrail) {
    return authoritativeJudgeResult;
  }

  const suspicious = detectSuspiciousJudgeResult({
    judgeResult: authoritativeJudgeResult,
    recentWinnerTeamIds: preparedInput.recentWinnerTeamIds,
    teamA: preparedInput.teamA,
    teamB: preparedInput.teamB,
    teamPlans: preparedInput.teamPlans
  });
  if (!suspicious) {
    return authoritativeJudgeResult;
  }

  return reviewSuspiciousJudgeResult(preparedInput, authoritativeJudgeResult, suspicious);
}

function prepareJudgePipelineInput(input: JudgePipelineInput): PreparedJudgePipelineInput {
  if (input.judgePromptContext && input.judgeRequestInput) {
    return { ...input, judgePromptContext: input.judgePromptContext, judgeRequestInput: input.judgeRequestInput };
  }
  if (!input.scoreBeforeRound || !input.teamABuyType || !input.teamBBuyType || !input.teamEconomyPlans) {
    throw new Error("JudgePipeline requires score, buy types, and economy plans when prompt context is not prebuilt.");
  }
  const judgePromptContext = buildJudgePromptContext({
    roundNumber: input.roundNumber,
    sideAssignment: input.sideAssignment,
    teamA: input.teamA,
    teamB: input.teamB,
    activeA: input.activeA,
    activeB: input.activeB,
    teamABuyType: input.teamABuyType,
    teamBBuyType: input.teamBBuyType,
    teamEconomyPlans: input.teamEconomyPlans,
    competitiveParityNote: input.competitiveParityNote,
    mapSemanticContext: input.mapSemanticContext,
    ...(input.teamPlans ? { teamPlans: input.teamPlans } : {}),
    agentOutputs: input.agentOutputs,
    ...(input.tacticalCollision ? { tacticalCollision: input.tacticalCollision } : {}),
    recentPublicRoundSummaries: input.recentPublicRoundSummaries ?? [],
    ...(input.rubricProfile ? { rubricProfile: input.rubricProfile } : {}),
    ...(input.teamAInitialProposalSummary ? { teamAInitialProposalSummary: input.teamAInitialProposalSummary } : {}),
    ...(input.teamBInitialProposalSummary ? { teamBInitialProposalSummary: input.teamBInitialProposalSummary } : {}),
    ...(input.teamACoachContext ? { teamACoachContext: input.teamACoachContext } : {}),
    ...(input.teamBCoachContext ? { teamBCoachContext: input.teamBCoachContext } : {})
  });
  const judgeRequestInput = {
    objective: "Judge this round from both teams' plans and player actions without team-order, fame, or score-lead bias.",
    roundId: input.round.id,
    roundNumber: input.roundNumber,
    mapName: input.mapGame.mapName,
    scoreBeforeRound: input.scoreBeforeRound,
    mapSemanticContext: compactMapSemanticContext(input.mapSemanticContext),
    judgeRubricContext: compactJudgeRubricContext(input.judgeRubricContext),
    ...(input.scoreTensionGuardrail ? { scoreTensionGuardrail: input.scoreTensionGuardrail } : {}),
    ...(input.appliedCoachCorrection ? { appliedCoachCorrection: input.appliedCoachCorrection } : {}),
    ...judgePromptContext.requestInput,
    evaluationOrder: compactJudgeEvaluationOrder(judgePromptContext.requestInput.evaluationOrder),
    recentPublicRoundSummaries: judgePromptContext.requestInput.recentPublicRoundSummaries
      .slice(-2)
      .map((summary) => truncatePromptText(summary, 140))
  };
  return { ...input, judgePromptContext, judgeRequestInput };
}

async function generateJudgeVerdict(input: PreparedJudgePipelineInput): Promise<LlmResponse<JudgeVerdictDecision>> {
  const validateResponseData = (data: unknown) =>
    validateJudgeVerdictData({
      data,
      judgePromptContext: input.judgePromptContext,
      mapGame: input.mapGame,
      roundNumber: input.roundNumber
    });

  try {
    return await input.stageRunner.runStructuredStage<JudgeVerdictDecision>({
      callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_judge_verdict`,
      stageId: "judge_verdict",
      retryMode: input.retryMode,
      attemptNumber: input.observabilityAttempt,
      task: "judge_verdict",
      schemaName: "JudgeVerdictDecision",
      driverModelId: input.driverModelId,
      requestInput: input.judgeRequestInput,
      responseFormat: "json_object",
      seed: `judge_verdict:${input.round.id}`,
      modelTier: "cheap",
      temperature: 0,
      maxOutputTokens: 2200,
      extraParams: llmThinkingEnabledParams,
      match: input.match,
      mapGame: input.mapGame,
      round: input.round,
      roundNumber: input.roundNumber,
      validateResponseData
    });
  } catch (error) {
    const validationError = error instanceof Error ? error.message : String(error);
    if (shouldRetryStructuredJsonWithoutThinking(validationError)) {
      return input.stageRunner.runStructuredStage<JudgeVerdictDecision>({
        callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_judge_verdict_no_thinking`,
        stageId: "judge_verdict",
        retryMode: input.retryMode,
        attemptNumber: input.observabilityAttempt,
        task: "judge_verdict",
        schemaName: "JudgeVerdictDecision",
        driverModelId: input.driverModelId,
        requestInput: input.judgeRequestInput,
        responseFormat: "json_object",
        seed: `judge_verdict_no_thinking:${input.round.id}`,
        modelTier: "cheap",
        temperature: 0,
        maxOutputTokens: 2200,
        extraParams: llmThinkingDisabledParams,
        match: input.match,
        mapGame: input.mapGame,
        round: input.round,
        roundNumber: input.roundNumber,
        validateResponseData
      });
    }
    if (!shouldAttemptJudgeRepair(validationError)) {
      throw error;
    }
    return input.stageRunner.runStructuredStage<JudgeVerdictDecision>({
      callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_judge_verdict_repair`,
      stageId: "judge_verdict:repair",
      retryMode: input.retryMode,
      attemptNumber: input.observabilityAttempt,
      task: "judge_verdict",
      schemaName: "JudgeVerdictDecision",
      driverModelId: input.driverModelId,
      requestInput: buildJudgeVerdictRepairRequest({
        validationError,
        judgeRequestInput: input.judgeRequestInput,
        judgePromptContext: input.judgePromptContext,
        mapGame: input.mapGame,
        round: input.round,
        roundNumber: input.roundNumber
      }),
      responseFormat: "json_object",
      seed: `judge_verdict_repair:${input.round.id}`,
      modelTier: "cheap",
      temperature: 0,
      maxOutputTokens: 2200,
      extraParams: llmThinkingDisabledParams,
      match: input.match,
      mapGame: input.mapGame,
      round: input.round,
      roundNumber: input.roundNumber,
      validateResponseData
    });
  }
}

async function generateJudgeNarrative(
  input: PreparedJudgePipelineInput,
  verdict: JudgeVerdictDecision
): Promise<LlmResponse<JudgeNarrativeDecision>> {
  const validateResponseData = (data: unknown) =>
    validateJudgeNarrativeData({
      data,
      verdict,
      judgePromptContext: input.judgePromptContext
    });
  const requestInput = buildJudgeNarrativeRequest({
    verdict,
    judgeRequestInput: input.judgeRequestInput,
    mapSemanticContext: input.mapSemanticContext,
    judgeRubricContext: input.judgeRubricContext
  });

  try {
    return await input.stageRunner.runStructuredStage<JudgeNarrativeDecision>({
      callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_judge_narrative`,
      stageId: "judge_narrative",
      retryMode: input.retryMode,
      attemptNumber: input.observabilityAttempt,
      task: "judge_narrative",
      schemaName: "JudgeNarrativeDecision",
      driverModelId: input.driverModelId,
      requestInput,
      responseFormat: "json_object",
      seed: `judge_narrative:${input.round.id}`,
      modelTier: "cheap",
      temperature: 0,
      maxOutputTokens: 1600,
      extraParams: llmThinkingDisabledParams,
      match: input.match,
      mapGame: input.mapGame,
      round: input.round,
      roundNumber: input.roundNumber,
      validateResponseData
    });
  } catch (error) {
    const validationError = error instanceof Error ? error.message : String(error);
    const repairable = shouldAttemptJudgeRepair(validationError);
    if (!repairable && !shouldUseLocalJudgeNarrativeFallback(validationError)) {
      throw error;
    }
    if (repairable) {
      try {
        return await input.stageRunner.runStructuredStage<JudgeNarrativeDecision>({
          callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_judge_narrative_repair`,
          stageId: "judge_narrative:repair",
          retryMode: input.retryMode,
          attemptNumber: input.observabilityAttempt,
          task: "judge_narrative",
          schemaName: "JudgeNarrativeDecision",
          driverModelId: input.driverModelId,
          requestInput: buildJudgeNarrativeRepairRequest({ requestInput, validationError }),
          responseFormat: "json_object",
          seed: `judge_narrative_repair:${input.round.id}`,
          modelTier: "cheap",
          temperature: 0,
          maxOutputTokens: 1600,
          extraParams: llmThinkingDisabledParams,
          match: input.match,
          mapGame: input.mapGame,
          round: input.round,
          roundNumber: input.roundNumber,
          validateResponseData
        });
      } catch (repairError) {
        const repairMessage = repairError instanceof Error ? repairError.message : String(repairError);
        if (!shouldUseLocalJudgeNarrativeFallback(validationError) && !shouldUseLocalJudgeNarrativeFallback(repairMessage)) {
          throw repairError;
        }
      }
    }

    return buildLocalJudgeNarrativeFallbackResponse({
      verdict,
      roundNumber: input.roundNumber,
      mapName: input.mapGame.mapName,
      validationError
    });
  }
}

async function reviewSuspiciousJudgeResult(
  input: PreparedJudgePipelineInput,
  originalJudgeResult: JudgeResult,
  guardrailReason: string
): Promise<JudgeResult> {
  const response = await input.stageRunner.runStructuredStage<JudgeResult>({
    callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_judge_review`,
    stageId: "judge_review",
    retryMode: input.retryMode,
    attemptNumber: input.observabilityAttempt,
    task: "judge_review",
    schemaName: "JudgeResult",
    driverModelId: input.driverModelId,
    requestInput: buildJudgeReviewRequest({
      originalJudgeResult,
      guardrailReason,
      judgeRequestInput: input.judgeRequestInput,
      mapSemanticContext: input.mapSemanticContext,
      judgeRubricContext: input.judgeRubricContext
    }),
    responseFormat: "json_object",
    seed: `judge_review:${input.round.id}`,
    modelTier: "cheap",
    temperature: 0,
    maxOutputTokens: 1100,
    match: input.match,
    mapGame: input.mapGame,
    round: input.round,
    roundNumber: input.roundNumber,
    validateResponseData: (data) =>
      validateJudgeReviewData({
        data,
        guardrailReason,
        judgePromptContext: input.judgePromptContext,
        roundNumber: input.roundNumber,
        sideAssignment: input.sideAssignment,
        teamA: input.teamA,
        teamB: input.teamB,
        teamPlans: input.teamPlans,
        mapSemanticContext: input.mapSemanticContext
      })
  });
  return response.data;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function buildLocalJudgeNarrativeFallbackResponse(input: {
  verdict: JudgeVerdictDecision;
  roundNumber: number;
  mapName: string;
  validationError: string;
}): LlmResponse<JudgeNarrativeDecision> {
  const narrative = normalizeJudgeNarrativeDecisionForVerdict(buildLocalJudgeNarrativeFallback(input), input.verdict);
  validateJudgeNarrativeAgainstVerdict(narrative, input.verdict);
  const rawText = JSON.stringify(narrative);
  return {
    data: narrative,
    rawText,
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    },
    providerDiagnostics: {
      finishReason: "local_fallback",
      contentLength: rawText.length,
      reasoningContentLength: 0,
      emptyContentWithReasoning: false,
      providerResponseShape: "local_judge_narrative_fallback"
    }
  };
}

function buildLocalJudgeNarrativeFallback(input: {
  verdict: JudgeVerdictDecision;
  roundNumber: number;
  mapName: string;
  validationError: string;
}): JudgeNarrativeDecision {
  const verdict = input.verdict;
  const winTypeText = describeJudgeRoundWinTypeForNarrative(verdict.roundWinType);
  const decisiveEvidence = truncatePromptText(verdict.diagnostic.decisiveEvidence, 180) || "裁判已锁定的维度证据";
  const defendedCore = truncatePromptText(verdict.diagnostic.defendedCoreProposition, 160) || "守方核心命题";
  const attackedGap = truncatePromptText(verdict.diagnostic.attackedOpportunityGap, 160) || "攻防机会缺口";
  const zoneText = `${verdict.diagnostic.mainAttackZoneId} / ${verdict.diagnostic.mainDefenseZoneId}`;
  const reason = `${input.mapName} 第 ${input.roundNumber} 回合，${verdict.winnerTeamId} 以${winTypeText}取胜。关键证据是：${decisiveEvidence}。${verdict.loserTeamId} 失败在于没有充分回应：${defendedCore}，也未能处理 ${attackedGap}。`;

  return {
    reason,
    judgeInference: {
      source: "judge_inference",
      boundary: "以下战斗和结果描述是裁判根据已锁定 verdict、区域关系、队伍计划和行动摘要作出的推断，不是 agent_action 原始事实。",
      csResolution: `${verdict.winnerTeamId} 以${winTypeText}完成本回合结算，MVP 为 ${verdict.mvpAgentId}。`,
      combatNarrative: `裁判推断本回合主要交汇区域为 ${zoneText}；胜负依据来自已锁定的 decisiveEvidence 与 scorecard 摘要，而不是重新改判。`,
      evidenceBasis: [
        `locked_verdict:${verdict.winnerTeamId}`,
        `round_win_type:${verdict.roundWinType}`,
        `main_zones:${zoneText}`,
        `fallback_reason:${truncatePromptText(input.validationError, 80)}`
      ]
    }
  };
}

function describeJudgeRoundWinTypeForNarrative(roundWinType: JudgeVerdictDecision["roundWinType"]): string {
  switch (roundWinType) {
    case "attack_elimination":
      return "攻方收束";
    case "attack_bomb_explosion":
      return "攻方目标完成";
    case "defense_elimination":
      return "守方收束";
    case "defense_timeout_no_plant":
      return "守方拖住目标推进";
    case "defense_defuse":
      return "守方回收目标";
  }
}

function validateJudgeNarrativeAgainstVerdict(narrative: JudgeNarrativeDecision, verdict: JudgeVerdictDecision): void {
  const combined = `${narrative.reason}\n${narrative.judgeInference.csResolution}\n${narrative.judgeInference.combatNarrative}`;
  if (!hasJudgeInferenceBoundaryMarker(narrative.judgeInference.boundary)) {
    throw new Error("Judge narrative judgeInference.boundary must mark combat details as judge inference.");
  }
  if (
    verdict.roundWinType !== "attack_bomb_explosion" &&
    verdict.roundWinType !== "defense_defuse" &&
    /(成功下包|完成下包|炸弹爆炸|引爆|拆包成功|完成拆包)/.test(combined)
  ) {
    throw new Error(`Judge narrative bomb wording conflicts with roundWinType ${verdict.roundWinType}.`);
  }
}

function normalizeJudgeNarrativeDecisionForVerdict(
  narrative: JudgeNarrativeDecision,
  verdict: JudgeVerdictDecision
): JudgeNarrativeDecision {
  const sanitizeText = (value: string) => sanitizeNarrativeTextForRoundWinType(value, verdict.roundWinType);
  return {
    reason: sanitizeText(narrative.reason),
    judgeInference: {
      source: "judge_inference",
      boundary: sanitizeText(narrative.judgeInference.boundary.trim()),
      csResolution: sanitizeText(narrative.judgeInference.csResolution),
      combatNarrative: sanitizeText(narrative.judgeInference.combatNarrative),
      evidenceBasis: narrative.judgeInference.evidenceBasis.map((item) => sanitizeText(item)).filter((item) => item.length > 0)
    }
  };
}

function hasJudgeInferenceBoundaryMarker(value: string): boolean {
  return /(裁判.{0,16}推断|judge inference|合理推断|逻辑推断|反向推导|推导|结算层|不是\s*agent_action|非\s*agent_action|并非\s*agent_action|不是原始事实|非原始事实|非原始行动事实|未在输入中直接提供|未直接提供)/i.test(value);
}

function sanitizeNarrativeTextForRoundWinType(value: string, roundWinType: JudgeVerdictDecision["roundWinType"]): string {
  if (roundWinType === "attack_bomb_explosion" || roundWinType === "defense_defuse") {
    return value;
  }
  return value
    .replace(/([AB])\s*点下包成功/g, "$1 点控制成功")
    .replace(/下包成功|成功下包|完成下包/g, "包点控制")
    .replace(/炸弹爆炸|成功引爆|引爆成功/g, "回合收束")
    .replace(/拆包成功|完成拆包/g, "防守收束");
}

function truncatePromptText(value: unknown, maxLength: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
}

function compactMapSemanticContext(context: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!context) {
    return undefined;
  }
  const proposition = readUnknownRecord(context.proposition);
  const displayZoneNames = readUnknownRecord(proposition?.displayZoneNames);
  return removeUndefined({
    proposition: removeUndefined({
      mapTheme: pickString(proposition, "mapTheme"),
      coreQuestion: truncateOptionalPromptText(pickString(proposition, "coreQuestion"), 180),
      attackFocus: pickStringArray(proposition, "attackFocus").slice(0, 4),
      defenseFocus: pickStringArray(proposition, "defenseFocus").slice(0, 4),
      regulationRoundThemes: compactRoundThemes(proposition?.regulationRoundThemes),
      overtimeRoundThemes: compactRoundThemes(proposition?.overtimeRoundThemes),
      displayZoneNames: displayZoneNames
        ? Object.fromEntries(Object.entries(displayZoneNames).filter(([, value]) => typeof value === "string").slice(0, 8))
        : undefined
    })
  });
}

function compactJudgeRubricContext(context: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!context) {
    return undefined;
  }
  return removeUndefined({
    coreJudgmentAxis: pickString(context, "coreJudgmentAxis"),
    reasonMustCover: pickStringArray(context, "reasonMustCover").slice(0, 4),
    biasGuardrails: pickStringArray(context, "biasGuardrails").slice(0, 4)
  });
}

function compactRoundThemes(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const themes = value
    .map((item) => {
      const entry = readUnknownRecord(item);
      if (!entry) {
        return undefined;
      }
      const compacted: Record<string, unknown> = removeUndefined({
        round: pickString(entry, "round"),
        theme: truncateOptionalPromptText(pickString(entry, "theme"), 100)
      });
      return Object.keys(compacted).length > 0 ? compacted : undefined;
    })
    .filter((item): item is Record<string, unknown> => Boolean(item));
  return themes.length > 0 ? themes.slice(0, 8) : undefined;
}

function truncateOptionalPromptText(value: string | undefined, maxLength: number): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
}

function pickString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function pickStringArray(record: Record<string, unknown> | undefined, key: string): string[] {
  const value = record?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readUnknownRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function removeUndefined<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}

function detectSuspiciousJudgeResult(input: {
  judgeResult: JudgeResult;
  recentWinnerTeamIds: string[];
  teamA: Team;
  teamB: Team;
  teamPlans?: Record<string, TeamRoundPlanDecision> | undefined;
}): string | null {
  const recentWinners = input.recentWinnerTeamIds.slice(-3);
  const sameTeamWonRecentRounds = recentWinners.length >= 3 && recentWinners.every((teamId) => teamId === input.judgeResult.winnerTeamId);
  if (!sameTeamWonRecentRounds || input.judgeResult.confidence < 0.8) {
    return null;
  }

  const loserTeam = input.judgeResult.loserTeamId === input.teamA.id ? input.teamA : input.teamB;
  const loserPlan = input.teamPlans?.[loserTeam.id];
  if (
    loserPlan &&
    hasDetailedLoserPlanExplanation(input.judgeResult.reason, loserTeam, loserPlan)
  ) {
    return null;
  }

  return `same team ${input.judgeResult.winnerTeamId} is extending a 3-round streak with high confidence but the reason does not specifically explain ${loserTeam.displayName}'s failed plan`;
}
