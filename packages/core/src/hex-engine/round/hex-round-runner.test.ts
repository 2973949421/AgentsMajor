import type { TeamEconomyPlan } from "../../economy/economy-rules.js";
import { describe, expect, it } from "vitest";

import { runDust2HexRound } from "./hex-round-runner.js";

describe("Hex round runner", () => {
  it("generates a complete fixture trace with a hard final win condition", async () => {
    const trace = await runDust2HexRound({
      roundId: "round_hex_fixture_1",
      roundNumber: 1,
      attackTeamId: "team_t",
      defenseTeamId: "team_ct",
      activeAgents: createAgents(),
      teamEconomyPlans: buildEconomyPlans()
    });

    expect(trace.source).toBe("hex_round_engine_trace");
    expect(trace.phases.length).toBeGreaterThanOrEqual(2);
    expect(trace.phases.length).toBeLessThanOrEqual(5);
    expect(trace.finalWinCondition.isRoundOver).toBe(true);
    expect(trace.finalWinCondition.winnerTeamId).toBeDefined();
    expect(trace.audit.providerMode).toBe("fixture");
    expect(trace.audit.totalLlmCallsAttempted).toBeGreaterThan(0);
    expect(trace.phases.every((phase) => phase.commandResult.actions.length === 10)).toBe(true);
  });

  it("falls back on provider errors without letting forbidden drafts become facts", async () => {
    const trace = await runDust2HexRound({
      roundId: "round_hex_fixture_error",
      roundNumber: 1,
      attackTeamId: "team_t",
      defenseTeamId: "team_ct",
      activeAgents: createAgents(),
      teamEconomyPlans: buildEconomyPlans(),
      maxLlmCallsPerPhase: 2,
      provider: () => {
        throw new Error("fixture_provider_down");
      },
      providerMode: "fixture"
    });

    expect(trace.finalWinCondition.isRoundOver).toBe(true);
    expect(trace.audit.fallbackCount).toBeGreaterThan(0);
    expect(JSON.stringify(trace.finalWinCondition)).not.toContain("winnerFromDraft");
  });
});

function createAgents() {
  return [
    ...Array.from({ length: 5 }, (_, index) => ({
      agentId: `t_${index}`,
      teamId: "team_t",
      side: "attack" as const,
      carryingC4: index === 0
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      agentId: `ct_${index}`,
      teamId: "team_ct",
      side: "defense" as const
    }))
  ];
}

function buildEconomyPlans(): Record<string, TeamEconomyPlan> {
  return {
    team_t: buildPlan("team_t", "attack"),
    team_ct: buildPlan("team_ct", "defense")
  };
}

function buildPlan(teamId: string, side: "attack" | "defense"): TeamEconomyPlan {
  return {
    teamId,
    side,
    phase: "pistol_round",
    lossCount: 0,
    posture: "pistol_round",
    postureReason: "runner fixture",
    summaryBuyType: "halfBuy",
    totalCash: 4000,
    dropDecisions: [],
    decisions: Array.from({ length: 5 }, (_, index) => ({
      agentId: teamId === "team_t" ? `t_${index}` : `ct_${index}`,
      teamId,
      tokenBankBefore: 800,
      tokenBankAfterDrop: 800,
      buyType: "halfBuy" as const,
      economyPosture: "pistol_round" as const,
      loadoutPackage: "pistol_round_pack" as const,
      spend: 650,
      outputBudget: 650,
      dropSent: 0,
      dropReceived: 0,
      notes: []
    }))
  };
}
