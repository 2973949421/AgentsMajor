import { resolve } from "node:path";

import {
  createLlmCasterBroadcastGenerator,
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

import { loadRootLocalEnv } from "./server-local-env";
import { ServerLocalArtifactStore } from "./server-artifact-store";
import { findProjectRoot } from "./server-project-root";

export interface WebRunSingleMapResult {
  matchId: string;
  mapGameId: string;
  mapName: string;
  status: string;
  score: string;
  casterModes: Array<{
    mode: string | null;
    count: number;
  }>;
  llmCalls: {
    count: number;
    inputTokens: number | null;
    outputTokens: number | null;
  };
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
      casterModes: readCasterModes(repositories, map.id),
      llmCalls: readLlmCallStats(repositories, map.id)
    };
  } finally {
    repositories.close();
  }
}

function readCasterModes(repositories: SqliteRepositoryBundle, mapGameId: string): WebRunSingleMapResult["casterModes"] {
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

function readLlmCallStats(repositories: SqliteRepositoryBundle, mapGameId: string): WebRunSingleMapResult["llmCalls"] {
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
