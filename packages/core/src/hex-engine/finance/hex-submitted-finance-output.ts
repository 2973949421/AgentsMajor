import { createHash } from "node:crypto";

import { HEX_ROUND_START_RAW_OPINION_TARGETS } from "../action/hex-round-start-agent-output.js";

import type {
  HexFinanceChallengeCard,
  HexFinanceCoreClaim,
  HexFinanceStanceCard,
  HexRoundStartAgentOutputForAction
} from "../action/hex-round-start-agent-output.js";
import type { HexAgentEconomyContext, HexRoundEconomyContext } from "../economy/index.js";
import type { HexRoundFinanceDuel } from "./hex-round-finance-duel.js";

export type HexFinanceCombatEffectCap =
  | "none"
  | "minor_delay"
  | "weak_pressure"
  | "suppression"
  | "forced_back"
  | "possible_wound"
  | "possible_kill";

export type HexFinanceClippingTier = "high_full" | "rifle_full" | "half" | "force" | "light" | "pistol" | "eco" | "save";
export type HexFinanceCutMode =
  | "front_cut"
  | "tiny_random_window"
  | "random_window"
  | "pistol_core_window"
  | "core_window"
  | "random_core_window"
  | "multi_slice_lite"
  | "multi_slice"
  | "multi_slice_plus";

export type HexSubmittedFinanceTextSpanKind = "kept" | "omitted" | "capped" | "blocked";
export type HexSubmittedFinanceRawOpinionLinkStatus = "linked" | "partial" | "unlinked" | "legacy_missing";

export interface HexSubmittedFinanceTextSpanRef {
  start: number;
  end: number;
  kind: HexSubmittedFinanceTextSpanKind;
  sourceRef: string;
  reasonZh: string;
}

export interface HexSubmittedFinanceUnlocatedItem {
  sourceRef: string;
  text: string;
  reasonZh: string;
}

export interface HexSubmittedFinanceOutput {
  submittedOutputId: string;
  rawOutputId: string;
  agentId: string;
  cardKind: "stance" | "challenge";
  submittedStanceCard?: HexFinanceStanceCard | undefined;
  submittedChallengeCard?: HexFinanceChallengeCard | undefined;
  rawFinanceOpinionZh?: string | undefined;
  submittedOpinionZh?: string | undefined;
  rawOpinionCharCount: number;
  rawOpinionTargetMinChars: number;
  rawOpinionTargetMaxChars: number;
  rawOpinionUnderTarget: boolean;
  submittedOpinionCharCount: number;
  submittedBudgetChars: number;
  submittedBudgetUtilization: number;
  rawOpinionUnderfilled: boolean;
  submittedTextBudgetChars: number;
  submittedTextSpanRefs: HexSubmittedFinanceTextSpanRef[];
  rawOpinionLinkStatus: HexSubmittedFinanceRawOpinionLinkStatus;
  unlocatedSubmittedItems: HexSubmittedFinanceUnlocatedItem[];
  buyType: string;
  economyPosture: string;
  loadoutPackage: string;
  outputBudget: number;
  clippingTier: HexFinanceClippingTier;
  economyClipVersion: "finance_economy_clip_v1";
  economyClipTier: HexFinanceClippingTier;
  spend: number;
  spendUnit: 50;
  charsPerSpendUnit: number;
  rawBudgetChars: number;
  cutMode: HexFinanceCutMode;
  cutModeSeed: string;
  budgetClampReason: "within_tier" | "raised_to_tier_min" | "capped_to_tier_max" | "fallback_no_economy";
  budgetSource: "economy_spend";
  combatEffectCap: HexFinanceCombatEffectCap;
  judgeInputRef: string;
  factBankSnapshotId: string;
  decisionQuestionId: string;
  evidenceMenuVersion: string;
  clippingPolicyVersion: "finance_output_gate_v1";
  omittedFields: string[];
  cappedFields: string[];
  orphanedChallenge?: boolean | undefined;
  rawFingerprint: string;
  submittedFingerprint: string;
  rawParseStatus: string;
  submittedUsableForJudge: boolean;
  submittedUsableForCombat: boolean;
  gateSummary: string;
}

export interface BuildSubmittedFinanceOutputsInput {
  financeDuel: HexRoundFinanceDuel;
  economyContext?: HexRoundEconomyContext | undefined;
  roundStartAgentOutputs: readonly HexRoundStartAgentOutputForAction[];
}

interface ClipPolicy {
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

interface ClipResult<TCard> {
  card?: TCard | undefined;
  omittedFields: string[];
  cappedFields: string[];
  orphanedChallenge?: boolean | undefined;
  usableForJudge: boolean;
  usableForCombat: boolean;
}

export function buildSubmittedFinanceOutputs(input: BuildSubmittedFinanceOutputsInput): HexSubmittedFinanceOutput[] {
  const submittedStances: HexSubmittedFinanceOutput[] = [];
  const usableRawOutputs = input.roundStartAgentOutputs.filter(isUsableFinanceCardOutput);

  for (const output of usableRawOutputs.filter((candidate) => candidate.cardKind === "stance")) {
    const economy = findEconomy(input.economyContext, output.agentId);
    const policy = buildClipPolicy(economy);
    submittedStances.push(buildSubmittedFinanceOutput({
      financeDuel: input.financeDuel,
      rawOutput: output,
      economy,
      policy,
      submittedClaimIds: new Set()
    }));
  }

  const submittedClaimIds = new Set(
    submittedStances.flatMap((output) =>
      output.submittedStanceCard?.coreClaims.map((claim) => claim.claimId) ?? []
    )
  );
  const submittedChallenges = usableRawOutputs
    .filter((candidate) => candidate.cardKind === "challenge")
    .map((output) => {
      const economy = findEconomy(input.economyContext, output.agentId);
      const policy = buildClipPolicy(economy);
      return buildSubmittedFinanceOutput({
        financeDuel: input.financeDuel,
        rawOutput: output,
        economy,
        policy,
        submittedClaimIds
      });
    });

  return [...submittedStances, ...submittedChallenges];
}

export function isSubmittedFinanceOutputUsableForJudge(output: HexSubmittedFinanceOutput): boolean {
  return output.submittedUsableForJudge && (Boolean(output.submittedStanceCard) || Boolean(output.submittedChallengeCard));
}

function buildSubmittedFinanceOutput(input: {
  financeDuel: HexRoundFinanceDuel;
  rawOutput: HexRoundStartAgentOutputForAction;
  economy: HexAgentEconomyContext | undefined;
  policy: ClipPolicy;
  submittedClaimIds: Set<string>;
}): HexSubmittedFinanceOutput {
  const base = buildBaseSubmittedOutput(input);
  if (input.rawOutput.cardKind === "stance" && input.rawOutput.stanceCard) {
    const clipped = clipStanceCard(input.rawOutput.stanceCard, input.policy);
    const textClip = buildSubmittedOpinionClip({
      rawOpinion: input.rawOutput.rawFinanceOpinionZh,
      submittedTerms: clipped.card ? collectStanceTextTerms(clipped.card, "kept") : [],
      rawTerms: collectStanceTextTerms(input.rawOutput.stanceCard, "omitted"),
      blockedTerms: [],
      cappedFields: clipped.cappedFields,
      budgetChars: input.policy.submittedTextBudgetChars,
      cutMode: input.policy.cutMode,
      cutModeSeed: input.policy.cutModeSeed
    });
    const output = {
      ...base,
      ...textClip,
      ...buildOpinionLengthAudit(input.rawOutput, input.policy, textClip),
      submittedStanceCard: clipped.card,
      omittedFields: clipped.omittedFields,
      cappedFields: clipped.cappedFields,
      submittedUsableForJudge: clipped.usableForJudge,
      submittedUsableForCombat: clipped.usableForCombat,
      gateSummary: buildGateSummary(input.rawOutput, input.policy, clipped)
    };
    return {
      ...output,
      submittedFingerprint: stableHash(output)
    };
  }
  if (input.rawOutput.cardKind === "challenge" && input.rawOutput.challengeCard) {
    const clipped = clipChallengeCard(input.rawOutput.challengeCard, input.policy, input.submittedClaimIds);
    const textClip = buildSubmittedOpinionClip({
      rawOpinion: input.rawOutput.rawFinanceOpinionZh,
      submittedTerms: clipped.card ? collectChallengeTextTerms(clipped.card, "kept") : [],
      rawTerms: collectChallengeTextTerms(input.rawOutput.challengeCard, "omitted"),
      blockedTerms: clipped.orphanedChallenge && clipped.card ? [{
        text: clipped.card.targetClaimId,
        sourceRef: `challenge.targetClaimId:${clipped.card.targetClaimId}`,
        kind: "blocked",
        reasonZh: "targetClaimId 已在 submitted stance 中被裁掉，不能进入有效挑战。"
      }] : [],
      cappedFields: clipped.cappedFields,
      budgetChars: input.policy.submittedTextBudgetChars,
      cutMode: input.policy.cutMode,
      cutModeSeed: input.policy.cutModeSeed
    });
    const output = {
      ...base,
      ...textClip,
      ...buildOpinionLengthAudit(input.rawOutput, input.policy, textClip),
      submittedChallengeCard: clipped.card,
      omittedFields: clipped.omittedFields,
      cappedFields: clipped.cappedFields,
      ...(clipped.orphanedChallenge ? { orphanedChallenge: true } : {}),
      submittedUsableForJudge: clipped.usableForJudge,
      submittedUsableForCombat: clipped.usableForCombat,
      gateSummary: buildGateSummary(input.rawOutput, input.policy, clipped)
    };
    return {
      ...output,
      submittedFingerprint: stableHash(output)
    };
  }

  const output = {
    ...base,
    ...buildSubmittedOpinionClip({
      rawOpinion: input.rawOutput.rawFinanceOpinionZh,
      submittedTerms: [],
      rawTerms: [],
      blockedTerms: [],
      cappedFields: [],
      budgetChars: input.policy.submittedTextBudgetChars,
      cutMode: input.policy.cutMode,
      cutModeSeed: input.policy.cutModeSeed
    }),
    omittedFields: ["missing_card"],
    cappedFields: [],
    submittedUsableForJudge: false,
    submittedUsableForCombat: false,
    gateSummary: `Finance Output Gate 未发现可提交 ${input.rawOutput.cardKind} card。`
  };
  return {
    ...output,
    submittedFingerprint: stableHash(output)
  };
}

function buildBaseSubmittedOutput(input: {
  financeDuel: HexRoundFinanceDuel;
  rawOutput: HexRoundStartAgentOutputForAction;
  economy: HexAgentEconomyContext | undefined;
  policy: ClipPolicy;
}): Omit<
  HexSubmittedFinanceOutput,
  | "submittedOpinionZh"
  | "submittedTextBudgetChars"
  | "submittedTextSpanRefs"
  | "rawOpinionLinkStatus"
  | "unlocatedSubmittedItems"
  | "submittedFingerprint"
  | "omittedFields"
  | "cappedFields"
  | "submittedUsableForJudge"
  | "submittedUsableForCombat"
  | "gateSummary"
> {
  const aggregatePath = input.financeDuel.evidencePackRef.aggregateEvidencePath;
  const evidenceMenuVersion = input.financeDuel.evidencePackRef.generatedAt || stableHash(aggregatePath || input.financeDuel.topic.roundKey);
  return {
    submittedOutputId: `sub_fin_${input.rawOutput.outputId}`,
    rawOutputId: input.rawOutput.outputId,
    agentId: input.rawOutput.agentId,
    cardKind: input.rawOutput.cardKind!,
    buyType: input.economy?.buyType ?? "eco",
    economyPosture: input.economy?.economyPosture ?? "eco",
    loadoutPackage: input.economy?.loadoutPackage ?? "unknown_loadout",
    outputBudget: input.economy?.outputBudget ?? 360,
    clippingTier: input.policy.tier,
    economyClipVersion: "finance_economy_clip_v1",
    economyClipTier: input.policy.tier,
    spend: input.policy.spend,
    spendUnit: input.policy.spendUnit,
    charsPerSpendUnit: input.policy.charsPerSpendUnit,
    rawBudgetChars: input.policy.rawBudgetChars,
    cutMode: input.policy.cutMode,
    cutModeSeed: input.policy.cutModeSeed,
    budgetClampReason: input.policy.budgetClampReason,
    budgetSource: input.policy.budgetSource,
    rawFinanceOpinionZh: input.rawOutput.rawFinanceOpinionZh,
    ...buildOpinionLengthAudit(input.rawOutput, input.policy, { submittedOpinionZh: undefined }),
    combatEffectCap: input.policy.combatEffectCap,
    judgeInputRef: `submitted_finance:${input.rawOutput.outputId}`,
    factBankSnapshotId: aggregatePath || "unknown_snapshot",
    decisionQuestionId: `${input.financeDuel.roundNumber}:${input.financeDuel.topic.roundKey}`,
    evidenceMenuVersion,
    clippingPolicyVersion: "finance_output_gate_v1",
    rawFingerprint: stableHash(input.rawOutput),
    rawParseStatus: input.rawOutput.usableForPhaseAction ? "usable_raw_card" : "unusable_raw_card"
  };
}

function clipStanceCard(card: HexFinanceStanceCard, policy: ClipPolicy): ClipResult<HexFinanceStanceCard> {
  const omittedFields: string[] = [];
  const cappedFields: string[] = [];
  const rawClaims = orderByExplicitPriority(card.coreClaims);
  const keptClaims = policy.keepPositiveClaims
    ? rawClaims.slice(0, policy.maxClaims).map((claim, index) => clipClaim(claim, policy, index, omittedFields, cappedFields))
    : [];
  if (policy.keepPositiveClaims && rawClaims.length > keptClaims.length) {
    omittedFields.push(`coreClaims:${rawClaims.length - keptClaims.length}`);
  }
  if (!policy.keepPositiveClaims && rawClaims.length > 0) {
    omittedFields.push(`coreClaims:${rawClaims.length}`);
  }

  const confidence = capNumber(card.confidence, policy.confidenceCap, "stanceCard.confidence", cappedFields);
  const clippedCard: HexFinanceStanceCard = {
    ...card,
    confidence,
    coreClaims: keptClaims,
    riskBoundaries: [...card.riskBoundaries],
    invalidatingConditions: [...card.invalidatingConditions]
  };

  return {
    card: clippedCard,
    omittedFields,
    cappedFields,
    usableForJudge: true,
    usableForCombat: keptClaims.length > 0 && policy.combatEffectCap !== "minor_delay" && policy.combatEffectCap !== "none"
  };
}

function clipClaim(
  claim: HexFinanceCoreClaim,
  policy: ClipPolicy,
  index: number,
  omittedFields: string[],
  cappedFields: string[]
): HexFinanceCoreClaim {
  const evidenceRefs = orderRefsByExplicitPriority(claim.evidenceRefs)
    .slice(0, policy.maxEvidenceRefsPerClaim);
  if (claim.evidenceRefs.length > evidenceRefs.length) {
    omittedFields.push(`coreClaims[${index}].evidenceRefs:${claim.evidenceRefs.length - evidenceRefs.length}`);
  }
  return {
    ...claim,
    evidenceRefs,
    confidence: capNumber(claim.confidence, policy.confidenceCap, `coreClaims[${index}].confidence`, cappedFields)
  };
}

function clipChallengeCard(
  card: HexFinanceChallengeCard,
  policy: ClipPolicy,
  submittedClaimIds: Set<string>
): ClipResult<HexFinanceChallengeCard> {
  const omittedFields: string[] = [];
  const cappedFields: string[] = [];
  const orphanedChallenge = !submittedClaimIds.has(card.targetClaimId);
  const rawChallenges = orderByExplicitPriority(card.challenges);
  const keptChallenges = rawChallenges.slice(0, Math.min(policy.maxClaims, 1)).map((challenge, index) => {
    const evidenceRefs = orderRefsByExplicitPriority(challenge.evidenceRefs).slice(0, policy.maxEvidenceRefsPerClaim);
    if (challenge.evidenceRefs.length > evidenceRefs.length) {
      omittedFields.push(`challenges[${index}].evidenceRefs:${challenge.evidenceRefs.length - evidenceRefs.length}`);
    }
    return {
      ...challenge,
      evidenceRefs
    };
  });
  if (rawChallenges.length > keptChallenges.length) {
    omittedFields.push(`challenges:${rawChallenges.length - keptChallenges.length}`);
  }
  const evidenceRefs = orderRefsByExplicitPriority(card.evidenceRefs).slice(0, policy.maxEvidenceRefsPerClaim);
  if (card.evidenceRefs.length > evidenceRefs.length) {
    omittedFields.push(`challengeCard.evidenceRefs:${card.evidenceRefs.length - evidenceRefs.length}`);
  }
  const confidenceReduction = capNumber(card.confidenceReduction, policy.confidenceCap, "challengeCard.confidenceReduction", cappedFields);
  const clippedCard: HexFinanceChallengeCard = {
    ...card,
    evidenceRefs,
    confidenceReduction,
    challenges: keptChallenges
  };

  return {
    card: clippedCard,
    omittedFields,
    cappedFields,
    orphanedChallenge,
    usableForJudge: true,
    usableForCombat: !orphanedChallenge && policy.combatEffectCap !== "minor_delay" && policy.combatEffectCap !== "none"
  };
}

function buildClipPolicy(economy: HexAgentEconomyContext | undefined): ClipPolicy {
  const tier = classifyClippingTier(economy);
  const config = economyClipTierConfigs[tier];
  const spend = Math.max(0, Math.floor(economy?.spend ?? defaultSpendForTier(tier)));
  const charsPerSpendUnit = tier === "pistol" ? 6 : 4;
  const rawBudgetChars = Math.floor(spend / ECONOMY_SPEND_UNIT) * charsPerSpendUnit;
  const submittedTextBudgetChars = Math.max(config.minChars, Math.min(config.maxChars, rawBudgetChars));
  const budgetClampReason: ClipPolicy["budgetClampReason"] = !economy
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
  save: { minChars: 40, maxChars: 60, cutMode: "front_cut", maxClaims: 0, maxEvidenceRefsPerClaim: 0, confidenceCap: 0.35, combatEffectCap: "minor_delay", keepPositiveClaims: false },
  eco: { minChars: 40, maxChars: 90, cutMode: "random_window", maxClaims: 1, maxEvidenceRefsPerClaim: 1, confidenceCap: 0.45, combatEffectCap: "weak_pressure", keepPositiveClaims: true },
  pistol: { minChars: 80, maxChars: 110, cutMode: "pistol_core_window", maxClaims: 1, maxEvidenceRefsPerClaim: 1, confidenceCap: 0.55, combatEffectCap: "suppression", keepPositiveClaims: true },
  light: { minChars: 110, maxChars: 180, cutMode: "core_window", maxClaims: 1, maxEvidenceRefsPerClaim: 1, confidenceCap: 0.6, combatEffectCap: "suppression", keepPositiveClaims: true },
  force: { minChars: 200, maxChars: 280, cutMode: "multi_slice_lite", maxClaims: 1, maxEvidenceRefsPerClaim: 1, confidenceCap: 0.6, combatEffectCap: "forced_back", keepPositiveClaims: true },
  half: { minChars: 150, maxChars: 320, cutMode: "core_window", maxClaims: 2, maxEvidenceRefsPerClaim: 2, confidenceCap: 0.75, combatEffectCap: "possible_wound", keepPositiveClaims: true },
  rifle_full: { minChars: 380, maxChars: 450, cutMode: "multi_slice", maxClaims: 3, maxEvidenceRefsPerClaim: 3, confidenceCap: 0.9, combatEffectCap: "possible_kill", keepPositiveClaims: true },
  high_full: { minChars: 500, maxChars: 580, cutMode: "multi_slice_plus", maxClaims: 3, maxEvidenceRefsPerClaim: 3, confidenceCap: 0.92, combatEffectCap: "possible_kill", keepPositiveClaims: true }
};

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
    case "half": return 3000;
    case "force": return 3000;
    case "light": return 1800;
    case "pistol": return 800;
    case "eco": return 400;
    case "save": return 600;
  }
}
interface FinanceTextTerm {
  text: string;
  sourceRef: string;
  kind: HexSubmittedFinanceTextSpanKind;
  reasonZh: string;
}

function collectStanceTextTerms(card: HexFinanceStanceCard, kind: HexSubmittedFinanceTextSpanKind): FinanceTextTerm[] {
  const terms: FinanceTextTerm[] = [];
  for (const claim of card.coreClaims) {
    terms.push({ text: claim.claimId, sourceRef: `claim:${claim.claimId}`, kind, reasonZh: kind === "kept" ? "该 claim 编号进入 submitted。" : "该 claim 编号没有进入 submitted。" });
    terms.push({ text: claim.claimZh, sourceRef: `claimZh:${claim.claimId}`, kind, reasonZh: kind === "kept" ? "该 claim 原文进入 submitted。" : "该 claim 原文被经济裁剪。" });
    terms.push({ text: claim.reasoningBridge, sourceRef: `reasoningBridge:${claim.claimId}`, kind, reasonZh: kind === "kept" ? "该推理桥进入 submitted。" : "该推理桥被经济裁剪。" });
    for (const evidenceRef of claim.evidenceRefs) {
      terms.push({ text: evidenceRef, sourceRef: `evidenceRef:${claim.claimId}:${evidenceRef}`, kind, reasonZh: kind === "kept" ? "该证据编号进入 submitted。" : "该证据编号被经济裁剪。" });
    }
  }
  return terms;
}

function collectChallengeTextTerms(card: HexFinanceChallengeCard, kind: HexSubmittedFinanceTextSpanKind): FinanceTextTerm[] {
  const terms: FinanceTextTerm[] = [
    { text: card.targetClaimId, sourceRef: `challengeTarget:${card.targetClaimId}`, kind, reasonZh: kind === "kept" ? "该挑战靶点进入 submitted。" : "该挑战靶点被经济裁剪。" },
    { text: card.challengedAssumption, sourceRef: `challengedAssumption:${card.targetClaimId}`, kind, reasonZh: kind === "kept" ? "该挑战假设进入 submitted。" : "该挑战假设被经济裁剪。" },
    { text: card.proxyMismatch, sourceRef: `proxyMismatch:${card.targetClaimId}`, kind, reasonZh: kind === "kept" ? "该代理错配进入 submitted。" : "该代理错配被经济裁剪。" }
  ];
  for (const evidenceRef of card.evidenceRefs) {
    terms.push({ text: evidenceRef, sourceRef: `challengeEvidence:${card.targetClaimId}:${evidenceRef}`, kind, reasonZh: kind === "kept" ? "该证据编号进入 submitted。" : "该证据编号被经济裁剪。" });
  }
  for (const challenge of card.challenges) {
    terms.push({ text: challenge.challengeId, sourceRef: `challenge:${challenge.challengeId}`, kind, reasonZh: kind === "kept" ? "该 challenge 编号进入 submitted。" : "该 challenge 编号被经济裁剪。" });
    terms.push({ text: challenge.challengeReasonZh, sourceRef: `challengeReason:${challenge.challengeId}`, kind, reasonZh: kind === "kept" ? "该挑战理由进入 submitted。" : "该挑战理由被经济裁剪。" });
    for (const evidenceRef of challenge.evidenceRefs) {
      terms.push({ text: evidenceRef, sourceRef: `challengeEvidence:${challenge.challengeId}:${evidenceRef}`, kind, reasonZh: kind === "kept" ? "该证据编号进入 submitted。" : "该证据编号被经济裁剪。" });
    }
  }
  return terms;
}

function buildOpinionLengthAudit(
  rawOutput: HexRoundStartAgentOutputForAction,
  policy: ClipPolicy,
  textClip: Pick<HexSubmittedFinanceOutput, "submittedOpinionZh"> | { submittedOpinionZh?: string | undefined }
): Pick<
  HexSubmittedFinanceOutput,
  | "rawOpinionCharCount"
  | "rawOpinionTargetMinChars"
  | "rawOpinionTargetMaxChars"
  | "rawOpinionUnderTarget"
  | "submittedOpinionCharCount"
  | "submittedBudgetChars"
  | "submittedBudgetUtilization"
  | "rawOpinionUnderfilled"
> {
  const cardKind = rawOutput.cardKind === "challenge" ? "challenge" : "stance";
  const target = HEX_ROUND_START_RAW_OPINION_TARGETS[cardKind];
  const rawOpinionCharCount = (rawOutput.rawFinanceOpinionZh ?? "").trim().length;
  const submittedOpinionCharCount = (textClip.submittedOpinionZh ?? "").trim().length;
  const submittedBudgetChars = policy.submittedTextBudgetChars;
  return {
    rawOpinionCharCount,
    rawOpinionTargetMinChars: target.minChars,
    rawOpinionTargetMaxChars: target.maxChars,
    rawOpinionUnderTarget: rawOpinionCharCount > 0 && rawOpinionCharCount < target.minChars,
    rawOpinionUnderfilled: rawOpinionCharCount > 0 && rawOpinionCharCount < submittedBudgetChars,
    submittedOpinionCharCount,
    submittedBudgetChars,
    submittedBudgetUtilization: submittedBudgetChars > 0 ? roundNumber(submittedOpinionCharCount / submittedBudgetChars) : 0
  };
}
function buildSubmittedOpinionClip(input: {
  rawOpinion: string | undefined;
  submittedTerms: FinanceTextTerm[];
  rawTerms: FinanceTextTerm[];
  blockedTerms: FinanceTextTerm[];
  cappedFields: string[];
  budgetChars: number;
  cutMode: HexFinanceCutMode;
  cutModeSeed: string;
}): Pick<HexSubmittedFinanceOutput, "submittedOpinionZh" | "submittedTextBudgetChars" | "submittedTextSpanRefs" | "rawOpinionLinkStatus" | "unlocatedSubmittedItems"> {
  const rawOpinion = input.rawOpinion?.trim() ?? "";
  if (!rawOpinion) {
    return {
      submittedOpinionZh: undefined,
      submittedTextBudgetChars: input.budgetChars,
      submittedTextSpanRefs: [],
      rawOpinionLinkStatus: "legacy_missing",
      unlocatedSubmittedItems: input.submittedTerms.map((term) => ({ sourceRef: term.sourceRef, text: term.text, reasonZh: "旧 trace 或无 rawFinanceOpinionZh，无法定位 submitted 原文片段。" }))
    };
  }

  const submittedKeys = new Set(input.submittedTerms.map((term) => term.sourceRef));
  const allTerms = [
    ...input.submittedTerms,
    ...input.rawTerms.filter((term) => !submittedKeys.has(term.sourceRef)),
    ...input.blockedTerms,
    ...input.cappedFields.map((field) => ({ text: field, sourceRef: `capped:${field}`, kind: "capped" as const, reasonZh: "该字段被经济系统封顶。" }))
  ];
  const locatedTerms = locateFinanceTerms(rawOpinion, allTerms);
  const readableAnchorSpans = locatedTerms
    .filter((term) => term.kind === "kept" && isReadableFinanceTextAnchor(term))
    .map((term) => ({ start: term.start, end: term.end }));
  const fallbackAnchorSpans = locatedTerms
    .filter((term) => term.kind === "kept" && !isMachineFinanceTextTerm(term))
    .map((term) => ({ start: term.start, end: term.end }));
  const machineSpans = mergeBasicSpans([
    ...locatedTerms
      .filter(isMachineFinanceTextTerm)
      .map((term) => ({ start: term.start, end: term.end })),
    ...detectMachineTextSpans(rawOpinion)
  ]);
  const keptSpans = buildModeKeptSpans({
    rawLength: rawOpinion.length,
    budgetChars: input.budgetChars,
    cutMode: input.cutMode,
    cutModeSeed: input.cutModeSeed,
    anchorSpans: readableAnchorSpans.length > 0 ? readableAnchorSpans : fallbackAnchorSpans,
    avoidSpans: machineSpans
  });
  const spans: HexSubmittedFinanceTextSpanRef[] = [
    ...keptSpans.map((span) => ({
      ...span,
      kind: "kept" as const,
      sourceRef: `rawOpinion:${input.cutMode}`,
      reasonZh: `经济系统按 ${input.cutMode} 模式从模型输出的可提交原文中截取该片段进入 submitted。`
    })),
    ...buildOmittedSpans(rawOpinion.length, keptSpans)
  ];
  const unlocatedSubmittedItems: HexSubmittedFinanceUnlocatedItem[] = [];
  for (const term of locatedTerms) {
    if (term.kind === "blocked" || term.kind === "capped") {
      spans.push({ start: term.start, end: term.end, kind: term.kind, sourceRef: term.sourceRef, reasonZh: term.reasonZh });
      continue;
    }
    const termKind: HexSubmittedFinanceTextSpanKind = overlapsAny(term, keptSpans) ? term.kind : "omitted";
    spans.push({
      start: term.start,
      end: term.end,
      kind: termKind,
      sourceRef: term.sourceRef,
      reasonZh: termKind === term.kind ? term.reasonZh : "该结构字段存在于 rawFinanceOpinionZh，但没有落入本次经济剪裁文本窗口。"
    });
  }
  for (const term of allTerms) {
    const termText = term.text.trim();
    if (termText.length < 2) continue;
    if (!locatedTerms.some((located) => located.sourceRef === term.sourceRef && located.text === termText) && (term.kind === "blocked" || term.kind === "capped")) {
      unlocatedSubmittedItems.push({ sourceRef: term.sourceRef, text: termText, reasonZh: `无法在 rawFinanceOpinionZh 中定位：${term.reasonZh}` });
    }
  }

  const submittedOpinionZh = buildSubmittedTextFromSpans(rawOpinion, keptSpans, input.budgetChars);
  const linkStatus: HexSubmittedFinanceRawOpinionLinkStatus = keptSpans.length === 0
    ? "unlinked"
    : unlocatedSubmittedItems.length > 0
      ? "partial"
      : "linked";
  return {
    submittedOpinionZh: submittedOpinionZh || undefined,
    submittedTextBudgetChars: input.budgetChars,
    submittedTextSpanRefs: dedupeAndSortSpans(spans),
    rawOpinionLinkStatus: linkStatus,
    unlocatedSubmittedItems
  };
}

interface LocatedFinanceTextTerm extends FinanceTextTerm {
  start: number;
  end: number;
}

interface BasicSpan {
  start: number;
  end: number;
}

function locateFinanceTerms(rawOpinion: string, terms: FinanceTextTerm[]): LocatedFinanceTextTerm[] {
  const located: LocatedFinanceTextTerm[] = [];
  const seen = new Set<string>();
  for (const term of terms) {
    const termText = term.text.trim();
    if (termText.length < 2) continue;
    const key = `${term.kind}:${term.sourceRef}:${termText}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const start = rawOpinion.indexOf(termText);
    if (start >= 0) {
      located.push({ ...term, text: termText, start, end: start + termText.length });
    }
  }
  return located;
}
function isReadableFinanceTextAnchor(term: FinanceTextTerm): boolean {
  if (isMachineFinanceTextTerm(term)) return false;
  return term.sourceRef.startsWith("claimZh:")
    || term.sourceRef.startsWith("reasoningBridge:")
    || term.sourceRef.startsWith("challengedAssumption:")
    || term.sourceRef.startsWith("proxyMismatch:")
    || term.sourceRef.startsWith("challengeReason:");
}

function isMachineFinanceTextTerm(term: FinanceTextTerm): boolean {
  const text = term.text.trim();
  if (!text) return false;
  if (term.sourceRef.startsWith("claim:")
    || term.sourceRef.startsWith("challenge:")
    || term.sourceRef.startsWith("challengeTarget:")
    || term.sourceRef.startsWith("evidenceRef:")
    || term.sourceRef.startsWith("challengeEvidence:")) {
    return true;
  }
  return isMachineFinanceText(text);
}

function isMachineFinanceText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^(EVID:|SCORECAP:|claim_|challenge_)/i.test(trimmed)) return true;
  if (/\b(EVID:|SCORECAP:|BAOSTOCK|AKSHARE|FRED:)\b/i.test(trimmed)) return true;
  if (/\b[A-Z]{2,}[A-Z0-9]*USDM:[A-Za-z0-9_.:-]{12,}/.test(trimmed)) return true;
  if (/\b(?:PALUM|PNICK|PZINC|PCOPP)[A-Z0-9]*:?/.test(trimmed)) return true;
  if (/\b[a-z][a-z0-9]+(?:_[a-z0-9]+){2,}\b/.test(trimmed)) return true;
  return trimmed.length >= 32 && /[:_]/.test(trimmed) && /[A-Z0-9]{4,}/.test(trimmed);
}

function detectMachineTextSpans(rawOpinion: string): BasicSpan[] {
  const patterns = [
    /\bEVID:[A-Za-z0-9_.:-]+/gi,
    /\bSCORECAP:[A-Za-z0-9_.:-]+/gi,
    /\b(?:claim|challenge)_[A-Za-z0-9_.:-]+/gi,
    /\b[A-Z]{2,}[A-Z0-9]*USDM:[A-Za-z0-9_.:-]+/g,
    /\b(?:PALUM|PNICK|PZINC|PCOPP)[A-Z0-9]*:?[A-Za-z0-9_.:-]*/g,
    /\b[a-z][a-z0-9]+(?:_[a-z0-9]+){2,}\b/g
  ];
  const spans: BasicSpan[] = [];
  for (const pattern of patterns) {
    for (const match of rawOpinion.matchAll(pattern)) {
      const machineText = match[0] ?? "";
      const start = match.index ?? -1;
      if (start < 0 || machineText.length < 4) continue;
      if (!isMachineFinanceText(machineText)) continue;
      spans.push({ start, end: start + machineText.length });
    }
  }
  return mergeBasicSpans(spans);
}

function buildModeKeptSpans(input: {
  rawLength: number;
  budgetChars: number;
  cutMode: HexFinanceCutMode;
  cutModeSeed: string;
  anchorSpans: BasicSpan[];
  avoidSpans: BasicSpan[];
}): BasicSpan[] {
  const budget = Math.min(input.rawLength, Math.max(0, input.budgetChars));
  if (budget <= 0 || input.rawLength <= 0) return [];
  if (budget >= input.rawLength) return [{ start: 0, end: input.rawLength }];
  switch (input.cutMode) {
    case "front_cut":
      return [{ start: 0, end: budget }];
    case "tiny_random_window":
    case "random_window": {
      const start = selectWindowStartAvoidingSpans(input.rawLength, budget, input.cutModeSeed, input.avoidSpans);
      return [{ start, end: start + budget }];
    }
    case "pistol_core_window":
    case "core_window": {
      const start = selectCoreWindowStart(input.rawLength, budget, input.anchorSpans, input.avoidSpans, input.cutModeSeed);
      return [{ start, end: start + budget }];
    }
    case "random_core_window": {
      const coreStart = selectCoreWindowStart(input.rawLength, budget, input.anchorSpans, input.avoidSpans, input.cutModeSeed);
      const jitterRange = Math.max(1, Math.floor(budget / 4));
      const jitter = stableInt(`${input.cutModeSeed}:core_jitter`) % (jitterRange * 2 + 1) - jitterRange;
      const start = clampInteger(coreStart + jitter, 0, input.rawLength - budget);
      return [{ start, end: start + budget }];
    }
    case "multi_slice_lite":
      return buildMultiSliceSpans(input.rawLength, budget, input.anchorSpans, input.avoidSpans, input.cutModeSeed, 3);
    case "multi_slice":
      return buildMultiSliceSpans(input.rawLength, budget, input.anchorSpans, input.avoidSpans, input.cutModeSeed, 4);
    case "multi_slice_plus":
      return buildMultiSliceSpans(input.rawLength, budget, input.anchorSpans, input.avoidSpans, input.cutModeSeed, 5);
  }
}

function buildMultiSliceSpans(rawLength: number, budget: number, anchorSpans: BasicSpan[], avoidSpans: BasicSpan[], seed: string, sliceCount: number): BasicSpan[] {
  const count = Math.max(1, Math.min(sliceCount, budget));
  const baseSize = Math.max(1, Math.floor(budget / count));
  const starts: number[] = [0];
  for (const span of anchorSpans) {
    const center = Math.floor((span.start + span.end) / 2);
    starts.push(center - Math.floor(baseSize / 2));
  }
  starts.push(rawLength - baseSize);
  while (starts.length < count + 2) {
    starts.push(selectWindowStartAvoidingSpans(rawLength, baseSize, `${seed}:${starts.length}`, avoidSpans));
  }
  const spans: BasicSpan[] = [];
  let remaining = budget;
  for (const rawStart of starts) {
    if (remaining <= 0 || spans.length >= count) break;
    const size = spans.length === count - 1 ? remaining : Math.min(baseSize, remaining);
    const start = selectWindowStartAvoidingSpans(rawLength, size, `${seed}:slice:${spans.length}:${rawStart}`, avoidSpans, rawStart);
    const candidate = { start, end: Math.min(rawLength, start + size) };
    if (candidate.end <= candidate.start) continue;
    if (overlapLength(candidate.start, candidate.end, avoidSpans) > Math.floor((candidate.end - candidate.start) * 0.35)) continue;
    if (spans.some((span) => spansOverlap(span.start, span.end, candidate.start, candidate.end))) continue;
    spans.push(candidate);
    remaining -= candidate.end - candidate.start;
  }
  if (remaining > 0) {
    const fallback = firstAvailableSpan(rawLength, spans, remaining, avoidSpans);
    if (fallback) spans.push(fallback);
  }
  return spans.sort((left, right) => left.start - right.start);
}

function firstAvailableSpan(rawLength: number, existing: BasicSpan[], wanted: number, avoidSpans: BasicSpan[] = []): BasicSpan | undefined {
  const sorted = [...existing].sort((left, right) => left.start - right.start);
  let cursor = 0;
  for (const span of sorted) {
    if (span.start - cursor > 0) {
      const end = Math.min(span.start, cursor + wanted);
      const candidate = { start: cursor, end };
      if (overlapLength(candidate.start, candidate.end, avoidSpans) <= Math.floor((candidate.end - candidate.start) * 0.35)) return candidate;
    }
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < rawLength) {
    const candidate = { start: cursor, end: Math.min(rawLength, cursor + wanted) };
    if (overlapLength(candidate.start, candidate.end, avoidSpans) <= Math.floor((candidate.end - candidate.start) * 0.35)) return candidate;
  }
  return undefined;
}

function selectCoreWindowStart(rawLength: number, budget: number, anchorSpans: BasicSpan[], avoidSpans: BasicSpan[] = [], seed = "finance_clip"): number {
  if (anchorSpans.length === 0) return selectWindowStartAvoidingSpans(rawLength, budget, seed, avoidSpans);
  const minStart = Math.min(...anchorSpans.map((span) => span.start));
  const preferredStart = clampInteger(minStart, 0, rawLength - budget);
  return selectWindowStartAvoidingSpans(rawLength, budget, seed, avoidSpans, preferredStart);
}

function stableWindowStart(rawLength: number, budget: number, seed: string): number {
  const maxStart = Math.max(0, rawLength - budget);
  if (maxStart === 0) return 0;
  return stableInt(seed) % (maxStart + 1);
}
function selectWindowStartAvoidingSpans(rawLength: number, budget: number, seed = "finance_clip", avoidSpans: BasicSpan[] = [], preferredStart?: number): number {
  const maxStart = Math.max(0, rawLength - budget);
  if (maxStart === 0) return 0;
  const candidates = new Set<number>();
  const addCandidate = (value: number) => candidates.add(clampInteger(value, 0, maxStart));
  if (typeof preferredStart === "number") addCandidate(preferredStart);
  addCandidate(Math.floor((rawLength - budget) / 2));
  addCandidate(0);
  addCandidate(maxStart);
  addCandidate(stableWindowStart(rawLength, budget, seed));
  for (const span of avoidSpans) {
    addCandidate(span.end);
    addCandidate(span.start - budget);
  }
  const scanSteps = Math.min(24, Math.max(4, Math.floor(rawLength / Math.max(1, budget / 2))));
  for (let index = 0; index <= scanSteps; index += 1) {
    addCandidate(Math.floor((maxStart * index) / scanSteps));
  }
  let bestStart = [...candidates][0] ?? 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const start of candidates) {
    const end = start + budget;
    const avoidScore = overlapLength(start, end, avoidSpans);
    const distancePenalty = typeof preferredStart === "number" ? Math.abs(start - preferredStart) / Math.max(1, budget) : 0;
    const score = avoidScore * 100 + distancePenalty;
    if (score < bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }
  return bestStart;
}

function mergeBasicSpans(spans: BasicSpan[]): BasicSpan[] {
  const sorted = spans
    .filter((span) => span.end > span.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: BasicSpan[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

function overlapLength(start: number, end: number, spans: BasicSpan[]): number {
  return spans.reduce((sum, span) => {
    const overlapStart = Math.max(start, span.start);
    const overlapEnd = Math.min(end, span.end);
    return sum + Math.max(0, overlapEnd - overlapStart);
  }, 0);
}

function stableInt(seed: string): number {
  return Number.parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16);
}

function buildOmittedSpans(rawLength: number, keptSpans: BasicSpan[]): HexSubmittedFinanceTextSpanRef[] {
  const omitted: HexSubmittedFinanceTextSpanRef[] = [];
  let cursor = 0;
  for (const span of keptSpans.sort((left, right) => left.start - right.start)) {
    if (span.start > cursor) {
      omitted.push({ start: cursor, end: span.start, kind: "omitted", sourceRef: "rawOpinion:outside_budget", reasonZh: "这段原始观点超出当前经济预算或未落入本次裁剪窗口，未进入 submitted 文本片段。" });
    }
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < rawLength) {
    omitted.push({ start: cursor, end: rawLength, kind: "omitted", sourceRef: "rawOpinion:outside_budget", reasonZh: "这段原始观点超出当前经济预算或未落入本次裁剪窗口，未进入 submitted 文本片段。" });
  }
  return omitted;
}

function buildSubmittedTextFromSpans(rawOpinion: string, keptSpans: BasicSpan[], budgetChars: number): string {
  let used = 0;
  const parts: string[] = [];
  for (const span of keptSpans.sort((left, right) => left.start - right.start)) {
    if (used >= budgetChars) break;
    const remaining = budgetChars - used;
    const part = rawOpinion.slice(span.start, span.end).slice(0, remaining);
    if (part) {
      parts.push(part);
      used += part.length;
    }
  }
  return parts.join("").trim();
}

function overlapsAny(span: BasicSpan, candidates: BasicSpan[]): boolean {
  return candidates.some((candidate) => spansOverlap(span.start, span.end, candidate.start, candidate.end));
}

function spansOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}
function dedupeAndSortSpans(spans: HexSubmittedFinanceTextSpanRef[]): HexSubmittedFinanceTextSpanRef[] {
  const priority: Record<HexSubmittedFinanceTextSpanKind, number> = { blocked: 4, capped: 3, kept: 2, omitted: 1 };
  const accepted: HexSubmittedFinanceTextSpanRef[] = [];
  for (const span of spans.sort((left, right) => priority[right.kind] - priority[left.kind] || (right.end - right.start) - (left.end - left.start))) {
    if (!accepted.some((item) => item.start < span.end && span.start < item.end)) {
      accepted.push(span);
    }
  }
  return accepted.sort((left, right) => left.start - right.start);
}

function findEconomy(economyContext: HexRoundEconomyContext | undefined, agentId: string): HexAgentEconomyContext | undefined {
  return economyContext?.agents.find((agent) => agent.agentId === agentId);
}

function isUsableFinanceCardOutput(output: HexRoundStartAgentOutputForAction): boolean {
  return output.usableForPhaseAction
    && (output.source === "fixture_response" || output.source === "llm_response_artifact")
    && Boolean(output.cardKind)
    && (Boolean(output.stanceCard) || Boolean(output.challengeCard));
}

function capNumber(value: number, cap: number, field: string, cappedFields: string[]): number {
  if (value > cap) {
    cappedFields.push(field);
    return cap;
  }
  return value;
}

function orderByExplicitPriority<T>(items: T[]): T[] {
  return [...items].sort((left, right) => readPriority(left) - readPriority(right));
}

function orderRefsByExplicitPriority(refs: string[]): string[] {
  return [...refs].sort((left, right) => readPriority(left) - readPriority(right));
}

function readPriority(value: unknown): number {
  if (typeof value === "object" && value !== null && "priority" in value) {
    const priority = Number((value as { priority?: unknown }).priority);
    return Number.isFinite(priority) ? priority : Number.MAX_SAFE_INTEGER;
  }
  return Number.MAX_SAFE_INTEGER;
}

function buildGateSummary(
  output: HexRoundStartAgentOutputForAction,
  policy: ClipPolicy,
  clipped: ClipResult<unknown>
): string {
  const subject = output.cardKind === "stance" ? "立场卡" : "挑战卡";
  const orphaned = clipped.orphanedChallenge ? " target claim 已在 submitted stance 中被裁掉，按 orphaned_challenge 审计。" : "";
  return `Finance Output Gate 已按 ${policy.tier} 裁剪 ${subject}，combatEffectCap=${policy.combatEffectCap}，Judge 只能消费 SubmittedFinanceOutput，不能读取被裁剪 RawOutput。${orphaned}`;
}

function roundNumber(value: number): number {
  return Number(value.toFixed(4));
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}
