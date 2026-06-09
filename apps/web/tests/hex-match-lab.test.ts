import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeHexMatchLabRunRequest } from "../app/server-hex-match-lab";

describe("Hex Match Lab", () => {
  it("normalizes run requests for fixture map validation", () => {
    const normalized = normalizeHexMatchLabRunRequest({
      scope: "map",
      providerMode: "fixture",
      maxRounds: 99,
      maxLlmCallsPerPhase: -4
    });

    expect(normalized).toEqual({
      scope: "map",
      providerMode: "fixture",
      maxRounds: 60,
      maxLlmCallsPerPhase: 0
    });
    expect("mapGameId" in normalized).toBe(false);
  });

  it("keeps real provider explicit without making it the default", () => {
    expect(normalizeHexMatchLabRunRequest({ providerMode: "real", scope: "round" })).toMatchObject({
      scope: "round",
      providerMode: "real",
      maxRounds: 40,
      maxLlmCallsPerPhase: 10
    });
    expect(normalizeHexMatchLabRunRequest({})).toMatchObject({
      scope: "round",
      providerMode: "fixture"
    });
  });

  it("defines a dedicated Hex Match Lab web surface", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../app/hex-lab/match/hex-match-lab-client.tsx"), "utf8");

    expect(source).toContain("Hex Web 验收台");
    expect(source).toContain("跑 Hex 单回合");
    expect(source).toContain("跑 Hex 当前 Dust2 地图");
    expect(source).toContain("刷新最新结果");
    expect(source).toContain("打开 Hex 地图编辑器");
    expect(source).toContain("地图级摘要");
    expect(source).toContain("Round 时间线");
    expect(source).toContain("Phase 进度");
    expect(source).toContain("Agent actions");
    expect(source).toContain("Combat verdicts");
    expect(source).toContain("经济上下文");
    expect(source).toContain("LLM cannot write final winner");
    expect(source).not.toContain("sector-map.json");
    expect(source).not.toContain("node-graph.json");
  });

  it("routes Hex Match Lab through dedicated APIs instead of Node Lab", () => {
    const runRoute = readFileSync(resolve(import.meta.dirname, "../app/api/hex-lab/match/run/route.ts"), "utf8");
    const progressRoute = readFileSync(resolve(import.meta.dirname, "../app/api/hex-lab/match/progress/route.ts"), "utf8");
    const server = readFileSync(resolve(import.meta.dirname, "../app/server-hex-match-lab.ts"), "utf8");

    expect(runRoute).toContain("startHexMatchLabRun");
    expect(progressRoute).toContain("readHexMatchLabRunProgress");
    expect(server).toContain("commitDust2HexRoundExperimental");
    expect(server).toContain("runDust2HexMapExperimental");
    expect(server).toContain("hex_map_summary");
    expect(server).toContain("hex_round_engine_committed");
    expect(server).not.toContain("runDust2NodeMapExperimental");
    expect(server).not.toContain("commitDust2NodeRoundExperimental");
    expect(server).not.toContain("loadMapSectorMap");
    expect(server).not.toContain("loadMapNodeGraph");
  });

  it("exposes Hex Lab links from the existing home page without editing replay components", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../app/page.tsx"), "utf8");

    expect(source).toContain("/hex-lab/match");
    expect(source).toContain("Hex Web 验收台");
    expect(source).toContain("/hex-lab/editor");
    expect(source).toContain("LiveReplayPlayer");
  });
});
