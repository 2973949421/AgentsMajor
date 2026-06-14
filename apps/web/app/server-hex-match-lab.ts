import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import {
  commitDust2HexRoundExperimental,
  loadOfficialDust2HexMap,
  runDust2HexMapExperimental,
  type HexAgentCommandProgressEvent,
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

export interface HexMatchLabLiveRunStatus {
  runId: string;
  status: HexMatchLabRunStatus;
  mapGameId?: string | undefined;
  currentStep: string;
  latestEvent?: string | undefined;
  latestError?: string | undefined;
  startedAt: string;
  completedAt?: string | undefined;
  elapsedMs: number;
  callsAttempted: number;
  expectedCalls: number;
  slots: HexMatchLabLiveCallSlot[];
  progress?: HexMatchLabProgress | undefined;
}

export interface HexMatchLabLiveCallSlot {
  phaseId: string;
  phaseIndex: number;
  agentId: string;
  callId: string;
  callIndex: number;
  expectedCalls: number;
  status: string;
  requestArtifactId?: string | undefined;
  responseArtifactId?: string | undefined;
  repairedFields: string[];
  errors: string[];
  fallbackReason?: string | undefined;
  providerMode?: string | undefined;
  modelId?: string | undefined;
  updatedAt: string;
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
  mapAssetView?: HexMatchLabMapAssetView | undefined;
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
  financeDuel?: HexMatchLabFinanceDuelSummary | undefined;
  financeReview?: HexMatchLabFinanceReview | undefined;
  businessDuel?: HexMatchLabBusinessDuelSummary | undefined;
  businessReview?: HexMatchLabBusinessReview | undefined;
}

export interface HexMatchLabFinanceDuelSummary {
  topicKey: string;
  topicTitle: string;
  defenseThesisFocus: string;
  attackChallengeFocus: string;
  halfIndex: 0 | 1;
  roundInHalf: number;
  mirrorRoundNumber: number;
  defenseThesis: {
    teamId: string;
    thesis: string;
    keyAssumptions: string[];
    evidenceRefs: string[];
    riskBoundary: string;
  };
  attackChallenge: {
    teamId: string;
    thesis: string;
    challengePoints: string[];
    requiredDefense: string[];
    evidenceRefs: string[];
  };
  evidence: {
    promptFacts: Array<{ factId: string; shortText: string; evidenceId: string }>;
    missingEvidence: string[];
    scoreCaps: Array<{ condition: string; maxScore: number; reason: string }>;
  };
  assignments: HexMatchLabAgentFinanceAssignmentSummary[];
}

export interface HexMatchLabAgentFinanceAssignmentSummary {
  agentId: string;
  teamId: string;
  side: string;
  role: string;
  financeTask: string;
  linkedThesisId?: string | undefined;
  linkedChallengeId?: string | undefined;
}

export interface HexMatchLabFinanceReview {
  roundStory: {
    title: string;
    summary: string;
    defenseSummary: string;
    attackSummary: string;
    evidenceSummary: string;
    mirrorSummary: string;
  };
  phaseStories: HexMatchLabPhaseFinanceStory[];
  hardWinnerStory?: {
    summary: string;
    winnerTeamId?: string | undefined;
    roundWinType?: string | undefined;
    reason?: string | undefined;
  } | undefined;
}

export interface HexMatchLabPhaseFinanceStory {
  phaseId: string;
  phaseIndex: number;
  phaseLabel?: string | undefined;
  summary: string;
  actionStories: HexMatchLabActionFinanceStory[];
  combatStories: HexMatchLabCombatFinanceStory[];
}

export interface HexMatchLabActionFinanceStory {
  agentId: string;
  side?: string | undefined;
  role: string;
  financeTask?: string | undefined;
  actionType: string;
  targetCellId?: string | undefined;
  financeIntent?: string | undefined;
  accepted: boolean;
  fallbackReason?: string | undefined;
  validationErrors: string[];
  requestArtifactId?: string | undefined;
  responseArtifactId?: string | undefined;
  rawOutputNote: string;
}

export interface HexMatchLabCombatFinanceStory {
  contactId: string;
  summary: string;
  financeVerdict?: string | undefined;
  participants: string[];
  retentionReasons: string[];
  financeReasons: string[];
  csReasons: string[];
  killAttributions: HexMatchLabCombatSummary["killAttributions"];
  roleContributions: HexMatchLabCombatSummary["roleContributions"];
}

export interface HexMatchLabBusinessDuelSummary {
  subthemeId: string;
  subthemeTitle: string;
  coreQuestion: string;
  halfIndex: 0 | 1;
  roundInHalf: number;
  mirrorRoundNumber: number;
  defenseProof: {
    teamId: string;
    thesis: string;
    claims: string[];
    evidenceFocus: string[];
  };
  attackChallenge: {
    teamId: string;
    thesis: string;
    challengePoints: string[];
    targetFailureModes: string[];
  };
  assignments: HexMatchLabAgentBusinessAssignmentSummary[];
}

export interface HexMatchLabAgentBusinessAssignmentSummary {
  agentId: string;
  teamId: string;
  side: string;
  role: string;
  businessTask: string;
  csCarrierHint: string;
}

export interface HexMatchLabBusinessReview {
  roundStory: {
    title: string;
    summary: string;
    defenseSummary: string;
    attackSummary: string;
    mirrorSummary: string;
  };
  phaseStories: HexMatchLabPhaseBusinessStory[];
  hardWinnerStory?: {
    summary: string;
    winnerTeamId?: string | undefined;
    roundWinType?: string | undefined;
    reason?: string | undefined;
  } | undefined;
}

export interface HexMatchLabPhaseBusinessStory {
  phaseId: string;
  phaseIndex: number;
  phaseLabel?: string | undefined;
  summary: string;
  actionStories: HexMatchLabActionBusinessStory[];
  combatStories: HexMatchLabCombatBusinessStory[];
}

export interface HexMatchLabActionBusinessStory {
  agentId: string;
  side?: string | undefined;
  role: string;
  businessTask?: string | undefined;
  csCarrierHint?: string | undefined;
  actionType: string;
  targetCellId?: string | undefined;
  businessIntent?: string | undefined;
  accepted: boolean;
  fallbackReason?: string | undefined;
  validationErrors: string[];
  requestArtifactId?: string | undefined;
  responseArtifactId?: string | undefined;
  rawOutputNote: string;
}

export interface HexMatchLabCombatBusinessStory {
  contactId: string;
  summary: string;
  businessVerdict?: string | undefined;
  participants: string[];
  retentionReasons: string[];
  businessReasons: string[];
  csReasons: string[];
  killAttributions: HexMatchLabCombatSummary["killAttributions"];
  roleContributions: HexMatchLabCombatSummary["roleContributions"];
}

export interface HexMatchLabPhaseSummary {
  phaseId: string;
  phaseIndex: number;
  phaseLabel?: string | undefined;
  isSetupPhase?: boolean | undefined;
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
    droppedCellId?: string | undefined;
    lastCarrierAgentId?: string | undefined;
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
  roleLabel: string;
  kda: string;
  roundKills: number;
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
  tokenBankBefore?: number | undefined;
  tokenBankAfterDrop?: number | undefined;
  currentEconomy?: number | undefined;
  economyBalance?: number | undefined;
  spend?: number | undefined;
}

export interface HexMatchLabActionSummary {
  agentId: string;
  teamId?: string | undefined;
  side?: string | undefined;
  actionType: string;
  currentCellId?: string | undefined;
  targetCellId?: string | undefined;
  pathCellIds: string[];
  verticalLinkIds: string[];
  pathSource?: string | undefined;
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
  businessVerdict?: string | undefined;
  financeVerdict?: string | undefined;
  businessReasons: string[];
  financeReasons: string[];
  csReasons: string[];
  casualties: string[];
  killAttributions: Array<{
    killerAgentId?: string | undefined;
    targetAgentId: string;
    assisterAgentIds: string[];
    result: string;
    attributionReasons: string[];
    targetSelectionReasons: string[];
  }>;
  suppressions: string[];
  regionControlHint?: string | undefined;
  businessScoreAttack?: number | undefined;
  businessScoreDefense?: number | undefined;
  financeScoreAttack?: number | undefined;
  financeScoreDefense?: number | undefined;
  csScoreAttack?: number | undefined;
  csScoreDefense?: number | undefined;
  economyEvidenceApplied?: boolean | undefined;
  varianceApplied?: boolean | undefined;
  sitePressure?: boolean | undefined;
  plantDenied?: boolean | undefined;
  tradeOpportunity?: boolean | undefined;
  contactRetentionReasons: string[];
  prunedCandidateCount?: number | undefined;
  roleContributions: Array<{
    agentId: string;
    roleLabel: string;
    contributionType: string;
    scoreDelta: number;
    reasons: string[];
  }>;
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
    spend?: number | undefined;
    dropSent?: number | undefined;
    dropReceived?: number | undefined;
    tokenBankBefore?: number | undefined;
    tokenBankAfterDrop?: number | undefined;
    currentEconomy?: number | undefined;
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
  compactRequestCount: number;
  languageMismatchCount: number;
  semanticLanguages: string[];
  averageRequestReductionRatio?: number | undefined;
  promptTokenTotal?: number | undefined;
  repairedFields: string[];
  fallbackReasons: string[];
  providerErrors: string[];
  roundStrategySeed?: string | undefined;
  strategyVariant?: string | undefined;
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
  includeMapAsset?: boolean | null;
}

type Row = Record<string, unknown>;
type AgentIdentity = {
  displayName: string;
  roleLabel: string;
};

type LiveRunRecord = Omit<HexMatchLabLiveRunStatus, "elapsedMs"> & {
  startedAtMs: number;
};

const liveRuns = getLiveRunStore();

function getLiveRunStore(): Map<string, LiveRunRecord> {
  const key = "__agentMajorHexMatchLiveRuns";
  const globalScope = globalThis as typeof globalThis & {
    [key]?: Map<string, LiveRunRecord>;
  };
  globalScope[key] ??= new Map<string, LiveRunRecord>();
  return globalScope[key]!;
}

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
  const mapAssetView = input.includeMapAsset ? buildMapAssetView(loadOfficialDust2HexMap()) : undefined;
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
  const agentIdentities = readAgentIdentities(input.repositories, mapGame.matchId);
  const selectedTrace = selectedTraceArtifactId
    ? await readRoundTraceDetail(input.repositories, input.projectRoot, selectedTraceArtifactId, roundSummaries, agentIdentities)
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
    ...(mapAssetView ? { mapAssetView } : {}),
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
  mapAssetView: HexMatchLabMapAssetView | undefined,
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
    ...(mapAssetView ? { mapAssetView } : {}),
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
  agentIdentities: Map<string, AgentIdentity>
): Promise<HexMatchLabRoundTraceDetail | undefined> {
  try {
    const raw = JSON.parse(await readArtifactText(repositories, projectRoot, artifactId)) as unknown;
    const trace = unwrapHexRoundTrace(raw);
    const fallbackSummary = summaries.find((round) => round.hexTraceArtifactId === artifactId);
    const preRoundKda = await buildPreRoundKdaByAgent(repositories, projectRoot, summaries, trace.roundNumber, artifactId);
    return summarizeTrace(artifactId, trace, fallbackSummary, loadOfficialDust2HexMap(), agentIdentities, preRoundKda);
  } catch {
    return undefined;
  }
}

async function buildPreRoundKdaByAgent(
  repositories: SqliteRepositoryBundle,
  projectRoot: string,
  summaries: HexMatchLabRoundSummary[],
  selectedRoundNumber: number,
  selectedArtifactId: string
): Promise<Map<string, HexKdaStat>> {
  const cumulative = new Map<string, HexKdaStat>();
  const previousRounds = summaries
    .filter((round) =>
      typeof round.roundNumber === "number"
      && round.roundNumber < selectedRoundNumber
      && Boolean(round.hexTraceArtifactId)
      && round.hexTraceArtifactId !== selectedArtifactId
    )
    .sort((left, right) => left.roundNumber - right.roundNumber);

  for (const round of previousRounds) {
    try {
      const raw = JSON.parse(await readArtifactText(repositories, projectRoot, round.hexTraceArtifactId!)) as unknown;
      const trace = unwrapHexRoundTrace(raw);
      mergeKdaInto(cumulative, buildKdaByAgent(trace.phases));
    } catch {
      // 历史 trace 缺失时跳过，不能让 KDA 汇总阻断验收台读取。
    }
  }

  return cumulative;
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
    .map((report) => ({ report, traceReference: getRoundTraceReference(report) }))
    .filter((entry): entry is { report: RoundReport; traceReference: { traceArtifactId: string; traceSource: "hex_round_engine_committed" } } =>
      entry.traceReference !== null
    )
    .map(({ report, traceReference }) => ({
      roundNumber: report.roundNumber,
      roundId: report.roundId,
      reportId: report.id,
      winnerTeamId: report.winnerTeamId,
      roundWinType: report.judgeResult.roundWinType,
      scoreAfterRound: report.scoreAfterRound,
      hexTraceArtifactId: traceReference.traceArtifactId,
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

function getRoundTraceReference(report: RoundReport): { traceArtifactId: string; traceSource: "hex_round_engine_committed" } | null {
  if (report.nodeTraceSource !== "hex_round_engine_committed" || !report.nodeTraceArtifactId) {
    return null;
  }
  return {
    traceArtifactId: report.nodeTraceArtifactId,
    traceSource: report.nodeTraceSource
  };
}

function summarizeTrace(
  artifactId: string,
  trace: HexRoundTrace,
  fallbackSummary: HexMatchLabRoundSummary | undefined,
  asset: HexMapAsset,
  agentIdentities: Map<string, AgentIdentity>,
  preRoundKdaByAgent: Map<string, HexKdaStat>
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
  const firstPhase = trace.phases[0];
  const phaseSummaries = [
    ...(firstPhase ? [summarizeSetupPhase(firstPhase, asset, economySummary, agentIdentities)] : []),
    ...trace.phases.map((phase, index) => summarizePhase(
      phase,
      asset,
      economySummary,
      agentIdentities,
      mergeKdaStats(preRoundKdaByAgent, buildKdaByAgent(trace.phases.slice(0, index + 1))),
      buildKillCountsByAgent(trace.phases.slice(0, index + 1))
    ))
  ];
  const businessDuel = summarizeBusinessDuel(trace);
  const financeDuel = summarizeFinanceDuel(trace);
  const finalHardCondition = summarizeHardCondition(trace.finalWinCondition);
  return {
    ...roundSummary,
    hexTraceArtifactId: artifactId,
    source: "hex_round_engine_committed",
    phaseSummaries,
    audit: summarizeTraceAudit(trace),
    economySummary,
    financeDuel,
    financeReview: financeDuel
      ? buildFinanceReview({
        financeDuel,
        phaseSummaries,
        finalHardCondition
      })
      : undefined,
    businessDuel,
    businessReview: businessDuel
      ? buildBusinessReview({
        businessDuel,
        phaseSummaries,
        finalHardCondition
      })
      : undefined
  };
}

function summarizeBusinessDuel(trace: HexRoundTrace): HexMatchLabBusinessDuelSummary | undefined {
  const duel = trace.businessDuel;
  if (!duel) return undefined;
  return {
    subthemeId: duel.subtheme.subthemeId,
    subthemeTitle: duel.subtheme.title,
    coreQuestion: duel.subtheme.coreQuestion,
    halfIndex: duel.halfIndex,
    roundInHalf: duel.roundInHalf,
    mirrorRoundNumber: duel.mirrorRoundNumber,
    defenseProof: {
      teamId: duel.defenseProof.teamId,
      thesis: duel.defenseProof.thesis,
      claims: duel.defenseProof.claims,
      evidenceFocus: duel.defenseProof.evidenceFocus
    },
    attackChallenge: {
      teamId: duel.attackChallenge.teamId,
      thesis: duel.attackChallenge.thesis,
      challengePoints: duel.attackChallenge.challengePoints,
      targetFailureModes: duel.attackChallenge.targetFailureModes
    },
    assignments: duel.agentAssignments.map((assignment) => ({
      agentId: assignment.agentId,
      teamId: assignment.teamId,
      side: assignment.side,
      role: assignment.role,
      businessTask: assignment.businessTask,
      csCarrierHint: assignment.csCarrierHint
    }))
  };
}

function summarizeFinanceDuel(trace: HexRoundTrace): HexMatchLabFinanceDuelSummary | undefined {
  const duel = trace.financeDuel;
  if (!duel) return undefined;
  return {
    topicKey: duel.topic.roundKey,
    topicTitle: duel.topic.topicTitle,
    defenseThesisFocus: duel.topic.defenseThesisFocus,
    attackChallengeFocus: duel.topic.attackChallengeFocus,
    halfIndex: duel.halfIndex,
    roundInHalf: duel.roundInHalf,
    mirrorRoundNumber: duel.mirrorRoundNumber,
    defenseThesis: {
      teamId: duel.defenseThesis.teamId,
      thesis: duel.defenseThesis.thesis,
      keyAssumptions: [...duel.defenseThesis.keyAssumptions],
      evidenceRefs: [...duel.defenseThesis.evidenceRefs],
      riskBoundary: duel.defenseThesis.riskBoundary
    },
    attackChallenge: {
      teamId: duel.attackChallenge.teamId,
      thesis: duel.attackChallenge.thesis,
      challengePoints: [...duel.attackChallenge.challengePoints],
      requiredDefense: [...duel.attackChallenge.requiredDefense],
      evidenceRefs: [...duel.attackChallenge.evidenceRefs]
    },
    evidence: {
      promptFacts: duel.evidence.promptFacts.map((fact) => ({ ...fact })),
      missingEvidence: [...duel.evidence.missingEvidence],
      scoreCaps: duel.evidence.scoreCaps.map((cap) => ({ ...cap }))
    },
    assignments: duel.agentAssignments.map((assignment) => ({
      agentId: assignment.agentId,
      teamId: assignment.teamId,
      side: assignment.side,
      role: assignment.role,
      financeTask: assignment.financeTask,
      linkedThesisId: assignment.linkedThesisId,
      linkedChallengeId: assignment.linkedChallengeId
    }))
  };
}

function buildFinanceReview(input: {
  financeDuel: HexMatchLabFinanceDuelSummary;
  phaseSummaries: HexMatchLabPhaseSummary[];
  finalHardCondition?: HexMatchLabHardConditionSummary | undefined;
}): HexMatchLabFinanceReview {
  const assignmentsByAgentId = new Map(input.financeDuel.assignments.map((assignment) => [assignment.agentId, assignment]));
  const hardWinnerStory = input.finalHardCondition
    ? {
      summary: `最终胜负来自硬条件：${input.finalHardCondition.roundWinType ?? "未结束"}。${input.finalHardCondition.reason ?? "未记录原因"}`,
      winnerTeamId: input.finalHardCondition.winnerTeamId,
      roundWinType: input.finalHardCondition.roundWinType ?? input.finalHardCondition.judgeRoundWinType,
      reason: input.finalHardCondition.reason
    }
    : undefined;
  return {
    roundStory: {
      title: input.financeDuel.topicTitle,
      summary: `本回合金融小主题是「${input.financeDuel.topicTitle}」：守方围绕「${input.financeDuel.defenseThesisFocus}」自证，攻方围绕「${input.financeDuel.attackChallengeFocus}」反证。`,
      defenseSummary: `守方 ${input.financeDuel.defenseThesis.teamId} 投资主张：${input.financeDuel.defenseThesis.thesis}`,
      attackSummary: `攻方 ${input.financeDuel.attackChallenge.teamId} 反证质疑：${input.financeDuel.attackChallenge.thesis}`,
      evidenceSummary: `证据 ${input.financeDuel.evidence.promptFacts.map((fact) => fact.factId).join(", ") || "无"}；缺失 ${input.financeDuel.evidence.missingEvidence.join(", ") || "无"}；评分上限 ${input.financeDuel.evidence.scoreCaps.map((cap) => `${cap.condition}:${cap.maxScore}`).join(", ") || "无"}`,
      mirrorSummary: `当前为第 ${input.financeDuel.halfIndex + 1} 个半场的第 ${input.financeDuel.roundInHalf} 个小主题；攻防互换对应 round ${input.financeDuel.mirrorRoundNumber}。`
    },
    phaseStories: input.phaseSummaries.map((phase) => buildPhaseFinanceStory(phase, assignmentsByAgentId)),
    ...(hardWinnerStory ? { hardWinnerStory } : {})
  };
}

function buildPhaseFinanceStory(
  phase: HexMatchLabPhaseSummary,
  assignmentsByAgentId: Map<string, HexMatchLabAgentFinanceAssignmentSummary>
): HexMatchLabPhaseFinanceStory {
  const actionStories = phase.actions.map((action) => {
    const assignment = assignmentsByAgentId.get(action.agentId);
    return {
      agentId: action.agentId,
      side: action.side,
      role: assignment?.role ?? "role unknown",
      financeTask: assignment?.financeTask,
      actionType: action.actionType,
      targetCellId: action.targetCellId,
      financeIntent: action.businessIntent,
      accepted: action.valid && !action.fallbackReason && action.validationErrors.length === 0,
      fallbackReason: action.fallbackReason,
      validationErrors: [...action.validationErrors],
      requestArtifactId: action.requestArtifactId,
      responseArtifactId: action.responseArtifactId,
      rawOutputNote: action.responseArtifactId
        ? "当前 trace 记录了 response artifact id；如需原文，请通过 artifact id 追溯。"
        : "当前 trace 未内联 LLM 原文。"
    };
  });
  const combatStories = phase.combats.map((combat) => ({
    contactId: combat.contactId,
    summary: buildFinanceCombatStorySummary(combat),
    financeVerdict: combat.financeVerdict,
    participants: [...combat.participants],
    retentionReasons: [...combat.contactRetentionReasons],
    financeReasons: [...combat.financeReasons],
    csReasons: [...combat.csReasons],
    killAttributions: combat.killAttributions.map((item) => ({
      killerAgentId: item.killerAgentId,
      targetAgentId: item.targetAgentId,
      assisterAgentIds: [...item.assisterAgentIds],
      result: item.result,
      attributionReasons: [...item.attributionReasons],
      targetSelectionReasons: [...item.targetSelectionReasons]
    })),
    roleContributions: combat.roleContributions.map((item) => ({
      agentId: item.agentId,
      roleLabel: item.roleLabel,
      contributionType: item.contributionType,
      scoreDelta: item.scoreDelta,
      reasons: [...item.reasons]
    }))
  }));
  return {
    phaseId: phase.phaseId,
    phaseIndex: phase.phaseIndex,
    phaseLabel: phase.phaseLabel,
    summary: phase.isSetupPhase
      ? "准备阶段展示出生、经济、C4 和金融角色职责，不产生 LLM 调用。"
      : `本阶段 accepted ${phase.acceptedActionCount}、rejected ${phase.rejectedDraftCount}、fallback ${phase.fallbackActionCount}，关键战斗 ${phase.combatResolutionCount} 个。`,
    actionStories,
    combatStories
  };
}

function buildFinanceCombatStorySummary(combat: HexMatchLabCombatSummary): string {
  const verdict = combat.financeVerdict ?? "未记录金融裁定";
  const killText = combat.killAttributions.length > 0
    ? combat.killAttributions.map((item) => `${item.killerAgentId ?? "未分配"} 击中 ${item.targetAgentId}${item.assisterAgentIds.length > 0 ? `，助攻 ${item.assisterAgentIds.join(", ")}` : ""}`).join("；")
    : "没有击杀归因";
  const controlText = combat.regionControlHint ? `控图倾向 ${combat.regionControlHint}` : "控图倾向未记录";
  return `金融裁定：${verdict}。${killText}。${controlText}。`;
}

function buildBusinessReview(input: {
  businessDuel: HexMatchLabBusinessDuelSummary;
  phaseSummaries: HexMatchLabPhaseSummary[];
  finalHardCondition?: HexMatchLabHardConditionSummary | undefined;
}): HexMatchLabBusinessReview {
  const assignmentsByAgentId = new Map(input.businessDuel.assignments.map((assignment) => [assignment.agentId, assignment]));
  const hardWinnerStory = input.finalHardCondition
    ? {
      summary: `最终胜负来自硬条件：${input.finalHardCondition.roundWinType ?? "未结束"}。${input.finalHardCondition.reason ?? "未记录原因"}`,
      winnerTeamId: input.finalHardCondition.winnerTeamId,
      roundWinType: input.finalHardCondition.roundWinType ?? input.finalHardCondition.judgeRoundWinType,
      reason: input.finalHardCondition.reason
    }
    : undefined;
  return {
    roundStory: {
      title: input.businessDuel.subthemeTitle,
      summary: `本回合小主题是「${input.businessDuel.subthemeTitle}」：${input.businessDuel.coreQuestion}`,
      defenseSummary: `守方 ${input.businessDuel.defenseProof.teamId} 自证：${input.businessDuel.defenseProof.thesis}`,
      attackSummary: `攻方 ${input.businessDuel.attackChallenge.teamId} 质疑：${input.businessDuel.attackChallenge.thesis}`,
      mirrorSummary: `当前为第 ${input.businessDuel.halfIndex + 1} 个半场的第 ${input.businessDuel.roundInHalf} 个小主题；攻防互换对应 round ${input.businessDuel.mirrorRoundNumber}。`
    },
    phaseStories: input.phaseSummaries.map((phase) => buildPhaseBusinessStory(phase, assignmentsByAgentId)),
    ...(hardWinnerStory ? { hardWinnerStory } : {})
  };
}

function buildPhaseBusinessStory(
  phase: HexMatchLabPhaseSummary,
  assignmentsByAgentId: Map<string, HexMatchLabAgentBusinessAssignmentSummary>
): HexMatchLabPhaseBusinessStory {
  const actionStories = phase.actions.map((action) => {
    const assignment = assignmentsByAgentId.get(action.agentId);
    return {
      agentId: action.agentId,
      side: action.side,
      role: assignment?.role ?? "role unknown",
      businessTask: assignment?.businessTask,
      csCarrierHint: assignment?.csCarrierHint,
      actionType: action.actionType,
      targetCellId: action.targetCellId,
      businessIntent: action.businessIntent,
      accepted: action.valid && !action.fallbackReason && action.validationErrors.length === 0,
      fallbackReason: action.fallbackReason,
      validationErrors: [...action.validationErrors],
      requestArtifactId: action.requestArtifactId,
      responseArtifactId: action.responseArtifactId,
      rawOutputNote: action.responseArtifactId
        ? "当前 trace 记录了 response artifact id；如需原文，请通过 artifact id 追溯。"
        : "当前 trace 未内联 LLM 原文。"
    };
  });
  const combatStories = phase.combats.map((combat) => ({
    contactId: combat.contactId,
    summary: buildCombatStorySummary(combat),
    businessVerdict: combat.businessVerdict,
    participants: [...combat.participants],
    retentionReasons: [...combat.contactRetentionReasons],
    businessReasons: [...combat.businessReasons],
    csReasons: [...combat.csReasons],
    killAttributions: combat.killAttributions.map((item) => ({
      killerAgentId: item.killerAgentId,
      targetAgentId: item.targetAgentId,
      assisterAgentIds: [...item.assisterAgentIds],
      result: item.result,
      attributionReasons: [...item.attributionReasons],
      targetSelectionReasons: [...item.targetSelectionReasons]
    })),
    roleContributions: combat.roleContributions.map((item) => ({
      agentId: item.agentId,
      roleLabel: item.roleLabel,
      contributionType: item.contributionType,
      scoreDelta: item.scoreDelta,
      reasons: [...item.reasons]
    }))
  }));
  return {
    phaseId: phase.phaseId,
    phaseIndex: phase.phaseIndex,
    phaseLabel: phase.phaseLabel,
    summary: phase.isSetupPhase
      ? "准备阶段展示出生、经济、C4 和角色职责，不产生 LLM 调用。"
      : `本阶段 accepted ${phase.acceptedActionCount}、rejected ${phase.rejectedDraftCount}、fallback ${phase.fallbackActionCount}，关键战斗 ${phase.combatResolutionCount} 个。`,
    actionStories,
    combatStories
  };
}

function buildCombatStorySummary(combat: HexMatchLabCombatSummary): string {
  const verdict = combat.businessVerdict ?? "未记录商业裁定";
  const killText = combat.killAttributions.length > 0
    ? combat.killAttributions.map((item) => `${item.killerAgentId ?? "未分配"} 击中 ${item.targetAgentId}${item.assisterAgentIds.length > 0 ? `，助攻 ${item.assisterAgentIds.join(", ")}` : ""}`).join("；")
    : "没有击杀归因";
  const controlText = combat.regionControlHint ? `控图倾向 ${combat.regionControlHint}` : "控图倾向未记录";
  return `商业裁定：${verdict}。${killText}。${controlText}。`;
}

function summarizeSetupPhase(
  phase: HexRoundTrace["phases"][number],
  asset: HexMapAsset,
  economySummary: HexMatchLabEconomySummary[],
  agentIdentities: Map<string, AgentIdentity>
): HexMatchLabPhaseSummary {
  const agents = phase.memoryBefore.agents;
  const aliveAttackCount = agents.filter((agent) => agent.side === "attack" && agent.lifeStatus !== "dead").length;
  const aliveDefenseCount = agents.filter((agent) => agent.side === "defense" && agent.lifeStatus !== "dead").length;
  return {
    phaseId: "buy_setup",
    phaseIndex: -1,
    phaseLabel: "P0 准备阶段",
    isSetupPhase: true,
    callsAttempted: 0,
    acceptedActionCount: 0,
    rejectedDraftCount: 0,
    fallbackActionCount: 0,
    combatContactCount: 0,
    combatResolutionCount: 0,
    memoryEventCount: 0,
    rejectedEventCount: 0,
    aliveAttackCount,
    aliveDefenseCount,
    bombState: {
      planted: phase.memoryBefore.bombState.planted,
      plantedCellId: phase.memoryBefore.bombState.plantedCellId,
      carrierAgentId: phase.memoryBefore.bombState.carrierAgentId,
      droppedCellId: phase.memoryBefore.bombState.droppedCellId,
      lastCarrierAgentId: phase.memoryBefore.bombState.lastCarrierAgentId
    },
    actions: [],
    combats: [],
    players: buildPlayerCards({
      agents,
      actions: [],
      asset,
      economySummary,
      agentIdentities,
      kdaByAgent: new Map(),
      roundKillsByAgent: new Map(),
      isSetupPhase: true
    }),
    llmAudit: {
      expectedCalls: 0,
      totalLlmCallsAttempted: 0,
      acceptedDrafts: 0,
      rejectedDrafts: 0,
      fallbackCount: 0,
      combatResolutionCount: 0,
      rejectedEventCount: 0,
      requestArtifactIds: [],
      responseArtifactIds: [],
      compactRequestCount: 0,
      languageMismatchCount: 0,
      semanticLanguages: [],
      repairedFields: [],
      fallbackReasons: [],
      providerErrors: []
    },
    memoryBeforeSummary: summarizeMemory(phase.memoryBefore),
    memoryAfterSummary: summarizeMemory(phase.memoryBefore)
  };
}

function summarizePhase(
  phase: HexRoundTrace["phases"][number],
  asset: HexMapAsset,
  economySummary: HexMatchLabEconomySummary[],
  agentIdentities: Map<string, AgentIdentity>,
  kdaByAgent: Map<string, HexKdaStat>,
  roundKillsByAgent: Map<string, number>
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
      pathCellIds: [...(action.pathCellIds ?? [])],
      verticalLinkIds: [...(action.verticalLinkIds ?? [])],
      pathSource: action.pathSource,
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
      carrierAgentId: phase.memoryAfter.bombState.carrierAgentId,
      droppedCellId: phase.memoryAfter.bombState.droppedCellId,
      lastCarrierAgentId: phase.memoryAfter.bombState.lastCarrierAgentId
    },
    winCondition: summarizeHardCondition(phase.winCondition),
    actions,
    combats: phase.combatResolutions.map((resolution) => ({
      contactId: resolution.contactId,
      participants: resolution.participants.map((participant) => participant.agentId),
      advantage: resolution.advantage,
      verdict: resolution.verdict,
      businessVerdict: resolution.businessVerdict,
      financeVerdict: resolution.financeVerdict,
      businessReasons: resolution.businessReasons ?? [],
      financeReasons: resolution.financeReasons ?? [],
      csReasons: resolution.csReasons ?? [],
      casualties: resolution.casualties.map((casualty) => `${casualty.targetAgentId ?? casualty.agentId}:${casualty.result}`),
      killAttributions: resolution.casualties.map((casualty) => ({
        killerAgentId: casualty.killerAgentId,
        targetAgentId: casualty.targetAgentId ?? casualty.agentId,
        assisterAgentIds: casualty.assisterAgentIds ?? [],
        result: casualty.result,
        attributionReasons: casualty.attributionReasons ?? [],
        targetSelectionReasons: casualty.targetSelectionReasons ?? []
      })),
      suppressions: resolution.suppressions.map((suppression) => `${suppression.agentId}:${suppression.result}`),
      regionControlHint: resolution.regionControlHint,
      businessScoreAttack: resolution.scores.attack.businessScore,
      businessScoreDefense: resolution.scores.defense.businessScore,
      financeScoreAttack: resolution.scores.attack.financeScore,
      financeScoreDefense: resolution.scores.defense.financeScore,
      csScoreAttack: resolution.scores.attack.csScore,
      csScoreDefense: resolution.scores.defense.csScore,
      economyEvidenceApplied: resolution.audit.economy.economyEvidenceApplied,
      varianceApplied: Boolean(parseRecord(resolution.audit.variance)?.varianceApplied),
      sitePressure: resolution.audit.sitePressure,
      plantDenied: resolution.audit.plantDenied,
      tradeOpportunity: resolution.audit.tradeOpportunity,
      contactRetentionReasons: resolution.audit.contactRetention?.retentionReasons ?? [],
      prunedCandidateCount: resolution.audit.contactRetention?.prunedCandidateCount,
      roleContributions: (resolution.audit.roleContributions ?? []).map((contribution) => ({
        agentId: contribution.agentId,
        roleLabel: contribution.roleLabel,
        contributionType: contribution.contributionType,
        scoreDelta: contribution.scoreDelta,
        reasons: [...contribution.reasons]
      }))
    })),
    players: buildPlayerCards({
      agents: phase.memoryAfter.agents,
      actions,
      asset,
      economySummary,
      agentIdentities,
      kdaByAgent,
      roundKillsByAgent
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
    compactRequestCount: phaseAudits.filter((audit) => audit.requestSizeMetrics?.compactRequestCharLength).length,
    languageMismatchCount: phaseAudits.filter((audit) => audit.languageMismatch).length,
    semanticLanguages: uniqueStrings(phaseAudits.map((audit) => audit.semanticLanguage)),
    averageRequestReductionRatio: averageNumbers(phaseAudits.map((audit) => audit.requestSizeMetrics?.estimatedReductionRatio)),
    promptTokenTotal: sumNumbers(phaseAudits.map((audit) => audit.requestSizeMetrics?.providerPromptTokens)),
    repairedFields: uniqueStrings(phaseAudits.flatMap((audit) => audit.repairedFields ?? [])),
    fallbackReasons: uniqueStrings(phaseAudits.map((audit) => audit.fallbackReason)),
    providerErrors: uniqueStrings(phaseAudits.flatMap((audit) => audit.errors).filter((error) => error.startsWith("provider_error"))),
    roundStrategySeed: trace.audit.roundStrategySeed,
    strategyVariant: trace.audit.strategyVariant
  };
}

export function readHexMatchLabMapAssetView(): HexMatchLabMapAssetView {
  return buildMapAssetView(loadOfficialDust2HexMap());
}

export async function startHexMatchLabLiveRun(request: HexMatchLabRunRequest): Promise<HexMatchLabLiveRunStatus> {
  const runId = `hex_live_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();
  const record: LiveRunRecord = {
    runId,
    status: "running",
    mapGameId: request.mapGameId,
    currentStep: "启动 Hex real LLM 验收运行",
    startedAt,
    startedAtMs: Date.now(),
    callsAttempted: 0,
    expectedCalls: 0,
    slots: []
  };
  liveRuns.set(runId, record);
  void runHexMatchLabLiveRun(runId, request);
  return materializeLiveRunStatus(record);
}

export function readHexMatchLabLiveRun(runId: string): HexMatchLabLiveRunStatus | undefined {
  const record = liveRuns.get(runId);
  return record ? materializeLiveRunStatus(record) : undefined;
}

async function runHexMatchLabLiveRun(runId: string, request: HexMatchLabRunRequest): Promise<void> {
  const record = liveRuns.get(runId);
  if (!record) return;
  const projectRoot = findProjectRoot(process.cwd());
  const repositories = createSqliteRepositories(resolve(projectRoot, defaultSqlitePath));
  try {
    const mapGameId = request.mapGameId ?? findLatestDust2MapGameId(repositories, { activeOnly: true });
    if (!mapGameId) {
      throw new Error("没有找到可运行的 active Dust2 mapGame。请先新建 Hex 验收比赛，或传入 mapGameId。");
    }
    record.mapGameId = mapGameId;
    record.currentStep = request.scope === "round" ? "提交下一回合" : "提交当前地图";
    const artifactStore = new ServerLocalArtifactStore(projectRoot, repositories.artifacts);
    const env = loadRootLocalEnv(projectRoot, process.env);
    const progressSink = async (event: HexAgentCommandProgressEvent) => {
      appendLiveProgressEvent(runId, event);
    };
    if (request.scope === "round") {
      await commitDust2HexRoundExperimental({
        repositories,
        artifactStore,
        mapGameId,
        enableExperimentalMode: true,
        providerMode: request.providerMode,
        maxLlmCallsPerPhase: request.maxLlmCallsPerPhase,
        env,
        progressSink
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
    record.progress = await readHexMatchLabProgress({
      mapGameId,
      projectRoot,
      repositories,
      providerMode: request.providerMode
    });
    record.status = "completed";
    record.currentStep = request.scope === "round" ? "下一回合提交完成" : "地图运行完成";
    record.completedAt = new Date().toISOString();
  } catch (error) {
    const productError = toProductError(error);
    record.status = "failed";
    record.currentStep = "运行失败";
    record.latestError = productError.message;
    record.completedAt = new Date().toISOString();
  } finally {
    repositories.close();
  }
}

function appendLiveProgressEvent(runId: string, event: HexAgentCommandProgressEvent): void {
  const record = liveRuns.get(runId);
  if (!record) return;
  const now = new Date().toISOString();
  const existing = record.slots.find((slot) => slot.callId === event.callId);
  const nextSlot: HexMatchLabLiveCallSlot = {
    phaseId: event.phaseId,
    phaseIndex: event.phaseIndex,
    agentId: event.agentId,
    callId: event.callId,
    callIndex: event.callIndex,
    expectedCalls: event.expectedCalls,
    status: event.status,
    requestArtifactId: event.requestArtifactId ?? existing?.requestArtifactId,
    responseArtifactId: event.responseArtifactId ?? existing?.responseArtifactId,
    repairedFields: uniqueStrings([...(existing?.repairedFields ?? []), ...(event.repairedFields ?? [])]),
    errors: uniqueStrings([...(existing?.errors ?? []), ...(event.errors ?? [])]),
    fallbackReason: event.fallbackReason ?? existing?.fallbackReason,
    providerMode: event.providerMode ?? existing?.providerMode,
    modelId: event.modelId ?? existing?.modelId,
    updatedAt: now
  };
  record.slots = existing
    ? record.slots.map((slot) => slot.callId === event.callId ? nextSlot : slot)
    : [...record.slots, nextSlot];
  record.expectedCalls = Math.max(record.expectedCalls, event.expectedCalls);
  record.callsAttempted = record.slots.filter((slot) =>
    ["running", "request_artifact_written", "response_artifact_written", "accepted", "repaired", "rejected", "fallback", "provider_error"].includes(slot.status)
  ).length;
  record.currentStep = `${event.phaseId} / ${event.agentId} / ${event.status}`;
  record.latestEvent = event.message ?? `${event.agentId}: ${event.status}`;
}

function materializeLiveRunStatus(record: LiveRunRecord): HexMatchLabLiveRunStatus {
  const elapsedMs = (record.completedAt ? Date.parse(record.completedAt) : Date.now()) - record.startedAtMs;
  return {
    runId: record.runId,
    status: record.status,
    mapGameId: record.mapGameId,
    currentStep: record.currentStep,
    latestEvent: record.latestEvent,
    latestError: record.latestError,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    elapsedMs: Math.max(0, elapsedMs),
    callsAttempted: record.callsAttempted,
    expectedCalls: record.expectedCalls,
    slots: [...record.slots].sort((a, b) => a.phaseIndex - b.phaseIndex || a.callIndex - b.callIndex || a.agentId.localeCompare(b.agentId)),
    progress: record.progress
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
    compactRequestCount: audits.filter((audit) => audit.requestSizeMetrics?.compactRequestCharLength).length,
    languageMismatchCount: audits.filter((audit) => audit.languageMismatch).length,
    semanticLanguages: uniqueStrings(audits.map((audit) => audit.semanticLanguage)),
    averageRequestReductionRatio: averageNumbers(audits.map((audit) => audit.requestSizeMetrics?.estimatedReductionRatio)),
    promptTokenTotal: sumNumbers(audits.map((audit) => audit.requestSizeMetrics?.providerPromptTokens)),
    repairedFields: uniqueStrings(audits.flatMap((audit) => audit.repairedFields ?? [])),
    fallbackReasons: uniqueStrings(audits.map((audit) => audit.fallbackReason)),
    providerErrors: uniqueStrings(audits.flatMap((audit) => audit.errors).filter((error) => error.startsWith("provider_error")))
  };
}

function buildPlayerCards(input: {
  agents: HexRoundTrace["phases"][number]["memoryAfter"]["agents"];
  actions: HexMatchLabActionSummary[];
  asset: HexMapAsset;
  economySummary: HexMatchLabEconomySummary[];
  agentIdentities: Map<string, AgentIdentity>;
  kdaByAgent: Map<string, HexKdaStat>;
  roundKillsByAgent: Map<string, number>;
  isSetupPhase?: boolean | undefined;
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
      displayName: input.agentIdentities.get(agent.agentId)?.displayName,
      roleLabel: input.agentIdentities.get(agent.agentId)?.roleLabel ?? "role unknown",
      kda: formatKda(input.kdaByAgent.get(agent.agentId)),
      roundKills: input.roundKillsByAgent.get(agent.agentId) ?? 0,
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
      dropReceived: economy?.dropReceived,
      tokenBankBefore: economy?.tokenBankBefore,
      tokenBankAfterDrop: economy?.tokenBankAfterDrop,
      currentEconomy: economy?.currentEconomy,
      economyBalance: selectEconomyBalance(economy, Boolean(input.isSetupPhase)),
      spend: economy?.spend
    };
  });
}

function selectEconomyBalance(
  economy: HexMatchLabEconomySummary["agents"][number] | undefined,
  isSetupPhase: boolean
): number | undefined {
  if (!economy) {
    return undefined;
  }
  if (isSetupPhase) {
    return economy.tokenBankBefore ?? economy.tokenBankAfterDrop ?? economy.currentEconomy;
  }
  if (typeof economy.currentEconomy === "number") {
    return economy.currentEconomy;
  }
  if (typeof economy.tokenBankAfterDrop === "number" && typeof economy.spend === "number") {
    return Math.max(0, economy.tokenBankAfterDrop - economy.spend);
  }
  return economy.tokenBankAfterDrop ?? economy.tokenBankBefore;
}

interface HexKdaStat {
  kills: number;
  deaths: number;
  assists: number;
}

function buildKdaByAgent(phases: HexRoundTrace["phases"]): Map<string, HexKdaStat> {
  const stats = new Map<string, HexKdaStat>();
  const killedAgents = new Set<string>();
  for (const phase of phases) {
    for (const resolution of phase.combatResolutions) {
      for (const casualty of resolution.casualties) {
        if (casualty.result !== "killed") {
          continue;
        }
        if (killedAgents.has(casualty.agentId)) {
          continue;
        }
        killedAgents.add(casualty.agentId);
        addKda(stats, casualty.agentId, "deaths");
        const killerAgentId = readString(casualty.killerAgentId);
        if (killerAgentId) {
          addKda(stats, killerAgentId, "kills");
        }
        for (const assisterAgentId of casualty.assisterAgentIds ?? []) {
          addKda(stats, assisterAgentId, "assists");
        }
      }
    }
  }
  return stats;
}

function buildKillCountsByAgent(phases: HexRoundTrace["phases"]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [agentId, stat] of buildKdaByAgent(phases)) {
    if (stat.kills > 0) {
      counts.set(agentId, stat.kills);
    }
  }
  return counts;
}

function mergeKdaStats(left: Map<string, HexKdaStat>, right: Map<string, HexKdaStat>): Map<string, HexKdaStat> {
  const merged = cloneKdaStats(left);
  mergeKdaInto(merged, right);
  return merged;
}

function mergeKdaInto(target: Map<string, HexKdaStat>, source: Map<string, HexKdaStat>): void {
  for (const [agentId, stat] of source) {
    const current = target.get(agentId) ?? { kills: 0, deaths: 0, assists: 0 };
    target.set(agentId, {
      kills: current.kills + stat.kills,
      deaths: current.deaths + stat.deaths,
      assists: current.assists + stat.assists
    });
  }
}

function cloneKdaStats(stats: Map<string, HexKdaStat>): Map<string, HexKdaStat> {
  const cloned = new Map<string, HexKdaStat>();
  for (const [agentId, stat] of stats) {
    cloned.set(agentId, { ...stat });
  }
  return cloned;
}

function addKda(stats: Map<string, HexKdaStat>, agentId: string, key: keyof HexKdaStat): void {
  const current = stats.get(agentId) ?? { kills: 0, deaths: 0, assists: 0 };
  current[key] += 1;
  stats.set(agentId, current);
}

function formatKda(stat: HexKdaStat | undefined): string {
  return stat ? `${stat.kills}/${stat.deaths}/${stat.assists}` : "0/0/0";
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
      spend: agent.spend,
      dropSent: agent.dropSent,
      dropReceived: agent.dropReceived,
      tokenBankBefore: agent.tokenBankBefore,
      tokenBankAfterDrop: agent.tokenBankAfterDrop,
      currentEconomy: agent.tokenBankAfterSpend
    }))
  }));
}

function readAgentIdentities(repositories: SqliteRepositoryBundle, matchId: string): Map<string, AgentIdentity> {
  const rows = repositories.sqlite.prepare(
    `SELECT
       a.id,
       a.display_name AS displayName,
       a.role AS role,
       a.secondary_roles_json AS secondaryRolesJson,
       a.role_profile_json AS roleProfileJson,
       a.base_profile_json AS baseProfileJson
     FROM agents a
     JOIN matches m ON a.team_id IN (m.team_a_id, m.team_b_id)
     WHERE m.id = ?`
  ).all(matchId) as Row[];
  return new Map(rows.map((row) => {
    const agentId = String(row.id);
    return [agentId, {
      displayName: String(row.displayName ?? agentId),
      roleLabel: deriveRoleLabel(row)
    }] as const;
  }));
}

function deriveRoleLabel(row: Row): string {
  return normalizeRoleLabel(row.role)
    ?? normalizeRoleLabelFromJson(row.secondaryRolesJson)
    ?? normalizeRoleLabelFromJson(row.roleProfileJson)
    ?? normalizeRoleLabelFromJson(row.baseProfileJson)
    ?? "role unknown";
}

function normalizeRoleLabelFromJson(value: unknown): string | undefined {
  const text = readString(value);
  if (!text) return undefined;
  try {
    return findRoleLabelInValue(JSON.parse(text));
  } catch {
    return normalizeRoleLabel(text);
  }
}

function findRoleLabelInValue(value: unknown): string | undefined {
  const direct = normalizeRoleLabel(value);
  if (direct) return direct;
  if (Array.isArray(value)) {
    for (const item of value) {
      const role = findRoleLabelInValue(item);
      if (role) return role;
    }
  }
  const record = parseRecord(value);
  if (record) {
    for (const item of Object.values(record)) {
      const role = findRoleLabelInValue(item);
      if (role) return role;
    }
  }
  return undefined;
}

function normalizeRoleLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.toLowerCase();
  if (text.includes("igl") || text.includes("leader") || text.includes("caller")) return "IGL";
  if (text.includes("awp") || text.includes("sniper")) return "AWPer";
  if (text.includes("entry") || text.includes("opener")) return "entry";
  if (text.includes("support") || text.includes("utility")) return "support";
  if (text.includes("anchor") || text.includes("site hold")) return "anchor";
  if (text.includes("star")) return "star rifler";
  if (text.includes("rif")) return "rifler";
  return undefined;
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
  if (/no.*active.*dust2|没有找到可运行|没有可运行/i.test(technicalDetails)) {
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

function averageNumbers(values: Array<number | undefined>): number | undefined {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (numbers.length === 0) {
    return undefined;
  }
  return Number((numbers.reduce((sum, value) => sum + value, 0) / numbers.length).toFixed(4));
}

function sumNumbers(values: Array<number | undefined>): number | undefined {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (numbers.length === 0) {
    return undefined;
  }
  return numbers.reduce((sum, value) => sum + value, 0);
}

function isInsideDirectory(targetPath: string, parentPath: string): boolean {
  const normalizedTarget = resolve(targetPath).toLowerCase();
  const normalizedParent = resolve(parentPath).toLowerCase();
  return normalizedTarget === normalizedParent || normalizedTarget.startsWith(`${normalizedParent}\\`);
}
