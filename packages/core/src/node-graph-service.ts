import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mapNodeGraphSchema, type MapNodeGraph, type MapSide, type RoundPhaseId } from "@agent-major/shared";

const dust2NodeGraphPath = join("data", "materials", "processed", "maps", "dust2", "node-graph.json");

export class NodeGraphServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NodeGraphServiceError";
  }
}

export interface LoadMapNodeGraphOptions {
  rootDir?: string;
}

export function loadMapNodeGraph(mapSlug: string, options: LoadMapNodeGraphOptions = {}): MapNodeGraph {
  if (mapSlug !== "dust2") {
    throw new NodeGraphServiceError(`Unsupported map node graph: ${mapSlug}`);
  }

  const rootDir = options.rootDir ?? process.cwd();
  const raw = readFileSync(join(rootDir, dust2NodeGraphPath), "utf8");
  const graph = mapNodeGraphSchema.parse(JSON.parse(raw));
  return validateMapNodeGraph(graph);
}

export function validateMapNodeGraph(graph: MapNodeGraph): MapNodeGraph {
  const nodeIds = new Set<string>();
  const routeIds = new Set<string>();

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      throw new NodeGraphServiceError(`Duplicate node id: ${node.id}`);
    }
    nodeIds.add(node.id);
  }

  for (const edge of graph.edges) {
    ensureNodeExists(nodeIds, edge.from, `edge.from ${edge.from}`);
    ensureNodeExists(nodeIds, edge.to, `edge.to ${edge.to}`);
  }

  for (const route of graph.primary_routes) {
    if (routeIds.has(route.id)) {
      throw new NodeGraphServiceError(`Duplicate route id: ${route.id}`);
    }
    routeIds.add(route.id);
    validateRoute(graph, route.nodes);
  }

  for (const [groupId, groupNodeIds] of Object.entries(graph.site_groups)) {
    for (const nodeId of groupNodeIds) {
      ensureNodeExists(nodeIds, nodeId, `site group ${groupId}`);
    }
  }

  for (const side of ["attack", "defense"] as const) {
    const reachabilityByPhase = graph.timing_model.side_reachability_by_phase[side];
    for (const phase of graph.timing_model.round_phases) {
      const reachableNodeIds = reachabilityByPhase[phase.id] ?? [];
      for (const nodeId of reachableNodeIds) {
        ensureNodeExists(nodeIds, nodeId, `${side} reachability ${phase.id}`);
      }
    }
  }

  for (const note of graph.timing_model.route_timing_notes) {
    if (!routeIds.has(note.route_id)) {
      throw new NodeGraphServiceError(`Route timing note references unknown route: ${note.route_id}`);
    }
    for (const nodeId of note.attack_first_contact_nodes) {
      ensureNodeExists(nodeIds, nodeId, `route timing attack contact ${note.route_id}`);
    }
    for (const nodeId of note.defense_default_anchor_nodes) {
      ensureNodeExists(nodeIds, nodeId, `route timing defense anchor ${note.route_id}`);
    }
  }

  return graph;
}

export function getAdjacentNodes(graph: MapNodeGraph, nodeId: string): string[] {
  ensureNodeExists(getNodeIdSet(graph), nodeId, "adjacency lookup");
  const adjacent = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.from === nodeId) {
      adjacent.add(edge.to);
    }
    if (edge.to === nodeId) {
      adjacent.add(edge.from);
    }
  }
  return [...adjacent].sort();
}

export function validateRoute(graph: MapNodeGraph, nodeIds: string[]): true {
  if (nodeIds.length < 2) {
    throw new NodeGraphServiceError("Route must contain at least two nodes");
  }

  const knownNodeIds = getNodeIdSet(graph);
  for (const nodeId of nodeIds) {
    ensureNodeExists(knownNodeIds, nodeId, "route");
  }

  for (let i = 0; i < nodeIds.length - 1; i += 1) {
    const from = nodeIds[i]!;
    const to = nodeIds[i + 1]!;
    if (!hasEdgeBetween(graph, from, to)) {
      throw new NodeGraphServiceError(`Route contains non-adjacent nodes: ${from} -> ${to}`);
    }
  }

  return true;
}

export function getReachableNodes(graph: MapNodeGraph, side: MapSide, phase: RoundPhaseId): string[] {
  const phaseKnown = graph.timing_model.round_phases.some((roundPhase) => roundPhase.id === phase);
  if (!phaseKnown) {
    throw new NodeGraphServiceError(`Unknown round phase: ${phase}`);
  }

  return [...(graph.timing_model.side_reachability_by_phase[side][phase] ?? [])].sort();
}

export function validateNodeReachability(graph: MapNodeGraph, side: MapSide, phase: RoundPhaseId, nodeId: string): true {
  ensureNodeExists(getNodeIdSet(graph), nodeId, "reachability");
  const reachable = new Set(getReachableNodes(graph, side, phase));
  if (!reachable.has(nodeId)) {
    throw new NodeGraphServiceError(`Node ${nodeId} is not reachable for ${side} during ${phase}`);
  }
  return true;
}

function getNodeIdSet(graph: MapNodeGraph): Set<string> {
  return new Set(graph.nodes.map((node) => node.id));
}

function hasEdgeBetween(graph: MapNodeGraph, from: string, to: string): boolean {
  return graph.edges.some((edge) => (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from));
}

function ensureNodeExists(nodeIds: Set<string>, nodeId: string, context: string): void {
  if (!nodeIds.has(nodeId)) {
    throw new NodeGraphServiceError(`${context} references unknown node: ${nodeId}`);
  }
}
