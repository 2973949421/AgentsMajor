import type { Agent, BuyType, ScorePair } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import { getSideContext } from "./map-rules.js";
import {
  assertNoForbiddenTacticalFields,
  buildPublicTacticalContext,
  buildRuleBasedTacticalPlans,
  createSideAssignment,
  resolveTacticalCollision,
  type RuleBasedTacticalInput
} from "./tactical-protocol.js";
import { getTacticalMapLayout } from "./tactical-map.js";

describe("Phase 1.6 tactical protocol", () => {
  it("creates deterministic side assignments for halves and overtime", () => {
    expect(createSideAssignment({ roundId: "r1", roundNumber: 1, teamAId: "a", teamBId: "b", sideContext: getSideContext(1) })).toMatchObject({
      attackingTeamId: "a",
      defendingTeamId: "b",
      half: "first_half",
      sideSwitched: false
    });
    expect(createSideAssignment({ roundId: "r7", roundNumber: 7, teamAId: "a", teamBId: "b", sideContext: getSideContext(7) })).toMatchObject({
      attackingTeamId: "b",
      defendingTeamId: "a",
      half: "second_half",
      sideSwitched: true
    });
    expect(createSideAssignment({ roundId: "r13", roundNumber: 13, teamAId: "a", teamBId: "b", sideContext: getSideContext(13) })).toMatchObject({
      attackingTeamId: "a",
      defendingTeamId: "b",
      half: "overtime",
      sideSwitched: true
    });
  });

  it("generates stable attack and defense plans with normalized zone weights", () => {
    const input = tacticalInput();
    const first = buildRuleBasedTacticalPlans(input);
    const second = buildRuleBasedTacticalPlans(input);

    expect(first).toEqual(second);
    expect(sumWeights(first.attackPlan.resourceAllocationByZone)).toBe(100);
    expect(sumWeights(first.defenseDeployment.resourceAllocationByZone)).toBe(100);
    expect(first.attackPlan.teamId).toBe("team_a");
    expect(first.defenseDeployment.teamId).toBe("team_b");
    expect(JSON.stringify(first.defenseDeployment)).not.toContain("primaryTargetZoneId");
  });

  it("resolves fake rotates, weak zones, and safe public tactical context", () => {
    const input = tacticalInput();
    const plans = buildRuleBasedTacticalPlans(input);
    const forcedPlans = {
      attackPlan: {
        ...plans.attackPlan,
        approach: "fake_then_rotate" as const,
        primaryTargetZoneId: "conversion_site_a",
        secondaryTargetZoneId: "conversion_site_b",
        feintZoneId: "conversion_site_a",
        resourceAllocationByZone: [
          { zoneId: "conversion_site_a", weight: 30, activeAgentIds: ["agent_a_entry"], intent: "attack_feint" as const },
          { zoneId: "conversion_site_b", weight: 50, activeAgentIds: ["agent_a_entry"], intent: "attack_execute" as const },
          { zoneId: "buyer_mid", weight: 20, activeAgentIds: ["agent_a_entry"], intent: "info_control" as const }
        ]
      },
      defenseDeployment: {
        ...plans.defenseDeployment,
        setup: "heavy_a" as const,
        heavyZoneId: "conversion_site_a",
        weakZoneIds: ["conversion_site_b"],
        resourceAllocationByZone: [
          { zoneId: "conversion_site_a", weight: 55, activeAgentIds: ["agent_b_support"], intent: "defense_anchor" as const },
          { zoneId: "conversion_site_b", weight: 15, activeAgentIds: ["agent_b_support"], intent: "defense_anchor" as const },
          { zoneId: "buyer_mid", weight: 30, activeAgentIds: ["agent_b_support"], intent: "info_control" as const }
        ]
      }
    };
    const collision = resolveTacticalCollision({
      ...forcedPlans,
      sideAssignment: input.sideAssignment,
      buyTypeByTeam: input.buyTypeByTeam,
      scoreBeforeRound: { teamA: 3, teamB: 3 },
      teamAId: "team_a",
      activeAgentsById: agentsById(input),
      judgeResult: {
        winnerTeamId: "team_a",
        loserTeamId: "team_b",
        margin: "standard",
        reason: "test judge",
        mvpAgentId: "agent_a_star",
        confidence: 0.75
      }
    });
    const context = buildPublicTacticalContext({ ...forcedPlans, sideAssignment: input.sideAssignment, collision });

    expect(collision.result).toBe("fake_success");
    expect(collision.primaryZoneId).toBe("conversion_site_b");
    expect(context.attackPlan.feintRevealed).toBe(true);
    expect(() => assertNoForbiddenTacticalFields(context)).not.toThrow();
    expect(() => assertNoForbiddenTacticalFields({ modelName: "should_not_leak" })).toThrow("forbidden field");

    const defenseWinnerCollision = resolveTacticalCollision({
      ...forcedPlans,
      sideAssignment: input.sideAssignment,
      buyTypeByTeam: input.buyTypeByTeam,
      scoreBeforeRound: { teamA: 3, teamB: 3 },
      teamAId: "team_a",
      activeAgentsById: agentsById(input),
      judgeResult: {
        winnerTeamId: "team_b",
        loserTeamId: "team_a",
        margin: "standard",
        reason: "judge says defense converted the hold",
        mvpAgentId: "agent_b_support",
        confidence: 0.75
      }
    });
    expect(["defense_hold", "rotate_success", "trade_even"]).toContain(defenseWinnerCollision.result);
    expect(["attack_breakthrough", "fake_success", "economy_steal"]).not.toContain(defenseWinnerCollision.result);
  });
});

function tacticalInput(): RuleBasedTacticalInput {
  const sideAssignment = createSideAssignment({
    roundId: "round_test_1",
    roundNumber: 1,
    teamAId: "team_a",
    teamBId: "team_b",
    sideContext: getSideContext(1)
  });
  return {
    round: {
      id: "round_test_1",
      mapGameId: "map_test_1",
      roundNumber: 1,
      status: "running" as const,
      teamAActiveAgentIds: ["agent_a_entry", "agent_a_star"],
      teamBActiveAgentIds: ["agent_b_igl", "agent_b_support"]
    },
    mapGame: {
      id: "map_test_1",
      matchId: "match_test",
      mapName: "DUST2",
      order: 1,
      status: "running" as const,
      teamAScore: 0,
      teamBScore: 0,
      currentRoundNumber: 0,
      createdAt: "2026-05-01T00:00:00.000Z"
    },
    teamA: { id: "team_a", tournamentId: "t", displayName: "Team A", shortName: "A", seed: 1, createdAt: "2026-05-01T00:00:00.000Z" },
    teamB: { id: "team_b", tournamentId: "t", displayName: "Team B", shortName: "B", seed: 2, createdAt: "2026-05-01T00:00:00.000Z" },
    activeAgentsByTeam: {
      team_a: [agent("agent_a_entry", "team_a", "entry"), agent("agent_a_star", "team_a", "star_rifler")],
      team_b: [agent("agent_b_igl", "team_b", "igl"), agent("agent_b_support", "team_b", "support")]
    },
    buyTypeByTeam: { team_a: "fullBuy" as BuyType, team_b: "fullBuy" as BuyType },
    economyByTeam: { team_a: 16000, team_b: 15000 },
    recentPublicRoundSummaries: [],
    tacticalMapLayout: getTacticalMapLayout("DUST2"),
    sideAssignment
  };
}

function agentsById(input: RuleBasedTacticalInput): Record<string, Agent> {
  return Object.fromEntries(Object.values(input.activeAgentsByTeam).flat().map((item) => [item.id, item]));
}

function agent(id: string, teamId: string, role: Agent["role"]): Agent {
  return {
    id,
    teamId,
    driverModelId: "driver_fake",
    role,
    displayName: id,
    baseProfile: {
      personalitySummary: "test",
      tacticalSummary: "test",
      styleTags: ["test"]
    },
    currentState: "ready",
    createdAt: "2026-05-01T00:00:00.000Z"
  };
}

function sumWeights(items: Array<{ weight: number }>): number {
  return items.reduce((sum, item) => sum + item.weight, 0);
}
