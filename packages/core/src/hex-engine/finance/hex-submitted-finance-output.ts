import { createHash } from "node:crypto";

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

export type HexFinanceClippingTier = "full" | "standard" | "force" | "eco" | "save";

export interface HexSubmittedFinanceOutput {
  submittedOutputId: string;
  rawOutputId: string;
  agentId: string;
  cardKind: "stance" | "challenge";
  submittedStanceCard?: HexFinanceStanceCard | undefined;
  submittedChallengeCard?: HexFinanceChallengeCard | undefined;
  buyType: string;
  economyPosture: string;
  loadoutPackage: string;
  outputBudget: number;
  clippingTier: HexFinanceClippingTier;
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
  maxClaims: number;
  maxEvidenceRefsPerClaim: number;
  confidenceCap: number;
  combatEffectCap: HexFinanceCombatEffectCap;
  keepPositiveClaims: boolean;
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
    const output = {
      ...base,
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
    const output = {
      ...base,
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
}): Omit<HexSubmittedFinanceOutput, "submittedFingerprint" | "omittedFields" | "cappedFields" | "submittedUsableForJudge" | "submittedUsableForCombat" | "gateSummary"> {
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
  switch (tier) {
    case "full":
      return { tier, maxClaims: 3, maxEvidenceRefsPerClaim: 3, confidenceCap: 0.9, combatEffectCap: "possible_kill", keepPositiveClaims: true };
    case "standard":
      return { tier, maxClaims: 2, maxEvidenceRefsPerClaim: 2, confidenceCap: 0.75, combatEffectCap: "possible_wound", keepPositiveClaims: true };
    case "force":
      return { tier, maxClaims: 1, maxEvidenceRefsPerClaim: 1, confidenceCap: 0.6, combatEffectCap: "forced_back", keepPositiveClaims: true };
    case "eco":
      return { tier, maxClaims: 1, maxEvidenceRefsPerClaim: 1, confidenceCap: 0.45, combatEffectCap: "weak_pressure", keepPositiveClaims: true };
    case "save":
      return { tier, maxClaims: 0, maxEvidenceRefsPerClaim: 0, confidenceCap: 0.35, combatEffectCap: "minor_delay", keepPositiveClaims: false };
  }
}

function classifyClippingTier(economy: HexAgentEconomyContext | undefined): HexFinanceClippingTier {
  const economyPosture = economy?.economyPosture;
  const buyType = economy?.buyType;
  if (economyPosture === "rifle_buy" || economyPosture === "awp_buy" || economyPosture === "double_awp" || buyType === "fullBuy") {
    return "full";
  }
  if (economyPosture === "bonus_round" || economyPosture === "half_buy" || buyType === "halfBuy") {
    return "standard";
  }
  if (economyPosture === "broken_buy" || economyPosture === "force_buy" || economyPosture === "light_buy" || economyPosture === "pistol_armor_force" || buyType === "forceBuy") {
    return "force";
  }
  if (economyPosture === "full_eco" || economyPosture === "save_play" || buyType === "save") {
    return "save";
  }
  return "eco";
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

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}
