import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createLlmCasterBroadcastGenerator,
  createPhase13SimulationEngine,
  phase11DemoIds,
  readMatchReplay,
  seedPhase11Demo,
  type MatchReplay
} from "@agent-major/core";
import { createSqliteRepositories, defaultSqlitePath } from "@agent-major/db";
import { DashScopeOpenAiProvider, defaultDriverModels, FakeProvider, loadAgentMajorLlmConfig } from "@agent-major/llm";
import { UnconfiguredJobQueue } from "@agent-major/queue";

import { ensureDataDirectories } from "./data-init.js";
import { loadLocalEnv, type EnvRecord } from "./local-env.js";
import { LocalArtifactStore } from "./local-artifact-store.js";

export type Phase15Command = "match" | "replay" | "export";

export interface Phase15CommandResult {
  command: Phase15Command;
  lines: string[];
  exportPath?: string;
}

const defaultPhase15Maps = ["DUST2", "INFERNO", "MIRAGE"];

export async function runPhase15Command(
  command: Phase15Command,
  projectRoot = findProjectRoot(process.cwd()),
  env: EnvRecord = process.env
): Promise<Phase15CommandResult> {
  ensureDataDirectories(projectRoot);
  const mergedEnv = loadLocalEnv(projectRoot, ".env.local", env);
  const llmConfig = loadAgentMajorLlmConfig(mergedEnv);
  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  try {
    const broadcastGenerator = llmConfig.enabled
      ? createLlmCasterBroadcastGenerator({
          llmGateway: new DashScopeOpenAiProvider({
            baseUrl: llmConfig.baseUrl ?? "",
            apiKey: llmConfig.apiKey ?? "",
            timeoutMs: llmConfig.timeoutMs,
            maxRetries: llmConfig.maxRetries
          }),
          driverModelId: llmConfig.casterDriverModelId,
          fallbackDriverModelId: llmConfig.casterFallbackDriverModelId,
          repositories,
          artifactStore: new LocalArtifactStore(projectRoot, repositories.artifacts)
        })
      : undefined;
    const engine = createPhase13SimulationEngine({
      repositories,
      llmGateway: new FakeProvider({ providerId: "phase15-fake-match-provider" }),
      jobQueue: new UnconfiguredJobQueue(),
      ...(broadcastGenerator ? { broadcastGenerator } : {})
    });

    if (command === "match") {
      await resetDemoFixture(repositories);
      await seedPhase11Demo(repositories);
      await seedPhase15DriverModels(repositories);
      await engine.runCurrentMatch({ matchId: phase11DemoIds.matchId, selectedMapIds: defaultPhase15Maps });
    }

    const replay = await readMatchReplay(repositories, phase11DemoIds.matchId);
    const llmStatusLine = formatLlmStatusLine(Boolean(broadcastGenerator), llmConfig.disabledReason);
    if (!replay || replay.maps.length === 0) {
      return {
        command,
        lines: [llmStatusLine, "No Phase 1.5 match replay found. Run `pnpm phase15:match` first."]
      };
    }
    if (!isCompletedMatchReplay(replay)) {
      return {
        command,
        lines: [llmStatusLine, "Phase 1.5 match replay is incomplete. Run `pnpm phase15:match` to complete the BO3 first."]
      };
    }

    const lines = [llmStatusLine, ...formatMatchReplayLines(replay)];
    if (command === "export") {
      const exportPath = exportMatchReplay(projectRoot, replay);
      return {
        command,
        exportPath,
        lines: [...lines, `Exported JSON: ${exportPath}`]
      };
    }

    return { command, lines };
  } finally {
    repositories.close();
  }
}

async function seedPhase15DriverModels(repositories: ReturnType<typeof createSqliteRepositories>): Promise<void> {
  for (const driverModel of defaultDriverModels) {
    await repositories.driverModels.save(driverModel);
  }
}

async function resetDemoFixture(repositories: ReturnType<typeof createSqliteRepositories>): Promise<void> {
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

function formatLlmStatusLine(enabled: boolean, disabledReason: string | undefined): string {
  return enabled ? "Phase 1.5 real caster LLM: enabled" : `Phase 1.5 real caster LLM: disabled (${disabledReason ?? "not_configured"})`;
}

function formatMatchReplayLines(replay: MatchReplay): string[] {
  const payload = replay.matchSummary?.payload as { mvpAgentId?: string; deciderMapId?: string } | undefined;
  return [
    `Match ${replay.match.id} ${replay.match.status} for ${replay.teams.teamA.displayName} vs ${replay.teams.teamB.displayName}.`,
    `Winner: ${replay.match.winnerTeamId ?? "pending"}`,
    `Maps: ${replay.match.teamAMapsWon}-${replay.match.teamBMapsWon}`,
    `Completed maps: ${replay.maps.length} | Scheduled maps: ${replay.mapGames.length}`,
    `Events: ${replay.eventCounts.match} match | ${replay.eventCounts.map} map | ${replay.eventCounts.round} round | ${replay.eventCounts.timeline} timeline`,
    `MVP: ${payload?.mvpAgentId ?? "pending"} | Decider: ${payload?.deciderMapId ?? "pending"}`,
    `Summary: ${replay.matchSummary?.content ?? "Match summary pending."}`,
    "Map ledger:",
    ...[...replay.mapGames]
      .sort((left, right) => left.order - right.order)
      .map(
        (mapGame) =>
          `- M${mapGame.order} ${mapGame.mapName} ${mapGame.status} winner=${mapGame.winnerTeamId ?? "pending"} score=${mapGame.teamAScore}-${mapGame.teamBScore}`
      )
  ];
}

function isCompletedMatchReplay(replay: MatchReplay): boolean {
  return replay.match.status === "completed" && replay.matchSummary !== null && replay.maps.length === replay.match.teamAMapsWon + replay.match.teamBMapsWon;
}

function exportMatchReplay(projectRoot: string, replay: MatchReplay): string {
  const exportDirectory = resolve(projectRoot, "data", "exports", "matches");
  if (!existsSync(exportDirectory)) {
    mkdirSync(exportDirectory, { recursive: true });
  }

  const exportPath = resolve(exportDirectory, `${replay.match.id}.json`);
  writeFileSync(exportPath, `${JSON.stringify(replay, null, 2)}\n`, "utf8");
  return exportPath;
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv[2]);
  const result = await runPhase15Command(command);
  for (const line of result.lines) {
    console.log(line);
  }
}

function parseCommand(value: string | undefined): Phase15Command {
  if (value === "match" || value === "replay" || value === "export") {
    return value;
  }

  return "match";
}

function findProjectRoot(startDirectory: string): string {
  let current = resolve(startDirectory);
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(resolve(current, "pnpm-workspace.yaml"))) {
      return current;
    }

    const parent = resolve(current, "..");
    if (parent === current) {
      return startDirectory;
    }
    current = parent;
  }

  return startDirectory;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
