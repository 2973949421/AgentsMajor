import {
  agentPhaseActionTypeSchema,
  type AgentPhaseAction,
  type AgentPhaseActionType,
  type MapNodeGraph,
  type RoundNodeStateSnapshot
} from "@agent-major/shared";

import type { NodeRoundEconomyResources } from "./economy-resource-adapter.js";
import { getReachableNodes } from "./node-graph-service.js";

export interface NodeAgentActionRequest {
  phaseId: RoundNodeStateSnapshot["phaseId"];
  graph: {
    mapSlug: string;
    allowedNodeIds: string[];
  };
  agents: NodeAgentActionRequestAgent[];
  constraints: string[];
}

export interface NodeAgentActionRequestAgent {
  agentId: string;
  teamId: string;
  side: "attack" | "defense";
  currentNodeId: string;
  baselineTargetNodeId: string;
  baselineActionType: AgentPhaseActionType;
  allowedTargetNodeIds: string[];
  allowedActionTypes: AgentPhaseActionType[];
  baseAp: number;
  economyPosture: string;
  weaponTier: string;
  utilityTier: string;
  riskProfile: string;
  baselineBusinessIntent: string;
}

export interface NodeAgentActionDraft {
  agentId: string;
  phaseId: RoundNodeStateSnapshot["phaseId"];
  currentNodeId?: string;
  targetNodeId: string;
  actionType: AgentPhaseActionType;
  apCost: number;
  businessIntent: string;
  tacticalIntent?: string;
  riskNotes?: string[];
  confidence?: number;
}

export interface NormalizeNodeAgentActionDraftsInput {
  rawDrafts: unknown;
  request: NodeAgentActionRequest;
}

export interface NormalizeNodeAgentActionDraftsResult {
  drafts: NodeAgentActionDraft[];
  errors: string[];
  ignoredFields: string[];
}

const allowedDraftFields = new Set([
  "agentId",
  "phaseId",
  "currentNodeId",
  "targetNodeId",
  "actionType",
  "apCost",
  "businessIntent",
  "tacticalIntent",
  "riskNotes",
  "confidence"
]);

const forbiddenDraftFields = new Set([
  "winner",
  "winnerTeamId",
  "winnerPromptTeamId",
  "loserTeamId",
  "roundWinType",
  "killLedger",
  "kills",
  "casualties",
  "bombResult",
  "economyDelta",
  "economyPosture",
  "loadoutPackage",
  "dbFact",
  "roundReport"
]);

export function buildNodeAgentActionRequest(input: {
  graph: MapNodeGraph;
  phaseSnapshot: RoundNodeStateSnapshot;
  economyResources: NodeRoundEconomyResources;
  baselineActions: AgentPhaseAction[];
}): NodeAgentActionRequest {
  const resourceByAgentId = input.economyResources.agentResourcesById;
  const allowedNodeIds = input.graph.nodes.map((node) => node.id);
  return {
    phaseId: input.phaseSnapshot.phaseId,
    graph: {
      mapSlug: input.graph.map_slug,
      allowedNodeIds
    },
    agents: input.baselineActions.map((action) => {
      const resource = resourceByAgentId[action.agentId];
      const allowedTargetNodeIds = getReachableNodes(input.graph, action.side, input.phaseSnapshot.phaseId);
      return {
        agentId: action.agentId,
        teamId: action.teamId,
        side: action.side,
        currentNodeId: action.currentNodeId,
        baselineTargetNodeId: action.targetNodeId,
        baselineActionType: action.actionType,
        allowedTargetNodeIds,
        allowedActionTypes: resource?.allowedActionTypes ?? [action.actionType],
        baseAp: resource?.baseAp ?? 3,
        economyPosture: resource?.economyPosture ?? "unknown",
        weaponTier: resource?.weaponTier ?? "unknown",
        utilityTier: resource?.utilityTier ?? "unknown",
        riskProfile: resource?.riskProfile ?? "unknown",
        baselineBusinessIntent: action.businessIntent
      };
    }),
    constraints: [
      "只输出 agent 阶段行动草案，不输出最终 winner、roundWinType、kill ledger 或经济参数修改。",
      "targetNodeId 必须来自对应 agent 的 allowedTargetNodeIds。",
      "actionType 必须来自对应 agent 的 allowedActionTypes。",
      "apCost 不能超过 baseAp。",
      "businessIntent 必须保留 CS 行动与商业计划验证的结合。"
    ]
  };
}

export function normalizeNodeAgentActionDrafts(input: NormalizeNodeAgentActionDraftsInput): NormalizeNodeAgentActionDraftsResult {
  const rawDrafts = extractDraftArray(input.rawDrafts);
  const agentById = new Map(input.request.agents.map((agent) => [agent.agentId, agent] as const));
  const graphNodeIds = new Set(input.request.graph.allowedNodeIds);
  const drafts: NodeAgentActionDraft[] = [];
  const errors: string[] = [];
  const ignoredFields: string[] = [];

  rawDrafts.forEach((rawDraft, index) => {
    if (!isRecord(rawDraft)) {
      errors.push(`draft_${index}:not_object`);
      return;
    }

    for (const key of Object.keys(rawDraft)) {
      if (!allowedDraftFields.has(key) || forbiddenDraftFields.has(key)) {
        ignoredFields.push(key);
      }
    }

    const agentId = readString(rawDraft.agentId);
    const agent = agentId ? agentById.get(agentId) : undefined;
    if (!agentId || !agent) {
      errors.push(`draft_${index}:invalid_agentId`);
      return;
    }

    const phaseId = readString(rawDraft.phaseId);
    if (phaseId !== input.request.phaseId) {
      errors.push(`draft_${index}:${agentId}:invalid_phaseId`);
      return;
    }

    const targetNodeId = readString(rawDraft.targetNodeId);
    if (!targetNodeId || !graphNodeIds.has(targetNodeId)) {
      errors.push(`draft_${index}:${agentId}:invalid_targetNodeId`);
      return;
    }
    if (!agent.allowedTargetNodeIds.includes(targetNodeId)) {
      errors.push(`draft_${index}:${agentId}:unreachable_targetNodeId:${targetNodeId}`);
      return;
    }

    const currentNodeId = readOptionalString(rawDraft.currentNodeId);
    if (currentNodeId && !graphNodeIds.has(currentNodeId)) {
      errors.push(`draft_${index}:${agentId}:invalid_currentNodeId`);
      return;
    }

    const actionTypeParse = agentPhaseActionTypeSchema.safeParse(rawDraft.actionType);
    if (!actionTypeParse.success) {
      errors.push(`draft_${index}:${agentId}:invalid_actionType`);
      return;
    }
    const actionType = actionTypeParse.data;
    if (!agent.allowedActionTypes.includes(actionType)) {
      errors.push(`draft_${index}:${agentId}:disallowed_actionType:${actionType}`);
      return;
    }

    const apCost = readNonnegativeInt(rawDraft.apCost);
    if (apCost === undefined) {
      errors.push(`draft_${index}:${agentId}:invalid_apCost`);
      return;
    }
    if (apCost > agent.baseAp) {
      errors.push(`draft_${index}:${agentId}:ap_over_budget:${apCost}>${agent.baseAp}`);
      return;
    }

    const businessIntent = readString(rawDraft.businessIntent);
    if (!businessIntent) {
      errors.push(`draft_${index}:${agentId}:missing_businessIntent`);
      return;
    }

    const tacticalIntent = readOptionalString(rawDraft.tacticalIntent);
    const confidence = readConfidence(rawDraft.confidence);
    drafts.push({
      agentId,
      phaseId: input.request.phaseId,
      ...(currentNodeId ? { currentNodeId } : {}),
      targetNodeId,
      actionType,
      apCost,
      businessIntent,
      ...(tacticalIntent ? { tacticalIntent } : {}),
      riskNotes: readStringArray(rawDraft.riskNotes),
      ...(confidence !== undefined ? { confidence } : {})
    });
  });

  return {
    drafts,
    errors,
    ignoredFields: uniqueSorted(ignoredFields)
  };
}

export function applyNodeAgentActionDrafts(input: {
  baselineActions: AgentPhaseAction[];
  drafts: NodeAgentActionDraft[];
}): AgentPhaseAction[] {
  const draftByAgentId = new Map(input.drafts.map((draft) => [draft.agentId, draft] as const));
  return input.baselineActions.map((baseline) => {
    const draft = draftByAgentId.get(baseline.agentId);
    if (!draft) {
      return baseline;
    }
    return {
      ...baseline,
      currentNodeId: draft.currentNodeId ?? baseline.currentNodeId,
      targetNodeId: draft.targetNodeId,
      actionType: draft.actionType,
      apCost: draft.apCost,
      businessIntent: draft.businessIntent,
      riskAssessment: draft.riskNotes && draft.riskNotes.length > 0 ? draft.riskNotes.join("；") : baseline.riskAssessment,
      expectedResult: draft.tacticalIntent ?? baseline.expectedResult,
      informationTransfer: `${baseline.informationTransfer ?? "传递节点化行动信息。"} LLM shadow 行动草案已通过代码校验。`
    };
  });
}

function extractDraftArray(rawDrafts: unknown): unknown[] {
  if (Array.isArray(rawDrafts)) {
    return rawDrafts;
  }
  if (isRecord(rawDrafts) && Array.isArray(rawDrafts.drafts)) {
    return rawDrafts.drafts;
  }
  return [];
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function readNonnegativeInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function readConfidence(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : undefined;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
