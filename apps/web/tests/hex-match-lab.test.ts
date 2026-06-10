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

  it("defines a match-first real LLM validation surface", () => {
    const client = readAppFile("hex-lab/match/hex-match-lab-client.tsx");
    const mapViewer = readAppFile("hex-lab/match/hex-match-map-viewer.tsx");
    const playerPanel = readAppFile("hex-lab/match/hex-match-player-panel.tsx");
    const timeline = readAppFile("hex-lab/match/hex-match-timeline.tsx");
    const drawer = readAppFile("hex-lab/match/hex-match-audit-drawer.tsx");
    const css = readAppFile("hex-lab/match/hex-match-lab.module.css");

    expect(client).toContain("Hex Match Lab 真实 LLM 验收台");
    expect(client).toContain("进攻方");
    expect(client).toContain("防守方");
    expect(client).toContain("新建比赛");
    expect(client).toContain("安全重置");
    expect(client).toContain("跑下一回合（real）");
    expect(client).toContain("一直跑");
    expect(client).toContain("停止");
    expect(client).toContain("/api/hex-lab/match/live-run");
    expect(client).toContain("/api/hex-lab/match/map-asset");
    expect(client).toContain("当前地图已完成，不能继续提交回合。");
    expect(client).not.toContain("<select value={providerMode}");

    expect(mapViewer).toContain("Dust2 Hex 地图");
    expect(mapViewer).toContain("viewBox={bounds.viewBox}");
    expect(mapViewer).toContain("C4");
    expect(mapViewer).toContain("mapCombat");
    expect(playerPanel).toContain("roleLabel");
    expect(playerPanel).toContain("KDA");
    expect(playerPanel).toContain("本局花费");
    expect(playerPanel).toContain("AP");
    expect(timeline).toContain("Round / Phase 回放控制");
    expect(timeline).toContain("播放 trace");
    expect(drawer).toContain("LLM / Combat / Economy / Hard Winner 审计");
    expect(drawer).toContain("repaired fields");
    expect(drawer).toContain("最终 winner 只来自 hard condition");

    expect(css).toContain(".board");
    expect(css).toContain(".teamColumn");
    expect(css).toContain(".centerStage");
    expect(css).toContain(".floatingConsole");
    expect(css).toContain(".consoleReveal");
    expect(css).toContain(".liveCallRow");
    expect(css).toContain(".timelinePanel");

    for (const source of [client, mapViewer, playerPanel, timeline, drawer]) {
      expect(source).not.toMatch(/娌|鍦|绛|褰|瀹|鏂|锛|銆|€|鐪|楠|鎻|杩|閫|涓/);
      expect(source).not.toContain("sector-map.json");
      expect(source).not.toContain("node-graph.json");
    }
  });

  it("routes Hex Match Lab through dedicated APIs instead of Node Lab", () => {
    const runRoute = readAppFile("api/hex-lab/match/run/route.ts");
    const progressRoute = readAppFile("api/hex-lab/match/progress/route.ts");
    const mapsRoute = readAppFile("api/hex-lab/match/maps/route.ts");
    const createRoute = readAppFile("api/hex-lab/match/create/route.ts");
    const resetRoute = readAppFile("api/hex-lab/match/reset/route.ts");
    const liveRunRoute = readAppFile("api/hex-lab/match/live-run/route.ts");
    const mapAssetRoute = readAppFile("api/hex-lab/match/map-asset/route.ts");
    const server = readAppFile("server-hex-match-lab.ts");

    expect(runRoute).toContain("startHexMatchLabRun");
    expect(liveRunRoute).toContain("startHexMatchLabLiveRun");
    expect(liveRunRoute).toContain("readHexMatchLabLiveRun");
    expect(mapAssetRoute).toContain("readHexMatchLabMapAssetView");
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
    expect(server).toContain("repairedFields");
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
