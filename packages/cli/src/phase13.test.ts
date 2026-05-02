import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createPhase13SimulationEngine, phase11DemoIds, seedPhase11Demo } from "@agent-major/core";
import { createSqliteRepositories } from "@agent-major/db";
import { FakeProvider } from "@agent-major/llm";
import { UnconfiguredJobQueue } from "@agent-major/queue";
import { describe, expect, it } from "vitest";

import { runPhase13Command } from "./phase13.js";

describe("Phase 1.3 CLI commands", () => {
  it("runs, replays, and exports a BO3 match without mutating read-only commands", async () => {
    const projectRoot = mkdtempSync(resolve(tmpdir(), "agent-major-cli-phase13-"));

    await runPhase13Command("match", projectRoot);
    const afterMatch = await readMatchFingerprint(projectRoot);
    expect(afterMatch.match?.status).toBe("completed");
    expect(afterMatch.match?.mapsWon).toEqual([2, 1]);
    expect(afterMatch.maps.filter((map) => map.status === "completed")).toHaveLength(3);

    await runPhase13Command("match", projectRoot);
    expect(await readMatchFingerprint(projectRoot)).toEqual(afterMatch);

    const replayResult = await runPhase13Command("replay", projectRoot);
    expect(replayResult.lines.some((line) => line.includes("Maps: 2-1"))).toBe(true);
    expect(await readMatchFingerprint(projectRoot)).toEqual(afterMatch);

    const exportResult = await runPhase13Command("export", projectRoot);
    expect(exportResult.exportPath).toContain("data\\exports\\matches");
    const exportContent = readFileSync(exportResult.exportPath as string, "utf8");
    expect(exportContent.includes("driverModelId")).toBe(false);
    expect(exportContent.includes("providerId")).toBe(false);
    expect(exportContent.includes("modelName")).toBe(false);
    expect(exportContent.includes("apiKey")).toBe(false);
    expect(exportContent.includes("authorization")).toBe(false);
    expect(exportContent.includes("rawOutput")).toBe(false);
    expect(exportContent.includes("agentOutputs")).toBe(false);
    expect(await readMatchFingerprint(projectRoot)).toEqual(afterMatch);
  }, 15_000);

  it("refuses replay/export output for an incomplete match", async () => {
    const projectRoot = mkdtempSync(resolve(tmpdir(), "agent-major-cli-phase13-incomplete-"));
    await prepareIncompleteMatch(projectRoot);

    const replayResult = await runPhase13Command("replay", projectRoot);
    expect(replayResult.lines).toEqual(["Phase 1.3 match replay is incomplete. Run `pnpm phase13:match` to complete the BO3 first."]);

    const exportResult = await runPhase13Command("export", projectRoot);
    expect(exportResult.exportPath).toBeUndefined();
    expect(exportResult.lines).toEqual(["Phase 1.3 match replay is incomplete. Run `pnpm phase13:match` to complete the BO3 first."]);
  });
});

async function prepareIncompleteMatch(projectRoot: string): Promise<void> {
  mkdirSync(resolve(projectRoot, "data"), { recursive: true });
  const repositories = createSqliteRepositories(resolve(projectRoot, "data", "agent-major.sqlite"));
  try {
    const engine = createPhase13SimulationEngine({
      repositories,
      llmGateway: new FakeProvider({ providerId: "phase13-cli-test-provider" }),
      jobQueue: new UnconfiguredJobQueue()
    });
    await seedPhase11Demo(repositories);
    await engine.startMatch({ matchId: phase11DemoIds.matchId });
    await engine.completeVeto({ matchId: phase11DemoIds.matchId, selectedMapIds: ["DUST2"] });
    await engine.runCurrentMap({ mapGameId: phase11DemoIds.mapGameId });
  } finally {
    repositories.close();
  }
}

async function readMatchFingerprint(projectRoot: string) {
  const repositories = createSqliteRepositories(resolve(projectRoot, "data", "agent-major.sqlite"));
  try {
    const match = await repositories.matches.getById("demo_match_phase11");
    const maps = await repositories.mapGames.listByMatch("demo_match_phase11");
    const events = await repositories.events.listByMatch("demo_match_phase11");
    const summary = await repositories.summaries.getLatestByScope("match", "demo_match_phase11");
    return {
      match: match
        ? {
            status: match.status,
            winnerTeamId: match.winnerTeamId,
            mapsWon: [match.teamAMapsWon, match.teamBMapsWon]
          }
        : null,
      maps: maps.map((map) => ({
        id: map.id,
        order: map.order,
        mapName: map.mapName,
        status: map.status,
        winnerTeamId: map.winnerTeamId,
        score: [map.teamAScore, map.teamBScore]
      })),
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        globalSequence: event.globalSequence,
        sequenceInScope: event.sequenceInScope
      })),
      summary
    };
  } finally {
    repositories.close();
  }
}
