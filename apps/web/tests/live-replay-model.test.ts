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
      timelineEvent({ id: "kill", kind: "kill_feed_item", atMs: 8000, payload: { text: "Entry opens mid" } }),
      timelineEvent({ id: "result", kind: "round_result", atMs: 62000, payload: { scoreAfterRound: { teamA: 1, teamB: 0 } } })
    ]);

    expect(getVisibleTimelineEvents(item.timelineEvents, 4999).map((event) => event.id)).toEqual(["intro"]);
    expect(buildRoundFrame(item, 8000).currentScore).toEqual({ teamA: 0, teamB: 0 });
    expect(buildRoundFrame(item, 8000).killFeed).toHaveLength(1);
    expect(buildRoundFrame(item, 62000).currentScore).toEqual({ teamA: 1, teamB: 0 });
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

    expect(findNextHighlightRoundIndex(keyRoundMap, 0)).toBe(1);
    expect(findNextHighlightRoundIndex(keyRoundMap, 1)).toBe(1);
    expect(findNextHighlightRoundIndex(keyRoundMap, 2)).toBe(1);
    expect(findNextHighlightRoundIndex(genericOnlyMap, 0)).toBeNull();
    expect(findNextHighlightRoundIndex(semanticTagMap, 0)).toBe(0);
    expect(getNextRoundIndex(keyRoundMap, 1)).toBe(2);
    expect(getNextRoundIndex(keyRoundMap, 2)).toBeNull();
  });

  it("serializes a browser-safe live replay view model without raw events or agent outputs", () => {
    const liveReplay = toLiveReplayData(matchReplayFixture());
    const firstRound = liveReplay.maps[0]?.rounds[0];

    expect(liveReplay.matchId).toBe("match");
    expect(liveReplay.maps[0]?.keyRoundNumbers).toEqual([2]);
    expect(firstRound?.roundReport.summary).toBe("test round");
    expect(firstRound?.timelineEvents[0]?.id).toBe("tl-1");
    expect(firstRound).not.toHaveProperty("events");
    expect(firstRound?.roundReport).not.toHaveProperty("agentOutputs");
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
    ...(input.sourceEventIds ? { sourceEventIds: input.sourceEventIds } : {}),
    sequenceIndex: input.sequenceIndex ?? 0
  };
}

function roundItem(roundNumber: number, timelineEvents: LiveReplayTimelineEvent[]): LiveReplayRound {
  return {
    id: `round-${roundNumber}`,
    roundNumber,
    roundReport: {
      winnerTeamId: "team-a",
      scoreBeforeRound: { teamA: roundNumber - 1, teamB: 0 },
      scoreAfterRound: { teamA: roundNumber, teamB: 0 },
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

function mapReplay(rounds: LiveReplayRound[], keyRoundNumbers: number[] = []): LiveReplayMap {
  return {
    id: "map",
    order: 1,
    mapName: "DUST2",
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
