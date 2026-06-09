import { phase17CanonIds, phase18CanonIds } from "@agent-major/materials";

import { LiveReplayPlayer } from "./live-replay-player";
import { toLiveReplayData } from "./live-replay-model";
import { defaultMatchId, loadMatchReplay, normalizePhase18PilotReplay } from "./map-replay-data";
import { readLatestWebRunProgressForMatch, readPhase18RunHistory } from "./server-run-progress";
import { getPublicWebRunnerPolicy } from "./server-web-runner-policy";

export const dynamic = "force-dynamic";

interface HomePageProps {
  searchParams?: Promise<{
    matchId?: string | string[];
    fixtureId?: string | string[];
    runId?: string | string[];
  }>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const requestedMatchId = resolveFixtureId(resolvedSearchParams);
  const requestedRunId = resolveSingleValue(resolvedSearchParams?.runId);
  const currentRun = await readLatestWebRunProgressForMatch(requestedMatchId, requestedRunId);
  const runHistory = requestedMatchId === phase18CanonIds.fixtureId ? await readPhase18RunHistory() : [];
  const replayMatchId =
    requestedMatchId === phase17CanonIds.matchId ? requestedMatchId : currentRun?.runtimeMatchId;
  const replay = replayMatchId ? await loadMatchReplay(replayMatchId) : null;
  const normalizedReplay = requestedMatchId === phase18CanonIds.fixtureId ? normalizePhase18PilotReplay(replay) : replay;
  const webRunnerPolicy = getPublicWebRunnerPolicy();
  const initialReplayGuard =
    currentRun &&
    (currentRun.status === "running" || (currentRun.status === "failed" && !currentRun.hasFreshReplay))
      ? {
          hidden: true,
          message:
            currentRun.status === "running"
              ? "当前 Phase 1.8 run 正在生成中；在该 run 提交新的 replay 事实之前，主舞台不会展示它的回放。"
              : currentRun.error
                ? `当前 Phase 1.8 run 在提交 replay 事实之前失败：${currentRun.error}`
                : "当前 Phase 1.8 run 在提交 replay 事实之前失败。"
        }
      : { hidden: false, message: "" };

  return (
    <>
      <nav
        style={{
          position: "fixed",
          top: 12,
          right: 12,
          zIndex: 20,
          display: "flex",
          gap: 8
        }}
        aria-label="实验入口"
      >
        <a
          href="/hex-lab/match"
          style={{
            border: "1px solid rgba(159, 219, 188, 0.55)",
            borderRadius: 8,
            background: "rgba(13, 17, 21, 0.9)",
            color: "#dff6ea",
            padding: "8px 10px",
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 700
          }}
        >
          Hex Web 验收台
        </a>
        <a
          href="/hex-lab/editor"
          style={{
            border: "1px solid rgba(159, 219, 188, 0.35)",
            borderRadius: 8,
            background: "rgba(13, 17, 21, 0.78)",
            color: "#cce2ff",
            padding: "8px 10px",
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 700
          }}
        >
          Hex 地图编辑器
        </a>
      </nav>
      <LiveReplayPlayer
        matchId={requestedMatchId}
        replay={normalizedReplay ? toLiveReplayData(normalizedReplay) : null}
        runnerPolicy={webRunnerPolicy}
        initialRunProgress={currentRun}
        initialRunHistory={currentRun?.recentRuns ?? runHistory}
        initialReplayGuard={initialReplayGuard}
      />
    </>
  );
}

function resolveFixtureId(
  searchParams:
    | {
        matchId?: string | string[];
        fixtureId?: string | string[];
      }
    | undefined
): string {
  const requested = resolveSingleValue(searchParams?.fixtureId) ?? resolveSingleValue(searchParams?.matchId) ?? defaultMatchId;
  if (requested === phase17CanonIds.matchId) {
    return requested;
  }
  return requested === phase18CanonIds.fixtureId || requested === phase18CanonIds.matchId ? phase18CanonIds.fixtureId : defaultMatchId;
}

function resolveSingleValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0];
  }
  return undefined;
}
