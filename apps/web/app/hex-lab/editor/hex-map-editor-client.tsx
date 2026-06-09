"use client";

import { useEffect, useMemo, useState } from "react";

import styles from "./hex-map-editor.module.css";

type EditorMode = "playable" | "eraser" | "region" | "point" | "flag" | "vertical_link" | "inspect";
type EraserTarget = "cell" | "region" | "point" | "flag" | "vertical_link";
type HexLevel = -1 | 0 | 1;
type HexTerrain = "floor" | "obstacle" | "wall" | "void";
type HexVerticalLinkType = "stairs" | "ramp" | "ladder" | "drop" | "jump";
type HexEditorMapVariant = "draft" | "agent_refined";
type HexCellFlag =
  | "playable"
  | "spawn_t"
  | "spawn_ct"
  | "bombsite_a"
  | "bombsite_b"
  | "cover"
  | "choke"
  | "high_risk"
  | "route_hint"
  | "draft_unassigned_region";
type HexRegionType = "a_site" | "b_site" | "mid" | "long" | "tunnel" | "spawn" | "rotate" | "connector" | "other";
type HexPointType = "spawn" | "bombsite" | "choke" | "cover" | "angle" | "default" | "route" | "utility" | "other";

interface HexCell {
  cellId: string;
  col: number;
  row: number;
  level: HexLevel;
  playable: boolean;
  terrain: HexTerrain;
  flags: HexCellFlag[];
  regionId?: string;
  pointIds: string[];
}

interface HexRegion {
  regionId: string;
  nameCn: string;
  nameEn: string;
  regionType: HexRegionType;
  cellIds: string[];
  businessSemantics?: string;
}

interface HexPoint {
  pointId: string;
  nameCn: string;
  nameEn: string;
  pointType: HexPointType;
  parentRegionId: string;
  cellIds: string[];
}

interface HexRouteHint {
  routeId: string;
  fromPointId: string;
  toPointId: string;
  viaCellIds: string[];
  commonUse: string;
  notes?: string;
}

interface HexVerticalLink {
  linkId: string;
  fromCellId: string;
  toCellId: string;
  linkType: HexVerticalLinkType;
  apCostModifier: number;
  oneWay: boolean;
  notes?: string;
}

interface HexMapAsset {
  schemaVersion: 1;
  mapSlug: string;
  displayName: string;
  grid: {
    width: 50;
    height: 50;
    coordinateSystem: "col_row";
    origin: "top_left";
  };
  apModel: {
    baseApPerPhase: 3;
    minAp: 0;
    cellsPerAp: 10;
    allowFractionalAp: true;
    resetsEachPhase: true;
  };
  levels: HexLevel[];
  defaultLevel: HexLevel;
  cells: HexCell[];
  regions: HexRegion[];
  points: HexPoint[];
  routeHints: HexRouteHint[];
  verticalLinks: HexVerticalLink[];
  notes: string[];
}

interface HexMapValidationIssue {
  code: string;
  message: string;
  ref?: string;
}

interface HexMapValidationResult {
  ok: boolean;
  errors: HexMapValidationIssue[];
  warnings: HexMapValidationIssue[];
}

interface HexEditorPayload {
  asset: HexMapAsset;
  validation: HexMapValidationResult;
  path: string;
  variant?: HexEditorMapVariant;
  variants?: HexEditorMapVariantOption[];
}

interface HexEditorMapVariantOption {
  variant: HexEditorMapVariant;
  label: string;
  editable: boolean;
  description: string;
}

const gridSize = 50;
const hexRadius = 7;
const hexWidth = hexRadius * 2;
const hexHeight = Math.sqrt(3) * hexRadius;
const stepX = hexRadius * 1.5;
const stepY = hexHeight;
const viewBoxWidth = stepX * (gridSize - 1) + hexWidth + 8;
const viewBoxHeight = stepY * gridSize + hexHeight / 2 + 8;

const editorModes: Array<{ mode: EditorMode; label: string; title: string }> = [
  { mode: "playable", label: "可比赛格", title: "把蜂巢格设为可比赛区域。" },
  { mode: "eraser", label: "橡皮擦", title: "从草稿资产中移除该蜂巢格。" },
  { mode: "region", label: "区域填色", title: "把蜂巢格分配给当前选中的区域。" },
  { mode: "point", label: "点位标注", title: "把蜂巢格加入当前选中的点位。" },
  { mode: "flag", label: "标记模式", title: "设置出生点、包点、掩体、狭道、路线提示等标记。" },
  { mode: "vertical_link", label: "跨层连接", title: "显式连接不同层级的蜂巢格，例如楼梯、坡道、梯子、跳下。" },
  { mode: "inspect", label: "检查", title: "只查看蜂巢格信息，不修改。" }
];

const regionTypeOptions: HexRegionType[] = ["a_site", "b_site", "mid", "long", "tunnel", "spawn", "rotate", "connector", "other"];
const pointTypeOptions: HexPointType[] = ["spawn", "bombsite", "choke", "cover", "angle", "default", "route", "utility", "other"];
const flagOptions: HexCellFlag[] = ["spawn_t", "spawn_ct", "bombsite_a", "bombsite_b", "cover", "choke", "high_risk", "route_hint"];
const requiredMapFlags: HexCellFlag[] = ["spawn_t", "spawn_ct", "bombsite_a", "bombsite_b"];
const eraserTargetOptions: Array<{ target: EraserTarget; label: string; description: string }> = [
  { target: "cell", label: "整格删除", description: "删除格子本身，并清理区域、点位、路线和跨层连接引用。" },
  { target: "region", label: "只擦区域", description: "保留格子，只清理该格的区域归属。" },
  { target: "point", label: "只擦点位", description: "保留格子，只移除当前点位；未选点位时移除该格全部点位。" },
  { target: "flag", label: "只擦标记", description: "保留格子，只移除当前选中的标记。" },
  { target: "vertical_link", label: "只擦跨层连接", description: "保留格子，只删除连接到该格的跨层连接。" }
];
const levelOptions: Array<{ level: HexLevel; label: string }> = [
  { level: -1, label: "下层 level -1" },
  { level: 0, label: "地面 level 0" },
  { level: 1, label: "上层 level 1" }
];
const verticalLinkTypeOptions: Array<{ type: HexVerticalLinkType; label: string; apCostModifier: number }> = [
  { type: "stairs", label: "楼梯 stairs", apCostModifier: 0.2 },
  { type: "ramp", label: "坡道 ramp", apCostModifier: 0.15 },
  { type: "ladder", label: "梯子 ladder", apCostModifier: 0.4 },
  { type: "drop", label: "跳下 drop", apCostModifier: 0.1 },
  { type: "jump", label: "跳跃 jump", apCostModifier: 0.5 }
];
const localDraftStorageKey = "agent-major.hex-map-editor.dust2.local-draft.v1";
const semanticInfoWarningCodes = new Set(["playable_cell_without_region"]);
const defaultMapVariants: HexEditorMapVariantOption[] = [
  {
    variant: "draft",
    label: "当前草稿",
    editable: true,
    description: "你的主编辑草稿。"
  },
  {
    variant: "agent_refined",
    label: "Agent 完善副本",
    editable: true,
    description: "基于当前草稿生成的审计副本。"
  }
];

function isSemanticInfoIssue(issue: HexMapValidationIssue): boolean {
  return semanticInfoWarningCodes.has(issue.code);
}

const regionTypeLabels: Record<HexRegionType, string> = {
  a_site: "A 包点",
  b_site: "B 包点",
  mid: "中路",
  long: "A 大",
  tunnel: "B 洞",
  spawn: "出生点",
  rotate: "转点/回防",
  connector: "连接区",
  other: "其他"
};

const pointTypeLabels: Record<HexPointType, string> = {
  spawn: "出生点",
  bombsite: "包点",
  choke: "狭道",
  cover: "掩体",
  angle: "架枪位",
  default: "默认位",
  route: "路线点",
  utility: "道具点",
  other: "其他"
};

const flagLabels: Record<HexCellFlag, string> = {
  playable: "可比赛",
  spawn_t: "T 出生点",
  spawn_ct: "CT 出生点",
  bombsite_a: "A 包点",
  bombsite_b: "B 包点",
  cover: "掩体",
  choke: "狭道",
  high_risk: "高风险",
  route_hint: "路线提示",
  draft_unassigned_region: "草稿未分区"
};

const flagDescriptions: Record<HexCellFlag, string> = {
  playable: "该格会进入正式可行走 / 可行动地图范围。",
  spawn_t: "T 方开局出生区，后续用于队伍初始站位。",
  spawn_ct: "CT 方开局出生区，后续用于队伍初始站位。",
  bombsite_a: "A 包点范围，后续用于下包、守包、拆包条件。",
  bombsite_b: "B 包点范围，后续用于下包、守包、拆包条件。",
  cover: "掩体或可依托位置，后续影响交火裁定。",
  choke: "狭道或关键卡口，后续影响行动风险和交火裁定。",
  high_risk: "高风险区域，后续用于提示暴露、转点或强行突破风险。",
  route_hint: "常用路线提示，后续辅助路径和战术规划。",
  draft_unassigned_region: "草稿阶段临时标记，表示该格还没有归入正式区域。"
};

export function HexMapEditorClient() {
  const [asset, setAsset] = useState<HexMapAsset | null>(null);
  const [validation, setValidation] = useState<HexMapValidationResult | null>(null);
  const [assetPath, setAssetPath] = useState("");
  const [selectedVariant, setSelectedVariant] = useState<HexEditorMapVariant>("draft");
  const [availableVariants, setAvailableVariants] = useState<HexEditorMapVariantOption[]>(defaultMapVariants);
  const [mode, setMode] = useState<EditorMode>("playable");
  const [currentLevel, setCurrentLevel] = useState<HexLevel>(0);
  const [selectedRegionId, setSelectedRegionId] = useState("");
  const [selectedPointId, setSelectedPointId] = useState("");
  const [selectedFlag, setSelectedFlag] = useState<HexCellFlag>("spawn_t");
  const [eraserTarget, setEraserTarget] = useState<EraserTarget>("cell");
  const [selectedVerticalLinkType, setSelectedVerticalLinkType] = useState<HexVerticalLinkType>("stairs");
  const [selectedVerticalLinkOneWay, setSelectedVerticalLinkOneWay] = useState(false);
  const [verticalLinkFromCellId, setVerticalLinkFromCellId] = useState("");
  const [hoveredCellId, setHoveredCellId] = useState("");
  const [selectedCellId, setSelectedCellId] = useState("");
  const [statusMessage, setStatusMessage] = useState("正在加载蜂巢地图编辑器...");
  const [isPointerDown, setIsPointerDown] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showRadarBackground, setShowRadarBackground] = useState(true);
  const [radarOpacity, setRadarOpacity] = useState(0.38);
  const [draftRegion, setDraftRegion] = useState({ id: "", nameCn: "", nameEn: "", regionType: "other" as HexRegionType });
  const [draftPoint, setDraftPoint] = useState({ id: "", nameCn: "", nameEn: "", pointType: "other" as HexPointType });

  useEffect(() => {
    void loadMap();
  }, []);

  useEffect(() => {
    function handlePointerUp() {
      setIsPointerDown(false);
    }
    window.addEventListener("pointerup", handlePointerUp);
    return () => window.removeEventListener("pointerup", handlePointerUp);
  }, []);

  const cellsById = useMemo(() => {
    const map = new Map<string, HexCell>();
    for (const cell of asset?.cells ?? []) {
      map.set(cell.cellId, cell);
    }
    return map;
  }, [asset]);

  const selectedCell = selectedCellId ? cellsById.get(selectedCellId) ?? createBlankCell(selectedCellId) : null;
  const hoveredCell = hoveredCellId ? cellsById.get(hoveredCellId) ?? createBlankCell(hoveredCellId) : null;
  const selectedRegion = asset?.regions.find((region) => region.regionId === selectedRegionId) ?? null;
  const selectedPoint = asset?.points.find((point) => point.pointId === selectedPointId) ?? null;
  const selectedCellRegion = selectedCell?.regionId ? asset?.regions.find((region) => region.regionId === selectedCell.regionId) ?? null : null;
  const selectedCellPoints = selectedCell
    ? selectedCell.pointIds
        .map((pointId) => asset?.points.find((point) => point.pointId === pointId) ?? null)
        .filter((point): point is HexPoint => Boolean(point))
    : [];
  const currentMode = editorModes.find((item) => item.mode === mode);
  const selectedVariantOption = availableVariants.find((item) => item.variant === selectedVariant) ?? defaultMapVariants[0]!;
  const localDraftStorageKeyForVariant = `${localDraftStorageKey}.${selectedVariant}`;
  const semanticInfoIssues = useMemo(() => validation?.warnings.filter(isSemanticInfoIssue) ?? [], [validation]);
  const blockingWarningIssues = useMemo(() => validation?.warnings.filter((issue) => !isSemanticInfoIssue(issue)) ?? [], [validation]);
  const mapStats = useMemo(() => {
    const cells = asset?.cells ?? [];
    const playableCells = cells.filter((cell) => cell.playable);
    const assignedPlayableCells = playableCells.filter((cell) => cell.regionId).length;
    const cellsByLevel = new Map<HexLevel, number>();
    for (const cell of cells) {
      cellsByLevel.set(cell.level, (cellsByLevel.get(cell.level) ?? 0) + 1);
    }
    return {
      playableCells: playableCells.length,
      assignedPlayableCells,
      unassignedPlayableCells: Math.max(0, playableCells.length - assignedPlayableCells),
      regionCount: asset?.regions.length ?? 0,
      pointCount: asset?.points.length ?? 0,
      routeHintCount: asset?.routeHints.length ?? 0,
      verticalLinkCount: asset?.verticalLinks.length ?? 0,
      oneWayVerticalLinkCount: asset?.verticalLinks.filter((link) => link.oneWay).length ?? 0,
      levelSummary: Array.from(cellsByLevel.entries())
        .sort(([left], [right]) => left - right)
        .map(([level, count]) => `L${level}:${count}`)
        .join(" / ")
    };
  }, [asset]);
  const flagCounts = useMemo(() => {
    const counts = new Map<HexCellFlag, number>();
    for (const cell of asset?.cells ?? []) {
      for (const flag of cell.flags) {
        counts.set(flag, (counts.get(flag) ?? 0) + 1);
      }
    }
    return counts;
  }, [asset]);
  const selectedFlagCount = flagCounts.get(selectedFlag) ?? 0;

  async function loadMap(variant = selectedVariant) {
    setStatusMessage(`正在读取 Dust2 蜂巢地图版本：${getVariantDisplayName(availableVariants, variant)}...`);
    const response = await fetch(`/api/hex-lab/editor/map?mapSlug=dust2&variant=${encodeURIComponent(variant)}`, { cache: "no-store" });
    const payload = (await response.json()) as Partial<HexEditorPayload> & { error?: string; message?: string };
    if (!response.ok || !payload.asset || !payload.validation) {
      setStatusMessage(payload.message ?? payload.error ?? "读取蜂巢草稿失败。");
      return;
    }
    const nextAsset = normalizeClientAsset(payload.asset);
    setAsset(nextAsset);
    setValidation(payload.validation);
    setAssetPath(payload.path ?? "");
    setSelectedVariant(payload.variant ?? variant);
    setAvailableVariants(payload.variants ?? defaultMapVariants);
    setCurrentLevel(nextAsset.defaultLevel);
    setSelectedRegionId(nextAsset.regions[0]?.regionId ?? "");
    setSelectedPointId(nextAsset.points[0]?.pointId ?? "");
    setStatusMessage(`已读取 Dust2 蜂巢地图版本：${getVariantDisplayName(payload.variants ?? availableVariants, payload.variant ?? variant)}。`);
  }

  async function saveMap() {
    if (!asset) {
      return;
    }
    setStatusMessage(`正在保存蜂巢地图版本：${selectedVariantOption.label}...`);
    const response = await fetch(`/api/hex-lab/editor/map?mapSlug=dust2&variant=${encodeURIComponent(selectedVariant)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ asset })
    });
    const payload = (await response.json()) as Partial<HexEditorPayload> & {
      error?: string;
      message?: string;
      validation?: HexMapValidationResult;
    };
    if (!response.ok || !payload.asset || !payload.validation) {
      setValidation(payload.validation ?? null);
      setStatusMessage(payload.message ?? payload.error ?? "保存蜂巢草稿失败。");
      return;
    }
    setAsset(payload.asset);
    setValidation(payload.validation);
    setAssetPath(payload.path ?? "");
    setSelectedVariant(payload.variant ?? selectedVariant);
    setAvailableVariants(payload.variants ?? availableVariants);
    const realWarningCount = payload.validation.warnings.filter((issue) => !isSemanticInfoIssue(issue)).length;
    setStatusMessage(
      realWarningCount > 0
        ? "已保存，但存在警告。"
        : payload.validation.warnings.length > 0
          ? "已保存；存在语义信息提示，不影响保存。"
          : "已保存，并通过校验。"
    );
  }

  function stashLocalDraft() {
    if (!asset) {
      return;
    }
    window.localStorage.setItem(localDraftStorageKeyForVariant, JSON.stringify(asset));
    setStatusMessage(`已暂存 ${selectedVariantOption.label} 到浏览器本地。注意：暂存不会写入仓库 JSON。`);
  }

  function restoreLocalDraft() {
    const raw = window.localStorage.getItem(localDraftStorageKeyForVariant);
    if (!raw) {
      setStatusMessage("没有找到浏览器本地暂存。");
      return;
    }
    try {
      const nextAsset = normalizeClientAsset(JSON.parse(raw) as HexMapAsset);
      setAsset(nextAsset);
      setCurrentLevel(nextAsset.defaultLevel);
      setStatusMessage("已从浏览器本地暂存恢复。确认无误后请点击“保存 JSON”写入仓库草稿。");
    } catch {
      setStatusMessage("浏览器本地暂存已损坏，无法恢复。");
    }
  }

  function clearLocalDraft() {
    window.localStorage.removeItem(localDraftStorageKeyForVariant);
    setStatusMessage(`已清除 ${selectedVariantOption.label} 的浏览器本地暂存。`);
  }

  function editCell(cellId: string) {
    setSelectedCellId(cellId);
    if (mode === "vertical_link") {
      handleVerticalLinkCell(cellId);
      return;
    }
    if (!asset || mode === "inspect") {
      return;
    }

    setAsset((current) => {
      if (!current) {
        return current;
      }
      const cell = current.cells.find((candidate) => candidate.cellId === cellId) ?? createBlankCell(cellId);

      if (mode === "eraser") {
        return eraseCellTarget(current, cellId, eraserTarget, selectedPointId, selectedFlag);
      }

      const nextCell: HexCell = {
        ...cell,
        playable: true,
        terrain: "floor",
        flags: addUniqueFlag(cell.flags, "playable")
      };

      let regions = current.regions;
      let points = current.points;

      if (mode === "region" && selectedRegionId) {
        nextCell.regionId = selectedRegionId;
        regions = current.regions.map((region) => ({
          ...region,
          cellIds:
            region.regionId === selectedRegionId
              ? addUnique(region.cellIds, cellId)
              : region.cellIds.filter((candidateId) => candidateId !== cellId)
        }));
      }

      if (mode === "point" && selectedPointId) {
        nextCell.pointIds = addUnique(nextCell.pointIds, selectedPointId);
        const point = current.points.find((candidate) => candidate.pointId === selectedPointId);
        if (point) {
          nextCell.regionId = point.parentRegionId;
          regions = current.regions.map((region) =>
            region.regionId === point.parentRegionId ? { ...region, cellIds: addUnique(region.cellIds, cellId) } : region
          );
        }
        points = current.points.map((candidate) =>
          candidate.pointId === selectedPointId ? { ...candidate, cellIds: addUnique(candidate.cellIds, cellId) } : candidate
        );
      }

      if (mode === "flag") {
        nextCell.flags = addUniqueFlag(nextCell.flags, selectedFlag);
      }

      return {
        ...current,
        cells: upsertCell(current.cells, nextCell),
        regions,
        points
      };
    });
  }

  function handleVerticalLinkCell(cellId: string) {
    if (!asset) {
      return;
    }
    const cell = asset.cells.find((candidate) => candidate.cellId === cellId);
    if (!cell?.playable) {
      setStatusMessage("跨层连接只能选择已绘制的可比赛格。");
      return;
    }
    if (!verticalLinkFromCellId) {
      setVerticalLinkFromCellId(cellId);
      setStatusMessage(`跨层连接起点：${cellId}。请切换到目标层并点击目标格。`);
      return;
    }
    if (verticalLinkFromCellId === cellId) {
      setStatusMessage("跨层连接的起点和终点不能是同一个格。");
      return;
    }
    const fromCell = asset.cells.find((candidate) => candidate.cellId === verticalLinkFromCellId);
    if (!fromCell) {
      setVerticalLinkFromCellId(cellId);
      setStatusMessage(`原起点已不存在，已改用 ${cellId} 作为新起点。`);
      return;
    }
    if (fromCell.level === cell.level) {
      setStatusMessage("跨层连接两端必须处在不同 level。请切换到下层/上层后再点目标格。");
      return;
    }

    const linkOption = verticalLinkTypeOptions.find((option) => option.type === selectedVerticalLinkType) ?? verticalLinkTypeOptions[0]!;
    const linkId = normalizeId(`vl_${verticalLinkFromCellId}_${cellId}_${selectedVerticalLinkType}`);
    const nextLink: HexVerticalLink = {
      linkId,
      fromCellId: verticalLinkFromCellId,
      toCellId: cellId,
      linkType: selectedVerticalLinkType,
      apCostModifier: linkOption.apCostModifier,
      oneWay: selectedVerticalLinkOneWay,
      notes: `${linkOption.label} generated in HexMapEditor (${selectedVerticalLinkOneWay ? "one-way" : "bidirectional"}).`
    };
    setAsset({
      ...asset,
      verticalLinks: [...asset.verticalLinks.filter((link) => link.linkId !== linkId), nextLink]
    });
    setVerticalLinkFromCellId("");
    setStatusMessage(`已创建跨层连接：${nextLink.linkId}`);
  }

  function addRegion() {
    if (!asset || !draftRegion.id.trim()) {
      return;
    }
    const regionId = normalizeId(draftRegion.id);
    if (asset.regions.some((region) => region.regionId === regionId)) {
      setStatusMessage(`区域已存在：${regionId}`);
      return;
    }
    const region: HexRegion = {
      regionId,
      nameCn: draftRegion.nameCn.trim() || regionId,
      nameEn: draftRegion.nameEn.trim() || regionId,
      regionType: draftRegion.regionType,
      cellIds: [],
      businessSemantics: ""
    };
    setAsset({ ...asset, regions: [...asset.regions, region] });
    setSelectedRegionId(regionId);
    setDraftRegion({ id: "", nameCn: "", nameEn: "", regionType: "other" });
  }

  function deleteRegion(regionId: string) {
    if (!asset) {
      return;
    }
    if (asset.points.some((point) => point.parentRegionId === regionId)) {
      setStatusMessage("该区域仍被点位引用，请先删除或迁移点位。");
      return;
    }
    setAsset({
      ...asset,
      regions: asset.regions.filter((region) => region.regionId !== regionId),
      cells: asset.cells.map((cell) => (cell.regionId === regionId ? omitRegionId(cell) : cell))
    });
    setSelectedRegionId(asset.regions.find((region) => region.regionId !== regionId)?.regionId ?? "");
  }

  function addPoint() {
    if (!asset || !draftPoint.id.trim() || !selectedRegionId) {
      setStatusMessage("新增点位前必须填写点位 ID，并选择父级区域。");
      return;
    }
    const pointId = normalizeId(draftPoint.id);
    if (asset.points.some((point) => point.pointId === pointId)) {
      setStatusMessage(`点位已存在：${pointId}`);
      return;
    }
    const point: HexPoint = {
      pointId,
      nameCn: draftPoint.nameCn.trim() || pointId,
      nameEn: draftPoint.nameEn.trim() || pointId,
      pointType: draftPoint.pointType,
      parentRegionId: selectedRegionId,
      cellIds: []
    };
    setAsset({ ...asset, points: [...asset.points, point] });
    setSelectedPointId(pointId);
    setDraftPoint({ id: "", nameCn: "", nameEn: "", pointType: "other" });
  }

  function deletePoint(pointId: string) {
    if (!asset) {
      return;
    }
    setAsset({
      ...asset,
      points: asset.points.filter((point) => point.pointId !== pointId),
      cells: asset.cells.map((cell) => ({ ...cell, pointIds: cell.pointIds.filter((candidate) => candidate !== pointId) }))
    });
    setSelectedPointId(asset.points.find((point) => point.pointId !== pointId)?.pointId ?? "");
  }

  function updateSelectedRegion(field: "nameCn" | "nameEn" | "regionType", value: string) {
    if (!asset || !selectedRegionId) {
      return;
    }
    setAsset({
      ...asset,
      regions: asset.regions.map((region) => (region.regionId === selectedRegionId ? { ...region, [field]: value } : region))
    });
  }

  function updateSelectedPoint(field: "nameCn" | "nameEn" | "pointType", value: string) {
    if (!asset || !selectedPointId) {
      return;
    }
    setAsset({
      ...asset,
      points: asset.points.map((point) => (point.pointId === selectedPointId ? { ...point, [field]: value } : point))
    });
  }

  function applyFlagToCurrentRegion(flag: HexCellFlag) {
    if (!asset || !selectedRegion) {
      setStatusMessage("请先选择一个区域，再批量应用必备标记。");
      return;
    }
    if (selectedRegion.cellIds.length === 0) {
      setStatusMessage(`区域 ${selectedRegion.nameCn} 还没有格子，无法应用 ${flagLabels[flag]}。`);
      return;
    }
    setAsset(applyFlagToCellIds(asset, selectedRegion.cellIds, flag));
    setStatusMessage(`已给区域 ${selectedRegion.nameCn} 的 ${selectedRegion.cellIds.length} 个格子应用 ${flagLabels[flag]}。`);
  }

  function applyFlagToCurrentPoint(flag: HexCellFlag) {
    if (!asset || !selectedPoint) {
      setStatusMessage("请先选择一个点位，再批量应用必备标记。");
      return;
    }
    if (selectedPoint.cellIds.length === 0) {
      setStatusMessage(`点位 ${selectedPoint.nameCn} 还没有格子，无法应用 ${flagLabels[flag]}。`);
      return;
    }
    setAsset(applyFlagToCellIds(asset, selectedPoint.cellIds, flag));
    setStatusMessage(`已给点位 ${selectedPoint.nameCn} 的 ${selectedPoint.cellIds.length} 个格子应用 ${flagLabels[flag]}。`);
  }

  function makeAllVerticalLinksBidirectional() {
    if (!asset) {
      return;
    }
    setAsset({
      ...asset,
      verticalLinks: asset.verticalLinks.map((link) => ({ ...link, oneWay: false }))
    });
    setStatusMessage(`已将 ${asset.verticalLinks.length} 条跨层连接设为双向。`);
  }

  function handleCellPointerDown(cellId: string) {
    setIsPointerDown(true);
    editCell(cellId);
  }

  function handleCellPointerEnter(cellId: string) {
    setHoveredCellId(cellId);
    if (isPointerDown && mode !== "inspect" && mode !== "vertical_link") {
      editCell(cellId);
    }
  }

  const gridCells = useMemo(() => {
    const items: Array<{ cellId: string; col: number; row: number; points: string; x: number; y: number }> = [];
    for (let row = 0; row < gridSize; row += 1) {
      for (let col = 0; col < gridSize; col += 1) {
        const cellId = toCellId(col, row, currentLevel);
        const { x, y } = getHexCenter(col, row);
        items.push({ cellId, col, row, x, y, points: getHexPolygonPoints(x, y) });
      }
    }
    return items;
  }, [currentLevel]);

  const visibleVerticalLinks = useMemo(() => {
    return (asset?.verticalLinks ?? [])
      .map((link) => {
        const fromCell = cellsById.get(link.fromCellId);
        const toCell = cellsById.get(link.toCellId);
        if (!fromCell || !toCell || (fromCell.level !== currentLevel && toCell.level !== currentLevel)) {
          return null;
        }
        const from = getHexCenter(fromCell.col, fromCell.row);
        const to = getHexCenter(toCell.col, toCell.row);
        return { link, from, to, fromCell, toCell };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }, [asset?.verticalLinks, cellsById, currentLevel]);

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Phase 2.0-pre / N22</p>
          <h1>HexMapEditor (蜂巢地图编辑器)</h1>
          <p className={styles.subtitle}>
            编辑 Dust2 的 50x50 蜂巢格草稿。本页面只修改本地地图资产，不运行比赛，不调用 LLM（大语言模型），
            不接入已冻结的 Node/Sector（节点/区块）路线。
          </p>
        </div>
        <div className={styles.headerActions}>
          <label className={styles.variantPicker}>
            <span>地图版本</span>
            <select
              value={selectedVariant}
              onChange={(event) => {
                const nextVariant = event.target.value as HexEditorMapVariant;
                setSelectedVariant(nextVariant);
                void loadMap(nextVariant);
              }}
            >
              {availableVariants.map((item) => (
                <option key={item.variant} value={item.variant}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <a className={styles.linkButton} href="/node-lab">
            Node Lab（旧实验台）
          </a>
          <a className={styles.linkButton} href="/">
            返回主页
          </a>
          <button type="button" className={styles.linkButton} onClick={() => void loadMap()}>
            重新读取文件
          </button>
          <button type="button" className={styles.linkButton} onClick={stashLocalDraft} disabled={!asset}>
            暂存
          </button>
          <button type="button" className={styles.linkButton} onClick={restoreLocalDraft}>
            读取暂存
          </button>
          <button type="button" className={styles.linkButton} onClick={clearLocalDraft}>
            清除暂存
          </button>
          <button type="button" className={styles.primaryButton} onClick={() => void saveMap()} disabled={!asset}>
            保存 JSON
          </button>
        </div>
      </header>

      <section className={styles.statusBar}>
        <span>{statusMessage}</span>
        <span>地图版本：{selectedVariantOption.label}</span>
        <span>{assetPath ? `路径：${assetPath}` : "路径：-"}</span>
        <span>当前层：{currentLevel}</span>
        <span>{hoveredCell ? `悬停：${hoveredCell.cellId} (${hoveredCell.col}, ${hoveredCell.row}, L${hoveredCell.level})` : "悬停：-"}</span>
      </section>

      <section className={styles.workspace}>
        <aside className={styles.panel}>
          <section>
            <h2>地图版本</h2>
            <div className={styles.infoBox}>
              <p><strong>{selectedVariantOption.label}</strong></p>
              <p>{selectedVariantOption.description}</p>
              <p>切换版本会重新读取对应 JSON。保存 JSON 只写回当前版本，不会覆盖其他版本。</p>
            </div>
          </section>

          <section>
            <h2>工具</h2>
            <div className={styles.toolGrid}>
              {editorModes.map((item) => (
                <button
                  key={item.mode}
                  type="button"
                  title={item.title}
                  className={`${styles.toolButton} ${mode === item.mode ? styles.toolButtonActive : ""}`}
                  onClick={() => setMode(item.mode)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>

          <section className={styles.currentOperation}>
            <h2>当前操作</h2>
            <div className={styles.operationGrid}>
              <div className={styles.operationRow}>
                <span>工具</span>
                <strong>{currentMode?.label ?? mode}</strong>
              </div>
              <div className={styles.operationRow}>
                <span>作用层级</span>
                <strong>level {currentLevel}</strong>
              </div>
              <OperationTarget
                mode={mode}
                selectedRegion={selectedRegion}
                selectedPoint={selectedPoint}
                selectedFlag={selectedFlag}
                eraserTarget={eraserTarget}
                selectedVerticalLinkType={selectedVerticalLinkType}
                selectedVerticalLinkOneWay={selectedVerticalLinkOneWay}
                verticalLinkFromCellId={verticalLinkFromCellId}
              />
            </div>
          </section>

          <section>
            <h2>审计口径</h2>
            <div className={styles.auditGuide}>
              <div className={styles.auditGuideItem}>
                <span className={`${styles.auditSwatch} ${styles.regionSwatch}`} />
                <div>
                  <strong>Region（区域）</strong>
                  <p>大范围归属，例如 A大、B洞、中路。地图上用金色面高亮，主要回答“这格属于哪片区域”。</p>
                </div>
              </div>
              <div className={styles.auditGuideItem}>
                <span className={`${styles.auditSwatch} ${styles.pointSwatch}`} />
                <div>
                  <strong>Point（点位）</strong>
                  <p>区域内的小位置或掩体，例如白车、箱后、默认包位。地图上用紫色实线高亮。</p>
                </div>
              </div>
              <div className={styles.auditGuideItem}>
                <span className={`${styles.auditSwatch} ${styles.flagSwatch}`} />
                <div>
                  <strong>Flag（标记）</strong>
                  <p>规则功能标签，例如出生点、包点、掩体、狭道。地图上用青色虚线高亮，不等于区域或点位。</p>
                </div>
              </div>
            </div>
          </section>

          <section>
            <h2>橡皮擦细分</h2>
            <p className={styles.helpText}>先选“擦什么”，再点地图格子。这样可以保留地图轮廓，只移除区域、点位、标记或跨层连接。</p>
            <div className={styles.eraserGrid}>
              {eraserTargetOptions.map((option) => (
                <button
                  key={option.target}
                  type="button"
                  className={`${styles.flagButton} ${eraserTarget === option.target ? styles.flagButtonActive : ""}`}
                  onClick={() => {
                    setEraserTarget(option.target);
                    setMode("eraser");
                  }}
                >
                  <strong>{option.label}</strong>
                  <span>{option.description}</span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2>层级 Level</h2>
            <div className={styles.toolGrid}>
              {levelOptions.map((item) => (
                <button
                  key={item.level}
                  type="button"
                  className={`${styles.toolButton} ${currentLevel === item.level ? styles.toolButtonActive : ""}`}
                  onClick={() => setCurrentLevel(item.level)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className={styles.helpText}>
              当前只编辑所选层。坐标相同但 level 不同的格子互不连通，必须通过“跨层连接”显式建立楼梯、坡道或跳下。
            </p>
          </section>

          <section>
            <h2>跨层连接</h2>
            <p className={styles.helpText}>推荐流程：选择连接类型 → 点起点格 → 切换层级 → 点目标格。地图会显示连接线，列表会显示 from/to。</p>
            <select value={selectedVerticalLinkType} onChange={(event) => setSelectedVerticalLinkType(event.target.value as HexVerticalLinkType)}>
              {verticalLinkTypeOptions.map((option) => (
                <option key={option.type} value={option.type}>
                  {option.label}
                </option>
              ))}
            </select>
            <label className={styles.checkboxLine}>
              <input
                type="checkbox"
                checked={selectedVerticalLinkOneWay}
                onChange={(event) => setSelectedVerticalLinkOneWay(event.target.checked)}
              />
              单向连接（默认关闭，即双向）
            </label>
            <div className={styles.inlineControls}>
              <button type="button" onClick={() => setMode("vertical_link")}>
                开始连接
              </button>
              <button type="button" onClick={() => setVerticalLinkFromCellId("")}>
                清起点
              </button>
              <button type="button" onClick={makeAllVerticalLinksBidirectional} disabled={!asset?.verticalLinks.length}>
                全部改为双向
              </button>
            </div>
            <p className={styles.helpText}>
              起点：{verticalLinkFromCellId || "未选择"}；已有连接：{asset?.verticalLinks.length ?? 0}
            </p>
          </section>

          <section>
            <h2>视图</h2>
            <div className={styles.inlineControls}>
              <button type="button" onClick={() => setZoom((value) => Math.max(0.75, value - 0.15))}>
                -
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => setZoom((value) => Math.min(2.5, value + 0.15))}>
                +
              </button>
              <button type="button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>
                重置
              </button>
            </div>
            <div className={styles.inlineControls}>
              <button type="button" onClick={() => setPan((value) => ({ ...value, y: value.y + 24 }))}>下移</button>
              <button type="button" onClick={() => setPan((value) => ({ ...value, y: value.y - 24 }))}>上移</button>
              <button type="button" onClick={() => setPan((value) => ({ ...value, x: value.x + 24 }))}>右移</button>
              <button type="button" onClick={() => setPan((value) => ({ ...value, x: value.x - 24 }))}>左移</button>
            </div>
            <div className={styles.inlineControls}>
              <button type="button" onClick={() => setShowRadarBackground((value) => !value)}>
                {showRadarBackground ? "隐藏雷达底图" : "显示雷达底图"}
              </button>
              <button type="button" onClick={() => setShowRadarBackground(false)}>
                轮廓检查
              </button>
            </div>
            <label className={styles.rangeLine}>
              <span>底图透明度</span>
              <input
                type="range"
                min="0"
                max="0.8"
                step="0.05"
                value={radarOpacity}
                disabled={!showRadarBackground}
                onChange={(event) => setRadarOpacity(Number(event.target.value))}
              />
              <strong>{Math.round(radarOpacity * 100)}%</strong>
            </label>
            <p className={styles.helpText}>
              底图只是描图参考，正式比赛只读取 Hex JSON。隐藏底图后如果仍能看出 Dust2 轮廓，说明蜂巢格描图质量是健康的。
            </p>
          </section>

          <section>
            <h2>区域 Region</h2>
            <p className={styles.helpText}>先选中区域，再用“区域填色”刷格子。点击下面卡片会自动切到区域填色模式。</p>
            <div className={styles.entityList}>
              {asset?.regions.length ? (
                asset.regions.map((region) => (
                  <button
                    key={region.regionId}
                    type="button"
                    className={`${styles.entityCard} ${selectedRegionId === region.regionId ? styles.entityCardActive : ""}`}
                    onClick={() => {
                      setSelectedRegionId(region.regionId);
                      setMode("region");
                    }}
                  >
                    <span className={styles.entityTitle}>{region.nameCn || region.regionId}</span>
                    <span className={styles.entityMeta}>{regionTypeLabels[region.regionType]} / {region.regionId}</span>
                    <span className={styles.entityMeta}>已覆盖 {region.cellIds.length} 格 · 选中并填色</span>
                  </button>
                ))
              ) : (
                <span className={styles.muted}>暂无区域。先在下方新增区域。</span>
              )}
            </div>
            <select value={selectedRegionId} onChange={(event) => setSelectedRegionId(event.target.value)}>
              <option value="">选择区域</option>
              {asset?.regions.map((region) => (
                <option key={region.regionId} value={region.regionId}>
                  {region.nameCn} / {region.regionId}
                </option>
              ))}
            </select>
            {selectedRegion ? (
              <div className={styles.editStack}>
                <input value={selectedRegion.nameCn} onChange={(event) => updateSelectedRegion("nameCn", event.target.value)} />
                <input value={selectedRegion.nameEn} onChange={(event) => updateSelectedRegion("nameEn", event.target.value)} />
                <select value={selectedRegion.regionType} onChange={(event) => updateSelectedRegion("regionType", event.target.value)}>
                  {regionTypeOptions.map((option) => (
                    <option key={option} value={option}>{regionTypeLabels[option]} / {option}</option>
                  ))}
                </select>
                <button type="button" onClick={() => deleteRegion(selectedRegion.regionId)}>删除区域</button>
              </div>
            ) : null}
            {selectedRegion ? (
              <div className={styles.selectedTarget}>
                当前区域：<strong>{selectedRegion.nameCn}</strong> / <code>{selectedRegion.regionId}</code>，
                类型：{regionTypeLabels[selectedRegion.regionType]}，已覆盖 {selectedRegion.cellIds.length} 格。
              </div>
            ) : (
              <div className={styles.targetWarning}>未选择区域；区域填色不会生效。</div>
            )}
            <div className={styles.createBox}>
              <input placeholder="区域 ID，例如 a_long" value={draftRegion.id} onChange={(event) => setDraftRegion({ ...draftRegion, id: event.target.value })} />
              <input placeholder="中文名，例如 A大" value={draftRegion.nameCn} onChange={(event) => setDraftRegion({ ...draftRegion, nameCn: event.target.value })} />
              <input placeholder="英文名，例如 A Long" value={draftRegion.nameEn} onChange={(event) => setDraftRegion({ ...draftRegion, nameEn: event.target.value })} />
              <select value={draftRegion.regionType} onChange={(event) => setDraftRegion({ ...draftRegion, regionType: event.target.value as HexRegionType })}>
                {regionTypeOptions.map((option) => (
                  <option key={option} value={option}>{regionTypeLabels[option]} / {option}</option>
                ))}
              </select>
              <button type="button" onClick={addRegion}>新增区域</button>
            </div>
          </section>

          <section>
            <h2>点位 Point</h2>
            <p className={styles.helpText}>点位必须归属于一个区域。先选父级区域，再新增点位；点击点位卡片会自动切到点位标注模式。</p>
            <div className={styles.entityList}>
              {asset?.points.length ? (
                asset.points.map((point) => {
                  const parentRegion = asset.regions.find((region) => region.regionId === point.parentRegionId);
                  return (
                    <button
                      key={point.pointId}
                      type="button"
                      className={`${styles.entityCard} ${selectedPointId === point.pointId ? styles.entityCardActive : ""}`}
                      onClick={() => {
                        setSelectedPointId(point.pointId);
                        setSelectedRegionId(point.parentRegionId);
                        setMode("point");
                      }}
                    >
                      <span className={styles.entityTitle}>{point.nameCn || point.pointId}</span>
                      <span className={styles.entityMeta}>{pointTypeLabels[point.pointType]} / {point.pointId}</span>
                      <span className={styles.entityMeta}>父区域：{parentRegion?.nameCn ?? point.parentRegionId}</span>
                      <span className={styles.entityMeta}>已覆盖 {point.cellIds.length} 格 · 选中并标注</span>
                    </button>
                  );
                })
              ) : (
                <span className={styles.muted}>暂无点位。先选择父级区域并新增点位。</span>
              )}
            </div>
            <select value={selectedPointId} onChange={(event) => setSelectedPointId(event.target.value)}>
              <option value="">选择点位</option>
              {asset?.points.map((point) => (
                <option key={point.pointId} value={point.pointId}>
                  {point.nameCn} / {point.pointId}
                </option>
              ))}
            </select>
            {selectedPoint ? (
              <div className={styles.editStack}>
                <input value={selectedPoint.nameCn} onChange={(event) => updateSelectedPoint("nameCn", event.target.value)} />
                <input value={selectedPoint.nameEn} onChange={(event) => updateSelectedPoint("nameEn", event.target.value)} />
                <select value={selectedPoint.pointType} onChange={(event) => updateSelectedPoint("pointType", event.target.value)}>
                  {pointTypeOptions.map((option) => (
                    <option key={option} value={option}>{pointTypeLabels[option]} / {option}</option>
                  ))}
                </select>
                <button type="button" onClick={() => deletePoint(selectedPoint.pointId)}>删除点位</button>
              </div>
            ) : null}
            {selectedPoint ? (
              <div className={styles.selectedTarget}>
                当前点位：<strong>{selectedPoint.nameCn}</strong> / <code>{selectedPoint.pointId}</code>，
                类型：{pointTypeLabels[selectedPoint.pointType]}，父区域：{getRegionDisplayName(asset?.regions, selectedPoint.parentRegionId)}，
                已覆盖 {selectedPoint.cellIds.length} 格。
              </div>
            ) : (
              <div className={styles.targetWarning}>未选择点位；点位标注不会生效。</div>
            )}
            <div className={styles.createBox}>
              <input placeholder="点位 ID，例如 long_doors" value={draftPoint.id} onChange={(event) => setDraftPoint({ ...draftPoint, id: event.target.value })} />
              <input placeholder="中文名，例如 A大门" value={draftPoint.nameCn} onChange={(event) => setDraftPoint({ ...draftPoint, nameCn: event.target.value })} />
              <input placeholder="英文名，例如 Long Doors" value={draftPoint.nameEn} onChange={(event) => setDraftPoint({ ...draftPoint, nameEn: event.target.value })} />
              <select value={draftPoint.pointType} onChange={(event) => setDraftPoint({ ...draftPoint, pointType: event.target.value as HexPointType })}>
                {pointTypeOptions.map((option) => (
                  <option key={option} value={option}>{pointTypeLabels[option]} / {option}</option>
                ))}
              </select>
              <button type="button" onClick={addPoint}>新增点位</button>
            </div>
          </section>

          <section>
            <h2>标记 Flag</h2>
            <p className={styles.helpText}>
              Flag（标记）是功能标签，不是区域，也不是点位。它用于表达出生区、包点、掩体、狭道、高风险和路线提示等规则条件。
              当前选中标记会在地图上用青色虚线高亮。
            </p>
            <div className={styles.flagGrid}>
              {flagOptions.map((flag) => (
                <button
                  key={flag}
                  type="button"
                  className={`${styles.flagButton} ${selectedFlag === flag ? styles.flagButtonActive : ""}`}
                  onClick={() => {
                    setSelectedFlag(flag);
                    setMode("flag");
                  }}
                >
                  <strong>{flagLabels[flag]}</strong>
                  <span>{flag}</span>
                  <small>{flagCounts.get(flag) ?? 0} 格 · 选中并打标</small>
                </button>
              ))}
            </div>
            <div className={styles.selectedTarget}>
              当前标记：<strong>{flagLabels[selectedFlag]}</strong> / <code>{selectedFlag}</code>
              <span className={styles.targetMetric}>已标记 {selectedFlagCount} 格</span>
              <p>{flagDescriptions[selectedFlag]}</p>
            </div>
            <div className={styles.requiredFlags}>
              <h3>必备地图标记</h3>
              <p className={styles.helpText}>
                校验要求的是这些 flag（标记），不是区域或点位名字。画完 T/CT 出生区、A/B 包点后，用这里批量应用到当前区域或当前点位。
              </p>
              {requiredMapFlags.map((flag) => (
                <div key={flag} className={styles.requiredFlagRow}>
                  <strong>{flagLabels[flag]}</strong>
                  <button type="button" onClick={() => applyFlagToCurrentRegion(flag)}>应用到当前区域</button>
                  <button type="button" onClick={() => applyFlagToCurrentPoint(flag)}>应用到当前点位</button>
                </div>
              ))}
            </div>
          </section>
        </aside>

        <section className={styles.mapPanel}>
          <div className={styles.mapToolbar}>
            <span>格子：{asset?.cells.length ?? 0}</span>
            <span>可比赛：{mapStats.playableCells}</span>
            <span>未分区：{mapStats.unassignedPlayableCells}</span>
            <span>区域：{asset?.regions.length ?? 0}</span>
            <span>点位：{asset?.points.length ?? 0}</span>
            <span>层级：{currentLevel}</span>
            <span>跨层连接：{asset?.verticalLinks.length ?? 0}</span>
            <span>路线提示：{mapStats.routeHintCount}</span>
            <span>模式：{editorModes.find((item) => item.mode === mode)?.label ?? mode}</span>
          </div>
          <div className={styles.mapFrame}>
            <div className={styles.mapCanvas} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
              <img
                className={styles.radarImage}
                src="/node-lab/dust2/dust2-radar-base.jpg"
                alt="Dust2 radar reference"
                style={{ opacity: showRadarBackground ? radarOpacity : 0 }}
              />
              <svg className={styles.hexSvg} viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`} role="img" aria-label="50x50 蜂巢格地图编辑器">
                <defs>
                  <marker id="vertical-link-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L6,3 L0,6 Z" className={styles.verticalLinkArrow} />
                  </marker>
                </defs>
                {gridCells.map((item) => {
                  const cell = cellsById.get(item.cellId);
                  const selected = item.cellId === selectedCellId;
                  const className = [
                    styles.hexCell,
                    cell?.playable ? styles.hexCellPlayable : "",
                    cell?.regionId ? styles.hexCellRegion : "",
                    cell?.pointIds.length ? styles.hexCellPoint : "",
                    cell?.regionId && cell.regionId === selectedRegionId ? styles.hexCellActiveRegion : "",
                    cell?.pointIds.includes(selectedPointId) ? styles.hexCellActivePoint : "",
                    cell?.flags.includes(selectedFlag) ? styles.hexCellActiveFlag : "",
                    selected ? styles.hexCellSelected : ""
                  ].filter(Boolean).join(" ");
                  return (
                    <polygon
                      key={item.cellId}
                      points={item.points}
                      className={className}
                      data-testid="hex-cell"
                      data-cell-id={item.cellId}
                      onPointerDown={() => handleCellPointerDown(item.cellId)}
                      onPointerEnter={() => handleCellPointerEnter(item.cellId)}
                    />
                  );
                })}
                {visibleVerticalLinks.map(({ link, from, to, fromCell, toCell }) => (
                  <g key={link.linkId} className={styles.verticalLinkGroup}>
                    <line
                      className={styles.verticalLinkLine}
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      markerEnd={link.oneWay ? "url(#vertical-link-arrow)" : undefined}
                    />
                    <circle className={styles.verticalLinkEndpoint} cx={from.x} cy={from.y} r="3.2" />
                    <circle className={styles.verticalLinkEndpoint} cx={to.x} cy={to.y} r="3.2" />
                    <text className={styles.verticalLinkLabel} x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 4}>
                      {link.linkType} {link.oneWay ? "单向" : "双向"} L{fromCell.level}→L{toCell.level}
                    </text>
                  </g>
                ))}
                {asset?.cells.filter((cell) => cell.level === currentLevel).map((cell) => {
                  const { x, y } = getHexCenter(cell.col, cell.row);
                  const label = getCellShortFlag(cell);
                  if (!label) {
                    return null;
                  }
                  return (
                    <text key={`${cell.cellId}-label`} className={styles.hexLabel} x={x} y={y + 3}>
                      {label}
                    </text>
                  );
                })}
              </svg>
            </div>
          </div>
        </section>

        <aside className={styles.panel}>
          <section>
            <h2>地图完成度</h2>
            <div className={styles.mapStatsGrid}>
              <div className={styles.statCard}>
                <span>可比赛格</span>
                <strong>{mapStats.playableCells}</strong>
              </div>
              <div className={styles.statCard}>
                <span>已分区</span>
                <strong>{mapStats.assignedPlayableCells}</strong>
              </div>
              <div className={styles.statCard}>
                <span>语义未分区</span>
                <strong>{mapStats.unassignedPlayableCells}</strong>
              </div>
              <div className={styles.statCard}>
                <span>路线提示</span>
                <strong>{mapStats.routeHintCount}</strong>
              </div>
              <div className={styles.statCard}>
                <span>跨层连接</span>
                <strong>{mapStats.verticalLinkCount}</strong>
              </div>
              <div className={styles.statCard}>
                <span>层级分布</span>
                <strong>{mapStats.levelSummary || "-"}</strong>
              </div>
            </div>
            <div className={styles.infoBox}>
              <p>50x50 是最大画布，不要求用满。可比赛轮廓越贴近地图，后续寻路和 AP 越可靠。</p>
              <p>playable_cell_without_region 表示“可走但还没写语义区域”的信息提示，不阻止暂存或保存。</p>
              <p>路线提示是参考，不是全量路线清单。正式路径仍由蜂巢邻接、跨层连接和 AP 成本计算。</p>
            </div>
          </section>

          <section>
            <h2>审计概览</h2>
            <details className={styles.issueList} open={selectedVariant === "agent_refined"}>
              <summary>区域 Region（大范围归属，{asset?.regions.length ?? 0}）</summary>
              {asset?.regions.length ? (
                <ul>
                  {asset.regions.map((region) => (
                    <li key={region.regionId}>
                      <strong>{region.nameCn}</strong> / <code>{region.regionId}</code> / {regionTypeLabels[region.regionType]} / {region.cellIds.length} 格
                      <button
                        type="button"
                        className={styles.auditActionButton}
                        onClick={() => {
                          setSelectedRegionId(region.regionId);
                          setMode("region");
                        }}
                      >
                        审计此区域
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className={styles.muted}>暂无区域。</span>
              )}
            </details>
            <details className={styles.issueList} open={selectedVariant === "agent_refined"}>
              <summary>点位 Point（小位置/掩体，{asset?.points.length ?? 0}）</summary>
              {asset?.points.length ? (
                <ul>
                  {asset.points.map((point) => (
                    <li key={point.pointId}>
                      <strong>{point.nameCn}</strong> / <code>{point.pointId}</code> / {pointTypeLabels[point.pointType]} / 父区域 {point.parentRegionId} / {point.cellIds.length} 格
                      <button
                        type="button"
                        className={styles.auditActionButton}
                        onClick={() => {
                          setSelectedPointId(point.pointId);
                          setSelectedRegionId(point.parentRegionId);
                          setMode("point");
                        }}
                      >
                        审计此点位
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className={styles.muted}>暂无点位。</span>
              )}
            </details>
            <details className={styles.issueList} open>
              <summary>标记 Flag（规则功能标签）</summary>
              <ul>
                {flagOptions.map((flag) => (
                  <li key={flag}>
                    <strong>{flagLabels[flag]}</strong> / <code>{flag}</code> / {flagCounts.get(flag) ?? 0} 格
                    <p>{flagDescriptions[flag]}</p>
                    <button
                      type="button"
                      className={styles.auditActionButton}
                      onClick={() => {
                        setSelectedFlag(flag);
                        setMode("flag");
                      }}
                    >
                      审计此标记
                    </button>
                  </li>
                ))}
              </ul>
            </details>
            <details className={styles.issueList} open={selectedVariant === "agent_refined"}>
              <summary>参考路线 Route Hint（{asset?.routeHints.length ?? 0}）</summary>
              {asset?.routeHints.length ? (
                <ul>
                  {asset.routeHints.map((route) => (
                    <li key={route.routeId}>
                      <code>{route.routeId}</code>：{route.fromPointId} → {route.toPointId} / {route.commonUse} / {route.viaCellIds.length} 格
                      {route.notes ? <p>{route.notes}</p> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className={styles.muted}>暂无参考路线；这是允许的，正式路径不依赖人工穷举。</span>
              )}
            </details>
          </section>

          <section>
            <h2>校验 Validation</h2>
            <div className={validation?.ok ? styles.validationOk : styles.validationBad}>
              {validation?.ok ? "通过" : "存在错误"}
            </div>
            <IssueList title="错误" issues={validation?.errors ?? []} />
            <IssueList title="警告" issues={blockingWarningIssues} />
            <IssueList title="信息（不阻止保存）" issues={semanticInfoIssues} />
          </section>

          <section>
            <h2>当前蜂巢格</h2>
            {selectedCell ? (
              <div className={styles.cellDetails}>
                <strong>{selectedCell.cellId}</strong>
                <span>列/行/层：{selectedCell.col} / {selectedCell.row} / {selectedCell.level}</span>
                <span>可比赛：{selectedCell.playable ? "是" : "否"}</span>
                <span>地形：{selectedCell.terrain}</span>
                <span>区域：{selectedCellRegion ? `${selectedCellRegion.nameCn} / ${selectedCellRegion.regionId}` : selectedCell.regionId ?? "-"}</span>
                <span>
                  点位：{selectedCellPoints.length
                    ? selectedCellPoints.map((point) => `${point.nameCn} / ${point.pointId}`).join(", ")
                    : selectedCell.pointIds.join(", ") || "-"}
                </span>
                <span>标记：{selectedCell.flags.map((flag) => `${flagLabels[flag] ?? flag} / ${flag}`).join(", ") || "-"}</span>
              </div>
            ) : (
              <span className={styles.muted}>点击一个蜂巢格查看详情。</span>
            )}
          </section>

          <section>
            <h2>跨层连接列表</h2>
            {asset?.verticalLinks.length ? (
              <ul className={styles.boundaryList}>
                {asset.verticalLinks.map((link) => (
                  <li key={link.linkId}>
                    <code>{link.linkId}</code>：{link.fromCellId} → {link.toCellId} / {link.linkType} / {link.oneWay ? "单向" : "双向"} / AP +{link.apCostModifier}
                  </li>
                ))}
              </ul>
            ) : (
              <span className={styles.muted}>暂无跨层连接。</span>
            )}
          </section>

          <section>
            <h2>边界说明</h2>
            <ul className={styles.boundaryList}>
              <li>不运行比赛。</li>
              <li>不调用 LLM（大语言模型）。</li>
              <li>不接入已冻结的 Node/Sector（节点/区块）运行时。</li>
              <li>保存目标固定为 Dust2 蜂巢草稿。</li>
            </ul>
          </section>
        </aside>
      </section>
    </main>
  );
}

function OperationTarget({
  mode,
  selectedRegion,
  selectedPoint,
  selectedFlag,
  eraserTarget,
  selectedVerticalLinkType,
  selectedVerticalLinkOneWay,
  verticalLinkFromCellId
}: {
  mode: EditorMode;
  selectedRegion: HexRegion | null;
  selectedPoint: HexPoint | null;
  selectedFlag: HexCellFlag;
  eraserTarget: EraserTarget;
  selectedVerticalLinkType: HexVerticalLinkType;
  selectedVerticalLinkOneWay: boolean;
  verticalLinkFromCellId: string;
}) {
  if (mode === "region") {
    return selectedRegion ? (
      <div className={styles.operationTarget}>
        <span>应用目标</span>
        <strong>{selectedRegion.nameCn} / {selectedRegion.regionId}</strong>
        <small>{regionTypeLabels[selectedRegion.regionType]} · 当前点击格子会归入这个区域。</small>
      </div>
    ) : (
      <div className={styles.operationWarning}>区域填色模式未选择区域；点击格子不会写入区域。</div>
    );
  }

  if (mode === "point") {
    return selectedPoint ? (
      <div className={styles.operationTarget}>
        <span>应用目标</span>
        <strong>{selectedPoint.nameCn} / {selectedPoint.pointId}</strong>
        <small>{pointTypeLabels[selectedPoint.pointType]} · 当前点击格子会加入这个点位。</small>
      </div>
    ) : (
      <div className={styles.operationWarning}>点位标注模式未选择点位；点击格子不会写入点位。</div>
    );
  }

  if (mode === "flag") {
    return (
      <div className={styles.operationTarget}>
        <span>应用目标</span>
        <strong>{flagLabels[selectedFlag]} / {selectedFlag}</strong>
        <small>{flagDescriptions[selectedFlag]}</small>
      </div>
    );
  }

  if (mode === "vertical_link") {
    return (
      <div className={styles.operationTarget}>
        <span>应用目标</span>
        <strong>{selectedVerticalLinkType} / {selectedVerticalLinkOneWay ? "单向" : "双向"}</strong>
        <small>{verticalLinkFromCellId ? `起点 ${verticalLinkFromCellId}，下一次点击不同层格子生成连接。` : "先点击一个已绘制格子作为跨层连接起点。"}</small>
      </div>
    );
  }

  if (mode === "eraser") {
    const option = eraserTargetOptions.find((candidate) => candidate.target === eraserTarget);
    return (
      <div className={styles.operationWarning}>
        橡皮擦目标：{option?.label ?? eraserTarget}。{option?.description ?? ""}
      </div>
    );
  }

  if (mode === "inspect") {
    return <div className={styles.operationTarget}><span>应用目标</span><strong>只查看，不修改</strong></div>;
  }

  return <div className={styles.operationTarget}><span>应用目标</span><strong>可比赛格</strong><small>点击格子会创建或保留为可比赛区域。</small></div>;
}

function IssueList({ title, issues }: { title: string; issues: HexMapValidationIssue[] }) {
  return (
    <details className={styles.issueList} open={issues.length > 0}>
      <summary>{title} ({issues.length})</summary>
      {issues.length === 0 ? (
        <span className={styles.muted}>无</span>
      ) : (
        <ul>
          {issues.map((issue, index) => (
            <li key={`${issue.code}-${issue.ref ?? "asset"}-${index}`}>
              <code>{issue.code}</code> {issue.ref ? <span>{issue.ref}</span> : null}
              <p>{issue.message}</p>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function getRegionDisplayName(regions: HexRegion[] | undefined, regionId: string): string {
  const region = regions?.find((candidate) => candidate.regionId === regionId);
  return region ? `${region.nameCn} / ${region.regionId}` : regionId;
}

function getVariantDisplayName(variants: HexEditorMapVariantOption[], variant: HexEditorMapVariant): string {
  return variants.find((item) => item.variant === variant)?.label ?? variant;
}

function toCellId(col: number, row: number, level: HexLevel): string {
  return `h_${String(col).padStart(2, "0")}_${String(row).padStart(2, "0")}_l${level}`;
}

function parseCellId(cellId: string): { col: number; row: number; level: HexLevel } {
  const [, col, row, level] = cellId.match(/^h_(\d{2})_(\d{2})(?:_l(-?1|0))?$/) ?? [];
  return { col: Number(col ?? 0), row: Number(row ?? 0), level: parseHexLevel(level) };
}

function createBlankCell(cellId: string): HexCell {
  const { col, row, level } = parseCellId(cellId);
  return {
    cellId,
    col,
    row,
    level,
    playable: false,
    terrain: "void",
    flags: [],
    pointIds: []
  };
}

function getHexCenter(col: number, row: number): { x: number; y: number } {
  return {
    x: 6 + col * stepX + hexRadius,
    y: 6 + row * stepY + (col % 2 === 1 ? stepY / 2 : 0) + hexRadius
  };
}

function getHexPolygonPoints(cx: number, cy: number): string {
  const points: string[] = [];
  for (let index = 0; index < 6; index += 1) {
    const angle = (Math.PI / 180) * (60 * index);
    points.push(`${(cx + hexRadius * Math.cos(angle)).toFixed(2)},${(cy + hexRadius * Math.sin(angle)).toFixed(2)}`);
  }
  return points.join(" ");
}

function upsertCell(cells: HexCell[], nextCell: HexCell): HexCell[] {
  const exists = cells.some((cell) => cell.cellId === nextCell.cellId);
  return exists ? cells.map((cell) => (cell.cellId === nextCell.cellId ? nextCell : cell)) : [...cells, nextCell];
}

function applyFlagToCellIds(asset: HexMapAsset, cellIds: string[], flag: HexCellFlag): HexMapAsset {
  const targetIds = new Set(cellIds);
  const exclusiveRequired = requiredMapFlags.includes(flag);
  return {
    ...asset,
    cells: asset.cells.map((cell) =>
      targetIds.has(cell.cellId)
        ? {
            ...cell,
            playable: true,
            terrain: "floor",
            flags: addUniqueFlag(
              addUniqueFlag(exclusiveRequired ? cell.flags.filter((candidate) => !requiredMapFlags.includes(candidate)) : cell.flags, "playable"),
              flag
            )
          }
        : cell
    )
  };
}

function eraseCellTarget(
  asset: HexMapAsset,
  cellId: string,
  target: EraserTarget,
  selectedPointId: string,
  selectedFlag: HexCellFlag
): HexMapAsset {
  if (target === "cell") {
    return {
      ...asset,
      cells: asset.cells.filter((candidate) => candidate.cellId !== cellId),
      regions: asset.regions.map((region) => ({
        ...region,
        cellIds: region.cellIds.filter((candidateId) => candidateId !== cellId)
      })),
      points: asset.points.map((point) => ({
        ...point,
        cellIds: point.cellIds.filter((candidateId) => candidateId !== cellId)
      })),
      routeHints: asset.routeHints.map((route) => ({
        ...route,
        viaCellIds: route.viaCellIds.filter((candidateId) => candidateId !== cellId)
      })),
      verticalLinks: asset.verticalLinks.filter((link) => link.fromCellId !== cellId && link.toCellId !== cellId)
    };
  }

  if (target === "region") {
    return {
      ...asset,
      cells: asset.cells.map((cell) => (cell.cellId === cellId ? omitRegionId(cell) : cell)),
      regions: asset.regions.map((region) => ({ ...region, cellIds: region.cellIds.filter((candidateId) => candidateId !== cellId) }))
    };
  }

  if (target === "point") {
    return {
      ...asset,
      cells: asset.cells.map((cell) =>
        cell.cellId === cellId
          ? {
              ...cell,
              pointIds: selectedPointId ? cell.pointIds.filter((pointId) => pointId !== selectedPointId) : []
            }
          : cell
      ),
      points: asset.points.map((point) =>
        !selectedPointId || point.pointId === selectedPointId
          ? { ...point, cellIds: point.cellIds.filter((candidateId) => candidateId !== cellId) }
          : point
      )
    };
  }

  if (target === "flag") {
    return {
      ...asset,
      cells: asset.cells.map((cell) =>
        cell.cellId === cellId ? { ...cell, flags: cell.flags.filter((flag) => flag !== selectedFlag) } : cell
      )
    };
  }

  return {
    ...asset,
    verticalLinks: asset.verticalLinks.filter((link) => link.fromCellId !== cellId && link.toCellId !== cellId)
  };
}

function addUnique<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values : [...values, value];
}

function addUniqueFlag(values: HexCellFlag[], value: HexCellFlag): HexCellFlag[] {
  return values.includes(value) ? values : [...values, value];
}

function normalizeId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}

function getCellShortFlag(cell: HexCell): string {
  const requiredLabels = [
    cell.flags.includes("spawn_t") ? "T" : "",
    cell.flags.includes("spawn_ct") ? "CT" : "",
    cell.flags.includes("bombsite_a") ? "A" : "",
    cell.flags.includes("bombsite_b") ? "B" : ""
  ].filter(Boolean);
  if (requiredLabels.length > 0) return requiredLabels.join("/");
  if (cell.flags.includes("cover")) return "C";
  if (cell.flags.includes("choke")) return "K";
  if (cell.flags.includes("high_risk")) return "!";
  if (cell.flags.includes("route_hint")) return "R";
  return "";
}

function omitRegionId(cell: HexCell): HexCell {
  const { regionId: _regionId, ...rest } = cell;
  return rest;
}

function parseHexLevel(value: string | undefined): HexLevel {
  if (value === "-1") return -1;
  if (value === "1") return 1;
  return 0;
}

function migrateCellId(cellId: string, level: HexLevel): string {
  return /^h_\d{2}_\d{2}$/.test(cellId) ? `${cellId}_l${level}` : cellId;
}

function migrateCellRef(cellId: string): string {
  return /^h_\d{2}_\d{2}$/.test(cellId) ? `${cellId}_l0` : cellId;
}

function normalizeClientAsset(asset: HexMapAsset): HexMapAsset {
  const fallbackLevels: HexLevel[] = [-1, 0, 1];
  const levels: HexLevel[] = asset.levels?.length ? asset.levels : fallbackLevels;
  const defaultLevel: HexLevel = asset.defaultLevel ?? 0;
  return {
    ...asset,
    levels,
    defaultLevel,
    cells: asset.cells.map((cell) => {
      const level = cell.level ?? 0;
      return {
        ...cell,
        level,
        cellId: migrateCellId(cell.cellId, level),
        pointIds: cell.pointIds ?? []
      };
    }),
    regions: asset.regions.map((region) => ({
      ...region,
      cellIds: region.cellIds.map(migrateCellRef)
    })),
    points: asset.points.map((point) => ({
      ...point,
      cellIds: point.cellIds.map(migrateCellRef)
    })),
    routeHints: asset.routeHints.map((route) => ({
      ...route,
      viaCellIds: route.viaCellIds.map(migrateCellRef)
    })),
    verticalLinks: (asset.verticalLinks ?? []).map((link) => ({
      ...link,
      fromCellId: migrateCellRef(link.fromCellId),
      toCellId: migrateCellRef(link.toCellId)
    }))
  };
}
