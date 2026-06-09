import type { HexCell, HexMapAsset } from "@agent-major/shared";
import { calculateHexApCost, type HexApCostResult } from "./hex-ap-cost.js";

export type HexPathFailureReason =
  | "unknown_start_cell"
  | "unknown_target_cell"
  | "unplayable_start_cell"
  | "unplayable_target_cell"
  | "no_path";

export interface HexPathInput {
  asset: HexMapAsset;
  fromCellId: string;
  toCellId: string;
  allowVerticalLinks?: boolean;
}

export interface HexPathResult {
  reachable: boolean;
  cellIds: string[];
  verticalLinkIds: string[];
  cellDistance: number;
  failureReason?: HexPathFailureReason;
}

export interface HexMoveBudgetInput {
  asset: HexMapAsset;
  fromCellId: string;
  toCellId: string;
  apBudget?: number;
}

export interface HexMoveBudgetResult {
  reachable: boolean;
  withinBudget: boolean;
  apBudget: number;
  apCost?: number;
  path?: HexPathResult;
  failureReason?: HexPathFailureReason | "over_budget";
}

interface HexGraphEdge {
  toCellId: string;
  verticalLinkId?: string;
}

export function findHexPath(input: HexPathInput): HexPathResult {
  const playableCells = input.asset.cells.filter((cell) => cell.playable);
  const cellsById = new Map(input.asset.cells.map((cell) => [cell.cellId, cell]));
  const startCell = cellsById.get(input.fromCellId);
  const targetCell = cellsById.get(input.toCellId);

  if (!startCell) {
    return unreachable("unknown_start_cell");
  }
  if (!targetCell) {
    return unreachable("unknown_target_cell");
  }
  if (!startCell.playable) {
    return unreachable("unplayable_start_cell");
  }
  if (!targetCell.playable) {
    return unreachable("unplayable_target_cell");
  }
  if (input.fromCellId === input.toCellId) {
    return {
      reachable: true,
      cellIds: [input.fromCellId],
      verticalLinkIds: [],
      cellDistance: 0
    };
  }

  const graph = buildHexPathGraph(input.asset, playableCells, input.allowVerticalLinks ?? true);
  const queue = [input.fromCellId];
  const visited = new Set<string>([input.fromCellId]);
  const previous = new Map<string, { fromCellId: string; verticalLinkId?: string }>();

  while (queue.length > 0) {
    const currentCellId = queue.shift()!;
    for (const edge of graph.get(currentCellId) ?? []) {
      if (visited.has(edge.toCellId)) {
        continue;
      }
      visited.add(edge.toCellId);
      previous.set(edge.toCellId, edge.verticalLinkId ? { fromCellId: currentCellId, verticalLinkId: edge.verticalLinkId } : { fromCellId: currentCellId });
      if (edge.toCellId === input.toCellId) {
        return materializePath(input.fromCellId, input.toCellId, previous);
      }
      queue.push(edge.toCellId);
    }
  }

  return unreachable("no_path");
}

export function validateHexMoveBudget(input: HexMoveBudgetInput): HexMoveBudgetResult {
  const apBudget = input.apBudget ?? input.asset.apModel.baseApPerPhase;
  const path = findHexPath(input);
  if (!path.reachable) {
    return {
      reachable: false,
      withinBudget: false,
      apBudget,
      path,
      ...(path.failureReason ? { failureReason: path.failureReason } : {})
    };
  }

  const apCost = calculateHexApCost({
    asset: input.asset,
    pathCellIds: path.cellIds,
    verticalLinkIds: path.verticalLinkIds
  }).apCost;
  const withinBudget = apCost <= apBudget;

  const result: HexMoveBudgetResult = {
    reachable: true,
    withinBudget,
    apBudget,
    apCost,
    path
  };
  if (!withinBudget) {
    result.failureReason = "over_budget";
  }
  return result;
}

export function buildHexPathGraph(asset: HexMapAsset, playableCells = asset.cells.filter((cell) => cell.playable), allowVerticalLinks = true): Map<string, HexGraphEdge[]> {
  const playableCellIds = new Set(playableCells.map((cell) => cell.cellId));
  const cellsByCoordinate = new Map(playableCells.map((cell) => [coordinateKey(cell.col, cell.row, cell.level), cell]));
  const graph = new Map<string, HexGraphEdge[]>();

  for (const cell of playableCells) {
    const edges: HexGraphEdge[] = [];
    for (const [nextCol, nextRow] of getSameLevelNeighborCoordinates(cell)) {
      const neighbor = cellsByCoordinate.get(coordinateKey(nextCol, nextRow, cell.level));
      if (neighbor) {
        edges.push({ toCellId: neighbor.cellId });
      }
    }
    graph.set(cell.cellId, edges);
  }

  if (allowVerticalLinks) {
    for (const link of asset.verticalLinks) {
      if (playableCellIds.has(link.fromCellId) && playableCellIds.has(link.toCellId)) {
        graph.get(link.fromCellId)?.push({ toCellId: link.toCellId, verticalLinkId: link.linkId });
        if (!link.oneWay) {
          graph.get(link.toCellId)?.push({ toCellId: link.fromCellId, verticalLinkId: link.linkId });
        }
      }
    }
  }

  return graph;
}

export function calculateHexPathCost(asset: HexMapAsset, path: HexPathResult): HexApCostResult {
  return calculateHexApCost({
    asset,
    pathCellIds: path.cellIds,
    verticalLinkIds: path.verticalLinkIds
  });
}

function materializePath(fromCellId: string, toCellId: string, previous: Map<string, { fromCellId: string; verticalLinkId?: string }>): HexPathResult {
  const cellIds = [toCellId];
  const verticalLinkIds: string[] = [];
  let currentCellId = toCellId;

  while (currentCellId !== fromCellId) {
    const step = previous.get(currentCellId);
    if (!step) {
      return unreachable("no_path");
    }
    if (step.verticalLinkId) {
      verticalLinkIds.push(step.verticalLinkId);
    }
    cellIds.push(step.fromCellId);
    currentCellId = step.fromCellId;
  }

  cellIds.reverse();
  verticalLinkIds.reverse();
  return {
    reachable: true,
    cellIds,
    verticalLinkIds,
    cellDistance: Math.max(0, cellIds.length - 1)
  };
}

function getSameLevelNeighborCoordinates(cell: Pick<HexCell, "col" | "row">): Array<[number, number]> {
  const oddColumn = cell.col % 2 === 1;
  const offsets: Array<[number, number]> = oddColumn
    ? [
        [1, 0],
        [1, 1],
        [0, -1],
        [0, 1],
        [-1, 0],
        [-1, 1]
      ]
    : [
        [1, -1],
        [1, 0],
        [0, -1],
        [0, 1],
        [-1, -1],
        [-1, 0]
      ];

  return offsets.map(([colOffset, rowOffset]) => [cell.col + colOffset, cell.row + rowOffset]);
}

function coordinateKey(col: number, row: number, level: number): string {
  return `${col}:${row}:${level}`;
}

function unreachable(failureReason: HexPathFailureReason): HexPathResult {
  return {
    reachable: false,
    cellIds: [],
    verticalLinkIds: [],
    cellDistance: 0,
    failureReason
  };
}
