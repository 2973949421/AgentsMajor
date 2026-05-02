import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createSqliteRepositories } from "@agent-major/db";
import { describe, expect, it } from "vitest";

import { runPhase16Command } from "./phase16.js";

describe("Phase 1.6 CLI commands", () => {
  it("runs a BO3 with deterministic tactical protocol enabled", async () => {
    const projectRoot = mkdtempSync(resolve(tmpdir(), "agent-major-cli-phase16-"));

    const result = await runPhase16Command("match", projectRoot);

    expect(result.lines[0]).toContain("Phase 1.6 tactical protocol: enabled");
    expect(result.lines.some((line) => line.includes("Tactical rounds:"))).toBe(true);

    const repositories = createSqliteRepositories(resolve(projectRoot, "data", "agent-major.sqlite"));
    try {
      const tacticalEvents = repositories.sqlite
        .prepare("SELECT type, payload_json FROM events WHERE type IN ('side_assignment_created','tactical_plan_submitted','zone_deployment_committed','site_execute_resolved')")
        .all() as Array<{ type: string; payload_json: string }>;
      expect(tacticalEvents.length).toBeGreaterThan(0);
      expect(tacticalEvents.some((event) => event.type === "site_execute_resolved")).toBe(true);
      expect(tacticalEvents.some((event) => event.payload_json.includes("driverModelId") || event.payload_json.includes("modelName"))).toBe(false);
    } finally {
      repositories.close();
    }

    const exportResult = await runPhase16Command("export", projectRoot);
    const exportContent = readFileSync(exportResult.exportPath as string, "utf8");
    expect(exportContent.includes("driverModelId")).toBe(false);
    expect(exportContent.includes("providerId")).toBe(false);
    expect(exportContent.includes("modelName")).toBe(false);
    expect(exportContent.includes("apiKey")).toBe(false);
    expect(exportContent.includes("authorization")).toBe(false);
    expect(exportContent.includes("rawOutput")).toBe(false);
    expect(exportContent.includes("site_execute_resolved")).toBe(true);
  });
});
