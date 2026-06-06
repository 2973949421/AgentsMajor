import type { AgentPhaseAction, LocalNodeVerdict, MapNodeGraph, RoundPhaseId, RoundNodeStateSnapshot } from "@agent-major/shared";

export type NodeBombState = "not_planted" | "planted" | "defused" | "exploded";
export type NodeRoundWinType = "elimination" | "timeout" | "bomb_exploded" | "defuse";

export interface NodeRoundWinConditionState {
  bombState: NodeBombState;
  plantedNodeId?: string;
}

export interface NodeRoundWinConditionResult extends NodeRoundWinConditionState {
  isRoundOver: boolean;
  winnerSide?: "attack" | "defense";
  winnerTeamId?: string;
  loserTeamId?: string;
  roundWinType?: NodeRoundWinType;
  phaseId: RoundPhaseId;
  nodeId?: string;
  reason: string;
  evidence: string[];
}

export interface EvaluateNodeRoundWinConditionInput {
  graph: MapNodeGraph;
  phaseSnapshot: RoundNodeStateSnapshot;
  agentActions: AgentPhaseAction[];
  localVerdicts: LocalNodeVerdict[];
  attackTeamId: string;
  defenseTeamId: string;
  previousState?: NodeRoundWinConditionState;
}

const finalPhaseId: RoundPhaseId = "post_plant_or_clutch";

export function evaluateNodeRoundWinCondition(input: EvaluateNodeRoundWinConditionInput): NodeRoundWinConditionResult {
  const liveAttackAgentIds = collectLiveAgentIds(input.phaseSnapshot, "attack");
  const liveDefenseAgentIds = collectLiveAgentIds(input.phaseSnapshot, "defense");
  const carriedState = input.previousState ?? { bombState: "not_planted" as const };
  const plantedState = materializeBombState(input, carriedState);

  if (liveAttackAgentIds.length === 0 && liveDefenseAgentIds.length > 0) {
    return buildCompletedResult(input, plantedState, {
      winnerSide: "defense",
      roundWinType: "elimination",
      reason: "攻方已无存活 agent，守方通过全歼赢下 shadow 回合。",
      evidence: [`liveAttack=0`, `liveDefense=${liveDefenseAgentIds.length}`]
    });
  }

  if (liveDefenseAgentIds.length === 0 && liveAttackAgentIds.length > 0) {
    return buildCompletedResult(input, plantedState, {
      winnerSide: "attack",
      roundWinType: "elimination",
      reason: "守方已无存活 agent，攻方通过全歼赢下 shadow 回合。",
      evidence: [`liveAttack=${liveAttackAgentIds.length}`, `liveDefense=0`]
    });
  }

  if (plantedState.bombState === "defused") {
    return buildCompletedResult(input, plantedState, {
      winnerSide: "defense",
      roundWinType: "defuse",
      reason: "守方在已下包状态完成拆包，守方赢下 shadow 回合。",
      evidence: [`bombState=defused`, `plantedNode=${plantedState.plantedNodeId ?? "unknown"}`],
      ...(plantedState.plantedNodeId ? { nodeId: plantedState.plantedNodeId } : {})
    });
  }

  if (input.phaseSnapshot.phaseId === finalPhaseId) {
    const plantHeldByAttack = plantedState.plantedNodeId ? verdictControlForNode(input.localVerdicts, plantedState.plantedNodeId) === "attack" : false;
    if (plantedState.bombState === "planted" && plantHeldByAttack) {
      return buildCompletedResult(input, { ...plantedState, bombState: "exploded" }, {
        winnerSide: "attack",
        roundWinType: "bomb_exploded",
        reason: "攻方完成下包并在最终阶段守住包点，按 shadow 硬条件判定包炸获胜。",
        evidence: [`bombState=planted`, `attackControl=${plantedState.plantedNodeId}`],
        ...(plantedState.plantedNodeId ? { nodeId: plantedState.plantedNodeId } : {})
      });
    }

    return buildCompletedResult(input, plantedState, {
      winnerSide: "defense",
      roundWinType: "timeout",
      reason: "最终阶段未形成攻方有效下包守包状态，按 shadow 硬条件判定守方时间胜。",
      evidence: [`phase=${finalPhaseId}`, `bombState=${plantedState.bombState}`]
    });
  }

  return {
    ...plantedState,
    isRoundOver: false,
    phaseId: input.phaseSnapshot.phaseId,
    reason: "当前阶段未触发硬胜负条件，继续推进 shadow 回合。",
    evidence: [
      `liveAttack=${liveAttackAgentIds.length}`,
      `liveDefense=${liveDefenseAgentIds.length}`,
      `bombState=${plantedState.bombState}`
    ]
  };
}

function materializeBombState(input: EvaluateNodeRoundWinConditionInput, previousState: NodeRoundWinConditionState): NodeRoundWinConditionState {
  if (previousState.bombState === "defused" || previousState.bombState === "exploded") {
    return previousState;
  }

  const defuseAction = input.agentActions.find(
    (action) => action.side === "defense" && action.actionType === "defuse" && isPlantNode(input.graph, action.targetNodeId)
  );
  if (previousState.bombState === "planted" && defuseAction && verdictControlForNode(input.localVerdicts, defuseAction.targetNodeId) === "defense") {
    return {
      bombState: "defused",
      plantedNodeId: previousState.plantedNodeId ?? defuseAction.targetNodeId
    };
  }

  const plantAction = input.agentActions.find(
    (action) => action.side === "attack" && action.actionType === "execute_site" && isPlantNode(input.graph, action.targetNodeId)
  );
  if (previousState.bombState === "not_planted" && plantAction && verdictControlForNode(input.localVerdicts, plantAction.targetNodeId) === "attack") {
    return {
      bombState: "planted",
      plantedNodeId: plantAction.targetNodeId
    };
  }

  return previousState;
}

function collectLiveAgentIds(snapshot: RoundNodeStateSnapshot, side: "attack" | "defense"): string[] {
  const values = snapshot.nodeStates.flatMap((state) => (side === "attack" ? state.attackAgentIds : state.defenseAgentIds));
  return [...new Set(values)].sort();
}

function isPlantNode(graph: MapNodeGraph, nodeId: string): boolean {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  return node?.kind === "plant" || node?.kind === "site";
}

function verdictControlForNode(verdicts: LocalNodeVerdict[], nodeId: string): LocalNodeVerdict["controlAfter"] | undefined {
  return verdicts.find((verdict) => verdict.nodeId === nodeId)?.controlAfter;
}

function buildCompletedResult(
  input: EvaluateNodeRoundWinConditionInput,
  state: NodeRoundWinConditionState,
  completed: {
    winnerSide: "attack" | "defense";
    roundWinType: NodeRoundWinType;
    reason: string;
    evidence: string[];
    nodeId?: string;
  }
): NodeRoundWinConditionResult {
  const winnerTeamId = completed.winnerSide === "attack" ? input.attackTeamId : input.defenseTeamId;
  const loserTeamId = completed.winnerSide === "attack" ? input.defenseTeamId : input.attackTeamId;
  return {
    ...state,
    isRoundOver: true,
    winnerSide: completed.winnerSide,
    winnerTeamId,
    loserTeamId,
    roundWinType: completed.roundWinType,
    phaseId: input.phaseSnapshot.phaseId,
    reason: completed.reason,
    evidence: completed.evidence,
    ...(completed.nodeId ? { nodeId: completed.nodeId } : {})
  };
}
