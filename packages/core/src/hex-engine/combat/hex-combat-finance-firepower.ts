import type { HexFinanceCombatEffectCap, HexSubmittedFinanceOutput } from "../finance/index.js";
import type { HexSide } from "../state/index.js";
import type {
  HexCombatContact,
  HexCombatFinanceEvidenceAdoption,
  HexCombatFinanceFirepowerScore,
  HexCombatParticipant,
  HexCombatEffectAllowed
} from "./hex-combat-types.js";

interface FinanceFirepowerCap {
  pressure: number;
  lethal: number;
  label: string;
}

export function buildFinanceFirepowerScore(input: {
  side: HexSide;
  participants: HexCombatParticipant[];
  contact: HexCombatContact;
  adoption: HexCombatFinanceEvidenceAdoption | undefined;
  submittedFinanceOutputs: readonly HexSubmittedFinanceOutput[];
}): HexCombatFinanceFirepowerScore {
  const participantIds = new Set(input.participants.map((participant) => participant.agentId));
  const participantOutputs = input.submittedFinanceOutputs.filter((output) =>
    participantIds.has(output.agentId)
    && output.cardKind === (input.side === "defense" ? "stance" : "challenge")
  );
  const combatUsableOutputs = participantOutputs.filter((output) => output.submittedUsableForCombat && !output.orphanedChallenge);
  const acceptedRefSet = new Set(input.side === "defense" ? input.adoption?.acceptedClaims ?? [] : input.adoption?.acceptedChallenges ?? []);
  const acceptedEvidenceRefsByItemId = input.adoption?.acceptedEvidenceRefsByItemId ?? {};
  const participantAcceptedEvidenceRefs = new Set<string>();
  const participantAcceptedClaimRefs = new Set<string>();
  const acceptedItemsMissingEvidenceMapping = new Set<string>();

  const addAcceptedItemEvidence = (itemId: string): void => {
    const refs = acceptedEvidenceRefsByItemId[itemId] ?? [];
    if (refs.length === 0) {
      acceptedItemsMissingEvidenceMapping.add(itemId);
      return;
    }
    for (const ref of refs) {
      participantAcceptedEvidenceRefs.add(ref);
    }
  };

  for (const output of combatUsableOutputs) {
    if (input.side === "defense" && output.submittedStanceCard) {
      for (const claim of output.submittedStanceCard.coreClaims) {
        if (acceptedRefSet.has(claim.claimId)) {
          participantAcceptedClaimRefs.add(claim.claimId);
          addAcceptedItemEvidence(claim.claimId);
        }
      }
    }
    if (input.side === "attack" && output.submittedChallengeCard) {
      for (const challenge of output.submittedChallengeCard.challenges) {
        if (acceptedRefSet.has(challenge.challengeId)) {
          participantAcceptedClaimRefs.add(challenge.challengeId);
          addAcceptedItemEvidence(challenge.challengeId);
        }
      }
    }
  }

  const auditReasons: string[] = [];
  if (participantOutputs.length === 0) {
    auditReasons.push("no_participant_submitted_finance_output");
  }
  if (combatUsableOutputs.length < participantOutputs.length) {
    auditReasons.push("participant_submitted_output_not_combat_usable_filtered");
  }
  if (acceptedItemsMissingEvidenceMapping.size > 0) {
    auditReasons.push("accepted_item_missing_evidence_mapping");
  }
  if (participantAcceptedEvidenceRefs.size === 0) {
    auditReasons.push("no_participant_accepted_evidence");
  }

  const n59Cap = capFromN59Effects(input.adoption?.combatEffectAllowed ?? []);
  const n62Cap = capFromSubmittedOutputs(combatUsableOutputs);
  const baseScore = participantAcceptedEvidenceRefs.size === 0
    ? 0
    : Math.min(
      input.adoption?.sideScore ?? 0,
      15 + participantAcceptedEvidenceRefs.size * 12 + participantAcceptedClaimRefs.size * 8
    );
  const rawPressureScore = Math.round((baseScore / 100) * 45);
  const rawLethalScore = Math.round((baseScore / 100) * 20);
  const pressureScore = Math.min(rawPressureScore, n59Cap.pressure, n62Cap.pressure);
  const lethalScore = Math.min(rawLethalScore, n59Cap.lethal, n62Cap.lethal);
  const blockedLethalScore = input.contact.lethalEligible ? 0 : lethalScore;
  const appliedToCombatScore = pressureScore + (input.contact.lethalEligible ? lethalScore : 0);
  const caps = [`n59:${n59Cap.label}`, `n62:${n62Cap.label}`];
  if (pressureScore < rawPressureScore || lethalScore < rawLethalScore) {
    auditReasons.push("finance_firepower_cap_applied");
  }
  if (!input.contact.lethalEligible && lethalScore > 0) {
    auditReasons.push("finance_lethal_score_blocked_by_contact_gate");
  }
  if (appliedToCombatScore > 0) {
    auditReasons.push("finance_firepower_applied_to_combat_score");
  }

  return {
    side: input.side,
    pressureScore: roundScore(pressureScore),
    lethalScore: roundScore(lethalScore),
    totalScore: roundScore(pressureScore + lethalScore),
    appliedToCombatScore: roundScore(appliedToCombatScore),
    blockedLethalScore: roundScore(blockedLethalScore),
    participantAcceptedEvidenceRefs: [...participantAcceptedEvidenceRefs],
    participantAcceptedClaimRefs: [...participantAcceptedClaimRefs],
    participantSubmittedOutputRefs: combatUsableOutputs.map((output) => output.submittedOutputId),
    capApplied: caps.join("|"),
    caps,
    auditReasons: uniqueStrings(auditReasons)
  };
}

function capFromN59Effects(effects: readonly HexCombatEffectAllowed[]): FinanceFirepowerCap {
  if (effects.includes("possible_kill")) return { pressure: 45, lethal: 20, label: "possible_kill" };
  if (effects.includes("force_reposition") || effects.includes("map_control")) return { pressure: 30, lethal: 0, label: "force_reposition_or_map_control" };
  if (effects.includes("pressure")) return { pressure: 18, lethal: 0, label: "pressure" };
  if (effects.includes("minor_delay")) return { pressure: 5, lethal: 0, label: "minor_delay" };
  return { pressure: 0, lethal: 0, label: "no_effect" };
}

function capFromSubmittedOutputs(outputs: readonly HexSubmittedFinanceOutput[]): FinanceFirepowerCap {
  if (outputs.length === 0) {
    return { pressure: 0, lethal: 0, label: "none" };
  }
  return outputs.map((output) => capFromN62Effect(output.combatEffectCap))
    .sort((left, right) => (right.pressure + right.lethal) - (left.pressure + left.lethal))[0]!;
}

function capFromN62Effect(effect: HexFinanceCombatEffectCap): FinanceFirepowerCap {
  switch (effect) {
    case "possible_kill": return { pressure: 45, lethal: 20, label: "possible_kill" };
    case "possible_wound": return { pressure: 38, lethal: 8, label: "possible_wound" };
    case "forced_back": return { pressure: 30, lethal: 0, label: "forced_back" };
    case "suppression": return { pressure: 18, lethal: 0, label: "suppression" };
    case "weak_pressure": return { pressure: 10, lethal: 0, label: "weak_pressure" };
    case "minor_delay": return { pressure: 5, lethal: 0, label: "minor_delay" };
    case "none": return { pressure: 0, lethal: 0, label: "none" };
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10;
}
