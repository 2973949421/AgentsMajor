"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

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
import styles from "./live-replay-player.module.css";

interface LiveReplayPlayerProps {
  replay: LiveReplayData;
}

export function LiveReplayPlayer({ replay }: LiveReplayPlayerProps) {
  const maps = useMemo(() => [...replay.maps].sort((left, right) => left.order - right.order), [replay.maps]);
  const [selectedMapId, setSelectedMapId] = useState(maps[0]?.id ?? "");
  const [selectedRoundIndex, setSelectedRoundIndex] = useState(0);
  const [currentAtMs, setCurrentAtMs] = useState(0);
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [speed, setSpeed] = useState<PlaybackSpeed>("1x");
  const [revealedMapIds, setRevealedMapIds] = useState<string[]>([]);

  const revealedMapSet = useMemo(() => new Set(revealedMapIds), [revealedMapIds]);
  const selectedMap = maps.find((mapReplay) => mapReplay.id === selectedMapId) ?? maps[0] ?? null;
  const rounds = useMemo(() => (selectedMap ? sortRounds(selectedMap.rounds) : []), [selectedMap]);
  const boundedRoundIndex = rounds.length > 0 ? Math.min(selectedRoundIndex, rounds.length - 1) : 0;
  const currentRound = rounds[boundedRoundIndex];
  const roundDurationMs = currentRound ? getRoundDurationMs(currentRound) : 0;
  const frame = currentRound ? buildRoundFrame(currentRound, currentAtMs) : null;
  const nextMap = selectedMap ? maps.find((mapReplay) => mapReplay.order === selectedMap.order + 1) : undefined;
  const selectedMapIdForReveal = selectedMap?.id;

  useEffect(() => {
    if (selectedRoundIndex !== boundedRoundIndex) {
      setSelectedRoundIndex(boundedRoundIndex);
    }
  }, [boundedRoundIndex, selectedRoundIndex]);

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
    if (status !== "completed" || !selectedMapIdForReveal) {
      return;
    }

    setRevealedMapIds((current) => (current.includes(selectedMapIdForReveal) ? current : [...current, selectedMapIdForReveal]));
  }, [selectedMapIdForReveal, status]);

  if (!selectedMap || !currentRound || !frame) {
    return (
      <main className={styles.shell}>
        <section className={styles.emptyState}>
          <p>Agent Major Phase 1.4</p>
          <h1>没有可播放地图</h1>
          <span>当前 match replay 没有 completed map，请先运行 `pnpm phase13:match`。</span>
        </section>
      </main>
    );
  }

  const selectedMapRevealed = revealedMapSet.has(selectedMap.id);
  const revealedMatchScore = getRevealedMatchScore(maps, revealedMapSet, replay);
  const matchWinnerName = getRevealedMatchWinnerName(revealedMatchScore, replay);
  const roundWinnerName = frame.resultWinnerTeamId ? getTeamName(replay, frame.resultWinnerTeamId) : "待揭示";
  const roundProgressPercent = `${Math.round(frame.progress * 100)}%`;
  const nextHighlightRoundIndex = findNextHighlightRoundIndex(selectedMap, boundedRoundIndex);

  const handleMapSelect = (mapGameId: string) => {
    setSelectedMapId(mapGameId);
    setSelectedRoundIndex(0);
    setCurrentAtMs(0);
    setStatus("idle");
  };

  const handlePlay = () => {
    if (status === "completed") {
      setSelectedRoundIndex(0);
      setCurrentAtMs(0);
    }
    setStatus("playing");
  };

  const handleReset = () => {
    setSelectedRoundIndex(0);
    setCurrentAtMs(0);
    setStatus("idle");
  };

  const handleRoundJump = (index: number) => {
    setSelectedRoundIndex(index);
    setCurrentAtMs(0);
    setStatus("paused");
  };

  const handleHighlightJump = () => {
    if (nextHighlightRoundIndex === null) {
      return;
    }

    setSelectedRoundIndex(nextHighlightRoundIndex);
    setCurrentAtMs(0);
    setStatus("paused");
  };

  return (
    <main className={styles.shell}>
      <section className={styles.hero}>
        <div>
          <p className={styles.kicker}>Agent Major Phase 1.4 / Viewer Mode</p>
          <h1>
            {replay.teams.teamA.displayName} vs {replay.teams.teamB.displayName}
          </h1>
          <span className={styles.subtitle}>
            Simulation First, Broadcast Second. 当前页面只消费播放 ViewModel，不重新模拟比赛，也不读取 RawOutput。
          </span>
        </div>
        <aside className={styles.matchPlate}>
          <span>BO3</span>
          <strong>
            {revealedMatchScore.teamA}-{revealedMatchScore.teamB}
          </strong>
          <small>胜者：{matchWinnerName}</small>
        </aside>
      </section>

      <section className={styles.mapTabs} aria-label="地图切换">
        {maps.map((mapReplay) => {
          const isActive = mapReplay.id === selectedMap.id;
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
              className={`${styles.mapTab} ${isActive ? styles.mapTabActive : ""}`}
              type="button"
              aria-pressed={isActive}
              onClick={() => handleMapSelect(mapReplay.id)}
            >
              <span>
                M{mapReplay.order} / {mapReplay.mapName}
              </span>
              <strong>{displayScore ? `${displayScore.teamA}:${displayScore.teamB}` : "--:--"}</strong>
              <small>{getMapStatusLabel(replay, mapReplay, isActive, isRevealed)}</small>
            </button>
          );
        })}
      </section>

      <section className={styles.scoreboard}>
        <div>
          <span>{selectedMap.mapName}</span>
          <strong>
            {frame.currentScore.teamA}:{frame.currentScore.teamB}
          </strong>
          <small>
            R{currentRound.roundNumber} / {formatClock(currentAtMs)} / {formatClock(roundDurationMs)}
          </small>
        </div>
        <div className={styles.scoreMeta}>
          <span>状态：{status}</span>
          <span>倍速：{speed}</span>
          <span>当前回合胜者：{roundWinnerName}</span>
          <span>时间线：{currentRound.timelineEvents.length}</span>
        </div>
      </section>

      <section className={styles.controlBar} aria-label="播放控制">
        <button type="button" onClick={handlePlay} disabled={status === "playing"}>
          {status === "completed" ? "重播本图" : status === "paused" ? "继续" : "播放"}
        </button>
        <button type="button" onClick={() => setStatus("paused")} disabled={status !== "playing"}>
          暂停
        </button>
        <button type="button" onClick={handleReset}>
          重置本图
        </button>
        <button type="button" onClick={handleHighlightJump} disabled={nextHighlightRoundIndex === null}>
          跳到高光
        </button>
        <label>
          倍速
          <select value={speed} onChange={(event) => setSpeed(event.target.value as PlaybackSpeed)}>
            {SPEED_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section
        className={styles.progressTrack}
        role="progressbar"
        aria-label="当前回合播放进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(frame.progress * 100)}
      >
        <span style={{ width: roundProgressPercent }} />
      </section>

      <section className={styles.liveGrid}>
        <article className={styles.stageCard}>
          <div className={styles.stageHeader}>
            <div>
              <span>当前回合</span>
              <strong>Round {currentRound.roundNumber}</strong>
            </div>
            <small>{currentRound.roundReport.summary}</small>
          </div>

          <div className={styles.virtualMap}>
            {frame.zones.length > 0 ? (
              frame.zones.map((zone) => (
                <div key={`${zone.id}-${zone.type}`} className={`${styles.zone} ${zone.active ? styles.zoneActive : ""}`}>
                  <span>{zone.name}</span>
                  <strong>{zone.type}</strong>
                  <small>{zone.active ? zone.impact : "等待时间线触发"}</small>
                </div>
              ))
            ) : (
              <div className={styles.zone}>
                <span>Virtual Map</span>
                <strong>等待控制区事件</strong>
                <small>后续 P2.2 会替换为完整 2D 战术地图。</small>
              </div>
            )}
          </div>
        </article>

        <aside className={styles.sideStack}>
          <Panel title="主解说">
            <p className={styles.casterLine}>{frame.casterLine ?? "解说席等待时间线信号。"}</p>
          </Panel>

          <Panel title="Kill Feed">
            <div className={styles.feedList}>
              {frame.killFeed.length > 0 ? (
                frame.killFeed.map((entry) => (
                  <div key={entry.id} className={styles.feedItem}>
                    <span>{formatClock(entry.atMs)}</span>
                    <strong>{entry.text}</strong>
                    <small>{entry.zoneId ?? "unknown zone"}</small>
                  </div>
                ))
              ) : (
                <span className={styles.muted}>等待击杀播报。</span>
              )}
            </div>
          </Panel>

          <Panel title="高光揭示">
            {frame.highlightTags.length > 0 ? (
              <div className={styles.highlightBox}>
                <strong>{frame.highlightTags.join(" / ")}</strong>
                <span>MVP 候选：{frame.highlightMvpAgentId ?? "pending"}</span>
              </div>
            ) : (
              <span className={styles.muted}>高光会在回合后段揭示。</span>
            )}
          </Panel>
        </aside>
      </section>

      <section className={styles.detailGrid}>
        <Panel title="经济面板">
          {frame.economyVisible ? (
            <div className={styles.economyGrid}>
              {frame.economyRows.map((row) => (
                <div key={row.agentId} className={styles.economyRow}>
                  <span>{row.agentId}</span>
                  <strong>{row.afterTokenBank}</strong>
                  <small>
                    {row.buyType} / {row.spent} spent / LS {row.lossStreak}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <span className={styles.muted}>经济面板会在 10 秒附近展开。</span>
          )}
        </Panel>

        <Panel title="事件流">
          <div className={styles.timelineList}>
            {frame.visibleEvents
              .slice(-8)
              .reverse()
              .map((event) => (
                <div key={event.id} className={styles.timelineItem}>
                  <span>{formatClock(event.atMs)}</span>
                  <strong>{event.kind}</strong>
                  <small>{getEventText(event)}</small>
                </div>
              ))}
          </div>
        </Panel>

        <Panel title="回合跳转">
          <div className={styles.roundGrid}>
            {rounds.map((item, index) => (
              <RoundButton
                key={item.id}
                active={index === boundedRoundIndex}
                frame={frame}
                index={index}
                item={item}
                mapRevealed={selectedMapRevealed}
                replay={replay}
                selectedRoundIndex={boundedRoundIndex}
                status={status}
                onClick={() => handleRoundJump(index)}
              />
            ))}
          </div>
        </Panel>
      </section>

      {status === "completed" ? (
        <section className={styles.mapComplete}>
          <div>
            <span>地图播放结束</span>
            <strong>
              {selectedMap.mapName} / {selectedMap.finalScore.teamA}:{selectedMap.finalScore.teamB}
            </strong>
          </div>
          {nextMap ? (
            <button type="button" onClick={() => handleMapSelect(nextMap.id)}>
              确认进入 M{nextMap.order} / {nextMap.mapName}
            </button>
          ) : (
            <span>BO3 已无下一张 completed map。</span>
          )}
        </section>
      ) : null}
    </main>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className={styles.panel}>
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
  frame: LiveRoundFrame;
  index: number;
  item: LiveReplayRound;
  mapRevealed: boolean;
  replay: LiveReplayData;
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
    <button
      className={`${styles.roundButton} ${active ? styles.roundButtonActive : ""}`}
      type="button"
      aria-current={active ? "step" : undefined}
      onClick={onClick}
    >
      <span>R{String(item.roundNumber).padStart(2, "0")}</span>
      <strong>{display.scoreLabel}</strong>
      <small>{display.metaLabel}</small>
    </button>
  );
}

function getRoundButtonDisplay(input: {
  frame: LiveRoundFrame;
  index: number;
  item: LiveReplayRound;
  mapRevealed: boolean;
  replay: LiveReplayData;
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

  if (isCurrentRound) {
    return {
      scoreLabel: formatScore(input.frame.currentScore),
      metaLabel: input.frame.resultWinnerTeamId ? getTeamName(input.replay, input.frame.resultWinnerTeamId) : "LIVE"
    };
  }

  return {
    scoreLabel: "--",
    metaLabel: "待播放"
  };
}

function getMapDisplayScore(input: {
  mapReplay: LiveReplayMap;
  isActive: boolean;
  isRevealed: boolean;
  frame: LiveRoundFrame;
}): ScorePair | null {
  if (input.isActive) {
    return input.frame.currentScore;
  }
  if (input.isRevealed) {
    return input.mapReplay.finalScore;
  }
  return null;
}

function getMapStatusLabel(replay: LiveReplayData, mapReplay: LiveReplayMap, isActive: boolean, isRevealed: boolean): string {
  if (isRevealed) {
    return `${getTeamName(replay, mapReplay.winnerTeamId)} win`;
  }
  return isActive ? "播放中 / 待结算" : "待播放";
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

function getRevealedMatchWinnerName(score: ScorePair, replay: LiveReplayData): string {
  if (score.teamA >= 2) {
    return replay.teams.teamA.shortName;
  }
  if (score.teamB >= 2) {
    return replay.teams.teamB.shortName;
  }
  return "待揭示";
}

function formatScore(score: ScorePair): string {
  return `${score.teamA}-${score.teamB}`;
}

function getTeamName(replay: LiveReplayData, teamId: string | undefined): string {
  if (!teamId) {
    return "pending";
  }
  if (teamId === replay.teams.teamA.id) {
    return replay.teams.teamA.shortName;
  }
  if (teamId === replay.teams.teamB.id) {
    return replay.teams.teamB.shortName;
  }
  return teamId;
}
