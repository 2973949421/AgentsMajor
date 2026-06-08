import type { Agent, EconomyPosture, LoadoutPackage } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import { buildNodeEconomyResources } from "./economy-resource-adapter.js";
import type { TeamEconomyPlan } from "../../economy/economy-rules.js";

describe("economy resource adapter", () => {
  it("maps full eco into low-resource node actions without full execute ability", () => {
    const resources = buildNodeEconomyResources({
      roundNumber: 3,
      phaseId: "default_opening",
      activeAgents: [agent("agent_1", "team_a", "entry")],
      teamPlans: [teamPlan("team_a", "attack", "full_eco", "pistol_eco_pack", ["agent_1"])]
    });

    const resource = resources.agentResourcesById.agent_1!;
    expect(resource.baseAp).toBe(3);
    expect(resource.allowedActionTypes).toEqual(expect.arrayContaining(["hold_position", "gather_info", "save"]));
    expect(resource.allowedActionTypes).not.toContain("execute_site");
    expect(resource.canUseExecuteUtility).toBe(false);
    expect(resource.canLeadEntry).toBe(false);
    expect(resource.riskProfile).toBe("preserve");
    expect(resource.notes.join(" ")).toContain("AP/node graph");
  });

  it("maps rifle buy into full-resource actions while keeping AP as a constraint", () => {
    const resources = buildNodeEconomyResources({
      roundNumber: 5,
      phaseId: "execute_or_retake",
      activeAgents: [agent("agent_1", "team_a", "rifler")],
      teamPlans: [teamPlan("team_a", "attack", "rifle_buy", "rifle_full_t_pack", ["agent_1"])]
    });

    const resource = resources.agentResourcesById.agent_1!;
    expect(resource.weaponTier).toBe("rifle");
    expect(resource.utilityTier).toBe("full");
    expect(resource.baseAp).toBe(3);
    expect(resource.allowedActionTypes).toEqual(expect.arrayContaining(["map_control", "use_utility", "execute_site", "post_plant_hold"]));
    expect(resource.canUseExecuteUtility).toBe(true);
    expect(resource.canLeadEntry).toBe(true);
    expect(resource.notes.join(" ")).toContain("AP/node graph");
  });

  it("maps pistol resources into low-config execute ability without treating them as full utility", () => {
    const resources = buildNodeEconomyResources({
      roundNumber: 1,
      phaseId: "execute_or_retake",
      activeAgents: [agent("agent_1", "team_a", "entry")],
      teamPlans: [teamPlan("team_a", "attack", "pistol_round", "pistol_round_pack", ["agent_1"])]
    });

    const resource = resources.agentResourcesById.agent_1!;
    expect(resource.allowedActionTypes).toContain("execute_site");
    expect(resource.utilityTier).toBe("basic");
    expect(resource.canUseExecuteUtility).toBe(false);
    expect(resource.riskProfile).toBe("medium");
  });

  it("maps overtime reset plans to competitive rifle resources, not full eco", () => {
    const resources = buildNodeEconomyResources({
      roundNumber: 19,
      phaseId: "default_opening",
      activeAgents: [agent("agent_1", "team_a", "entry")],
      teamPlans: [teamPlan("team_a", "attack", "rifle_buy", "rifle_full_t_pack", ["agent_1"], "overtime_reset")]
    });

    expect(resources.teams[0]).toMatchObject({
      posture: "rifle_buy",
      summaryBuyType: "fullBuy"
    });
    expect(resources.agentResourcesById.agent_1?.allowedActionTypes).toContain("execute_site");
    expect(resources.agentResourcesById.agent_1?.riskProfile).toBe("high");
  });

  it("keeps team economy shared while preserving agent-level resource ownership", () => {
    const resources = buildNodeEconomyResources({
      roundNumber: 7,
      phaseId: "first_contact",
      activeAgents: [agent("agent_donor", "team_a", "support"), agent("agent_receiver", "team_a", "entry")],
      teamPlans: [
        teamPlan("team_a", "attack", "broken_buy", "broken_buy_pack", ["agent_donor", "agent_receiver"], "gun_round", [
          {
            fromAgentId: "agent_donor",
            toAgentId: "agent_receiver",
            amount: 1600,
            reason: "drop support for low buy entry"
          }
        ])
      ]
    });

    expect(resources.teams[0]?.sharedEconomySummary).toContain("team_total_cash");
    expect(resources.teams[0]?.dropDecisions).toHaveLength(1);
    expect(resources.agentResourcesById.agent_donor).toMatchObject({ agentId: "agent_donor", teamId: "team_a" });
    expect(resources.agentResourcesById.agent_receiver).toMatchObject({ agentId: "agent_receiver", teamId: "team_a" });
  });
});

function teamPlan(
  teamId: string,
  side: "attack" | "defense",
  posture: EconomyPosture,
  loadoutPackage: LoadoutPackage,
  agentIds: string[],
  phase: TeamEconomyPlan["phase"] = "gun_round",
  dropDecisions: TeamEconomyPlan["dropDecisions"] = []
): TeamEconomyPlan {
  return {
    teamId,
    side,
    phase,
    lossCount: 0,
    posture,
    postureReason: "test posture reason",
    summaryBuyType: posture === "rifle_buy" || posture === "awp_buy" || posture === "double_awp" ? "fullBuy" : "eco",
    totalCash: posture === "rifle_buy" ? 25000 : 3000,
    dropDecisions,
    decisions: agentIds.map((agentId, index) => ({
      agentId,
      teamId,
      tokenBankBefore: 5000,
      tokenBankAfterDrop: 5000,
      buyType: posture === "rifle_buy" ? "fullBuy" : "eco",
      economyPosture: posture,
      loadoutPackage,
      spend: posture === "rifle_buy" ? 5000 : 300,
      outputBudget: posture === "rifle_buy" ? 1200 : 360,
      dropSent: dropDecisions.filter((decision) => decision.fromAgentId === agentId).reduce((sum, decision) => sum + decision.amount, 0),
      dropReceived: dropDecisions.filter((decision) => decision.toAgentId === agentId).reduce((sum, decision) => sum + decision.amount, 0),
      notes: [`agent ${index + 1}`]
    }))
  };
}

function agent(id: string, teamId: string, role: Agent["role"]): Agent {
  return {
    id,
    teamId,
    driverModelId: "driver_test",
    role,
    displayName: id,
    baseProfile: {},
    currentState: "ready",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z"
  } as Agent;
}
