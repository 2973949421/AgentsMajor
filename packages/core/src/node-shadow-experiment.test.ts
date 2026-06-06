import { describe, expect, it } from "vitest";

import { runDust2NodeShadowExperiment } from "./node-shadow-experiment.js";

describe("Dust2 node shadow experiment", () => {
  it("runs a deterministic Dust2 shadow round and returns a shadow report", () => {
    const result = runDust2NodeShadowExperiment();

    expect(result.report.source).toBe("node_round_engine_shadow");
    expect(result.summary.source).toBe("node_round_engine_shadow");
    expect(result.summary.phaseCount).toBeGreaterThan(0);
    expect(result.summary.activeNodeCount).toBeGreaterThan(0);
    expect(result.report.audit.callsLlm).toBe(false);
    expect(result.report.audit.writesDb).toBe(false);
  });

  it("exposes a final hard win condition through the report summary", () => {
    const result = runDust2NodeShadowExperiment();

    expect(result.report.finalWinCondition?.isRoundOver).toBe(true);
    expect(result.summary.status).toBe("complete");
    expect(result.summary.finalWinnerSide).toMatch(/attack|defense/);
    expect(result.summary.finalRoundWinType).toBeTruthy();
  });
});
