import type { SqliteRepositoryBundle } from "@agent-major/db";
import { phase18CanonIds, phase20PrePilotMapIds } from "@agent-major/materials";

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

export const phase18FixtureId = phase18CanonIds.fixtureId;

export interface Phase18RunFacts {
  runtimeMatchId: string;
  runtimeMatchStatus: string | null;
  mapGameId: string | null;
  mapGameIds: string[];
  mapName: string;
  currentRoundNumber: number | null;
  currentMapOrder: number | null;
  completedRounds: number;
  latestCommittedRoundNumber: number;
  teamAMapsWon: number;
  teamBMapsWon: number;
  hasFreshReplay: boolean;
}

export interface Phase18RunHistoryEntry {
  runId: string;
  fixtureId: string;
  runtimeMatchId: string;
  requestedMode: SimulationRunMode;
  status: SimulationRunStatus;
  mapLabel: string;
  completedRounds: number;
  latestCommittedRoundNumber: number;
  hasFreshReplay: boolean;
  createdAt: string;
  scoreLabel: string;
  latestError?: string;
}

export function createPhase18RunId(now = Date.now()): string {
  return `phase18_run_${now.toString(36)}`;
}

export function shouldContinuePhase18Run(run: SimulationRunRecord | null | undefined): boolean {
  return Boolean(run && run.status !== "discarded");
}

export async function recoverAbandonedPhase18Runs(
  repositories: SqliteRepositoryBundle,
  activeRunId?: string
): Promise<void> {
  const runs = (await repositories.simulationRuns.listByFixtureId(phase18FixtureId)).map(normalizeSimulationRunRecord);
  const abandoned = runs.filter((run) => run.status === "running" && run.id !== activeRunId);
  if (abandoned.length === 0) {
    return;
  }

  const completedAt = new Date().toISOString();
  for (const run of abandoned) {
    await repositories.simulationRuns.save({
      ...run,
      status: "failed",
      latestError: run.latestError ?? "Local web runner restarted before this run finished.",
      completedAt
    });
  }
}

export async function readPhase18RunFacts(
  repositories: SqliteRepositoryBundle,
  runtimeMatchId: string
): Promise<Phase18RunFacts> {
  const match = await repositories.matches.getById(runtimeMatchId);
  const mapGames = match ? await repositories.mapGames.listByMatch(runtimeMatchId) : [];
  const orderedMaps = [...mapGames].sort((left, right) => left.order - right.order);
  const currentMap = orderedMaps.find((mapGame) => mapGame.status !== "completed") ?? orderedMaps.at(-1) ?? null;
  const countRow = repositories.sqlite
    .prepare("SELECT COUNT(*) AS count FROM round_reports WHERE match_id = ?")
    .get(runtimeMatchId) as { count?: unknown } | undefined;
  const latestRow = currentMap
    ? (repositories.sqlite
        .prepare("SELECT COALESCE(MAX(round_number), 0) AS value FROM round_reports WHERE map_game_id = ?")
        .get(currentMap.id) as { value?: unknown } | undefined)
    : undefined;

  return {
    runtimeMatchId,
    runtimeMatchStatus: match?.status ?? null,
    mapGameId: currentMap?.id ?? null,
    mapGameIds: orderedMaps.map((mapGame) => mapGame.id),
    mapName: orderedMaps.length > 0 ? orderedMaps.map((mapGame) => mapGame.mapName).join(" / ") : phase20PrePilotMapIds.join(" / "),
    currentRoundNumber: currentMap ? currentMap.currentRoundNumber || null : null,
    currentMapOrder: currentMap?.order ?? null,
    completedRounds: typeof countRow?.count === "number" ? countRow.count : 0,
    latestCommittedRoundNumber: typeof latestRow?.value === "number" ? latestRow.value : 0,
    teamAMapsWon: match?.teamAMapsWon ?? 0,
    teamBMapsWon: match?.teamBMapsWon ?? 0,
    hasFreshReplay: (typeof countRow?.count === "number" ? countRow.count : 0) > 0
  };
}

export async function syncPhase18SimulationRun(
  repositories: SqliteRepositoryBundle,
  run: SimulationRunRecord
): Promise<{ run: SimulationRunRecord; facts: Phase18RunFacts }> {
  const facts = await readPhase18RunFacts(repositories, run.runtimeMatchId);
  const nextRun: SimulationRunRecord = {
    ...run,
    ...(facts.mapGameId ? { runtimeMapGameId: facts.mapGameId } : {}),
    latestCommittedRoundNumber: facts.latestCommittedRoundNumber,
    hasFreshReplay: facts.hasFreshReplay
  };

  if (JSON.stringify(nextRun) !== JSON.stringify(run)) {
    await repositories.simulationRuns.save(nextRun);
    return { run: nextRun, facts };
  }

  return { run, facts };
}

export async function resolvePhase18SelectedRun(
  repositories: SqliteRepositoryBundle,
  input: { runId: string | null | undefined; fixtureId: string | undefined }
): Promise<SimulationRunRecord | null> {
  if (input.runId) {
    return normalizeSimulationRunRecord(await repositories.simulationRuns.getById(input.runId));
  }

  const runs = (await repositories.simulationRuns.listByFixtureId(input.fixtureId ?? phase18FixtureId)).map(normalizeSimulationRunRecord);
  if (runs[0]?.status === "discarded") {
    return null;
  }

  return runs.find((run) => run.status !== "discarded") ?? null;
}

export async function listPhase18RunHistoryEntries(
  repositories: SqliteRepositoryBundle,
  fixtureId: string = phase18FixtureId,
  limit = 8
): Promise<Phase18RunHistoryEntry[]> {
  const runs = (await repositories.simulationRuns.listByFixtureId(fixtureId)).map(normalizeSimulationRunRecord).slice(0, limit);
  const entries: Phase18RunHistoryEntry[] = [];
  for (const run of runs) {
    const { run: syncedRun, facts } = await syncPhase18SimulationRun(repositories, run);
    entries.push({
      runId: syncedRun.id,
      fixtureId: syncedRun.fixtureId,
      runtimeMatchId: syncedRun.runtimeMatchId,
      requestedMode: syncedRun.requestedMode,
      status: syncedRun.status,
      mapLabel: facts.currentMapOrder ? `M${facts.currentMapOrder} / ${facts.mapName}` : facts.mapName,
      completedRounds: facts.completedRounds,
      latestCommittedRoundNumber: syncedRun.latestCommittedRoundNumber,
      hasFreshReplay: syncedRun.hasFreshReplay,
      createdAt: syncedRun.createdAt,
      scoreLabel: `${facts.teamAMapsWon}-${facts.teamBMapsWon}`,
      ...(syncedRun.latestError ? { latestError: syncedRun.latestError } : {})
    });
  }

  return entries;
}

function normalizeSimulationRunRecord(
  run: Awaited<ReturnType<SqliteRepositoryBundle["simulationRuns"]["getById"]>>
): SimulationRunRecord {
  if (!run) {
    throw new Error("Simulation run is required.");
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
