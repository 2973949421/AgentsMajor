import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { HexCell, HexMapAsset } from "@agent-major/shared";
import { validateHexMoveBudget } from "../path/index.js";
import {
  advanceHexPhaseMemory,
  buildHexAgentMemoryContext,
  initializeHexRoundMemory,
  type HexInitialAgentInput,
  type HexRoundMemory
} from "./hex-phase-memory.js";

describe("Hex phase memory", () => {
  it("initializes ten agent memories on playable Dust2 cells", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeHexRoundMemory({
      asset,
      agents: createTenAgents(asset),
      bombCarrierAgentId: "t_0"
    });

    expect(memory.phaseId).toBe("default_opening");
    expect(memory.phaseIndex).toBe(0);
    expect(memory.agents).toHaveLength(10);
    expect(memory.bombState.carrierAgentId).toBe("t_0");
    expect(memory.agents.every((agent) => agent.apBudget === 3 && agent.apRemaining === 3)).toBe(true);
    expect(memory.agents.find((agent) => agent.agentId === "t_0")?.carryingC4).toBe(true);
  });

  it("moves an alive agent through pathfinding and spends fractional AP", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeMemory(asset);
    const mover = requireAgent(memory, "t_1");
    const targetCellId = findReachableStep(asset, mover.currentCellId);

    const nextMemory = advanceHexPhaseMemory({
      asset,
      previousMemory: memory,
      nextPhaseId: "first_contact",
      events: [
        {
          type: "move",
          agentId: "t_1",
          toCellId: targetCellId
        }
      ]
    });
    const movedAgent = requireAgent(nextMemory, "t_1");

    expect(movedAgent.currentCellId).toBe(targetCellId);
    expect(movedAgent.apSpent).toBeGreaterThan(0);
    expect(movedAgent.apRemaining).toBeLessThan(3);
    expect(nextMemory.rejectedEvents).toEqual([]);
  });

  it("rejects over-budget and unknown-cell moves without changing location", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeMemory(asset);
    const originalCellId = requireAgent(memory, "t_2").currentCellId;
    memory.agents = memory.agents.map((agent) => (agent.agentId === "t_2" ? { ...agent, apRemaining: 0.01 } : agent));
    const expensiveTarget = findCellWithFlag(asset, "bombsite_a").cellId;

    const nextMemory = advanceHexPhaseMemory({
      asset,
      previousMemory: memory,
      nextPhaseId: "first_contact",
      events: [
        {
          type: "move",
          agentId: "t_2",
          toCellId: expensiveTarget
        },
        {
          type: "move",
          agentId: "t_2",
          toCellId: "missing_cell"
        }
      ]
    });
    const agent = requireAgent(nextMemory, "t_2");

    expect(agent.currentCellId).toBe(originalCellId);
    expect(nextMemory.rejectedEvents.map((event) => event.reason)).toEqual(["move_over_budget", "unknown_cell"]);
  });

  it("keeps dead agents from acting and resets living AP on phase advance", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeMemory(asset);
    const targetCellId = findReachableStep(asset, requireAgent(memory, "ct_0").currentCellId);

    const deadMemory = advanceHexPhaseMemory({
      asset,
      previousMemory: memory,
      nextPhaseId: "first_contact",
      events: [
        {
          type: "life_status_changed",
          agentId: "ct_0",
          lifeStatus: "dead"
        }
      ]
    });
    const attemptedMove = advanceHexPhaseMemory({
      asset,
      previousMemory: deadMemory,
      nextPhaseId: "mid_round_decision",
      events: [
        {
          type: "move",
          agentId: "ct_0",
          toCellId: targetCellId
        }
      ]
    });

    expect(requireAgent(deadMemory, "ct_0").apRemaining).toBe(0);
    expect(requireAgent(attemptedMove, "ct_0").lifeStatus).toBe("dead");
    expect(attemptedMove.rejectedEvents.at(-1)?.reason).toBe("dead_agent_cannot_act");
    expect(requireAgent(attemptedMove, "t_0").apRemaining).toBe(3);
  });

  it("tracks known enemies, demotes them to historical last-seen data, and marks stale sightings", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeMemory(asset);
    const enemyCellId = requireAgent(memory, "ct_0").currentCellId;

    const spotted = advanceHexPhaseMemory({
      asset,
      previousMemory: memory,
      nextPhaseId: "first_contact",
      events: [
        {
          type: "enemy_spotted",
          observerAgentId: "t_0",
          enemyAgentId: "ct_0",
          enemyTeamId: "ct",
          enemyCellId,
          source: "spotted_event"
        }
      ]
    });
    const demoted = advanceHexPhaseMemory({
      asset,
      previousMemory: spotted,
      nextPhaseId: "mid_round_decision",
      events: []
    });
    const stale = advanceHexPhaseMemory({
      asset,
      previousMemory: advanceHexPhaseMemory({
        asset,
        previousMemory: demoted,
        nextPhaseId: "execute_or_retake",
        events: []
      }),
      nextPhaseId: "post_plant_or_clutch",
      events: []
    });
    const context = buildHexAgentMemoryContext({
      memory: demoted,
      agentId: "t_0"
    });

    expect(requireAgent(spotted, "t_0").knownEnemies).toHaveLength(1);
    expect(requireAgent(demoted, "t_0").knownEnemies).toEqual([]);
    expect(requireAgent(demoted, "t_0").lastSeenEnemies[0]?.historical).toBe(true);
    expect(context.lastSeenEnemies[0]?.note).toBe("historical_last_seen_not_current_truth");
    expect(requireAgent(stale, "t_0").lastSeenEnemies[0]?.stale).toBe(true);
  });

  it("inherits C4 carrier and planted state without writing a winner", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeMemory(asset);
    const bombsiteCellId = findCellWithFlag(asset, "bombsite_a").cellId;

    const planted = advanceHexPhaseMemory({
      asset,
      previousMemory: memory,
      nextPhaseId: "execute_or_retake",
      events: [
        {
          type: "bomb_planted",
          agentId: "t_0",
          cellId: bombsiteCellId
        }
      ]
    });
    const defused = advanceHexPhaseMemory({
      asset,
      previousMemory: planted,
      nextPhaseId: "post_plant_or_clutch",
      events: [
        {
          type: "bomb_defused",
          agentId: "ct_0"
        }
      ]
    });

    expect(planted.bombState.planted).toBe(true);
    expect(planted.bombState.plantedCellId).toBe(bombsiteCellId);
    expect(planted.bombState.carrierAgentId).toBeUndefined();
    expect(defused.bombState.defused).toBe(true);
  });

  it("rejects planting outside a bombsite or without C4", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeMemory(asset);
    const nonBombsiteCellId = findCellWithFlag(asset, "spawn_t").cellId;
    const bombsiteCellId = findCellWithFlag(asset, "bombsite_b").cellId;

    const result = advanceHexPhaseMemory({
      asset,
      previousMemory: memory,
      nextPhaseId: "execute_or_retake",
      events: [
        {
          type: "bomb_planted",
          agentId: "t_0",
          cellId: nonBombsiteCellId
        },
        {
          type: "bomb_planted",
          agentId: "t_1",
          cellId: bombsiteCellId
        }
      ]
    });

    expect(result.bombState.planted).toBe(false);
    expect(result.rejectedEvents.map((event) => event.reason)).toEqual(["invalid_bombsite", "agent_not_carrying_c4"]);
  });
});

function loadOfficialDust2HexMap(): HexMapAsset {
  const raw = readFileSync(join(process.cwd(), "data/materials/processed/maps/dust2/hex/dust2-hex-map.json"), "utf8");
  return JSON.parse(raw) as HexMapAsset;
}

function initializeMemory(asset: HexMapAsset): HexRoundMemory {
  return initializeHexRoundMemory({
    asset,
    agents: createTenAgents(asset),
    bombCarrierAgentId: "t_0"
  });
}

function createTenAgents(asset: HexMapAsset): HexInitialAgentInput[] {
  const tSpawnCells = findCellsWithFlag(asset, "spawn_t");
  const ctSpawnCells = findCellsWithFlag(asset, "spawn_ct");
  return [
    ...Array.from({ length: 5 }, (_, index) => ({
      agentId: `t_${index}`,
      teamId: "t",
      side: "attack" as const,
      startCellId: tSpawnCells[index % tSpawnCells.length]!.cellId,
      carryingC4: index === 0
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      agentId: `ct_${index}`,
      teamId: "ct",
      side: "defense" as const,
      startCellId: ctSpawnCells[index % ctSpawnCells.length]!.cellId
    }))
  ];
}

function findCellWithFlag(asset: HexMapAsset, flag: HexCell["flags"][number]): HexCell {
  const cell = findCellsWithFlag(asset, flag)[0];
  if (!cell) {
    throw new Error(`Missing playable cell with flag ${flag}`);
  }
  return cell;
}

function findCellsWithFlag(asset: HexMapAsset, flag: HexCell["flags"][number]): HexCell[] {
  const cells = asset.cells.filter((cell) => cell.playable && cell.flags.includes(flag));
  if (cells.length === 0) {
    throw new Error(`Missing playable cells with flag ${flag}`);
  }
  return cells;
}

function findReachableStep(asset: HexMapAsset, fromCellId: string): string {
  const target = asset.cells.find(
    (cell) => cell.playable && cell.cellId !== fromCellId && validateHexMoveBudget({ asset, fromCellId, toCellId: cell.cellId }).withinBudget
  );
  if (!target) {
    throw new Error(`No reachable step from ${fromCellId}`);
  }
  return target.cellId;
}

function requireAgent(memory: HexRoundMemory, agentId: string) {
  const agent = memory.agents.find((candidate) => candidate.agentId === agentId);
  if (!agent) {
    throw new Error(`Missing agent ${agentId}`);
  }
  return agent;
}
