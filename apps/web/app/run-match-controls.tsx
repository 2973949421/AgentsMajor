"use client";

import { useState } from "react";

import type { PublicWebRunnerPolicy } from "./server-web-runner-policy";
import styles from "./live-replay-player.module.css";

interface RunMatchControlsProps {
  matchId: string;
  runnerPolicy: PublicWebRunnerPolicy;
  compact?: boolean;
}

type RunState = "idle" | "running" | "success" | "failed";

export function RunMatchControls({ matchId, runnerPolicy, compact = false }: RunMatchControlsProps) {
  const [state, setState] = useState<RunState>("idle");
  const [message, setMessage] = useState<string>("");
  const [adminToken, setAdminToken] = useState("");

  const handleRunSingleMap = async () => {
    setState("running");
    setMessage("正在生成 DUST2 单图真实 LLM 测试，会重置本地 demo_match_phase11。");
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
      const payload = (await response.json().catch(() => ({}))) as { error?: string; summary?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? `Run failed with HTTP ${response.status}`);
      }

      setState("success");
      setMessage(payload.summary ?? "单图生成完成，正在刷新页面。");
      window.setTimeout(() => window.location.reload(), 500);
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
