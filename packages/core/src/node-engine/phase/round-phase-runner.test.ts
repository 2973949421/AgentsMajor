import type { Agent, EconomyPosture, LoadoutPackage } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import { buildNodeEconomyResources } from "../economy/economy-resource-adapter.js";
import type { TeamEconomyPlan } from "../../economy/economy-rules.js";
import { loadMapNodeGraph } from "../graph/node-graph-service.js";
import { createFixtureNodeAgentActionDraftProvider } from "../action/node-agent-action-stage-runner.js";
import type { NodeTeamContext } from "../team-context/node-team-context-service.js";
import { runNodeRoundShadow, runNodeRoundShadowWithAgentActionLlm } from "./round-phase-runner.js";

describe("round phase runner shadow mode", () => {
  it("generates five Dust2 phase snapshots without producing a formal winner", () => {
    const graph = loadMapNodeGraph("dust2");
    const economyResources = resourcesForRound();
    const result = runNodeRoundShadow({
      roundId: "round_shadow_1",
      roundNumber: 1,
      graph,
      economyResources
    });

    expect(result.mode).toBe("shadow");
    expect(result.phases.map((phase) => phase.phaseId)).toEqual([
      "default_opening",
      "first_contact",
      "mid_round_decision",
      "execute_or_retake",
      "post_plant_or_clutch"
    ]);
    expect("winnerTeamId" in result).toBe(false);
    expect(result.notes.join(" ")).toContain("winner");
  });

  it("does not place attacking agents on A or B default plant nodes during default opening", () => {
    const graph = loadMapNodeGraph("dust2");
    const result = runNodeRoundShadow({
      roundId: "round_shadow_1",
      roundNumber: 1,
      graph,
      economyResources: resourcesForRound()
    });
    const opening = result.phases.find((phase) => phase.phaseId === "default_opening")!;
    const aDefault = opening.nodeStates.find((state) => state.nodeId === "a_default")!;
    const bDefault = opening.nodeStates.find((state) => state.nodeId === "b_default")!;

    expect(aDefault.attackAgentIds).toHaveLength(0);
    expect(bDefault.attackAgentIds).toHaveLength(0);
  });

  it("allows defending agents to initialize on A and B default defense nodes", () => {
    const graph = loadMapNodeGraph("dust2");
    const result = runNodeRoundShadow({
      roundId: "round_shadow_1",
      roundNumber: 1,
      graph,
      economyResources: resourcesForRound()
    });
    const opening = result.phases.find((phase) => phase.phaseId === "default_opening")!;
    const aDefault = opening.nodeStates.find((state) => state.nodeId === "a_default")!;
    const bDefault = opening.nodeStates.find((state) => state.nodeId === "b_default")!;

    expect(aDefault.defenseAgentIds.length).toBeGreaterThan(0);
    expect(bDefault.defenseAgentIds.length).toBeGreaterThan(0);
  });

  it("emits AP budgets for every resource agent in every phase", () => {
    const graph = loadMapNodeGraph("dust2");
    const result = runNodeRoundShadow({
      roundId: "round_shadow_1",
      roundNumber: 1,
      graph,
      economyResources: resourcesForRound()
    });

    for (const phase of result.phases) {
      const budgets = phase.actionPointBudgets ?? [];
      expect(budgets).toHaveLength(10);
      expect(budgets.every((budget) => budget.baseAp === 3)).toBe(true);
      expect(budgets.every((budget) => budget.remainingAp >= 0)).toBe(true);
    }
  });

  it("derives AP budgets from validated agent actions instead of shadow estimates", () => {
    const graph = loadMapNodeGraph("dust2");
    const result = runNodeRoundShadow({
      roundId: "round_shadow_ap_budget",
      roundNumber: 1,
      graph,
      economyResources: resourcesForRound()
    });

    for (const phase of result.phases) {
      const actionCostByAgent = new Map((phase.agentActions ?? []).map((action) => [action.agentId, action.apCost] as const));
      for (const budget of phase.actionPointBudgets ?? []) {
        expect(budget.spentAp).toBe(actionCostByAgent.get(budget.agentId) ?? 0);
        expect(budget.remainingAp).toBe(budget.baseAp - budget.spentAp);
      }
    }
  });

  it("propagates team role context into phase agent actions", () => {
    const graph = loadMapNodeGraph("dust2");
    const result = runNodeRoundShadow({
      roundId: "round_shadow_team_context",
      roundNumber: 1,
      graph,
      economyResources: resourcesForRound(),
      teamContexts: teamContextsFixture()
    });
    const contextualAction = result.phases
      .flatMap((phase) => phase.agentActions ?? [])
      .find((action) => action.agentId === "attack_agent_1")!;

    expect(contextualAction.agentRole).toBe("support");
    expect(contextualAction.teamThesisAnchor).toBe("Control mid as a business proof point.");
    expect(contextualAction.businessIntent).toContain("Role=support");
  });

  it("attaches win condition checks to phase snapshots without writing a formal top-level winner", () => {
    const graph = loadMapNodeGraph("dust2");
    const result = runNodeRoundShadow({
      roundId: "round_shadow_1",
      roundNumber: 1,
      graph,
      economyResources: resourcesForRound()
    });

    expect(result.phases.every((phase) => phase.winConditionCheck.phaseId === phase.phaseId)).toBe(true);
    expect(result.finalWinCondition?.isRoundOver).toBe(true);
    expect("winnerTeamId" in result).toBe(false);
  });

  it("materializes transition notes after the opening phase", () => {
    const graph = loadMapNodeGraph("dust2");
    const result = runNodeRoundShadow({
      roundId: "round_shadow_1",
      roundNumber: 1,
      graph,
      economyResources: resourcesForRound()
    });
    const firstContact = result.phases.find((phase) => phase.phaseId === "first_contact")!;

    expect(firstContact.transitionNotes?.join(" ")).toContain("materialized");
  });

  it("can run agent action LLM shadow without producing a formal top-level winner", async () => {
    const graph = loadMapNodeGraph("dust2");
    const result = await runNodeRoundShadowWithAgentActionLlm({
      roundId: "round_shadow_agent_action_llm",
      roundNumber: 1,
      graph,
      economyResources: resourcesForRound(),
      agentActionLlm: {
        provider: createFixtureNodeAgentActionDraftProvider(),
        maxLlmCalls: 5
      }
    });

    expect(result.agentActionLlmAudit?.enabled).toBe(true);
    expect(result.agentActionLlmAudit?.callsAttempted).toBeGreaterThan(0);
    expect(result.phases.some((phase) => phase.agentActionLlmAudit?.enabled)).toBe(true);
    expect("winnerTeamId" in result).toBe(false);
    expect(result.notes.join(" ")).toContain("agent action LLM shadow");
  });
});

function resourcesForRound() {
  const attackAgents = agents("team_attack", "attack_agent");
  const defenseAgents = agents("team_defense", "defense_agent");
  return buildNodeEconomyResources({
    roundNumber: 1,
    phaseId: "default_opening",
    activeAgents: [...attackAgents, ...defenseAgents],
    teamPlans: [
      teamPlan("team_attack", "attack", "full_eco", "pistol_eco_pack", attackAgents.map((agent) => agent.id)),
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
