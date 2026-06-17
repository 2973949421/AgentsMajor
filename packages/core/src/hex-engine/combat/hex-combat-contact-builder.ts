import type { HexCell, HexMapAsset } from "@agent-major/shared";
import type { HexValidatedAgentAction } from "../action/index.js";
import type { HexRoundBusinessDuel } from "../business/index.js";
import { findHexPath } from "../path/index.js";
import type { HexAgentPhaseMemory, HexRoundMemory } from "../state/index.js";
import type {
  HexCombatContact,
  HexCombatContactThreatLevel,
  HexCombatParticipant,
  HexCombatTriggerReason
} from "./hex-combat-types.js";

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
const maxContactsPerPhase = 12;
const maxContactsPerAgent = 3;
const maxSupportParticipantsPerSide = 2;

export interface BuildHexCombatContactsInput {
  asset: HexMapAsset;
  memory: HexRoundMemory;
  actions: HexValidatedAgentAction[];
  businessDuel?: HexRoundBusinessDuel;
}

export function buildHexCombatContacts(input: BuildHexCombatContactsInput): HexCombatContact[] {
  const cellsById = new Map(input.asset.cells.map((cell) => [cell.cellId, cell]));
  const actionsByAgentId = new Map(input.actions.map((action) => [action.agentId, action]));
  const distanceBetween = createDistanceCalculator(input.asset);
  const participants = input.memory.agents
    .filter((agent) => agent.lifeStatus !== "dead")
    .map((agent) => buildParticipant(agent, actionsByAgentId.get(agent.agentId), cellsById, input.businessDuel))
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
        defenseParticipant,
        distanceBetween
      });
      if (pairContact) {
        contacts.push(enrichContactWithSupport({
          contact: pairContact,
          participants,
          distanceBetween
        }));
      }
    }
  }

  return selectKeyContacts(contacts);
}

function buildParticipant(
  agent: HexAgentPhaseMemory,
  action: HexValidatedAgentAction | undefined,
  cellsById: Map<string, HexCell>,
  businessDuel: HexRoundBusinessDuel | undefined
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
    action,
    roleLabel: normalizeRoleLabel(businessDuel?.agentAssignments.find((assignment) => assignment.agentId === agent.agentId)?.role)
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
  distanceBetween: DistanceCalculator;
}): HexCombatContact | undefined {
  const triggerReasons: HexCombatTriggerReason[] = [];
  const regionIds = intersectStrings(collectRegions(input.attackParticipant), collectRegions(input.defenseParticipant));
  const pointIds = intersectStrings(collectPoints(input.attackParticipant), collectPoints(input.defenseParticipant));
  const distance = input.distanceBetween(input.attackParticipant.targetCellId, input.defenseParticipant.targetCellId);
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

  const retention = buildRetentionAudit({
    triggerReasons: uniqueStrings(triggerReasons) as HexCombatTriggerReason[],
    attackParticipant: input.attackParticipant,
    defenseParticipant: input.defenseParticipant,
    ...(distance !== undefined ? { distance } : {})
  });
  const threat = buildContactThreatAudit({
    triggerReasons: retention.triggerReasons,
    attackParticipant: input.attackParticipant,
    defenseParticipant: input.defenseParticipant,
    pointIds,
    ...(distance !== undefined ? { distance } : {})
  });
  const contact: HexCombatContact = {
    contactId: `hex_combat_${input.memory.phaseIndex}_${input.attackParticipant.agentId}_${input.defenseParticipant.agentId}`,
    phaseId: input.memory.phaseId,
    phaseIndex: input.memory.phaseIndex,
    participants: [input.attackParticipant, input.defenseParticipant],
    attackAgentIds: [input.attackParticipant.agentId],
    defenseAgentIds: [input.defenseParticipant.agentId],
    triggerReasons: retention.triggerReasons,
    regionIds: uniqueStrings(regionIds.length > 0 ? regionIds : [...collectRegions(input.attackParticipant), ...collectRegions(input.defenseParticipant)]),
    pointIds: uniqueStrings(pointIds),
    contactThreatLevel: threat.contactThreatLevel,
    lethalEligible: threat.lethalEligible,
    lethalGateReasons: threat.lethalGateReasons,
    lethalGateBlockedReasons: threat.lethalGateBlockedReasons,
    relevanceScore: retention.relevanceScore,
    retentionReasons: retention.retentionReasons
  };
  if (distance !== undefined) {
    contact.minCellDistance = distance;
  }
  return contact;
}

function buildContactThreatAudit(input: {
  triggerReasons: HexCombatTriggerReason[];
  attackParticipant: HexCombatParticipant;
  defenseParticipant: HexCombatParticipant;
  pointIds: string[];
  distance?: number;
}): {
  contactThreatLevel: HexCombatContactThreatLevel;
  lethalEligible: boolean;
  lethalGateReasons: string[];
  lethalGateBlockedReasons: string[];
} {
  const reasons: string[] = [];
  const blockedReasons: string[] = [];
  const directActive = isActiveCombatAction(input.attackParticipant.action) || isActiveCombatAction(input.defenseParticipant.action);
  const closeDistance = input.distance !== undefined && input.distance <= closeCellDistance;
  const sharedPoint = input.pointIds.length > 0;
  const objectiveActor = ["plant_bomb", "defuse_bomb"].includes(input.attackParticipant.action.actionType)
    || ["plant_bomb", "defuse_bomb"].includes(input.defenseParticipant.action.actionType);
  const closeSharedPoint = sharedPoint && input.distance !== undefined && input.distance <= closeCellDistance;
  const closeObjectivePressure = objectiveActor && closeDistance;

  if (directActive && closeDistance) {
    reasons.push("close_active_duel");
  }
  if (directActive && closeSharedPoint) {
    reasons.push("shared_point_active_duel");
  }
  if (directActive && closeObjectivePressure) {
    reasons.push("objective_actor_close_pressure");
  }

  const lethalEligible = reasons.length > 0;
  if (!directActive) {
    blockedReasons.push("no_active_combat_action");
  }
  if (input.distance === undefined) {
    blockedReasons.push("unknown_cell_distance");
  } else if (input.distance > closeCellDistance && !closeSharedPoint) {
    blockedReasons.push("distance_exceeds_lethal_gate");
  }
  if (input.triggerReasons.some((reason) => ["site_contest", "choke_contest", "known_enemy", "same_region"].includes(reason))
    && !closeDistance
    && !closeSharedPoint) {
    blockedReasons.push("abstract_contact_only");
  }
  if (!sharedPoint && !closeDistance && !closeObjectivePressure) {
    blockedReasons.push("no_close_or_shared_fight");
  }

  if (lethalEligible) {
    return {
      contactThreatLevel: "lethal",
      lethalEligible,
      lethalGateReasons: uniqueStrings(reasons),
      lethalGateBlockedReasons: uniqueStrings(blockedReasons)
    };
  }

  const suppressionThreat = closeDistance
    || sharedPoint
    || input.triggerReasons.some((reason) => ["plant_pressure", "dropped_bomb_contest"].includes(reason))
    || (directActive && input.triggerReasons.some((reason) => ["site_contest", "choke_contest", "known_enemy", "same_region"].includes(reason)));
  return {
    contactThreatLevel: suppressionThreat ? "suppression" : "observation",
    lethalEligible,
    lethalGateReasons: [],
    lethalGateBlockedReasons: uniqueStrings(blockedReasons)
  };
}

function enrichContactWithSupport(input: {
  contact: HexCombatContact;
  participants: HexCombatParticipant[];
  distanceBetween: DistanceCalculator;
}): HexCombatContact {
  const baseAgentIds = new Set(input.contact.participants.map((participant) => participant.agentId));
  const supportParticipants = input.participants
    .filter((participant) => !baseAgentIds.has(participant.agentId))
    .filter((participant) => isSupportParticipantForContact(participant, input.contact, input.distanceBetween))
    .sort((left, right) => supportScore(right, input.contact, input.distanceBetween) - supportScore(left, input.contact, input.distanceBetween) || left.agentId.localeCompare(right.agentId));
  const attackSupport = supportParticipants
    .filter((participant) => participant.side === "attack")
    .slice(0, maxSupportParticipantsPerSide)
    .map(markSupportParticipant);
  const defenseSupport = supportParticipants
    .filter((participant) => participant.side === "defense")
    .slice(0, maxSupportParticipantsPerSide)
    .map(markSupportParticipant);
  const participants = [...input.contact.participants, ...attackSupport, ...defenseSupport];
  const triggerReasons = uniqueStrings([
    ...input.contact.triggerReasons,
    ...(attackSupport.length > 0 || defenseSupport.length > 0 ? ["support_contact" as const, "trade_setup" as const] : [])
  ]);
  const retentionReasons = uniqueStrings([
    ...(input.contact.retentionReasons ?? []),
    ...(attackSupport.length > 0 ? ["attack_support_participant"] : []),
    ...(defenseSupport.length > 0 ? ["defense_support_participant"] : [])
  ]);
  return {
    ...input.contact,
    participants,
    triggerReasons,
    attackAgentIds: participants.filter((participant) => participant.side === "attack").map((participant) => participant.agentId),
    defenseAgentIds: participants.filter((participant) => participant.side === "defense").map((participant) => participant.agentId),
    retentionReasons,
    relevanceScore: (input.contact.relevanceScore ?? 0) + attackSupport.length * 4 + defenseSupport.length * 4
  };
}

function markSupportParticipant(participant: HexCombatParticipant): HexCombatParticipant {
  return {
    ...participant,
    currentPointIds: [...participant.currentPointIds],
    targetPointIds: [...participant.targetPointIds],
    currentFlags: [...participant.currentFlags],
    targetFlags: [...participant.targetFlags],
    supportParticipant: true
  };
}

function selectKeyContacts(contacts: HexCombatContact[]): HexCombatContact[] {
  const sorted = [...contacts].sort((left, right) => {
    const objectiveDelta = Number(isObjectiveContact(right)) - Number(isObjectiveContact(left));
    if (objectiveDelta !== 0) {
      return objectiveDelta;
    }
    return (right.relevanceScore ?? 0) - (left.relevanceScore ?? 0) || left.contactId.localeCompare(right.contactId);
  });
  const selected: HexCombatContact[] = [];
  const contactsPerAgent = new Map<string, number>();
  for (const contact of sorted) {
    const objective = isObjectiveContact(contact);
    const agentIds = contact.participants.map((participant) => participant.agentId);
    const underPerAgentCap = agentIds.every((agentId) => (contactsPerAgent.get(agentId) ?? 0) < maxContactsPerAgent);
    if ((selected.length < maxContactsPerPhase && underPerAgentCap) || objective) {
      selected.push(contact);
      for (const agentId of agentIds) {
        contactsPerAgent.set(agentId, (contactsPerAgent.get(agentId) ?? 0) + 1);
      }
    }
  }
  const prunedCandidateCount = contacts.length - selected.length;
  return selected
    .map((contact) => ({
      ...contact,
      ...(prunedCandidateCount > 0 ? { prunedCandidateCount } : {})
    }))
    .sort((left, right) => left.contactId.localeCompare(right.contactId));
}

function buildRetentionAudit(input: {
  triggerReasons: HexCombatTriggerReason[];
  attackParticipant: HexCombatParticipant;
  defenseParticipant: HexCombatParticipant;
  distance?: number;
}): { triggerReasons: HexCombatTriggerReason[]; relevanceScore: number; retentionReasons: string[] } {
  let relevanceScore = 0;
  const retentionReasons: string[] = [];
  if (input.triggerReasons.includes("plant_pressure")) {
    relevanceScore += 35;
    retentionReasons.push("plant_pressure_objective");
  }
  if (input.triggerReasons.includes("dropped_bomb_contest")) {
    relevanceScore += 30;
    retentionReasons.push("dropped_c4_contest");
  }
  if (input.triggerReasons.includes("site_contest")) {
    relevanceScore += 25;
    retentionReasons.push("bombsite_contest");
  }
  if (input.triggerReasons.includes("shared_point")) {
    relevanceScore += 16;
    retentionReasons.push("shared_point_contact");
  }
  if (input.triggerReasons.includes("same_region")) {
    relevanceScore += 10;
    retentionReasons.push("same_region_contact");
  }
  if (input.distance !== undefined && input.distance <= closeCellDistance) {
    relevanceScore += Math.max(2, closeCellDistance + 2 - input.distance);
    retentionReasons.push("close_cell_distance");
  }
  if (isEntryDuel(input.attackParticipant, input.defenseParticipant)) {
    relevanceScore += 12;
    retentionReasons.push("entry_duel");
  }
  if (isRolePressure(input.attackParticipant) || isRolePressure(input.defenseParticipant)) {
    relevanceScore += 8;
    retentionReasons.push("role_pressure");
  }
  if (input.triggerReasons.includes("active_pressure")) {
    relevanceScore += 6;
    retentionReasons.push("active_pressure");
  }
  return {
    triggerReasons: input.triggerReasons,
    relevanceScore,
    retentionReasons: uniqueStrings(retentionReasons)
  };
}

function isActiveCombatAction(action: HexValidatedAgentAction): boolean {
  return action.valid && activeCombatActionTypes.has(action.actionType);
}

function isSupportParticipantForContact(participant: HexCombatParticipant, contact: HexCombatContact, distanceBetween: DistanceCalculator): boolean {
  if (!participant.action.valid || participant.action.fallbackReason) {
    return false;
  }
  if (!isSupportAction(participant.action) && !isRoleSupport(participant)) {
    return false;
  }
  if (intersectStrings(collectPoints(participant), contact.pointIds).length > 0) {
    return true;
  }
  if (intersectStrings(collectRegions(participant), contact.regionIds).length > 0) {
    return true;
  }
  return contact.participants.some((candidate) => {
    if (candidate.side !== participant.side) {
      return false;
    }
    return participant.targetCellId === candidate.targetCellId
      || distanceBetween(participant.targetCellId, candidate.targetCellId) !== undefined
        && distanceBetween(participant.targetCellId, candidate.targetCellId)! <= closeCellDistance;
  });
}

function supportScore(participant: HexCombatParticipant, contact: HexCombatContact, distanceBetween: DistanceCalculator): number {
  let score = 0;
  if (isRoleSupport(participant)) {
    score += 10;
  }
  if (["prepare_trade", "use_utility", "map_control", "watch_angle"].includes(participant.action.actionType)) {
    score += 8;
  }
  if (intersectStrings(collectPoints(participant), contact.pointIds).length > 0) {
    score += 6;
  }
  if (intersectStrings(collectRegions(participant), contact.regionIds).length > 0) {
    score += 4;
  }
  const nearestDistance = Math.min(
    ...contact.participants
      .filter((candidate) => candidate.side === participant.side)
      .map((candidate) => distanceBetween(participant.targetCellId, candidate.targetCellId))
      .filter((distance): distance is number => distance !== undefined)
  );
  if (Number.isFinite(nearestDistance)) {
    score += Math.max(0, closeCellDistance + 1 - nearestDistance);
  }
  return score;
}

function isSupportAction(action: HexValidatedAgentAction): boolean {
  return action.valid && ["prepare_trade", "use_utility", "map_control", "watch_angle", "hold_position"].includes(action.actionType);
}

function isObjectiveContact(contact: HexCombatContact): boolean {
  return contact.triggerReasons.some((reason) => ["plant_pressure", "dropped_bomb_contest", "site_contest"].includes(reason));
}

function isEntryDuel(attackParticipant: HexCombatParticipant, defenseParticipant: HexCombatParticipant): boolean {
  return normalizeRoleLabel(attackParticipant.roleLabel) === "entry"
    && ["peek", "seek_duel", "execute_site"].includes(attackParticipant.action.actionType)
    && isActiveCombatAction(defenseParticipant.action);
}

function isRolePressure(participant: HexCombatParticipant): boolean {
  const role = normalizeRoleLabel(participant.roleLabel);
  return ["awper", "star_rifler", "entry"].includes(role) && isActiveCombatAction(participant.action);
}

function isRoleSupport(participant: HexCombatParticipant): boolean {
  const role = normalizeRoleLabel(participant.roleLabel);
  return role === "igl" || role === "support";
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

type DistanceCalculator = (fromCellId: string, toCellId: string) => number | undefined;

function createDistanceCalculator(asset: HexMapAsset): DistanceCalculator {
  const cache = new Map<string, number | undefined>();
  return (fromCellId, toCellId) => {
    const key = fromCellId <= toCellId ? `${fromCellId}:${toCellId}` : `${toCellId}:${fromCellId}`;
    if (!cache.has(key)) {
      cache.set(key, calculatePairDistance(asset, fromCellId, toCellId));
    }
    return cache.get(key);
  };
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

function normalizeRoleLabel(role: string | undefined): string {
  return (role ?? "unknown").toLowerCase().replace(/[\s-]+/g, "_");
}
