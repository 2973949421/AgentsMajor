import type { Agent, Team } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import {
  buildFixtureHexRoundBusinessDuel,
  buildHexRoundBusinessDuel,
  type HexBusinessTeamMaterialSummary,
  getHexAgentBusinessAssignment,
  getHexRoundBusinessSubtheme,
  validateHexRoundBusinessDuel
} from "./hex-round-business-duel.js";

describe("Hex round business duel", () => {
  it("maps six subthemes across both halves with mirrored rounds", () => {
    expect(getHexRoundBusinessSubtheme({ roundNumber: 1 })).toMatchObject({
      halfIndex: 0,
      roundInHalf: 1,
      mirrorRoundNumber: 7,
      overtimeUnsupported: false,
      subtheme: { subthemeId: "dust2_business_subtheme_1" }
    });
    expect(getHexRoundBusinessSubtheme({ roundNumber: 6 })).toMatchObject({
      halfIndex: 0,
      roundInHalf: 6,
      mirrorRoundNumber: 12,
      subtheme: { subthemeId: "dust2_business_subtheme_6" }
    });
    expect(getHexRoundBusinessSubtheme({ roundNumber: 7 })).toMatchObject({
      halfIndex: 1,
      roundInHalf: 1,
      mirrorRoundNumber: 1,
      subtheme: { subthemeId: "dust2_business_subtheme_1" }
    });
    expect(getHexRoundBusinessSubtheme({ roundNumber: 12 })).toMatchObject({
      halfIndex: 1,
      roundInHalf: 6,
      mirrorRoundNumber: 6,
      subtheme: { subthemeId: "dust2_business_subtheme_6" }
    });
  });

  it("marks overtime as unsupported without inventing a seventh formal subtheme", () => {
    const result = getHexRoundBusinessSubtheme({ roundNumber: 13 });

    expect(result.overtimeUnsupported).toBe(true);
    expect(result.subtheme.subthemeId).toBe("dust2_business_subtheme_1");
  });

  it("builds proof and challenge from the current attack and defense teams", () => {
    const roundOne = buildHexRoundBusinessDuel({
      roundNumber: 1,
      attack: { team: team("team_a", "Team A"), agents: agents("team_a", "a", "attack"), materialSummary: proposal("proposal_a", "A thesis") },
      defense: { team: team("team_b", "Team B"), agents: agents("team_b", "b", "defense"), materialSummary: proposal("proposal_b", "B thesis") },
      teamEconomyPlans: {
        team_a: { posture: "rifle_buy", summaryBuyType: "fullBuy" },
        team_b: { posture: "eco", summaryBuyType: "eco" }
      }
    });
    const mirrored = buildHexRoundBusinessDuel({
      roundNumber: 7,
      attack: { team: team("team_b", "Team B"), agents: agents("team_b", "b", "attack"), materialSummary: proposal("proposal_b", "B thesis") },
      defense: { team: team("team_a", "Team A"), agents: agents("team_a", "a", "defense"), materialSummary: proposal("proposal_a", "A thesis") }
    });

    expect(roundOne.subtheme.subthemeId).toBe(mirrored.subtheme.subthemeId);
    expect(roundOne.attackTeamId).toBe("team_a");
    expect(roundOne.defenseTeamId).toBe("team_b");
    expect(mirrored.attackTeamId).toBe("team_b");
    expect(mirrored.defenseTeamId).toBe("team_a");
    expect(roundOne.defenseProof.teamId).toBe("team_b");
    expect(mirrored.defenseProof.teamId).toBe("team_a");
    expect(roundOne.attackChallenge.teamId).toBe("team_a");
    expect(mirrored.attackChallenge.teamId).toBe("team_b");
    expect(roundOne.agentAssignments).toHaveLength(10);
    expect(getHexAgentBusinessAssignment({ businessDuel: roundOne, agentId: "a_0" })?.linkedChallengeId).toBe(roundOne.attackChallenge.challengeId);
    expect(getHexAgentBusinessAssignment({ businessDuel: roundOne, agentId: "b_0" })?.linkedProofId).toBe(roundOne.defenseProof.proofId);
  });

  it("fails on missing material instead of fabricating proof and challenge", () => {
    expect(() => buildHexRoundBusinessDuel({
      roundNumber: 1,
      attack: { team: team("team_a", "Unknown A"), agents: agents("team_a", "a", "attack") },
      defense: { team: team("team_b", "Unknown B"), agents: agents("team_b", "b", "defense") },
      workspaceRoot: "B:/definitely_missing_workspace"
    })).toThrow(/hex_business_duel_missing_material/);
  });

  it("rejects garbled business text and broken assignment links", () => {
    const duel = buildFixtureHexRoundBusinessDuel({
      roundNumber: 1,
      attackTeamId: "team_a",
      defenseTeamId: "team_b",
      agents: [
        { agentId: "a_0", teamId: "team_a", side: "attack" },
        { agentId: "b_0", teamId: "team_b", side: "defense" }
      ]
    });

    expect(() => validateHexRoundBusinessDuel({
      ...duel,
      defenseProof: {
        ...duel.defenseProof,
        thesis: "Ã¥Â®Âˆ方乱码"
      }
    })).toThrow(/garbled/);
    expect(() => validateHexRoundBusinessDuel({
      ...duel,
      agentAssignments: [{
        ...duel.agentAssignments[0]!,
        linkedChallengeId: "wrong_challenge"
      }]
    })).toThrow(/attack_assignment_link/);
  });
});

function team(id: string, shortName: string): Team {
  return {
    id,
    tournamentId: "tournament_test",
    displayName: shortName,
    shortName,
    seed: 1,
    createdAt: "2026-01-01T00:00:00.000Z"
  };
}

function agents(teamId: string, prefix: string, side: "attack" | "defense"): Agent[] {
  return Array.from({ length: 5 }, (_, index) => ({
    id: `${prefix}_${index}`,
    teamId,
    driverModelId: "driver_test",
    role: index === 0 ? "igl" : index === 1 ? "entry" : index === 2 ? "awper" : index === 3 ? "star_rifler" : "support",
    secondaryRoles: [],
    displayName: `${prefix.toUpperCase()}${index}`,
    baseProfile: {
      personalitySummary: "test",
      tacticalSummary: "test",
      styleTags: ["test"]
    },
    roleProfile: {
      sourcePath: "test",
      sourceTeamName: teamId,
      memberType: "player",
      rawPosition: side,
      rawPositionParts: [side],
      primaryRole: index === 0 ? "igl" : index === 1 ? "entry" : index === 2 ? "awper" : index === 3 ? "star_rifler" : "support",
      secondaryRoles: [],
      positionTags: [],
      confidence: "high",
      agentMajorResponsibilities: [`${prefix}_${index} responsibility`]
    },
    currentState: "ready",
    createdAt: "2026-01-01T00:00:00.000Z"
  }));
}

function proposal(proposalId: string, thesis: string): HexBusinessTeamMaterialSummary {
  return {
    proposalId,
    version: "test",
    teamThesis: thesis,
    opportunity: "opportunity",
    product: "product",
    engineering: "engineering",
    business: "business",
    operations: "operations",
    scaling: "scaling",
    moat: "moat",
    mustHoldClaims: ["claim one", "claim two", "claim three"],
    failureModes: ["failure one", "failure two", "failure three"],
    playerOperatingPrinciples: ["IGL：set direction", "Entry：open space", "AWPer：hold evidence"],
    frontendSummary: "summary"
  };
}
