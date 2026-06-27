import type {
  HexFinanceChallenge,
  HexFinanceChallengeCard,
  HexFinanceCoreClaim,
  HexFinanceStanceCard,
  HexRoundStartAgentOutputForAction
} from "../action/hex-round-start-agent-output.js";
import type { HexSide } from "../state/index.js";
import type { HexFinanceEvidenceFact, HexFinanceRequiredEvidenceItem, HexFinanceScoreCap, HexRoundFinanceDuel } from "./hex-round-finance-duel.js";
import { isSubmittedFinanceOutputUsableForJudge, type HexSubmittedFinanceOutput } from "./hex-submitted-finance-output.js";

export type HexFinanceEvidenceFinancialResult =
  | "stance_survives"
  | "challenge_breaks_stance"
  | "contested"
  | "no_financial_win_allowed";

export type HexFinanceCombatEffectAllowed =
  | "no_effect"
  | "minor_delay"
  | "pressure"
  | "force_reposition"
  | "map_control"
  | "possible_kill";

export interface HexFinanceEvidenceJudgeScoreCap {
  condition: string;
  reason: string;
  maxScore?: number;
}

export interface HexFinanceEvidenceJudgeSideResult {
  side: HexSide;
  acceptedEvidenceRefs: string[];
  rejectedEvidenceRefs: string[];
  missingEvidenceApplied: string[];
  scoreCapRefs: string[];
  scoreCaps: HexFinanceEvidenceJudgeScoreCap[];
  acceptedClaims: string[];
  rejectedClaims: string[];
  acceptedChallenges: string[];
  rejectedChallenges: string[];
  acceptedEvidenceRefsByItemId: Record<string, string[]>;
  sideScore: number;
  stanceScore: number;
  challengeScore: number;
  financialResult: HexFinanceEvidenceFinancialResult;
  combatEffectAllowed: HexFinanceCombatEffectAllowed[];
  adoptionReasons: string[];
  rejectionReasons: string[];
  financeReasonZh: string[];
  auditReasons: string[];
}

export interface HexFinanceEvidenceJudgeResult {
  attack: HexFinanceEvidenceJudgeSideResult;
  defense: HexFinanceEvidenceJudgeSideResult;
  stanceScore: number;
  challengeScore: number;
  financialResult: HexFinanceEvidenceFinancialResult;
  combatEffectAllowed: HexFinanceCombatEffectAllowed[];
  financeReasonZh: string[];
  auditReasons: string[];
}

interface FactMetadata extends HexFinanceEvidenceFact {
  statementZh?: string;
  allowedClaimTypes?: string[];
  notAllowedClaimTypes?: string[];
  scoreCapPolicy?: string;
  reliabilityTier?: string;
  activeSourceStatus?: string;
  factBankSource?: string;
  requiredEvidenceKeys?: string[];
  unavailableReason?: string;
  period?: string;
}

interface EvidenceIndex {
  byRef: Map<string, FactMetadata>;
}

interface ClaimCatalogItem {
  claim: HexFinanceCoreClaim;
  card: HexFinanceStanceCard;
}

interface MutableSideResult {
  side: HexSide;
  acceptedEvidenceRefs: Set<string>;
  rejectedEvidenceRefs: Set<string>;
  missingEvidenceApplied: Set<string>;
  scoreCapRefs: Set<string>;
  scoreCaps: Map<string, HexFinanceEvidenceJudgeScoreCap>;
  acceptedClaims: Set<string>;
  rejectedClaims: Set<string>;
  acceptedChallenges: Set<string>;
  rejectedChallenges: Set<string>;
  acceptedEvidenceRefsByItemId: Map<string, Set<string>>;
  score: number;
  adoptionReasons: Set<string>;
  rejectionReasons: Set<string>;
  auditReasons: Set<string>;
}

const financialWinDelta = 15;
const defaultMissingEvidenceCap = 70;
const missingOnlyChallengeCap = 35;

const claimTypeAliases: Record<string, string> = {
  commodity_price_signal: "commodity_price_momentum",
  price_signal: "commodity_price_momentum",
  commodity_signal: "commodity_price_momentum",
  equity_signal: "equity_transmission_proxy",
  equity_market_signal: "equity_transmission_proxy",
  a_share_market_signal: "a_share_relative_performance",
  valuation_signal: "valuation_proxy",
  valuation_context: "valuation_proxy",
  risk_boundary: "risk_reward_boundary",
  execution_risk: "risk_reward_boundary"
};

export function judgeHexFinanceEvidence(input: {
  financeDuel: HexRoundFinanceDuel;
  submittedFinanceOutputs?: readonly HexSubmittedFinanceOutput[] | undefined;
  roundStartAgentOutputs?: readonly HexRoundStartAgentOutputForAction[] | undefined;
}): HexFinanceEvidenceJudgeResult {
  const evidenceIndex = buildEvidenceIndex(input.financeDuel);
  const judgeInputs = input.submittedFinanceOutputs?.length
    ? [...input.submittedFinanceOutputs]
    : buildLegacySubmittedFinanceOutputs(input.roundStartAgentOutputs ?? []);
  const hasSubmittedFinanceOutputs = Boolean(input.submittedFinanceOutputs?.length);
  const judgeInputMode = hasSubmittedFinanceOutputs ? "submitted_finance_outputs_n62b" : "legacy_round_start_outputs";
  const claimCatalog = buildClaimCatalog(judgeInputs);
  const defense = buildMutableSideResult("defense");
  const attack = buildMutableSideResult("attack");
  defense.auditReasons.add(`judge_input:${judgeInputMode}`);
  attack.auditReasons.add(`judge_input:${judgeInputMode}`);
  if (hasSubmittedFinanceOutputs) {
    defense.auditReasons.add("judge_input:submitted_finance_outputs");
    attack.auditReasons.add("judge_input:submitted_finance_outputs");
  }

  for (const output of judgeInputs) {
    if (!isSubmittedFinanceOutputUsableForJudge(output)) {
      continue;
    }
    if (output.submittedStanceCard && output.cardKind === "stance") {
      evaluateStanceCard({
        card: output.submittedStanceCard,
        sideResult: defense,
        evidenceIndex,
        financeDuel: input.financeDuel
      });
    }
  }

  for (const output of judgeInputs) {
    if (!isSubmittedFinanceOutputUsableForJudge(output)) {
      continue;
    }
    if (output.submittedChallengeCard && output.cardKind === "challenge") {
      if (output.orphanedChallenge) {
        rejectOrphanedChallengeCard(output.submittedChallengeCard, attack);
        continue;
      }
      evaluateChallengeCard({
        card: output.submittedChallengeCard,
        sideResult: attack,
        evidenceIndex,
        claimCatalog,
        financeDuel: input.financeDuel
      });
    }
  }

  applyRequiredEvidenceCaps(defense, input.financeDuel.decisionQuestion.requiredEvidenceSchema);
  applyRequiredEvidenceCaps(attack, input.financeDuel.decisionQuestion.requiredEvidenceSchema);

  const stanceScore = applyScoreCaps(defense, defense.score);
  const challengeScore = applyScoreCaps(attack, attack.score);
  const totalAcceptedEvidence = defense.acceptedEvidenceRefs.size + attack.acceptedEvidenceRefs.size;
  const financialResult = buildFinancialResult({
    stanceScore,
    challengeScore,
    totalAcceptedEvidence,
    acceptedClaims: defense.acceptedClaims.size,
    acceptedChallenges: attack.acceptedChallenges.size,
    acceptedStanceEvidence: defense.acceptedEvidenceRefs.size,
    acceptedChallengeEvidence: attack.acceptedEvidenceRefs.size
  });
  const combatEffectAllowed = buildCombatEffectAllowed(financialResult);

  const finalDefense = finalizeSideResult({
    input: defense,
    sideScore: stanceScore,
    stanceScore,
    challengeScore,
    financialResult,
    combatEffectAllowed
  });
  const finalAttack = finalizeSideResult({
    input: attack,
    sideScore: challengeScore,
    stanceScore,
    challengeScore,
    financialResult,
    combatEffectAllowed
  });

  return {
    attack: finalAttack,
    defense: finalDefense,
    stanceScore,
    challengeScore,
    financialResult,
    combatEffectAllowed,
    financeReasonZh: [
      buildFinancialResultZh(financialResult, stanceScore, challengeScore),
      ...finalDefense.financeReasonZh,
      ...finalAttack.financeReasonZh
    ],
    auditReasons: uniqueStrings([
      `judge_input:${judgeInputMode}`,
      ...(hasSubmittedFinanceOutputs ? ["judge_input:submitted_finance_outputs"] : []),
      `financial_result:${financialResult}`,
      `stance_score:${stanceScore}`,
      `challenge_score:${challengeScore}`,
      ...finalDefense.auditReasons,
      ...finalAttack.auditReasons
    ])
  };
}

function buildEvidenceIndex(financeDuel: HexRoundFinanceDuel): EvidenceIndex {
  const byRef = new Map<string, FactMetadata>();
  for (const fact of financeDuel.evidence.facts as FactMetadata[]) {
    registerFactRef(byRef, fact.factId, fact);
    registerFactRef(byRef, fact.evidenceId, fact);
  }
  for (const fact of financeDuel.evidence.promptFacts) {
    const existing = byRef.get(normalizeRef(fact.factId));
    if (existing) {
      registerFactRef(byRef, fact.evidenceId, existing);
    }
  }
  return { byRef };
}

function registerFactRef(index: Map<string, FactMetadata>, ref: string | undefined, fact: FactMetadata): void {
  const normalized = normalizeRef(ref ?? "");
  if (normalized) {
    index.set(normalized, fact);
  }
}

function buildClaimCatalog(outputs: readonly HexSubmittedFinanceOutput[]): Map<string, ClaimCatalogItem> {
  const catalog = new Map<string, ClaimCatalogItem>();
  for (const output of outputs) {
    if (!isSubmittedFinanceOutputUsableForJudge(output) || !output.submittedStanceCard) {
      continue;
    }
    for (const claim of output.submittedStanceCard.coreClaims) {
      catalog.set(claim.claimId, { claim, card: output.submittedStanceCard });
    }
  }
  return catalog;
}

function buildLegacySubmittedFinanceOutputs(outputs: readonly HexRoundStartAgentOutputForAction[]): HexSubmittedFinanceOutput[] {
  return outputs
    .filter((output) => output.usableForPhaseAction
      && (output.source === "llm_response_artifact" || output.source === "fixture_response")
      && Boolean(output.cardKind)
      && (Boolean(output.stanceCard) || Boolean(output.challengeCard)))
    .map((output) => ({
      submittedOutputId: `legacy_sub_fin_${output.outputId}`,
      rawOutputId: output.outputId,
      agentId: output.agentId,
      cardKind: output.cardKind!,
      ...(output.stanceCard ? { submittedStanceCard: output.stanceCard } : {}),
      ...(output.challengeCard ? { submittedChallengeCard: output.challengeCard } : {}),
      rawFinanceOpinionZh: output.rawFinanceOpinionZh,
      submittedOpinionZh: output.rawFinanceOpinionZh,
      rawOpinionCharCount: output.rawFinanceOpinionZh?.length ?? 0,
      rawOpinionTargetMinChars: 0,
      rawOpinionTargetMaxChars: 0,
      rawOpinionUnderTarget: false,
      submittedOpinionCharCount: output.rawFinanceOpinionZh?.length ?? 0,
      submittedBudgetChars: output.rawFinanceOpinionZh?.length ?? 0,
      submittedBudgetUtilization: output.rawFinanceOpinionZh ? 1 : 0,
      rawOpinionUnderfilled: false,
      submittedTextBudgetChars: output.rawFinanceOpinionZh?.length ?? 0,
      submittedTextSpanRefs: output.rawFinanceOpinionZh ? [{
        start: 0,
        end: output.rawFinanceOpinionZh.length,
        kind: "kept" as const,
        sourceRef: `legacy_raw:${output.outputId}`,
        reasonZh: "旧 trace 兼容路径：raw 文本整体视为 legacy submitted。"
      }] : [],
      rawOpinionLinkStatus: output.rawFinanceOpinionZh ? "linked" as const : "legacy_missing" as const,
      unlocatedSubmittedItems: [],
      buyType: "legacy",
      economyPosture: "legacy",
      loadoutPackage: "legacy",
      outputBudget: 0,
      clippingTier: "rifle_full" as const,
      economyClipVersion: "finance_economy_clip_v1" as const,
      economyClipTier: "rifle_full" as const,
      spend: 5200,
      spendUnit: 50 as const,
      charsPerSpendUnit: 4,
      rawBudgetChars: 416,
      cutMode: "multi_slice" as const,
      cutModeSeed: `legacy:${output.outputId}`,
      budgetClampReason: "within_tier" as const,
      budgetSource: "economy_spend" as const,
      combatEffectCap: "possible_kill" as const,
      judgeInputRef: `legacy_round_start:${output.outputId}`,
      factBankSnapshotId: "legacy_trace_without_n62",
      decisionQuestionId: "legacy_trace_without_n62",
      evidenceMenuVersion: "legacy_trace_without_n62",
      clippingPolicyVersion: "finance_output_gate_v1" as const,
      omittedFields: [],
      cappedFields: [],
      rawFingerprint: `legacy_raw:${output.outputId}`,
      submittedFingerprint: `legacy_submitted:${output.outputId}`,
      rawParseStatus: "legacy_round_start_output",
      submittedUsableForJudge: true,
      submittedUsableForCombat: true,
      gateSummary: "旧 trace 未记录 N62/N62B SubmittedFinanceOutput；仅用于兼容旧测试和旧审计。"
    }));
}

function evaluateStanceCard(input: {
  card: HexFinanceStanceCard;
  sideResult: MutableSideResult;
  evidenceIndex: EvidenceIndex;
  financeDuel: HexRoundFinanceDuel;
}): void {
  for (const claim of input.card.coreClaims) {
    const evaluation = evaluateEvidenceRefs({
      refs: claim.evidenceRefs,
      claimType: claim.claimType,
      evidenceIndex: input.evidenceIndex,
      financeDuel: input.financeDuel,
      contextId: claim.claimId
    });
    mergeEvidenceEvaluation(input.sideResult, evaluation);

    if (!claim.reasoningBridge.trim()) {
      input.sideResult.rejectedClaims.add(`${claim.claimId}:missing_reasoning_bridge`);
      input.sideResult.rejectionReasons.add("missing_reasoning_bridge");
      continue;
    }
    if (evaluation.acceptedRefs.length === 0) {
      input.sideResult.rejectedClaims.add(`${claim.claimId}:no_accepted_evidence`);
      input.sideResult.rejectionReasons.add("claim_without_accepted_evidence");
      continue;
    }
    input.sideResult.acceptedClaims.add(claim.claimId);
    addAcceptedEvidenceForItem(input.sideResult, claim.claimId, evaluation.acceptedRefs);
    input.sideResult.score += 20 + Math.min(18, evaluation.acceptedRefs.length * 6);
    input.sideResult.adoptionReasons.add(`${claim.claimId}:claim_supported_by_accepted_evidence`);
    if (input.card.riskBoundaries.length > 0 || input.card.invalidatingConditions.length > 0) {
      input.sideResult.score += 5;
      input.sideResult.auditReasons.add(`${claim.claimId}:risk_boundary_or_invalidating_condition_present`);
    }
  }
}

function evaluateChallengeCard(input: {
  card: HexFinanceChallengeCard;
  sideResult: MutableSideResult;
  evidenceIndex: EvidenceIndex;
  claimCatalog: Map<string, ClaimCatalogItem>;
  financeDuel: HexRoundFinanceDuel;
}): void {
  const policy = input.financeDuel.decisionQuestion.challengePolicy;
  for (const challenge of input.card.challenges) {
    const target = input.claimCatalog.get(challenge.targetClaimId);
    if (!target) {
      input.sideResult.rejectedChallenges.add(`${challenge.challengeId}:unknown_target_claim`);
      input.sideResult.rejectionReasons.add("unknown_target_claim");
      continue;
    }
    if (policy.allowedChallengeTypes.length > 0 && !policy.allowedChallengeTypes.includes(challenge.challengeType)) {
      input.sideResult.rejectedChallenges.add(`${challenge.challengeId}:invalid_challenge_type`);
      input.sideResult.rejectionReasons.add("invalid_challenge_type");
      continue;
    }
    if (isGenericMissingDataChallenge(challenge, input.card)) {
      input.sideResult.rejectedChallenges.add(`${challenge.challengeId}:generic_missing_data_not_specific`);
      input.sideResult.rejectionReasons.add("generic_missing_data_not_specific");
      continue;
    }

    const evaluation = evaluateEvidenceRefs({
      refs: challenge.evidenceRefs,
      evidenceIndex: input.evidenceIndex,
      financeDuel: input.financeDuel,
      contextId: challenge.challengeId
    });
    mergeEvidenceEvaluation(input.sideResult, evaluation);
    const missingKeys = collectMentionedRequiredEvidenceKeys(
      `${challenge.challengeReasonZh} ${challenge.expectedEffect} ${input.card.challengedAssumption} ${input.card.proxyMismatch}`,
      input.financeDuel.decisionQuestion.requiredEvidenceSchema
    );
    for (const key of missingKeys) {
      input.sideResult.missingEvidenceApplied.add(key);
      input.sideResult.auditReasons.add(`${challenge.challengeId}:missing_evidence_key_applied:${key}`);
      addScoreCap(input.sideResult, {
        condition: key,
        reason: resolveMissingEffect(key, input.financeDuel.decisionQuestion.requiredEvidenceSchema),
        maxScore: evaluation.acceptedRefs.length > 0 ? defaultMissingEvidenceCap : missingOnlyChallengeCap
      });
    }

    if (evaluation.acceptedRefs.length === 0 && missingKeys.length === 0) {
      input.sideResult.rejectedChallenges.add(`${challenge.challengeId}:no_accepted_evidence_or_specific_missing_key`);
      input.sideResult.rejectionReasons.add("challenge_without_accepted_evidence_or_specific_missing_key");
      continue;
    }

    input.sideResult.acceptedChallenges.add(challenge.challengeId);
    addAcceptedEvidenceForItem(input.sideResult, challenge.challengeId, evaluation.acceptedRefs);
    const missingOnlyChallenge = evaluation.acceptedRefs.length === 0 && missingKeys.length > 0;
    if (missingOnlyChallenge) {
      input.sideResult.score += 4;
      input.sideResult.auditReasons.add(`${challenge.challengeId}:missing_only_challenge_capped`);
      addScoreCap(input.sideResult, {
        condition: `${challenge.challengeId}:missing_only_challenge`,
        reason: "挑战只指出预声明缺失证据时，只能限制置信度，不能直接打穿立场。",
        maxScore: missingOnlyChallengeCap
      });
    } else {
      input.sideResult.score += 22 + Math.min(14, evaluation.acceptedRefs.length * 5);
    }
    if (!missingOnlyChallenge && ["proxy_mismatch", "horizon_mismatch", "reasoning_bridge_break", "risk_reward_failure"].includes(challenge.challengeType)) {
      input.sideResult.score += 8;
    }
    input.sideResult.adoptionReasons.add(`${challenge.challengeId}:challenge_targets_claim:${challenge.targetClaimId}`);
  }
}

function rejectOrphanedChallengeCard(card: HexFinanceChallengeCard, sideResult: MutableSideResult): void {
  for (const challenge of card.challenges) {
    sideResult.rejectedChallenges.add(`${challenge.challengeId}:orphaned_challenge_target_clipped_out`);
    sideResult.rejectionReasons.add("orphaned_challenge_target_clipped_out");
    sideResult.auditReasons.add(`${challenge.challengeId}:target_claim_clipped_out_before_judge:${challenge.targetClaimId}`);
  }
}
function evaluateEvidenceRefs(input: {
  refs: readonly string[];
  evidenceIndex: EvidenceIndex;
  financeDuel: HexRoundFinanceDuel;
  contextId: string;
  claimType?: string;
}): {
  acceptedRefs: string[];
  rejectedRefs: string[];
  missingRefs: string[];
  scoreCaps: HexFinanceEvidenceJudgeScoreCap[];
  reasons: string[];
} {
  const acceptedRefs: string[] = [];
  const rejectedRefs: string[] = [];
  const missingRefs: string[] = [];
  const scoreCaps: HexFinanceEvidenceJudgeScoreCap[] = [];
  const reasons: string[] = [];
  const canonicalClaim = input.claimType ? canonicalClaimType(input.claimType) : undefined;
  if (input.claimType && canonicalClaim && canonicalClaim !== normalizeClaimType(input.claimType)) {
    reasons.push(`${input.contextId}:normalized_claim_type:${input.claimType}:${canonicalClaim}`);
  }
  for (const ref of input.refs) {
    const fact = input.evidenceIndex.byRef.get(normalizeRef(ref));
    if (!fact) {
      rejectedRefs.push(`${ref}:unknown_evidence_ref`);
      reasons.push(`${input.contextId}:unknown_evidence_ref:${ref}`);
      continue;
    }
    if (isUnavailableFact(fact)) {
      rejectedRefs.push(`${ref}:unavailable_observation_not_positive_fact`);
      missingRefs.push(ref);
      reasons.push(`${input.contextId}:unavailable_observation:${ref}`);
      addFactScoreCap(scoreCaps, fact);
      continue;
    }
    if (canonicalClaim) {
      const notAllowed = canonicalClaimTypes(fact.notAllowedClaimTypes);
      if (notAllowed.includes(canonicalClaim)) {
        rejectedRefs.push(`${ref}:claim_type_not_allowed:${canonicalClaim}`);
        reasons.push(`${input.contextId}:claim_type_not_allowed:${canonicalClaim}:${ref}`);
        addFactScoreCap(scoreCaps, fact);
        continue;
      }
      const allowed = canonicalClaimTypes(fact.allowedClaimTypes);
      if (allowed.length > 0 && !allowed.includes(canonicalClaim)) {
        rejectedRefs.push(`${ref}:claim_type_not_supported:${canonicalClaim}`);
        reasons.push(`${input.contextId}:claim_type_not_supported:${canonicalClaim}:${ref}`);
        addFactScoreCap(scoreCaps, fact);
        continue;
      }
    }
    acceptedRefs.push(fact.factId);
    reasons.push(`${input.contextId}:evidence_accepted:${fact.factId}`);
    for (const requiredKey of fact.requiredEvidenceKeys ?? []) {
      reasons.push(`${input.contextId}:required_key:${requiredKey}`);
    }
    if (fact.dataMode === "configured_proxy_fact" || fact.scoreCapPolicy) {
      addFactScoreCap(scoreCaps, fact);
    }
  }
  return {
    acceptedRefs: uniqueStrings(acceptedRefs),
    rejectedRefs: uniqueStrings(rejectedRefs),
    missingRefs: uniqueStrings(missingRefs),
    scoreCaps,
    reasons
  };
}

function mergeEvidenceEvaluation(sideResult: MutableSideResult, evaluation: ReturnType<typeof evaluateEvidenceRefs>): void {
  for (const ref of evaluation.acceptedRefs) {
    sideResult.acceptedEvidenceRefs.add(ref);
  }
  for (const ref of evaluation.rejectedRefs) {
    sideResult.rejectedEvidenceRefs.add(ref);
  }
  for (const ref of evaluation.missingRefs) {
    sideResult.missingEvidenceApplied.add(ref);
  }
  for (const cap of evaluation.scoreCaps) {
    addScoreCap(sideResult, cap);
  }
  for (const reason of evaluation.reasons) {
    sideResult.auditReasons.add(reason);
  }
}

function applyRequiredEvidenceCaps(sideResult: MutableSideResult, requiredEvidenceSchema: readonly HexFinanceRequiredEvidenceItem[]): void {
  for (const required of requiredEvidenceSchema) {
    if (required.missingEffect && !hasAcceptedEvidenceForRequiredKey(sideResult, required.requiredKey)) {
      sideResult.missingEvidenceApplied.add(required.requiredKey);
      addScoreCap(sideResult, {
        condition: required.requiredKey,
        reason: required.missingEffect,
        maxScore: defaultMissingEvidenceCap
      });
    }
  }
}

function hasAcceptedEvidenceForRequiredKey(sideResult: MutableSideResult, requiredKey: string): boolean {
  return [...sideResult.auditReasons].some((reason) => reason.includes(`required_key:${requiredKey}`))
    || [...sideResult.acceptedEvidenceRefs].some((ref) => normalizeText(ref).includes(normalizeText(requiredKey)));
}

function isUnavailableFact(fact: FactMetadata): boolean {
  return fact.dataMode === "unavailable_observation"
    || fact.period === "unavailable"
    || (typeof fact.confidence === "number" && fact.confidence <= 0)
    || ["frozen", "candidate_only", "blocked", "unavailable"].includes(String(fact.activeSourceStatus ?? "").toLowerCase());
}

function addFactScoreCap(scoreCaps: HexFinanceEvidenceJudgeScoreCap[], fact: FactMetadata): void {
  if (!fact.scoreCapPolicy && fact.dataMode !== "configured_proxy_fact" && fact.dataMode !== "unavailable_observation") {
    return;
  }
  scoreCaps.push({
    condition: fact.factId,
    reason: fact.scoreCapPolicy ?? (fact.dataMode === "unavailable_observation" ? "该事实不可用，只能作为缺口或降权依据。" : "代理事实只能弱采信并触发评分上限。"),
    maxScore: fact.dataMode === "unavailable_observation" ? 0 : 70
  });
}

function addScoreCap(sideResult: MutableSideResult, cap: HexFinanceEvidenceJudgeScoreCap): void {
  sideResult.scoreCapRefs.add(cap.condition);
  sideResult.scoreCaps.set(cap.condition, cap);
}

function buildFinancialResult(input: {
  stanceScore: number;
  challengeScore: number;
  totalAcceptedEvidence: number;
  acceptedClaims: number;
  acceptedChallenges: number;
  acceptedStanceEvidence: number;
  acceptedChallengeEvidence: number;
}): HexFinanceEvidenceFinancialResult {
  if (input.totalAcceptedEvidence === 0) {
    return "no_financial_win_allowed";
  }
  if (input.acceptedClaims > 0 && input.acceptedStanceEvidence > 0 && input.stanceScore - input.challengeScore >= financialWinDelta) {
    return "stance_survives";
  }
  if (input.acceptedChallenges > 0 && input.acceptedChallengeEvidence > 0 && input.challengeScore - input.stanceScore >= financialWinDelta) {
    return "challenge_breaks_stance";
  }
  return "contested";
}

function buildCombatEffectAllowed(result: HexFinanceEvidenceFinancialResult): HexFinanceCombatEffectAllowed[] {
  if (result === "no_financial_win_allowed") {
    return ["no_effect", "minor_delay"];
  }
  if (result === "contested") {
    return ["pressure"];
  }
  return ["pressure", "force_reposition", "map_control", "possible_kill"];
}

function finalizeSideResult(input: {
  input: MutableSideResult;
  sideScore: number;
  stanceScore: number;
  challengeScore: number;
  financialResult: HexFinanceEvidenceFinancialResult;
  combatEffectAllowed: HexFinanceCombatEffectAllowed[];
}): HexFinanceEvidenceJudgeSideResult {
  const sideLabel = input.input.side === "attack" ? "挑战方" : "立场方";
  const acceptedEvidenceRefs = [...input.input.acceptedEvidenceRefs];
  const rejectedEvidenceRefs = [...input.input.rejectedEvidenceRefs];
  const missingEvidenceApplied = [...input.input.missingEvidenceApplied];
  const scoreCapRefs = [...input.input.scoreCapRefs];
  return {
    side: input.input.side,
    acceptedEvidenceRefs,
    rejectedEvidenceRefs,
    missingEvidenceApplied,
    scoreCapRefs,
    scoreCaps: [...input.input.scoreCaps.values()],
    acceptedClaims: [...input.input.acceptedClaims],
    rejectedClaims: [...input.input.rejectedClaims],
    acceptedChallenges: [...input.input.acceptedChallenges],
    rejectedChallenges: [...input.input.rejectedChallenges],
    acceptedEvidenceRefsByItemId: mapAcceptedEvidenceRefsByItemId(input.input.acceptedEvidenceRefsByItemId),
    sideScore: input.sideScore,
    stanceScore: input.stanceScore,
    challengeScore: input.challengeScore,
    financialResult: input.financialResult,
    combatEffectAllowed: input.combatEffectAllowed,
    adoptionReasons: [...input.input.adoptionReasons],
    rejectionReasons: [...input.input.rejectionReasons],
    auditReasons: [...input.input.auditReasons],
    financeReasonZh: [
      acceptedEvidenceRefs.length > 0
        ? `${sideLabel}采信证据：${acceptedEvidenceRefs.join("、")}。`
        : `${sideLabel}没有被采信的正向证据。`,
      ...(rejectedEvidenceRefs.length > 0 ? [`${sideLabel}未采信引用：${rejectedEvidenceRefs.join("、")}。`] : []),
      ...(missingEvidenceApplied.length > 0 ? [`${sideLabel}缺失证据影响：${missingEvidenceApplied.join("、")}。`] : []),
      ...(scoreCapRefs.length > 0 ? [`${sideLabel}受到评分上限约束：${scoreCapRefs.join("、")}。`] : [])
    ]
  };
}

function buildFinancialResultZh(result: HexFinanceEvidenceFinancialResult, stanceScore: number, challengeScore: number): string {
  if (result === "stance_survives") {
    return `金融裁判：立场方证据链暂时守住，立场分 ${stanceScore}，挑战分 ${challengeScore}。`;
  }
  if (result === "challenge_breaks_stance") {
    return `金融裁判：挑战方击中具体主张，立场分 ${stanceScore}，挑战分 ${challengeScore}。`;
  }
  if (result === "no_financial_win_allowed") {
    return `金融裁判：没有正向采信证据，不能形成金融胜负。`;
  }
  return `金融裁判：双方证据链接近或互有限制，立场分 ${stanceScore}，挑战分 ${challengeScore}。`;
}


function buildMutableSideResult(side: HexSide): MutableSideResult {
  return {
    side,
    acceptedEvidenceRefs: new Set(),
    rejectedEvidenceRefs: new Set(),
    missingEvidenceApplied: new Set(),
    scoreCapRefs: new Set(),
    scoreCaps: new Map(),
    acceptedClaims: new Set(),
    rejectedClaims: new Set(),
    acceptedChallenges: new Set(),
    rejectedChallenges: new Set(),
    acceptedEvidenceRefsByItemId: new Map(),
    score: 0,
    adoptionReasons: new Set(),
    rejectionReasons: new Set(),
    auditReasons: new Set()
  };
}

function addAcceptedEvidenceForItem(sideResult: MutableSideResult, itemId: string, acceptedRefs: readonly string[]): void {
  const normalizedItemId = itemId.trim();
  if (!normalizedItemId || acceptedRefs.length === 0) {
    return;
  }
  const existing = sideResult.acceptedEvidenceRefsByItemId.get(normalizedItemId) ?? new Set<string>();
  for (const ref of acceptedRefs) {
    if (ref.trim()) {
      existing.add(ref);
    }
  }
  sideResult.acceptedEvidenceRefsByItemId.set(normalizedItemId, existing);
}

function mapAcceptedEvidenceRefsByItemId(input: Map<string, Set<string>>): Record<string, string[]> {
  const mapped: Record<string, string[]> = {};
  for (const [itemId, refs] of input) {
    mapped[itemId] = [...refs];
  }
  return mapped;
}

function collectMentionedRequiredEvidenceKeys(text: string, requiredEvidenceSchema: readonly HexFinanceRequiredEvidenceItem[]): string[] {
  const normalizedText = normalizeText(text);
  return requiredEvidenceSchema
    .filter((item) => {
      const key = normalizeText(item.requiredKey);
      const effect = normalizeText(item.missingEffect);
      return (key.length > 0 && normalizedText.includes(key))
        || (effect.length > 8 && normalizedText.includes(effect.slice(0, 16)));
    })
    .map((item) => item.requiredKey);
}

function resolveMissingEffect(requiredKey: string, requiredEvidenceSchema: readonly HexFinanceRequiredEvidenceItem[]): string {
  return requiredEvidenceSchema.find((item) => item.requiredKey === requiredKey)?.missingEffect
    ?? "该必需证据缺失，只能降权或限制结论强度。";
}

function applyScoreCaps(sideResult: MutableSideResult, rawScore: number): number {
  const clampedRawScore = clampScore(rawScore);
  const numericCaps = [...sideResult.scoreCaps.values()]
    .map((cap) => cap.maxScore)
    .filter((cap): cap is number => typeof cap === "number" && Number.isFinite(cap));
  if (numericCaps.length === 0) {
    return clampedRawScore;
  }
  const strongestCap = Math.max(0, Math.min(...numericCaps));
  if (clampedRawScore > strongestCap) {
    sideResult.auditReasons.add(`score_cap_applied:${strongestCap}`);
  }
  return Math.min(clampedRawScore, strongestCap);
}

function isGenericMissingDataChallenge(challenge: HexFinanceChallenge, card: { proxyMismatch: string; challengedAssumption: string }): boolean {
  const text = normalizeText(`${challenge.challengeReasonZh} ${challenge.expectedEffect} ${card.proxyMismatch} ${card.challengedAssumption}`);
  const mentionsOnlyMissing = /数据不足|证据不足|缺少数据|无法判断/.test(text)
    && !/(代理|错配|时间|周期|推理|传导|风险|赔率|估值|库存|需求|claim|主张)/.test(text);
  return mentionsOnlyMissing;
}

function normalizeRef(ref: string): string {
  return ref.trim().toUpperCase();
}

function canonicalClaimTypes(claimTypes: readonly string[] | undefined): string[] {
  return uniqueStrings((claimTypes ?? []).map((claimType) => canonicalClaimType(claimType)));
}

function canonicalClaimType(claimType: string): string {
  const normalized = normalizeClaimType(claimType);
  return claimTypeAliases[normalized] ?? normalized;
}

function normalizeClaimType(claimType: string): string {
  return claimType.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}
