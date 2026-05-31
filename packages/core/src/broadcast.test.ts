import type { MapGame, Match, Round, RoundReport, Team } from "@agent-major/shared";
import type { LlmGateway, LlmRequest } from "@agent-major/llm";
import { describe, expect, it } from "vitest";

import { buildBroadcastSourceBundle, buildRoundBroadcastItems, runBroadcastQualityGate } from "./broadcast.js";
import { createLlmCasterBroadcastGenerator } from "./broadcast-llm.js";

describe("Phase 1.45 broadcast contract", () => {
  it("generates traceable rule/fallback broadcast items without leaking model metadata", () => {
    const bundle = buildBroadcastSourceBundle({
      match: matchFixture(),
      mapGame: mapGameFixture(),
      round: roundFixture(),
      roundReport: roundReportFixture(),
      teamA: teamFixture("team-a", "Team A", "A"),
      teamB: teamFixture("team-b", "Team B", "B"),
      sourceEventIds: {
        scoreEventId: "evt_score",
        economyEventId: "evt_economy",
        highlightEventId: "evt_highlight",
        roundReportEventId: "evt_report",
        roundCompletedEventId: "evt_completed",
        killFeedEventIds: ["evt_kill_1"]
      }
    });

    const items = buildRoundBroadcastItems({ bundle, createdAt: "2026-05-02T00:00:00.000Z" });
    const allItems = [items.casterLine, items.barrage, items.supportRate, items.replayCard];

    expect(allItems.every((item) => item.sourceEventIds.length > 0)).toBe(true);
    expect(items.casterLine.generationMode).toBe("fallback_template");
    expect(items.barrage.qualityStatus).toBe("fallback");
    expect(items.supportRate.generationMode).toBe("rule");
    expect(items.supportRate.qualityStatus).toBe("ready");
    expect(items.replayCard.payload.jumpTarget).toMatchObject({ type: "highlight_reveal", roundId: "round-1" });
    expect(items.barrage.payload.messages.length).toBeGreaterThan(0);
    expect(items.supportRate.payload.teamA + items.supportRate.payload.teamB).toBe(100);
    expect(JSON.stringify(allItems.map((item) => item.payload))).not.toMatch(/driverModelId|providerId|modelName|inputTokens|estimatedCost/);
  });

  it("rejects broadcast payloads that leak model fields or contradict facts", () => {
    const report = roundReportFixture();
    const baseItem = {
      id: "bad",
      kind: "caster_line" as const,
      tournamentId: "tournament",
      matchId: "match",
      mapGameId: "map",
      roundId: "round-1",
      sourceEventIds: ["evt_report"],
      generationMode: "manual" as const,
      createdAt: "2026-05-02T00:00:00.000Z"
    };

    expect(
      runBroadcastQualityGate({
        item: { ...baseItem, payload: { text: "leak", driverModelId: "driver_glm_5" } },
        roundReport: report,
        fallbackStatus: "ready"
      }).status
    ).toBe("rejected");

    expect(
      runBroadcastQualityGate({
        item: { ...baseItem, payload: { text: "wrong", winnerTeamId: "team-b" } },
        roundReport: report,
        fallbackStatus: "ready"
      }).status
    ).toBe("rejected");
  });

  it("can replace only caster_line with an LLM-generated item", async () => {
    const bundle = broadcastBundleFixture();
    const seenInputs: unknown[] = [];
    const gateway: LlmGateway = {
      async generateStructured<TData = unknown, TInput = unknown>(request: LlmRequest<TInput>) {
        const rawText =
          "{\"text\":\"Team A 把中路控制转成 A 点收束，这一分非常关键。\",\"reason\":\"基于回合摘要和关键事件。\",\"tags\":[\"round_conversion\"]}";
        seenInputs.push(request.input);
        return {
          data: rawText as TData,
          rawText,
          usage: { promptTokens: 10, completionTokens: 8, totalTokens: 18 }
        };
      }
    };
    const generator = createLlmCasterBroadcastGenerator({
      llmGateway: gateway,
      driverModelId: "driver_kimi_k2_5"
    });

    const items = await generator.build({ bundle, createdAt: "2026-05-02T00:00:00.000Z" });

    expect(items.casterLine.generationMode).toBe("llm");
    expect(items.casterLine.qualityStatus).toBe("ready");
    expect(items.barrage.generationMode).toBe("fallback_template");
    expect(items.supportRate.generationMode).toBe("rule");
    expect(JSON.stringify(seenInputs)).not.toMatch(/agentOutputs|rawFingerprint|providerId|modelName/);
  });

  it("falls back when the LLM caster payload leaks model metadata", async () => {
    const gateway: LlmGateway = {
      async generateStructured<TData = unknown>() {
        const rawText = "{\"text\":\"modelName should not appear\"}";
        return {
          data: rawText as TData,
          rawText,
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
        };
      }
    };
    const generator = createLlmCasterBroadcastGenerator({
      llmGateway: gateway,
      driverModelId: "driver_kimi_k2_5"
    });

    const items = await generator.build({ bundle: broadcastBundleFixture(), createdAt: "2026-05-02T00:00:00.000Z" });

    expect(items.casterLine.generationMode).toBe("fallback_template");
    expect(items.casterLine.qualityStatus).toBe("fallback");
  });
});

function broadcastBundleFixture() {
  return buildBroadcastSourceBundle({
    match: matchFixture(),
    mapGame: mapGameFixture(),
    round: roundFixture(),
    roundReport: roundReportFixture(),
    teamA: teamFixture("team-a", "Team A", "A"),
    teamB: teamFixture("team-b", "Team B", "B"),
    sourceEventIds: {
      scoreEventId: "evt_score",
      economyEventId: "evt_economy",
      highlightEventId: "evt_highlight",
      roundReportEventId: "evt_report",
      roundCompletedEventId: "evt_completed",
      killFeedEventIds: ["evt_kill_1"]
    }
  });
}

function matchFixture(): Match {
  return {
    id: "match",
    tournamentId: "tournament",
    roundName: "round_of_16",
    teamAId: "team-a",
    teamBId: "team-b",
    status: "running",
    bestOf: 3,
    teamAMapsWon: 0,
    teamBMapsWon: 0,
    scheduledOrder: 1,
    createdAt: "2026-05-02T00:00:00.000Z"
  };
}

function mapGameFixture(): MapGame {
  return {
    id: "map",
    matchId: "match",
    mapName: "DUST2",
    order: 1,
    status: "running",
    teamAScore: 0,
    teamBScore: 0,
    currentRoundNumber: 1,
    createdAt: "2026-05-02T00:00:00.000Z"
  };
}

function roundFixture(): Round {
  return {
    id: "round-1",
    mapGameId: "map",
    roundNumber: 1,
    status: "completed",
    teamAActiveAgentIds: ["agent-a"],
    teamBActiveAgentIds: ["agent-b"],
    winnerTeamId: "team-a"
  };
}

function teamFixture(id: string, displayName: string, shortName: string): Team {
  return {
    id,
    tournamentId: "tournament",
    displayName,
    shortName,
    seed: id === "team-a" ? 1 : 2,
    createdAt: "2026-05-02T00:00:00.000Z"
  };
}

function roundReportFixture(): RoundReport {
  return {
    id: "report",
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
      reason: "Team A converts mid control.",
      mvpAgentId: "agent-a",
      confidence: 0.8
    },
    agentOutputs: [],
    keyEvents: [
      {
        id: "ke-1",
        type: "entry",
        actorAgentId: "agent-a",
        actorTeamId: "team-a",
        zoneId: "buyer_mid",
        impact: "Agent A opens buyer mid.",
        sourceAgentOutputIds: []
      }
    ],
    economyDelta: {
      agents: [],
      teamTotals: { teamA: 25000, teamB: 18000 },
      teamNetDelta: { teamA: 4000, teamB: -3000 }
    },
    tokenSubmission: {
      activeAgentIds: ["agent-a"],
      submittedOutputIds: [],
      totalOutputBudget: 1000,
      outputGate: { applied: true, reason: "test" }
    },
    highlightTags: ["round_conversion"],
    summary: "Team A converts buyer mid control.",
    eventProjection: {
      coreEventsLinkedByRoundReport: [],
      broadcastEventsCreated: []
    },
    createdAt: "2026-05-02T00:00:00.000Z"
  };
}
