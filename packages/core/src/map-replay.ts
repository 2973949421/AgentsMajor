import type { Repositories } from "@agent-major/db";
import type { Agent, AgentRoleProfile, Event, MapGame, Match, Round, RoundReport, Summary, Team, TimelineEvent } from "@agent-major/shared";

export interface RoundReplayItem {
  round: Round;
  roundReport: RoundReport;
  events: Event[];
  timelineEvents: TimelineEvent[];
}

export interface ReplayAgentIdentity {
  id: string;
  teamId: string;
  displayName: string;
  role: Agent["role"];
  secondaryRoles: NonNullable<Agent["secondaryRoles"]>;
  roleResponsibilities: NonNullable<AgentRoleProfile["agentMajorResponsibilities"]>;
  aliases: string[];
  materialRef?: {
    entityId: string;
    entityType: "player" | "coach";
    teamSlug: string;
    runtimeEnabled: false;
  };
}

export interface MapReplay {
  match: Match;
  mapGame: MapGame;
  teams: {
    teamA: Team;
    teamB: Team;
  };
  agentsById: Record<string, ReplayAgentIdentity>;
  rounds: RoundReplayItem[];
  timeoutsRemainingByTeam: Record<string, number>;
  mapSummary: Summary | null;
  eventCounts: {
    map: number;
    round: number;
    timeline: number;
  };
}

export interface MatchReplay {
  match: Match;
  teams: {
    teamA: Team;
    teamB: Team;
  };
  agentsById: Record<string, ReplayAgentIdentity>;
  mapGames: MapGame[];
  maps: MapReplay[];
  postMatchReviews: Array<{
    teamId: string;
    status: string;
    review: Record<string, unknown>;
    updatedAt?: string;
  }>;
  matchSummary: Summary | null;
  eventCounts: {
    match: number;
    map: number;
    round: number;
    timeline: number;
  };
}

export async function readMapReplay(repositories: Repositories, mapGameId: string): Promise<MapReplay | null> {
  const mapGame = await repositories.mapGames.getById(mapGameId);
  if (!mapGame) {
    return null;
  }

  const match = await required(repositories.matches.getById(mapGame.matchId), `Match not found: ${mapGame.matchId}`);
  const [teamA, teamB, agents, rounds, roundReports, mapEvents, mapTimelineEvents, coachStates] = (await Promise.all([
    required(repositories.teams.getById(match.teamAId), `Team not found: ${match.teamAId}`),
    required(repositories.teams.getById(match.teamBId), `Team not found: ${match.teamBId}`),
    repositories.agents.listByTeamIds([match.teamAId, match.teamBId]),
    repositories.rounds.listByMapGame(mapGame.id),
    repositories.roundReports.listByMapGame(mapGame.id),
    repositories.events.listByMapGame(mapGame.id),
    repositories.timelineEvents.listByMapGame(mapGame.id),
    repositories.teamMapCoachStates.listByMapGame(mapGame.id)
  ])) as [Team, Team, Agent[], Round[], RoundReport[], Event[], TimelineEvent[], Array<{ teamId: string; timeoutsRemaining: number }>];

  const reportsByRoundId = new Map(roundReports.map((report) => [report.roundId, report]));
  const eventsByRoundId = groupByRoundId(mapEvents, (event) => event.roundId);
  const timelineByRoundId = groupByRoundId(mapTimelineEvents, (event) => event.roundId);
  const completedRounds = rounds.filter((round) => round.status === "completed" && reportsByRoundId.has(round.id));
  const summary = mapGame.summaryId ? await repositories.summaries.getById(mapGame.summaryId) : await repositories.summaries.getLatestByScope("map", mapGame.id);

  return {
    match,
    mapGame,
    teams: { teamA, teamB },
    agentsById: buildAgentsById(agents),
    rounds: completedRounds.map((round) => ({
      round,
      roundReport: reportsByRoundId.get(round.id) as RoundReport,
      events: eventsByRoundId.get(round.id) ?? [],
      timelineEvents: timelineByRoundId.get(round.id) ?? []
    })),
    timeoutsRemainingByTeam: Object.fromEntries(coachStates.map((state) => [state.teamId, state.timeoutsRemaining])),
    mapSummary: summary,
    eventCounts: {
      map: mapEvents.length,
      round: mapEvents.filter((event) => typeof event.roundId === "string").length,
      timeline: mapTimelineEvents.length
    }
  };
}

export async function readMatchReplay(repositories: Repositories, matchId: string): Promise<MatchReplay | null> {
  const match = await repositories.matches.getById(matchId);
  if (!match) {
    return null;
  }

  const [teamA, teamB, agents, mapGames, matchEvents, teamASummary, teamBSummary] = (await Promise.all([
    required(repositories.teams.getById(match.teamAId), `Team not found: ${match.teamAId}`),
    required(repositories.teams.getById(match.teamBId), `Team not found: ${match.teamBId}`),
    repositories.agents.listByTeamIds([match.teamAId, match.teamBId]),
    repositories.mapGames.listByMatch(match.id),
    repositories.events.listByMatch(match.id),
    repositories.summaries.getLatestByScope("team", match.teamAId),
    repositories.summaries.getLatestByScope("team", match.teamBId)
  ])) as [Team, Team, Agent[], MapGame[], Event[], Summary | null, Summary | null];
  const maps = (
    await Promise.all(
      [...mapGames]
        .sort((left, right) => left.order - right.order)
        .filter((mapGame) => mapGame.status === "completed" || mapGame.currentRoundNumber > 0)
        .map((mapGame) => readMapReplay(repositories, mapGame.id))
    )
  ).filter((mapReplay): mapReplay is MapReplay => mapReplay !== null);
  const matchSummary = await repositories.summaries.getLatestByScope("match", match.id);

  return {
    match,
    teams: { teamA, teamB },
    agentsById: buildAgentsById(agents),
    mapGames,
    maps,
    postMatchReviews: [teamASummary, teamBSummary]
      .map((summary) => toPostMatchReview(summary, match.id))
      .filter((review): review is NonNullable<MatchReplay["postMatchReviews"][number]> => review !== null),
    matchSummary,
    eventCounts: {
      match: matchEvents.length,
      map: maps.reduce((sum, mapReplay) => sum + mapReplay.eventCounts.map, 0),
      round: maps.reduce((sum, mapReplay) => sum + mapReplay.eventCounts.round, 0),
      timeline: maps.reduce((sum, mapReplay) => sum + mapReplay.eventCounts.timeline, 0)
    }
  };
}

function toPostMatchReview(summary: Summary | null, matchId: string) {
  if (!summary) {
    return null;
  }

  const payload = isRecord(summary.payload) ? summary.payload : null;
  const review = payload && isRecord(payload.review) ? payload.review : null;
  if (!payload || payload.kind !== "coach_post_match_review" || payload.matchId !== matchId || !review) {
    return null;
  }

  return {
    teamId: summary.scopeId,
    status: typeof payload.status === "string" ? payload.status : "pending",
    review,
    ...(summary.updatedAt ? { updatedAt: summary.updatedAt } : {})
  };
}

function buildAgentsById(agents: Agent[]): Record<string, ReplayAgentIdentity> {
  return Object.fromEntries(
    agents.map((agent) => [
      agent.id,
      {
        id: agent.id,
        teamId: agent.teamId,
        displayName: agent.displayName,
        role: agent.role,
        secondaryRoles: agent.secondaryRoles ?? [],
        roleResponsibilities: agent.roleProfile?.agentMajorResponsibilities ?? [],
        aliases: agent.materialRef?.aliases ?? [],
        ...(agent.materialRef
          ? {
              materialRef: {
                entityId: agent.materialRef.entityId,
                entityType: agent.materialRef.entityType,
                teamSlug: agent.materialRef.teamSlug,
                runtimeEnabled: agent.materialRef.runtimeEnabled
              }
            }
          : {})
      }
    ])
  );
}

function groupByRoundId<T>(items: T[], getRoundId: (item: T) => string | undefined): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const roundId = getRoundId(item);
    if (!roundId) {
      continue;
    }

    grouped.set(roundId, [...(grouped.get(roundId) ?? []), item]);
  }

  return grouped;
}

async function required<T>(promise: Promise<T | null>, message: string): Promise<T> {
  const value = await promise;
  if (!value) {
    throw new Error(message);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
