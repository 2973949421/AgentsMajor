import type { HexSide } from "../state/index.js";
import type {
  HexCombatCasualty,
  HexCombatContact,
  HexCombatParticipant,
  HexCombatSuppression,
  HexCombatVerdict
} from "./hex-combat-types.js";

export interface HexCombatAttributionScore {
  killerScore: number;
  assistScore: number;
  roleLabel: string;
  reasons: string[];
}

export function buildHexCombatCasualties(
  contact: HexCombatContact,
  advantage: "attack" | "defense" | "contested",
  verdict: HexCombatVerdict,
  attributionScores: ReadonlyMap<string, HexCombatAttributionScore> = new Map()
): HexCombatCasualty[] {
  if (advantage === "contested") {
    return [];
  }
  const losingSide: HexSide = advantage === "attack" ? "defense" : "attack";
  const winningSide: HexSide = advantage;
  const targetSelection = chooseVulnerableParticipant(contact.participants.filter((participant) => participant.side === losingSide));
  if (!targetSelection) {
    return [];
  }
  const target = targetSelection.participant;
  const attribution = buildAttribution({
    participants: contact.participants,
    winningSide,
    attributionScores
  });
  if (verdict === "kill") {
    return [buildCasualty(target, "killed", "decisive_combat_margin", attribution, targetSelection.reasons)];
  }
  if (verdict === "wound_or_forced_back" && target.lifeStatus === "wounded") {
    return [buildCasualty(target, "killed", "wounded_agent_lost_close_combat", attribution, targetSelection.reasons)];
  }
  if (verdict === "wound_or_forced_back") {
    return [buildCasualty(target, "wounded", "combat_pressure_margin", attribution, targetSelection.reasons)];
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

function chooseVulnerableParticipant(participants: HexCombatParticipant[]): { participant: HexCombatParticipant; reasons: string[] } | undefined {
  const ranked = participants
    .map((participant) => {
      const reasons: string[] = [];
      let score = 0;
      if (participant.lifeStatus === "wounded") {
        score += 30;
        reasons.push("target_wounded_before_contact");
      }
      if (["plant_bomb", "defuse_bomb"].includes(participant.action.actionType)) {
        score += 20;
        reasons.push("target_objective_actor");
      }
      if (["peek", "seek_duel", "execute_site", "retake"].includes(participant.action.actionType)) {
        score += 12;
        reasons.push("target_active_pressure");
      }
      if (participant.targetFlags.includes("high_risk")) {
        score += 8;
        reasons.push("target_high_risk_cell");
      }
      if (participant.targetFlags.includes("bombsite_a") || participant.targetFlags.includes("bombsite_b")) {
        score += 6;
        reasons.push("target_bombsite_exposure");
      }
      if (participant.supportParticipant) {
        score -= 6;
        reasons.push("support_participant_lower_target_priority");
      }
      return { participant, score, reasons };
    })
    .sort((left, right) => right.score - left.score || left.participant.agentId.localeCompare(right.participant.agentId));
  return ranked[0];
}

function buildCasualty(
  participant: HexCombatParticipant,
  result: "killed" | "wounded",
  reason: string,
  attribution: { killerAgentId?: string; assisterAgentIds: string[]; attributionReasons: string[] },
  targetSelectionReasons: string[]
): HexCombatCasualty {
  return {
    agentId: participant.agentId,
    targetAgentId: participant.agentId,
    teamId: participant.teamId,
    side: participant.side,
    result,
    reason,
    ...(attribution.killerAgentId ? { killerAgentId: attribution.killerAgentId } : {}),
    assisterAgentIds: attribution.assisterAgentIds,
    attributionReasons: attribution.attributionReasons,
    targetSelectionReasons
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
  attributionScores: ReadonlyMap<string, HexCombatAttributionScore>;
}): { killerAgentId?: string; assisterAgentIds: string[]; attributionReasons: string[] } {
  const contributors = input.participants
    .filter((participant) => participant.side === input.winningSide)
    .filter((participant) => participant.action.valid && !participant.action.fallbackReason)
    .map((participant) => ({
      agentId: participant.agentId,
      killerScore: input.attributionScores.get(participant.agentId)?.killerScore ?? fallbackContributionScore(participant),
      assistScore: input.attributionScores.get(participant.agentId)?.assistScore ?? fallbackContributionScore(participant),
      reasons: input.attributionScores.get(participant.agentId)?.reasons ?? ["fallback_attribution_score"]
    }))
    .sort((left, right) => right.killerScore - left.killerScore || left.agentId.localeCompare(right.agentId));
  const killer = contributors[0];
  const assisters = contributors
    .filter((candidate) => candidate.agentId !== killer?.agentId)
    .sort((left, right) => right.assistScore - left.assistScore || left.agentId.localeCompare(right.agentId))
    .slice(0, 2)
    .filter((candidate) => candidate.assistScore > 0);
  return {
    ...(killer ? { killerAgentId: killer.agentId } : {}),
    assisterAgentIds: assisters.map((candidate) => candidate.agentId),
    attributionReasons: [
      ...(killer ? killer.reasons.map((reason) => `killer:${killer.agentId}:${reason}`) : []),
      ...assisters.flatMap((candidate) => candidate.reasons.map((reason) => `assist:${candidate.agentId}:${reason}`))
    ]
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
