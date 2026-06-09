"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type {
  HexMatchLabMapOption,
  HexMatchLabProgress,
  HexMatchLabProviderMode,
  HexMatchLabRoundSummary
} from "../../server-hex-match-lab";

import { HexMatchAuditDrawer } from "./hex-match-audit-drawer";
import { HexMatchMapViewer } from "./hex-match-map-viewer";
import { HexMatchPlayerPanel } from "./hex-match-player-panel";
import { HexMatchTimeline } from "./hex-match-timeline";
import styles from "./hex-match-lab.module.css";

type AuditTab = "llm" | "combat" | "economy" | "winner" | "raw";

export function HexMatchLabClient() {
  const [progress, setProgress] = useState<HexMatchLabProgress | null>(null);
  const [maps, setMaps] = useState<HexMatchLabMapOption[]>([]);
  const [providerMode, setProviderMode] = useState<HexMatchLabProviderMode>("fixture");
  const [maxRounds, setMaxRounds] = useState(40);
  const [maxLlmCallsPerPhase, setMaxLlmCallsPerPhase] = useState(10);
  const [mapGameId, setMapGameId] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [selectedRoundArtifactId, setSelectedRoundArtifactId] = useState<string | undefined>();
  const [selectedPhaseIndex, setSelectedPhaseIndex] = useState(0);
  const [selectedLevel, setSelectedLevel] = useState(0);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();
  const [showRegions, setShowRegions] = useState(true);
  const [showPoints, setShowPoints] = useState(true);
  const [showFlags, setShowFlags] = useState(true);
  const [showPaths, setShowPaths] = useState(true);
  const [showCombat, setShowCombat] = useState(true);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [runStep, setRunStep] = useState("等待操作");
  const [error, setError] = useState<{ message: string; details?: string } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<AuditTab>("llm");
  const stopRequested = useRef(false);
  const runStartedAt = useRef<number | null>(null);

  const selectedTrace = progress?.selectedTrace;
  const rounds = progress?.roundSummaries ?? [];
  const selectedPhase =
    selectedTrace?.phaseSummaries.find((phase) => phase.phaseIndex === selectedPhaseIndex)
    ?? selectedTrace?.phaseSummaries[0];
  const selectedRound = useMemo(
    () => rounds.find((round) => round.hexTraceArtifactId === selectedRoundArtifactId) ?? rounds.at(-1),
    [rounds, selectedRoundArtifactId]
  );
  const canRunRound = Boolean(progress?.canRunRound);
  const completedMap = Boolean(progress?.completedMap);
  const elapsedMs = runStartedAt.current ? Date.now() - runStartedAt.current : progress?.runStatus.elapsedMs;

  useEffect(() => {
    void Promise.all([refreshMaps(), refreshProgress()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshMaps() {
    const params = new URLSearchParams();
    if (adminToken.trim()) params.set("adminToken", adminToken.trim());
    const response = await fetch(`/api/hex-lab/match/maps?${params.toString()}`, { cache: "no-store" });
    const payload = await response.json();
    if (response.ok) {
      setMaps(payload.maps ?? []);
    }
  }

  async function refreshProgress(nextRoundTraceArtifactId = selectedRoundArtifactId, nextMapGameId = mapGameId) {
    setBusyLabel("刷新中");
    setError(null);
    try {
      const params = new URLSearchParams();
      if (nextMapGameId.trim()) params.set("mapGameId", nextMapGameId.trim());
      if (nextRoundTraceArtifactId) params.set("roundTraceArtifactId", nextRoundTraceArtifactId);
      if (adminToken.trim()) params.set("adminToken", adminToken.trim());
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

  async function runNextRound() {
    if (completedMap) {
      setError({
        message: "当前地图已完成，不能继续提交回合。",
        details: "请点击“新建 Hex 验收比赛”或“安全重置为新地图”。不会影响旧 Phase18。"
      });
      return false;
    }
    setBusyLabel("提交下一回合");
    setRunStep("正在提交下一回合：action -> combat -> hard condition -> artifact");
    setError(null);
    try {
      const response = await fetch("/api/hex-lab/match/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "round",
          providerMode,
          maxRounds,
          maxLlmCallsPerPhase,
          mapGameId: mapGameId.trim() || undefined,
          adminToken: adminToken.trim() || undefined
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Hex Match Lab run request failed.");
      applyProgress(payload.progress);
      await refreshMaps();
      return !payload.progress?.completedMap;
    } catch (cause) {
      setError(toFriendlyError(cause));
      return false;
    } finally {
      setBusyLabel(null);
      setRunStep("等待操作");
    }
  }

  async function runFastMap() {
    if (completedMap) {
      setError({
        message: "当前地图已完成，不能继续运行整图。",
        details: "请新建 Hex 验收比赛，或选择一个 active mapGame。"
      });
      return;
    }
    setBusyLabel("快速运行整图");
    setRunStep("正在调用 N30 map runner；该模式不可逐回合停止。");
    setError(null);
    try {
      const response = await fetch("/api/hex-lab/match/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "map",
          providerMode,
          maxRounds,
          maxLlmCallsPerPhase,
          mapGameId: mapGameId.trim() || undefined,
          adminToken: adminToken.trim() || undefined
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Hex Match Lab map request failed.");
      applyProgress(payload.progress);
      await refreshMaps();
    } catch (cause) {
      setError(toFriendlyError(cause));
    } finally {
      setBusyLabel(null);
      setRunStep("等待操作");
    }
  }

  async function runUntilMapEnd() {
    stopRequested.current = false;
    runStartedAt.current = Date.now();
    setBusyLabel("持续运行中");
    setRunStep("准备逐回合提交");
    for (let index = 0; index < maxRounds; index += 1) {
      if (stopRequested.current) {
        setRunStep("已停止：不会再提交下一回合");
        break;
      }
      setRunStep(`正在提交第 ${index + 1} 个连续回合`);
      const shouldContinue = await runNextRound();
      if (!shouldContinue) {
        setRunStep("地图已完成或运行失败");
        break;
      }
    }
    setBusyLabel(null);
    runStartedAt.current = null;
  }

  function stopLoop() {
    stopRequested.current = true;
    setRunStep("收到停止请求：当前回合完成后不再继续");
  }

  async function createMap() {
    setBusyLabel("新建验收地图");
    setError(null);
    try {
      const response = await fetch("/api/hex-lab/match/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseMapGameId: mapGameId.trim() || undefined,
          adminToken: adminToken.trim() || undefined
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Create Hex validation map failed.");
      setMapGameId(payload.map.mapGameId);
      applyProgress(payload.progress);
      await refreshMaps();
    } catch (cause) {
      setError(toFriendlyError(cause));
    } finally {
      setBusyLabel(null);
    }
  }

  async function resetMap() {
    setBusyLabel("安全重置中");
    setError(null);
    try {
      const response = await fetch("/api/hex-lab/match/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mapGameId: mapGameId.trim() || undefined,
          adminToken: adminToken.trim() || undefined
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Reset Hex validation map failed.");
      setMapGameId(payload.map.mapGameId);
      applyProgress(payload.progress);
      await refreshMaps();
    } catch (cause) {
      setError(toFriendlyError(cause));
    } finally {
      setBusyLabel(null);
    }
  }

  async function selectRound(round: HexMatchLabRoundSummary) {
    if (!round.hexTraceArtifactId) return;
    setSelectedRoundArtifactId(round.hexTraceArtifactId);
    setSelectedPhaseIndex(0);
    await refreshProgress(round.hexTraceArtifactId);
  }

  function applyProgress(next: HexMatchLabProgress | null, nextRoundTraceArtifactId?: string) {
    setProgress(next);
    if (!next) return;
    if (next.mapGameId) setMapGameId(next.mapGameId);
    if (nextRoundTraceArtifactId) {
      setSelectedRoundArtifactId(nextRoundTraceArtifactId);
    } else if (next.selectedTrace?.hexTraceArtifactId) {
      setSelectedRoundArtifactId(next.selectedTrace.hexTraceArtifactId);
    }
    setSelectedPhaseIndex(0);
    if (!selectedAgentId && next.selectedTrace?.phaseSummaries[0]?.players[0]?.agentId) {
      setSelectedAgentId(next.selectedTrace.phaseSummaries[0].players[0].agentId);
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.topBar}>
        <div>
          <p className={styles.eyebrow}>Phase 2.0-pre / N31 收口补丁</p>
          <h1>Hex Match Lab 蜂巢比赛验收台</h1>
          <p className={styles.subtitle}>
            独立验收 HexGrid 蜂巢回合引擎；LLM 只给行动草案，最终 winner 来自 hard condition。
          </p>
        </div>
        <div className={styles.statusCards}>
          <Metric label="mapGame" value={progress?.mapGameId ?? "未选择"} compact />
          <Metric label="比分" value={formatScore(progress?.score)} />
          <Metric label="回合" value={String(progress?.mapSummary?.roundsCommitted ?? rounds.length)} />
          <Metric label="状态" value={progress?.mapStatus ?? "未加载"} />
          <Metric label="provider" value={providerMode} />
        </div>
      </header>

      <section className={styles.guardRail}>
        <span>experimental</span>
        <span>writesDb=true</span>
        <span>replacesLegacyRoundPath=false</span>
        <span>LLM cannot write final winner</span>
        <span>前端不重新计算 winner</span>
      </section>

      {error ? <ErrorBanner error={error} /> : null}
      {progress?.latestError && !error ? <ErrorBanner error={{ message: progress.latestError }} /> : null}

      <section className={styles.matchGrid}>
        <aside className={styles.controlPanel}>
          <div className={styles.sectionTitleRow}>
            <h2>控制台</h2>
            <span>{busyLabel ?? "idle"}</span>
          </div>
          <label>
            <span>历史 / 当前 mapGame</span>
            <select
              value={mapGameId}
              onChange={(event) => {
                setMapGameId(event.target.value);
                void refreshProgress(undefined, event.target.value);
              }}
            >
              <option value="">自动选择最新 Dust2</option>
              {maps.map((map) => (
                <option key={map.mapGameId} value={map.mapGameId}>
                  {map.mapStatus} - {map.score.teamA}:{map.score.teamB} - R{map.currentRoundNumber} - {map.mapGameId}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>provider mode</span>
            <select value={providerMode} onChange={(event) => setProviderMode(event.target.value as HexMatchLabProviderMode)}>
              <option value="fixture">fixture（默认验收）</option>
              <option value="real">real（N33 稳定专项）</option>
            </select>
          </label>
          <div className={styles.inputRow}>
            <label>
              <span>max rounds</span>
              <input type="number" min={1} max={60} value={maxRounds} onChange={(event) => setMaxRounds(Number(event.target.value))} />
            </label>
            <label>
              <span>max LLM / phase</span>
              <input type="number" min={0} max={50} value={maxLlmCallsPerPhase} onChange={(event) => setMaxLlmCallsPerPhase(Number(event.target.value))} />
            </label>
          </div>
          <label>
            <span>admin token（可选）</span>
            <input value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="本地无 token 可留空" type="password" />
          </label>

          <div className={styles.buttonStack}>
            <button type="button" onClick={createMap} disabled={Boolean(busyLabel)}>新建 Hex 验收比赛</button>
            <button type="button" onClick={resetMap} disabled={Boolean(busyLabel)}>安全重置为新地图</button>
            <button type="button" onClick={runNextRound} disabled={Boolean(busyLabel) || !canRunRound}>跑下一回合</button>
            <button type="button" onClick={runUntilMapEnd} disabled={Boolean(busyLabel) || !canRunRound}>一直跑到地图结束</button>
            <button type="button" onClick={stopLoop} disabled={!busyLabel}>停止</button>
            <button type="button" onClick={runFastMap} disabled={Boolean(busyLabel) || !canRunRound}>快速跑当前地图</button>
            <button type="button" onClick={() => { void refreshMaps(); void refreshProgress(); }} disabled={Boolean(busyLabel)}>刷新</button>
            <a className={styles.secondaryLink} href="/hex-lab/editor">打开 Hex 地图编辑器</a>
          </div>

          <div className={styles.runStatusBox}>
            <strong>运行状态</strong>
            <p>{busyLabel ? "running" : (progress?.runStatus.status ?? "idle")} - {runStep}</p>
            <p>calls attempted: {selectedPhase?.llmAudit.totalLlmCallsAttempted ?? progress?.runStatus.callsAttempted ?? 0}</p>
            <p>elapsed: {elapsedMs ? `${Math.round(elapsedMs / 1000)}s` : "0s"}</p>
            {completedMap ? <p className={styles.warningText}>当前地图已 completed，请新建或安全重置。</p> : null}
          </div>
        </aside>

        <section className={styles.mainStage}>
          <div className={styles.mapToolbar}>
            <div className={styles.segmented}>
              {[-1, 0, 1].map((level) => (
                <button key={level} type="button" className={selectedLevel === level ? styles.segmentActive : styles.segment} onClick={() => setSelectedLevel(level)}>
                  level {level}
                </button>
              ))}
            </div>
            <div className={styles.layerToggles}>
              <Toggle checked={showRegions} label="区域" onChange={setShowRegions} />
              <Toggle checked={showPoints} label="点位" onChange={setShowPoints} />
              <Toggle checked={showFlags} label="标记" onChange={setShowFlags} />
              <Toggle checked={showPaths} label="路径/AP" onChange={setShowPaths} />
              <Toggle checked={showCombat} label="交火" onChange={setShowCombat} />
            </div>
          </div>
          {progress ? (
            <HexMatchMapViewer
              map={progress.mapAssetView}
              phase={selectedPhase}
              level={selectedLevel}
              selectedAgentId={selectedAgentId}
              showRegions={showRegions}
              showPoints={showPoints}
              showFlags={showFlags}
              showPaths={showPaths}
              showCombat={showCombat}
              onSelectAgent={(agentId) => {
                setSelectedAgentId(agentId);
                setDrawerOpen(true);
                setDrawerTab("llm");
              }}
            />
          ) : (
            <section className={styles.mapPanel}><p className={styles.emptyInline}>正在加载 Hex Match Lab。</p></section>
          )}
        </section>

        <aside className={styles.rightRail}>
          <HexMatchPlayerPanel
            players={selectedPhase?.players ?? []}
            selectedAgentId={selectedAgentId}
            onSelectAgent={(agentId) => {
              setSelectedAgentId(agentId);
              setDrawerOpen(true);
              setDrawerTab("llm");
            }}
          />
          <section className={styles.sidePanel}>
            <div className={styles.sectionTitleRow}>
              <h2>审计入口</h2>
              <span>selected phase</span>
            </div>
            <div className={styles.auditButtons}>
              <button type="button" onClick={() => { setDrawerOpen(true); setDrawerTab("llm"); }}>LLM 调用</button>
              <button type="button" onClick={() => { setDrawerOpen(true); setDrawerTab("combat"); }}>战斗裁定</button>
              <button type="button" onClick={() => { setDrawerOpen(true); setDrawerTab("economy"); }}>经济证据</button>
              <button type="button" onClick={() => { setDrawerOpen(true); setDrawerTab("winner"); }}>硬胜负</button>
            </div>
            <div className={styles.auditSummary}>
              <p>accepted {selectedPhase?.acceptedActionCount ?? 0} / rejected {selectedPhase?.rejectedDraftCount ?? 0} / fallback {selectedPhase?.fallbackActionCount ?? 0}</p>
              <p>combat {selectedPhase?.combatResolutionCount ?? 0} / memory events {selectedPhase?.memoryEventCount ?? 0}</p>
              <p>hard condition: {selectedPhase?.winCondition?.reason ?? selectedTrace?.finalHardCondition?.reason ?? "暂无"}</p>
            </div>
          </section>
        </aside>
      </section>

      <HexMatchTimeline
        rounds={rounds}
        phases={selectedTrace?.phaseSummaries ?? []}
        selectedRoundArtifactId={selectedRound?.hexTraceArtifactId}
        selectedPhaseIndex={selectedPhaseIndex}
        onSelectRound={selectRound}
        onSelectPhase={setSelectedPhaseIndex}
      />

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

function Metric({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <article className={compact ? styles.metricCompact : styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (value: boolean) => void }) {
  return (
    <label className={styles.togglePill}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function ErrorBanner({ error }: { error: { message: string; details?: string } }) {
  return (
    <section className={styles.errorBanner}>
      <strong>{error.message.split("\n\n")[0]}</strong>
      <span>不会影响旧 Phase18。你可以新建 Hex 验收比赛、选择 active mapGame，或展开技术细节排查。</span>
      <details>
        <summary>technical details</summary>
        <pre>{error.details ?? error.message}</pre>
      </details>
    </section>
  );
}

function toFriendlyError(cause: unknown): { message: string; details?: string } {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/completed map|地图已完成/i.test(message)) {
    return {
      message: "当前地图已完成，不能继续提交回合。",
      details: message
    };
  }
  if (/no.*active.*dust2|没有可运行/i.test(message)) {
    return {
      message: "没有可运行的 Dust2 Hex 地图。",
      details: message
    };
  }
  if (/provider|external|eacces|api key|network/i.test(message)) {
    return {
      message: "真实 LLM provider 受限或失败。",
      details: message
    };
  }
  if (/max.*round/i.test(message)) {
    return {
      message: "已达到最大回合上限，地图未完成。",
      details: message
    };
  }
  return { message, details: message };
}

function formatScore(score: HexMatchLabProgress["score"] | undefined): string {
  return score ? `${score.teamA} - ${score.teamB}` : "暂无";
}
