import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type EnvRecord = Record<string, string | undefined>;

export function loadLocalEnv(projectRoot: string, fileName = ".env.local", baseEnv: EnvRecord = process.env): EnvRecord {
  const merged: EnvRecord = { ...baseEnv };
  const envPath = resolve(projectRoot, fileName);
  if (!existsSync(envPath)) {
    return merged;
  }

  const entries = parseEnvFile(readFileSync(envPath, "utf8"));
  for (const [key, value] of Object.entries(entries)) {
    if (typeof merged[key] === "undefined") {
      merged[key] = value;
    }
  }

  return merged;
}

export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = unquoteEnvValue(line.slice(separatorIndex + 1).trim());
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      result[key] = value;
    }
  }

  return result;
}

function unquoteEnvValue(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}
