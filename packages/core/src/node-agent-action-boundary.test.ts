import type { Agent, EconomyPosture, LoadoutPackage, RoundNodeStateSnapshot } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import { buildAgentPhaseActions } from "./agent-phase-action-pipeline.js";
import { buildNodeEconomyResources } from "./economy-resource-adapter.js";
import type { TeamEconomyPlan } from "./economy-rules.js";
import {
  applyNodeAgentActionDrafts,
  buildNodeAgentActionRequest,
  normalizeNodeAgentActionDrafts
} from "./node-agent-action-boundary.js";
import { loadMapNodeGraph } from "./node-graph-service.js";

describe("node agent action boundary", () => {
  it("accepts legal agent action drafts and materializes actions", () => {
    const fixture = buildFixture();
    const request = buildNodeAgentActionRequest(fixture);
    const targetAgent = request.agents[0]!;
    const normalized = normalizeNodeAgentActionDrafts({
      request,
      rawDrafts: [
        {
          agentId: targetAgent.agentId,
          phaseId: request.phaseId,
          currentNodeId: targetAgent.currentNodeId,
          targetNodeId: targetAgent.allowedTargetNodeIds[0],
          actionType: targetAgent.allowedActionTypes[0],
          apCost: 1,
          businessIntent: "用节点行动验证商业分工与风险承受能力。",
          tacticalIntent: "hold validated angle",
          riskNotes: ["保持 AP 约束"],
          confidence: 0.8
        }
      ]
    });

    expect(normalized.errors).toEqual([]);
    expect(normalized.drafts).toHaveLength(1);
    const actions = applyNodeAgentActionDrafts({
      baselineActions: fixture.baselineActions,
      drafts: normalized.drafts
    });
    expect(actions.find((action) => action.agentId === targetAgent.agentId)?.businessIntent).toContain("商业分工");
  });

  it("rejects unknown node ids and unreachable targets", () => {
    const fixture = buildFixture();
    const request = buildNodeAgentActionRequest(fixture);
    const targetAgent = request.agents[0]!;

    const unknown = normalizeNodeAgentActionDrafts({
      request,
      rawDrafts: [
        {
          agentId: targetAgent.agentId,
          phaseId: request.phaseId,
          targetNodeId: "missing_node",
          actionType: targetAgent.allowedActionTypes[0],
          apCost: 1,
          businessIntent: "bad node"
        }
      ]
    });
    const unreachable = normalizeNodeAgentActionDrafts({
      request,
      rawDrafts: [
        {
          agentId: targetAgent.agentId,
          phaseId: request.phaseId,
          targetNodeId: "a_default",
          actionType: targetAgent.allowedActionTypes[0],
          apCost: 1,
          businessIntent: "unreachable node"
        }
      ]
    });

    expect(unknown.errors.join(" ")).toContain("invalid_targetNodeId");
    expect(unreachable.errors.join(" ")).toContain("unreachable_targetNodeId");
  });

  it("rejects disallowed actions and AP over budget", () => {
    const fixture = buildFixture({ attackPosture: "full_eco", attackLoadout: "pistol_eco_pack" });
    const request = buildNodeAgentActionRequest(fixture);
    const attackAgent = request.agents.find((agent) => agent.side === "attack")!;

    const disallowed = normalizeNodeAgentActionDrafts({
      request,
      rawDrafts: [
        {
          agentId: attackAgent.agentId,
          phaseId: request.phaseId,
          targetNodeId: attackAgent.allowedTargetNodeIds[0],
          actionType: "execute_site",
          apCost: 1,
          businessIntent: "bad execute"
        }
      ]
    });
    const overBudget = normalizeNodeAgentActionDrafts({
      request,
      rawDrafts: [
        {
          agentId: attackAgent.agentId,
          phaseId: request.phaseId,
          targetNodeId: attackAgent.allowedTargetNodeIds[0],
          actionType: attackAgent.allowedActionTypes[0],
          apCost: 99,
          businessIntent: "bad AP"
        }
      ]
    });

    expect(disallowed.errors.join(" ")).toContain("disallowed_actionType");
    expect(overBudget.errors.join(" ")).toContain("ap_over_budget");
  });

  it("ignores forbidden winner and kill fields", () => {
    const fixture = buildFixture();
    const request = buildNodeAgentActionRequest(fixture);
    const targetAgent = request.agents[0]!;
    const normalized = normalizeNodeAgentActionDrafts({
      request,
      rawDrafts: [
        {
          agentId: targetAgent.agentId,
          phaseId: request.phaseId,
          targetNodeId: targetAgent.allowedTargetNodeIds[0],
          actionType: targetAgent.allowedActionTypes[0],
          apCost: 1,
          businessIntent: "legal action",
          winnerTeamId: "team_attack",
          roundWinType: "elimination",
          killLedger: []
        }
      ]
    });

    expect(normalized.errors).toEqual([]);
    expect(normalized.ignoredFields).toContain("winnerTeamId");
    expect(normalized.ignoredFields).toContain("roundWinType");
    expect(normalized.ignoredFields).toContain("killLedger");
  });
});

function buildFixture(
  input: {
    attackPosture?: EconomyPosture;
    attackLoadout?: LoadoutPackage;
  } = {}
) {
  const graph = loadMapNodeGraph("dust2");
  const economyResources = resources({
    attackPosture: input.attackPosture ?? "rifle_buy",
    attackLoadout: input.attackLoadout ?? "rifle_full_t_pack",
    defensePosture: "rifle_buy",
    defenseLoadout: "rifle_full_ct_pack"
  });
  const phaseSnapshot = snapshot("default_opening");
  const baselineActions = buildAgentPhaseActions({
    graph,
    phaseSnapshot,
    economyResources
  });
  return { graph, phaseSnapshot, economyResources, baselineActions };
}

function snapshot(phaseId: RoundNodeStateSnapshot["phaseId"]): RoundNodeStateSnapshot {
  return {
    roundId: "round_agent_action_boundary",
    phaseId,
    activeNodeIds: ["t_spawn", "top_mid", "a_default", "b_default", "mid_doors"],
    nodeStates: [
      {
        nodeId: "t_spawn",
        phaseId,
        attackAgentIds: ["attack_agent_1"],
        defenseAgentIds: [],
        control: "attack"
      },
      {
        nodeId: "a_default",
        phaseId,
        attackAgentIds: [],
        defenseAgentIds: ["defense_agent_1"],
        control: "defense"
      },
      {
        nodeId: "b_default",
        phaseId,
        attackAgentIds: [],
        defenseAgentIds: ["defense_agent_2"],
        control: "defense"
      }
    ]
  };
}

function resources(input: {
  attackPosture: EconomyPosture;
  attackLoadout: LoadoutPackage;
  defensePosture: EconomyPosture;
  defenseLoadout: LoadoutPackage;
}) {
  const attackAgents = agents("team_attack", "attack_agent");
  const defenseAgents = agents("team_defense", "defense_agent");
  return buildNodeEconomyResources({
    roundNumber: 1,
    phaseId: "default_opening",
    activeAgents: [...attackAgents, ...defenseAgents],
    teamPlans: [
      teamPlan("team_attack", "attack", input.attackPosture, input.attackLoadout, attackAgents.map((agent) => agent.id)),
      teamPlan("team_defense", "defense", input.defensePosture, input.defenseLoadout, defenseAgents.map((agent) => agent.id))
    ]
  });
}

function teamPlan(teamId: string, side: "attack" | "defense", posture: EconomyPosture, loadoutPackage: LoadoutPackage, agentIds: string[]): TeamEconomyPlan {
  return {
    teamId,
    side,
    phase: "gun_round",
    lossCount: 0,
    posture,
    postureReason: "test posture",
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
  return ["entry", "star_rifler"].map((role, index) => ({
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
