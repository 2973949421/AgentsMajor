import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Artifact } from "@agent-major/shared";
import type { HexCell, HexMapAsset } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import type { ArtifactStore, ArtifactWriteInput } from "../../ports.js";
import { initializeHexRoundMemory, type HexRoundMemory } from "../state/index.js";
import {
  createEnvHexAgentCommandProvider,
  createFixtureHexAgentCommandProvider,
  runHexAgentPhaseCommandHarness,
  type HexAgentCommandProvider
} from "./hex-agent-command-harness.js";

describe("Hex agent command harness", () => {
  it("calls fixture provider once for each actionable agent", async () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeMemory(asset);

    const result = await runHexAgentPhaseCommandHarness({
      asset,
      memory,
      provider: createFixtureHexAgentCommandProvider(),
      providerMode: "fixture"
    });

    expect(result.totalCallsAttempted).toBe(10);
    expect(result.actions).toHaveLength(10);
    expect(result.acceptedActions).toHaveLength(10);
    expect(result.fallbackCount).toBe(0);
    expect(result.audits.every((audit) => audit.called && audit.accepted)).toBe(true);
  });

  it("skips dead and AP-empty agents without calling provider", async () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeMemory(asset);
    memory.agents = memory.agents.map((agent) => {
      if (agent.agentId === "t_0") {
        return { ...agent, lifeStatus: "dead" as const, apRemaining: 0 };
      }
      if (agent.agentId === "t_1") {
        return { ...agent, apRemaining: 0 };
      }
      return agent;
    });

    const result = await runHexAgentPhaseCommandHarness({
      asset,
      memory,
      provider: createFixtureHexAgentCommandProvider(),
      providerMode: "fixture"
    });

    expect(result.totalCallsAttempted).toBe(8);
    expect(result.fallbackActions.map((action) => action.agentId)).toEqual(expect.arrayContaining(["t_0", "t_1"]));
    expect(result.audits.filter((audit) => !audit.called)).toHaveLength(2);
  });

  it("falls back after max calls are exhausted", async () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeMemory(asset);

    const result = await runHexAgentPhaseCommandHarness({
      asset,
      memory,
      provider: createFixtureHexAgentCommandProvider(),
      providerMode: "fixture",
      maxLlmCalls: 3
    });

    expect(result.totalCallsAttempted).toBe(3);
    expect(result.acceptedActions).toHaveLength(3);
    expect(result.fallbackActions).toHaveLength(7);
    expect(result.audits.filter((audit) => audit.fallbackReason === "max_llm_calls_reached")).toHaveLength(7);
  });

  it("records rejected drafts and forbidden fields without accepting bad output", async () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeMemory(asset);
    const provider: HexAgentCommandProvider = (request) => ({
      providerMode: "fixture",
      modelId: "bad_fixture",
      rawDraft: {
        agentId: request.agent.agentId,
        phaseId: request.phaseId,
        currentCellId: request.agent.currentCellId,
        targetCellId: "missing",
        actionType: "move",
        businessIntent: "bad fixture still includes business intent",
        winner: "t",
        kills: ["ct_0"]
      }
    });

    const result = await runHexAgentPhaseCommandHarness({
      asset,
      memory,
      provider,
      providerMode: "fixture",
      maxLlmCalls: 1
    });

    expect(result.totalCallsAttempted).toBe(1);
    expect(result.acceptedActions).toHaveLength(0);
    expect(result.fallbackActions.length).toBeGreaterThan(0);
    expect(result.rejectedDrafts[0]?.errors).toEqual(expect.arrayContaining(["unknown_target_cell"]));
    expect(result.rejectedDrafts[0]?.ignoredFields).toEqual(expect.arrayContaining(["winner", "kills"]));
  });

  it("emits per-agent progress events for request, response, repair, and acceptance", async () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeMemory(asset);
    const artifactStore = new MemoryArtifactStore();
    const events: string[] = [];
    const provider: HexAgentCommandProvider = (request) => ({
      providerMode: "fixture",
      modelId: "progress_fixture",
      rawDraft: {
        agentId: request.agent.agentId,
        phaseId: "wrong_phase",
        currentCellId: "wrong_cell",
        targetCellId: request.targetCandidates[0]?.targetCellId ?? request.agent.currentCellId,
        actionType: "move",
        businessIntent: "progress fixture advances to a candidate target and records repaired context fields."
      }
    });

    const result = await runHexAgentPhaseCommandHarness({
      asset,
      memory,
      provider,
      providerMode: "fixture",
      maxLlmCalls: 1,
      artifactStore,
      artifactOwner: {
        ownerType: "hex_test",
        ownerId: "hex_test_owner"
      },
      progressSink: (event) => {
        events.push(`${event.agentId}:${event.status}`);
      }
    });

    expect(result.acceptedActions).toHaveLength(1);
    expect(events).toEqual(
      expect.arrayContaining([
        "t_0:queued",
        "t_0:running",
        "t_0:request_artifact_written",
        "t_0:response_artifact_written",
        "t_0:repaired",
        "t_0:accepted"
      ])
    );
  });

  it("falls back on provider error and keeps request artifact audit", async () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeMemory(asset);
    const artifactStore = new MemoryArtifactStore();

    const result = await runHexAgentPhaseCommandHarness({
      asset,
      memory,
      provider: () => {
        throw new Error("provider_down");
      },
      providerMode: "fixture",
      maxLlmCalls: 1,
      artifactStore,
      artifactOwner: {
        ownerType: "hex_test",
        ownerId: "hex_test_owner"
      }
    });

    expect(result.totalCallsAttempted).toBe(1);
    expect(result.audits[0]?.requestArtifactId).toBe("artifact_1");
    expect(result.audits[0]?.errors[0]).toContain("provider_error:provider_down");
    expect(artifactStore.writes).toHaveLength(1);
  });

  it("rejects accepted drafts that target another alive agent's occupied cell", async () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeMemory(asset);
    const occupiedCellId = memory.agents.find((agent) => agent.agentId === "t_0")!.currentCellId;
    const provider: HexAgentCommandProvider = (request) => ({
      providerMode: "fixture",
      modelId: "collision_fixture",
      rawDraft: {
        agentId: request.agent.agentId,
        phaseId: request.phaseId,
        currentCellId: request.agent.currentCellId,
        targetCellId: request.agent.agentId === "t_1" ? occupiedCellId : request.agent.currentCellId,
        actionType: request.agent.agentId === "t_1" ? "move" : "hold_position",
        businessIntent: "collision fixture checks that alive agents cannot stack on the same Hex cell."
      }
    });

    const result = await runHexAgentPhaseCommandHarness({
      asset,
      memory,
      provider,
      providerMode: "fixture",
      maxLlmCalls: 2
    });

    const rejected = result.actions.find((action) => action.agentId === "t_1");
    expect(rejected?.valid).toBe(false);
    expect(rejected?.validationErrors).toContain("target_cell_occupied");
    expect(rejected?.fallbackReason).toBe("target_cell_occupied");
  });

  it("does not treat an enemy occupied cell as a friendly stacking rejection", async () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeMemory(asset);
    const [attackCell, defenseCell] = asset.cells.filter((cell) => cell.playable && cell.regionId === "a_site").slice(0, 2);
    if (!attackCell || !defenseCell) {
      throw new Error("Missing a_site fixture cells");
    }
    memory.agents = memory.agents.map((agent) => {
      if (agent.agentId === "t_0") return { ...agent, currentCellId: attackCell.cellId, currentRegionId: "a_site", currentPointIds: [...attackCell.pointIds] };
      if (agent.agentId === "ct_0") return { ...agent, currentCellId: defenseCell.cellId, currentRegionId: "a_site", currentPointIds: [...defenseCell.pointIds] };
      return agent;
    });
    const provider: HexAgentCommandProvider = (request) => ({
      providerMode: "fixture",
      modelId: "enemy_contact_fixture",
      rawDraft: {
        agentId: request.agent.agentId,
        phaseId: request.phaseId,
        currentCellId: request.agent.currentCellId,
        targetCellId: defenseCell.cellId,
        actionType: "seek_duel",
        businessIntent: "t_0 accepts enemy contact on A site to test that enemy occupied cells are combat pressure, not friendly stacking."
      }
    });

    const result = await runHexAgentPhaseCommandHarness({
      asset,
      memory,
      provider,
      providerMode: "fixture",
      maxLlmCalls: 1
    });

    const action = result.actions.find((candidate) => candidate.agentId === "t_0");
    expect(action?.valid).toBe(true);
    expect(action?.validationErrors).not.toContain("target_cell_occupied");
  });

  it("returns disabled real provider when env is missing", async () => {
    const factory = createEnvHexAgentCommandProvider({});
    const asset = loadOfficialDust2HexMap();
    const memory = initializeMemory(asset);

    const result = await runHexAgentPhaseCommandHarness({
      asset,
      memory,
      provider: factory.provider,
      providerMode: factory.providerMode,
      modelId: factory.modelId,
      maxLlmCalls: 1
    });

    expect(result.audits[0]?.errors[0]).toContain("real_llm_disabled");
    expect(result.audits[0]?.providerMode).toBe("real");
  });
});

class MemoryArtifactStore implements ArtifactStore {
  readonly writes: ArtifactWriteInput[] = [];

  async write(input: ArtifactWriteInput): Promise<Artifact> {
    this.writes.push(input);
    return {
      id: `artifact_${this.writes.length}`
    } as Artifact;
  }

  async readText(): Promise<string> {
    return "";
  }
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
