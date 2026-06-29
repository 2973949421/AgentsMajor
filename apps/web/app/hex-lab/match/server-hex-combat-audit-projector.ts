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
    return "旧 trace 未记录 N65-lite 主对枪 pair / pressureKey。";
  }
  const primary = input.formatAgentName(pair.primaryAgentId);
  const target = input.formatAgentName(pair.targetAgentId);
  const support = pair.contributorAgentIds.length > 0 ? "；支援：" + pair.contributorAgentIds.map(input.formatAgentName).join("、") : "";
  return "主对枪：" + primary + " vs " + target + "；枪线 " + pair.laneId + "；pressureKey " + pair.pressureKey + "；直接度 " + pair.directnessScore + "；致命门 " + pair.lethalGateStatus + support + "。";
}
