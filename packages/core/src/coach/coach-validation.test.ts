import type { Agent, CoachTimeoutCorrection } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import {
  normalizeCoachTimeoutCorrectionPayload,
  validateCoachTimeoutCorrection
} from "./coach-validation.js";

describe("coach validation", () => {
  it("normalizes object-style player directives and fills committed round fields", () => {
    const normalized = normalizeCoachTimeoutCorrectionPayload({
      triggerReason: ["连续失守", "需要修正"],
      playerDirectives: {
        agent_1: { directive: "主区优先" },
        agent_2: "保留次级信息"
      }
    }) as Record<string, unknown>;

    expect(normalized.triggerReason).toBe("连续失守；需要修正");
    expect(normalized.playerAdjustments).toEqual([
      { agentId: "agent_1", adjustment: "主区优先" },
      { agentId: "agent_2", adjustment: "保留次级信息" }
    ]);

    const correction = validateCoachTimeoutCorrection({
      correction: {
        ...baseCorrection(),
        playerAdjustments: [
          { agentId: "agent_1", adjustment: "唯一主攻方向" },
          { agentId: "agent_2", adjustment: "保留次级信息" }
        ]
      },
      teamId: "team_a",
      triggerRoundNumber: 5,
      expiresAfterRoundNumber: 6,
      activeAgents: [agent("agent_1"), agent("agent_2")]
    });

    expect(correction.teamId).toBe("team_a");
    expect(correction.triggerRoundNumber).toBe(5);
    expect(correction.expiresAfterRoundNumber).toBe(6);
    expect(correction.playerAdjustments[0]?.adjustment).toContain("主要进攻方向");
    expect(correction.teamDirective).toContain("平衡约束");
  });

  it("rejects duplicate and inactive player adjustments", () => {
    expect(() =>
      validateCoachTimeoutCorrection({
        correction: {
          ...baseCorrection(),
          playerAdjustments: [
            { agentId: "agent_1", adjustment: "a" },
            { agentId: "agent_1", adjustment: "b" }
          ]
        },
        teamId: "team_a",
        triggerRoundNumber: 5,
        expiresAfterRoundNumber: 6,
        activeAgents: [agent("agent_1")]
      })
    ).toThrow(/duplicate/);

    expect(() =>
      validateCoachTimeoutCorrection({
        correction: {
          ...baseCorrection(),
          playerAdjustments: [
            { agentId: "agent_1", adjustment: "a" },
            { agentId: "agent_3", adjustment: "b" }
          ]
        },
        teamId: "team_a",
        triggerRoundNumber: 5,
        expiresAfterRoundNumber: 6,
        activeAgents: [agent("agent_1"), agent("agent_2")]
      })
    ).toThrow(/inactive agent/);
  });
});

function baseCorrection(): CoachTimeoutCorrection {
  return {
    teamId: "placeholder",
    triggerRoundNumber: 0,
    triggerReason: "连续失守",
    diagnosedFailure: "信息锚点不足",
    nextRoundObjective: "稳定主区并保留次级信息",
    ownCoreToHold: "保留核心命题",
    opponentGapToHit: "攻击对手轮转空档",
    zonePriorityShift: "主区优先",
    teamDirective: "三人核心执行，两人信息兜底",
    playerAdjustments: [],
    expiresAfterRoundNumber: 0,
    confidence: 0.8
  };
}

function agent(id: string): Agent {
  return {
    id,
    teamId: "team_a",
    driverModelId: "driver_test",
    role: "rifler",
    displayName: id,
    baseProfile: {},
    currentState: "ready",
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z"
  } as Agent;
}
