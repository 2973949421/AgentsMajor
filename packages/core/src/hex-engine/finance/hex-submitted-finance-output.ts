import { createHash } from "node:crypto";

import type {
  HexFinanceChallengeCard,
  HexFinanceCoreClaim,
  HexFinanceStanceCard,
  HexRoundStartAgentOutputForAction
} from "../action/hex-round-start-agent-output.js";
import type { HexAgentEconomyContext, HexRoundEconomyContext } from "../economy/index.js";
import { buildFinanceClipPolicy, type HexFinanceClipPolicy } from "./hex-finance-economy-clip-policy.js";
import { buildOpinionLengthAudit, buildSubmittedOpinionClip, collectChallengeTextTerms, collectStanceTextTerms } from "./hex-finance-text-slicer.js";
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
    const policy = buildFinanceClipPolicy(economy);
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
      const policy = buildFinanceClipPolicy(economy);
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
  policy: HexFinanceClipPolicy;
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
  policy: HexFinanceClipPolicy;
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

function clipStanceCard(card: HexFinanceStanceCard, policy: HexFinanceClipPolicy): ClipResult<HexFinanceStanceCard> {
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
  policy: HexFinanceClipPolicy,
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
  policy: HexFinanceClipPolicy,
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
  policy: HexFinanceClipPolicy,
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
