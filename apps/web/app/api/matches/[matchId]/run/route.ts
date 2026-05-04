import { NextResponse } from "next/server.js";

import { phase17CanonIds, phase18CanonIds } from "@agent-major/materials";

import {
  hasActiveWebRun,
  readWebRunProgress,
  sanitizeRunError,
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
  const validation = validateWebRunnerRequest(request, body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: validation.status });
  }

  if (hasActiveWebRun()) {
    return NextResponse.json({ error: "A local match run is already in progress.", progress: readWebRunProgress() }, { status: 409 });
  }

  try {
    const progress =
      validation.mode === "phase17_showcase_match" && matchId === phase17CanonIds.matchId
        ? startPhase17ShowcaseWebRun(matchId)
        : validation.mode === "phase18_next_round" && matchId === phase18CanonIds.matchId
          ? startPhase18NextRoundWebRun(matchId)
          : validation.mode === "phase18_current_map" && matchId === phase18CanonIds.matchId
            ? startPhase18CurrentMapWebRun(matchId)
            : validation.mode === "phase18_full_bo3" && matchId === phase18CanonIds.matchId
              ? startPhase18FullBo3WebRun(matchId)
              : null;
    if (!progress) {
      return NextResponse.json(
        {
          error: `Web runner mode/match mismatch. Supported pairs: ${phase17CanonIds.matchId} -> phase17_showcase_match, ${phase18CanonIds.matchId} -> phase18_next_round|phase18_current_map|phase18_full_bo3.`
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        summary:
          validation.mode === "phase18_next_round"
            ? "Phase 1.8 next-round real-LLM pilot started."
            : validation.mode === "phase18_current_map"
              ? "Phase 1.8 current-map real-LLM pilot started."
              : validation.mode === "phase18_full_bo3"
                ? "Phase 1.8 full BO3 real-LLM pilot started."
                : "Phase 1.7 Falcon-7B vs VitaLLMty BO3 fake-only generation started.",
        progress
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
  const progress = readWebRunProgress(url.searchParams.get("runId") ?? undefined);
  if (!progress || progress.matchId !== matchId) {
    return NextResponse.json({ error: "No local match run progress found." }, { status: 404 });
  }

  return NextResponse.json({ progress });
}
