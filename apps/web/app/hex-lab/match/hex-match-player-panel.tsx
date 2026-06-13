"use client";

import type { HexMatchLabPlayerCard } from "../../server-hex-match-lab";

import styles from "./hex-match-lab.module.css";

interface HexMatchPlayerPanelProps {
  title: string;
  side: "attack" | "defense";
  players: HexMatchLabPlayerCard[];
  selectedAgentId?: string | undefined;
  onSelectAgent: (agentId: string) => void;
}

export function HexMatchPlayerPanel(props: HexMatchPlayerPanelProps) {
  const orderedPlayers = props.players
    .filter((player) => player.side === props.side)
    .sort((left, right) => (left.displayName ?? left.agentId).localeCompare(right.displayName ?? right.agentId));

  return (
    <section className={`${styles.teamColumn} ${props.side === "attack" ? styles.attackColumn : styles.defenseColumn}`}>
      <div className={styles.teamHeader}>
        <div>
          <span>{props.side === "attack" ? "T / ATTACK" : "CT / DEFENSE"}</span>
          <h2>{props.title}</h2>
        </div>
        <strong>{orderedPlayers.length}/5</strong>
      </div>

      <div className={styles.playerStack}>
        {orderedPlayers.map((player) => {
          const selected = props.selectedAgentId === player.agentId;
          return (
            <button
              type="button"
              key={player.agentId}
              className={`${styles.playerCard} ${selected ? styles.playerCardActive : ""} ${statusClass(player.lifeStatus)}`}
              onClick={() => props.onSelectAgent(player.agentId)}
            >
              <span className={styles.playerHeader}>
                <strong>
                  {player.displayName ?? shortId(player.agentId)}
                  {player.roundKills > 0 ? <span className={styles.roundKillStars}>{killStars(player.roundKills)}</span> : null}
                </strong>
                <span className={styles.playerHeaderBadges}>
                  <b>{player.roleLabel}</b>
                  <em className={statusTextClass(player.lifeStatus)}>{statusLabel(player.lifeStatus)}</em>
                </span>
              </span>
              <span className={styles.playerLocation}>
                {player.currentRegionName ?? player.currentRegionId ?? "未分区"}
                {player.currentPointNames.length > 0 ? ` / ${player.currentPointNames.slice(0, 2).join(", ")}` : ""}
              </span>
              <span className={styles.playerGrid}>
                <b>KDA</b><span className={styles.playerKdaValue}>{player.kda}</span>
                <b>经济</b><span>{moneyLabel(player.economyBalance)} /（{player.spend ?? 0}）</span>
                <b>AP</b><span>{player.apSpent.toFixed(1)} / {player.apBudget.toFixed(1)}，余 {player.apRemaining.toFixed(1)}</span>
                <b>位置</b><span>L{player.level ?? "?"} / {player.currentCellId}</span>
                <b>ECO</b><span>{player.buyType ?? "?"} / {player.resourceTier ?? "?"}</span>
              </span>
              <span className={styles.playerAction}>
                {player.actionType ?? "无 action"}
                {player.targetCellId ? ` -> ${player.targetCellId}` : ""}
              </span>
              <span className={styles.playerBadges}>
                {player.carryingC4 ? <b>C4</b> : null}
                {player.dropReceived ? <b>drop +{player.dropReceived}</b> : null}
                {player.lastSeenEnemyCount > 0 ? <b>lastSeen {player.lastSeenEnemyCount}</b> : null}
                {player.validAction === false ? <b>fallback</b> : null}
              </span>
              {player.fallbackReason ? <span className={styles.playerWarn}>{player.fallbackReason}</span> : null}
              {player.validationErrors.length > 0 ? <span className={styles.playerWarn}>{player.validationErrors.join("; ")}</span> : null}
            </button>
          );
        })}
        {orderedPlayers.length === 0 ? <p className={styles.emptyInline}>选择 round / phase 后查看选手状态。</p> : null}
      </div>
    </section>
  );
}

function shortId(agentId: string): string {
  return agentId.replace(/^agent_/, "").slice(-8);
}

function statusLabel(status: string): string {
  if (status === "alive") return "存活";
  if (status === "wounded") return "受伤";
  if (status === "dead") return "阵亡";
  return status;
}

function killStars(kills: number): string {
  return ` ${"★".repeat(Math.min(5, Math.max(0, kills)))}${kills > 5 ? `+${kills - 5}` : ""}`;
}

function moneyLabel(value: number | undefined): string {
  return typeof value === "number" ? String(value) : "?";
}

function statusClass(status: string): string {
  if (status === "wounded") return styles.playerWounded ?? "";
  if (status === "dead") return styles.playerDead ?? "";
  return styles.playerAlive ?? "";
}

function statusTextClass(status: string): string {
  if (status === "wounded") return styles.statusWounded ?? "";
  if (status === "dead") return styles.statusDead ?? "";
  return styles.statusAlive ?? "";
}
