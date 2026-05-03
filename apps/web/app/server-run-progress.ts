import { resolve } from "node:path";

import { phase11DemoIds } from "@agent-major/core";
import { createSqliteRepositories, defaultSqlitePath } from "@agent-major/db";
import { phase17CanonIds } from "@agent-major/materials";

import { findProjectRoot } from "./server-project-root";
import { runPhase15SingleMapFromWeb, runPhase17ShowcaseFromWeb, type WebRunSingleMapResult } from "./server-runner";

export type WebRunStatus = "running" | "completed" | "failed";
export type WebRunMode = "phase17_showcase_match" | "phase15_single_map";

export interface WebRunProgress {
  runId: string;
  mode: WebRunMode;
  matchId: string;
  mapGameId: string;
  mapGameIds: string[];
  mapName: string;
  status: WebRunStatus;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  estimatedTotalRounds: number;
  completedRounds: number;
  currentRoundNumber: number | null;
  casterLines: number;
  casterModes: Array<{ mode: string | null; count: number }>;
  progressPercent: number;
  result?: WebRunSingleMapResult;
  error?: string;
}

interface InternalWebRunState extends WebRunProgress {
  promise: Promise<WebRunSingleMapResult>;
}

const estimatedDust2Rounds = 18;
const estimatedBo3Rounds = 54;
let activeRun: InternalWebRunState | null = null;
let latestRun: InternalWebRunState | null = null;

export function hasActiveWebRun(): boolean {
  return activeRun?.status === "running";
}

export function startPhase15SingleMapWebRun(matchId: string): WebRunProgress {
  return startWebRun({
    mode: "phase15_single_map",
    matchId,
    mapGameId: phase11DemoIds.mapGameId,
    mapGameIds: [phase11DemoIds.mapGameId],
    mapName: "DUST2",
    estimatedTotalRounds: estimatedDust2Rounds,
    run: () => runPhase15SingleMapFromWeb(matchId)
  });
}

export function startPhase17ShowcaseWebRun(matchId: string): WebRunProgress {
  const mapGameIds = phase17CanonIds.selectedMapIds.map((_, index) => `map_${phase17CanonIds.matchId}_${index + 1}`);
  return startWebRun({
    mode: "phase17_showcase_match",
    matchId,
    mapGameId: mapGameIds[0] ?? `map_${phase17CanonIds.matchId}_1`,
    mapGameIds,
    mapName: phase17CanonIds.selectedMapIds.join(" / "),
    estimatedTotalRounds: estimatedBo3Rounds,
    run: () => runPhase17ShowcaseFromWeb(matchId)
  });
}

function startWebRun(input: {
  mode: WebRunMode;
  matchId: string;
  mapGameId: string;
  mapGameIds: string[];
  mapName: string;
  estimatedTotalRounds: number;
  run: () => Promise<WebRunSingleMapResult>;
}): WebRunProgress {
  if (hasActiveWebRun()) {
    throw new Error("A local match run is already in progress.");
  }

  const now = new Date().toISOString();
  const runId = `web_run_${Date.now().toString(36)}`;
  const promise = input.run();
  const state: InternalWebRunState = {
    runId,
    mode: input.mode,
    matchId: input.matchId,
    mapGameId: input.mapGameId,
    mapGameIds: input.mapGameIds,
    mapName: input.mapName,
    status: "running",
    startedAt: now,
    updatedAt: now,
    estimatedTotalRounds: input.estimatedTotalRounds,
    completedRounds: 0,
    currentRoundNumber: null,
    casterLines: 0,
    casterModes: [],
    progressPercent: 0,
    promise
  };

  activeRun = state;
  latestRun = state;

  promise
    .then((result) => {
      state.status = "completed";
      state.result = result;
      state.mapGameId = result.mapGameId;
      state.mapGameIds = result.mapGameIds ?? [result.mapGameId];
      state.mapName = result.mapNames?.join(" / ") ?? result.mapName;
      state.completedAt = new Date().toISOString();
      state.updatedAt = state.completedAt;
      state.completedRounds = Math.max(state.completedRounds, state.estimatedTotalRounds);
      state.casterLines = Math.max(
        state.casterLines,
        result.casterModes.reduce((sum, item) => sum + item.count, 0)
      );
      state.casterModes = result.casterModes;
      state.progressPercent = 100;
    })
    .catch((error: unknown) => {
      state.status = "failed";
      state.error = sanitizeRunError(error);
      state.completedAt = new Date().toISOString();
      state.updatedAt = state.completedAt;
    })
    .finally(() => {
      if (activeRun?.runId === runId) {
        activeRun = null;
      }
    });

  return stripPromise(state);
}

export function readWebRunProgress(runId?: string): WebRunProgress | null {
  const state = selectRun(runId);
  if (!state) {
    return null;
  }

  try {
    const projectRoot = findProjectRoot(process.cwd());
    const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
    try {
      const roundStats = repositories.sqlite
        .prepare(
          `SELECT COUNT(*) AS completedRounds, MAX(round_number) AS currentRoundNumber FROM round_reports WHERE map_game_id IN (${placeholders(state.mapGameIds)})`
        )
        .get(...state.mapGameIds) as { completedRounds?: unknown; currentRoundNumber?: unknown } | undefined;
      const casterLines = repositories.sqlite
        .prepare(`SELECT COUNT(*) AS count FROM events WHERE map_game_id IN (${placeholders(state.mapGameIds)}) AND type = 'caster_line_created'`)
        .get(...state.mapGameIds) as { count?: unknown } | undefined;

      state.completedRounds = typeof roundStats?.completedRounds === "number" ? roundStats.completedRounds : state.completedRounds;
      state.currentRoundNumber = typeof roundStats?.currentRoundNumber === "number" ? roundStats.currentRoundNumber : state.currentRoundNumber;
      state.casterLines = typeof casterLines?.count === "number" ? casterLines.count : state.casterLines;
      state.casterModes = readCasterModes(repositories, state.mapGameIds);
      state.updatedAt = new Date().toISOString();
      if (state.status === "running") {
        state.progressPercent = Math.min(99, Math.round((state.completedRounds / state.estimatedTotalRounds) * 100));
      }
      if (state.status === "completed") {
        state.progressPercent = 100;
      }
    } finally {
      repositories.close();
    }
  } catch {
    state.updatedAt = new Date().toISOString();
  }

  return stripPromise(state);
}

function selectRun(runId?: string): InternalWebRunState | null {
  if (runId && activeRun?.runId === runId) {
    return activeRun;
  }
  if (runId && latestRun?.runId === runId) {
    return latestRun;
  }
  return activeRun ?? latestRun;
}

function readCasterModes(
  repositories: ReturnType<typeof createSqliteRepositories>,
  mapGameIds: string[]
): WebRunProgress["casterModes"] {
  if (mapGameIds.length === 0) {
    return [];
  }

  return repositories.sqlite
    .prepare(
      `SELECT json_extract(payload_json, '$.generationMode') AS mode, COUNT(*) AS count FROM events WHERE map_game_id IN (${placeholders(mapGameIds)}) AND type = 'caster_line_created' GROUP BY mode`
    )
    .all(...mapGameIds)
    .map((row) => {
      const record = row as { mode?: unknown; count?: unknown };
      return {
        mode: typeof record.mode === "string" ? record.mode : null,
        count: typeof record.count === "number" ? record.count : 0
      };
    });
}

function placeholders(values: string[]): string {
  return values.map(() => "?").join(",");
}

function stripPromise(state: InternalWebRunState): WebRunProgress {
  const { promise: _promise, ...progress } = state;
  return progress;
}

export function sanitizeRunError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/gi, "sk-[redacted]")
    .replace(/(api[_ -]?key["'\s:=]+)([^"',}\s]+)/gi, "$1[redacted]")
    .replace(/(authorization["'\s:=]+)(Bearer\s+)?([^"',}\s]+)/gi, "$1[redacted]");
}
