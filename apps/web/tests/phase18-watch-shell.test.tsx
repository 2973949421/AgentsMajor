import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LiveReplayPlayer } from "../app/live-replay-player";
import { RunMatchControls, type WebRunProgress } from "../app/run-match-controls";

describe("Phase 1.9 watch shell", () => {
  it("public ops controls only expose Phase 1.8 actions", () => {
    const html = renderToStaticMarkup(
      <RunMatchControls
        matchId="phase18_match_falcon_7b_vs_vitallmty"
        runnerPolicy={{ enabled: true, requiresToken: false, allowRemote: false }}
      />
    );

    expect(html).toContain("生成下一局");
    expect(html).toContain("生成当前地图");
    expect(html).toContain("一直生成");
    expect(html).toContain("生成整场 BO3");
    expect(html).not.toContain(">断点继续</button>");
    expect(html).not.toContain("Run Phase 1.7");
  });

  it("separates committed replay round from latest failed attempt round", () => {
    const html = renderToStaticMarkup(
      <RunMatchControls
        matchId="phase18_match_falcon_7b_vs_vitallmty"
        runnerPolicy={{ enabled: true, requiresToken: false, allowRemote: false }}
        initialProgress={failedProgressFixture()}
      />
    );

    expect(html).toContain("当前播放仍停留在 R2");
    expect(html).toContain("最新失败尝试发生在 R3");
    expect(html).toContain("重试该回合");
    expect(html).toContain("断点继续");
    expect(html).toContain("最近错误：judge failed");
  });

  it("keeps the same broadcast shell when replay data does not exist yet", () => {
    const html = renderToStaticMarkup(
      <LiveReplayPlayer
        matchId="phase18_match_falcon_7b_vs_vitallmty"
        replay={null}
        runnerPolicy={{ enabled: true, requiresToken: false, allowRemote: false }}
      />
    );

    expect(html).toContain("控制台");
    expect(html).toContain("先生成一局，再开始看比赛");
    expect(html).toContain("生成下一局");
  });
});

function failedProgressFixture(): WebRunProgress {
  return {
    runId: "phase18_run_test",
    mode: "phase18_next_round",
    matchId: "phase18_match_falcon_7b_vs_vitallmty",
    fixtureId: "phase18_match_falcon_7b_vs_vitallmty",
    runtimeMatchId: "phase18_match_falcon_7b_vs_vitallmty__run_test",
    targetMatchId: "phase18_match_falcon_7b_vs_vitallmty",
    status: "failed",
    mapGameId: "map_test",
    mapGameIds: ["map_test"],
    mapName: "DUST2",
    estimatedTotalRounds: 13,
    baselineCompletedRounds: 0,
    completedRounds: 2,
    hasFreshReplay: true,
    currentRoundNumber: 3,
    currentMapOrder: 1,
    latestCommittedRoundNumber: 2,
    casterLines: 0,
    progressPercent: 15,
    llmSummary: {
      expectedTotalCalls: 13,
      startedCalls: 1,
      completedCalls: 0,
      failedCalls: 1,
      runningCalls: 0
    },
    llmCalls: [],
    recoveredFailureCount: 0,
    currentExecutionStartedCalls: 1,
    currentExecutionCompletedCalls: 0,
    currentExecutionFailedCalls: 1,
    currentExecutionRunningCalls: 0,
    recentRuns: [],
    error: "judge failed",
    result: {
      status: "failed",
      score: "0-2"
    }
  };
}
