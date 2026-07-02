import { normalizeCsRole, type Agent, type AgentEconomyDelta, type EconomyState, type JudgeRoundWinType, type RoundReport } from "@agent-major/shared";

import type { AgentBuyDecision, TeamEconomyPlan } from "./economy-rules.js";
import {
  cs2EconomyRules,
  inferTeamLossCount,
  lossBonusForCount,
  outputBudgetForBuyType,
  outputBudgetForEconomyPosture,
  sortAgentsForRound,
  spendForBuyType
} from "./economy-rules.js";

export function calculateEconomyDelta(input: {
  beforeEconomy: EconomyState[];
  winnerTeamId: string;
  loserTeamId: string;
  teamAId: string;
  teamBId: string;
  roundWinType: JudgeRoundWinType;
  teamEconomyPlans: Record<string, TeamEconomyPlan>;
  activeA: Agent[];
  activeB: Agent[];
}): RoundReport["economyDelta"] {
  const teamALossCountBefore = inferTeamLossCount(input.beforeEconomy, input.teamAId);
  const teamBLossCountBefore = inferTeamLossCount(input.beforeEconomy, input.teamBId);
  const teamLossCountsBefore: Record<string, number> = {
    [input.teamAId]: teamALossCountBefore,
    [input.teamBId]: teamBLossCountBefore
  };
  const teamALossCountAfter =
    input.winnerTeamId === input.teamAId ? Math.max(0, teamALossCountBefore - 1) : Math.min(4, teamALossCountBefore + 1);
  const teamBLossCountAfter =
    input.winnerTeamId === input.teamBId ? Math.max(0, teamBLossCountBefore - 1) : Math.min(4, teamBLossCountBefore + 1);
  const teamLossCountsAfter: Record<string, number> = {
    [input.teamAId]: teamALossCountAfter,
    [input.teamBId]: teamBLossCountAfter
  };
  const roundOutcomeContext = buildRoundEconomyOutcomeContext({
    roundWinType: input.roundWinType,
    winnerTeamId: input.winnerTeamId,
    loserTeamId: input.loserTeamId,
    teamAId: input.teamAId,
    teamBId: input.teamBId,
    activeA: input.activeA,
    activeB: input.activeB,
    teamEconomyPlans: input.teamEconomyPlans
  });
  const agents: AgentEconomyDelta[] = input.beforeEconomy.map((state) => {
    const teamPlan = input.teamEconomyPlans[state.teamId];
    const buyDecision = teamPlan?.decisions.find((decision: AgentBuyDecision) => decision.agentId === state.agentId);
    const buyType = buyDecision?.buyType ?? state.buyType;
    const spent = buyDecision?.spend ?? spendForBuyType(buyType);
    const won = state.teamId === input.winnerTeamId;
    const priorLossCount = typeof state.lossCount === "number" ? state.lossCount : typeof state.lossStreak === "number" ? state.lossStreak : 1;
    const baseReward = won
      ? roundOutcomeContext.winnerRewardByTeam[state.teamId] ?? cs2EconomyRules.roundWinStandard
      : roundOutcomeContext.loserRewardByAgent[state.agentId] ?? lossBonusForCount(teamLossCountsBefore[state.teamId] ?? 1);
    const bonusReward = roundOutcomeContext.bonusRewardByAgent[state.agentId] ?? 0;
    const reward = Math.max(0, baseReward + bonusReward);
    const afterTokenBank = Math.max(0, state.tokenBank - spent) + reward;
    return {
      agentId: state.agentId,
      teamId: state.teamId,
      beforeTokenBank: state.tokenBank,
      spent,
      reward,
      afterTokenBank,
      buyType,
      lossStreak: won ? Math.max(0, priorLossCount - 1) : priorLossCount + 1,
      lossCount: teamLossCountsAfter[state.teamId] ?? 1,
      ...(buyDecision?.economyPosture ? { economyPosture: buyDecision.economyPosture } : {}),
      ...(buyDecision?.loadoutPackage ? { loadoutPackage: buyDecision.loadoutPackage } : {}),
      survived: roundOutcomeContext.survivorIds.has(state.agentId),
      dropSent: buyDecision?.dropSent ?? 0,
      dropReceived: buyDecision?.dropReceived ?? 0,
      notes: roundOutcomeContext.agentNotesById[state.agentId] ?? []
    };
  });

  return {
    agents,
    teamTotals: {
      teamA: sumEconomyDeltaByTeam(agents, input.teamAId),
      teamB: sumEconomyDeltaByTeam(agents, input.teamBId)
    },
    teamNetDelta: {
      teamA: sumEconomyNetDeltaByTeam(agents, input.teamAId),
      teamB: sumEconomyNetDeltaByTeam(agents, input.teamBId)
    },
    teamLossCounts: {
      teamA: teamLossCountsAfter[input.teamAId] ?? 1,
      teamB: teamLossCountsAfter[input.teamBId] ?? 1
    },
    teamEconomyPostures: {
      teamA: input.teamEconomyPlans[input.teamAId]?.posture ?? "eco",
      teamB: input.teamEconomyPlans[input.teamBId]?.posture ?? "eco"
    }
  };
}

export function economyStateFromDelta(delta: AgentEconomyDelta, mapGameId: string, roundId: string, createdAt: string): EconomyState {
  return {
    id: `eco_${roundId}_${delta.agentId}`,
    agentId: delta.agentId,
    teamId: delta.teamId,
    mapGameId,
    roundId,
    phase: "after_round",
    tokenBank: delta.afterTokenBank,
    buyType: delta.buyType,
    lossStreak: delta.lossStreak ?? delta.lossCount,
    lossCount: delta.lossCount,
    ...(delta.economyPosture ? { economyPosture: delta.economyPosture } : {}),
    ...(delta.loadoutPackage ? { loadoutPackage: delta.loadoutPackage } : {}),
    timeoutsRemaining: 1,
    visibleContextBudget: 1200,
    outputBudget: delta.economyPosture ? outputBudgetForEconomyPosture(delta.economyPosture) : outputBudgetForBuyType(delta.buyType),
    createdAt
  };
}

function buildRoundEconomyOutcomeContext(input: {
  roundWinType: JudgeRoundWinType;
  winnerTeamId: string;
  loserTeamId: string;
  teamAId: string;
  teamBId: string;
  activeA: Agent[];
  activeB: Agent[];
  teamEconomyPlans: Record<string, TeamEconomyPlan>;
}): {
  winnerRewardByTeam: Record<string, number>;
  loserRewardByAgent: Record<string, number>;
  bonusRewardByAgent: Record<string, number>;
  survivorIds: Set<string>;
  agentNotesById: Record<string, string[]>;
} {
  const attackerTeamId = input.roundWinType.startsWith("attack_") ? input.winnerTeamId : input.loserTeamId;
  const defenderTeamId = attackerTeamId === input.teamAId ? input.teamBId : input.teamAId;
  const activeByTeam = {
    [input.teamAId]: sortAgentsForRound(input.activeA),
    [input.teamBId]: sortAgentsForRound(input.activeB)
  };
  const winnerReward =
    input.roundWinType === "attack_bomb_explosion" || input.roundWinType === "defense_defuse"
      ? cs2EconomyRules.roundWinBomb
      : cs2EconomyRules.roundWinStandard;
  const winnerRewardByTeam = {
    [input.winnerTeamId]: winnerReward
  } as Record<string, number>;
  const loserLossCount = input.teamEconomyPlans[input.loserTeamId]?.lossCount ?? 1;
  const defaultLoserReward = lossBonusForCount(loserLossCount);
  const loserRewardByAgent: Record<string, number> = Object.fromEntries(
    (activeByTeam[input.loserTeamId] ?? []).map((agent) => [agent.id, defaultLoserReward])
  );
  const bonusRewardByAgent: Record<string, number> = {};
  const survivorIds = new Set<string>();
  const agentNotesById: Record<string, string[]> = {};

  if (input.roundWinType === "attack_bomb_explosion") {
    const planter = activeByTeam[attackerTeamId]?.find((agent) => agent.role === "igl") ?? activeByTeam[attackerTeamId]?.[0];
    if (planter) {
      bonusRewardByAgent[planter.id] = (bonusRewardByAgent[planter.id] ?? 0) + cs2EconomyRules.objectiveActorReward;
      agentNotesById[planter.id] = [...(agentNotesById[planter.id] ?? []), "安包奖励 +300"];
    }
  }

  if (input.roundWinType === "defense_defuse") {
    const defuser = activeByTeam[defenderTeamId]?.find((agent) => normalizeCsRole(agent.role) === "rifler") ?? activeByTeam[defenderTeamId]?.[0];
    if (defuser) {
      bonusRewardByAgent[defuser.id] = (bonusRewardByAgent[defuser.id] ?? 0) + cs2EconomyRules.objectiveActorReward;
      agentNotesById[defuser.id] = [...(agentNotesById[defuser.id] ?? []), "拆包奖励 +300"];
    }
    for (const attacker of activeByTeam[attackerTeamId] ?? []) {
      bonusRewardByAgent[attacker.id] = (bonusRewardByAgent[attacker.id] ?? 0) + cs2EconomyRules.tPlantButDefusedTeamReward;
      agentNotesById[attacker.id] = [...(agentNotesById[attacker.id] ?? []), "安包被拆团队补偿 +600"];
    }
  }

  if (input.roundWinType === "defense_timeout_no_plant") {
    const losingPlan = input.teamEconomyPlans[attackerTeamId];
    const prioritizedSurvivors = (activeByTeam[attackerTeamId] ?? []).filter(
      (agent) => losingPlan?.decisions.find((decision) => decision.agentId === agent.id)?.economyPosture === "save_play"
    );
    const designatedSurvivors =
      prioritizedSurvivors.length > 0 ? prioritizedSurvivors : (activeByTeam[attackerTeamId] ?? []).slice(0, 1);
    for (const survivor of designatedSurvivors) {
      survivorIds.add(survivor.id);
      loserRewardByAgent[survivor.id] = 0;
      agentNotesById[survivor.id] = [...(agentNotesById[survivor.id] ?? []), "T 超时存活：不拿失败奖金"];
    }
  }

  for (const winner of activeByTeam[input.winnerTeamId] ?? []) {
    survivorIds.add(winner.id);
  }

  return { winnerRewardByTeam, loserRewardByAgent, bonusRewardByAgent, survivorIds, agentNotesById };
}

function sumEconomyNetDeltaByTeam(items: AgentEconomyDelta[], teamId: string): number {
  return items.filter((item) => item.teamId === teamId).reduce((sum, item) => sum + item.afterTokenBank - item.beforeTokenBank, 0);
}

function sumEconomyDeltaByTeam(items: AgentEconomyDelta[], teamId: string): number {
  return items.filter((item) => item.teamId === teamId).reduce((sum, item) => sum + item.afterTokenBank, 0);
}
