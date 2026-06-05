import {
  teamInitialProposalSchema,
  teamInitialProposalSummarySchema,
  teamProposalAnchorSchema,
  type Agent,
  type BuyType,
  type CoachTimeoutCorrection,
  type EconomyState,
  type MapGame,
  type Round,
  type ScorePair,
  type SideAssignment,
  type Team,
  type TeamInitialProposal,
  type TeamInitialProposalSummary,
  type TeamProposalAnchor
} from "@agent-major/shared";

import {
  resolveRoundEconomyPhase,
  sumEconomyByTeam,
  type TeamEconomyPlan
} from "./economy-output-service.js";
import type { RuleBasedTacticalPlans } from "./tactical-protocol.js";

export interface Phase18SemanticContextSource {
  phase18MapSemanticsByMapName?: Record<string, Record<string, unknown>>;
}

export function readPhase18MapSemanticContext(
  context: Phase18SemanticContextSource,
  mapName: string
): Record<string, unknown> | undefined {
  return readUnknownRecord(context.phase18MapSemanticsByMapName?.[mapName.toUpperCase()]);
}

export function readPhase18JudgeRubricContext(
  context: Phase18SemanticContextSource,
  mapName: string
): Record<string, unknown> | undefined {
  const mapSemantic = readPhase18MapSemanticContext(context, mapName);
  return readUnknownRecord(mapSemantic?.judgeRubric);
}

export function readTeamMaterialInitialProposal(team: Team): TeamInitialProposal | undefined {
  const source = readUnknownRecord(team.source);
  const parsed = teamInitialProposalSchema.safeParse(source?.materialInitialProposal);
  return parsed.success ? parsed.data : undefined;
}

export function readTeamHeadCoachProfile(team: Team): Record<string, unknown> | undefined {
  const source = readUnknownRecord(team.source);
  return readUnknownRecord(source?.headCoachProfile);
}

export function buildCompactTeamPlanRequestInput(input: {
  context: Phase18SemanticContextSource;
  round: Round;
  mapGame: MapGame;
  team: Team;
  opponent: Team;
  activeAgents: Agent[];
  side: "attack" | "defense";
  sideAssignment: SideAssignment;
  scoreBeforeRound: ScorePair;
  buyType: BuyType;
  teamEconomyPlan?: TeamEconomyPlan | undefined;
  beforeEconomy: EconomyState[];
  tacticalHint?: RuleBasedTacticalPlans["attackPlan"] | RuleBasedTacticalPlans["defenseDeployment"] | undefined;
  recentPublicRoundSummaries: string[];
  competitiveParityNote: string;
  teamMemoryOverlay?: unknown;
  coachCorrection?: CoachTimeoutCorrection | undefined;
}): Record<string, unknown> {
  const mapSemanticContext = compactMapSemanticContext(readPhase18MapSemanticContext(input.context, input.mapGame.mapName));
  const judgeRubricContext = compactJudgeRubricContext(readPhase18JudgeRubricContext(input.context, input.mapGame.mapName));
  const initialProposal = compactTeamInitialProposal(readTeamMaterialInitialProposal(input.team));
  const coachContext = compactCoachContext(readTeamHeadCoachProfile(input.team));
  const economyPlan = input.teamEconomyPlan;

  return removeUndefined({
    objective: "Create one coherent team plan for this round. Every player action will be generated from this plan.",
    roundId: input.round.id,
    roundNumber: input.round.roundNumber,
    mapName: input.mapGame.mapName,
    mapSemanticContext,
    judgeRubricContext,
    teamId: input.team.id,
    teamName: input.team.displayName,
    initialProposal,
    coachContext,
    teamMemoryOverlay: compactTeamMemoryOverlay(input.teamMemoryOverlay),
    opponentTeamId: input.opponent.id,
    opponentTeamName: input.opponent.displayName,
    side: input.side,
    sideAssignment: input.sideAssignment,
    scoreBeforeRound: input.scoreBeforeRound,
    buyType: input.buyType,
    economyPosture: economyPlan?.posture ?? "eco",
    roundEconomyPhase: economyPlan?.phase ?? resolveRoundEconomyPhase(input.round.roundNumber),
    economyPostureReason: truncatePromptText(economyPlan?.postureReason ?? "默认经济态势。", 120),
    teamLossCount: economyPlan?.lossCount ?? 1,
    teamEconomy: sumEconomyByTeam(input.beforeEconomy, input.team.id),
    allowedAgentIds: input.activeAgents.map((agent) => agent.id),
    activeAgents: input.activeAgents.map((agent) => {
      const decision = economyPlan?.decisions.find((entry) => entry.agentId === agent.id);
      return removeUndefined({
        id: agent.id,
        displayName: agent.displayName,
        role: agent.role,
        secondaryRoles: (agent.secondaryRoles ?? []).slice(0, 2),
        roleResponsibilities: (agent.roleProfile?.agentMajorResponsibilities ?? []).slice(0, 3).map((entry) => truncatePromptText(entry, 90)),
        profileSummary: compactAgentProfile(agent),
        tokenBank: input.beforeEconomy.find((state) => state.agentId === agent.id)?.tokenBank ?? 0,
        currentBuyType: decision?.buyType ?? "eco",
        currentPosture: decision?.economyPosture ?? "eco",
        loadoutPackage: decision?.loadoutPackage ?? "pistol_eco_pack"
      });
    }),
    dropPlan: (economyPlan?.dropDecisions ?? []).slice(0, 3).map((decision) => ({
      fromAgentId: decision.fromAgentId,
      toAgentId: decision.toAgentId,
      amount: decision.amount,
      reason: truncatePromptText(decision.reason, 80)
    })),
    competitiveParityNote: truncatePromptText(input.competitiveParityNote, 180),
    tacticalHint: compactTacticalHint(input.tacticalHint),
    recentPublicRoundSummaries: input.recentPublicRoundSummaries.slice(-2).map((summary) => truncatePromptText(summary, 160)),
    finalOutputRules: [
      "playerDirectives[].agentId must be copied exactly from allowedAgentIds.",
      "Do not output player1/player2/agent1/role names/display names as agentId.",
      "Keep each directive to one concise Chinese sentence."
    ],
    ...(input.coachCorrection ? { coachCorrection: compactCoachCorrection(input.coachCorrection) } : {})
  });
}

export function compactMapSemanticContext(context: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!context) {
    return undefined;
  }
  const proposition = readUnknownRecord(context.proposition);
  const displayZoneNames = readUnknownRecord(proposition?.displayZoneNames);
  return removeUndefined({
    proposition: removeUndefined({
      mapTheme: pickString(proposition, "mapTheme"),
      coreQuestion: truncatePromptText(pickString(proposition, "coreQuestion"), 180),
      attackFocus: pickStringArray(proposition, "attackFocus").slice(0, 4),
      defenseFocus: pickStringArray(proposition, "defenseFocus").slice(0, 4),
      regulationRoundThemes: compactRoundThemes(proposition?.regulationRoundThemes),
      overtimeRoundThemes: compactRoundThemes(proposition?.overtimeRoundThemes),
      displayZoneNames: displayZoneNames
        ? Object.fromEntries(Object.entries(displayZoneNames).filter(([, value]) => typeof value === "string").slice(0, 8))
        : undefined
    })
  });
}

export function compactJudgeRubricContext(context: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!context) {
    return undefined;
  }
  return removeUndefined({
    coreJudgmentAxis: pickString(context, "coreJudgmentAxis"),
    reasonMustCover: pickStringArray(context, "reasonMustCover").slice(0, 4),
    biasGuardrails: pickStringArray(context, "biasGuardrails").slice(0, 4)
  });
}

export function stripJudgePrestigeFields(value: unknown): Record<string, unknown> | undefined {
  const record = readUnknownRecord(value);
  if (!record) {
    return undefined;
  }
  const blockedFields = new Set(["frontendSummary", "personaSummary", "seedLabel", "powerRanking", "starPower"]);
  return Object.fromEntries(
    Object.entries(record).filter(([key, item]) => {
      if (blockedFields.has(key)) {
        return false;
      }
      if (typeof item === "string" && /(头号种子|明星阵容|豪门|超级明星|顶级强队|夺冠热门)/.test(item)) {
        return false;
      }
      return true;
    })
  );
}

export function readTeamInitialProposalSummary(team: Team): TeamInitialProposalSummary | undefined {
  const initialProposal = readTeamMaterialInitialProposal(team);
  if (!initialProposal) {
    return undefined;
  }

  return teamInitialProposalSummarySchema.parse({
    proposalId: initialProposal.proposalId,
    version: initialProposal.version,
    teamThesis: initialProposal.teamThesis,
    opportunity: initialProposal.opportunity,
    product: initialProposal.product,
    engineering: initialProposal.engineering,
    business: initialProposal.business,
    operations: initialProposal.operations,
    scaling: initialProposal.scaling,
    moat: initialProposal.moat,
    mustHoldClaims: initialProposal.mustHoldClaims,
    failureModes: initialProposal.failureModes,
    frontendSummary: initialProposal.frontendSummary
  });
}

export function readTeamProposalAnchor(team: Team, agent: Agent): TeamProposalAnchor | undefined {
  const initialProposal = readTeamMaterialInitialProposal(team);
  if (!initialProposal) {
    return undefined;
  }

  const playerOperatingPrinciples = pickProposalOperatingPrinciples(initialProposal, agent.role);
  return teamProposalAnchorSchema.parse({
    teamThesis: initialProposal.teamThesis,
    mustHoldClaims: initialProposal.mustHoldClaims,
    playerOperatingPrinciples
  });
}

function compactTeamInitialProposal(proposal: TeamInitialProposal | undefined): Record<string, unknown> | undefined {
  if (!proposal) {
    return undefined;
  }
  return removeUndefined({
    proposalId: proposal.proposalId,
    version: proposal.version,
    teamThesis: truncatePromptText(proposal.teamThesis, 240),
    opportunity: truncatePromptText(proposal.opportunity, 160),
    product: truncatePromptText(proposal.product, 140),
    engineering: truncatePromptText(proposal.engineering, 140),
    business: truncatePromptText(proposal.business, 140),
    operations: truncatePromptText(proposal.operations, 120),
    scaling: truncatePromptText(proposal.scaling, 120),
    moat: truncatePromptText(proposal.moat, 120),
    mustHoldClaims: proposal.mustHoldClaims.slice(0, 3).map((entry) => truncatePromptText(entry, 120)),
    failureModes: proposal.failureModes.slice(0, 3).map((entry) => truncatePromptText(entry, 120)),
    playerOperatingPrinciples: proposal.playerOperatingPrinciples.slice(0, 5).map((entry) => truncatePromptText(entry, 100)),
    frontendSummary: truncatePromptText(proposal.frontendSummary, 180)
  });
}

function compactCoachContext(context: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!context) {
    return undefined;
  }
  return removeUndefined({
    displayName: pickString(context, "displayName"),
    dutySummary: truncatePromptText(pickString(context, "dutySummary"), 140),
    style: truncatePromptText(pickString(context, "style") ?? pickString(context, "coachingStyle"), 100)
  });
}

function compactTeamMemoryOverlay(value: unknown): Record<string, unknown> | undefined {
  const record = readUnknownRecord(value);
  if (!record) {
    return undefined;
  }
  return removeUndefined({
    proposedStrategyPatch: truncatePromptText(pickString(record, "proposedStrategyPatch"), 180),
    timeoutQualityReview: truncatePromptText(pickString(record, "timeoutQualityReview"), 140),
    keptBeliefs: pickStringArray(record, "keptBeliefs").slice(0, 2).map((entry) => truncatePromptText(entry, 90)),
    brokenBeliefs: pickStringArray(record, "brokenBeliefs").slice(0, 2).map((entry) => truncatePromptText(entry, 90))
  });
}

export function compactCoachCorrection(correction: CoachTimeoutCorrection): Record<string, unknown> {
  return removeUndefined({
    teamId: correction.teamId,
    triggerRoundNumber: correction.triggerRoundNumber,
    nextRoundObjective: truncatePromptText(correction.nextRoundObjective, 140),
    ownCoreToHold: truncatePromptText(correction.ownCoreToHold, 120),
    opponentGapToHit: truncatePromptText(correction.opponentGapToHit, 120),
    zonePriorityShift: truncatePromptText(correction.zonePriorityShift, 120),
    teamDirective: truncatePromptText(correction.teamDirective, 140),
    playerAdjustments: correction.playerAdjustments.map((entry) => ({
      agentId: entry.agentId,
      adjustment: truncatePromptText(entry.adjustment, 90)
    }))
  });
}

function compactTacticalHint(value: unknown): Record<string, unknown> | undefined {
  const record = readUnknownRecord(value);
  if (!record) {
    return undefined;
  }
  return removeUndefined({
    teamId: pickString(record, "teamId"),
    primaryTargetZoneId: pickString(record, "primaryTargetZoneId"),
    secondaryTargetZoneId: pickString(record, "secondaryTargetZoneId"),
    feintZoneId: pickString(record, "feintZoneId"),
    approach: pickString(record, "approach"),
    setup: pickString(record, "setup"),
    heavyZoneId: pickString(record, "heavyZoneId"),
    weakZoneIds: pickStringArray(record, "weakZoneIds").slice(0, 3),
    rotatePolicy: pickString(record, "rotatePolicy"),
    intentSummary: truncatePromptText(pickString(record, "intentSummary"), 160),
    deploymentSummary: truncatePromptText(pickString(record, "deploymentSummary"), 160)
  });
}

export function compactAgentProfile(agent: Agent): string | undefined {
  const baseProfile = readUnknownRecord(agent.baseProfile);
  const parts = [
    pickString(baseProfile, "summary"),
    pickString(baseProfile, "style"),
    pickString(baseProfile, "strength"),
    pickString(baseProfile, "signature")
  ].filter((entry): entry is string => Boolean(entry));
  return parts.length > 0 ? truncatePromptText(parts.join("；"), 140) : undefined;
}

function compactRoundThemes(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const themes = value
    .map((entry) => readUnknownRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .slice(0, 6)
    .map((entry) =>
      removeUndefined({
        round: pickString(entry, "round"),
        theme: truncatePromptText(pickString(entry, "theme"), 100)
      })
    );
  return themes.length > 0 ? themes : undefined;
}

function pickProposalOperatingPrinciples(initialProposal: TeamInitialProposal, role: Agent["role"]): string[] {
  const roleKeywords = proposalRoleKeywords(role);
  const matched = initialProposal.playerOperatingPrinciples.filter((principle) => {
    const normalized = principle.toLowerCase();
    return roleKeywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
  });
  return matched.length > 0 ? matched : initialProposal.playerOperatingPrinciples.slice(0, 1);
}

function proposalRoleKeywords(role: Agent["role"]): string[] {
  switch (role) {
    case "igl":
      return ["igl", "指挥"];
    case "entry":
      return ["entry", "先手", "打开空间"];
    case "awper":
      return ["awper", "狙击", "scope"];
    case "star_rifler":
      return ["star rifler", "star", "核心输出", "rifler"];
    case "lurker":
      return ["lurker", "侧翼", "隐藏"];
    case "support":
      return ["support", "辅助", "补位"];
    case "rifler":
      return ["rifler", "枪手", "收束", "closeout"];
    case "coach":
      return ["coach", "教练", "暂停", "半场", "复盘"];
    case "stand_in":
      return ["stand-in", "替补", "兜底"];
    default:
      return [role];
  }
}

function readUnknownRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function pickString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function truncatePromptText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function pickStringArray(record: Record<string, unknown> | undefined, key: string): string[] {
  const value = record?.[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [];
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
