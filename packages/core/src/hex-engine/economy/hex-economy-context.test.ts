import { describe, expect, it } from "vitest";

import type { TeamEconomyPlan } from "../../economy/economy-rules.js";
import type { HexRoundMemory } from "../state/index.js";
import {
  buildHexRoundEconomyContext,
  deriveHexEconomyAllowedActions,
  getHexAgentEconomyContext,
  summarizeHexEconomyEvidence
} from "./hex-economy-context.js";

describe("Hex economy context", () => {
  it("maps rifle buy plans into high resource agent contexts", () => {
    const memory = buildMemory(["t_0"]);
    const context = buildHexRoundEconomyContext({
      memory,
      teamEconomyPlans: {
        t: buildPlan({
          teamId: "t",
          posture: "rifle_buy",
          summaryBuyType: "fullBuy",
          decisions: [
            {
              agentId: "t_0",
              buyType: "fullBuy",
              economyPosture: "rifle_buy",
              outputBudget: 1200,
              dropReceived: 0
            }
          ]
        })
      }
    });

    const agent = getHexAgentEconomyContext({ economyContext: context, agentId: "t_0" });

    expect(agent?.resourceTier).toBe("high");
    expect(agent?.utilityTier).toBe("high");
    expect(agent?.allowedActionTypes).toEqual(expect.arrayContaining(["execute_site", "use_utility", "retake"]));
    expect(context.warnings).toEqual([]);
  });

  it("keeps full eco agents out of full execute actions", () => {
    const allowed = deriveHexEconomyAllowedActions({ economyPosture: "full_eco" });

    expect(allowed).toEqual(expect.arrayContaining(["hold_position", "gather_info", "save"]));
    expect(allowed).not.toContain("execute_site");
    expect(allowed).not.toContain("use_utility");
  });

  it("records drop support as agent economy and combat evidence", () => {
    const memory = buildMemory(["t_0", "t_1"]);
    const context = buildHexRoundEconomyContext({
      memory,
      teamEconomyPlans: {
        t: buildPlan({
          teamId: "t",
          posture: "awp_buy",
          summaryBuyType: "fullBuy",
          dropDecisions: [{ fromAgentId: "t_0", toAgentId: "t_1", amount: 1800, reason: "AWPer receives long-output package" }],
          decisions: [
            {
              agentId: "t_0",
              buyType: "fullBuy",
              economyPosture: "rifle_buy",
              outputBudget: 1000,
              dropSent: 1800
            },
            {
              agentId: "t_1",
              buyType: "fullBuy",
              economyPosture: "awp_buy",
              outputBudget: 1400,
              dropReceived: 1800
            }
          ]
        })
      }
    });

    const receiver = getHexAgentEconomyContext({ economyContext: context, agentId: "t_1" });
    const evidence = summarizeHexEconomyEvidence({ economyContext: context, agentIds: ["t_1"] });

    expect(receiver?.dropReceived).toBe(1800);
    expect(evidence.dropReceivedTotal).toBe(1800);
    expect(evidence.reasons).toContain("economy:drop_received_team_coordination");
    expect(evidence.scoreDelta).toBeGreaterThan(0);
  });

  it("warns when phase memory agents do not have economy decisions", () => {
    const context = buildHexRoundEconomyContext({
      memory: buildMemory(["t_0", "t_missing"]),
      teamEconomyPlans: {
        t: buildPlan({
          teamId: "t",
          posture: "eco",
          summaryBuyType: "eco",
          decisions: [
            {
              agentId: "t_0",
              buyType: "eco",
              economyPosture: "eco",
              outputBudget: 420,
              dropReceived: 0
            }
          ]
        })
      }
    });

    expect(context.warnings).toContain("missing_economy_decision:t_missing");
  });
});

function buildMemory(agentIds: string[]): HexRoundMemory {
  return {
    phaseIndex: 0,
    phaseId: "default_opening",
    agents: agentIds.map((agentId, index) => ({
      agentId,
      teamId: agentId.startsWith("ct_") ? "ct" : "t",
      side: agentId.startsWith("ct_") ? "defense" : "attack",
      currentCellId: `h_${index}_0_l0`,
      currentPointIds: [],
      lifeStatus: "alive",
      apBudget: 3,
      apSpent: 0,
      apRemaining: 3,
      knownEnemies: [],
      lastSeenEnemies: [],
      carryingC4: agentId === "t_0"
    })),
    bombState: {
      planted: false,
      defused: false,
      carrierAgentId: "t_0"
    },
    phaseEvents: [],
    rejectedEvents: []
  };
}

function buildPlan(input: {
  teamId: string;
  posture: TeamEconomyPlan["posture"];
  summaryBuyType: TeamEconomyPlan["summaryBuyType"];
  decisions: Array<Partial<TeamEconomyPlan["decisions"][number]> & { agentId: string }>;
  dropDecisions?: TeamEconomyPlan["dropDecisions"];
}): TeamEconomyPlan {
  return {
    teamId: input.teamId,
    side: input.teamId === "ct" ? "defense" : "attack",
    phase: "gun_round",
    lossCount: 0,
    posture: input.posture,
    postureReason: "test posture",
    summaryBuyType: input.summaryBuyType,
    totalCash: 20000,
    dropDecisions: input.dropDecisions ?? [],
    decisions: input.decisions.map((decision) => ({
      agentId: decision.agentId,
      teamId: input.teamId,
      tokenBankBefore: decision.tokenBankBefore ?? 6000,
      tokenBankAfterDrop: decision.tokenBankAfterDrop ?? 6000,
      buyType: decision.buyType ?? input.summaryBuyType,
      economyPosture: decision.economyPosture ?? input.posture,
      loadoutPackage: decision.loadoutPackage ?? "rifle_full_t_pack",
      spend: decision.spend ?? 4000,
      outputBudget: decision.outputBudget ?? 1200,
      dropSent: decision.dropSent ?? 0,
      dropReceived: decision.dropReceived ?? 0,
      notes: decision.notes ?? []
    }))
  };
}
