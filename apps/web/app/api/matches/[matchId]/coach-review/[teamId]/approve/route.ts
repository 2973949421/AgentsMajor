import { resolve } from "node:path";

import { createSqliteRepositories, defaultSqlitePath } from "@agent-major/db";

import { findProjectRoot } from "../../../../../../server-project-root";
import { sanitizeRunError } from "../../../../../../server-run-progress";
import { validateWebRunnerAccess, type WebRunnerRequestBody } from "../../../../../../server-web-runner-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    matchId: string;
    teamId: string;
  }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { matchId, teamId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as WebRunnerRequestBody & { action?: unknown };
  const access = validateWebRunnerAccess(request, body);
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }

  const action = body.action === "dismiss" ? "dismiss" : "approve";
  const projectRoot = findProjectRoot(process.cwd());
  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  try {
    const match = await repositories.matches.getById(matchId);
    if (!match) {
      return Response.json({ error: `Match not found: ${matchId}` }, { status: 404 });
    }
    if (teamId !== match.teamAId && teamId !== match.teamBId) {
      return Response.json({ error: `Team ${teamId} does not belong to match ${matchId}.` }, { status: 400 });
    }

    const summary = await repositories.summaries.getLatestByScope("team", teamId);
    const payload = isRecord(summary?.payload) ? summary.payload : null;
    const review = payload && isRecord(payload.review) ? payload.review : null;
    if (!summary || !payload || payload.kind !== "coach_post_match_review" || payload.matchId !== matchId || !review) {
      return Response.json({ error: "No pending coach post-match review was found for this team and match." }, { status: 404 });
    }

    const nextStatus = action === "approve" ? "approved" : "dismissed";
    const now = new Date().toISOString();
    const updatedSummary = {
      ...summary,
      payload: {
        ...payload,
        status: nextStatus
      },
      updatedAt: now
    };

    await repositories.transaction(async () => {
      await repositories.summaries.save(updatedSummary);
      await repositories.events.append(await buildCoachReviewEvent(repositories, {
        match,
        teamId,
        summaryId: summary.id,
        previousStatus: typeof payload.status === "string" ? payload.status : "pending",
        nextStatus,
        createdAt: now
      }));
    });

    return Response.json(
      {
        summary: action === "approve" ? "已采纳这份赛后复盘补丁，下一场可作为增量输入。" : "已标记为暂不采纳，这份复盘不会自动进入下一场输入。",
        review: {
          teamId,
          status: nextStatus,
          review,
          updatedAt: now
        }
      },
      { status: 200 }
    );
  } catch (error) {
    return Response.json({ error: sanitizeRunError(error) }, { status: 500 });
  } finally {
    repositories.close();
  }
}

async function buildCoachReviewEvent(
  repositories: ReturnType<typeof createSqliteRepositories>,
  input: {
    match: { id: string; tournamentId: string };
    teamId: string;
    summaryId: string;
    previousStatus: string;
    nextStatus: "approved" | "dismissed";
    createdAt: string;
  }
): Promise<{
  id: string;
  type: "coach_post_match_review_approved" | "coach_post_match_review_dismissed";
  category: "runtime_control";
  tournamentId: string;
  matchId: string;
  payload: {
    schemaVersion: 1;
    teamId: string;
    summaryId: string;
    previousStatus: string;
    nextStatus: "approved" | "dismissed";
  };
  globalSequence: number;
  scopeType: "match";
  scopeId: string;
  sequenceInScope: number;
  sourceModule: string;
  createdAt: string;
}> {
  const globalSequence = (await repositories.events.getMaxGlobalSequence()) + 1;
  const sequenceInScope = (await repositories.events.getMaxSequenceInScope("match", input.match.id)) + 1;
  return {
    id: `evt_${input.match.id}_${input.teamId}_coach_review_${input.nextStatus}`,
    type: input.nextStatus === "approved" ? "coach_post_match_review_approved" : "coach_post_match_review_dismissed",
    category: "runtime_control",
    tournamentId: input.match.tournamentId,
    matchId: input.match.id,
    payload: {
      schemaVersion: 1,
      teamId: input.teamId,
      summaryId: input.summaryId,
      previousStatus: input.previousStatus,
      nextStatus: input.nextStatus
    },
    globalSequence,
    scopeType: "match",
    scopeId: input.match.id,
    sequenceInScope,
    sourceModule: "web_coach_review_ops",
    createdAt: input.createdAt
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
