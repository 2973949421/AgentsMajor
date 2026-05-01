import { describe, expect, it } from "vitest";
import { agentSchema, economyStateSchema, eventSchema, timelineEventSchema, tournamentSchema } from "./schemas.js";

const now = "2026-05-01T00:00:00.000Z";

describe("shared contracts", () => {
  it("parses a minimal tournament", () => {
    expect(
      tournamentSchema.parse({
        id: "t_001",
        name: "Agent Major",
        status: "draft",
        format: "single_elimination_16",
        createdAt: now
      })
    ).toMatchObject({ id: "t_001" });
  });

  it("requires Agent.driverModelId", () => {
    expect(() =>
      agentSchema.parse({
        id: "agent_001",
        teamId: "team_001",
        role: "star",
        displayName: "Ghost Star",
        baseProfile: {
          personalitySummary: "Aggressive star",
          tacticalSummary: "Takes high-impact actions",
          styleTags: ["aggressive"]
        },
        currentState: "ready",
        createdAt: now
      })
    ).toThrow();
  });

  it("requires Event.payload.schemaVersion", () => {
    expect(() =>
      eventSchema.parse({
        id: "evt_001",
        type: "round_started",
        category: "simulation",
        tournamentId: "t_001",
        payload: {},
        globalSequence: 1,
        scopeType: "round",
        scopeId: "round_001",
        sequenceInScope: 1,
        createdAt: now
      })
    ).toThrow();
  });

  it("requires TimelineEvent.sourceEventIds", () => {
    expect(() =>
      timelineEventSchema.parse({
        id: "tl_001",
        tournamentId: "t_001",
        sourceEventIds: [],
        atMs: 0,
        kind: "round_intro",
        payload: {},
        playbackScope: "round",
        playbackScopeId: "round_001",
        sequenceIndex: 0,
        createdAt: now
      })
    ).toThrow();
  });

  it("requires EconomyState to be Agent-level", () => {
    expect(() =>
      economyStateSchema.parse({
        id: "eco_001",
        teamId: "team_001",
        mapGameId: "map_001",
        tokenBank: 8000,
        buyType: "halfBuy",
        lossStreak: 0,
        timeoutsRemaining: 1,
        createdAt: now
      })
    ).toThrow();
  });
});
