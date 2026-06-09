import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { HexMapAsset } from "../../../../shared/src/hex-schemas.js";
import { validateHexMapAsset } from "./hex-map-validator.js";

describe("HexMapValidator", () => {
  it("accepts the Dust2 draft hex map asset", () => {
    const asset = loadDraftDust2HexMap();
    const result = validateHexMapAsset(asset);

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("accepts the official Dust2 hex map asset", () => {
    const asset = loadOfficialDust2HexMap();
    const result = validateHexMapAsset(asset);

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("keeps official Dust2 playable cells connected", () => {
    const asset = loadOfficialDust2HexMap();

    expect(countReachablePlayableCells(asset)).toBe(asset.cells.filter((cell) => cell.playable).length);
  });

  it("rejects duplicate cell ids", () => {
    const asset = loadDraftDust2HexMap();
    asset.cells.push({ ...asset.cells[0]! });

    const result = validateHexMapAsset(asset);

    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("duplicate_cell_id");
  });

  it("rejects regions that reference unknown cells", () => {
    const asset = loadDraftDust2HexMap();
    asset.regions[0] = { ...asset.regions[0]!, cellIds: ["missing_cell"] };

    const result = validateHexMapAsset(asset);

    expect(result.errors.map((error) => error.code)).toContain("region_unknown_cell");
  });

  it("rejects points that reference unknown regions", () => {
    const asset = loadDraftDust2HexMap();
    asset.points[0] = { ...asset.points[0]!, parentRegionId: "missing_region" };

    const result = validateHexMapAsset(asset);

    expect(result.errors.map((error) => error.code)).toContain("point_unknown_region");
  });

  it("rejects route hints that reference unknown points or cells", () => {
    const asset = loadDraftDust2HexMap();
    asset.routeHints[0] = {
      ...asset.routeHints[0]!,
      fromPointId: "missing_point",
      viaCellIds: ["missing_cell"]
    };

    const result = validateHexMapAsset(asset);

    expect(result.errors.map((error) => error.code)).toContain("route_unknown_point");
    expect(result.errors.map((error) => error.code)).toContain("route_unknown_cell");
  });

  it("requires T/CT spawns and A/B bombsites to be represented", () => {
    const asset = loadDraftDust2HexMap();
    asset.cells = asset.cells.map((cell) => ({
      ...cell,
      flags: cell.flags.filter((flag) => flag !== "spawn_t")
    }));

    const result = validateHexMapAsset(asset);

    expect(result.errors.map((error) => error.code)).toContain("missing_spawn_t");
  });

  it("rejects semantic site and spawn names that are missing hard-rule flags", () => {
    const asset = loadDraftDust2HexMap();
    const aSite = asset.regions.find((region) => region.regionType === "a_site")!;
    const aBombsitePoint = asset.points.find((point) => point.pointType === "bombsite" && point.parentRegionId === aSite.regionId)!;
    const affectedCellIds = new Set([...aSite.cellIds, ...aBombsitePoint.cellIds]);
    asset.cells = asset.cells.map((cell) =>
      affectedCellIds.has(cell.cellId)
        ? {
            ...cell,
            flags: cell.flags.filter((flag) => flag !== "bombsite_a")
          }
        : cell
    );

    const result = validateHexMapAsset(asset);
    const errorCodes = result.errors.map((error) => error.code);

    expect(result.ok).toBe(false);
    expect(errorCodes).toContain("region_semantic_missing_bombsite_a_flag");
    expect(errorCodes).toContain("point_semantic_missing_bombsite_flag");
  });

  it("warns when tactical route points lack route_hint flags", () => {
    const asset = loadDraftDust2HexMap();
    const routePoint = asset.points.find((point) => point.pointType === "route")!;
    const routeCellIds = new Set(routePoint.cellIds);
    asset.cells = asset.cells.map((cell) =>
      routeCellIds.has(cell.cellId)
        ? {
            ...cell,
            flags: cell.flags.filter((flag) => flag !== "route_hint")
          }
        : cell
    );

    const result = validateHexMapAsset(asset);

    expect(result.ok).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toContain("point_semantic_missing_route_hint_flag");
  });

  it("warns when playable cells are not assigned to a region", () => {
    const asset = loadDraftDust2HexMap();
    const cell = findUnusedCell(asset, 0);
    asset.cells.push({
      cellId: cell.cellId,
      col: cell.col,
      row: cell.row,
      level: 0,
      playable: true,
      terrain: "floor",
      flags: ["playable"],
      pointIds: []
    });

    const result = validateHexMapAsset(asset);

    expect(result.ok).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toContain("playable_cell_without_region");
  });

  it("warns when cell and region or point indexes drift apart", () => {
    const asset = loadDraftDust2HexMap();
    const cell = asset.cells.find((candidate) => candidate.regionId && candidate.pointIds.length > 0)!;
    const region = asset.regions.find((candidate) => candidate.regionId === cell.regionId)!;
    const point = asset.points.find((candidate) => candidate.pointId === cell.pointIds[0])!;

    region.cellIds = region.cellIds.filter((cellId) => cellId !== cell.cellId);
    point.cellIds = point.cellIds.filter((cellId) => cellId !== cell.cellId);

    const result = validateHexMapAsset(asset);
    const warningCodes = result.warnings.map((warning) => warning.code);

    expect(result.ok).toBe(true);
    expect(warningCodes).toContain("cell_region_membership_mismatch");
    expect(warningCodes).toContain("cell_point_membership_mismatch");
  });

  it("rejects cells that reference unknown regions or points", () => {
    const asset = loadDraftDust2HexMap();
    asset.cells[0] = {
      ...asset.cells[0]!,
      regionId: "missing_region",
      pointIds: ["missing_point"]
    };

    const result = validateHexMapAsset(asset);
    const errorCodes = result.errors.map((error) => error.code);

    expect(result.ok).toBe(false);
    expect(errorCodes).toContain("cell_unknown_region");
    expect(errorCodes).toContain("cell_unknown_point");
  });

  it("rejects duplicate cells at the same col row and level", () => {
    const asset = loadDraftDust2HexMap();
    asset.cells.push({
      ...asset.cells[0]!,
      cellId: "h_24_06_duplicate_l0"
    });

    const result = validateHexMapAsset(asset);

    expect(result.errors.map((error) => error.code)).toContain("duplicate_cell_coordinate");
    expect(result.errors.map((error) => error.code)).toContain("cell_id_coordinate_mismatch");
  });

  it("allows the same col and row on different levels", () => {
    const asset = loadDraftDust2HexMap();
    const baseCell = findCellWithoutLevelTwin(asset, 1);
    asset.cells.push({
      ...baseCell,
      cellId: toTestCellId(baseCell.col, baseCell.row, 1),
      level: 1
    });

    const result = validateHexMapAsset(asset);

    expect(result.errors.map((error) => error.code)).not.toContain("duplicate_cell_coordinate");
    expect(result.errors.map((error) => error.code)).not.toContain("cell_unknown_level");
  });

  it("rejects cell ids that do not match col row and level", () => {
    const asset = loadDraftDust2HexMap();
    asset.cells[0] = { ...asset.cells[0]!, cellId: "h_49_49_l0" };

    const result = validateHexMapAsset(asset);

    expect(result.errors.map((error) => error.code)).toContain("cell_id_coordinate_mismatch");
  });

  it("validates vertical links", () => {
    const asset = loadDraftDust2HexMap();
    const baseCell = findCellWithoutLevelTwin(asset, 1);
    const upperCell = { ...baseCell, cellId: toTestCellId(baseCell.col, baseCell.row, 1), level: 1 as const };
    asset.cells.push(upperCell);
    asset.verticalLinks = [
      {
        linkId: "stairs_ct_l0_l1",
        fromCellId: baseCell.cellId,
        toCellId: upperCell.cellId,
        linkType: "stairs",
        apCostModifier: 0.2,
        oneWay: false
      },
      {
        linkId: "drop_ct_l1_l0",
        fromCellId: upperCell.cellId,
        toCellId: baseCell.cellId,
        linkType: "drop",
        apCostModifier: 0.1,
        oneWay: true
      },
      {
        linkId: "one_way_stairs_ct_l1_l0",
        fromCellId: upperCell.cellId,
        toCellId: baseCell.cellId,
        linkType: "stairs",
        apCostModifier: 0.2,
        oneWay: true
      }
    ];

    const result = validateHexMapAsset(asset);

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("rejects invalid vertical links", () => {
    const asset = loadDraftDust2HexMap();
    const sameLevelCells = asset.cells.filter((cell) => cell.level === asset.defaultLevel);
    const fromCell = sameLevelCells[0]!;
    const toCell = sameLevelCells[1]!;
    asset.verticalLinks = [
      {
        linkId: "same_level",
        fromCellId: fromCell.cellId,
        toCellId: toCell.cellId,
        linkType: "stairs",
        apCostModifier: 0.2,
        oneWay: true
      },
      {
        linkId: "unknown_cell",
        fromCellId: fromCell.cellId,
        toCellId: "h_24_06_l1",
        linkType: "drop",
        apCostModifier: 0.1,
        oneWay: true
      }
    ];

    const result = validateHexMapAsset(asset);
    const codes = result.errors.map((error) => error.code);

    expect(codes).toContain("vertical_link_same_level");
    expect(codes).toContain("vertical_link_unknown_cell");
  });
});

function loadDraftDust2HexMap(): HexMapAsset {
  const raw = readFileSync(join(process.cwd(), "data/materials/processed/maps/dust2/hex/dust2-hex-map.draft.json"), "utf8");
  return JSON.parse(raw) as HexMapAsset;
}

function loadOfficialDust2HexMap(): HexMapAsset {
  const raw = readFileSync(join(process.cwd(), "data/materials/processed/maps/dust2/hex/dust2-hex-map.json"), "utf8");
  return JSON.parse(raw) as HexMapAsset;
}

function findUnusedCell(asset: HexMapAsset, level: number): { cellId: string; col: number; row: number } {
  const used = new Set(asset.cells.map((cell) => `${cell.col}:${cell.row}:${cell.level}`));
  for (let row = 0; row < asset.grid.height; row += 1) {
    for (let col = 0; col < asset.grid.width; col += 1) {
      if (!used.has(`${col}:${row}:${level}`)) {
        return { cellId: toTestCellId(col, row, level), col, row };
      }
    }
  }
  throw new Error(`No unused test cell on level ${level}`);
}

function findCellWithoutLevelTwin(asset: HexMapAsset, targetLevel: number) {
  const used = new Set(asset.cells.map((cell) => `${cell.col}:${cell.row}:${cell.level}`));
  const cell = asset.cells.find((candidate) => !used.has(`${candidate.col}:${candidate.row}:${targetLevel}`));
  if (!cell) {
    throw new Error(`No cell without level ${targetLevel} twin`);
  }
  return cell;
}

function toTestCellId(col: number, row: number, level: number): string {
  return `h_${String(col).padStart(2, "0")}_${String(row).padStart(2, "0")}_l${level}`;
}

function countReachablePlayableCells(asset: HexMapAsset): number {
  const playableCells = asset.cells.filter((cell) => cell.playable);
  const cellsById = new Map(playableCells.map((cell) => [cell.cellId, cell]));
  const cellsByCoordinate = new Map(playableCells.map((cell) => [`${cell.col}:${cell.row}:${cell.level}`, cell]));
  const visited = new Set<string>();
  const queue = [playableCells[0]?.cellId].filter((cellId): cellId is string => Boolean(cellId));

  while (queue.length > 0) {
    const cellId = queue.shift()!;
    if (visited.has(cellId)) {
      continue;
    }
    visited.add(cellId);
    const cell = cellsById.get(cellId);
    if (!cell) {
      continue;
    }
    for (const [col, row] of getNeighborCoordinates(cell.col, cell.row)) {
      const neighbor = cellsByCoordinate.get(`${col}:${row}:${cell.level}`);
      if (neighbor && !visited.has(neighbor.cellId)) {
        queue.push(neighbor.cellId);
      }
    }
    for (const link of asset.verticalLinks) {
      if (link.fromCellId === cellId && cellsById.has(link.toCellId) && !visited.has(link.toCellId)) {
        queue.push(link.toCellId);
      }
      if (!link.oneWay && link.toCellId === cellId && cellsById.has(link.fromCellId) && !visited.has(link.fromCellId)) {
        queue.push(link.fromCellId);
      }
    }
  }

  return visited.size;
}

function getNeighborCoordinates(col: number, row: number): Array<[number, number]> {
  return col % 2 === 1
    ? [
        [col + 1, row],
        [col + 1, row + 1],
        [col, row - 1],
        [col, row + 1],
        [col - 1, row],
        [col - 1, row + 1]
      ]
    : [
        [col + 1, row - 1],
        [col + 1, row],
        [col, row - 1],
        [col, row + 1],
        [col - 1, row - 1],
        [col - 1, row]
      ];
}
