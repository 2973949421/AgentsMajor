import { describe, expect, it } from "vitest";

import { runDust2NodeShadowExperiment, runDust2NodeShadowExperimentAsync } from "./node-shadow-experiment.js";

describe("Dust2 node shadow experiment", () => {
  it("runs a deterministic Dust2 shadow round and returns a shadow report", () => {
    const result = runDust2NodeShadowExperiment();

    expect(result.report.source).toBe("node_round_engine_shadow");
    expect(result.summary.source).toBe("node_round_engine_shadow");
    expect(result.summary.phaseCount).toBeGreaterThan(0);
    expect(result.summary.activeNodeCount).toBeGreaterThan(0);
    expect(result.report.audit.callsLlm).toBe(false);
    expect(result.summary.llmShadowEnabled).toBe(false);
    expect(result.summary.providerMode).toBe("none");
    expect(result.summary.llmCallsAttempted).toBe(0);
    expect(result.summary.agentActionLlmEnabled).toBe(false);
    expect(result.summary.agentActionProviderMode).toBe("none");
    expect(result.summary.agentActionCallsAttempted).toBe(0);
    expect(result.report.audit.writesDb).toBe(false);
  });

  it("exposes a final hard win condition through the report summary", () => {
    const result = runDust2NodeShadowExperiment();

    expect(result.report.finalWinCondition?.isRoundOver).toBe(true);
    expect(result.summary.status).toBe("complete");
    expect(result.summary.finalWinnerSide).toMatch(/attack|defense/);
    expect(result.summary.finalRoundWinType).toBeTruthy();
  });

  it("can run a fixture-backed LLM shadow report without touching the legacy round path", async () => {
    const result = await runDust2NodeShadowExperimentAsync({ llmShadow: true, maxLlmCalls: 5 });

    expect(result.report.source).toBe("node_round_engine_shadow");
    expect(result.report.audit.callsLlm).toBe(true);
    expect(result.report.audit.llmShadowEnabled).toBe(true);
    expect(result.summary.providerMode).toBe("fixture");
    expect(result.summary.llmShadowEnabled).toBe(true);
    expect(result.summary.llmCallsAttempted).toBeGreaterThan(0);
    expect(result.report.audit.replacesLegacyRoundPath).toBe(false);
    expect(result.report.audit.writesDb).toBe(false);
  });

  it("can run fixture-backed LLM agent actions without touching the legacy round path", async () => {
    const result = await runDust2NodeShadowExperimentAsync({
      agentActionLlmShadow: true,
      maxAgentActionLlmCalls: 5
    });

    expect(result.report.source).toBe("node_round_engine_shadow");
    expect(result.report.audit.callsLlm).toBe(true);
    expect(result.report.audit.agentActionLlmEnabled).toBe(true);
    expect(result.summary.agentActionProviderMode).toBe("fixture");
    expect(result.summary.agentActionCallsAttempted).toBeGreaterThan(0);
    expect(result.summary.agentActionDraftAcceptedCount).toBeGreaterThan(0);
    expect(result.report.audit.replacesLegacyRoundPath).toBe(false);
    expect(result.report.audit.writesDb).toBe(false);
  });

  it("falls back cleanly when real agent action provider env is disabled", async () => {
    const result = await runDust2NodeShadowExperimentAsync({
      agentActionLlmShadow: true,
      agentActionProviderMode: "real",
      maxAgentActionLlmCalls: 1,
      env: {
        AGENT_MAJOR_REAL_LLM_ENABLED: "false",
        AGENT_MAJOR_LLM_MODEL: "deepseek-v4-flash"
      }
    });

    expect(result.summary.agentActionProviderMode).toBe("real");
    expect(result.summary.agentActionCallsAttempted).toBe(1);
    expect(result.summary.agentActionFallbackCount).toBeGreaterThan(0);
    expect(result.summary.agentActionFallbackReasons.join(" ")).toContain("real_llm_disabled");
    expect(result.report.audit.writesDb).toBe(false);
    expect(result.report.audit.replacesLegacyRoundPath).toBe(false);
  });

  it("falls back cleanly when real provider env is disabled", async () => {
    const result = await runDust2NodeShadowExperimentAsync({
      llmShadow: true,
      providerMode: "real",
      maxLlmCalls: 1,
      env: {
        AGENT_MAJOR_REAL_LLM_ENABLED: "false",
        AGENT_MAJOR_LLM_MODEL: "deepseek-v4-flash"
      }
    });

    expect(result.report.source).toBe("node_round_engine_shadow");
    expect(result.summary.providerMode).toBe("real");
    expect(result.summary.llmCallsAttempted).toBe(1);
    expect(result.summary.llmFallbackCount).toBeGreaterThan(0);
    expect(result.summary.fallbackReasons.join(" ")).toContain("real_llm_disabled");
    expect(result.report.audit.writesDb).toBe(false);
    expect(result.report.audit.replacesLegacyRoundPath).toBe(false);
  });
});
