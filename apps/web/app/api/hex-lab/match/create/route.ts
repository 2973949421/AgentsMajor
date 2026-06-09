import { NextResponse } from "next/server.js";

import {
  createHexMatchLabValidationMap,
  readHexMatchLabRunProgress
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
    const map = await createHexMatchLabValidationMap({
      baseMapGameId: typeof body?.baseMapGameId === "string" ? body.baseMapGameId : undefined
    });
    const progress = await readHexMatchLabRunProgress({ mapGameId: map.mapGameId });
    return NextResponse.json({
      summary: "已新建 Hex Dust2 验收地图。",
      map,
      progress
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: sanitizeRunError(error) }, { status: 500 });
  }
}
