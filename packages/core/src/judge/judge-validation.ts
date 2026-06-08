import {
  judgeNarrativeDecisionSchema,
  judgeResultSchema,
  judgeVerdictDecisionSchema,
  type AgentOutput,
  type DefenderThesisContext,
  type JudgeNarrativeDecision,
  type JudgeResult,
  type JudgeRoundWinType,
  type JudgeRubricProfile,
  type JudgeVerdictDecision,
  type MapGame,
  type SideAssignment,
  type Team,
  type TeamRoundPlanDecision
} from "@agent-major/shared";

import { normalizeKnownTacticalZoneId, sanitizeLlmPayload } from "../llm/llm-output-normalizer.js";
import {
  buildDeterministicJudgeScorecard,
  materializeJudgeVerdictScorecardPayload as materializeJudgeVerdictScorecardPayloadFromModule,
  normalizeJudgeResultMarginForReason
} from "./judge-scorecard-materializer.js";
import { translateJudgePromptError } from "./judge-boundary.js";
import type { Phase18JudgePromptContext } from "./judge-pipeline.js";

export function validateJudgeVerdictData(input: {
  data: unknown;
  judgePromptContext: Phase18JudgePromptContext;
  mapGame: MapGame;
  roundNumber: number;
}): JudgeVerdictDecision {
  try {
    const mapSemanticContext = input.judgePromptContext.requestInput.mapSemanticContext;
    const normalizedPayload = materializeJudgeVerdictPayload({
      payload: normalizeJudgeVerdictPayload(sanitizeLlmPayload(input.data)),
      teamAId: input.judgePromptContext.requestInput.teamAId,
      teamBId: input.judgePromptContext.requestInput.teamBId,
      activeTeamAAgentIds: input.judgePromptContext.requestInput.activeTeamAAgentIds,
      activeTeamBAgentIds: input.judgePromptContext.requestInput.activeTeamBAgentIds,
      sideAssignment: input.judgePromptContext.requestInput.sideAssignment,
      defenderThesisContext: input.judgePromptContext.requestInput.defenderThesisContext,
      roundNumber: input.roundNumber,
      ...(mapSemanticContext ? { mapSemanticContext } : {}),
      ...(input.judgePromptContext.requestInput.rubricProfile
        ? { rubricProfile: input.judgePromptContext.requestInput.rubricProfile }
        : {})
    });
    const legacyRecord = readUnknownRecord(normalizedPayload);
    if (legacyRecord && !legacyRecord.diagnostic) {
      throw new Error("Judge diagnostic is required.");
    }
    const parsedVerdict = judgeVerdictDecisionSchema.parse(normalizedPayload);
    const verdict = {
      ...parsedVerdict,
      ...(typeof legacyRecord?.reason === "string" ? { reason: legacyRecord.reason } : {}),
      ...(legacyRecord?.judgeInference ? { judgeInference: legacyRecord.judgeInference } : {})
    } as JudgeVerdictDecision;
    validateJudgeVerdictDecision({
      verdict,
      teamAId: input.judgePromptContext.requestInput.teamAId,
      teamBId: input.judgePromptContext.requestInput.teamBId,
      activeTeamAAgentIds: input.judgePromptContext.requestInput.activeTeamAAgentIds,
      activeTeamBAgentIds: input.judgePromptContext.requestInput.activeTeamBAgentIds,
      sideAssignment: input.judgePromptContext.requestInput.sideAssignment
    });
    return verdict;
  } catch (error) {
    throw translateJudgePromptError(error, input.judgePromptContext);
  }
}

export function validateJudgeNarrativeData(input: {
  data: unknown;
  verdict: JudgeVerdictDecision;
  judgePromptContext: Phase18JudgePromptContext;
}): JudgeNarrativeDecision {
  try {
    const narrative = normalizeJudgeNarrativeDecisionForVerdict(
      judgeNarrativeDecisionSchema.parse(normalizeJudgeNarrativePayload(sanitizeLlmPayload(input.data))),
      input.verdict
    );
    validateJudgeNarrativeAgainstVerdict(narrative, input.verdict);
    return narrative;
  } catch (error) {
    throw translateJudgePromptError(error, input.judgePromptContext);
  }
}

export function composeJudgeResultFromStages(input: {
  verdict: JudgeVerdictDecision;
  narrative: JudgeNarrativeDecision;
  judgePromptContext: Phase18JudgePromptContext;
  roundNumber: number;
  sideAssignment: SideAssignment;
  teamA: Team;
  teamB: Team;
  teamPlans?: Record<string, TeamRoundPlanDecision> | undefined;
  agentOutputs: AgentOutput[];
  mapSemanticContext?: Record<string, unknown> | undefined;
}): JudgeResult {
  try {
    const promptJudgeResult = judgeResultSchema.parse({
      ...input.verdict,
      reason: buildStagedJudgeReason(input.verdict, input.narrative),
      judgeInference: input.narrative.judgeInference
    }) as JudgeResult;
    const translatedJudgeResult = input.judgePromptContext.validateAndTranslate(promptJudgeResult);
    const stagedJudgeResult = normalizeJudgeResultMarginForReason(
      normalizeStagedJudgeResultForCommit(translatedJudgeResult, {
        teamA: input.teamA,
        teamB: input.teamB
      })
    );
    validateJudgeResult({
      judgeResult: stagedJudgeResult,
      teamA: input.teamA,
      teamB: input.teamB,
      sideAssignment: input.sideAssignment,
      ...(input.teamPlans ? { teamPlans: input.teamPlans } : {}),
      agentOutputs: input.agentOutputs
    });
    return normalizeJudgeResultMarginForReason(stagedJudgeResult);
  } catch (error) {
    throw translateJudgePromptError(error, input.judgePromptContext);
  }
}

export function validateJudgeReviewData(input: {
  data: unknown;
  guardrailReason: string;
  judgePromptContext: Phase18JudgePromptContext;
  roundNumber: number;
  sideAssignment: SideAssignment;
  teamA: Team;
  teamB: Team;
  teamPlans?: Record<string, TeamRoundPlanDecision> | undefined;
  mapSemanticContext?: Record<string, unknown> | undefined;
}): JudgeResult {
  try {
    const translatedJudgeResult = input.judgePromptContext.validateAndTranslate(
      judgeResultSchema.parse(normalizeJudgeResultPayload(sanitizeLlmPayload(input.data)))
    );
    const reviewedJudgeResult = normalizeLegacyJudgeScorecardForReview(translatedJudgeResult, {
      sideAssignment: input.sideAssignment,
      teamAId: input.teamA.id,
      teamBId: input.teamB.id,
      ...(input.judgePromptContext.requestInput.rubricProfile
        ? { rubricProfile: input.judgePromptContext.requestInput.rubricProfile }
        : {})
    });
    validateJudgeResult({
      judgeResult: reviewedJudgeResult,
      teamA: input.teamA,
      teamB: input.teamB,
      sideAssignment: input.sideAssignment,
      ...(input.teamPlans ? { teamPlans: input.teamPlans } : {}),
      agentOutputs: input.judgePromptContext.actualAgentOutputs
    });
    const loserTeam = reviewedJudgeResult.loserTeamId === input.teamA.id ? input.teamA : input.teamB;
    const loserPlan = input.teamPlans?.[loserTeam.id];
    if (!loserPlan || !hasDetailedLoserPlanExplanation(reviewedJudgeResult.reason, loserTeam, loserPlan)) {
      throw new Error(`Judge review failed anti-bias guardrail: ${input.guardrailReason}`);
    }
    return reviewedJudgeResult;
  } catch (error) {
    throw translateJudgePromptError(error, input.judgePromptContext);
  }
}

export function validatePromptJudgeResult(input: {
  judgeResult: JudgeResult;
  teamA: Team;
  teamB: Team;
  activeA: Array<{ id: string }>;
  activeB: Array<{ id: string }>;
  sideAssignment: SideAssignment;
  teamPlans?: Record<string, TeamRoundPlanDecision> | undefined;
}): JudgeResult {
  validateJudgeWinSemantics(input.judgeResult, input.sideAssignment);
  if (![input.teamA.id, input.teamB.id].includes(input.judgeResult.winnerTeamId)) {
    throw new Error(`Judge returned an invalid winnerTeamId: ${input.judgeResult.winnerTeamId}`);
  }
  const expectedLoserTeamId = input.judgeResult.winnerTeamId === input.teamA.id ? input.teamB.id : input.teamA.id;
  if (input.judgeResult.loserTeamId !== expectedLoserTeamId) {
    throw new Error(`Judge returned an invalid loserTeamId: ${input.judgeResult.loserTeamId}`);
  }
  const winnerAgentIds = new Set(
    (input.judgeResult.winnerTeamId === input.teamA.id ? input.activeA : input.activeB).map((agent) => agent.id)
  );
  if (!winnerAgentIds.has(input.judgeResult.mvpAgentId)) {
    throw new Error(`Judge returned an invalid mvpAgentId: ${input.judgeResult.mvpAgentId}`);
  }
  if (!input.judgeResult.diagnostic) {
    throw new Error("Judge diagnostic is required for Phase 2.0-pre real LLM rounds.");
  }
  if (input.teamPlans) {
    const winnerTeam = input.judgeResult.winnerTeamId === input.teamA.id ? input.teamA : input.teamB;
    const loserTeam = input.judgeResult.loserTeamId === input.teamA.id ? input.teamA : input.teamB;
    const winnerPlan = input.teamPlans[winnerTeam.id];
    const loserPlan = input.teamPlans[loserTeam.id];
    if (!winnerPlan || !loserPlan) {
      throw new Error("Judge validation requires both Phase 1.8 team plans.");
    }
    if (!hasWinnerAndLoserPlanExplanation(input.judgeResult.reason, winnerTeam, loserTeam, winnerPlan, loserPlan)) {
      throw new Error(
        `Judge reason must explain how ${winnerTeam.displayName} succeeded and how ${loserTeam.displayName} failed.`
      );
    }
  }
  return input.judgeResult;
}

export function shouldAttemptJudgeRepair(errorMessage: string): boolean {
  return /does not parse as JSON|invalid_enum_value|Expected array, received object|Expected string, received object|required|missing|diagnostic|decisiveEvidence|zoneRelation|roundWinType|judgeScorecard|rubricProfile|winnerFromScore|marginFromScore|totalScore/i.test(errorMessage);
}

export function shouldUseLocalJudgeNarrativeFallback(errorMessage: string): boolean {
  return /reasoning_exhausted_empty_content|provider_empty_content|json_truncated|does not parse as JSON|invalid_response/i.test(
    errorMessage
  );
}

export function shouldRetryStructuredJsonWithoutThinking(errorMessage: string): boolean {
  return /reasoning_exhausted_empty_content|provider_empty_content|json_truncated/i.test(errorMessage);
}

export function hasDetailedLoserPlanExplanation(reason: string, loserTeam: Team, loserPlan: TeamRoundPlanDecision): boolean {
  const normalizedReason = normalizeForJudgeReason(reason);
  if (!mentionsTeam(normalizedReason, loserTeam) || !containsAny(normalizedReason, LOSER_EXPLANATION_CUES)) {
    return false;
  }

  const specificPlanKeywords = extractSpecificPlanKeywords(loserPlan, loserTeam);
  return specificPlanKeywords.some((keyword) => normalizedReason.includes(keyword));
}

function materializeJudgeVerdictPayload(input: {
  payload: unknown;
  rubricProfile?: JudgeRubricProfile;
  defenderThesisContext?: DefenderThesisContext | undefined;
  teamAId: string;
  teamBId: string;
  activeTeamAAgentIds: string[];
  activeTeamBAgentIds: string[];
  sideAssignment: SideAssignment;
  roundNumber: number;
  mapSemanticContext?: Record<string, unknown> | undefined;
}): unknown {
  const record = readUnknownRecord(input.payload);
  if (!record) {
    return input.payload;
  }
  const winnerTeamId = materializeJudgeTeamId(record.winnerTeamId ?? record.winnerPromptTeamId, input) ?? materializeJudgeTeamId(record.winner, input);
  const loserTeamId =
    materializeJudgeTeamId(record.loserTeamId ?? record.loserPromptTeamId, input) ??
    (winnerTeamId === input.teamAId ? input.teamBId : winnerTeamId === input.teamBId ? input.teamAId : undefined);
  const winnerActiveAgentIds = winnerTeamId === input.teamAId ? input.activeTeamAAgentIds : winnerTeamId === input.teamBId ? input.activeTeamBAgentIds : [];
  const roundWinType = normalizeJudgeRoundWinType(record.roundWinType) ?? inferJudgeRoundWinTypeFromWinner(winnerTeamId, input.sideAssignment);
  const margin = normalizeJudgeMargin(record.margin) ?? "standard";
  const draftLike = isJudgeVerdictDraftLike(record);
  const materializedDiagnostic = materializeJudgeDiagnosticPayload({
    diagnostic: record.diagnostic,
    draft: record,
    reason: record.reason,
    roundNumber: input.roundNumber,
    mapSemanticContext: input.mapSemanticContext,
    allowDraftFallback: draftLike
  });
  const materializedRecord = {
    ...record,
    ...(winnerTeamId ? { winnerTeamId } : {}),
    ...(loserTeamId ? { loserTeamId } : {}),
    ...(roundWinType ? { roundWinType } : {}),
    margin,
    attackWinConditionMet:
      normalizeJudgeBoolean(record.attackWinConditionMet) ?? (roundWinType ? roundWinType.startsWith("attack_") : winnerTeamId === input.sideAssignment.attackingTeamId),
    defenseWinConditionMet:
      normalizeJudgeBoolean(record.defenseWinConditionMet) ?? (roundWinType ? roundWinType.startsWith("defense_") : winnerTeamId === input.sideAssignment.defendingTeamId),
    mvpAgentId: normalizeText(record.mvpAgentId) ?? winnerActiveAgentIds[0] ?? input.activeTeamAAgentIds[0] ?? input.activeTeamBAgentIds[0],
    confidence: typeof record.confidence === "number" && Number.isFinite(record.confidence) ? Math.min(1, Math.max(0, record.confidence)) : 0.65,
    ...(materializedDiagnostic !== undefined ? { diagnostic: materializedDiagnostic } : {})
  };
  return materializeJudgeVerdictScorecardPayloadFromModule({
    payload: materializedRecord,
    teamAId: input.teamAId,
    teamBId: input.teamBId,
    activeTeamAAgentIds: input.activeTeamAAgentIds,
    activeTeamBAgentIds: input.activeTeamBAgentIds,
    sideAssignment: input.sideAssignment,
    defenderThesisContext: input.defenderThesisContext,
    ...(input.rubricProfile ? { rubricProfile: input.rubricProfile } : {})
  });
}

function validateJudgeVerdictDecision(input: {
  verdict: JudgeVerdictDecision;
  teamAId: string;
  teamBId: string;
  activeTeamAAgentIds: string[];
  activeTeamBAgentIds: string[];
  sideAssignment: SideAssignment;
}): void {
  validateJudgeWinSemantics(input.verdict, input.sideAssignment);
  if (![input.teamAId, input.teamBId].includes(input.verdict.winnerTeamId)) {
    throw new Error(`Judge returned an invalid winnerTeamId: ${input.verdict.winnerTeamId}`);
  }
  const expectedLoserTeamId = input.verdict.winnerTeamId === input.teamAId ? input.teamBId : input.teamAId;
  if (input.verdict.loserTeamId !== expectedLoserTeamId) {
    throw new Error(`Judge returned an invalid loserTeamId: ${input.verdict.loserTeamId}`);
  }
  const winnerAgentIds = input.verdict.winnerTeamId === input.teamAId ? input.activeTeamAAgentIds : input.activeTeamBAgentIds;
  if (!winnerAgentIds.includes(input.verdict.mvpAgentId)) {
    throw new Error(`Judge returned an invalid mvpAgentId: ${input.verdict.mvpAgentId}`);
  }
}

function validateJudgeResult(input: {
  judgeResult: JudgeResult;
  teamA: Team;
  teamB: Team;
  sideAssignment: SideAssignment;
  teamPlans?: Record<string, TeamRoundPlanDecision> | undefined;
  agentOutputs?: AgentOutput[] | undefined;
}): void {
  validateJudgeWinSemantics(input.judgeResult, input.sideAssignment);
  if (![input.teamA.id, input.teamB.id].includes(input.judgeResult.winnerTeamId)) {
    throw new Error(`Judge returned an invalid winnerTeamId: ${input.judgeResult.winnerTeamId}`);
  }
  const expectedLoserTeamId = input.judgeResult.winnerTeamId === input.teamA.id ? input.teamB.id : input.teamA.id;
  if (input.judgeResult.loserTeamId !== expectedLoserTeamId) {
    throw new Error(`Judge returned an invalid loserTeamId: ${input.judgeResult.loserTeamId}`);
  }
  const winnerAgentIds = new Set(
    (input.agentOutputs ?? [])
      .filter((output) => output.teamId === input.judgeResult.winnerTeamId)
      .map((output) => output.agentId)
  );
  if (winnerAgentIds.size > 0 && !winnerAgentIds.has(input.judgeResult.mvpAgentId)) {
    throw new Error(`Judge returned an invalid mvpAgentId: ${input.judgeResult.mvpAgentId}`);
  }
  if (!input.judgeResult.diagnostic) {
    throw new Error("Judge diagnostic is required for Phase 2.0-pre real LLM rounds.");
  }
  if (!input.judgeResult.judgeInference || input.judgeResult.judgeInference.source !== "judge_inference") {
    throw new Error("Judge judgeInference is required for Phase 2.0-pre combat/result narration.");
  }
  if (input.teamPlans) {
    const winnerTeam = input.judgeResult.winnerTeamId === input.teamA.id ? input.teamA : input.teamB;
    const loserTeam = input.judgeResult.loserTeamId === input.teamA.id ? input.teamA : input.teamB;
    const winnerPlan = input.teamPlans[winnerTeam.id];
    const loserPlan = input.teamPlans[loserTeam.id];
    if (!winnerPlan || !loserPlan) {
      throw new Error("Judge validation requires both Phase 1.8 team plans.");
    }
    if (!hasWinnerAndLoserPlanExplanation(input.judgeResult.reason, winnerTeam, loserTeam, winnerPlan, loserPlan)) {
      throw new Error(
        `Judge reason must explain how ${winnerTeam.displayName} succeeded and how ${loserTeam.displayName} failed.`
      );
    }
  }
}

function normalizeLegacyJudgeScorecardForReview(
  judgeResult: JudgeResult,
  input: { rubricProfile?: JudgeRubricProfile; sideAssignment: SideAssignment; teamAId: string; teamBId: string }
): JudgeResult {
  if (judgeResult.judgeScorecard || !input.rubricProfile || !judgeResult.roundWinType) {
    return normalizeJudgeResultMarginForReason(judgeResult);
  }
  return normalizeJudgeResultMarginForReason({
    ...judgeResult,
    judgeScorecard: buildDeterministicJudgeScorecard({
      rubricProfile: input.rubricProfile,
      winnerTeamId: judgeResult.winnerTeamId,
      loserTeamId: judgeResult.loserTeamId,
      teamAId: input.teamAId,
      teamBId: input.teamBId,
      sideAssignment: input.sideAssignment,
      margin: judgeResult.margin,
      roundWinType: judgeResult.roundWinType,
      reason: "judge_review 兼容旧结构时生成的确定性评分桥接。",
      source: "deterministic_fallback"
    })
  });
}

function normalizeStagedJudgeResultForCommit(judgeResult: JudgeResult, input: { teamA: Team; teamB: Team }): JudgeResult {
  const diagnostic = judgeResult.diagnostic;
  const judgeInference = judgeResult.judgeInference;
  if (!diagnostic || !judgeInference) {
    return judgeResult;
  }
  const decisiveEvidence = diagnostic.decisiveEvidence;
  return {
    ...judgeResult,
    reason: normalizeStagedJudgeNarrativeText(judgeResult.reason),
    judgeInference: {
      source: "judge_inference",
      boundary: judgeInference.boundary,
      csResolution: normalizeStagedJudgeNarrativeText(judgeInference.csResolution),
      combatNarrative: normalizeStagedJudgeNarrativeText(judgeInference.combatNarrative),
      evidenceBasis: judgeInference.evidenceBasis.map((item) => normalizeStagedJudgeNarrativeText(item))
    },
    diagnostic: {
      ...diagnostic,
      attackedOpportunityGap: expandThinJudgeDiagnosticField({
        label: "机会缺口",
        value: diagnostic.attackedOpportunityGap,
        fallback: decisiveEvidence,
        teamA: input.teamA,
        teamB: input.teamB
      }),
      defendedCoreProposition: expandThinJudgeDiagnosticField({
        label: "防守命题",
        value: diagnostic.defendedCoreProposition,
        fallback: decisiveEvidence,
        teamA: input.teamA,
        teamB: input.teamB
      }),
      decisiveEvidence: normalizeStagedJudgeNarrativeText(decisiveEvidence),
      ...(diagnostic.zoneRelation
        ? {
            zoneRelation: {
              ...diagnostic.zoneRelation,
              relationSummary: normalizeStagedJudgeNarrativeText(diagnostic.zoneRelation.relationSummary),
              outcomeImpact: normalizeStagedJudgeNarrativeText(diagnostic.zoneRelation.outcomeImpact)
            }
          }
        : {})
    }
  };
}

function validateJudgeWinSemantics(
  judgeResult: {
    winnerTeamId: string;
    roundWinType?: JudgeRoundWinType | undefined;
    attackWinConditionMet?: boolean | undefined;
    defenseWinConditionMet?: boolean | undefined;
  },
  sideAssignment: SideAssignment
): void {
  if (!judgeResult.roundWinType) {
    throw new Error("Judge roundWinType is required for Phase 2.0-pre real LLM rounds.");
  }
  if (typeof judgeResult.attackWinConditionMet !== "boolean" || typeof judgeResult.defenseWinConditionMet !== "boolean") {
    throw new Error("Judge attackWinConditionMet and defenseWinConditionMet are required for Phase 2.0-pre real LLM rounds.");
  }
  const attackWin = judgeResult.roundWinType.startsWith("attack_");
  const defenseWin = judgeResult.roundWinType.startsWith("defense_");
  if (attackWin === defenseWin) {
    throw new Error(`Judge returned an invalid roundWinType: ${judgeResult.roundWinType}`);
  }
  const expectedWinnerTeamId = attackWin ? sideAssignment.attackingTeamId : sideAssignment.defendingTeamId;
  if (judgeResult.winnerTeamId !== expectedWinnerTeamId) {
    throw new Error(
      `Judge roundWinType ${judgeResult.roundWinType} conflicts with winnerTeamId ${judgeResult.winnerTeamId}.`
    );
  }
  if (judgeResult.attackWinConditionMet !== attackWin) {
    throw new Error(`Judge attackWinConditionMet conflicts with roundWinType ${judgeResult.roundWinType}.`);
  }
  if (judgeResult.defenseWinConditionMet !== defenseWin) {
    throw new Error(`Judge defenseWinConditionMet conflicts with roundWinType ${judgeResult.roundWinType}.`);
  }
}

function validateJudgeNarrativeAgainstVerdict(narrative: JudgeNarrativeDecision, verdict: JudgeVerdictDecision): void {
  const serialized = normalizeForJudgeReason(JSON.stringify(narrative));
  const forbiddenLoserWinCue =
    verdict.roundWinType.startsWith("attack_") ? "defense win" : verdict.roundWinType.startsWith("defense_") ? "attack win" : "";
  if (forbiddenLoserWinCue && serialized.includes(forbiddenLoserWinCue)) {
    throw new Error(`Judge narrative conflicts with locked verdict roundWinType ${verdict.roundWinType}.`);
  }
}

function normalizeJudgeNarrativeDecisionForVerdict(
  narrative: JudgeNarrativeDecision,
  verdict: JudgeVerdictDecision
): JudgeNarrativeDecision {
  return {
    ...narrative,
    reason: sanitizeNarrativeTextForRoundWinType(narrative.reason, verdict.roundWinType),
    judgeInference: {
      ...narrative.judgeInference,
      source: "judge_inference",
      boundary: normalizeJudgeInferenceBoundary(narrative.judgeInference.boundary),
      csResolution: sanitizeNarrativeTextForRoundWinType(narrative.judgeInference.csResolution, verdict.roundWinType),
      combatNarrative: sanitizeNarrativeTextForRoundWinType(narrative.judgeInference.combatNarrative, verdict.roundWinType),
      evidenceBasis: narrative.judgeInference.evidenceBasis.map((item) => sanitizeNarrativeTextForRoundWinType(item, verdict.roundWinType))
    }
  };
}

function buildStagedJudgeReason(verdict: JudgeVerdictDecision, narrative: JudgeNarrativeDecision): string {
  const parts = [narrative.reason.trim()].filter((value) => value.length > 0);
  const additions = [
    typeof verdict.winnerReason === "string" && verdict.winnerReason.trim().length > 0
      ? `${verdict.winnerTeamId} 成功：${verdict.winnerReason.trim()}`
      : "",
    typeof verdict.loserFailureReason === "string" && verdict.loserFailureReason.trim().length > 0
      ? `${verdict.loserTeamId} 失败：${verdict.loserFailureReason.trim()}`
      : "",
    typeof verdict.attackedOpportunityGapText === "string" && verdict.attackedOpportunityGapText.trim().length > 0
      ? `机会缺口：${verdict.attackedOpportunityGapText.trim()}`
      : "",
    typeof verdict.defendedCorePropositionText === "string" && verdict.defendedCorePropositionText.trim().length > 0
      ? `守方命题：${verdict.defendedCorePropositionText.trim()}`
      : ""
  ].filter((value) => value.length > 0);
  for (const addition of additions) {
    const normalizedAddition = normalizeForJudgeReason(addition);
    if (!parts.some((part) => normalizeForJudgeReason(part).includes(normalizedAddition))) {
      parts.push(addition);
    }
  }
  return normalizeStagedJudgeNarrativeText(parts.join(" "));
}

function materializeJudgeDiagnosticPayload(input: {
  diagnostic: unknown;
  draft?: Record<string, unknown>;
  reason?: unknown;
  roundNumber: number;
  mapSemanticContext?: Record<string, unknown> | undefined;
  allowDraftFallback?: boolean;
}): unknown {
  const record = readUnknownRecord(input.diagnostic);
  if (!record && !input.allowDraftFallback) {
    return input.diagnostic;
  }
  const diagnosticRecord = record ?? {};
  const draft = input.draft ?? {};
  const proposition = readUnknownRecord(input.mapSemanticContext?.proposition);
  const expectedSubTheme = proposition ? resolvePhase18SubTheme(proposition, input.roundNumber) : undefined;
  const validZoneIds = collectPhase18MapZoneIds(input.mapSemanticContext);
  const zoneRelationRecord = readUnknownRecord(diagnosticRecord.zoneRelation);
  const zoneFocusCandidates = input.allowDraftFallback && Array.isArray(draft.zoneFocusCandidates) ? draft.zoneFocusCandidates : [];
  const mainAttackZoneId = pickMaterializedJudgeZoneId(
    [diagnosticRecord.mainAttackZoneId, zoneRelationRecord?.attackZoneId, ...zoneFocusCandidates],
    validZoneIds,
    "buyer_mid",
    input.allowDraftFallback === true
  );
  const mainDefenseZoneId = pickMaterializedJudgeZoneId(
    [diagnosticRecord.mainDefenseZoneId, zoneRelationRecord?.defenseZoneId, ...zoneFocusCandidates],
    validZoneIds,
    mainAttackZoneId ?? "buyer_mid",
    input.allowDraftFallback === true
  );
  const decisiveEvidence =
    (input.allowDraftFallback ? normalizeText(draft.decisiveEvidenceText) : undefined) ??
    normalizeText(diagnosticRecord.decisiveEvidence) ??
    (input.allowDraftFallback ? normalizeText(draft.winnerReason) ?? normalizeText(input.reason) : undefined) ??
    (input.allowDraftFallback ? "裁判根据双方提交内容、战术碰撞和回合语义完成胜负物化。" : undefined);
  return {
    currentSubTheme: expectedSubTheme ?? normalizeText(diagnosticRecord.currentSubTheme) ?? (input.allowDraftFallback ? "默认回合子命题" : undefined),
    attackedOpportunityGap:
      (input.allowDraftFallback ? normalizeText(draft.attackedOpportunityGapText) : undefined) ??
      normalizeText(diagnosticRecord.attackedOpportunityGap) ??
      (input.allowDraftFallback ? normalizeText(draft.winnerReason) : undefined) ??
      decisiveEvidence,
    defendedCoreProposition:
      (input.allowDraftFallback ? normalizeText(draft.defendedCorePropositionText) : undefined) ??
      normalizeText(diagnosticRecord.defendedCoreProposition) ??
      (input.allowDraftFallback ? normalizeText(draft.loserFailureReason) : undefined) ??
      decisiveEvidence,
    mainAttackZoneId,
    mainDefenseZoneId,
    zoneRelation: zoneRelationRecord
      ? normalizeJudgeZoneRelationPayload(
          diagnosticRecord.zoneRelation,
          decisiveEvidence,
          mainAttackZoneId && mainDefenseZoneId
            ? {
                attackZoneId: mainAttackZoneId,
                defenseZoneId: mainDefenseZoneId
              }
            : undefined
        )
      : input.allowDraftFallback
        ? {
            attackZoneId: mainAttackZoneId ?? "buyer_mid",
            defenseZoneId: mainDefenseZoneId ?? mainAttackZoneId ?? "buyer_mid",
            relationType: mainAttackZoneId === mainDefenseZoneId ? "same_focus" : "cross_hit",
            relationSummary: decisiveEvidence ?? "攻守焦点存在结构关系。",
            outcomeImpact: decisiveEvidence ?? "攻守焦点影响本回合胜负。"
          }
        : undefined,
    decisiveEvidence
  };
}

function normalizeJudgeResultPayload(data: unknown): unknown {
  const record = readUnknownRecord(data);
  if (!record) {
    return data;
  }
  const margin = normalizeJudgeMargin(record.margin);
  const roundWinType = normalizeJudgeRoundWinType(record.roundWinType);
  return {
    ...record,
    ...(margin ? { margin } : {}),
    ...(roundWinType ? { roundWinType } : {}),
    ...(record.attackWinConditionMet !== undefined
      ? { attackWinConditionMet: normalizeJudgeBoolean(record.attackWinConditionMet) }
      : {}),
    ...(record.defenseWinConditionMet !== undefined
      ? { defenseWinConditionMet: normalizeJudgeBoolean(record.defenseWinConditionMet) }
      : {}),
    ...(readUnknownRecord(record.judgeInference)
      ? { judgeInference: normalizeJudgeInferencePayload(record.judgeInference) }
      : {}),
    ...(readUnknownRecord(record.diagnostic)
      ? { diagnostic: normalizeJudgeDiagnosticPayload(record.diagnostic, record.reason) }
      : {}),
    ...(readUnknownRecord(record.judgeScorecard)
      ? { judgeScorecard: normalizeJudgeScorecardPayload(record.judgeScorecard) }
      : {})
  };
}

function normalizeJudgeVerdictPayload(data: unknown): unknown {
  const record = readUnknownRecord(data);
  if (!record) {
    return data;
  }
  const margin = normalizeJudgeMargin(record.margin);
  const roundWinType = normalizeJudgeRoundWinType(record.roundWinType);
  return {
    ...record,
    ...(margin ? { margin } : {}),
    ...(roundWinType ? { roundWinType } : {}),
    ...(record.attackWinConditionMet !== undefined
      ? { attackWinConditionMet: normalizeJudgeBoolean(record.attackWinConditionMet) }
      : {}),
    ...(record.defenseWinConditionMet !== undefined
      ? { defenseWinConditionMet: normalizeJudgeBoolean(record.defenseWinConditionMet) }
      : {}),
    ...(readUnknownRecord(record.diagnostic)
      ? { diagnostic: normalizeJudgeDiagnosticPayload(record.diagnostic, undefined) }
      : {}),
    ...(readUnknownRecord(record.judgeScorecard)
      ? { judgeScorecard: normalizeJudgeScorecardPayload(record.judgeScorecard) }
      : {})
  };
}

function normalizeJudgeNarrativePayload(data: unknown): unknown {
  const record = readUnknownRecord(data);
  if (!record) {
    return data;
  }
  return {
    ...record,
    reason: normalizeText(record.reason),
    ...(readUnknownRecord(record.judgeInference)
      ? { judgeInference: normalizeJudgeInferencePayload(record.judgeInference) }
      : {})
  };
}

function normalizeJudgeDiagnosticPayload(diagnostic: unknown, reason: unknown): unknown {
  const record = readUnknownRecord(diagnostic);
  if (!record) {
    return diagnostic;
  }
  const zoneRelationRecord = readUnknownRecord(record.zoneRelation);
  const decisiveEvidence =
    normalizeText(record.decisiveEvidence) ??
    normalizeText(zoneRelationRecord?.decisiveEvidence) ??
    normalizeText(zoneRelationRecord?.evidence) ??
    normalizeText(zoneRelationRecord?.outcomeImpact);
  const rawMainAttackZoneId = normalizeText(record.mainAttackZoneId);
  const rawMainDefenseZoneId = normalizeText(record.mainDefenseZoneId);
  const mainAttackZoneId = normalizeJudgeZoneId(rawMainAttackZoneId) ?? rawMainAttackZoneId ?? "buyer_mid";
  const mainDefenseZoneId = normalizeJudgeZoneId(rawMainDefenseZoneId) ?? rawMainDefenseZoneId ?? mainAttackZoneId;
  return {
    currentSubTheme: normalizeText(record.currentSubTheme),
    attackedOpportunityGap: normalizeText(record.attackedOpportunityGap),
    defendedCoreProposition: normalizeText(record.defendedCoreProposition),
    mainAttackZoneId,
    mainDefenseZoneId,
    zoneRelation: zoneRelationRecord
      ? normalizeJudgeZoneRelationPayload(record.zoneRelation, decisiveEvidence, { attackZoneId: mainAttackZoneId, defenseZoneId: mainDefenseZoneId })
      : {
          attackZoneId: mainAttackZoneId,
          defenseZoneId: mainDefenseZoneId,
          relationType: "same_focus",
          relationSummary: decisiveEvidence ?? normalizeText(reason) ?? "攻守焦点存在结构关系。",
          outcomeImpact: decisiveEvidence ?? normalizeText(reason) ?? "攻守焦点影响本回合胜负。"
        },
    decisiveEvidence
  };
}

function normalizeJudgeScorecardPayload(scorecard: unknown): unknown {
  const record = readUnknownRecord(scorecard);
  if (!record) {
    return scorecard;
  }
  const rawTeamScores = record.teamScores;
  const teamScores = Array.isArray(rawTeamScores)
    ? Object.fromEntries(
        rawTeamScores
          .map((entry) => readUnknownRecord(entry))
          .filter((entry): entry is Record<string, unknown> => Boolean(entry?.teamId))
          .map((entry) => [String(entry.teamId), entry])
      )
    : rawTeamScores;
  const marginFromScore = normalizeJudgeMargin(record.marginFromScore);
  return {
    ...record,
    ...(teamScores ? { teamScores } : {}),
    ...(marginFromScore ? { marginFromScore } : {})
  };
}

function normalizeJudgeInferencePayload(inference: unknown): unknown {
  const record = readUnknownRecord(inference);
  if (!record) {
    return inference;
  }
  return {
    source: "judge_inference",
    boundary: normalizeText(record.boundary),
    csResolution: normalizeText(record.csResolution),
    combatNarrative: normalizeText(record.combatNarrative),
    evidenceBasis: Array.isArray(record.evidenceBasis)
      ? record.evidenceBasis.map((item) => normalizeText(item)).filter((item): item is string => Boolean(item))
      : typeof record.evidenceBasis === "string"
        ? [normalizeText(record.evidenceBasis)].filter((item): item is string => Boolean(item))
        : []
  };
}

function normalizeJudgeZoneRelationPayload(
  zoneRelation: unknown,
  fallbackEvidence?: string,
  fallbackZones?: { attackZoneId: string; defenseZoneId: string }
): unknown {
  const record = readUnknownRecord(zoneRelation);
  if (!record) {
    return zoneRelation;
  }
  const evidence =
    normalizeText(record.decisiveEvidence) ??
    normalizeText(record.evidence) ??
    normalizeText(record.relationSummary) ??
    normalizeText(record.outcomeImpact) ??
    fallbackEvidence ??
    "攻守焦点存在结构关系，并影响本回合胜负。";
  const rawRelationType = normalizeText(record.relationType);
  const relationType = normalizeJudgeZoneRelationType(rawRelationType);
  const relationTypeNote =
    rawRelationType && rawRelationType.trim().toLowerCase() !== relationType
      ? `原始关系类型“${rawRelationType}”已归一为 ${relationType}。`
      : "";
  return {
    attackZoneId:
      normalizeJudgeZoneId(record.attackZoneId) ??
      normalizeText(record.attackZoneId) ??
      fallbackZones?.attackZoneId,
    defenseZoneId:
      normalizeJudgeZoneId(record.defenseZoneId) ??
      normalizeText(record.defenseZoneId) ??
      fallbackZones?.defenseZoneId,
    relationType,
    relationSummary: [normalizeText(record.relationSummary) ?? evidence, relationTypeNote].filter(Boolean).join(" "),
    outcomeImpact: normalizeText(record.outcomeImpact) ?? evidence
  };
}

function normalizeJudgeZoneRelationType(value: unknown): string {
  const normalized = (normalizeText(value) ?? "").trim().toLowerCase();
  switch (normalized) {
    case "":
    case "same":
    case "same_zone":
    case "same_focus":
    case "direct":
    case "direct_collision":
    case "direct_contest":
    case "head_to_head":
    case "primary_defense_anchor":
      return "same_focus";
    case "cross":
    case "crossfire":
    case "cross_hit":
    case "cross_axis":
    case "cross_axis_pressure":
    case "adjacent_entry_pressure":
    case "adjacent_pressure":
    case "entry_pressure":
    case "indirect_pressure":
    case "indirect_control":
    case "pressure_transfer":
    case "offensive_focus_vs_defensive_hub":
    case "offensive_focus_defensive_hub":
    case "attack_focus_vs_defense_hub":
    case "attack_focus_defense_hub":
      return "cross_hit";
    case "split":
    case "split_pressure":
    case "multi_axis":
    case "non_overlapping_focus_mismatch":
    case "non_overlapping_focus":
    case "focus_mismatch":
      return "split_pressure";
    case "probe_failed":
    case "failed_probe":
    case "failed_test":
      return "failed_probe";
    case "rotation":
    case "rotation_test":
    case "rotate_test":
      return "rotation_test";
    case "weak_side":
    case "weak_side_hit":
    case "weakside_hit":
      return "weak_side_hit";
    default:
      return "cross_hit";
  }
}

function isJudgeVerdictDraftLike(record: Record<string, unknown>): boolean {
  return (
    record.winnerPromptTeamId !== undefined ||
    record.loserPromptTeamId !== undefined ||
    record.attackedOpportunityGapText !== undefined ||
    record.defendedCorePropositionText !== undefined ||
    record.decisiveEvidenceText !== undefined ||
    record.winnerReason !== undefined ||
    record.loserFailureReason !== undefined ||
    Array.isArray(record.zoneFocusCandidates)
  );
}

function materializeJudgeTeamId(value: unknown, input: { teamAId: string; teamBId: string }): string | undefined {
  const text = normalizeText(value);
  if (!text) {
    return undefined;
  }
  const normalized = text.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (text === input.teamAId || ["team_a", "teamalpha", "team_alpha", "alpha", "prompt_team_a"].includes(normalized)) {
    return input.teamAId;
  }
  if (text === input.teamBId || ["team_b", "teambravo", "team_bravo", "bravo", "prompt_team_b"].includes(normalized)) {
    return input.teamBId;
  }
  return undefined;
}

function inferJudgeRoundWinTypeFromWinner(winnerTeamId: string | undefined, sideAssignment: SideAssignment): JudgeRoundWinType | undefined {
  if (winnerTeamId === sideAssignment.attackingTeamId) {
    return "attack_elimination";
  }
  if (winnerTeamId === sideAssignment.defendingTeamId) {
    return "defense_elimination";
  }
  return undefined;
}

function pickMaterializedJudgeZoneId(values: unknown[], validZoneIds: Set<string>, fallback: string, allowFallback: boolean): string | undefined {
  for (const value of values) {
    const normalized = normalizeJudgeZoneId(value) ?? normalizeText(value);
    if (normalized && (validZoneIds.size === 0 || validZoneIds.has(normalized))) {
      return normalized;
    }
    if (normalized && validZoneIds.size > 0 && !validZoneIds.has(normalized)) {
      return normalized;
    }
  }
  if (!allowFallback) {
    return undefined;
  }
  if (validZoneIds.size === 0 || validZoneIds.has(fallback)) {
    return fallback;
  }
  return validZoneIds.values().next().value ?? fallback;
}

function normalizeJudgeMargin(value: unknown): JudgeResult["margin"] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
  switch (normalized) {
    case "narrow":
    case "close":
    case "slight":
    case "minor":
    case "thin":
    case "marginal":
      return "narrow";
    case "standard":
    case "clear":
    case "solid":
    case "moderate":
    case "normal":
    case "regular":
      return "standard";
    case "decisive":
    case "dominant":
    case "overwhelming":
    case "onesided":
    case "crushing":
      return "decisive";
    default:
      return undefined;
  }
}

function normalizeJudgeRoundWinType(value: unknown): JudgeRoundWinType | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, "_");
  switch (normalized) {
    case "attack_elimination":
    case "attacker_elimination":
    case "t_elimination":
    case "attack_kill":
    case "all_kill_attack":
    case "attack_full_elimination":
      return "attack_elimination";
    case "attack_bomb_explosion":
    case "bomb_explosion":
    case "plant_and_explode":
    case "attack_explosion":
    case "attack_bomb":
      return "attack_bomb_explosion";
    case "defense_elimination":
    case "defender_elimination":
    case "ct_elimination":
    case "defense_kill":
    case "all_kill_defense":
    case "defense_full_elimination":
      return "defense_elimination";
    case "defense_timeout_no_plant":
    case "timeout_no_plant":
    case "defense_timeout":
    case "timeout":
    case "no_plant_timeout":
      return "defense_timeout_no_plant";
    case "defense_defuse":
    case "defuse":
    case "bomb_defuse":
    case "defense_bomb_defuse":
      return "defense_defuse";
    default:
      return undefined;
  }
}

function normalizeJudgeBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "1", "success", "met"].includes(normalized)) {
    return true;
  }
  if (["false", "no", "0", "failed", "not_met", "notmet"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function normalizeJudgeZoneId(value: unknown): string | undefined {
  const text = normalizeText(value)?.trim();
  if (!text) {
    return undefined;
  }
  return normalizeKnownTacticalZoneId(text);
}

function normalizeJudgeInferenceBoundary(boundary: string): string {
  return hasJudgeInferenceBoundaryMarker(boundary) ? boundary : `裁判推断边界：${boundary}`;
}

function hasJudgeInferenceBoundaryMarker(value: string): boolean {
  return /裁判推断边界|judge inferred|judge inference|not agent action fact|不是 agent_action 原始事实|不是原始事实/i.test(value);
}

function sanitizeNarrativeTextForRoundWinType(value: string, roundWinType: JudgeRoundWinType): string {
  if (roundWinType.startsWith("defense_")) {
    return value
      .replace(/完成下包/g, "完成包点控制")
      .replace(/成功下包/g, "完成包点控制")
      .replace(/下包成功/g, "包点控制成功");
  }
  return value;
}

function normalizeStagedJudgeNarrativeText(value: string): string {
  return value
    .replace(/未能完成下包/g, "未能完成包点控制")
    .replace(/完成下包|成功下包|下包成功/g, "完成包点控制")
    .replace(/至少两次关键击杀/g, "关键火力贡献")
    .replace(/至少两名/g, "多名")
    .trim();
}

function expandThinJudgeDiagnosticField(input: {
  label: string;
  value: string;
  fallback: string;
  teamA: Team;
  teamB: Team;
}): string {
  const normalized = normalizeStagedJudgeNarrativeText(input.value);
  const hasActorCue = hasJudgeSideCue(normalized, input.teamA, input.teamB);
  const hasReasonCue = hasJudgeDiagnosticReasonCue(normalized);
  if (normalized.length >= 10 && hasActorCue && hasReasonCue) {
    return normalized;
  }
  if (normalized.length >= 10 && hasReasonCue) {
    return `${input.teamA.displayName} 与 ${input.teamB.displayName} 的攻防互动中，${normalized}`;
  }
  return `${input.label}：${normalized}。${normalizeStagedJudgeNarrativeText(input.fallback)}`;
}

function hasJudgeDiagnosticReasonCue(value: string): boolean {
  return /(因为|由于|基于|证明|显示|导致|失败|成功|压制|突破|守住|失守|机会|命题|证据)/.test(value);
}

function hasJudgeSideCue(value: string, teamA: Team, teamB: Team): boolean {
  const normalized = normalizeForJudgeReason(value);
  return mentionsTeam(normalized, teamA) || mentionsTeam(normalized, teamB) || /(攻方|守方|进攻|防守|attack|defense)/i.test(value);
}

function collectPhase18MapZoneIds(mapSemanticContext: Record<string, unknown> | undefined): Set<string> {
  const proposition = readUnknownRecord(mapSemanticContext?.proposition);
  const zones = Array.isArray(proposition?.zones) ? proposition.zones : [];
  return new Set(
    zones
      .map((zone) => readUnknownRecord(zone))
      .map((zone) => (typeof zone?.zoneId === "string" ? zone.zoneId : undefined))
      .filter((zoneId): zoneId is string => Boolean(zoneId))
  );
}

function resolvePhase18SubTheme(proposition: Record<string, unknown>, roundNumber: number | undefined): string | undefined {
  if (!roundNumber) {
    return undefined;
  }
  const regulationRoundThemes = Array.isArray(proposition.regulationRoundThemes)
    ? proposition.regulationRoundThemes
    : Array.isArray(proposition.regulation_round_themes)
      ? proposition.regulation_round_themes
      : [];
  const overtimeRoundThemes = Array.isArray(proposition.overtimeRoundThemes)
    ? proposition.overtimeRoundThemes
    : Array.isArray(proposition.overtime_round_themes)
      ? proposition.overtime_round_themes
      : [];
  const themes = roundNumber > 12 && overtimeRoundThemes.length > 0 ? overtimeRoundThemes : regulationRoundThemes;
  const theme = readUnknownRecord(themes[(roundNumber - 1) % Math.max(themes.length, 1)]);
  return typeof theme?.subTheme === "string" ? theme.subTheme : typeof theme?.theme === "string" ? theme.theme : undefined;
}

function hasWinnerAndLoserPlanExplanation(
  reason: string,
  winnerTeam: Team,
  loserTeam: Team,
  winnerPlan: TeamRoundPlanDecision,
  loserPlan: TeamRoundPlanDecision
): boolean {
  const normalizedReason = normalizeForJudgeReason(reason);
  const winnerMentioned = mentionsTeam(normalizedReason, winnerTeam);
  const loserMentioned = mentionsTeam(normalizedReason, loserTeam);
  if (!winnerMentioned || !loserMentioned) {
    return false;
  }
  const winnerExplained =
    mentionsWinCondition(normalizedReason, winnerPlan) && containsAny(normalizedReason, WINNER_EXPLANATION_CUES);
  const loserExplained = mentionsWinCondition(normalizedReason, loserPlan) && containsAny(normalizedReason, LOSER_EXPLANATION_CUES);
  return winnerExplained && loserExplained;
}

function mentionsTeam(normalizedReason: string, team: Team): boolean {
  const candidates = [team.id, team.displayName, team.shortName]
    .map((value) => normalizeForJudgeReason(value))
    .filter((value) => value.length > 0);
  return candidates.some((candidate) => normalizedReason.includes(candidate));
}

function mentionsWinCondition(normalizedReason: string, plan: TeamRoundPlanDecision): boolean {
  if (containsAny(normalizedReason, WIN_CONDITION_SYNONYMS)) {
    return true;
  }
  const keywords = extractPlanKeywords(plan);
  return keywords.some((keyword) => normalizedReason.includes(keyword));
}

function extractPlanKeywords(plan: TeamRoundPlanDecision): string[] {
  const values = [plan.primaryIntent, plan.primaryZoneId, plan.secondaryZoneId, plan.winCondition, plan.risk]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => normalizeForJudgeReason(value));
  const keywords = new Set<string>();
  for (const value of values) {
    const words = value.split(/\s+/).filter((word) => word.length >= 4 && !COMMON_PLAN_WORDS.has(word));
    for (const word of words) {
      keywords.add(word);
    }
  }
  return [...keywords];
}

function extractSpecificPlanKeywords(plan: TeamRoundPlanDecision, team: Team): string[] {
  const teamKeywords = new Set(
    [team.id, team.displayName, team.shortName]
      .flatMap((value) => normalizeForJudgeReason(value).split(/\s+/))
      .filter((word) => word.length >= 2)
  );
  return extractPlanKeywords(plan).filter((keyword) => !teamKeywords.has(keyword));
}

function containsAny(value: string, candidates: string[]): boolean {
  return candidates.some((candidate) => {
    const normalizedCandidate = normalizeForJudgeReason(candidate);
    return normalizedCandidate.length > 0 && value.includes(normalizedCandidate);
  });
}

function normalizeForJudgeReason(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").trim();
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readUnknownRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

const WIN_CONDITION_SYNONYMS = [
  "win condition",
  "winning condition",
  "condition",
  "plan",
  "victory plan",
  "胜利条件",
  "获胜条件",
  "取胜条件",
  "胜负条件",
  "计划",
  "方案",
  "命题",
  "子命题",
  "核心判断",
  "机会缺口",
  "用户定义",
  "核心用户",
  "痛点",
  "场景",
  "切口",
  "成立点",
  "价值"
];

const WINNER_EXPLANATION_CUES = [
  "succeeded",
  "success",
  "converted",
  "secured",
  "won",
  "executed",
  "held",
  "landed",
  "成功",
  "打中",
  "打成",
  "打穿",
  "打击",
  "精准打击",
  "压制",
  "守住",
  "拿下",
  "赢得",
  "兑现",
  "建立",
  "塑造",
  "锚定",
  "完成",
  "成立"
];

const LOSER_EXPLANATION_CUES = [
  "failed",
  "failed to",
  "could not",
  "unable to",
  "collapsed",
  "denied",
  "stopped",
  "lost",
  "失败",
  "未能",
  "没能",
  "不能",
  "无法",
  "缺乏",
  "暴露",
  "被迫",
  "沦为",
  "丢失",
  "被打穿",
  "被压制",
  "没有",
  "不足",
  "失守"
];

const COMMON_PLAN_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "their",
  "this",
  "that",
  "with",
  "from",
  "into",
  "through",
  "after",
  "before",
  "because",
  "while",
  "where",
  "when",
  "then",
  "than",
  "team",
  "round",
  "site",
  "zone",
  "risk",
  "plan",
  "condition",
  "hold",
  "take",
  "win",
  "wins",
  "won",
  "for",
  "they",
  "them",
  "were",
  "was",
  "is",
  "are",
  "to",
  "of",
  "on",
  "in",
  "by"
]);
