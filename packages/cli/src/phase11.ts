import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPhase11SimulationEngine, phase11DemoIds, seedPhase11Demo } from "@agent-major/core";
import { createSqliteRepositories, defaultSqlitePath } from "@agent-major/db";
import { FakeProvider } from "@agent-major/llm";
import { UnconfiguredJobQueue } from "@agent-major/queue";

import { ensureDataDirectories } from "./data-init.js";

export type Phase11Command = "demo" | "round" | "replay" | "export";

export interface Phase11CommandResult {
  command: Phase11Command;
  lines: string[];
  exportPath?: string;
}

export async function runPhase11Command(command: Phase11Command, projectRoot = findProjectRoot(process.cwd())): Promise<Phase11CommandResult> {
  ensureDataDirectories(projectRoot);
  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  const engine = createPhase11SimulationEngine({
    repositories,
    llmGateway: new FakeProvider({ providerId: "phase11-fake-provider" }),
    jobQueue: new UnconfiguredJobQueue()
  });

  if (command === "demo") {
    const seeded = await seedPhase11Demo(repositories);
    await engine.startMatch({ matchId: seeded.match.id });
    await engine.completeVeto({ matchId: seeded.match.id, selectedMapIds: ["DUST2"] });
    await engine.startMap({ mapGameId: phase11DemoIds.mapGameId });
    return {
      command,
      lines: [
        "Phase 1.1 demo initialized.",
        `Tournament: ${seeded.tournament.id}`,
        `Match: ${seeded.match.id}`,
        `MapGame: ${phase11DemoIds.mapGameId}`,
        `Teams: ${seeded.teams.map((team) => team.displayName).join(" vs ")}`,
        `Agents: ${seeded.agents.length}`
      ]
    };
  }

  if (command === "round") {
    await prepareDemo(engine, repositories);
    const round = await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readRoundReplay(repositories, round.id);
    return {
      command,
      lines: formatReplayLines(replay)
    };
  }

  const latestRound = await getLatestCompletedRound(repositories);
  if (!latestRound) {
    return {
      command,
      lines: ["No completed Phase 1.1 round found. Run `pnpm phase11:round` first."]
    };
  }

  const replay = await readRoundReplay(repositories, latestRound.id);
  if (command === "replay") {
    return {
      command,
      lines: formatReplayLines(replay)
    };
  }

  const exportPath = exportReplay(projectRoot, replay);
  return {
    command,
    exportPath,
    lines: [...formatReplayLines(replay), `Exported JSON: ${exportPath}`]
  };
}

async function prepareDemo(
  engine: ReturnType<typeof createPhase11SimulationEngine>,
  repositories: ReturnType<typeof createSqliteRepositories>
): Promise<void> {
  await seedPhase11Demo(repositories);
  await engine.startMatch({ matchId: phase11DemoIds.matchId });
  await engine.completeVeto({ matchId: phase11DemoIds.matchId, selectedMapIds: ["DUST2"] });
  await engine.startMap({ mapGameId: phase11DemoIds.mapGameId });
}

async function getLatestCompletedRound(repositories: ReturnType<typeof createSqliteRepositories>) {
  const rounds = await repositories.rounds.listByMapGame(phase11DemoIds.mapGameId);
  return rounds.filter((round) => round.status === "completed").at(-1) ?? null;
}

async function readRoundReplay(repositories: ReturnType<typeof createSqliteRepositories>, roundId: string) {
  const round = await required(repositories.rounds.getById(roundId), `Round not found: ${roundId}`);
  const mapGame = await required(repositories.mapGames.getById(round.mapGameId), `MapGame not found: ${round.mapGameId}`);
  const match = await required(repositories.matches.getById(mapGame.matchId), `Match not found: ${mapGame.matchId}`);
  const roundReport = await required(repositories.roundReports.getByRoundId(round.id), `RoundReport not found for round: ${round.id}`);
  const events = await repositories.events.listByRound(round.id);
  const timelineEvents = await repositories.timelineEvents.listByRound(round.id);
  const economyStates = await repositories.economyStates.listByRound(round.id);
  return { match, mapGame, round, roundReport, events, timelineEvents, economyStates };
}

function formatReplayLines(replay: Awaited<ReturnType<typeof readRoundReplay>>): string[] {
  return [
    `Round ${replay.round.roundNumber} completed on ${replay.mapGame.mapName}.`,
    `Winner: ${replay.roundReport.winnerTeamId}`,
    `Score: ${replay.roundReport.scoreAfterRound.teamA}-${replay.roundReport.scoreAfterRound.teamB}`,
    `Summary: ${replay.roundReport.summary}`,
    `Events: ${replay.events.length} | TimelineEvents: ${replay.timelineEvents.length} | EconomyStates: ${replay.economyStates.length}`,
    "Key events:",
    ...replay.roundReport.keyEvents.map((event) => `- ${event.type} ${event.zoneId}: ${event.impact}`),
    "Timeline:",
    ...replay.timelineEvents.map((event) => `- ${String(event.atMs).padStart(5, " ")}ms ${event.kind} <- ${event.sourceEventIds.join(",")}`)
  ];
}

function exportReplay(projectRoot: string, replay: Awaited<ReturnType<typeof readRoundReplay>>): string {
  const exportDirectory = resolve(projectRoot, "data", "exports", "matches");
  if (!existsSync(exportDirectory)) {
    mkdirSync(exportDirectory, { recursive: true });
  }

  const exportPath = resolve(exportDirectory, `${replay.match.id}_${replay.round.id}.json`);
  writeFileSync(exportPath, `${JSON.stringify(replay, null, 2)}\n`, "utf8");
  return exportPath;
}

async function required<T>(promise: Promise<T | null>, message: string): Promise<T> {
  const value = await promise;
  if (!value) {
    throw new Error(message);
  }

  return value;
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv[2]);
  const result = await runPhase11Command(command);
  for (const line of result.lines) {
    console.log(line);
  }
}

function parseCommand(value: string | undefined): Phase11Command {
  if (value === "demo" || value === "round" || value === "replay" || value === "export") {
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
