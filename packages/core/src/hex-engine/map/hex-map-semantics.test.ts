import { describe, expect, it } from "vitest";

import { buildHexMapSemanticPromptContract, getHexCellRuleCapabilities, hexMapSemanticRules } from "./hex-map-semantics.js";

describe("HexMapSemantics", () => {
  it("keeps Region, Point, and Flag responsibilities separate", () => {
    expect(hexMapSemanticRules.region.authority).toBe("spatial_context");
    expect(hexMapSemanticRules.point.authority).toBe("tactical_target");
    expect(hexMapSemanticRules.flag.authority).toBe("hard_rule");
  });

  it("derives hard capabilities only from cell flags", () => {
    const capabilities = getHexCellRuleCapabilities({
      playable: true,
      flags: ["playable", "spawn_t", "bombsite_a", "cover", "choke", "high_risk", "route_hint"]
    });

    expect([...capabilities].sort()).toEqual(["choke", "cover", "high_risk", "plant_a", "playable", "route_hint", "t_spawn"].sort());
  });

  it("generates an LLM-facing semantic contract that forbids name-based hard rules", () => {
    const contract = buildHexMapSemanticPromptContract();

    expect(contract).toContain("Region names never grant");
    expect(contract).toContain("Point names never grant");
    expect(contract).toContain("Flag is the only hard-rule authority");
    expect(contract).toContain("code validates movement, AP, economy, combat, bomb, and winner");
  });
});
