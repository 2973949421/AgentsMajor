"use client";

import { useEffect, useMemo, useState } from "react";

import type {
  HexMatchLabPhaseSummary,
  HexMatchLabProgress,
  HexMatchLabProviderMode,
  HexMatchLabRoundSummary
} from "../../server-hex-match-lab";

import styles from "./hex-match-lab.module.css";

type RunScope = "round" | "map";

export function HexMatchLabClient() {
  const [progress, setProgress] = useState<HexMatchLabProgress | null>(null);
  const [providerMode, setProviderMode] = useState<HexMatchLabProviderMode>("fixture");
  const [maxRounds, setMaxRounds] = useState(40);
  const [maxLlmCallsPerPhase, setMaxLlmCallsPerPhase] = useState(10);
  const [mapGameId, setMapGameId] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [selectedRoundArtifactId, setSelectedRoundArtifactId] = useState<string | undefined>();
  const [selectedPhaseIndex, setSelectedPhaseIndex] = useState(0);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedTrace = progress?.selectedTrace;
  const selectedPhase = selectedTrace?.phaseSummaries[selectedPhaseIndex] ?? selectedTrace?.phaseSummaries[0];
  const rounds = progress?.roundSummaries ?? [];
  const selectedRound = useMemo(
    () => rounds.find((round) => round.hexTraceArtifactId === selectedRoundArtifactId) ?? rounds.at(-1),
    [rounds, selectedRoundArtifactId]
  );

  useEffect(() => {
    void refreshProgress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshProgress(nextRoundTraceArtifactId = selectedRoundArtifactId) {
    setBusyLabel("刷新中");
    setError(null);
    try {
      const params = new URLSearchParams();
      if (mapGameId.trim()) {
        params.set("mapGameId", mapGameId.trim());
      }
      if (nextRoundTraceArtifactId) {
        params.set("roundTraceArtifactId", nextRoundTraceArtifactId);
      }
      if (adminToken.trim()) {
        params.set("adminToken", adminToken.trim());
      }
      const response = await fetch(`/api/hex-lab/match/progress?${params.toString()}`, {
        cache: "no-store"
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Hex Match Lab progress request failed.");
      }
      setProgress(payload.progress);
      if (!mapGameId.trim() && payload.progress?.mapGameId) {
        setMapGameId(payload.progress.mapGameId);
      }
      if (nextRoundTraceArtifactId) {
        setSelectedRoundArtifactId(nextRoundTraceArtifactId);
      } else if (payload.progress?.selectedTrace?.hexTraceArtifactId) {
        setSelectedRoundArtifactId(payload.progress.selectedTrace.hexTraceArtifactId);
      }
      setSelectedPhaseIndex(0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyLabel(null);
    }
  }

  async function run(scope: RunScope) {
    setBusyLabel(scope === "round" ? "运行单回合" : "运行当前地图");
    setError(null);
    try {
      const response = await fetch("/api/hex-lab/match/run", {
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
      if (!response.ok) {
        throw new Error(payload.error ?? "Hex Match Lab run request failed.");
      }
      setProgress(payload.progress);
      if (payload.progress?.mapGameId) {
        setMapGameId(payload.progress.mapGameId);
      }
      if (payload.progress?.selectedTrace?.hexTraceArtifactId) {
        setSelectedRoundArtifactId(payload.progress.selectedTrace.hexTraceArtifactId);
      }
      setSelectedPhaseIndex(0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyLabel(null);
    }
  }

  async function selectRound(round: HexMatchLabRoundSummary) {
    if (!round.hexTraceArtifactId) {
      return;
    }
    await refreshProgress(round.hexTraceArtifactId);
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Phase 2.0-pre / N31</p>
          <h1>Hex Web 验收台</h1>
          <p className={styles.subtitle}>
            独立验收 HexGrid 蜂巢回合引擎；LLM 只给行动草案，最终 winner 来自 hard condition。
          </p>
        </div>
        <div className={styles.badges} aria-label="实验边界">
          <span>experimental</span>
          <span>writesDb=true</span>
          <span>replacesLegacyRoundPath=false</span>
          <span>LLM cannot write final winner</span>
        </div>
      </header>

      <section className={styles.layout}>
        <aside className={styles.controls}>
          <h2>控制台</h2>
          <label>
            <span>mapGameId</span>
            <input
              value={mapGameId}
              onChange={(event) => setMapGameId(event.target.value)}
              placeholder="留空时读取最新 Dust2"
            />
          </label>
          <label>
            <span>provider mode</span>
            <select value={providerMode} onChange={(event) => setProviderMode(event.target.value as HexMatchLabProviderMode)}>
              <option value="fixture">fixture（默认验收）</option>
              <option value="real">real（N33 稳定专项）</option>
            </select>
          </label>
          <label>
            <span>max rounds</span>
            <input
              type="number"
              min={1}
              max={60}
              value={maxRounds}
              onChange={(event) => setMaxRounds(Number(event.target.value))}
            />
          </label>
          <label>
            <span>max LLM calls / phase</span>
            <input
              type="number"
              min={0}
              max={50}
              value={maxLlmCallsPerPhase}
              onChange={(event) => setMaxLlmCallsPerPhase(Number(event.target.value))}
            />
          </label>
          <label>
            <span>admin token（可选）</span>
            <input
              value={adminToken}
              onChange={(event) => setAdminToken(event.target.value)}
              placeholder="本地无 token 可留空"
              type="password"
            />
          </label>

          <div className={styles.buttonGrid}>
            <button type="button" onClick={() => run("round")} disabled={Boolean(busyLabel)}>
              跑 Hex 单回合
            </button>
            <button type="button" onClick={() => run("map")} disabled={Boolean(busyLabel)}>
              跑 Hex 当前 Dust2 地图
            </button>
            <button type="button" onClick={() => refreshProgress()} disabled={Boolean(busyLabel)}>
              刷新最新结果
            </button>
            <a className={styles.linkButton} href="/hex-lab/editor">
              打开 Hex 地图编辑器
            </a>
          </div>

          <div className={styles.notice}>
            <strong>验收口径</strong>
            <p>本页不计算 winner，不伪造 HP、枪械、投掷物或敌人真实位置，只展示 Hex trace 已经写下的事实。</p>
          </div>
        </aside>

        <section className={styles.content}>
          {error ? <div className={styles.error}>{error}</div> : null}
          {busyLabel ? <div className={styles.statusBar}>{busyLabel}...</div> : null}

          <section className={styles.summaryGrid}>
            <Metric title="地图状态" value={progress?.mapStatus ?? "未加载"} />
            <Metric title="比分" value={formatScore(progress?.score)} />
            <Metric title="回合数" value={String(progress?.mapSummary?.roundsCommitted ?? rounds.length)} />
            <Metric title="summary artifact" value={progress?.latestSummaryArtifactId ?? "暂无"} compact />
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>地图级摘要</h2>
              <span>{progress?.mapGameId ?? "未选择 mapGame"}</span>
            </div>
            {progress?.mapSummary ? (
              <div className={styles.summaryText}>
                <p>
                  <strong>source</strong> {progress.mapSummary.source}
                </p>
                <p>
                  <strong>status</strong> {progress.mapSummary.status} / <strong>reason</strong>{" "}
                  {progress.mapSummary.completionReason}
                </p>
                <p>
                  <strong>fallback</strong> {progress.mapSummary.fallbackSummary.totalFallbackCount} / <strong>combat</strong>{" "}
                  {progress.mapSummary.fallbackSummary.totalCombatResolutionCount}
                </p>
              </div>
            ) : (
              <p className={styles.empty}>暂无 hex_map_summary。可以刷新最新结果，或先跑 Hex 当前地图。</p>
            )}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Round 时间线</h2>
              <span>{rounds.length} rounds</span>
            </div>
            <div className={styles.roundRail}>
              {rounds.map((round) => (
                <button
                  type="button"
                  key={round.roundId}
                  className={round.hexTraceArtifactId === selectedRound?.hexTraceArtifactId ? styles.roundActive : styles.roundCard}
                  onClick={() => selectRound(round)}
                >
                  <span>R{round.roundNumber}</span>
                  <strong>{round.roundWinType ?? "unknown"}</strong>
                  <small>{round.winnerTeamId ?? "no winner"}</small>
                </button>
              ))}
            </div>
          </section>

          {selectedTrace ? (
            <section className={styles.detailGrid}>
              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2>选中回合</h2>
                  <span>{selectedTrace.hexTraceArtifactId}</span>
                </div>
                <div className={styles.summaryText}>
                  <p>
                    <strong>winner</strong> {selectedTrace.winnerTeamId ?? "unknown"}
                  </p>
                  <p>
                    <strong>win type</strong> {selectedTrace.roundWinType ?? "unknown"}
                  </p>
                  <p>
                    <strong>hard condition</strong> {selectedTrace.finalHardCondition?.reason ?? "missing"}
                  </p>
                  <p>
                    <strong>LLM calls</strong> {selectedTrace.audit.totalLlmCallsAttempted} / <strong>fallback</strong>{" "}
                    {selectedTrace.audit.fallbackCount}
                  </p>
                </div>
              </section>

              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2>Phase 进度</h2>
                  <span>{selectedTrace.phaseSummaries.length} phases</span>
                </div>
                <div className={styles.phaseRail}>
                  {selectedTrace.phaseSummaries.map((phase, index) => (
                    <button
                      key={`${phase.phaseIndex}_${phase.phaseId}`}
                      type="button"
                      className={index === selectedPhaseIndex ? styles.phaseActive : styles.phaseCard}
                      onClick={() => setSelectedPhaseIndex(index)}
                    >
                      <span>{phase.phaseIndex + 1}</span>
                      <strong>{phase.phaseId}</strong>
                      <small>
                        A{phase.aliveAttackCount}/D{phase.aliveDefenseCount}
                      </small>
                    </button>
                  ))}
                </div>
              </section>
            </section>
          ) : null}

          {selectedPhase ? <PhaseDetail phase={selectedPhase} /> : null}

          {selectedTrace ? (
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2>经济上下文</h2>
                <span>{selectedTrace.economySummary.length} teams</span>
              </div>
              <div className={styles.economyGrid}>
                {selectedTrace.economySummary.map((team) => (
                  <article key={team.teamId} className={styles.economyCard}>
                    <h3>{team.teamId}</h3>
                    <p>
                      {team.side} / {team.posture} / {team.summaryBuyType} / cash {team.totalCash ?? 0}
                    </p>
                    <ul>
                      {team.agents.slice(0, 6).map((agent) => (
                        <li key={agent.agentId}>
                          {agent.agentId}: {agent.resourceTier}/{agent.utilityTier}, output {agent.outputBudget}
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </section>
      </section>
    </main>
  );
}

function PhaseDetail({ phase }: { phase: HexMatchLabPhaseSummary }) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2>当前 Phase 详情</h2>
        <span>
          {phase.phaseIndex + 1} / {phase.phaseId}
        </span>
      </div>
      <section className={styles.phaseStats}>
        <Metric title="accepted" value={String(phase.acceptedActionCount)} />
        <Metric title="rejected" value={String(phase.rejectedDraftCount)} />
        <Metric title="fallback" value={String(phase.fallbackActionCount)} />
        <Metric title="combat" value={String(phase.combatResolutionCount)} />
        <Metric title="bomb" value={phase.bombState.planted ? `planted ${phase.bombState.plantedCellId ?? ""}` : "not planted"} />
      </section>

      <div className={styles.columns}>
        <article>
          <h3>Agent actions</h3>
          <ul className={styles.auditList}>
            {phase.actions.map((action) => (
              <li key={`${phase.phaseIndex}_${action.agentId}_${action.actionType}_${action.targetCellId}`}>
                <strong>
                  {action.agentId} {action.actionType}
                </strong>
                <span>
                  {action.currentCellId} -&gt; {action.targetCellId} / AP {action.apCost ?? 0} / {action.valid ? "accepted" : "fallback"}
                </span>
                {action.fallbackReason ? <em>{action.fallbackReason}</em> : null}
                {action.businessIntent ? <p>{action.businessIntent}</p> : null}
              </li>
            ))}
          </ul>
        </article>
        <article>
          <h3>Combat verdicts</h3>
          <ul className={styles.auditList}>
            {phase.combats.map((combat) => (
              <li key={combat.contactId}>
                <strong>
                  {combat.contactId} / {combat.advantage} / {combat.verdict}
                </strong>
                <span>participants: {combat.participants.join(", ")}</span>
                <span>
                  business A/D {combat.businessScoreAttack ?? 0}/{combat.businessScoreDefense ?? 0}; CS A/D{" "}
                  {combat.csScoreAttack ?? 0}/{combat.csScoreDefense ?? 0}
                </span>
                <span>casualties: {combat.casualties.join(", ") || "none"}</span>
              </li>
            ))}
            {phase.combats.length === 0 ? <li>本阶段没有 combat resolution。</li> : null}
          </ul>
        </article>
      </div>
    </section>
  );
}

function Metric({ title, value, compact = false }: { title: string; value: string; compact?: boolean }) {
  return (
    <article className={compact ? styles.metricCompact : styles.metric}>
      <span>{title}</span>
      <strong>{value}</strong>
    </article>
  );
}

function formatScore(score: HexMatchLabProgress["score"] | undefined): string {
  return score ? `${score.teamA} - ${score.teamB}` : "暂无";
}
