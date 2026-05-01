import type { Repositories } from "@agent-major/db";
import type { Event, MapGame, Match, Round, RoundReport, Summary, Team, TimelineEvent } from "@agent-major/shared";

export interface RoundReplayItem {
  round: Round;
  roundReport: RoundReport;
  events: Event[];
  timelineEvents: TimelineEvent[];
}

export interface MapReplay {
  match: Match;
  mapGame: MapGame;
  teams: {
    teamA: Team;
    teamB: Team;
  };
  rounds: RoundReplayItem[];
  mapSummary: Summary | null;
  eventCounts: {
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
  const [teamA, teamB, rounds, roundReports, mapEvents, mapTimelineEvents] = await Promise.all([
    required(repositories.teams.getById(match.teamAId), `Team not found: ${match.teamAId}`),
    required(repositories.teams.getById(match.teamBId), `Team not found: ${match.teamBId}`),
    repositories.rounds.listByMapGame(mapGame.id),
    repositories.roundReports.listByMapGame(mapGame.id),
    repositories.events.listByMapGame(mapGame.id),
    repositories.timelineEvents.listByMapGame(mapGame.id)
  ]);

  const reportsByRoundId = new Map(roundReports.map((report) => [report.roundId, report]));
  const eventsByRoundId = groupByRoundId(mapEvents, (event) => event.roundId);
  const timelineByRoundId = groupByRoundId(mapTimelineEvents, (event) => event.roundId);
  const completedRounds = rounds.filter((round) => round.status === "completed" && reportsByRoundId.has(round.id));
  const summary = mapGame.summaryId ? await repositories.summaries.getById(mapGame.summaryId) : await repositories.summaries.getLatestByScope("map", mapGame.id);

  return {
    match,
    mapGame,
    teams: { teamA, teamB },
    rounds: completedRounds.map((round) => ({
      round,
      roundReport: reportsByRoundId.get(round.id) as RoundReport,
      events: eventsByRoundId.get(round.id) ?? [],
      timelineEvents: timelineByRoundId.get(round.id) ?? []
    })),
    mapSummary: summary,
    eventCounts: {
      map: mapEvents.length,
      round: mapEvents.filter((event) => typeof event.roundId === "string").length,
      timeline: mapTimelineEvents.length
    }
  };
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
