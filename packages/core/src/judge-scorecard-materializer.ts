import {
  judgeScoreDimensions,
  judgeScorecardSchema,
  type DefenderThesisContext,
  type JudgeResult,
  type JudgeRoundWinType,
  type JudgeRubricProfile,
  type JudgeScoreDimension,
  type JudgeScoreDimensionWeights,
  type JudgeScorecard,
  type JudgeScorecardSource,
  type SideAssignment
} from "@agent-major/shared";

export function materializeJudgeVerdictScorecardPayload(input: {
  payload: unknown;
  rubricProfile?: JudgeRubricProfile;
  defenderThesisContext?: DefenderThesisContext | undefined;
  teamAId: string;
  teamBId: string;
  activeTeamAAgentIds?: string[];
  activeTeamBAgentIds?: string[];
  sideAssignment: SideAssignment;
}): unknown {
  const record = readUnknownRecord(input.payload);
  if (!record || !input.rubricProfile) {
    return input.payload;
  }
  const fullScorecardParse = judgeScorecardSchemaSafeParse(record.judgeScorecard);
  const proposedMargin = normalizeJudgeMargin(record.margin) ?? fullScorecardParse?.marginFromScore;
  const winnerTeamId = typeof record.winnerTeamId === "string" ? record.winnerTeamId : undefined;
  const loserTeamId = typeof record.loserTeamId === "string" ? record.loserTeamId : undefined;
  const margin = proposedMargin;
  const roundWinType = normalizeJudgeRoundWinType(record.roundWinType);
  if (!winnerTeamId || !loserTeamId || !margin || !roundWinType) {
    return input.payload;
  }

  const source: JudgeScorecardSource = "evidence_materialized_from_draft";
  const judgeScorecard = buildCodeCompletedJudgeScorecard({
    source,
    lightweightScorecard: readUnknownRecord(record.judgeScorecard) ? record.judgeScorecard : { teamScores: record.teamScores },
    rubricProfile: input.rubricProfile,
    winnerTeamId,
    loserTeamId,
    teamAId: input.teamAId,
    teamBId: input.teamBId,
    sideAssignment: input.sideAssignment,
    defenderThesisContext: input.defenderThesisContext,
    margin,
    roundWinType,
    reason: normalizeText(readUnknownRecord(record.diagnostic)?.decisiveEvidence) ?? "LLM 裁判未返回完整评分表，代码按 verdict 事实补齐审计结构。"
  });
  const finalWinnerTeamId = judgeScorecard.winnerFromScore;
  const finalLoserTeamId = finalWinnerTeamId === input.teamAId ? input.teamBId : input.teamAId;
  const finalRoundWinType = normalizeRoundWinTypeForWinner(roundWinType, finalWinnerTeamId, input.sideAssignment);
  const candidateWinnerOverridden = finalWinnerTeamId !== winnerTeamId;
  const finalMvpAgentId =
    finalWinnerTeamId === input.teamAId
      ? input.activeTeamAAgentIds?.[0]
      : finalWinnerTeamId === input.teamBId
        ? input.activeTeamBAgentIds?.[0]
        : undefined;
  const candidateMvpAgentId = typeof record.mvpAgentId === "string" ? record.mvpAgentId : undefined;
  const candidateMvpOverridden = Boolean(finalMvpAgentId && candidateMvpAgentId !== finalMvpAgentId);
  const finalJudgeScorecard =
    candidateWinnerOverridden || candidateMvpOverridden
      ? {
          ...judgeScorecard,
          normalizedFieldNotes: [
            ...(judgeScorecard.normalizedFieldNotes ?? []),
            ...(candidateWinnerOverridden
              ? [`LLM candidate winner ${winnerTeamId}; code materialized winner ${finalWinnerTeamId} from judgeScorecard totals.`]
              : []),
            ...(candidateMvpOverridden
              ? [`LLM candidate mvpAgentId ${candidateMvpAgentId}; code materialized MVP ${finalMvpAgentId} from final winner roster.`]
              : [])
          ]
        }
      : judgeScorecard;

  return {
    ...record,
    winnerTeamId: finalWinnerTeamId,
    loserTeamId: finalLoserTeamId,
    margin: judgeScorecard.marginFromScore,
    roundWinType: finalRoundWinType,
    attackWinConditionMet: finalRoundWinType.startsWith("attack_"),
    defenseWinConditionMet: finalRoundWinType.startsWith("defense_"),
    ...(finalMvpAgentId ? { mvpAgentId: finalMvpAgentId } : {}),
    ...(candidateWinnerOverridden || candidateMvpOverridden
      ? {
          ...(candidateWinnerOverridden ? { candidateWinnerTeamId: winnerTeamId } : {}),
          normalizedFieldNotes: [
            ...((Array.isArray(record.normalizedFieldNotes) ? record.normalizedFieldNotes : []) as string[]),
            ...(candidateWinnerOverridden
              ? [`LLM candidate winner ${winnerTeamId}; code materialized winner ${finalWinnerTeamId} from judgeScorecard totals.`]
              : []),
            ...(candidateMvpOverridden
              ? [`LLM candidate mvpAgentId ${candidateMvpAgentId}; code materialized MVP ${finalMvpAgentId} from final winner roster.`]
              : [])
          ]
        }
      : {}),
    judgeScorecard: finalJudgeScorecard
  };
}

export function normalizeJudgeResultMarginForReason(judgeResult: JudgeResult): JudgeResult {
  const currentScorecard = judgeResult.judgeScorecard;
  if (!currentScorecard || judgeResult.margin !== "decisive" || hasDecisiveReason(judgeResult.reason)) {
    return judgeResult;
  }

  return {
    ...judgeResult,
    margin: "standard",
    judgeScorecard: {
      ...currentScorecard,
      llmProposedMargin: currentScorecard.llmProposedMargin ?? "decisive",
      normalizedFieldNotes: [
        ...(currentScorecard.normalizedFieldNotes ?? []),
        "judge_margin_downgraded_from_reason: scoreDelta supported decisive, but final reason lacked decisive evidence; code downgraded margin without changing winner."
      ],
      scoreOverride: {
        applied: true,
        reason: "judge_margin_downgraded_from_reason",
        approvedByRule: "phase20-pre-margin-reason-consistency"
      }
    }
  };
}

export function calculateWeightedJudgeScore(
  teamScore: JudgeScorecard["teamScores"][string],
  weights: JudgeScoreDimensionWeights
): number {
  return roundJudgeScore(
    judgeScoreDimensions.reduce((sum, dimension) => sum + teamScore[dimension].score * weights[dimension], 0),
    2
  );
}

export function deriveJudgeMarginFromScoreDelta(delta: number): JudgeResult["margin"] {
  if (delta < 0.75) {
    return "narrow";
  }
  if (delta < 2) {
    return "standard";
  }
  return "decisive";
}

function buildCodeCompletedJudgeScorecard(input: {
  source: JudgeScorecardSource;
  lightweightScorecard: unknown;
  rubricProfile: JudgeRubricProfile;
  winnerTeamId: string;
  loserTeamId: string;
  teamAId: string;
  teamBId: string;
  sideAssignment: SideAssignment;
  defenderThesisContext?: DefenderThesisContext | undefined;
  margin: JudgeResult["margin"];
  roundWinType: JudgeRoundWinType;
  reason: string;
}): JudgeScorecard {
  const fallback = buildEvidenceMaterializedFallbackJudgeScorecard({
    rubricProfile: input.rubricProfile,
    winnerTeamId: input.winnerTeamId,
    loserTeamId: input.loserTeamId,
    teamAId: input.teamAId,
    teamBId: input.teamBId,
    sideAssignment: input.sideAssignment,
    defenderThesisContext: input.defenderThesisContext,
    margin: input.margin,
    roundWinType: input.roundWinType,
    reason: input.reason,
    source: input.source
  });
  const lightweightScores = readUnknownRecord(readUnknownRecord(input.lightweightScorecard)?.teamScores);
  if (!lightweightScores) {
    return fallback;
  }

  const teamScores = { ...fallback.teamScores };
  for (const teamId of [input.teamAId, input.teamBId]) {
    const rawTeamScore = readUnknownRecord(lightweightScores[teamId]);
    if (!rawTeamScore) {
      continue;
    }
    const baseTeamScore = teamScores[teamId];
    if (!baseTeamScore) {
      continue;
    }
    const completedTeamScore = { ...baseTeamScore };
    for (const dimension of judgeScoreDimensions) {
      const rawDimension = readUnknownRecord(rawTeamScore[dimension]);
      const score = typeof rawDimension?.score === "number" ? Math.max(0, Math.min(10, rawDimension.score)) : undefined;
      const evidence = normalizeText(rawDimension?.evidence);
      const evidenceSource = normalizeJudgeScoreEvidenceSource(rawDimension?.evidenceSource);
      completedTeamScore[dimension] = {
        score: score ?? baseTeamScore[dimension].score,
        evidence: evidence && evidence.length >= 8 ? evidence : baseTeamScore[dimension].evidence,
        evidenceSource: evidenceSource ?? baseTeamScore[dimension].evidenceSource
      };
    }
    completedTeamScore.totalScore = calculateWeightedJudgeScore(completedTeamScore, input.rubricProfile.dimensionWeights);
    teamScores[teamId] = completedTeamScore;
  }

  const teamATotal = teamScores[input.teamAId]?.totalScore ?? 0;
  const teamBTotal = teamScores[input.teamBId]?.totalScore ?? 0;
  const winnerFromScore = teamATotal >= teamBTotal ? input.teamAId : input.teamBId;
  const scoreDelta = roundJudgeScore(Math.abs(teamATotal - teamBTotal), 2);
  const marginFromScore = deriveJudgeMarginFromScoreDelta(scoreDelta);
  const loserFromScore = winnerFromScore === input.teamAId ? input.teamBId : input.teamAId;
  return {
    ...fallback,
    ...(input.defenderThesisContext ? { defenderThesisContext: input.defenderThesisContext } : {}),
    teamScores,
    scoreDelta,
    winnerFromScore,
    marginFromScore,
    decisiveDimensions: deriveJudgeDecisiveDimensions(teamScores[winnerFromScore], teamScores[loserFromScore]),
    scorecardSource: input.source,
    ...(input.margin !== marginFromScore ? { llmProposedMargin: input.margin } : {}),
    normalizedFieldNotes: [
      ...(input.margin !== marginFromScore ? [`LLM proposed margin ${input.margin}; code derived ${marginFromScore} from scoreDelta.`] : [])
    ]
  };
}

function buildEvidenceMaterializedFallbackJudgeScorecard(input: {
  rubricProfile: JudgeRubricProfile;
  winnerTeamId: string;
  loserTeamId: string;
  teamAId: string;
  teamBId: string;
  sideAssignment: SideAssignment;
  defenderThesisContext?: DefenderThesisContext | undefined;
  margin: JudgeResult["margin"];
  roundWinType: JudgeRoundWinType;
  reason: string;
  source: JudgeScorecardSource;
}): JudgeScorecard {
  const neutralDimensionScore = 6;
  const candidateTieBreakScores: Partial<Record<JudgeScoreDimension, number>> = {
    objectiveScore: 6.06,
    proofScore: 6.04
  };
  const buildTeamScore = (teamId: string, scores: Partial<Record<JudgeScoreDimension, number>>) => {
    const side = teamId === input.sideAssignment.attackingTeamId ? "attack" : "defense";
    const teamScore = {
      teamId,
      side,
      objectiveScore: buildEvidenceMaterializedFallbackDimension(scores.objectiveScore ?? neutralDimensionScore, "round_context", "胜利目标证据不足，使用中性目标维度补齐。"),
      mapControlScore: buildEvidenceMaterializedFallbackDimension(scores.mapControlScore ?? neutralDimensionScore, "zone_relation", "区域控制证据不足，使用中性地图维度补齐。"),
      submissionQualityScore: buildEvidenceMaterializedFallbackDimension(scores.submissionQualityScore ?? neutralDimensionScore, "submitted_output", "提交质量证据不足，使用中性提交维度补齐。"),
      coordinationScore: buildEvidenceMaterializedFallbackDimension(scores.coordinationScore ?? neutralDimensionScore, "team_plan", "协同证据不足，使用中性协同维度补齐。"),
      economyAdjustedScore: buildEvidenceMaterializedFallbackDimension(scores.economyAdjustedScore ?? neutralDimensionScore, "economy", "经济约束证据不足，只在经济维度中性补齐。"),
      riskControlScore: buildEvidenceMaterializedFallbackDimension(scores.riskControlScore ?? neutralDimensionScore, "round_context", "风险控制证据不足，使用中性风险维度补齐。"),
      proofScore: buildEvidenceMaterializedFallbackDimension(scores.proofScore ?? neutralDimensionScore, "judge_rubric_context", "证明强度证据不足，使用中性证明维度补齐。"),
      totalScore: 0
    } satisfies JudgeScorecard["teamScores"][string];
    return {
      ...teamScore,
      totalScore: calculateWeightedJudgeScore(teamScore, input.rubricProfile.dimensionWeights)
    };
  };
  const teamScores = {
    [input.winnerTeamId]: buildTeamScore(input.winnerTeamId, candidateTieBreakScores),
    [input.loserTeamId]: buildTeamScore(input.loserTeamId, {})
  };
  const teamATotal = teamScores[input.teamAId]?.totalScore ?? 0;
  const teamBTotal = teamScores[input.teamBId]?.totalScore ?? 0;
  const winnerFromScore = teamATotal >= teamBTotal ? input.teamAId : input.teamBId;
  const loserFromScore = winnerFromScore === input.teamAId ? input.teamBId : input.teamAId;
  const scoreDelta = roundJudgeScore(Math.abs(teamATotal - teamBTotal), 2);
  return {
    scorecardSource: input.source,
    ...(input.defenderThesisContext ? { defenderThesisContext: input.defenderThesisContext } : {}),
    rubricProfile: input.rubricProfile,
    teamScores,
    scoreDelta,
    winnerFromScore,
    marginFromScore: deriveJudgeMarginFromScoreDelta(scoreDelta),
    decisiveDimensions: deriveJudgeDecisiveDimensions(teamScores[winnerFromScore], teamScores[loserFromScore]),
    roundWinTypeJustification: `${input.roundWinType} 来自语义草稿；维度分缺失时使用中性证据 fallback，不使用固定胜方模板。`,
    ...(input.margin !== deriveJudgeMarginFromScoreDelta(scoreDelta) ? { llmProposedMargin: input.margin } : {}),
    normalizedFieldNotes: [
      "LLM draft did not provide usable teamScores; code used neutral evidence fallback with only a minimal candidate tie-breaker instead of fixed winner/loser score template."
    ]
  };
}

function buildEvidenceMaterializedFallbackDimension(
  score: number,
  evidenceSource: JudgeScorecard["teamScores"][string][JudgeScoreDimension]["evidenceSource"],
  evidence: string
): JudgeScorecard["teamScores"][string][JudgeScoreDimension] {
  return { score, evidence, evidenceSource };
}

export function buildDeterministicJudgeScorecard(input: {
  rubricProfile: JudgeRubricProfile;
  winnerTeamId: string;
  loserTeamId: string;
  teamAId: string;
  teamBId: string;
  sideAssignment: SideAssignment;
  defenderThesisContext?: DefenderThesisContext | undefined;
  margin: JudgeResult["margin"];
  roundWinType: JudgeRoundWinType;
  reason: string;
  source?: JudgeScorecardSource;
}): JudgeScorecard {
  const delta = input.margin === "decisive" ? 2.1 : input.margin === "standard" ? 1.15 : 0.5;
  const winnerScore = input.margin === "decisive" ? 7.8 : input.margin === "standard" ? 7.1 : 6.6;
  const loserScore = roundJudgeScore(winnerScore - delta, 2);
  const buildTeamScore = (teamId: string, totalScore: number) => {
    const side = teamId === input.sideAssignment.attackingTeamId ? "attack" : "defense";
    return {
      teamId,
      side,
      objectiveScore: buildDeterministicJudgeDimension(totalScore, "round_context", input.reason),
      mapControlScore: buildDeterministicJudgeDimension(totalScore, "zone_relation", input.reason),
      submissionQualityScore: buildDeterministicJudgeDimension(totalScore, "submitted_output", input.reason),
      coordinationScore: buildDeterministicJudgeDimension(totalScore, "team_plan", input.reason),
      economyAdjustedScore: buildDeterministicJudgeDimension(totalScore, "economy", input.reason),
      riskControlScore: buildDeterministicJudgeDimension(totalScore, "round_context", input.reason),
      proofScore: buildDeterministicJudgeDimension(totalScore, "judge_rubric_context", input.reason),
      totalScore
    } satisfies JudgeScorecard["teamScores"][string];
  };
  const teamScores = {
    [input.winnerTeamId]: buildTeamScore(input.winnerTeamId, winnerScore),
    [input.loserTeamId]: buildTeamScore(input.loserTeamId, loserScore)
  };
  return {
    ...(input.source ? { scorecardSource: input.source } : {}),
    ...(input.defenderThesisContext ? { defenderThesisContext: input.defenderThesisContext } : {}),
    rubricProfile: input.rubricProfile,
    teamScores,
    scoreDelta: delta,
    winnerFromScore: input.winnerTeamId,
    marginFromScore: input.margin,
    decisiveDimensions: ["objectiveScore", "proofScore"],
    roundWinTypeJustification: `${input.roundWinType} 由本地确定性评分与显式 fallback 胜法保持一致。`
  };
}

function buildDeterministicJudgeDimension(
  score: number,
  evidenceSource: JudgeScorecard["teamScores"][string][JudgeScoreDimension]["evidenceSource"],
  reason: string
): JudgeScorecard["teamScores"][string][JudgeScoreDimension] {
  return {
    score,
    evidence: `确定性 fallback 依据：${reason}`,
    evidenceSource
  };
}

function normalizeJudgeScoreEvidenceSource(value: unknown): JudgeScorecard["teamScores"][string][JudgeScoreDimension]["evidenceSource"] | undefined {
  const sourceValue = Array.isArray(value) ? value.find((item) => normalizeJudgeScoreEvidenceSource(item)) : value;
  const normalized = normalizeText(sourceValue)?.trim();
  switch (normalized) {
    case "submitted_output":
    case "economy":
    case "zone_relation":
    case "map_semantic_context":
    case "judge_rubric_context":
    case "round_context":
    case "combat_resolution":
    case "team_plan":
      return normalized;
    case "roleResponsibilities":
    case "role_responsibilities":
    case "player_directives":
    case "teamPlan":
      return "team_plan";
    case "buyTypesByTeam":
    case "buy_types_by_team":
    case "economyContextByTeam":
    case "economy_context_by_team":
      return "economy";
    case "riskRead":
    case "risk_read":
    case "sideAssignment":
    case "side_assignment":
      return "round_context";
    case "agent_action":
    case "agentAction":
      return "submitted_output";
    default:
      return undefined;
  }
}

function normalizeRoundWinTypeForWinner(
  roundWinType: JudgeRoundWinType,
  winnerTeamId: string,
  sideAssignment: SideAssignment
): JudgeRoundWinType {
  if (winnerTeamId === sideAssignment.attackingTeamId) {
    return roundWinType.startsWith("attack_") ? roundWinType : "attack_elimination";
  }
  if (winnerTeamId === sideAssignment.defendingTeamId) {
    return roundWinType.startsWith("defense_") ? roundWinType : "defense_elimination";
  }
  return roundWinType;
}

function judgeScorecardSchemaSafeParse(value: unknown): JudgeScorecard | undefined {
  const result = judgeScorecardSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

function deriveJudgeDecisiveDimensions(
  winnerScore: JudgeScorecard["teamScores"][string] | undefined,
  loserScore: JudgeScorecard["teamScores"][string] | undefined
): JudgeScoreDimension[] {
  if (!winnerScore || !loserScore) {
    return ["objectiveScore"];
  }
  return [...judgeScoreDimensions]
    .sort((left, right) => winnerScore[right].score - loserScore[right].score - (winnerScore[left].score - loserScore[left].score))
    .slice(0, 2);
}

function normalizeJudgeMargin(value: unknown): JudgeResult["margin"] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["narrow", "close", "thin", "slight", "small", "narrow_win"].includes(normalized)) {
    return "narrow";
  }
  if (["standard", "normal", "clear", "moderate", "regular", "default"].includes(normalized)) {
    return "standard";
  }
  if (["decisive", "dominant", "overwhelming", "clear_cut", "blowout", "crushing"].includes(normalized)) {
    return "decisive";
  }
  return undefined;
}

function normalizeJudgeRoundWinType(value: unknown): JudgeRoundWinType | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  switch (normalized) {
    case "attack_elimination":
    case "attack_bomb_explosion":
    case "defense_elimination":
    case "defense_timeout_no_plant":
    case "defense_defuse":
      return normalized;
    default:
      return undefined;
  }
}

function readUnknownRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function roundJudgeScore(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function hasDecisiveReason(text: string): boolean {
  return /(决定性|压倒|完全|全歼|击穿|崩盘|无法|彻底|大幅|碾压|清场|引爆|拆包|多点|人数优势|系统性)/.test(text);
}
