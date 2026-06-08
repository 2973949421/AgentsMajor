import { describe, expect, it } from "vitest";

import {
  getSectorForNode,
  loadMapSectorMap,
  summarizePhaseSectors,
  validateMapSectorMap
} from "./map-sector-service.js";
import { loadMapNodeGraph } from "./node-graph-service.js";

import type { MapSectorMap } from "./map-sector-service.js";

describe("MapSectorService", () => {
  it("loads and validates the Dust2 sector map asset", () => {
    const graph = loadMapNodeGraph("dust2");
    const sectorMap = validateMapSectorMap(loadMapSectorMap("dust2"), graph);

    expect(sectorMap.sectors).toHaveLength(13);
    expect(sectorMap.sectors.map((sector) => sector.sectorId)).toContain("a_site");
    expect(sectorMap.sectors.map((sector) => sector.sectorId)).toContain("mid_top_mid");
    expect(sectorMap.sectors.every((sector) => sector.visual.svgPath.startsWith("M"))).toBe(true);
    expect(sectorMap.sectors.every((sector) => sector.visual.labelAnchor.length === 2)).toBe(true);
  });

  it("loads the Dust2 sector map when called from the web app working directory", () => {
    const sectorMap = loadMapSectorMap("dust2", { rootDir: "apps/web" });

    expect(sectorMap.map_slug).toBe("dust2");
    expect(sectorMap.sectors).toHaveLength(13);
  });

  it("maps every Dust2 node into exactly one sector", () => {
    const graph = loadMapNodeGraph("dust2");
    const sectorMap = validateMapSectorMap(loadMapSectorMap("dust2"), graph);

    const mappedNodeIds = sectorMap.sectors.flatMap((sector) => sector.nodeIds).sort();
    expect(mappedNodeIds).toEqual(graph.nodes.map((node) => node.id).sort());
  });

  it("returns the sector for a known node and rejects missing nodes", () => {
    const sectorMap = loadMapSectorMap("dust2");

    expect(getSectorForNode(sectorMap, "a_default").sectorId).toBe("a_site");
    expect(getSectorForNode(sectorMap, "mid_doors").sectorId).toBe("ct_b_rotate");
    expect(() => getSectorForNode(sectorMap, "missing_node")).toThrow("No sector contains node");
  });

  it("rejects sector maps with unknown node references", () => {
    const graph = loadMapNodeGraph("dust2");
    const sectorMap = cloneSectorMap(loadMapSectorMap("dust2"));
    sectorMap.sectors[0]!.nodeIds = [...sectorMap.sectors[0]!.nodeIds, "missing_node"];

    expect(() => validateMapSectorMap(sectorMap, graph)).toThrow("unknown node");
  });

  it("rejects sector maps missing visual svg paths", () => {
    const graph = loadMapNodeGraph("dust2");
    const sectorMap = cloneSectorMap(loadMapSectorMap("dust2"));
    sectorMap.sectors[0]!.visual.svgPath = "";

    expect(() => validateMapSectorMap(sectorMap, graph)).toThrow("visual svgPath");
  });

  it("rejects sector maps with out-of-bounds visual label anchors", () => {
    const graph = loadMapNodeGraph("dust2");
    const sectorMap = cloneSectorMap(loadMapSectorMap("dust2"));
    sectorMap.sectors[0]!.visual.labelAnchor = [101, 50];

    expect(() => validateMapSectorMap(sectorMap, graph)).toThrow("labelAnchor");
  });

  it("rejects sector maps with unknown sector edge references", () => {
    const graph = loadMapNodeGraph("dust2");
    const sectorMap = cloneSectorMap(loadMapSectorMap("dust2"));
    sectorMap.sectorEdges[0] = {
      from: sectorMap.sectorEdges[0]!.from,
      to: "missing_sector",
      type: sectorMap.sectorEdges[0]!.type
    };

    expect(() => validateMapSectorMap(sectorMap, graph)).toThrow("unknown to sector");
  });

  it("summarizes phase node facts into sector state", () => {
    const sectorMap = loadMapSectorMap("dust2");
    const summaries = summarizePhaseSectors({
      sectorMap,
      activeNodeIds: ["a_default", "a_short", "mid"],
      nodeStates: [
        {
          nodeId: "a_default",
          attackAgentIds: ["attacker_1"],
          defenseAgentIds: ["defender_1"],
          control: "contested"
        },
        {
          nodeId: "mid",
          attackAgentIds: ["attacker_2"],
          defenseAgentIds: [],
          control: "attack"
        }
      ],
      localVerdicts: [
        {
          nodeId: "a_default",
          controlAfter: "contested",
          engagementOccurred: true,
          triggersWinConditionCheck: true
        }
      ],
      fallbackNodeIds: ["a_default"]
    });

    const aSite = summaries.find((summary) => summary.sectorId === "a_site");
    const mid = summaries.find((summary) => summary.sectorId === "mid_top_mid");

    expect(aSite).toMatchObject({
      active: true,
      attackCount: 1,
      defenseCount: 1,
      controlAfter: "contested",
      engagementOccurred: true,
      winConditionCheck: true,
      fallbackCount: 1
    });
    expect(mid).toMatchObject({
      active: true,
      attackCount: 1,
      defenseCount: 0,
      controlAfter: "attack"
    });
  });
});

function cloneSectorMap(sectorMap: MapSectorMap): MapSectorMap {
  return JSON.parse(JSON.stringify(sectorMap)) as MapSectorMap;
}
