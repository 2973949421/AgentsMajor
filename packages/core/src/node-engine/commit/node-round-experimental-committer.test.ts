import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { ArtifactRepository, SqliteRepositoryBundle } from "@agent-major/db";
import { createSqliteRepositories } from "@agent-major/db";
import type { Agent, Artifact } from "@agent-major/shared";
import { afterEach, describe, expect, it } from "vitest";

import { commitDust2NodeRoundExperimental } from "./node-round-experimental-committer.js";
import type { ArtifactStore, ArtifactWriteInput } from "../../ports.js";

describe("node round experimental committer", () => {
  const repositoriesToClose: SqliteRepositoryBundle[] = [];

  afterEach(() => {
    for (const repositories of repositoriesToClose.splice(0)) {
      repositories.close();
    }
  });

  it("commits exactly one Dust2 node round and stores a node trace artifact reference", async () => {
    const repositories = createFixtureRepositories();
    const artifactStore = new MemoryArtifactStore(repositories.artifacts);
    await seedFixture(repositories);

    const result = await commitDust2NodeRoundExperimental({
      repositories,
      artifactStore,
      mapGameId: "map_dust2",
      enableExperimentalMode: true
    });

    expect(result.round.status).toBe("completed");
    expect(result.round.roundNumber).toBe(1);
    expect(result.roundReport.nodeTraceSource).toBe("node_round_engine_committed");
    expect(result.roundReport.nodeTraceArtifactId).toBe(result.nodeTraceArtifact.id);
    expect(result.committedReport.source).toBe("node_round_engine_committed");
    expect(result.committedReport.audit.writesDb).toBe(true);
    expect(result.roundReport.winnerTeamId).toBe(result.shadowResult.finalWinCondition?.winnerTeamId);

    const storedReport = await repositories.roundReports.getByRoundId(result.round.id);
    const storedMap = await repositories.mapGames.getById("map_dust2");
    const storedArtifactText = await artifactStore.readText(result.nodeTraceArtifact.id);
    const storedEvents = await repositories.events.listByRound(result.round.id);

    expect(storedReport?.nodeTraceArtifactId).toBe(result.nodeTraceArtifact.id);
    expect(storedMap?.currentRoundNumber).toBe(1);
    expect(storedMap).not.toBeNull();
    expect((storedMap?.teamAScore ?? 0) + (storedMap?.teamBScore ?? 0)).toBe(1);
    expect(storedArtifactText).toContain("node_round_engine_committed");
    expect(storedEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "node_round_experimental_started",
        "node_round_trace_artifact_created",
        "node_round_experimental_committed",
        "round_report_created",
        "round_completed"
      ])
    );
  });

  it("refuses to run without explicit experimental mode", async () => {
    const repositories = createFixtureRepositories();
    await seedFixture(repositories);

    await expect(
      commitDust2NodeRoundExperimental({
        repositories,
        artifactStore: new MemoryArtifactStore(repositories.artifacts),
        mapGameId: "map_dust2",
        enableExperimentalMode: false as true
      })
    ).rejects.toThrow(/enableExperimentalMode/);
  });

  it("keeps old round reports without node trace fields compatible", async () => {
    const repositories = createFixtureRepositories();
    await seedFixture(repositories);
    const result = await commitDust2NodeRoundExperimental({
      repositories,
      artifactStore: new MemoryArtifactStore(repositories.artifacts),
      mapGameId: "map_dust2",
      enableExperimentalMode: true
    });
    const { nodeTraceArtifactId: _unusedNodeTraceArtifactId, nodeTraceSource: _unusedNodeTraceSource, ...legacyReport } = result.roundReport;
    await repositories.roundReports.save({
      ...legacyReport,
      id: "legacy_report_without_node_trace"
    });

    const storedLegacyReport = await repositories.roundReports.getById("legacy_report_without_node_trace");
    expect(storedLegacyReport?.nodeTraceArtifactId).toBeUndefined();
    expect(storedLegacyReport?.nodeTraceSource).toBeUndefined();
  });

  function createFixtureRepositories() {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "agent-major-node-commit-"));
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
      id: `art_node_commit_${this.counter}`,
      artifactType: input.artifactType,
      tournamentId: input.tournamentId,
      matchId: input.matchId,
      mapGameId: input.mapGameId,
      roundId: input.roundId,
      agentId: input.agentId,
      uri: `memory:${input.relativePath}`,
      mimeType: "application/json",
      sizeBytes: Buffer.byteLength(content, "utf8"),
      status: "ready",
      sourceEventIds: input.sourceEventIds,
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

async function seedFixture(repositories: SqliteRepositoryBundle): Promise<void> {
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
    status: "running",
    runControlState: "idle",
    teamAScore: 0,
    teamBScore: 0,
    currentRoundNumber: 0,
    createdAt,
    startedAt: createdAt
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
