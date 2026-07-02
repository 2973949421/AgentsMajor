import type { Agent, EconomyState, Team } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import { decideTeamEconomyPlans } from "./economy-buy-planner.js";
import { roundStartEconomy } from "./economy-rules.js";

describe("economy buy planner", () => {
  it("plans overtime reset as symmetric rifle buys without team-specific advantage", () => {
    const teamA = team("team_a");
    const teamB = team("team_b");
    const activeA = agents("team_a");
    const activeB = agents("team_b");
    const beforeEconomy: EconomyState[] = [
      ...activeA.map((agent) => roundStartEconomy({ agent, mapGameId: "map_1", roundNumber: 19, createdAt: "now", side: "attack" })),
      ...activeB.map((agent) => roundStartEconomy({ agent, mapGameId: "map_1", roundNumber: 19, createdAt: "now", side: "defense" }))
    ];

    const plans = decideTeamEconomyPlans({
      roundNumber: 19,
      scoreBeforeRound: { teamA: 12, teamB: 12 },
      teamA,
      teamB,
      activeA,
      activeB,
      beforeEconomy,
      sideContext: { activeSide: "teamA" },
      previousRoundReport: undefined
    });

    expect(plans.team_a).toMatchObject({ phase: "overtime_reset", posture: "rifle_buy", summaryBuyType: "fullBuy" });
    expect(plans.team_b).toMatchObject({ phase: "overtime_reset", posture: "rifle_buy", summaryBuyType: "fullBuy" });
    expect(plans.team_a?.totalCash).toBe(plans.team_b?.totalCash);
    expect(plans.team_a?.decisions.every((decision) => decision.economyPosture === "rifle_buy")).toBe(true);
    expect(plans.team_b?.decisions.every((decision) => decision.economyPosture === "rifle_buy")).toBe(true);
  });
});

function team(id: string): Team {
  return { id, displayName: id } as Team;
}

function agents(teamId: string): Agent[] {
  return ["entry", "rifler", "awper", "igl", "lurker"].map((role, index) => ({
    id: `${teamId}_agent_${index + 1}`,
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
