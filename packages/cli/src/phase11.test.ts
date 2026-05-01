import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createSqliteRepositories } from "@agent-major/db";
import { describe, expect, it } from "vitest";

import { runPhase11Command } from "./phase11.js";

describe("Phase 1.1 CLI commands", () => {
  it("keeps replay and export read-only after a round exists", async () => {
    const projectRoot = mkdtempSync(resolve(tmpdir(), "agent-major-cli-phase11-"));

    await runPhase11Command("round", projectRoot);
    const beforeReplay = await readEventFingerprint(projectRoot);

    await runPhase11Command("replay", projectRoot);
    expect(await readEventFingerprint(projectRoot)).toEqual(beforeReplay);

    await runPhase11Command("export", projectRoot);
    expect(await readEventFingerprint(projectRoot)).toEqual(beforeReplay);
  });
});

async function readEventFingerprint(projectRoot: string) {
  const repositories = createSqliteRepositories(resolve(projectRoot, "data", "agent-major.sqlite"));
  const rounds = await repositories.rounds.listByMapGame("map_demo_match_phase11_1");
  const round = rounds.at(-1);
  if (!round) {
    throw new Error("Expected a completed round.");
  }

  const events = await repositories.events.listByRound(round.id);
  return events.map((event) => ({
    id: event.id,
    globalSequence: event.globalSequence,
    sequenceInScope: event.sequenceInScope
  }));
}
