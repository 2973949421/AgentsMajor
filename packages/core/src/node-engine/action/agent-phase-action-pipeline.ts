import type { AgentPhaseAction, AgentPhaseActionType, MapNodeGraph, MapNodeState, RoundNodeStateSnapshot } from "@agent-major/shared";

import type { NodeAgentEconomyResource, NodeRoundEconomyResources } from "../economy/economy-resource-adapter.js";
import { getReachableNodes } from "../graph/node-graph-service.js";
import { applyNodeAgentActionDrafts, type NodeAgentActionDraft } from "./node-agent-action-boundary.js";
import { validateAgentPhaseAction } from "./node-action-validator.js";
import { getNodeAgentRoleContext, type NodeAgentRoleContext, type NodeTeamContext } from "../team-context/node-team-context-service.js";

export interface BuildAgentPhaseActionsInput {
  graph: MapNodeGraph;
  phaseSnapshot: RoundNodeStateSnapshot;
  economyResources: NodeRoundEconomyResources;
  teamContexts?: Record<string, NodeTeamContext>;
  mode?: "deterministic" | "llm_shadow";
  llmDrafts?: NodeAgentActionDraft[];
}

export function buildAgentPhaseActions(input: BuildAgentPhaseActionsInput): AgentPhaseAction[] {
  const deterministicActions = input.economyResources.agents.map((resource) => buildAgentPhaseAction(input, resource));
  if (input.mode !== "llm_shadow" || !input.llmDrafts || input.llmDrafts.length === 0) {
    return validateActions(input, deterministicActions);
  }
  const draftedActions = applyNodeAgentActionDrafts({
    baselineActions: deterministicActions,
    drafts: input.llmDrafts
  });
  return validateActions(input, draftedActions, input.llmDrafts);
}

function buildAgentPhaseAction(input: BuildAgentPhaseActionsInput, resource: NodeAgentEconomyResource): AgentPhaseAction {
  const phaseId = input.phaseSnapshot.phaseId;
  const roleContext = getNodeAgentRoleContext(input.teamContexts, resource.agentId, resource.teamId);
  const currentNodeId = findCurrentNodeId(input.phaseSnapshot.nodeStates, resource) ?? fallbackCurrentNode(input.graph, resource.side, phaseId);
  const reachableNodes = getReachableNodes(input.graph, resource.side, phaseId);
  const actionType = chooseActionType(resource, phaseId, roleContext);
  const targetNodeId = chooseTargetNode({
    graph: input.graph,
    resource,
    actionType,
    phaseSnapshot: input.phaseSnapshot,
    currentNodeId,
    reachableNodes
  });

  return {
    agentId: resource.agentId,
    teamId: resource.teamId,
    side: resource.side,
    phaseId,
    currentNodeId,
    targetNodeId,
    actionType,
    apCost: 0,
    businessIntent: buildBusinessIntent(resource, actionType, phaseId, targetNodeId, roleContext),
    riskAssessment: buildRiskAssessment(resource, actionType),
    expectedResult: buildExpectedResult(resource, actionType, targetNodeId),
    ...(actionType === "use_utility" || actionType === "execute_site" || actionType === "retake" ? { utilityUse: resource.utilityTier } : {}),
    ...(resource.canSave ? { retreatCondition: "Save or slow down when the node fight no longer justifies the resource risk." } : {}),
    informationTransfer: "Share node information, resource pressure, and business validation evidence with teammates.",
    ...(roleContext
      ? {
          agentRole: roleContext.role,
          roleResponsibilities: roleContext.roleResponsibilities,
          roleActionBias: roleContext.roleActionBias,
          teamThesisAnchor: roleContext.teamThesisAnchor,
          businessOperatingPrinciple: roleContext.businessOperatingPrinciple,
          coachNote: roleContext.coachNote
        }
      : {})
  };
}

function validateActions(input: BuildAgentPhaseActionsInput, actions: AgentPhaseAction[], drafts: NodeAgentActionDraft[] = []): AgentPhaseAction[] {
  const draftByAgentId = new Map(drafts.map((draft) => [draft.agentId, draft] as const));
  return actions.map((action) => {
    const resource = input.economyResources.agentResourcesById[action.agentId];
    if (!resource) {
      return action;
    }
    return validateAgentPhaseAction({
      graph: input.graph,
      phaseSnapshot: input.phaseSnapshot,
      resource,
      action,
      ...(draftByAgentId.has(action.agentId) ? { claimedCostFromLlm: draftByAgentId.get(action.agentId)!.apCost } : {})
    }).action;
  });
}

function findCurrentNodeId(nodeStates: MapNodeState[], resource: NodeAgentEconomyResource): string | undefined {
  return nodeStates.find((state) =>
    resource.side === "attack" ? state.attackAgentIds.includes(resource.agentId) : state.defenseAgentIds.includes(resource.agentId)
  )?.nodeId;
}

function fallbackCurrentNode(graph: MapNodeGraph, side: "attack" | "defense", phaseId: RoundNodeStateSnapshot["phaseId"]): string {
  return getReachableNodes(graph, side, phaseId)[0] ?? (side === "attack" ? "t_spawn" : "ct_spawn");
}

function chooseActionType(
  resource: NodeAgentEconomyResource,
  phaseId: RoundNodeStateSnapshot["phaseId"],
  roleContext: NodeAgentRoleContext | undefined
): AgentPhaseActionType {
  if (resource.riskProfile === "preserve") {
    return phaseId === "post_plant_or_clutch" && resource.allowedActionTypes.includes("save") ? "save" : "hold_position";
  }

  const phaseAllowed = new Set(phaseCompatibleActions(phaseId));
  const candidateOrder = uniqueActionTypes([
    ...(roleContext?.roleActionBias ?? []),
    ...phaseActionCandidates(resource, phaseId),
    "map_control",
    "watch_angle",
    "hold_position"
  ]);
  const selected = candidateOrder.find((actionType) => resource.allowedActionTypes.includes(actionType) && phaseAllowed.has(actionType));
  if (selected) {
    return selected;
  }
  return resource.allowedActionTypes.includes("watch_angle") ? "watch_angle" : "hold_position";
}

function phaseActionCandidates(resource: NodeAgentEconomyResource, phaseId: RoundNodeStateSnapshot["phaseId"]): AgentPhaseActionType[] {
  if (phaseId === "execute_or_retake") {
    if (resource.side === "attack" && resource.allowedActionTypes.includes("execute_site")) {
      return ["execute_site", "use_utility", "prepare_trade", "map_control"];
    }
    if (resource.side === "defense" && resource.allowedActionTypes.includes("retake")) {
      return ["retake", "use_utility", "prepare_trade", "watch_angle"];
    }
    if (resource.canUseExecuteUtility && resource.allowedActionTypes.includes("use_utility")) {
      return ["use_utility", "prepare_trade", "map_control"];
    }
  }
  if (phaseId === "first_contact" && resource.allowedActionTypes.includes("gather_info")) {
    return ["gather_info", "watch_angle", "map_control", "seek_duel", "use_utility", "prepare_trade"];
  }
  if (phaseId === "mid_round_decision" && resource.allowedActionTypes.includes("rotate")) {
    return ["rotate", "map_control", "use_utility", "prepare_trade", "fake_pressure", "gather_info"];
  }
  if (phaseId === "post_plant_or_clutch") {
    return resource.side === "attack" ? ["post_plant_hold", "watch_angle", "hold_position", "save"] : ["defuse", "retake", "watch_angle", "save"];
  }
  return ["map_control", "gather_info", "watch_angle", "hold_position"];
}

function phaseCompatibleActions(phaseId: RoundNodeStateSnapshot["phaseId"]): AgentPhaseActionType[] {
  switch (phaseId) {
    case "default_opening":
      return ["hold_position", "watch_angle", "map_control", "gather_info", "use_utility", "prepare_trade", "fake_pressure", "rotate", "save"];
    case "first_contact":
      return ["hold_position", "watch_angle", "map_control", "gather_info", "use_utility", "seek_duel", "prepare_trade", "fake_pressure", "save"];
    case "mid_round_decision":
      return ["hold_position", "watch_angle", "map_control", "gather_info", "use_utility", "prepare_trade", "fake_pressure", "rotate", "save"];
    case "execute_or_retake":
      return ["hold_position", "watch_angle", "map_control", "use_utility", "seek_duel", "prepare_trade", "execute_site", "retake", "save"];
    case "post_plant_or_clutch":
      return ["hold_position", "watch_angle", "map_control", "use_utility", "prepare_trade", "retake", "post_plant_hold", "defuse", "save"];
  }
}

function chooseTargetNode(input: {
  graph: MapNodeGraph;
  resource: NodeAgentEconomyResource;
  actionType: AgentPhaseActionType;
  phaseSnapshot: RoundNodeStateSnapshot;
  currentNodeId: string;
  reachableNodes: string[];
}): string {
  const preferred = preferredTargetNodes(input.resource, input.actionType, input.phaseSnapshot.phaseId);
  const reachablePreferred = preferred.find((nodeId) => input.reachableNodes.includes(nodeId));
  if (reachablePreferred) {
    return reachablePreferred;
  }
  if (input.reachableNodes.includes(input.currentNodeId)) {
    return input.currentNodeId;
  }
  return input.reachableNodes[0] ?? input.currentNodeId;
}

function preferredTargetNodes(resource: NodeAgentEconomyResource, actionType: AgentPhaseActionType, phaseId: RoundNodeStateSnapshot["phaseId"]): string[] {
  if (actionType === "execute_site") {
    return ["a_default", "b_default", "a_ramp", "b_site"];
  }
  if (actionType === "retake") {
    return ["ct_spawn", "b_doors", "b_window", "a_ramp", "a_short"];
  }
  if (actionType === "rotate") {
    return resource.side === "attack" ? ["mid", "cat", "b_site", "mid_doors"] : ["xbox", "mid", "upper_tunnels"];
  }
  if (actionType === "gather_info") {
    return resource.side === "attack" ? ["long_doors", "top_mid", "upper_tunnels", "b_tunnel_exit"] : ["long_corner", "mid", "b_tunnel_exit"];
  }
  if (phaseId === "default_opening") {
    return resource.side === "attack" ? ["t_spawn", "outside_long", "top_mid", "outside_tunnels"] : ["a_default", "b_default", "mid_doors"];
  }
  return resource.side === "attack" ? ["mid", "a_long", "b_site"] : ["mid_doors", "a_short", "b_window"];
}

function buildBusinessIntent(
  resource: NodeAgentEconomyResource,
  actionType: AgentPhaseActionType,
  phaseId: string,
  targetNodeId: string,
  roleContext: NodeAgentRoleContext | undefined
): string {
  const roleAnchor = roleContext
    ? ` Role=${roleContext.role}; thesis=${roleContext.teamThesisAnchor}; principle=${roleContext.businessOperatingPrinciple}`
    : "";
  return `${resource.teamId} uses ${actionType} at ${targetNodeId} during ${phaseId} to test the business plan under CS node, AP, and resource constraints.${roleAnchor}`;
}

function buildRiskAssessment(resource: NodeAgentEconomyResource, actionType: AgentPhaseActionType): string {
  if (resource.riskProfile === "preserve") {
    return `${resource.economyPosture} has limited resources; ${actionType} must not be narrated as a full execute.`;
  }
  return `${resource.economyPosture} can support ${actionType}, but AP, node reachability, and teammate coordination remain binding.`;
}

function buildExpectedResult(resource: NodeAgentEconomyResource, actionType: AgentPhaseActionType, targetNodeId: string): string {
  return `${resource.agentId} should create an auditable ${actionType} state change around ${targetNodeId} for later local judging.`;
}

function uniqueActionTypes(values: AgentPhaseActionType[]): AgentPhaseActionType[] {
  return [...new Set(values)];
}
