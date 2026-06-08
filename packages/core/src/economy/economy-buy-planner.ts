import type { Agent, BuyType, EconomyPosture, EconomyState, LoadoutPackage, RoundReport, ScorePair, Team } from "@agent-major/shared";

import type {
  AgentBuyDecision,
  DropDecision,
  RoundEconomyPhase,
  TeamEconomyPlan
} from "./economy-rules.js";
import {
  cs2EconomyRules,
  initialEconomy,
  inferTeamLossCount,
  isPostPistolFollowupRound,
  outputBudgetForEconomyPosture,
  resolveRoundEconomyPhase,
  roundsRemainingInCurrentHalf,
  shouldPrioritizePistolArmorForce,
  sortAgentsForRound,
  suggestedPistolRoundSpend,
  teamEconomySide,
  timestamp
} from "./economy-rules.js";

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
  const phase: RoundEconomyPhase = resolveRoundEconomyPhase(input.roundNumber);
  const lossCount = inferTeamLossCount(input.states, input.team.id);
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
  const trailingBy = Math.max(0, input.opponentScore - input.teamScore);
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
    return { agent, tokenBank: state.tokenBank, state };
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
