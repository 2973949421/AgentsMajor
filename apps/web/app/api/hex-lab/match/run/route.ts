import { NextResponse } from "next/server.js";

import {
  normalizeHexMatchLabRunRequest,
  startHexMatchLabRun
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
    const result = await startHexMatchLabRun(normalizeHexMatchLabRunRequest(body));
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: sanitizeRunError(error) }, { status: 500 });
  }
}
