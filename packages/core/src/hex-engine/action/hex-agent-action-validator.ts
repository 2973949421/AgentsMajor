import type { HexCell, HexMapAsset } from "@agent-major/shared";
import { getHexAgentEconomyContext, type HexAgentEconomyContext, type HexRoundEconomyContext } from "../economy/index.js";
import { validateHexMoveBudget } from "../path/index.js";
import type { HexAgentPhaseMemory, HexRoundMemory, HexSide } from "../state/index.js";
import type { HexAgentActionDraft, HexAgentActionType } from "./hex-agent-command-boundary.js";
import { isHexAgentActionType } from "./hex-agent-command-boundary.js";

const objectiveSetupApCost = 0.4;

export type HexAgentActionValidationError =
  | "unknown_agent"
  | "dead_agent_cannot_act"
  | "phase_mismatch"
  | "current_cell_mismatch"
  | "unknown_target_cell"
  | "unplayable_target_cell"
  | "invalid_action_type"
  | "missing_business_intent"
  | "move_requires_position_change"
  | "move_unreachable"
  | "move_over_budget"
  | "plant_requires_c4"
  | "plant_requires_bombsite"
  | "defuse_requires_defense"
  | "defuse_requires_planted_bomb"
  | "defuse_requires_planted_cell"
  | "target_cell_occupied"
  | "economy_context_missing"
  | "economy_disallows_action"
  | "utility_unavailable"
  | "resource_tier_too_low";

export interface HexValidatedAgentAction {
  agentId: string;
  teamId: string;
  side: HexSide;
  phaseId: HexRoundMemory["phaseId"];
  currentCellId: string;
  targetCellId: string;
  actionType: HexAgentActionType;
  apCost: number;
  pathCellIds: string[];
  verticalLinkIds: string[];
  pathSource: "pathfinding" | "none";
  businessIntent: string;
  briefRefId?: string;
  actionRationaleZh?: string;
  tacticalIntent?: string;
  riskNotes: string[];
  confidence?: number;
  repairReasons?: string[];
  valid: boolean;
  validationErrors: HexAgentActionValidationError[];
  fallbackReason?: string;
}

export interface ValidateHexAgentActionDraftInput {
  asset: HexMapAsset;
  memory: HexRoundMemory;
  draft: HexAgentActionDraft;
  economyContext?: HexRoundEconomyContext;
}

export function validateHexAgentActionDraft(input: ValidateHexAgentActionDraftInput): HexValidatedAgentAction {
  const agent = input.memory.agents.find((candidate) => candidate.agentId === input.draft.agentId);
  const targetCell = input.asset.cells.find((cell) => cell.cellId === input.draft.targetCellId);
  const actionType = resolveActionType(input, agent, targetCell);
  const validationErrors = collectValidationErrors(input, agent, targetCell, actionType);

  if (!agent) {
    return buildUnknownAgentFallback(input.draft, validationErrors);
  }
  if (validationErrors.length > 0) {
    return buildFallbackAction(input.memory, agent, validationErrors);
  }

  const budget = validateHexMoveBudget({
    asset: input.asset,
    fromCellId: agent.currentCellId,
    toCellId: input.draft.targetCellId,
    apBudget: agent.apRemaining
  });
  const apCost = roundAp((budget.apCost ?? 0) + (isObjectiveAction(actionType) ? objectiveSetupApCost : 0));

  const validated: HexValidatedAgentAction = {
    agentId: agent.agentId,
    teamId: agent.teamId,
    side: agent.side,
    phaseId: input.memory.phaseId,
    currentCellId: agent.currentCellId,
    targetCellId: input.draft.targetCellId,
    actionType,
    apCost,
    pathCellIds: budget.path?.cellIds ?? [agent.currentCellId],
    verticalLinkIds: budget.path?.verticalLinkIds ?? [],
    pathSource: budget.path?.reachable ? "pathfinding" : "none",
    businessIntent: input.draft.businessIntent,
    riskNotes: input.draft.riskNotes ?? [],
    valid: true,
    validationErrors: []
  };
  const repairReasons = buildRepairReasons(input, agent, targetCell, actionType);
  if (repairReasons.length > 0) {
    validated.repairReasons = repairReasons;
  }
  if (input.draft.tacticalIntent) {
    validated.tacticalIntent = input.draft.tacticalIntent;
  }
  if (input.draft.briefRefId) {
    validated.briefRefId = input.draft.briefRefId;
  }
  if (input.draft.actionRationaleZh) {
    validated.actionRationaleZh = input.draft.actionRationaleZh;
  }
  if (input.draft.confidence !== undefined) {
    validated.confidence = input.draft.confidence;
  }
  return validated;
}

export function buildHexAgentFallbackAction(input: {
  memory: HexRoundMemory;
  agent: HexAgentPhaseMemory;
  reason: string;
}): HexValidatedAgentAction {
  return {
    agentId: input.agent.agentId,
    teamId: input.agent.teamId,
    side: input.agent.side,
    phaseId: input.memory.phaseId,
    currentCellId: input.agent.currentCellId,
    targetCellId: input.agent.currentCellId,
    actionType: "hold_position",
    apCost: 0,
    pathCellIds: [input.agent.currentCellId],
    verticalLinkIds: [],
    pathSource: "none",
    businessIntent: `${input.agent.teamId}/${input.agent.agentId} holds position because Hex action validation rejected the draft: ${input.reason}.`,
    riskNotes: [input.reason],
    valid: false,
    validationErrors: [],
    fallbackReason: input.reason
  };
}

function collectValidationErrors(
  input: ValidateHexAgentActionDraftInput,
  agent: HexAgentPhaseMemory | undefined,
  targetCell: HexCell | undefined,
  actionType: HexAgentActionType
): HexAgentActionValidationError[] {
  const errors: HexAgentActionValidationError[] = [];
  if (!agent) {
    errors.push("unknown_agent");
    return errors;
  }
  if (agent.lifeStatus === "dead") {
    errors.push("dead_agent_cannot_act");
  }
  if (input.draft.phaseId !== input.memory.phaseId) {
    errors.push("phase_mismatch");
  }
  if (input.draft.currentCellId !== agent.currentCellId) {
    errors.push("current_cell_mismatch");
  }
  if (!targetCell) {
    errors.push("unknown_target_cell");
  } else if (!targetCell.playable) {
    errors.push("unplayable_target_cell");
  }
  if (!isHexAgentActionType(input.draft.actionType)) {
    errors.push("invalid_action_type");
  }
  if (input.draft.businessIntent.trim().length === 0) {
    errors.push("missing_business_intent");
  }
  if (actionType === "move" && input.draft.targetCellId === agent.currentCellId) {
    errors.push("move_requires_position_change");
  }
  errors.push(...collectEconomyValidationErrors(input, agent));
  if (targetCell?.playable) {
    const budget = validateHexMoveBudget({
      asset: input.asset,
      fromCellId: agent.currentCellId,
      toCellId: input.draft.targetCellId,
      apBudget: agent.apRemaining
    });
    if (!budget.reachable) {
      errors.push("move_unreachable");
    } else if (!isWithinBudgetForAction(budget.apCost, agent.apRemaining, actionType)) {
      errors.push("move_over_budget");
    }
  }
  if (actionType === "plant_bomb") {
    if (!agent.carryingC4) {
      errors.push("plant_requires_c4");
    }
    if (!targetCell?.flags.includes("bombsite_a") && !targetCell?.flags.includes("bombsite_b")) {
      errors.push("plant_requires_bombsite");
    }
  }
  if (actionType === "defuse_bomb") {
    if (agent.side !== "defense") {
      errors.push("defuse_requires_defense");
    }
    if (!input.memory.bombState.planted) {
      errors.push("defuse_requires_planted_bomb");
    }
    if (!input.memory.bombState.plantedCellId || input.draft.targetCellId !== input.memory.bombState.plantedCellId) {
      errors.push("defuse_requires_planted_cell");
    }
  }
  return uniqueErrors(errors);
}

function collectEconomyValidationErrors(
  input: ValidateHexAgentActionDraftInput,
  agent: HexAgentPhaseMemory | undefined
): HexAgentActionValidationError[] {
  if (!input.economyContext || !agent) {
    return [];
  }
  const economy = getHexAgentEconomyContext({
    economyContext: input.economyContext,
    agentId: agent.agentId
  });
  if (!economy) {
    return ["economy_context_missing"];
  }

  const errors: HexAgentActionValidationError[] = [];
  const actionType = resolveActionType(input, agent, input.asset.cells.find((cell) => cell.cellId === input.draft.targetCellId));
  if (isObjectiveAction(actionType)) {
    return errors;
  }
  if (!economy.allowedActionTypes.includes(actionType)) {
    errors.push("economy_disallows_action");
  }
  if (actionType === "use_utility" && economy.utilityTier === "none") {
    errors.push("utility_unavailable");
  }
  if (actionType === "execute_site" && isLowResourceEconomy(economy)) {
    errors.push("resource_tier_too_low");
  }
  return errors;
}

function resolveActionType(
  input: ValidateHexAgentActionDraftInput,
  agent: HexAgentPhaseMemory | undefined,
  targetCell: HexCell | undefined
): HexAgentActionType {
  if (
    agent?.carryingC4
    && input.draft.actionType === "move"
    && targetCell
    && isBombsiteCell(targetCell)
    && mentionsPlantIntent(input.draft.businessIntent)
  ) {
    return "plant_bomb";
  }
  return input.draft.actionType;
}

function buildRepairReasons(
  input: ValidateHexAgentActionDraftInput,
  agent: HexAgentPhaseMemory,
  targetCell: HexCell | undefined,
  actionType: HexAgentActionType
): string[] {
  return actionType !== input.draft.actionType
    && actionType === "plant_bomb"
    && agent.carryingC4
    && targetCell
    && isBombsiteCell(targetCell)
    ? ["repaired_move_to_plant_intent"]
    : [];
}

function isWithinBudgetForAction(apCost: number | undefined, apRemaining: number, actionType: HexAgentActionType): boolean {
  if (apCost === undefined) {
    return false;
  }
  const totalCost = apCost + (isObjectiveAction(actionType) ? objectiveSetupApCost : 0);
  return totalCost <= apRemaining;
}

function isBombsiteCell(cell: HexCell): boolean {
  return cell.flags.includes("bombsite_a") || cell.flags.includes("bombsite_b");
}

function mentionsPlantIntent(text: string): boolean {
  return /\bplant\b|\bc4\b|\bbomb\b|下包|埋包|安包/i.test(text);
}

function isObjectiveAction(actionType: HexAgentActionType): boolean {
  return actionType === "plant_bomb" || actionType === "defuse_bomb";
}

function isLowResourceEconomy(economy: HexAgentEconomyContext): boolean {
  return economy.resourceTier === "low";
}

function buildFallbackAction(
  memory: HexRoundMemory,
  agent: HexAgentPhaseMemory,
  validationErrors: HexAgentActionValidationError[]
): HexValidatedAgentAction {
  const fallbackReason = validationErrors.join(";");
  return {
    ...buildHexAgentFallbackAction({
      memory,
      agent,
      reason: fallbackReason
    }),
    validationErrors
  };
}

function buildUnknownAgentFallback(draft: HexAgentActionDraft, validationErrors: HexAgentActionValidationError[]): HexValidatedAgentAction {
  return {
    agentId: draft.agentId,
    teamId: "unknown",
    side: "attack",
    phaseId: draft.phaseId,
    currentCellId: draft.currentCellId,
    targetCellId: draft.currentCellId,
    actionType: "hold_position",
    apCost: 0,
    pathCellIds: [draft.currentCellId],
    verticalLinkIds: [],
    pathSource: "none",
    businessIntent: `Unknown agent ${draft.agentId} cannot execute Hex action draft.`,
    riskNotes: validationErrors,
    valid: false,
    validationErrors,
    fallbackReason: validationErrors.join(";")
  };
}

function uniqueErrors(errors: HexAgentActionValidationError[]): HexAgentActionValidationError[] {
  return [...new Set(errors)];
}

function roundAp(value: number): number {
  return Math.round(value * 1000) / 1000;
}
