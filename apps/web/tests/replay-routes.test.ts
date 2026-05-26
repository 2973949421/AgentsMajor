import type { MapReplay, MatchReplay } from "@agent-major/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadMatchReplayMock, loadMapReplayMock } = vi.hoisted(() => ({
  loadMatchReplayMock: vi.fn(),
  loadMapReplayMock: vi.fn()
}));

vi.mock("../app/map-replay-data", async () => {
  const actual = await vi.importActual<typeof import("../app/map-replay-data")>("../app/map-replay-data");
  return {
    ...actual,
    loadMatchReplay: loadMatchReplayMock,
    loadMapReplay: loadMapReplayMock
  };
});

import { GET as getMatchReplay } from "../app/api/matches/[matchId]/replay/route";
import { GET as getMapReplay } from "../app/api/maps/[mapGameId]/replay/route";

describe("Phase 1.7 replay routes", () => {
  beforeEach(() => {
    loadMatchReplayMock.mockReset();
    loadMapReplayMock.mockReset();
  });

  it("defaults the match replay route to the live-safe public format and rejects raw requests", async () => {
    loadMatchReplayMock.mockResolvedValue(matchReplayFixture());

    const response = await getMatchReplay(new Request("http://localhost:3000/api/matches/match/replay"), {
      params: Promise.resolve({ matchId: "match" })
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.maps[0]?.rounds[0]?.timelineEvents[0]?.id).toBe("tl-1");
    expect(body.maps[0]?.rounds[0]).not.toHaveProperty("events");
    expect(body.maps[0]?.rounds[0]?.roundReport).not.toHaveProperty("agentOutputs");
    expect(JSON.stringify(body)).not.toContain("driverModelId");
    expect(JSON.stringify(body)).not.toContain("raw-event");
    expect(JSON.stringify(body)).not.toContain("raw-output");

    const rawResponse = await getMatchReplay(new Request("http://localhost:3000/api/matches/match/replay?format=raw"), {
      params: Promise.resolve({ matchId: "match" })
    });

    expect(rawResponse.status).toBe(400);
    await expect(rawResponse.json()).resolves.toEqual({ error: "Public replay routes only expose the live-safe format." });
  });

  it("returns a live-safe map replay view instead of the raw round payload", async () => {
    loadMapReplayMock.mockResolvedValue(mapReplayFixture());

    const response = await getMapReplay(new Request("http://localhost:3000/api/maps/map/replay"), {
      params: Promise.resolve({ mapGameId: "map" })
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mapName).toBe("DUST2");
    expect(body.rounds[0]?.agentsById["agent-a"]?.displayName).toBe("apEX");
    expect(body.rounds[0]).not.toHaveProperty("events");
    expect(body.rounds[0]?.roundReport).not.toHaveProperty("agentOutputs");
    expect(JSON.stringify(body)).not.toContain("driverModelId");
    expect(JSON.stringify(body)).not.toContain("raw-event");
  });
});

function matchReplayFixture(): MatchReplay {
  const match = {
    id: "match",
    tournamentId: "tournament",
    roundName: "round_of_16",
    teamAId: "team-a",
    teamBId: "team-b",
    status: "completed",
    bestOf: 3,
    teamAMapsWon: 1,
    teamBMapsWon: 0,
    winnerTeamId: "team-a",
    scheduledOrder: 1,
    createdAt: "2026-05-01T00:00:00.000Z"
  };
  const teams = {
    teamA: {
      id: "team-a",
      tournamentId: "tournament",
      displayName: "Team A",
      shortName: "A",
      seed: 1,
      teamProfileId: "proposal_team_a",
      source: {
        headCoachProfile: {
          displayName: "Coach A",
          dutySummary: "暂停修正 / 半场整理 / 赛后复盘"
        }
      },
      createdAt: "2026-05-01T00:00:00.000Z"
    },
    teamB: {
      id: "team-b",
      tournamentId: "tournament",
      displayName: "Team B",
      shortName: "B",
      seed: 2,
      teamProfileId: "proposal_team_b",
      source: {
        headCoachProfile: {
          displayName: "Coach B",
          dutySummary: "暂停修正 / 半场整理 / 赛后复盘"
        }
      },
      createdAt: "2026-05-01T00:00:00.000Z"
    }
  };
  const agentsById = {
    "agent-a": {
      id: "agent-a",
      teamId: "team-a",
      displayName: "apEX",
      role: "igl",
      secondaryRoles: [],
      roleResponsibilities: ["节奏选择 / 进攻轴切换 / 压力调度"],
      aliases: ["captain"],
      materialRef: {
        entityId: "player_vitallmty_apex",
        entityType: "player",
        teamSlug: "vitallmty",
        runtimeEnabled: false
      }
    }
  };
  const rounds = [
    {
      round: {
        id: "round-1",
        mapGameId: "map",
        roundNumber: 1,
        status: "completed",
        teamAActiveAgentIds: ["agent-a"],
        teamBActiveAgentIds: [],
        startedAt: "2026-05-01T00:00:00.000Z",
        completedAt: "2026-05-01T00:01:00.000Z"
      },
      roundReport: {
        id: "report-1",
        tournamentId: "tournament",
        matchId: "match",
        mapGameId: "map",
        roundId: "round-1",
        roundNumber: 1,
        mapName: "DUST2",
        winnerTeamId: "team-a",
        scoreBeforeRound: { teamA: 0, teamB: 0 },
        scoreAfterRound: { teamA: 1, teamB: 0 },
        judgeResult: {
          winnerTeamId: "team-a",
          loserTeamId: "team-b",
          margin: "standard",
          roundWinType: "attack_elimination",
          attackWinConditionMet: true,
          defenseWinConditionMet: false,
          reason: "won the opener",
          mvpAgentId: "agent-a",
          confidence: 0.9
        },
        agentOutputs: [
          {
            id: "raw-output",
            agentId: "agent-a",
            teamId: "team-a",
            role: "igl",
            driverModelId: "driver_fake_phase17",
            action: "raw action",
            confidence: 0.9,
            rawFingerprint: "fingerprint"
          }
        ],
        keyEvents: [],
        economyDelta: {
          agents: [],
          teamTotals: { teamA: 0, teamB: 0 }
        },
        tokenSubmission: {
          activeAgentIds: ["agent-a"],
          submittedOutputIds: ["raw-output"],
          totalOutputBudget: 300,
          outputGate: {
            applied: false,
            reason: "fixture"
          }
        },
        highlightTags: ["phase12_demo"],
        summary: "test round",
        eventProjection: {
          coreEventsLinkedByRoundReport: [],
          broadcastEventsCreated: []
        },
        createdAt: "2026-05-01T00:01:00.000Z"
      },
      events: [{ id: "raw-event" }],
      timelineEvents: [
        {
          id: "tl-1",
          tournamentId: "tournament",
          matchId: "match",
          mapGameId: "map",
          roundId: "round-1",
          sourceEventIds: ["raw-event"],
          atMs: 0,
          kind: "round_intro",
          payload: { text: "intro" },
          playbackScope: "round",
          playbackScopeId: "round-1",
          sequenceIndex: 0,
          createdAt: "2026-05-01T00:00:00.000Z"
        }
      ]
    }
  ];
  const mapReplay = {
    match,
    mapGame: {
      id: "map",
      matchId: "match",
      mapName: "DUST2",
      order: 1,
      status: "completed",
      teamAScore: 13,
      teamBScore: 10,
      currentRoundNumber: 23,
      winnerTeamId: "team-a",
      createdAt: "2026-05-01T00:00:00.000Z",
      completedAt: "2026-05-01T00:23:00.000Z"
    },
    teams,
    agentsById,
    rounds,
    mapSummary: {
      id: "summary-map",
      summaryType: "map",
      scopeType: "map",
      scopeId: "map",
      tournamentId: "tournament",
      matchId: "match",
      mapGameId: "map",
      title: "Map summary",
      content: "Map summary",
      payload: {
        keyRounds: [{ roundNumber: 1 }]
      },
      sourceEventIds: ["raw-event"],
      createdAt: "2026-05-01T00:23:00.000Z"
    },
    eventCounts: {
      map: 1,
      round: 1,
      timeline: 1
    }
  };

  return {
    match,
    teams,
    agentsById,
    mapGames: [mapReplay.mapGame],
    maps: [mapReplay],
    matchSummary: null,
    eventCounts: {
      match: 1,
      map: 1,
      round: 1,
      timeline: 1
    }
  } as unknown as MatchReplay;
}

function mapReplayFixture(): MapReplay {
  return matchReplayFixture().maps[0] as MapReplay;
}
