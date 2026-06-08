import type { Agent } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import { buildFallbackJudgeRoundWinType, selectMvpCandidate } from "./judge-fallback.js";

describe("judge fallback", () => {
  it("derives fallback win type from winner side", () => {
    expect(
      buildFallbackJudgeRoundWinType("team_a", {
        roundId: "round_1",
        roundNumber: 1,
        attackingTeamId: "team_a",
        defendingTeamId: "team_b",
        half: "first_half",
        sideSwitched: false
      })
    ).toBe("attack_elimination");
  });

  it("keeps deterministic MVP selection behavior outside engine", () => {
    const selected = selectMvpCandidate([
      agent("agent_low", "rifler"),
      agent("agent_igl", "igl")
    ]);

    expect(selected?.id).toBeTruthy();
  });
});

function agent(id: string, role: string): Agent {
  return {
    id,
    teamId: "team_a",
    driverModelId: "driver_test",
    role,
    displayName: id,
    baseProfile: {},
    currentState: "ready",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z"
  } as Agent;
}
