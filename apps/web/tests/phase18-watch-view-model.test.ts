import { describe, expect, it } from "vitest";

import { buildRoundFrame, type LiveReplayAgent, type LiveReplayData, type LiveReplayRound, type LiveReplayTimelineEvent } from "../app/live-replay-model";
import {
  buildBottomTickerViewModel,
  buildOverlayRosterViewModel,
  buildReplayStageState,
  buildRoundEvidenceViewModel,
  buildRoundOutcomeViewModel
} from "../app/phase18-watch-view-model";

describe("Phase 1.9 watch view model", () => {
  it("maps roster KDA as current-map cumulative stats and keeps current-round kills separate", () => {
    const replay = replayFixture();
    const currentRound = replay.maps[0]!.rounds[1]!;
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
      kdaLabel: "3 / 0 / --",
      roundKillLabel: "1",
      hpLabel: "--",
      totalEconomyLabel: "$6400",
      roundSpendLabel: "$1900",
      highlight: "mvp"
    });
    expect(teamA.players[0]).not.toHaveProperty("metaLabel");
    expect(teamA.players[0]).not.toHaveProperty("dutyLabel");
    expect(teamA.players[0]).not.toHaveProperty("buyLabel");
    expect(teamA.players[0]).not.toHaveProperty("statusLabel");
    expect(teamA.timeoutsLabel).toBe("战术暂停 1/2");
    expect(teamB.players[1]).toMatchObject({
      displayName: "ZywOo",
      kdaLabel: "2 / 2 / --",
      roundKillLabel: "1"
    });
    expect(teamA.coachLabel).toContain("Coach zonic");
    expect(teamA.proposalLabel).toContain("首位用户");
  });

  it("rolls roster cumulative KDA back when viewing round 1", () => {
    const replay = replayFixture();
    const currentRound = replay.maps[0]!.rounds[0]!;
    const frame = buildRoundFrame(currentRound, 15000);

    const teamA = buildOverlayRosterViewModel({
      replay,
      selectedMap: replay.maps[0] ?? null,
      currentRound,
      frame,
      teamKey: "teamA"
    });

    expect(teamA.players[0]).toMatchObject({
      displayName: "kyousuke",
      kdaLabel: "2 / 0 / --",
      roundKillLabel: "2"
    });
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

  it("maps bottom ticker summaries from kill ledger facts without unknown victims", () => {
    const replay = replayFixture();
    const currentRound = replay.maps[0]!.rounds[1]!;
    const frame = buildRoundFrame(currentRound, 15000);

    const ticker = buildBottomTickerViewModel({
      replay,
      currentRound,
      frame,
      stageState: buildReplayStageState({
        hasReplay: true,
        replayGuard: { hidden: false, message: "" },
        runUiState: null,
        selectedMapName: "DUST2"
      })
    });

    expect(ticker.latestKillValue).toContain("ZywOo");
    expect(ticker.latestKillValue).toContain("NiKo");
    expect(ticker.latestKillValue).not.toContain("未知");
    expect(ticker.latestHighlightValue).toContain("entry_swing");
    expect(ticker.roundOutcome).toMatchObject({
      winMethodLabel: expect.any(String),
      casualtyDensityLabel: expect.any(String),
      combatShapeLabel: expect.any(String),
      tradeIntensityLabel: expect.any(String)
    });
  });

  it("maps judge diagnostic facts as the primary audit evidence", () => {
    const replay = replayFixture();
    const currentRound = replay.maps[0]!.rounds[0]!;
    const frame = buildRoundFrame(currentRound, 15000);

    const evidence = buildRoundEvidenceViewModel({ replay, currentRound, frame });

    expect(evidence.judge?.diagnostic).toMatchObject({
      currentSubTheme: "用户定义战",
      mainAttackZoneLabel: "A 点",
      mainDefenseZoneLabel: "中路",
      attackedOpportunityGap: "VitaLLMty 的第一用户定义不够集中",
      defendedCoreProposition: "Falcon-7B 守住了首位用户证明"
    });
    expect(evidence.judge?.diagnosticMissingLabel).toBeUndefined();
  });

  it("keeps old rounds without judge diagnostic explicit instead of fabricating audit facts", () => {
    const replay = replayFixture();
    const currentRound = {
      ...replay.maps[0]!.rounds[0]!,
      roundReport: {
        ...replay.maps[0]!.rounds[0]!.roundReport,
        judgeDiagnostic: undefined,
        judgeResult: {
          ...replay.maps[0]!.rounds[0]!.roundReport.judgeResult,
          diagnostic: undefined
        }
      }
    };
    const frame = buildRoundFrame(currentRound, 15000);

    const evidence = buildRoundEvidenceViewModel({ replay, currentRound, frame });

    expect(evidence.judge?.diagnostic).toBeNull();
    expect(evidence.judge?.diagnosticMissingLabel).toContain("旧回合未归档裁判诊断");
  });

  it("derives different win methods and casualty densities from kill ledger shape", () => {
    const cases = [
      {
        title: "attack elimination",
        winnerTeamId: "team-a",
        attackingTeamId: "team-a",
        killCount: 8,
        margin: "decisive" as const,
        tacticalResult: "attack_breakthrough" as const,
        roundWinType: "attack_elimination",
        expectLabel: "攻方全歼胜",
        expectDensity: "极高战损"
      },
      {
        title: "attack bomb explosion",
        winnerTeamId: "team-a",
        attackingTeamId: "team-a",
        killCount: 1,
        margin: "standard" as const,
        tacticalResult: "trade_even" as const,
        roundWinType: "attack_bomb_explosion",
        expectLabel: "攻方下包爆炸胜",
        expectDensity: "低战损"
      },
      {
        title: "defense defuse",
        winnerTeamId: "team-b",
        attackingTeamId: "team-a",
        killCount: 4,
        margin: "standard" as const,
        tacticalResult: "rotate_success" as const,
        roundWinType: "defense_defuse",
        expectLabel: "守方拆包胜",
        expectDensity: "中战损"
      },
      {
        title: "defense timeout",
        winnerTeamId: "team-b",
        attackingTeamId: "team-a",
        killCount: 1,
        margin: "narrow" as const,
        tacticalResult: "defense_hold" as const,
        roundWinType: "defense_timeout_no_plant",
        expectLabel: "守方超时未下包胜",
        expectDensity: "低战损"
      }
    ];

    for (const testCase of cases) {
      const replay = replayFixture();
      const currentRound = replay.maps[0]!.rounds[0]!;
      const frame = buildRoundFrame(currentRound, 15000);
      const alteredRound = {
        ...currentRound,
        roundReport: {
          ...currentRound.roundReport,
          winnerTeamId: testCase.winnerTeamId,
          judgeResult: {
            ...currentRound.roundReport.judgeResult,
            margin: testCase.margin,
            roundWinType: testCase.roundWinType
          }
        },
        tacticalRound: {
          ...currentRound.tacticalRound!,
          sideAssignment: {
            ...currentRound.tacticalRound!.sideAssignment,
            attackingTeamId: testCase.attackingTeamId
          },
          collision: {
            ...currentRound.tacticalRound!.collision,
            result: testCase.tacticalResult
          }
        }
      } as LiveReplayRound;
      const alteredFrame = {
        ...frame,
        killLedger: Array.from({ length: testCase.killCount }, (_, index) => ({
          ...frame.killLedger[0]!,
          id: `test-ledger-${testCase.title}-${index}`,
          atMs: 8000 + index * 1000,
          text: frame.killLedger[0]?.text ?? "test kill"
        }))
      };

      const outcome = buildRoundOutcomeViewModel({ currentRound: alteredRound, frame: alteredFrame });

      expect(outcome).toMatchObject({
        winMethodLabel: testCase.expectLabel,
        casualtyDensityLabel: testCase.expectDensity
      });
    }
  });

  it("maps round evidence from team plans, agent outputs, judge result, and round outcome", () => {
    const replay = replayFixture();
    const currentRound = replay.maps[0]!.rounds[0]!;
    const frame = buildRoundFrame(currentRound, 15000);
    const evidence = buildRoundEvidenceViewModel({ replay, currentRound, frame });

    expect(evidence.factChainLabel).toContain("战术暂停");
    expect(evidence.factChainLabel).toContain("2/2");
    expect(evidence.factChainLabel).toContain("10/10");
    expect(evidence.factChainLabel).toContain("1/1");
    expect(evidence.coachTimeoutCorrection).toMatchObject({
      teamName: "Falcon-7B",
      expiresAfterRoundLabel: "仅对 R1 生效"
    });
    expect(evidence.teamPlans[0]).toMatchObject({
      teamName: "Falcon-7B",
      sideLabel: "进攻方",
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
    expect(evidence.roundOutcome).toMatchObject({
      winMethodLabel: expect.any(String),
      casualtyDensityLabel: expect.any(String)
    });
  });
});

function replayFixture(): LiveReplayData {
  const agentsById = replayFixtureAgents();
  const roundOne = roundFixture({ id: "round-1", roundNumber: 1, scoreBefore: { teamA: 0, teamB: 0 }, scoreAfter: { teamA: 1, teamB: 0 } });
  const roundTwo = roundFixture({ id: "round-2", roundNumber: 2, scoreBefore: { teamA: 1, teamB: 0 }, scoreAfter: { teamA: 2, teamB: 0 }, variant: "second" });

  return {
    matchId: "phase18_match_falcon_7b_vs_vitallmty",
    teams: {
      teamA: {
        id: "team-a",
        displayName: "Falcon-7B",
        shortName: "F7B",
        coachDisplayName: "zonic",
        coachDutySummary: "暂停修正 / 半场整理 / 赛后复盘",
        proposalSummary: "聚焦首位用户证明，再扩大系统。"
      },
      teamB: {
        id: "team-b",
        displayName: "VitaLLMty",
        shortName: "VIT",
        coachDisplayName: "XTQZZZ",
        coachDutySummary: "暂停修正 / 半场整理 / 赛后复盘",
        proposalSummary: "先守住系统稳定，再追求更宽扩张。"
      }
    },
    agentsById,
    postMatchReviews: [
      {
        teamId: "team-a",
        status: "pending",
        review: {
          timeoutQualityReview: "暂停质量合格，下一场继续加强首位用户验证。",
          nextMatchUpgrades: ["更早收束主命题", "压缩无效侧翼试探"],
          proposedStrategyPatch: "把首位用户证明窗口前置到开局两局。"
        }
      }
    ],
    maps: [
      {
        id: "map-1",
        order: 1,
        mapName: "DUST2",
        tacticalMap: {
          mapName: "DUST2",
          canvas: { width: 1000, height: 640 },
          fallbackZoneId: "buyer_mid",
          zones: [],
          connections: []
        },
        timeoutsRemainingByTeam: {
          "team-a": 1,
          "team-b": 2
        },
        finalScore: { teamA: 2, teamB: 0 },
        winnerTeamId: "team-a",
        keyRoundNumbers: [1, 2],
        rounds: [
          { ...roundOne, agentsById },
          { ...roundTwo, agentsById }
        ]
      }
    ]
  };
}

function replayFixtureAgents(): Record<string, LiveReplayAgent> {
  return {
    "agent-a-1": agent("agent-a-1", "team-a", "kyousuke", "entry", ["space opening"]),
    "agent-a-2": agent("agent-a-2", "team-a", "m0NESY", "awper", ["precision conversion"]),
    "agent-a-3": agent("agent-a-3", "team-a", "NiKo", "star_rifler", ["multi frag close"]),
    "agent-a-4": agent("agent-a-4", "team-a", "karrigan", "igl", ["tempo calling"]),
    "agent-a-5": agent("agent-a-5", "team-a", "TeSeS", "support", ["trade support"]),
    "agent-b-1": agent("agent-b-1", "team-b", "flameZ", "entry", ["front pressure"]),
    "agent-b-2": agent("agent-b-2", "team-b", "ZywOo", "awper", ["anchor control"]),
    "agent-b-3": agent("agent-b-3", "team-b", "apEX", "igl", ["mid round calling"]),
    "agent-b-4": agent("agent-b-4", "team-b", "ropz", "lurker", ["late punish"]),
    "agent-b-5": agent("agent-b-5", "team-b", "mezii", "support", ["stabilize trades"])
  };
}

function agent(id: string, teamId: string, displayName: string, role: string, roleResponsibilities: string[]): LiveReplayAgent {
  return {
    id,
    teamId,
    displayName,
    role,
    secondaryRoles: [],
    roleResponsibilities,
    aliases: []
  };
}

function roundFixture(input: {
  id: string;
  roundNumber: number;
  scoreBefore: { teamA: number; teamB: number };
  scoreAfter: { teamA: number; teamB: number };
  variant?: "first" | "second";
}): LiveReplayRound {
  const killLedger = buildKillLedger(input.variant);
  const events: LiveReplayTimelineEvent[] = [
    { id: `${input.id}-intro`, atMs: 0, kind: "round_intro", payload: {}, sequenceIndex: 0 },
    ...killLedger.map((entry, index) => ({
      id: `${input.id}-kill-${index + 1}`,
      atMs: entry.atMs,
      kind: "kill_feed_item" as const,
      payload: {
        actorAgentId: entry.actorAgentId,
        targetAgentId: entry.targetAgentId,
        text: entry.impact,
        zoneId: entry.zoneId
      },
      sequenceIndex: index + 1
    })),
    {
      id: `${input.id}-highlight`,
      atMs: 12000,
      kind: "highlight_reveal",
      payload: {
        tags: ["entry_swing"],
        mvpAgentId: "agent-a-1"
      },
      sequenceIndex: 20
    },
    {
      id: `${input.id}-result`,
      atMs: 14000,
      kind: "round_result",
      payload: {
        winnerTeamId: "team-a",
        scoreAfterRound: input.scoreAfter
      },
      sequenceIndex: 21
    }
  ];

  return {
    id: input.id,
    roundNumber: input.roundNumber,
    agentsById: {},
    roundReport: {
      mapName: "DUST2",
      winnerTeamId: "team-a",
      scoreBeforeRound: input.scoreBefore,
      scoreAfterRound: input.scoreAfter,
      judgeResult: {
        winnerTeamId: "team-a",
        loserTeamId: "team-b",
        margin: "standard",
        roundWinType: "attack_elimination",
        attackWinConditionMet: true,
        defenseWinConditionMet: false,
        reason: "Falcon-7B 成功证明首位用户切口，VitaLLMty 未能守住反论点。",
        mvpAgentId: "agent-a-1",
        confidence: 0.82,
        diagnostic: {
          currentSubTheme: "用户定义战",
          attackedOpportunityGap: "VitaLLMty 的第一用户定义不够集中",
          defendedCoreProposition: "Falcon-7B 守住了首位用户证明",
          mainAttackZoneId: "conversion_site_a",
          mainDefenseZoneId: "buyer_mid",
          decisiveEvidence: "Falcon-7B 用 A 点推进证明了首位用户切口。"
        }
      },
      judgeDiagnostic: {
        currentSubTheme: "用户定义战",
        attackedOpportunityGap: "VitaLLMty 的第一用户定义不够集中",
        defendedCoreProposition: "Falcon-7B 守住了首位用户证明",
        mainAttackZoneId: "conversion_site_a",
        mainDefenseZoneId: "buyer_mid",
        decisiveEvidence: "Falcon-7B 用 A 点推进证明了首位用户切口。"
      },
      appliedCoachTimeoutCorrection: {
        teamId: "team-a",
        triggerRoundNumber: 1,
        triggerReason: "连续暴露同一命题缺口，触发战术暂停。",
        diagnosedFailure: "首位用户证明点不够集中。",
        nextRoundObjective: "下一回合必须更快地锁定 A 点证明窗口。",
        ownCoreToHold: "守住首位用户定义权。",
        opponentGapToHit: "对手对 A 点证明窗口的反应迟缓。",
        zonePriorityShift: "A 点优先，中路次之，放掉低价值侧翼。",
        teamDirective: "全队统一围绕 A 点证明窗口执行，不再分散资源。",
        playerAdjustments: [
          { agentId: "agent-a-1", adjustment: "更早打开 A 点首接触。" },
          { agentId: "agent-a-2", adjustment: "更快补到 A 点高价值枪线。" },
          { agentId: "agent-a-3", adjustment: "提前准备二次转化收束。" },
          { agentId: "agent-a-4", adjustment: "减少无效转点，统一节奏。" },
          { agentId: "agent-a-5", adjustment: "把道具优先留给 A 点兑现。" }
        ],
        expiresAfterRoundNumber: input.roundNumber,
        confidence: 0.78
      },
      agentOutputs: buildAgentOutputs(),
      llmTeamPlans: buildTeamPlans(),
      keyEvents: [],
      killLedger,
      economyDelta: {
        agents: buildEconomyRows(),
        teamTotals: { teamA: 25000, teamB: 25000 }
      },
      highlightTags: ["entry_swing"],
      summary: "Falcon-7B 通过 A 点长枪施压拿下开局。",
      tacticalContext: tacticalContextFixture()
    },
    timelineEvents: events,
    tacticalRound: tacticalContextFixture()
  } as unknown as LiveReplayRound;
}

function tacticalContextFixture() {
  return {
    sideAssignment: {
      attackingTeamId: "team-a",
      defendingTeamId: "team-b"
    },
    attackPlan: {
      teamId: "team-a",
      primaryTargetZoneId: "conversion_site_a",
      secondaryTargetZoneId: "buyer_mid",
      approach: "slow_control",
      publicSummary: "Falcon-7B 先控中路，再压 A 点。"
    },
    defenseDeployment: {
      teamId: "team-b",
      heavyZoneId: "conversion_site_a",
      weakZoneIds: ["token_economy"],
      setup: "retake_setup",
      publicSummary: "VitaLLMty 重点守 A，B 洞保留信息。"
    },
    collision: {
      primaryZoneId: "conversion_site_a",
      result: "attack_breakthrough",
      decisiveReason: "进攻方在 A 点长枪对抗中完成突破。"
    }
  };
}

function buildTeamPlans() {
  return {
    "team-a": {
      teamId: "team-a",
      side: "attack" as const,
      primaryIntent: "优先证明首位用户存在",
      primaryZoneId: "conversion_site_a",
      secondaryZoneId: "buyer_mid",
      coordinationSummary: "Falcon-7B 先控中路，再压 A 长。",
      playerDirectives: [
        { agentId: "agent-a-1", directive: "打开 A 长并逼出对手首位用户判断。" },
        { agentId: "agent-a-2", directive: "架住补枪角度。" },
        { agentId: "agent-a-3", directive: "完成关键转化。" },
        { agentId: "agent-a-4", directive: "补交易并稳住站位。" },
        { agentId: "agent-a-5", directive: "控制中期转点节奏。" }
      ],
      winCondition: "证明首位用户判断更准",
      risk: "过度依赖明星枪位",
      confidence: 0.74
    },
    "team-b": {
      teamId: "team-b",
      side: "defense" as const,
      primaryIntent: "守住核心用户定义",
      primaryZoneId: "conversion_site_a",
      secondaryZoneId: "token_economy",
      coordinationSummary: "VitaLLMty 锁定 A 点，B 洞保留信息控制。",
      playerDirectives: [
        { agentId: "agent-b-1", directive: "高强度守住 A 长。" },
        { agentId: "agent-b-2", directive: "盯住 B 洞信息。" },
        { agentId: "agent-b-3", directive: "试探中路节奏。" },
        { agentId: "agent-b-4", directive: "补 A 小支援。" },
        { agentId: "agent-b-5", directive: "指挥首波轮转。" }
      ],
      winCondition: "逼迫 Falcon 扩散用户口径",
      risk: "B 区回防偏慢",
      confidence: 0.71
    }
  };
}

function buildAgentOutputs() {
  return [
    output("agent-a-1", "team-a", "entry", "从 A 长打开空间"),
    output("agent-a-2", "team-a", "awper", "架住中路补枪线"),
    output("agent-a-3", "team-a", "star_rifler", "完成二次转化"),
    output("agent-a-4", "team-a", "igl", "统一中期节奏"),
    output("agent-a-5", "team-a", "support", "补道具并托底"),
    output("agent-b-1", "team-b", "entry", "前顶 A 长施压"),
    output("agent-b-2", "team-b", "awper", "守住高价值枪位"),
    output("agent-b-3", "team-b", "igl", "组织轮转与补位"),
    output("agent-b-4", "team-b", "lurker", "卡住转点路线"),
    output("agent-b-5", "team-b", "support", "补闪与守区")
  ];
}

function output(agentId: string, teamId: string, role: string, action: string) {
  return {
    id: `out-${agentId}`,
    agentId,
    teamId,
    role,
    action,
    confidence: 0.82,
    rawFingerprint: `${agentId}-fp`
  };
}

function buildKillLedger(variant: "first" | "second" = "first") {
  if (variant === "second") {
    return [
      ledger("kl-r2-1", "agent-a-1", "team-a", "agent-b-2", "team-b", "buyer_mid", 8000, "kyousuke 击杀 ZywOo"),
      ledger("kl-r2-2", "agent-b-2", "team-b", "agent-a-3", "team-a", "conversion_site_a", 9000, "ZywOo 击杀 NiKo")
    ];
  }
  return [
    ledger("kl-1", "agent-a-1", "team-a", "agent-b-1", "team-b", "buyer_mid", 8000, "kyousuke 击杀 flameZ"),
    ledger("kl-2", "agent-b-2", "team-b", "agent-a-4", "team-a", "conversion_site_a", 9000, "ZywOo 击杀 karrigan"),
    ledger("kl-3", "agent-a-3", "team-a", "agent-b-2", "team-b", "conversion_site_a", 10000, "NiKo 击杀 ZywOo"),
    ledger("kl-4", "agent-a-1", "team-a", "agent-b-3", "team-b", "conversion_site_a", 11000, "kyousuke 击杀 apEX")
  ];
}

function ledger(
  id: string,
  actorAgentId: string,
  actorTeamId: string,
  targetAgentId: string,
  targetTeamId: string,
  zoneId: string,
  atMs: number,
  impact: string
) {
  return {
    id,
    actorAgentId,
    actorTeamId,
    targetAgentId,
    targetTeamId,
    zoneId,
    atMs,
    impact,
    sourceEventId: `evt-${id}`,
    sourceAgentOutputIds: [`out-${actorAgentId}`]
  };
}

function buildEconomyRows() {
  return [
    economy("agent-a-1", "team-a", "kyousuke", "entry", 8300, 1900, 0, 6400, "fullBuy"),
    economy("agent-a-2", "team-a", "m0NESY", "awper", 7600, 2100, 0, 5500, "fullBuy"),
    economy("agent-a-3", "team-a", "NiKo", "star_rifler", 7400, 1800, 0, 5600, "fullBuy"),
    economy("agent-a-4", "team-a", "karrigan", "igl", 7000, 1600, 0, 5400, "fullBuy"),
    economy("agent-a-5", "team-a", "TeSeS", "support", 6800, 1500, 0, 5300, "fullBuy"),
    economy("agent-b-1", "team-b", "flameZ", "entry", 7200, 1800, 0, 5400, "fullBuy"),
    economy("agent-b-2", "team-b", "ZywOo", "awper", 7400, 2100, 0, 5300, "fullBuy"),
    economy("agent-b-3", "team-b", "apEX", "igl", 6900, 1700, 0, 5200, "fullBuy"),
    economy("agent-b-4", "team-b", "ropz", "lurker", 7100, 1600, 0, 5500, "fullBuy"),
    economy("agent-b-5", "team-b", "mezii", "support", 6700, 1500, 0, 5200, "fullBuy")
  ];
}

function economy(
  agentId: string,
  teamId: string,
  displayName: string,
  role: string,
  beforeTokenBank: number,
  spent: number,
  reward: number,
  afterTokenBank: number,
  buyType: string
) {
  return {
    agentId,
    teamId,
    displayName,
    role,
    aliases: [],
    beforeTokenBank,
    spent,
    reward,
    afterTokenBank,
    buyType,
    lossStreak: 0
  };
}
