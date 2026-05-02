import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createSqliteRepositories } from "@agent-major/db";
import { describe, expect, it } from "vitest";

import { parseEnvFile } from "./local-env.js";
import { runPhase15Command } from "./phase15.js";

describe("Phase 1.5 CLI commands", () => {
  it("runs a BO3 with real caster LLM disabled by default", async () => {
    const projectRoot = mkdtempSync(resolve(tmpdir(), "agent-major-cli-phase15-"));

    const result = await runPhase15Command("match", projectRoot, {
      AGENT_MAJOR_REAL_LLM_ENABLED: "false"
    });

    expect(result.lines[0]).toContain("disabled");
    expect(result.lines.some((line) => line.includes("Maps: 2-1"))).toBe(true);

    const repositories = createSqliteRepositories(resolve(projectRoot, "data", "agent-major.sqlite"));
    try {
      const calls = repositories.sqlite.prepare("SELECT * FROM llm_calls").all() as unknown[];
      const casterEvents = repositories.sqlite
        .prepare("SELECT payload_json FROM events WHERE type = 'caster_line_created' LIMIT 1")
        .all() as Array<{ payload_json: string }>;
      expect(calls).toHaveLength(0);
      expect(casterEvents[0]?.payload_json).toContain("\"generationMode\":\"fallback_template\"");
    } finally {
      repositories.close();
    }
  });

  it("parses local env files without overriding explicit environment values", () => {
    expect(parseEnvFile("A=1\n# comment\nB='two'\nC=\"three\"")).toEqual({ A: "1", B: "two", C: "three" });
  });
});
