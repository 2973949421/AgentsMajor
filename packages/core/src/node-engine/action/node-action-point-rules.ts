import type { AgentPhaseActionType, MapNodeGraph } from "@agent-major/shared";

import type { NodeAgentEconomyResource } from "../economy/economy-resource-adapter.js";

export interface NodeActionPointCostBreakdown {
  routeCost: number;
  actionCost: number;
  utilityCost: number;
  loadoutModifier: number;
  totalCost: number;
  claimedCostFromLlm?: number;
}

export interface CalculateNodeActionPointCostInput {
  graph: MapNodeGraph;
  resource: NodeAgentEconomyResource;
  actionType: AgentPhaseActionType;
  currentNodeId: string;
  targetNodeId: string;
  claimedCostFromLlm?: number;
}

export interface NodeRouteCostResult {
  reachable: boolean;
  routeCost: number;
  path: string[];
}

export function calculateNodeActionPointCost(input: CalculateNodeActionPointCostInput): NodeActionPointCostBreakdown {
  const route = calculateNodeRouteCost(input.graph, input.currentNodeId, input.targetNodeId);
  const routeCost = route.reachable ? route.routeCost : Number.POSITIVE_INFINITY;
  const actionCost = actionPointCostForActionType(input.actionType);
  const utilityCost = utilityCostForAction(input.resource, input.actionType);
  const loadoutModifier = loadoutModifierForAction(input.resource, routeCost);
  const totalCost = routeCost + actionCost + utilityCost + loadoutModifier;

  return {
    routeCost,
    actionCost,
    utilityCost,
    loadoutModifier,
    totalCost,
    ...(input.claimedCostFromLlm !== undefined ? { claimedCostFromLlm: input.claimedCostFromLlm } : {})
  };
}

export function calculateNodeRouteCost(graph: MapNodeGraph, currentNodeId: string, targetNodeId: string): NodeRouteCostResult {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  if (!nodeIds.has(currentNodeId) || !nodeIds.has(targetNodeId)) {
    return { reachable: false, routeCost: Number.POSITIVE_INFINITY, path: [] };
  }
  if (currentNodeId === targetNodeId) {
    return { reachable: true, routeCost: 0, path: [currentNodeId] };
  }

  const adjacency = buildAdjacency(graph);
  const queue: string[][] = [[currentNodeId]];
  const visited = new Set<string>([currentNodeId]);

  while (queue.length > 0) {
    const path = queue.shift()!;
    const last = path[path.length - 1]!;
    for (const next of adjacency.get(last) ?? []) {
      if (visited.has(next)) {
        continue;
      }
      const nextPath = [...path, next];
      if (next === targetNodeId) {
        return { reachable: true, routeCost: nextPath.length - 1, path: nextPath };
      }
      visited.add(next);
      queue.push(nextPath);
    }
  }

  return { reachable: false, routeCost: Number.POSITIVE_INFINITY, path: [] };
}

export function actionPointCostForActionType(actionType: AgentPhaseActionType): number {
  switch (actionType) {
    case "hold_position":
      return 0;
    case "watch_angle":
    case "map_control":
    case "gather_info":
    case "seek_duel":
    case "prepare_trade":
    case "fake_pressure":
    case "rotate":
    case "post_plant_hold":
    case "save":
      return 1;
    case "use_utility":
      return 1;
    case "execute_site":
    case "retake":
    case "defuse":
      return 2;
  }
}

function utilityCostForAction(resource: NodeAgentEconomyResource, actionType: AgentPhaseActionType): number {
  if (actionType !== "use_utility" && actionType !== "execute_site" && actionType !== "retake") {
    return 0;
  }
  if (resource.utilityTier === "none") {
    return 1;
  }
  return 0;
}

function loadoutModifierForAction(resource: NodeAgentEconomyResource, routeCost: number): number {
  if (resource.weaponTier === "awp" && Number.isFinite(routeCost) && routeCost >= 2) {
    return 1;
  }
  return 0;
}

function buildAdjacency(graph: MapNodeGraph): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of graph.edges) {
    adjacency.get(edge.from)?.push(edge.to);
    adjacency.get(edge.to)?.push(edge.from);
  }
  for (const [nodeId, nodes] of adjacency.entries()) {
    adjacency.set(nodeId, [...new Set(nodes)].sort());
  }
  return adjacency;
}
