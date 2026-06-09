import type { Repositories } from "@agent-major/db";
import type {
  Agent,
  AgentOutput,
  Artifact,
  EconomyPosture,
  Event,
  JudgeResult,
  JudgeRoundWinType,
  MapGame,
  Match,
  Round,
  RoundKeyEvent,
  RoundReport,
  ScorePair,
  Team
} from "@agent-major/shared";

import {
  calculateEconomyDelta,
  decideTeamEconomyPlans,
  economyStateFromDelta,
  initialEconomy,
  isEconomyResetRound,
  roundStartEconomy
} from "../../economy/economy-output-service.js";
import { sortAgentsForRound } from "../../economy/economy-rules.js";
import { evaluateMapState, getSideContext } from "../../match/map-rules.js";
import { createSideAssignment } from "../../match/tactical-protocol.js";
import type { ArtifactStore } from "../../ports.js";
import { runDust2HexRound, type HexRoundTrace } from "../round/index.js";

export interface CommitDust2HexRoundExperimentalInput {
  repositories: Repositories;
  artifactStore: ArtifactStore;
  mapGameId: string;
  enableExperimentalMode: true;
  providerMode?: "fixture" | "real";
  maxLlmCallsPerPhase?: number;
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

const sourceModule = "hex-round-experimental-committer";

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
  const mapGame = await required(input.repositories.mapGames.getById(input.mapGameId), `Map game not found: ${input.mapGameId}`);
  if (!isDust2Map(mapGame.mapName)) {
    throw new Error(`phase20_hex_round_experimental only supports Dust2; received mapName=${mapGame.mapName}`);
  }
  if (mapGame.status === "completed") {
    throw new Error(`Cannot commit experimental Hex round on completed map: ${mapGame.id}`);
  }

  const match = await required(input.repositories.matches.getById(mapGame.matchId), `Match not found: ${mapGame.matchId}`);
  const [teamA, teamB] = await Promise.all([
    required(input.repositories.teams.getById(match.teamAId), `Team not found: ${match.teamAId}`),
    required(input.repositories.teams.getById(match.teamBId), `Team not found: ${match.teamBId}`)
  ]);
  const [teamAAgents, teamBAgents] = await Promise.all([
    input.repositories.agents.listByTeam(teamA.id),
    input.repositories.agents.listByTeam(teamB.id)
  ]);
  const activeA = selectActiveAgents(teamAAgents);
  const activeB = selectActiveAgents(teamBAgents);
  const roundNumber = mapGame.currentRoundNumber + 1;
  const roundId = `round_${mapGame.id}_${roundNumber}`;
  const existingRound = await input.repositories.rounds.getByMapGameAndRoundNumber(mapGame.id, roundNumber);
  if (existingRound) {
    throw new Error(`Round already exists for map ${mapGame.id} R${roundNumber}; Hex experimental commit refuses to overwrite.`);
  }

  const sideContext = getSideContext(roundNumber);
  const sideAssignment = createSideAssignment({
    roundId,
    roundNumber,
    teamAId: teamA.id,
    teamBId: teamB.id,
    sideContext
  });
  const scoreBeforeRound: ScorePair = { teamA: mapGame.teamAScore, teamB: mapGame.teamBScore };
  const beforeEconomy = await buildBeforeEconomy({
    repositories: input.repositories,
    mapGame,
    roundNumber,
    createdAt,
    activeAgents: [...activeA, ...activeB],
    attackingTeamId: sideAssignment.attackingTeamId
  });
  const previousRoundReports = await input.repositories.roundReports.listByMapGame(mapGame.id);
  const teamEconomyPlans = decideTeamEconomyPlans({
    roundNumber,
    scoreBeforeRound,
    teamA,
    teamB,
    activeA,
    activeB,
    beforeEconomy,
    sideContext,
    previousRoundReport: previousRoundReports.at(-1)
  });

  const hexTrace = await runDust2HexRound({
    roundId,
    roundNumber,
    attackTeamId: sideAssignment.attackingTeamId,
    defenseTeamId: sideAssignment.defendingTeamId,
    activeAgents: buildHexRunnerAgents({
      activeA,
      activeB,
      attackingTeamId: sideAssignment.attackingTeamId
    }),
    teamEconomyPlans,
    providerMode: input.providerMode ?? "fixture",
    maxLlmCallsPerPhase: input.maxLlmCallsPerPhase ?? 10,
    env: input.env ?? process.env
  });

  const finalWinCondition = hexTrace.finalWinCondition;
  if (!finalWinCondition.isRoundOver || !finalWinCondition.winnerTeamId || !finalWinCondition.loserTeamId || !finalWinCondition.judgeRoundWinType) {
    throw new Error("Hex experimental round did not produce a hard final win condition; no round facts were committed.");
  }

  const winnerTeamId = finalWinCondition.winnerTeamId;
  const loserTeamId = finalWinCondition.loserTeamId;
  const roundWinType = finalWinCondition.judgeRoundWinType;
  const winnerAgents = winnerTeamId === teamA.id ? activeA : activeB;
  const mvpAgent = selectMvpAgent(winnerAgents, hexTrace);
  const agentOutputs = buildAgentOutputs([...activeA, ...activeB], hexTrace);
  const keyEvents = buildKeyEvents({
    roundId,
    finalWinCondition,
    mvpAgent,
    winnerTeamId,
    agentOutputs
  });
  const economyDelta = calculateEconomyDelta({
    beforeEconomy,
    winnerTeamId,
    loserTeamId,
    teamAId: teamA.id,
    teamBId: teamB.id,
    roundWinType,
    teamEconomyPlans,
    activeA,
    activeB
  });
  const scoreAfterRound = incrementScore(scoreBeforeRound, winnerTeamId, teamA.id);
  const mapEvaluation = evaluateMapState(scoreAfterRound, roundNumber);
  const runningRound: Round = {
    id: roundId,
    mapGameId: mapGame.id,
    roundNumber,
    status: "running",
    phase: "committing",
    ...(teamEconomyPlans[teamA.id]?.summaryBuyType ? { teamABuyType: teamEconomyPlans[teamA.id]!.summaryBuyType } : {}),
    ...(teamEconomyPlans[teamB.id]?.summaryBuyType ? { teamBBuyType: teamEconomyPlans[teamB.id]!.summaryBuyType } : {}),
    teamAActiveAgentIds: activeA.map((agent) => agent.id),
    teamBActiveAgentIds: activeB.map((agent) => agent.id),
    startedAt: createdAt
  };
  await input.repositories.rounds.save(runningRound);
  const events: Event[] = [];
  events.push(
    await appendRoundEvent(input.repositories, {
      id: `evt_${roundId}_hex_started`,
      type: "hex_round_experimental_started",
      tournamentId: match.tournamentId,
      matchId: match.id,
      mapGameId: mapGame.id,
      roundId,
      createdAt,
      payload: {
        schemaVersion: 1,
        mode: "phase20_hex_round_experimental",
        mapSlug: "dust2",
        roundNumber,
        replacesLegacyRoundPath: false
      }
    })
  );

  const hexTraceArtifact = await input.artifactStore.write({
    ownerType: "round",
    ownerId: roundId,
    artifactType: "hex_round_trace",
    relativePath: `hex-round-traces/${roundId}.json`,
    content: JSON.stringify(
      {
        schemaVersion: 1,
        source: "hex_round_engine_committed",
        trace: hexTrace
      },
      null,
      2
    ),
    tournamentId: match.tournamentId,
    matchId: match.id,
    mapGameId: mapGame.id,
    roundId,
    sourceEventIds: [events[0]!.id]
  });
  events.push(
    await appendRoundEvent(input.repositories, {
      id: `evt_${roundId}_hex_trace_artifact`,
      type: "hex_round_trace_artifact_created",
      tournamentId: match.tournamentId,
      matchId: match.id,
      mapGameId: mapGame.id,
      roundId,
      createdAt,
      payload: {
        schemaVersion: 1,
        artifactId: hexTraceArtifact.id,
        source: "hex_round_engine_committed"
      }
    })
  );

  const completedRound: Round = {
    ...runningRound,
    status: "completed",
    phase: "committing",
    winnerTeamId,
    roundReportId: `report_${roundId}`,
    completedAt: createdAt
  };
  const roundReport = buildRoundReport({
    id: completedRound.roundReportId!,
    match,
    mapGame,
    round: completedRound,
    roundNumber,
    teamA,
    teamB,
    scoreBeforeRound,
    scoreAfterRound,
    winnerTeamId,
    loserTeamId,
    roundWinType,
    finalWinCondition,
    mvpAgent,
    agentOutputs,
    keyEvents,
    economyDelta,
    teamEconomyPlans,
    hexTraceArtifactId: hexTraceArtifact.id,
    createdAt,
    eventIds: [
      `evt_${roundId}_hex_started`,
      `evt_${roundId}_hex_trace_artifact`,
      `evt_${roundId}_hex_committed`,
      `evt_${roundId}_round_report_created`,
      `evt_${roundId}_round_completed`
    ]
  });
  await input.repositories.roundReports.save(roundReport);
  await input.repositories.rounds.save(completedRound);
  for (const state of economyDelta.agents.map((delta) => economyStateFromDelta(delta, mapGame.id, roundId, createdAt))) {
    await input.repositories.economyStates.save(state);
  }
  await input.repositories.mapGames.save({
    ...mapGame,
    status: mapEvaluation.state,
    teamAScore: scoreAfterRound.teamA,
    teamBScore: scoreAfterRound.teamB,
    currentRoundNumber: roundNumber,
    ...(mapEvaluation.state === "completed" ? { winnerTeamId, completedAt: createdAt } : {}),
    startedAt: mapGame.startedAt ?? createdAt
  });
  if (match.status === "scheduled") {
    await input.repositories.matches.save({ ...match, status: "running", startedAt: match.startedAt ?? createdAt });
  }

  events.push(
    await appendRoundEvent(input.repositories, {
      id: `evt_${roundId}_hex_committed`,
      type: "hex_round_experimental_committed",
      tournamentId: match.tournamentId,
      matchId: match.id,
      mapGameId: mapGame.id,
      roundId,
      createdAt,
      payload: {
        schemaVersion: 1,
        winnerTeamId,
        loserTeamId,
        roundWinType,
        hexTraceArtifactId: hexTraceArtifact.id,
        writesDb: true,
        replacesLegacyRoundPath: false
      }
    })
  );
  events.push(
    await appendRoundEvent(input.repositories, {
      id: `evt_${roundId}_round_report_created`,
      type: "round_report_created",
      tournamentId: match.tournamentId,
      matchId: match.id,
      mapGameId: mapGame.id,
      roundId,
      createdAt,
      payload: { schemaVersion: 1, roundReportId: roundReport.id, hexTraceArtifactId: hexTraceArtifact.id }
    })
  );
  events.push(
    await appendRoundEvent(input.repositories, {
      id: `evt_${roundId}_round_completed`,
      type: "round_completed",
      tournamentId: match.tournamentId,
      matchId: match.id,
      mapGameId: mapGame.id,
      roundId,
      createdAt,
      payload: { schemaVersion: 1, winnerTeamId, scoreAfterRound, source: "hex_round_engine_committed" }
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

async function buildBeforeEconomy(input: {
  repositories: Repositories;
  mapGame: MapGame;
  roundNumber: number;
  createdAt: string;
  activeAgents: Agent[];
  attackingTeamId: string;
}) {
  const latest = await input.repositories.economyStates.listLatestByMapGame(input.mapGame.id);
  const latestByAgentId = new Map(latest.map((state) => [state.agentId, state]));
  return input.activeAgents.map((agent) => {
    const side = agent.teamId === input.attackingTeamId ? "attack" : "defense";
    return isEconomyResetRound(input.roundNumber)
      ? roundStartEconomy({ agent, mapGameId: input.mapGame.id, roundNumber: input.roundNumber, createdAt: input.createdAt, side })
      : (latestByAgentId.get(agent.id) ?? initialEconomy(agent, input.mapGame.id, input.createdAt));
  });
}

function buildRoundReport(input: {
  id: string;
  match: Match;
  mapGame: MapGame;
  round: Round;
  roundNumber: number;
  teamA: Team;
  teamB: Team;
  scoreBeforeRound: ScorePair;
  scoreAfterRound: ScorePair;
  winnerTeamId: string;
  loserTeamId: string;
  roundWinType: JudgeRoundWinType;
  finalWinCondition: HexRoundTrace["finalWinCondition"];
  mvpAgent: Agent;
  agentOutputs: AgentOutput[];
  keyEvents: RoundKeyEvent[];
  economyDelta: RoundReport["economyDelta"];
  teamEconomyPlans: ReturnType<typeof decideTeamEconomyPlans>;
  hexTraceArtifactId: string;
  createdAt: string;
  eventIds: string[];
}): RoundReport {
  const judgeResult: JudgeResult = {
    winnerTeamId: input.winnerTeamId,
    loserTeamId: input.loserTeamId,
    margin: "standard",
    roundWinType: input.roundWinType,
    attackWinConditionMet: input.roundWinType.startsWith("attack_"),
    defenseWinConditionMet: input.roundWinType.startsWith("defense_"),
    reason: input.finalWinCondition.reason,
    mvpAgentId: input.mvpAgent.id,
    confidence: 0.72,
    judgeInference: {
      source: "judge_inference",
      boundary: "phase20_hex_round_experimental",
      csResolution: input.finalWinCondition.reason,
      combatNarrative: "Hex experimental commit bridges validated Hex actions, combat resolver output, and hard win condition only.",
      evidenceBasis: input.finalWinCondition.evidence
    },
    diagnostic: {
      currentSubTheme: "HexGrid experimental round",
      attackedOpportunityGap: input.finalWinCondition.reason,
      defendedCoreProposition: "HexWinConditionMaterializer hard condition",
      mainAttackZoneId: input.finalWinCondition.phaseId,
      mainDefenseZoneId: input.finalWinCondition.phaseId,
      decisiveEvidence: input.finalWinCondition.evidence.join("; ") || input.finalWinCondition.reason
    }
  };
  const totalOutputBudget = Object.values(input.teamEconomyPlans).reduce(
    (sum, plan) => sum + plan.decisions.reduce((teamSum, decision) => teamSum + decision.outputBudget, 0),
    0
  );
  const teamPostures: Record<string, EconomyPosture> = {};
  for (const plan of Object.values(input.teamEconomyPlans)) {
    teamPostures[plan.teamId] = plan.posture;
  }

  return {
    id: input.id,
    tournamentId: input.match.tournamentId,
    matchId: input.match.id,
    mapGameId: input.mapGame.id,
    roundId: input.round.id,
    roundNumber: input.roundNumber,
    mapName: input.mapGame.mapName,
    winnerTeamId: input.winnerTeamId,
    scoreBeforeRound: input.scoreBeforeRound,
    scoreAfterRound: input.scoreAfterRound,
    judgeResult,
    agentOutputs: input.agentOutputs,
    keyEvents: input.keyEvents,
    economyDelta: input.economyDelta,
    tokenSubmission: {
      activeAgentIds: input.agentOutputs.map((output) => output.agentId),
      submittedOutputIds: input.agentOutputs.map((output) => output.id),
      totalOutputBudget,
      outputGate: {
        applied: false,
        reason: "Hex experimental commit uses validated Hex trace as the audit source.",
        teamPostures
      }
    },
    highlightTags: ["phase20_hex_round_experimental", input.finalWinCondition.roundWinType ?? "hard_win_condition"],
    nodeTraceArtifactId: input.hexTraceArtifactId,
    nodeTraceSource: "hex_round_engine_committed",
    summary: `Hex experimental round R${input.roundNumber}: ${input.finalWinCondition.reason}`,
    eventProjection: {
      coreEventsLinkedByRoundReport: input.eventIds.map((eventId) => ({
        eventId,
        type: eventTypeFromId(eventId),
        required: true
      })),
      broadcastEventsCreated: []
    },
    createdAt: input.createdAt
  };
}

function buildHexRunnerAgents(input: {
  activeA: Agent[];
  activeB: Agent[];
  attackingTeamId: string;
}) {
  const allAgents = [...input.activeA, ...input.activeB];
  let c4Assigned = false;
  return allAgents.map((agent) => {
    const side = agent.teamId === input.attackingTeamId ? "attack" as const : "defense" as const;
    const carryingC4 = side === "attack" && !c4Assigned;
    if (carryingC4) {
      c4Assigned = true;
    }
    return {
      agentId: agent.id,
      teamId: agent.teamId,
      side,
      carryingC4
    };
  });
}

function buildAgentOutputs(agents: Agent[], trace: HexRoundTrace): AgentOutput[] {
  const latestActionByAgentId = new Map(
    trace.phases.flatMap((phase) => phase.commandResult.actions).map((action) => [action.agentId, action])
  );
  return agents.map((agent) => {
    const action = latestActionByAgentId.get(agent.id);
    const actionText = action
      ? `${action.phaseId}: ${agent.displayName} ${action.actionType} ${action.currentCellId}->${action.targetCellId}; ${action.businessIntent}`
      : `${agent.displayName} had no Hex action in trace.`;
    return {
      id: `hex_output_${trace.roundId}_${agent.id}`,
      agentId: agent.id,
      teamId: agent.teamId,
      role: agent.role,
      driverModelId: agent.driverModelId,
      action: actionText,
      actionDetail: {
        roundObjective: action?.businessIntent ?? "Maintain Hex experimental role.",
        executionPlan: actionText,
        coordinationPlan: "Follow HexGrid movement, AP, economy, and memory constraints.",
        roleResponsibilityUsage: `${agent.role} action constrained by Hex validator.`,
        riskRead: action?.riskNotes.join("; ") ?? "No Hex action risk note.",
        contingencyPlan: action?.fallbackReason ?? "Fallback to validated Hex trace state.",
        expectedContribution: "Contribute to Hex hard win condition evaluation.",
        confidence: action?.confidence ?? 0.72,
        fingerprint: `hex:${trace.roundId}:${agent.id}:${action?.actionType ?? "none"}`
      },
      confidence: action?.confidence ?? 0.72,
      rawFingerprint: `hex:${trace.roundId}:${agent.id}:${action?.phaseId ?? "none"}:${action?.targetCellId ?? "none"}`
    };
  });
}

function buildKeyEvents(input: {
  roundId: string;
  finalWinCondition: HexRoundTrace["finalWinCondition"];
  mvpAgent: Agent;
  winnerTeamId: string;
  agentOutputs: AgentOutput[];
}): RoundKeyEvent[] {
  const mvpOutputId = input.agentOutputs.find((output) => output.agentId === input.mvpAgent.id)?.id;
  return [
    {
      id: `key_${input.roundId}_hex_hard_win`,
      type: "conversion",
      actorAgentId: input.mvpAgent.id,
      actorTeamId: input.winnerTeamId,
      zoneId: input.finalWinCondition.phaseId,
      impact: input.finalWinCondition.reason,
      sourceAgentOutputIds: mvpOutputId ? [mvpOutputId] : []
    }
  ];
}

function selectMvpAgent(winnerAgents: Agent[], trace: HexRoundTrace): Agent {
  const sortedWinnerAgents = sortAgentsForRound(winnerAgents);
  const winnerActionAgentIds = new Set(
    trace.phases
      .flatMap((phase) => phase.commandResult.actions)
      .filter((action) => winnerAgents.some((agent) => agent.id === action.agentId))
      .map((action) => action.agentId)
  );
  return sortedWinnerAgents.find((agent) => winnerActionAgentIds.has(agent.id)) ?? sortedWinnerAgents[0]!;
}

function selectActiveAgents(agents: Agent[]): Agent[] {
  return sortAgentsForRound(agents).filter((agent) => agent.currentState === "ready").slice(0, 5);
}

function incrementScore(scoreBeforeRound: ScorePair, winnerTeamId: string, teamAId: string): ScorePair {
  return winnerTeamId === teamAId
    ? { teamA: scoreBeforeRound.teamA + 1, teamB: scoreBeforeRound.teamB }
    : { teamA: scoreBeforeRound.teamA, teamB: scoreBeforeRound.teamB + 1 };
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

function eventTypeFromId(eventId: string): Event["type"] {
  if (eventId.includes("round_report_created")) return "round_report_created";
  if (eventId.includes("round_completed")) return "round_completed";
  if (eventId.includes("hex_trace_artifact")) return "hex_round_trace_artifact_created";
  if (eventId.includes("hex_committed")) return "hex_round_experimental_committed";
  return "hex_round_experimental_started";
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
