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

function defaultChallengePolicy() {
  return {
    mustTargetClaimId: true,
    allowedChallengeTypes: [
      "evidence_gap",
      "proxy_mismatch",
      "horizon_mismatch",
      "reasoning_bridge_break",
      "risk_reward_failure",
      "alternative_explanation"
    ],
    invalidChallengePatterns: [
      "只说数据不足",
      "不指向具体主张或证据链"
    ],
    missingEvidenceCanOnlyCap: true
  };
}

function normalizeDecisionFields(round) {
  return {
    decisionQuestion: round.decisionQuestion ?? round.title,
    decisionObject: round.decisionObject ?? "",
    horizon: round.horizon ?? "",
    benchmark: round.benchmark ?? "",
    allowedStance: round.allowedStance ?? requiredAllowedStance,
    requiredOutput: round.requiredOutput ?? [],
    requiredEvidenceSchema: round.requiredEvidenceSchema ?? [],
    challengePolicy: round.challengePolicy ?? defaultChallengePolicy(),
    legacyDefenseThesisFocus: round.legacyDefenseThesisFocus ?? round.defenseThesisFocus,
    legacyAttackChallengeFocus: round.legacyAttackChallengeFocus ?? round.attackChallengeFocus
  };
}

function loadFactBank(map) {
  const latestPath = path.join(generatedFinanceRoot, "fact-bank", map, "latest.json");
  if (!fs.existsSync(latestPath)) return null;
  return readJson(latestPath);
}

const sourceAliases = {
  FRED: ["FRED"],
  BaoStock: ["BAOSTOCK"],
  BAOSTOCK: ["BAOSTOCK"],
  UN_COMTRADE: ["UN_COMTRADE"],
  SHFE: ["SHFE"],
  INE: ["INE"],
  WorldBank: ["WORLD_BANK"],
  WORLD_BANK: ["WORLD_BANK"],
  "World Bank": ["WORLD_BANK"],
  company_financials: ["SINA_FINANCE", "BAOSTOCK"],
  CNINFO: ["SINA_FINANCE"],
  ChinaCustoms: ["UN_COMTRADE"],
  NBS: ["CHINA_MACRO_PUBLIC"],
  marketRiskProxy: ["BAOSTOCK", "SHFE", "INE", "EASTMONEY", "SSE", "CHINA_FUTURES_SPOT"],
  scoreCapPolicy: ["BAOSTOCK", "SHFE", "INE", "EASTMONEY", "SSE", "CHINA_FUTURES_SPOT"],
  riskPolicy: ["BAOSTOCK", "SHFE", "INE", "EASTMONEY", "SSE", "CHINA_FUTURES_SPOT"],
  configured_proxy_fact: ["CONFIGURED_PROXY"],
  unavailable_observation: ["UNAVAILABLE"],
  missingEvidence: ["MISSING"],
  requiredEvidenceSchema: ["SCHEMA"],
  judgeLedger: ["JUDGE_LEDGER"],
};

function normalizeSources(sourceNames) {
  return new Set(sourceNames.flatMap((source) => sourceAliases[source] ?? [String(source).toUpperCase()]));
}

function factSourceKey(fact) {
  return String(fact.source ?? fact.sourcePublisher ?? "").toUpperCase();
}

function claimMatches(fact, claimTypes) {
  const allowed = new Set(fact.allowedClaimTypes ?? []);
  if (allowed.size === 0) return true;
  return claimTypes.some((claimType) => allowed.has(claimType));
}

const requiredEvidenceKeyAliases = {
  commodity_context: ["commodity_context", "commodity_price_context"],
  commodity_price_context: ["commodity_price_context", "commodity_context"]
};

function requiredEvidenceKeyMatches(fact, requiredKey) {
  const keys = new Set(fact.requiredEvidenceKeys ?? []);
  if (!requiredKey || keys.size === 0) return true;
  const aliases = requiredEvidenceKeyAliases[requiredKey] ?? [requiredKey];
  return aliases.some((key) => keys.has(key));
}

const sourcePriorityByEvidenceKey = {
  commodity_price_momentum: ["FRED", "SHFE", "INE", "CHINA_FUTURES_SPOT"],
  commodity_price_context: ["FRED", "SHFE", "INE", "CHINA_FUTURES_SPOT"],
  commodity_context: ["FRED", "SHFE", "INE", "CHINA_FUTURES_SPOT"],
  china_supply_demand_proxy: ["SHFE", "CHINA_FUTURES_SPOT", "INE", "FRED"],
  domestic_inventory_or_spot_proxy: ["SHFE", "CHINA_FUTURES_SPOT", "INE"],
  trade_flow_proxy: ["UNAVAILABLE", "MISSING"],
  equity_market_reaction: ["BAOSTOCK"],
  equity_transmission_proxy: ["BAOSTOCK", "SINA_FINANCE"],
  valuation_proxy: ["BAOSTOCK", "SINA_FINANCE"],
  valuation_level: ["BAOSTOCK", "SINA_FINANCE"],
  earnings_transmission_proxy: ["SINA_FINANCE", "BAOSTOCK"],
  macro_demand_proxy: ["CHINA_MACRO_PUBLIC"],
  risk_reward_boundary: ["EASTMONEY", "SSE", "CHINA_FUTURES_SPOT", "SHFE", "INE", "BAOSTOCK"],
  risk_execution_rule: ["EASTMONEY", "SSE", "CHINA_FUTURES_SPOT", "SHFE", "INE", "BAOSTOCK"],
  portfolio_stance_evidence_mix: ["FRED", "BAOSTOCK", "SHFE", "INE", "SINA_FINANCE"],
  available_positive_proxy: ["FRED", "BAOSTOCK", "SHFE", "INE", "SINA_FINANCE"],
  declared_missing_evidence: ["SCHEMA", "MISSING", "UNAVAILABLE"],
  missing_evidence_policy: ["SCHEMA", "MISSING", "UNAVAILABLE"]
};

function sourceRankForEvidenceKey(requiredKey, fact) {
  const priority = sourcePriorityByEvidenceKey[requiredKey] ?? [];
  const source = factSourceKey(fact);
  const index = priority.indexOf(source);
  return index === -1 ? priority.length + 10 : index;
}

const metalEntityPriority = ["CU", "AL", "ZN", "NI", "SN", "PB", "AU", "AG", "BC"];

function entityRank(fact) {
  const entity = String(fact.entity ?? "").toUpperCase();
  const index = metalEntityPriority.indexOf(entity);
  return index === -1 ? metalEntityPriority.length + 10 : index;
}

function pickDiverseFacts(facts, requiredKey, minimum) {
  const sorted = [...facts].sort((left, right) => {
    const sourceRank = sourceRankForEvidenceKey(requiredKey, left) - sourceRankForEvidenceKey(requiredKey, right);
    if (sourceRank !== 0) return sourceRank;
    const leftEntityRank = entityRank(left);
    const rightEntityRank = entityRank(right);
    if (leftEntityRank !== rightEntityRank) return leftEntityRank - rightEntityRank;
    return String(left.factId ?? "").localeCompare(String(right.factId ?? ""));
  });
  const result = [];
  const seenSources = new Set();
  for (const fact of sorted) {
    const source = factSourceKey(fact);
    if (seenSources.has(source)) continue;
    result.push(fact);
    seenSources.add(source);
    if (result.length >= minimum + 1) return result;
  }
  for (const fact of sorted) {
    if (result.includes(fact)) continue;
    result.push(fact);
    if (result.length >= minimum + 1) break;
  }
  return result;
}

function packFactFromFactBank(fact, index) {
  return {
    ...fact,
    factId: fact.factId ?? `FB${String(index).padStart(3, "0")}`,
    statement: fact.statementZh ?? fact.statement ?? "",
    statementZh: fact.statementZh ?? fact.statement ?? "",
    metricName: fact.metricName,
    source: fact.source,
    sourceType: fact.sourceType ?? fact.reliabilityTier,
    collector: fact.collector,
    evidenceId: fact.evidenceId,
    confidence: fact.confidence ?? 0,
    rawHash: fact.rawHash,
    parserVersion: fact.parserVersion ?? parserVersion,
    originalLocation: fact.originalLocation ?? fact.endpoint ?? fact.source,
    policyNotes: fact.policyNotes ?? [],
    dataMode: fact.dataMode ?? "offline_observation_fact",
    factBankSource: "fact_bank_v2"
  };
}

function buildFactBankFacts({ round, factBank }) {
  if (!factBank?.facts?.length) return [];
  const selected = new Map();
  for (const evidenceItem of round.requiredEvidenceSchema ?? []) {
    const preferred = normalizeSources(evidenceItem.preferredSources ?? []);
    const fallback = normalizeSources(evidenceItem.fallbackSources ?? []);
    const claimTypes = evidenceItem.requiredForClaimTypes ?? [];
    const minimum = Number(evidenceItem.minimumFactCount ?? 1);
    const requiredKey = evidenceItem.requiredKey;
    const observedPreferred = factBank.facts.filter(
      (fact) => fact.dataMode === "offline_observation_fact" && fact.activeSourceStatus !== "frozen" && preferred.has(factSourceKey(fact)) && requiredEvidenceKeyMatches(fact, requiredKey) && claimMatches(fact, claimTypes)
    );
    const observedFallback = factBank.facts.filter(
      (fact) => fact.dataMode === "offline_observation_fact" && fact.activeSourceStatus !== "frozen" && fallback.has(factSourceKey(fact)) && requiredEvidenceKeyMatches(fact, requiredKey) && claimMatches(fact, claimTypes)
    );
    const unavailablePreferred = factBank.facts.filter(
      (fact) => fact.dataMode === "unavailable_observation" && fact.activeSourceStatus !== "frozen" && preferred.has(factSourceKey(fact)) && requiredEvidenceKeyMatches(fact, requiredKey)
    );
    const picks = observedPreferred.length >= minimum ? pickDiverseFacts(observedPreferred, requiredKey, minimum) : [...pickDiverseFacts([...observedPreferred, ...observedFallback], requiredKey, minimum), ...unavailablePreferred.slice(0, 1)];
    for (const fact of picks) {
      if (fact.factId && !selected.has(fact.factId)) selected.set(fact.factId, fact);
    }
  }
  if (selected.size === 0) {
    const observedCoreFacts = factBank.facts.filter(
      (fact) => fact.dataMode === "offline_observation_fact" && fact.activeSourceStatus !== "frozen" && ["FRED", "BAOSTOCK", "SHFE", "INE", "SINA_FINANCE"].includes(factSourceKey(fact))
    );
    for (const fact of observedCoreFacts.slice(0, 4)) {
      if (fact.factId && !selected.has(fact.factId)) selected.set(fact.factId, fact);
    }
  }
  return [...selected.values()].map((fact, index) => packFactFromFactBank(fact, index + 1));
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
      statement: `FRED series ${series.seriesId} (${series.displayName}) is configured as a global ${series.commodity} price proxy for the decision question "${round.decisionQuestion ?? round.title}"; it does not prove China domestic inventory, spot premium, or supply-demand tightness.`,
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
      statement: `${company.name} (${company.code}) is configured as a representative A-share nonferrous proxy with ${company.primaryExposure} exposure for the decision question "${round.decisionQuestion ?? round.title}"; BaoStock can support market reaction and valuation proxy only, not confirmed industry fundamentals.`,
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
        statement: `UN Comtrade HS ${item.cmdCode} (${item.displayName}) is configured as a lagged trade proxy for the decision question "${round.decisionQuestion ?? round.title}"; it cannot replace China domestic inventory, spot premium, or industry profit evidence.`,
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

function buildRoundPack({ round, configs, generatedAt, mode, envNames, factBank }) {
  const decision = normalizeDecisionFields(round);
  const facts = buildFactBankFacts({ round, factBank });
  const fallbackFacts = [];
  if (facts.length === 0) {
    fallbackFacts.push(...buildFredFacts({ round, ...configs, factStart: fallbackFacts.length + 1 }));
    fallbackFacts.push(...buildBaoStockFacts({ round, ...configs, factStart: fallbackFacts.length + 1 }));
    fallbackFacts.push(...buildComtradeFacts({ round, ...configs, factStart: fallbackFacts.length + 1 }));
  }
  facts.push(...fallbackFacts);

  const availableSources = new Set(facts.map((fact) => fact.source.toLowerCase().replace("un_comtrade", "un_comtrade")));
  const sourceWarnings = [];
  if (round.optionalSources.includes("un_comtrade") && !envNames.has("UN_COMTRADE_KEY")) {
    sourceWarnings.push("UN Comtrade is optional for this round and the required credential was not detected.");
  }
  if (round.requiredSources.includes("fred") && !envNames.has("FRED_API_KEY")) {
    sourceWarnings.push("FRED credential was not detected; generated facts may fall back to configured proxy facts.");
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
    decisionQuestion: decision.decisionQuestion,
    decisionObject: decision.decisionObject,
    horizon: decision.horizon,
    benchmark: decision.benchmark,
    allowedStance: decision.allowedStance,
    requiredOutput: decision.requiredOutput,
    requiredEvidenceSchema: decision.requiredEvidenceSchema,
    challengePolicy: decision.challengePolicy,
    defenseThesisFocus: round.defenseThesisFocus,
    attackChallengeFocus: round.attackChallengeFocus,
    legacyDefenseThesisFocus: decision.legacyDefenseThesisFocus,
    legacyAttackChallengeFocus: decision.legacyAttackChallengeFocus,
    requiredSources: round.requiredSources,
    optionalSources: round.optionalSources,
    facts,
    missingEvidence: round.missingEvidenceToSurface,
    scoreCaps: scoreCapsForRound({ round, policy: configs.policy, overlay: configs.overlay, availableSources }),
    promptFacts: buildPromptFacts(facts),
    judgeLedger: judgeLedgerForRound({ round, overlay: configs.overlay, facts }),
    sideSwapPolicy: configs.topics.sideSwapPolicy,
    sourceWarnings,
    factBankSnapshot: factBank
      ? {
          schemaVersion: factBank.schemaVersion,
          parserVersion: factBank.parserVersion,
          generatedAt: factBank.generatedAt,
          consumedFactCount: facts.filter((fact) => fact.factBankSource === "fact_bank_v2").length,
          fallbackConfiguredFactCount: fallbackFacts.length
        }
      : null
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
  const factBank = loadFactBank(args.map);
  const packs = configs.topics.rounds.map((round) => buildRoundPack({ round, configs, generatedAt, mode: args.mode, envNames, factBank }));

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
      detectedEnvFlags: {
        fred: envNames.has("FRED_API_KEY"),
        unComtrade: envNames.has("UN_COMTRADE_KEY") || envNames.has("UN_COMTRADE_SECONDARY_KEY")
      },
      factBankSnapshot: factBank
        ? {
            schemaVersion: factBank.schemaVersion,
            parserVersion: factBank.parserVersion,
            generatedAt: factBank.generatedAt,
            factCount: factBank.facts?.length ?? 0
          }
        : null
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
