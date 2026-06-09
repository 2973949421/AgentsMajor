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
  onSelectRound: (round: HexMatchLabRoundSummary) => void;
  onSelectPhase: (phaseIndex: number) => void;
}

export function HexMatchTimeline(props: HexMatchTimelineProps) {
  return (
    <section className={styles.timelinePanel}>
      <div className={styles.timelineBlock}>
        <div className={styles.sectionTitleRow}>
          <h2>Round 进度条</h2>
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
              </button>
            );
          })}
          {props.rounds.length === 0 ? <p className={styles.emptyInline}>暂无已提交 Hex 回合。</p> : null}
        </div>
      </div>
      <div className={styles.timelineBlock}>
        <div className={styles.sectionTitleRow}>
          <h2>Phase 回放条</h2>
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
                <small>
                  A{phase.aliveAttackCount}/D{phase.aliveDefenseCount} - combat {phase.combatResolutionCount}
                </small>
              </button>
            );
          })}
          {props.phases.length === 0 ? <p className={styles.emptyInline}>选择一个 round 后查看 phase。</p> : null}
        </div>
      </div>
    </section>
  );
}
