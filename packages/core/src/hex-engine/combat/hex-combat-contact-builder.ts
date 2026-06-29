import type { HexCell, HexMapAsset } from "@agent-major/shared";
import type { HexValidatedAgentAction } from "../action/index.js";
import type { HexRoundBusinessDuel } from "../business/index.js";
import { findHexPath } from "../path/index.js";
import type { HexAgentPhaseMemory, HexRoundMemory } from "../state/index.js";
import type {
  HexCombatContact,
  HexCombatContactThreatLevel,
  HexCombatDuelPair,
  HexCombatFireLane,
  HexCombatLethalGateStatus,
  HexCombatParticipant,
  HexCombatPressureScope,
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
const openLineOfFireDistance = 6;
const maxContactsPerPhase = 12;
const maxContactsPerAgent = 3;
const maxSupportParticipantsPerSide = 2;
const movementDuelActionTypes = new Set(["move", "rotate"]);

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
    duelPairs: [],
    fireLanes: [],
    pressureKeys: [],
    contactThreatLevel: threat.contactThreatLevel,
    lethalEligible: threat.lethalEligible,
    lethalGateReasons: threat.lethalGateReasons,
    lethalGateBlockedReasons: threat.lethalGateBlockedReasons,
    lineOfFireExposure: threat.lineOfFireExposure,
    openSightNoCover: threat.openSightNoCover,
    samePointExposure: threat.samePointExposure,
    objectiveExposure: threat.objectiveExposure,
    implicitDuelFromMovement: threat.implicitDuelFromMovement,
    coverBlockedLethal: threat.coverBlockedLethal,
    relevanceScore: retention.relevanceScore,
    retentionReasons: retention.retentionReasons
  };
  if (distance !== undefined) {
    contact.minCellDistance = distance;
  }
  const fireLane = buildFireLane({ contact, attackParticipant: input.attackParticipant, defenseParticipant: input.defenseParticipant });
  const duelPair = buildDuelPair({ contact, fireLane, attackParticipant: input.attackParticipant, defenseParticipant: input.defenseParticipant });
  const pressureScope = buildPressureScope({ contact, fireLane, duelPair });
  contact.fireLanes = [fireLane];
  contact.duelPairs = [duelPair];
  contact.pressureScope = pressureScope;
  contact.primaryPressureKey = pressureScope.pressureKey;
  contact.pressureKeys = uniqueStrings([pressureScope.pressureKey, duelPair.pressureKey]);
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
  lineOfFireExposure: boolean;
  openSightNoCover: boolean;
  samePointExposure: boolean;
  objectiveExposure: boolean;
  implicitDuelFromMovement: boolean;
  coverBlockedLethal: boolean;
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
  const withinOpenLine = input.distance !== undefined && input.distance <= openLineOfFireDistance;
  const hasAnyCover = participantHasCover(input.attackParticipant) || participantHasCover(input.defenseParticipant);
  const sameCellOrNeighbor = input.distance !== undefined && input.distance <= 1;
  const sameRegion = input.triggerReasons.includes("same_region");
  const objectiveContact = objectiveActor
    || input.triggerReasons.some((reason) => ["site_contest", "plant_pressure", "dropped_bomb_contest"].includes(reason))
    || participantHasObjectiveFlag(input.attackParticipant)
    || participantHasObjectiveFlag(input.defenseParticipant);
  const chokeContact = input.triggerReasons.includes("choke_contest");
  const samePointExposure = sharedPoint && withinOpenLine && (!hasAnyCover || closeDistance);
  const objectiveExposure = objectiveContact && withinOpenLine && (!hasAnyCover || closeDistance || objectiveActor);
  const openSightNoCover = withinOpenLine
    && !hasAnyCover
    && (sameRegion || sharedPoint || objectiveContact || chokeContact || closeDistance);
  const lineOfFireExposure = sameCellOrNeighbor || samePointExposure || objectiveExposure || openSightNoCover;
  const implicitDuelFromMovement = lineOfFireExposure
    && (isMovementDuelAction(input.attackParticipant.action) || isMovementDuelAction(input.defenseParticipant.action));
  const coverBlockedLethal = Boolean(
    hasAnyCover
    && input.distance !== undefined
    && input.distance > closeCellDistance
    && !sameCellOrNeighbor
    && !closeObjectivePressure
    && !objectiveActor
    && !(sharedPoint && closeDistance)
  );

  if (directActive && closeDistance) {
    reasons.push("close_active_duel");
  }
  if (directActive && closeSharedPoint) {
    reasons.push("shared_point_active_duel");
  }
  if (directActive && closeObjectivePressure) {
    reasons.push("objective_actor_close_pressure");
  }
  if (lineOfFireExposure) {
    reasons.push("line_of_fire_exposure");
  }
  if (openSightNoCover) {
    reasons.push("open_sight_no_cover");
  }
  if (samePointExposure) {
    reasons.push("same_point_exposure");
  }
  if (objectiveExposure) {
    reasons.push("objective_exposure");
  }
  if (implicitDuelFromMovement) {
    reasons.push("implicit_duel_from_movement");
  }

  const lethalEligible = reasons.length > 0 && !coverBlockedLethal;
  if (!directActive && !implicitDuelFromMovement) {
    blockedReasons.push("no_active_combat_action");
  }
  if (input.distance === undefined) {
    blockedReasons.push("unknown_cell_distance");
  } else if (input.distance > closeCellDistance && !samePointExposure && !objectiveExposure && !openSightNoCover) {
    blockedReasons.push("distance_exceeds_lethal_gate");
  }
  if (coverBlockedLethal) {
    blockedReasons.push("cover_blocks_lethal");
  }
  if (input.triggerReasons.some((reason) => ["site_contest", "choke_contest", "known_enemy", "same_region"].includes(reason))
    && !closeDistance
    && !lineOfFireExposure) {
    blockedReasons.push("abstract_contact_only");
  }
  if (!sharedPoint && !closeDistance && !closeObjectivePressure && !lineOfFireExposure) {
    blockedReasons.push("no_close_or_shared_fight");
  }

  if (lethalEligible) {
    return {
      contactThreatLevel: "lethal",
      lethalEligible,
      lethalGateReasons: uniqueStrings(reasons),
      lethalGateBlockedReasons: uniqueStrings(blockedReasons),
      lineOfFireExposure,
      openSightNoCover,
      samePointExposure,
      objectiveExposure,
      implicitDuelFromMovement,
      coverBlockedLethal
    };
  }

  const suppressionThreat = closeDistance
    || sharedPoint
    || lineOfFireExposure
    || input.triggerReasons.some((reason) => ["plant_pressure", "dropped_bomb_contest"].includes(reason))
    || (directActive && input.triggerReasons.some((reason) => ["site_contest", "choke_contest", "known_enemy", "same_region"].includes(reason)));
  return {
    contactThreatLevel: suppressionThreat ? "suppression" : "observation",
    lethalEligible,
    lethalGateReasons: [],
    lethalGateBlockedReasons: uniqueStrings(blockedReasons),
    lineOfFireExposure,
    openSightNoCover,
    samePointExposure,
    objectiveExposure,
    implicitDuelFromMovement,
    coverBlockedLethal
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
  const contributorAgentIds = uniqueStrings([...attackSupport, ...defenseSupport].map((participant) => participant.agentId));
  const duelPairs = input.contact.duelPairs.map((pair) => ({
    ...pair,
    contributorAgentIds: uniqueStrings([...pair.contributorAgentIds, ...contributorAgentIds]),
    reasons: uniqueStrings([...pair.reasons, ...(contributorAgentIds.length > 0 ? ["support_contributors"] : [])])
  }));
  return {
    ...input.contact,
    participants,
    triggerReasons,
    attackAgentIds: participants.filter((participant) => participant.side === "attack").map((participant) => participant.agentId),
    defenseAgentIds: participants.filter((participant) => participant.side === "defense").map((participant) => participant.agentId),
    duelPairs,
    pressureKeys: uniqueStrings([...input.contact.pressureKeys, ...duelPairs.map((pair) => pair.pressureKey)]),
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

function buildFireLane(input: {
  contact: HexCombatContact;
  attackParticipant: HexCombatParticipant;
  defenseParticipant: HexCombatParticipant;
}): HexCombatFireLane {
  const exposureFlags = uniqueStrings([
    input.contact.lineOfFireExposure ? "line_of_fire_exposure" : undefined,
    input.contact.openSightNoCover ? "open_sight_no_cover" : undefined,
    input.contact.samePointExposure ? "same_point_exposure" : undefined,
    input.contact.objectiveExposure ? "objective_exposure" : undefined,
    input.contact.implicitDuelFromMovement ? "implicit_duel_from_movement" : undefined,
    input.contact.coverBlockedLethal ? "cover_blocks_lethal" : undefined
  ].filter((flag): flag is string => Boolean(flag)));
  const cellContactId = input.contact.minCellDistance !== undefined
    ? `cell_contact:${input.attackParticipant.targetCellId}:${input.defenseParticipant.targetCellId}`
    : undefined;
  const laneScope = buildStableLaneScope(input.contact, cellContactId);
  const objectiveExposureId = input.contact.objectiveExposure ? `objective_exposure:${laneScope}` : undefined;
  return {
    laneId: buildStableId("fire_lane", laneScope),
    contactId: input.contact.contactId,
    attackAgentId: input.attackParticipant.agentId,
    defenseAgentId: input.defenseParticipant.agentId,
    regionIds: [...input.contact.regionIds],
    pointIds: [...input.contact.pointIds],
    ...(cellContactId ? { cellContactId } : {}),
    ...(objectiveExposureId ? { objectiveExposureId } : {}),
    exposureFlags
  };
}

function buildDuelPair(input: {
  contact: HexCombatContact;
  fireLane: HexCombatFireLane;
  attackParticipant: HexCombatParticipant;
  defenseParticipant: HexCombatParticipant;
}): HexCombatDuelPair {
  const primary = choosePrimaryDuelist(input.attackParticipant, input.defenseParticipant);
  const target = primary.agentId === input.attackParticipant.agentId ? input.defenseParticipant : input.attackParticipant;
  const directness = scoreDuelDirectness(input.contact);
  const pairScope = buildStablePairScope(input.attackParticipant, input.defenseParticipant);
  const duelPairId = buildStableId("duel_pair", pairScope, input.fireLane.laneId.replace(/^fire_lane_/, ""));
  return {
    duelPairId,
    primaryAgentId: primary.agentId,
    targetAgentId: target.agentId,
    side: primary.side,
    laneId: input.fireLane.laneId,
    pressureKey: `duelPair:${duelPairId}`,
    directnessScore: directness.score,
    lethalGateStatus: getLethalGateStatus(input.contact),
    reasons: directness.reasons,
    contributorAgentIds: []
  };
}

function buildPressureScope(input: {
  contact: HexCombatContact;
  fireLane: HexCombatFireLane;
  duelPair: HexCombatDuelPair;
}): HexCombatPressureScope {
  const laneScope = input.fireLane.laneId.replace(/^fire_lane_/, "");
  const base = {
    laneScope,
    attributionDuelPairKey: input.duelPair.pressureKey
  };
  if (input.fireLane.objectiveExposureId) {
    return {
      ...base,
      pressureKey: input.fireLane.objectiveExposureId,
      scopeKind: "objective_exposure",
      objectiveScope: input.fireLane.objectiveExposureId.replace(/^objective_exposure:/, ""),
      reasons: uniqueStrings(["n64b_pressure_scope_objective_exposure", ...input.fireLane.exposureFlags])
    };
  }
  if (input.fireLane.cellContactId) {
    return {
      ...base,
      pressureKey: input.fireLane.cellContactId,
      scopeKind: "cell_contact",
      cellScope: input.fireLane.cellContactId.replace(/^cell_contact:/, ""),
      reasons: uniqueStrings(["n64b_pressure_scope_cell_contact", ...input.fireLane.exposureFlags])
    };
  }
  if (input.fireLane.pointIds.length > 0) {
    return {
      ...base,
      pressureKey: `fireLane:${input.fireLane.laneId}`,
      scopeKind: "fire_lane",
      reasons: uniqueStrings(["n64b_pressure_scope_fire_lane", ...input.fireLane.exposureFlags])
    };
  }
  return {
    ...base,
    pressureKey: input.duelPair.pressureKey,
    scopeKind: "duel_pair",
    reasons: uniqueStrings(["n64b_pressure_scope_duel_pair_fallback", ...input.duelPair.reasons])
  };
}
function buildStablePairScope(attackParticipant: HexCombatParticipant, defenseParticipant: HexCombatParticipant): string {
  return buildStableId("pair", attackParticipant.agentId, defenseParticipant.agentId);
}

function buildStableLaneScope(contact: HexCombatContact, cellContactId: string | undefined): string {
  const pointScope = stableListScope("points", contact.pointIds);
  if (contact.objectiveExposure && pointScope) return `objective_${pointScope}`;
  if (contact.objectiveExposure && cellContactId) return `objective_${cellContactId}`;
  if (pointScope) return pointScope;
  if (cellContactId) return cellContactId;
  const regionScope = stableListScope("regions", contact.regionIds);
  if (contact.objectiveExposure && regionScope) return `objective_${regionScope}`;
  if (regionScope) return regionScope;
  return "direct_contact";
}

function stableListScope(prefix: string, values: readonly string[]): string | undefined {
  const stableValues = uniqueStrings([...values].sort());
  return stableValues.length > 0 ? `${prefix}_${stableValues.join("_")}` : undefined;
}

function buildStableId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${parts.map(sanitizeStableIdPart).join("_")}`;
}

function sanitizeStableIdPart(part: string): string {
  return part.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

function choosePrimaryDuelist(attackParticipant: HexCombatParticipant, defenseParticipant: HexCombatParticipant): HexCombatParticipant {
  const attackScore = scorePrimaryDuelist(attackParticipant);
  const defenseScore = scorePrimaryDuelist(defenseParticipant);
  if (defenseScore > attackScore) {
    return defenseParticipant;
  }
  return attackParticipant;
}

function scorePrimaryDuelist(participant: HexCombatParticipant): number {
  let score = 0;
  if (isActiveCombatAction(participant.action)) score += 20;
  if (["peek", "seek_duel", "execute_site", "retake", "watch_angle"].includes(participant.action.actionType)) score += 15;
  if (participant.roleLabel === "awper") score += 12;
  if (participant.roleLabel === "star_rifler") score += 11;
  if (participant.roleLabel === "entry") score += 10;
  if (participant.roleLabel === "rifler") score += 6;
  if (participant.roleLabel === "igl") score -= 12;
  if (participant.roleLabel === "support") score -= 16;
  if (participant.supportParticipant) score -= 30;
  return score;
}

function scoreDuelDirectness(contact: HexCombatContact): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  if (contact.minCellDistance !== undefined) {
    if (contact.minCellDistance <= 1) { score += 25; reasons.push("adjacent_or_same_cell"); }
    else if (contact.minCellDistance <= closeCellDistance) { score += 18; reasons.push("close_cell_distance"); }
    else if (contact.minCellDistance <= openLineOfFireDistance) { score += 8; reasons.push("open_line_distance_band"); }
  }
  if (contact.pointIds.length > 0) { score += 20; reasons.push("shared_point_lane"); }
  if (contact.openSightNoCover) { score += 18; reasons.push("open_sight_no_cover"); }
  if (contact.samePointExposure) { score += 16; reasons.push("same_point_exposure"); }
  if (contact.objectiveExposure) { score += 16; reasons.push("objective_exposure"); }
  if (contact.triggerReasons.includes("active_pressure")) { score += 10; reasons.push("active_pressure"); }
  if (contact.lethalEligible) { score += 20; reasons.push("lethal_gate_passed"); }
  if (reasons.length === 0) { reasons.push("abstract_contact_pair"); }
  return { score: Math.min(100, Math.max(0, score)), reasons: uniqueStrings(reasons) };
}

function getLethalGateStatus(contact: HexCombatContact): HexCombatLethalGateStatus {
  if (contact.lethalEligible) return "passed";
  if (contact.contactThreatLevel === "suppression") return "suppression_only";
  return "blocked";
}

function isActiveCombatAction(action: HexValidatedAgentAction): boolean {
  return action.valid && activeCombatActionTypes.has(action.actionType);
}

function isMovementDuelAction(action: HexValidatedAgentAction): boolean {
  return action.valid && movementDuelActionTypes.has(action.actionType);
}

function participantHasCover(participant: HexCombatParticipant): boolean {
  return [...participant.currentFlags, ...participant.targetFlags].includes("cover");
}

function participantHasObjectiveFlag(participant: HexCombatParticipant): boolean {
  return hasBombsiteFlag(participant.currentFlags) || hasBombsiteFlag(participant.targetFlags);
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
