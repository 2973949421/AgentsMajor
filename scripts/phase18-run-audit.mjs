#!/usr/bin/env node

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const dbPath = resolve(process.argv[2] ?? "data/agent-major.sqlite");

if (!existsSync(dbPath)) {
  console.error(`数据库不存在：${dbPath}`);
  process.exit(1);
}

const db = openReadOnlyDatabase(dbPath);

try {
  db.exec("PRAGMA query_only = ON");
  const run = db.prepare(`
    SELECT id, status, requested_mode, runtime_match_id, runtime_map_game_id, latest_committed_round_number,
           expected_total_calls, latest_error, created_at, started_at, completed_at
    FROM simulation_runs
    ORDER BY created_at DESC
    LIMIT 1
  `).get();

  if (!run) {
    console.log("未找到 simulation_runs。");
    process.exit(0);
  }

  const mapGame = run.runtime_map_game_id
    ? db.prepare(`
        SELECT id, map_name, status, team_a_score, team_b_score, current_round_number, winner_team_id, started_at, completed_at
        FROM map_games
        WHERE id = ?
      `).get(run.runtime_map_game_id)
    : undefined;

  const rounds = run.runtime_map_game_id
    ? db.prepare(`
        SELECT id, round_number, status, winner_team_id, team_a_buy_type, team_b_buy_type, started_at, completed_at
        FROM rounds
        WHERE map_game_id = ?
        ORDER BY round_number ASC
      `).all(run.runtime_map_game_id)
    : [];

  const llmStatusRows = db.prepare(`
    SELECT task_type, COALESCE(status, 'unknown') AS status, COUNT(*) AS count
    FROM llm_calls
    WHERE match_id = ?
    GROUP BY task_type, COALESCE(status, 'unknown')
    ORDER BY task_type, status
  `).all(run.runtime_match_id);

  const hangingCalls = db.prepare(`
    SELECT id, task_type, round_id, agent_id, created_at
    FROM llm_calls
    WHERE match_id = ? AND COALESCE(status, 'started') = 'started'
    ORDER BY created_at DESC
    LIMIT 20
  `).all(run.runtime_match_id);

  const recentFailures = db.prepare(`
    SELECT id, task_type, round_id, status, error, created_at, completed_at
    FROM llm_calls
    WHERE match_id = ? AND error IS NOT NULL
    ORDER BY COALESCE(completed_at, created_at) DESC
    LIMIT 10
  `).all(run.runtime_match_id);

  const diagnostics = run.runtime_map_game_id
    ? db.prepare(`
        SELECT type, COUNT(*) AS count
        FROM events
        WHERE map_game_id = ? AND type IN ('score_tension_diagnostic', 'economy_output_diagnostic')
        GROUP BY type
        ORDER BY type
      `).all(run.runtime_map_game_id)
    : [];
  const effectiveRounds = rounds.filter((round) => isEffectiveRoundStatus(round.status));
  const classification = classifyRun({ run, hangingCalls, recentFailures, llmStatusRows });
  const recoveredSummary = buildRecoveredSummary({ run, recentFailures, llmStatusRows });

  printSection("最新 run");
  printRecord({
    id: run.id,
    status: run.status,
    mode: run.requested_mode,
    auditClassification: classification.kind,
    auditReason: classification.reason,
    latestCommittedRound: run.latest_committed_round_number,
    expectedTotalCalls: run.expected_total_calls,
    effectiveRounds: effectiveRounds.length,
    latestError: run.latest_error ?? null,
    startedAt: run.started_at,
    completedAt: run.completed_at
  });

  printSection("地图");
  if (mapGame) {
    printRecord({
      id: mapGame.id,
      map: mapGame.map_name,
      status: mapGame.status,
      score: `${mapGame.team_a_score}:${mapGame.team_b_score}`,
      currentRound: mapGame.current_round_number,
      winnerTeamId: mapGame.winner_team_id ?? null
    });
  } else {
    console.log("run 未绑定 map_game。");
  }

  printSection("回合");
  console.log(`effective/total: ${effectiveRounds.length}/${rounds.length}`);
  const latestRounds = rounds.slice(-8).map((round) => ({
    round: round.round_number,
    status: round.status,
    winner: round.winner_team_id ?? null,
    buy: `${round.team_a_buy_type ?? "-"} / ${round.team_b_buy_type ?? "-"}`
  }));
  console.table(latestRounds);

  printSection("LLM 调用状态");
  console.table(llmStatusRows);

  printSection("悬挂 started 调用");
  if (hangingCalls.length > 0) {
    console.table(hangingCalls);
  } else {
    console.log("无。");
  }

  printSection("最近失败 / recovered 线索");
  if (recentFailures.length > 0) {
    console.table(recentFailures.map((item) => ({
      id: item.id,
      task: item.task_type,
      roundId: item.round_id,
      status: item.status,
      error: shortText(item.error, 160)
    })));
  } else {
    console.log("无。");
  }

  printSection("Recovered 摘要");
  if (recoveredSummary) {
    printRecord(recoveredSummary);
  } else {
    console.log("无。");
  }

  printSection("诊断事件计数");
  console.table(diagnostics);
} finally {
  db.close();
}

function openReadOnlyDatabase(filePath) {
  try {
    return new DatabaseSync(filePath, { readOnly: true });
  } catch {
    return new DatabaseSync(filePath);
  }
}

function printSection(title) {
  console.log(`\n## ${title}`);
}

function printRecord(record) {
  for (const [key, value] of Object.entries(record)) {
    console.log(`${key}: ${value}`);
  }
}

function shortText(value, maxLength) {
  const text = String(value ?? "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function classifyRun({ run, hangingCalls, recentFailures, llmStatusRows }) {
  const latestError = String(run.latest_error ?? "");
  const failedCount = llmStatusRows
    .filter((row) => row.status === "failed")
    .reduce((sum, row) => sum + Number(row.count ?? 0), 0);
  if (hangingCalls.length > 0) {
    return {
      kind: "stale_started_call",
      reason: `存在 ${hangingCalls.length} 个 started 状态 LLM call，需要断点恢复或收尾。`
    };
  }
  if (isProviderNetworkFailure(latestError)) {
    return {
      kind: "provider_network_failure",
      reason: "最新错误是 provider 网络连接中断，可以重试或续跑，不应视为结构代码失败。"
    };
  }
  if (isExternalProviderBlocked(latestError)) {
    return {
      kind: "external_provider_blocked",
      reason: "最新错误是外部网络/安全策略阻断，不应视为代码结构失败。"
    };
  }
  if (isSchemaFailure(latestError) || recentFailures.some((item) => isSchemaFailure(item.error))) {
    return {
      kind: "schema_failure",
      reason: "失败信息包含 schema / validation / parse 线索，需要检查 LLM 输出边界。"
    };
  }
  if (run.status === "completed" && failedCount > 0) {
    return {
      kind: "completed_with_recovered_failures",
      reason: `run 已完成，但存在 ${failedCount} 个 failed LLM call，说明有 recovered failure。`
    };
  }
  if (run.status === "completed") {
    return {
      kind: "completed_clean_or_no_failed_calls",
      reason: "run 已完成，未发现 failed LLM call。"
    };
  }
  if (run.status === "failed") {
    return {
      kind: "terminal_failed",
      reason: latestError || "run failed 但 latest_error 为空。"
    };
  }
  return {
    kind: "in_progress_or_unknown",
    reason: `run 当前状态为 ${run.status}。`
  };
}

function buildRecoveredSummary({ run, recentFailures, llmStatusRows }) {
  if (run.status !== "completed") {
    return undefined;
  }
  const failedByTask = llmStatusRows.filter((row) => row.status === "failed");
  if (failedByTask.length === 0) {
    return undefined;
  }
  return {
    failedCallTasks: failedByTask.map((row) => `${row.task_type}:${row.count}`).join(", "),
    latestRecoveredError: shortText(recentFailures[0]?.error ?? "", 180)
  };
}

function isExternalProviderBlocked(error) {
  return /EACCES|ECONNREFUSED|ENOTFOUND/i.test(String(error ?? ""));
}

function isProviderNetworkFailure(error) {
  return /ECONNRESET|UND_ERR_SOCKET|socket disconnected|secure TLS connection|fetch failed|network|connect /i.test(String(error ?? ""));
}

function isSchemaFailure(error) {
  return /schema|validation|zod|parse|invalid_enum|json_parse|json_truncated/i.test(String(error ?? ""));
}

function isEffectiveRoundStatus(status) {
  return status === "completed" || status === "committed";
}
