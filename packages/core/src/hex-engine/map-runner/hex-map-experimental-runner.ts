import type { Repositories } from "@agent-major/db";
import type { Artifact, Event, MapGame, ScorePair } from "@agent-major/shared";

import type { ArtifactStore } from "../../ports.js";
import {
  commitDust2HexRoundExperimental,
  type HexRoundExperimentalCommitResult
} from "../commit/index.js";
import type { HexWinConditionResult } from "../win-condition/index.js";

export const HEX_MAP_EXPERIMENTAL_DEFAULT_MAX_ROUNDS = 40;
export const HEX_MAP_EXPERIMENTAL_HARD_MAX_ROUNDS = 60;

export type HexMapExperimentalStatus = "completed" | "failed";

export type HexMapExperimentalCompletionReason =
  | "map_completed"
  | "max_rounds_exceeded"
  | "round_commit_failed";

export interface RunDust2HexMapExperimentalInput {
  repositories: Repositories;
  artifactStore: ArtifactStore;
  mapGameId: string;
  enableExperimentalMode: true;
  providerMode?: "fixture" | "real";
  maxRounds?: number;
  maxLlmCallsPerPhase?: number;
  env?: Record<string, string | undefined>;
}

export interface HexMapExperimentalRoundSummary {
  roundId: string;
  roundNumber: number;
  reportId: string;
  winnerTeamId: string;
  roundWinType: string;
  scoreAfterRound: ScorePair;
  hexTraceArtifactId: string;
  finalWinCondition: HexWinConditionResult;
  fallbackCount: number;
  combatResolutionCount: number;
}

export interface HexMapExperimentalFallbackSummary {
  totalFallbackCount: number;
  totalCombatResolutionCount: number;
  roundsWithFallback: number;
}

export interface HexMapExperimentalSummary {
  schemaVersion: 1;
  source: "hex_round_engine_map_experimental";
  mapRunId: string;
  mapGameId: string;
  status: HexMapExperimentalStatus;
  initialScore: ScorePair;
  finalScore: ScorePair;
  roundsCommitted: number;
  completionReason: HexMapExperimentalCompletionReason;
  rounds: HexMapExperimentalRoundSummary[];
  fallbackSummary: HexMapExperimentalFallbackSummary;
  writesDb: true;
  replacesLegacyRoundPath: false;
  providerMode: "fixture" | "real";
  maxRounds: number;
  error?: {
    name?: string;
    message: string;
  };
}

export interface HexMapExperimentalResult {
  mapRunId: string;
  status: HexMapExperimentalStatus;
  mapGameId: string;
  initialScore: ScorePair;
  finalScore: ScorePair;
  roundsCommitted: number;
  roundResults: HexRoundExperimentalCommitResult[];
  summary: HexMapExperimentalSummary;
  summaryArtifact: Artifact;
  events: Event[];
  completionReason: HexMapExperimentalCompletionReason;
}

interface FailureState {
  completionReason: Exclude<HexMapExperimentalCompletionReason, "map_completed">;
  error?: unknown;
}

const sourceModule = "hex-map-experimental-runner";

export async function runDust2HexMapExperimental(
  input: RunDust2HexMapExperimentalInput
): Promise<HexMapExperimentalResult> {
  if (input.enableExperimentalMode !== true) {
    throw new Error("phase20_hex_map_experimental requires explicit enableExperimentalMode=true.");
  }

  const maxRounds = normalizeMaxRounds(input.maxRounds);
  const providerMode = input.providerMode ?? "fixture";
  const createdAt = new Date().toISOString();
  const initialMap = await required(input.repositories.mapGames.getById(input.mapGameId), `Map game not found: ${input.mapGameId}`);
  if (!isDust2Map(initialMap.mapName)) {
    throw new Error(`phase20_hex_map_experimental only supports Dust2; received mapName=${initialMap.mapName}`);
  }
  if (initialMap.status === "completed") {
    throw new Error(`Cannot run experimental Hex map on completed map: ${initialMap.id}`);
  }

  const match = await required(input.repositories.matches.getById(initialMap.matchId), `Match not found: ${initialMap.matchId}`);
  const initialScore: ScorePair = {
    teamA: initialMap.teamAScore,
    teamB: initialMap.teamBScore
  };
  const mapRunId = await buildMapRunId(input.repositories, initialMap.id);
  const events: Event[] = [];
  const roundResults: HexRoundExperimentalCommitResult[] = [];
  let currentMap = initialMap;
  let failure: FailureState | undefined;

  events.push(
    await appendMapEvent(input.repositories, {
      id: mapEventId(mapRunId, "started"),
      type: "hex_map_experimental_started",
      tournamentId: match.tournamentId,
      matchId: match.id,
      mapGameId: initialMap.id,
      createdAt,
      payload: {
        schemaVersion: 1,
        mode: "phase20_hex_map_experimental",
        mapRunId,
        mapSlug: "dust2",
        providerMode,
        maxRounds,
        writesDb: true,
        replacesLegacyRoundPath: false
      }
    })
  );

  for (let index = 0; index < maxRounds; index += 1) {
    if (currentMap.status === "completed") {
      break;
    }

    try {
      const roundResult = await commitDust2HexRoundExperimental({
        repositories: input.repositories,
        artifactStore: input.artifactStore,
        mapGameId: initialMap.id,
        enableExperimentalMode: true,
        providerMode,
        ...(typeof input.maxLlmCallsPerPhase === "number" ? { maxLlmCallsPerPhase: input.maxLlmCallsPerPhase } : {}),
        ...(input.env ? { env: input.env } : {})
      });
      roundResults.push(roundResult);
      events.push(
        await appendMapEvent(input.repositories, {
          id: mapEventId(mapRunId, `round_${roundResult.round.roundNumber}_committed`),
          type: "hex_map_experimental_round_committed",
          tournamentId: match.tournamentId,
          matchId: match.id,
          mapGameId: initialMap.id,
          createdAt,
          payload: {
            schemaVersion: 1,
            mapRunId,
            roundId: roundResult.round.id,
            roundNumber: roundResult.round.roundNumber,
            roundReportId: roundResult.roundReport.id,
            winnerTeamId: roundResult.roundReport.winnerTeamId,
            roundWinType: roundResult.roundReport.judgeResult.roundWinType,
            scoreAfterRound: roundResult.roundReport.scoreAfterRound,
            hexTraceArtifactId: roundResult.hexTraceArtifact.id,
            fallbackCount: roundResult.hexTrace.audit.fallbackCount,
            combatResolutionCount: roundResult.hexTrace.audit.combatResolutionCount
          }
        })
      );
      currentMap = await required(input.repositories.mapGames.getById(initialMap.id), `Map game not found after round commit: ${initialMap.id}`);
    } catch (error) {
      failure = {
        completionReason: "round_commit_failed",
        error
      };
      currentMap = (await input.repositories.mapGames.getById(initialMap.id)) ?? currentMap;
      break;
    }
  }

  if (currentMap.status !== "completed" && !failure) {
    failure = {
      completionReason: "max_rounds_exceeded"
    };
  }

  const status: HexMapExperimentalStatus = currentMap.status === "completed" ? "completed" : "failed";
  const completionReason: HexMapExperimentalCompletionReason = status === "completed"
    ? "map_completed"
    : failure?.completionReason ?? "max_rounds_exceeded";
  const finalScore: ScorePair = {
    teamA: currentMap.teamAScore,
    teamB: currentMap.teamBScore
  };
  const summary = buildSummary({
    mapRunId,
    mapGameId: initialMap.id,
    status,
    initialScore,
    finalScore,
    roundResults,
    completionReason,
    providerMode,
    maxRounds,
    error: failure?.error
  });
  const summaryArtifact = await input.artifactStore.write({
    ownerType: "map_game",
    ownerId: initialMap.id,
    artifactType: "hex_map_summary",
    relativePath: `hex-map-summaries/${mapRunId}.json`,
    content: JSON.stringify(summary, null, 2),
    tournamentId: match.tournamentId,
    matchId: match.id,
    mapGameId: initialMap.id,
    sourceEventIds: events.map((event) => event.id)
  });

  events.push(
    await appendMapEvent(input.repositories, {
      id: mapEventId(mapRunId, "summary_created"),
      type: "hex_map_experimental_summary_created",
      tournamentId: match.tournamentId,
      matchId: match.id,
      mapGameId: initialMap.id,
      createdAt,
      payload: {
        schemaVersion: 1,
        mapRunId,
        artifactId: summaryArtifact.id,
        artifactType: "hex_map_summary",
        source: "hex_round_engine_map_experimental"
      }
    })
  );
  events.push(
    await appendMapEvent(input.repositories, {
      id: mapEventId(mapRunId, status),
      type: status === "completed" ? "hex_map_experimental_completed" : "hex_map_experimental_failed",
      tournamentId: match.tournamentId,
      matchId: match.id,
      mapGameId: initialMap.id,
      createdAt,
      payload: {
        schemaVersion: 1,
        mapRunId,
        status,
        completionReason,
        roundsCommitted: roundResults.length,
        finalScore,
        summaryArtifactId: summaryArtifact.id,
        writesDb: true,
        replacesLegacyRoundPath: false
      }
    })
  );

  return {
    mapRunId,
    status,
    mapGameId: initialMap.id,
    initialScore,
    finalScore,
    roundsCommitted: roundResults.length,
    roundResults,
    summary,
    summaryArtifact,
    events,
    completionReason
  };
}

function normalizeMaxRounds(value: number | undefined): number {
  const maxRounds = value ?? HEX_MAP_EXPERIMENTAL_DEFAULT_MAX_ROUNDS;
  if (!Number.isInteger(maxRounds) || maxRounds <= 0) {
    throw new Error(`phase20_hex_map_experimental requires maxRounds to be a positive integer; received ${String(value)}.`);
  }
  if (maxRounds > HEX_MAP_EXPERIMENTAL_HARD_MAX_ROUNDS) {
    throw new Error(`phase20_hex_map_experimental maxRounds cannot exceed ${HEX_MAP_EXPERIMENTAL_HARD_MAX_ROUNDS}; received ${maxRounds}.`);
  }
  return maxRounds;
}

function buildSummary(input: {
  mapRunId: string;
  mapGameId: string;
  status: HexMapExperimentalStatus;
  initialScore: ScorePair;
  finalScore: ScorePair;
  roundResults: HexRoundExperimentalCommitResult[];
  completionReason: HexMapExperimentalCompletionReason;
  providerMode: "fixture" | "real";
  maxRounds: number;
  error?: unknown;
}): HexMapExperimentalSummary {
  const rounds = input.roundResults.map(roundResultToSummary);
  const fallbackSummary: HexMapExperimentalFallbackSummary = {
    totalFallbackCount: rounds.reduce((sum, round) => sum + round.fallbackCount, 0),
    totalCombatResolutionCount: rounds.reduce((sum, round) => sum + round.combatResolutionCount, 0),
    roundsWithFallback: rounds.filter((round) => round.fallbackCount > 0).length
  };
  return {
    schemaVersion: 1,
    source: "hex_round_engine_map_experimental",
    mapRunId: input.mapRunId,
    mapGameId: input.mapGameId,
    status: input.status,
    initialScore: input.initialScore,
    finalScore: input.finalScore,
    roundsCommitted: rounds.length,
    completionReason: input.completionReason,
    rounds,
    fallbackSummary,
    writesDb: true,
    replacesLegacyRoundPath: false,
    providerMode: input.providerMode,
    maxRounds: input.maxRounds,
    ...errorPayload(input.error)
  };
}

function roundResultToSummary(result: HexRoundExperimentalCommitResult): HexMapExperimentalRoundSummary {
  return {
    roundId: result.round.id,
    roundNumber: result.round.roundNumber,
    reportId: result.roundReport.id,
    winnerTeamId: result.roundReport.winnerTeamId,
    roundWinType: result.roundReport.judgeResult.roundWinType
      ?? result.hexTrace.finalWinCondition.judgeRoundWinType
      ?? result.hexTrace.finalWinCondition.roundWinType
      ?? "unknown",
    scoreAfterRound: result.roundReport.scoreAfterRound,
    hexTraceArtifactId: result.hexTraceArtifact.id,
    finalWinCondition: result.hexTrace.finalWinCondition,
    fallbackCount: result.hexTrace.audit.fallbackCount,
    combatResolutionCount: result.hexTrace.audit.combatResolutionCount
  };
}

function errorPayload(error: unknown): Pick<HexMapExperimentalSummary, "error"> | Record<string, never> {
  if (!error) {
    return {};
  }
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : undefined;
  return {
    error: {
      ...(name ? { name } : {}),
      message
    }
  };
}

async function buildMapRunId(repositories: Repositories, mapGameId: string): Promise<string> {
  const currentSequence = await repositories.events.getMaxSequenceInScope("map", mapGameId);
  return `hex_map_run_${mapGameId}_${currentSequence + 1}`;
}

function mapEventId(mapRunId: string, suffix: string): string {
  return `evt_${mapRunId}_${suffix}`;
}

async function appendMapEvent(
  repositories: Repositories,
  input: {
    id: string;
    type: Event["type"];
    tournamentId: string;
    matchId: string;
    mapGameId: string;
    createdAt: string;
    payload: Event["payload"];
  }
): Promise<Event> {
  const [globalSequence, sequenceInScope] = await Promise.all([
    repositories.events.getMaxGlobalSequence(),
    repositories.events.getMaxSequenceInScope("map", input.mapGameId)
  ]);
  return repositories.events.append({
    id: input.id,
    type: input.type,
    category: "simulation",
    tournamentId: input.tournamentId,
    matchId: input.matchId,
    mapGameId: input.mapGameId,
    payload: input.payload,
    globalSequence: globalSequence + 1,
    scopeType: "map",
    scopeId: input.mapGameId,
    sequenceInScope: sequenceInScope + 1,
    sourceModule,
    createdAt: input.createdAt
  });
}

function isDust2Map(mapName: string): boolean {
  return mapName.toLowerCase().replace(/[^a-z0-9]/g, "") === "dust2";
}

function required<T>(promise: Promise<T | null>, message: string): Promise<T> {
  return promise.then((value) => {
    if (!value) {
      throw new Error(message);
    }
    return value;
  });
}
