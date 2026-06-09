import type { HexMapAsset } from "@agent-major/shared";

export interface HexApCostInput {
  asset: HexMapAsset;
  pathCellIds: string[];
  verticalLinkIds: string[];
}

export interface HexApCostResult {
  cellDistance: number;
  verticalLinkCost: number;
  apCost: number;
  cellsPerAp: number;
}

export function calculateHexApCost(input: HexApCostInput): HexApCostResult {
  const cellDistance = Math.max(0, input.pathCellIds.length - 1);
  const verticalLinksById = new Map(input.asset.verticalLinks.map((link) => [link.linkId, link]));
  const verticalLinkCost = input.verticalLinkIds.reduce((sum, linkId) => sum + (verticalLinksById.get(linkId)?.apCostModifier ?? 0), 0);
  const cellsPerAp = input.asset.apModel.cellsPerAp;
  const movementAp = cellDistance / cellsPerAp;

  return {
    cellDistance,
    verticalLinkCost,
    apCost: Number((movementAp + verticalLinkCost).toFixed(4)),
    cellsPerAp
  };
}
