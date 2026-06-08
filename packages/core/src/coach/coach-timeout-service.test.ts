import type { Agent, MapGame, Match, Team } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import {
  resolveCoachTimeoutIfNeeded,
  type CoachServiceContext,
  type CoachServiceDependencies
} from "./coach-timeout-service.js";

describe("coach timeout service", () => {
  it("respects token bank, cooldown, and minimum round gates before calling LLM", async () => {
    const stageCalls: string[] = [];
    const base = {
      dependencies: dependencies(),
      match: { id: "match_1", teamAId: "team_a", teamBId: "team_b" } as Match,
      mapGame: { id: "map_1", mapName: "dust2" } as MapGame,
      round: { id: "round_5" } as never,
      observabilityAttempt: 1,
      scoreBeforeRound: { teamA: 1, teamB: 4 },
      teamA: { id: "team_a", displayName: "Team A" } as Team,
      teamB: { id: "team_b", displayName: "Team B" } as Team,
      activeA: [agent("agent_a1")],
      activeB: [agent("agent_b1")]
    };

    const lowBank = await resolveCoachTimeoutIfNeeded({
      ...base,
      context: context({ tokenBank: 1000, stageCalls }),
      roundNumber: 6,
      recentRoundReports: [loss(4), loss(5)]
    });
    const cooldown = await resolveCoachTimeoutIfNeeded({
      ...base,
      context: context({ tokenBank: 5000, lastTimeoutRoundNumber: 4, stageCalls }),
      roundNumber: 6,
      recentRoundReports: [loss(4), loss(5)]
    });
    const earlyRound = await resolveCoachTimeoutIfNeeded({
      ...base,
      context: context({ tokenBank: 5000, stageCalls }),
      roundNumber: 4,
      recentRoundReports: [loss(2), loss(3)]
    });

    expect(lowBank).toBeUndefined();
    expect(cooldown).toBeUndefined();
    expect(earlyRound).toBeUndefined();
    expect(stageCalls).toEqual([]);
  });
});

function context(input: { tokenBank: number; lastTimeoutRoundNumber?: number; stageCalls: string[] }): CoachServiceContext {
  return ({
    repositories: {
      teamMapCoachStates: {
        getByMapGameAndTeam: async () => ({
          mapGameId: "map_1",
          teamId: "team_b",
          timeoutsRemaining: 1,
          tokenBank: input.tokenBank,
          lastTimeoutRoundNumber: input.lastTimeoutRoundNumber,
          updatedAt: "now"
        })
      }
    },
    useLlmCoachTimeouts: true,
    stageRunner: {
      runStructuredStage: async () => {
        input.stageCalls.push("called");
        throw new Error("LLM should not be called by gate tests.");
      }
    },
    appendEvent: async (event: never) => event
  } as unknown) as CoachServiceContext;
}

function dependencies(): CoachServiceDependencies {
  return {
    readApprovedTeamMemoryOverlay: async () => undefined,
    readMapSemanticContext: () => undefined,
    readJudgeRubricContext: () => undefined,
    readTeamInitialProposal: () => undefined,
    readTeamCoachContext: () => undefined,
    sortAgentsForRound: (agents: Agent[]) => agents
  };
}

function loss(roundNumber: number) {
  return {
    roundId: `round_${roundNumber}`,
    roundNumber,
    winnerTeamId: "team_a",
    summary: `round ${roundNumber}`,
    judgeResult: {
      margin: "standard",
      diagnostic: {}
    }
  } as never;
}

function agent(id: string): Agent {
  return {
    id,
    teamId: id.includes("_a") ? "team_a" : "team_b",
    driverModelId: "driver_test",
    role: "rifler",
    displayName: id,
    baseProfile: {},
    currentState: "ready",
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z"
  } as Agent;
}
