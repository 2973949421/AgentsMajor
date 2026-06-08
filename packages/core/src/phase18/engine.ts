import type { Repositories } from "@agent-major/db";
import type { LlmGateway } from "@agent-major/llm";
import type { JobQueue } from "@agent-major/queue";
import {
  agentActionDecisionSchema,
  type Agent,
  type AgentEconomyDelta,
  type AgentOutput,
  type BuyType,
  type CoachTimeoutCorrection,
  type EconomyState,
  type Event,
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
  type SubmittedAgentOutput,
  type Summary,
  type TacticalCollision,
  type Team,
  type TeamInitialProposalSummary,
  type TeamProposalAnchor,
  type TeamRoundPlanDecision
} from "@agent-major/shared";

import {
  buildBroadcastSourceBundle,
  type BroadcastSourceBundle,
  type RoundBroadcastGenerator
} from "../presentation/broadcast.js";
import { evaluateMapState, getSideContext, mr6MapRules, plannedDemoWinnerSide, type SideContext } from "../match/map-rules.js";
import { sanitizeLlmPayload } from "../llm/llm-output-normalizer.js";
import { buildDeterministicJudgeScorecard } from "../judge/judge-scorecard-materializer.js";
import { compactJudgeTeamPlan } from "../judge/judge-boundary.js";
import { runJudgePipeline } from "../judge/judge-pipeline.js";
import { shouldRetryStructuredJsonWithoutThinking } from "../judge/judge-validation.js";
import {
  createLlmStageRunner,
  type LlmStageRunner
} from "../llm/llm-stage-runner.js";
import { buildEconomyOutputDiagnostic } from "../economy/economy-output-diagnostics.js";
import {
  buildCompetitiveParityNote,
  buildSubmittedAgentOutputs,
  buyTypeForTeam,
  calculateEconomyDelta,
  cs2EconomyRules,
  decideTeamBuyType,
  decideTeamEconomyPlans,
  economyNetDeltaForTeam,
  economyStateFromDelta,
  formatEconomyDescriptor,
  formatEconomyPosture,
  initialEconomy,
  isOvertimeEconomyResetRound,
  isEconomyResetRound,
  isEconomySwing,
  outputBudgetForEconomyPosture,
  resolveRoundEconomyPhase,
  roundStartEconomy,
  sumEconomyByTeam,
  type AgentBuyDecision,
  type DropDecision,
  type TeamEconomyPlan
} from "../economy/economy-output-service.js";
import {
  buildScoreTensionGuardrailContext,
  buildScoreTensionDiagnostic,
  inferWinnerSide,
  type ScoreTensionRoundOutcome
} from "../presentation/score-tension-diagnostics.js";
import type { ArtifactStore } from "../ports.js";
import { buildPhase18StructuredMessages } from "./phase18-structured-messages.js";
import {
  buildCompactTeamPlanRequestInput,
  compactAgentProfile,
  compactCoachCorrection,
  compactMapSemanticContext,
  readPhase18JudgeRubricContext,
  readPhase18MapSemanticContext,
  readTeamHeadCoachProfile,
  readTeamInitialProposalSummary,
  readTeamMaterialInitialProposal,
  readTeamProposalAnchor
} from "./phase18-context-boundary.js";
import {
  resolveRoundCombatResolution,
  validateRoundKillLedger
} from "./combat-resolution-pipeline.js";
import {
  advanceScore,
  buildHighlightTags,
  buildJudgeReason,
  buildKeyEvents,
  buildMapSummary,
  buildMatchSummary,
  buildNeutralPublicRoundSummary,
  buildRoundBroadcastItemsWithFallback,
  buildSummary,
  commitBroadcastTimeline,
  describeScorePressure,
  formatScore,
  requiredProjection
} from "../presentation/round-presentation-service.js";
import {
  assertNoForbiddenTacticalFields,
  buildPublicTacticalContext,
  buildRuleBasedTacticalPlans,
  createSideAssignment,
  getPhase16TacticalMapLayout,
  resolveTacticalCollision,
  type RuleBasedTacticalPlans,
  type TacticalRoundGeneration
} from "../match/tactical-protocol.js";
import { runTeamPlanPipeline } from "./team-plan-pipeline.js";
import { runAgentActionPipeline } from "./agent-action-pipeline.js";
import { normalizeAgentActionDecision } from "./agent-action-boundary.js";
import {
  buildFallbackJudgeRoundWinType,
  selectMvpCandidate
} from "../judge/judge-fallback.js";
import { buildJudgeRubricProfile } from "../judge/judge-rubric-profile.js";
import {
  commitCoachTimeoutUsage,
  ensureCoachStatesForMap,
  generateCoachPostMatchReviewsIfNeeded,
  readApprovedTeamMemoryOverlay,
  resolveCoachTimeoutIfNeeded,
  type ResolvedCoachTimeout
} from "../coach/coach-service.js";

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
  useLlmCombatResolution?: boolean;
  useLlmCoachTimeouts?: boolean;
  useLlmCoachPostMatchReviews?: boolean;
  useJudgeBiasGuardrail?: boolean;
  allowPlannedDemoJudgeFallback?: boolean;
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

export type RoundRetryMode = "full_round" | "resume_from_stage";

export interface PlayNextRoundInput {
  mapGameId: string;
  retryMode?: RoundRetryMode | undefined;
}

export interface RunCurrentMapInput {
  mapGameId: string;
  mode?: "auto" | "debug";
  maxRounds?: number;
  retryMode?: RoundRetryMode | undefined;
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
  teamEconomyPlans: Record<string, TeamEconomyPlan>;
  buyDecisions: AgentBuyDecision[];
  dropDecisions: DropDecision[];
  beforeEconomy: EconomyState[];
  economyStates: EconomyState[];
  economyDelta: RoundReport["economyDelta"];
  coachTimeout?: ResolvedCoachTimeout;
  teamPlans?: Record<string, TeamRoundPlanDecision>;
  agentOutputs: AgentOutput[];
  submittedAgentOutputs: SubmittedAgentOutput[];
  judgeResult: JudgeResult;
  tacticalRound?: TacticalRoundGeneration;
  keyEvents: RoundKeyEvent[];
  killLedger: RoundKillLedgerEntry[];
  roundCombatResolution: RoundCombatResolution;
}

interface RoundGenerationOptions {
  retryMode?: RoundRetryMode | undefined;
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
  return new Phase12SimulationEngine({ ...context, allowPlannedDemoJudgeFallback: true });
}

export function createPhase12SimulationEngine(context: EngineContext): SimulationEngine {
  return new Phase12SimulationEngine({ ...context, allowPlannedDemoJudgeFallback: true });
}

export function createPhase13SimulationEngine(context: EngineContext): SimulationEngine {
  return new Phase12SimulationEngine({ ...context, allowPlannedDemoJudgeFallback: true });
}

export function createPhase16SimulationEngine(context: EngineContext): SimulationEngine {
  return new Phase12SimulationEngine({ ...context, tacticalProtocol: "rule", allowPlannedDemoJudgeFallback: true });
}

export function createPhase18SimulationEngine(context: EngineContext): SimulationEngine {
  return new Phase12SimulationEngine({
    ...context,
    tacticalProtocol: "rule",
    activeAgentsPerTeam: 5,
    useLlmTeamPlans: true,
    useLlmAgentActions: true,
    useLlmJudgeResults: true,
    useLlmCombatResolution: false,
    useLlmCoachTimeouts: true,
    useLlmCoachPostMatchReviews: true,
    useJudgeBiasGuardrail: true,
    allowPlannedDemoJudgeFallback: false,
    eventSourceModule: "core.phase18"
  });
}

class Phase12SimulationEngine implements SimulationEngine {
  private readonly roundStageRunner: LlmStageRunner;

  constructor(private readonly context: EngineContext) {
    this.roundStageRunner = createLlmStageRunner({
      repositories: context.repositories,
      llmGateway: context.llmGateway,
      artifactStore: context.artifactStore,
      eventSourceModule: context.eventSourceModule,
      buildMessages: buildPhase18StructuredMessages,
      assertNoMojibakePayload
    });
  }

  private coachServiceContext() {
    return {
      repositories: this.context.repositories,
      stageRunner: this.roundStageRunner,
      useLlmCoachTimeouts: this.context.useLlmCoachTimeouts,
      useLlmCoachPostMatchReviews: this.context.useLlmCoachPostMatchReviews,
      appendEvent: (event: Omit<Event, "globalSequence" | "sequenceInScope">) => this.appendEvent(event)
    };
  }

  private coachServiceDependencies() {
    return {
      readApprovedTeamMemoryOverlay: (teamId: string) =>
        readApprovedTeamMemoryOverlay({ repositories: this.context.repositories, teamId }),
      readMapSemanticContext: (mapName: string) => readPhase18MapSemanticContext(this.context, mapName),
      readJudgeRubricContext: (mapName: string) => readPhase18JudgeRubricContext(this.context, mapName),
      readTeamInitialProposal: readTeamMaterialInitialProposal,
      readTeamCoachContext: readTeamHeadCoachProfile,
      sortAgentsForRound
    };
  }

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
    await ensureCoachStatesForMap({
      context: this.coachServiceContext(),
      mapGame: updated,
      match
    });
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
      const generation = await this.prepareRoundGeneration(input.mapGameId, { retryMode: input.retryMode });
      const round = await this.commitRoundGeneration(generation);
      const committedMapGame = await this.context.repositories.mapGames.getById(round.mapGameId);
      if (committedMapGame) {
        const committedMatch = await this.context.repositories.matches.getById(committedMapGame.matchId);
        if (committedMatch?.status === "completed") {
      await generateCoachPostMatchReviewsIfNeeded({
        context: this.coachServiceContext(),
        dependencies: this.coachServiceDependencies(),
        match: committedMatch
      });
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

      await this.playNextRound({ mapGameId: input.mapGameId, retryMode: input.retryMode });
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

  private async prepareRoundGeneration(mapGameId: string, options: RoundGenerationOptions = {}): Promise<RoundGeneration> {
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
    await ensureCoachStatesForMap({
      context: this.coachServiceContext(),
      mapGame,
      match
    });

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
        if (isEconomyResetRound(roundNumber)) {
          return roundStartEconomy({
            agent,
            mapGameId: mapGame.id,
            roundNumber,
            createdAt: now,
            side: sideForTeam(agent.teamId, teamA.id, sideContext.activeSide) === "active" ? "attack" : "defense"
          });
        }

        return (await this.context.repositories.economyStates.getLatestByAgent(agent.id, mapGame.id)) ?? initialEconomy(agent, mapGame.id, now);
      })
    );
    const previousRoundReports = await this.context.repositories.roundReports.listByMapGame(mapGame.id);
    const recentRoundReports = previousRoundReports.slice(-3);
    const recentPublicRoundSummaries = recentRoundReports.map((report) =>
      buildNeutralPublicRoundSummary({
        report,
        teamA,
        teamB
      })
    );
    const teamEconomyPlans = decideTeamEconomyPlans({
      roundNumber,
      scoreBeforeRound,
      teamA,
      teamB,
      activeA,
      activeB,
      beforeEconomy,
      sideContext,
      previousRoundReport: recentRoundReports.at(-1)
    });
    const teamABuyType = teamEconomyPlans[teamA.id]?.summaryBuyType ?? decideTeamBuyType(beforeEconomy.filter((state) => state.teamId === teamA.id));
    const teamBBuyType = teamEconomyPlans[teamB.id]?.summaryBuyType ?? decideTeamBuyType(beforeEconomy.filter((state) => state.teamId === teamB.id));
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
    const buyDecisionByAgent = new Map(
      Object.values(teamEconomyPlans)
        .flatMap((plan) => plan.decisions)
        .map((decision) => [decision.agentId, decision] as const)
    );
    const sideAssignment = createSideAssignment({
      roundId,
      roundNumber,
      teamAId: teamA.id,
      teamBId: teamB.id,
      sideContext
    });
    const coachTimeout = await resolveCoachTimeoutIfNeeded({
      context: this.coachServiceContext(),
      dependencies: this.coachServiceDependencies(),
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
      ? await runTeamPlanPipeline({
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
          teamEconomyPlans,
          beforeEconomy,
          ...(tacticalPlans ? { tacticalPlans } : {}),
          recentPublicRoundSummaries,
          ...(coachTimeout ? { coachTimeout } : {}),
          retryMode: options.retryMode,
          stageRunner: this.roundStageRunner
        }, {
          readTeamMemoryOverlay: (teamId) => readApprovedTeamMemoryOverlay({ repositories: this.context.repositories, teamId }),
          buildRequestInput: (sideInput) =>
            buildCompactTeamPlanRequestInput({
              context: this.context,
              round: sideInput.round,
              mapGame: sideInput.mapGame,
              team: sideInput.team,
              opponent: sideInput.opponent,
              activeAgents: sideInput.activeAgents,
              side: sideInput.side,
              sideAssignment: sideInput.sideAssignment,
              scoreBeforeRound: sideInput.scoreBeforeRound,
              buyType: sideInput.buyTypeByTeam.get(sideInput.team.id) ?? "eco",
              beforeEconomy: sideInput.beforeEconomy,
              tacticalHint: sideInput.tacticalHint,
              recentPublicRoundSummaries: sideInput.recentPublicRoundSummaries,
              competitiveParityNote: buildCompetitiveParityNote(sideInput.teamEconomyPlans, sideInput.team.id) ?? "",
              teamMemoryOverlay: sideInput.teamMemoryOverlay,
              ...(sideInput.teamEconomyPlans[sideInput.team.id] ? { teamEconomyPlan: sideInput.teamEconomyPlans[sideInput.team.id] } : {}),
              ...(sideInput.coachTimeout?.teamId === sideInput.team.id ? { coachCorrection: sideInput.coachTimeout.correction } : {})
            }),
          shouldRetryStructuredJsonWithoutThinking
        })
      : undefined;

    const agentOutputs = await runAgentActionPipeline({
      match,
      agents: allActive,
      round,
      observabilityAttempt,
      mapGame,
      sideContext,
      teamA,
      teamB,
      buyDecisionByAgent,
      teamEconomyPlans,
      ...(teamPlans ? { teamPlans } : {}),
      ...(coachTimeout ? { coachTimeout } : {}),
      retryMode: options.retryMode,
      stageRunner: this.roundStageRunner,
      llmGateway: this.context.llmGateway,
      useLlmAgentActions: this.context.useLlmAgentActions
    }, {
      buildRequestInput: async (sideInput) => {
        const agent = sideInput.agent;
        const buyDecision = sideInput.buyDecisionByAgent.get(agent.id);
        const buyType = buyDecision?.buyType ?? "eco";
        const posture = sideForTeam(agent.teamId, sideInput.teamA.id, sideInput.sideContext.activeSide) === "active" ? "active-side" : "reactive-side";
        const agentTeam = agent.teamId === sideInput.teamA.id ? sideInput.teamA : sideInput.teamB;
        const opponentTeam = agent.teamId === sideInput.teamA.id ? sideInput.teamB : sideInput.teamA;
        const teamPlan = sideInput.teamPlans?.[agent.teamId];
        const playerDirective = teamPlan?.playerDirectives.find(
          (directive: TeamRoundPlanDecision["playerDirectives"][number]) => directive.agentId === agent.id
        );
        const coachAdjustment =
          sideInput.coachTimeout?.teamId === agent.teamId
            ? sideInput.coachTimeout.correction.playerAdjustments.find(
                (adjustment: CoachTimeoutCorrection["playerAdjustments"][number]) => adjustment.agentId === agent.id
              )
            : undefined;
        return {
          objective: "Choose this player's concrete tactical action for the current round.",
          roundId: sideInput.round.id,
          roundNumber: sideInput.round.roundNumber,
          mapName: sideInput.mapGame.mapName,
          agentId: agent.id,
          agentDisplayName: agent.displayName,
          teamId: agent.teamId,
          teamName: agentTeam.displayName,
          proposalAnchor: readTeamProposalAnchor(agentTeam, agent),
          coachContext: readTeamHeadCoachProfile(agentTeam),
          teamMemoryOverlay: await readApprovedTeamMemoryOverlay({ repositories: this.context.repositories, teamId: agentTeam.id }),
          opponentTeamId: opponentTeam.id,
          opponentTeamName: opponentTeam.displayName,
          role: agent.role,
          secondaryRoles: agent.secondaryRoles ?? [],
          roleResponsibilities: (agent.roleProfile?.agentMajorResponsibilities ?? []).slice(0, 3).map((entry) => truncatePromptText(entry, 100)),
          baseProfile: compactAgentProfile(agent),
          mapSemanticContext: compactMapSemanticContext(readPhase18MapSemanticContext(this.context, sideInput.mapGame.mapName)),
          teamPlan: compactJudgeTeamPlan(teamPlan),
          playerDirective: playerDirective
            ? {
                agentId: playerDirective.agentId,
                directive: truncatePromptText(playerDirective.directive, 120)
              }
            : undefined,
          ...(coachAdjustment ? { coachAdjustment } : {}),
          buyType,
          economyPosture: buyDecision?.economyPosture ?? sideInput.teamEconomyPlans[agent.teamId]?.posture ?? "eco",
          roundEconomyPhase: sideInput.teamEconomyPlans[agent.teamId]?.phase ?? resolveRoundEconomyPhase(sideInput.round.roundNumber),
          economyPostureReason: sideInput.teamEconomyPlans[agent.teamId]?.postureReason ?? "默认经济态势。",
          loadoutPackage: buyDecision?.loadoutPackage ?? "pistol_eco_pack",
          outputBudget: buyDecision?.outputBudget ?? 180,
          economyIntent: teamPlan?.economyIntent
            ? {
                defaultPosture: teamPlan.economyIntent.defaultPosture,
                summary: truncatePromptText(teamPlan.economyIntent.summary, 100)
              }
            : undefined,
          competitiveParityNote: buildCompetitiveParityNote(sideInput.teamEconomyPlans, agent.teamId),
          posture,
          sideContext: removeUndefined({
            phase: sideInput.sideContext.phase,
            activeSide: sideInput.sideContext.activeSide,
            reactiveSide: sideInput.sideContext.reactiveSide,
            sideSwitchIndex: sideInput.sideContext.sideSwitchIndex
          })
        };
      },
      validateResponseData: (data) => agentActionDecisionSchema.parse(sanitizeLlmPayload(data)),
      buildFallbackAction: (sideInput) => {
        const agent = sideInput.agent;
        const buyDecision = sideInput.buyDecisionByAgent.get(agent.id);
        const buyType = buyDecision?.buyType ?? "eco";
        const posture = sideForTeam(agent.teamId, sideInput.teamA.id, sideInput.sideContext.activeSide) === "active" ? "active-side" : "reactive-side";
        const teamPlan = sideInput.teamPlans?.[agent.teamId];
        const playerDirective = teamPlan?.playerDirectives.find(
          (directive: TeamRoundPlanDecision["playerDirectives"][number]) => directive.agentId === agent.id
        );
        return {
          roundObjective: `${agent.displayName} 在本回合以 ${buyType} ${posture} 姿态执行 ${sideInput.mapGame.mapName} 上的队伍计划。`,
          executionPlan: "按照队伍计划选择一个可执行的站位、观察或推进动作，避免把计划性动作写成已经发生的战斗结果。",
          coordinationPlan: playerDirective?.directive ?? "根据 IGL 与队伍计划同步节奏，保持和相邻队友的交易、牵制或信息衔接。",
          roleResponsibilityUsage: (agent.roleProfile?.agentMajorResponsibilities ?? []).join(" / ") || "使用本位置的长期职责支持队伍计划。",
          riskRead: "如果首个信息点不足或队友节奏受阻，本行动可能无法给裁判提供足够明确的执行证据。",
          contingencyPlan: "受阻时回到队伍计划的次级区域或支援职责，保留可审计的修正路径。",
          expectedContribution: "为裁判提供该选手如何履行职责、如何支持队伍计划以及如何处理风险的结构化证据。",
          confidence: 0.72 + (stableNumber(agent.id, 18) / 100),
          fingerprint: sideInput.responseData.fingerprint ?? stableHex(`${sideInput.round.id}:${agent.id}`)
        };
      },
      normalizeActionDecision: normalizeAgentActionDecision,
      buildOutput: (sideInput) => ({
        id: `out_${sideInput.round.id}_${sideInput.agent.id}`,
        agentId: sideInput.agent.id,
        teamId: sideInput.agent.teamId,
        role: sideInput.agent.role,
        driverModelId: sideInput.agent.driverModelId,
        actionDetail: sideInput.actionDetail,
        confidence: sideInput.actionDetail.confidence,
        rawFingerprint: sideInput.actionDetail.fingerprint ?? sideInput.fingerprint ?? stableHex(`${sideInput.round.id}:${sideInput.agent.id}`)
      })
    });
    const submittedAgentOutputs = buildSubmittedAgentOutputs({
      agentOutputs,
      buyDecisionByAgent
    });
    const tacticalRound =
      tacticalPlans && sideAssignment
        ? (() => {
            const collision = resolveTacticalCollision({
              ...tacticalPlans,
              sideAssignment,
              buyTypeByTeam: Object.fromEntries(buyTypeByTeam),
              scoreBeforeRound,
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
      teamEconomyPlans,
      sideAssignment,
      ...(teamPlans ? { teamPlans } : {}),
      ...(coachTimeout ? { coachTimeout } : {}),
      agentOutputs: submittedAgentOutputs,
      ...(tacticalCollision ? { tacticalCollision } : {}),
      recentPublicRoundSummaries,
      recentWinnerTeamIds: previousRoundReports.map((report) => report.winnerTeamId),
      recentRoundOutcomes: previousRoundReports.map((report) => ({
        winnerTeamId: report.winnerTeamId,
        winnerSide: inferWinnerSide({
          winnerTeamId: report.winnerTeamId,
          attackingTeamId: report.tacticalContext?.sideAssignment.attackingTeamId,
          defendingTeamId: report.tacticalContext?.sideAssignment.defendingTeamId,
          roundWinType: report.judgeResult.roundWinType,
          tacticalResult: report.tacticalContext?.collision.result
        })
      })),
      scoreHistory: previousRoundReports.map((report) => report.scoreAfterRound),
      retryMode: options.retryMode
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
      loserTeamId,
      teamAId: teamA.id,
      teamBId: teamB.id,
      roundWinType: judgeResult.roundWinType ?? "attack_elimination",
      teamEconomyPlans,
      activeA,
      activeB
    });
    const economyStates = (economyDelta.agents as AgentEconomyDelta[]).map((delta) => economyStateFromDelta(delta, mapGame.id, roundId, now));
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
    const roundCombatResolution = await resolveRoundCombatResolution({
      roundId,
      roundNumber,
      observabilityAttempt,
      match,
      mapGame,
      round,
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
      tacticalCollision,
      retryMode: options.retryMode,
      stageRunner: this.roundStageRunner,
      useLlmCombatResolution: this.context.useLlmCombatResolution ?? false
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
      teamEconomyPlans,
      buyDecisions: Object.values(teamEconomyPlans).flatMap((plan) => plan.decisions),
      dropDecisions: Object.values(teamEconomyPlans).flatMap((plan) => plan.dropDecisions),
      beforeEconomy,
      economyStates,
      economyDelta,
      ...(coachTimeout ? { coachTimeout } : {}),
      ...(teamPlans ? { teamPlans } : {}),
      agentOutputs,
      submittedAgentOutputs,
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
          const coachTimeoutEvents = await commitCoachTimeoutUsage({
            context: this.coachServiceContext(),
            match,
            mapGame,
            round,
            coachTimeout: generation.coachTimeout,
            createdAt: now
          });
          timeoutUsedEvent = coachTimeoutEvents.timeoutUsedEvent;
          coachTimeoutCorrectionEvent = coachTimeoutEvents.coachTimeoutCorrectionEvent;
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
        if (generation.judgeResult.judgeScorecard) {
          await this.appendEvent({
            id: `evt_${round.id}_judge_evidence_score_materialized`,
            type: "judge_evidence_score_materialized",
            category: "judge",
            tournamentId: match.tournamentId,
            matchId: match.id,
            mapGameId: mapGame.id,
            roundId: round.id,
            scopeType: "round",
            scopeId: round.id,
            payload: {
              schemaVersion: 1,
              sourceEventIds: [judgeEvent.id],
              scorecardSource: generation.judgeResult.judgeScorecard.scorecardSource,
              winnerTeamId: generation.judgeResult.winnerTeamId,
              winnerFromScore: generation.judgeResult.judgeScorecard.winnerFromScore,
              scoreDelta: generation.judgeResult.judgeScorecard.scoreDelta,
              marginFromScore: generation.judgeResult.judgeScorecard.marginFromScore,
              decisiveDimensions: generation.judgeResult.judgeScorecard.decisiveDimensions,
              normalizedFieldNotes: generation.judgeResult.judgeScorecard.normalizedFieldNotes ?? []
            },
            createdAt: now
          });
        }
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
        const diagnosticSideAssignment =
          generation.tacticalRound?.sideAssignment ??
          createSideAssignment({
            roundId: round.id,
            roundNumber: round.roundNumber,
            teamAId: teamA.id,
            teamBId: teamB.id,
            sideContext: generation.sideContext
          });
        const economyOutputDiagnosticEvent = await this.appendEvent({
          id: `evt_${round.id}_economy_output_diagnostic`,
          type: "economy_output_diagnostic",
          category: "economy",
          tournamentId: match.tournamentId,
          matchId: match.id,
          mapGameId: mapGame.id,
          roundId: round.id,
          scopeType: "round",
          scopeId: round.id,
          payload: {
            schemaVersion: 1,
            sourceEventIds: [economyEvent.id, judgeEvent.id],
            diagnostic: buildEconomyOutputDiagnostic({
              roundNumber: round.roundNumber,
              winnerTeamId: generation.judgeResult.winnerTeamId,
              sideAssignment: diagnosticSideAssignment,
              teamAId: teamA.id,
              teamBId: teamB.id,
              teamABuyType: generation.teamABuyType,
              teamBBuyType: generation.teamBBuyType,
              submittedAgentOutputs: generation.submittedAgentOutputs,
              judgeResult: generation.judgeResult,
              tacticalCollision: generation.tacticalRound?.collision
            })
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
          {
            type: economyOutputDiagnosticEvent.type,
            eventId: economyOutputDiagnosticEvent.id,
            required: false
          },
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
            submittedOutputIds: generation.submittedAgentOutputs.map((output) => output.id),
            submittedOutputs: generation.submittedAgentOutputs,
            totalOutputBudget: generation.submittedAgentOutputs.reduce((sum, output) => sum + output.outputBudget, 0),
            outputGate: {
              applied: true,
              reason: "本地确定性 Output Gate：RawOutput 完整保留用于审计，Judge 只消费按个人经济态势裁剪后的 SubmittedOutput。",
              teamPostures: {
                [generation.teamA.id]: generation.teamEconomyPlans[generation.teamA.id]?.posture ?? "eco",
                [generation.teamB.id]: generation.teamEconomyPlans[generation.teamB.id]?.posture ?? "eco"
              }
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
            roundCombatResolution: generation.roundCombatResolution,
            economyDelta: generation.economyDelta,
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

      const broadcastItems = await buildRoundBroadcastItemsWithFallback({
        bundle: committed.broadcastBundle,
        createdAt: committed.createdAt,
        broadcastGenerator: this.context.broadcastGenerator
      });
      await commitBroadcastTimeline({
        service: {
          repositories: this.context.repositories,
          appendEvent: (event) => this.appendEvent(event)
        },
        committed,
        broadcastItems
      });

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
    teamEconomyPlans: Record<string, TeamEconomyPlan>;
    sideAssignment: SideAssignment;
    teamPlans?: Record<string, TeamRoundPlanDecision>;
    coachTimeout?: ResolvedCoachTimeout;
    agentOutputs: AgentOutput[];
    tacticalCollision?: TacticalCollision;
    recentPublicRoundSummaries: string[];
    recentWinnerTeamIds: string[];
    recentRoundOutcomes: ScoreTensionRoundOutcome[];
    scoreHistory?: ScorePair[] | undefined;
    retryMode?: RoundRetryMode | undefined;
  }): Promise<JudgeResult> {
    if (this.context.useLlmJudgeResults) {
      const mapSemanticContext = readPhase18MapSemanticContext(this.context, input.mapGame.mapName);
      const judgeRubricContext = readPhase18JudgeRubricContext(this.context, input.mapGame.mapName);
      const scoreTensionGuardrail = buildScoreTensionGuardrailContext({
        mapName: input.mapGame.mapName,
        scoreBeforeRound: input.scoreBeforeRound,
        recentWinnerTeamIds: input.recentWinnerTeamIds,
        recentRoundOutcomes: input.recentRoundOutcomes,
        scoreHistory: input.scoreHistory,
        teamA: input.teamA,
        teamB: input.teamB
      });
      const rubricProfile = buildJudgeRubricProfile({
        mapName: input.mapGame.mapName,
        roundNumber: input.roundNumber,
        sideAssignment: input.sideAssignment,
        teamEconomyPlans: input.teamEconomyPlans,
        mapSemanticContext,
        judgeRubricContext
      });
      const driverModelId = input.activeA[0]?.driverModelId ?? input.activeB[0]?.driverModelId ?? "";
      return runJudgePipeline({
        match: input.match,
        mapGame: input.mapGame,
        round: input.round,
        roundNumber: input.roundNumber,
        scoreBeforeRound: input.scoreBeforeRound,
        observabilityAttempt: input.observabilityAttempt,
        driverModelId,
        retryMode: input.retryMode,
        stageRunner: this.roundStageRunner,
        sideAssignment: input.sideAssignment,
        teamA: input.teamA,
        teamB: input.teamB,
        activeA: input.activeA,
        activeB: input.activeB,
        teamABuyType: input.teamABuyType,
        teamBBuyType: input.teamBBuyType,
        teamEconomyPlans: input.teamEconomyPlans,
        competitiveParityNote: buildCompetitiveParityNote(input.teamEconomyPlans),
        ...(input.teamPlans ? { teamPlans: input.teamPlans } : {}),
        agentOutputs: input.agentOutputs,
        ...(input.tacticalCollision ? { tacticalCollision: input.tacticalCollision } : {}),
        recentPublicRoundSummaries: input.recentPublicRoundSummaries,
        rubricProfile,
        ...(scoreTensionGuardrail ? { scoreTensionGuardrail } : {}),
        ...(input.coachTimeout ? { appliedCoachCorrection: compactCoachCorrection(input.coachTimeout.correction) } : {}),
        ...(readTeamInitialProposalSummary(input.teamA) ? { teamAInitialProposalSummary: readTeamInitialProposalSummary(input.teamA) } : {}),
        ...(readTeamInitialProposalSummary(input.teamB) ? { teamBInitialProposalSummary: readTeamInitialProposalSummary(input.teamB) } : {}),
        ...(readTeamHeadCoachProfile(input.teamA) ? { teamACoachContext: readTeamHeadCoachProfile(input.teamA) } : {}),
        ...(readTeamHeadCoachProfile(input.teamB) ? { teamBCoachContext: readTeamHeadCoachProfile(input.teamB) } : {}),
        ...(mapSemanticContext ? { mapSemanticContext } : {}),
        ...(judgeRubricContext ? { judgeRubricContext } : {}),
        recentWinnerTeamIds: input.recentWinnerTeamIds,
        useJudgeBiasGuardrail: this.context.useJudgeBiasGuardrail
      });
    }

    if (!this.context.allowPlannedDemoJudgeFallback) {
      throw new Error("Planned demo judge fallback is disabled for real Phase 2.0-pre runs.");
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
    const fallbackRubricProfile = buildJudgeRubricProfile({
      mapName: input.mapGame.mapName,
      roundNumber: input.roundNumber,
      sideAssignment: input.sideAssignment,
      teamEconomyPlans: input.teamEconomyPlans,
      mapSemanticContext: readPhase18MapSemanticContext(this.context, input.mapGame.mapName),
      judgeRubricContext: readPhase18JudgeRubricContext(this.context, input.mapGame.mapName)
    });

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
      confidence: 0.84,
      judgeScorecard: buildDeterministicJudgeScorecard({
        rubricProfile: fallbackRubricProfile,
        winnerTeamId,
        loserTeamId,
        teamAId: input.teamA.id,
        teamBId: input.teamB.id,
        sideAssignment: input.sideAssignment,
        margin,
        roundWinType,
        reason: "本地 demo fallback 评分，仅用于显式 fake/demo/test 模式。",
        source: "deterministic_fallback"
      })
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

function truncatePromptText(value: string | undefined, maxLength: number): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
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

async function required<T>(promise: Promise<T | null>, message: string): Promise<T> {
  const value = await promise;
  if (!value) {
    throw new Error(message);
  }

  return value;
}

function timestamp(): string {
  return new Date().toISOString();
}

function normalizeSelectedMapIds(selectedMapIds: string[] | undefined, maxMaps: number | undefined): string[] {
  const fallback = selectedMapIds && selectedMapIds.length > 0 ? selectedMapIds : ["DUST2"];
  const limit = typeof maxMaps === "number" && maxMaps > 0 ? maxMaps : fallback.length;
  return fallback.slice(0, limit);
}

function hasMatchWinner(match: Match): boolean {
  return match.teamAMapsWon >= 2 || match.teamBMapsWon >= 2;
}

function plannedDemoWinnerSideForMap(mapGame: MapGame, roundNumber: number): "teamA" | "teamB" {
  const mapWinner = plannedDemoMapWinnerSide(mapGame.mapName);
  return roundNumber % 4 === 0 ? (mapWinner === "teamA" ? "teamB" : "teamA") : mapWinner;
}

function plannedDemoMapWinnerSide(mapName: string): "teamA" | "teamB" {
  return stableHex(mapName).charCodeAt(0) % 2 === 0 ? "teamA" : "teamB";
}

function readStringArrayPayloadField(payload: unknown, fieldName: string): string[] {
  const record = isRecord(payload) ? payload : {};
  const value = record[fieldName];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sortAgentsForRound(agents: Agent[]): Agent[] {
  const roleOrder = new Map<Agent["role"], number>([
    ["igl", 0],
    ["entry", 1],
    ["awper", 2],
    ["lurker", 3],
    ["support", 4],
    ["rifler", 5]
  ]);
  return [...agents].sort((left, right) => (roleOrder.get(left.role) ?? 99) - (roleOrder.get(right.role) ?? 99) || left.id.localeCompare(right.id));
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

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item !== "undefined")) as T;
}

function sideForTeam(teamId: string, teamAId: string, activeSide: "teamA" | "teamB"): "active" | "reactive" {
  const side = teamId === teamAId ? "teamA" : "teamB";
  return side === activeSide ? "active" : "reactive";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

