import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createSqliteRepositories } from "@agent-major/db";
import { FakeProvider } from "@agent-major/llm";
import { UnconfiguredJobQueue } from "@agent-major/queue";
import { describe, expect, it } from "vitest";

import { phase11DemoIds, seedPhase11Demo } from "./demo.js";
import { createPhase16SimulationEngine } from "./engine.js";
import { readMatchReplay } from "./map-replay.js";

describe("Phase 1.6 tactical match chain", () => {
  it("runs a BO3 with tactical context, tactical events, and timeline projection", async () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "agent-major-phase16-"));
    const repositories = createSqliteRepositories(resolve(tempRoot, "agent-major.sqlite"));
    const engine = createPhase16SimulationEngine({
      repositories,
      llmGateway: new FakeProvider({ providerId: "phase16-test-provider" }),
      jobQueue: new UnconfiguredJobQueue()
    });

    await seedPhase11Demo(repositories);
    await engine.runCurrentMatch({ matchId: phase11DemoIds.matchId, selectedMapIds: ["DUST2", "MIRAGE"] });
    const replay = await readMatchReplay(repositories, phase11DemoIds.matchId);
    if (!replay) {
      throw new Error("Expected match replay.");
    }

    const rounds = replay.maps.flatMap((mapReplay) => mapReplay.rounds);
    expect(rounds.length).toBeGreaterThan(0);
    expect(rounds.every((roundReplay) => Boolean(roundReplay.roundReport.tacticalContext))).toBe(true);
    expect(rounds.every((roundReplay) => roundReplay.roundReport.summary.includes("Tactical:"))).toBe(true);
    expect(rounds.every((roundReplay) => roundReplay.roundReport.keyEvents.some((event) => event.zoneId === roundReplay.roundReport.tacticalContext?.collision.primaryZoneId))).toBe(
      true
    );
    const attackWinResults = new Set(["attack_breakthrough", "fake_success", "economy_steal"]);
    const defenseWinResults = new Set(["defense_hold", "rotate_success"]);
    expect(
      rounds.every((roundReplay) => {
        const context = roundReplay.roundReport.tacticalContext;
        if (!context) return false;
        if (attackWinResults.has(context.collision.result)) {
          return roundReplay.roundReport.winnerTeamId === context.sideAssignment.attackingTeamId;
        }
        if (defenseWinResults.has(context.collision.result)) {
          return roundReplay.roundReport.winnerTeamId === context.sideAssignment.defendingTeamId;
        }
        return context.collision.result === "trade_even";
      })
    ).toBe(true);

    const events = await repositories.events.listByMatch(phase11DemoIds.matchId);
    expect(events.some((event) => event.type === "side_assignment_created")).toBe(true);
    expect(events.some((event) => event.type === "tactical_plan_submitted")).toBe(true);
    expect(events.some((event) => event.type === "zone_deployment_committed")).toBe(true);
    expect(events.some((event) => event.type === "site_execute_resolved")).toBe(true);
    const tacticalEvents = events.filter((event) =>
      ["side_assignment_created", "tactical_plan_submitted", "zone_deployment_committed", "site_execute_resolved"].includes(event.type)
    );
    expect(tacticalEvents.some((event) => JSON.stringify(event.payload).includes("driverModelId"))).toBe(false);
    expect(tacticalEvents.some((event) => JSON.stringify(event.payload).includes("modelName"))).toBe(false);

    const firstRound = rounds[0];
    expect(firstRound?.timelineEvents.some((event) => event.kind === "map_control_update")).toBe(true);
    expect(firstRound?.timelineEvents.some((event) => event.kind === "highlight_reveal" && JSON.stringify(event.payload).includes("tacticalCollision"))).toBe(true);
  });
});
