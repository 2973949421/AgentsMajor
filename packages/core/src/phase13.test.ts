import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createSqliteRepositories } from "@agent-major/db";
import { FakeProvider } from "@agent-major/llm";
import { UnconfiguredJobQueue } from "@agent-major/queue";
import { describe, expect, it } from "vitest";

import { phase11DemoIds, seedPhase11Demo } from "./demo.js";
import { createPhase13SimulationEngine } from "./engine.js";
import { readMatchReplay } from "./map-replay.js";

describe("Phase 1.3 BO3 match chain", () => {
  it("runs a full 2-1 BO3 and writes a traceable match replay", async () => {
    const { repositories, engine } = await createDemoEngine();

    const result = await engine.runCurrentMatch({ matchId: phase11DemoIds.matchId });
    const replay = await readMatchReplay(repositories, phase11DemoIds.matchId);
    if (!replay) {
      throw new Error("Expected match replay.");
    }

    expect(result.match.status).toBe("completed");
    expect(replay.match.status).toBe("completed");
    expect(replay.match.winnerTeamId).toBe("team_ghost_nav");
    expect(replay.match.teamAMapsWon).toBe(2);
    expect(replay.match.teamBMapsWon).toBe(1);
    expect(replay.mapGames).toHaveLength(3);
    expect(replay.maps).toHaveLength(3);
    expect(replay.matchSummary?.summaryType).toBe("match");

    for (const mapReplay of replay.maps) {
      expect(mapReplay.mapGame.status).toBe("completed");
      expect(mapReplay.rounds).toHaveLength(18);
      expect(mapReplay.mapSummary?.summaryType).toBe("map");
      expect(mapReplay.eventCounts.timeline).toBeGreaterThan(0);
    }

    const genericTags = new Set(["phase11_demo", "phase12_demo", "team_a_round", "team_b_round"]);
    const roundReports = replay.maps.flatMap((mapReplay) => mapReplay.rounds.map((roundReplay) => roundReplay.roundReport));
    expect(roundReports.every((report) => !report.summary.includes("Phase 1.2") && !report.judgeResult.reason.includes("Phase 1.2"))).toBe(true);
    expect(
      roundReports.every((report) => (report.highlightTags ?? []).length > 0 && (report.highlightTags ?? []).every((tag) => !genericTags.has(tag)))
    ).toBe(true);
    expect(roundReports.some((report) => report.highlightTags?.includes("overtime_round"))).toBe(true);
    expect(roundReports.some((report) => report.keyEvents.some((event) => event.type === "economy_swing"))).toBe(true);

    const firstRound = replay.maps[0]?.rounds[0];
    const highlightTimeline = firstRound?.timelineEvents.find((event) => event.kind === "highlight_reveal");
    expect(highlightTimeline?.payload).toMatchObject({
      tags: firstRound?.roundReport.highlightTags,
      reason: firstRound?.roundReport.judgeResult.reason
    });
    for (const mapReplay of replay.maps) {
      const keyRounds = (mapReplay.mapSummary?.payload as { keyRounds?: Array<{ highlightTags?: string[]; summary?: string }> } | undefined)?.keyRounds ?? [];
      expect(keyRounds.length).toBeGreaterThan(0);
      expect(keyRounds.every((round) => (round.highlightTags ?? []).some((tag) => !genericTags.has(tag)) && typeof round.summary === "string")).toBe(true);
    }

    const events = await repositories.events.listByMatch(phase11DemoIds.matchId);
    expect(events.some((event) => event.type === "match_completed")).toBe(true);
    const eventIds = new Set(events.map((event) => event.id));
    expect(replay.matchSummary?.sourceEventIds.every((id) => eventIds.has(id))).toBe(true);

    const rerun = await engine.runCurrentMatch({ matchId: phase11DemoIds.matchId });
    expect(rerun.match.status).toBe("completed");
    expect(await repositories.events.listByMatch(phase11DemoIds.matchId)).toEqual(events);
  });

  it("stops after a 2-0 BO3 and leaves the third map unplayed", async () => {
    const { repositories, engine } = await createDemoEngine();

    await engine.runCurrentMatch({
      matchId: phase11DemoIds.matchId,
      selectedMapIds: ["DUST2", "MIRAGE", "INFERNO"]
    });
    const replay = await readMatchReplay(repositories, phase11DemoIds.matchId);
    if (!replay) {
      throw new Error("Expected match replay.");
    }

    expect(replay.match.status).toBe("completed");
    expect(replay.match.teamAMapsWon).toBe(2);
    expect(replay.match.teamBMapsWon).toBe(0);
    expect(replay.maps).toHaveLength(2);
    expect(replay.mapGames.map((mapGame) => mapGame.status)).toEqual(["completed", "completed", "scheduled"]);
  });

  it("upgrades an existing single-map veto into a complete BO3", async () => {
    const { repositories, engine } = await createDemoEngine();

    await engine.startMatch({ matchId: phase11DemoIds.matchId });
    await engine.completeVeto({ matchId: phase11DemoIds.matchId, selectedMapIds: ["DUST2"] });
    const result = await engine.runCurrentMatch({ matchId: phase11DemoIds.matchId });
    const replay = await readMatchReplay(repositories, phase11DemoIds.matchId);
    if (!replay) {
      throw new Error("Expected match replay.");
    }

    expect(result.match.status).toBe("completed");
    expect(replay.match.teamAMapsWon).toBe(2);
    expect(replay.match.teamBMapsWon).toBe(1);
    expect(replay.mapGames.map((mapGame) => mapGame.mapName)).toEqual(["DUST2", "INFERNO", "MIRAGE"]);
    expect(replay.maps).toHaveLength(3);

    const events = await repositories.events.listByMatch(phase11DemoIds.matchId);
    const revisionEvent = events.find((event) => event.type === "event_revision_created");
    expect(revisionEvent?.payload).toMatchObject({
      targetEventId: `evt_${phase11DemoIds.matchId}_map_veto_completed`,
      revisionType: "map_veto_expanded_to_bo3",
      previousSelectedMapIds: ["DUST2"],
      revisedSelectedMapIds: ["DUST2", "INFERNO", "MIRAGE"]
    });
  });

  it("rejects BO3 input that cannot contain at least two maps", async () => {
    const { engine } = await createDemoEngine();

    await expect(engine.runCurrentMatch({ matchId: phase11DemoIds.matchId, maxMaps: 1 })).rejects.toThrow("BO3 requires at least 2 maps");
    await expect(engine.runCurrentMatch({ matchId: phase11DemoIds.matchId, selectedMapIds: ["DUST2"] })).rejects.toThrow(
      "BO3 requires at least 2 selected maps"
    );
  });

  it("is deterministic for the same BO3 fixture", async () => {
    const first = await runMatchFingerprint();
    const second = await runMatchFingerprint();

    expect(first).toEqual(second);
  });
});

async function createDemoEngine() {
  const tempRoot = mkdtempSync(resolve(tmpdir(), "agent-major-phase13-"));
  const repositories = createSqliteRepositories(resolve(tempRoot, "agent-major.sqlite"));
  const engine = createPhase13SimulationEngine({
    repositories,
    llmGateway: new FakeProvider({ providerId: "phase13-test-provider" }),
    jobQueue: new UnconfiguredJobQueue()
  });

  await seedPhase11Demo(repositories);
  return { repositories, engine };
}

async function runMatchFingerprint() {
  const { repositories, engine } = await createDemoEngine();
  await engine.runCurrentMatch({ matchId: phase11DemoIds.matchId });
  const replay = await readMatchReplay(repositories, phase11DemoIds.matchId);
  if (!replay) {
    throw new Error("Expected match replay.");
  }

  return {
    match: {
      status: replay.match.status,
      winnerTeamId: replay.match.winnerTeamId,
      mapsWon: [replay.match.teamAMapsWon, replay.match.teamBMapsWon]
    },
    maps: replay.maps.map((mapReplay) => ({
      order: mapReplay.mapGame.order,
      mapName: mapReplay.mapGame.mapName,
      winnerTeamId: mapReplay.mapGame.winnerTeamId,
      score: [mapReplay.mapGame.teamAScore, mapReplay.mapGame.teamBScore],
      roundCount: mapReplay.rounds.length
    })),
    summary: replay.matchSummary
  };
}
