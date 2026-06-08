import type { HexMapAsset, HexRouteHint } from "@agent-major/shared";

export interface HexMapValidationIssue {
  code: string;
  message: string;
  ref?: string;
}

export interface HexMapValidationResult {
  ok: boolean;
  errors: HexMapValidationIssue[];
  warnings: HexMapValidationIssue[];
}

export function validateHexMapAsset(asset: HexMapAsset): HexMapValidationResult {
  const errors: HexMapValidationIssue[] = [];
  const warnings: HexMapValidationIssue[] = [];

  const cellIds = new Set<string>();
  const regionIds = new Set<string>();
  const pointIds = new Set<string>();

  for (const cell of asset.cells) {
    if (cellIds.has(cell.cellId)) {
      errors.push(issue("duplicate_cell_id", `Duplicate cell id: ${cell.cellId}`, cell.cellId));
    }
    cellIds.add(cell.cellId);

    if (cell.col < 0 || cell.col >= asset.grid.width || cell.row < 0 || cell.row >= asset.grid.height) {
      errors.push(issue("cell_out_of_bounds", `Cell ${cell.cellId} is outside ${asset.grid.width}x${asset.grid.height}`, cell.cellId));
    }
  }

  for (const region of asset.regions) {
    if (regionIds.has(region.regionId)) {
      errors.push(issue("duplicate_region_id", `Duplicate region id: ${region.regionId}`, region.regionId));
    }
    regionIds.add(region.regionId);

    for (const cellId of region.cellIds) {
      if (!cellIds.has(cellId)) {
        errors.push(issue("region_unknown_cell", `Region ${region.regionId} references unknown cell ${cellId}`, region.regionId));
      }
    }
  }

  for (const point of asset.points) {
    if (pointIds.has(point.pointId)) {
      errors.push(issue("duplicate_point_id", `Duplicate point id: ${point.pointId}`, point.pointId));
    }
    pointIds.add(point.pointId);

    if (!regionIds.has(point.parentRegionId)) {
      errors.push(issue("point_unknown_region", `Point ${point.pointId} references unknown region ${point.parentRegionId}`, point.pointId));
    }

    for (const cellId of point.cellIds) {
      if (!cellIds.has(cellId)) {
        errors.push(issue("point_unknown_cell", `Point ${point.pointId} references unknown cell ${cellId}`, point.pointId));
      }
    }
  }

  const coveredByRegion = new Set(asset.regions.flatMap((region) => region.cellIds));
  for (const cell of asset.cells) {
    if (cell.playable && !coveredByRegion.has(cell.cellId) && !cell.flags.includes("draft_unassigned_region")) {
      warnings.push(
        issue(
          "playable_cell_without_region",
          `Playable cell ${cell.cellId} is not assigned to a region and is not marked draft_unassigned_region`,
          cell.cellId
        )
      );
    }
  }

  validateRouteHints(asset.routeHints, pointIds, cellIds, errors);
  validateRequiredMapFlags(asset, errors);

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

function validateRouteHints(
  routeHints: HexRouteHint[],
  pointIds: Set<string>,
  cellIds: Set<string>,
  errors: HexMapValidationIssue[]
): void {
  const routeIds = new Set<string>();

  for (const route of routeHints) {
    if (routeIds.has(route.routeId)) {
      errors.push(issue("duplicate_route_hint_id", `Duplicate route hint id: ${route.routeId}`, route.routeId));
    }
    routeIds.add(route.routeId);

    if (!pointIds.has(route.fromPointId)) {
      errors.push(issue("route_unknown_point", `Route ${route.routeId} references unknown fromPoint ${route.fromPointId}`, route.routeId));
    }
    if (!pointIds.has(route.toPointId)) {
      errors.push(issue("route_unknown_point", `Route ${route.routeId} references unknown toPoint ${route.toPointId}`, route.routeId));
    }
    for (const cellId of route.viaCellIds) {
      if (!cellIds.has(cellId)) {
        errors.push(issue("route_unknown_cell", `Route ${route.routeId} references unknown cell ${cellId}`, route.routeId));
      }
    }
  }
}

function validateRequiredMapFlags(asset: HexMapAsset, errors: HexMapValidationIssue[]): void {
  const allFlags = new Set(asset.cells.flatMap((cell) => cell.flags));
  const requiredFlags = ["spawn_t", "spawn_ct", "bombsite_a", "bombsite_b"] as const;

  for (const flag of requiredFlags) {
    if (!allFlags.has(flag)) {
      errors.push(issue(`missing_${flag}`, `Hex map asset is missing required flag: ${flag}`, flag));
    }
  }
}

function issue(code: string, message: string, ref?: string): HexMapValidationIssue {
  return ref === undefined ? { code, message } : { code, message, ref };
}
