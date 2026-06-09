import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import {
  commitDust2HexRoundExperimental,
  runDust2HexMapExperimental,
  type HexMapExperimentalSummary,
  type HexRoundTrace
} from "@agent-major/core";
import { createSqliteRepositories, defaultSqlitePath, type SqliteRepositoryBundle } from "@agent-major/db";

import { ServerLocalArtifactStore } from "./server-artifact-store";
import { loadRootLocalEnv } from "./server-local-env";
import { findProjectRoot } from "./server-project-root";

type ScorePair = { teamA: number; teamB: number };
type RoundReport = Awaited<ReturnType<SqliteRepositoryBundle["roundReports"]["listByMapGame"]>>[number];

export type HexMatchLabScope = "round" | "map";
export type HexMatchLabProviderMode = "fixture" | "real";
export type HexMatchLabRunStatus = "idle" | "running" | "completed" | "failed";

export interface HexMatchLabRunRequest {
  scope: HexMatchLabScope;
  mapGameId?: string | undefined;
  providerMode: HexMatchLabProviderMode;
  maxRounds: number;
  maxLlmCallsPerPhase: number;
}

export interface HexMatchLabRunResult {
  summary: string;
  progress: HexMatchLabProgress;
}

export interface HexMatchLabProgress {
  status: HexMatchLabRunStatus;
  mapGameId?: string | undefined;
  mapName?: string | undefined;
  mapStatus?: string | undefined;
  providerMode: HexMatchLabProviderMode;
  score?: ScorePair | undefined;
  latestSummaryArtifactId?: string | undefined;
  latestError?: string | undefined;
  writesDb: true;
  replacesLegacyRoundPath: false;
  llmCannotWriteFinalWinner: true;
  mapSummary?: HexMatchLabMapSummary | undefined;
  roundSummaries: HexMatchLabRoundSummary[];
  selectedTrace?: HexMatchLabRoundTraceDetail | undefined;
}

export interface HexMatchLabMapSummary {
  artifactId: string;
  source: string;
  status: string;
  initialScore: ScorePair;
  finalScore: ScorePair;
  roundsCommitted: number;
  completionReason: string;
  fallbackSummary: {
    totalFallbackCount: number;
    totalCombatResolutionCount: number;
    roundsWithFallback: number;
  };
}

export interface HexMatchLabRoundSummary {
  roundNumber: number;
  roundId: string;
  reportId?: string | undefined;
  winnerTeamId?: string | undefined;
  roundWinType?: string | undefined;
  scoreAfterRound?: ScorePair | undefined;
  hexTraceArtifactId?: string | undefined;
  fallbackCount: number;
  combatResolutionCount: number;
  finalHardCondition?: HexMatchLabHardConditionSummary | undefined;
}

export interface HexMatchLabRoundTraceDetail extends HexMatchLabRoundSummary {
  source: "hex_round_engine_committed";
  phaseSummaries: HexMatchLabPhaseSummary[];
  audit: {
    providerMode?: string | undefined;
    modelId?: string | undefined;
    totalLlmCallsAttempted: number;
    fallbackCount: number;
    combatResolutionCount: number;
    rejectedEventCount: number;
  };
  economySummary: HexMatchLabEconomySummary[];
}

export interface HexMatchLabPhaseSummary {
  phaseId: string;
  phaseIndex: number;
  callsAttempted: number;
  acceptedActionCount: number;
  rejectedDraftCount: number;
  fallbackActionCount: number;
  combatContactCount: number;
  combatResolutionCount: number;
  memoryEventCount: number;
  rejectedEventCount: number;
  aliveAttackCount: number;
  aliveDefenseCount: number;
  bombState: {
    planted: boolean;
    plantedCellId?: string | undefined;
    carrierAgentId?: string | undefined;
  };
  winCondition?: HexMatchLabHardConditionSummary | undefined;
  actions: HexMatchLabActionSummary[];
  combats: HexMatchLabCombatSummary[];
}

export interface HexMatchLabActionSummary {
  agentId: string;
  teamId?: string | undefined;
  side?: string | undefined;
  actionType: string;
  currentCellId?: string | undefined;
  targetCellId?: string | undefined;
  apCost?: number | undefined;
  valid: boolean;
  fallbackReason?: string | undefined;
  validationErrors: string[];
  businessIntent?: string | undefined;
}

export interface HexMatchLabCombatSummary {
  contactId: string;
  participants: string[];
  advantage?: string | undefined;
  verdict?: string | undefined;
  casualties: string[];
  suppressions: string[];
  regionControlHint?: string | undefined;
  businessScoreAttack?: number | undefined;
  businessScoreDefense?: number | undefined;
  csScoreAttack?: number | undefined;
  csScoreDefense?: number | undefined;
  economyEvidenceApplied?: boolean | undefined;
}

export interface HexMatchLabEconomySummary {
  teamId: string;
  side?: string | undefined;
  posture?: string | undefined;
  summaryBuyType?: string | undefined;
  totalCash?: number | undefined;
  agents: Array<{
    agentId: string;
    buyType?: string | undefined;
    resourceTier?: string | undefined;
    utilityTier?: string | undefined;
    outputBudget?: number | undefined;
    dropSent?: number | undefined;
    dropReceived?: number | undefined;
  }>;
}

export interface HexMatchLabHardConditionSummary {
  isRoundOver: boolean;
  winnerSide?: string | undefined;
  winnerTeamId?: string | undefined;
  loserTeamId?: string | undefined;
  roundWinType?: string | undefined;
  judgeRoundWinType?: string | undefined;
  reason?: string | undefined;
}

interface ReadProgressInput {
  mapGameId?: string | null;
  summaryArtifactId?: string | null;
  roundTraceArtifactId?: string | null;
}

type Row = Record<string, unknown>;

export function normalizeHexMatchLabRunRequest(value: unknown): HexMatchLabRunRequest {
  const record = parseRecord(value) ?? {};
  const mapGameId = typeof record.mapGameId === "string" && record.mapGameId.trim() ? record.mapGameId.trim() : undefined;
  return {
    scope: record.scope === "map" ? "map" : "round",
    ...(mapGameId ? { mapGameId } : {}),
    providerMode: record.providerMode === "real" ? "real" : "fixture",
    maxRounds: clampInteger(record.maxRounds, 40, 1, 60),
    maxLlmCallsPerPhase: clampInteger(record.maxLlmCallsPerPhase, 10, 0, 50)
  };
}

export async function startHexMatchLabRun(request: HexMatchLabRunRequest): Promise<HexMatchLabRunResult> {
  const projectRoot = findProjectRoot(process.cwd());
  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  try {
    const mapGameId = request.mapGameId ?? findLatestDust2MapGameId(repositories, { activeOnly: true });
    if (!mapGameId) {
      throw new Error("没有找到可运行的 active Dust2 mapGame。请先 seed 运行时 fixture，或传入 mapGameId。");
    }

    const artifactStore = new ServerLocalArtifactStore(projectRoot, repositories.artifacts);
    const env = loadRootLocalEnv(projectRoot, process.env);
    if (request.scope === "round") {
      await commitDust2HexRoundExperimental({
        repositories,
        artifactStore,
        mapGameId,
        enableExperimentalMode: true,
        providerMode: request.providerMode,
        maxLlmCallsPerPhase: request.maxLlmCallsPerPhase,
        env
      });
    } else {
      await runDust2HexMapExperimental({
        repositories,
        artifactStore,
        mapGameId,
        enableExperimentalMode: true,
        providerMode: request.providerMode,
        maxRounds: request.maxRounds,
        maxLlmCallsPerPhase: request.maxLlmCallsPerPhase,
        env
      });
    }

    const progress = await readHexMatchLabProgress({
      mapGameId,
      projectRoot,
      repositories,
      providerMode: request.providerMode
    });
    return {
      summary: request.scope === "round" ? "Hex 单回合实验已完成。" : "Hex 当前 Dust2 地图实验已完成。",
      progress
    };
  } finally {
    repositories.close();
  }
}

export async function readHexMatchLabRunProgress(input: ReadProgressInput = {}): Promise<HexMatchLabProgress> {
  const projectRoot = findProjectRoot(process.cwd());
  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  try {
    return await readHexMatchLabProgress({
      ...input,
      projectRoot,
      repositories,
      providerMode: "fixture"
    });
  } finally {
    repositories.close();
  }
}

async function readHexMatchLabProgress(input: ReadProgressInput & {
  projectRoot: string;
  repositories: SqliteRepositoryBundle;
  providerMode: HexMatchLabProviderMode;
}): Promise<HexMatchLabProgress> {
  const mapGameId = input.mapGameId
    ?? findMapGameIdBySummaryArtifact(input.repositories, input.summaryArtifactId ?? undefined)
    ?? findMapGameIdByRoundTraceArtifact(input.repositories, input.roundTraceArtifactId ?? undefined)
    ?? findLatestDust2MapGameId(input.repositories, { activeOnly: false });

  if (!mapGameId) {
    return emptyProgress(input.providerMode, "没有找到 Dust2 Hex mapGame 或 hex_map_summary artifact。");
  }

  const mapGame = await input.repositories.mapGames.getById(mapGameId);
  if (!mapGame) {
    return emptyProgress(input.providerMode, `Map game not found: ${mapGameId}`);
  }

  const summaryArtifactId = input.summaryArtifactId ?? findLatestMapSummaryArtifactId(input.repositories, mapGame.id);
  const mapSummary = summaryArtifactId
    ? await readMapSummary(input.repositories, input.projectRoot, summaryArtifactId)
    : undefined;
  const roundReports = await input.repositories.roundReports.listByMapGame(mapGame.id);
  const roundSummaries = buildRoundSummaries({
    ...(mapSummary?.summary ? { summary: mapSummary.summary } : {}),
    ...(summaryArtifactId ? { summaryArtifactId } : {}),
    reports: roundReports
  });
  const selectedTraceArtifactId = input.roundTraceArtifactId
    ?? roundSummaries.at(-1)?.hexTraceArtifactId
    ?? mapSummary?.summary.rounds.at(-1)?.hexTraceArtifactId;
  const selectedTrace = selectedTraceArtifactId
    ? await readRoundTraceDetail(input.repositories, input.projectRoot, selectedTraceArtifactId, roundSummaries)
    : undefined;

  return {
    status: mapGame.status === "completed" ? "completed" : "idle",
    mapGameId: mapGame.id,
    mapName: mapGame.mapName,
    mapStatus: mapGame.status,
    providerMode: input.providerMode,
    score: {
      teamA: mapGame.teamAScore,
      teamB: mapGame.teamBScore
    },
    ...(summaryArtifactId ? { latestSummaryArtifactId: summaryArtifactId } : {}),
    writesDb: true,
    replacesLegacyRoundPath: false,
    llmCannotWriteFinalWinner: true,
    ...(mapSummary
      ? {
        mapSummary: {
          artifactId: mapSummary.artifactId,
          source: mapSummary.summary.source,
          status: mapSummary.summary.status,
          initialScore: mapSummary.summary.initialScore,
          finalScore: mapSummary.summary.finalScore,
          roundsCommitted: mapSummary.summary.roundsCommitted,
          completionReason: mapSummary.summary.completionReason,
          fallbackSummary: mapSummary.summary.fallbackSummary
        }
      }
      : {}),
    roundSummaries,
    ...(selectedTrace ? { selectedTrace } : {})
  };
}

function emptyProgress(providerMode: HexMatchLabProviderMode, latestError: string): HexMatchLabProgress {
  return {
    status: "idle",
    providerMode,
    latestError,
    writesDb: true,
    replacesLegacyRoundPath: false,
    llmCannotWriteFinalWinner: true,
    roundSummaries: []
  };
}

function findLatestDust2MapGameId(
  repositories: SqliteRepositoryBundle,
  options: { activeOnly: boolean }
): string | undefined {
  const statusClause = options.activeOnly
    ? "AND status IN ('scheduled', 'running', 'overtime')"
    : "AND status IN ('scheduled', 'running', 'overtime', 'completed')";
  const row = repositories.sqlite
    .prepare(
      `SELECT id
       FROM map_games
       WHERE lower(replace(map_name, ' ', '')) = 'dust2'
       ${statusClause}
       ORDER BY COALESCE(completed_at, started_at, created_at) DESC, created_at DESC, id DESC
       LIMIT 1`
    )
    .get() as { id?: string } | undefined;
  return row?.id;
}

function findLatestMapSummaryArtifactId(repositories: SqliteRepositoryBundle, mapGameId: string): string | undefined {
  const row = repositories.sqlite
    .prepare(
      `SELECT id
       FROM artifacts
       WHERE map_game_id = ?
         AND artifact_type = 'hex_map_summary'
       ORDER BY created_at DESC, id DESC
       LIMIT 1`
    )
    .get(mapGameId) as { id?: string } | undefined;
  return row?.id;
}

function findMapGameIdBySummaryArtifact(repositories: SqliteRepositoryBundle, artifactId: string | undefined): string | undefined {
  if (!artifactId) {
    return undefined;
  }
  const row = repositories.sqlite
    .prepare("SELECT map_game_id AS mapGameId FROM artifacts WHERE id = ? AND artifact_type = 'hex_map_summary'")
    .get(artifactId) as { mapGameId?: string } | undefined;
  return row?.mapGameId;
}

function findMapGameIdByRoundTraceArtifact(repositories: SqliteRepositoryBundle, artifactId: string | undefined): string | undefined {
  if (!artifactId) {
    return undefined;
  }
  const row = repositories.sqlite
    .prepare("SELECT map_game_id AS mapGameId FROM artifacts WHERE id = ? AND artifact_type = 'hex_round_trace'")
    .get(artifactId) as { mapGameId?: string } | undefined;
  return row?.mapGameId;
}

async function readMapSummary(
  repositories: SqliteRepositoryBundle,
  projectRoot: string,
  artifactId: string
): Promise<{ artifactId: string; summary: HexMapExperimentalSummary } | undefined> {
  try {
    return {
      artifactId,
      summary: JSON.parse(await readArtifactText(repositories, projectRoot, artifactId)) as HexMapExperimentalSummary
    };
  } catch {
    return undefined;
  }
}

async function readRoundTraceDetail(
  repositories: SqliteRepositoryBundle,
  projectRoot: string,
  artifactId: string,
  summaries: HexMatchLabRoundSummary[]
): Promise<HexMatchLabRoundTraceDetail | undefined> {
  try {
    const trace = JSON.parse(await readArtifactText(repositories, projectRoot, artifactId)) as HexRoundTrace;
    const fallbackSummary = summaries.find((round) => round.hexTraceArtifactId === artifactId);
    return summarizeTrace(artifactId, trace, fallbackSummary);
  } catch {
    return undefined;
  }
}

async function readArtifactText(repositories: SqliteRepositoryBundle, projectRoot: string, artifactId: string): Promise<string> {
  const artifact = await repositories.artifacts.getById(artifactId);
  if (!artifact) {
    throw new Error(`Artifact not found: ${artifactId}`);
  }
  const artifactRoot = resolve(projectRoot, "data", "artifacts");
  const targetPath = artifact.uri.startsWith("local:")
    ? resolve(projectRoot, artifact.uri.slice("local:".length))
    : isAbsolute(artifact.uri)
      ? resolve(artifact.uri)
      : resolve(projectRoot, artifact.uri);
  if (!isInsideDirectory(targetPath, artifactRoot) || !existsSync(targetPath)) {
    throw new Error(`Artifact URI is outside readable artifact root or missing: ${artifact.uri}`);
  }
  return readFileSync(targetPath, "utf8");
}

function buildRoundSummaries(input: {
  summary?: HexMapExperimentalSummary;
  summaryArtifactId?: string;
  reports: RoundReport[];
}): HexMatchLabRoundSummary[] {
  const summaryRounds = input.summary?.rounds ?? [];
  if (summaryRounds.length > 0) {
    return summaryRounds.map((round) => ({
      roundNumber: round.roundNumber,
      roundId: round.roundId,
      reportId: round.reportId,
      winnerTeamId: round.winnerTeamId,
      roundWinType: round.roundWinType,
      scoreAfterRound: round.scoreAfterRound,
      hexTraceArtifactId: round.hexTraceArtifactId,
      fallbackCount: round.fallbackCount,
      combatResolutionCount: round.combatResolutionCount,
      finalHardCondition: summarizeHardCondition(round.finalWinCondition)
    }));
  }

  return input.reports
    .filter((report) => report.nodeTraceSource === "hex_round_engine_committed")
    .map((report) => ({
      roundNumber: report.roundNumber,
      roundId: report.roundId,
      reportId: report.id,
      winnerTeamId: report.winnerTeamId,
      roundWinType: report.judgeResult.roundWinType,
      scoreAfterRound: report.scoreAfterRound,
      hexTraceArtifactId: report.nodeTraceArtifactId,
      fallbackCount: 0,
      combatResolutionCount: 0,
      finalHardCondition: {
        isRoundOver: true,
        winnerTeamId: report.winnerTeamId,
        roundWinType: report.judgeResult.roundWinType,
        reason: report.judgeResult.reason
      }
    }));
}

function summarizeTrace(
  artifactId: string,
  trace: HexRoundTrace,
  fallbackSummary: HexMatchLabRoundSummary | undefined
): HexMatchLabRoundTraceDetail {
  const roundSummary: HexMatchLabRoundSummary = fallbackSummary ?? {
    roundNumber: trace.roundNumber,
    roundId: trace.roundId,
    hexTraceArtifactId: artifactId,
    fallbackCount: trace.audit.fallbackCount,
    combatResolutionCount: trace.audit.combatResolutionCount,
    finalHardCondition: summarizeHardCondition(trace.finalWinCondition)
  };
  return {
    ...roundSummary,
    hexTraceArtifactId: artifactId,
    source: "hex_round_engine_committed",
    phaseSummaries: trace.phases.map((phase) => summarizePhase(phase)),
    audit: {
      providerMode: trace.audit.providerMode,
      modelId: trace.audit.modelId,
      totalLlmCallsAttempted: trace.audit.totalLlmCallsAttempted,
      fallbackCount: trace.audit.fallbackCount,
      combatResolutionCount: trace.audit.combatResolutionCount,
      rejectedEventCount: trace.audit.rejectedEventCount
    },
    economySummary: summarizeEconomy(trace.economyContext)
  };
}

function summarizePhase(phase: HexRoundTrace["phases"][number]): HexMatchLabPhaseSummary {
  const agentsAfter = phase.memoryAfter.agents;
  const aliveAttackCount = agentsAfter.filter((agent) => agent.side === "attack" && agent.lifeStatus !== "dead").length;
  const aliveDefenseCount = agentsAfter.filter((agent) => agent.side === "defense" && agent.lifeStatus !== "dead").length;
  return {
    phaseId: phase.phaseId,
    phaseIndex: phase.phaseIndex,
    callsAttempted: phase.commandResult.totalCallsAttempted,
    acceptedActionCount: phase.commandResult.acceptedActions.length,
    rejectedDraftCount: phase.commandResult.rejectedDrafts.length,
    fallbackActionCount: phase.commandResult.fallbackActions.length,
    combatContactCount: phase.combatContacts.length,
    combatResolutionCount: phase.combatResolutions.length,
    memoryEventCount: phase.memoryEvents.length,
    rejectedEventCount: phase.memoryAfter.rejectedEvents.length,
    aliveAttackCount,
    aliveDefenseCount,
    bombState: {
      planted: phase.memoryAfter.bombState.planted,
      plantedCellId: phase.memoryAfter.bombState.plantedCellId,
      carrierAgentId: phase.memoryAfter.bombState.carrierAgentId
    },
    winCondition: summarizeHardCondition(phase.winCondition),
    actions: phase.commandResult.actions.map((action) => ({
      agentId: action.agentId,
      teamId: action.teamId,
      side: action.side,
      actionType: action.actionType,
      currentCellId: action.currentCellId,
      targetCellId: action.targetCellId,
      apCost: action.apCost,
      valid: action.valid,
      fallbackReason: action.fallbackReason,
      validationErrors: action.validationErrors,
      businessIntent: action.businessIntent
    })),
    combats: phase.combatResolutions.map((resolution) => ({
      contactId: resolution.contactId,
      participants: resolution.participants.map((participant) => participant.agentId),
      advantage: resolution.advantage,
      verdict: resolution.verdict,
      casualties: resolution.casualties.map((casualty) => `${casualty.agentId}:${casualty.result}`),
      suppressions: resolution.suppressions.map((suppression) => `${suppression.agentId}:${suppression.result}`),
      regionControlHint: resolution.regionControlHint,
      businessScoreAttack: resolution.scores.attack.businessScore,
      businessScoreDefense: resolution.scores.defense.businessScore,
      csScoreAttack: resolution.scores.attack.csScore,
      csScoreDefense: resolution.scores.defense.csScore,
      economyEvidenceApplied: resolution.audit.economy.economyEvidenceApplied
    }))
  };
}

function summarizeEconomy(economy: HexRoundTrace["economyContext"]): HexMatchLabEconomySummary[] {
  return economy.teams.map((team) => ({
    teamId: team.teamId,
    side: team.side,
    posture: team.posture,
    summaryBuyType: team.summaryBuyType,
    totalCash: team.totalCash,
    agents: economy.agents.filter((agent) => agent.teamId === team.teamId).map((agent) => ({
      agentId: agent.agentId,
      buyType: agent.buyType,
      resourceTier: agent.resourceTier,
      utilityTier: agent.utilityTier,
      outputBudget: agent.outputBudget,
      dropSent: agent.dropSent,
      dropReceived: agent.dropReceived
    }))
  }));
}

function summarizeHardCondition(value: unknown): HexMatchLabHardConditionSummary | undefined {
  const record = parseRecord(value);
  if (!record) {
    return undefined;
  }
  return {
    isRoundOver: record.isRoundOver === true,
    winnerSide: readString(record.winnerSide),
    winnerTeamId: readString(record.winnerTeamId),
    loserTeamId: readString(record.loserTeamId),
    roundWinType: readString(record.roundWinType),
    judgeRoundWinType: readString(record.judgeRoundWinType),
    reason: readString(record.reason)
  };
}

function parseRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function isInsideDirectory(targetPath: string, parentPath: string): boolean {
  const normalizedTarget = resolve(targetPath).toLowerCase();
  const normalizedParent = resolve(parentPath).toLowerCase();
  return normalizedTarget === normalizedParent || normalizedTarget.startsWith(`${normalizedParent}\\`);
}
