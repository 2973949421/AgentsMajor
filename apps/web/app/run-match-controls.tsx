"use client";

import React, { useEffect, useMemo, useState } from "react";

import type { PublicWebRunnerPolicy } from "./server-web-runner-policy";
import styles from "./live-replay-player.module.css";

const phase18MatchId = "phase18_match_falcon_7b_vs_vitallmty";

export type RunState = "idle" | "running" | "success" | "failed";
export type RunMode = "phase18_next_round" | "phase18_current_map" | "phase18_full_bo3";
type AnyRunMode = RunMode | "phase17_showcase_match";
export type RunStatus = "running" | "completed" | "failed";

export interface ReplayGuardState {
  hidden: boolean;
  message: string;
}

export interface WebRunLlmCallProgress {
  callId: string;
  taskType: string;
  roundNumber: number;
  agentId?: string;
  driverModelId: string;
  status: "started" | "completed" | "failed";
  startedAt: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}

export interface WebRunProgress {
  runId: string;
  mode: AnyRunMode;
  matchId: string;
  targetMatchId: string;
  status: RunStatus;
  mapGameIds: string[];
  mapName: string;
  estimatedTotalRounds: number;
  baselineCompletedRounds: number;
  completedRounds: number;
  hasFreshReplay: boolean;
  currentRoundNumber: number | null;
  currentMapOrder: number | null;
  casterLines: number;
  progressPercent: number;
  llmSummary: {
    expectedTotalCalls: number;
    startedCalls: number;
    completedCalls: number;
    failedCalls: number;
    runningCalls: number;
  };
  llmCalls: WebRunLlmCallProgress[];
  error?: string;
  result?: {
    status: string;
    score: string;
  };
}

export interface RunMatchUiState {
  state: RunState;
  requestedMode: RunMode | null;
  progress: WebRunProgress | null;
  message: string;
}

interface RunMatchControlsProps {
  matchId: string;
  runnerPolicy: PublicWebRunnerPolicy;
  initialProgress?: WebRunProgress | null;
  onReplayGuardChange?: (guard: ReplayGuardState) => void;
  onUiStateChange?: (uiState: RunMatchUiState) => void;
}

export function RunMatchControls({
  matchId,
  runnerPolicy,
  initialProgress = null,
  onReplayGuardChange,
  onUiStateChange
}: RunMatchControlsProps) {
  const initialUiState = useMemo(() => buildInitialRunMatchUiState(initialProgress), [initialProgress]);
  const [state, setState] = useState<RunState>(initialUiState.state);
  const [message, setMessage] = useState(initialUiState.message);
  const [adminToken, setAdminToken] = useState("");
  const [progress, setProgress] = useState<WebRunProgress | null>(initialUiState.progress);
  const [requestedMode, setRequestedMode] = useState<RunMode | null>(initialUiState.requestedMode);

  useEffect(() => {
    const next = buildInitialRunMatchUiState(initialProgress);
    setState(next.state);
    setMessage(next.message);
    setProgress(next.progress);
    setRequestedMode(next.requestedMode);
  }, [initialProgress?.runId, initialProgress?.status]);

  useEffect(() => {
    onUiStateChange?.({
      state,
      requestedMode,
      progress,
      message
    });
  }, [message, onUiStateChange, progress, requestedMode, state]);

  useEffect(() => {
    if (state !== "running" || !progress?.runId) {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const progressMatchId = progress.targetMatchId || progress.matchId;
        const response = await fetch(`/api/matches/${encodeURIComponent(progressMatchId)}/run?runId=${encodeURIComponent(progress.runId)}`, {
          method: "GET",
          cache: "no-store"
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: string; progress?: WebRunProgress };
        if (!response.ok) {
          throw new Error(payload.error ?? `Progress failed with HTTP ${response.status}`);
        }
        if (cancelled || !payload.progress) {
          return;
        }

        const nextProgress = payload.progress;
        setProgress(nextProgress);
        if (nextProgress.status === "completed") {
          setState("success");
          setMessage(buildCompletedMessage(nextProgress));
          window.setTimeout(() => {
            window.location.assign(buildReplayUrl(nextProgress.targetMatchId));
          }, 700);
          return;
        }
        if (nextProgress.status === "failed") {
          setState("failed");
          setMessage(nextProgress.error ?? "运行失败。");
        }
      } catch (error) {
        if (!cancelled) {
          setState("failed");
          setMessage(error instanceof Error ? error.message : "轮询运行进度失败。");
        }
      }
    };

    const intervalId = window.setInterval(poll, 1000);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [progress?.matchId, progress?.runId, progress?.targetMatchId, state]);

  useEffect(() => {
    if (!onReplayGuardChange) {
      return;
    }

    if (state === "running") {
      onReplayGuardChange({
        hidden: true,
        message: "Phase 1.8 当前仍在生成，新回放事实提交前会继续隐藏旧 replay。"
      });
      return;
    }

    if (state === "failed" && !(progress?.hasFreshReplay ?? false)) {
      onReplayGuardChange({
        hidden: true,
        message: progress?.error
          ? `Phase 1.8 本次运行在提交新回放前失败：${progress.error}`
          : "Phase 1.8 本次运行在提交新回放前失败。"
      });
      return;
    }

    onReplayGuardChange({ hidden: false, message: "" });
  }, [onReplayGuardChange, progress?.error, progress?.hasFreshReplay, state]);

  const helperText =
    message ||
    "默认从“生成下一局”开始做单局验收。确认路径稳定后，再扩大到整张图和整场 BO3。";

  const runSummaryItems = progress
    ? [
        { label: "运行状态", value: formatRunStatusLabel(progress.status) },
        { label: "已提交局数", value: String(progress.completedRounds) },
        { label: "当前地图", value: progress.currentMapOrder ? `M${progress.currentMapOrder}` : "--" },
        { label: "当前回合", value: progress.currentRoundNumber ? `R${progress.currentRoundNumber}` : "--" },
        { label: "预期调用", value: String(progress.llmSummary.expectedTotalCalls) },
        { label: "已完成调用", value: String(progress.llmSummary.completedCalls) }
      ]
    : [
        { label: "运行状态", value: formatLocalStateLabel(state) },
        { label: "已提交局数", value: "0" },
        { label: "当前地图", value: "--" },
        { label: "当前回合", value: "--" },
        { label: "预期调用", value: "0" },
        { label: "已完成调用", value: "0" }
      ];

  if (!runnerPolicy.enabled) {
    return (
      <section className={styles.opsControlStack}>
        <div className={styles.opsStatusCard}>
          <strong>本地运行器未开启</strong>
          <span className={styles.opsMetaLine}>{formatDisabledReason(runnerPolicy.disabledReason)}</span>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.opsControlStack}>
      {runnerPolicy.requiresToken ? (
        <input
          className={styles.runControlsInput}
          type="password"
          value={adminToken}
          onChange={(event) => setAdminToken(event.target.value)}
          placeholder="本地运行令牌"
          autoComplete="off"
        />
      ) : null}

      <div className={styles.opsActionGrid}>
        <button type="button" className={styles.opsActionPrimary} onClick={() => handleRun("phase18_next_round")} disabled={state === "running"}>
          {state === "running" && progress?.mode === "phase18_next_round" ? "正在生成下一局..." : "生成下一局"}
        </button>
        <button type="button" className={styles.opsActionSecondary} onClick={() => handleRun("phase18_current_map")} disabled={state === "running"}>
          {state === "running" && progress?.mode === "phase18_current_map" ? "正在生成当前地图..." : "生成当前地图"}
        </button>
        <button type="button" className={styles.opsActionSecondary} onClick={() => handleRun("phase18_full_bo3")} disabled={state === "running"}>
          {state === "running" && progress?.mode === "phase18_full_bo3" ? "正在生成整场 BO3..." : "生成整场 BO3"}
        </button>
      </div>

      <div className={styles.opsSummaryGrid}>
        {runSummaryItems.map((item) => (
          <div key={item.label} className={styles.opsSummaryItem}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>

      {progress ? (
        <div className={styles.opsStatusCard} aria-label="match run progress">
          <div className={styles.opsStatusRow}>
            <strong>{progress.status === "running" ? "实时进度" : progress.status === "failed" ? "运行失败" : "运行完成"}</strong>
            <span className={styles.opsMetaLine}>
              {progress.currentMapOrder ? `M${progress.currentMapOrder}` : "--"} / {progress.currentRoundNumber ? `R${progress.currentRoundNumber}` : "--"}
            </span>
          </div>
          <div className={styles.opsCallGrid}>
            <span>已启动 {progress.llmSummary.startedCalls}</span>
            <span>进行中 {progress.llmSummary.runningCalls}</span>
            <span>已完成 {progress.llmSummary.completedCalls}</span>
            <span>已失败 {progress.llmSummary.failedCalls}</span>
          </div>
          {progress.error ? <span className={styles.opsErrorText}>最近错误：{progress.error}</span> : null}
        </div>
      ) : null}

      <details className={styles.opsDisclosure}>
        <summary>展开完整 LLM 调用明细</summary>
        <div className={styles.opsDisclosureBody}>
          {progress?.llmCalls.length ? (
            <div className={styles.opsTableWrap}>
              <table className={styles.opsTable}>
                <thead>
                  <tr>
                    <th>回合</th>
                    <th>任务</th>
                    <th>执行者</th>
                    <th>模型</th>
                    <th>状态</th>
                    <th>耗时</th>
                    <th>Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {progress.llmCalls.map((call) => (
                    <tr key={call.callId}>
                      <td>R{call.roundNumber}</td>
                      <td>{formatTaskType(call.taskType)}</td>
                      <td>{formatLlmActor(call)}</td>
                      <td>{call.driverModelId}</td>
                      <td>{formatLlmStatus(call.status)}</td>
                      <td>{typeof call.latencyMs === "number" ? `${call.latencyMs} ms` : "--"}</td>
                      <td>
                        {typeof call.inputTokens === "number" || typeof call.outputTokens === "number"
                          ? `${call.inputTokens ?? 0}/${call.outputTokens ?? 0}`
                          : call.error ?? "--"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <span className={styles.opsMetaLine}>等待 LLM 调用事件...</span>
          )}
        </div>
      </details>

      <span className={state === "failed" ? styles.opsErrorText : styles.opsHelperText}>{helperText}</span>
    </section>
  );

  async function handleRun(mode: RunMode) {
    setState("running");
    setProgress(null);
    setRequestedMode(mode);
    setMessage(runStartMessage(mode));
    try {
      const response = await fetch(`/api/matches/${encodeURIComponent(matchId || phase18MatchId)}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          confirmReset: true,
          ...(adminToken.trim() ? { adminToken: adminToken.trim() } : {})
        })
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; summary?: string; progress?: WebRunProgress };
      if (!response.ok) {
        throw new Error(payload.error ?? `Run failed with HTTP ${response.status}`);
      }

      setProgress(payload.progress ?? null);
      setMessage(payload.summary ?? "本地运行已启动。");
    } catch (error) {
      setState("failed");
      setMessage(error instanceof Error ? error.message : "未知运行错误。");
    }
  }
}

export function buildInitialRunMatchUiState(initialProgress: WebRunProgress | null | undefined): RunMatchUiState {
  if (!initialProgress) {
    return {
      state: "idle",
      requestedMode: null,
      progress: null,
      message: ""
    };
  }

  if (initialProgress.status === "running") {
    return {
      state: "running",
      requestedMode: isPhase18Mode(initialProgress.mode) ? initialProgress.mode : null,
      progress: initialProgress,
      message: "正在恢复当前的 Phase 1.8 本地运行..."
    };
  }

  if (initialProgress.status === "failed") {
    return {
      state: "failed",
      requestedMode: isPhase18Mode(initialProgress.mode) ? initialProgress.mode : null,
      progress: initialProgress,
      message: initialProgress.error ?? "最近一次 Phase 1.8 运行失败。"
    };
  }

  return {
    state: "success",
    requestedMode: isPhase18Mode(initialProgress.mode) ? initialProgress.mode : null,
    progress: initialProgress,
    message: buildCompletedMessage(initialProgress)
  };
}

function buildReplayUrl(matchId: string): string {
  return `/?matchId=${encodeURIComponent(matchId)}`;
}

function buildCompletedMessage(progress: WebRunProgress): string {
  return `运行完成。比分 ${progress.result?.score ?? "待定"}，LLM 调用 ${progress.llmSummary.completedCalls}/${
    progress.llmSummary.expectedTotalCalls || progress.llmSummary.startedCalls
  }。`;
}

function isPhase18Mode(mode: AnyRunMode): mode is RunMode {
  return mode === "phase18_next_round" || mode === "phase18_current_map" || mode === "phase18_full_bo3";
}

function runStartMessage(mode: RunMode): string {
  switch (mode) {
    case "phase18_next_round":
      return "开始执行 Phase 1.8 单局真实 LLM 生成...";
    case "phase18_current_map":
      return "开始执行 Phase 1.8 当前地图真实 LLM 生成...";
    case "phase18_full_bo3":
    default:
      return "开始执行 Phase 1.8 整场 BO3 真实 LLM 生成...";
  }
}

function formatTaskType(taskType: string): string {
  switch (taskType) {
    case "team_plan":
      return "队伍计划";
    case "agent_action":
      return "选手行动";
    case "judge":
      return "裁判";
    case "judge_review":
      return "复审裁判";
    default:
      return taskType;
  }
}

function formatLlmActor(call: WebRunLlmCallProgress): string {
  if (call.agentId) {
    return call.agentId;
  }
  if (call.taskType === "team_plan") {
    return "队伍";
  }
  if (call.taskType === "judge_review") {
    return "复审裁判";
  }
  return "裁判";
}

function formatLlmStatus(status: WebRunLlmCallProgress["status"]): string {
  switch (status) {
    case "started":
      return "进行中";
    case "failed":
      return "失败";
    case "completed":
    default:
      return "完成";
  }
}

function formatRunStatusLabel(status: WebRunProgress["status"]): string {
  switch (status) {
    case "running":
      return "生成中";
    case "failed":
      return "失败";
    case "completed":
    default:
      return "完成";
  }
}

function formatLocalStateLabel(state: RunState): string {
  switch (state) {
    case "running":
      return "生成中";
    case "failed":
      return "失败";
    case "success":
      return "完成";
    case "idle":
    default:
      return "空闲";
  }
}

function formatDisabledReason(reason: PublicWebRunnerPolicy["disabledReason"]): string {
  switch (reason) {
    case "web_runner_production_disabled":
      return "生产模式下已禁用";
    case "web_runner_production_requires_token":
      return "生产模式下必须提供令牌";
    case "web_runner_remote_requires_token":
      return "远程访问必须提供令牌";
    case "web_runner_disabled":
    default:
      return "请设置 AGENT_MAJOR_WEB_RUNNER_ENABLED=true";
  }
}
