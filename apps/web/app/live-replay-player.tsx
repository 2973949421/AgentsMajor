"use client";

import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  ROUND_TRANSITION_MS,
  SPEED_OPTIONS,
  buildRoundFrame,
  findNextHighlightRoundIndex,
  formatClock,
  getEventText,
  getNextRoundIndex,
  getRoundDurationMs,
  getSpeedMultiplier,
  sortRounds,
  type LiveReplayData,
  type LiveReplayMap,
  type LiveReplayRound,
  type LiveRoundFrame,
  type PlaybackSpeed,
  type PlayerStatus,
  type ScorePair
} from "./live-replay-model";
import {
  buildBottomTickerViewModel,
  buildBroadcastHudViewModel,
  buildOverlayRosterViewModel,
  buildRoundEvidenceViewModel,
  buildReplayStageState,
  type OverlayRosterViewModel,
  type RoundEvidenceViewModel,
  type ReplayStageState
} from "./phase18-watch-view-model";
import {
  buildInitialRunMatchUiState,
  RunMatchControls,
  type ReplayGuardState,
  type RunMatchHistoryEntry,
  type RunMatchUiState,
  type WebRunProgress
} from "./run-match-controls";
import type { PublicWebRunnerPolicy } from "./server-web-runner-policy";
import styles from "./live-replay-player.module.css";

interface DockPosition {
  x: number;
  y: number;
}

interface DockDragState {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

interface LiveReplayPlayerProps {
  matchId: string;
  replay: LiveReplayData | null;
  runnerPolicy: PublicWebRunnerPolicy;
  initialRunProgress?: WebRunProgress | null;
  initialRunHistory?: RunMatchHistoryEntry[];
  initialReplayGuard?: ReplayGuardState;
}

export function LiveReplayPlayer({
  matchId,
  replay,
  runnerPolicy,
  initialRunProgress = null,
  initialRunHistory = [],
  initialReplayGuard = { hidden: false, message: "" }
}: LiveReplayPlayerProps) {
  const maps = useMemo(() => (replay ? [...replay.maps].sort((left, right) => left.order - right.order) : []), [replay]);
  const [selectedMapId, setSelectedMapId] = useState(maps[0]?.id ?? "");
  const [selectedRoundIndex, setSelectedRoundIndex] = useState(0);
  const [currentAtMs, setCurrentAtMs] = useState(0);
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [speed, setSpeed] = useState<PlaybackSpeed>("1x");
  const [revealedMapIds, setRevealedMapIds] = useState<string[]>([]);
  const [replayGuard, setReplayGuard] = useState<ReplayGuardState>(initialReplayGuard);
  const [runUiState, setRunUiState] = useState<RunMatchUiState>(() => buildInitialRunMatchUiState(initialRunProgress));
  const [opsDockCollapsed, setOpsDockCollapsed] = useState(() => !initialRunProgress);
  const [opsDockPosition, setOpsDockPosition] = useState<DockPosition | null>(null);
  const [opsDockDragState, setOpsDockDragState] = useState<DockDragState | null>(null);
  const opsDockRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!maps.some((mapReplay) => mapReplay.id === selectedMapId)) {
      setSelectedMapId(maps[0]?.id ?? "");
      setSelectedRoundIndex(0);
      setCurrentAtMs(0);
      setStatus("idle");
    }
  }, [maps, selectedMapId]);

  useEffect(() => {
    setRunUiState(buildInitialRunMatchUiState(initialRunProgress));
  }, [initialRunProgress?.runId, initialRunProgress?.status]);

  useEffect(() => {
    setReplayGuard(initialReplayGuard);
  }, [initialReplayGuard.hidden, initialReplayGuard.message]);

  const revealedMapSet = useMemo(() => new Set(revealedMapIds), [revealedMapIds]);
  const selectedMap = maps.find((mapReplay) => mapReplay.id === selectedMapId) ?? maps[0] ?? null;
  const rounds = useMemo(() => (selectedMap ? sortRounds(selectedMap.rounds) : []), [selectedMap]);
  const boundedRoundIndex = rounds.length > 0 ? Math.min(selectedRoundIndex, rounds.length - 1) : 0;
  const currentRound = rounds[boundedRoundIndex] ?? null;
  const roundDurationMs = currentRound ? getRoundDurationMs(currentRound) : 0;
  const frame = currentRound ? buildRoundFrame(currentRound, currentAtMs) : null;
  const nextMap = selectedMap ? maps.find((mapReplay) => mapReplay.order === selectedMap.order + 1) : undefined;
  const nextHighlightRoundIndex = selectedMap ? findNextHighlightRoundIndex(selectedMap, boundedRoundIndex) : null;
  const hasReplayFrame = Boolean(selectedMap && currentRound && frame);

  useEffect(() => {
    if (selectedRoundIndex !== boundedRoundIndex) {
      setSelectedRoundIndex(boundedRoundIndex);
    }
  }, [boundedRoundIndex, selectedRoundIndex]);

  useEffect(() => {
    const priorCompletedMapIds = maps.filter((mapReplay) => mapReplay.order < (selectedMap?.order ?? 1) && mapReplay.winnerTeamId).map((mapReplay) => mapReplay.id);
    if (priorCompletedMapIds.length === 0) {
      return;
    }

    setRevealedMapIds((current) => [...new Set([...current, ...priorCompletedMapIds])]);
  }, [maps, selectedMap?.order]);

  useEffect(() => {
    if (status !== "playing" || !currentRound || roundDurationMs <= 0) {
      return;
    }

    if (speed === "instant") {
      const timeoutId = window.setTimeout(() => setCurrentAtMs(roundDurationMs), 0);
      return () => window.clearTimeout(timeoutId);
    }

    let animationFrameId = 0;
    let lastFrameAt = performance.now();
    const multiplier = getSpeedMultiplier(speed);

    const tick = (now: number) => {
      const elapsedMs = now - lastFrameAt;
      lastFrameAt = now;
      setCurrentAtMs((value) => Math.min(roundDurationMs, value + elapsedMs * multiplier));
      animationFrameId = window.requestAnimationFrame(tick);
    };

    animationFrameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [currentRound, roundDurationMs, speed, status]);

  useEffect(() => {
    if (status !== "playing" || !selectedMap || !currentRound || roundDurationMs <= 0 || currentAtMs < roundDurationMs) {
      return;
    }

    const timeoutId = window.setTimeout(
      () => {
        const nextRoundIndex = getNextRoundIndex(selectedMap, boundedRoundIndex);
        if (nextRoundIndex === null) {
          setStatus("completed");
          setCurrentAtMs(roundDurationMs);
          return;
        }

        setSelectedRoundIndex(nextRoundIndex);
        setCurrentAtMs(0);
      },
      speed === "instant" ? 0 : ROUND_TRANSITION_MS
    );

    return () => window.clearTimeout(timeoutId);
  }, [boundedRoundIndex, currentAtMs, currentRound, roundDurationMs, selectedMap, speed, status]);

  useEffect(() => {
    if (status !== "completed" || !selectedMap?.id) {
      return;
    }

    setRevealedMapIds((current) => (current.includes(selectedMap.id) ? current : [...current, selectedMap.id]));
  }, [selectedMap?.id, status]);

  useEffect(() => {
    if (!replayGuard.hidden) {
      return;
    }

    setStatus("idle");
    setCurrentAtMs(0);
  }, [replayGuard.hidden]);

  useEffect(() => {
    if (runUiState.state === "running" || runUiState.state === "failed") {
      setOpsDockCollapsed(false);
    }
  }, [runUiState.state]);

  useEffect(() => {
    if (!opsDockDragState) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const maxX = Math.max(8, window.innerWidth - opsDockDragState.width - 8);
      const maxY = Math.max(8, window.innerHeight - opsDockDragState.height - 8);
      setOpsDockPosition({
        x: clamp(event.clientX - opsDockDragState.offsetX, 8, maxX),
        y: clamp(event.clientY - opsDockDragState.offsetY, 8, maxY)
      });
    };

    const handlePointerUp = () => {
      setOpsDockDragState(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [opsDockDragState]);

  const stageState = buildReplayStageState({
    hasReplay: hasReplayFrame,
    replayGuard,
    runUiState,
    selectedMapName: selectedMap?.mapName ?? null
  });
  const revealedMatchScore = replay ? getRevealedMatchScore(maps, revealedMapSet, replay) : { teamA: 0, teamB: 0 };
  const hudView = buildBroadcastHudViewModel({
    replay,
    selectedMap,
    currentRound,
    stageState,
    runUiState,
    bo3Score: revealedMatchScore
  });
  const teamAView = buildOverlayRosterViewModel({ replay, selectedMap, currentRound, frame, teamKey: "teamA" });
  const teamBView = buildOverlayRosterViewModel({ replay, selectedMap, currentRound, frame, teamKey: "teamB" });
  const bottomTickerView = buildBottomTickerViewModel({ replay, currentRound, frame, stageState });
  const evidenceView = buildRoundEvidenceViewModel({ replay, currentRound, frame });
  const roundProgressPercent = frame ? `${Math.round(frame.progress * 100)}%` : "0%";
  const timeLabel = frame ? `${formatClock(currentAtMs)} / ${formatClock(roundDurationMs)}` : "--:-- / --:--";

  return (
    <main className={styles.shell}>
      <section className={styles.broadcastShell}>
        <header className={styles.broadcastHud}>
          <div className={styles.hudTeamBlock}>
            <span className={styles.hudBanner}>{hudView.banner}</span>
            <strong>{hudView.teamAName}</strong>
          </div>
          <div className={styles.hudCenter}>
            <div className={styles.hudScoreLine}>
              <span>{hudView.bo3Label}</span>
              <strong>{hudView.bo3ScoreLabel}</strong>
              <small>{hudView.runStatusLabel}</small>
            </div>
            <div className={styles.hudMetaLine}>
              <span>{hudView.mapLabel}</span>
              <span>{hudView.roundLabel}</span>
              <span>{hudView.runModeLabel}</span>
            </div>
            <nav className={styles.mapPillRail} aria-label="地图选择">
              {maps.length > 0 ? (
                maps.map((mapReplay) => {
                  const isActive = selectedMap ? mapReplay.id === selectedMap.id : false;
                  const isRevealed = revealedMapSet.has(mapReplay.id);
                  const displayScore = getMapDisplayScore({
                    mapReplay,
                    isActive,
                    isRevealed,
                    frame
                  });
                  return (
                    <button
                      key={mapReplay.id}
                      className={`${styles.mapPill} ${isActive ? styles.mapPillActive : ""}`}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => handleMapSelect(mapReplay.id)}
                    >
                      <span>
                        M{mapReplay.order} / {mapReplay.mapName}
                      </span>
                      <strong>{displayScore ? `${displayScore.teamA}:${displayScore.teamB}` : "--:--"}</strong>
                    </button>
                  );
                })
              ) : (
                <span className={styles.mapPillPlaceholder}>当前还没有可浏览的地图回放。</span>
              )}
            </nav>
          </div>
          <div className={`${styles.hudTeamBlock} ${styles.hudTeamBlockRight}`}>
            <span className={styles.hudContext}>{hudView.contextLine}</span>
            <strong>{hudView.teamBName}</strong>
          </div>
        </header>

        <section className={styles.broadcastBody}>
          <section className={styles.stagePanel} aria-label="导播主舞台">
            <div className={styles.stageViewport}>
              {frame ? <TacticalMap frame={frame} /> : <StagePlaceholder />}
              {stageState.kind !== "replay_ready" ? <StageOverlay state={stageState} /> : <StageBadge state={stageState} />}
              <RosterRail roster={teamAView} side="left" />
              <RosterRail roster={teamBView} side="right" />

              <div className={styles.playbackDock} aria-label="回放控制">
                <div className={styles.playbackButtons}>
                  <button type="button" onClick={handlePlay} disabled={!currentRound || status === "playing"}>
                    {status === "completed" ? "重播本图" : status === "paused" ? "继续播放" : "开始播放"}
                  </button>
                  <button type="button" onClick={() => setStatus("paused")} disabled={status !== "playing"}>
                    暂停
                  </button>
                  <button type="button" onClick={handleResetRound} disabled={!currentRound}>
                    重置本回合
                  </button>
                  <button type="button" onClick={handleHighlightJump} disabled={!currentRound || nextHighlightRoundIndex === null}>
                    跳到高光
                  </button>
                </div>
                <div className={styles.playbackMeta}>
                  <span>{timeLabel}</span>
                  <span>{frame ? `地图比分 ${frame.currentScore.teamA}:${frame.currentScore.teamB}` : "地图比分待定"}</span>
                </div>
                <label className={styles.playbackSelect}>
                  倍速
                  <select value={speed} onChange={(event) => setSpeed(event.target.value as PlaybackSpeed)}>
                    {SPEED_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className={styles.progressTrack} role="progressbar" aria-label="当前回合回放进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={frame ? Math.round(frame.progress * 100) : 0}>
                <span style={{ width: roundProgressPercent }} />
              </div>

              {status === "completed" && selectedMap ? (
                <section className={styles.mapCompleteToast}>
                  <div>
                    <span>地图播放结束</span>
                    <strong>
                      {selectedMap.mapName} / {selectedMap.finalScore.teamA}:{selectedMap.finalScore.teamB}
                    </strong>
                  </div>
                  {nextMap ? (
                    <button type="button" onClick={() => handleMapSelect(nextMap.id)}>
                      进入 M{nextMap.order} / {nextMap.mapName}
                    </button>
                  ) : (
                    <span>当前 BO3 暂无下一张已提交地图。</span>
                  )}
                </section>
              ) : null}
              <section
                className={`${styles.opsDock} ${opsDockCollapsed ? styles.opsDockCollapsed : ""}`}
                aria-label="控制台"
                ref={opsDockRef}
                style={opsDockPosition ? { left: opsDockPosition.x, top: opsDockPosition.y, right: "auto", bottom: "auto", transform: "none" } : undefined}
              >
                <div className={styles.opsDockHandle} onPointerDown={handleOpsDockPointerDown}>
                  <span>拖动控制台</span>
                  <small>移动</small>
                </div>
                <button type="button" className={styles.opsDockToggle} onClick={() => setOpsDockCollapsed((value) => !value)} aria-expanded={!opsDockCollapsed}>
                  {opsDockCollapsed ? "展开" : "收起"}
                </button>
                <span className={styles.opsDockTabLabel}>控制台</span>
                <div className={styles.opsDockContent}>
                  <div className={styles.opsDockHeader}>
                    <p>控制台</p>
                    <h2>生成与验收</h2>
                    <span>可拖动，负责生成、进度和 LLM 明细，不进入主观赛层。</span>
                  </div>
                  <RunMatchControls
                    matchId={matchId}
                    runnerPolicy={runnerPolicy}
                    initialProgress={initialRunProgress}
                    initialRunHistory={initialRunHistory}
                    postMatchReviews={replay?.postMatchReviews ?? []}
                    onReplayGuardChange={setReplayGuard}
                    onUiStateChange={setRunUiState}
                    onResetCurrentMapView={handleResetCurrentMapView}
                    onResetMatchView={handleResetMatchView}
                  />
                </div>
              </section>
            </div>
          </section>
        </section>

        <section className={styles.bottomTicker}>
          {bottomTickerView.roundOutcome ? (
            <div className={styles.outcomeStrip} aria-label="回合胜法与战损密度">
              <OutcomeCard
                label="胜法"
                value={bottomTickerView.roundOutcome.winMethodLabel}
                detail={bottomTickerView.roundOutcome.winMethodDetail}
              />
              <OutcomeCard
                label="战损"
                value={bottomTickerView.roundOutcome.casualtyDensityLabel}
                detail={`${bottomTickerView.roundOutcome.tradeIntensityLabel} / ${bottomTickerView.roundOutcome.combatShapeLabel}`}
              />
              <OutcomeCard label="击杀" value={bottomTickerView.roundOutcome.killCountLabel} detail="只展示真实击杀数，不改事实" />
            </div>
          ) : null}
          <div className={styles.tickerSummaryGrid}>
            <TickerCard label={bottomTickerView.briefLabel} value={bottomTickerView.briefValue} />
            <TickerCard label={bottomTickerView.latestKillLabel} value={bottomTickerView.latestKillValue} />
            <TickerCard label={bottomTickerView.latestHighlightLabel} value={bottomTickerView.latestHighlightValue} />
          </div>
          <details className={styles.detailsTray}>
            <summary>展开本回合证据链与事件详情</summary>
            <div className={styles.detailsTrayBody}>
              <RoundEvidencePanel evidence={evidenceView} />

              <Panel title="时间线">
                <div className={styles.timelineList}>
                  {frame?.visibleEvents.length ? (
                    frame.visibleEvents
                      .slice(-8)
                      .reverse()
                      .map((event) => (
                        <div key={event.id} className={styles.timelineItem}>
                          <span>{formatClock(event.atMs)}</span>
                          <strong>{event.kind}</strong>
                          <small>{getEventText(event)}</small>
                        </div>
                      ))
                  ) : (
                    <span className={styles.muted}>当前切片还没有可见事件。</span>
                  )}
                </div>
              </Panel>

              <Panel title="高光与弹幕">
                <div className={styles.highlightStack}>
                  {frame?.highlightTags.length ? (
                    <div className={styles.highlightBox}>
                      <strong>{frame.highlightTags.join(" / ")}</strong>
                      <span>MVP：{frame.highlightMvpName ?? frame.highlightMvpAgentId ?? "待定"}</span>
                      {frame.replayCard ? (
                        <div className={styles.replayCard}>
                          <small>回放卡片</small>
                          <b>{frame.replayCard.title}</b>
                          <span>{frame.replayCard.summary}</span>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <span className={styles.muted}>当前还没有高光标签。</span>
                  )}
                  <div className={styles.barrageList}>
                    {frame?.barrageMessages.length ? (
                      frame.barrageMessages.map((message) => (
                        <div key={message.id} className={styles.barrageItem}>
                          <span>{formatClock(message.atMs)}</span>
                          <strong>{message.text}</strong>
                          <small>{message.intensity}</small>
                        </div>
                      ))
                    ) : (
                      <span className={styles.muted}>当前切片还没有弹幕信号。</span>
                    )}
                  </div>
                  {frame?.supportRate ? (
                    <div className={styles.supportRate}>
                      <div>
                        <span>{replay?.teams.teamA.shortName ?? "F7B"}</span>
                        <strong>{frame.supportRate.teamA}%</strong>
                      </div>
                      <meter min={0} max={100} value={frame.supportRate.teamA} />
                      <div>
                        <span>{replay?.teams.teamB.shortName ?? "VIT"}</span>
                        <strong>{frame.supportRate.teamB}%</strong>
                      </div>
                      <small>{frame.supportRate.label}</small>
                    </div>
                  ) : null}
                </div>
              </Panel>

              <Panel title="回合索引">
                <div className={styles.roundGrid}>
                  {rounds.length ? (
                    rounds.map((item, index) => (
                      <RoundButton
                        key={item.id}
                        active={index === boundedRoundIndex}
                        frame={frame}
                        index={index}
                        item={item}
                        mapRevealed={selectedMap ? revealedMapSet.has(selectedMap.id) : false}
                        replay={replay}
                        selectedRoundIndex={boundedRoundIndex}
                        status={status}
                        onClick={() => handleRoundJump(index)}
                      />
                    ))
                  ) : (
                    <span className={styles.muted}>当前地图还没有可跳转的局回放。</span>
                  )}
                </div>
              </Panel>
            </div>
          </details>
        </section>
      </section>
    </main>
  );

  function handleMapSelect(mapGameId: string) {
    setSelectedMapId(mapGameId);
    setSelectedRoundIndex(0);
    setCurrentAtMs(0);
    setStatus("idle");
  }

  function handlePlay() {
    if (!currentRound) {
      return;
    }
    if (status === "completed") {
      setSelectedRoundIndex(0);
      setCurrentAtMs(0);
    }
    setStatus("playing");
  }

  function handleResetRound() {
    setCurrentAtMs(0);
    setStatus("idle");
  }

  function handleResetCurrentMapView() {
    setSelectedRoundIndex(0);
    setCurrentAtMs(0);
    setStatus("idle");
  }

  function handleResetMatchView() {
    setSelectedMapId(maps[0]?.id ?? "");
    setSelectedRoundIndex(0);
    setCurrentAtMs(0);
    setStatus("idle");
  }

  function handleRoundJump(index: number) {
    setSelectedRoundIndex(index);
    setCurrentAtMs(0);
    setStatus("paused");
  }

  function handleHighlightJump() {
    if (nextHighlightRoundIndex === null) {
      return;
    }
    setSelectedRoundIndex(nextHighlightRoundIndex);
    setCurrentAtMs(0);
    setStatus("paused");
  }

  function handleOpsDockPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    const dockElement = opsDockRef.current;
    if (!dockElement) {
      return;
    }

    const dockRect = dockElement.getBoundingClientRect();
    event.preventDefault();
    setOpsDockPosition({
      x: clamp(dockRect.left, 8, Math.max(8, window.innerWidth - dockRect.width - 8)),
      y: clamp(dockRect.top, 8, Math.max(8, window.innerHeight - dockRect.height - 8))
    });
    setOpsDockDragState({
      offsetX: event.clientX - dockRect.left,
      offsetY: event.clientY - dockRect.top,
      width: dockRect.width,
      height: dockRect.height
    });
  }
}

function RoundEvidencePanel({ evidence }: { evidence: RoundEvidenceViewModel }) {
  return (
      <Panel className={styles.evidencePanel} title={`本回合证据链 / ${evidence.roundLabel}`}>
        <div className={styles.evidenceStack}>
          <div className={styles.evidenceSummary}>
            <span>{evidence.factChainLabel}</span>
            <small>用于判断真实 LLM 是否完成了队伍计划、选手行动、裁判判词到已提交回放结果的事实链。</small>
          </div>
          {evidence.roundOutcome ? (
            <div className={styles.outcomeStrip}>
              <OutcomeCard label="胜法" value={evidence.roundOutcome.winMethodLabel} detail={evidence.roundOutcome.winMethodDetail} />
              <OutcomeCard
                label="战损"
                value={evidence.roundOutcome.casualtyDensityLabel}
                detail={`${evidence.roundOutcome.tradeIntensityLabel} / ${evidence.roundOutcome.combatShapeLabel}`}
              />
              <OutcomeCard label="击杀" value={evidence.roundOutcome.killCountLabel} detail="只展示真实击杀数，不改事实" />
            </div>
          ) : null}
          {evidence.emptyMessage ? <span className={styles.muted}>{evidence.emptyMessage}</span> : null}

          {evidence.coachTimeoutCorrection ? (
            <section className={styles.evidenceSection}>
              <div className={styles.evidenceSectionHeader}>
                <span>战术暂停修正</span>
                <small>coach_timeout</small>
              </div>
              <article className={styles.teamPlanCard}>
                <div className={styles.teamPlanHeader}>
                  <strong>{evidence.coachTimeoutCorrection.teamName}</strong>
                  <span>
                    {evidence.coachTimeoutCorrection.confidenceLabel} / {evidence.coachTimeoutCorrection.expiresAfterRoundLabel}
                  </span>
                </div>
                <small>触发原因：{evidence.coachTimeoutCorrection.triggerReason}</small>
                <small>诊断问题：{evidence.coachTimeoutCorrection.diagnosedFailure}</small>
                <small>下一回合目标：{evidence.coachTimeoutCorrection.nextRoundObjective}</small>
                <small>本方必须守住：{evidence.coachTimeoutCorrection.ownCoreToHold}</small>
                <small>对手缺口：{evidence.coachTimeoutCorrection.opponentGapToHit}</small>
                <small>区域重排：{evidence.coachTimeoutCorrection.zonePriorityShift}</small>
                <p>{evidence.coachTimeoutCorrection.teamDirective}</p>
                <div className={styles.directiveList}>
                  {evidence.coachTimeoutCorrection.playerAdjustments.map((adjustment) => (
                    <div key={adjustment.agentId}>
                      <b>{adjustment.displayName}</b>
                      <span>{adjustment.adjustment}</span>
                    </div>
                  ))}
                </div>
                <details className={styles.evidenceRawDetails}>
                  <summary>查看原文</summary>
                  <div className={styles.evidenceRawBlock}>
                    <small>原文触发原因：{evidence.coachTimeoutCorrection.triggerReasonRaw}</small>
                    <small>原文诊断：{evidence.coachTimeoutCorrection.diagnosedFailureRaw}</small>
                    <small>原文目标：{evidence.coachTimeoutCorrection.nextRoundObjectiveRaw}</small>
                    <small>原文本方核心：{evidence.coachTimeoutCorrection.ownCoreToHoldRaw}</small>
                    <small>原文对手缺口：{evidence.coachTimeoutCorrection.opponentGapToHitRaw}</small>
                    <small>原文区域重排：{evidence.coachTimeoutCorrection.zonePriorityShiftRaw}</small>
                    <small>原文队伍口径：{evidence.coachTimeoutCorrection.teamDirectiveRaw}</small>
                    <div className={styles.directiveList}>
                      {evidence.coachTimeoutCorrection.playerAdjustments.map((adjustment) => (
                        <div key={`${adjustment.agentId}-raw`}>
                          <b>{adjustment.displayName}</b>
                          <span>{adjustment.adjustmentRaw}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </details>
              </article>
            </section>
          ) : null}

        <section className={styles.evidenceSection}>
          <div className={styles.evidenceSectionHeader}>
            <span>队伍计划</span>
            <small>{evidence.teamPlans.length ? "team_plan" : "旧回合未写入 team_plan"}</small>
          </div>
          {evidence.teamPlans.length ? (
            <div className={styles.teamPlanGrid}>
              {evidence.teamPlans.map((plan) => (
                <article key={plan.teamId} className={styles.teamPlanCard}>
                  <div className={styles.teamPlanHeader}>
                    <strong>{plan.teamName}</strong>
                    <span>
                      {plan.sideLabel} / {plan.confidenceLabel}
                    </span>
                  </div>
                  <p>{plan.primaryIntent}</p>
                  <small>区域：{plan.zonesLabel || "未指定"}</small>
                  <small>协同：{plan.coordinationSummary}</small>
                  <small>胜利条件：{plan.winCondition}</small>
                  <small>风险：{plan.risk}</small>
                  <div className={styles.directiveList}>
                    {plan.directives.map((directive) => (
                      <div key={directive.agentId}>
                        <b>{directive.displayName}</b>
                        <span>{directive.directive}</span>
                      </div>
                    ))}
                  </div>
                  <details className={styles.evidenceRawDetails}>
                    <summary>查看原文</summary>
                    <div className={styles.evidenceRawBlock}>
                      <small>原文意图：{plan.primaryIntentRaw}</small>
                      <small>原文协同：{plan.coordinationSummaryRaw}</small>
                      <small>原文胜利条件：{plan.winConditionRaw}</small>
                      <small>原文风险：{plan.riskRaw}</small>
                      <div className={styles.directiveList}>
                        {plan.directives.map((directive) => (
                          <div key={`${directive.agentId}-raw`}>
                            <b>{directive.displayName}</b>
                            <span>{directive.directiveRaw}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </details>
                </article>
              ))}
            </div>
          ) : (
            <span className={styles.muted}>当前已提交回合没有队伍计划事实；旧回合不会伪回填，新成功回合会写入这里。</span>
          )}
        </section>

        <section className={styles.evidenceSection}>
          <div className={styles.evidenceSectionHeader}>
            <span>10 名选手行动</span>
            <small>agent_action</small>
          </div>
          <div className={styles.actionEvidenceList}>
            {evidence.playerActions.map((action) => (
              <article key={action.agentId} className={styles.actionEvidenceRow}>
                <div>
                  <span>{action.teamName}</span>
                  <strong>{action.displayName}</strong>
                  <small>
                    {action.roleLabel} / {action.confidenceLabel}
                  </small>
                </div>
                <p>{action.action}</p>
                <div className={styles.evidenceRawBlock}>
                  {action.actionSections.slice(1).map((section) => (
                    <small key={section.label}>
                      {section.label}：{section.value}
                    </small>
                  ))}
                </div>
                <small>长期职责：{action.dutyLabel}</small>
                <small>本回合指令：{action.directiveLabel}</small>
                <details className={styles.evidenceRawDetails}>
                  <summary>查看原文</summary>
                  <div className={styles.evidenceRawBlock}>
                    {action.actionSections.map((section) => (
                      <small key={section.label}>
                        原文{section.label}：{section.rawValue}
                      </small>
                    ))}
                    <small>原始结构：{action.actionRaw}</small>
                    <small>原文指令：{action.directiveLabelRaw}</small>
                    <small>调试指纹：{action.fingerprintLabel}</small>
                  </div>
                </details>
              </article>
            ))}
          </div>
        </section>

        {evidence.judge ? (
          <section className={styles.evidenceSection}>
            <div className={styles.evidenceSectionHeader}>
              <span>裁判判词</span>
              <small>judge</small>
            </div>
            <article className={styles.judgeEvidenceCard}>
              <div className={styles.judgeEvidenceMeta}>
                <span>胜方：{evidence.judge.winnerLabel}</span>
                <span>败方：{evidence.judge.loserLabel}</span>
                <span>本局胜利方式：{evidence.judge.roundWinTypeLabel}</span>
                <span>幅度：{evidence.judge.marginLabel}</span>
                <span>MVP：{evidence.judge.mvpLabel}</span>
                <span>置信度：{evidence.judge.confidenceLabel}</span>
              </div>
              <p className={styles.judgeMethodDetail}>{evidence.judge.roundWinTypeDetail}</p>
              <div className={styles.judgeEvidenceMeta}>
                <span>进攻方胜利条件：{evidence.judge.attackWinConditionLabel}</span>
                <span>防守方胜利条件：{evidence.judge.defenseWinConditionLabel}</span>
              </div>
              {evidence.judge.inference ? (
                <div className={styles.judgeEvidenceMeta}>
                  <span>来源边界：{evidence.judge.inference.sourceLabel}</span>
                  <span>{evidence.judge.inference.boundary}</span>
                  <span>{evidence.judge.inference.csResolution}</span>
                </div>
              ) : null}
              <p>{evidence.judge.reason}</p>
              {evidence.judge.diagnostic ? (
                <div className={styles.judgeDiagnosticGrid}>
                  <div>
                    <span>当前子命题</span>
                    <strong>{evidence.judge.diagnostic.currentSubTheme}</strong>
                  </div>
                  <div>
                    <span>主攻落点</span>
                    <strong>{evidence.judge.diagnostic.mainAttackZoneLabel}</strong>
                  </div>
                  <div>
                    <span>守方命题焦点</span>
                    <strong>{evidence.judge.diagnostic.mainDefenseZoneLabel}</strong>
                  </div>
                  <div>
                    <span>攻守关系说明</span>
                    <strong>{evidence.judge.diagnostic.zoneRelationLabel}</strong>
                    <small>{evidence.judge.diagnostic.zoneRelationDetail}</small>
                  </div>
                  <div>
                    <span>攻方打中的缺口</span>
                    <strong>{evidence.judge.diagnostic.attackedOpportunityGap}</strong>
                  </div>
                  <div>
                    <span>守方核心成立点</span>
                    <strong>{evidence.judge.diagnostic.defendedCoreProposition}</strong>
                  </div>
                  <div>
                    <span>决定性证据</span>
                    <strong>{evidence.judge.diagnostic.decisiveEvidence}</strong>
                  </div>
                </div>
              ) : (
                <small className={styles.muted}>{evidence.judge.diagnosticMissingLabel}</small>
              )}
              <details className={styles.evidenceRawDetails}>
                <summary>查看原文</summary>
                <div className={styles.evidenceRawBlock}>
                  <small>{evidence.judge.reasonRaw}</small>
                  {evidence.judge.inference ? (
                    <>
                      <small>推断边界：{evidence.judge.inference.boundary}</small>
                      <small>CS 结算：{evidence.judge.inference.csResolution}</small>
                      <small>战斗叙事：{evidence.judge.inference.combatNarrative}</small>
                    </>
                  ) : null}
                  {evidence.judge.diagnostic ? (
                    <>
                      <small>原文子命题：{evidence.judge.diagnostic.currentSubThemeRaw}</small>
                      <small>原文机会缺口：{evidence.judge.diagnostic.attackedOpportunityGapRaw}</small>
                      <small>原文核心成立点：{evidence.judge.diagnostic.defendedCorePropositionRaw}</small>
                      <small>原文主攻区：{evidence.judge.diagnostic.mainAttackZoneId}</small>
                      <small>原文主守区：{evidence.judge.diagnostic.mainDefenseZoneId}</small>
                      <small>原文决定性证据：{evidence.judge.diagnostic.decisiveEvidenceRaw}</small>
                    </>
                  ) : null}
                </div>
              </details>
            </article>
          </section>
        ) : null}

        {evidence.combatResolution ? (
          <section className={styles.evidenceSection}>
            <div className={styles.evidenceSectionHeader}>
              <span>战斗结算映射</span>
              <small>{evidence.combatResolution.sourceLabel}</small>
            </div>
            <article className={styles.judgeEvidenceCard}>
              <div className={styles.judgeEvidenceMeta}>
                <span>胜利方式：{evidence.combatResolution.winTypeLabel}</span>
                <span>击杀：{evidence.combatResolution.killCountLabel}</span>
                <span>存活：{evidence.combatResolution.survivorLabel}</span>
                <span>残局：{evidence.combatResolution.clutchLabel}</span>
              </div>
              <p>{evidence.combatResolution.bombEventLabel}</p>
              <p>{evidence.combatResolution.openingDuelLabel}</p>
              <p>{evidence.combatResolution.mvpEvidence}</p>
            </article>
          </section>
        ) : null}
      </div>
    </Panel>
  );
}

function StagePlaceholder() {
  return <div className={`${styles.virtualMap} ${styles.virtualMapPlaceholder}`} aria-hidden="true" />;
}

function StageBadge({ state }: { state: ReplayStageState }) {
  return (
    <div className={styles.stageBadge}>
      <span>{state.badge}</span>
    </div>
  );
}

function StageOverlay({ state }: { state: ReplayStageState }) {
  return (
    <div className={styles.stageOverlay} data-kind={state.kind}>
      <span className={styles.stageOverlayBadge}>{state.badge}</span>
      <strong className={styles.stageOverlayTitle}>{state.title}</strong>
      <p className={styles.stageOverlayText}>{state.description}</p>
    </div>
  );
}

function RosterRail({ roster, side }: { roster: OverlayRosterViewModel; side: "left" | "right" }) {
  return (
    <aside className={`${styles.rosterRail} ${side === "right" ? styles.rosterRailRight : ""}`}>
      <div className={styles.rosterHeader}>
        <div>
          <span>{roster.shortName}</span>
          <strong>{roster.displayName}</strong>
          <small>{roster.sideLabel}</small>
          {roster.timeoutsLabel ? <small className={styles.rosterCoachLine}>{roster.timeoutsLabel}</small> : null}
          {roster.proposalLabel ? <small className={styles.rosterCoachLine}>{roster.proposalLabel}</small> : null}
          {roster.coachLabel ? <small className={styles.rosterCoachLine}>{roster.coachLabel}</small> : null}
        </div>
        <b>{roster.score}</b>
      </div>
      {roster.players.length ? (
        <div className={styles.rosterList}>
          {roster.players.map((player) => (
            <article key={player.id} className={styles.rosterRow} data-highlight={player.highlight}>
              <div className={styles.rosterRowTop}>
                <strong>{player.displayName}</strong>
                <span>{player.roleLabel}</span>
              </div>
              <div className={styles.rosterRowCore}>
                <span>
                  <b>累计 K/D/A</b>
                  <strong>{player.kdaLabel}</strong>
                </span>
                <span>
                  <b>本局 K</b>
                  <strong>{player.roundKillLabel}</strong>
                </span>
              </div>
              <div className={styles.rosterRowEconomy}>
                <span>
                  <b>HP</b>
                  <strong>{player.hpLabel}</strong>
                </span>
                <span>
                  <b>总经济</b>
                  <strong>{player.totalEconomyLabel}</strong>
                </span>
                <span>
                  <b>本回合消费</b>
                  <strong>{player.roundSpendLabel}</strong>
                </span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className={styles.rosterEmpty}>{roster.emptyMessage ?? "待回放"}</div>
      )}
    </aside>
  );
}

function TickerCard({ label, value }: { label: string; value: string }) {
  return (
    <article className={styles.tickerCard}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function OutcomeCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className={styles.outcomeCard}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function TacticalMap({ frame }: { frame: LiveRoundFrame }) {
  return (
    <div className={styles.virtualMap}>
      <svg className={styles.tacticalLines} viewBox={`0 0 ${frame.tacticalMap.canvas.width} ${frame.tacticalMap.canvas.height}`} aria-hidden="true" preserveAspectRatio="none">
        {frame.tacticalMap.connections.map((connection) => (
          <line
            key={`${connection.fromZoneId}-${connection.toZoneId}`}
            x1={connection.from.x}
            y1={connection.from.y}
            x2={connection.to.x}
            y2={connection.to.y}
            className={`${styles.tacticalLine} ${connection.active ? styles.tacticalLineActive : ""}`}
          />
        ))}
      </svg>
      {frame.tacticalMap.zones.map((zone) => (
        <div
          key={zone.id}
          className={`${styles.tacticalZone} ${zone.active ? styles.tacticalZoneActive : ""} ${zone.weak ? styles.tacticalZoneWeak : ""}`}
          style={{
            left: `${(zone.position.x / frame.tacticalMap.canvas.width) * 100}%`,
            top: `${(zone.position.y / frame.tacticalMap.canvas.height) * 100}%`
          }}
        >
          <span>{zone.displayName}</span>
          <strong>{zone.eventType ?? zone.role}</strong>
          <small>{zone.active ? zone.impact ?? "当前区域已被真实事件激活。" : "等待本回合事件推进到这里。"}</small>
          {zone.badge ? <b>{zone.badge}</b> : null}
          {zone.weak ? <em>回退点位：{zone.requestedZoneId}</em> : null}
        </div>
      ))}
    </div>
  );
}

function Panel({ title, children, className = "" }: { title: string; children: ReactNode; className?: string | undefined }) {
  return (
    <article className={`${styles.panel} ${className}`}>
      <h2>{title}</h2>
      {children}
    </article>
  );
}

function RoundButton({
  active,
  frame,
  index,
  item,
  mapRevealed,
  replay,
  selectedRoundIndex,
  status,
  onClick
}: {
  active: boolean;
  frame: LiveRoundFrame | null;
  index: number;
  item: LiveReplayRound;
  mapRevealed: boolean;
  replay: LiveReplayData | null;
  selectedRoundIndex: number;
  status: PlayerStatus;
  onClick: () => void;
}) {
  const display = getRoundButtonDisplay({
    frame,
    index,
    item,
    mapRevealed,
    replay,
    selectedRoundIndex,
    status
  });

  return (
    <button className={`${styles.roundButton} ${active ? styles.roundButtonActive : ""}`} type="button" aria-current={active ? "step" : undefined} onClick={onClick}>
      <span>R{String(item.roundNumber).padStart(2, "0")}</span>
      <strong>{display.scoreLabel}</strong>
      <small>{display.metaLabel}</small>
    </button>
  );
}

function getRoundButtonDisplay(input: {
  frame: LiveRoundFrame | null;
  index: number;
  item: LiveReplayRound;
  mapRevealed: boolean;
  replay: LiveReplayData | null;
  selectedRoundIndex: number;
  status: PlayerStatus;
}): { scoreLabel: string; metaLabel: string } {
  const isPastRound = input.index < input.selectedRoundIndex;
  const isCurrentRound = input.index === input.selectedRoundIndex;
  const canShowFinal = input.mapRevealed || input.status === "completed" || isPastRound;

  if (canShowFinal) {
    return {
      scoreLabel: formatScore(input.item.roundReport.scoreAfterRound),
      metaLabel: getTeamName(input.replay, input.item.roundReport.winnerTeamId)
    };
  }

  if (isCurrentRound && input.frame) {
    return {
      scoreLabel: formatScore(input.frame.currentScore),
      metaLabel: input.frame.resultWinnerTeamId ? getTeamName(input.replay, input.frame.resultWinnerTeamId) : "实时"
    };
  }

  return {
    scoreLabel: "--",
    metaLabel: "待生成"
  };
}

function getMapDisplayScore(input: { mapReplay: LiveReplayMap; isActive: boolean; isRevealed: boolean; frame: LiveRoundFrame | null }): ScorePair | null {
  if (input.isActive && input.frame) {
    return input.frame.currentScore;
  }
  if (input.isRevealed) {
    return input.mapReplay.finalScore;
  }
  return null;
}

function getRevealedMatchScore(maps: LiveReplayMap[], revealedMapSet: Set<string>, replay: LiveReplayData): ScorePair {
  return maps.reduce<ScorePair>(
    (score, mapReplay) => {
      if (!revealedMapSet.has(mapReplay.id)) {
        return score;
      }
      if (mapReplay.winnerTeamId === replay.teams.teamA.id) {
        return { teamA: score.teamA + 1, teamB: score.teamB };
      }
      if (mapReplay.winnerTeamId === replay.teams.teamB.id) {
        return { teamA: score.teamA, teamB: score.teamB + 1 };
      }
      return score;
    },
    { teamA: 0, teamB: 0 }
  );
}

function formatScore(score: ScorePair): string {
  return `${score.teamA}-${score.teamB}`;
}

function getTeamName(replay: LiveReplayData | null, teamId: string | undefined): string {
  if (!teamId) {
    return "待定";
  }
  if (teamId === replay?.teams.teamA.id) {
    return replay.teams.teamA.shortName;
  }
  if (teamId === replay?.teams.teamB.id) {
    return replay.teams.teamB.shortName;
  }
  return teamId;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
