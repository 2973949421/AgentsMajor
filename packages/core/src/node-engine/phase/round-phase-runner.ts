import type { MapNodeGraph, MapNodeState, RoundNodeStateSnapshot, RoundPhaseId } from "@agent-major/shared";

import { getReachableNodes } from "../graph/node-graph-service.js";
import type { NodeAgentEconomyResource, NodeRoundEconomyResources } from "../economy/economy-resource-adapter.js";
import { buildAgentPhaseActions } from "../action/agent-phase-action-pipeline.js";
import { buildActionPointBudgetsFromActions } from "../action/node-action-validator.js";
import { buildLocalNodeVerdicts } from "../judge/local-node-judge-pipeline.js";
import { materializeNodeStateTransition } from "../state/node-state-materializer.js";
import {
  runNodeLlmShadowStage,
  type NodeLlmDraftProvider,
  type NodeLlmProviderMode,
  type NodeLlmShadowStageAudit
} from "../judge/node-llm-stage-runner.js";
import {
  runNodeAgentActionShadowStage,
  type NodeAgentActionDraftProvider,
  type NodeAgentActionLlmStageAudit,
  type NodeAgentActionProviderMode
} from "../action/node-agent-action-stage-runner.js";
import type { NodeTeamContext } from "../team-context/node-team-context-service.js";
import { evaluateNodeRoundWinCondition, type NodeRoundWinConditionResult, type NodeRoundWinConditionState } from "../state/win-condition-materializer.js";

export interface RunNodeRoundShadowInput {
  roundId: string;
  roundNumber: number;
  graph: MapNodeGraph;
  economyResources: NodeRoundEconomyResources;
  teamContexts?: Record<string, NodeTeamContext>;
}

export interface RunNodeRoundShadowWithNodeLlmInput extends RunNodeRoundShadowInput {
  nodeLlm: {
    provider: NodeLlmDraftProvider;
    maxLlmCalls: number;
    providerMode?: NodeLlmProviderMode;
    modelId?: string;
  };
  agentActionLlm?: NodeRoundAgentActionLlmConfig;
}

export interface RunNodeRoundShadowWithAgentActionLlmInput extends RunNodeRoundShadowInput {
  agentActionLlm: NodeRoundAgentActionLlmConfig;
  nodeLlm?: {
    provider: NodeLlmDraftProvider;
    maxLlmCalls: number;
    providerMode?: NodeLlmProviderMode;
    modelId?: string;
  };
}

interface RunNodeRoundShadowWithAnyLlmInput extends RunNodeRoundShadowInput {
  nodeLlm?: RunNodeRoundShadowWithNodeLlmInput["nodeLlm"];
  agentActionLlm?: NodeRoundAgentActionLlmConfig;
}

export interface NodeRoundAgentActionLlmConfig {
  provider: NodeAgentActionDraftProvider;
  maxLlmCalls: number;
  providerMode?: NodeAgentActionProviderMode;
  modelId?: string;
}

export interface NodeRoundLlmShadowAudit {
  enabled: boolean;
  providerMode: NodeLlmProviderMode;
  modelId?: string;
  callsAttempted: number;
  fallbackCount: number;
  fallbackReasons: string[];
  ignoredFields: string[];
  draftValidCount: number;
  draftRejectedCount: number;
  contentLength: number;
  reasoningContentLength: number;
  jsonTruncated: boolean;
  reasoningExhausted: boolean;
}

export interface NodeRoundAgentActionLlmShadowAudit {
  enabled: boolean;
  providerMode: NodeAgentActionProviderMode;
  modelId?: string;
  callsAttempted: number;
  fallbackCount: number;
  fallbackReasons: string[];
  ignoredFields: string[];
  draftAcceptedCount: number;
  draftRejectedCount: number;
  contentLength: number;
  reasoningContentLength: number;
  jsonTruncated: boolean;
  reasoningExhausted: boolean;
}

export interface NodeRoundShadowResult {
  roundId: string;
  roundNumber: number;
  mapSlug: string;
  graphAssetId: string;
  mode: "shadow";
  phases: NodeRoundPhaseSnapshot[];
  resourceSnapshot: NodeRoundEconomyResources;
  finalWinCondition?: NodeRoundWinConditionResult;
  nodeLlmAudit?: NodeRoundLlmShadowAudit;
  agentActionLlmAudit?: NodeRoundAgentActionLlmShadowAudit;
  notes: string[];
}

export type NodeRoundPhaseSnapshot = RoundNodeStateSnapshot & {
  winConditionCheck: NodeRoundWinConditionResult;
  nodeLlmAudit?: NodeLlmShadowStageAudit;
  agentActionLlmAudit?: NodeAgentActionLlmStageAudit;
  transitionNotes?: string[];
};

const attackPreferredNodesByPhase: Record<RoundPhaseId, string[]> = {
  default_opening: ["t_spawn", "outside_long", "top_mid", "outside_tunnels", "upper_tunnels"],
  first_contact: ["long_doors", "top_mid", "mid", "upper_tunnels", "b_tunnel_exit"],
  mid_round_decision: ["mid", "a_long", "cat", "b_site", "mid_doors"],
  execute_or_retake: ["a_default", "b_default", "a_ramp", "b_site", "b_doors"],
  post_plant_or_clutch: ["a_safe", "b_back_site", "b_doors", "ct_spawn", "b_window"]
};

const defensePreferredNodesByPhase: Record<RoundPhaseId, string[]> = {
  default_opening: ["a_default", "b_default", "mid_doors", "a_short", "b_window"],
  first_contact: ["long_corner", "mid", "b_tunnel_exit", "short_stairs", "lower_tunnels"],
  mid_round_decision: ["xbox", "top_mid", "upper_tunnels", "outside_tunnels", "mid"],
  execute_or_retake: ["ct_spawn", "a_ramp", "b_doors", "b_window", "a_short"],
  post_plant_or_clutch: ["ct_spawn", "a_default", "b_default", "t_spawn", "b_window"]
};

export function runNodeRoundShadow(input: RunNodeRoundShadowInput): NodeRoundShadowResult {
  const phases: NodeRoundPhaseSnapshot[] = [];
  const sortedPhases = [...input.graph.timing_model.round_phases].sort((left, right) => left.phase_index - right.phase_index);
  let previousSnapshot: NodeRoundPhaseSnapshot | undefined;
  let winConditionState: NodeRoundWinConditionState = { bombState: "not_planted" };

  for (const phase of sortedPhases) {
    const phaseSnapshot = previousSnapshot
      ? buildMaterializedPhaseSnapshot(input, phase.id, previousSnapshot, winConditionState)
      : buildInitialPhaseSnapshot(input, phase.id, winConditionState);
    phases.push(phaseSnapshot);
    previousSnapshot = phaseSnapshot;
    winConditionState = nextWinConditionState(phaseSnapshot.winConditionCheck);
    if (phaseSnapshot.winConditionCheck.isRoundOver) {
      break;
    }
  }

  const finalWinCondition = phases.find((phase) => phase.winConditionCheck.isRoundOver)?.winConditionCheck;

  return {
    roundId: input.roundId,
    roundNumber: input.roundNumber,
    mapSlug: input.graph.map_slug,
    graphAssetId: input.graph.asset_id,
    mode: "shadow",
    phases,
    resourceSnapshot: input.economyResources,
    ...(finalWinCondition ? { finalWinCondition } : {}),
    notes: [
      "节点�?shadow runner 只生成阶段轨迹，不写正式 winner�?",
      "本结果不调用 LLM、不�?DB、不替换旧回合提交路径�?"
    ]
  };
}

export async function runNodeRoundShadowWithNodeLlm(input: RunNodeRoundShadowWithNodeLlmInput): Promise<NodeRoundShadowResult> {
  return runNodeRoundShadowWithAnyLlm(input);
}

export async function runNodeRoundShadowWithAgentActionLlm(input: RunNodeRoundShadowWithAgentActionLlmInput): Promise<NodeRoundShadowResult> {
  return runNodeRoundShadowWithAnyLlm(input);
}

async function runNodeRoundShadowWithAnyLlm(input: RunNodeRoundShadowWithAnyLlmInput): Promise<NodeRoundShadowResult> {
  const phases: NodeRoundPhaseSnapshot[] = [];
  const sortedPhases = [...input.graph.timing_model.round_phases].sort((left, right) => left.phase_index - right.phase_index);
  let previousSnapshot: NodeRoundPhaseSnapshot | undefined;
  let winConditionState: NodeRoundWinConditionState = { bombState: "not_planted" };
  const nodeLlmAudit = input.nodeLlm ? buildEmptyNodeLlmAudit(input.nodeLlm) : undefined;
  const agentActionLlmAudit = input.agentActionLlm ? buildEmptyAgentActionLlmAudit(input.agentActionLlm) : undefined;

  for (const phase of sortedPhases) {
    const phaseSnapshot = previousSnapshot
      ? await buildMaterializedPhaseSnapshotWithNodeLlm(input, phase.id, previousSnapshot, winConditionState, nodeLlmAudit, agentActionLlmAudit)
      : await buildInitialPhaseSnapshotWithNodeLlm(input, phase.id, winConditionState, nodeLlmAudit, agentActionLlmAudit);
    phases.push(phaseSnapshot);
    previousSnapshot = phaseSnapshot;
    winConditionState = nextWinConditionState(phaseSnapshot.winConditionCheck);
    if (phaseSnapshot.winConditionCheck.isRoundOver) {
      break;
    }
  }

  const finalWinCondition = phases.find((phase) => phase.winConditionCheck.isRoundOver)?.winConditionCheck;

  return {
    roundId: input.roundId,
    roundNumber: input.roundNumber,
    mapSlug: input.graph.map_slug,
    graphAssetId: input.graph.asset_id,
    mode: "shadow",
    phases,
    resourceSnapshot: input.economyResources,
    ...(finalWinCondition ? { finalWinCondition } : {}),
    ...(nodeLlmAudit ? { nodeLlmAudit } : {}),
    ...(agentActionLlmAudit ? { agentActionLlmAudit } : {}),
    notes: [
      "node shadow runner only emits phase trace; no formal winner.",
      ...(nodeLlmAudit ? ["local node judge LLM shadow enabled; output remains draft only."] : []),
      ...(agentActionLlmAudit ? ["agent action LLM shadow enabled; output remains draft only."] : []),
      "result does not write DB or replace legacy round commit path."
    ]
  };
}

function buildInitialPhaseSnapshot(
  input: RunNodeRoundShadowInput,
  phaseId: RoundPhaseId,
  previousWinConditionState: NodeRoundWinConditionState
): NodeRoundPhaseSnapshot {
  const attackResources = input.economyResources.agents.filter((resource) => resource.side === "attack");
  const defenseResources = input.economyResources.agents.filter((resource) => resource.side === "defense");
  const attackReachable = getReachableNodes(input.graph, "attack", phaseId);
  const defenseReachable = getReachableNodes(input.graph, "defense", phaseId);
  const attackAssignments = assignAgentsToNodes(attackResources, phaseId, "attack", attackReachable);
  const defenseAssignments = assignAgentsToNodes(defenseResources, phaseId, "defense", defenseReachable);
  const activeNodeIds = uniqueSorted([
    ...attackReachable,
    ...defenseReachable,
    ...Object.keys(attackAssignments),
    ...Object.keys(defenseAssignments)
  ]);

  const nodeStates = activeNodeIds.map((nodeId) =>
    buildNodeState({
      phaseId,
      nodeId,
      attackAgentIds: attackAssignments[nodeId] ?? [],
      defenseAgentIds: defenseAssignments[nodeId] ?? []
    })
  );

  const baseSnapshot: RoundNodeStateSnapshot = {
    roundId: input.roundId,
    phaseId,
    activeNodeIds,
    nodeStates
  };
  return attachActionsVerdictsAndWinCondition(input, baseSnapshot, input.economyResources, previousWinConditionState);
}

async function buildInitialPhaseSnapshotWithNodeLlm(
  input: RunNodeRoundShadowWithAnyLlmInput,
  phaseId: RoundPhaseId,
  previousWinConditionState: NodeRoundWinConditionState,
  audit: NodeRoundLlmShadowAudit | undefined,
  agentActionAudit: NodeRoundAgentActionLlmShadowAudit | undefined
): Promise<NodeRoundPhaseSnapshot> {
  const attackResources = input.economyResources.agents.filter((resource) => resource.side === "attack");
  const defenseResources = input.economyResources.agents.filter((resource) => resource.side === "defense");
  const attackReachable = getReachableNodes(input.graph, "attack", phaseId);
  const defenseReachable = getReachableNodes(input.graph, "defense", phaseId);
  const attackAssignments = assignAgentsToNodes(attackResources, phaseId, "attack", attackReachable);
  const defenseAssignments = assignAgentsToNodes(defenseResources, phaseId, "defense", defenseReachable);
  const activeNodeIds = uniqueSorted([
    ...attackReachable,
    ...defenseReachable,
    ...Object.keys(attackAssignments),
    ...Object.keys(defenseAssignments)
  ]);

  const nodeStates = activeNodeIds.map((nodeId) =>
    buildNodeState({
      phaseId,
      nodeId,
      attackAgentIds: attackAssignments[nodeId] ?? [],
      defenseAgentIds: defenseAssignments[nodeId] ?? []
    })
  );

  const baseSnapshot: RoundNodeStateSnapshot = {
    roundId: input.roundId,
    phaseId,
    activeNodeIds,
    nodeStates
  };
  return attachActionsVerdictsAndWinConditionWithNodeLlm(input, baseSnapshot, input.economyResources, previousWinConditionState, audit, agentActionAudit);
}

function buildMaterializedPhaseSnapshot(
  input: RunNodeRoundShadowInput,
  phaseId: RoundPhaseId,
  previousSnapshot: NodeRoundPhaseSnapshot,
  previousWinConditionState: NodeRoundWinConditionState
): NodeRoundPhaseSnapshot {
  const transition = materializeNodeStateTransition({
    graph: input.graph,
    previousSnapshot,
    previousAgentActions: previousSnapshot.agentActions ?? [],
    previousLocalVerdicts: previousSnapshot.localVerdicts ?? [],
    economyResources: input.economyResources,
    nextPhaseId: phaseId
  });
  const phaseResources = filterResourcesByLiveAgents(input.economyResources, transition.liveAgentIds);
  const baseSnapshot: RoundNodeStateSnapshot = {
    roundId: input.roundId,
    phaseId,
    activeNodeIds: transition.activeNodeIds,
    nodeStates: transition.nodeStates
  };
  return {
    ...attachActionsVerdictsAndWinCondition(input, baseSnapshot, phaseResources, previousWinConditionState),
    transitionNotes: transition.notes
  };
}

async function buildMaterializedPhaseSnapshotWithNodeLlm(
  input: RunNodeRoundShadowWithAnyLlmInput,
  phaseId: RoundPhaseId,
  previousSnapshot: NodeRoundPhaseSnapshot,
  previousWinConditionState: NodeRoundWinConditionState,
  audit: NodeRoundLlmShadowAudit | undefined,
  agentActionAudit: NodeRoundAgentActionLlmShadowAudit | undefined
): Promise<NodeRoundPhaseSnapshot> {
  const transition = materializeNodeStateTransition({
    graph: input.graph,
    previousSnapshot,
    previousAgentActions: previousSnapshot.agentActions ?? [],
    previousLocalVerdicts: previousSnapshot.localVerdicts ?? [],
    economyResources: input.economyResources,
    nextPhaseId: phaseId
  });
  const phaseResources = filterResourcesByLiveAgents(input.economyResources, transition.liveAgentIds);
  const baseSnapshot: RoundNodeStateSnapshot = {
    roundId: input.roundId,
    phaseId,
    activeNodeIds: transition.activeNodeIds,
    nodeStates: transition.nodeStates
  };
  return {
    ...(await attachActionsVerdictsAndWinConditionWithNodeLlm(input, baseSnapshot, phaseResources, previousWinConditionState, audit, agentActionAudit)),
    transitionNotes: transition.notes
  };
}

function attachActionsVerdictsAndWinCondition(
  input: RunNodeRoundShadowInput,
  baseSnapshot: RoundNodeStateSnapshot,
  economyResources: NodeRoundEconomyResources,
  previousWinConditionState: NodeRoundWinConditionState
): NodeRoundPhaseSnapshot {
  const agentActions = buildAgentPhaseActions({
    graph: input.graph,
    phaseSnapshot: baseSnapshot,
    economyResources,
    ...(input.teamContexts ? { teamContexts: input.teamContexts } : {})
  });
  const localVerdicts = buildLocalNodeVerdicts({
    graph: input.graph,
    phaseSnapshot: baseSnapshot,
    agentActions
  });
  const winConditionCheck = evaluateNodeRoundWinCondition({
    graph: input.graph,
    phaseSnapshot: baseSnapshot,
    agentActions,
    localVerdicts,
    attackTeamId: getTeamIdForSide(input.economyResources, "attack"),
    defenseTeamId: getTeamIdForSide(input.economyResources, "defense"),
    previousState: previousWinConditionState
  });

  return {
    ...baseSnapshot,
    actionPointBudgets: buildActionPointBudgetsFromActions({
      phaseSnapshot: baseSnapshot,
      resources: economyResources.agents,
      actions: agentActions
    }),
    agentActions,
    localVerdicts,
    winConditionCheck
  };
}

async function attachActionsVerdictsAndWinConditionWithNodeLlm(
  input: RunNodeRoundShadowWithAnyLlmInput,
  baseSnapshot: RoundNodeStateSnapshot,
  economyResources: NodeRoundEconomyResources,
  previousWinConditionState: NodeRoundWinConditionState,
  audit: NodeRoundLlmShadowAudit | undefined,
  agentActionAudit: NodeRoundAgentActionLlmShadowAudit | undefined
): Promise<NodeRoundPhaseSnapshot> {
  let agentActions = buildAgentPhaseActions({
    graph: input.graph,
    phaseSnapshot: baseSnapshot,
    economyResources,
    ...(input.teamContexts ? { teamContexts: input.teamContexts } : {})
  });

  let agentActionStageAudit: NodeAgentActionLlmStageAudit | undefined;
  if (input.agentActionLlm && agentActionAudit) {
    const remainingAgentActionCalls = Math.max(input.agentActionLlm.maxLlmCalls - agentActionAudit.callsAttempted, 0);
    const agentActionStage = await runNodeAgentActionShadowStage({
      graph: input.graph,
      phaseSnapshot: baseSnapshot,
      economyResources,
      deterministicActions: agentActions,
      provider: input.agentActionLlm.provider,
      maxLlmCallsRemaining: remainingAgentActionCalls,
      ...(input.teamContexts ? { teamContexts: input.teamContexts } : {}),
      providerMode: input.agentActionLlm.providerMode ?? "fixture",
      ...(input.agentActionLlm.modelId ? { modelId: input.agentActionLlm.modelId } : {})
    });
    agentActions = agentActionStage.agentActions;
    agentActionStageAudit = agentActionStage.audit;
    addAgentActionAudit(agentActionAudit, agentActionStage.audit);
  }

  let localVerdicts = buildLocalNodeVerdicts({
    graph: input.graph,
    phaseSnapshot: baseSnapshot,
    agentActions
  });
  let nodeLlmStageAudit: NodeLlmShadowStageAudit | undefined;
  if (input.nodeLlm && audit) {
    const remainingCalls = Math.max(input.nodeLlm.maxLlmCalls - audit.callsAttempted, 0);
    const llmStage = await runNodeLlmShadowStage({
      graph: input.graph,
      phaseSnapshot: baseSnapshot,
      agentActions,
      economyResources,
      provider: input.nodeLlm.provider,
      maxLlmCallsRemaining: remainingCalls,
      providerMode: input.nodeLlm.providerMode ?? "fixture",
      ...(input.nodeLlm.modelId ? { modelId: input.nodeLlm.modelId } : {})
    });
    localVerdicts = llmStage.localVerdicts;
    nodeLlmStageAudit = llmStage.audit;
    addNodeLlmAudit(audit, llmStage.audit);
  }

  const winConditionCheck = evaluateNodeRoundWinCondition({
    graph: input.graph,
    phaseSnapshot: baseSnapshot,
    agentActions,
    localVerdicts,
    attackTeamId: getTeamIdForSide(input.economyResources, "attack"),
    defenseTeamId: getTeamIdForSide(input.economyResources, "defense"),
    previousState: previousWinConditionState
  });

  return {
    ...baseSnapshot,
    actionPointBudgets: buildActionPointBudgetsFromActions({
      phaseSnapshot: baseSnapshot,
      resources: economyResources.agents,
      actions: agentActions
    }),
    agentActions,
    localVerdicts,
    winConditionCheck,
    ...(nodeLlmStageAudit ? { nodeLlmAudit: nodeLlmStageAudit } : {}),
    ...(agentActionStageAudit ? { agentActionLlmAudit: agentActionStageAudit } : {})
  };
}

function assignAgentsToNodes(
  resources: NodeAgentEconomyResource[],
  phaseId: RoundPhaseId,
  side: "attack" | "defense",
  reachableNodes: string[]
): Record<string, string[]> {
  const preferred = side === "attack" ? attackPreferredNodesByPhase[phaseId] : defensePreferredNodesByPhase[phaseId];
  const candidateNodes = preferred.filter((nodeId) => reachableNodes.includes(nodeId));
  const fallbackNodes = reachableNodes.filter((nodeId) => !candidateNodes.includes(nodeId));
  const assignmentNodes = [...candidateNodes, ...fallbackNodes];
  const assignments: Record<string, string[]> = {};

  if (assignmentNodes.length === 0) {
    return assignments;
  }

  resources.forEach((resource, index) => {
    const nodeId = assignmentNodes[index % assignmentNodes.length]!;
    assignments[nodeId] = [...(assignments[nodeId] ?? []), resource.agentId];
  });

  return assignments;
}

function buildNodeState(input: {
  phaseId: RoundPhaseId;
  nodeId: string;
  attackAgentIds: string[];
  defenseAgentIds: string[];
}): MapNodeState {
  const hasAttack = input.attackAgentIds.length > 0;
  const hasDefense = input.defenseAgentIds.length > 0;
  return {
    nodeId: input.nodeId,
    phaseId: input.phaseId,
    attackAgentIds: input.attackAgentIds,
    defenseAgentIds: input.defenseAgentIds,
    control: hasAttack && hasDefense ? "contested" : hasAttack ? "attack" : hasDefense ? "defense" : "neutral",
    businessIntent: `shadow:${input.phaseId}:${input.nodeId}`
  };
}

function buildEmptyNodeLlmAudit(config: RunNodeRoundShadowWithNodeLlmInput["nodeLlm"]): NodeRoundLlmShadowAudit {
  return {
    enabled: true,
    providerMode: config.providerMode ?? "fixture",
    ...(config.modelId ? { modelId: config.modelId } : {}),
    callsAttempted: 0,
    fallbackCount: 0,
    fallbackReasons: [],
    ignoredFields: [],
    draftValidCount: 0,
    draftRejectedCount: 0,
    contentLength: 0,
    reasoningContentLength: 0,
    jsonTruncated: false,
    reasoningExhausted: false
  };
}

function buildEmptyAgentActionLlmAudit(config: NodeRoundAgentActionLlmConfig): NodeRoundAgentActionLlmShadowAudit {
  return {
    enabled: true,
    providerMode: config.providerMode ?? "fixture",
    ...(config.modelId ? { modelId: config.modelId } : {}),
    callsAttempted: 0,
    fallbackCount: 0,
    fallbackReasons: [],
    ignoredFields: [],
    draftAcceptedCount: 0,
    draftRejectedCount: 0,
    contentLength: 0,
    reasoningContentLength: 0,
    jsonTruncated: false,
    reasoningExhausted: false
  };
}

function addNodeLlmAudit(total: NodeRoundLlmShadowAudit, stage: NodeLlmShadowStageAudit): void {
  total.callsAttempted += stage.callsAttempted;
  total.fallbackCount += stage.fallbackCount;
  total.fallbackReasons.push(...stage.fallbackReasons);
  total.ignoredFields.push(...stage.ignoredFields);
  total.draftValidCount += stage.draftValidCount;
  total.draftRejectedCount += stage.draftRejectedCount;
  total.contentLength += stage.contentLength ?? 0;
  total.reasoningContentLength += stage.reasoningContentLength ?? 0;
  total.jsonTruncated = total.jsonTruncated || stage.jsonTruncated;
  total.reasoningExhausted = total.reasoningExhausted || stage.reasoningExhausted;
}

function addAgentActionAudit(total: NodeRoundAgentActionLlmShadowAudit, stage: NodeAgentActionLlmStageAudit): void {
  total.callsAttempted += stage.callsAttempted;
  total.fallbackCount += stage.fallbackCount;
  total.fallbackReasons.push(...stage.fallbackReasons);
  total.ignoredFields.push(...stage.ignoredFields);
  total.draftAcceptedCount += stage.draftAcceptedCount;
  total.draftRejectedCount += stage.draftRejectedCount;
  total.contentLength += stage.contentLength ?? 0;
  total.reasoningContentLength += stage.reasoningContentLength ?? 0;
  total.jsonTruncated = total.jsonTruncated || stage.jsonTruncated;
  total.reasoningExhausted = total.reasoningExhausted || stage.reasoningExhausted;
}

function filterResourcesByLiveAgents(resources: NodeRoundEconomyResources, liveAgentIds: string[]): NodeRoundEconomyResources {
  const liveAgentIdSet = new Set(liveAgentIds);
  const agents = resources.agents.filter((resource) => liveAgentIdSet.has(resource.agentId));
  return {
    ...resources,
    agents,
    agentResourcesById: Object.fromEntries(agents.map((resource) => [resource.agentId, resource]))
  };
}

function getTeamIdForSide(resources: NodeRoundEconomyResources, side: "attack" | "defense"): string {
  const team = resources.teams.find((candidate) => candidate.side === side);
  if (team) {
    return team.teamId;
  }
  return resources.agents.find((resource) => resource.side === side)?.teamId ?? `${side}_team`;
}

function nextWinConditionState(result: NodeRoundWinConditionResult): NodeRoundWinConditionState {
  return {
    bombState: result.bombState,
    ...(result.plantedNodeId ? { plantedNodeId: result.plantedNodeId } : {})
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}
