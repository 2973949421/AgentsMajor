import type { Repositories } from "@agent-major/db";
import type { Artifact, Event, MapGame, ScorePair } from "@agent-major/shared";

import {
  commitDust2NodeRoundExperimental,
  type NodeRoundExperimentalCommitResult,
  type RunNodeRoundExperimentalCommitInput
} from "./node-round-experimental-committer.js";
import type { ArtifactStore } from "./ports.js";

export interface RunDust2NodeMapExperimentalInput {
  repositories: Repositories;
  artifactStore: ArtifactStore;
  mapGameId: string;
  enableMapExperimentalMode: true;
  providerMode?: "fixture" | "real";
  agentActionLlmShadow?: boolean;
  localJudgeLlmShadow?: boolean;
  maxRounds?: number;
  maxAgentActionLlmCalls?: number;
  maxLocalJudgeLlmCalls?: number;
  env?: Record<string, string | undefined>;
  commitRound?: (input: RunNodeRoundExperimentalCommitInput) => Promise<NodeRoundExperimentalCommitResult>;
}

export interface NodeMapExperimentalRoundSummary {
  roundId: string;
  roundNumber: number;
  winnerTeamId?: string;
  loserTeamId?: string;
  roundWinType?: string;
  nodeTraceArtifactId: string;
  finalHardCondition?: {
    isRoundOver: boolean;
    winnerSide?: "attack" | "defense";
    winnerTeamId?: string;
    loserTeamId?: string;
    roundWinType?: string;
    phaseId: string;
    nodeId?: string;
    plantedNodeId?: string;
    reason: string;
  };
  totalApSpent: number;
  fallbackCount: number;
  ignoredFields: string[];
}

export interface NodeMapExperimentalSummary {
  schemaVersion: 1;
  source: "node_round_engine_map_experimental";
  mode: "phase20_node_map_experimental";
  writesDb: true;
  replacesLegacyRoundPath: false;
  mapGameId: string;
  matchId: string;
  mapName: string;
  status: string;
  roundsCommitted: number;
  finalScore: ScorePair;
  completionReason: "map_completed";
  roundTraceArtifactIds: string[];
  roundSummaries: NodeMapExperimentalRoundSummary[];
  fallbackSummary: {
    totalFallbackCount: number;
    reasons: string[];
    ignoredFields: string[];
  };
}

export interface NodeMapExperimentalResult {
  mapGame: MapGame;
  roundsCommitted: number;
  summaryArtifact: Artifact;
  summary: NodeMapExperimentalSummary;
  roundResults: NodeRoundExperimentalCommitResult[];
  events: Event[];
}

const sourceModule = "node-map-experimental-runner";
const defaultMaxRounds = 40;
const hardMaxRounds = 60;

export async function runDust2NodeMapExperimental(input: RunDust2NodeMapExperimentalInput): Promise<NodeMapExperimentalResult> {
  if (input.enableMapExperimentalMode !== true) {
    throw new Error("phase20_node_map_experimental requires explicit enableMapExperimentalMode=true.");
  }
  const maxRounds = normalizeMaxRounds(input.maxRounds);
  return runDust2NodeMapExperimentalInner({ ...input, maxRounds });
}

async function runDust2NodeMapExperimentalInner(input: RunDust2NodeMapExperimentalInput & { maxRounds: number }): Promise<NodeMapExperimentalResult> {
  const startedAt = new Date().toISOString();
  const initialMapGame = await required(input.repositories.mapGames.getById(input.mapGameId), `Map game not found: ${input.mapGameId}`);
  if (!isDust2Map(initialMapGame.mapName)) {
    throw new Error(`phase20_node_map_experimental only supports Dust2; received mapName=${initialMapGame.mapName}`);
  }
  if (initialMapGame.status === "completed") {
    throw new Error(`Cannot run experimental node map on completed map: ${initialMapGame.id}`);
  }
  const match = await required(input.repositories.matches.getById(initialMapGame.matchId), `Match not found: ${initialMapGame.matchId}`);
  const events: Event[] = [];
  events.push(
    await appendMapEvent(input.repositories, {
      id: `evt_${safeEventPart(initialMapGame.id)}_node_map_started_${safeEventPart(startedAt)}`,
      type: "node_map_experimental_started",
      tournamentId: match.tournamentId,
      matchId: match.id,
      mapGameId: initialMapGame.id,
      createdAt: startedAt,
      payload: {
        schemaVersion: 1,
        mode: "phase20_node_map_experimental",
        mapSlug: "dust2",
        maxRounds: input.maxRounds,
        writesDb: true,
        replacesLegacyRoundPath: false
      }
    })
  );

  const roundResults: NodeRoundExperimentalCommitResult[] = [];
  const commitRound = input.commitRound ?? commitDust2NodeRoundExperimental;

  try {
    let currentMapGame = initialMapGame;
    while (currentMapGame.status !== "completed" && roundResults.length < input.maxRounds) {
      const roundCommitInput: RunNodeRoundExperimentalCommitInput = {
        repositories: input.repositories,
        artifactStore: input.artifactStore,
        mapGameId: currentMapGame.id,
        enableExperimentalMode: true,
        ...(typeof input.localJudgeLlmShadow === "boolean" ? { localJudgeLlmShadow: input.localJudgeLlmShadow } : {}),
        ...(input.providerMode ? { localJudgeProviderMode: input.providerMode, agentActionProviderMode: input.providerMode } : {}),
        ...(typeof input.maxLocalJudgeLlmCalls === "number" ? { maxLocalJudgeLlmCalls: input.maxLocalJudgeLlmCalls } : {}),
        ...(typeof input.agentActionLlmShadow === "boolean" ? { agentActionLlmShadow: input.agentActionLlmShadow } : {}),
        ...(typeof input.maxAgentActionLlmCalls === "number" ? { maxAgentActionLlmCalls: input.maxAgentActionLlmCalls } : {}),
        ...(input.env ? { env: input.env } : {})
      };
      const roundResult = await commitRound(roundCommitInput);
      roundResults.push(roundResult);
      events.push(
        await appendMapEvent(input.repositories, {
          id: `evt_${safeEventPart(currentMapGame.id)}_node_map_round_${roundResult.round.roundNumber}`,
          type: "node_map_experimental_round_committed",
          tournamentId: match.tournamentId,
          matchId: match.id,
          mapGameId: currentMapGame.id,
          createdAt: new Date().toISOString(),
          payload: {
            schemaVersion: 1,
            mode: "phase20_node_map_experimental",
            roundId: roundResult.round.id,
            roundNumber: roundResult.round.roundNumber,
            winnerTeamId: roundResult.round.winnerTeamId,
            nodeTraceArtifactId: roundResult.nodeTraceArtifact.id,
            roundWinType: roundResult.roundReport.judgeResult.roundWinType
          }
        })
      );
      currentMapGame = await required(input.repositories.mapGames.getById(currentMapGame.id), `Map game not found after round commit: ${currentMapGame.id}`);
    }

    if (currentMapGame.status !== "completed") {
      const recentWinners = roundResults
        .slice(-8)
        .map((result) => `R${result.round.roundNumber}:${result.round.winnerTeamId ?? "unknown"}:${result.roundReport.judgeResult.roundWinType}`)
        .join(",");
      const error = `node_map_max_rounds_exceeded: Dust2 node map did not complete after ${input.maxRounds} committed rounds; score=${currentMapGame.teamAScore}:${currentMapGame.teamBScore}, round=${currentMapGame.currentRoundNumber}, recent=${recentWinners}.`;
      events.push(await appendFailureEvent(input.repositories, { matchId: match.id, tournamentId: match.tournamentId, mapGameId: currentMapGame.id, error }));
      throw new Error(error);
    }

    const summary = buildNodeMapExperimentalSummary({
      mapGame: currentMapGame,
      matchId: match.id,
      roundResults
    });
    const summaryArtifact = await input.artifactStore.write({
      ownerType: "map_game",
      ownerId: currentMapGame.id,
      artifactType: "node_map_experimental_summary",
      relativePath: `node-map-summaries/${currentMapGame.id}.json`,
      content: JSON.stringify(summary, null, 2),
      tournamentId: match.tournamentId,
      matchId: match.id,
      mapGameId: currentMapGame.id,
      sourceEventIds: events.map((event) => event.id)
    });
    events.push(
      await appendMapEvent(input.repositories, {
        id: `evt_${safeEventPart(currentMapGame.id)}_node_map_summary`,
        type: "node_map_experimental_summary_created",
        tournamentId: match.tournamentId,
        matchId: match.id,
        mapGameId: currentMapGame.id,
        createdAt: new Date().toISOString(),
        payload: {
          schemaVersion: 1,
          mode: "phase20_node_map_experimental",
          summaryArtifactId: summaryArtifact.id,
          roundsCommitted: summary.roundsCommitted,
          finalScore: summary.finalScore,
          roundTraceArtifactIds: summary.roundTraceArtifactIds
        }
      })
    );
    events.push(
      await appendMapEvent(input.repositories, {
        id: `evt_${safeEventPart(currentMapGame.id)}_node_map_completed`,
        type: "node_map_experimental_completed",
        tournamentId: match.tournamentId,
        matchId: match.id,
        mapGameId: currentMapGame.id,
        createdAt: new Date().toISOString(),
        payload: {
          schemaVersion: 1,
          mode: "phase20_node_map_experimental",
          summaryArtifactId: summaryArtifact.id,
          roundsCommitted: summary.roundsCommitted,
          finalScore: summary.finalScore,
          completionReason: summary.completionReason
        }
      })
    );

    return {
      mapGame: currentMapGame,
      roundsCommitted: roundResults.length,
      summaryArtifact,
      summary,
      roundResults,
      events
    };
  } catch (error) {
    const latestMapGame = (await input.repositories.mapGames.getById(initialMapGame.id)) ?? initialMapGame;
    const message = error instanceof Error ? error.message : String(error);
    if (!events.some((event) => event.type === "node_map_experimental_failed")) {
      events.push(await appendFailureEvent(input.repositories, { matchId: match.id, tournamentId: match.tournamentId, mapGameId: latestMapGame.id, error: message }));
    }
    throw error;
  }
}

function buildNodeMapExperimentalSummary(input: {
  mapGame: MapGame;
  matchId: string;
  roundResults: NodeRoundExperimentalCommitResult[];
}): NodeMapExperimentalSummary {
  const roundSummaries = input.roundResults.map((result): NodeMapExperimentalRoundSummary => {
    const audit = result.committedReport.audit;
    const final = result.committedReport.finalWinCondition;
    return {
      roundId: result.round.id,
      roundNumber: result.round.roundNumber,
      ...(result.round.winnerTeamId ? { winnerTeamId: result.round.winnerTeamId } : {}),
      ...(final?.loserTeamId ? { loserTeamId: final.loserTeamId } : {}),
      ...(final?.roundWinType ? { roundWinType: final.roundWinType } : {}),
      nodeTraceArtifactId: result.nodeTraceArtifact.id,
      ...(final
        ? {
            finalHardCondition: {
              isRoundOver: final.isRoundOver,
              ...(final.winnerSide ? { winnerSide: final.winnerSide } : {}),
              ...(final.winnerTeamId ? { winnerTeamId: final.winnerTeamId } : {}),
              ...(final.loserTeamId ? { loserTeamId: final.loserTeamId } : {}),
              ...(final.roundWinType ? { roundWinType: final.roundWinType } : {}),
              phaseId: final.phaseId,
              ...(final.nodeId ? { nodeId: final.nodeId } : {}),
              ...(final.plantedNodeId ? { plantedNodeId: final.plantedNodeId } : {}),
              reason: final.reason
            }
          }
        : {}),
      totalApSpent: audit.totalApSpent,
      fallbackCount: audit.llmFallbackCount + audit.agentActionFallbackCount,
      ignoredFields: uniqueSorted([...audit.ignoredLlmFields, ...audit.agentActionIgnoredFields])
    };
  });
  const fallbackReasons = input.roundResults.flatMap((result) => [
    ...result.committedReport.audit.fallbackReasons,
    ...result.committedReport.audit.agentActionFallbackReasons
  ]);
  const ignoredFields = roundSummaries.flatMap((round) => round.ignoredFields);
  return {
    schemaVersion: 1,
    source: "node_round_engine_map_experimental",
    mode: "phase20_node_map_experimental",
    writesDb: true,
    replacesLegacyRoundPath: false,
    mapGameId: input.mapGame.id,
    matchId: input.matchId,
    mapName: input.mapGame.mapName,
    status: input.mapGame.status,
    roundsCommitted: input.roundResults.length,
    finalScore: {
      teamA: input.mapGame.teamAScore,
      teamB: input.mapGame.teamBScore
    },
    completionReason: "map_completed",
    roundTraceArtifactIds: input.roundResults.map((result) => result.nodeTraceArtifact.id),
    roundSummaries,
    fallbackSummary: {
      totalFallbackCount: roundSummaries.reduce((sum, round) => sum + round.fallbackCount, 0),
      reasons: uniqueSorted(fallbackReasons),
      ignoredFields: uniqueSorted(ignoredFields)
    }
  };
}

async function appendFailureEvent(
  repositories: Repositories,
  input: {
    tournamentId: string;
    matchId: string;
    mapGameId: string;
    error: string;
  }
): Promise<Event> {
  return appendMapEvent(repositories, {
    id: `evt_${safeEventPart(input.mapGameId)}_node_map_failed_${safeEventPart(new Date().toISOString())}`,
    type: "node_map_experimental_failed",
    tournamentId: input.tournamentId,
    matchId: input.matchId,
    mapGameId: input.mapGameId,
    createdAt: new Date().toISOString(),
    payload: {
      schemaVersion: 1,
      mode: "phase20_node_map_experimental",
      error: input.error,
      errorKind: input.error.includes("node_map_max_rounds_exceeded") ? "node_map_max_rounds_exceeded" : "node_map_experimental_failed"
    }
  });
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
    category: "runtime_control",
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

function normalizeMaxRounds(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultMaxRounds;
  }
  const normalized = Math.floor(value);
  if (normalized <= 0) {
    throw new Error("phase20_node_map_experimental maxRounds must be positive.");
  }
  return Math.min(normalized, hardMaxRounds);
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

function safeEventPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_]+/g, "_");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}
