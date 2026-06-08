import { describe, expect, it } from "vitest";

import { hexMapAssetSchema } from "./hex-schemas.js";

const minimalHexMapAsset = {
  schemaVersion: 1,
  mapSlug: "dust2",
  displayName: "Dust2 Hex Draft",
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
  cells: [
    {
      cellId: "h_25_45",
      col: 25,
      row: 45,
      playable: true,
      terrain: "floor",
      flags: ["playable", "spawn_t"],
      regionId: "t_spawn",
      pointIds: ["t_spawn_point"]
    }
  ],
  regions: [
    {
      regionId: "t_spawn",
      nameCn: "T 出生点",
      nameEn: "T Spawn",
      regionType: "spawn",
      cellIds: ["h_25_45"]
    }
  ],
  points: [
    {
      pointId: "t_spawn_point",
      nameCn: "T 出生点",
      nameEn: "T Spawn",
      pointType: "spawn",
      parentRegionId: "t_spawn",
      cellIds: ["h_25_45"]
    }
  ],
  routeHints: []
};

describe("HexGrid shared schemas", () => {
  it("parses a minimal 50x50 hex map asset", () => {
    const parsed = hexMapAssetSchema.parse(minimalHexMapAsset);

    expect(parsed.mapSlug).toBe("dust2");
    expect(parsed.grid.width).toBe(50);
    expect(parsed.apModel.cellsPerAp).toBe(10);
  });

  it("rejects coordinates outside the 50x50 map bounds", () => {
    expect(() =>
      hexMapAssetSchema.parse({
        ...minimalHexMapAsset,
        cells: [{ ...minimalHexMapAsset.cells[0], col: 50 }]
      })
    ).toThrow();

    expect(() =>
      hexMapAssetSchema.parse({
        ...minimalHexMapAsset,
        cells: [{ ...minimalHexMapAsset.cells[0], row: -1 }]
      })
    ).toThrow();
  });

  it("requires the fixed first-version AP model", () => {
    expect(() =>
      hexMapAssetSchema.parse({
        ...minimalHexMapAsset,
        apModel: { ...minimalHexMapAsset.apModel, cellsPerAp: 20 }
      })
    ).toThrow();
  });

  it("requires map identity and grid metadata", () => {
    const { mapSlug: _mapSlug, ...withoutMapSlug } = minimalHexMapAsset;
    expect(() => hexMapAssetSchema.parse(withoutMapSlug)).toThrow();

    const { grid: _grid, ...withoutGrid } = minimalHexMapAsset;
    expect(() => hexMapAssetSchema.parse(withoutGrid)).toThrow();
  });

  it("parses region and point structure for editor use", () => {
    const parsed = hexMapAssetSchema.parse(minimalHexMapAsset);

    expect(parsed.regions[0]?.regionId).toBe("t_spawn");
    expect(parsed.points[0]?.parentRegionId).toBe("t_spawn");
  });
});

