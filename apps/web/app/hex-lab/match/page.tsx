import { HexMatchLabClient } from "./hex-match-lab-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function HexMatchLabPage() {
  return <HexMatchLabClient />;
}
