import type { Agent, EconomyPosture, LoadoutPackage } from "@agent-major/shared";

import { buildNodeEconomyResources } from "./economy-resource-adapter.js";
import type { TeamEconomyPlan } from "./economy-rules.js";
import { loadMapNodeGraph } from "./node-graph-service.js";
import { buildNodeRoundShadowReport, type NodeRoundShadowReport } from "./node-round-report-bridge.js";
import { runNodeRoundShadow, type NodeRoundShadowResult } from "./round-phase-runner.js";

export interface Dust2NodeShadowExperimentResult {
  shadowResult: NodeRoundShadowResult;
  report: NodeRoundShadowReport;
  summary: Dust2NodeShadowExperimentSummary;
}

export interface Dust2NodeShadowExperimentSummary {
  source: "node_round_engine_shadow";
  roundId: string;
  phaseCount: number;
  finalWinnerSide?: "attack" | "defense";
  finalWinnerTeamId?: string;
  finalRoundWinType?: string;
  finalBombState?: string;
  activeNodeCount: number;
  endedEarly: boolean;
  status: "complete" | "incomplete";
}

export function runDust2NodeShadowExperiment(): Dust2NodeShadowExperimentResult {
  const attackAgents = buildAgents("team_attack", "attack_agent");
  const defenseAgents = buildAgents("team_defense", "defense_agent");
  const economyResources = buildNodeEconomyResources({
    roundNumber: 1,
    phaseId: "default_opening",
    activeAgents: [...attackAgents, ...defenseAgents],
    teamPlans: [
      buildTeamEconomyPlan("team_attack", "attack", "rifle_buy", "rifle_full_t_pack", attackAgents.map((agent) => agent.id)),
      buildTeamEconomyPlan("team_defense", "defense", "rifle_buy", "rifle_full_ct_pack", defenseAgents.map((agent) => agent.id))
    ]
  });
  const graph = loadMapNodeGraph("dust2");
  const shadowResult = runNodeRoundShadow({
    roundId: "dust2_node_shadow_round_1",
    roundNumber: 1,
    graph,
    economyResources
  });
  const report = buildNodeRoundShadowReport({
    shadowResult,
    attackTeamId: "team_attack",
    defenseTeamId: "team_defense",
    attackTeamName: "Shadow Attack",
    defenseTeamName: "Shadow Defense",
    mapName: "Dust2"
  });

  return {
    shadowResult,
    report,
    summary: {
      source: report.source,
      roundId: report.roundId,
      phaseCount: report.phaseCount,
      ...(report.finalWinCondition?.winnerSide ? { finalWinnerSide: report.finalWinCondition.winnerSide } : {}),
      ...(report.finalWinCondition?.winnerTeamId ? { finalWinnerTeamId: report.finalWinCondition.winnerTeamId } : {}),
      ...(report.finalWinCondition?.roundWinType ? { finalRoundWinType: report.finalWinCondition.roundWinType } : {}),
      ...(report.finalWinCondition?.bombState ? { finalBombState: report.finalWinCondition.bombState } : {}),
      activeNodeCount: Math.max(...report.phaseSummaries.map((phase) => phase.activeNodeCount), 0),
      endedEarly: report.phaseCount < graph.timing_model.round_phases.length,
      status: report.status
    }
  };
}

function buildTeamEconomyPlan(
  teamId: string,
  side: "attack" | "defense",
  posture: EconomyPosture,
  loadoutPackage: LoadoutPackage,
  agentIds: string[]
): TeamEconomyPlan {
  return {
    teamId,
    side,
    phase: "gun_round",
    lossCount: 0,
    posture,
    postureReason: "node shadow experiment baseline rifle resources",
    summaryBuyType: "fullBuy",
    totalCash: 25000,
    dropDecisions: [],
    decisions: agentIds.map((agentId) => ({
      agentId,
      teamId,
      tokenBankBefore: 5000,
      tokenBankAfterDrop: 5000,
      buyType: "fullBuy",
      economyPosture: posture,
      loadoutPackage,
      spend: 5000,
      outputBudget: 1200,
      dropSent: 0,
      dropReceived: 0,
      notes: []
    }))
  };
}

function buildAgents(teamId: string, prefix: string): Agent[] {
  return ["entry", "star_rifler", "awper", "igl", "support"].map((role, index) => ({
    id: `${prefix}_${index + 1}`,
    teamId,
    driverModelId: "driver_node_shadow",
    role,
    displayName: `${prefix}_${index + 1}`,
    baseProfile: {},
    currentState: "ready",
    createdAt: "2026-06-06T00:00:00.000Z",
    updatedAt: "2026-06-06T00:00:00.000Z"
  })) as Agent[];
}
