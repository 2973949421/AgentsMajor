import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { ArtifactRepository, SqliteRepositoryBundle } from "@agent-major/db";
import { createSqliteRepositories } from "@agent-major/db";
import type { Agent, Artifact, MapGame } from "@agent-major/shared";
import { afterEach, describe, expect, it } from "vitest";

import type { ArtifactStore, ArtifactWriteInput } from "../../ports.js";
import {
  HEX_MAP_EXPERIMENTAL_HARD_MAX_ROUNDS,
  runDust2HexMapExperimental
} from "./hex-map-experimental-runner.js";

describe("Hex map experimental runner", () => {
  const repositoriesToClose: SqliteRepositoryBundle[] = [];

  afterEach(() => {
    for (const repositories of repositoriesToClose.splice(0)) {
      repositories.close();
    }
  });

  it("thin-loops N29 round commits until the Dust2 map is completed", async () => {
    const repositories = createFixtureRepositories();
    const artifactStore = new MemoryArtifactStore(repositories.artifacts);
    await seedFixture(repositories, {
      teamAScore: 6,
      teamBScore: 0,
      currentRoundNumber: 6
    });

    const result = await runDust2HexMapExperimental({
      repositories,
      artifactStore,
      mapGameId: "map_dust2",
      enableExperimentalMode: true,
      maxRounds: 5
    });

    const storedMap = await repositories.mapGames.getById("map_dust2");
    const reports = await repositories.roundReports.listByMapGame("map_dust2");
    const mapEvents = await repositories.events.listByMapGame("map_dust2");
    const summaryText = await artifactStore.readText(result.summaryArtifact.id);

    expect(result.status).toBe("completed");
    expect(result.completionReason).toBe("map_completed");
    expect(result.roundsCommitted).toBe(1);
    expect(storedMap?.status).toBe("completed");
    expect(storedMap?.currentRoundNumber).toBe(7);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.nodeTraceSource).toBe("hex_round_engine_committed");
    expect(result.summaryArtifact.artifactType).toBe("hex_map_summary");
    expect(result.summary.rounds).toHaveLength(1);
    expect(result.summary.rounds[0]?.hexTraceArtifactId).toBe(result.roundResults[0]?.hexTraceArtifact.id);
    expect(summaryText).toContain("hex_round_engine_map_experimental");
    expect(mapEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "hex_map_experimental_started",
        "hex_map_experimental_round_committed",
        "hex_map_experimental_summary_created",
        "hex_map_experimental_completed"
      ])
    );
  });

  it("writes a failed summary when maxRounds is exceeded without pretending the map completed", async () => {
    const repositories = createFixtureRepositories();
    const artifactStore = new MemoryArtifactStore(repositories.artifacts);
    await seedFixture(repositories);

    const result = await runDust2HexMapExperimental({
      repositories,
      artifactStore,
      mapGameId: "map_dust2",
      enableExperimentalMode: true,
      maxRounds: 1
    });

    const storedMap = await repositories.mapGames.getById("map_dust2");
    const summaryText = await artifactStore.readText(result.summaryArtifact.id);
    const mapEvents = await repositories.events.listByMapGame("map_dust2");

    expect(result.status).toBe("failed");
    expect(result.completionReason).toBe("max_rounds_exceeded");
    expect(result.roundsCommitted).toBe(1);
    expect(storedMap?.status).not.toBe("completed");
    expect(result.summary.status).toBe("failed");
    expect(result.summary.roundsCommitted).toBe(1);
    expect(summaryText).toContain("max_rounds_exceeded");
    expect(mapEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining(["hex_map_experimental_failed", "hex_map_experimental_summary_created"])
    );
  });

  it("refuses completed maps and invalid round caps before committing", async () => {
    const repositories = createFixtureRepositories();
    await seedFixture(repositories, { status: "completed", winnerTeamId: "team_a", completedAt: "2026-05-01T00:00:00.000Z" });

    await expect(
      runDust2HexMapExperimental({
        repositories,
        artifactStore: new MemoryArtifactStore(repositories.artifacts),
        mapGameId: "map_dust2",
        enableExperimentalMode: true
      })
    ).rejects.toThrow(/completed map/);

    await expect(
      runDust2HexMapExperimental({
        repositories,
        artifactStore: new MemoryArtifactStore(repositories.artifacts),
        mapGameId: "map_dust2",
        enableExperimentalMode: true,
        maxRounds: HEX_MAP_EXPERIMENTAL_HARD_MAX_ROUNDS + 1
      })
    ).rejects.toThrow(/maxRounds/);
  });

  function createFixtureRepositories() {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "agent-major-hex-map-runner-"));
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
      id: `art_hex_map_${this.counter}`,
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

async function seedFixture(repositories: SqliteRepositoryBundle, mapOverrides: Partial<MapGame> = {}): Promise<void> {
  const createdAt = "2026-05-01T00:00:00.000Z";
  await repositories.tournaments.save({
    id: "tournament_hex",
    name: "Hex Tournament",
    status: "running",
    format: "single_elimination_16",
    createdAt,
    startedAt: createdAt
  });
  await repositories.driverModels.save({
    id: "driver_hex",
    provider: "fixture",
    modelName: "fixture-hex",
    capabilities: ["structured_json"],
    enabled: true,
    createdAt
  });
  await repositories.teams.save({
    id: "team_a",
    tournamentId: "tournament_hex",
    displayName: "Falcon",
    shortName: "FAL",
    seed: 1,
    source: {
      processed_paths: {
        initial_proposal: "processed/teams/falcon-7b/initial-proposal.json"
      }
    },
    createdAt
  });
  await repositories.teams.save({
    id: "team_b",
    tournamentId: "tournament_hex",
    displayName: "Vitallmty",
    shortName: "VIT",
    seed: 2,
    source: {
      processed_paths: {
        initial_proposal: "processed/teams/vitallmty/initial-proposal.json"
      }
    },
    createdAt
  });
  await repositories.matches.save({
    id: "match_hex",
    tournamentId: "tournament_hex",
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
    matchId: "match_hex",
    mapName: "Dust2",
    order: 1,
    status: "running",
    runControlState: "idle",
    teamAScore: 0,
    teamBScore: 0,
    currentRoundNumber: 0,
    createdAt,
    startedAt: createdAt,
    ...mapOverrides
  });
  for (const agent of [...agentsForTeam("team_a", "falcon"), ...agentsForTeam("team_b", "vita")]) {
    await repositories.agents.save(agent);
  }
}

function agentsForTeam(teamId: string, prefix: string): Agent[] {
  return ["entry", "star_rifler", "awper", "igl", "support"].map((role, index) => ({
    id: `${prefix}_${index + 1}`,
    teamId,
    driverModelId: "driver_hex",
    role,
    displayName: `${prefix}_${index + 1}`,
    baseProfile: {
      personalitySummary: `${prefix}_${index + 1} test profile`,
      tacticalSummary: `${prefix}_${index + 1} follows HexGrid constraints`,
      styleTags: ["test", "hex"]
    },
    currentState: "ready",
    createdAt: "2026-05-01T00:00:00.000Z"
  })) as Agent[];
}
