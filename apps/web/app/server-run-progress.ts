import { resolve } from "node:path";

import { phase11DemoIds } from "@agent-major/core";
import { createSqliteRepositories, defaultSqlitePath } from "@agent-major/db";

import { findProjectRoot } from "./server-project-root";
import { runPhase15SingleMapFromWeb, type WebRunSingleMapResult } from "./server-runner";

export type WebRunStatus = "running" | "completed" | "failed";

export interface WebRunProgress {
  runId: string;
  matchId: string;
  mapGameId: string;
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
  llmCalls: {
    count: number;
    inputTokens: number | null;
    outputTokens: number | null;
  };
  progressPercent: number;
  result?: WebRunSingleMapResult;
  error?: string;
}

interface InternalWebRunState extends WebRunProgress {
  promise: Promise<WebRunSingleMapResult>;
}

const estimatedDust2Rounds = 18;
let activeRun: InternalWebRunState | null = null;
let latestRun: InternalWebRunState | null = null;

export function hasActiveWebRun(): boolean {
  return activeRun?.status === "running";
}

export function startPhase15SingleMapWebRun(matchId: string): WebRunProgress {
  if (hasActiveWebRun()) {
    throw new Error("A local match run is already in progress.");
  }

  const now = new Date().toISOString();
  const runId = `web_run_${Date.now().toString(36)}`;
  const promise = runPhase15SingleMapFromWeb(matchId);
  const state: InternalWebRunState = {
    runId,
    matchId,
    mapGameId: phase11DemoIds.mapGameId,
    mapName: "DUST2",
    status: "running",
    startedAt: now,
    updatedAt: now,
    estimatedTotalRounds: estimatedDust2Rounds,
    completedRounds: 0,
    currentRoundNumber: null,
    casterLines: 0,
    casterModes: [],
    llmCalls: {
      count: 0,
      inputTokens: null,
      outputTokens: null
    },
    progressPercent: 0,
    promise
  };

  activeRun = state;
  latestRun = state;

  promise
    .then((result) => {
      state.status = "completed";
      state.result = result;
      state.completedAt = new Date().toISOString();
      state.updatedAt = state.completedAt;
      state.completedRounds = Math.max(state.completedRounds, estimatedDust2Rounds);
      state.casterLines = Math.max(state.casterLines, result.llmCalls.count);
      state.casterModes = result.casterModes;
      state.llmCalls = result.llmCalls;
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
          "SELECT COUNT(*) AS completedRounds, MAX(round_number) AS currentRoundNumber FROM round_reports WHERE map_game_id = ?"
        )
        .get(state.mapGameId) as { completedRounds?: unknown; currentRoundNumber?: unknown } | undefined;
      const casterLines = repositories.sqlite
        .prepare("SELECT COUNT(*) AS count FROM events WHERE map_game_id = ? AND type = 'caster_line_created'")
        .get(state.mapGameId) as { count?: unknown } | undefined;

      state.completedRounds = typeof roundStats?.completedRounds === "number" ? roundStats.completedRounds : state.completedRounds;
      state.currentRoundNumber = typeof roundStats?.currentRoundNumber === "number" ? roundStats.currentRoundNumber : state.currentRoundNumber;
      state.casterLines = typeof casterLines?.count === "number" ? casterLines.count : state.casterLines;
      state.casterModes = readCasterModes(repositories, state.mapGameId);
      state.llmCalls = readLlmCallStats(repositories, state.mapGameId);
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
  mapGameId: string
): WebRunProgress["casterModes"] {
  return repositories.sqlite
    .prepare(
      "SELECT json_extract(payload_json, '$.generationMode') AS mode, COUNT(*) AS count FROM events WHERE map_game_id = ? AND type = 'caster_line_created' GROUP BY mode"
    )
    .all(mapGameId)
    .map((row) => {
      const record = row as { mode?: unknown; count?: unknown };
      return {
        mode: typeof record.mode === "string" ? record.mode : null,
        count: typeof record.count === "number" ? record.count : 0
      };
    });
}

function readLlmCallStats(
  repositories: ReturnType<typeof createSqliteRepositories>,
  mapGameId: string
): WebRunProgress["llmCalls"] {
  const row = repositories.sqlite
    .prepare(
      "SELECT COUNT(*) AS count, SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens FROM llm_calls WHERE round_id IN (SELECT id FROM rounds WHERE map_game_id = ?)"
    )
    .get(mapGameId) as { count?: unknown; inputTokens?: unknown; outputTokens?: unknown } | undefined;

  return {
    count: typeof row?.count === "number" ? row.count : 0,
    inputTokens: typeof row?.inputTokens === "number" ? row.inputTokens : null,
    outputTokens: typeof row?.outputTokens === "number" ? row.outputTokens : null
  };
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
