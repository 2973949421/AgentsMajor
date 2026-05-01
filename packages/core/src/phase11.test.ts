import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createSqliteRepositories } from "@agent-major/db";
import { FakeProvider } from "@agent-major/llm";
import { UnconfiguredJobQueue } from "@agent-major/queue";
import { describe, expect, it } from "vitest";

import { createPhase11SimulationEngine } from "./engine.js";
import { phase11DemoIds, seedPhase11Demo } from "./demo.js";

describe("Phase 1.1 simulation chain", () => {
  it("writes a traceable single-round replay", async () => {
    const replay = await runDemoRound();

    expect(replay.round.status).toBe("completed");
    expect(replay.roundReport.roundId).toBe(replay.round.id);
    expect(replay.events.map((event) => event.globalSequence)).toEqual([...replay.events.map((event) => event.globalSequence)].sort((a, b) => a - b));
    expect(replay.timelineEvents.length).toBeGreaterThanOrEqual(8);

    const eventIds = new Set(replay.events.map((event) => event.id));
    for (const timelineEvent of replay.timelineEvents) {
      expect(timelineEvent.sourceEventIds.every((id) => eventIds.has(id))).toBe(true);
    }

    for (const projected of replay.roundReport.eventProjection.coreEventsLinkedByRoundReport) {
      expect(eventIds.has(projected.eventId)).toBe(true);
    }
  });

  it("is deterministic for the same fixture and seed", async () => {
    const first = await runDemoRound();
    const second = await runDemoRound();

    expect(first.roundReport).toEqual(second.roundReport);
    expect(first.events.map((event) => ({ id: event.id, type: event.type, payload: event.payload }))).toEqual(
      second.events.map((event) => ({ id: event.id, type: event.type, payload: event.payload }))
    );
    expect(first.timelineEvents).toEqual(second.timelineEvents);
  });

  it("keeps round buy types and economy deltas consistent", async () => {
    const replay = await runDemoRounds(4);
    const buyTypeByTeam = new Map([
      ["team_ghost_nav", replay.round.teamABuyType],
      ["team_ghost_fur", replay.round.teamBBuyType]
    ]);

    expect(replay.round.roundNumber).toBe(4);
    expect(replay.round.teamABuyType).not.toBe("fullBuy");
    expect(replay.round.teamBBuyType).not.toBe("fullBuy");
    for (const delta of replay.roundReport.economyDelta.agents) {
      expect(delta.buyType).toBe(buyTypeByTeam.get(delta.teamId));
    }
  });
});

async function runDemoRound() {
  return runDemoRounds(1);
}

async function runDemoRounds(roundCount: number) {
  const tempRoot = mkdtempSync(resolve(tmpdir(), "agent-major-phase11-"));
  const repositories = createSqliteRepositories(resolve(tempRoot, "agent-major.sqlite"));
  const engine = createPhase11SimulationEngine({
    repositories,
    llmGateway: new FakeProvider({ providerId: "phase11-test-provider" }),
    jobQueue: new UnconfiguredJobQueue()
  });

  await seedPhase11Demo(repositories);
  await engine.startMatch({ matchId: phase11DemoIds.matchId });
  await engine.completeVeto({ matchId: phase11DemoIds.matchId, selectedMapIds: ["DUST2"] });
  await engine.startMap({ mapGameId: phase11DemoIds.mapGameId });
  let round = await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
  for (let index = 1; index < roundCount; index += 1) {
    round = await engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId });
  }
  const roundReport = await repositories.roundReports.getByRoundId(round.id);
  if (!roundReport) {
    throw new Error("Expected RoundReport to be written.");
  }

  return {
    round,
    roundReport,
    events: await repositories.events.listByRound(round.id),
    timelineEvents: await repositories.timelineEvents.listByRound(round.id)
  };
}
