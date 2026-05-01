import { NextResponse } from "next/server.js";

import { loadMapReplay } from "../../../../map-replay-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    mapGameId: string;
  }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { mapGameId } = await context.params;
  const replay = await loadMapReplay(mapGameId);
  if (!replay) {
    return NextResponse.json({ error: `Map replay not found: ${mapGameId}` }, { status: 404 });
  }

  return NextResponse.json(replay);
}
