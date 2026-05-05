import { NextResponse } from "next/server.js";

import { toLiveMapReplayData } from "../../../../live-replay-model";
import { loadMapReplay } from "../../../../map-replay-data";
import { toPublicReplayPayload } from "../../../public-replay-payload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    mapGameId: string;
  }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { mapGameId } = await context.params;
  const replay = await loadMapReplay(mapGameId);
  if (!replay) {
    return NextResponse.json({ error: `Map replay not found: ${mapGameId}` }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format");
  if (format && format !== "live") {
    return NextResponse.json({ error: "Public replay routes only expose the live-safe format." }, { status: 400 });
  }

  return NextResponse.json(toPublicReplayPayload(toLiveMapReplayData(replay)));
}
