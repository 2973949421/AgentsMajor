import type { Repositories } from "@agent-major/db";
import type { LlmGateway, LlmMessage, LlmResponse } from "@agent-major/llm";
import type { JobQueue } from "@agent-major/queue";
import {
  agentActionDecisionSchema,
  judgeResultSchema,
  teamRoundPlanDecisionSchema,
  type Agent,
  type AgentActionDecision,
  type AgentEconomyDelta,
  type AgentOutput,
  type BuyType,
  type EconomyState,
  type Event,
  type JudgeResult,
  type MapGame,
  type Match,
  type ProjectedEvent,
  type Round,
  type RoundKeyEvent,
  type RoundReport,
  type ScorePair,
  type SideAssignment,
  type Summary,
  type TacticalCollision,
  type Team,
  type TeamRoundPlanDecision,
  type TimelineEvent,
  type TimelineEventKind
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
import type { ArtifactStore } from "./ports.js";
import {
  assertNoForbiddenTacticalFields,
  buildPublicTacticalContext,
  buildRuleBasedTacticalPlans,
  createSideAssignment,
  getPhase16TacticalMapLayout,
  resolveTacticalCollision,
  type RuleBasedTacticalPlans,
  type TacticalRoundGeneration
} from "./tactical-protocol.js";

export interface EngineContext {
  repositories: Repositories;
  llmGateway: LlmGateway;
  jobQueue: JobQueue;
  artifactStore?: ArtifactStore;
  broadcastGenerator?: RoundBroadcastGenerator;
  tacticalProtocol?: "disabled" | "rule";
  activeAgentsPerTeam?: number;
  useLlmTeamPlans?: boolean;
  useLlmAgentActions?: boolean;
  useLlmJudgeResults?: boolean;
  useJudgeBiasGuardrail?: boolean;
  phase18MapSemanticsByMapName?: Record<string, Record<string, unknown>>;
  eventSourceModule?: string;
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
  observabilityAttempt: number;
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
  teamPlans?: Record<string, TeamRoundPlanDecision>;
  agentOutputs: AgentOutput[];
  judgeResult: JudgeResult;
  tacticalRound?: TacticalRoundGeneration;
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
  sideAssignmentEvent?: Event;
  tacticalPlanEvent?: Event;
  zoneDeploymentEvent?: Event;
  siteExecuteEvent?: Event;
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

interface Phase18JudgePromptContext {
  requestInput: {
    sideAssignment: SideAssignment;
    buyTypesByTeam: Record<string, BuyType>;
    mapSemanticContext?: Record<string, unknown>;
    judgeRubricContext?: Record<string, unknown>;
    evaluationOrder: Array<{
      teamId: string;
      teamName: string;
      activeAgents: Array<{ id: string; role: string }>;
      teamPlan?: TeamRoundPlanDecision;
      teamStrategy?: Record<string, unknown>;
      coachContext?: Record<string, unknown>;
    }>;
    teamAId: string;
    teamBId: string;
    teamAName: string;
    teamBName: string;
    activeTeamAAgentIds: string[];
    activeTeamBAgentIds: string[];
    agentOutputsByTeam: Record<string, AgentOutput[]>;
    recentPublicRoundSummaries: string[];
  };
  actualTeamPlans?: Record<string, TeamRoundPlanDecision>;
  validateAndTranslate(judgeResult: JudgeResult): JudgeResult;
  translatePromptText(value: string): string;
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

export function createPhase16SimulationEngine(context: EngineContext): SimulationEngine {
  return new Phase12SimulationEngine({ ...context, tacticalProtocol: "rule" });
}

export function createPhase18SimulationEngine(context: EngineContext): SimulationEngine {
  return new Phase12SimulationEngine({
    ...context,
    tacticalProtocol: "rule",
    activeAgentsPerTeam: 5,
    useLlmTeamPlans: true,
    useLlmAgentActions: true,
    useLlmJudgeResults: true,
    useJudgeBiasGuardrail: true,
    eventSourceModule: "core.phase18"
  });
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

  private async readRoundObservabilityAttempt(matchId: string, roundId: string): Promise<number> {
    const events = await this.context.repositories.events.listByMatch(matchId);
    const attempts = new Set<number>();
    for (const event of events) {
      if (event.type !== "llm_call_started") {
        continue;
      }

      const payload = isRecord(event.payload) ? event.payload : null;
      if (!payload || payload.roundId !== roundId) {
        continue;
      }

      attempts.add(typeof payload.attemptNumber === "number" && payload.attemptNumber > 0 ? payload.attemptNumber : 1);
    }

    return attempts.size + 1;
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
    const activeAgentsPerTeam = this.context.activeAgentsPerTeam ?? 3;
    const activeA = teamAAgents.slice(0, activeAgentsPerTeam);
    const activeB = teamBAgents.slice(0, activeAgentsPerTeam);
    if (activeA.length < activeAgentsPerTeam || activeB.length < activeAgentsPerTeam) {
      throw new Error(`Both teams must have at least ${activeAgentsPerTeam} active agents before playNextRound.`);
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
    const observabilityAttempt = await this.readRoundObservabilityAttempt(match.id, roundId);
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
    const buyTypeByTeam = new Map<string, BuyType>([
      [teamA.id, teamABuyType],
      [teamB.id, teamBBuyType]
    ]);
    const sideAssignment = createSideAssignment({
      roundId,
      roundNumber,
      teamAId: teamA.id,
      teamBId: teamB.id,
      sideContext
    });
    const recentRoundReports = (await this.context.repositories.roundReports.listByMapGame(mapGame.id)).slice(-3);
    const recentPublicRoundSummaries = recentRoundReports.map((report) => report.summary);
    const tacticalPlans =
      this.context.tacticalProtocol === "rule"
        ? buildRuleBasedTacticalPlans({
            round,
            mapGame,
            teamA,
            teamB,
            activeAgentsByTeam: {
              [teamA.id]: activeA,
              [teamB.id]: activeB
            },
            buyTypeByTeam: Object.fromEntries(buyTypeByTeam),
            economyByTeam: {
              [teamA.id]: sumEconomyByTeam(beforeEconomy, teamA.id),
              [teamB.id]: sumEconomyByTeam(beforeEconomy, teamB.id)
            },
            recentPublicRoundSummaries,
            tacticalMapLayout: getPhase16TacticalMapLayout(mapGame.mapName),
            sideAssignment
          })
        : undefined;
    const teamPlans = this.context.useLlmTeamPlans
      ? await this.generateTeamPlans({
          match,
          round,
          observabilityAttempt,
          mapGame,
          sideContext,
          sideAssignment,
          scoreBeforeRound,
          teamA,
          teamB,
          activeA,
          activeB,
          buyTypeByTeam,
          beforeEconomy,
          ...(tacticalPlans ? { tacticalPlans } : {}),
          recentPublicRoundSummaries
        })
      : undefined;

    const agentOutputs = await this.generateAgentOutputs({
      match,
      agents: allActive,
      round,
      observabilityAttempt,
      mapGame,
      sideContext,
      teamA,
      teamB,
      buyTypeByTeam,
      ...(teamPlans ? { teamPlans } : {})
    });
    const judgeResult = await this.judgeRound({
      match,
      round,
      observabilityAttempt,
      mapGame,
      roundNumber,
      scoreBeforeRound,
      teamA,
      teamB,
      activeA,
      activeB,
      teamABuyType,
      teamBBuyType,
      sideAssignment,
      ...(teamPlans ? { teamPlans } : {}),
      agentOutputs,
      recentPublicRoundSummaries,
      recentWinnerTeamIds: recentRoundReports.map((report) => report.winnerTeamId)
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
      buyTypeByTeam
    });
    const economyStates = (economyDelta.agents as AgentEconomyDelta[]).map((delta) => economyStateFromDelta(delta, mapGame.id, roundId, now));
    const tacticalRound =
      tacticalPlans && sideAssignment
        ? (() => {
            const collision = resolveTacticalCollision({
              ...tacticalPlans,
              sideAssignment,
              buyTypeByTeam: Object.fromEntries(buyTypeByTeam),
              scoreBeforeRound,
              judgeResult,
              teamAId: teamA.id,
              activeAgentsById: Object.fromEntries(allActive.map((agent) => [agent.id, agent]))
            });
            const tacticalContext = buildPublicTacticalContext({
              ...tacticalPlans,
              sideAssignment,
              collision
            });
            return {
              ...tacticalPlans,
              sideAssignment,
              collision,
              tacticalContext
            };
          })()
        : undefined;
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
      teamBBuyType,
      ...(tacticalRound ? { tacticalCollision: tacticalRound.collision } : {})
    });

    return {
      match,
      mapGame,
      teamA,
      teamB,
      round,
      observabilityAttempt,
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
      ...(teamPlans ? { teamPlans } : {}),
      agentOutputs,
      judgeResult,
      ...(tacticalRound ? { tacticalRound } : {}),
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
        let sideAssignmentEvent: Event | undefined;
        let tacticalPlanEvent: Event | undefined;
        let zoneDeploymentEvent: Event | undefined;
        if (generation.tacticalRound) {
          const sidePayload = {
            schemaVersion: 1,
            sideAssignment: generation.tacticalRound.sideAssignment,
            source: "phase16_side_rule" as const
          };
          assertNoForbiddenTacticalFields(sidePayload);
          sideAssignmentEvent = await this.appendEvent({
            id: `evt_${round.id}_side_assignment`,
            type: "side_assignment_created",
            category: "simulation",
            tournamentId: match.tournamentId,
            matchId: match.id,
            mapGameId: mapGame.id,
            roundId: round.id,
            scopeType: "round",
            scopeId: round.id,
            payload: sidePayload,
            createdAt: now
          });

          const tacticalPlanPayload = {
            schemaVersion: 1,
            visibility: "restricted" as const,
            teamId: generation.tacticalRound.attackPlan.teamId,
            roundId: round.id,
            publicSummary: generation.tacticalRound.tacticalContext.attackPlan.publicSummary,
            attackPlanSummary: {
              primaryTargetZoneId: generation.tacticalRound.attackPlan.primaryTargetZoneId,
              ...(generation.tacticalRound.attackPlan.secondaryTargetZoneId
                ? { secondaryTargetZoneId: generation.tacticalRound.attackPlan.secondaryTargetZoneId }
                : {}),
              approach: generation.tacticalRound.attackPlan.approach,
              feintRevealed: false as const
            },
            sourceEventIds: [sideAssignmentEvent.id]
          };
          assertNoForbiddenTacticalFields(tacticalPlanPayload);
          tacticalPlanEvent = await this.appendEvent({
            id: `evt_${round.id}_tactical_plan`,
            type: "tactical_plan_submitted",
            category: "simulation",
            tournamentId: match.tournamentId,
            matchId: match.id,
            mapGameId: mapGame.id,
            roundId: round.id,
            scopeType: "round",
            scopeId: round.id,
            payload: tacticalPlanPayload,
            createdAt: now
          });

          const zoneDeploymentPayload = {
            schemaVersion: 1,
            visibility: "restricted" as const,
            teamId: generation.tacticalRound.defenseDeployment.teamId,
            roundId: round.id,
            publicSummary: generation.tacticalRound.tacticalContext.defenseDeployment.publicSummary,
            defenseDeploymentSummary: {
              setup: generation.tacticalRound.defenseDeployment.setup,
              ...(generation.tacticalRound.defenseDeployment.heavyZoneId ? { heavyZoneId: generation.tacticalRound.defenseDeployment.heavyZoneId } : {}),
              weakZoneIds: generation.tacticalRound.defenseDeployment.weakZoneIds,
              rotatePolicy: generation.tacticalRound.defenseDeployment.rotatePolicy
            },
            sourceEventIds: [sideAssignmentEvent.id]
          };
          assertNoForbiddenTacticalFields(zoneDeploymentPayload);
          zoneDeploymentEvent = await this.appendEvent({
            id: `evt_${round.id}_zone_deployment`,
            type: "zone_deployment_committed",
            category: "simulation",
            tournamentId: match.tournamentId,
            matchId: match.id,
            mapGameId: mapGame.id,
            roundId: round.id,
            scopeType: "round",
            scopeId: round.id,
            payload: zoneDeploymentPayload,
            createdAt: now
          });
        }

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
        let siteExecuteEvent: Event | undefined;
        if (generation.tacticalRound && tacticalPlanEvent && zoneDeploymentEvent) {
          const siteExecutePayload = {
            schemaVersion: 1,
            visibility: "public_after_round" as const,
            roundId: round.id,
            collision: generation.tacticalRound.collision,
            revealedAttackPlan: generation.tacticalRound.tacticalContext.attackPlan,
            revealedDefenseDeployment: generation.tacticalRound.tacticalContext.defenseDeployment,
            sourceEventIds: [tacticalPlanEvent.id, zoneDeploymentEvent.id, judgeEvent.id]
          };
          assertNoForbiddenTacticalFields(siteExecutePayload);
          siteExecuteEvent = await this.appendEvent({
            id: `evt_${round.id}_site_execute`,
            type: "site_execute_resolved",
            category: "judge",
            tournamentId: match.tournamentId,
            matchId: match.id,
            mapGameId: mapGame.id,
            roundId: round.id,
            scopeType: "round",
            scopeId: round.id,
            payload: siteExecutePayload,
            createdAt: now
          });
        }
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
          ...[sideAssignmentEvent, tacticalPlanEvent, zoneDeploymentEvent, siteExecuteEvent]
            .filter((event): event is Event => Boolean(event))
            .map((event) => requiredProjection(event)),
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
          ...(generation.teamPlans ? { llmTeamPlans: generation.teamPlans } : {}),
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
          ...(generation.tacticalRound ? { tacticalContext: generation.tacticalRound.tacticalContext } : {}),
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
            highlightTags,
            tacticalContext: generation.tacticalRound?.tacticalContext
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
            judgeReason: roundReport.judgeResult.reason,
            ...(roundReport.tacticalContext
              ? {
                  tacticalContext: {
                    sideAssignment: roundReport.tacticalContext.sideAssignment,
                    attackPlan: roundReport.tacticalContext.attackPlan,
                    defenseDeployment: roundReport.tacticalContext.defenseDeployment,
                    collision: roundReport.tacticalContext.collision
                  }
                }
              : {})
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
          ...(sideAssignmentEvent ? { sideAssignmentEvent } : {}),
          ...(tacticalPlanEvent ? { tacticalPlanEvent } : {}),
          ...(zoneDeploymentEvent ? { zoneDeploymentEvent } : {}),
          ...(siteExecuteEvent ? { siteExecuteEvent } : {}),
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

  private async generateTeamPlans(input: {
    match: Match;
    round: Round;
    observabilityAttempt: number;
    mapGame: MapGame;
    sideContext: SideContext;
    sideAssignment: SideAssignment;
    scoreBeforeRound: ScorePair;
    teamA: Team;
    teamB: Team;
    activeA: Agent[];
    activeB: Agent[];
    buyTypeByTeam: Map<string, BuyType>;
    beforeEconomy: EconomyState[];
    tacticalPlans?: RuleBasedTacticalPlans;
    recentPublicRoundSummaries: string[];
  }): Promise<Record<string, TeamRoundPlanDecision>> {
    const sides = [
      { team: input.teamA, opponent: input.teamB, activeAgents: input.activeA },
      { team: input.teamB, opponent: input.teamA, activeAgents: input.activeB }
    ];
    const output: Record<string, TeamRoundPlanDecision> = {};

    for (const side of sides) {
      const teamSide = side.team.id === input.sideAssignment.attackingTeamId ? "attack" : "defense";
      const response = await this.runObservedStructuredCall<TeamRoundPlanDecision>({
        callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_team_${safeId(side.team.id)}_team_plan`,
        attemptNumber: input.observabilityAttempt,
        task: "team_plan",
        schemaName: "TeamRoundPlanDecision",
        driverModelId: side.activeAgents[0]?.driverModelId ?? "",
        requestInput: {
          objective: "Create one coherent team plan for this round. Every player action will be generated from this plan.",
          roundId: input.round.id,
          roundNumber: input.round.roundNumber,
          mapName: input.mapGame.mapName,
          mapSemanticContext: readPhase18MapSemanticContext(this.context, input.mapGame.mapName),
          teamId: side.team.id,
          teamName: side.team.displayName,
          teamStrategy: readTeamMaterialStrategy(side.team),
          coachContext: readTeamHeadCoachProfile(side.team),
          opponentTeamId: side.opponent.id,
          opponentTeamName: side.opponent.displayName,
          opponentStrategySummary: readOpponentStrategySummary(side.opponent),
          side: teamSide,
          sideAssignment: input.sideAssignment,
          scoreBeforeRound: input.scoreBeforeRound,
          buyType: input.buyTypeByTeam.get(side.team.id) ?? "eco",
          teamEconomy: sumEconomyByTeam(input.beforeEconomy, side.team.id),
          activeAgents: side.activeAgents.map((agent) => ({
            id: agent.id,
            displayName: agent.displayName,
            role: agent.role,
            secondaryRoles: agent.secondaryRoles ?? [],
            roleResponsibilities: agent.roleProfile?.agentMajorResponsibilities ?? [],
            baseProfile: agent.baseProfile
          })),
          tacticalHint:
            teamSide === "attack"
              ? input.tacticalPlans?.attackPlan
              : input.tacticalPlans?.defenseDeployment,
          recentPublicRoundSummaries: input.recentPublicRoundSummaries
        },
        responseFormat: "json_object",
        seed: `team_plan:${input.round.id}:${side.team.id}`,
        modelTier: "cheap",
        temperature: 0,
        match: input.match,
        mapGame: input.mapGame,
        round: input.round,
        roundNumber: input.round.roundNumber,
        validateResponseData: (data) =>
          validateTeamRoundPlan({
            plan: teamRoundPlanDecisionSchema.parse(data),
            teamId: side.team.id,
            expectedSide: teamSide,
            activeAgents: side.activeAgents
          })
      });
      output[side.team.id] = response.data;
    }

    return output;
  }

  private async generateAgentOutputs(input: {
    match: Match;
    agents: Agent[];
    round: Round;
    observabilityAttempt: number;
    mapGame: MapGame;
    sideContext: SideContext;
    teamA: Team;
    teamB: Team;
    buyTypeByTeam: Map<string, BuyType>;
    teamPlans?: Record<string, TeamRoundPlanDecision>;
  }): Promise<AgentOutput[]> {
    const outputs: AgentOutput[] = [];
    for (const agent of input.agents) {
      const buyType = input.buyTypeByTeam.get(agent.teamId) ?? "eco";
      const posture = sideForTeam(agent.teamId, input.teamA.id, input.sideContext.activeSide) === "active" ? "active-side" : "reactive-side";
      const agentTeam = agent.teamId === input.teamA.id ? input.teamA : input.teamB;
      const opponentTeam = agent.teamId === input.teamA.id ? input.teamB : input.teamA;
      const teamPlan = input.teamPlans?.[agent.teamId];
      const playerDirective = teamPlan?.playerDirectives.find(
        (directive: TeamRoundPlanDecision["playerDirectives"][number]) => directive.agentId === agent.id
      );
      const requestInput = {
        objective: "Choose this player's concrete tactical action for the current round.",
        roundId: input.round.id,
        roundNumber: input.round.roundNumber,
        mapName: input.mapGame.mapName,
        agentId: agent.id,
        agentDisplayName: agent.displayName,
        teamId: agent.teamId,
        teamName: agentTeam.displayName,
        teamStrategy: readTeamMaterialStrategy(agentTeam),
        coachContext: readTeamHeadCoachProfile(agentTeam),
        opponentTeamId: opponentTeam.id,
        opponentTeamName: opponentTeam.displayName,
        opponentStrategySummary: readOpponentStrategySummary(opponentTeam),
        role: agent.role,
        secondaryRoles: agent.secondaryRoles ?? [],
        roleResponsibilities: agent.roleProfile?.agentMajorResponsibilities ?? [],
        baseProfile: agent.baseProfile,
        mapSemanticContext: readPhase18MapSemanticContext(this.context, input.mapGame.mapName),
        teamPlan,
        playerDirective,
        buyType,
        posture,
        sideContext: input.sideContext
      };
      const response = this.context.useLlmAgentActions
        ? await this.runObservedStructuredCall<AgentActionDecision>({
            callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_agent_${safeId(agent.id)}_agent_action`,
            attemptNumber: input.observabilityAttempt,
            task: "agent_action",
            schemaName: "AgentActionDecision",
            driverModelId: agent.driverModelId,
            requestInput,
            responseFormat: "json_object",
            seed: `${input.round.id}:${agent.id}`,
            modelTier: "cheap",
            temperature: 0,
            match: input.match,
            mapGame: input.mapGame,
            round: input.round,
            roundNumber: input.round.roundNumber,
            agent,
            validateResponseData: (data) => agentActionDecisionSchema.parse(data)
          })
        : await this.context.llmGateway.generateStructured<{ fingerprint?: string }, typeof requestInput>({
            task: "agent_action",
            driverModelId: agent.driverModelId,
            input: requestInput,
            schemaName: "AgentOutput",
            seed: `${input.round.id}:${agent.id}`,
            modelTier: "cheap",
            temperature: 0
          });
      const llmDecision = this.context.useLlmAgentActions ? (response.data as AgentActionDecision) : undefined;
      outputs.push({
        id: `out_${input.round.id}_${agent.id}`,
        agentId: agent.id,
        teamId: agent.teamId,
        role: agent.role,
        driverModelId: agent.driverModelId,
        action: llmDecision?.action ?? `${agent.displayName} uses ${buyType} ${posture} tempo on ${input.mapGame.mapName}`,
        confidence: llmDecision?.confidence ?? 0.72 + (stableNumber(agent.id, 18) / 100),
        rawFingerprint: llmDecision?.fingerprint ?? response.data.fingerprint ?? stableHex(`${input.round.id}:${agent.id}`)
      });
    }

    return outputs;
  }

  private async judgeRound(input: {
    match: Match;
    round: Round;
    observabilityAttempt: number;
    mapGame: MapGame;
    roundNumber: number;
    scoreBeforeRound: ScorePair;
    teamA: Team;
    teamB: Team;
    activeA: Agent[];
    activeB: Agent[];
    teamABuyType: BuyType;
    teamBBuyType: BuyType;
    sideAssignment: SideAssignment;
    teamPlans?: Record<string, TeamRoundPlanDecision>;
    agentOutputs: AgentOutput[];
    recentPublicRoundSummaries: string[];
    recentWinnerTeamIds: string[];
  }): Promise<JudgeResult> {
    if (this.context.useLlmJudgeResults) {
      const judgePromptContext = buildJudgePromptContext({
        roundId: input.round.id,
        roundNumber: input.roundNumber,
        sideAssignment: input.sideAssignment,
        scoreBeforeRound: input.scoreBeforeRound,
        teamA: input.teamA,
        teamB: input.teamB,
        activeA: input.activeA,
        activeB: input.activeB,
        teamABuyType: input.teamABuyType,
        teamBBuyType: input.teamBBuyType,
        ...(input.teamPlans ? { teamPlans: input.teamPlans } : {}),
        agentOutputs: input.agentOutputs,
        recentPublicRoundSummaries: input.recentPublicRoundSummaries
      });
      const judgeRequestInput = {
        objective: "Judge this round from both teams' plans and player actions without team-order, fame, or score-lead bias.",
        roundId: input.round.id,
        roundNumber: input.roundNumber,
        mapName: input.mapGame.mapName,
        scoreBeforeRound: input.scoreBeforeRound,
        mapSemanticContext: readPhase18MapSemanticContext(this.context, input.mapGame.mapName),
        judgeRubricContext: readPhase18JudgeRubricContext(this.context, input.mapGame.mapName),
        ...judgePromptContext.requestInput
      };
      const response = await this.runObservedStructuredCall<JudgeResult>({
        callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_judge`,
        attemptNumber: input.observabilityAttempt,
        task: "judge",
        schemaName: "JudgeResult",
        driverModelId: input.activeA[0]?.driverModelId ?? input.activeB[0]?.driverModelId ?? "",
        requestInput: judgeRequestInput,
        responseFormat: "json_object",
        seed: `judge:${input.round.id}`,
        modelTier: "cheap",
        temperature: 0,
        match: input.match,
        mapGame: input.mapGame,
        round: input.round,
        roundNumber: input.roundNumber,
        validateResponseData: (data) => {
          try {
            return judgePromptContext.validateAndTranslate(judgeResultSchema.parse(normalizeJudgeResultPayload(data)));
          } catch (error) {
            throw translateJudgePromptError(error, judgePromptContext);
          }
        }
      });
      if (!this.context.useJudgeBiasGuardrail) {
        return response.data;
      }

      const suspicious = detectSuspiciousJudgeResult({
        judgeResult: response.data,
        recentWinnerTeamIds: input.recentWinnerTeamIds,
        teamA: input.teamA,
        teamB: input.teamB,
        ...(input.teamPlans ? { teamPlans: input.teamPlans } : {})
      });
      if (!suspicious) {
        return response.data;
      }

      return this.reviewSuspiciousJudgeResult({
        originalJudgeResult: response.data,
        guardrailReason: suspicious,
        judgeRequestInput,
        judgePromptContext,
        match: input.match,
        mapGame: input.mapGame,
        round: input.round,
        roundNumber: input.roundNumber,
        observabilityAttempt: input.observabilityAttempt,
        driverModelId: input.activeA[0]?.driverModelId ?? input.activeB[0]?.driverModelId ?? "",
        teamA: input.teamA,
        teamB: input.teamB,
        activeA: input.activeA,
        activeB: input.activeB
      });
    }

    const plannedWinnerSide = plannedDemoWinnerSideForMap(input.mapGame, input.roundNumber);
    const winnerTeamId = plannedWinnerSide === "teamA" ? input.teamA.id : input.teamB.id;
    const loserTeamId = winnerTeamId === input.teamA.id ? input.teamB.id : input.teamA.id;
    const winnerAgents = winnerTeamId === input.teamA.id ? input.activeA : input.activeB;
    const mvpAgent = selectMvpCandidate(winnerAgents);
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

  private async reviewSuspiciousJudgeResult(input: {
    originalJudgeResult: JudgeResult;
    guardrailReason: string;
    judgeRequestInput: unknown;
    judgePromptContext: Phase18JudgePromptContext;
    match: Match;
    mapGame: MapGame;
    round: Round;
    roundNumber: number;
    observabilityAttempt: number;
    driverModelId: string;
    teamA: Team;
    teamB: Team;
    activeA: Agent[];
    activeB: Agent[];
  }): Promise<JudgeResult> {
    const teamPlans = input.judgePromptContext.actualTeamPlans;
    const response = await this.runObservedStructuredCall<JudgeResult>({
      callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_judge_review`,
      attemptNumber: input.observabilityAttempt,
      task: "judge_review",
      schemaName: "JudgeResult",
      driverModelId: input.driverModelId,
      requestInput: {
        objective:
          "Re-evaluate this suspicious judge result. You may keep the same winner only if the reason explicitly explains both teams' win conditions and why the loser failed.",
        guardrailReason: input.guardrailReason,
        originalJudgeResult: input.originalJudgeResult,
        originalJudgeInput: input.judgeRequestInput,
        mapSemanticContext: readPhase18MapSemanticContext(this.context, input.mapGame.mapName),
        judgeRubricContext: readPhase18JudgeRubricContext(this.context, input.mapGame.mapName)
      },
      responseFormat: "json_object",
      seed: `judge_review:${input.round.id}`,
      modelTier: "cheap",
      temperature: 0,
      match: input.match,
      mapGame: input.mapGame,
      round: input.round,
      roundNumber: input.roundNumber,
      validateResponseData: (data) => {
        try {
          return input.judgePromptContext.validateAndTranslate(judgeResultSchema.parse(normalizeJudgeResultPayload(data)));
        } catch (error) {
          throw translateJudgePromptError(error, input.judgePromptContext);
        }
      }
    });
    const loserTeam = response.data.loserTeamId === input.teamA.id ? input.teamA : input.teamB;
    const loserPlan = teamPlans?.[loserTeam.id];
    if (!loserPlan || !hasDetailedLoserPlanExplanation(response.data.reason, loserTeam, loserPlan)) {
      throw new Error(`Judge review failed anti-bias guardrail: ${input.guardrailReason}`);
    }

    return response.data;
  }

  private async runObservedStructuredCall<TData>(input: {
    callId: string;
    attemptNumber: number;
    task: "team_plan" | "agent_action" | "judge" | "judge_review";
    schemaName: string;
    driverModelId: string;
    requestInput: unknown;
    responseFormat: "json_object";
    seed: string;
    modelTier: "cheap" | "standard" | "strong";
    temperature: number;
    match: Match;
    mapGame: MapGame;
    round: Round;
    roundNumber: number;
    agent?: Agent;
    validateResponseData?: (data: unknown) => TData;
  }) {
    const promptHash = stableHex(JSON.stringify({
      task: input.task,
      schemaName: input.schemaName,
      input: input.requestInput
    }));
    const startedAt = timestamp();
    const requestArtifactId = await this.writeLlmArtifact({
      callId: input.callId,
      suffix: "request",
      artifactType: "llm_request",
      match: input.match,
      mapGame: input.mapGame,
      round: input.round,
      ...(input.agent ? { agent: input.agent } : {}),
      content: {
        schemaVersion: 1,
        attemptNumber: input.attemptNumber,
        taskType: input.task,
        driverModelId: input.driverModelId,
        schemaName: input.schemaName,
        promptHash,
        input: input.requestInput
      }
    });
    await this.appendEvent({
      id: `evt_${input.callId}_started`,
      type: "llm_call_started",
      category: "system",
      tournamentId: input.match.tournamentId,
      matchId: input.match.id,
      mapGameId: input.mapGame.id,
      scopeType: "map",
      scopeId: input.mapGame.id,
      payload: {
        schemaVersion: 1,
        attemptNumber: input.attemptNumber,
        callId: input.callId,
        taskType: input.task,
        roundId: input.round.id,
        roundNumber: input.roundNumber,
        agentId: input.agent?.id,
        driverModelId: input.driverModelId,
        status: "started",
        startedAt
      },
      createdAt: startedAt
    });

    let latestResponse: LlmResponse<TData> | undefined;
    try {
      const response = await this.context.llmGateway.generateStructured<TData, unknown>({
        task: input.task,
        driverModelId: input.driverModelId,
        input: input.requestInput,
        schemaName: input.schemaName,
        messages: buildPhase18StructuredMessages({
          task: input.task,
          schemaName: input.schemaName,
          requestInput: input.requestInput
        }),
        responseFormat: input.responseFormat,
        seed: input.seed,
        modelTier: input.modelTier,
        temperature: input.temperature
      });
      latestResponse = response;
      const data = input.validateResponseData ? input.validateResponseData(response.data) : response.data;
      const validatedResponse: LlmResponse<TData> = { ...response, data };
      const completedAt = timestamp();
      const responseArtifactId = await this.writeLlmArtifact({
        callId: input.callId,
        suffix: "response",
        artifactType: "llm_response",
        match: input.match,
        mapGame: input.mapGame,
        round: input.round,
        ...(input.agent ? { agent: input.agent } : {}),
        content: {
          schemaVersion: 1,
          attemptNumber: input.attemptNumber,
          taskType: input.task,
          driverModelId: input.driverModelId,
          ok: true,
          rawText: validatedResponse.rawText,
          usage: validatedResponse.usage,
          structuredRepair: validatedResponse.structuredRepair,
          data: validatedResponse.data
        }
      });
      await this.context.repositories.llmCalls.save(removeUndefined({
        id: input.callId,
        tournamentId: input.match.tournamentId,
        matchId: input.match.id,
        agentId: input.agent?.id,
        driverModelId: input.driverModelId,
        taskType: input.task,
        promptHash,
        requestArtifactId,
        responseArtifactId,
        inputTokens: validatedResponse.usage.promptTokens,
        outputTokens: validatedResponse.usage.completionTokens,
        createdAt: startedAt
      }));
      await this.appendEvent({
        id: `evt_${input.callId}_completed`,
        type: "llm_call_completed",
        category: "system",
        tournamentId: input.match.tournamentId,
        matchId: input.match.id,
        mapGameId: input.mapGame.id,
        scopeType: "map",
        scopeId: input.mapGame.id,
        payload: {
          schemaVersion: 1,
          attemptNumber: input.attemptNumber,
          callId: input.callId,
          taskType: input.task,
          roundId: input.round.id,
          roundNumber: input.roundNumber,
          agentId: input.agent?.id,
          driverModelId: input.driverModelId,
          status: "completed",
          startedAt,
          completedAt,
          latencyMs: Date.parse(completedAt) - Date.parse(startedAt),
          inputTokens: validatedResponse.usage.promptTokens,
          outputTokens: validatedResponse.usage.completionTokens,
          repaired: Boolean(validatedResponse.structuredRepair),
          rawTextPreview: previewText(validatedResponse.structuredRepair?.originalRawText),
          repairRawTextPreview: previewText(validatedResponse.structuredRepair?.repairRawText)
        },
        createdAt: completedAt
      });
      return validatedResponse;
    } catch (error) {
      const failedAt = timestamp();
      const errorMessage = error instanceof Error ? error.message : String(error);
      const diagnostic = readLlmErrorDiagnostic(error);
      const failedRawText = latestResponse?.rawText ?? diagnostic.rawText;
      const failedUsage = latestResponse?.usage ?? diagnostic.usage;
      const responseArtifactId = await this.writeLlmArtifact({
        callId: input.callId,
        suffix: "response",
        artifactType: "llm_response",
        match: input.match,
        mapGame: input.mapGame,
        round: input.round,
        ...(input.agent ? { agent: input.agent } : {}),
        content: {
          schemaVersion: 1,
          attemptNumber: input.attemptNumber,
          taskType: input.task,
          driverModelId: input.driverModelId,
          ok: false,
          rawText: failedRawText,
          rawTextPreview: previewText(failedRawText),
          parseCandidatePreview: previewText(diagnostic.parseCandidate),
          usage: failedUsage,
          data: latestResponse?.data,
          structuredRepair: latestResponse?.structuredRepair,
          error: errorMessage
        }
      });
      await this.context.repositories.llmCalls.save(removeUndefined({
        id: input.callId,
        tournamentId: input.match.tournamentId,
        matchId: input.match.id,
        agentId: input.agent?.id,
        driverModelId: input.driverModelId,
        taskType: input.task,
        promptHash,
        requestArtifactId,
        responseArtifactId,
        inputTokens: failedUsage?.promptTokens,
        outputTokens: failedUsage?.completionTokens,
        createdAt: startedAt
      }));
      await this.appendEvent({
        id: `evt_${input.callId}_failed`,
        type: "llm_call_failed",
        category: "system",
        tournamentId: input.match.tournamentId,
        matchId: input.match.id,
        mapGameId: input.mapGame.id,
        scopeType: "map",
        scopeId: input.mapGame.id,
        payload: {
          schemaVersion: 1,
          attemptNumber: input.attemptNumber,
          callId: input.callId,
          taskType: input.task,
          roundId: input.round.id,
          roundNumber: input.roundNumber,
          agentId: input.agent?.id,
          driverModelId: input.driverModelId,
          status: "failed",
          startedAt,
          failedAt,
          latencyMs: Date.parse(failedAt) - Date.parse(startedAt),
          inputTokens: failedUsage?.promptTokens,
          outputTokens: failedUsage?.completionTokens,
          responseArtifactId,
          rawTextPreview: previewText(failedRawText),
          parseCandidatePreview: previewText(diagnostic.parseCandidate),
          error: errorMessage
        },
        createdAt: failedAt
      });
      throw error;
    }
  }

  private async writeLlmArtifact(input: {
    callId: string;
    suffix: "request" | "response";
    artifactType: string;
    match: Match;
    mapGame: MapGame;
    round: Round;
    agent?: Agent;
    content: unknown;
  }): Promise<string | undefined> {
    if (!this.context.artifactStore) {
      return undefined;
    }

    try {
      const artifact = await this.context.artifactStore.write({
        ownerType: "llm_call",
        ownerId: input.callId,
        artifactType: input.artifactType,
        relativePath: `llm/${input.callId}-${input.suffix}.json`,
        content: `${JSON.stringify(input.content, null, 2)}\n`,
        tournamentId: input.match.tournamentId,
        matchId: input.match.id,
        mapGameId: input.mapGame.id,
        ...(input.agent ? { agentId: input.agent.id } : {})
      });
      return artifact.id;
    } catch {
      return undefined;
    }
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
      sourceModule: input.sourceModule ?? this.context.eventSourceModule ?? "core.phase12"
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
      sourceEventIds: [input.roundStartedEvent.id, ...(input.sideAssignmentEvent ? [input.sideAssignmentEvent.id] : [])],
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
    ...buildTacticalTimelineItems(input),
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
  tacticalContext?: RoundReport["tacticalContext"];
}): string {
  const winnerName = input.winnerTeamId === input.teamA.id ? input.teamA.displayName : input.teamB.displayName;
  const winnerBuyType = input.winnerTeamId === input.teamA.id ? input.teamABuyType : input.teamBBuyType;
  const loserBuyType = input.winnerTeamId === input.teamA.id ? input.teamBBuyType : input.teamABuyType;
  const keyLine = input.keyEvents.slice(0, 2).map((event) => event.impact).join(" ");
  const sideLine = input.sideContext.activeSide === "teamA" ? `${input.teamA.shortName} 主动侧` : `${input.teamB.shortName} 主动侧`;
  const highlightLine = summarizeHighlightTags(input.highlightTags);
  const tacticalLine = input.tacticalContext
    ? ` Tactical: attack=${input.tacticalContext.attackPlan.approach} primary=${input.tacticalContext.collision.primaryZoneId} defense=${input.tacticalContext.defenseDeployment.setup} result=${input.tacticalContext.collision.result}.`
    : "";
  return `${winnerName} 在 ${input.mapName} 第 ${input.roundNumber} 回合完成收束，比分 ${formatScore(input.scoreBeforeRound)} -> ${formatScore(input.scoreAfterRound)}。${sideLine}，购买对位为 ${formatBuyType(winnerBuyType)} 对 ${formatBuyType(loserBuyType)}。关键事件：${keyLine}${highlightLine}${tacticalLine}`;
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
    ["star_rifler", 1],
    ["awper", 2],
    ["igl", 3],
    ["rifler", 4],
    ["lurker", 5],
    ["support", 6],
    ["stand_in", 7],
    ["coach", 8]
  ]);
  return [...agents].sort((left, right) => (rank.get(left.role) ?? 99) - (rank.get(right.role) ?? 99) || left.id.localeCompare(right.id));
}

function selectMvpCandidate(winnerAgents: Agent[]): Agent | undefined {
  const priority = ["star_rifler", "awper", "entry", "igl"] as const;
  for (const role of priority) {
    const candidate = winnerAgents.find((agent) => agent.role === role);
    if (candidate) {
      return candidate;
    }
  }

  return winnerAgents[0];
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

function sumEconomyByTeam(items: EconomyState[], teamId: string): number {
  return items.filter((item) => item.teamId === teamId).reduce((sum, item) => sum + item.tokenBank, 0);
}

function sourceOutputIds(outputs: AgentOutput[], agentId: string): string[] {
  return outputs.filter((output) => output.agentId === agentId).map((output) => output.id);
}

function validateTeamRoundPlan(input: {
  plan: TeamRoundPlanDecision;
  teamId: string;
  expectedSide: "attack" | "defense";
  activeAgents: Agent[];
}): TeamRoundPlanDecision {
  if (input.plan.teamId !== input.teamId) {
    throw new Error(`Team plan returned an invalid teamId: ${input.plan.teamId}`);
  }
  if (input.plan.side !== input.expectedSide) {
    throw new Error(`Team plan returned an invalid side: ${input.plan.side}`);
  }

  const activeAgentIds = new Set(input.activeAgents.map((agent) => agent.id));
  const directiveAgentIds = input.plan.playerDirectives.map((directive: TeamRoundPlanDecision["playerDirectives"][number]) => directive.agentId);
  const directiveAgentIdSet = new Set(directiveAgentIds);
  if (directiveAgentIdSet.size !== directiveAgentIds.length) {
    throw new Error(`Team plan returned duplicate player directives for ${input.teamId}`);
  }
  for (const agentId of directiveAgentIds) {
    if (!activeAgentIds.has(agentId)) {
      throw new Error(`Team plan returned directive for inactive agent: ${agentId}`);
    }
  }
  for (const agentId of activeAgentIds) {
    if (!directiveAgentIdSet.has(agentId)) {
      throw new Error(`Team plan missed directive for active agent: ${agentId}`);
    }
  }

  return input.plan;
}

function validateJudgeResult(input: {
  judgeResult: JudgeResult;
  teamA: Team;
  teamB: Team;
  activeA: Agent[];
  activeB: Agent[];
  teamPlans?: Record<string, TeamRoundPlanDecision> | undefined;
}): JudgeResult {
  const validWinnerTeamIds = new Set([input.teamA.id, input.teamB.id]);
  if (!validWinnerTeamIds.has(input.judgeResult.winnerTeamId)) {
    throw new Error(`Judge returned an invalid winnerTeamId: ${input.judgeResult.winnerTeamId}`);
  }

  const expectedLoserTeamId = input.judgeResult.winnerTeamId === input.teamA.id ? input.teamB.id : input.teamA.id;
  if (input.judgeResult.loserTeamId !== expectedLoserTeamId) {
    throw new Error(`Judge returned an invalid loserTeamId: ${input.judgeResult.loserTeamId}`);
  }

  const winnerAgents = input.judgeResult.winnerTeamId === input.teamA.id ? input.activeA : input.activeB;
  if (!winnerAgents.some((agent) => agent.id === input.judgeResult.mvpAgentId)) {
    throw new Error(`Judge returned an invalid mvpAgentId: ${input.judgeResult.mvpAgentId}`);
  }
  if (input.teamPlans) {
    const winnerTeam = input.judgeResult.winnerTeamId === input.teamA.id ? input.teamA : input.teamB;
    const loserTeam = input.judgeResult.loserTeamId === input.teamA.id ? input.teamA : input.teamB;
    const winnerPlan = input.teamPlans[winnerTeam.id];
    const loserPlan = input.teamPlans[loserTeam.id];
    if (!winnerPlan || !loserPlan) {
      throw new Error("Judge validation requires both Phase 1.8 team plans.");
    }
    if (!hasWinnerAndLoserPlanExplanation(input.judgeResult.reason, winnerTeam, loserTeam, winnerPlan, loserPlan)) {
      throw new Error(
        `Judge reason must explain how ${winnerTeam.displayName} succeeded and how ${loserTeam.displayName} failed.`
      );
    }
  }

  return input.judgeResult;
}

function buildJudgePromptContext(input: {
  roundId: string;
  roundNumber: number;
  sideAssignment: SideAssignment;
  scoreBeforeRound: ScorePair;
  teamA: Team;
  teamB: Team;
  activeA: Agent[];
  activeB: Agent[];
  teamABuyType: BuyType;
  teamBBuyType: BuyType;
  teamPlans?: Record<string, TeamRoundPlanDecision> | undefined;
  agentOutputs: AgentOutput[];
  recentPublicRoundSummaries: string[];
}): Phase18JudgePromptContext {
  const promptTeamA = buildPromptTeam(input.teamA, "team_alpha", "Team Alpha", "ALPHA");
  const promptTeamB = buildPromptTeam(input.teamB, "team_bravo", "Team Bravo", "BRAVO");
  const promptActiveA = input.activeA.map((agent, index) => buildPromptAgent(agent, promptTeamA.id, `alpha_${index + 1}`));
  const promptActiveB = input.activeB.map((agent, index) => buildPromptAgent(agent, promptTeamB.id, `bravo_${index + 1}`));
  const promptTeamIdByActualTeamId = new Map<string, string>([
    [input.teamA.id, promptTeamA.id],
    [input.teamB.id, promptTeamB.id]
  ]);
  const actualTeamIdByPromptTeamId = new Map<string, string>([
    [promptTeamA.id, input.teamA.id],
    [promptTeamB.id, input.teamB.id]
  ]);
  const promptAgentIdByActualAgentId = new Map<string, string>();
  const actualAgentIdByPromptAgentId = new Map<string, string>();
  for (const [index, agent] of input.activeA.entries()) {
    const promptAgent = promptActiveA[index];
    if (promptAgent) {
      promptAgentIdByActualAgentId.set(agent.id, promptAgent.id);
      actualAgentIdByPromptAgentId.set(promptAgent.id, agent.id);
    }
  }
  for (const [index, agent] of input.activeB.entries()) {
    const promptAgent = promptActiveB[index];
    if (promptAgent) {
      promptAgentIdByActualAgentId.set(agent.id, promptAgent.id);
      actualAgentIdByPromptAgentId.set(promptAgent.id, agent.id);
    }
  }

  const sanitizeReplacements = buildJudgePromptSanitizeReplacements({
    teamA: input.teamA,
    teamB: input.teamB,
    promptTeamA,
    promptTeamB,
    activeA: input.activeA,
    activeB: input.activeB,
    promptActiveA,
    promptActiveB
  });
  const desanitizeReplacements = buildJudgePromptDesanitizeReplacements({
    teamA: input.teamA,
    teamB: input.teamB,
    promptTeamA,
    promptTeamB,
    activeA: input.activeA,
    activeB: input.activeB,
    promptActiveA,
    promptActiveB
  });
  const promptTeamPlans = input.teamPlans
    ? sanitizeTeamPlansForJudge(input.teamPlans, promptTeamIdByActualTeamId, promptAgentIdByActualAgentId, sanitizeReplacements)
    : undefined;
  const promptSideAssignment = sanitizeSideAssignmentForJudge(input.sideAssignment, promptTeamIdByActualTeamId);
  const promptAgentOutputsByTeam = buildPromptAgentOutputsByTeam({
    agentOutputs: input.agentOutputs,
    promptTeamIdByActualTeamId,
    promptAgentIdByActualAgentId,
    replacements: sanitizeReplacements
  });
  const evaluationEntries: Phase18JudgePromptContext["requestInput"]["evaluationOrder"] = [
    buildJudgeEvaluationEntry({
      teamId: promptTeamA.id,
      teamName: promptTeamA.displayName,
      activeAgents: promptActiveA,
      teamStrategy: sanitizeJudgeRecord(readTeamMaterialStrategy(input.teamA), sanitizeReplacements),
      coachContext: sanitizeJudgeRecord(readTeamHeadCoachProfile(input.teamA), sanitizeReplacements),
      teamPlan: promptTeamPlans?.[promptTeamA.id]
    }),
    buildJudgeEvaluationEntry({
      teamId: promptTeamB.id,
      teamName: promptTeamB.displayName,
      activeAgents: promptActiveB,
      teamStrategy: sanitizeJudgeRecord(readTeamMaterialStrategy(input.teamB), sanitizeReplacements),
      coachContext: sanitizeJudgeRecord(readTeamHeadCoachProfile(input.teamB), sanitizeReplacements),
      teamPlan: promptTeamPlans?.[promptTeamB.id]
    })
  ];
  const evaluationOrder = input.roundNumber % 2 === 0 ? [...evaluationEntries].reverse() : evaluationEntries;

  return {
    requestInput: {
      sideAssignment: promptSideAssignment,
      buyTypesByTeam: {
        [promptTeamA.id]: input.teamABuyType,
        [promptTeamB.id]: input.teamBBuyType
      },
      evaluationOrder,
      teamAId: promptTeamA.id,
      teamBId: promptTeamB.id,
      teamAName: promptTeamA.displayName,
      teamBName: promptTeamB.displayName,
      activeTeamAAgentIds: promptActiveA.map((agent) => agent.id),
      activeTeamBAgentIds: promptActiveB.map((agent) => agent.id),
      agentOutputsByTeam: promptAgentOutputsByTeam,
      recentPublicRoundSummaries: input.recentPublicRoundSummaries.map((summary) => sanitizeJudgeText(summary, sanitizeReplacements))
    },
    ...(input.teamPlans ? { actualTeamPlans: input.teamPlans } : {}),
    validateAndTranslate: (judgeResult: JudgeResult) => {
      const promptValidated = validateJudgeResult({
        judgeResult,
        teamA: promptTeamA,
        teamB: promptTeamB,
        activeA: promptActiveA,
        activeB: promptActiveB,
        ...(promptTeamPlans ? { teamPlans: promptTeamPlans } : {})
      });
      const actualWinnerTeamId = actualTeamIdByPromptTeamId.get(promptValidated.winnerTeamId);
      const actualLoserTeamId = actualTeamIdByPromptTeamId.get(promptValidated.loserTeamId);
      const actualMvpAgentId = actualAgentIdByPromptAgentId.get(promptValidated.mvpAgentId);
      if (!actualWinnerTeamId || !actualLoserTeamId || !actualMvpAgentId) {
        throw new Error("Judge prompt translation failed to map prompt ids back to actual ids.");
      }

      return {
        ...promptValidated,
        winnerTeamId: actualWinnerTeamId,
        loserTeamId: actualLoserTeamId,
        mvpAgentId: actualMvpAgentId,
        reason: desanitizeJudgeText(promptValidated.reason, desanitizeReplacements)
      };
    },
    translatePromptText: (value: string) => desanitizeJudgeText(value, desanitizeReplacements)
  };
}

function readPhase18MapSemanticContext(context: Pick<EngineContext, "phase18MapSemanticsByMapName">, mapName: string): Record<string, unknown> | undefined {
  return readUnknownRecord(context.phase18MapSemanticsByMapName?.[mapName.toUpperCase()]);
}

function readPhase18JudgeRubricContext(context: Pick<EngineContext, "phase18MapSemanticsByMapName">, mapName: string): Record<string, unknown> | undefined {
  const mapSemantic = readPhase18MapSemanticContext(context, mapName);
  return readUnknownRecord(mapSemantic?.judgeRubric);
}

function readTeamMaterialStrategy(team: Team): Record<string, unknown> | undefined {
  const source = readUnknownRecord(team.source);
  return readUnknownRecord(source?.materialStrategy);
}

function readTeamHeadCoachProfile(team: Team): Record<string, unknown> | undefined {
  const source = readUnknownRecord(team.source);
  return readUnknownRecord(source?.headCoachProfile);
}

function readOpponentStrategySummary(team: Team): Record<string, unknown> | undefined {
  const strategy = readTeamMaterialStrategy(team);
  if (!strategy) {
    return undefined;
  }

  const identitySummary = typeof strategy.identitySummary === "string" ? strategy.identitySummary : undefined;
  const frontendSummary = typeof strategy.frontendSummary === "string" ? strategy.frontendSummary : undefined;
  const failureModes = Array.isArray(strategy.failureModes) ? strategy.failureModes.filter((item): item is string => typeof item === "string") : [];
  return removeUndefined({
    ...(identitySummary ? { identitySummary } : {}),
    ...(frontendSummary ? { frontendSummary } : {}),
    ...(failureModes.length > 0 ? { failureModes } : {})
  });
}

function readUnknownRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function normalizeJudgeResultPayload(data: unknown): unknown {
  const record = readUnknownRecord(data);
  if (!record) {
    return data;
  }

  const margin = normalizeJudgeMargin(record.margin);
  if (!margin) {
    return data;
  }

  return {
    ...record,
    margin
  };
}

function normalizeJudgeMargin(value: unknown): JudgeResult["margin"] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
  switch (normalized) {
    case "narrow":
    case "close":
    case "slight":
    case "minor":
    case "thin":
    case "marginal":
      return "narrow";
    case "standard":
    case "clear":
    case "solid":
    case "moderate":
    case "normal":
    case "regular":
      return "standard";
    case "decisive":
    case "dominant":
    case "overwhelming":
    case "onesided":
    case "crushing":
      return "decisive";
    default:
      return undefined;
  }
}

function sanitizeJudgeRecord(
  value: Record<string, unknown> | undefined,
  replacements: Array<{ source: string; target: string }>
): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  return sanitizeJudgeValue(value, replacements) as Record<string, unknown>;
}

function buildPhase18StructuredMessages(input: {
  task: "team_plan" | "agent_action" | "judge" | "judge_review";
  schemaName: string;
  requestInput: unknown;
}): LlmMessage[] {
  const contextSummary = buildPhase18PromptContextSummary(input.requestInput);
  return [
    {
      role: "system",
      content: [
        "你是 Agent Major Phase 2.0-pre 的结构化对局引擎。",
        "只输出 json，不要输出 markdown、代码块、解释、重复输入字段，或夹杂的英文句子。",
        "除必要英文术语与字段名外，所有自然语言字段必须使用中文。",
        buildPhase18SchemaContract(input.schemaName),
        buildPhase18TaskInstruction(input.task)
      ].join("\n\n")
    },
    {
      role: "user",
      content: [
        `任务：${input.task}`,
        "这不是通用的 Counter-Strike 模拟，也不是自由叙事。必须把给定的比赛资产当作唯一事实来源。",
        "当上下文存在时，必须围绕 mapSemanticContext、judgeRubricContext、teamStrategy、coachContext、teamPlan、playerDirective、roleResponsibilities、opponentStrategySummary 来回答。",
        contextSummary,
        "结构化输入 json：",
        JSON.stringify(input.requestInput, null, 2)
      ].join("\n\n")
    }
  ];
}

function buildPhase18SchemaContract(schemaName: string): string {
  if (schemaName === "AgentActionDecision") {
    return [
      "json 输出契约：",
      '只返回一个顶层对象：{"action":"<简洁战术动作>","confidence":0.0,"fingerprint":"<可选的短稳定标记>"}',
      "必填字段：action、confidence。",
      "confidence 必须是 0 到 1 之间的数字。",
      "自然语言字段要中文优先，避免中英混杂。"
    ].join("\n");
  }

  if (schemaName === "TeamRoundPlanDecision") {
    return [
      "json 输出契约：",
      '只返回一个顶层对象，字段包括：teamId、side、primaryIntent、primaryZoneId、可选 secondaryZoneId、coordinationSummary、playerDirectives、winCondition、risk、confidence、可选 fingerprint。',
      "playerDirectives 必须且只能覆盖输入中的每个 active player 一次。",
      "side 必须与输入 side 一致。confidence 必须是 0 到 1 之间的数字。",
      "所有可读文本字段请用中文表达，除必要英文术语外不要写英文句子。"
    ].join("\n");
  }

    if (schemaName === "JudgeResult") {
      return [
        "json 输出契约：",
        '只返回一个顶层对象，字段包括：winnerTeamId、loserTeamId、margin、reason、mvpAgentId、confidence。',
        "margin 必须严格是 narrow、standard、decisive 三者之一，不要使用 clear、close、solid、dominant 或其他同义词。",
        "reason 必须明确写出双方队伍，并解释胜方为什么成功、败方为什么失败。",
        "为便于稳定校验，reason 中请保留成功/失败，或者 succeeded/failed 这类标记。",
        "winnerTeamId 必须是输入的两队之一，loserTeamId 必须是另外一队。",
        "mvpAgentId 必须来自胜方的 active roster。",
        "confidence 必须是 0 到 1 之间的数字。",
        "自然语言部分尽量全中文，除必要英文标记外不要写混杂英文。"
      ].join("\n");
  }

  return "json 输出契约：只返回一个与指定 schema 完全一致的顶层对象。";
}

function buildPhase18TaskInstruction(task: "team_plan" | "agent_action" | "judge" | "judge_review"): string {
  switch (task) {
    case "team_plan":
      return [
        "任务说明：",
        "生成一份真正贴合当前地图命题与队伍长期方案的回合计划。",
        "不要输出通用的点位强攻或通用防守。计划必须绑定当前子命题、队伍母方案，以及本回合真正的压力点。",
        "如果是进攻方，就压迫对手最薄弱的命题缺口；如果是防守方，就守住自己的核心命题，不要临时胡编新方案。",
        "教练窗口只负责修正，不是赛前重写。所有自然语言表达请中文优先。"
      ].join("\n");
    case "agent_action":
      return [
        "任务说明：",
        "从 roleResponsibilities、teamPlan、playerDirective、teamStrategy 和 coachContext 里，选择一名选手的具体动作。",
        "不要发明隐藏信息、虚构武器、虚构投掷物库存，也不要写电竞腔的灌水句子。",
        "动作必须具体到能改变回合，但也要足够简洁，仍然只是一个选手动作。",
        "自然语言字段必须中文为主，除必要英文术语外不要夹杂英文句子。"
      ].join("\n");
      case "judge":
        return [
          "任务说明：",
          "只能根据给定证据和裁判准则判定本回合。",
          "必须解释进攻方击中了哪个机会缺口，防守方守住或没守住哪个核心命题，并说明为什么这符合当前地图主题。",
          "reason 里必须同时出现胜方成功、败方失败两层说明；可以使用“成功/失败”，不要写成空泛故事。",
          "不要按队伍顺序、名气、当前比分领先或叙事惯性来下结论。",
          "自然语言部分请中文优先，必要英文标记只保留在字段名或判定标记中。"
        ].join("\n");
    case "judge_review":
      return [
        "任务说明：",
        "在同一裁判准则下，带着更强的反偏置要求重新评估上一版裁判结果。",
        "只有当败方解释完整，而且结论仍然锚定当前子命题与核心判定轴时，才保留原胜方。",
        "如果上一版只是叙事性判断，请直接纠正。",
        "自然语言部分请中文优先，除必要英文术语外不要混写英文句子。"
      ].join("\n");
    default:
      return "任务说明：严格按照结构化任务执行。";
  }
}

function buildPhase18PromptContextSummary(requestInput: unknown): string {
  const record = readUnknownRecord(requestInput);
  if (!record) {
    return "Context summary: unavailable.";
  }

  const roundNumber = typeof record.roundNumber === "number" ? record.roundNumber : undefined;
  const mapName = typeof record.mapName === "string" ? record.mapName : undefined;
  const mapSemantic = readUnknownRecord(record.mapSemanticContext);
  const proposition = readUnknownRecord(mapSemantic?.proposition);
  const judgeRubric = readUnknownRecord(record.judgeRubricContext) ?? readUnknownRecord(mapSemantic?.judgeRubric);
  const teamStrategy = readUnknownRecord(record.teamStrategy);
  const coachContext = readUnknownRecord(record.coachContext);
  const opponentStrategySummary = readUnknownRecord(record.opponentStrategySummary);
  const teamPlan = readUnknownRecord(record.teamPlan);
  const playerDirective = readUnknownRecord(record.playerDirective);

  const lines = [
    `地图：${mapName ?? "unknown"}`,
    ...(roundNumber ? [`回合：${roundNumber}`] : []),
    ...(proposition
      ? [
          `地图主题：${pickString(proposition, "mapTheme") ?? "unknown"}`,
          `核心问题：${pickString(proposition, "coreQuestion") ?? "unknown"}`,
          ...(() => {
            const subTheme = resolvePhase18SubTheme(proposition, roundNumber);
            return subTheme ? [`当前子命题：${subTheme}`] : [];
          })(),
          ...(() => {
            const displayZoneNames = readUnknownRecord(proposition.displayZoneNames);
            if (!displayZoneNames) {
              return [];
            }

            const zonePairs = Object.entries(displayZoneNames)
              .filter(([, value]) => typeof value === "string")
              .map(([zoneId, value]) => `${zoneId}=${value}`)
              .slice(0, 8);
            return zonePairs.length > 0 ? [`区域别名：${zonePairs.join("，")}`] : [];
          })(),
          ...(() => {
            const attackFocus = pickStringArray(proposition, "attackFocus");
            return attackFocus.length > 0 ? [`进攻焦点：${attackFocus.join(" / ")}`] : [];
          })(),
          ...(() => {
            const defenseFocus = pickStringArray(proposition, "defenseFocus");
            return defenseFocus.length > 0 ? [`防守焦点：${defenseFocus.join(" / ")}`] : [];
          })()
        ]
      : []),
    ...(judgeRubric
      ? [
          `裁判轴：${pickString(judgeRubric, "coreJudgmentAxis") ?? "unknown"}`,
          ...(() => {
            const reasonMustCover = pickStringArray(judgeRubric, "reasonMustCover");
            return reasonMustCover.length > 0 ? [`判词必须覆盖：${reasonMustCover.join(" / ")}`] : [];
          })(),
          ...(() => {
            const biasGuardrails = pickStringArray(judgeRubric, "biasGuardrails");
            return biasGuardrails.length > 0 ? [`反偏置约束：${biasGuardrails.join(" / ")}`] : [];
          })()
        ]
      : []),
    ...(teamStrategy
      ? [
          `队伍母方案：${pickString(teamStrategy, "identitySummary") ?? "unknown"}`,
          ...(() => {
            const failureModes = pickStringArray(teamStrategy, "failureModes");
            return failureModes.length > 0 ? [`已知失败模式：${failureModes.join(" / ")}`] : [];
          })()
        ]
      : []),
    ...(coachContext
      ? [
          `教练窗口：${pickString(coachContext, "displayName") ?? "unknown"} | ${
            pickString(coachContext, "dutySummary") ?? "no duty summary"
          }`
        ]
      : []),
    ...(opponentStrategySummary
      ? [
          `对手摘要：${pickString(opponentStrategySummary, "identitySummary") ?? "unknown"}`,
          ...(() => {
            const failureModes = pickStringArray(opponentStrategySummary, "failureModes");
            return failureModes.length > 0 ? [`对手失败模式：${failureModes.join(" / ")}`] : [];
          })()
        ]
      : []),
    ...(teamPlan
      ? [
          `队伍意图：${pickString(teamPlan, "primaryIntent") ?? "unknown"}`,
          `队伍胜利条件：${pickString(teamPlan, "winCondition") ?? "unknown"}`
        ]
      : []),
    ...(playerDirective
      ? [`选手指令：${pickString(playerDirective, "directive") ?? "unknown"}`]
      : [])
  ];

  return `上下文摘要：\n${lines.join("\n")}`;
}

function resolvePhase18SubTheme(proposition: Record<string, unknown>, roundNumber: number | undefined): string | undefined {
  if (!roundNumber) {
    return undefined;
  }

  const regulationRoundThemes = Array.isArray(proposition.regulationRoundThemes) ? proposition.regulationRoundThemes : [];
  const overtimeRoundThemes = Array.isArray(proposition.overtimeRoundThemes) ? proposition.overtimeRoundThemes : [];
  const inRegulation = roundNumber <= 12;
  const themeSource = inRegulation ? regulationRoundThemes : overtimeRoundThemes;
  const normalizedRound = inRegulation ? ((roundNumber - 1) % 6) + 1 : ((roundNumber - 13) % 3) + 1;
  const matchLabel = inRegulation ? `R${normalizedRound}` : `OT${normalizedRound}`;
  const theme = themeSource.find((entry) => readUnknownRecord(entry)?.round === matchLabel);
  return pickString(readUnknownRecord(theme), "theme");
}

function pickString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  return record && typeof record[key] === "string" ? (record[key] as string) : undefined;
}

function pickStringArray(record: Record<string, unknown> | undefined, key: string): string[] {
  if (!record || !Array.isArray(record[key])) {
    return [];
  }

  return (record[key] as unknown[]).filter((item): item is string => typeof item === "string");
}

function buildJudgeEvaluationEntry(input: {
  teamId: string;
  teamName: string;
  activeAgents: Agent[];
  teamPlan: TeamRoundPlanDecision | undefined;
  teamStrategy: Record<string, unknown> | undefined;
  coachContext: Record<string, unknown> | undefined;
}): Phase18JudgePromptContext["requestInput"]["evaluationOrder"][number] {
  const entry = removeUndefined({
    teamId: input.teamId,
    teamName: input.teamName,
    activeAgents: input.activeAgents.map((agent) => ({ id: agent.id, role: agent.role })),
    teamPlan: input.teamPlan,
    teamStrategy: input.teamStrategy,
    coachContext: input.coachContext
  });
  return entry as Phase18JudgePromptContext["requestInput"]["evaluationOrder"][number];
}

function buildPromptTeam(actualTeam: Team, promptId: string, displayName: string, shortName: string): Team {
  return {
    ...actualTeam,
    id: promptId,
    displayName,
    shortName
  };
}

function buildPromptAgent(actualAgent: Agent, promptTeamId: string, promptAgentId: string): Agent {
  return {
    ...actualAgent,
    id: promptAgentId,
    teamId: promptTeamId,
    displayName: promptAgentId.toUpperCase()
  };
}

function buildJudgePromptSanitizeReplacements(input: {
  teamA: Team;
  teamB: Team;
  promptTeamA: Team;
  promptTeamB: Team;
  activeA: Agent[];
  activeB: Agent[];
  promptActiveA: Agent[];
  promptActiveB: Agent[];
}): Array<{ source: string; target: string }> {
  const replacements: Array<{ source: string; target: string }> = [
    { source: input.teamA.id, target: input.promptTeamA.id },
    { source: input.teamB.id, target: input.promptTeamB.id },
    { source: input.teamA.displayName, target: input.promptTeamA.displayName },
    { source: input.teamB.displayName, target: input.promptTeamB.displayName },
    { source: input.teamA.shortName, target: input.promptTeamA.shortName },
    { source: input.teamB.shortName, target: input.promptTeamB.shortName }
  ];
  for (const [index, agent] of input.activeA.entries()) {
    const promptAgent = input.promptActiveA[index];
    if (promptAgent) {
      replacements.push({ source: agent.id, target: promptAgent.id });
      replacements.push({ source: agent.displayName, target: promptAgent.displayName });
    }
  }
  for (const [index, agent] of input.activeB.entries()) {
    const promptAgent = input.promptActiveB[index];
    if (promptAgent) {
      replacements.push({ source: agent.id, target: promptAgent.id });
      replacements.push({ source: agent.displayName, target: promptAgent.displayName });
    }
  }

  const seen = new Set<string>();
  return replacements
    .filter((replacement) => replacement.source.trim().length > 0)
    .sort((left, right) => right.source.length - left.source.length)
    .filter((replacement) => {
      const key = `${replacement.source}=>${replacement.target}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function buildJudgePromptDesanitizeReplacements(input: {
  teamA: Team;
  teamB: Team;
  promptTeamA: Team;
  promptTeamB: Team;
  activeA: Agent[];
  activeB: Agent[];
  promptActiveA: Agent[];
  promptActiveB: Agent[];
}): Array<{ source: string; target: string }> {
  const replacements: Array<{ source: string; target: string }> = [
    { source: input.promptTeamA.displayName, target: input.teamA.displayName },
    { source: input.promptTeamB.displayName, target: input.teamB.displayName },
    { source: input.promptTeamA.id, target: input.teamA.displayName },
    { source: input.promptTeamB.id, target: input.teamB.displayName },
    { source: input.promptTeamA.shortName, target: input.teamA.displayName },
    { source: input.promptTeamB.shortName, target: input.teamB.displayName }
  ];
  for (const [index, agent] of input.activeA.entries()) {
    const promptAgent = input.promptActiveA[index];
    if (promptAgent) {
      replacements.push({ source: promptAgent.displayName, target: agent.displayName });
      replacements.push({ source: promptAgent.id, target: agent.displayName });
    }
  }
  for (const [index, agent] of input.activeB.entries()) {
    const promptAgent = input.promptActiveB[index];
    if (promptAgent) {
      replacements.push({ source: promptAgent.displayName, target: agent.displayName });
      replacements.push({ source: promptAgent.id, target: agent.displayName });
    }
  }

  const seen = new Set<string>();
  return replacements
    .filter((replacement) => replacement.source.trim().length > 0)
    .sort((left, right) => right.source.length - left.source.length)
    .filter((replacement) => {
      const key = `${replacement.source}=>${replacement.target}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function sanitizeTeamPlansForJudge(
  teamPlans: Record<string, TeamRoundPlanDecision>,
  promptTeamIdByActualTeamId: Map<string, string>,
  promptAgentIdByActualAgentId: Map<string, string>,
  replacements: Array<{ source: string; target: string }>
): Record<string, TeamRoundPlanDecision> {
  return Object.fromEntries(
    Object.entries(teamPlans).map(([actualTeamId, teamPlan]) => {
      const promptTeamId = promptTeamIdByActualTeamId.get(actualTeamId);
      if (!promptTeamId) {
        throw new Error(`Missing prompt team id for judge sanitization: ${actualTeamId}`);
      }

      return [
        promptTeamId,
        {
          ...teamPlan,
          teamId: promptTeamId,
          primaryIntent: sanitizeJudgeText(teamPlan.primaryIntent, replacements),
          primaryZoneId: sanitizeJudgeText(teamPlan.primaryZoneId, replacements),
          ...(teamPlan.secondaryZoneId ? { secondaryZoneId: sanitizeJudgeText(teamPlan.secondaryZoneId, replacements) } : {}),
          coordinationSummary: sanitizeJudgeText(teamPlan.coordinationSummary, replacements),
          playerDirectives: teamPlan.playerDirectives.map((directive) => {
            const promptAgentId = promptAgentIdByActualAgentId.get(directive.agentId);
            if (!promptAgentId) {
              throw new Error(`Missing prompt agent id for judge sanitization: ${directive.agentId}`);
            }

            return {
              agentId: promptAgentId,
              directive: sanitizeJudgeText(directive.directive, replacements)
            };
          }),
          winCondition: sanitizeJudgeText(teamPlan.winCondition, replacements),
          risk: sanitizeJudgeText(teamPlan.risk, replacements),
          ...(teamPlan.fingerprint ? { fingerprint: `prompt_fp_${promptTeamId}` } : {})
        }
      ];
    })
  );
}

function sanitizeSideAssignmentForJudge(
  sideAssignment: SideAssignment,
  promptTeamIdByActualTeamId: Map<string, string>
): SideAssignment {
  const attackingTeamId = promptTeamIdByActualTeamId.get(sideAssignment.attackingTeamId);
  const defendingTeamId = promptTeamIdByActualTeamId.get(sideAssignment.defendingTeamId);
  if (!attackingTeamId || !defendingTeamId) {
    throw new Error("Missing prompt team ids for side assignment sanitization.");
  }

  return {
    ...sideAssignment,
    attackingTeamId,
    defendingTeamId
  };
}

function buildPromptAgentOutputsByTeam(input: {
  agentOutputs: AgentOutput[];
  promptTeamIdByActualTeamId: Map<string, string>;
  promptAgentIdByActualAgentId: Map<string, string>;
  replacements: Array<{ source: string; target: string }>;
}): Record<string, AgentOutput[]> {
  const outputsByTeam = new Map<string, AgentOutput[]>();
  for (const output of input.agentOutputs) {
    const promptTeamId = input.promptTeamIdByActualTeamId.get(output.teamId);
    const promptAgentId = input.promptAgentIdByActualAgentId.get(output.agentId);
    if (!promptTeamId || !promptAgentId) {
      throw new Error(`Missing prompt ids for judge output sanitization: ${output.agentId}/${output.teamId}`);
    }

    outputsByTeam.set(promptTeamId, [
      ...(outputsByTeam.get(promptTeamId) ?? []),
      {
        ...output,
        id: `prompt_${promptAgentId}`,
        agentId: promptAgentId,
        teamId: promptTeamId,
        action: sanitizeJudgeText(output.action, input.replacements),
        rawFingerprint: `prompt_fp_${promptAgentId}`
      }
    ]);
  }

  return Object.fromEntries(outputsByTeam);
}

function sanitizeJudgeText(value: string, replacements: Array<{ source: string; target: string }>): string {
  let output = value;
  for (const replacement of replacements) {
    output = output.replace(buildJudgeLiteralPattern(replacement.source), replacement.target);
  }
  return output;
}

function sanitizeJudgeValue(value: unknown, replacements: Array<{ source: string; target: string }>): unknown {
  if (typeof value === "string") {
    return sanitizeJudgeText(value, replacements);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJudgeValue(item, replacements));
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeJudgeValue(item, replacements)]));
  }
  return value;
}

function desanitizeJudgeText(value: string, replacements: Array<{ source: string; target: string }>): string {
  let output = value;
  for (const replacement of replacements) {
    output = output.replace(buildJudgeLiteralPattern(replacement.source), replacement.target);
  }
  return output;
}

function translateJudgePromptError(error: unknown, context: Phase18JudgePromptContext): Error {
  if (error instanceof Error) {
    const translated = context.translatePromptText(error.message);
    const nextError = new Error(translated);
    nextError.name = error.name;
    return nextError;
  }

  return new Error(context.translatePromptText(String(error)));
}

function buildJudgeLiteralPattern(value: string): RegExp {
  const escaped = escapeRegExp(value);
  return /^[A-Za-z0-9_]+$/.test(value) ? new RegExp(`\\b${escaped}\\b`, "gi") : new RegExp(escaped, "gi");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function detectSuspiciousJudgeResult(input: {
  judgeResult: JudgeResult;
  recentWinnerTeamIds: string[];
  teamA: Team;
  teamB: Team;
  teamPlans?: Record<string, TeamRoundPlanDecision>;
}): string | null {
  const recentWinners = input.recentWinnerTeamIds.slice(-3);
  const sameTeamWonRecentRounds = recentWinners.length >= 3 && recentWinners.every((teamId) => teamId === input.judgeResult.winnerTeamId);
  if (!sameTeamWonRecentRounds || input.judgeResult.confidence < 0.8) {
    return null;
  }

  const loserTeam = input.judgeResult.loserTeamId === input.teamA.id ? input.teamA : input.teamB;
  const loserPlan = input.teamPlans?.[loserTeam.id];
  if (loserPlan && hasDetailedLoserPlanExplanation(input.judgeResult.reason, loserTeam, loserPlan)) {
    return null;
  }

  return `same team ${input.judgeResult.winnerTeamId} is extending a 3-round streak with high confidence but the reason does not specifically explain ${loserTeam.displayName}'s failed plan`;
}

function hasLoserWinConditionExplanation(reason: string, loserTeam: Team): boolean {
  const normalized = reason.toLowerCase();
  const loserName = loserTeam.displayName.toLowerCase();
  const loserShortName = loserTeam.shortName.toLowerCase();
  const mentionsLoser = normalized.includes(loserTeam.id.toLowerCase()) || normalized.includes(loserName) || normalized.includes(loserShortName);
  const explainsCondition =
    normalized.includes("win condition") ||
    normalized.includes("condition") ||
    normalized.includes("failed") ||
    normalized.includes("risk") ||
    normalized.includes("failed to") ||
    normalized.includes("could not") ||
    normalized.includes("unable to");
  return mentionsLoser && explainsCondition;
}

function hasDetailedLoserPlanExplanation(reason: string, loserTeam: Team, loserPlan: TeamRoundPlanDecision): boolean {
  const normalizedReason = normalizeForJudgeReason(reason);
  if (!mentionsTeam(normalizedReason, loserTeam) || !containsAny(normalizedReason, LOSER_EXPLANATION_CUES)) {
    return false;
  }

  const specificPlanKeywords = extractSpecificPlanKeywords(loserPlan, loserTeam);
  return specificPlanKeywords.some((keyword) => normalizedReason.includes(keyword));
}

function hasWinnerAndLoserPlanExplanation(
  reason: string,
  winnerTeam: Team,
  loserTeam: Team,
  winnerPlan: TeamRoundPlanDecision,
  loserPlan: TeamRoundPlanDecision
): boolean {
  const normalizedReason = normalizeForJudgeReason(reason);
  const winnerMentioned = mentionsTeam(normalizedReason, winnerTeam);
  const loserMentioned = mentionsTeam(normalizedReason, loserTeam);
  if (!winnerMentioned || !loserMentioned) {
    return false;
  }

  const winnerExplained =
    mentionsWinCondition(normalizedReason, winnerPlan) && containsAny(normalizedReason, WINNER_EXPLANATION_CUES);
  const loserExplained = mentionsWinCondition(normalizedReason, loserPlan) && containsAny(normalizedReason, LOSER_EXPLANATION_CUES);
  return winnerExplained && loserExplained;
}

const WIN_CONDITION_SYNONYMS = [
  "win condition",
  "winning condition",
  "condition",
  "plan",
  "victory plan",
  "胜利条件",
  "获胜条件",
  "取胜条件",
  "胜负条件",
  "成立点",
  "计划",
  "方案",
  "命题",
  "子命题",
  "核心判断",
  "机会缺口",
  "用户定义",
  "核心用户",
  "痛点",
  "场景",
  "切口",
  "价值"
];
const WINNER_EXPLANATION_CUES = [
  "succeeded",
  "success",
  "converted",
  "secured",
  "won",
  "executed",
  "held",
  "landed",
  "成功",
  "打成",
  "打穿",
  "打击",
  "精准打击",
  "压制",
  "守住",
  "拿下",
  "赢得",
  "兑现",
  "建立",
  "塑造",
  "锚定",
  "完成",
  "成立"
];
const LOSER_EXPLANATION_CUES = [
  "failed",
  "failed to",
  "could not",
  "unable to",
  "collapsed",
  "denied",
  "stopped",
  "lost",
  "失败",
  "未能",
  "没能",
  "不能",
  "无法",
  "缺乏",
  "暴露",
  "被迫",
  "沦为",
  "丢失",
  "被打击",
  "被压制",
  "没有",
  "不足"
];
const COMMON_PLAN_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "their",
  "this",
  "that",
  "with",
  "from",
  "into",
  "through",
  "after",
  "before",
  "because",
  "while",
  "where",
  "when",
  "then",
  "than",
  "team",
  "round",
  "site",
  "zone",
  "risk",
  "plan",
  "condition",
  "hold",
  "take",
  "win",
  "wins",
  "won",
  "for",
  "they",
  "them",
  "were",
  "was",
  "is",
  "are",
  "to",
  "of",
  "on",
  "in",
  "by"
]);

function mentionsTeam(normalizedReason: string, team: Team): boolean {
  const candidates = [team.id, team.displayName, team.shortName]
    .map((value) => normalizeForJudgeReason(value))
    .filter((value) => value.length > 0);
  return candidates.some((candidate) => normalizedReason.includes(candidate));
}

function mentionsWinCondition(normalizedReason: string, plan: TeamRoundPlanDecision): boolean {
  if (containsAny(normalizedReason, WIN_CONDITION_SYNONYMS)) {
    return true;
  }

  const keywords = extractPlanKeywords(plan);
  return keywords.some((keyword) => normalizedReason.includes(keyword));
}

function extractPlanKeywords(plan: TeamRoundPlanDecision): string[] {
  const values = [plan.primaryIntent, plan.primaryZoneId, plan.secondaryZoneId, plan.winCondition, plan.risk]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => normalizeForJudgeReason(value));
  const keywords = new Set<string>();
  for (const value of values) {
    const words = value.split(/\s+/).filter((word) => word.length >= 4 && !COMMON_PLAN_WORDS.has(word));
    for (const word of words) {
      keywords.add(word);
    }
  }

  return [...keywords];
}

function extractSpecificPlanKeywords(plan: TeamRoundPlanDecision, team: Team): string[] {
  const teamKeywords = new Set(
    [team.id, team.displayName, team.shortName]
      .flatMap((value) => normalizeForJudgeReason(value).split(/\s+/))
      .filter((word) => word.length >= 2)
  );
  return extractPlanKeywords(plan).filter((keyword) => !teamKeywords.has(keyword));
}

function containsAny(value: string, candidates: string[]): boolean {
  return candidates.some((candidate) => value.includes(candidate));
}

function normalizeForJudgeReason(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").trim();
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

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item !== "undefined")) as T;
}

function readLlmErrorDiagnostic(error: unknown): {
  rawText?: string;
  usage?: LlmResponse["usage"];
  parseCandidate?: string;
} {
  if (!isRecord(error)) {
    return {};
  }

  return {
    ...(typeof error.rawText === "string" ? { rawText: error.rawText } : {}),
    ...(isRecord(error.usage) &&
    typeof error.usage.promptTokens === "number" &&
    typeof error.usage.completionTokens === "number" &&
    typeof error.usage.totalTokens === "number"
      ? {
          usage: {
            promptTokens: error.usage.promptTokens,
            completionTokens: error.usage.completionTokens,
            totalTokens: error.usage.totalTokens
          }
        }
      : {}),
    ...(typeof error.parseCandidate === "string" ? { parseCandidate: error.parseCandidate } : {})
  };
}

function previewText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.length > 800 ? `${trimmed.slice(0, 800)}...` : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
