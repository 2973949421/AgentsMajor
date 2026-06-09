import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { HexCell, HexMapAsset } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import { initializeHexRoundMemory, type HexRoundMemory } from "../state/index.js";
import { buildHexAgentCommandRequest, type HexAgentActionDraft } from "./hex-agent-command-boundary.js";
import { validateHexAgentActionDraft } from "./hex-agent-action-validator.js";

describe("Hex agent action validator", () => {
  it("accepts a legal draft within AP budget", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeMemory(asset);
    const request = buildHexAgentCommandRequest({ asset, memory, agentId: "t_0" });
    const draft = buildDraft(request, {
      actionType: "move",
      targetCellId: request.reachableCells[0]!.cellId
    });

    const validated = validateHexAgentActionDraft({ asset, memory, draft });

    expect(validated.valid).toBe(true);
    expect(validated.apCost).toBeGreaterThanOrEqual(0);
    expect(validated.validationErrors).toEqual([]);
  });

  it("rejects unknown, unplayable, and over-budget target cells", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeMemory(asset);
    const request = buildHexAgentCommandRequest({ asset, memory, agentId: "t_1" });
    const unplayableAsset = {
      ...asset,
      cells: [
        ...asset.cells,
        {
          cellId: "h_49_49_l0",
          col: 49,
          row: 49,
          level: 0 as const,
          playable: false,
          terrain: "obstacle" as const,
          flags: [],
          pointIds: []
        }
      ]
    };
    const farCell = findCellWithFlag(asset, "bombsite_a");
    memory.agents = memory.agents.map((agent) => (agent.agentId === "t_1" ? { ...agent, apRemaining: 0.01 } : agent));

    expect(validateHexAgentActionDraft({ asset, memory, draft: buildDraft(request, { targetCellId: "missing" }) }).validationErrors).toContain(
      "unknown_target_cell"
    );
    expect(
      validateHexAgentActionDraft({
        asset: unplayableAsset,
        memory,
        draft: buildDraft(request, { targetCellId: "h_49_49_l0" })
      }).validationErrors
    ).toContain("unplayable_target_cell");
    expect(validateHexAgentActionDraft({ asset, memory, draft: buildDraft(request, { targetCellId: farCell.cellId }) }).validationErrors).toContain(
      "move_over_budget"
    );
  });

  it("rejects phase and current-cell mismatches", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeMemory(asset);
    const request = buildHexAgentCommandRequest({ asset, memory, agentId: "t_0" });
    const validated = validateHexAgentActionDraft({
      asset,
      memory,
      draft: {
        ...buildDraft(request, {}),
        phaseId: "first_contact",
        currentCellId: "wrong_cell"
      }
    });

    expect(validated.validationErrors).toEqual(expect.arrayContaining(["phase_mismatch", "current_cell_mismatch"]));
  });

  it("enforces plant and defuse hard preconditions without writing outcomes", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeMemory(asset);
    const bombsite = findCellWithFlag(asset, "bombsite_a");
    const spawn = findCellWithFlag(asset, "spawn_t");
    const plantMemory = placeAgent(memory, asset, "t_0", bombsite.cellId);
    const request = buildHexAgentCommandRequest({ asset, memory: plantMemory, agentId: "t_0" });

    const legalPlant = validateHexAgentActionDraft({
      asset,
      memory: plantMemory,
      draft: buildDraft(request, { actionType: "plant_bomb", targetCellId: bombsite.cellId })
    });
    const invalidPlant = validateHexAgentActionDraft({
      asset,
      memory: plantMemory,
      draft: buildDraft(request, { actionType: "plant_bomb", targetCellId: spawn.cellId })
    });

    const defenseMemory: HexRoundMemory = {
      ...placeAgent(plantMemory, asset, "ct_0", bombsite.cellId),
      bombState: {
        planted: true,
        defused: false,
        plantedCellId: bombsite.cellId,
        plantedAtPhaseIndex: 1
      }
    };
    const ctRequest = buildHexAgentCommandRequest({ asset, memory: defenseMemory, agentId: "ct_0" });
    const legalDefuse = validateHexAgentActionDraft({
      asset,
      memory: defenseMemory,
      draft: buildDraft(ctRequest, { actionType: "defuse_bomb", targetCellId: bombsite.cellId })
    });
    const tDefuse = validateHexAgentActionDraft({
      asset,
      memory: defenseMemory,
      draft: buildDraft(request, { actionType: "defuse_bomb", targetCellId: bombsite.cellId })
    });

    expect(legalPlant.valid).toBe(true);
    expect(invalidPlant.validationErrors).toContain("plant_requires_bombsite");
    expect(legalDefuse.valid).toBe(true);
    expect(tDefuse.validationErrors).toContain("defuse_requires_defense");
  });
});

function buildDraft(
  request: ReturnType<typeof buildHexAgentCommandRequest>,
  overrides: Partial<HexAgentActionDraft>
): HexAgentActionDraft {
  return {
    agentId: request.agent.agentId,
    phaseId: request.phaseId,
    currentCellId: request.agent.currentCellId,
    targetCellId: request.agent.currentCellId,
    actionType: "hold_position",
    businessIntent: `${request.agent.agentId} validates the team business plan with a legal Hex action.`,
    ...overrides
  };
}

function loadOfficialDust2HexMap(): HexMapAsset {
  const raw = readFileSync(join(process.cwd(), "data/materials/processed/maps/dust2/hex/dust2-hex-map.json"), "utf8");
  return JSON.parse(raw) as HexMapAsset;
}

function initializeMemory(asset: HexMapAsset): HexRoundMemory {
  return initializeHexRoundMemory({
    asset,
    agents: createAgents(asset),
    bombCarrierAgentId: "t_0"
  });
}

function placeAgent(memory: HexRoundMemory, asset: HexMapAsset, agentId: string, cellId: string): HexRoundMemory {
  const cell = asset.cells.find((candidate) => candidate.cellId === cellId);
  if (!cell) {
    throw new Error(`Missing cell ${cellId}`);
  }
  return {
    ...memory,
    agents: memory.agents.map((agent) => {
      if (agent.agentId !== agentId) {
        return agent;
      }
      const placed = {
        ...agent,
        currentCellId: cell.cellId,
        currentPointIds: [...cell.pointIds],
        apBudget: asset.apModel.baseApPerPhase,
        apSpent: 0,
        apRemaining: asset.apModel.baseApPerPhase
      };
      if (cell.regionId) {
        placed.currentRegionId = cell.regionId;
      } else {
        delete placed.currentRegionId;
      }
      return placed;
    })
  };
}

function createAgents(asset: HexMapAsset) {
  const tCells = findCellsWithFlag(asset, "spawn_t");
  const ctCells = findCellsWithFlag(asset, "spawn_ct");
  return [
    ...Array.from({ length: 5 }, (_, index) => ({
      agentId: `t_${index}`,
      teamId: "t",
      side: "attack" as const,
      startCellId: tCells[index % tCells.length]!.cellId,
      carryingC4: index === 0
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      agentId: `ct_${index}`,
      teamId: "ct",
      side: "defense" as const,
      startCellId: ctCells[index % ctCells.length]!.cellId
    }))
  ];
}

function findCellWithFlag(asset: HexMapAsset, flag: HexCell["flags"][number]): HexCell {
  const cell = findCellsWithFlag(asset, flag)[0];
  if (!cell) {
    throw new Error(`Missing ${flag}`);
  }
  return cell;
}

function findCellsWithFlag(asset: HexMapAsset, flag: HexCell["flags"][number]): HexCell[] {
  const cells = asset.cells.filter((cell) => cell.playable && cell.flags.includes(flag));
  if (cells.length === 0) {
    throw new Error(`Missing ${flag}`);
  }
  return cells;
}
