import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPhase12SimulationEngine, phase11DemoIds, readMapReplay, seedPhase11Demo, type MapReplay } from "@agent-major/core";
import { createSqliteRepositories, defaultSqlitePath } from "@agent-major/db";
import { FakeProvider } from "@agent-major/llm";
import { UnconfiguredJobQueue } from "@agent-major/queue";

import { ensureDataDirectories } from "./data-init.js";

export type Phase12Command = "map" | "replay" | "export";

export interface Phase12CommandResult {
  command: Phase12Command;
  lines: string[];
  exportPath?: string;
}

export async function runPhase12Command(command: Phase12Command, projectRoot = findProjectRoot(process.cwd())): Promise<Phase12CommandResult> {
  ensureDataDirectories(projectRoot);
  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  try {
    const engine = createPhase12SimulationEngine({
      repositories,
      llmGateway: new FakeProvider({ providerId: "phase12-fake-provider" }),
      jobQueue: new UnconfiguredJobQueue()
    });

    if (command === "map") {
      await resetDemoFixture(repositories);
      await prepareDemo(engine, repositories);
      await engine.runCurrentMap({ mapGameId: phase11DemoIds.mapGameId });
    }

    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);
    if (!replay || replay.rounds.length === 0) {
      return {
        command,
        lines: ["No Phase 1.2 map replay found. Run `pnpm phase12:map` first."]
      };
    }

    if (command === "export") {
      const exportPath = exportMapReplay(projectRoot, replay);
      return {
        command,
        exportPath,
        lines: [...formatMapReplayLines(replay), `Exported JSON: ${exportPath}`]
      };
    }

    return {
      command,
      lines: formatMapReplayLines(replay)
    };
  } finally {
    repositories.close();
  }
}

async function prepareDemo(
  engine: ReturnType<typeof createPhase12SimulationEngine>,
  repositories: ReturnType<typeof createSqliteRepositories>
): Promise<void> {
  await seedPhase11Demo(repositories);
  await engine.startMatch({ matchId: phase11DemoIds.matchId });
  await engine.completeVeto({ matchId: phase11DemoIds.matchId, selectedMapIds: ["DUST2"] });
  await engine.startMap({ mapGameId: phase11DemoIds.mapGameId });
}

async function resetDemoFixture(repositories: ReturnType<typeof createSqliteRepositories>): Promise<void> {
  await repositories.transaction(async () => {
    const ids = phase11DemoIds;
    const teamAId = "team_ghost_nav";
    const teamBId = "team_ghost_fur";
    repositories.sqlite.prepare("DELETE FROM timeline_events WHERE tournament_id = ?").run(ids.tournamentId);
    repositories.sqlite.prepare("DELETE FROM summaries WHERE tournament_id = ? OR map_game_id = ?").run(ids.tournamentId, ids.mapGameId);
    repositories.sqlite.prepare("DELETE FROM events WHERE tournament_id = ?").run(ids.tournamentId);
    repositories.sqlite.prepare("DELETE FROM llm_calls WHERE tournament_id = ? OR driver_model_id = ?").run(ids.tournamentId, ids.driverModelId);
    repositories.sqlite.prepare("DELETE FROM artifacts WHERE tournament_id = ? OR map_game_id = ?").run(ids.tournamentId, ids.mapGameId);
    repositories.sqlite.prepare("DELETE FROM economy_states WHERE map_game_id = ?").run(ids.mapGameId);
    repositories.sqlite.prepare("DELETE FROM round_reports WHERE map_game_id = ?").run(ids.mapGameId);
    repositories.sqlite.prepare("DELETE FROM rounds WHERE map_game_id = ?").run(ids.mapGameId);
    repositories.sqlite.prepare("DELETE FROM map_games WHERE match_id = ?").run(ids.matchId);
    repositories.sqlite.prepare("DELETE FROM matches WHERE id = ?").run(ids.matchId);
    repositories.sqlite.prepare("DELETE FROM agents WHERE team_id IN (?, ?)").run(teamAId, teamBId);
    repositories.sqlite.prepare("DELETE FROM teams WHERE id IN (?, ?)").run(teamAId, teamBId);
    repositories.sqlite.prepare("DELETE FROM driver_models WHERE id = ?").run(ids.driverModelId);
    repositories.sqlite.prepare("DELETE FROM tournaments WHERE id = ?").run(ids.tournamentId);
  });
}

function formatMapReplayLines(replay: MapReplay): string[] {
  const overtimePlayed = replay.mapGame.currentRoundNumber > 12;
  const summaryPayload = replay.mapSummary?.payload as { mvpAgentId?: string; keyRounds?: Array<{ roundNumber: number }> } | undefined;
  return [
    `Map ${replay.mapGame.mapName} ${replay.mapGame.status} for ${replay.teams.teamA.displayName} vs ${replay.teams.teamB.displayName}.`,
    `Winner: ${replay.mapGame.winnerTeamId ?? "pending"}`,
    `Score: ${replay.mapGame.teamAScore}-${replay.mapGame.teamBScore}`,
    `Rounds: ${replay.mapGame.currentRoundNumber} | Overtime: ${overtimePlayed ? "yes" : "no"} | Summary: ${replay.mapGame.summaryId ?? "pending"}`,
    `Events: ${replay.eventCounts.map} | RoundEvents: ${replay.eventCounts.round} | TimelineEvents: ${replay.eventCounts.timeline}`,
    `MVP: ${summaryPayload?.mvpAgentId ?? "pending"}`,
    `Summary: ${replay.mapSummary?.content ?? "Map summary pending."}`,
    "Key rounds:",
    ...(summaryPayload?.keyRounds?.map((round) => `- Round ${round.roundNumber}`) ?? ["- pending"]),
    "Round ledger:",
    ...replay.rounds.map(
      (item) =>
        `- R${String(item.round.roundNumber).padStart(2, "0")} ${item.roundReport.winnerTeamId} ${item.roundReport.scoreAfterRound.teamA}-${item.roundReport.scoreAfterRound.teamB} events=${item.events.length} timeline=${item.timelineEvents.length}`
    )
  ];
}

function exportMapReplay(projectRoot: string, replay: MapReplay): string {
  const exportDirectory = resolve(projectRoot, "data", "exports", "maps");
  if (!existsSync(exportDirectory)) {
    mkdirSync(exportDirectory, { recursive: true });
  }

  const exportPath = resolve(exportDirectory, `${replay.match.id}_${replay.mapGame.id}.json`);
  writeFileSync(exportPath, `${JSON.stringify(replay, null, 2)}\n`, "utf8");
  return exportPath;
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv[2]);
  const result = await runPhase12Command(command);
  for (const line of result.lines) {
    console.log(line);
  }
}

function parseCommand(value: string | undefined): Phase12Command {
  if (value === "map" || value === "replay" || value === "export") {
    return value;
  }

  return "map";
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
