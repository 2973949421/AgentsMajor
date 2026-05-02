"use client";

import { useEffect, useMemo, useState } from "react";

import type { PublicWebRunnerPolicy } from "./server-web-runner-policy";
import styles from "./live-replay-player.module.css";

interface RunMatchControlsProps {
  matchId: string;
  runnerPolicy: PublicWebRunnerPolicy;
  compact?: boolean;
}

type RunState = "idle" | "running" | "success" | "failed";

interface WebRunProgress {
  runId: string;
  status: "running" | "completed" | "failed";
  estimatedTotalRounds: number;
  completedRounds: number;
  currentRoundNumber: number | null;
  casterLines: number;
  progressPercent: number;
  error?: string;
  result?: {
    status: string;
    score: string;
    llmCalls: {
      count: number;
      inputTokens: number | null;
      outputTokens: number | null;
    };
  };
}

export function RunMatchControls({ matchId, runnerPolicy, compact = false }: RunMatchControlsProps) {
  const [state, setState] = useState<RunState>("idle");
  const [message, setMessage] = useState<string>("");
  const [adminToken, setAdminToken] = useState("");
  const [progress, setProgress] = useState<WebRunProgress | null>(null);

  const progressSegments = useMemo(() => {
    const total = progress?.estimatedTotalRounds ?? 18;
    const completed = progress?.completedRounds ?? 0;
    return Array.from({ length: total }, (_, index) => ({
      index,
      completed: index < completed,
      current: progress?.status === "running" && index === completed
    }));
  }, [progress]);

  useEffect(() => {
    if (state !== "running" || !progress?.runId) {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/matches/${encodeURIComponent(matchId)}/run?runId=${encodeURIComponent(progress.runId)}`, {
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

        setProgress(payload.progress);
        if (payload.progress.status === "completed") {
          setState("success");
          const calls = payload.progress.result?.llmCalls.count ?? payload.progress.casterLines;
          setMessage(`DUST2 单图生成完成，比分 ${payload.progress.result?.score ?? "pending"}，LLM 调用 ${calls} 次。正在刷新页面。`);
          window.setTimeout(() => window.location.reload(), 700);
        }
        if (payload.progress.status === "failed") {
          setState("failed");
          setMessage(payload.progress.error ?? "生成失败。");
        }
      } catch (error) {
        if (!cancelled) {
          setState("failed");
          setMessage(error instanceof Error ? error.message : "进度查询失败。");
        }
      }
    };

    const intervalId = window.setInterval(poll, 1000);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [matchId, progress?.runId, state]);

  const handleRunSingleMap = async () => {
    setState("running");
    setProgress(null);
    setMessage("正在启动 DUST2 单图真实 LLM 生成；会按回合显示主解说生成进度。");
    try {
      const response = await fetch(`/api/matches/${encodeURIComponent(matchId)}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "phase15_single_map",
          confirmReset: true,
          ...(adminToken.trim() ? { adminToken: adminToken.trim() } : {})
        })
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; summary?: string; progress?: WebRunProgress };
      if (!response.ok) {
        throw new Error(payload.error ?? `Run failed with HTTP ${response.status}`);
      }

      setProgress(payload.progress ?? null);
      setMessage(payload.summary ?? "DUST2 单图真实 LLM 生成已启动。");
    } catch (error) {
      setState("failed");
      setMessage(error instanceof Error ? error.message : "未知启动失败。");
    }
  };

  if (!runnerPolicy.enabled) {
    return (
      <div className={compact ? styles.runControlsCompact : styles.runControls}>
        <button type="button" disabled>
          生成 DUST2 单图 LLM
        </button>
        <span className={styles.runControlsMessage}>本地 Web 启动已关闭：{formatDisabledReason(runnerPolicy.disabledReason)}</span>
      </div>
    );
  }

  return (
    <div className={compact ? styles.runControlsCompact : styles.runControls}>
      {runnerPolicy.requiresToken ? (
        <input
          className={styles.runControlsInput}
          type="password"
          value={adminToken}
          onChange={(event) => setAdminToken(event.target.value)}
          placeholder="本地运行 token"
          autoComplete="off"
        />
      ) : null}
      <button type="button" onClick={handleRunSingleMap} disabled={state === "running"}>
        {state === "running" ? "生成中..." : "生成 DUST2 单图 LLM"}
      </button>
      {progress ? (
        <div className={styles.runProgress} aria-label="主解说生成进度">
          <div className={styles.runProgressMeta}>
            <span>
              回合 {Math.min(progress.completedRounds, progress.estimatedTotalRounds)}/{progress.estimatedTotalRounds}
            </span>
            <span>主解说 {progress.casterLines} 条</span>
            <span>{progress.progressPercent}%</span>
          </div>
          <div className={styles.runProgressTrack}>
            {progressSegments.map((segment) => (
              <span
                key={segment.index}
                className={`${styles.runProgressSegment} ${segment.completed ? styles.runProgressSegmentDone : ""} ${
                  segment.current ? styles.runProgressSegmentCurrent : ""
                }`}
                title={`Round ${segment.index + 1}`}
              />
            ))}
          </div>
          <small>{progress.status === "running" ? `当前接近 R${progress.currentRoundNumber ?? progress.completedRounds + 1}` : progress.status}</small>
        </div>
      ) : null}
      <span className={state === "failed" ? styles.runControlsError : styles.runControlsMessage}>
        {message || "仅本地启用；会重置 demo_match_phase11，不暴露 API Key。"}
      </span>
    </div>
  );
}

function formatDisabledReason(reason: PublicWebRunnerPolicy["disabledReason"]): string {
  switch (reason) {
    case "web_runner_production_disabled":
      return "生产环境默认禁用";
    case "web_runner_production_requires_token":
      return "生产环境必须设置 token";
    case "web_runner_remote_requires_token":
      return "远程访问必须设置 token";
    case "web_runner_disabled":
    default:
      return "需要设置 AGENT_MAJOR_WEB_RUNNER_ENABLED=true";
  }
}
