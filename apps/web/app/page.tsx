import { LiveReplayPlayer } from "./live-replay-player";
import { toLiveReplayData } from "./live-replay-model";
import { defaultMatchId, loadMatchReplay } from "./map-replay-data";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const replay = await loadMatchReplay(defaultMatchId);

  if (!replay || replay.maps.length === 0) {
    return (
      <main className="phase14-empty-shell">
        <section className="phase14-empty-card">
          <p>Agent Major Phase 1.4</p>
          <h1>等待 BO3 Replay</h1>
          <span>运行 `pnpm phase13:match` 后，首页会读取同一个 SQLite 事实源并播放伪直播。</span>
        </section>
        <style>{`
          .phase14-empty-shell {
            min-height: 100vh;
            display: grid;
            place-items: center;
            padding: 48px;
            color: #fff7dc;
            background:
              radial-gradient(circle at 20% 10%, rgba(244, 184, 70, 0.35), transparent 26%),
              linear-gradient(135deg, #071215 0%, #132b2f 48%, #d1952c 100%);
            font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
          }
          .phase14-empty-card {
            max-width: 760px;
            padding: 40px;
            border: 1px solid rgba(255, 255, 255, 0.22);
            background: rgba(7, 18, 21, 0.76);
            box-shadow: 16px 16px 0 rgba(0, 0, 0, 0.22);
          }
          .phase14-empty-card p {
            margin: 0 0 12px;
            color: #f4b846;
            letter-spacing: 0.16em;
            text-transform: uppercase;
            font-size: 13px;
          }
          .phase14-empty-card h1 {
            margin: 0 0 18px;
            font-size: clamp(44px, 8vw, 96px);
            line-height: 0.92;
          }
          .phase14-empty-card span {
            color: #fff0bd;
            font-size: 20px;
            line-height: 1.6;
          }
        `}</style>
      </main>
    );
  }

  return <LiveReplayPlayer replay={toLiveReplayData(replay)} />;
}
