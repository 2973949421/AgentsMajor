import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeNodeLabRunRequest } from "../app/server-node-lab";

describe("Node Lab request normalization", () => {
  it("keeps deterministic runs from enabling LLM shadow", () => {
    expect(
      normalizeNodeLabRunRequest({
        scope: "map",
        providerMode: "deterministic",
        agentActionLlmShadow: true,
        localJudgeLlmShadow: true,
        maxRounds: 8
      })
    ).toMatchObject({
      scope: "map",
      providerMode: "deterministic",
      agentActionLlmShadow: false,
      localJudgeLlmShadow: false,
      maxRounds: 8
    });
  });

  it("preserves fixture shadow switches", () => {
    expect(
      normalizeNodeLabRunRequest({
        scope: "round",
        providerMode: "fixture",
        agentActionLlmShadow: true,
        localJudgeLlmShadow: false
      })
    ).toMatchObject({
      scope: "round",
      providerMode: "fixture",
      agentActionLlmShadow: true,
      localJudgeLlmShadow: false
    });
  });

  it("forces real mode to pass both LLM shadow channels to core and clamps limits", () => {
    expect(
      normalizeNodeLabRunRequest({
        scope: "map",
        providerMode: "real",
        agentActionLlmShadow: false,
        localJudgeLlmShadow: false,
        maxRounds: 99,
        maxAgentActionLlmCalls: 99,
        maxLocalJudgeLlmCalls: -5
      })
    ).toEqual({
      scope: "map",
      providerMode: "real",
      agentActionLlmShadow: true,
      localJudgeLlmShadow: true,
      maxRounds: 40,
      maxAgentActionLlmCalls: 20,
      maxLocalJudgeLlmCalls: 0
    });
  });

  it("keeps the Node Lab primary UI focused on real LLM and sector map observation", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../app/node-lab/node-lab-client.tsx"), "utf8");

    expect(source).toContain("区块视图");
    expect(source).toContain("详细节点");
    expect(source).toContain("Dust2Map");
    expect(source).toContain("sectorStates");
    expect(source).toContain("Round / Phase");
    expect(source).toContain("LLM");
    expect(source).toContain('providerMode: "real"');
    expect(source).not.toContain("<option value=\"deterministic\">");
    expect(source).not.toContain("<option value=\"fixture\">");
  });

  it("defines the Dust2 sector map as the default visual layer", () => {
    const sectorMap = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../data/materials/processed/maps/dust2/sector-map.json"), "utf8")) as {
      sectors: Array<{ sectorId: string; nodeIds: string[] }>;
    };

    expect(sectorMap.sectors).toHaveLength(13);
    expect(sectorMap.sectors.map((sector) => sector.sectorId)).toContain("a_site");
    expect(sectorMap.sectors.map((sector) => sector.sectorId)).toContain("mid_top_mid");
    expect(sectorMap.sectors.flatMap((sector) => sector.nodeIds)).toHaveLength(39);
  });
});
