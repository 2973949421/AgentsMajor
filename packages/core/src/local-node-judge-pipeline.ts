import type { AgentPhaseAction, LocalNodeVerdict, MapNodeGraph, MapNodeState, RoundNodeStateSnapshot } from "@agent-major/shared";

export interface BuildLocalNodeVerdictsInput {
  graph: MapNodeGraph;
  phaseSnapshot: RoundNodeStateSnapshot;
  agentActions: AgentPhaseAction[];
}

const winConditionCheckPhases = new Set(["execute_or_retake", "post_plant_or_clutch"]);
const plantOrRetakeKinds = new Set(["plant", "site", "retake"]);

export function buildLocalNodeVerdicts(input: BuildLocalNodeVerdictsInput): LocalNodeVerdict[] {
  const actionsByNode = groupActionsByTargetNode(input.agentActions);
  return input.phaseSnapshot.nodeStates.map((nodeState) =>
    buildLocalNodeVerdict({
      graph: input.graph,
      nodeState,
      actions: actionsByNode[nodeState.nodeId] ?? [],
      phaseId: input.phaseSnapshot.phaseId
    })
  );
}

function buildLocalNodeVerdict(input: {
  graph: MapNodeGraph;
  nodeState: MapNodeState;
  actions: AgentPhaseAction[];
  phaseId: RoundNodeStateSnapshot["phaseId"];
}): LocalNodeVerdict {
  const hasAttack = input.nodeState.attackAgentIds.length > 0;
  const hasDefense = input.nodeState.defenseAgentIds.length > 0;
  const controlAfter = hasAttack && hasDefense ? "contested" : hasAttack ? "attack" : hasDefense ? "defense" : "neutral";
  const businessIntents = input.actions.map((action) => action.businessIntent).filter((value) => value.length > 0);
  const node = input.graph.nodes.find((candidate) => candidate.id === input.nodeState.nodeId);

  return {
    phaseId: input.phaseId,
    nodeId: input.nodeState.nodeId,
    summary: buildSummary(input.nodeState, controlAfter, businessIntents),
    controlAfter,
    informationAdvantage: informationAdvantageForControl(controlAfter),
    engagementOccurred: hasAttack && hasDefense,
    casualties: [],
    resourceChanges: input.actions.map((action) => `${action.agentId}:${action.actionType}:AP${action.apCost}`),
    businessPlanValidated: businessIntents.length > 0 ? businessIntents : [`${input.nodeState.nodeId} 暂无新增商业行动，保持节点状态。`],
    businessPlanBroken: [],
    nextPhaseInitiative: initiativeForControl(controlAfter),
    triggersWinConditionCheck: shouldTriggerWinConditionCheck(input.phaseId, node?.kind)
  };
}

function groupActionsByTargetNode(actions: AgentPhaseAction[]): Record<string, AgentPhaseAction[]> {
  const grouped: Record<string, AgentPhaseAction[]> = {};
  for (const action of actions) {
    grouped[action.targetNodeId] = [...(grouped[action.targetNodeId] ?? []), action];
  }
  return grouped;
}

function buildSummary(nodeState: MapNodeState, controlAfter: LocalNodeVerdict["controlAfter"], businessIntents: string[]): string {
  const attackCount = nodeState.attackAgentIds.length;
  const defenseCount = nodeState.defenseAgentIds.length;
  const intentSummary = businessIntents.length > 0 ? `商业意图：${businessIntents.join(" | ")}` : "暂无新增商业动作。";
  return `${nodeState.phaseId} 阶段 ${nodeState.nodeId} 局部裁定为 ${controlAfter}；攻方 ${attackCount} 人，守方 ${defenseCount} 人。${intentSummary}`;
}

function informationAdvantageForControl(control: LocalNodeVerdict["controlAfter"]): LocalNodeVerdict["informationAdvantage"] {
  if (control === "attack" || control === "defense") {
    return control;
  }
  if (control === "contested") {
    return "even";
  }
  return "unknown";
}

function initiativeForControl(control: LocalNodeVerdict["controlAfter"]): LocalNodeVerdict["nextPhaseInitiative"] {
  if (control === "attack" || control === "defense" || control === "contested") {
    return control;
  }
  return "none";
}

function shouldTriggerWinConditionCheck(phaseId: RoundNodeStateSnapshot["phaseId"], nodeKind: string | undefined): boolean {
  return winConditionCheckPhases.has(phaseId) && Boolean(nodeKind && plantOrRetakeKinds.has(nodeKind));
}
