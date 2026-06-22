import type { HexValidatedAgentAction } from "../action/index.js";
import type { HexMapAsset } from "@agent-major/shared";
import type { HexPhaseMemoryEvent, HexRoundMemory } from "../state/index.js";

export function actionToMovementEvents(action: HexValidatedAgentAction, memory: HexRoundMemory): HexPhaseMemoryEvent[] {
  if (!action.valid) {
    return [];
  }
  const events: HexPhaseMemoryEvent[] = [];
  if (action.targetCellId !== action.currentCellId && !isEnemyOccupiedTarget(action, memory)) {
    events.push({
      type: "move",
      agentId: action.agentId,
      toCellId: action.targetCellId
    });
  }
  return events;
}

export function actionToObjectiveEvents(action: HexValidatedAgentAction, memory: HexRoundMemory, asset: HexMapAsset): HexPhaseMemoryEvent[] {
  if (!action.valid) {
    return [];
  }
  const actor = memory.agents.find((agent) => agent.agentId === action.agentId);
  if (!actor || actor.lifeStatus === "dead") {
    return [];
  }
  const events: HexPhaseMemoryEvent[] = [];
  if (action.actionType === "plant_bomb") {
    const cell = asset.cells.find((candidate) => candidate.cellId === action.targetCellId);
    if (
      !actor.carryingC4
      || actor.currentCellId !== action.targetCellId
      || isLiveEnemyOnCell(action, memory, action.targetCellId)
      || !cell?.playable
      || (!cell.flags.includes("bombsite_a") && !cell.flags.includes("bombsite_b"))
    ) {
      return events;
    }
    events.push({
      type: "bomb_planted",
      agentId: action.agentId,
      cellId: action.targetCellId
    });
  }
  if (action.actionType === "defuse_bomb") {
    if (
      actor.side !== "defense"
      || !memory.bombState.planted
      || !memory.bombState.plantedCellId
      || actor.currentCellId !== memory.bombState.plantedCellId
      || action.targetCellId !== memory.bombState.plantedCellId
    ) {
      return events;
    }
    events.push({
      type: "bomb_defused",
      agentId: action.agentId
    });
  }
  return events;
}

export function actionToActionResultEvent(action: HexValidatedAgentAction, objectiveEvents: readonly HexPhaseMemoryEvent[] = []): HexPhaseMemoryEvent {
  const repairSummary = action.repairReasons?.length ? ` repairs=${action.repairReasons.join(",")}.` : "";
  const pathSummary = action.pathCellIds.length > 1 ? ` path=${action.pathCellIds.join(">")}.` : "";
  const verticalSummary = action.verticalLinkIds.length > 0 ? ` vertical=${action.verticalLinkIds.join(",")}.` : "";
  const objectiveCompleted = isObjectiveActionCompleted(action, objectiveEvents);
  const objectiveSummary = isObjectiveAction(action.actionType) && !objectiveCompleted ? " objective_not_completed." : "";
  return {
    type: "action_result",
    agentId: action.agentId,
    status: isObjectiveAction(action.actionType) && !objectiveCompleted ? "partial" : "success",
    summary: `Hex action ${action.actionType} ${action.currentCellId}->${action.targetCellId}.${repairSummary}${pathSummary}${verticalSummary}${objectiveSummary}`,
    businessExecutionSummary: action.businessIntent
  };
}

function isObjectiveAction(actionType: HexValidatedAgentAction["actionType"]): boolean {
  return actionType === "plant_bomb" || actionType === "defuse_bomb";
}

function isObjectiveActionCompleted(action: HexValidatedAgentAction, objectiveEvents: readonly HexPhaseMemoryEvent[]): boolean {
  if (action.actionType === "plant_bomb") {
    return objectiveEvents.some((event) => event.type === "bomb_planted" && event.agentId === action.agentId && event.cellId === action.targetCellId);
  }
  if (action.actionType === "defuse_bomb") {
    return objectiveEvents.some((event) => event.type === "bomb_defused" && event.agentId === action.agentId);
  }
  return true;
}

function isEnemyOccupiedTarget(action: HexValidatedAgentAction, memory: HexRoundMemory): boolean {
  return isLiveEnemyOnCell(action, memory, action.targetCellId);
}

function isLiveEnemyOnCell(action: HexValidatedAgentAction, memory: HexRoundMemory, cellId: string): boolean {
  return memory.agents.some((agent) =>
    agent.agentId !== action.agentId
    && agent.teamId !== action.teamId
    && agent.lifeStatus !== "dead"
    && agent.currentCellId === cellId
  );
}
