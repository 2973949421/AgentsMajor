import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  commitDust2NodeRoundExperimental,
  createEnvOpenAiCompatibleDriverModel,
  createPhase18SimulationEngine,
  defaultDriverModels,
  FakeProvider,
  loadMapNodeGraph,
  loadMapSectorMap,
  loadAgentMajorLlmConfig,
  runDust2NodeMapExperimental,
  summarizePhaseSectors,
  UnconfiguredJobQueue
} from "@agent-major/core";
import { validateMapSectorMap } from "@agent-major/core";
import { createSqliteRepositories, defaultSqlitePath, type SqliteRepositoryBundle } from "@agent-major/db";
import {
  buildPhase18RuntimeMatchId,
  phase18CanonIds,
  phase20PrePilotMapIds
} from "@agent-major/materials";

import { ServerLocalArtifactStore } from "./server-artifact-store";
import { loadRootLocalEnv } from "./server-local-env";
import { findProjectRoot } from "./server-project-root";
import { readNodeMapExperimentalProgress, sanitizeRunError } from "./server-run-progress";
import { ensurePhase18RuntimeFixture, selectCurrentPhase18MapGameId } from "./server-runner";

export type NodeLabScope = "round" | "map";
export type NodeLabProviderMode = "deterministic" | "fixture" | "real";
export type NodeLabRunStatus = "idle" | "running" | "completed" | "failed";

export interface NodeLabRunRequest {
  scope: NodeLabScope;
  providerMode: NodeLabProviderMode;
  agentActionLlmShadow: boolean;
  localJudgeLlmShadow: boolean;
  maxRounds: number;
  maxAgentActionLlmCalls: number;
  maxLocalJudgeLlmCalls: number;
}

export interface NodeLabRunProgress {
  runId: string;
  status: NodeLabRunStatus;
  scope: NodeLabScope;
  providerMode: NodeLabProviderMode;
  modelId?: string;
  runtimeMatchId: string;
  mapGameId: string;
  mapName: string;
  score: { teamA: number; teamB: number };
  roundsCommitted: number;
  nodeTraceArtifactIds: string[];
  mapSummaryArtifactId?: string;
  completionReason?: string;
  latestError?: string;
  externalBlocked: boolean;
  llmAudit: NodeLabLlmAuditProgress;
  roundSummaries: NodeLabRoundSummary[];
  mapGraph: NodeLabMapGraph;
  roundTraces: NodeLabRoundTraceDetail[];
  latestRoundTrace?: NodeLabRoundTraceDetail;
}

export interface NodeLabMapGraph {
  nodes: NodeLabMapNode[];
  edges: NodeLabMapEdge[];
  sectors: NodeLabMapSector[];
  sectorEdges: NodeLabMapSectorEdge[];
}

export interface NodeLabMapNode {
  nodeId: string;
  displayName: string;
  area: string;
  kind?: string;
}

export interface NodeLabMapEdge {
  from: string;
  to: string;
  type: string;
  label?: string;
}

export interface NodeLabMapSector {
  sectorId: string;
  displayName: string;
  displayNameZh: string;
  areaType: string;
  nodeIds: string[];
  adjacentSectorIds: string[];
  polygon: Array<[number, number]>;
}

export interface NodeLabMapSectorEdge {
  from: string;
  to: string;
  type: string;
}

export interface NodeLabLlmAuditProgress {
  providerMode: NodeLabProviderMode;
  modelId?: string;
  callsAttempted: number;
  fallbackCount: number;
  fallbackReasons: string[];
  ignoredFields: string[];
  draftAcceptedCount: number;
  draftRejectedCount: number;
  contentLength: number;
  reasoningContentLength: number;
  jsonTruncated: boolean;
  reasoningExhausted: boolean;
  agentActionCallsAttempted: number;
  agentActionFallbackCount: number;
  agentActionFallbackReasons: string[];
  agentActionIgnoredFields: string[];
  agentActionDraftAcceptedCount: number;
  agentActionDraftRejectedCount: number;
  agentActionContentLength: number;
  agentActionReasoningContentLength: number;
  agentActionJsonTruncated: boolean;
  agentActionReasoningExhausted: boolean;
}

export interface NodeLabRoundSummary {
  roundNumber: number;
  winnerTeamId?: string;
  loserTeamId?: string;
  roundWinType?: string;
  nodeTraceArtifactId: string;
  totalApSpent: number;
  fallbackCount: number;
  ignoredFields: string[];
  finalHardCondition?: {
    isRoundOver: boolean;
    winnerSide?: "attack" | "defense";
    winnerTeamId?: string;
    roundWinType?: string;
    reason: string;
  };
}

export interface NodeLabRoundTraceDetail extends NodeLabRoundSummary {
  source: "node_round_engine_committed";
  writesDb: true;
  replacesLegacyRoundPath: false;
  phaseSummaries: NodeLabPhaseSummary[];
  phaseDetails: NodeLabPhaseDetail[];
  audit: NodeLabLlmAuditProgress;
}

export interface NodeLabPhaseSummary {
  phaseId: string;
  activeNodeCount: number;
  actionCount: number;
  localVerdictCount: number;
  contestedNodeIds: string[];
  attackControlledNodeIds: string[];
  defenseControlledNodeIds: string[];
  neutralNodeIds: string[];
  businessIntentSummary: string[];
  winCondition?: {
    isRoundOver: boolean;
    winnerSide?: "attack" | "defense";
    roundWinType?: string;
    reason: string;
  };
}

export interface NodeLabPhaseDetail {
  phaseId: string;
  activeNodeIds: string[];
  nodeStates: NodeLabNodeState[];
  sectorStates: NodeLabSectorState[];
  actionPointBudgets: Array<{
    agentId: string;
    baseAp: number;
    spentAp: number;
    remainingAp: number;
  }>;
  agentActions: Array<{
    agentId: string;
    currentNodeId?: string;
    targetNodeId: string;
    actionType: string;
    apCost: number;
    side?: "attack" | "defense";
    teamId?: string;
    agentRole?: string;
    roleResponsibilities?: string[];
    roleActionBias?: string[];
    teamThesisAnchor?: string;
    businessOperatingPrinciple?: string;
    coachNote?: string;
    businessIntent: string;
  }>;
  localVerdicts: Array<{
    nodeId: string;
    controlAfter: string;
    engagementOccurred: boolean;
    triggersWinConditionCheck: boolean;
    summary: string;
  }>;
}

export interface NodeLabSectorState {
  sectorId: string;
  nodeIds: string[];
  active: boolean;
  attackCount: number;
  defenseCount: number;
  controlAfter: string;
  engagementOccurred: boolean;
  winConditionCheck: boolean;
  fallbackCount: number;
}

export interface NodeLabNodeState {
  nodeId: string;
  phaseId: string;
  attackAgentIds: string[];
  defenseAgentIds: string[];
  control: string;
  businessIntent?: string;
}

interface ActiveNodeLabExecution {
  runId: string;
  promise: Promise<void>;
}

type SimulationRunRecord = NonNullable<Awaited<ReturnType<SqliteRepositoryBundle["simulationRuns"]["getById"]>>>;

let activeNodeLabExecution: ActiveNodeLabExecution | null = null;

export function normalizeNodeLabRunRequest(value: unknown): NodeLabRunRequest {
  const record = parseRecord(value) ?? {};
  const providerMode = normalizeProviderMode(record.providerMode);
  const scope = record.scope === "map" ? "map" : "round";
  const deterministic = providerMode === "deterministic";
  const real = providerMode === "real";

  return {
    scope,
    providerMode,
    agentActionLlmShadow: deterministic ? false : real ? true : record.agentActionLlmShadow === true,
    localJudgeLlmShadow: deterministic ? false : real ? true : record.localJudgeLlmShadow === true,
    maxRounds: clampInteger(record.maxRounds, scope === "map" ? 8 : 1, 1, 40),
    maxAgentActionLlmCalls: clampInteger(record.maxAgentActionLlmCalls, 5, 0, 20),
    maxLocalJudgeLlmCalls: clampInteger(record.maxLocalJudgeLlmCalls, 5, 0, 20)
  };
}

export async function startNodeLabRun(request: NodeLabRunRequest): Promise<NodeLabRunProgress> {
  if (activeNodeLabExecution) {
    const activeProgress = await readNodeLabRunProgress(activeNodeLabExecution.runId);
    if (activeProgress) {
      return activeProgress;
    }
  }

  const projectRoot = findProjectRoot(process.cwd());
  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  const now = new Date().toISOString();
  const runId = createNodeLabRunId();
  const runtimeMatchId = buildPhase18RuntimeMatchId(runId, phase18CanonIds.fixtureId);
  try {
    const seeded = await ensureNodeLabRuntimeFixture({
      repositories,
      projectRoot,
      runtimeMatchId
    });
    const mapGameId = await selectCurrentPhase18MapGameId(repositories, seeded.matchId);
    const mapGame = await repositories.mapGames.getById(mapGameId);
    if (!mapGame) {
      throw new Error(`Node Lab failed to prepare current Dust2 map: ${mapGameId}`);
    }
    const baselineRounds = readCommittedRoundCount(repositories, runtimeMatchId);
    const run: SimulationRunRecord = {
      id: runId,
      fixtureId: phase18CanonIds.fixtureId,
      status: "running",
      requestedMode: request.scope === "map" ? "phase20_node_map_experimental" : "phase20_node_round_experimental",
      promptContractId: "phase20-pre-node-lab",
      runtimeMatchId,
      runtimeMapGameId: mapGameId,
      baselineCompletedRounds: baselineRounds,
      estimatedTotalRounds: baselineRounds + (request.scope === "map" ? request.maxRounds : 1),
      expectedTotalCalls: estimateNodeLabCalls(request),
      latestCommittedRoundNumber: mapGame.currentRoundNumber,
      hasFreshReplay: baselineRounds > 0,
      createdAt: now,
      startedAt: now
    };
    await repositories.simulationRuns.save(run);
  } finally {
    repositories.close();
  }

  const promise = runNodeLabExecution(runId, request).finally(() => {
    if (activeNodeLabExecution?.runId === runId) {
      activeNodeLabExecution = null;
    }
  });
  activeNodeLabExecution = { runId, promise };

  const progress = await readNodeLabRunProgress(runId);
  if (!progress) {
    throw new Error(`Unable to read newly created Node Lab run: ${runId}`);
  }
  return progress;
}

export async function readNodeLabRunProgress(runId?: string | null): Promise<NodeLabRunProgress | null> {
  const projectRoot = findProjectRoot(process.cwd());
  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  try {
    const run = await resolveNodeLabRun(repositories, runId ?? undefined);
    if (!run) {
      return null;
    }
    const mapGameId = run.runtimeMapGameId ?? (await safeSelectCurrentMapGameId(repositories, run.runtimeMatchId));
    const mapGame = mapGameId ? await repositories.mapGames.getById(mapGameId) : null;
    const env = loadRootLocalEnv(projectRoot, process.env);
    const modelId = loadAgentMajorLlmConfig(env).modelName ?? loadAgentMajorLlmConfig(env).phase18DriverModelId;
    const roundTraces = readNodeLabRoundTraces(repositories, run.runtimeMatchId, projectRoot);
    const mapSummary = readNodeMapExperimentalProgress(repositories, run.runtimeMatchId);
    const llmAudit = aggregateLlmAudit(roundTraces, run);
    const latestTrace = roundTraces.at(-1);
    return {
      runId: run.id,
      status: normalizeNodeLabStatus(run.status),
      scope: run.requestedMode === "phase20_node_map_experimental" ? "map" : "round",
      providerMode: llmAudit.providerMode,
      ...(llmAudit.modelId || modelId ? { modelId: llmAudit.modelId ?? modelId } : {}),
      runtimeMatchId: run.runtimeMatchId,
      mapGameId: mapGame?.id ?? mapSummary?.mapGameId ?? "",
      mapName: mapGame?.mapName ?? mapSummary?.mapName ?? "Dust2",
      score: mapGame ? { teamA: mapGame.teamAScore, teamB: mapGame.teamBScore } : (mapSummary?.finalScore ?? { teamA: 0, teamB: 0 }),
      roundsCommitted: roundTraces.length,
      nodeTraceArtifactIds: roundTraces.map((trace) => trace.nodeTraceArtifactId),
      ...(mapSummary?.summaryArtifactId ? { mapSummaryArtifactId: mapSummary.summaryArtifactId } : {}),
      ...(mapSummary?.completionReason ? { completionReason: mapSummary.completionReason } : {}),
      ...(run.latestError ? { latestError: run.latestError } : {}),
      externalBlocked: Boolean(run.latestError && isExternalProviderBlocked(run.latestError)),
      llmAudit,
      roundSummaries: mapSummary?.roundSummaries ?? roundTraces.map(toRoundSummary),
      mapGraph: readDust2NodeGraphSummary(projectRoot),
      roundTraces,
      ...(latestTrace ? { latestRoundTrace: latestTrace } : {})
    };
  } finally {
    repositories.close();
  }
}

async function runNodeLabExecution(runId: string, request: NodeLabRunRequest): Promise<void> {
  const projectRoot = findProjectRoot(process.cwd());
  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  const artifactStore = new ServerLocalArtifactStore(projectRoot, repositories.artifacts);
  const env = loadRootLocalEnv(projectRoot, process.env);
  try {
    const run = await repositories.simulationRuns.getById(runId);
    if (!run) {
      throw new Error(`Node Lab run not found: ${runId}`);
    }
    const mapGameId = run.runtimeMapGameId ?? (await selectCurrentPhase18MapGameId(repositories, run.runtimeMatchId));
    if (request.scope === "map") {
      await runDust2NodeMapExperimental({
        repositories,
        artifactStore,
        mapGameId,
        enableMapExperimentalMode: true,
        ...buildCoreLlmOptions(request, env)
      });
    } else {
      await commitDust2NodeRoundExperimental({
        repositories,
        artifactStore,
        mapGameId,
        enableExperimentalMode: true,
        ...buildCoreLlmOptions(request, env)
      });
    }
    await finishNodeLabRun(repositories, runId, null);
  } catch (error) {
    await finishNodeLabRun(repositories, runId, sanitizeRunError(error));
  } finally {
    repositories.close();
  }
}

async function finishNodeLabRun(repositories: SqliteRepositoryBundle, runId: string, latestError: string | null): Promise<void> {
  const run = await repositories.simulationRuns.getById(runId);
  if (!run) {
    return;
  }
  const mapGameId = run.runtimeMapGameId ?? (await safeSelectCurrentMapGameId(repositories, run.runtimeMatchId));
  const mapGame = mapGameId ? await repositories.mapGames.getById(mapGameId) : null;
  const committedRounds = readCommittedRoundCount(repositories, run.runtimeMatchId);
  await repositories.simulationRuns.save({
    ...run,
    status: latestError ? "failed" : "completed",
    latestCommittedRoundNumber: mapGame?.currentRoundNumber ?? run.latestCommittedRoundNumber,
    hasFreshReplay: committedRounds > run.baselineCompletedRounds,
    ...(latestError ? { latestError } : { latestError: undefined }),
    completedAt: new Date().toISOString()
  });
}

function buildCoreLlmOptions(request: NodeLabRunRequest, env: Record<string, string | undefined>) {
  if (request.providerMode === "deterministic") {
    return {
      agentActionLlmShadow: false,
      localJudgeLlmShadow: false,
      maxRounds: request.maxRounds
    };
  }

  const coreProviderMode: "fixture" | "real" = request.providerMode === "real" ? "real" : "fixture";
  return {
    providerMode: coreProviderMode,
    agentActionProviderMode: coreProviderMode,
    localJudgeProviderMode: coreProviderMode,
    agentActionLlmShadow: request.agentActionLlmShadow,
    localJudgeLlmShadow: request.localJudgeLlmShadow,
    maxAgentActionLlmCalls: request.maxAgentActionLlmCalls,
    maxLocalJudgeLlmCalls: request.maxLocalJudgeLlmCalls,
    maxRounds: request.maxRounds,
    env
  };
}

async function ensureNodeLabRuntimeFixture(input: {
  repositories: SqliteRepositoryBundle;
  projectRoot: string;
  runtimeMatchId: string;
}): Promise<{ matchId: string; selectedMapIds: string[] }> {
  const env = loadRootLocalEnv(input.projectRoot, process.env);
  const llmConfig = loadAgentMajorLlmConfig(env);
  const engine = createPhase18SimulationEngine({
    repositories: input.repositories,
    llmGateway: new FakeProvider({ providerId: "node-lab-fixture-provider" }),
    jobQueue: new UnconfiguredJobQueue(),
    artifactStore: new ServerLocalArtifactStore(input.projectRoot, input.repositories.artifacts)
  });

  return ensurePhase18RuntimeFixture({
    repositories: input.repositories,
    projectRoot: input.projectRoot,
    driverModel: selectNodeLabDriverModel(llmConfig),
    engine,
    runtimeMatchId: input.runtimeMatchId,
    selectedMapIds: [...phase20PrePilotMapIds]
  });
}

function selectNodeLabDriverModel(llmConfig: ReturnType<typeof loadAgentMajorLlmConfig>) {
  if (llmConfig.modelName) {
    return createEnvOpenAiCompatibleDriverModel(llmConfig.modelName);
  }
  return defaultDriverModels.find((item) => item.id === llmConfig.phase18DriverModelId) ?? defaultDriverModels[0]!;
}

function readNodeLabRoundTraces(repositories: SqliteRepositoryBundle, runtimeMatchId: string, projectRoot: string): NodeLabRoundTraceDetail[] {
  const rows = repositories.sqlite
    .prepare(
      `SELECT rr.round_number AS roundNumber,
              rr.winner_team_id AS winnerTeamId,
              rr.node_trace_artifact_id AS nodeTraceArtifactId,
              a.uri AS artifactUri
       FROM round_reports rr
       LEFT JOIN artifacts a ON a.id = rr.node_trace_artifact_id
       WHERE rr.match_id = ?
         AND rr.node_trace_source = 'node_round_engine_committed'
       ORDER BY rr.round_number ASC, rr.created_at ASC`
    )
    .all(runtimeMatchId) as Array<{
    roundNumber?: unknown;
    winnerTeamId?: unknown;
    nodeTraceArtifactId?: unknown;
    artifactUri?: unknown;
  }>;

  return rows
    .map((row) => parseNodeTraceRow(row, projectRoot))
    .filter((row): row is NodeLabRoundTraceDetail => Boolean(row));
}

function parseNodeTraceRow(row: {
  roundNumber?: unknown;
  winnerTeamId?: unknown;
  nodeTraceArtifactId?: unknown;
  artifactUri?: unknown;
}, projectRoot: string): NodeLabRoundTraceDetail | null {
  if (typeof row.nodeTraceArtifactId !== "string" || typeof row.artifactUri !== "string") {
    return null;
  }
  const payload = parseRecord(readArtifactTextByUri(row.artifactUri));
  const report = parseRecord(payload?.committedReport);
  const shadowResult = parseRecord(payload?.shadowResult);
  const audit = parseRecord(report?.audit);
  const finalHardCondition = parseFinalHardCondition(report?.finalWinCondition);
  const nodeTraceArtifactId = row.nodeTraceArtifactId;
  const phaseSummaries = parsePhaseSummaries(report?.phaseSummaries);
  const sectorMap = loadValidatedDust2SectorMap(projectRoot);
  return {
    source: "node_round_engine_committed",
    writesDb: true,
    replacesLegacyRoundPath: false,
    roundNumber: typeof row.roundNumber === "number" ? row.roundNumber : readNumber(report?.roundNumber),
    ...(typeof row.winnerTeamId === "string" ? { winnerTeamId: row.winnerTeamId } : {}),
    ...(typeof finalHardCondition?.winnerTeamId === "string" ? { winnerTeamId: finalHardCondition.winnerTeamId } : {}),
    ...(typeof finalHardCondition?.roundWinType === "string" ? { roundWinType: finalHardCondition.roundWinType } : {}),
    nodeTraceArtifactId,
    totalApSpent: readNumber(audit?.totalApSpent),
    fallbackCount: readNumber(audit?.llmFallbackCount) + readNumber(audit?.agentActionFallbackCount),
    ignoredFields: uniqueSorted([...readStringArray(audit?.ignoredLlmFields), ...readStringArray(audit?.agentActionIgnoredFields)]),
    ...(finalHardCondition ? { finalHardCondition } : {}),
    phaseSummaries,
    phaseDetails: parsePhaseDetails(shadowResult?.phases, sectorMap),
    audit: parseAudit(audit)
  };
}

function parseAudit(audit: Record<string, unknown> | null | undefined): NodeLabLlmAuditProgress {
  return {
    providerMode: normalizeProviderMode(audit?.providerMode ?? audit?.agentActionProviderMode),
    ...(typeof audit?.modelId === "string" ? { modelId: audit.modelId } : typeof audit?.agentActionModelId === "string" ? { modelId: audit.agentActionModelId } : {}),
    callsAttempted: readNumber(audit?.llmCallsAttempted),
    fallbackCount: readNumber(audit?.llmFallbackCount),
    fallbackReasons: readStringArray(audit?.fallbackReasons),
    ignoredFields: readStringArray(audit?.ignoredLlmFields),
    draftAcceptedCount: readNumber(audit?.draftValidCount),
    draftRejectedCount: readNumber(audit?.draftRejectedCount),
    contentLength: readNumber(audit?.contentLength),
    reasoningContentLength: readNumber(audit?.reasoningContentLength),
    jsonTruncated: audit?.jsonTruncated === true,
    reasoningExhausted: audit?.reasoningExhausted === true,
    agentActionCallsAttempted: readNumber(audit?.agentActionCallsAttempted),
    agentActionFallbackCount: readNumber(audit?.agentActionFallbackCount),
    agentActionFallbackReasons: readStringArray(audit?.agentActionFallbackReasons),
    agentActionIgnoredFields: readStringArray(audit?.agentActionIgnoredFields),
    agentActionDraftAcceptedCount: readNumber(audit?.agentActionDraftAcceptedCount),
    agentActionDraftRejectedCount: readNumber(audit?.agentActionDraftRejectedCount),
    agentActionContentLength: readNumber(audit?.agentActionContentLength),
    agentActionReasoningContentLength: readNumber(audit?.agentActionReasoningContentLength),
    agentActionJsonTruncated: audit?.agentActionJsonTruncated === true,
    agentActionReasoningExhausted: audit?.agentActionReasoningExhausted === true
  };
}

function aggregateLlmAudit(roundTraces: NodeLabRoundTraceDetail[], run: SimulationRunRecord): NodeLabLlmAuditProgress {
  const audits = roundTraces.map((trace) => trace.audit);
  const providerMode = audits.find((audit) => audit.providerMode === "real")?.providerMode
    ?? audits.find((audit) => audit.providerMode === "fixture")?.providerMode
    ?? (run.requestedMode === "phase20_node_map_experimental" || run.requestedMode === "phase20_node_round_experimental" ? "deterministic" : "deterministic");
  return {
    providerMode,
    ...(audits.find((audit) => audit.modelId)?.modelId ? { modelId: audits.find((audit) => audit.modelId)!.modelId } : {}),
    callsAttempted: audits.reduce((sum, audit) => sum + audit.callsAttempted, 0),
    fallbackCount: audits.reduce((sum, audit) => sum + audit.fallbackCount, 0),
    fallbackReasons: uniqueSorted(audits.flatMap((audit) => audit.fallbackReasons)),
    ignoredFields: uniqueSorted(audits.flatMap((audit) => audit.ignoredFields)),
    draftAcceptedCount: audits.reduce((sum, audit) => sum + audit.draftAcceptedCount, 0),
    draftRejectedCount: audits.reduce((sum, audit) => sum + audit.draftRejectedCount, 0),
    contentLength: audits.reduce((sum, audit) => sum + audit.contentLength, 0),
    reasoningContentLength: audits.reduce((sum, audit) => sum + audit.reasoningContentLength, 0),
    jsonTruncated: audits.some((audit) => audit.jsonTruncated),
    reasoningExhausted: audits.some((audit) => audit.reasoningExhausted),
    agentActionCallsAttempted: audits.reduce((sum, audit) => sum + audit.agentActionCallsAttempted, 0),
    agentActionFallbackCount: audits.reduce((sum, audit) => sum + audit.agentActionFallbackCount, 0),
    agentActionFallbackReasons: uniqueSorted(audits.flatMap((audit) => audit.agentActionFallbackReasons)),
    agentActionIgnoredFields: uniqueSorted(audits.flatMap((audit) => audit.agentActionIgnoredFields)),
    agentActionDraftAcceptedCount: audits.reduce((sum, audit) => sum + audit.agentActionDraftAcceptedCount, 0),
    agentActionDraftRejectedCount: audits.reduce((sum, audit) => sum + audit.agentActionDraftRejectedCount, 0),
    agentActionContentLength: audits.reduce((sum, audit) => sum + audit.agentActionContentLength, 0),
    agentActionReasoningContentLength: audits.reduce((sum, audit) => sum + audit.agentActionReasoningContentLength, 0),
    agentActionJsonTruncated: audits.some((audit) => audit.agentActionJsonTruncated),
    agentActionReasoningExhausted: audits.some((audit) => audit.agentActionReasoningExhausted)
  };
}

function parseFinalHardCondition(value: unknown): NodeLabRoundSummary["finalHardCondition"] {
  const record = parseRecord(value);
  if (!record) {
    return undefined;
  }
  return {
    isRoundOver: record.isRoundOver === true,
    ...(record.winnerSide === "attack" || record.winnerSide === "defense" ? { winnerSide: record.winnerSide } : {}),
    ...(typeof record.winnerTeamId === "string" ? { winnerTeamId: record.winnerTeamId } : {}),
    ...(typeof record.roundWinType === "string" ? { roundWinType: record.roundWinType } : {}),
    reason: typeof record.reason === "string" ? record.reason : "Node Lab hard win condition."
  };
}

function parsePhaseSummaries(value: unknown): NodeLabPhaseSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const phase = parseRecord(item) ?? {};
    const winCondition = parseRecord(phase.winCondition);
    return {
      phaseId: typeof phase.phaseId === "string" ? phase.phaseId : "unknown",
      activeNodeCount: readNumber(phase.activeNodeCount),
      actionCount: readNumber(phase.actionCount),
      localVerdictCount: readNumber(phase.localVerdictCount),
      contestedNodeIds: readStringArray(phase.contestedNodeIds),
      attackControlledNodeIds: readStringArray(phase.attackControlledNodeIds),
      defenseControlledNodeIds: readStringArray(phase.defenseControlledNodeIds),
      neutralNodeIds: readStringArray(phase.neutralNodeIds),
      businessIntentSummary: readStringArray(phase.businessIntentSummary),
      ...(winCondition
        ? {
            winCondition: {
              isRoundOver: winCondition.isRoundOver === true,
              ...(winCondition.winnerSide === "attack" || winCondition.winnerSide === "defense" ? { winnerSide: winCondition.winnerSide } : {}),
              ...(typeof winCondition.roundWinType === "string" ? { roundWinType: winCondition.roundWinType } : {}),
              reason: typeof winCondition.reason === "string" ? winCondition.reason : "Node Lab phase win condition."
            }
          }
        : {})
    };
  });
}

function parsePhaseDetails(value: unknown, sectorMap: ReturnType<typeof loadMapSectorMap>): NodeLabPhaseDetail[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const phase = parseRecord(item) ?? {};
    const activeNodeIds = readStringArray(phase.activeNodeIds);
    const nodeStates = parseNodeStates(phase.nodeStates);
    const localVerdicts = parseLocalVerdicts(phase.localVerdicts);
    return {
      phaseId: typeof phase.phaseId === "string" ? phase.phaseId : "unknown",
      activeNodeIds,
      nodeStates,
      sectorStates: summarizePhaseSectors({
        sectorMap,
        activeNodeIds,
        nodeStates,
        localVerdicts
      }),
      actionPointBudgets: parseActionPointBudgets(phase.actionPointBudgets),
      agentActions: parseAgentActions(phase.agentActions),
      localVerdicts
    };
  });
}

function parseNodeStates(value: unknown): NodeLabPhaseDetail["nodeStates"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      const record = parseRecord(item) ?? {};
      return {
        nodeId: typeof record.nodeId === "string" ? record.nodeId : "",
        phaseId: typeof record.phaseId === "string" ? record.phaseId : "",
        attackAgentIds: readStringArray(record.attackAgentIds),
        defenseAgentIds: readStringArray(record.defenseAgentIds),
        control: typeof record.control === "string" ? record.control : "neutral",
        ...(typeof record.businessIntent === "string" ? { businessIntent: record.businessIntent } : {})
      };
    })
    .filter((item) => item.nodeId.length > 0);
}

function parseActionPointBudgets(value: unknown): NodeLabPhaseDetail["actionPointBudgets"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const record = parseRecord(item) ?? {};
    return {
      agentId: typeof record.agentId === "string" ? record.agentId : "",
      baseAp: readNumber(record.baseAp),
      spentAp: readNumber(record.spentAp),
      remainingAp: readNumber(record.remainingAp)
    };
  }).filter((item) => item.agentId.length > 0);
}

function parseAgentActions(value: unknown): NodeLabPhaseDetail["agentActions"] {
  if (!Array.isArray(value)) {
    return [];
  }
  const actions: NodeLabPhaseDetail["agentActions"] = value.map((item) => {
    const record = parseRecord(item) ?? {};
    const side: "attack" | "defense" | undefined = record.side === "attack" || record.side === "defense" ? record.side : undefined;
    return {
      agentId: typeof record.agentId === "string" ? record.agentId : "",
      ...(typeof record.currentNodeId === "string" ? { currentNodeId: record.currentNodeId } : {}),
      targetNodeId: typeof record.targetNodeId === "string" ? record.targetNodeId : "",
      actionType: typeof record.actionType === "string" ? record.actionType : "",
      apCost: readNumber(record.apCost),
      ...(side ? { side } : {}),
      ...(typeof record.teamId === "string" ? { teamId: record.teamId } : {}),
      ...(typeof record.agentRole === "string" ? { agentRole: record.agentRole } : {}),
      ...(Array.isArray(record.roleResponsibilities) ? { roleResponsibilities: readStringArray(record.roleResponsibilities) } : {}),
      ...(Array.isArray(record.roleActionBias) ? { roleActionBias: readStringArray(record.roleActionBias) } : {}),
      ...(typeof record.teamThesisAnchor === "string" ? { teamThesisAnchor: record.teamThesisAnchor } : {}),
      ...(typeof record.businessOperatingPrinciple === "string" ? { businessOperatingPrinciple: record.businessOperatingPrinciple } : {}),
      ...(typeof record.coachNote === "string" ? { coachNote: record.coachNote } : {}),
      businessIntent: typeof record.businessIntent === "string" ? record.businessIntent : ""
    };
  });
  return actions.filter((item) => item.agentId.length > 0 && item.targetNodeId.length > 0);
}

function parseLocalVerdicts(value: unknown): NodeLabPhaseDetail["localVerdicts"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const record = parseRecord(item) ?? {};
    return {
      nodeId: typeof record.nodeId === "string" ? record.nodeId : "",
      controlAfter: typeof record.controlAfter === "string" ? record.controlAfter : "neutral",
      engagementOccurred: record.engagementOccurred === true,
      triggersWinConditionCheck: record.triggersWinConditionCheck === true,
      summary: typeof record.summary === "string" ? record.summary : ""
    };
  }).filter((item) => item.nodeId.length > 0);
}

function readDust2NodeGraphSummary(projectRoot: string): NodeLabMapGraph {
  const graphPath = resolve(projectRoot, "data/materials/processed/maps/dust2/node-graph.json");
  const graph = parseRecord(readFileSync(graphPath, "utf8")) ?? {};
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const sectorMap = loadValidatedDust2SectorMap(projectRoot);
  return {
    nodes: nodes
      .map((item) => {
        const node = parseRecord(item) ?? {};
        return {
          nodeId: typeof node.id === "string" ? node.id : "",
          displayName: typeof node.display_name === "string" ? node.display_name : typeof node.id === "string" ? node.id : "",
          area: typeof node.area === "string" ? node.area : "unknown",
          ...(typeof node.kind === "string" ? { kind: node.kind } : {})
        };
      })
      .filter((node) => node.nodeId.length > 0),
    edges: edges
      .map((item) => {
        const edge = parseRecord(item) ?? {};
        return {
          from: typeof edge.from === "string" ? edge.from : "",
          to: typeof edge.to === "string" ? edge.to : "",
          type: typeof edge.type === "string" ? edge.type : "route",
          ...(typeof edge.label === "string" ? { label: edge.label } : {})
        };
      })
      .filter((edge) => edge.from.length > 0 && edge.to.length > 0)
      ,
    sectors: sectorMap.sectors.map((sector) => ({
      sectorId: sector.sectorId,
      displayName: sector.displayName,
      displayNameZh: sector.displayNameZh,
      areaType: sector.areaType,
      nodeIds: [...sector.nodeIds],
      adjacentSectorIds: [...sector.adjacentSectorIds],
      polygon: sector.polygon.map((point) => [point[0], point[1]])
    })),
    sectorEdges: sectorMap.sectorEdges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      type: edge.type
    }))
  };
}

function loadValidatedDust2SectorMap(projectRoot: string) {
  const nodeGraph = loadMapNodeGraph("dust2", { rootDir: projectRoot });
  return validateMapSectorMap(loadMapSectorMap("dust2", { rootDir: projectRoot }), nodeGraph);
}

function toRoundSummary(trace: NodeLabRoundTraceDetail): NodeLabRoundSummary {
  return {
    roundNumber: trace.roundNumber,
    ...(trace.winnerTeamId ? { winnerTeamId: trace.winnerTeamId } : {}),
    ...(trace.loserTeamId ? { loserTeamId: trace.loserTeamId } : {}),
    ...(trace.roundWinType ? { roundWinType: trace.roundWinType } : {}),
    nodeTraceArtifactId: trace.nodeTraceArtifactId,
    totalApSpent: trace.totalApSpent,
    fallbackCount: trace.fallbackCount,
    ignoredFields: trace.ignoredFields,
    ...(trace.finalHardCondition ? { finalHardCondition: trace.finalHardCondition } : {})
  };
}

async function resolveNodeLabRun(repositories: SqliteRepositoryBundle, runId?: string): Promise<SimulationRunRecord | null> {
  if (runId) {
    return repositories.simulationRuns.getById(runId);
  }
  const runs = await repositories.simulationRuns.listByFixtureId(phase18CanonIds.fixtureId);
  return runs.find((run) => run.requestedMode === "phase20_node_round_experimental" || run.requestedMode === "phase20_node_map_experimental") ?? null;
}

async function safeSelectCurrentMapGameId(repositories: SqliteRepositoryBundle, runtimeMatchId: string): Promise<string | null> {
  const maps = await repositories.mapGames.listByMatch(runtimeMatchId);
  return maps.find((map) => map.status !== "completed")?.id ?? maps.at(-1)?.id ?? null;
}

function readCommittedRoundCount(repositories: SqliteRepositoryBundle, runtimeMatchId: string): number {
  const row = repositories.sqlite.prepare("SELECT COUNT(*) AS count FROM round_reports WHERE match_id = ?").get(runtimeMatchId) as { count?: unknown } | undefined;
  return readNumber(row?.count);
}

function estimateNodeLabCalls(request: NodeLabRunRequest): number {
  if (request.providerMode === "deterministic") {
    return 0;
  }
  const perRound = (request.agentActionLlmShadow ? request.maxAgentActionLlmCalls : 0) + (request.localJudgeLlmShadow ? request.maxLocalJudgeLlmCalls : 0);
  return perRound * (request.scope === "map" ? request.maxRounds : 1);
}

function createNodeLabRunId(): string {
  return `node_lab_run_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
}

function normalizeNodeLabStatus(value: string): NodeLabRunStatus {
  return value === "completed" || value === "failed" || value === "running" ? value : "idle";
}

function normalizeProviderMode(value: unknown): NodeLabProviderMode {
  return value === "real" ? "real" : value === "fixture" ? "fixture" : "deterministic";
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(numeric)));
}

function readArtifactTextByUri(uri: string): string {
  if (uri.startsWith("local:")) {
    return readFileSync(resolve(findProjectRoot(process.cwd()), uri.slice("local:".length)), "utf8");
  }
  return readFileSync(uri, "utf8");
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return parseRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort((left, right) => left.localeCompare(right));
}

function isExternalProviderBlocked(message: string): boolean {
  return /\bEACCES\b|external_provider_blocked|connect .*:443|HTTP 401|HTTP 403|ENOTFOUND|ECONNREFUSED/i.test(message);
}
