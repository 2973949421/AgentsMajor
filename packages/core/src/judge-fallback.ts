import type {
  Agent,
  JudgeRoundWinType,
  SideAssignment
} from "@agent-major/shared";

export function buildFallbackJudgeRoundWinType(winnerTeamId: string, sideAssignment: SideAssignment): JudgeRoundWinType {
  return winnerTeamId === sideAssignment.attackingTeamId ? "attack_elimination" : "defense_elimination";
}

export function selectMvpCandidate(winnerAgents: Agent[]): Agent | undefined {
  return winnerAgents
    .map((agent) => ({ agent, score: stableNumber(agent.id, 100) + (agent.role === "igl" ? 5 : 0) }))
    .sort((left, right) => right.score - left.score || left.agent.id.localeCompare(right.agent.id))[0]?.agent;
}

function stableNumber(input: string, modulo: number): number {
  return Number.parseInt(stableHex(input).slice(0, 4), 16) % modulo;
}

function stableHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
