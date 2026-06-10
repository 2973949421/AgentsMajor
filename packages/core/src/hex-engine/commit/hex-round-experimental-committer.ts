import type { Repositories } from "@agent-major/db";
import type { Artifact, Event, Round, RoundReport, ScorePair } from "@agent-major/shared";

import {
  calculateEconomyDelta,
  economyStateFromDelta
} from "../../economy/economy-output-service.js";
import { evaluateMapState } from "../../match/map-rules.js";
import type { ArtifactStore } from "../../ports.js";
import type { HexAgentCommandProgressSink } from "../action/index.js";
import { runDust2HexRound, type HexRoundTrace } from "../round/index.js";
import { loadDust2HexRoundCommitContext } from "./hex-round-commit-context.js";
import { buildHexRoundReport } from "./hex-round-report-bridge.js";
import { writeHexRoundTraceArtifact } from "./hex-round-artifact-writer.js";
import {
  buildHexRoundCommitEventIds,
  eventIdsInRoundReportOrder,
  writeHexRoundCommittedEvent,
  writeHexRoundCompletedEvent,
  writeHexRoundReportCreatedEvent,
  writeHexRoundStartedEvent,
  writeHexRoundTraceArtifactCreatedEvent
} from "./hex-round-event-writer.js";

export interface CommitDust2HexRoundExperimentalInput {
  repositories: Repositories;
  artifactStore: ArtifactStore;
  mapGameId: string;
  enableExperimentalMode: true;
  providerMode?: "fixture" | "real";
  maxLlmCallsPerPhase?: number;
  progressSink?: HexAgentCommandProgressSink;
  env?: Record<string, string | undefined>;
}

export interface HexRoundExperimentalCommitResult {
  round: Round;
  roundReport: RoundReport;
  hexTraceArtifact: Artifact;
  hexTrace: HexRoundTrace;
  events: Event[];
}

type TransactionalRepositories = Repositories & {
  transaction?: <T>(work: () => T | Promise<T>) => Promise<T>;
};

export async function commitDust2HexRoundExperimental(
  input: CommitDust2HexRoundExperimentalInput
): Promise<HexRoundExperimentalCommitResult> {
  if (input.enableExperimentalMode !== true) {
    throw new Error("phase20_hex_round_experimental requires explicit enableExperimentalMode=true.");
  }
  const repositories = input.repositories as TransactionalRepositories;
  const execute = repositories.transaction ? repositories.transaction.bind(repositories) : async <T>(work: () => T | Promise<T>) => work();
  return execute(() => commitDust2HexRoundExperimentalInner(input));
}

async function commitDust2HexRoundExperimentalInner(
  input: CommitDust2HexRoundExperimentalInput
): Promise<HexRoundExperimentalCommitResult> {
  const createdAt = new Date().toISOString();
  const context = await loadDust2HexRoundCommitContext({
    repositories: input.repositories,
    mapGameId: input.mapGameId,
    createdAt
  });
  const runningRound = buildRunningRound({
    roundId: context.roundId,
    mapGameId: context.mapGame.id,
    roundNumber: context.roundNumber,
    teamEconomyPlans: context.teamEconomyPlans,
    teamAId: context.teamA.id,
    teamBId: context.teamB.id,
    activeAIds: context.activeA.map((agent) => agent.id),
    activeBIds: context.activeB.map((agent) => agent.id),
    createdAt
  });
  await input.repositories.rounds.save(runningRound);

  const hexTrace = await runDust2HexRound({
    roundId: context.roundId,
    roundNumber: context.roundNumber,
    attackTeamId: context.sideAssignment.attackingTeamId,
    defenseTeamId: context.sideAssignment.defendingTeamId,
    activeAgents: context.runnerAgents,
    teamEconomyPlans: context.teamEconomyPlans,
    providerMode: input.providerMode ?? "fixture",
    maxLlmCallsPerPhase: input.maxLlmCallsPerPhase ?? 10,
    artifactStore: input.artifactStore,
    artifactOwner: {
      tournamentId: context.match.tournamentId,
      matchId: context.match.id,
      mapGameId: context.mapGame.id
    },
    ...(input.progressSink ? { progressSink: input.progressSink } : {}),
    env: input.env ?? process.env
  });
  const finalWinCondition = hexTrace.finalWinCondition;
  if (!finalWinCondition.isRoundOver || !finalWinCondition.winnerTeamId || !finalWinCondition.loserTeamId || !finalWinCondition.judgeRoundWinType) {
    throw new Error("Hex experimental round did not produce a hard final win condition; no round facts were committed.");
  }

  const winnerTeamId = finalWinCondition.winnerTeamId;
  const loserTeamId = finalWinCondition.loserTeamId;
  const roundWinType = finalWinCondition.judgeRoundWinType;
  const scoreAfterRound = incrementScore(context.scoreBeforeRound, winnerTeamId, context.teamA.id);
  const mapEvaluation = evaluateMapState(scoreAfterRound, context.roundNumber);
  const economyDelta = calculateEconomyDelta({
    beforeEconomy: context.beforeEconomy,
    winnerTeamId,
    loserTeamId,
    teamAId: context.teamA.id,
    teamBId: context.teamB.id,
    roundWinType,
    teamEconomyPlans: context.teamEconomyPlans,
    activeA: context.activeA,
    activeB: context.activeB
  });

  const eventIds = buildHexRoundCommitEventIds(context.roundId);
  const eventBase = {
    repositories: input.repositories,
    tournamentId: context.match.tournamentId,
    matchId: context.match.id,
    mapGameId: context.mapGame.id,
    roundId: context.roundId,
    createdAt
  };
  const events: Event[] = [];
  events.push(
    await writeHexRoundStartedEvent({
      ...eventBase,
      roundNumber: context.roundNumber
    })
  );

  const hexTraceArtifact = await writeHexRoundTraceArtifact({
    artifactStore: input.artifactStore,
    trace: hexTrace,
    tournamentId: context.match.tournamentId,
    matchId: context.match.id,
    mapGameId: context.mapGame.id,
    roundId: context.roundId,
    sourceEventIds: [eventIds.started]
  });
  events.push(
    await writeHexRoundTraceArtifactCreatedEvent({
      ...eventBase,
      artifactId: hexTraceArtifact.id
    })
  );

  const completedRound: Round = {
    ...runningRound,
    status: "completed",
    phase: "committing",
    winnerTeamId,
    roundReportId: `report_${context.roundId}`,
    completedAt: createdAt
  };
  const roundReport = buildHexRoundReport({
    id: completedRound.roundReportId!,
    match: context.match,
    mapGame: context.mapGame,
    round: completedRound,
    roundNumber: context.roundNumber,
    teamA: context.teamA,
    teamB: context.teamB,
    scoreBeforeRound: context.scoreBeforeRound,
    scoreAfterRound,
    winnerTeamId,
    loserTeamId,
    roundWinType,
    finalWinCondition,
    winnerAgents: winnerTeamId === context.teamA.id ? context.activeA : context.activeB,
    activeAgents: context.activeAgents,
    economyDelta,
    teamEconomyPlans: context.teamEconomyPlans,
    hexTraceArtifactId: hexTraceArtifact.id,
    createdAt,
    eventIds: eventIdsInRoundReportOrder(eventIds),
    hexTrace
  });

  await input.repositories.roundReports.save(roundReport);
  await input.repositories.rounds.save(completedRound);
  for (const state of economyDelta.agents.map((delta) => economyStateFromDelta(delta, context.mapGame.id, context.roundId, createdAt))) {
    await input.repositories.economyStates.save(state);
  }
  await input.repositories.mapGames.save({
    ...context.mapGame,
    status: mapEvaluation.state,
    teamAScore: scoreAfterRound.teamA,
    teamBScore: scoreAfterRound.teamB,
    currentRoundNumber: context.roundNumber,
    ...(mapEvaluation.state === "completed" ? { winnerTeamId, completedAt: createdAt } : {}),
    startedAt: context.mapGame.startedAt ?? createdAt
  });
  if (context.match.status === "scheduled") {
    await input.repositories.matches.save({ ...context.match, status: "running", startedAt: context.match.startedAt ?? createdAt });
  }

  events.push(
    await writeHexRoundCommittedEvent({
      ...eventBase,
      winnerTeamId,
      loserTeamId,
      roundWinType,
      hexTraceArtifactId: hexTraceArtifact.id
    })
  );
  events.push(
    await writeHexRoundReportCreatedEvent({
      ...eventBase,
      roundReportId: roundReport.id,
      hexTraceArtifactId: hexTraceArtifact.id
    })
  );
  events.push(
    await writeHexRoundCompletedEvent({
      ...eventBase,
      winnerTeamId,
      scoreAfterRound
    })
  );

  return {
    round: completedRound,
    roundReport,
    hexTraceArtifact,
    hexTrace,
    events
  };
}

function buildRunningRound(input: {
  roundId: string;
  mapGameId: string;
  roundNumber: number;
  teamEconomyPlans: Record<string, { summaryBuyType?: Round["teamABuyType"] }>;
  teamAId: string;
  teamBId: string;
  activeAIds: string[];
  activeBIds: string[];
  createdAt: string;
}): Round {
  const teamABuyType = input.teamEconomyPlans[input.teamAId]?.summaryBuyType;
  const teamBBuyType = input.teamEconomyPlans[input.teamBId]?.summaryBuyType;
  return {
    id: input.roundId,
    mapGameId: input.mapGameId,
    roundNumber: input.roundNumber,
    status: "running",
    phase: "committing",
    ...(teamABuyType ? { teamABuyType } : {}),
    ...(teamBBuyType ? { teamBBuyType } : {}),
    teamAActiveAgentIds: input.activeAIds,
    teamBActiveAgentIds: input.activeBIds,
    startedAt: input.createdAt
  };
}

function incrementScore(scoreBeforeRound: ScorePair, winnerTeamId: string, teamAId: string): ScorePair {
  return winnerTeamId === teamAId
    ? { teamA: scoreBeforeRound.teamA + 1, teamB: scoreBeforeRound.teamB }
    : { teamA: scoreBeforeRound.teamA, teamB: scoreBeforeRound.teamB + 1 };
}
