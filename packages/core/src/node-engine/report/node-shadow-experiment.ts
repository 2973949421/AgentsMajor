import type { Agent, EconomyPosture, LoadoutPackage } from "@agent-major/shared";

import { buildNodeEconomyResources } from "../economy/economy-resource-adapter.js";
import type { TeamEconomyPlan } from "../../economy/economy-rules.js";
import { loadMapNodeGraph } from "../graph/node-graph-service.js";
import {
  createEnvNodeAgentActionDraftProvider,
  createFixtureNodeAgentActionDraftProvider,
  type NodeAgentActionDraftProvider,
  type NodeAgentActionProviderMode
} from "../action/node-agent-action-stage-runner.js";
import {
  createEnvNodeLlmDraftProvider,
  createFixtureNodeLlmDraftProvider,
  type NodeLlmDraftProvider,
  type NodeLlmProviderMode
} from "../judge/node-llm-stage-runner.js";
import { buildNodeRoundShadowReport, type NodeRoundShadowReport } from "./node-round-report-bridge.js";
import {
  runNodeRoundShadow,
  runNodeRoundShadowWithAgentActionLlm,
  runNodeRoundShadowWithNodeLlm,
  type NodeRoundShadowResult
} from "../phase/round-phase-runner.js";

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
  llmShadowEnabled: boolean;
  providerMode: NodeLlmProviderMode;
  modelId?: string;
  llmCallsAttempted: number;
  llmFallbackCount: number;
  fallbackReasons: string[];
  ignoredLlmFields: string[];
  draftValidCount: number;
  draftRejectedCount: number;
  contentLength: number;
  reasoningContentLength: number;
  jsonTruncated: boolean;
  reasoningExhausted: boolean;
  agentActionLlmEnabled: boolean;
  agentActionProviderMode: NodeAgentActionProviderMode;
  agentActionModelId?: string;
  agentActionCallsAttempted: number;
  agentActionFallbackCount: number;
  agentActionFallbackReasons: string[];
  agentActionIgnoredFields: string[];
  agentActionDraftAcceptedCount: number;
  agentActionDraftRejectedCount: number;
  agentActionContentLength: number;
  agentActionReasoningContentLength: number;
  agentActionJsonTruncated: boolean;
  agentActionReasoningExhausted: boolean;
}

export interface RunDust2NodeShadowExperimentOptions {
  llmShadow?: boolean;
  providerMode?: Extract<NodeLlmProviderMode, "fixture" | "real">;
  maxLlmCalls?: number;
  nodeLlmProvider?: NodeLlmDraftProvider;
  agentActionLlmShadow?: boolean;
  agentActionProviderMode?: Extract<NodeAgentActionProviderMode, "fixture" | "real">;
  maxAgentActionLlmCalls?: number;
  nodeAgentActionProvider?: NodeAgentActionDraftProvider;
  env?: Record<string, string | undefined>;
}

export function runDust2NodeShadowExperiment(): Dust2NodeShadowExperimentResult {
  return buildExperimentResult(runDeterministicShadowRound());
}

export async function runDust2NodeShadowExperimentAsync(
  options: RunDust2NodeShadowExperimentOptions = {}
): Promise<Dust2NodeShadowExperimentResult> {
  if (!options.llmShadow && !options.agentActionLlmShadow) {
    return runDust2NodeShadowExperiment();
  }

  const fixture = buildExperimentFixture();
  const nodeProviderSetup = options.llmShadow ? resolveNodeLlmProvider(options) : undefined;
  const agentActionProviderSetup = options.agentActionLlmShadow ? resolveNodeAgentActionProvider(options) : undefined;
  const baseInput = {
    roundId: "dust2_node_shadow_round_1",
    roundNumber: 1,
    graph: fixture.graph,
    economyResources: fixture.economyResources
  };
  const shadowResult =
    nodeProviderSetup && agentActionProviderSetup
      ? await runNodeRoundShadowWithNodeLlm({
          ...baseInput,
          nodeLlm: {
            provider: nodeProviderSetup.provider,
            maxLlmCalls: options.maxLlmCalls ?? 5,
            providerMode: nodeProviderSetup.providerMode,
            modelId: nodeProviderSetup.modelId
          },
          agentActionLlm: {
            provider: agentActionProviderSetup.provider,
            maxLlmCalls: options.maxAgentActionLlmCalls ?? 5,
            providerMode: agentActionProviderSetup.providerMode,
            modelId: agentActionProviderSetup.modelId
          }
        })
      : nodeProviderSetup
        ? await runNodeRoundShadowWithNodeLlm({
            ...baseInput,
            nodeLlm: {
              provider: nodeProviderSetup.provider,
              maxLlmCalls: options.maxLlmCalls ?? 5,
              providerMode: nodeProviderSetup.providerMode,
              modelId: nodeProviderSetup.modelId
            }
          })
        : await runNodeRoundShadowWithAgentActionLlm({
            ...baseInput,
            agentActionLlm: {
              provider: agentActionProviderSetup!.provider,
              maxLlmCalls: options.maxAgentActionLlmCalls ?? 5,
              providerMode: agentActionProviderSetup!.providerMode,
              modelId: agentActionProviderSetup!.modelId
            }
          });
  return buildExperimentResult(shadowResult);
}

function runDeterministicShadowRound(): NodeRoundShadowResult {
  const fixture = buildExperimentFixture();
  return runNodeRoundShadow({
    roundId: "dust2_node_shadow_round_1",
    roundNumber: 1,
    graph: fixture.graph,
    economyResources: fixture.economyResources
  });
}

function buildExperimentFixture() {
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
  return { graph, economyResources };
}

function buildExperimentResult(shadowResult: NodeRoundShadowResult): Dust2NodeShadowExperimentResult {
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
      endedEarly: report.phaseCount < 5,
      status: report.status,
      llmShadowEnabled: report.audit.llmShadowEnabled,
      providerMode: report.audit.providerMode,
      ...(report.audit.modelId ? { modelId: report.audit.modelId } : {}),
      llmCallsAttempted: report.audit.llmCallsAttempted,
      llmFallbackCount: report.audit.llmFallbackCount,
      fallbackReasons: report.audit.fallbackReasons,
      ignoredLlmFields: report.audit.ignoredLlmFields,
      draftValidCount: report.audit.draftValidCount,
      draftRejectedCount: report.audit.draftRejectedCount,
      contentLength: report.audit.contentLength,
      reasoningContentLength: report.audit.reasoningContentLength,
      jsonTruncated: report.audit.jsonTruncated,
      reasoningExhausted: report.audit.reasoningExhausted,
      agentActionLlmEnabled: report.audit.agentActionLlmEnabled,
      agentActionProviderMode: report.audit.agentActionProviderMode,
      ...(report.audit.agentActionModelId ? { agentActionModelId: report.audit.agentActionModelId } : {}),
      agentActionCallsAttempted: report.audit.agentActionCallsAttempted,
      agentActionFallbackCount: report.audit.agentActionFallbackCount,
      agentActionFallbackReasons: report.audit.agentActionFallbackReasons,
      agentActionIgnoredFields: report.audit.agentActionIgnoredFields,
      agentActionDraftAcceptedCount: report.audit.agentActionDraftAcceptedCount,
      agentActionDraftRejectedCount: report.audit.agentActionDraftRejectedCount,
      agentActionContentLength: report.audit.agentActionContentLength,
      agentActionReasoningContentLength: report.audit.agentActionReasoningContentLength,
      agentActionJsonTruncated: report.audit.agentActionJsonTruncated,
      agentActionReasoningExhausted: report.audit.agentActionReasoningExhausted
    }
  };
}

function resolveNodeLlmProvider(options: RunDust2NodeShadowExperimentOptions): {
  provider: NodeLlmDraftProvider;
  providerMode: Extract<NodeLlmProviderMode, "fixture" | "real">;
  modelId: string;
} {
  if (options.nodeLlmProvider) {
    return {
      provider: options.nodeLlmProvider,
      providerMode: options.providerMode ?? "fixture",
      modelId: options.providerMode === "real" ? "custom_real_node_llm" : "custom_fixture_node_llm"
    };
  }
  if (options.providerMode === "real") {
    return createEnvNodeLlmDraftProvider(options.env ?? process.env);
  }
  return {
    provider: createFixtureNodeLlmDraftProvider(),
    providerMode: "fixture",
    modelId: "fixture_node_llm"
  };
}

function resolveNodeAgentActionProvider(options: RunDust2NodeShadowExperimentOptions): {
  provider: NodeAgentActionDraftProvider;
  providerMode: Extract<NodeAgentActionProviderMode, "fixture" | "real">;
  modelId: string;
} {
  if (options.nodeAgentActionProvider) {
    return {
      provider: options.nodeAgentActionProvider,
      providerMode: options.agentActionProviderMode ?? "fixture",
      modelId: options.agentActionProviderMode === "real" ? "custom_real_node_agent_action" : "custom_fixture_node_agent_action"
    };
  }
  if (options.agentActionProviderMode === "real") {
    return createEnvNodeAgentActionDraftProvider(options.env ?? process.env);
  }
  return {
    provider: createFixtureNodeAgentActionDraftProvider(),
    providerMode: "fixture",
    modelId: "fixture_node_agent_action"
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
