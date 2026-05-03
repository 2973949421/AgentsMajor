import { resolve } from "node:path";

import {
  createLlmCasterBroadcastGenerator,
  createPhase16SimulationEngine,
  createPhase13SimulationEngine,
  DashScopeOpenAiProvider,
  defaultDriverModels,
  FakeProvider,
  loadAgentMajorLlmConfig,
  phase11DemoIds,
  seedPhase11Demo,
  UnconfiguredJobQueue
} from "@agent-major/core";
import { createSqliteRepositories, defaultSqlitePath, type SqliteRepositoryBundle } from "@agent-major/db";
import { phase17CanonIds, seedPhase17ShowcaseMatch } from "@agent-major/materials";

import { loadRootLocalEnv } from "./server-local-env";
import { ServerLocalArtifactStore } from "./server-artifact-store";
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
    const completedMatch = result.match;
    const mapGames = [...result.mapGames].sort((left, right) => left.order - right.order);
    const firstMap = mapGames[0];
    if (!firstMap) {
      throw new Error("Phase 1.7 showcase generated no maps.");
    }

    return {
      matchId: completedMatch.id,
      mapGameId: firstMap.id,
      mapGameIds: mapGames.map((mapGame) => mapGame.id),
      mapName: firstMap.mapName,
      mapNames: mapGames.map((mapGame) => mapGame.mapName),
      status: completedMatch.status,
      score: `${completedMatch.teamAMapsWon}-${completedMatch.teamBMapsWon}`,
      casterModes: readCasterModes(repositories, mapGames.map((mapGame) => mapGame.id))
    };
  } finally {
    repositories.close();
  }
}

export async function runPhase15SingleMapFromWeb(matchId: string): Promise<WebRunSingleMapResult> {
  if (matchId !== phase11DemoIds.matchId) {
    throw new Error(`Web runner only supports the local demo match: ${phase11DemoIds.matchId}`);
  }

  const projectRoot = findProjectRoot(process.cwd());
  const llmConfig = loadAgentMajorLlmConfig(loadRootLocalEnv(projectRoot));
  if (!llmConfig.enabled) {
    throw new Error(`Real LLM disabled: ${llmConfig.disabledReason ?? "not_configured"}`);
  }

  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  try {
    await resetDemoFixture(repositories);
    await seedPhase11Demo(repositories);
    for (const driverModel of defaultDriverModels) {
      await repositories.driverModels.save(driverModel);
    }

    const broadcastGenerator = createLlmCasterBroadcastGenerator({
      llmGateway: new DashScopeOpenAiProvider({
        baseUrl: llmConfig.baseUrl ?? "",
        apiKey: llmConfig.apiKey ?? "",
        timeoutMs: llmConfig.timeoutMs,
        maxRetries: llmConfig.maxRetries
      }),
      driverModelId: llmConfig.casterDriverModelId,
      fallbackDriverModelId: llmConfig.casterFallbackDriverModelId,
      repositories,
      artifactStore: new ServerLocalArtifactStore(projectRoot, repositories.artifacts)
    });

    const engine = createPhase13SimulationEngine({
      repositories,
      llmGateway: new FakeProvider({ providerId: "phase15-web-fake-match-provider" }),
      jobQueue: new UnconfiguredJobQueue(),
      broadcastGenerator
    });

    await engine.startMatch({ matchId: phase11DemoIds.matchId });
    await engine.completeVeto({ matchId: phase11DemoIds.matchId, selectedMapIds: ["DUST2"] });
    await engine.startMap({ mapGameId: phase11DemoIds.mapGameId });
    await engine.runCurrentMap({ mapGameId: phase11DemoIds.mapGameId });

    const map = await repositories.mapGames.getById(phase11DemoIds.mapGameId);
    if (!map) {
      throw new Error(`Generated map not found: ${phase11DemoIds.mapGameId}`);
    }

    return {
      matchId: phase11DemoIds.matchId,
      mapGameId: map.id,
      mapName: map.mapName,
      status: map.status,
      score: `${map.teamAScore}-${map.teamBScore}`,
      casterModes: readCasterModes(repositories, [map.id])
    };
  } finally {
    repositories.close();
  }
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

function readMapIdsByMatchIds(repositories: SqliteRepositoryBundle, matchIds: string[]): string[] {
  const placeholders = matchIds.map(() => "?").join(",");
  return (repositories.sqlite.prepare(`SELECT id FROM map_games WHERE match_id IN (${placeholders})`).all(...matchIds) as Array<{ id: string }>).map(
    (row) => row.id
  );
}

async function resetDemoFixture(repositories: SqliteRepositoryBundle): Promise<void> {
  await repositories.transaction(async () => {
    const ids = phase11DemoIds;
    const teamAId = "team_ghost_nav";
    const teamBId = "team_ghost_fur";
    const mapRows = repositories.sqlite.prepare("SELECT id FROM map_games WHERE match_id = ?").all(ids.matchId) as Array<{ id: string }>;
    const mapIds = mapRows.map((row) => row.id);

    repositories.sqlite.prepare("DELETE FROM timeline_events WHERE tournament_id = ?").run(ids.tournamentId);
    repositories.sqlite.prepare("DELETE FROM summaries WHERE tournament_id = ? OR match_id = ?").run(ids.tournamentId, ids.matchId);
    repositories.sqlite.prepare("DELETE FROM events WHERE tournament_id = ?").run(ids.tournamentId);
    repositories.sqlite.prepare("DELETE FROM llm_calls WHERE tournament_id = ? OR driver_model_id = ?").run(ids.tournamentId, ids.driverModelId);
    repositories.sqlite.prepare("DELETE FROM artifacts WHERE tournament_id = ? OR match_id = ?").run(ids.tournamentId, ids.matchId);

    for (const mapId of mapIds) {
      repositories.sqlite.prepare("DELETE FROM economy_states WHERE map_game_id = ?").run(mapId);
      repositories.sqlite.prepare("DELETE FROM round_reports WHERE map_game_id = ?").run(mapId);
      repositories.sqlite.prepare("DELETE FROM rounds WHERE map_game_id = ?").run(mapId);
    }

    repositories.sqlite.prepare("DELETE FROM map_games WHERE match_id = ?").run(ids.matchId);
    repositories.sqlite.prepare("DELETE FROM matches WHERE id = ?").run(ids.matchId);
    repositories.sqlite.prepare("DELETE FROM agents WHERE team_id IN (?, ?)").run(teamAId, teamBId);
    repositories.sqlite.prepare("DELETE FROM teams WHERE id IN (?, ?)").run(teamAId, teamBId);
    repositories.sqlite.prepare("DELETE FROM driver_models WHERE id = ?").run(ids.driverModelId);
    repositories.sqlite.prepare("DELETE FROM tournaments WHERE id = ?").run(ids.tournamentId);
  });
}
