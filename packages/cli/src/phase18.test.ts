import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPhase18SimulationEngine, defaultDriverModels, FakeProvider, UnconfiguredJobQueue } from "@agent-major/core";
import { createSqliteRepositories } from "@agent-major/db";
import { buildPhase18RuntimeMatchId, phase18CanonIds, phase20PrePilotMapIds } from "@agent-major/materials";
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
        resetBeforeRun: false,
        runId: undefined,
        mode: "round"
      });

      expect(seed.runId).toMatch(/^phase18_run_/);
      expect(seed.runtimeMatchId).toBe(buildPhase18RuntimeMatchId(seed.runId, phase18CanonIds.fixtureId));
      expect(seed.matchId).toBe(seed.runtimeMatchId);
      expect(seed.selectedMapIds).toEqual([...phase20PrePilotMapIds]);

      const maps = (await harness.repositories.mapGames.listByMatch(seed.matchId)).sort((left, right) => left.order - right.order);
      expect(maps.map((mapGame) => mapGame.mapName)).toEqual([...phase20PrePilotMapIds]);
      await expect(selectCurrentPhase18MapGameId(harness.repositories, seed.matchId)).resolves.toBe(maps[0]?.id);
    } finally {
      harness.repositories.close();
    }
  });

  it("starts a fresh run when the current Dust2-only calibration has no remaining map", async () => {
    const harness = createHarness();
    try {
      const seed = await ensureRunnablePhase18Fixture({
        repositories: harness.repositories,
        projectRoot,
        driverModel: defaultDriverModels[0]!,
        engine: harness.engine,
        resetCompleted: true,
        resetBeforeRun: false,
        runId: undefined,
        mode: "round"
      });
      const match = await harness.repositories.matches.getById(seed.matchId);
      const maps = (await harness.repositories.mapGames.listByMatch(seed.matchId)).sort((left, right) => left.order - right.order);
      if (!match || maps.length !== 1) {
        throw new Error("Expected a seeded Phase 2.0-pre fixture with exactly one map.");
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

      const resumed = await ensureRunnablePhase18Fixture({
        repositories: harness.repositories,
        projectRoot,
        driverModel: defaultDriverModels[0]!,
        engine: harness.engine,
        resetCompleted: true,
        resetBeforeRun: false,
        runId: seed.runId,
        mode: "round"
      });

      expect(resumed.runId).not.toBe(seed.runId);
      expect(resumed.matchId).not.toBe(seed.matchId);
      expect(resumed.runtimeMatchId).toBe(buildPhase18RuntimeMatchId(resumed.runId, phase18CanonIds.fixtureId));
      expect(resumed.selectedMapIds).toEqual(["DUST2"]);
      const resumedMaps = (await harness.repositories.mapGames.listByMatch(resumed.matchId)).sort((left, right) => left.order - right.order);
      expect(resumedMaps.map((mapGame) => mapGame.mapName)).toEqual(["DUST2"]);
      await expect(selectCurrentPhase18MapGameId(harness.repositories, resumed.matchId)).resolves.toBe(resumedMaps[0]?.id);
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
