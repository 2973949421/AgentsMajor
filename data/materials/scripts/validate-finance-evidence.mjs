import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const materialsRoot = path.resolve(__dirname, "..");
const generatedFinanceRoot = path.join(materialsRoot, "generated", "finance");
const requiredAllowedStance = [
  "bullish",
  "bearish",
  "neutral",
  "structural",
  "conditional_bullish",
  "conditional_bearish",
  "no_trade"
];

function parseArgs(argv) {
  const args = { map: "dust2-nonferrous", factBank: false, sourceProbes: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--map") args.map = argv[++index];
    else if (argv[index] === "--fact-bank") args.factBank = true;
    else if (argv[index] === "--source-probes") args.sourceProbes = true;
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateFact(fact, context) {
  for (const field of [
    "factId",
    "statement",
    "metricName",
    "source",
    "sourceType",
    "collector",
    "evidenceId",
    "confidence",
    "rawHash",
    "parserVersion",
    "originalLocation"
  ]) {
    assert(fact[field] !== undefined && fact[field] !== "", `${context} fact missing ${field}.`);
  }
  assert(/^EVID:/.test(fact.evidenceId), `${context} fact has invalid evidenceId ${fact.evidenceId}.`);
  assert(!/api[_-]?key|secret|token/i.test(JSON.stringify(fact)), `${context} fact appears to contain secret-like text.`);
}

function validateDecisionQuestionContract(pack, context) {
  assert(pack.decisionQuestion && pack.decisionQuestion !== pack.legacyDefenseThesisFocus, `${context} must include an N56 decisionQuestion.`);
  assert(pack.decisionObject, `${context} must include decisionObject.`);
  assert(pack.horizon, `${context} must include horizon.`);
  assert(pack.benchmark, `${context} must include benchmark.`);
  assert(Array.isArray(pack.allowedStance), `${context} must include allowedStance.`);
  for (const stance of requiredAllowedStance) {
    assert(pack.allowedStance.includes(stance), `${context} allowedStance missing ${stance}.`);
  }
  assert(Array.isArray(pack.requiredOutput) && pack.requiredOutput.length >= 1, `${context} must include requiredOutput.`);
  assert(Array.isArray(pack.requiredEvidenceSchema) && pack.requiredEvidenceSchema.length >= 1, `${context} must include requiredEvidenceSchema.`);
  for (const [index, item] of pack.requiredEvidenceSchema.entries()) {
    const itemContext = `${context} requiredEvidenceSchema[${index}]`;
    assert(item.requiredKey, `${itemContext} missing requiredKey.`);
    assert(Array.isArray(item.requiredForClaimTypes) && item.requiredForClaimTypes.length >= 1, `${itemContext} missing requiredForClaimTypes.`);
    assert(Number.isFinite(item.minimumFactCount), `${itemContext} missing minimumFactCount.`);
    assert(Array.isArray(item.preferredSources), `${itemContext} missing preferredSources.`);
    assert(Array.isArray(item.fallbackSources), `${itemContext} missing fallbackSources.`);
    assert(item.missingEffect, `${itemContext} missing missingEffect.`);
    assert(item.notWinCondition === true, `${itemContext} must mark missing evidence as notWinCondition.`);
  }
  assert(pack.challengePolicy?.mustTargetClaimId === true, `${context} challengePolicy must require target claim id.`);
  assert(Array.isArray(pack.challengePolicy?.allowedChallengeTypes) && pack.challengePolicy.allowedChallengeTypes.length >= 1, `${context} challengePolicy missing allowedChallengeTypes.`);
  assert(Array.isArray(pack.challengePolicy?.invalidChallengePatterns) && pack.challengePolicy.invalidChallengePatterns.length >= 1, `${context} challengePolicy missing invalidChallengePatterns.`);
  assert(pack.challengePolicy?.missingEvidenceCanOnlyCap === true, `${context} challengePolicy must cap missing evidence instead of treating it as a win.`);
  assert(!/证明有色行业具备景气上行线索/.test(pack.decisionQuestion), `${context} decisionQuestion still contains legacy proof wording.`);
}

function validateFactBankFact(fact, context) {
  const requiredFields = [
    "factId",
    "statementZh",
    "metricName",
    "source",
    "sourceType",
    "sourcePublisher",
    "accessProvider",
    "collector",
    "endpoint",
    "evidenceId",
    "confidence",
    "rawHash",
    "parserVersion",
    "originalLocation",
    "transform",
    "reliabilityTier",
    "allowedClaimTypes",
    "notAllowedClaimTypes",
    "interpretationHint",
    "scoreCapPolicy",
    "dataMode",
    "generatedAt"
  ];
  for (const field of requiredFields) {
    assert(fact[field] !== undefined && fact[field] !== "", `${context} fact bank fact missing ${field}.`);
  }
  assert(/^EVID:/.test(fact.evidenceId), `${context} fact bank fact has invalid evidenceId ${fact.evidenceId}.`);
  assert(
    ["offline_observation_fact", "unavailable_observation"].includes(fact.dataMode),
    `${context} fact bank fact has unsupported dataMode ${fact.dataMode}.`
  );
  if (fact.dataMode === "offline_observation_fact") {
    assert(fact.value !== null && fact.value !== undefined && fact.value !== "", `${context} observed fact missing value.`);
    assert(fact.period && fact.period !== "configured", `${context} observed fact missing concrete period.`);
    assert(fact.unit !== undefined, `${context} observed fact missing unit.`);
  }
  if (fact.dataMode === "unavailable_observation") {
    assert(fact.unavailableReason, `${context} unavailable fact missing unavailableReason.`);
    assert(fact.sourceWarning, `${context} unavailable fact missing sourceWarning.`);
  }
  assert(Array.isArray(fact.allowedClaimTypes), `${context} allowedClaimTypes must be an array.`);
  assert(Array.isArray(fact.notAllowedClaimTypes), `${context} notAllowedClaimTypes must be an array.`);
  assert(!/api[_-]?key|secret|token/i.test(JSON.stringify(fact.value)), `${context} fact value appears secret-like.`);
}

function validateCoverageReport(root) {
  const coveragePath = path.join(root, "coverage-report.json");
  assert(fs.existsSync(coveragePath), "Missing coverage-report.json.");
  const coverage = readJson(coveragePath);
  assert(coverage.schemaVersion === 1, "Coverage report schemaVersion must be 1.");
  assert(Array.isArray(coverage.coverageItems) && coverage.coverageItems.length >= 1, "Coverage report must include coverageItems.");
  for (const [index, item] of coverage.coverageItems.entries()) {
    const context = `coverage[${index}]`;
    for (const field of ["roundNumber", "roundKey", "requiredEvidenceKey", "matchedFactIds", "coverageStatus", "remainingGaps", "scoreCapPolicy"]) {
      assert(item[field] !== undefined, `${context} missing ${field}.`);
    }
    assert(["covered", "partial", "missing"].includes(item.coverageStatus), `${context} invalid coverageStatus ${item.coverageStatus}.`);
    assert(item.notWinCondition === true, `${context} must preserve notWinCondition.`);
  }
}

function validateFactBank(map) {
  const root = path.join(generatedFinanceRoot, "fact-bank", map);
  const latestPath = path.join(root, "latest.json");
  assert(fs.existsSync(latestPath), `Missing ${latestPath}`);
  const latest = readJson(latestPath);
  assert(latest.schemaVersion === 2, "Fact bank schemaVersion must be 2 for N57.");
  assert(latest.mapBindingId === "dust2_nonferrous_industry_judgment_v1", "Fact bank has unexpected mapBindingId.");
  assert(latest.dataMode === "offline_fact_bank_snapshot", "Fact bank dataMode must be offline_fact_bank_snapshot.");
  assert(Array.isArray(latest.sourceStatus) && latest.sourceStatus.length >= 5, "Fact bank must include N57 sourceStatus.");
  assert(Array.isArray(latest.facts) && latest.facts.length >= 1, "Fact bank must include facts.");
  assert(!/FRED_API_KEY|UN_COMTRADE_KEY|UN_COMTRADE_SECONDARY_KEY/.test(JSON.stringify(latest)), "Fact bank leaks env key names.");
  assert(!/api[_-]?key["']?\s*[:=]\s*["'][^"']{4,}/i.test(JSON.stringify(latest)), "Fact bank appears to contain API key material.");

  const sourceStatus = new Map(latest.sourceStatus.map((item) => [item.sourceId, item]));
  assert(sourceStatus.get("fred"), "Fact bank missing FRED source status.");
  assert(sourceStatus.get("baostock"), "Fact bank missing BaoStock source status.");
  assert(sourceStatus.get("akshare_futures"), "Fact bank missing AKShare futures source status.");
  assert(sourceStatus.get("world_bank"), "Fact bank missing World Bank source status.");
  assert(sourceStatus.get("un_comtrade"), "Fact bank missing UN Comtrade source status.");

  const observedFred = latest.facts.some((fact) => fact.source === "FRED" && fact.dataMode === "offline_observation_fact");
  const observedBaoStock = latest.facts.some((fact) => fact.source === "BAOSTOCK" && fact.dataMode === "offline_observation_fact");
  assert(observedFred, "Fact bank must include at least one observed FRED fact.");
  assert(observedBaoStock, "Fact bank must include at least one observed BaoStock fact.");

  for (const fact of latest.facts) validateFactBankFact(fact, `factBank:${fact.factId}`);
  const hasAksharePublisher = latest.facts.some((fact) => fact.sourcePublisher === "AKShare");
  assert(!hasAksharePublisher, "AKShare must remain an access provider / collector, not sourcePublisher.");
  for (const fileName of ["fred-facts.json", "baostock-facts.json", "shfe-facts.json", "ine-facts.json", "world-bank-facts.json", "un-comtrade-facts.json"]) {
    assert(fs.existsSync(path.join(root, fileName)), `Missing split fact bank file ${fileName}.`);
  }
  validateCoverageReport(root);
}

function validateSourceProbes(map) {
  const root = path.join(generatedFinanceRoot, "source-probes", map);
  const reportPath = path.join(root, "source-probe-report.json");
  assert(fs.existsSync(reportPath), `Missing ${reportPath}`);
  const report = readJson(reportPath);
  assert(report.schemaVersion === 1, "Source probe schemaVersion must be 1.");
  assert(report.financeScenarioSlug === map, "Source probe financeScenarioSlug mismatch.");
  assert(report.hexMapSlug === "dust2", "Source probe hexMapSlug must remain dust2.");
  assert(Array.isArray(report.n56RequiredEvidenceKeys) && report.n56RequiredEvidenceKeys.length >= 1, "Source probe missing N56 required evidence keys.");
  assert(Array.isArray(report.sourceProbes) && report.sourceProbes.length >= 1, "Source probe report must include sourceProbes.");
  assert(report.secretsPolicy?.storedApiKeyValues === false, "Source probe must not store API key values.");
  assert(report.secretsPolicy?.storedRawResponses === false, "Source probe must not store raw responses.");
  const serialized = JSON.stringify(report);
  assert(!/FRED_API_KEY|UN_COMTRADE_KEY|UN_COMTRADE_SECONDARY_KEY/.test(serialized), "Source probe leaks env key names.");
  assert(!/(?:api[_-]?key|subscription[_-]?key)=[^&"'\s<>]{4,}/i.test(serialized), "Source probe leaks API key query material.");
  assert(!/["'](?:api[_-]?key|token|cookie)["']\s*:\s*["'][^"']{4,}/i.test(serialized), "Source probe appears to contain secret material.");

  const validDecisions = new Set(["ready_for_n57", "usable_with_cap", "candidate_only", "unavailable", "blocked"]);
  const validProbeStatuses = new Set(["success", "partial", "empty", "error", "skipped"]);
  for (const [index, probe] of report.sourceProbes.entries()) {
    const context = `sourceProbe[${index}]`;
    for (const field of ["sourceId", "displayName", "collectorId", "sourceRole", "sourceType", "probeStatus", "decisionForN57", "reliabilityTier"]) {
      assert(probe[field] !== undefined && probe[field] !== "", `${context} missing ${field}.`);
    }
    assert(validDecisions.has(probe.decisionForN57), `${context} invalid decisionForN57 ${probe.decisionForN57}.`);
    assert(validProbeStatuses.has(probe.probeStatus), `${context} invalid probeStatus ${probe.probeStatus}.`);
    assert(Array.isArray(probe.testedEndpoints), `${context} missing testedEndpoints.`);
    assert(Array.isArray(probe.testedSymbols), `${context} missing testedSymbols.`);
    assert(Number.isFinite(probe.returnedRows), `${context} missing returnedRows.`);
    assert(Array.isArray(probe.returnedFields), `${context} missing returnedFields.`);
    assert(Array.isArray(probe.supportsRequiredEvidenceKeys), `${context} missing supportsRequiredEvidenceKeys.`);
    assert(Array.isArray(probe.allowedClaimTypes), `${context} missing allowedClaimTypes.`);
    assert(Array.isArray(probe.notAllowedClaimTypes), `${context} missing notAllowedClaimTypes.`);
  }
  const akshareAsPublisher = report.sourceProbes.some((probe) => probe.sourceId === "akshare" && probe.decisionForN57 !== "candidate_only");
  assert(!akshareAsPublisher, "Source probe must not collapse publisher/source identity into AKShare; use SHFE/INE/GFEX/Sina plus collector metadata.");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.join(generatedFinanceRoot, "maps", args.map);
  const aggregatePath = path.join(root, "round-evidence-packs.json");
  assert(fs.existsSync(aggregatePath), `Missing ${aggregatePath}`);
  const aggregate = readJson(aggregatePath);
  assert(!/FRED_API_KEY|UN_COMTRADE_KEY|UN_COMTRADE_SECONDARY_KEY/.test(JSON.stringify(aggregate)), "Aggregate evidence pack leaks env key names.");
  assert(aggregate.schemaVersion === 1, "Aggregate schemaVersion must be 1.");
  assert(aggregate.mapBindingId === "dust2_nonferrous_industry_judgment_v1", "Unexpected mapBindingId.");
  assert(aggregate.sideSwapPolicy?.topicCycleRoundCount === 6, "Missing sideSwapPolicy topic cycle.");
  assert(Array.isArray(aggregate.packs) && aggregate.packs.length === 6, "Expected exactly 6 round evidence packs.");
  assert(!JSON.stringify(aggregate).includes("Falcon-7B is always the attack side"), "Forbidden fixed-side text found.");

  const seenRounds = new Set();
  for (const pack of aggregate.packs) {
    const context = `R${pack.roundNumber}`;
    seenRounds.add(pack.roundNumber);
    assert(pack.roundKey && pack.topicTitle, `${context} must include roundKey and topicTitle.`);
    validateDecisionQuestionContract(pack, context);
    assert(pack.defenseThesisFocus && pack.attackChallengeFocus, `${context} must include proof/challenge focus.`);
    assert(pack.sideSwapPolicy?.sideSwapRule, `${context} must include side swap rule.`);
    assert(Array.isArray(pack.facts) && pack.facts.length >= 1, `${context} must include facts.`);
    assert(Array.isArray(pack.missingEvidence) && pack.missingEvidence.length >= 1, `${context} must include missingEvidence.`);
    assert(Array.isArray(pack.scoreCaps) && pack.scoreCaps.length >= 1, `${context} must include scoreCaps.`);
    assert(Array.isArray(pack.promptFacts) && pack.promptFacts.length >= 1, `${context} must include promptFacts.`);
    assert(pack.judgeLedger?.prohibitedClaims?.length >= 1, `${context} must include judge prohibited claims.`);
    for (const fact of pack.facts) validateFact(fact, context);
    const positiveEvidenceText = JSON.stringify({ facts: pack.facts, promptFacts: pack.promptFacts, allowedClaims: pack.judgeLedger.allowedClaims });
    assert(!/中国国内供需已经确认|行业基本面已经确认|盈利已经改善/.test(positiveEvidenceText), `${context} contains over-strong proxy claim.`);
    assert(
      /中国有色需求已经确认改善|代表公司盈利已经改善/.test(JSON.stringify(pack.judgeLedger.prohibitedClaims)),
      `${context} must carry prohibited over-claim language in judge ledger.`
    );
  }

  for (let round = 1; round <= 6; round += 1) {
    assert(seenRounds.has(round), `Missing round ${round}.`);
    assert(fs.existsSync(path.join(root, `round-${round}-evidence-pack.json`)), `Missing split pack for round ${round}.`);
  }
  if (args.factBank) validateFactBank(args.map);
  if (args.sourceProbes) validateSourceProbes(args.map);
  console.log(`Validated ${aggregate.packs.length} finance evidence packs for ${args.map}.`);
}

main();
