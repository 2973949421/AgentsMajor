import type { CoachPostMatchReview, Event, Match, Summary, Team } from "@agent-major/shared";
import { coachPostMatchReviewSchema } from "@agent-major/shared";

import type { Repositories } from "@agent-major/db";

import type { CoachServiceContext, CoachServiceDependencies } from "./coach-timeout-service.js";
import { readUnknownRecord, validateCoachPostMatchReview } from "./coach-validation.js";

export async function readApprovedTeamMemoryOverlay(input: {
  repositories: Repositories;
  teamId: string;
}): Promise<Record<string, unknown> | undefined> {
  const summary = await input.repositories.summaries.getLatestByScope("team", input.teamId);
  if (!summary) {
    return undefined;
  }

  const payload = readUnknownRecord(summary.payload);
  if (!payload || payload.kind !== "coach_post_match_review" || payload.status !== "approved") {
    return undefined;
  }

  return readUnknownRecord(payload.review);
}

export async function generateCoachPostMatchReviewsIfNeeded(input: {
  context: CoachServiceContext;
  dependencies: CoachServiceDependencies;
  match: Match;
}): Promise<void> {
  if (!input.context.useLlmCoachPostMatchReviews) {
    return;
  }

  const [teamA, teamB] = (await Promise.all([
    required(input.context.repositories.teams.getById(input.match.teamAId), `Team not found: ${input.match.teamAId}`),
    required(input.context.repositories.teams.getById(input.match.teamBId), `Team not found: ${input.match.teamBId}`)
  ])) as [Team, Team];
  const mapGames = (await input.context.repositories.mapGames.listByMatch(input.match.id)).sort((left, right) => left.order - right.order);
  const mapSummaries = (
    await Promise.all(mapGames.map((mapGame) => (mapGame.summaryId ? input.context.repositories.summaries.getById(mapGame.summaryId) : null)))
  ).filter((summary): summary is Summary => Boolean(summary));
  const matchSummary = await input.context.repositories.summaries.getLatestByScope("match", input.match.id);
  const matchEvents = await input.context.repositories.events.listByMatch(input.match.id);

  for (const team of [teamA, teamB]) {
    const existingSummary = await input.context.repositories.summaries.getLatestByScope("team", team.id);
    const existingPayload = readUnknownRecord(existingSummary?.payload);
    if (existingPayload?.kind === "coach_post_match_review" && existingPayload.matchId === input.match.id) {
      continue;
    }

    const teamAgents = input.dependencies.sortAgentsForRound(await input.context.repositories.agents.listByTeam(team.id));
    const driverModelId = teamAgents[0]?.driverModelId ?? "";
    if (!driverModelId) {
      continue;
    }

    const response = await input.context.stageRunner.runMatchStructuredStage<CoachPostMatchReview>({
      callId: `llm_${safeId(input.match.id)}_team_${safeId(team.id)}_coach_post_match_review`,
      task: "coach_post_match_review",
      schemaName: "CoachPostMatchReview",
      driverModelId,
      requestInput: {
        objective: "生成一份只服务下一场比赛、且需要人工确认后才会采纳的赛后复盘。",
        matchId: input.match.id,
        teamId: team.id,
        teamName: team.displayName,
        coachContext: input.dependencies.readTeamCoachContext(team),
        initialProposal: input.dependencies.readTeamInitialProposal(team),
        teamMemoryOverlay: await input.dependencies.readApprovedTeamMemoryOverlay(team.id),
        matchSummary: matchSummary?.payload,
        mapSummaries: mapSummaries.map((summary) => summary.payload),
        timeoutUsage: summarizeCoachTimeoutUsage(matchEvents, team.id),
        latestMapResults: mapGames.map((mapGame) => ({
          mapGameId: mapGame.id,
          mapName: mapGame.mapName,
          winnerTeamId: mapGame.winnerTeamId,
          score: {
            teamA: mapGame.teamAScore,
            teamB: mapGame.teamBScore
          }
        }))
      },
      responseFormat: "json_object",
      seed: `coach_post_match_review:${input.match.id}:${team.id}`,
      modelTier: "cheap",
      temperature: 0,
      maxOutputTokens: 2200,
      match: input.match,
      validateResponseData: (data) =>
        validateCoachPostMatchReview({
          review: coachPostMatchReviewSchema.parse(data),
          teamId: team.id,
          matchId: input.match.id
        })
    });

    const createdAt = timestamp();
    const summaryId = `summary_${input.match.id}_${team.id}_coach_post_match_review`;
    const pendingSummary: Summary = {
      id: summaryId,
      summaryType: "team_memory",
      scopeType: "team",
      scopeId: team.id,
      tournamentId: input.match.tournamentId,
      matchId: input.match.id,
      title: `赛后复盘待采纳：${team.displayName}`,
      content: `${team.displayName} 的教练赛后复盘已生成，等待人工确认后再作为下一场补丁。`,
      payload: {
        kind: "coach_post_match_review",
        status: "pending",
        teamId: team.id,
        matchId: input.match.id,
        review: response.data
      },
      sourceEventIds: [],
      createdAt
    };
    await input.context.repositories.summaries.save(pendingSummary);
    await input.context.appendEvent({
      id: `evt_${input.match.id}_${team.id}_coach_post_match_review_created`,
      type: "coach_post_match_review_created",
      category: "runtime_control",
      tournamentId: input.match.tournamentId,
      matchId: input.match.id,
      scopeType: "match",
      scopeId: input.match.id,
      payload: {
        schemaVersion: 1,
        matchId: input.match.id,
        teamId: team.id,
        teamName: team.displayName,
        summaryId,
        status: "pending",
        responseArtifactId: response.responseArtifactId
      },
      createdAt
    });
  }
}

function summarizeCoachTimeoutUsage(events: Event[], teamId: string): {
  totalUsed: number;
  rounds: Array<{ roundId?: string; triggerRoundNumber?: number }>;
} {
  const timeoutEvents = events
    .filter((event) => event.type === "timeout_used")
    .map((event) => ({
      roundId: event.roundId,
      payload: readUnknownRecord(event.payload)
    }))
    .filter((entry) => entry.payload?.teamId === teamId);
  return {
    totalUsed: timeoutEvents.length,
    rounds: timeoutEvents.map((entry) => ({
      ...(entry.roundId ? { roundId: entry.roundId } : {}),
      ...(typeof entry.payload?.triggerRoundNumber === "number" ? { triggerRoundNumber: entry.payload.triggerRoundNumber } : {})
    }))
  };
}

async function required<T>(promise: Promise<T | null>, message: string): Promise<T> {
  const value = await promise;
  if (!value) {
    throw new Error(message);
  }

  return value;
}

function timestamp(): string {
  return new Date().toISOString();
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
