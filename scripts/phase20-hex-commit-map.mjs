#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createSqliteRepositories, defaultSqlitePath } from "../packages/db/dist/index.js";
import { runDust2HexMapExperimental } from "../packages/core/dist/index.js";

const args = process.argv.slice(2);
const shouldCommit = args.includes("--commit");
if (!shouldCommit) {
  throw new Error("phase20-hex-commit-map requires explicit --commit.");
}

const mapSlug = readArg("--map", "dust2");
if (mapSlug.toLowerCase() !== "dust2") {
  throw new Error(`Only --map dust2 is supported in N30; received ${mapSlug}.`);
}

const providerMode = readArg("--provider", "fixture") === "real" ? "real" : "fixture";
const mapGameIdArg = readArg("--map-game-id", undefined);
const maxRounds = parsePositiveInt(readArg("--max-rounds", undefined), 40);
const maxLlmCallsPerPhase = parsePositiveInt(readArg("--max-llm-calls-per-phase", undefined), 10);

function readArg(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) {
    return fallback;
  }
  return args[index + 1] ?? fallback;
}

function parsePositiveInt(value, fallback) {
  const parsed = value === undefined ? Number.NaN : Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function findLatestDust2MapGameId(repositories) {
  const row = repositories.sqlite
    .prepare(
      `SELECT id
       FROM map_games
       WHERE lower(replace(map_name, ' ', '')) = 'dust2'
         AND status IN ('scheduled', 'running', 'overtime')
       ORDER BY created_at DESC, id DESC
       LIMIT 1`
    )
    .get();
  return row?.id;
}

class ScriptArtifactStore {
  constructor(artifacts) {
    this.artifacts = artifacts;
  }

  async write(input) {
    const content = typeof input.content === "string" ? input.content : Buffer.from(input.content).toString("utf8");
    const checksum = createHash("sha256").update(content).digest("hex");
    const artifactId = `art_${checksum.slice(0, 16)}`;
    const targetPath = resolve(process.cwd(), "data", "artifacts", input.relativePath);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, "utf8");
    const artifact = {
      id: artifactId,
      artifactType: input.artifactType,
      tournamentId: input.tournamentId,
      matchId: input.matchId,
      mapGameId: input.mapGameId,
      roundId: input.roundId,
      agentId: input.agentId,
      uri: targetPath,
      mimeType: "application/json",
      sizeBytes: Buffer.byteLength(content, "utf8"),
      checksum,
      status: "ready",
      sourceEventIds: input.sourceEventIds,
      createdAt: new Date().toISOString()
    };
    await this.artifacts.save(artifact);
    return artifact;
  }

  async readText(artifactId) {
    const artifact = await this.artifacts.getById(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }
    return readFileSync(artifact.uri, "utf8");
  }
}

function readEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) {
    return {};
  }
  const result = {};
  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    result[key] = stripOptionalQuotes(rawValue);
  }
  return result;
}

function stripOptionalQuotes(value) {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

async function main() {
  const repositories = createSqliteRepositories(resolve(process.cwd(), defaultSqlitePath));
  try {
    const mapGameId = mapGameIdArg ?? findLatestDust2MapGameId(repositories);
    if (!mapGameId) {
      throw new Error("No active Dust2 map game found. Pass --map-game-id <id> after seeding a runtime fixture.");
    }
    const artifactStore = new ScriptArtifactStore(repositories.artifacts);
    const result = await runDust2HexMapExperimental({
      repositories,
      artifactStore,
      mapGameId,
      enableExperimentalMode: true,
      providerMode,
      maxRounds,
      maxLlmCallsPerPhase,
      env: {
        ...process.env,
        ...readEnvLocal()
      }
    });

    console.log(
      JSON.stringify(
        {
          mode: "phase20_hex_map_experimental",
          committed: true,
          mapGameId,
          mapRunId: result.mapRunId,
          status: result.status,
          finalScore: result.finalScore,
          roundsCommitted: result.roundsCommitted,
          summaryArtifactId: result.summaryArtifact.id,
          roundTraceArtifactIds: result.summary.rounds.map((round) => round.hexTraceArtifactId),
          completionReason: result.completionReason,
          fallbackSummary: result.summary.fallbackSummary
        },
        null,
        2
      )
    );
  } finally {
    repositories.close();
  }
}

await main();
