"use client";

import type {
  HexMatchLabPhaseSummary,
  HexMatchLabRoundSummary
} from "../../server-hex-match-lab";

import styles from "./hex-match-lab.module.css";

interface HexMatchTimelineProps {
  rounds: HexMatchLabRoundSummary[];
  phases: HexMatchLabPhaseSummary[];
  selectedRoundArtifactId?: string | undefined;
  selectedPhaseIndex: number;
  roundProgressPct: number;
  phaseProgressPct: number;
  playbackRunning: boolean;
  onSelectRound: (round: HexMatchLabRoundSummary) => void;
  onSelectPhase: (phaseIndex: number) => void;
  onPreviousRound: () => void;
  onNextRound: () => void;
  onPreviousPhase: () => void;
  onNextPhase: () => void;
  onTogglePlayback: () => void;
}

export function HexMatchTimeline(props: HexMatchTimelineProps) {
  return (
    <section className={styles.timelinePanel}>
      <div className={styles.playbackHeader}>
        <div>
          <span>Trace playback</span>
          <h2>Round / Phase 回放控制</h2>
          <p>这里播放已经提交的 hex trace，不重新执行 LLM，也不重新计算 winner。</p>
        </div>
        <div className={styles.playbackControls}>
          <button type="button" onClick={props.onPreviousRound}>上一回合</button>
          <button type="button" onClick={props.onNextRound}>下一回合</button>
          <button type="button" onClick={props.onPreviousPhase}>上一 phase</button>
          <button type="button" onClick={props.onNextPhase}>下一 phase</button>
          <button type="button" onClick={props.onTogglePlayback}>
            {props.playbackRunning ? "暂停播放" : "播放 trace"}
          </button>
        </div>
      </div>

      <ProgressLine label="地图回合进度" value={props.roundProgressPct} />
      <ProgressLine label="当前回合阶段进度" value={props.phaseProgressPct} />

      <div className={styles.timelineRows}>
        <div className={styles.timelineBlock}>
          <div className={styles.sectionTitleRow}>
            <h3>Round 时间线</h3>
            <span>{props.rounds.length} rounds</span>
          </div>
          <div className={styles.roundRail}>
            {props.rounds.map((round) => {
              const active = round.hexTraceArtifactId === props.selectedRoundArtifactId;
              return (
                <button
                  type="button"
                  key={round.roundId}
                  className={active ? styles.roundActive : styles.roundCard}
                  onClick={() => props.onSelectRound(round)}
                >
                  <span>R{round.roundNumber}</span>
                  <strong>{round.roundWinType ?? "unknown"}</strong>
                  <small>{round.winnerTeamId ?? "no winner"}</small>
                  <small>fallback {round.fallbackCount} / combat {round.combatResolutionCount}</small>
                </button>
              );
            })}
            {props.rounds.length === 0 ? <p className={styles.emptyInline}>暂无已提交 Hex 回合。</p> : null}
          </div>
        </div>

        <div className={styles.timelineBlock}>
          <div className={styles.sectionTitleRow}>
            <h3>Phase 回放条</h3>
            <span>{props.phases.length} phases</span>
          </div>
          <div className={styles.phaseRail}>
            {props.phases.map((phase) => {
              const active = phase.phaseIndex === props.selectedPhaseIndex;
              return (
                <button
                  type="button"
                  key={`${phase.phaseIndex}_${phase.phaseId}`}
                  className={active ? styles.phaseActive : styles.phaseCard}
                  onClick={() => props.onSelectPhase(phase.phaseIndex)}
                >
                  <span>{phase.phaseIndex + 1}</span>
                  <strong>{phase.phaseId}</strong>
                  <small>A{phase.aliveAttackCount}/D{phase.aliveDefenseCount} - calls {phase.callsAttempted}</small>
                  <small>accepted {phase.acceptedActionCount} / rejected {phase.rejectedDraftCount} / fallback {phase.fallbackActionCount}</small>
                </button>
              );
            })}
            {props.phases.length === 0 ? <p className={styles.emptyInline}>选择 round 后查看 phase。</p> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function ProgressLine({ label, value }: { label: string; value: number }) {
  const width = `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;
  return (
    <div className={styles.progressLine}>
      <span>{label}</span>
      <div className={styles.progressTrack}>
        <div className={styles.progressFill} style={{ width }} />
      </div>
      <strong>{width}</strong>
    </div>
  );
}
