import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ensureDataDirectories } from "./data-init.js";

let tempRoot: string | null = null;

afterEach(() => {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

describe("ensureDataDirectories", () => {
  it("can be run repeatedly without removing existing directories", () => {
    tempRoot = mkdtempSync(resolve(tmpdir(), "agent-major-"));

    ensureDataDirectories(tempRoot);
    ensureDataDirectories(tempRoot);

    expect(existsSync(resolve(tempRoot, "data"))).toBe(true);
    expect(existsSync(resolve(tempRoot, "data/exports"))).toBe(true);
    expect(existsSync(resolve(tempRoot, "data/exports/matches"))).toBe(true);
    expect(existsSync(resolve(tempRoot, "data/exports/tournaments"))).toBe(true);
    expect(existsSync(resolve(tempRoot, "data/tournaments"))).toBe(true);
  });
});
