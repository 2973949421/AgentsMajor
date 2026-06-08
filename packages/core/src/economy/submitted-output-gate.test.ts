import type { AgentActionDecision, AgentOutput } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import { buildSubmittedAgentOutputs } from "./submitted-output-gate.js";
import { outputBudgetForEconomyPosture } from "./economy-rules.js";

describe("submitted output gate", () => {
  it("preserves objective and execution while omitting low-budget secondary fields", () => {
    const submitted = buildSubmittedAgentOutputs({
      agentOutputs: [agentOutput()],
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
            outputBudget: outputBudgetForEconomyPosture("full_eco"),
            dropSent: 0,
            dropReceived: 0,
            notes: []
          }
        ]
      ])
    });

    expect(submitted[0]?.actionDetail?.roundObjective).toContain("控制A门");
    expect(submitted[0]?.actionDetail?.executionPlan).toContain("两人同步");
    expect(submitted[0]?.omittedFields).toEqual(["riskRead", "contingencyPlan", "expectedContribution"]);
    expect(submitted[0]?.gateSummary).toContain("SubmittedOutput");
  });
});

function agentOutput(): AgentOutput {
  const actionDetail: AgentActionDecision = {
    roundObjective: "控制A门并建立进入A区的第一波信息。",
    executionPlan: "两人同步压进，先清近点再转向包点。",
    coordinationPlan: "等待队友闪光后再进入。",
    roleResponsibilityUsage: "rifler负责补枪。",
    riskRead: "若中路前压失败，A门会暴露侧翼风险。",
    contingencyPlan: "如果A门受阻，保留道具转向中路夹击。",
    expectedContribution: "提供首轮信息和至少一次有效补枪。",
    confidence: 0.72
  };
  return {
    id: "raw_output_1",
    agentId: "agent_1",
    teamId: "team_a",
    driverModelId: "driver_test",
    role: "rifler",
    action: "控制A门并等待同步道具。",
    actionDetail,
    confidence: 0.72,
    rawFingerprint: "raw_fp"
  };
}
