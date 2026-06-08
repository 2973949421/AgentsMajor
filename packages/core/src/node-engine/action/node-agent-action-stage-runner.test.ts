import type { Agent, EconomyPosture, LoadoutPackage } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import { buildAgentPhaseActions } from "./agent-phase-action-pipeline.js";
import { buildNodeEconomyResources } from "../economy/economy-resource-adapter.js";
import type { TeamEconomyPlan } from "../../economy/economy-rules.js";
import { loadMapNodeGraph } from "../graph/node-graph-service.js";
import {
  createFixtureNodeAgentActionDraftProvider,
  runNodeAgentActionShadowStage,
  type NodeAgentActionDraftProvider
} from "./node-agent-action-stage-runner.js";
import { runNodeRoundShadow } from "../phase/round-phase-runner.js";

describe("node agent action stage runner", () => {
  it("accepts fixture action drafts and keeps the shadow round non-terminal", async () => {
    const fixture = buildFixture();
    const result = await runNodeAgentActionShadowStage({
      graph: fixture.graph,
      phaseSnapshot: fixture.phase,
      economyResources: fixture.economyResources,
      deterministicActions: fixture.deterministicActions,
      provider: createFixtureNodeAgentActionDraftProvider(),
      maxLlmCallsRemaining: 5
    });

    expect(result.audit.callsAttempted).toBe(1);
    expect(result.audit.draftAcceptedCount).toBeGreaterThan(0);
    expect(result.audit.fallbackCount).toBe(0);
    expect(result.agentActions.some((action) => action.businessIntent.includes("fixture LLM action"))).toBe(true);
  });

  it("falls back per invalid draft when provider returns an unknown node", async () => {
    const fixture = buildFixture();
    const provider: NodeAgentActionDraftProvider = () => [
      {
        agentId: fixture.deterministicActions[0]!.agentId,
        phaseId: fixture.phase.phaseId,
        targetNodeId: "missing_node",
        actionType: fixture.deterministicActions[0]!.actionType,
        apCost: 1,
        businessIntent: "bad node"
      }
    ];
    const result = await runNodeAgentActionShadowStage({
      graph: fixture.graph,
      phaseSnapshot: fixture.phase,
      economyResources: fixture.economyResources,
      deterministicActions: fixture.deterministicActions,
      provider,
      maxLlmCallsRemaining: 5
    });

    expect(result.audit.callsAttempted).toBe(1);
    expect(result.audit.fallbackCount).toBe(1);
    expect(result.audit.fallbackReasons.join(" ")).toContain("invalid_targetNodeId");
    expect(result.agentActions).toEqual(result.deterministicActions);
  });

  it("rejects low-resource execute_site drafts", async () => {
    const fixture = buildFixture({ attackPosture: "full_eco", attackLoadout: "pistol_eco_pack" });
    const attackAction = fixture.deterministicActions.find((action) => action.side === "attack")!;
    const provider: NodeAgentActionDraftProvider = () => [
      {
        agentId: attackAction.agentId,
        phaseId: fixture.phase.phaseId,
        targetNodeId: attackAction.targetNodeId,
        actionType: "execute_site",
        apCost: 1,
        businessIntent: "bad execute"
      }
    ];
    const result = await runNodeAgentActionShadowStage({
      graph: fixture.graph,
      phaseSnapshot: fixture.phase,
      economyResources: fixture.economyResources,
      deterministicActions: fixture.deterministicActions,
      provider,
      maxLlmCallsRemaining: 5
    });

    expect(result.audit.fallbackReasons.join(" ")).toContain("disallowed_actionType");
    expect(result.agentActions.find((action) => action.agentId === attackAction.agentId)?.actionType).not.toBe("execute_site");
  });

  it("ignores forbidden winner fields while accepting valid action drafts", async () => {
    const fixture = buildFixture();
    const action = fixture.deterministicActions[0]!;
    const provider: NodeAgentActionDraftProvider = () => [
      {
        agentId: action.agentId,
        phaseId: fixture.phase.phaseId,
        targetNodeId: action.targetNodeId,
        actionType: action.actionType,
        apCost: 1,
        businessIntent: "valid action with forbidden fields",
        winnerTeamId: "team_attack",
        roundWinType: "elimination",
        killLedger: []
      }
    ];
    const result = await runNodeAgentActionShadowStage({
      graph: fixture.graph,
      phaseSnapshot: fixture.phase,
      economyResources: fixture.economyResources,
      deterministicActions: fixture.deterministicActions,
      provider,
      maxLlmCallsRemaining: 5
    });

    expect(result.audit.fallbackCount).toBe(0);
    expect(result.audit.ignoredFields).toContain("winnerTeamId");
    expect(result.audit.ignoredFields).toContain("roundWinType");
    expect(result.audit.ignoredFields).toContain("killLedger");
  });

  it("falls back without blocking when provider throws", async () => {
    const fixture = buildFixture();
    const provider: NodeAgentActionDraftProvider = () => {
      throw new Error("provider offline");
    };
    const result = await runNodeAgentActionShadowStage({
      graph: fixture.graph,
      phaseSnapshot: fixture.phase,
      economyResources: fixture.economyResources,
      deterministicActions: fixture.deterministicActions,
      provider,
      maxLlmCallsRemaining: 5
    });

    expect(result.audit.fallbackCount).toBe(1);
    expect(result.audit.fallbackReasons.join(" ")).toContain("provider offline");
    expect(result.agentActions).toEqual(result.deterministicActions);
  });

  it("does not call the provider when the agent action call budget is exhausted", async () => {
    const fixture = buildFixture();
    let called = false;
    const provider: NodeAgentActionDraftProvider = () => {
      called = true;
      return [];
    };
    const result = await runNodeAgentActionShadowStage({
      graph: fixture.graph,
      phaseSnapshot: fixture.phase,
      economyResources: fixture.economyResources,
      deterministicActions: fixture.deterministicActions,
      provider,
      maxLlmCallsRemaining: 0
    });

    expect(called).toBe(false);
    expect(result.audit.callsAttempted).toBe(0);
    expect(result.audit.fallbackReasons).toContain("max_agent_action_llm_calls_reached");
    expect(result.agentActions).toEqual(result.deterministicActions);
  });
});

function buildFixture(
  input: {
    attackPosture?: EconomyPosture;
    attackLoadout?: LoadoutPackage;
  } = {}
) {
  const graph = loadMapNodeGraph("dust2");
  const economyResources = resourcesForRound(input.attackPosture ?? "rifle_buy", input.attackLoadout ?? "rifle_full_t_pack");
  const shadow = runNodeRoundShadow({
    roundId: "node_agent_action_stage_test",
    roundNumber: 1,
    graph,
    economyResources
  });
  const phase = shadow.phases[0]!;
  const deterministicActions = buildAgentPhaseActions({ graph, phaseSnapshot: phase, economyResources });
  return { graph, economyResources, phase, deterministicActions };
}

function resourcesForRound(attackPosture: EconomyPosture, attackLoadout: LoadoutPackage) {
  const attackAgents = agents("team_attack", "attack_agent");
  const defenseAgents = agents("team_defense", "defense_agent");
  return buildNodeEconomyResources({
    roundNumber: 1,
    phaseId: "default_opening",
    activeAgents: [...attackAgents, ...defenseAgents],
    teamPlans: [
      teamPlan("team_attack", "attack", attackPosture, attackLoadout, attackAgents.map((agent) => agent.id)),
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
    summaryBuyType: posture === "rifle_buy" ? "fullBuy" : "eco",
    totalCash: posture === "rifle_buy" ? 25000 : 3000,
    dropDecisions: [],
    decisions: agentIds.map((agentId) => ({
      agentId,
      teamId,
      tokenBankBefore: posture === "rifle_buy" ? 5000 : 800,
      tokenBankAfterDrop: posture === "rifle_buy" ? 5000 : 800,
      buyType: posture === "rifle_buy" ? "fullBuy" : "eco",
      economyPosture: posture,
      loadoutPackage,
      spend: posture === "rifle_buy" ? 5000 : 300,
      outputBudget: posture === "rifle_buy" ? 1200 : 360,
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
