import { describe, expect, it } from "vitest";

import { buildRoundFrame, type LiveReplayData, type LiveReplayRound, type LiveReplayTimelineEvent } from "../app/live-replay-model";
import { buildBottomTickerViewModel, buildOverlayRosterViewModel, buildReplayStageState, buildRoundEvidenceViewModel } from "../app/phase18-watch-view-model";

describe("Phase 1.9 watch view model", () => {
  it("maps roster panels from replay agents, economy rows, aliases, and highlight data", () => {
    const replay = replayFixture();
    const currentRound = replay.maps[0]?.rounds[0] as LiveReplayRound;
    const frame = buildRoundFrame(currentRound, 15000);

    const teamA = buildOverlayRosterViewModel({
      replay,
      selectedMap: replay.maps[0] ?? null,
      currentRound,
      frame,
      teamKey: "teamA"
    });
    const teamB = buildOverlayRosterViewModel({
      replay,
      selectedMap: replay.maps[0] ?? null,
      currentRound,
      frame,
      teamKey: "teamB"
    });

    expect(teamA.players).toHaveLength(5);
    expect(teamA.players[0]).toMatchObject({
      displayName: "kyousuke",
      roleLabel: "Entry",
      tokenBankLabel: "$6400",
      highlight: "mvp"
    });
    expect(teamA.players[0]?.dutyLabel).toEqual(expect.any(String));
    expect(teamA.players[0]?.buyLabel).toEqual(expect.any(String));
    expect(teamA.players[0]?.metaLabel).toBe("Closer");
    expect(teamB.players[0]?.highlight).toBe("target");
    expect(teamA.coachLabel).toContain("Coach zonic");
    expect(teamA.proposalLabel).toContain("首位用户");
  });

  it("keeps replay-hidden, failed, generating, and waiting states inside the same stage contract", () => {
    expect(
      buildReplayStageState({
        hasReplay: true,
        replayGuard: { hidden: true, message: "hidden" },
        runUiState: null,
        selectedMapName: "DUST2"
      })
    ).toMatchObject({ kind: "replay_hidden" });

    expect(
      buildReplayStageState({
        hasReplay: false,
        replayGuard: { hidden: false, message: "" },
        runUiState: {
          state: "running",
          requestedMode: "phase18_next_round",
          progress: null,
          message: "running"
        },
        selectedMapName: null
      })
    ).toMatchObject({ kind: "generating" });

    expect(
      buildReplayStageState({
        hasReplay: false,
        replayGuard: { hidden: false, message: "" },
        runUiState: {
          state: "failed",
          requestedMode: "phase18_current_map",
          progress: null,
          message: "failed"
        },
        selectedMapName: null
      })
    ).toMatchObject({ kind: "failed" });

    expect(
      buildReplayStageState({
        hasReplay: false,
        replayGuard: { hidden: false, message: "" },
        runUiState: null,
        selectedMapName: null
      })
    ).toMatchObject({ kind: "waiting" });
  });

  it("maps bottom ticker summaries from replay facts instead of standalone cards", () => {
    const replay = replayFixture();
    const currentRound = replay.maps[0]?.rounds[0] as LiveReplayRound;
    const frame = buildRoundFrame(currentRound, 15000);

    const ticker = buildBottomTickerViewModel({
      replay,
      frame,
      stageState: buildReplayStageState({
        hasReplay: true,
        replayGuard: { hidden: false, message: "" },
        runUiState: null,
        selectedMapName: "DUST2"
      })
    });

    expect(ticker).toMatchObject({
      briefLabel: expect.any(String),
      latestKillLabel: expect.any(String),
      latestHighlightLabel: expect.any(String)
    });
    expect(ticker.latestKillValue).toContain("kyousuke");
    expect(ticker.latestHighlightValue).toContain("entry_swing");
  });

  it("maps round evidence from team plans, agent outputs, and judge result", () => {
    const replay = replayFixture();
    const currentRound = replay.maps[0]?.rounds[0] as LiveReplayRound;

    const evidence = buildRoundEvidenceViewModel({ replay, currentRound });

    expect(evidence.factChainLabel).toContain("2/2");
    expect(evidence.factChainLabel).toContain("10/10");
    expect(evidence.factChainLabel).toContain("1/1");
    expect(evidence.teamPlans[0]).toMatchObject({
      teamName: "Falcon-7B",
      sideLabel: expect.any(String),
      winCondition: expect.any(String)
    });
    expect(evidence.playerActions[0]).toMatchObject({
      displayName: "kyousuke",
      action: expect.any(String),
      directiveLabel: expect.any(String)
    });
    expect(evidence.judge).toMatchObject({
      winnerLabel: "Falcon-7B",
      loserLabel: "VitaLLMty",
      mvpLabel: "kyousuke"
    });
  });
});

function replayFixture(): LiveReplayData {
  const agentsById = replayFixtureAgents();
  const currentRound = roundFixture(agentsById);

  return {
    matchId: "phase18_match_falcon_7b_vs_vitallmty",
    teams: {
      teamA: { id: "team-a", displayName: "Falcon-7B", shortName: "F7B", coachDisplayName: "zonic", coachDutySummary: "暂停修正 / 半场整理 / 赛后复盘", proposalSummary: "聚焦首位用户证明，再扩系统。" },
      teamB: { id: "team-b", displayName: "VitaLLMty", shortName: "VIT", coachDisplayName: "XTQZZZ", coachDutySummary: "暂停修正 / 半场整理 / 赛后复盘", proposalSummary: "先守住系统稳定，再追求更宽扩张。" }
    },
    agentsById,
    maps: [
      {
        id: "map-1",
        order: 1,
        mapName: "DUST2",
        tacticalMap: {
          mapName: "DUST2",
          canvas: { width: 1000, height: 640 },
          fallbackZoneId: "mid",
          zones: [],
          connections: []
        },
        finalScore: { teamA: 1, teamB: 0 },
        winnerTeamId: "team-a",
        keyRoundNumbers: [1],
        rounds: [currentRound]
      }
    ]
  };
}

function roundFixture(agentsById: LiveReplayData["agentsById"]): LiveReplayRound {
  const events: LiveReplayTimelineEvent[] = [
    {
      id: "round-intro",
      atMs: 0,
      kind: "round_intro",
      payload: {},
      sequenceIndex: 0
    },
    {
      id: "kill",
      atMs: 8000,
      kind: "kill_feed_item",
      payload: {
        actorAgentId: "agent-a-1",
        targetAgentId: "agent-b-1",
        text: "kyousuke opens long",
        zoneId: "buyer_mid"
      },
      sequenceIndex: 1
    },
    {
      id: "highlight",
      atMs: 10000,
      kind: "highlight_reveal",
      payload: {
        tags: ["entry_swing"],
        mvpAgentId: "agent-a-1"
      },
      sequenceIndex: 2
    },
    {
      id: "result",
      atMs: 12000,
      kind: "round_result",
      payload: {
        winnerTeamId: "team-a",
        scoreAfterRound: { teamA: 1, teamB: 0 }
      },
      sequenceIndex: 3
    }
  ];

  return {
    id: "round-1",
    roundNumber: 1,
    agentsById,
    roundReport: {
      mapName: "DUST2",
      winnerTeamId: "team-a",
      scoreBeforeRound: { teamA: 0, teamB: 0 },
      scoreAfterRound: { teamA: 1, teamB: 0 },
      judgeResult: {
        winnerTeamId: "team-a",
        loserTeamId: "team-b",
        margin: "standard",
        reason: "Falcon-7B succeeded through sharper first-user proof; VitaLLMty failed to hold the counter claim.",
        mvpAgentId: "agent-a-1",
        confidence: 0.82
      },
      agentOutputs: buildAgentOutputs(),
      llmTeamPlans: buildTeamPlans(),
      keyEvents: [],
      economyDelta: {
        agents: buildEconomyRows(),
        teamTotals: { teamA: 25000, teamB: 25000 }
      },
      highlightTags: ["entry_swing"],
      summary: "Falcon-7B wins the opener through long pressure."
    },
    timelineEvents: events
  };
}

function buildTeamPlans() {
  return {
    "team-a": {
      teamId: "team-a",
      side: "attack" as const,
      primaryIntent: "pressure first-user clarity",
      primaryZoneId: "conversion_site_a",
      secondaryZoneId: "buyer_mid",
      coordinationSummary: "Falcon-7B compresses A long with mid support.",
      playerDirectives: [
        { agentId: "agent-a-1", directive: "Open A long and test the first-user claim." },
        { agentId: "agent-a-2", directive: "Hold the angle after entry." },
        { agentId: "agent-a-3", directive: "Close the conversion proof." },
        { agentId: "agent-a-4", directive: "Trade and stabilize spacing." },
        { agentId: "agent-a-5", directive: "Call the mid-round pivot." }
      ],
      winCondition: "prove sharper first user",
      risk: "over-indexing on star entries",
      confidence: 0.74
    },
    "team-b": {
      teamId: "team-b",
      side: "defense" as const,
      primaryIntent: "hold core user definition",
      primaryZoneId: "conversion_site_a",
      secondaryZoneId: "token_economy",
      coordinationSummary: "VitaLLMty anchors A and keeps B cave as information control.",
      playerDirectives: [
        { agentId: "agent-b-1", directive: "Hold A long with high confidence." },
        { agentId: "agent-b-2", directive: "Watch B cave drift." },
        { agentId: "agent-b-3", directive: "Probe mid timing." },
        { agentId: "agent-b-4", directive: "Support A short." },
        { agentId: "agent-b-5", directive: "Call the first rotation." }
      ],
      winCondition: "force Falcon into a broad user claim",
      risk: "late B response",
      confidence: 0.71
    }
  };
}

function buildAgentOutputs() {
  return [
    agentOutput("agent-a-1", "team-a", "entry_fragger", "kyousuke opens space from A long."),
    agentOutput("agent-a-2", "team-a", "awper", "m0NESY holds the follow-up angle."),
    agentOutput("agent-a-3", "team-a", "rifler", "NiKo converts the proof window."),
    agentOutput("agent-a-4", "team-a", "support", "TeSeS trades the second contact."),
    agentOutput("agent-a-5", "team-a", "igl", "karrigan calls the mid pivot."),
    agentOutput("agent-b-1", "team-b", "awper", "ZywOo anchors A long."),
    agentOutput("agent-b-2", "team-b", "lurker", "ropz watches B cave."),
    agentOutput("agent-b-3", "team-b", "entry_fragger", "flameZ probes mid."),
    agentOutput("agent-b-4", "team-b", "support", "mezii supports A short."),
    agentOutput("agent-b-5", "team-b", "igl", "apEX calls the retake.")
  ];
}

function agentOutput(agentId: string, teamId: string, role: string, action: string) {
  return {
    id: `out-${agentId}`,
    agentId,
    teamId,
    role,
    driverModelId: "driver_qwen_3_max_2026_01_23",
    action,
    confidence: 0.8,
    rawFingerprint: `fp-${agentId}`
  };
}

function replayFixtureAgents() {
  return Object.fromEntries(
    [
      ["agent-a-1", "kyousuke", "entry_fragger", ["closer"], ["spearhead"], ["打开空间", "试探机会窗口"]],
      ["agent-a-2", "m0NESY", "awper", ["trader"], ["scope"], ["精准定点"]],
      ["agent-a-3", "NiKo", "rifler", ["anchor"], [], ["关键回合收束"]],
      ["agent-a-4", "TeSeS", "support", ["space"], [], ["结构缝合"]],
      ["agent-a-5", "karrigan", "igl", ["macro"], ["captain"], ["优先级排布"]],
      ["agent-b-1", "ZywOo", "awper", ["lurker"], [], ["高可靠托底"]],
      ["agent-b-2", "ropz", "lurker", ["closer"], [], ["隐藏漏洞捕捉"]],
      ["agent-b-3", "flameZ", "entry_fragger", ["space"], [], ["快速试错"]],
      ["agent-b-4", "mezii", "support", ["trade"], [], ["闭环完善"]],
      ["agent-b-5", "apEX", "igl", ["pace"], ["caller"], ["节奏选择"]]
    ].map(([id, displayName, role, secondaryRoles, aliases, roleResponsibilities], index) => [
      id,
      {
        id,
        teamId: index < 5 ? "team-a" : "team-b",
        displayName,
        role,
        secondaryRoles,
        roleResponsibilities,
        aliases
      }
    ])
  );
}

function buildEconomyRows() {
  return [
    economyRow("agent-a-1", "team-a", "kyousuke", "entry_fragger", 6400, "rifle_full", 0),
    economyRow("agent-a-2", "team-a", "m0NESY", "awper", 5900, "awp_glass", 0),
    economyRow("agent-a-3", "team-a", "NiKo", "rifler", 5200, "rifle_full", 0),
    economyRow("agent-a-4", "team-a", "TeSeS", "support", 4800, "support_kit", 0),
    economyRow("agent-a-5", "team-a", "karrigan", "igl", 4300, "rifle_full", 0),
    economyRow("agent-b-1", "team-b", "ZywOo", "awper", 3100, "rifle_half", 1),
    economyRow("agent-b-2", "team-b", "ropz", "lurker", 3200, "rifle_half", 1),
    economyRow("agent-b-3", "team-b", "flameZ", "entry_fragger", 3000, "rifle_half", 1),
    economyRow("agent-b-4", "team-b", "mezii", "support", 2800, "support_half", 1),
    economyRow("agent-b-5", "team-b", "apEX", "igl", 2600, "force_call", 1)
  ];
}

function economyRow(agentId: string, teamId: string, displayName: string, role: string, afterTokenBank: number, buyType: string, lossStreak: number) {
  return {
    agentId,
    teamId,
    displayName,
    role,
    aliases: [],
    beforeTokenBank: afterTokenBank + 400,
    spent: 400,
    reward: 0,
    afterTokenBank,
    buyType,
    lossStreak
  };
}


