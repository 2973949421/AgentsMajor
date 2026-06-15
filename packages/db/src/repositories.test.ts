import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createSqliteRepositories } from "./repositories.js";

describe("sqlite repositories", () => {
  it("round-trips optional prompt contract ids on llm calls", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "agent-major-db-"));
    const repositories = createSqliteRepositories(join(tempDir, "test.sqlite"));
    try {
      repositories.sqlite
        .prepare(
          "INSERT INTO driver_models (id, provider, model_name, capabilities_json, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run("driver_prompt_contract", "fake", "fake", "[]", 1, "2026-05-01T00:00:00.000Z");

      await repositories.llmCalls.save({
        id: "llm_prompt_contract",
        driverModelId: "driver_prompt_contract",
        taskType: "judge",
        promptHash: "hash_with_contract",
        promptContractId: "phase20pre-prompt-contract-v1",
        createdAt: "2026-05-01T00:00:00.000Z"
      });
      await repositories.llmCalls.save({
        id: "llm_legacy_without_contract",
        driverModelId: "driver_prompt_contract",
        taskType: "judge",
        promptHash: "legacy_hash",
        createdAt: "2026-05-01T00:00:01.000Z"
      });

      expect(await repositories.llmCalls.getById("llm_prompt_contract")).toMatchObject({
        promptContractId: "phase20pre-prompt-contract-v1"
      });
      expect((await repositories.llmCalls.getById("llm_legacy_without_contract"))?.promptContractId).toBeUndefined();
    } finally {
      repositories.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

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

  it("skips retired Node/Sector simulation runs when reading history", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "agent-major-db-"));
    const repositories = createSqliteRepositories(join(tempDir, "test.sqlite"));
    try {
      repositories.sqlite
        .prepare("INSERT INTO tournaments (id, name, status, format, created_at) VALUES (?, ?, ?, ?, ?)")
        .run("t_runs", "Runs", "running", "single_elimination_16", "2026-05-01T00:00:00.000Z");
      repositories.sqlite
        .prepare("INSERT INTO teams (id, tournament_id, display_name, short_name, seed, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run("team_runs_a", "t_runs", "Runs A", "RSA", 1, "2026-05-01T00:00:00.000Z");
      repositories.sqlite
        .prepare("INSERT INTO teams (id, tournament_id, display_name, short_name, seed, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run("team_runs_b", "t_runs", "Runs B", "RSB", 2, "2026-05-01T00:00:00.000Z");
      repositories.sqlite
        .prepare(
          `INSERT INTO matches (
            id, tournament_id, round_name, team_a_id, team_b_id, status, best_of, scheduled_order, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run("match_runs", "t_runs", "Round", "team_runs_a", "team_runs_b", "running", 1, 1, "2026-05-01T00:00:00.000Z");
      repositories.sqlite
        .prepare(
          `INSERT INTO matches (
            id, tournament_id, round_name, team_a_id, team_b_id, status, best_of, scheduled_order, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run("match_runs_retired", "t_runs", "Round", "team_runs_a", "team_runs_b", "failed", 1, 2, "2026-05-01T00:00:00.000Z");

      const insertRun = repositories.sqlite.prepare(
        `INSERT INTO simulation_runs (
          id, fixture_id, status, requested_mode, runtime_match_id, baseline_completed_rounds,
          estimated_total_rounds, expected_total_calls, latest_committed_round_number, has_fresh_replay, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      insertRun.run(
        "run_retired_node",
        "fixture_runs",
        "failed",
        "phase20_node_round_experimental",
        "match_runs_retired",
        0,
        1,
        0,
        0,
        0,
        "2026-05-01T00:00:01.000Z"
      );
      insertRun.run(
        "run_hex",
        "fixture_runs",
        "completed",
        "phase20_hex_round_experimental",
        "match_runs",
        0,
        1,
        0,
        1,
        1,
        "2026-05-01T00:00:02.000Z"
      );

      await expect(repositories.simulationRuns.getById("run_retired_node")).resolves.toBeNull();
      await expect(repositories.simulationRuns.listByFixtureId("fixture_runs")).resolves.toMatchObject([
        {
          id: "run_hex",
          requestedMode: "phase20_hex_round_experimental"
        }
      ]);
    } finally {
      repositories.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
