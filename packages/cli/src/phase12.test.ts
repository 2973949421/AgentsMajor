import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createSqliteRepositories } from "@agent-major/db";
import { describe, expect, it } from "vitest";

import { runPhase12Command } from "./phase12.js";

describe("Phase 1.2 CLI commands", () => {
  it("runs, replays, and exports a map without mutating read-only commands", async () => {
    const projectRoot = mkdtempSync(resolve(tmpdir(), "agent-major-cli-phase12-"));

    await runPhase12Command("map", projectRoot);
    const afterMap = await readMapFingerprint(projectRoot);
    expect(afterMap.map?.status).toBe("completed");
    expect(afterMap.rounds).toHaveLength(18);

    await runPhase12Command("map", projectRoot);
    expect(await readMapFingerprint(projectRoot)).toEqual(afterMap);

    const replayResult = await runPhase12Command("replay", projectRoot);
    expect(replayResult.lines.some((line) => line.includes("Score: 10-8"))).toBe(true);
    expect(await readMapFingerprint(projectRoot)).toEqual(afterMap);

    const exportResult = await runPhase12Command("export", projectRoot);
    expect(exportResult.exportPath).toContain("data\\exports\\maps");
    expect(await readMapFingerprint(projectRoot)).toEqual(afterMap);
  });
});

async function readMapFingerprint(projectRoot: string) {
  const repositories = createSqliteRepositories(resolve(projectRoot, "data", "agent-major.sqlite"));
  try {
    const map = await repositories.mapGames.getById("map_demo_match_phase11_1");
    const rounds = await repositories.rounds.listByMapGame("map_demo_match_phase11_1");
    const events = await repositories.events.listByMapGame("map_demo_match_phase11_1");
    return {
      map: map
        ? {
            status: map.status,
            score: [map.teamAScore, map.teamBScore],
            winnerTeamId: map.winnerTeamId,
            summaryId: map.summaryId
          }
        : null,
      rounds: rounds.map((round) => ({
        id: round.id,
        status: round.status,
        winnerTeamId: round.winnerTeamId
      })),
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        globalSequence: event.globalSequence,
        sequenceInScope: event.sequenceInScope
      }))
    };
  } finally {
    repositories.close();
  }
}
