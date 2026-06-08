import type { AgentActionDecision } from "@agent-major/shared";
import { describe, expect, it } from "vitest";

import { normalizeAgentActionDecision } from "./agent-action-boundary.js";

describe("agent action boundary", () => {
  it("normalizes common English tactical fragments without changing the decision shape", () => {
    const decision: AgentActionDecision = {
      roundObjective: "primary task is window control",
      executionPlan: "probe toward site with controlled aggression",
      coordinationPlan: "do not overcommit before rotation",
      roleResponsibilityUsage: "hold crossfire sightlines",
      riskRead: "flank risk from spawn",
      contingencyPlan: "immediately rotate",
      expectedContribution: "closeout the round",
      confidence: 0.72
    };

    const normalized = normalizeAgentActionDecision(decision);

    expect(normalized).toMatchObject({
      roundObjective: expect.stringContaining("首要任务"),
      executionPlan: expect.stringContaining("试探"),
      confidence: 0.72
    });
    expect(Object.keys(normalized).sort()).toEqual(Object.keys(decision).sort());
  });
});
