import { NextResponse } from "next/server.js";

import {
  normalizeNodeLabRunRequest,
  readNodeLabRunProgress,
  startNodeLabRun
} from "../../../server-node-lab";
import { sanitizeRunError } from "../../../server-run-progress";
import { validateWebRunnerAccess } from "../../../server-web-runner-policy";

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
    const progress = await startNodeLabRun(normalizeNodeLabRunRequest(body));
    return NextResponse.json(
      {
        summary: "Node Lab run 已启动。真实 LLM、fixture 或 deterministic 状态会在本页面进度中显示。",
        progress
      },
      { status: 202 }
    );
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

  try {
    const progress = await readNodeLabRunProgress(url.searchParams.get("runId"));
    if (!progress) {
      return NextResponse.json({ error: "No Node Lab run progress found." }, { status: 404 });
    }
    return NextResponse.json({ progress });
  } catch (error) {
    return NextResponse.json({ error: sanitizeRunError(error) }, { status: 500 });
  }
}
