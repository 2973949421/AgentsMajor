#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const fixtureId = "phase18_match_falcon_7b_vs_vitallmty";
const tournamentId = "agent_major_phase18_llm_pilot";
const defaultDbPath = resolve(process.cwd(), "data", "agent-major.sqlite");

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const dbPath = readArgValue("--db") ?? defaultDbPath;
const artifactRoot = resolve(process.cwd(), "data", "artifacts");

if (!existsSync(dbPath)) {
  throw new Error(`SQLite database not found: ${dbPath}`);
}

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON");

try {
  const matchIds = uniqueStrings([
    ...selectStrings("SELECT runtime_match_id AS value FROM simulation_runs WHERE fixture_id = ?", [fixtureId]),
    ...selectStrings("SELECT id AS value FROM matches WHERE tournament_id = ? OR id = ? OR id LIKE ?", [
      tournamentId,
      fixtureId,
      `${fixtureId}__run_%`
    ])
  ]);
  const mapIds = matchIds.length > 0 ? selectStrings(`SELECT id AS value FROM map_games WHERE match_id IN (${placeholders(matchIds)})`, matchIds) : [];
  const roundIds = mapIds.length > 0 ? selectStrings(`SELECT id AS value FROM rounds WHERE map_game_id IN (${placeholders(mapIds)})`, mapIds) : [];
  const teamIds = selectStrings("SELECT id AS value FROM teams WHERE tournament_id = ? OR id LIKE 'team_phase18_%'", [tournamentId]);
  const agentIds = teamIds.length > 0 ? selectStrings(`SELECT id AS value FROM agents WHERE team_id IN (${placeholders(teamIds)}) OR id LIKE 'agent_phase18_%'`, teamIds) : [];

  const counts = {
    simulationRuns: count("simulation_runs", "fixture_id = ?", [fixtureId]),
    matches: matchIds.length,
    mapGames: mapIds.length,
    rounds: roundIds.length,
    roundReports: matchIds.length > 0 ? count("round_reports", `match_id IN (${placeholders(matchIds)})`, matchIds) : 0,
    events: matchIds.length > 0 ? count("events", `match_id IN (${placeholders(matchIds)}) OR tournament_id = ?`, [...matchIds, tournamentId]) : count("events", "tournament_id = ?", [tournamentId]),
    timelineEvents: matchIds.length > 0 ? count("timeline_events", `match_id IN (${placeholders(matchIds)}) OR tournament_id = ?`, [...matchIds, tournamentId]) : count("timeline_events", "tournament_id = ?", [tournamentId]),
    summaries: countSummaries(matchIds, mapIds, roundIds),
    artifacts: countArtifacts(matchIds, mapIds, roundIds, agentIds),
    llmCalls: countLlmCalls(matchIds, roundIds, agentIds),
    economyStates: mapIds.length > 0 ? count("economy_states", `map_game_id IN (${placeholders(mapIds)})`, mapIds) : 0,
    agents: agentIds.length,
    teams: teamIds.length,
    tournaments: count("tournaments", "id = ?", [tournamentId]),
    artifactFiles: findPhase18ArtifactFiles().length
  };

  if (!apply) {
    printSummary("dry-run", counts, dbPath);
    console.log("Run with --apply to delete these Phase 1.8 runtime facts.");
    process.exit(0);
  }

  const backupPath = resolve(process.cwd(), ".tmp", "backups", `agent-major.before-phase18-clean.${timestampForFile()}.sqlite`);
  mkdirSync(dirname(backupPath), { recursive: true });
  copyFileSync(dbPath, backupPath);

  db.exec("BEGIN IMMEDIATE");
  try {
    runDelete("llm_calls", buildLlmCallWhere(matchIds, roundIds, agentIds));
    runDelete("summaries", buildSummaryWhere(matchIds, mapIds, roundIds));
    runDelete("artifacts", buildArtifactWhere(matchIds, mapIds, roundIds, agentIds));
    if (matchIds.length > 0) {
      runDelete("timeline_events", { where: `match_id IN (${placeholders(matchIds)}) OR tournament_id = ?`, params: [...matchIds, tournamentId] });
      runDelete("events", { where: `match_id IN (${placeholders(matchIds)}) OR tournament_id = ?`, params: [...matchIds, tournamentId] });
    } else {
      runDelete("timeline_events", { where: "tournament_id = ?", params: [tournamentId] });
      runDelete("events", { where: "tournament_id = ?", params: [tournamentId] });
    }
    if (mapIds.length > 0) {
      runDelete("economy_states", { where: `map_game_id IN (${placeholders(mapIds)})`, params: mapIds });
      runDelete("round_reports", { where: `map_game_id IN (${placeholders(mapIds)})`, params: mapIds });
      runDelete("rounds", { where: `map_game_id IN (${placeholders(mapIds)})`, params: mapIds });
      runDelete("map_games", { where: `id IN (${placeholders(mapIds)})`, params: mapIds });
    }
    runDelete("simulation_runs", { where: "fixture_id = ?", params: [fixtureId] });
    if (matchIds.length > 0) {
      runDelete("matches", { where: `id IN (${placeholders(matchIds)})`, params: matchIds });
    }
    if (agentIds.length > 0) {
      runDelete("agents", { where: `id IN (${placeholders(agentIds)})`, params: agentIds });
    }
    if (teamIds.length > 0) {
      runDelete("teams", { where: `id IN (${placeholders(teamIds)})`, params: teamIds });
    }
    runDelete("tournaments", { where: "id = ?", params: [tournamentId] });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  printSummary("deleted", counts, dbPath);
  const deletedFiles = deletePhase18ArtifactFiles();
  if (deletedFiles > 0) {
    console.log(`artifactFilesDeleted: ${deletedFiles}`);
  }
  console.log(`Backup: ${backupPath}`);
} finally {
  db.close();
}

function readArgValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function selectStrings(sql, params = []) {
  return db
    .prepare(sql)
    .all(...params)
    .map((row) => row.value)
    .filter((value) => typeof value === "string" && value.length > 0);
}

function count(table, where, params = []) {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get(...params);
  return typeof row?.count === "number" ? row.count : 0;
}

function countSummaries(matchIds, mapIds, roundIds) {
  return countWithWhere(buildSummaryWhere(matchIds, mapIds, roundIds));
}

function countArtifacts(matchIds, mapIds, roundIds, agentIds) {
  return countWithWhere(buildArtifactWhere(matchIds, mapIds, roundIds, agentIds));
}

function countLlmCalls(matchIds, roundIds, agentIds) {
  return countWithWhere(buildLlmCallWhere(matchIds, roundIds, agentIds));
}

function countWithWhere(filter) {
  return filter ? count(filter.table, filter.where, filter.params) : 0;
}

function buildSummaryWhere(matchIds, mapIds, roundIds) {
  return buildScopedWhere("summaries", [
    { column: "scope_id", values: matchIds },
    { column: "match_id", values: matchIds },
    { column: "map_game_id", values: mapIds },
    { column: "round_id", values: roundIds },
    { column: "tournament_id", values: [tournamentId] }
  ]);
}

function buildArtifactWhere(matchIds, mapIds, roundIds, agentIds) {
  return buildScopedWhere("artifacts", [
    { column: "match_id", values: matchIds },
    { column: "map_game_id", values: mapIds },
    { column: "round_id", values: roundIds },
    { column: "agent_id", values: agentIds },
    { column: "tournament_id", values: [tournamentId] }
  ]);
}

function buildLlmCallWhere(matchIds, roundIds, agentIds) {
  return buildScopedWhere("llm_calls", [
    { column: "match_id", values: matchIds },
    { column: "round_id", values: roundIds },
    { column: "agent_id", values: agentIds },
    { column: "tournament_id", values: [tournamentId] }
  ]);
}

function buildScopedWhere(table, clauses) {
  const parts = [];
  const params = [];
  for (const clause of clauses) {
    const values = uniqueStrings(clause.values);
    if (values.length === 0) {
      continue;
    }
    parts.push(`${clause.column} IN (${placeholders(values)})`);
    params.push(...values);
  }
  return parts.length > 0 ? { table, where: parts.join(" OR "), params } : null;
}

function runDelete(table, filter) {
  if (!filter) {
    return;
  }
  db.prepare(`DELETE FROM ${table} WHERE ${filter.where}`).run(...filter.params);
}

function placeholders(values) {
  return values.map(() => "?").join(",");
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function printSummary(mode, counts, path) {
  console.log(`Phase 1.8 runtime cleanup ${mode}`);
  console.log(`Database: ${path}`);
  for (const [key, value] of Object.entries(counts)) {
    console.log(`${key}: ${value}`);
  }
}

function findPhase18ArtifactFiles(root = artifactRoot) {
  if (!existsSync(root)) {
    return [];
  }

  const output = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = resolve(root, entry.name);
    if (entry.isDirectory()) {
      output.push(...findPhase18ArtifactFiles(fullPath));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const normalized = fullPath.replace(/\\/g, "/");
    if (normalized.includes(fixtureId) || normalized.includes(tournamentId)) {
      output.push(fullPath);
    }
  }
  return output;
}

function deletePhase18ArtifactFiles() {
  const files = findPhase18ArtifactFiles();
  for (const file of files) {
    unlinkSync(file);
  }
  return files.length;
}
