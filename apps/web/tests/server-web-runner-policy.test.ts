import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getPublicWebRunnerPolicy, validateWebRunnerRequest } from "../app/server-web-runner-policy";

describe("Phase 1.5 web runner policy", () => {
  it("keeps the web runner disabled unless explicitly enabled", () => {
    const projectRoot = tempProjectRoot();

    expect(getPublicWebRunnerPolicy(projectRoot, {}).enabled).toBe(false);
    expect(
      validateWebRunnerRequest(localRequest(), { mode: "phase15_single_map", confirmReset: true }, projectRoot, {})
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("allows explicit localhost runs with reset confirmation", () => {
    const projectRoot = tempProjectRoot();

    expect(
      validateWebRunnerRequest(
        localRequest(),
        { mode: "phase15_single_map", confirmReset: true },
        projectRoot,
        { AGENT_MAJOR_WEB_RUNNER_ENABLED: "true" }
      )
    ).toEqual({ ok: true });
  });

  it("rejects remote access unless a token-protected remote mode is configured", () => {
    const projectRoot = tempProjectRoot();

    expect(
      validateWebRunnerRequest(
        remoteRequest(),
        { mode: "phase15_single_map", confirmReset: true },
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
        { mode: "phase15_single_map", confirmReset: true, adminToken: "local-token" },
        projectRoot,
        {
          AGENT_MAJOR_WEB_RUNNER_ENABLED: "true",
          AGENT_MAJOR_WEB_RUNNER_ALLOW_REMOTE: "true",
          AGENT_MAJOR_WEB_RUNNER_TOKEN: "local-token"
        }
      )
    ).toEqual({ ok: true });
  });
});

function tempProjectRoot(): string {
  return mkdtempSync(resolve(tmpdir(), "agent-major-web-policy-"));
}

function localRequest(): Request {
  return new Request("http://localhost:3000/api/matches/demo_match_phase11/run", {
    method: "POST",
    headers: {
      host: "localhost:3000",
      origin: "http://localhost:3000"
    }
  });
}

function remoteRequest(): Request {
  return new Request("http://192.168.1.10:3000/api/matches/demo_match_phase11/run", {
    method: "POST",
    headers: {
      host: "192.168.1.10:3000",
      origin: "http://192.168.1.10:3000"
    }
  });
}
