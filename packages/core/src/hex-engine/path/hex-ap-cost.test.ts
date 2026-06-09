import { describe, expect, it } from "vitest";

import type { HexMapAsset } from "../../../../shared/src/hex-schemas.js";
import { calculateHexApCost } from "./hex-ap-cost.js";

describe("Hex AP cost", () => {
  it("calculates fractional AP from cell distance and vertical link modifiers", () => {
    const asset = createApTestAsset();

    const result = calculateHexApCost({
      asset,
      pathCellIds: ["h_00_00_l0", "h_01_00_l0", "h_01_00_l1"],
      verticalLinkIds: ["stairs_1"]
    });

    expect(result).toEqual({
      cellDistance: 2,
      verticalLinkCost: 0.25,
      apCost: 0.45,
      cellsPerAp: 10
    });
  });
});

function createApTestAsset(): HexMapAsset {
  return {
    schemaVersion: 1,
    mapSlug: "dust2",
    displayName: "AP Test",
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
    cells: [],
    regions: [],
    points: [],
    routeHints: [],
    verticalLinks: [
      {
        linkId: "stairs_1",
        fromCellId: "h_01_00_l0",
        toCellId: "h_01_00_l1",
        linkType: "stairs",
        apCostModifier: 0.25,
        oneWay: false
      }
    ],
    notes: []
  };
}
