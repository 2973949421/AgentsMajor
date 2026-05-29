import type { Repositories } from "@agent-major/db";
import type { LlmGateway, LlmMessage, LlmResponse } from "@agent-major/llm";
import type { JobQueue } from "@agent-major/queue";
import {
  agentActionDecisionSchema,
  coachPostMatchReviewSchema,
  coachTimeoutCorrectionSchema,
  judgeDiagnosticSchema,
  judgeResultSchema,
  teamInitialProposalSchema,
  teamInitialProposalSummarySchema,
  teamProposalAnchorSchema,
  teamRoundPlanDecisionSchema,
  type Agent,
  type AgentActionDecision,
  type AgentEconomyDelta,
  type AgentOutput,
  type BuyType,
  type CoachPostMatchReview,
  type CoachTimeoutCorrection,
  type EconomyState,
  type Event,
  type JudgeDiagnostic,
  type JudgeRoundWinType,
  type JudgeResult,
  type MapGame,
  type Match,
  type ProjectedEvent,
  type Round,
  type RoundCombatResolution,
  type RoundKeyEvent,
  type RoundReport,
  type RoundKillLedgerEntry,
  type ScorePair,
  type SideAssignment,
  type Summary,
  type TacticalCollision,
  type Team,
  type TeamInitialProposal,
  type TeamInitialProposalSummary,
  type TeamProposalAnchor,
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
  PHASE20_PRE_PROMPT_CONTRACT_ID,
  buildPhase20PrePromptHashSource,
  buildPhase20PreStructuredMessages,
  type Phase20PrePromptTask
} from "./phase20-pre-prompt-contract.js";
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
  coachTimeout?: ResolvedCoachTimeout;
  teamPlans?: Record<string, TeamRoundPlanDecision>;
  agentOutputs: AgentOutput[];
  judgeResult: JudgeResult;
  tacticalRound?: TacticalRoundGeneration;
  keyEvents: RoundKeyEvent[];
  killLedger: RoundKillLedgerEntry[];
  roundCombatResolution: RoundCombatResolution;
}

interface ResolvedCoachTimeout {
  teamId: string;
  teamName: string;
  triggerRoundId: string;
  triggerRoundNumber: number;
  correction: CoachTimeoutCorrection;
  responseArtifactId?: string;
  timeoutsRemainingBefore: number;
  timeoutsRemainingAfter: number;
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
  timeoutUsedEvent?: Event;
  coachTimeoutCorrectionEvent?: Event;
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
      initialProposalSummary?: TeamInitialProposalSummary;
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
  actualAgentOutputs: AgentOutput[];
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
    await this.ensureCoachStatesForMap(updated, match);
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
      const round = await this.commitRoundGeneration(generation);
      const committedMapGame = await this.context.repositories.mapGames.getById(round.mapGameId);
      if (committedMapGame) {
        const committedMatch = await this.context.repositories.matches.getById(committedMapGame.matchId);
        if (committedMatch?.status === "completed") {
          await this.generateCoachPostMatchReviewsIfNeeded(committedMatch);
        }
      }
      return round;
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
    await this.ensureCoachStatesForMap(mapGame, match);

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
    const coachTimeout = await this.resolveCoachTimeoutIfNeeded({
      match,
      mapGame,
      round,
      observabilityAttempt,
      roundNumber,
      scoreBeforeRound,
      teamA,
      teamB,
      activeA,
      activeB,
      recentRoundReports
    });
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
          recentPublicRoundSummaries,
          ...(coachTimeout ? { coachTimeout } : {})
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
      ...(teamPlans ? { teamPlans } : {}),
      ...(coachTimeout ? { coachTimeout } : {})
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
      ...(coachTimeout ? { coachTimeout } : {}),
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
    const tacticalCollision = tacticalRound?.collision;
    const keyEvents = tacticalCollision
      ? buildKeyEvents({
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
          tacticalCollision
        })
      : buildKeyEvents({
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
    const roundCombatResolution = buildRoundCombatResolution({
      roundId,
      roundNumber,
      winnerTeamId,
      loserTeamId,
      activeA,
      activeB,
      agentOutputs,
      judgeResult,
      economyDelta,
      teamABuyType,
      teamBBuyType,
      keyEvents,
      tacticalCollision
    });
    const killLedger = roundCombatResolution.killEvents;

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
      ...(coachTimeout ? { coachTimeout } : {}),
      ...(teamPlans ? { teamPlans } : {}),
      agentOutputs,
      judgeResult,
      ...(tacticalRound ? { tacticalRound } : {}),
      keyEvents,
      killLedger,
      roundCombatResolution
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
        let timeoutUsedEvent: Event | undefined;
        let coachTimeoutCorrectionEvent: Event | undefined;
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
        if (generation.coachTimeout) {
          timeoutUsedEvent = await this.appendEvent({
            id: `evt_${round.id}_timeout_used_${safeId(generation.coachTimeout.teamId)}`,
            type: "timeout_used",
            category: "runtime_control",
            tournamentId: match.tournamentId,
            matchId: match.id,
            mapGameId: mapGame.id,
            roundId: round.id,
            scopeType: "round",
            scopeId: round.id,
            payload: {
              schemaVersion: 1,
              teamId: generation.coachTimeout.teamId,
              teamName: generation.coachTimeout.teamName,
              triggerRoundId: generation.coachTimeout.triggerRoundId,
              triggerRoundNumber: generation.coachTimeout.triggerRoundNumber,
              timeoutsRemainingBefore: generation.coachTimeout.timeoutsRemainingBefore,
              timeoutsRemainingAfter: generation.coachTimeout.timeoutsRemainingAfter
            },
            createdAt: now
          });
          coachTimeoutCorrectionEvent = await this.appendEvent({
            id: `evt_${round.id}_coach_timeout_correction_${safeId(generation.coachTimeout.teamId)}`,
            type: "coach_timeout_correction_created",
            category: "runtime_control",
            tournamentId: match.tournamentId,
            matchId: match.id,
            mapGameId: mapGame.id,
            roundId: round.id,
            scopeType: "round",
            scopeId: round.id,
            payload: removeUndefined({
              schemaVersion: 1,
              visibility: "public_after_round",
              teamId: generation.coachTimeout.teamId,
              teamName: generation.coachTimeout.teamName,
              triggerRoundNumber: generation.coachTimeout.triggerRoundNumber,
              expiresAfterRoundNumber: generation.coachTimeout.correction.expiresAfterRoundNumber,
              correction: generation.coachTimeout.correction,
              artifactId: generation.coachTimeout.responseArtifactId
            }),
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
        const validatedKillLedger = validateRoundKillLedger({
          killLedger: generation.killLedger,
          activeA: generation.activeA,
          activeB: generation.activeB,
          winnerTeamId: generation.judgeResult.winnerTeamId,
          loserTeamId: generation.judgeResult.loserTeamId
        });
        for (const [index, kill] of validatedKillLedger.entries()) {
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
                atMs: kill.atMs,
                keyEventId: kill.keyEventId,
                actorAgentId: kill.actorAgentId,
                actorTeamId: kill.actorTeamId,
                targetAgentId: kill.targetAgentId,
                targetTeamId: kill.targetTeamId,
                zoneId: kill.zoneId,
                text: kill.impact,
                sourceAgentOutputIds: kill.sourceAgentOutputIds ?? []
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
          ...[sideAssignmentEvent, tacticalPlanEvent, zoneDeploymentEvent, timeoutUsedEvent, coachTimeoutCorrectionEvent, siteExecuteEvent]
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
          ...(generation.coachTimeout ? { appliedCoachTimeoutCorrection: generation.coachTimeout.correction } : {}),
          keyEvents: generation.keyEvents,
          killLedger: validatedKillLedger.map((kill, index) => ({
            ...kill,
            sourceEventId: killFeedEvents[index]?.id
          })),
          roundCombatResolution: {
            ...generation.roundCombatResolution,
            killEvents: validatedKillLedger.map((kill, index) => ({
              ...kill,
              sourceEventId: killFeedEvents[index]?.id
            }))
          },
          economyDelta: generation.economyDelta,
          tokenSubmission: {
            activeAgentIds: generation.allActive.map((agent) => agent.id),
            submittedOutputIds: generation.agentOutputs.map((output) => output.id),
            totalOutputBudget: generation.economyStates.reduce((sum, state) => sum + (state.outputBudget ?? 0), 0),
            outputGate: {
              applied: true,
              reason: "本地确定性输出闸门：按 active agent 数量与本回合买型态势限制输出预算。"
            }
          },
          highlightTags,
          ...(generation.judgeResult.diagnostic ? { judgeDiagnostic: generation.judgeResult.diagnostic } : {}),
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
        if (generation.coachTimeout) {
          await this.context.repositories.teamMapCoachStates.save({
            mapGameId: mapGame.id,
            teamId: generation.coachTimeout.teamId,
            timeoutsRemaining: generation.coachTimeout.timeoutsRemainingAfter,
            lastTimeoutRoundNumber: generation.coachTimeout.triggerRoundNumber,
            updatedAt: now
          });
        }
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
          ...(timeoutUsedEvent ? { timeoutUsedEvent } : {}),
          ...(coachTimeoutCorrectionEvent ? { coachTimeoutCorrectionEvent } : {}),
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
          reason: "地图已完成，进入本地图回放复盘窗口。"
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

  private async ensureCoachStatesForMap(mapGame: MapGame, match: Match): Promise<void> {
    const existingStates = await this.context.repositories.teamMapCoachStates.listByMapGame(mapGame.id);
    const existingTeamIds = new Set(existingStates.map((state) => state.teamId));
    const now = timestamp();
    for (const teamId of [match.teamAId, match.teamBId]) {
      if (existingTeamIds.has(teamId)) {
        continue;
      }

      await this.context.repositories.teamMapCoachStates.save({
        mapGameId: mapGame.id,
        teamId,
        timeoutsRemaining: 2,
        updatedAt: now
      });
    }
  }

  private async resolveCoachTimeoutIfNeeded(input: {
    match: Match;
    mapGame: MapGame;
    round: Round;
    observabilityAttempt: number;
    roundNumber: number;
    scoreBeforeRound: ScorePair;
    teamA: Team;
    teamB: Team;
    activeA: Agent[];
    activeB: Agent[];
    recentRoundReports: RoundReport[];
  }): Promise<ResolvedCoachTimeout | undefined> {
    const previousReport = input.recentRoundReports.at(-1);
    if (!previousReport) {
      return undefined;
    }

    const losingTeamId = previousReport.winnerTeamId === input.teamA.id ? input.teamB.id : input.teamA.id;
    const losingTeam = losingTeamId === input.teamA.id ? input.teamA : input.teamB;
    const activeAgents = losingTeamId === input.teamA.id ? input.activeA : input.activeB;
    const coachState = await this.context.repositories.teamMapCoachStates.getByMapGameAndTeam(input.mapGame.id, losingTeamId);
    if (!coachState || coachState.timeoutsRemaining <= 0) {
      return undefined;
    }
    if (input.roundNumber < coachTimeoutMinRoundNumber) {
      return undefined;
    }
    if (
      typeof coachState.lastTimeoutRoundNumber === "number" &&
      input.roundNumber - coachState.lastTimeoutRoundNumber <= coachTimeoutCooldownRounds
    ) {
      return undefined;
    }

    const triggerReason = detectCoachTimeoutTrigger({
      losingTeam,
      recentRoundReports: input.recentRoundReports,
      scoreBeforeRound: input.scoreBeforeRound,
      teamAId: input.teamA.id,
      teamBId: input.teamB.id
    });
    if (!triggerReason) {
      return undefined;
    }

    const response = await this.runObservedStructuredCall<CoachTimeoutCorrection>({
      callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_team_${safeId(losingTeamId)}_coach_timeout`,
      attemptNumber: input.observabilityAttempt,
      task: "coach_timeout",
      schemaName: "CoachTimeoutCorrection",
      driverModelId: activeAgents[0]?.driverModelId ?? "",
      requestInput: {
        objective: "在战术暂停窗口内输出一张只影响下一回合的结构化修正单。",
        roundId: input.round.id,
        roundNumber: input.roundNumber,
        mapName: input.mapGame.mapName,
        teamId: losingTeam.id,
        teamName: losingTeam.displayName,
        mapSemanticContext: readPhase18MapSemanticContext(this.context, input.mapGame.mapName),
        judgeRubricContext: readPhase18JudgeRubricContext(this.context, input.mapGame.mapName),
        initialProposal: readTeamMaterialInitialProposal(losingTeam),
        coachContext: readTeamHeadCoachProfile(losingTeam),
        teamMemoryOverlay: await this.readApprovedTeamMemoryOverlay(losingTeam.id),
        triggerRoundNumber: previousReport.roundNumber,
        triggerRoundSummary: previousReport.summary,
        triggerReason,
        triggerPolicy: {
          earliestTimeoutRound: coachTimeoutMinRoundNumber,
          cooldownRoundsAfterLastTimeoutTrigger: coachTimeoutCooldownRounds,
          repeatedGapRequiresAtLeastTwoMatchingDiagnostics: true
        },
        antiOvercorrectionRules: [
          "修正单只能指定主优先区，不能让五名选手全部压向同一单点。",
          "必须保留至少一个次级区域的信息锚点或回防锚点。",
          "禁止使用“唯一主攻方向”“不参与某区任何行动”“取消所有某区 call”这类绝对指令。",
          "playerAdjustments 可以分工不同：3人围绕主区，1人信息，1人回防/兜底。"
        ],
        latestJudgeDiagnostic: previousReport.judgeDiagnostic ?? previousReport.judgeResult.diagnostic,
        recentPublicRoundSummaries: input.recentRoundReports.map((report) => report.summary),
        activeAgents: activeAgents.map((agent) => ({
          id: agent.id,
          displayName: agent.displayName,
          role: agent.role,
          roleResponsibilities: agent.roleProfile?.agentMajorResponsibilities ?? []
        }))
      },
      responseFormat: "json_object",
      seed: `coach_timeout:${input.round.id}:${losingTeam.id}`,
      modelTier: "cheap",
      temperature: 0,
      maxOutputTokens: 900,
      match: input.match,
      mapGame: input.mapGame,
      round: input.round,
      roundNumber: input.roundNumber,
      validateResponseData: (data) =>
        validateCoachTimeoutCorrection({
          correction: coachTimeoutCorrectionSchema.parse(normalizeCoachTimeoutCorrectionPayload(data)),
          teamId: losingTeam.id,
          triggerRoundNumber: previousReport.roundNumber,
          expiresAfterRoundNumber: input.roundNumber,
          activeAgents
        })
    });

    return {
      teamId: losingTeam.id,
      teamName: losingTeam.displayName,
      triggerRoundId: previousReport.roundId,
      triggerRoundNumber: previousReport.roundNumber,
      correction: response.data,
      ...(response.responseArtifactId ? { responseArtifactId: response.responseArtifactId } : {}),
      timeoutsRemainingBefore: coachState.timeoutsRemaining,
      timeoutsRemainingAfter: Math.max(0, coachState.timeoutsRemaining - 1)
    };
  }

  private async readApprovedTeamMemoryOverlay(teamId: string): Promise<Record<string, unknown> | undefined> {
    const summary = await this.context.repositories.summaries.getLatestByScope("team", teamId);
    if (!summary) {
      return undefined;
    }

    const payload = readUnknownRecord(summary.payload);
    if (!payload || payload.kind !== "coach_post_match_review" || payload.status !== "approved") {
      return undefined;
    }

    return readUnknownRecord(payload.review);
  }

  private async generateCoachPostMatchReviewsIfNeeded(match: Match): Promise<void> {
    const [teamA, teamB] = (await Promise.all([
      required(this.context.repositories.teams.getById(match.teamAId), `Team not found: ${match.teamAId}`),
      required(this.context.repositories.teams.getById(match.teamBId), `Team not found: ${match.teamBId}`)
    ])) as [Team, Team];
    const mapGames = (await this.context.repositories.mapGames.listByMatch(match.id)).sort((left, right) => left.order - right.order);
    const mapSummaries = (
      await Promise.all(mapGames.map((mapGame) => (mapGame.summaryId ? this.context.repositories.summaries.getById(mapGame.summaryId) : null)))
    ).filter((summary): summary is Summary => Boolean(summary));
    const matchSummary = await this.context.repositories.summaries.getLatestByScope("match", match.id);
    const matchEvents = await this.context.repositories.events.listByMatch(match.id);

    for (const team of [teamA, teamB]) {
      const existingSummary = await this.context.repositories.summaries.getLatestByScope("team", team.id);
      const existingPayload = readUnknownRecord(existingSummary?.payload);
      if (existingPayload?.kind === "coach_post_match_review" && existingPayload.matchId === match.id) {
        continue;
      }

      const teamAgents = sortAgentsForRound(await this.context.repositories.agents.listByTeam(team.id));
      const driverModelId = teamAgents[0]?.driverModelId ?? "";
      if (!driverModelId) {
        continue;
      }

      const response = await this.runObservedMatchStructuredCall<CoachPostMatchReview>({
        callId: `llm_${safeId(match.id)}_team_${safeId(team.id)}_coach_post_match_review`,
        task: "coach_post_match_review",
        schemaName: "CoachPostMatchReview",
        driverModelId,
        requestInput: {
          objective: "生成一份只服务下一场比赛、且需要人工确认后才会采纳的赛后复盘。",
          matchId: match.id,
          teamId: team.id,
          teamName: team.displayName,
          coachContext: readTeamHeadCoachProfile(team),
          initialProposal: readTeamMaterialInitialProposal(team),
          teamMemoryOverlay: await this.readApprovedTeamMemoryOverlay(team.id),
          matchSummary: matchSummary?.payload,
          mapSummaries: mapSummaries.map((summary) => summary.payload),
          timeoutUsage: summarizeCoachTimeoutUsage(matchEvents, team.id),
          latestMapResults: mapGames.map((mapGame) => ({
            mapGameId: mapGame.id,
            mapName: mapGame.mapName,
            winnerTeamId: mapGame.winnerTeamId,
            score: {
              teamA: mapGame.teamAScore,
              teamB: mapGame.teamBScore
            }
          }))
        },
        responseFormat: "json_object",
        seed: `coach_post_match_review:${match.id}:${team.id}`,
        modelTier: "cheap",
        temperature: 0,
        maxOutputTokens: 1700,
        match,
        validateResponseData: (data) =>
          validateCoachPostMatchReview({
            review: coachPostMatchReviewSchema.parse(data),
            teamId: team.id,
            matchId: match.id
          })
      });

      const createdAt = timestamp();
      const summaryId = `summary_${match.id}_${team.id}_coach_post_match_review`;
      const pendingSummary: Summary = {
        id: summaryId,
        summaryType: "team_memory",
        scopeType: "team",
        scopeId: team.id,
        tournamentId: match.tournamentId,
        matchId: match.id,
        title: `赛后复盘待采纳：${team.displayName}`,
        content: `${team.displayName} 的教练赛后复盘已生成，等待人工确认后再作为下一场补丁。`,
        payload: {
          kind: "coach_post_match_review",
          status: "pending",
          teamId: team.id,
          matchId: match.id,
          review: response.data
        },
        sourceEventIds: [],
        createdAt
      };
      await this.context.repositories.summaries.save(pendingSummary);
      await this.appendEvent({
        id: `evt_${match.id}_${team.id}_coach_post_match_review_created`,
        type: "coach_post_match_review_created",
        category: "runtime_control",
        tournamentId: match.tournamentId,
        matchId: match.id,
        scopeType: "match",
        scopeId: match.id,
        payload: {
          schemaVersion: 1,
          matchId: match.id,
          teamId: team.id,
          teamName: team.displayName,
          summaryId,
          status: "pending",
          responseArtifactId: response.responseArtifactId
        },
        createdAt
      });
    }
  }

  private async runObservedMatchStructuredCall<TData>(input: {
    callId: string;
    task: "coach_post_match_review";
    schemaName: string;
    driverModelId: string;
    requestInput: unknown;
    responseFormat: "json_object";
    seed: string;
    modelTier: "cheap" | "standard" | "strong";
    temperature: number;
    maxOutputTokens?: number;
    match: Match;
    validateResponseData?: (data: unknown) => TData;
  }) {
    const promptContractId = PHASE20_PRE_PROMPT_CONTRACT_ID;
    const promptHash = stableHex(buildPhase20PrePromptHashSource({
      task: input.task,
      schemaName: input.schemaName,
      requestInput: input.requestInput,
      promptContractId
    }));
    const startedAt = timestamp();
    const requestArtifactId = await this.writeLlmArtifact({
      callId: input.callId,
      suffix: "request",
      artifactType: "llm_request",
      match: input.match,
      content: {
        schemaVersion: 1,
        taskType: input.task,
        driverModelId: input.driverModelId,
        schemaName: input.schemaName,
        promptContractId,
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
      scopeType: "match",
      scopeId: input.match.id,
      payload: {
        schemaVersion: 1,
        callId: input.callId,
        taskType: input.task,
        driverModelId: input.driverModelId,
        promptContractId,
        status: "started",
        startedAt
      },
      createdAt: startedAt
    });

    let latestResponse: LlmResponse<TData> | undefined;
    try {
      assertNoMojibakePayload(input.requestInput, `${input.task} request`);
      const messages = buildPhase18StructuredMessages({
        task: input.task,
        schemaName: input.schemaName,
        requestInput: input.requestInput
      });
      assertNoMojibakePayload(messages, `${input.task} prompt messages`);
      const response = await this.context.llmGateway.generateStructured<TData, unknown>({
        task: input.task,
        driverModelId: input.driverModelId,
        input: input.requestInput,
        schemaName: input.schemaName,
        messages,
        responseFormat: input.responseFormat,
        seed: input.seed,
        modelTier: input.modelTier,
        temperature: input.temperature,
        ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {})
      });
      latestResponse = response;
      assertNoMojibakePayload(response.rawText, `${input.task} raw response`);
      assertNoMojibakePayload(response.structuredRepair?.originalRawText, `${input.task} repair original response`);
      assertNoMojibakePayload(response.structuredRepair?.repairRawText, `${input.task} repair response`);
      assertNoMojibakePayload(response.data, `${input.task} structured response`);
      const data = input.validateResponseData ? input.validateResponseData(response.data) : response.data;
      const validatedResponse: LlmResponse<TData> = { ...response, data };
      const completedAt = timestamp();
      const responseArtifactId = await this.writeLlmArtifact({
        callId: input.callId,
        suffix: "response",
        artifactType: "llm_response",
        match: input.match,
        content: {
          schemaVersion: 1,
          taskType: input.task,
          driverModelId: input.driverModelId,
          promptContractId,
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
        driverModelId: input.driverModelId,
        taskType: input.task,
        promptContractId,
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
        scopeType: "match",
        scopeId: input.match.id,
        payload: {
          schemaVersion: 1,
          callId: input.callId,
          taskType: input.task,
          driverModelId: input.driverModelId,
          promptContractId,
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
      return {
        ...validatedResponse,
        requestArtifactId,
        responseArtifactId
      };
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
        content: {
          schemaVersion: 1,
          taskType: input.task,
          driverModelId: input.driverModelId,
          promptContractId,
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
        driverModelId: input.driverModelId,
        taskType: input.task,
        promptContractId,
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
        scopeType: "match",
        scopeId: input.match.id,
        payload: {
          schemaVersion: 1,
          callId: input.callId,
          taskType: input.task,
          driverModelId: input.driverModelId,
          promptContractId,
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
    coachTimeout?: ResolvedCoachTimeout;
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
          judgeRubricContext: readPhase18JudgeRubricContext(this.context, input.mapGame.mapName),
          teamId: side.team.id,
          teamName: side.team.displayName,
          initialProposal: readTeamMaterialInitialProposal(side.team),
          coachContext: readTeamHeadCoachProfile(side.team),
          teamMemoryOverlay: await this.readApprovedTeamMemoryOverlay(side.team.id),
          opponentTeamId: side.opponent.id,
          opponentTeamName: side.opponent.displayName,
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
          recentPublicRoundSummaries: input.recentPublicRoundSummaries,
          ...(input.coachTimeout?.teamId === side.team.id ? { coachCorrection: input.coachTimeout.correction } : {})
        },
        responseFormat: "json_object",
        seed: `team_plan:${input.round.id}:${side.team.id}`,
        modelTier: "cheap",
        temperature: 0,
        maxOutputTokens: 1100,
        match: input.match,
        mapGame: input.mapGame,
        round: input.round,
        roundNumber: input.round.roundNumber,
        validateResponseData: (data) =>
          validateTeamRoundPlan({
            plan: teamRoundPlanDecisionSchema.parse(normalizeTeamRoundPlanPayload(data)),
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
    coachTimeout?: ResolvedCoachTimeout;
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
      const coachAdjustment =
        input.coachTimeout?.teamId === agent.teamId
          ? input.coachTimeout.correction.playerAdjustments.find(
              (adjustment: CoachTimeoutCorrection["playerAdjustments"][number]) => adjustment.agentId === agent.id
            )
          : undefined;
      const requestInput = {
        objective: "Choose this player's concrete tactical action for the current round.",
        roundId: input.round.id,
        roundNumber: input.round.roundNumber,
        mapName: input.mapGame.mapName,
        agentId: agent.id,
        agentDisplayName: agent.displayName,
        teamId: agent.teamId,
        teamName: agentTeam.displayName,
        proposalAnchor: readTeamProposalAnchor(agentTeam, agent),
        coachContext: readTeamHeadCoachProfile(agentTeam),
        teamMemoryOverlay: await this.readApprovedTeamMemoryOverlay(agentTeam.id),
        opponentTeamId: opponentTeam.id,
        opponentTeamName: opponentTeam.displayName,
        role: agent.role,
        secondaryRoles: agent.secondaryRoles ?? [],
        roleResponsibilities: agent.roleProfile?.agentMajorResponsibilities ?? [],
        baseProfile: agent.baseProfile,
        mapSemanticContext: readPhase18MapSemanticContext(this.context, input.mapGame.mapName),
        teamPlan,
        playerDirective,
        ...(coachAdjustment ? { coachAdjustment } : {}),
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
            maxOutputTokens: 1100,
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
      const fallbackActionDetail: AgentActionDecision = {
        roundObjective: `${agent.displayName} 在本回合以 ${buyType} ${posture} 姿态执行 ${input.mapGame.mapName} 上的队伍计划。`,
        executionPlan: "按照队伍计划选择一个可执行的站位、观察或推进动作，避免把计划性动作写成已经发生的战斗结果。",
        coordinationPlan: playerDirective?.directive ?? "根据 IGL 与队伍计划同步节奏，保持和相邻队友的交易、牵制或信息衔接。",
        roleResponsibilityUsage: (agent.roleProfile?.agentMajorResponsibilities ?? []).join(" / ") || "使用本位置的长期职责支持队伍计划。",
        riskRead: "如果首个信息点不足或队友节奏受阻，本行动可能无法给裁判提供足够明确的执行证据。",
        contingencyPlan: "受阻时回到队伍计划的次级区域或支援职责，保留可审计的修正路径。",
        expectedContribution: "为裁判提供该选手如何履行职责、如何支持队伍计划以及如何处理风险的结构化证据。",
        confidence: 0.72 + (stableNumber(agent.id, 18) / 100),
        fingerprint: response.data.fingerprint ?? stableHex(`${input.round.id}:${agent.id}`)
      };
      const actionDetail = llmDecision ?? fallbackActionDetail;
      const output = {
        id: `out_${input.round.id}_${agent.id}`,
        agentId: agent.id,
        teamId: agent.teamId,
        role: agent.role,
        driverModelId: agent.driverModelId,
        actionDetail,
        confidence: actionDetail.confidence,
        rawFingerprint: actionDetail.fingerprint ?? response.data.fingerprint ?? stableHex(`${input.round.id}:${agent.id}`)
      };
      outputs.push(output);
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
    coachTimeout?: ResolvedCoachTimeout;
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
        ...(input.coachTimeout ? { appliedCoachCorrection: input.coachTimeout.correction } : {}),
        ...judgePromptContext.requestInput
      };
      const mapSemanticContext = readPhase18MapSemanticContext(this.context, input.mapGame.mapName);
      const validateJudgeResponseData = (data: unknown) => {
        try {
          const translatedJudgeResult = judgePromptContext.validateAndTranslate(judgeResultSchema.parse(normalizeJudgeResultPayload(data)));
          return ensureJudgeDiagnostic({
            judgeResult: translatedJudgeResult,
            roundNumber: input.roundNumber,
            sideAssignment: input.sideAssignment,
            teamA: input.teamA,
            teamB: input.teamB,
            ...(input.teamPlans ? { teamPlans: input.teamPlans } : {}),
            agentOutputs: input.agentOutputs,
            ...(mapSemanticContext ? { mapSemanticContext } : {})
          });
        } catch (error) {
          throw translateJudgePromptError(error, judgePromptContext);
        }
      };
      let response: LlmResponse<JudgeResult>;
      try {
        response = await this.runObservedStructuredCall<JudgeResult>({
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
          maxOutputTokens: 1300,
          match: input.match,
          mapGame: input.mapGame,
          round: input.round,
          roundNumber: input.roundNumber,
          validateResponseData: validateJudgeResponseData
        });
      } catch (error) {
        const validationError = error instanceof Error ? error.message : String(error);
        if (!shouldAttemptJudgeRepair(validationError)) {
          throw error;
        }
        response = await this.repairInvalidJudgeResult({
          validationError,
          judgeRequestInput,
          judgePromptContext,
          match: input.match,
          mapGame: input.mapGame,
          round: input.round,
          roundNumber: input.roundNumber,
          observabilityAttempt: input.observabilityAttempt,
          driverModelId: input.activeA[0]?.driverModelId ?? input.activeB[0]?.driverModelId ?? "",
          validateResponseData: validateJudgeResponseData
        });
      }
      const authoritativeJudgeResult = response.data;
      if (!this.context.useJudgeBiasGuardrail) {
        return authoritativeJudgeResult;
      }

      const suspicious = detectSuspiciousJudgeResult({
        judgeResult: authoritativeJudgeResult,
        recentWinnerTeamIds: input.recentWinnerTeamIds,
        teamA: input.teamA,
        teamB: input.teamB,
        ...(input.teamPlans ? { teamPlans: input.teamPlans } : {})
      });
      if (!suspicious) {
        return authoritativeJudgeResult;
      }

      return this.reviewSuspiciousJudgeResult({
        originalJudgeResult: authoritativeJudgeResult,
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
        activeB: input.activeB,
        sideAssignment: input.sideAssignment
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
    const roundWinType = buildFallbackJudgeRoundWinType(winnerTeamId, input.sideAssignment);

    return {
      winnerTeamId,
      loserTeamId,
      margin,
      roundWinType,
      attackWinConditionMet: roundWinType.startsWith("attack_"),
      defenseWinConditionMet: roundWinType.startsWith("defense_"),
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
    sideAssignment: SideAssignment;
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
      maxOutputTokens: 1100,
      match: input.match,
      mapGame: input.mapGame,
      round: input.round,
      roundNumber: input.roundNumber,
      validateResponseData: (data) => {
        try {
          const translatedJudgeResult = input.judgePromptContext.validateAndTranslate(judgeResultSchema.parse(normalizeJudgeResultPayload(data)));
          const mapSemanticContext = readPhase18MapSemanticContext(this.context, input.mapGame.mapName);
          return ensureJudgeDiagnostic({
            judgeResult: translatedJudgeResult,
            roundNumber: input.roundNumber,
            sideAssignment: input.sideAssignment,
            teamA: input.teamA,
            teamB: input.teamB,
            ...(teamPlans ? { teamPlans } : {}),
            agentOutputs: input.judgePromptContext.actualAgentOutputs,
            ...(mapSemanticContext ? { mapSemanticContext } : {})
          });
        } catch (error) {
          throw translateJudgePromptError(error, input.judgePromptContext);
        }
      }
    });
    const reviewedJudgeResult = response.data;
    const loserTeam = reviewedJudgeResult.loserTeamId === input.teamA.id ? input.teamA : input.teamB;
    const loserPlan = teamPlans?.[loserTeam.id];
    if (!loserPlan || !hasDetailedLoserPlanExplanation(reviewedJudgeResult.reason, loserTeam, loserPlan)) {
      throw new Error(`Judge review failed anti-bias guardrail: ${input.guardrailReason}`);
    }

    return reviewedJudgeResult;
  }

  private async repairInvalidJudgeResult(input: {
    validationError: string;
    judgeRequestInput: unknown;
    judgePromptContext: Phase18JudgePromptContext;
    match: Match;
    mapGame: MapGame;
    round: Round;
    roundNumber: number;
    observabilityAttempt: number;
    driverModelId: string;
    validateResponseData: (data: unknown) => JudgeResult;
  }): Promise<LlmResponse<JudgeResult>> {
    return this.runObservedStructuredCall<JudgeResult>({
      callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_judge_repair`,
      attemptNumber: input.observabilityAttempt,
      task: "judge_review",
      schemaName: "JudgeResult",
      driverModelId: input.driverModelId,
      requestInput: {
        objective:
          "The first judge output failed validation. Regenerate one complete JudgeResult that satisfies the same contract. Do not loosen the ruling; fix only structure, evidence boundaries, and unsupported assertions.",
        validationError: input.validationError,
        originalJudgeInput: input.judgeRequestInput,
        repairRules: [
          "保留比赛裁判与商业裁判两层判断。",
          "如果原输出把计划或意图误写成已发生事实，请改成计划/意图/证据不足表述。",
          "可以引用 team_plan、agent_action 意图、区域、买型、roundWinType 和公开摘要。",
          "不要把未落库的清点、击杀链、秒级动作、封锁回防写成已发生事实。",
          "如果区域关系是证据，必须解释它如何接回计划执行、行动结果与胜负方式；不要写成自动胜负规则。"
        ],
        mapSemanticContext: readPhase18MapSemanticContext(this.context, input.mapGame.mapName),
        judgeRubricContext: readPhase18JudgeRubricContext(this.context, input.mapGame.mapName)
      },
      responseFormat: "json_object",
      seed: `judge_repair:${input.round.id}`,
      modelTier: "cheap",
      temperature: 0,
      maxOutputTokens: 1300,
      match: input.match,
      mapGame: input.mapGame,
      round: input.round,
      roundNumber: input.roundNumber,
      validateResponseData: input.validateResponseData
    });
  }

  private async runObservedStructuredCall<TData>(input: {
    callId: string;
    attemptNumber: number;
    task: "team_plan" | "agent_action" | "judge" | "judge_review" | "coach_timeout";
    schemaName: string;
    driverModelId: string;
    requestInput: unknown;
    responseFormat: "json_object";
    seed: string;
    modelTier: "cheap" | "standard" | "strong";
    temperature: number;
    maxOutputTokens?: number;
    match: Match;
    mapGame: MapGame;
    round: Round;
    roundNumber: number;
    agent?: Agent;
    validateResponseData?: (data: unknown) => TData;
  }) {
    const promptContractId = PHASE20_PRE_PROMPT_CONTRACT_ID;
    const promptHash = stableHex(buildPhase20PrePromptHashSource({
      task: input.task,
      schemaName: input.schemaName,
      requestInput: input.requestInput,
      promptContractId
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
        promptContractId,
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
        promptContractId,
        status: "started",
        startedAt
      },
      createdAt: startedAt
    });

    let latestResponse: LlmResponse<TData> | undefined;
    try {
      assertNoMojibakePayload(input.requestInput, `${input.task} request`);
      const messages = buildPhase18StructuredMessages({
        task: input.task,
        schemaName: input.schemaName,
        requestInput: input.requestInput
      });
      assertNoMojibakePayload(messages, `${input.task} prompt messages`);
      const response = await this.context.llmGateway.generateStructured<TData, unknown>({
        task: input.task,
        driverModelId: input.driverModelId,
        input: input.requestInput,
        schemaName: input.schemaName,
        messages,
        responseFormat: input.responseFormat,
        seed: input.seed,
        modelTier: input.modelTier,
        temperature: input.temperature,
        ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {})
      });
      latestResponse = response;
      assertNoMojibakePayload(response.rawText, `${input.task} raw response`);
      assertNoMojibakePayload(response.structuredRepair?.originalRawText, `${input.task} repair original response`);
      assertNoMojibakePayload(response.structuredRepair?.repairRawText, `${input.task} repair response`);
      assertNoMojibakePayload(response.data, `${input.task} structured response`);
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
          promptContractId,
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
        promptContractId,
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
          promptContractId,
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
      return {
        ...validatedResponse,
        requestArtifactId,
        responseArtifactId
      };
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
          promptContractId,
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
        promptContractId,
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
          promptContractId,
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
    mapGame?: MapGame;
    round?: Round;
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
        ...(input.mapGame ? { mapGameId: input.mapGame.id } : {}),
        ...(input.round ? { roundId: input.round.id } : {}),
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
  const marginLine =
    input.margin === "decisive"
      ? "判定为明显优势回合"
      : input.margin === "narrow"
        ? "判定为窄胜回合"
        : "判定为标准优势回合";
  return `${winnerName} 在 ${input.mapName} 第 ${input.roundNumber} 回合拿分，${input.mvpAgent.displayName} 是本回合 MVP 判定核心；比分 ${formatScore(input.scoreBeforeRound)} -> ${formatScore(scoreAfterRound)}；${pressureLine}；${marginLine}。`;
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
      impact: `${mvpAgent.displayName} 带队以 ${formatBuyType(winnerBuyType)} 对抗 ${formatBuyType(loserBuyType)}，回合后相对经济变化 ${formatSignedNumber(winnerEconomyDelta - loserEconomyDelta)}。`,
      sourceAgentOutputIds: sourceOutputIds(input.agentOutputs, mvpAgent.id)
    });
  }

  return events;
}

function buildRoundCombatResolution(input: {
  roundId: string;
  roundNumber: number;
  winnerTeamId: string;
  loserTeamId: string;
  activeA: Agent[];
  activeB: Agent[];
  agentOutputs: AgentOutput[];
  judgeResult: JudgeResult;
  economyDelta: RoundReport["economyDelta"];
  teamABuyType: BuyType;
  teamBBuyType: BuyType;
  keyEvents: RoundKeyEvent[];
  tacticalCollision: TacticalCollision | undefined;
}): RoundCombatResolution {
  const teamAId = input.activeA[0]?.teamId;
  const teamBId = input.activeB[0]?.teamId;
  if (!teamAId || !teamBId) {
    throw new Error("Cannot build combat resolution without both active teams.");
  }

  const roundWinType = input.judgeResult.roundWinType ?? "attack_elimination";
  const attackerTeamId = roundWinType.startsWith("attack_") ? input.winnerTeamId : input.loserTeamId;
  const defenderTeamId = attackerTeamId === teamAId ? teamBId : teamAId;
  const activeByTeam = new Map([
    [teamAId, sortAgentsForRound(input.activeA)],
    [teamBId, sortAgentsForRound(input.activeB)]
  ]);
  const attackerAgents = activeByTeam.get(attackerTeamId) ?? [];
  const defenderAgents = activeByTeam.get(defenderTeamId) ?? [];
  const killPlan = determineCombatKillPlan({
    roundId: input.roundId,
    roundWinType
  });
  const attackersToDie = selectDeathTargets(attackerAgents, killPlan.attackerDeaths, input.roundId, "attackers");
  const defendersToDie = selectDeathTargets(defenderAgents, killPlan.defenderDeaths, input.roundId, "defenders");
  const deathOrder = buildDeathOrder({
    roundWinType,
    attackerTeamId,
    defenderTeamId,
    attackersToDie,
    defendersToDie
  });
  const keyEvents = [...input.keyEvents];
  const entryZoneId = keyEvents[0]?.zoneId ?? "buyer_mid";
  const pressureZoneId = input.tacticalCollision?.primaryZoneId ?? keyEvents[1]?.zoneId ?? entryZoneId;
  const supportZoneId = keyEvents[1]?.zoneId ?? pressureZoneId;
  const zoneCycle = [entryZoneId, pressureZoneId, supportZoneId, pressureZoneId];
  const aliveByTeam = new Map<string, Agent[]>([
    [teamAId, [...(activeByTeam.get(teamAId) ?? [])]],
    [teamBId, [...(activeByTeam.get(teamBId) ?? [])]]
  ]);

  const killEvents = deathOrder.map((target, index) => {
    const actorTeamId = target.teamId === teamAId ? teamBId : teamAId;
    const actorPool = aliveByTeam.get(actorTeamId) ?? [];
    const targetPool = aliveByTeam.get(target.teamId) ?? [];
    const targetAgent = targetPool.find((agent) => agent.id === target.id);
    const actor = pickCombatActor({
      candidates: actorPool,
      mvpAgentId: input.judgeResult.mvpAgentId,
      index,
      roundId: input.roundId,
      preferredTeamWon: actorTeamId === input.winnerTeamId
    });
    if (!actor || !targetAgent) {
      throw new Error("Cannot build combat resolution without valid alive actor and target agents.");
    }

    aliveByTeam.set(target.teamId, targetPool.filter((agent) => agent.id !== targetAgent.id));
    const keyEvent = keyEvents[index] ?? keyEvents.at(-1);
    const keyEventId = index < keyEvents.length ? keyEvents[index]?.id : keyEvent?.id;
    const zoneId = zoneCycle[index % zoneCycle.length] ?? pressureZoneId;
    const tradeType = classifyCombatTradeType({
      index,
      actor,
      mvpAgentId: input.judgeResult.mvpAgentId,
      roundWinType,
      isFinalKill: index === deathOrder.length - 1,
      ...(index > 0 ? { previousActorTeamId: deathOrder[index - 1]?.teamId === teamAId ? teamBId : teamAId } : {}),
      actorTeamId
    });
    return {
      id: `kl_${input.roundId}_${index + 1}`,
      actorAgentId: actor.id,
      actorTeamId: actor.teamId,
      targetAgentId: targetAgent.id,
      targetTeamId: targetAgent.teamId,
      zoneId,
      atMs: 8000 + index * 3600 + stableNumber(`${input.roundId}:kill_${index + 1}:time`, 900),
      impact: buildKillLedgerImpact({
        actor,
        target: targetAgent,
        side: actorTeamId === input.winnerTeamId ? "winner" : "loser",
        roundNumber: input.roundNumber,
        tacticalCollisionResult: input.tacticalCollision?.result ?? null,
        keyEventType: keyEvent?.type ?? null,
        keyEventZoneId: keyEvent?.zoneId ?? null,
        tradeType
      }),
      ...(keyEventId ? { keyEventId } : {}),
      tradeType,
      sourceAgentOutputIds: sourceOutputIds(input.agentOutputs, actor.id)
    };
  });

  const siteZoneId = resolveBombSiteZoneId(input.judgeResult.diagnostic?.mainAttackZoneId ?? pressureZoneId);
  const planter = pickCombatActor({
    candidates: aliveByTeam.get(attackerTeamId) ?? attackerAgents,
    mvpAgentId: input.judgeResult.mvpAgentId,
    index: 0,
    roundId: `${input.roundId}:plant`,
    preferredTeamWon: attackerTeamId === input.winnerTeamId
  }) ?? attackerAgents[0];
  const defuser = pickCombatActor({
    candidates: aliveByTeam.get(defenderTeamId) ?? defenderAgents,
    mvpAgentId: input.judgeResult.mvpAgentId,
    index: 0,
    roundId: `${input.roundId}:defuse`,
    preferredTeamWon: defenderTeamId === input.winnerTeamId
  }) ?? defenderAgents[0];
  const plantEvent =
    roundWinType === "attack_bomb_explosion" || roundWinType === "defense_defuse"
      ? {
          type: "plant" as const,
          siteZoneId,
          ...(planter ? { actorAgentId: planter.id } : {}),
          actorTeamId: attackerTeamId,
          atMs: 42000,
          text: `${planter?.displayName ?? "进攻方"} 在 ${formatKillLedgerZoneLabel(siteZoneId)} 完成下包，这是裁判结算层推断出的爆弹节点。`
        }
      : undefined;
  const defuseEvent =
    roundWinType === "defense_defuse" && defuser
      ? {
          type: "defuse" as const,
          siteZoneId,
          actorAgentId: defuser.id,
          actorTeamId: defenderTeamId,
          atMs: 58500,
          text: `${defuser.displayName} 完成拆包，防守方通过回收点位拿下本局。`
        }
      : undefined;
  const explosionEvent =
    roundWinType === "attack_bomb_explosion"
      ? {
          type: "explosion" as const,
          siteZoneId,
          actorTeamId: attackerTeamId,
          atMs: 61000,
          text: `${formatKillLedgerZoneLabel(siteZoneId)} 被成功引爆，攻方通过爆弹结算拿下本局。`
        }
      : undefined;
  const openingDuel = killEvents[0]
    ? {
        killEventId: killEvents[0].id,
        actorAgentId: killEvents[0].actorAgentId,
        targetAgentId: killEvents[0].targetAgentId,
        zoneId: killEvents[0].zoneId
      }
    : undefined;
  const resolution: RoundCombatResolution = {
    source: input.judgeResult.judgeInference ? "judge_inference" : "deterministic_resolution",
    roundWinType,
    killEvents,
    ...(plantEvent ? { plantEvent } : {}),
    ...(defuseEvent ? { defuseEvent } : {}),
    ...(explosionEvent ? { explosionEvent } : {}),
    survivors: {
      teamAAgentIds: (aliveByTeam.get(teamAId) ?? []).map((agent) => agent.id),
      teamBAgentIds: (aliveByTeam.get(teamBId) ?? []).map((agent) => agent.id)
    },
    ...(openingDuel ? { openingDuel } : {}),
    tradeSequence: killEvents.map((kill, index) => ({
      killEventId: kill.id,
      tradeType: kill.tradeType ?? (index === 0 ? "opening" : "trade"),
      summary: `${formatKillLedgerZoneLabel(kill.zoneId)}：${kill.impact}`
    })),
    clutchTag: determineClutchTag(roundWinType, killEvents, input.judgeResult.mvpAgentId),
    mvpEvidence: buildCombatMvpEvidence(input.judgeResult, killEvents, plantEvent, defuseEvent, explosionEvent)
  };

  validateRoundCombatResolution({ resolution, activeA: input.activeA, activeB: input.activeB, attackerTeamId, defenderTeamId, teamAId, teamBId });
  return resolution;
}

function validateRoundKillLedger(input: {
  killLedger: RoundKillLedgerEntry[];
  activeA: Agent[];
  activeB: Agent[];
  winnerTeamId: string;
  loserTeamId: string;
}): RoundKillLedgerEntry[] {
  const activeById = new Map<string, Agent>([...input.activeA, ...input.activeB].map((agent) => [agent.id, agent] as const));
  const allowedTeamIds = new Set([input.winnerTeamId, input.loserTeamId]);

  return input.killLedger.map((entry, index) => {
    const actor = activeById.get(entry.actorAgentId);
    const target = activeById.get(entry.targetAgentId);
    if (!actor || !target) {
      throw new Error(`Invalid kill ledger entry ${index + 1}: unresolved actor or target agent.`);
    }
    if (!allowedTeamIds.has(entry.actorTeamId) || !allowedTeamIds.has(entry.targetTeamId)) {
      throw new Error(`Invalid kill ledger entry ${index + 1}: team ids do not match the round roster.`);
    }
    if (actor.teamId !== entry.actorTeamId || target.teamId !== entry.targetTeamId) {
      throw new Error(`Invalid kill ledger entry ${index + 1}: actor or target team mismatch.`);
    }
    if (actor.teamId === target.teamId) {
      throw new Error(`Invalid kill ledger entry ${index + 1}: actor and target must belong to opposite teams.`);
    }
    if (!entry.zoneId) {
      throw new Error(`Invalid kill ledger entry ${index + 1}: missing zone id.`);
    }
    if (!Number.isFinite(entry.atMs)) {
      throw new Error(`Invalid kill ledger entry ${index + 1}: missing event timestamp.`);
    }

    return {
      ...entry,
      sourceAgentOutputIds: entry.sourceAgentOutputIds ?? []
    };
  });
}

function determineCombatKillPlan(input: {
  roundId: string;
  roundWinType: JudgeRoundWinType;
}): { attackerDeaths: number; defenderDeaths: number } {
  const variance = stableNumber(`${input.roundId}:combat_density`, 3);
  switch (input.roundWinType) {
    case "attack_elimination":
      return { attackerDeaths: Math.min(4, 1 + variance), defenderDeaths: 5 };
    case "attack_bomb_explosion":
      return { attackerDeaths: Math.min(3, variance), defenderDeaths: Math.min(4, 2 + variance) };
    case "defense_elimination":
      return { attackerDeaths: 5, defenderDeaths: Math.min(4, variance) };
    case "defense_defuse":
      return { attackerDeaths: Math.min(5, 3 + variance), defenderDeaths: Math.min(4, 1 + variance) };
    case "defense_timeout_no_plant":
      return { attackerDeaths: Math.min(3, 1 + variance), defenderDeaths: Math.min(2, variance) };
  }
}

function selectDeathTargets(agents: Agent[], count: number, roundId: string, label: string): Agent[] {
  if (count <= 0 || agents.length === 0) {
    return [];
  }
  const ordered = sortAgentsForRound(agents);
  const offset = stableNumber(`${roundId}:${label}:offset`, ordered.length);
  return [...ordered.slice(offset), ...ordered.slice(0, offset)].slice(0, Math.min(count, ordered.length));
}

function buildDeathOrder(input: {
  roundWinType: JudgeRoundWinType;
  attackerTeamId: string;
  defenderTeamId: string;
  attackersToDie: Agent[];
  defendersToDie: Agent[];
}): Agent[] {
  const attackerQueue = [...input.attackersToDie];
  const defenderQueue = [...input.defendersToDie];
  const order: Agent[] = [];
  const finalTeamId =
    input.roundWinType === "attack_elimination"
      ? input.defenderTeamId
      : input.roundWinType === "defense_elimination"
        ? input.attackerTeamId
        : undefined;

  while (attackerQueue.length > 0 || defenderQueue.length > 0) {
    const preferDefenderDeath = input.roundWinType.startsWith("attack_") ? order.length % 3 !== 1 : order.length % 3 === 1;
    const next = preferDefenderDeath ? defenderQueue.shift() ?? attackerQueue.shift() : attackerQueue.shift() ?? defenderQueue.shift();
    if (next) {
      order.push(next);
    }
  }

  if (finalTeamId) {
    let finalIndex = -1;
    for (let index = order.length - 1; index >= 0; index -= 1) {
      if (order[index]?.teamId === finalTeamId) {
        finalIndex = index;
        break;
      }
    }
    if (finalIndex >= 0 && finalIndex !== order.length - 1) {
      const [finalAgent] = order.splice(finalIndex, 1);
      if (finalAgent) {
        order.push(finalAgent);
      }
    }
  }

  return order;
}

function pickCombatActor(input: {
  candidates: Agent[];
  mvpAgentId: string;
  index: number;
  roundId: string;
  preferredTeamWon: boolean;
}): Agent | undefined {
  if (input.candidates.length === 0) {
    return undefined;
  }
  const mvp = input.candidates.find((agent) => agent.id === input.mvpAgentId);
  if (mvp && (input.index === 0 || input.index >= 2 || input.preferredTeamWon)) {
    return mvp;
  }
  const rolePriority = ["entry", "star_rifler", "awper", "rifler", "lurker", "support", "igl"];
  const ordered = [...input.candidates].sort((left, right) => {
    const leftRole = rolePriority.indexOf(left.role);
    const rightRole = rolePriority.indexOf(right.role);
    return (leftRole === -1 ? 99 : leftRole) - (rightRole === -1 ? 99 : rightRole) || left.id.localeCompare(right.id);
  });
  return ordered[(input.index + stableNumber(`${input.roundId}:actor`, ordered.length)) % ordered.length];
}

function classifyCombatTradeType(input: {
  index: number;
  actor: Agent;
  mvpAgentId: string;
  roundWinType: JudgeRoundWinType;
  isFinalKill: boolean;
  previousActorTeamId?: string | undefined;
  actorTeamId: string;
}): NonNullable<RoundKillLedgerEntry["tradeType"]> {
  if (input.index === 0) {
    return "opening";
  }
  if (input.actor.id === input.mvpAgentId && input.isFinalKill) {
    return input.roundWinType === "defense_defuse" ? "clutch" : "multi_kill";
  }
  if (input.previousActorTeamId && input.previousActorTeamId !== input.actorTeamId) {
    return "trade";
  }
  if (input.isFinalKill) {
    return "clutch";
  }
  return "multi_kill";
}

function validateRoundCombatResolution(input: {
  resolution: RoundCombatResolution;
  activeA: Agent[];
  activeB: Agent[];
  attackerTeamId: string;
  defenderTeamId: string;
  teamAId: string;
  teamBId: string;
}): void {
  const activeIdsByTeam = new Map([
    [input.teamAId, new Set(input.activeA.map((agent) => agent.id))],
    [input.teamBId, new Set(input.activeB.map((agent) => agent.id))]
  ]);
  const deadIdsByTeam = new Map<string, Set<string>>([
    [input.teamAId, new Set<string>()],
    [input.teamBId, new Set<string>()]
  ]);
  for (const kill of input.resolution.killEvents) {
    if (deadIdsByTeam.get(kill.targetTeamId)?.has(kill.targetAgentId)) {
      throw new Error(`Invalid combat resolution: ${kill.targetAgentId} died more than once.`);
    }
    if (!activeIdsByTeam.get(kill.targetTeamId)?.has(kill.targetAgentId)) {
      throw new Error(`Invalid combat resolution: target ${kill.targetAgentId} is not active.`);
    }
    deadIdsByTeam.get(kill.targetTeamId)?.add(kill.targetAgentId);
  }
  const attackerDeaths = deadIdsByTeam.get(input.attackerTeamId)?.size ?? 0;
  const defenderDeaths = deadIdsByTeam.get(input.defenderTeamId)?.size ?? 0;
  const hasPlant = Boolean(input.resolution.plantEvent);
  const hasDefuse = Boolean(input.resolution.defuseEvent);
  const hasExplosion = Boolean(input.resolution.explosionEvent);

  if (input.resolution.roundWinType === "attack_elimination" && defenderDeaths !== 5) {
    throw new Error("Invalid combat resolution: attack_elimination requires all defenders dead.");
  }
  if (input.resolution.roundWinType === "defense_elimination" && attackerDeaths !== 5) {
    throw new Error("Invalid combat resolution: defense_elimination requires all attackers dead.");
  }
  if (input.resolution.roundWinType === "attack_bomb_explosion" && (!hasPlant || !hasExplosion || hasDefuse)) {
    throw new Error("Invalid combat resolution: attack_bomb_explosion requires plant and explosion without defuse.");
  }
  if (input.resolution.roundWinType === "defense_defuse" && (!hasPlant || !hasDefuse || hasExplosion)) {
    throw new Error("Invalid combat resolution: defense_defuse requires plant and defuse without explosion.");
  }
  if (input.resolution.roundWinType === "defense_timeout_no_plant" && (hasPlant || hasDefuse || hasExplosion)) {
    throw new Error("Invalid combat resolution: defense_timeout_no_plant cannot contain bomb events.");
  }
}

function resolveBombSiteZoneId(zoneId: string): string {
  if (zoneId === "conversion_site_b" || zoneId === "token_economy") {
    return "conversion_site_b";
  }
  return "conversion_site_a";
}

function determineClutchTag(
  roundWinType: JudgeRoundWinType,
  killEvents: RoundKillLedgerEntry[],
  mvpAgentId: string
): NonNullable<RoundCombatResolution["clutchTag"]> {
  const mvpKills = killEvents.filter((kill) => kill.actorAgentId === mvpAgentId).length;
  if (roundWinType === "defense_defuse") {
    return "retake";
  }
  if (roundWinType === "attack_bomb_explosion") {
    return "post_plant_hold";
  }
  if (mvpKills >= 3) {
    return "one_v_x";
  }
  return "none";
}

function buildCombatMvpEvidence(
  judgeResult: JudgeResult,
  killEvents: RoundKillLedgerEntry[],
  plantEvent: RoundCombatResolution["plantEvent"],
  defuseEvent: RoundCombatResolution["defuseEvent"],
  explosionEvent: RoundCombatResolution["explosionEvent"]
): string {
  const mvpKills = killEvents.filter((kill) => kill.actorAgentId === judgeResult.mvpAgentId).length;
  const bombLine = defuseEvent
    ? "并且防守方完成拆包"
    : explosionEvent
      ? "并且攻方守到炸弹爆炸"
      : plantEvent
        ? "并且本局存在下包节点"
        : "本局不依赖爆弹节点";
  return `MVP ${judgeResult.mvpAgentId} 在战斗映射中贡献 ${mvpKills} 次击杀，${bombLine}；该结论来自裁判结算层，不是 agent_action 原始事实。`;
}

function buildKillLedgerImpact(input: {
  actor: Agent;
  target: Agent;
  side: "winner" | "loser";
  roundNumber: number;
  tacticalCollisionResult: TacticalCollision["result"] | null;
  keyEventType: RoundKeyEvent["type"] | null;
  keyEventZoneId: string | null;
  tradeType?: NonNullable<RoundKillLedgerEntry["tradeType"]>;
}): string {
  const zoneLabel = formatKillLedgerZoneLabel(input.keyEventZoneId ?? "buyer_mid");
  const tradeLabel =
    input.tradeType === "opening"
      ? "首杀"
      : input.tradeType === "trade"
        ? "补枪"
        : input.tradeType === "multi_kill"
          ? "连续击杀"
          : input.tradeType === "clutch"
            ? "残局收束"
            : "退场击杀";
  const emphasis =
    input.side === "winner"
      ? input.keyEventType === "entry"
        ? "打开突破口"
        : input.keyEventType === "clutch"
          ? "完成收束"
          : "延续优势"
      : input.tacticalCollisionResult === "rotate_success"
        ? "拖住回防"
        : input.tacticalCollisionResult === "defense_hold"
          ? "守住点位"
          : "制造交换";
  return `${input.actor.displayName} 在 ${zoneLabel} ${emphasis}，对 ${input.target.displayName} 完成${tradeLabel}；这是裁判结算层映射出的战斗片段。`;
}

function formatKillLedgerZoneLabel(zoneId: string): string {
  const labels: Record<string, string> = {
    buyer_mid: "中路",
    conversion_site_a: "A 点",
    conversion_site_b: "B 点",
    retention_connector: "A 小",
    token_economy: "B 洞",
    pricing_ramp: "A 大",
    spawn_a: "进攻方出生点",
    spawn_b: "防守方出生点",
    utility_slope: "斜坡"
  };
  return labels[zoneId] ?? zoneId.replaceAll("_", " ");
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
        economySwing: input.roundReport.economyDelta.teamTotals.teamA - input.roundReport.economyDelta.teamTotals.teamB
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
  const teamABuy = input.round.teamABuyType ? formatBuyType(input.round.teamABuyType) : "未知买型";
  const teamBBuy = input.round.teamBBuyType ? formatBuyType(input.round.teamBBuyType) : "未知买型";
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
  const sideLine = input.sideContext.activeSide === "teamA" ? `${input.teamA.shortName} 主动进攻` : `${input.teamB.shortName} 主动进攻`;
  const highlightLine = summarizeHighlightTags(input.highlightTags);
  return `${winnerName} 在 ${input.mapName} 第 ${input.roundNumber} 回合完成收束，比分 ${formatScore(input.scoreBeforeRound)} -> ${formatScore(input.scoreAfterRound)}。${sideLine}，买型对位为 ${formatBuyType(winnerBuyType)} 对 ${formatBuyType(loserBuyType)}。关键事件：${keyLine}${highlightLine}`;
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

function validateCoachTimeoutCorrection(input: {
  correction: CoachTimeoutCorrection;
  teamId: string;
  triggerRoundNumber: number;
  expiresAfterRoundNumber: number;
  activeAgents: Agent[];
}): CoachTimeoutCorrection {
  const activeAgentIds = new Set(input.activeAgents.map((agent) => agent.id));
  const adjustmentIds = input.correction.playerAdjustments.map(
    (adjustment: CoachTimeoutCorrection["playerAdjustments"][number]) => adjustment.agentId
  );
  const adjustmentIdSet = new Set(adjustmentIds);
  if (adjustmentIdSet.size !== adjustmentIds.length) {
    throw new Error(`Coach timeout correction returned duplicate player adjustments for ${input.teamId}`);
  }
  for (const agentId of adjustmentIds) {
    if (!activeAgentIds.has(agentId)) {
      throw new Error(`Coach timeout correction returned adjustment for inactive agent: ${agentId}`);
    }
  }
  for (const agentId of activeAgentIds) {
    if (!adjustmentIdSet.has(agentId)) {
      throw new Error(`Coach timeout correction missed adjustment for active agent: ${agentId}`);
    }
  }

  const balancedCorrection = constrainCoachTimeoutCorrection(input.correction);
  return {
    ...balancedCorrection,
    teamId: input.teamId,
    triggerRoundNumber: input.triggerRoundNumber,
    expiresAfterRoundNumber: input.expiresAfterRoundNumber
  };
}

function validateCoachPostMatchReview(input: {
  review: CoachPostMatchReview;
  teamId: string;
  matchId: string;
}): CoachPostMatchReview {
  return {
    ...input.review,
    teamId: input.teamId,
    matchId: input.matchId
  };
}

const coachTimeoutMinRoundNumber = 5;
const coachTimeoutCooldownRounds = 3;
const coachTimeoutBalanceGuardrail = "平衡约束：主区优先，但至少保留一个次级区域的信息锚点或回防锚点，禁止五人全部压向同一单点。";

function constrainCoachTimeoutCorrection(correction: CoachTimeoutCorrection): CoachTimeoutCorrection {
  return {
    ...correction,
    nextRoundObjective: softenCoachOverfocusText(correction.nextRoundObjective),
    ownCoreToHold: softenCoachOverfocusText(correction.ownCoreToHold),
    opponentGapToHit: softenCoachOverfocusText(correction.opponentGapToHit),
    zonePriorityShift: withCoachBalanceGuardrail(softenCoachOverfocusText(correction.zonePriorityShift)),
    teamDirective: withCoachBalanceGuardrail(softenCoachOverfocusText(correction.teamDirective)),
    playerAdjustments: correction.playerAdjustments.map((adjustment) => ({
      ...adjustment,
      adjustment: softenCoachOverfocusText(adjustment.adjustment)
    }))
  };
}

function withCoachBalanceGuardrail(text: string): string {
  return text.includes("平衡约束") ? text : `${text} ${coachTimeoutBalanceGuardrail}`;
}

function softenCoachOverfocusText(text: string): string {
  return text
    .replace(/唯一主攻方向/g, "主要进攻方向")
    .replace(/唯一主证明通道/g, "主要证明通道")
    .replace(/唯一决定性证明通道/g, "主要决定性证明通道")
    .replace(/五名选手全部/g, "多数选手")
    .replace(/全员执行/g, "以三人核心执行")
    .replace(/全员默认/g, "主要资源默认")
    .replace(/全部回到/g, "回到")
    .replace(/不分散资源至/g, "避免过度分散资源，同时保留信息位观察")
    .replace(/不参与([^，。；;]+)任何行动/g, "不主动投入$1主战，但保留异常信息响应")
    .replace(/取消所有([^，。；;]+)call/g, "降低$1call 优先级，同时保留异常信息响应");
}

function detectCoachTimeoutTrigger(input: {
  losingTeam: Team;
  recentRoundReports: RoundReport[];
  scoreBeforeRound: ScorePair;
  teamAId: string;
  teamBId: string;
}): string | undefined {
  const recentReports = [...input.recentRoundReports];
  const lossReports = recentReports.filter((report) => report.winnerTeamId !== input.losingTeam.id);
  const trailingLossReports: RoundReport[] = [];
  for (let index = recentReports.length - 1; index >= 0; index -= 1) {
    const report = recentReports[index];
    if (!report || report.winnerTeamId === input.losingTeam.id) {
      break;
    }
    trailingLossReports.unshift(report);
  }
  if (trailingLossReports.length >= 3 || (trailingLossReports.length >= 2 && trailingLossReports.some((report) => report.judgeResult.margin === "decisive"))) {
    return `${input.losingTeam.displayName} 已连续两局失守，需要用战术暂停统一下一回合修正重点。`;
  }

  const recentThreeLossReports = lossReports.slice(-3);
  const repeatedDiagnostic = mostFrequentWithCount(
    recentThreeLossReports
      .map((report) => report.judgeDiagnostic?.attackedOpportunityGap ?? report.judgeResult.diagnostic?.attackedOpportunityGap)
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
  );
  if (recentThreeLossReports.length >= 3 && repeatedDiagnostic && repeatedDiagnostic.count >= 2) {
    return `${input.losingTeam.displayName} 在最近三局里反复暴露同类命题缺口：${repeatedDiagnostic.value}。`;
  }

  const teamScore = input.losingTeam.id === input.teamAId ? input.scoreBeforeRound.teamA : input.scoreBeforeRound.teamB;
  const opponentScore = input.losingTeam.id === input.teamAId ? input.scoreBeforeRound.teamB : input.scoreBeforeRound.teamA;
  const previousLoss = recentThreeLossReports.at(-1);
  if (opponentScore >= mr6MapRules.mapWinScore - 1 && previousLoss?.judgeResult.margin === "decisive") {
    return `${input.losingTeam.displayName} 正承受 map point 压力，且上一局为明显失守，需要暂停统一下一局的防守重点。`;
  }
  if (teamScore >= 5 && previousLoss?.judgeResult.margin === "decisive") {
    return `${input.losingTeam.displayName} 已进入关键分区间，上一局明显失守，需要暂停收束下一局执行。`;
  }

  return undefined;
}

function summarizeCoachTimeoutUsage(events: Event[], teamId: string): {
  totalUsed: number;
  rounds: Array<{ roundId?: string; triggerRoundNumber?: number }>;
} {
  const timeoutEvents = events
    .filter((event) => event.type === "timeout_used")
    .map((event) => ({
      roundId: event.roundId,
      payload: isRecord(event.payload) ? event.payload : null
    }))
    .filter((entry) => entry.payload?.teamId === teamId);
  return {
    totalUsed: timeoutEvents.length,
    rounds: timeoutEvents.map((entry) => ({
      ...(entry.roundId ? { roundId: entry.roundId } : {}),
      ...(typeof entry.payload?.triggerRoundNumber === "number" ? { triggerRoundNumber: entry.payload.triggerRoundNumber } : {})
    }))
  };
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
  sideAssignment: SideAssignment;
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
  validateJudgeWinSemantics(input.judgeResult, input.sideAssignment);
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

function ensureJudgeDiagnostic(input: {
  judgeResult: JudgeResult;
  roundNumber: number;
  sideAssignment: SideAssignment;
  teamA: Team;
  teamB: Team;
  teamPlans?: Record<string, TeamRoundPlanDecision>;
  agentOutputs?: AgentOutput[];
  mapSemanticContext?: Record<string, unknown> | undefined;
}): JudgeResult {
  const proposition = readUnknownRecord(input.mapSemanticContext?.proposition);
  const parsedDiagnostic = judgeDiagnosticSchema.safeParse(input.judgeResult.diagnostic);
  if (!parsedDiagnostic.success) {
    throw new Error("Judge diagnostic is required for Phase 2.0-pre real LLM rounds.");
  }

  const diagnostic = parsedDiagnostic.data;
  if (!input.judgeResult.judgeInference || input.judgeResult.judgeInference.source !== "judge_inference") {
    throw new Error("Judge judgeInference is required for Phase 2.0-pre combat/result narration.");
  }
  const expectedSubTheme = proposition ? resolvePhase18SubTheme(proposition, input.roundNumber) : undefined;
  if (expectedSubTheme && !sameSemanticLabel(diagnostic.currentSubTheme, expectedSubTheme)) {
    throw new Error(`Judge diagnostic currentSubTheme must match ${expectedSubTheme}.`);
  }

  const validZoneIds = collectPhase18MapZoneIds(input.mapSemanticContext);
  if (validZoneIds.size > 0) {
    if (!validZoneIds.has(diagnostic.mainAttackZoneId)) {
      throw new Error(`Judge diagnostic mainAttackZoneId is not a valid map zone: ${diagnostic.mainAttackZoneId}`);
    }
    if (!validZoneIds.has(diagnostic.mainDefenseZoneId)) {
      throw new Error(`Judge diagnostic mainDefenseZoneId is not a valid map zone: ${diagnostic.mainDefenseZoneId}`);
    }
  }

  validateJudgeReasonZoneConsistency({
    reason: input.judgeResult.reason,
    diagnostic,
    mapSemanticContext: input.mapSemanticContext
  });
  validateJudgeDiagnosticNarrativeQuality({
    diagnostic,
    reason: input.judgeResult.reason,
    judgeInference: input.judgeResult.judgeInference,
    teamA: input.teamA,
    teamB: input.teamB,
    mapSemanticContext: input.mapSemanticContext,
    agentOutputs: input.agentOutputs ?? []
  });
  validateJudgeConfidenceAndMargin({
    judgeResult: input.judgeResult
  });

  return {
    ...input.judgeResult,
    diagnostic
  };
}

function validateJudgeWinSemantics(judgeResult: JudgeResult, sideAssignment: SideAssignment): void {
  if (!judgeResult.roundWinType) {
    throw new Error("Judge roundWinType is required for Phase 2.0-pre real LLM rounds.");
  }
  if (typeof judgeResult.attackWinConditionMet !== "boolean" || typeof judgeResult.defenseWinConditionMet !== "boolean") {
    throw new Error("Judge attackWinConditionMet and defenseWinConditionMet are required for Phase 2.0-pre real LLM rounds.");
  }
  const attackWin = judgeResult.roundWinType.startsWith("attack_");
  const defenseWin = judgeResult.roundWinType.startsWith("defense_");
  if (attackWin === defenseWin) {
    throw new Error(`Judge returned an invalid roundWinType: ${judgeResult.roundWinType}`);
  }

  const expectedWinnerTeamId = attackWin ? sideAssignment.attackingTeamId : sideAssignment.defendingTeamId;
  if (judgeResult.winnerTeamId !== expectedWinnerTeamId) {
    throw new Error(
      `Judge roundWinType ${judgeResult.roundWinType} conflicts with winnerTeamId ${judgeResult.winnerTeamId}.`
    );
  }

  if (judgeResult.attackWinConditionMet !== attackWin) {
    throw new Error(`Judge attackWinConditionMet conflicts with roundWinType ${judgeResult.roundWinType}.`);
  }
  if (judgeResult.defenseWinConditionMet !== defenseWin) {
    throw new Error(`Judge defenseWinConditionMet conflicts with roundWinType ${judgeResult.roundWinType}.`);
  }
}

function buildFallbackJudgeRoundWinType(winnerTeamId: string, sideAssignment: SideAssignment): JudgeRoundWinType {
  return winnerTeamId === sideAssignment.attackingTeamId ? "attack_elimination" : "defense_elimination";
}

function shouldAttemptJudgeRepair(errorMessage: string): boolean {
  return /does not parse as JSON|invalid_enum_value|Expected array, received object|Expected string, received object/i.test(errorMessage);
}

function sameSemanticLabel(left: string, right: string): boolean {
  const normalizedLeft = normalizeForJudgeReason(left);
  const normalizedRight = normalizeForJudgeReason(right);
  return normalizedLeft === normalizedRight || normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function collectPhase18MapZoneIds(mapSemanticContext: Record<string, unknown> | undefined): Set<string> {
  const proposition = readUnknownRecord(mapSemanticContext?.proposition);
  const displayZoneNames = readUnknownRecord(proposition?.displayZoneNames) ?? readUnknownRecord(proposition?.display_zone_names);
  const zoneSemantics = readUnknownRecord(proposition?.zoneSemantics) ?? readUnknownRecord(proposition?.zone_semantics);
  return new Set([
    ...Object.keys(displayZoneNames ?? {}),
    ...Object.keys(zoneSemantics ?? {})
  ]);
}

function validateJudgeReasonZoneConsistency(input: {
  reason: string;
  diagnostic: JudgeDiagnostic;
  mapSemanticContext: Record<string, unknown> | undefined;
}): void {
  const mentionedZoneIds = collectMentionedPhase18Zones(input.reason, input.mapSemanticContext);
  if (mentionedZoneIds.size === 0) {
    return;
  }

  const diagnosticZoneIds = new Set([input.diagnostic.mainAttackZoneId, input.diagnostic.mainDefenseZoneId]);
  const unmatchedZoneIds = [...mentionedZoneIds].filter((zoneId) => !diagnosticZoneIds.has(zoneId));
  const matchedDiagnosticZoneIds = [...diagnosticZoneIds].filter((zoneId) => mentionedZoneIds.has(zoneId));
  if (unmatchedZoneIds.length > 0 && matchedDiagnosticZoneIds.length === 0) {
    throw new Error(`Judge reason and diagnostic zone focus conflict: ${unmatchedZoneIds.join(", ")}`);
  }
}

function validateJudgeDiagnosticNarrativeQuality(input: {
  diagnostic: JudgeDiagnostic;
  reason: string;
  judgeInference: NonNullable<JudgeResult["judgeInference"]>;
  teamA: Team;
  teamB: Team;
  mapSemanticContext: Record<string, unknown> | undefined;
  agentOutputs: AgentOutput[];
}): void {
  validateJudgeNarrativeField({
    label: "Judge diagnostic attackedOpportunityGap",
    value: input.diagnostic.attackedOpportunityGap,
    teamA: input.teamA,
    teamB: input.teamB
  });
  validateJudgeNarrativeField({
    label: "Judge diagnostic defendedCoreProposition",
    value: input.diagnostic.defendedCoreProposition,
    teamA: input.teamA,
    teamB: input.teamB
  });
  validateJudgeDecisiveEvidence({
    value: input.diagnostic.decisiveEvidence,
    teamA: input.teamA,
    teamB: input.teamB,
    mapSemanticContext: input.mapSemanticContext
  });
  validateJudgeUnsupportedMicroCombatDetails({
    reason: input.reason,
    decisiveEvidence: input.diagnostic.decisiveEvidence,
    judgeInference: input.judgeInference
  });

  validateJudgeZoneRelation(input);
}

function validateJudgeZoneRelation(input: {
  diagnostic: JudgeDiagnostic;
  reason: string;
  teamA: Team;
  teamB: Team;
  mapSemanticContext: Record<string, unknown> | undefined;
}): void {
  const relation = input.diagnostic.zoneRelation;
  if (!relation) {
    throw new Error("Judge diagnostic zoneRelation is required for Phase 2.0-pre real LLM rounds.");
  }
  if (relation.attackZoneId !== input.diagnostic.mainAttackZoneId) {
    throw new Error("Judge diagnostic zoneRelation.attackZoneId must match mainAttackZoneId.");
  }
  if (relation.defenseZoneId !== input.diagnostic.mainDefenseZoneId) {
    throw new Error("Judge diagnostic zoneRelation.defenseZoneId must match mainDefenseZoneId.");
  }
  if (relation.relationSummary.trim().length < 12 || relation.outcomeImpact.trim().length < 12) {
    throw new Error("Judge diagnostic zoneRelation must explain the attack/defense relationship and outcome impact.");
  }

  if (containsZoneDeterminismShortcut(`${relation.relationSummary}\n${relation.outcomeImpact}\n${input.reason}\n${input.diagnostic.decisiveEvidence}`)) {
    throw new Error("Judge must not treat matching or different zones as an automatic win/loss rule.");
  }
}

function containsZoneDeterminismShortcut(value: string): boolean {
  const normalized = normalizeForJudgeReason(value);
  const negatedShortcutPattern = /(不是|并非|并不是|并不|不由|不能|不可|不得|禁止).{0,16}(必然|一定|天然|自动|肯定|必定|必胜|必败|只要.*就|所以|因此|从而|直接证明)/;
  const crossClauseShortcutPattern =
    /(主攻区|主守区|防守区|进攻区|区域|覆盖|布防|部署).{0,80}(同区|相同|一致|不同|不一致|错开|避开|绕开|覆盖|没有覆盖|未覆盖|无覆盖|无有效布防|未布防|未部署).{0,80}(所以|因此|从而|直接证明).{0,40}(必然|一定|天然|自动|肯定|必定|必胜|必败)?.{0,40}(赢|输|获胜|失败|成功|失守|守住|证伪)/;
  const crossClauseMatch = normalized.match(crossClauseShortcutPattern)?.[0] ?? "";
  if (crossClauseMatch && !negatedShortcutPattern.test(crossClauseMatch)) {
    return true;
  }
  const clauses = normalized.split(/\s*(?:[。；;，,]|但是|但|而|同时|并且)\s*/u).filter((clause) => clause.length > 0);
  return clauses.some((clause) => {
    const hasZoneRelation = /(同区|相同|一致|不同|不一致|错开|避开|绕开|覆盖|布防|部署|守a|打a|守b|打b|主攻区|主守区|主攻|主守|防守区|进攻区)/.test(clause);
    const hasOutcomeCue = /(赢|输|获胜|失败|成功|失守|守住)/.test(clause);
    const hasNegatedShortcutCue = /(不是|并非|并不是|并不|不由|不能|不可|不得|禁止).*(必然|一定|天然|自动|肯定|必定|必胜|必败|只要.*就|所以|因此|从而|直接证明)/.test(clause);
    const hasHardDeterministicCue =
      /(必然|一定|天然|自动|肯定|必定|必胜|必败)/.test(clause) ||
      /(?:没有覆盖|未覆盖|无覆盖|无有效布防|未布防|未部署).*(?:直接证明|直接说明).*(?:赢|输|获胜|失败|成功|失守|守住|证伪)/.test(clause) ||
      /只要.*就.*(?:赢|输|获胜|失败|成功|失守|守住)/.test(clause);
    return hasZoneRelation && hasOutcomeCue && hasHardDeterministicCue && !hasNegatedShortcutCue;
  });
}

function validateJudgeNarrativeField(input: {
  label: string;
  value: string;
  teamA: Team;
  teamB: Team;
}): void {
  const normalized = input.value.trim();
  if (normalized.length < 10) {
    throw new Error(`${input.label} is too abstract.`);
  }

  const hasActorCue = hasJudgeSideCue(normalized, input.teamA, input.teamB);
  const hasReasonCue = /(因为|导致|暴露|说明|证明|未能|使得|通过|从而|意味着|形成|守住|失守|验证)/.test(normalized);
  if (!hasActorCue || !hasReasonCue) {
    throw new Error(`${input.label} must name the side and explain why the gap or proposition matters.`);
  }
}

function hasJudgeSideCue(value: string, teamA: Team, teamB: Team): boolean {
  return (
    [teamA.displayName, teamB.displayName, teamA.id, teamB.id].some((name) => value.includes(name)) ||
    /\bteam\s*(?:alpha|bravo)\b/i.test(value) ||
    /\b(?:alpha|bravo)\b/i.test(value) ||
    /(攻方|守方|进攻方|防守方|对手|本队|己方|敌方)/.test(value)
  );
}

function validateJudgeDecisiveEvidence(input: {
  value: string;
  teamA: Team;
  teamB: Team;
  mapSemanticContext: Record<string, unknown> | undefined;
}): void {
  const normalized = input.value.trim();
  if (normalized.length < 18) {
    throw new Error("Judge diagnostic decisiveEvidence is too thin.");
  }

  const hasActorCue =
    hasJudgeSideCue(normalized, input.teamA, input.teamB) ||
    /(选手|队伍计划|行动|执行|下包|引爆|拆包|时间耗尽|清场|回防|补枪|推进|防守|进攻|协同|轮转|信息|布局|买型|经济)/.test(
      normalized
    );
  const mentionedZones = collectMentionedPhase18Zones(normalized, input.mapSemanticContext);
  if (!hasActorCue || mentionedZones.size === 0) {
    throw new Error("Judge diagnostic decisiveEvidence must stay anchored to actual plans, actions, and map zones.");
  }
}

function validateJudgeUnsupportedMicroCombatDetails(input: {
  reason: string;
  decisiveEvidence: string;
  judgeInference: NonNullable<JudgeResult["judgeInference"]>;
}): void {
  const inferenceText = [
    input.judgeInference.boundary,
    input.judgeInference.csResolution,
    input.judgeInference.combatNarrative,
    ...input.judgeInference.evidenceBasis
  ].join("\n");
  const hasInferenceBoundary = /(裁判推断|judge inference|结算层|不是 agent_action|不是原始事实|非原始事实)/i.test(inferenceText);
  for (const [label, text] of [
    ["reason", input.reason],
    ["diagnostic.decisiveEvidence", input.decisiveEvidence]
  ] as const) {
    const unsupportedAssertions = collectUnsupportedMicroCombatAssertions(text);
    if (unsupportedAssertions.length > 0 && !hasInferenceBoundary) {
      throw new Error(`Judge ${label} contains unsupported micro-combat detail without judgeInference boundary: ${unsupportedAssertions.join(", ")}`);
    }
  }
}

function collectUnsupportedMicroCombatAssertions(text: string): string[] {
  const unsupported: string[] = [];
  const clauses = splitJudgeEvidenceClauses(text);
  for (const clause of clauses) {
    const normalizedClause = normalizeForJudgeReason(clause);
    if (isGuardedCombatReference(normalizedClause)) {
      continue;
    }

    const isFactualCombatClaim = hasUnsupportedCombatFactCue(normalizedClause);
    if (!isFactualCombatClaim) {
      continue;
    }

    for (const rule of unsupportedMicroCombatDetailRules) {
      if (rule.pattern.test(normalizedClause)) {
        unsupported.push(rule.label);
      }
    }
  }

  return [...new Set(unsupported)];
}

function splitJudgeEvidenceClauses(text: string): string[] {
  return text
    .split(/\s*(?:[。；;，,]|但是|但|同时|并且|且|；|\n)\s*/u)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

function isGuardedCombatReference(normalizedClause: string): boolean {
  if (
    /(未|没有|无|无法|不能|不支持|不应|不可|不得|缺乏|仅|只是|并非|不是|未能|尚未).*(combat ledger|落库|支持|证明|显示|完成|发生|呈现|提供|支撑|事实)/.test(
      normalizedClause
    )
  ) {
    return true;
  }
  if (/(combat ledger|未落库|已落库|事实层|证据层).*(未|没有|无|无法|不能|不支持|缺乏|仅|只是|并非|不是|未能|尚未|支持|证明)/.test(normalizedClause)) {
    return true;
  }
  if (/(teamplan|team plan|队伍计划|计划|要求|指令|目标|意图|试图|尝试|准备|期望|任务|写明|声明).*(秒|清点|清包点|击杀|首杀|多杀|封锁回防|锁死回防|架死|投掷物落点)/.test(normalizedClause)) {
    return true;
  }
  if (/(秒|清点|清包点|击杀|首杀|多杀|封锁回防|锁死回防|架死|投掷物落点).*(计划|要求|指令|目标|意图|试图|尝试|准备|期望|任务|写明|声明)/.test(normalizedClause)) {
    return true;
  }
  return false;
}

function hasUnsupportedCombatFactCue(normalizedClause: string): boolean {
  if (/(成功|完成|最终|已经|已|直接|精准|精确|锁死|封锁|清空|清除|架死|首杀|多杀|双杀|三杀|团灭链|击杀链|补枪链)/.test(normalizedClause)) {
    return true;
  }
  for (const rule of unsupportedMicroCombatDetailRules) {
    if (rule.pattern.test(normalizedClause)) {
      return true;
    }
  }
  return false;
}

const unsupportedMicroCombatDetailRules = [
  { label: "秒级动作", pattern: /(?:(?:\d+\s*秒|秒内|秒级).*(?:清点|清包点|击杀|首杀|多杀|安包|下包|爆破|封锁|架死|交火)|(?:瞬间|立刻清|立即清|快速清点))/ },
  { label: "清点过程", pattern: /(?:清点|清包点|清空包点|清完|清除进攻者|清除防守者)/ },
  { label: "封锁回防路径", pattern: /(?:封锁回防|锁死回防|阻断回防|回防路径|回防通道)/ },
  { label: "精确枪线", pattern: /(?:精确枪线|精准枪线|架死|锁死.*(?:枪线|通道|入口)|长枪线)/ },
  { label: "击杀链", pattern: /(?:击杀链|完成首杀|关键首杀|首杀|多杀|双杀|三杀|团灭链|补枪链)/ },
  { label: "投掷物落点", pattern: /(?:投掷物落点|烟雾落点|闪光落点|火落点|雷点)/ }
] as const;

function validateJudgeConfidenceAndMargin(input: { judgeResult: JudgeResult }): void {
  const normalizedReason = normalizeForJudgeReason(input.judgeResult.reason);
  if (
    input.judgeResult.confidence >= 0.9 &&
    !/(成功|失败|守住|失守|赢|输|证明|未能|击穿|拖时|拆包|引爆|清场)/.test(normalizedReason)
  ) {
    throw new Error("Judge confidence is too high for a reason that does not explain the ruling.");
  }

  if (
    input.judgeResult.margin === "decisive" &&
    !/(彻底|完全|明确|显著|决定性| decisively | decisive | full wipe | 团灭 | 清场 | 引爆 | 拆包)/i.test(
      input.judgeResult.reason
    )
  ) {
    throw new Error("Judge margin decisive must be supported by a clearly decisive reason.");
  }
}

function collectMentionedPhase18Zones(reason: string, mapSemanticContext: Record<string, unknown> | undefined): Set<string> {
  const proposition = readUnknownRecord(mapSemanticContext?.proposition);
  const displayZoneNames = readUnknownRecord(proposition?.displayZoneNames) ?? readUnknownRecord(proposition?.display_zone_names);
  const zoneSemantics = readUnknownRecord(proposition?.zoneSemantics) ?? readUnknownRecord(proposition?.zone_semantics);
  const normalizedReason = normalizeForJudgeReason(reason);
  const mentioned = new Set<string>();

  for (const [zoneId, displayName] of Object.entries(displayZoneNames ?? {})) {
    if (mentionsZone(normalizedReason, zoneId, displayName)) {
      mentioned.add(zoneId);
    }
  }
  for (const [zoneId, semantics] of Object.entries(zoneSemantics ?? {})) {
    const displayName = pickString(readUnknownRecord(semantics), "displayName");
    if (mentionsZone(normalizedReason, zoneId, displayName)) {
      mentioned.add(zoneId);
    }
  }

  return mentioned;
}

function mentionsZone(normalizedReason: string, zoneId: string, displayName: unknown): boolean {
  if (mentionsNormalizedZoneAlias(normalizedReason, normalizeForJudgeReason(zoneId))) {
    return true;
  }
  return typeof displayName === "string" && mentionsNormalizedZoneAlias(normalizedReason, normalizeForJudgeReason(displayName));
}

function mentionsNormalizedZoneAlias(normalizedText: string, normalizedAlias: string): boolean {
  if (!normalizedAlias) {
    return false;
  }
  if (normalizedText.includes(normalizedAlias)) {
    return true;
  }

  const compactText = normalizedText.replace(/\s+/g, "");
  const compactAlias = normalizedAlias.replace(/\s+/g, "");
  return compactAlias.length > 0 && compactText.includes(compactAlias);
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
      initialProposalSummary: sanitizeJudgeRecord(readTeamInitialProposalSummary(input.teamA), sanitizeReplacements),
      coachContext: sanitizeJudgeRecord(readTeamHeadCoachProfile(input.teamA), sanitizeReplacements),
      teamPlan: promptTeamPlans?.[promptTeamA.id]
    }),
    buildJudgeEvaluationEntry({
      teamId: promptTeamB.id,
      teamName: promptTeamB.displayName,
      activeAgents: promptActiveB,
      initialProposalSummary: sanitizeJudgeRecord(readTeamInitialProposalSummary(input.teamB), sanitizeReplacements),
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
    actualAgentOutputs: input.agentOutputs,
    validateAndTranslate: (judgeResult: JudgeResult) => {
      const promptValidated = validateJudgeResult({
        judgeResult,
        teamA: promptTeamA,
        teamB: promptTeamB,
        activeA: promptActiveA,
        activeB: promptActiveB,
        sideAssignment: promptSideAssignment,
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
        reason: normalizeChineseFirstJudgeText(desanitizeJudgeText(promptValidated.reason, desanitizeReplacements)),
        ...(promptValidated.judgeInference
          ? { judgeInference: desanitizeJudgeInference(promptValidated.judgeInference, desanitizeReplacements) }
          : {}),
        ...(promptValidated.diagnostic
          ? { diagnostic: desanitizeJudgeDiagnostic(promptValidated.diagnostic, desanitizeReplacements) }
          : {})
      };
    },
    translatePromptText: (value: string) => desanitizeJudgeText(value, desanitizeReplacements)
  };
}

function desanitizeJudgeDiagnostic(
  diagnostic: JudgeDiagnostic,
  replacements: Array<{ source: string; target: string }>
): JudgeDiagnostic {
  return {
    currentSubTheme: normalizeChineseFirstJudgeText(desanitizeJudgeText(diagnostic.currentSubTheme, replacements)),
    attackedOpportunityGap: normalizeChineseFirstJudgeText(desanitizeJudgeText(diagnostic.attackedOpportunityGap, replacements)),
    defendedCoreProposition: normalizeChineseFirstJudgeText(desanitizeJudgeText(diagnostic.defendedCoreProposition, replacements)),
    mainAttackZoneId: diagnostic.mainAttackZoneId,
    mainDefenseZoneId: diagnostic.mainDefenseZoneId,
    ...(diagnostic.zoneRelation
      ? {
          zoneRelation: {
            attackZoneId: diagnostic.zoneRelation.attackZoneId,
            defenseZoneId: diagnostic.zoneRelation.defenseZoneId,
            relationType: diagnostic.zoneRelation.relationType,
            relationSummary: normalizeChineseFirstJudgeText(desanitizeJudgeText(diagnostic.zoneRelation.relationSummary, replacements)),
            outcomeImpact: normalizeChineseFirstJudgeText(desanitizeJudgeText(diagnostic.zoneRelation.outcomeImpact, replacements))
          }
        }
      : {}),
    decisiveEvidence: normalizeChineseFirstJudgeText(desanitizeJudgeText(diagnostic.decisiveEvidence, replacements))
  };
}

function desanitizeJudgeInference(
  inference: NonNullable<JudgeResult["judgeInference"]>,
  replacements: Array<{ source: string; target: string }>
): NonNullable<JudgeResult["judgeInference"]> {
  return {
    source: "judge_inference",
    boundary: normalizeChineseFirstJudgeText(desanitizeJudgeText(inference.boundary, replacements)),
    csResolution: normalizeChineseFirstJudgeText(desanitizeJudgeText(inference.csResolution, replacements)),
    combatNarrative: normalizeChineseFirstJudgeText(desanitizeJudgeText(inference.combatNarrative, replacements)),
    evidenceBasis: inference.evidenceBasis.map((item) => normalizeChineseFirstJudgeText(desanitizeJudgeText(item, replacements)))
  };
}

function readPhase18MapSemanticContext(context: Pick<EngineContext, "phase18MapSemanticsByMapName">, mapName: string): Record<string, unknown> | undefined {
  return readUnknownRecord(context.phase18MapSemanticsByMapName?.[mapName.toUpperCase()]);
}

function readPhase18JudgeRubricContext(context: Pick<EngineContext, "phase18MapSemanticsByMapName">, mapName: string): Record<string, unknown> | undefined {
  const mapSemantic = readPhase18MapSemanticContext(context, mapName);
  return readUnknownRecord(mapSemantic?.judgeRubric);
}

function readTeamMaterialInitialProposal(team: Team): TeamInitialProposal | undefined {
  const source = readUnknownRecord(team.source);
  const parsed = teamInitialProposalSchema.safeParse(source?.materialInitialProposal);
  return parsed.success ? parsed.data : undefined;
}

function readTeamHeadCoachProfile(team: Team): Record<string, unknown> | undefined {
  const source = readUnknownRecord(team.source);
  return readUnknownRecord(source?.headCoachProfile);
}

function readTeamInitialProposalSummary(team: Team): TeamInitialProposalSummary | undefined {
  const initialProposal = readTeamMaterialInitialProposal(team);
  if (!initialProposal) {
    return undefined;
  }

  return teamInitialProposalSummarySchema.parse({
    proposalId: initialProposal.proposalId,
    version: initialProposal.version,
    teamThesis: initialProposal.teamThesis,
    opportunity: initialProposal.opportunity,
    product: initialProposal.product,
    engineering: initialProposal.engineering,
    business: initialProposal.business,
    operations: initialProposal.operations,
    scaling: initialProposal.scaling,
    moat: initialProposal.moat,
    mustHoldClaims: initialProposal.mustHoldClaims,
    failureModes: initialProposal.failureModes,
    frontendSummary: initialProposal.frontendSummary
  });
}

function readTeamProposalAnchor(team: Team, agent: Agent): TeamProposalAnchor | undefined {
  const initialProposal = readTeamMaterialInitialProposal(team);
  if (!initialProposal) {
    return undefined;
  }

  const playerOperatingPrinciples = pickProposalOperatingPrinciples(initialProposal, agent.role);
  return teamProposalAnchorSchema.parse({
    teamThesis: initialProposal.teamThesis,
    mustHoldClaims: initialProposal.mustHoldClaims,
    playerOperatingPrinciples
  });
}

function pickProposalOperatingPrinciples(initialProposal: TeamInitialProposal, role: Agent["role"]): string[] {
  const roleKeywords = proposalRoleKeywords(role);
  const matched = initialProposal.playerOperatingPrinciples.filter((principle) => {
    const normalized = principle.toLowerCase();
    return roleKeywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
  });
  return matched.length > 0 ? matched : initialProposal.playerOperatingPrinciples.slice(0, 1);
}

function proposalRoleKeywords(role: Agent["role"]): string[] {
  switch (role) {
    case "igl":
      return ["igl", "指挥"];
    case "entry":
      return ["entry", "先手", "打开空间"];
    case "awper":
      return ["awper", "狙击", "scope"];
    case "star_rifler":
      return ["star rifler", "star", "核心输出", "rifler"];
    case "lurker":
      return ["lurker", "侧翼", "隐藏"];
    case "support":
      return ["support", "辅助", "补位"];
    case "rifler":
      return ["rifler", "枪手", "收束", "closeout"];
    case "coach":
      return ["coach", "教练", "暂停", "半场", "复盘"];
    case "stand_in":
      return ["stand-in", "替补", "兜底"];
    default:
      return [role];
  }
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
  const roundWinType = normalizeJudgeRoundWinType(record.roundWinType);
  return {
    ...record,
    ...(margin ? { margin } : {}),
    ...(roundWinType ? { roundWinType } : {}),
    ...(record.attackWinConditionMet !== undefined
      ? { attackWinConditionMet: normalizeJudgeBoolean(record.attackWinConditionMet) }
      : {}),
    ...(record.defenseWinConditionMet !== undefined
      ? { defenseWinConditionMet: normalizeJudgeBoolean(record.defenseWinConditionMet) }
      : {}),
    ...(readUnknownRecord(record.judgeInference)
      ? { judgeInference: normalizeJudgeInferencePayload(record.judgeInference) }
      : {}),
    ...(readUnknownRecord(record.diagnostic)
      ? { diagnostic: normalizeJudgeDiagnosticPayload(record.diagnostic, record.reason) }
      : {})
  };
}

function normalizeJudgeInferencePayload(inference: unknown): unknown {
  const record = readUnknownRecord(inference);
  if (!record) {
    return inference;
  }

  return {
    source: "judge_inference",
    boundary: normalizeCoachTimeoutText(record.boundary),
    csResolution: normalizeCoachTimeoutText(record.csResolution),
    combatNarrative: normalizeCoachTimeoutText(record.combatNarrative),
    evidenceBasis: Array.isArray(record.evidenceBasis)
      ? record.evidenceBasis.map((item) => normalizeCoachTimeoutText(item))
      : []
  };
}

function normalizeJudgeDiagnosticPayload(diagnostic: unknown, _reason: unknown): unknown {
  const record = readUnknownRecord(diagnostic);
  if (!record) {
    return diagnostic;
  }

  return {
    currentSubTheme: normalizeCoachTimeoutText(record.currentSubTheme),
    attackedOpportunityGap: normalizeCoachTimeoutText(record.attackedOpportunityGap),
    defendedCoreProposition: normalizeCoachTimeoutText(record.defendedCoreProposition),
    mainAttackZoneId: normalizeCoachTimeoutText(record.mainAttackZoneId),
    mainDefenseZoneId: normalizeCoachTimeoutText(record.mainDefenseZoneId),
    ...(readUnknownRecord(record.zoneRelation)
      ? { zoneRelation: normalizeJudgeZoneRelationPayload(record.zoneRelation) }
      : {}),
    decisiveEvidence: normalizeCoachTimeoutText(record.decisiveEvidence)
  };
}

function normalizeJudgeZoneRelationPayload(zoneRelation: unknown): unknown {
  const record = readUnknownRecord(zoneRelation);
  if (!record) {
    return zoneRelation;
  }

  return {
    attackZoneId: normalizeCoachTimeoutText(record.attackZoneId),
    defenseZoneId: normalizeCoachTimeoutText(record.defenseZoneId),
    relationType: normalizeCoachTimeoutText(record.relationType),
    relationSummary: normalizeCoachTimeoutText(record.relationSummary),
    outcomeImpact: normalizeCoachTimeoutText(record.outcomeImpact)
  };
}

function normalizeTeamRoundPlanPayload(data: unknown): unknown {
  const record = readUnknownRecord(data);
  if (!record || Array.isArray(record.playerDirectives)) {
    return data;
  }

  const directivesRecord = readUnknownRecord(record.playerDirectives);
  if (!directivesRecord) {
    return data;
  }

  const playerDirectives = Object.entries(directivesRecord).map(([agentId, directiveValue]) => {
    if (typeof directiveValue === "string") {
      return {
        agentId,
        directive: directiveValue
      };
    }

    const directiveRecord = readUnknownRecord(directiveValue);
    if (directiveRecord && typeof directiveRecord.directive === "string") {
      return {
        agentId,
        directive: directiveRecord.directive
      };
    }

    return {
      agentId,
      directive: directiveValue
    };
  });

  return {
    ...record,
    playerDirectives
  };
}

function normalizeCoachTimeoutCorrectionPayload(data: unknown): unknown {
  const record = readUnknownRecord(data);
  if (!record) {
    return data;
  }

  const normalizedRecord: Record<string, unknown> = { ...record };
  for (const field of [
    "triggerReason",
    "diagnosedFailure",
    "nextRoundObjective",
    "ownCoreToHold",
    "opponentGapToHit",
    "zonePriorityShift",
    "teamDirective"
  ] satisfies Array<keyof CoachTimeoutCorrection>) {
    const normalizedText = normalizeCoachTimeoutText(record[field]);
    if (normalizedText) {
      normalizedRecord[field] = normalizedText;
    }
  }

  const normalizedAdjustments = normalizeCoachTimeoutPlayerAdjustments(record.playerAdjustments ?? record.playerDirectives);
  if (normalizedAdjustments) {
    normalizedRecord.playerAdjustments = normalizedAdjustments;
  }

  return normalizedRecord;
}

function normalizeCoachTimeoutPlayerAdjustments(
  value: unknown
): CoachTimeoutCorrection["playerAdjustments"] | undefined {
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (typeof entry === "string") {
        return {
          agentId: `unknown_agent_${index + 1}`,
          adjustment: entry
        };
      }

      const record = readUnknownRecord(entry);
      if (!record) {
        return {
          agentId: `unknown_agent_${index + 1}`,
          adjustment: normalizeCoachTimeoutText(entry) ?? String(entry)
        };
      }

      return {
        agentId:
          readStringField(record, ["agentId", "playerId", "id", "agent"]) ?? `unknown_agent_${index + 1}`,
        adjustment:
          normalizeCoachTimeoutText(
            record.adjustment ?? record.directive ?? record.text ?? record.summary ?? record.instruction
          ) ?? "保持当前职责但收紧执行。"
      };
    });
  }

  const adjustmentsRecord = readUnknownRecord(value);
  if (!adjustmentsRecord) {
    return undefined;
  }

  return Object.entries(adjustmentsRecord).map(([agentId, adjustmentValue]) => ({
    agentId,
    adjustment: normalizeCoachTimeoutText(adjustmentValue) ?? String(adjustmentValue)
  }));
}

function normalizeCoachTimeoutText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => normalizeCoachTimeoutText(item)).filter((item): item is string => Boolean(item));
    return items.length > 0 ? items.join("；") : undefined;
  }

  const record = readUnknownRecord(value);
  if (!record) {
    return undefined;
  }

  const directText = readStringField(record, ["text", "summary", "directive", "adjustment", "reason", "focus"]);
  if (directText) {
    return directText;
  }

  const entries = Object.entries(record)
    .map(([key, nestedValue]) => {
      const nestedText = normalizeCoachTimeoutText(nestedValue);
      return nestedText ? `${normalizeCoachTimeoutKeyLabel(key)}：${nestedText}` : undefined;
    })
    .filter((entry): entry is string => Boolean(entry));
  return entries.length > 0 ? entries.join("；") : undefined;
}

function normalizeCoachTimeoutKeyLabel(key: string): string {
  switch (key) {
    case "primary":
      return "主优先";
    case "secondary":
      return "次优先";
    case "raise":
    case "increase":
      return "提高";
    case "lower":
    case "decrease":
      return "降低";
    case "deprioritize":
    case "deemphasize":
      return "降权";
    case "focus":
      return "聚焦";
    case "avoid":
      return "避免";
    case "zone":
    case "zoneId":
      return "区域";
    case "summary":
      return "摘要";
    case "text":
      return "说明";
    case "directive":
      return "指令";
    case "adjustment":
      return "调整";
    default:
      return key;
  }
}

function readStringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key].trim().length > 0) {
      return record[key].trim();
    }
  }

  return undefined;
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

function normalizeJudgeRoundWinType(value: unknown): JudgeRoundWinType | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, "_");
  switch (normalized) {
    case "attack_elimination":
    case "attacker_elimination":
    case "t_elimination":
    case "attack_kill":
    case "all_kill_attack":
    case "attack_full_elimination":
      return "attack_elimination";
    case "attack_bomb_explosion":
    case "bomb_explosion":
    case "plant_and_explode":
    case "attack_explosion":
    case "attack_bomb":
      return "attack_bomb_explosion";
    case "defense_elimination":
    case "defender_elimination":
    case "ct_elimination":
    case "defense_kill":
    case "all_kill_defense":
    case "defense_full_elimination":
      return "defense_elimination";
    case "defense_timeout_no_plant":
    case "timeout_no_plant":
    case "defense_timeout":
    case "timeout":
    case "no_plant_timeout":
      return "defense_timeout_no_plant";
    case "defense_defuse":
    case "defuse":
    case "bomb_defuse":
    case "defense_bomb_defuse":
      return "defense_defuse";
    default:
      return undefined;
  }
}

function normalizeJudgeBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "1", "success", "met"].includes(normalized)) {
    return true;
  }
  if (["false", "no", "0", "failed", "not_met", "notmet"].includes(normalized)) {
    return false;
  }
  return undefined;
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
  task: Phase20PrePromptTask;
  schemaName: string;
  requestInput: unknown;
}): LlmMessage[] {
  const contextSummary = buildPhase18PromptContextSummary(input.requestInput);
  return buildPhase20PreStructuredMessages({
    task: input.task,
    schemaName: input.schemaName,
    requestInput: input.requestInput,
    contextSummary
  });
}

function buildPhase18PromptContextSummary(requestInput: unknown): string {
  const record = readUnknownRecord(requestInput);
  if (!record) {
    return "上下文摘要：不可用。";
  }

  const roundNumber = typeof record.roundNumber === "number" ? record.roundNumber : undefined;
  const mapName = typeof record.mapName === "string" ? record.mapName : undefined;
  const mapSemantic = readUnknownRecord(record.mapSemanticContext);
  const proposition = readUnknownRecord(mapSemantic?.proposition);
  const judgeRubric = readUnknownRecord(record.judgeRubricContext) ?? readUnknownRecord(mapSemantic?.judgeRubric);
  const initialProposal = readUnknownRecord(record.initialProposal);
  const proposalAnchor = readUnknownRecord(record.proposalAnchor);
  const coachContext = readUnknownRecord(record.coachContext);
  const teamMemoryOverlay = readUnknownRecord(record.teamMemoryOverlay);
  const teamPlan = readUnknownRecord(record.teamPlan);
  const coachCorrection = readUnknownRecord(record.coachCorrection);
  const coachAdjustment = readUnknownRecord(record.coachAdjustment);
  const playerDirective = readUnknownRecord(record.playerDirective);
  const evaluationOrder = Array.isArray(record.evaluationOrder)
    ? record.evaluationOrder
        .map((entry) => readUnknownRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];

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
            return zonePairs.length > 0 ? [`区域别名：${zonePairs.join("；")}`] : [];
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
    ...(initialProposal
      ? [
          `队伍唯一方案：${pickString(initialProposal, "teamThesis") ?? "unknown"}`,
          ...(() => {
            const mustHoldClaims = pickStringArray(initialProposal, "mustHoldClaims");
            return mustHoldClaims.length > 0 ? [`必须守住：${mustHoldClaims.join(" / ")}`] : [];
          })(),
          ...(() => {
            const failureModes = pickStringArray(initialProposal, "failureModes");
            return failureModes.length > 0 ? [`已知失败模式：${failureModes.join(" / ")}`] : [];
          })(),
          ...(() => {
            const frontendSummary = pickString(initialProposal, "frontendSummary");
            return frontendSummary ? [`方案摘要：${frontendSummary}`] : [];
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
    ...(proposalAnchor
      ? [
          `选手方案锚点：${pickString(proposalAnchor, "teamThesis") ?? "unknown"}`,
          ...(() => {
            const playerOperatingPrinciples = pickStringArray(proposalAnchor, "playerOperatingPrinciples");
            return playerOperatingPrinciples.length > 0 ? [`选手执行原则：${playerOperatingPrinciples.join(" / ")}`] : [];
          })()
        ]
      : []),
    ...(teamMemoryOverlay
      ? [
          `已采纳长期补丁：${pickString(teamMemoryOverlay, "proposedStrategyPatch") ?? pickString(teamMemoryOverlay, "timeoutQualityReview") ?? "已存在"}`
        ]
      : []),
    ...evaluationOrder.flatMap((entry) => {
      const initialProposalSummary = readUnknownRecord(entry.initialProposalSummary);
      const summarizedPlan = readUnknownRecord(entry.teamPlan);
      const teamName = pickString(entry, "teamName") ?? pickString(entry, "teamId") ?? "unknown";
      const nextLines = [`裁判待评队伍：${teamName}`];
      if (initialProposalSummary) {
        nextLines.push(`方案主张：${pickString(initialProposalSummary, "teamThesis") ?? "unknown"}`);
      }
      if (summarizedPlan) {
        nextLines.push(`当前意图：${pickString(summarizedPlan, "primaryIntent") ?? "unknown"}`);
      }
      return nextLines;
    }),
    ...(teamPlan
      ? [
          `队伍意图：${pickString(teamPlan, "primaryIntent") ?? "unknown"}`,
          `队伍胜利条件：${pickString(teamPlan, "winCondition") ?? "unknown"}`
        ]
      : []),
    ...(coachCorrection
      ? [
          `暂停修正重点：${pickString(coachCorrection, "nextRoundObjective") ?? "unknown"}`,
          `暂停修正主令：${pickString(coachCorrection, "teamDirective") ?? "unknown"}`
        ]
      : []),
    ...(coachAdjustment ? [`教练单兵修正：${pickString(coachAdjustment, "adjustment") ?? "unknown"}`] : []),
    ...(playerDirective ? [`选手指令：${pickString(playerDirective, "directive") ?? "unknown"}`] : [])
  ];

  return `上下文摘要：\n${lines.join("\n")}`;
}

function resolvePhase18SubTheme(proposition: Record<string, unknown>, roundNumber: number | undefined): string | undefined {
  if (!roundNumber) {
    return undefined;
  }

  const regulationRoundThemes = Array.isArray(proposition.regulationRoundThemes)
    ? proposition.regulationRoundThemes
    : Array.isArray(proposition.regulation_round_themes)
      ? proposition.regulation_round_themes
      : [];
  const overtimeRoundThemes = Array.isArray(proposition.overtimeRoundThemes)
    ? proposition.overtimeRoundThemes
    : Array.isArray(proposition.overtime_round_themes)
      ? proposition.overtime_round_themes
      : [];
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
  initialProposalSummary: Record<string, unknown> | undefined;
  coachContext: Record<string, unknown> | undefined;
}): Phase18JudgePromptContext["requestInput"]["evaluationOrder"][number] {
  const entry = removeUndefined({
    teamId: input.teamId,
    teamName: input.teamName,
    activeAgents: input.activeAgents.map((agent) => ({ id: agent.id, role: agent.role })),
    teamPlan: input.teamPlan,
    initialProposalSummary: input.initialProposalSummary,
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

    const sanitizedOutput: AgentOutput = {
      ...output,
      id: `prompt_${promptAgentId}`,
      agentId: promptAgentId,
      teamId: promptTeamId,
      ...(output.action ? { action: sanitizeJudgeText(output.action, input.replacements) } : {}),
      ...(output.actionDetail ? { actionDetail: sanitizeJudgeValue(output.actionDetail, input.replacements) as AgentActionDecision } : {}),
      rawFingerprint: `prompt_fp_${promptAgentId}`
    };
    outputsByTeam.set(promptTeamId, [...(outputsByTeam.get(promptTeamId) ?? []), sanitizedOutput]);
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

function normalizeChineseFirstJudgeText(value: string): string {
  const replacements = [
    {
      source: "their user is real rather than aspirational",
      target: "其用户是真实存在的，而不是停留在愿景想象中"
    },
    {
      source: "failed to keep synchronized utility and trades after losing the first duel and breaking spacing",
      target: "在丢掉首个对枪并失去站位间距后，未能维持同步道具与补枪（synchronized utility and trades）"
    },
    {
      source: "win condition succeeded through synchronized utility and trades",
      target: "通过同步道具与补枪（synchronized utility and trades）让胜利条件成立"
    },
    {
      source: "wins by cleaner trading",
      target: "凭借更干净的补枪取胜"
    },
    {
      source: "failed to prove",
      target: "未能证明"
    },
    {
      source: "win condition succeeded",
      target: "胜利条件成立"
    },
    {
      source: "win condition failed",
      target: "胜利条件失守"
    },
    {
      source: "rather than",
      target: "而不是"
    }
  ] as const;

  let output = value;
  for (const replacement of replacements) {
    output = output.replace(buildJudgeLiteralPattern(replacement.source), replacement.target);
  }

  return output.replace(/\s{2,}/g, " ").trim();
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
  "成立点",
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
  "打中",
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
  "被打穿",
  "被压制",
  "没有",
  "不足",
  "失守"
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
  return candidates.some((candidate) => {
    const normalizedCandidate = normalizeForJudgeReason(candidate);
    return normalizedCandidate.length > 0 && value.includes(normalizedCandidate);
  });
}

function normalizeForJudgeReason(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").trim();
}

function assertNoMojibakePayload(value: unknown, label: string): void {
  const text = typeof value === "string" ? value : safeStringifyForMojibakeScan(value);
  if (!text || !hasLikelyMojibake(text)) {
    return;
  }

  throw new Error(`LLM context encoding is corrupted in ${label}. Restart the dev server and regenerate from clean materials.`);
}

function safeStringifyForMojibakeScan(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function hasLikelyMojibake(text: string): boolean {
  const matches = text.match(MOJIBAKE_MARKER_PATTERN) ?? [];
  if (matches.length < 8) {
    return false;
  }

  return matches.length / Math.max(text.length, 1) > 0.003;
}

const MOJIBAKE_MARKER_PATTERN = new RegExp(
  [
    "\u6759",
    "\u9346",
    "\u9405",
    "\u934A",
    "\u7039",
    "\u93B4",
    "\u7AD4",
    "\u934F",
    "\u93CD",
    "\u9422",
    "\u93B5",
    "\u59AB",
    "\u68F0",
    "\u9365",
    "\u9352",
    "\u6D93",
    "\u93C8",
    "\u6D16",
    "\u9239",
    "\u9286",
    "\u951B",
    "\u951F",
    "\uFFFD",
    "\u20AC",
    "\uE206",
    "\uE57D"
  ].join("|"),
  "g"
);

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

function mostFrequentWithCount(values: string[]): { value: string; count: number } | undefined {
  const counts = new Map<string, number>();
  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length === 0) {
      continue;
    }
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  const [value, count] = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0] ?? [];
  return typeof value === "string" && typeof count === "number" ? { value, count } : undefined;
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

