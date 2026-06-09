"use client";

import type { HexMatchLabPlayerCard } from "../../server-hex-match-lab";

import styles from "./hex-match-lab.module.css";

interface HexMatchPlayerPanelProps {
  players: HexMatchLabPlayerCard[];
  selectedAgentId?: string | undefined;
  onSelectAgent: (agentId: string) => void;
}

export function HexMatchPlayerPanel(props: HexMatchPlayerPanelProps) {
  return (
    <section className={styles.sidePanel}>
      <div className={styles.sectionTitleRow}>
        <h2>选手状态</h2>
        <span>{props.players.length}/10</span>
      </div>
      <div className={styles.playerGrid}>
        {props.players.map((player) => {
          const selected = props.selectedAgentId === player.agentId;
          return (
            <button
              type="button"
              key={player.agentId}
              className={`${styles.playerCard} ${selected ? styles.playerCardActive : ""} ${player.lifeStatus === "dead" ? styles.playerDead : ""}`}
              onClick={() => props.onSelectAgent(player.agentId)}
            >
              <span className={styles.playerHeader}>
                <strong>{player.displayName ?? player.agentId}</strong>
                <em>{player.side}</em>
              </span>
              <span className={styles.playerMeta}>
                {player.lifeStatus} - AP {player.apSpent.toFixed(1)}/{player.apBudget.toFixed(1)} - 剩余 {player.apRemaining.toFixed(1)}
              </span>
              <span className={styles.playerMeta}>
                {player.currentRegionName ?? player.currentRegionId ?? "未分区"} - L{player.level ?? "?"} - {player.currentCellId}
              </span>
              <span className={styles.playerMeta}>
                {player.buyType ?? "buy?"} - {player.resourceTier ?? "resource?"}/{player.utilityTier ?? "utility?"}
                {player.dropReceived ? ` - drop +${player.dropReceived}` : ""}
              </span>
              <span className={styles.playerAction}>
                {player.actionType ?? "无 action"} {player.targetCellId ? `-> ${player.targetCellId}` : ""}
              </span>
              {player.carryingC4 ? <span className={styles.playerBadge}>C4</span> : null}
              {player.fallbackReason ? <span className={styles.playerWarn}>{player.fallbackReason}</span> : null}
              {player.lastSeenEnemyCount > 0 ? <span className={styles.playerIntel}>lastSeen {player.lastSeenEnemyCount}</span> : null}
            </button>
          );
        })}
        {props.players.length === 0 ? <p className={styles.emptyInline}>选择一个回合和 phase 后查看 10 个选手状态。</p> : null}
      </div>
    </section>
  );
}
