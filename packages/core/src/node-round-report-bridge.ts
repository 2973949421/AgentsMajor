import type { AgentPhaseAction, LocalNodeVerdict, MapNodeControl, RoundPhaseId } from "@agent-major/shared";

import type { NodeRoundPhaseSnapshot, NodeRoundShadowResult } from "./round-phase-runner.js";

export type NodeRoundShadowReportSource = "node_round_engine_shadow";
export type NodeRoundCommittedReportSource = "node_round_engine_committed";
export type NodeRoundShadowReportStatus = "complete" | "incomplete";

export interface BuildNodeRoundShadowReportInput {
  shadowResult: NodeRoundShadowResult;
  attackTeamId: string;
  defenseTeamId: string;
  attackTeamName?: string;
  defenseTeamName?: string;
  mapName?: string;
  reportId?: string;
}

export interface BuildNodeRoundCommittedReportInput extends BuildNodeRoundShadowReportInput {
  nodeTraceArtifactId?: string;
}

export interface NodeRoundShadowReport {
  id: string;
  source: NodeRoundShadowReportSource;
  status: NodeRoundShadowReportStatus;
  roundId: string;
  roundNumber: number;
  mapSlug: string;
  mapName: string;
  graphAssetId: string;
  attackTeam: NodeRoundShadowTeamSummary;
  defenseTeam: NodeRoundShadowTeamSummary;
  phaseCount: number;
  completedByPhase?: RoundPhaseId;
  finalWinCondition?: NodeRoundShadowWinConditionSummary;
  phaseSummaries: NodeRoundShadowPhaseSummary[];
  audit: NodeRoundShadowAuditSummary;
  notes: string[];
}

export type NodeRoundCommittedReport = Omit<NodeRoundShadowReport, "source" | "audit" | "notes"> & {
  source: NodeRoundCommittedReportSource;
  nodeTraceArtifactId?: string;
  audit: NodeRoundCommittedAuditSummary;
  notes: string[];
};

export interface NodeRoundShadowTeamSummary {
  teamId: string;
  displayName: string;
}

export interface NodeRoundShadowWinConditionSummary {
  isRoundOver: boolean;
  winnerSide?: "attack" | "defense";
  winnerTeamId?: string;
  loserTeamId?: string;
  roundWinType?: string;
  phaseId: RoundPhaseId;
  nodeId?: string;
  bombState: string;
  plantedNodeId?: string;
  reason: string;
  evidence: string[];
}

export interface NodeRoundShadowPhaseSummary {
  phaseId: RoundPhaseId;
  activeNodeCount: number;
  actionCount: number;
  localVerdictCount: number;
  contestedNodeIds: string[];
  attackControlledNodeIds: string[];
  defenseControlledNodeIds: string[];
  neutralNodeIds: string[];
  actionTypeCounts: Record<string, number>;
  businessIntentSummary: string[];
  winCondition: NodeRoundShadowWinConditionSummary;
}

export interface NodeRoundShadowAuditSummary {
  mode: "shadow";
  writesDb: false;
  callsLlm: boolean;
  replacesLegacyRoundPath: false;
  hasFinalWinCondition: boolean;
  llmShadowEnabled: boolean;
  providerMode: "none" | "fixture" | "real";
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
  agentActionProviderMode: "none" | "fixture" | "real";
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
  phaseIds: RoundPhaseId[];
  totalAgentActions: number;
  totalLocalVerdicts: number;
  totalApSpent: number;
  maxActiveNodeCount: number;
}

export type NodeRoundCommittedAuditSummary = Omit<NodeRoundShadowAuditSummary, "mode" | "writesDb"> & {
  mode: "committed";
  writesDb: true;
};

export function buildNodeRoundShadowReport(input: BuildNodeRoundShadowReportInput): NodeRoundShadowReport {
  const finalWinCondition = input.shadowResult.finalWinCondition ? summarizeWinCondition(input.shadowResult.finalWinCondition) : undefined;
  const phaseSummaries = input.shadowResult.phases.map((phase) => summarizePhase(phase));
  const audit = buildAudit(input.shadowResult, phaseSummaries);
  const status: NodeRoundShadowReportStatus = finalWinCondition?.isRoundOver ? "complete" : "incomplete";

  return {
    id: input.reportId ?? `${input.shadowResult.roundId}:node_shadow_report`,
    source: "node_round_engine_shadow",
    status,
    roundId: input.shadowResult.roundId,
    roundNumber: input.shadowResult.roundNumber,
    mapSlug: input.shadowResult.mapSlug,
    mapName: input.mapName ?? input.shadowResult.mapSlug,
    graphAssetId: input.shadowResult.graphAssetId,
    attackTeam: {
      teamId: input.attackTeamId,
      displayName: input.attackTeamName ?? input.attackTeamId
    },
    defenseTeam: {
      teamId: input.defenseTeamId,
      displayName: input.defenseTeamName ?? input.defenseTeamId
    },
    phaseCount: input.shadowResult.phases.length,
    ...(finalWinCondition ? { completedByPhase: finalWinCondition.phaseId, finalWinCondition } : {}),
    phaseSummaries,
    audit,
    notes: [
      ...input.shadowResult.notes,
      "NodeRoundShadowReport 是节点化 shadow 报告，不是旧 RoundReport 数据库记录。",
      "Bridge 只读 shadow 轨迹，不反向修改节点事实。"
    ]
  };
}

export function buildNodeRoundCommittedReport(input: BuildNodeRoundCommittedReportInput): NodeRoundCommittedReport {
  const shadowReport = buildNodeRoundShadowReport(input);
  if (!shadowReport.finalWinCondition?.isRoundOver) {
    throw new Error("Cannot build committed node round report without a hard final win condition.");
  }

  return {
    ...shadowReport,
    source: "node_round_engine_committed",
    ...(input.nodeTraceArtifactId ? { nodeTraceArtifactId: input.nodeTraceArtifactId } : {}),
    audit: {
      ...shadowReport.audit,
      mode: "committed",
      writesDb: true
    },
    notes: [
      ...input.shadowResult.notes,
      "NodeRoundCommittedReport 是节点化 experimental committed 报告，用于单回合实验提交。",
      "正式 winner 只来自 WinConditionMaterializer 的硬胜负条件，LLM shadow 不拥有最终胜负写入权。"
    ]
  };
}

function summarizePhase(phase: NodeRoundPhaseSnapshot): NodeRoundShadowPhaseSummary {
  const actionTypeCounts = countBy(phase.agentActions ?? [], (action) => action.actionType);
  const controlGroups = groupNodeIdsByControl(phase.localVerdicts ?? []);
  return {
    phaseId: phase.phaseId,
    activeNodeCount: phase.activeNodeIds.length,
    actionCount: phase.agentActions?.length ?? 0,
    localVerdictCount: phase.localVerdicts?.length ?? 0,
    contestedNodeIds: controlGroups.contested,
    attackControlledNodeIds: controlGroups.attack,
    defenseControlledNodeIds: controlGroups.defense,
    neutralNodeIds: controlGroups.neutral,
    actionTypeCounts,
    businessIntentSummary: summarizeBusinessIntents(phase.agentActions ?? [], phase.localVerdicts ?? []),
    winCondition: summarizeWinCondition(phase.winConditionCheck)
  };
}

function summarizeWinCondition(winCondition: NodeRoundShadowResult["phases"][number]["winConditionCheck"]): NodeRoundShadowWinConditionSummary {
  return {
    isRoundOver: winCondition.isRoundOver,
    ...(winCondition.winnerSide ? { winnerSide: winCondition.winnerSide } : {}),
    ...(winCondition.winnerTeamId ? { winnerTeamId: winCondition.winnerTeamId } : {}),
    ...(winCondition.loserTeamId ? { loserTeamId: winCondition.loserTeamId } : {}),
    ...(winCondition.roundWinType ? { roundWinType: winCondition.roundWinType } : {}),
    phaseId: winCondition.phaseId,
    ...(winCondition.nodeId ? { nodeId: winCondition.nodeId } : {}),
    bombState: winCondition.bombState,
    ...(winCondition.plantedNodeId ? { plantedNodeId: winCondition.plantedNodeId } : {}),
    reason: winCondition.reason,
    evidence: winCondition.evidence
  };
}

function buildAudit(shadowResult: NodeRoundShadowResult, phaseSummaries: NodeRoundShadowPhaseSummary[]): NodeRoundShadowAuditSummary {
  const totalApSpent = shadowResult.phases.flatMap((phase) => phase.actionPointBudgets ?? []).reduce((sum, budget) => sum + budget.spentAp, 0);
  return {
    mode: "shadow",
    writesDb: false,
    callsLlm: Boolean(shadowResult.nodeLlmAudit?.enabled || shadowResult.agentActionLlmAudit?.enabled),
    replacesLegacyRoundPath: false,
    hasFinalWinCondition: Boolean(shadowResult.finalWinCondition),
    llmShadowEnabled: shadowResult.nodeLlmAudit?.enabled ?? false,
    providerMode: shadowResult.nodeLlmAudit?.providerMode ?? "none",
    ...(shadowResult.nodeLlmAudit?.modelId ? { modelId: shadowResult.nodeLlmAudit.modelId } : {}),
    llmCallsAttempted: shadowResult.nodeLlmAudit?.callsAttempted ?? 0,
    llmFallbackCount: shadowResult.nodeLlmAudit?.fallbackCount ?? 0,
    fallbackReasons: uniqueSorted(shadowResult.nodeLlmAudit?.fallbackReasons ?? []),
    ignoredLlmFields: uniqueSorted(shadowResult.nodeLlmAudit?.ignoredFields ?? []),
    draftValidCount: shadowResult.nodeLlmAudit?.draftValidCount ?? 0,
    draftRejectedCount: shadowResult.nodeLlmAudit?.draftRejectedCount ?? 0,
    contentLength: shadowResult.nodeLlmAudit?.contentLength ?? 0,
    reasoningContentLength: shadowResult.nodeLlmAudit?.reasoningContentLength ?? 0,
    jsonTruncated: shadowResult.nodeLlmAudit?.jsonTruncated ?? false,
    reasoningExhausted: shadowResult.nodeLlmAudit?.reasoningExhausted ?? false,
    agentActionLlmEnabled: shadowResult.agentActionLlmAudit?.enabled ?? false,
    agentActionProviderMode: shadowResult.agentActionLlmAudit?.providerMode ?? "none",
    ...(shadowResult.agentActionLlmAudit?.modelId ? { agentActionModelId: shadowResult.agentActionLlmAudit.modelId } : {}),
    agentActionCallsAttempted: shadowResult.agentActionLlmAudit?.callsAttempted ?? 0,
    agentActionFallbackCount: shadowResult.agentActionLlmAudit?.fallbackCount ?? 0,
    agentActionFallbackReasons: uniqueSorted(shadowResult.agentActionLlmAudit?.fallbackReasons ?? []),
    agentActionIgnoredFields: uniqueSorted(shadowResult.agentActionLlmAudit?.ignoredFields ?? []),
    agentActionDraftAcceptedCount: shadowResult.agentActionLlmAudit?.draftAcceptedCount ?? 0,
    agentActionDraftRejectedCount: shadowResult.agentActionLlmAudit?.draftRejectedCount ?? 0,
    agentActionContentLength: shadowResult.agentActionLlmAudit?.contentLength ?? 0,
    agentActionReasoningContentLength: shadowResult.agentActionLlmAudit?.reasoningContentLength ?? 0,
    agentActionJsonTruncated: shadowResult.agentActionLlmAudit?.jsonTruncated ?? false,
    agentActionReasoningExhausted: shadowResult.agentActionLlmAudit?.reasoningExhausted ?? false,
    phaseIds: shadowResult.phases.map((phase) => phase.phaseId),
    totalAgentActions: phaseSummaries.reduce((sum, phase) => sum + phase.actionCount, 0),
    totalLocalVerdicts: phaseSummaries.reduce((sum, phase) => sum + phase.localVerdictCount, 0),
    totalApSpent,
    maxActiveNodeCount: Math.max(...phaseSummaries.map((phase) => phase.activeNodeCount), 0)
  };
}

function summarizeBusinessIntents(actions: AgentPhaseAction[], verdicts: LocalNodeVerdict[]): string[] {
  const actionIntents = actions.map((action) => action.businessIntent).filter((value) => value.length > 0).slice(0, 5);
  const verdictIntents = verdicts.flatMap((verdict) => verdict.businessPlanValidated ?? []).filter((value) => value.length > 0).slice(0, 5);
  return [...new Set([...actionIntents, ...verdictIntents])].slice(0, 8);
}

function groupNodeIdsByControl(verdicts: LocalNodeVerdict[]): Record<MapNodeControl, string[]> {
  const groups: Record<MapNodeControl, string[]> = {
    attack: [],
    defense: [],
    contested: [],
    neutral: []
  };
  for (const verdict of verdicts) {
    groups[verdict.controlAfter].push(verdict.nodeId);
  }
  return {
    attack: uniqueSorted(groups.attack),
    defense: uniqueSorted(groups.defense),
    contested: uniqueSorted(groups.contested),
    neutral: uniqueSorted(groups.neutral)
  };
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    const key = keyFn(item);
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}
