"use client";

import { useEffect, useMemo, useState } from "react";

import { dust2NodePositions, dust2PhaseLabels, dust2PrimaryNodeIds } from "./dust2-node-layout";
import styles from "./node-lab.module.css";

type NodeLabScope = "round" | "map";
type NodeLabProviderMode = "deterministic" | "fixture" | "real";
type NodeLabStatus = "idle" | "running" | "completed" | "failed";
type NodeControl = "attack" | "defense" | "contested" | "neutral" | string;
type NodeLabMapView = "sector" | "node";

interface NodeLabProgress {
  runId: string;
  status: NodeLabStatus;
  scope: NodeLabScope;
  providerMode: NodeLabProviderMode;
  modelId?: string;
  runtimeMatchId: string;
  mapGameId: string;
  mapName: string;
  score: { teamA: number; teamB: number };
  roundsCommitted: number;
  nodeTraceArtifactIds: string[];
  mapSummaryArtifactId?: string;
  completionReason?: string;
  latestError?: string;
  externalBlocked: boolean;
  llmAudit: NodeLabLlmAudit;
  roundSummaries: NodeLabRoundSummary[];
  mapGraph: NodeLabMapGraph;
  roundTraces: NodeLabRoundTrace[];
  latestRoundTrace?: NodeLabRoundTrace;
}

interface NodeLabMapGraph {
  nodes: NodeLabMapNode[];
  edges: NodeLabMapEdge[];
  sectors: NodeLabMapSector[];
  sectorEdges: NodeLabMapSectorEdge[];
}

interface NodeLabMapNode {
  nodeId: string;
  displayName: string;
  area: string;
  kind?: string;
}

interface NodeLabMapEdge {
  from: string;
  to: string;
  type: string;
  label?: string;
}

interface NodeLabMapSector {
  sectorId: string;
  displayName: string;
  displayNameZh: string;
  areaType: string;
  nodeIds: string[];
  adjacentSectorIds: string[];
  polygon: Array<[number, number]>;
}

interface NodeLabMapSectorEdge {
  from: string;
  to: string;
  type: string;
}

interface NodeLabLlmAudit {
  providerMode: NodeLabProviderMode;
  modelId?: string;
  callsAttempted: number;
  fallbackCount: number;
  fallbackReasons: string[];
  ignoredFields: string[];
  draftAcceptedCount: number;
  draftRejectedCount: number;
  contentLength: number;
  reasoningContentLength: number;
  jsonTruncated: boolean;
  reasoningExhausted: boolean;
  agentActionCallsAttempted: number;
  agentActionFallbackCount: number;
  agentActionFallbackReasons: string[];
  agentActionIgnoredFields: string[];
  agentActionDraftAcceptedCount: number;
  agentActionDraftRejectedCount: number;
  agentActionContentLength: number;
  agentActionReasoningContentLength: number;
  agentActionJsonTruncated: boolean;
  agentActionReasoningExhausted: boolean;
}

interface NodeLabRoundSummary {
  roundNumber: number;
  winnerTeamId?: string;
  loserTeamId?: string;
  roundWinType?: string;
  nodeTraceArtifactId: string;
  totalApSpent: number;
  fallbackCount: number;
  ignoredFields: string[];
  finalHardCondition?: {
    isRoundOver: boolean;
    winnerSide?: "attack" | "defense";
    winnerTeamId?: string;
    roundWinType?: string;
    reason: string;
  };
}

interface NodeLabRoundTrace extends NodeLabRoundSummary {
  source: "node_round_engine_committed";
  writesDb: true;
  replacesLegacyRoundPath: false;
  phaseSummaries: NodeLabPhaseSummary[];
  phaseDetails: NodeLabPhaseDetail[];
  audit: NodeLabLlmAudit;
}

interface NodeLabPhaseSummary {
  phaseId: string;
  activeNodeCount: number;
  actionCount: number;
  localVerdictCount: number;
  contestedNodeIds: string[];
  attackControlledNodeIds: string[];
  defenseControlledNodeIds: string[];
  neutralNodeIds: string[];
  businessIntentSummary: string[];
  winCondition?: {
    isRoundOver: boolean;
    winnerSide?: "attack" | "defense";
    roundWinType?: string;
    reason: string;
  };
}

interface NodeLabNodeState {
  nodeId: string;
  phaseId: string;
  attackAgentIds: string[];
  defenseAgentIds: string[];
  control: NodeControl;
  businessIntent?: string;
}

interface NodeLabPhaseDetail {
  phaseId: string;
  activeNodeIds: string[];
  nodeStates: NodeLabNodeState[];
  sectorStates: NodeLabSectorState[];
  actionPointBudgets: Array<{
    agentId: string;
    baseAp: number;
    spentAp: number;
    remainingAp: number;
  }>;
  agentActions: Array<{
    agentId: string;
    currentNodeId?: string;
    targetNodeId: string;
    actionType: string;
    apCost: number;
    side?: "attack" | "defense";
    teamId?: string;
    businessIntent: string;
  }>;
  localVerdicts: Array<{
    nodeId: string;
    controlAfter: NodeControl;
    engagementOccurred: boolean;
    triggersWinConditionCheck: boolean;
    summary: string;
  }>;
}

interface NodeLabSectorState {
  sectorId: string;
  nodeIds: string[];
  active: boolean;
  attackCount: number;
  defenseCount: number;
  controlAfter: NodeControl;
  engagementOccurred: boolean;
  winConditionCheck: boolean;
  fallbackCount: number;
}

interface NodeLabApiPayload {
  progress?: NodeLabProgress;
  error?: string;
  summary?: string;
}

interface ChainAudit {
  title: string;
  callsAttempted: number;
  accepted: number;
  rejected: number;
  fallbackCount: number;
  fallbackReasons: string[];
  ignoredFields: string[];
  contentLength: number;
  reasoningContentLength: number;
  jsonTruncated: boolean;
  reasoningExhausted: boolean;
}

export function NodeLabClient() {
  const [maxRounds, setMaxRounds] = useState(8);
  const [maxAgentActionLlmCalls, setMaxAgentActionLlmCalls] = useState(5);
  const [maxLocalJudgeLlmCalls, setMaxLocalJudgeLlmCalls] = useState(5);
  const [adminToken, setAdminToken] = useState("");
  const [progress, setProgress] = useState<NodeLabProgress | null>(null);
  const [message, setMessage] = useState("Node Lab 尚未启动。");
  const [busy, setBusy] = useState(false);
  const [selectedRoundNumber, setSelectedRoundNumber] = useState<number | null>(null);
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);
  const [mapView, setMapView] = useState<NodeLabMapView>("sector");
  const [selectedSectorId, setSelectedSectorId] = useState<string | null>(null);

  useEffect(() => {
    if (!progress?.runId || progress.status !== "running") {
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await fetchNodeLabProgress(progress.runId, adminToken);
        if (cancelled) {
          return;
        }
        setProgress(next);
        if (next.status !== "running") {
          setBusy(false);
          setMessage(next.status === "completed" ? "Node Lab run 已完成。" : next.latestError ?? "Node Lab run 失败。");
        }
      } catch (error) {
        if (!cancelled) {
          setBusy(false);
          setMessage(error instanceof Error ? error.message : "读取 Node Lab 进度失败。");
        }
      }
    };
    const intervalId = window.setInterval(poll, 1000);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [adminToken, progress?.runId, progress?.status]);

  useEffect(() => {
    if (!progress || progress.roundTraces.length === 0) {
      return;
    }
    const hasSelectedRound = selectedRoundNumber !== null && progress.roundTraces.some((trace) => trace.roundNumber === selectedRoundNumber);
    const nextTrace = hasSelectedRound ? progress.roundTraces.find((trace) => trace.roundNumber === selectedRoundNumber) : progress.roundTraces.at(-1);
    if (!hasSelectedRound && nextTrace) {
      setSelectedRoundNumber(nextTrace.roundNumber);
    }
    if (nextTrace && (!selectedPhaseId || !nextTrace.phaseDetails.some((phase) => phase.phaseId === selectedPhaseId))) {
      setSelectedPhaseId(nextTrace.phaseDetails.at(-1)?.phaseId ?? null);
    }
  }, [progress, selectedPhaseId, selectedRoundNumber]);

  const selectedTrace = useMemo(() => {
    if (!progress) {
      return undefined;
    }
    return progress.roundTraces.find((trace) => trace.roundNumber === selectedRoundNumber) ?? progress.roundTraces.at(-1) ?? progress.latestRoundTrace;
  }, [progress, selectedRoundNumber]);

  const selectedPhase = useMemo(() => {
    if (!selectedTrace) {
      return undefined;
    }
    return selectedTrace.phaseDetails.find((phase) => phase.phaseId === selectedPhaseId) ?? selectedTrace.phaseDetails.at(-1);
  }, [selectedPhaseId, selectedTrace]);

  const selectedPhaseSummary = useMemo(() => {
    if (!selectedTrace || !selectedPhase) {
      return undefined;
    }
    return selectedTrace.phaseSummaries.find((phase) => phase.phaseId === selectedPhase.phaseId);
  }, [selectedPhase, selectedTrace]);

  const selectedSector = useMemo(() => {
    if (!progress || !selectedPhase || !selectedSectorId) {
      return undefined;
    }
    const sector = progress.mapGraph.sectors.find((item) => item.sectorId === selectedSectorId);
    const state = selectedPhase.sectorStates.find((item) => item.sectorId === selectedSectorId);
    return sector && state ? { sector, state } : undefined;
  }, [progress, selectedPhase, selectedSectorId]);

  const totalLlmCalls = progress ? progress.llmAudit.callsAttempted + progress.llmAudit.agentActionCallsAttempted : 0;
  const hasExternalBlock = progress ? progress.externalBlocked || hasBlockedReason(progress.llmAudit) : false;

  const startRun = async (scope: NodeLabScope) => {
    setBusy(true);
    setMessage("真实 LLM Node Lab run 正在启动。");
    try {
      const response = await fetch("/api/node-lab/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          providerMode: "real",
          agentActionLlmShadow: true,
          localJudgeLlmShadow: true,
          maxRounds,
          maxAgentActionLlmCalls,
          maxLocalJudgeLlmCalls,
          ...(adminToken ? { adminToken } : {})
        })
      });
      const payload = (await response.json().catch(() => ({}))) as NodeLabApiPayload;
      if (!response.ok || !payload.progress) {
        throw new Error(payload.error ?? `Node Lab start failed with HTTP ${response.status}`);
      }
      setProgress(payload.progress);
      setMessage(payload.summary ?? "真实 LLM Node Lab run 已启动。");
      if (payload.progress.status !== "running") {
        setBusy(false);
      }
    } catch (error) {
      setBusy(false);
      setMessage(error instanceof Error ? error.message : "启动 Node Lab run 失败。");
    }
  };

  const refresh = async () => {
    setBusy(true);
    setMessage("正在刷新 Node Lab 进度。");
    try {
      const next = await fetchNodeLabProgress(progress?.runId, adminToken);
      setProgress(next);
      setMessage("Node Lab 进度已刷新。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "刷新 Node Lab 进度失败。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={styles.pageShell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Phase 2.0-pre Node Lab</p>
          <h1>真实 LLM 节点化比赛观测台</h1>
          <p className={styles.headerCopy}>
            只用真实 LLM 运行节点化实验。LLM 参与阶段行动和局部裁判 shadow，最终 winner 仍由 hard win condition 写入。
          </p>
        </div>
        <a className={styles.backLink} href="/">
          返回旧 Phase18 控制台
        </a>
      </header>

      <section className={styles.labGrid}>
        <aside className={styles.controlPanel}>
          <h2>真实 LLM 控制台</h2>
          <p className={styles.panelCopy}>主入口固定 provider=real，并强制开启 agent action 与 local judge shadow。</p>

          <label className={styles.fieldLabel}>
            max rounds
            <input className={styles.input} type="number" min={1} max={40} value={maxRounds} onChange={(event) => setMaxRounds(Number(event.target.value))} />
          </label>

          <label className={styles.fieldLabel}>
            max agent action calls
            <input
              className={styles.input}
              type="number"
              min={0}
              max={20}
              value={maxAgentActionLlmCalls}
              onChange={(event) => setMaxAgentActionLlmCalls(Number(event.target.value))}
            />
          </label>

          <label className={styles.fieldLabel}>
            max local judge calls
            <input
              className={styles.input}
              type="number"
              min={0}
              max={20}
              value={maxLocalJudgeLlmCalls}
              onChange={(event) => setMaxLocalJudgeLlmCalls(Number(event.target.value))}
            />
          </label>

          <label className={styles.fieldLabel}>
            本地运行口令
            <input className={styles.input} type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} autoComplete="off" />
          </label>

          <div className={styles.buttonRow}>
            <button className={styles.primaryButton} type="button" disabled={busy} onClick={() => void startRun("round")}>
              真实 LLM 单回合
            </button>
            <button className={styles.primaryButton} type="button" disabled={busy} onClick={() => void startRun("map")}>
              真实 LLM 地图
            </button>
            <button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => void refresh()}>
              刷新最新 run
            </button>
          </div>

          <p className={styles.statusText}>{message}</p>
          <div className={styles.boundaryNote}>
            <strong>硬边界</strong>
            <span>LLM 只写 shadow draft；最终 winner 来自 WinConditionMaterializer；前端不重新计算 winner。</span>
          </div>
        </aside>

        <section className={styles.mainColumn}>
          <MetricGrid
            items={[
              ["状态", progress?.status ?? "idle"],
              ["Provider", progress?.providerMode ?? "real"],
              ["Model", progress?.modelId ?? "--"],
              ["比分", progress ? `${progress.score.teamA}:${progress.score.teamB}` : "--"],
              ["提交回合", progress ? String(progress.roundsCommitted) : "0"],
              ["真实 LLM 调用", String(totalLlmCalls)],
              ["Fallback", progress ? String(progress.llmAudit.fallbackCount + progress.llmAudit.agentActionFallbackCount) : "0"],
              ["Trace", progress ? String(progress.nodeTraceArtifactIds.length) : "0"]
            ]}
          />

          {hasExternalBlock ? (
            <div className={styles.warningBand}>真实 provider 出现网络或安全策略阻断，详情见 LLM 调用进程。</div>
          ) : progress?.latestError ? (
            <div className={styles.errorBand}>{progress.latestError}</div>
          ) : null}

          <section className={styles.sectionBlock}>
            <div className={styles.sectionHeader}>
              <h2>Round / Phase 进度</h2>
              <span>{progress?.mapSummaryArtifactId ?? "等待 map summary artifact"}</span>
            </div>
            <RoundPhaseTimeline
              rounds={progress?.roundSummaries ?? []}
              selectedRoundNumber={selectedTrace?.roundNumber ?? null}
              selectedPhaseId={selectedPhase?.phaseId ?? null}
              phaseIds={selectedTrace?.phaseDetails.map((phase) => phase.phaseId) ?? []}
              onRoundSelect={(roundNumber) => {
                setSelectedRoundNumber(roundNumber);
                const trace = progress?.roundTraces.find((item) => item.roundNumber === roundNumber);
                setSelectedPhaseId(trace?.phaseDetails.at(-1)?.phaseId ?? null);
              }}
              onPhaseSelect={setSelectedPhaseId}
            />
          </section>

          <section className={styles.mapAndDetailGrid}>
            <section className={styles.sectionBlock}>
              <div className={styles.sectionHeader}>
                <h2>Dust2 节点地图</h2>
                <span>{selectedPhase ? `${selectedTrace?.roundNumber ?? "--"} / ${selectedPhase.phaseId}` : "暂无 phase"}</span>
              </div>
              <div className={styles.viewToggle} role="group" aria-label="Dust2 map view">
                <button className={mapView === "sector" ? styles.viewToggleActive : ""} type="button" onClick={() => setMapView("sector")}>
                  区块视图
                </button>
                <button className={mapView === "node" ? styles.viewToggleActive : ""} type="button" onClick={() => setMapView("node")}>
                  详细节点
                </button>
              </div>
              <Dust2Map
                graph={progress?.mapGraph}
                phase={selectedPhase}
                phaseSummary={selectedPhaseSummary}
                view={mapView}
                selectedSectorId={selectedSectorId}
                onSectorSelect={setSelectedSectorId}
              />
            </section>

            <section className={styles.sectionBlock}>
              <div className={styles.sectionHeader}>
                <h2>当前 Phase 详情</h2>
                <span>{selectedTrace?.nodeTraceArtifactId ?? "暂无 trace"}</span>
              </div>
              <PhaseDetailPanel phase={selectedPhase} summary={selectedPhaseSummary} trace={selectedTrace} selectedSector={selectedSector} />
            </section>
          </section>

          <section className={styles.sectionBlock}>
            <div className={styles.sectionHeader}>
              <h2>LLM 调用进程</h2>
              <span>节点化调用来自 node trace，不写旧 Phase18 llm_calls 表</span>
            </div>
            <LlmProcessPanel audit={progress?.llmAudit} />
          </section>

          <section className={styles.sectionBlock}>
            <div className={styles.sectionHeader}>
              <h2>回合事实与审计</h2>
              <span>{selectedTrace?.source ?? "暂无 committed trace"}</span>
            </div>
            <RoundFactPanel trace={selectedTrace} />
          </section>
        </section>
      </section>
    </main>
  );
}

async function fetchNodeLabProgress(runId: string | undefined, adminToken: string): Promise<NodeLabProgress> {
  const params = new URLSearchParams();
  if (runId) {
    params.set("runId", runId);
  }
  if (adminToken) {
    params.set("adminToken", adminToken);
  }
  const response = await fetch(`/api/node-lab/run${params.size > 0 ? `?${params.toString()}` : ""}`, {
    method: "GET",
    cache: "no-store"
  });
  const payload = (await response.json().catch(() => ({}))) as NodeLabApiPayload;
  if (!response.ok || !payload.progress) {
    throw new Error(payload.error ?? `Node Lab progress failed with HTTP ${response.status}`);
  }
  return payload.progress;
}

function MetricGrid({ items }: { items: Array<[string, string]> }) {
  return (
    <div className={styles.metricGrid}>
      {items.map(([label, value]) => (
        <div key={label} className={styles.metricItem}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function RoundPhaseTimeline({
  rounds,
  selectedRoundNumber,
  selectedPhaseId,
  phaseIds,
  onRoundSelect,
  onPhaseSelect
}: {
  rounds: NodeLabRoundSummary[];
  selectedRoundNumber: number | null;
  selectedPhaseId: string | null;
  phaseIds: string[];
  onRoundSelect: (roundNumber: number) => void;
  onPhaseSelect: (phaseId: string) => void;
}) {
  if (rounds.length === 0) {
    return <p className={styles.emptyText}>暂无 committed node round。</p>;
  }
  return (
    <div className={styles.timelineStack}>
      <div className={styles.roundRail}>
        {rounds.map((round) => (
          <button
            key={`${round.roundNumber}-${round.nodeTraceArtifactId}`}
            type="button"
            className={`${styles.roundStep} ${round.roundNumber === selectedRoundNumber ? styles.roundStepActive : ""}`}
            onClick={() => onRoundSelect(round.roundNumber)}
          >
            <span>R{round.roundNumber}</span>
            <strong>{round.roundWinType ?? "--"}</strong>
            <em>{shortTeam(round.winnerTeamId)}</em>
          </button>
        ))}
      </div>
      <div className={styles.phaseRail}>
        {phaseIds.map((phaseId, index) => (
          <button
            key={phaseId}
            type="button"
            className={`${styles.phaseStep} ${phaseId === selectedPhaseId ? styles.phaseStepActive : ""}`}
            onClick={() => onPhaseSelect(phaseId)}
          >
            <span>{index + 1}</span>
            <strong>{dust2PhaseLabels[phaseId] ?? phaseId}</strong>
          </button>
        ))}
      </div>
    </div>
  );
}

function Dust2Map({
  graph,
  phase,
  phaseSummary,
  view,
  selectedSectorId,
  onSectorSelect
}: {
  graph: NodeLabMapGraph | undefined;
  phase: NodeLabPhaseDetail | undefined;
  phaseSummary: NodeLabPhaseSummary | undefined;
  view: NodeLabMapView;
  selectedSectorId: string | null;
  onSectorSelect: (sectorId: string) => void;
}) {
  if (view === "node") {
    return <Dust2NodeMap graph={graph} phase={phase} phaseSummary={phaseSummary} />;
  }
  return <Dust2SectorMap graph={graph} phase={phase} phaseSummary={phaseSummary} selectedSectorId={selectedSectorId} onSectorSelect={onSectorSelect} />;
}

function Dust2SectorMap({
  graph,
  phase,
  phaseSummary,
  selectedSectorId,
  onSectorSelect
}: {
  graph: NodeLabMapGraph | undefined;
  phase: NodeLabPhaseDetail | undefined;
  phaseSummary: NodeLabPhaseSummary | undefined;
  selectedSectorId: string | null;
  onSectorSelect: (sectorId: string) => void;
}) {
  if (!graph || !phase) {
    return <p className={styles.emptyText}>暂无可展示的 Dust2 区块状态。</p>;
  }

  const sectorById = new Map(graph.sectors.map((sector) => [sector.sectorId, sector]));
  const sectorStateById = new Map(phase.sectorStates.map((state) => [state.sectorId, state]));

  return (
    <div className={styles.mapShell}>
      <svg className={styles.sectorMapSvg} viewBox="0 0 100 100" role="img" aria-label="Dust2 sector map" preserveAspectRatio="xMidYMid meet">
        <rect x="0" y="0" width="100" height="100" className={styles.sectorMapBackground} />
        {graph.sectorEdges.map((edge) => {
          const from = sectorById.get(edge.from);
          const to = sectorById.get(edge.to);
          if (!from || !to) {
            return null;
          }
          const fromCenter = polygonCentroid(from.polygon);
          const toCenter = polygonCentroid(to.polygon);
          const highlighted = sectorStateById.get(edge.from)?.active || sectorStateById.get(edge.to)?.active;
          return (
            <line
              key={`${edge.from}-${edge.to}-${edge.type}`}
              x1={fromCenter.x}
              y1={fromCenter.y}
              x2={toCenter.x}
              y2={toCenter.y}
              className={highlighted ? styles.sectorEdgeActive : styles.sectorEdge}
            />
          );
        })}
        {graph.sectors.map((sector) => {
          const state = sectorStateById.get(sector.sectorId);
          const center = polygonCentroid(sector.polygon);
          const control = normalizeControl(state?.controlAfter);
          const selected = selectedSectorId === sector.sectorId;
          const classes = [
            styles.mapSector,
            state?.active ? styles.mapSectorActive : "",
            selected ? styles.mapSectorSelected : "",
            sectorControlClass(control),
            state?.engagementOccurred ? styles.mapSectorEngaged : "",
            state?.winConditionCheck ? styles.mapSectorWinCheck : ""
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <g key={sector.sectorId}>
              <polygon
                points={sector.polygon.map((point) => point.join(",")).join(" ")}
                className={classes}
                onClick={() => onSectorSelect(sector.sectorId)}
              >
                <title>{`${sector.displayNameZh} / ${sector.sectorId} / A${state?.attackCount ?? 0} D${state?.defenseCount ?? 0}`}</title>
              </polygon>
              <text x={center.x} y={center.y - 1.2} className={styles.mapSectorLabel}>
                {sector.displayNameZh}
              </text>
              <text x={center.x} y={center.y + 3.1} className={styles.mapSectorCount}>
                A{state?.attackCount ?? 0}/D{state?.defenseCount ?? 0}
              </text>
              {state?.winConditionCheck ? (
                <text x={center.x + 6} y={center.y - 5} className={styles.mapSectorBang}>
                  !
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className={styles.mapLegend}>
        <span className={styles.legendAttack}>attack</span>
        <span className={styles.legendDefense}>defense</span>
        <span className={styles.legendContested}>contested</span>
        <span className={styles.legendNeutral}>neutral</span>
        <span className={styles.legendWin}>win check</span>
      </div>
      {phaseSummary ? (
        <div className={styles.mapStatusLine}>
          sectors {graph.sectors.length} / active {phaseSummary.activeNodeCount} nodes / actions {phaseSummary.actionCount}
        </div>
      ) : null}
    </div>
  );
}

function Dust2NodeMap({
  graph,
  phase,
  phaseSummary
}: {
  graph: NodeLabMapGraph | undefined;
  phase: NodeLabPhaseDetail | undefined;
  phaseSummary: NodeLabPhaseSummary | undefined;
}) {
  if (!graph || !phase) {
    return <p className={styles.emptyText}>暂无可展示的 Dust2 节点状态。</p>;
  }
  const nodeStateById = new Map(phase.nodeStates.map((state) => [state.nodeId, state]));
  const verdictById = new Map(phase.localVerdicts.map((verdict) => [verdict.nodeId, verdict]));
  const activeNodeIds = new Set(phase.activeNodeIds);
  const winCheckNodeIds = new Set(phase.localVerdicts.filter((verdict) => verdict.triggersWinConditionCheck).map((verdict) => verdict.nodeId));
  const visibleNodeIds = new Set(graph.nodes.filter((node) => dust2PrimaryNodeIds.has(node.nodeId)).map((node) => node.nodeId));
  const visibleNodes = graph.nodes.filter((node) => visibleNodeIds.has(node.nodeId));
  const visibleEdges = graph.edges.filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to));

  return (
    <div className={styles.mapShell}>
      <svg className={styles.mapEdges} viewBox="0 0 100 100" aria-hidden="true" preserveAspectRatio="none">
        {visibleEdges.map((edge) => {
          const from = dust2NodePositions[edge.from];
          const to = dust2NodePositions[edge.to];
          if (!from || !to) {
            return null;
          }
          const highlighted = activeNodeIds.has(edge.from) || activeNodeIds.has(edge.to);
          return (
            <line
              key={`${edge.from}-${edge.to}-${edge.type}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              className={highlighted ? styles.mapEdgeActive : styles.mapEdge}
            />
          );
        })}
      </svg>
      <div className={styles.mapBackdrop}>
        <span className={styles.mapRegionA}>A SITE</span>
        <span className={styles.mapRegionB}>B SITE</span>
        <span className={styles.mapRegionMid}>MID</span>
      </div>
      {visibleNodes.map((node) => {
        const position = dust2NodePositions[node.nodeId];
        if (!position) {
          return null;
        }
        const state = nodeStateById.get(node.nodeId);
        const verdict = verdictById.get(node.nodeId);
        const control = normalizeControl(verdict?.controlAfter ?? state?.control);
        const active = activeNodeIds.has(node.nodeId);
        const attackCount = state?.attackAgentIds.length ?? 0;
        const defenseCount = state?.defenseAgentIds.length ?? 0;
        const classes = [
          styles.mapNode,
          active ? styles.mapNodeActive : "",
          controlClass(control),
          verdict?.engagementOccurred ? styles.mapNodeEngaged : "",
          winCheckNodeIds.has(node.nodeId) ? styles.mapNodeWinCheck : ""
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={node.nodeId}
            type="button"
            className={classes}
            style={{ left: `${position.x}%`, top: `${position.y}%` }}
            title={`${node.displayName} / ${node.nodeId}\ncontrol=${control}\nattack=${attackCount}, defense=${defenseCount}\n${verdict?.summary ?? state?.businessIntent ?? ""}`}
          >
            <span>{position.label ?? node.displayName}</span>
            <strong>
              A{attackCount}/D{defenseCount}
            </strong>
          </button>
        );
      })}
      <div className={styles.mapLegend}>
        <span className={styles.legendAttack}>attack</span>
        <span className={styles.legendDefense}>defense</span>
        <span className={styles.legendContested}>contested</span>
        <span className={styles.legendNeutral}>neutral</span>
        <span className={styles.legendWin}>win check</span>
      </div>
      {phaseSummary ? (
        <div className={styles.mapStatusLine}>
          key nodes {visibleNodes.length}/{graph.nodes.length} / active {phaseSummary.activeNodeCount} / actions {phaseSummary.actionCount}
        </div>
      ) : null}
    </div>
  );
}

function PhaseDetailPanel({
  phase,
  summary,
  trace,
  selectedSector
}: {
  phase: NodeLabPhaseDetail | undefined;
  summary: NodeLabPhaseSummary | undefined;
  trace: NodeLabRoundTrace | undefined;
  selectedSector: {
    sector: NodeLabMapSector;
    state: NodeLabSectorState;
  } | undefined;
}) {
  if (!phase) {
    return <p className={styles.emptyText}>选择一个 phase 查看节点行动和局部裁判。</p>;
  }
  const totalSpent = phase.actionPointBudgets.reduce((sum, item) => sum + item.spentAp, 0);
  const overBudget = phase.actionPointBudgets.filter((item) => item.remainingAp < 0).length;
  return (
    <div className={styles.detailStack}>
      <MetricGrid
        items={[
          ["phase", phase.phaseId],
          ["active nodes", String(phase.activeNodeIds.length)],
          ["AP spent", String(totalSpent)],
          ["over budget", String(overBudget)]
        ]}
      />
      <div className={styles.hardCondition}>
        <strong>Hard condition</strong>
        <span>{summary?.winCondition?.reason ?? trace?.finalHardCondition?.reason ?? "当前 phase 未触发最终硬胜负。"}</span>
      </div>
      {selectedSector ? (
        <div className={styles.sectorDetailCard}>
          <h3>
            {selectedSector.sector.displayNameZh} <span>{selectedSector.sector.sectorId}</span>
          </h3>
          <MetricGrid
            items={[
              ["control", selectedSector.state.controlAfter],
              ["attack", String(selectedSector.state.attackCount)],
              ["defense", String(selectedSector.state.defenseCount)],
              ["active", String(selectedSector.state.active)],
              ["engagement", String(selectedSector.state.engagementOccurred)],
              ["win check", String(selectedSector.state.winConditionCheck)]
            ]}
          />
          <p className={styles.auditNote}>nodes: {selectedSector.sector.nodeIds.join(", ")}</p>
        </div>
      ) : null}
      <div className={styles.twoColumn}>
        <div>
          <h3>agent actions</h3>
          <ul className={styles.compactList}>
            {phase.agentActions.map((action, index) => (
              <li key={`${action.agentId}-${index}`}>
                <strong>{shortAgent(action.agentId)}</strong> {action.actionType}
                {" -> "}
                {action.targetNodeId} / AP {action.apCost}
                <span>{action.businessIntent}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3>local verdicts</h3>
          <ul className={styles.compactList}>
            {phase.localVerdicts.map((verdict) => (
              <li key={`${phase.phaseId}-${verdict.nodeId}`}>
                <strong>{verdict.nodeId}</strong> {verdict.controlAfter}
                {verdict.engagementOccurred ? " / engagement" : ""}
                {verdict.triggersWinConditionCheck ? " / win-check" : ""}
                <span>{verdict.summary}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function LlmProcessPanel({ audit }: { audit: NodeLabLlmAudit | undefined }) {
  if (!audit) {
    return <p className={styles.emptyText}>暂无 LLM 调用进程。</p>;
  }
  const chains: ChainAudit[] = [
    {
      title: "agent action shadow",
      callsAttempted: audit.agentActionCallsAttempted,
      accepted: audit.agentActionDraftAcceptedCount,
      rejected: audit.agentActionDraftRejectedCount,
      fallbackCount: audit.agentActionFallbackCount,
      fallbackReasons: audit.agentActionFallbackReasons,
      ignoredFields: audit.agentActionIgnoredFields,
      contentLength: audit.agentActionContentLength,
      reasoningContentLength: audit.agentActionReasoningContentLength,
      jsonTruncated: audit.agentActionJsonTruncated,
      reasoningExhausted: audit.agentActionReasoningExhausted
    },
    {
      title: "local judge shadow",
      callsAttempted: audit.callsAttempted,
      accepted: audit.draftAcceptedCount,
      rejected: audit.draftRejectedCount,
      fallbackCount: audit.fallbackCount,
      fallbackReasons: audit.fallbackReasons,
      ignoredFields: audit.ignoredFields,
      contentLength: audit.contentLength,
      reasoningContentLength: audit.reasoningContentLength,
      jsonTruncated: audit.jsonTruncated,
      reasoningExhausted: audit.reasoningExhausted
    }
  ];
  return (
    <div className={styles.llmProcessGrid}>
      {chains.map((chain) => (
        <div key={chain.title} className={styles.llmCard}>
          <div className={styles.llmCardHeader}>
            <h3>{chain.title}</h3>
            <span>{audit.providerMode}</span>
          </div>
          <MetricGrid
            items={[
              ["calls", String(chain.callsAttempted)],
              ["accepted", String(chain.accepted)],
              ["rejected", String(chain.rejected)],
              ["fallback", String(chain.fallbackCount)],
              ["content", String(chain.contentLength)],
              ["reasoning", String(chain.reasoningContentLength)]
            ]}
          />
          <p className={styles.auditNote}>
            model: {audit.modelId ?? "--"} / jsonTruncated: {String(chain.jsonTruncated)} / reasoningExhausted: {String(chain.reasoningExhausted)}
          </p>
          <div className={styles.listColumns}>
            <ListBlock title="fallback reasons" items={chain.fallbackReasons} />
            <ListBlock title="ignored fields" items={chain.ignoredFields} />
          </div>
        </div>
      ))}
      <p className={styles.legacyNotice}>节点化 LLM shadow 不写旧 Phase18 llm_calls 表，调用记录来自 node trace。</p>
    </div>
  );
}

function RoundFactPanel({ trace }: { trace: NodeLabRoundTrace | undefined }) {
  if (!trace) {
    return <p className={styles.emptyText}>暂无回合事实。</p>;
  }
  return (
    <div className={styles.factGrid}>
      <MetricGrid
        items={[
          ["winner", trace.winnerTeamId ?? "--"],
          ["loser", trace.loserTeamId ?? "--"],
          ["win type", trace.roundWinType ?? "--"],
          ["AP", String(trace.totalApSpent)],
          ["fallback", String(trace.fallbackCount)],
          ["writesDb", String(trace.writesDb)],
          ["source", trace.source],
          ["legacy replace", String(trace.replacesLegacyRoundPath)]
        ]}
      />
      <div className={styles.hardCondition}>
        <strong>Hard win condition</strong>
        <span>{trace.finalHardCondition?.reason ?? "无 hard win condition 记录。"}</span>
      </div>
      <p className={styles.auditNote}>Trace artifact：{trace.nodeTraceArtifactId}</p>
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className={styles.listBlock}>
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className={styles.emptyText}>无</p>
      ) : (
        <ul>
          {items.slice(0, 10).map((item, index) => (
            <li key={`${item}-${index}`}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function normalizeControl(value: NodeControl | undefined): "attack" | "defense" | "contested" | "neutral" {
  return value === "attack" || value === "defense" || value === "contested" ? value : "neutral";
}

function polygonCentroid(polygon: Array<[number, number]>): { x: number; y: number } {
  if (polygon.length === 0) {
    return { x: 50, y: 50 };
  }
  const total = polygon.reduce(
    (sum, point) => ({
      x: sum.x + point[0],
      y: sum.y + point[1]
    }),
    { x: 0, y: 0 }
  );
  return {
    x: total.x / polygon.length,
    y: total.y / polygon.length
  };
}

function sectorControlClass(control: "attack" | "defense" | "contested" | "neutral"): string {
  switch (control) {
    case "attack":
      return styles.mapSectorAttack ?? "";
    case "defense":
      return styles.mapSectorDefense ?? "";
    case "contested":
      return styles.mapSectorContested ?? "";
    default:
      return styles.mapSectorNeutral ?? "";
  }
}

function controlClass(control: "attack" | "defense" | "contested" | "neutral"): string {
  switch (control) {
    case "attack":
      return styles.mapNodeAttack ?? "";
    case "defense":
      return styles.mapNodeDefense ?? "";
    case "contested":
      return styles.mapNodeContested ?? "";
    default:
      return styles.mapNodeNeutral ?? "";
  }
}

function hasBlockedReason(audit: NodeLabLlmAudit): boolean {
  return [...audit.fallbackReasons, ...audit.agentActionFallbackReasons].some((reason) => /EACCES|external_provider_blocked|connect .*:443/i.test(reason));
}

function shortTeam(value: string | undefined): string {
  if (!value) {
    return "--";
  }
  return value.replace("team_phase18_", "").replace("_7b", "");
}

function shortAgent(value: string): string {
  return value.replace("agent_phase18_player_", "").replace("falcon_7b_", "F/").replace("vitallmty_", "V/");
}
