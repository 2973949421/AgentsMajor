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
  verdict: HexCombatVerdict,
  attributionScores: ReadonlyMap<string, number> = new Map()
): HexCombatCasualty[] {
  if (advantage === "contested") {
    return [];
  }
  const losingSide: HexSide = advantage === "attack" ? "defense" : "attack";
  const winningSide: HexSide = advantage;
  const target = chooseVulnerableParticipant(contact.participants.filter((participant) => participant.side === losingSide));
  if (!target) {
    return [];
  }
  const attribution = buildAttribution({
    participants: contact.participants,
    winningSide,
    attributionScores
  });
  if (verdict === "kill") {
    return [buildCasualty(target, "killed", "decisive_combat_margin", attribution)];
  }
  if (verdict === "wound_or_forced_back" && target.lifeStatus === "wounded") {
    return [buildCasualty(target, "killed", "wounded_agent_lost_close_combat", attribution)];
  }
  if (verdict === "wound_or_forced_back") {
    return [buildCasualty(target, "wounded", "combat_pressure_margin", attribution)];
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

function buildCasualty(
  participant: HexCombatParticipant,
  result: "killed" | "wounded",
  reason: string,
  attribution: { killerAgentId?: string; assisterAgentIds: string[] }
): HexCombatCasualty {
  return {
    agentId: participant.agentId,
    targetAgentId: participant.agentId,
    teamId: participant.teamId,
    side: participant.side,
    result,
    reason,
    ...(attribution.killerAgentId ? { killerAgentId: attribution.killerAgentId } : {}),
    assisterAgentIds: attribution.assisterAgentIds
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

function buildAttribution(input: {
  participants: HexCombatParticipant[];
  winningSide: HexSide;
  attributionScores: ReadonlyMap<string, number>;
}): { killerAgentId?: string; assisterAgentIds: string[] } {
  const contributors = input.participants
    .filter((participant) => participant.side === input.winningSide)
    .filter((participant) => participant.action.valid && !participant.action.fallbackReason)
    .map((participant) => ({
      agentId: participant.agentId,
      score: input.attributionScores.get(participant.agentId) ?? fallbackContributionScore(participant)
    }))
    .sort((left, right) => right.score - left.score || left.agentId.localeCompare(right.agentId));
  const killer = contributors[0];
  return {
    ...(killer ? { killerAgentId: killer.agentId } : {}),
    assisterAgentIds: contributors
      .slice(1, 3)
      .filter((candidate) => candidate.score > 0)
      .map((candidate) => candidate.agentId)
  };
}

function fallbackContributionScore(participant: HexCombatParticipant): number {
  let score = participant.action.valid ? 1 : 0;
  if (participant.action.actionType !== "hold_position") {
    score += 1;
  }
  if (participant.action.businessIntent.trim().length > 0) {
    score += 1;
  }
  return score;
}
