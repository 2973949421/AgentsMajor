import type { Agent, EconomyPosture, LoadoutPackage, RoundNodeStateSnapshot } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import { buildAgentPhaseActions } from "./agent-phase-action-pipeline.js";
import { buildNodeEconomyResources } from "./economy-resource-adapter.js";
import type { TeamEconomyPlan } from "./economy-rules.js";
import { loadMapNodeGraph, getReachableNodes } from "./node-graph-service.js";

describe("agent phase action pipeline", () => {
  it("keeps low-resource agents away from execute_site", () => {
    const graph = loadMapNodeGraph("dust2");
    const economyResources = resources({
      attackPosture: "full_eco",
      attackLoadout: "pistol_eco_pack",
      defensePosture: "rifle_buy",
      defenseLoadout: "rifle_full_ct_pack"
    });
    const actions = buildAgentPhaseActions({
      graph,
      phaseSnapshot: snapshot("execute_or_retake"),
      economyResources
    });
    const attackActions = actions.filter((action) => action.side === "attack");

    expect(attackActions.length).toBeGreaterThan(0);
    expect(attackActions.every((action) => action.actionType !== "execute_site")).toBe(true);
    expect(attackActions.every((action) => action.businessIntent.length > 0)).toBe(true);
  });

  it("allows full rifle resources to generate execute actions during execute phase", () => {
    const graph = loadMapNodeGraph("dust2");
    const economyResources = resources({
      attackPosture: "rifle_buy",
      attackLoadout: "rifle_full_t_pack",
      defensePosture: "rifle_buy",
      defenseLoadout: "rifle_full_ct_pack"
    });
    const actions = buildAgentPhaseActions({
      graph,
      phaseSnapshot: snapshot("execute_or_retake"),
      economyResources
    });
    const attackActions = actions.filter((action) => action.side === "attack");

    expect(attackActions.some((action) => action.actionType === "execute_site")).toBe(true);
    expect(attackActions.every((action) => action.apCost <= 3)).toBe(true);
  });

  it("keeps action targets within side and phase reachability", () => {
    const graph = loadMapNodeGraph("dust2");
    const economyResources = resources({
      attackPosture: "rifle_buy",
      attackLoadout: "rifle_full_t_pack",
      defensePosture: "rifle_buy",
      defenseLoadout: "rifle_full_ct_pack"
    });
    const phaseSnapshot = snapshot("default_opening");
    const actions = buildAgentPhaseActions({ graph, phaseSnapshot, economyResources });

    for (const action of actions) {
      expect(getReachableNodes(graph, action.side, action.phaseId)).toContain(action.targetNodeId);
    }
    expect(actions.filter((action) => action.side === "attack").map((action) => action.targetNodeId)).not.toContain("a_default");
    expect(actions.filter((action) => action.side === "attack").map((action) => action.targetNodeId)).not.toContain("b_default");
  });

  it("only chooses actions allowed by economy resources", () => {
    const graph = loadMapNodeGraph("dust2");
    const economyResources = resources({
      attackPosture: "force_buy",
      attackLoadout: "smg_force_pack",
      defensePosture: "rifle_buy",
      defenseLoadout: "rifle_full_ct_pack"
    });
    const actions = buildAgentPhaseActions({
      graph,
      phaseSnapshot: snapshot("first_contact"),
      economyResources
    });

    for (const action of actions) {
      const resource = economyResources.agentResourcesById[action.agentId]!;
      expect(resource.allowedActionTypes).toContain(action.actionType);
      expect(action.businessIntent).toContain(action.teamId);
    }
  });
});

function snapshot(phaseId: RoundNodeStateSnapshot["phaseId"]): RoundNodeStateSnapshot {
  return {
    roundId: "round_action_1",
    phaseId,
    activeNodeIds: ["t_spawn", "top_mid", "a_default", "b_default", "mid_doors"],
    nodeStates: [
      {
        nodeId: "t_spawn",
        phaseId,
        attackAgentIds: ["attack_agent_1"],
        defenseAgentIds: [],
        control: "attack"
      },
      {
        nodeId: "top_mid",
        phaseId,
        attackAgentIds: ["attack_agent_2"],
        defenseAgentIds: [],
        control: "attack"
      },
      {
        nodeId: "a_default",
        phaseId,
        attackAgentIds: [],
        defenseAgentIds: ["defense_agent_1"],
        control: "defense"
      },
      {
        nodeId: "b_default",
        phaseId,
        attackAgentIds: [],
        defenseAgentIds: ["defense_agent_2"],
        control: "defense"
      }
    ]
  };
}

function resources(input: {
  attackPosture: EconomyPosture;
  attackLoadout: LoadoutPackage;
  defensePosture: EconomyPosture;
  defenseLoadout: LoadoutPackage;
}) {
  const attackAgents = agents("team_attack", "attack_agent");
  const defenseAgents = agents("team_defense", "defense_agent");
  return buildNodeEconomyResources({
    roundNumber: 1,
    phaseId: "default_opening",
    activeAgents: [...attackAgents, ...defenseAgents],
    teamPlans: [
      teamPlan("team_attack", "attack", input.attackPosture, input.attackLoadout, attackAgents.map((agent) => agent.id)),
      teamPlan("team_defense", "defense", input.defensePosture, input.defenseLoadout, defenseAgents.map((agent) => agent.id))
    ]
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
  return ["entry", "star_rifler"].map((role, index) => ({
    id: `${prefix}_${index + 1}`,
    teamId,
    driverModelId: "driver_test",
    role,
    displayName: `${prefix}_${index + 1}`,
    baseProfile: {},
    currentState: "ready",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z"
  })) as Agent[];
}
