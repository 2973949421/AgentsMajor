import { NextResponse } from "next/server.js";

import { hasActiveWebRun, readWebRunProgress, sanitizeRunError, startPhase15SingleMapWebRun } from "../../../../server-run-progress";
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
    const progress = startPhase15SingleMapWebRun(matchId);
    return NextResponse.json(
      {
        summary: "DUST2 single-map real LLM generation started.",
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
