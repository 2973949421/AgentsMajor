import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPhase18SimulationEngine, readMatchReplay, type MatchReplay } from "@agent-major/core";
import { createSqliteRepositories, defaultSqlitePath } from "@agent-major/db";
import { DashScopeOpenAiProvider, defaultDriverModels, loadAgentMajorLlmConfig } from "@agent-major/llm";
import { phase18CanonIds, seedPhase18ShowcaseMatch } from "@agent-major/materials";
import { UnconfiguredJobQueue } from "@agent-major/queue";

import { ensureDataDirectories } from "./data-init.js";
import { exportMatchReplay } from "./export-match-replay.js";
import { loadLocalEnv, type EnvRecord } from "./local-env.js";
import { LocalArtifactStore } from "./local-artifact-store.js";

export type Phase18Command = "round" | "map" | "match" | "replay" | "export";

export interface Phase18CommandResult {
  command: Phase18Command;
  lines: string[];
  exportPath?: string;
}

export async function runPhase18Command(
  command: Phase18Command,
  projectRoot = findProjectRoot(process.cwd()),
  env: EnvRecord = process.env
): Promise<Phase18CommandResult> {
  ensureDataDirectories(projectRoot);
  const mergedEnv = loadLocalEnv(projectRoot, ".env.local", env);
  const llmConfig = loadAgentMajorLlmConfig(mergedEnv);
  if (!llmConfig.enabled) {
    return {
      command,
      lines: [`Phase 1.8 real player/judge LLM: disabled (${llmConfig.disabledReason ?? "not_configured"})`]
    };
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
      artifactStore: new LocalArtifactStore(projectRoot, repositories.artifacts)
    });

    if (command === "round" || command === "map" || command === "match") {
      const seed = await ensureRunnablePhase18Fixture({
        repositories,
        projectRoot,
        driverModel,
        engine,
        resetCompleted: true,
        resetBeforeRun: false
      });
      if (command === "match") {
        await engine.runCurrentMatch({ matchId: seed.matchId, selectedMapIds: seed.selectedMapIds });
      } else {
        const mapGameId = await selectCurrentPhase18MapGameId(repositories);
        await engine.runCurrentMap({
          mapGameId,
          ...(command === "round" ? { mode: "debug", maxRounds: 1 } : {})
        });
      }
    }

    const replay = await readMatchReplay(repositories, phase18CanonIds.matchId);
    const llmStatusLine = `Phase 1.8 real player/judge LLM: enabled (${driverModel.id})`;
    if (!replay || replay.mapGames.length === 0) {
      return {
        command,
        lines: [llmStatusLine, "No Phase 1.8 match replay found. Run `pnpm phase18:round` or `pnpm phase18:match` first."]
      };
    }
    if (command === "export" && !isCompletedMatchReplay(replay)) {
      return {
        command,
        lines: [llmStatusLine, "Phase 1.8 match replay is incomplete. Run `pnpm phase18:match` to complete the BO3 before export."]
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

export async function ensureRunnablePhase18Fixture(input: {
  repositories: ReturnType<typeof createSqliteRepositories>;
  projectRoot: string;
  driverModel: ReturnType<typeof requireDriverModel>;
  engine: ReturnType<typeof createPhase18SimulationEngine>;
  resetCompleted: boolean;
  resetBeforeRun: boolean;
}): Promise<{ matchId: string; selectedMapIds: string[] }> {
  const existingMatch = await input.repositories.matches.getById(phase18CanonIds.matchId);
  if (input.resetBeforeRun || !existingMatch || (input.resetCompleted && existingMatch.status === "completed")) {
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

export async function selectCurrentPhase18MapGameId(repositories: ReturnType<typeof createSqliteRepositories>): Promise<string> {
  const match = await repositories.matches.getById(phase18CanonIds.matchId);
  if (!match) {
    throw new Error(`Phase 1.8 match not found: ${phase18CanonIds.matchId}`);
  }

  const nextMap = (await repositories.mapGames.listByMatch(match.id))
    .sort((left, right) => left.order - right.order)
    .find((mapGame) => mapGame.status !== "completed");
  if (!nextMap) {
    throw new Error("Phase 1.8 has no remaining map to run.");
  }

  return nextMap.id;
}

async function resetPhase18Fixture(repositories: ReturnType<typeof createSqliteRepositories>): Promise<void> {
  await repositories.transaction(async () => {
    const tournamentId = phase18CanonIds.tournamentId;
    const matchRows = repositories.sqlite.prepare("SELECT id FROM matches WHERE tournament_id = ?").all(tournamentId) as Array<{ id: string }>;
    const matchIds = matchRows.map((row) => row.id);
    const mapIds = matchIds.length > 0 ? readIdsByMatchIds(repositories, matchIds) : [];

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

function readIdsByMatchIds(repositories: ReturnType<typeof createSqliteRepositories>, matchIds: string[]): string[] {
  const placeholders = matchIds.map(() => "?").join(",");
  return (repositories.sqlite.prepare(`SELECT id FROM map_games WHERE match_id IN (${placeholders})`).all(...matchIds) as Array<{ id: string }>).map(
    (row) => row.id
  );
}

function requireDriverModel(driverModelId: string) {
  const driverModel = defaultDriverModels.find((item) => item.id === driverModelId);
  if (!driverModel) {
    throw new Error(`Phase 1.8 requires a known driver model id. Received: ${driverModelId}`);
  }

  return driverModel;
}

function formatMatchReplayLines(replay: MatchReplay): string[] {
  const payload = replay.matchSummary?.payload as { mvpAgentId?: string; deciderMapId?: string } | undefined;
  return [
    `Match ${replay.match.id} ${replay.match.status} for ${replay.teams.teamA.displayName} vs ${replay.teams.teamB.displayName}.`,
    `Winner: ${replay.match.winnerTeamId ?? "pending"}`,
    `Maps: ${replay.match.teamAMapsWon}-${replay.match.teamBMapsWon}`,
    `Replay-ready maps: ${replay.maps.length} | Scheduled maps: ${replay.mapGames.length}`,
    `Events: ${replay.eventCounts.match} match | ${replay.eventCounts.map} map | ${replay.eventCounts.round} round | ${replay.eventCounts.timeline} timeline`,
    `MVP: ${payload?.mvpAgentId ?? "pending"} | Decider: ${payload?.deciderMapId ?? "pending"}`,
    `Summary: ${replay.matchSummary?.content ?? "Match summary pending."}`,
    "Map ledger:",
    ...[...replay.mapGames]
      .sort((left, right) => left.order - right.order)
      .map(
        (mapGame) =>
          `- M${mapGame.order} ${mapGame.mapName} ${mapGame.status} R${mapGame.currentRoundNumber} winner=${mapGame.winnerTeamId ?? "pending"} score=${mapGame.teamAScore}-${mapGame.teamBScore}`
      )
  ];
}

function isCompletedMatchReplay(replay: MatchReplay): boolean {
  return replay.match.status === "completed" && replay.matchSummary !== null && replay.maps.length === replay.match.teamAMapsWon + replay.match.teamBMapsWon;
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv[2]);
  const result = await runPhase18Command(command);
  for (const line of result.lines) {
    console.log(line);
  }
}

function parseCommand(value: string | undefined): Phase18Command {
  if (value === "round" || value === "map" || value === "match" || value === "replay" || value === "export") {
    return value;
  }

  return "round";
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
