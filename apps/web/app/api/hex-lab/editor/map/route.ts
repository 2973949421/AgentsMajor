import { NextResponse } from "next/server.js";

import {
  formatZodError,
  HexEditorMapError,
  HexEditorValidationError,
  isZodLikeError,
  loadHexEditorMap,
  saveHexEditorMap,
  type HexEditorMapVariant
} from "../../../../server-hex-map-editor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const mapSlug = searchParams.get("mapSlug") ?? "dust2";
  const variant = searchParams.get("variant") ?? "draft";

  try {
    const payload = await loadHexEditorMap(mapSlug, undefined, variant as HexEditorMapVariant);
    return NextResponse.json(payload);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const mapSlug = searchParams.get("mapSlug") ?? "dust2";
  const variant = searchParams.get("variant") ?? "draft";

  try {
    const body = await request.json();
    const payload = await saveHexEditorMap(body?.asset ?? body, mapSlug, undefined, variant as HexEditorMapVariant);
    return NextResponse.json(payload);
  } catch (error) {
    return toErrorResponse(error);
  }
}

function toErrorResponse(error: unknown) {
  if (error instanceof HexEditorValidationError) {
    return NextResponse.json(
      {
        error: "hex_map_validation_failed",
        validation: error.validation
      },
      { status: 400 }
    );
  }

  if (error instanceof HexEditorMapError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: 400 });
  }

  if (isZodLikeError(error)) {
    return NextResponse.json({ error: "hex_map_schema_invalid", message: formatZodError(error) }, { status: 400 });
  }

  const message = error instanceof Error ? error.message : "Unknown HexMapEditor error.";
  return NextResponse.json({ error: "hex_map_editor_failed", message }, { status: 500 });
}
