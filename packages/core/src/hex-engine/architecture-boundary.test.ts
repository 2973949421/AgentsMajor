import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

const forbiddenHexRuntimeTokens = [
  "node-engine",
  "node-graph",
  "sector-map",
  "local-node-judge",
  "NodeGraph",
  "SectorMap"
] as const;

const scannedFiles = [
  ...listTypeScriptFiles(join(repoRoot, "packages/core/src/hex-engine")).filter(
    (filePath) => !filePath.endsWith("architecture-boundary.test.ts")
  ),
  join(repoRoot, "packages/shared/src/hex-schemas.ts"),
  join(repoRoot, "packages/shared/src/hex-schemas.test.ts")
];

describe("HexEngine architecture boundary", () => {
  it("does not depend on the frozen Node/Sector runtime or assets", () => {
    const violations: string[] = [];

    for (const filePath of scannedFiles) {
      const content = readFileSync(filePath, "utf8");
      for (const token of forbiddenHexRuntimeTokens) {
        if (content.includes(token)) {
          violations.push(`${relative(repoRoot, filePath)} contains ${token}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

function listTypeScriptFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...listTypeScriptFiles(fullPath));
      continue;
    }
    if (entry.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
}
