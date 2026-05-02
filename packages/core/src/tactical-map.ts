export const REQUIRED_TACTICAL_ZONE_IDS = [
  "spawn_a",
  "spawn_b",
  "buyer_mid",
  "conversion_site_a",
  "conversion_site_b",
  "retention_connector",
  "pricing_ramp",
  "token_economy"
] as const;

export type RequiredTacticalZoneId = (typeof REQUIRED_TACTICAL_ZONE_IDS)[number];
export type KnownTacticalMapName = "DUST2" | "INFERNO" | "MIRAGE";
export type TacticalMapName = KnownTacticalMapName | "DEFAULT";
export type TacticalZoneRole = "spawn" | "mid" | "site" | "connector" | "economy" | "utility";
export type TacticalPathType = "attack" | "rotate" | "fallback" | "economy";

export interface TacticalMapLayout {
  mapName: TacticalMapName;
  version: number;
  canvas: {
    width: number;
    height: number;
  };
  zones: TacticalMapZone[];
  connections: TacticalZoneConnection[];
  fallbackZoneId: RequiredTacticalZoneId;
}

export interface TacticalMapZone {
  zoneId: RequiredTacticalZoneId;
  displayName: string;
  role: TacticalZoneRole;
  position: {
    x: number;
    y: number;
  };
  radius: number;
}

export interface TacticalZoneConnection {
  fromZoneId: RequiredTacticalZoneId;
  toZoneId: RequiredTacticalZoneId;
  pathType: TacticalPathType;
}

export interface ResolvedTacticalZone {
  zone: TacticalMapZone;
  requestedZoneId: string;
  weak: boolean;
}

const CANVAS = { width: 1000, height: 640 } as const;

const dust2Layout: TacticalMapLayout = {
  mapName: "DUST2",
  version: 1,
  canvas: CANVAS,
  fallbackZoneId: "buyer_mid",
  zones: [
    zone("spawn_a", "NAV 出发点", "spawn", 120, 520, 44),
    zone("spawn_b", "FUR 出发点", "spawn", 880, 120, 44),
    zone("buyer_mid", "买家中路", "mid", 500, 320, 62),
    zone("conversion_site_a", "转化 A 点", "site", 760, 230, 58),
    zone("conversion_site_b", "转化 B 点", "site", 270, 225, 58),
    zone("retention_connector", "留存连接区", "connector", 510, 210, 46),
    zone("pricing_ramp", "定价斜坡", "utility", 665, 420, 48),
    zone("token_economy", "Token 经济区", "economy", 500, 585, 52)
  ],
  connections: [
    connection("spawn_a", "buyer_mid", "attack"),
    connection("spawn_b", "buyer_mid", "fallback"),
    connection("buyer_mid", "conversion_site_a", "attack"),
    connection("buyer_mid", "conversion_site_b", "attack"),
    connection("conversion_site_a", "retention_connector", "rotate"),
    connection("conversion_site_b", "retention_connector", "rotate"),
    connection("pricing_ramp", "conversion_site_a", "attack"),
    connection("token_economy", "buyer_mid", "economy")
  ]
};

const infernoLayout: TacticalMapLayout = {
  mapName: "INFERNO",
  version: 1,
  canvas: CANVAS,
  fallbackZoneId: "buyer_mid",
  zones: [
    zone("spawn_a", "NAV 出发点", "spawn", 130, 500, 44),
    zone("spawn_b", "FUR 出发点", "spawn", 860, 150, 44),
    zone("buyer_mid", "买家中路", "mid", 470, 345, 60),
    zone("conversion_site_a", "转化 A 点", "site", 740, 170, 58),
    zone("conversion_site_b", "转化 B 点", "site", 725, 500, 58),
    zone("retention_connector", "留存连接区", "connector", 590, 330, 48),
    zone("pricing_ramp", "定价斜坡", "utility", 320, 440, 48),
    zone("token_economy", "Token 经济区", "economy", 500, 585, 52)
  ],
  connections: [
    connection("spawn_a", "pricing_ramp", "attack"),
    connection("pricing_ramp", "buyer_mid", "attack"),
    connection("buyer_mid", "retention_connector", "rotate"),
    connection("retention_connector", "conversion_site_a", "attack"),
    connection("retention_connector", "conversion_site_b", "attack"),
    connection("spawn_b", "retention_connector", "fallback"),
    connection("conversion_site_a", "conversion_site_b", "rotate"),
    connection("token_economy", "pricing_ramp", "economy")
  ]
};

const mirageLayout: TacticalMapLayout = {
  mapName: "MIRAGE",
  version: 1,
  canvas: CANVAS,
  fallbackZoneId: "buyer_mid",
  zones: [
    zone("spawn_a", "NAV 出发点", "spawn", 110, 500, 44),
    zone("spawn_b", "FUR 出发点", "spawn", 880, 145, 44),
    zone("buyer_mid", "买家中路", "mid", 500, 315, 64),
    zone("conversion_site_a", "转化 A 点", "site", 720, 235, 58),
    zone("conversion_site_b", "转化 B 点", "site", 280, 235, 58),
    zone("retention_connector", "留存连接区", "connector", 545, 215, 48),
    zone("pricing_ramp", "定价斜坡", "utility", 650, 450, 48),
    zone("token_economy", "Token 经济区", "economy", 500, 585, 52)
  ],
  connections: [
    connection("spawn_a", "pricing_ramp", "attack"),
    connection("spawn_a", "buyer_mid", "attack"),
    connection("spawn_b", "retention_connector", "fallback"),
    connection("buyer_mid", "retention_connector", "rotate"),
    connection("retention_connector", "conversion_site_a", "attack"),
    connection("buyer_mid", "conversion_site_b", "attack"),
    connection("pricing_ramp", "conversion_site_a", "attack"),
    connection("token_economy", "buyer_mid", "economy")
  ]
};

const defaultLayout: TacticalMapLayout = {
  mapName: "DEFAULT",
  version: 1,
  canvas: CANVAS,
  fallbackZoneId: "buyer_mid",
  zones: [
    zone("spawn_a", "A 队出发点", "spawn", 120, 520, 44),
    zone("spawn_b", "B 队出发点", "spawn", 880, 120, 44),
    zone("buyer_mid", "核心中路", "mid", 500, 320, 62),
    zone("conversion_site_a", "转化 A 点", "site", 760, 230, 58),
    zone("conversion_site_b", "转化 B 点", "site", 270, 230, 58),
    zone("retention_connector", "连接区", "connector", 515, 215, 48),
    zone("pricing_ramp", "准备斜坡", "utility", 650, 440, 48),
    zone("token_economy", "Token 经济区", "economy", 500, 585, 52)
  ],
  connections: [
    connection("spawn_a", "buyer_mid", "attack"),
    connection("spawn_b", "buyer_mid", "fallback"),
    connection("buyer_mid", "conversion_site_a", "attack"),
    connection("buyer_mid", "conversion_site_b", "attack"),
    connection("conversion_site_a", "retention_connector", "rotate"),
    connection("conversion_site_b", "retention_connector", "rotate"),
    connection("pricing_ramp", "conversion_site_a", "attack"),
    connection("token_economy", "buyer_mid", "economy")
  ]
};

const layoutsByName: Record<KnownTacticalMapName, TacticalMapLayout> = {
  DUST2: dust2Layout,
  INFERNO: infernoLayout,
  MIRAGE: mirageLayout
};

export function getTacticalMapLayout(mapName: string): TacticalMapLayout {
  const normalized = mapName.trim().toUpperCase();
  return isKnownTacticalMapName(normalized) ? layoutsByName[normalized] : defaultLayout;
}

export function resolveTacticalZone(layout: TacticalMapLayout, zoneId: string | undefined): ResolvedTacticalZone {
  const requestedZoneId = typeof zoneId === "string" && zoneId.length > 0 ? zoneId : layout.fallbackZoneId;
  const direct = layout.zones.find((zoneItem) => zoneItem.zoneId === requestedZoneId);
  if (direct) {
    return { zone: direct, requestedZoneId, weak: false };
  }

  const fallback = layout.zones.find((zoneItem) => zoneItem.zoneId === layout.fallbackZoneId);
  if (!fallback) {
    throw new Error(`Invalid tactical map layout: missing fallback zone ${layout.fallbackZoneId}.`);
  }

  return { zone: fallback, requestedZoneId, weak: true };
}

function isKnownTacticalMapName(mapName: string): mapName is KnownTacticalMapName {
  return mapName === "DUST2" || mapName === "INFERNO" || mapName === "MIRAGE";
}

function zone(
  zoneId: RequiredTacticalZoneId,
  displayName: string,
  role: TacticalZoneRole,
  x: number,
  y: number,
  radius: number
): TacticalMapZone {
  return { zoneId, displayName, role, position: { x, y }, radius };
}

function connection(fromZoneId: RequiredTacticalZoneId, toZoneId: RequiredTacticalZoneId, pathType: TacticalPathType): TacticalZoneConnection {
  return { fromZoneId, toZoneId, pathType };
}
