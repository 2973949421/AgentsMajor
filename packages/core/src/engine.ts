import type { Repositories } from "@agent-major/db";
import type { LlmGateway, LlmMessage, LlmResponse } from "@agent-major/llm";
import type { JobQueue } from "@agent-major/queue";
import {
  agentActionDecisionSchema,
  coachPostMatchReviewSchema,
  coachTimeoutCorrectionSchema,
  combatResolutionDraftSchema,
  defenderThesisContextSchema,
  judgeDiagnosticSchema,
  judgeRubricProfileSchema,
  judgeScoreDimensions,
  judgeScorecardSchema,
  judgeNarrativeDecisionSchema,
  judgeResultSchema,
  judgeVerdictDecisionSchema,
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
  type CombatResolutionDraft,
  type EconomyPosture,
  type EconomyState,
  type Event,
  type DefenderThesisContext,
  type JudgeDiagnostic,
  type JudgeDimensionRequirements,
  type JudgeRubricProfile,
  type JudgeScoreDimension,
  type JudgeScoreDimensionWeights,
  type JudgeScorecard,
  type JudgeScorecardSource,
  type JudgeNarrativeDecision,
  type JudgeRoundWinType,
  type JudgeResult,
  type JudgeVerdictDecision,
  type LoadoutPackage,
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
import {
  normalizeKnownTacticalZoneId,
  normalizeLlmEconomyPosture,
  normalizeLlmLoadoutPackage,
  sanitizeLlmPayload
} from "./llm-output-normalizer.js";
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
import { REQUIRED_TACTICAL_ZONE_IDS } from "./tactical-map.js";

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

interface ResolvedCoachTimeout {
  teamId: string;
  teamName: string;
  triggerRoundId: string;
  triggerRoundNumber: number;
  correction: CoachTimeoutCorrection;
  responseArtifactId?: string;
  timeoutsRemainingBefore: number;
  timeoutsRemainingAfter: number;
  tokenBankBefore: number;
  tokenBankAfter: number;
}

interface DropDecision {
  fromAgentId: string;
  toAgentId: string;
  amount: number;
  reason: string;
}

interface AgentBuyDecision {
  agentId: string;
  teamId: string;
  tokenBankBefore: number;
  tokenBankAfterDrop: number;
  buyType: BuyType;
  economyPosture: EconomyPosture;
  loadoutPackage: LoadoutPackage;
  spend: number;
  outputBudget: number;
  dropSent: number;
  dropReceived: number;
  notes: string[];
}

type RoundEconomyPhase = "pistol_round" | "post_pistol" | "gun_round";

interface TeamEconomyPlan {
  teamId: string;
  side: "attack" | "defense";
  phase: RoundEconomyPhase;
  lossCount: number;
  posture: EconomyPosture;
  postureReason: string;
  summaryBuyType: BuyType;
  totalCash: number;
  dropDecisions: DropDecision[];
  decisions: AgentBuyDecision[];
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
    economyContextByTeam?: Record<string, { posture: EconomyPosture; lossCount: number; totalCash: number; postureReason: string }>;
    competitiveParityNote?: string | undefined;
    recentPublicRoundRecapPolicy?: string | undefined;
    mapSemanticContext?: Record<string, unknown>;
    judgeRubricContext?: Record<string, unknown>;
    defenderThesisContext?: DefenderThesisContext;
    rubricProfile?: JudgeRubricProfile;
    tacticalCollision?: TacticalCollision;
    evaluationOrder: Array<{
      teamId: string;
      teamName: string;
      activeAgents: Array<{ id: string; role: string }>;
      teamPlan?: TeamRoundPlanDecision;
      initialProposalSummary?: Record<string, unknown>;
      coachContext?: Record<string, unknown>;
    }>;
    teamAId: string;
    teamBId: string;
    teamAName: string;
    teamBName: string;
    activeTeamAAgentIds: string[];
    activeTeamBAgentIds: string[];
    judgeEvidenceDigest: Record<
      string,
      {
        maxItems: number;
        maxEvidencePerItem: number;
        items: Array<{
          agentId: string;
          outputBudget?: number;
          economyPosture?: string;
          omittedFieldCount: number;
          evidence: string[];
        }>;
      }
    >;
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
      const generation = await this.prepareRoundGeneration(input.mapGameId, { retryMode: input.retryMode });
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
        if (isEconomyResetRound(roundNumber)) {
          return initialEconomy(agent, mapGame.id, now);
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
          teamEconomyPlans,
          beforeEconomy,
          ...(tacticalPlans ? { tacticalPlans } : {}),
          recentPublicRoundSummaries,
          ...(coachTimeout ? { coachTimeout } : {}),
          retryMode: options.retryMode
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
      buyDecisionByAgent,
      teamEconomyPlans,
      ...(teamPlans ? { teamPlans } : {}),
      ...(coachTimeout ? { coachTimeout } : {}),
      retryMode: options.retryMode
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
    const roundCombatResolution = await this.resolveRoundCombatResolution({
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
      retryMode: options.retryMode
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

  private async resolveRoundCombatResolution(input: {
    roundId: string;
    roundNumber: number;
    observabilityAttempt: number;
    match: Match;
    mapGame: MapGame;
    round: Round;
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
    retryMode?: RoundRetryMode | undefined;
  }): Promise<RoundCombatResolution> {
    const deterministic = (source: "deterministic_resolution" | "deterministic_fallback") =>
      buildRoundCombatResolution({ ...input, source });

    if (!this.context.useLlmCombatResolution) {
      return deterministic("deterministic_resolution");
    }

    const driverModelId = input.activeA[0]?.driverModelId ?? input.activeB[0]?.driverModelId ?? "";
    const requestInput = buildCombatResolutionRequestInput(input);
    const validateDraft = (data: unknown): RoundCombatResolution => {
      const draft = combatResolutionDraftSchema.parse(sanitizeLlmPayload(data));
      return materializeCombatDraft({
        draft,
        roundId: input.roundId,
        activeA: input.activeA,
        activeB: input.activeB,
        judgeResult: input.judgeResult
      });
    };

    try {
      const response = await this.runObservedStructuredCall<RoundCombatResolution>({
        callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_combat_resolution`,
        stageId: "combat_resolution",
        retryMode: input.retryMode,
        attemptNumber: input.observabilityAttempt,
        task: "combat_resolution",
        schemaName: "CombatResolutionDraft",
        driverModelId,
        requestInput,
        responseFormat: "json_object",
        seed: `combat_resolution:${input.round.id}`,
        modelTier: "cheap",
        temperature: 0,
        maxOutputTokens: 2200,
        match: input.match,
        mapGame: input.mapGame,
        round: input.round,
        roundNumber: input.roundNumber,
        validateResponseData: validateDraft
      });
      return response.data;
    } catch (error) {
      const validationError = error instanceof Error ? error.message : String(error);
      try {
        const repair = await this.runObservedStructuredCall<RoundCombatResolution>({
          callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_combat_resolution_repair`,
          stageId: "combat_resolution:repair",
          retryMode: input.retryMode,
          attemptNumber: input.observabilityAttempt,
          task: "combat_resolution",
          schemaName: "CombatResolutionDraft",
          driverModelId,
          requestInput: {
            ...requestInput,
            objective: "Repair the combat draft. Keep verdict facts unchanged and return a valid CombatResolutionDraft.",
            validationError
          },
          responseFormat: "json_object",
          seed: `combat_resolution_repair:${input.round.id}`,
          modelTier: "cheap",
          temperature: 0,
          maxOutputTokens: 1600,
          match: input.match,
          mapGame: input.mapGame,
          round: input.round,
          roundNumber: input.roundNumber,
          validateResponseData: validateDraft
        });
        return repair.data;
      } catch {
        return deterministic("deterministic_fallback");
      }
    }
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
        if (generation.coachTimeout) {
          await this.context.repositories.teamMapCoachStates.save({
            mapGameId: mapGame.id,
            teamId: generation.coachTimeout.teamId,
            timeoutsRemaining: generation.coachTimeout.timeoutsRemainingAfter,
            tokenBank: generation.coachTimeout.tokenBankAfter,
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
        tokenBank: cs2EconomyRules.coachInitialBank,
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
    const coachTokenBank = coachState.tokenBank ?? cs2EconomyRules.coachInitialBank;
    if (coachTokenBank < cs2EconomyRules.coachTimeoutCost) {
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

    if (!this.context.useLlmCoachTimeouts) {
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
      maxOutputTokens: 1600,
      extraParams: llmThinkingDisabledParams,
      match: input.match,
      mapGame: input.mapGame,
      round: input.round,
      roundNumber: input.roundNumber,
      validateResponseData: (data) =>
        validateCoachTimeoutCorrection({
          correction: coachTimeoutCorrectionSchema.parse(normalizeCoachTimeoutCorrectionPayload(sanitizeLlmPayload(data))),
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
      timeoutsRemainingAfter: Math.max(0, coachState.timeoutsRemaining - 1),
      tokenBankBefore: coachTokenBank,
      tokenBankAfter: Math.max(0, coachTokenBank - cs2EconomyRules.coachTimeoutCost)
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
    if (!this.context.useLlmCoachPostMatchReviews) {
      return;
    }

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
        maxOutputTokens: 2200,
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
    await this.context.repositories.llmCalls.save(removeUndefined({
      id: input.callId,
      tournamentId: input.match.tournamentId,
      matchId: input.match.id,
      driverModelId: input.driverModelId,
      taskType: input.task,
      promptContractId,
      promptHash,
      requestArtifactId,
      status: "started",
      createdAt: startedAt
    }));

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
          providerDiagnostics: validatedResponse.providerDiagnostics,
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
        status: "completed",
        completedAt,
        latencyMs: Date.parse(completedAt) - Date.parse(startedAt),
        repaired: Boolean(validatedResponse.structuredRepair),
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
          providerDiagnostics: validatedResponse.providerDiagnostics,
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
      const errorKind = classifyLlmErrorKind(errorMessage);
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
          providerDiagnostics: latestResponse?.providerDiagnostics ?? diagnostic.providerDiagnostics,
          data: latestResponse?.data,
          structuredRepair: latestResponse?.structuredRepair,
          errorKind,
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
        status: "failed",
        error: errorMessage,
        completedAt: failedAt,
        latencyMs: Date.parse(failedAt) - Date.parse(startedAt),
        repaired: Boolean(latestResponse?.structuredRepair),
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
          providerDiagnostics: latestResponse?.providerDiagnostics ?? diagnostic.providerDiagnostics,
          errorKind,
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
    teamEconomyPlans: Record<string, TeamEconomyPlan>;
    beforeEconomy: EconomyState[];
    tacticalPlans?: RuleBasedTacticalPlans;
    recentPublicRoundSummaries: string[];
    coachTimeout?: ResolvedCoachTimeout;
    retryMode?: RoundRetryMode | undefined;
  }): Promise<Record<string, TeamRoundPlanDecision>> {
    const sides = [
      { team: input.teamA, opponent: input.teamB, activeAgents: input.activeA },
      { team: input.teamB, opponent: input.teamA, activeAgents: input.activeB }
    ];
    const output: Record<string, TeamRoundPlanDecision> = {};

    for (const side of sides) {
      const teamSide = side.team.id === input.sideAssignment.attackingTeamId ? "attack" : "defense";
      const teamMemoryOverlay = await this.readApprovedTeamMemoryOverlay(side.team.id);
      const requestInput = buildCompactTeamPlanRequestInput({
        context: this.context,
        round: input.round,
        mapGame: input.mapGame,
        team: side.team,
        opponent: side.opponent,
        activeAgents: side.activeAgents,
        side: teamSide,
        sideAssignment: input.sideAssignment,
        scoreBeforeRound: input.scoreBeforeRound,
        buyType: input.buyTypeByTeam.get(side.team.id) ?? "eco",
        beforeEconomy: input.beforeEconomy,
        tacticalHint: teamSide === "attack" ? input.tacticalPlans?.attackPlan : input.tacticalPlans?.defenseDeployment,
        recentPublicRoundSummaries: input.recentPublicRoundSummaries,
        competitiveParityNote: buildCompetitiveParityNote(input.teamEconomyPlans, side.team.id) ?? "",
        teamMemoryOverlay,
        ...(input.teamEconomyPlans[side.team.id] ? { teamEconomyPlan: input.teamEconomyPlans[side.team.id] } : {}),
        ...(input.coachTimeout?.teamId === side.team.id ? { coachCorrection: input.coachTimeout.correction } : {})
      });
      const validateResponseData = (data: unknown) =>
        validateTeamRoundPlan({
          plan: teamRoundPlanDecisionSchema.parse(
            normalizeTeamRoundPlanPayload(sanitizeLlmPayload(data), {
              activeAgents: side.activeAgents,
              defaultPosture: input.teamEconomyPlans[side.team.id]?.posture ?? "eco",
              economySummary: input.teamEconomyPlans[side.team.id]?.postureReason ?? "按当前经济态势执行团队买型。",
              buyIntentByAgent: side.activeAgents.map((agent) => {
                const decision = input.teamEconomyPlans[side.team.id]?.decisions.find((entry) => entry.agentId === agent.id);
                const buyIntent: {
                  agentId: string;
                  targetPosture: EconomyPosture;
                  preferredLoadout?: LoadoutPackage;
                } = {
                  agentId: agent.id,
                  targetPosture: decision?.economyPosture ?? input.teamEconomyPlans[side.team.id]?.posture ?? "eco"
                };
                if (decision?.loadoutPackage) {
                  buyIntent.preferredLoadout = decision.loadoutPackage;
                }
                return buyIntent;
              })
            })
          ),
          teamId: side.team.id,
          expectedSide: teamSide,
          activeAgents: side.activeAgents
        });
      let response: LlmResponse<TeamRoundPlanDecision>;
      try {
        response = await this.runObservedStructuredCall<TeamRoundPlanDecision>({
          callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_team_${safeId(side.team.id)}_team_plan`,
          stageId: `team_plan:${side.team.id}`,
          retryMode: input.retryMode,
          attemptNumber: input.observabilityAttempt,
          task: "team_plan",
          schemaName: "TeamRoundPlanDecision",
          driverModelId: side.activeAgents[0]?.driverModelId ?? "",
          requestInput,
          responseFormat: "json_object",
          seed: `team_plan:${input.round.id}:${side.team.id}`,
          modelTier: "cheap",
          temperature: 0,
          maxOutputTokens: 3200,
          extraParams: llmThinkingEnabledParams,
          match: input.match,
          mapGame: input.mapGame,
          round: input.round,
          roundNumber: input.round.roundNumber,
          validateResponseData
        });
      } catch (error) {
        const validationError = error instanceof Error ? error.message : String(error);
        if (!shouldRetryStructuredJsonWithoutThinking(validationError)) {
          throw error;
        }
        response = await this.runObservedStructuredCall<TeamRoundPlanDecision>({
          callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_team_${safeId(side.team.id)}_team_plan_no_thinking`,
          stageId: `team_plan:${side.team.id}`,
          retryMode: input.retryMode,
          attemptNumber: input.observabilityAttempt,
          task: "team_plan",
          schemaName: "TeamRoundPlanDecision",
          driverModelId: side.activeAgents[0]?.driverModelId ?? "",
          requestInput,
          responseFormat: "json_object",
          seed: `team_plan_no_thinking:${input.round.id}:${side.team.id}`,
          modelTier: "cheap",
          temperature: 0,
          maxOutputTokens: 2200,
          extraParams: llmThinkingDisabledParams,
          match: input.match,
          mapGame: input.mapGame,
          round: input.round,
          roundNumber: input.round.roundNumber,
          validateResponseData
        });
      }
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
    buyDecisionByAgent: Map<string, AgentBuyDecision>;
    teamEconomyPlans: Record<string, TeamEconomyPlan>;
    teamPlans?: Record<string, TeamRoundPlanDecision>;
    coachTimeout?: ResolvedCoachTimeout;
    retryMode?: RoundRetryMode | undefined;
  }): Promise<AgentOutput[]> {
    const outputs: AgentOutput[] = [];
    for (const agent of input.agents) {
      const buyDecision = input.buyDecisionByAgent.get(agent.id);
      const buyType = buyDecision?.buyType ?? "eco";
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
        roleResponsibilities: (agent.roleProfile?.agentMajorResponsibilities ?? []).slice(0, 3).map((entry) => truncatePromptText(entry, 100)),
        baseProfile: compactAgentProfile(agent),
        mapSemanticContext: compactMapSemanticContext(readPhase18MapSemanticContext(this.context, input.mapGame.mapName)),
        teamPlan: compactJudgeTeamPlan(teamPlan),
        playerDirective: playerDirective
          ? {
              agentId: playerDirective.agentId,
              directive: truncatePromptText(playerDirective.directive, 120)
            }
          : undefined,
        ...(coachAdjustment ? { coachAdjustment } : {}),
        buyType,
        economyPosture: buyDecision?.economyPosture ?? input.teamEconomyPlans[agent.teamId]?.posture ?? "eco",
        roundEconomyPhase: input.teamEconomyPlans[agent.teamId]?.phase ?? resolveRoundEconomyPhase(input.round.roundNumber),
        economyPostureReason: input.teamEconomyPlans[agent.teamId]?.postureReason ?? "默认经济态势。",
        loadoutPackage: buyDecision?.loadoutPackage ?? "pistol_eco_pack",
        outputBudget: buyDecision?.outputBudget ?? 180,
        economyIntent: teamPlan?.economyIntent
          ? {
              defaultPosture: teamPlan.economyIntent.defaultPosture,
              summary: truncatePromptText(teamPlan.economyIntent.summary, 100)
            }
          : undefined,
        competitiveParityNote: buildCompetitiveParityNote(input.teamEconomyPlans, agent.teamId),
        posture,
        sideContext: removeUndefined({
          phase: input.sideContext.phase,
          activeSide: input.sideContext.activeSide,
          reactiveSide: input.sideContext.reactiveSide,
          sideSwitchIndex: input.sideContext.sideSwitchIndex
        })
      };
      const response = this.context.useLlmAgentActions
        ? await this.runObservedStructuredCall<AgentActionDecision>({
            callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_agent_${safeId(agent.id)}_agent_action`,
            stageId: `agent_action:${agent.id}`,
            retryMode: input.retryMode,
            attemptNumber: input.observabilityAttempt,
            task: "agent_action",
            schemaName: "AgentActionDecision",
            driverModelId: agent.driverModelId,
            requestInput,
            responseFormat: "json_object",
            seed: `${input.round.id}:${agent.id}`,
            modelTier: "cheap",
            temperature: 0,
            maxOutputTokens: 1400,
            extraParams: llmThinkingDisabledParams,
            match: input.match,
            mapGame: input.mapGame,
            round: input.round,
            roundNumber: input.round.roundNumber,
            agent,
            validateResponseData: (data) => agentActionDecisionSchema.parse(sanitizeLlmPayload(data))
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
      const actionDetail = normalizeAgentActionDecision(llmDecision ?? fallbackActionDetail);
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
    teamEconomyPlans: Record<string, TeamEconomyPlan>;
    sideAssignment: SideAssignment;
    teamPlans?: Record<string, TeamRoundPlanDecision>;
    coachTimeout?: ResolvedCoachTimeout;
    agentOutputs: AgentOutput[];
    tacticalCollision?: TacticalCollision;
    recentPublicRoundSummaries: string[];
    recentWinnerTeamIds: string[];
    retryMode?: RoundRetryMode | undefined;
  }): Promise<JudgeResult> {
    if (this.context.useLlmJudgeResults) {
      const mapSemanticContext = readPhase18MapSemanticContext(this.context, input.mapGame.mapName);
      const judgeRubricContext = readPhase18JudgeRubricContext(this.context, input.mapGame.mapName);
      const scoreTensionGuardrail = buildScoreTensionGuardrailContext({
        scoreBeforeRound: input.scoreBeforeRound,
        recentWinnerTeamIds: input.recentWinnerTeamIds,
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
          teamEconomyPlans: input.teamEconomyPlans,
          mapSemanticContext,
          ...(input.teamPlans ? { teamPlans: input.teamPlans } : {}),
          agentOutputs: input.agentOutputs,
          ...(input.tacticalCollision ? { tacticalCollision: input.tacticalCollision } : {}),
          recentPublicRoundSummaries: input.recentPublicRoundSummaries,
          rubricProfile
        });
      const judgeRequestInput = {
        objective: "Judge this round from both teams' plans and player actions without team-order, fame, or score-lead bias.",
        roundId: input.round.id,
        roundNumber: input.roundNumber,
        mapName: input.mapGame.mapName,
        scoreBeforeRound: input.scoreBeforeRound,
        mapSemanticContext: compactMapSemanticContext(mapSemanticContext),
        judgeRubricContext: compactJudgeRubricContext(judgeRubricContext),
        ...(scoreTensionGuardrail ? { scoreTensionGuardrail } : {}),
        ...(input.coachTimeout ? { appliedCoachCorrection: compactCoachCorrection(input.coachTimeout.correction) } : {}),
        ...judgePromptContext.requestInput,
        evaluationOrder: compactJudgeEvaluationOrder(judgePromptContext.requestInput.evaluationOrder),
        recentPublicRoundSummaries: judgePromptContext.requestInput.recentPublicRoundSummaries
          .slice(-2)
          .map((summary) => truncatePromptText(summary, 140))
      };
      const driverModelId = input.activeA[0]?.driverModelId ?? input.activeB[0]?.driverModelId ?? "";
      const verdictResponse = await this.generateJudgeVerdict({
        judgeRequestInput,
        judgePromptContext,
        match: input.match,
        mapGame: input.mapGame,
        round: input.round,
        roundNumber: input.roundNumber,
        observabilityAttempt: input.observabilityAttempt,
        driverModelId,
        retryMode: input.retryMode
      });
      const narrativeResponse = await this.generateJudgeNarrative({
        verdict: verdictResponse.data,
        judgeRequestInput,
        judgePromptContext,
        match: input.match,
        mapGame: input.mapGame,
        round: input.round,
        roundNumber: input.roundNumber,
        observabilityAttempt: input.observabilityAttempt,
        driverModelId,
        retryMode: input.retryMode
      });
      const authoritativeJudgeResult = this.composeJudgeResultFromStages({
        verdict: verdictResponse.data,
        narrative: narrativeResponse.data,
        judgePromptContext,
        roundNumber: input.roundNumber,
        sideAssignment: input.sideAssignment,
        teamA: input.teamA,
        teamB: input.teamB,
        ...(input.teamPlans ? { teamPlans: input.teamPlans } : {}),
        agentOutputs: input.agentOutputs,
        ...(mapSemanticContext ? { mapSemanticContext } : {})
      });
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
        sideAssignment: input.sideAssignment,
        retryMode: input.retryMode
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

  private async generateJudgeVerdict(input: {
    judgeRequestInput: unknown;
    judgePromptContext: Phase18JudgePromptContext;
    match: Match;
    mapGame: MapGame;
    round: Round;
    roundNumber: number;
    observabilityAttempt: number;
    driverModelId: string;
    retryMode?: RoundRetryMode | undefined;
  }): Promise<LlmResponse<JudgeVerdictDecision>> {
    const validateResponseData = (data: unknown) => {
      try {
        const mapSemanticContext = readPhase18MapSemanticContext(this.context, input.mapGame.mapName);
        const normalizedPayload = materializeJudgeVerdictPayload({
          payload: normalizeJudgeVerdictPayload(sanitizeLlmPayload(data)),
          teamAId: input.judgePromptContext.requestInput.teamAId,
          teamBId: input.judgePromptContext.requestInput.teamBId,
          activeTeamAAgentIds: input.judgePromptContext.requestInput.activeTeamAAgentIds,
          activeTeamBAgentIds: input.judgePromptContext.requestInput.activeTeamBAgentIds,
          sideAssignment: input.judgePromptContext.requestInput.sideAssignment,
          defenderThesisContext: input.judgePromptContext.requestInput.defenderThesisContext,
          roundNumber: input.roundNumber,
          ...(mapSemanticContext ? { mapSemanticContext } : {}),
          ...(input.judgePromptContext.requestInput.rubricProfile
            ? { rubricProfile: input.judgePromptContext.requestInput.rubricProfile }
            : {})
        });
        const legacyRecord = readUnknownRecord(normalizedPayload);
        if (legacyRecord && !legacyRecord.diagnostic) {
          throw new Error("Judge diagnostic is required.");
        }
        const parsedVerdict = judgeVerdictDecisionSchema.parse(normalizedPayload);
        const verdict = {
          ...parsedVerdict,
          ...(typeof legacyRecord?.reason === "string" ? { reason: legacyRecord.reason } : {}),
          ...(legacyRecord?.judgeInference ? { judgeInference: legacyRecord.judgeInference } : {})
        } as JudgeVerdictDecision;
        validateJudgeVerdictDecision({
          verdict,
          teamAId: input.judgePromptContext.requestInput.teamAId,
          teamBId: input.judgePromptContext.requestInput.teamBId,
          activeTeamAAgentIds: input.judgePromptContext.requestInput.activeTeamAAgentIds,
          activeTeamBAgentIds: input.judgePromptContext.requestInput.activeTeamBAgentIds,
          sideAssignment: input.judgePromptContext.requestInput.sideAssignment,
          ...(input.judgePromptContext.requestInput.rubricProfile
            ? { rubricProfile: input.judgePromptContext.requestInput.rubricProfile }
            : {}),
          ...(mapSemanticContext ? { mapSemanticContext } : {})
        });
        return verdict;
      } catch (error) {
        throw translateJudgePromptError(error, input.judgePromptContext);
      }
    };

    try {
      return await this.runObservedStructuredCall<JudgeVerdictDecision>({
        callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_judge_verdict`,
        stageId: "judge_verdict",
        retryMode: input.retryMode,
        attemptNumber: input.observabilityAttempt,
        task: "judge_verdict",
        schemaName: "JudgeVerdictDecision",
        driverModelId: input.driverModelId,
        requestInput: input.judgeRequestInput,
        responseFormat: "json_object",
        seed: `judge_verdict:${input.round.id}`,
        modelTier: "cheap",
        temperature: 0,
        maxOutputTokens: 2200,
        extraParams: llmThinkingEnabledParams,
        match: input.match,
        mapGame: input.mapGame,
        round: input.round,
        roundNumber: input.roundNumber,
        validateResponseData
      });
    } catch (error) {
      const validationError = error instanceof Error ? error.message : String(error);
      if (shouldRetryStructuredJsonWithoutThinking(validationError)) {
        return this.runObservedStructuredCall<JudgeVerdictDecision>({
          callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_judge_verdict_no_thinking`,
          stageId: "judge_verdict",
          retryMode: input.retryMode,
          attemptNumber: input.observabilityAttempt,
          task: "judge_verdict",
          schemaName: "JudgeVerdictDecision",
          driverModelId: input.driverModelId,
          requestInput: input.judgeRequestInput,
          responseFormat: "json_object",
          seed: `judge_verdict_no_thinking:${input.round.id}`,
          modelTier: "cheap",
          temperature: 0,
          maxOutputTokens: 2200,
          extraParams: llmThinkingDisabledParams,
          match: input.match,
          mapGame: input.mapGame,
          round: input.round,
          roundNumber: input.roundNumber,
          validateResponseData
        });
      }
      if (!shouldAttemptJudgeRepair(validationError)) {
        throw error;
      }
      return this.runObservedStructuredCall<JudgeVerdictDecision>({
        callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_judge_verdict_repair`,
        stageId: "judge_verdict:repair",
        retryMode: input.retryMode,
        attemptNumber: input.observabilityAttempt,
        task: "judge_verdict",
        schemaName: "JudgeVerdictDecision",
        driverModelId: input.driverModelId,
        requestInput: removeUndefined({
          objective: "Repair the failed judge verdict as a short semantic draft. Core will materialize system facts such as currentSubTheme, canonical zones, margin and judgeScorecard.",
          validationError,
          roundId: input.round.id,
          roundNumber: input.roundNumber,
          mapName: input.mapGame.mapName,
          teamAId: input.judgePromptContext.requestInput.teamAId,
          teamBId: input.judgePromptContext.requestInput.teamBId,
          teamAName: readUnknownRecord(input.judgeRequestInput)?.teamAName,
          teamBName: readUnknownRecord(input.judgeRequestInput)?.teamBName,
          activeTeamAAgentIds: input.judgePromptContext.requestInput.activeTeamAAgentIds,
          activeTeamBAgentIds: input.judgePromptContext.requestInput.activeTeamBAgentIds,
          sideAssignment: input.judgePromptContext.requestInput.sideAssignment,
          defenderThesisContext: compactDefenderThesisContext(input.judgePromptContext.requestInput.defenderThesisContext),
          rubricProfileSummary: compactJudgeRubricProfile(input.judgePromptContext.requestInput.rubricProfile),
          allowedCanonicalZoneIds: input.judgePromptContext.requestInput.defenderThesisContext?.allowedCanonicalZoneIds,
          outputShape: {
            requiredFacts: [
              "winnerPromptTeamId or winnerTeamId",
              "roundWinType",
              "attackWinConditionMet",
              "defenseWinConditionMet",
              "confidence",
              "winnerReason",
              "loserFailureReason",
              "decisiveEvidenceText"
            ],
            scorecardPolicy:
              "Prefer omitting judgeScorecard. Core will materialize the final full judgeScorecard from rubricProfile and verdict facts."
          },
          repairRules: [
            "当前半场以 defenderThesisContext.defenderTeamThesis 为被检验主命题；攻方只是在 challenge 守方商业计划，不能把攻方自己的商业计划改写成主命题。",
            "不要输出 currentSubTheme、judgeScorecard.rubricProfile、winnerFromScore、marginFromScore，不要复制 mapSemanticContext、judgeRubricContext 或 originalJudgeInput。",
            "judgeScorecard 可以完全省略；如果输出 judgeScorecard，只会被系统当作轻量提示，最终完整评分表由代码生成。",
            "如果输出 teamScores，只能使用 objectiveScore、mapControlScore、submissionQualityScore、coordinationScore、economyAdjustedScore、riskControlScore、proofScore 七个固定维度，每条 evidence 不超过 18 个中文字符。",
            "winnerTeamId、loserTeamId、roundWinType、attackWinConditionMet、defenseWinConditionMet 必须与攻守关系一致。",
            "区域只输出 zoneFocusCandidates 或 diagnostic.mainAttackZoneId/mainDefenseZoneId 候选；未知区域会由系统回退到战术碰撞上下文。",
            "不要输出长判词。"
          ]
        }),
        responseFormat: "json_object",
        seed: `judge_verdict_repair:${input.round.id}`,
        modelTier: "cheap",
        temperature: 0,
        maxOutputTokens: 2200,
        extraParams: llmThinkingDisabledParams,
        match: input.match,
        mapGame: input.mapGame,
        round: input.round,
        roundNumber: input.roundNumber,
        validateResponseData
      });
    }
  }

  private async generateJudgeNarrative(input: {
    verdict: JudgeVerdictDecision;
    judgeRequestInput: unknown;
    judgePromptContext: Phase18JudgePromptContext;
    match: Match;
    mapGame: MapGame;
    round: Round;
    roundNumber: number;
    observabilityAttempt: number;
    driverModelId: string;
    retryMode?: RoundRetryMode | undefined;
  }): Promise<LlmResponse<JudgeNarrativeDecision>> {
    const validateResponseData = (data: unknown) => {
      try {
        const narrative = normalizeJudgeNarrativeDecisionForVerdict(
          judgeNarrativeDecisionSchema.parse(normalizeJudgeNarrativePayload(sanitizeLlmPayload(data))),
          input.verdict
        );
        validateJudgeNarrativeAgainstVerdict(narrative, input.verdict);
        return narrative;
      } catch (error) {
        throw translateJudgePromptError(error, input.judgePromptContext);
      }
    };
    const requestInput = {
      objective: "Write the readable judge narrative and judgeInference for the locked verdict. Do not change verdict facts.",
      verdict: compactJudgeNarrativeVerdict(input.verdict),
      originalJudgeInput: compactJudgeNarrativeOriginalInput(input.judgeRequestInput),
      narrativeLocks: {
        winnerTeamId: input.verdict.winnerTeamId,
        loserTeamId: input.verdict.loserTeamId,
        roundWinType: input.verdict.roundWinType,
        mvpAgentId: input.verdict.mvpAgentId,
        mainAttackZoneId: input.verdict.diagnostic.mainAttackZoneId,
        mainDefenseZoneId: input.verdict.diagnostic.mainDefenseZoneId
      },
      mapSemanticContext: compactMapSemanticContext(readPhase18MapSemanticContext(this.context, input.mapGame.mapName)),
      judgeRubricContext: compactJudgeRubricContext(readPhase18JudgeRubricContext(this.context, input.mapGame.mapName))
    };

    try {
      return await this.runObservedStructuredCall<JudgeNarrativeDecision>({
        callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_judge_narrative`,
        stageId: "judge_narrative",
        retryMode: input.retryMode,
        attemptNumber: input.observabilityAttempt,
        task: "judge_narrative",
        schemaName: "JudgeNarrativeDecision",
        driverModelId: input.driverModelId,
        requestInput,
        responseFormat: "json_object",
        seed: `judge_narrative:${input.round.id}`,
        modelTier: "cheap",
        temperature: 0,
        maxOutputTokens: 1600,
        extraParams: llmThinkingDisabledParams,
        match: input.match,
        mapGame: input.mapGame,
        round: input.round,
        roundNumber: input.roundNumber,
        validateResponseData
      });
    } catch (error) {
      const validationError = error instanceof Error ? error.message : String(error);
      const repairable = shouldAttemptJudgeRepair(validationError);
      if (!repairable && !shouldUseLocalJudgeNarrativeFallback(validationError)) {
        throw error;
      }
      if (repairable) {
        try {
          return await this.runObservedStructuredCall<JudgeNarrativeDecision>({
            callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_judge_narrative_repair`,
            stageId: "judge_narrative:repair",
            retryMode: input.retryMode,
            attemptNumber: input.observabilityAttempt,
            task: "judge_narrative",
            schemaName: "JudgeNarrativeDecision",
            driverModelId: input.driverModelId,
            requestInput: {
              ...requestInput,
              objective: "Repair the failed judge narrative. Return one complete JudgeNarrativeDecision only.",
              validationError,
              repairRules: [
                "不得改变 verdict 的胜方、败方、胜法、MVP、主攻区或主守区。",
                "judgeInference.source 必须是 judge_inference。",
                "boundary 必须说明战斗结果是裁判推断，不是 agent_action 原始事实。"
              ]
            },
            responseFormat: "json_object",
            seed: `judge_narrative_repair:${input.round.id}`,
            modelTier: "cheap",
            temperature: 0,
            maxOutputTokens: 1600,
            extraParams: llmThinkingDisabledParams,
            match: input.match,
            mapGame: input.mapGame,
            round: input.round,
            roundNumber: input.roundNumber,
            validateResponseData
          });
        } catch (repairError) {
          const repairMessage = repairError instanceof Error ? repairError.message : String(repairError);
          if (!shouldUseLocalJudgeNarrativeFallback(validationError) && !shouldUseLocalJudgeNarrativeFallback(repairMessage)) {
            throw repairError;
          }
        }
      }

      return buildLocalJudgeNarrativeFallbackResponse({
        verdict: input.verdict,
        roundNumber: input.roundNumber,
        mapName: input.mapGame.mapName,
        validationError
      });
    }
  }

  private composeJudgeResultFromStages(input: {
    verdict: JudgeVerdictDecision;
    narrative: JudgeNarrativeDecision;
    judgePromptContext: Phase18JudgePromptContext;
    roundNumber: number;
    sideAssignment: SideAssignment;
    teamA: Team;
    teamB: Team;
    teamPlans?: Record<string, TeamRoundPlanDecision>;
    agentOutputs: AgentOutput[];
    mapSemanticContext?: Record<string, unknown> | undefined;
  }): JudgeResult {
    try {
      const promptJudgeResult = judgeResultSchema.parse({
        ...input.verdict,
        reason: buildStagedJudgeReason(input.verdict, input.narrative),
        judgeInference: input.narrative.judgeInference
      });
      const translatedJudgeResult = input.judgePromptContext.validateAndTranslate(promptJudgeResult);
      return ensureStagedJudgeDiagnostic({
        judgeResult: translatedJudgeResult,
        roundNumber: input.roundNumber,
        sideAssignment: input.sideAssignment,
        teamA: input.teamA,
        teamB: input.teamB,
        ...(input.teamPlans ? { teamPlans: input.teamPlans } : {}),
        agentOutputs: input.agentOutputs,
        ...(input.judgePromptContext.requestInput.rubricProfile
          ? { rubricProfile: input.judgePromptContext.requestInput.rubricProfile }
          : {}),
        ...(input.mapSemanticContext ? { mapSemanticContext: input.mapSemanticContext } : {})
      });
    } catch (error) {
      throw translateJudgePromptError(error, input.judgePromptContext);
    }
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
    retryMode?: RoundRetryMode | undefined;
  }): Promise<JudgeResult> {
    const teamPlans = input.judgePromptContext.actualTeamPlans;
    const response = await this.runObservedStructuredCall<JudgeResult>({
      callId: `llm_${safeId(input.round.id)}_attempt_${input.observabilityAttempt}_judge_review`,
      stageId: "judge_review",
      retryMode: input.retryMode,
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
          const translatedJudgeResult = input.judgePromptContext.validateAndTranslate(
            judgeResultSchema.parse(normalizeJudgeResultPayload(sanitizeLlmPayload(data)))
          );
          const mapSemanticContext = readPhase18MapSemanticContext(this.context, input.mapGame.mapName);
          return ensureJudgeDiagnostic({
            judgeResult: normalizeLegacyJudgeScorecardForReview(translatedJudgeResult, {
              sideAssignment: input.sideAssignment,
              teamAId: input.teamA.id,
              teamBId: input.teamB.id,
              ...(input.judgePromptContext.requestInput.rubricProfile
                ? { rubricProfile: input.judgePromptContext.requestInput.rubricProfile }
                : {})
            }),
            roundNumber: input.roundNumber,
            sideAssignment: input.sideAssignment,
            teamA: input.teamA,
            teamB: input.teamB,
            ...(teamPlans ? { teamPlans } : {}),
            agentOutputs: input.judgePromptContext.actualAgentOutputs,
            ...(input.judgePromptContext.requestInput.rubricProfile
              ? { rubricProfile: input.judgePromptContext.requestInput.rubricProfile }
              : {}),
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
          "必须补齐 judgeScorecard；winnerTeamId 必须来自 scorecard.winnerFromScore，margin 必须来自 marginFromScore。",
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
    stageId?: string;
    retryMode?: RoundRetryMode | undefined;
    attemptNumber: number;
    task: "team_plan" | "agent_action" | "judge_verdict" | "judge_narrative" | "judge_review" | "combat_resolution" | "coach_timeout";
    schemaName: string;
    driverModelId: string;
    requestInput: unknown;
    responseFormat: "json_object";
    seed: string;
    modelTier: "cheap" | "standard" | "strong";
    temperature: number;
    maxOutputTokens?: number;
    extraParams?: Record<string, unknown>;
    match: Match;
    mapGame: MapGame;
    round: Round;
    roundNumber: number;
    agent?: Agent;
    validateResponseData?: (data: unknown) => TData;
  }) {
    const promptContractId = PHASE20_PRE_PROMPT_CONTRACT_ID;
    const stageId = input.stageId ?? `${input.task}:${input.agent?.id ?? "round"}`;
    const promptHash = stableHex(buildPhase20PrePromptHashSource({
      task: input.task,
      schemaName: input.schemaName,
      requestInput: input.requestInput,
      promptContractId
    }));
    if (input.retryMode === "resume_from_stage") {
      const checkpoint = await this.readValidatedRoundStageCheckpoint<TData>({
        matchId: input.match.id,
        roundId: input.round.id,
        stageId,
        task: input.task,
        schemaName: input.schemaName,
        promptContractId,
        promptHash
      });
      if (checkpoint) {
        const reusedAt = timestamp();
        await this.appendEvent({
          id: `evt_${input.callId}_stage_reused`,
          type: "round_generation_stage_reused",
          category: "runtime_control",
          tournamentId: input.match.tournamentId,
          matchId: input.match.id,
          mapGameId: input.mapGame.id,
          scopeType: "map",
          scopeId: input.mapGame.id,
          payload: removeUndefined({
            schemaVersion: 1,
            attemptNumber: input.attemptNumber,
            callId: input.callId,
            reusedFromCallId: checkpoint.callId,
            stageId,
            taskType: input.task,
            schemaName: input.schemaName,
            roundId: input.round.id,
            roundNumber: input.roundNumber,
            agentId: input.agent?.id,
            promptContractId,
            promptHash,
            requestArtifactId: checkpoint.requestArtifactId,
            responseArtifactId: checkpoint.responseArtifactId,
            reusedAt
          }),
          createdAt: reusedAt
        });
        return {
          data: checkpoint.data,
          usage: {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0
          },
          requestArtifactId: checkpoint.requestArtifactId,
          responseArtifactId: checkpoint.responseArtifactId
        };
      }
    }
    const startedAt = timestamp();
    await this.appendEvent({
      id: `evt_${input.callId}_stage_started`,
      type: "round_generation_stage_started",
      category: "runtime_control",
      tournamentId: input.match.tournamentId,
      matchId: input.match.id,
      mapGameId: input.mapGame.id,
      scopeType: "map",
      scopeId: input.mapGame.id,
      payload: removeUndefined({
        schemaVersion: 1,
        attemptNumber: input.attemptNumber,
        callId: input.callId,
        stageId,
        taskType: input.task,
        schemaName: input.schemaName,
        roundId: input.round.id,
        roundNumber: input.roundNumber,
        agentId: input.agent?.id,
        promptContractId,
        promptHash,
        retryMode: input.retryMode ?? "full_round",
        startedAt
      }),
      createdAt: startedAt
    });
    const requestArtifactId = await this.writeLlmArtifact({
      callId: input.callId,
      suffix: "request",
      artifactType: "llm_request",
      match: input.match,
      mapGame: input.mapGame,
      ...(input.agent ? { agent: input.agent } : {}),
      content: {
        schemaVersion: 1,
        attemptNumber: input.attemptNumber,
        taskType: input.task,
        driverModelId: input.driverModelId,
        schemaName: input.schemaName,
        promptContractId,
        promptHash,
        ...(input.extraParams ? { extraParams: input.extraParams } : {}),
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
      status: "started",
      createdAt: startedAt
    }));

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
        ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
        ...(input.extraParams ? { extraParams: input.extraParams } : {})
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
        ...(input.agent ? { agent: input.agent } : {}),
        content: {
          schemaVersion: 1,
          attemptNumber: input.attemptNumber,
          taskType: input.task,
          driverModelId: input.driverModelId,
          promptContractId,
          ...(input.extraParams ? { extraParams: input.extraParams } : {}),
          ok: true,
          rawText: validatedResponse.rawText,
          usage: validatedResponse.usage,
          providerDiagnostics: validatedResponse.providerDiagnostics,
          structuredRepair: validatedResponse.structuredRepair,
          data: validatedResponse.data
        }
      });
      await this.appendEvent({
        id: `evt_${input.callId}_stage_validated`,
        type: "round_generation_stage_validated",
        category: "runtime_control",
        tournamentId: input.match.tournamentId,
        matchId: input.match.id,
        mapGameId: input.mapGame.id,
        scopeType: "map",
        scopeId: input.mapGame.id,
        payload: removeUndefined({
          schemaVersion: 1,
          attemptNumber: input.attemptNumber,
          callId: input.callId,
          stageId,
          taskType: input.task,
          schemaName: input.schemaName,
          roundId: input.round.id,
          roundNumber: input.roundNumber,
          agentId: input.agent?.id,
          promptContractId,
          promptHash,
          requestArtifactId,
          responseArtifactId,
          validatedData: validatedResponse.data,
          validatedAt: completedAt
        }),
        createdAt: completedAt
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
        status: "completed",
        completedAt,
        latencyMs: Date.parse(completedAt) - Date.parse(startedAt),
        repaired: Boolean(validatedResponse.structuredRepair),
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
          providerDiagnostics: validatedResponse.providerDiagnostics,
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
      const errorKind = classifyLlmErrorKind(errorMessage);
      const diagnostic = readLlmErrorDiagnostic(error);
      const failedRawText = latestResponse?.rawText ?? diagnostic.rawText;
      const failedUsage = latestResponse?.usage ?? diagnostic.usage;
      const responseArtifactId = await this.writeLlmArtifact({
        callId: input.callId,
        suffix: "response",
        artifactType: "llm_response",
        match: input.match,
        mapGame: input.mapGame,
        ...(input.agent ? { agent: input.agent } : {}),
        content: {
          schemaVersion: 1,
          attemptNumber: input.attemptNumber,
          taskType: input.task,
          driverModelId: input.driverModelId,
          promptContractId,
          ...(input.extraParams ? { extraParams: input.extraParams } : {}),
          ok: false,
          rawText: failedRawText,
          rawTextPreview: previewText(failedRawText),
          parseCandidatePreview: previewText(diagnostic.parseCandidate),
          usage: failedUsage,
          providerDiagnostics: latestResponse?.providerDiagnostics ?? diagnostic.providerDiagnostics,
          data: latestResponse?.data,
          structuredRepair: latestResponse?.structuredRepair,
          errorKind,
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
        status: "failed",
        error: errorMessage,
        completedAt: failedAt,
        latencyMs: Date.parse(failedAt) - Date.parse(startedAt),
        repaired: Boolean(latestResponse?.structuredRepair),
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
          providerDiagnostics: latestResponse?.providerDiagnostics ?? diagnostic.providerDiagnostics,
          errorKind,
          error: errorMessage
        },
        createdAt: failedAt
      });
      await this.appendEvent({
        id: `evt_${input.callId}_stage_failed`,
        type: "round_generation_stage_failed",
        category: "runtime_control",
        tournamentId: input.match.tournamentId,
        matchId: input.match.id,
        mapGameId: input.mapGame.id,
        scopeType: "map",
        scopeId: input.mapGame.id,
        payload: removeUndefined({
          schemaVersion: 1,
          attemptNumber: input.attemptNumber,
          callId: input.callId,
          stageId,
          taskType: input.task,
          schemaName: input.schemaName,
          roundId: input.round.id,
          roundNumber: input.roundNumber,
          agentId: input.agent?.id,
          promptContractId,
          promptHash,
          responseArtifactId,
          errorKind,
          providerDiagnostics: latestResponse?.providerDiagnostics ?? diagnostic.providerDiagnostics,
          error: errorMessage,
          failedAt
        }),
        createdAt: failedAt
      });
      throw error;
    }
  }

  private async readValidatedRoundStageCheckpoint<TData>(input: {
    matchId: string;
    roundId: string;
    stageId: string;
    task: Phase20PrePromptTask;
    schemaName: string;
    promptContractId: string;
    promptHash: string;
  }): Promise<{
    data: TData;
    callId: string;
    requestArtifactId?: string;
    responseArtifactId?: string;
  } | null> {
    const events = await this.context.repositories.events.listByMatch(input.matchId);
    for (const event of [...events].sort((left, right) => right.globalSequence - left.globalSequence)) {
      if (event.type !== "round_generation_stage_validated") {
        continue;
      }
      const payload = isRecord(event.payload) ? event.payload : null;
      if (
        !payload ||
        payload.roundId !== input.roundId ||
        payload.stageId !== input.stageId ||
        payload.taskType !== input.task ||
        payload.schemaName !== input.schemaName ||
        payload.promptContractId !== input.promptContractId ||
        payload.promptHash !== input.promptHash ||
        typeof payload.callId !== "string" ||
        typeof payload.validatedData === "undefined"
      ) {
        continue;
      }

      return {
        data: payload.validatedData as TData,
        callId: payload.callId,
        ...(typeof payload.requestArtifactId === "string" ? { requestArtifactId: payload.requestArtifactId } : {}),
        ...(typeof payload.responseArtifactId === "string" ? { responseArtifactId: payload.responseArtifactId } : {})
      };
    }

    return null;
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to write LLM artifact ${input.callId}-${input.suffix}: ${message}`);
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
    tokenBank: cs2EconomyRules.initialMoney,
    buyType: "eco",
    lossStreak: 1,
    lossCount: 1,
    economyPosture: "pistol_round",
    loadoutPackage: "pistol_round_pack",
    timeoutsRemaining: 1,
    visibleContextBudget: 1200,
    outputBudget: outputBudgetForEconomyPosture("pistol_round"),
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

function buildScoreTensionGuardrailContext(input: {
  scoreBeforeRound: ScorePair;
  recentWinnerTeamIds: string[];
  teamA: Team;
  teamB: Team;
}):
  | {
      level: "warning" | "strong";
      scoreBeforeRound: ScorePair;
      scoreDiff: number;
      latestWinnerTeamId?: string;
      latestWinnerName?: string;
      winningStreak: number;
      instruction: string;
    }
  | undefined {
  const latestWinnerTeamId = input.recentWinnerTeamIds.at(-1);
  let winningStreak = 0;
  for (let index = input.recentWinnerTeamIds.length - 1; index >= 0; index -= 1) {
    if (!latestWinnerTeamId || input.recentWinnerTeamIds[index] !== latestWinnerTeamId) {
      break;
    }
    winningStreak += 1;
  }
  const scoreDiff = Math.abs(input.scoreBeforeRound.teamA - input.scoreBeforeRound.teamB);
  const level = winningStreak >= 4 || scoreDiff >= 4 ? "strong" : winningStreak >= 3 ? "warning" : undefined;
  if (!level) {
    return undefined;
  }
  const latestWinnerName =
    latestWinnerTeamId === input.teamA.id ? input.teamA.displayName : latestWinnerTeamId === input.teamB.id ? input.teamB.displayName : undefined;
  return {
    level,
    scoreBeforeRound: input.scoreBeforeRound,
    scoreDiff,
    ...(latestWinnerTeamId ? { latestWinnerTeamId } : {}),
    ...(latestWinnerName ? { latestWinnerName } : {}),
    winningStreak,
    instruction:
      level === "strong"
        ? "Score tension is strong: explicitly justify why the leading or streaking side still wins, or why the trailing side's counterplay succeeds. Do not force a comeback; require evidence from plans, economy, positioning, and actions."
        : "Score tension warning: check whether the trailing side has credible counterplay. Do not force a winner, but explain the anti-snowball evidence."
  };
}

function calculateEconomyDelta(input: {
  beforeEconomy: EconomyState[];
  winnerTeamId: string;
  loserTeamId: string;
  teamAId: string;
  teamBId: string;
  roundWinType: JudgeRoundWinType;
  teamEconomyPlans: Record<string, TeamEconomyPlan>;
  activeA: Agent[];
  activeB: Agent[];
}): RoundReport["economyDelta"] {
  const teamALossCountBefore = inferTeamLossCount(input.beforeEconomy, input.teamAId);
  const teamBLossCountBefore = inferTeamLossCount(input.beforeEconomy, input.teamBId);
  const teamLossCountsBefore: Record<string, number> = {
    [input.teamAId]: teamALossCountBefore,
    [input.teamBId]: teamBLossCountBefore
  };
  const teamALossCountAfter =
    input.winnerTeamId === input.teamAId ? Math.max(0, teamALossCountBefore - 1) : Math.min(4, teamALossCountBefore + 1);
  const teamBLossCountAfter =
    input.winnerTeamId === input.teamBId ? Math.max(0, teamBLossCountBefore - 1) : Math.min(4, teamBLossCountBefore + 1);
  const teamLossCountsAfter: Record<string, number> = {
    [input.teamAId]: teamALossCountAfter,
    [input.teamBId]: teamBLossCountAfter
  };
  const roundOutcomeContext = buildRoundEconomyOutcomeContext({
    roundWinType: input.roundWinType,
    winnerTeamId: input.winnerTeamId,
    loserTeamId: input.loserTeamId,
    teamAId: input.teamAId,
    teamBId: input.teamBId,
    activeA: input.activeA,
    activeB: input.activeB,
    teamEconomyPlans: input.teamEconomyPlans
  });
  const agents: AgentEconomyDelta[] = input.beforeEconomy.map((state) => {
    const teamPlan = input.teamEconomyPlans[state.teamId];
    const buyDecision = teamPlan?.decisions.find((decision) => decision.agentId === state.agentId);
    const buyType = buyDecision?.buyType ?? state.buyType;
    const spent = buyDecision?.spend ?? spendForBuyType(buyType);
    const won = state.teamId === input.winnerTeamId;
    const priorLossCount = typeof state.lossCount === "number" ? state.lossCount : typeof state.lossStreak === "number" ? state.lossStreak : 1;
    const baseReward = won
      ? roundOutcomeContext.winnerRewardByTeam[state.teamId] ?? cs2EconomyRules.roundWinStandard
      : roundOutcomeContext.loserRewardByAgent[state.agentId] ?? lossBonusForCount(teamLossCountsBefore[state.teamId] ?? 1);
    const bonusReward = roundOutcomeContext.bonusRewardByAgent[state.agentId] ?? 0;
    const reward = Math.max(0, baseReward + bonusReward);
    const afterTokenBank = Math.max(0, state.tokenBank - spent) + reward;
    return {
      agentId: state.agentId,
      teamId: state.teamId,
      beforeTokenBank: state.tokenBank,
      spent,
      reward,
      afterTokenBank,
      buyType,
      lossStreak: won ? Math.max(0, priorLossCount - 1) : priorLossCount + 1,
      lossCount: teamLossCountsAfter[state.teamId] ?? 1,
      ...(buyDecision?.economyPosture ? { economyPosture: buyDecision.economyPosture } : {}),
      ...(buyDecision?.loadoutPackage ? { loadoutPackage: buyDecision.loadoutPackage } : {}),
      survived: roundOutcomeContext.survivorIds.has(state.agentId),
      dropSent: buyDecision?.dropSent ?? 0,
      dropReceived: buyDecision?.dropReceived ?? 0,
      notes: roundOutcomeContext.agentNotesById[state.agentId] ?? []
    };
  });

  return {
    agents,
    teamTotals: {
      teamA: sumEconomyDeltaByTeam(agents, input.teamAId),
      teamB: sumEconomyDeltaByTeam(agents, input.teamBId)
    },
    teamNetDelta: {
      teamA: sumEconomyNetDeltaByTeam(agents, input.teamAId),
      teamB: sumEconomyNetDeltaByTeam(agents, input.teamBId)
    },
    teamLossCounts: {
      teamA: teamLossCountsAfter[input.teamAId] ?? 1,
      teamB: teamLossCountsAfter[input.teamBId] ?? 1
    },
    teamEconomyPostures: {
      teamA: input.teamEconomyPlans[input.teamAId]?.posture ?? "eco",
      teamB: input.teamEconomyPlans[input.teamBId]?.posture ?? "eco"
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
    lossStreak: delta.lossStreak ?? delta.lossCount,
    lossCount: delta.lossCount,
    ...(delta.economyPosture ? { economyPosture: delta.economyPosture } : {}),
    ...(delta.loadoutPackage ? { loadoutPackage: delta.loadoutPackage } : {}),
    timeoutsRemaining: 1,
    visibleContextBudget: 1200,
    outputBudget: delta.economyPosture ? outputBudgetForEconomyPosture(delta.economyPosture) : outputBudgetForBuyType(delta.buyType),
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
  source?: RoundCombatResolution["source"];
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
  const attackerWins = input.winnerTeamId === attackerTeamId;
  const attackerDeathCount = Math.min(killPlan.attackerDeaths, Math.max(0, attackerAgents.length - (attackerWins ? 1 : 0)));
  const defenderDeathCount = Math.min(killPlan.defenderDeaths, Math.max(0, defenderAgents.length - (attackerWins ? 0 : 1)));
  const attackersToDie = selectDeathTargets(attackerAgents, attackerDeathCount, input.roundId, "attackers");
  const defendersToDie = selectDeathTargets(defenderAgents, defenderDeathCount, input.roundId, "defenders");
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
  const killCountsByAgentId = new Map<string, number>();

  const killEvents = deathOrder.map((target, index) => {
    const actorTeamId = target.teamId === teamAId ? teamBId : teamAId;
    const actorPool = aliveByTeam.get(actorTeamId) ?? [];
    const targetPool = aliveByTeam.get(target.teamId) ?? [];
    const targetAgent = targetPool.find((agent) => agent.id === target.id);
    let actor = pickCombatActor({
      candidates: actorPool,
      mvpAgentId: input.judgeResult.mvpAgentId,
      index,
      roundId: input.roundId,
      preferredTeamWon: actorTeamId === input.winnerTeamId
    });
    if (actor?.id === input.judgeResult.mvpAgentId && (killCountsByAgentId.get(actor.id) ?? 0) >= 2) {
      actor =
        pickCombatActor({
          candidates: actorPool.filter((candidate) => candidate.id !== input.judgeResult.mvpAgentId),
          mvpAgentId: input.judgeResult.mvpAgentId,
          index,
          roundId: `${input.roundId}:non_mvp_${index}`,
          preferredTeamWon: actorTeamId === input.winnerTeamId
        }) ?? actor;
    }
    if (!actor || !targetAgent) {
      throw new Error("Cannot build combat resolution without valid alive actor and target agents.");
    }
    killCountsByAgentId.set(actor.id, (killCountsByAgentId.get(actor.id) ?? 0) + 1);

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
    source: input.source ?? (input.judgeResult.judgeInference ? "judge_inference" : "deterministic_resolution"),
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
    clutchTag: determineClutchTag({
      roundWinType,
      killEvents,
      mvpAgentId: input.judgeResult.mvpAgentId,
      survivors: {
        teamAAgentIds: (aliveByTeam.get(teamAId) ?? []).map((agent) => agent.id),
        teamBAgentIds: (aliveByTeam.get(teamBId) ?? []).map((agent) => agent.id)
      },
      winnerTeamId: input.winnerTeamId,
      teamAId,
      teamBId
    }),
    mvpEvidence: buildCombatMvpEvidence(input.judgeResult, killEvents, plantEvent, defuseEvent, explosionEvent)
  };

  validateRoundCombatResolution({
    resolution,
    activeA: input.activeA,
    activeB: input.activeB,
    attackerTeamId,
    defenderTeamId,
    winnerTeamId: input.winnerTeamId,
    teamAId,
    teamBId,
    mvpAgentId: input.judgeResult.mvpAgentId
  });
  return resolution;
}

function buildCombatResolutionRequestInput(input: {
  roundId: string;
  roundNumber: number;
  winnerTeamId: string;
  loserTeamId: string;
  activeA: Agent[];
  activeB: Agent[];
  agentOutputs: AgentOutput[];
  judgeResult: JudgeResult;
  keyEvents: RoundKeyEvent[];
  tacticalCollision: TacticalCollision | undefined;
}): Record<string, unknown> {
  const teamAId = input.activeA[0]?.teamId ?? "";
  const teamBId = input.activeB[0]?.teamId ?? "";
  const roundWinType = input.judgeResult.roundWinType ?? "attack_elimination";
  const attackerTeamId = roundWinType.startsWith("attack_") ? input.winnerTeamId : input.loserTeamId;
  const defenderTeamId = attackerTeamId === teamAId ? teamBId : teamAId;
  return {
    objective: "Create a bounded combat draft for this round. The code validator is final authority.",
    roundId: input.roundId,
    roundNumber: input.roundNumber,
    verdict: {
      winnerTeamId: input.winnerTeamId,
      loserTeamId: input.loserTeamId,
      roundWinType,
      mvpAgentId: input.judgeResult.mvpAgentId,
      margin: input.judgeResult.margin,
      diagnostic: input.judgeResult.diagnostic
    },
    attackerTeamId,
    defenderTeamId,
    teamAId,
    teamBId,
    activeRosters: {
      teamA: input.activeA.map((agent) => ({ id: agent.id, teamId: agent.teamId, displayName: agent.displayName, role: agent.role })),
      teamB: input.activeB.map((agent) => ({ id: agent.id, teamId: agent.teamId, displayName: agent.displayName, role: agent.role }))
    },
    agentOutputs: input.agentOutputs.map((output) => ({
      id: output.id,
      agentId: output.agentId,
      teamId: output.teamId,
      role: output.role,
      actionDetail: output.actionDetail
    })),
    keyEvents: input.keyEvents,
    tacticalCollision: input.tacticalCollision,
    hardRules: [
      "同一 targetAgentId 只能死亡一次。",
      "actorAgentId 和 targetAgentId 必须来自 activeRosters 且属于不同队伍。",
      "survivors 必须等于 active roster 减去 killEvents.targetAgentId。",
      "roundWinType 决定爆弹事件，不允许叙事和事件矛盾。",
      "one_v_x 只有 MVP 是胜方唯一存活者时才允许。",
      "MVP 不应常规性拿 4-5 杀。"
    ]
  };
}

function materializeCombatDraft(input: {
  draft: CombatResolutionDraft;
  roundId: string;
  activeA: Agent[];
  activeB: Agent[];
  judgeResult: JudgeResult;
}): RoundCombatResolution {
  const teamAId = input.activeA[0]?.teamId;
  const teamBId = input.activeB[0]?.teamId;
  if (!teamAId || !teamBId) {
    throw new Error("Cannot validate combat draft without both active teams.");
  }
  const roundWinType = input.judgeResult.roundWinType ?? input.draft.roundWinType;
  if (input.draft.roundWinType !== roundWinType) {
    throw new Error("Combat draft roundWinType must match judge verdict.");
  }
  const attackerTeamId = roundWinType.startsWith("attack_") ? input.judgeResult.winnerTeamId : input.judgeResult.loserTeamId;
  const defenderTeamId = attackerTeamId === teamAId ? teamBId : teamAId;
  const resolution: RoundCombatResolution = {
    source: "combat_llm_validated",
    roundWinType,
    killEvents: input.draft.killEvents.map((kill, index) => ({
      ...kill,
      id: kill.id || `kl_${input.roundId}_${index + 1}`,
      sourceAgentOutputIds: kill.sourceAgentOutputIds ?? []
    })),
    ...(input.draft.plantEvent ? { plantEvent: input.draft.plantEvent } : {}),
    ...(input.draft.defuseEvent ? { defuseEvent: input.draft.defuseEvent } : {}),
    ...(input.draft.explosionEvent ? { explosionEvent: input.draft.explosionEvent } : {}),
    survivors: input.draft.survivors,
    ...(input.draft.openingDuel ? { openingDuel: input.draft.openingDuel } : {}),
    tradeSequence: input.draft.tradeSequence,
    clutchTag: input.draft.clutchTag ?? "none",
    mvpEvidence: input.draft.mvpEvidence
  };
  validateRoundCombatResolution({
    resolution,
    activeA: input.activeA,
    activeB: input.activeB,
    attackerTeamId,
    defenderTeamId,
    winnerTeamId: input.judgeResult.winnerTeamId,
    teamAId,
    teamBId,
    mvpAgentId: input.judgeResult.mvpAgentId
  });
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
  winnerTeamId: string;
  teamAId: string;
  teamBId: string;
  mvpAgentId: string;
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

  const attackerCount = activeIdsByTeam.get(input.attackerTeamId)?.size ?? 0;
  const defenderCount = activeIdsByTeam.get(input.defenderTeamId)?.size ?? 0;

  if (input.resolution.roundWinType === "attack_elimination" && defenderDeaths !== defenderCount) {
    throw new Error("Invalid combat resolution: attack_elimination requires all defenders dead.");
  }
  if (input.resolution.roundWinType === "defense_elimination" && attackerDeaths !== attackerCount) {
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
  const survivorIds = new Set([...input.resolution.survivors.teamAAgentIds, ...input.resolution.survivors.teamBAgentIds]);
  for (const [teamId, activeIds] of activeIdsByTeam) {
    const expectedSurvivors = [...activeIds].filter((agentId) => !deadIdsByTeam.get(teamId)?.has(agentId)).sort();
    const actualSurvivors = (teamId === input.teamAId ? input.resolution.survivors.teamAAgentIds : input.resolution.survivors.teamBAgentIds).sort();
    if (JSON.stringify(expectedSurvivors) !== JSON.stringify(actualSurvivors)) {
      throw new Error(`Invalid combat resolution: survivor list does not match kill events for ${teamId}.`);
    }
  }
  if (input.resolution.clutchTag === "one_v_x") {
    const winnerSurvivors = input.winnerTeamId === input.teamAId ? input.resolution.survivors.teamAAgentIds : input.resolution.survivors.teamBAgentIds;
    if (winnerSurvivors.length !== 1 || winnerSurvivors[0] !== input.mvpAgentId) {
      throw new Error("Invalid combat resolution: one_v_x requires MVP to be the sole winning survivor.");
    }
  }
  const mvpKills = input.resolution.killEvents.filter((kill) => kill.actorAgentId === input.mvpAgentId).length;
  if (mvpKills > 3 && input.resolution.clutchTag !== "one_v_x") {
    throw new Error("Invalid combat resolution: MVP kill count is too high without a real clutch.");
  }
  for (const kill of input.resolution.killEvents) {
    if (survivorIds.has(kill.targetAgentId)) {
      throw new Error(`Invalid combat resolution: dead target ${kill.targetAgentId} is listed as survivor.`);
    }
  }
}

function resolveBombSiteZoneId(zoneId: string): string {
  if (zoneId === "conversion_site_b" || zoneId === "token_economy") {
    return "conversion_site_b";
  }
  return "conversion_site_a";
}

function determineClutchTag(input: {
  roundWinType: JudgeRoundWinType;
  killEvents: RoundKillLedgerEntry[];
  mvpAgentId: string;
  survivors: RoundCombatResolution["survivors"];
  winnerTeamId: string;
  teamAId: string;
  teamBId: string;
}): NonNullable<RoundCombatResolution["clutchTag"]> {
  if (input.roundWinType === "defense_defuse") {
    return "retake";
  }
  if (input.roundWinType === "attack_bomb_explosion") {
    return "post_plant_hold";
  }
  const winnerSurvivors = input.winnerTeamId === input.teamAId ? input.survivors.teamAAgentIds : input.survivors.teamBAgentIds;
  const mvpKills = input.killEvents.filter((kill) => kill.actorAgentId === input.mvpAgentId).length;
  if (winnerSurvivors.length === 1 && winnerSurvivors[0] === input.mvpAgentId && mvpKills >= 2) {
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

function buildSummary(input: {
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

function summarizeCombatResolution(resolution: RoundCombatResolution): string {
  const opening = resolution.openingDuel
    ? `首个接触发生在 ${formatKillLedgerZoneLabel(resolution.openingDuel.zoneId)}`
    : "首个接触未形成击杀";
  const bomb = resolution.defuseEvent
    ? `，${resolution.defuseEvent.text}`
    : resolution.explosionEvent
      ? `，${resolution.explosionEvent.text}`
      : resolution.plantEvent
        ? `，${resolution.plantEvent.text}`
        : "";
  const survivors = `存活人数 ${resolution.survivors.teamAAgentIds.length}-${resolution.survivors.teamBAgentIds.length}`;
  return `${formatRoundWinType(resolution.roundWinType)}，${opening}，共 ${resolution.killEvents.length} 次击杀，${survivors}${bomb}。`;
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
  const netDelta = economyDelta.teamNetDelta ?? economyDelta.teamTotals;
  return Math.abs(netDelta.teamA - netDelta.teamB) >= 2000;
}

function economyTotalForTeam(economyDelta: RoundReport["economyDelta"], teamId: string, teamAId: string): number {
  return teamId === teamAId ? economyDelta.teamTotals.teamA : economyDelta.teamTotals.teamB;
}

function economyNetDeltaForTeam(economyDelta: RoundReport["economyDelta"], teamId: string, teamAId: string): number {
  const netDelta = economyDelta.teamNetDelta ?? economyDelta.teamTotals;
  return teamId === teamAId ? netDelta.teamA : netDelta.teamB;
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

function formatEconomyPosture(posture: EconomyPosture): string {
  switch (posture) {
    case "pistol_round":
      return "手枪局";
    case "full_eco":
      return "全E";
    case "eco":
      return "小E";
    case "pistol_armor_force":
      return "手枪甲强起";
    case "light_buy":
      return "轻买";
    case "force_buy":
      return "强起";
    case "half_buy":
      return "半起";
    case "bonus_round":
      return "奖励局";
    case "rifle_buy":
      return "长枪局";
    case "awp_buy":
      return "狙击局";
    case "double_awp":
      return "双狙局";
    case "broken_buy":
      return "破产混起";
    case "save_play":
      return "保枪局";
  }
}

function formatEconomyDescriptor(buyType: BuyType, posture?: EconomyPosture): string {
  return posture ? formatEconomyPosture(posture) : formatBuyType(buyType);
}

function buildCompetitiveParityNote(
  teamEconomyPlans: Record<string, TeamEconomyPlan>,
  focusTeamId?: string
): string | undefined {
  const plans = Object.values(teamEconomyPlans);
  if (plans.length < 2) {
    return undefined;
  }
  if (focusTeamId && !plans.some((plan) => plan.teamId === focusTeamId)) {
    return undefined;
  }
  const completePostures: EconomyPosture[] = ["rifle_buy", "awp_buy", "double_awp"];
  const bothRecovered = plans.slice(0, 2).every((plan) => completePostures.includes(plan.posture));
  if (!bothRecovered) {
    return undefined;
  }
  return "双方当前都已恢复完整购买，必须按本回合提交内容平等评估，不得因为前几回合连胜、连败或历史摘要默认偏向任一方。";
}

function buildNeutralPublicRoundSummary(input: {
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

const cs2EconomyRules = {
  initialMoney: 800,
  maxMoney: 16000,
  roundWinStandard: 3250,
  roundWinBomb: 3500,
  objectiveActorReward: 300,
  tPlantButDefusedTeamReward: 600,
  coachInitialBank: 5000,
  coachTimeoutCost: 2500,
  tComfortRifleMin: 4800,
  ctComfortRifleMin: 5500,
  tLowRifleMin: 4000,
  ctLowRifleMin: 4800,
  tAwpMin: 6500,
  ctAwpMin: 7000
} as const;

const lossBonusByCount = [1400, 1900, 2400, 2900, 3400] as const;

function isEconomyResetRound(roundNumber: number): boolean {
  return roundNumber === 1 || roundNumber === mr6MapRules.roundsPerHalf + 1 || isOvertimeEconomyResetRound(roundNumber);
}

function inferTeamLossCount(states: EconomyState[], teamId: string): number {
  const candidate =
    states.find((state) => state.teamId === teamId)?.lossCount ?? states.find((state) => state.teamId === teamId)?.lossStreak ?? 1;
  return Math.max(0, Math.min(4, candidate));
}

function lossBonusForCount(lossCount: number): number {
  return lossBonusByCount[Math.max(0, Math.min(4, lossCount))] ?? lossBonusByCount[1];
}

function teamEconomySide(teamId: string, teamAId: string, sideContext: SideContext): "attack" | "defense" {
  return sideForTeam(teamId, teamAId, sideContext.activeSide) === "active" ? "attack" : "defense";
}

function decideTeamEconomyPlans(input: {
  roundNumber: number;
  scoreBeforeRound: ScorePair;
  teamA: Team;
  teamB: Team;
  activeA: Agent[];
  activeB: Agent[];
  beforeEconomy: EconomyState[];
  sideContext: SideContext;
  previousRoundReport: RoundReport | undefined;
}): Record<string, TeamEconomyPlan> {
  const teamAPlan = buildTeamEconomyPlan({
    roundNumber: input.roundNumber,
    teamScore: input.scoreBeforeRound.teamA,
    opponentScore: input.scoreBeforeRound.teamB,
    team: input.teamA,
    activeAgents: input.activeA,
    states: input.beforeEconomy.filter((state) => state.teamId === input.teamA.id),
    side: teamEconomySide(input.teamA.id, input.teamA.id, input.sideContext),
    previousRoundReport: input.previousRoundReport
  });
  const teamBPlan = buildTeamEconomyPlan({
    roundNumber: input.roundNumber,
    teamScore: input.scoreBeforeRound.teamB,
    opponentScore: input.scoreBeforeRound.teamA,
    team: input.teamB,
    activeAgents: input.activeB,
    states: input.beforeEconomy.filter((state) => state.teamId === input.teamB.id),
    side: teamEconomySide(input.teamB.id, input.teamA.id, input.sideContext),
    previousRoundReport: input.previousRoundReport
  });
  return {
    [input.teamA.id]: teamAPlan,
    [input.teamB.id]: teamBPlan
  };
}

function buildTeamEconomyPlan(input: {
  roundNumber: number;
  teamScore: number;
  opponentScore: number;
  team: Team;
  activeAgents: Agent[];
  states: EconomyState[];
  side: "attack" | "defense";
  previousRoundReport: RoundReport | undefined;
}): TeamEconomyPlan {
  const sortedAgents = sortAgentsForRound(input.activeAgents);
  const statesByAgentId = new Map(input.states.map((state) => [state.agentId, state] as const));
  const phase = resolveRoundEconomyPhase(input.roundNumber);
  const lossCount = inferTeamLossCount(input.states, input.team.id);
  const teamScore = input.teamScore;
  const opponentScore = input.opponentScore;
  const totalCash = input.states.reduce((sum, state) => sum + state.tokenBank, 0);
  const roleAwpers = sortedAgents.filter((agent) => agent.role === "awper");
  const richestCash = Math.max(...input.states.map((state) => state.tokenBank), 0);
  const poorestCash = Math.min(...input.states.map((state) => state.tokenBank), cs2EconomyRules.maxMoney);
  const previousPackages = input.states.map((state) => state.loadoutPackage).filter((value): value is LoadoutPackage => Boolean(value));
  const previousBuyTypes = input.states.map((state) => state.buyType);
  const richThreshold = input.side === "attack" ? cs2EconomyRules.tComfortRifleMin : cs2EconomyRules.ctComfortRifleMin;
  const lowRifleThreshold = input.side === "attack" ? cs2EconomyRules.tLowRifleMin : cs2EconomyRules.ctLowRifleMin;
  const awpThreshold = input.side === "attack" ? cs2EconomyRules.tAwpMin : cs2EconomyRules.ctAwpMin;
  const comfortTeamCash = input.side === "attack" ? 24000 : 26000;
  const lowTeamCash = input.side === "attack" ? 12500 : 14000;
  const wonPreviousRound = input.previousRoundReport?.winnerTeamId === input.team.id;
  const previousBonusCarry =
    wonPreviousRound && previousPackages.some((value) => value === "smg_force_pack" || value === "bonus_carry_pack");
  const explicitSaveContext = previousBuyTypes.filter((buyType) => buyType === "save").length >= 2;
  const richEnoughForRifles = input.states.filter((state) => state.tokenBank >= richThreshold).length;
  const canLowRifle = input.states.filter((state) => state.tokenBank >= lowRifleThreshold).length;
  const awpReadyCount = input.states.filter((state) => state.tokenBank >= awpThreshold).length;
  const isBrokenBuy = richestCash - poorestCash >= 2600 && richEnoughForRifles >= 1 && poorestCash <= 1800;
  const postPistolFollowup = isPostPistolFollowupRound(input.roundNumber);
  const trailingBy = Math.max(0, opponentScore - teamScore);
  const lateHalfPressure = roundsRemainingInCurrentHalf(input.roundNumber) <= 2;
  const canContestWithForce =
    totalCash >= 10000 &&
    totalCash < comfortTeamCash &&
    (canLowRifle >= 3 || input.states.filter((state) => state.tokenBank >= 2000).length >= 4) &&
    (trailingBy >= 2 || lateHalfPressure || (postPistolFollowup && input.side === "attack"));

  let posture: EconomyPosture;
  let postureReason: string;
  if (phase === "pistol_round") {
    posture = "pistol_round";
    postureReason = "半场手枪局，采用独立的手枪对抗策略，不按没钱局处理。";
  } else if (isBrokenBuy) {
    posture = "broken_buy";
    postureReason = "队内贫富差明显，围绕 drop 和局部完整配置打破产混起。";
  } else if (explicitSaveContext && totalCash >= lowTeamCash && richEnoughForRifles <= 2) {
    posture = "save_play";
    postureReason = "上一回合已进入保枪/保经济上下文，本回合延续省钱策略。";
  } else if (awpReadyCount >= 2 && totalCash >= 35000) {
    posture = "double_awp";
    postureReason = "队内有双狙经济条件，允许双狙高配局。";
  } else if (awpReadyCount >= 1 && totalCash >= 32500 && roleAwpers.length > 0) {
    posture = "awp_buy";
    postureReason = "主狙经济到位，围绕 AWP 完整配置。";
  } else if (richEnoughForRifles >= Math.max(4, sortedAgents.length - 1) || (canLowRifle >= 4 && totalCash >= comfortTeamCash)) {
    posture = "rifle_buy";
    postureReason = "队伍已接近完整长枪线，按标准枪局处理。";
  } else if (postPistolFollowup && wonPreviousRound && totalCash >= lowTeamCash && totalCash < comfortTeamCash) {
    posture = "bonus_round";
    postureReason = "手枪局或上一局取胜后延续低成本武器，进入奖励局。";
  } else if (previousBonusCarry && lossCount <= 1 && totalCash >= 15000 && totalCash < comfortTeamCash) {
    posture = "bonus_round";
    postureReason = "上一回合取胜且保留低价枪，继续打 bonus。";
  } else if (input.states.every((state) => state.tokenBank <= cs2EconomyRules.initialMoney)) {
    posture = "full_eco";
    postureReason = "当前经济极低，进入兼容的全E态势。";
  } else if (input.states.every((state) => state.tokenBank <= 1500)) {
    posture = "eco";
    postureReason = "现金不足，只能以小E攒钱并争取下枪/安包收益。";
  } else if (postPistolFollowup && input.states.every((state) => state.tokenBank >= 1800 && state.tokenBank <= 2800)) {
    posture = "pistol_armor_force";
    postureReason = "手枪局后的强起窗口，允许手枪甲与局部激进购买。";
  } else if (input.states.every((state) => state.tokenBank >= 1200 && state.tokenBank <= 2200)) {
    posture = "pistol_armor_force";
    postureReason = "低额手枪甲区间，优先考虑手枪甲强起或局部保留。";
  } else if (canLowRifle >= 2 && totalCash >= lowTeamCash && totalCash < comfortTeamCash) {
    posture = "half_buy";
    postureReason = "当前回合能形成局部战斗力，同时为下一回合完整长枪保留余钱。";
  } else if (canContestWithForce) {
    posture = "force_buy";
    postureReason = "比分或回合窗口要求抢分，且当前现金足以支撑一次可执行的强起。";
  } else if (totalCash >= 9000 && totalCash < lowTeamCash) {
    posture = "light_buy";
    postureReason = "现金不足以组织完整长枪，但可以轻买控费并保留后手。";
  } else if (totalCash >= lowTeamCash && totalCash < comfortTeamCash) {
    posture = "light_buy";
    postureReason = "接近长枪线但不适合硬起，采用轻买/低配枪局。";
  } else {
    posture = totalCash >= 9000 ? "light_buy" : "eco";
    postureReason = totalCash >= 9000 ? "默认进入轻买控费态势。" : "默认进入小E积累经济。";
  }

  const agentSnapshots = sortedAgents.map((agent) => {
    const state = statesByAgentId.get(agent.id) ?? initialEconomy(agent, input.team.id, timestamp());
    return {
      agent,
      tokenBank: state.tokenBank,
      state
    };
  });
  const mutableCashByAgent = new Map(agentSnapshots.map((snapshot) => [snapshot.agent.id, snapshot.tokenBank] as const));
  const dropDecisions: DropDecision[] = [];
  if (posture === "rifle_buy" || posture === "awp_buy" || posture === "double_awp" || posture === "broken_buy") {
    const receivers = [...agentSnapshots]
      .filter((snapshot) => mutableCashByAgent.get(snapshot.agent.id)! < lowRifleThreshold)
      .sort((left, right) => mutableCashByAgent.get(left.agent.id)! - mutableCashByAgent.get(right.agent.id)!);
    const donors = [...agentSnapshots]
      .filter((snapshot) => mutableCashByAgent.get(snapshot.agent.id)! > richThreshold + 1200)
      .sort((left, right) => mutableCashByAgent.get(right.agent.id)! - mutableCashByAgent.get(left.agent.id)!);
    for (const receiver of receivers) {
      let deficit = lowRifleThreshold - (mutableCashByAgent.get(receiver.agent.id) ?? 0);
      for (const donor of donors) {
        if (deficit <= 0) {
          break;
        }
        if (donor.agent.id === receiver.agent.id) {
          continue;
        }
        const donorCash = mutableCashByAgent.get(donor.agent.id) ?? 0;
        const donorExcess = donorCash - richThreshold;
        if (donorExcess <= 0) {
          continue;
        }
        const transfer = Math.min(deficit, donorExcess);
        if (transfer <= 0) {
          continue;
        }
        mutableCashByAgent.set(donor.agent.id, donorCash - transfer);
        mutableCashByAgent.set(receiver.agent.id, (mutableCashByAgent.get(receiver.agent.id) ?? 0) + transfer);
        dropDecisions.push({
          fromAgentId: donor.agent.id,
          toAgentId: receiver.agent.id,
          amount: transfer,
          reason: posture === "awp_buy" || posture === "double_awp" ? "围绕长枪/AWP 完整度补枪" : "平衡 broken buy 与长枪线"
        });
        deficit -= transfer;
      }
    }
  }

  const decisions = agentSnapshots.map(({ agent, tokenBank, state }) => {
    const tokenBankAfterDrop = mutableCashByAgent.get(agent.id) ?? tokenBank;
    const dropSent = dropDecisions.filter((decision) => decision.fromAgentId === agent.id).reduce((sum, decision) => sum + decision.amount, 0);
    const dropReceived = dropDecisions.filter((decision) => decision.toAgentId === agent.id).reduce((sum, decision) => sum + decision.amount, 0);
    const agentDecision = decideAgentBuyDecision({
      agent,
      side: input.side,
      posture,
      tokenBankBefore: tokenBank,
      tokenBankAfterDrop,
      richThreshold,
      lowRifleThreshold,
      awpThreshold,
      hasDedicatedAwper: roleAwpers.length > 0
    });
    return {
      ...agentDecision,
      dropSent,
      dropReceived,
      notes: [...agentDecision.notes, ...(dropReceived > 0 ? ["收到队友 drop"] : []), ...(dropSent > 0 ? ["向队友发枪"] : [])]
    };
  });

  return {
    teamId: input.team.id,
    side: input.side,
    phase,
    lossCount,
    posture,
    postureReason,
    summaryBuyType: summarizeBuyTypeFromTeamPosture(posture, decisions),
    totalCash,
    dropDecisions,
    decisions
  };
}

function decideAgentBuyDecision(input: {
  agent: Agent;
  side: "attack" | "defense";
  posture: EconomyPosture;
  tokenBankBefore: number;
  tokenBankAfterDrop: number;
  richThreshold: number;
  lowRifleThreshold: number;
  awpThreshold: number;
  hasDedicatedAwper: boolean;
}): Omit<AgentBuyDecision, "dropSent" | "dropReceived"> {
  const isAwper = input.agent.role === "awper";
  const canAwp = isAwper && input.tokenBankAfterDrop >= input.awpThreshold;
  const canFullRifle = input.tokenBankAfterDrop >= input.richThreshold;
  const canLowRifle = input.tokenBankAfterDrop >= input.lowRifleThreshold;
  let buyType: BuyType;
  let economyPosture = input.posture;
  let loadoutPackage: LoadoutPackage;
  let spend: number;
  let notes: string[] = [];

  switch (input.posture) {
    case "pistol_round":
      buyType = "halfBuy";
      loadoutPackage = "pistol_round_pack";
      spend = Math.min(input.tokenBankAfterDrop, suggestedPistolRoundSpend(input.agent.role, input.side));
      notes = ["手枪局采用独立打法，不按没钱局处理。"];
      break;
    case "full_eco":
      buyType = "eco";
      loadoutPackage = "pistol_eco_pack";
      spend = Math.min(input.tokenBankAfterDrop, 200);
      break;
    case "eco":
      buyType = "eco";
      loadoutPackage = "pistol_eco_pack";
      spend = Math.min(input.tokenBankAfterDrop, 400);
      break;
    case "pistol_armor_force":
      if (shouldPrioritizePistolArmorForce(input.agent.role) || input.tokenBankAfterDrop >= 2600) {
        buyType = "forceBuy";
        loadoutPackage = "pistol_armor_force_pack";
        spend = Math.min(input.tokenBankAfterDrop, input.side === "attack" ? 1800 : 2000);
        notes = ["手枪甲强起窗口内优先给突破位和核心角色足够配置。"];
      } else {
        buyType = input.tokenBankAfterDrop >= 1500 ? "halfBuy" : "eco";
        economyPosture = input.tokenBankAfterDrop >= 1500 ? "pistol_armor_force" : "eco";
        loadoutPackage = input.tokenBankAfterDrop >= 1500 ? "pistol_armor_force_pack" : "pistol_eco_pack";
        spend = Math.min(input.tokenBankAfterDrop, input.tokenBankAfterDrop >= 1500 ? 1400 : 400);
        notes = ["手枪甲强起窗口内保持局部分化，不跟随全员硬起。"];
      }
      break;
    case "light_buy":
      if (canLowRifle) {
        buyType = "halfBuy";
        loadoutPackage = input.side === "attack" ? "rifle_low_t_pack" : "rifle_low_ct_pack";
        spend = Math.min(input.tokenBankAfterDrop, Math.max(1800, input.lowRifleThreshold - 200));
      } else if (input.tokenBankAfterDrop >= 1800) {
        buyType = "halfBuy";
        loadoutPackage = "pistol_armor_force_pack";
        spend = Math.min(input.tokenBankAfterDrop, input.side === "attack" ? 1800 : 2000);
      } else {
        buyType = "eco";
        economyPosture = "eco";
        loadoutPackage = "pistol_eco_pack";
        spend = Math.min(input.tokenBankAfterDrop, 400);
      }
      notes = ["轻买控费，不默认升级为全员强起"];
      break;
    case "force_buy":
      buyType = "forceBuy";
      loadoutPackage = canLowRifle ? (input.side === "attack" ? "rifle_low_t_pack" : "rifle_low_ct_pack") : "smg_force_pack";
      spend = Math.min(input.tokenBankAfterDrop, canLowRifle ? input.lowRifleThreshold : 3000);
      break;
    case "half_buy":
      buyType = "halfBuy";
      loadoutPackage = canLowRifle ? (input.side === "attack" ? "rifle_low_t_pack" : "rifle_low_ct_pack") : "pistol_armor_force_pack";
      spend = Math.min(input.tokenBankAfterDrop, canLowRifle ? input.lowRifleThreshold - 200 : 1800);
      notes = ["为下一回合完整长枪保留余钱"];
      break;
    case "bonus_round":
      buyType = "halfBuy";
      loadoutPackage = "bonus_carry_pack";
      spend = Math.min(input.tokenBankAfterDrop, 1800);
      notes = ["保留低价枪继续打 bonus"];
      break;
    case "rifle_buy":
      buyType = "fullBuy";
      loadoutPackage = input.side === "attack" ? "rifle_full_t_pack" : "rifle_full_ct_pack";
      spend = Math.min(input.tokenBankAfterDrop, input.richThreshold);
      break;
    case "awp_buy":
    case "double_awp":
      buyType = "fullBuy";
      if (canAwp) {
        loadoutPackage = "awp_pack";
        spend = Math.min(input.tokenBankAfterDrop, input.awpThreshold);
        notes = [input.posture === "double_awp" ? "双狙态势" : "围绕 AWP 配置"];
      } else if (canFullRifle) {
        loadoutPackage = input.side === "attack" ? "rifle_full_t_pack" : "rifle_full_ct_pack";
        spend = Math.min(input.tokenBankAfterDrop, input.richThreshold);
      } else {
        loadoutPackage = input.side === "attack" ? "rifle_low_t_pack" : "rifle_low_ct_pack";
        spend = Math.min(input.tokenBankAfterDrop, input.lowRifleThreshold);
      }
      break;
    case "broken_buy":
      if (canAwp && isAwper) {
        buyType = "fullBuy";
        loadoutPackage = "awp_pack";
        spend = Math.min(input.tokenBankAfterDrop, input.awpThreshold);
      } else if (canFullRifle) {
        buyType = "fullBuy";
        loadoutPackage = input.side === "attack" ? "rifle_full_t_pack" : "rifle_full_ct_pack";
        spend = Math.min(input.tokenBankAfterDrop, input.richThreshold);
      } else if (canLowRifle) {
        buyType = "forceBuy";
        loadoutPackage = "broken_buy_pack";
        spend = Math.min(input.tokenBankAfterDrop, input.lowRifleThreshold);
      } else {
        buyType = "eco";
        economyPosture = "eco";
        loadoutPackage = "broken_buy_pack";
        spend = Math.min(input.tokenBankAfterDrop, 500);
      }
      notes = ["队内经济不均，围绕 drop 拼配置"];
      break;
    case "save_play":
      buyType = "save";
      loadoutPackage = "save_support_pack";
      spend = Math.min(input.tokenBankAfterDrop, 600);
      notes = ["主动保枪/保经济"];
      break;
  }

  return {
    agentId: input.agent.id,
    teamId: input.agent.teamId,
    tokenBankBefore: input.tokenBankBefore,
    tokenBankAfterDrop: input.tokenBankAfterDrop,
    buyType,
    economyPosture,
    loadoutPackage,
    spend,
    outputBudget: outputBudgetForEconomyPosture(economyPosture),
    notes
  };
}

function summarizeBuyTypeFromTeamPosture(posture: EconomyPosture, decisions: AgentBuyDecision[]): BuyType {
  switch (posture) {
    case "pistol_round":
      return "halfBuy";
    case "full_eco":
    case "eco":
      return "eco";
    case "light_buy":
    case "half_buy":
    case "bonus_round":
      return "halfBuy";
    case "save_play":
      return "save";
    case "rifle_buy":
    case "awp_buy":
    case "double_awp":
      return "fullBuy";
    case "broken_buy":
      return decisions.filter((decision) => decision.buyType === "fullBuy").length >= 3 ? "halfBuy" : "forceBuy";
    default:
      return "forceBuy";
  }
}

function buildRoundEconomyOutcomeContext(input: {
  roundWinType: JudgeRoundWinType;
  winnerTeamId: string;
  loserTeamId: string;
  teamAId: string;
  teamBId: string;
  activeA: Agent[];
  activeB: Agent[];
  teamEconomyPlans: Record<string, TeamEconomyPlan>;
}): {
  winnerRewardByTeam: Record<string, number>;
  loserRewardByAgent: Record<string, number>;
  bonusRewardByAgent: Record<string, number>;
  survivorIds: Set<string>;
  agentNotesById: Record<string, string[]>;
} {
  const attackerTeamId = input.roundWinType.startsWith("attack_") ? input.winnerTeamId : input.loserTeamId;
  const defenderTeamId = attackerTeamId === input.teamAId ? input.teamBId : input.teamAId;
  const activeByTeam = {
    [input.teamAId]: sortAgentsForRound(input.activeA),
    [input.teamBId]: sortAgentsForRound(input.activeB)
  };
  const winnerReward =
    input.roundWinType === "attack_bomb_explosion" || input.roundWinType === "defense_defuse"
      ? cs2EconomyRules.roundWinBomb
      : cs2EconomyRules.roundWinStandard;
  const winnerRewardByTeam = {
    [input.winnerTeamId]: winnerReward
  } as Record<string, number>;
  const loserLossCount = input.teamEconomyPlans[input.loserTeamId]?.lossCount ?? 1;
  const defaultLoserReward = lossBonusForCount(loserLossCount);
  const loserRewardByAgent: Record<string, number> = Object.fromEntries(
    (activeByTeam[input.loserTeamId] ?? []).map((agent) => [agent.id, defaultLoserReward])
  );
  const bonusRewardByAgent: Record<string, number> = {};
  const survivorIds = new Set<string>();
  const agentNotesById: Record<string, string[]> = {};

  if (input.roundWinType === "attack_bomb_explosion") {
    const planter = activeByTeam[attackerTeamId]?.find((agent) => agent.role === "igl") ?? activeByTeam[attackerTeamId]?.[0];
    if (planter) {
      bonusRewardByAgent[planter.id] = (bonusRewardByAgent[planter.id] ?? 0) + cs2EconomyRules.objectiveActorReward;
      agentNotesById[planter.id] = [...(agentNotesById[planter.id] ?? []), "安包奖励 +300"];
    }
  }

  if (input.roundWinType === "defense_defuse") {
    const defuser = activeByTeam[defenderTeamId]?.find((agent) => agent.role === "support") ?? activeByTeam[defenderTeamId]?.[0];
    if (defuser) {
      bonusRewardByAgent[defuser.id] = (bonusRewardByAgent[defuser.id] ?? 0) + cs2EconomyRules.objectiveActorReward;
      agentNotesById[defuser.id] = [...(agentNotesById[defuser.id] ?? []), "拆包奖励 +300"];
    }
    for (const attacker of activeByTeam[attackerTeamId] ?? []) {
      bonusRewardByAgent[attacker.id] = (bonusRewardByAgent[attacker.id] ?? 0) + cs2EconomyRules.tPlantButDefusedTeamReward;
      agentNotesById[attacker.id] = [...(agentNotesById[attacker.id] ?? []), "安包被拆团队补偿 +600"];
    }
  }

  if (input.roundWinType === "defense_timeout_no_plant") {
    const losingPlan = input.teamEconomyPlans[attackerTeamId];
    const prioritizedSurvivors = (activeByTeam[attackerTeamId] ?? [])
      .filter((agent) => losingPlan?.decisions.find((decision) => decision.agentId === agent.id)?.economyPosture === "save_play");
    const designatedSurvivors =
      prioritizedSurvivors.length > 0 ? prioritizedSurvivors : (activeByTeam[attackerTeamId] ?? []).slice(0, 1);
    for (const survivor of designatedSurvivors) {
      survivorIds.add(survivor.id);
      loserRewardByAgent[survivor.id] = 0;
      agentNotesById[survivor.id] = [...(agentNotesById[survivor.id] ?? []), "T 超时存活：不拿失败奖金"];
    }
  }

  for (const winner of activeByTeam[input.winnerTeamId] ?? []) {
    survivorIds.add(winner.id);
  }

  return {
    winnerRewardByTeam,
    loserRewardByAgent,
    bonusRewardByAgent,
    survivorIds,
    agentNotesById
  };
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

function outputBudgetForEconomyPosture(posture: EconomyPosture): number {
  switch (posture) {
    case "pistol_round":
      return 260;
    case "full_eco":
      return 110;
    case "eco":
      return 180;
    case "pistol_armor_force":
      return 240;
    case "light_buy":
      return 280;
    case "force_buy":
      return 300;
    case "half_buy":
      return 380;
    case "bonus_round":
      return 420;
    case "rifle_buy":
      return 580;
    case "awp_buy":
      return 640;
    case "double_awp":
      return 660;
    case "broken_buy":
      return 320;
    case "save_play":
      return 120;
  }
}

function buildSubmittedAgentOutputs(input: {
  agentOutputs: AgentOutput[];
  buyDecisionByAgent: Map<string, AgentBuyDecision>;
}): SubmittedAgentOutput[] {
  return input.agentOutputs.map((output) => {
    const buyDecision = input.buyDecisionByAgent.get(output.agentId);
    const buyType = buyDecision?.buyType ?? "eco";
    const economyPosture = buyDecision?.economyPosture;
    const loadoutPackage = buyDecision?.loadoutPackage;
    const outputBudget = buyDecision?.outputBudget ?? outputBudgetForBuyType(buyType);
    return buildSubmittedAgentOutput(output, buyType, outputBudget, economyPosture, loadoutPackage);
  });
}

function buildSubmittedAgentOutput(
  output: AgentOutput,
  buyType: BuyType,
  outputBudget: number,
  economyPosture?: EconomyPosture,
  loadoutPackage?: LoadoutPackage
): SubmittedAgentOutput {
  const rawDetail = output.actionDetail;
  const budgetTier = outputGateTierForEconomyPosture(economyPosture ?? buyTypeToEconomyPosture(buyType));
  const omittedFields: string[] = [];
  const postureLabel = economyPosture ? formatEconomyPosture(economyPosture) : formatBuyType(buyType);
  const gateSummary = `Output Gate 已按${postureLabel}提交，预算 ${outputBudget}，Judge 只能消费 SubmittedOutput，不能读取被裁剪 RawOutput。`;
  const submittedDetail: AgentActionDecision | undefined = rawDetail
    ? {
        roundObjective: gateActionText(rawDetail.roundObjective, budgetTier),
        executionPlan: gateActionText(rawDetail.executionPlan, budgetTier),
        coordinationPlan: gateActionText(rawDetail.coordinationPlan, budgetTier),
        roleResponsibilityUsage: gateActionText(rawDetail.roleResponsibilityUsage, budgetTier),
        riskRead:
          budgetTier >= 2
            ? gateActionText(rawDetail.riskRead, budgetTier)
            : recordOmittedField("riskRead", omittedFields, "经济预算不足：风险判断被压缩，Judge 只能看到核心执行意图。"),
        contingencyPlan:
          budgetTier >= 3
            ? gateActionText(rawDetail.contingencyPlan, budgetTier)
            : recordOmittedField("contingencyPlan", omittedFields, "经济预算不足：备选方案被裁剪，Judge 不能把 RawOutput 中的完整备选路径当作证据。"),
        expectedContribution:
          budgetTier >= 2
            ? gateActionText(rawDetail.expectedContribution, budgetTier)
            : recordOmittedField("expectedContribution", omittedFields, "经济预算不足：预期贡献被压缩为核心目标和执行计划。"),
        confidence: output.confidence,
        ...(rawDetail.fingerprint ? { fingerprint: rawDetail.fingerprint } : {})
      }
    : undefined;

  return {
    ...output,
    id: `sub_${output.id}`,
    rawOutputId: output.id,
    submissionKind: "submitted_output",
    buyType,
    ...(economyPosture ? { economyPosture } : {}),
    ...(loadoutPackage ? { loadoutPackage } : {}),
    outputBudget,
    ...(submittedDetail ? { actionDetail: submittedDetail } : {}),
    ...(output.action ? { action: gateActionText(output.action, budgetTier) } : {}),
    omittedFields,
    gateSummary,
    rawFingerprint: `submitted_${output.rawFingerprint}`
  };
}

function outputGateTierForEconomyPosture(posture: EconomyPosture): number {
  switch (posture) {
    case "pistol_round":
      return 2;
    case "awp_buy":
    case "double_awp":
    case "rifle_buy":
      return 4;
    case "bonus_round":
    case "half_buy":
      return 3;
    case "broken_buy":
    case "force_buy":
    case "light_buy":
    case "pistol_armor_force":
      return 2;
    case "eco":
      return 1;
    case "full_eco":
    case "save_play":
      return 0;
  }
}

function buyTypeToEconomyPosture(buyType: BuyType): EconomyPosture {
  switch (buyType) {
    case "fullBuy":
      return "rifle_buy";
    case "halfBuy":
      return "half_buy";
    case "forceBuy":
      return "force_buy";
    case "eco":
      return "eco";
    case "save":
      return "save_play";
  }
}

function gateActionText(value: string, budgetTier: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  const maxChars = budgetTier >= 4 ? 420 : budgetTier === 3 ? 300 : budgetTier === 2 ? 220 : budgetTier === 1 ? 160 : 120;
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}…`;
}

function recordOmittedField(field: string, omittedFields: string[], replacement: string): string {
  omittedFields.push(field);
  return replacement;
}

function sumEconomyNetDeltaByTeam(items: AgentEconomyDelta[], teamId: string): number {
  return items.filter((item) => item.teamId === teamId).reduce((sum, item) => sum + item.afterTokenBank - item.beforeTokenBank, 0);
}

function sumEconomyDeltaByTeam(items: AgentEconomyDelta[], teamId: string): number {
  return items.filter((item) => item.teamId === teamId).reduce((sum, item) => sum + item.afterTokenBank, 0);
}

function sumEconomyByTeam(items: EconomyState[], teamId: string): number {
  return items.filter((item) => item.teamId === teamId).reduce((sum, item) => sum + item.tokenBank, 0);
}

function isPostPistolFollowupRound(roundNumber: number): boolean {
  return roundNumber === 2 || roundNumber === mr6MapRules.roundsPerHalf + 2;
}

function isPistolRound(roundNumber: number): boolean {
  return roundNumber === 1 || roundNumber === mr6MapRules.roundsPerHalf + 1;
}

function resolveRoundEconomyPhase(roundNumber: number): RoundEconomyPhase {
  if (isPistolRound(roundNumber)) {
    return "pistol_round";
  }
  if (isPostPistolFollowupRound(roundNumber)) {
    return "post_pistol";
  }
  return "gun_round";
}

function roundsRemainingInCurrentHalf(roundNumber: number): number {
  const offsetInHalf = ((roundNumber - 1) % mr6MapRules.roundsPerHalf) + 1;
  return mr6MapRules.roundsPerHalf - offsetInHalf;
}

function suggestedPistolRoundSpend(role: Agent["role"], side: "attack" | "defense"): number {
  if (role === "entry" || role === "star_rifler") {
    return side === "attack" ? 800 : 750;
  }
  if (role === "igl" || role === "support") {
    return 700;
  }
  if (role === "awper") {
    return 600;
  }
  return 650;
}

function shouldPrioritizePistolArmorForce(role: Agent["role"]): boolean {
  return role === "entry" || role === "star_rifler" || role === "igl";
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
const llmThinkingDisabledParams = {
  thinking: { type: "disabled" }
} satisfies Record<string, unknown>;
const llmThinkingEnabledParams = {
  thinking: { type: "enabled" },
  reasoning_effort: "high"
} satisfies Record<string, unknown>;

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
      throw new Error(`repair_invalid_agent_id: Team plan returned directive for inactive agent: ${agentId}`);
    }
  }
  for (const agentId of activeAgentIds) {
    if (!directiveAgentIdSet.has(agentId)) {
      throw new Error(`Team plan missed directive for active agent: ${agentId}`);
    }
  }
  if (input.plan.economyIntent?.buyIntentByAgent) {
    const intentAgentIds = input.plan.economyIntent.buyIntentByAgent.map((entry) => entry.agentId);
    const intentAgentSet = new Set(intentAgentIds);
    if (intentAgentSet.size !== intentAgentIds.length) {
      throw new Error(`Team plan returned duplicate economyIntent entries for ${input.teamId}`);
    }
    for (const agentId of intentAgentIds) {
      if (!activeAgentIds.has(agentId)) {
        throw new Error(`Team plan returned economyIntent for inactive agent: ${agentId}`);
      }
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
  rubricProfile?: JudgeRubricProfile;
  mapSemanticContext?: Record<string, unknown> | undefined;
}): JudgeResult {
  const proposition = readUnknownRecord(input.mapSemanticContext?.proposition);
  const parsedDiagnostic = judgeDiagnosticSchema.safeParse(
    materializeJudgeDiagnosticPayloadForEngine({
      diagnostic: input.judgeResult.diagnostic,
      reason: input.judgeResult.reason,
      roundNumber: input.roundNumber,
      mapSemanticContext: input.mapSemanticContext
    })
  );
  if (!parsedDiagnostic.success) {
    throw new Error("Judge diagnostic is required for Phase 2.0-pre real LLM rounds.");
  }

  const diagnostic: JudgeDiagnostic = {
    ...parsedDiagnostic.data,
    attackedOpportunityGap: expandThinJudgeDiagnosticField({
      label: "机会缺口",
      value: parsedDiagnostic.data.attackedOpportunityGap,
      fallback: parsedDiagnostic.data.decisiveEvidence,
      teamA: input.teamA,
      teamB: input.teamB
    }),
    defendedCoreProposition: expandThinJudgeDiagnosticField({
      label: "防守命题",
      value: parsedDiagnostic.data.defendedCoreProposition,
      fallback: parsedDiagnostic.data.decisiveEvidence,
      teamA: input.teamA,
      teamB: input.teamB
    })
  };
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
  validateJudgeScorecard({
    judgeResult: input.judgeResult,
    teamAId: input.teamA.id,
    teamBId: input.teamB.id,
    sideAssignment: input.sideAssignment,
    ...(input.rubricProfile ? { rubricProfile: input.rubricProfile } : {})
  });

  return {
    ...input.judgeResult,
    diagnostic
  };
}

function ensureStagedJudgeDiagnostic(input: {
  judgeResult: JudgeResult;
  roundNumber: number;
  sideAssignment: SideAssignment;
  teamA: Team;
  teamB: Team;
  teamPlans?: Record<string, TeamRoundPlanDecision>;
  agentOutputs?: AgentOutput[];
  rubricProfile?: JudgeRubricProfile;
  mapSemanticContext?: Record<string, unknown> | undefined;
}): JudgeResult {
  const normalizedJudgeResult = normalizeStagedJudgeResultForCommit(input.judgeResult, {
    teamA: input.teamA,
    teamB: input.teamB
  });
  return ensureJudgeDiagnostic({
    ...input,
    judgeResult: normalizedJudgeResult
  });
}

function normalizeStagedJudgeResultForCommit(judgeResult: JudgeResult, input: { teamA: Team; teamB: Team }): JudgeResult {
  const diagnostic = judgeResult.diagnostic;
  const judgeInference = judgeResult.judgeInference;
  if (!diagnostic || !judgeInference) {
    return judgeResult;
  }
  const decisiveEvidence = diagnostic.decisiveEvidence;
  return {
    ...judgeResult,
    reason: normalizeStagedJudgeNarrativeText(judgeResult.reason),
    judgeInference: {
      source: "judge_inference",
      boundary: judgeInference.boundary,
      csResolution: normalizeStagedJudgeNarrativeText(judgeInference.csResolution),
      combatNarrative: normalizeStagedJudgeNarrativeText(judgeInference.combatNarrative),
      evidenceBasis: judgeInference.evidenceBasis.map((item) => normalizeStagedJudgeNarrativeText(item))
    },
    ...(judgeResult.judgeScorecard
      ? { judgeScorecard: normalizeJudgeScorecardNarrativeText(judgeResult.judgeScorecard) }
      : {}),
      diagnostic: {
        ...diagnostic,
      attackedOpportunityGap: expandThinJudgeDiagnosticField({
        label: "机会缺口",
        value: diagnostic.attackedOpportunityGap,
        fallback: decisiveEvidence,
        teamA: input.teamA,
        teamB: input.teamB
      }),
      defendedCoreProposition: expandThinJudgeDiagnosticField({
        label: "防守命题",
        value: diagnostic.defendedCoreProposition,
        fallback: decisiveEvidence,
        teamA: input.teamA,
        teamB: input.teamB
      }),
      decisiveEvidence: normalizeStagedJudgeNarrativeText(decisiveEvidence),
      ...(diagnostic.zoneRelation
        ? {
            zoneRelation: {
              ...diagnostic.zoneRelation,
              relationSummary: normalizeStagedJudgeNarrativeText(diagnostic.zoneRelation.relationSummary),
              outcomeImpact: normalizeStagedJudgeNarrativeText(diagnostic.zoneRelation.outcomeImpact)
            }
          }
        : {})
      }
    };
}

function normalizeLegacyJudgeScorecardForReview(judgeResult: JudgeResult, input: {
  rubricProfile?: JudgeRubricProfile;
  sideAssignment: SideAssignment;
  teamAId: string;
  teamBId: string;
}): JudgeResult {
  if (judgeResult.judgeScorecard || !input.rubricProfile || !judgeResult.roundWinType) {
    return judgeResult;
  }
  return {
    ...judgeResult,
    judgeScorecard: buildDeterministicJudgeScorecard({
      rubricProfile: input.rubricProfile,
      winnerTeamId: judgeResult.winnerTeamId,
      loserTeamId: judgeResult.loserTeamId,
      teamAId: input.teamAId,
      teamBId: input.teamBId,
      sideAssignment: input.sideAssignment,
      margin: judgeResult.margin,
      roundWinType: judgeResult.roundWinType,
      reason: "judge_review 兼容旧结构时生成的确定性评分桥接。",
      source: "deterministic_fallback"
    })
  };
}

function expandThinJudgeDiagnosticField(input: {
  label: string;
  value: string;
  fallback: string;
  teamA: Team;
  teamB: Team;
}): string {
  const normalized = normalizeStagedJudgeNarrativeText(input.value);
  const hasActorCue = hasJudgeSideCue(normalized, input.teamA, input.teamB);
  const hasReasonCue = hasJudgeDiagnosticReasonCue(normalized);
  if (normalized.length >= 10 && hasActorCue && hasReasonCue) {
    return normalized;
  }
  if (normalized.length >= 10 && hasReasonCue) {
    return `${input.teamA.displayName} 与 ${input.teamB.displayName} 的攻防互动中，${normalized}`;
  }
  return `${input.label}：${normalized}。${normalizeStagedJudgeNarrativeText(input.fallback)}`;
}

function normalizeStagedJudgeNarrativeText(value: string): string {
  return value
    .replace(/未能完成下包/g, "未能完成包点控制")
    .replace(/完成下包|成功下包|下包成功/g, "完成包点控制")
    .replace(/至少两次关键击杀/g, "关键火力贡献")
    .replace(/至少两名/g, "多名")
    .trim();
}

function buildStagedJudgeReason(verdict: JudgeVerdictDecision, narrative: JudgeNarrativeDecision): string {
  const parts = [narrative.reason.trim()].filter((value) => value.length > 0);
  const additions = [
    typeof verdict.winnerReason === "string" && verdict.winnerReason.trim().length > 0
      ? `${verdict.winnerTeamId} 成功：${verdict.winnerReason.trim()}`
      : "",
    typeof verdict.loserFailureReason === "string" && verdict.loserFailureReason.trim().length > 0
      ? `${verdict.loserTeamId} 失败：${verdict.loserFailureReason.trim()}`
      : "",
    typeof verdict.attackedOpportunityGapText === "string" && verdict.attackedOpportunityGapText.trim().length > 0
      ? `机会缺口：${verdict.attackedOpportunityGapText.trim()}`
      : "",
    typeof verdict.defendedCorePropositionText === "string" && verdict.defendedCorePropositionText.trim().length > 0
      ? `守方命题：${verdict.defendedCorePropositionText.trim()}`
      : ""
  ].filter((value) => value.length > 0);
  for (const addition of additions) {
    const normalizedAddition = normalizeForJudgeReason(addition);
    if (!parts.some((part) => normalizeForJudgeReason(part).includes(normalizedAddition))) {
      parts.push(addition);
    }
  }
  return normalizeStagedJudgeNarrativeText(parts.join(" "));
}

function normalizeJudgeScorecardNarrativeText(scorecard: JudgeScorecard): JudgeScorecard {
  return {
    ...scorecard,
    teamScores: Object.fromEntries(
      Object.entries(scorecard.teamScores).map(([teamId, teamScore]) => [
        teamId,
        {
          ...teamScore,
          objectiveScore: normalizeJudgeScoreDimensionText(teamScore.objectiveScore),
          mapControlScore: normalizeJudgeScoreDimensionText(teamScore.mapControlScore),
          submissionQualityScore: normalizeJudgeScoreDimensionText(teamScore.submissionQualityScore),
          coordinationScore: normalizeJudgeScoreDimensionText(teamScore.coordinationScore),
          economyAdjustedScore: normalizeJudgeScoreDimensionText(teamScore.economyAdjustedScore),
          riskControlScore: normalizeJudgeScoreDimensionText(teamScore.riskControlScore),
          proofScore: normalizeJudgeScoreDimensionText(teamScore.proofScore)
        }
      ])
    ),
    roundWinTypeJustification: normalizeStagedJudgeNarrativeText(scorecard.roundWinTypeJustification),
    ...(scorecard.scoreOverride
      ? {
          scoreOverride: {
            ...scorecard.scoreOverride,
            reason: normalizeStagedJudgeNarrativeText(scorecard.scoreOverride.reason)
          }
        }
      : {})
  };
}

function normalizeJudgeScoreDimensionText<T extends { evidence: string }>(dimension: T): T {
  return {
    ...dimension,
    evidence: normalizeStagedJudgeNarrativeText(dimension.evidence)
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
  return /does not parse as JSON|invalid_enum_value|Expected array, received object|Expected string, received object|required|missing|diagnostic|decisiveEvidence|zoneRelation|roundWinType|judgeScorecard|rubricProfile|winnerFromScore|marginFromScore|totalScore/i.test(errorMessage);
}

function shouldUseLocalJudgeNarrativeFallback(errorMessage: string): boolean {
  return /reasoning_exhausted_empty_content|provider_empty_content|json_truncated|does not parse as JSON|invalid_response/i.test(
    errorMessage
  );
}

function shouldRetryStructuredJsonWithoutThinking(errorMessage: string): boolean {
  return /reasoning_exhausted_empty_content|provider_empty_content|json_truncated/i.test(errorMessage);
}

function buildLocalJudgeNarrativeFallbackResponse(input: {
  verdict: JudgeVerdictDecision;
  roundNumber: number;
  mapName: string;
  validationError: string;
}): LlmResponse<JudgeNarrativeDecision> {
  const narrative = normalizeJudgeNarrativeDecisionForVerdict(buildLocalJudgeNarrativeFallback(input), input.verdict);
  validateJudgeNarrativeAgainstVerdict(narrative, input.verdict);
  const rawText = JSON.stringify(narrative);
  return {
    data: narrative,
    rawText,
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    },
    providerDiagnostics: {
      finishReason: "local_fallback",
      contentLength: rawText.length,
      reasoningContentLength: 0,
      emptyContentWithReasoning: false,
      providerResponseShape: "local_judge_narrative_fallback"
    }
  };
}

function buildLocalJudgeNarrativeFallback(input: {
  verdict: JudgeVerdictDecision;
  roundNumber: number;
  mapName: string;
  validationError: string;
}): JudgeNarrativeDecision {
  const verdict = input.verdict;
  const winTypeText = describeJudgeRoundWinTypeForNarrative(verdict.roundWinType);
  const decisiveEvidence = truncatePromptText(verdict.diagnostic.decisiveEvidence, 180) || "裁判已锁定的维度证据";
  const defendedCore = truncatePromptText(verdict.diagnostic.defendedCoreProposition, 160) || "守方核心命题";
  const attackedGap = truncatePromptText(verdict.diagnostic.attackedOpportunityGap, 160) || "攻防机会缺口";
  const zoneText = `${verdict.diagnostic.mainAttackZoneId} / ${verdict.diagnostic.mainDefenseZoneId}`;
  const reason = `${input.mapName} 第 ${input.roundNumber} 回合，${verdict.winnerTeamId} 以${winTypeText}取胜。关键证据是：${decisiveEvidence}。${verdict.loserTeamId} 失败在于没有充分回应：${defendedCore}，也未能处理 ${attackedGap}。`;

  return {
    reason,
    judgeInference: {
      source: "judge_inference",
      boundary: "以下战斗和结果描述是裁判根据已锁定 verdict、区域关系、队伍计划和行动摘要作出的推断，不是 agent_action 原始事实。",
      csResolution: `${verdict.winnerTeamId} 以${winTypeText}完成本回合结算，MVP 为 ${verdict.mvpAgentId}。`,
      combatNarrative: `裁判推断本回合主要交汇区域为 ${zoneText}；胜负依据来自已锁定的 decisiveEvidence 与 scorecard 摘要，而不是重新改判。`,
      evidenceBasis: [
        `locked_verdict:${verdict.winnerTeamId}`,
        `round_win_type:${verdict.roundWinType}`,
        `main_zones:${zoneText}`,
        `fallback_reason:${truncatePromptText(input.validationError, 80)}`
      ]
    }
  };
}

function describeJudgeRoundWinTypeForNarrative(roundWinType: JudgeRoundWinType): string {
  switch (roundWinType) {
    case "attack_elimination":
      return "攻方收束";
    case "attack_bomb_explosion":
      return "攻方目标完成";
    case "defense_elimination":
      return "守方收束";
    case "defense_timeout_no_plant":
      return "守方拖住目标推进";
    case "defense_defuse":
      return "守方回收目标";
  }
}

function validateJudgeVerdictDecision(input: {
  verdict: JudgeVerdictDecision;
  teamAId: string;
  teamBId: string;
  activeTeamAAgentIds: string[];
  activeTeamBAgentIds: string[];
  sideAssignment: SideAssignment;
  rubricProfile?: JudgeRubricProfile;
  mapSemanticContext?: Record<string, unknown> | undefined;
}): JudgeVerdictDecision {
  const activeA = input.activeTeamAAgentIds.map((id) => promptAgentForValidation(id, input.teamAId));
  const activeB = input.activeTeamBAgentIds.map((id) => promptAgentForValidation(id, input.teamBId));
  validateJudgeResult({
    judgeResult: {
      ...input.verdict,
      reason: `${input.verdict.winnerTeamId} 成功执行 verdict；${input.verdict.loserTeamId} 失败在于 verdict 结构判定。`,
      judgeInference: {
        source: "judge_inference",
        boundary: "裁判推断边界占位，仅用于 verdict 结构校验，不作为最终判词。",
        csResolution: "verdict 结构校验。",
        combatNarrative: "verdict 结构校验。",
        evidenceBasis: ["verdict"]
      }
    },
    teamA: promptTeamForValidation(input.teamAId),
    teamB: promptTeamForValidation(input.teamBId),
    activeA,
    activeB,
    sideAssignment: input.sideAssignment
  });
  if (!input.verdict.diagnostic.zoneRelation) {
    throw new Error("Judge verdict diagnostic.zoneRelation is required.");
  }
  const validZoneIds = collectPhase18MapZoneIds(input.mapSemanticContext);
  if (validZoneIds.size > 0) {
    if (!validZoneIds.has(input.verdict.diagnostic.mainAttackZoneId)) {
      throw new Error(`Judge diagnostic mainAttackZoneId is not a valid map zone: ${input.verdict.diagnostic.mainAttackZoneId}`);
    }
    if (!validZoneIds.has(input.verdict.diagnostic.mainDefenseZoneId)) {
      throw new Error(`Judge diagnostic mainDefenseZoneId is not a valid map zone: ${input.verdict.diagnostic.mainDefenseZoneId}`);
    }
  }
  if (input.verdict.diagnostic.zoneRelation.attackZoneId !== input.verdict.diagnostic.mainAttackZoneId) {
    throw new Error("Judge verdict zoneRelation.attackZoneId must match mainAttackZoneId.");
  }
  if (input.verdict.diagnostic.zoneRelation.defenseZoneId !== input.verdict.diagnostic.mainDefenseZoneId) {
    throw new Error("Judge verdict zoneRelation.defenseZoneId must match mainDefenseZoneId.");
  }
  validateJudgeScorecard({
    judgeResult: input.verdict,
    teamAId: input.teamAId,
    teamBId: input.teamBId,
    sideAssignment: input.sideAssignment,
    ...(input.rubricProfile ? { rubricProfile: input.rubricProfile } : {})
  });
  return input.verdict;
}

function promptTeamForValidation(teamId: string): Team {
  return {
    id: teamId,
    tournamentId: "prompt_validation",
    displayName: teamId,
    shortName: teamId,
    seed: 1,
    createdAt: timestamp()
  };
}

function promptAgentForValidation(agentId: string, teamId: string): Agent {
  return {
    id: agentId,
    teamId,
    driverModelId: "prompt_validation_driver",
    role: "rifler",
    displayName: agentId,
    baseProfile: {
      personalitySummary: "prompt validation agent",
      tacticalSummary: "prompt validation agent",
      styleTags: []
    },
    currentState: "active",
    createdAt: timestamp()
  };
}

function validateJudgeNarrativeAgainstVerdict(narrative: JudgeNarrativeDecision, verdict: JudgeVerdictDecision): void {
  const combined = `${narrative.reason}\n${narrative.judgeInference.csResolution}\n${narrative.judgeInference.combatNarrative}`;
  if (!hasJudgeInferenceBoundaryMarker(narrative.judgeInference.boundary)) {
    throw new Error("Judge narrative judgeInference.boundary must mark combat details as judge inference.");
  }
  if (
    verdict.roundWinType !== "attack_bomb_explosion" &&
    verdict.roundWinType !== "defense_defuse" &&
    /(成功下包|完成下包|炸弹爆炸|引爆|拆包成功|完成拆包)/.test(combined)
  ) {
    throw new Error(`Judge narrative bomb wording conflicts with roundWinType ${verdict.roundWinType}.`);
  }
}

function normalizeJudgeNarrativeDecisionForVerdict(
  narrative: JudgeNarrativeDecision,
  verdict: JudgeVerdictDecision
): JudgeNarrativeDecision {
  const sanitizeText = (value: string) => sanitizeNarrativeTextForRoundWinType(value, verdict.roundWinType);
  return {
    reason: sanitizeText(narrative.reason),
    judgeInference: {
      source: "judge_inference",
      boundary: sanitizeText(normalizeJudgeInferenceBoundary(narrative.judgeInference.boundary)),
      csResolution: sanitizeText(narrative.judgeInference.csResolution),
      combatNarrative: sanitizeText(narrative.judgeInference.combatNarrative),
      evidenceBasis: narrative.judgeInference.evidenceBasis.map((item) => sanitizeText(item)).filter((item) => item.length > 0)
    }
  };
}

function normalizeJudgeInferenceBoundary(boundary: string): string {
  return boundary.trim();
}

function hasJudgeInferenceBoundaryMarker(value: string): boolean {
  return /(裁判.{0,16}推断|judge inference|合理推断|逻辑推断|反向推导|推导|结算层|不是\s*agent_action|非\s*agent_action|并非\s*agent_action|不是原始事实|非原始事实|非原始行动事实|未在输入中直接提供|未直接提供)/i.test(value);
}

function sanitizeNarrativeTextForRoundWinType(value: string, roundWinType: JudgeRoundWinType): string {
  if (roundWinType === "attack_bomb_explosion" || roundWinType === "defense_defuse") {
    return value;
  }
  return value
    .replace(/([AB])\s*点下包成功/g, "$1 点控制成功")
    .replace(/下包成功|成功下包|完成下包/g, "包点控制")
    .replace(/炸弹爆炸|成功引爆|引爆成功/g, "回合收束")
    .replace(/拆包成功|完成拆包/g, "防守收束");
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

const judgeScoreDimensionLabels: Record<JudgeScoreDimension, string> = {
  objectiveScore: "CS 目标完成度",
  mapControlScore: "地图区域控制",
  submissionQualityScore: "有效提交质量",
  coordinationScore: "团队协同",
  economyAdjustedScore: "经济调整价值",
  riskControlScore: "风险控制",
  proofScore: "命题证明"
};

const defenderThesisDimensionRequirements: JudgeDimensionRequirements = {
  objectiveScore: {
    challengeRequirement: "攻方是否明确攻击守方商业计划的关键漏洞，并把推进、清点、下包或转点转化为有效 challenge。",
    defenseRequirement: "守方是否守住商业计划的关键成立点，并通过拖时、回防、反清或拆解阻断攻方 challenge。"
  },
  mapControlScore: {
    challengeRequirement: "攻方是否打到与守方核心命题相关的主攻区、弱防区或转点路径。",
    defenseRequirement: "守方是否把资源部署在正确命题焦点区，并控制攻方进入关键论证区域。"
  },
  submissionQualityScore: {
    challengeRequirement: "攻方 SubmittedOutput 是否提出具体、可审计的 challenge，而不是泛泛反对。",
    defenseRequirement: "守方 SubmittedOutput 是否具体补强、解释或防住被挑战的商业计划。"
  },
  coordinationScore: {
    challengeRequirement: "攻方队内角色是否分工挑战守方 thesis 的不同漏洞。",
    defenseRequirement: "守方队内角色是否分工守住 thesis 的产品、用户、商业和执行闭环。"
  },
  economyAdjustedScore: {
    challengeRequirement: "攻方在当前经济和输出预算下，是否优先攻击守方最高价值漏洞。",
    defenseRequirement: "守方在当前经济和输出预算下，是否优先守住最关键成立点。"
  },
  riskControlScore: {
    challengeRequirement: "攻方是否避免稻草人式 challenge、错误攻击非核心点、过度冒进或超时。",
    defenseRequirement: "守方是否避免空泛防守、过度保守、漏掉真实漏洞或用大词掩盖断点。"
  },
  proofScore: {
    challengeRequirement: "攻方是否证明守方机会不真、痛点不足、切口不锋利、时机不对或执行不闭环。",
    defenseRequirement: "守方是否证明自身机会真实、痛点强、切口可打、时机可信且执行闭环。"
  }
};

const baseJudgeRubricWeights: JudgeScoreDimensionWeights = {
  objectiveScore: 1 / 7,
  mapControlScore: 1 / 7,
  submissionQualityScore: 1 / 7,
  coordinationScore: 1 / 7,
  economyAdjustedScore: 1 / 7,
  riskControlScore: 1 / 7,
  proofScore: 1 / 7
};

function buildJudgeRubricProfile(input: {
  mapName: string;
  roundNumber: number;
  sideAssignment: SideAssignment;
  teamEconomyPlans: Record<string, TeamEconomyPlan>;
  mapSemanticContext?: Record<string, unknown> | undefined;
  judgeRubricContext?: Record<string, unknown> | undefined;
}): JudgeRubricProfile {
  const proposition = readUnknownRecord(input.mapSemanticContext?.proposition);
  const subTheme = proposition ? resolvePhase18SubTheme(proposition, input.roundNumber) : undefined;
  const coreAxis = pickString(input.judgeRubricContext, "coreJudgmentAxis") ?? pickString(input.judgeRubricContext, "core_judgment_axis");
  const axisText = `${coreAxis ?? ""} ${pickString(proposition, "mapTheme") ?? ""} ${pickString(proposition, "map_theme") ?? ""}`;
  const mapEmphasis = axisText.includes("opportunity")
    ? (["mapControlScore", "proofScore"] as JudgeScoreDimension[])
    : (["objectiveScore", "submissionQualityScore"] as JudgeScoreDimension[]);
  const roundEmphasis = resolveRoundRubricEmphasis({
    roundNumber: input.roundNumber,
    subTheme,
    teamEconomyPlans: input.teamEconomyPlans
  });
  const weights = normalizeJudgeRubricWeights(applyJudgeRubricEmphasis(baseJudgeRubricWeights, [...mapEmphasis, ...roundEmphasis]));
  const reasonMustCover = [
    ...pickStringArray(input.judgeRubricContext, "reasonMustCover"),
    ...pickStringArray(input.judgeRubricContext, "reason_must_cover")
  ];
  const forbiddenBiases = [
    ...pickStringArray(input.judgeRubricContext, "biasGuardrails"),
    ...pickStringArray(input.judgeRubricContext, "bias_guardrails"),
    "历史连胜偏置",
    "比分领先偏置",
    "防守命题天然成立偏置",
    "节目效果追分偏置"
  ];
  const roundPhase = resolveRoundEconomyPhase(input.roundNumber);
  return judgeRubricProfileSchema.parse({
    profileId: `rubric_${safeId(input.mapName)}_r${input.roundNumber}_${stableHex(JSON.stringify({ subTheme, coreAxis, roundPhase })).slice(0, 8)}`,
    baseVersion: "baseJudgeRubric-v1",
    dimensions: [...judgeScoreDimensions],
    dimensionWeights: weights,
    mapAdjustment: {
      source: "judgeRubricContext",
      applied: Boolean(coreAxis || input.judgeRubricContext),
      summary: coreAxis
        ? `地图裁判轴 ${coreAxis} 调整评分重点，强调 ${mapEmphasis.map((dimension) => judgeScoreDimensionLabels[dimension]).join("、")}。`
        : "未发现地图专属裁判轴，使用全局基础评分根基。",
      emphasizedDimensions: mapEmphasis
    },
    roundAdjustment: {
      source: "currentSubTheme",
      subTheme: subTheme ?? "默认回合子命题",
      summary: buildRoundRubricAdjustmentSummary({
        roundNumber: input.roundNumber,
        subTheme,
        roundPhase,
        emphasizedDimensions: roundEmphasis
      }),
      emphasizedDimensions: roundEmphasis
    },
    evidenceRequirements: [
      ...reasonMustCover,
      "必须分别引用双方 team_plan 与 SubmittedOutput。",
      "必须说明经济只如何影响 economyAdjustedScore，不能作为隐藏胜负补偿。",
      "必须说明攻方目标推进与守方核心命题在同一评分根基下如何比较。"
    ],
    forbiddenBiases: [...new Set(forbiddenBiases)]
  });
}

function resolveRoundRubricEmphasis(input: {
  roundNumber: number;
  subTheme?: string | undefined;
  teamEconomyPlans: Record<string, TeamEconomyPlan>;
}): JudgeScoreDimension[] {
  const phase = resolveRoundEconomyPhase(input.roundNumber);
  if (phase === "pistol_round") {
    return ["objectiveScore", "coordinationScore"];
  }
  const postures = Object.values(input.teamEconomyPlans).map((plan) => plan.posture);
  if (postures.every((posture) => posture === "rifle_buy" || posture === "awp_buy" || posture === "double_awp")) {
    return ["submissionQualityScore", "proofScore"];
  }
  const subTheme = (input.subTheme ?? "").toLowerCase();
  if (/risk|风险|reset|破产|force|强起/.test(subTheme)) {
    return ["riskControlScore", "economyAdjustedScore"];
  }
  return ["objectiveScore", "proofScore"];
}

function applyJudgeRubricEmphasis(
  baseWeights: JudgeScoreDimensionWeights,
  emphasizedDimensions: JudgeScoreDimension[]
): JudgeScoreDimensionWeights {
  const emphasized = new Set(emphasizedDimensions);
  const entries = Object.fromEntries(
    judgeScoreDimensions.map((dimension) => [
      dimension,
      baseWeights[dimension] * (emphasized.has(dimension) ? 1.2 : 1)
    ])
  ) as JudgeScoreDimensionWeights;
  return entries;
}

function normalizeJudgeRubricWeights(weights: JudgeScoreDimensionWeights): JudgeScoreDimensionWeights {
  const total = judgeScoreDimensions.reduce((sum, dimension) => sum + weights[dimension], 0);
  return Object.fromEntries(
    judgeScoreDimensions.map((dimension) => [dimension, roundJudgeScore(weights[dimension] / total, 4)])
  ) as JudgeScoreDimensionWeights;
}

function buildRoundRubricAdjustmentSummary(input: {
  roundNumber: number;
  subTheme?: string | undefined;
  roundPhase: string;
  emphasizedDimensions: JudgeScoreDimension[];
}): string {
  const emphasis = input.emphasizedDimensions.map((dimension) => judgeScoreDimensionLabels[dimension]).join("、");
  return `R${input.roundNumber} ${input.subTheme ?? "默认子命题"} / ${input.roundPhase}：本回合重点检查 ${emphasis}。`;
}

function validateJudgeScorecard(input: {
  judgeResult: Pick<JudgeResult, "winnerTeamId" | "margin" | "roundWinType" | "judgeScorecard">;
  teamAId: string;
  teamBId: string;
  sideAssignment: SideAssignment;
  rubricProfile?: JudgeRubricProfile;
}): void {
  const scorecard = input.judgeResult.judgeScorecard;
  if (!scorecard) {
    throw new Error("Judge scorecard is required for Phase 2.0-pre v6 verdicts.");
  }
  if (input.rubricProfile && JSON.stringify(scorecard.rubricProfile) !== JSON.stringify(input.rubricProfile)) {
    throw new Error("Judge scorecard rubricProfile must match the code-generated rubricProfile.");
  }
  validateJudgeRubricProfile(scorecard.rubricProfile);

  const expectedTeamIds = [input.teamAId, input.teamBId];
  for (const teamId of expectedTeamIds) {
    const teamScore = scorecard.teamScores[teamId];
    if (!teamScore) {
      throw new Error(`Judge scorecard missing team score for ${teamId}.`);
    }
    if (teamScore.teamId !== teamId) {
      throw new Error(`Judge scorecard team score key ${teamId} conflicts with teamId ${teamScore.teamId}.`);
    }
    const expectedSide = teamId === input.sideAssignment.attackingTeamId ? "attack" : "defense";
    if (teamScore.side !== expectedSide) {
      throw new Error(`Judge scorecard side for ${teamId} must be ${expectedSide}.`);
    }
    const expectedTotal = calculateWeightedJudgeScore(teamScore, scorecard.rubricProfile.dimensionWeights);
    if (Math.abs(teamScore.totalScore - expectedTotal) > 0.16) {
      throw new Error(`Judge scorecard totalScore for ${teamId} must equal weighted dimension scores.`);
    }
    for (const dimension of judgeScoreDimensions) {
      const evidence = teamScore[dimension].evidence.trim();
      if (evidence.length < 8) {
        throw new Error(`Judge scorecard ${dimension} evidence for ${teamId} is too thin.`);
      }
      if (teamScore[dimension].evidenceSource === "public_history") {
        throw new Error(`Judge scorecard ${dimension} must not use public history as direct scoring evidence.`);
      }
    }
  }

  const teamAScore = scorecard.teamScores[input.teamAId];
  const teamBScore = scorecard.teamScores[input.teamBId];
  if (!teamAScore || !teamBScore) {
    throw new Error("Judge scorecard must include both team scores.");
  }
  const teamATotal = teamAScore.totalScore;
  const teamBTotal = teamBScore.totalScore;
  const expectedWinner = teamATotal >= teamBTotal ? input.teamAId : input.teamBId;
  const expectedDelta = roundJudgeScore(Math.abs(teamATotal - teamBTotal), 2);
  const expectedMargin = deriveJudgeMarginFromScoreDelta(expectedDelta);
  if (scorecard.winnerFromScore !== expectedWinner) {
    throw new Error("Judge scorecard winnerFromScore must be the team with the higher totalScore.");
  }
  if (input.judgeResult.winnerTeamId !== scorecard.winnerFromScore && !scorecard.scoreOverride?.applied) {
    throw new Error("Judge winnerTeamId must match judgeScorecard.winnerFromScore.");
  }
  if (Math.abs(scorecard.scoreDelta - expectedDelta) > 0.16) {
    throw new Error("Judge scorecard scoreDelta must equal the totalScore difference.");
  }
  if (scorecard.marginFromScore !== expectedMargin) {
    throw new Error("Judge scorecard marginFromScore must be derived from scoreDelta.");
  }
  if (input.judgeResult.margin !== scorecard.marginFromScore && !scorecard.scoreOverride?.applied) {
    throw new Error("Judge margin must match judgeScorecard.marginFromScore.");
  }
  if (scorecard.decisiveDimensions.some((dimension) => !judgeScoreDimensions.includes(dimension))) {
    throw new Error("Judge scorecard decisiveDimensions contains an unknown dimension.");
  }
  if (input.judgeResult.roundWinType) {
    validateJudgeScorecardWinType({
      scorecard,
      roundWinType: input.judgeResult.roundWinType,
      sideAssignment: input.sideAssignment
    });
  }
}

function validateJudgeRubricProfile(profile: JudgeRubricProfile): void {
  const dimensions = new Set(profile.dimensions);
  if (dimensions.size !== judgeScoreDimensions.length || judgeScoreDimensions.some((dimension) => !dimensions.has(dimension))) {
    throw new Error("Judge rubricProfile dimensions must exactly match baseJudgeRubric-v1.");
  }
  const total = judgeScoreDimensions.reduce((sum, dimension) => sum + profile.dimensionWeights[dimension], 0);
  if (Math.abs(total - 1) > 0.02) {
    throw new Error("Judge rubricProfile dimensionWeights must sum to 1.");
  }
  const baseWeight = 1 / judgeScoreDimensions.length;
  for (const dimension of judgeScoreDimensions) {
    const weight = profile.dimensionWeights[dimension];
    if (weight < baseWeight * 0.8 - 0.01 || weight > baseWeight * 1.2 + 0.03) {
      throw new Error(`Judge rubricProfile weight for ${dimension} exceeds the ±20% adjustment boundary.`);
    }
  }
}

function calculateWeightedJudgeScore(
  teamScore: JudgeScorecard["teamScores"][string],
  weights: JudgeScoreDimensionWeights
): number {
  return roundJudgeScore(
    judgeScoreDimensions.reduce((sum, dimension) => sum + teamScore[dimension].score * weights[dimension], 0),
    2
  );
}

function deriveJudgeMarginFromScoreDelta(delta: number): JudgeResult["margin"] {
  if (delta < 0.75) {
    return "narrow";
  }
  if (delta < 2) {
    return "standard";
  }
  return "decisive";
}

function validateJudgeScorecardWinType(input: {
  scorecard: JudgeScorecard;
  roundWinType?: JudgeRoundWinType;
  sideAssignment: SideAssignment;
}): void {
  if (!input.roundWinType) {
    return;
  }
  const winnerSide = input.scorecard.winnerFromScore === input.sideAssignment.attackingTeamId ? "attack" : "defense";
  if (!input.roundWinType.startsWith(`${winnerSide}_`)) {
    throw new Error("Judge scorecard winnerFromScore conflicts with roundWinType side.");
  }
}

function roundJudgeScore(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function compactDefenderThesisContext(context: DefenderThesisContext | undefined): unknown {
  if (!context) {
    return undefined;
  }
  return {
    attackingTeamId: context.attackingTeamId,
    defendingTeamId: context.defendingTeamId,
    half: context.half,
    defenderTeamThesis: context.defenderTeamThesis,
    defenderMustHoldClaims: context.defenderMustHoldClaims.slice(0, 3),
    defenderPrimaryZoneId: context.defenderPrimaryZoneId,
    attackerChallengeBrief: context.attackerChallengeBrief,
    attackerPrimaryZoneId: context.attackerPrimaryZoneId,
    roundSubTheme: context.roundSubTheme,
    allowedCanonicalZoneIds: context.allowedCanonicalZoneIds,
    thesisEvidenceSources: context.thesisEvidenceSources.slice(0, 4)
  };
}

function compactJudgeRubricProfile(profile: JudgeRubricProfile | undefined): unknown {
  if (!profile) {
    return undefined;
  }
  return {
    profileId: profile.profileId,
    baseVersion: profile.baseVersion,
    dimensions: profile.dimensions,
    dimensionWeights: profile.dimensionWeights,
    mapAdjustment: {
      applied: profile.mapAdjustment.applied,
      summary: profile.mapAdjustment.summary,
      emphasizedDimensions: profile.mapAdjustment.emphasizedDimensions
    },
    roundAdjustment: {
      subTheme: profile.roundAdjustment.subTheme,
      summary: profile.roundAdjustment.summary,
      emphasizedDimensions: profile.roundAdjustment.emphasizedDimensions
    },
    evidenceRequirements: profile.evidenceRequirements.slice(0, 4),
    forbiddenBiases: profile.forbiddenBiases.slice(0, 4)
  };
}

function materializeJudgeVerdictPayload(input: {
  payload: unknown;
  rubricProfile?: JudgeRubricProfile;
  defenderThesisContext?: DefenderThesisContext | undefined;
  teamAId: string;
  teamBId: string;
  activeTeamAAgentIds: string[];
  activeTeamBAgentIds: string[];
  sideAssignment: SideAssignment;
  roundNumber: number;
  mapSemanticContext?: Record<string, unknown> | undefined;
}): unknown {
  const record = readUnknownRecord(input.payload);
  if (!record) {
    return input.payload;
  }
  const winnerTeamId = materializeJudgeTeamId(record.winnerTeamId ?? record.winnerPromptTeamId, input) ?? materializeJudgeTeamId(record.winner, input);
  const loserTeamId =
    materializeJudgeTeamId(record.loserTeamId ?? record.loserPromptTeamId, input) ??
    (winnerTeamId === input.teamAId ? input.teamBId : winnerTeamId === input.teamBId ? input.teamAId : undefined);
  const winnerActiveAgentIds = winnerTeamId === input.teamAId ? input.activeTeamAAgentIds : winnerTeamId === input.teamBId ? input.activeTeamBAgentIds : [];
  const roundWinType = normalizeJudgeRoundWinType(record.roundWinType) ?? inferJudgeRoundWinTypeFromWinner(winnerTeamId, input.sideAssignment);
  const margin = normalizeJudgeMargin(record.margin) ?? "standard";
  const draftLike = isJudgeVerdictDraftLike(record);
  const materializedDiagnostic = materializeJudgeDiagnosticPayloadForEngine({
    diagnostic: record.diagnostic,
    draft: record,
    reason: record.reason,
    roundNumber: input.roundNumber,
    mapSemanticContext: input.mapSemanticContext,
    allowDraftFallback: draftLike
  });
  const materializedRecord = {
    ...record,
    ...(winnerTeamId ? { winnerTeamId } : {}),
    ...(loserTeamId ? { loserTeamId } : {}),
    ...(roundWinType ? { roundWinType } : {}),
    margin,
    attackWinConditionMet:
      normalizeJudgeBoolean(record.attackWinConditionMet) ?? (roundWinType ? roundWinType.startsWith("attack_") : winnerTeamId === input.sideAssignment.attackingTeamId),
    defenseWinConditionMet:
      normalizeJudgeBoolean(record.defenseWinConditionMet) ?? (roundWinType ? roundWinType.startsWith("defense_") : winnerTeamId === input.sideAssignment.defendingTeamId),
    mvpAgentId: normalizeCoachTimeoutText(record.mvpAgentId) ?? winnerActiveAgentIds[0] ?? input.activeTeamAAgentIds[0] ?? input.activeTeamBAgentIds[0],
    confidence: typeof record.confidence === "number" && Number.isFinite(record.confidence) ? Math.min(1, Math.max(0, record.confidence)) : 0.65,
    ...(materializedDiagnostic !== undefined ? { diagnostic: materializedDiagnostic } : {})
  };
  return materializeJudgeVerdictScorecardPayload({
    payload: materializedRecord,
    teamAId: input.teamAId,
    teamBId: input.teamBId,
    activeTeamAAgentIds: input.activeTeamAAgentIds,
    activeTeamBAgentIds: input.activeTeamBAgentIds,
    sideAssignment: input.sideAssignment,
    defenderThesisContext: input.defenderThesisContext,
    ...(input.rubricProfile ? { rubricProfile: input.rubricProfile } : {})
  });
}

function isJudgeVerdictDraftLike(record: Record<string, unknown>): boolean {
  return (
    record.winnerPromptTeamId !== undefined ||
    record.loserPromptTeamId !== undefined ||
    record.attackedOpportunityGapText !== undefined ||
    record.defendedCorePropositionText !== undefined ||
    record.decisiveEvidenceText !== undefined ||
    record.winnerReason !== undefined ||
    record.loserFailureReason !== undefined ||
    Array.isArray(record.zoneFocusCandidates)
  );
}

function materializeJudgeTeamId(value: unknown, input: { teamAId: string; teamBId: string }): string | undefined {
  const text = normalizeCoachTimeoutText(value);
  if (!text) {
    return undefined;
  }
  const normalized = text.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (text === input.teamAId || ["team_a", "teamalpha", "team_alpha", "alpha", "prompt_team_a"].includes(normalized)) {
    return input.teamAId;
  }
  if (text === input.teamBId || ["team_b", "teambravo", "team_bravo", "bravo", "prompt_team_b"].includes(normalized)) {
    return input.teamBId;
  }
  return undefined;
}

function inferJudgeRoundWinTypeFromWinner(winnerTeamId: string | undefined, sideAssignment: SideAssignment): JudgeRoundWinType | undefined {
  if (winnerTeamId === sideAssignment.attackingTeamId) {
    return "attack_elimination";
  }
  if (winnerTeamId === sideAssignment.defendingTeamId) {
    return "defense_elimination";
  }
  return undefined;
}

function materializeJudgeDiagnosticPayloadForEngine(input: {
  diagnostic: unknown;
  draft?: Record<string, unknown>;
  reason?: unknown;
  roundNumber: number;
  mapSemanticContext?: Record<string, unknown> | undefined;
  allowDraftFallback?: boolean;
}): unknown {
  const record = readUnknownRecord(input.diagnostic);
  if (!record && !input.allowDraftFallback) {
    return input.diagnostic;
  }
  const diagnosticRecord = record ?? {};
  const draft = input.draft ?? {};
  const proposition = readUnknownRecord(input.mapSemanticContext?.proposition);
  const expectedSubTheme = proposition ? resolvePhase18SubTheme(proposition, input.roundNumber) : undefined;
  const validZoneIds = collectPhase18MapZoneIds(input.mapSemanticContext);
  const zoneRelationRecord = readUnknownRecord(diagnosticRecord.zoneRelation);
  const zoneFocusCandidates = input.allowDraftFallback && Array.isArray(draft.zoneFocusCandidates) ? draft.zoneFocusCandidates : [];
  const mainAttackZoneId = pickMaterializedJudgeZoneId(
    [diagnosticRecord.mainAttackZoneId, zoneRelationRecord?.attackZoneId, ...zoneFocusCandidates],
    validZoneIds,
    "buyer_mid",
    input.allowDraftFallback === true
  );
  const mainDefenseZoneId = pickMaterializedJudgeZoneId(
    [diagnosticRecord.mainDefenseZoneId, zoneRelationRecord?.defenseZoneId, ...zoneFocusCandidates],
    validZoneIds,
    mainAttackZoneId ?? "buyer_mid",
    input.allowDraftFallback === true
  );
  const decisiveEvidence =
    (input.allowDraftFallback ? normalizeCoachTimeoutText(draft.decisiveEvidenceText) : undefined) ??
    normalizeCoachTimeoutText(diagnosticRecord.decisiveEvidence) ??
    (input.allowDraftFallback ? normalizeCoachTimeoutText(draft.winnerReason) ?? normalizeCoachTimeoutText(input.reason) : undefined) ??
    (input.allowDraftFallback ? "裁判根据双方提交内容、战术碰撞和回合语义完成胜负物化。" : undefined);
  return {
    currentSubTheme: expectedSubTheme ?? normalizeCoachTimeoutText(diagnosticRecord.currentSubTheme) ?? (input.allowDraftFallback ? "默认回合子命题" : undefined),
    attackedOpportunityGap:
      (input.allowDraftFallback ? normalizeCoachTimeoutText(draft.attackedOpportunityGapText) : undefined) ??
      normalizeCoachTimeoutText(diagnosticRecord.attackedOpportunityGap) ??
      (input.allowDraftFallback ? normalizeCoachTimeoutText(draft.winnerReason) : undefined) ??
      decisiveEvidence,
    defendedCoreProposition:
      (input.allowDraftFallback ? normalizeCoachTimeoutText(draft.defendedCorePropositionText) : undefined) ??
      normalizeCoachTimeoutText(diagnosticRecord.defendedCoreProposition) ??
      (input.allowDraftFallback ? normalizeCoachTimeoutText(draft.loserFailureReason) : undefined) ??
      decisiveEvidence,
    mainAttackZoneId,
    mainDefenseZoneId,
    zoneRelation: zoneRelationRecord
      ? normalizeJudgeZoneRelationPayload(
          diagnosticRecord.zoneRelation,
          decisiveEvidence,
          mainAttackZoneId && mainDefenseZoneId
            ? {
                attackZoneId: mainAttackZoneId,
                defenseZoneId: mainDefenseZoneId
              }
            : undefined
        )
      : input.allowDraftFallback
        ? {
          attackZoneId: mainAttackZoneId ?? "buyer_mid",
          defenseZoneId: mainDefenseZoneId ?? mainAttackZoneId ?? "buyer_mid",
          relationType: mainAttackZoneId === mainDefenseZoneId ? "same_focus" : "cross_hit",
          relationSummary: decisiveEvidence ?? "攻守焦点存在结构关系。",
          outcomeImpact: decisiveEvidence ?? "攻守焦点影响本回合胜负。"
        }
        : undefined,
    decisiveEvidence
  };
}

function pickMaterializedJudgeZoneId(values: unknown[], validZoneIds: Set<string>, fallback: string, allowFallback: boolean): string | undefined {
  for (const value of values) {
    const normalized = normalizeJudgeZoneId(value) ?? normalizeCoachTimeoutText(value);
    if (normalized && (validZoneIds.size === 0 || validZoneIds.has(normalized))) {
      return normalized;
    }
    if (normalized && validZoneIds.size > 0 && !validZoneIds.has(normalized)) {
      return normalized;
    }
  }
  if (!allowFallback) {
    return undefined;
  }
  if (validZoneIds.size === 0 || validZoneIds.has(fallback)) {
    return fallback;
  }
  return validZoneIds.values().next().value ?? fallback;
}

function materializeJudgeVerdictScorecardPayload(input: {
  payload: unknown;
  rubricProfile?: JudgeRubricProfile;
  defenderThesisContext?: DefenderThesisContext | undefined;
  teamAId: string;
  teamBId: string;
  activeTeamAAgentIds?: string[];
  activeTeamBAgentIds?: string[];
  sideAssignment: SideAssignment;
}): unknown {
  const record = readUnknownRecord(input.payload);
  if (!record || !input.rubricProfile) {
    return input.payload;
  }
  const fullScorecardParse = judgeScorecardSchemaSafeParse(record.judgeScorecard);
  const proposedMargin = normalizeJudgeMargin(record.margin) ?? fullScorecardParse?.marginFromScore;
  const winnerTeamId = typeof record.winnerTeamId === "string" ? record.winnerTeamId : undefined;
  const loserTeamId = typeof record.loserTeamId === "string" ? record.loserTeamId : undefined;
  const margin = proposedMargin;
  const roundWinType = normalizeJudgeRoundWinType(record.roundWinType);
  if (!winnerTeamId || !loserTeamId || !margin || !roundWinType) {
    return input.payload;
  }
  const source: JudgeScorecardSource = "evidence_materialized_from_draft";
  const judgeScorecard = buildCodeCompletedJudgeScorecard({
      source,
      lightweightScorecard: readUnknownRecord(record.judgeScorecard) ? record.judgeScorecard : { teamScores: record.teamScores },
      rubricProfile: input.rubricProfile,
      winnerTeamId,
      loserTeamId,
      teamAId: input.teamAId,
      teamBId: input.teamBId,
      sideAssignment: input.sideAssignment,
      defenderThesisContext: input.defenderThesisContext,
      margin,
      roundWinType,
      reason: normalizeCoachTimeoutText(readUnknownRecord(record.diagnostic)?.decisiveEvidence) ?? "LLM 裁判未返回完整评分表，代码按 verdict 事实补齐审计结构。"
  });
  const finalWinnerTeamId = judgeScorecard.winnerFromScore;
  const finalLoserTeamId = finalWinnerTeamId === input.teamAId ? input.teamBId : input.teamAId;
  const finalRoundWinType = normalizeRoundWinTypeForWinner(roundWinType, finalWinnerTeamId, input.sideAssignment);
  const candidateWinnerOverridden = finalWinnerTeamId !== winnerTeamId;
  const finalMvpAgentId =
    finalWinnerTeamId === input.teamAId
      ? input.activeTeamAAgentIds?.[0]
      : finalWinnerTeamId === input.teamBId
        ? input.activeTeamBAgentIds?.[0]
        : undefined;
  const candidateMvpAgentId = typeof record.mvpAgentId === "string" ? record.mvpAgentId : undefined;
  const candidateMvpOverridden = Boolean(finalMvpAgentId && candidateMvpAgentId !== finalMvpAgentId);
  const finalJudgeScorecard = candidateWinnerOverridden
    ? {
        ...judgeScorecard,
        normalizedFieldNotes: [
          ...(judgeScorecard.normalizedFieldNotes ?? []),
          `LLM candidate winner ${winnerTeamId}; code materialized winner ${finalWinnerTeamId} from judgeScorecard totals.`
        ]
      }
    : candidateMvpOverridden
      ? {
        ...judgeScorecard,
        normalizedFieldNotes: [
          ...(judgeScorecard.normalizedFieldNotes ?? []),
          `LLM candidate mvpAgentId ${candidateMvpAgentId}; code materialized MVP ${finalMvpAgentId} from final winner roster.`
        ]
      }
    : judgeScorecard;
  return {
    ...record,
    winnerTeamId: finalWinnerTeamId,
    loserTeamId: finalLoserTeamId,
    margin: judgeScorecard.marginFromScore,
    roundWinType: finalRoundWinType,
    attackWinConditionMet: finalRoundWinType.startsWith("attack_"),
    defenseWinConditionMet: finalRoundWinType.startsWith("defense_"),
    ...(finalMvpAgentId ? { mvpAgentId: finalMvpAgentId } : {}),
    ...(candidateWinnerOverridden || candidateMvpOverridden
      ? {
          ...(candidateWinnerOverridden ? { candidateWinnerTeamId: winnerTeamId } : {}),
          normalizedFieldNotes: [
            ...((Array.isArray(record.normalizedFieldNotes) ? record.normalizedFieldNotes : []) as string[]),
            ...(candidateWinnerOverridden
              ? [`LLM candidate winner ${winnerTeamId}; code materialized winner ${finalWinnerTeamId} from judgeScorecard totals.`]
              : []),
            ...(candidateMvpOverridden
              ? [`LLM candidate mvpAgentId ${candidateMvpAgentId}; code materialized MVP ${finalMvpAgentId} from final winner roster.`]
              : [])
          ]
        }
      : {}),
    judgeScorecard: finalJudgeScorecard
  };
}

function normalizeRoundWinTypeForWinner(
  roundWinType: JudgeRoundWinType,
  winnerTeamId: string,
  sideAssignment: SideAssignment
): JudgeRoundWinType {
  if (winnerTeamId === sideAssignment.attackingTeamId) {
    return roundWinType.startsWith("attack_") ? roundWinType : "attack_elimination";
  }
  if (winnerTeamId === sideAssignment.defendingTeamId) {
    return roundWinType.startsWith("defense_") ? roundWinType : "defense_elimination";
  }
  return roundWinType;
}

function judgeScorecardSchemaSafeParse(value: unknown): JudgeScorecard | undefined {
  const result = judgeScorecardSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

function buildCodeCompletedJudgeScorecard(input: {
  source: JudgeScorecardSource;
  lightweightScorecard: unknown;
  rubricProfile: JudgeRubricProfile;
  winnerTeamId: string;
  loserTeamId: string;
  teamAId: string;
  teamBId: string;
  sideAssignment: SideAssignment;
  defenderThesisContext?: DefenderThesisContext | undefined;
  margin: JudgeResult["margin"];
  roundWinType: JudgeRoundWinType;
  reason: string;
}): JudgeScorecard {
  const fallback = buildEvidenceMaterializedFallbackJudgeScorecard({
    rubricProfile: input.rubricProfile,
    winnerTeamId: input.winnerTeamId,
    loserTeamId: input.loserTeamId,
    teamAId: input.teamAId,
    teamBId: input.teamBId,
    sideAssignment: input.sideAssignment,
    defenderThesisContext: input.defenderThesisContext,
    margin: input.margin,
    roundWinType: input.roundWinType,
    reason: input.reason,
    source: input.source
  });
  const lightweightScores = readUnknownRecord(readUnknownRecord(input.lightweightScorecard)?.teamScores);
  if (!lightweightScores) {
    return fallback;
  }
  const teamScores = { ...fallback.teamScores };
  for (const teamId of [input.teamAId, input.teamBId]) {
    const rawTeamScore = readUnknownRecord(lightweightScores[teamId]);
    if (!rawTeamScore) {
      continue;
    }
    const baseTeamScore = teamScores[teamId];
    if (!baseTeamScore) {
      continue;
    }
    const completedTeamScore = { ...baseTeamScore };
    for (const dimension of judgeScoreDimensions) {
      const rawDimension = readUnknownRecord(rawTeamScore[dimension]);
      const score = typeof rawDimension?.score === "number" ? Math.max(0, Math.min(10, rawDimension.score)) : undefined;
      const evidence = normalizeCoachTimeoutText(rawDimension?.evidence);
      const evidenceSource = normalizeJudgeScoreEvidenceSource(rawDimension?.evidenceSource);
      completedTeamScore[dimension] = {
        score: score ?? baseTeamScore[dimension].score,
        evidence: evidence && evidence.length >= 8 ? evidence : baseTeamScore[dimension].evidence,
        evidenceSource: evidenceSource ?? baseTeamScore[dimension].evidenceSource
      };
    }
    completedTeamScore.totalScore = calculateWeightedJudgeScore(completedTeamScore, input.rubricProfile.dimensionWeights);
    teamScores[teamId] = completedTeamScore;
  }
  const teamATotal = teamScores[input.teamAId]?.totalScore ?? 0;
  const teamBTotal = teamScores[input.teamBId]?.totalScore ?? 0;
  const winnerFromScore = teamATotal >= teamBTotal ? input.teamAId : input.teamBId;
  const scoreDelta = roundJudgeScore(Math.abs(teamATotal - teamBTotal), 2);
  const marginFromScore = deriveJudgeMarginFromScoreDelta(scoreDelta);
  const loserFromScore = winnerFromScore === input.teamAId ? input.teamBId : input.teamAId;
  const decisiveDimensions = deriveJudgeDecisiveDimensions(teamScores[winnerFromScore], teamScores[loserFromScore]);
  return {
    ...fallback,
    ...(input.defenderThesisContext ? { defenderThesisContext: input.defenderThesisContext } : {}),
    teamScores,
    scoreDelta,
    winnerFromScore,
    marginFromScore,
    decisiveDimensions,
    scorecardSource: input.source,
    ...(input.margin !== marginFromScore ? { llmProposedMargin: input.margin } : {}),
    normalizedFieldNotes: [
      ...(input.margin !== marginFromScore ? [`LLM proposed margin ${input.margin}; code derived ${marginFromScore} from scoreDelta.`] : [])
    ]
  };
}

function buildEvidenceMaterializedFallbackJudgeScorecard(input: {
  rubricProfile: JudgeRubricProfile;
  winnerTeamId: string;
  loserTeamId: string;
  teamAId: string;
  teamBId: string;
  sideAssignment: SideAssignment;
  defenderThesisContext?: DefenderThesisContext | undefined;
  margin: JudgeResult["margin"];
  roundWinType: JudgeRoundWinType;
  reason: string;
  source: JudgeScorecardSource;
}): JudgeScorecard {
  const winnerDimensionScores: Record<JudgeScoreDimension, number> = {
    objectiveScore: 6.25,
    mapControlScore: 6.05,
    submissionQualityScore: 6.35,
    coordinationScore: 6.15,
    economyAdjustedScore: 5.9,
    riskControlScore: 6,
    proofScore: 6.3
  };
  const loserDimensionScores: Record<JudgeScoreDimension, number> = {
    objectiveScore: 5.95,
    mapControlScore: 5.8,
    submissionQualityScore: 5.9,
    coordinationScore: 5.85,
    economyAdjustedScore: 5.75,
    riskControlScore: 5.8,
    proofScore: 5.9
  };
  const buildTeamScore = (teamId: string, scores: Record<JudgeScoreDimension, number>) => {
    const side = teamId === input.sideAssignment.attackingTeamId ? "attack" : "defense";
    const teamScore = {
      teamId,
      side,
      objectiveScore: buildEvidenceMaterializedFallbackDimension(scores.objectiveScore, "round_context", "胜利目标证据不足，使用中性目标维度补齐。"),
      mapControlScore: buildEvidenceMaterializedFallbackDimension(scores.mapControlScore, "zone_relation", "区域控制证据不足，使用中性地图维度补齐。"),
      submissionQualityScore: buildEvidenceMaterializedFallbackDimension(scores.submissionQualityScore, "submitted_output", "提交质量证据不足，使用中性提交维度补齐。"),
      coordinationScore: buildEvidenceMaterializedFallbackDimension(scores.coordinationScore, "team_plan", "协同证据不足，使用中性协同维度补齐。"),
      economyAdjustedScore: buildEvidenceMaterializedFallbackDimension(scores.economyAdjustedScore, "economy", "经济约束证据不足，只在经济维度中性补齐。"),
      riskControlScore: buildEvidenceMaterializedFallbackDimension(scores.riskControlScore, "round_context", "风险控制证据不足，使用中性风险维度补齐。"),
      proofScore: buildEvidenceMaterializedFallbackDimension(scores.proofScore, "judge_rubric_context", "证明强度证据不足，使用中性证明维度补齐。"),
      totalScore: 0
    } satisfies JudgeScorecard["teamScores"][string];
    return {
      ...teamScore,
      totalScore: calculateWeightedJudgeScore(teamScore, input.rubricProfile.dimensionWeights)
    };
  };
  const teamScores = {
    [input.winnerTeamId]: buildTeamScore(input.winnerTeamId, winnerDimensionScores),
    [input.loserTeamId]: buildTeamScore(input.loserTeamId, loserDimensionScores)
  };
  const teamATotal = teamScores[input.teamAId]?.totalScore ?? 0;
  const teamBTotal = teamScores[input.teamBId]?.totalScore ?? 0;
  const winnerFromScore = teamATotal >= teamBTotal ? input.teamAId : input.teamBId;
  const loserFromScore = winnerFromScore === input.teamAId ? input.teamBId : input.teamAId;
  const scoreDelta = roundJudgeScore(Math.abs(teamATotal - teamBTotal), 2);
  return {
    scorecardSource: input.source,
    ...(input.defenderThesisContext ? { defenderThesisContext: input.defenderThesisContext } : {}),
    rubricProfile: input.rubricProfile,
    teamScores,
    scoreDelta,
    winnerFromScore,
    marginFromScore: deriveJudgeMarginFromScoreDelta(scoreDelta),
    decisiveDimensions: deriveJudgeDecisiveDimensions(teamScores[winnerFromScore], teamScores[loserFromScore]),
    roundWinTypeJustification: `${input.roundWinType} 来自语义草稿；维度分缺失时使用中性证据 fallback，不使用固定胜方模板。`,
    ...(input.margin !== deriveJudgeMarginFromScoreDelta(scoreDelta) ? { llmProposedMargin: input.margin } : {}),
    normalizedFieldNotes: ["LLM draft did not provide usable teamScores; code used neutral evidence fallback instead of fixed winner/loser template."]
  };
}

function buildEvidenceMaterializedFallbackDimension(
  score: number,
  evidenceSource: JudgeScorecard["teamScores"][string][JudgeScoreDimension]["evidenceSource"],
  evidence: string
): JudgeScorecard["teamScores"][string][JudgeScoreDimension] {
  return {
    score,
    evidence,
    evidenceSource
  };
}

function normalizeJudgeScoreEvidenceSource(value: unknown): JudgeScorecard["teamScores"][string][JudgeScoreDimension]["evidenceSource"] | undefined {
  const sourceValue = Array.isArray(value) ? value.find((item) => normalizeJudgeScoreEvidenceSource(item)) : value;
  const normalized = normalizeCoachTimeoutText(sourceValue)?.trim();
  switch (normalized) {
    case "submitted_output":
    case "economy":
    case "zone_relation":
    case "map_semantic_context":
    case "judge_rubric_context":
    case "round_context":
    case "combat_resolution":
    case "team_plan":
      return normalized;
    case "roleResponsibilities":
    case "role_responsibilities":
    case "player_directives":
    case "teamPlan":
      return "team_plan";
    case "buyTypesByTeam":
    case "buy_types_by_team":
    case "economyContextByTeam":
    case "economy_context_by_team":
      return "economy";
    case "riskRead":
    case "risk_read":
    case "sideAssignment":
    case "side_assignment":
      return "round_context";
    case "agent_action":
    case "agentAction":
      return "submitted_output";
    default:
      return undefined;
  }
}

function deriveJudgeDecisiveDimensions(
  winnerScore: JudgeScorecard["teamScores"][string] | undefined,
  loserScore: JudgeScorecard["teamScores"][string] | undefined
): JudgeScoreDimension[] {
  if (!winnerScore || !loserScore) {
    return ["objectiveScore"];
  }
  return [...judgeScoreDimensions]
    .sort((left, right) => winnerScore[right].score - loserScore[right].score - (winnerScore[left].score - loserScore[left].score))
    .slice(0, 2);
}

function buildDeterministicJudgeScorecard(input: {
  rubricProfile: JudgeRubricProfile;
  winnerTeamId: string;
  loserTeamId: string;
  teamAId: string;
  teamBId: string;
  sideAssignment: SideAssignment;
  defenderThesisContext?: DefenderThesisContext | undefined;
  margin: JudgeResult["margin"];
  roundWinType: JudgeRoundWinType;
  reason: string;
  source?: JudgeScorecardSource;
}): JudgeScorecard {
  const delta = input.margin === "decisive" ? 2.1 : input.margin === "standard" ? 1.15 : 0.5;
  const winnerScore = input.margin === "decisive" ? 7.8 : input.margin === "standard" ? 7.1 : 6.6;
  const loserScore = roundJudgeScore(winnerScore - delta, 2);
  const buildTeamScore = (teamId: string, totalScore: number) => {
    const side = teamId === input.sideAssignment.attackingTeamId ? "attack" : "defense";
    return {
      teamId,
      side,
      objectiveScore: buildDeterministicJudgeDimension(totalScore, "round_context", input.reason),
      mapControlScore: buildDeterministicJudgeDimension(totalScore, "zone_relation", input.reason),
      submissionQualityScore: buildDeterministicJudgeDimension(totalScore, "submitted_output", input.reason),
      coordinationScore: buildDeterministicJudgeDimension(totalScore, "team_plan", input.reason),
      economyAdjustedScore: buildDeterministicJudgeDimension(totalScore, "economy", input.reason),
      riskControlScore: buildDeterministicJudgeDimension(totalScore, "round_context", input.reason),
      proofScore: buildDeterministicJudgeDimension(totalScore, "judge_rubric_context", input.reason),
      totalScore
    } satisfies JudgeScorecard["teamScores"][string];
  };
  const teamScores = {
    [input.winnerTeamId]: buildTeamScore(input.winnerTeamId, winnerScore),
    [input.loserTeamId]: buildTeamScore(input.loserTeamId, loserScore)
  };
  return {
    ...(input.source ? { scorecardSource: input.source } : {}),
    ...(input.defenderThesisContext ? { defenderThesisContext: input.defenderThesisContext } : {}),
    rubricProfile: input.rubricProfile,
    teamScores,
    scoreDelta: delta,
    winnerFromScore: input.winnerTeamId,
    marginFromScore: input.margin,
    decisiveDimensions: ["objectiveScore", "proofScore"],
    roundWinTypeJustification: `${input.roundWinType} 由本地确定性评分与显式 fallback 胜法保持一致。`
  };
}

function buildDeterministicJudgeDimension(
  score: number,
  evidenceSource: JudgeScorecard["teamScores"][string][JudgeScoreDimension]["evidenceSource"],
  reason: string
): JudgeScorecard["teamScores"][string][JudgeScoreDimension] {
  return {
    score,
    evidence: `确定性 fallback 依据：${reason}`,
    evidenceSource
  };
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
  const hasReasonCue = hasJudgeDiagnosticReasonCue(normalized);
  if (!hasActorCue || !hasReasonCue) {
    throw new Error(`${input.label} must name the side and explain why the gap or proposition matters.`);
  }
}

function hasJudgeDiagnosticReasonCue(value: string): boolean {
  return /(因为|导致|暴露|说明|证明|未能|使得|通过|从而|意味着|形成|守住|失守|验证|瞄准|漏洞|缺口|击穿|突破|覆盖|主攻|显示|阻止|转化|防护|间隙|集中)/.test(
    value
  );
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
  const hasInferenceBoundary = hasJudgeInferenceBoundaryMarker(inferenceText);
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
    !/(彻底|完全|明确|显著|决定性|decisively|decisive|full\s*wipe|团灭|全歼|清场|引爆|爆炸|下包爆炸|拆包)/i.test(
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

  for (const [zoneId, displayName] of Object.entries({ ...phase18DefaultZoneDisplayNames, ...(displayZoneNames ?? {}) })) {
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

const phase18DefaultZoneDisplayNames: Record<string, string> = {
  spawn_a: "T 出生点",
  spawn_b: "CT 出生点",
  buyer_mid: "中路",
  conversion_site_a: "A 点",
  conversion_site_b: "B 点",
  pricing_ramp: "A 大",
  retention_connector: "A 小",
  token_economy: "B 洞"
};

function mentionsZone(normalizedReason: string, zoneId: string, displayName: unknown): boolean {
  if (mentionsNormalizedZoneAlias(normalizedReason, normalizeForJudgeReason(zoneId))) {
    return true;
  }
  if (typeof displayName === "string" && mentionsNormalizedZoneAlias(normalizedReason, normalizeForJudgeReason(displayName))) {
    return true;
  }
  return phase18ZoneMentionAliases(zoneId).some((alias) =>
    mentionsNormalizedZoneAlias(normalizedReason, normalizeForJudgeReason(alias))
  );
}

function phase18ZoneMentionAliases(zoneId: string): string[] {
  switch (zoneId) {
    case "conversion_site_a":
      return ["A区", "A 区", "A点", "A 点", "A包点", "A 包点", "A site"];
    case "conversion_site_b":
      return ["B区", "B 区", "B点", "B 点", "B包点", "B 包点", "B site"];
    default:
      return [];
  }
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

function buildDefenderThesisContextForJudge(input: {
  roundNumber: number;
  sideAssignment: SideAssignment;
  promptSideAssignment: SideAssignment;
  teamA: Team;
  teamB: Team;
  teamPlans?: Record<string, TeamRoundPlanDecision> | undefined;
  mapSemanticContext?: Record<string, unknown> | undefined;
  replacements: Array<{ source: string; target: string }>;
}): DefenderThesisContext {
  const attackingTeam = input.sideAssignment.attackingTeamId === input.teamA.id ? input.teamA : input.teamB;
  const defendingTeam = input.sideAssignment.defendingTeamId === input.teamA.id ? input.teamA : input.teamB;
  const attackerPlan = input.teamPlans?.[attackingTeam.id];
  const defenderPlan = input.teamPlans?.[defendingTeam.id];
  const defenderProposal = readTeamInitialProposalSummary(defendingTeam);
  const proposition = readUnknownRecord(input.mapSemanticContext?.proposition);
  const roundSubTheme = proposition ? resolvePhase18SubTheme(proposition, input.roundNumber) : undefined;
  const defenderPrimaryZoneId = normalizeJudgeZoneId(defenderPlan?.primaryZoneId) ?? "conversion_site_a";
  const attackerPrimaryZoneId = normalizeJudgeZoneId(attackerPlan?.primaryZoneId) ?? "buyer_mid";
  const defenderTeamThesis = sanitizeJudgeText(
    defenderProposal?.teamThesis ?? `${defendingTeam.displayName} 的本半场商业计划必须经受攻方挑战。`,
    input.replacements
  );
  const defenderMustHoldClaims = (defenderProposal?.mustHoldClaims?.length
    ? defenderProposal.mustHoldClaims
    : [defenderPlan?.winCondition ?? "守方必须守住当前商业计划的核心成立点。"]
  ).map((claim) => sanitizeJudgeText(claim, input.replacements));
  const attackerChallengeBrief = sanitizeJudgeText(
    `${attackingTeam.displayName} 本回合不是证明自己的独立商业计划，而是围绕 ${defendingTeam.displayName} 的守方 thesis 发起 challenge：${attackerPlan?.primaryIntent ?? attackerPlan?.winCondition ?? "攻击守方核心成立点的机会缺口。"}`,
    input.replacements
  );

  return defenderThesisContextSchema.parse({
    attackingTeamId: input.promptSideAssignment.attackingTeamId,
    defendingTeamId: input.promptSideAssignment.defendingTeamId,
    half: input.sideAssignment.half,
    defenderTeamThesis,
    defenderMustHoldClaims,
    defenderPrimaryZoneId,
    attackerChallengeBrief,
    attackerPrimaryZoneId,
    roundSubTheme: roundSubTheme ?? "默认回合子命题",
    allowedCanonicalZoneIds: [...REQUIRED_TACTICAL_ZONE_IDS],
    thesisEvidenceSources: ["team_plan", "submitted_output", "zone_relation", "economy", "judge_rubric_context", "map_semantic_context"],
    dimensionRequirements: defenderThesisDimensionRequirements
  });
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
    teamEconomyPlans: Record<string, TeamEconomyPlan>;
    mapSemanticContext?: Record<string, unknown> | undefined;
    teamPlans?: Record<string, TeamRoundPlanDecision> | undefined;
    agentOutputs: AgentOutput[];
    tacticalCollision?: TacticalCollision;
    recentPublicRoundSummaries: string[];
    rubricProfile?: JudgeRubricProfile;
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
  const judgeEvidenceDigest = buildJudgeEvidenceDigest({
    agentOutputs: input.agentOutputs,
    promptTeamIdByActualTeamId,
    promptAgentIdByActualAgentId,
    replacements: sanitizeReplacements
  });
  const defenderThesisContext = buildDefenderThesisContextForJudge({
    roundNumber: input.roundNumber,
    sideAssignment: input.sideAssignment,
    promptSideAssignment,
    teamA: input.teamA,
    teamB: input.teamB,
    teamPlans: input.teamPlans,
    mapSemanticContext: input.mapSemanticContext,
    replacements: sanitizeReplacements
  });
  const evaluationEntries: Phase18JudgePromptContext["requestInput"]["evaluationOrder"] = [
    buildJudgeEvaluationEntry({
      teamId: promptTeamA.id,
      teamName: promptTeamA.displayName,
      activeAgents: promptActiveA,
      initialProposalSummary: sanitizeJudgeRecord(stripJudgePrestigeFields(readTeamInitialProposalSummary(input.teamA)), sanitizeReplacements),
      coachContext: sanitizeJudgeRecord(stripJudgePrestigeFields(readTeamHeadCoachProfile(input.teamA)), sanitizeReplacements),
      teamPlan: promptTeamPlans?.[promptTeamA.id]
    }),
    buildJudgeEvaluationEntry({
      teamId: promptTeamB.id,
      teamName: promptTeamB.displayName,
      activeAgents: promptActiveB,
      initialProposalSummary: sanitizeJudgeRecord(stripJudgePrestigeFields(readTeamInitialProposalSummary(input.teamB)), sanitizeReplacements),
      coachContext: sanitizeJudgeRecord(stripJudgePrestigeFields(readTeamHeadCoachProfile(input.teamB)), sanitizeReplacements),
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
      economyContextByTeam: {
        [promptTeamA.id]: {
          posture: input.teamEconomyPlans[input.teamA.id]?.posture ?? "eco",
          lossCount: input.teamEconomyPlans[input.teamA.id]?.lossCount ?? 1,
          totalCash: input.teamEconomyPlans[input.teamA.id]?.totalCash ?? 0,
          postureReason: input.teamEconomyPlans[input.teamA.id]?.postureReason ?? "默认经济态势。"
        },
        [promptTeamB.id]: {
          posture: input.teamEconomyPlans[input.teamB.id]?.posture ?? "eco",
          lossCount: input.teamEconomyPlans[input.teamB.id]?.lossCount ?? 1,
          totalCash: input.teamEconomyPlans[input.teamB.id]?.totalCash ?? 0,
          postureReason: input.teamEconomyPlans[input.teamB.id]?.postureReason ?? "默认经济态势。"
        }
      },
      competitiveParityNote: buildCompetitiveParityNote(input.teamEconomyPlans),
      recentPublicRoundRecapPolicy:
        "公开历史摘要只用于说明比分、胜法和经济阶段，不得把连胜、连败或旧回合叙事直接当作当前回合的强弱证明。",
      defenderThesisContext,
      ...(input.rubricProfile ? { rubricProfile: input.rubricProfile } : {}),
      ...(input.tacticalCollision ? { tacticalCollision: sanitizeJudgeValue(input.tacticalCollision, sanitizeReplacements) as TacticalCollision } : {}),
      evaluationOrder,
      teamAId: promptTeamA.id,
      teamBId: promptTeamB.id,
      teamAName: promptTeamA.displayName,
      teamBName: promptTeamB.displayName,
      activeTeamAAgentIds: promptActiveA.map((agent) => agent.id),
      activeTeamBAgentIds: promptActiveB.map((agent) => agent.id),
      judgeEvidenceDigest,
      recentPublicRoundSummaries: input.recentPublicRoundSummaries.map((summary) => sanitizeJudgeText(summary, sanitizeReplacements))
    },
    ...(input.teamPlans ? { actualTeamPlans: input.teamPlans } : {}),
    actualAgentOutputs: input.agentOutputs,
    validateAndTranslate: (judgeResult: JudgeResult) => {
      const promptMvpMaterializedJudgeResult = materializeJudgePromptMvpAgentId({
        judgeResult,
        teamA: promptTeamA,
        teamB: promptTeamB,
        activeA: promptActiveA,
        activeB: promptActiveB
      });
      const promptValidated = validateJudgeResult({
        judgeResult: promptMvpMaterializedJudgeResult,
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
        ...(promptValidated.judgeScorecard
          ? { judgeScorecard: desanitizeJudgeScorecard(promptValidated.judgeScorecard, actualTeamIdByPromptTeamId, desanitizeReplacements) }
          : {}),
        ...(promptValidated.diagnostic
          ? { diagnostic: desanitizeJudgeDiagnostic(promptValidated.diagnostic, desanitizeReplacements) }
          : {})
      };
    },
    translatePromptText: (value: string) => desanitizeJudgeText(value, desanitizeReplacements)
  };
}

function materializeJudgePromptMvpAgentId(input: {
  judgeResult: JudgeResult;
  teamA: Team;
  teamB: Team;
  activeA: Agent[];
  activeB: Agent[];
}): JudgeResult {
  const winnerAgents =
    input.judgeResult.winnerTeamId === input.teamA.id
      ? input.activeA
      : input.judgeResult.winnerTeamId === input.teamB.id
        ? input.activeB
        : [];
  if (winnerAgents.some((agent) => agent.id === input.judgeResult.mvpAgentId)) {
    return input.judgeResult;
  }
  const fallbackMvpAgentId = winnerAgents[0]?.id;
  if (!fallbackMvpAgentId) {
    return input.judgeResult;
  }
  const note = `LLM candidate mvpAgentId ${input.judgeResult.mvpAgentId}; code materialized MVP ${fallbackMvpAgentId} from final winner roster.`;
  return {
    ...input.judgeResult,
    mvpAgentId: fallbackMvpAgentId,
    ...(input.judgeResult.judgeScorecard
      ? {
          judgeScorecard: {
            ...input.judgeResult.judgeScorecard,
            normalizedFieldNotes: [...(input.judgeResult.judgeScorecard.normalizedFieldNotes ?? []), note]
          }
        }
      : {})
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

function desanitizeJudgeScorecard(
  scorecard: JudgeScorecard,
  actualTeamIdByPromptTeamId: Map<string, string>,
  replacements: Array<{ source: string; target: string }>
): JudgeScorecard {
  const teamScores = Object.fromEntries(
    Object.entries(scorecard.teamScores).map(([promptTeamId, teamScore]) => {
      const actualTeamId = actualTeamIdByPromptTeamId.get(promptTeamId) ?? teamScore.teamId;
      return [
        actualTeamId,
        {
          ...teamScore,
          teamId: actualTeamId,
          objectiveScore: desanitizeJudgeScoreDimension(teamScore.objectiveScore, replacements),
          mapControlScore: desanitizeJudgeScoreDimension(teamScore.mapControlScore, replacements),
          submissionQualityScore: desanitizeJudgeScoreDimension(teamScore.submissionQualityScore, replacements),
          coordinationScore: desanitizeJudgeScoreDimension(teamScore.coordinationScore, replacements),
          economyAdjustedScore: desanitizeJudgeScoreDimension(teamScore.economyAdjustedScore, replacements),
          riskControlScore: desanitizeJudgeScoreDimension(teamScore.riskControlScore, replacements),
          proofScore: desanitizeJudgeScoreDimension(teamScore.proofScore, replacements)
        }
      ];
    })
  );
  return {
    ...scorecard,
    ...(scorecard.defenderThesisContext
      ? {
          defenderThesisContext: desanitizeDefenderThesisContext(
            scorecard.defenderThesisContext,
            actualTeamIdByPromptTeamId,
            replacements
          )
        }
      : {}),
    teamScores,
    winnerFromScore: actualTeamIdByPromptTeamId.get(scorecard.winnerFromScore) ?? scorecard.winnerFromScore,
    roundWinTypeJustification: normalizeChineseFirstJudgeText(desanitizeJudgeText(scorecard.roundWinTypeJustification, replacements)),
    ...(scorecard.scoreOverride
      ? {
          scoreOverride: {
            ...scorecard.scoreOverride,
            reason: normalizeChineseFirstJudgeText(desanitizeJudgeText(scorecard.scoreOverride.reason, replacements))
          }
        }
      : {})
  };
}

function desanitizeDefenderThesisContext(
  context: DefenderThesisContext,
  actualTeamIdByPromptTeamId: Map<string, string>,
  replacements: Array<{ source: string; target: string }>
): DefenderThesisContext {
  return {
    ...context,
    attackingTeamId: actualTeamIdByPromptTeamId.get(context.attackingTeamId) ?? context.attackingTeamId,
    defendingTeamId: actualTeamIdByPromptTeamId.get(context.defendingTeamId) ?? context.defendingTeamId,
    defenderTeamThesis: normalizeChineseFirstJudgeText(desanitizeJudgeText(context.defenderTeamThesis, replacements)),
    defenderMustHoldClaims: context.defenderMustHoldClaims.map((claim) =>
      normalizeChineseFirstJudgeText(desanitizeJudgeText(claim, replacements))
    ),
    attackerChallengeBrief: normalizeChineseFirstJudgeText(desanitizeJudgeText(context.attackerChallengeBrief, replacements))
  };
}

function desanitizeJudgeScoreDimension<T extends { evidence: string }>(
  dimension: T,
  replacements: Array<{ source: string; target: string }>
): T {
  return {
    ...dimension,
    evidence: normalizeChineseFirstJudgeText(desanitizeJudgeText(dimension.evidence, replacements))
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

function buildCompactTeamPlanRequestInput(input: {
  context: Pick<EngineContext, "phase18MapSemanticsByMapName">;
  round: Round;
  mapGame: MapGame;
  team: Team;
  opponent: Team;
  activeAgents: Agent[];
  side: "attack" | "defense";
  sideAssignment: SideAssignment;
  scoreBeforeRound: ScorePair;
  buyType: BuyType;
  teamEconomyPlan?: TeamEconomyPlan | undefined;
  beforeEconomy: EconomyState[];
  tacticalHint?: RuleBasedTacticalPlans["attackPlan"] | RuleBasedTacticalPlans["defenseDeployment"] | undefined;
  recentPublicRoundSummaries: string[];
  competitiveParityNote: string;
  teamMemoryOverlay?: unknown;
  coachCorrection?: CoachTimeoutCorrection | undefined;
}): Record<string, unknown> {
  const mapSemanticContext = compactMapSemanticContext(readPhase18MapSemanticContext(input.context, input.mapGame.mapName));
  const judgeRubricContext = compactJudgeRubricContext(readPhase18JudgeRubricContext(input.context, input.mapGame.mapName));
  const initialProposal = compactTeamInitialProposal(readTeamMaterialInitialProposal(input.team));
  const coachContext = compactCoachContext(readTeamHeadCoachProfile(input.team));
  const economyPlan = input.teamEconomyPlan;

  return removeUndefined({
    objective: "Create one coherent team plan for this round. Every player action will be generated from this plan.",
    roundId: input.round.id,
    roundNumber: input.round.roundNumber,
    mapName: input.mapGame.mapName,
    mapSemanticContext,
    judgeRubricContext,
    teamId: input.team.id,
    teamName: input.team.displayName,
    initialProposal,
    coachContext,
    teamMemoryOverlay: compactTeamMemoryOverlay(input.teamMemoryOverlay),
    opponentTeamId: input.opponent.id,
    opponentTeamName: input.opponent.displayName,
    side: input.side,
    sideAssignment: input.sideAssignment,
    scoreBeforeRound: input.scoreBeforeRound,
    buyType: input.buyType,
    economyPosture: economyPlan?.posture ?? "eco",
    roundEconomyPhase: economyPlan?.phase ?? resolveRoundEconomyPhase(input.round.roundNumber),
    economyPostureReason: truncatePromptText(economyPlan?.postureReason ?? "默认经济态势。", 120),
    teamLossCount: economyPlan?.lossCount ?? 1,
    teamEconomy: sumEconomyByTeam(input.beforeEconomy, input.team.id),
    allowedAgentIds: input.activeAgents.map((agent) => agent.id),
    activeAgents: input.activeAgents.map((agent) => {
      const decision = economyPlan?.decisions.find((entry) => entry.agentId === agent.id);
      return removeUndefined({
        id: agent.id,
        displayName: agent.displayName,
        role: agent.role,
        secondaryRoles: (agent.secondaryRoles ?? []).slice(0, 2),
        roleResponsibilities: (agent.roleProfile?.agentMajorResponsibilities ?? []).slice(0, 3).map((entry) => truncatePromptText(entry, 90)),
        profileSummary: compactAgentProfile(agent),
        tokenBank: input.beforeEconomy.find((state) => state.agentId === agent.id)?.tokenBank ?? 0,
        currentBuyType: decision?.buyType ?? "eco",
        currentPosture: decision?.economyPosture ?? "eco",
        loadoutPackage: decision?.loadoutPackage ?? "pistol_eco_pack"
      });
    }),
    dropPlan: (economyPlan?.dropDecisions ?? []).slice(0, 3).map((decision) => ({
      fromAgentId: decision.fromAgentId,
      toAgentId: decision.toAgentId,
      amount: decision.amount,
      reason: truncatePromptText(decision.reason, 80)
    })),
    competitiveParityNote: truncatePromptText(input.competitiveParityNote, 180),
    tacticalHint: compactTacticalHint(input.tacticalHint),
    recentPublicRoundSummaries: input.recentPublicRoundSummaries.slice(-2).map((summary) => truncatePromptText(summary, 160)),
    finalOutputRules: [
      "playerDirectives[].agentId must be copied exactly from allowedAgentIds.",
      "Do not output player1/player2/agent1/role names/display names as agentId.",
      "Keep each directive to one concise Chinese sentence."
    ],
    ...(input.coachCorrection ? { coachCorrection: compactCoachCorrection(input.coachCorrection) } : {})
  });
}

function compactMapSemanticContext(context: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!context) {
    return undefined;
  }
  const proposition = readUnknownRecord(context.proposition);
  const displayZoneNames = readUnknownRecord(proposition?.displayZoneNames);
  return removeUndefined({
    proposition: removeUndefined({
      mapTheme: pickString(proposition, "mapTheme"),
      coreQuestion: truncatePromptText(pickString(proposition, "coreQuestion"), 180),
      attackFocus: pickStringArray(proposition, "attackFocus").slice(0, 4),
      defenseFocus: pickStringArray(proposition, "defenseFocus").slice(0, 4),
      regulationRoundThemes: compactRoundThemes(proposition?.regulationRoundThemes),
      overtimeRoundThemes: compactRoundThemes(proposition?.overtimeRoundThemes),
      displayZoneNames: displayZoneNames
        ? Object.fromEntries(Object.entries(displayZoneNames).filter(([, value]) => typeof value === "string").slice(0, 8))
        : undefined
    })
  });
}

function compactJudgeRubricContext(context: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!context) {
    return undefined;
  }
  return removeUndefined({
    coreJudgmentAxis: pickString(context, "coreJudgmentAxis"),
    reasonMustCover: pickStringArray(context, "reasonMustCover").slice(0, 4),
    biasGuardrails: pickStringArray(context, "biasGuardrails").slice(0, 4)
  });
}

function compactTeamInitialProposal(proposal: TeamInitialProposal | undefined): Record<string, unknown> | undefined {
  if (!proposal) {
    return undefined;
  }
  return removeUndefined({
    proposalId: proposal.proposalId,
    version: proposal.version,
    teamThesis: truncatePromptText(proposal.teamThesis, 240),
    opportunity: truncatePromptText(proposal.opportunity, 160),
    product: truncatePromptText(proposal.product, 140),
    engineering: truncatePromptText(proposal.engineering, 140),
    business: truncatePromptText(proposal.business, 140),
    operations: truncatePromptText(proposal.operations, 120),
    scaling: truncatePromptText(proposal.scaling, 120),
    moat: truncatePromptText(proposal.moat, 120),
    mustHoldClaims: proposal.mustHoldClaims.slice(0, 3).map((entry) => truncatePromptText(entry, 120)),
    failureModes: proposal.failureModes.slice(0, 3).map((entry) => truncatePromptText(entry, 120)),
    playerOperatingPrinciples: proposal.playerOperatingPrinciples.slice(0, 5).map((entry) => truncatePromptText(entry, 100)),
    frontendSummary: truncatePromptText(proposal.frontendSummary, 180)
  });
}

function compactCoachContext(context: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!context) {
    return undefined;
  }
  return removeUndefined({
    displayName: pickString(context, "displayName"),
    dutySummary: truncatePromptText(pickString(context, "dutySummary"), 140),
    style: truncatePromptText(pickString(context, "style") ?? pickString(context, "coachingStyle"), 100)
  });
}

function compactTeamMemoryOverlay(value: unknown): Record<string, unknown> | undefined {
  const record = readUnknownRecord(value);
  if (!record) {
    return undefined;
  }
  return removeUndefined({
    proposedStrategyPatch: truncatePromptText(pickString(record, "proposedStrategyPatch"), 180),
    timeoutQualityReview: truncatePromptText(pickString(record, "timeoutQualityReview"), 140),
    keptBeliefs: pickStringArray(record, "keptBeliefs").slice(0, 2).map((entry) => truncatePromptText(entry, 90)),
    brokenBeliefs: pickStringArray(record, "brokenBeliefs").slice(0, 2).map((entry) => truncatePromptText(entry, 90))
  });
}

function compactCoachCorrection(correction: CoachTimeoutCorrection): Record<string, unknown> {
  return removeUndefined({
    teamId: correction.teamId,
    triggerRoundNumber: correction.triggerRoundNumber,
    nextRoundObjective: truncatePromptText(correction.nextRoundObjective, 140),
    ownCoreToHold: truncatePromptText(correction.ownCoreToHold, 120),
    opponentGapToHit: truncatePromptText(correction.opponentGapToHit, 120),
    zonePriorityShift: truncatePromptText(correction.zonePriorityShift, 120),
    teamDirective: truncatePromptText(correction.teamDirective, 140),
    playerAdjustments: correction.playerAdjustments.map((entry) => ({
      agentId: entry.agentId,
      adjustment: truncatePromptText(entry.adjustment, 90)
    }))
  });
}

function compactTacticalHint(value: unknown): Record<string, unknown> | undefined {
  const record = readUnknownRecord(value);
  if (!record) {
    return undefined;
  }
  return removeUndefined({
    teamId: pickString(record, "teamId"),
    primaryTargetZoneId: pickString(record, "primaryTargetZoneId"),
    secondaryTargetZoneId: pickString(record, "secondaryTargetZoneId"),
    feintZoneId: pickString(record, "feintZoneId"),
    approach: pickString(record, "approach"),
    setup: pickString(record, "setup"),
    heavyZoneId: pickString(record, "heavyZoneId"),
    weakZoneIds: pickStringArray(record, "weakZoneIds").slice(0, 3),
    rotatePolicy: pickString(record, "rotatePolicy"),
    intentSummary: truncatePromptText(pickString(record, "intentSummary"), 160),
    deploymentSummary: truncatePromptText(pickString(record, "deploymentSummary"), 160)
  });
}

function compactAgentProfile(agent: Agent): string | undefined {
  const baseProfile = readUnknownRecord(agent.baseProfile);
  const parts = [
    pickString(baseProfile, "summary"),
    pickString(baseProfile, "style"),
    pickString(baseProfile, "strength"),
    pickString(baseProfile, "signature")
  ].filter((entry): entry is string => Boolean(entry));
  return parts.length > 0 ? truncatePromptText(parts.join("；"), 140) : undefined;
}

function compactRoundThemes(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const themes = value
    .map((entry) => readUnknownRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .slice(0, 6)
    .map((entry) =>
      removeUndefined({
        round: pickString(entry, "round"),
        theme: truncatePromptText(pickString(entry, "theme"), 100)
      })
    );
  return themes.length > 0 ? themes : undefined;
}

function stripJudgePrestigeFields(value: unknown): Record<string, unknown> | undefined {
  const record = readUnknownRecord(value);
  if (!record) {
    return undefined;
  }
  const blockedFields = new Set(["frontendSummary", "personaSummary", "seedLabel", "powerRanking", "starPower"]);
  return Object.fromEntries(
    Object.entries(record).filter(([key, item]) => {
      if (blockedFields.has(key)) {
        return false;
      }
      if (typeof item === "string" && /(头号种子|明星阵容|豪门|超级明星|顶级强队|夺冠热门)/.test(item)) {
        return false;
      }
      return true;
    })
  );
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
      : {}),
    ...(readUnknownRecord(record.judgeScorecard)
      ? { judgeScorecard: normalizeJudgeScorecardPayload(record.judgeScorecard) }
      : {})
  };
}

function normalizeJudgeVerdictPayload(data: unknown): unknown {
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
    ...(readUnknownRecord(record.diagnostic)
      ? { diagnostic: normalizeJudgeDiagnosticPayload(record.diagnostic, undefined) }
      : {}),
    ...(readUnknownRecord(record.judgeScorecard)
      ? { judgeScorecard: normalizeJudgeScorecardPayload(record.judgeScorecard) }
      : {})
  };
}

function normalizeJudgeScorecardPayload(scorecard: unknown): unknown {
  const record = readUnknownRecord(scorecard);
  if (!record) {
    return scorecard;
  }
  const rawTeamScores = record.teamScores;
  const teamScores = Array.isArray(rawTeamScores)
    ? Object.fromEntries(
        rawTeamScores
          .map((entry) => readUnknownRecord(entry))
          .filter((entry): entry is Record<string, unknown> => Boolean(entry?.teamId))
          .map((entry) => [String(entry.teamId), entry])
      )
    : rawTeamScores;
  const marginFromScore = normalizeJudgeMargin(record.marginFromScore);
  return {
    ...record,
    ...(teamScores ? { teamScores } : {}),
    ...(marginFromScore ? { marginFromScore } : {})
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
      ? record.evidenceBasis.map((item) => normalizeCoachTimeoutText(item)).filter((item): item is string => Boolean(item))
      : typeof record.evidenceBasis === "string"
        ? [normalizeCoachTimeoutText(record.evidenceBasis)].filter((item): item is string => Boolean(item))
        : []
  };
}

function normalizeJudgeNarrativePayload(data: unknown): unknown {
  const record = readUnknownRecord(data);
  if (!record) {
    return data;
  }

  return {
    ...record,
    reason: normalizeCoachTimeoutText(record.reason),
    ...(readUnknownRecord(record.judgeInference)
      ? { judgeInference: normalizeJudgeInferencePayload(record.judgeInference) }
      : {})
  };
}

function normalizeJudgeDiagnosticPayload(diagnostic: unknown, reason: unknown): unknown {
  const record = readUnknownRecord(diagnostic);
  if (!record) {
    return diagnostic;
  }

  const zoneRelationRecord = readUnknownRecord(record.zoneRelation);
  const decisiveEvidence =
    normalizeCoachTimeoutText(record.decisiveEvidence) ??
    normalizeCoachTimeoutText(zoneRelationRecord?.decisiveEvidence) ??
    normalizeCoachTimeoutText(zoneRelationRecord?.evidence) ??
    normalizeCoachTimeoutText(zoneRelationRecord?.outcomeImpact);
  const rawMainAttackZoneId = normalizeCoachTimeoutText(record.mainAttackZoneId);
  const rawMainDefenseZoneId = normalizeCoachTimeoutText(record.mainDefenseZoneId);
  const mainAttackZoneId = normalizeJudgeZoneId(rawMainAttackZoneId) ?? rawMainAttackZoneId ?? "buyer_mid";
  const mainDefenseZoneId = normalizeJudgeZoneId(rawMainDefenseZoneId) ?? rawMainDefenseZoneId ?? mainAttackZoneId;
  const normalizedZoneRelation = zoneRelationRecord
    ? normalizeJudgeZoneRelationPayload(record.zoneRelation, decisiveEvidence, {
        attackZoneId: mainAttackZoneId,
        defenseZoneId: mainDefenseZoneId
      })
    : {
        attackZoneId: mainAttackZoneId,
        defenseZoneId: mainDefenseZoneId,
        relationType: "same_focus",
        relationSummary: decisiveEvidence ?? normalizeCoachTimeoutText(reason) ?? "攻守焦点存在结构关系。",
        outcomeImpact: decisiveEvidence ?? normalizeCoachTimeoutText(reason) ?? "攻守焦点影响本回合胜负。"
      };

  return {
    currentSubTheme: normalizeCoachTimeoutText(record.currentSubTheme),
    attackedOpportunityGap: normalizeCoachTimeoutText(record.attackedOpportunityGap),
    defendedCoreProposition: normalizeCoachTimeoutText(record.defendedCoreProposition),
    mainAttackZoneId,
    mainDefenseZoneId,
    zoneRelation: normalizedZoneRelation,
    decisiveEvidence
  };
}

function normalizeJudgeZoneRelationPayload(
  zoneRelation: unknown,
  fallbackEvidence?: string,
  fallbackZones?: { attackZoneId: string; defenseZoneId: string }
): unknown {
  const record = readUnknownRecord(zoneRelation);
  if (!record) {
    return zoneRelation;
  }

  const evidence =
    normalizeCoachTimeoutText(record.decisiveEvidence) ??
    normalizeCoachTimeoutText(record.evidence) ??
    normalizeCoachTimeoutText(record.relationSummary) ??
    normalizeCoachTimeoutText(record.outcomeImpact) ??
    fallbackEvidence ??
    "攻守焦点存在结构关系，并影响本回合胜负。";
  const rawRelationType = normalizeCoachTimeoutText(record.relationType);
  const relationType = normalizeJudgeZoneRelationType(rawRelationType);
  const relationTypeNote =
    rawRelationType && rawRelationType.trim().toLowerCase() !== relationType
      ? `原始关系类型“${rawRelationType}”已归一为 ${relationType}。`
      : "";

  return {
    attackZoneId:
      normalizeJudgeZoneId(record.attackZoneId) ??
      normalizeCoachTimeoutText(record.attackZoneId) ??
      fallbackZones?.attackZoneId,
    defenseZoneId:
      normalizeJudgeZoneId(record.defenseZoneId) ??
      normalizeCoachTimeoutText(record.defenseZoneId) ??
      fallbackZones?.defenseZoneId,
    relationType,
    relationSummary: [normalizeCoachTimeoutText(record.relationSummary) ?? evidence, relationTypeNote].filter(Boolean).join(" "),
    outcomeImpact: normalizeCoachTimeoutText(record.outcomeImpact) ?? evidence
  };
}

function normalizeJudgeZoneRelationType(value: unknown): string {
  const normalized = (normalizeCoachTimeoutText(value) ?? "").trim().toLowerCase();
  switch (normalized) {
    case "":
      return "same_focus";
    case "same":
    case "same_zone":
    case "same_focus":
    case "direct":
    case "direct_collision":
    case "direct_contest":
    case "head_to_head":
    case "primary_defense_anchor":
      return "same_focus";
    case "cross":
    case "crossfire":
    case "cross_hit":
    case "cross_axis":
    case "cross_axis_pressure":
    case "adjacent_entry_pressure":
    case "adjacent_pressure":
    case "entry_pressure":
    case "indirect_pressure":
    case "indirect_control":
    case "pressure_transfer":
    case "offensive_focus_vs_defensive_hub":
    case "offensive_focus_defensive_hub":
    case "attack_focus_vs_defense_hub":
    case "attack_focus_defense_hub":
      return "cross_hit";
    case "split":
    case "split_pressure":
    case "multi_axis":
    case "non_overlapping_focus_mismatch":
    case "non_overlapping_focus":
    case "focus_mismatch":
      return "split_pressure";
    case "probe_failed":
    case "failed_probe":
    case "failed_test":
      return "failed_probe";
    case "rotation":
    case "rotation_test":
    case "rotate_test":
      return "rotation_test";
    case "weak_side":
    case "weak_side_hit":
    case "weakside_hit":
      return "weak_side_hit";
    default:
      return "cross_hit";
  }
}

function normalizeChineseFirstTacticalText(value: string): string {
  let output = value.trim();
  const replacements: Array<{ source: string; target: string }> = [
    { source: "with controlled aggression", target: "以可控侵略性" },
    { source: "controlled aggression", target: "可控侵略性" },
    { source: "primary task", target: "首要任务" },
    { source: "do not overcommit", target: "不要过度投入" },
    { source: "overcommit", target: "过度投入" },
    { source: "immediately", target: "立即" },
    { source: "toward", target: "朝向" },
    { source: "probe", target: "试探" },
    { source: "rotation", target: "轮转" },
    { source: "rotations", target: "轮转" },
    { source: "window control", target: "窗口控制" },
    { source: "window", target: "窗口" },
    { source: "spawn", target: "出生点" },
    { source: "crossfire", target: "交叉火力" },
    { source: "sightlines", target: "枪线" },
    { source: "sightline", target: "枪线" },
    { source: "flank", target: "侧翼" },
    { source: "closeout", target: "收束" }
  ];
  for (const replacement of replacements) {
    output = output.replace(buildJudgeLiteralPattern(replacement.source), replacement.target);
  }
  return output.replace(/\s{2,}/g, " ").trim();
}

function normalizeAgentActionDecision(decision: AgentActionDecision): AgentActionDecision {
  return {
    ...decision,
    roundObjective: normalizeChineseFirstTacticalText(decision.roundObjective),
    executionPlan: normalizeChineseFirstTacticalText(decision.executionPlan),
    coordinationPlan: normalizeChineseFirstTacticalText(decision.coordinationPlan),
    roleResponsibilityUsage: normalizeChineseFirstTacticalText(decision.roleResponsibilityUsage),
    riskRead: normalizeChineseFirstTacticalText(decision.riskRead),
    contingencyPlan: normalizeChineseFirstTacticalText(decision.contingencyPlan),
    expectedContribution: normalizeChineseFirstTacticalText(decision.expectedContribution)
  };
}

function normalizeTeamRoundPlanPayload(
  data: unknown,
  options?: {
    activeAgents?: Array<{ id: string; displayName?: string; role?: string }>;
    defaultPosture?: EconomyPosture;
    economySummary?: string;
    buyIntentByAgent?: Array<{
      agentId: string;
      targetPosture?: EconomyPosture;
      preferredLoadout?: LoadoutPackage;
    }>;
  }
): unknown {
  const record = readUnknownRecord(data);
  if (!record) {
    return data;
  }

  let playerDirectives = record.playerDirectives;
  if (!Array.isArray(record.playerDirectives)) {
    const directivesRecord = readUnknownRecord(record.playerDirectives);
    if (directivesRecord) {
      playerDirectives = Object.entries(directivesRecord).map(([agentId, directiveValue]) => {
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
    }
  }
  playerDirectives = normalizeTeamPlanDirectiveAgentIds(playerDirectives, options?.activeAgents);

  let economyIntent: unknown = record.economyIntent;
  const economyIntentRecord = readUnknownRecord(record.economyIntent);
  if (economyIntentRecord || options?.defaultPosture || options?.economySummary || options?.buyIntentByAgent) {
    const defaultPosture =
      options?.defaultPosture ?? normalizeLlmEconomyPosture(economyIntentRecord?.defaultPosture) ?? "eco";
    const buyIntentByAgent = options?.buyIntentByAgent?.map((entry) =>
      removeUndefined({
        agentId: entry.agentId,
        targetPosture: normalizeLlmEconomyPosture(entry.targetPosture) ?? defaultPosture,
        preferredLoadout: normalizeLlmLoadoutPackage(entry.preferredLoadout)
      })
    );
    economyIntent = {
      ...(economyIntentRecord ?? {}),
      defaultPosture,
      summary:
        typeof economyIntentRecord?.summary === "string"
          ? normalizeChineseFirstTacticalText(economyIntentRecord.summary)
          : normalizeChineseFirstTacticalText(options?.economySummary ?? "按当前经济态势执行团队买型。"),
      ...(buyIntentByAgent ? { buyIntentByAgent } : {})
    };
  }

  return {
    ...record,
    ...(typeof record.primaryIntent === "string" ? { primaryIntent: normalizeChineseFirstTacticalText(record.primaryIntent) } : {}),
    ...(typeof record.primaryZoneId === "string"
      ? { primaryZoneId: normalizeKnownTacticalZoneId(record.primaryZoneId) ?? record.primaryZoneId }
      : {}),
    ...(typeof record.secondaryZoneId === "string"
      ? { secondaryZoneId: normalizeKnownTacticalZoneId(record.secondaryZoneId) ?? record.secondaryZoneId }
      : {}),
    ...(typeof record.coordinationSummary === "string"
      ? { coordinationSummary: normalizeChineseFirstTacticalText(record.coordinationSummary) }
      : {}),
    playerDirectives: Array.isArray(playerDirectives)
      ? playerDirectives.map((entry) => {
          const directiveRecord = readUnknownRecord(entry);
          if (!directiveRecord || typeof directiveRecord.directive !== "string") {
            return entry;
          }
          return {
            ...directiveRecord,
            directive: normalizeChineseFirstTacticalText(directiveRecord.directive)
          };
        })
      : playerDirectives,
    ...(typeof record.winCondition === "string" ? { winCondition: normalizeChineseFirstTacticalText(record.winCondition) } : {}),
    ...(typeof record.risk === "string" ? { risk: normalizeChineseFirstTacticalText(record.risk) } : {}),
    economyIntent
  };
}

function normalizeTeamPlanDirectiveAgentIds(
  playerDirectives: unknown,
  activeAgents: Array<{ id: string; displayName?: string; role?: string }> | undefined
): unknown {
  if (!Array.isArray(playerDirectives) || !activeAgents || activeAgents.length === 0) {
    return playerDirectives;
  }

  const directiveRecords = playerDirectives.map((entry) => readUnknownRecord(entry));
  if (directiveRecords.some((entry) => !entry || typeof entry.agentId !== "string")) {
    return playerDirectives;
  }

  const activeAgentIds = new Set(activeAgents.map((agent) => agent.id));
  const allAlreadyValid = directiveRecords.every((entry) => activeAgentIds.has(String(entry?.agentId)));
  if (allAlreadyValid) {
    return playerDirectives;
  }

  const directiveAgentIds = directiveRecords.map((entry) => String(entry?.agentId ?? ""));
  const canMapByPosition =
    directiveRecords.length === activeAgents.length &&
    directiveAgentIds.every(isOrderedAgentPlaceholder) &&
    orderedPlaceholdersAreUniqueAndContiguous(directiveAgentIds);
  if (!canMapByPosition) {
    return playerDirectives;
  }

  return directiveRecords.map((entry, index) => ({
    ...entry,
    agentId: activeAgents[index]?.id
  }));
}

function isOrderedAgentPlaceholder(value: string): boolean {
  return /^(?:player|agent)[_-]?[1-9]\d*$/i.test(value.trim());
}

function orderedPlaceholdersAreUniqueAndContiguous(values: string[]): boolean {
  const indexes = values
    .map((value) => /(\d+)$/.exec(value.trim())?.[1])
    .map((value) => (value ? Number.parseInt(value, 10) : Number.NaN));
  if (indexes.some((value) => !Number.isFinite(value))) {
    return false;
  }
  const unique = new Set(indexes);
  if (unique.size !== indexes.length) {
    return false;
  }
  return indexes.every((value) => value >= 1 && value <= indexes.length);
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

function normalizeJudgeZoneId(value: unknown): string | undefined {
  const text = normalizeCoachTimeoutText(value)?.trim();
  if (!text) {
    return undefined;
  }
  return normalizeKnownTacticalZoneId(text);
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
  const defenderThesisContext = readUnknownRecord(record.defenderThesisContext);
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
    ...(defenderThesisContext
      ? [
          `半场守方主命题：${pickString(defenderThesisContext, "defenderTeamThesis") ?? "unknown"}`,
          `攻方挑战任务：${pickString(defenderThesisContext, "attackerChallengeBrief") ?? "unknown"}`,
          ...(() => {
            const mustHoldClaims = pickStringArray(defenderThesisContext, "defenderMustHoldClaims");
            return mustHoldClaims.length > 0 ? [`守方必须守住：${mustHoldClaims.join(" / ")}`] : [];
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

function truncatePromptText(value: string | undefined, maxLength: number): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
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
    teamPlan: compactJudgeTeamPlan(input.teamPlan),
    initialProposalSummary: compactJudgeInitialProposalSummary(input.initialProposalSummary),
    coachContext: compactCoachContext(input.coachContext)
  });
  return entry as Phase18JudgePromptContext["requestInput"]["evaluationOrder"][number];
}

function compactJudgeEvaluationOrder(
  entries: Phase18JudgePromptContext["requestInput"]["evaluationOrder"]
): Phase18JudgePromptContext["requestInput"]["evaluationOrder"] {
  return entries.map((entry) => {
    const teamPlan = readUnknownRecord(entry.teamPlan);
    const initialProposalSummary = readUnknownRecord(entry.initialProposalSummary);
    const coachContext = readUnknownRecord(entry.coachContext);
    return removeUndefined({
      teamId: entry.teamId,
      teamName: entry.teamName,
      activeAgents: entry.activeAgents.map((agent) => ({ id: agent.id, role: agent.role })),
      teamPlan: teamPlan ? compactJudgeTeamPlan(teamPlan as TeamRoundPlanDecision) : undefined,
      initialProposalSummary: compactJudgeInitialProposalSummary(initialProposalSummary),
      coachContext: compactCoachContext(coachContext)
    }) as Phase18JudgePromptContext["requestInput"]["evaluationOrder"][number];
  });
}

function compactJudgeNarrativeVerdict(verdict: JudgeVerdictDecision): Record<string, unknown> {
  const scorecard = verdict.judgeScorecard;
  const judgeInference = readUnknownRecord(verdict.judgeInference);
  return removeUndefined({
    winnerTeamId: verdict.winnerTeamId,
    loserTeamId: verdict.loserTeamId,
    roundWinType: verdict.roundWinType,
    margin: verdict.margin,
    attackWinConditionMet: verdict.attackWinConditionMet,
    defenseWinConditionMet: verdict.defenseWinConditionMet,
    mvpAgentId: verdict.mvpAgentId,
    confidence: verdict.confidence,
    reason: truncatePromptText(normalizeCoachTimeoutText(verdict.reason), 360),
    judgeInference: judgeInference
      ? removeUndefined({
          source: pickString(judgeInference, "source"),
          boundary: truncatePromptText(pickString(judgeInference, "boundary"), 180),
          csResolution: truncatePromptText(pickString(judgeInference, "csResolution"), 160),
          combatNarrative: truncatePromptText(pickString(judgeInference, "combatNarrative"), 220),
          evidenceBasis: pickStringArray(judgeInference, "evidenceBasis").slice(0, 4).map((entry) => truncatePromptText(entry, 90))
        })
      : undefined,
    diagnostic: removeUndefined({
      currentSubTheme: verdict.diagnostic.currentSubTheme,
      attackedOpportunityGap: truncatePromptText(verdict.diagnostic.attackedOpportunityGap, 180),
      defendedCoreProposition: truncatePromptText(verdict.diagnostic.defendedCoreProposition, 180),
      mainAttackZoneId: verdict.diagnostic.mainAttackZoneId,
      mainDefenseZoneId: verdict.diagnostic.mainDefenseZoneId,
      zoneRelation: verdict.diagnostic.zoneRelation
        ? {
            attackZoneId: verdict.diagnostic.zoneRelation.attackZoneId,
            defenseZoneId: verdict.diagnostic.zoneRelation.defenseZoneId,
            relationType: verdict.diagnostic.zoneRelation.relationType,
            relationSummary: truncatePromptText(verdict.diagnostic.zoneRelation.relationSummary, 160),
            outcomeImpact: truncatePromptText(verdict.diagnostic.zoneRelation.outcomeImpact, 160)
          }
        : undefined,
      decisiveEvidence: truncatePromptText(verdict.diagnostic.decisiveEvidence, 220)
    }),
    scorecardSummary: scorecard
      ? removeUndefined({
          scorecardSource: scorecard.scorecardSource,
          winnerFromScore: scorecard.winnerFromScore,
          marginFromScore: scorecard.marginFromScore,
          scoreDelta: scorecard.scoreDelta,
          decisiveDimensions: scorecard.decisiveDimensions,
          teamTotals: Object.fromEntries(
            Object.entries(scorecard.teamScores).map(([teamId, teamScore]) => [
              teamId,
              {
                side: teamScore.side,
                totalScore: teamScore.totalScore
              }
            ])
          )
        })
      : undefined
  });
}

function compactJudgeNarrativeOriginalInput(value: unknown): Record<string, unknown> | undefined {
  const record = readUnknownRecord(value);
  if (!record) {
    return undefined;
  }
  return removeUndefined({
    roundId: record.roundId,
    roundNumber: record.roundNumber,
    mapName: truncatePromptText(pickString(record, "mapName"), 80),
    scoreBeforeRound: record.scoreBeforeRound,
    sideAssignment: record.sideAssignment,
    teamAId: pickString(record, "teamAId"),
    teamBId: pickString(record, "teamBId"),
    teamAName: pickString(record, "teamAName"),
    teamBName: pickString(record, "teamBName"),
    activeTeamAAgentIds: Array.isArray(record.activeTeamAAgentIds) ? record.activeTeamAAgentIds : undefined,
    activeTeamBAgentIds: Array.isArray(record.activeTeamBAgentIds) ? record.activeTeamBAgentIds : undefined,
    mapSemanticContext: compactMapSemanticContext(readUnknownRecord(record.mapSemanticContext)),
    scoreTensionGuardrail: truncatePromptText(pickString(record, "scoreTensionGuardrail"), 220),
    tacticalCollision: compactTacticalCollisionForPrompt(record.tacticalCollision),
    judgeEvidenceDigest: compactJudgeNarrativeEvidenceDigest(record.judgeEvidenceDigest),
    recentPublicRoundSummaries: Array.isArray(record.recentPublicRoundSummaries)
      ? record.recentPublicRoundSummaries.slice(-2).map((summary) => truncatePromptText(String(summary), 120))
      : undefined
  });
}

function compactJudgeNarrativeEvidenceDigest(value: unknown): Record<string, unknown> | undefined {
  const digest = readUnknownRecord(value);
  if (!digest) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(digest).map(([teamId, teamValue]) => {
      const teamDigest = readUnknownRecord(teamValue);
      const items = Array.isArray(teamDigest?.items)
        ? teamDigest.items.slice(0, 3).map((item) => {
            const itemRecord = readUnknownRecord(item);
            return removeUndefined({
              agentId: pickString(itemRecord, "agentId"),
              role: pickString(itemRecord, "role"),
              evidence: pickStringArray(itemRecord, "evidence").slice(0, 2).map((entry) => truncatePromptText(entry, 70))
            });
          })
        : [];
      return [
        teamId,
        removeUndefined({
          side: pickString(teamDigest, "side"),
          itemCount: items.length,
          items
        })
      ];
    })
  );
}

function compactTacticalCollisionForPrompt(value: unknown): Record<string, unknown> | undefined {
  const record = readUnknownRecord(value);
  if (!record) {
    return undefined;
  }
  return removeUndefined({
    primaryZoneId: pickString(record, "primaryZoneId"),
    result: pickString(record, "result"),
    attackScore: typeof record.attackScore === "number" ? record.attackScore : undefined,
    defenseScore: typeof record.defenseScore === "number" ? record.defenseScore : undefined,
    summary: truncatePromptText(pickString(record, "summary"), 160)
  });
}

function compactJudgeTeamPlan(plan: TeamRoundPlanDecision | undefined): Record<string, unknown> | undefined {
  if (!plan) {
    return undefined;
  }
  return removeUndefined({
    teamId: plan.teamId,
    side: plan.side,
    primaryIntent: truncatePromptText(plan.primaryIntent, 90),
    primaryZoneId: plan.primaryZoneId,
    secondaryZoneId: plan.secondaryZoneId,
    coordinationSummary: truncatePromptText(plan.coordinationSummary, 90),
    playerDirectives: plan.playerDirectives.map((directive) => ({
      agentId: directive.agentId,
      directive: truncatePromptText(directive.directive, 70)
    })),
    winCondition: truncatePromptText(plan.winCondition, 90),
    risk: truncatePromptText(plan.risk, 80),
    confidence: plan.confidence
  });
}

function compactJudgeInitialProposalSummary(summary: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!summary) {
    return undefined;
  }
  return removeUndefined({
    teamThesis: truncatePromptText(pickString(summary, "teamThesis"), 160),
    mustHoldClaims: pickStringArray(summary, "mustHoldClaims").slice(0, 2).map((entry) => truncatePromptText(entry, 80)),
    failureModes: pickStringArray(summary, "failureModes").slice(0, 2).map((entry) => truncatePromptText(entry, 80))
  });
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
    const submittedOutput = output as AgentOutput & Partial<SubmittedAgentOutput>;
    const promptTeamId = input.promptTeamIdByActualTeamId.get(output.teamId);
    const promptAgentId = input.promptAgentIdByActualAgentId.get(output.agentId);
    if (!promptTeamId || !promptAgentId) {
      throw new Error(`Missing prompt ids for judge output sanitization: ${output.agentId}/${output.teamId}`);
    }

    const sanitizedOutput: AgentOutput = {
      ...output,
      id: submittedOutput.submissionKind === "submitted_output" ? `sub_prompt_${promptAgentId}` : `prompt_${promptAgentId}`,
      agentId: promptAgentId,
      teamId: promptTeamId,
      ...(submittedOutput.rawOutputId ? { rawOutputId: `prompt_${promptAgentId}` } : {}),
      ...(submittedOutput.gateSummary ? { gateSummary: sanitizeJudgeText(submittedOutput.gateSummary, input.replacements) } : {}),
      ...(output.action ? { action: sanitizeJudgeText(output.action, input.replacements) } : {}),
      ...(output.actionDetail ? { actionDetail: sanitizeJudgeValue(output.actionDetail, input.replacements) as AgentActionDecision } : {}),
      rawFingerprint: `prompt_fp_${promptAgentId}`
    };
    outputsByTeam.set(promptTeamId, [...(outputsByTeam.get(promptTeamId) ?? []), sanitizedOutput]);
  }

  return Object.fromEntries(outputsByTeam);
}

function buildJudgeEvidenceDigest(input: {
  agentOutputs: AgentOutput[];
  promptTeamIdByActualTeamId: Map<string, string>;
  promptAgentIdByActualAgentId: Map<string, string>;
  replacements: Array<{ source: string; target: string }>;
}): Phase18JudgePromptContext["requestInput"]["judgeEvidenceDigest"] {
  const outputsByTeam = new Map<string, Array<AgentOutput & Partial<SubmittedAgentOutput>>>();
  for (const output of input.agentOutputs) {
    const promptTeamId = input.promptTeamIdByActualTeamId.get(output.teamId);
    if (!promptTeamId) {
      throw new Error(`Missing prompt team id for judge evidence digest: ${output.teamId}`);
    }
    outputsByTeam.set(promptTeamId, [...(outputsByTeam.get(promptTeamId) ?? []), output as AgentOutput & Partial<SubmittedAgentOutput>]);
  }
  const maxItems = Math.max(0, ...[...outputsByTeam.values()].map((outputs) => outputs.length));
  const maxEvidencePerItem = 2;
  return Object.fromEntries(
    [...outputsByTeam.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([teamId, outputs]) => [
        teamId,
        {
          maxItems,
          maxEvidencePerItem,
          items: outputs
            .slice()
            .sort((left, right) => left.agentId.localeCompare(right.agentId))
            .slice(0, maxItems)
            .map((output) => {
              const promptAgentId = input.promptAgentIdByActualAgentId.get(output.agentId) ?? output.agentId;
              const item: {
                agentId: string;
                outputBudget?: number;
                economyPosture?: string;
                omittedFieldCount: number;
                evidence: string[];
              } = {
                agentId: promptAgentId,
                omittedFieldCount: Array.isArray(output.omittedFields) ? output.omittedFields.length : 0,
                evidence: summarizeSubmittedOutputEvidence(output, input.replacements).slice(0, maxEvidencePerItem)
              };
              if (typeof output.outputBudget === "number") {
                item.outputBudget = output.outputBudget;
              }
              if (output.economyPosture) {
                item.economyPosture = output.economyPosture;
              }
              return item;
            })
        }
      ])
  );
}

function summarizeSubmittedOutputEvidence(
  output: AgentOutput & Partial<SubmittedAgentOutput>,
  replacements: Array<{ source: string; target: string }>
): string[] {
  const detail = output.actionDetail;
  const candidates = [
    detail?.roundObjective,
    detail?.executionPlan,
    detail?.coordinationPlan,
    detail?.roleResponsibilityUsage,
    detail?.expectedContribution,
    output.action,
    output.gateSummary
  ];
  return candidates
    .map((value) => normalizeCoachTimeoutText(value))
    .filter((value): value is string => Boolean(value))
    .map((value) => sanitizeJudgeText(value, replacements))
    .map((value) => (value.length > 80 ? `${value.slice(0, 77)}...` : value))
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 2);
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
  providerDiagnostics?: LlmResponse["providerDiagnostics"];
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
    ...(typeof error.parseCandidate === "string" ? { parseCandidate: error.parseCandidate } : {}),
    ...(isRecord(error.providerDiagnostics) ? { providerDiagnostics: error.providerDiagnostics as LlmResponse["providerDiagnostics"] } : {})
  };
}

function classifyLlmErrorKind(errorMessage: string): string {
  if (errorMessage.includes("repair_invalid_agent_id")) {
    return "repair_invalid_agent_id";
  }
  if (errorMessage.includes("reasoning_exhausted_empty_content")) {
    return "reasoning_exhausted_empty_content";
  }
  if (errorMessage.includes("provider_empty_content")) {
    return "provider_empty_content";
  }
  if (errorMessage.includes("json_truncated")) {
    return "json_truncated";
  }
  if (errorMessage.includes("does not parse as JSON")) {
    return "json_parse_error";
  }
  if (errorMessage.includes("invalid_enum_value")) {
    return "schema_enum_alias";
  }
  if (errorMessage.includes("Required") || errorMessage.includes("required") || errorMessage.includes("is required")) {
    return "schema_required_fact";
  }
  if (errorMessage.includes("provider request failed") || errorMessage.includes("timed out")) {
    return "provider_error";
  }
  return "schema_validation";
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

