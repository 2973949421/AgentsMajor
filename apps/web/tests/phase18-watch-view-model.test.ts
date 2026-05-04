import { describe, expect, it } from "vitest";

import { buildRoundFrame, type LiveReplayData, type LiveReplayRound, type LiveReplayTimelineEvent } from "../app/live-replay-model";
import { buildBottomTickerViewModel, buildOverlayRosterViewModel, buildReplayStageState } from "../app/phase18-watch-view-model";

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
      buyLabel: "长枪满配",
      highlight: "mvp"
    });
    expect(teamA.players[0]?.metaLabel).toBe("Closer");
    expect(teamB.players[0]?.highlight).toBe("target");
  });

  it("keeps replay-hidden, failed, generating, and waiting states inside the same stage contract", () => {
    expect(
      buildReplayStageState({
        hasReplay: true,
        replayGuard: { hidden: true, message: "hidden" },
        runUiState: null,
        selectedMapName: "DUST2"
      })
    ).toMatchObject({ kind: "replay_hidden", title: "等待新的事实回放" });

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
    ).toMatchObject({ kind: "generating", badge: "生成中" });

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
    ).toMatchObject({ kind: "failed", title: "本次运行没有产出新的回放事实" });

    expect(
      buildReplayStageState({
        hasReplay: false,
        replayGuard: { hidden: false, message: "" },
        runUiState: null,
        selectedMapName: null
      })
    ).toMatchObject({ kind: "waiting", badge: "待生成" });
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
      briefLabel: "局势摘要",
      latestKillLabel: "最新击杀",
      latestHighlightLabel: "高光焦点"
    });
    expect(ticker.latestKillValue).toContain("kyousuke");
    expect(ticker.latestHighlightValue).toContain("entry_swing");
  });
});

function replayFixture(): LiveReplayData {
  const agentsById = replayFixtureAgents();
  const currentRound = roundFixture(agentsById);

  return {
    matchId: "phase18_match_falcon_7b_vs_vitallmty",
    teams: {
      teamA: { id: "team-a", displayName: "Falcon-7B", shortName: "F7B" },
      teamB: { id: "team-b", displayName: "VitaLLMty", shortName: "VIT" }
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

function replayFixtureAgents() {
  return Object.fromEntries(
    [
      ["agent-a-1", "kyousuke", "entry_fragger", ["closer"], ["spearhead"]],
      ["agent-a-2", "m0NESY", "awper", ["trader"], ["scope"]],
      ["agent-a-3", "NiKo", "rifler", ["anchor"], []],
      ["agent-a-4", "TeSeS", "support", ["space"], []],
      ["agent-a-5", "karrigan", "igl", ["macro"], ["captain"]],
      ["agent-b-1", "ZywOo", "awper", ["lurker"], []],
      ["agent-b-2", "ropz", "lurker", ["closer"], []],
      ["agent-b-3", "flameZ", "entry_fragger", ["space"], []],
      ["agent-b-4", "mezii", "support", ["trade"], []],
      ["agent-b-5", "apEX", "igl", ["pace"], ["caller"]]
    ].map(([id, displayName, role, secondaryRoles, aliases], index) => [
      id,
      {
        id,
        teamId: index < 5 ? "team-a" : "team-b",
        displayName,
        role,
        secondaryRoles,
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
