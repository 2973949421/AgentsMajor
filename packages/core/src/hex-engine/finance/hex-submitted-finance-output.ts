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
  submittedTextBudgetChars: number;
  submittedTextSpanRefs: HexSubmittedFinanceTextSpanRef[];
  rawOpinionLinkStatus: HexSubmittedFinanceRawOpinionLinkStatus;
  unlocatedSubmittedItems: HexSubmittedFinanceUnlocatedItem[];
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
  submittedTextBudgetChars: number;
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
      budgetChars: input.policy.submittedTextBudgetChars
    });
    const output = {
      ...base,
      ...textClip,
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
      budgetChars: input.policy.submittedTextBudgetChars
    });
    const output = {
      ...base,
      ...textClip,
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
      budgetChars: input.policy.submittedTextBudgetChars
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
    rawFinanceOpinionZh: input.rawOutput.rawFinanceOpinionZh,
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
      return { tier, maxClaims: 3, maxEvidenceRefsPerClaim: 3, confidenceCap: 0.9, combatEffectCap: "possible_kill", keepPositiveClaims: true, submittedTextBudgetChars: 320 };
    case "standard":
      return { tier, maxClaims: 2, maxEvidenceRefsPerClaim: 2, confidenceCap: 0.75, combatEffectCap: "possible_wound", keepPositiveClaims: true, submittedTextBudgetChars: 220 };
    case "force":
      return { tier, maxClaims: 1, maxEvidenceRefsPerClaim: 1, confidenceCap: 0.6, combatEffectCap: "forced_back", keepPositiveClaims: true, submittedTextBudgetChars: 120 };
    case "eco":
      return { tier, maxClaims: 1, maxEvidenceRefsPerClaim: 1, confidenceCap: 0.45, combatEffectCap: "weak_pressure", keepPositiveClaims: true, submittedTextBudgetChars: 80 };
    case "save":
      return { tier, maxClaims: 0, maxEvidenceRefsPerClaim: 0, confidenceCap: 0.35, combatEffectCap: "minor_delay", keepPositiveClaims: false, submittedTextBudgetChars: 40 };
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

function buildSubmittedOpinionClip(input: {
  rawOpinion: string | undefined;
  submittedTerms: FinanceTextTerm[];
  rawTerms: FinanceTextTerm[];
  blockedTerms: FinanceTextTerm[];
  cappedFields: string[];
  budgetChars: number;
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
  const spans: HexSubmittedFinanceTextSpanRef[] = [];
  const unlocatedSubmittedItems: HexSubmittedFinanceUnlocatedItem[] = [];
  const seen = new Set<string>();
  for (const term of allTerms) {
    const termText = term.text.trim();
    if (termText.length < 2) continue;
    const key = `${term.kind}:${term.sourceRef}:${termText}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const start = rawOpinion.indexOf(termText);
    if (start < 0) {
      if (term.kind === "kept" || term.kind === "blocked") {
        unlocatedSubmittedItems.push({ sourceRef: term.sourceRef, text: termText, reasonZh: `无法在 rawFinanceOpinionZh 中定位：${term.reasonZh}` });
      }
      continue;
    }
    spans.push({ start, end: start + termText.length, kind: term.kind, sourceRef: term.sourceRef, reasonZh: term.reasonZh });
  }

  const keptSpans = spans.filter((span) => span.kind === "kept").sort((left, right) => left.start - right.start);
  if (keptSpans.length === 0 && input.submittedTerms.length > 0 && input.budgetChars > 0) {
    const end = Math.min(rawOpinion.length, input.budgetChars);
    spans.push({
      start: 0,
      end,
      kind: "kept",
      sourceRef: "rawOpinion:budget_excerpt",
      reasonZh: "结构化 submitted 字段未能精确回贴到原文时，按经济预算保留这段原始观点。"
    });
    if (end < rawOpinion.length) {
      spans.push({
        start: end,
        end: rawOpinion.length,
        kind: "omitted",
        sourceRef: "rawOpinion:outside_budget",
        reasonZh: "这段原始观点超出当前经济预算，未进入 submitted 文本片段。"
      });
    }
  }
  const effectiveKeptSpans = spans.filter((span) => span.kind === "kept").sort((left, right) => left.start - right.start);
  let used = 0;
  const submittedParts: string[] = [];
  for (const span of effectiveKeptSpans) {
    if (used >= input.budgetChars) break;
    const remaining = input.budgetChars - used;
    const part = rawOpinion.slice(span.start, span.end).slice(0, remaining);
    if (part) {
      submittedParts.push(part);
      used += part.length;
    }
  }
  const linkStatus: HexSubmittedFinanceRawOpinionLinkStatus = input.submittedTerms.length === 0
    ? "linked"
    : unlocatedSubmittedItems.length === 0 && effectiveKeptSpans.length > 0
      ? "linked"
      : effectiveKeptSpans.length > 0
        ? "partial"
        : "unlinked";
  return {
    submittedOpinionZh: submittedParts.join("\n").trim() || undefined,
    submittedTextBudgetChars: input.budgetChars,
    submittedTextSpanRefs: dedupeAndSortSpans(spans),
    rawOpinionLinkStatus: linkStatus,
    unlocatedSubmittedItems
  };
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

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}
