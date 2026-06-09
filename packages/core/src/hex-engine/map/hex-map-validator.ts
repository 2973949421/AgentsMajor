import type { HexCell, HexMapAsset, HexRouteHint, HexVerticalLink } from "@agent-major/shared";
import { getPointFlags, getRegionFlags, hasAnyFlag } from "./hex-map-semantics.js";

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
  const cellCoordinates = new Set<string>();
  const regionIds = new Set<string>();
  const pointIds = new Set<string>();
  const cellsById = new Map(asset.cells.map((cell) => [cell.cellId, cell]));

  if (!asset.levels.includes(asset.defaultLevel)) {
    errors.push(issue("default_level_not_declared", `Default level ${asset.defaultLevel} is not declared in asset levels`, "defaultLevel"));
  }

  for (const cell of asset.cells) {
    if (cellIds.has(cell.cellId)) {
      errors.push(issue("duplicate_cell_id", `Duplicate cell id: ${cell.cellId}`, cell.cellId));
    }
    cellIds.add(cell.cellId);

    if (!asset.levels.includes(cell.level)) {
      errors.push(issue("cell_unknown_level", `Cell ${cell.cellId} uses undeclared level ${cell.level}`, cell.cellId));
    }

    const coordinateKey = `${cell.col}:${cell.row}:${cell.level}`;
    if (cellCoordinates.has(coordinateKey)) {
      errors.push(issue("duplicate_cell_coordinate", `Duplicate cell coordinate: ${coordinateKey}`, cell.cellId));
    }
    cellCoordinates.add(coordinateKey);

    if (cell.cellId !== expectedCellId(cell)) {
      errors.push(
        issue(
          "cell_id_coordinate_mismatch",
          `Cell id ${cell.cellId} must match col=${cell.col}, row=${cell.row}, level=${cell.level}`,
          cell.cellId
        )
      );
    }

    if (cell.col < 0 || cell.col >= asset.grid.width || cell.row < 0 || cell.row >= asset.grid.height) {
      errors.push(issue("cell_out_of_bounds", `Cell ${cell.cellId} is outside ${asset.grid.width}x${asset.grid.height}`, cell.cellId));
    }
  }

  for (const region of asset.regions) {
    if (regionIds.has(region.regionId)) {
      errors.push(issue("duplicate_region_id", `Duplicate region id: ${region.regionId}`, region.regionId));
    }
    regionIds.add(region.regionId);

    if (region.cellIds.length === 0) {
      warnings.push(issue("empty_region", `Region ${region.regionId} has no cells yet`, region.regionId));
    }

    for (const cellId of region.cellIds) {
      const cell = cellsById.get(cellId);
      if (!cell) {
        errors.push(issue("region_unknown_cell", `Region ${region.regionId} references unknown cell ${cellId}`, region.regionId));
      } else if (cell.regionId && cell.regionId !== region.regionId) {
        warnings.push(
          issue(
            "region_cell_membership_mismatch",
            `Region ${region.regionId} lists ${cellId}, but the cell primary region is ${cell.regionId}`,
            region.regionId
          )
        );
      } else if (!cell.regionId) {
        warnings.push(
          issue(
            "region_cell_missing_primary_region",
            `Region ${region.regionId} lists ${cellId}, but the cell has no primary regionId`,
            region.regionId
          )
        );
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

    if (point.cellIds.length === 0) {
      warnings.push(issue("empty_point", `Point ${point.pointId} has no cells yet`, point.pointId));
    }

    for (const cellId of point.cellIds) {
      const cell = cellsById.get(cellId);
      if (!cell) {
        errors.push(issue("point_unknown_cell", `Point ${point.pointId} references unknown cell ${cellId}`, point.pointId));
      } else if (!cell.pointIds.includes(point.pointId)) {
        warnings.push(
          issue(
            "point_cell_membership_mismatch",
            `Point ${point.pointId} lists ${cellId}, but the cell pointIds do not include this point`,
            point.pointId
          )
        );
      }
    }
  }

  const regionsById = new Map(asset.regions.map((region) => [region.regionId, region]));
  const pointsById = new Map(asset.points.map((point) => [point.pointId, point]));
  for (const cell of asset.cells) {
    if (cell.regionId) {
      const region = regionsById.get(cell.regionId);
      if (!region) {
        errors.push(issue("cell_unknown_region", `Cell ${cell.cellId} references unknown region ${cell.regionId}`, cell.cellId));
      } else if (!region.cellIds.includes(cell.cellId)) {
        warnings.push(
          issue(
            "cell_region_membership_mismatch",
            `Cell ${cell.cellId} primary region is ${cell.regionId}, but the region cellIds do not include this cell`,
            cell.cellId
          )
        );
      }
    }

    for (const pointId of cell.pointIds) {
      const point = pointsById.get(pointId);
      if (!point) {
        errors.push(issue("cell_unknown_point", `Cell ${cell.cellId} references unknown point ${pointId}`, cell.cellId));
      } else if (!point.cellIds.includes(cell.cellId)) {
        warnings.push(
          issue(
            "cell_point_membership_mismatch",
            `Cell ${cell.cellId} references point ${pointId}, but the point cellIds do not include this cell`,
            cell.cellId
          )
        );
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
  validateVerticalLinks(asset.verticalLinks, cellIds, asset.cells, errors);
  validateRequiredMapFlags(asset, errors);
  validateSemanticFlagContracts(asset, errors, warnings);

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

function validateSemanticFlagContracts(
  asset: HexMapAsset,
  errors: HexMapValidationIssue[],
  warnings: HexMapValidationIssue[]
): void {
  for (const region of asset.regions) {
    const flags = getRegionFlags(asset, region);
    if (region.regionType === "spawn" && !hasAnyFlag(flags, ["spawn_t", "spawn_ct"])) {
      errors.push(
        issue(
          "region_semantic_missing_spawn_flag",
          `Region ${region.regionId} is typed as spawn, but none of its cells carry spawn_t or spawn_ct`,
          region.regionId
        )
      );
    }
    if (region.regionType === "a_site" && !flags.has("bombsite_a")) {
      errors.push(
        issue(
          "region_semantic_missing_bombsite_a_flag",
          `Region ${region.regionId} is typed as a_site, but none of its cells carry bombsite_a`,
          region.regionId
        )
      );
    }
    if (region.regionType === "b_site" && !flags.has("bombsite_b")) {
      errors.push(
        issue(
          "region_semantic_missing_bombsite_b_flag",
          `Region ${region.regionId} is typed as b_site, but none of its cells carry bombsite_b`,
          region.regionId
        )
      );
    }
  }

  for (const point of asset.points) {
    const flags = getPointFlags(asset, point);
    if (point.pointType === "spawn" && !hasAnyFlag(flags, ["spawn_t", "spawn_ct"])) {
      errors.push(
        issue(
          "point_semantic_missing_spawn_flag",
          `Point ${point.pointId} is typed as spawn, but none of its cells carry spawn_t or spawn_ct`,
          point.pointId
        )
      );
    }
    if (point.pointType === "bombsite" && !hasAnyFlag(flags, ["bombsite_a", "bombsite_b"])) {
      errors.push(
        issue(
          "point_semantic_missing_bombsite_flag",
          `Point ${point.pointId} is typed as bombsite, but none of its cells carry bombsite_a or bombsite_b`,
          point.pointId
        )
      );
    }
    if (point.pointType === "cover" && !flags.has("cover")) {
      warnings.push(
        issue(
          "point_semantic_missing_cover_flag",
          `Point ${point.pointId} is typed as cover, but none of its cells carry cover`,
          point.pointId
        )
      );
    }
    if (point.pointType === "choke" && !flags.has("choke")) {
      warnings.push(
        issue(
          "point_semantic_missing_choke_flag",
          `Point ${point.pointId} is typed as choke, but none of its cells carry choke`,
          point.pointId
        )
      );
    }
    if (point.pointType === "route" && !flags.has("route_hint")) {
      warnings.push(
        issue(
          "point_semantic_missing_route_hint_flag",
          `Point ${point.pointId} is typed as route, but none of its cells carry route_hint`,
          point.pointId
        )
      );
    }
  }
}

function validateVerticalLinks(
  verticalLinks: HexVerticalLink[],
  cellIds: Set<string>,
  cells: HexCell[],
  errors: HexMapValidationIssue[]
): void {
  const linkIds = new Set<string>();
  const cellsById = new Map(cells.map((cell) => [cell.cellId, cell]));

  for (const link of verticalLinks) {
    if (linkIds.has(link.linkId)) {
      errors.push(issue("duplicate_vertical_link_id", `Duplicate vertical link id: ${link.linkId}`, link.linkId));
    }
    linkIds.add(link.linkId);

    if (!cellIds.has(link.fromCellId)) {
      errors.push(issue("vertical_link_unknown_cell", `Vertical link ${link.linkId} references unknown fromCell ${link.fromCellId}`, link.linkId));
    }
    if (!cellIds.has(link.toCellId)) {
      errors.push(issue("vertical_link_unknown_cell", `Vertical link ${link.linkId} references unknown toCell ${link.toCellId}`, link.linkId));
    }

    const fromCell = cellsById.get(link.fromCellId);
    const toCell = cellsById.get(link.toCellId);
    if (fromCell && toCell && fromCell.level === toCell.level) {
      errors.push(issue("vertical_link_same_level", `Vertical link ${link.linkId} must connect different levels`, link.linkId));
    }

    // Directionality is an explicit map-design choice. Stairs, ramps, ladders, drops, and jumps
    // can all be modeled as one-way or bidirectional depending on the actual geometry.
  }
}

function expectedCellId(cell: HexCell): string {
  return `h_${String(cell.col).padStart(2, "0")}_${String(cell.row).padStart(2, "0")}_l${cell.level}`;
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
