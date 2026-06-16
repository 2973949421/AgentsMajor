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
    expect(client).toContain("real 小地图验收（6回合）");
    expect(client).toContain("一直跑");
    expect(client).toContain("停止");
    expect(client).toContain("金融攻防");
    expect(client).toContain("/api/hex-lab/match/live-run");
    expect(client).toContain("/api/hex-lab/match/map-asset");
    expect(client).toContain("当前地图已完成，不能继续提交回合。");
    expect(client).not.toContain("<select value={providerMode}");

    expect(mapViewer).toContain("Dust2 Hex 地图");
    expect(mapViewer).toContain("viewBox={bounds.viewBox}");
    expect(mapViewer).toContain("C4");
    expect(mapViewer).toContain("DROP");
    expect(mapViewer).toContain("pathCellIds");
    expect(mapViewer).toContain("polyline");
    expect(mapViewer).toContain("mapPathIntent");
    expect(mapViewer).toContain("mapAgentGhost");
    expect(mapViewer).toContain("mapCombat");
    expect(playerPanel).toContain("roleLabel");
    expect(playerPanel).toContain("KDA");
    expect(playerPanel).toContain("roundKills");
    expect(playerPanel).toContain("经济");
    expect(playerPanel).toContain("★");
    expect(playerPanel).toContain("AP");
    expect(timeline).toContain("Round / Phase 回放控制");
    expect(timeline).toContain("播放 trace");
    expect(drawer).toContain("金融攻防 / LLM / 战斗 / 经济 / 硬胜负审计");
    expect(drawer).toContain("中文审计");
    expect(drawer).toContain("function BusinessAudit");
    expect(drawer).toContain("roundValidationSummaryZh");
    expect(drawer).toContain("sampleQualityWarningsZh");
    expect(drawer).toContain("当前 round 未发现 N54 样本质量警告");
    expect(drawer).toContain("本局真实开局输出");
    expect(drawer).toContain("roundStartOutputDigests");
    expect(drawer).toContain("开局输出失败");
    expect(drawer).toContain("roundStartOutputFailures");
    expect(drawer).toContain("不会进入后续 phase 行动");
    expect(drawer).toContain("真实开局输出技术细节");
    expect(drawer).toContain("旧 trace 未记录本局真实开局输出");
    expect(drawer).toContain("真实 LLM 输出摘要");
    expect(drawer).toContain("这里展示 response artifact 中真实模型输出的微处理版本");
    expect(drawer).toContain("本阶段没有可审计的真实 agent 输出");
    expect(drawer).toContain("开局输出输入材料（系统卡，非 agent 输出）");
    expect(drawer).toContain("不是 agent 自己说的话");
    expect(drawer).toContain("可用事实");
    expect(drawer).toContain("证据缺口");
    expect(drawer).toContain("证据切片技术细节");
    expect(drawer).toContain("真实输出技术细节");
    expect(drawer).toContain("本阶段行动");
    expect(drawer).toContain("phaseValidationSummaryZh");
    expect(drawer).toContain("引用真实开局输出");
    expect(drawer).toContain("行动技术细节");
    expect(drawer).toContain("采信证据");
    expect(drawer).toContain("未采信证据");
    expect(drawer).toContain("缺失证据影响");
    expect(drawer).toContain("金融裁判理由");
    expect(drawer).toContain("CS 执行理由");
    expect(drawer).toContain("战斗技术细节");
    expect(drawer).toContain("旧 trace 未记录证据采信链");
    expect(drawer).toContain("repairSummaryZh");
    expect(drawer).toContain("守方投资主张");
    expect(drawer).toContain("攻方反证质疑");
    expect(drawer).toContain("金融裁判链路");
    expect(drawer).toContain("旧商业轨迹，只读兼容");
    expect(drawer).toContain("最终胜负只来自 hard condition");
    expect(drawer).toContain("repaired fields");
    expect(drawer).toContain("紧凑请求数量");
    expect(drawer).toContain("语言不匹配");
    expect(drawer).toContain("语义语言");
    expect(drawer).toContain("最终 winner 只来自 hard condition");

    expect(css).toContain(".board");
    expect(css).toContain(".teamColumn");
    expect(css).toContain(".centerStage");
    expect(css).toContain(".mapBombDropped");
    expect(css).toContain(".mapAgentGhost");
    expect(css).toContain(".mapPathIntent");
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
    expect(server).toContain("businessReview");
    expect(server).toContain("buildBusinessReview");
    expect(server).toContain("buildPhaseBusinessStory");
    expect(server).toContain("buildCombatStorySummary");
    expect(server).toContain("humanAudit");
    expect(server).toContain("buildHumanAudit");
    expect(server).toContain("agentOutputDigests");
    expect(server).toContain("roundStartAgentOutputs");
    expect(server).toContain("roundStartOutputDigests");
    expect(server).toContain("readHexLlmResponseArtifactSummaries");
    expect(server).toContain("buildAgentOutputDigests");
    expect(server).toContain("本阶段没有真实模型 response artifact");
    expect(server).toContain("buildHumanRoundValidationSummary");
    expect(server).toContain("buildHumanSampleQualityWarnings");
    expect(server).toContain("buildHumanPhaseValidationSummary");
    expect(server).toContain("financeEvidenceAdoption");
    expect(server).toContain("acceptedEvidenceRefs");
    expect(server).toContain("missingEvidenceApplied");
    expect(server).toContain("buildEvidenceAdoptionListZh");
    expect(server).toContain("buildHumanAgentOpeningBriefs");
    expect(server).toContain("buildHexAgentEvidenceSlices");
    expect(server).toContain("roleQuestionZh");
    expect(server).toContain("usableFactsZh");
    expect(server).toContain("evidenceRefs");
    expect(server).toContain("repairedFields");
    expect(server).toContain("phase_repeated_round_thesis");
    expect(server).toContain("phase_action_reason_too_long");
    expect(server).toContain("repaired_missing_briefRefId");
    expect(server).toContain("repaired_invalid_briefRefId");
    expect(server).toContain("repaired_missing_roundStartOutputId");
    expect(server).toContain("repaired_invalid_roundStartOutputId");
    expect(server).toContain("本行动被修复");
    expect(server).toContain("languageMismatchCount");
    expect(server).toContain("averageRequestReductionRatio");
    expect(server).toContain("pathCellIds");
    expect(server).toContain("droppedCellId");
    expect(server).toContain("sitePressure");
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
