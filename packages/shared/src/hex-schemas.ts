import { z } from "zod";

const nonEmptyString = z.string().min(1);
const hexGridCoordinateValueSchema = z.number().int().min(0).max(49);
export const hexLevelSchema = z.union([z.literal(-1), z.literal(0), z.literal(1)]);
export type HexLevel = z.infer<typeof hexLevelSchema>;

export const hexCoordinateSchema = z.object({
  col: hexGridCoordinateValueSchema,
  row: hexGridCoordinateValueSchema
});
export type HexCoordinate = z.infer<typeof hexCoordinateSchema>;

export const hexTerrainSchema = z.enum(["floor", "obstacle", "wall", "void"]);
export type HexTerrain = z.infer<typeof hexTerrainSchema>;

export const hexCellFlagSchema = z.enum([
  "playable",
  "spawn_t",
  "spawn_ct",
  "bombsite_a",
  "bombsite_b",
  "cover",
  "choke",
  "high_risk",
  "route_hint",
  "draft_unassigned_region"
]);
export type HexCellFlag = z.infer<typeof hexCellFlagSchema>;

export const hexRegionTypeSchema = z.enum([
  "a_site",
  "b_site",
  "mid",
  "long",
  "tunnel",
  "spawn",
  "rotate",
  "connector",
  "other"
]);
export type HexRegionType = z.infer<typeof hexRegionTypeSchema>;

export const hexPointTypeSchema = z.enum([
  "spawn",
  "bombsite",
  "choke",
  "cover",
  "angle",
  "default",
  "route",
  "utility",
  "other"
]);
export type HexPointType = z.infer<typeof hexPointTypeSchema>;

export const hexCommonRouteUseSchema = z.enum([
  "default",
  "execute",
  "retake",
  "rotate",
  "save",
  "lurk",
  "fake",
  "utility"
]);
export type HexCommonRouteUse = z.infer<typeof hexCommonRouteUseSchema>;

export const hexCellSchema = z.object({
  cellId: nonEmptyString,
  col: hexGridCoordinateValueSchema,
  row: hexGridCoordinateValueSchema,
  level: hexLevelSchema,
  playable: z.boolean(),
  terrain: hexTerrainSchema,
  flags: z.array(hexCellFlagSchema).default([]),
  regionId: nonEmptyString.optional(),
  pointIds: z.array(nonEmptyString).default([])
});
export type HexCell = z.infer<typeof hexCellSchema>;

export const hexRegionSchema = z.object({
  regionId: nonEmptyString,
  nameCn: nonEmptyString,
  nameEn: nonEmptyString,
  regionType: hexRegionTypeSchema,
  cellIds: z.array(nonEmptyString).min(1),
  businessSemantics: nonEmptyString.optional()
});
export type HexRegion = z.infer<typeof hexRegionSchema>;

export const hexPointSchema = z.object({
  pointId: nonEmptyString,
  nameCn: nonEmptyString,
  nameEn: nonEmptyString,
  pointType: hexPointTypeSchema,
  parentRegionId: nonEmptyString,
  cellIds: z.array(nonEmptyString).min(1)
});
export type HexPoint = z.infer<typeof hexPointSchema>;

export const hexRouteHintSchema = z.object({
  routeId: nonEmptyString,
  fromPointId: nonEmptyString,
  toPointId: nonEmptyString,
  viaCellIds: z.array(nonEmptyString).min(1),
  commonUse: hexCommonRouteUseSchema,
  notes: nonEmptyString.optional()
});
export type HexRouteHint = z.infer<typeof hexRouteHintSchema>;

export const hexVerticalLinkTypeSchema = z.enum(["stairs", "ramp", "ladder", "drop", "jump"]);
export type HexVerticalLinkType = z.infer<typeof hexVerticalLinkTypeSchema>;

export const hexVerticalLinkSchema = z.object({
  linkId: nonEmptyString,
  fromCellId: nonEmptyString,
  toCellId: nonEmptyString,
  linkType: hexVerticalLinkTypeSchema,
  apCostModifier: z.number().min(0),
  oneWay: z.boolean(),
  notes: nonEmptyString.optional()
});
export type HexVerticalLink = z.infer<typeof hexVerticalLinkSchema>;

export const hexMapGridSchema = z.object({
  width: z.literal(50),
  height: z.literal(50),
  coordinateSystem: z.literal("col_row"),
  origin: z.literal("top_left")
});
export type HexMapGrid = z.infer<typeof hexMapGridSchema>;

export const hexMapApModelSchema = z.object({
  baseApPerPhase: z.literal(3),
  minAp: z.literal(0),
  cellsPerAp: z.literal(10),
  allowFractionalAp: z.literal(true),
  resetsEachPhase: z.literal(true)
});
export type HexMapApModel = z.infer<typeof hexMapApModelSchema>;

export const hexMapAssetSchema = z.object({
  schemaVersion: z.literal(1),
  mapSlug: nonEmptyString,
  displayName: nonEmptyString,
  grid: hexMapGridSchema,
  apModel: hexMapApModelSchema,
  levels: z.array(hexLevelSchema).nonempty(),
  defaultLevel: hexLevelSchema,
  cells: z.array(hexCellSchema).min(1),
  regions: z.array(hexRegionSchema),
  points: z.array(hexPointSchema),
  routeHints: z.array(hexRouteHintSchema).default([]),
  verticalLinks: z.array(hexVerticalLinkSchema).default([]),
  notes: z.array(nonEmptyString).default([])
});
export type HexMapAsset = z.infer<typeof hexMapAssetSchema>;
