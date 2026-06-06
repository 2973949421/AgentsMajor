import type { AgentPhaseAction, LocalNodeVerdict, MapNodeControl, RoundNodeStateSnapshot } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import { loadMapNodeGraph } from "./node-graph-service.js";
import { evaluateNodeRoundWinCondition } from "./win-condition-materializer.js";

describe("win condition materializer", () => {
  it("awards attack on full defense elimination", () => {
    const result = evaluateNodeRoundWinCondition({
      graph: loadMapNodeGraph("dust2"),
      phaseSnapshot: snapshot("first_contact", [{ nodeId: "long_doors", attack: ["a1"], defense: [] }]),
      agentActions: [],
      localVerdicts: [verdict("long_doors", "attack", "first_contact")],
      attackTeamId: "team_attack",
      defenseTeamId: "team_defense"
    });

    expect(result.isRoundOver).toBe(true);
    expect(result.winnerSide).toBe("attack");
    expect(result.winnerTeamId).toBe("team_attack");
    expect(result.roundWinType).toBe("elimination");
  });

  it("awards defense on full attack elimination", () => {
    const result = evaluateNodeRoundWinCondition({
      graph: loadMapNodeGraph("dust2"),
      phaseSnapshot: snapshot("first_contact", [{ nodeId: "long_corner", attack: [], defense: ["d1"] }]),
      agentActions: [],
      localVerdicts: [verdict("long_corner", "defense", "first_contact")],
      attackTeamId: "team_attack",
      defenseTeamId: "team_defense"
    });

    expect(result.isRoundOver).toBe(true);
    expect(result.winnerSide).toBe("defense");
    expect(result.winnerTeamId).toBe("team_defense");
    expect(result.roundWinType).toBe("elimination");
  });

  it("awards defense on final phase timeout when no bomb is planted", () => {
    const result = evaluateNodeRoundWinCondition({
      graph: loadMapNodeGraph("dust2"),
      phaseSnapshot: snapshot("post_plant_or_clutch", [
        { nodeId: "a_safe", attack: ["a1"], defense: [] },
        { nodeId: "ct_spawn", attack: [], defense: ["d1"] }
      ]),
      agentActions: [],
      localVerdicts: [verdict("a_safe", "attack", "post_plant_or_clutch"), verdict("ct_spawn", "defense", "post_plant_or_clutch")],
      attackTeamId: "team_attack",
      defenseTeamId: "team_defense"
    });

    expect(result.isRoundOver).toBe(true);
    expect(result.winnerSide).toBe("defense");
    expect(result.roundWinType).toBe("timeout");
  });

  it("tracks a planted bomb before the final phase", () => {
    const result = evaluateNodeRoundWinCondition({
      graph: loadMapNodeGraph("dust2"),
      phaseSnapshot: snapshot("execute_or_retake", [
        { nodeId: "a_default", attack: ["a1"], defense: [] },
        { nodeId: "ct_spawn", attack: [], defense: ["d1"] }
      ]),
      agentActions: [action("a1", "team_attack", "attack", "execute_or_retake", "a_default", "execute_site")],
      localVerdicts: [verdict("a_default", "attack", "execute_or_retake"), verdict("ct_spawn", "defense", "execute_or_retake")],
      attackTeamId: "team_attack",
      defenseTeamId: "team_defense"
    });

    expect(result.isRoundOver).toBe(false);
    expect(result.bombState).toBe("planted");
    expect(result.plantedNodeId).toBe("a_default");
  });

  it("awards attack when the planted bomb is held through the final phase", () => {
    const result = evaluateNodeRoundWinCondition({
      graph: loadMapNodeGraph("dust2"),
      phaseSnapshot: snapshot("post_plant_or_clutch", [
        { nodeId: "a_default", attack: ["a1"], defense: [] },
        { nodeId: "ct_spawn", attack: [], defense: ["d1"] }
      ]),
      agentActions: [],
      localVerdicts: [verdict("a_default", "attack", "post_plant_or_clutch"), verdict("ct_spawn", "defense", "post_plant_or_clutch")],
      attackTeamId: "team_attack",
      defenseTeamId: "team_defense",
      previousState: { bombState: "planted", plantedNodeId: "a_default" }
    });

    expect(result.isRoundOver).toBe(true);
    expect(result.winnerSide).toBe("attack");
    expect(result.roundWinType).toBe("bomb_exploded");
    expect(result.bombState).toBe("exploded");
  });

  it("awards defense when a planted bomb is defused under defense control", () => {
    const result = evaluateNodeRoundWinCondition({
      graph: loadMapNodeGraph("dust2"),
      phaseSnapshot: snapshot("post_plant_or_clutch", [
        { nodeId: "a_default", attack: [], defense: ["d1"] },
        { nodeId: "a_safe", attack: ["a1"], defense: [] }
      ]),
      agentActions: [action("d1", "team_defense", "defense", "post_plant_or_clutch", "a_default", "defuse")],
      localVerdicts: [verdict("a_default", "defense", "post_plant_or_clutch"), verdict("a_safe", "attack", "post_plant_or_clutch")],
      attackTeamId: "team_attack",
      defenseTeamId: "team_defense",
      previousState: { bombState: "planted", plantedNodeId: "a_default" }
    });

    expect(result.isRoundOver).toBe(true);
    expect(result.winnerSide).toBe("defense");
    expect(result.roundWinType).toBe("defuse");
    expect(result.bombState).toBe("defused");
  });
});

function snapshot(
  phaseId: RoundNodeStateSnapshot["phaseId"],
  nodes: Array<{ nodeId: string; attack: string[]; defense: string[] }>
): RoundNodeStateSnapshot {
  return {
    roundId: "round_win_condition_test",
    phaseId,
    activeNodeIds: nodes.map((node) => node.nodeId),
    nodeStates: nodes.map((node) => ({
      nodeId: node.nodeId,
      phaseId,
      attackAgentIds: node.attack,
      defenseAgentIds: node.defense,
      control: controlFor(node.attack, node.defense),
      businessIntent: `test:${node.nodeId}`
    }))
  };
}

function verdict(nodeId: string, controlAfter: MapNodeControl, phaseId: RoundNodeStateSnapshot["phaseId"]): LocalNodeVerdict {
  return {
    phaseId,
    nodeId,
    summary: "test verdict",
    controlAfter,
    engagementOccurred: controlAfter === "contested",
    casualties: [],
    resourceChanges: [],
    businessPlanValidated: ["test"],
    businessPlanBroken: [],
    nextPhaseInitiative: controlAfter === "neutral" ? "none" : controlAfter,
    triggersWinConditionCheck: true
  };
}

function action(
  agentId: string,
  teamId: string,
  side: "attack" | "defense",
  phaseId: RoundNodeStateSnapshot["phaseId"],
  targetNodeId: string,
  actionType: AgentPhaseAction["actionType"]
): AgentPhaseAction {
  return {
    agentId,
    teamId,
    side,
    phaseId,
    currentNodeId: targetNodeId,
    targetNodeId,
    actionType,
    apCost: 2,
    businessIntent: "test business intent",
    riskAssessment: "test risk",
    expectedResult: "test expected result"
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
