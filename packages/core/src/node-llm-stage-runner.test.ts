import { describe, expect, it } from "vitest";

import { buildAgentPhaseActions } from "./agent-phase-action-pipeline.js";
import { buildNodeEconomyResources } from "./economy-resource-adapter.js";
import type { TeamEconomyPlan } from "./economy-rules.js";
import { loadMapNodeGraph } from "./node-graph-service.js";
import { createFixtureNodeLlmDraftProvider, runNodeLlmShadowStage, type NodeLlmDraftProvider } from "./node-llm-stage-runner.js";
import { runNodeRoundShadow } from "./round-phase-runner.js";
import type { Agent, EconomyPosture, LoadoutPackage } from "@agent-major/shared";

describe("node LLM stage runner", () => {
  it("uses a valid fixture draft to enhance local node verdicts", async () => {
    const fixture = buildFixture();
    const result = await runNodeLlmShadowStage({
      graph: fixture.graph,
      phaseSnapshot: fixture.phase,
      agentActions: fixture.agentActions,
      economyResources: fixture.economyResources,
      provider: createFixtureNodeLlmDraftProvider(),
      maxLlmCallsRemaining: 5
    });

    expect(result.audit.callsAttempted).toBe(1);
    expect(result.audit.fallbackCount).toBe(0);
    expect(result.localVerdicts.some((verdict) => verdict.summary.includes("fixture LLM shadow"))).toBe(true);
  });

  it("falls back to deterministic verdicts when the provider returns an unknown node", async () => {
    const fixture = buildFixture();
    const provider: NodeLlmDraftProvider = () => [
      {
        nodeId: "missing_node",
        phaseId: fixture.phase.phaseId,
        summary: "bad node",
        confidence: 0.5
      }
    ];
    const result = await runNodeLlmShadowStage({
      graph: fixture.graph,
      phaseSnapshot: fixture.phase,
      agentActions: fixture.agentActions,
      economyResources: fixture.economyResources,
      provider,
      maxLlmCallsRemaining: 5
    });

    expect(result.audit.fallbackCount).toBe(1);
    expect(result.audit.fallbackReasons.join(" ")).toContain("invalid nodeId");
    expect(result.localVerdicts).toEqual(result.deterministicVerdicts);
  });

  it("ignores forbidden winner fields instead of trusting them", async () => {
    const fixture = buildFixture();
    const targetNodeId = fixture.phase.activeNodeIds[0]!;
    const provider: NodeLlmDraftProvider = () => [
      {
        nodeId: targetNodeId,
        phaseId: fixture.phase.phaseId,
        summary: "legal local summary",
        controlAfterCandidate: "neutral",
        winnerTeamId: "team_attack",
        roundWinType: "elimination",
        confidence: 0.8
      }
    ];
    const result = await runNodeLlmShadowStage({
      graph: fixture.graph,
      phaseSnapshot: fixture.phase,
      agentActions: fixture.agentActions,
      economyResources: fixture.economyResources,
      provider,
      maxLlmCallsRemaining: 5
    });

    expect(result.audit.fallbackCount).toBe(0);
    expect(result.audit.ignoredFields).toContain("winnerTeamId");
    expect(result.audit.ignoredFields).toContain("roundWinType");
    expect("winnerTeamId" in result.localVerdicts[0]!).toBe(false);
  });

  it("falls back without blocking when provider throws", async () => {
    const fixture = buildFixture();
    const provider: NodeLlmDraftProvider = () => {
      throw new Error("provider offline");
    };
    const result = await runNodeLlmShadowStage({
      graph: fixture.graph,
      phaseSnapshot: fixture.phase,
      agentActions: fixture.agentActions,
      economyResources: fixture.economyResources,
      provider,
      maxLlmCallsRemaining: 5
    });

    expect(result.audit.fallbackCount).toBe(1);
    expect(result.audit.fallbackReasons.join(" ")).toContain("provider offline");
    expect(result.localVerdicts).toEqual(result.deterministicVerdicts);
  });

  it("does not call the provider when the max call budget is exhausted", async () => {
    const fixture = buildFixture();
    let called = false;
    const provider: NodeLlmDraftProvider = () => {
      called = true;
      return [];
    };
    const result = await runNodeLlmShadowStage({
      graph: fixture.graph,
      phaseSnapshot: fixture.phase,
      agentActions: fixture.agentActions,
      economyResources: fixture.economyResources,
      provider,
      maxLlmCallsRemaining: 0
    });

    expect(called).toBe(false);
    expect(result.audit.callsAttempted).toBe(0);
    expect(result.audit.fallbackCount).toBe(1);
    expect(result.audit.fallbackReasons).toContain("max_llm_calls_reached");
  });
});

function buildFixture() {
  const graph = loadMapNodeGraph("dust2");
  const economyResources = resourcesForRound();
  const shadow = runNodeRoundShadow({
    roundId: "node_llm_stage_test",
    roundNumber: 1,
    graph,
    economyResources
  });
  const phase = shadow.phases[0]!;
  const agentActions = buildAgentPhaseActions({ graph, phaseSnapshot: phase, economyResources });
  return { graph, economyResources, phase, agentActions };
}

function resourcesForRound() {
  const attackAgents = agents("team_attack", "attack_agent");
  const defenseAgents = agents("team_defense", "defense_agent");
  return buildNodeEconomyResources({
    roundNumber: 1,
    phaseId: "default_opening",
    activeAgents: [...attackAgents, ...defenseAgents],
    teamPlans: [
      teamPlan("team_attack", "attack", "rifle_buy", "rifle_full_t_pack", attackAgents.map((agent) => agent.id)),
      teamPlan("team_defense", "defense", "rifle_buy", "rifle_full_ct_pack", defenseAgents.map((agent) => agent.id))
    ]
  });
}

function teamPlan(
  teamId: string,
  side: "attack" | "defense",
  posture: EconomyPosture,
  loadoutPackage: LoadoutPackage,
  agentIds: string[]
): TeamEconomyPlan {
  return {
    teamId,
    side,
    phase: "gun_round",
    lossCount: 0,
    posture,
    postureReason: "test posture reason",
    summaryBuyType: "fullBuy",
    totalCash: 25000,
    dropDecisions: [],
    decisions: agentIds.map((agentId) => ({
      agentId,
      teamId,
      tokenBankBefore: 5000,
      tokenBankAfterDrop: 5000,
      buyType: "fullBuy",
      economyPosture: posture,
      loadoutPackage,
      spend: 5000,
      outputBudget: 1200,
      dropSent: 0,
      dropReceived: 0,
      notes: []
    }))
  };
}

function agents(teamId: string, prefix: string): Agent[] {
  return ["entry", "star_rifler", "awper", "igl", "support"].map((role, index) => ({
    id: `${prefix}_${index + 1}`,
    teamId,
    driverModelId: "driver_test",
    role,
    displayName: `${prefix}_${index + 1}`,
    baseProfile: {},
    currentState: "ready",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z"
  })) as Agent[];
}
