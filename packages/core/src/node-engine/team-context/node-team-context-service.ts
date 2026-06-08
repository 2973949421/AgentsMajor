import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  teamInitialProposalSchema,
  type Agent,
  type AgentPhaseActionType,
  type Team,
  type TeamInitialProposal
} from "@agent-major/shared";

import { resolveProjectRootForNodeGraph } from "../graph/node-graph-service.js";

export interface NodeTeamContext {
  teamId: string;
  teamDisplayName: string;
  teamSlug?: string;
  teamSummary: string;
  teamThesis: string;
  mustHoldClaims: string[];
  playerOperatingPrinciples: string[];
  coachPolicies: NodeCoachContext;
  agentContextsById: Record<string, NodeAgentRoleContext>;
  roleActionPreferences: Record<string, AgentPhaseActionType[]>;
  source: "runtime" | "material" | "fallback";
  notes: string[];
}

export interface NodeCoachContext {
  timeout: string;
  postMatchReview: string;
  coachNote: string;
}

export interface NodeAgentRoleContext {
  agentId: string;
  displayName: string;
  role: string;
  secondaryRoles: string[];
  roleResponsibilities: string[];
  roleActionBias: AgentPhaseActionType[];
  teamThesisAnchor: string;
  businessOperatingPrinciple: string;
  coachNote: string;
}

export interface BuildNodeTeamContextsInput {
  teams: Team[];
  agents: Agent[];
  rootDir?: string;
}

export interface BuildNodeTeamContextInput {
  team: Team;
  agents: Agent[];
  rootDir?: string;
}

const defaultCoachPolicies: NodeCoachContext = {
  timeout: "Keep the team on the agreed plan and correct role drift.",
  postMatchReview: "Review whether the role split and business thesis survived pressure.",
  coachNote: "Coach context unavailable; use compact runtime role discipline."
};

export function buildNodeTeamContexts(input: BuildNodeTeamContextsInput): Record<string, NodeTeamContext> {
  return Object.fromEntries(
    input.teams.map((team) => [
      team.id,
      buildNodeTeamContext({
        team,
        agents: input.agents.filter((agent) => agent.teamId === team.id),
        ...(input.rootDir ? { rootDir: input.rootDir } : {})
      })
    ])
  );
}

export function buildNodeTeamContext(input: BuildNodeTeamContextInput): NodeTeamContext {
  const runtimeProposal = readRuntimeProposal(input.team);
  const materialProposal = runtimeProposal ? undefined : loadTeamInitialProposal(input.team, input.rootDir);
  const proposal = runtimeProposal ?? materialProposal;
  const source: NodeTeamContext["source"] = runtimeProposal ? "runtime" : materialProposal ? "material" : "fallback";
  const teamThesis = proposal?.teamThesis ?? `${input.team.displayName} validates its plan through role-disciplined node actions.`;
  const mustHoldClaims = proposal?.mustHoldClaims?.filter(Boolean) ?? [];
  const playerOperatingPrinciples = proposal?.playerOperatingPrinciples?.filter(Boolean) ?? [];
  const coachPolicies: NodeCoachContext = proposal
    ? {
        timeout: proposal.coachWindowPolicies.timeout,
        postMatchReview: proposal.coachWindowPolicies.postMatchReview,
        coachNote: compactText(`${proposal.coachWindowPolicies.timeout} ${proposal.coachWindowPolicies.postMatchReview}`, 240)
      }
    : defaultCoachPolicies;
  const roleActionPreferences = buildRoleActionPreferences();
  const teamThesisAnchor = mustHoldClaims[0] ?? teamThesis;

  const agentContextsById = Object.fromEntries(
    input.agents.map((agent) => {
      const roleActionBias = roleActionBiasForAgent(agent);
      const roleResponsibilities = readRoleResponsibilities(agent);
      const businessOperatingPrinciple =
        findOperatingPrinciple(playerOperatingPrinciples, agent.role) ??
        compactText(`${agent.role} must make the team thesis concrete: ${teamThesisAnchor}`, 220);
      const context: NodeAgentRoleContext = {
        agentId: agent.id,
        displayName: agent.displayName,
        role: agent.role,
        secondaryRoles: [...(agent.secondaryRoles ?? [])],
        roleResponsibilities,
        roleActionBias,
        teamThesisAnchor: compactText(teamThesisAnchor, 220),
        businessOperatingPrinciple: compactText(businessOperatingPrinciple, 260),
        coachNote: coachPolicies.coachNote
      };
      return [agent.id, context] as const;
    })
  );

  return {
    teamId: input.team.id,
    teamDisplayName: input.team.displayName || input.team.shortName || input.team.id,
    ...(proposal?.teamSlug ? { teamSlug: proposal.teamSlug } : input.team.teamProfileId ? { teamSlug: input.team.teamProfileId } : {}),
    teamSummary: proposal?.frontendSummary ?? `${input.team.displayName} node-round context generated from runtime roles.`,
    teamThesis,
    mustHoldClaims,
    playerOperatingPrinciples,
    coachPolicies,
    agentContextsById,
    roleActionPreferences,
    source,
    notes: [
      source === "fallback" ? "node_team_context_fallback:no_initial_proposal" : `node_team_context_source:${source}`,
      "Role preferences only rank legal actions; AP, economy, graph reachability, and validators remain authoritative."
    ]
  };
}

export function getNodeAgentRoleContext(
  teamContexts: Record<string, NodeTeamContext> | undefined,
  agentId: string,
  teamId?: string
): NodeAgentRoleContext | undefined {
  if (!teamContexts) {
    return undefined;
  }
  if (teamId && teamContexts[teamId]?.agentContextsById[agentId]) {
    return teamContexts[teamId]!.agentContextsById[agentId];
  }
  return Object.values(teamContexts)
    .map((context) => context.agentContextsById[agentId])
    .find((context): context is NodeAgentRoleContext => Boolean(context));
}

export function roleActionBiasForAgent(agent: Pick<Agent, "role" | "secondaryRoles">): AgentPhaseActionType[] {
  return roleActionBiasForRole(agent.role, agent.secondaryRoles ?? []);
}

export function roleActionBiasForRole(role: string, secondaryRoles: string[] = []): AgentPhaseActionType[] {
  const normalized = normalizeRole(role, secondaryRoles);
  switch (normalized) {
    case "igl":
      return ["rotate", "map_control", "prepare_trade", "watch_angle", "hold_position"];
    case "entry":
      return ["gather_info", "seek_duel", "execute_site", "map_control", "prepare_trade"];
    case "awper":
      return ["watch_angle", "map_control", "hold_position", "gather_info"];
    case "star_rifler":
      return ["map_control", "seek_duel", "execute_site", "prepare_trade", "use_utility"];
    case "support":
      return ["use_utility", "prepare_trade", "watch_angle", "map_control", "hold_position"];
    case "anchor":
      return ["hold_position", "watch_angle", "save", "prepare_trade"];
    case "lurker":
      return ["map_control", "gather_info", "fake_pressure", "watch_angle"];
    default:
      return ["map_control", "gather_info", "watch_angle", "hold_position"];
  }
}

function buildRoleActionPreferences(): Record<string, AgentPhaseActionType[]> {
  return Object.fromEntries(
    ["igl", "entry", "awper", "star_rifler", "support", "anchor", "lurker", "rifler"].map((role) => [role, roleActionBiasForRole(role)])
  );
}

function normalizeRole(role: string, secondaryRoles: string[]): string {
  if (role === "support" || secondaryRoles.includes("support")) {
    return "support";
  }
  if (secondaryRoles.includes("anchor")) {
    return "anchor";
  }
  if (role === "rifler" && secondaryRoles.includes("star_rifler")) {
    return "star_rifler";
  }
  return role;
}

function readRuntimeProposal(team: Team): TeamInitialProposal | undefined {
  const source = team.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return undefined;
  }
  const record = source as Record<string, unknown>;
  const candidate = record.initialProposal ?? record.initial_proposal ?? record.proposal;
  const parsed = teamInitialProposalSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function loadTeamInitialProposal(team: Team, rootDir?: string): TeamInitialProposal | undefined {
  const projectRoot = resolveProjectRootForNodeGraph(rootDir ?? process.cwd());
  const teamsDir = join(projectRoot, "data", "materials", "processed", "teams");
  const candidateSlugs = uniqueSorted([
    team.teamProfileId ?? "",
    team.id,
    team.id.replace(/^team_/, "").replace(/_/g, "-"),
    team.shortName.toLowerCase(),
    team.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  ]);

  for (const slug of candidateSlugs) {
    const proposal = readProposalFile(join(teamsDir, slug, "initial-proposal.json"));
    if (proposal && proposalMatchesTeam(proposal, team)) {
      return proposal;
    }
  }

  if (!existsSync(teamsDir)) {
    return undefined;
  }
  for (const entry of readdirSync(teamsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const proposal = readProposalFile(join(teamsDir, entry.name, "initial-proposal.json"));
    if (proposal && proposalMatchesTeam(proposal, team)) {
      return proposal;
    }
  }
  return undefined;
}

function proposalMatchesTeam(proposal: TeamInitialProposal, team: Team): boolean {
  const proposalIds = new Set([
    proposal.teamId,
    proposal.teamSlug,
    normalizeId(proposal.teamId),
    normalizeId(proposal.teamSlug),
    normalizeId(proposal.displayName)
  ]);
  const teamIds = [
    team.id,
    normalizeId(team.id),
    normalizeId(team.shortName),
    normalizeId(team.displayName),
    team.teamProfileId ?? "",
    team.teamProfileId ? normalizeId(team.teamProfileId) : ""
  ].filter((value) => value.length > 0);
  return teamIds.some((candidate) => proposalIds.has(candidate));
}

function readProposalFile(filePath: string): TeamInitialProposal | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }
  try {
    const parsed = teamInitialProposalSchema.safeParse(JSON.parse(readFileSync(filePath, "utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function readRoleResponsibilities(agent: Agent): string[] {
  const responsibilities = agent.roleProfile?.agentMajorResponsibilities?.filter(Boolean) ?? [];
  if (responsibilities.length > 0) {
    return responsibilities.slice(0, 3);
  }
  const fallback = [
    typeof agent.baseProfile?.tacticalSummary === "string" ? agent.baseProfile.tacticalSummary : "",
    typeof agent.baseProfile?.personalitySummary === "string" ? agent.baseProfile.personalitySummary : ""
  ].filter((value) => value.length > 0);
  return fallback.length > 0 ? fallback.slice(0, 2) : [`${agent.role} maintains role discipline under node/AP constraints.`];
}

function findOperatingPrinciple(principles: string[], role: string): string | undefined {
  const labels = roleLabels(role);
  return principles.find((principle) => labels.some((label) => principle.toLowerCase().includes(label.toLowerCase())));
}

function roleLabels(role: string): string[] {
  switch (role) {
    case "igl":
      return ["igl", "caller", "指挥"];
    case "entry":
      return ["entry", "先手"];
    case "awper":
      return ["awp", "awper", "sniper"];
    case "star_rifler":
      return ["star", "rifler", "明星"];
    case "support":
      return ["support", "anchor", "辅助"];
    case "lurker":
      return ["lurker", "侧翼"];
    default:
      return [role];
  }
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
}

function normalizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}
