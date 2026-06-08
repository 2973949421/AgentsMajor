import type { Agent } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import {
  formatEconomyPosture,
  outputBudgetForEconomyPosture,
  resolveRoundEconomyPhase,
  roundStartEconomy
} from "./economy-rules.js";

describe("economy rules", () => {
  it("keeps overtime reset as competitive rifle economy instead of full eco", () => {
    const state = roundStartEconomy({
      agent: agent("agent_1", "team_a"),
      mapGameId: "map_1",
      roundNumber: 19,
      createdAt: "2026-06-05T00:00:00.000Z",
      side: "defense"
    });

    expect(resolveRoundEconomyPhase(19)).toBe("overtime_reset");
    expect(state).toMatchObject({
      tokenBank: 10000,
      buyType: "fullBuy",
      economyPosture: "rifle_buy",
      loadoutPackage: "rifle_full_ct_pack"
    });
  });

  it("keeps posture budgets ordered by evidence visibility", () => {
    expect(outputBudgetForEconomyPosture("rifle_buy")).toBeGreaterThan(outputBudgetForEconomyPosture("half_buy"));
    expect(outputBudgetForEconomyPosture("half_buy")).toBeGreaterThan(outputBudgetForEconomyPosture("eco"));
    expect(outputBudgetForEconomyPosture("eco")).toBeGreaterThan(outputBudgetForEconomyPosture("full_eco"));
    expect(formatEconomyPosture("save_play")).toContain("保");
  });
});

function agent(id: string, teamId: string): Agent {
  return {
    id,
    teamId,
    driverModelId: "driver_test",
    role: "rifler",
    displayName: id,
    baseProfile: {},
    currentState: "ready",
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z"
  } as Agent;
}
