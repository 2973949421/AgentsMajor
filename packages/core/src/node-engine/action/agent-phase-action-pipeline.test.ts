import type { Agent, EconomyPosture, LoadoutPackage, RoundNodeStateSnapshot } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import { buildAgentPhaseActions } from "./agent-phase-action-pipeline.js";
import { buildNodeEconomyResources } from "../economy/economy-resource-adapter.js";
import type { TeamEconomyPlan } from "../../economy/economy-rules.js";
import { loadMapNodeGraph, getReachableNodes } from "../graph/node-graph-service.js";
import type { NodeTeamContext } from "../team-context/node-team-context-service.js";

describe("agent phase action pipeline", () => {
  it("keeps low-resource agents away from execute_site", () => {
    const graph = loadMapNodeGraph("dust2");
    const economyResources = resources({
      attackPosture: "full_eco",
      attackLoadout: "pistol_eco_pack",
      defensePosture: "rifle_buy",
      defenseLoadout: "rifle_full_ct_pack"
    });
    const actions = buildAgentPhaseActions({
      graph,
      phaseSnapshot: snapshot("execute_or_retake"),
      economyResources
    });
    const attackActions = actions.filter((action) => action.side === "attack");

    expect(attackActions.length).toBeGreaterThan(0);
    expect(attackActions.every((action) => action.actionType !== "execute_site")).toBe(true);
    expect(attackActions.every((action) => action.businessIntent.length > 0)).toBe(true);
  });

  it("allows full rifle resources to generate execute actions during execute phase", () => {
    const graph = loadMapNodeGraph("dust2");
    const economyResources = resources({
      attackPosture: "rifle_buy",
      attackLoadout: "rifle_full_t_pack",
      defensePosture: "rifle_buy",
      defenseLoadout: "rifle_full_ct_pack"
    });
    const phaseSnapshot = {
      ...snapshot("execute_or_retake"),
      activeNodeIds: ["a_ramp", "b_doors", "a_default", "b_default"],
      nodeStates: [
        {
          nodeId: "a_ramp",
          phaseId: "execute_or_retake" as const,
          attackAgentIds: ["attack_agent_1"],
          defenseAgentIds: [],
          control: "attack" as const
        },
        {
          nodeId: "b_doors",
          phaseId: "execute_or_retake" as const,
          attackAgentIds: ["attack_agent_2"],
          defenseAgentIds: [],
          control: "attack" as const
        },
        {
          nodeId: "a_default",
          phaseId: "execute_or_retake" as const,
          attackAgentIds: [],
          defenseAgentIds: ["defense_agent_1"],
          control: "defense" as const
        }
      ]
    };
    const actions = buildAgentPhaseActions({
      graph,
      phaseSnapshot,
      economyResources
    });
    const attackActions = actions.filter((action) => action.side === "attack");

    expect(attackActions.some((action) => action.actionType === "execute_site")).toBe(true);
    expect(attackActions.every((action) => action.apCost <= 3)).toBe(true);
    expect(attackActions.every((action) => action.apCostBreakdown?.totalCost === action.apCost)).toBe(true);
  });

  it("keeps action targets within side and phase reachability", () => {
    const graph = loadMapNodeGraph("dust2");
    const economyResources = resources({
      attackPosture: "rifle_buy",
      attackLoadout: "rifle_full_t_pack",
      defensePosture: "rifle_buy",
      defenseLoadout: "rifle_full_ct_pack"
    });
    const phaseSnapshot = snapshot("default_opening");
    const actions = buildAgentPhaseActions({ graph, phaseSnapshot, economyResources });

    for (const action of actions) {
      expect(getReachableNodes(graph, action.side, action.phaseId)).toContain(action.targetNodeId);
    }
    expect(actions.filter((action) => action.side === "attack").map((action) => action.targetNodeId)).not.toContain("a_default");
    expect(actions.filter((action) => action.side === "attack").map((action) => action.targetNodeId)).not.toContain("b_default");
  });

  it("only chooses actions allowed by economy resources", () => {
    const graph = loadMapNodeGraph("dust2");
    const economyResources = resources({
      attackPosture: "force_buy",
      attackLoadout: "smg_force_pack",
      defensePosture: "rifle_buy",
      defenseLoadout: "rifle_full_ct_pack"
    });
    const actions = buildAgentPhaseActions({
      graph,
      phaseSnapshot: snapshot("first_contact"),
      economyResources
    });

    for (const action of actions) {
      const resource = economyResources.agentResourcesById[action.agentId]!;
      expect(resource.allowedActionTypes).toContain(action.actionType);
      expect(action.businessIntent).toContain(action.teamId);
    }
  });

  it("uses role context to rank legal deterministic actions without bypassing validators", () => {
    const graph = loadMapNodeGraph("dust2");
    const economyResources = resources({
      attackPosture: "rifle_buy",
      attackLoadout: "rifle_full_t_pack",
      defensePosture: "rifle_buy",
      defenseLoadout: "rifle_full_ct_pack"
    });
    const actions = buildAgentPhaseActions({
      graph,
      phaseSnapshot: snapshot("default_opening"),
      economyResources,
      teamContexts: teamContextsFixture()
    });
    const supportAction = actions.find((action) => action.agentId === "attack_agent_1")!;

    expect(supportAction.agentRole).toBe("support");
    expect(supportAction.roleActionBias).toContain("use_utility");
    expect(supportAction.businessIntent).toContain("Role=support");
    expect(supportAction.teamThesisAnchor).toBe("Control mid as a business proof point.");
    expect(supportAction.actionType).toBe("use_utility");
    expect(supportAction.apCostBreakdown?.totalCost).toBe(supportAction.apCost);
  });

  it("can apply validated LLM shadow drafts without changing default deterministic behavior", () => {
    const graph = loadMapNodeGraph("dust2");
    const economyResources = resources({
      attackPosture: "rifle_buy",
      attackLoadout: "rifle_full_t_pack",
      defensePosture: "rifle_buy",
      defenseLoadout: "rifle_full_ct_pack"
    });
    const phaseSnapshot = snapshot("first_contact");
    const deterministic = buildAgentPhaseActions({ graph, phaseSnapshot, economyResources });
    const target = deterministic[0]!;
    const llmShadow = buildAgentPhaseActions({
      graph,
      phaseSnapshot,
      economyResources,
      mode: "llm_shadow",
      llmDrafts: [
        {
          agentId: target.agentId,
          phaseId: phaseSnapshot.phaseId,
          targetNodeId: target.targetNodeId,
          actionType: target.actionType,
          apCost: 1,
          businessIntent: "LLM shadow 通过合法草案增强商业行动说明�?"
        }
      ]
    });

    expect(buildAgentPhaseActions({ graph, phaseSnapshot, economyResources })).toEqual(deterministic);
    expect(llmShadow.find((action) => action.agentId === target.agentId)?.businessIntent).toContain("LLM shadow");
  });

  it("falls back LLM drafts that lie about AP for long movement", () => {
    const graph = loadMapNodeGraph("dust2");
    const economyResources = resources({
      attackPosture: "rifle_buy",
      attackLoadout: "rifle_full_t_pack",
      defensePosture: "rifle_buy",
      defenseLoadout: "rifle_full_ct_pack"
    });
    const phaseSnapshot = snapshot("execute_or_retake");
    const attackAgent = economyResources.agents.find((resource) => resource.side === "attack")!;
    const actions = buildAgentPhaseActions({
      graph,
      phaseSnapshot,
      economyResources,
      mode: "llm_shadow",
      llmDrafts: [
        {
          agentId: attackAgent.agentId,
          phaseId: phaseSnapshot.phaseId,
          currentNodeId: "t_spawn",
          targetNodeId: "a_default",
          actionType: "execute_site",
          apCost: 0,
          businessIntent: "LLM incorrectly claims a free long execute."
        }
      ]
    });
    const action = actions.find((candidate) => candidate.agentId === attackAgent.agentId)!;

    expect(action.actionType).toBe("hold_position");
    expect(action.fallbackReason).toContain("ap_over_budget");
    expect(action.apCostBreakdown?.claimedCostFromLlm).toBe(0);
  });
});

function snapshot(phaseId: RoundNodeStateSnapshot["phaseId"]): RoundNodeStateSnapshot {
  return {
    roundId: "round_action_1",
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
        nodeId: "top_mid",
        phaseId,
        attackAgentIds: ["attack_agent_2"],
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

function teamContextsFixture(): Record<string, NodeTeamContext> {
  return {
    team_attack: {
      teamId: "team_attack",
      teamDisplayName: "Team Attack",
      teamSummary: "Team Attack validates a compact business thesis through role discipline.",
      teamThesis: "Control mid as a business proof point.",
      mustHoldClaims: ["Control mid as a business proof point."],
      playerOperatingPrinciples: ["Support converts utility into execution evidence."],
      coachPolicies: {
        timeout: "Correct role drift.",
        postMatchReview: "Review business execution.",
        coachNote: "Coach checks whether support utility kept the plan coherent."
      },
      agentContextsById: {
        attack_agent_1: {
          agentId: "attack_agent_1",
          displayName: "attack_agent_1",
          role: "support",
          secondaryRoles: [],
          roleResponsibilities: ["Support utility creates node evidence."],
          roleActionBias: ["use_utility", "prepare_trade", "watch_angle"],
          teamThesisAnchor: "Control mid as a business proof point.",
          businessOperatingPrinciple: "Support converts utility into execution evidence.",
          coachNote: "Coach checks whether support utility kept the plan coherent."
        }
      },
      roleActionPreferences: {
        support: ["use_utility", "prepare_trade", "watch_angle"]
      },
      source: "runtime",
      notes: ["test context"]
    }
  };
}
