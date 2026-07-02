import type {
  Agent,
  BuyType,
  EconomyPosture,
  EconomyState,
  LoadoutPackage,
  RoundReport
} from "@agent-major/shared";
import { normalizeCsRoleProfile } from "@agent-major/shared";

import { mr6MapRules } from "../match/map-rules.js";

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

export const lossBonusByCount = [1400, 1900, 2400, 2900, 3400] as const;

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

export function outputBudgetForBuyType(buyType: BuyType): number {
  switch (buyType) {
    case "fullBuy":
      return 1200;
    case "halfBuy":
      return 850;
    case "forceBuy":
      return 650;
    case "save":
      return 420;
    case "eco":
      return 360;
  }
}

export function outputBudgetForEconomyPosture(posture: EconomyPosture): number {
  switch (posture) {
    case "pistol_round":
      return 650;
    case "rifle_buy":
    case "awp_buy":
    case "double_awp":
      return 1200;
    case "bonus_round":
    case "half_buy":
      return 850;
    case "broken_buy":
    case "force_buy":
    case "light_buy":
    case "pistol_armor_force":
      return 650;
    case "eco":
      return 420;
    case "full_eco":
    case "save_play":
      return 360;
  }
}

export function buildCompetitiveParityNote(
  teamPlanOrPlans: TeamEconomyPlan | Record<string, TeamEconomyPlan> | undefined,
  opponentPlanOrTeamId?: TeamEconomyPlan | string
): string | undefined {
  const { teamPlan, opponentPlan } = resolveCompetitiveParityPlans(teamPlanOrPlans, opponentPlanOrTeamId);
  if (!teamPlan || !opponentPlan) {
    return undefined;
  }
  if (teamPlan.posture === opponentPlan.posture) {
    return undefined;
  }
  const lowResourcePostures: EconomyPosture[] = ["eco", "full_eco", "save_play", "light_buy"];
  if (lowResourcePostures.includes(teamPlan.posture) && !lowResourcePostures.includes(opponentPlan.posture)) {
    return `经济劣势提示：本队为${formatEconomyPosture(teamPlan.posture)}，对手为${formatEconomyPosture(opponentPlan.posture)}。裁判必须区分“资源约束”与“战术质量”，不能把低预算自动判为全维度低证据。`;
  }
  if (!lowResourcePostures.includes(teamPlan.posture) && lowResourcePostures.includes(opponentPlan.posture)) {
    return `经济优势提示：本队为${formatEconomyPosture(teamPlan.posture)}，对手为${formatEconomyPosture(opponentPlan.posture)}。裁判必须要求本队用装备优势兑现具体地图控制，而不能只凭经济优势获胜。`;
  }
  return undefined;
}

function resolveCompetitiveParityPlans(
  teamPlanOrPlans: TeamEconomyPlan | Record<string, TeamEconomyPlan> | undefined,
  opponentPlanOrTeamId?: TeamEconomyPlan | string
): { teamPlan: TeamEconomyPlan | undefined; opponentPlan: TeamEconomyPlan | undefined } {
  if (!teamPlanOrPlans) {
    return { teamPlan: undefined, opponentPlan: undefined };
  }
  if (typeof opponentPlanOrTeamId === "string" && isTeamEconomyPlanRecord(teamPlanOrPlans)) {
    const teamPlan = teamPlanOrPlans[opponentPlanOrTeamId];
    const opponentPlan = Object.entries(teamPlanOrPlans).find(([teamId]) => teamId !== opponentPlanOrTeamId)?.[1];
    return { teamPlan, opponentPlan };
  }
  return {
    teamPlan: teamPlanOrPlans as TeamEconomyPlan,
    opponentPlan: typeof opponentPlanOrTeamId === "string" ? undefined : opponentPlanOrTeamId
  };
}

function isTeamEconomyPlanRecord(value: TeamEconomyPlan | Record<string, TeamEconomyPlan>): value is Record<string, TeamEconomyPlan> {
  return !("teamId" in value);
}

export function formatBuyType(buyType: BuyType): string {
  switch (buyType) {
    case "fullBuy":
      return "完整长枪";
    case "halfBuy":
      return "半起/奖励局";
    case "forceBuy":
      return "强起";
    case "save":
      return "保枪/保经济";
    case "eco":
      return "经济局";
  }
}

export function formatEconomyPosture(posture: EconomyPosture): string {
  switch (posture) {
    case "pistol_round":
      return "手枪局";
    case "rifle_buy":
      return "标准长枪局";
    case "awp_buy":
      return "AWP 长枪局";
    case "double_awp":
      return "双狙局";
    case "bonus_round":
      return "奖励局";
    case "half_buy":
      return "半起";
    case "force_buy":
      return "强起";
    case "light_buy":
      return "轻买";
    case "pistol_armor_force":
      return "手枪甲强起";
    case "broken_buy":
      return "破产混起";
    case "save_play":
      return "主动保枪/保经济";
    case "full_eco":
      return "全 E";
    case "eco":
      return "小 E";
  }
}

export function formatEconomyDescriptor(buyType: BuyType, posture?: EconomyPosture): string {
  return posture ? formatEconomyPosture(posture) : formatBuyType(buyType);
}

export function isEconomySwing(economyDelta: RoundReport["economyDelta"]): boolean {
  const teamANet = economyDelta?.teamNetDelta?.teamA ?? 0;
  const teamBNet = economyDelta?.teamNetDelta?.teamB ?? 0;
  return Math.abs(teamANet - teamBNet) >= 3000;
}

export function economyNetDeltaForTeam(economyDelta: RoundReport["economyDelta"], teamId: string, teamAId: string): number {
  return teamId === teamAId ? economyDelta?.teamNetDelta?.teamA ?? 0 : economyDelta?.teamNetDelta?.teamB ?? 0;
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

export function outputGateTierForEconomyPosture(posture: EconomyPosture): number {
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

export function buyTypeToEconomyPosture(buyType: BuyType): EconomyPosture {
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

export function spendForBuyType(buyType: BuyType): number {
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

export function inferTeamLossCount(states: EconomyState[], teamId: string): number {
  const candidate =
    states.find((state) => state.teamId === teamId)?.lossCount ?? states.find((state) => state.teamId === teamId)?.lossStreak ?? 1;
  return Math.max(0, Math.min(4, candidate));
}

export function lossBonusForCount(lossCount: number): number {
  return lossBonusByCount[Math.max(0, Math.min(4, lossCount))] ?? lossBonusByCount[1];
}

export function teamEconomySide(teamId: string, teamAId: string, sideContext: { activeSide: "teamA" | "teamB" }): "attack" | "defense" {
  return sideForTeam(teamId, teamAId, sideContext.activeSide) === "active" ? "attack" : "defense";
}

export function sideForTeam(teamId: string, teamAId: string, activeSide: "teamA" | "teamB"): "active" | "reactive" {
  const side = teamId === teamAId ? "teamA" : "teamB";
  return side === activeSide ? "active" : "reactive";
}

export function sortAgentsForRound(agents: Agent[]): Agent[] {
  return [...agents].sort((left, right) => rankAgentForRound(left) - rankAgentForRound(right) || left.id.localeCompare(right.id));
}

function rankAgentForRound(agent: Agent): number {
  const profile = normalizeCsRoleProfile(agent.role, agent.secondaryRoles ?? []);
  if (profile.role === "entry") return 0;
  if (profile.isStar) return 1;
  if (profile.role === "awper") return 2;
  if (profile.role === "igl") return 3;
  if (profile.role === "rifler") return 4;
  if (profile.role === "lurker") return 5;
  if (profile.role === "coach") return 8;
  return 99;
}

export function isPostPistolFollowupRound(roundNumber: number): boolean {
  return roundNumber === 2 || roundNumber === mr6MapRules.roundsPerHalf + 2;
}

export function isPistolRound(roundNumber: number): boolean {
  return roundNumber === 1 || roundNumber === mr6MapRules.roundsPerHalf + 1;
}

export function isOvertimeEconomyResetRound(roundNumber: number): boolean {
  return roundNumber > mr6MapRules.regularRounds && (roundNumber - mr6MapRules.regularRounds - 1) % mr6MapRules.overtimeMaxRounds === 0;
}

export function isEconomyResetRound(roundNumber: number): boolean {
  return roundNumber === 1 || roundNumber === mr6MapRules.roundsPerHalf + 1 || isOvertimeEconomyResetRound(roundNumber);
}

export function roundsRemainingInCurrentHalf(roundNumber: number): number {
  const offsetInHalf = ((roundNumber - 1) % mr6MapRules.roundsPerHalf) + 1;
  return mr6MapRules.roundsPerHalf - offsetInHalf;
}

export function suggestedPistolRoundSpend(role: Agent["role"], side: "attack" | "defense"): number {
  const profile = normalizeCsRoleProfile(role);
  if (profile.role === "entry" || profile.isStar) {
    return side === "attack" ? 800 : 750;
  }
  if (profile.role === "igl") {
    return 700;
  }
  if (profile.role === "awper") {
    return 600;
  }
  return 650;
}

export function shouldPrioritizePistolArmorForce(role: Agent["role"]): boolean {
  const profile = normalizeCsRoleProfile(role);
  return profile.role === "entry" || profile.isStar || profile.role === "igl";
}

export function timestamp(): string {
  return "2026-05-01T00:00:00.000Z";
}
