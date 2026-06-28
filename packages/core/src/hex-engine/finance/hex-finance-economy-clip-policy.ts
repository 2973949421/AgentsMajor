import { createHash } from "node:crypto";

import type { HexAgentEconomyContext } from "../economy/index.js";
import type {
  HexFinanceClippingTier,
  HexFinanceCombatEffectCap,
  HexFinanceCutMode,
  HexSubmittedFinanceOutput
} from "./hex-submitted-finance-output.js";

export interface HexFinanceClipPolicy {
  tier: HexFinanceClippingTier;
  cutMode: HexFinanceCutMode;
  maxClaims: number;
  maxEvidenceRefsPerClaim: number;
  confidenceCap: number;
  combatEffectCap: HexFinanceCombatEffectCap;
  keepPositiveClaims: boolean;
  submittedTextBudgetChars: number;
  spend: number;
  spendUnit: 50;
  charsPerSpendUnit: number;
  rawBudgetChars: number;
  budgetClampReason: HexSubmittedFinanceOutput["budgetClampReason"];
  budgetSource: "economy_spend";
  cutModeSeed: string;
}

interface EconomyClipTierConfig {
  minChars: number;
  maxChars: number;
  cutMode: HexFinanceCutMode;
  maxClaims: number;
  maxEvidenceRefsPerClaim: number;
  confidenceCap: number;
  combatEffectCap: HexFinanceCombatEffectCap;
  keepPositiveClaims: boolean;
}

const ECONOMY_SPEND_UNIT = 50 as const;

const economyClipTierConfigs: Record<HexFinanceClippingTier, EconomyClipTierConfig> = {
  high_full: { minChars: 500, maxChars: 580, cutMode: "multi_slice_plus", maxClaims: 3, maxEvidenceRefsPerClaim: 3, confidenceCap: 0.9, combatEffectCap: "possible_kill", keepPositiveClaims: true },
  rifle_full: { minChars: 380, maxChars: 450, cutMode: "multi_slice", maxClaims: 3, maxEvidenceRefsPerClaim: 3, confidenceCap: 0.9, combatEffectCap: "possible_kill", keepPositiveClaims: true },
  half: { minChars: 150, maxChars: 320, cutMode: "core_window", maxClaims: 2, maxEvidenceRefsPerClaim: 2, confidenceCap: 0.72, combatEffectCap: "possible_wound", keepPositiveClaims: true },
  force: { minChars: 200, maxChars: 280, cutMode: "multi_slice_lite", maxClaims: 1, maxEvidenceRefsPerClaim: 1, confidenceCap: 0.6, combatEffectCap: "forced_back", keepPositiveClaims: true },
  light: { minChars: 110, maxChars: 180, cutMode: "core_window", maxClaims: 1, maxEvidenceRefsPerClaim: 1, confidenceCap: 0.55, combatEffectCap: "suppression", keepPositiveClaims: true },
  pistol: { minChars: 80, maxChars: 110, cutMode: "pistol_core_window", maxClaims: 1, maxEvidenceRefsPerClaim: 1, confidenceCap: 0.55, combatEffectCap: "suppression", keepPositiveClaims: true },
  eco: { minChars: 40, maxChars: 90, cutMode: "random_window", maxClaims: 1, maxEvidenceRefsPerClaim: 1, confidenceCap: 0.45, combatEffectCap: "weak_pressure", keepPositiveClaims: true },
  save: { minChars: 40, maxChars: 60, cutMode: "front_cut", maxClaims: 0, maxEvidenceRefsPerClaim: 0, confidenceCap: 0.35, combatEffectCap: "minor_delay", keepPositiveClaims: false }
};

export function buildFinanceClipPolicy(economy: HexAgentEconomyContext | undefined): HexFinanceClipPolicy {
  const tier = classifyClippingTier(economy);
  const config = economyClipTierConfigs[tier];
  const spend = Math.max(0, Math.floor(economy?.spend ?? defaultSpendForTier(tier)));
  const charsPerSpendUnit = tier === "pistol" ? 6 : 4;
  const rawBudgetChars = Math.floor(spend / ECONOMY_SPEND_UNIT) * charsPerSpendUnit;
  const submittedTextBudgetChars = Math.max(config.minChars, Math.min(config.maxChars, rawBudgetChars));
  const budgetClampReason: HexFinanceClipPolicy["budgetClampReason"] = !economy
    ? "fallback_no_economy"
    : rawBudgetChars < config.minChars
      ? "raised_to_tier_min"
      : rawBudgetChars > config.maxChars
        ? "capped_to_tier_max"
        : "within_tier";
  return {
    tier,
    cutMode: config.cutMode,
    maxClaims: config.maxClaims,
    maxEvidenceRefsPerClaim: config.maxEvidenceRefsPerClaim,
    confidenceCap: config.confidenceCap,
    combatEffectCap: config.combatEffectCap,
    keepPositiveClaims: config.keepPositiveClaims,
    submittedTextBudgetChars,
    spend,
    spendUnit: ECONOMY_SPEND_UNIT,
    charsPerSpendUnit,
    rawBudgetChars,
    budgetClampReason,
    budgetSource: "economy_spend",
    cutModeSeed: stableHash({ agentId: economy?.agentId ?? "unknown_agent", tier, posture: economy?.economyPosture ?? "unknown_posture", buyType: economy?.buyType ?? "unknown_buy", spend })
  };
}

function classifyClippingTier(economy: HexAgentEconomyContext | undefined): HexFinanceClippingTier {
  const economyPosture = economy?.economyPosture;
  const buyType = economy?.buyType;
  if (economyPosture === "pistol_round") return "pistol";
  if (economyPosture === "awp_buy" || economyPosture === "double_awp") return "high_full";
  if (economyPosture === "rifle_buy" || (!economyPosture && buyType === "fullBuy")) return "rifle_full";
  if (economyPosture === "bonus_round" || economyPosture === "half_buy" || (!economyPosture && buyType === "halfBuy")) return "half";
  if (economyPosture === "force_buy" || economyPosture === "broken_buy" || (!economyPosture && buyType === "forceBuy")) return "force";
  if (economyPosture === "light_buy" || economyPosture === "pistol_armor_force") return "light";
  if (economyPosture === "full_eco" || economyPosture === "save_play" || (!economyPosture && buyType === "save")) return "save";
  return "eco";
}

function defaultSpendForTier(tier: HexFinanceClippingTier): number {
  switch (tier) {
    case "high_full": return 7000;
    case "rifle_full": return 5200;
    case "half": return 2800;
    case "force": return 3000;
    case "light": return 1800;
    case "pistol": return 800;
    case "eco": return 400;
    case "save": return 600;
  }
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}
