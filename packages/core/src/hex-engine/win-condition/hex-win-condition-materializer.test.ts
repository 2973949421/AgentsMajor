import { describe, expect, it } from "vitest";

import type { HexRoundMemory } from "../state/index.js";
import { materializeHexWinCondition } from "./hex-win-condition-materializer.js";

describe("Hex win condition materializer", () => {
  it("awards defense elimination when all attack agents are dead", () => {
    const result = materializeHexWinCondition({
      memory: buildMemory({ attackAlive: 0, defenseAlive: 2 }),
      phaseId: "first_contact",
      phaseIndex: 1,
      maxPhaseIndex: 4,
      attackTeamId: "team_t",
      defenseTeamId: "team_ct"
    });

    expect(result.isRoundOver).toBe(true);
    expect(result.winnerTeamId).toBe("team_ct");
    expect(result.judgeRoundWinType).toBe("defense_elimination");
  });

  it("awards attack elimination when all defense agents are dead", () => {
    const result = materializeHexWinCondition({
      memory: buildMemory({ attackAlive: 3, defenseAlive: 0 }),
      phaseId: "first_contact",
      phaseIndex: 1,
      maxPhaseIndex: 4,
      attackTeamId: "team_t",
      defenseTeamId: "team_ct"
    });

    expect(result.isRoundOver).toBe(true);
    expect(result.winnerTeamId).toBe("team_t");
    expect(result.judgeRoundWinType).toBe("attack_elimination");
  });

  it("awards defense defuse when C4 is defused", () => {
    const result = materializeHexWinCondition({
      memory: {
        ...buildMemory({ attackAlive: 2, defenseAlive: 2 }),
        bombState: { planted: true, plantedCellId: "h_1_1_l0", defused: true }
      },
      phaseId: "post_plant_or_clutch",
      phaseIndex: 4,
      maxPhaseIndex: 4,
      attackTeamId: "team_t",
      defenseTeamId: "team_ct"
    });

    expect(result.judgeRoundWinType).toBe("defense_defuse");
  });

  it("awards attack bomb explosion in final phase when C4 remains planted", () => {
    const result = materializeHexWinCondition({
      memory: {
        ...buildMemory({ attackAlive: 2, defenseAlive: 2 }),
        bombState: { planted: true, plantedCellId: "h_1_1_l0", defused: false }
      },
      phaseId: "post_plant_or_clutch",
      phaseIndex: 4,
      maxPhaseIndex: 4,
      attackTeamId: "team_t",
      defenseTeamId: "team_ct"
    });

    expect(result.winnerTeamId).toBe("team_t");
    expect(result.judgeRoundWinType).toBe("attack_bomb_explosion");
  });

  it("awards defense timeout in final phase without plant", () => {
    const result = materializeHexWinCondition({
      memory: buildMemory({ attackAlive: 2, defenseAlive: 2 }),
      phaseId: "post_plant_or_clutch",
      phaseIndex: 4,
      maxPhaseIndex: 4,
      attackTeamId: "team_t",
      defenseTeamId: "team_ct"
    });

    expect(result.winnerTeamId).toBe("team_ct");
    expect(result.judgeRoundWinType).toBe("defense_timeout_no_plant");
  });

  it("continues before a hard condition exists", () => {
    const result = materializeHexWinCondition({
      memory: buildMemory({ attackAlive: 2, defenseAlive: 2 }),
      phaseId: "mid_round_decision",
      phaseIndex: 2,
      maxPhaseIndex: 4,
      attackTeamId: "team_t",
      defenseTeamId: "team_ct"
    });

    expect(result.isRoundOver).toBe(false);
    expect(result.winnerTeamId).toBeUndefined();
  });
});

function buildMemory(input: { attackAlive: number; defenseAlive: number }): HexRoundMemory {
  return {
    phaseIndex: 0,
    phaseId: "default_opening",
    agents: [
      ...Array.from({ length: 5 }, (_, index) => ({
        agentId: `t_${index}`,
        teamId: "team_t",
        side: "attack" as const,
        currentCellId: "h_1_1_l0",
        currentPointIds: [],
        lifeStatus: index < input.attackAlive ? "alive" as const : "dead" as const,
        apBudget: 3,
        apSpent: 0,
        apRemaining: index < input.attackAlive ? 3 : 0,
        knownEnemies: [],
        lastSeenEnemies: [],
        carryingC4: index === 0
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        agentId: `ct_${index}`,
        teamId: "team_ct",
        side: "defense" as const,
        currentCellId: "h_2_2_l0",
        currentPointIds: [],
        lifeStatus: index < input.defenseAlive ? "alive" as const : "dead" as const,
        apBudget: 3,
        apSpent: 0,
        apRemaining: index < input.defenseAlive ? 3 : 0,
        knownEnemies: [],
        lastSeenEnemies: [],
        carryingC4: false
      }))
    ],
    bombState: {
      carrierAgentId: "t_0",
      planted: false,
      defused: false
    },
    phaseEvents: [],
    rejectedEvents: []
  };
}
