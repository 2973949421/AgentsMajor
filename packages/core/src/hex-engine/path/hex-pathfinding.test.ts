import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { HexCell, HexMapAsset } from "../../../../shared/src/hex-schemas.js";
import { calculateHexPathCost, findHexPath, validateHexMoveBudget } from "./hex-pathfinding.js";

describe("Hex pathfinding", () => {
  it("finds a real Dust2 same-level route and calculates AP", () => {
    const asset = loadOfficialDust2HexMap();
    const fromCell = findCellWithFlag(asset, "spawn_t");
    const toCell = findCellWithFlag(asset, "bombsite_a");

    const path = findHexPath({
      asset,
      fromCellId: fromCell.cellId,
      toCellId: toCell.cellId
    });
    const cost = calculateHexPathCost(asset, path);

    expect(path.reachable).toBe(true);
    expect(path.cellIds[0]).toBe(fromCell.cellId);
    expect(path.cellIds.at(-1)).toBe(toCell.cellId);
    expect(cost.apCost).toBeGreaterThan(0);
    expect(cost.cellsPerAp).toBe(10);
  });

  it("rejects unknown and unplayable cells with explicit reasons", () => {
    const asset = loadOfficialDust2HexMap();
    const fromCell = findCellWithFlag(asset, "spawn_t");
    const unplayableCell = createUnplayableTestCell();
    const assetWithUnplayable = {
      ...asset,
      cells: [...asset.cells, unplayableCell]
    };

    expect(findHexPath({ asset, fromCellId: "missing", toCellId: fromCell.cellId }).failureReason).toBe("unknown_start_cell");
    expect(findHexPath({ asset, fromCellId: fromCell.cellId, toCellId: "missing" }).failureReason).toBe("unknown_target_cell");
    expect(findHexPath({ asset: assetWithUnplayable, fromCellId: unplayableCell.cellId, toCellId: fromCell.cellId }).failureReason).toBe(
      "unplayable_start_cell"
    );
    expect(findHexPath({ asset: assetWithUnplayable, fromCellId: fromCell.cellId, toCellId: unplayableCell.cellId }).failureReason).toBe(
      "unplayable_target_cell"
    );
  });

  it("does not cross levels without explicit vertical links", () => {
    const asset = createVerticalLinkTestAsset(false);

    const path = findHexPath({
      asset,
      fromCellId: "h_10_10_l0",
      toCellId: "h_10_10_l1"
    });

    expect(path.reachable).toBe(false);
    expect(path.failureReason).toBe("no_path");
  });

  it("uses bidirectional vertical links when allowed", () => {
    const asset = createVerticalLinkTestAsset(false, true);

    const forwardPath = findHexPath({
      asset,
      fromCellId: "h_10_10_l0",
      toCellId: "h_10_10_l1"
    });
    const backwardPath = findHexPath({
      asset,
      fromCellId: "h_10_10_l1",
      toCellId: "h_10_10_l0"
    });

    expect(forwardPath.reachable).toBe(true);
    expect(forwardPath.verticalLinkIds).toEqual(["stairs_test"]);
    expect(backwardPath.reachable).toBe(true);
    expect(backwardPath.verticalLinkIds).toEqual(["stairs_test"]);
  });

  it("honors one-way vertical links", () => {
    const asset = createVerticalLinkTestAsset(true, true);

    const forwardPath = findHexPath({
      asset,
      fromCellId: "h_10_10_l0",
      toCellId: "h_10_10_l1"
    });
    const backwardPath = findHexPath({
      asset,
      fromCellId: "h_10_10_l1",
      toCellId: "h_10_10_l0"
    });

    expect(forwardPath.reachable).toBe(true);
    expect(backwardPath.reachable).toBe(false);
    expect(backwardPath.failureReason).toBe("no_path");
  });

  it("validates AP budgets", () => {
    const asset = loadOfficialDust2HexMap();
    const fromCell = findCellWithFlag(asset, "spawn_t");
    const toCell = findCellWithFlag(asset, "bombsite_b");

    const normalBudget = validateHexMoveBudget({
      asset,
      fromCellId: fromCell.cellId,
      toCellId: toCell.cellId
    });
    const tinyBudget = validateHexMoveBudget({
      asset,
      fromCellId: fromCell.cellId,
      toCellId: toCell.cellId,
      apBudget: 0.01
    });

    expect(normalBudget.reachable).toBe(true);
    expect(normalBudget.apBudget).toBe(3);
    expect(normalBudget.apCost).toBeGreaterThan(0);
    expect(tinyBudget.reachable).toBe(true);
    expect(tinyBudget.withinBudget).toBe(false);
    expect(tinyBudget.failureReason).toBe("over_budget");
  });
});

function loadOfficialDust2HexMap(): HexMapAsset {
  const raw = readFileSync(join(process.cwd(), "data/materials/processed/maps/dust2/hex/dust2-hex-map.json"), "utf8");
  return JSON.parse(raw) as HexMapAsset;
}

function findCellWithFlag(asset: HexMapAsset, flag: HexCell["flags"][number]): HexCell {
  const cell = asset.cells.find((candidate) => candidate.playable && candidate.flags.includes(flag));
  if (!cell) {
    throw new Error(`Missing playable cell with flag ${flag}`);
  }
  return cell;
}

function createUnplayableTestCell(): HexCell {
  return {
    cellId: "h_49_49_l0",
    col: 49,
    row: 49,
    level: 0,
    playable: false,
    terrain: "obstacle",
    flags: [],
    pointIds: []
  };
}

function createVerticalLinkTestAsset(oneWay: boolean, includeLink = false): HexMapAsset {
  return {
    schemaVersion: 1,
    mapSlug: "dust2",
    displayName: "Vertical Link Test",
    grid: {
      width: 50,
      height: 50,
      coordinateSystem: "col_row",
      origin: "top_left"
    },
    apModel: {
      baseApPerPhase: 3,
      minAp: 0,
      cellsPerAp: 10,
      allowFractionalAp: true,
      resetsEachPhase: true
    },
    levels: [-1, 0, 1],
    defaultLevel: 0,
    cells: [
      {
        cellId: "h_10_10_l0",
        col: 10,
        row: 10,
        level: 0,
        playable: true,
        terrain: "floor",
        flags: ["playable"],
        pointIds: []
      },
      {
        cellId: "h_10_10_l1",
        col: 10,
        row: 10,
        level: 1,
        playable: true,
        terrain: "floor",
        flags: ["playable"],
        pointIds: []
      }
    ],
    regions: [],
    points: [],
    routeHints: [],
    verticalLinks: includeLink
      ? [
          {
            linkId: "stairs_test",
            fromCellId: "h_10_10_l0",
            toCellId: "h_10_10_l1",
            linkType: "stairs",
            apCostModifier: 0.2,
            oneWay
          }
        ]
      : [],
    notes: []
  };
}
