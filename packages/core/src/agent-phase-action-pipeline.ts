import type { AgentPhaseAction, AgentPhaseActionType, MapNodeGraph, MapNodeState, RoundNodeStateSnapshot } from "@agent-major/shared";

import type { NodeAgentEconomyResource, NodeRoundEconomyResources } from "./economy-resource-adapter.js";
import { getReachableNodes } from "./node-graph-service.js";

export interface BuildAgentPhaseActionsInput {
  graph: MapNodeGraph;
  phaseSnapshot: RoundNodeStateSnapshot;
  economyResources: NodeRoundEconomyResources;
}

export function buildAgentPhaseActions(input: BuildAgentPhaseActionsInput): AgentPhaseAction[] {
  return input.economyResources.agents.map((resource) => buildAgentPhaseAction(input, resource));
}

function buildAgentPhaseAction(input: BuildAgentPhaseActionsInput, resource: NodeAgentEconomyResource): AgentPhaseAction {
  const phaseId = input.phaseSnapshot.phaseId;
  const currentNodeId = findCurrentNodeId(input.phaseSnapshot.nodeStates, resource) ?? fallbackCurrentNode(input.graph, resource.side, phaseId);
  const reachableNodes = getReachableNodes(input.graph, resource.side, phaseId);
  const actionType = chooseActionType(resource, phaseId);
  const targetNodeId = chooseTargetNode({
    graph: input.graph,
    resource,
    actionType,
    phaseSnapshot: input.phaseSnapshot,
    currentNodeId,
    reachableNodes
  });
  const apCost = apCostForAction(actionType, currentNodeId, targetNodeId);

  return {
    agentId: resource.agentId,
    teamId: resource.teamId,
    side: resource.side,
    phaseId,
    currentNodeId,
    targetNodeId,
    actionType,
    apCost,
    businessIntent: buildBusinessIntent(resource, actionType, phaseId, targetNodeId),
    riskAssessment: buildRiskAssessment(resource, actionType),
    expectedResult: buildExpectedResult(resource, actionType, targetNodeId),
    utilityUse: actionType === "use_utility" || actionType === "execute_site" || actionType === "retake" ? resource.utilityTier : undefined,
    retreatCondition: resource.canSave ? "节点争夺失败或资源价值不足时保留下一阶段能力。" : undefined,
    informationTransfer: "将节点信息、资源压力和商业验证结果传递给队友。"
  };
}

function findCurrentNodeId(nodeStates: MapNodeState[], resource: NodeAgentEconomyResource): string | undefined {
  return nodeStates.find((state) =>
    resource.side === "attack" ? state.attackAgentIds.includes(resource.agentId) : state.defenseAgentIds.includes(resource.agentId)
  )?.nodeId;
}

function fallbackCurrentNode(graph: MapNodeGraph, side: "attack" | "defense", phaseId: RoundNodeStateSnapshot["phaseId"]): string {
  return getReachableNodes(graph, side, phaseId)[0] ?? (side === "attack" ? "t_spawn" : "ct_spawn");
}

function chooseActionType(resource: NodeAgentEconomyResource, phaseId: RoundNodeStateSnapshot["phaseId"]): AgentPhaseActionType {
  if (resource.riskProfile === "preserve") {
    return phaseId === "post_plant_or_clutch" && resource.allowedActionTypes.includes("save") ? "save" : "hold_position";
  }
  if (phaseId === "execute_or_retake") {
    if (resource.side === "attack" && resource.allowedActionTypes.includes("execute_site")) {
      return "execute_site";
    }
    if (resource.side === "defense" && resource.allowedActionTypes.includes("retake")) {
      return "retake";
    }
    if (resource.canUseExecuteUtility && resource.allowedActionTypes.includes("use_utility")) {
      return "use_utility";
    }
  }
  if (phaseId === "first_contact" && resource.allowedActionTypes.includes("gather_info")) {
    return "gather_info";
  }
  if (phaseId === "mid_round_decision" && resource.allowedActionTypes.includes("rotate")) {
    return "rotate";
  }
  if (resource.allowedActionTypes.includes("map_control")) {
    return "map_control";
  }
  return resource.allowedActionTypes.includes("watch_angle") ? "watch_angle" : "hold_position";
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

function apCostForAction(actionType: AgentPhaseActionType, currentNodeId: string, targetNodeId: string): number {
  if (actionType === "hold_position") {
    return currentNodeId === targetNodeId ? 0 : 1;
  }
  if (actionType === "execute_site" || actionType === "retake" || actionType === "defuse") {
    return 2;
  }
  return currentNodeId === targetNodeId ? 1 : 2;
}

function buildBusinessIntent(resource: NodeAgentEconomyResource, actionType: AgentPhaseActionType, phaseId: string, targetNodeId: string): string {
  return `${resource.teamId} 在 ${phaseId} 通过 ${actionType} 争夺 ${targetNodeId}，用资源约束下的 CS 行动验证本轮商业计划的切入点、协同质量和风险承受能力。`;
}

function buildRiskAssessment(resource: NodeAgentEconomyResource, actionType: AgentPhaseActionType): string {
  if (resource.riskProfile === "preserve") {
    return `${resource.economyPosture} 资源有限，${actionType} 必须避免把低预算误写成完整高配执行。`;
  }
  return `${resource.economyPosture} 可以承担 ${actionType}，但仍受 AP、节点可达性和队伍协同约束。`;
}

function buildExpectedResult(resource: NodeAgentEconomyResource, actionType: AgentPhaseActionType, targetNodeId: string): string {
  return `${resource.agentId} 预期在 ${targetNodeId} 形成 ${actionType} 的局部状态变化，并给后续局部裁判提供可审计事实。`;
}
