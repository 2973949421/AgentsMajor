import { NodeLabClient } from "./node-lab-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function NodeLabPage() {
  return <NodeLabClient />;
}
