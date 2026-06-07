import type { AgentPhaseAction, MapNodeControl, MapNodeGraph, MapNodeState, RoundPhaseId, RoundNodeStateSnapshot } from "@agent-major/shared";

import type { NodeRoundEconomyResources } from "./economy-resource-adapter.js";

export interface NodeLlmJudgeRequest {
  schemaName: "LocalNodeJudgeDraft";
  phaseId: RoundPhaseId;
  allowedNodeIds: string[];
  forbiddenFields: string[];
  nodes: NodeLlmJudgeRequestNode[];
  actions: NodeLlmJudgeRequestAction[];
  economySummary: string[];
  instructions: string[];
}

export interface NodeLlmJudgeRequestNode {
  nodeId: string;
  displayName: string;
  kind: string;
  controlBefore: MapNodeControl;
  attackAgentIds: string[];
  defenseAgentIds: string[];
  businessIntent?: string;
}

export interface NodeLlmJudgeRequestAction {
  agentId: string;
  teamId: string;
  side: "attack" | "defense";
  nodeId: string;
  actionType: string;
  apCost: number;
  businessIntent: string;
}

export interface LocalNodeJudgeDraft {
  nodeId: string;
  phaseId: RoundPhaseId;
  summary: string;
  controlAfterCandidate: MapNodeControl;
  businessPlanValidated: string[];
  businessPlanBroken: string[];
  riskNotes: string[];
  confidence: number;
}

export interface NormalizeLocalNodeJudgeDraftsResult {
  drafts: LocalNodeJudgeDraft[];
  errors: string[];
  ignoredFields: string[];
}

const allowedDraftFields = new Set([
  "nodeId",
  "phaseId",
  "summary",
  "controlAfterCandidate",
  "businessPlanValidated",
  "businessPlanBroken",
  "riskNotes",
  "confidence"
]);
const controls = new Set<MapNodeControl>(["attack", "defense", "contested", "neutral"]);

export function buildNodeLlmJudgeRequest(input: {
  graph: MapNodeGraph;
  phaseSnapshot: RoundNodeStateSnapshot;
  agentActions: AgentPhaseAction[];
  economyResources?: NodeRoundEconomyResources;
}): NodeLlmJudgeRequest {
  const nodeById = new Map(input.graph.nodes.map((node) => [node.id, node] as const));
  const activeNodeIds = new Set(input.phaseSnapshot.activeNodeIds);
  const nodes = input.phaseSnapshot.nodeStates
    .filter((state) => activeNodeIds.has(state.nodeId))
    .map((state) => buildRequestNode(state, nodeById))
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  const allowedNodeIds = nodes.map((node) => node.nodeId);
  return {
    schemaName: "LocalNodeJudgeDraft",
    phaseId: input.phaseSnapshot.phaseId,
    allowedNodeIds,
    forbiddenFields: ["winnerTeamId", "loserTeamId", "roundWinType", "killLedger", "economyDelta", "dbFact"],
    nodes,
    actions: input.agentActions.map((action) => ({
      agentId: action.agentId,
      teamId: action.teamId,
      side: action.side,
      nodeId: action.targetNodeId,
      actionType: action.actionType,
      apCost: action.apCost,
      businessIntent: action.businessIntent
    })),
    economySummary:
      input.economyResources?.teams.map(
        (team) => `${team.side}:${team.teamId}:${team.posture}:${team.summaryBuyType}:${team.sharedEconomySummary}`
      ) ?? [],
    instructions: [
      "只输出 LocalNodeJudgeDraft 数组。",
      "不得输出最终 winner、roundWinType、kill ledger、DB fact 或经济参数修改。",
      "nodeId 必须来自 allowedNodeIds，phaseId 必须等于当前 phaseId。",
      "局部裁判只增强节点语义解释，不决定整回合胜负。"
    ]
  };
}

export function normalizeLocalNodeJudgeDrafts(input: {
  rawDrafts: unknown;
  graph: MapNodeGraph;
  phaseId: RoundPhaseId;
  allowedNodeIds: string[];
}): NormalizeLocalNodeJudgeDraftsResult {
  const rawItems = Array.isArray(input.rawDrafts) ? input.rawDrafts : [input.rawDrafts];
  const knownGraphNodeIds = new Set(input.graph.nodes.map((node) => node.id));
  const allowedNodeIds = new Set(input.allowedNodeIds);
  const drafts: LocalNodeJudgeDraft[] = [];
  const errors: string[] = [];
  const ignoredFields: string[] = [];

  rawItems.forEach((raw, index) => {
    if (!isRecord(raw)) {
      errors.push(`draft[${index}] is not an object`);
      return;
    }
    for (const key of Object.keys(raw)) {
      if (!allowedDraftFields.has(key)) {
        ignoredFields.push(key);
      }
    }
    const nodeId = stringField(raw.nodeId);
    const phaseId = stringField(raw.phaseId);
    const controlAfterCandidate = stringField(raw.controlAfterCandidate);
    if (!nodeId || !knownGraphNodeIds.has(nodeId) || !allowedNodeIds.has(nodeId)) {
      errors.push(`draft[${index}] references invalid nodeId: ${nodeId ?? "missing"}`);
      return;
    }
    if (phaseId !== input.phaseId) {
      errors.push(`draft[${index}] phase mismatch: ${phaseId ?? "missing"}`);
      return;
    }
    if (!controlAfterCandidate || !controls.has(controlAfterCandidate as MapNodeControl)) {
      errors.push(`draft[${index}] invalid controlAfterCandidate: ${controlAfterCandidate ?? "missing"}`);
      return;
    }
    drafts.push({
      nodeId,
      phaseId: input.phaseId,
      summary: stringField(raw.summary) ?? `${nodeId} 节点 LLM shadow 草案缺少 summary，已使用降级摘要。`,
      controlAfterCandidate: controlAfterCandidate as MapNodeControl,
      businessPlanValidated: stringArrayField(raw.businessPlanValidated),
      businessPlanBroken: stringArrayField(raw.businessPlanBroken),
      riskNotes: stringArrayField(raw.riskNotes),
      confidence: numberField(raw.confidence) ?? 0.5
    });
  });

  return {
    drafts,
    errors,
    ignoredFields: [...new Set(ignoredFields)].sort()
  };
}

function buildRequestNode(state: MapNodeState, nodeById: Map<string, MapNodeGraph["nodes"][number]>): NodeLlmJudgeRequestNode {
  const graphNode = nodeById.get(state.nodeId);
  return {
    nodeId: state.nodeId,
    displayName: graphNode?.display_name ?? state.nodeId,
    kind: graphNode?.kind ?? "unknown",
    controlBefore: state.control,
    attackAgentIds: state.attackAgentIds,
    defenseAgentIds: state.defenseAgentIds,
    ...(state.businessIntent ? { businessIntent: state.businessIntent } : {})
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArrayField(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}
