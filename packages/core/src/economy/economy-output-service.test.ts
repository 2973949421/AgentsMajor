import type { Agent, AgentActionDecision, AgentOutput } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import {
  buildSubmittedAgentOutputs,
  decideTeamBuyType,
  isOvertimeEconomyResetRound,
  outputBudgetForEconomyPosture,
  resolveRoundEconomyPhase,
  roundStartEconomy
} from "./economy-output-service.js";

describe("economy/output service", () => {
  it("uses competitive rifle economy on overtime reset rounds instead of pistol or full eco", () => {
    const attack = roundStartEconomy({
      agent: agent("agent_attack", "team_attack"),
      mapGameId: "map_1",
      roundNumber: 19,
      createdAt: "2026-05-01T00:00:00.000Z",
      side: "attack"
    });
    const defense = roundStartEconomy({
      agent: agent("agent_defense", "team_defense"),
      mapGameId: "map_1",
      roundNumber: 19,
      createdAt: "2026-05-01T00:00:00.000Z",
      side: "defense"
    });

    expect(resolveRoundEconomyPhase(19)).toBe("overtime_reset");
    expect(decideTeamBuyType([attack, defense])).toBe("fullBuy");
    expect(attack).toMatchObject({
      tokenBank: 10000,
      buyType: "fullBuy",
      economyPosture: "rifle_buy",
      loadoutPackage: "rifle_full_t_pack"
    });
    expect(defense).toMatchObject({
      tokenBank: 10000,
      buyType: "fullBuy",
      economyPosture: "rifle_buy",
      loadoutPackage: "rifle_full_ct_pack"
    });
  });

  it("does not repeat overtime reset on continuation rounds", () => {
    expect(isOvertimeEconomyResetRound(19)).toBe(true);
    expect(resolveRoundEconomyPhase(19)).toBe("overtime_reset");

    expect(isOvertimeEconomyResetRound(20)).toBe(false);
    expect(resolveRoundEconomyPhase(20)).toBe("gun_round");
    expect(isOvertimeEconomyResetRound(21)).toBe(false);
    expect(resolveRoundEconomyPhase(21)).toBe("gun_round");
  });

  it("keeps core action facts visible even when economy output budget is low", () => {
    const rawOutput = agentOutput("output_1", "agent_1", "team_a");
    const submitted = buildSubmittedAgentOutputs({
      agentOutputs: [rawOutput],
      buyDecisionByAgent: new Map([
        [
          "agent_1",
          {
            agentId: "agent_1",
            teamId: "team_a",
            tokenBankBefore: 800,
            tokenBankAfterDrop: 800,
            buyType: "eco",
            economyPosture: "full_eco",
            loadoutPackage: "pistol_eco_pack",
            spend: 0,
            dropSent: 0,
            dropReceived: 0,
            outputBudget: outputBudgetForEconomyPosture("full_eco"),
            notes: ["低预算测试"]
          }
        ]
      ])
    });

    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({
      submissionKind: "submitted_output",
      rawOutputId: "output_1",
      economyPosture: "full_eco",
      outputBudget: outputBudgetForEconomyPosture("full_eco")
    });
    expect(submitted[0]?.actionDetail?.roundObjective).toContain("控制A门");
    expect(submitted[0]?.actionDetail?.executionPlan).toContain("两人同步");
    expect(submitted[0]?.omittedFields).toEqual(expect.arrayContaining(["riskRead", "contingencyPlan", "expectedContribution"]));
    expect(submitted[0]?.gateSummary).toContain("Judge 只能消费 SubmittedOutput");
  });
});

function agent(id: string, teamId: string): Agent {
  return {
    id,
    teamId,
    driverModelId: "driver_test",
    role: "rifler",
    displayName: id,
    baseProfile: {},
    currentState: "ready",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z"
  } as Agent;
}

function agentOutput(id: string, agentId: string, teamId: string): AgentOutput {
  const actionDetail: AgentActionDecision = {
    roundObjective: "控制A门并建立进入A区的第一波信息。",
    executionPlan: "两人同步压进，先清近点再转向包点。",
    coordinationPlan: "等待队友闪光后再进入，避免单点送出。",
    roleResponsibilityUsage: "rifler负责补枪和收束第一交火。",
    riskRead: "若中路前压失败，A门会暴露侧翼风险。",
    contingencyPlan: "如果A门受阻，保留道具转向中路夹击。",
    expectedContribution: "提供首轮信息和至少一次有效补枪。",
    confidence: 0.72
  };
  return {
    id,
    agentId,
    teamId,
    driverModelId: "driver_test",
    role: "rifler",
    action: "控制A门并等待同步道具。",
    actionDetail,
    confidence: 0.72,
    rawFingerprint: "raw_fp"
  };
}
