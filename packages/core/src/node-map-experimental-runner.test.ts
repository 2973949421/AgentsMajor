import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { ArtifactRepository, SqliteRepositoryBundle } from "@agent-major/db";
import { createSqliteRepositories } from "@agent-major/db";
import type { Agent, Artifact } from "@agent-major/shared";
import { afterEach, describe, expect, it } from "vitest";

import { runDust2NodeMapExperimental } from "./node-map-experimental-runner.js";
import type { ArtifactStore, ArtifactWriteInput } from "./ports.js";

describe("node map experimental runner", () => {
  const repositoriesToClose: SqliteRepositoryBundle[] = [];

  afterEach(() => {
    for (const repositories of repositoriesToClose.splice(0)) {
      repositories.close();
    }
  });

  it("commits a Dust2 node map to completion through the N15 round committer", async () => {
    const repositories = createFixtureRepositories();
    const artifactStore = new MemoryArtifactStore(repositories.artifacts);
    await seedFixture(repositories);

    const result = await runDust2NodeMapExperimental({
      repositories,
      artifactStore,
      mapGameId: "map_dust2",
      enableMapExperimentalMode: true
    });

    expect(result.mapGame.status).toBe("completed");
    expect(result.roundsCommitted).toBeGreaterThan(0);
    expect(result.roundsCommitted).toBeLessThanOrEqual(40);
    expect(result.summary.source).toBe("node_round_engine_map_experimental");
    expect(result.summary.writesDb).toBe(true);
    expect(result.summary.replacesLegacyRoundPath).toBe(false);
    expect(result.summary.roundTraceArtifactIds).toHaveLength(result.roundsCommitted);
    expect(result.summary.finalScore.teamA + result.summary.finalScore.teamB).toBe(result.roundsCommitted);

    const reportRows = repositories.sqlite
      .prepare("SELECT node_trace_artifact_id AS nodeTraceArtifactId, node_trace_source AS nodeTraceSource FROM round_reports WHERE map_game_id = ?")
      .all("map_dust2") as Array<{ nodeTraceArtifactId?: unknown; nodeTraceSource?: unknown }>;
    expect(reportRows).toHaveLength(result.roundsCommitted);
    expect(reportRows.every((row) => typeof row.nodeTraceArtifactId === "string" && row.nodeTraceSource === "node_round_engine_committed")).toBe(true);

    const economyRow = repositories.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_states WHERE map_game_id = ?").get("map_dust2") as {
      count?: unknown;
    };
    expect(economyRow.count).toBe(result.roundsCommitted * 10);

    const summaryText = await artifactStore.readText(result.summaryArtifact.id);
    expect(summaryText).toContain("node_round_engine_map_experimental");
    expect(result.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "node_map_experimental_started",
        "node_map_experimental_round_committed",
        "node_map_experimental_summary_created",
        "node_map_experimental_completed"
      ])
    );
  });

  it("rejects already completed maps", async () => {
    const repositories = createFixtureRepositories();
    await seedFixture(repositories, { mapStatus: "completed", teamAScore: 7, currentRoundNumber: 7 });

    await expect(
      runDust2NodeMapExperimental({
        repositories,
        artifactStore: new MemoryArtifactStore(repositories.artifacts),
        mapGameId: "map_dust2",
        enableMapExperimentalMode: true
      })
    ).rejects.toThrow(/completed map/);
  });

  it("fails clearly when maxRounds is reached without packaging the map as completed", async () => {
    const repositories = createFixtureRepositories();
    await seedFixture(repositories);

    await expect(
      runDust2NodeMapExperimental({
        repositories,
        artifactStore: new MemoryArtifactStore(repositories.artifacts),
        mapGameId: "map_dust2",
        enableMapExperimentalMode: true,
        maxRounds: 1
      })
    ).rejects.toThrow(/node_map_max_rounds_exceeded/);

    const storedMap = await repositories.mapGames.getById("map_dust2");
    const countRow = repositories.sqlite.prepare("SELECT COUNT(*) AS count FROM round_reports WHERE map_game_id = ?").get("map_dust2") as { count?: unknown };
    expect(storedMap?.status).not.toBe("completed");
    expect(countRow.count).toBe(1);
  });

  it("does not commit a half round when the N15 committer fails before writing facts", async () => {
    const repositories = createFixtureRepositories();
    await seedFixture(repositories);

    await expect(
      runDust2NodeMapExperimental({
        repositories,
        artifactStore: new MemoryArtifactStore(repositories.artifacts),
        mapGameId: "map_dust2",
        enableMapExperimentalMode: true,
        commitRound: async () => {
          throw new Error("Node experimental round did not produce a hard final win condition; no round facts were committed.");
        }
      })
    ).rejects.toThrow(/hard final win condition/);

    const countRow = repositories.sqlite.prepare("SELECT COUNT(*) AS count FROM round_reports WHERE map_game_id = ?").get("map_dust2") as { count?: unknown };
    expect(countRow.count).toBe(0);
    const failedEvents = repositories.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'node_map_experimental_failed'").get() as { count?: unknown };
    expect(failedEvents.count).toBe(1);
  });

  function createFixtureRepositories() {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "agent-major-node-map-"));
    const repositories = createSqliteRepositories(resolve(tempRoot, "agent-major.sqlite"));
    repositoriesToClose.push(repositories);
    return repositories;
  }
});

class MemoryArtifactStore implements ArtifactStore {
  private counter = 0;
  private readonly contents = new Map<string, string>();

  constructor(private readonly artifacts: ArtifactRepository) {}

  async write(input: ArtifactWriteInput): Promise<Artifact> {
    this.counter += 1;
    const content = typeof input.content === "string" ? input.content : Buffer.from(input.content).toString("utf8");
    const artifact: Artifact = {
      id: `art_node_map_${this.counter}`,
      artifactType: input.artifactType,
      ...(input.tournamentId ? { tournamentId: input.tournamentId } : {}),
      ...(input.matchId ? { matchId: input.matchId } : {}),
      ...(input.mapGameId ? { mapGameId: input.mapGameId } : {}),
      ...(input.roundId ? { roundId: input.roundId } : {}),
      ...(input.agentId ? { agentId: input.agentId } : {}),
      uri: `memory:${input.relativePath}`,
      mimeType: "application/json",
      sizeBytes: Buffer.byteLength(content, "utf8"),
      status: "ready",
      ...(input.sourceEventIds ? { sourceEventIds: input.sourceEventIds } : {}),
      createdAt: "2026-05-01T00:00:00.000Z"
    };
    this.contents.set(artifact.id, content);
    await this.artifacts.save(artifact);
    return artifact;
  }

  async readText(artifactId: string): Promise<string> {
    const content = this.contents.get(artifactId);
    if (content === undefined) {
      throw new Error(`Missing artifact ${artifactId}`);
    }
    return content;
  }
}

async function seedFixture(
  repositories: SqliteRepositoryBundle,
  options: { mapStatus?: "scheduled" | "running" | "completed"; teamAScore?: number; teamBScore?: number; currentRoundNumber?: number } = {}
): Promise<void> {
  const createdAt = "2026-05-01T00:00:00.000Z";
  await repositories.tournaments.save({
    id: "tournament_node",
    name: "Node Tournament",
    status: "running",
    format: "single_elimination_16",
    createdAt,
    startedAt: createdAt
  });
  await repositories.driverModels.save({
    id: "driver_node",
    provider: "fixture",
    modelName: "fixture-node",
    capabilities: ["structured_json"],
    enabled: true,
    createdAt
  });
  await repositories.teams.save({
    id: "team_a",
    tournamentId: "tournament_node",
    displayName: "Falcon",
    shortName: "FAL",
    seed: 1,
    createdAt
  });
  await repositories.teams.save({
    id: "team_b",
    tournamentId: "tournament_node",
    displayName: "Vitallmty",
    shortName: "VIT",
    seed: 2,
    createdAt
  });
  await repositories.matches.save({
    id: "match_node",
    tournamentId: "tournament_node",
    roundName: "final",
    teamAId: "team_a",
    teamBId: "team_b",
    status: "running",
    bestOf: 3,
    teamAMapsWon: 0,
    teamBMapsWon: 0,
    scheduledOrder: 1,
    createdAt,
    startedAt: createdAt
  });
  await repositories.mapGames.save({
    id: "map_dust2",
    matchId: "match_node",
    mapName: "Dust2",
    order: 1,
    status: options.mapStatus ?? "running",
    runControlState: "idle",
    teamAScore: options.teamAScore ?? 0,
    teamBScore: options.teamBScore ?? 0,
    currentRoundNumber: options.currentRoundNumber ?? 0,
    createdAt,
    startedAt: createdAt,
    ...(options.mapStatus === "completed" ? { winnerTeamId: "team_a", completedAt: createdAt } : {})
  });
  for (const agent of [...agentsForTeam("team_a", "falcon"), ...agentsForTeam("team_b", "vita")]) {
    await repositories.agents.save(agent);
  }
}

function agentsForTeam(teamId: string, prefix: string): Agent[] {
  return ["entry", "star_rifler", "awper", "igl", "support"].map((role, index) => ({
    id: `${prefix}_${index + 1}`,
    teamId,
    driverModelId: "driver_node",
    role,
    displayName: `${prefix}_${index + 1}`,
    baseProfile: {
      personalitySummary: `${prefix}_${index + 1} test profile`,
      tacticalSummary: `${prefix}_${index + 1} follows node graph constraints`,
      styleTags: ["test", "node"]
    },
    currentState: "ready",
    createdAt: "2026-05-01T00:00:00.000Z"
  })) as Agent[];
}
