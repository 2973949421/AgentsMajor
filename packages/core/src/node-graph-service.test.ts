import { describe, expect, it } from "vitest";

import {
  getAdjacentNodes,
  getReachableNodes,
  loadMapNodeGraph,
  validateMapNodeGraph,
  validateNodeReachability,
  validateRoute
} from "./node-graph-service.js";

import type { MapNodeGraph } from "@agent-major/shared";

describe("NodeGraphService", () => {
  it("loads and validates the Dust2 node graph asset", () => {
    const graph = loadMapNodeGraph("dust2");

    expect(graph.nodes).toHaveLength(39);
    expect(graph.edges).toHaveLength(48);
    expect(graph.primary_routes).toHaveLength(6);
    expect(graph.timing_model.round_phases).toHaveLength(5);
  });

  it("loads the Dust2 node graph when called from the web app working directory", () => {
    const graph = loadMapNodeGraph("dust2", { rootDir: "apps/web" });

    expect(graph.map_slug).toBe("dust2");
    expect(graph.nodes).toHaveLength(39);
  });

  it("rejects unsupported map slugs", () => {
    expect(() => loadMapNodeGraph("mirage")).toThrow("Unsupported map node graph");
  });

  it("returns undirected adjacency for known nodes", () => {
    const graph = loadMapNodeGraph("dust2");

    expect(getAdjacentNodes(graph, "t_spawn")).toEqual(["outside_long", "outside_tunnels", "suicide", "top_mid"]);
  });

  it("validates legal routes and rejects non-adjacent jumps", () => {
    const graph = loadMapNodeGraph("dust2");

    expect(validateRoute(graph, ["t_spawn", "outside_long", "long_doors", "blue"])).toBe(true);
    expect(() => validateRoute(graph, ["t_spawn", "a_default"])).toThrow("non-adjacent");
  });

  it("enforces Dust2 opening reachability by side", () => {
    const graph = loadMapNodeGraph("dust2");

    expect(validateNodeReachability(graph, "attack", "default_opening", "t_spawn")).toBe(true);
    expect(() => validateNodeReachability(graph, "attack", "default_opening", "a_default")).toThrow("not reachable");
    expect(() => validateNodeReachability(graph, "attack", "default_opening", "b_default")).toThrow("not reachable");

    expect(validateNodeReachability(graph, "defense", "default_opening", "a_default")).toBe(true);
    expect(validateNodeReachability(graph, "defense", "default_opening", "b_default")).toBe(true);
  });

  it("exposes sorted reachable nodes for a side and phase", () => {
    const graph = loadMapNodeGraph("dust2");

    expect(getReachableNodes(graph, "attack", "default_opening")).toContain("top_mid");
    expect(getReachableNodes(graph, "defense", "default_opening")).toContain("b_window");
  });

  it("fails graph validation when edges or routes reference invalid nodes", () => {
    const graph = loadMapNodeGraph("dust2");
    const badEdgeGraph = cloneGraph(graph);
    badEdgeGraph.edges[0] = {
      from: graph.edges[0]!.from,
      to: "missing_node",
      type: graph.edges[0]!.type,
      label: graph.edges[0]!.label
    };

    expect(() => validateMapNodeGraph(badEdgeGraph)).toThrow("unknown node");

    const badRouteGraph = cloneGraph(graph);
    badRouteGraph.primary_routes[0] = {
      id: graph.primary_routes[0]!.id,
      display_name: graph.primary_routes[0]!.display_name,
      business_semantics: graph.primary_routes[0]!.business_semantics,
      nodes: ["t_spawn", "a_default"]
    };

    expect(() => validateMapNodeGraph(badRouteGraph)).toThrow("non-adjacent");
  });

  it("rejects unknown node ids for adjacency and reachability checks", () => {
    const graph = loadMapNodeGraph("dust2");

    expect(() => getAdjacentNodes(graph, "missing_node")).toThrow("unknown node");
    expect(() => validateNodeReachability(graph, "attack", "first_contact", "missing_node")).toThrow("unknown node");
  });
});

function cloneGraph(graph: MapNodeGraph): MapNodeGraph {
  return JSON.parse(JSON.stringify(graph)) as MapNodeGraph;
}
