interface CombatDuelPairSummary {
  duelPairId: string;
  primaryAgentId: string;
  targetAgentId: string;
  laneId: string;
  pressureKey: string;
  directnessScore: number;
  lethalGateStatus: string;
  contributorAgentIds: string[];
}

export function humanizeDuelPairingSummary(input: {
  duelPairs: CombatDuelPairSummary[];
  formatAgentName: (agentId: string) => string;
}): string {
  const pair = [...input.duelPairs].sort((left, right) => right.directnessScore - left.directnessScore || left.duelPairId.localeCompare(right.duelPairId))[0];
  if (!pair) {
    return "? trace ??? N65-lite ??? pair / pressureKey?";
  }
  const primary = input.formatAgentName(pair.primaryAgentId);
  const target = input.formatAgentName(pair.targetAgentId);
  const support = pair.contributorAgentIds.length > 0 ? "????" + pair.contributorAgentIds.map(input.formatAgentName).join("?") : "";
  return "????" + primary + " vs " + target + "??? " + pair.laneId + "?pressureKey " + pair.pressureKey + "???? " + pair.directnessScore + "???? " + pair.lethalGateStatus + support + "?";
}
