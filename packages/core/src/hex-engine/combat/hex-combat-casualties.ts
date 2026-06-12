import type { HexSide } from "../state/index.js";
import type {
  HexCombatCasualty,
  HexCombatContact,
  HexCombatParticipant,
  HexCombatSuppression,
  HexCombatVerdict
} from "./hex-combat-types.js";

export function buildHexCombatCasualties(
  contact: HexCombatContact,
  advantage: "attack" | "defense" | "contested",
  verdict: HexCombatVerdict
): HexCombatCasualty[] {
  if (advantage === "contested") {
    return [];
  }
  const losingSide: HexSide = advantage === "attack" ? "defense" : "attack";
  const target = chooseVulnerableParticipant(contact.participants.filter((participant) => participant.side === losingSide));
  if (!target) {
    return [];
  }
  if (verdict === "kill") {
    return [buildCasualty(target, "killed", "decisive_combat_margin")];
  }
  if (verdict === "wound_or_forced_back" && target.lifeStatus === "wounded") {
    return [buildCasualty(target, "killed", "wounded_agent_lost_close_combat")];
  }
  if (verdict === "wound_or_forced_back") {
    return [buildCasualty(target, "wounded", "combat_pressure_margin")];
  }
  return [];
}

export function buildHexCombatSuppressions(
  contact: HexCombatContact,
  advantage: "attack" | "defense" | "contested",
  verdict: HexCombatVerdict,
  casualties: HexCombatCasualty[]
): HexCombatSuppression[] {
  if (verdict === "kill") {
    return [];
  }
  if (advantage === "contested") {
    return contact.participants.map((participant) => buildSuppression(participant, "suppressed", "contested_combat"));
  }
  const losingSide: HexSide = advantage === "attack" ? "defense" : "attack";
  return contact.participants
    .filter((participant) => participant.side === losingSide)
    .filter((participant) => !casualties.some((casualty) => casualty.agentId === participant.agentId))
    .map((participant) => buildSuppression(participant, "forced_back", "combat_pressure_margin"));
}

function chooseVulnerableParticipant(participants: HexCombatParticipant[]): HexCombatParticipant | undefined {
  return participants.find((participant) => participant.lifeStatus === "wounded") ?? participants[0];
}

function buildCasualty(participant: HexCombatParticipant, result: "killed" | "wounded", reason: string): HexCombatCasualty {
  return {
    agentId: participant.agentId,
    teamId: participant.teamId,
    side: participant.side,
    result,
    reason
  };
}

function buildSuppression(participant: HexCombatParticipant, result: "suppressed" | "forced_back", reason: string): HexCombatSuppression {
  return {
    agentId: participant.agentId,
    teamId: participant.teamId,
    side: participant.side,
    result,
    reason
  };
}
