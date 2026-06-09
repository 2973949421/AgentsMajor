import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createEmptyDust2HexDraft,
  getHexEditorDraftPath,
  loadHexEditorMap,
  pruneInvalidRouteHints,
  saveHexEditorMap
} from "../app/server-hex-map-editor";

describe("HexMapEditor local draft IO", () => {
  it("returns an empty Dust2 draft when the local file is missing", async () => {
    const projectRoot = tempProjectRoot();
    const payload = await loadHexEditorMap("dust2", projectRoot);

    expect(payload.asset).toMatchObject({
      schemaVersion: 1,
      mapSlug: "dust2",
      grid: { width: 50, height: 50 },
      apModel: { cellsPerAp: 10 }
    });
    expect(payload.validation.ok).toBe(false);
    expect(payload.validation.errors.map((issue) => issue.code)).toContain("missing_spawn_t");
  });

  it("saves valid assets with stable cell ordering", async () => {
    const projectRoot = tempProjectRoot();
    const asset = createValidDraft();

    const payload = await saveHexEditorMap(asset, "dust2", projectRoot);
    const saved = JSON.parse(readFileSync(getHexEditorDraftPath(projectRoot), "utf8")) as typeof asset;

    expect(payload.validation.ok).toBe(true);
    expect(saved.levels).toEqual([-1, 0, 1]);
    expect(saved.defaultLevel).toBe(0);
    expect(saved.cells.map((cell) => cell.cellId)).toEqual(["h_01_01_l0", "h_02_02_l0", "h_03_03_l0", "h_04_04_l0"]);
    expect(saved.regions.map((region) => region.regionId)).toEqual(["a_site", "b_site", "ct_spawn", "t_spawn"]);
  });

  it("saves map variants without overwriting the default draft", async () => {
    const projectRoot = tempProjectRoot();
    const draftAsset = createValidDraft();
    draftAsset.displayName = "Default Draft";
    const refinedAsset = createValidDraft();
    refinedAsset.displayName = "Agent Refined Draft";

    await saveHexEditorMap(draftAsset, "dust2", projectRoot, "draft");
    const refinedPayload = await saveHexEditorMap(refinedAsset, "dust2", projectRoot, "agent_refined");
    const defaultSaved = JSON.parse(readFileSync(getHexEditorDraftPath(projectRoot, "draft"), "utf8")) as typeof draftAsset;
    const refinedSaved = JSON.parse(readFileSync(getHexEditorDraftPath(projectRoot, "agent_refined"), "utf8")) as typeof refinedAsset;

    expect(refinedPayload.variant).toBe("agent_refined");
    expect(defaultSaved.displayName).toBe("Default Draft");
    expect(refinedSaved.displayName).toBe("Agent Refined Draft");
  });

  it("migrates legacy two-dimensional editor drafts to level 0", async () => {
    const projectRoot = tempProjectRoot();
    const asset = createLegacyTwoDimensionalDraft();

    const payload = await saveHexEditorMap(asset, "dust2", projectRoot);
    const saved = JSON.parse(readFileSync(getHexEditorDraftPath(projectRoot), "utf8")) as ReturnType<typeof createValidDraft>;

    expect(payload.validation.ok).toBe(true);
    expect(saved.cells[0]?.cellId).toBe("h_01_01_l0");
    expect(saved.cells[0]?.level).toBe(0);
    expect(saved.regions.find((region) => region.regionId === "t_spawn")?.cellIds).toEqual(["h_01_01_l0"]);
    expect(saved.points.find((point) => point.pointId === "t_spawn_point")?.cellIds).toEqual(["h_01_01_l0"]);
    expect(saved.routeHints[0]?.viaCellIds).toEqual(["h_01_01_l0", "h_02_02_l0", "h_03_03_l0"]);
  });

  it("saves editor drafts with empty regions and points as warnings", async () => {
    const projectRoot = tempProjectRoot();
    const asset = createValidDraft();
    asset.regions.push({
      regionId: "empty_region",
      nameCn: "Empty Region",
      nameEn: "Empty Region",
      regionType: "other",
      cellIds: []
    });
    asset.points.push({
      pointId: "empty_point",
      nameCn: "Empty Point",
      nameEn: "Empty Point",
      pointType: "other",
      parentRegionId: "empty_region",
      cellIds: []
    });

    const payload = await saveHexEditorMap(asset, "dust2", projectRoot);
    const saved = JSON.parse(readFileSync(getHexEditorDraftPath(projectRoot), "utf8")) as typeof asset;

    expect(payload.validation.ok).toBe(true);
    expect(payload.validation.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["empty_region", "empty_point"])
    );
    expect(saved.regions.some((region) => region.regionId === "empty_region")).toBe(true);
    expect(saved.points.some((point) => point.pointId === "empty_point")).toBe(true);
  });

  it("prunes stale route hints when saving editor drafts", async () => {
    const projectRoot = tempProjectRoot();
    const asset = createValidDraft();
    asset.routeHints = [
      {
        routeId: "stale_route",
        fromPointId: "t_spawn_point",
        toPointId: "a_bombsite",
        viaCellIds: ["h_01_01_l0", "missing_cell"],
        commonUse: "execute"
      }
    ];

    const payload = await saveHexEditorMap(asset, "dust2", projectRoot);
    const saved = JSON.parse(readFileSync(getHexEditorDraftPath(projectRoot), "utf8")) as typeof asset;

    expect(payload.validation.ok).toBe(true);
    expect(saved.routeHints).toEqual([]);
    expect(pruneInvalidRouteHints(asset).routeHints).toEqual([]);
  });

  it("rejects assets that fail hard Hex map validation", async () => {
    const projectRoot = tempProjectRoot();
    const asset = createEmptyDust2HexDraft();
    asset.cells = [
      {
        cellId: "h_01_01_l0",
        col: 1,
        row: 1,
        level: 0,
        playable: true,
        terrain: "floor",
        flags: ["playable", "spawn_t"],
        pointIds: []
      }
    ];

    await expect(saveHexEditorMap(asset, "dust2", projectRoot)).rejects.toMatchObject({
      validation: expect.objectContaining({
        ok: false
      })
    });
  });

  it("keeps the UI focused on HexGrid editing instead of frozen Node/Sector runtime", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../app/hex-lab/editor/hex-map-editor-client.tsx"), "utf8");

    expect(source).toContain("HexMapEditor");
    expect(source).toContain("50x50");
    expect(source).toContain("playable");
    expect(source).toContain("Region");
    expect(source).toContain("Point");
    expect(source).toContain("spawn_t");
    expect(source).toContain("bombsite_a");
    expect(source).toContain("level");
    expect(source).toContain("vertical");
    expect(source).toContain("当前操作");
    expect(source).toContain("应用目标");
    expect(source).toContain("选中并填色");
    expect(source).toContain("选中并标注");
    expect(source).toContain("flagDescriptions");
    expect(source).toContain("必备地图标记");
    expect(source).toContain("橡皮擦细分");
    expect(source).toContain("applyFlagToCurrentRegion");
    expect(source).toContain("verticalLinkLine");
    expect(source).toContain("hexCellActiveRegion");
    expect(source).toContain("hexCellActivePoint");
    expect(source).toContain("hexCellActiveFlag");
    expect(source).toContain("审计口径");
    expect(source).toContain("规则功能标签");
    expect(source).toContain("auditActionButton");
    expect(source).toContain("审计此区域");
    expect(source).toContain("审计此点位");
    expect(source).toContain("审计此标记");
    expect(source).toContain("showRadarBackground");
    expect(source).toContain("radarOpacity");
    expect(source).toContain("playable_cell_without_region");
    expect(source).toContain("semanticInfoWarningCodes");
    expect(source).toContain("mapStats");
    expect(source).toContain("路线提示是参考");
    expect(source).toContain("50x50 是最大画布");
    expect(source).toContain("agent_refined");
    expect(source).toContain("地图版本");
    expect(source).toContain("审计概览");
    expect(source).not.toContain("node-graph.json");
    expect(source).not.toContain("sector-map.json");
  });
});

function tempProjectRoot(): string {
  return mkdtempSync(resolve(tmpdir(), "agent-major-hex-editor-"));
}

function createValidDraft() {
  const asset = createEmptyDust2HexDraft();
  asset.cells = [
    {
      cellId: "h_04_04",
      col: 4,
      row: 4,
      level: 0,
      playable: true,
      terrain: "floor",
      flags: ["playable", "bombsite_b"],
      regionId: "b_site",
      pointIds: ["b_bombsite"]
    },
    {
      cellId: "h_02_02",
      col: 2,
      row: 2,
      level: 0,
      playable: true,
      terrain: "floor",
      flags: ["playable", "spawn_ct"],
      regionId: "ct_spawn",
      pointIds: ["ct_spawn_point"]
    },
    {
      cellId: "h_01_01",
      col: 1,
      row: 1,
      level: 0,
      playable: true,
      terrain: "floor",
      flags: ["playable", "spawn_t"],
      regionId: "t_spawn",
      pointIds: ["t_spawn_point"]
    },
    {
      cellId: "h_03_03",
      col: 3,
      row: 3,
      level: 0,
      playable: true,
      terrain: "floor",
      flags: ["playable", "bombsite_a"],
      regionId: "a_site",
      pointIds: ["a_bombsite"]
    }
  ];
  asset.regions = [
    {
      regionId: "b_site",
      nameCn: "B Site",
      nameEn: "B Site",
      regionType: "b_site",
      cellIds: ["h_04_04_l0"]
    },
    {
      regionId: "a_site",
      nameCn: "A Site",
      nameEn: "A Site",
      regionType: "a_site",
      cellIds: ["h_03_03_l0"]
    },
    {
      regionId: "t_spawn",
      nameCn: "T Spawn",
      nameEn: "T Spawn",
      regionType: "spawn",
      cellIds: ["h_01_01_l0"]
    },
    {
      regionId: "ct_spawn",
      nameCn: "CT Spawn",
      nameEn: "CT Spawn",
      regionType: "spawn",
      cellIds: ["h_02_02_l0"]
    }
  ];
  asset.points = [
    {
      pointId: "t_spawn_point",
      nameCn: "T Spawn",
      nameEn: "T Spawn",
      pointType: "spawn",
      parentRegionId: "t_spawn",
      cellIds: ["h_01_01_l0"]
    },
    {
      pointId: "ct_spawn_point",
      nameCn: "CT Spawn",
      nameEn: "CT Spawn",
      pointType: "spawn",
      parentRegionId: "ct_spawn",
      cellIds: ["h_02_02_l0"]
    },
    {
      pointId: "a_bombsite",
      nameCn: "A Bombsite",
      nameEn: "A Bombsite",
      pointType: "bombsite",
      parentRegionId: "a_site",
      cellIds: ["h_03_03_l0"]
    },
    {
      pointId: "b_bombsite",
      nameCn: "B Bombsite",
      nameEn: "B Bombsite",
      pointType: "bombsite",
      parentRegionId: "b_site",
      cellIds: ["h_04_04_l0"]
    }
  ];
  return asset;
}

function createLegacyTwoDimensionalDraft() {
  const asset = createValidDraft() as unknown as {
    [key: string]: unknown;
    cells: Array<Record<string, unknown>>;
    regions: Array<Record<string, unknown>>;
    points: Array<Record<string, unknown>>;
    routeHints: Array<Record<string, unknown>>;
  };
  delete asset.levels;
  delete asset.defaultLevel;
  delete asset.verticalLinks;

  asset.cells = asset.cells.map((cell) => {
    const nextCell = { ...cell };
    nextCell.cellId = String(nextCell.cellId).replace(/_l0$/, "");
    delete nextCell.level;
    return nextCell;
  });
  asset.regions = asset.regions.map((region) => ({
    ...region,
    cellIds: (region.cellIds as string[]).map((cellId) => cellId.replace(/_l0$/, ""))
  }));
  asset.points = asset.points.map((point) => ({
    ...point,
    cellIds: (point.cellIds as string[]).map((cellId) => cellId.replace(/_l0$/, ""))
  }));
  asset.routeHints = [
    {
      routeId: "legacy_route",
      fromPointId: "t_spawn_point",
      toPointId: "a_bombsite",
      viaCellIds: ["h_01_01", "h_02_02", "h_03_03"],
      commonUse: "execute"
    }
  ];
  return asset;
}
