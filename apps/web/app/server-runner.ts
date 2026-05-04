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
import { phase17CanonIds, phase18CanonIds, seedPhase17ShowcaseMatch, seedPhase18ShowcaseMatch } from "@agent-major/materials";

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

export async function runPhase18NextRoundFromWeb(matchId: string): Promise<WebRunSingleMapResult> {
  if (matchId !== phase18CanonIds.matchId) {
    throw new Error(`Phase 1.8 web runner only supports the pilot match: ${phase18CanonIds.matchId}`);
  }

  return runPhase18FromWeb(matchId, "round");
}

export async function runPhase18CurrentMapFromWeb(matchId: string): Promise<WebRunSingleMapResult> {
  if (matchId !== phase18CanonIds.matchId) {
    throw new Error(`Phase 1.8 web runner only supports the pilot match: ${phase18CanonIds.matchId}`);
  }

  return runPhase18FromWeb(matchId, "map");
}

export async function runPhase18FullBo3FromWeb(matchId: string): Promise<WebRunSingleMapResult> {
  if (matchId !== phase18CanonIds.matchId) {
    throw new Error(`Phase 1.8 web runner only supports the pilot match: ${phase18CanonIds.matchId}`);
  }

  return runPhase18FromWeb(matchId, "match");
}

export async function runPhase18ShowcaseFromWeb(matchId: string): Promise<WebRunSingleMapResult> {
  return runPhase18FullBo3FromWeb(matchId);
}

async function runPhase18FromWeb(matchId: string, scope: "round" | "map" | "match"): Promise<WebRunSingleMapResult> {
  const projectRoot = findProjectRoot(process.cwd());
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
      artifactStore: new ServerLocalArtifactStore(projectRoot, repositories.artifacts)
    });

    const seed = await ensurePhase18Fixture({ repositories, projectRoot, driverModel, engine });
    if (scope === "match") {
      const result = await engine.runCurrentMatch({ matchId: seed.matchId, selectedMapIds: seed.selectedMapIds });
      return toWebRunResult(repositories, result.match.id, result.match.status, result.match.teamAMapsWon, result.match.teamBMapsWon, result.mapGames);
    }

    const mapGameId = await selectCurrentPhase18MapGameId(repositories, matchId);
    await engine.runCurrentMap({
      mapGameId,
      ...(scope === "round" ? { mode: "debug", maxRounds: 1 } : {})
    });
    return await toWebRunResultFromMatch(repositories, matchId);
  } finally {
    repositories.close();
  }
}

async function ensurePhase18Fixture(input: {
  repositories: SqliteRepositoryBundle;
  projectRoot: string;
  driverModel: ReturnType<typeof requireDriverModel>;
  engine: ReturnType<typeof createPhase18SimulationEngine>;
}): Promise<{ matchId: string; selectedMapIds: string[] }> {
  const existingMatch = await input.repositories.matches.getById(phase18CanonIds.matchId);
  if (!existingMatch || existingMatch.status === "completed") {
    await resetPhase18Fixture(input.repositories);
    const seed = await seedPhase18ShowcaseMatch({
      repositories: input.repositories,
      projectRoot: input.projectRoot,
      driverModel: input.driverModel
    });
    await input.engine.startMatch({ matchId: seed.match.id });
    await input.engine.completeVeto({ matchId: seed.match.id, selectedMapIds: seed.selectedMapIds });
    return { matchId: seed.match.id, selectedMapIds: seed.selectedMapIds };
  }

  const existingMaps = await input.repositories.mapGames.listByMatch(existingMatch.id);
  if (existingMatch.status !== "running" || existingMaps.length === 0) {
    await input.engine.startMatch({ matchId: existingMatch.id });
    await input.engine.completeVeto({ matchId: existingMatch.id, selectedMapIds: [...phase18CanonIds.selectedMapIds] });
  }

  return { matchId: existingMatch.id, selectedMapIds: [...phase18CanonIds.selectedMapIds] };
}

async function selectCurrentPhase18MapGameId(repositories: SqliteRepositoryBundle, matchId: string): Promise<string> {
  const mapGame = (await repositories.mapGames.listByMatch(matchId))
    .sort((left, right) => left.order - right.order)
    .find((item) => item.status !== "completed");
  if (!mapGame) {
    throw new Error("Phase 1.8 has no remaining map to run.");
  }

  return mapGame.id;
}

async function toWebRunResultFromMatch(repositories: SqliteRepositoryBundle, matchId: string): Promise<WebRunSingleMapResult> {
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

async function resetPhase18Fixture(repositories: SqliteRepositoryBundle): Promise<void> {
  await repositories.transaction(async () => {
    const tournamentId = phase18CanonIds.tournamentId;
    const matchRows = repositories.sqlite.prepare("SELECT id FROM matches WHERE tournament_id = ?").all(tournamentId) as Array<{ id: string }>;
    const matchIds = matchRows.map((row) => row.id);
    const mapIds = matchIds.length > 0 ? readMapIdsByMatchIds(repositories, matchIds) : [];

    repositories.sqlite.prepare("DELETE FROM timeline_events WHERE tournament_id = ?").run(tournamentId);
    repositories.sqlite.prepare("DELETE FROM summaries WHERE tournament_id = ?").run(tournamentId);
    repositories.sqlite.prepare("DELETE FROM events WHERE tournament_id = ?").run(tournamentId);
    repositories.sqlite.prepare("DELETE FROM llm_calls WHERE tournament_id = ?").run(tournamentId);
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
    repositories.sqlite.prepare("DELETE FROM agents WHERE team_id IN (SELECT id FROM teams WHERE tournament_id = ?)").run(tournamentId);
    repositories.sqlite.prepare("DELETE FROM teams WHERE tournament_id = ?").run(tournamentId);
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
