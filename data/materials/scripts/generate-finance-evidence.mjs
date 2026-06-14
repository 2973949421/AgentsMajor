import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const materialsRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(materialsRoot, "..", "..");
const processedFinanceRoot = path.join(materialsRoot, "processed", "finance");
const generatedFinanceRoot = path.join(materialsRoot, "generated", "finance");
const parserVersion = "finance-evidence-generator-v1";

function parseArgs(argv) {
  const args = {
    map: "dust2-nonferrous",
    mode: "fixture-or-live"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--map") args.map = argv[++index];
    else if (item === "--mode") args.mode = argv[++index];
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hash8(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 8);
}

function loadLocalEnvNames() {
  const envPath = path.join(repoRoot, ".env.local");
  if (!fs.existsSync(envPath)) return new Set();
  const source = fs.readFileSync(envPath, "utf8");
  const names = new Set();
  for (const line of source.split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line.trim());
    if (match) names.add(match[1]);
  }
  return names;
}

function makeEvidenceId({ source, domain, entity, metric, period, locator, rawHash }) {
  return `EVID:${source}:${domain}:${entity}:${metric}:${period}:${locator}:${rawHash}`;
}

function sourceById(sourceRegistry, sourceId) {
  return sourceRegistry.sources.find((source) => source.sourceId === sourceId);
}

function confidenceForTier(policy, tier) {
  return policy.sourceTiers.find((item) => item.tier === tier)?.maxConfidence ?? 0.5;
}

function factFromConfig({
  source,
  collector,
  sourceType,
  confidence,
  metricName,
  entity,
  statement,
  period = "configured",
  unit = "",
  value = null,
  domain,
  locator,
  originalLocation,
  policyNotes = [],
  factIndex
}) {
  const rawHash = hash8({ source, metricName, entity, statement, period, locator });
  const evidenceId = makeEvidenceId({
    source,
    domain,
    entity,
    metric: metricName.replace(/[^A-Za-z0-9_]+/g, "_").toLowerCase(),
    period,
    locator,
    rawHash
  });
  return {
    factId: `F${String(factIndex).padStart(3, "0")}`,
    statement,
    metricName,
    value,
    unit,
    period,
    source,
    sourceType,
    collector,
    evidenceId,
    confidence,
    rawHash,
    parserVersion,
    originalLocation,
    policyNotes,
    dataMode: "configured_proxy_fact"
  };
}

function buildFredFacts({ round, fredSeries, sourceRegistry, policy, factStart }) {
  const source = sourceById(sourceRegistry, "fred");
  const confidence = confidenceForTier(policy, source.defaultQualityTier);
  const applicable = fredSeries.series.filter((series) => series.firstPhaseUse.includes(round.roundKey));
  return applicable.map((series, offset) =>
    factFromConfig({
      source: "FRED",
      collector: source.collector.collectorId,
      sourceType: source.defaultQualityTier,
      confidence,
      metricName: series.displayName,
      entity: series.seriesId,
      domain: "commodity",
      locator: series.seriesId,
      unit: series.unit,
      statement: `FRED series ${series.seriesId} (${series.displayName}) is configured as a global ${series.commodity} price proxy for ${round.title}; it does not prove China domestic inventory, spot premium, or supply-demand tightness.`,
      originalLocation: `fred-series.json:${series.seriesId}`,
      policyNotes: fredSeries.limitations,
      factIndex: factStart + offset
    })
  );
}

function buildBaoStockFacts({ round, universe, sourceRegistry, policy, factStart }) {
  if (!round.requiredSources.includes("baostock") && !round.optionalSources.includes("baostock")) return [];
  const source = sourceById(sourceRegistry, "baostock");
  const confidence = confidenceForTier(policy, source.defaultQualityTier);
  return universe.coreUniverse.slice(0, 5).map((company, offset) =>
    factFromConfig({
      source: "BAOSTOCK",
      collector: source.collector.collectorId,
      sourceType: source.defaultQualityTier,
      confidence,
      metricName: "representative_company_market_proxy",
      entity: company.code,
      domain: "stock",
      locator: company.code,
      statement: `${company.name} (${company.code}) is configured as a representative A-share nonferrous proxy with ${company.primaryExposure} exposure; BaoStock can support market reaction and valuation proxy only, not confirmed industry fundamentals.`,
      originalLocation: `baostock-company-universe.json:${company.code}`,
      policyNotes: universe.limitations,
      factIndex: factStart + offset
    })
  );
}

function buildComtradeFacts({ round, hsCodes, sourceRegistry, policy, factStart }) {
  if (!round.requiredSources.includes("un_comtrade") && !round.optionalSources.includes("un_comtrade")) return [];
  const source = sourceById(sourceRegistry, "un_comtrade");
  const confidence = confidenceForTier(policy, source.defaultQualityTier);
  return hsCodes.hsCodes
    .filter((item) => item.firstPhaseUse.includes(round.roundKey))
    .map((item, offset) =>
      factFromConfig({
        source: "UN_COMTRADE",
        collector: source.collector.collectorId,
        sourceType: source.defaultQualityTier,
        confidence,
        metricName: "china_import_export_proxy",
        entity: item.cmdCode,
        domain: "trade",
        locator: item.cmdCode,
        statement: `UN Comtrade HS ${item.cmdCode} (${item.displayName}) is configured as a lagged trade proxy for ${round.title}; it cannot replace China domestic inventory, spot premium, or industry profit evidence.`,
        originalLocation: `un-comtrade-hs-codes.json:${item.cmdCode}`,
        policyNotes: hsCodes.limitations,
        factIndex: factStart + offset
      })
    );
}

function scoreCapsForRound({ round, policy, overlay, availableSources }) {
  const caps = [];
  const sourceKey = [...availableSources].sort().join("_plus_");
  const policyCap = policy.scoreCaps.find((cap) => cap.condition === sourceKey);
  if (policyCap) {
    caps.push({
      condition: policyCap.condition,
      maxScore: policyCap.maxProxyFactScore ?? policyCap.maxIndustryJudgmentScore ?? policyCap.maxChinaNonferrousSupplyDemandScore,
      reason: policyCap.reason
    });
  }

  for (const cap of overlay.scoreCaps) {
    if (round.missingEvidenceToSurface.some((item) => cap.trigger.toLowerCase().includes(item.replace(/_/g, " ").slice(0, 8).toLowerCase()))) {
      caps.push({
        condition: cap.id,
        maxScore: 70,
        reason: `${cap.trigger} ${cap.scoringImplication}`
      });
    }
  }

  caps.push({
    condition: "proxy_fact_boundary",
    maxScore: availableSources.has("un_comtrade") ? 75 : 70,
    reason: "First-phase evidence is limited to free API proxy facts and must surface missing domestic inventory, spot, SHFE/SMM, and filing anchors."
  });
  return caps;
}

function judgeLedgerForRound({ round, overlay, facts }) {
  return {
    allowedClaims: overlay.refereeLanguageGuide.map((item) => item.allowedLanguage),
    cappedClaims: round.missingEvidenceToSurface.map((item) => `Missing ${item}; related claims must be downgraded or capped.`),
    prohibitedClaims: [
      ...overlay.refereeLanguageGuide.map((item) => item.bannedOrDowngradedLanguage),
      ...facts.flatMap((fact) => fact.policyNotes ?? []).filter(Boolean)
    ]
  };
}

function buildPromptFacts(facts) {
  return facts.slice(0, 12).map((fact) => ({
    factId: fact.factId,
    shortText: fact.statement,
    evidenceId: fact.evidenceId
  }));
}

function buildRoundPack({ round, configs, generatedAt, mode, envNames }) {
  const facts = [];
  facts.push(...buildFredFacts({ round, ...configs, factStart: facts.length + 1 }));
  facts.push(...buildBaoStockFacts({ round, ...configs, factStart: facts.length + 1 }));
  facts.push(...buildComtradeFacts({ round, ...configs, factStart: facts.length + 1 }));

  const availableSources = new Set(facts.map((fact) => fact.source.toLowerCase().replace("un_comtrade", "un_comtrade")));
  const sourceWarnings = [];
  if (round.optionalSources.includes("un_comtrade") && !envNames.has("UN_COMTRADE_KEY")) {
    sourceWarnings.push("UN Comtrade is optional for this round and UN_COMTRADE_KEY was not detected in .env.local.");
  }
  if (round.requiredSources.includes("fred") && !envNames.has("FRED_API_KEY")) {
    sourceWarnings.push("FRED_API_KEY was not detected; generated facts are configured proxy facts, not live observations.");
  }
  if (round.requiredSources.includes("baostock")) {
    sourceWarnings.push("BaoStock live observations are not fetched by this JS MVP; configured universe facts are used as proxy scaffolding.");
  }

  return {
    schemaVersion: 1,
    generatedAt,
    generator: parserVersion,
    dataMode: mode,
    mapBindingId: configs.binding.bindingId,
    financeMapSlug: configs.binding.financeMapSlug,
    roundNumber: round.roundNumber,
    roundKey: round.roundKey,
    topicTitle: round.title,
    defenseThesisFocus: round.defenseThesisFocus,
    attackChallengeFocus: round.attackChallengeFocus,
    requiredSources: round.requiredSources,
    optionalSources: round.optionalSources,
    facts,
    missingEvidence: round.missingEvidenceToSurface,
    scoreCaps: scoreCapsForRound({ round, policy: configs.policy, overlay: configs.overlay, availableSources }),
    promptFacts: buildPromptFacts(facts),
    judgeLedger: judgeLedgerForRound({ round, overlay: configs.overlay, facts }),
    sideSwapPolicy: configs.topics.sideSwapPolicy,
    sourceWarnings
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!["fixture", "fixture-or-live", "live"].includes(args.mode)) {
    throw new Error(`Unsupported --mode ${args.mode}`);
  }
  const mapRoot = path.join(processedFinanceRoot, "maps", args.map);
  const configs = {
    sourceRegistry: readJson(path.join(processedFinanceRoot, "source-registry.json")),
    policy: readJson(path.join(processedFinanceRoot, "evidence-source-policy.json")),
    binding: readJson(path.join(mapRoot, "finance-map-binding.json")),
    topics: readJson(path.join(mapRoot, "round-topics.json")),
    fredSeries: readJson(path.join(mapRoot, "fred-series.json")),
    universe: readJson(path.join(mapRoot, "baostock-company-universe.json")),
    hsCodes: readJson(path.join(mapRoot, "un-comtrade-hs-codes.json")),
    overlay: readJson(path.join(mapRoot, "map-overlay.json"))
  };
  const generatedAt = new Date().toISOString();
  const envNames = loadLocalEnvNames();
  const packs = configs.topics.rounds.map((round) => buildRoundPack({ round, configs, generatedAt, mode: args.mode, envNames }));

  const output = {
    schemaVersion: 1,
    generatedAt,
    generator: parserVersion,
    mapBindingId: configs.binding.bindingId,
    financeMapSlug: configs.binding.financeMapSlug,
    dataMode: args.mode,
    sourceSummary: {
      defaultSources: configs.binding.defaultSources,
      optionalSources: configs.binding.optionalSources,
      detectedEnvNames: [...envNames].filter((name) => /FRED|COMTRADE|BAOSTOCK/i.test(name)).sort()
    },
    sideSwapPolicy: configs.binding.sideSwapPolicy,
    packs
  };

  const generatedMapRoot = path.join(generatedFinanceRoot, "maps", args.map);
  writeJson(path.join(generatedMapRoot, "round-evidence-packs.json"), output);
  for (const pack of packs) {
    writeJson(path.join(generatedMapRoot, `round-${pack.roundNumber}-evidence-pack.json`), pack);
  }
  console.log(`Generated ${packs.length} finance evidence packs for ${args.map} at ${path.relative(repoRoot, generatedMapRoot)}.`);
}

main();
