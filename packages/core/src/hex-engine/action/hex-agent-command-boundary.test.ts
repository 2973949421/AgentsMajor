import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { HexCell, HexMapAsset } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

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
