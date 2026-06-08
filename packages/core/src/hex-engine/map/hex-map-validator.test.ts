import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { hexMapAssetSchema, type HexMapAsset } from "../../../../shared/src/hex-schemas.js";
import { validateHexMapAsset } from "./hex-map-validator.js";

describe("HexMapValidator", () => {
  it("accepts the Dust2 draft hex map asset", () => {
    const asset = loadDraftDust2HexMap();
    const result = validateHexMapAsset(asset);

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
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

  it("warns when playable cells are not assigned to a region", () => {
    const asset = loadDraftDust2HexMap();
    asset.cells.push({
      cellId: "h_10_10",
      col: 10,
      row: 10,
      playable: true,
      terrain: "floor",
      flags: ["playable"],
      pointIds: []
    });

    const result = validateHexMapAsset(asset);

    expect(result.ok).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toContain("playable_cell_without_region");
  });
});

function loadDraftDust2HexMap(): HexMapAsset {
  const raw = readFileSync(join(process.cwd(), "data/materials/processed/maps/dust2/hex/dust2-hex-map.draft.json"), "utf8");
  return hexMapAssetSchema.parse(JSON.parse(raw));
}
