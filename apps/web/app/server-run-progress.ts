import { resolve } from "node:path";

import { createSqliteRepositories, defaultSqlitePath } from "@agent-major/db";
import { buildPhase18RuntimeMatchId, phase17CanonIds, phase18CanonIds, phase20PrePilotMapIds } from "@agent-major/materials";

import {
  createPhase18RunId,
  listPhase18RunHistoryEntries,
  phase18FixtureId,
  readPhase18RunFacts,
  recoverAbandonedPhase18Runs,
  resolvePhase18SelectedRun,
  shouldContinuePhase18Run,
  syncPhase18SimulationRun,
  type Phase18RunHistoryEntry
} from "./server-phase18-runs";
import { findProjectRoot } from "./server-project-root";
import {
  preparePhase18RuntimeFixtureFromWeb,
  resetPhase18CurrentMapFromWeb,
  resetPhase18RoundFromWeb,
  runPhase17ShowcaseFromWeb,
  runPhase18ScopeFromWeb,
  type WebResetResult,
  type WebRunSingleMapResult
} from "./server-runner";

type SimulationRunStatus = "scheduled" | "running" | "completed" | "failed" | "discarded";
type SimulationRunMode = "phase18_next_round" | "phase18_current_map" | "phase18_full_bo3";

interface SimulationRunRecord {
  id: string;
  fixtureId: string;
  status: SimulationRunStatus;
  requestedMode: SimulationRunMode;
  runtimeMatchId: string;
  runtimeMapGameId?: string;
  baselineCompletedRounds: number;
  estimatedTotalRounds: number;
  expectedTotalCalls: number;
  latestCommittedRoundNumber: number;
  hasFreshReplay: boolean;
  latestError?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export type WebRunStatus = "scheduled" | "running" | "completed" | "failed" | "discarded";
export type WebRunMode = "phase17_showcase_match" | "phase18_next_round" | "phase18_current_map" | "phase18_full_bo3";
export type WebRunLlmCallStatus = "started" | "completed" | "failed";
export type WebRunHistory = Phase18RunHistoryEntry;

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
  responseArtifactId?: string;
  rawTextPreview?: string;
  parseCandidatePreview?: string;
  repairRawTextPreview?: string;
  repaired?: boolean;
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
  fixtureId: string;
  runtimeMatchId: string;
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
  latestCommittedRoundNumber: number;
  casterLines: number;
  casterModes: Array<{ mode: string | null; count: number }>;
  llmSummary: WebRunLlmSummary;
  llmCalls: WebRunLlmCallProgress[];
  progressPercent: number;
  result?: WebRunSingleMapResult;
  error?: string;
  recentRuns: WebRunHistory[];
}

interface ActiveWebExecution {
  runId: string;
  fixtureId: string;
  mode: WebRunMode;
  promise: Promise<WebRunSingleMapResult>;
}

interface LegacyPhase17RunState extends WebRunProgress {
  promise: Promise<WebRunSingleMapResult>;
}

const estimatedMaxRoundsPerMap = 18;
const phase18CallsPerRound = 13;

let activeExecution: ActiveWebExecution | null = null;
let latestPhase17Run: LegacyPhase17RunState | null = null;

export function hasActiveWebRun(): boolean {
  return activeExecution !== null;
}

export function getActiveWebRunSnapshot(): Pick<ActiveWebExecution, "runId" | "fixtureId" | "mode"> | null {
  return activeExecution
    ? {
        runId: activeExecution.runId,
        fixtureId: activeExecution.fixtureId,
        mode: activeExecution.mode
      }
    : null;
}

export async function resetPhase18CurrentMapWebRun(fixtureId: string, runId?: string | null): Promise<WebResetResult> {
  return mutatePhase18Run(fixtureId, runId, async (run) => {
    if (activeExecution?.runId === run.id) {
      throw new Error("Current run is still generating. Use reset full BO3 to discard it, or wait for it to finish before resetting this map.");
    }

    const reset = await resetPhase18CurrentMapFromWeb(run.runtimeMatchId);
    return {
      reset,
      update: (facts: Awaited<ReturnType<typeof readPhase18RunFacts>>): SimulationRunRecord =>
        patchSimulationRunRecord(run, {
          status: "scheduled",
          runtimeMapGameId: facts.mapGameId,
          latestCommittedRoundNumber: facts.latestCommittedRoundNumber,
          hasFreshReplay: facts.hasFreshReplay,
          latestError: null,
          completedAt: null
        })
    };
  });
}

export async function resetPhase18RoundWebRun(fixtureId: string, runId?: string | null): Promise<WebResetResult> {
  return mutatePhase18Run(fixtureId, runId, async (run) => {
    if (activeExecution?.runId === run.id) {
      throw new Error("Current run is still generating. Use reset full BO3 to discard it, or wait for it to finish before resetting this round.");
    }

    const reset = await resetPhase18RoundFromWeb(run.runtimeMatchId);
    return {
      reset,
      update: (facts: Awaited<ReturnType<typeof readPhase18RunFacts>>): SimulationRunRecord =>
        patchSimulationRunRecord(run, {
          status: facts.completedRounds > 0 ? "completed" : "scheduled",
          runtimeMapGameId: facts.mapGameId,
          latestCommittedRoundNumber: facts.latestCommittedRoundNumber,
          hasFreshReplay: facts.hasFreshReplay,
          latestError: null,
          completedAt: null
        })
    };
  });
}

export async function resetPhase18FullBo3WebRun(fixtureId: string, runId?: string | null): Promise<WebResetResult> {
  return mutatePhase18Run(fixtureId, runId, async (run) => {
    if (activeExecution?.runId === run.id) {
      activeExecution = null;
    }

    return {
      reset: {
        scope: "match",
        matchId: run.runtimeMatchId,
        roundsBefore: run.latestCommittedRoundNumber,
        roundsAfter: run.latestCommittedRoundNumber,
        reportsBefore: run.latestCommittedRoundNumber,
        reportsAfter: run.latestCommittedRoundNumber
      },
      update: () =>
        patchSimulationRunRecord(run, {
          status: "discarded",
          completedAt: new Date().toISOString(),
          latestError: null
        })
    };
  });
}

export function startPhase17ShowcaseWebRun(matchId: string): WebRunProgress {
  if (matchId !== phase17CanonIds.matchId) {
    throw new Error(`Web runner only supports the Phase 1.7 showcase match: ${phase17CanonIds.matchId}`);
  }
  if (activeExecution) {
    throw new Error("A local match run is already in progress.");
  }

  const mapGameIds = phase17CanonIds.selectedMapIds.map((_, index) => `map_${phase17CanonIds.matchId}_${index + 1}`);
  const now = new Date().toISOString();
  const runId = `phase17_run_${Date.now().toString(36)}`;
  const promise = runPhase17ShowcaseFromWeb(matchId);
  const state: LegacyPhase17RunState = {
    runId,
    mode: "phase17_showcase_match",
    matchId,
    fixtureId: matchId,
    runtimeMatchId: matchId,
    targetMatchId: matchId,
    mapGameId: mapGameIds[0] ?? `map_${phase17CanonIds.matchId}_1`,
    mapGameIds,
    mapName: phase17CanonIds.selectedMapIds.join(" / "),
    status: "running",
    startedAt: now,
    updatedAt: now,
    estimatedTotalRounds: estimatedMaxRoundsPerMap * phase17CanonIds.selectedMapIds.length,
    baselineCompletedRounds: 0,
    completedRounds: 0,
    hasFreshReplay: false,
    currentRoundNumber: null,
    currentMapOrder: null,
    latestCommittedRoundNumber: 0,
    casterLines: 0,
    casterModes: [],
    llmSummary: summarizeLlmCalls(0, []),
    llmCalls: [],
    progressPercent: 0,
    recentRuns: [],
    promise
  };

  activeExecution = { runId, fixtureId: matchId, mode: "phase17_showcase_match", promise };
  latestPhase17Run = state;

  promise
    .then((result) => {
      if (!latestPhase17Run || latestPhase17Run.runId !== runId) {
        return;
      }
      latestPhase17Run = {
        ...latestPhase17Run,
        status: "completed",
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedRounds: latestPhase17Run.estimatedTotalRounds,
        hasFreshReplay: true,
        progressPercent: 100,
        result,
        mapGameId: result.mapGameId,
        mapGameIds: result.mapGameIds ?? [result.mapGameId],
        mapName: result.mapNames?.join(" / ") ?? result.mapName
      };
    })
    .catch((error: unknown) => {
      if (!latestPhase17Run || latestPhase17Run.runId !== runId) {
        return;
      }
      latestPhase17Run = {
        ...latestPhase17Run,
        status: "failed",
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        error: sanitizeRunError(error)
      };
    })
    .finally(() => {
      if (activeExecution?.runId === runId) {
        activeExecution = null;
      }
    });

  return stripLegacyPromise(state);
}

export async function startPhase18NextRoundWebRun(fixtureId: string, runId?: string | null): Promise<WebRunProgress> {
  return startPhase18WebRun({ fixtureId, runId, mode: "phase18_next_round" });
}

export async function startPhase18CurrentMapWebRun(fixtureId: string, runId?: string | null): Promise<WebRunProgress> {
  return startPhase18WebRun({ fixtureId, runId, mode: "phase18_current_map" });
}

export async function startPhase18FullBo3WebRun(fixtureId: string, runId?: string | null): Promise<WebRunProgress> {
  return startPhase18WebRun({ fixtureId, runId, mode: "phase18_full_bo3" });
}

export async function readWebRunProgress(runId?: string, fixtureId: string = phase18FixtureId): Promise<WebRunProgress | null> {
  if (runId && latestPhase17Run?.runId === runId) {
    return stripLegacyPromise(latestPhase17Run);
  }

  const projectRoot = findProjectRoot(process.cwd());
  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  try {
    await recoverAbandonedPhase18Runs(repositories, activeExecution?.runId);
    const selectedRun = await resolvePhase18SelectedRun(repositories, { runId, fixtureId });
    if (!selectedRun) {
      return null;
    }

    const { run, facts } = await syncPhase18SimulationRun(repositories, selectedRun);
    const llmCalls = readLlmCalls(repositories, run.runtimeMatchId);
    const llmSummary = summarizeLlmCalls(run.expectedTotalCalls, llmCalls);
    const casterModes = readCasterModes(repositories, facts.mapGameIds);
    const completedAt = run.completedAt ?? undefined;
    const progress = buildPhase18Progress({
      run,
      facts,
      llmCalls,
      llmSummary,
      casterModes,
      recentRuns: await listPhase18RunHistoryEntries(repositories, fixtureId)
    });

    return {
      ...progress,
      ...(completedAt ? { completedAt } : {})
    };
  } finally {
    repositories.close();
  }
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
  activeExecution = null;
  latestPhase17Run = null;
}

export async function readLatestWebRunProgressForMatch(matchId: string, runId?: string | null): Promise<WebRunProgress | null> {
  if (matchId === phase17CanonIds.matchId) {
    return latestPhase17Run ? stripLegacyPromise(latestPhase17Run) : null;
  }
  if (matchId !== phase18CanonIds.fixtureId && matchId !== phase18CanonIds.matchId) {
    return null;
  }

  return readWebRunProgress(runId ?? undefined, phase18FixtureId);
}

export async function readPhase18RunHistory(fixtureId: string = phase18FixtureId): Promise<WebRunHistory[]> {
  const projectRoot = findProjectRoot(process.cwd());
  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  try {
    await recoverAbandonedPhase18Runs(repositories, activeExecution?.runId);
    return await listPhase18RunHistoryEntries(repositories, fixtureId);
  } finally {
    repositories.close();
  }
}

export interface WebRunMapProgressSnapshot {
  completedRounds: number;
  currentRoundNumber: number | null;
  currentMapOrder: number | null;
  currentMapGameId: string | null;
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
  const currentMap = maps.find((mapGame) => mapGame.status !== "completed") ?? maps[maps.length - 1];

  return {
    completedRounds: typeof roundStats?.completedRounds === "number" ? roundStats.completedRounds : 0,
    currentRoundNumber: currentMap ? currentMap.currentRoundNumber || null : null,
    currentMapOrder: currentMap ? currentMap.mapOrder : null,
    currentMapGameId: currentMap?.id ?? null
  };
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

async function startPhase18WebRun(input: {
  fixtureId: string;
  runId: string | null | undefined;
  mode: Extract<WebRunMode, "phase18_next_round" | "phase18_current_map" | "phase18_full_bo3">;
}): Promise<WebRunProgress> {
  if (input.fixtureId !== phase18CanonIds.fixtureId && input.fixtureId !== phase18CanonIds.matchId) {
    throw new Error(`Web runner only supports the Phase 1.8 pilot fixture: ${phase18CanonIds.fixtureId}`);
  }
  if (activeExecution) {
    throw new Error("A local match run is already in progress.");
  }

  let startedRunId = input.runId ?? undefined;
  const projectRoot = findProjectRoot(process.cwd());
  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  try {
    await recoverAbandonedPhase18Runs(repositories);
    const existingRun = input.runId
      ? normalizeSimulationRunRecord(await repositories.simulationRuns.getById(input.runId))
      : await resolvePhase18SelectedRun(repositories, { runId: undefined, fixtureId: phase18FixtureId });
    const existingRunFacts = existingRun ? await readPhase18RunFacts(repositories, existingRun.runtimeMatchId) : null;
    const existingRunHasRemainingMap = existingRun ? hasRemainingPhase18Map(repositories, existingRun.runtimeMatchId) : false;
    const continuedRun =
      existingRun && shouldContinuePhase18Run(existingRun) && existingRunFacts?.runtimeMatchStatus !== "completed" && existingRunHasRemainingMap
        ? existingRun
        : null;
    const newRunId = createPhase18RunId();
    const runtimeMatchId = continuedRun?.runtimeMatchId ?? buildPhase18RuntimeMatchId(newRunId, phase18FixtureId);
    const runId = continuedRun?.id ?? newRunId;
    const now = new Date().toISOString();
    if (!continuedRun) {
      await preparePhase18RuntimeFixtureFromWeb({ runtimeMatchId });
    }
    const facts = await readPhase18RunFacts(repositories, runtimeMatchId);
    const remainingRounds = await estimatePhase18RemainingRounds(repositories, runtimeMatchId, input.mode);
    const persistedRun: SimulationRunRecord = patchSimulationRunRecord(
      continuedRun ?? {
        id: runId,
        fixtureId: phase18FixtureId,
        status: "scheduled",
        requestedMode: mapWebRunModeToSimulationRunMode(input.mode),
        runtimeMatchId,
        baselineCompletedRounds: 0,
        estimatedTotalRounds: 0,
        expectedTotalCalls: 0,
        latestCommittedRoundNumber: 0,
        hasFreshReplay: false,
        createdAt: now
      },
      {
        fixtureId: phase18FixtureId,
        status: "running",
        requestedMode: mapWebRunModeToSimulationRunMode(input.mode),
        runtimeMatchId,
        runtimeMapGameId: facts.mapGameId ?? continuedRun?.runtimeMapGameId ?? null,
        baselineCompletedRounds: facts.completedRounds,
        estimatedTotalRounds: facts.completedRounds + remainingRounds,
        expectedTotalCalls: remainingRounds * phase18CallsPerRound,
        latestCommittedRoundNumber: facts.latestCommittedRoundNumber,
        hasFreshReplay: facts.hasFreshReplay,
        latestError: null,
        createdAt: continuedRun?.createdAt ?? now,
        startedAt: now,
        completedAt: null
      }
    );
    await repositories.simulationRuns.save(persistedRun);
    startedRunId = persistedRun.id;

    const promise = runPhase18ScopeFromWeb({
      runtimeMatchId: persistedRun.runtimeMatchId,
      scope: mapWebRunModeToScope(input.mode)
    });
    activeExecution = {
      runId: persistedRun.id,
      fixtureId: phase18FixtureId,
      mode: input.mode,
      promise
    };

    void finalizePhase18RunPromise(persistedRun.id, promise);
  } finally {
    repositories.close();
  }

  const progress = await readWebRunProgress(startedRunId, phase18FixtureId);
  if (!progress) {
    throw new Error("Unable to read the newly started Phase 1.8 run.");
  }

  return progress;
}

async function finalizePhase18RunPromise(runId: string, promise: Promise<WebRunSingleMapResult>): Promise<void> {
  try {
    await promise;
    await finalizePhase18Run(runId);
  } catch (error) {
    await finalizePhase18Run(runId, sanitizeRunError(error));
  } finally {
    if (activeExecution?.runId === runId) {
      activeExecution = null;
    }
  }
}

async function finalizePhase18Run(runId: string, latestError?: string): Promise<void> {
  const projectRoot = findProjectRoot(process.cwd());
  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  try {
    await recoverAbandonedPhase18Runs(repositories, runId);
    const storedRun = normalizeSimulationRunRecord(await repositories.simulationRuns.getById(runId));
    if (!storedRun || storedRun.status === "discarded") {
      return;
    }

    const { run, facts } = await syncPhase18SimulationRun(repositories, storedRun);
    const status: SimulationRunStatus = latestError ? "failed" : "completed";
    await repositories.simulationRuns.save(
      patchSimulationRunRecord(run, {
        status,
        runtimeMapGameId: facts.mapGameId ?? run.runtimeMapGameId ?? null,
        latestCommittedRoundNumber: facts.latestCommittedRoundNumber,
        hasFreshReplay: facts.hasFreshReplay,
        latestError: latestError ?? null,
        completedAt: new Date().toISOString()
      })
    );
  } finally {
    repositories.close();
  }
}

async function mutatePhase18Run(
  fixtureId: string,
  runId: string | null | undefined,
  work: (
    run: SimulationRunRecord
  ) => Promise<{
    reset: WebResetResult;
    update: (facts: Awaited<ReturnType<typeof readPhase18RunFacts>>) => SimulationRunRecord;
  }>
): Promise<WebResetResult> {
  if (fixtureId !== phase18CanonIds.fixtureId && fixtureId !== phase18CanonIds.matchId) {
    throw new Error(`Reset actions are only supported for the Phase 1.8 pilot fixture: ${phase18CanonIds.fixtureId}.`);
  }

  const projectRoot = findProjectRoot(process.cwd());
  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  try {
    await recoverAbandonedPhase18Runs(repositories, activeExecution?.runId);
    const run = await resolvePhase18SelectedRun(repositories, { runId, fixtureId: phase18FixtureId });
    if (!run || run.status === "discarded") {
      throw new Error("No Phase 1.8 run is available for reset.");
    }

    const mutation = await work(run);
    const facts = await readPhase18RunFacts(repositories, run.runtimeMatchId);
    await repositories.simulationRuns.save(mutation.update(facts));
    return mutation.reset;
  } finally {
    repositories.close();
  }
}

async function estimatePhase18RemainingRounds(
  repositories: ReturnType<typeof createSqliteRepositories>,
  runtimeMatchId: string,
  mode: Extract<WebRunMode, "phase18_next_round" | "phase18_current_map" | "phase18_full_bo3">
): Promise<number> {
  if (mode === "phase18_next_round") {
    return 1;
  }

  const mapRows = repositories.sqlite
    .prepare(
      `SELECT map_order AS mapOrder, status, current_round_number AS currentRoundNumber
       FROM map_games
       WHERE match_id = ?
       ORDER BY map_order ASC`
    )
    .all(runtimeMatchId) as Array<{
      mapOrder?: unknown;
      status?: unknown;
      currentRoundNumber?: unknown;
    }>;
  const maps = mapRows.map((row) => ({
    mapOrder: typeof row.mapOrder === "number" ? row.mapOrder : 0,
    status: typeof row.status === "string" ? row.status : "scheduled",
    currentRoundNumber: typeof row.currentRoundNumber === "number" ? row.currentRoundNumber : 0
  }));
  const currentMap = maps.find((mapGame) => mapGame.status !== "completed") ?? maps.at(-1);
  const currentMapRemaining = currentMap ? Math.max(1, estimatedMaxRoundsPerMap - currentMap.currentRoundNumber) : estimatedMaxRoundsPerMap;

  if (mode === "phase18_current_map") {
    return currentMapRemaining;
  }

  const completedMaps = maps.filter((mapGame) => mapGame.status === "completed").length;
  return currentMapRemaining + Math.max(0, phase20PrePilotMapIds.length - completedMaps - 1) * estimatedMaxRoundsPerMap;
}

function hasRemainingPhase18Map(repositories: ReturnType<typeof createSqliteRepositories>, runtimeMatchId: string): boolean {
  const row = repositories.sqlite
    .prepare("SELECT COUNT(*) AS count FROM map_games WHERE match_id = ? AND status <> 'completed'")
    .get(runtimeMatchId) as { count?: unknown } | undefined;
  return typeof row?.count === "number" && row.count > 0;
}

function buildPhase18Progress(input: {
  run: SimulationRunRecord;
  facts: Awaited<ReturnType<typeof readPhase18RunFacts>>;
  llmCalls: WebRunLlmCallProgress[];
  llmSummary: WebRunLlmSummary;
  casterModes: Array<{ mode: string | null; count: number }>;
  recentRuns: WebRunHistory[];
}): WebRunProgress {
  const now = new Date().toISOString();
  const progressPercent =
    input.run.status === "completed"
      ? 100
      : input.run.estimatedTotalRounds > 0
        ? Math.min(input.run.status === "running" ? 99 : 100, Math.round((input.facts.completedRounds / input.run.estimatedTotalRounds) * 100))
        : 0;

  return {
    runId: input.run.id,
    mode: mapSimulationRunModeToWebRunMode(input.run.requestedMode),
    matchId: input.run.fixtureId,
    fixtureId: input.run.fixtureId,
    runtimeMatchId: input.run.runtimeMatchId,
    targetMatchId: input.run.runtimeMatchId,
    mapGameId: input.facts.mapGameId ?? input.run.runtimeMapGameId ?? "",
    mapGameIds: input.facts.mapGameIds,
    mapName: input.facts.mapName,
    status: input.run.status,
    startedAt: input.run.startedAt ?? input.run.createdAt,
    updatedAt: now,
    ...(input.run.completedAt ? { completedAt: input.run.completedAt } : {}),
    estimatedTotalRounds: input.run.estimatedTotalRounds,
    baselineCompletedRounds: input.run.baselineCompletedRounds,
    completedRounds: input.facts.completedRounds,
    hasFreshReplay: input.facts.hasFreshReplay,
    currentRoundNumber: input.facts.currentRoundNumber,
    currentMapOrder: input.facts.currentMapOrder,
    latestCommittedRoundNumber: input.facts.latestCommittedRoundNumber,
    casterLines: input.casterModes.reduce((sum, item) => sum + item.count, 0),
    casterModes: input.casterModes,
    llmSummary: input.llmSummary,
    llmCalls: input.llmCalls,
    progressPercent,
    ...(input.facts.runtimeMatchStatus
      ? {
          result: {
            matchId: input.run.runtimeMatchId,
            mapGameId: input.facts.mapGameId ?? "",
            mapGameIds: input.facts.mapGameIds,
            mapName: input.facts.mapName.split(" / ")[0] ?? input.facts.mapName,
            mapNames: input.facts.mapName.split(" / "),
            status: input.facts.runtimeMatchStatus,
            score: `${input.facts.teamAMapsWon}-${input.facts.teamBMapsWon}`,
            casterModes: input.casterModes
          }
        }
      : {}),
    ...(input.run.latestError ? { error: input.run.latestError } : {}),
    recentRuns: input.recentRuns
  };
}

function readCasterModes(
  repositories: ReturnType<typeof createSqliteRepositories>,
  mapGameIds: string[]
): Array<{ mode: string | null; count: number }> {
  if (mapGameIds.length === 0) {
    return [];
  }

  return repositories.sqlite
    .prepare(
      `SELECT json_extract(payload_json, '$.generationMode') AS mode, COUNT(*) AS count
       FROM events
       WHERE map_game_id IN (${placeholders(mapGameIds)})
         AND type = 'caster_line_created'
       GROUP BY mode`
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

function readLlmCalls(repositories: ReturnType<typeof createSqliteRepositories>, runtimeMatchId: string): WebRunLlmCallProgress[] {
  const rows = repositories.sqlite
    .prepare(
      `SELECT type, payload_json
       FROM events
       WHERE match_id = ?
         AND type IN ('llm_call_started', 'llm_call_completed', 'llm_call_failed')
       ORDER BY global_sequence ASC`
    )
    .all(runtimeMatchId) as Array<{ type?: unknown; payload_json?: unknown }>;

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
      ...(payload.error ? { error: payload.error } : current?.error ? { error: current.error } : {}),
      ...(payload.responseArtifactId
        ? { responseArtifactId: payload.responseArtifactId }
        : current?.responseArtifactId
          ? { responseArtifactId: current.responseArtifactId }
          : {}),
      ...(payload.rawTextPreview ? { rawTextPreview: payload.rawTextPreview } : current?.rawTextPreview ? { rawTextPreview: current.rawTextPreview } : {}),
      ...(payload.parseCandidatePreview
        ? { parseCandidatePreview: payload.parseCandidatePreview }
        : current?.parseCandidatePreview
          ? { parseCandidatePreview: current.parseCandidatePreview }
          : {}),
      ...(payload.repairRawTextPreview
        ? { repairRawTextPreview: payload.repairRawTextPreview }
        : current?.repairRawTextPreview
          ? { repairRawTextPreview: current.repairRawTextPreview }
          : {}),
      ...(typeof payload.repaired === "boolean" ? { repaired: payload.repaired } : current?.repaired ? { repaired: current.repaired } : {})
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
      ...(typeof parsed.error === "string" ? { error: parsed.error } : {}),
      ...(typeof parsed.responseArtifactId === "string" ? { responseArtifactId: parsed.responseArtifactId } : {}),
      ...(typeof parsed.rawTextPreview === "string" ? { rawTextPreview: parsed.rawTextPreview } : {}),
      ...(typeof parsed.parseCandidatePreview === "string" ? { parseCandidatePreview: parsed.parseCandidatePreview } : {}),
      ...(typeof parsed.repairRawTextPreview === "string" ? { repairRawTextPreview: parsed.repairRawTextPreview } : {}),
      ...(typeof parsed.repaired === "boolean" ? { repaired: parsed.repaired } : {})
    };
  } catch {
    return null;
  }
}

function placeholders(values: string[]): string {
  return values.map(() => "?").join(",");
}

function normalizeSimulationRunRecord(
  run: Awaited<ReturnType<ReturnType<typeof createSqliteRepositories>["simulationRuns"]["getById"]>>
): SimulationRunRecord | null {
  if (!run) {
    return null;
  }

  return {
    id: run.id,
    fixtureId: run.fixtureId,
    status: run.status,
    requestedMode: run.requestedMode,
    runtimeMatchId: run.runtimeMatchId,
    ...(run.runtimeMapGameId ? { runtimeMapGameId: run.runtimeMapGameId } : {}),
    baselineCompletedRounds: run.baselineCompletedRounds,
    estimatedTotalRounds: run.estimatedTotalRounds,
    expectedTotalCalls: run.expectedTotalCalls,
    latestCommittedRoundNumber: run.latestCommittedRoundNumber,
    hasFreshReplay: run.hasFreshReplay,
    ...(run.latestError ? { latestError: run.latestError } : {}),
    createdAt: run.createdAt,
    ...(run.startedAt ? { startedAt: run.startedAt } : {}),
    ...(run.completedAt ? { completedAt: run.completedAt } : {})
  };
}

function patchSimulationRunRecord(
  run: SimulationRunRecord,
  patch: {
    fixtureId?: string;
    status?: SimulationRunStatus;
    requestedMode?: SimulationRunMode;
    runtimeMatchId?: string;
    runtimeMapGameId?: string | null;
    baselineCompletedRounds?: number;
    estimatedTotalRounds?: number;
    expectedTotalCalls?: number;
    latestCommittedRoundNumber?: number;
    hasFreshReplay?: boolean;
    latestError?: string | null;
    createdAt?: string;
    startedAt?: string | null;
    completedAt?: string | null;
  }
): SimulationRunRecord {
  return {
    id: run.id,
    fixtureId: patch.fixtureId ?? run.fixtureId,
    status: patch.status ?? run.status,
    requestedMode: patch.requestedMode ?? run.requestedMode,
    runtimeMatchId: patch.runtimeMatchId ?? run.runtimeMatchId,
    ...(patch.runtimeMapGameId !== null
      ? patch.runtimeMapGameId
        ? { runtimeMapGameId: patch.runtimeMapGameId }
        : run.runtimeMapGameId
          ? { runtimeMapGameId: run.runtimeMapGameId }
          : {}
      : {}),
    baselineCompletedRounds: patch.baselineCompletedRounds ?? run.baselineCompletedRounds,
    estimatedTotalRounds: patch.estimatedTotalRounds ?? run.estimatedTotalRounds,
    expectedTotalCalls: patch.expectedTotalCalls ?? run.expectedTotalCalls,
    latestCommittedRoundNumber: patch.latestCommittedRoundNumber ?? run.latestCommittedRoundNumber,
    hasFreshReplay: patch.hasFreshReplay ?? run.hasFreshReplay,
    ...(patch.latestError !== null
      ? patch.latestError
        ? { latestError: patch.latestError }
        : run.latestError
          ? { latestError: run.latestError }
          : {}
      : {}),
    createdAt: patch.createdAt ?? run.createdAt,
    ...(patch.startedAt !== null
      ? patch.startedAt
        ? { startedAt: patch.startedAt }
        : run.startedAt
          ? { startedAt: run.startedAt }
          : {}
      : {}),
    ...(patch.completedAt !== null
      ? patch.completedAt
        ? { completedAt: patch.completedAt }
        : run.completedAt
          ? { completedAt: run.completedAt }
          : {}
      : {})
  };
}

function stripLegacyPromise(state: LegacyPhase17RunState): WebRunProgress {
  const { promise: _promise, ...progress } = state;
  return progress;
}

function mapWebRunModeToScope(mode: Extract<WebRunMode, "phase18_next_round" | "phase18_current_map" | "phase18_full_bo3">): "round" | "map" | "match" {
  switch (mode) {
    case "phase18_next_round":
      return "round";
    case "phase18_current_map":
      return "map";
    case "phase18_full_bo3":
    default:
      return "match";
  }
}

function mapWebRunModeToSimulationRunMode(mode: Extract<WebRunMode, "phase18_next_round" | "phase18_current_map" | "phase18_full_bo3">): SimulationRunMode {
  return mode;
}

function mapSimulationRunModeToWebRunMode(mode: SimulationRunMode): Extract<WebRunMode, "phase18_next_round" | "phase18_current_map" | "phase18_full_bo3"> {
  return mode;
}
