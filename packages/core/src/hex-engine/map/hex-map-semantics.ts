import type { HexCell, HexCellFlag, HexMapAsset, HexPoint, HexRegion } from "@agent-major/shared";

export type HexMapSemanticLayer = "region" | "point" | "flag";
export type HexMapRuleCapability =
  | "playable"
  | "t_spawn"
  | "ct_spawn"
  | "plant_a"
  | "plant_b"
  | "cover"
  | "choke"
  | "high_risk"
  | "route_hint";

export interface HexMapSemanticRule {
  layer: HexMapSemanticLayer;
  authority: "hard_rule" | "tactical_target" | "spatial_context";
  summary: string;
  llmInstruction: string;
}

export const hexMapSemanticRules: Record<HexMapSemanticLayer, HexMapSemanticRule> = {
  region: {
    layer: "region",
    authority: "spatial_context",
    summary: "Region marks broad tactical space such as A Long, B Tunnels, Mid, or CT Spawn.",
    llmInstruction: "Use regions for route and context. Never infer spawn, plant, or win conditions from region names alone."
  },
  point: {
    layer: "point",
    authority: "tactical_target",
    summary: "Point marks a tactical sub-location inside a region, such as car, doors, default, or cover.",
    llmInstruction: "Use points as action targets. Never infer hard rules from point names alone."
  },
  flag: {
    layer: "flag",
    authority: "hard_rule",
    summary: "Flag is the only hard-rule source for playable cells, spawns, bombsites, cover, chokes, and risk markers.",
    llmInstruction: "Use flags as the source of truth for what the code allows. Names and text are only explanations."
  }
};

export const hexHardRuleFlags = ["playable", "spawn_t", "spawn_ct", "bombsite_a", "bombsite_b"] as const satisfies HexCellFlag[];
export const hexTacticalRuleFlags = ["cover", "choke", "high_risk", "route_hint"] as const satisfies HexCellFlag[];

export function getHexCellRuleCapabilities(cell: Pick<HexCell, "flags" | "playable">): Set<HexMapRuleCapability> {
  const capabilities = new Set<HexMapRuleCapability>();
  if (cell.playable || cell.flags.includes("playable")) {
    capabilities.add("playable");
  }
  if (cell.flags.includes("spawn_t")) {
    capabilities.add("t_spawn");
  }
  if (cell.flags.includes("spawn_ct")) {
    capabilities.add("ct_spawn");
  }
  if (cell.flags.includes("bombsite_a")) {
    capabilities.add("plant_a");
  }
  if (cell.flags.includes("bombsite_b")) {
    capabilities.add("plant_b");
  }
  if (cell.flags.includes("cover")) {
    capabilities.add("cover");
  }
  if (cell.flags.includes("choke")) {
    capabilities.add("choke");
  }
  if (cell.flags.includes("high_risk")) {
    capabilities.add("high_risk");
  }
  if (cell.flags.includes("route_hint")) {
    capabilities.add("route_hint");
  }
  return capabilities;
}

export function getRegionFlags(asset: HexMapAsset, region: HexRegion): Set<HexCellFlag> {
  return collectFlags(asset, region.cellIds);
}

export function getPointFlags(asset: HexMapAsset, point: HexPoint): Set<HexCellFlag> {
  return collectFlags(asset, point.cellIds);
}

export function hasAnyFlag(flags: Set<HexCellFlag>, candidates: readonly HexCellFlag[]): boolean {
  return candidates.some((candidate) => flags.has(candidate));
}

export function buildHexMapSemanticPromptContract(): string {
  return [
    "Hex map semantic contract:",
    "- Region is broad spatial context only. Region names never grant spawn, plant, cover, or win-condition permissions.",
    "- Point is a tactical target inside a region. Point names never grant spawn, plant, cover, or win-condition permissions.",
    "- Flag is the only hard-rule authority. Use spawn_t/spawn_ct for spawning, bombsite_a/bombsite_b for planting, cover for cover, choke for choke, high_risk for risk, and route_hint for route hints.",
    "- LLM drafts may mention regions and points for intent, but code validates movement, AP, economy, combat, bomb, and winner from cells and flags."
  ].join("\n");
}

function collectFlags(asset: HexMapAsset, cellIds: readonly string[]): Set<HexCellFlag> {
  const cellsById = new Map(asset.cells.map((cell) => [cell.cellId, cell]));
  const flags = new Set<HexCellFlag>();
  for (const cellId of cellIds) {
    const cell = cellsById.get(cellId);
    if (!cell) {
      continue;
    }
    for (const flag of cell.flags) {
      flags.add(flag);
    }
  }
  return flags;
}
