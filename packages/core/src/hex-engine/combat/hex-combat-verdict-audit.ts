import type { HexCombatAudit, HexCombatContact } from "./hex-combat-types.js";

export function buildDuelPairingAudit(contact: HexCombatContact): HexCombatAudit["duelPairing"] | undefined {
  if ((contact.duelPairs?.length ?? 0) === 0 && (contact.fireLanes?.length ?? 0) === 0 && (contact.pressureKeys?.length ?? 0) === 0) {
    return undefined;
  }
  const primary = [...(contact.duelPairs ?? [])].sort((left, right) => right.directnessScore - left.directnessScore || left.duelPairId.localeCompare(right.duelPairId))[0];
  const reasons = uniqueStrings([
    "n65_lite_duel_pairing",
    ...(primary?.reasons ?? []),
    ...(contact.fireLanes ?? []).flatMap((lane) => lane.exposureFlags)
  ]);
  return {
    ...(primary ? { primaryDuelPairId: primary.duelPairId, primaryPressureKey: primary.pressureKey } : {}),
    duelPairCount: contact.duelPairs?.length ?? 0,
    fireLaneCount: contact.fireLanes?.length ?? 0,
    pressureKeys: [...(contact.pressureKeys ?? [])],
    reasons
  };
}


function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
