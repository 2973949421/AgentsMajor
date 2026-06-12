import type { SqliteRepositoryBundle } from "@agent-major/db";

import type { Phase18RunFacts, SimulationRunRecord } from "./server-phase18-runs";

type EnvRecord = Record<string, string | undefined>;

export type NodeShadowSidecarProviderMode = "none" | "fixture" | "real";
export type NodeShadowSidecarStatus = "created" | "failed";
export type NodeShadowSidecarReport = Record<string, any>;

export interface NodeShadowSidecarAuditPayload extends Record<string, unknown> {
  schemaVersion: 1;
  status: NodeShadowSidecarStatus;
  runId: string;
  executionId: string;
  writesDb: false;
  replacesLegacyRoundPath: false;
  providerMode: NodeShadowSidecarProviderMode;
  llmShadowEnabled: boolean;
  report?: NodeShadowSidecarReport;
  error?: string;
  errorKind?: "node_shadow_sidecar_failed" | "external_provider_blocked" | "node_shadow_sidecar_retired";
}

export interface NodeShadowSidecarOptions {
  enabled: boolean;
  llmShadow: boolean;
  providerMode: NodeShadowSidecarProviderMode;
  maxLlmCalls: number;
}

export function readNodeShadowSidecarOptions(env: EnvRecord = process.env): NodeShadowSidecarOptions {
  const enabled = env.NODE_ROUND_SHADOW_AUDIT === "true";
  const llmShadow = env.NODE_ROUND_SHADOW_LLM_SHADOW === "true";
  const providerMode = normalizeProviderMode(env.NODE_ROUND_SHADOW_PROVIDER);
  const parsedMaxCalls = Number.parseInt(env.NODE_ROUND_SHADOW_MAX_LLM_CALLS ?? "", 10);
  return {
    enabled,
    llmShadow,
    providerMode: llmShadow ? providerMode : "none",
    maxLlmCalls: Number.isFinite(parsedMaxCalls) && parsedMaxCalls > 0 ? parsedMaxCalls : 5
  };
}

export async function appendNodeShadowSidecarAuditIfEnabled(input: {
  repositories: SqliteRepositoryBundle;
  run: SimulationRunRecord;
  facts: Phase18RunFacts;
  executionId: string;
  env?: EnvRecord;
}): Promise<NodeShadowSidecarAuditPayload | null> {
  const env = input.env ?? process.env;
  const options = readNodeShadowSidecarOptions(env);
  if (!options.enabled) {
    return null;
  }

  const match = await input.repositories.matches.getById(input.run.runtimeMatchId);
  if (!match) {
    return null;
  }

  const createdAt = new Date().toISOString();
  const payload = await buildNodeShadowSidecarPayload({
    runId: input.run.id,
    executionId: input.executionId,
    options,
    env
  });
  const mapGameId = input.facts.mapGameId ?? input.run.runtimeMapGameId;
  const scopeType = mapGameId ? "map" : "match";
  const scopeId = mapGameId ?? input.run.runtimeMatchId;
  const [globalSequence, sequenceInScope] = await Promise.all([
    input.repositories.events.getMaxGlobalSequence(),
    input.repositories.events.getMaxSequenceInScope(scopeType, scopeId)
  ]);

  await input.repositories.events.append({
    id: `evt_${safeEventPart(input.run.id)}_${safeEventPart(input.executionId)}_node_shadow_${payload.status}`,
    type: payload.status === "created" ? "node_round_shadow_report_created" : "node_round_shadow_report_failed",
    category: "runtime_control",
    tournamentId: match.tournamentId,
    matchId: input.run.runtimeMatchId,
    ...(mapGameId ? { mapGameId } : {}),
    payload,
    globalSequence: globalSequence + 1,
    scopeType,
    scopeId,
    sequenceInScope: sequenceInScope + 1,
    sourceModule: "web.phase20.node_shadow_sidecar",
    createdAt
  });
  return payload;
}

async function buildNodeShadowSidecarPayload(input: {
  runId: string;
  executionId: string;
  options: NodeShadowSidecarOptions;
  env: EnvRecord;
}): Promise<NodeShadowSidecarAuditPayload> {
  return {
    schemaVersion: 1,
    status: "failed",
    runId: input.runId,
    executionId: input.executionId,
    writesDb: false,
    replacesLegacyRoundPath: false,
    providerMode: input.options.providerMode,
    llmShadowEnabled: input.options.llmShadow,
    error: "Node/Sector shadow audit is retired. Use Hex Match Lab traces for Phase 2.0-pre validation.",
    errorKind: "node_shadow_sidecar_retired"
  };
}

function normalizeProviderMode(value: string | undefined): NodeShadowSidecarProviderMode {
  if (value === "real") {
    return "real";
  }
  if (value === "none") {
    return "none";
  }
  return "fixture";
}

function safeEventPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_]+/g, "_");
}
