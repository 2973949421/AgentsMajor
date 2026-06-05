import { describe, expect, it } from "vitest";

import { buildJudgeRubricProfile } from "./judge-rubric-profile.js";

describe("judge rubric profile", () => {
  it("builds bounded weights and round adjustment outside engine", () => {
    const profile = buildJudgeRubricProfile({
      mapName: "DUST2",
      roundNumber: 1,
      sideAssignment: {
        roundId: "round_1",
        roundNumber: 1,
        attackingTeamId: "team_a",
        defendingTeamId: "team_b",
        half: "first_half",
        sideSwitched: false
      },
      teamEconomyPlans: {
        team_a: {
          teamId: "team_a",
          side: "attack",
          phase: "pistol_round",
          posture: "pistol_round",
          lossCount: 1,
          totalCash: 4000,
          postureReason: "test",
          summaryBuyType: "halfBuy",
          dropDecisions: [],
          decisions: []
        },
        team_b: {
          teamId: "team_b",
          side: "defense",
          phase: "pistol_round",
          posture: "pistol_round",
          lossCount: 1,
          totalCash: 4000,
          postureReason: "test",
          summaryBuyType: "halfBuy",
          dropDecisions: [],
          decisions: []
        }
      },
      judgeRubricContext: {
        coreJudgmentAxis: "opportunity validation",
        reasonMustCover: ["覆盖双方证据"],
        biasGuardrails: ["不得按队名偏置"]
      }
    });

    expect(profile.baseVersion).toBe("baseJudgeRubric-v1");
    expect(profile.mapAdjustment.emphasizedDimensions).toEqual(expect.arrayContaining(["mapControlScore", "proofScore"]));
    expect(profile.roundAdjustment.emphasizedDimensions).toEqual(expect.arrayContaining(["objectiveScore", "coordinationScore"]));
    const weightTotal = Object.values(profile.dimensionWeights).reduce((sum, value) => sum + value, 0);
    expect(weightTotal).toBeGreaterThan(0.98);
    expect(weightTotal).toBeLessThan(1.02);
  });
});
