import type { Agent, EconomyPosture, LoadoutPackage, LocalNodeVerdict, MapNodeControl, MapNodeState, RoundNodeStateSnapshot } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import { buildNodeEconomyResources } from "./economy-resource-adapter.js";
import type { TeamEconomyPlan } from "./economy-rules.js";
import { materializeNodeStateTransition } from "./node-state-materializer.js";
import { loadMapNodeGraph } from "./node-graph-service.js";

describe("node state materializer", () => {
  it("carries prior actions into the next phase without ignoring reachability", () => {
    const graph = loadMapNodeGraph("dust2");
    const resources = resourcesForRound();
    const transition = materializeNodeStateTransition({
      graph,
      previousSnapshot: openingSnapshot(),
      previousAgentActions: [
        action("attack_agent_1", "team_attack", "attack", "t_spawn", "long_doors"),
        action("defense_agent_1", "team_defense", "defense", "a_default", "a_default")
      ],
      previousLocalVerdicts: [verdict("long_doors", "attack")],
      economyResources: resources,
      nextPhaseId: "first_contact"
    });

    const blue = transition.nodeStates.find((state) => state.nodeId === "blue")!;

    expect(blue.attackAgentIds).toContain("attack_agent_1");
    expect(blue.control).toBe("attack");
    expect(transition.liveAgentIds).toContain("defense_agent_1");
  });

  it("removes casualty agents from the next phase state seed", () => {
    const graph = loadMapNodeGraph("dust2");
    const transition = materializeNodeStateTransition({
      graph,
      previousSnapshot: openingSnapshot(),
      previousAgentActions: [],
      previousLocalVerdicts: [
        {
          ...verdict("t_spawn", "defense"),
          casualties: [{ agentId: "attack_agent_2", teamId: "team_attack", reason: "test casualty" }]
        }
      ],
      economyResources: resourcesForRound(),
      nextPhaseId: "first_contact"
    });
    const serializedAgents = transition.nodeStates.flatMap((state) => [...state.attackAgentIds, ...state.defenseAgentIds]);

    expect(transition.eliminatedAgentIds).toEqual(["attack_agent_2"]);
    expect(serializedAgents).not.toContain("attack_agent_2");
  });

  it("does not produce a round winner", () => {
    const graph = loadMapNodeGraph("dust2");
    const transition = materializeNodeStateTransition({
      graph,
      previousSnapshot: openingSnapshot(),
      previousAgentActions: [],
      previousLocalVerdicts: [],
      economyResources: resourcesForRound(),
      nextPhaseId: "first_contact"
    });

    expect("winnerTeamId" in transition).toBe(false);
  });
});

function openingSnapshot(): RoundNodeStateSnapshot {
  return {
    roundId: "round_node_state_test",
    phaseId: "default_opening",
    activeNodeIds: ["t_spawn", "outside_long", "a_default", "b_default"],
    nodeStates: [
      state("t_spawn", ["attack_agent_1", "attack_agent_2"], []),
      state("outside_long", [], []),
      state("a_default", [], ["defense_agent_1"]),
      state("b_default", [], ["defense_agent_2"])
    ]
  };
}

function state(nodeId: string, attackAgentIds: string[], defenseAgentIds: string[]): MapNodeState {
  return {
    nodeId,
    phaseId: "default_opening" as const,
    attackAgentIds,
    defenseAgentIds,
    control: controlFor(attackAgentIds, defenseAgentIds),
    businessIntent: `test:${nodeId}`
  };
}

function controlFor(attackAgentIds: string[], defenseAgentIds: string[]): MapNodeControl {
  if (attackAgentIds.length > 0 && defenseAgentIds.length > 0) {
    return "contested";
  }
  if (attackAgentIds.length > 0) {
    return "attack";
  }
  if (defenseAgentIds.length > 0) {
    return "defense";
  }
  return "neutral";
}

function action(agentId: string, teamId: string, side: "attack" | "defense", currentNodeId: string, targetNodeId: string) {
  return {
    agentId,
    teamId,
    side,
    phaseId: "default_opening" as const,
    currentNodeId,
    targetNodeId,
    actionType: "map_control" as const,
    apCost: 1,
    businessIntent: "test business intent",
    riskAssessment: "test risk",
    expectedResult: "test result"
  };
}

function verdict(nodeId: string, controlAfter: LocalNodeVerdict["controlAfter"]): LocalNodeVerdict {
  return {
    phaseId: "default_opening",
    nodeId,
    summary: "test verdict",
    controlAfter,
    engagementOccurred: false,
    casualties: [],
    resourceChanges: [],
    businessPlanValidated: ["test"],
    businessPlanBroken: [],
    nextPhaseInitiative: controlAfter === "neutral" ? "none" : controlAfter,
    triggersWinConditionCheck: false
  };
}

function resourcesForRound() {
  const attackAgents = agents("team_attack", "attack_agent");
  const defenseAgents = agents("team_defense", "defense_agent");
  return buildNodeEconomyResources({
    roundNumber: 1,
    phaseId: "default_opening",
    activeAgents: [...attackAgents, ...defenseAgents],
    teamPlans: [
      teamPlan("team_attack", "attack", "rifle_buy", "rifle_full_t_pack", attackAgents.map((agent) => agent.id)),
      teamPlan("team_defense", "defense", "rifle_buy", "rifle_full_ct_pack", defenseAgents.map((agent) => agent.id))
    ]
  });
}

function teamPlan(
  teamId: string,
  side: "attack" | "defense",
  posture: EconomyPosture,
  loadoutPackage: LoadoutPackage,
  agentIds: string[]
): TeamEconomyPlan {
  return {
    teamId,
    side,
    phase: "gun_round",
    lossCount: 0,
    posture,
    postureReason: "test posture reason",
    summaryBuyType: "fullBuy",
    totalCash: 25000,
    dropDecisions: [],
    decisions: agentIds.map((agentId) => ({
      agentId,
      teamId,
      tokenBankBefore: 5000,
      tokenBankAfterDrop: 5000,
      buyType: "fullBuy",
      economyPosture: posture,
      loadoutPackage,
      spend: 5000,
      outputBudget: 1200,
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
