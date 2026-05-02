import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPhase16SimulationEngine, phase11DemoIds, readMatchReplay, seedPhase11Demo, type MatchReplay } from "@agent-major/core";
import { createSqliteRepositories, defaultSqlitePath } from "@agent-major/db";
import { FakeProvider } from "@agent-major/llm";
import { UnconfiguredJobQueue } from "@agent-major/queue";

import { ensureDataDirectories } from "./data-init.js";
import { exportMatchReplay } from "./export-match-replay.js";

export type Phase16Command = "match" | "replay" | "export";

export interface Phase16CommandResult {
  command: Phase16Command;
  lines: string[];
  exportPath?: string;
}

const defaultPhase16Maps = ["DUST2", "INFERNO", "MIRAGE"];

export async function runPhase16Command(command: Phase16Command, projectRoot = findProjectRoot(process.cwd())): Promise<Phase16CommandResult> {
  ensureDataDirectories(projectRoot);
  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  try {
    const engine = createPhase16SimulationEngine({
      repositories,
      llmGateway: new FakeProvider({ providerId: "phase16-fake-provider" }),
      jobQueue: new UnconfiguredJobQueue()
    });

    if (command === "match") {
      await resetDemoFixture(repositories);
      await seedPhase11Demo(repositories);
      await engine.runCurrentMatch({ matchId: phase11DemoIds.matchId, selectedMapIds: defaultPhase16Maps });
    }

    const replay = await readMatchReplay(repositories, phase11DemoIds.matchId);
    if (!replay || replay.maps.length === 0) {
      return {
        command,
        lines: ["No Phase 1.6 match replay found. Run `pnpm phase16:match` first."]
      };
    }
    if (!isCompletedMatchReplay(replay)) {
      return {
        command,
        lines: ["Phase 1.6 match replay is incomplete. Run `pnpm phase16:match` to complete the BO3 first."]
      };
    }

    if (command === "export") {
      const exportPath = exportMatchReplay(projectRoot, replay);
      return {
        command,
        exportPath,
        lines: [...formatMatchReplayLines(replay), `Exported JSON: ${exportPath}`]
      };
    }

    return {
      command,
      lines: formatMatchReplayLines(replay)
    };
  } finally {
    repositories.close();
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

function formatMatchReplayLines(replay: MatchReplay): string[] {
  const payload = replay.matchSummary?.payload as { mvpAgentId?: string; deciderMapId?: string } | undefined;
  const tacticalRoundCount = replay.maps.reduce(
    (sum, mapReplay) => sum + mapReplay.rounds.filter((roundReplay) => Boolean(roundReplay.roundReport.tacticalContext)).length,
    0
  );
  const completedRoundCount = replay.maps.reduce((sum, mapReplay) => sum + mapReplay.rounds.length, 0);
  const siteExecuteCount = replay.maps.reduce(
    (sum, mapReplay) => sum + mapReplay.rounds.reduce((roundSum, roundReplay) => roundSum + roundReplay.events.filter((event) => event.type === "site_execute_resolved").length, 0),
    0
  );
  return [
    "Phase 1.6 tactical protocol: enabled (rule, deterministic, fake-only)",
    `Match ${replay.match.id} ${replay.match.status} for ${replay.teams.teamA.displayName} vs ${replay.teams.teamB.displayName}.`,
    `Winner: ${replay.match.winnerTeamId ?? "pending"}`,
    `Maps: ${replay.match.teamAMapsWon}-${replay.match.teamBMapsWon}`,
    `Completed maps: ${replay.maps.length} | Scheduled maps: ${replay.mapGames.length}`,
    `Events: ${replay.eventCounts.match} match | ${replay.eventCounts.map} map | ${replay.eventCounts.round} round | ${replay.eventCounts.timeline} timeline`,
    `Tactical rounds: ${tacticalRoundCount}/${completedRoundCount} | Site executes: ${siteExecuteCount}`,
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

async function main(): Promise<void> {
  const command = parseCommand(process.argv[2]);
  const result = await runPhase16Command(command);
  for (const line of result.lines) {
    console.log(line);
  }
}

function parseCommand(value: string | undefined): Phase16Command {
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
