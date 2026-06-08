import {
  agentPhaseActionTypeSchema,
  type AgentPhaseAction,
  type AgentPhaseActionType,
  type MapNodeGraph,
  type RoundNodeStateSnapshot
} from "@agent-major/shared";

import type { NodeRoundEconomyResources } from "../economy/economy-resource-adapter.js";
import { getReachableNodes } from "../graph/node-graph-service.js";
import { getNodeAgentRoleContext, type NodeTeamContext } from "../team-context/node-team-context-service.js";

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
  role?: string;
  roleResponsibilities?: string[];
  roleActionBias?: AgentPhaseActionType[];
  teamThesisAnchor?: string;
  businessOperatingPrinciple?: string;
  coachNote?: string;
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
  teamContexts?: Record<string, NodeTeamContext>;
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
      const roleContext = getNodeAgentRoleContext(input.teamContexts, action.agentId, action.teamId);
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
        baselineBusinessIntent: action.businessIntent,
        ...(roleContext
          ? {
              role: roleContext.role,
              roleResponsibilities: roleContext.roleResponsibilities,
              roleActionBias: roleContext.roleActionBias,
              teamThesisAnchor: roleContext.teamThesisAnchor,
              businessOperatingPrinciple: roleContext.businessOperatingPrinciple,
              coachNote: roleContext.coachNote
            }
          : {})
      };
    }),
    constraints: [
      "Only output agent phase action drafts. Do not output final winner, roundWinType, kill ledger, DB facts, or economy parameter changes.",
      "targetNodeId must come from the matching agent.allowedTargetNodeIds.",
      "actionType must come from the matching agent.allowedActionTypes.",
      "apCost cannot exceed baseAp and cannot bypass AP validation.",
      "businessIntent must connect the CS action to business plan validation.",
      "If role context is present, businessIntent must reference the team plan, role duty, thesis, or operating principle.",
      "Role preference is not a win condition and cannot bypass AP, economy, graph, or phase constraints."
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
    if (!businessIntentReferencesContext(businessIntent, agent)) {
      errors.push(`draft_${index}:${agentId}:missing_role_or_team_business_context`);
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
      riskAssessment: draft.riskNotes && draft.riskNotes.length > 0 ? draft.riskNotes.join("; ") : baseline.riskAssessment,
      expectedResult: draft.tacticalIntent ?? baseline.expectedResult,
      informationTransfer: `${baseline.informationTransfer ?? "Pass node action information."} LLM shadow draft passed code validation.`
    };
  });
}

function businessIntentReferencesContext(businessIntent: string, agent: NodeAgentActionRequestAgent): boolean {
  if (!agent.role && !agent.teamThesisAnchor && !agent.businessOperatingPrinciple) {
    return true;
  }
  const normalizedIntent = businessIntent.toLowerCase();
  const keywords = [
    agent.role,
    "role",
    "team",
    "plan",
    "thesis",
    "business",
    "principle",
    ...firstWords(agent.roleResponsibilities ?? []),
    ...firstWords([agent.teamThesisAnchor ?? "", agent.businessOperatingPrinciple ?? ""])
  ].filter((value): value is string => Boolean(value && value.length >= 3));
  return keywords.some((keyword) => normalizedIntent.includes(keyword.toLowerCase()));
}

function firstWords(values: string[]): string[] {
  return values
    .map((value) => value.replace(/[^A-Za-z0-9_\u4e00-\u9fff]+/g, " ").trim().split(/\s+/)[0] ?? "")
    .filter((value) => value.length >= 3);
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
