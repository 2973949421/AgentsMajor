import { NextResponse } from "next/server.js";

import {
  normalizeHexMatchLabRunRequest,
  readHexMatchLabLiveRun,
  startHexMatchLabLiveRun
} from "../../../../server-hex-match-lab";
import { sanitizeRunError } from "../../../../server-run-progress";
import { validateWebRunnerAccess } from "../../../../server-web-runner-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const access = validateWebRunnerAccess(request, {
    adminToken: typeof body?.adminToken === "string" ? body.adminToken : undefined
  });
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    const run = await startHexMatchLabLiveRun(normalizeHexMatchLabRunRequest(body));
    return NextResponse.json({ run }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: sanitizeRunError(error) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const access = validateWebRunnerAccess(request, {
    adminToken: url.searchParams.get("adminToken") ?? undefined
  });
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const runId = url.searchParams.get("runId");
  if (!runId) {
    return NextResponse.json({ error: "Missing runId" }, { status: 400 });
  }

  const run = readHexMatchLabLiveRun(runId);
  if (!run) {
    return NextResponse.json({ error: `Hex live run not found: ${runId}` }, { status: 404 });
  }
  return NextResponse.json({ run });
}
