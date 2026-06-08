import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { MapNodeGraph } from "@agent-major/shared";

const dust2SectorMapPath = join("data", "materials", "processed", "maps", "dust2", "sector-map.json");

export type MapSectorAreaType = "A" | "B" | "Mid" | "Long" | "Tunnel" | "Spawn" | "Rotate";
export type MapSectorControl = "attack" | "defense" | "contested" | "neutral";

export interface MapSectorCoordinateSystem {
  width: number;
  height: number;
  origin: "top_left";
  unit: "normalized_percent";
}

export interface MapSectorDefinition {
  sectorId: string;
  displayName: string;
  displayNameZh: string;
  areaType: MapSectorAreaType;
  nodeIds: string[];
  adjacentSectorIds: string[];
  polygon: Array<[number, number]>;
  visual: MapSectorVisualMetadata;
}

export interface MapSectorVisualMetadata {
  svgPath: string;
  labelAnchor: [number, number];
  labelPriority: "primary" | "secondary" | "debug";
  labelShort: string;
}

export interface MapSectorEdge {
  from: string;
  to: string;
  type: string;
}

export interface MapSectorMap {
  asset_id: string;
  map_slug: string;
  display_name: string;
  phase_scope: string;
  purpose: string;
  coordinateSystem: MapSectorCoordinateSystem;
  sourceReferences: Array<{
    id: string;
    path: string;
    purpose: string;
  }>;
  sectors: MapSectorDefinition[];
  sectorEdges: MapSectorEdge[];
}

export interface MapSectorNodeStateInput {
  nodeId: string;
  attackAgentIds?: string[];
  defenseAgentIds?: string[];
  control?: string;
}

export interface MapSectorLocalVerdictInput {
  nodeId: string;
  controlAfter?: string;
  engagementOccurred?: boolean;
  triggersWinConditionCheck?: boolean;
}

export interface SummarizePhaseSectorsInput {
  sectorMap: MapSectorMap;
  activeNodeIds: string[];
  nodeStates: MapSectorNodeStateInput[];
  localVerdicts?: MapSectorLocalVerdictInput[];
  fallbackNodeIds?: string[];
}

export interface MapSectorStateSummary {
  sectorId: string;
  nodeIds: string[];
  active: boolean;
  attackCount: number;
  defenseCount: number;
  controlAfter: MapSectorControl;
  engagementOccurred: boolean;
  winConditionCheck: boolean;
  fallbackCount: number;
}

export class MapSectorServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MapSectorServiceError";
  }
}

export interface LoadMapSectorMapOptions {
  rootDir?: string;
}

export function loadMapSectorMap(mapSlug: string, options: LoadMapSectorMapOptions = {}): MapSectorMap {
  if (mapSlug !== "dust2") {
    throw new MapSectorServiceError(`Unsupported map sector map: ${mapSlug}`);
  }

  const rootDir = resolveProjectRootForMapSectors(options.rootDir ?? process.cwd());
  const raw = readFileSync(join(rootDir, dust2SectorMapPath), "utf8");
  return parseMapSectorMap(JSON.parse(raw));
}

export function resolveProjectRootForMapSectors(startDirectory: string): string {
  let current = resolve(startDirectory);

  while (true) {
    if (existsSync(join(current, dust2SectorMapPath))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new MapSectorServiceError(`Unable to locate Dust2 sector map asset from ${startDirectory}`);
    }
    current = parent;
  }
}

export function validateMapSectorMap(sectorMap: MapSectorMap, nodeGraph: MapNodeGraph): MapSectorMap {
  if (sectorMap.map_slug !== nodeGraph.map_slug) {
    throw new MapSectorServiceError(`Sector map slug ${sectorMap.map_slug} does not match node graph ${nodeGraph.map_slug}`);
  }

  const graphNodeIds = new Set(nodeGraph.nodes.map((node) => node.id));
  const sectorIds = new Set<string>();
  const nodeOwner = new Map<string, string>();

  for (const sector of sectorMap.sectors) {
    if (sectorIds.has(sector.sectorId)) {
      throw new MapSectorServiceError(`Duplicate sector id: ${sector.sectorId}`);
    }
    sectorIds.add(sector.sectorId);

    if (sector.polygon.length < 3) {
      throw new MapSectorServiceError(`Sector ${sector.sectorId} must have at least three polygon points`);
    }
    if (sector.visual.svgPath.trim().length === 0) {
      throw new MapSectorServiceError(`Sector ${sector.sectorId} must have a visual svgPath`);
    }
    assertNormalizedPoint(sector.visual.labelAnchor, `Sector ${sector.sectorId} visual labelAnchor`);

    for (const nodeId of sector.nodeIds) {
      if (!graphNodeIds.has(nodeId)) {
        throw new MapSectorServiceError(`Sector ${sector.sectorId} references unknown node: ${nodeId}`);
      }
      const existingOwner = nodeOwner.get(nodeId);
      if (existingOwner) {
        throw new MapSectorServiceError(`Node ${nodeId} is mapped to multiple sectors: ${existingOwner}, ${sector.sectorId}`);
      }
      nodeOwner.set(nodeId, sector.sectorId);
    }
  }

  for (const nodeId of graphNodeIds) {
    if (!nodeOwner.has(nodeId)) {
      throw new MapSectorServiceError(`Node is missing from sector map: ${nodeId}`);
    }
  }

  for (const sector of sectorMap.sectors) {
    for (const adjacentSectorId of sector.adjacentSectorIds) {
      if (!sectorIds.has(adjacentSectorId)) {
        throw new MapSectorServiceError(`Sector ${sector.sectorId} references unknown adjacent sector: ${adjacentSectorId}`);
      }
    }
  }

  for (const edge of sectorMap.sectorEdges) {
    if (!sectorIds.has(edge.from)) {
      throw new MapSectorServiceError(`Sector edge references unknown from sector: ${edge.from}`);
    }
    if (!sectorIds.has(edge.to)) {
      throw new MapSectorServiceError(`Sector edge references unknown to sector: ${edge.to}`);
    }
  }

  return sectorMap;
}

export function getSectorForNode(sectorMap: MapSectorMap, nodeId: string): MapSectorDefinition {
  const sector = sectorMap.sectors.find((item) => item.nodeIds.includes(nodeId));
  if (!sector) {
    throw new MapSectorServiceError(`No sector contains node: ${nodeId}`);
  }
  return sector;
}

export function summarizePhaseSectors(input: SummarizePhaseSectorsInput): MapSectorStateSummary[] {
  const activeNodeIds = new Set(input.activeNodeIds);
  const fallbackNodeIds = new Set(input.fallbackNodeIds ?? []);
  const stateByNodeId = new Map(input.nodeStates.map((state) => [state.nodeId, state]));
  const verdictByNodeId = new Map((input.localVerdicts ?? []).map((verdict) => [verdict.nodeId, verdict]));

  return input.sectorMap.sectors.map((sector) => {
    let attackCount = 0;
    let defenseCount = 0;
    let active = false;
    let engagementOccurred = false;
    let winConditionCheck = false;
    let fallbackCount = 0;
    const controls: MapSectorControl[] = [];

    for (const nodeId of sector.nodeIds) {
      const state = stateByNodeId.get(nodeId);
      const verdict = verdictByNodeId.get(nodeId);
      attackCount += state?.attackAgentIds?.length ?? 0;
      defenseCount += state?.defenseAgentIds?.length ?? 0;
      active = active || activeNodeIds.has(nodeId);
      engagementOccurred = engagementOccurred || verdict?.engagementOccurred === true;
      winConditionCheck = winConditionCheck || verdict?.triggersWinConditionCheck === true;
      fallbackCount += fallbackNodeIds.has(nodeId) ? 1 : 0;

      const control = normalizeSectorControl(verdict?.controlAfter ?? state?.control);
      if (control) {
        controls.push(control);
      }
    }

    return {
      sectorId: sector.sectorId,
      nodeIds: [...sector.nodeIds],
      active,
      attackCount,
      defenseCount,
      controlAfter: deriveSectorControl({ attackCount, defenseCount, controls }),
      engagementOccurred,
      winConditionCheck,
      fallbackCount
    };
  });
}

function parseMapSectorMap(value: unknown): MapSectorMap {
  const record = ensureRecord(value, "sector map");
  return {
    asset_id: readRequiredString(record.asset_id, "asset_id"),
    map_slug: readRequiredString(record.map_slug, "map_slug"),
    display_name: readRequiredString(record.display_name, "display_name"),
    phase_scope: readRequiredString(record.phase_scope, "phase_scope"),
    purpose: readRequiredString(record.purpose, "purpose"),
    coordinateSystem: parseCoordinateSystem(record.coordinateSystem),
    sourceReferences: readArray(record.sourceReferences, "sourceReferences").map((item, index) => {
      const source = ensureRecord(item, `sourceReferences[${index}]`);
      return {
        id: readRequiredString(source.id, `sourceReferences[${index}].id`),
        path: readRequiredString(source.path, `sourceReferences[${index}].path`),
        purpose: readRequiredString(source.purpose, `sourceReferences[${index}].purpose`)
      };
    }),
    sectors: readArray(record.sectors, "sectors").map(parseSector),
    sectorEdges: readArray(record.sectorEdges, "sectorEdges").map((item, index) => {
      const edge = ensureRecord(item, `sectorEdges[${index}]`);
      return {
        from: readRequiredString(edge.from, `sectorEdges[${index}].from`),
        to: readRequiredString(edge.to, `sectorEdges[${index}].to`),
        type: readRequiredString(edge.type, `sectorEdges[${index}].type`)
      };
    })
  };
}

function parseCoordinateSystem(value: unknown): MapSectorCoordinateSystem {
  const coordinateSystem = ensureRecord(value, "coordinateSystem");
  const origin = readRequiredString(coordinateSystem.origin, "coordinateSystem.origin");
  const unit = readRequiredString(coordinateSystem.unit, "coordinateSystem.unit");
  if (origin !== "top_left") {
    throw new MapSectorServiceError(`Unsupported coordinate origin: ${origin}`);
  }
  if (unit !== "normalized_percent") {
    throw new MapSectorServiceError(`Unsupported coordinate unit: ${unit}`);
  }
  return {
    width: readRequiredNumber(coordinateSystem.width, "coordinateSystem.width"),
    height: readRequiredNumber(coordinateSystem.height, "coordinateSystem.height"),
    origin,
    unit
  };
}

function parseSector(item: unknown, index: number): MapSectorDefinition {
  const sector = ensureRecord(item, `sectors[${index}]`);
  return {
    sectorId: readRequiredString(sector.sectorId, `sectors[${index}].sectorId`),
    displayName: readRequiredString(sector.displayName, `sectors[${index}].displayName`),
    displayNameZh: readRequiredString(sector.displayNameZh, `sectors[${index}].displayNameZh`),
    areaType: parseAreaType(sector.areaType, `sectors[${index}].areaType`),
    nodeIds: readStringArray(sector.nodeIds, `sectors[${index}].nodeIds`),
    adjacentSectorIds: readStringArray(sector.adjacentSectorIds, `sectors[${index}].adjacentSectorIds`),
    polygon: readArray(sector.polygon, `sectors[${index}].polygon`).map((point, pointIndex) => parsePoint(point, `sectors[${index}].polygon[${pointIndex}]`)),
    visual: parseSectorVisual(sector.visual, `sectors[${index}].visual`)
  };
}

function parseSectorVisual(value: unknown, context: string): MapSectorVisualMetadata {
  const visual = ensureRecord(value, context);
  return {
    svgPath: readRequiredString(visual.svgPath, `${context}.svgPath`),
    labelAnchor: parsePoint(visual.labelAnchor, `${context}.labelAnchor`),
    labelPriority: parseLabelPriority(visual.labelPriority, `${context}.labelPriority`),
    labelShort: readRequiredString(visual.labelShort, `${context}.labelShort`)
  };
}

function parseLabelPriority(value: unknown, context: string): "primary" | "secondary" | "debug" {
  const priority = readRequiredString(value, context);
  if (priority === "primary" || priority === "secondary" || priority === "debug") {
    return priority;
  }
  throw new MapSectorServiceError(`${context} has unsupported label priority: ${priority}`);
}

function parseAreaType(value: unknown, context: string): MapSectorAreaType {
  const areaType = readRequiredString(value, context);
  if (areaType === "A" || areaType === "B" || areaType === "Mid" || areaType === "Long" || areaType === "Tunnel" || areaType === "Spawn" || areaType === "Rotate") {
    return areaType;
  }
  throw new MapSectorServiceError(`${context} has unsupported area type: ${areaType}`);
}

function parsePoint(value: unknown, context: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new MapSectorServiceError(`${context} must be a [x, y] point`);
  }
  const x = readRequiredNumber(value[0], `${context}[0]`);
  const y = readRequiredNumber(value[1], `${context}[1]`);
  if (x < 0 || x > 100 || y < 0 || y > 100) {
    throw new MapSectorServiceError(`${context} must be normalized between 0 and 100`);
  }
  return [x, y];
}

function assertNormalizedPoint(value: [number, number], context: string): void {
  const [x, y] = value;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) {
    throw new MapSectorServiceError(`${context} must be normalized between 0 and 100`);
  }
}

function deriveSectorControl(input: {
  attackCount: number;
  defenseCount: number;
  controls: MapSectorControl[];
}): MapSectorControl {
  if (input.controls.includes("contested") || (input.attackCount > 0 && input.defenseCount > 0)) {
    return "contested";
  }
  if (input.controls.includes("attack") || input.attackCount > 0) {
    return "attack";
  }
  if (input.controls.includes("defense") || input.defenseCount > 0) {
    return "defense";
  }
  return "neutral";
}

function normalizeSectorControl(value: unknown): MapSectorControl | null {
  return value === "attack" || value === "defense" || value === "contested" || value === "neutral" ? value : null;
}

function ensureRecord(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MapSectorServiceError(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readRequiredString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new MapSectorServiceError(`${context} must be a non-empty string`);
  }
  return value;
}

function readRequiredNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MapSectorServiceError(`${context} must be a finite number`);
  }
  return value;
}

function readArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new MapSectorServiceError(`${context} must be an array`);
  }
  return value;
}

function readStringArray(value: unknown, context: string): string[] {
  return readArray(value, context).map((item, index) => readRequiredString(item, `${context}[${index}]`));
}
