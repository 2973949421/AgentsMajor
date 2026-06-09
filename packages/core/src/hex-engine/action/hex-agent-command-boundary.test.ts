import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { HexCell, HexMapAsset } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import type { TeamEconomyPlan } from "../../economy/economy-rules.js";
import { buildHexRoundEconomyContext } from "../economy/index.js";
import { initializeHexRoundMemory } from "../state/index.js";
import { buildHexAgentCommandRequest, normalizeHexAgentActionDraft } from "./hex-agent-command-boundary.js";

describe("Hex agent command boundary", () => {
  it("builds a compact request from phase memory without treating last-seen as current truth", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeHexRoundMemory({
      asset,
      agents: createAgents(asset),
      bombCarrierAgentId: "t_0"
    });
    memory.agents[0]!.lastSeenEnemies = [
      {
        enemyAgentId: "ct_0",
        enemyTeamId: "ct",
        cellId: memory.agents[5]!.currentCellId,
        pointIds: [],
        source: "spotted_event",
        seenAtPhaseIndex: 0,
        confidence: 0.65,
        lastSeenPhaseIndex: 0,
        stale: false,
        historical: true
      }
    ];

    const request = buildHexAgentCommandRequest({
      asset,
      memory,
      agentId: "t_0"
    });

    expect(request.agent.agentId).toBe("t_0");
    expect(request.reachableCells.length).toBeGreaterThan(0);
    expect(request.lastSeenEnemies[0]?.note).toBe("historical_last_seen_not_current_truth");
    expect(request.constraints.some((line) => line.includes("Do not output winner"))).toBe(true);
  });

  it("normalizes a valid draft and records forbidden fields as ignored", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeHexRoundMemory({
      asset,
      agents: createAgents(asset),
      bombCarrierAgentId: "t_0"
    });
    const request = buildHexAgentCommandRequest({
      asset,
      memory,
      agentId: "t_0"
    });

    const result = normalizeHexAgentActionDraft({
      request,
      rawDraft: {
        agentId: "t_0",
        phaseId: request.phaseId,
        currentCellId: request.agent.currentCellId,
        targetCellId: request.reachableCells[0]!.cellId,
        actionType: "move",
        businessIntent: "t_0 uses movement to test the team business plan pressure route.",
        winner: "t",
        kills: ["ct_0"]
      }
    });

    expect(result.errors).toEqual([]);
    expect(result.draft?.targetCellId).toBe(request.reachableCells[0]!.cellId);
    expect(result.ignoredFields).toEqual(expect.arrayContaining(["winner", "kills"]));
  });

  it("adds compact economy context when provided", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeHexRoundMemory({
      asset,
      agents: createAgents(asset),
      bombCarrierAgentId: "t_0"
    });
    const economyContext = buildHexRoundEconomyContext({
      memory,
      teamEconomyPlans: {
        t: buildPlan("t", "rifle_buy", "fullBuy", ["t_0", "t_1", "t_2", "t_3", "t_4"]),
        ct: buildPlan("ct", "eco", "eco", ["ct_0", "ct_1", "ct_2", "ct_3", "ct_4"])
      }
    });

    const request = buildHexAgentCommandRequest({
      asset,
      memory,
      agentId: "t_0",
      economyContext
    });

    expect(request.economy?.economyPosture).toBe("rifle_buy");
    expect(request.economy?.resourceTier).toBe("high");
    expect(request.economy?.economyAllowedActionTypes).toContain("execute_site");
    expect(request.constraints.some((line) => line.includes("Economy context is already resolved"))).toBe(true);
  });

  it("rejects malformed drafts before validation", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeHexRoundMemory({
      asset,
      agents: createAgents(asset),
      bombCarrierAgentId: "t_0"
    });
    const request = buildHexAgentCommandRequest({
      asset,
      memory,
      agentId: "t_0"
    });

    const result = normalizeHexAgentActionDraft({
      request,
      rawDraft: {
        agentId: "unknown",
        phaseId: "wrong_phase",
        currentCellId: "wrong_cell",
        targetCellId: "",
        actionType: "teleport",
        businessIntent: ""
      }
    });

    expect(result.draft).toBeUndefined();
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "draft:invalid_agentId",
        "draft:invalid_phaseId",
        "draft:invalid_currentCellId",
        "draft:missing_targetCellId",
        "draft:invalid_actionType",
        "draft:missing_businessIntent"
      ])
    );
  });
});

function loadOfficialDust2HexMap(): HexMapAsset {
  const raw = readFileSync(join(process.cwd(), "data/materials/processed/maps/dust2/hex/dust2-hex-map.json"), "utf8");
  return JSON.parse(raw) as HexMapAsset;
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
    totalCash: 20000,
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
      outputBudget: buyType === "eco" ? 420 : 1200,
      dropSent: 0,
      dropReceived: 0,
      notes: []
    }))
  };
}
