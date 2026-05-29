#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const fixtureId = "phase18_match_falcon_7b_vs_vitallmty";
const defaultDbPath = resolve(process.cwd(), "data", "agent-major.sqlite");
const reportJsonPath = resolve(
  process.cwd(),
  "data",
  "reports",
  "economy-calibration",
  "phase20pre-economy-calibration.json"
);
const reportMarkdownPath = resolve(
  process.cwd(),
  "data",
  "reports",
  "economy-calibration",
  "phase20pre-economy-calibration.md"
);

const trackedTasks = [
  "team_plan",
  "agent_action",
  "judge",
  "judge_review",
  "coach_timeout",
  "coach_post_match_review"
];
const minCalibrationRounds = 6;

const options = parseArgs(process.argv.slice(2));
const dbPath = resolve(process.cwd(), options.dbPath ?? defaultDbPath);

if (!existsSync(dbPath)) {
  throw new Error(`SQLite database not found: ${dbPath}`);
}

let calibrationRunIds = [];
let scan = scanDatabase(dbPath);
if (options.allowNewRun && !options.dryRun && scan.summary.includedRoundCount < minCalibrationRounds) {
  const missingRounds = minCalibrationRounds - scan.summary.includedRoundCount;
  const roundsToRun = Math.min(options.maxRounds, missingRounds);
  if (roundsToRun > 0) {
    calibrationRunIds = runPhase18Rounds(roundsToRun, dbPath);
    scan = scanDatabase(dbPath);
  }
}

const report = buildReport({
  scan,
  options,
  dbPath,
  calibrationRunIds
});

if (options.dryRun) {
  printConsoleSummary(report, true);
} else {
  mkdirSync(dirname(reportJsonPath), { recursive: true });
  writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(reportMarkdownPath, renderMarkdown(report), "utf8");
  printConsoleSummary(report, false);
}

function parseArgs(argv) {
  const parsed = {
    dryRun: false,
    allowNewRun: false,
    maxRounds: 6,
    dbPath: undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const nextToken = argv[index + 1];
    if (token === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (token === "--allow-new-run") {
      parsed.allowNewRun = true;
      continue;
    }
    if (token === "--max-rounds") {
      parsed.maxRounds = clampPositiveInteger(nextToken, 6);
      index += 1;
      continue;
    }
    if (token === "--db") {
      parsed.dbPath = nextToken;
      index += 1;
    }
  }

  return parsed;
}

function clampPositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    return fallback;
  }
  return Math.min(numeric, 6);
}

function scanDatabase(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  db.exec("PRAGMA foreign_keys = ON");
  try {
    const teams = readTeams(db);
    const allRows = readLlmCallRows(db);
    const mapGames = readMapGames(db);
    const roundReports = readRoundReports(db);
    const excludedSampleReasons = {};
    const includedSamples = [];
    const includedRunIds = new Set();
    const includedRuntimeMatchIds = new Set();
    const includedRoundKeys = new Set();
    const includedCommittedRoundKeys = new Set();
    const artifactDiagnostics = {
      response_artifact_parse_failure: 0,
      response_artifact_missing: 0,
      note: "response artifact 缺失时，本报告仍使用 llm_calls token 字段统计 outputTokens；JSON 失败只能从现存 response artifact 推导。"
    };

    for (const rawRow of allRows) {
      const row = enrichCallRow(rawRow, mapGames, roundReports);
      const classification = classifyRow(row);
      if (!classification.include) {
        increment(excludedSampleReasons, classification.reason);
        continue;
      }

      const task = normalizeTask(row.task_type);
      const roundNumber = toNumber(row.round_number);

      if (!trackedTasks.includes(task)) {
        increment(excludedSampleReasons, `untracked_task:${task}`);
        continue;
      }
      if (roundNumber === null || roundNumber < 1 || roundNumber > 6) {
        increment(excludedSampleReasons, "outside_round_r1_r6");
        continue;
      }

      const artifact = readResponseArtifact(row.response_uri);
      if (artifact.missing) {
        artifactDiagnostics.response_artifact_missing += 1;
      }
      if (artifact.parseError) {
        artifactDiagnostics.response_artifact_parse_failure += 1;
      }

      const responseData = artifact.json?.data;
      const responseTeamId = isRecord(responseData) && typeof responseData.teamId === "string" ? responseData.teamId : undefined;
      const teamId = row.agent_team_id ?? responseTeamId ?? inferTeamIdFromText(row.call_id, teams);
      const side = inferSide(row, teamId, responseData);
      const role = inferRole(row, task);
      const outputTokens = toNumber(row.output_tokens);
      const inputTokens = toNumber(row.input_tokens);
      const ok = artifact.json?.ok;
      const failedOrPartial = ok === false || artifact.parseError || outputTokens === null;
      const jsonParseFailure = artifact.parseError || isJsonOrSchemaFailure(artifact.json);

      includedRunIds.add(row.run_id);
      includedRuntimeMatchIds.add(row.match_id);
      includedRoundKeys.add(`${row.run_id}:M${row.map_order ?? 1}:R${roundNumber}`);
      if (row.has_round_report) {
        includedCommittedRoundKeys.add(`${row.run_id}:M${row.map_order ?? 1}:R${roundNumber}`);
      }
      includedSamples.push({
        callId: row.call_id,
        runId: row.run_id,
        runtimeMatchId: row.match_id,
        mapGameId: row.map_game_id,
        mapName: row.map_name ?? "unknown",
        roundNumber,
        task,
        role,
        side,
        teamId: teamId ?? null,
        teamName: resolveTeamDisplayName(teamId, teams),
        agentId: row.agent_id ?? null,
        agentName: row.agent_name ?? null,
        driverModelId: row.driver_model_id,
        inputTokens,
        outputTokens,
        hasCommittedRoundReport: row.has_round_report,
        missingUsage: outputTokens === null,
        failedOrPartial,
        jsonParseFailure,
        responseArtifactId: row.response_artifact_id ?? null,
        responseArtifactUri: row.response_uri ?? null,
        createdAt: row.created_at ?? null
      });
    }

    const economyRows = readEconomyRows(db, [...includedRuntimeMatchIds]);
    const tableCounts = readTableCounts(db);
    const runRows = readRunRows(db);

    return {
      summary: {
        totalLlmCallRows: allRows.length,
        includedCallCount: includedSamples.length,
        includedRoundCount: includedRoundKeys.size,
        includedCommittedRoundCount: includedCommittedRoundKeys.size,
        includedRunIds: [...includedRunIds].sort(),
        includedRuntimeMatchIds: [...includedRuntimeMatchIds].sort(),
        includedRoundKeys: [...includedRoundKeys].sort(),
        includedCommittedRoundKeys: [...includedCommittedRoundKeys].sort(),
        excludedSampleReasons,
        artifactDiagnostics
      },
      samples: includedSamples,
      economy: summarizeEconomyRows(economyRows),
      tableCounts,
      runRows
    };
  } finally {
    db.close();
  }
}

function readTeams(db) {
  const rows = db
    .prepare("SELECT id, display_name AS displayName, short_name AS shortName FROM teams")
    .all();
  const byId = new Map();
  for (const row of rows) {
    if (typeof row.id === "string") {
      byId.set(row.id, {
        id: row.id,
        displayName: typeof row.displayName === "string" ? row.displayName : row.id,
        shortName: typeof row.shortName === "string" ? row.shortName : row.id
      });
    }
  }
  return byId;
}

function readLlmCallRows(db) {
  return db
    .prepare(
      `SELECT
         c.id AS call_id,
         c.tournament_id,
         c.match_id,
         c.round_id,
         c.agent_id,
         c.driver_model_id,
         c.task_type,
         c.input_tokens,
         c.output_tokens,
         c.estimated_cost,
         c.response_artifact_id,
         c.created_at,
         ar.uri AS response_uri,
         sr.id AS run_id,
         sr.fixture_id,
         sr.status AS run_status,
         sr.requested_mode,
         sr.created_at AS run_created_at,
         r.round_number,
         r.team_a_buy_type,
         r.team_b_buy_type,
         mg.id AS map_game_id,
         mg.map_name,
         mg.map_order,
         m.team_a_id,
         m.team_b_id,
         ag.role AS agent_role,
         ag.display_name AS agent_name,
         ag.team_id AS agent_team_id,
         t.display_name AS team_name,
         rr.tactical_context_json
       FROM llm_calls c
       LEFT JOIN artifacts ar ON ar.id = c.response_artifact_id
       LEFT JOIN simulation_runs sr ON sr.runtime_match_id = c.match_id
       LEFT JOIN rounds r ON r.id = c.round_id
       LEFT JOIN map_games mg ON mg.id = r.map_game_id
       LEFT JOIN matches m ON m.id = c.match_id
       LEFT JOIN agents ag ON ag.id = c.agent_id
       LEFT JOIN teams t ON t.id = ag.team_id
       LEFT JOIN round_reports rr ON rr.round_id = c.round_id
       ORDER BY c.created_at ASC`
    )
    .all();
}

function readMapGames(db) {
  const rows = db
    .prepare(
      `SELECT id, match_id AS matchId, map_name AS mapName, map_order AS mapOrder
       FROM map_games`
    )
    .all();
  const byMatchOrder = new Map();
  for (const row of rows) {
    if (typeof row.matchId !== "string" || typeof row.mapOrder !== "number") {
      continue;
    }
    byMatchOrder.set(`${row.matchId}:${row.mapOrder}`, {
      id: row.id,
      matchId: row.matchId,
      mapName: row.mapName,
      mapOrder: row.mapOrder
    });
  }
  return { byMatchOrder };
}

function readRoundReports(db) {
  const rows = db
    .prepare(
      `SELECT round_id AS roundId, map_game_id AS mapGameId, round_number AS roundNumber, tactical_context_json AS tacticalContextJson
       FROM round_reports`
    )
    .all();
  const byRoundId = new Map();
  const byMapRound = new Map();
  for (const row of rows) {
    if (typeof row.roundId === "string") {
      byRoundId.set(row.roundId, row);
    }
    if (typeof row.mapGameId === "string" && typeof row.roundNumber === "number") {
      byMapRound.set(`${row.mapGameId}:${row.roundNumber}`, row);
    }
  }
  return { byRoundId, byMapRound };
}

function enrichCallRow(row, mapGames, roundReports) {
  const inferred = inferMapRoundFromCallId(row.call_id, row.match_id);
  const mapOrder = toNumber(row.map_order) ?? inferred.mapOrder;
  const roundNumber = toNumber(row.round_number) ?? inferred.roundNumber;
  const mapGame = typeof row.match_id === "string" && mapOrder !== null ? mapGames.byMatchOrder.get(`${row.match_id}:${mapOrder}`) : null;
  const reportFromRoundId = typeof row.round_id === "string" ? roundReports.byRoundId.get(row.round_id) : null;
  const reportFromMapRound =
    mapGame && roundNumber !== null ? roundReports.byMapRound.get(`${mapGame.id}:${roundNumber}`) : null;
  const report = reportFromRoundId ?? reportFromMapRound ?? null;

  return {
    ...row,
    round_number: row.round_number ?? roundNumber,
    map_order: row.map_order ?? mapOrder,
    map_game_id: row.map_game_id ?? mapGame?.id ?? report?.mapGameId ?? null,
    map_name: row.map_name ?? mapGame?.mapName ?? null,
    tactical_context_json: row.tactical_context_json ?? report?.tacticalContextJson ?? null,
    has_round_report: Boolean(report)
  };
}

function inferMapRoundFromCallId(callId, matchId) {
  if (typeof callId !== "string" || typeof matchId !== "string") {
    return { mapOrder: null, roundNumber: null };
  }
  const prefix = `llm_round_map_${matchId}_`;
  if (!callId.startsWith(prefix)) {
    return { mapOrder: null, roundNumber: null };
  }
  const rest = callId.slice(prefix.length);
  const match = rest.match(/^(\d+)_(\d+)_attempt_/);
  if (!match) {
    return { mapOrder: null, roundNumber: null };
  }
  return {
    mapOrder: Number(match[1]),
    roundNumber: Number(match[2])
  };
}

function readEconomyRows(db, runtimeMatchIds) {
  if (runtimeMatchIds.length === 0) {
    return [];
  }
  return db
    .prepare(
      `SELECT
         es.agent_id,
         es.team_id,
         es.map_game_id,
         es.round_id,
         es.phase,
         es.token_bank,
         es.buy_type,
         es.loss_streak,
         es.visible_context_budget,
         es.output_budget,
         es.created_at,
         r.round_number,
         mg.match_id,
         t.display_name AS team_name,
         ag.role AS agent_role
       FROM economy_states es
       LEFT JOIN rounds r ON r.id = es.round_id
       LEFT JOIN map_games mg ON mg.id = es.map_game_id
       LEFT JOIN teams t ON t.id = es.team_id
       LEFT JOIN agents ag ON ag.id = es.agent_id
       WHERE mg.match_id IN (${placeholders(runtimeMatchIds)})
       ORDER BY es.created_at ASC`
    )
    .all(...runtimeMatchIds);
}

function readTableCounts(db) {
  const output = {};
  for (const tableName of ["simulation_runs", "llm_calls", "rounds", "round_reports", "economy_states"]) {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get();
    output[tableName] = typeof row?.count === "number" ? row.count : 0;
  }
  return output;
}

function readRunRows(db) {
  return db
    .prepare(
      `SELECT id, fixture_id AS fixtureId, status, requested_mode AS requestedMode,
              runtime_match_id AS runtimeMatchId, latest_committed_round_number AS latestCommittedRoundNumber,
              has_fresh_replay AS hasFreshReplay, latest_error AS latestError, created_at AS createdAt
       FROM simulation_runs
       WHERE fixture_id = ?
       ORDER BY created_at DESC`
    )
    .all(fixtureId);
}

function classifyRow(row) {
  const driver = String(row.driver_model_id ?? "");
  const matchId = String(row.match_id ?? "");
  const runId = row.run_id;
  const fixture = row.fixture_id;
  const runStatus = row.run_status;

  if (driver.toLowerCase().includes("fake")) {
    return { include: false, reason: "fake_provider" };
  }
  if (!runId || fixture !== fixtureId) {
    return { include: false, reason: "not_phase18_fixture_run" };
  }
  if (runStatus === "discarded") {
    return { include: false, reason: "discarded_run" };
  }
  if (/(phase1[1-7]|demo|ghost|4v7)/i.test(matchId)) {
    return { include: false, reason: "old_demo_or_template_match" };
  }
  if (!String(row.map_name ?? "").toUpperCase().includes("DUST2")) {
    return { include: false, reason: "non_dust2_map" };
  }

  return { include: true };
}

function readResponseArtifact(uri) {
  if (typeof uri !== "string" || uri.length === 0) {
    return { missing: true, parseError: false, json: null };
  }
  const path = resolveArtifactPath(uri);
  if (!path || !existsSync(path)) {
    return { missing: true, parseError: false, json: null };
  }

  try {
    return {
      missing: false,
      parseError: false,
      json: JSON.parse(readFileSync(path, "utf8"))
    };
  } catch (error) {
    return {
      missing: false,
      parseError: true,
      parseErrorMessage: error instanceof Error ? error.message : String(error),
      json: null
    };
  }
}

function resolveArtifactPath(uri) {
  if (uri.startsWith("local:")) {
    return resolve(process.cwd(), uri.slice("local:".length));
  }
  return resolve(process.cwd(), uri);
}

function inferSide(row, teamId, responseData) {
  if (isRecord(responseData) && (responseData.side === "attack" || responseData.side === "defense")) {
    return responseData.side;
  }

  const tactical = safeJson(row.tactical_context_json);
  const sideAssignment = isRecord(tactical?.sideAssignment) ? tactical.sideAssignment : null;
  if (!sideAssignment || typeof teamId !== "string") {
    return "unknown";
  }
  if (sideAssignment.attackingTeamId === teamId) {
    return "attack";
  }
  if (sideAssignment.defendingTeamId === teamId) {
    return "defense";
  }
  return "unknown";
}

function inferRole(row, task) {
  if (task.startsWith("coach_")) {
    return "Coach";
  }
  if (task === "judge" || task === "judge_review") {
    return "Judge";
  }
  if (task === "team_plan") {
    return "Team";
  }
  return normalizeRole(row.agent_role);
}

function normalizeRole(role) {
  const value = String(role ?? "unknown").toLowerCase();
  if (value === "igl") return "IGL";
  if (value === "entry") return "Entry";
  if (value === "awper" || value === "awp") return "AWPer";
  if (value === "star_rifler" || value === "star" || value === "rifler_star") return "Star Rifler";
  if (value === "support") return "Support";
  if (value === "lurker") return "Lurker";
  if (value === "coach" || value === "head_coach") return "Coach";
  if (value === "rifler") return "Rifler";
  return role ? String(role) : "unknown";
}

function normalizeTask(task) {
  return typeof task === "string" && task.length > 0 ? task : "unknown";
}

function inferTeamIdFromText(text, teams) {
  if (typeof text !== "string") {
    return undefined;
  }
  for (const teamId of teams.keys()) {
    if (text.includes(teamId)) {
      return teamId;
    }
  }
  return undefined;
}

function resolveTeamDisplayName(teamId, teams) {
  if (!teamId) {
    return null;
  }
  return teams.get(teamId)?.displayName ?? teamId;
}

function isJsonOrSchemaFailure(json) {
  if (!isRecord(json)) {
    return false;
  }
  const text = [
    json.error,
    json.rawTextPreview,
    json.parseCandidatePreview,
    typeof json.rawText === "string" && json.rawText.length < 1000 ? json.rawText : ""
  ]
    .filter(Boolean)
    .join("\n");
  return /(parse as JSON|JSON|invalid_enum_value|invalid_type|Expected array|Expected object|does not parse|schema|Zod)/i.test(text);
}

function safeJson(value) {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function summarizeEconomyRows(rows) {
  const byBuyType = {};
  const outputBudgetByBuyType = {};
  const visibleContextBudgetValues = [];

  for (const row of rows) {
    const buyType = typeof row.buy_type === "string" ? row.buy_type : "unknown";
    increment(byBuyType, buyType);
    const outputBudget = toNumber(row.output_budget);
    if (outputBudget !== null) {
      if (!outputBudgetByBuyType[buyType]) {
        outputBudgetByBuyType[buyType] = [];
      }
      outputBudgetByBuyType[buyType].push(outputBudget);
    }
    const visibleContextBudget = toNumber(row.visible_context_budget);
    if (visibleContextBudget !== null) {
      visibleContextBudgetValues.push(visibleContextBudget);
    }
  }

  const outputBudgetStatsByBuyType = {};
  for (const [buyType, values] of Object.entries(outputBudgetByBuyType)) {
    outputBudgetStatsByBuyType[buyType] = statsForValues(values);
  }

  return {
    rowCount: rows.length,
    byBuyType,
    outputBudgetStatsByBuyType,
    visibleContextBudget: {
      observedCount: visibleContextBudgetValues.length,
      compatibilityStatus: "frozen_not_used_for_phase20pre_economy_calibration"
    }
  };
}

function buildReport({ scan, options, dbPath, calibrationRunIds }) {
  const generatedAt = new Date().toISOString();
  const stats = buildStatistics(scan.samples);
  const recommendations = buildRecommendations(stats.byTask.agent_action);

  return {
    schemaVersion: 1,
    reportId: "phase20pre-economy-calibration",
    phase: "Phase 2.0-pre",
    generatedAt,
    sqlitePath: dbPath,
    dryRun: options.dryRun,
    options: {
      allowNewRun: options.allowNewRun,
      maxRounds: options.maxRounds
    },
    metadata: {
      fixtureId,
      calibrationRunIds,
      includedRunIds: scan.summary.includedRunIds,
      includedRuntimeMatchIds: scan.summary.includedRuntimeMatchIds,
      includedRoundKeys: scan.summary.includedRoundKeys,
      includedCommittedRoundKeys: scan.summary.includedCommittedRoundKeys,
      excludedSampleReasons: scan.summary.excludedSampleReasons,
      artifactDiagnostics: scan.summary.artifactDiagnostics,
      tableCounts: scan.tableCounts,
      percentileMethod: "nearest-rank",
      trackedTasks,
      hardRules: [
        "inputTokens 只作为工程观测，不进入比赛经济预算建议。",
        "outputTokens 是本报告的主要校准对象。",
        "visibleContextBudget 在 Phase 2.0-pre 冻结为兼容字段，不参与经济闭环。",
        "SubmittedOutput 尚未真实裁剪；本报告只给未来 outputBudget 建议区间，不声称已完成 Output Gate。",
        "失败 run 中已完成的真实 LLM call 可进入 token 分布统计，但不进入胜负分布判断。",
        "fake provider、旧 demo、旧 4v7 模板结果已排除。"
      ]
    },
    sampleSummary: {
      totalLlmCallRows: scan.summary.totalLlmCallRows,
      includedCallCount: scan.summary.includedCallCount,
      includedRoundCount: scan.summary.includedRoundCount,
      includedCommittedRoundCount: scan.summary.includedCommittedRoundCount,
      uncommittedCallCount: scan.samples.filter((sample) => !sample.hasCommittedRoundReport).length,
      byTask: countBy(scan.samples, "task"),
      byRole: countBy(scan.samples, "role"),
      byTeam: countBy(scan.samples, "teamName"),
      byRound: countBy(scan.samples, (sample) => `R${sample.roundNumber}`),
      bySide: countBy(scan.samples, "side"),
      economy: scan.economy,
      phase18Runs: scan.runRows
    },
    statistics: stats,
    outputBudgetRecommendations: recommendations,
    includedSamples: scan.samples
  };
}

function buildStatistics(samples) {
  return {
    overall: statsForSamples(samples),
    byTask: statsBy(samples, "task"),
    byRole: statsBy(samples, "role"),
    byTeam: statsBy(samples, (sample) => sample.teamName ?? "unknown"),
    byRound: statsBy(samples, (sample) => `R${sample.roundNumber}`),
    bySide: statsBy(samples, "side"),
    byTaskAndRole: statsBy(samples, (sample) => `${sample.task} / ${sample.role}`),
    byTaskAndTeam: statsBy(samples, (sample) => `${sample.task} / ${sample.teamName ?? "unknown"}`)
  };
}

function statsBy(samples, keySelector) {
  const groups = {};
  for (const sample of samples) {
    const key = typeof keySelector === "function" ? keySelector(sample) : sample[keySelector];
    const normalizedKey = key ?? "unknown";
    if (!groups[normalizedKey]) {
      groups[normalizedKey] = [];
    }
    groups[normalizedKey].push(sample);
  }

  const output = {};
  for (const [key, groupSamples] of Object.entries(groups).sort(([left], [right]) => left.localeCompare(right))) {
    output[key] = statsForSamples(groupSamples);
  }
  return output;
}

function statsForSamples(samples) {
  const outputValues = samples
    .map((sample) => sample.outputTokens)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  const inputValues = samples
    .map((sample) => sample.inputTokens)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  const outputStats = statsForValues(outputValues);
  return {
    ...outputStats,
    sample_count_total: samples.length,
    input_tokens_observation: statsForValues(inputValues),
    missing_usage_count: samples.filter((sample) => sample.missingUsage).length,
    failed_or_partial_call_count: samples.filter((sample) => sample.failedOrPartial).length,
    json_parse_failure_count: samples.filter((sample) => sample.jsonParseFailure).length
  };
}

function statsForValues(values) {
  const sorted = values.filter((value) => typeof value === "number" && Number.isFinite(value)).sort((left, right) => left - right);
  if (sorted.length === 0) {
    return {
      count: 0,
      avg: null,
      min: null,
      max: null,
      P25: null,
      P50: null,
      P75: null,
      P90: null
    };
  }

  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    avg: roundNumber(sum / sorted.length),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    P25: percentileNearestRank(sorted, 0.25),
    P50: percentileNearestRank(sorted, 0.5),
    P75: percentileNearestRank(sorted, 0.75),
    P90: percentileNearestRank(sorted, 0.9)
  };
}

function percentileNearestRank(sortedValues, percentile) {
  if (sortedValues.length === 0) {
    return null;
  }
  const index = Math.max(0, Math.ceil(percentile * sortedValues.length) - 1);
  return sortedValues[Math.min(index, sortedValues.length - 1)];
}

function roundNumber(value) {
  return Math.round(value * 100) / 100;
}

function buildRecommendations(agentActionStats) {
  if (!agentActionStats || agentActionStats.count === 0) {
    return {
      status: "insufficient_samples",
      notes: ["没有可用 agent_action outputTokens 样本，不能给出 outputBudget 候选。"]
    };
  }

  const enoughForLowBand = agentActionStats.count >= 30;
  return {
    status: enoughForLowBand ? "candidate_ready" : "needs_more_samples",
    source: "agent_action outputTokens nearest-rank percentiles",
    sampleCount: agentActionStats.count,
    fullBuyOutputBudgetCandidate: agentActionStats.P75,
    halfBuyOutputBudgetCandidate: agentActionStats.P50,
    ecoSaveOutputBudgetCandidate: enoughForLowBand ? agentActionStats.P25 : null,
    forceBuyInitialBand: enoughForLowBand
      ? {
          low: agentActionStats.P50,
          high: agentActionStats.P75
        }
      : null,
    notes: [
      "team_plan 与 judge 已单独统计，不直接映射到 player buy type。",
      "这些只是下一步经济实装的建议，不会自动改动 runtime。",
      enoughForLowBand
        ? "样本数足够给出 fullBuy / halfBuy / eco-save 的首版候选。"
        : "样本数不足 30，eco / save 低位预算建议暂标为待补样本。"
    ]
  };
}

function countBy(items, keySelector) {
  const output = {};
  for (const item of items) {
    const key = typeof keySelector === "function" ? keySelector(item) : item[keySelector];
    increment(output, key ?? "unknown");
  }
  return output;
}

function increment(record, key) {
  const normalizedKey = String(key ?? "unknown");
  record[normalizedKey] = (record[normalizedKey] ?? 0) + 1;
}

function toNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function placeholders(values) {
  return values.map(() => "?").join(",");
}

function runPhase18Rounds(roundsToRun, path) {
  const runIds = [];
  for (let index = 0; index < roundsToRun; index += 1) {
    const before = scanRunIds(path);
    const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const result = spawnSync(executable, ["phase18:round"], {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env
    });
    if (result.status !== 0) {
      throw new Error(`pnpm phase18:round failed with exit code ${result.status ?? "unknown"}`);
    }
    const after = scanRunIds(path);
    for (const runId of after) {
      if (!before.has(runId)) {
        runIds.push(runId);
      }
    }
  }
  return [...new Set(runIds)];
}

function scanRunIds(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return new Set(
      db
        .prepare("SELECT id FROM simulation_runs WHERE fixture_id = ?")
        .all(fixtureId)
        .map((row) => row.id)
        .filter((value) => typeof value === "string")
    );
  } finally {
    db.close();
  }
}

function printConsoleSummary(report, dryRun) {
  console.log(`Phase 2.0-pre economy calibration ${dryRun ? "dry-run" : "report generated"}`);
  console.log(`Included runs: ${report.metadata.includedRunIds.join(", ") || "none"}`);
  console.log(`Included rounds: ${report.sampleSummary.includedRoundCount}`);
  console.log(`Included LLM calls: ${report.sampleSummary.includedCallCount}`);
  console.log(`Agent action P50/P75: ${report.statistics.byTask.agent_action?.P50 ?? "n/a"} / ${report.statistics.byTask.agent_action?.P75 ?? "n/a"}`);
  if (!dryRun) {
    console.log(`JSON: ${reportJsonPath}`);
    console.log(`Markdown: ${reportMarkdownPath}`);
  }
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Phase 2.0-pre 经济系统 Token 校准报告");
  lines.push("");
  lines.push(`生成时间：${report.generatedAt}`);
  lines.push(`SQLite：\`${report.sqlitePath}\``);
  lines.push("");
  lines.push("## 结论摘要");
  lines.push("");
  lines.push(`- 纳入统计的 run：${report.metadata.includedRunIds.length > 0 ? report.metadata.includedRunIds.map((id) => `\`${id}\``).join(", ") : "无"}`);
  lines.push(`- 纳入统计的 LLM 观测回合数：${report.sampleSummary.includedRoundCount}`);
  lines.push(`- 已提交 replay 的回合数：${report.sampleSummary.includedCommittedRoundCount}`);
  lines.push(`- 纳入统计的 LLM call：${report.sampleSummary.includedCallCount}`);
  lines.push(`- 未归档到 replay、仅用于 token 分布的 LLM call：${report.sampleSummary.uncommittedCallCount}`);
  lines.push(`- \`agent_action\` 的 P75 是 full buy 初始候选：${formatNullable(report.outputBudgetRecommendations.fullBuyOutputBudgetCandidate)}`);
  lines.push(`- \`agent_action\` 的 P50 是 half buy 初始候选：${formatNullable(report.outputBudgetRecommendations.halfBuyOutputBudgetCandidate)}`);
  lines.push(`- \`agent_action\` 的 P25 是 eco / save 初始候选：${formatNullable(report.outputBudgetRecommendations.ecoSaveOutputBudgetCandidate)}`);
  lines.push("");
  lines.push("本报告只做真实 LLM `outputTokens` 校准，不改 prompt 可见信息、不改 Output Gate、不改裁判胜负逻辑、不改前端。");
  lines.push("");
  lines.push("## 硬约束");
  lines.push("");
  for (const rule of report.metadata.hardRules) {
    lines.push(`- ${rule}`);
  }
  lines.push("");
  lines.push("## 样本范围");
  lines.push("");
  lines.push("| 维度 | 数量 |");
  lines.push("| --- | ---: |");
  lines.push(`| SQLite llm_calls 总行数 | ${report.sampleSummary.totalLlmCallRows} |`);
  lines.push(`| 纳入统计 LLM call | ${report.sampleSummary.includedCallCount} |`);
  lines.push(`| 纳入统计 LLM 观测回合 | ${report.sampleSummary.includedRoundCount} |`);
  lines.push(`| 已提交 replay 回合 | ${report.sampleSummary.includedCommittedRoundCount} |`);
  lines.push(`| 未归档到 replay 的 LLM call | ${report.sampleSummary.uncommittedCallCount} |`);
  lines.push(`| economy_states 观测行 | ${report.sampleSummary.economy.rowCount} |`);
  lines.push("");
  lines.push("### 排除样本原因");
  lines.push("");
  lines.push(renderCountTable(report.metadata.excludedSampleReasons, "原因", "数量"));
  lines.push("");
  lines.push("### response artifact 诊断");
  lines.push("");
  lines.push(renderCountTable(report.metadata.artifactDiagnostics, "项目", "值"));
  lines.push("");
  lines.push("## outputTokens 统计");
  lines.push("");
  lines.push("### 按任务");
  lines.push("");
  lines.push(renderStatsTable(report.statistics.byTask));
  lines.push("");
  lines.push("### 按角色");
  lines.push("");
  lines.push(renderStatsTable(report.statistics.byRole));
  lines.push("");
  lines.push("### 按队伍");
  lines.push("");
  lines.push(renderStatsTable(report.statistics.byTeam));
  lines.push("");
  lines.push("### 按回合 R1-R6");
  lines.push("");
  lines.push(renderStatsTable(report.statistics.byRound));
  lines.push("");
  lines.push("### 按攻守侧");
  lines.push("");
  lines.push(renderStatsTable(report.statistics.bySide));
  lines.push("");
  lines.push("## 经济状态观测");
  lines.push("");
  lines.push("### buyType 分布");
  lines.push("");
  lines.push(renderCountTable(report.sampleSummary.economy.byBuyType, "buyType", "数量"));
  lines.push("");
  lines.push("### 当前 outputBudget 观测");
  lines.push("");
  lines.push(renderStatsTable(report.sampleSummary.economy.outputBudgetStatsByBuyType));
  lines.push("");
  lines.push("`visibleContextBudget` 在 Phase 2.0-pre 已冻结为兼容字段，本报告不把它作为有效经济变量。");
  lines.push("");
  lines.push("## Output Budget 建议口径");
  lines.push("");
  lines.push(`- 状态：${report.outputBudgetRecommendations.status}`);
  lines.push(`- 样本数：${report.outputBudgetRecommendations.sampleCount ?? 0}`);
  lines.push(`- fullBuy 候选：${formatNullable(report.outputBudgetRecommendations.fullBuyOutputBudgetCandidate)}`);
  lines.push(`- halfBuy 候选：${formatNullable(report.outputBudgetRecommendations.halfBuyOutputBudgetCandidate)}`);
  lines.push(`- eco / save 候选：${formatNullable(report.outputBudgetRecommendations.ecoSaveOutputBudgetCandidate)}`);
  if (report.outputBudgetRecommendations.forceBuyInitialBand) {
    lines.push(
      `- forceBuy 初始区间：${report.outputBudgetRecommendations.forceBuyInitialBand.low} - ${report.outputBudgetRecommendations.forceBuyInitialBand.high}`
    );
  }
  for (const note of report.outputBudgetRecommendations.notes ?? []) {
    lines.push(`- ${note}`);
  }
  lines.push("");
  lines.push("## 纳入统计的 run id");
  lines.push("");
  for (const runId of report.metadata.includedRunIds) {
    lines.push(`- \`${runId}\``);
  }
  if (report.metadata.calibrationRunIds.length > 0) {
    lines.push("");
    lines.push("## 本次自动补跑产生的 run id");
    lines.push("");
    for (const runId of report.metadata.calibrationRunIds) {
      lines.push(`- \`${runId}\``);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderStatsTable(statsByKey) {
  const entries = Object.entries(statsByKey ?? {});
  if (entries.length === 0) {
    return "暂无样本。";
  }

  const lines = [
    "| 分组 | count | avg | min | max | P25 | P50 | P75 | P90 | missing | failed/partial | JSON失败 |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
  ];
  for (const [key, stats] of entries) {
    lines.push(
      `| ${escapeMarkdown(key)} | ${stats.count} | ${formatNullable(stats.avg)} | ${formatNullable(stats.min)} | ${formatNullable(stats.max)} | ${formatNullable(stats.P25)} | ${formatNullable(stats.P50)} | ${formatNullable(stats.P75)} | ${formatNullable(stats.P90)} | ${stats.missing_usage_count ?? 0} | ${stats.failed_or_partial_call_count ?? 0} | ${stats.json_parse_failure_count ?? 0} |`
    );
  }
  return lines.join("\n");
}

function renderCountTable(record, keyLabel, valueLabel) {
  const entries = Object.entries(record ?? {});
  if (entries.length === 0) {
    return "暂无。";
  }
  const lines = [`| ${keyLabel} | ${valueLabel} |`, "| --- | ---: |"];
  for (const [key, value] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`| ${escapeMarkdown(key)} | ${value} |`);
  }
  return lines.join("\n");
}

function escapeMarkdown(value) {
  return String(value).replace(/\|/g, "\\|");
}

function formatNullable(value) {
  return typeof value === "number" ? String(value) : "待补样本";
}
