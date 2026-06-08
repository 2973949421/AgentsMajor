import type { Agent, CoachTimeoutCorrection, Event, MapGame, Match, Round, Team } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import {
  commitCoachTimeoutUsage,
  ensureCoachStatesForMap,
  resolveCoachTimeoutIfNeeded,
  type CoachServiceContext,
  type CoachServiceDependencies
} from "./coach-service.js";

describe("coach service", () => {
  it("initializes missing coach states once per team", async () => {
    const saved: unknown[] = [];
    const context = buildCoachContext({
      listStates: async () => [],
      saveState: async (state) => {
        saved.push(state);
      }
    });

    await ensureCoachStatesForMap({
      context,
      mapGame: { id: "map_1" } as MapGame,
      match: { id: "match_1", teamAId: "team_a", teamBId: "team_b" } as Match
    });

    expect(saved).toHaveLength(2);
    expect(saved).toEqual([
      expect.objectContaining({ mapGameId: "map_1", teamId: "team_a", timeoutsRemaining: 2 }),
      expect.objectContaining({ mapGameId: "map_1", teamId: "team_b", timeoutsRemaining: 2 })
    ]);
  });

  it("does not recreate existing coach states", async () => {
    const saved: unknown[] = [];
    const context = buildCoachContext({
      listStates: async () => [
        { mapGameId: "map_1", teamId: "team_a", timeoutsRemaining: 2, updatedAt: "now" },
        { mapGameId: "map_1", teamId: "team_b", timeoutsRemaining: 2, updatedAt: "now" }
      ],
      saveState: async (state) => {
        saved.push(state);
      }
    });

    await ensureCoachStatesForMap({
      context,
      mapGame: { id: "map_1" } as MapGame,
      match: { id: "match_1", teamAId: "team_a", teamBId: "team_b" } as Match
    });

    expect(saved).toHaveLength(0);
  });

  it("does not trigger timeout before a previous round exists", async () => {
    const context = buildCoachContext({});
    const result = await resolveCoachTimeoutIfNeeded({
      context,
      dependencies: buildCoachDependencies(),
      match: { id: "match_1", teamAId: "team_a", teamBId: "team_b" } as Match,
      mapGame: { id: "map_1", mapName: "dust2" } as MapGame,
      round: { id: "round_1" } as never,
      observabilityAttempt: 1,
      roundNumber: 5,
      scoreBeforeRound: { teamA: 2, teamB: 2 },
      teamA: { id: "team_a", displayName: "Team A" } as Team,
      teamB: { id: "team_b", displayName: "Team B" } as Team,
      activeA: [],
      activeB: [],
      recentRoundReports: []
    });

    expect(result).toBeUndefined();
  });

  it("commits timeout events and updates coach state", async () => {
    const saved: unknown[] = [];
    const events: Array<Parameters<CoachServiceContext["appendEvent"]>[0]> = [];
    const context = buildCoachContext({
      saveState: async (state) => {
        saved.push(state);
      },
      appendEvent: async (event) => {
        events.push(event);
        return event as Event;
      }
    });
    const correction = buildCoachTimeoutCorrection();

    const result = await commitCoachTimeoutUsage({
      context,
      match: { id: "match_1", tournamentId: "tournament_1" } as Match,
      mapGame: { id: "map_1" } as MapGame,
      round: { id: "round_6" } as Round,
      coachTimeout: {
        teamId: "team_a",
        teamName: "Team A",
        triggerRoundId: "round_5",
        triggerRoundNumber: 5,
        correction,
        responseArtifactId: "artifact_1",
        timeoutsRemainingBefore: 2,
        timeoutsRemainingAfter: 1,
        tokenBankBefore: 6,
        tokenBankAfter: 4
      },
      createdAt: "2026-06-05T00:00:00.000Z"
    });

    expect(result.timeoutUsedEvent.type).toBe("timeout_used");
    expect(result.coachTimeoutCorrectionEvent.type).toBe("coach_timeout_correction_created");
    expect(events.map((event) => event.type)).toEqual(["timeout_used", "coach_timeout_correction_created"]);
    expect(events[0]?.payload).toEqual(
      expect.objectContaining({
        teamId: "team_a",
        triggerRoundNumber: 5,
        timeoutsRemainingBefore: 2,
        timeoutsRemainingAfter: 1
      })
    );
    expect(events[1]?.payload).toEqual(
      expect.objectContaining({
        teamId: "team_a",
        artifactId: "artifact_1",
        correction
      })
    );
    expect(saved).toEqual([
      expect.objectContaining({
        mapGameId: "map_1",
        teamId: "team_a",
        timeoutsRemaining: 1,
        tokenBank: 4,
        lastTimeoutRoundNumber: 5
      })
    ]);
  });
});

function buildCoachContext(input: {
  listStates?: () => Promise<unknown[]>;
  saveState?: (state: unknown) => Promise<void>;
  appendEvent?: (event: Parameters<CoachServiceContext["appendEvent"]>[0]) => Promise<Event>;
}): CoachServiceContext {
  return ({
    repositories: {
      teamMapCoachStates: {
        listByMapGame: input.listStates ?? (async () => []),
        save: input.saveState ?? (async () => undefined),
        getByMapGameAndTeam: async () => null
      }
    },
    stageRunner: {
      runStructuredStage: async () => {
        throw new Error("Coach timeout LLM should not be called in this test.");
      }
    },
    appendEvent: input.appendEvent ?? (async (event: Parameters<CoachServiceContext["appendEvent"]>[0]) => event as never)
  } as unknown) as CoachServiceContext;
}

function buildCoachDependencies(): CoachServiceDependencies {
  return {
    readApprovedTeamMemoryOverlay: async () => undefined,
    readMapSemanticContext: () => undefined,
    readJudgeRubricContext: () => undefined,
    readTeamInitialProposal: () => undefined,
    readTeamCoachContext: () => undefined,
    sortAgentsForRound: (agents: Agent[]) => agents
  };
}

function buildCoachTimeoutCorrection(): CoachTimeoutCorrection {
  return {
    teamId: "team_a",
    triggerRoundNumber: 5,
    triggerReason: "连续失守",
    diagnosedFailure: "信息锚点不足",
    nextRoundObjective: "稳定主区并保留次级信息",
    ownCoreToHold: "保留核心命题",
    opponentGapToHit: "攻击对手轮转空档",
    zonePriorityShift: "主区优先",
    teamDirective: "三人核心执行，两人信息兜底",
    playerAdjustments: [1, 2, 3, 4, 5].map((index) => ({
      agentId: `agent_${index}`,
      adjustment: "保持职责并收紧补位"
    })),
    expiresAfterRoundNumber: 6,
    confidence: 0.8
  };
}
