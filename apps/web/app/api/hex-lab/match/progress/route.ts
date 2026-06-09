import { NextResponse } from "next/server.js";

import { readHexMatchLabRunProgress } from "../../../../server-hex-match-lab";
import { sanitizeRunError } from "../../../../server-run-progress";
import { validateWebRunnerAccess } from "../../../../server-web-runner-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const access = validateWebRunnerAccess(request, {
    adminToken: url.searchParams.get("adminToken") ?? undefined
  });
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    const progress = await readHexMatchLabRunProgress({
      mapGameId: url.searchParams.get("mapGameId"),
      summaryArtifactId: url.searchParams.get("summaryArtifactId"),
      roundTraceArtifactId: url.searchParams.get("roundTraceArtifactId")
    });
    return NextResponse.json({ progress });
  } catch (error) {
    return NextResponse.json({ error: sanitizeRunError(error) }, { status: 500 });
  }
}
