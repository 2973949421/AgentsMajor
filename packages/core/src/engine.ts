import type { Repositories } from "@agent-major/db";
import type { LlmGateway } from "@agent-major/llm";
import type { JobQueue } from "@agent-major/queue";
import type {
  Agent,
  AgentEconomyDelta,
  AgentOutput,
  BuyType,
  EconomyState,
  Event,
  JudgeResult,
  MapGame,
  Match,
  ProjectedEvent,
  Round,
  RoundKeyEvent,
  RoundReport,
  ScorePair,
  Summary,
  Team,
  TimelineEvent,
  TimelineEventKind
} from "@agent-major/shared";

import {
  buildBroadcastSourceBundle,
  buildRoundBroadcastItems,
  isDisplayableBroadcastItem,
  toBroadcastEventPayload,
  type BroadcastSourceBundle,
  type RoundBroadcastGenerator,
  type RoundBroadcastItems
} from "./broadcast.js";
import { evaluateMapState, getSideContext, mr6MapRules, plannedDemoWinnerSide, type SideContext } from "./map-rules.js";

export interface EngineContext {
  repositories: Repositories;
  llmGateway: LlmGateway;
  jobQueue: JobQueue;
  broadcastGenerator?: RoundBroadcastGenerator;
}

export interface StartMatchInput {
  matchId: string;
}

export interface CompleteVetoInput {
  matchId: string;
  selectedMapIds: string[];
}

export interface StartMapInput {
  mapGameId: string;
}

export interface PlayNextRoundInput {
  mapGameId: string;
}

export interface RunCurrentMapInput {
  mapGameId: string;
  mode?: "auto" | "debug";
  maxRounds?: number;
}

export interface RunCurrentMapResult {
  mapGame: MapGame;
  rounds: Round[];
  mapSummary?: Summary;
}

export interface RunCurrentMatchInput {
  matchId: string;
  selectedMapIds?: string[];
  maxMaps?: number;
}

export interface RunCurrentMatchResult {
  match: Match;
  mapGames: MapGame[];
  mapResults: RunCurrentMapResult[];
  matchSummary?: Summary;
}

export interface SimulationEngine {
  startMatch(input: StartMatchInput): Promise<Match>;
  completeVeto(input: CompleteVetoInput): Promise<Match>;
  startMap(input: StartMapInput): Promise<MapGame>;
  playNextRound(input: PlayNextRoundInput): Promise<Round>;
  runCurrentMap(input: RunCurrentMapInput): Promise<RunCurrentMapResult>;
  runCurrentMatch(input: RunCurrentMatchInput): Promise<RunCurrentMatchResult>;
}

type TransactionalRepositories = Repositories & {
  transaction?<T>(work: () => T | Promise<T>): Promise<T>;
};

interface RoundGeneration {
  match: Match;
  mapGame: MapGame;
  teamA: Team;
  teamB: Team;
  round: Round;
  sideContext: SideContext;
  activeA: Agent[];
  activeB: Agent[];
  allActive: Agent[];
  scoreBeforeRound: ScorePair;
  scoreAfterRound: ScorePair;
  teamABuyType: BuyType;
  teamBBuyType: BuyType;
  beforeEconomy: EconomyState[];
  economyStates: EconomyState[];
  economyDelta: RoundReport["economyDelta"];
  agentOutputs: AgentOutput[];
  judgeResult: JudgeResult;
  keyEvents: RoundKeyEvent[];
}

interface CommittedRoundGeneration {
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
  roundReportEvent: Event;
  roundCompletedEvent: Event;
  broadcastBundle: BroadcastSourceBundle;
  plannedBroadcastEventIds: {
    casterLine: string;
    barrage: string;
    supportRate: string;
    replayCard: string;
  };
  createdAt: string;
}

export class Phase10NotImplementedError extends Error {
  constructor(operation: string) {
    super(`${operation} is reserved for Phase 1.1.`);
    this.name = "Phase10NotImplementedError";
  }
}

export function createPhase10SimulationEngine(): SimulationEngine {
  return {
    async startMatch(): Promise<Match> {
      throw new Phase10NotImplementedError("startMatch");
    },
    async completeVeto(): Promise<Match> {
      throw new Phase10NotImplementedError("completeVeto");
    },
    async startMap(): Promise<MapGame> {
      throw new Phase10NotImplementedError("startMap");
    },
    async playNextRound(): Promise<Round> {
      throw new Phase10NotImplementedError("playNextRound");
    },
    async runCurrentMap(): Promise<RunCurrentMapResult> {
      throw new Phase10NotImplementedError("runCurrentMap");
    },
    async runCurrentMatch(): Promise<RunCurrentMatchResult> {
      throw new Phase10NotImplementedError("runCurrentMatch");
    }
  };
}

export function createPhase11SimulationEngine(context: EngineContext): SimulationEngine {
  return new Phase12SimulationEngine(context);
}

export function createPhase12SimulationEngine(context: EngineContext): SimulationEngine {
  return new Phase12SimulationEngine(context);
}

export function createPhase13SimulationEngine(context: EngineContext): SimulationEngine {
  return new Phase12SimulationEngine(context);
}

class Phase12SimulationEngine implements SimulationEngine {
  constructor(private readonly context: EngineContext) {}

  async startMatch(input: StartMatchInput): Promise<Match> {
    const match = await required(this.context.repositories.matches.getById(input.matchId), `Match not found: ${input.matchId}`);
    if (match.status === "running" || match.status === "veto" || match.status === "completed") {
      return match;
    }

    const now = timestamp();
    const updated: Match = {
      ...match,
      status: "veto",
      startedAt: match.startedAt ?? now
    };
    await this.context.repositories.matches.save(updated);
    await this.appendEvent({
      id: `evt_${match.id}_match_started`,
      type: "match_started",
      category: "simulation",
      tournamentId: match.tournamentId,
      matchId: match.id,
      scopeType: "match",
      scopeId: match.id,
      payload: {
        schemaVersion: 1,
        matchId: match.id,
        teamAId: match.teamAId,
        teamBId: match.teamBId
      },
      createdAt: now
    });

    return updated;
  }

  async completeVeto(input: CompleteVetoInput): Promise<Match> {
    const match = await required(this.context.repositories.matches.getById(input.matchId), `Match not found: ${input.matchId}`);
    if (match.status === "completed") {
      return match;
    }

    const now = timestamp();
    const selectedMapIds = input.selectedMapIds.length > 0 ? input.selectedMapIds : ["DUST2"];
    await runInTransaction(this.context.repositories, async () => {
      await this.ensureVetoMaps(match, selectedMapIds, now);
    });

    const updated: Match = {
      ...match,
      status: "running",
      startedAt: match.startedAt ?? now
    };
    await this.context.repositories.matches.save(updated);
    const vetoEventId = `evt_${match.id}_map_veto_completed`;
    const existingVetoEvent = await this.context.repositories.events.getById(vetoEventId);
    if (!existingVetoEvent) {
      await this.appendEvent({
        id: vetoEventId,
        type: "map_veto_completed",
        category: "simulation",
        tournamentId: match.tournamentId,
        matchId: match.id,
        scopeType: "match",
        scopeId: match.id,
        payload: {
          schemaVersion: 1,
          matchId: match.id,
          selectedMapIds
        },
        createdAt: now
      });
    } else {
      await this.appendVetoRevisionIfNeeded({
        existingVetoEvent,
        match,
        selectedMapIds,
        createdAt: now
      });
    }

    return updated;
  }

  async startMap(input: StartMapInput): Promise<MapGame> {
    const mapGame = await required(this.context.repositories.mapGames.getById(input.mapGameId), `MapGame not found: ${input.mapGameId}`);
    if (mapGame.status === "running" || mapGame.status === "overtime" || mapGame.status === "completed") {
      return mapGame;
    }

    const match = await required(this.context.repositories.matches.getById(mapGame.matchId), `Match not found: ${mapGame.matchId}`);
    const now = timestamp();
    const updated: MapGame = {
      ...mapGame,
      status: "running",
      runControlState: "running_map",
      startedAt: mapGame.startedAt ?? now
    };
    await this.context.repositories.mapGames.save(updated);
    await this.appendEvent({
      id: `evt_${mapGame.id}_map_started`,
      type: "map_started",
      category: "simulation",
      tournamentId: match.tournamentId,
      matchId: match.id,
      mapGameId: mapGame.id,
      scopeType: "map",
      scopeId: mapGame.id,
      payload: {
        schemaVersion: 1,
        mapGameId: mapGame.id,
        mapName: mapGame.mapName
      },
      createdAt: now
    });

    return updated;
  }

  async playNextRound(input: PlayNextRoundInput): Promise<Round> {
    try {
      const generation = await this.prepareRoundGeneration(input.mapGameId);
      return this.commitRoundGeneration(generation);
    } catch (error) {
      if (error instanceof CompletedRoundError || error instanceof CompletedMapError) {
        return error.round;
      }

      throw error;
    }
  }

  async runCurrentMap(input: RunCurrentMapInput): Promise<RunCurrentMapResult> {
    const mode = input.mode ?? "auto";
    const maxRounds = input.maxRounds ?? mr6MapRules.safetyRoundCap;

    for (let iteration = 0; iteration < maxRounds; iteration += 1) {
      const mapGame = await required(this.context.repositories.mapGames.getById(input.mapGameId), `MapGame not found: ${input.mapGameId}`);
      if (mapGame.status === "completed") {
        return this.buildRunCurrentMapResult(mapGame);
      }
      if (mapGame.status === "scheduled") {
        await this.startMap({ mapGameId: mapGame.id });
      }

      await this.playNextRound({ mapGameId: input.mapGameId });
      const updated = await required(this.context.repositories.mapGames.getById(input.mapGameId), `MapGame not found: ${input.mapGameId}`);
      if (updated.status === "completed" || mode === "debug") {
        return this.buildRunCurrentMapResult(updated);
      }
    }

    throw new Error(`runCurrentMap exceeded safety cap of ${maxRounds} rounds for ${input.mapGameId}.`);
  }

  async runCurrentMatch(input: RunCurrentMatchInput): Promise<RunCurrentMatchResult> {
    const selectedMapIds = normalizeSelectedMapIds(input.selectedMapIds, input.maxMaps);
    await this.startMatch({ matchId: input.matchId });
    await this.completeVeto({ matchId: input.matchId, selectedMapIds });

    for (let iteration = 0; iteration < selectedMapIds.length; iteration += 1) {
      const match = await required(this.context.repositories.matches.getById(input.matchId), `Match not found: ${input.matchId}`);
      if (match.status === "completed") {
        return this.buildRunCurrentMatchResult(match);
      }

      if (hasMatchWinner(match)) {
        await this.completeMatch(match);
        const completed = await required(this.context.repositories.matches.getById(match.id), `Match not found: ${match.id}`);
        return this.buildRunCurrentMatchResult(completed);
      }

      const mapGames = await this.context.repositories.mapGames.listByMatch(match.id);
      const nextMap = [...mapGames]
        .sort((left, right) => left.order - right.order)
        .find((mapGame) => mapGame.status !== "completed");
      if (!nextMap) {
        throw new Error(`Match ${match.id} has no remaining map but is not completed.`);
      }

      await this.runCurrentMap({ mapGameId: nextMap.id });
      const updatedMatch = await required(this.context.repositories.matches.getById(match.id), `Match not found: ${match.id}`);
      if (hasMatchWinner(updatedMatch)) {
        await this.completeMatch(updatedMatch);
        const completed = await required(this.context.repositories.matches.getById(match.id), `Match not found: ${match.id}`);
        return this.buildRunCurrentMatchResult(completed);
      }
    }

    const match = await required(this.context.repositories.matches.getById(input.matchId), `Match not found: ${input.matchId}`);
    if (hasMatchWinner(match)) {
      await this.completeMatch(match);
      const completed = await required(this.context.repositories.matches.getById(match.id), `Match not found: ${match.id}`);
      return this.buildRunCurrentMatchResult(completed);
    }

    throw new Error(`runCurrentMatch exhausted ${selectedMapIds.length} maps without a BO3 winner for ${input.matchId}.`);
  }

  private async buildRunCurrentMapResult(mapGame: MapGame): Promise<RunCurrentMapResult> {
    const rounds = (await this.context.repositories.rounds.listByMapGame(mapGame.id)).filter((round) => round.status === "completed");
    const mapSummary = mapGame.summaryId ? await this.context.repositories.summaries.getById(mapGame.summaryId) : null;
    return mapSummary ? { mapGame, rounds, mapSummary } : { mapGame, rounds };
  }

  private async buildRunCurrentMatchResult(match: Match): Promise<RunCurrentMatchResult> {
    const mapGames = await this.context.repositories.mapGames.listByMatch(match.id);
    const mapResults = await Promise.all(
      mapGames.filter((mapGame) => mapGame.status === "completed").map((mapGame) => this.buildRunCurrentMapResult(mapGame))
    );
    const matchSummary = await this.context.repositories.summaries.getLatestByScope("match", match.id);
    return matchSummary ? { match, mapGames, mapResults, matchSummary } : { match, mapGames, mapResults };
  }

  private async ensureVetoMaps(match: Match, selectedMapIds: string[], createdAt: string): Promise<void> {
    const existingMaps = await this.context.repositories.mapGames.listByMatch(match.id);
    const mapsByOrder = new Map(existingMaps.map((mapGame) => [mapGame.order, mapGame]));
    for (const [index, mapName] of selectedMapIds.entries()) {
      const order = index + 1;
      const existingMap = mapsByOrder.get(order);
      if (existingMap) {
        if (existingMap.mapName !== mapName) {
          throw new Error(`Match ${match.id} already has map ${order} as ${existingMap.mapName}; cannot replace it with ${mapName}.`);
        }
        continue;
      }

      await this.context.repositories.mapGames.save({
        id: `map_${match.id}_${order}`,
        matchId: match.id,
        mapName,
        order,
        status: "scheduled",
        runControlState: "idle",
        teamAScore: 0,
        teamBScore: 0,
        currentRoundNumber: 0,
        createdAt
      });
    }
  }

  private async appendVetoRevisionIfNeeded(input: {
    existingVetoEvent: Event;
    match: Match;
    selectedMapIds: string[];
    createdAt: string;
  }): Promise<void> {
    const previousSelectedMapIds = readStringArrayPayloadField(input.existingVetoEvent.payload, "selectedMapIds");
    if (stringArraysEqual(previousSelectedMapIds, input.selectedMapIds)) {
      return;
    }

    await this.appendEvent({
      id: `evt_${input.match.id}_map_veto_revision_${stableHex(input.selectedMapIds.join("|")).slice(0, 8)}`,
      type: "event_revision_created",
      category: "admin",
      tournamentId: input.match.tournamentId,
      matchId: input.match.id,
      scopeType: "match",
      scopeId: input.match.id,
      payload: {
        schemaVersion: 1,
        targetEventId: input.existingVetoEvent.id,
        targetEventType: input.existingVetoEvent.type,
        revisionType: "map_veto_expanded_to_bo3",
        previousSelectedMapIds,
        revisedSelectedMapIds: input.selectedMapIds,
        reason: "Phase 1.3 upgraded an existing single-map veto into a BO3 map order."
      },
      sourceModule: "core.phase13",
      createdAt: input.createdAt
    });
  }

  private async prepareRoundGeneration(mapGameId: string): Promise<RoundGeneration> {
    const mapGame = await required(this.context.repositories.mapGames.getById(mapGameId), `MapGame not found: ${mapGameId}`);
    if (mapGame.status === "completed") {
      const latestRound = (await this.context.repositories.rounds.listByMapGame(mapGame.id)).filter((round) => round.status === "completed").at(-1);
      if (!latestRound) {
        throw new Error(`Map is completed without completed rounds: ${mapGame.id}`);
      }
      throw new CompletedMapError(latestRound);
    }
    if (mapGame.status !== "running" && mapGame.status !== "overtime") {
      throw new Error(`Map must be running before playNextRound. Current status: ${mapGame.status}`);
    }

    const match = await required(this.context.repositories.matches.getById(mapGame.matchId), `Match not found: ${mapGame.matchId}`);
    const [teamA, teamB] = await Promise.all([
      required(this.context.repositories.teams.getById(match.teamAId), `Team not found: ${match.teamAId}`),
      required(this.context.repositories.teams.getById(match.teamBId), `Team not found: ${match.teamBId}`)
    ]);
    const agents = await this.context.repositories.agents.listByTeamIds([teamA.id, teamB.id]);
    const teamAAgents = sortAgentsForRound(agents.filter((agent) => agent.teamId === teamA.id));
    const teamBAgents = sortAgentsForRound(agents.filter((agent) => agent.teamId === teamB.id));
    const activeA = teamAAgents.slice(0, 3);
    const activeB = teamBAgents.slice(0, 3);
    if (activeA.length === 0 || activeB.length === 0) {
      throw new Error("Both teams must have at least one agent before playNextRound.");
    }

    const roundNumber = mapGame.currentRoundNumber + 1;
    const roundId = `round_${mapGame.id}_${roundNumber}`;
    const existingRound = await this.context.repositories.rounds.getByMapGameAndRoundNumber(mapGame.id, roundNumber);
    if (existingRound?.status === "completed") {
      throw new CompletedRoundError(existingRound);
    }
    if (existingRound) {
      throw new Error(`Round ${existingRound.id} already exists with status ${existingRound.status}.`);
    }

    const now = timestamp();
    const sideContext = getSideContext(roundNumber);
    const scoreBeforeRound: ScorePair = { teamA: mapGame.teamAScore, teamB: mapGame.teamBScore };
    const allActive = [...activeA, ...activeB];
    const beforeEconomy: EconomyState[] = await Promise.all(
      allActive.map(async (agent) => {
        if (isOvertimeEconomyResetRound(roundNumber)) {
          return initialEconomy(agent, mapGame.id, now);
        }

        return (await this.context.repositories.economyStates.getLatestByAgent(agent.id, mapGame.id)) ?? initialEconomy(agent, mapGame.id, now);
      })
    );
    const teamABuyType = decideTeamBuyType(beforeEconomy.filter((state) => state.teamId === teamA.id));
    const teamBBuyType = decideTeamBuyType(beforeEconomy.filter((state) => state.teamId === teamB.id));
    const round: Round = {
      id: roundId,
      mapGameId: mapGame.id,
      roundNumber,
      status: "running",
      phase: "generating",
      teamABuyType,
      teamBBuyType,
      teamAActiveAgentIds: activeA.map((agent) => agent.id),
      teamBActiveAgentIds: activeB.map((agent) => agent.id),
      startedAt: now
    };

    const agentOutputs = await this.generateAgentOutputs({
      agents: allActive,
      round,
      mapGame,
      sideContext,
      teamA,
      teamB,
      buyTypeByTeam: new Map<string, BuyType>([
        [teamA.id, teamABuyType],
        [teamB.id, teamBBuyType]
      ])
    });
    const judgeResult = await this.judgeRound({
      mapGame,
      roundNumber,
      scoreBeforeRound,
      teamA,
      teamB,
      activeA,
      activeB,
      agentOutputs
    });
    const winnerTeamId = judgeResult.winnerTeamId;
    const loserTeamId = judgeResult.loserTeamId;
    const scoreAfterRound: ScorePair = {
      teamA: scoreBeforeRound.teamA + (winnerTeamId === teamA.id ? 1 : 0),
      teamB: scoreBeforeRound.teamB + (winnerTeamId === teamB.id ? 1 : 0)
    };
    const economyDelta = calculateEconomyDelta({
      beforeEconomy,
      winnerTeamId,
      teamAId: teamA.id,
      teamBId: teamB.id,
      buyTypeByTeam: new Map<string, BuyType>([
        [teamA.id, teamABuyType],
        [teamB.id, teamBBuyType]
      ])
    });
    const economyStates = (economyDelta.agents as AgentEconomyDelta[]).map((delta) => economyStateFromDelta(delta, mapGame.id, roundId, now));
    const keyEvents = buildKeyEvents({
      roundId,
      roundNumber,
      winnerTeamId,
      loserTeamId,
      activeA,
      activeB,
      agentOutputs,
      mvpAgentId: judgeResult.mvpAgentId,
      economyDelta,
      teamABuyType,
      teamBBuyType
    });

    return {
      match,
      mapGame,
      teamA,
      teamB,
      round,
      sideContext,
      activeA,
      activeB,
      allActive,
      scoreBeforeRound,
      scoreAfterRound,
      teamABuyType,
      teamBBuyType,
      beforeEconomy,
      economyStates,
      economyDelta,
      agentOutputs,
      judgeResult,
      keyEvents
    };
  }

  private async commitRoundGeneration(generation: RoundGeneration): Promise<Round> {
    try {
      let committed: CommittedRoundGeneration | undefined;
      const completedRound = await runInTransaction(this.context.repositories, async () => {
        const now = timestamp();
        const { match, mapGame, round, teamA, teamB } = generation;
        await this.context.repositories.rounds.save(round);
        const roundStartedEvent = await this.appendEvent({
          id: `evt_${round.id}_round_started`,
          type: "round_started",
          category: "simulation",
          tournamentId: match.tournamentId,
          matchId: match.id,
          mapGameId: mapGame.id,
          roundId: round.id,
          scopeType: "round",
          scopeId: round.id,
          payload: {
            schemaVersion: 1,
            roundId: round.id,
            roundNumber: round.roundNumber,
            scoreBeforeRound: generation.scoreBeforeRound,
            activeAgentIds: generation.allActive.map((agent) => agent.id),
            sideContext: generation.sideContext
          },
          createdAt: now
        });

        for (const output of generation.agentOutputs) {
          await this.appendEvent({
            id: `evt_${round.id}_agent_output_${output.agentId}`,
            type: "agent_output_submitted",
            category: "simulation",
            tournamentId: match.tournamentId,
            matchId: match.id,
            mapGameId: mapGame.id,
            roundId: round.id,
            scopeType: "round",
            scopeId: round.id,
            payload: {
              schemaVersion: 1,
              output
            },
            createdAt: now
          });
        }

        const judgeEvent = await this.appendEvent({
          id: `evt_${round.id}_judge_decision`,
          type: "judge_decision_created",
          category: "judge",
          tournamentId: match.tournamentId,
          matchId: match.id,
          mapGameId: mapGame.id,
          roundId: round.id,
          scopeType: "round",
          scopeId: round.id,
          payload: {
            schemaVersion: 1,
            judgeResult: generation.judgeResult
          },
          createdAt: now
        });
        const scoreEvent = await this.appendEvent({
          id: `evt_${round.id}_score_updated`,
          type: "score_updated",
          category: "simulation",
          tournamentId: match.tournamentId,
          matchId: match.id,
          mapGameId: mapGame.id,
          roundId: round.id,
          scopeType: "round",
          scopeId: round.id,
          payload: {
            schemaVersion: 1,
            roundId: round.id,
            winnerTeamId: generation.judgeResult.winnerTeamId,
            scoreBeforeRound: generation.scoreBeforeRound,
            scoreAfterRound: generation.scoreAfterRound
          },
          createdAt: now
        });

        for (const economyState of generation.economyStates) {
          await this.context.repositories.economyStates.save(economyState);
        }
        const economyEvent = await this.appendEvent({
          id: `evt_${round.id}_economy_updated`,
          type: "economy_updated",
          category: "economy",
          tournamentId: match.tournamentId,
          matchId: match.id,
          mapGameId: mapGame.id,
          roundId: round.id,
          scopeType: "round",
          scopeId: round.id,
          payload: {
            schemaVersion: 1,
            economyDelta: generation.economyDelta,
            overtimeResetApplied: isOvertimeEconomyResetRound(round.roundNumber)
          },
          createdAt: now
        });

        const killFeedEvents: Event[] = [];
        for (const [index, keyEvent] of generation.keyEvents.entries()) {
          killFeedEvents.push(
            await this.appendEvent({
              id: `evt_${round.id}_kill_feed_${index + 1}`,
              type: "kill_feed_created",
              category: "broadcast",
              tournamentId: match.tournamentId,
              matchId: match.id,
              mapGameId: mapGame.id,
              roundId: round.id,
              scopeType: "round",
              scopeId: round.id,
              payload: {
                schemaVersion: 1,
                keyEventId: keyEvent.id,
                actorAgentId: keyEvent.actorAgentId,
                targetAgentId: keyEvent.targetAgentId,
                zoneId: keyEvent.zoneId,
                text: keyEvent.impact
              },
              createdAt: now
            })
          );
        }
        const highlightTags = buildHighlightTags({
          roundNumber: round.roundNumber,
          winnerTeamId: generation.judgeResult.winnerTeamId,
          teamAId: teamA.id,
          teamBId: teamB.id,
          scoreBeforeRound: generation.scoreBeforeRound,
          scoreAfterRound: generation.scoreAfterRound,
          judgeResult: generation.judgeResult,
          economyDelta: generation.economyDelta,
          teamABuyType: generation.teamABuyType,
          teamBBuyType: generation.teamBBuyType
        });
        const highlightEvent = await this.appendEvent({
          id: `evt_${round.id}_highlight_detected`,
          type: "highlight_detected",
          category: "broadcast",
          tournamentId: match.tournamentId,
          matchId: match.id,
          mapGameId: mapGame.id,
          roundId: round.id,
          scopeType: "round",
          scopeId: round.id,
          payload: {
            schemaVersion: 1,
            roundId: round.id,
            tags: highlightTags,
            mvpAgentId: generation.judgeResult.mvpAgentId,
            reason: generation.judgeResult.reason
          },
          createdAt: now
        });

        const plannedBroadcastEventIds = {
          casterLine: `evt_${round.id}_caster_line`,
          barrage: `evt_${round.id}_barrage`,
          supportRate: `evt_${round.id}_support_rate`,
          replayCard: `evt_${round.id}_replay_card`
        };
        const roundReportEventId = `evt_${round.id}_round_report_created`;
        const roundCompletedEventId = `evt_${round.id}_round_completed`;
        const coreProjection: ProjectedEvent[] = [
          requiredProjection(judgeEvent),
          requiredProjection(scoreEvent),
          requiredProjection(economyEvent),
          { type: "round_report_created", eventId: roundReportEventId, required: true },
          { type: "round_completed", eventId: roundCompletedEventId, required: true }
        ];
        const broadcastProjection: ProjectedEvent[] = [
          ...[...killFeedEvents, highlightEvent].map((event) => ({
            type: event.type,
            eventId: event.id,
            required: false
          })),
          { type: "caster_line_created", eventId: plannedBroadcastEventIds.casterLine, required: false },
          { type: "barrage_created", eventId: plannedBroadcastEventIds.barrage, required: false },
          { type: "support_rate_updated", eventId: plannedBroadcastEventIds.supportRate, required: false },
          { type: "replay_card_created", eventId: plannedBroadcastEventIds.replayCard, required: false }
        ];
        const roundReport: RoundReport = {
          id: `rr_${round.id}`,
          tournamentId: match.tournamentId,
          matchId: match.id,
          mapGameId: mapGame.id,
          roundId: round.id,
          roundNumber: round.roundNumber,
          mapName: mapGame.mapName,
          winnerTeamId: generation.judgeResult.winnerTeamId,
          scoreBeforeRound: generation.scoreBeforeRound,
          scoreAfterRound: generation.scoreAfterRound,
          judgeResult: generation.judgeResult,
          agentOutputs: generation.agentOutputs,
          keyEvents: generation.keyEvents,
          economyDelta: generation.economyDelta,
          tokenSubmission: {
            activeAgentIds: generation.allActive.map((agent) => agent.id),
            submittedOutputIds: generation.agentOutputs.map((output) => output.id),
            totalOutputBudget: generation.economyStates.reduce((sum, state) => sum + (state.outputBudget ?? 0), 0),
            outputGate: {
              applied: true,
              reason: "本地确定性输出闸门：按 active agent 与本回合购买态势限制输出预算。"
            }
          },
          highlightTags,
          summary: buildSummary({
            roundNumber: round.roundNumber,
            winnerTeamId: generation.judgeResult.winnerTeamId,
            teamA,
            teamB,
            mapName: mapGame.mapName,
            keyEvents: generation.keyEvents,
            scoreBeforeRound: generation.scoreBeforeRound,
            scoreAfterRound: generation.scoreAfterRound,
            sideContext: generation.sideContext,
            teamABuyType: generation.teamABuyType,
            teamBBuyType: generation.teamBBuyType,
            highlightTags
          }),
          eventProjection: {
            coreEventsLinkedByRoundReport: coreProjection,
            broadcastEventsCreated: broadcastProjection
          },
          createdAt: now
        };
        await this.context.repositories.roundReports.save(roundReport);
        const roundReportEvent = await this.appendEvent({
          id: roundReportEventId,
          type: "round_report_created",
          category: "simulation",
          tournamentId: match.tournamentId,
          matchId: match.id,
          mapGameId: mapGame.id,
          roundId: round.id,
          scopeType: "round",
          scopeId: round.id,
          payload: {
            schemaVersion: 1,
            roundReportId: roundReport.id,
            summary: roundReport.summary,
            keyEventCount: roundReport.keyEvents.length,
            highlightTags: roundReport.highlightTags ?? [],
            judgeReason: roundReport.judgeResult.reason
          },
          createdAt: now
        });

        const completedRound: Round = {
          ...round,
          status: "completed",
          phase: "committing",
          winnerTeamId: generation.judgeResult.winnerTeamId,
          roundReportId: roundReport.id,
          completedAt: now
        };
        await this.context.repositories.rounds.save(completedRound);
        const mapEvaluation = evaluateMapState(generation.scoreAfterRound, round.roundNumber);
        const nextMap: MapGame = {
          ...mapGame,
          status: mapEvaluation.state === "overtime" ? "overtime" : "running",
          runControlState: "review_window",
          teamAScore: generation.scoreAfterRound.teamA,
          teamBScore: generation.scoreAfterRound.teamB,
          currentRoundNumber: round.roundNumber
        };
        await this.context.repositories.mapGames.save(nextMap);
        const roundCompletedEvent = await this.appendEvent({
          id: roundCompletedEventId,
          type: "round_completed",
          category: "simulation",
          tournamentId: match.tournamentId,
          matchId: match.id,
          mapGameId: mapGame.id,
          roundId: round.id,
          scopeType: "round",
          scopeId: round.id,
          payload: {
            schemaVersion: 1,
            roundId: round.id,
            roundReportId: roundReport.id,
            winnerTeamId: generation.judgeResult.winnerTeamId,
            scoreAfterRound: generation.scoreAfterRound,
            mapState: mapEvaluation
          },
          createdAt: now
        });

        const broadcastBundle = buildBroadcastSourceBundle({
          match,
          mapGame,
          round: completedRound,
          roundReport,
          teamA,
          teamB,
          sourceEventIds: {
            scoreEventId: scoreEvent.id,
            economyEventId: economyEvent.id,
            highlightEventId: highlightEvent.id,
            roundReportEventId: roundReportEvent.id,
            roundCompletedEventId: roundCompletedEvent.id,
            killFeedEventIds: killFeedEvents.map((event) => event.id)
          }
        });

        if (mapEvaluation.state === "completed") {
          await this.completeMap({
            match,
            mapGame: nextMap,
            teamA,
            teamB,
            winnerTeamId: mapEvaluation.winnerSide === "teamA" ? teamA.id : teamB.id,
            completedAt: now,
            roundCompletedEventId: roundCompletedEvent.id
          });
        }

        committed = {
          match,
          mapGame,
          teamA,
          teamB,
          completedRound,
          roundReport,
          sideContext: generation.sideContext,
          roundStartedEvent,
          scoreEvent,
          economyEvent,
          killFeedEvents,
          highlightEvent,
          roundReportEvent,
          roundCompletedEvent,
          broadcastBundle,
          plannedBroadcastEventIds,
          createdAt: now
        };

        return completedRound;
      });

      if (!committed) {
        return completedRound;
      }

      const broadcastItems = await this.buildRoundBroadcastItems({
        bundle: committed.broadcastBundle,
        createdAt: committed.createdAt
      });
      await this.commitBroadcastTimeline({ committed, broadcastItems });

      return completedRound;
    } catch (error) {
      if (error instanceof CompletedRoundError) {
        return error.round;
      }
      if (error instanceof CompletedMapError) {
        return error.round;
      }

      throw error;
    }
  }

  private async buildRoundBroadcastItems(input: {
    bundle: BroadcastSourceBundle;
    createdAt: string;
  }): Promise<RoundBroadcastItems> {
    if (!this.context.broadcastGenerator) {
      return buildRoundBroadcastItems(input);
    }

    try {
      return await this.context.broadcastGenerator.build(input);
    } catch {
      return buildRoundBroadcastItems(input);
    }
  }

  private async commitBroadcastTimeline(input: {
    committed: CommittedRoundGeneration;
    broadcastItems: RoundBroadcastItems;
  }): Promise<void> {
    const { committed, broadcastItems } = input;
    const { match, mapGame, completedRound, roundReport } = committed;
    await runInTransaction(this.context.repositories, async () => {
      const casterLineEvent = isDisplayableBroadcastItem(broadcastItems.casterLine)
        ? await this.appendEvent({
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
        ? await this.appendEvent({
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
        ? await this.appendEvent({
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
        ? await this.appendEvent({
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

      await this.context.repositories.timelineEvents.deleteByRound(completedRound.id);
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
        await this.context.repositories.timelineEvents.save(timelineEvent);
      }
    });
  }

  private async completeMap(input: {
    match: Match;
    mapGame: MapGame;
    teamA: Team;
    teamB: Team;
    winnerTeamId: string;
    completedAt: string;
    roundCompletedEventId: string;
  }): Promise<void> {
    const finalScore = { teamA: input.mapGame.teamAScore, teamB: input.mapGame.teamBScore };
    const mapCompletedEvent = await this.appendEvent({
      id: `evt_${input.mapGame.id}_map_completed`,
      type: "map_completed",
      category: "simulation",
      tournamentId: input.match.tournamentId,
      matchId: input.match.id,
      mapGameId: input.mapGame.id,
      scopeType: "map",
      scopeId: input.mapGame.id,
      payload: {
        schemaVersion: 1,
        mapGameId: input.mapGame.id,
        winnerTeamId: input.winnerTeamId,
        finalScore,
        roundCount: input.mapGame.currentRoundNumber,
        overtimePlayed: input.mapGame.currentRoundNumber > mr6MapRules.regularRounds
      },
      createdAt: input.completedAt
    });
    const roundReports = await this.context.repositories.roundReports.listByMapGame(input.mapGame.id);
    const mapEvents = await this.context.repositories.events.listByMapGame(input.mapGame.id);
    const summary = buildMapSummary({
      match: input.match,
      mapGame: input.mapGame,
      teamA: input.teamA,
      teamB: input.teamB,
      winnerTeamId: input.winnerTeamId,
      roundReports,
      sourceEventIds: [input.roundCompletedEventId, mapCompletedEvent.id, ...mapEvents.filter((event) => event.type === "highlight_detected").map((event) => event.id)],
      createdAt: input.completedAt
    });
    const completedMap: MapGame = {
      ...input.mapGame,
      status: "completed",
      runControlState: "map_review_window",
      winnerTeamId: input.winnerTeamId,
      summaryId: summary.id,
      completedAt: input.completedAt
    };
    const completedMatch: Match = {
      ...input.match,
      teamAMapsWon: input.winnerTeamId === input.teamA.id ? input.match.teamAMapsWon + 1 : input.match.teamAMapsWon,
      teamBMapsWon: input.winnerTeamId === input.teamB.id ? input.match.teamBMapsWon + 1 : input.match.teamBMapsWon
    };
    await this.context.repositories.summaries.save(summary);
    await this.context.repositories.mapGames.save(completedMap);
    await this.context.repositories.matches.save(completedMatch);
    await this.appendEvent({
      id: `evt_${input.mapGame.id}_map_review_window_started`,
      type: "map_review_window_started",
      category: "runtime_control",
      tournamentId: input.match.tournamentId,
      matchId: input.match.id,
      mapGameId: input.mapGame.id,
      scopeType: "map",
      scopeId: input.mapGame.id,
      payload: {
        schemaVersion: 1,
        mapGameId: input.mapGame.id,
        summaryId: summary.id,
        runControlState: "map_review_window",
        reason: "地图已完成，进入本地回放复盘窗口。"
      },
      createdAt: input.completedAt
    });
    if (hasMatchWinner(completedMatch)) {
      await this.completeMatchInCurrentTransaction(completedMatch, input.completedAt);
    }
  }

  private async completeMatch(match: Match): Promise<void> {
    if (match.status === "completed") {
      return;
    }

    if (!hasMatchWinner(match)) {
      throw new Error(`Match ${match.id} cannot complete without a BO3 winner.`);
    }

    await runInTransaction(this.context.repositories, async () => {
      await this.completeMatchInCurrentTransaction(match, timestamp());
    });
  }

  private async completeMatchInCurrentTransaction(match: Match, completedAt: string): Promise<void> {
    if (match.status === "completed") {
      return;
    }
    if (!hasMatchWinner(match)) {
      throw new Error(`Match ${match.id} cannot complete without a BO3 winner.`);
    }

    const [teamA, teamB, mapGames, matchEvents] = (await Promise.all([
      required(this.context.repositories.teams.getById(match.teamAId), `Team not found: ${match.teamAId}`),
      required(this.context.repositories.teams.getById(match.teamBId), `Team not found: ${match.teamBId}`),
      this.context.repositories.mapGames.listByMatch(match.id),
      this.context.repositories.events.listByMatch(match.id)
    ])) as [Team, Team, MapGame[], Event[]];
    const winnerTeamId = match.teamAMapsWon >= 2 ? teamA.id : teamB.id;
    const completedMaps = mapGames.filter((mapGame) => mapGame.status === "completed");
    const mapSummaries = (
      await Promise.all(
        completedMaps.map(async (mapGame) => (mapGame.summaryId ? this.context.repositories.summaries.getById(mapGame.summaryId) : null))
      )
    ).filter((summary: Summary | null): summary is Summary => summary !== null);
    const matchCompletedEvent = await this.appendEvent({
      id: `evt_${match.id}_match_completed`,
      type: "match_completed",
      category: "simulation",
      tournamentId: match.tournamentId,
      matchId: match.id,
      scopeType: "match",
      scopeId: match.id,
      payload: {
        schemaVersion: 1,
        matchId: match.id,
        winnerTeamId,
        teamAMapsWon: match.teamAMapsWon,
        teamBMapsWon: match.teamBMapsWon,
        completedMapIds: completedMaps.map((mapGame) => mapGame.id),
        mapResults: completedMaps.map((mapGame) => ({
          mapGameId: mapGame.id,
          mapName: mapGame.mapName,
          order: mapGame.order,
          winnerTeamId: mapGame.winnerTeamId,
          score: {
            teamA: mapGame.teamAScore,
            teamB: mapGame.teamBScore
          }
        }))
      },
      sourceModule: "core.phase13",
      createdAt: completedAt
    });
    const summary = buildMatchSummary({
      match,
      mapGames: completedMaps,
      teamA,
      teamB,
      winnerTeamId,
      mapSummaries,
      sourceEventIds: [
        matchCompletedEvent.id,
        ...matchEvents.filter((event) => event.type === "map_completed").map((event) => event.id),
        ...mapSummaries.flatMap((mapSummary: Summary) => mapSummary.sourceEventIds)
      ],
      createdAt: completedAt
    });
    const completedMatch: Match = {
      ...match,
      status: "completed",
      winnerTeamId,
      completedAt: match.completedAt ?? completedAt
    };
    await this.context.repositories.summaries.save(summary);
    await this.context.repositories.matches.save(completedMatch);
  }

  private async generateAgentOutputs(input: {
    agents: Agent[];
    round: Round;
    mapGame: MapGame;
    sideContext: SideContext;
    teamA: Team;
    teamB: Team;
    buyTypeByTeam: Map<string, BuyType>;
  }): Promise<AgentOutput[]> {
    const outputs: AgentOutput[] = [];
    for (const agent of input.agents) {
      const response = await this.context.llmGateway.generateStructured<{ fingerprint?: string }, unknown>({
        task: "agent_action",
        driverModelId: agent.driverModelId,
        input: {
          roundId: input.round.id,
          roundNumber: input.round.roundNumber,
          mapName: input.mapGame.mapName,
          agentId: agent.id,
          role: agent.role,
          buyType: input.buyTypeByTeam.get(agent.teamId),
          sideContext: input.sideContext
        },
        schemaName: "AgentOutput",
        seed: `${input.round.id}:${agent.id}`,
        modelTier: "cheap",
        temperature: 0
      });
      const buyType = input.buyTypeByTeam.get(agent.teamId) ?? "eco";
      const posture = sideForTeam(agent.teamId, input.teamA.id, input.sideContext.activeSide) === "active" ? "active-side" : "reactive-side";
      outputs.push({
        id: `out_${input.round.id}_${agent.id}`,
        agentId: agent.id,
        teamId: agent.teamId,
        role: agent.role,
        driverModelId: agent.driverModelId,
        action: `${agent.displayName} uses ${buyType} ${posture} tempo on ${input.mapGame.mapName}`,
        confidence: 0.72 + (stableNumber(agent.id, 18) / 100),
        rawFingerprint: response.data.fingerprint ?? stableHex(`${input.round.id}:${agent.id}`)
      });
    }

    return outputs;
  }

  private async judgeRound(input: {
    mapGame: MapGame;
    roundNumber: number;
    scoreBeforeRound: ScorePair;
    teamA: Team;
    teamB: Team;
    activeA: Agent[];
    activeB: Agent[];
    agentOutputs: AgentOutput[];
  }): Promise<JudgeResult> {
    const plannedWinnerSide = plannedDemoWinnerSideForMap(input.mapGame, input.roundNumber);
    const winnerTeamId = plannedWinnerSide === "teamA" ? input.teamA.id : input.teamB.id;
    const loserTeamId = winnerTeamId === input.teamA.id ? input.teamB.id : input.teamA.id;
    const winnerAgents = winnerTeamId === input.teamA.id ? input.activeA : input.activeB;
    const mvpAgent = winnerAgents.find((agent) => agent.role === "star") ?? winnerAgents[0];
    if (!mvpAgent) {
      throw new Error("Cannot judge round without winner agents.");
    }

    await this.context.llmGateway.generateStructured({
      task: "judge",
      driverModelId: mvpAgent.driverModelId,
      input: {
        roundNumber: input.roundNumber,
        scoreBeforeRound: input.scoreBeforeRound,
        agentOutputs: input.agentOutputs
      },
      schemaName: "JudgeResult",
      seed: `judge:${input.roundNumber}`,
      modelTier: "cheap",
      temperature: 0
    });

    const margin: JudgeResult["margin"] = input.roundNumber % 3 === 0 ? "decisive" : "standard";

    return {
      winnerTeamId,
      loserTeamId,
      margin,
      reason: buildJudgeReason({
        mapName: input.mapGame.mapName,
        roundNumber: input.roundNumber,
        scoreBeforeRound: input.scoreBeforeRound,
        teamA: input.teamA,
        teamB: input.teamB,
        winnerTeamId,
        mvpAgent,
        margin
      }),
      mvpAgentId: mvpAgent.id,
      confidence: 0.84
    };
  }

  private async appendEvent(input: Omit<Event, "globalSequence" | "sequenceInScope">): Promise<Event> {
    const [globalSequence, sequenceInScope] = await Promise.all([
      this.context.repositories.events.getMaxGlobalSequence(),
      this.context.repositories.events.getMaxSequenceInScope(input.scopeType, input.scopeId)
    ]);
    const event: Event = {
      ...input,
      globalSequence: globalSequence + 1,
      sequenceInScope: sequenceInScope + 1,
      sourceModule: input.sourceModule ?? "core.phase12"
    };
    return this.context.repositories.events.append(event);
  }
}

class CompletedRoundError extends Error {
  constructor(readonly round: Round) {
    super(`Round already completed: ${round.id}`);
  }
}

class CompletedMapError extends Error {
  constructor(readonly round: Round) {
    super(`Map already completed after round: ${round.id}`);
  }
}

async function runInTransaction<T>(repositories: Repositories, work: () => T | Promise<T>): Promise<T> {
  const transactional = repositories as TransactionalRepositories;
  if (transactional.transaction) {
    return transactional.transaction(work);
  }

  return work();
}

function initialEconomy(agent: Agent, mapGameId: string, createdAt: string): EconomyState {
  return {
    id: `eco_${mapGameId}_initial_${agent.id}`,
    agentId: agent.id,
    teamId: agent.teamId,
    mapGameId,
    phase: "before_buy",
    tokenBank: 8000,
    buyType: "fullBuy",
    lossStreak: 0,
    timeoutsRemaining: 1,
    visibleContextBudget: 1200,
    outputBudget: 700,
    createdAt
  };
}

function decideTeamBuyType(states: EconomyState[]): BuyType {
  const average = states.reduce((sum, state) => sum + state.tokenBank, 0) / Math.max(1, states.length);
  if (average >= 7000) {
    return "fullBuy";
  }
  if (average >= 4500) {
    return "halfBuy";
  }
  if (average >= 2500) {
    return "forceBuy";
  }

  return "eco";
}

function calculateEconomyDelta(input: {
  beforeEconomy: EconomyState[];
  winnerTeamId: string;
  teamAId: string;
  teamBId: string;
  buyTypeByTeam: Map<string, BuyType>;
}): RoundReport["economyDelta"] {
  const agents: AgentEconomyDelta[] = input.beforeEconomy.map((state) => {
    const buyType = input.buyTypeByTeam.get(state.teamId) ?? state.buyType;
    const spent = spendForBuyType(buyType);
    const won = state.teamId === input.winnerTeamId;
    const reward = won ? 2500 : 1400 + Math.min(state.lossStreak, 3) * 400;
    const afterTokenBank = Math.max(0, state.tokenBank - spent) + reward;
    return {
      agentId: state.agentId,
      teamId: state.teamId,
      beforeTokenBank: state.tokenBank,
      spent,
      reward,
      afterTokenBank,
      buyType,
      lossStreak: won ? 0 : state.lossStreak + 1
    };
  });

  return {
    agents,
    teamTotals: {
      teamA: sumByTeam(agents, input.teamAId),
      teamB: sumByTeam(agents, input.teamBId)
    }
  };
}

function economyStateFromDelta(delta: AgentEconomyDelta, mapGameId: string, roundId: string, createdAt: string): EconomyState {
  return {
    id: `eco_${roundId}_${delta.agentId}`,
    agentId: delta.agentId,
    teamId: delta.teamId,
    mapGameId,
    roundId,
    phase: "after_round",
    tokenBank: delta.afterTokenBank,
    buyType: delta.buyType,
    lossStreak: delta.lossStreak,
    timeoutsRemaining: 1,
    visibleContextBudget: 1200,
    outputBudget: outputBudgetForBuyType(delta.buyType),
    createdAt
  };
}

function buildJudgeReason(input: {
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
  const marginLine = input.margin === "decisive" ? "判定为明确优势回合" : input.margin === "narrow" ? "判定为窄胜回合" : "判定为标准优势回合";
  return `${winnerName} 在 ${input.mapName} 第 ${input.roundNumber} 回合拿分，${input.mvpAgent.displayName} 是本回合 MVP 判定核心；比分 ${formatScore(input.scoreBeforeRound)} -> ${formatScore(scoreAfterRound)}，${pressureLine}，${marginLine}。`;
}

function buildKeyEvents(input: {
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
      zoneId: "conversion_site_a",
      impact: `${mvpAgent.displayName} 在 Conversion Site A 完成${lateEventType === "clutch" ? "残局收束" : "优势转化"}，把回合推进为有效得分。`,
      sourceAgentOutputIds: sourceOutputIds(input.agentOutputs, mvpAgent.id)
    }
  ];

  const winnerBuyType = buyTypeForTeam(input.winnerTeamId, teamAId, input.teamABuyType, input.teamBBuyType);
  const loserBuyType = buyTypeForTeam(input.loserTeamId, teamAId, input.teamABuyType, input.teamBBuyType);
  if (isEconomySwing(input.economyDelta) || winnerBuyType !== loserBuyType) {
    const winnerEconomyDelta = economyTotalForTeam(input.economyDelta, input.winnerTeamId, teamAId);
    const loserEconomyDelta = economyTotalForTeam(input.economyDelta, input.loserTeamId, teamAId);
    events.push({
      id: `ke_${input.roundId}_economy`,
      type: "economy_swing",
      actorAgentId: mvpAgent.id,
      actorTeamId: input.winnerTeamId,
      targetTeamId: input.loserTeamId,
      zoneId: "token_economy",
      impact: `${mvpAgent.displayName} 带队用 ${formatBuyType(winnerBuyType)} 对抗 ${formatBuyType(loserBuyType)}，回合后相对经济变化 ${formatSignedNumber(winnerEconomyDelta - loserEconomyDelta)}。`,
      sourceAgentOutputIds: sourceOutputIds(input.agentOutputs, mvpAgent.id)
    });
  }

  return events;
}

function buildHighlightTags(input: {
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

function buildTimelineEvents(input: {
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
      sourceEventIds: [input.roundStartedEvent.id],
      payload: {
        roundNumber: input.round.roundNumber,
        mapName: input.mapGame.mapName,
        headline: buildRoundHeadline(input.mapGame.mapName, input.roundReport),
        scoreBeforeRound: input.roundReport.scoreBeforeRound,
        sideContext: input.sideContext,
        phaseLabel: formatSidePhase(input.sideContext.phase),
        buyTypes: {
          teamA: input.round.teamABuyType,
          teamB: input.round.teamBBuyType
        }
      }
    },
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
        economySwing: input.roundReport.economyDelta.teamTotals.teamA - input.roundReport.economyDelta.teamTotals.teamB
      }
    },
    ...input.killFeedEvents.map((event, index) => ({
      kind: "kill_feed_item" as const,
      atMs: 20000 + index * 8000,
      durationMs: 5000,
      sourceEventIds: [event.id],
      payload: event.payload
    })),
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
      sourceEventIds: [input.highlightEvent.id, ...(input.replayCardEvent ? [input.replayCardEvent.id] : [])],
      payload: {
        tags: input.roundReport.highlightTags ?? [],
        mvpAgentId: input.roundReport.judgeResult.mvpAgentId,
        reason: input.roundReport.judgeResult.reason,
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
        highlightTags: input.roundReport.highlightTags ?? []
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
  const teamABuy = input.round.teamABuyType ? formatBuyType(input.round.teamABuyType) : "未知买型";
  const teamBBuy = input.round.teamBBuyType ? formatBuyType(input.round.teamBBuyType) : "未知买型";
  return {
    speakerRole: "main_caster",
    text: `第 ${input.round.roundNumber} 回合开局，${formatSidePhase(input.sideContext.phase)}，比分 ${formatScore(input.roundReport.scoreBeforeRound)}。${input.teamA.shortName} ${teamABuy} 对 ${input.teamB.shortName} ${teamBBuy}，先看第一波资源分配。`,
    reason: "基于回合开局、比分、半场和买型信息生成。",
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

function buildSummary(input: {
  roundNumber: number;
  winnerTeamId: string;
  teamA: Team;
  teamB: Team;
  mapName: string;
  keyEvents: RoundKeyEvent[];
  scoreBeforeRound: ScorePair;
  scoreAfterRound: ScorePair;
  sideContext: SideContext;
  teamABuyType: BuyType;
  teamBBuyType: BuyType;
  highlightTags: string[];
}): string {
  const winnerName = input.winnerTeamId === input.teamA.id ? input.teamA.displayName : input.teamB.displayName;
  const winnerBuyType = input.winnerTeamId === input.teamA.id ? input.teamABuyType : input.teamBBuyType;
  const loserBuyType = input.winnerTeamId === input.teamA.id ? input.teamBBuyType : input.teamABuyType;
  const keyLine = input.keyEvents.slice(0, 2).map((event) => event.impact).join(" ");
  const sideLine = input.sideContext.activeSide === "teamA" ? `${input.teamA.shortName} 主动侧` : `${input.teamB.shortName} 主动侧`;
  const highlightLine = summarizeHighlightTags(input.highlightTags);
  return `${winnerName} 在 ${input.mapName} 第 ${input.roundNumber} 回合完成收束，比分 ${formatScore(input.scoreBeforeRound)} -> ${formatScore(input.scoreAfterRound)}。${sideLine}，购买对位为 ${formatBuyType(winnerBuyType)} 对 ${formatBuyType(loserBuyType)}。关键事件：${keyLine}${highlightLine}`;
}

function buildMapSummary(input: {
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

function describeScorePressure(input: {
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

function advanceScore(score: ScorePair, winnerTeamId: string, teamAId: string): ScorePair {
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

function isEconomySwing(economyDelta: RoundReport["economyDelta"]): boolean {
  return Math.abs(economyDelta.teamTotals.teamA - economyDelta.teamTotals.teamB) >= 2000;
}

function economyTotalForTeam(economyDelta: RoundReport["economyDelta"], teamId: string, teamAId: string): number {
  return teamId === teamAId ? economyDelta.teamTotals.teamA : economyDelta.teamTotals.teamB;
}

function buyTypeForTeam(teamId: string, teamAId: string, teamABuyType: BuyType, teamBBuyType: BuyType): BuyType {
  return teamId === teamAId ? teamABuyType : teamBBuyType;
}

function formatBuyType(buyType: BuyType): string {
  switch (buyType) {
    case "fullBuy":
      return "全甲全弹";
    case "halfBuy":
      return "半起";
    case "forceBuy":
      return "强起";
    case "save":
      return "保枪";
    case "eco":
      return "经济局";
  }
}

function formatScore(score: ScorePair): string {
  return `${score.teamA}-${score.teamB}`;
}

function formatSignedNumber(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

function buildMatchSummary(input: {
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

function requiredProjection(event: Event): ProjectedEvent {
  return {
    type: event.type,
    eventId: event.id,
    required: true
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
  return "2026-05-01T00:00:00.000Z";
}

const defaultPhase13MapIds = ["DUST2", "INFERNO", "MIRAGE"] as const;

function normalizeSelectedMapIds(selectedMapIds: string[] | undefined, maxMaps: number | undefined): string[] {
  if (maxMaps !== undefined && (!Number.isInteger(maxMaps) || maxMaps < 2)) {
    throw new Error(`BO3 requires at least 2 maps, received maxMaps=${maxMaps}.`);
  }

  const mapLimit = Math.min(maxMaps ?? 3, 3);
  const candidates = selectedMapIds && selectedMapIds.length > 0 ? selectedMapIds : [...defaultPhase13MapIds];
  const normalized = candidates.slice(0, mapLimit);
  if (normalized.length < 2) {
    throw new Error(`BO3 requires at least 2 selected maps, received ${normalized.length}.`);
  }

  return normalized;
}

function hasMatchWinner(match: Match): boolean {
  return match.teamAMapsWon >= 2 || match.teamBMapsWon >= 2;
}

function plannedDemoWinnerSideForMap(mapGame: MapGame, roundNumber: number): "teamA" | "teamB" {
  const baseWinnerSide = plannedDemoWinnerSide(roundNumber);
  const mapWinnerSide = plannedDemoMapWinnerSide(mapGame.mapName);
  return mapWinnerSide === "teamA" ? baseWinnerSide : invertSide(baseWinnerSide);
}

function plannedDemoMapWinnerSide(mapName: string): "teamA" | "teamB" {
  switch (mapName.toUpperCase()) {
    case "INFERNO":
    case "NUKE":
      return "teamB";
    default:
      return "teamA";
  }
}

function invertSide(side: "teamA" | "teamB"): "teamA" | "teamB" {
  return side === "teamA" ? "teamB" : "teamA";
}

function readStringArrayPayloadField(payload: unknown, fieldName: string): string[] {
  if (!isRecord(payload)) {
    return [];
  }

  const value = payload[fieldName];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function sortAgentsForRound(agents: Agent[]): Agent[] {
  const rank = new Map<string, number>([
    ["entry", 0],
    ["star", 1],
    ["closer", 2],
    ["igl", 3],
    ["support", 4],
    ["lurker", 5],
    ["coach", 6]
  ]);
  return [...agents].sort((left, right) => (rank.get(left.role) ?? 99) - (rank.get(right.role) ?? 99) || left.id.localeCompare(right.id));
}

function spendForBuyType(buyType: BuyType): number {
  switch (buyType) {
    case "fullBuy":
      return 5200;
    case "halfBuy":
      return 3200;
    case "forceBuy":
      return 2500;
    case "save":
      return 600;
    case "eco":
      return 900;
  }
}

function outputBudgetForBuyType(buyType: BuyType): number {
  switch (buyType) {
    case "fullBuy":
      return 700;
    case "halfBuy":
      return 500;
    case "forceBuy":
      return 420;
    case "save":
      return 240;
    case "eco":
      return 300;
  }
}

function sumByTeam(items: AgentEconomyDelta[], teamId: string): number {
  return items.filter((item) => item.teamId === teamId).reduce((sum, item) => sum + item.afterTokenBank - item.beforeTokenBank, 0);
}

function sourceOutputIds(outputs: AgentOutput[], agentId: string): string[] {
  return outputs.filter((output) => output.agentId === agentId).map((output) => output.id);
}

function sideForTeam(teamId: string, teamAId: string, activeSide: "teamA" | "teamB"): "active" | "reactive" {
  const side = teamId === teamAId ? "teamA" : "teamB";
  return side === activeSide ? "active" : "reactive";
}

function isOvertimeEconomyResetRound(roundNumber: number): boolean {
  return roundNumber > mr6MapRules.regularRounds && (roundNumber - mr6MapRules.regularRounds - 1) % mr6MapRules.overtimeMaxRounds === 0;
}

function mostFrequent(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? "unknown";
}

function stableNumber(input: string, modulo: number): number {
  return Number.parseInt(stableHex(input).slice(0, 4), 16) % modulo;
}

function stableHex(input: string): string {
  let hash = 2166136261;
  for (const char of input) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
