import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { MatchReplay } from "@agent-major/core";

const forbiddenExportKeys = new Set([
  "apiKey",
  "authorization",
  "driverModelId",
  "future_driver_binding",
  "futureDriverBinding",
  "llm_calls",
  "llmCalls",
  "modelName",
  "providerId",
  "rawOutput",
  "agentOutputs",
  "inputTokens",
  "outputTokens",
  "cost"
]);

export function exportMatchReplay(projectRoot: string, replay: MatchReplay): string {
  const exportDirectory = resolve(projectRoot, "data", "exports", "matches");
  if (!existsSync(exportDirectory)) {
    mkdirSync(exportDirectory, { recursive: true });
  }

  const exportPath = resolve(exportDirectory, `${replay.match.id}.json`);
  const sanitizedReplay = sanitizeForExport(replay) as MatchReplay;
  writeFileSync(exportPath, `${JSON.stringify(sanitizedReplay, null, 2)}\n`, "utf8");
  return exportPath;
}

function sanitizeForExport(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForExport(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenExportKeys.has(key)) {
      continue;
    }
    output[key] = sanitizeForExport(nestedValue);
  }
  return output;
}
