import type { Agent, EconomyPosture, LoadoutPackage, RoundNodeStateSnapshot } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import { buildNodeEconomyResources } from "../economy/economy-resource-adapter.js";
import type { TeamEconomyPlan } from "../../economy/economy-rules.js";
import { validateAgentPhaseAction } from "./node-action-validator.js";
import { loadMapNodeGraph } from "../graph/node-graph-service.js";

describe("node action validator", () => {
  it("accepts actions that satisfy route, AP, phase and resource constraints", () => {
    const graph = loadMapNodeGraph("dust2");
    const economyResources = resources("rifle_buy", "rifle_full_t_pack");
    const resource = economyResources.agents[0]!;
    const phaseSnapshot = snapshot("default_opening");
    const result = validateAgentPhaseAction({
      graph,
      phaseSnapshot,
      resource,
      action: {
        agentId: resource.agentId,
        teamId: resource.teamId,
        side: resource.side,
        phaseId: phaseSnapshot.phaseId,
        currentNodeId: "t_spawn",
        targetNodeId: "outside_long",
        actionType: "map_control",
        apCost: 0,
        businessIntent: "validate default opening long approach",
        riskAssessment: "test risk",
        expectedResult: "test expected"
      }
    });

    expect(result.valid).toBe(true);
    expect(result.action.apCost).toBe(2);
    expect(result.action.apCostBreakdown?.routeCost).toBe(1);
  });

  it("falls back when LLM claims an impossible low AP long move", () => {
    const graph = loadMapNodeGraph("dust2");
    const economyResources = resources("rifle_buy", "rifle_full_t_pack");
    const resource = economyResources.agents[0]!;
    const phaseSnapshot = snapshot("execute_or_retake");
    const result = validateAgentPhaseAction({
      graph,
      phaseSnapshot,
      resource,
      claimedCostFromLlm: 0,
      action: {
        agentId: resource.agentId,
        teamId: resource.teamId,
        side: resource.side,
        phaseId: phaseSnapshot.phaseId,
        currentNodeId: "t_spawn",
        targetNodeId: "a_default",
        actionType: "execute_site",
        apCost: 0,
        businessIntent: "try impossible execute",
        riskAssessment: "test risk",
        expectedResult: "test expected"
      }
    });

    expect(result.valid).toBe(false);
    expect(result.fallbackReason).toContain("ap_over_budget");
    expect(result.action.actionType).toBe("hold_position");
    expect(result.action.apCostBreakdown?.claimedCostFromLlm).toBe(0);
  });

  it("falls back when a low-resource agent attempts execute_site", () => {
    const graph = loadMapNodeGraph("dust2");
    const economyResources = resources("full_eco", "pistol_eco_pack");
    const resource = economyResources.agents[0]!;
    const phaseSnapshot = snapshot("execute_or_retake");
    const result = validateAgentPhaseAction({
      graph,
      phaseSnapshot,
      resource,
      action: {
        agentId: resource.agentId,
        teamId: resource.teamId,
        side: resource.side,
        phaseId: phaseSnapshot.phaseId,
        currentNodeId: "b_doors",
        targetNodeId: "b_default",
        actionType: "execute_site",
        apCost: 0,
        businessIntent: "bad low resource execute",
        riskAssessment: "test risk",
        expectedResult: "test expected"
      }
    });

    expect(result.valid).toBe(false);
    expect(result.fallbackReason).toContain("disallowed_action");
    expect(result.action.actionType).not.toBe("execute_site");
  });
});

function snapshot(phaseId: RoundNodeStateSnapshot["phaseId"]): RoundNodeStateSnapshot {
  return {
    roundId: "node_action_validator_round",
    phaseId,
    activeNodeIds: ["t_spawn", "outside_long", "a_default", "b_default", "b_doors"],
    nodeStates: [
      {
        nodeId: "t_spawn",
        phaseId,
        attackAgentIds: ["attack_agent_1"],
        defenseAgentIds: [],
        control: "attack"
      }
    ]
  };
}

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
