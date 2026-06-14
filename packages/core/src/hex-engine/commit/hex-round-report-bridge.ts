import type {
  Agent,
  AgentOutput,
  EconomyPosture,
  Event,
  JudgeResult,
  JudgeRoundWinType,
  MapGame,
  Match,
  Round,
  RoundKillLedgerEntry,
  RoundKeyEvent,
  RoundReport,
  ScorePair,
  Team
} from "@agent-major/shared";

import { sortAgentsForRound, type TeamEconomyPlan } from "../../economy/economy-rules.js";
import type { HexRoundTrace } from "../round/index.js";

export interface BuildHexRoundReportInput {
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
  winnerAgents: Agent[];
  activeAgents: Agent[];
  economyDelta: RoundReport["economyDelta"];
  teamEconomyPlans: Record<string, TeamEconomyPlan>;
  hexTraceArtifactId: string;
  createdAt: string;
  eventIds: string[];
  hexTrace: HexRoundTrace;
}

export function buildHexRoundReport(input: BuildHexRoundReportInput): RoundReport {
  const mvpAgent = selectMvpAgent(input.winnerAgents, input.hexTrace);
  const agentOutputs = buildAgentOutputs(input.activeAgents, input.hexTrace);
  const killLedger = buildKillLedger(input.hexTrace, agentOutputs);
  const keyEvents = buildKeyEvents({
    roundId: input.round.id,
    finalWinCondition: input.finalWinCondition,
    mvpAgent,
    winnerTeamId: input.winnerTeamId,
    agentOutputs
  });
  const judgeResult: JudgeResult = {
    winnerTeamId: input.winnerTeamId,
    loserTeamId: input.loserTeamId,
    margin: "standard",
    roundWinType: input.roundWinType,
    attackWinConditionMet: input.roundWinType.startsWith("attack_"),
    defenseWinConditionMet: input.roundWinType.startsWith("defense_"),
    reason: input.finalWinCondition.reason,
    mvpAgentId: mvpAgent.id,
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
    agentOutputs,
    keyEvents,
    ...(killLedger.length > 0 ? { killLedger } : {}),
    economyDelta: input.economyDelta,
    tokenSubmission: {
      activeAgentIds: agentOutputs.map((output) => output.agentId),
      submittedOutputIds: agentOutputs.map((output) => output.id),
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

function buildKillLedger(trace: HexRoundTrace, agentOutputs: AgentOutput[]): RoundKillLedgerEntry[] {
  const outputIdByAgentId = new Map(agentOutputs.map((output) => [output.agentId, output.id]));
  const entries: RoundKillLedgerEntry[] = [];
  for (const phase of trace.phases) {
    for (const resolution of phase.combatResolutions) {
      for (const casualty of resolution.casualties) {
        if (casualty.result !== "killed" || !casualty.killerAgentId) {
          continue;
        }
        const killer = resolution.participants.find((participant) => participant.agentId === casualty.killerAgentId);
        if (!killer) {
          continue;
        }
        entries.push({
          id: `hex_kill_${trace.roundId}_${phase.phaseIndex}_${entries.length}`,
          actorAgentId: casualty.killerAgentId,
          actorTeamId: killer.teamId,
          targetAgentId: casualty.targetAgentId,
          targetTeamId: casualty.teamId,
          zoneId: resolution.regionControlHint === "neutral"
            ? phase.phaseId
            : (resolution.regionControlHint === "attack" || resolution.regionControlHint === "defense"
              ? resolution.contactId
              : phase.phaseId),
          atMs: phase.phaseIndex * 15000 + entries.length * 1000,
          impact: `${resolution.financeVerdict ?? resolution.businessVerdict}: ${casualty.reason}`,
          sourceAgentOutputIds: [outputIdByAgentId.get(casualty.killerAgentId)].filter((value): value is string => Boolean(value))
        });
      }
    }
  }
  return entries;
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
        roundObjective: nonEmptyText(action?.businessIntent, "Maintain Hex experimental role."),
        executionPlan: actionText,
        coordinationPlan: "Follow HexGrid movement, AP, economy, and memory constraints.",
        roleResponsibilityUsage: `${agent.role} action constrained by Hex validator.`,
        riskRead: nonEmptyText(action?.riskNotes.join("; "), "No Hex action risk note."),
        contingencyPlan: nonEmptyText(action?.fallbackReason, "Fallback to validated Hex trace state."),
        expectedContribution: "Contribute to Hex hard win condition evaluation.",
        confidence: action?.confidence ?? 0.72,
        fingerprint: `hex:${trace.roundId}:${agent.id}:${action?.actionType ?? "none"}`
      },
      confidence: action?.confidence ?? 0.72,
      rawFingerprint: `hex:${trace.roundId}:${agent.id}:${action?.phaseId ?? "none"}:${action?.targetCellId ?? "none"}`
    };
  });
}

function nonEmptyText(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
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

function eventTypeFromId(eventId: string): Event["type"] {
  if (eventId.includes("round_report_created")) return "round_report_created";
  if (eventId.includes("round_completed")) return "round_completed";
  if (eventId.includes("hex_trace_artifact")) return "hex_round_trace_artifact_created";
  if (eventId.includes("hex_committed")) return "hex_round_experimental_committed";
  return "hex_round_experimental_started";
}
