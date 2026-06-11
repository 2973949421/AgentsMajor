import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { HexCell, HexMapAsset } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import type { TeamEconomyPlan } from "../../economy/economy-rules.js";
import { buildHexRoundEconomyContext } from "../economy/index.js";
import { initializeHexRoundMemory, type HexRoundMemory } from "../state/index.js";
import { buildHexAgentCommandRequest, type HexAgentActionDraft } from "./hex-agent-command-boundary.js";
import { validateHexAgentActionDraft } from "./hex-agent-action-validator.js";

describe("Hex agent action validator", () => {
  it("accepts a legal draft within AP budget", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeMemory(asset);
    const request = buildHexAgentCommandRequest({ asset, memory, agentId: "t_0" });
    const target = request.reachableCells.find((cell) => cell.cellId !== request.agent.currentCellId)!;
    const draft = buildDraft(request, {
      actionType: "move",
      targetCellId: target.cellId
    });

    const validated = validateHexAgentActionDraft({ asset, memory, draft });

    expect(validated.valid).toBe(true);
    expect(validated.apCost).toBeGreaterThanOrEqual(0);
    expect(validated.pathCellIds.at(0)).toBe(request.agent.currentCellId);
    expect(validated.pathCellIds.at(-1)).toBe(target.cellId);
    expect(validated.pathSource).toBe("pathfinding");
    expect(validated.validationErrors).toEqual([]);
  });

  it("rejects move actions that do not change position while allowing explicit holds", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeMemory(asset);
    const request = buildHexAgentCommandRequest({ asset, memory, agentId: "t_0" });

    const move = validateHexAgentActionDraft({
      asset,
      memory,
      draft: buildDraft(request, {
        actionType: "move",
        targetCellId: request.agent.currentCellId
      })
    });
    const hold = validateHexAgentActionDraft({
      asset,
      memory,
      draft: buildDraft(request, {
        actionType: "hold_position",
        targetCellId: request.agent.currentCellId
      })
    });

    expect(move.validationErrors).toContain("move_requires_position_change");
    expect(move.valid).toBe(false);
    expect(hold.valid).toBe(true);
  });

  it("rejects economy-disallowed actions without bypassing path or AP validation", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeMemory(asset);
    const economyContext = buildHexRoundEconomyContext({
      memory,
      teamEconomyPlans: {
        t: buildPlan("t", "full_eco", "eco", ["t_0", "t_1", "t_2", "t_3", "t_4"]),
        ct: buildPlan("ct", "rifle_buy", "fullBuy", ["ct_0", "ct_1", "ct_2", "ct_3", "ct_4"])
      }
    });
    const request = buildHexAgentCommandRequest({ asset, memory, agentId: "t_0", economyContext });

    const execute = validateHexAgentActionDraft({
      asset,
      memory,
      economyContext,
      draft: buildDraft(request, {
        actionType: "execute_site",
        targetCellId: request.agent.currentCellId
      })
    });
    const utility = validateHexAgentActionDraft({
      asset,
      memory,
      economyContext,
      draft: buildDraft(request, {
        actionType: "use_utility",
        targetCellId: request.agent.currentCellId
      })
    });
    const save = validateHexAgentActionDraft({
      asset,
      memory,
      economyContext,
      draft: buildDraft(request, {
        actionType: "save",
        targetCellId: request.agent.currentCellId
      })
    });

    expect(execute.validationErrors).toEqual(expect.arrayContaining(["economy_disallows_action", "resource_tier_too_low"]));
    expect(utility.validationErrors).toEqual(expect.arrayContaining(["economy_disallows_action", "utility_unavailable"]));
    expect(save.valid).toBe(true);
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
    const lowEconomyContext = buildHexRoundEconomyContext({
      memory: plantMemory,
      teamEconomyPlans: {
        t: buildPlan("t", "full_eco", "eco", ["t_0", "t_1", "t_2", "t_3", "t_4"]),
        ct: buildPlan("ct", "rifle_buy", "fullBuy", ["ct_0", "ct_1", "ct_2", "ct_3", "ct_4"])
      }
    });
    const legalPlantUnderLowEconomy = validateHexAgentActionDraft({
      asset,
      memory: plantMemory,
      economyContext: lowEconomyContext,
      draft: buildDraft(request, { actionType: "plant_bomb", targetCellId: bombsite.cellId })
    });
    const invalidPlant = validateHexAgentActionDraft({
      asset,
      memory: plantMemory,
      draft: buildDraft(request, { actionType: "plant_bomb", targetCellId: spawn.cellId })
    });
    const repairedMoveToPlant = validateHexAgentActionDraft({
      asset,
      memory: plantMemory,
      draft: buildDraft(request, {
        actionType: "move",
        targetCellId: bombsite.cellId,
        businessIntent: "Carry the C4 into the site and plant the bomb for the team plan."
      })
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
    expect(legalPlantUnderLowEconomy.valid).toBe(true);
    expect(legalPlantUnderLowEconomy.validationErrors).not.toContain("economy_disallows_action");
    expect(repairedMoveToPlant.valid).toBe(true);
    expect(repairedMoveToPlant.actionType).toBe("plant_bomb");
    expect(repairedMoveToPlant.repairReasons).toContain("repaired_move_to_plant_intent");
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

function buildPlan(
  teamId: string,
  posture: TeamEconomyPlan["posture"],
  buyType: TeamEconomyPlan["summaryBuyType"],
  agentIds: string[]
): TeamEconomyPlan {
  return {
    teamId,
    side: teamId === "ct" ? "defense" : "attack",
    phase: "gun_round",
    lossCount: 0,
    posture,
    postureReason: "test plan",
    summaryBuyType: buyType,
    totalCash: buyType === "eco" ? 5000 : 25000,
    dropDecisions: [],
    decisions: agentIds.map((agentId) => ({
      agentId,
      teamId,
      tokenBankBefore: buyType === "eco" ? 1000 : 6000,
      tokenBankAfterDrop: buyType === "eco" ? 1000 : 6000,
      buyType,
      economyPosture: posture,
      loadoutPackage: buyType === "eco" ? "pistol_round_pack" : "rifle_full_t_pack",
      spend: buyType === "eco" ? 800 : 4500,
      outputBudget: buyType === "eco" ? 360 : 1200,
      dropSent: 0,
      dropReceived: 0,
      notes: []
    }))
  };
}
