"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import type {
  HexMatchLabLiveRunStatus,
  HexMatchLabMapAssetView,
  HexMatchLabMapOption,
  HexMatchLabProgress,
  HexMatchLabRoundSummary
} from "../../server-hex-match-lab";

import { HexMatchAuditDrawer } from "./hex-match-audit-drawer";
import { HexMatchMapViewer } from "./hex-match-map-viewer";
import { HexMatchPlayerPanel } from "./hex-match-player-panel";
import { HexMatchTimeline } from "./hex-match-timeline";
import styles from "./hex-match-lab.module.css";

type AuditTab = "llm" | "combat" | "economy" | "winner" | "raw";
type ConsoleDragState = { startX: number; startY: number; originX: number; originY: number };

const providerMode = "real" as const;

export function HexMatchLabClient() {
  const [progress, setProgress] = useState<HexMatchLabProgress | null>(null);
  const [mapAsset, setMapAsset] = useState<HexMatchLabMapAssetView | undefined>();
  const [maps, setMaps] = useState<HexMatchLabMapOption[]>([]);
  const [mapGameId, setMapGameId] = useState("");
  const [maxRounds, setMaxRounds] = useState(40);
  const [maxLlmCallsPerPhase, setMaxLlmCallsPerPhase] = useState(10);
  const [adminToken, setAdminToken] = useState("");
  const [selectedRoundArtifactId, setSelectedRoundArtifactId] = useState<string | undefined>();
  const [selectedPhaseIndex, setSelectedPhaseIndex] = useState(-1);
  const [selectedLevel, setSelectedLevel] = useState(0);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();
  const [showRegions, setShowRegions] = useState(true);
  const [showPoints, setShowPoints] = useState(false);
  const [showFlags, setShowFlags] = useState(false);
  const [showPaths, setShowPaths] = useState(true);
  const [showCombat, setShowCombat] = useState(true);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [runStep, setRunStep] = useState("等待操作");
  const [liveRun, setLiveRun] = useState<HexMatchLabLiveRunStatus | undefined>();
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playbackRunning, setPlaybackRunning] = useState(false);
  const [error, setError] = useState<{ message: string; details?: string } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<AuditTab>("llm");
  const [consoleHidden, setConsoleHidden] = useState(false);
  const [consolePosition, setConsolePosition] = useState({ x: 18, y: 86 });
  const [consoleDrag, setConsoleDrag] = useState<ConsoleDragState | null>(null);
  const stopRequested = useRef(false);
  const runStartedAt = useRef<number | null>(null);

  const selectedTrace = progress?.selectedTrace;
  const rounds = progress?.roundSummaries ?? [];
  const phases = selectedTrace?.phaseSummaries ?? [];
  const selectedPhase = phases.find((phase) => phase.phaseIndex === selectedPhaseIndex) ?? phases[0];
  const selectedRound = useMemo(
    () => rounds.find((round) => round.hexTraceArtifactId === selectedRoundArtifactId) ?? rounds.at(-1),
    [rounds, selectedRoundArtifactId]
  );
  const selectedRoundIndex = selectedRound
    ? rounds.findIndex((round) => round.hexTraceArtifactId === selectedRound.hexTraceArtifactId)
    : -1;
  const selectedPhasePosition = selectedPhase
    ? phases.findIndex((phase) => phase.phaseIndex === selectedPhase.phaseIndex)
    : -1;
  const completedMap = Boolean(progress?.completedMap);
  const canRunRound = Boolean(progress?.canRunRound);
  const roundProgressPct = rounds.length > 0 && selectedRoundIndex >= 0 ? ((selectedRoundIndex + 1) / rounds.length) * 100 : 0;
  const phaseProgressPct = phases.length > 0 && selectedPhasePosition >= 0 ? ((selectedPhasePosition + 1) / phases.length) * 100 : 0;
  const players = selectedPhase?.players ?? [];
  const score = progress?.score;

  useEffect(() => {
    void Promise.all([loadMapAsset(), refreshMaps(), refreshProgress()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!busyLabel || !runStartedAt.current) return;
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - (runStartedAt.current ?? Date.now()));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [busyLabel]);

  useEffect(() => {
    if (!playbackRunning) return;
    const timer = window.setTimeout(() => {
      if (selectedPhasePosition >= 0 && selectedPhasePosition < phases.length - 1) {
        const nextPhase = phases[selectedPhasePosition + 1];
        if (nextPhase) setSelectedPhaseIndex(nextPhase.phaseIndex);
        return;
      }
      if (selectedRoundIndex >= 0 && selectedRoundIndex < rounds.length - 1) {
        const nextRound = rounds[selectedRoundIndex + 1];
        if (nextRound) void selectRound(nextRound);
        return;
      }
      setPlaybackRunning(false);
    }, 1200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackRunning, selectedPhaseIndex, selectedRoundArtifactId, rounds.length, phases.length]);

  useEffect(() => {
    if (!consoleDrag) return;
    const drag = consoleDrag;
    function handlePointerMove(event: PointerEvent) {
      setConsolePosition(clampConsolePosition(drag.originX + event.clientX - drag.startX, drag.originY + event.clientY - drag.startY));
    }
    function handlePointerUp() {
      setConsoleDrag(null);
    }
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [consoleDrag]);

  async function loadMapAsset() {
    try {
      const response = await fetch(withAdminToken("/api/hex-lab/match/map-asset"), { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Hex map asset request failed.");
      setMapAsset(payload.mapAssetView);
    } catch (cause) {
      setError(toFriendlyError(cause));
    }
  }

  async function refreshMaps() {
    const response = await fetch(withAdminToken("/api/hex-lab/match/maps"), { cache: "no-store" });
    const payload = await response.json();
    if (response.ok) setMaps(payload.maps ?? []);
  }

  async function refreshProgress(nextRoundTraceArtifactId = selectedRoundArtifactId, nextMapGameId = mapGameId) {
    setBusyLabel("刷新中");
    setError(null);
    try {
      const params = new URLSearchParams();
      if (nextMapGameId.trim()) params.set("mapGameId", nextMapGameId.trim());
      if (nextRoundTraceArtifactId) params.set("roundTraceArtifactId", nextRoundTraceArtifactId);
      appendAdminToken(params);
      const response = await fetch(`/api/hex-lab/match/progress?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Hex Match Lab progress request failed.");
      applyProgress(payload.progress, nextRoundTraceArtifactId);
    } catch (cause) {
      setError(toFriendlyError(cause));
    } finally {
      setBusyLabel(null);
    }
  }

  async function runNextRoundLive(): Promise<boolean> {
    if (completedMap) {
      setError({
        message: "当前地图已完成，不能继续提交回合。",
        details: "请新建 Hex 验收比赛，或选择一张 active mapGame。不会影响旧 Phase18。"
      });
      return false;
    }
    setBusyLabel("真实 LLM 提交中");
    setRunStep("逐个 agent 调用 LLM：queued -> running -> request -> response -> repair/reject/fallback -> commit");
    setElapsedMs(0);
    runStartedAt.current = Date.now();
    setError(null);
    try {
      const run = await startLiveRun("round");
      const finalRun = await waitForLiveRun(run.runId);
      if (finalRun.progress) applyProgress(finalRun.progress);
      else await refreshProgress(undefined, finalRun.mapGameId ?? mapGameId);
      await refreshMaps();
      if (finalRun.status === "failed") {
        setError({ message: finalRun.latestError ?? "Hex live run failed." });
        return false;
      }
      return !finalRun.progress?.completedMap;
    } catch (cause) {
      setError(toFriendlyError(cause));
      return false;
    } finally {
      setBusyLabel(null);
      setRunStep("等待操作");
      runStartedAt.current = null;
    }
  }

  async function runUntilMapEnd(maxRoundOverride?: number) {
    const roundLimit = maxRoundOverride ?? maxRounds;
    stopRequested.current = false;
    setBusyLabel(maxRoundOverride ? "real 小地图验收" : "持续运行中");
    setRunStep(maxRoundOverride ? `real 小地图验收：最多 ${roundLimit} 回合，逐回合刷新 trace。` : "逐回合提交；每回合完成后刷新 trace，可随时停止下一轮。");
    setElapsedMs(0);
    runStartedAt.current = Date.now();
    for (let index = 0; index < roundLimit; index += 1) {
      if (stopRequested.current) {
        setRunStep("已停止：当前回合完成后不会再提交下一回合。");
        break;
      }
      setRunStep(`正在提交连续运行第 ${index + 1}/${roundLimit} 个回合`);
      const shouldContinue = await runNextRoundLive();
      if (!shouldContinue) {
        setRunStep("地图已完成或运行失败。");
        break;
      }
    }
    if (maxRoundOverride && !stopRequested.current) {
      setRunStep("real 小地图验收已到达回合上限；请检查 accepted/rejected/fallback 与 provider error。");
    }
    setBusyLabel(null);
    runStartedAt.current = null;
  }

  async function startLiveRun(scope: "round" | "map"): Promise<HexMatchLabLiveRunStatus> {
    const response = await fetch("/api/hex-lab/match/live-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope,
        providerMode,
        maxRounds,
        maxLlmCallsPerPhase,
        mapGameId: mapGameId.trim() || undefined,
        adminToken: adminToken.trim() || undefined
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Hex live run start failed.");
    setLiveRun(payload.run);
    return payload.run;
  }

  async function waitForLiveRun(runId: string): Promise<HexMatchLabLiveRunStatus> {
    for (;;) {
      await delay(650);
      const params = new URLSearchParams({ runId });
      appendAdminToken(params);
      const response = await fetch(`/api/hex-lab/match/live-run?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Hex live run poll failed.");
      setLiveRun(payload.run);
      if (payload.run.status !== "running") return payload.run;
    }
  }

  async function createValidationMap() {
    setBusyLabel("新建比赛");
    setError(null);
    try {
      const response = await fetch("/api/hex-lab/match/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseMapGameId: mapGameId.trim() || undefined, adminToken: adminToken.trim() || undefined })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Create Hex validation map failed.");
      setMapGameId(payload.map?.mapGameId ?? "");
      setSelectedRoundArtifactId(undefined);
      setSelectedPhaseIndex(-1);
      await refreshMaps();
      await refreshProgress(undefined, payload.map?.mapGameId ?? "");
    } catch (cause) {
      setError(toFriendlyError(cause));
    } finally {
      setBusyLabel(null);
    }
  }

  async function resetAsNewMap() {
    setBusyLabel("安全重置");
    setError(null);
    try {
      const response = await fetch("/api/hex-lab/match/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapGameId: mapGameId.trim() || progress?.mapGameId, adminToken: adminToken.trim() || undefined })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Reset Hex validation map failed.");
      setMapGameId(payload.map?.mapGameId ?? "");
      setSelectedRoundArtifactId(undefined);
      setSelectedPhaseIndex(-1);
      await refreshMaps();
      await refreshProgress(undefined, payload.map?.mapGameId ?? "");
    } catch (cause) {
      setError(toFriendlyError(cause));
    } finally {
      setBusyLabel(null);
    }
  }

  function applyProgress(nextProgress: HexMatchLabProgress | undefined, preferredRoundTraceArtifactId?: string | undefined) {
    if (!nextProgress) return;
    setProgress(nextProgress);
    if (nextProgress.mapGameId) setMapGameId(nextProgress.mapGameId);
    const nextRound = preferredRoundTraceArtifactId
      ? nextProgress.roundSummaries.find((round) => round.hexTraceArtifactId === preferredRoundTraceArtifactId)
      : nextProgress.roundSummaries.at(-1);
    setSelectedRoundArtifactId(nextProgress.selectedTrace?.hexTraceArtifactId ?? nextRound?.hexTraceArtifactId);
    const nextPhase = nextProgress.selectedTrace?.phaseSummaries.at(0);
    setSelectedPhaseIndex(nextPhase?.phaseIndex ?? -1);
    setSelectedAgentId(undefined);
  }

  async function selectRound(round: HexMatchLabRoundSummary) {
    setSelectedRoundArtifactId(round.hexTraceArtifactId);
    setSelectedPhaseIndex(-1);
    if (round.hexTraceArtifactId) await refreshProgress(round.hexTraceArtifactId);
  }

  function withAdminToken(path: string): string {
    const params = new URLSearchParams();
    appendAdminToken(params);
    const query = params.toString();
    return query ? `${path}?${query}` : path;
  }

  function appendAdminToken(params: URLSearchParams) {
    if (adminToken.trim()) params.set("adminToken", adminToken.trim());
  }

  function handleConsolePointerDown(event: ReactPointerEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    const dragHandle = target.closest("[data-console-drag-handle]");
    if (dragHandle) {
      event.preventDefault();
      setConsoleDrag({ startX: event.clientX, startY: event.clientY, originX: consolePosition.x, originY: consolePosition.y });
      return;
    }
    if (target.closest("button, input, select, a")) return;
    setConsoleDrag({ startX: event.clientX, startY: event.clientY, originX: consolePosition.x, originY: consolePosition.y });
  }

  return (
    <main className={styles.matchShell}>
      <header className={styles.statusBar}>
        <div>
          <span>Hex Match Lab 真实 LLM 验收台</span>
          <h1>{progress?.mapName ?? "Dust2"} · {score ? `${score.teamA} : ${score.teamB}` : "0 : 0"}</h1>
        </div>
        <div className={styles.statusChips}>
          <span>experimental</span>
          <span>writesDb=true</span>
          <span>provider=real</span>
          <span>LLM 不能写 final winner</span>
          <span>{progress?.mapStatus ?? "no map"}</span>
        </div>
      </header>

      {error ? (
        <section className={styles.errorBanner}>
          <strong>{error.message}</strong>
          <p>不会影响旧 Phase18。你可以新建 Hex 验收比赛、选择 active mapGame，或展开技术细节排查。</p>
          {error.details ? <details><summary>technical details</summary><pre>{error.details}</pre></details> : null}
        </section>
      ) : null}

      <section className={styles.board}>
        <HexMatchPlayerPanel title="进攻方" side="attack" players={players} selectedAgentId={selectedAgentId} onSelectAgent={setSelectedAgentId} />

        <div className={styles.centerStage}>
          <div className={styles.mapToolbar}>
            <div className={styles.levelTabs}>
              {[-1, 0, 1].map((level) => (
                <button key={level} type="button" className={selectedLevel === level ? styles.levelActive : styles.levelTab} onClick={() => setSelectedLevel(level)}>
                  level {level}
                </button>
              ))}
            </div>
            <label><input type="checkbox" checked={showRegions} onChange={(event) => setShowRegions(event.target.checked)} /> 区域</label>
            <label><input type="checkbox" checked={showPoints} onChange={(event) => setShowPoints(event.target.checked)} /> 点位</label>
            <label><input type="checkbox" checked={showFlags} onChange={(event) => setShowFlags(event.target.checked)} /> 标记</label>
            <label><input type="checkbox" checked={showPaths} onChange={(event) => setShowPaths(event.target.checked)} /> 路径/AP</label>
            <label><input type="checkbox" checked={showCombat} onChange={(event) => setShowCombat(event.target.checked)} /> 交火</label>
          </div>

          <HexMatchMapViewer
            map={mapAsset}
            phase={selectedPhase}
            level={selectedLevel}
            selectedAgentId={selectedAgentId}
            showRegions={showRegions}
            showPoints={showPoints}
            showFlags={showFlags}
            showPaths={showPaths}
            showCombat={showCombat}
            onSelectAgent={setSelectedAgentId}
          />

          <HexMatchTimeline
            rounds={rounds}
            phases={phases}
            selectedRoundArtifactId={selectedRoundArtifactId}
            selectedPhaseIndex={selectedPhaseIndex}
            roundProgressPct={roundProgressPct}
            phaseProgressPct={phaseProgressPct}
            playbackRunning={playbackRunning}
            onSelectRound={selectRound}
            onSelectPhase={setSelectedPhaseIndex}
            onPreviousRound={() => { const previous = rounds[selectedRoundIndex - 1]; if (previous) void selectRound(previous); }}
            onNextRound={() => { const next = rounds[selectedRoundIndex + 1]; if (next) void selectRound(next); }}
            onPreviousPhase={() => { const previous = phases[selectedPhasePosition - 1]; if (previous) setSelectedPhaseIndex(previous.phaseIndex); }}
            onNextPhase={() => { const next = phases[selectedPhasePosition + 1]; if (next) setSelectedPhaseIndex(next.phaseIndex); }}
            onTogglePlayback={() => setPlaybackRunning((value) => !value)}
          />
        </div>

        <HexMatchPlayerPanel title="防守方" side="defense" players={players} selectedAgentId={selectedAgentId} onSelectAgent={setSelectedAgentId} />
      </section>

      <section className={styles.bottomAudit}>
        <div className={styles.auditSummary}>
          <h2>审计入口</h2>
          <p>accepted {selectedPhase?.acceptedActionCount ?? 0} / rejected {selectedPhase?.rejectedDraftCount ?? 0} / fallback {selectedPhase?.fallbackActionCount ?? 0}</p>
          <p>calls {selectedPhase?.callsAttempted ?? liveRun?.callsAttempted ?? 0} / expected {selectedPhase?.llmAudit.expectedCalls ?? liveRun?.expectedCalls ?? 0}</p>
        </div>
        {(["llm", "combat", "economy", "winner"] as const).map((tab) => (
          <button key={tab} type="button" onClick={() => { setDrawerTab(tab); setDrawerOpen(true); }}>
            {auditLabel(tab)}
          </button>
        ))}
      </section>

      {consoleHidden ? (
        <button type="button" className={styles.consoleReveal} onClick={() => setConsoleHidden(false)}>
          显示控制台
        </button>
      ) : (
        <aside className={styles.floatingConsole} style={{ left: consolePosition.x, top: consolePosition.y }} onPointerDown={handleConsolePointerDown}>
          <div className={styles.consoleHeader}>
            <button type="button" className={styles.dragHandle} data-console-drag-handle="true" aria-label="拖动控制台">
              拖动控制台
            </button>
            <div>
              <h2>控制台</h2>
              <span>{busyLabel ?? progress?.runStatus.currentStep ?? "idle"}</span>
            </div>
            <button type="button" onClick={() => setConsoleHidden(true)}>隐藏</button>
          </div>

          <label>
            历史 / 当前 mapGame
            <select value={mapGameId} onChange={(event) => { setMapGameId(event.target.value); void refreshProgress(undefined, event.target.value); }}>
              <option value="">自动选择最新 Dust2</option>
              {maps.map((map) => (
                <option key={map.mapGameId} value={map.mapGameId}>
                  {map.mapStatus} - {map.score.teamA}:{map.score.teamB} - R{map.currentRoundNumber} - {map.mapGameId}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.controlInputs}>
            <label>
              max rounds
              <input type="number" value={maxRounds} min={1} max={60} onChange={(event) => setMaxRounds(Number(event.target.value))} />
            </label>
            <label>
              max LLM / phase
              <input type="number" value={maxLlmCallsPerPhase} min={0} max={50} onChange={(event) => setMaxLlmCallsPerPhase(Number(event.target.value))} />
            </label>
          </div>
          <label>
            admin token（可选）
            <input value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="本地无 token 可留空" />
          </label>

          <div className={styles.controlGrid}>
            <button type="button" onClick={createValidationMap}>新建验收比赛</button>
            <button type="button" onClick={resetAsNewMap}>安全重置</button>
            <button type="button" onClick={() => void runNextRoundLive()} disabled={!canRunRound || Boolean(busyLabel)}>跑下一回合（real）</button>
            <button type="button" onClick={() => void runUntilMapEnd(6)} disabled={!canRunRound || Boolean(busyLabel)}>real 小地图验收（6回合）</button>
            <button type="button" onClick={() => void runUntilMapEnd()} disabled={!canRunRound || Boolean(busyLabel)}>一直跑到结束</button>
            <button type="button" onClick={() => { stopRequested.current = true; setRunStep("已请求停止：不会提交下一回合。"); }}>停止</button>
            <button type="button" onClick={() => void refreshProgress()}>刷新</button>
          </div>
          <a className={styles.editorLink} href="/hex-lab/editor">打开 Hex 地图编辑器</a>

          <div className={styles.runStatusBox}>
            <strong>{liveRun?.status ?? progress?.runStatus.status ?? "idle"}</strong>
            <span>{liveRun?.currentStep ?? runStep}</span>
            <span>elapsed {formatMs(liveRun?.elapsedMs ?? elapsedMs)}</span>
            <span>calls {liveRun?.callsAttempted ?? 0} / {liveRun?.expectedCalls ?? 0}</span>
          </div>

          <div className={styles.liveCallList}>
            {(liveRun?.slots ?? []).slice(-12).map((slot) => (
              <div key={slot.callId} className={styles.liveCallRow}>
                <b>{slot.callIndex}/{slot.expectedCalls}</b>
                <span>{slot.agentId}</span>
                <em>{slot.status}</em>
                <small>{slot.requestArtifactId ? "req" : ""} {slot.responseArtifactId ? "res" : ""} {slot.errors.join(", ")}</small>
              </div>
            ))}
          </div>

          {completedMap ? <p className={styles.consoleNote}>当前地图已完成。请新建或安全重置为新地图后继续。</p> : null}
        </aside>
      )}

      <HexMatchAuditDrawer
        open={drawerOpen}
        tab={drawerTab}
        trace={selectedTrace}
        phase={selectedPhase}
        onTabChange={setDrawerTab}
        onClose={() => setDrawerOpen(false)}
      />
    </main>
  );
}

function auditLabel(tab: AuditTab): string {
  if (tab === "llm") return "LLM 调用";
  if (tab === "combat") return "战斗裁定";
  if (tab === "economy") return "经济证据";
  if (tab === "winner") return "硬胜负";
  return "原始 JSON";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function clampConsolePosition(x: number, y: number): { x: number; y: number } {
  if (typeof window === "undefined") return { x, y };
  return {
    x: Math.max(8, Math.min(window.innerWidth - 360, x)),
    y: Math.max(8, Math.min(window.innerHeight - 160, y))
  };
}

function toFriendlyError(cause: unknown): { message: string; details?: string } {
  const details = cause instanceof Error ? cause.message : String(cause);
  if (/completed map|当前地图已完成/i.test(details)) {
    return { message: "当前地图已完成，不能继续提交回合。", details };
  }
  if (/provider|external|api key|network/i.test(details)) {
    return { message: "真实 LLM provider 受限或失败。请查看 LLM 审计或新建验收地图后重试。", details };
  }
  return { message: details, details };
}
