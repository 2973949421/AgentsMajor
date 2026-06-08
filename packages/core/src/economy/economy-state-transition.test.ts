import type { Agent, EconomyState } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import { calculateEconomyDelta, economyStateFromDelta } from "./economy-state-transition.js";
import type { TeamEconomyPlan } from "./economy-rules.js";

describe("economy state transition", () => {
  it("applies bomb win rewards, objective bonus, and loss bonus without changing winner facts", () => {
    const activeA = agents("team_a");
    const activeB = agents("team_b");
    const beforeEconomy = [...activeA, ...activeB].map((agent) => economy(agent, 10000));
    const delta = calculateEconomyDelta({
      beforeEconomy,
      winnerTeamId: "team_a",
      loserTeamId: "team_b",
      teamAId: "team_a",
      teamBId: "team_b",
      roundWinType: "attack_bomb_explosion",
      teamEconomyPlans: {
        team_a: plan("team_a", activeA),
        team_b: plan("team_b", activeB)
      },
      activeA,
      activeB
    });

    const winnerIgl = delta.agents.find((item) => item.agentId === "team_a_igl");
    const loser = delta.agents.find((item) => item.teamId === "team_b");

    expect(winnerIgl?.reward).toBe(3800);
    expect(loser?.reward).toBe(1900);
    expect(delta.teamEconomyPostures).toEqual({ teamA: "rifle_buy", teamB: "rifle_buy" });

    const nextState = economyStateFromDelta(delta.agents[0]!, "map_1", "round_1", "2026-06-05T00:00:00.000Z");
    expect(nextState).toMatchObject({
      phase: "after_round",
      roundId: "round_1",
      economyPosture: "rifle_buy",
      outputBudget: 1200
    });
  });
});

function agents(teamId: string): Agent[] {
  return ["entry", "star_rifler", "awper", "igl", "support"].map((role) => ({
    id: `${teamId}_${role}`,
    teamId,
    driverModelId: "driver_test",
    role,
    displayName: `${teamId}_${role}`,
    baseProfile: {},
    currentState: "ready",
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z"
  } as Agent));
}

function economy(agent: Agent, tokenBank: number): EconomyState {
  return {
    id: `eco_${agent.id}`,
    agentId: agent.id,
    teamId: agent.teamId,
    mapGameId: "map_1",
    phase: "before_buy",
    tokenBank,
    buyType: "fullBuy",
    lossStreak: 1,
    lossCount: 1,
    economyPosture: "rifle_buy",
    loadoutPackage: "rifle_full_t_pack",
    timeoutsRemaining: 1,
    visibleContextBudget: 1200,
    outputBudget: 1200,
    createdAt: "2026-06-05T00:00:00.000Z"
  };
}

function plan(teamId: string, activeAgents: Agent[]): TeamEconomyPlan {
  return {
    teamId,
    side: teamId === "team_a" ? "attack" : "defense",
    phase: "gun_round",
    lossCount: 1,
    posture: "rifle_buy",
    postureReason: "test",
    summaryBuyType: "fullBuy",
    totalCash: 50000,
    dropDecisions: [],
    decisions: activeAgents.map((agent) => ({
      agentId: agent.id,
      teamId,
      tokenBankBefore: 10000,
      tokenBankAfterDrop: 10000,
      buyType: "fullBuy",
      economyPosture: "rifle_buy",
      loadoutPackage: "rifle_full_t_pack",
      spend: 5200,
      outputBudget: 1200,
      dropSent: 0,
      dropReceived: 0,
      notes: []
    }))
  };
}
