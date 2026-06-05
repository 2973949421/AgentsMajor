import type { Repositories } from "@agent-major/db";
import type {
  Agent,
  AgentOutput,
  BuyType,
  Event,
  JudgeRoundWinType,
  JudgeResult,
  MapGame,
  Match,
  ProjectedEvent,
  Round,
  RoundCombatResolution,
  RoundKeyEvent,
  RoundReport,
  ScorePair,
  Summary,
  TacticalCollision,
  Team,
  TimelineEvent,
  TimelineEventKind
} from "@agent-major/shared";

import {
  buildRoundBroadcastItems,
  isDisplayableBroadcastItem,
  toBroadcastEventPayload,
  type BroadcastSourceBundle,
  type RoundBroadcastGenerator,
  type RoundBroadcastItems
} from "./broadcast.js";
import { mr6MapRules, type SideContext } from "./map-rules.js";
import {
  buyTypeForTeam,
  economyNetDeltaForTeam,
  formatEconomyDescriptor,
  formatEconomyPosture,
  isEconomySwing,
  isOvertimeEconomyResetRound
} from "./economy-output-service.js";
import {
  formatKillLedgerZoneLabel,
  summarizeCombatResolution
} from "./combat-resolution-pipeline.js";

export interface RoundPresentationServiceInput {
  repositories: Repositories;
  appendEvent(input: Omit<Event, "globalSequence" | "sequenceInScope">): Promise<Event>;
  broadcastGenerator?: RoundBroadcastGenerator | undefined;
}

export interface RoundPresentationCommittedRound {
  match: Match;
  mapGame: MapGame;
  teamA: Team;
  teamB: Team;
  completedRound: Round;
  roundReport: RoundReport;
  sideContext: SideContext;
  roundStartedEvent: Event;
  scoreEvent: Event;
  economyEvent: Event;
  killFeedEvents: Event[];
  highlightEvent: Event;
  timeoutUsedEvent?: Event;
  coachTimeoutCorrectionEvent?: Event;
  sideAssignmentEvent?: Event;
  tacticalPlanEvent?: Event;
  zoneDeploymentEvent?: Event;
  siteExecuteEvent?: Event;
  roundReportEvent: Event;
  roundCompletedEvent: Event;
  plannedBroadcastEventIds: {
    casterLine: string;
    barrage: string;
    supportRate: string;
    replayCard: string;
  };
  createdAt: string;
}

type TransactionalRepositories = Repositories & {
  transaction?<T>(work: () => T | Promise<T>): Promise<T>;
};

export async function buildRoundBroadcastItemsWithFallback(input: {
  bundle: BroadcastSourceBundle;
  createdAt: string;
  broadcastGenerator?: RoundBroadcastGenerator | undefined;
}): Promise<RoundBroadcastItems> {
  if (!input.broadcastGenerator) {
    return buildRoundBroadcastItems(input);
  }

  try {
    return await input.broadcastGenerator.build(input);
  } catch {
    return buildRoundBroadcastItems(input);
  }
}

export async function commitBroadcastTimeline(input: {
  service: RoundPresentationServiceInput;
  committed: RoundPresentationCommittedRound;
  broadcastItems: RoundBroadcastItems;
}): Promise<void> {
  const { committed, broadcastItems, service } = input;
  const { match, mapGame, completedRound, roundReport } = committed;
  await runInTransaction(service.repositories, async () => {
    const casterLineEvent = isDisplayableBroadcastItem(broadcastItems.casterLine)
      ? await service.appendEvent({
          id: committed.plannedBroadcastEventIds.casterLine,
          type: "caster_line_created",
          category: "broadcast",
          tournamentId: match.tournamentId,
          matchId: match.id,
          mapGameId: mapGame.id,
          roundId: completedRound.id,
          scopeType: "round",
          scopeId: completedRound.id,
          payload: toBroadcastEventPayload(broadcastItems.casterLine),
          createdAt: committed.createdAt
        })
      : undefined;
    const barrageEvent = isDisplayableBroadcastItem(broadcastItems.barrage)
      ? await service.appendEvent({
          id: committed.plannedBroadcastEventIds.barrage,
          type: "barrage_created",
          category: "broadcast",
          tournamentId: match.tournamentId,
          matchId: match.id,
          mapGameId: mapGame.id,
          roundId: completedRound.id,
          scopeType: "round",
          scopeId: completedRound.id,
          payload: toBroadcastEventPayload(broadcastItems.barrage),
          createdAt: committed.createdAt
        })
      : undefined;
    const supportRateEvent = isDisplayableBroadcastItem(broadcastItems.supportRate)
      ? await service.appendEvent({
          id: committed.plannedBroadcastEventIds.supportRate,
          type: "support_rate_updated",
          category: "broadcast",
          tournamentId: match.tournamentId,
          matchId: match.id,
          mapGameId: mapGame.id,
          roundId: completedRound.id,
          scopeType: "round",
          scopeId: completedRound.id,
          payload: toBroadcastEventPayload(broadcastItems.supportRate),
          createdAt: committed.createdAt
        })
      : undefined;
    const replayCardEvent = isDisplayableBroadcastItem(broadcastItems.replayCard)
      ? await service.appendEvent({
          id: committed.plannedBroadcastEventIds.replayCard,
          type: "replay_card_created",
          category: "broadcast",
          tournamentId: match.tournamentId,
          matchId: match.id,
          mapGameId: mapGame.id,
          roundId: completedRound.id,
          scopeType: "round",
          scopeId: completedRound.id,
          payload: toBroadcastEventPayload(broadcastItems.replayCard),
          createdAt: committed.createdAt
        })
      : undefined;

    await service.repositories.timelineEvents.deleteByRound(completedRound.id);
    const timelineEvents = buildTimelineEvents({
      match,
      mapGame,
      teamA: committed.teamA,
      teamB: committed.teamB,
      round: completedRound,
      roundReport,
      sideContext: committed.sideContext,
      roundStartedEvent: committed.roundStartedEvent,
      scoreEvent: committed.scoreEvent,
      economyEvent: committed.economyEvent,
      killFeedEvents: committed.killFeedEvents,
      highlightEvent: committed.highlightEvent,
      ...(committed.timeoutUsedEvent ? { timeoutUsedEvent: committed.timeoutUsedEvent } : {}),
      ...(committed.coachTimeoutCorrectionEvent ? { coachTimeoutCorrectionEvent: committed.coachTimeoutCorrectionEvent } : {}),
      ...(committed.sideAssignmentEvent ? { sideAssignmentEvent: committed.sideAssignmentEvent } : {}),
      ...(committed.tacticalPlanEvent ? { tacticalPlanEvent: committed.tacticalPlanEvent } : {}),
      ...(committed.zoneDeploymentEvent ? { zoneDeploymentEvent: committed.zoneDeploymentEvent } : {}),
      ...(committed.siteExecuteEvent ? { siteExecuteEvent: committed.siteExecuteEvent } : {}),
      broadcastItems,
      casterLineEvent,
      barrageEvent,
      supportRateEvent,
      replayCardEvent,
      roundReportEvent: committed.roundReportEvent,
      roundCompletedEvent: committed.roundCompletedEvent,
      createdAt: committed.createdAt
    });
    for (const timelineEvent of timelineEvents) {
      await service.repositories.timelineEvents.save(timelineEvent);
    }
  });
}

async function runInTransaction<T>(repositories: Repositories, work: () => T | Promise<T>): Promise<T> {
  const transactional = repositories as TransactionalRepositories;
  if (transactional.transaction) {
    return transactional.transaction(work);
  }

  return work();
}

function sourceOutputIds(outputs: AgentOutput[], agentId: string): string[] {
  return outputs.filter((output) => output.agentId === agentId).map((output) => output.id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mostFrequent(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
}

export function buildJudgeReason(input: {
  mapName: string;
  roundNumber: number;
  scoreBeforeRound: ScorePair;
  teamA: Team;
  teamB: Team;
  winnerTeamId: string;
  mvpAgent: Agent;
  margin: JudgeResult["margin"];
}): string {
  const winnerName = input.winnerTeamId === input.teamA.id ? input.teamA.displayName : input.teamB.displayName;
  const scoreAfterRound = advanceScore(input.scoreBeforeRound, input.winnerTeamId, input.teamA.id);
  const pressureLine = describeScorePressure({
    roundNumber: input.roundNumber,
    winnerTeamId: input.winnerTeamId,
    teamAId: input.teamA.id,
    scoreBeforeRound: input.scoreBeforeRound,
    scoreAfterRound
  });
  const marginLine =
    input.margin === "decisive"
      ? "判定为明显优势回合"
      : input.margin === "narrow"
        ? "判定为窄胜回合"
        : "判定为标准优势回合";
  return `${winnerName} 在 ${input.mapName} 第 ${input.roundNumber} 回合拿分，${input.mvpAgent.displayName} 是本回合 MVP 判定核心；比分 ${formatScore(input.scoreBeforeRound)} -> ${formatScore(scoreAfterRound)}；${pressureLine}；${marginLine}。`;
}

export function buildKeyEvents(input: {
  roundId: string;
  roundNumber: number;
  winnerTeamId: string;
  loserTeamId: string;
  activeA: Agent[];
  activeB: Agent[];
  agentOutputs: AgentOutput[];
  mvpAgentId: string;
  economyDelta: RoundReport["economyDelta"];
  teamABuyType: BuyType;
  teamBBuyType: BuyType;
  tacticalCollision?: TacticalCollision;
}): RoundKeyEvent[] {
  const teamAId = input.activeA[0]?.teamId;
  const teamBId = input.activeB[0]?.teamId;
  if (!teamAId || !teamBId) {
    throw new Error("Cannot build key events without both active teams.");
  }

  const winnerAgents = input.winnerTeamId === teamAId ? input.activeA : input.activeB;
  const loserAgents = input.loserTeamId === teamAId ? input.activeA : input.activeB;
  const entryAgent = winnerAgents.find((agent) => agent.role === "entry") ?? winnerAgents[0];
  const mvpAgent = winnerAgents.find((agent) => agent.id === input.mvpAgentId) ?? winnerAgents[0];
  const targetAgent = loserAgents[0];
  if (!entryAgent || !mvpAgent || !targetAgent) {
    throw new Error("Cannot build key events without active winner and loser agents.");
  }

  const lateEventType: RoundKeyEvent["type"] = input.roundNumber > mr6MapRules.regularRounds || input.roundNumber % 3 === 0 ? "clutch" : "conversion";
  const collisionZoneId = input.tacticalCollision?.primaryZoneId ?? "conversion_site_a";
  const events: RoundKeyEvent[] = [
    {
      id: `ke_${input.roundId}_entry`,
      type: "entry",
      actorAgentId: entryAgent.id,
      actorTeamId: input.winnerTeamId,
      targetAgentId: targetAgent.id,
      targetTeamId: input.loserTeamId,
      zoneId: "buyer_mid",
      impact: `${entryAgent.displayName} 在 Buyer Mid 打开入口控制，迫使 ${targetAgent.displayName} 所在防线提前回收。`,
      sourceAgentOutputIds: sourceOutputIds(input.agentOutputs, entryAgent.id)
    },
    {
      id: `ke_${input.roundId}_${lateEventType}`,
      type: lateEventType,
      actorAgentId: mvpAgent.id,
      actorTeamId: input.winnerTeamId,
      targetAgentId: targetAgent.id,
      targetTeamId: input.loserTeamId,
      zoneId: collisionZoneId,
      impact: `${mvpAgent.displayName} 在 ${formatKillLedgerZoneLabel(collisionZoneId)} 完成${lateEventType === "clutch" ? "残局收束" : "优势转化"}，把回合推进为有效得分。`,
      sourceAgentOutputIds: sourceOutputIds(input.agentOutputs, mvpAgent.id)
    }
  ];

  const winnerBuyType = buyTypeForTeam(input.winnerTeamId, teamAId, input.teamABuyType, input.teamBBuyType);
  const loserBuyType = buyTypeForTeam(input.loserTeamId, teamAId, input.teamABuyType, input.teamBBuyType);
  if (isEconomySwing(input.economyDelta) || winnerBuyType !== loserBuyType) {
    const winnerEconomyDelta = economyNetDeltaForTeam(input.economyDelta, input.winnerTeamId, teamAId);
    const loserEconomyDelta = economyNetDeltaForTeam(input.economyDelta, input.loserTeamId, teamAId);
    const winnerPosture =
      input.winnerTeamId === teamAId ? input.economyDelta.teamEconomyPostures?.teamA : input.economyDelta.teamEconomyPostures?.teamB;
    const loserPosture =
      input.loserTeamId === teamAId ? input.economyDelta.teamEconomyPostures?.teamA : input.economyDelta.teamEconomyPostures?.teamB;
    events.push({
      id: `ke_${input.roundId}_economy`,
      type: "economy_swing",
      actorAgentId: mvpAgent.id,
      actorTeamId: input.winnerTeamId,
      targetTeamId: input.loserTeamId,
      zoneId: "token_economy",
      impact: `${mvpAgent.displayName} 带队以 ${formatEconomyDescriptor(winnerBuyType, winnerPosture)} 对抗 ${formatEconomyDescriptor(loserBuyType, loserPosture)}，回合后相对经济变化 ${formatSignedNumber(winnerEconomyDelta - loserEconomyDelta)}。`,
      sourceAgentOutputIds: sourceOutputIds(input.agentOutputs, mvpAgent.id)
    });
  }

  return events;
}

export function buildHighlightTags(input: {
  roundNumber: number;
  winnerTeamId: string;
  teamAId: string;
  teamBId: string;
  scoreBeforeRound: ScorePair;
  scoreAfterRound: ScorePair;
  judgeResult: JudgeResult;
  economyDelta: RoundReport["economyDelta"];
  teamABuyType: BuyType;
  teamBBuyType: BuyType;
}): string[] {
  const tags = new Set<string>();
  tags.add(input.judgeResult.margin === "decisive" ? "decisive_round" : input.judgeResult.margin === "narrow" ? "narrow_round" : "round_conversion");

  const targetScore = mapWinTargetForRound(input.roundNumber);
  const winnerBefore = scoreForTeam(input.scoreBeforeRound, input.winnerTeamId, input.teamAId);
  const loserBefore = scoreForTeam(input.scoreBeforeRound, input.winnerTeamId === input.teamAId ? input.teamBId : input.teamAId, input.teamAId);
  const winnerAfter = scoreForTeam(input.scoreAfterRound, input.winnerTeamId, input.teamAId);

  if (input.roundNumber > mr6MapRules.regularRounds) {
    tags.add("overtime_round");
  }
  if (winnerAfter >= targetScore) {
    tags.add("map_closeout");
  }
  if (winnerBefore === targetScore - 1) {
    tags.add("map_point_conversion");
  }
  if (loserBefore >= targetScore - 1) {
    tags.add("map_point_denial");
  }
  if (winnerBefore === loserBefore) {
    tags.add("lead_take");
  } else if (winnerBefore < loserBefore && winnerAfter === loserBefore) {
    tags.add("score_equalizer");
  } else if (winnerBefore < loserBefore) {
    tags.add("deficit_reduction");
  }
  if (input.roundNumber === mr6MapRules.roundsPerHalf + 1) {
    tags.add("side_switch_round");
  }
  if (isOvertimeEconomyResetRound(input.roundNumber)) {
    tags.add("overtime_reset");
  }

  const loserTeamId = input.winnerTeamId === input.teamAId ? input.teamBId : input.teamAId;
  const winnerBuyType = buyTypeForTeam(input.winnerTeamId, input.teamAId, input.teamABuyType, input.teamBBuyType);
  const loserBuyType = buyTypeForTeam(loserTeamId, input.teamAId, input.teamABuyType, input.teamBBuyType);
  if (winnerBuyType === "forceBuy" || winnerBuyType === "eco") {
    tags.add("force_buy_conversion");
  } else if (winnerBuyType === "halfBuy") {
    tags.add("half_buy_conversion");
  } else if (winnerBuyType === "fullBuy") {
    tags.add("full_buy_conversion");
  }
  if (loserBuyType === "fullBuy" && winnerBuyType !== "fullBuy") {
    tags.add("buy_disadvantage_win");
  }
  if (isEconomySwing(input.economyDelta)) {
    tags.add("economy_swing");
  }

  return [...tags];
}

export function buildTimelineEvents(input: {
  match: Match;
  mapGame: MapGame;
  teamA: Team;
  teamB: Team;
  round: Round;
  roundReport: RoundReport;
  sideContext: SideContext;
  roundStartedEvent: Event;
  scoreEvent: Event;
  economyEvent: Event;
  killFeedEvents: Event[];
  highlightEvent: Event;
  timeoutUsedEvent?: Event;
  coachTimeoutCorrectionEvent?: Event;
  sideAssignmentEvent?: Event;
  tacticalPlanEvent?: Event;
  zoneDeploymentEvent?: Event;
  siteExecuteEvent?: Event;
  broadcastItems: RoundBroadcastItems;
  casterLineEvent: Event | undefined;
  barrageEvent: Event | undefined;
  supportRateEvent: Event | undefined;
  replayCardEvent: Event | undefined;
  roundReportEvent: Event;
  roundCompletedEvent: Event;
  createdAt: string;
}): TimelineEvent[] {
  const base = {
    tournamentId: input.match.tournamentId,
    matchId: input.match.id,
    mapGameId: input.mapGame.id,
    roundId: input.round.id,
    playbackScope: "round" as const,
    playbackScopeId: input.round.id,
    createdAt: input.createdAt
  };
  const items: Array<{
    kind: TimelineEventKind;
    atMs: number;
    durationMs?: number;
    sourceEventIds: string[];
    payload: unknown;
  }> = [
    {
      kind: "round_intro",
      atMs: 0,
      durationMs: 4000,
      sourceEventIds: [
        input.roundStartedEvent.id,
        ...(input.timeoutUsedEvent ? [input.timeoutUsedEvent.id] : []),
        ...(input.sideAssignmentEvent ? [input.sideAssignmentEvent.id] : [])
      ],
      payload: {
        roundNumber: input.round.roundNumber,
        mapName: input.mapGame.mapName,
        headline: buildRoundHeadline(input.mapGame.mapName, input.roundReport),
        scoreBeforeRound: input.roundReport.scoreBeforeRound,
        sideContext: input.sideContext,
        tacticalRound: input.roundReport.tacticalContext
          ? {
              attackingTeamId: input.roundReport.tacticalContext.sideAssignment.attackingTeamId,
              defendingTeamId: input.roundReport.tacticalContext.sideAssignment.defendingTeamId,
              half: input.roundReport.tacticalContext.sideAssignment.half,
              sideSwitched: input.roundReport.tacticalContext.sideAssignment.sideSwitched
            }
          : undefined,
        phaseLabel: formatSidePhase(input.sideContext.phase),
        buyTypes: {
          teamA: input.round.teamABuyType,
          teamB: input.round.teamBBuyType
        }
      }
    },
    ...(input.coachTimeoutCorrectionEvent
      ? [
          {
            kind: "pause_marker" as const,
            atMs: 1200,
            durationMs: 2600,
            sourceEventIds: [input.timeoutUsedEvent?.id ?? input.coachTimeoutCorrectionEvent.id, input.coachTimeoutCorrectionEvent.id],
            payload: {
              teamId: input.roundReport.appliedCoachTimeoutCorrection?.teamId,
              teamDirective: input.roundReport.appliedCoachTimeoutCorrection?.teamDirective,
              nextRoundObjective: input.roundReport.appliedCoachTimeoutCorrection?.nextRoundObjective
            }
          }
        ]
      : []),
    {
      kind: "scoreboard_update",
      atMs: 5000,
      durationMs: 3000,
      sourceEventIds: [input.scoreEvent.id, ...(input.supportRateEvent ? [input.supportRateEvent.id] : [])],
      payload: {
        winnerTeamId: input.roundReport.winnerTeamId,
        scoreBeforeRound: input.roundReport.scoreBeforeRound,
        scoreAfterRound: input.roundReport.scoreAfterRound,
        supportRate: input.broadcastItems.supportRate.payload
      }
    },
    {
      kind: "economy_panel_update",
      atMs: 10000,
      durationMs: 5000,
      sourceEventIds: [input.economyEvent.id],
      payload: {
        economyDelta: input.roundReport.economyDelta,
        economySwing:
          (input.roundReport.economyDelta.teamNetDelta?.teamA ?? input.roundReport.economyDelta.teamTotals.teamA) -
          (input.roundReport.economyDelta.teamNetDelta?.teamB ?? input.roundReport.economyDelta.teamTotals.teamB)
      }
    },
    ...buildTacticalTimelineItems(input),
    ...input.killFeedEvents.map((event, index) => {
      const payload = isRecord(event.payload) ? (event.payload as Record<string, unknown>) : null;
      const atMs = typeof payload?.atMs === "number" ? payload.atMs : 20000 + index * 8000;
      return {
        kind: "kill_feed_item" as const,
        atMs,
        durationMs: 5000,
        sourceEventIds: [event.id],
        payload: event.payload
      };
    }),
    ...buildCasterTimelineItems(input),
    {
      kind: "barrage_stream",
      atMs: 50000,
      durationMs: 12000,
      sourceEventIds: [input.barrageEvent?.id ?? input.roundReportEvent.id],
      payload: {
        ...input.broadcastItems.barrage.payload,
        generationMode: input.broadcastItems.barrage.generationMode,
        qualityStatus: input.broadcastItems.barrage.qualityStatus
      }
    },
    {
      kind: "highlight_reveal",
      atMs: 54000,
      durationMs: 5000,
      sourceEventIds: [input.highlightEvent.id, ...(input.siteExecuteEvent ? [input.siteExecuteEvent.id] : []), ...(input.replayCardEvent ? [input.replayCardEvent.id] : [])],
      payload: {
        tags: input.roundReport.highlightTags ?? [],
        mvpAgentId: input.roundReport.judgeResult.mvpAgentId,
        reason: input.roundReport.judgeResult.reason,
        tacticalCollision: input.roundReport.tacticalContext?.collision,
        replayCard: input.broadcastItems.replayCard.payload
      }
    },
    {
      kind: "round_result",
      atMs: 62000,
      durationMs: 5000,
      sourceEventIds: [input.roundCompletedEvent.id],
      payload: {
        winnerTeamId: input.roundReport.winnerTeamId,
        scoreBeforeRound: input.roundReport.scoreBeforeRound,
        scoreAfterRound: input.roundReport.scoreAfterRound,
        summary: input.roundReport.summary,
        highlightTags: input.roundReport.highlightTags ?? [],
        tacticalRound: input.roundReport.tacticalContext
      }
    },
    {
      kind: "round_outro",
      atMs: 72000,
      durationMs: 3000,
      sourceEventIds: [input.roundCompletedEvent.id],
      payload: {
        roundReportId: input.roundReport.id
      }
    }
  ];

  return items.map((item, index) => ({
    ...base,
    id: `tl_${input.round.id}_${index + 1}`,
    sequenceIndex: index,
    ...item
  }));
}

function buildTacticalTimelineItems(input: {
  roundReport: RoundReport;
  tacticalPlanEvent?: Event;
  zoneDeploymentEvent?: Event;
  siteExecuteEvent?: Event;
}): Array<{
  kind: "map_control_update";
  atMs: number;
  durationMs: number;
  sourceEventIds: string[];
  payload: unknown;
}> {
  const tacticalContext = input.roundReport.tacticalContext;
  if (!tacticalContext) {
    return [];
  }

  return [
    {
      kind: "map_control_update",
      atMs: 16000,
      durationMs: 7000,
      sourceEventIds: [input.tacticalPlanEvent?.id ?? input.roundReport.id],
      payload: {
        tacticalKind: "attack_plan_revealed",
        attack: tacticalContext.attackPlan,
        targetZoneIds: [
          tacticalContext.attackPlan.primaryTargetZoneId,
          ...(tacticalContext.attackPlan.secondaryTargetZoneId ? [tacticalContext.attackPlan.secondaryTargetZoneId] : [])
        ],
        tacticalRound: tacticalContext
      }
    },
    {
      kind: "map_control_update",
      atMs: 32000,
      durationMs: 7000,
      sourceEventIds: [input.zoneDeploymentEvent?.id ?? input.roundReport.id],
      payload: {
        tacticalKind: "defense_deployment_revealed",
        defense: tacticalContext.defenseDeployment,
        heavyZoneId: tacticalContext.defenseDeployment.heavyZoneId,
        weakZoneIds: tacticalContext.defenseDeployment.weakZoneIds,
        tacticalRound: tacticalContext
      }
    },
    {
      kind: "map_control_update",
      atMs: 52000,
      durationMs: 5000,
      sourceEventIds: [input.siteExecuteEvent?.id ?? input.roundReport.id],
      payload: {
        tacticalKind: "site_execute_resolved",
        collision: tacticalContext.collision,
        tacticalRound: tacticalContext
      }
    }
  ];
}

function buildCasterTimelineItems(input: {
  teamA: Team;
  teamB: Team;
  round: Round;
  roundReport: RoundReport;
  sideContext: SideContext;
  roundStartedEvent: Event;
  economyEvent: Event;
  killFeedEvents: Event[];
  casterLineEvent: Event | undefined;
  roundReportEvent: Event;
  roundCompletedEvent: Event;
  broadcastItems: RoundBroadcastItems;
}): Array<{
  kind: "caster_line";
  atMs: number;
  durationMs: number;
  sourceEventIds: string[];
  payload: unknown;
}> {
  const setupLine = buildCasterSetupLine(input);
  const controlLine = buildCasterControlLine(input);
  const finalPayload = {
    ...input.broadcastItems.casterLine.payload,
    lineRole: "result_wrap",
    generationMode: input.broadcastItems.casterLine.generationMode,
    qualityStatus: input.broadcastItems.casterLine.qualityStatus
  };

  return [
    {
      kind: "caster_line",
      atMs: 12000,
      durationMs: 6000,
      sourceEventIds: [input.roundStartedEvent.id, input.economyEvent.id],
      payload: setupLine
    },
    {
      kind: "caster_line",
      atMs: 36000,
      durationMs: 6000,
      sourceEventIds: input.killFeedEvents[0] ? [input.killFeedEvents[0].id] : [input.roundReportEvent.id],
      payload: controlLine
    },
    {
      kind: "caster_line",
      atMs: 63000,
      durationMs: 7000,
      sourceEventIds: [input.casterLineEvent?.id ?? input.roundReportEvent.id, input.roundCompletedEvent.id],
      payload: finalPayload
    }
  ];
}

function buildCasterSetupLine(input: {
  teamA: Team;
  teamB: Team;
  round: Round;
  roundReport: RoundReport;
  sideContext: SideContext;
}): {
  speakerRole: "main_caster";
  text: string;
  reason: string;
  tags: string[];
  lineRole: "round_setup";
  generationMode: "rule";
  qualityStatus: "ready";
} {
  const teamAPosture = input.roundReport.economyDelta.teamEconomyPostures?.teamA;
  const teamBPosture = input.roundReport.economyDelta.teamEconomyPostures?.teamB;
  const teamABuy = input.round.teamABuyType ? formatEconomyDescriptor(input.round.teamABuyType, teamAPosture) : "未知买型";
  const teamBBuy = input.round.teamBBuyType ? formatEconomyDescriptor(input.round.teamBBuyType, teamBPosture) : "未知买型";
  return {
    speakerRole: "main_caster",
    text: `第 ${input.round.roundNumber} 回合开局，${formatSidePhase(input.sideContext.phase)}，比分 ${formatScore(input.roundReport.scoreBeforeRound)}。${input.teamA.shortName} ${teamABuy} 对 ${input.teamB.shortName} ${teamBBuy}，先看第一波资源分配。`,
    reason: "基于回合开局、比分、半场与买型信息生成。",
    tags: ["round_setup", input.sideContext.phase],
    lineRole: "round_setup",
    generationMode: "rule",
    qualityStatus: "ready"
  };
}

function buildCasterControlLine(input: {
  roundReport: RoundReport;
}): {
  speakerRole: "main_caster";
  text: string;
  reason: string;
  tags: string[];
  lineRole: "mid_control";
  generationMode: "rule";
  qualityStatus: "ready";
} {
  const firstKeyEvent = input.roundReport.keyEvents[0];
  return {
    speakerRole: "main_caster",
    text: firstKeyEvent ? `中段控制权开始变化：${firstKeyEvent.impact}` : "中段还在拉扯，双方都在等一个关键控制点。",
    reason: "基于本回合第一条关键事件生成。",
    tags: ["mid_control", ...(input.roundReport.highlightTags ?? []).slice(0, 2)],
    lineRole: "mid_control",
    generationMode: "rule",
    qualityStatus: "ready"
  };
}

export function buildSummary(input: {
  roundNumber: number;
  winnerTeamId: string;
  teamA: Team;
  teamB: Team;
  mapName: string;
  keyEvents: RoundKeyEvent[];
  roundCombatResolution?: RoundCombatResolution;
  economyDelta: RoundReport["economyDelta"];
  scoreBeforeRound: ScorePair;
  scoreAfterRound: ScorePair;
  sideContext: SideContext;
  teamABuyType: BuyType;
  teamBBuyType: BuyType;
  highlightTags: string[];
  tacticalContext?: RoundReport["tacticalContext"];
}): string {
  const winnerName = input.winnerTeamId === input.teamA.id ? input.teamA.displayName : input.teamB.displayName;
  const winnerBuyType = input.winnerTeamId === input.teamA.id ? input.teamABuyType : input.teamBBuyType;
  const loserBuyType = input.winnerTeamId === input.teamA.id ? input.teamBBuyType : input.teamABuyType;
  const winnerPosture =
    input.winnerTeamId === input.teamA.id ? input.economyDelta.teamEconomyPostures?.teamA : input.economyDelta.teamEconomyPostures?.teamB;
  const loserPosture =
    input.winnerTeamId === input.teamA.id ? input.economyDelta.teamEconomyPostures?.teamB : input.economyDelta.teamEconomyPostures?.teamA;
  const combatLine = input.roundCombatResolution
    ? summarizeCombatResolution(input.roundCombatResolution)
    : input.keyEvents.slice(0, 2).map((event) => event.impact).join(" ");
  const sideLine = input.sideContext.activeSide === "teamA" ? `${input.teamA.shortName} 主动进攻` : `${input.teamB.shortName} 主动进攻`;
  const highlightLine = summarizeHighlightTags(input.highlightTags);
  const tacticalLine = input.tacticalContext
    ? `战术碰撞：主区 ${formatKillLedgerZoneLabel(input.tacticalContext.collision.primaryZoneId)}，结果 ${formatTacticalCollisionResult(input.tacticalContext.collision.result)}。`
    : "";
  return `${winnerName} 在 ${input.mapName} 第 ${input.roundNumber} 回合完成收束，比分 ${formatScore(input.scoreBeforeRound)} -> ${formatScore(input.scoreAfterRound)}。${sideLine}，经济态势对位为 ${formatEconomyDescriptor(winnerBuyType, winnerPosture)} 对 ${formatEconomyDescriptor(loserBuyType, loserPosture)}。${tacticalLine}战斗结算：${combatLine}${highlightLine}`;
}

function formatRoundWinType(roundWinType: JudgeRoundWinType): string {
  switch (roundWinType) {
    case "attack_elimination":
      return "攻方全歼胜";
    case "attack_bomb_explosion":
      return "攻方爆弹胜";
    case "defense_elimination":
      return "防守方全歼胜";
    case "defense_timeout_no_plant":
      return "防守方拖时胜";
    case "defense_defuse":
      return "防守方拆包胜";
  }
}

export function buildMapSummary(input: {
  match: Match;
  mapGame: MapGame;
  teamA: Team;
  teamB: Team;
  winnerTeamId: string;
  roundReports: RoundReport[];
  sourceEventIds: string[];
  createdAt: string;
}): Summary {
  const winnerName = input.winnerTeamId === input.teamA.id ? input.teamA.displayName : input.teamB.displayName;
  const mvpAgentId = mostFrequent(input.roundReports.map((report) => report.judgeResult.mvpAgentId));
  const keyRounds = selectKeyRoundReports(input.roundReports).map((report) => ({
    roundNumber: report.roundNumber,
    winnerTeamId: report.winnerTeamId,
    scoreAfterRound: report.scoreAfterRound,
    reason: report.judgeResult.reason,
    highlightTags: report.highlightTags ?? [],
    summary: report.summary
  }));
  const economySwingRounds = input.roundReports
    .filter((report) => isEconomySwing(report.economyDelta))
    .slice(-3)
    .map((report) => report.roundNumber);
  const finalScore = `${input.mapGame.teamAScore}-${input.mapGame.teamBScore}`;

  return {
    id: `summary_${input.mapGame.id}`,
    summaryType: "map",
    scopeType: "map",
    scopeId: input.mapGame.id,
    tournamentId: input.match.tournamentId,
    matchId: input.match.id,
    mapGameId: input.mapGame.id,
    title: `${input.mapGame.mapName} 地图总结：${winnerName} ${finalScore}`,
    content: `${winnerName} 在 ${input.mapGame.mapName} 以 ${finalScore} 完成整图收束。地图共 ${input.mapGame.currentRoundNumber} 回合，${input.mapGame.currentRoundNumber > mr6MapRules.regularRounds ? "经历 MR3 加时" : "常规时间结束"}，MVP 候选为 ${mvpAgentId}。`,
    payload: {
      winnerTeamId: input.winnerTeamId,
      finalScore: {
        teamA: input.mapGame.teamAScore,
        teamB: input.mapGame.teamBScore
      },
      mvpAgentId,
      keyRounds,
      economySwingRounds,
      overtimePlayed: input.mapGame.currentRoundNumber > mr6MapRules.regularRounds
    },
    sourceEventIds: [...new Set(input.sourceEventIds)],
    createdAt: input.createdAt
  };
}

function formatTacticalCollisionResult(result: TacticalCollision["result"]): string {
  switch (result) {
    case "attack_breakthrough":
      return "攻方突破";
    case "defense_hold":
      return "防守守住";
    case "rotate_success":
      return "回防成功";
    case "fake_success":
      return "假打奏效";
    case "economy_steal":
      return "经济偷点";
    case "trade_even":
      return "均势交换";
  }
}

function selectKeyRoundReports(roundReports: RoundReport[]): RoundReport[] {
  const selected = roundReports
    .map((report) => ({ report, score: keyRoundScore(report) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.report.roundNumber - left.report.roundNumber)
    .slice(0, 4)
    .map((item) => item.report)
    .sort((left, right) => left.roundNumber - right.roundNumber);

  return selected.length > 0 ? selected : roundReports.slice(-4);
}

function keyRoundScore(report: RoundReport): number {
  const tags = new Set(report.highlightTags ?? []);
  let score = 0;
  if (tags.has("map_closeout")) score += 10;
  if (tags.has("map_point_conversion")) score += 7;
  if (tags.has("map_point_denial")) score += 6;
  if (tags.has("overtime_round")) score += 5;
  if (tags.has("decisive_round")) score += 4;
  if (tags.has("economy_swing")) score += 3;
  if (tags.has("force_buy_conversion") || tags.has("buy_disadvantage_win")) score += 3;
  if (tags.has("lead_take") || tags.has("score_equalizer")) score += 2;
  return score;
}

function summarizeHighlightTags(tags: string[]): string {
  if (tags.includes("map_closeout")) {
    return " 这是本图收官回合。";
  }
  if (tags.includes("map_point_denial")) {
    return " 这一分顶住了对手局点压力。";
  }
  if (tags.includes("force_buy_conversion") || tags.includes("buy_disadvantage_win")) {
    return " 这一分的重点是低配购买打出超额回报。";
  }
  if (tags.includes("economy_swing")) {
    return " 回合结果会明显改变双方经济压力。";
  }
  return " 回合结果已写入时间线和地图摘要。";
}

function buildRoundHeadline(mapName: string, roundReport: RoundReport): string {
  return `${mapName} R${roundReport.roundNumber}: ${formatScore(roundReport.scoreBeforeRound)} -> ${formatScore(roundReport.scoreAfterRound)}`;
}

function formatSidePhase(phase: SideContext["phase"]): string {
  switch (phase) {
    case "regular_first_half":
      return "常规上半场";
    case "regular_second_half":
      return "常规下半场";
    case "overtime":
      return "加时";
  }
}

export function describeScorePressure(input: {
  roundNumber: number;
  winnerTeamId: string;
  teamAId: string;
  scoreBeforeRound: ScorePair;
  scoreAfterRound: ScorePair;
}): string {
  const targetScore = mapWinTargetForRound(input.roundNumber);
  const winnerBefore = scoreForTeam(input.scoreBeforeRound, input.winnerTeamId, input.teamAId);
  const loserBefore = input.winnerTeamId === input.teamAId ? input.scoreBeforeRound.teamB : input.scoreBeforeRound.teamA;
  const winnerAfter = scoreForTeam(input.scoreAfterRound, input.winnerTeamId, input.teamAId);

  if (winnerAfter >= targetScore) {
    return "直接完成地图收官";
  }
  if (winnerBefore === targetScore - 1) {
    return "兑现自己的局点机会";
  }
  if (loserBefore >= targetScore - 1) {
    return "顶住对手局点压力";
  }
  if (input.roundNumber > mr6MapRules.regularRounds) {
    return "加时阶段完成关键交换";
  }
  if (winnerBefore < loserBefore && winnerAfter === loserBefore) {
    return "把比分重新拉平";
  }
  if (winnerBefore === loserBefore) {
    return "从平分局建立领先";
  }
  return "延续当前比分压力";
}

export function advanceScore(score: ScorePair, winnerTeamId: string, teamAId: string): ScorePair {
  return {
    teamA: score.teamA + (winnerTeamId === teamAId ? 1 : 0),
    teamB: score.teamB + (winnerTeamId === teamAId ? 0 : 1)
  };
}

function scoreForTeam(score: ScorePair, teamId: string, teamAId: string): number {
  return teamId === teamAId ? score.teamA : score.teamB;
}

function mapWinTargetForRound(roundNumber: number): number {
  if (roundNumber <= mr6MapRules.regularRounds) {
    return mr6MapRules.mapWinScore;
  }

  const overtimeCycle = Math.floor((roundNumber - mr6MapRules.regularRounds - 1) / mr6MapRules.overtimeMaxRounds);
  return 6 + overtimeCycle * mr6MapRules.overtimeRoundsPerHalf + mr6MapRules.overtimeWinScore;
}

export function buildNeutralPublicRoundSummary(input: {
  report: RoundReport;
  teamA: Team;
  teamB: Team;
}): string {
  const winnerName = input.report.winnerTeamId === input.teamA.id ? input.teamA.shortName : input.teamB.shortName;
  const teamAPosture = input.report.economyDelta.teamEconomyPostures?.teamA;
  const teamBPosture = input.report.economyDelta.teamEconomyPostures?.teamB;
  const teamALabel = teamAPosture ? formatEconomyPosture(teamAPosture) : "经济局";
  const teamBLabel = teamBPosture ? formatEconomyPosture(teamBPosture) : "经济局";
  return `R${input.report.roundNumber}：${winnerName} ${formatRoundWinType(input.report.judgeResult.roundWinType ?? "attack_elimination")}，比分 ${formatScore(input.report.scoreBeforeRound)} -> ${formatScore(input.report.scoreAfterRound)}，${input.teamA.shortName} ${teamALabel} / ${input.teamB.shortName} ${teamBLabel}。仅作公开历史，不代表当前回合强弱。`;
}

export function formatScore(score: ScorePair): string {
  return `${score.teamA}-${score.teamB}`;
}

function formatSignedNumber(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

export function buildMatchSummary(input: {
  match: Match;
  mapGames: MapGame[];
  teamA: Team;
  teamB: Team;
  winnerTeamId: string;
  mapSummaries: Summary[];
  sourceEventIds: string[];
  createdAt: string;
}): Summary {
  const winnerName = input.winnerTeamId === input.teamA.id ? input.teamA.displayName : input.teamB.displayName;
  const finalMapScore = `${input.match.teamAMapsWon}-${input.match.teamBMapsWon}`;
  const mvpAgentId = mostFrequent(
    input.mapSummaries
      .map((summary) => summary.payload)
      .map((payload) => (isRecord(payload) && typeof payload.mvpAgentId === "string" ? payload.mvpAgentId : undefined))
      .filter((mvpAgentId): mvpAgentId is string => typeof mvpAgentId === "string")
  );
  const mapResults = [...input.mapGames]
    .sort((left, right) => left.order - right.order)
    .map((mapGame) => ({
      mapGameId: mapGame.id,
      mapName: mapGame.mapName,
      order: mapGame.order,
      winnerTeamId: mapGame.winnerTeamId,
      score: {
        teamA: mapGame.teamAScore,
        teamB: mapGame.teamBScore
      },
      summaryId: mapGame.summaryId
    }));

  return {
    id: `summary_${input.match.id}`,
    summaryType: "match",
    scopeType: "match",
    scopeId: input.match.id,
    tournamentId: input.match.tournamentId,
    matchId: input.match.id,
    title: `BO3 比赛总结：${winnerName} ${finalMapScore}`,
    content: `${winnerName} 以 ${finalMapScore} 赢下 BO3。系列赛共完成 ${input.mapGames.length} 张地图，MVP 候选为 ${mvpAgentId}。`,
    payload: {
      winnerTeamId: input.winnerTeamId,
      finalMapScore: {
        teamA: input.match.teamAMapsWon,
        teamB: input.match.teamBMapsWon
      },
      mvpAgentId,
      deciderMapId: input.mapGames.at(-1)?.id,
      mapResults
    },
    sourceEventIds: [...new Set(input.sourceEventIds)],
    createdAt: input.createdAt
  };
}

export function requiredProjection(event: Event): ProjectedEvent {
  return {
    type: event.type,
    eventId: event.id,
    required: true
  };
}

