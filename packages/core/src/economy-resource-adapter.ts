import type { Agent, AgentPhaseActionType, BuyType, EconomyPosture, LoadoutPackage, RoundPhaseId } from "@agent-major/shared";

import { formatBuyType, formatEconomyPosture, type DropDecision, type TeamEconomyPlan } from "./economy-rules.js";

export type NodeWeaponTier = "none" | "pistol" | "smg" | "rifle" | "awp";
export type NodeUtilityTier = "none" | "basic" | "partial" | "full";
export type NodeRiskProfile = "preserve" | "low" | "medium" | "high";

export interface NodeTeamEconomyResource {
  teamId: string;
  side: "attack" | "defense";
  posture: EconomyPosture;
  summaryBuyType: BuyType;
  sharedEconomySummary: string;
  dropDecisions: DropDecision[];
}

export interface NodeAgentEconomyResource {
  agentId: string;
  teamId: string;
  side: "attack" | "defense";
  economyPosture: EconomyPosture;
  loadoutPackage: LoadoutPackage;
  weaponTier: NodeWeaponTier;
  utilityTier: NodeUtilityTier;
  baseAp: number;
  allowedActionTypes: AgentPhaseActionType[];
  canLeadEntry: boolean;
  canUseExecuteUtility: boolean;
  canRetake: boolean;
  canSave: boolean;
  riskProfile: NodeRiskProfile;
  notes: string[];
}

export interface NodeRoundEconomyResources {
  roundNumber: number;
  phaseId: RoundPhaseId;
  teams: NodeTeamEconomyResource[];
  agents: NodeAgentEconomyResource[];
  agentResourcesById: Record<string, NodeAgentEconomyResource>;
}

export interface BuildNodeEconomyResourcesInput {
  roundNumber: number;
  phaseId: RoundPhaseId;
  teamPlans: TeamEconomyPlan[];
  activeAgents: Agent[];
}

const lowResourceActions: AgentPhaseActionType[] = ["hold_position", "watch_angle", "gather_info", "map_control", "prepare_trade", "save"];
const mediumResourceActions: AgentPhaseActionType[] = [...lowResourceActions, "use_utility", "seek_duel", "fake_pressure", "rotate", "retake"];
const fullResourceActions: AgentPhaseActionType[] = [...mediumResourceActions, "execute_site", "post_plant_hold", "defuse"];

export function buildNodeEconomyResources(input: BuildNodeEconomyResourcesInput): NodeRoundEconomyResources {
  const agentsById = new Map(input.activeAgents.map((agent) => [agent.id, agent] as const));
  const teams = input.teamPlans.map((plan) => buildTeamResource(plan));
  const agentResources = input.teamPlans.flatMap((plan) =>
    plan.decisions.map((decision) => {
      const agent = agentsById.get(decision.agentId);
      return buildAgentResource({
        agent,
        side: plan.side,
        posture: decision.economyPosture,
        loadoutPackage: decision.loadoutPackage,
        agentId: decision.agentId,
        teamId: decision.teamId,
        notes: decision.notes
      });
    })
  );

  const agentResourcesById = Object.fromEntries(agentResources.map((resource) => [resource.agentId, resource]));

  return {
    roundNumber: input.roundNumber,
    phaseId: input.phaseId,
    teams,
    agents: agentResources,
    agentResourcesById
  };
}

function buildTeamResource(plan: TeamEconomyPlan): NodeTeamEconomyResource {
  return {
    teamId: plan.teamId,
    side: plan.side,
    posture: plan.posture,
    summaryBuyType: plan.summaryBuyType,
    sharedEconomySummary: `${plan.side === "attack" ? "进攻方" : "防守方"}${formatEconomyPosture(plan.posture)}，队伍总经济 ${plan.totalCash}，买型 ${formatBuyType(plan.summaryBuyType)}。${plan.postureReason}`,
    dropDecisions: plan.dropDecisions
  };
}

function buildAgentResource(input: {
  agent: Agent | undefined;
  side: "attack" | "defense";
  posture: EconomyPosture;
  loadoutPackage: LoadoutPackage;
  agentId: string;
  teamId: string;
  notes: string[];
}): NodeAgentEconomyResource {
  const resourceClass = classifyPosture(input.posture);
  const allowedActionTypes = actionsForResourceClass(resourceClass);
  const weaponTier = weaponTierForLoadout(input.loadoutPackage, input.posture);
  const utilityTier = utilityTierForPosture(input.posture);
  const canUseExecuteUtility = utilityTier === "partial" || utilityTier === "full";
  const canLeadEntry =
    resourceClass !== "low" && (input.agent?.role === "entry" || input.agent?.role === "star_rifler" || input.posture === "rifle_buy");

  return {
    agentId: input.agentId,
    teamId: input.teamId,
    side: input.side,
    economyPosture: input.posture,
    loadoutPackage: input.loadoutPackage,
    weaponTier,
    utilityTier,
    baseAp: 3,
    allowedActionTypes,
    canLeadEntry,
    canUseExecuteUtility,
    canRetake: input.side === "defense" && resourceClass !== "low",
    canSave: true,
    riskProfile: riskProfileForResourceClass(resourceClass),
    notes: buildResourceNotes(input.posture, input.notes, resourceClass)
  };
}

function classifyPosture(posture: EconomyPosture): "low" | "medium" | "full" {
  switch (posture) {
    case "full_eco":
    case "eco":
    case "save_play":
      return "low";
    case "pistol_round":
    case "force_buy":
    case "light_buy":
    case "pistol_armor_force":
    case "broken_buy":
    case "half_buy":
    case "bonus_round":
      return "medium";
    case "rifle_buy":
    case "awp_buy":
    case "double_awp":
      return "full";
  }
}

function actionsForResourceClass(resourceClass: "low" | "medium" | "full"): AgentPhaseActionType[] {
  switch (resourceClass) {
    case "low":
      return lowResourceActions;
    case "medium":
      return mediumResourceActions;
    case "full":
      return fullResourceActions;
  }
}

function weaponTierForLoadout(loadoutPackage: LoadoutPackage, posture: EconomyPosture): NodeWeaponTier {
  if (loadoutPackage === "awp_pack" || posture === "awp_buy" || posture === "double_awp") {
    return "awp";
  }
  if (loadoutPackage.includes("rifle")) {
    return "rifle";
  }
  if (loadoutPackage.includes("smg") || loadoutPackage === "bonus_carry_pack" || loadoutPackage === "broken_buy_pack") {
    return "smg";
  }
  if (posture === "save_play") {
    return "none";
  }
  return "pistol";
}

function utilityTierForPosture(posture: EconomyPosture): NodeUtilityTier {
  switch (posture) {
    case "full_eco":
    case "save_play":
      return "none";
    case "eco":
    case "pistol_round":
    case "force_buy":
    case "light_buy":
    case "pistol_armor_force":
    case "broken_buy":
      return "basic";
    case "half_buy":
    case "bonus_round":
      return "partial";
    case "rifle_buy":
    case "awp_buy":
    case "double_awp":
      return "full";
  }
}

function riskProfileForResourceClass(resourceClass: "low" | "medium" | "full"): NodeRiskProfile {
  switch (resourceClass) {
    case "low":
      return "preserve";
    case "medium":
      return "medium";
    case "full":
      return "high";
  }
}

function buildResourceNotes(posture: EconomyPosture, existingNotes: string[], resourceClass: "low" | "medium" | "full"): string[] {
  const notes = [...existingNotes];
  if (resourceClass === "low") {
    notes.push(`${formatEconomyPosture(posture)}只能支撑轻量控图、抢信息、抱团或保枪，不能写成完整高配爆弹。`);
  } else if (resourceClass === "medium") {
    notes.push(`${formatEconomyPosture(posture)}可以执行局部争夺和低配配合，但必须保留资源取舍。`);
  } else {
    notes.push(`${formatEconomyPosture(posture)}可以支撑完整默认、进点、回防和较完整道具协同，但仍受 AP 与 node graph 限制。`);
  }
  return notes;
}
