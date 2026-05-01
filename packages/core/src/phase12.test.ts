import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createSqliteRepositories } from "@agent-major/db";
import type { LlmGateway, LlmRequest, LlmResponse } from "@agent-major/llm";
import { FakeProvider } from "@agent-major/llm";
import { UnconfiguredJobQueue } from "@agent-major/queue";
import { describe, expect, it } from "vitest";

import { phase11DemoIds, seedPhase11Demo } from "./demo.js";
import { createPhase12SimulationEngine } from "./engine.js";
import { readMapReplay } from "./map-replay.js";

describe("Phase 1.2 single-map chain", () => {
  it("runs a full MR6 map through MR3 overtime and map review", async () => {
    const { repositories, engine } = await createDemoEngine();

    const result = await engine.runCurrentMap({ mapGameId: phase11DemoIds.mapGameId });
    const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);
    if (!replay) {
      throw new Error("Expected map replay.");
    }

    expect(result.mapGame.status).toBe("completed");
    expect(replay.mapGame.status).toBe("completed");
    expect(replay.mapGame.runControlState).toBe("map_review_window");
    expect(replay.mapGame.teamAScore).toBe(10);
    expect(replay.mapGame.teamBScore).toBe(8);
    expect(replay.mapGame.currentRoundNumber).toBe(18);
    expect(replay.rounds).toHaveLength(18);
    expect(replay.mapSummary?.payload).toMatchObject({ overtimePlayed: true });

    const events = await repositories.events.listByMapGame(phase11DemoIds.mapGameId);
    expect(events.some((event) => event.type === "map_completed")).toBe(true);
    expect(events.some((event) => event.type === "map_review_window_started")).toBe(true);
    const eventIds = new Set(events.map((event) => event.id));
    expect(replay.mapSummary?.sourceEventIds.every((id) => eventIds.has(id))).toBe(true);

    const rerun = await engine.runCurrentMap({ mapGameId: phase11DemoIds.mapGameId });
    expect(rerun.mapGame.status).toBe("completed");
    expect(rerun.rounds).toHaveLength(18);
    expect(await repositories.events.listByMapGame(phase11DemoIds.mapGameId)).toEqual(events);
  });

  it("keeps event append idempotent without rewriting sequence numbers", async () => {
    const { repositories, engine } = await createDemoEngine();
    await engine.runCurrentMap({ mapGameId: phase11DemoIds.mapGameId });

    const event = (await repositories.events.listByMapGame(phase11DemoIds.mapGameId))[0];
    if (!event) {
      throw new Error("Expected at least one event.");
    }

    const duplicate = await repositories.events.append({
      ...event,
      globalSequence: event.globalSequence + 999,
      sequenceInScope: event.sequenceInScope + 999
    });
    expect(duplicate).toEqual(event);
    expect(await repositories.events.getById(event.id)).toEqual(event);

    await expect(
      repositories.events.append({
        ...event,
        payload: {
          schemaVersion: 1,
          changed: true
        }
      })
    ).rejects.toThrow("Event id conflict");
  });

  it("is deterministic for the same map fixture", async () => {
    const first = await runReplayFingerprint();
    const second = await runReplayFingerprint();

    expect(first).toEqual(second);
  });

  it("does not leave partial facts when generation fails before commit", async () => {
    const repositories = createSqliteRepositories(resolve(mkdtempSync(resolve(tmpdir(), "agent-major-phase12-fail-")), "agent-major.sqlite"));
    const engine = createPhase12SimulationEngine({
      repositories,
      llmGateway: new FailingJudgeGateway(),
      jobQueue: new UnconfiguredJobQueue()
    });
    await seedPhase11Demo(repositories);
    await engine.startMatch({ matchId: phase11DemoIds.matchId });
    await engine.completeVeto({ matchId: phase11DemoIds.matchId, selectedMapIds: ["DUST2"] });
    await engine.startMap({ mapGameId: phase11DemoIds.mapGameId });

    await expect(engine.playNextRound({ mapGameId: phase11DemoIds.mapGameId })).rejects.toThrow("planned judge failure");
    expect(await repositories.rounds.listByMapGame(phase11DemoIds.mapGameId)).toHaveLength(0);
    expect(await repositories.events.listByRound(`round_${phase11DemoIds.mapGameId}_1`)).toHaveLength(0);
  });
});

async function createDemoEngine() {
  const tempRoot = mkdtempSync(resolve(tmpdir(), "agent-major-phase12-"));
  const repositories = createSqliteRepositories(resolve(tempRoot, "agent-major.sqlite"));
  const engine = createPhase12SimulationEngine({
    repositories,
    llmGateway: new FakeProvider({ providerId: "phase12-test-provider" }),
    jobQueue: new UnconfiguredJobQueue()
  });

  await seedPhase11Demo(repositories);
  await engine.startMatch({ matchId: phase11DemoIds.matchId });
  await engine.completeVeto({ matchId: phase11DemoIds.matchId, selectedMapIds: ["DUST2"] });
  await engine.startMap({ mapGameId: phase11DemoIds.mapGameId });
  return { repositories, engine };
}

async function runReplayFingerprint() {
  const { repositories, engine } = await createDemoEngine();
  await engine.runCurrentMap({ mapGameId: phase11DemoIds.mapGameId });
  const replay = await readMapReplay(repositories, phase11DemoIds.mapGameId);
  if (!replay) {
    throw new Error("Expected map replay.");
  }

  return {
    mapGame: {
      status: replay.mapGame.status,
      score: [replay.mapGame.teamAScore, replay.mapGame.teamBScore],
      winnerTeamId: replay.mapGame.winnerTeamId,
      summaryId: replay.mapGame.summaryId
    },
    rounds: replay.rounds.map((item) => ({
      roundNumber: item.round.roundNumber,
      winnerTeamId: item.roundReport.winnerTeamId,
      scoreAfterRound: item.roundReport.scoreAfterRound,
      timelineKinds: item.timelineEvents.map((event) => event.kind)
    })),
    summary: replay.mapSummary
  };
}

class FailingJudgeGateway implements LlmGateway {
  async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>): Promise<LlmResponse<TData>> {
    if (request.task === "judge") {
      throw new Error("planned judge failure");
    }

    return {
      data: { fingerprint: "ok" } as TData,
      usage: {
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2
      }
    };
  }
}
