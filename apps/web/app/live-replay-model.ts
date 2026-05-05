import { getTacticalMapLayout, resolveTacticalZone } from "@agent-major/core";
import type { MapReplay, MatchReplay, RoundReplayItem, TacticalMapLayout, TacticalPathType, TacticalZoneRole } from "@agent-major/core";

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
  coachDisplayName?: string;
  coachDutySummary?: string;
}

export interface LiveReplayData {
  matchId: string;
  teams: {
    teamA: LiveReplayTeam;
    teamB: LiveReplayTeam;
  };
  agentsById: Record<string, LiveReplayAgent>;
  maps: LiveReplayMap[];
}

export interface LiveReplayAgent {
  id: string;
  teamId: string;
  displayName: string;
  role: string;
  secondaryRoles: string[];
  roleResponsibilities: string[];
  aliases: string[];
}

export interface LiveReplayMap {
  id: string;
  order: number;
  mapName: string;
  tacticalMap: LiveTacticalMapLayout;
  finalScore: ScorePair;
  winnerTeamId?: string;
  keyRoundNumbers: number[];
  rounds: LiveReplayRound[];
}

export interface LiveReplayRound {
  id: string;
  roundNumber: number;
  agentsById: Record<string, LiveReplayAgent>;
  roundReport: LiveReplayRoundReport;
  tacticalRound?: LiveTacticalRound;
  timelineEvents: LiveReplayTimelineEvent[];
}

export interface LiveReplayRoundReport {
  mapName: string;
  winnerTeamId: string;
  scoreBeforeRound: ScorePair;
  scoreAfterRound: ScorePair;
  judgeResult: LiveJudgeResult;
  agentOutputs: LiveAgentOutput[];
  llmTeamPlans?: Record<string, LiveTeamPlan>;
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

export type LiveJudgeResult = SourceRoundReport["judgeResult"];
export type LiveAgentOutput = SourceRoundReport["agentOutputs"][number];
export type LiveTeamPlan = NonNullable<SourceRoundReport["llmTeamPlans"]>[string];

export interface LiveReplayTimelineEvent {
  id: string;
  atMs: number;
  durationMs?: number;
  kind: SourceTimelineEvent["kind"];
  payload: unknown;
  roundId?: string;
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
  actorName?: string;
  actorRole?: string;
  targetName?: string;
  zoneId?: string;
  keyEventId?: string;
}

export interface EconomyRow {
  agentId: string;
  teamId: string;
  displayName: string;
  role: string;
  aliases: string[];
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

export interface LiveTacticalMapLayout {
  mapName: TacticalMapLayout["mapName"];
  canvas: TacticalMapLayout["canvas"];
  fallbackZoneId: string;
  zones: LiveTacticalLayoutZone[];
  connections: LiveTacticalConnection[];
}

export interface LiveTacticalLayoutZone {
  id: string;
  displayName: string;
  role: TacticalZoneRole;
  position: {
    x: number;
    y: number;
  };
  radius: number;
}

export interface LiveTacticalConnection {
  fromZoneId: string;
  toZoneId: string;
  pathType: TacticalPathType;
}

export interface LiveTacticalMapFrame extends LiveTacticalMapLayout {
  zones: LiveTacticalZoneFrame[];
  connections: LiveTacticalConnectionFrame[];
}

export interface LiveTacticalZoneFrame extends LiveTacticalLayoutZone {
  active: boolean;
  weak: boolean;
  requestedZoneId?: string;
  actorTeamId?: string;
  impact?: string;
  eventType?: string;
  badge?: string;
}

export interface LiveTacticalConnectionFrame extends LiveTacticalConnection {
  active: boolean;
  from: {
    x: number;
    y: number;
  };
  to: {
    x: number;
    y: number;
  };
}

export interface LiveBarrageMessage {
  id: string;
  atMs: number;
  text: string;
  intensity: "low" | "medium" | "high";
}

export interface LiveSupportRate {
  teamA: number;
  teamB: number;
  leaderTeamId: string;
  trend: string;
  label: string;
}

export interface LiveReplayCard {
  title: string;
  summary: string;
  highlightTags: string[];
  jumpTarget: {
    type: "highlight_reveal";
    roundId: string;
    atMs: number;
  };
}

export type LiveTacticalRound = NonNullable<SourceRoundReport["tacticalContext"]>;

export interface LiveRoundFrame {
  roundDurationMs: number;
  progress: number;
  visibleEvents: LiveReplayTimelineEvent[];
  currentScore: ScorePair;
  economyVisible: boolean;
  economyRows: EconomyRow[];
  killFeed: KillFeedEntry[];
  casterLine: string | null;
  barrageMessages: LiveBarrageMessage[];
  supportRate: LiveSupportRate | null;
  highlightTags: string[];
  highlightMvpAgentId: string | null;
  highlightMvpName: string | null;
  replayCard: LiveReplayCard | null;
  resultWinnerTeamId: string | null;
  roundSummary: string | null;
  tacticalRound: LiveTacticalRound | null;
  tacticalMap: LiveTacticalMapFrame;
  zones: VirtualZone[];
}

export function toLiveReplayData(replay: MatchReplay): LiveReplayData {
  const agentsById = toLiveAgentsById(replay.agentsById);
  return {
    matchId: replay.match.id,
    teams: {
      teamA: toLiveTeam(replay.teams.teamA),
      teamB: toLiveTeam(replay.teams.teamB)
    },
    agentsById,
    maps: [...replay.maps]
      .sort((left, right) => left.mapGame.order - right.mapGame.order)
      .map((mapReplay) => toLiveMapReplay(mapReplay, agentsById))
  };
}

export function toLiveMapReplayData(replay: MapReplay): LiveReplayMap {
  return toLiveMapReplay(replay, toLiveAgentsById(replay.agentsById));
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
  const killFeed = buildKillFeed(visibleEvents, roundItem.agentsById);
  const highlightEvent = findLatestByKind(visibleEvents, "highlight_reveal");
  const highlightMvpAgentId = readOptionalString(asRecord(highlightEvent?.payload)?.mvpAgentId) ?? null;
  const resultEvent = findLatestByKind(visibleEvents, "round_result");
  const economyVisible = visibleEvents.some((event) => event.kind === "economy_panel_update");
  const tacticalMap = buildTacticalMapFrame(roundItem, killFeed, visibleEvents);

  return {
    roundDurationMs,
    progress: roundDurationMs > 0 ? clamp(currentAtMs / roundDurationMs, 0, 1) : 0,
    visibleEvents,
    currentScore: scoreFromTimeline ?? roundItem.roundReport.scoreBeforeRound,
    economyVisible,
    economyRows: economyVisible ? roundItem.roundReport.economyDelta.agents : [],
    killFeed,
    casterLine: readTextPayload(findLatestByKind(visibleEvents, "caster_line")),
    barrageMessages: buildBarrageMessages(visibleEvents),
    supportRate: readSupportRate(visibleEvents),
    highlightTags: readStringArray(asRecord(highlightEvent?.payload)?.tags),
    highlightMvpAgentId,
    highlightMvpName: highlightMvpAgentId ? roundItem.agentsById[highlightMvpAgentId]?.displayName ?? null : null,
    replayCard: readReplayCard(asRecord(highlightEvent?.payload)?.replayCard),
    resultWinnerTeamId: readOptionalString(asRecord(resultEvent?.payload)?.winnerTeamId) ?? null,
    roundSummary: resultEvent ? roundItem.roundReport.summary : null,
    tacticalRound: roundItem.tacticalRound ?? null,
    tacticalMap,
    zones: tacticalMap.zones.map((zone) => ({
      id: zone.id,
      name: zone.displayName,
      actorTeamId: zone.actorTeamId ?? "",
      impact: zone.impact ?? "",
      type: zone.eventType ?? zone.role,
      active: zone.active
    }))
  };
}

export function findNextHighlightRoundIndex(mapReplay: LiveReplayMap, startIndex = 0): number | null {
  const rounds = sortRounds(mapReplay.rounds);
  if (rounds.length === 0) {
    return null;
  }

  const normalizedStart = clamp(Math.floor(startIndex), 0, rounds.length - 1);
  for (let index = normalizedStart + 1; index < rounds.length; index += 1) {
    const round = rounds[index];
    if (round && isHighlightRound(mapReplay, round)) {
      return index;
    }
  }
  for (let index = 0; index <= normalizedStart; index += 1) {
    const round = rounds[index];
    if (round && isHighlightRound(mapReplay, round)) {
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
  const source = asRecord(team.source);
  const headCoachProfile = asRecord(source?.headCoachProfile);
  const coachDisplayName = readOptionalString(headCoachProfile?.displayName);
  const coachDutySummary = readOptionalString(headCoachProfile?.dutySummary);
  return {
    id: team.id,
    displayName: team.displayName,
    shortName: team.shortName,
    ...(coachDisplayName ? { coachDisplayName } : {}),
    ...(coachDutySummary ? { coachDutySummary } : {})
  };
}

function toLiveMapReplay(mapReplay: MapReplay, agentsById: Record<string, LiveReplayAgent>): LiveReplayMap {
  const winnerTeamId = mapReplay.mapGame.winnerTeamId;
  return {
    id: mapReplay.mapGame.id,
    order: mapReplay.mapGame.order,
    mapName: mapReplay.mapGame.mapName,
    tacticalMap: toLiveTacticalMapLayout(getTacticalMapLayout(mapReplay.mapGame.mapName)),
    finalScore: {
      teamA: mapReplay.mapGame.teamAScore,
      teamB: mapReplay.mapGame.teamBScore
    },
    ...(winnerTeamId ? { winnerTeamId } : {}),
    keyRoundNumbers: readKeyRoundNumbers(mapReplay.mapSummary?.payload),
    rounds: [...mapReplay.rounds]
      .sort((left, right) => left.round.roundNumber - right.round.roundNumber)
      .map((round) => toLiveRound(round, agentsById))
  };
}

function toLiveAgentsById(agentsById: MatchReplay["agentsById"] | null | undefined): Record<string, LiveReplayAgent> {
  return Object.fromEntries(
    Object.entries(agentsById ?? {}).map(([id, agent]) => [
      id,
      {
        id: agent.id,
        teamId: agent.teamId,
        displayName: agent.displayName,
        role: agent.role,
        secondaryRoles: agent.secondaryRoles ?? [],
        roleResponsibilities: agent.roleResponsibilities ?? [],
        aliases: agent.aliases ?? []
      }
    ])
  );
}

function toLiveRound(item: RoundReplayItem, agentsById: Record<string, LiveReplayAgent>): LiveReplayRound {
  return {
    id: item.round.id,
    roundNumber: item.round.roundNumber,
    agentsById,
    roundReport: {
      mapName: item.roundReport.mapName,
      winnerTeamId: item.roundReport.winnerTeamId,
      scoreBeforeRound: item.roundReport.scoreBeforeRound,
      scoreAfterRound: item.roundReport.scoreAfterRound,
      judgeResult: item.roundReport.judgeResult,
      agentOutputs: item.roundReport.agentOutputs,
      ...(item.roundReport.llmTeamPlans ? { llmTeamPlans: item.roundReport.llmTeamPlans } : {}),
      keyEvents: item.roundReport.keyEvents.map((event: LiveReplayRound["roundReport"]["keyEvents"][number]) => ({
        id: event.id,
        type: event.type,
        actorTeamId: event.actorTeamId,
        zoneId: event.zoneId,
        impact: event.impact
      })),
      economyDelta: {
        agents: item.roundReport.economyDelta.agents.map((row) => toEconomyRow(row, agentsById)),
        teamTotals: item.roundReport.economyDelta.teamTotals
      },
      highlightTags: item.roundReport.highlightTags ?? [],
      summary: item.roundReport.summary
    },
    ...(item.roundReport.tacticalContext ? { tacticalRound: item.roundReport.tacticalContext } : {}),
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
    sequenceIndex: event.sequenceIndex
  };
}

function toLiveTacticalMapLayout(layout: TacticalMapLayout): LiveTacticalMapLayout {
  return {
    mapName: layout.mapName,
    canvas: layout.canvas,
    fallbackZoneId: layout.fallbackZoneId,
    zones: layout.zones.map((zone) => ({
      id: zone.zoneId,
      displayName: zone.displayName,
      role: zone.role,
      position: zone.position,
      radius: zone.radius
    })),
    connections: layout.connections.map((connection) => ({
      fromZoneId: connection.fromZoneId,
      toZoneId: connection.toZoneId,
      pathType: connection.pathType
    }))
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

function buildKillFeed(events: LiveReplayTimelineEvent[], agentsById: Record<string, LiveReplayAgent>): KillFeedEntry[] {
  return events
    .filter((event) => event.kind === "kill_feed_item")
    .map((event) => {
      const payload = asRecord(event.payload);
      const actorAgentId = readOptionalString(payload?.actorAgentId);
      const targetAgentId = readOptionalString(payload?.targetAgentId);
      const actor = actorAgentId ? agentsById[actorAgentId] : undefined;
      const target = targetAgentId ? agentsById[targetAgentId] : undefined;
      const zoneId = readOptionalString(payload?.zoneId);
      const keyEventId = readOptionalString(payload?.keyEventId);
      return {
        id: event.id,
        atMs: event.atMs,
        text: readOptionalString(payload?.text) ?? "关键事件已触发",
        ...(actorAgentId ? { actorAgentId } : {}),
        ...(targetAgentId ? { targetAgentId } : {}),
        ...(actor ? { actorName: actor.displayName, actorRole: actor.role } : {}),
        ...(target ? { targetName: target.displayName } : {}),
        ...(zoneId ? { zoneId } : {}),
        ...(keyEventId ? { keyEventId } : {})
      };
    });
}

function buildBarrageMessages(events: LiveReplayTimelineEvent[]): LiveBarrageMessage[] {
  return events
    .filter((event) => event.kind === "barrage_stream")
    .flatMap((event) => readBarrageMessages(asRecord(event.payload)?.messages));
}

function readBarrageMessages(value: unknown): LiveBarrageMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const record = asRecord(item);
      const id = readOptionalString(record?.id);
      const text = readOptionalString(record?.text);
      const atMs = record?.atMs;
      const intensity = readOptionalString(record?.intensity);
      if (!id || !text || typeof atMs !== "number") {
        return null;
      }
      return {
        id,
        text,
        atMs,
        intensity: intensity === "high" || intensity === "medium" || intensity === "low" ? intensity : "low"
      };
    })
    .filter((item): item is LiveBarrageMessage => item !== null);
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

function buildTacticalMapFrame(
  roundItem: LiveReplayRound,
  killFeed: KillFeedEntry[],
  visibleEvents: LiveReplayTimelineEvent[]
): LiveTacticalMapFrame {
  const layout = getTacticalMapLayout(roundItem.roundReport.mapName);
  const baseLayout = toLiveTacticalMapLayout(layout);
  const visibleKeyEventIds = new Set(killFeed.map((entry) => entry.keyEventId).filter((id): id is string => typeof id === "string"));
  const highlightVisible = visibleEvents.some((event) => event.kind === "highlight_reveal");
  const tags = roundItem.roundReport.highlightTags;
  const zoneState = new Map<string, Partial<LiveTacticalZoneFrame>>();

  for (const event of roundItem.roundReport.keyEvents) {
    const zoneId = event.type === "economy_swing" ? "token_economy" : event.zoneId;
    const resolved = resolveTacticalZone(layout, zoneId);
    const active = visibleKeyEventIds.has(event.id) || highlightVisible;
    const previous = zoneState.get(resolved.zone.zoneId);
    zoneState.set(resolved.zone.zoneId, {
      ...previous,
      active: Boolean(previous?.active) || active,
      weak: Boolean(previous?.weak) || resolved.weak,
      ...(resolved.weak ? { requestedZoneId: resolved.requestedZoneId } : {}),
      actorTeamId: event.actorTeamId,
      impact: event.impact,
      eventType: event.type,
      ...(highlightVisible && tags.length > 0 ? { badge: formatBadge(tags[0] ?? "") } : {})
    });
  }
  applyTacticalControlState(zoneState, layout, roundItem, visibleEvents);

  const zones: LiveTacticalZoneFrame[] = layout.zones.map((zone) => {
    const state = zoneState.get(zone.zoneId);
    return {
      id: zone.zoneId,
      displayName: zone.displayName,
      role: zone.role,
      position: zone.position,
      radius: zone.radius,
      active: Boolean(state?.active),
      weak: Boolean(state?.weak),
      ...(typeof state?.requestedZoneId === "string" ? { requestedZoneId: state.requestedZoneId } : {}),
      ...(typeof state?.actorTeamId === "string" ? { actorTeamId: state.actorTeamId } : {}),
      ...(typeof state?.impact === "string" ? { impact: state.impact } : {}),
      ...(typeof state?.eventType === "string" ? { eventType: state.eventType } : {}),
      ...(typeof state?.badge === "string" ? { badge: state.badge } : {})
    };
  });
  const activeZoneIds = new Set(zones.filter((zone) => zone.active).map((zone) => zone.id));
  const zoneById = new Map(layout.zones.map((zone) => [zone.zoneId, zone]));

  return {
    ...baseLayout,
    zones,
    connections: layout.connections.map((connection) => {
      const from = zoneById.get(connection.fromZoneId);
      const to = zoneById.get(connection.toZoneId);
      if (!from || !to) {
        throw new Error(`Invalid tactical connection: ${connection.fromZoneId} -> ${connection.toZoneId}`);
      }

      return {
        fromZoneId: connection.fromZoneId,
        toZoneId: connection.toZoneId,
        pathType: connection.pathType,
        active: activeZoneIds.has(connection.fromZoneId) || activeZoneIds.has(connection.toZoneId),
        from: from.position,
        to: to.position
      };
    })
  };
}

function applyTacticalControlState(
  zoneState: Map<string, Partial<LiveTacticalZoneFrame>>,
  layout: TacticalMapLayout,
  roundItem: LiveReplayRound,
  visibleEvents: LiveReplayTimelineEvent[]
): void {
  const visibleControlEvents = visibleEvents.filter((event) => event.kind === "map_control_update");
  if (visibleControlEvents.length === 0 || !roundItem.tacticalRound) {
    return;
  }

  for (const event of visibleControlEvents) {
    const payload = asRecord(event.payload);
    const tacticalKind = readOptionalString(payload?.tacticalKind);
    if (tacticalKind === "attack_plan_revealed") {
      markTacticalZone(zoneState, layout, roundItem.tacticalRound.attackPlan.primaryTargetZoneId, {
        active: true,
        badge: "ATK",
        actorTeamId: roundItem.tacticalRound.attackPlan.teamId,
        eventType: roundItem.tacticalRound.attackPlan.approach,
        impact: roundItem.tacticalRound.attackPlan.publicSummary
      });
      if (roundItem.tacticalRound.attackPlan.secondaryTargetZoneId) {
        markTacticalZone(zoneState, layout, roundItem.tacticalRound.attackPlan.secondaryTargetZoneId, {
          active: true,
          badge: "ROT",
          actorTeamId: roundItem.tacticalRound.attackPlan.teamId,
          eventType: "secondary_target",
          impact: roundItem.tacticalRound.attackPlan.publicSummary
        });
      }
    }

    if (tacticalKind === "defense_deployment_revealed") {
      if (roundItem.tacticalRound.defenseDeployment.heavyZoneId) {
        markTacticalZone(zoneState, layout, roundItem.tacticalRound.defenseDeployment.heavyZoneId, {
          active: true,
          badge: "DEF",
          actorTeamId: roundItem.tacticalRound.defenseDeployment.teamId,
          eventType: roundItem.tacticalRound.defenseDeployment.setup,
          impact: roundItem.tacticalRound.defenseDeployment.publicSummary
        });
      }
      for (const weakZoneId of roundItem.tacticalRound.defenseDeployment.weakZoneIds) {
        markTacticalZone(zoneState, layout, weakZoneId, {
          active: true,
          weak: true,
          badge: "WEAK",
          actorTeamId: roundItem.tacticalRound.defenseDeployment.teamId,
          eventType: "weak_zone",
          impact: roundItem.tacticalRound.defenseDeployment.publicSummary
        });
      }
    }

    if (tacticalKind === "site_execute_resolved") {
      markTacticalZone(zoneState, layout, roundItem.tacticalRound.collision.primaryZoneId, {
        active: true,
        badge: "COLL",
        eventType: roundItem.tacticalRound.collision.result,
        impact: roundItem.tacticalRound.collision.decisiveReason
      });
    }
  }
}

function markTacticalZone(
  zoneState: Map<string, Partial<LiveTacticalZoneFrame>>,
  layout: TacticalMapLayout,
  zoneId: string,
  state: Partial<LiveTacticalZoneFrame>
): void {
  const resolved = resolveTacticalZone(layout, zoneId);
  const previous = zoneState.get(resolved.zone.zoneId);
  zoneState.set(resolved.zone.zoneId, {
    ...previous,
    ...state,
    active: Boolean(previous?.active) || Boolean(state.active),
    weak: Boolean(previous?.weak) || Boolean(state.weak) || resolved.weak,
    ...(resolved.weak ? { requestedZoneId: resolved.requestedZoneId } : {})
  });
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

function readSupportRate(events: LiveReplayTimelineEvent[]): LiveSupportRate | null {
  for (const event of [...events].reverse()) {
    const supportRate = readSupportRatePayload(asRecord(event.payload)?.supportRate);
    if (supportRate) {
      return supportRate;
    }
  }
  return null;
}

function readSupportRatePayload(value: unknown): LiveSupportRate | null {
  const record = asRecord(value);
  if (
    typeof record?.teamA === "number" &&
    typeof record.teamB === "number" &&
    typeof record.leaderTeamId === "string" &&
    typeof record.trend === "string" &&
    typeof record.label === "string"
  ) {
    return {
      teamA: record.teamA,
      teamB: record.teamB,
      leaderTeamId: record.leaderTeamId,
      trend: record.trend,
      label: record.label
    };
  }
  return null;
}

function readReplayCard(value: unknown): LiveReplayCard | null {
  const record = asRecord(value);
  const jumpTarget = asRecord(record?.jumpTarget);
  if (
    typeof record?.title === "string" &&
    typeof record.summary === "string" &&
    Array.isArray(record.highlightTags) &&
    jumpTarget?.type === "highlight_reveal" &&
    typeof jumpTarget.roundId === "string" &&
    typeof jumpTarget.atMs === "number"
  ) {
    return {
      title: record.title,
      summary: record.summary,
      highlightTags: readStringArray(record.highlightTags),
      jumpTarget: {
        type: "highlight_reveal",
        roundId: jumpTarget.roundId,
        atMs: jumpTarget.atMs
      }
    };
  }
  return null;
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

function toEconomyRow(row: SourceRoundReport["economyDelta"]["agents"][number], agentsById: Record<string, LiveReplayAgent>): EconomyRow {
  const agent = agentsById[row.agentId];
  return {
    agentId: row.agentId,
    teamId: row.teamId,
    displayName: agent?.displayName ?? row.agentId,
    role: agent?.role ?? "unknown",
    aliases: agent?.aliases ?? [],
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

function formatBadge(tag: string): string {
  return tag
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("")
    .slice(0, 4);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
