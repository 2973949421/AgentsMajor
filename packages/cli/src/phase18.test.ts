import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPhase18SimulationEngine, defaultDriverModels, FakeProvider, UnconfiguredJobQueue } from "@agent-major/core";
import { createSqliteRepositories } from "@agent-major/db";
import { phase18CanonIds } from "@agent-major/materials";
import { describe, expect, it } from "vitest";

import { ensureRunnablePhase18Fixture, selectCurrentPhase18MapGameId } from "./phase18.js";

const projectRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

describe("Phase 1.8 CLI helpers", () => {
  it("seeds a runnable fixture and points round mode at the first map", async () => {
    const harness = createHarness();
    try {
      const seed = await ensureRunnablePhase18Fixture({
        repositories: harness.repositories,
        projectRoot,
        driverModel: defaultDriverModels[0]!,
        engine: harness.engine,
        resetCompleted: true,
        resetBeforeRun: false
      });

      expect(seed.matchId).toBe(phase18CanonIds.matchId);
      expect(seed.selectedMapIds).toEqual(phase18CanonIds.selectedMapIds);

      const maps = (await harness.repositories.mapGames.listByMatch(seed.matchId)).sort((left, right) => left.order - right.order);
      expect(maps.map((mapGame) => mapGame.mapName)).toEqual(phase18CanonIds.selectedMapIds);
      await expect(selectCurrentPhase18MapGameId(harness.repositories)).resolves.toBe(maps[0]?.id);
    } finally {
      harness.repositories.close();
    }
  });

  it("keeps an in-progress fixture and advances to the next unfinished map", async () => {
    const harness = createHarness();
    try {
      const seed = await ensureRunnablePhase18Fixture({
        repositories: harness.repositories,
        projectRoot,
        driverModel: defaultDriverModels[0]!,
        engine: harness.engine,
        resetCompleted: true,
        resetBeforeRun: false
      });
      const match = await harness.repositories.matches.getById(seed.matchId);
      const maps = (await harness.repositories.mapGames.listByMatch(seed.matchId)).sort((left, right) => left.order - right.order);
      if (!match || maps.length < 2) {
        throw new Error("Expected a seeded Phase 1.8 fixture with at least two maps.");
      }

      await harness.repositories.matches.save({ ...match, status: "running", startedAt: match.startedAt ?? match.createdAt });
      await harness.repositories.mapGames.save({
        ...maps[0]!,
        status: "completed",
        currentRoundNumber: 12,
        teamAScore: 7,
        teamBScore: 5,
        winnerTeamId: match.teamAId,
        startedAt: maps[0]!.startedAt ?? maps[0]!.createdAt,
        completedAt: maps[0]!.completedAt ?? maps[0]!.createdAt
      });
      await harness.repositories.mapGames.save({
        ...maps[1]!,
        status: "running",
        currentRoundNumber: 2,
        startedAt: maps[1]!.startedAt ?? maps[1]!.createdAt
      });

      const resumed = await ensureRunnablePhase18Fixture({
        repositories: harness.repositories,
        projectRoot,
        driverModel: defaultDriverModels[0]!,
        engine: harness.engine,
        resetCompleted: true,
        resetBeforeRun: false
      });

      expect(resumed.matchId).toBe(seed.matchId);
      await expect(selectCurrentPhase18MapGameId(harness.repositories)).resolves.toBe(maps[1]?.id);
    } finally {
      harness.repositories.close();
    }
  });
});

function createHarness() {
  const tempRoot = mkdtempSync(resolve(tmpdir(), "agent-major-phase18-cli-"));
  const repositories = createSqliteRepositories(resolve(tempRoot, "agent-major.sqlite"));
  const engine = createPhase18SimulationEngine({
    repositories,
    llmGateway: new FakeProvider({ providerId: "phase18-cli-test-provider" }),
    jobQueue: new UnconfiguredJobQueue()
  });
  return { repositories, engine };
}
