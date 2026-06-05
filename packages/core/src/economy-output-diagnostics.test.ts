import type { JudgeResult, SideAssignment, SubmittedAgentOutput, TacticalCollision } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import { buildEconomyOutputDiagnostic } from "./economy-output-diagnostics.js";

describe("economy/output diagnostics", () => {
  it("flags attack-side budget and submitted evidence gaps", () => {
    const diagnostic = buildEconomyOutputDiagnostic({
      roundNumber: 8,
      winnerTeamId: "team_attack",
      sideAssignment: sideAssignment(),
      teamAId: "team_attack",
      teamBId: "team_defense",
      teamABuyType: "fullBuy",
      teamBBuyType: "eco",
      submittedAgentOutputs: [
        submittedOutput("a1", "team_attack", 42, 0),
        submittedOutput("a2", "team_attack", 42, 0),
        submittedOutput("d1", "team_defense", 18, 3, { withDetail: false }),
        submittedOutput("d2", "team_defense", 18, 3, { withDetail: false })
      ],
      judgeResult: judgeResult("team_attack", "team_defense")
    });

    expect(diagnostic.dominantBudgetSide).toBe("attack");
    expect(diagnostic.dominantEvidenceSide).toBe("attack");
    expect(diagnostic.suspectedBiasSources).toContain("economy_budget_side_gap");
    expect(diagnostic.suspectedBiasSources).toContain("submitted_evidence_side_gap");
    expect(diagnostic.suspectedBiasSources).toContain("omitted_fields_side_gap");
  });

  it("records budget, evidence, and omitted field counts without changing winner", () => {
    const diagnostic = buildEconomyOutputDiagnostic({
      roundNumber: 9,
      winnerTeamId: "team_defense",
      sideAssignment: sideAssignment(),
      teamAId: "team_attack",
      teamBId: "team_defense",
      teamABuyType: "fullBuy",
      teamBBuyType: "eco",
      submittedAgentOutputs: [
        submittedOutput("a1", "team_attack", 42, 0),
        submittedOutput("a2", "team_attack", 42, 0),
        submittedOutput("d1", "team_defense", 18, 3, { withDetail: false })
      ],
      judgeResult: judgeResult("team_defense", "team_attack")
    });

    expect(diagnostic.winnerTeamId).toBe("team_defense");
    expect(diagnostic.attack).toMatchObject({
      buyType: "fullBuy",
      outputBudgetTotal: 84,
      outputBudgetAverage: 42,
      submittedEvidenceCount: 18,
      omittedFieldCount: 0,
      wonRound: false
    });
    expect(diagnostic.defense).toMatchObject({
      buyType: "eco",
      outputBudgetTotal: 18,
      outputBudgetAverage: 18,
      submittedEvidenceCount: 1,
      omittedFieldCount: 3,
      wonRound: true
    });
    expect(diagnostic.deltas).toMatchObject({
      attackMinusDefenseBudget: 66,
      attackMinusDefenseEvidence: 17,
      attackMinusDefenseOmittedFields: -3
    });
  });

  it("flags defense-side proof and economy score gaps symmetrically", () => {
    const diagnostic = buildEconomyOutputDiagnostic({
      roundNumber: 10,
      winnerTeamId: "team_defense",
      sideAssignment: sideAssignment(),
      teamAId: "team_attack",
      teamBId: "team_defense",
      teamABuyType: "halfBuy",
      teamBBuyType: "fullBuy",
      submittedAgentOutputs: [submittedOutput("a1", "team_attack", 30, 0), submittedOutput("d1", "team_defense", 30, 0)],
      judgeResult: judgeResult("team_defense", "team_attack", {
        team_attack: { proofScore: 5.9, economyAdjustedScore: 5.8 },
        team_defense: { proofScore: 7.0, economyAdjustedScore: 6.9 }
      })
    });

    expect(diagnostic.dominantProofSide).toBe("defense");
    expect(diagnostic.suspectedBiasSources).toContain("judge_proof_side_gap");
    expect(diagnostic.suspectedBiasSources).toContain("judge_economy_score_side_gap");
  });

  it("keeps neutral rounds quiet when budget, evidence, and score are balanced", () => {
    const diagnostic = buildEconomyOutputDiagnostic({
      roundNumber: 11,
      winnerTeamId: "team_attack",
      sideAssignment: sideAssignment(),
      teamAId: "team_attack",
      teamBId: "team_defense",
      teamABuyType: "fullBuy",
      teamBBuyType: "fullBuy",
      submittedAgentOutputs: [submittedOutput("a1", "team_attack", 32, 0), submittedOutput("d1", "team_defense", 32, 0)],
      judgeResult: judgeResult("team_attack", "team_defense")
    });

    expect(diagnostic.dominantBudgetSide).toBeUndefined();
    expect(diagnostic.dominantEvidenceSide).toBeUndefined();
    expect(diagnostic.suspectedBiasSources).toEqual([]);
  });

  it("records tactical side patterns without changing winner", () => {
    const diagnostic = buildEconomyOutputDiagnostic({
      roundNumber: 12,
      winnerTeamId: "team_defense",
      sideAssignment: sideAssignment(),
      teamAId: "team_attack",
      teamBId: "team_defense",
      teamABuyType: "fullBuy",
      teamBBuyType: "fullBuy",
      submittedAgentOutputs: [submittedOutput("a1", "team_attack", 32, 0), submittedOutput("d1", "team_defense", 32, 0)],
      judgeResult: judgeResult("team_defense", "team_attack"),
      tacticalCollision: { result: "defense_hold" } as TacticalCollision
    });

    expect(diagnostic.winnerTeamId).toBe("team_defense");
    expect(diagnostic.defense.tacticalResult).toBe("defense_hold");
    expect(diagnostic.suspectedBiasSources).toContain("tactical_side_pattern");
  });
});

function sideAssignment(): SideAssignment {
  return {
    roundId: "round_1",
    roundNumber: 1,
    attackingTeamId: "team_attack",
    defendingTeamId: "team_defense",
    half: "first_half",
    sideSwitched: false
  };
}

function submittedOutput(
  agentId: string,
  teamId: string,
  outputBudget: number,
  omittedFieldCount: number,
  options: { withDetail?: boolean } = {}
): SubmittedAgentOutput {
  const withDetail = options.withDetail ?? true;
  return {
    id: `submitted_${agentId}`,
    rawOutputId: `raw_${agentId}`,
    submissionKind: "submitted_output",
    agentId,
    teamId,
    role: "rifler",
    driverModelId: "driver_test",
    action: withDetail ? "take space" : undefined,
    actionDetail: withDetail
      ? {
          roundObjective: "objective",
          executionPlan: "execution",
          coordinationPlan: "coordination",
          roleResponsibilityUsage: "role",
          riskRead: "risk",
          contingencyPlan: "contingency",
          expectedContribution: "contribution",
          confidence: 0.7
        }
      : undefined,
    confidence: 0.7,
    rawFingerprint: "fingerprint",
    buyType: outputBudget >= 30 ? "fullBuy" : "eco",
    outputBudget,
    omittedFields: Array.from({ length: omittedFieldCount }, (_, index) => `field_${index}`),
    gateSummary: withDetail ? "gate kept detail" : "gate omitted detail"
  };
}

function judgeResult(
  winnerTeamId: string,
  loserTeamId: string,
  scores: Record<string, { proofScore: number; economyAdjustedScore: number }> = {
    team_attack: { proofScore: 6.2, economyAdjustedScore: 6.2 },
    team_defense: { proofScore: 6.2, economyAdjustedScore: 6.2 }
  }
): JudgeResult {
  return ({
    winnerTeamId,
    loserTeamId,
    margin: "standard",
    reason: "test",
    mvpAgentId: "a1",
    confidence: 0.7,
    judgeScorecard: {
      rubricProfile: {
        id: "test",
        label: "test",
        dimensionWeights: {
          objectiveScore: 1,
          mapControlScore: 1,
          submissionQualityScore: 1,
          coordinationScore: 1,
          economyAdjustedScore: 1,
          riskControlScore: 1,
          proofScore: 1
        }
      },
      teamScores: Object.fromEntries(
        Object.entries(scores).map(([teamId, teamScores]) => [
          teamId,
          {
            teamId,
            side: teamId === "team_attack" ? "attack" : "defense",
            objectiveScore: dimension(6.2),
            mapControlScore: dimension(6.2),
            submissionQualityScore: dimension(6.2),
            coordinationScore: dimension(6.2),
            economyAdjustedScore: dimension(teamScores.economyAdjustedScore),
            riskControlScore: dimension(6.2),
            proofScore: dimension(teamScores.proofScore),
            totalScore: 6.2
          }
        ])
      ),
      scoreDelta: 0,
      winnerFromScore: winnerTeamId,
      marginFromScore: "narrow",
      decisiveDimensions: ["objectiveScore"],
      roundWinTypeJustification: "test"
    }
  } as unknown) as JudgeResult;
}

function dimension(score: number) {
  return { score, evidence: "test", evidenceSource: "round_context" as const };
}
