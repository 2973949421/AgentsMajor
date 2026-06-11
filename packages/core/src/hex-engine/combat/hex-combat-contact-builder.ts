import type { HexCell, HexMapAsset } from "@agent-major/shared";
import type { HexValidatedAgentAction } from "../action/index.js";
import { findHexPath } from "../path/index.js";
import type { HexAgentPhaseMemory, HexRoundMemory } from "../state/index.js";
import type { HexCombatContact, HexCombatParticipant, HexCombatTriggerReason } from "./hex-combat-types.js";

const activeCombatActionTypes = new Set([
  "peek",
  "seek_duel",
  "execute_site",
  "retake",
  "defuse_bomb",
  "plant_bomb",
  "map_control"
]);

const closeCellDistance = 3;

export interface BuildHexCombatContactsInput {
  asset: HexMapAsset;
  memory: HexRoundMemory;
  actions: HexValidatedAgentAction[];
}

export function buildHexCombatContacts(input: BuildHexCombatContactsInput): HexCombatContact[] {
  const cellsById = new Map(input.asset.cells.map((cell) => [cell.cellId, cell]));
  const actionsByAgentId = new Map(input.actions.map((action) => [action.agentId, action]));
  const participants = input.memory.agents
    .filter((agent) => agent.lifeStatus !== "dead")
    .map((agent) => buildParticipant(agent, actionsByAgentId.get(agent.agentId), cellsById))
    .filter((participant): participant is HexCombatParticipant => Boolean(participant));

  const attackParticipants = participants.filter((participant) => participant.side === "attack");
  const defenseParticipants = participants.filter((participant) => participant.side === "defense");
  const contacts: HexCombatContact[] = [];

  for (const attackParticipant of attackParticipants) {
    for (const defenseParticipant of defenseParticipants) {
      const pairContact = buildPairContact({
        asset: input.asset,
        memory: input.memory,
        attackParticipant,
        defenseParticipant
      });
      if (pairContact) {
        contacts.push(pairContact);
      }
    }
  }

  return contacts.sort((left, right) => left.contactId.localeCompare(right.contactId));
}

function buildParticipant(
  agent: HexAgentPhaseMemory,
  action: HexValidatedAgentAction | undefined,
  cellsById: Map<string, HexCell>
): HexCombatParticipant | undefined {
  const currentCell = cellsById.get(agent.currentCellId);
  const targetCell = action ? cellsById.get(action.targetCellId) : currentCell;
  if (!currentCell || !targetCell || !action) {
    return undefined;
  }

  const participant: HexCombatParticipant = {
    agentId: agent.agentId,
    teamId: agent.teamId,
    side: agent.side,
    currentCellId: currentCell.cellId,
    targetCellId: targetCell.cellId,
    currentPointIds: [...currentCell.pointIds],
    targetPointIds: [...targetCell.pointIds],
    currentFlags: [...currentCell.flags],
    targetFlags: [...targetCell.flags],
    lifeStatus: agent.lifeStatus === "wounded" ? "wounded" : "alive",
    action
  };
  if (currentCell.regionId) {
    participant.currentRegionId = currentCell.regionId;
  }
  if (targetCell.regionId) {
    participant.targetRegionId = targetCell.regionId;
  }
  return participant;
}

function buildPairContact(input: {
  asset: HexMapAsset;
  memory: HexRoundMemory;
  attackParticipant: HexCombatParticipant;
  defenseParticipant: HexCombatParticipant;
}): HexCombatContact | undefined {
  const triggerReasons: HexCombatTriggerReason[] = [];
  const regionIds = intersectStrings(collectRegions(input.attackParticipant), collectRegions(input.defenseParticipant));
  const pointIds = intersectStrings(collectPoints(input.attackParticipant), collectPoints(input.defenseParticipant));
  const distance = calculatePairDistance(input.asset, input.attackParticipant.targetCellId, input.defenseParticipant.targetCellId);
  const knownEnemyContact = hasKnownEnemyContact(input.memory, input.attackParticipant.agentId, input.defenseParticipant.agentId)
    || hasKnownEnemyContact(input.memory, input.defenseParticipant.agentId, input.attackParticipant.agentId);

  if (regionIds.length > 0) {
    triggerReasons.push("same_region");
  }
  if (pointIds.length > 0) {
    triggerReasons.push("shared_point");
  }
  if (distance !== undefined && distance <= closeCellDistance) {
    triggerReasons.push("nearby_cells");
  }
  if (knownEnemyContact) {
    triggerReasons.push("known_enemy");
  }
  if (hasSiteContest(input.attackParticipant, input.defenseParticipant)) {
    triggerReasons.push("site_contest");
  }
  if (hasChokeContest(input.attackParticipant, input.defenseParticipant)) {
    triggerReasons.push("choke_contest");
  }
  if (hasDroppedBombContest(input.memory, input.attackParticipant, input.defenseParticipant)) {
    triggerReasons.push("dropped_bomb_contest");
  }
  if (hasPlantPressure(input.attackParticipant, input.defenseParticipant)) {
    triggerReasons.push("plant_pressure");
  }

  const hasPrimaryTrigger = triggerReasons.length > 0;
  if (hasPrimaryTrigger && (isActiveCombatAction(input.attackParticipant.action) || isActiveCombatAction(input.defenseParticipant.action))) {
    triggerReasons.push("active_pressure");
  }
  if (!hasPrimaryTrigger) {
    return undefined;
  }

  const contact: HexCombatContact = {
    contactId: `hex_combat_${input.memory.phaseIndex}_${input.attackParticipant.agentId}_${input.defenseParticipant.agentId}`,
    phaseId: input.memory.phaseId,
    phaseIndex: input.memory.phaseIndex,
    participants: [input.attackParticipant, input.defenseParticipant],
    attackAgentIds: [input.attackParticipant.agentId],
    defenseAgentIds: [input.defenseParticipant.agentId],
    triggerReasons: uniqueStrings(triggerReasons) as HexCombatTriggerReason[],
    regionIds: uniqueStrings(regionIds.length > 0 ? regionIds : [...collectRegions(input.attackParticipant), ...collectRegions(input.defenseParticipant)]),
    pointIds: uniqueStrings(pointIds)
  };
  if (distance !== undefined) {
    contact.minCellDistance = distance;
  }
  return contact;
}

function isActiveCombatAction(action: HexValidatedAgentAction): boolean {
  return action.valid && activeCombatActionTypes.has(action.actionType);
}

function hasKnownEnemyContact(memory: HexRoundMemory, observerAgentId: string, enemyAgentId: string): boolean {
  const observer = memory.agents.find((agent) => agent.agentId === observerAgentId);
  return observer?.knownEnemies.some((enemy) => enemy.enemyAgentId === enemyAgentId) ?? false;
}

function hasSiteContest(attackParticipant: HexCombatParticipant, defenseParticipant: HexCombatParticipant): boolean {
  return hasBombsiteFlag(attackParticipant.targetFlags) && hasBombsiteFlag(defenseParticipant.targetFlags);
}

function hasChokeContest(attackParticipant: HexCombatParticipant, defenseParticipant: HexCombatParticipant): boolean {
  return attackParticipant.targetFlags.includes("choke") || defenseParticipant.targetFlags.includes("choke");
}

function hasDroppedBombContest(memory: HexRoundMemory, attackParticipant: HexCombatParticipant, defenseParticipant: HexCombatParticipant): boolean {
  const droppedCellId = memory.bombState.droppedCellId;
  if (!droppedCellId) {
    return false;
  }
  return [attackParticipant.currentCellId, attackParticipant.targetCellId, defenseParticipant.currentCellId, defenseParticipant.targetCellId].includes(droppedCellId);
}

function hasPlantPressure(attackParticipant: HexCombatParticipant, defenseParticipant: HexCombatParticipant): boolean {
  return attackParticipant.action.actionType === "plant_bomb" && hasBombsiteFlag(defenseParticipant.targetFlags);
}

function hasBombsiteFlag(flags: readonly string[]): boolean {
  return flags.includes("bombsite_a") || flags.includes("bombsite_b");
}

function calculatePairDistance(asset: HexMapAsset, attackCellId: string, defenseCellId: string): number | undefined {
  const path = findHexPath({
    asset,
    fromCellId: attackCellId,
    toCellId: defenseCellId
  });
  return path.reachable ? path.cellDistance : undefined;
}

function collectRegions(participant: HexCombatParticipant): string[] {
  return uniqueStrings([participant.currentRegionId, participant.targetRegionId].filter((regionId): regionId is string => Boolean(regionId)));
}

function collectPoints(participant: HexCombatParticipant): string[] {
  return uniqueStrings([...participant.currentPointIds, ...participant.targetPointIds]);
}

function intersectStrings(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return uniqueStrings(left.filter((item) => rightSet.has(item)));
}

function uniqueStrings<T extends string>(items: T[]): T[] {
  return [...new Set(items)];
}
