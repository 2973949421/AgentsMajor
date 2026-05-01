import { NextResponse } from "next/server.js";

import { toLiveReplayData } from "../../../../live-replay-model";
import { loadMatchReplay } from "../../../../map-replay-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    matchId: string;
  }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { matchId } = await context.params;
  const replay = await loadMatchReplay(matchId);
  if (!replay) {
    return NextResponse.json({ error: `Match replay not found: ${matchId}` }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  if (searchParams.get("format") === "live") {
    return NextResponse.json(toLiveReplayData(replay));
  }

  return NextResponse.json(replay);
}
