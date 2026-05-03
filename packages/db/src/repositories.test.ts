import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createSqliteRepositories } from "./repositories.js";

describe("sqlite repositories", () => {
  it("normalizes legacy primary roles without dropping closer secondary tags", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "agent-major-db-"));
    const repositories = createSqliteRepositories(join(tempDir, "test.sqlite"));
    try {
      repositories.sqlite
        .prepare(
          "INSERT INTO tournaments (id, name, status, format, created_at) VALUES (?, ?, ?, ?, ?)"
        )
        .run("t_legacy", "Legacy", "running", "single_elimination_16", "2026-05-01T00:00:00.000Z");
      repositories.sqlite
        .prepare(
          "INSERT INTO teams (id, tournament_id, display_name, short_name, seed, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run("team_legacy", "t_legacy", "Legacy Team", "LEG", 1, "2026-05-01T00:00:00.000Z");
      repositories.sqlite
        .prepare(
          "INSERT INTO driver_models (id, provider, model_name, capabilities_json, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run("driver_legacy", "fake", "fake", "[]", 1, "2026-05-01T00:00:00.000Z");

      repositories.sqlite
        .prepare(
          `INSERT INTO agents (
            id, team_id, driver_model_id, role, secondary_roles_json, display_name, base_profile_json,
            role_profile_json, current_state, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "agent_legacy_closer",
          "team_legacy",
          "driver_legacy",
          "closer",
          JSON.stringify(["closer", "star"]),
          "Legacy Closer",
          JSON.stringify({
            personalitySummary: "Legacy profile",
            tacticalSummary: "Legacy tactical summary",
            styleTags: []
          }),
          JSON.stringify({
            sourcePath: "legacy",
            sourceTeamName: "Legacy Team",
            memberType: "player",
            rawPosition: "Closer",
            rawPositionParts: ["Closer"],
            primaryRole: "closer",
            secondaryRoles: ["closer", "star"],
            positionTags: ["closer"],
            confidence: "legacy",
            agentMajorResponsibilities: ["close rounds"]
          }),
          "ready",
          "2026-05-01T00:00:00.000Z"
        );

      const agent = await repositories.agents.getById("agent_legacy_closer");
      expect(agent?.role).toBe("rifler");
      expect(agent?.secondaryRoles).toEqual(["closer", "star_rifler"]);
      expect(agent?.roleProfile?.primaryRole).toBe("rifler");
      expect(agent?.roleProfile?.secondaryRoles).toEqual(["closer", "star_rifler"]);
      expect(agent?.roleProfile?.positionTags).toEqual(["closer"]);
    } finally {
      repositories.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

