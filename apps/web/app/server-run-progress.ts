import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PHASE20_PRE_PROMPT_CONTRACT_ID, commitDust2NodeRoundExperimental, runDust2NodeMapExperimental } from "@agent-major/core";
import { createSqliteRepositories, defaultSqlitePath } from "@agent-major/db";
import { buildPhase18RuntimeMatchId, phase17CanonIds, phase18CanonIds, phase20PrePilotMapIds } from "@agent-major/materials";

import {
  createPhase18RunId,
  listPhase18RunHistoryEntries,
  phase18FixtureId,
  readPhase18RunFacts,
  recoverAbandonedPhase18Runs,
  isPhase18RunContractBlocked,
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
  runPhase18KeepGeneratingMapFromWeb,
  runPhase18ScopeFromWeb,
  selectCurrentPhase18MapGameId,
  toWebRunResultFromMatch,
  type WebResetResult,
  type WebRunSingleMapResult
} from "./server-runner";
import {
  appendNodeShadowSidecarAuditIfEnabled,
  type NodeShadowSidecarAuditPayload,
  type NodeShadowSidecarProviderMode,
  type NodeShadowSidecarStatus
} from "./server-node-shadow-audit";
import { loadRootLocalEnv } from "./server-local-env";
import { ServerLocalArtifactStore } from "./server-artifact-store";

type SimulationRunStatus = "scheduled" | "running" | "completed" | "failed" | "discarded";
type SimulationRunMode =
  | "phase18_next_round"
  | "phase18_current_map"
  | "phase18_keep_generating_map"
  | "phase18_full_bo3"
  | "phase20_node_round_experimental"
  | "phase20_node_map_experimental"
  | "phase20_hex_round_experimental"
  | "phase20_hex_map_experimental";

interface SimulationRunRecord {
  id: string;
  fixtureId: string;
  status: SimulationRunStatus;
  requestedMode: SimulationRunMode;
  promptContractId?: string;
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
export type WebRunMode =
  | "phase17_showcase_match"
  | "phase18_next_round"
  | "phase18_current_map"
  | "phase18_keep_generating_map"
  | "phase18_full_bo3"
  | "phase20_node_round_experimental"
  | "phase20_node_map_experimental"
  | "phase20_hex_round_experimental"
  | "phase20_hex_map_experimental";
export type WebRunLlmCallStatus = "started" | "completed" | "failed";
export type WebRunHistory = Phase18RunHistoryEntry;

export interface WebRunLlmCallProgress {
  callId: string;
  taskType: string;
  roundNumber: number;
  agentId?: string;
  driverModelId: string;
  promptContractId?: string;
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

export interface WebRunNodeShadowPhaseProgress {
  phaseId: string;
  activeNodeCount: number;
  actionCount: number;
  localVerdictCount: number;
  contestedNodeIds: string[];
  attackControlledNodeIds: string[];
  defenseControlledNodeIds: string[];
  neutralNodeIds: string[];
  actionTypeCounts: Record<string, number>;
  businessIntentSummary: string[];
  winCondition?: {
    isRoundOver: boolean;
    winnerSide?: "attack" | "defense";
    roundWinType?: string;
    reason: string;
  };
}

export interface WebRunNodeShadowProgress {
  status: NodeShadowSidecarStatus;
  source: "node_round_engine_shadow" | "node_round_engine_committed";
  reportStatus?: "complete" | "incomplete";
  runId: string;
  executionId: string;
  createdAt: string;
  reportId?: string;
  roundNumber?: number;
  providerMode: NodeShadowSidecarProviderMode;
  llmShadowEnabled: boolean;
  writesDb: boolean;
  replacesLegacyRoundPath: false;
  phaseCount: number;
  llmCallsAttempted: number;
  llmFallbackCount: number;
  fallbackReasons: string[];
  ignoredLlmFields: string[];
  draftValidCount: number;
  draftRejectedCount: number;
  contentLength: number;
  reasoningContentLength: number;
  jsonTruncated: boolean;
  reasoningExhausted: boolean;
  totalAgentActions: number;
  totalLocalVerdicts: number;
  totalApSpent: number;
  finalWinCondition?: {
    isRoundOver: boolean;
    winnerSide?: "attack" | "defense";
    winnerTeamId?: string;
    roundWinType?: string;
    reason: string;
  };
  phaseSummaries: WebRunNodeShadowPhaseProgress[];
  error?: string;
  errorKind?: string;
}

export interface WebRunNodeMapExperimentalRoundProgress {
  roundId: string;
  roundNumber: number;
  winnerTeamId?: string;
  loserTeamId?: string;
  roundWinType?: string;
  nodeTraceArtifactId: string;
  totalApSpent: number;
  fallbackCount: number;
  ignoredFields: string[];
  finalHardCondition?: {
    isRoundOver: boolean;
    winnerSide?: "attack" | "defense";
    winnerTeamId?: string;
    roundWinType?: string;
    reason: string;
  };
}

export interface WebRunNodeMapExperimentalProgress {
  status: "created";
  source: "node_round_engine_map_experimental";
  mode: "phase20_node_map_experimental";
  writesDb: true;
  replacesLegacyRoundPath: false;
  summaryArtifactId: string;
  mapGameId: string;
  mapName: string;
  roundsCommitted: number;
  finalScore: { teamA: number; teamB: number };
  completionReason: string;
  roundTraceArtifactIds: string[];
  totalFallbackCount: number;
  fallbackReasons: string[];
  ignoredFields: string[];
  roundSummaries: WebRunNodeMapExperimentalRoundProgress[];
}

export interface WebRunProgress {
  runId: string;
  mode: WebRunMode;
  currentExecutionMode?: WebRunMode;
  currentExecutionStatus?: "running" | "completed" | "failed";
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
  currentExecutionId?: string;
  currentOuterAttemptNumber?: number;
  latestRetryReason?: string;
  recoveredFailureCount: number;
  latestRecoveredError?: string;
  currentExecutionStartedCalls: number;
  currentExecutionCompletedCalls: number;
  currentExecutionFailedCalls: number;
  currentExecutionRunningCalls: number;
  promptContractId?: string;
  contractStatus?: "current" | "legacy" | "mixed" | "blocked";
  progressPercent: number;
  nodeShadow?: WebRunNodeShadowProgress;
  nodeMapExperimental?: WebRunNodeMapExperimentalProgress;
  result?: WebRunSingleMapResult;
  error?: string;
  recentRuns: WebRunHistory[];
}

interface ActiveWebExecution {
  runId: string;
  fixtureId: string;
  mode: WebRunMode;
  executionId: string;
  promise: Promise<WebRunSingleMapResult>;
}

type RepositoryEvent = Parameters<ReturnType<typeof createSqliteRepositories>["events"]["append"]>[0];

interface LegacyPhase17RunState extends WebRunProgress {
  promise: Promise<WebRunSingleMapResult>;
}

const estimatedMaxRoundsPerMap = 18;
const phase18CallsPerRound = 14;

let activeExecution: ActiveWebExecution | null = null;
let latestPhase17Run: LegacyPhase17RunState | null = null;

function createWebExecutionId(now = Date.now()): string {
  return `exec_${now.toString(36)}`;
}

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
    const discardedActiveRun = activeExecution?.runId === run.id;
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
          latestError: discardedActiveRun ? "Run was discarded by full BO3 reset while execution was active." : "Run was discarded by full BO3 reset."
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
  const executionId = createWebExecutionId();
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
    currentExecutionId: executionId,
    recoveredFailureCount: 0,
    currentExecutionStartedCalls: 0,
    currentExecutionCompletedCalls: 0,
    currentExecutionFailedCalls: 0,
    currentExecutionRunningCalls: 0,
    progressPercent: 0,
    recentRuns: [],
    promise
  };

  activeExecution = { runId, fixtureId: matchId, mode: "phase17_showcase_match", executionId, promise };
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

export type WebRunRetryMode = "full_round" | "resume_from_stage";

export async function startPhase18NextRoundWebRun(
  fixtureId: string,
  runId?: string | null,
  retryMode: WebRunRetryMode = "full_round"
): Promise<WebRunProgress> {
  return startPhase18WebRun({ fixtureId, runId, mode: "phase18_next_round", retryMode });
}

export async function startPhase18CurrentMapWebRun(fixtureId: string, runId?: string | null): Promise<WebRunProgress> {
  return startPhase18WebRun({ fixtureId, runId, mode: "phase18_current_map" });
}

export async function startPhase18KeepGeneratingMapWebRun(fixtureId: string, runId?: string | null): Promise<WebRunProgress> {
  return startPhase18WebRun({ fixtureId, runId, mode: "phase18_keep_generating_map" });
}

export async function startPhase18FullBo3WebRun(fixtureId: string, runId?: string | null): Promise<WebRunProgress> {
  return startPhase18WebRun({ fixtureId, runId, mode: "phase18_full_bo3" });
}

export async function startPhase20NodeRoundExperimentalWebRun(fixtureId: string, runId?: string | null): Promise<WebRunProgress> {
  return startPhase18WebRun({ fixtureId, runId, mode: "phase20_node_round_experimental" });
}

export async function startPhase20NodeMapExperimentalWebRun(fixtureId: string, runId?: string | null): Promise<WebRunProgress> {
  return startPhase18WebRun({ fixtureId, runId, mode: "phase20_node_map_experimental" });
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
    const attemptEvents = readRoundGenerationAttemptEvents(repositories, run.id, facts.mapGameIds);
    const executionEvents = readWebRunExecutionEvents(repositories, run.id, run.runtimeMatchId);
      const nodeShadow =
        readNodeShadowSidecarProgress(repositories, run.id, run.runtimeMatchId) ??
        readCommittedNodeTraceProgress(repositories, run.id, run.runtimeMatchId);
    const nodeMapExperimental = readNodeMapExperimentalProgress(repositories, run.runtimeMatchId);
    const casterModes = readCasterModes(repositories, facts.mapGameIds);
    const completedAt = run.completedAt ?? undefined;
    const progress = buildPhase18Progress({
      run,
      facts,
      llmCalls,
      llmSummary,
      attemptEvents,
      executionEvents,
      nodeShadow,
      nodeMapExperimental,
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

interface RoundGenerationAttemptEvent {
  type:
    | "round_generation_attempt_started"
    | "round_generation_attempt_finished"
    | "round_generation_attempt_retrying"
    | "round_generation_attempt_terminal_failed";
  runId: string;
  executionId: string;
  roundNumber: number;
  outerAttemptNumber: number;
  result: string;
  errorKind?: string;
  error?: string;
  createdAt: string;
}

interface WebRunExecutionEvent {
  type: "web_run_execution_started" | "web_run_execution_finished";
  runId: string;
  executionId: string;
  mode: WebRunMode;
  status: "running" | "completed" | "failed";
  baselineCompletedRounds: number;
  estimatedTotalRounds: number;
  expectedTotalCalls: number;
  latestError?: string;
  createdAt: string;
}

interface NodeShadowSidecarEventRow {
  type?: unknown;
  payloadJson?: unknown;
  createdAt?: unknown;
}

function readRoundGenerationAttemptEvents(
  repositories: ReturnType<typeof createSqliteRepositories>,
  runId: string,
  mapGameIds: string[]
): RoundGenerationAttemptEvent[] {
  if (mapGameIds.length === 0) {
    return [];
  }
  const rows = repositories.sqlite
    .prepare(
      `SELECT type, payload_json AS payloadJson, created_at AS createdAt
       FROM events
       WHERE map_game_id IN (${placeholders(mapGameIds)})
         AND type IN (
           'round_generation_attempt_started',
           'round_generation_attempt_finished',
           'round_generation_attempt_retrying',
           'round_generation_attempt_terminal_failed'
         )
       ORDER BY global_sequence ASC`
    )
    .all(...mapGameIds) as Array<{ type?: unknown; payloadJson?: unknown; createdAt?: unknown }>;

  return rows
    .map((row) => {
      const payload = parseUnknownRecord(row.payloadJson);
      if (!payload || payload.runId !== runId || typeof payload.executionId !== "string") {
        return null;
      }
      if (
        row.type !== "round_generation_attempt_started" &&
        row.type !== "round_generation_attempt_finished" &&
        row.type !== "round_generation_attempt_retrying" &&
        row.type !== "round_generation_attempt_terminal_failed"
      ) {
        return null;
      }
      return {
        type: row.type,
        runId,
        executionId: payload.executionId,
        roundNumber: typeof payload.roundNumber === "number" ? payload.roundNumber : 0,
        outerAttemptNumber: typeof payload.outerAttemptNumber === "number" ? payload.outerAttemptNumber : 0,
        result: typeof payload.result === "string" ? payload.result : "",
        ...(typeof payload.errorKind === "string" ? { errorKind: payload.errorKind } : {}),
        ...(typeof payload.error === "string" ? { error: payload.error } : {}),
        createdAt: typeof row.createdAt === "string" ? row.createdAt : ""
      };
    })
    .filter((event): event is RoundGenerationAttemptEvent => event !== null);
}

function readWebRunExecutionEvents(
  repositories: ReturnType<typeof createSqliteRepositories>,
  runId: string,
  runtimeMatchId: string
): WebRunExecutionEvent[] {
  const rows = repositories.sqlite
    .prepare(
      `SELECT type, payload_json AS payloadJson, created_at AS createdAt
       FROM events
       WHERE match_id = ?
         AND type IN ('web_run_execution_started', 'web_run_execution_finished')
       ORDER BY global_sequence ASC`
    )
    .all(runtimeMatchId) as Array<{ type?: unknown; payloadJson?: unknown; createdAt?: unknown }>;

  const events: WebRunExecutionEvent[] = [];
  for (const row of rows) {
    const payload = parseUnknownRecord(row.payloadJson);
    if (!payload || payload.runId !== runId || typeof payload.executionId !== "string") {
      continue;
    }
    if (row.type !== "web_run_execution_started" && row.type !== "web_run_execution_finished") {
      continue;
    }
    const mode = typeof payload.mode === "string" ? mapSimulationRunModeToWebRunMode(payload.mode as SimulationRunMode) : null;
    if (!mode) {
      continue;
    }
    const eventType: WebRunExecutionEvent["type"] = row.type;
    const status: WebRunExecutionEvent["status"] =
      eventType === "web_run_execution_started" ? "running" : typeof payload.status === "string" && payload.status === "failed" ? "failed" : "completed";
    events.push({
      type: eventType,
      runId,
      executionId: payload.executionId,
      mode,
      status,
      baselineCompletedRounds: typeof payload.baselineCompletedRounds === "number" ? payload.baselineCompletedRounds : 0,
      estimatedTotalRounds: typeof payload.estimatedTotalRounds === "number" ? payload.estimatedTotalRounds : 0,
      expectedTotalCalls: typeof payload.expectedTotalCalls === "number" ? payload.expectedTotalCalls : 0,
      ...(typeof payload.latestError === "string" ? { latestError: payload.latestError } : {}),
      createdAt: typeof row.createdAt === "string" ? row.createdAt : ""
    });
  }
  return events;
}

function readLatestExecutionId(events: RoundGenerationAttemptEvent[]): string | undefined {
  return events.at(-1)?.executionId;
}

export function readNodeShadowSidecarProgress(
  repositories: ReturnType<typeof createSqliteRepositories>,
  runId: string,
  runtimeMatchId: string
): WebRunNodeShadowProgress | null {
  const rows = repositories.sqlite
    .prepare(
      `SELECT type, payload_json AS payloadJson, created_at AS createdAt
       FROM events
       WHERE match_id = ?
         AND type IN ('node_round_shadow_report_created', 'node_round_shadow_report_failed')
       ORDER BY global_sequence ASC`
    )
    .all(runtimeMatchId) as NodeShadowSidecarEventRow[];

  const summaries = rows
    .map((row) => summarizeNodeShadowSidecarPayload(row.payloadJson, typeof row.createdAt === "string" ? row.createdAt : ""))
    .filter((summary): summary is WebRunNodeShadowProgress => Boolean(summary && summary.runId === runId));
  return summaries.at(-1) ?? null;
}

export function readCommittedNodeTraceProgress(
  repositories: ReturnType<typeof createSqliteRepositories>,
  runId: string,
  runtimeMatchId: string
): WebRunNodeShadowProgress | null {
  const row = repositories.sqlite
    .prepare(
      `SELECT rr.id AS reportId,
              rr.round_number AS roundNumber,
              rr.node_trace_artifact_id AS nodeTraceArtifactId,
              a.uri AS artifactUri,
              rr.created_at AS createdAt
       FROM round_reports rr
       LEFT JOIN artifacts a ON a.id = rr.node_trace_artifact_id
       WHERE rr.match_id = ?
         AND rr.node_trace_source = 'node_round_engine_committed'
       ORDER BY rr.round_number DESC, rr.created_at DESC
       LIMIT 1`
    )
    .get(runtimeMatchId) as
    | {
        reportId?: unknown;
        roundNumber?: unknown;
        nodeTraceArtifactId?: unknown;
        artifactUri?: unknown;
        createdAt?: unknown;
      }
    | undefined;
  if (!row || typeof row.artifactUri !== "string") {
    return null;
  }
  const parsed = parseUnknownRecord(readArtifactTextByUri(row.artifactUri));
  const report = parseUnknownRecord(parsed?.committedReport);
  const audit = parseUnknownRecord(report?.audit);
  if (!report || report.source !== "node_round_engine_committed") {
    return null;
  }

  return {
    status: "created",
    source: "node_round_engine_committed",
    ...(typeof report.status === "string" ? { reportStatus: report.status as "complete" | "incomplete" } : {}),
    runId,
    executionId: "committed_node_trace",
    createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
    ...(typeof row.reportId === "string" ? { reportId: row.reportId } : {}),
    ...(typeof row.roundNumber === "number" ? { roundNumber: row.roundNumber } : {}),
    providerMode: readProviderMode(audit?.providerMode),
    llmShadowEnabled: audit?.llmShadowEnabled === true,
    writesDb: true,
    replacesLegacyRoundPath: false,
    phaseCount: typeof report.phaseCount === "number" ? report.phaseCount : 0,
    llmCallsAttempted: readNumber(audit?.llmCallsAttempted),
    llmFallbackCount: readNumber(audit?.llmFallbackCount),
    fallbackReasons: readStringArray(audit?.fallbackReasons),
    ignoredLlmFields: readStringArray(audit?.ignoredLlmFields),
    draftValidCount: readNumber(audit?.draftValidCount),
    draftRejectedCount: readNumber(audit?.draftRejectedCount),
    contentLength: readNumber(audit?.contentLength),
    reasoningContentLength: readNumber(audit?.reasoningContentLength),
    jsonTruncated: audit?.jsonTruncated === true,
    reasoningExhausted: audit?.reasoningExhausted === true,
    totalAgentActions: readNumber(audit?.totalAgentActions),
    totalLocalVerdicts: readNumber(audit?.totalLocalVerdicts),
    totalApSpent: readNumber(audit?.totalApSpent),
    ...summarizeCommittedFinalWinCondition(report.finalWinCondition),
    phaseSummaries: readCommittedPhaseSummaries(report.phaseSummaries)
  };
}

export function readNodeMapExperimentalProgress(
  repositories: ReturnType<typeof createSqliteRepositories>,
  runtimeMatchId: string
): WebRunNodeMapExperimentalProgress | null {
  const row = repositories.sqlite
    .prepare(
      `SELECT a.id AS artifactId,
              a.uri AS artifactUri
       FROM artifacts a
       WHERE a.match_id = ?
         AND a.artifact_type = 'node_map_experimental_summary'
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 1`
    )
    .get(runtimeMatchId) as { artifactId?: unknown; artifactUri?: unknown } | undefined;
  if (!row || typeof row.artifactId !== "string" || typeof row.artifactUri !== "string") {
    return null;
  }
  const summary = parseUnknownRecord(readArtifactTextByUri(row.artifactUri));
  if (!summary || summary.source !== "node_round_engine_map_experimental") {
    return null;
  }
  const fallbackSummary = parseUnknownRecord(summary.fallbackSummary);
  return {
    status: "created",
    source: "node_round_engine_map_experimental",
    mode: "phase20_node_map_experimental",
    writesDb: true,
    replacesLegacyRoundPath: false,
    summaryArtifactId: row.artifactId,
    mapGameId: typeof summary.mapGameId === "string" ? summary.mapGameId : "",
    mapName: typeof summary.mapName === "string" ? summary.mapName : "Dust2",
    roundsCommitted: readNumber(summary.roundsCommitted),
    finalScore: readScorePair(summary.finalScore),
    completionReason: typeof summary.completionReason === "string" ? summary.completionReason : "map_completed",
    roundTraceArtifactIds: readStringArray(summary.roundTraceArtifactIds),
    totalFallbackCount: readNumber(fallbackSummary?.totalFallbackCount),
    fallbackReasons: readStringArray(fallbackSummary?.reasons),
    ignoredFields: readStringArray(fallbackSummary?.ignoredFields),
    roundSummaries: readNodeMapRoundSummaries(summary.roundSummaries)
  };
}

export function summarizeNodeShadowSidecarPayload(value: unknown, createdAt: string): WebRunNodeShadowProgress | null {
  const payload = parseUnknownRecord(value) as NodeShadowSidecarAuditPayload | null;
  if (!payload || payload.schemaVersion !== 1 || (payload.status !== "created" && payload.status !== "failed")) {
    return null;
  }

  const report = payload.report;
  const audit = report?.audit;
  return {
    status: payload.status,
    source: "node_round_engine_shadow",
    ...(report?.status ? { reportStatus: report.status } : {}),
    runId: payload.runId,
    executionId: payload.executionId,
    createdAt,
    ...(report?.id ? { reportId: report.id } : {}),
    ...(typeof report?.roundNumber === "number" ? { roundNumber: report.roundNumber } : {}),
    providerMode: audit?.providerMode ?? payload.providerMode,
    llmShadowEnabled: audit?.llmShadowEnabled ?? payload.llmShadowEnabled,
    writesDb: false,
    replacesLegacyRoundPath: false,
    phaseCount: report?.phaseCount ?? 0,
    llmCallsAttempted: audit?.llmCallsAttempted ?? 0,
    llmFallbackCount: audit?.llmFallbackCount ?? 0,
    fallbackReasons: audit?.fallbackReasons ?? [],
    ignoredLlmFields: audit?.ignoredLlmFields ?? [],
    draftValidCount: audit?.draftValidCount ?? 0,
    draftRejectedCount: audit?.draftRejectedCount ?? 0,
    contentLength: audit?.contentLength ?? 0,
    reasoningContentLength: audit?.reasoningContentLength ?? 0,
    jsonTruncated: audit?.jsonTruncated ?? false,
    reasoningExhausted: audit?.reasoningExhausted ?? false,
    totalAgentActions: audit?.totalAgentActions ?? 0,
    totalLocalVerdicts: audit?.totalLocalVerdicts ?? 0,
    totalApSpent: audit?.totalApSpent ?? 0,
    ...(report?.finalWinCondition
      ? {
          finalWinCondition: {
            isRoundOver: report.finalWinCondition.isRoundOver,
            ...(report.finalWinCondition.winnerSide ? { winnerSide: report.finalWinCondition.winnerSide } : {}),
            ...(report.finalWinCondition.winnerTeamId ? { winnerTeamId: report.finalWinCondition.winnerTeamId } : {}),
            ...(report.finalWinCondition.roundWinType ? { roundWinType: report.finalWinCondition.roundWinType } : {}),
            reason: report.finalWinCondition.reason
          }
        }
      : {}),
    phaseSummaries: (report?.phaseSummaries ?? []).map((phase) => ({
      phaseId: phase.phaseId,
      activeNodeCount: phase.activeNodeCount,
      actionCount: phase.actionCount,
      localVerdictCount: phase.localVerdictCount,
      contestedNodeIds: phase.contestedNodeIds,
      attackControlledNodeIds: phase.attackControlledNodeIds,
      defenseControlledNodeIds: phase.defenseControlledNodeIds,
      neutralNodeIds: phase.neutralNodeIds,
      actionTypeCounts: phase.actionTypeCounts,
      businessIntentSummary: phase.businessIntentSummary,
      winCondition: {
        isRoundOver: phase.winCondition.isRoundOver,
        ...(phase.winCondition.winnerSide ? { winnerSide: phase.winCondition.winnerSide } : {}),
        ...(phase.winCondition.roundWinType ? { roundWinType: phase.winCondition.roundWinType } : {}),
        reason: phase.winCondition.reason
      }
    })),
    ...(payload.error ? { error: payload.error } : {}),
    ...(payload.errorKind ? { errorKind: payload.errorKind } : {})
    };
  }

function summarizeCommittedFinalWinCondition(value: unknown): Pick<WebRunNodeShadowProgress, "finalWinCondition"> {
  const record = parseUnknownRecord(value);
  if (!record) {
    return {};
  }
  return {
    finalWinCondition: {
      isRoundOver: record.isRoundOver === true,
      ...(record.winnerSide === "attack" || record.winnerSide === "defense" ? { winnerSide: record.winnerSide } : {}),
      ...(typeof record.winnerTeamId === "string" ? { winnerTeamId: record.winnerTeamId } : {}),
      ...(typeof record.roundWinType === "string" ? { roundWinType: record.roundWinType } : {}),
      reason: typeof record.reason === "string" ? record.reason : "节点化 committed trace hard win condition."
    }
  };
}

function readNodeMapRoundSummaries(value: unknown): WebRunNodeMapExperimentalRoundProgress[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => parseUnknownRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item): WebRunNodeMapExperimentalRoundProgress => {
      const final = parseUnknownRecord(item.finalHardCondition);
      const winnerSide = final?.winnerSide === "attack" || final?.winnerSide === "defense" ? final.winnerSide : undefined;
      return {
        roundId: typeof item.roundId === "string" ? item.roundId : "",
        roundNumber: readNumber(item.roundNumber),
        ...(typeof item.winnerTeamId === "string" ? { winnerTeamId: item.winnerTeamId } : {}),
        ...(typeof item.loserTeamId === "string" ? { loserTeamId: item.loserTeamId } : {}),
        ...(typeof item.roundWinType === "string" ? { roundWinType: item.roundWinType } : {}),
        nodeTraceArtifactId: typeof item.nodeTraceArtifactId === "string" ? item.nodeTraceArtifactId : "",
        totalApSpent: readNumber(item.totalApSpent),
        fallbackCount: readNumber(item.fallbackCount),
        ignoredFields: readStringArray(item.ignoredFields),
        ...(final
          ? {
              finalHardCondition: {
                isRoundOver: final.isRoundOver === true,
                ...(winnerSide ? { winnerSide } : {}),
                ...(typeof final.winnerTeamId === "string" ? { winnerTeamId: final.winnerTeamId } : {}),
                ...(typeof final.roundWinType === "string" ? { roundWinType: final.roundWinType } : {}),
                reason: typeof final.reason === "string" ? final.reason : "节点化地图灰度 hard win condition."
              }
            }
          : {})
      };
    })
    .filter((item) => item.roundId.length > 0 && item.nodeTraceArtifactId.length > 0);
}

function readScorePair(value: unknown): { teamA: number; teamB: number } {
  const record = parseUnknownRecord(value);
  return {
    teamA: readNumber(record?.teamA),
    teamB: readNumber(record?.teamB)
  };
}

function readArtifactTextByUri(uri: string): string {
  if (uri.startsWith("local:")) {
    return readFileSync(resolve(findProjectRoot(process.cwd()), uri.slice("local:".length)), "utf8");
  }
  return readFileSync(uri, "utf8");
}

function readCommittedPhaseSummaries(value: unknown): WebRunNodeShadowPhaseProgress[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const phase = parseUnknownRecord(item) ?? {};
    const winCondition = parseUnknownRecord(phase.winCondition);
    return {
      phaseId: typeof phase.phaseId === "string" ? phase.phaseId : "unknown",
      activeNodeCount: readNumber(phase.activeNodeCount),
      actionCount: readNumber(phase.actionCount),
      localVerdictCount: readNumber(phase.localVerdictCount),
      contestedNodeIds: readStringArray(phase.contestedNodeIds),
      attackControlledNodeIds: readStringArray(phase.attackControlledNodeIds),
      defenseControlledNodeIds: readStringArray(phase.defenseControlledNodeIds),
      neutralNodeIds: readStringArray(phase.neutralNodeIds),
      actionTypeCounts: readStringNumberRecord(phase.actionTypeCounts),
      businessIntentSummary: readStringArray(phase.businessIntentSummary),
      ...(winCondition
        ? {
            winCondition: {
              isRoundOver: winCondition.isRoundOver === true,
              ...(winCondition.winnerSide === "attack" || winCondition.winnerSide === "defense" ? { winnerSide: winCondition.winnerSide } : {}),
              ...(typeof winCondition.roundWinType === "string" ? { roundWinType: winCondition.roundWinType } : {}),
              reason: typeof winCondition.reason === "string" ? winCondition.reason : "节点化 phase win condition."
            }
          }
        : {})
    };
  });
}

function readProviderMode(value: unknown): NodeShadowSidecarProviderMode {
  return value === "real" ? "real" : value === "fixture" ? "fixture" : "none";
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readStringNumberRecord(value: unknown): Record<string, number> {
  const record = parseUnknownRecord(value);
  if (!record) {
    return {};
  }
  return Object.fromEntries(Object.entries(record).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
}

async function appendWebRunExecutionEvent(
  repositories: ReturnType<typeof createSqliteRepositories>,
  input: {
      type: "web_run_execution_started" | "web_run_execution_finished";
      run: SimulationRunRecord;
      executionId: string;
      mode: Extract<
        WebRunMode,
        | "phase18_next_round"
        | "phase18_current_map"
        | "phase18_keep_generating_map"
        | "phase18_full_bo3"
        | "phase20_node_round_experimental"
        | "phase20_node_map_experimental"
      >;
    status: "running" | "completed" | "failed";
    facts: Awaited<ReturnType<typeof readPhase18RunFacts>>;
    latestError?: string;
    now?: string;
  }
): Promise<void> {
  const match = await repositories.matches.getById(input.run.runtimeMatchId);
  if (!match) {
    return;
  }
  const createdAt = input.now ?? new Date().toISOString();
  const [globalSequence, sequenceInScope] = await Promise.all([
    repositories.events.getMaxGlobalSequence(),
    repositories.events.getMaxSequenceInScope("match", match.id)
  ]);
  const event: RepositoryEvent = {
    id: `evt_${safeEventPart(input.run.id)}_${safeEventPart(input.executionId)}_${input.type}`,
    type: input.type,
    category: "runtime_control",
    tournamentId: match.tournamentId,
    matchId: match.id,
    mapGameId: input.facts.mapGameId ?? input.run.runtimeMapGameId,
    payload: {
      schemaVersion: 1,
      runId: input.run.id,
      executionId: input.executionId,
      mode: mapWebRunModeToSimulationRunMode(input.mode),
      status: input.status,
      runtimeMatchId: input.run.runtimeMatchId,
      mapGameId: input.facts.mapGameId ?? input.run.runtimeMapGameId ?? null,
      baselineCompletedRounds: input.run.baselineCompletedRounds,
      estimatedTotalRounds: input.run.estimatedTotalRounds,
      expectedTotalCalls: input.run.expectedTotalCalls,
      latestCommittedRoundNumber: input.facts.latestCommittedRoundNumber,
      hasFreshReplay: input.facts.hasFreshReplay,
      ...(input.type === "web_run_execution_started" ? { startedAtReal: createdAt } : { finishedAtReal: createdAt }),
      ...(input.latestError ? { latestError: input.latestError } : {})
    },
    globalSequence: globalSequence + 1,
    scopeType: "match",
    scopeId: match.id,
    sequenceInScope: sequenceInScope + 1,
    sourceModule: "web.phase20.execution",
    createdAt
  };
  await repositories.events.append(event);
}

function safeEventPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_]+/g, "_");
}

function parseUnknownRecord(value: unknown): Record<string, unknown> | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function startPhase18WebRun(input: {
  fixtureId: string;
  runId: string | null | undefined;
  mode: Extract<
      WebRunMode,
      | "phase18_next_round"
      | "phase18_current_map"
      | "phase18_keep_generating_map"
      | "phase18_full_bo3"
      | "phase20_node_round_experimental"
      | "phase20_node_map_experimental"
  >;
  retryMode?: WebRunRetryMode;
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
    if (existingRun && isPhase18RunContractBlocked(repositories, existingRun)) {
      throw new Error(
        `该 run 使用旧版或混合 prompt contract，已禁止继续生成。请重置整场 BO3 后创建新的 ${PHASE20_PRE_PROMPT_CONTRACT_ID} run。`
      );
    }
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
        promptContractId: PHASE20_PRE_PROMPT_CONTRACT_ID,
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
        promptContractId: continuedRun?.promptContractId ?? PHASE20_PRE_PROMPT_CONTRACT_ID,
        runtimeMatchId,
        runtimeMapGameId: facts.mapGameId ?? continuedRun?.runtimeMapGameId ?? null,
        baselineCompletedRounds: facts.completedRounds,
        estimatedTotalRounds: facts.completedRounds + remainingRounds,
        expectedTotalCalls: isNodeExperimentalWebRunMode(input.mode) ? 0 : remainingRounds * phase18CallsPerRound,
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
    const executionId = createWebExecutionId();
    await appendWebRunExecutionEvent(repositories, {
      type: "web_run_execution_started",
      run: persistedRun,
      executionId,
      mode: input.mode,
      status: "running",
      facts,
      now
    });

      const promise =
        input.mode === "phase20_node_map_experimental"
          ? runPhase20NodeMapExperimentalFromWeb({
              runtimeMatchId: persistedRun.runtimeMatchId
            })
        : input.mode === "phase20_node_round_experimental"
          ? runPhase20NodeRoundExperimentalFromWeb({
              runtimeMatchId: persistedRun.runtimeMatchId
            })
          : input.mode === "phase18_keep_generating_map"
          ? runPhase18KeepGeneratingMapFromWeb({
              runtimeMatchId: persistedRun.runtimeMatchId,
              runId: persistedRun.id,
            executionId
          })
        : runPhase18ScopeFromWeb({
            runtimeMatchId: persistedRun.runtimeMatchId,
            scope: mapWebRunModeToScope(input.mode),
            retryMode: input.retryMode
          });
    activeExecution = {
      runId: persistedRun.id,
      fixtureId: phase18FixtureId,
      mode: input.mode,
      executionId,
      promise
    };

    void finalizePhase18RunPromise(persistedRun.id, executionId, input.mode, promise);
  } finally {
    repositories.close();
  }

  const progress = await readWebRunProgress(startedRunId, phase18FixtureId);
  if (!progress) {
    throw new Error("Unable to read the newly started Phase 1.8 run.");
  }

  return progress;
}

function isNodeExperimentalWebRunMode(mode: WebRunMode): boolean {
  return mode === "phase20_node_round_experimental" || mode === "phase20_node_map_experimental";
}

  async function finalizePhase18RunPromise(
    runId: string,
    executionId: string,
    mode: Extract<
      WebRunMode,
      | "phase18_next_round"
      | "phase18_current_map"
      | "phase18_keep_generating_map"
      | "phase18_full_bo3"
      | "phase20_node_round_experimental"
      | "phase20_node_map_experimental"
    >,
    promise: Promise<WebRunSingleMapResult>
  ): Promise<void> {
  try {
    await promise;
    await finalizePhase18Run(runId, executionId, mode);
  } catch (error) {
    await finalizePhase18Run(runId, executionId, mode, sanitizeRunError(error));
  } finally {
    if (activeExecution?.runId === runId) {
      activeExecution = null;
    }
  }
  }

  async function runPhase20NodeMapExperimentalFromWeb(input: { runtimeMatchId: string }): Promise<WebRunSingleMapResult> {
    const projectRoot = findProjectRoot(process.cwd());
    const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
    try {
      const mapGameId = await selectCurrentPhase18MapGameId(repositories, input.runtimeMatchId);
      await runDust2NodeMapExperimental({
        repositories,
        artifactStore: new ServerLocalArtifactStore(projectRoot, repositories.artifacts),
        mapGameId,
        enableMapExperimentalMode: true
      });
      return await toWebRunResultFromMatch(repositories, input.runtimeMatchId);
    } finally {
      repositories.close();
    }
  }

  async function runPhase20NodeRoundExperimentalFromWeb(input: { runtimeMatchId: string }): Promise<WebRunSingleMapResult> {
    const projectRoot = findProjectRoot(process.cwd());
    const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
    try {
      const mapGameId = await selectCurrentPhase18MapGameId(repositories, input.runtimeMatchId);
      await commitDust2NodeRoundExperimental({
        repositories,
        artifactStore: new ServerLocalArtifactStore(projectRoot, repositories.artifacts),
        mapGameId,
        enableExperimentalMode: true
      });
      return await toWebRunResultFromMatch(repositories, input.runtimeMatchId);
    } finally {
      repositories.close();
    }
  }

  async function finalizePhase18Run(
    runId: string,
    executionId: string,
    mode: Extract<
      WebRunMode,
      | "phase18_next_round"
      | "phase18_current_map"
      | "phase18_keep_generating_map"
      | "phase18_full_bo3"
      | "phase20_node_round_experimental"
      | "phase20_node_map_experimental"
    >,
    latestError?: string
  ): Promise<void> {
  const projectRoot = findProjectRoot(process.cwd());
  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  try {
    await recoverAbandonedPhase18Runs(repositories, runId);
    const storedRun = normalizeSimulationRunRecord(await repositories.simulationRuns.getById(runId));
    if (!storedRun) {
      return;
    }
    if (storedRun.status === "discarded") {
      const discardError = storedRun.latestError ?? latestError ?? "Run was discarded before execution finalized.";
      const facts = await readPhase18RunFacts(repositories, storedRun.runtimeMatchId);
      const savedRun = patchSimulationRunRecord(storedRun, {
        latestCommittedRoundNumber: facts.latestCommittedRoundNumber,
        hasFreshReplay: facts.hasFreshReplay,
        latestError: discardError,
        completedAt: storedRun.completedAt ?? new Date().toISOString()
      });
      await repositories.simulationRuns.save(savedRun);
      await appendWebRunExecutionEvent(repositories, {
        type: "web_run_execution_finished",
        run: savedRun,
        executionId,
        mode,
        status: "failed",
        facts,
        latestError: discardError
      });
      await appendNodeShadowSidecarAuditSafely(repositories, {
        run: savedRun,
        facts,
        executionId,
        projectRoot
      });
      return;
    }

    const { run, facts } = await syncPhase18SimulationRun(repositories, storedRun);
    const status: "completed" | "failed" = latestError ? "failed" : "completed";
    const savedRun = patchSimulationRunRecord(run, {
        status,
        runtimeMapGameId: facts.mapGameId ?? run.runtimeMapGameId ?? null,
        latestCommittedRoundNumber: facts.latestCommittedRoundNumber,
        hasFreshReplay: facts.hasFreshReplay,
        latestError: latestError ?? null,
        completedAt: new Date().toISOString()
      });
    await repositories.simulationRuns.save(savedRun);
    await appendWebRunExecutionEvent(repositories, {
      type: "web_run_execution_finished",
      run: savedRun,
      executionId,
      mode,
      status,
      facts,
      ...(latestError ? { latestError } : {})
    });
    await appendNodeShadowSidecarAuditSafely(repositories, {
      run: savedRun,
      facts,
      executionId,
      projectRoot
    });
  } finally {
    repositories.close();
  }
}

async function appendNodeShadowSidecarAuditSafely(
  repositories: ReturnType<typeof createSqliteRepositories>,
  input: {
    run: SimulationRunRecord;
    facts: Awaited<ReturnType<typeof readPhase18RunFacts>>;
    executionId: string;
    projectRoot: string;
  }
): Promise<void> {
  try {
    await appendNodeShadowSidecarAuditIfEnabled({
      repositories,
      run: input.run,
      facts: input.facts,
      executionId: input.executionId,
      env: loadRootLocalEnv(input.projectRoot, process.env)
    });
  } catch (error) {
    console.warn("Node shadow sidecar audit failed without changing the run status.", sanitizeRunError(error));
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
    mode: Extract<
      WebRunMode,
      | "phase18_next_round"
      | "phase18_current_map"
      | "phase18_keep_generating_map"
      | "phase18_full_bo3"
      | "phase20_node_round_experimental"
      | "phase20_node_map_experimental"
    >
  ): Promise<number> {
    if (mode === "phase18_next_round" || mode === "phase20_node_round_experimental") {
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

  if (mode === "phase18_current_map" || mode === "phase18_keep_generating_map") {
    return currentMapRemaining;
  }
  if (mode === "phase20_node_map_experimental") {
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
  attemptEvents: RoundGenerationAttemptEvent[];
  executionEvents: WebRunExecutionEvent[];
  nodeShadow: WebRunNodeShadowProgress | null;
  nodeMapExperimental: WebRunNodeMapExperimentalProgress | null;
  casterModes: Array<{ mode: string | null; count: number }>;
  recentRuns: WebRunHistory[];
}): WebRunProgress {
  const now = new Date().toISOString();
  const latestExecutionEvent = input.executionEvents.at(-1);
  const currentExecutionId =
    activeExecution?.runId === input.run.id ? activeExecution.executionId : latestExecutionEvent?.executionId ?? readLatestExecutionId(input.attemptEvents);
  const currentExecutionMode =
    activeExecution?.runId === input.run.id
      ? activeExecution.mode
      : latestExecutionEvent?.mode ?? mapSimulationRunModeToWebRunMode(input.run.requestedMode);
  const currentExecutionStatus =
    activeExecution?.runId === input.run.id ? "running" : latestExecutionEvent?.status ?? (input.run.status === "failed" ? "failed" : input.run.status === "completed" ? "completed" : undefined);
  const currentAttemptEvents = currentExecutionId ? input.attemptEvents.filter((event) => event.executionId === currentExecutionId) : [];
  const currentOuterAttemptNumber = currentAttemptEvents.reduce((max, event) => Math.max(max, event.outerAttemptNumber), 0) || undefined;
  const latestRetryEvent = [...currentAttemptEvents]
    .reverse()
    .find((event) => event.type === "round_generation_attempt_retrying" || event.type === "round_generation_attempt_terminal_failed");
  const currentExecutionCalls = input.llmCalls.filter((call) => call.roundNumber > input.run.baselineCompletedRounds);
  const recoveredFailureCalls = currentExecutionCalls.filter((call) => call.status === "failed" && call.roundNumber <= input.facts.latestCommittedRoundNumber);
  const latestRecoveredFailure = recoveredFailureCalls.at(-1);
  const progressPercent =
    input.run.status === "completed"
      ? 100
      : input.run.estimatedTotalRounds > 0
        ? Math.min(input.run.status === "running" ? 99 : 100, Math.round((input.facts.completedRounds / input.run.estimatedTotalRounds) * 100))
        : 0;

  return {
    runId: input.run.id,
    mode: currentExecutionMode,
    currentExecutionMode,
    ...(currentExecutionStatus ? { currentExecutionStatus } : {}),
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
    ...(currentExecutionId ? { currentExecutionId } : {}),
    ...(currentOuterAttemptNumber ? { currentOuterAttemptNumber } : {}),
    ...(latestRetryEvent ? { latestRetryReason: latestRetryEvent.error ?? latestRetryEvent.errorKind ?? latestRetryEvent.result } : {}),
    recoveredFailureCount: recoveredFailureCalls.length,
    ...(latestRecoveredFailure?.error ? { latestRecoveredError: latestRecoveredFailure.error } : {}),
    currentExecutionStartedCalls: currentExecutionCalls.length,
    currentExecutionCompletedCalls: currentExecutionCalls.filter((call) => call.status === "completed").length,
    currentExecutionFailedCalls: currentExecutionCalls.filter((call) => call.status === "failed").length,
    currentExecutionRunningCalls: currentExecutionCalls.filter((call) => call.status === "started").length,
    ...(input.run.promptContractId ? { promptContractId: input.run.promptContractId } : {}),
    contractStatus: deriveProgressContractStatus(input.run, input.llmCalls),
    progressPercent,
    ...(input.nodeShadow ? { nodeShadow: input.nodeShadow } : {}),
    ...(input.nodeMapExperimental ? { nodeMapExperimental: input.nodeMapExperimental } : {}),
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

function deriveProgressContractStatus(
  run: SimulationRunRecord,
  llmCalls: WebRunLlmCallProgress[]
): NonNullable<WebRunProgress["contractStatus"]> {
  const contracts = new Set([
    ...(run.promptContractId ? [run.promptContractId] : []),
    ...llmCalls.map((call) => call.promptContractId).filter((value): value is string => Boolean(value))
  ]);
  if (contracts.size === 0) {
    return "legacy";
  }
  if (contracts.size > 1) {
    return "mixed";
  }
  return contracts.has(PHASE20_PRE_PROMPT_CONTRACT_ID) ? "current" : "blocked";
}

function readLlmCalls(repositories: ReturnType<typeof createSqliteRepositories>, runtimeMatchId: string): WebRunLlmCallProgress[] {
  const persistedRows = repositories.sqlite
    .prepare(
      `SELECT id, task_type, round_id, agent_id, driver_model_id, prompt_contract_id, status, error,
              completed_at, latency_ms, input_tokens, output_tokens, response_artifact_id, repaired, created_at
       FROM llm_calls
       WHERE match_id = ?
       ORDER BY created_at ASC, id ASC`
    )
    .all(runtimeMatchId) as Array<Record<string, unknown>>;
  const hasPersistedStatus = persistedRows.some((row) => row.status === "completed" || row.status === "failed" || row.status === "started");
  if (persistedRows.length > 0 && hasPersistedStatus) {
    const roundNumberByRoundId = readRoundNumberByRoundId(repositories, persistedRows.map((row) => row.round_id).filter((value): value is string => typeof value === "string"));
    return persistedRows
      .map((row): WebRunLlmCallProgress => {
        const status: WebRunLlmCallStatus =
          row.status === "completed" || row.status === "failed" || row.status === "started" ? row.status : "started";
        const callId = typeof row.id === "string" ? row.id : "";
        const roundNumber =
          typeof row.round_id === "string" ? roundNumberByRoundId.get(row.round_id) ?? inferRoundNumberFromLlmCallId(callId) : inferRoundNumberFromLlmCallId(callId);
        return {
          callId,
          taskType: typeof row.task_type === "string" ? row.task_type : "unknown",
          roundNumber,
          ...(typeof row.agent_id === "string" ? { agentId: row.agent_id } : {}),
          driverModelId: typeof row.driver_model_id === "string" ? row.driver_model_id : "unknown",
          ...(typeof row.prompt_contract_id === "string" ? { promptContractId: row.prompt_contract_id } : {}),
          status,
          startedAt: typeof row.created_at === "string" ? row.created_at : "",
          ...(typeof row.latency_ms === "number" ? { latencyMs: row.latency_ms } : {}),
          ...(typeof row.input_tokens === "number" ? { inputTokens: row.input_tokens } : {}),
          ...(typeof row.output_tokens === "number" ? { outputTokens: row.output_tokens } : {}),
          ...(typeof row.error === "string" ? { error: row.error } : {}),
          ...(typeof row.response_artifact_id === "string" ? { responseArtifactId: row.response_artifact_id } : {}),
          ...(typeof row.repaired === "number" ? { repaired: row.repaired !== 0 } : {})
        };
      })
      .filter((call) => call.callId.length > 0)
      .sort(sortLlmCallsForDisplay);
  }

  const rows = repositories.sqlite
    .prepare(
      `SELECT type, payload_json
       FROM events
       WHERE match_id = ?
         AND type IN ('llm_call_started', 'llm_call_completed', 'llm_call_failed', 'llm_call_stale_marked_failed')
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
      ...(payload.promptContractId
        ? { promptContractId: payload.promptContractId }
        : current?.promptContractId
          ? { promptContractId: current.promptContractId }
          : {}),
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

  return [...callsById.values()].sort(sortLlmCallsForDisplay);
}

function sortLlmCallsForDisplay(left: WebRunLlmCallProgress, right: WebRunLlmCallProgress): number {
  if (right.roundNumber !== left.roundNumber) {
    return right.roundNumber - left.roundNumber;
  }
  return left.callId.localeCompare(right.callId);
}

function readRoundNumberByRoundId(
  repositories: ReturnType<typeof createSqliteRepositories>,
  roundIds: string[]
): Map<string, number> {
  const uniqueRoundIds = [...new Set(roundIds)];
  if (uniqueRoundIds.length === 0) {
    return new Map();
  }
  const rows = repositories.sqlite
    .prepare(`SELECT id, round_number AS roundNumber FROM rounds WHERE id IN (${placeholders(uniqueRoundIds)})`)
    .all(...uniqueRoundIds) as Array<{ id?: unknown; roundNumber?: unknown }>;
  return new Map(
    rows
      .filter((row): row is { id: string; roundNumber: number } => typeof row.id === "string" && typeof row.roundNumber === "number")
      .map((row) => [row.id, row.roundNumber])
  );
}

function inferRoundNumberFromLlmCallId(callId: string): number {
  const match = /_(\d+)_attempt_\d+_/.exec(callId);
  if (!match) {
    return 0;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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
      ...(typeof parsed.promptContractId === "string" ? { promptContractId: parsed.promptContractId } : {}),
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
    ...(run.promptContractId ? { promptContractId: run.promptContractId } : {}),
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
    promptContractId?: string;
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
    ...(patch.promptContractId ?? run.promptContractId ? { promptContractId: patch.promptContractId ?? run.promptContractId } : {}),
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

  function mapWebRunModeToSimulationRunMode(
    mode: Extract<
      WebRunMode,
      | "phase18_next_round"
      | "phase18_current_map"
      | "phase18_keep_generating_map"
      | "phase18_full_bo3"
      | "phase20_node_round_experimental"
      | "phase20_node_map_experimental"
    >
  ): SimulationRunMode {
    return mode;
  }
  
  function mapSimulationRunModeToWebRunMode(
    mode: SimulationRunMode
  ): Extract<
    WebRunMode,
    | "phase18_next_round"
    | "phase18_current_map"
    | "phase18_keep_generating_map"
    | "phase18_full_bo3"
    | "phase20_node_round_experimental"
    | "phase20_node_map_experimental"
    | "phase20_hex_round_experimental"
    | "phase20_hex_map_experimental"
  > {
    return mode;
  }
