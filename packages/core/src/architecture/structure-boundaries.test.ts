import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const architectureDir = dirname(fileURLToPath(import.meta.url));
const coreSrcDir = resolve(architectureDir, "..");

function listProductionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return listProductionFiles(fullPath);
    }
    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
      return [];
    }
    return [fullPath];
  });
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
    specifiers.push(match[1] ?? "");
  }
  for (const match of source.matchAll(/\bimport\s+["']([^"']+)["']/g)) {
    specifiers.push(match[1] ?? "");
  }
  return specifiers.filter(Boolean);
}

function resolvedSpecifierPath(filePath: string, specifier: string): string {
  if (!specifier.startsWith(".")) {
    return specifier;
  }
  const withoutExtension = specifier.endsWith(".js") ? specifier.slice(0, -3) : specifier;
  const target = resolve(dirname(filePath), `${withoutExtension}.ts`);
  return relative(coreSrcDir, target).replace(/\\/g, "/");
}

function forbiddenImportHits(directory: string, forbiddenPrefixes: string[]): string[] {
  const files = listProductionFiles(resolve(coreSrcDir, directory));
  const hits: string[] = [];

  for (const file of files) {
    const relativeFile = relative(coreSrcDir, file).replace(/\\/g, "/");
    const source = readFileSync(file, "utf8");
    for (const specifier of importSpecifiers(source)) {
      const resolvedSpecifier = resolvedSpecifierPath(file, specifier);
      if (forbiddenPrefixes.some((prefix) => resolvedSpecifier.startsWith(prefix))) {
        hits.push(`${relativeFile} -> ${specifier}`);
      }
    }
  }

  return hits;
}

describe("core source architecture boundaries", () => {
  it("keeps shared economy services independent from both engines", () => {
    expect(forbiddenImportHits("economy", ["phase18/", "node-engine/"])).toEqual([]);
  });

  it("keeps the global judge pipeline independent from node-engine internals", () => {
    expect(forbiddenImportHits("judge", ["node-engine/"])).toEqual([]);
  });

  it("keeps the root public API as grouped barrel exports", () => {
    const rootIndex = readFileSync(resolve(coreSrcDir, "index.ts"), "utf8");
    const localSpecifiers = importSpecifiers(rootIndex).filter((specifier) => specifier.startsWith("./"));

    expect(localSpecifiers).toEqual([
      "./phase18/index.js",
      "./hex-engine/index.js",
      "./judge/index.js",
      "./economy/index.js",
      "./coach/index.js",
      "./llm/index.js",
      "./presentation/index.js",
      "./match/index.js",
      "./ports.js"
    ]);
  });

  it("does not expose the retired Node/Sector engine from the public core API", () => {
    const rootIndex = readFileSync(resolve(coreSrcDir, "index.ts"), "utf8");
    expect(rootIndex).not.toContain("./node-engine/");
  });

  it("keeps the retired Node/Sector runtime physically removed from core", () => {
    expect(existsSync(resolve(coreSrcDir, "node-engine"))).toBe(false);
  });
});
