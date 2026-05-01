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

import { evaluateMapState, getSideContext, mr6MapRules, plannedDemoWinnerSide, type SideContext } from "./map-rules.js";

export interface EngineContext {
  repositories: Repositories;
  llmGateway: LlmGateway;
  jobQueue: JobQueue;
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

export interface SimulationEngine {
  startMatch(input: StartMatchInput): Promise<Match>;
  completeVeto(input: CompleteVetoInput): Promise<Match>;
  startMap(input: StartMapInput): Promise<MapGame>;
  playNextRound(input: PlayNextRoundInput): Promise<Round>;
  runCurrentMap(input: RunCurrentMapInput): Promise<RunCurrentMapResult>;
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
    }
  };
}

export function createPhase11SimulationEngine(context: EngineContext): SimulationEngine {
  return new Phase12SimulationEngine(context);
}

export function createPhase12SimulationEngine(context: EngineContext): SimulationEngine {
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
    const maps = await this.context.repositories.mapGames.listByMatch(match.id);
    if ((match.status === "running" || match.status === "completed") && maps.length > 0) {
      return match;
    }

    const now = timestamp();
    const selectedMapIds = input.selectedMapIds.length > 0 ? input.selectedMapIds : ["DUST2"];
    if (maps.length === 0) {
      for (const [index, mapName] of selectedMapIds.entries()) {
        await this.context.repositories.mapGames.save({
          id: `map_${match.id}_${index + 1}`,
          matchId: match.id,
          mapName,
          order: index + 1,
          status: "scheduled",
          runControlState: "idle",
          teamAScore: 0,
          teamBScore: 0,
          currentRoundNumber: 0,
          createdAt: now
        });
      }
    }

    const updated: Match = {
      ...match,
      status: "running",
      startedAt: match.startedAt ?? now
    };
    await this.context.repositories.matches.save(updated);
    await this.appendEvent({
      id: `evt_${match.id}_map_veto_completed`,
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

  private async buildRunCurrentMapResult(mapGame: MapGame): Promise<RunCurrentMapResult> {
    const rounds = (await this.context.repositories.rounds.listByMapGame(mapGame.id)).filter((round) => round.status === "completed");
    const mapSummary = mapGame.summaryId ? await this.context.repositories.summaries.getById(mapGame.summaryId) : null;
    return mapSummary ? { mapGame, rounds, mapSummary } : { mapGame, rounds };
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
    const beforeEconomy = await Promise.all(
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
    const economyStates = economyDelta.agents.map((delta) => economyStateFromDelta(delta, mapGame.id, roundId, now));
    const keyEvents = buildKeyEvents({
      roundId,
      winnerTeamId,
      loserTeamId,
      activeA,
      activeB,
      agentOutputs,
      mvpAgentId: judgeResult.mvpAgentId
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
      return await runInTransaction(this.context.repositories, async () => {
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
            tags: ["phase12_demo", generation.judgeResult.margin === "decisive" ? "decisive_round" : "swing_round"],
            mvpAgentId: generation.judgeResult.mvpAgentId
          },
          createdAt: now
        });

        const roundReportEventId = `evt_${round.id}_round_report_created`;
        const roundCompletedEventId = `evt_${round.id}_round_completed`;
        const coreProjection: ProjectedEvent[] = [
          requiredProjection(judgeEvent),
          requiredProjection(scoreEvent),
          requiredProjection(economyEvent),
          { type: "round_report_created", eventId: roundReportEventId, required: true },
          { type: "round_completed", eventId: roundCompletedEventId, required: true }
        ];
        const broadcastProjection: ProjectedEvent[] = [...killFeedEvents, highlightEvent].map((event) => ({
          type: event.type,
          eventId: event.id,
          required: false
        }));
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
              reason: "Phase 1.2 deterministic output gate"
            }
          },
          highlightTags: ["phase12_demo", generation.judgeResult.winnerTeamId === teamA.id ? "team_a_round" : "team_b_round"],
          summary: buildSummary({
            winnerTeamId: generation.judgeResult.winnerTeamId,
            teamA,
            teamB,
            mapName: mapGame.mapName,
            keyEvents: generation.keyEvents,
            scoreAfterRound: generation.scoreAfterRound,
            sideContext: generation.sideContext
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
            keyEventCount: roundReport.keyEvents.length
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

        await this.context.repositories.timelineEvents.deleteByRound(round.id);
        const timelineEvents = buildTimelineEvents({
          match,
          mapGame,
          round: completedRound,
          roundReport,
          sideContext: generation.sideContext,
          roundStartedEvent,
          scoreEvent,
          economyEvent,
          killFeedEvents,
          highlightEvent,
          roundReportEvent,
          roundCompletedEvent,
          createdAt: now
        });
        for (const timelineEvent of timelineEvents) {
          await this.context.repositories.timelineEvents.save(timelineEvent);
        }

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

        return completedRound;
      });
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
        reason: "Phase 1.2 map completed and awaits review confirmation."
      },
      createdAt: input.completedAt
    });
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
    roundNumber: number;
    scoreBeforeRound: ScorePair;
    teamA: Team;
    teamB: Team;
    activeA: Agent[];
    activeB: Agent[];
    agentOutputs: AgentOutput[];
  }): Promise<JudgeResult> {
    const plannedWinnerSide = plannedDemoWinnerSide(input.roundNumber);
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

    return {
      winnerTeamId,
      loserTeamId,
      margin: input.roundNumber % 3 === 0 ? "decisive" : "standard",
      reason: `Round ${input.roundNumber} resolved by deterministic Phase 1.2 judge.`,
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

function buildKeyEvents(input: {
  roundId: string;
  winnerTeamId: string;
  loserTeamId: string;
  activeA: Agent[];
  activeB: Agent[];
  agentOutputs: AgentOutput[];
  mvpAgentId: string;
}): RoundKeyEvent[] {
  const winnerAgents = input.winnerTeamId === input.activeA[0]?.teamId ? input.activeA : input.activeB;
  const loserAgents = input.loserTeamId === input.activeA[0]?.teamId ? input.activeA : input.activeB;
  const entryAgent = winnerAgents.find((agent) => agent.role === "entry") ?? winnerAgents[0];
  const mvpAgent = winnerAgents.find((agent) => agent.id === input.mvpAgentId) ?? winnerAgents[0];
  const targetAgent = loserAgents[0];
  if (!entryAgent || !mvpAgent || !targetAgent) {
    throw new Error("Cannot build key events without active winner and loser agents.");
  }

  return [
    {
      id: `ke_${input.roundId}_entry`,
      type: "entry",
      actorAgentId: entryAgent.id,
      actorTeamId: input.winnerTeamId,
      targetAgentId: targetAgent.id,
      targetTeamId: input.loserTeamId,
      zoneId: "buyer_mid",
      impact: `${entryAgent.displayName} opens Buyer Mid control.`,
      sourceAgentOutputIds: sourceOutputIds(input.agentOutputs, entryAgent.id)
    },
    {
      id: `ke_${input.roundId}_clutch`,
      type: "clutch",
      actorAgentId: mvpAgent.id,
      actorTeamId: input.winnerTeamId,
      targetAgentId: targetAgent.id,
      targetTeamId: input.loserTeamId,
      zoneId: "conversion_site_a",
      impact: `${mvpAgent.displayName} converts the late round at Site A.`,
      sourceAgentOutputIds: sourceOutputIds(input.agentOutputs, mvpAgent.id)
    }
  ];
}

function buildTimelineEvents(input: {
  match: Match;
  mapGame: MapGame;
  round: Round;
  roundReport: RoundReport;
  sideContext: SideContext;
  roundStartedEvent: Event;
  scoreEvent: Event;
  economyEvent: Event;
  killFeedEvents: Event[];
  highlightEvent: Event;
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
        scoreBeforeRound: input.roundReport.scoreBeforeRound,
        sideContext: input.sideContext
      }
    },
    {
      kind: "scoreboard_update",
      atMs: 5000,
      durationMs: 3000,
      sourceEventIds: [input.scoreEvent.id],
      payload: {
        scoreAfterRound: input.roundReport.scoreAfterRound
      }
    },
    {
      kind: "economy_panel_update",
      atMs: 10000,
      durationMs: 5000,
      sourceEventIds: [input.economyEvent.id],
      payload: {
        economyDelta: input.roundReport.economyDelta
      }
    },
    ...input.killFeedEvents.map((event, index) => ({
      kind: "kill_feed_item" as const,
      atMs: 20000 + index * 8000,
      durationMs: 5000,
      sourceEventIds: [event.id],
      payload: event.payload
    })),
    {
      kind: "caster_line",
      atMs: 44000,
      durationMs: 7000,
      sourceEventIds: [input.roundReportEvent.id],
      payload: {
        text: input.roundReport.summary
      }
    },
    {
      kind: "highlight_reveal",
      atMs: 54000,
      durationMs: 5000,
      sourceEventIds: [input.highlightEvent.id],
      payload: {
        tags: input.roundReport.highlightTags ?? [],
        mvpAgentId: input.roundReport.judgeResult.mvpAgentId
      }
    },
    {
      kind: "round_result",
      atMs: 62000,
      durationMs: 5000,
      sourceEventIds: [input.roundCompletedEvent.id],
      payload: {
        winnerTeamId: input.roundReport.winnerTeamId,
        scoreAfterRound: input.roundReport.scoreAfterRound
      }
    },
    {
      kind: "round_outro",
      atMs: 69000,
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

function buildSummary(input: {
  winnerTeamId: string;
  teamA: Team;
  teamB: Team;
  mapName: string;
  keyEvents: RoundKeyEvent[];
  scoreAfterRound: ScorePair;
  sideContext: SideContext;
}): string {
  const winnerName = input.winnerTeamId === input.teamA.id ? input.teamA.displayName : input.teamB.displayName;
  const keyLine = input.keyEvents.map((event) => event.impact).join(" ");
  const sideLine = input.sideContext.activeSide === "teamA" ? `${input.teamA.shortName} 主动侧` : `${input.teamB.shortName} 主动侧`;
  return `${winnerName} 在 ${input.mapName} 完成 Phase 1.2 回合推进。${sideLine}。${keyLine} 当前比分 ${input.scoreAfterRound.teamA}-${input.scoreAfterRound.teamB}。`;
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
  const keyRounds = input.roundReports
    .filter((report) => report.judgeResult.margin === "decisive" || report.highlightTags?.includes("team_a_round"))
    .slice(-4)
    .map((report) => ({
      roundNumber: report.roundNumber,
      winnerTeamId: report.winnerTeamId,
      scoreAfterRound: report.scoreAfterRound,
      reason: report.judgeResult.reason
    }));
  const economySwingRounds = input.roundReports
    .filter((report) => Math.abs(report.economyDelta.teamTotals.teamA - report.economyDelta.teamTotals.teamB) >= 2000)
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
