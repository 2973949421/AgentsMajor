import type { AgentPhaseAction, LocalNodeVerdict, MapNodeGraph, MapNodeState, RoundNodeStateSnapshot } from "@agent-major/shared";

import type { LocalNodeJudgeDraft } from "./node-llm-boundary.js";

export interface BuildLocalNodeVerdictsInput {
  graph: MapNodeGraph;
  phaseSnapshot: RoundNodeStateSnapshot;
  agentActions: AgentPhaseAction[];
  mode?: "deterministic" | "llm_shadow";
  llmDrafts?: LocalNodeJudgeDraft[];
}

const winConditionCheckPhases = new Set(["execute_or_retake", "post_plant_or_clutch"]);
const plantOrRetakeKinds = new Set(["plant", "site", "retake"]);

export function buildLocalNodeVerdicts(input: BuildLocalNodeVerdictsInput): LocalNodeVerdict[] {
  const actionsByNode = groupActionsByTargetNode(input.agentActions);
  const deterministicVerdicts = input.phaseSnapshot.nodeStates.map((nodeState) =>
    buildLocalNodeVerdict({
      graph: input.graph,
      nodeState,
      actions: actionsByNode[nodeState.nodeId] ?? [],
      phaseId: input.phaseSnapshot.phaseId
    })
  );
  if (input.mode !== "llm_shadow" || !input.llmDrafts || input.llmDrafts.length === 0) {
    return deterministicVerdicts;
  }
  return applyLocalNodeJudgeDrafts({
    phaseSnapshot: input.phaseSnapshot,
    deterministicVerdicts,
    llmDrafts: input.llmDrafts
  });
}

export function applyLocalNodeJudgeDrafts(input: {
  phaseSnapshot: RoundNodeStateSnapshot;
  deterministicVerdicts: LocalNodeVerdict[];
  llmDrafts: LocalNodeJudgeDraft[];
}): LocalNodeVerdict[] {
  const draftByNodeId = new Map(input.llmDrafts.map((draft) => [draft.nodeId, draft] as const));
  const nodeStateById = new Map(input.phaseSnapshot.nodeStates.map((nodeState) => [nodeState.nodeId, nodeState] as const));

  return input.deterministicVerdicts.map((verdict) => {
    const draft = draftByNodeId.get(verdict.nodeId);
    const nodeState = nodeStateById.get(verdict.nodeId);
    if (!draft || !nodeState) {
      return verdict;
    }
    const conflictReason = candidateControlConflictReason(nodeState, draft.controlAfterCandidate);
    if (conflictReason) {
      return {
        ...verdict,
        summary: `${draft.summary} LLM shadow 候选控制权与节点人数事实冲突，已降级为 deterministic 控制权：${verdict.controlAfter}。`,
        businessPlanValidated: mergeStrings(verdict.businessPlanValidated, draft.businessPlanValidated),
        businessPlanBroken: mergeStrings(verdict.businessPlanBroken, [conflictReason, ...draft.businessPlanBroken, ...draft.riskNotes])
      };
    }

    return {
      ...verdict,
      summary: draft.summary,
      controlAfter: draft.controlAfterCandidate,
      informationAdvantage: informationAdvantageForControl(draft.controlAfterCandidate),
      businessPlanValidated: mergeStrings(verdict.businessPlanValidated, draft.businessPlanValidated),
      businessPlanBroken: mergeStrings(verdict.businessPlanBroken, [...draft.businessPlanBroken, ...draft.riskNotes]),
      nextPhaseInitiative: initiativeForControl(draft.controlAfterCandidate)
    };
  });
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
  const businessIntents = input.actions.flatMap((action) => buildActionBusinessEvidence(action)).filter((value) => value.length > 0);
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

function buildActionBusinessEvidence(action: AgentPhaseAction): string[] {
  return [
    action.businessIntent,
    action.agentRole ? `role:${action.agentRole}` : "",
    action.teamThesisAnchor ? `team_thesis:${action.teamThesisAnchor}` : "",
    action.businessOperatingPrinciple ? `operating_principle:${action.businessOperatingPrinciple}` : "",
    action.coachNote ? `coach_note:${action.coachNote}` : ""
  ].filter((value) => value.length > 0);
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

function candidateControlConflictReason(nodeState: MapNodeState, candidate: LocalNodeVerdict["controlAfter"]): string | undefined {
  const hasAttack = nodeState.attackAgentIds.length > 0;
  const hasDefense = nodeState.defenseAgentIds.length > 0;
  if (hasAttack && hasDefense && candidate !== "contested") {
    return `llm_candidate_control_conflict:${nodeState.nodeId}:expected_contested:got_${candidate}`;
  }
  if (hasAttack && !hasDefense && candidate === "defense") {
    return `llm_candidate_control_conflict:${nodeState.nodeId}:no_defense_agents`;
  }
  if (!hasAttack && hasDefense && candidate === "attack") {
    return `llm_candidate_control_conflict:${nodeState.nodeId}:no_attack_agents`;
  }
  if (!hasAttack && !hasDefense && (candidate === "attack" || candidate === "defense" || candidate === "contested")) {
    return `llm_candidate_control_conflict:${nodeState.nodeId}:empty_node`;
  }
  return undefined;
}

function mergeStrings(left: string[] | undefined, right: string[] | undefined): string[] {
  return [...new Set([...(left ?? []), ...(right ?? [])].filter((value) => value.length > 0))];
}
