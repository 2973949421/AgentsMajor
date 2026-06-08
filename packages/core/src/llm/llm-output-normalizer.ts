import { economyPostures, loadoutPackages, type EconomyPosture, type LoadoutPackage } from "@agent-major/shared";

import { REQUIRED_TACTICAL_ZONE_IDS } from "../match/tactical-map.js";

export function sanitizeLlmPayload(value: unknown): unknown {
  if (value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value.trim().length > 0 ? value : undefined;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeLlmPayload(item))
      .filter((item) => item !== undefined);
  }
  const record = readUnknownRecord(value);
  if (!record) {
    return value;
  }
  const entries = Object.entries(record)
    .map(([key, item]) => [key, sanitizeLlmPayload(item)] as const)
    .filter(([, item]) => {
      if (item === undefined) {
        return false;
      }
      const itemRecord = readUnknownRecord(item);
      return !(itemRecord && Object.keys(itemRecord).length === 0);
    });
  return Object.fromEntries(entries);
}

export function normalizeLlmEconomyPosture(value: unknown): EconomyPosture | undefined {
  const text = normalizeEnumText(value);
  if (!text) {
    return undefined;
  }
  if ((economyPostures as readonly string[]).includes(text)) {
    return text as EconomyPosture;
  }

  const alias: Record<string, EconomyPosture> = {
    pistol: "pistol_round",
    pistolbuy: "pistol_round",
    pistol_buy: "pistol_round",
    pistolround: "pistol_round",
    pistol_retain: "pistol_round",
    pistolretain: "pistol_round",
    halfbuy: "half_buy",
    half_buy: "half_buy",
    fullbuy: "rifle_buy",
    full_buy: "rifle_buy",
    rifle: "rifle_buy",
    riflebuy: "rifle_buy",
    rifle_buy: "rifle_buy",
    forcebuy: "force_buy",
    force_buy: "force_buy",
    save: "save_play",
    saveplay: "save_play",
    save_play: "save_play",
    eco_round: "eco",
    fullsave: "full_eco",
    full_eco: "full_eco"
  };
  return alias[text] ?? alias[toCompactEnumKey(text)];
}

export function normalizeLlmLoadoutPackage(value: unknown): LoadoutPackage | undefined {
  const text = normalizeEnumText(value);
  if (!text) {
    return undefined;
  }
  if ((loadoutPackages as readonly string[]).includes(text)) {
    return text as LoadoutPackage;
  }
  return undefined;
}

export function normalizeKnownTacticalZoneId(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : undefined;
  if (!text) {
    return undefined;
  }
  if ((REQUIRED_TACTICAL_ZONE_IDS as readonly string[]).includes(text)) {
    return text;
  }
  const normalized = text
    .toLowerCase()
    .replace(/[（）()]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/点/g, "")
    .replace(/區/g, "区");
  const compact = normalized.replace(/_/g, "");
  if (
    [
      "zone_a",
      "zone_a_main",
      "zone_a_small",
      "zone_bomb_site_a",
      "bomb_site_a",
      "site_a",
      "a_site",
      "a_main",
      "amain",
      "asite",
      "a"
    ].includes(normalized) ||
    ["a", "amain", "asite", "zonebombsitea", "bombsitea"].includes(compact)
  ) {
    return "conversion_site_a";
  }
  if (
    [
      "zone_b",
      "zone_b_main",
      "zone_b_site",
      "zone_b_short",
      "zone_bomb_site_b",
      "bomb_site_b",
      "site_b",
      "b_site",
      "b_main",
      "bmain",
      "bsite",
      "b"
    ].includes(normalized) ||
    ["b", "bmain", "bsite", "zonebsite", "zonebombsiteb", "bombsiteb"].includes(compact)
  ) {
    return "conversion_site_b";
  }
  if (["zone_mid", "mid", "middle", "mid_lane", "buyer_mid", "中路", "中门"].includes(normalized) || compact === "mid") {
    return "buyer_mid";
  }
  if (["a_long", "long_a", "long", "pricing_ramp", "zone_pricing_ramp", "zone_a_pricing_ramp", "ramp", "坡道", "a大", "大坑"].includes(normalized)) {
    return "pricing_ramp";
  }
  if (["a_short", "short_a", "short", "catwalk", "retention_connector", "connector", "连接", "a小"].includes(normalized)) {
    return "retention_connector";
  }
  if (["b_tunnel", "b_tunnels", "tunnel", "tunnels", "token_economy", "b洞", "洞"].includes(normalized)) {
    return "token_economy";
  }
  if (["t_spawn", "spawn_t", "spawn_a", "t出生点"].includes(normalized)) {
    return "spawn_a";
  }
  if (["ct_spawn", "spawn_ct", "spawn_b", "ct出生点"].includes(normalized)) {
    return "spawn_b";
  }
  return undefined;
}

function normalizeEnumText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase() : undefined;
}

function toCompactEnumKey(value: string): string {
  return value.replace(/[^a-z0-9]+/g, "");
}

function readUnknownRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
