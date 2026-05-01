import type { CSSProperties } from "react";

import type { MapReplay, RoundReplayItem } from "@agent-major/core";

import { defaultMapGameId, loadMapReplay } from "./map-replay-data";

export const dynamic = "force-dynamic";

interface MapSummaryPayload {
  mvpAgentId?: string;
  keyRounds?: Array<{
    roundNumber: number;
    winnerTeamId: string;
    scoreAfterRound: { teamA: number; teamB: number };
    reason: string;
  }>;
  economySwingRounds?: number[];
  overtimePlayed?: boolean;
}

export default async function HomePage() {
  const replay = await loadMapReplay(defaultMapGameId);

  if (!replay) {
    return (
      <main style={styles.shell}>
        <section style={styles.hero}>
          <p style={styles.kicker}>Agent Major Phase 1.2</p>
          <h1 style={styles.title}>等待单张地图 Replay</h1>
          <p style={styles.copy}>运行 `pnpm phase12:map` 后，这里会读取同一个 SQLite 事实源并展示地图回放。</p>
        </section>
      </main>
    );
  }

  const payload = replay.mapSummary?.payload as MapSummaryPayload | undefined;
  const latestRound = replay.rounds.at(-1);
  const overtimePlayed = replay.mapGame.currentRoundNumber > 12;

  return (
    <main style={styles.shell}>
      <section style={styles.hero}>
        <p style={styles.kicker}>Agent Major Phase 1.2 Map Viewer</p>
        <h1 style={styles.title}>
          {replay.mapGame.mapName} / {replay.teams.teamA.shortName} vs {replay.teams.teamB.shortName}
        </h1>
        <p style={styles.copy}>{replay.mapSummary?.content ?? "地图仍在生成中，当前展示已完成回合。"}</p>
      </section>

      <section style={styles.scoreboard}>
        <div>
          <p style={styles.label}>最终比分</p>
          <strong style={styles.score}>
            {replay.mapGame.teamAScore} : {replay.mapGame.teamBScore}
          </strong>
        </div>
        <div style={styles.scoreMeta}>
          <span>状态：{replay.mapGame.status}</span>
          <span>胜者：{replay.mapGame.winnerTeamId ?? "pending"}</span>
          <span>回合：{replay.mapGame.currentRoundNumber}</span>
          <span>加时：{overtimePlayed ? "yes" : "no"}</span>
        </div>
      </section>

      <section style={styles.grid}>
        <article style={styles.card}>
          <h2 style={styles.heading}>地图摘要</h2>
          <div style={styles.stack}>
            <Metric label="Summary ID" value={replay.mapGame.summaryId ?? "pending"} />
            <Metric label="MVP" value={payload?.mvpAgentId ?? "pending"} />
            <Metric label="Events" value={`${replay.eventCounts.map} map / ${replay.eventCounts.timeline} timeline`} />
            <Metric label="Economy swings" value={(payload?.economySwingRounds ?? []).join(", ") || "none"} />
          </div>
        </article>

        <article style={styles.card}>
          <h2 style={styles.heading}>关键回合</h2>
          <div style={styles.stack}>
            {(payload?.keyRounds ?? []).map((round) => (
              <div key={round.roundNumber} style={styles.item}>
                <strong>
                  Round {round.roundNumber} / {round.scoreAfterRound.teamA}-{round.scoreAfterRound.teamB}
                </strong>
                <span>{round.reason}</span>
              </div>
            ))}
            {(payload?.keyRounds ?? []).length === 0 ? <span style={styles.muted}>地图完成后生成关键回合。</span> : null}
          </div>
        </article>
      </section>

      <section style={styles.gridWide}>
        <article style={styles.card}>
          <h2 style={styles.heading}>回合列表</h2>
          <div style={styles.roundGrid}>
            {replay.rounds.map((item) => (
              <RoundCard key={item.round.id} item={item} replay={replay} />
            ))}
          </div>
        </article>

        <article style={styles.card}>
          <h2 style={styles.heading}>Viewer Mode / 最新回合时间线</h2>
          {latestRound ? (
            <div style={styles.timeline}>
              {latestRound.timelineEvents.map((event) => (
                <div key={event.id} style={styles.timelineItem}>
                  <span style={styles.time}>{event.atMs}ms</span>
                  <strong>{event.kind}</strong>
                  <small>{event.sourceEventIds.join(", ")}</small>
                </div>
              ))}
            </div>
          ) : (
            <span style={styles.muted}>暂无已完成回合。</span>
          )}
        </article>
      </section>
    </main>
  );
}

function RoundCard({ item, replay }: { item: RoundReplayItem; replay: MapReplay }) {
  const winnerName =
    item.roundReport.winnerTeamId === replay.teams.teamA.id ? replay.teams.teamA.shortName : replay.teams.teamB.shortName;
  return (
    <div style={styles.roundCard}>
      <span style={styles.roundNumber}>R{String(item.round.roundNumber).padStart(2, "0")}</span>
      <strong>{winnerName}</strong>
      <span>
        {item.roundReport.scoreAfterRound.teamA}-{item.roundReport.scoreAfterRound.teamB}
      </span>
      <small>
        {item.events.length} events / {item.timelineEvents.length} timeline
      </small>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.metricRow}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  shell: {
    minHeight: "100vh",
    padding: "48px",
    background:
      "radial-gradient(circle at 18% 12%, rgba(242,184,75,0.32), transparent 28%), linear-gradient(135deg, #0d1719 0%, #163034 52%, #e5a735 100%)",
    color: "#f8f1df",
    fontFamily: "Georgia, 'Times New Roman', serif"
  },
  hero: {
    maxWidth: "1060px",
    marginBottom: "32px"
  },
  kicker: {
    margin: 0,
    textTransform: "uppercase",
    letterSpacing: "0.16em",
    color: "#f2b84b",
    fontSize: "13px"
  },
  title: {
    margin: "12px 0",
    fontSize: "clamp(42px, 7vw, 92px)",
    lineHeight: 0.9
  },
  copy: {
    maxWidth: "900px",
    fontSize: "20px",
    lineHeight: 1.55,
    color: "#fff4d0"
  },
  scoreboard: {
    display: "flex",
    justifyContent: "space-between",
    gap: "24px",
    padding: "28px",
    border: "1px solid rgba(255,255,255,0.24)",
    background: "rgba(7, 16, 18, 0.72)",
    boxShadow: "14px 14px 0 rgba(0,0,0,0.24)",
    marginBottom: "24px"
  },
  scoreMeta: {
    display: "grid",
    gap: "8px",
    minWidth: "260px",
    color: "#f8dc95",
    textTransform: "uppercase",
    letterSpacing: "0.08em"
  },
  label: {
    margin: "0 0 8px",
    color: "#f2b84b",
    letterSpacing: "0.14em",
    textTransform: "uppercase"
  },
  score: {
    fontSize: "76px",
    lineHeight: 1
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "24px",
    marginBottom: "24px"
  },
  gridWide: {
    display: "grid",
    gridTemplateColumns: "1.3fr 0.9fr",
    gap: "24px"
  },
  card: {
    padding: "24px",
    background: "rgba(10, 25, 27, 0.82)",
    border: "1px solid rgba(255,255,255,0.2)"
  },
  heading: {
    margin: "0 0 18px",
    fontSize: "24px"
  },
  stack: {
    display: "grid",
    gap: "12px"
  },
  item: {
    display: "grid",
    gap: "6px",
    padding: "12px",
    background: "rgba(255,255,255,0.07)"
  },
  muted: {
    color: "#cbbf9e"
  },
  metricRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "16px",
    paddingBottom: "10px",
    borderBottom: "1px solid rgba(255,255,255,0.14)"
  },
  roundGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "10px"
  },
  roundCard: {
    display: "grid",
    gap: "6px",
    padding: "12px",
    color: "#101820",
    background: "#f2b84b"
  },
  roundNumber: {
    fontSize: "12px",
    letterSpacing: "0.12em"
  },
  timeline: {
    display: "grid",
    gap: "10px"
  },
  timelineItem: {
    display: "grid",
    gap: "4px",
    padding: "12px",
    borderLeft: "4px solid #f2b84b",
    background: "rgba(255,255,255,0.08)"
  },
  time: {
    color: "#f2b84b",
    fontVariantNumeric: "tabular-nums"
  }
};
