import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

export const dynamic = "force-dynamic";

let sqliteWarningFilterInstalled = false;

interface Row {
  [key: string]: unknown;
}

interface ReplayView {
  mapGame: {
    mapName: string;
  };
  round: {
    id: string;
    roundNumber: number;
  };
  roundReport: {
    winnerTeamId: string;
    scoreAfterRound: { teamA: number; teamB: number };
    summary: string;
    keyEvents: Array<{ id: string; type: string; zoneId: string; impact: string }>;
  };
  eventsCount: number;
  timelineEvents: Array<{ id: string; atMs: number; kind: string; sourceEventIds: string[] }>;
  economyStatesCount: number;
}

export default async function HomePage() {
  const replay = loadReplay();

  if (!replay) {
    return (
      <main style={styles.shell}>
        <section style={styles.hero}>
          <p style={styles.kicker}>Agent Major Phase 1.1</p>
          <h1 style={styles.title}>等待第一条单回合 Replay</h1>
          <p style={styles.copy}>运行 `pnpm phase11:round` 后，这里会读取同一个 SQLite 事实源并展示时间线。</p>
        </section>
      </main>
    );
  }

  return (
    <main style={styles.shell}>
      <section style={styles.hero}>
        <p style={styles.kicker}>Agent Major Phase 1.1 Replay Viewer</p>
        <h1 style={styles.title}>
          {replay.mapGame.mapName} / Round {replay.round.roundNumber}
        </h1>
        <p style={styles.copy}>{replay.roundReport.summary}</p>
      </section>

      <section style={styles.grid}>
        <article style={styles.card}>
          <p style={styles.label}>比分</p>
          <strong style={styles.score}>
            {replay.roundReport.scoreAfterRound.teamA} : {replay.roundReport.scoreAfterRound.teamB}
          </strong>
          <p style={styles.muted}>Winner: {replay.roundReport.winnerTeamId}</p>
        </article>
        <article style={styles.card}>
          <p style={styles.label}>事实源</p>
          <strong style={styles.metric}>{replay.eventsCount} Events</strong>
          <p style={styles.muted}>
            {replay.timelineEvents.length} TimelineEvents / {replay.economyStatesCount} EconomyStates
          </p>
        </article>
      </section>

      <section style={styles.grid}>
        <article style={styles.card}>
          <h2 style={styles.heading}>关键事件</h2>
          <div style={styles.stack}>
            {replay.roundReport.keyEvents.map((event) => (
              <div key={event.id} style={styles.item}>
                <strong>
                  {event.type} / {event.zoneId}
                </strong>
                <span>{event.impact}</span>
              </div>
            ))}
          </div>
        </article>
        <article style={styles.card}>
          <h2 style={styles.heading}>播放时间线</h2>
          <div style={styles.stack}>
            {replay.timelineEvents.map((event) => (
              <div key={event.id} style={styles.timelineItem}>
                <span style={styles.time}>{event.atMs}ms</span>
                <strong>{event.kind}</strong>
                <small>{event.sourceEventIds.join(", ")}</small>
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}

function loadReplay(): ReplayView | null {
  const sqlitePath = resolve(getProjectRoot(), "data", "agent-major.sqlite");
  if (!existsSync(sqlitePath)) {
    return null;
  }

  installSqliteWarningFilter();
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (path: string) => {
      prepare(sql: string): {
        get(...params: unknown[]): Row | undefined;
        all(...params: unknown[]): Row[];
      };
      close(): void;
    };
  };
  const db = new DatabaseSync(sqlitePath);
  try {
    const round = db
      .prepare("SELECT * FROM rounds WHERE map_game_id = ? AND status = 'completed' ORDER BY round_number DESC LIMIT 1")
      .get("map_demo_match_phase11_1");
    if (!round) {
      return null;
    }

    const mapGame = requiredRow(db.prepare("SELECT * FROM map_games WHERE id = ?").get(asString(round.map_game_id)));
    const roundReport = requiredRow(db.prepare("SELECT * FROM round_reports WHERE round_id = ?").get(asString(round.id)));
    const eventsCount = asNumber(requiredRow(db.prepare("SELECT COUNT(*) AS count FROM events WHERE round_id = ?").get(asString(round.id))).count);
    const timelineRows = db
      .prepare("SELECT * FROM timeline_events WHERE round_id = ? ORDER BY sequence_index ASC")
      .all(asString(round.id));
    const economyStatesCount = asNumber(
      requiredRow(db.prepare("SELECT COUNT(*) AS count FROM economy_states WHERE round_id = ?").get(asString(round.id))).count
    );

    return {
      mapGame: {
        mapName: asString(mapGame.map_name)
      },
      round: {
        id: asString(round.id),
        roundNumber: asNumber(round.round_number)
      },
      roundReport: {
        winnerTeamId: asString(roundReport.winner_team_id),
        scoreAfterRound: parseJson(roundReport.score_after_round_json),
        summary: asString(roundReport.summary),
        keyEvents: parseJson(roundReport.key_events_json)
      },
      eventsCount,
      timelineEvents: timelineRows.map((row) => ({
        id: asString(row.id),
        atMs: asNumber(row.at_ms),
        kind: asString(row.kind),
        sourceEventIds: parseJson(row.source_event_ids_json)
      })),
      economyStatesCount
    };
  } finally {
    db.close();
  }
}

function installSqliteWarningFilter(): void {
  if (sqliteWarningFilterInstalled) {
    return;
  }

  const mutableProcess = process as NodeJS.Process & {
    emitWarning: (...args: unknown[]) => void;
  };
  const originalEmitWarning = mutableProcess.emitWarning.bind(process);
  mutableProcess.emitWarning = (...args: unknown[]) => {
    const warning = args[0];
    const message = typeof warning === "string" ? warning : warning instanceof Error ? warning.message : "";
    if (message.includes("SQLite is an experimental feature")) {
      return;
    }

    originalEmitWarning(...args);
  };
  sqliteWarningFilterInstalled = true;
}

function getProjectRoot(): string {
  const cwd = process.cwd();
  if (existsSync(resolve(cwd, "pnpm-workspace.yaml"))) {
    return cwd;
  }

  return resolve(cwd, "../..");
}

function requiredRow(row: Row | undefined): Row {
  if (!row) {
    throw new Error("Expected SQLite row.");
  }

  return row;
}

function asString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error(`Expected string but received ${typeof value}`);
  }

  return value;
}

function asNumber(value: unknown): number {
  if (typeof value !== "number") {
    throw new Error(`Expected number but received ${typeof value}`);
  }

  return value;
}

function parseJson<T>(value: unknown): T {
  if (typeof value !== "string") {
    throw new Error(`Expected JSON string but received ${typeof value}`);
  }

  return JSON.parse(value) as T;
}

const styles = {
  shell: {
    minHeight: "100vh",
    padding: "48px",
    background: "linear-gradient(135deg, #101820 0%, #162c2f 48%, #f2b84b 100%)",
    color: "#f8f1df",
    fontFamily: "Georgia, 'Times New Roman', serif"
  },
  hero: {
    maxWidth: "960px",
    padding: "32px",
    border: "1px solid rgba(248, 241, 223, 0.28)",
    background: "rgba(16, 24, 32, 0.72)",
    boxShadow: "0 24px 80px rgba(0, 0, 0, 0.32)"
  },
  kicker: {
    margin: 0,
    color: "#f2b84b",
    letterSpacing: "0.18em",
    textTransform: "uppercase" as const
  },
  title: {
    margin: "12px 0",
    fontSize: "clamp(40px, 7vw, 88px)",
    lineHeight: 0.92
  },
  copy: {
    maxWidth: "760px",
    color: "#e8dcc4",
    fontSize: "18px"
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "20px",
    marginTop: "20px",
    maxWidth: "1180px"
  },
  card: {
    padding: "24px",
    background: "rgba(248, 241, 223, 0.92)",
    color: "#101820",
    border: "2px solid rgba(16, 24, 32, 0.2)"
  },
  label: {
    margin: 0,
    color: "#6b5a32",
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const
  },
  score: {
    display: "block",
    fontSize: "64px",
    lineHeight: 1
  },
  metric: {
    display: "block",
    fontSize: "38px",
    lineHeight: 1.1
  },
  muted: {
    color: "#5b5141"
  },
  heading: {
    marginTop: 0,
    fontSize: "28px"
  },
  stack: {
    display: "grid",
    gap: "12px"
  },
  item: {
    display: "grid",
    gap: "4px",
    padding: "12px",
    background: "rgba(16, 24, 32, 0.08)"
  },
  timelineItem: {
    display: "grid",
    gridTemplateColumns: "80px 1fr",
    gap: "4px 12px",
    padding: "12px",
    background: "rgba(16, 24, 32, 0.08)"
  },
  time: {
    color: "#8a5f00",
    fontVariantNumeric: "tabular-nums" as const
  }
};
