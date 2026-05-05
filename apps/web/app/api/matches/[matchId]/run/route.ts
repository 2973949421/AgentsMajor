import { NextResponse } from "next/server.js";

import { phase17CanonIds, phase18CanonIds } from "@agent-major/materials";

import {
  getActiveWebRunSnapshot,
  hasActiveWebRun,
  readLatestWebRunProgressForMatch,
  readWebRunProgress,
  sanitizeRunError,
  resetPhase18CurrentMapWebRun,
  resetPhase18FullBo3WebRun,
  resetPhase18RoundWebRun,
  startPhase17ShowcaseWebRun,
  startPhase18CurrentMapWebRun,
  startPhase18FullBo3WebRun,
  startPhase18NextRoundWebRun
} from "../../../../server-run-progress";
import { validateWebRunnerRequest, type WebRunnerRequestBody } from "../../../../server-web-runner-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    matchId: string;
  }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { matchId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as WebRunnerRequestBody;
  const requestedRunId = typeof body.runId === "string" ? body.runId : undefined;
  const validation = validateWebRunnerRequest(request, body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: validation.status });
  }

  try {
    if (validation.action === "reset") {
      if (matchId !== phase18CanonIds.fixtureId && matchId !== phase18CanonIds.matchId) {
        return NextResponse.json(
          { error: `Reset actions are only supported for the Phase 1.8 pilot fixture: ${phase18CanonIds.fixtureId}.` },
          { status: 400 }
        );
      }

      const resetResult =
        validation.resetScope === "round"
          ? await resetPhase18RoundWebRun(matchId, requestedRunId)
          : validation.resetScope === "map"
            ? await resetPhase18CurrentMapWebRun(matchId, requestedRunId)
            : await resetPhase18FullBo3WebRun(matchId, requestedRunId);
      const progress = await readLatestWebRunProgressForMatch(matchId, validation.resetScope === "match" ? undefined : requestedRunId);

      return NextResponse.json(
        {
          summary:
            validation.resetScope === "round"
              ? "已重置本回合，当前 run 会从上一条已提交事实继续。"
              : validation.resetScope === "map"
                ? "已重置当前地图，下一次生成将从 Round 1 重新开始。"
                : "已废弃当前整场 BO3 run，下一次生成会创建新的 run。",
          reset: resetResult,
          ...(progress ? { progress } : {}),
          replayUrl: validation.resetScope === "match" ? "/" : requestedRunId ? `/?runId=${encodeURIComponent(requestedRunId)}` : "/"
        },
        { status: 200 }
      );
    }

    if (hasActiveWebRun()) {
      const activeRun = getActiveWebRunSnapshot();
      const progress = activeRun ? await readWebRunProgress(activeRun.runId, activeRun.fixtureId) : await readLatestWebRunProgressForMatch(matchId, requestedRunId);
      return NextResponse.json(
        {
          summary: "已有一条本地生成正在进行，已切回当前 active run 的进度。",
          progress,
          replayUrl: progress ? `/?runId=${encodeURIComponent(progress.runId)}` : undefined,
          progressUrl: progress ? `/api/matches/${encodeURIComponent(matchId)}/run?runId=${encodeURIComponent(progress.runId)}` : undefined
        },
        { status: 202 }
      );
    }

    const progress =
      validation.mode === "phase17_showcase_match" && matchId === phase17CanonIds.matchId
        ? startPhase17ShowcaseWebRun(matchId)
        : validation.mode === "phase18_next_round" && (matchId === phase18CanonIds.fixtureId || matchId === phase18CanonIds.matchId)
          ? await startPhase18NextRoundWebRun(matchId, requestedRunId)
          : validation.mode === "phase18_current_map" && (matchId === phase18CanonIds.fixtureId || matchId === phase18CanonIds.matchId)
            ? await startPhase18CurrentMapWebRun(matchId, requestedRunId)
            : validation.mode === "phase18_full_bo3" && (matchId === phase18CanonIds.fixtureId || matchId === phase18CanonIds.matchId)
              ? await startPhase18FullBo3WebRun(matchId, requestedRunId)
              : null;

    if (!progress) {
      return NextResponse.json(
        {
          error: `Web runner mode/match mismatch. Supported pairs: ${phase17CanonIds.matchId} -> phase17_showcase_match, ${phase18CanonIds.fixtureId} -> phase18_next_round|phase18_current_map|phase18_full_bo3.`
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        summary:
          validation.mode === "phase18_next_round"
            ? "Phase 1.8 单局真实 LLM run 已启动。"
            : validation.mode === "phase18_current_map"
              ? "Phase 1.8 当前地图真实 LLM run 已启动。"
              : validation.mode === "phase18_full_bo3"
                ? "Phase 1.8 整场 BO3 真实 LLM run 已启动。"
                : "Phase 1.7 Falcon-7B vs VitaLLMty BO3 fake-only generation started.",
        progress,
        replayUrl: validation.mode === "phase17_showcase_match" ? `/?matchId=${encodeURIComponent(matchId)}` : `/?runId=${encodeURIComponent(progress.runId)}`,
        progressUrl: `/api/matches/${encodeURIComponent(matchId)}/run?runId=${encodeURIComponent(progress.runId)}`
      },
      { status: 202 }
    );
  } catch (error) {
    return NextResponse.json({ error: sanitizeRunError(error) }, { status: 500 });
  }
}

export async function GET(request: Request, context: RouteContext) {
  const { matchId } = await context.params;
  const url = new URL(request.url);
  const progress = await readWebRunProgress(url.searchParams.get("runId") ?? undefined, matchId);
  if (!progress || progress.matchId !== matchId) {
    return NextResponse.json({ error: "No local match run progress found." }, { status: 404 });
  }

  return NextResponse.json({ progress });
}
