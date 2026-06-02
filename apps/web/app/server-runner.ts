import { resolve } from "node:path";

import {
  createPhase16SimulationEngine,
  createPhase18SimulationEngine,
  DashScopeOpenAiProvider,
  defaultDriverModels,
  FakeProvider,
  loadAgentMajorLlmConfig,
  UnconfiguredJobQueue
} from "@agent-major/core";
import { createSqliteRepositories, defaultSqlitePath, type SqliteRepositoryBundle } from "@agent-major/db";
import {
  loadProcessedMaterials,
  phase17CanonIds,
  phase20PrePilotMapIds,
  seedPhase17ShowcaseMatch,
  seedPhase18ShowcaseMatch,
  type ProcessedMaterials
} from "@agent-major/materials";

import { ServerLocalArtifactStore } from "./server-artifact-store";
import { loadRootLocalEnv } from "./server-local-env";
import { findProjectRoot } from "./server-project-root";

export interface WebRunSingleMapResult {
  matchId: string;
  mapGameId: string;
  mapGameIds?: string[];
  mapName: string;
  mapNames?: string[];
  status: string;
  score: string;
  casterModes: Array<{
    mode: string | null;
    count: number;
  }>;
}

export interface WebResetResult {
  scope: "round" | "map" | "match";
  matchId: string;
  mapGameId?: string;
  roundsBefore: number;
  roundsAfter: number;
  reportsBefore: number;
  reportsAfter: number;
}

export async function runPhase17ShowcaseFromWeb(matchId: string): Promise<WebRunSingleMapResult> {
  if (matchId !== phase17CanonIds.matchId) {
    throw new Error(`Phase 1.7 web runner only supports the showcase match: ${phase17CanonIds.matchId}`);
  }

  const projectRoot = findProjectRoot(process.cwd());
  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  try {
    await resetPhase17Fixture(repositories);
    const seed = await seedPhase17ShowcaseMatch({ repositories, projectRoot });
    const engine = createPhase16SimulationEngine({
      repositories,
      llmGateway: new FakeProvider({ providerId: "phase17-web-fake-match-provider" }),
      jobQueue: new UnconfiguredJobQueue()
    });
    const result = await engine.runCurrentMatch({ matchId: seed.match.id, selectedMapIds: seed.selectedMapIds });
    return toWebRunResult(repositories, result.match.id, result.match.status, result.match.teamAMapsWon, result.match.teamBMapsWon, result.mapGames);
  } finally {
    repositories.close();
  }
}

export async function ensurePhase18RuntimeFixture(input: {
  repositories: SqliteRepositoryBundle;
  projectRoot: string;
  driverModel: ReturnType<typeof requireDriverModel>;
  engine: ReturnType<typeof createPhase18SimulationEngine>;
  runtimeMatchId: string;
  selectedMapIds?: string[];
}): Promise<{ matchId: string; selectedMapIds: string[] }> {
  const selectedMapIds = normalizePhase18SelectedMapIds(input.selectedMapIds);
  const existingMatch = await input.repositories.matches.getById(input.runtimeMatchId);

  if (!existingMatch) {
    const seed = await seedPhase18ShowcaseMatch({
      repositories: input.repositories,
      projectRoot: input.projectRoot,
      driverModel: input.driverModel,
      runtimeMatchId: input.runtimeMatchId,
      selectedMapIds
    });
    await input.engine.startMatch({ matchId: seed.match.id });
    await input.engine.completeVeto({ matchId: seed.match.id, selectedMapIds: seed.selectedMapIds });
    return { matchId: seed.match.id, selectedMapIds: seed.selectedMapIds };
  }

  const existingMaps = await input.repositories.mapGames.listByMatch(existingMatch.id);
  if (!fixtureMatchesSelectedMaps(existingMaps, selectedMapIds)) {
    throw new Error(`Phase 1.8 run ${input.runtimeMatchId} has stale map selection and can no longer be continued.`);
  }

  if (existingMatch.status !== "running" || existingMaps.length === 0) {
    await input.engine.startMatch({ matchId: existingMatch.id });
    await input.engine.completeVeto({ matchId: existingMatch.id, selectedMapIds });
  }

  return { matchId: existingMatch.id, selectedMapIds };
}

export async function preparePhase18RuntimeFixtureFromWeb(input: {
  runtimeMatchId: string;
  selectedMapIds?: string[];
}): Promise<{ matchId: string; selectedMapIds: string[] }> {
  const projectRoot = findProjectRoot(process.cwd());
  const materials = loadProcessedMaterials(projectRoot);
  const env = loadRootLocalEnv(projectRoot, process.env);
  const llmConfig = loadAgentMajorLlmConfig(env);
  if (!llmConfig.enabled) {
    throw new Error(`Phase 1.8 real player/judge LLM is disabled: ${llmConfig.disabledReason ?? "not_configured"}`);
  }

  const driverModel = requireDriverModel(llmConfig.phase18DriverModelId);
  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  try {
    const engine = createPhase18SimulationEngine({
      repositories,
      llmGateway: new DashScopeOpenAiProvider({
        baseUrl: llmConfig.baseUrl ?? "",
        apiKey: llmConfig.apiKey ?? "",
        timeoutMs: llmConfig.timeoutMs,
        maxRetries: llmConfig.maxRetries
      }),
      jobQueue: new UnconfiguredJobQueue(),
      artifactStore: new ServerLocalArtifactStore(projectRoot, repositories.artifacts),
      phase18MapSemanticsByMapName: buildPhase18MapSemantics(materials)
    });

    return await ensurePhase18RuntimeFixture({
      repositories,
      projectRoot,
      driverModel,
      engine,
      runtimeMatchId: input.runtimeMatchId,
      ...(input.selectedMapIds ? { selectedMapIds: input.selectedMapIds } : {})
    });
  } finally {
    repositories.close();
  }
}

export async function runPhase18ScopeFromWeb(input: {
  runtimeMatchId: string;
  scope: "round" | "map" | "match";
}): Promise<WebRunSingleMapResult> {
  const projectRoot = findProjectRoot(process.cwd());
  const materials = loadProcessedMaterials(projectRoot);
  const env = loadRootLocalEnv(projectRoot, process.env);
  const llmConfig = loadAgentMajorLlmConfig(env);
  if (!llmConfig.enabled) {
    throw new Error(`Phase 1.8 real player/judge LLM is disabled: ${llmConfig.disabledReason ?? "not_configured"}`);
  }

  const driverModel = requireDriverModel(llmConfig.phase18DriverModelId);
  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  try {
    const engine = createPhase18SimulationEngine({
      repositories,
      llmGateway: new DashScopeOpenAiProvider({
        baseUrl: llmConfig.baseUrl ?? "",
        apiKey: llmConfig.apiKey ?? "",
        timeoutMs: llmConfig.timeoutMs,
        maxRetries: llmConfig.maxRetries
      }),
      jobQueue: new UnconfiguredJobQueue(),
      artifactStore: new ServerLocalArtifactStore(projectRoot, repositories.artifacts),
      phase18MapSemanticsByMapName: buildPhase18MapSemantics(materials)
    });

    const seeded = await ensurePhase18RuntimeFixture({
      repositories,
      projectRoot,
      driverModel,
      engine,
      runtimeMatchId: input.runtimeMatchId
    });

    if (input.scope === "match") {
      const result = await engine.runCurrentMatch({ matchId: seeded.matchId, selectedMapIds: seeded.selectedMapIds });
      return toWebRunResult(repositories, result.match.id, result.match.status, result.match.teamAMapsWon, result.match.teamBMapsWon, result.mapGames);
    }

    const mapGameId = await selectCurrentPhase18MapGameId(repositories, seeded.matchId);
    await engine.runCurrentMap({
      mapGameId,
      ...(input.scope === "round" ? { mode: "debug", maxRounds: 1 } : {})
    });
    return await toWebRunResultFromMatch(repositories, seeded.matchId);
  } finally {
    repositories.close();
  }
}

export async function runPhase18KeepGeneratingMapFromWeb(input: {
  runtimeMatchId: string;
  runId: string;
  executionId: string;
}): Promise<WebRunSingleMapResult> {
  const projectRoot = findProjectRoot(process.cwd());
  const materials = loadProcessedMaterials(projectRoot);
  const env = loadRootLocalEnv(projectRoot, process.env);
  const llmConfig = loadAgentMajorLlmConfig(env);
  if (!llmConfig.enabled) {
    throw new Error(`Phase 1.8 real player/judge LLM is disabled: ${llmConfig.disabledReason ?? "not_configured"}`);
  }

  const driverModel = requireDriverModel(llmConfig.phase18DriverModelId);
  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  try {
    const engine = createPhase18SimulationEngine({
      repositories,
      llmGateway: new DashScopeOpenAiProvider({
        baseUrl: llmConfig.baseUrl ?? "",
        apiKey: llmConfig.apiKey ?? "",
        timeoutMs: llmConfig.timeoutMs,
        maxRetries: llmConfig.maxRetries
      }),
      jobQueue: new UnconfiguredJobQueue(),
      artifactStore: new ServerLocalArtifactStore(projectRoot, repositories.artifacts),
      phase18MapSemanticsByMapName: buildPhase18MapSemantics(materials)
    });

    const seeded = await ensurePhase18RuntimeFixture({
      repositories,
      projectRoot,
      driverModel,
      engine,
      runtimeMatchId: input.runtimeMatchId
    });

    const mapGameId = await selectCurrentPhase18MapGameId(repositories, seeded.matchId);
    let outerAttemptNumber = 0;
    const maxOuterAttempts = 200;

    while (outerAttemptNumber < maxOuterAttempts) {
      const mapGame = await repositories.mapGames.getById(mapGameId);
      const match = await repositories.matches.getById(seeded.matchId);
      if (!mapGame || !match) {
        throw new Error(`Unable to read current map state for ${mapGameId}.`);
      }
      if (mapGame.status === "completed" || match.status === "completed") {
        await appendRoundGenerationAttemptEvent(repositories, {
          type: "round_generation_attempt_finished",
          runId: input.runId,
          executionId: input.executionId,
          matchId: match.id,
          tournamentId: match.tournamentId,
          mapGameId,
          roundNumber: mapGame.currentRoundNumber,
          outerAttemptNumber,
          committedBefore: readMapFactCounts(repositories, mapGameId).reports,
          committedAfter: readMapFactCounts(repositories, mapGameId).reports,
          result: "map_completed",
          stage: "keep_generating_map",
          startedAtReal: new Date().toISOString(),
          finishedAtReal: new Date().toISOString()
        });
        return await toWebRunResultFromMatch(repositories, seeded.matchId);
      }

      outerAttemptNumber += 1;
      const roundNumber = mapGame.currentRoundNumber + 1;
      const committedBefore = readMapFactCounts(repositories, mapGameId).reports;
      const startedAtReal = new Date().toISOString();
      await appendRoundGenerationAttemptEvent(repositories, {
        type: "round_generation_attempt_started",
        runId: input.runId,
        executionId: input.executionId,
        matchId: match.id,
        tournamentId: match.tournamentId,
        mapGameId,
        roundNumber,
        outerAttemptNumber,
        committedBefore,
        result: "started",
        stage: "runCurrentMap.debug_one_round",
        startedAtReal,
        scoreBeforeRound: {
          teamA: mapGame.teamAScore,
          teamB: mapGame.teamBScore
        }
      });

      try {
        await engine.runCurrentMap({ mapGameId, mode: "debug", maxRounds: 1 });
        const committedAfter = readMapFactCounts(repositories, mapGameId).reports;
        const afterMap = await repositories.mapGames.getById(mapGameId);
        const result = afterMap?.status === "completed" ? "map_completed" : committedAfter > committedBefore ? "committed" : "no_commit_after_generation";
        await appendRoundGenerationAttemptEvent(repositories, {
          type: "round_generation_attempt_finished",
          runId: input.runId,
          executionId: input.executionId,
          matchId: match.id,
          tournamentId: match.tournamentId,
          mapGameId,
          roundNumber,
          outerAttemptNumber,
          committedBefore,
          committedAfter,
          result,
          stage: "runCurrentMap.debug_one_round",
          startedAtReal,
          finishedAtReal: new Date().toISOString()
        });
        if (afterMap) {
          await appendScoreTensionDiagnosticIfNeeded(repositories, {
            match,
            mapGame: afterMap,
            runId: input.runId,
            executionId: input.executionId,
            roundNumber
          });
        }
        if (result === "map_completed") {
          return await toWebRunResultFromMatch(repositories, seeded.matchId);
        }
        if (result === "no_commit_after_generation") {
          await appendRoundGenerationAttemptEvent(repositories, {
            type: "round_generation_attempt_retrying",
            runId: input.runId,
            executionId: input.executionId,
            matchId: match.id,
            tournamentId: match.tournamentId,
            mapGameId,
            roundNumber,
            outerAttemptNumber,
            committedBefore,
            committedAfter,
            result,
            stage: "runCurrentMap.debug_one_round",
            errorKind: "no_commit_after_generation",
            error: "LLM generation returned without a committed round fact.",
            startedAtReal,
            finishedAtReal: new Date().toISOString()
          });
        }
      } catch (error) {
        const committedAfter = readMapFactCounts(repositories, mapGameId).reports;
        const errorText = sanitizeLocalRunError(error);
        if (committedAfter > committedBefore) {
          await appendRoundGenerationAttemptEvent(repositories, {
            type: "round_generation_attempt_finished",
            runId: input.runId,
            executionId: input.executionId,
            matchId: match.id,
            tournamentId: match.tournamentId,
            mapGameId,
            roundNumber,
            outerAttemptNumber,
            committedBefore,
            committedAfter,
            result: "committed_after_error",
            stage: "runCurrentMap.debug_one_round",
            errorKind: classifyKeepGeneratingError(errorText),
            error: errorText,
            startedAtReal,
            finishedAtReal: new Date().toISOString()
          });
          continue;
        }

        const errorKind = classifyKeepGeneratingError(errorText);
        const terminal = isTerminalKeepGeneratingError(errorKind);
        await appendRoundGenerationAttemptEvent(repositories, {
          type: "round_generation_attempt_finished",
          runId: input.runId,
          executionId: input.executionId,
          matchId: match.id,
          tournamentId: match.tournamentId,
          mapGameId,
          roundNumber,
          outerAttemptNumber,
          committedBefore,
          committedAfter,
          result: terminal ? "terminal_failed" : "retrying",
          stage: "runCurrentMap.debug_one_round",
          errorKind,
          error: errorText,
          startedAtReal,
          finishedAtReal: new Date().toISOString()
        });
        await appendRoundGenerationAttemptEvent(repositories, {
          type: terminal ? "round_generation_attempt_terminal_failed" : "round_generation_attempt_retrying",
          runId: input.runId,
          executionId: input.executionId,
          matchId: match.id,
          tournamentId: match.tournamentId,
          mapGameId,
          roundNumber,
          outerAttemptNumber,
          committedBefore,
          committedAfter,
          result: terminal ? "terminal_failed" : "retrying",
          stage: "runCurrentMap.debug_one_round",
          errorKind,
          error: errorText,
          startedAtReal,
          finishedAtReal: new Date().toISOString()
        });
        if (terminal) {
          throw error;
        }
      }
    }

    const finalMapGame = await repositories.mapGames.getById(mapGameId);
    const finalMatch = await repositories.matches.getById(seeded.matchId);
    if (finalMapGame && finalMatch) {
      const committedAfter = readMapFactCounts(repositories, mapGameId).reports;
      const now = new Date().toISOString();
      await appendRoundGenerationAttemptEvent(repositories, {
        type: "round_generation_attempt_terminal_failed",
        runId: input.runId,
        executionId: input.executionId,
        matchId: finalMatch.id,
        tournamentId: finalMatch.tournamentId,
        mapGameId,
        roundNumber: finalMapGame.currentRoundNumber + 1,
        outerAttemptNumber,
        committedBefore: committedAfter,
        committedAfter,
        result: "terminal_failed",
        stage: "runCurrentMap.debug_one_round",
        errorKind: "outer_attempt_limit",
        error: `phase18_keep_generating_map reached ${maxOuterAttempts} outer attempts without completing the current map.`,
        startedAtReal: now,
        finishedAtReal: now
      });
    }
    throw new Error(`phase18_keep_generating_map reached ${maxOuterAttempts} outer attempts without completing the current map.`);
  } finally {
    repositories.close();
  }
}

export async function resetPhase18CurrentMapFromWeb(runtimeMatchId: string): Promise<WebResetResult> {
  const projectRoot = findProjectRoot(process.cwd());
  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  try {
    return await resetPhase18CurrentMapFixture(repositories, runtimeMatchId);
  } finally {
    repositories.close();
  }
}

export async function resetPhase18RoundFromWeb(runtimeMatchId: string): Promise<WebResetResult> {
  const projectRoot = findProjectRoot(process.cwd());
  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  try {
    return await resetPhase18RoundFixture(repositories, runtimeMatchId);
  } finally {
    repositories.close();
  }
}

type ResetMapGame = Awaited<ReturnType<SqliteRepositoryBundle["mapGames"]["listByMatch"]>>[number];
type RepositoryEvent = Parameters<SqliteRepositoryBundle["events"]["append"]>[0];
type RoundGenerationAttemptEventType =
  | "round_generation_attempt_started"
  | "round_generation_attempt_finished"
  | "round_generation_attempt_retrying"
  | "round_generation_attempt_terminal_failed";

async function resetPhase18CurrentMapFixture(repositories: SqliteRepositoryBundle, runtimeMatchId: string): Promise<WebResetResult> {
  const match = await repositories.matches.getById(runtimeMatchId);
  if (!match) {
    throw new Error(`Match not found: ${runtimeMatchId}`);
  }

  const mapGames = await repositories.mapGames.listByMatch(match.id);
  const targetMap = selectCurrentResetMap(mapGames);
  if (!targetMap) {
    throw new Error(`Match ${match.id} has no map to reset.`);
  }

  const before = readMapFactCounts(repositories, targetMap.id);
  await repositories.transaction(async () => {
    await deleteMapGameArtifacts(repositories, targetMap.id);
    await repositories.mapGames.save({
      ...targetMap,
      status: "scheduled",
      runControlState: "idle",
      teamAScore: 0,
      teamBScore: 0,
      currentRoundNumber: 0,
      winnerTeamId: undefined,
      summaryId: undefined,
      startedAt: undefined,
      completedAt: undefined
    });
    await repositories.matches.save({
      ...match,
      status: "running",
      teamAMapsWon: 0,
      teamBMapsWon: 0,
      winnerTeamId: undefined,
      completedAt: undefined,
      startedAt: match.startedAt ?? match.createdAt
    });
  });

  const after = readMapFactCounts(repositories, targetMap.id);
  return {
    scope: "map",
    matchId: match.id,
    mapGameId: targetMap.id,
    roundsBefore: before.rounds,
    roundsAfter: after.rounds,
    reportsBefore: before.reports,
    reportsAfter: after.reports
  };
}

async function resetPhase18RoundFixture(repositories: SqliteRepositoryBundle, runtimeMatchId: string): Promise<WebResetResult> {
  const match = await repositories.matches.getById(runtimeMatchId);
  if (!match) {
    throw new Error(`Match not found: ${runtimeMatchId}`);
  }

  const mapGames = await repositories.mapGames.listByMatch(match.id);
  const targetMap = selectCurrentResetMap(mapGames);
  if (!targetMap) {
    throw new Error(`Match ${match.id} has no map to reset.`);
  }

  const roundReports = (await repositories.roundReports.listByMapGame(targetMap.id)).sort((left, right) => left.roundNumber - right.roundNumber);
  const targetReport = roundReports.at(-1);
  if (!targetReport) {
    return await resetPhase18CurrentMapFixture(repositories, runtimeMatchId);
  }

  const before = readMapFactCounts(repositories, targetMap.id);
  const previousReport = roundReports.at(-2);
  const previousScore = previousReport?.scoreAfterRound ?? { teamA: 0, teamB: 0 };
  const remainingRounds = roundReports.length - 1;

  await repositories.transaction(async () => {
    await deleteRoundArtifacts(repositories, targetReport.roundId, targetMap.id);
    await restoreCoachStatesForMap(repositories, targetMap.id, [match.teamAId, match.teamBId]);
    await repositories.mapGames.save({
      ...targetMap,
      status: remainingRounds > 0 ? "running" : "scheduled",
      runControlState: remainingRounds > 0 ? "running_map" : "idle",
      teamAScore: previousScore.teamA,
      teamBScore: previousScore.teamB,
      currentRoundNumber: targetReport.roundNumber - 1,
      winnerTeamId: undefined,
      summaryId: undefined,
      startedAt: remainingRounds > 0 ? targetMap.startedAt : undefined,
      completedAt: undefined
    });
    await repositories.matches.save({
      ...match,
      status: "running",
      completedAt: undefined,
      startedAt: match.startedAt ?? match.createdAt
    });
  });

  const after = readMapFactCounts(repositories, targetMap.id);
  return {
    scope: "round",
    matchId: match.id,
    mapGameId: targetMap.id,
    roundsBefore: before.rounds,
    roundsAfter: after.rounds,
    reportsBefore: before.reports,
    reportsAfter: after.reports
  };
}

function selectCurrentResetMap(mapGames: Array<ResetMapGame>): ResetMapGame | undefined {
  const ordered = [...mapGames].sort((left, right) => left.order - right.order);
  return ordered.find((mapGame) => mapGame.status !== "completed") ?? ordered.at(-1);
}

async function deleteMapGameArtifacts(repositories: SqliteRepositoryBundle, mapGameId: string): Promise<void> {
  repositories.sqlite.prepare("DELETE FROM summaries WHERE map_game_id = ? OR (scope_type = 'map' AND scope_id = ?)").run(mapGameId, mapGameId);
  repositories.sqlite
    .prepare(
      `DELETE FROM llm_calls
       WHERE round_id IN (SELECT id FROM rounds WHERE map_game_id = ?)
          OR request_artifact_id IN (SELECT id FROM artifacts WHERE map_game_id = ?)
          OR response_artifact_id IN (SELECT id FROM artifacts WHERE map_game_id = ?)`
    )
    .run(mapGameId, mapGameId, mapGameId);
  repositories.sqlite.prepare("DELETE FROM artifacts WHERE map_game_id = ?").run(mapGameId);
  repositories.sqlite.prepare("DELETE FROM events WHERE map_game_id = ?").run(mapGameId);
  repositories.sqlite.prepare("DELETE FROM timeline_events WHERE map_game_id = ?").run(mapGameId);
  repositories.sqlite.prepare("DELETE FROM economy_states WHERE map_game_id = ?").run(mapGameId);
  repositories.sqlite.prepare("DELETE FROM team_map_coach_states WHERE map_game_id = ?").run(mapGameId);
  repositories.sqlite.prepare("DELETE FROM round_reports WHERE map_game_id = ?").run(mapGameId);
  repositories.sqlite.prepare("DELETE FROM rounds WHERE map_game_id = ?").run(mapGameId);
}

async function deleteRoundArtifacts(repositories: SqliteRepositoryBundle, roundId: string, mapGameId: string): Promise<void> {
  repositories.sqlite.prepare("DELETE FROM summaries WHERE round_id = ? OR (scope_type = 'round' AND scope_id = ?)").run(roundId, roundId);
  repositories.sqlite.prepare("DELETE FROM llm_calls WHERE round_id = ?").run(roundId);
  repositories.sqlite.prepare("DELETE FROM artifacts WHERE round_id = ?").run(roundId);
  repositories.sqlite.prepare("DELETE FROM events WHERE round_id = ?").run(roundId);
  repositories.sqlite.prepare("DELETE FROM timeline_events WHERE round_id = ?").run(roundId);
  repositories.sqlite.prepare("DELETE FROM economy_states WHERE round_id = ?").run(roundId);
  repositories.sqlite.prepare("DELETE FROM round_reports WHERE round_id = ?").run(roundId);
  repositories.sqlite.prepare("DELETE FROM rounds WHERE id = ? AND map_game_id = ?").run(roundId, mapGameId);
}

async function restoreCoachStatesForMap(
  repositories: SqliteRepositoryBundle,
  mapGameId: string,
  teamIds: string[]
): Promise<void> {
  repositories.sqlite.prepare("DELETE FROM team_map_coach_states WHERE map_game_id = ?").run(mapGameId);
  const timeoutRows = repositories.sqlite
    .prepare(
      `SELECT
         json_extract(payload_json, '$.teamId') AS teamId,
         COUNT(*) AS usedCount,
         MAX(COALESCE(json_extract(payload_json, '$.triggerRoundNumber'), 0)) AS lastRound
       FROM events
       WHERE map_game_id = ?
         AND type = 'timeout_used'
       GROUP BY json_extract(payload_json, '$.teamId')`
    )
    .all(mapGameId) as Array<{ teamId?: unknown; usedCount?: unknown; lastRound?: unknown }>;
  const timeoutByTeamId = new Map(
    timeoutRows
      .filter((row): row is { teamId: string; usedCount?: unknown; lastRound?: unknown } => typeof row.teamId === "string")
      .map((row) => [
        row.teamId,
        {
          usedCount: typeof row.usedCount === "number" ? row.usedCount : 0,
          lastRound: typeof row.lastRound === "number" && row.lastRound > 0 ? row.lastRound : undefined
        }
      ])
  );
  const now = new Date().toISOString();
  for (const teamId of teamIds) {
    const timeoutState = timeoutByTeamId.get(teamId);
    await repositories.teamMapCoachStates.save({
      mapGameId,
      teamId,
      timeoutsRemaining: Math.max(0, 2 - (timeoutState?.usedCount ?? 0)),
      ...(timeoutState?.lastRound ? { lastTimeoutRoundNumber: timeoutState.lastRound } : {}),
      updatedAt: now
    });
  }
}

function readMapFactCounts(repositories: SqliteRepositoryBundle, mapGameId: string): { rounds: number; reports: number } {
  const rounds = repositories.sqlite.prepare("SELECT COUNT(*) AS count FROM rounds WHERE map_game_id = ?").get(mapGameId) as { count?: unknown };
  const reports = repositories.sqlite.prepare("SELECT COUNT(*) AS count FROM round_reports WHERE map_game_id = ?").get(mapGameId) as { count?: unknown };
  return {
    rounds: typeof rounds.count === "number" ? rounds.count : 0,
    reports: typeof reports.count === "number" ? reports.count : 0
  };
}

async function appendRoundGenerationAttemptEvent(
  repositories: SqliteRepositoryBundle,
  input: {
    type: RoundGenerationAttemptEventType;
    runId: string;
    executionId: string;
    tournamentId: string;
    matchId: string;
    mapGameId: string;
    roundNumber: number;
    outerAttemptNumber: number;
    committedBefore: number;
    committedAfter?: number;
    result: string;
    stage: string;
    errorKind?: string;
    error?: string;
    startedAtReal: string;
    finishedAtReal?: string;
    scoreBeforeRound?: { teamA: number; teamB: number };
  }
): Promise<RepositoryEvent> {
  const [globalSequence, sequenceInScope] = await Promise.all([
    repositories.events.getMaxGlobalSequence(),
    repositories.events.getMaxSequenceInScope("map", input.mapGameId)
  ]);
  const event: RepositoryEvent = {
    id: `evt_${safeEventPart(input.mapGameId)}_${safeEventPart(input.executionId)}_${input.outerAttemptNumber}_${input.type}`,
    type: input.type,
    category: "runtime_control",
    tournamentId: input.tournamentId,
    matchId: input.matchId,
    mapGameId: input.mapGameId,
    payload: {
      schemaVersion: 1,
      runId: input.runId,
      executionId: input.executionId,
      mapGameId: input.mapGameId,
      roundNumber: input.roundNumber,
      outerAttemptNumber: input.outerAttemptNumber,
      committedBefore: input.committedBefore,
      ...(typeof input.committedAfter === "number" ? { committedAfter: input.committedAfter } : {}),
      result: input.result,
      stage: input.stage,
      ...(input.errorKind ? { errorKind: input.errorKind } : {}),
      ...(input.error ? { error: input.error } : {}),
      startedAtReal: input.startedAtReal,
      ...(input.finishedAtReal ? { finishedAtReal: input.finishedAtReal } : {}),
      ...(input.scoreBeforeRound ? { scoreBeforeRound: input.scoreBeforeRound } : {})
    },
    globalSequence: globalSequence + 1,
    scopeType: "map",
    scopeId: input.mapGameId,
    sequenceInScope: sequenceInScope + 1,
    sourceModule: "web.phase20.keep_generating",
    createdAt: input.finishedAtReal ?? input.startedAtReal
  };
  return repositories.events.append(event);
}

async function appendScoreTensionDiagnosticIfNeeded(
  repositories: SqliteRepositoryBundle,
  input: {
    match: { id: string; tournamentId: string };
    mapGame: { id: string; teamAScore: number; teamBScore: number; status: string };
    runId: string;
    executionId: string;
    roundNumber: number;
  }
): Promise<void> {
  const reports = (await repositories.roundReports.listByMapGame(input.mapGame.id)).sort((left, right) => left.roundNumber - right.roundNumber);
  const latestWinnerTeamId = reports.at(-1)?.winnerTeamId;
  let winningStreak = 0;
  for (let index = reports.length - 1; index >= 0; index -= 1) {
    if (!latestWinnerTeamId || reports[index]?.winnerTeamId !== latestWinnerTeamId) {
      break;
    }
    winningStreak += 1;
  }
  const scoreDiff = Math.abs(input.mapGame.teamAScore - input.mapGame.teamBScore);
  const level =
    input.mapGame.status === "completed" && scoreDiff >= 5
      ? "map_final_gap"
      : winningStreak >= 4 || scoreDiff >= 4
        ? "strong"
        : winningStreak >= 3
          ? "warning"
          : null;
  if (!level) {
    return;
  }

  const [globalSequence, sequenceInScope] = await Promise.all([
    repositories.events.getMaxGlobalSequence(),
    repositories.events.getMaxSequenceInScope("map", input.mapGame.id)
  ]);
  await repositories.events.append({
    id: `evt_${safeEventPart(input.mapGame.id)}_score_tension_${input.roundNumber}`,
    type: "score_tension_diagnostic",
    category: "judge",
    tournamentId: input.match.tournamentId,
    matchId: input.match.id,
    mapGameId: input.mapGame.id,
    payload: {
      schemaVersion: 1,
      runId: input.runId,
      executionId: input.executionId,
      mapGameId: input.mapGame.id,
      roundNumber: input.roundNumber,
      level,
      latestWinnerTeamId,
      winningStreak,
      score: {
        teamA: input.mapGame.teamAScore,
        teamB: input.mapGame.teamBScore
      },
      scoreDiff,
      note: "诊断事件只暴露一边倒风险，不直接改写胜负。"
    },
    globalSequence: globalSequence + 1,
    scopeType: "map",
    scopeId: input.mapGame.id,
    sequenceInScope: sequenceInScope + 1,
    sourceModule: "web.phase20.score_tension",
    createdAt: new Date().toISOString()
  });
}

function classifyKeepGeneratingError(error: string): string {
  const lower = error.toLowerCase();
  if (lower.includes("map must be running") || lower.includes("current status: scheduled") || lower.includes("map_state_precondition")) {
    return "map_state_precondition";
  }
  if (lower.includes("json_truncated")) {
    return "json_truncated";
  }
  if (lower.includes("schema") || lower.includes("invalid enum") || lower.includes("unrecognized")) {
    return "schema_or_alias";
  }
  if (lower.includes("disabled") || lower.includes("not_configured") || lower.includes("api key") || lower.includes("stale map selection")) {
    return "terminal_configuration";
  }
  if (lower.includes("match not found") || lower.includes("map not found") || lower.includes("no remaining map")) {
    return "fixture_state";
  }
  return "generation_error";
}

function isTerminalKeepGeneratingError(errorKind: string): boolean {
  return errorKind === "terminal_configuration" || errorKind === "fixture_state" || errorKind === "map_state_precondition";
}

function sanitizeLocalRunError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/gi, "sk-[redacted]")
    .replace(/(api[_ -]?key["'\s:=]+)([^"',}\s]+)/gi, "$1[redacted]")
    .replace(/(authorization["'\s:=]+)(Bearer\s+)?([^"',}\s]+)/gi, "$1[redacted]");
}

function safeEventPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_]+/g, "_");
}

export async function selectCurrentPhase18MapGameId(repositories: SqliteRepositoryBundle, matchId: string): Promise<string> {
  const mapGame = (await repositories.mapGames.listByMatch(matchId))
    .sort((left, right) => left.order - right.order)
    .find((item) => item.status !== "completed");
  if (!mapGame) {
    throw new Error("Phase 1.8 has no remaining map to run.");
  }

  return mapGame.id;
}

export async function toWebRunResultFromMatch(repositories: SqliteRepositoryBundle, matchId: string): Promise<WebRunSingleMapResult> {
  const match = await repositories.matches.getById(matchId);
  if (!match) {
    throw new Error(`Match not found: ${matchId}`);
  }

  const mapGames = await repositories.mapGames.listByMatch(match.id);
  return toWebRunResult(repositories, match.id, match.status, match.teamAMapsWon, match.teamBMapsWon, mapGames);
}

function toWebRunResult(
  repositories: SqliteRepositoryBundle,
  matchId: string,
  status: string,
  teamAMapsWon: number,
  teamBMapsWon: number,
  mapGames: Array<{ id: string; order: number; mapName: string }>
): WebRunSingleMapResult {
  const orderedMapGames = [...mapGames].sort((left, right) => left.order - right.order);
  const firstMap = orderedMapGames[0];
  if (!firstMap) {
    throw new Error("Web runner generated no maps.");
  }

  return {
    matchId,
    mapGameId: firstMap.id,
    mapGameIds: orderedMapGames.map((mapGame) => mapGame.id),
    mapName: firstMap.mapName,
    mapNames: orderedMapGames.map((mapGame) => mapGame.mapName),
    status,
    score: `${teamAMapsWon}-${teamBMapsWon}`,
    casterModes: readCasterModes(repositories, orderedMapGames.map((mapGame) => mapGame.id))
  };
}

function readCasterModes(repositories: SqliteRepositoryBundle, mapGameIds: string[]): WebRunSingleMapResult["casterModes"] {
  if (mapGameIds.length === 0) {
    return [];
  }

  const placeholders = mapGameIds.map(() => "?").join(",");
  return repositories.sqlite
    .prepare(
      `SELECT json_extract(payload_json, '$.generationMode') AS mode, COUNT(*) AS count FROM events WHERE map_game_id IN (${placeholders}) AND type = 'caster_line_created' GROUP BY mode`
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

async function resetPhase17Fixture(repositories: SqliteRepositoryBundle): Promise<void> {
  await repositories.transaction(async () => {
    const tournamentId = phase17CanonIds.tournamentId;
    const matchRows = repositories.sqlite.prepare("SELECT id FROM matches WHERE tournament_id = ?").all(tournamentId) as Array<{ id: string }>;
    const matchIds = matchRows.map((row) => row.id);
    const mapIds = matchIds.length > 0 ? readMapIdsByMatchIds(repositories, matchIds) : [];

    repositories.sqlite.prepare("DELETE FROM timeline_events WHERE tournament_id = ?").run(tournamentId);
    repositories.sqlite.prepare("DELETE FROM summaries WHERE tournament_id = ?").run(tournamentId);
    repositories.sqlite.prepare("DELETE FROM events WHERE tournament_id = ?").run(tournamentId);
    repositories.sqlite.prepare("DELETE FROM llm_calls WHERE tournament_id = ? OR driver_model_id = ?").run(tournamentId, phase17CanonIds.driverModelId);
    repositories.sqlite.prepare("DELETE FROM artifacts WHERE tournament_id = ?").run(tournamentId);

    for (const mapId of mapIds) {
      repositories.sqlite.prepare("DELETE FROM economy_states WHERE map_game_id = ?").run(mapId);
      repositories.sqlite.prepare("DELETE FROM round_reports WHERE map_game_id = ?").run(mapId);
      repositories.sqlite.prepare("DELETE FROM rounds WHERE map_game_id = ?").run(mapId);
    }
    for (const matchId of matchIds) {
      repositories.sqlite.prepare("DELETE FROM map_games WHERE match_id = ?").run(matchId);
    }

    repositories.sqlite.prepare("DELETE FROM matches WHERE tournament_id = ?").run(tournamentId);
    repositories.sqlite.prepare("DELETE FROM agents WHERE team_id IN (SELECT id FROM teams WHERE tournament_id = ?) OR id LIKE 'agent_phase17_%'").run(tournamentId);
    repositories.sqlite.prepare("DELETE FROM teams WHERE tournament_id = ?").run(tournamentId);
    repositories.sqlite.prepare("DELETE FROM driver_models WHERE id = ?").run(phase17CanonIds.driverModelId);
    repositories.sqlite.prepare("DELETE FROM tournaments WHERE id = ?").run(tournamentId);
  });
}

function requireDriverModel(driverModelId: string) {
  const driverModel = defaultDriverModels.find((item) => item.id === driverModelId);
  if (!driverModel) {
    throw new Error(`Phase 1.8 web runner requires a known driver model id. Received: ${driverModelId}`);
  }

  return driverModel;
}

function readMapIdsByMatchIds(repositories: SqliteRepositoryBundle, matchIds: string[]): string[] {
  const placeholders = matchIds.map(() => "?").join(",");
  return (repositories.sqlite.prepare(`SELECT id FROM map_games WHERE match_id IN (${placeholders})`).all(...matchIds) as Array<{ id: string }>).map(
    (row) => row.id
  );
}

function fixtureMatchesSelectedMaps(
  maps: Array<{ mapName: string; order: number }>,
  selectedMapIds: string[]
): boolean {
  const orderedMapNames = [...maps].sort((left, right) => left.order - right.order).map((mapGame) => mapGame.mapName.toUpperCase());
  return orderedMapNames.length === selectedMapIds.length && orderedMapNames.every((mapName, index) => mapName === selectedMapIds[index]);
}

function buildPhase18MapSemantics(materials: ProcessedMaterials): Record<string, Record<string, unknown>> {
  const output: Record<string, Record<string, unknown>> = {};
  for (const map of materials.maps) {
    if (!map.proposition && !map.judgeRubric) {
      continue;
    }

    output[map.slug.toUpperCase()] = {
      ...(map.proposition
        ? {
            proposition: {
              mapTheme: map.proposition.mapTheme,
              coreQuestion: map.proposition.coreQuestion,
              attackFocus: map.proposition.attackFocus,
              defenseFocus: map.proposition.defenseFocus,
              regulationRoundThemes: map.proposition.regulationRoundThemes,
              overtimeRoundThemes: map.proposition.overtimeRoundThemes,
              coachWindows: map.proposition.coachWindows,
              displayZoneNames: map.proposition.displayZoneNames,
              frontendMinimumFields: map.proposition.frontendMinimumFields
            }
          }
        : {}),
      ...(map.judgeRubric
        ? {
            judgeRubric: {
              coreJudgmentAxis: map.judgeRubric.coreJudgmentAxis,
              coreQuestion: map.judgeRubric.coreQuestion,
              axes: map.judgeRubric.axes,
              roundJudgmentFlow: map.judgeRubric.roundJudgmentFlow,
              reasonMustCover: map.judgeRubric.reasonMustCover,
              biasGuardrails: map.judgeRubric.biasGuardrails,
              coachConsumptionWindows: map.judgeRubric.coachConsumptionWindows
            }
          }
        : {})
    };
  }

  return output;
}

function normalizePhase18SelectedMapIds(selectedMapIds: string[] | undefined): string[] {
  const mapIds = selectedMapIds && selectedMapIds.length > 0 ? selectedMapIds : [...phase20PrePilotMapIds];
  return mapIds.map((mapId) => mapId.trim().toUpperCase()).filter((mapId) => mapId.length > 0);
}
