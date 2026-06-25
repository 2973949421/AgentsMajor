#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);

function readArg(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) {
    return fallback;
  }
  return args[index + 1] ?? fallback;
}

function readAllArgs(name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) {
      values.push(args[index + 1]);
      index += 1;
    }
  }
  return values;
}

const financeScenarioSlug = readArg("--map", "dust2-nonferrous");
const outPath = readArg("--out", undefined);
const realProviderBlockedReason = readArg("--real-provider-blocked-reason", undefined);
const explicitTracePaths = readAllArgs("--trace");
const useLatest = args.includes("--latest") || explicitTracePaths.length === 0;

const thresholds = {
  financeVerdictSampleSize: 20,
  phase0OutputSampleSize: 10,
  challengeSampleSize: 10,
  combatExplanationSampleSize: 10,
  maxFinanceWinsWithoutAcceptedEvidence: 0,
  minPhase0ClaimCoverageRatio: 1,
  minChallengeTargetBindRate: 0.8,
  minCombatFinanceCsSeparatedRatio: 1
};

const tracePaths = explicitTracePaths.length > 0
  ? explicitTracePaths.map((path) => resolve(process.cwd(), path))
  : findLatestTracePaths(financeScenarioSlug);

if (tracePaths.length === 0) {
  throw new Error("No hex round trace files found for N61 validation.");
}

const sampleRuns = [
  ...tracePaths.map((path) => analyzeTrace(path, financeScenarioSlug)),
  ...(realProviderBlockedReason ? [buildBlockedRealProviderRun(realProviderBlockedReason)] : [])
];
const summary = buildSummary(sampleRuns);
const report = {
  schemaVersion: 1,
  source: "n61_evidence_bound_round_validation",
  generatedAt: new Date().toISOString(),
  financeScenarioSlug,
  traceSelection: useLatest ? "latest" : "explicit",
  thresholds,
  sampleRuns,
  summary,
  failures: sampleRuns.flatMap((run) => run.failures)
};

if (outPath) {
  const resolvedOut = resolve(process.cwd(), outPath);
  mkdirSync(dirname(resolvedOut), { recursive: true });
  writeFileSync(resolvedOut, `${JSON.stringify(report, null, 2)}
`, "utf8");
}

console.log(JSON.stringify({
  source: report.source,
  financeScenarioSlug,
  sampleCount: sampleRuns.length,
  qualityConclusion: summary.qualityConclusion,
  totalFailures: report.failures.length,
  outPath: outPath ?? null
}, null, 2));

function findLatestTracePaths(mapSlug) {
  const traceDir = resolve(process.cwd(), "data", "artifacts", "hex-round-traces");
  if (!existsSync(traceDir)) {
    return [];
  }
  const candidates = readdirSync(traceDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => resolve(traceDir, name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  const matching = candidates.filter((path) => {
    try {
      const trace = unwrapTrace(JSON.parse(readFileSync(path, "utf8")));
      return getFinanceScenarioSlug(trace) === mapSlug;
    } catch {
      return false;
    }
  });
  return (matching.length > 0 ? matching : candidates).slice(0, 1);
}

function analyzeTrace(path, mapSlug) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const trace = unwrapTrace(raw);
  const financeDuel = trace.financeDuel ?? {};
  const roundStartOutputs = Array.isArray(trace.roundStartAgentOutputs) ? trace.roundStartAgentOutputs : [];
  const combats = collectCombats(trace);
  const decisionQuestion = readDecisionQuestion(financeDuel);
  const claimCatalog = collectClaims(roundStartOutputs);
  const challengeCatalog = collectChallenges(roundStartOutputs);
  const submittedFinanceOutputs = Array.isArray(trace.submittedFinanceOutputs) ? trace.submittedFinanceOutputs : [];
  const submittedFinanceDiagnostics = collectSubmittedFinanceDiagnostics(submittedFinanceOutputs, combats);
  const financeVerdicts = combats.filter(hasFinanceVerdict);
  const phase0Diagnostics = collectPhase0Diagnostics(roundStartOutputs);
  const roundQualityStatus = trace.audit?.roundQualityStatus ?? null;
  const roundQualityReasons = Array.isArray(trace.audit?.roundQualityReasons) ? trace.audit.roundQualityReasons : [];
  const roundQualitySummaryZh = trace.audit?.roundQualitySummaryZh ?? null;
  const financeWinWithoutAcceptedEvidence = financeVerdicts.filter(hasFinancialWinWithoutAcceptedEvidence);
  const combatFinanceFirepowerPositive = combats.filter(hasPositiveFinanceFirepower);
  const combatFinanceFirepowerWithoutAcceptedEvidence = combatFinanceFirepowerPositive.filter((combat) => countAcceptedEvidence(combat.financeEvidenceAdoption) === 0);
  const combatExplanations = combats.filter((combat) => combat.financeProjection || combat.financeEvidenceAdoption || combat.csReasonZh?.length || combat.csReasons?.length);
  const combatFinanceCsSeparated = combatExplanations.filter(hasSeparatedFinanceAndCsReasons);
  const directCombats = combats.filter(hasOpposingCombatParticipants);
  const combatWithN65PressureKey = directCombats.filter(hasN65LitePressureKey);
  const combatMissingN65PressureKey = directCombats.filter((combat) => !hasN65LitePressureKey(combat));
  const combatRegionOnlyPressureKey = directCombats.filter(hasRegionOnlyPressureKey);
  const combatLegacyMissingN65Fields = directCombats.filter((combat) => !hasN65LiteFields(combat));
  const targetClaimBindRate = challengeCatalog.length > 0
    ? roundTo(challengeCatalog.filter((challenge) => claimCatalog.claimIds.has(challenge.targetClaimId)).length / challengeCatalog.length)
    : 0;
  const phase0ClaimCoverageRatio = claimCatalog.claims.length > 0
    ? roundTo(claimCatalog.claims.filter(isClaimValidOrExplicitlyUnsupported).length / claimCatalog.claims.length)
    : 0;
  const combatFinanceCsSeparatedRatio = combatExplanations.length > 0
    ? roundTo(combatFinanceCsSeparated.length / combatExplanations.length)
    : 0;
  const failures = buildFailures({
    path,
    trace,
    financeScenarioSlug: mapSlug,
    decisionQuestion,
    roundStartOutputs,
    claimCatalog,
    challengeCatalog,
    targetClaimBindRate,
    phase0ClaimCoverageRatio,
    combats,
    financeVerdicts,
    financeWinWithoutAcceptedEvidence,
    combatFinanceFirepowerPositive,
    combatFinanceFirepowerWithoutAcceptedEvidence,
    directCombats,
    combatWithN65PressureKey,
    combatMissingN65PressureKey,
    combatRegionOnlyPressureKey,
    combatLegacyMissingN65Fields,
    combatExplanations,
    combatFinanceCsSeparatedRatio,
    phase0Diagnostics,
    roundQualityStatus,
    roundQualityReasons,
    roundQualitySummaryZh,
    submittedFinanceOutputs,
    submittedFinanceDiagnostics
  });
  const providerMode = trace.audit?.providerMode ?? inferProviderMode(roundStartOutputs);
  const qualityConclusion = classifyRunQuality(failures);

  return {
    mapGameId: trace.artifactOwner?.mapGameId ?? trace.mapGameId ?? null,
    roundId: trace.roundId ?? null,
    roundNumber: trace.roundNumber ?? null,
    providerMode,
    traceArtifactPath: normalizePath(path),
    roundQualityStatus,
    roundQualityReasons,
    roundQualitySummaryZh,
    financeScenarioSlug: getFinanceScenarioSlug(trace),
    decisionQuestionPresent: Boolean(decisionQuestion),
    decisionQuestion: decisionQuestion ?? null,
    stanceCardCount: roundStartOutputs.filter((output) => output.cardKind === "stance" && output.stanceCard).length,
    challengeCardCount: roundStartOutputs.filter((output) => output.cardKind === "challenge" && output.challengeCard).length,
    phase0OutputCount: roundStartOutputs.length,
    usablePhase0OutputCount: phase0Diagnostics.usablePhase0OutputCount,
    invalidPhase0OutputCount: phase0Diagnostics.invalidPhase0OutputCount,
    providerErrorPhase0Count: phase0Diagnostics.providerErrorPhase0Count,
    invalidStanceCardCount: phase0Diagnostics.invalidStanceCardCount,
    invalidChallengeCardCount: phase0Diagnostics.invalidChallengeCardCount,
    skippedChallengeNoClaimCatalogCount: phase0Diagnostics.skippedChallengeNoClaimCatalogCount,
    validClaimCount: claimCatalog.claims.filter(isClaimValidOrExplicitlyUnsupported).length,
    claimCount: claimCatalog.claims.length,
    phase0ClaimCoverageRatio,
    validChallengeCount: challengeCatalog.filter((challenge) => claimCatalog.claimIds.has(challenge.targetClaimId)).length,
    challengeCount: challengeCatalog.length,
targetClaimBindRate,
    submittedFinanceOutputCount: submittedFinanceOutputs.length,
    submittedFinanceUsableForJudgeCount: submittedFinanceDiagnostics.usableForJudgeCount,
    submittedFinanceUsableForCombatCount: submittedFinanceDiagnostics.usableForCombatCount,
    ecoSubmittedPossibleKillCount: submittedFinanceDiagnostics.ecoSubmittedPossibleKillCount,
    combatJudgeInputSubmittedCount: submittedFinanceDiagnostics.combatJudgeInputSubmittedCount,
    combatJudgeInputLegacyCount: submittedFinanceDiagnostics.combatJudgeInputLegacyCount,
    financeVerdictCount: financeVerdicts.length,
    financeWinWithoutAcceptedEvidenceCount: financeWinWithoutAcceptedEvidence.length,
    combatFinanceFirepowerPositiveCount: combatFinanceFirepowerPositive.length,
    combatFinanceFirepowerWithoutAcceptedEvidenceCount: combatFinanceFirepowerWithoutAcceptedEvidence.length,
    directCombatCount: directCombats.length,
    combatWithN65PressureKeyCount: combatWithN65PressureKey.length,
    combatMissingN65PressureKeyCount: combatMissingN65PressureKey.length,
    combatRegionOnlyPressureKeyCount: combatRegionOnlyPressureKey.length,
    combatLegacyMissingN65FieldsCount: combatLegacyMissingN65Fields.length,
    combatExplanationCount: combatExplanations.length,
    combatFinanceCsSeparatedCount: combatFinanceCsSeparated.length,
    combatFinanceCsSeparatedRatio,
    hardWinnerSource: readHardWinnerSource(trace),
    qualityConclusion,
    failures
  };
}

function buildBlockedRealProviderRun(reason) {
  const failure = {
    category: "provider_error",
    message: `real provider 样本未执行：${reason}`,
    traceArtifactPath: null
  };
  return {
    mapGameId: null,
    roundId: null,
    roundNumber: null,
    providerMode: "real",
    traceArtifactPath: null,
    financeScenarioSlug,
    decisionQuestionPresent: false,
    decisionQuestion: null,
    stanceCardCount: 0,
    challengeCardCount: 0,
    phase0OutputCount: 0,
    usablePhase0OutputCount: 0,
    invalidPhase0OutputCount: 0,
    providerErrorPhase0Count: 0,
    invalidStanceCardCount: 0,
    invalidChallengeCardCount: 0,
    skippedChallengeNoClaimCatalogCount: 0,
    validClaimCount: 0,
    claimCount: 0,
    phase0ClaimCoverageRatio: 0,
    validChallengeCount: 0,
    challengeCount: 0,
    targetClaimBindRate: 0,
    financeVerdictCount: 0,
    financeWinWithoutAcceptedEvidenceCount: 0,
    combatFinanceFirepowerPositiveCount: 0,
    combatFinanceFirepowerWithoutAcceptedEvidenceCount: 0,
    directCombatCount: 0,
    combatWithN65PressureKeyCount: 0,
    combatMissingN65PressureKeyCount: 0,
    combatRegionOnlyPressureKeyCount: 0,
    combatLegacyMissingN65FieldsCount: 0,
    combatExplanationCount: 0,
    combatFinanceCsSeparatedCount: 0,
    combatFinanceCsSeparatedRatio: 0,
    hardWinnerSource: null,
    roundQualityStatus: null,
    roundQualityReasons: [],
    roundQualitySummaryZh: null,
    qualityConclusion: "blocked_real_provider",
    failures: [failure]
  };
}
function classifyRunQuality(failures) {
  if (failures.length === 0) {
    return "pass";
  }
  if (failures.some((failure) => failure.category === "blocked_real_provider")) {
    return "blocked_real_provider";
  }
  const hardFailureCategories = new Set([
    "provider_error",
    "invalid_round",
    "provider_degraded",
    "invalid_stance_card",
    "invalid_challenge_card",
    "missing_target_claim",
    "no_valid_claim_catalog",
    "no_accepted_evidence",
    "finance_projection_mismatch",
    "combat_reason_mixed",
    "old_trace_missing_fields",
    "web_audit_incomplete",
    "missing_submitted_finance_output",
    "finance_submitted_cap_violation",
    "judge_input_not_submitted",
    "missing_n65_pressure_key",
    "invalid_n65_pressure_key"
  ]);
  return failures.some((failure) => hardFailureCategories.has(failure.category))
    ? "fail"
    : "partial_pass";
}
function unwrapTrace(raw) {
  return raw?.trace ?? raw;
}

function readDecisionQuestion(financeDuel) {
  return financeDuel?.decisionQuestion?.question
    ?? financeDuel?.topic?.decisionQuestion
    ?? (typeof financeDuel?.decisionQuestion === "string" ? financeDuel.decisionQuestion : undefined);
}

function getFinanceScenarioSlug(trace) {
  return trace.financeDuel?.evidencePackRef?.financeMapSlug
    ?? trace.financeDuel?.sourceAudit?.financeScenarioSlug
    ?? trace.financeScenarioSlug
    ?? trace.mapSlug
    ?? null;
}

function collectPhase0Diagnostics(outputs) {
  const hasError = (output, pattern) => Array.isArray(output.technicalRefs?.errors)
    && output.technicalRefs.errors.some((error) => pattern.test(error));
  return outputs.reduce((acc, output) => {
    const source = output.source;
    if (output.usableForPhaseAction !== false && source !== "invalid_response" && source !== "provider_error") {
      acc.usablePhase0OutputCount += 1;
    }
    if (source === "invalid_response") {
      acc.invalidPhase0OutputCount += 1;
    }
    if (source === "provider_error") {
      acc.providerErrorPhase0Count += 1;
    }
    if (hasError(output, /round_start:no_valid_claim_catalog/)) {
      acc.skippedChallengeNoClaimCatalogCount += 1;
    }
    const isStanceSide = output.teamSide === "defense" || output.cardKind === "stance" || Boolean(output.stanceCard);
    const isChallengeSide = output.teamSide === "attack" || output.cardKind === "challenge" || Boolean(output.challengeCard);
    if (isStanceSide && (source === "invalid_response" || source === "provider_error") && !output.stanceCard) {
      acc.invalidStanceCardCount += 1;
    }
    if (isChallengeSide && (source === "invalid_response" || source === "provider_error") && !output.challengeCard) {
      acc.invalidChallengeCardCount += 1;
    }
    return acc;
  }, {
    usablePhase0OutputCount: 0,
    invalidPhase0OutputCount: 0,
    providerErrorPhase0Count: 0,
    invalidStanceCardCount: 0,
    invalidChallengeCardCount: 0,
    skippedChallengeNoClaimCatalogCount: 0
  });
}
function collectSubmittedFinanceDiagnostics(outputs, combats) {
  const ecoSubmittedPossibleKillCount = outputs.filter((output) =>
    ["eco", "save"].includes(output.clippingTier) && output.combatEffectCap === "possible_kill"
  ).length;
  const combatJudgeInputSubmittedCount = combats.filter((combat) => combatHasJudgeInput(combat, "submitted_finance_outputs")).length;
  const combatJudgeInputLegacyCount = combats.filter((combat) => combatHasJudgeInput(combat, "legacy_round_start_outputs")).length;
  return {
    usableForJudgeCount: outputs.filter((output) => output.submittedUsableForJudge === true).length,
    usableForCombatCount: outputs.filter((output) => output.submittedUsableForCombat === true).length,
    ecoSubmittedPossibleKillCount,
    combatJudgeInputSubmittedCount,
    combatJudgeInputLegacyCount
  };
}

function combatHasJudgeInput(combat, mode) {
  const reasons = [
    ...(combat.financeEvidenceAdoption?.attack?.auditReasons ?? []),
    ...(combat.financeEvidenceAdoption?.defense?.auditReasons ?? [])
  ];
  return reasons.includes(`judge_input:${mode}`);
}
function collectClaims(outputs) {
  const claims = [];
  for (const output of outputs) {
    const card = output.stanceCard;
    if (!card || !Array.isArray(card.coreClaims)) {
      continue;
    }
    for (const claim of card.coreClaims) {
      claims.push({
        agentId: output.agentId,
        cardId: card.cardId,
        claimId: claim.claimId,
        claimType: claim.claimType,
        evidenceRefs: Array.isArray(claim.evidenceRefs) ? claim.evidenceRefs : [],
        reasoningBridge: claim.reasoningBridge,
        unsupportedIfEvidenceRejected: claim.unsupportedIfEvidenceRejected
      });
    }
  }
  return {
    claims,
    claimIds: new Set(claims.map((claim) => claim.claimId).filter(Boolean))
  };
}

function collectChallenges(outputs) {
  const challenges = [];
  for (const output of outputs) {
    const card = output.challengeCard;
    if (!card) {
      continue;
    }
    const nested = Array.isArray(card.challenges) && card.challenges.length > 0
      ? card.challenges
      : [card];
    for (const challenge of nested) {
      challenges.push({
        agentId: output.agentId,
        cardId: card.cardId,
        challengeId: challenge.challengeId ?? card.challengeId,
        targetClaimId: challenge.targetClaimId ?? card.targetClaimId,
        challengeType: challenge.challengeType ?? card.challengeType,
        evidenceRefs: Array.isArray(challenge.evidenceRefs) ? challenge.evidenceRefs : Array.isArray(card.evidenceRefs) ? card.evidenceRefs : []
      });
    }
  }
  return challenges;
}

function isClaimValidOrExplicitlyUnsupported(claim) {
  if (claim.unsupportedIfEvidenceRejected === true) {
    return Boolean(claim.claimId && claim.claimType);
  }
  return Boolean(
    claim.claimId
      && claim.claimType
      && claim.evidenceRefs.length > 0
      && typeof claim.reasoningBridge === "string"
      && claim.reasoningBridge.trim().length > 0
  );
}

function collectCombats(trace) {
  const phases = Array.isArray(trace.phases) ? trace.phases : [];
  return phases.flatMap((phase) => {
    if (Array.isArray(phase.combatResolutions)) {
      return phase.combatResolutions;
    }
    if (Array.isArray(phase.combat?.resolutions)) {
      return phase.combat.resolutions;
    }
    if (Array.isArray(phase.combat)) {
      return phase.combat;
    }
    return [];
  });
}

function hasFinanceVerdict(combat) {
  return Boolean(combat.financeProjection || combat.financeEvidenceAdoption || combat.financeVerdict);
}

function hasPositiveFinanceFirepower(combat) {
  const scores = [combat.scores?.attack?.financeFirepowerScore, combat.scores?.defense?.financeFirepowerScore, combat.financeFirepowerAttack, combat.financeFirepowerDefense].filter(Boolean);
  return scores.some((score) => Number(score.appliedToCombatScore ?? 0) > 0 || Number(score.totalScore ?? 0) > 0);
}
function hasFinancialWinWithoutAcceptedEvidence(combat) {
  const financialResult = combat.financeProjection?.financialResult
    ?? combat.financeEvidenceAdoption?.attack?.financialResult
    ?? combat.financeEvidenceAdoption?.defense?.financialResult
    ?? legacyFinanceVerdictToFinancialResult(combat.financeVerdict);
  if (financialResult !== "stance_survives" && financialResult !== "challenge_breaks_stance") {
    return false;
  }
  return countAcceptedEvidence(combat.financeEvidenceAdoption) === 0;
}

function legacyFinanceVerdictToFinancialResult(verdict) {
  if (verdict === "thesis_defended") {
    return "stance_survives";
  }
  if (verdict === "challenge_landed") {
    return "challenge_breaks_stance";
  }
  return undefined;
}

function countAcceptedEvidence(adoption) {
  if (!adoption) {
    return 0;
  }
  return (adoption.attack?.acceptedEvidenceRefs?.length ?? 0)
    + (adoption.defense?.acceptedEvidenceRefs?.length ?? 0);
}

function hasSeparatedFinanceAndCsReasons(combat) {
  const hasFinance = Boolean(
    combat.financeProjection?.projectionReasonsZh?.length
      || combat.financeReasonZh?.length
      || combat.financeEvidenceAdoption
  );
  const hasCs = Boolean(combat.csReasonZh?.length || combat.csReasons?.length);
  return hasFinance && hasCs;
}

function readHardWinnerSource(trace) {
  const condition = trace.finalWinCondition ?? trace.finalHardCondition ?? trace.hardWinner;
  if (!condition) {
    return null;
  }
  return condition.judgeRoundWinType
    ?? condition.roundWinType
    ?? condition.reason
    ?? condition.type
    ?? (condition.isRoundOver ? "hard_condition_recorded" : null);
}

function inferProviderMode(outputs) {
  if (outputs.some((output) => output.source === "llm_response_artifact")) {
    return "real";
  }
  if (outputs.some((output) => output.source === "fixture_response")) {
    return "fixture";
  }
  return "unknown";
}

function hasOpposingCombatParticipants(combat) {
  const participants = Array.isArray(combat.participants) ? combat.participants : [];
  const sides = new Set(participants.map((participant) => participant?.side).filter(Boolean));
  return sides.has("attack") && sides.has("defense");
}

function hasN65LiteFields(combat) {
  return Array.isArray(combat.duelPairs) || Array.isArray(combat.fireLanes) || Array.isArray(combat.pressureKeys) || Boolean(combat.audit?.duelPairing);
}

function collectN65PressureKeys(combat) {
  const keys = [];
  if (Array.isArray(combat.pressureKeys)) keys.push(...combat.pressureKeys);
  if (Array.isArray(combat.duelPairs)) keys.push(...combat.duelPairs.map((pair) => pair?.pressureKey).filter(Boolean));
  if (Array.isArray(combat.audit?.duelPairing?.pressureKeys)) keys.push(...combat.audit.duelPairing.pressureKeys);
  return [...new Set(keys.filter((key) => typeof key === "string" && key.length > 0))];
}

function hasN65LitePressureKey(combat) {
  return collectN65PressureKeys(combat).some(isAllowedN65PressureKey);
}

function hasRegionOnlyPressureKey(combat) {
  const keys = collectN65PressureKeys(combat);
  return keys.length > 0 && keys.some((key) => !isAllowedN65PressureKey(key));
}

function isAllowedN65PressureKey(key) {
  return key.startsWith("duelPair:") || key.startsWith("fireLane:") || key.startsWith("objective_exposure:") || key.startsWith("cell_contact:");
}
function buildFailures(input) {
  const failures = [];
  const add = (category, message, extra = {}) => {
    failures.push({
      category,
      message,
      traceArtifactPath: normalizePath(input.path),
      ...extra
    });
  };
  if (!input.trace?.audit || input.roundQualityStatus === null) {
    add("old_trace_missing_fields", "trace 未记录 P0 roundQualityStatus 质量闸门。");
  }
  if (input.roundQualityStatus && input.roundQualityStatus !== "valid") {
    add(input.roundQualityStatus === "provider_degraded" ? "provider_degraded" : "invalid_round", input.roundQualitySummaryZh ?? `round quality gate 未通过：${input.roundQualityStatus}`, {
      roundQualityStatus: input.roundQualityStatus,
      roundQualityReasons: input.roundQualityReasons
    });
  }
  if (!input.decisionQuestion) {
    add("old_trace_missing_fields", "trace 未记录 N56 decisionQuestion。");
  }
  if (input.roundStartOutputs.length === 0) {
    add("old_trace_missing_fields", "trace 未记录 roundStartAgentOutputs。");
  }
  if (input.roundStartOutputs.length > 0 && input.claimCatalog.claims.length === 0) {
    if (input.phase0Diagnostics.invalidStanceCardCount > 0 || input.phase0Diagnostics.providerErrorPhase0Count > 0) {
      add("invalid_stance_card", "真实 phase0 未产生可消费 stanceCard / coreClaims。", {
        invalidStanceCardCount: input.phase0Diagnostics.invalidStanceCardCount,
        providerErrorPhase0Count: input.phase0Diagnostics.providerErrorPhase0Count
      });
    } else {
      add("old_trace_missing_fields", "trace 未记录 N58 stanceCard / coreClaims。");
    }
  }
  if (input.roundStartOutputs.length > 0 && input.challengeCatalog.length === 0) {
    if (input.phase0Diagnostics.skippedChallengeNoClaimCatalogCount > 0) {
      add("no_valid_claim_catalog", "立场方没有合法 claimCatalog，挑战方按规则跳过真实模型调用。", {
        skippedChallengeNoClaimCatalogCount: input.phase0Diagnostics.skippedChallengeNoClaimCatalogCount
      });
    } else if (input.phase0Diagnostics.invalidChallengeCardCount > 0 || input.phase0Diagnostics.providerErrorPhase0Count > 0) {
      add("invalid_challenge_card", "真实 phase0 未产生可消费 challengeCard / challenges。", {
        invalidChallengeCardCount: input.phase0Diagnostics.invalidChallengeCardCount,
        providerErrorPhase0Count: input.phase0Diagnostics.providerErrorPhase0Count
      });
    } else {
      add("old_trace_missing_fields", "trace 未记录 N58 challengeCard / challenges。");
    }
  }
  if (input.phase0ClaimCoverageRatio < thresholds.minPhase0ClaimCoverageRatio && input.claimCatalog.claims.length > 0) {
    add("invalid_stance_card", "phase0 claim 缺少 claimId / claimType / evidenceRefs / reasoningBridge，且未显式标记 unsupported。", {
      phase0ClaimCoverageRatio: input.phase0ClaimCoverageRatio
    });
  }
  if (input.challengeCatalog.length > 0 && input.targetClaimBindRate < thresholds.minChallengeTargetBindRate) {
    add("missing_target_claim", "challenge 绑定真实 targetClaimId 的比例不足。", {
      targetClaimBindRate: input.targetClaimBindRate
    });
  }
  if (input.roundStartOutputs.length > 0 && input.submittedFinanceOutputs.length === 0) {
    add("missing_submitted_finance_output", "trace 未记录 N62 submittedFinanceOutputs；无法确认 judge 是否吃到经济裁剪后的提交卡。");
  }
  if (input.submittedFinanceDiagnostics.ecoSubmittedPossibleKillCount > 0) {
    add("finance_submitted_cap_violation", "eco / save submitted finance output 出现 possible_kill cap，违反 N62 经济裁剪。", {
      count: input.submittedFinanceDiagnostics.ecoSubmittedPossibleKillCount
    });
  }
  if (input.submittedFinanceOutputs.length > 0 && input.combats.length > 0 && input.submittedFinanceDiagnostics.combatJudgeInputSubmittedCount === 0) {
    add("judge_input_not_submitted", "combat 金融裁判链未记录 judge_input:submitted_finance_outputs。", {
      combatCount: input.combats.length
    });
  }
  if (input.submittedFinanceDiagnostics.combatJudgeInputLegacyCount > 0) {
    add("judge_input_not_submitted", "combat 金融裁判链仍出现 legacy_round_start_outputs，说明 raw phase0 仍可能绕过 N62 提交门。", {
      count: input.submittedFinanceDiagnostics.combatJudgeInputLegacyCount
    });
  }
  if (input.financeWinWithoutAcceptedEvidence.length > thresholds.maxFinanceWinsWithoutAcceptedEvidence) {
    add("no_accepted_evidence", "存在无 accepted evidence 却判金融胜利的 combat。", {
      count: input.financeWinWithoutAcceptedEvidence.length
    });
  }
  if (input.combatFinanceFirepowerWithoutAcceptedEvidence.length > 0) {
    add("finance_firepower_without_accepted_evidence", "存在无 accepted evidence 却产生 N63 正金融火力的 combat。", {
      count: input.combatFinanceFirepowerWithoutAcceptedEvidence.length
    });
  }
  if (input.combats.length > 0 && input.combats.some((combat) => !combat.financeProjection)) {
    add("old_trace_missing_fields", "部分 combat 未记录 N60 financeProjection。");
  }
  if (input.combatExplanations.length > 0 && input.combatFinanceCsSeparatedRatio < thresholds.minCombatFinanceCsSeparatedRatio) {
    add("combat_reason_mixed", "combat 解释未全部区分金融原因和 CS 执行原因。", {
      combatFinanceCsSeparatedRatio: input.combatFinanceCsSeparatedRatio
    });
  }
  if (!readHardWinnerSource(input.trace)) {
    add("old_trace_missing_fields", "trace 未记录可审计 hard winner 来源。");
  }
  if (input.roundStartOutputs.some((output) => output.source === "provider_error")) {
    add("provider_error", "phase0 存在 provider_error，不能宣称 real 样本通过。");
  }
  return failures;
}

function buildSummary(runs) {
  const totals = runs.reduce((acc, run) => {
    acc.financeVerdictCount += run.financeVerdictCount;
    acc.financeWinWithoutAcceptedEvidenceCount += run.financeWinWithoutAcceptedEvidenceCount;
    acc.combatFinanceFirepowerPositiveCount += run.combatFinanceFirepowerPositiveCount ?? 0;
    acc.combatFinanceFirepowerWithoutAcceptedEvidenceCount += run.combatFinanceFirepowerWithoutAcceptedEvidenceCount ?? 0;
    acc.directCombatCount += run.directCombatCount ?? 0;
    acc.combatWithN65PressureKeyCount += run.combatWithN65PressureKeyCount ?? 0;
    acc.combatMissingN65PressureKeyCount += run.combatMissingN65PressureKeyCount ?? 0;
    acc.combatRegionOnlyPressureKeyCount += run.combatRegionOnlyPressureKeyCount ?? 0;
    acc.combatLegacyMissingN65FieldsCount += run.combatLegacyMissingN65FieldsCount ?? 0;
    acc.phase0OutputCount += run.phase0OutputCount;
    acc.usablePhase0OutputCount += run.usablePhase0OutputCount;
    acc.invalidPhase0OutputCount += run.invalidPhase0OutputCount;
    acc.providerErrorPhase0Count += run.providerErrorPhase0Count;
    acc.invalidStanceCardCount += run.invalidStanceCardCount;
    acc.invalidChallengeCardCount += run.invalidChallengeCardCount;
    acc.skippedChallengeNoClaimCatalogCount += run.skippedChallengeNoClaimCatalogCount;
    acc.claimCount += run.claimCount;
    acc.validClaimCount += run.validClaimCount;
    acc.challengeCount += run.challengeCount;
    acc.validChallengeCount += run.validChallengeCount;
    acc.submittedFinanceOutputCount += run.submittedFinanceOutputCount ?? 0;
    acc.submittedFinanceUsableForJudgeCount += run.submittedFinanceUsableForJudgeCount ?? 0;
    acc.submittedFinanceUsableForCombatCount += run.submittedFinanceUsableForCombatCount ?? 0;
    acc.ecoSubmittedPossibleKillCount += run.ecoSubmittedPossibleKillCount ?? 0;
    acc.combatJudgeInputSubmittedCount += run.combatJudgeInputSubmittedCount ?? 0;
    acc.combatJudgeInputLegacyCount += run.combatJudgeInputLegacyCount ?? 0;
    acc.combatExplanationCount += run.combatExplanationCount;
    acc.combatFinanceCsSeparatedCount += run.combatFinanceCsSeparatedCount;
    acc.failureCount += run.failures.length;
    if (run.roundQualityStatus === "invalid_round") {
      acc.invalidRoundCount += 1;
    }
    if (run.roundQualityStatus === "provider_degraded") {
      acc.providerDegradedRoundCount += 1;
    }
    if (!run.roundQualityStatus) {
      acc.legacyNoQualityGateCount += 1;
    }
    if (run.roundQualityStatus === "valid") {
      acc.normalScoredRoundCount += 1;
    }
    return acc;
  }, {
    financeVerdictCount: 0,
    financeWinWithoutAcceptedEvidenceCount: 0,
    combatFinanceFirepowerPositiveCount: 0,
    combatFinanceFirepowerWithoutAcceptedEvidenceCount: 0,
    directCombatCount: 0,
    combatWithN65PressureKeyCount: 0,
    combatMissingN65PressureKeyCount: 0,
    combatRegionOnlyPressureKeyCount: 0,
    combatLegacyMissingN65FieldsCount: 0,
    phase0OutputCount: 0,
    usablePhase0OutputCount: 0,
    invalidPhase0OutputCount: 0,
    providerErrorPhase0Count: 0,
    invalidStanceCardCount: 0,
    invalidChallengeCardCount: 0,
    skippedChallengeNoClaimCatalogCount: 0,
    claimCount: 0,
    validClaimCount: 0,
    challengeCount: 0,
    validChallengeCount: 0,
    submittedFinanceOutputCount: 0,
    submittedFinanceUsableForJudgeCount: 0,
    submittedFinanceUsableForCombatCount: 0,
    ecoSubmittedPossibleKillCount: 0,
    combatJudgeInputSubmittedCount: 0,
    combatJudgeInputLegacyCount: 0,
    combatExplanationCount: 0,
    combatFinanceCsSeparatedCount: 0,
    failureCount: 0,
    invalidRoundCount: 0,
    providerDegradedRoundCount: 0,
    normalScoredRoundCount: 0,
    legacyNoQualityGateCount: 0
  });
  const claimCoverageRatio = totals.claimCount > 0 ? roundTo(totals.validClaimCount / totals.claimCount) : 0;
  const challengeTargetBindRate = totals.challengeCount > 0 ? roundTo(totals.validChallengeCount / totals.challengeCount) : 0;
  const combatFinanceCsSeparatedRatio = totals.combatExplanationCount > 0
    ? roundTo(totals.combatFinanceCsSeparatedCount / totals.combatExplanationCount)
    : 0;
  const hasBlockedProvider = runs.some((run) => run.qualityConclusion === "blocked_real_provider");
  const hasPass = runs.some((run) => run.qualityConclusion === "pass");
  const hasFail = runs.some((run) => run.qualityConclusion === "fail");
  const qualityConclusion = totals.failureCount === 0
    ? "pass"
    : hasBlockedProvider && !hasPass && !hasFail
      ? "blocked_real_provider"
      : hasPass
        ? "partial_pass"
        : "fail";
  return {
    ...totals,
    claimCoverageRatio,
    challengeTargetBindRate,
    combatFinanceCsSeparatedRatio,
    qualityConclusion
  };
}

function normalizePath(path) {
  return path.replaceAll("\\", "/");
}

function roundTo(value) {
  return Math.round(value * 1000) / 1000;
}
