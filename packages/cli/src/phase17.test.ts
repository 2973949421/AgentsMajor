import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runPhase17Command } from "./phase17.js";

const projectRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

describe("Phase 1.7 CLI commands", () => {
  it("rejects self-matches before seeding the showcase runtime", async () => {
    await expect(runPhase17Command("match", projectRoot, { teamASlug: "falcon-7b", teamBSlug: "falcon-7b" })).rejects.toThrow(
      "distinct team slugs"
    );
  });

  it("requires exactly three unique showcase maps from the supported pool", async () => {
    await expect(runPhase17Command("match", projectRoot, { selectedMapIds: ["DUST2", "INFERNO"] })).rejects.toThrow("exactly 3 maps");
    await expect(runPhase17Command("match", projectRoot, { selectedMapIds: ["DUST2", "DUST2", "MIRAGE"] })).rejects.toThrow(
      "must be unique"
    );
    await expect(runPhase17Command("match", projectRoot, { selectedMapIds: ["DUST2", "INFERNO", "NUKE"] })).rejects.toThrow(
      "only supports"
    );
  });
});
