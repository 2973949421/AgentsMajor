import { describe, expect, it } from "vitest";

import { buildNodeEconomyResources } from "../economy/economy-resource-adapter.js";
import type { TeamEconomyPlan } from "../../economy/economy-rules.js";
import { calculateNodeActionPointCost, calculateNodeRouteCost } from "./node-action-point-rules.js";
import { loadMapNodeGraph } from "../graph/node-graph-service.js";
import type { Agent, EconomyPosture, LoadoutPackage } from "@agent-major/shared";

describe("node action point rules", () => {
  it("calculates zero route cost for staying on the same node", () => {
    const graph = loadMapNodeGraph("dust2");
    const route = calculateNodeRouteCost(graph, "t_spawn", "t_spawn");

    expect(route.reachable).toBe(true);
    expect(route.routeCost).toBe(0);
    expect(route.path).toEqual(["t_spawn"]);
  });

  it("calculates graph route cost for adjacent and multi-hop movement", () => {
    const graph = loadMapNodeGraph("dust2");
    const adjacent = calculateNodeRouteCost(graph, "t_spawn", "outside_long");
    const multiHop = calculateNodeRouteCost(graph, "t_spawn", "a_default");

    expect(adjacent.reachable).toBe(true);
    expect(adjacent.routeCost).toBe(1);
    expect(multiHop.reachable).toBe(true);
    expect(multiHop.routeCost).toBeGreaterThan(adjacent.routeCost);
  });

  it("computes action cost from route, action and loadout constraints", () => {
    const graph = loadMapNodeGraph("dust2");
    const resource = resources("rifle_buy", "rifle_full_t_pack").agents.find((agent) => agent.side === "attack")!;
    const cost = calculateNodeActionPointCost({
      graph,
      resource,
      actionType: "map_control",
      currentNodeId: "t_spawn",
      targetNodeId: "outside_long"
    });

    expect(cost.routeCost).toBe(1);
    expect(cost.actionCost).toBe(1);
    expect(cost.totalCost).toBe(2);
  });
});

function resources(posture: EconomyPosture, loadoutPackage: LoadoutPackage) {
  const attackAgents = agents("team_attack", "attack_agent");
  return buildNodeEconomyResources({
    roundNumber: 1,
    phaseId: "default_opening",
    activeAgents: attackAgents,
    teamPlans: [teamPlan("team_attack", "attack", posture, loadoutPackage, attackAgents.map((agent) => agent.id))]
  });
}

function teamPlan(teamId: string, side: "attack" | "defense", posture: EconomyPosture, loadoutPackage: LoadoutPackage, agentIds: string[]): TeamEconomyPlan {
  return {
    teamId,
    side,
    phase: "gun_round",
    lossCount: 0,
    posture,
    postureReason: "test posture",
    summaryBuyType: posture === "rifle_buy" ? "fullBuy" : "eco",
    totalCash: posture === "rifle_buy" ? 25000 : 3000,
    dropDecisions: [],
    decisions: agentIds.map((agentId) => ({
      agentId,
      teamId,
      tokenBankBefore: posture === "rifle_buy" ? 5000 : 800,
      tokenBankAfterDrop: posture === "rifle_buy" ? 5000 : 800,
      buyType: posture === "rifle_buy" ? "fullBuy" : "eco",
      economyPosture: posture,
      loadoutPackage,
      spend: posture === "rifle_buy" ? 5000 : 300,
      outputBudget: posture === "rifle_buy" ? 1200 : 360,
      dropSent: 0,
      dropReceived: 0,
      notes: []
    }))
  };
}

function agents(teamId: string, prefix: string): Agent[] {
  return [
    {
      id: `${prefix}_1`,
      teamId,
      driverModelId: "driver_test",
      role: "entry",
      displayName: `${prefix}_1`,
      baseProfile: {},
      currentState: "ready",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    }
  ] as Agent[];
}
