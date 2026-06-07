import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getPublicWebRunnerPolicy, validateWebRunnerRequest } from "../app/server-web-runner-policy";

const showcaseMatchId = "phase17_match_falcon_7b_vs_vitallmty";

describe("Phase 1.7 web runner policy", () => {
  it("keeps the web runner disabled unless explicitly enabled", () => {
    const projectRoot = tempProjectRoot();

    expect(getPublicWebRunnerPolicy(projectRoot, {}).enabled).toBe(false);
    expect(
      validateWebRunnerRequest(localRequest(), { mode: "phase17_showcase_match", confirmReset: true }, projectRoot, {})
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("allows explicit localhost runs with reset confirmation", () => {
    const projectRoot = tempProjectRoot();

    expect(
      validateWebRunnerRequest(
        localRequest(),
        { mode: "phase17_showcase_match", confirmReset: true },
        projectRoot,
        { AGENT_MAJOR_WEB_RUNNER_ENABLED: "true" }
      )
    ).toEqual({ ok: true, action: "run", mode: "phase17_showcase_match", retryMode: "full_round" });
    expect(
      validateWebRunnerRequest(
        localRequest(),
        { mode: "phase18_next_round", confirmReset: true },
        projectRoot,
        { AGENT_MAJOR_WEB_RUNNER_ENABLED: "true" }
      )
    ).toEqual({ ok: true, action: "run", mode: "phase18_next_round", retryMode: "full_round" });
    expect(
      validateWebRunnerRequest(
        localRequest(),
        { mode: "phase18_next_round", retryMode: "resume_from_stage", confirmReset: true },
        projectRoot,
        { AGENT_MAJOR_WEB_RUNNER_ENABLED: "true" }
      )
    ).toEqual({ ok: true, action: "run", mode: "phase18_next_round", retryMode: "resume_from_stage" });
    expect(
      validateWebRunnerRequest(
        localRequest(),
        { mode: "phase18_current_map", confirmReset: true },
        projectRoot,
        { AGENT_MAJOR_WEB_RUNNER_ENABLED: "true" }
      )
    ).toEqual({ ok: true, action: "run", mode: "phase18_current_map", retryMode: "full_round" });
    expect(
      validateWebRunnerRequest(
        localRequest(),
        { mode: "phase18_full_bo3", confirmReset: true },
        projectRoot,
        { AGENT_MAJOR_WEB_RUNNER_ENABLED: "true" }
      )
    ).toEqual({ ok: true, action: "run", mode: "phase18_full_bo3", retryMode: "full_round" });
    expect(
      validateWebRunnerRequest(
        localRequest(),
        { mode: "phase20_node_round_experimental", confirmReset: true },
        projectRoot,
        { AGENT_MAJOR_WEB_RUNNER_ENABLED: "true" }
      )
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      validateWebRunnerRequest(
        localRequest(),
        { mode: "phase20_node_round_experimental", confirmReset: true },
        projectRoot,
        { AGENT_MAJOR_WEB_RUNNER_ENABLED: "true", NODE_ROUND_EXPERIMENTAL_ENABLED: "true" }
      )
    ).toEqual({ ok: true, action: "run", mode: "phase20_node_round_experimental", retryMode: "full_round" });
    expect(
      validateWebRunnerRequest(
        localRequest(),
        { mode: "phase20_node_map_experimental", confirmReset: true },
        projectRoot,
        { AGENT_MAJOR_WEB_RUNNER_ENABLED: "true" }
      )
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      validateWebRunnerRequest(
        localRequest(),
        { mode: "phase20_node_map_experimental", confirmReset: true },
        projectRoot,
        { AGENT_MAJOR_WEB_RUNNER_ENABLED: "true", NODE_ROUND_MAP_EXPERIMENTAL_ENABLED: "true" }
      )
    ).toEqual({ ok: true, action: "run", mode: "phase20_node_map_experimental", retryMode: "full_round" });
  });

  it("rejects the frozen legacy web mode", () => {
    const projectRoot = tempProjectRoot();

    expect(
      validateWebRunnerRequest(
        localRequest(),
        { mode: "phase15_single_map", confirmReset: true },
        projectRoot,
        { AGENT_MAJOR_WEB_RUNNER_ENABLED: "true" }
      )
    ).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects remote access unless a token-protected remote mode is configured", () => {
    const projectRoot = tempProjectRoot();

    expect(
      validateWebRunnerRequest(
        remoteRequest(),
        { mode: "phase17_showcase_match", confirmReset: true },
        projectRoot,
        { AGENT_MAJOR_WEB_RUNNER_ENABLED: "true" }
      )
    ).toMatchObject({ ok: false, status: 403 });

    expect(
      getPublicWebRunnerPolicy(projectRoot, {
        AGENT_MAJOR_WEB_RUNNER_ENABLED: "true",
        AGENT_MAJOR_WEB_RUNNER_ALLOW_REMOTE: "true"
      })
    ).toMatchObject({ enabled: false, disabledReason: "web_runner_remote_requires_token" });

    expect(
      validateWebRunnerRequest(
        remoteRequest(),
        { mode: "phase17_showcase_match", confirmReset: true, adminToken: "local-token" },
        projectRoot,
        {
          AGENT_MAJOR_WEB_RUNNER_ENABLED: "true",
          AGENT_MAJOR_WEB_RUNNER_ALLOW_REMOTE: "true",
          AGENT_MAJOR_WEB_RUNNER_TOKEN: "local-token"
        }
      )
    ).toEqual({ ok: true, action: "run", mode: "phase17_showcase_match", retryMode: "full_round" });
  });
});

function tempProjectRoot(): string {
  return mkdtempSync(resolve(tmpdir(), "agent-major-web-policy-"));
}

function localRequest(): Request {
  return new Request(`http://localhost:3000/api/matches/${showcaseMatchId}/run`, {
    method: "POST",
    headers: {
      host: "localhost:3000",
      origin: "http://localhost:3000"
    }
  });
}

function remoteRequest(): Request {
  return new Request(`http://192.168.1.10:3000/api/matches/${showcaseMatchId}/run`, {
    method: "POST",
    headers: {
      host: "192.168.1.10:3000",
      origin: "http://192.168.1.10:3000"
    }
  });
}
