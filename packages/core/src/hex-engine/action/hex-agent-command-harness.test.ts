import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Artifact } from "@agent-major/shared";
import type { HexCell, HexMapAsset } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import type { ArtifactStore, ArtifactWriteInput } from "../../ports.js";
import { initializeHexRoundMemory, type HexRoundMemory } from "../state/index.js";
import {
  buildRealHexAgentCommandMessages,
  createEnvHexAgentCommandProvider,
  createFixtureHexAgentCommandProvider,
  runHexAgentPhaseCommandHarness,
  type HexAgentCommandProvider
} from "./hex-agent-command-harness.js";
import { buildHexAgentCommandRequest, buildHexAgentCompactCommandRequest } from "./hex-agent-command-boundary.js";

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
        businessIntent: "推进到候选点位，用中文记录商业攻防意图，并验证上下文字段修复。"
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
    const requestArtifact = JSON.parse(String(artifactStore.writes[0]?.content ?? "{}"));
    const responseArtifact = JSON.parse(String(artifactStore.writes[1]?.content ?? "{}"));
    expect(requestArtifact.fullRequest.reachableCells.length).toBeGreaterThan(0);
    expect(requestArtifact.compactRequest.requestMode).toBe("compact_match");
    expect(requestArtifact.compactRequest.reachableCells).toBeUndefined();
    expect(requestArtifact.requestSizeMetrics.estimatedReductionRatio).toBeGreaterThan(0.4);
    expect(responseArtifact.semanticLanguageAudit.languageMismatch).toBe(false);
    expect(responseArtifact.requestSizeMetrics.compactRequestCharLength).toBeLessThan(responseArtifact.requestSizeMetrics.fullRequestCharLength);
    expect(result.audits[0]?.requestSizeMetrics?.estimatedReductionRatio).toBeGreaterThan(0.4);
    expect(result.audits[0]?.languageMismatch).toBe(false);
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

  it("retries one provider exception and records recovered provider errors without fallback", async () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeMemory(asset);
    const artifactStore = new MemoryArtifactStore();
    const events: string[] = [];
    let attempts = 0;

    const result = await runHexAgentPhaseCommandHarness({
      asset,
      memory,
      provider: (request) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("transient_provider_down");
        }
        return {
          providerMode: "real",
          modelId: "retry_fixture",
          rawDraft: {
            agentId: request.agent.agentId,
            phaseId: request.phaseId,
            currentCellId: request.agent.currentCellId,
            targetCellId: request.targetCandidates[0]?.targetCellId ?? request.agent.currentCellId,
            actionType: request.targetCandidates[0] ? "move" : "hold_position",
            businessIntent: "\u91cd\u8bd5\u6062\u590d\u540e\u6267\u884c\u771f\u5b9e\u884c\u52a8\uff0c\u4e0d\u4f7f\u7528\u7cfb\u7edf\u964d\u7ea7\u52a8\u4f5c\u3002"
          }
        };
      },
      providerMode: "real",
      providerRetryPolicy: { maxRetries: 1 },
      maxLlmCalls: 10,
      artifactStore,
      artifactOwner: {
        ownerType: "hex_test",
        ownerId: "hex_test_owner"
      },
      progressSink: (event) => {
        events.push(`${event.agentId}:${event.status}`);
      }
    });

    expect(result.totalCallsAttempted).toBe(11);
    expect(result.acceptedActions).toHaveLength(10);
    expect(result.fallbackCount).toBe(0);
    expect(result.audits[0]?.providerAttemptCount).toBe(2);
    expect(result.audits[0]?.providerRetryCount).toBe(1);
    expect(result.audits[0]?.providerRecovered).toBe(true);
    expect(result.audits[0]?.errors).toEqual([]);
    expect(result.audits[0]?.recoveredProviderErrors).toEqual(["provider_error:transient_provider_down"]);
    expect(events).toEqual(expect.arrayContaining(["t_0:provider_retry", "t_0:provider_retry_recovered", "t_0:accepted"]));
    expect(artifactStore.writes).toHaveLength(20);
  });

  it("falls back only after provider retry also fails and keeps both provider errors", async () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeMemory(asset);
    const artifactStore = new MemoryArtifactStore();
    let attempts = 0;

    const result = await runHexAgentPhaseCommandHarness({
      asset,
      memory,
      provider: (request) => {
        attempts += 1;
        if (attempts <= 2) {
          throw new Error(`provider_down_${attempts}`);
        }
        return {
          providerMode: "real",
          modelId: "retry_after_failure_fixture",
          rawDraft: {
            agentId: request.agent.agentId,
            phaseId: request.phaseId,
            currentCellId: request.agent.currentCellId,
            targetCellId: request.targetCandidates[0]?.targetCellId ?? request.agent.currentCellId,
            actionType: request.targetCandidates[0] ? "move" : "hold_position",
            businessIntent: "\u6700\u7ec8\u5931\u8d25\u7684\u9996\u4e2a\u8c03\u7528\u4e4b\u540e\uff0c\u5176\u4ed6\u9009\u624b\u7ee7\u7eed\u8f93\u51fa\u771f\u5b9e\u884c\u52a8\u3002"
          }
        };
      },
      providerMode: "real",
      providerRetryPolicy: { maxRetries: 1 },
      maxLlmCalls: 10,
      artifactStore,
      artifactOwner: {
        ownerType: "hex_test",
        ownerId: "hex_test_owner"
      }
    });

    expect(result.totalCallsAttempted).toBe(11);
    expect(result.acceptedActions).toHaveLength(9);
    expect(result.fallbackCount).toBe(1);
    expect(result.audits[0]?.providerAttemptCount).toBe(2);
    expect(result.audits[0]?.providerRetryCount).toBe(1);
    expect(result.audits[0]?.providerRecovered).toBe(false);
    expect(result.audits[0]?.errors).toEqual(["provider_error:provider_down_1", "provider_error:provider_down_2"]);
    expect(result.audits[0]?.providerAttemptErrors).toEqual(["provider_error:provider_down_1", "provider_error:provider_down_2"]);
    expect(artifactStore.writes).toHaveLength(19);
  });

  it("repairs drafts that target another alive agent's occupied cell when a nearby candidate is safe", async () => {
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

    const repaired = result.actions.find((action) => action.agentId === "t_1");
    expect(repaired?.valid).toBe(true);
    expect(repaired?.targetCellId).not.toBe(occupiedCellId);
    expect(repaired?.repairReasons).toContain("repaired_target_cell_occupied");
    expect(repaired?.validationErrors).not.toContain("target_cell_occupied");
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

  it("builds real provider messages from the compact payload only", () => {
    const asset = loadOfficialDust2HexMap();
    const memory = initializeMemory(asset);
    const request = buildHexAgentCommandRequest({
      asset,
      memory,
      agentId: "t_0"
    });
    const compact = buildHexAgentCompactCommandRequest(request);
    const messages = buildRealHexAgentCommandMessages(compact);
    const userContent = messages[1]!.content;

    expect(messages[0]!.content).toContain("businessIntent、tacticalIntent、riskNotes 必须使用中文");
    expect(messages[0]!.content).toContain("phase0 / roundStartAgentOutput 是本局材料依据");
    expect(messages[0]!.content).toContain("你必须有赢回合意识");
    expect(messages[0]!.content).toContain("move 或 rotate 不是散步");
    expect(userContent).toContain('"requestMode":"compact_match"');
    expect(userContent).toContain('"targetCandidates"');
    expect(userContent).not.toContain('"reachableCells"');
    expect(userContent.length).toBeLessThan(JSON.stringify(request).length);
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
