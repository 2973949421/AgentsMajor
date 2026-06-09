import type { Repositories } from "@agent-major/db";
import type { Event, JudgeRoundWinType, ScorePair } from "@agent-major/shared";

const sourceModule = "hex-round-experimental-committer";

export interface HexRoundCommitEventIds {
  started: string;
  traceArtifactCreated: string;
  committed: string;
  reportCreated: string;
  completed: string;
}

export interface HexRoundEventBaseInput {
  repositories: Repositories;
  tournamentId: string;
  matchId: string;
  mapGameId: string;
  roundId: string;
  createdAt: string;
}

export function buildHexRoundCommitEventIds(roundId: string): HexRoundCommitEventIds {
  return {
    started: `evt_${roundId}_hex_started`,
    traceArtifactCreated: `evt_${roundId}_hex_trace_artifact`,
    committed: `evt_${roundId}_hex_committed`,
    reportCreated: `evt_${roundId}_round_report_created`,
    completed: `evt_${roundId}_round_completed`
  };
}

export function eventIdsInRoundReportOrder(ids: HexRoundCommitEventIds): string[] {
  return [ids.started, ids.traceArtifactCreated, ids.committed, ids.reportCreated, ids.completed];
}

export function writeHexRoundStartedEvent(input: HexRoundEventBaseInput & {
  roundNumber: number;
}): Promise<Event> {
  return appendRoundEvent(input.repositories, {
    id: buildHexRoundCommitEventIds(input.roundId).started,
    type: "hex_round_experimental_started",
    tournamentId: input.tournamentId,
    matchId: input.matchId,
    mapGameId: input.mapGameId,
    roundId: input.roundId,
    createdAt: input.createdAt,
    payload: {
      schemaVersion: 1,
      mode: "phase20_hex_round_experimental",
      mapSlug: "dust2",
      roundNumber: input.roundNumber,
      replacesLegacyRoundPath: false
    }
  });
}

export function writeHexRoundTraceArtifactCreatedEvent(input: HexRoundEventBaseInput & {
  artifactId: string;
}): Promise<Event> {
  return appendRoundEvent(input.repositories, {
    id: buildHexRoundCommitEventIds(input.roundId).traceArtifactCreated,
    type: "hex_round_trace_artifact_created",
    tournamentId: input.tournamentId,
    matchId: input.matchId,
    mapGameId: input.mapGameId,
    roundId: input.roundId,
    createdAt: input.createdAt,
    payload: {
      schemaVersion: 1,
      artifactId: input.artifactId,
      source: "hex_round_engine_committed"
    }
  });
}

export function writeHexRoundCommittedEvent(input: HexRoundEventBaseInput & {
  winnerTeamId: string;
  loserTeamId: string;
  roundWinType: JudgeRoundWinType;
  hexTraceArtifactId: string;
}): Promise<Event> {
  return appendRoundEvent(input.repositories, {
    id: buildHexRoundCommitEventIds(input.roundId).committed,
    type: "hex_round_experimental_committed",
    tournamentId: input.tournamentId,
    matchId: input.matchId,
    mapGameId: input.mapGameId,
    roundId: input.roundId,
    createdAt: input.createdAt,
    payload: {
      schemaVersion: 1,
      winnerTeamId: input.winnerTeamId,
      loserTeamId: input.loserTeamId,
      roundWinType: input.roundWinType,
      hexTraceArtifactId: input.hexTraceArtifactId,
      writesDb: true,
      replacesLegacyRoundPath: false
    }
  });
}

export function writeHexRoundReportCreatedEvent(input: HexRoundEventBaseInput & {
  roundReportId: string;
  hexTraceArtifactId: string;
}): Promise<Event> {
  return appendRoundEvent(input.repositories, {
    id: buildHexRoundCommitEventIds(input.roundId).reportCreated,
    type: "round_report_created",
    tournamentId: input.tournamentId,
    matchId: input.matchId,
    mapGameId: input.mapGameId,
    roundId: input.roundId,
    createdAt: input.createdAt,
    payload: {
      schemaVersion: 1,
      roundReportId: input.roundReportId,
      hexTraceArtifactId: input.hexTraceArtifactId
    }
  });
}

export function writeHexRoundCompletedEvent(input: HexRoundEventBaseInput & {
  winnerTeamId: string;
  scoreAfterRound: ScorePair;
}): Promise<Event> {
  return appendRoundEvent(input.repositories, {
    id: buildHexRoundCommitEventIds(input.roundId).completed,
    type: "round_completed",
    tournamentId: input.tournamentId,
    matchId: input.matchId,
    mapGameId: input.mapGameId,
    roundId: input.roundId,
    createdAt: input.createdAt,
    payload: {
      schemaVersion: 1,
      winnerTeamId: input.winnerTeamId,
      scoreAfterRound: input.scoreAfterRound,
      source: "hex_round_engine_committed"
    }
  });
}

async function appendRoundEvent(
  repositories: Repositories,
  input: {
    id: string;
    type: Event["type"];
    tournamentId: string;
    matchId: string;
    mapGameId: string;
    roundId: string;
    createdAt: string;
    payload: Event["payload"];
  }
): Promise<Event> {
  const [globalSequence, sequenceInScope] = await Promise.all([
    repositories.events.getMaxGlobalSequence(),
    repositories.events.getMaxSequenceInScope("round", input.roundId)
  ]);
  return repositories.events.append({
    id: input.id,
    type: input.type,
    category: "simulation",
    tournamentId: input.tournamentId,
    matchId: input.matchId,
    mapGameId: input.mapGameId,
    roundId: input.roundId,
    payload: input.payload,
    globalSequence: globalSequence + 1,
    scopeType: "round",
    scopeId: input.roundId,
    sequenceInScope: sequenceInScope + 1,
    sourceModule,
    createdAt: input.createdAt
  });
}
