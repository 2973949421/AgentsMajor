import type { AgentPhaseAction, MapNodeGraph, RoundNodeStateSnapshot } from "@agent-major/shared";

import type { NodeAgentEconomyResource } from "../economy/economy-resource-adapter.js";
import { getReachableNodes } from "../graph/node-graph-service.js";
import {
  calculateNodeActionPointCost,
  calculateNodeRouteCost,
  type NodeActionPointCostBreakdown
} from "./node-action-point-rules.js";

export interface ValidatedNodeAction {
  action: AgentPhaseAction;
  valid: boolean;
  fallbackReason?: string;
  costBreakdown: NodeActionPointCostBreakdown;
}

export interface ValidateAgentPhaseActionInput {
  graph: MapNodeGraph;
  phaseSnapshot: RoundNodeStateSnapshot;
  resource: NodeAgentEconomyResource;
  action: AgentPhaseAction;
  claimedCostFromLlm?: number;
}

export function validateAgentPhaseAction(input: ValidateAgentPhaseActionInput): ValidatedNodeAction {
  const errors = collectValidationErrors(input);
  if (errors.length === 0) {
    const costBreakdown = calculateNodeActionPointCost({
      graph: input.graph,
      resource: input.resource,
      actionType: input.action.actionType,
      currentNodeId: input.action.currentNodeId,
      targetNodeId: input.action.targetNodeId,
      ...(input.claimedCostFromLlm !== undefined ? { claimedCostFromLlm: input.claimedCostFromLlm } : {})
    });
    return {
      action: attachApAudit(input.action, costBreakdown),
      valid: true,
      costBreakdown
    };
  }

  const fallback = buildFallbackAction(input, errors.join(";"));
  const fallbackBreakdown = calculateNodeActionPointCost({
    graph: input.graph,
    resource: input.resource,
    actionType: fallback.actionType,
    currentNodeId: fallback.currentNodeId,
    targetNodeId: fallback.targetNodeId,
    ...(input.claimedCostFromLlm !== undefined ? { claimedCostFromLlm: input.claimedCostFromLlm } : {})
  });

  return {
    action: attachApAudit(fallback, fallbackBreakdown, errors.join(";")),
    valid: false,
    fallbackReason: errors.join(";"),
    costBreakdown: fallbackBreakdown
  };
}

export function buildActionPointBudgetsFromActions(input: {
  phaseSnapshot: RoundNodeStateSnapshot;
  resources: NodeAgentEconomyResource[];
  actions: AgentPhaseAction[];
}) {
  const actionsByAgentId = new Map(input.actions.map((action) => [action.agentId, action] as const));
  return input.resources.map((resource) => {
    const action = actionsByAgentId.get(resource.agentId);
    const spentAp = action?.apCost ?? 0;
    return {
      agentId: resource.agentId,
      phaseId: input.phaseSnapshot.phaseId,
      baseAp: resource.baseAp,
      spentAp,
      remainingAp: resource.baseAp - spentAp,
      isOverBudget: spentAp > resource.baseAp
    };
  });
}

function collectValidationErrors(input: ValidateAgentPhaseActionInput): string[] {
  const errors: string[] = [];
  const nodeIds = new Set(input.graph.nodes.map((node) => node.id));
  if (input.action.agentId !== input.resource.agentId) {
    errors.push(`agent_mismatch:${input.action.agentId}`);
  }
  if (input.action.phaseId !== input.phaseSnapshot.phaseId) {
    errors.push(`phase_mismatch:${input.action.phaseId}`);
  }
  if (!nodeIds.has(input.action.currentNodeId)) {
    errors.push(`invalid_current_node:${input.action.currentNodeId}`);
  }
  if (!nodeIds.has(input.action.targetNodeId)) {
    errors.push(`invalid_target_node:${input.action.targetNodeId}`);
  }
  if (!input.resource.allowedActionTypes.includes(input.action.actionType)) {
    errors.push(`disallowed_action:${input.action.actionType}`);
  }
  if (input.action.businessIntent.trim().length === 0) {
    errors.push("missing_business_intent");
  }

  const reachable = new Set(getReachableNodes(input.graph, input.resource.side, input.phaseSnapshot.phaseId));
  if (!reachable.has(input.action.targetNodeId)) {
    errors.push(`phase_unreachable_target:${input.action.targetNodeId}`);
  }
  const route = calculateNodeRouteCost(input.graph, input.action.currentNodeId, input.action.targetNodeId);
  if (!route.reachable) {
    errors.push(`route_unreachable:${input.action.currentNodeId}->${input.action.targetNodeId}`);
  }
  const cost = calculateNodeActionPointCost({
    graph: input.graph,
    resource: input.resource,
    actionType: input.action.actionType,
    currentNodeId: input.action.currentNodeId,
    targetNodeId: input.action.targetNodeId,
    ...(input.claimedCostFromLlm !== undefined ? { claimedCostFromLlm: input.claimedCostFromLlm } : {})
  });
  if (!Number.isFinite(cost.totalCost) || cost.totalCost > input.resource.baseAp) {
    errors.push(`ap_over_budget:${Number.isFinite(cost.totalCost) ? cost.totalCost : "unreachable"}>${input.resource.baseAp}`);
  }
  if ((input.action.actionType === "use_utility" || input.action.actionType === "execute_site" || input.action.actionType === "retake") && input.resource.utilityTier === "none") {
    errors.push(`utility_unavailable:${input.action.actionType}`);
  }
  return errors;
}

function buildFallbackAction(input: ValidateAgentPhaseActionInput, fallbackReason: string): AgentPhaseAction {
  const reachable = getReachableNodes(input.graph, input.resource.side, input.phaseSnapshot.phaseId);
  const targetNodeId = reachable.includes(input.action.currentNodeId) ? input.action.currentNodeId : reachable[0] ?? input.action.currentNodeId;
  const actionType = input.resource.allowedActionTypes.includes("hold_position") ? "hold_position" : input.resource.allowedActionTypes[0] ?? "hold_position";
  return {
    ...input.action,
    targetNodeId,
    actionType,
    apCost: 0,
    businessIntent: `${input.resource.teamId} holds a legal node action after AP validation fallback: ${fallbackReason}.`,
    riskAssessment: `${input.action.riskAssessment} AP validation fallback: ${fallbackReason}.`,
    expectedResult: `Fallback keeps ${input.resource.agentId} within legal AP, route, phase and economy constraints.`,
    utilityUse: undefined,
    retreatCondition: input.action.retreatCondition,
    informationTransfer: `${input.action.informationTransfer ?? "node action info transferred"} AP validator recorded fallback.`
  };
}

function attachApAudit(action: AgentPhaseAction, costBreakdown: NodeActionPointCostBreakdown, fallbackReason?: string): AgentPhaseAction {
  return {
    ...action,
    apCost: Number.isFinite(costBreakdown.totalCost) ? costBreakdown.totalCost : action.apCost,
    apCostBreakdown: costBreakdown,
    ...(fallbackReason ? { fallbackReason, apValidationNotes: [fallbackReason] } : {})
  };
}
