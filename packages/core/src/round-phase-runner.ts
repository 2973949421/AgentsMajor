import type { ActionPointBudget, MapNodeGraph, MapNodeState, RoundNodeStateSnapshot, RoundPhaseId } from "@agent-major/shared";

import { getReachableNodes } from "./node-graph-service.js";
import type { NodeAgentEconomyResource, NodeRoundEconomyResources } from "./economy-resource-adapter.js";
import { buildAgentPhaseActions } from "./agent-phase-action-pipeline.js";
import { buildLocalNodeVerdicts } from "./local-node-judge-pipeline.js";
import { materializeNodeStateTransition } from "./node-state-materializer.js";
import { evaluateNodeRoundWinCondition, type NodeRoundWinConditionResult, type NodeRoundWinConditionState } from "./win-condition-materializer.js";

export interface RunNodeRoundShadowInput {
  roundId: string;
  roundNumber: number;
  graph: MapNodeGraph;
  economyResources: NodeRoundEconomyResources;
}

export interface NodeRoundShadowResult {
  roundId: string;
  roundNumber: number;
  mapSlug: string;
  graphAssetId: string;
  mode: "shadow";
  phases: NodeRoundPhaseSnapshot[];
  resourceSnapshot: NodeRoundEconomyResources;
  finalWinCondition?: NodeRoundWinConditionResult;
  notes: string[];
}

export type NodeRoundPhaseSnapshot = RoundNodeStateSnapshot & {
  winConditionCheck: NodeRoundWinConditionResult;
  transitionNotes?: string[];
};

const attackPreferredNodesByPhase: Record<RoundPhaseId, string[]> = {
  default_opening: ["t_spawn", "outside_long", "top_mid", "outside_tunnels", "upper_tunnels"],
  first_contact: ["long_doors", "top_mid", "mid", "upper_tunnels", "b_tunnel_exit"],
  mid_round_decision: ["mid", "a_long", "cat", "b_site", "mid_doors"],
  execute_or_retake: ["a_default", "b_default", "a_ramp", "b_site", "b_doors"],
  post_plant_or_clutch: ["a_safe", "b_back_site", "b_doors", "ct_spawn", "b_window"]
};

const defensePreferredNodesByPhase: Record<RoundPhaseId, string[]> = {
  default_opening: ["a_default", "b_default", "mid_doors", "a_short", "b_window"],
  first_contact: ["long_corner", "mid", "b_tunnel_exit", "short_stairs", "lower_tunnels"],
  mid_round_decision: ["xbox", "top_mid", "upper_tunnels", "outside_tunnels", "mid"],
  execute_or_retake: ["ct_spawn", "a_ramp", "b_doors", "b_window", "a_short"],
  post_plant_or_clutch: ["ct_spawn", "a_default", "b_default", "t_spawn", "b_window"]
};

export function runNodeRoundShadow(input: RunNodeRoundShadowInput): NodeRoundShadowResult {
  const phases: NodeRoundPhaseSnapshot[] = [];
  const sortedPhases = [...input.graph.timing_model.round_phases].sort((left, right) => left.phase_index - right.phase_index);
  let previousSnapshot: NodeRoundPhaseSnapshot | undefined;
  let winConditionState: NodeRoundWinConditionState = { bombState: "not_planted" };

  for (const phase of sortedPhases) {
    const phaseSnapshot = previousSnapshot
      ? buildMaterializedPhaseSnapshot(input, phase.id, previousSnapshot, winConditionState)
      : buildInitialPhaseSnapshot(input, phase.id, winConditionState);
    phases.push(phaseSnapshot);
    previousSnapshot = phaseSnapshot;
    winConditionState = nextWinConditionState(phaseSnapshot.winConditionCheck);
    if (phaseSnapshot.winConditionCheck.isRoundOver) {
      break;
    }
  }

  const finalWinCondition = phases.find((phase) => phase.winConditionCheck.isRoundOver)?.winConditionCheck;

  return {
    roundId: input.roundId,
    roundNumber: input.roundNumber,
    mapSlug: input.graph.map_slug,
    graphAssetId: input.graph.asset_id,
    mode: "shadow",
    phases,
    resourceSnapshot: input.economyResources,
    ...(finalWinCondition ? { finalWinCondition } : {}),
    notes: [
      "节点化 shadow runner 只生成阶段轨迹，不写正式 winner。",
      "本结果不调用 LLM、不写 DB、不替换旧回合提交路径。"
    ]
  };
}

function buildInitialPhaseSnapshot(
  input: RunNodeRoundShadowInput,
  phaseId: RoundPhaseId,
  previousWinConditionState: NodeRoundWinConditionState
): NodeRoundPhaseSnapshot {
  const attackResources = input.economyResources.agents.filter((resource) => resource.side === "attack");
  const defenseResources = input.economyResources.agents.filter((resource) => resource.side === "defense");
  const attackReachable = getReachableNodes(input.graph, "attack", phaseId);
  const defenseReachable = getReachableNodes(input.graph, "defense", phaseId);
  const attackAssignments = assignAgentsToNodes(attackResources, phaseId, "attack", attackReachable);
  const defenseAssignments = assignAgentsToNodes(defenseResources, phaseId, "defense", defenseReachable);
  const activeNodeIds = uniqueSorted([
    ...attackReachable,
    ...defenseReachable,
    ...Object.keys(attackAssignments),
    ...Object.keys(defenseAssignments)
  ]);

  const nodeStates = activeNodeIds.map((nodeId) =>
    buildNodeState({
      phaseId,
      nodeId,
      attackAgentIds: attackAssignments[nodeId] ?? [],
      defenseAgentIds: defenseAssignments[nodeId] ?? []
    })
  );

  const baseSnapshot: RoundNodeStateSnapshot = {
    roundId: input.roundId,
    phaseId,
    activeNodeIds,
    nodeStates,
    actionPointBudgets: input.economyResources.agents.map((resource) => buildActionPointBudget(resource, phaseId))
  };
  return attachActionsVerdictsAndWinCondition(input, baseSnapshot, input.economyResources, previousWinConditionState);
}

function buildMaterializedPhaseSnapshot(
  input: RunNodeRoundShadowInput,
  phaseId: RoundPhaseId,
  previousSnapshot: NodeRoundPhaseSnapshot,
  previousWinConditionState: NodeRoundWinConditionState
): NodeRoundPhaseSnapshot {
  const transition = materializeNodeStateTransition({
    graph: input.graph,
    previousSnapshot,
    previousAgentActions: previousSnapshot.agentActions ?? [],
    previousLocalVerdicts: previousSnapshot.localVerdicts ?? [],
    economyResources: input.economyResources,
    nextPhaseId: phaseId
  });
  const phaseResources = filterResourcesByLiveAgents(input.economyResources, transition.liveAgentIds);
  const baseSnapshot: RoundNodeStateSnapshot = {
    roundId: input.roundId,
    phaseId,
    activeNodeIds: transition.activeNodeIds,
    nodeStates: transition.nodeStates,
    actionPointBudgets: phaseResources.agents.map((resource) => buildActionPointBudget(resource, phaseId))
  };
  return {
    ...attachActionsVerdictsAndWinCondition(input, baseSnapshot, phaseResources, previousWinConditionState),
    transitionNotes: transition.notes
  };
}

function attachActionsVerdictsAndWinCondition(
  input: RunNodeRoundShadowInput,
  baseSnapshot: RoundNodeStateSnapshot,
  economyResources: NodeRoundEconomyResources,
  previousWinConditionState: NodeRoundWinConditionState
): NodeRoundPhaseSnapshot {
  const agentActions = buildAgentPhaseActions({
    graph: input.graph,
    phaseSnapshot: baseSnapshot,
    economyResources
  });
  const localVerdicts = buildLocalNodeVerdicts({
    graph: input.graph,
    phaseSnapshot: baseSnapshot,
    agentActions
  });
  const winConditionCheck = evaluateNodeRoundWinCondition({
    graph: input.graph,
    phaseSnapshot: baseSnapshot,
    agentActions,
    localVerdicts,
    attackTeamId: getTeamIdForSide(input.economyResources, "attack"),
    defenseTeamId: getTeamIdForSide(input.economyResources, "defense"),
    previousState: previousWinConditionState
  });

  return {
    ...baseSnapshot,
    agentActions,
    localVerdicts,
    winConditionCheck
  };
}

function assignAgentsToNodes(
  resources: NodeAgentEconomyResource[],
  phaseId: RoundPhaseId,
  side: "attack" | "defense",
  reachableNodes: string[]
): Record<string, string[]> {
  const preferred = side === "attack" ? attackPreferredNodesByPhase[phaseId] : defensePreferredNodesByPhase[phaseId];
  const candidateNodes = preferred.filter((nodeId) => reachableNodes.includes(nodeId));
  const fallbackNodes = reachableNodes.filter((nodeId) => !candidateNodes.includes(nodeId));
  const assignmentNodes = [...candidateNodes, ...fallbackNodes];
  const assignments: Record<string, string[]> = {};

  if (assignmentNodes.length === 0) {
    return assignments;
  }

  resources.forEach((resource, index) => {
    const nodeId = assignmentNodes[index % assignmentNodes.length]!;
    assignments[nodeId] = [...(assignments[nodeId] ?? []), resource.agentId];
  });

  return assignments;
}

function buildNodeState(input: {
  phaseId: RoundPhaseId;
  nodeId: string;
  attackAgentIds: string[];
  defenseAgentIds: string[];
}): MapNodeState {
  const hasAttack = input.attackAgentIds.length > 0;
  const hasDefense = input.defenseAgentIds.length > 0;
  return {
    nodeId: input.nodeId,
    phaseId: input.phaseId,
    attackAgentIds: input.attackAgentIds,
    defenseAgentIds: input.defenseAgentIds,
    control: hasAttack && hasDefense ? "contested" : hasAttack ? "attack" : hasDefense ? "defense" : "neutral",
    businessIntent: `shadow:${input.phaseId}:${input.nodeId}`
  };
}

function buildActionPointBudget(resource: NodeAgentEconomyResource, phaseId: RoundPhaseId): ActionPointBudget {
  const spentAp = estimateShadowSpentAp(resource, phaseId);
  return {
    agentId: resource.agentId,
    phaseId,
    baseAp: resource.baseAp,
    spentAp,
    remainingAp: resource.baseAp - spentAp,
    isOverBudget: spentAp > resource.baseAp
  };
}

function filterResourcesByLiveAgents(resources: NodeRoundEconomyResources, liveAgentIds: string[]): NodeRoundEconomyResources {
  const liveAgentIdSet = new Set(liveAgentIds);
  const agents = resources.agents.filter((resource) => liveAgentIdSet.has(resource.agentId));
  return {
    ...resources,
    agents,
    agentResourcesById: Object.fromEntries(agents.map((resource) => [resource.agentId, resource]))
  };
}

function getTeamIdForSide(resources: NodeRoundEconomyResources, side: "attack" | "defense"): string {
  const team = resources.teams.find((candidate) => candidate.side === side);
  if (team) {
    return team.teamId;
  }
  return resources.agents.find((resource) => resource.side === side)?.teamId ?? `${side}_team`;
}

function nextWinConditionState(result: NodeRoundWinConditionResult): NodeRoundWinConditionState {
  return {
    bombState: result.bombState,
    ...(result.plantedNodeId ? { plantedNodeId: result.plantedNodeId } : {})
  };
}

function estimateShadowSpentAp(resource: NodeAgentEconomyResource, phaseId: RoundPhaseId): number {
  if (phaseId === "default_opening") {
    return resource.riskProfile === "preserve" ? 0 : 1;
  }
  if (phaseId === "execute_or_retake") {
    return resource.canUseExecuteUtility || resource.canRetake ? 2 : 1;
  }
  if (phaseId === "post_plant_or_clutch") {
    return resource.canSave ? 1 : 2;
  }
  return resource.riskProfile === "high" ? 2 : 1;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}
