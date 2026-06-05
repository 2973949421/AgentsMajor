import type {
  Agent,
  AgentActionDecision,
  AgentEconomyDelta,
  AgentOutput,
  BuyType,
  EconomyPosture,
  EconomyState,
  JudgeRoundWinType,
  LoadoutPackage,
  RoundReport,
  ScorePair,
  SubmittedAgentOutput,
  Team
} from "@agent-major/shared";

import { mr6MapRules } from "./map-rules.js";

export interface DropDecision {
  fromAgentId: string;
  toAgentId: string;
  amount: number;
  reason: string;
}

export interface AgentBuyDecision {
  agentId: string;
  teamId: string;
  tokenBankBefore: number;
  tokenBankAfterDrop: number;
  buyType: BuyType;
  economyPosture: EconomyPosture;
  loadoutPackage: LoadoutPackage;
  spend: number;
  outputBudget: number;
  dropSent: number;
  dropReceived: number;
  notes: string[];
}

export type RoundEconomyPhase = "pistol_round" | "post_pistol" | "gun_round" | "overtime_reset";

export interface TeamEconomyPlan {
  teamId: string;
  side: "attack" | "defense";
  phase: RoundEconomyPhase;
  lossCount: number;
  posture: EconomyPosture;
  postureReason: string;
  summaryBuyType: BuyType;
  totalCash: number;
  dropDecisions: DropDecision[];
  decisions: AgentBuyDecision[];
}

export const cs2EconomyRules = {
  initialMoney: 800,
  overtimeResetMoney: 10000,
  maxMoney: 16000,
  roundWinStandard: 3250,
  roundWinBomb: 3500,
  objectiveActorReward: 300,
  tPlantButDefusedTeamReward: 600,
  coachInitialBank: 5000,
  coachTimeoutCost: 2500,
  tComfortRifleMin: 4800,
  ctComfortRifleMin: 5500,
  tLowRifleMin: 4000,
  ctLowRifleMin: 4800,
  tAwpMin: 6500,
  ctAwpMin: 7000
} as const;

const lossBonusByCount = [1400, 1900, 2400, 2900, 3400] as const;

export function initialEconomy(agent: Agent, mapGameId: string, createdAt: string): EconomyState {
  return {
    id: `eco_${mapGameId}_initial_${agent.id}`,
    agentId: agent.id,
    teamId: agent.teamId,
    mapGameId,
    phase: "before_buy",
    tokenBank: cs2EconomyRules.initialMoney,
    buyType: "eco",
    lossStreak: 1,
    lossCount: 1,
    economyPosture: "pistol_round",
    loadoutPackage: "pistol_round_pack",
    timeoutsRemaining: 1,
    visibleContextBudget: 1200,
    outputBudget: outputBudgetForEconomyPosture("pistol_round"),
    createdAt
  };
}

export function roundStartEconomy(input: {
  agent: Agent;
  mapGameId: string;
  roundNumber: number;
  createdAt: string;
  side: "attack" | "defense";
}): EconomyState {
  if (isOvertimeEconomyResetRound(input.roundNumber)) {
    return {
      id: `eco_${input.mapGameId}_ot_${input.roundNumber}_${input.agent.id}`,
      agentId: input.agent.id,
      teamId: input.agent.teamId,
      mapGameId: input.mapGameId,
      phase: "before_buy",
      tokenBank: cs2EconomyRules.overtimeResetMoney,
      buyType: "fullBuy",
      lossStreak: 0,
      lossCount: 0,
      economyPosture: "rifle_buy",
      loadoutPackage: input.side === "attack" ? "rifle_full_t_pack" : "rifle_full_ct_pack",
      timeoutsRemaining: 1,
      visibleContextBudget: 1200,
      outputBudget: outputBudgetForEconomyPosture("rifle_buy"),
      createdAt: input.createdAt
    };
  }

  return initialEconomy(input.agent, input.mapGameId, input.createdAt);
}

export function decideTeamBuyType(states: EconomyState[]): BuyType {
  const average = states.reduce((sum, state) => sum + state.tokenBank, 0) / Math.max(1, states.length);
  if (average >= 7000) {
    return "fullBuy";
  }
  if (average >= 4500) {
    return "halfBuy";
  }
  if (average >= 2500) {
    return "forceBuy";
  }

  return "eco";
}

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
    const buyDecision = teamPlan?.decisions.find((decision) => decision.agentId === state.agentId);
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

export function decideTeamEconomyPlans(input: {
  roundNumber: number;
  scoreBeforeRound: ScorePair;
  teamA: Team;
  teamB: Team;
  activeA: Agent[];
  activeB: Agent[];
  beforeEconomy: EconomyState[];
  sideContext: { activeSide: "teamA" | "teamB" };
  previousRoundReport: RoundReport | undefined;
}): Record<string, TeamEconomyPlan> {
  const teamAPlan = buildTeamEconomyPlan({
    roundNumber: input.roundNumber,
    teamScore: input.scoreBeforeRound.teamA,
    opponentScore: input.scoreBeforeRound.teamB,
    team: input.teamA,
    activeAgents: input.activeA,
    states: input.beforeEconomy.filter((state) => state.teamId === input.teamA.id),
    side: teamEconomySide(input.teamA.id, input.teamA.id, input.sideContext),
    previousRoundReport: input.previousRoundReport
  });
  const teamBPlan = buildTeamEconomyPlan({
    roundNumber: input.roundNumber,
    teamScore: input.scoreBeforeRound.teamB,
    opponentScore: input.scoreBeforeRound.teamA,
    team: input.teamB,
    activeAgents: input.activeB,
    states: input.beforeEconomy.filter((state) => state.teamId === input.teamB.id),
    side: teamEconomySide(input.teamB.id, input.teamA.id, input.sideContext),
    previousRoundReport: input.previousRoundReport
  });
  return {
    [input.teamA.id]: teamAPlan,
    [input.teamB.id]: teamBPlan
  };
}

export function buildSubmittedAgentOutputs(input: {
  agentOutputs: AgentOutput[];
  buyDecisionByAgent: Map<string, AgentBuyDecision>;
}): SubmittedAgentOutput[] {
  return input.agentOutputs.map((output) => {
    const buyDecision = input.buyDecisionByAgent.get(output.agentId);
    const buyType = buyDecision?.buyType ?? "eco";
    const economyPosture = buyDecision?.economyPosture;
    const loadoutPackage = buyDecision?.loadoutPackage;
    const outputBudget = buyDecision?.outputBudget ?? outputBudgetForBuyType(buyType);
    return buildSubmittedAgentOutput(output, buyType, outputBudget, economyPosture, loadoutPackage);
  });
}

export function outputBudgetForBuyType(buyType: BuyType): number {
  switch (buyType) {
    case "fullBuy":
      return 700;
    case "halfBuy":
      return 500;
    case "forceBuy":
      return 420;
    case "save":
      return 240;
    case "eco":
      return 300;
  }
}

export function outputBudgetForEconomyPosture(posture: EconomyPosture): number {
  switch (posture) {
    case "pistol_round":
      return 260;
    case "full_eco":
      return 110;
    case "eco":
      return 180;
    case "pistol_armor_force":
      return 240;
    case "light_buy":
      return 280;
    case "force_buy":
      return 300;
    case "half_buy":
      return 380;
    case "bonus_round":
      return 420;
    case "rifle_buy":
      return 580;
    case "awp_buy":
      return 640;
    case "double_awp":
      return 660;
    case "broken_buy":
      return 320;
    case "save_play":
      return 120;
  }
}

export function buildCompetitiveParityNote(
  teamEconomyPlans: Record<string, TeamEconomyPlan>,
  focusTeamId?: string
): string | undefined {
  const plans = Object.values(teamEconomyPlans);
  if (plans.length < 2) {
    return undefined;
  }
  if (focusTeamId && !plans.some((plan) => plan.teamId === focusTeamId)) {
    return undefined;
  }
  const completePostures: EconomyPosture[] = ["rifle_buy", "awp_buy", "double_awp"];
  const bothRecovered = plans.slice(0, 2).every((plan) => completePostures.includes(plan.posture));
  if (!bothRecovered) {
    return undefined;
  }
  return "双方当前都已恢复完整购买，必须按本回合提交内容平等评估，不得因为前几回合连胜、连败或历史摘要默认偏向任一方。";
}

export function formatBuyType(buyType: BuyType): string {
  switch (buyType) {
    case "fullBuy":
      return "全甲全弹";
    case "halfBuy":
      return "半起";
    case "forceBuy":
      return "强起";
    case "save":
      return "保枪";
    case "eco":
      return "经济局";
  }
}

export function formatEconomyPosture(posture: EconomyPosture): string {
  switch (posture) {
    case "pistol_round":
      return "手枪局";
    case "full_eco":
      return "全E";
    case "eco":
      return "小E";
    case "pistol_armor_force":
      return "手枪甲强起";
    case "light_buy":
      return "轻买";
    case "force_buy":
      return "强起";
    case "half_buy":
      return "半起";
    case "bonus_round":
      return "奖励局";
    case "rifle_buy":
      return "长枪局";
    case "awp_buy":
      return "狙击局";
    case "double_awp":
      return "双狙局";
    case "broken_buy":
      return "破产混起";
    case "save_play":
      return "保枪局";
  }
}

export function formatEconomyDescriptor(buyType: BuyType, posture?: EconomyPosture): string {
  return posture ? formatEconomyPosture(posture) : formatBuyType(buyType);
}

export function isEconomySwing(economyDelta: RoundReport["economyDelta"]): boolean {
  const netDelta = economyDelta.teamNetDelta ?? economyDelta.teamTotals;
  return Math.abs(netDelta.teamA - netDelta.teamB) >= 2000;
}

export function economyNetDeltaForTeam(economyDelta: RoundReport["economyDelta"], teamId: string, teamAId: string): number {
  const netDelta = economyDelta.teamNetDelta ?? economyDelta.teamTotals;
  return teamId === teamAId ? netDelta.teamA : netDelta.teamB;
}

export function buyTypeForTeam(teamId: string, teamAId: string, teamABuyType: BuyType, teamBBuyType: BuyType): BuyType {
  return teamId === teamAId ? teamABuyType : teamBBuyType;
}

export function sumEconomyByTeam(items: EconomyState[], teamId: string): number {
  return items.filter((item) => item.teamId === teamId).reduce((sum, item) => sum + item.tokenBank, 0);
}

export function resolveRoundEconomyPhase(roundNumber: number): RoundEconomyPhase {
  if (isOvertimeEconomyResetRound(roundNumber)) {
    return "overtime_reset";
  }
  if (isPistolRound(roundNumber)) {
    return "pistol_round";
  }
  if (isPostPistolFollowupRound(roundNumber)) {
    return "post_pistol";
  }
  return "gun_round";
}

function buildTeamEconomyPlan(input: {
  roundNumber: number;
  teamScore: number;
  opponentScore: number;
  team: Team;
  activeAgents: Agent[];
  states: EconomyState[];
  side: "attack" | "defense";
  previousRoundReport: RoundReport | undefined;
}): TeamEconomyPlan {
  const sortedAgents = sortAgentsForRound(input.activeAgents);
  const statesByAgentId = new Map(input.states.map((state) => [state.agentId, state] as const));
  const phase = resolveRoundEconomyPhase(input.roundNumber);
  const lossCount = inferTeamLossCount(input.states, input.team.id);
  const teamScore = input.teamScore;
  const opponentScore = input.opponentScore;
  const totalCash = input.states.reduce((sum, state) => sum + state.tokenBank, 0);
  const roleAwpers = sortedAgents.filter((agent) => agent.role === "awper");
  const richestCash = Math.max(...input.states.map((state) => state.tokenBank), 0);
  const poorestCash = Math.min(...input.states.map((state) => state.tokenBank), cs2EconomyRules.maxMoney);
  const previousPackages = input.states.map((state) => state.loadoutPackage).filter((value): value is LoadoutPackage => Boolean(value));
  const previousBuyTypes = input.states.map((state) => state.buyType);
  const richThreshold = input.side === "attack" ? cs2EconomyRules.tComfortRifleMin : cs2EconomyRules.ctComfortRifleMin;
  const lowRifleThreshold = input.side === "attack" ? cs2EconomyRules.tLowRifleMin : cs2EconomyRules.ctLowRifleMin;
  const awpThreshold = input.side === "attack" ? cs2EconomyRules.tAwpMin : cs2EconomyRules.ctAwpMin;
  const comfortTeamCash = input.side === "attack" ? 24000 : 26000;
  const lowTeamCash = input.side === "attack" ? 12500 : 14000;
  const wonPreviousRound = input.previousRoundReport?.winnerTeamId === input.team.id;
  const previousBonusCarry =
    wonPreviousRound && previousPackages.some((value) => value === "smg_force_pack" || value === "bonus_carry_pack");
  const explicitSaveContext = previousBuyTypes.filter((buyType) => buyType === "save").length >= 2;
  const richEnoughForRifles = input.states.filter((state) => state.tokenBank >= richThreshold).length;
  const canLowRifle = input.states.filter((state) => state.tokenBank >= lowRifleThreshold).length;
  const awpReadyCount = input.states.filter((state) => state.tokenBank >= awpThreshold).length;
  const isBrokenBuy = richestCash - poorestCash >= 2600 && richEnoughForRifles >= 1 && poorestCash <= 1800;
  const postPistolFollowup = isPostPistolFollowupRound(input.roundNumber);
  const trailingBy = Math.max(0, opponentScore - teamScore);
  const lateHalfPressure = roundsRemainingInCurrentHalf(input.roundNumber) <= 2;
  const canContestWithForce =
    totalCash >= 10000 &&
    totalCash < comfortTeamCash &&
    (canLowRifle >= 3 || input.states.filter((state) => state.tokenBank >= 2000).length >= 4) &&
    (trailingBy >= 2 || lateHalfPressure || (postPistolFollowup && input.side === "attack"));

  let posture: EconomyPosture;
  let postureReason: string;
  if (phase === "overtime_reset") {
    posture = "rifle_buy";
    postureReason = "加时经济重置，双方进入对等的竞争性长枪配置，不复用手枪局或全E模板。";
  } else if (phase === "pistol_round") {
    posture = "pistol_round";
    postureReason = "半场手枪局，采用独立的手枪对抗策略，不按没钱局处理。";
  } else if (isBrokenBuy) {
    posture = "broken_buy";
    postureReason = "队内贫富差明显，围绕 drop 和局部完整配置打破产混起。";
  } else if (explicitSaveContext && totalCash >= lowTeamCash && richEnoughForRifles <= 2) {
    posture = "save_play";
    postureReason = "上一回合已进入保枪/保经济上下文，本回合延续省钱策略。";
  } else if (awpReadyCount >= 2 && totalCash >= 35000) {
    posture = "double_awp";
    postureReason = "队内有双狙经济条件，允许双狙高配局。";
  } else if (awpReadyCount >= 1 && totalCash >= 32500 && roleAwpers.length > 0) {
    posture = "awp_buy";
    postureReason = "主狙经济到位，围绕 AWP 完整配置。";
  } else if (richEnoughForRifles >= Math.max(4, sortedAgents.length - 1) || (canLowRifle >= 4 && totalCash >= comfortTeamCash)) {
    posture = "rifle_buy";
    postureReason = "队伍已接近完整长枪线，按标准枪局处理。";
  } else if (postPistolFollowup && wonPreviousRound && totalCash >= lowTeamCash && totalCash < comfortTeamCash) {
    posture = "bonus_round";
    postureReason = "手枪局或上一局取胜后延续低成本武器，进入奖励局。";
  } else if (previousBonusCarry && lossCount <= 1 && totalCash >= 15000 && totalCash < comfortTeamCash) {
    posture = "bonus_round";
    postureReason = "上一回合取胜且保留低价枪，继续打 bonus。";
  } else if (input.states.every((state) => state.tokenBank <= cs2EconomyRules.initialMoney)) {
    posture = "full_eco";
    postureReason = "当前经济极低，进入兼容的全E态势。";
  } else if (input.states.every((state) => state.tokenBank <= 1500)) {
    posture = "eco";
    postureReason = "现金不足，只能以小E攒钱并争取下枪/安包收益。";
  } else if (postPistolFollowup && input.states.every((state) => state.tokenBank >= 1800 && state.tokenBank <= 2800)) {
    posture = "pistol_armor_force";
    postureReason = "手枪局后的强起窗口，允许手枪甲与局部激进购买。";
  } else if (input.states.every((state) => state.tokenBank >= 1200 && state.tokenBank <= 2200)) {
    posture = "pistol_armor_force";
    postureReason = "低额手枪甲区间，优先考虑手枪甲强起或局部保留。";
  } else if (canLowRifle >= 2 && totalCash >= lowTeamCash && totalCash < comfortTeamCash) {
    posture = "half_buy";
    postureReason = "当前回合能形成局部战斗力，同时为下一回合完整长枪保留余钱。";
  } else if (canContestWithForce) {
    posture = "force_buy";
    postureReason = "比分或回合窗口要求抢分，且当前现金足以支撑一次可执行的强起。";
  } else if (totalCash >= 9000 && totalCash < lowTeamCash) {
    posture = "light_buy";
    postureReason = "现金不足以组织完整长枪，但可以轻买控费并保留后手。";
  } else if (totalCash >= lowTeamCash && totalCash < comfortTeamCash) {
    posture = "light_buy";
    postureReason = "接近长枪线但不适合硬起，采用轻买/低配枪局。";
  } else {
    posture = totalCash >= 9000 ? "light_buy" : "eco";
    postureReason = totalCash >= 9000 ? "默认进入轻买控费态势。" : "默认进入小E积累经济。";
  }

  const agentSnapshots = sortedAgents.map((agent) => {
    const state = statesByAgentId.get(agent.id) ?? initialEconomy(agent, input.team.id, timestamp());
    return {
      agent,
      tokenBank: state.tokenBank,
      state
    };
  });
  const mutableCashByAgent = new Map(agentSnapshots.map((snapshot) => [snapshot.agent.id, snapshot.tokenBank] as const));
  const dropDecisions: DropDecision[] = [];
  if (posture === "rifle_buy" || posture === "awp_buy" || posture === "double_awp" || posture === "broken_buy") {
    const receivers = [...agentSnapshots]
      .filter((snapshot) => mutableCashByAgent.get(snapshot.agent.id)! < lowRifleThreshold)
      .sort((left, right) => mutableCashByAgent.get(left.agent.id)! - mutableCashByAgent.get(right.agent.id)!);
    const donors = [...agentSnapshots]
      .filter((snapshot) => mutableCashByAgent.get(snapshot.agent.id)! > richThreshold + 1200)
      .sort((left, right) => mutableCashByAgent.get(right.agent.id)! - mutableCashByAgent.get(left.agent.id)!);
    for (const receiver of receivers) {
      let deficit = lowRifleThreshold - (mutableCashByAgent.get(receiver.agent.id) ?? 0);
      for (const donor of donors) {
        if (deficit <= 0) {
          break;
        }
        if (donor.agent.id === receiver.agent.id) {
          continue;
        }
        const donorCash = mutableCashByAgent.get(donor.agent.id) ?? 0;
        const donorExcess = donorCash - richThreshold;
        if (donorExcess <= 0) {
          continue;
        }
        const transfer = Math.min(deficit, donorExcess);
        if (transfer <= 0) {
          continue;
        }
        mutableCashByAgent.set(donor.agent.id, donorCash - transfer);
        mutableCashByAgent.set(receiver.agent.id, (mutableCashByAgent.get(receiver.agent.id) ?? 0) + transfer);
        dropDecisions.push({
          fromAgentId: donor.agent.id,
          toAgentId: receiver.agent.id,
          amount: transfer,
          reason: posture === "awp_buy" || posture === "double_awp" ? "围绕长枪/AWP 完整度补枪" : "平衡 broken buy 与长枪线"
        });
        deficit -= transfer;
      }
    }
  }

  const decisions = agentSnapshots.map(({ agent, tokenBank }) => {
    const tokenBankAfterDrop = mutableCashByAgent.get(agent.id) ?? tokenBank;
    const dropSent = dropDecisions.filter((decision) => decision.fromAgentId === agent.id).reduce((sum, decision) => sum + decision.amount, 0);
    const dropReceived = dropDecisions.filter((decision) => decision.toAgentId === agent.id).reduce((sum, decision) => sum + decision.amount, 0);
    const agentDecision = decideAgentBuyDecision({
      agent,
      side: input.side,
      posture,
      tokenBankBefore: tokenBank,
      tokenBankAfterDrop,
      richThreshold,
      lowRifleThreshold,
      awpThreshold,
      hasDedicatedAwper: roleAwpers.length > 0
    });
    return {
      ...agentDecision,
      dropSent,
      dropReceived,
      notes: [...agentDecision.notes, ...(dropReceived > 0 ? ["收到队友 drop"] : []), ...(dropSent > 0 ? ["向队友发枪"] : [])]
    };
  });

  return {
    teamId: input.team.id,
    side: input.side,
    phase,
    lossCount,
    posture,
    postureReason,
    summaryBuyType: summarizeBuyTypeFromTeamPosture(posture, decisions),
    totalCash,
    dropDecisions,
    decisions
  };
}

function decideAgentBuyDecision(input: {
  agent: Agent;
  side: "attack" | "defense";
  posture: EconomyPosture;
  tokenBankBefore: number;
  tokenBankAfterDrop: number;
  richThreshold: number;
  lowRifleThreshold: number;
  awpThreshold: number;
  hasDedicatedAwper: boolean;
}): Omit<AgentBuyDecision, "dropSent" | "dropReceived"> {
  const isAwper = input.agent.role === "awper";
  const canAwp = isAwper && input.tokenBankAfterDrop >= input.awpThreshold;
  const canFullRifle = input.tokenBankAfterDrop >= input.richThreshold;
  const canLowRifle = input.tokenBankAfterDrop >= input.lowRifleThreshold;
  let buyType: BuyType;
  let economyPosture = input.posture;
  let loadoutPackage: LoadoutPackage;
  let spend: number;
  let notes: string[] = [];

  switch (input.posture) {
    case "pistol_round":
      buyType = "halfBuy";
      loadoutPackage = "pistol_round_pack";
      spend = Math.min(input.tokenBankAfterDrop, suggestedPistolRoundSpend(input.agent.role, input.side));
      notes = ["手枪局采用独立打法，不按没钱局处理。"];
      break;
    case "full_eco":
      buyType = "eco";
      loadoutPackage = "pistol_eco_pack";
      spend = Math.min(input.tokenBankAfterDrop, 200);
      break;
    case "eco":
      buyType = "eco";
      loadoutPackage = "pistol_eco_pack";
      spend = Math.min(input.tokenBankAfterDrop, 400);
      break;
    case "pistol_armor_force":
      if (shouldPrioritizePistolArmorForce(input.agent.role) || input.tokenBankAfterDrop >= 2600) {
        buyType = "forceBuy";
        loadoutPackage = "pistol_armor_force_pack";
        spend = Math.min(input.tokenBankAfterDrop, input.side === "attack" ? 1800 : 2000);
        notes = ["手枪甲强起窗口内优先给突破位和核心角色足够配置。"];
      } else {
        buyType = input.tokenBankAfterDrop >= 1500 ? "halfBuy" : "eco";
        economyPosture = input.tokenBankAfterDrop >= 1500 ? "pistol_armor_force" : "eco";
        loadoutPackage = input.tokenBankAfterDrop >= 1500 ? "pistol_armor_force_pack" : "pistol_eco_pack";
        spend = Math.min(input.tokenBankAfterDrop, input.tokenBankAfterDrop >= 1500 ? 1400 : 400);
        notes = ["手枪甲强起窗口内保持局部分化，不跟随全员硬起。"];
      }
      break;
    case "light_buy":
      if (canLowRifle) {
        buyType = "halfBuy";
        loadoutPackage = input.side === "attack" ? "rifle_low_t_pack" : "rifle_low_ct_pack";
        spend = Math.min(input.tokenBankAfterDrop, Math.max(1800, input.lowRifleThreshold - 200));
      } else if (input.tokenBankAfterDrop >= 1800) {
        buyType = "halfBuy";
        loadoutPackage = "pistol_armor_force_pack";
        spend = Math.min(input.tokenBankAfterDrop, input.side === "attack" ? 1800 : 2000);
      } else {
        buyType = "eco";
        economyPosture = "eco";
        loadoutPackage = "pistol_eco_pack";
        spend = Math.min(input.tokenBankAfterDrop, 400);
      }
      notes = ["轻买控费，不默认升级为全员强起"];
      break;
    case "force_buy":
      buyType = "forceBuy";
      loadoutPackage = canLowRifle ? (input.side === "attack" ? "rifle_low_t_pack" : "rifle_low_ct_pack") : "smg_force_pack";
      spend = Math.min(input.tokenBankAfterDrop, canLowRifle ? input.lowRifleThreshold : 3000);
      break;
    case "half_buy":
      buyType = "halfBuy";
      loadoutPackage = canLowRifle ? (input.side === "attack" ? "rifle_low_t_pack" : "rifle_low_ct_pack") : "pistol_armor_force_pack";
      spend = Math.min(input.tokenBankAfterDrop, canLowRifle ? input.lowRifleThreshold - 200 : 1800);
      notes = ["为下一回合完整长枪保留余钱"];
      break;
    case "bonus_round":
      buyType = "halfBuy";
      loadoutPackage = "bonus_carry_pack";
      spend = Math.min(input.tokenBankAfterDrop, 1800);
      notes = ["保留低价枪继续打 bonus"];
      break;
    case "rifle_buy":
      buyType = "fullBuy";
      loadoutPackage = input.side === "attack" ? "rifle_full_t_pack" : "rifle_full_ct_pack";
      spend = Math.min(input.tokenBankAfterDrop, input.richThreshold);
      break;
    case "awp_buy":
    case "double_awp":
      buyType = "fullBuy";
      if (canAwp) {
        loadoutPackage = "awp_pack";
        spend = Math.min(input.tokenBankAfterDrop, input.awpThreshold);
        notes = [input.posture === "double_awp" ? "双狙态势" : "围绕 AWP 配置"];
      } else if (canFullRifle) {
        loadoutPackage = input.side === "attack" ? "rifle_full_t_pack" : "rifle_full_ct_pack";
        spend = Math.min(input.tokenBankAfterDrop, input.richThreshold);
      } else {
        loadoutPackage = input.side === "attack" ? "rifle_low_t_pack" : "rifle_low_ct_pack";
        spend = Math.min(input.tokenBankAfterDrop, input.lowRifleThreshold);
      }
      break;
    case "broken_buy":
      if (canAwp && isAwper) {
        buyType = "fullBuy";
        loadoutPackage = "awp_pack";
        spend = Math.min(input.tokenBankAfterDrop, input.awpThreshold);
      } else if (canFullRifle) {
        buyType = "fullBuy";
        loadoutPackage = input.side === "attack" ? "rifle_full_t_pack" : "rifle_full_ct_pack";
        spend = Math.min(input.tokenBankAfterDrop, input.richThreshold);
      } else if (canLowRifle) {
        buyType = "forceBuy";
        loadoutPackage = "broken_buy_pack";
        spend = Math.min(input.tokenBankAfterDrop, input.lowRifleThreshold);
      } else {
        buyType = "eco";
        economyPosture = "eco";
        loadoutPackage = "broken_buy_pack";
        spend = Math.min(input.tokenBankAfterDrop, 500);
      }
      notes = ["队内经济不均，围绕 drop 拼配置"];
      break;
    case "save_play":
      buyType = "save";
      loadoutPackage = "save_support_pack";
      spend = Math.min(input.tokenBankAfterDrop, 600);
      notes = ["主动保枪/保经济"];
      break;
  }

  return {
    agentId: input.agent.id,
    teamId: input.agent.teamId,
    tokenBankBefore: input.tokenBankBefore,
    tokenBankAfterDrop: input.tokenBankAfterDrop,
    buyType,
    economyPosture,
    loadoutPackage,
    spend,
    outputBudget: outputBudgetForEconomyPosture(economyPosture),
    notes
  };
}

function buildSubmittedAgentOutput(
  output: AgentOutput,
  buyType: BuyType,
  outputBudget: number,
  economyPosture?: EconomyPosture,
  loadoutPackage?: LoadoutPackage
): SubmittedAgentOutput {
  const rawDetail = output.actionDetail;
  const budgetTier = outputGateTierForEconomyPosture(economyPosture ?? buyTypeToEconomyPosture(buyType));
  const omittedFields: string[] = [];
  const postureLabel = economyPosture ? formatEconomyPosture(economyPosture) : formatBuyType(buyType);
  const gateSummary = `Output Gate 已按${postureLabel}提交，预算 ${outputBudget}，Judge 只能消费 SubmittedOutput，不能读取被裁剪 RawOutput。`;
  const submittedDetail: AgentActionDecision | undefined = rawDetail
    ? {
        roundObjective: gateActionText(rawDetail.roundObjective, budgetTier),
        executionPlan: gateActionText(rawDetail.executionPlan, budgetTier),
        coordinationPlan: gateActionText(rawDetail.coordinationPlan, budgetTier),
        roleResponsibilityUsage: gateActionText(rawDetail.roleResponsibilityUsage, budgetTier),
        riskRead:
          budgetTier >= 2
            ? gateActionText(rawDetail.riskRead, budgetTier)
            : recordOmittedField("riskRead", omittedFields, "经济预算不足：风险判断被压缩，Judge 只能看到核心执行意图。"),
        contingencyPlan:
          budgetTier >= 3
            ? gateActionText(rawDetail.contingencyPlan, budgetTier)
            : recordOmittedField("contingencyPlan", omittedFields, "经济预算不足：备选方案被裁剪，Judge 不能把 RawOutput 中的完整备选路径当作证据。"),
        expectedContribution:
          budgetTier >= 2
            ? gateActionText(rawDetail.expectedContribution, budgetTier)
            : recordOmittedField("expectedContribution", omittedFields, "经济预算不足：预期贡献被压缩为核心目标和执行计划。"),
        confidence: output.confidence,
        ...(rawDetail.fingerprint ? { fingerprint: rawDetail.fingerprint } : {})
      }
    : undefined;

  return {
    ...output,
    id: `sub_${output.id}`,
    rawOutputId: output.id,
    submissionKind: "submitted_output",
    buyType,
    ...(economyPosture ? { economyPosture } : {}),
    ...(loadoutPackage ? { loadoutPackage } : {}),
    outputBudget,
    ...(submittedDetail ? { actionDetail: submittedDetail } : {}),
    ...(output.action ? { action: gateActionText(output.action, budgetTier) } : {}),
    omittedFields,
    gateSummary,
    rawFingerprint: `submitted_${output.rawFingerprint}`
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
    const defuser = activeByTeam[defenderTeamId]?.find((agent) => agent.role === "support") ?? activeByTeam[defenderTeamId]?.[0];
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
    const prioritizedSurvivors = (activeByTeam[attackerTeamId] ?? [])
      .filter((agent) => losingPlan?.decisions.find((decision) => decision.agentId === agent.id)?.economyPosture === "save_play");
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

  return {
    winnerRewardByTeam,
    loserRewardByAgent,
    bonusRewardByAgent,
    survivorIds,
    agentNotesById
  };
}

function summarizeBuyTypeFromTeamPosture(posture: EconomyPosture, decisions: AgentBuyDecision[]): BuyType {
  switch (posture) {
    case "pistol_round":
      return "halfBuy";
    case "full_eco":
    case "eco":
      return "eco";
    case "light_buy":
    case "half_buy":
    case "bonus_round":
      return "halfBuy";
    case "save_play":
      return "save";
    case "rifle_buy":
    case "awp_buy":
    case "double_awp":
      return "fullBuy";
    case "broken_buy":
      return decisions.filter((decision) => decision.buyType === "fullBuy").length >= 3 ? "halfBuy" : "forceBuy";
    default:
      return "forceBuy";
  }
}

function outputGateTierForEconomyPosture(posture: EconomyPosture): number {
  switch (posture) {
    case "pistol_round":
      return 2;
    case "awp_buy":
    case "double_awp":
    case "rifle_buy":
      return 4;
    case "bonus_round":
    case "half_buy":
      return 3;
    case "broken_buy":
    case "force_buy":
    case "light_buy":
    case "pistol_armor_force":
      return 2;
    case "eco":
      return 1;
    case "full_eco":
    case "save_play":
      return 0;
  }
}

function buyTypeToEconomyPosture(buyType: BuyType): EconomyPosture {
  switch (buyType) {
    case "fullBuy":
      return "rifle_buy";
    case "halfBuy":
      return "half_buy";
    case "forceBuy":
      return "force_buy";
    case "eco":
      return "eco";
    case "save":
      return "save_play";
  }
}

function gateActionText(value: string, budgetTier: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  const maxChars = budgetTier >= 4 ? 420 : budgetTier === 3 ? 300 : budgetTier === 2 ? 220 : budgetTier === 1 ? 160 : 120;
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}…`;
}

function recordOmittedField(field: string, omittedFields: string[], replacement: string): string {
  omittedFields.push(field);
  return replacement;
}

function sumEconomyNetDeltaByTeam(items: AgentEconomyDelta[], teamId: string): number {
  return items.filter((item) => item.teamId === teamId).reduce((sum, item) => sum + item.afterTokenBank - item.beforeTokenBank, 0);
}

function sumEconomyDeltaByTeam(items: AgentEconomyDelta[], teamId: string): number {
  return items.filter((item) => item.teamId === teamId).reduce((sum, item) => sum + item.afterTokenBank, 0);
}

function spendForBuyType(buyType: BuyType): number {
  switch (buyType) {
    case "fullBuy":
      return 5200;
    case "halfBuy":
      return 3200;
    case "forceBuy":
      return 2500;
    case "save":
      return 600;
    case "eco":
      return 900;
  }
}

function inferTeamLossCount(states: EconomyState[], teamId: string): number {
  const candidate =
    states.find((state) => state.teamId === teamId)?.lossCount ?? states.find((state) => state.teamId === teamId)?.lossStreak ?? 1;
  return Math.max(0, Math.min(4, candidate));
}

function lossBonusForCount(lossCount: number): number {
  return lossBonusByCount[Math.max(0, Math.min(4, lossCount))] ?? lossBonusByCount[1];
}

function teamEconomySide(teamId: string, teamAId: string, sideContext: { activeSide: "teamA" | "teamB" }): "attack" | "defense" {
  return sideForTeam(teamId, teamAId, sideContext.activeSide) === "active" ? "attack" : "defense";
}

function sideForTeam(teamId: string, teamAId: string, activeSide: "teamA" | "teamB"): "active" | "reactive" {
  const side = teamId === teamAId ? "teamA" : "teamB";
  return side === activeSide ? "active" : "reactive";
}

function sortAgentsForRound(agents: Agent[]): Agent[] {
  const rank = new Map<string, number>([
    ["entry", 0],
    ["star_rifler", 1],
    ["awper", 2],
    ["igl", 3],
    ["rifler", 4],
    ["lurker", 5],
    ["support", 6],
    ["stand_in", 7],
    ["coach", 8]
  ]);
  return [...agents].sort((left, right) => (rank.get(left.role) ?? 99) - (rank.get(right.role) ?? 99) || left.id.localeCompare(right.id));
}

function isPostPistolFollowupRound(roundNumber: number): boolean {
  return roundNumber === 2 || roundNumber === mr6MapRules.roundsPerHalf + 2;
}

function isPistolRound(roundNumber: number): boolean {
  return roundNumber === 1 || roundNumber === mr6MapRules.roundsPerHalf + 1;
}

export function isOvertimeEconomyResetRound(roundNumber: number): boolean {
  return roundNumber > mr6MapRules.regularRounds && (roundNumber - mr6MapRules.regularRounds - 1) % mr6MapRules.overtimeMaxRounds === 0;
}

export function isEconomyResetRound(roundNumber: number): boolean {
  return roundNumber === 1 || roundNumber === mr6MapRules.roundsPerHalf + 1 || isOvertimeEconomyResetRound(roundNumber);
}

function roundsRemainingInCurrentHalf(roundNumber: number): number {
  const offsetInHalf = ((roundNumber - 1) % mr6MapRules.roundsPerHalf) + 1;
  return mr6MapRules.roundsPerHalf - offsetInHalf;
}

function suggestedPistolRoundSpend(role: Agent["role"], side: "attack" | "defense"): number {
  if (role === "entry" || role === "star_rifler") {
    return side === "attack" ? 800 : 750;
  }
  if (role === "igl" || role === "support") {
    return 700;
  }
  if (role === "awper") {
    return 600;
  }
  return 650;
}

function shouldPrioritizePistolArmorForce(role: Agent["role"]): boolean {
  return role === "entry" || role === "star_rifler" || role === "igl";
}

function timestamp(): string {
  return "2026-05-01T00:00:00.000Z";
}
