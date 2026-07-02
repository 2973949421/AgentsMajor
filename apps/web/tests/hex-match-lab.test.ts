import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildHexMatchPhasePlaybackFrame, getHexMatchPhaseTickCount } from "../app/hex-lab/match/hex-match-phase-ticks";
import { normalizeHexMatchLabRunRequest, type HexMatchLabPhaseSummary, type HexMatchLabPlayerCard } from "../app/server-hex-match-lab";

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

  it("derives phase playback ticks from action paths without changing trace facts", () => {
    const phase = buildTestPhase([
      { agentId: "agent_a", currentCellId: "a0", pathCellIds: ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "a10"] },
      { agentId: "agent_b", currentCellId: "b0", pathCellIds: ["b1", "b2", "b3", "b4", "b5"] }
    ]);

    expect(getHexMatchPhaseTickCount(phase)).toBe(10);

    const firstFrame = buildHexMatchPhasePlaybackFrame(phase, 0);
    expect(firstFrame.tickLabel).toBe("Phase tick 1/10");
    expect(firstFrame.legacyFallback).toBe(false);
    expect(firstFrame.players.find((player) => player.agentId === "agent_a")?.currentCellId).toBe("a1");
    expect(firstFrame.players.find((player) => player.agentId === "agent_b")?.currentCellId).toBe("b1");

    const sixthFrame = buildHexMatchPhasePlaybackFrame(phase, 5);
    expect(sixthFrame.players.find((player) => player.agentId === "agent_a")?.currentCellId).toBe("a6");
    expect(sixthFrame.players.find((player) => player.agentId === "agent_b")?.currentCellId).toBe("b5");
    expect(sixthFrame.agentStates.find((state) => state.agentId === "agent_b")?.stopped).toBe(true);

    const deathPhase = buildTestPhase([
      { agentId: "agent_b", currentCellId: "b0", pathCellIds: ["b1", "b2", "b3"] }
    ], "agent_b");
    const preDeathReveal = buildHexMatchPhasePlaybackFrame(deathPhase, 0);
    expect(preDeathReveal.players.find((player) => player.agentId === "agent_b")?.lifeStatus).toBe("alive");
    const deathReveal = buildHexMatchPhasePlaybackFrame(deathPhase, 2);
    expect(deathReveal.players.find((player) => player.agentId === "agent_b")?.lifeStatus).toBe("dead");
    expect(deathReveal.agentStates.find((state) => state.agentId === "agent_b")?.phaseDeathRevealed).toBe(true);

    const legacyFrame = buildHexMatchPhasePlaybackFrame(buildTestPhase([]), 9);
    expect(legacyFrame.tickCount).toBe(1);
    expect(legacyFrame.legacyFallback).toBe(true);
    expect(legacyFrame.players.find((player) => player.agentId === "agent_a")?.currentCellId).toBe("a0");
  });

  it("defines a match-first real LLM validation surface", () => {
    const client = readAppFile("hex-lab/match/hex-match-lab-client.tsx");
    const mapViewer = readAppFile("hex-lab/match/hex-match-map-viewer.tsx");
    const playerPanel = readAppFile("hex-lab/match/hex-match-player-panel.tsx");
    const timeline = readAppFile("hex-lab/match/hex-match-timeline.tsx");
    const phaseTicks = readAppFile("hex-lab/match/hex-match-phase-ticks.ts");
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
    expect(client).toContain("打开本 round 审计");
    expect(client).toContain("selectedPhaseTickIndex");
    expect(client).toContain("buildHexMatchPhasePlaybackFrame");
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
    expect(mapViewer).toContain("playbackFrame");
    expect(mapViewer).toContain("tickPlaybackNote");
    expect(mapViewer).toContain("mapAgentDead");
    expect(mapViewer).toContain("阵亡");
    expect(playerPanel).toContain("roleLabel");
    expect(playerPanel).toContain("KDA");
    expect(playerPanel).toContain("roundKills");
    expect(playerPanel).toContain("经济");
    expect(playerPanel).toContain("★");
    expect(playerPanel).toContain("AP");
    expect(timeline).toContain("Round / Phase 回放控制");
    expect(timeline).toContain("播放 trace");
    expect(timeline).toContain("上一 tick");
    expect(timeline).toContain("下一 tick");
    expect(timeline).toContain("phaseTickLabel");
    expect(phaseTicks).toContain("buildHexMatchPhasePlaybackFrame");
    expect(phaseTicks).toContain("legacyFallback");
    expect(drawer).toContain("金融决策审计");
    expect(drawer).toContain("这页按三步读");
    expect(drawer).toContain("先看 Phase0 金融卡");
    expect(drawer).toContain("再看当前 Phase 行动");
    expect(drawer).toContain("最后看裁判与战斗");
    expect(drawer).toContain("1. Phase0 金融攻防卡");
    expect(drawer).toContain("2. 当前 Phase 局内行动");
    expect(drawer).toContain("3. 金融采信与 CS 结果");
    expect(drawer).toContain("完整 response artifact");
    expect(drawer).toContain("FinanceOutputAuditViewList");
    expect(drawer).toContain("模型输出的可提交原文");
    expect(drawer).toContain("原文长度");
    expect(drawer).toContain("预算使用率");
    expect(drawer).toContain("经济剪裁");
    expect(drawer).toContain("charsPerSpendUnit");
    expect(drawer).toContain("cutMode");
    expect(drawer).toContain("被裁剪");
    expect(drawer).toContain("系统输入材料（非 agent 输出）");
    expect(drawer).toContain("RoundStartCardSummary");
    expect(drawer).toContain("目标 claim");
    expect(drawer).toContain("phase0RefId");
    expect(drawer).toContain("PlayerFinanceAudit");
    expect(drawer).toContain("无正向采信");
    expect(drawer).toContain("金融层未形成额外胜负解释");
    expect(drawer).toContain("CS 执行解释");
    expect(drawer).toContain("N65-full 对枪形态");
    expect(drawer).toContain("主对枪");
    expect(drawer).toContain("次级 pair");
    expect(drawer).toContain("Round 质量闸门");
    expect(drawer).toContain("战术选择审计");
    expect(drawer).toContain("为什么选这套");
    expect(drawer).toContain("角色路线分工");
    expect(drawer).toContain("本 round 不应作为正式比赛审计或计分样本");
    expect(drawer).toContain("击杀、淘汰、下包、拆包和最终胜负来自 CS 执行事实与 hard condition");
    expect(drawer).toContain("旧 trace 未记录 stanceCard / challengeCard");
    expect(drawer).toContain("技术细节");
    expect(drawer).toContain("function BusinessAudit");
    expect(css).toContain(".board");
    expect(css).toContain(".teamColumn");
    expect(css).toContain(".centerStage");
    expect(css).toContain(".mapBombDropped");
    expect(css).toContain(".mapAgentGhost");
    expect(css).toContain(".mapAgentDead");
    expect(css).toContain(".mapPathIntent");
    expect(css).toContain(".floatingConsole");
    expect(css).toContain(".consoleReveal");
    expect(css).toContain(".liveCallRow");
    expect(css).toContain(".timelinePanel");

    for (const source of [client, mapViewer, playerPanel, timeline, phaseTicks, drawer]) {
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
    expect(server).toContain("roundQualityStatus");
    expect(server).toContain("roundQualitySummaryZh");
    expect(server).toContain("listRoundTraceArtifactSummaries");
    expect(server).toContain("traceArtifacts");
    expect(server).toContain("commitStatus");
    expect(server).toContain("未计为可信比赛结果");
    expect(server).toContain("humanAudit");
    expect(server).toContain("buildHumanAudit");
    expect(server).toContain("decisionQuestion");
    expect(server).toContain("requiredEvidenceSchema");
    expect(server).toContain("challengePolicy");
    expect(server).toContain("缺失证据只能降权");
    expect(server).toContain("agentOutputDigests");
    expect(server).toContain("roundStartAgentOutputs");
    expect(server).toContain("roundStartOutputDigests");
    expect(server).toContain("rawFinanceOpinionZh");
    expect(server).toContain("rawOpinionCharCount");
    expect(server).toContain("submittedBudgetUtilization");
    expect(server).toContain("economyClipTier");
    expect(server).toContain("charsPerSpendUnit");
    expect(server).toContain("rawBudgetChars");
    expect(server).toContain("cutMode");
    expect(server).toContain("budgetClampReason");
    const financeProjector = readAppFile("hex-lab/match/server-hex-finance-audit-projector.ts");
    expect(financeProjector).toContain("formatFinanceCutModeZh");
    expect(server).toContain("submittedTextSpanRefs");
    expect(server).toContain("rawOpinionLinkStatus");
    expect(server).toContain("readHexLlmResponseArtifactSummaries");
    expect(server).toContain("buildAgentOutputDigests");
    expect(server).toContain("本阶段没有真实模型 response artifact");
    expect(server).toContain("buildHumanRoundValidationSummary");
    expect(server).toContain("buildHumanSampleQualityWarnings");
    expect(server).toContain("buildHumanPhaseValidationSummary");
    expect(server).toContain("financeEvidenceAdoption");
    expect(server).toContain("financeProjection");
    expect(server).toContain("financeFirepowerAttack");
    expect(server).toContain("financeFirepowerDefense");
    expect(server).toContain("projectionReasonsZh");
    expect(server).toContain("tacticalAudit");
    expect(server).toContain("summarizeTacticalAudit");
    expect(server).toContain("antiRepeatRegions");
    expect(server).toContain("antiRepeatPoints");
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
    expect(server).toContain("multiPairing");
    expect(server).toContain("HexMatchLabMultiPairingSummary");
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

function buildTestPhase(actions: Array<{ agentId: string; currentCellId: string; pathCellIds: string[] }>, killedAgentId?: string): HexMatchLabPhaseSummary {
  const players: HexMatchLabPlayerCard[] = [
    buildTestPlayer("agent_a", "a0"),
    buildTestPlayer("agent_b", "b0")
  ];
  return {
    phaseId: "test_phase",
    phaseIndex: 0,
    callsAttempted: 0,
    acceptedActionCount: actions.length,
    rejectedDraftCount: 0,
    fallbackActionCount: 0,
    combatContactCount: 0,
    combatResolutionCount: 0,
    memoryEventCount: 0,
    rejectedEventCount: 0,
    aliveAttackCount: 1,
    aliveDefenseCount: 1,
    bombState: { planted: false },
    actions: actions.map((action) => ({
      agentId: action.agentId,
      actionType: "move",
      currentCellId: action.currentCellId,
      targetCellId: action.pathCellIds.at(-1),
      pathCellIds: action.pathCellIds,
      verticalLinkIds: [],
      valid: true,
      validationErrors: [],
      repairedFields: []
    })),
    combats: killedAgentId ? [{ contactId: "combat_1", participants: ["agent_a", "agent_b"], casualties: [`${killedAgentId}:killed`], killAttributions: [{ targetAgentId: killedAgentId, result: "killed", assisterAgentIds: [], attributionReasons: [] }] }] : [],
    players: killedAgentId ? players.map((player) => player.agentId === killedAgentId ? { ...player, lifeStatus: "dead" } : player) : players,
    llmAudit: { expectedCalls: 0, actualCalls: 0, acceptedCount: 0, rejectedCount: 0, fallbackCount: 0, providerErrorCount: 0, invalidResponseCount: 0, requestArtifactIds: [], responseArtifactIds: [], retryRecoveredCount: 0, finalFallbackCount: 0 },
    memoryBeforeSummary: { agentCount: 2, aliveAttackCount: 1, aliveDefenseCount: 1, c4CarrierAgentId: "agent_a", knownEnemyCount: 0, recentEventCount: 0 },
    memoryAfterSummary: { agentCount: 2, aliveAttackCount: 1, aliveDefenseCount: 1, c4CarrierAgentId: "agent_a", knownEnemyCount: 0, recentEventCount: 0 }
  } as HexMatchLabPhaseSummary;
}

function buildTestPlayer(agentId: string, currentCellId: string): HexMatchLabPlayerCard {
  return {
    agentId,
    displayName: agentId,
    roleLabel: "rifler",
    kda: "0/0/0",
    roundKills: 0,
    teamId: agentId === "agent_a" ? "attack" : "defense",
    side: agentId === "agent_a" ? "attack" : "defense",
    lifeStatus: "alive",
    currentCellId,
    currentPointIds: [],
    currentPointNames: [],
    apBudget: 3,
    apSpent: 0,
    apRemaining: 3,
    carryingC4: agentId === "agent_a",
    knownEnemyCount: 0,
    lastSeenEnemyCount: 0,
    validationErrors: []
  };
}
