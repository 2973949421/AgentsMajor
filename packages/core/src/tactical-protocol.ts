import type {
  Agent,
  AttackPlan,
  BuyType,
  DefenseDeployment,
  JudgeResult,
  MapGame,
  PublicAttackPlanSummary,
  PublicDefenseDeploymentSummary,
  Round,
  ScorePair,
  SideAssignment,
  TacticalCollision,
  TacticalRoundContext,
  Team,
  ZoneResourceAllocation
} from "@agent-major/shared";

import { getTacticalMapLayout, resolveTacticalZone, type RequiredTacticalZoneId, type TacticalMapLayout } from "./tactical-map.js";
import type { SideContext } from "./map-rules.js";

export interface RuleBasedTacticalInput {
  round: Round;
  mapGame: MapGame;
  teamA: Team;
  teamB: Team;
  activeAgentsByTeam: Record<string, Agent[]>;
  buyTypeByTeam: Record<string, BuyType>;
  economyByTeam: Record<string, number>;
  recentPublicRoundSummaries: string[];
  tacticalMapLayout: TacticalMapLayout;
  sideAssignment: SideAssignment;
}

export interface RuleBasedTacticalPlans {
  attackPlan: AttackPlan;
  defenseDeployment: DefenseDeployment;
}

export interface TacticalCollisionInput extends RuleBasedTacticalPlans {
  sideAssignment: SideAssignment;
  buyTypeByTeam: Record<string, BuyType>;
  scoreBeforeRound: ScorePair;
  judgeResult: JudgeResult;
  teamAId: string;
  activeAgentsById: Record<string, Agent>;
}

export interface TacticalRoundGeneration extends RuleBasedTacticalPlans {
  sideAssignment: SideAssignment;
  collision: TacticalCollision;
  tacticalContext: TacticalRoundContext;
}

type SiteZoneId = "conversion_site_a" | "conversion_site_b";

const siteZoneIds: SiteZoneId[] = ["conversion_site_a", "conversion_site_b"];
const forbiddenPayloadFields = new Set(["rawOutput", "driverModelId", "providerId", "modelName", "token", "cost", "apiKey", "authorization"]);

export function createSideAssignment(input: {
  roundId: string;
  roundNumber: number;
  teamAId: string;
  teamBId: string;
  sideContext: SideContext;
}): SideAssignment {
  const attackingTeamId = input.sideContext.activeSide === "teamA" ? input.teamAId : input.teamBId;
  const defendingTeamId = input.sideContext.reactiveSide === "teamA" ? input.teamAId : input.teamBId;
  return {
    roundId: input.roundId,
    roundNumber: input.roundNumber,
    attackingTeamId,
    defendingTeamId,
    half:
      input.sideContext.phase === "regular_first_half"
        ? "first_half"
        : input.sideContext.phase === "regular_second_half"
          ? "second_half"
          : "overtime",
    sideSwitched: input.sideContext.sideSwitchIndex > 0
  };
}

export function buildRuleBasedTacticalPlans(input: RuleBasedTacticalInput): RuleBasedTacticalPlans {
  const attackPlan = buildAttackPlan(input);
  const defenseDeployment = buildDefenseDeployment(input);
  return { attackPlan, defenseDeployment };
}

export function resolveTacticalCollision(input: TacticalCollisionInput): TacticalCollision {
  const attackingBuyType = input.buyTypeByTeam[input.sideAssignment.attackingTeamId] ?? "eco";
  const defendingBuyType = input.buyTypeByTeam[input.sideAssignment.defendingTeamId] ?? "eco";
  const realTargetZoneId = resolveRealTargetZoneId(input.attackPlan);
  const attackZoneWeight = allocationWeight(input.attackPlan.resourceAllocationByZone, realTargetZoneId);
  const defenseZoneWeight = allocationWeight(input.defenseDeployment.resourceAllocationByZone, realTargetZoneId);
  const weakZoneBonus = input.defenseDeployment.weakZoneIds.includes(realTargetZoneId) ? 10 : 0;
  const heavyZoneBonus = input.defenseDeployment.heavyZoneId === realTargetZoneId ? 10 : 0;
  const midAttackBonus =
    input.attackPlan.approach === "mid_control_then_execute" &&
    allocationWeight(input.attackPlan.resourceAllocationByZone, "buyer_mid") - allocationWeight(input.defenseDeployment.resourceAllocationByZone, "buyer_mid") > 15
      ? 8
      : 0;
  const midDefenseBonus =
    input.defenseDeployment.setup === "mid_push" &&
    allocationWeight(input.defenseDeployment.resourceAllocationByZone, "buyer_mid") - allocationWeight(input.attackPlan.resourceAllocationByZone, "buyer_mid") > 15
      ? 8
      : 0;
  const retakeBonus = input.defenseDeployment.setup === "retake_setup" && input.defenseDeployment.rotatePolicy === "fast_rotate" ? 5 : 0;
  const scoreGap = Math.abs(input.scoreBeforeRound.teamA - input.scoreBeforeRound.teamB);
  const ecoStealBonus = input.attackPlan.approach === "eco_steal" && (attackingBuyType === "eco" || attackingBuyType === "forceBuy") && scoreGap < 8 ? 6 : 0;
  const fakeCondition =
    input.attackPlan.approach === "fake_then_rotate" &&
    typeof input.attackPlan.feintZoneId === "string" &&
    typeof input.attackPlan.secondaryTargetZoneId === "string" &&
    input.attackPlan.feintZoneId === input.defenseDeployment.heavyZoneId &&
    input.defenseDeployment.weakZoneIds.includes(input.attackPlan.secondaryTargetZoneId);

  const baseAttackScore =
    attackZoneWeight +
    buyModifier(attackingBuyType) +
    attackApproachModifier(input.attackPlan.approach) +
    weakZoneBonus +
    attackRoleModifier(input.attackPlan.activeAgentIds, input.activeAgentsById) +
    tempoModifier(input.sideAssignment.attackingTeamId, input.teamAId, input.scoreBeforeRound, input.judgeResult.winnerTeamId) +
    midAttackBonus +
    ecoStealBonus;
  const baseDefenseScore =
    defenseZoneWeight +
    buyModifier(defendingBuyType) +
    defenseSetupModifier(input.defenseDeployment.setup) +
    rotateModifier(input.defenseDeployment.rotatePolicy) +
    defenseRoleModifier(input.defenseDeployment.anchorAgentIds, input.activeAgentsById) +
    tempoModifier(input.sideAssignment.defendingTeamId, input.teamAId, input.scoreBeforeRound, input.judgeResult.winnerTeamId) +
    heavyZoneBonus +
    midDefenseBonus +
    retakeBonus;
  const result = chooseJudgeAlignedCollisionResult({
    baseAttackScore,
    baseDefenseScore,
    attackingBuyType,
    rotatePolicy: input.defenseDeployment.rotatePolicy,
    fakeCondition,
    judgeWinnerTeamId: input.judgeResult.winnerTeamId,
    attackingTeamId: input.sideAssignment.attackingTeamId,
    defendingTeamId: input.sideAssignment.defendingTeamId
  });
  const alignedScores = alignScoresWithCollisionResult({ baseAttackScore, baseDefenseScore, result });

  return {
    primaryZoneId: realTargetZoneId,
    attackApproach: input.attackPlan.approach,
    defenseSetup: input.defenseDeployment.setup,
    result,
    attackScore: alignedScores.attackScore,
    defenseScore: alignedScores.defenseScore,
    decisiveReason: buildCollisionReason({
      realTargetZoneId,
      result,
      attackScore: alignedScores.attackScore,
      defenseScore: alignedScores.defenseScore,
      baseAttackScore,
      baseDefenseScore,
      judgeAligned: alignedScores.judgeAligned,
      fakeCondition,
      judgeWinnerTeamId: input.judgeResult.winnerTeamId
    })
  };
}

export function buildPublicTacticalContext(input: {
  sideAssignment: SideAssignment;
  attackPlan: AttackPlan;
  defenseDeployment: DefenseDeployment;
  collision: TacticalCollision;
}): TacticalRoundContext {
  return {
    sideAssignment: input.sideAssignment,
    attackPlan: publicAttackPlanSummary(input.attackPlan, input.collision),
    defenseDeployment: publicDefenseDeploymentSummary(input.defenseDeployment),
    collision: input.collision
  };
}

export function assertNoForbiddenTacticalFields(payload: unknown): void {
  const badKey = findForbiddenPayloadField(payload);
  if (badKey) {
    throw new Error(`Tactical payload contains forbidden field: ${badKey}.`);
  }
}

export function getPhase16TacticalMapLayout(mapName: string): TacticalMapLayout {
  return getTacticalMapLayout(mapName);
}

function buildAttackPlan(input: RuleBasedTacticalInput): AttackPlan {
  const teamId = input.sideAssignment.attackingTeamId;
  const buyType = input.buyTypeByTeam[teamId] ?? "eco";
  const economyLead = (input.economyByTeam[teamId] ?? 0) - (input.economyByTeam[input.sideAssignment.defendingTeamId] ?? 0);
  const seed = tacticalSeed(input, teamId);
  const approach = chooseAttackApproach({ buyType, economyLead, seed, summaries: input.recentPublicRoundSummaries });
  const primarySite = choosePrimarySite(input.recentPublicRoundSummaries, seed);
  const secondarySite = oppositeSite(primarySite);
  const activeAgentIds = (input.activeAgentsByTeam[teamId] ?? []).map((agent) => agent.id);
  const planShape = attackPlanShape(approach, primarySite, secondarySite);
  return {
    teamId,
    primaryTargetZoneId: planShape.primaryTargetZoneId,
    ...(planShape.secondaryTargetZoneId ? { secondaryTargetZoneId: planShape.secondaryTargetZoneId } : {}),
    approach,
    ...(planShape.feintZoneId ? { feintZoneId: planShape.feintZoneId } : {}),
    resourceAllocationByZone: normalizeAllocations(planShape.allocations.map((allocation) => ({ ...allocation, activeAgentIds }))),
    activeAgentIds,
    intentSummary: `attack approach=${approach} primary=${planShape.primaryTargetZoneId}${planShape.secondaryTargetZoneId ? ` secondary=${planShape.secondaryTargetZoneId}` : ""}`
  };
}

function buildDefenseDeployment(input: RuleBasedTacticalInput): DefenseDeployment {
  const teamId = input.sideAssignment.defendingTeamId;
  const buyType = input.buyTypeByTeam[teamId] ?? "eco";
  const economyLead = (input.economyByTeam[teamId] ?? 0) - (input.economyByTeam[input.sideAssignment.attackingTeamId] ?? 0);
  const seed = tacticalSeed(input, teamId);
  const setup = chooseDefenseSetup({ buyType, economyLead, seed, summaries: input.recentPublicRoundSummaries });
  const activeAgentIds = (input.activeAgentsByTeam[teamId] ?? []).map((agent) => agent.id);
  const shape = defenseDeploymentShape(setup, seed);
  return {
    teamId,
    setup,
    ...(shape.heavyZoneId ? { heavyZoneId: shape.heavyZoneId } : {}),
    weakZoneIds: shape.weakZoneIds,
    resourceAllocationByZone: normalizeAllocations(shape.allocations.map((allocation) => ({ ...allocation, activeAgentIds }))),
    anchorAgentIds: activeAgentIds,
    rotatePolicy: shape.rotatePolicy,
    deploymentSummary: `defense setup=${setup}${shape.heavyZoneId ? ` heavy=${shape.heavyZoneId}` : ""} weak=${shape.weakZoneIds.join(",")}`
  };
}

function chooseAttackApproach(input: { buyType: BuyType; economyLead: number; seed: string; summaries: string[] }): AttackPlan["approach"] {
  const history = input.summaries.join(" ").toLowerCase();
  if (history.includes("defense_hold") && stableNumber(input.seed, 3) === 0) {
    return "fake_then_rotate";
  }
  if (input.buyType === "eco" || input.buyType === "forceBuy") {
    return stableNumber(input.seed, 2) === 0 ? "eco_steal" : "fast_execute";
  }
  if (input.buyType === "fullBuy" && input.economyLead > 1500) {
    return stableNumber(input.seed, 2) === 0 ? "slow_control" : "mid_control_then_execute";
  }
  if (history.includes("buyer_mid") && stableNumber(input.seed, 2) === 0) {
    return "mid_control_then_execute";
  }
  return ["default_probe", "fast_execute", "slow_control", "mid_control_then_execute"][stableNumber(input.seed, 4)] as AttackPlan["approach"];
}

function chooseDefenseSetup(input: { buyType: BuyType; economyLead: number; seed: string; summaries: string[] }): DefenseDeployment["setup"] {
  const history = input.summaries.join(" ").toLowerCase();
  if (input.buyType === "save" || input.buyType === "eco") {
    return "save_weak_hold";
  }
  if (input.buyType === "forceBuy") {
    return stableNumber(input.seed, 2) === 0 ? "heavy_a" : "heavy_b";
  }
  if (history.includes("conversion_site_a") && history.includes("attack_breakthrough")) {
    return "heavy_a";
  }
  if (history.includes("conversion_site_b") && history.includes("attack_breakthrough")) {
    return "heavy_b";
  }
  if (input.buyType === "fullBuy" && input.economyLead > 1500) {
    return stableNumber(input.seed, 2) === 0 ? "default_split" : "mid_push";
  }
  return ["default_split", "retake_setup", "mid_push"][stableNumber(input.seed, 3)] as DefenseDeployment["setup"];
}

function choosePrimarySite(summaries: string[], seed: string): SiteZoneId {
  const recent = summaries.at(-1)?.toLowerCase() ?? "";
  if (recent.includes("primary=conversion_site_a") && recent.includes("defense_hold")) {
    return "conversion_site_b";
  }
  if (recent.includes("primary=conversion_site_b") && recent.includes("defense_hold")) {
    return "conversion_site_a";
  }
  return siteZoneIds[stableNumber(seed, siteZoneIds.length)] ?? "conversion_site_a";
}

function attackPlanShape(
  approach: AttackPlan["approach"],
  primarySite: SiteZoneId,
  secondarySite: SiteZoneId
): {
  primaryTargetZoneId: RequiredTacticalZoneId;
  secondaryTargetZoneId?: RequiredTacticalZoneId;
  feintZoneId?: RequiredTacticalZoneId;
  allocations: Array<Omit<ZoneResourceAllocation, "activeAgentIds">>;
} {
  if (approach === "fake_then_rotate") {
    return {
      primaryTargetZoneId: primarySite,
      secondaryTargetZoneId: secondarySite,
      feintZoneId: primarySite,
      allocations: [
        allocation(primarySite, 28, "attack_feint"),
        allocation(secondarySite, 46, "attack_execute"),
        allocation("buyer_mid", 16, "info_control"),
        allocation("retention_connector", 10, "defense_rotate")
      ]
    };
  }

  if (approach === "mid_control_then_execute") {
    return {
      primaryTargetZoneId: primarySite,
      secondaryTargetZoneId: "buyer_mid",
      allocations: [
        allocation(primarySite, 42, "attack_execute"),
        allocation("buyer_mid", 36, "info_control"),
        allocation("retention_connector", 12, "defense_rotate"),
        allocation("token_economy", 10, "economy_pressure")
      ]
    };
  }

  if (approach === "eco_steal") {
    return {
      primaryTargetZoneId: primarySite,
      allocations: [
        allocation(primarySite, 44, "attack_execute"),
        allocation("token_economy", 34, "economy_pressure"),
        allocation("buyer_mid", 22, "info_control")
      ]
    };
  }

  return {
    primaryTargetZoneId: primarySite,
    allocations: [
      allocation(primarySite, approach === "fast_execute" ? 64 : 52, "attack_execute"),
      allocation("buyer_mid", approach === "slow_control" ? 28 : 18, "info_control"),
      allocation("pricing_ramp", 12, "economy_pressure"),
      allocation("token_economy", approach === "default_probe" ? 18 : 6, "economy_pressure")
    ]
  };
}

function defenseDeploymentShape(
  setup: DefenseDeployment["setup"],
  seed: string
): {
  heavyZoneId?: RequiredTacticalZoneId;
  weakZoneIds: RequiredTacticalZoneId[];
  rotatePolicy: DefenseDeployment["rotatePolicy"];
  allocations: Array<Omit<ZoneResourceAllocation, "activeAgentIds">>;
} {
  if (setup === "heavy_a") {
    return {
      heavyZoneId: "conversion_site_a",
      weakZoneIds: ["conversion_site_b"],
      rotatePolicy: "hold_sites",
      allocations: [
        allocation("conversion_site_a", 50, "defense_anchor"),
        allocation("conversion_site_b", 18, "defense_anchor"),
        allocation("buyer_mid", 18, "info_control"),
        allocation("retention_connector", 14, "defense_rotate")
      ]
    };
  }
  if (setup === "heavy_b") {
    return {
      heavyZoneId: "conversion_site_b",
      weakZoneIds: ["conversion_site_a"],
      rotatePolicy: "hold_sites",
      allocations: [
        allocation("conversion_site_b", 50, "defense_anchor"),
        allocation("conversion_site_a", 18, "defense_anchor"),
        allocation("buyer_mid", 18, "info_control"),
        allocation("retention_connector", 14, "defense_rotate")
      ]
    };
  }
  if (setup === "mid_push") {
    return {
      heavyZoneId: "buyer_mid",
      weakZoneIds: stableNumber(seed, 2) === 0 ? ["conversion_site_a"] : ["conversion_site_b"],
      rotatePolicy: "info_first",
      allocations: [
        allocation("buyer_mid", 46, "info_control"),
        allocation("conversion_site_a", 20, "defense_anchor"),
        allocation("conversion_site_b", 20, "defense_anchor"),
        allocation("token_economy", 14, "economy_pressure")
      ]
    };
  }
  if (setup === "retake_setup") {
    return {
      heavyZoneId: "retention_connector",
      weakZoneIds: stableNumber(seed, 2) === 0 ? ["conversion_site_a"] : ["conversion_site_b"],
      rotatePolicy: "fast_rotate",
      allocations: [
        allocation("retention_connector", 35, "defense_rotate"),
        allocation("conversion_site_a", 25, "defense_anchor"),
        allocation("conversion_site_b", 25, "defense_anchor"),
        allocation("buyer_mid", 15, "info_control")
      ]
    };
  }
  if (setup === "save_weak_hold") {
    const heavyZoneId = stableNumber(seed, 2) === 0 ? "conversion_site_a" : "conversion_site_b";
    const weakZoneId = oppositeSite(heavyZoneId);
    return {
      heavyZoneId,
      weakZoneIds: [weakZoneId],
      rotatePolicy: "save_first",
      allocations: [
        allocation(heavyZoneId, 42, "defense_anchor"),
        allocation(weakZoneId, 10, "defense_anchor"),
        allocation("token_economy", 34, "economy_pressure"),
        allocation("buyer_mid", 14, "info_control")
      ]
    };
  }

  return {
    weakZoneIds: [],
    rotatePolicy: "info_first",
    allocations: [
      allocation("conversion_site_a", 30, "defense_anchor"),
      allocation("conversion_site_b", 30, "defense_anchor"),
      allocation("buyer_mid", 20, "info_control"),
      allocation("retention_connector", 20, "defense_rotate")
    ]
  };
}

function allocation(zoneId: RequiredTacticalZoneId, weight: number, intent: ZoneResourceAllocation["intent"]): Omit<ZoneResourceAllocation, "activeAgentIds"> {
  return { zoneId, weight, intent };
}

function normalizeAllocations(items: ZoneResourceAllocation[]): ZoneResourceAllocation[] {
  const byZone = new Map<string, ZoneResourceAllocation>();
  for (const item of items) {
    const previous = byZone.get(item.zoneId);
    byZone.set(item.zoneId, {
      zoneId: item.zoneId,
      weight: (previous?.weight ?? 0) + item.weight,
      activeAgentIds: [...new Set([...(previous?.activeAgentIds ?? []), ...item.activeAgentIds])],
      intent: previous?.intent ?? item.intent
    });
  }

  const merged = [...byZone.values()];
  const total = merged.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) {
    return [allocation("buyer_mid", 100, "info_control")].map((item) => ({ ...item, activeAgentIds: [] }));
  }

  let remaining = 100;
  return merged.map((item, index) => {
    const normalized = index === merged.length - 1 ? remaining : Math.round((item.weight / total) * 100);
    remaining -= normalized;
    return {
      ...item,
      weight: normalized
    };
  });
}

function resolveRealTargetZoneId(attackPlan: AttackPlan): string {
  return attackPlan.approach === "fake_then_rotate" && attackPlan.secondaryTargetZoneId ? attackPlan.secondaryTargetZoneId : attackPlan.primaryTargetZoneId;
}

function publicAttackPlanSummary(attackPlan: AttackPlan, collision: TacticalCollision): PublicAttackPlanSummary {
  return {
    teamId: attackPlan.teamId,
    primaryTargetZoneId: attackPlan.primaryTargetZoneId,
    ...(attackPlan.secondaryTargetZoneId ? { secondaryTargetZoneId: attackPlan.secondaryTargetZoneId } : {}),
    approach: attackPlan.approach,
    feintRevealed: attackPlan.approach === "fake_then_rotate",
    publicSummary: `${attackPlan.intentSummary}; collision=${collision.result}; primaryZone=${collision.primaryZoneId}`
  };
}

function publicDefenseDeploymentSummary(defenseDeployment: DefenseDeployment): PublicDefenseDeploymentSummary {
  return {
    teamId: defenseDeployment.teamId,
    setup: defenseDeployment.setup,
    ...(defenseDeployment.heavyZoneId ? { heavyZoneId: defenseDeployment.heavyZoneId } : {}),
    weakZoneIds: defenseDeployment.weakZoneIds,
    rotatePolicy: defenseDeployment.rotatePolicy,
    publicSummary: defenseDeployment.deploymentSummary
  };
}

function allocationWeight(items: ZoneResourceAllocation[], zoneId: string): number {
  return items.find((item) => item.zoneId === zoneId)?.weight ?? 0;
}

function buyModifier(buyType: BuyType): number {
  switch (buyType) {
    case "fullBuy":
      return 12;
    case "forceBuy":
      return 5;
    case "halfBuy":
      return 2;
    case "eco":
      return -8;
    case "save":
      return -12;
  }
}

function attackApproachModifier(approach: AttackPlan["approach"]): number {
  switch (approach) {
    case "fast_execute":
      return 6;
    case "slow_control":
      return 3;
    case "mid_control_then_execute":
      return 4;
    case "fake_then_rotate":
      return 2;
    case "eco_steal":
      return 0;
    case "default_probe":
      return 1;
  }
}

function defenseSetupModifier(setup: DefenseDeployment["setup"]): number {
  switch (setup) {
    case "heavy_a":
    case "heavy_b":
      return 4;
    case "default_split":
      return 3;
    case "mid_push":
      return 5;
    case "retake_setup":
      return 4;
    case "save_weak_hold":
      return -4;
  }
}

function rotateModifier(policy: DefenseDeployment["rotatePolicy"]): number {
  switch (policy) {
    case "fast_rotate":
      return 5;
    case "info_first":
      return 3;
    case "hold_sites":
      return 2;
    case "save_first":
      return -3;
  }
}

function chooseJudgeAlignedCollisionResult(input: {
  baseAttackScore: number;
  baseDefenseScore: number;
  attackingBuyType: BuyType;
  rotatePolicy: DefenseDeployment["rotatePolicy"];
  fakeCondition: boolean;
  judgeWinnerTeamId: string;
  attackingTeamId: string;
  defendingTeamId: string;
}): TacticalCollision["result"] {
  const delta = input.baseAttackScore - input.baseDefenseScore;
  const close = Math.abs(delta) < 12;
  if (input.judgeWinnerTeamId === input.attackingTeamId) {
    if (input.fakeCondition && input.baseAttackScore >= input.baseDefenseScore - 5) {
      return "fake_success";
    }
    if ((input.attackingBuyType === "eco" || input.attackingBuyType === "forceBuy") && close) {
      return "economy_steal";
    }
    return close ? "trade_even" : "attack_breakthrough";
  }

  if (input.judgeWinnerTeamId === input.defendingTeamId) {
    if (input.rotatePolicy === "fast_rotate" && close) {
      return "rotate_success";
    }
    return close ? "trade_even" : "defense_hold";
  }

  if (input.fakeCondition && input.baseAttackScore >= input.baseDefenseScore - 5) {
    return "fake_success";
  }
  if (delta >= 12) {
    return "attack_breakthrough";
  }
  if (delta <= -12) {
    return "defense_hold";
  }
  if ((input.attackingBuyType === "eco" || input.attackingBuyType === "forceBuy") && close) {
    return "economy_steal";
  }
  if (input.rotatePolicy === "fast_rotate" && close) {
    return "rotate_success";
  }
  return "trade_even";
}

function alignScoresWithCollisionResult(input: {
  baseAttackScore: number;
  baseDefenseScore: number;
  result: TacticalCollision["result"];
}): { attackScore: number; defenseScore: number; judgeAligned: boolean } {
  let attackScore = input.baseAttackScore;
  let defenseScore = input.baseDefenseScore;

  if (input.result === "attack_breakthrough" && attackScore - defenseScore < 12) {
    attackScore = defenseScore + 12;
  }
  if ((input.result === "fake_success" || input.result === "economy_steal") && attackScore < defenseScore) {
    attackScore = defenseScore + 1;
  }
  if (input.result === "defense_hold" && defenseScore - attackScore < 12) {
    defenseScore = attackScore + 12;
  }
  if (input.result === "rotate_success" && defenseScore < attackScore) {
    defenseScore = attackScore + 1;
  }

  return {
    attackScore,
    defenseScore,
    judgeAligned: attackScore !== input.baseAttackScore || defenseScore !== input.baseDefenseScore
  };
}

function attackRoleModifier(agentIds: string[], agentsById: Record<string, Agent>): number {
  return Math.min(9, agentIds.filter((agentId) => agentHasAnyRole(agentsById[agentId], ["entry", "star_rifler", "awper", "closer"])).length * 3);
}

function defenseRoleModifier(agentIds: string[], agentsById: Record<string, Agent>): number {
  return Math.min(9, agentIds.filter((agentId) => agentHasAnyRole(agentsById[agentId], ["igl", "support", "lurker", "anchor", "coach"])).length * 3);
}

function agentHasAnyRole(agent: Agent | undefined, roles: string[]): boolean {
  if (!agent) {
    return false;
  }

  const roleSet = new Set<string>([agent.role, ...(agent.secondaryRoles ?? [])]);
  return roles.some((role) => roleSet.has(role));
}

function tempoModifier(teamId: string, teamAId: string, scoreBeforeRound: ScorePair, judgeWinnerTeamId: string): number {
  const teamScore = teamId === teamAId ? scoreBeforeRound.teamA : scoreBeforeRound.teamB;
  const opponentScore = teamId === teamAId ? scoreBeforeRound.teamB : scoreBeforeRound.teamA;
  const pressureBonus = teamScore < opponentScore ? 2 : 0;
  return pressureBonus + (teamId === judgeWinnerTeamId ? 2 : 0);
}

function buildCollisionReason(input: {
  realTargetZoneId: string;
  result: TacticalCollision["result"];
  attackScore: number;
  defenseScore: number;
  baseAttackScore: number;
  baseDefenseScore: number;
  judgeAligned: boolean;
  fakeCondition: boolean;
  judgeWinnerTeamId: string;
}): string {
  const fakeLine = input.fakeCondition ? " fake condition matched;" : "";
  const alignmentLine = input.judgeAligned ? ` judge-aligned from baseAttackScore=${input.baseAttackScore}; baseDefenseScore=${input.baseDefenseScore};` : "";
  return `zone=${input.realTargetZoneId}; result=${input.result}; attackScore=${input.attackScore}; defenseScore=${input.defenseScore};${fakeLine}${alignmentLine} judgeWinner=${input.judgeWinnerTeamId}; tactical collision explains the round without overriding score.`;
}

function tacticalSeed(input: RuleBasedTacticalInput, teamId: string): string {
  return `${input.mapGame.matchId}:${input.mapGame.id}:${input.round.roundNumber}:${teamId}`;
}

function oppositeSite(site: SiteZoneId | RequiredTacticalZoneId): SiteZoneId {
  return site === "conversion_site_a" ? "conversion_site_b" : "conversion_site_a";
}

function stableNumber(input: string, modulo: number): number {
  return Number.parseInt(stableHex(input).slice(0, 4), 16) % modulo;
}

function stableHex(input: string): string {
  let hash = 2166136261;
  for (const char of input) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function findForbiddenPayloadField(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findForbiddenPayloadField(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }

  for (const [key, child] of Object.entries(value)) {
    if (forbiddenPayloadFields.has(key)) {
      return key;
    }
    const found = findForbiddenPayloadField(child);
    if (found) return found;
  }
  return null;
}

export function resolvePhase16Zone(layout: TacticalMapLayout, zoneId: string): RequiredTacticalZoneId {
  return resolveTacticalZone(layout, zoneId).zone.zoneId;
}
