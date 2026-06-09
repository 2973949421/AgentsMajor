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
  levels: [-1, 0, 1],
  defaultLevel: 0,
  cells: [
    {
      cellId: "h_25_45_l0",
      col: 25,
      row: 45,
      level: 0,
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
      nameCn: "T Spawn",
      nameEn: "T Spawn",
      regionType: "spawn",
      cellIds: ["h_25_45_l0"]
    }
  ],
  points: [
    {
      pointId: "t_spawn_point",
      nameCn: "T Spawn",
      nameEn: "T Spawn",
      pointType: "spawn",
      parentRegionId: "t_spawn",
      cellIds: ["h_25_45_l0"]
    }
  ],
  routeHints: [],
  verticalLinks: []
};

describe("HexGrid shared schemas", () => {
  it("parses a minimal layered 50x50 hex map asset", () => {
    const parsed = hexMapAssetSchema.parse(minimalHexMapAsset);

    expect(parsed.mapSlug).toBe("dust2");
    expect(parsed.grid.width).toBe(50);
    expect(parsed.apModel.cellsPerAp).toBe(10);
    expect(parsed.levels).toEqual([-1, 0, 1]);
    expect(parsed.defaultLevel).toBe(0);
    expect(parsed.cells[0]?.cellId).toBe("h_25_45_l0");
    expect(parsed.cells[0]?.level).toBe(0);
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

  it("rejects unsupported levels", () => {
    expect(() =>
      hexMapAssetSchema.parse({
        ...minimalHexMapAsset,
        cells: [{ ...minimalHexMapAsset.cells[0], cellId: "h_25_45_l2", level: 2 }]
      })
    ).toThrow();
  });

  it("allows multiple levels at the same col/row", () => {
    const parsed = hexMapAssetSchema.parse({
      ...minimalHexMapAsset,
      cells: [
        minimalHexMapAsset.cells[0],
        {
          ...minimalHexMapAsset.cells[0],
          cellId: "h_25_45_l1",
          level: 1
        }
      ],
      regions: [{ ...minimalHexMapAsset.regions[0], cellIds: ["h_25_45_l0", "h_25_45_l1"] }],
      points: [{ ...minimalHexMapAsset.points[0], cellIds: ["h_25_45_l0", "h_25_45_l1"] }]
    });

    expect(parsed.cells.map((cell) => cell.cellId)).toEqual(["h_25_45_l0", "h_25_45_l1"]);
  });

  it("requires the fixed first-version AP model", () => {
    expect(() =>
      hexMapAssetSchema.parse({
        ...minimalHexMapAsset,
        apModel: { ...minimalHexMapAsset.apModel, cellsPerAp: 20 }
      })
    ).toThrow();
  });

  it("parses vertical links", () => {
    const parsed = hexMapAssetSchema.parse({
      ...minimalHexMapAsset,
      cells: [
        minimalHexMapAsset.cells[0],
        {
          ...minimalHexMapAsset.cells[0],
          cellId: "h_25_45_l1",
          level: 1
        }
      ],
      regions: [{ ...minimalHexMapAsset.regions[0], cellIds: ["h_25_45_l0", "h_25_45_l1"] }],
      points: [{ ...minimalHexMapAsset.points[0], cellIds: ["h_25_45_l0", "h_25_45_l1"] }],
      verticalLinks: [
        {
          linkId: "stairs_t_spawn_l0_l1",
          fromCellId: "h_25_45_l0",
          toCellId: "h_25_45_l1",
          linkType: "stairs",
          apCostModifier: 0.2,
          oneWay: false,
          notes: "test link"
        }
      ]
    });

    expect(parsed.verticalLinks[0]?.linkType).toBe("stairs");
  });
});
