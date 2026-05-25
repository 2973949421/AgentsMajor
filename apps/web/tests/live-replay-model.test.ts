import type { MatchReplay } from "@agent-major/core";
import { describe, expect, it } from "vitest";

import {
  EMPTY_ROUND_DURATION_MS,
  buildRoundFrame,
  findNextHighlightRoundIndex,
  getNextRoundIndex,
  getRoundDurationMs,
  getVisibleTimelineEvents,
  sortTimelineEvents,
  toLiveReplayData,
  type LiveReplayMap,
  type LiveReplayRound,
  type LiveReplayTimelineEvent
} from "../app/live-replay-model";

describe("Phase 1.4 live replay model", () => {
  it("sorts timeline events by playback time, sequence, and id", () => {
    const events = [
      timelineEvent({ id: "c", atMs: 2000, sequenceIndex: 1 }),
      timelineEvent({ id: "b", atMs: 1000, sequenceIndex: 2 }),
      timelineEvent({ id: "a", atMs: 1000, sequenceIndex: 1 })
    ];

    expect(sortTimelineEvents(events).map((event) => event.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps score unrevealed until round_result reaches the playback clock", () => {
    const item = roundItem(1, [
      timelineEvent({ id: "intro", kind: "round_intro", atMs: 0 }),
      timelineEvent({ id: "score", kind: "scoreboard_update", atMs: 5000, payload: { scoreAfterRound: { teamA: 1, teamB: 0 } } }),
      timelineEvent({
        id: "kill",
        kind: "kill_feed_item",
        atMs: 8000,
        payload: { actorAgentId: "agent-a", targetAgentId: "agent-b", text: "Entry opens mid", zoneId: "buyer_mid" }
      }),
      timelineEvent({ id: "result", kind: "round_result", atMs: 62000, payload: { scoreAfterRound: { teamA: 1, teamB: 0 } } })
    ]);

    expect(getVisibleTimelineEvents(item.timelineEvents, 4999).map((event) => event.id)).toEqual(["intro"]);
    expect(buildRoundFrame(item, 8000).currentScore).toEqual({ teamA: 0, teamB: 0 });
    expect(buildRoundFrame(item, 8000).roundSummary).toBeNull();
    expect(buildRoundFrame(item, 8000).killFeed).toHaveLength(1);
    expect(buildRoundFrame(item, 62000).currentScore).toEqual({ teamA: 1, teamB: 0 });
    expect(buildRoundFrame(item, 62000).roundSummary).toBe("test round");
  });

  it("computes round duration from atMs plus durationMs and falls back for empty timelines", () => {
    expect(
      getRoundDurationMs(
        roundItem(1, [
          timelineEvent({ id: "one", atMs: 1000, durationMs: 500 }),
          timelineEvent({ id: "two", atMs: 5000, durationMs: 3000 })
        ])
      )
    ).toBe(8000);
    expect(getRoundDurationMs(roundItem(2, []))).toBe(EMPTY_ROUND_DURATION_MS);
  });

  it("uses map summary key rounds for highlight jumping and ignores generic demo tags", () => {
    const keyRoundMap = mapReplay([
      roundItem(1, [timelineEvent({ id: "r1", kind: "round_intro" })]),
      roundItem(2, [timelineEvent({ id: "r2", kind: "highlight_reveal", payload: { tags: ["phase12_demo"] } })]),
      roundItem(3, [timelineEvent({ id: "r3", kind: "round_intro" })])
    ], [2]);

    const genericOnlyMap = mapReplay([
      roundItem(1, [timelineEvent({ id: "generic", kind: "highlight_reveal", payload: { tags: ["phase12_demo", "team_a_round"] } })])
    ]);

    const semanticTagMap = mapReplay([
      roundItem(1, [timelineEvent({ id: "semantic", kind: "highlight_reveal", payload: { tags: ["force_buy_clutch"] } })])
    ]);
    const semanticReportRound = roundItem(1, []);
    semanticReportRound.roundReport.highlightTags = ["map_point_conversion"];
    const semanticReportMap = mapReplay([semanticReportRound]);

    expect(findNextHighlightRoundIndex(keyRoundMap, 0)).toBe(1);
    expect(findNextHighlightRoundIndex(keyRoundMap, 1)).toBe(1);
    expect(findNextHighlightRoundIndex(keyRoundMap, 2)).toBe(1);
    expect(findNextHighlightRoundIndex(genericOnlyMap, 0)).toBeNull();
    expect(findNextHighlightRoundIndex(semanticTagMap, 0)).toBe(0);
    expect(findNextHighlightRoundIndex(semanticReportMap, 0)).toBe(0);
    expect(getNextRoundIndex(keyRoundMap, 1)).toBe(2);
    expect(getNextRoundIndex(keyRoundMap, 2)).toBeNull();
  });

  it("serializes a live replay view model without raw events while preserving analysis facts", () => {
    const liveReplay = toLiveReplayData(matchReplayFixture());
    const firstRound = liveReplay.maps[0]?.rounds[0];

    expect(liveReplay.matchId).toBe("match");
    expect(liveReplay.maps[0]?.tacticalMap.zones).toHaveLength(8);
    expect(liveReplay.maps[0]?.keyRoundNumbers).toEqual([2]);
    expect(firstRound?.roundReport.mapName).toBe("DUST2");
    expect(firstRound?.roundReport.summary).toBe("test round");
    expect(firstRound?.timelineEvents[0]?.id).toBe("tl-1");
    expect(firstRound).not.toHaveProperty("events");
    expect(firstRound?.roundReport.agentOutputs).toHaveLength(1);
  });

  it("exposes Phase 1.45 tactical map and broadcast frame data", () => {
    const item = roundItem(1, [
      timelineEvent({
        id: "kill",
        kind: "kill_feed_item",
        atMs: 20000,
        payload: {
          actorAgentId: "agent-a",
          targetAgentId: "agent-b",
          keyEventId: "ke-1",
          zoneId: "unknown_zone",
          text: "unknown zone event"
        }
      }),
      timelineEvent({
        id: "score",
        kind: "scoreboard_update",
        atMs: 22000,
        payload: { supportRate: { teamA: 61, teamB: 39, leaderTeamId: "team-a", trend: "team_a_up", label: "A leads" } }
      }),
      timelineEvent({
        id: "barrage",
        kind: "barrage_stream",
        atMs: 30000,
        payload: { messages: [{ id: "bm-1", atMs: 18000, text: "nice control", intensity: "medium" }] }
      }),
      timelineEvent({
        id: "highlight",
        kind: "highlight_reveal",
        atMs: 54000,
        payload: {
          tags: ["economy_swing"],
          replayCard: {
            title: "Round 1 | Economy Swing",
            summary: "test card",
            highlightTags: ["economy_swing"],
            jumpTarget: { type: "highlight_reveal", roundId: "round-1", atMs: 54000 }
          }
        }
      })
    ]);
    item.roundReport.keyEvents = [{ id: "ke-1", type: "entry", actorTeamId: "team-a", zoneId: "unknown_zone", impact: "fallback control" }];
    item.roundReport.highlightTags = ["economy_swing"];

    const frame = buildRoundFrame(item, 54000);
    const fallbackZone = frame.tacticalMap.zones.find((zone) => zone.id === "buyer_mid");

    expect(frame.supportRate?.teamA).toBe(61);
    expect(frame.barrageMessages[0]?.text).toBe("nice control");
    expect(frame.replayCard?.title).toBe("Round 1 | Economy Swing");
    expect(fallbackZone?.active).toBe(true);
    expect(fallbackZone?.weak).toBe(true);
    expect(frame.tacticalMap.connections.some((connection) => connection.active)).toBe(true);
  });

  it("exposes Phase 1.6 public tactical round data without raw hidden plans", () => {
    const item = roundItem(1, [
      timelineEvent({
        id: "attack",
        kind: "map_control_update",
        atMs: 16000,
        payload: { tacticalKind: "attack_plan_revealed" }
      }),
      timelineEvent({
        id: "defense",
        kind: "map_control_update",
        atMs: 32000,
        payload: { tacticalKind: "defense_deployment_revealed" }
      }),
      timelineEvent({
        id: "collision",
        kind: "map_control_update",
        atMs: 52000,
        payload: { tacticalKind: "site_execute_resolved" }
      })
    ]);
    item.tacticalRound = {
      sideAssignment: {
        roundId: "round-1",
        roundNumber: 1,
        attackingTeamId: "team-a",
        defendingTeamId: "team-b",
        half: "first_half",
        sideSwitched: false
      },
      attackPlan: {
        teamId: "team-a",
        primaryTargetZoneId: "conversion_site_a",
        secondaryTargetZoneId: "conversion_site_b",
        approach: "fake_then_rotate",
        feintRevealed: true,
        publicSummary: "fake A then rotate B"
      },
      defenseDeployment: {
        teamId: "team-b",
        setup: "heavy_a",
        heavyZoneId: "conversion_site_a",
        weakZoneIds: ["conversion_site_b"],
        rotatePolicy: "hold_sites",
        publicSummary: "heavy A"
      },
      collision: {
        primaryZoneId: "conversion_site_b",
        attackApproach: "fake_then_rotate",
        defenseSetup: "heavy_a",
        result: "fake_success",
        attackScore: 72,
        defenseScore: 70,
        decisiveReason: "fake condition matched"
      }
    };

    const frame = buildRoundFrame(item, 52000);
    const attackZone = frame.tacticalMap.zones.find((zone) => zone.id === "conversion_site_a");
    const weakZone = frame.tacticalMap.zones.find((zone) => zone.id === "conversion_site_b");

    expect(frame.tacticalRound?.collision.result).toBe("fake_success");
    expect(attackZone?.active).toBe(true);
    expect(weakZone?.active).toBe(true);
    expect(weakZone?.weak).toBe(true);
    expect(JSON.stringify(frame)).not.toContain("rawOutput");
    expect(JSON.stringify(frame)).not.toContain("driverModelId");
  });

  it("throws on malformed kill_feed_item timeline payloads instead of silently dropping them", () => {
    const item = roundItem(1, [
      timelineEvent({
        id: "bad-kill",
        kind: "kill_feed_item",
        atMs: 8000,
        payload: { actorAgentId: "agent-a", text: "missing victim" }
      })
    ]);

    expect(() => buildRoundFrame(item, 8000)).toThrow("Invalid replay kill data");
    expect(() => buildRoundFrame(item, 8000)).toThrow("targetAgentId");
  });

  it("throws when stored kill ledger references an unmapped target agent", () => {
    const replay = matchReplayFixture();
    replay.agentsById = {
      "agent-a": {
        id: "agent-a",
        teamId: "team-a",
        displayName: "Agent A",
        role: "entry",
        secondaryRoles: [],
        roleResponsibilities: [],
        aliases: []
      }
    } as MatchReplay["agentsById"];
    (replay.maps[0] as MatchReplay["maps"][number]).rounds[0]!.roundReport.killLedger = [
      {
        id: "ledger-1",
        atMs: 1000,
        impact: "bad stored kill",
        actorAgentId: "agent-a",
        targetAgentId: "agent-b",
        actorTeamId: "team-a",
        targetTeamId: "team-b",
        zoneId: "buyer_mid",
        sourceEventId: "tl-1"
      }
    ] as NonNullable<MatchReplay["maps"][number]["rounds"][number]["roundReport"]["killLedger"]>;

    expect(() => toLiveReplayData(replay)).toThrow("Invalid replay kill data");
    expect(() => toLiveReplayData(replay)).toThrow('unknown target agent "agent-b"');
  });
});

function timelineEvent(input: Partial<LiveReplayTimelineEvent> & { id: string }): LiveReplayTimelineEvent {
  return {
    id: input.id,
    atMs: input.atMs ?? 0,
    ...(typeof input.durationMs === "number" ? { durationMs: input.durationMs } : {}),
    kind: input.kind ?? "round_intro",
    payload: input.payload ?? {},
    ...(input.roundId ? { roundId: input.roundId } : {}),
    sequenceIndex: input.sequenceIndex ?? 0
  };
}

function roundItem(roundNumber: number, timelineEvents: LiveReplayTimelineEvent[]): LiveReplayRound {
  return {
    id: `round-${roundNumber}`,
    roundNumber,
    agentsById: replayAgentsFixture(),
    roundReport: {
      winnerTeamId: "team-a",
      mapName: "DUST2",
      scoreBeforeRound: { teamA: roundNumber - 1, teamB: 0 },
      scoreAfterRound: { teamA: roundNumber, teamB: 0 },
      judgeResult: {
        winnerTeamId: "team-a",
        loserTeamId: "team-b",
        margin: "standard",
        reason: "Team A converted the round while Team B failed to hold.",
        mvpAgentId: "agent-a",
        confidence: 0.82
      },
      agentOutputs: [],
      keyEvents: [],
      economyDelta: {
        agents: [],
        teamTotals: { teamA: 0, teamB: 0 }
      },
      highlightTags: [],
      summary: "test round"
    },
    timelineEvents
  };
}

function replayAgentsFixture() {
  return {
    "agent-a": {
      id: "agent-a",
      teamId: "team-a",
      displayName: "Agent A",
      role: "entry",
      secondaryRoles: [],
      roleResponsibilities: [],
      aliases: []
    },
    "agent-b": {
      id: "agent-b",
      teamId: "team-b",
      displayName: "Agent B",
      role: "support",
      secondaryRoles: [],
      roleResponsibilities: [],
      aliases: []
    }
  };
}

function mapReplay(rounds: LiveReplayRound[], keyRoundNumbers: number[] = []): LiveReplayMap {
  return {
    id: "map",
    order: 1,
    mapName: "DUST2",
    tacticalMap: {
      mapName: "DUST2",
      canvas: { width: 1000, height: 640 },
      fallbackZoneId: "buyer_mid",
      zones: [],
      connections: []
    },
    timeoutsRemainingByTeam: {
      "team-a": 2,
      "team-b": 2
    },
    finalScore: { teamA: 7, teamB: 5 },
    winnerTeamId: "team-a",
    keyRoundNumbers,
    rounds
  };
}

function matchReplayFixture(): MatchReplay {
  return {
    match: {
      id: "match"
    },
    teams: {
      teamA: {
        id: "team-a",
        displayName: "Team A",
        shortName: "A"
      },
      teamB: {
        id: "team-b",
        displayName: "Team B",
        shortName: "B"
      }
    },
    maps: [
      {
        mapGame: {
          id: "map",
          order: 1,
          mapName: "DUST2",
          teamAScore: 7,
          teamBScore: 5,
          winnerTeamId: "team-a"
        },
        mapSummary: {
          payload: {
            keyRounds: [{ roundNumber: 2 }]
          }
        },
        rounds: [
          {
            round: {
              id: "round-1",
              roundNumber: 1
            },
            roundReport: {
              mapName: "DUST2",
              winnerTeamId: "team-a",
              scoreBeforeRound: { teamA: 0, teamB: 0 },
              scoreAfterRound: { teamA: 1, teamB: 0 },
              keyEvents: [],
              economyDelta: {
                agents: [],
                teamTotals: { teamA: 0, teamB: 0 }
              },
              highlightTags: ["phase12_demo"],
              summary: "test round",
              agentOutputs: [{ id: "raw-output" }]
            },
            events: [{ id: "raw-event" }],
            timelineEvents: [
              {
                id: "tl-1",
                sourceEventIds: ["raw-event"],
                atMs: 0,
                kind: "round_intro",
                payload: { text: "intro" },
                sequenceIndex: 0
              }
            ]
          }
        ]
      }
    ]
  } as unknown as MatchReplay;
}
