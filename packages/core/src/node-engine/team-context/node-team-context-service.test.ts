import type { Agent, Team, TeamInitialProposal } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import {
  buildNodeTeamContext,
  buildNodeTeamContexts,
  roleActionBiasForRole
} from "./node-team-context-service.js";

describe("NodeTeamContextService", () => {
  it("loads compact team thesis and coach policy from processed initial proposal", () => {
    const team = teamFixture({ id: "team_falcon_7b", displayName: "Falcon-7B", shortName: "Falcon" });
    const agents = [
      agentFixture({ id: "agent_karrigan", teamId: team.id, role: "igl" }),
      agentFixture({ id: "agent_monesy", teamId: team.id, role: "awper" })
    ];

    const context = buildNodeTeamContext({ team, agents, rootDir: process.cwd() });

    expect(context.source).toBe("material");
    expect(context.teamThesis.length).toBeGreaterThan(0);
    expect(context.mustHoldClaims.length).toBeGreaterThan(0);
    expect(context.coachPolicies.timeout.length).toBeGreaterThan(0);
    expect(context.agentContextsById.agent_karrigan?.roleActionBias).toContain("rotate");
    expect(context.agentContextsById.agent_monesy?.roleActionBias).toContain("watch_angle");
  });

  it("uses runtime proposal before material fallback", () => {
    const proposal = proposalFixture("team_runtime");
    const team = teamFixture({
      id: "team_runtime",
      displayName: "Runtime",
      shortName: "RUN",
      source: { initialProposal: proposal }
    });
    const context = buildNodeTeamContexts({
      teams: [team],
      agents: [agentFixture({ id: "runtime_igl", teamId: team.id, role: "igl" })],
      rootDir: process.cwd()
    })[team.id]!;

    expect(context.source).toBe("runtime");
    expect(context.teamThesis).toBe(proposal.teamThesis);
    expect(context.agentContextsById.runtime_igl?.businessOperatingPrinciple).toContain("IGL");
  });

  it("falls back to runtime role context when no proposal exists", () => {
    const team = teamFixture({ id: "team_missing_context", displayName: "Missing", shortName: "MISS" });
    const context = buildNodeTeamContext({
      team,
      agents: [agentFixture({ id: "missing_entry", teamId: team.id, role: "entry" })],
      rootDir: process.cwd()
    });

    expect(context.source).toBe("fallback");
    expect(context.agentContextsById.missing_entry?.roleResponsibilities[0]).toContain("entry");
    expect(context.agentContextsById.missing_entry?.roleActionBias).toContain("gather_info");
  });

  it("maps core CS roles to action preferences without bypassing validators", () => {
    expect(roleActionBiasForRole("igl")).toEqual(expect.arrayContaining(["rotate", "map_control", "prepare_trade"]));
    expect(roleActionBiasForRole("entry")).toEqual(expect.arrayContaining(["gather_info", "seek_duel", "execute_site"]));
    expect(roleActionBiasForRole("awper")).toEqual(expect.arrayContaining(["watch_angle", "map_control"]));
    expect(roleActionBiasForRole("support")).toEqual(expect.arrayContaining(["use_utility", "prepare_trade"]));
    expect(roleActionBiasForRole("rifler", ["anchor"])).toEqual(expect.arrayContaining(["hold_position", "save"]));
  });
});

function teamFixture(input: {
  id: string;
  displayName: string;
  shortName: string;
  source?: unknown;
}): Team {
  return {
    id: input.id,
    tournamentId: "tournament_test",
    displayName: input.displayName,
    shortName: input.shortName,
    seed: 1,
    ...(input.source ? { source: input.source } : {}),
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z"
  };
}

function agentFixture(input: { id: string; teamId: string; role: Agent["role"] }): Agent {
  return {
    id: input.id,
    teamId: input.teamId,
    driverModelId: "driver_test",
    role: input.role,
    displayName: input.id,
    baseProfile: {
      personalitySummary: `${input.role} personality`,
      tacticalSummary: `${input.role} tactical baseline`,
      styleTags: [input.role]
    },
    currentState: "ready",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z"
  };
}

function proposalFixture(teamId: string): TeamInitialProposal {
  return {
    proposalId: `proposal_${teamId}`,
    version: "test",
    teamId,
    teamSlug: teamId.replace(/^team_/, ""),
    displayName: teamId,
    teamThesis: "Runtime team thesis: prove the wedge with role discipline.",
    opportunity: "Runtime opportunity",
    product: "Runtime product",
    engineering: "Runtime engineering",
    business: "Runtime business",
    operations: "Runtime operations",
    scaling: "Runtime scaling",
    moat: "Runtime moat",
    mustHoldClaims: ["Runtime must hold claim"],
    failureModes: ["Runtime failure mode"],
    playerOperatingPrinciples: ["IGL: keep priority, allocation, and closure aligned."],
    coachWindowPolicies: {
      timeout: "Runtime timeout policy",
      postMatchReview: "Runtime review policy"
    },
    frontendSummary: "Runtime frontend summary"
  };
}
