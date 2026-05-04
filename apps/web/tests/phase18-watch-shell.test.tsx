import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LiveReplayPlayer } from "../app/live-replay-player";
import { RunMatchControls } from "../app/run-match-controls";

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
    expect(html).toContain("生成整场 BO3");
    expect(html).not.toContain("Run Phase 1.7");
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
