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

export function actionToActionResultEvent(action: HexValidatedAgentAction): HexPhaseMemoryEvent {
  const repairSummary = action.repairReasons?.length ? ` repairs=${action.repairReasons.join(",")}.` : "";
  const pathSummary = action.pathCellIds.length > 1 ? ` path=${action.pathCellIds.join(">")}.` : "";
  const verticalSummary = action.verticalLinkIds.length > 0 ? ` vertical=${action.verticalLinkIds.join(",")}.` : "";
  return {
    type: "action_result",
    agentId: action.agentId,
    status: "success",
    summary: `Hex action ${action.actionType} ${action.currentCellId}->${action.targetCellId}.${repairSummary}${pathSummary}${verticalSummary}`,
    businessExecutionSummary: action.businessIntent
  };
}

function isEnemyOccupiedTarget(action: HexValidatedAgentAction, memory: HexRoundMemory): boolean {
  return memory.agents.some((agent) =>
    agent.agentId !== action.agentId
    && agent.teamId !== action.teamId
    && agent.lifeStatus !== "dead"
    && agent.currentCellId === action.targetCellId
  );
}
