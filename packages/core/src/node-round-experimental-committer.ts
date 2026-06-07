import type { Repositories } from "@agent-major/db";
import type {
  Agent,
  AgentOutput,
  Artifact,
  BuyType,
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

import { buildNodeEconomyResources } from "./economy-resource-adapter.js";
import {
  calculateEconomyDelta,
  decideTeamEconomyPlans,
  economyStateFromDelta,
  initialEconomy,
  isEconomyResetRound,
  roundStartEconomy
} from "./economy-output-service.js";
import { sortAgentsForRound } from "./economy-rules.js";
import { evaluateMapState, getSideContext } from "./map-rules.js";
import { loadMapNodeGraph } from "./node-graph-service.js";
import {
  createEnvNodeAgentActionDraftProvider,
  createFixtureNodeAgentActionDraftProvider,
  type NodeAgentActionProviderMode
} from "./node-agent-action-stage-runner.js";
import {
  createEnvNodeLlmDraftProvider,
  createFixtureNodeLlmDraftProvider,
  type NodeLlmProviderMode
} from "./node-llm-stage-runner.js";
import { buildNodeRoundCommittedReport, type NodeRoundCommittedReport } from "./node-round-report-bridge.js";
import type { ArtifactStore } from "./ports.js";
import {
  runNodeRoundShadow,
  runNodeRoundShadowWithAgentActionLlm,
  runNodeRoundShadowWithNodeLlm,
  type NodeRoundShadowResult
} from "./round-phase-runner.js";
import { createSideAssignment } from "./tactical-protocol.js";
import type { NodeRoundWinConditionResult, NodeRoundWinType } from "./win-condition-materializer.js";

export interface RunNodeRoundExperimentalCommitInput {
  repositories: Repositories;
  artifactStore: ArtifactStore;
  mapGameId: string;
  enableExperimentalMode: true;
  localJudgeLlmShadow?: boolean;
  localJudgeProviderMode?: Extract<NodeLlmProviderMode, "fixture" | "real">;
  maxLocalJudgeLlmCalls?: number;
  agentActionLlmShadow?: boolean;
  agentActionProviderMode?: Extract<NodeAgentActionProviderMode, "fixture" | "real">;
  maxAgentActionLlmCalls?: number;
  env?: Record<string, string | undefined>;
}

export interface NodeRoundExperimentalCommitResult {
  round: Round;
  roundReport: RoundReport;
  nodeTraceArtifact: Artifact;
  committedReport: NodeRoundCommittedReport;
  shadowResult: NodeRoundShadowResult;
  events: Event[];
}

type TransactionalRepositories = Repositories & {
  transaction?: <T>(work: () => T | Promise<T>) => Promise<T>;
};

const sourceModule = "node-round-experimental-committer";

export async function commitDust2NodeRoundExperimental(
  input: RunNodeRoundExperimentalCommitInput
): Promise<NodeRoundExperimentalCommitResult> {
  if (input.enableExperimentalMode !== true) {
    throw new Error("phase20_node_round_experimental requires explicit enableExperimentalMode=true.");
  }

  const repositories = input.repositories as TransactionalRepositories;
  const execute = repositories.transaction ? repositories.transaction.bind(repositories) : async <T>(work: () => T | Promise<T>) => work();
  return execute(() => commitDust2NodeRoundExperimentalInner(input));
}

async function commitDust2NodeRoundExperimentalInner(
  input: RunNodeRoundExperimentalCommitInput
): Promise<NodeRoundExperimentalCommitResult> {
  const createdAt = new Date().toISOString();
  const mapGame = await required(input.repositories.mapGames.getById(input.mapGameId), `Map game not found: ${input.mapGameId}`);
  if (!isDust2Map(mapGame.mapName)) {
    throw new Error(`phase20_node_round_experimental only supports Dust2; received mapName=${mapGame.mapName}`);
  }
  if (mapGame.status === "completed") {
    throw new Error(`Cannot commit experimental node round on completed map: ${mapGame.id}`);
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
    throw new Error(`Round already exists for map ${mapGame.id} R${roundNumber}; experimental commit refuses to overwrite.`);
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
  const graph = loadMapNodeGraph("dust2");
  const economyResources = buildNodeEconomyResources({
    roundNumber,
    phaseId: "default_opening",
    activeAgents: [...activeA, ...activeB],
    teamPlans: [teamEconomyPlans[teamA.id]!, teamEconomyPlans[teamB.id]!]
  });
  const baseShadowInput = {
    roundId,
    roundNumber,
    graph,
    economyResources
  };
  const shadowResult = await runExperimentalShadow(input, baseShadowInput);
  const finalWinCondition = shadowResult.finalWinCondition;
  if (!finalWinCondition?.isRoundOver || !finalWinCondition.winnerTeamId || !finalWinCondition.loserTeamId) {
    throw new Error("Node experimental round did not produce a hard final win condition; no round facts were committed.");
  }
  const winnerTeamId = finalWinCondition.winnerTeamId;
  const loserTeamId = finalWinCondition.loserTeamId;
  const roundWinType = mapNodeWinTypeToJudgeRoundWinType(finalWinCondition);
  const winnerAgents = winnerTeamId === teamA.id ? activeA : activeB;
  const mvpAgent = selectMvpAgent(winnerAgents, shadowResult);
  const agentOutputs = buildAgentOutputs([...activeA, ...activeB], shadowResult);
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
      id: `evt_${roundId}_node_started`,
      type: "node_round_experimental_started",
      tournamentId: match.tournamentId,
      matchId: match.id,
      mapGameId: mapGame.id,
      roundId,
      createdAt,
      payload: {
        schemaVersion: 1,
        mode: "phase20_node_round_experimental",
        mapSlug: "dust2",
        roundNumber,
        replacesLegacyRoundPath: false
      }
    })
  );

  const committedReport = buildNodeRoundCommittedReport({
    shadowResult,
    attackTeamId: sideAssignment.attackingTeamId,
    defenseTeamId: sideAssignment.defendingTeamId,
    attackTeamName: teamDisplayName(teamById(sideAssignment.attackingTeamId, teamA, teamB)),
    defenseTeamName: teamDisplayName(teamById(sideAssignment.defendingTeamId, teamA, teamB)),
    mapName: mapGame.mapName,
    reportId: `${roundId}:node_committed_report`
  });
  const nodeTraceArtifact = await input.artifactStore.write({
    ownerType: "round",
    ownerId: roundId,
    artifactType: "node_round_trace",
    relativePath: `node-round-traces/${roundId}.json`,
    content: JSON.stringify(
      {
        schemaVersion: 1,
        source: "node_round_engine_committed",
        committedReport,
        shadowResult
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
      id: `evt_${roundId}_node_trace_artifact`,
      type: "node_round_trace_artifact_created",
      tournamentId: match.tournamentId,
      matchId: match.id,
      mapGameId: mapGame.id,
      roundId,
      createdAt,
      payload: {
        schemaVersion: 1,
        artifactId: nodeTraceArtifact.id,
        source: "node_round_engine_committed"
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
    nodeTraceArtifactId: nodeTraceArtifact.id,
    createdAt,
    eventIds: [
      `evt_${roundId}_node_started`,
      `evt_${roundId}_node_trace_artifact`,
      `evt_${roundId}_node_committed`,
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
      id: `evt_${roundId}_node_committed`,
      type: "node_round_experimental_committed",
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
        nodeTraceArtifactId: nodeTraceArtifact.id,
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
      payload: { schemaVersion: 1, roundReportId: roundReport.id, nodeTraceArtifactId: nodeTraceArtifact.id }
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
      payload: { schemaVersion: 1, winnerTeamId, scoreAfterRound, source: "node_round_engine_committed" }
    })
  );

  return {
    round: completedRound,
    roundReport,
    nodeTraceArtifact,
    committedReport,
    shadowResult,
    events
  };
}

async function runExperimentalShadow(
  input: RunNodeRoundExperimentalCommitInput,
  baseInput: Parameters<typeof runNodeRoundShadow>[0]
): Promise<NodeRoundShadowResult> {
  const nodeLlm =
    input.localJudgeLlmShadow === true ? buildLocalJudgeLlmConfig(input) : undefined;
  const agentActionLlm =
    input.agentActionLlmShadow === true ? buildAgentActionLlmConfig(input) : undefined;

  if (nodeLlm && agentActionLlm) {
    return runNodeRoundShadowWithNodeLlm({
      ...baseInput,
      nodeLlm,
      agentActionLlm
    });
  }
  if (nodeLlm) {
    return runNodeRoundShadowWithNodeLlm({ ...baseInput, nodeLlm });
  }
  if (agentActionLlm) {
    return runNodeRoundShadowWithAgentActionLlm({ ...baseInput, agentActionLlm });
  }
  return runNodeRoundShadow(baseInput);
}

function buildLocalJudgeLlmConfig(input: RunNodeRoundExperimentalCommitInput) {
  if (input.localJudgeProviderMode === "real") {
    const providerSetup = createEnvNodeLlmDraftProvider(input.env ?? process.env);
    return {
      provider: providerSetup.provider,
      maxLlmCalls: input.maxLocalJudgeLlmCalls ?? 5,
      providerMode: providerSetup.providerMode,
      modelId: providerSetup.modelId
    };
  }
  return {
    provider: createFixtureNodeLlmDraftProvider(),
    maxLlmCalls: input.maxLocalJudgeLlmCalls ?? 5,
    providerMode: "fixture" as const,
    modelId: "fixture_node_llm"
  };
}

function buildAgentActionLlmConfig(input: RunNodeRoundExperimentalCommitInput) {
  if (input.agentActionProviderMode === "real") {
    const providerSetup = createEnvNodeAgentActionDraftProvider(input.env ?? process.env);
    return {
      provider: providerSetup.provider,
      maxLlmCalls: input.maxAgentActionLlmCalls ?? 5,
      providerMode: providerSetup.providerMode,
      modelId: providerSetup.modelId
    };
  }
  return {
    provider: createFixtureNodeAgentActionDraftProvider(),
    maxLlmCalls: input.maxAgentActionLlmCalls ?? 5,
    providerMode: "fixture" as const,
    modelId: "fixture_node_agent_action"
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
  finalWinCondition: NodeRoundWinConditionResult;
  mvpAgent: Agent;
  agentOutputs: AgentOutput[];
  keyEvents: RoundKeyEvent[];
  economyDelta: RoundReport["economyDelta"];
  teamEconomyPlans: ReturnType<typeof decideTeamEconomyPlans>;
  nodeTraceArtifactId: string;
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
      boundary: "phase20_node_round_experimental",
      csResolution: input.finalWinCondition.reason,
      combatNarrative: "节点化 experimental commit 只桥接节点行动和硬胜负条件，不伪造击杀回放。",
      evidenceBasis: input.finalWinCondition.evidence
    },
    diagnostic: {
      currentSubTheme: "节点化实验回合",
      attackedOpportunityGap: input.finalWinCondition.reason,
      defendedCoreProposition: "WinConditionMaterializer hard condition",
      mainAttackZoneId: input.finalWinCondition.nodeId ?? input.finalWinCondition.plantedNodeId ?? "dust2_node_graph",
      mainDefenseZoneId: input.finalWinCondition.nodeId ?? input.finalWinCondition.plantedNodeId ?? "dust2_node_graph",
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
        reason: "节点化 experimental commit 使用 node trace 作为审计来源，不运行旧 SubmittedOutput Gate。",
        teamPostures
      }
    },
    highlightTags: ["phase20_node_round_experimental", input.finalWinCondition.roundWinType ?? "hard_win_condition"],
    nodeTraceArtifactId: input.nodeTraceArtifactId,
    nodeTraceSource: "node_round_engine_committed",
    summary: `节点化实验回合 R${input.roundNumber}: ${input.finalWinCondition.reason}`,
    eventProjection: {
      coreEventsLinkedByRoundReport: input.eventIds.map((eventId) => ({
        eventId,
        type: eventId.includes("round_report_created")
          ? "round_report_created"
          : eventId.includes("round_completed")
            ? "round_completed"
            : eventId.includes("node_trace_artifact")
              ? "node_round_trace_artifact_created"
              : eventId.includes("node_committed")
                ? "node_round_experimental_committed"
                : "node_round_experimental_started",
        required: true
      })),
      broadcastEventsCreated: []
    },
    createdAt: input.createdAt
  };
}

function buildAgentOutputs(agents: Agent[], shadowResult: NodeRoundShadowResult): AgentOutput[] {
  const latestActionByAgentId = new Map(
    shadowResult.phases.flatMap((phase) => phase.agentActions ?? []).map((action) => [action.agentId, action])
  );
  return agents.map((agent) => {
    const action = latestActionByAgentId.get(agent.id);
    const actionText = action
      ? `${action.phaseId}: ${agent.displayName} ${action.actionType} ${action.currentNodeId}->${action.targetNodeId}; ${action.businessIntent}`
      : `${agent.displayName} held node-round experimental default posture.`;
    return {
      id: `node_output_${shadowResult.roundId}_${agent.id}`,
      agentId: agent.id,
      teamId: agent.teamId,
      role: agent.role,
      driverModelId: agent.driverModelId,
      action: actionText,
      actionDetail: {
        roundObjective: action?.businessIntent ?? "Maintain experimental node-round role.",
        executionPlan: actionText,
        coordinationPlan: action?.informationTransfer ?? "Follow node graph phase constraints.",
        roleResponsibilityUsage: `${agent.role} follows node action type ${action?.actionType ?? "hold_position"}.`,
        riskRead: action?.riskAssessment ?? "Node experimental action has no formal combat ledger.",
        contingencyPlan: action?.retreatCondition ?? "Fallback to deterministic node action if LLM shadow is invalid.",
        expectedContribution: action?.expectedResult ?? "Contribute to hard win condition evaluation.",
        confidence: 0.72,
        fingerprint: `node:${shadowResult.roundId}:${agent.id}:${action?.actionType ?? "hold"}`
      },
      confidence: 0.72,
      rawFingerprint: `node:${shadowResult.roundId}:${agent.id}:${action?.phaseId ?? "none"}:${action?.targetNodeId ?? "none"}`
    };
  });
}

function buildKeyEvents(input: {
  roundId: string;
  finalWinCondition: NodeRoundWinConditionResult;
  mvpAgent: Agent;
  winnerTeamId: string;
  agentOutputs: AgentOutput[];
}): RoundKeyEvent[] {
  const mvpOutputId = input.agentOutputs.find((output) => output.agentId === input.mvpAgent.id)?.id;
  return [
    {
      id: `key_${input.roundId}_node_hard_win`,
      type: "conversion",
      actorAgentId: input.mvpAgent.id,
      actorTeamId: input.winnerTeamId,
      zoneId: input.finalWinCondition.nodeId ?? input.finalWinCondition.plantedNodeId ?? "dust2_node_graph",
      impact: input.finalWinCondition.reason,
      sourceAgentOutputIds: mvpOutputId ? [mvpOutputId] : []
    }
  ];
}

function selectMvpAgent(winnerAgents: Agent[], shadowResult: NodeRoundShadowResult): Agent {
  const sortedWinnerAgents = sortAgentsForRound(winnerAgents);
  const winnerActionAgentIds = new Set(
    shadowResult.phases
      .flatMap((phase) => phase.agentActions ?? [])
      .filter((action) => winnerAgents.some((agent) => agent.id === action.agentId))
      .map((action) => action.agentId)
  );
  return sortedWinnerAgents.find((agent) => winnerActionAgentIds.has(agent.id)) ?? sortedWinnerAgents[0]!;
}

function selectActiveAgents(agents: Agent[]): Agent[] {
  return sortAgentsForRound(agents).filter((agent) => agent.currentState === "ready").slice(0, 5);
}

function mapNodeWinTypeToJudgeRoundWinType(finalWinCondition: NodeRoundWinConditionResult): JudgeRoundWinType {
  const winType = finalWinCondition.roundWinType as NodeRoundWinType | undefined;
  if (winType === "bomb_exploded") {
    return "attack_bomb_explosion";
  }
  if (winType === "defuse") {
    return "defense_defuse";
  }
  if (winType === "timeout") {
    return "defense_timeout_no_plant";
  }
  return finalWinCondition.winnerSide === "attack" ? "attack_elimination" : "defense_elimination";
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

function teamById(teamId: string, teamA: Team, teamB: Team): Team {
  return teamId === teamA.id ? teamA : teamB;
}

function teamDisplayName(team: Team): string {
  return team.displayName || team.shortName || team.id;
}
