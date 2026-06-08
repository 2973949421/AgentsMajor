import {
  judgeScoreDimensions,
  type JudgeResult,
  type JudgeRoundWinType,
  type JudgeRubricProfile,
  type JudgeScorecard,
  type SideAssignment
} from "@agent-major/shared";

import {
  calculateWeightedJudgeScore,
  deriveJudgeMarginFromScoreDelta
} from "./judge-scorecard-materializer.js";

export function validateJudgeScorecard(input: {
  judgeResult: Pick<JudgeResult, "winnerTeamId" | "margin" | "roundWinType" | "judgeScorecard">;
  teamAId: string;
  teamBId: string;
  sideAssignment: SideAssignment;
  rubricProfile?: JudgeRubricProfile;
}): void {
  const scorecard = input.judgeResult.judgeScorecard;
  if (!scorecard) {
    throw new Error("Judge scorecard is required for Phase 2.0-pre v6 verdicts.");
  }
  if (input.rubricProfile && JSON.stringify(scorecard.rubricProfile) !== JSON.stringify(input.rubricProfile)) {
    throw new Error("Judge scorecard rubricProfile must match the code-generated rubricProfile.");
  }
  validateJudgeRubricProfile(scorecard.rubricProfile);

  const expectedTeamIds = [input.teamAId, input.teamBId];
  for (const teamId of expectedTeamIds) {
    const teamScore = scorecard.teamScores[teamId];
    if (!teamScore) {
      throw new Error(`Judge scorecard missing team score for ${teamId}.`);
    }
    if (teamScore.teamId !== teamId) {
      throw new Error(`Judge scorecard team score key ${teamId} conflicts with teamId ${teamScore.teamId}.`);
    }
    const expectedSide = teamId === input.sideAssignment.attackingTeamId ? "attack" : "defense";
    if (teamScore.side !== expectedSide) {
      throw new Error(`Judge scorecard side for ${teamId} must be ${expectedSide}.`);
    }
    const expectedTotal = calculateWeightedJudgeScore(teamScore, scorecard.rubricProfile.dimensionWeights);
    if (Math.abs(teamScore.totalScore - expectedTotal) > 0.16) {
      throw new Error(`Judge scorecard totalScore for ${teamId} must equal weighted dimension scores.`);
    }
    for (const dimension of judgeScoreDimensions) {
      const evidence = teamScore[dimension].evidence.trim();
      if (evidence.length < 8) {
        throw new Error(`Judge scorecard ${dimension} evidence for ${teamId} is too thin.`);
      }
      if (teamScore[dimension].evidenceSource === "public_history") {
        throw new Error(`Judge scorecard ${dimension} must not use public history as direct scoring evidence.`);
      }
    }
  }

  const teamAScore = scorecard.teamScores[input.teamAId];
  const teamBScore = scorecard.teamScores[input.teamBId];
  if (!teamAScore || !teamBScore) {
    throw new Error("Judge scorecard must include both team scores.");
  }
  const teamATotal = teamAScore.totalScore;
  const teamBTotal = teamBScore.totalScore;
  const expectedWinner = teamATotal >= teamBTotal ? input.teamAId : input.teamBId;
  const expectedDelta = roundJudgeScore(Math.abs(teamATotal - teamBTotal), 2);
  const expectedMargin = deriveJudgeMarginFromScoreDelta(expectedDelta);
  if (scorecard.winnerFromScore !== expectedWinner) {
    throw new Error("Judge scorecard winnerFromScore must be the team with the higher totalScore.");
  }
  if (input.judgeResult.winnerTeamId !== scorecard.winnerFromScore && !scorecard.scoreOverride?.applied) {
    throw new Error("Judge winnerTeamId must match judgeScorecard.winnerFromScore.");
  }
  if (Math.abs(scorecard.scoreDelta - expectedDelta) > 0.16) {
    throw new Error("Judge scorecard scoreDelta must equal the totalScore difference.");
  }
  if (scorecard.marginFromScore !== expectedMargin) {
    throw new Error("Judge scorecard marginFromScore must be derived from scoreDelta.");
  }
  if (input.judgeResult.margin !== scorecard.marginFromScore && !scorecard.scoreOverride?.applied) {
    throw new Error("Judge margin must match judgeScorecard.marginFromScore.");
  }
  if (scorecard.decisiveDimensions.some((dimension) => !judgeScoreDimensions.includes(dimension))) {
    throw new Error("Judge scorecard decisiveDimensions contains an unknown dimension.");
  }
  if (input.judgeResult.roundWinType) {
    validateJudgeScorecardWinType({
      scorecard,
      roundWinType: input.judgeResult.roundWinType,
      sideAssignment: input.sideAssignment
    });
  }
}

export function validateJudgeRubricProfile(profile: JudgeRubricProfile): void {
  const dimensions = new Set(profile.dimensions);
  if (dimensions.size !== judgeScoreDimensions.length || judgeScoreDimensions.some((dimension) => !dimensions.has(dimension))) {
    throw new Error("Judge rubricProfile dimensions must exactly match baseJudgeRubric-v1.");
  }
  const total = judgeScoreDimensions.reduce((sum, dimension) => sum + profile.dimensionWeights[dimension], 0);
  if (Math.abs(total - 1) > 0.02) {
    throw new Error("Judge rubricProfile dimensionWeights must sum to 1.");
  }
  const baseWeight = 1 / judgeScoreDimensions.length;
  for (const dimension of judgeScoreDimensions) {
    const weight = profile.dimensionWeights[dimension];
    if (weight < baseWeight * 0.8 - 0.01 || weight > baseWeight * 1.2 + 0.03) {
      throw new Error(`Judge rubricProfile weight for ${dimension} exceeds the ±20% adjustment boundary.`);
    }
  }
}

export function validateJudgeScorecardWinType(input: {
  scorecard: JudgeScorecard;
  roundWinType?: JudgeRoundWinType;
  sideAssignment: SideAssignment;
}): void {
  if (!input.roundWinType) {
    return;
  }
  const winnerSide = input.scorecard.winnerFromScore === input.sideAssignment.attackingTeamId ? "attack" : "defense";
  if (!input.roundWinType.startsWith(`${winnerSide}_`)) {
    throw new Error("Judge scorecard winnerFromScore conflicts with roundWinType side.");
  }
}

function roundJudgeScore(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}
