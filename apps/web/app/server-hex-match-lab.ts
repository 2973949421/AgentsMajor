import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import {
  commitDust2HexRoundExperimental,
  loadOfficialDust2HexMap,
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
type HexMapAsset = ReturnType<typeof loadOfficialDust2HexMap>;
type HexMapCell = HexMapAsset["cells"][number];
type HexMapRegion = HexMapAsset["regions"][number];
type HexMapPoint = HexMapAsset["points"][number];
type HexMapVerticalLink = HexMapAsset["verticalLinks"][number];

export type HexMatchLabScope = "round" | "map";
export type HexMatchLabProviderMode = "fixture" | "real";
export type HexMatchLabRunStatus = "idle" | "running" | "completed" | "failed";
export type HexMatchLabLevel = -1 | 0 | 1;

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

export interface HexMatchLabMapOption {
  mapGameId: string;
  matchId: string;
  mapName: string;
  mapStatus: string;
  score: ScorePair;
  currentRoundNumber: number;
  createdAt: string;
  completedAt?: string | undefined;
  teamAId: string;
  teamBId: string;
  teamAName?: string | undefined;
  teamBName?: string | undefined;
  latestSummaryArtifactId?: string | undefined;
}

export interface HexMatchLabMapAssetView {
  grid: {
    width: number;
    height: number;
    levels: HexMatchLabLevel[];
    defaultLevel: HexMatchLabLevel;
  };
  cells: Array<{
    cellId: string;
    col: number;
    row: number;
    level: HexMatchLabLevel;
    flags: string[];
    regionId?: string | undefined;
    pointIds: string[];
  }>;
  regions: Array<{
    regionId: string;
    nameCn: string;
    nameEn: string;
    regionType: string;
  }>;
  points: Array<{
    pointId: string;
    nameCn: string;
    nameEn: string;
    pointType: string;
    parentRegionId: string;
  }>;
  verticalLinks: Array<{
    linkId: string;
    fromCellId: string;
    toCellId: string;
    linkType: string;
    oneWay: boolean;
  }>;
}

export interface HexMatchLabRunProgressStatus {
  status: HexMatchLabRunStatus;
  currentStep: string;
  latestEvent?: string | undefined;
  latestError?: string | undefined;
  elapsedMs?: number | undefined;
  callsAttempted: number;
}

export interface HexMatchLabProgress {
  status: HexMatchLabRunStatus;
  runStatus: HexMatchLabRunProgressStatus;
  mapGameId?: string | undefined;
  matchId?: string | undefined;
  mapName?: string | undefined;
  mapStatus?: string | undefined;
  providerMode: HexMatchLabProviderMode;
  score?: ScorePair | undefined;
  latestSummaryArtifactId?: string | undefined;
  latestError?: string | undefined;
  canRunRound: boolean;
  completedMap: boolean;
  writesDb: true;
  replacesLegacyRoundPath: false;
  llmCannotWriteFinalWinner: true;
  mapAssetView: HexMatchLabMapAssetView;
  mapOptions: HexMatchLabMapOption[];
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
  audit: HexMatchLabLlmAuditSummary;
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
  players: HexMatchLabPlayerCard[];
  llmAudit: HexMatchLabLlmAuditSummary;
  memoryBeforeSummary: HexMatchLabMemorySummary;
  memoryAfterSummary: HexMatchLabMemorySummary;
}

export interface HexMatchLabPlayerCard {
  agentId: string;
  displayName?: string | undefined;
  teamId: string;
  side: string;
  lifeStatus: string;
  currentCellId: string;
  currentRegionId?: string | undefined;
  currentRegionName?: string | undefined;
  currentPointIds: string[];
  currentPointNames: string[];
  level?: number | undefined;
  apBudget: number;
  apSpent: number;
  apRemaining: number;
  carryingC4: boolean;
  knownEnemyCount: number;
  lastSeenEnemyCount: number;
  actionType?: string | undefined;
  targetCellId?: string | undefined;
  apCost?: number | undefined;
  validAction?: boolean | undefined;
  fallbackReason?: string | undefined;
  validationErrors: string[];
  buyType?: string | undefined;
  resourceTier?: string | undefined;
  utilityTier?: string | undefined;
  outputBudget?: number | undefined;
  dropReceived?: number | undefined;
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
  requestArtifactId?: string | undefined;
  responseArtifactId?: string | undefined;
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
  varianceApplied?: boolean | undefined;
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

export interface HexMatchLabLlmAuditSummary {
  providerMode?: string | undefined;
  modelId?: string | undefined;
  expectedCalls: number;
  totalLlmCallsAttempted: number;
  acceptedDrafts: number;
  rejectedDrafts: number;
  fallbackCount: number;
  combatResolutionCount: number;
  rejectedEventCount: number;
  requestArtifactIds: string[];
  responseArtifactIds: string[];
  fallbackReasons: string[];
  providerErrors: string[];
}

export interface HexMatchLabMemorySummary {
  aliveAttackCount: number;
  aliveDefenseCount: number;
  woundedCount: number;
  deadCount: number;
  knownEnemyCount: number;
  lastSeenEnemyCount: number;
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
    providerMode: record.providerMode === "fixture" ? "fixture" : "real",
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
      throw new Error("没有找到可运行的 active Dust2 mapGame。请先新建 Hex 验收比赛，或传入 mapGameId。");
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
      summary: request.scope === "round" ? "Hex 下一回合已提交。" : "Hex 当前 Dust2 地图实验已完成。",
      progress
    };
  } catch (error) {
    throw new Error(toProductError(error).message, { cause: error });
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
      providerMode: "real"
    });
  } finally {
    repositories.close();
  }
}

export async function listHexMatchLabMapGames(): Promise<HexMatchLabMapOption[]> {
  const projectRoot = findProjectRoot(process.cwd());
  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  try {
    return listDust2MapOptions(repositories);
  } finally {
    repositories.close();
  }
}

export async function createHexMatchLabValidationMap(input: { baseMapGameId?: string | null } = {}): Promise<HexMatchLabMapOption> {
  const projectRoot = findProjectRoot(process.cwd());
  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  try {
    const baseMapGameId = input.baseMapGameId
      ?? findLatestDust2MapGameId(repositories, { activeOnly: false });
    if (!baseMapGameId) {
      throw new Error("没有可复制的 Dust2 match/mapGame。请先运行现有 seed fixture。");
    }
    const created = await createValidationMapFromBase(repositories, baseMapGameId);
    const options = listDust2MapOptions(repositories);
    return options.find((option) => option.mapGameId === created.id) ?? {
      mapGameId: created.id,
      matchId: created.matchId,
      mapName: created.mapName,
      mapStatus: created.status,
      score: { teamA: created.teamAScore, teamB: created.teamBScore },
      currentRoundNumber: created.currentRoundNumber,
      createdAt: created.createdAt,
      teamAId: "",
      teamBId: ""
    };
  } finally {
    repositories.close();
  }
}

export async function resetHexMatchLabValidationMap(input: { mapGameId?: string | null } = {}): Promise<HexMatchLabMapOption> {
  // 第一版 reset 不删除任何历史 round/report/artifact，只创建同源新 map，避免误清旧 Phase18 数据。
  return input.mapGameId
    ? createHexMatchLabValidationMap({ baseMapGameId: input.mapGameId })
    : createHexMatchLabValidationMap();
}

async function readHexMatchLabProgress(input: ReadProgressInput & {
  projectRoot: string;
  repositories: SqliteRepositoryBundle;
  providerMode: HexMatchLabProviderMode;
}): Promise<HexMatchLabProgress> {
  const mapAssetView = buildMapAssetView(loadOfficialDust2HexMap());
  const mapOptions = listDust2MapOptions(input.repositories);
  const mapGameId = input.mapGameId
    ?? findMapGameIdBySummaryArtifact(input.repositories, input.summaryArtifactId ?? undefined)
    ?? findMapGameIdByRoundTraceArtifact(input.repositories, input.roundTraceArtifactId ?? undefined)
    ?? findLatestDust2MapGameId(input.repositories, { activeOnly: false });

  if (!mapGameId) {
    return emptyProgress(input.providerMode, mapAssetView, mapOptions, "没有找到 Dust2 Hex mapGame 或 hex_map_summary artifact。");
  }

  const mapGame = await input.repositories.mapGames.getById(mapGameId);
  if (!mapGame) {
    return emptyProgress(input.providerMode, mapAssetView, mapOptions, `Map game not found: ${mapGameId}`);
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
  const agentNames = readAgentDisplayNames(input.repositories, mapGame.matchId);
  const selectedTrace = selectedTraceArtifactId
    ? await readRoundTraceDetail(input.repositories, input.projectRoot, selectedTraceArtifactId, roundSummaries, agentNames)
    : undefined;
  const callsAttempted = selectedTrace?.audit.totalLlmCallsAttempted ?? 0;
  const latestError = toCompletedMapHint(mapGame.status);

  return {
    status: mapGame.status === "completed" ? "completed" : "idle",
    runStatus: {
      status: mapGame.status === "completed" ? "completed" : "idle",
      currentStep: mapGame.status === "completed" ? "地图已完成，等待新建或重置" : "等待操作",
      latestEvent: selectedTrace ? `已选择 R${selectedTrace.roundNumber}` : undefined,
      latestError,
      callsAttempted
    },
    mapGameId: mapGame.id,
    matchId: mapGame.matchId,
    mapName: mapGame.mapName,
    mapStatus: mapGame.status,
    providerMode: input.providerMode,
    score: {
      teamA: mapGame.teamAScore,
      teamB: mapGame.teamBScore
    },
    ...(summaryArtifactId ? { latestSummaryArtifactId: summaryArtifactId } : {}),
    ...(latestError ? { latestError } : {}),
    canRunRound: mapGame.status !== "completed",
    completedMap: mapGame.status === "completed",
    writesDb: true,
    replacesLegacyRoundPath: false,
    llmCannotWriteFinalWinner: true,
    mapAssetView,
    mapOptions,
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

function emptyProgress(
  providerMode: HexMatchLabProviderMode,
  mapAssetView: HexMatchLabMapAssetView,
  mapOptions: HexMatchLabMapOption[],
  latestError: string
): HexMatchLabProgress {
  return {
    status: "idle",
    runStatus: {
      status: "idle",
      currentStep: "等待新建 Hex 验收比赛",
      latestError,
      callsAttempted: 0
    },
    providerMode,
    latestError,
    canRunRound: false,
    completedMap: false,
    writesDb: true,
    replacesLegacyRoundPath: false,
    llmCannotWriteFinalWinner: true,
    mapAssetView,
    mapOptions,
    roundSummaries: []
  };
}

async function createValidationMapFromBase(repositories: SqliteRepositoryBundle, baseMapGameId: string) {
  const base = repositories.sqlite.prepare("SELECT * FROM map_games WHERE id = ?").get(baseMapGameId) as Row | undefined;
  if (!base) {
    throw new Error(`Base mapGame not found: ${baseMapGameId}`);
  }
  const matchId = readString(base.match_id) ?? readString(base.matchId);
  if (!matchId) {
    throw new Error(`Base mapGame has no match id: ${baseMapGameId}`);
  }
  const now = new Date().toISOString();
  const maxOrder = repositories.sqlite
    .prepare("SELECT COALESCE(MAX(map_order), 0) AS maxOrder FROM map_games WHERE match_id = ?")
    .get(matchId) as { maxOrder?: number } | undefined;
  const created = {
    id: `map_hex_lab_${Date.now()}_${randomUUID().slice(0, 8)}`,
    matchId,
    mapName: "Dust2",
    order: Math.max(1, Number(maxOrder?.maxOrder ?? 0) + 1),
    status: "running" as const,
    runControlState: "idle" as const,
    teamAScore: 0,
    teamBScore: 0,
    currentRoundNumber: 0,
    createdAt: now,
    startedAt: now
  };
  await repositories.mapGames.save(created);
  const match = repositories.sqlite.prepare("SELECT * FROM matches WHERE id = ?").get(matchId) as Row | undefined;
  if (match && readString(match.status) === "scheduled") {
    repositories.sqlite
      .prepare("UPDATE matches SET status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ?")
      .run(now, matchId);
  }
  return created;
}

function listDust2MapOptions(repositories: SqliteRepositoryBundle): HexMatchLabMapOption[] {
  const rows = repositories.sqlite.prepare(
    `SELECT
       mg.id AS mapGameId,
       mg.match_id AS matchId,
       mg.map_name AS mapName,
       mg.status AS mapStatus,
       mg.team_a_score AS teamAScore,
       mg.team_b_score AS teamBScore,
       mg.current_round_number AS currentRoundNumber,
       mg.created_at AS createdAt,
       mg.completed_at AS completedAt,
       m.team_a_id AS teamAId,
       m.team_b_id AS teamBId,
       ta.display_name AS teamAName,
       tb.display_name AS teamBName,
       latest_summary.id AS latestSummaryArtifactId
     FROM map_games mg
     JOIN matches m ON m.id = mg.match_id
     LEFT JOIN teams ta ON ta.id = m.team_a_id
     LEFT JOIN teams tb ON tb.id = m.team_b_id
     LEFT JOIN (
       SELECT map_game_id, MAX(created_at) AS created_at
       FROM artifacts
       WHERE artifact_type = 'hex_map_summary'
       GROUP BY map_game_id
     ) latest_summary_created ON latest_summary_created.map_game_id = mg.id
     LEFT JOIN artifacts latest_summary
       ON latest_summary.map_game_id = mg.id
      AND latest_summary.artifact_type = 'hex_map_summary'
      AND latest_summary.created_at = latest_summary_created.created_at
     WHERE lower(replace(mg.map_name, ' ', '')) = 'dust2'
     ORDER BY COALESCE(mg.completed_at, mg.started_at, mg.created_at) DESC, mg.created_at DESC, mg.id DESC
     LIMIT 30`
  ).all() as Row[];

  return rows.map((row) => ({
    mapGameId: String(row.mapGameId),
    matchId: String(row.matchId),
    mapName: String(row.mapName),
    mapStatus: String(row.mapStatus),
    score: {
      teamA: Number(row.teamAScore ?? 0),
      teamB: Number(row.teamBScore ?? 0)
    },
    currentRoundNumber: Number(row.currentRoundNumber ?? 0),
    createdAt: String(row.createdAt ?? ""),
    completedAt: readString(row.completedAt),
    teamAId: String(row.teamAId),
    teamBId: String(row.teamBId),
    teamAName: readString(row.teamAName),
    teamBName: readString(row.teamBName),
    latestSummaryArtifactId: readString(row.latestSummaryArtifactId)
  }));
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
  summaries: HexMatchLabRoundSummary[],
  agentNames: Map<string, string>
): Promise<HexMatchLabRoundTraceDetail | undefined> {
  try {
    const raw = JSON.parse(await readArtifactText(repositories, projectRoot, artifactId)) as unknown;
    const trace = unwrapHexRoundTrace(raw);
    const fallbackSummary = summaries.find((round) => round.hexTraceArtifactId === artifactId);
    return summarizeTrace(artifactId, trace, fallbackSummary, loadOfficialDust2HexMap(), agentNames);
  } catch {
    return undefined;
  }
}

function unwrapHexRoundTrace(value: unknown): HexRoundTrace {
  const record = parseRecord(value);
  const nested = record ? parseRecord(record.trace) : undefined;
  return (nested ?? record ?? value) as HexRoundTrace;
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

function buildMapAssetView(asset: HexMapAsset): HexMatchLabMapAssetView {
  return {
    grid: {
      width: asset.grid.width,
      height: asset.grid.height,
      levels: asset.levels as HexMatchLabLevel[],
      defaultLevel: asset.defaultLevel as HexMatchLabLevel
    },
    cells: asset.cells.filter((cell) => cell.playable).map((cell) => ({
      cellId: cell.cellId,
      col: cell.col,
      row: cell.row,
      level: cell.level as HexMatchLabLevel,
      flags: cell.flags,
      regionId: cell.regionId,
      pointIds: cell.pointIds
    })),
    regions: asset.regions.map((region: HexMapRegion) => ({
      regionId: region.regionId,
      nameCn: region.nameCn,
      nameEn: region.nameEn,
      regionType: region.regionType
    })),
    points: asset.points.map((point: HexMapPoint) => ({
      pointId: point.pointId,
      nameCn: point.nameCn,
      nameEn: point.nameEn,
      pointType: point.pointType,
      parentRegionId: point.parentRegionId
    })),
    verticalLinks: asset.verticalLinks.map((link: HexMapVerticalLink) => ({
      linkId: link.linkId,
      fromCellId: link.fromCellId,
      toCellId: link.toCellId,
      linkType: link.linkType,
      oneWay: link.oneWay
    }))
  };
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
  fallbackSummary: HexMatchLabRoundSummary | undefined,
  asset: HexMapAsset,
  agentNames: Map<string, string>
): HexMatchLabRoundTraceDetail {
  const roundSummary: HexMatchLabRoundSummary = fallbackSummary ?? {
    roundNumber: trace.roundNumber,
    roundId: trace.roundId,
    hexTraceArtifactId: artifactId,
    fallbackCount: trace.audit.fallbackCount,
    combatResolutionCount: trace.audit.combatResolutionCount,
    finalHardCondition: summarizeHardCondition(trace.finalWinCondition)
  };
  const economySummary = summarizeEconomy(trace.economyContext);
  const phaseSummaries = trace.phases.map((phase) => summarizePhase(phase, asset, economySummary, agentNames));
  return {
    ...roundSummary,
    hexTraceArtifactId: artifactId,
    source: "hex_round_engine_committed",
    phaseSummaries,
    audit: summarizeTraceAudit(trace),
    economySummary
  };
}

function summarizePhase(
  phase: HexRoundTrace["phases"][number],
  asset: HexMapAsset,
  economySummary: HexMatchLabEconomySummary[],
  agentNames: Map<string, string>
): HexMatchLabPhaseSummary {
  const agentsAfter = phase.memoryAfter.agents;
  const aliveAttackCount = agentsAfter.filter((agent) => agent.side === "attack" && agent.lifeStatus !== "dead").length;
  const aliveDefenseCount = agentsAfter.filter((agent) => agent.side === "defense" && agent.lifeStatus !== "dead").length;
  const actions = phase.commandResult.actions.map((action) => {
    const audit = phase.commandResult.audits.find((candidate) => candidate.agentId === action.agentId);
    return {
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
      businessIntent: action.businessIntent,
      requestArtifactId: audit?.requestArtifactId,
      responseArtifactId: audit?.responseArtifactId
    };
  });
  const llmAudit = summarizePhaseAudit(phase);
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
    actions,
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
      economyEvidenceApplied: resolution.audit.economy.economyEvidenceApplied,
      varianceApplied: Boolean(parseRecord(resolution.audit.variance)?.varianceApplied)
    })),
    players: buildPlayerCards({
      agents: phase.memoryAfter.agents,
      actions,
      asset,
      economySummary,
      agentNames
    }),
    llmAudit,
    memoryBeforeSummary: summarizeMemory(phase.memoryBefore),
    memoryAfterSummary: summarizeMemory(phase.memoryAfter)
  };
}

function summarizeTraceAudit(trace: HexRoundTrace): HexMatchLabLlmAuditSummary {
  const phaseAudits = trace.phases.flatMap((phase) => phase.commandResult.audits);
  return {
    providerMode: trace.audit.providerMode,
    modelId: trace.audit.modelId,
    expectedCalls: trace.phases.length * 10,
    totalLlmCallsAttempted: trace.audit.totalLlmCallsAttempted,
    acceptedDrafts: phaseAudits.filter((audit) => audit.accepted).length,
    rejectedDrafts: trace.phases.reduce((sum, phase) => sum + phase.commandResult.rejectedDrafts.length, 0),
    fallbackCount: trace.audit.fallbackCount,
    combatResolutionCount: trace.audit.combatResolutionCount,
    rejectedEventCount: trace.audit.rejectedEventCount,
    requestArtifactIds: uniqueStrings(phaseAudits.map((audit) => audit.requestArtifactId)),
    responseArtifactIds: uniqueStrings(phaseAudits.map((audit) => audit.responseArtifactId)),
    fallbackReasons: uniqueStrings(phaseAudits.map((audit) => audit.fallbackReason)),
    providerErrors: uniqueStrings(phaseAudits.flatMap((audit) => audit.errors).filter((error) => error.startsWith("provider_error")))
  };
}

function summarizePhaseAudit(phase: HexRoundTrace["phases"][number]): HexMatchLabLlmAuditSummary {
  const audits = phase.commandResult.audits;
  return {
    providerMode: audits.find((audit) => audit.providerMode)?.providerMode,
    modelId: audits.find((audit) => audit.modelId)?.modelId,
    expectedCalls: phase.memoryBefore.agents.filter((agent) => agent.lifeStatus !== "dead" && agent.apRemaining > 0).length,
    totalLlmCallsAttempted: phase.commandResult.totalCallsAttempted,
    acceptedDrafts: audits.filter((audit) => audit.accepted).length,
    rejectedDrafts: phase.commandResult.rejectedDrafts.length,
    fallbackCount: phase.commandResult.fallbackCount,
    combatResolutionCount: phase.combatResolutions.length,
    rejectedEventCount: phase.memoryAfter.rejectedEvents.length,
    requestArtifactIds: uniqueStrings(audits.map((audit) => audit.requestArtifactId)),
    responseArtifactIds: uniqueStrings(audits.map((audit) => audit.responseArtifactId)),
    fallbackReasons: uniqueStrings(audits.map((audit) => audit.fallbackReason)),
    providerErrors: uniqueStrings(audits.flatMap((audit) => audit.errors).filter((error) => error.startsWith("provider_error")))
  };
}

function buildPlayerCards(input: {
  agents: HexRoundTrace["phases"][number]["memoryAfter"]["agents"];
  actions: HexMatchLabActionSummary[];
  asset: HexMapAsset;
  economySummary: HexMatchLabEconomySummary[];
  agentNames: Map<string, string>;
}): HexMatchLabPlayerCard[] {
  const cells = new Map(input.asset.cells.map((cell) => [cell.cellId, cell]));
  const regions = new Map(input.asset.regions.map((region) => [region.regionId, region]));
  const points = new Map(input.asset.points.map((point) => [point.pointId, point]));
  const economyByAgent = new Map(input.economySummary.flatMap((team) => team.agents.map((agent) => [agent.agentId, agent] as const)));
  const actionByAgent = new Map(input.actions.map((action) => [action.agentId, action]));
  return input.agents.map((agent) => {
    const cell = cells.get(agent.currentCellId);
    const region = agent.currentRegionId ? regions.get(agent.currentRegionId) : undefined;
    const economy = economyByAgent.get(agent.agentId);
    const action = actionByAgent.get(agent.agentId);
    return {
      agentId: agent.agentId,
      displayName: input.agentNames.get(agent.agentId),
      teamId: agent.teamId,
      side: agent.side,
      lifeStatus: agent.lifeStatus,
      currentCellId: agent.currentCellId,
      currentRegionId: agent.currentRegionId,
      currentRegionName: region?.nameCn,
      currentPointIds: agent.currentPointIds,
      currentPointNames: agent.currentPointIds.map((pointId) => points.get(pointId)?.nameCn ?? pointId),
      level: cell?.level,
      apBudget: agent.apBudget,
      apSpent: agent.apSpent,
      apRemaining: agent.apRemaining,
      carryingC4: agent.carryingC4,
      knownEnemyCount: agent.knownEnemies.length,
      lastSeenEnemyCount: agent.lastSeenEnemies.length,
      actionType: action?.actionType,
      targetCellId: action?.targetCellId,
      apCost: action?.apCost,
      validAction: action?.valid,
      fallbackReason: action?.fallbackReason,
      validationErrors: action?.validationErrors ?? [],
      buyType: economy?.buyType,
      resourceTier: economy?.resourceTier,
      utilityTier: economy?.utilityTier,
      outputBudget: economy?.outputBudget,
      dropReceived: economy?.dropReceived
    };
  });
}

function summarizeMemory(memory: HexRoundTrace["phases"][number]["memoryAfter"]): HexMatchLabMemorySummary {
  return {
    aliveAttackCount: memory.agents.filter((agent) => agent.side === "attack" && agent.lifeStatus !== "dead").length,
    aliveDefenseCount: memory.agents.filter((agent) => agent.side === "defense" && agent.lifeStatus !== "dead").length,
    woundedCount: memory.agents.filter((agent) => agent.lifeStatus === "wounded").length,
    deadCount: memory.agents.filter((agent) => agent.lifeStatus === "dead").length,
    knownEnemyCount: memory.agents.reduce((sum, agent) => sum + agent.knownEnemies.length, 0),
    lastSeenEnemyCount: memory.agents.reduce((sum, agent) => sum + agent.lastSeenEnemies.length, 0)
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

function readAgentDisplayNames(repositories: SqliteRepositoryBundle, matchId: string): Map<string, string> {
  const rows = repositories.sqlite.prepare(
    `SELECT a.id, a.display_name AS displayName
     FROM agents a
     JOIN matches m ON a.team_id IN (m.team_a_id, m.team_b_id)
     WHERE m.id = ?`
  ).all(matchId) as Row[];
  return new Map(rows.map((row) => [String(row.id), String(row.displayName ?? row.id)]));
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

function toCompletedMapHint(status: string): string | undefined {
  return status === "completed" ? "当前地图已完成，不能继续提交回合。请新建 Hex 验收比赛，或选择一张 active 地图。" : undefined;
}

function toProductError(error: unknown): { message: string; technicalDetails: string } {
  const technicalDetails = error instanceof Error ? error.message : String(error);
  if (/completed map/i.test(technicalDetails)) {
    return {
      message: `当前地图已完成，不能继续提交回合。请新建 Hex 验收比赛，或选择 active mapGame。\n\n技术细节：${technicalDetails}`,
      technicalDetails
    };
  }
  if (/no.*active.*dust2|没有找到可运行/i.test(technicalDetails)) {
    return {
      message: `没有可运行的 Dust2 Hex 地图。请先新建 Hex 验收比赛。\n\n技术细节：${technicalDetails}`,
      technicalDetails
    };
  }
  if (/provider_error|external|eacces|api key|network/i.test(technicalDetails)) {
    return {
      message: `真实 LLM provider 受限或失败。请查看 LLM 审计；本页面不会把失败包装成成功。\n\n技术细节：${technicalDetails}`,
      technicalDetails
    };
  }
  if (/max.*round/i.test(technicalDetails)) {
    return {
      message: `已达到最大回合上限，地图未完成。请检查 round trace 或提高 maxRounds。\n\n技术细节：${technicalDetails}`,
      technicalDetails
    };
  }
  return { message: technicalDetails, technicalDetails };
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

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function isInsideDirectory(targetPath: string, parentPath: string): boolean {
  const normalizedTarget = resolve(targetPath).toLowerCase();
  const normalizedParent = resolve(parentPath).toLowerCase();
  return normalizedTarget === normalizedParent || normalizedTarget.startsWith(`${normalizedParent}\\`);
}
