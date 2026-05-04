import { phase18CanonIds } from "@agent-major/materials";

import { LiveReplayPlayer } from "./live-replay-player";
import { toLiveReplayData } from "./live-replay-model";
import { defaultMatchId, loadMatchReplay } from "./map-replay-data";
import { readLatestWebRunProgressForMatch } from "./server-run-progress";
import { getPublicWebRunnerPolicy } from "./server-web-runner-policy";

export const dynamic = "force-dynamic";

interface HomePageProps {
  searchParams?: Promise<{
    matchId?: string | string[];
  }>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const requestedMatchId = resolveMatchId(resolvedSearchParams?.matchId);
  const currentRun = readLatestWebRunProgressForMatch(requestedMatchId);
  const replay = await loadMatchReplay(requestedMatchId);
  const webRunnerPolicy = getPublicWebRunnerPolicy();
  const initialReplayGuard =
    currentRun &&
    currentRun.targetMatchId === requestedMatchId &&
    (currentRun.status === "running" || (currentRun.status === "failed" && !currentRun.hasFreshReplay))
      ? {
          hidden: true,
          message:
            currentRun.status === "running"
              ? "Phase 1.8 current run is generating. Old replay stays hidden until this run commits fresh replay data."
              : currentRun.error
                ? `Phase 1.8 current run failed before committing fresh replay data: ${currentRun.error}`
                : "Phase 1.8 current run failed before committing fresh replay data."
        }
      : { hidden: false, message: "" };

  return (
    <LiveReplayPlayer
      matchId={requestedMatchId}
      replay={replay ? toLiveReplayData(replay) : null}
      runnerPolicy={webRunnerPolicy}
      initialRunProgress={currentRun}
      initialReplayGuard={initialReplayGuard}
    />
  );
}

function resolveMatchId(matchId: string | string[] | undefined): string {
  const requested =
    typeof matchId === "string" ? matchId : Array.isArray(matchId) ? matchId[0] : defaultMatchId;
  return requested === phase18CanonIds.matchId ? requested : defaultMatchId;
}
