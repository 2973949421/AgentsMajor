import { HexMapEditorClient } from "./hex-map-editor-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function HexMapEditorPage() {
  return <HexMapEditorClient />;
}
