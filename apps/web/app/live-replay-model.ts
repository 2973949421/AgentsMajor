import type { MatchReplay, RoundReplayItem } from "@agent-major/core";

type SourceTimelineEvent = RoundReplayItem["timelineEvents"][number];
type SourceRoundReport = RoundReplayItem["roundReport"];

export type ScorePair = SourceRoundReport["scoreBeforeRound"];

export const SPEED_OPTIONS = ["1x", "1.5x", "2x", "instant"] as const;
export type PlaybackSpeed = (typeof SPEED_OPTIONS)[number];
export type PlayerStatus = "idle" | "playing" | "paused" | "completed";

export const ROUND_TRANSITION_MS = 2500;
export const EMPTY_ROUND_DURATION_MS = 15000;

const GENERIC_HIGHLIGHT_TAGS = new Set(["phase11_demo", "phase12_demo", "team_a_round", "team_b_round"]);

export interface LiveReplayTeam {
  id: string;
  displayName: string;
  shortName: string;
}

export interface LiveReplayData {
  matchId: string;
  teams: {
    teamA: LiveReplayTeam;
    teamB: LiveReplayTeam;
  };
  maps: LiveReplayMap[];
}

export interface LiveReplayMap {
  id: string;
  order: number;
  mapName: string;
  finalScore: ScorePair;
  winnerTeamId?: string;
  keyRoundNumbers: number[];
  rounds: LiveReplayRound[];
}

export interface LiveReplayRound {
  id: string;
  roundNumber: number;
  roundReport: LiveReplayRoundReport;
  timelineEvents: LiveReplayTimelineEvent[];
}

export interface LiveReplayRoundReport {
  winnerTeamId: string;
  scoreBeforeRound: ScorePair;
  scoreAfterRound: ScorePair;
  keyEvents: LiveRoundKeyEvent[];
  economyDelta: {
    agents: EconomyRow[];
    teamTotals: {
      teamA: number;
      teamB: number;
    };
  };
  highlightTags: string[];
  summary: string;
}

export interface LiveReplayTimelineEvent {
  id: string;
  atMs: number;
  durationMs?: number;
  kind: SourceTimelineEvent["kind"];
  payload: unknown;
  roundId?: string;
  sourceEventIds?: string[];
  sequenceIndex: number;
}

export interface LiveRoundKeyEvent {
  id: string;
  type: string;
  actorTeamId: string;
  zoneId: string;
  impact: string;
}

export interface KillFeedEntry {
  id: string;
  atMs: number;
  text: string;
  actorAgentId?: string;
  targetAgentId?: string;
  zoneId?: string;
  keyEventId?: string;
}

export interface EconomyRow {
  agentId: string;
  teamId: string;
  beforeTokenBank: number;
  spent: number;
  reward: number;
  afterTokenBank: number;
  buyType: string;
  lossStreak: number;
}

export interface VirtualZone {
  id: string;
  name: string;
  actorTeamId: string;
  impact: string;
  type: string;
  active: boolean;
}

export interface LiveRoundFrame {
  roundDurationMs: number;
  progress: number;
  visibleEvents: LiveReplayTimelineEvent[];
  currentScore: ScorePair;
  economyVisible: boolean;
  economyRows: EconomyRow[];
  killFeed: KillFeedEntry[];
  casterLine: string | null;
  highlightTags: string[];
  highlightMvpAgentId: string | null;
  resultWinnerTeamId: string | null;
  zones: VirtualZone[];
}

export function toLiveReplayData(replay: MatchReplay): LiveReplayData {
  return {
    matchId: replay.match.id,
    teams: {
      teamA: toLiveTeam(replay.teams.teamA),
      teamB: toLiveTeam(replay.teams.teamB)
    },
    maps: [...replay.maps]
      .sort((left, right) => left.mapGame.order - right.mapGame.order)
      .map((mapReplay) => {
        const winnerTeamId = mapReplay.mapGame.winnerTeamId;
        return {
          id: mapReplay.mapGame.id,
          order: mapReplay.mapGame.order,
          mapName: mapReplay.mapGame.mapName,
          finalScore: {
            teamA: mapReplay.mapGame.teamAScore,
            teamB: mapReplay.mapGame.teamBScore
          },
          ...(winnerTeamId ? { winnerTeamId } : {}),
          keyRoundNumbers: readKeyRoundNumbers(mapReplay.mapSummary?.payload),
          rounds: [...mapReplay.rounds]
            .sort((left, right) => left.round.roundNumber - right.round.roundNumber)
            .map(toLiveRound)
        };
      })
  };
}

export function sortRounds(rounds: LiveReplayRound[]): LiveReplayRound[] {
  return [...rounds].sort((left, right) => left.roundNumber - right.roundNumber);
}

export function sortTimelineEvents(events: LiveReplayTimelineEvent[]): LiveReplayTimelineEvent[] {
  return [...events].sort((left, right) => {
    if (left.atMs !== right.atMs) {
      return left.atMs - right.atMs;
    }
    if (left.sequenceIndex !== right.sequenceIndex) {
      return left.sequenceIndex - right.sequenceIndex;
    }
    return left.id.localeCompare(right.id);
  });
}

export function getRoundDurationMs(roundItem: LiveReplayRound): number {
  const duration = roundItem.timelineEvents.reduce((maxMs, event) => Math.max(maxMs, event.atMs + (event.durationMs ?? 0)), 0);
  return duration > 0 ? duration : EMPTY_ROUND_DURATION_MS;
}

export function getVisibleTimelineEvents(events: LiveReplayTimelineEvent[], currentAtMs: number): LiveReplayTimelineEvent[] {
  return sortTimelineEvents(events).filter((event) => event.atMs <= currentAtMs);
}

export function getSpeedMultiplier(speed: PlaybackSpeed): number {
  switch (speed) {
    case "1.5x":
      return 1.5;
    case "2x":
      return 2;
    case "instant":
      return 999;
    case "1x":
    default:
      return 1;
  }
}

export function buildRoundFrame(roundItem: LiveReplayRound, currentAtMs: number): LiveRoundFrame {
  const roundDurationMs = getRoundDurationMs(roundItem);
  const visibleEvents = getVisibleTimelineEvents(roundItem.timelineEvents, currentAtMs);
  const scoreFromTimeline = findLatestScore(visibleEvents);
  const killFeed = buildKillFeed(visibleEvents);
  const highlightEvent = findLatestByKind(visibleEvents, "highlight_reveal");
  const resultEvent = findLatestByKind(visibleEvents, "round_result");
  const economyVisible = visibleEvents.some((event) => event.kind === "economy_panel_update");

  return {
    roundDurationMs,
    progress: roundDurationMs > 0 ? clamp(currentAtMs / roundDurationMs, 0, 1) : 0,
    visibleEvents,
    currentScore: scoreFromTimeline ?? roundItem.roundReport.scoreBeforeRound,
    economyVisible,
    economyRows: economyVisible ? roundItem.roundReport.economyDelta.agents : [],
    killFeed,
    casterLine: readTextPayload(findLatestByKind(visibleEvents, "caster_line")),
    highlightTags: readStringArray(asRecord(highlightEvent?.payload)?.tags),
    highlightMvpAgentId: readOptionalString(asRecord(highlightEvent?.payload)?.mvpAgentId) ?? null,
    resultWinnerTeamId: readOptionalString(asRecord(resultEvent?.payload)?.winnerTeamId) ?? null,
    zones: buildVirtualZones(roundItem, killFeed)
  };
}

export function findNextHighlightRoundIndex(mapReplay: LiveReplayMap, startIndex = 0): number | null {
  const rounds = sortRounds(mapReplay.rounds);
  if (rounds.length === 0) {
    return null;
  }

  const normalizedStart = clamp(Math.floor(startIndex), 0, rounds.length - 1);
  for (let index = normalizedStart + 1; index < rounds.length; index += 1) {
    if (isHighlightRound(mapReplay, rounds[index])) {
      return index;
    }
  }
  for (let index = 0; index <= normalizedStart; index += 1) {
    if (isHighlightRound(mapReplay, rounds[index])) {
      return index;
    }
  }
  return null;
}

export function getNextRoundIndex(mapReplay: LiveReplayMap, currentIndex: number): number | null {
  const rounds = sortRounds(mapReplay.rounds);
  const nextIndex = currentIndex + 1;
  return nextIndex < rounds.length ? nextIndex : null;
}

export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function getEventText(event: LiveReplayTimelineEvent): string {
  const payload = asRecord(event.payload);
  return readOptionalString(payload?.text) ?? readOptionalString(payload?.summary) ?? event.kind;
}

function toLiveTeam(team: MatchReplay["teams"]["teamA"]): LiveReplayTeam {
  return {
    id: team.id,
    displayName: team.displayName,
    shortName: team.shortName
  };
}

function toLiveRound(item: RoundReplayItem): LiveReplayRound {
  return {
    id: item.round.id,
    roundNumber: item.round.roundNumber,
    roundReport: {
      winnerTeamId: item.roundReport.winnerTeamId,
      scoreBeforeRound: item.roundReport.scoreBeforeRound,
      scoreAfterRound: item.roundReport.scoreAfterRound,
      keyEvents: item.roundReport.keyEvents.map((event) => ({
        id: event.id,
        type: event.type,
        actorTeamId: event.actorTeamId,
        zoneId: event.zoneId,
        impact: event.impact
      })),
      economyDelta: {
        agents: item.roundReport.economyDelta.agents.map(toEconomyRow),
        teamTotals: item.roundReport.economyDelta.teamTotals
      },
      highlightTags: item.roundReport.highlightTags ?? [],
      summary: item.roundReport.summary
    },
    timelineEvents: sortTimelineEvents(item.timelineEvents.map(toLiveTimelineEvent))
  };
}

function toLiveTimelineEvent(event: SourceTimelineEvent): LiveReplayTimelineEvent {
  return {
    id: event.id,
    atMs: event.atMs,
    ...(typeof event.durationMs === "number" ? { durationMs: event.durationMs } : {}),
    kind: event.kind,
    payload: event.payload,
    ...(event.roundId ? { roundId: event.roundId } : {}),
    ...(event.sourceEventIds.length > 0 ? { sourceEventIds: event.sourceEventIds } : {}),
    sequenceIndex: event.sequenceIndex
  };
}

function findLatestByKind(
  events: LiveReplayTimelineEvent[],
  kind: LiveReplayTimelineEvent["kind"]
): LiveReplayTimelineEvent | undefined {
  return [...events].reverse().find((event) => event.kind === kind);
}

function findLatestScore(events: LiveReplayTimelineEvent[]): ScorePair | null {
  for (const event of [...events].reverse()) {
    if (event.kind !== "round_result") {
      continue;
    }

    const score = readScorePair(asRecord(event.payload)?.scoreAfterRound);
    if (score) {
      return score;
    }
  }
  return null;
}

function buildKillFeed(events: LiveReplayTimelineEvent[]): KillFeedEntry[] {
  return events
    .filter((event) => event.kind === "kill_feed_item")
    .map((event) => {
      const payload = asRecord(event.payload);
      const actorAgentId = readOptionalString(payload?.actorAgentId);
      const targetAgentId = readOptionalString(payload?.targetAgentId);
      const zoneId = readOptionalString(payload?.zoneId);
      const keyEventId = readOptionalString(payload?.keyEventId);
      return {
        id: event.id,
        atMs: event.atMs,
        text: readOptionalString(payload?.text) ?? "关键事件已触发",
        ...(actorAgentId ? { actorAgentId } : {}),
        ...(targetAgentId ? { targetAgentId } : {}),
        ...(zoneId ? { zoneId } : {}),
        ...(keyEventId ? { keyEventId } : {})
      };
    });
}

function buildVirtualZones(roundItem: LiveReplayRound, killFeed: KillFeedEntry[]): VirtualZone[] {
  const visibleKeyEventIds = new Set(killFeed.map((entry) => entry.keyEventId).filter((id): id is string => typeof id === "string"));
  return roundItem.roundReport.keyEvents.map((event) => ({
    id: event.zoneId,
    name: formatZoneName(event.zoneId),
    actorTeamId: event.actorTeamId,
    impact: event.impact,
    type: event.type,
    active: visibleKeyEventIds.has(event.id)
  }));
}

function isHighlightRound(mapReplay: LiveReplayMap, roundItem: LiveReplayRound | undefined): boolean {
  if (!roundItem) {
    return false;
  }

  if (mapReplay.keyRoundNumbers.includes(roundItem.roundNumber)) {
    return true;
  }

  if (hasSemanticHighlightTags(roundItem.roundReport.highlightTags)) {
    return true;
  }

  return roundItem.timelineEvents.some((event) => {
    if (event.kind !== "highlight_reveal") {
      return false;
    }
    return hasSemanticHighlightTags(readStringArray(asRecord(event.payload)?.tags));
  });
}

function hasSemanticHighlightTags(tags: string[]): boolean {
  return tags.some((tag) => !GENERIC_HIGHLIGHT_TAGS.has(tag));
}

function readTextPayload(event: LiveReplayTimelineEvent | undefined): string | null {
  const payload = asRecord(event?.payload);
  return readOptionalString(payload?.text) ?? readOptionalString(payload?.line) ?? null;
}

function readScorePair(value: unknown): ScorePair | null {
  const record = asRecord(value);
  if (typeof record?.teamA === "number" && typeof record.teamB === "number") {
    return { teamA: record.teamA, teamB: record.teamB };
  }
  return null;
}

function readKeyRoundNumbers(value: unknown): number[] {
  const keyRounds = asRecord(value)?.keyRounds;
  if (!Array.isArray(keyRounds)) {
    return [];
  }

  return [
    ...new Set(
      keyRounds
        .map((item) => asRecord(item)?.roundNumber)
        .filter((roundNumber): roundNumber is number => typeof roundNumber === "number" && Number.isInteger(roundNumber) && roundNumber > 0)
    )
  ].sort((left, right) => left - right);
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toEconomyRow(row: SourceRoundReport["economyDelta"]["agents"][number]): EconomyRow {
  return {
    agentId: row.agentId,
    teamId: row.teamId,
    beforeTokenBank: row.beforeTokenBank,
    spent: row.spent,
    reward: row.reward,
    afterTokenBank: row.afterTokenBank,
    buyType: row.buyType,
    lossStreak: row.lossStreak
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function formatZoneName(zoneId: string): string {
  return zoneId
    .split("_")
    .map((part) => (part.length > 0 ? `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}` : part))
    .join(" ");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
