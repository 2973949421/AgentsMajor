import { resolve } from "node:path";

import { createSqliteRepositories, defaultSqlitePath } from "@agent-major/db";
import { phase17CanonIds, phase18CanonIds } from "@agent-major/materials";

import { findProjectRoot } from "./server-project-root";
import {
  runPhase17ShowcaseFromWeb,
  runPhase18CurrentMapFromWeb,
  runPhase18FullBo3FromWeb,
  runPhase18NextRoundFromWeb,
  type WebRunSingleMapResult
} from "./server-runner";

export type WebRunStatus = "running" | "completed" | "failed";
export type WebRunMode = "phase17_showcase_match" | "phase18_next_round" | "phase18_current_map" | "phase18_full_bo3";
export type WebRunLlmCallStatus = "started" | "completed" | "failed";

export interface WebRunLlmCallProgress {
  callId: string;
  taskType: string;
  roundNumber: number;
  agentId?: string;
  driverModelId: string;
  status: WebRunLlmCallStatus;
  startedAt: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}

export interface WebRunLlmSummary {
  expectedTotalCalls: number;
  startedCalls: number;
  completedCalls: number;
  failedCalls: number;
  runningCalls: number;
}

export interface WebRunProgress {
  runId: string;
  mode: WebRunMode;
  matchId: string;
  targetMatchId: string;
  mapGameId: string;
  mapGameIds: string[];
  mapName: string;
  status: WebRunStatus;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  estimatedTotalRounds: number;
  baselineCompletedRounds: number;
  completedRounds: number;
  hasFreshReplay: boolean;
  currentRoundNumber: number | null;
  currentMapOrder: number | null;
  casterLines: number;
  casterModes: Array<{ mode: string | null; count: number }>;
  llmSummary: WebRunLlmSummary;
  llmCalls: WebRunLlmCallProgress[];
  progressPercent: number;
  result?: WebRunSingleMapResult;
  error?: string;
}

interface InternalWebRunState extends WebRunProgress {
  promise: Promise<WebRunSingleMapResult>;
  llmSinceSequence: number;
}

const estimatedBo3Rounds = 54;
const estimatedMaxRoundsPerMap = 18;
const phase18CallsPerRound = 13;

let activeRun: InternalWebRunState | null = null;
let latestRun: InternalWebRunState | null = null;

export function hasActiveWebRun(): boolean {
  return activeRun?.status === "running";
}

export function startPhase17ShowcaseWebRun(matchId: string): WebRunProgress {
  if (matchId !== phase17CanonIds.matchId) {
    throw new Error(`Web runner only supports the Phase 1.7 showcase match: ${phase17CanonIds.matchId}`);
  }

  const mapGameIds = phase17CanonIds.selectedMapIds.map((_, index) => `map_${phase17CanonIds.matchId}_${index + 1}`);
  return startWebRun({
    mode: "phase17_showcase_match",
    matchId,
    targetMatchId: matchId,
    mapGameId: mapGameIds[0] ?? `map_${phase17CanonIds.matchId}_1`,
    mapGameIds,
    mapName: phase17CanonIds.selectedMapIds.join(" / "),
    estimatedTotalRounds: estimatedBo3Rounds,
    expectedTotalCalls: 0,
    run: () => runPhase17ShowcaseFromWeb(matchId)
  });
}

export function startPhase18NextRoundWebRun(matchId: string): WebRunProgress {
  if (matchId !== phase18CanonIds.matchId) {
    throw new Error(`Web runner only supports the Phase 1.8 pilot match: ${phase18CanonIds.matchId}`);
  }

  const snapshot = readPhase18StartSnapshot("phase18_next_round");
  return startWebRun({
    mode: "phase18_next_round",
    matchId,
    targetMatchId: matchId,
    ...snapshot,
    run: () => runPhase18NextRoundFromWeb(matchId)
  });
}

export function startPhase18CurrentMapWebRun(matchId: string): WebRunProgress {
  if (matchId !== phase18CanonIds.matchId) {
    throw new Error(`Web runner only supports the Phase 1.8 pilot match: ${phase18CanonIds.matchId}`);
  }

  const snapshot = readPhase18StartSnapshot("phase18_current_map");
  return startWebRun({
    mode: "phase18_current_map",
    matchId,
    targetMatchId: matchId,
    ...snapshot,
    run: () => runPhase18CurrentMapFromWeb(matchId)
  });
}

export function startPhase18FullBo3WebRun(matchId: string): WebRunProgress {
  if (matchId !== phase18CanonIds.matchId) {
    throw new Error(`Web runner only supports the Phase 1.8 pilot match: ${phase18CanonIds.matchId}`);
  }

  const snapshot = readPhase18StartSnapshot("phase18_full_bo3");
  return startWebRun({
    mode: "phase18_full_bo3",
    matchId,
    targetMatchId: matchId,
    ...snapshot,
    run: () => runPhase18FullBo3FromWeb(matchId)
  });
}

function startWebRun(input: {
  mode: WebRunMode;
  matchId: string;
  targetMatchId: string;
  mapGameId: string;
  mapGameIds: string[];
  mapName: string;
  estimatedTotalRounds: number;
  completedRounds?: number;
  currentRoundNumber?: number | null;
  currentMapOrder?: number | null;
  expectedTotalCalls: number;
  llmSinceSequence?: number;
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
    targetMatchId: input.targetMatchId,
    mapGameId: input.mapGameId,
    mapGameIds: input.mapGameIds,
    mapName: input.mapName,
    status: "running",
    startedAt: now,
    updatedAt: now,
    estimatedTotalRounds: input.estimatedTotalRounds,
    baselineCompletedRounds: input.completedRounds ?? 0,
    completedRounds: input.completedRounds ?? 0,
    hasFreshReplay: false,
    currentRoundNumber: input.currentRoundNumber ?? null,
    currentMapOrder: input.currentMapOrder ?? null,
    casterLines: 0,
    casterModes: [],
    llmSummary: {
      expectedTotalCalls: input.expectedTotalCalls,
      startedCalls: 0,
      completedCalls: 0,
      failedCalls: 0,
      runningCalls: 0
    },
    llmCalls: [],
    progressPercent: 0,
    promise,
    llmSinceSequence: input.llmSinceSequence ?? 0
  };

  activeRun = state;
  latestRun = state;

  promise
    .then((result) => {
      state.status = "completed";
      state.result = result;
      state.matchId = result.matchId;
      state.targetMatchId = result.matchId;
      state.mapGameId = result.mapGameId;
      state.mapGameIds = result.mapGameIds ?? [result.mapGameId];
      state.mapName = result.mapNames?.join(" / ") ?? result.mapName;
      state.completedAt = new Date().toISOString();
      state.updatedAt = state.completedAt;
      state.completedRounds = Math.max(state.completedRounds, state.estimatedTotalRounds);
      state.hasFreshReplay = state.completedRounds > state.baselineCompletedRounds;
      state.casterLines = Math.max(state.casterLines, result.casterModes.reduce((sum, item) => sum + item.count, 0));
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

interface Phase18StartSnapshot {
  mapGameId: string;
  mapGameIds: string[];
  mapName: string;
  estimatedTotalRounds: number;
  completedRounds: number;
  currentRoundNumber: number | null;
  currentMapOrder: number | null;
  expectedTotalCalls: number;
  llmSinceSequence: number;
}

interface Phase18MapSnapshot {
  id: string;
  mapName: string;
  mapOrder: number;
  status: string;
  currentRoundNumber: number;
}

export interface WebRunMapProgressSnapshot {
  completedRounds: number;
  currentRoundNumber: number | null;
  currentMapOrder: number | null;
  currentMapGameId: string | null;
}

function readPhase18StartSnapshot(mode: Extract<WebRunMode, "phase18_next_round" | "phase18_current_map" | "phase18_full_bo3">): Phase18StartSnapshot {
  const fallbackMapGameIds = phase18CanonIds.selectedMapIds.map((_, index) => `map_${phase18CanonIds.matchId}_${index + 1}`);
  const fallback = {
    mapGameId: fallbackMapGameIds[0] ?? `map_${phase18CanonIds.matchId}_1`,
    mapGameIds: fallbackMapGameIds,
    mapName: phase18CanonIds.selectedMapIds.join(" / "),
    completedRounds: 0,
    currentRoundNumber: null,
    currentMapOrder: null,
    llmSinceSequence: 0
  };

  try {
    const projectRoot = findProjectRoot(process.cwd());
    const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
    try {
      const maxSequence = repositories.sqlite.prepare("SELECT COALESCE(MAX(global_sequence), 0) AS value FROM events").get() as { value?: unknown };
      const match = repositories.sqlite
        .prepare("SELECT status, team_a_maps_won AS teamAMapsWon, team_b_maps_won AS teamBMapsWon FROM matches WHERE id = ?")
        .get(phase18CanonIds.matchId) as
        | {
            status?: unknown;
            teamAMapsWon?: unknown;
            teamBMapsWon?: unknown;
          }
        | undefined;

      if (!match || match.status === "completed") {
        const remainingRounds =
          mode === "phase18_next_round" ? 1 : mode === "phase18_current_map" ? estimatedMaxRoundsPerMap : estimatedBo3Rounds;
        return {
          ...fallback,
          estimatedTotalRounds: remainingRounds,
          expectedTotalCalls: remainingRounds * phase18CallsPerRound,
          llmSinceSequence: 0
        };
      }

      const mapRows = repositories.sqlite
        .prepare(
          `SELECT id,
                  map_name AS mapName,
                  map_order AS mapOrder,
                  status,
                  current_round_number AS currentRoundNumber
           FROM map_games
           WHERE match_id = ?
           ORDER BY map_order ASC`
        )
        .all(phase18CanonIds.matchId) as Phase18MapSnapshot[];
      const completedRoundStats = repositories.sqlite
        .prepare("SELECT COUNT(*) AS count FROM round_reports WHERE match_id = ?")
        .get(phase18CanonIds.matchId) as { count?: unknown };
      const completedRounds = typeof completedRoundStats.count === "number" ? completedRoundStats.count : 0;
      const currentMap = selectCurrentMapSnapshot(mapRows);
      const remainingRounds = estimatePhase18RemainingRounds({
        mode,
        maps: mapRows,
        teamAMapsWon: typeof match.teamAMapsWon === "number" ? match.teamAMapsWon : 0,
        teamBMapsWon: typeof match.teamBMapsWon === "number" ? match.teamBMapsWon : 0
      });

      return {
        mapGameId: currentMap?.id ?? fallback.mapGameId,
        mapGameIds: mapRows.length > 0 ? mapRows.map((mapGame) => mapGame.id) : fallback.mapGameIds,
        mapName: mapRows.length > 0 ? mapRows.map((mapGame) => mapGame.mapName).join(" / ") : fallback.mapName,
        estimatedTotalRounds: completedRounds + remainingRounds,
        completedRounds,
        currentRoundNumber: currentMap ? currentMap.currentRoundNumber || null : null,
        currentMapOrder: currentMap ? currentMap.mapOrder : null,
        expectedTotalCalls: remainingRounds * phase18CallsPerRound,
        llmSinceSequence: typeof maxSequence.value === "number" ? maxSequence.value : 0
      };
    } finally {
      repositories.close();
    }
  } catch {
    const remainingRounds = mode === "phase18_next_round" ? 1 : mode === "phase18_current_map" ? estimatedMaxRoundsPerMap : estimatedBo3Rounds;
    return {
      ...fallback,
      estimatedTotalRounds: remainingRounds,
      expectedTotalCalls: remainingRounds * phase18CallsPerRound
    };
  }
}

function estimatePhase18RemainingRounds(input: {
  mode: Extract<WebRunMode, "phase18_next_round" | "phase18_current_map" | "phase18_full_bo3">;
  maps: Phase18MapSnapshot[];
  teamAMapsWon: number;
  teamBMapsWon: number;
}): number {
  if (input.mode === "phase18_next_round") {
    return 1;
  }

  const currentMap = input.maps.find((mapGame) => mapGame.status !== "completed");
  const currentMapRemaining = currentMap ? Math.max(1, estimatedMaxRoundsPerMap - currentMap.currentRoundNumber) : estimatedMaxRoundsPerMap;
  if (input.mode === "phase18_current_map") {
    return currentMapRemaining;
  }

  if (Math.max(input.teamAMapsWon, input.teamBMapsWon) >= 2) {
    return 1;
  }

  const completedMaps = input.maps.filter((mapGame) => mapGame.status === "completed").length;
  const maxRemainingMaps = Math.max(1, 3 - completedMaps);
  return currentMapRemaining + Math.max(0, maxRemainingMaps - 1) * estimatedMaxRoundsPerMap;
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
      const casterLines = repositories.sqlite
        .prepare(`SELECT COUNT(*) AS count FROM events WHERE map_game_id IN (${placeholders(state.mapGameIds)}) AND type = 'caster_line_created'`)
        .get(...state.mapGameIds) as { count?: unknown } | undefined;
      const mapProgress = readMapProgressSnapshot(repositories, state.mapGameIds);

      state.completedRounds = mapProgress.completedRounds;
      state.hasFreshReplay = state.completedRounds > state.baselineCompletedRounds;
      state.currentRoundNumber = mapProgress.currentRoundNumber;
      state.currentMapOrder = mapProgress.currentMapOrder;
      if (mapProgress.currentMapGameId) {
        state.mapGameId = mapProgress.currentMapGameId;
      }
      state.casterLines = typeof casterLines?.count === "number" ? casterLines.count : state.casterLines;
      state.casterModes = readCasterModes(repositories, state.mapGameIds);
      if (isPhase18Mode(state.mode)) {
        const llmCalls = readLlmCalls(repositories, state.matchId, state.llmSinceSequence);
        state.llmCalls = llmCalls;
        state.llmSummary = summarizeLlmCalls(state.llmSummary.expectedTotalCalls, llmCalls);
      } else {
        state.llmCalls = [];
        state.llmSummary = summarizeLlmCalls(0, []);
      }
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

function isPhase18Mode(mode: WebRunMode): boolean {
  return mode === "phase18_next_round" || mode === "phase18_current_map" || mode === "phase18_full_bo3";
}

function selectCurrentMapSnapshot(maps: Phase18MapSnapshot[]): Phase18MapSnapshot | undefined {
  return maps.find((mapGame) => mapGame.status !== "completed") ?? maps[maps.length - 1];
}

export function readMapProgressSnapshot(
  repositories: ReturnType<typeof createSqliteRepositories>,
  mapGameIds: string[]
): WebRunMapProgressSnapshot {
  if (mapGameIds.length === 0) {
    return {
      completedRounds: 0,
      currentRoundNumber: null,
      currentMapOrder: null,
      currentMapGameId: null
    };
  }

  const roundStats = repositories.sqlite
    .prepare(`SELECT COUNT(*) AS completedRounds FROM round_reports WHERE map_game_id IN (${placeholders(mapGameIds)})`)
    .get(...mapGameIds) as { completedRounds?: unknown } | undefined;
  const mapRows = repositories.sqlite
    .prepare(
      `SELECT id,
              map_order AS mapOrder,
              status,
              current_round_number AS currentRoundNumber
       FROM map_games
       WHERE id IN (${placeholders(mapGameIds)})
       ORDER BY map_order ASC`
    )
    .all(...mapGameIds) as Array<{
      id?: unknown;
      mapOrder?: unknown;
      status?: unknown;
      currentRoundNumber?: unknown;
    }>;
  const maps = mapRows
    .map((row) => ({
      id: typeof row.id === "string" ? row.id : "",
      mapName: "",
      mapOrder: typeof row.mapOrder === "number" ? row.mapOrder : 0,
      status: typeof row.status === "string" ? row.status : "pending",
      currentRoundNumber: typeof row.currentRoundNumber === "number" ? row.currentRoundNumber : 0
    }))
    .filter((map) => map.id.length > 0);
  const currentMap = selectCurrentMapSnapshot(maps);

  return {
    completedRounds: typeof roundStats?.completedRounds === "number" ? roundStats.completedRounds : 0,
    currentRoundNumber: currentMap ? currentMap.currentRoundNumber || null : null,
    currentMapOrder: currentMap ? currentMap.mapOrder : null,
    currentMapGameId: currentMap?.id ?? null
  };
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

function readLlmCalls(repositories: ReturnType<typeof createSqliteRepositories>, matchId: string, sinceSequence: number): WebRunLlmCallProgress[] {
  const rows = repositories.sqlite
    .prepare(
      `SELECT type, payload_json, global_sequence
       FROM events
       WHERE match_id = ?
         AND global_sequence > ?
         AND type IN ('llm_call_started', 'llm_call_completed', 'llm_call_failed')
       ORDER BY global_sequence ASC`
    )
    .all(matchId, sinceSequence) as Array<{ type?: unknown; payload_json?: unknown }>;

  const callsById = new Map<string, WebRunLlmCallProgress>();
  for (const row of rows) {
    const payload = parseLlmCallPayload(row.payload_json);
    if (!payload?.callId) {
      continue;
    }

    const current = callsById.get(payload.callId);
    callsById.set(payload.callId, {
      callId: payload.callId,
      taskType: payload.taskType ?? current?.taskType ?? "unknown",
      roundNumber: typeof payload.roundNumber === "number" ? payload.roundNumber : current?.roundNumber ?? 0,
      ...(payload.agentId ? { agentId: payload.agentId } : current?.agentId ? { agentId: current.agentId } : {}),
      driverModelId: payload.driverModelId ?? current?.driverModelId ?? "unknown",
      status: payload.status ?? current?.status ?? "started",
      startedAt: payload.startedAt ?? current?.startedAt ?? "",
      ...(typeof payload.latencyMs === "number" ? { latencyMs: payload.latencyMs } : current?.latencyMs ? { latencyMs: current.latencyMs } : {}),
      ...(typeof payload.inputTokens === "number" ? { inputTokens: payload.inputTokens } : current?.inputTokens ? { inputTokens: current.inputTokens } : {}),
      ...(typeof payload.outputTokens === "number" ? { outputTokens: payload.outputTokens } : current?.outputTokens ? { outputTokens: current.outputTokens } : {}),
      ...(payload.error ? { error: payload.error } : current?.error ? { error: current.error } : {})
    });
  }

  return [...callsById.values()].sort((left, right) => {
    if (right.roundNumber !== left.roundNumber) {
      return right.roundNumber - left.roundNumber;
    }

    return left.callId.localeCompare(right.callId);
  });
}

function parseLlmCallPayload(value: unknown): Partial<WebRunLlmCallProgress> & { callId?: string } | null {
  try {
    const parsed = (typeof value === "string" ? JSON.parse(value) : value) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return {
      ...(typeof parsed.callId === "string" ? { callId: parsed.callId } : {}),
      ...(typeof parsed.taskType === "string" ? { taskType: parsed.taskType } : {}),
      ...(typeof parsed.roundNumber === "number" ? { roundNumber: parsed.roundNumber } : {}),
      ...(typeof parsed.agentId === "string" ? { agentId: parsed.agentId } : {}),
      ...(typeof parsed.driverModelId === "string" ? { driverModelId: parsed.driverModelId } : {}),
      ...(parsed.status === "started" || parsed.status === "completed" || parsed.status === "failed" ? { status: parsed.status } : {}),
      ...(typeof parsed.startedAt === "string" ? { startedAt: parsed.startedAt } : {}),
      ...(typeof parsed.latencyMs === "number" ? { latencyMs: parsed.latencyMs } : {}),
      ...(typeof parsed.inputTokens === "number" ? { inputTokens: parsed.inputTokens } : {}),
      ...(typeof parsed.outputTokens === "number" ? { outputTokens: parsed.outputTokens } : {}),
      ...(typeof parsed.error === "string" ? { error: parsed.error } : {})
    };
  } catch {
    return null;
  }
}

export function summarizeLlmCalls(expectedTotalCalls: number, llmCalls: WebRunLlmCallProgress[]): WebRunLlmSummary {
  const completedCalls = llmCalls.filter((call) => call.status === "completed").length;
  const failedCalls = llmCalls.filter((call) => call.status === "failed").length;
  const runningCalls = llmCalls.filter((call) => call.status === "started").length;
  return {
    expectedTotalCalls: Math.max(expectedTotalCalls, llmCalls.length),
    startedCalls: llmCalls.length,
    completedCalls,
    failedCalls,
    runningCalls
  };
}

function placeholders(values: string[]): string {
  return values.map(() => "?").join(",");
}

function stripPromise(state: InternalWebRunState): WebRunProgress {
  const { promise: _promise, llmSinceSequence: _llmSinceSequence, ...progress } = state;
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

export function __resetWebRunStateForTests(): void {
  activeRun = null;
  latestRun = null;
}

export function readLatestWebRunProgressForMatch(matchId: string): WebRunProgress | null {
  const state = activeRun ?? latestRun;
  if (!state || state.targetMatchId !== matchId) {
    return null;
  }

  return readWebRunProgress(state.runId);
}
