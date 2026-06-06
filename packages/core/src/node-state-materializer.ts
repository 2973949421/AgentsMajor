import type { AgentPhaseAction, LocalNodeVerdict, MapNodeControl, MapNodeGraph, MapNodeState, RoundPhaseId, RoundNodeStateSnapshot } from "@agent-major/shared";

import { getAdjacentNodes, getReachableNodes } from "./node-graph-service.js";
import type { NodeRoundEconomyResources } from "./economy-resource-adapter.js";

export interface MaterializeNodeStateTransitionInput {
  graph: MapNodeGraph;
  previousSnapshot: RoundNodeStateSnapshot;
  previousAgentActions: AgentPhaseAction[];
  previousLocalVerdicts: LocalNodeVerdict[];
  economyResources: NodeRoundEconomyResources;
  nextPhaseId: RoundPhaseId;
}

export interface NodeStateTransitionResult {
  phaseId: RoundPhaseId;
  activeNodeIds: string[];
  nodeStates: MapNodeState[];
  liveAgentIds: string[];
  eliminatedAgentIds: string[];
  notes: string[];
}

export function materializeNodeStateTransition(input: MaterializeNodeStateTransitionInput): NodeStateTransitionResult {
  const eliminatedAgentIds = uniqueSorted(input.previousLocalVerdicts.flatMap((verdict) => (verdict.casualties ?? []).map((casualty) => casualty.agentId)));
  const eliminatedAgentIdSet = new Set(eliminatedAgentIds);
  const liveResources = input.economyResources.agents.filter((resource) => !eliminatedAgentIdSet.has(resource.agentId));
  const previousAgentNodes = buildPreviousAgentNodeMap(input.previousSnapshot, input.previousAgentActions);
  const carriedControlByNode = buildCarriedControlMap(input.previousLocalVerdicts);
  const nextAssignments: Record<string, { attack: string[]; defense: string[] }> = {};
  const notes: string[] = [];

  for (const resource of liveResources) {
    const reachableNodes = getReachableNodes(input.graph, resource.side, input.nextPhaseId);
    const previousNodeId = previousAgentNodes[resource.agentId];
    const nextNodeId = chooseNextNode({
      graph: input.graph,
      previousNodeId,
      reachableNodes,
      side: resource.side,
      nextPhaseId: input.nextPhaseId
    });
    const bucket = (nextAssignments[nextNodeId] ??= { attack: [], defense: [] });
    bucket[resource.side].push(resource.agentId);
  }

  const reachableActiveNodeIds = uniqueSorted([
    ...getReachableNodes(input.graph, "attack", input.nextPhaseId),
    ...getReachableNodes(input.graph, "defense", input.nextPhaseId)
  ]);
  const activeNodeIds = uniqueSorted([
    ...reachableActiveNodeIds,
    ...Object.keys(nextAssignments),
    ...Object.keys(carriedControlByNode)
  ]);
  const nodeStates = activeNodeIds.map((nodeId) => {
    const assignment = nextAssignments[nodeId] ?? { attack: [], defense: [] };
    const control = deriveControl(assignment.attack, assignment.defense, carriedControlByNode[nodeId]);
    return {
      nodeId,
      phaseId: input.nextPhaseId,
      attackAgentIds: uniqueSorted(assignment.attack),
      defenseAgentIds: uniqueSorted(assignment.defense),
      control,
      businessIntent: buildBusinessIntent(input.nextPhaseId, nodeId, control, carriedControlByNode[nodeId]),
      beforeStateSummary: carriedControlByNode[nodeId] ? `上一阶段局部裁定控制权为 ${carriedControlByNode[nodeId]}。` : undefined,
      afterStateSummary: `物化到 ${input.nextPhaseId} 后，节点控制权为 ${control}。`,
      informationTransferred: true
    } satisfies MapNodeState;
  });

  if (eliminatedAgentIds.length > 0) {
    notes.push(`移除上一阶段阵亡 agent：${eliminatedAgentIds.join(", ")}。`);
  }
  notes.push(`根据上一阶段行动与局部裁定物化 ${input.nextPhaseId} 节点状态。`);

  return {
    phaseId: input.nextPhaseId,
    activeNodeIds,
    nodeStates,
    liveAgentIds: uniqueSorted(liveResources.map((resource) => resource.agentId)),
    eliminatedAgentIds,
    notes
  };
}

function buildPreviousAgentNodeMap(snapshot: RoundNodeStateSnapshot, actions: AgentPhaseAction[]): Record<string, string> {
  const nodesByAgent: Record<string, string> = {};
  for (const state of snapshot.nodeStates) {
    for (const agentId of state.attackAgentIds) {
      nodesByAgent[agentId] = state.nodeId;
    }
    for (const agentId of state.defenseAgentIds) {
      nodesByAgent[agentId] = state.nodeId;
    }
  }
  for (const action of actions) {
    nodesByAgent[action.agentId] = action.targetNodeId;
  }
  return nodesByAgent;
}

function buildCarriedControlMap(verdicts: LocalNodeVerdict[]): Record<string, MapNodeControl> {
  return Object.fromEntries(verdicts.map((verdict) => [verdict.nodeId, verdict.controlAfter]));
}

function chooseNextNode(input: {
  graph: MapNodeGraph;
  previousNodeId: string | undefined;
  reachableNodes: string[];
  side: "attack" | "defense";
  nextPhaseId: RoundPhaseId;
}): string {
  if (input.reachableNodes.length === 0) {
    return input.previousNodeId ?? (input.side === "attack" ? "t_spawn" : "ct_spawn");
  }
  if (input.previousNodeId && input.reachableNodes.includes(input.previousNodeId)) {
    return input.previousNodeId;
  }
  if (input.previousNodeId) {
    const adjacentReachable = getAdjacentNodes(input.graph, input.previousNodeId).find((nodeId) => input.reachableNodes.includes(nodeId));
    if (adjacentReachable) {
      return adjacentReachable;
    }
  }
  return input.reachableNodes[0]!;
}

function deriveControl(attackAgentIds: string[], defenseAgentIds: string[], carriedControl: MapNodeControl | undefined): MapNodeControl {
  if (attackAgentIds.length > 0 && defenseAgentIds.length > 0) {
    return "contested";
  }
  if (attackAgentIds.length > 0) {
    return "attack";
  }
  if (defenseAgentIds.length > 0) {
    return "defense";
  }
  return carriedControl ?? "neutral";
}

function buildBusinessIntent(phaseId: RoundPhaseId, nodeId: string, control: MapNodeControl, carriedControl: MapNodeControl | undefined): string {
  const carryText = carriedControl ? `承接上一阶段 ${carriedControl} 控制权，` : "";
  return `${carryText}在 ${phaseId} 将 ${nodeId} 物化为 ${control} 状态，用于后续局部裁判和硬胜负条件检查。`;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}
