import { judgeScoreDimensions, type JudgeRubricProfile, type JudgeScorecard } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import { validateJudgeScorecard } from "./judge-scorecard-validation.js";

describe("judge scorecard validation", () => {
  it("rejects roundWinType that conflicts with the score winner side", () => {
    const rubricProfile = profile();
    const scorecard: JudgeScorecard = {
      scorecardSource: "deterministic_fallback",
      rubricProfile,
      teamScores: {
        team_a: teamScore("team_a", "attack", 7),
        team_b: teamScore("team_b", "defense", 5)
      },
      winnerFromScore: "team_a",
      scoreDelta: 2,
      marginFromScore: "decisive",
      decisiveDimensions: ["objectiveScore"],
      roundWinTypeJustification: "test"
    };

    expect(() =>
      validateJudgeScorecard({
        judgeResult: {
          winnerTeamId: "team_a",
          margin: "decisive",
          roundWinType: "defense_elimination",
          judgeScorecard: scorecard
        },
        teamAId: "team_a",
        teamBId: "team_b",
        sideAssignment: {
          roundId: "round_1",
          roundNumber: 1,
          attackingTeamId: "team_a",
          defendingTeamId: "team_b",
          half: "first_half",
          sideSwitched: false
        },
        rubricProfile
      })
    ).toThrow(/roundWinType side/);
  });
});

function profile(): JudgeRubricProfile {
  const weights = Object.fromEntries(judgeScoreDimensions.map((dimension) => [dimension, 1 / 7])) as JudgeRubricProfile["dimensionWeights"];
  return {
    profileId: "rubric_test",
    baseVersion: "baseJudgeRubric-v1",
    dimensions: [...judgeScoreDimensions],
    dimensionWeights: weights,
    mapAdjustment: {
      source: "judgeRubricContext",
      applied: false,
      summary: "test",
      emphasizedDimensions: ["objectiveScore"]
    },
    roundAdjustment: {
      source: "currentSubTheme",
      subTheme: "test",
      summary: "test",
      emphasizedDimensions: ["objectiveScore"]
    },
    evidenceRequirements: ["test"],
    forbiddenBiases: ["test"]
  };
}

function teamScore(teamId: string, side: "attack" | "defense", score: number): JudgeScorecard["teamScores"][string] {
  const dimension = {
    score,
    evidence: "足够具体的测试证据。",
    evidenceSource: "submitted_output" as const
  };
  return {
    teamId,
    side,
    objectiveScore: dimension,
    mapControlScore: dimension,
    submissionQualityScore: dimension,
    coordinationScore: dimension,
    economyAdjustedScore: dimension,
    riskControlScore: dimension,
    proofScore: dimension,
    totalScore: score
  };
}
