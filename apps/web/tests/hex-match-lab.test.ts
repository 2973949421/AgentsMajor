import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeHexMatchLabRunRequest } from "../app/server-hex-match-lab";

const appRoot = resolve(import.meta.dirname, "../app");

function readAppFile(path: string): string {
  return readFileSync(resolve(appRoot, path), "utf8");
}

describe("Hex Match Lab", () => {
  it("defaults Web run requests to real provider while keeping fixture explicit for tests", () => {
    expect(normalizeHexMatchLabRunRequest({})).toMatchObject({
      scope: "round",
      providerMode: "real",
      maxRounds: 40,
      maxLlmCallsPerPhase: 10
    });

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

  it("defines a real LLM Hex Match Lab validation surface with playback controls", () => {
    const client = readAppFile("hex-lab/match/hex-match-lab-client.tsx");
    const mapViewer = readAppFile("hex-lab/match/hex-match-map-viewer.tsx");
    const playerPanel = readAppFile("hex-lab/match/hex-match-player-panel.tsx");
    const timeline = readAppFile("hex-lab/match/hex-match-timeline.tsx");
    const drawer = readAppFile("hex-lab/match/hex-match-audit-drawer.tsx");

    expect(client).toContain("Hex Match Lab 真实 LLM 验收台");
    expect(client).toContain("新建 Hex 验收比赛");
    expect(client).toContain("安全重置为新地图");
    expect(client).toContain("跑下一回合（real）");
    expect(client).toContain("一直跑到地图结束（逐回合）");
    expect(client).toContain("停止运行 / 暂停播放");
    expect(client).toContain("当前主入口只保留真实 LLM");
    expect(client).toContain("前端不重新计算 winner");
    expect(client).toContain("当前地图已 completed");
    expect(client).not.toContain("<select value={providerMode}");

    expect(mapViewer).toContain("Dust2 Hex 地图");
    expect(mapViewer).toContain("行动路径预览");
    expect(mapViewer).toContain("C4");
    expect(mapViewer).toContain("交火");
    expect(playerPanel).toContain("选手状态");
    expect(playerPanel).toContain("AP");
    expect(playerPanel).toContain("lastSeen");
    expect(timeline).toContain("Round / Phase 播放控制");
    expect(timeline).toContain("播放 trace");
    expect(timeline).toContain("上一 phase");
    expect(timeline).toContain("地图回合进度");
    expect(drawer).toContain("LLM / Combat / Economy / Hard Winner 审计");
    expect(drawer).toContain("draft:invalid_phaseId");
    expect(drawer).toContain("最终 winner 只来自 hard condition");

    expect(client).not.toContain("sector-map.json");
    expect(client).not.toContain("node-graph.json");
  });

  it("routes Hex Match Lab through dedicated APIs instead of Node Lab", () => {
    const runRoute = readAppFile("api/hex-lab/match/run/route.ts");
    const progressRoute = readAppFile("api/hex-lab/match/progress/route.ts");
    const mapsRoute = readAppFile("api/hex-lab/match/maps/route.ts");
    const createRoute = readAppFile("api/hex-lab/match/create/route.ts");
    const resetRoute = readAppFile("api/hex-lab/match/reset/route.ts");
    const server = readAppFile("server-hex-match-lab.ts");

    expect(runRoute).toContain("startHexMatchLabRun");
    expect(progressRoute).toContain("readHexMatchLabRunProgress");
    expect(mapsRoute).toContain("listHexMatchLabMapGames");
    expect(createRoute).toContain("createHexMatchLabValidationMap");
    expect(resetRoute).toContain("resetHexMatchLabValidationMap");
    expect(server).toContain("commitDust2HexRoundExperimental");
    expect(server).toContain("runDust2HexMapExperimental");
    expect(server).toContain("hex_map_summary");
    expect(server).toContain("hex_round_engine_committed");
    expect(server).toContain("mapAssetView");
    expect(server).toContain("buildPlayerCards");
    expect(server).toContain("unwrapHexRoundTrace");
    expect(server).not.toContain("runDust2NodeMapExperimental");
    expect(server).not.toContain("commitDust2NodeRoundExperimental");
    expect(server).not.toContain("loadMapSectorMap");
    expect(server).not.toContain("loadMapNodeGraph");
  });

  it("exposes Hex Lab links from the existing home page without editing replay components", () => {
    const source = readAppFile("page.tsx");

    expect(source).toContain("/hex-lab/match");
    expect(source).toContain("Hex Web");
    expect(source).toContain("/hex-lab/editor");
    expect(source).toContain("Hex");
    expect(source).toContain("LiveReplayPlayer");
  });
});
