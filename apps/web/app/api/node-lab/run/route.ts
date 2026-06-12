import { NextResponse } from "next/server.js";

import { retiredNodeLabResult } from "../../../server-node-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  await request.json().catch(() => ({}));
  return NextResponse.json(retiredNodeLabResult(), { status: 410 });
}

export async function GET(request: Request) {
  new URL(request.url);
  return NextResponse.json(retiredNodeLabResult(), { status: 410 });
}
