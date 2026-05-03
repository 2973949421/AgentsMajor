import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPhase16SimulationEngine, readMatchReplay, type MatchReplay } from "@agent-major/core";
import { createSqliteRepositories, defaultSqlitePath } from "@agent-major/db";
import { FakeProvider } from "@agent-major/llm";
import { phase17CanonIds, resolvePhase17ShowcaseSelection, seedPhase17ShowcaseMatch } from "@agent-major/materials";
import { UnconfiguredJobQueue } from "@agent-major/queue";

import { ensureDataDirectories } from "./data-init.js";
import { exportMatchReplay } from "./export-match-replay.js";

export type Phase17Command = "match" | "replay" | "export";

export interface Phase17CommandOptions {
  teamASlug?: string;
  teamBSlug?: string;
  selectedMapIds?: string[];
}

export interface Phase17CommandResult {
  command: Phase17Command;
  lines: string[];
  exportPath?: string;
}

export async function runPhase17Command(
  command: Phase17Command,
  projectRoot = findProjectRoot(process.cwd()),
  options: Phase17CommandOptions = {}
): Promise<Phase17CommandResult> {
  const { teamASlug, teamBSlug, selectedMapIds } = resolvePhase17ShowcaseSelection(options);
  ensureDataDirectories(projectRoot);
  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  try {
    const engine = createPhase16SimulationEngine({
      repositories,
      llmGateway: new FakeProvider({ providerId: "phase17-fake-provider" }),
      jobQueue: new UnconfiguredJobQueue()
    });

    if (command === "match") {
      await resetPhase17Fixture(repositories);
      const seed = await seedPhase17ShowcaseMatch({
        repositories,
        projectRoot,
        teamASlug,
        teamBSlug,
        selectedMapIds
      });
      await engine.runCurrentMatch({ matchId: seed.match.id, selectedMapIds: seed.selectedMapIds });
    }

    const matchId = buildPhase17MatchId(teamASlug, teamBSlug);
    const replay = await readMatchReplay(repositories, matchId);
    if (!replay || replay.maps.length === 0) {
      return {
        command,
        lines: [`No Phase 1.7 replay found for ${matchId}. Run \`pnpm phase17:match\` first.`]
      };
    }
    if (!isCompletedMatchReplay(replay)) {
      return {
        command,
        lines: [`Phase 1.7 replay ${matchId} is incomplete. Run \`pnpm phase17:match\` to complete the BO3 first.`]
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

async function resetPhase17Fixture(repositories: ReturnType<typeof createSqliteRepositories>): Promise<void> {
  await repositories.transaction(async () => {
    const tournamentId = phase17CanonIds.tournamentId;
    const matchRows = repositories.sqlite.prepare("SELECT id FROM matches WHERE tournament_id = ?").all(tournamentId) as Array<{ id: string }>;
    const matchIds = matchRows.map((row) => row.id);
    const mapIds = matchIds.length > 0 ? readIdsByMatchIds(repositories, matchIds) : [];

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

function readIdsByMatchIds(repositories: ReturnType<typeof createSqliteRepositories>, matchIds: string[]): string[] {
  const placeholders = matchIds.map(() => "?").join(",");
  return (repositories.sqlite.prepare(`SELECT id FROM map_games WHERE match_id IN (${placeholders})`).all(...matchIds) as Array<{ id: string }>).map(
    (row) => row.id
  );
}

function formatMatchReplayLines(replay: MatchReplay): string[] {
  const payload = replay.matchSummary?.payload as { mvpAgentId?: string; deciderMapId?: string } | undefined;
  const agents = Object.values(replay.agentsById);
  const importedAgents = agents.filter((agent) => agent.materialRef?.runtimeEnabled === false);
  const roleLedger = agents
    .map((agent) => `${agent.displayName}:${agent.role}${agent.aliases.length > 0 ? `(${agent.aliases.slice(0, 2).join("/")})` : ""}`)
    .join(", ");

  return [
    "Phase 1.7 materials runtime integration: enabled (fake-only, no real agent/judge LLM)",
    `Match ${replay.match.id} ${replay.match.status} for ${replay.teams.teamA.displayName} vs ${replay.teams.teamB.displayName}.`,
    `Winner: ${replay.match.winnerTeamId ?? "pending"}`,
    `Maps: ${replay.match.teamAMapsWon}-${replay.match.teamBMapsWon}`,
    `Completed maps: ${replay.maps.length} | Scheduled maps: ${replay.mapGames.length}`,
    `Events: ${replay.eventCounts.match} match | ${replay.eventCounts.map} map | ${replay.eventCounts.round} round | ${replay.eventCounts.timeline} timeline`,
    `Material agents: ${importedAgents.length}/${agents.length} imported with runtimeEnabled=false and fake-only driver assignment`,
    `Roles: ${roleLedger}`,
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
  const { command, options } = parseArgs(process.argv.slice(2));
  const result = await runPhase17Command(command, undefined, options);
  for (const line of result.lines) {
    console.log(line);
  }
}

function parseArgs(args: string[]): { command: Phase17Command; options: Phase17CommandOptions } {
  const command = parseCommand(args[0]);
  const options: Phase17CommandOptions = {};
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--team-a" && next) {
      options.teamASlug = next;
      index += 1;
    } else if (arg === "--team-b" && next) {
      options.teamBSlug = next;
      index += 1;
    } else if (arg === "--teams" && next) {
      const [teamASlug, teamBSlug] = next.split(",").map((item) => item.trim()).filter(Boolean);
      if (teamASlug) options.teamASlug = teamASlug;
      if (teamBSlug) options.teamBSlug = teamBSlug;
      index += 1;
    } else if (arg === "--maps" && next) {
      options.selectedMapIds = next.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
      index += 1;
    }
  }

  return { command, options };
}

function parseCommand(value: string | undefined): Phase17Command {
  if (value === "match" || value === "replay" || value === "export") {
    return value;
  }

  return "match";
}

function buildPhase17MatchId(teamASlug: string, teamBSlug: string): string {
  if (teamASlug === phase17CanonIds.teamASlug && teamBSlug === phase17CanonIds.teamBSlug) {
    return phase17CanonIds.matchId;
  }

  return `phase17_match_${slugId(teamASlug)}_vs_${slugId(teamBSlug)}`;
}

function slugId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
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
