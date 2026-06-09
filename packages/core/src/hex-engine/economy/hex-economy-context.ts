import type { EconomyPosture, BuyType, LoadoutPackage } from "@agent-major/shared";
import type { AgentBuyDecision, DropDecision, TeamEconomyPlan } from "../../economy/economy-rules.js";
import type { HexAgentActionType } from "../action/hex-agent-command-boundary.js";
import type { HexRoundMemory, HexSide } from "../state/index.js";

export type HexResourceTier = "low" | "forced" | "medium" | "high";
export type HexUtilityTier = "none" | "low" | "medium" | "high";

export interface HexTeamEconomyContext {
  teamId: string;
  side: HexSide;
  posture: EconomyPosture;
  postureReason: string;
  summaryBuyType: BuyType;
  totalCash: number;
  dropDecisions: DropDecision[];
  economySummary: string;
}

export interface HexAgentEconomyContext {
  agentId: string;
  teamId: string;
  side: HexSide;
  economyPosture: EconomyPosture;
  buyType: BuyType;
  loadoutPackage: LoadoutPackage;
  outputBudget: number;
  dropSent: number;
  dropReceived: number;
  resourceTier: HexResourceTier;
  utilityTier: HexUtilityTier;
  allowedActionTypes: HexAgentActionType[];
  constraints: string[];
  notes: string[];
}

export interface HexRoundEconomyContext {
  teams: HexTeamEconomyContext[];
  agents: HexAgentEconomyContext[];
  warnings: string[];
}

export interface BuildHexRoundEconomyContextInput {
  teamEconomyPlans: Record<string, TeamEconomyPlan>;
  memory: HexRoundMemory;
}

export interface GetHexAgentEconomyContextInput {
  economyContext: HexRoundEconomyContext;
  agentId: string;
}

export interface DeriveHexEconomyAllowedActionsInput {
  economyPosture: EconomyPosture;
  buyType?: BuyType;
}

export interface HexEconomyCombatEvidence {
  agentIds: string[];
  resourceTiers: HexResourceTier[];
  utilityTiers: HexUtilityTier[];
  outputBudgetTotal: number;
  outputBudgetAverage: number;
  dropReceivedTotal: number;
  scoreDelta: number;
  reasons: string[];
}

export interface SummarizeHexEconomyEvidenceInput {
  economyContext: HexRoundEconomyContext | undefined;
  agentIds: string[];
}

const baseLowResourceActions: HexAgentActionType[] = [
  "hold_position",
  "move",
  "watch_angle",
  "gather_info",
  "save",
  "rotate"
];

const forcedResourceActions: HexAgentActionType[] = [
  ...baseLowResourceActions,
  "peek",
  "map_control",
  "prepare_trade",
  "seek_duel",
  "lurk",
  "fake"
];

const mediumResourceActions: HexAgentActionType[] = [
  ...forcedResourceActions,
  "use_utility",
  "execute_site",
  "plant_bomb",
  "defuse_bomb",
  "retake",
  "boost"
];

const highResourceActions: HexAgentActionType[] = [...mediumResourceActions];

export function buildHexRoundEconomyContext(input: BuildHexRoundEconomyContextInput): HexRoundEconomyContext {
  const teams: HexTeamEconomyContext[] = [];
  const agents: HexAgentEconomyContext[] = [];
  const warnings: string[] = [];
  const plans = Object.values(input.teamEconomyPlans);

  for (const plan of plans) {
    teams.push(buildTeamContext(plan));
    for (const decision of plan.decisions) {
      const memoryAgent = input.memory.agents.find((agent) => agent.agentId === decision.agentId);
      if (!memoryAgent) {
        warnings.push(`missing_memory_agent:${decision.agentId}`);
        continue;
      }
      agents.push(buildAgentContext(plan, decision, memoryAgent.side));
    }
  }

  for (const agent of input.memory.agents) {
    if (!agents.some((context) => context.agentId === agent.agentId)) {
      warnings.push(`missing_economy_decision:${agent.agentId}`);
    }
  }

  return {
    teams: teams.sort((left, right) => left.teamId.localeCompare(right.teamId)),
    agents: agents.sort((left, right) => left.agentId.localeCompare(right.agentId)),
    warnings
  };
}

export function getHexAgentEconomyContext(input: GetHexAgentEconomyContextInput): HexAgentEconomyContext | undefined {
  return input.economyContext.agents.find((agent) => agent.agentId === input.agentId);
}

export function deriveHexEconomyAllowedActions(input: DeriveHexEconomyAllowedActionsInput): HexAgentActionType[] {
  switch (resourceTierForPosture(input.economyPosture)) {
    case "low":
      return [...baseLowResourceActions];
    case "forced":
      return [...forcedResourceActions];
    case "medium":
      return [...mediumResourceActions];
    case "high":
      return [...highResourceActions];
  }
}

export function summarizeHexEconomyEvidence(input: SummarizeHexEconomyEvidenceInput): HexEconomyCombatEvidence {
  if (!input.economyContext || input.agentIds.length === 0) {
    return emptyEvidence(input.agentIds);
  }
  const contexts = input.agentIds
    .map((agentId) => getHexAgentEconomyContext({ economyContext: input.economyContext!, agentId }))
    .filter((context): context is HexAgentEconomyContext => Boolean(context));
  if (contexts.length === 0) {
    return emptyEvidence(input.agentIds);
  }

  const outputBudgetTotal = contexts.reduce((sum, context) => sum + context.outputBudget, 0);
  const dropReceivedTotal = contexts.reduce((sum, context) => sum + context.dropReceived, 0);
  const reasons: string[] = [];
  let scoreDelta = 0;

  if (contexts.some((context) => context.resourceTier === "high")) {
    scoreDelta += 3;
    reasons.push("economy:high_resource_available");
  }
  if (contexts.some((context) => context.resourceTier === "medium")) {
    scoreDelta += 2;
    reasons.push("economy:medium_resource_available");
  }
  if (contexts.some((context) => context.resourceTier === "low")) {
    reasons.push("economy:low_resource_constraint");
  }
  if (dropReceivedTotal > 0) {
    scoreDelta += 2;
    reasons.push("economy:drop_received_team_coordination");
  }

  return {
    agentIds: [...input.agentIds],
    resourceTiers: unique(contexts.map((context) => context.resourceTier)),
    utilityTiers: unique(contexts.map((context) => context.utilityTier)),
    outputBudgetTotal,
    outputBudgetAverage: roundNumber(outputBudgetTotal / contexts.length),
    dropReceivedTotal,
    scoreDelta: Math.min(5, scoreDelta),
    reasons
  };
}

function buildTeamContext(plan: TeamEconomyPlan): HexTeamEconomyContext {
  return {
    teamId: plan.teamId,
    side: plan.side,
    posture: plan.posture,
    postureReason: plan.postureReason,
    summaryBuyType: plan.summaryBuyType,
    totalCash: plan.totalCash,
    dropDecisions: [...plan.dropDecisions],
    economySummary: `${plan.teamId} ${plan.side} ${plan.posture}/${plan.summaryBuyType} cash=${plan.totalCash}`
  };
}

function buildAgentContext(plan: TeamEconomyPlan, decision: AgentBuyDecision, side: HexSide): HexAgentEconomyContext {
  const resourceTier = resourceTierForPosture(decision.economyPosture);
  const utilityTier = utilityTierForPosture(decision.economyPosture);
  const allowedActionTypes = deriveHexEconomyAllowedActions({
    economyPosture: decision.economyPosture,
    buyType: decision.buyType
  });
  return {
    agentId: decision.agentId,
    teamId: decision.teamId,
    side,
    economyPosture: decision.economyPosture,
    buyType: decision.buyType,
    loadoutPackage: decision.loadoutPackage,
    outputBudget: decision.outputBudget,
    dropSent: decision.dropSent,
    dropReceived: decision.dropReceived,
    resourceTier,
    utilityTier,
    allowedActionTypes,
    constraints: buildAgentEconomyConstraints(decision, resourceTier, utilityTier),
    notes: [
      ...decision.notes,
      `team_posture:${plan.posture}`,
      `resource_tier:${resourceTier}`,
      `utility_tier:${utilityTier}`
    ]
  };
}

function buildAgentEconomyConstraints(decision: AgentBuyDecision, resourceTier: HexResourceTier, utilityTier: HexUtilityTier): string[] {
  const constraints = [
    `economyPosture=${decision.economyPosture}`,
    `buyType=${decision.buyType}`,
    `outputBudget=${decision.outputBudget}`
  ];
  if (resourceTier === "low") {
    constraints.push("Low resource cannot claim a full execute_site without later explicit desperation support.");
  }
  if (utilityTier === "none") {
    constraints.push("No utility tier means use_utility cannot represent a high-utility execute.");
  }
  if (decision.dropReceived > 0) {
    constraints.push(`Drop received before phase start: ${decision.dropReceived}.`);
  }
  return constraints;
}

function resourceTierForPosture(posture: EconomyPosture): HexResourceTier {
  switch (posture) {
    case "full_eco":
    case "eco":
    case "save_play":
      return "low";
    case "force_buy":
    case "light_buy":
    case "pistol_armor_force":
    case "broken_buy":
    case "pistol_round":
      return "forced";
    case "half_buy":
    case "bonus_round":
      return "medium";
    case "rifle_buy":
    case "awp_buy":
    case "double_awp":
      return "high";
  }
}

function utilityTierForPosture(posture: EconomyPosture): HexUtilityTier {
  switch (posture) {
    case "full_eco":
    case "save_play":
      return "none";
    case "eco":
    case "force_buy":
    case "light_buy":
    case "pistol_armor_force":
    case "broken_buy":
    case "pistol_round":
      return "low";
    case "half_buy":
    case "bonus_round":
      return "medium";
    case "rifle_buy":
    case "awp_buy":
    case "double_awp":
      return "high";
  }
}

function emptyEvidence(agentIds: string[]): HexEconomyCombatEvidence {
  return {
    agentIds: [...agentIds],
    resourceTiers: [],
    utilityTiers: [],
    outputBudgetTotal: 0,
    outputBudgetAverage: 0,
    dropReceivedTotal: 0,
    scoreDelta: 0,
    reasons: []
  };
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function roundNumber(value: number): number {
  return Number(value.toFixed(4));
}
