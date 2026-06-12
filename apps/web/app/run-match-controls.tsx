"use client";

import React, { useEffect, useMemo, useState } from "react";

import type { LiveReplayData } from "./live-replay-model";
import type { PublicWebRunnerPolicy } from "./server-web-runner-policy";
import styles from "./live-replay-player.module.css";

const phase18FixtureId = "phase18_match_falcon_7b_vs_vitallmty";

export type RunState = "idle" | "running" | "paused" | "stopped" | "success" | "failed";
export type RunMode =
  | "phase18_next_round"
  | "phase18_current_map"
  | "phase18_keep_generating_map"
  | "phase18_full_bo3"
  | "phase20_hex_round_experimental"
  | "phase20_hex_map_experimental";
type RunRetryMode = "full_round" | "resume_from_stage";
type AnyRunMode = RunMode | "phase17_showcase_match";
type ResetScope = "round" | "map" | "match";
export type RunStatus = "scheduled" | "running" | "completed" | "failed" | "discarded";

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
  promptContractId?: string;
  status: "started" | "completed" | "failed";
  startedAt: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
  responseArtifactId?: string;
  rawTextPreview?: string;
  parseCandidatePreview?: string;
  repairRawTextPreview?: string;
  repaired?: boolean;
}

export interface RunMatchHistoryEntry {
  runId: string;
  fixtureId: string;
  runtimeMatchId: string;
  requestedMode: RunMode;
  status: RunStatus;
  mapLabel: string;
  completedRounds: number;
  latestCommittedRoundNumber: number;
  hasFreshReplay: boolean;
  createdAt: string;
  scoreLabel: string;
  latestError?: string;
  promptContractId?: string;
  contractStatus?: "current" | "legacy" | "mixed" | "blocked";
  benchmarkLabel?: string;
}

export interface WebRunProgress {
  runId: string;
  mode: AnyRunMode;
  currentExecutionMode?: AnyRunMode;
  currentExecutionStatus?: "running" | "completed" | "failed";
  matchId: string;
  fixtureId: string;
  runtimeMatchId: string;
  targetMatchId: string;
  status: RunStatus;
  mapGameId: string;
  mapGameIds: string[];
  mapName: string;
  estimatedTotalRounds: number;
  baselineCompletedRounds: number;
  completedRounds: number;
  hasFreshReplay: boolean;
  currentRoundNumber: number | null;
  currentMapOrder: number | null;
  latestCommittedRoundNumber: number;
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
  currentExecutionId?: string;
  currentOuterAttemptNumber?: number;
  latestRetryReason?: string;
  recoveredFailureCount: number;
  latestRecoveredError?: string;
  currentExecutionStartedCalls: number;
  currentExecutionCompletedCalls: number;
  currentExecutionFailedCalls: number;
  currentExecutionRunningCalls: number;
  promptContractId?: string;
  contractStatus?: "current" | "legacy" | "mixed" | "blocked";
  recentRuns: RunMatchHistoryEntry[];
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

type CoachPostMatchReviewEntry = LiveReplayData["postMatchReviews"][number];

interface RunMatchControlsProps {
  matchId: string;
  runnerPolicy: PublicWebRunnerPolicy;
  initialProgress?: WebRunProgress | null;
  initialRunHistory?: RunMatchHistoryEntry[];
  postMatchReviews?: CoachPostMatchReviewEntry[];
  onReplayGuardChange?: (guard: ReplayGuardState) => void;
  onUiStateChange?: (uiState: RunMatchUiState) => void;
  onResetCurrentMapView?: () => void;
  onResetMatchView?: () => void;
}

interface RunRoutePayload {
  error?: string;
  summary?: string;
  progress?: WebRunProgress;
  replayUrl?: string;
  progressUrl?: string;
}

export function RunMatchControls({
  matchId,
  runnerPolicy,
  initialProgress = null,
  initialRunHistory = [],
  postMatchReviews = [],
  onReplayGuardChange,
  onUiStateChange,
  onResetCurrentMapView,
  onResetMatchView
}: RunMatchControlsProps) {
  const initialUiState = useMemo(() => buildInitialRunMatchUiState(initialProgress), [initialProgress]);
  const [state, setState] = useState<RunState>(initialUiState.state);
  const [message, setMessage] = useState(initialUiState.message);
  const [adminToken, setAdminToken] = useState("");
  const [progress, setProgress] = useState<WebRunProgress | null>(initialUiState.progress);
  const [requestedMode, setRequestedMode] = useState<RunMode | null>(initialUiState.requestedMode);
  const [trackingPaused, setTrackingPaused] = useState(false);
  const [trackingStopped, setTrackingStopped] = useState(false);
  const [history, setHistory] = useState<RunMatchHistoryEntry[]>(initialProgress?.recentRuns ?? initialRunHistory);
  const [reviewEntries, setReviewEntries] = useState<CoachPostMatchReviewEntry[]>(postMatchReviews);
  const [reviewActionState, setReviewActionState] = useState<{ teamId: string; action: "approve" | "dismiss" } | null>(null);

  useEffect(() => {
    const next = buildInitialRunMatchUiState(initialProgress);
    setState(next.state);
    setMessage(next.message);
    setProgress(next.progress);
    setRequestedMode(next.requestedMode);
    setHistory(initialProgress?.recentRuns ?? initialRunHistory);
  }, [initialProgress?.runId, initialProgress?.status, initialRunHistory]);

  useEffect(() => {
    setReviewEntries(postMatchReviews);
  }, [postMatchReviews]);

  useEffect(() => {
    onUiStateChange?.({
      state,
      requestedMode,
      progress,
      message
    });
  }, [message, onUiStateChange, progress, requestedMode, state]);

  useEffect(() => {
    if (state !== "running" || trackingPaused || trackingStopped || !progress?.runId) {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/matches/${encodeURIComponent(matchId)}/run?runId=${encodeURIComponent(progress.runId)}`, {
          method: "GET",
          cache: "no-store"
        });
        const payload = (await response.json().catch(() => ({}))) as RunRoutePayload;
        if (!response.ok) {
          throw new Error(payload.error ?? `Progress failed with HTTP ${response.status}`);
        }
        if (cancelled || !payload.progress) {
          return;
        }

        const nextProgress = payload.progress;
        setProgress(nextProgress);
        setHistory(nextProgress.recentRuns);
        if (nextProgress.status === "completed" || nextProgress.status === "scheduled") {
          setState("success");
          setMessage(buildCompletedMessage(nextProgress));
          window.setTimeout(() => {
            window.location.assign(buildReplayUrl(nextProgress.runId));
          }, 600);
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
  }, [matchId, progress?.runId, state, trackingPaused, trackingStopped]);

  useEffect(() => {
    if (!onReplayGuardChange) {
      return;
    }

    if (progress?.status === "running") {
      onReplayGuardChange({
        hidden: true,
        message:
          state === "paused"
            ? "当前生成已暂停本地跟踪，新 replay 在恢复跟踪或重新进入页面前继续隐藏。"
            : state === "stopped"
              ? "当前生成已停止本地跟踪；如后端仍在运行，请等待它自然结束后再重新进入。"
              : "当前 run 仍在生成中，新回放事实提交之前不会展示该 run 的 replay。"
      });
      return;
    }

    if (state === "failed" && !(progress?.hasFreshReplay ?? false)) {
      onReplayGuardChange({
        hidden: true,
        message: progress?.error
          ? `本次 run 在提交任何 replay 事实之前失败：${progress.error}`
          : "本次 run 在提交任何 replay 事实之前失败。"
      });
      return;
    }

    onReplayGuardChange({ hidden: false, message: "" });
  }, [onReplayGuardChange, progress?.error, progress?.hasFreshReplay, progress?.status, state]);

  const activeRunStatusLabel = progress
    ? state === "paused" || state === "stopped"
      ? formatLocalStateLabel(state)
      : formatRunStatusLabel(progress.status)
    : formatLocalStateLabel(state);
  const failedAttemptNotice = progress ? buildFailedAttemptNotice(progress) : null;
  const canRetryCurrentRound =
    progress !== null && Boolean(progress.runId) && progress.status === "failed" && progress.contractStatus !== "blocked" && progress.contractStatus !== "mixed";
  const nextRoundButtonLabel = canRetryCurrentRound
    ? state === "running"
      ? "正在重试当前回合..."
      : "重试该回合"
    : state === "running" && progress?.mode === "phase18_next_round"
      ? "正在生成下一局..."
      : "生成下一局";
  const helperText =
    message ||
    (canRetryCurrentRound
      ? "当前 run 失败但该回合尚未提交；可完整重试该回合，也可从已校验阶段断点继续。"
      : "默认从“生成下一局”开始做单局验收。需要连续验证时，再扩展到当前地图或整场 BO3。");

  const runSummaryItems = progress
    ? [
        { label: "运行状态", value: activeRunStatusLabel },
        { label: "已提交局数", value: String(progress.completedRounds) },
        { label: "契约状态", value: formatContractStatus(progress.contractStatus) },
        { label: "当前地图", value: progress.currentMapOrder ? `M${progress.currentMapOrder}` : "--" },
        { label: "当前回合", value: progress.currentRoundNumber ? `R${progress.currentRoundNumber}` : "--" },
        { label: "调用预估", value: formatExpectedCalls(progress) },
        { label: "历史完成调用", value: String(progress.llmSummary.completedCalls) },
        { label: "本次完成调用", value: String(progress.currentExecutionCompletedCalls ?? 0) },
        { label: "当前尝试", value: progress.currentOuterAttemptNumber ? `#${progress.currentOuterAttemptNumber}` : "--" },
        { label: "已恢复失败", value: String(progress.recoveredFailureCount ?? 0) }
      ]
    : [
        { label: "运行状态", value: formatLocalStateLabel(state) },
        { label: "已提交局数", value: "0" },
        { label: "契约状态", value: "契约未知" },
        { label: "当前地图", value: "--" },
        { label: "当前回合", value: "--" },
        { label: "调用预估", value: "当前回合约 14 次" },
        { label: "历史完成调用", value: "0" },
        { label: "本次完成调用", value: "0" },
        { label: "当前尝试", value: "--" },
        { label: "已恢复失败", value: "0" }
      ];

  if (!runnerPolicy.enabled) {
    return (
      <section className={styles.opsControlStack}>
        <div className={styles.opsStatusCard}>
          <strong>本地运行器未启用</strong>
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
          placeholder="本地运行口令"
          autoComplete="off"
        />
      ) : null}

      <div className={styles.opsActionGrid}>
        <button
          type="button"
          className={styles.opsActionPrimary}
          onClick={() => handleRun("phase18_next_round", "full_round")}
          disabled={state === "running" || (progress?.status === "failed" && !canRetryCurrentRound)}
          title={canRetryCurrentRound ? "重试当前 run 的未提交回合，不创建新 run。" : undefined}
        >
          {nextRoundButtonLabel}
        </button>
        {canRetryCurrentRound ? (
          <button
            type="button"
            className={styles.opsActionSecondary}
            onClick={() => handleRun("phase18_next_round", "resume_from_stage")}
            disabled={state === "running"}
            title="复用同一回合内已经通过校验的 team_plan、agent_action、judge 等阶段，只从失败点继续。"
          >
            {state === "running" ? "断点继续中..." : "断点继续"}
          </button>
        ) : null}
        <button type="button" className={styles.opsActionSecondary} onClick={() => handleRun("phase18_current_map")} disabled={state === "running"}>
          {state === "running" && progress?.mode === "phase18_current_map" ? "正在生成当前地图..." : "生成当前地图"}
        </button>
        <button type="button" className={styles.opsActionSecondary} onClick={() => handleRun("phase18_keep_generating_map")} disabled={state === "running"}>
          {state === "running" && progress?.mode === "phase18_keep_generating_map" ? "一直生成中..." : "一直生成"}
        </button>
        <button type="button" className={styles.opsActionSecondary} onClick={() => handleRun("phase18_full_bo3")} disabled={state === "running"}>
          {state === "running" && progress?.mode === "phase18_full_bo3" ? "正在生成整场 BO3..." : "生成整场 BO3"}
        </button>
        <a className={styles.opsActionSecondary} href="/hex-lab/match" title="进入 Hex Web 验收台；旧 Node/Sector 实验入口已收口。">
          进入 Hex 验收台
        </a>
      </div>
      <span className={styles.opsMetaLine}>一直生成会在生成类失败后自动断点继续同一回合，直到当前地图结束或触发明确熔断。</span>

      <div className={styles.opsUtilityGrid}>
        <button
          type="button"
          className={styles.opsActionSecondary}
          onClick={() => void handleReset("round")}
          disabled={state === "running" || !progress?.runId}
        >
          重置本回合
        </button>
        <button
          type="button"
          className={styles.opsActionSecondary}
          onClick={() => void handleReset("map")}
          disabled={state === "running" || !progress?.runId}
        >
          重置当前地图
        </button>
        <button
          type="button"
          className={styles.opsActionSecondary}
          onClick={() => void handleReset("match")}
          disabled={state === "running" || !progress?.runId}
        >
          重置整场 BO3
        </button>
      </div>

      <div className={styles.opsUtilityGrid}>
        <button
          type="button"
          className={styles.opsActionSecondary}
          onClick={handleToggleTracking}
          disabled={!progress?.runId || (progress.status !== "running" && state !== "paused" && state !== "stopped")}
        >
          {state === "paused" || state === "stopped" ? "继续跟踪" : "暂停跟踪"}
        </button>
        <button
          type="button"
          className={styles.opsActionSecondary}
          onClick={handleStopTracking}
          disabled={!progress?.runId || progress.status !== "running"}
        >
          停止跟踪
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
            <strong>
              {state === "paused"
                ? "已暂停跟踪"
                : state === "stopped"
                  ? "已停止跟踪"
                  : progress.status === "running"
                    ? "实时进度"
                    : progress.status === "failed"
                      ? "运行失败"
                      : progress.status === "discarded"
                        ? "该 run 已废弃"
                        : progress.status === "scheduled"
                          ? "等待重新生成"
                          : "运行完成"}
            </strong>
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
          {failedAttemptNotice ? <span className={styles.opsMetaLine}>{failedAttemptNotice}</span> : null}
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
                    <th>契约</th>
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
                      <td>{call.promptContractId ?? "--"}</td>
                      <td>{call.driverModelId}</td>
                      <td>{call.repaired ? `${formatLlmStatus(call.status)} / 已修复` : formatLlmStatus(call.status)}</td>
                      <td>{typeof call.latencyMs === "number" ? `${call.latencyMs} ms` : "--"}</td>
                      <td>
                        {typeof call.inputTokens === "number" || typeof call.outputTokens === "number"
                          ? `${call.inputTokens ?? 0}/${call.outputTokens ?? 0}`
                          : call.error ?? "--"}
                        {call.rawTextPreview ? <pre className={styles.opsCallPreview}>{call.rawTextPreview}</pre> : null}
                        {call.parseCandidatePreview ? <pre className={styles.opsCallPreview}>{call.parseCandidatePreview}</pre> : null}
                        {call.repairRawTextPreview ? <pre className={styles.opsCallPreview}>{call.repairRawTextPreview}</pre> : null}
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

      <details className={styles.opsDisclosure}>
        <summary>最近运行实例</summary>
        <div className={styles.opsDisclosureBody}>
          {history.length > 0 ? (
            <div className={styles.opsHistoryList}>
              {history.map((item) => (
                <button key={item.runId} type="button" className={styles.opsHistoryButton} onClick={() => window.location.assign(buildReplayUrl(item.runId))}>
                  <strong>{item.benchmarkLabel ? `${shortRunId(item.runId)} · ${item.benchmarkLabel}` : shortRunId(item.runId)}</strong>
                  <span>{item.mapLabel}</span>
                  <span className={styles.opsHistoryMeta}>
                    {formatRunStatusLabel(item.status)} · {formatContractStatus(item.contractStatus)} · 已提交 {item.completedRounds} 局 · 比分 {item.scoreLabel}
                  </span>
                  {item.latestError ? <span className={styles.opsErrorText}>{item.latestError}</span> : null}
                </button>
              ))}
            </div>
          ) : (
            <span className={styles.opsMetaLine}>当前还没有可浏览的历史 run。</span>
          )}
        </div>
      </details>

      {reviewEntries.length > 0 ? (
        <details className={styles.opsDisclosure}>
          <summary>赛后复盘补丁</summary>
          <div className={styles.opsDisclosureBody}>
            <div className={styles.opsHistoryList}>
              {reviewEntries.map((entry) => {
                const busy =
                  reviewActionState?.teamId === entry.teamId;
                return (
                  <div key={entry.teamId} className={styles.opsHistoryButton}>
                    <strong>{entry.teamId}</strong>
                    <span>{formatCoachReviewStatus(entry.status)}</span>
                    {entry.review.timeoutQualityReview ? <span>{entry.review.timeoutQualityReview}</span> : null}
                    {entry.review.nextMatchUpgrades?.length ? (
                      <span className={styles.opsHistoryMeta}>下一场升级：{entry.review.nextMatchUpgrades.join(" / ")}</span>
                    ) : null}
                    {entry.review.proposedStrategyPatch ? <span>{entry.review.proposedStrategyPatch}</span> : null}
                    <div className={styles.opsUtilityGrid}>
                      <button
                        type="button"
                        className={styles.opsActionSecondary}
                        disabled={busy || entry.status === "approved"}
                        onClick={() => void handleCoachReview(entry.teamId, "approve")}
                      >
                        {busy && reviewActionState?.action === "approve" ? "采纳中..." : "采纳为下一场补丁"}
                      </button>
                      <button
                        type="button"
                        className={styles.opsActionSecondary}
                        disabled={busy || entry.status === "dismissed"}
                        onClick={() => void handleCoachReview(entry.teamId, "dismiss")}
                      >
                        {busy && reviewActionState?.action === "dismiss" ? "处理中..." : "暂不采纳"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </details>
      ) : null}

      <span className={state === "failed" ? styles.opsErrorText : styles.opsHelperText}>{helperText}</span>
    </section>
  );

  async function handleRun(mode: RunMode, retryMode: RunRetryMode = "full_round") {
    setTrackingPaused(false);
    setTrackingStopped(false);
    setState("running");
    setRequestedMode(mode);
    setMessage(runStartMessage(mode));
    try {
      const response = await fetch(`/api/matches/${encodeURIComponent(matchId || phase18FixtureId)}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          retryMode,
          runId: progress?.runId ?? initialProgress?.runId ?? null,
          confirmReset: true,
          ...(adminToken.trim() ? { adminToken: adminToken.trim() } : {})
        })
      });
      const payload = (await response.json().catch(() => ({}))) as RunRoutePayload;
      if (!response.ok) {
        throw new Error(payload.error ?? `Run failed with HTTP ${response.status}`);
      }

      if (payload.replayUrl) {
        window.history.replaceState(null, "", payload.replayUrl);
      }
      if (payload.progress) {
        setProgress(payload.progress);
        setHistory(payload.progress.recentRuns);
      } else {
        setProgress(null);
      }
      setMessage(payload.summary ?? "本地运行已启动。");
    } catch (error) {
      setState("failed");
      setMessage(error instanceof Error ? error.message : "未知运行错误。");
    }
  }

  async function handleReset(resetScope: ResetScope) {
    setTrackingPaused(false);
    setTrackingStopped(false);
    setMessage(
      resetScope === "round"
        ? "正在重置本回合..."
        : resetScope === "map"
          ? "正在重置当前地图..."
          : "正在重置整场 BO3..."
    );

    try {
      const response = await fetch(`/api/matches/${encodeURIComponent(matchId || phase18FixtureId)}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "reset",
          resetScope,
          runId: progress?.runId ?? null,
          confirmReset: true,
          ...(adminToken.trim() ? { adminToken: adminToken.trim() } : {})
        })
      });
      const payload = (await response.json().catch(() => ({}))) as RunRoutePayload;
      if (!response.ok) {
        throw new Error(payload.error ?? `Reset failed with HTTP ${response.status}`);
      }

      setRequestedMode(null);
      setState("idle");
      setMessage(payload.summary ?? "已完成重置。");
      if (payload.progress) {
        setProgress(payload.progress);
        setHistory(payload.progress.recentRuns);
      } else {
        setProgress(null);
      }
      if (resetScope === "map") {
        onResetCurrentMapView?.();
      } else if (resetScope === "match") {
        onResetMatchView?.();
      }

      window.setTimeout(() => {
        window.location.assign(payload.replayUrl ?? buildFixtureUrl(matchId));
      }, 200);
    } catch (error) {
      setState("failed");
      setMessage(error instanceof Error ? error.message : "重置失败。");
    }
  }

  function handleToggleTracking() {
    if (!progress?.runId) {
      return;
    }

    if (state === "paused" || state === "stopped") {
      setTrackingPaused(false);
      setTrackingStopped(false);
      setState("running");
      setMessage("继续跟踪当前生成进度。");
      return;
    }

    if (state === "running") {
      setTrackingPaused(true);
      setState("paused");
      setMessage("已暂停本地跟踪；后端如仍在运行，可稍后恢复。");
    }
  }

  function handleStopTracking() {
    if (!progress?.runId || progress.status !== "running") {
      return;
    }

    setTrackingPaused(false);
    setTrackingStopped(true);
    setState("stopped");
    setMessage("已停止本地跟踪当前生成；如后端仍在执行，请等待它自然结束。");
  }

  async function handleCoachReview(teamId: string, action: "approve" | "dismiss") {
    setReviewActionState({ teamId, action });
    try {
      const response = await fetch(`/api/matches/${encodeURIComponent(matchId)}/coach-review/${encodeURIComponent(teamId)}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          ...(adminToken.trim() ? { adminToken: adminToken.trim() } : {})
        })
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        summary?: string;
        review?: CoachPostMatchReviewEntry;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? `教练复盘请求失败，HTTP ${response.status}`);
        }

      if (payload.review) {
        setReviewEntries((current) =>
          current.map((entry) => (entry.teamId === payload.review?.teamId ? payload.review : entry))
        );
      }
      if (payload.summary) {
        setMessage(payload.summary);
      }
    } catch (error) {
      setState("failed");
      setMessage(error instanceof Error ? error.message : "赛后复盘处理失败。");
    } finally {
      setReviewActionState(null);
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

  if (initialProgress.status === "scheduled" || initialProgress.status === "discarded") {
    return {
      state: "idle",
      requestedMode: isPhase18Mode(initialProgress.mode) ? initialProgress.mode : null,
      progress: initialProgress,
      message: initialProgress.status === "discarded" ? "当前 run 已废弃；下一次生成会创建新的 run。" : "当前 run 已重置，等待下一次生成。"
    };
  }

  return {
    state: "success",
    requestedMode: isPhase18Mode(initialProgress.mode) ? initialProgress.mode : null,
    progress: initialProgress,
    message: buildCompletedMessage(initialProgress)
  };
}

function buildReplayUrl(runId: string): string {
  return `/?runId=${encodeURIComponent(runId)}`;
}

function buildFixtureUrl(matchId: string): string {
  if (matchId === phase18FixtureId) {
    return "/";
  }
  return `/?matchId=${encodeURIComponent(matchId)}`;
}

function buildCompletedMessage(progress: WebRunProgress): string {
  return `运行完成。比分 ${progress.result?.score ?? "待定"}，LLM 调用已完成 ${progress.llmSummary.completedCalls} 次，${formatExpectedCalls(progress)}。`;
}

function formatExpectedCalls(progress: WebRunProgress): string {
  if (progress.mode === "phase18_next_round") {
    return "当前回合约 14 次";
  }
  if (progress.mode === "phase18_current_map") {
    return "当前地图约每回合 14 次";
  }
  if (progress.mode === "phase18_keep_generating_map") {
    return "一直生成当前地图，约每回合 14 次";
  }
  if (progress.mode === "phase18_full_bo3") {
    return "BO3 约每回合 14 次";
  }
  if (progress.mode === "phase20_hex_round_experimental") {
    return "Hex 实验单回合，不调用旧 Phase18 LLM stage";
  }
  if (progress.mode === "phase20_hex_map_experimental") {
    return "Hex 实验地图，不调用旧 Phase18 LLM stage";
  }
  return progress.llmSummary.expectedTotalCalls > 0 ? `约 ${progress.llmSummary.expectedTotalCalls} 次` : "按需调用";
}

function isPhase18Mode(mode: AnyRunMode): mode is RunMode {
  return (
    mode === "phase18_next_round" ||
    mode === "phase18_current_map" ||
    mode === "phase18_keep_generating_map" ||
    mode === "phase18_full_bo3" ||
    mode === "phase20_hex_round_experimental" ||
    mode === "phase20_hex_map_experimental"
  );
}

function runStartMessage(mode: RunMode): string {
  switch (mode) {
    case "phase18_next_round":
      return "开始执行 Phase 1.8 单局真实 LLM 生成...";
    case "phase18_current_map":
      return "开始执行 Phase 1.8 当前地图真实 LLM 生成...";
    case "phase18_keep_generating_map":
      return "开始执行 Phase 1.8 一直生成；生成类失败会自动重试同一回合...";
    case "phase18_full_bo3":
      return "开始执行 Phase 1.8 整场 BO3 真实 LLM 生成...";
    case "phase20_hex_round_experimental":
      return "开始执行 Hex 实验单回合；本模式不替换旧 Phase18 主线。";
    case "phase20_hex_map_experimental":
      return "开始执行 Hex 实验地图；本模式只运行当前 Dust2 地图。";
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
    case "coach_timeout":
      return "教练暂停修正";
    case "coach_post_match_review":
      return "赛后复盘";
    case "judge":
      return "裁判";
    case "judge_verdict":
      return "裁判结构判定";
    case "judge_narrative":
      return "裁判判词";
    case "judge_review":
      return "复审裁判";
    case "combat_resolution":
      return "战斗映射";
    default:
      return taskType;
  }
}

function formatLlmActor(call: WebRunLlmCallProgress): string {
  if (call.agentId) {
    return call.agentId;
  }
  if (call.taskType === "coach_timeout") {
    return "教练";
  }
  if (call.taskType === "coach_post_match_review") {
    return "教练复盘";
  }
  if (call.taskType === "team_plan") {
    return "队伍";
  }
  if (call.taskType === "judge_review") {
    return "复审裁判";
  }
  if (call.taskType === "combat_resolution") {
    return "战斗映射";
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

function formatRunStatusLabel(status: RunStatus): string {
  switch (status) {
    case "scheduled":
      return "待生成";
    case "running":
      return "生成中";
    case "failed":
      return "失败";
    case "discarded":
      return "已废弃";
    case "completed":
    default:
      return "完成";
  }
}

function formatContractStatus(status: RunMatchHistoryEntry["contractStatus"] | WebRunProgress["contractStatus"]): string {
  switch (status) {
    case "current":
      return "当前契约";
    case "mixed":
      return "混合契约已锁定";
    case "blocked":
      return "旧契约已锁定";
    case "legacy":
      return "历史契约";
    default:
      return "契约未知";
  }
}

function buildFailedAttemptNotice(progress: WebRunProgress): string | null {
  if (progress.status !== "failed" || !progress.currentRoundNumber) {
    return null;
  }

  const committedLabel = progress.latestCommittedRoundNumber > 0 ? `R${progress.latestCommittedRoundNumber}` : "尚无已提交回合";
  const retryReason = progress.latestRetryReason ? ` 最近重试原因：${progress.latestRetryReason}` : "";
  if (progress.currentRoundNumber > progress.latestCommittedRoundNumber) {
    return `当前播放仍停留在 ${committedLabel}；最新失败尝试发生在 R${progress.currentRoundNumber}。${retryReason}`;
  }

  return `最新失败尝试发生在 R${progress.currentRoundNumber}。${retryReason}`;
}

function formatLocalStateLabel(state: RunState): string {
  switch (state) {
    case "running":
      return "生成中";
    case "paused":
      return "已暂停";
    case "stopped":
      return "已停止跟踪";
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
      return "生产模式下必须提供口令";
    case "web_runner_remote_requires_token":
      return "远程访问必须提供口令";
    case "web_runner_disabled":
    default:
      return "请设置 AGENT_MAJOR_WEB_RUNNER_ENABLED=true";
  }
}

function shortRunId(runId: string): string {
  return runId.length > 24 ? runId.slice(-24) : runId;
}

function formatCoachReviewStatus(status: string): string {
  switch (status) {
    case "approved":
      return "已采纳";
    case "dismissed":
      return "暂不采纳";
    case "pending":
    default:
      return "待确认";
  }
}
