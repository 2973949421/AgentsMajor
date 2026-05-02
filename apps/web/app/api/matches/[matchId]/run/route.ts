import { NextResponse } from "next/server.js";

import { runPhase15SingleMapFromWeb } from "../../../../server-runner";
import { validateWebRunnerRequest, type WebRunnerRequestBody } from "../../../../server-web-runner-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    matchId: string;
  }>;
}

let activeRun: Promise<unknown> | null = null;

export async function POST(request: Request, context: RouteContext) {
  const { matchId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as WebRunnerRequestBody;
  const validation = validateWebRunnerRequest(request, body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: validation.status });
  }

  if (activeRun) {
    return NextResponse.json({ error: "A local match run is already in progress." }, { status: 409 });
  }

  const runPromise = runPhase15SingleMapFromWeb(matchId);
  activeRun = runPromise;
  try {
    const result = await runPromise;
    return NextResponse.json({
      summary: `DUST2 单图生成完成：${result.status}，比分 ${result.score}，LLM 调用 ${result.llmCalls.count} 次。`,
      result
    });
  } catch (error) {
    return NextResponse.json({ error: sanitizeRunError(error) }, { status: 500 });
  } finally {
    activeRun = null;
  }
}

function sanitizeRunError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/gi, "sk-[redacted]")
    .replace(/(api[_ -]?key["'\s:=]+)([^"',}\s]+)/gi, "$1[redacted]")
    .replace(/(authorization["'\s:=]+)(Bearer\s+)?([^"',}\s]+)/gi, "$1[redacted]");
}
