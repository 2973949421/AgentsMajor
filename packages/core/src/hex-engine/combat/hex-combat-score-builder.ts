import type { HexValidatedAgentAction } from "../action/index.js";
import type { HexEconomyCombatEvidence } from "../economy/index.js";
import type { HexSide } from "../state/index.js";
import type { HexCombatContact, HexCombatParticipant } from "./hex-combat-types.js";

const csWeight = 35;

export function scoreCsEvidence(
  side: HexSide,
  participants: HexCombatParticipant[],
  contact: HexCombatContact,
  sideActionsNearContact: HexValidatedAgentAction[],
  economyEvidence: HexEconomyCombatEvidence
): number {
  let score = 0;
  const directParticipants = participants.filter((participant) => !participant.supportParticipant);
  const directOpponentCount = contact.participants.filter((participant) => participant.side !== side && !participant.supportParticipant).length;
  score += directParticipants.length >= directOpponentCount ? 10 : 5;
  if (participants.length > directParticipants.length) {
    score += 2;
  }
  score += contact.minCellDistance === undefined ? 2 : contact.minCellDistance <= 1 ? 7 : contact.minCellDistance <= 3 ? 4 : 2;
  if (participants.some((participant) => participant.action.valid)) {
    score += 5;
  }
  score += scoreMapFlags(participants);
  score += participants.every((participant) => participant.lifeStatus === "alive") ? 5 : 2;
  if (participants.some((participant) => isPressureAction(participant.action))) {
    score += 3;
  }
  score += economyScoreAdjustment(sideActionsNearContact, economyEvidence);
  return Math.min(csWeight, Math.max(0, score));
}

export function buildCsReasons(
  side: HexSide,
  participants: HexCombatParticipant[],
  contact: HexCombatContact,
  sideActionsNearContact: HexValidatedAgentAction[],
  economyEvidence: HexEconomyCombatEvidence
): string[] {
  const reasons: string[] = [];
  const directParticipants = participants.filter((participant) => !participant.supportParticipant);
  const directOpponentCount = contact.participants.filter((participant) => participant.side !== side && !participant.supportParticipant).length;
  if (directParticipants.length >= directOpponentCount) {
    reasons.push(`${side}:numbers_or_trade_support`);
  }
  if (participants.length > directParticipants.length) {
    reasons.push(`${side}:support_assist_present`);
  }
  if (contact.minCellDistance !== undefined && contact.minCellDistance <= 3) {
    reasons.push(`${side}:close_cell_distance`);
  }
  if (participants.some((participant) => participant.action.valid)) {
    reasons.push(`${side}:validated_ap_path`);
  }
  if (scoreMapFlags(participants) > 0) {
    reasons.push(`${side}:map_flag_context`);
  }
  if (participants.some((participant) => isPressureAction(participant.action))) {
    reasons.push(`${side}:active_action_pressure`);
  }
  if (economyEvidence.reasons.length > 0) {
    reasons.push(...economyEvidence.reasons.map((reason) => `${side}:${reason}`));
  }
  if (lowResourceFullExecuteAttempt(sideActionsNearContact, economyEvidence)) {
    reasons.push(`${side}:economy:low_resource_full_execute_penalty`);
  }
  return reasons;
}

function economyScoreAdjustment(sideActionsNearContact: HexValidatedAgentAction[], economyEvidence: HexEconomyCombatEvidence): number {
  let adjustment = economyEvidence.scoreDelta;
  if (lowResourceFullExecuteAttempt(sideActionsNearContact, economyEvidence)) {
    adjustment -= 5;
  }
  return Math.max(-5, Math.min(5, adjustment));
}

function lowResourceFullExecuteAttempt(
  sideActionsNearContact: HexValidatedAgentAction[],
  economyEvidence: HexEconomyCombatEvidence
): boolean {
  return economyEvidence.resourceTiers.includes("low") && sideActionsNearContact.some((action) => action.actionType === "execute_site");
}


function scoreMapFlags(participants: HexCombatParticipant[]): number {
  let score = 0;
  const flags = new Set(participants.flatMap((participant) => [...participant.currentFlags, ...participant.targetFlags]));
  if (flags.has("choke") || flags.has("high_risk")) {
    score += 3;
  }
  if (flags.has("bombsite_a") || flags.has("bombsite_b")) {
    score += 4;
  }
  if (flags.has("cover")) {
    score += 2;
  }
  return score;
}

function isPressureAction(action: HexValidatedAgentAction): boolean {
  return ["peek", "seek_duel", "execute_site", "plant_bomb", "defuse_bomb", "retake"].includes(action.actionType);
}
