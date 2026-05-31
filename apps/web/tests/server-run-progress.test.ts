import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createSqliteRepositories } from "@agent-major/db";
import { describe, expect, it } from "vitest";

import { readMapProgressSnapshot, summarizeLlmCalls, type WebRunLlmCallProgress } from "../app/server-run-progress";
import { listPhase18RunHistoryEntries, syncPhase18SimulationRun } from "../app/server-phase18-runs";

describe("Phase 1.8 web run progress", () => {
  it("tracks the current running map instead of the max round across all maps", () => {
    const repositories = createSqliteRepositories(resolve(mkdtempSync(resolve(tmpdir(), "agent-major-web-progress-")), "agent-major.sqlite"));
    try {
      seedPhase18ProgressFixture(repositories);

      const snapshot = readMapProgressSnapshot(repositories, ["map-1", "map-2", "map-3"]);

      expect(snapshot.completedRounds).toBe(13);
      expect(snapshot.currentMapGameId).toBe("map-2");
      expect(snapshot.currentMapOrder).toBe(2);
      expect(snapshot.currentRoundNumber).toBe(1);
    } finally {
      repositories.close();
    }
  });

  it("expands expected Phase 1.8 LLM calls when repair/review adds extra calls", () => {
    const calls = Array.from({ length: 15 }, (_, index) => phase18Call(index));

    const summary = summarizeLlmCalls(14, calls);

    expect(summary.expectedTotalCalls).toBe(15);
    expect(summary.startedCalls).toBe(15);
    expect(summary.completedCalls).toBe(13);
    expect(summary.failedCalls).toBe(1);
    expect(summary.runningCalls).toBe(1);
  });

  it("promotes stale scheduled runs with completedAt and replay facts to completed", async () => {
    const repositories = createSqliteRepositories(resolve(mkdtempSync(resolve(tmpdir(), "agent-major-web-progress-")), "agent-major.sqlite"));
    try {
      seedPhase18ProgressFixture(repositories);
      const createdAt = "2026-05-04T00:00:00.000Z";
      await repositories.simulationRuns.save({
        id: "run-1",
        fixtureId: "phase18_match_falcon_7b_vs_vitallmty",
        status: "scheduled",
        requestedMode: "phase18_next_round",
        runtimeMatchId: "match-1",
        runtimeMapGameId: "map-2",
        baselineCompletedRounds: 12,
        estimatedTotalRounds: 13,
        expectedTotalCalls: 15,
        latestCommittedRoundNumber: 0,
        hasFreshReplay: false,
        createdAt,
        startedAt: createdAt,
        completedAt: "2026-05-04T00:01:00.000Z"
      });

      const { run } = await syncPhase18SimulationRun(repositories, {
        id: "run-1",
        fixtureId: "phase18_match_falcon_7b_vs_vitallmty",
        status: "scheduled",
        requestedMode: "phase18_next_round",
        runtimeMatchId: "match-1",
        runtimeMapGameId: "map-2",
        baselineCompletedRounds: 12,
        estimatedTotalRounds: 13,
        expectedTotalCalls: 15,
        latestCommittedRoundNumber: 0,
        hasFreshReplay: false,
        createdAt,
        startedAt: createdAt,
        completedAt: "2026-05-04T00:01:00.000Z"
      });

      expect(run.status).toBe("completed");
      expect(run.latestCommittedRoundNumber).toBe(1);
      expect(run.hasFreshReplay).toBe(true);
    } finally {
      repositories.close();
    }
  });

  it("keeps the Phase 2.0-pre benchmark run visible even outside the recent limit", async () => {
    const repositories = createSqliteRepositories(resolve(mkdtempSync(resolve(tmpdir(), "agent-major-web-progress-")), "agent-major.sqlite"));
    try {
      seedPhase18ProgressFixture(repositories);
      const createdAt = "2026-05-04T00:00:00.000Z";
      await repositories.simulationRuns.save({
        id: "phase18_run_mpqtbys9",
        fixtureId: "phase18_match_falcon_7b_vs_vitallmty",
        status: "completed",
        requestedMode: "phase18_full_bo3",
        runtimeMatchId: "match-1",
        runtimeMapGameId: "map-1",
        baselineCompletedRounds: 0,
        estimatedTotalRounds: 17,
        expectedTotalCalls: 238,
        latestCommittedRoundNumber: 12,
        hasFreshReplay: true,
        createdAt,
        startedAt: createdAt,
        completedAt: "2026-05-04T00:30:00.000Z"
      });

      for (let index = 0; index < 3; index += 1) {
        repositories.sqlite
          .prepare(
            `INSERT INTO matches (
               id, tournament_id, round_name, team_a_id, team_b_id, status, best_of, team_a_maps_won, team_b_maps_won, scheduled_order, created_at, started_at
             ) VALUES (?, 'tournament-1', 'round_of_16', 'team-a', 'team-b', 'running', 3, 0, 0, ?, ?, ?)`
          )
          .run(
            `match-new-${index}`,
            index + 2,
            `2026-05-04T00:0${index + 1}:00.000Z`,
            `2026-05-04T00:0${index + 1}:00.000Z`
          );
        await repositories.simulationRuns.save({
          id: `phase18_run_new_${index}`,
          fixtureId: "phase18_match_falcon_7b_vs_vitallmty",
          status: "failed",
          requestedMode: "phase18_next_round",
          runtimeMatchId: `match-new-${index}`,
          baselineCompletedRounds: 0,
          estimatedTotalRounds: 1,
          expectedTotalCalls: 14,
          latestCommittedRoundNumber: 0,
          hasFreshReplay: false,
          createdAt: `2026-05-04T00:0${index + 1}:00.000Z`,
          startedAt: `2026-05-04T00:0${index + 1}:00.000Z`,
          completedAt: `2026-05-04T00:0${index + 1}:30.000Z`
        });
      }

      const history = await listPhase18RunHistoryEntries(repositories, "phase18_match_falcon_7b_vs_vitallmty", 1);

      expect(history.map((entry) => entry.runId)).toContain("phase18_run_mpqtbys9");
      expect(history.find((entry) => entry.runId === "phase18_run_mpqtbys9")?.benchmarkLabel).toBe("Phase 2.0-pre 基准样本");
    } finally {
      repositories.close();
    }
  });
});

function seedPhase18ProgressFixture(repositories: ReturnType<typeof createSqliteRepositories>): void {
  repositories.sqlite.exec(`
    INSERT INTO tournaments (id, name, status, format, created_at) VALUES ('tournament-1', 'Phase18', 'running', 'single_elimination_16', '2026-05-04T00:00:00.000Z');
    INSERT INTO teams (id, tournament_id, display_name, short_name, seed, created_at) VALUES
      ('team-a', 'tournament-1', 'Falcon-7B', 'F7B', 1, '2026-05-04T00:00:00.000Z'),
      ('team-b', 'tournament-1', 'VitaLLMty', 'VIT', 2, '2026-05-04T00:00:00.000Z');
    INSERT INTO driver_models (id, provider, model_name, capabilities_json, enabled, created_at) VALUES
      ('driver-1', 'dashscope', 'qwen-max', '[]', 1, '2026-05-04T00:00:00.000Z');
    INSERT INTO matches (
      id, tournament_id, round_name, team_a_id, team_b_id, status, best_of, team_a_maps_won, team_b_maps_won, scheduled_order, created_at, started_at
    ) VALUES (
      'match-1', 'tournament-1', 'round_of_16', 'team-a', 'team-b', 'running', 3, 1, 0, 1, '2026-05-04T00:00:00.000Z', '2026-05-04T00:00:00.000Z'
    );
    INSERT INTO map_games (
      id, match_id, map_name, map_order, status, team_a_score, team_b_score, current_round_number, winner_team_id, created_at, started_at, completed_at
    ) VALUES
      ('map-1', 'match-1', 'DUST2', 1, 'completed', 7, 5, 12, 'team-a', '2026-05-04T00:00:00.000Z', '2026-05-04T00:00:00.000Z', '2026-05-04T00:20:00.000Z'),
      ('map-2', 'match-1', 'INFERNO', 2, 'running', 1, 0, 1, NULL, '2026-05-04T00:21:00.000Z', '2026-05-04T00:21:00.000Z', NULL),
      ('map-3', 'match-1', 'MIRAGE', 3, 'scheduled', 0, 0, 0, NULL, '2026-05-04T00:40:00.000Z', NULL, NULL);
  `);

  for (let roundNumber = 1; roundNumber <= 12; roundNumber += 1) {
    insertRoundReport(repositories, {
      roundId: `round-map-1-${roundNumber}`,
      reportId: `report-map-1-${roundNumber}`,
      mapGameId: "map-1",
      roundNumber
    });
  }
  insertRoundReport(repositories, {
    roundId: "round-map-2-1",
    reportId: "report-map-2-1",
    mapGameId: "map-2",
    roundNumber: 1
  });
}

function insertRoundReport(
  repositories: ReturnType<typeof createSqliteRepositories>,
  input: { roundId: string; reportId: string; mapGameId: string; roundNumber: number }
): void {
  repositories.sqlite
    .prepare(
      `INSERT INTO rounds (
         id, map_game_id, round_number, status, team_a_active_agent_ids_json, team_b_active_agent_ids_json, winner_team_id, started_at, completed_at
       ) VALUES (?, ?, ?, 'completed', '[]', '[]', 'team-a', '2026-05-04T00:00:00.000Z', '2026-05-04T00:01:00.000Z')`
    )
    .run(input.roundId, input.mapGameId, input.roundNumber);
  repositories.sqlite
    .prepare(
      `INSERT INTO round_reports (
         id, tournament_id, match_id, map_game_id, round_id, round_number, map_name, winner_team_id, score_before_round_json, score_after_round_json,
         judge_result_json, agent_outputs_json, key_events_json, economy_delta_json, token_submission_json, summary, event_projection_json, created_at
       ) VALUES (?, 'tournament-1', 'match-1', ?, ?, ?, 'DUST2', 'team-a', '{"teamA":0,"teamB":0}', '{"teamA":1,"teamB":0}',
         '{"winnerTeamId":"team-a","loserTeamId":"team-b","margin":"standard","reason":"fixture","mvpAgentId":"agent-a","confidence":0.8}',
         '[]', '[]', '{"agents":[],"teamTotals":{"teamA":0,"teamB":0}}', '{"activeAgentIds":[],"submittedOutputIds":[],"totalOutputBudget":0,"outputGate":{"applied":false,"reason":"fixture"}}',
         'fixture', '{"coreEventsLinkedByRoundReport":[],"broadcastEventsCreated":[]}', '2026-05-04T00:01:00.000Z')`
    )
    .run(input.reportId, input.mapGameId, input.roundId, input.roundNumber);
}

function phase18Call(index: number): WebRunLlmCallProgress {
  if (index === 13) {
    return {
      callId: "call-running",
      taskType: "judge",
      roundNumber: 1,
      driverModelId: "driver-1",
      status: "started",
      startedAt: "2026-05-04T00:00:00.000Z"
    };
  }
  if (index === 14) {
    return {
      callId: "call-failed",
      taskType: "judge_review",
      roundNumber: 1,
      driverModelId: "driver-1",
      status: "failed",
      startedAt: "2026-05-04T00:00:00.000Z",
      error: "fixture failure"
    };
  }
  return {
    callId: `call-${index}`,
    taskType: index < 2 ? "team_plan" : "agent_action",
    roundNumber: 1,
    driverModelId: "driver-1",
    status: "completed",
    startedAt: "2026-05-04T00:00:00.000Z",
    latencyMs: 10,
    inputTokens: 20,
    outputTokens: 10
  };
}
