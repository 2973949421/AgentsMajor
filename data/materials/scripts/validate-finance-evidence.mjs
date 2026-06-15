import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const materialsRoot = path.resolve(__dirname, "..");
const generatedFinanceRoot = path.join(materialsRoot, "generated", "finance");

function parseArgs(argv) {
  const args = { map: "dust2-nonferrous", factBank: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--map") args.map = argv[++index];
    else if (argv[index] === "--fact-bank") args.factBank = true;
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

function validateFactBankFact(fact, context) {
  const requiredFields = [
    "factId",
    "statementZh",
    "metricName",
    "source",
    "sourceType",
    "collector",
    "evidenceId",
    "confidence",
    "rawHash",
    "parserVersion",
    "originalLocation",
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
  assert(!/api[_-]?key|secret|token/i.test(JSON.stringify(fact.value)), `${context} fact value appears secret-like.`);
}

function validateFactBank(map) {
  const root = path.join(generatedFinanceRoot, "fact-bank", map);
  const latestPath = path.join(root, "latest.json");
  assert(fs.existsSync(latestPath), `Missing ${latestPath}`);
  const latest = readJson(latestPath);
  assert(latest.schemaVersion === 1, "Fact bank schemaVersion must be 1.");
  assert(latest.mapBindingId === "dust2_nonferrous_industry_judgment_v1", "Fact bank has unexpected mapBindingId.");
  assert(latest.dataMode === "offline_fact_bank_snapshot", "Fact bank dataMode must be offline_fact_bank_snapshot.");
  assert(Array.isArray(latest.sourceStatus) && latest.sourceStatus.length >= 4, "Fact bank must include sourceStatus.");
  assert(Array.isArray(latest.facts) && latest.facts.length >= 1, "Fact bank must include facts.");
  assert(!/FRED_API_KEY|UN_COMTRADE_KEY|UN_COMTRADE_SECONDARY_KEY/.test(JSON.stringify(latest)), "Fact bank leaks env key names.");
  assert(!/api[_-]?key["']?\s*[:=]\s*["'][^"']{4,}/i.test(JSON.stringify(latest)), "Fact bank appears to contain API key material.");

  const sourceStatus = new Map(latest.sourceStatus.map((item) => [item.sourceId, item]));
  assert(sourceStatus.get("fred"), "Fact bank missing FRED source status.");
  assert(sourceStatus.get("baostock"), "Fact bank missing BaoStock source status.");
  assert(sourceStatus.get("un_comtrade"), "Fact bank missing UN Comtrade source status.");
  assert(sourceStatus.get("akshare")?.dataMode === "registered_collector_not_used", "AKShare must remain registered_collector_not_used in N50.");

  const observedFred = latest.facts.some((fact) => fact.source === "FRED" && fact.dataMode === "offline_observation_fact");
  const observedBaoStock = latest.facts.some((fact) => fact.source === "BAOSTOCK" && fact.dataMode === "offline_observation_fact");
  assert(observedFred, "Fact bank must include at least one observed FRED fact.");
  assert(observedBaoStock, "Fact bank must include at least one observed BaoStock fact.");

  for (const fact of latest.facts) validateFactBankFact(fact, `factBank:${fact.factId}`);
  for (const fileName of ["fred-facts.json", "baostock-facts.json", "un-comtrade-facts.json"]) {
    assert(fs.existsSync(path.join(root, fileName)), `Missing split fact bank file ${fileName}.`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.join(generatedFinanceRoot, "maps", args.map);
  const aggregatePath = path.join(root, "round-evidence-packs.json");
  assert(fs.existsSync(aggregatePath), `Missing ${aggregatePath}`);
  const aggregate = readJson(aggregatePath);
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
  console.log(`Validated ${aggregate.packs.length} finance evidence packs for ${args.map}.`);
}

main();
