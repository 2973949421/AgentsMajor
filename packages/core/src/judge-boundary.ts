import { defenderThesisContextSchema } from "@agent-major/shared";
import type {
  Agent,
  AgentOutput,
  BuyType,
  DefenderThesisContext,
  EconomyPosture,
  JudgeDiagnostic,
  JudgeDimensionRequirements,
  JudgeNarrativeDecision,
  JudgeResult,
  JudgeRubricProfile,
  JudgeScorecard,
  JudgeVerdictDecision,
  MapGame,
  Round,
  SideAssignment,
  SubmittedAgentOutput,
  TacticalCollision,
  Team,
  TeamRoundPlanDecision
} from "@agent-major/shared";

import { normalizeKnownTacticalZoneId } from "./llm-output-normalizer.js";
import { normalizeJudgeResultMarginForReason } from "./judge-scorecard-materializer.js";
import { validatePromptJudgeResult } from "./judge-validation.js";
import type { Phase18JudgePromptContext } from "./judge-pipeline.js";
import { REQUIRED_TACTICAL_ZONE_IDS } from "./tactical-map.js";

export function translateJudgePromptError(error: unknown, context: Phase18JudgePromptContext): Error {
  if (error instanceof Error) {
    const translated = context.translatePromptText(error.message);
    const nextError = new Error(translated);
    nextError.name = error.name;
    return nextError;
  }

  return new Error(context.translatePromptText(String(error)));
}

export function buildJudgeVerdictRepairRequest(input: {
  validationError: string;
  judgeRequestInput: unknown;
  judgePromptContext: Phase18JudgePromptContext;
  mapGame: MapGame;
  round: Round;
  roundNumber: number;
}): unknown {
  return removeUndefined({
    objective: "Repair the failed judge verdict as a short semantic draft. Core will materialize system facts such as currentSubTheme, canonical zones, margin and judgeScorecard.",
    validationError: input.validationError,
    roundId: input.round.id,
    roundNumber: input.roundNumber,
    mapName: input.mapGame.mapName,
    teamAId: input.judgePromptContext.requestInput.teamAId,
    teamBId: input.judgePromptContext.requestInput.teamBId,
    teamAName: readUnknownRecord(input.judgeRequestInput)?.teamAName,
    teamBName: readUnknownRecord(input.judgeRequestInput)?.teamBName,
    activeTeamAAgentIds: input.judgePromptContext.requestInput.activeTeamAAgentIds,
    activeTeamBAgentIds: input.judgePromptContext.requestInput.activeTeamBAgentIds,
    sideAssignment: input.judgePromptContext.requestInput.sideAssignment,
    defenderThesisContext: compactDefenderThesisContext(input.judgePromptContext.requestInput.defenderThesisContext),
    rubricProfileSummary: compactJudgeRubricProfile(input.judgePromptContext.requestInput.rubricProfile),
    allowedCanonicalZoneIds: input.judgePromptContext.requestInput.defenderThesisContext?.allowedCanonicalZoneIds,
    outputShape: {
      requiredFacts: [
        "winnerPromptTeamId or winnerTeamId",
        "roundWinType",
        "attackWinConditionMet",
        "defenseWinConditionMet",
        "confidence",
        "winnerReason",
        "loserFailureReason",
        "decisiveEvidenceText"
      ],
      scorecardPolicy:
        "Prefer omitting judgeScorecard. Core will materialize the final full judgeScorecard from rubricProfile and verdict facts."
    },
    repairRules: [
      "当前半场以 defenderThesisContext.defenderTeamThesis 为被检验主命题；攻方只是在 challenge 守方商业计划，不能把攻方自己的商业计划改写成主命题。",
      "不要输出 currentSubTheme、judgeScorecard.rubricProfile、winnerFromScore、marginFromScore，不要复制 mapSemanticContext、judgeRubricContext 或 originalJudgeInput。",
      "judgeScorecard 可以完全省略；如果输出 judgeScorecard，只会被系统当作轻量提示，最终完整评分表由代码生成。",
      "如果输出 teamScores，只能使用 objectiveScore、mapControlScore、submissionQualityScore、coordinationScore、economyAdjustedScore、riskControlScore、proofScore 七个固定维度，每条 evidence 不超过 18 个中文字符。",
      "winnerTeamId、loserTeamId、roundWinType、attackWinConditionMet、defenseWinConditionMet 必须与攻守关系一致。",
      "区域只输出 zoneFocusCandidates 或 diagnostic.mainAttackZoneId/mainDefenseZoneId 候选；未知区域会由系统回退到战术碰撞上下文。",
      "不要输出长判词。"
    ]
  });
}

export function buildJudgeNarrativeRequest(input: {
  verdict: JudgeVerdictDecision;
  judgeRequestInput: unknown;
  mapSemanticContext?: Record<string, unknown> | undefined;
  judgeRubricContext?: Record<string, unknown> | undefined;
}): unknown {
  return {
    objective: "Write the readable judge narrative and judgeInference for the locked verdict. Do not change verdict facts.",
    verdict: compactJudgeNarrativeVerdict(input.verdict),
    originalJudgeInput: compactJudgeNarrativeOriginalInput(input.judgeRequestInput),
    narrativeLocks: {
      winnerTeamId: input.verdict.winnerTeamId,
      loserTeamId: input.verdict.loserTeamId,
      roundWinType: input.verdict.roundWinType,
      mvpAgentId: input.verdict.mvpAgentId,
      mainAttackZoneId: input.verdict.diagnostic.mainAttackZoneId,
      mainDefenseZoneId: input.verdict.diagnostic.mainDefenseZoneId
    },
    mapSemanticContext: compactMapSemanticContext(input.mapSemanticContext),
    judgeRubricContext: compactJudgeRubricContext(input.judgeRubricContext)
  };
}

export function buildJudgeNarrativeRepairRequest(input: {
  requestInput: unknown;
  validationError: string;
}): unknown {
  return {
    ...(readUnknownRecord(input.requestInput) ?? {}),
    objective: "Repair the failed judge narrative. Return one complete JudgeNarrativeDecision only.",
    validationError: input.validationError,
    repairRules: [
      "不得改变 verdict 的胜方、败方、胜法、MVP、主攻区或主守区。",
      "judgeInference.source 必须是 judge_inference。",
      "boundary 必须说明战斗结果是裁判推断，不是 agent_action 原始事实。"
    ]
  };
}

export function buildJudgeReviewRequest(input: {
  originalJudgeResult: unknown;
  guardrailReason: string;
  judgeRequestInput: unknown;
  mapSemanticContext?: Record<string, unknown> | undefined;
  judgeRubricContext?: Record<string, unknown> | undefined;
}): unknown {
  return {
    objective:
      "Re-evaluate this suspicious judge result. You may keep the same winner only if the reason explicitly explains both teams' win conditions and why the loser failed.",
    guardrailReason: input.guardrailReason,
    originalJudgeResult: input.originalJudgeResult,
    originalJudgeInput: input.judgeRequestInput,
    mapSemanticContext: input.mapSemanticContext,
    judgeRubricContext: input.judgeRubricContext
  };
}

export function buildJudgeEvaluationEntry(input: {
  teamId: string;
  teamName: string;
  activeAgents: Agent[];
  teamPlan: TeamRoundPlanDecision | undefined;
  initialProposalSummary: Record<string, unknown> | undefined;
  coachContext: Record<string, unknown> | undefined;
}): Phase18JudgePromptContext["requestInput"]["evaluationOrder"][number] {
  const entry = removeUndefined({
    teamId: input.teamId,
    teamName: input.teamName,
    activeAgents: input.activeAgents.map((agent) => ({ id: agent.id, role: agent.role })),
    teamPlan: compactJudgeTeamPlan(input.teamPlan),
    initialProposalSummary: compactJudgeInitialProposalSummary(input.initialProposalSummary),
    coachContext: compactCoachContext(input.coachContext)
  });
  return entry as Phase18JudgePromptContext["requestInput"]["evaluationOrder"][number];
}

export function compactJudgeEvaluationOrder(
  entries: Phase18JudgePromptContext["requestInput"]["evaluationOrder"]
): Phase18JudgePromptContext["requestInput"]["evaluationOrder"] {
  return entries.map((entry) => {
    const teamPlan = readUnknownRecord(entry.teamPlan);
    const initialProposalSummary = readUnknownRecord(entry.initialProposalSummary);
    const coachContext = readUnknownRecord(entry.coachContext);
    return removeUndefined({
      teamId: entry.teamId,
      teamName: entry.teamName,
      activeAgents: entry.activeAgents.map((agent) => ({ id: agent.id, role: agent.role })),
      teamPlan: teamPlan ? compactJudgeTeamPlan(teamPlan as TeamRoundPlanDecision) : undefined,
      initialProposalSummary: compactJudgeInitialProposalSummary(initialProposalSummary),
      coachContext: compactCoachContext(coachContext)
    }) as Phase18JudgePromptContext["requestInput"]["evaluationOrder"][number];
  });
}

export function compactJudgeTeamPlan(plan: TeamRoundPlanDecision | undefined): Record<string, unknown> | undefined {
  if (!plan) {
    return undefined;
  }
  return removeUndefined({
    teamId: plan.teamId,
    side: plan.side,
    primaryIntent: truncatePromptText(plan.primaryIntent, 90),
    primaryZoneId: plan.primaryZoneId,
    secondaryZoneId: plan.secondaryZoneId,
    coordinationSummary: truncatePromptText(plan.coordinationSummary, 90),
    playerDirectives: plan.playerDirectives.map((directive) => ({
      agentId: directive.agentId,
      directive: truncatePromptText(directive.directive, 70)
    })),
    winCondition: truncatePromptText(plan.winCondition, 90),
    risk: truncatePromptText(plan.risk, 80),
    confidence: plan.confidence
  });
}

export function buildPromptTeam(actualTeam: Team, promptId: string, displayName: string, shortName: string): Team {
  return {
    ...actualTeam,
    id: promptId,
    displayName,
    shortName
  };
}

export function buildPromptAgent(actualAgent: Agent, promptTeamId: string, promptAgentId: string): Agent {
  return {
    ...actualAgent,
    id: promptAgentId,
    teamId: promptTeamId,
    displayName: promptAgentId.toUpperCase()
  };
}

export function sanitizeSideAssignmentForJudge(
  sideAssignment: SideAssignment,
  promptTeamIdByActualTeamId: Map<string, string>
): SideAssignment {
  const attackingTeamId = promptTeamIdByActualTeamId.get(sideAssignment.attackingTeamId);
  const defendingTeamId = promptTeamIdByActualTeamId.get(sideAssignment.defendingTeamId);
  if (!attackingTeamId || !defendingTeamId) {
    throw new Error("Missing prompt team ids for side assignment sanitization.");
  }

  return {
    ...sideAssignment,
    attackingTeamId,
    defendingTeamId
  };
}

export function buildJudgePromptContext(input: {
  roundNumber: number;
  sideAssignment: SideAssignment;
  teamA: Team;
  teamB: Team;
  activeA: Agent[];
  activeB: Agent[];
  teamABuyType: BuyType;
  teamBBuyType: BuyType;
  teamEconomyPlans: Record<
    string,
    { posture: EconomyPosture; lossCount: number; totalCash: number; postureReason: string }
  >;
  competitiveParityNote?: string | undefined;
  mapSemanticContext?: Record<string, unknown> | undefined;
  teamPlans?: Record<string, TeamRoundPlanDecision> | undefined;
  agentOutputs: AgentOutput[];
  tacticalCollision?: TacticalCollision;
  recentPublicRoundSummaries: string[];
  rubricProfile?: JudgeRubricProfile;
  teamAInitialProposalSummary?: Record<string, unknown> | undefined;
  teamBInitialProposalSummary?: Record<string, unknown> | undefined;
  teamACoachContext?: Record<string, unknown> | undefined;
  teamBCoachContext?: Record<string, unknown> | undefined;
}): Phase18JudgePromptContext {
  const promptTeamA = buildPromptTeam(input.teamA, "team_alpha", "Team Alpha", "ALPHA");
  const promptTeamB = buildPromptTeam(input.teamB, "team_bravo", "Team Bravo", "BRAVO");
  const promptActiveA = input.activeA.map((agent, index) => buildPromptAgent(agent, promptTeamA.id, `alpha_${index + 1}`));
  const promptActiveB = input.activeB.map((agent, index) => buildPromptAgent(agent, promptTeamB.id, `bravo_${index + 1}`));
  const promptTeamIdByActualTeamId = new Map<string, string>([
    [input.teamA.id, promptTeamA.id],
    [input.teamB.id, promptTeamB.id]
  ]);
  const actualTeamIdByPromptTeamId = new Map<string, string>([
    [promptTeamA.id, input.teamA.id],
    [promptTeamB.id, input.teamB.id]
  ]);
  const promptAgentIdByActualAgentId = new Map<string, string>();
  const actualAgentIdByPromptAgentId = new Map<string, string>();
  for (const [index, agent] of input.activeA.entries()) {
    const promptAgent = promptActiveA[index];
    if (promptAgent) {
      promptAgentIdByActualAgentId.set(agent.id, promptAgent.id);
      actualAgentIdByPromptAgentId.set(promptAgent.id, agent.id);
    }
  }
  for (const [index, agent] of input.activeB.entries()) {
    const promptAgent = promptActiveB[index];
    if (promptAgent) {
      promptAgentIdByActualAgentId.set(agent.id, promptAgent.id);
      actualAgentIdByPromptAgentId.set(promptAgent.id, agent.id);
    }
  }

  const sanitizeReplacements = buildJudgePromptSanitizeReplacements({
    teamA: input.teamA,
    teamB: input.teamB,
    promptTeamA,
    promptTeamB,
    activeA: input.activeA,
    activeB: input.activeB,
    promptActiveA,
    promptActiveB
  });
  const desanitizeReplacements = buildJudgePromptDesanitizeReplacements({
    teamA: input.teamA,
    teamB: input.teamB,
    promptTeamA,
    promptTeamB,
    activeA: input.activeA,
    activeB: input.activeB,
    promptActiveA,
    promptActiveB
  });
  const promptTeamPlans = input.teamPlans
    ? sanitizeTeamPlansForJudge(input.teamPlans, promptTeamIdByActualTeamId, promptAgentIdByActualAgentId, sanitizeReplacements)
    : undefined;
  const promptSideAssignment = sanitizeSideAssignmentForJudge(input.sideAssignment, promptTeamIdByActualTeamId);
  const judgeEvidenceDigest = buildJudgeEvidenceDigest({
    agentOutputs: input.agentOutputs,
    promptTeamIdByActualTeamId,
    promptAgentIdByActualAgentId,
    replacements: sanitizeReplacements
  });
  const defenderThesisContext = buildDefenderThesisContextForJudge({
    roundNumber: input.roundNumber,
    sideAssignment: input.sideAssignment,
    promptSideAssignment,
    teamA: input.teamA,
    teamB: input.teamB,
    teamPlans: input.teamPlans,
    defendingTeamInitialProposalSummary:
      input.sideAssignment.defendingTeamId === input.teamA.id ? input.teamAInitialProposalSummary : input.teamBInitialProposalSummary,
    mapSemanticContext: input.mapSemanticContext,
    replacements: sanitizeReplacements
  });
  const evaluationEntries: Phase18JudgePromptContext["requestInput"]["evaluationOrder"] = [
    buildJudgeEvaluationEntry({
      teamId: promptTeamA.id,
      teamName: promptTeamA.displayName,
      activeAgents: promptActiveA,
      initialProposalSummary: sanitizeJudgeRecord(stripJudgePrestigeFields(input.teamAInitialProposalSummary), sanitizeReplacements),
      coachContext: sanitizeJudgeRecord(stripJudgePrestigeFields(input.teamACoachContext), sanitizeReplacements),
      teamPlan: promptTeamPlans?.[promptTeamA.id]
    }),
    buildJudgeEvaluationEntry({
      teamId: promptTeamB.id,
      teamName: promptTeamB.displayName,
      activeAgents: promptActiveB,
      initialProposalSummary: sanitizeJudgeRecord(stripJudgePrestigeFields(input.teamBInitialProposalSummary), sanitizeReplacements),
      coachContext: sanitizeJudgeRecord(stripJudgePrestigeFields(input.teamBCoachContext), sanitizeReplacements),
      teamPlan: promptTeamPlans?.[promptTeamB.id]
    })
  ];
  const evaluationOrder = input.roundNumber % 2 === 0 ? [...evaluationEntries].reverse() : evaluationEntries;

  return {
    requestInput: {
      sideAssignment: promptSideAssignment,
      buyTypesByTeam: {
        [promptTeamA.id]: input.teamABuyType,
        [promptTeamB.id]: input.teamBBuyType
      },
      economyContextByTeam: {
        [promptTeamA.id]: {
          posture: input.teamEconomyPlans[input.teamA.id]?.posture ?? "eco",
          lossCount: input.teamEconomyPlans[input.teamA.id]?.lossCount ?? 1,
          totalCash: input.teamEconomyPlans[input.teamA.id]?.totalCash ?? 0,
          postureReason: input.teamEconomyPlans[input.teamA.id]?.postureReason ?? "默认经济态势。"
        },
        [promptTeamB.id]: {
          posture: input.teamEconomyPlans[input.teamB.id]?.posture ?? "eco",
          lossCount: input.teamEconomyPlans[input.teamB.id]?.lossCount ?? 1,
          totalCash: input.teamEconomyPlans[input.teamB.id]?.totalCash ?? 0,
          postureReason: input.teamEconomyPlans[input.teamB.id]?.postureReason ?? "默认经济态势。"
        }
      },
      ...(input.competitiveParityNote ? { competitiveParityNote: input.competitiveParityNote } : {}),
      recentPublicRoundRecapPolicy:
        "公开历史摘要只用于说明比分、胜法和经济阶段，不得把连胜、连败或旧回合叙事直接当作当前回合的强弱证明。",
      defenderThesisContext,
      ...(input.rubricProfile ? { rubricProfile: input.rubricProfile } : {}),
      ...(input.tacticalCollision ? { tacticalCollision: sanitizeJudgeValue(input.tacticalCollision, sanitizeReplacements) as TacticalCollision } : {}),
      evaluationOrder,
      teamAId: promptTeamA.id,
      teamBId: promptTeamB.id,
      teamAName: promptTeamA.displayName,
      teamBName: promptTeamB.displayName,
      activeTeamAAgentIds: promptActiveA.map((agent) => agent.id),
      activeTeamBAgentIds: promptActiveB.map((agent) => agent.id),
      judgeEvidenceDigest,
      recentPublicRoundSummaries: input.recentPublicRoundSummaries.map((summary) => sanitizeJudgeText(summary, sanitizeReplacements))
    },
    ...(input.teamPlans ? { actualTeamPlans: input.teamPlans } : {}),
    actualAgentOutputs: input.agentOutputs,
    validateAndTranslate: (judgeResult: JudgeResult) => {
      const promptMvpMaterializedJudgeResult = materializeJudgePromptMvpAgentId({
        judgeResult,
        teamA: promptTeamA,
        teamB: promptTeamB,
        activeA: promptActiveA,
        activeB: promptActiveB
      });
      const promptMarginNormalizedJudgeResult = normalizeJudgeResultMarginForReason(promptMvpMaterializedJudgeResult);
      const promptValidated = validatePromptJudgeResult({
        judgeResult: promptMarginNormalizedJudgeResult,
        teamA: promptTeamA,
        teamB: promptTeamB,
        activeA: promptActiveA,
        activeB: promptActiveB,
        sideAssignment: promptSideAssignment,
        ...(promptTeamPlans ? { teamPlans: promptTeamPlans } : {})
      });
      const actualWinnerTeamId = actualTeamIdByPromptTeamId.get(promptValidated.winnerTeamId);
      const actualLoserTeamId = actualTeamIdByPromptTeamId.get(promptValidated.loserTeamId);
      const actualMvpAgentId = actualAgentIdByPromptAgentId.get(promptValidated.mvpAgentId);
      if (!actualWinnerTeamId || !actualLoserTeamId || !actualMvpAgentId) {
        throw new Error("Judge prompt translation failed to map prompt ids back to actual ids.");
      }
      return {
        ...promptValidated,
        winnerTeamId: actualWinnerTeamId,
        loserTeamId: actualLoserTeamId,
        mvpAgentId: actualMvpAgentId,
        reason: normalizeChineseFirstJudgeText(desanitizeJudgeText(promptValidated.reason, desanitizeReplacements)),
        ...(promptValidated.judgeInference
          ? { judgeInference: desanitizeJudgeInference(promptValidated.judgeInference, desanitizeReplacements) }
          : {}),
        ...(promptValidated.judgeScorecard
          ? { judgeScorecard: desanitizeJudgeScorecard(promptValidated.judgeScorecard, actualTeamIdByPromptTeamId, desanitizeReplacements) }
          : {}),
        ...(promptValidated.diagnostic
          ? { diagnostic: desanitizeJudgeDiagnostic(promptValidated.diagnostic, desanitizeReplacements) }
          : {})
      };
    },
    translatePromptText: (value: string) => desanitizeJudgeText(value, desanitizeReplacements)
  };
}

function buildDefenderThesisContextForJudge(input: {
  roundNumber: number;
  sideAssignment: SideAssignment;
  promptSideAssignment: SideAssignment;
  teamA: Team;
  teamB: Team;
  teamPlans?: Record<string, TeamRoundPlanDecision> | undefined;
  defendingTeamInitialProposalSummary?: Record<string, unknown> | undefined;
  mapSemanticContext?: Record<string, unknown> | undefined;
  replacements: Array<{ source: string; target: string }>;
}): DefenderThesisContext {
  const attackingTeam = input.sideAssignment.attackingTeamId === input.teamA.id ? input.teamA : input.teamB;
  const defendingTeam = input.sideAssignment.defendingTeamId === input.teamA.id ? input.teamA : input.teamB;
  const attackerPlan = input.teamPlans?.[attackingTeam.id];
  const defenderPlan = input.teamPlans?.[defendingTeam.id];
  const defenderProposal = input.defendingTeamInitialProposalSummary;
  const proposition = readUnknownRecord(input.mapSemanticContext?.proposition);
  const roundSubTheme = proposition ? resolvePhase18SubTheme(proposition, input.roundNumber) : undefined;
  const defenderPrimaryZoneId = normalizeJudgeZoneId(defenderPlan?.primaryZoneId) ?? "conversion_site_a";
  const attackerPrimaryZoneId = normalizeJudgeZoneId(attackerPlan?.primaryZoneId) ?? "buyer_mid";
  const defenderTeamThesis = sanitizeJudgeText(
    pickString(defenderProposal, "teamThesis") ?? `${defendingTeam.displayName} 的本半场商业计划必须经受攻方挑战。`,
    input.replacements
  );
  const mustHoldClaims = pickStringArray(defenderProposal, "mustHoldClaims");
  const defenderMustHoldClaims = (mustHoldClaims.length
    ? mustHoldClaims
    : [defenderPlan?.winCondition ?? "守方必须守住当前商业计划的核心成立点。"]
  ).map((claim) => sanitizeJudgeText(claim, input.replacements));
  const attackerChallengeBrief = sanitizeJudgeText(
    `${attackingTeam.displayName} 本回合不是证明自己的独立商业计划，而是围绕 ${defendingTeam.displayName} 的守方 thesis 发起 challenge：${attackerPlan?.primaryIntent ?? attackerPlan?.winCondition ?? "攻击守方核心成立点的机会缺口。"}`,
    input.replacements
  );

  return defenderThesisContextSchema.parse({
    attackingTeamId: input.promptSideAssignment.attackingTeamId,
    defendingTeamId: input.promptSideAssignment.defendingTeamId,
    half: input.sideAssignment.half,
    defenderTeamThesis,
    defenderMustHoldClaims,
    defenderPrimaryZoneId,
    attackerChallengeBrief,
    attackerPrimaryZoneId,
    roundSubTheme: roundSubTheme ?? "默认回合子命题",
    allowedCanonicalZoneIds: [...REQUIRED_TACTICAL_ZONE_IDS],
    thesisEvidenceSources: ["team_plan", "submitted_output", "zone_relation", "economy", "judge_rubric_context", "map_semantic_context"],
    dimensionRequirements: defenderThesisDimensionRequirements
  });
}

function materializeJudgePromptMvpAgentId(input: {
  judgeResult: JudgeResult;
  teamA: Team;
  teamB: Team;
  activeA: Agent[];
  activeB: Agent[];
}): JudgeResult {
  const winnerAgents =
    input.judgeResult.winnerTeamId === input.teamA.id
      ? input.activeA
      : input.judgeResult.winnerTeamId === input.teamB.id
        ? input.activeB
        : [];
  if (winnerAgents.some((agent) => agent.id === input.judgeResult.mvpAgentId)) {
    return input.judgeResult;
  }
  const fallbackMvpAgentId = winnerAgents[0]?.id;
  if (!fallbackMvpAgentId) {
    return input.judgeResult;
  }
  const note = `LLM candidate mvpAgentId ${input.judgeResult.mvpAgentId}; code materialized MVP ${fallbackMvpAgentId} from final winner roster.`;
  return {
    ...input.judgeResult,
    mvpAgentId: fallbackMvpAgentId,
    ...(input.judgeResult.judgeScorecard
      ? {
          judgeScorecard: {
            ...input.judgeResult.judgeScorecard,
            normalizedFieldNotes: [...(input.judgeResult.judgeScorecard.normalizedFieldNotes ?? []), note]
          }
        }
      : {})
  };
}

function desanitizeJudgeDiagnostic(
  diagnostic: JudgeDiagnostic,
  replacements: Array<{ source: string; target: string }>
): JudgeDiagnostic {
  return {
    currentSubTheme: normalizeChineseFirstJudgeText(desanitizeJudgeText(diagnostic.currentSubTheme, replacements)),
    attackedOpportunityGap: normalizeChineseFirstJudgeText(desanitizeJudgeText(diagnostic.attackedOpportunityGap, replacements)),
    defendedCoreProposition: normalizeChineseFirstJudgeText(desanitizeJudgeText(diagnostic.defendedCoreProposition, replacements)),
    mainAttackZoneId: diagnostic.mainAttackZoneId,
    mainDefenseZoneId: diagnostic.mainDefenseZoneId,
    ...(diagnostic.zoneRelation
      ? {
          zoneRelation: {
            attackZoneId: diagnostic.zoneRelation.attackZoneId,
            defenseZoneId: diagnostic.zoneRelation.defenseZoneId,
            relationType: diagnostic.zoneRelation.relationType,
            relationSummary: normalizeChineseFirstJudgeText(desanitizeJudgeText(diagnostic.zoneRelation.relationSummary, replacements)),
            outcomeImpact: normalizeChineseFirstJudgeText(desanitizeJudgeText(diagnostic.zoneRelation.outcomeImpact, replacements))
          }
        }
      : {}),
    decisiveEvidence: normalizeChineseFirstJudgeText(desanitizeJudgeText(diagnostic.decisiveEvidence, replacements))
  };
}

function desanitizeJudgeInference(
  inference: NonNullable<JudgeResult["judgeInference"]>,
  replacements: Array<{ source: string; target: string }>
): NonNullable<JudgeResult["judgeInference"]> {
  return {
    source: "judge_inference",
    boundary: normalizeChineseFirstJudgeText(desanitizeJudgeText(inference.boundary, replacements)),
    csResolution: normalizeChineseFirstJudgeText(desanitizeJudgeText(inference.csResolution, replacements)),
    combatNarrative: normalizeChineseFirstJudgeText(desanitizeJudgeText(inference.combatNarrative, replacements)),
    evidenceBasis: inference.evidenceBasis.map((item) => normalizeChineseFirstJudgeText(desanitizeJudgeText(item, replacements)))
  };
}

function desanitizeJudgeScorecard(
  scorecard: JudgeScorecard,
  actualTeamIdByPromptTeamId: Map<string, string>,
  replacements: Array<{ source: string; target: string }>
): JudgeScorecard {
  const teamScores = Object.fromEntries(
    Object.entries(scorecard.teamScores).map(([promptTeamId, teamScore]) => {
      const actualTeamId = actualTeamIdByPromptTeamId.get(promptTeamId) ?? teamScore.teamId;
      return [
        actualTeamId,
        {
          ...teamScore,
          teamId: actualTeamId,
          objectiveScore: desanitizeJudgeScoreDimension(teamScore.objectiveScore, replacements),
          mapControlScore: desanitizeJudgeScoreDimension(teamScore.mapControlScore, replacements),
          submissionQualityScore: desanitizeJudgeScoreDimension(teamScore.submissionQualityScore, replacements),
          coordinationScore: desanitizeJudgeScoreDimension(teamScore.coordinationScore, replacements),
          economyAdjustedScore: desanitizeJudgeScoreDimension(teamScore.economyAdjustedScore, replacements),
          riskControlScore: desanitizeJudgeScoreDimension(teamScore.riskControlScore, replacements),
          proofScore: desanitizeJudgeScoreDimension(teamScore.proofScore, replacements)
        }
      ];
    })
  );
  return {
    ...scorecard,
    ...(scorecard.defenderThesisContext
      ? {
          defenderThesisContext: desanitizeDefenderThesisContext(
            scorecard.defenderThesisContext,
            actualTeamIdByPromptTeamId,
            replacements
          )
        }
      : {}),
    teamScores,
    winnerFromScore: actualTeamIdByPromptTeamId.get(scorecard.winnerFromScore) ?? scorecard.winnerFromScore,
    roundWinTypeJustification: normalizeChineseFirstJudgeText(desanitizeJudgeText(scorecard.roundWinTypeJustification, replacements)),
    ...(scorecard.scoreOverride
      ? {
          scoreOverride: {
            ...scorecard.scoreOverride,
            reason: normalizeChineseFirstJudgeText(desanitizeJudgeText(scorecard.scoreOverride.reason, replacements))
          }
        }
      : {})
  };
}

function desanitizeDefenderThesisContext(
  context: DefenderThesisContext,
  actualTeamIdByPromptTeamId: Map<string, string>,
  replacements: Array<{ source: string; target: string }>
): DefenderThesisContext {
  return {
    ...context,
    attackingTeamId: actualTeamIdByPromptTeamId.get(context.attackingTeamId) ?? context.attackingTeamId,
    defendingTeamId: actualTeamIdByPromptTeamId.get(context.defendingTeamId) ?? context.defendingTeamId,
    defenderTeamThesis: normalizeChineseFirstJudgeText(desanitizeJudgeText(context.defenderTeamThesis, replacements)),
    defenderMustHoldClaims: context.defenderMustHoldClaims.map((claim) =>
      normalizeChineseFirstJudgeText(desanitizeJudgeText(claim, replacements))
    ),
    attackerChallengeBrief: normalizeChineseFirstJudgeText(desanitizeJudgeText(context.attackerChallengeBrief, replacements))
  };
}

function desanitizeJudgeScoreDimension<T extends { evidence: string }>(
  dimension: T,
  replacements: Array<{ source: string; target: string }>
): T {
  return {
    ...dimension,
    evidence: normalizeChineseFirstJudgeText(desanitizeJudgeText(dimension.evidence, replacements))
  };
}

function buildJudgePromptSanitizeReplacements(input: {
  teamA: Team;
  teamB: Team;
  promptTeamA: Team;
  promptTeamB: Team;
  activeA: Agent[];
  activeB: Agent[];
  promptActiveA: Agent[];
  promptActiveB: Agent[];
}): Array<{ source: string; target: string }> {
  const replacements: Array<{ source: string; target: string }> = [
    { source: input.teamA.id, target: input.promptTeamA.id },
    { source: input.teamB.id, target: input.promptTeamB.id },
    { source: input.teamA.displayName, target: input.promptTeamA.displayName },
    { source: input.teamB.displayName, target: input.promptTeamB.displayName },
    { source: input.teamA.shortName, target: input.promptTeamA.shortName },
    { source: input.teamB.shortName, target: input.promptTeamB.shortName }
  ];
  for (const [index, agent] of input.activeA.entries()) {
    const promptAgent = input.promptActiveA[index];
    if (promptAgent) {
      replacements.push(
        { source: agent.id, target: promptAgent.id },
        { source: agent.displayName, target: promptAgent.displayName }
      );
    }
  }
  for (const [index, agent] of input.activeB.entries()) {
    const promptAgent = input.promptActiveB[index];
    if (promptAgent) {
      replacements.push(
        { source: agent.id, target: promptAgent.id },
        { source: agent.displayName, target: promptAgent.displayName }
      );
    }
  }
  return replacements.filter((entry) => entry.source && entry.target && entry.source !== entry.target);
}

function buildJudgePromptDesanitizeReplacements(input: {
  teamA: Team;
  teamB: Team;
  promptTeamA: Team;
  promptTeamB: Team;
  activeA: Agent[];
  activeB: Agent[];
  promptActiveA: Agent[];
  promptActiveB: Agent[];
}): Array<{ source: string; target: string }> {
  return buildJudgePromptSanitizeReplacements({
    teamA: input.promptTeamA,
    teamB: input.promptTeamB,
    promptTeamA: input.teamA,
    promptTeamB: input.teamB,
    activeA: input.promptActiveA,
    activeB: input.promptActiveB,
    promptActiveA: input.activeA,
    promptActiveB: input.activeB
  });
}

function sanitizeTeamPlansForJudge(
  teamPlans: Record<string, TeamRoundPlanDecision>,
  promptTeamIdByActualTeamId: Map<string, string>,
  promptAgentIdByActualAgentId: Map<string, string>,
  replacements: Array<{ source: string; target: string }>
): Record<string, TeamRoundPlanDecision> {
  return Object.fromEntries(
    Object.entries(teamPlans).map(([actualTeamId, plan]) => {
      const promptTeamId = promptTeamIdByActualTeamId.get(actualTeamId);
      if (!promptTeamId) {
        throw new Error(`Missing prompt team id for team plan sanitization: ${actualTeamId}`);
      }
      return [
        promptTeamId,
        {
          ...plan,
          teamId: promptTeamId,
          primaryIntent: sanitizeJudgeText(plan.primaryIntent, replacements),
          coordinationSummary: sanitizeJudgeText(plan.coordinationSummary, replacements),
          winCondition: sanitizeJudgeText(plan.winCondition, replacements),
          risk: sanitizeJudgeText(plan.risk, replacements),
          playerDirectives: plan.playerDirectives.map((directive) => ({
            ...directive,
            agentId: promptAgentIdByActualAgentId.get(directive.agentId) ?? directive.agentId,
            directive: sanitizeJudgeText(directive.directive, replacements)
          }))
        }
      ];
    })
  );
}

function buildJudgeEvidenceDigest(input: {
  agentOutputs: AgentOutput[];
  promptTeamIdByActualTeamId: Map<string, string>;
  promptAgentIdByActualAgentId: Map<string, string>;
  replacements: Array<{ source: string; target: string }>;
}): Phase18JudgePromptContext["requestInput"]["judgeEvidenceDigest"] {
  const outputsByTeam = new Map<string, Array<AgentOutput & Partial<SubmittedAgentOutput>>>();
  for (const output of input.agentOutputs) {
    const promptTeamId = input.promptTeamIdByActualTeamId.get(output.teamId);
    if (!promptTeamId) {
      throw new Error(`Missing prompt team id for judge evidence digest: ${output.teamId}`);
    }
    outputsByTeam.set(promptTeamId, [...(outputsByTeam.get(promptTeamId) ?? []), output as AgentOutput & Partial<SubmittedAgentOutput>]);
  }
  const maxItems = Math.max(0, ...[...outputsByTeam.values()].map((outputs) => outputs.length));
  const maxEvidencePerItem = 2;
  return Object.fromEntries(
    [...outputsByTeam.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([teamId, outputs]) => [
        teamId,
        {
          maxItems,
          maxEvidencePerItem,
          items: outputs
            .slice()
            .sort((left, right) => left.agentId.localeCompare(right.agentId))
            .slice(0, maxItems)
            .map((output) => {
              const promptAgentId = input.promptAgentIdByActualAgentId.get(output.agentId) ?? output.agentId;
              const item: {
                agentId: string;
                outputBudget?: number;
                economyPosture?: string;
                omittedFieldCount: number;
                evidence: string[];
              } = {
                agentId: promptAgentId,
                omittedFieldCount: Array.isArray(output.omittedFields) ? output.omittedFields.length : 0,
                evidence: summarizeSubmittedOutputEvidence(output, input.replacements).slice(0, maxEvidencePerItem)
              };
              if (typeof output.outputBudget === "number") {
                item.outputBudget = output.outputBudget;
              }
              if (output.economyPosture) {
                item.economyPosture = output.economyPosture;
              }
              return item;
            })
        }
      ])
  );
}

function summarizeSubmittedOutputEvidence(
  output: AgentOutput & Partial<SubmittedAgentOutput>,
  replacements: Array<{ source: string; target: string }>
): string[] {
  const detail = output.actionDetail;
  const candidates = [
    detail?.roundObjective,
    detail?.executionPlan,
    detail?.coordinationPlan,
    detail?.roleResponsibilityUsage,
    detail?.expectedContribution,
    output.action,
    output.gateSummary
  ];
  return candidates
    .map((value) => normalizePromptText(value))
    .filter((value): value is string => Boolean(value))
    .map((value) => sanitizeJudgeText(value, replacements))
    .map((value) => (value.length > 80 ? `${value.slice(0, 77)}...` : value))
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 2);
}

function sanitizeJudgeRecord(
  value: Record<string, unknown> | undefined,
  replacements: Array<{ source: string; target: string }>
): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  return sanitizeJudgeValue(value, replacements) as Record<string, unknown>;
}

function stripJudgePrestigeFields(value: unknown): Record<string, unknown> | undefined {
  const record = readUnknownRecord(value);
  if (!record) {
    return undefined;
  }
  const blockedKeys = new Set(["frontendSummary", "personaSummary", "prestige", "seed", "star", "ranking"]);
  return Object.fromEntries(Object.entries(record).filter(([key]) => !blockedKeys.has(key)));
}

function sanitizeJudgeText(value: string, replacements: Array<{ source: string; target: string }>): string {
  let output = value;
  for (const replacement of replacements) {
    output = output.replace(buildJudgeLiteralPattern(replacement.source), replacement.target);
  }
  return output;
}

function sanitizeJudgeValue(value: unknown, replacements: Array<{ source: string; target: string }>): unknown {
  if (typeof value === "string") {
    return sanitizeJudgeText(value, replacements);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJudgeValue(item, replacements));
  }
  if (readUnknownRecord(value)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, sanitizeJudgeValue(item, replacements)]));
  }
  return value;
}

function desanitizeJudgeText(value: string, replacements: Array<{ source: string; target: string }>): string {
  let output = value;
  for (const replacement of replacements) {
    output = output.replace(buildJudgeLiteralPattern(replacement.source), replacement.target);
  }
  return output;
}

function normalizeChineseFirstJudgeText(value: string): string {
  const replacements = [
    { source: "failed to prove", target: "未能证明" },
    { source: "win condition succeeded", target: "胜利条件成立" },
    { source: "win condition failed", target: "胜利条件失守" },
    { source: "rather than", target: "而不是" }
  ] as const;
  let output = value;
  for (const replacement of replacements) {
    output = output.replace(buildJudgeLiteralPattern(replacement.source), replacement.target);
  }
  return output.replace(/\s{2,}/g, " ").trim();
}

function normalizeJudgeZoneId(value: unknown): string | undefined {
  const text = normalizePromptText(value)?.trim();
  return text ? normalizeKnownTacticalZoneId(text) : undefined;
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

function buildJudgeLiteralPattern(value: string): RegExp {
  const escaped = escapeRegExp(value);
  return /^[A-Za-z0-9_]+$/.test(value) ? new RegExp(`\\b${escaped}\\b`, "gi") : new RegExp(escaped, "gi");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const defenderThesisDimensionRequirements: JudgeDimensionRequirements = {
  objectiveScore: {
    challengeRequirement: "攻方是否明确攻击守方商业计划的关键漏洞，并把推进、清点、下包或转点转化为有效 challenge。",
    defenseRequirement: "守方是否守住商业计划的关键成立点，并通过拖时、回防、反清或拆解阻断攻方 challenge。"
  },
  mapControlScore: {
    challengeRequirement: "攻方是否打到与守方核心命题相关的主攻区、弱防区或转点路径。",
    defenseRequirement: "守方是否把资源部署在正确命题焦点区，并控制攻方进入关键论证区域。"
  },
  submissionQualityScore: {
    challengeRequirement: "攻方 SubmittedOutput 是否提出具体、可审计的 challenge，而不是泛泛反对。",
    defenseRequirement: "守方 SubmittedOutput 是否具体补强、解释或防住被挑战的商业计划。"
  },
  coordinationScore: {
    challengeRequirement: "攻方队内角色是否分工挑战守方 thesis 的不同漏洞。",
    defenseRequirement: "守方队内角色是否分工守住 thesis 的产品、用户、商业和执行闭环。"
  },
  economyAdjustedScore: {
    challengeRequirement: "攻方在当前经济和输出预算下，是否优先攻击守方最高价值漏洞。",
    defenseRequirement: "守方在当前经济和输出预算下，是否优先守住最关键成立点。"
  },
  riskControlScore: {
    challengeRequirement: "攻方是否避免稻草人式 challenge、错误攻击非核心点、过度冒进或超时。",
    defenseRequirement: "守方是否避免空泛防守、过度保守、漏掉真实漏洞或用大词掩盖断点。"
  },
  proofScore: {
    challengeRequirement: "攻方是否证明守方机会不真、痛点不足、切口不锋利、时机不对或执行不闭环。",
    defenseRequirement: "守方是否证明自身机会真实、痛点强、切口可打、时机可信且执行闭环。"
  }
};

function compactDefenderThesisContext(context: DefenderThesisContext | undefined): unknown {
  if (!context) {
    return undefined;
  }
  return {
    attackingTeamId: context.attackingTeamId,
    defendingTeamId: context.defendingTeamId,
    half: context.half,
    defenderTeamThesis: context.defenderTeamThesis,
    defenderMustHoldClaims: context.defenderMustHoldClaims.slice(0, 3),
    defenderPrimaryZoneId: context.defenderPrimaryZoneId,
    attackerChallengeBrief: context.attackerChallengeBrief,
    attackerPrimaryZoneId: context.attackerPrimaryZoneId,
    roundSubTheme: context.roundSubTheme,
    allowedCanonicalZoneIds: context.allowedCanonicalZoneIds,
    thesisEvidenceSources: context.thesisEvidenceSources.slice(0, 4)
  };
}

function compactJudgeRubricProfile(profile: JudgeRubricProfile | undefined): unknown {
  if (!profile) {
    return undefined;
  }
  return {
    profileId: profile.profileId,
    baseVersion: profile.baseVersion,
    dimensions: profile.dimensions,
    dimensionWeights: profile.dimensionWeights,
    mapAdjustment: {
      applied: profile.mapAdjustment.applied,
      summary: profile.mapAdjustment.summary,
      emphasizedDimensions: profile.mapAdjustment.emphasizedDimensions
    },
    roundAdjustment: {
      subTheme: profile.roundAdjustment.subTheme,
      summary: profile.roundAdjustment.summary,
      emphasizedDimensions: profile.roundAdjustment.emphasizedDimensions
    },
    evidenceRequirements: profile.evidenceRequirements.slice(0, 4),
    forbiddenBiases: profile.forbiddenBiases.slice(0, 4)
  };
}

function compactJudgeInitialProposalSummary(summary: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!summary) {
    return undefined;
  }
  return removeUndefined({
    teamThesis: truncatePromptText(pickString(summary, "teamThesis"), 160),
    mustHoldClaims: pickStringArray(summary, "mustHoldClaims").slice(0, 2).map((entry) => truncatePromptText(entry, 80)),
    failureModes: pickStringArray(summary, "failureModes").slice(0, 2).map((entry) => truncatePromptText(entry, 80))
  });
}

function compactCoachContext(context: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!context) {
    return undefined;
  }
  return removeUndefined({
    coachingThesis: truncatePromptText(pickString(context, "coachingThesis"), 120),
    keptBeliefs: pickStringArray(context, "keptBeliefs").slice(0, 2).map((entry) => truncatePromptText(entry, 90)),
    brokenBeliefs: pickStringArray(context, "brokenBeliefs").slice(0, 2).map((entry) => truncatePromptText(entry, 90))
  });
}

function compactJudgeNarrativeVerdict(verdict: JudgeVerdictDecision): Record<string, unknown> {
  const scorecard = verdict.judgeScorecard;
  const judgeInference = readUnknownRecord(verdict.judgeInference);
  return removeUndefined({
    winnerTeamId: verdict.winnerTeamId,
    loserTeamId: verdict.loserTeamId,
    roundWinType: verdict.roundWinType,
    margin: verdict.margin,
    attackWinConditionMet: verdict.attackWinConditionMet,
    defenseWinConditionMet: verdict.defenseWinConditionMet,
    mvpAgentId: verdict.mvpAgentId,
    confidence: verdict.confidence,
    reason: truncatePromptText(normalizePromptText(verdict.reason), 360),
    judgeInference: judgeInference
      ? removeUndefined({
          source: pickString(judgeInference, "source"),
          boundary: truncatePromptText(pickString(judgeInference, "boundary"), 180),
          csResolution: truncatePromptText(pickString(judgeInference, "csResolution"), 160),
          combatNarrative: truncatePromptText(pickString(judgeInference, "combatNarrative"), 220),
          evidenceBasis: pickStringArray(judgeInference, "evidenceBasis").slice(0, 4).map((entry) => truncatePromptText(entry, 90))
        })
      : undefined,
    diagnostic: removeUndefined({
      currentSubTheme: verdict.diagnostic.currentSubTheme,
      attackedOpportunityGap: truncatePromptText(verdict.diagnostic.attackedOpportunityGap, 180),
      defendedCoreProposition: truncatePromptText(verdict.diagnostic.defendedCoreProposition, 180),
      mainAttackZoneId: verdict.diagnostic.mainAttackZoneId,
      mainDefenseZoneId: verdict.diagnostic.mainDefenseZoneId,
      zoneRelation: verdict.diagnostic.zoneRelation
        ? {
            attackZoneId: verdict.diagnostic.zoneRelation.attackZoneId,
            defenseZoneId: verdict.diagnostic.zoneRelation.defenseZoneId,
            relationType: verdict.diagnostic.zoneRelation.relationType,
            relationSummary: truncatePromptText(verdict.diagnostic.zoneRelation.relationSummary, 160),
            outcomeImpact: truncatePromptText(verdict.diagnostic.zoneRelation.outcomeImpact, 160)
          }
        : undefined,
      decisiveEvidence: truncatePromptText(verdict.diagnostic.decisiveEvidence, 220)
    }),
    scorecardSummary: scorecard
      ? removeUndefined({
          scorecardSource: scorecard.scorecardSource,
          winnerFromScore: scorecard.winnerFromScore,
          marginFromScore: scorecard.marginFromScore,
          scoreDelta: scorecard.scoreDelta,
          decisiveDimensions: scorecard.decisiveDimensions,
          teamTotals: Object.fromEntries(
            Object.entries(scorecard.teamScores).map(([teamId, teamScore]) => [
              teamId,
              {
                side: teamScore.side,
                totalScore: teamScore.totalScore
              }
            ])
          )
        })
      : undefined
  });
}

function compactJudgeNarrativeOriginalInput(value: unknown): Record<string, unknown> | undefined {
  const record = readUnknownRecord(value);
  if (!record) {
    return undefined;
  }
  return removeUndefined({
    roundId: record.roundId,
    roundNumber: record.roundNumber,
    mapName: truncatePromptText(pickString(record, "mapName"), 80),
    scoreBeforeRound: record.scoreBeforeRound,
    sideAssignment: record.sideAssignment,
    teamAId: pickString(record, "teamAId"),
    teamBId: pickString(record, "teamBId"),
    teamAName: pickString(record, "teamAName"),
    teamBName: pickString(record, "teamBName"),
    activeTeamAAgentIds: Array.isArray(record.activeTeamAAgentIds) ? record.activeTeamAAgentIds : undefined,
    activeTeamBAgentIds: Array.isArray(record.activeTeamBAgentIds) ? record.activeTeamBAgentIds : undefined,
    mapSemanticContext: compactMapSemanticContext(readUnknownRecord(record.mapSemanticContext)),
    scoreTensionGuardrail: truncatePromptText(pickString(record, "scoreTensionGuardrail"), 220),
    tacticalCollision: compactTacticalCollisionForPrompt(record.tacticalCollision),
    judgeEvidenceDigest: compactJudgeNarrativeEvidenceDigest(record.judgeEvidenceDigest),
    recentPublicRoundSummaries: Array.isArray(record.recentPublicRoundSummaries)
      ? record.recentPublicRoundSummaries.slice(-2).map((summary) => truncatePromptText(String(summary), 120))
      : undefined
  });
}

function compactJudgeNarrativeEvidenceDigest(value: unknown): Record<string, unknown> | undefined {
  const digest = readUnknownRecord(value);
  if (!digest) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(digest).map(([teamId, teamValue]) => {
      const teamDigest = readUnknownRecord(teamValue);
      const items = Array.isArray(teamDigest?.items)
        ? teamDigest.items.slice(0, 3).map((item) => {
            const itemRecord = readUnknownRecord(item);
            return removeUndefined({
              agentId: pickString(itemRecord, "agentId"),
              role: pickString(itemRecord, "role"),
              evidence: pickStringArray(itemRecord, "evidence").slice(0, 2).map((entry) => truncatePromptText(entry, 70))
            });
          })
        : [];
      return [
        teamId,
        removeUndefined({
          maxItems: teamDigest?.maxItems,
          maxEvidencePerItem: teamDigest?.maxEvidencePerItem,
          items
        })
      ];
    })
  );
}

function compactTacticalCollisionForPrompt(value: unknown): Record<string, unknown> | undefined {
  const record = readUnknownRecord(value);
  if (!record) {
    return undefined;
  }
  return removeUndefined({
    primaryZoneId: pickString(record, "primaryZoneId"),
    primaryCollisionZoneId: pickString(record, "primaryCollisionZoneId"),
    secondaryCollisionZoneId: pickString(record, "secondaryCollisionZoneId"),
    result: pickString(record, "result"),
    attackScore: typeof record.attackScore === "number" ? record.attackScore : undefined,
    defenseScore: typeof record.defenseScore === "number" ? record.defenseScore : undefined,
    attackBaseScore: typeof record.attackBaseScore === "number" ? record.attackBaseScore : undefined,
    defenseBaseScore: typeof record.defenseBaseScore === "number" ? record.defenseBaseScore : undefined,
    scoreDelta: typeof record.scoreDelta === "number" ? record.scoreDelta : undefined,
    summary: truncatePromptText(pickString(record, "summary"), 160),
    reason: truncatePromptText(pickString(record, "reason"), 180)
  });
}

function compactMapSemanticContext(context: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!context) {
    return undefined;
  }
  const proposition = readUnknownRecord(context.proposition);
  return removeUndefined({
    mapId: context.mapId,
    mapName: context.mapName,
    proposition: proposition
      ? removeUndefined({
          mapThesis: proposition.mapThesis,
          regulationRoundThemes: Array.isArray(proposition.regulationRoundThemes) ? proposition.regulationRoundThemes.slice(0, 6) : undefined,
          overtimeRoundThemes: Array.isArray(proposition.overtimeRoundThemes) ? proposition.overtimeRoundThemes.slice(0, 3) : undefined
        })
      : undefined
  });
}

function compactJudgeRubricContext(context: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!context) {
    return undefined;
  }
  return removeUndefined({
    rubricId: context.rubricId,
    version: context.version,
    judgeAxes: Array.isArray(context.judgeAxes) ? context.judgeAxes.slice(0, 5) : undefined,
    biasGuards: Array.isArray(context.biasGuards) ? context.biasGuards.slice(0, 4) : undefined,
    reviewTriggers: Array.isArray(context.reviewTriggers) ? context.reviewTriggers.slice(0, 4) : undefined
  });
}

function normalizePromptText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function readUnknownRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function pickString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  return record && typeof record[key] === "string" ? (record[key] as string) : undefined;
}

function pickStringArray(record: Record<string, unknown> | undefined, key: string): string[] {
  if (!record || !Array.isArray(record[key])) {
    return [];
  }

  return (record[key] as unknown[]).filter((item): item is string => typeof item === "string");
}

function truncatePromptText(value: string | undefined, maxLength: number): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
