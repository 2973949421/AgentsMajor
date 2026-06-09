import { NextResponse } from "next/server.js";

import {
  readHexMatchLabRunProgress,
  resetHexMatchLabValidationMap
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
    const map = await resetHexMatchLabValidationMap({
      mapGameId: typeof body?.mapGameId === "string" ? body.mapGameId : undefined
    });
    const progress = await readHexMatchLabRunProgress({ mapGameId: map.mapGameId });
    return NextResponse.json({
      summary: "已通过新建同源实验地图完成安全重置；旧地图和历史 artifact 保留。",
      map,
      progress
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: sanitizeRunError(error) }, { status: 500 });
  }
}
