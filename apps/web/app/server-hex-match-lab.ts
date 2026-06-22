import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import {
  buildHexAgentEvidenceSlices,
  commitDust2HexRoundExperimental,
  loadOfficialDust2HexMap,
  runDust2HexMapExperimental,
  type HexAgentEvidenceSlice,
  type HexAgentCommandProgressEvent,
  type HexFinanceAllowedStance,
  type HexMapExperimentalSummary,
  type HexRoundFinanceDuel,
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
  commitStatus?: "committed" | "invalid_round" | undefined;
  reportId?: string | undefined;
  winnerTeamId?: string | undefined;
  roundWinType?: string | undefined;
  scoreAfterRound?: ScorePair | undefined;
  hexTraceArtifactId?: string | undefined;
  fallbackCount: number;
  combatResolutionCount: number;
  finalHardCondition?: HexMatchLabHardConditionSummary | undefined;
  roundQualityStatus?: string | undefined;
  roundQualityReasons?: string[] | undefined;
  roundQualitySummaryZh?: string | undefined;
  roundQualityCounts?: Record<string, number> | undefined;
  tacticalAudit?: HexMatchLabTacticalAuditSummary | undefined;
}

export interface HexMatchLabRoundTraceDetail extends HexMatchLabRoundSummary {
  source: "hex_round_engine_committed";
  roundStartAgentOutputs: HexMatchLabRoundStartAgentOutput[];
  phaseSummaries: HexMatchLabPhaseSummary[];
  audit: HexMatchLabLlmAuditSummary;
  economySummary: HexMatchLabEconomySummary[];
  humanAudit?: HexMatchLabHumanAudit | undefined;
  financeDuel?: HexMatchLabFinanceDuelSummary | undefined;
  financeReview?: HexMatchLabFinanceReview | undefined;
  businessDuel?: HexMatchLabBusinessDuelSummary | undefined;
  businessReview?: HexMatchLabBusinessReview | undefined;
}

export interface HexMatchLabHumanAudit {
  roundStoryZh: string;
  decisionQuestionZh?: string | undefined;
  allowedStanceZh?: string[] | undefined;
  requiredEvidenceSchemaZh?: string[] | undefined;
  challengePolicyZh?: string | undefined;
  defenseSummaryZh: string;
  attackSummaryZh: string;
  evidenceBoundaryZh: string;
  roundValidationSummaryZh: string;
  sampleQualityWarningsZh: string[];
  winnerSummaryZh?: string | undefined;
  roundStartOutputDigests: HexMatchLabRoundStartAgentOutput[];
  roundStartOutputFailures: HexMatchLabRoundStartAgentOutput[];
  agentOutputDigests: HexMatchLabAgentOutputDigest[];
  agentOpeningBriefs: HexMatchLabHumanAgentOpeningBrief[];
  phaseStories: HexMatchLabHumanPhaseStory[];
  technicalRefs: {
    requestArtifactIds: string[];
    responseArtifactIds: string[];
    rawReasonCount: number;
  };
}

export interface HexMatchLabRoundStartAgentOutput {
  outputId: string;
  agentId: string;
  displayName: string;
  teamSide?: string | undefined;
  financeRole?: string | undefined;
  financeRoleCn?: string | undefined;
  buyType?: string | undefined;
  resourceTier?: string | undefined;
  source: string;
  usableForPhaseAction: boolean;
  requestArtifactId?: string | undefined;
  responseArtifactId?: string | undefined;
  rawOutputSummaryZh: string;
  openingStatementZh: string;
  cardKind?: "stance" | "challenge" | undefined;
  cardSummaryZh?: string | undefined;
  allowedPhaseRefs?: {
    claimIds: string[];
    challengeIds: string[];
  } | undefined;
  stanceCard?: HexMatchLabFinanceStanceCard | undefined;
  challengeCard?: HexMatchLabFinanceChallengeCard | undefined;
  evidenceRefs: string[];
  riskBoundaryZh: string;
  buyConstraintAppliedZh: string;
  phaseActionCarryoverZh: string;
  normalizationSummaryZh: string;
  validationSummaryZh: string;
  technicalRefs: {
    rawTextPreview?: string | undefined;
    rawDraftPreview?: string | undefined;
    normalizedDraftPreview?: string | undefined;
    errors: string[];
    repairedFields: string[];
    providerMode?: string | undefined;
    modelId?: string | undefined;
  };
}

export interface HexMatchLabFinanceCoreClaim {
  claimId: string;
  claimType: string;
  claimZh: string;
  evidenceRefs: string[];
  reasoningBridge: string;
  confidence: number;
  unsupportedIfEvidenceRejected: boolean;
}

export interface HexMatchLabFinanceStanceCard {
  cardId: string;
  agentId: string;
  teamSide: string;
  decisionQuestionZh: string;
  direction: string;
  target: string;
  horizon: string;
  confidence: number;
  positionSuggestion: string;
  coreClaims: HexMatchLabFinanceCoreClaim[];
  riskBoundaries: string[];
  invalidatingConditions: string[];
  auditSummaryZh: string;
}

export interface HexMatchLabFinanceChallenge {
  challengeId: string;
  targetClaimId: string;
  challengeType: string;
  evidenceRefs: string[];
  challengeReasonZh: string;
  expectedEffect: string;
}

export interface HexMatchLabFinanceChallengeCard {
  cardId: string;
  agentId: string;
  teamSide: string;
  targetClaimId: string;
  challengeType: string;
  challengedAssumption: string;
  evidenceRefs: string[];
  proxyMismatch: string;
  confidenceReduction: number;
  challenges: HexMatchLabFinanceChallenge[];
  auditSummaryZh: string;
}

export interface HexMatchLabAgentOutputDigest {
  agentId: string;
  displayName: string;
  teamSide?: string | undefined;
  phaseIndex: number;
  phaseLabel?: string | undefined;
  source: "llm_response_artifact" | "missing_response_artifact" | "provider_error" | "fixture_response" | "old_trace_missing";
  responseArtifactId?: string | undefined;
  requestArtifactId?: string | undefined;
  rawOutputSummaryZh: string;
  declaredActionZh: string;
  declaredReasonZh: string;
  declaredEvidenceRefs: string[];
  declaredRiskNotesZh: string[];
  semanticLanguageSummaryZh: string;
  normalizationSummaryZh: string;
  validationSummaryZh: string;
  judgeAdoptionSummaryZh: string;
  technicalRefs: {
    actionType?: string | undefined;
    targetCellId?: string | undefined;
    briefRefId?: string | undefined;
    roundStartOutputId?: string | undefined;
    phase0RefId?: string | undefined;
    rawTextPreview?: string | undefined;
    rawDraftPreview?: string | undefined;
    normalizedDraftPreview?: string | undefined;
    responseReadError?: string | undefined;
  };
}

export interface HexMatchLabHumanAgentOpeningBrief {
  briefId: string;
  agentId: string;
  displayName: string;
  teamSide: string;
  role: string;
  financeRole?: string | undefined;
  financeRoleCn?: string | undefined;
  sliceId?: string | undefined;
  roleQuestionZh?: string | undefined;
  usableFactsZh: string[];
  evidenceRefs: string[];
  missingEvidenceZh: string[];
  scoreCapRefs: string[];
  roleFallbackReason?: string | undefined;
  roundTaskZh: string;
  proofOrChallengeZh: string;
  evidenceBoundaryZh: string;
  buyConstraintZh: string;
  actionHintZh: string;
}

export interface HexMatchLabHumanPhaseStory {
  phaseId: string;
  phaseIndex: number;
  phaseLabel?: string | undefined;
  summaryZh: string;
  phaseValidationSummaryZh: string;
  actionStories: HexMatchLabHumanActionStory[];
  combatStories: HexMatchLabHumanCombatStory[];
}

export interface HexMatchLabHumanActionStory {
  agentId: string;
  displayName: string;
  actionSummaryZh: string;
  openingBriefRef?: string | undefined;
  roundStartOutputRef?: string | undefined;
  phase0Ref?: string | undefined;
  repairSummaryZh?: string | undefined;
  technicalRefs: {
    targetCellId?: string | undefined;
    requestArtifactId?: string | undefined;
    responseArtifactId?: string | undefined;
    roundStartOutputId?: string | undefined;
    phase0RefId?: string | undefined;
    validationErrors: string[];
    repairedFields: string[];
  };
}

export interface HexMatchLabHumanCombatStory {
  contactId: string;
  verdictZh: string;
  contactThreatZh?: string | undefined;
  impactZh: string;
  reasonsZh: string[];
  acceptedEvidenceZh: string[];
  rejectedEvidenceZh: string[];
  missingEvidenceZh: string[];
  financeReasonZh: string[];
  csReasonZh: string[];
  technicalRefs: {
    participants: string[];
    rawFinanceVerdict?: string | undefined;
    rawBusinessVerdict?: string | undefined;
    rawReasons: string[];
  };
}

export interface HexMatchLabFinanceDuelSummary {
  roundNumber: number;
  topicKey: string;
  topicTitle: string;
  decisionQuestion?: {
    question: string;
    decisionObject: string;
    horizon: string;
    benchmark: string;
    allowedStance: HexFinanceAllowedStance[];
    requiredOutput: string[];
    requiredEvidenceSchema: Array<{
      requiredKey: string;
      requiredForClaimTypes: string[];
      minimumFactCount: number;
      preferredSources: string[];
      fallbackSources: string[];
      missingEffect: string;
      notWinCondition: true;
    }>;
    challengePolicy: {
      mustTargetClaimId: true;
      allowedChallengeTypes: string[];
      invalidChallengePatterns: string[];
      missingEvidenceCanOnlyCap: true;
    };
  } | undefined;
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
  repairedFields: string[];
  businessIntent?: string | undefined;
  briefRefId?: string | undefined;
  roundStartOutputId?: string | undefined;
  phase0RefId?: string | undefined;
  actionRationaleZh?: string | undefined;
  requestArtifactId?: string | undefined;
  responseArtifactId?: string | undefined;
}

export interface HexMatchLabCombatSummary {
  contactId: string;
  participants: string[];
  advantage?: string | undefined;
  verdict?: string | undefined;
  contactThreatLevel?: string | undefined;
  lethalEligible?: boolean | undefined;
  lethalGateReasons: string[];
  lethalGateBlockedReasons: string[];
  lineOfFireExposure?: boolean | undefined;
  openSightNoCover?: boolean | undefined;
  samePointExposure?: boolean | undefined;
  objectiveExposure?: boolean | undefined;
  implicitDuelFromMovement?: boolean | undefined;
  coverBlockedLethal?: boolean | undefined;
  businessVerdict?: string | undefined;
  financeVerdict?: string | undefined;
  businessReasons: string[];
  financeReasons: string[];
  csReasons: string[];
  financeEvidenceAdoption?: HexMatchLabFinanceEvidenceAdoptionSummary | undefined;
  financeProjection?: HexMatchLabFinanceProjectionSummary | undefined;
  financeReasonZh: string[];
  csReasonZh: string[];
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

export interface HexMatchLabFinanceProjectionSummary {
  financialResult: string;
  combatEffectAllowed: string[];
  appliedEffect: string;
  blockedEffects: string[];
  projectionReasons: string[];
  projectionReasonsZh: string[];
  financeMayExplainKill: boolean;
  financeMayApplyPressure: boolean;
  financeMayForceReposition: boolean;
  financeMayApplyMapControl: boolean;
}
export interface HexMatchLabFinanceEvidenceAdoptionSummary {
  attack: HexMatchLabFinanceEvidenceAdoptionSideSummary;
  defense: HexMatchLabFinanceEvidenceAdoptionSideSummary;
}

export interface HexMatchLabFinanceEvidenceAdoptionSideSummary {
  side: string;
  acceptedEvidenceRefs: string[];
  rejectedEvidenceRefs: string[];
  missingEvidenceApplied: string[];
  scoreCapRefs: string[];
  scoreCaps: Array<{ condition: string; reason: string; maxScore?: number | undefined }>;
  acceptedClaims: string[];
  rejectedClaims: string[];
  acceptedChallenges: string[];
  rejectedChallenges: string[];
  sideScore?: number | undefined;
  stanceScore?: number | undefined;
  challengeScore?: number | undefined;
  financialResult?: string | undefined;
  combatEffectAllowed: string[];
  adoptionReasons: string[];
  rejectionReasons: string[];
  financeReasonZh: string[];
  auditReasons: string[];
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

export interface HexMatchLabTacticalAuditSummary {
  selectedVariant?: string | undefined;
  selectedAttackVariant?: string | undefined;
  selectedDefenseVariant?: string | undefined;
  c4SitePreference?: string | undefined;
  selectionReasons: string[];
  previousRoundSignals: string[];
  antiRepeatPenalties: string[];
  antiRepeatRegions: string[];
  antiRepeatPoints: string[];
  economyAdjustment: string[];
  routeDiversityWarnings: string[];
  attackFocusRegions: string[];
  defenseFocusRegions: string[];
  attackAvoidRegions: string[];
  defenseAvoidRegions: string[];
  roleRouteAssignments: Array<{
    side?: string | undefined;
    role?: string | undefined;
    routeIntent?: string | undefined;
    focusRegions: string[];
    focusPoints: string[];
    avoidRegions?: string[] | undefined;
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
  roundQualityStatus?: string | undefined;
  roundQualityReasons?: string[] | undefined;
  roundQualitySummaryZh?: string | undefined;
  roundQualityCounts?: Record<string, number> | undefined;
  tacticalAudit?: HexMatchLabTacticalAuditSummary | undefined;
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

interface HexLlmResponseArtifactSummary {
  artifactId: string;
  callId?: string | undefined;
  source: "llm_response_artifact" | "fixture_response" | "old_trace_missing";
  rawTextPreview?: string | undefined;
  rawDraft?: Record<string, unknown> | undefined;
  normalizedDraft?: Record<string, unknown> | undefined;
  normalizedErrors: string[];
  normalizedRepairedFields: string[];
  semanticLanguage?: string | undefined;
  languageMismatch?: boolean | undefined;
  inspectedSemanticFields: string[];
  readError?: string | undefined;
}

interface ReadProgressInput {
  mapGameId?: string | null;
  summaryArtifactId?: string | null;
  roundTraceArtifactId?: string | null;
  includeMapAsset?: boolean | null;
}

type Row = Record<string, unknown>;

type HexRoundTraceArtifactSummary = {
  artifactId: string;
  roundId: string;
  roundNumber: number;
  roundStatus?: string | undefined;
  createdAt: string;
};
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
  const roundTraceArtifacts = listRoundTraceArtifactSummaries(input.repositories, mapGame.id);
  const roundSummaries = buildRoundSummaries({
    ...(mapSummary?.summary ? { summary: mapSummary.summary } : {}),
    ...(summaryArtifactId ? { summaryArtifactId } : {}),
    reports: roundReports,
    traceArtifacts: roundTraceArtifacts
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

function listRoundTraceArtifactSummaries(repositories: SqliteRepositoryBundle, mapGameId: string): HexRoundTraceArtifactSummary[] {
  const rows = repositories.sqlite
    .prepare(
      `SELECT
         a.id AS artifactId,
         a.round_id AS roundId,
         a.created_at AS createdAt,
         r.round_number AS roundNumber,
         r.status AS roundStatus
       FROM artifacts a
       LEFT JOIN rounds r ON r.id = a.round_id
       WHERE a.map_game_id = ?
         AND a.artifact_type = 'hex_round_trace'
       ORDER BY COALESCE(r.round_number, 0) ASC, a.created_at ASC, a.id ASC`
    )
    .all(mapGameId) as Row[];
  return rows
    .filter((row) => row.artifactId && row.roundId)
    .map((row) => ({
      artifactId: String(row.artifactId),
      roundId: String(row.roundId),
      roundNumber: Number(row.roundNumber ?? 0),
      roundStatus: readString(row.roundStatus),
      createdAt: String(row.createdAt ?? "")
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
    const llmResponseArtifacts = await readHexLlmResponseArtifactSummaries(repositories, projectRoot, trace);
    return summarizeTrace(artifactId, trace, fallbackSummary, loadOfficialDust2HexMap(), agentIdentities, preRoundKda, llmResponseArtifacts);
  } catch {
    return undefined;
  }
}

async function readHexLlmResponseArtifactSummaries(
  repositories: SqliteRepositoryBundle,
  projectRoot: string,
  trace: HexRoundTrace
): Promise<Map<string, HexLlmResponseArtifactSummary>> {
  const responseArtifactIds = uniqueStrings(trace.phases.flatMap((phase) =>
    phase.commandResult.audits.map((audit) => audit.responseArtifactId)
  ));
  const summaries = new Map<string, HexLlmResponseArtifactSummary>();
  for (const artifactId of responseArtifactIds) {
    try {
      const parsed = JSON.parse(await readArtifactText(repositories, projectRoot, artifactId)) as unknown;
      summaries.set(artifactId, summarizeHexLlmResponseArtifact(artifactId, parsed));
    } catch (error) {
      summaries.set(artifactId, {
        artifactId,
        source: "old_trace_missing",
        normalizedErrors: [],
        normalizedRepairedFields: [],
        inspectedSemanticFields: [],
        readError: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return summaries;
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
  traceArtifacts: HexRoundTraceArtifactSummary[];
}): HexMatchLabRoundSummary[] {
  const byArtifactId = new Map<string, HexMatchLabRoundSummary>();
  const byRoundId = new Map<string, HexMatchLabRoundSummary>();

  for (const round of input.summary?.rounds ?? []) {
    const summary: HexMatchLabRoundSummary = {
      roundNumber: round.roundNumber,
      roundId: round.roundId,
      commitStatus: round.commitStatus,
      reportId: round.reportId,
      winnerTeamId: round.winnerTeamId,
      roundWinType: round.roundWinType,
      scoreAfterRound: round.scoreAfterRound,
      hexTraceArtifactId: round.hexTraceArtifactId,
      fallbackCount: round.fallbackCount,
      combatResolutionCount: round.combatResolutionCount,
      finalHardCondition: summarizeHardCondition(round.finalWinCondition),
      roundQualityStatus: round.roundQualityStatus,
      roundQualityReasons: round.roundQualityReasons,
      roundQualitySummaryZh: round.roundQualitySummaryZh
    };
    byArtifactId.set(round.hexTraceArtifactId, summary);
    byRoundId.set(round.roundId, summary);
  }

  for (const report of input.reports) {
    const traceReference = getRoundTraceReference(report);
    if (!traceReference) {
      continue;
    }
    if (byArtifactId.has(traceReference.traceArtifactId) || byRoundId.has(report.roundId)) {
      continue;
    }
    const summary: HexMatchLabRoundSummary = {
      roundNumber: report.roundNumber,
      roundId: report.roundId,
      commitStatus: "committed",
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
    };
    byArtifactId.set(traceReference.traceArtifactId, summary);
    byRoundId.set(report.roundId, summary);
  }

  for (const artifact of input.traceArtifacts) {
    if (byArtifactId.has(artifact.artifactId)) {
      continue;
    }
    const summary: HexMatchLabRoundSummary = {
      roundNumber: artifact.roundNumber,
      roundId: artifact.roundId,
      commitStatus: artifact.roundStatus === "failed" ? "invalid_round" : undefined,
      hexTraceArtifactId: artifact.artifactId,
      fallbackCount: 0,
      combatResolutionCount: 0,
      roundQualityStatus: artifact.roundStatus === "failed" ? "invalid_round" : undefined,
      roundQualitySummaryZh: artifact.roundStatus === "failed" ? "本 round 未通过质量闸门；打开 trace 查看具体原因。" : undefined
    };
    byArtifactId.set(artifact.artifactId, summary);
  }

  return [...byArtifactId.values()].sort((left, right) => left.roundNumber - right.roundNumber || (left.hexTraceArtifactId ?? "").localeCompare(right.hexTraceArtifactId ?? ""));
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
  preRoundKdaByAgent: Map<string, HexKdaStat>,
  llmResponseArtifacts: Map<string, HexLlmResponseArtifactSummary>
): HexMatchLabRoundTraceDetail {
  const roundSummary: HexMatchLabRoundSummary = fallbackSummary ?? {
    roundNumber: trace.roundNumber,
    roundId: trace.roundId,
    hexTraceArtifactId: artifactId,
    fallbackCount: trace.audit.fallbackCount,
    combatResolutionCount: trace.audit.combatResolutionCount,
    finalHardCondition: summarizeHardCondition(trace.finalWinCondition),
    roundQualityStatus: trace.audit.roundQualityStatus,
    roundQualityReasons: trace.audit.roundQualityReasons,
    roundQualitySummaryZh: trace.audit.roundQualitySummaryZh,
    roundQualityCounts: trace.audit.roundQualityCounts
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
  const audit = summarizeTraceAudit(trace);
  const roundStartAgentOutputs = summarizeRoundStartAgentOutputs(trace, agentIdentities);
  return {
    ...roundSummary,
    fallbackCount: trace.audit.fallbackCount,
    combatResolutionCount: trace.audit.combatResolutionCount,
    finalHardCondition: summarizeHardCondition(trace.finalWinCondition),
    hexTraceArtifactId: artifactId,
    roundQualityStatus: audit.roundQualityStatus,
    roundQualityReasons: audit.roundQualityReasons,
    roundQualitySummaryZh: audit.roundQualitySummaryZh,
    roundQualityCounts: audit.roundQualityCounts,
    source: "hex_round_engine_committed",
    roundStartAgentOutputs,
    phaseSummaries,
    audit,
    economySummary,
    humanAudit: financeDuel
      ? buildHumanAudit({
        financeDuel,
        phaseSummaries,
        finalHardCondition,
        economySummary,
        agentIdentities,
        audit,
        llmResponseArtifacts,
        roundStartAgentOutputs
      })
      : undefined,
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
    roundNumber: duel.roundNumber,
    topicKey: duel.topic.roundKey,
    topicTitle: duel.topic.topicTitle,
    decisionQuestion: duel.decisionQuestion ? {
      question: duel.decisionQuestion.question,
      decisionObject: duel.decisionQuestion.decisionObject,
      horizon: duel.decisionQuestion.horizon,
      benchmark: duel.decisionQuestion.benchmark,
      allowedStance: [...duel.decisionQuestion.allowedStance],
      requiredOutput: [...duel.decisionQuestion.requiredOutput],
      requiredEvidenceSchema: duel.decisionQuestion.requiredEvidenceSchema.map((item) => ({ ...item })),
      challengePolicy: {
        mustTargetClaimId: duel.decisionQuestion.challengePolicy.mustTargetClaimId,
        allowedChallengeTypes: [...duel.decisionQuestion.challengePolicy.allowedChallengeTypes],
        invalidChallengePatterns: [...duel.decisionQuestion.challengePolicy.invalidChallengePatterns],
        missingEvidenceCanOnlyCap: duel.decisionQuestion.challengePolicy.missingEvidenceCanOnlyCap
      }
    } : undefined,
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

function summarizeRoundStartAgentOutputs(
  trace: HexRoundTrace,
  agentIdentities: Map<string, AgentIdentity>
): HexMatchLabRoundStartAgentOutput[] {
  const outputs = Array.isArray(trace.roundStartAgentOutputs) ? trace.roundStartAgentOutputs : [];
  return outputs.map((rawOutput) => {
    const output = rawOutput as typeof rawOutput & {
      cardKind?: "stance" | "challenge" | undefined;
      cardSummaryZh?: string | undefined;
      allowedPhaseRefs?: { claimIds: string[]; challengeIds: string[] } | undefined;
      stanceCard?: HexMatchLabFinanceStanceCard | undefined;
      challengeCard?: HexMatchLabFinanceChallengeCard | undefined;
    };
    return {
      outputId: output.outputId,
      agentId: output.agentId,
      displayName: output.displayName || formatAgentName(output.agentId, agentIdentities),
      teamSide: output.teamSide === "defense" ? "守方" : output.teamSide === "attack" ? "攻方" : output.teamSide,
      financeRole: output.financeRole,
      financeRoleCn: output.financeRoleCn,
      buyType: output.buyType,
      resourceTier: output.resourceTier,
      source: output.source,
      usableForPhaseAction: isUsableHexMatchLabRoundStartOutputSource(output),
      requestArtifactId: output.requestArtifactId,
      responseArtifactId: output.responseArtifactId,
      rawOutputSummaryZh: output.rawOutputSummaryZh,
      openingStatementZh: output.openingStatementZh,
      cardKind: output.cardKind,
      cardSummaryZh: output.cardSummaryZh,
      allowedPhaseRefs: output.allowedPhaseRefs
      ? {
          claimIds: [...output.allowedPhaseRefs.claimIds],
          challengeIds: [...output.allowedPhaseRefs.challengeIds]
        }
      : undefined,
      stanceCard: output.stanceCard,
      challengeCard: output.challengeCard,
      evidenceRefs: [...output.evidenceRefs],
      riskBoundaryZh: output.riskBoundaryZh,
      buyConstraintAppliedZh: output.buyConstraintAppliedZh,
      phaseActionCarryoverZh: output.phaseActionCarryoverZh,
      normalizationSummaryZh: output.normalizationSummaryZh,
      validationSummaryZh: output.validationSummaryZh,
      technicalRefs: {
        rawTextPreview: output.technicalRefs.rawTextPreview,
        rawDraftPreview: output.technicalRefs.rawDraftPreview,
        normalizedDraftPreview: output.technicalRefs.normalizedDraftPreview,
        errors: [...output.technicalRefs.errors],
        repairedFields: [...output.technicalRefs.repairedFields],
        providerMode: output.technicalRefs.providerMode,
        modelId: output.technicalRefs.modelId
      }
    };
  });
}

function isUsableHexMatchLabRoundStartOutput(output: HexMatchLabRoundStartAgentOutput): boolean {
  return isUsableHexMatchLabRoundStartOutputSource(output);
}

function isUsableHexMatchLabRoundStartOutputSource(output: {
  source?: string | undefined;
  usableForPhaseAction?: boolean | undefined;
  cardKind?: string | undefined;
  allowedPhaseRefs?: { claimIds?: string[] | undefined; challengeIds?: string[] | undefined } | undefined;
}): boolean {
  return output.usableForPhaseAction === true
    && (output.source === "fixture_response" || output.source === "llm_response_artifact")
    && (output.cardKind === "stance" || output.cardKind === "challenge")
    && Boolean(output.allowedPhaseRefs);
}

function buildHumanAudit(input: {
  financeDuel: HexMatchLabFinanceDuelSummary;
  phaseSummaries: HexMatchLabPhaseSummary[];
  finalHardCondition?: HexMatchLabHardConditionSummary | undefined;
  economySummary: HexMatchLabEconomySummary[];
  agentIdentities: Map<string, AgentIdentity>;
  audit: HexMatchLabLlmAuditSummary;
  llmResponseArtifacts: Map<string, HexLlmResponseArtifactSummary>;
  roundStartAgentOutputs: HexMatchLabRoundStartAgentOutput[];
}): HexMatchLabHumanAudit {
  const openingBriefs = buildHumanAgentOpeningBriefs(input.financeDuel, input.economySummary, input.agentIdentities);
  const openingBriefsByAgentId = new Map(openingBriefs.map((brief) => [brief.agentId, brief]));
  const usableRoundStartOutputs = input.roundStartAgentOutputs.filter(isUsableHexMatchLabRoundStartOutput);
  const failedRoundStartOutputs = input.roundStartAgentOutputs.filter((output) => !isUsableHexMatchLabRoundStartOutput(output));
  const roundStartOutputsByOutputId = new Map(usableRoundStartOutputs.map((output) => [output.outputId, output]));
  const rawReasonCount = input.phaseSummaries.reduce(
    (sum, phase) => sum + phase.combats.reduce((inner, combat) => inner + combat.financeReasons.length + combat.csReasons.length + combat.businessReasons.length, 0),
    0
  );
  const sampleQualityWarningsZh = buildHumanSampleQualityWarnings({
    phaseSummaries: input.phaseSummaries,
    audit: input.audit,
    openingBriefs,
    roundStartAgentOutputs: usableRoundStartOutputs,
    failedRoundStartOutputCount: failedRoundStartOutputs.length,
    finalHardCondition: input.finalHardCondition
  });
  return {
    roundStoryZh: input.financeDuel.decisionQuestion
      ? `本 round 决策题：${input.financeDuel.decisionQuestion.question}`
      : `旧 trace 未记录 N56 决策题契约；旧小主题：${input.financeDuel.topicTitle}。`,
    decisionQuestionZh: input.financeDuel.decisionQuestion?.question,
    allowedStanceZh: input.financeDuel.decisionQuestion?.allowedStance.map(formatAllowedStanceZh),
    requiredEvidenceSchemaZh: input.financeDuel.decisionQuestion?.requiredEvidenceSchema.map((item) =>
      `${item.requiredKey}：至少 ${item.minimumFactCount} 条；缺失影响：${item.missingEffect}`
    ),
    challengePolicyZh: input.financeDuel.decisionQuestion
      ? "挑战方必须攻击具体 claim、证据缺口、代理错配、时间窗口、推理桥或风险收益；缺失证据只能降权，不能直接赢。"
      : "旧 trace 未记录 N56 挑战规则。",
    defenseSummaryZh: `立场方任务：${input.financeDuel.defenseThesis.thesis}`,
    attackSummaryZh: `挑战方任务：${input.financeDuel.attackChallenge.thesis}`,
    evidenceBoundaryZh: buildHumanEvidenceBoundary(input.financeDuel),
    roundValidationSummaryZh: buildHumanRoundValidationSummary({
      audit: input.audit,
      phaseSummaries: input.phaseSummaries,
      openingBriefCount: openingBriefs.length,
      usableRoundStartOutputCount: usableRoundStartOutputs.length,
      failedRoundStartOutputCount: failedRoundStartOutputs.length
    }),
    sampleQualityWarningsZh,
    winnerSummaryZh: input.audit.roundQualityStatus === "invalid_round"
      ? `${input.audit.roundQualitySummaryZh ?? "本 round 未通过质量闸门。"} 未计为可信比赛结果；hard winner 仅保留在技术细节。`
      : input.finalHardCondition ? humanizeHardWinner(input.finalHardCondition) : undefined,
    roundStartOutputDigests: usableRoundStartOutputs,
    roundStartOutputFailures: failedRoundStartOutputs,
    agentOutputDigests: buildAgentOutputDigests({
      phaseSummaries: input.phaseSummaries,
      openingBriefsByAgentId,
      agentIdentities: input.agentIdentities,
      responseArtifacts: input.llmResponseArtifacts
    }),
    agentOpeningBriefs: openingBriefs,
    phaseStories: input.phaseSummaries.map((phase) => buildHumanPhaseStory(
      phase,
      openingBriefsByAgentId,
      roundStartOutputsByOutputId,
      input.agentIdentities
    )),
    technicalRefs: {
      requestArtifactIds: [...input.audit.requestArtifactIds],
      responseArtifactIds: [...input.audit.responseArtifactIds],
      rawReasonCount
    }
  };
}

function buildHumanRoundValidationSummary(input: {
  audit: HexMatchLabLlmAuditSummary;
  phaseSummaries: HexMatchLabPhaseSummary[];
  openingBriefCount: number;
  usableRoundStartOutputCount: number;
  failedRoundStartOutputCount: number;
}): string {
  const provider = input.audit.providerMode === "real"
    ? "真实 provider"
    : input.audit.providerMode ? `${input.audit.providerMode} provider` : "未记录 provider";
  if (input.audit.roundQualityStatus && input.audit.roundQualityStatus !== "valid") {
    return `样本审计：${provider}，${input.phaseSummaries.length} 个 phase，${input.usableRoundStartOutputCount} 条可消费真实 phase0 结构化卡片，${input.failedRoundStartOutputCount} 条 phase0 卡片失败。${input.audit.roundQualitySummaryZh ?? "本 round 未通过质量闸门。"}`;
  }
  const adoptionCount = input.phaseSummaries.reduce(
    (sum, phase) => sum + phase.combats.filter((combat) => combat.financeEvidenceAdoption).length,
    0
  );
  return `样本审计：${provider}，${input.phaseSummaries.length} 个 phase，${input.usableRoundStartOutputCount} 条可消费真实 phase0 结构化卡片，${input.failedRoundStartOutputCount} 条 phase0 卡片失败，${input.openingBriefCount} 张系统输入卡，${adoptionCount} 条证据采信链。`;
}

function buildHumanSampleQualityWarnings(input: {
  phaseSummaries: HexMatchLabPhaseSummary[];
  audit: HexMatchLabLlmAuditSummary;
  openingBriefs: HexMatchLabHumanAgentOpeningBrief[];
  roundStartAgentOutputs: HexMatchLabRoundStartAgentOutput[];
  failedRoundStartOutputCount: number;
  finalHardCondition?: HexMatchLabHardConditionSummary | undefined;
  roundQualityStatus?: string | undefined;
  roundQualityReasons?: string[] | undefined;
  roundQualitySummaryZh?: string | undefined;
  roundQualityCounts?: Record<string, number> | undefined;
  tacticalAudit?: HexMatchLabTacticalAuditSummary | undefined;
}): string[] {
  const warnings: string[] = [];
  if (input.audit.roundQualityStatus && input.audit.roundQualityStatus !== "valid") {
    warnings.push(`${input.audit.roundQualitySummaryZh ?? "本 round 未通过质量闸门。"} 该样本不应作为正式比赛审计或计分样本。`);
  }
  if (input.audit.providerMode !== "real") {
    warnings.push("当前样本不是 real provider，不能作为真实模型验收样本。");
  }
  if (input.roundStartAgentOutputs.length < 10) {
    warnings.push(`真实 phase0 结构化卡片不足 10 条，当前只有 ${input.roundStartAgentOutputs.length} 条。`);
  }
  if (input.failedRoundStartOutputCount > 0) {
    warnings.push(`本 round 有 ${input.failedRoundStartOutputCount} 条 phase0 卡片不可消费，需检查 round-start 审计。`);
  }
  if (input.openingBriefs.length < 10) {
    warnings.push(`开局信息卡不足 10 张，当前只有 ${input.openingBriefs.length} 张。`);
  }
  if (input.audit.providerErrors.length > 0) {
    warnings.push(`provider 失败：${input.audit.providerErrors.map(humanizeReason).join("；")}`);
  }
  if (input.audit.fallbackCount > 0) {
    warnings.push(`本 round 有 ${input.audit.fallbackCount} 个行动降级，需展开阶段行动查看原因。`);
  }
  if (input.audit.rejectedDrafts > 0) {
    warnings.push(`本 round 有 ${input.audit.rejectedDrafts} 个草案被拒绝，需检查 action / schema / evidence 约束。`);
  }
  const combats = input.phaseSummaries.flatMap((phase) => phase.combats);
  if (combats.length > 0 && combats.every((combat) => !combat.financeEvidenceAdoption)) {
    warnings.push("本 round 的战斗裁定没有记录 N53 证据采信链。");
  }
  const acceptedEvidenceCount = combats.reduce(
    (sum, combat) => sum
      + (combat.financeEvidenceAdoption?.attack.acceptedEvidenceRefs.length ?? 0)
      + (combat.financeEvidenceAdoption?.defense.acceptedEvidenceRefs.length ?? 0),
    0
  );
  if (combats.length > 0 && acceptedEvidenceCount === 0) {
    warnings.push("本 round 没有任何正向采信证据，金融裁判不能视为充分生效。");
  }
  if (!input.finalHardCondition?.isRoundOver) {
    warnings.push("本 round 尚未产生硬胜负，不能作为完整胜负验收样本。");
  }
  return warnings;
}

function summarizeHexLlmResponseArtifact(artifactId: string, value: unknown): HexLlmResponseArtifactSummary {
  const record = parseRecord(value);
  const normalized = parseRecord(record?.normalized);
  const semanticLanguageAudit = parseRecord(record?.semanticLanguageAudit);
  const providerDiagnostics = parseRecord(record?.providerDiagnostics);
  return {
    artifactId,
    callId: readString(record?.callId),
    source: readString(providerDiagnostics?.providerMode) === "fixture" ? "fixture_response" : "llm_response_artifact",
    rawTextPreview: truncateText(readString(record?.rawText), 260),
    rawDraft: readDraftRecord(record?.rawDraft),
    normalizedDraft: readDraftRecord(normalized?.draft),
    normalizedErrors: readStringArray(normalized?.errors),
    normalizedRepairedFields: readStringArray(normalized?.repairedFields),
    semanticLanguage: readString(semanticLanguageAudit?.semanticLanguage),
    languageMismatch: typeof semanticLanguageAudit?.languageMismatch === "boolean" ? semanticLanguageAudit.languageMismatch : undefined,
    inspectedSemanticFields: readStringArray(semanticLanguageAudit?.inspectedSemanticFields)
  };
}

function buildAgentOutputDigests(input: {
  phaseSummaries: HexMatchLabPhaseSummary[];
  openingBriefsByAgentId: Map<string, HexMatchLabHumanAgentOpeningBrief>;
  agentIdentities: Map<string, AgentIdentity>;
  responseArtifacts: Map<string, HexLlmResponseArtifactSummary>;
}): HexMatchLabAgentOutputDigest[] {
  return input.phaseSummaries.flatMap((phase) =>
    phase.actions.map((action) => {
      const response = action.responseArtifactId ? input.responseArtifacts.get(action.responseArtifactId) : undefined;
      const draft = response?.rawDraft;
      const normalizedDraft = response?.normalizedDraft;
      const brief = input.openingBriefsByAgentId.get(action.agentId);
      const displayName = brief?.displayName ?? formatAgentName(action.agentId, input.agentIdentities);
      const rawReason = firstText([
        readString(draft?.actionRationaleZh),
        readString(draft?.businessIntent),
        readString(draft?.tacticalIntent),
        readString(normalizedDraft?.actionRationaleZh),
        readString(normalizedDraft?.businessIntent),
        response?.rawTextPreview
      ]);
      const riskNotes = [
        ...readStringArray(draft?.riskNotes),
        ...readStringArray(normalizedDraft?.riskNotes)
      ];
      const actionTexts = [
        readString(draft?.actionRationaleZh),
        readString(draft?.businessIntent),
        readString(draft?.tacticalIntent),
        ...readStringArray(draft?.riskNotes),
        response?.rawTextPreview
      ];
      const knownEvidenceRefs = collectKnownEvidenceRefs(brief);
      const declaredEvidenceRefs = uniqueStrings([
        ...readStringArray(draft?.evidenceRefs),
        ...extractKnownRefsFromText(actionTexts.join(" "), knownEvidenceRefs)
      ]);
      return {
        agentId: action.agentId,
        displayName,
        teamSide: brief?.teamSide ?? action.side,
        phaseIndex: phase.phaseIndex,
        ...(phase.phaseLabel ? { phaseLabel: phase.phaseLabel } : {}),
        source: resolveOutputDigestSource(action, response),
        responseArtifactId: action.responseArtifactId,
        requestArtifactId: action.requestArtifactId,
        rawOutputSummaryZh: buildRawOutputSummary(response, rawReason),
        declaredActionZh: buildDeclaredActionSummary(action, draft, normalizedDraft),
        declaredReasonZh: rawReason
          ? truncateText(rawReason, 180) ?? "真实响应存在，但未提取到行动理由。"
          : "真实响应没有可读行动理由；不能用系统输入卡补写。",
        declaredEvidenceRefs,
        declaredRiskNotesZh: uniqueStrings(riskNotes).slice(0, 3),
        semanticLanguageSummaryZh: buildSemanticLanguageSummary(response),
        normalizationSummaryZh: buildNormalizationSummary(response, action),
        validationSummaryZh: buildValidationSummary(action),
        judgeAdoptionSummaryZh: buildJudgeAdoptionSummary(action.agentId, phase.combats),
        technicalRefs: {
          actionType: readString(draft?.actionType) ?? readString(normalizedDraft?.actionType) ?? action.actionType,
          targetCellId: readString(draft?.targetCellId) ?? readString(normalizedDraft?.targetCellId) ?? action.targetCellId,
          briefRefId: readString(draft?.briefRefId) ?? readString(normalizedDraft?.briefRefId) ?? action.briefRefId,
          roundStartOutputId: readString(draft?.roundStartOutputId) ?? readString(normalizedDraft?.roundStartOutputId) ?? action.roundStartOutputId,
          phase0RefId: readString(draft?.phase0RefId) ?? readString(normalizedDraft?.phase0RefId) ?? (action as { phase0RefId?: string | undefined }).phase0RefId,
          rawTextPreview: response?.rawTextPreview,
          rawDraftPreview: previewRecord(response?.rawDraft),
          normalizedDraftPreview: previewRecord(response?.normalizedDraft),
          responseReadError: response?.readError
        }
      };
    })
  );
}

function resolveOutputDigestSource(
  action: HexMatchLabActionSummary,
  response: HexLlmResponseArtifactSummary | undefined
): HexMatchLabAgentOutputDigest["source"] {
  if (response?.readError) {
    return "old_trace_missing";
  }
  if (response) {
    return response.source;
  }
  const reasons = [...action.validationErrors, action.fallbackReason ?? ""].join(" ");
  return /provider_error|fetch failed|external|eacces/i.test(reasons) ? "provider_error" : "missing_response_artifact";
}

function buildRawOutputSummary(
  response: HexLlmResponseArtifactSummary | undefined,
  rawReason: string | undefined
): string {
  if (!response) {
    return "本阶段没有真实模型 response artifact；不能展示 agent 原始输出。";
  }
  if (response.readError) {
    return `本阶段记录了 response artifact，但读取失败：${response.readError}`;
  }
  if (rawReason) {
    return `模型原始输出摘要：${truncateText(rawReason, 180)}`;
  }
  if (response.rawTextPreview) {
    return `模型返回了非结构化文本预览：${response.rawTextPreview}`;
  }
  return "模型 response artifact 存在，但没有可提取的行动理由。";
}

function buildDeclaredActionSummary(
  action: HexMatchLabActionSummary,
  rawDraft: Record<string, unknown> | undefined,
  normalizedDraft: Record<string, unknown> | undefined
): string {
  const rawActionType = readString(rawDraft?.actionType);
  const normalizedActionType = readString(normalizedDraft?.actionType);
  const targetCellId = readString(rawDraft?.targetCellId) ?? readString(normalizedDraft?.targetCellId) ?? action.targetCellId;
  const actionText = humanizeActionType(rawActionType ?? normalizedActionType ?? action.actionType);
  return targetCellId
    ? `${actionText}，目标格见技术细节。`
    : `${actionText}，模型未给出可读目标。`;
}

function buildSemanticLanguageSummary(response: HexLlmResponseArtifactSummary | undefined): string {
  if (!response) {
    return "没有真实响应，无法判断语义语言。";
  }
  if (response.languageMismatch) {
    return `语义字段疑似不是稳定中文：${response.semanticLanguage ?? "unknown"}。`;
  }
  return `语义语言：${response.semanticLanguage ?? "unknown"}。`;
}

function buildNormalizationSummary(
  response: HexLlmResponseArtifactSummary | undefined,
  action: HexMatchLabActionSummary
): string {
  const repaired = uniqueStrings([
    ...(response?.normalizedRepairedFields ?? []),
    ...action.repairedFields
  ]);
  if (repaired.length > 0) {
    return `系统修复：${repaired.map(humanizeReason).join("；")}。`;
  }
  if (response?.normalizedErrors.length) {
    return `系统规范化失败：${response.normalizedErrors.map(humanizeReason).join("；")}。`;
  }
  return response ? "系统未记录修复。" : "没有真实响应，不能产生规范化摘要。";
}

function buildValidationSummary(action: HexMatchLabActionSummary): string {
  if (action.fallbackReason) {
    return `行动降级：${humanizeReason(action.fallbackReason)}。`;
  }
  if (action.validationErrors.length > 0) {
    return `行动被拒绝：${action.validationErrors.map(humanizeReason).join("；")}。`;
  }
  return action.valid ? "行动通过后端校验。" : "行动未通过后端校验。";
}

function buildJudgeAdoptionSummary(agentId: string, combats: HexMatchLabCombatSummary[]): string {
  const relatedCombats = combats.filter((combat) => combat.participants.includes(agentId));
  if (relatedCombats.length === 0) {
    return "本阶段该 agent 未进入战斗裁判采信链。";
  }
  return relatedCombats.map((combat) => {
    const accepted = [
      ...(combat.financeEvidenceAdoption?.attack.acceptedEvidenceRefs ?? []),
      ...(combat.financeEvidenceAdoption?.defense.acceptedEvidenceRefs ?? [])
    ];
    const rejected = [
      ...(combat.financeEvidenceAdoption?.attack.rejectedEvidenceRefs ?? []),
      ...(combat.financeEvidenceAdoption?.defense.rejectedEvidenceRefs ?? [])
    ];
    const missing = [
      ...(combat.financeEvidenceAdoption?.attack.missingEvidenceApplied ?? []),
      ...(combat.financeEvidenceAdoption?.defense.missingEvidenceApplied ?? [])
    ];
    const verdict = formatFinanceVerdictForText(combat.financeVerdict);
    return [
      `${combat.contactId}：${verdict}`,
      accepted.length > 0 ? `采信 ${uniqueStrings(accepted).join("、")}` : "无正向采信证据",
      rejected.length > 0 ? `未采信 ${uniqueStrings(rejected).join("、")}` : "",
      missing.length > 0 ? `缺失证据影响 ${uniqueStrings(missing).join("、")}` : ""
    ].filter(Boolean).join("；");
  }).join("。");
}

function collectKnownEvidenceRefs(brief: HexMatchLabHumanAgentOpeningBrief | undefined): Set<string> {
  return new Set([
    ...(brief?.evidenceRefs ?? []),
    ...(brief?.scoreCapRefs ?? []),
    ...(brief?.missingEvidenceZh ?? [])
  ].filter(Boolean));
}

function extractKnownRefsFromText(text: string, knownRefs: Set<string>): string[] {
  if (!text || knownRefs.size === 0) {
    return [];
  }
  return [...knownRefs].filter((ref) => ref && text.includes(ref));
}

function buildHumanAgentOpeningBriefs(
  financeDuel: HexMatchLabFinanceDuelSummary,
  economySummary: HexMatchLabEconomySummary[],
  agentIdentities: Map<string, AgentIdentity>
): HexMatchLabHumanAgentOpeningBrief[] {
  const evidenceBoundaryZh = buildHumanEvidenceBoundary(financeDuel);
  const slices = buildHexAgentEvidenceSlices({
    financeDuel: toCoreFinanceDuel(financeDuel),
    agents: financeDuel.assignments.map((assignment) => {
      const identity = agentIdentities.get(assignment.agentId);
      return {
        agentId: assignment.agentId,
        teamId: assignment.teamId,
        side: assignment.side === "defense" ? "defense" : "attack",
        ...(identity?.displayName ? { displayName: identity.displayName } : {}),
        role: assignment.role,
        ...(identity?.roleLabel ? { roleLabel: identity.roleLabel } : {})
      };
    })
  });
  const slicesByAgentId = new Map(slices.map((slice) => [slice.agentId, slice]));
  return financeDuel.assignments.map((assignment) => {
    const identity = agentIdentities.get(assignment.agentId);
    const economy = economySummary.flatMap((team) => team.agents).find((agent) => agent.agentId === assignment.agentId);
    const side = assignment.side === "defense" ? "立场方" : "挑战方";
    const proofOrChallengeZh = assignment.side === "defense"
      ? `立场方：${financeDuel.defenseThesis.thesis}`
      : `挑战方：${financeDuel.attackChallenge.thesis}`;
    const slice = slicesByAgentId.get(assignment.agentId);
    return {
      briefId: `opening_${financeDuel.mirrorRoundNumber}_${assignment.agentId}`,
      agentId: assignment.agentId,
      displayName: identity?.displayName ?? assignment.agentId,
      teamSide: side,
      role: slice?.financeRoleCn ?? identity?.roleLabel ?? assignment.role,
      ...(slice ? {
        financeRole: slice.financeRole,
        financeRoleCn: slice.financeRoleCn,
        sliceId: slice.sliceId,
        roleQuestionZh: slice.roleQuestionZh,
        usableFactsZh: [...slice.usableFactsZh],
        evidenceRefs: [...slice.evidenceRefs],
        missingEvidenceZh: [...slice.missingEvidenceZh],
        scoreCapRefs: [...slice.scoreCapRefs],
        ...(slice.roleFallbackReason ? { roleFallbackReason: slice.roleFallbackReason } : {})
      } : {
        usableFactsZh: [],
        evidenceRefs: [],
        missingEvidenceZh: [],
        scoreCapRefs: []
      }),
      roundTaskZh: slice?.roleQuestionZh ?? assignment.financeTask,
      proofOrChallengeZh,
      evidenceBoundaryZh: slice
        ? [
            evidenceBoundaryZh,
            slice.missingEvidenceZh.length > 0 ? `专家缺口：${slice.missingEvidenceZh.slice(0, 2).join("；")}` : "",
            slice.scoreCapRefs.length > 0 ? `专家评分边界：${slice.scoreCapRefs.slice(0, 2).join("；")}` : ""
          ].filter(Boolean).join(" ")
        : evidenceBoundaryZh,
      buyConstraintZh: humanizeBuyConstraint(economy),
      actionHintZh: slice?.actionBoundaryZh ?? (assignment.side === "defense"
        ? "局内行动应守住已锁定的投资立场链条，用位置、交叉火力和回防回应挑战。"
        : "局内行动应服务挑战链条，用推进、信息或压迫验证立场方风险边界。")
    };
  });
}

function buildLegacyDecisionQuestionFallback(summary: HexMatchLabFinanceDuelSummary): NonNullable<HexMatchLabFinanceDuelSummary["decisionQuestion"]> {
  return {
    question: `旧 trace 未记录 N56 决策题契约；旧小主题：${summary.topicTitle}`,
    decisionObject: "旧 trace 未记录",
    horizon: "旧 trace 未记录",
    benchmark: "旧 trace 未记录",
    allowedStance: [
      "bullish",
      "bearish",
      "neutral",
      "structural",
      "conditional_bullish",
      "conditional_bearish",
      "no_trade"
    ],
    requiredOutput: ["旧 trace 未记录 N56 requiredOutput。"],
    requiredEvidenceSchema: [{
      requiredKey: "old_trace_missing_n56_contract",
      requiredForClaimTypes: ["legacy_trace"],
      minimumFactCount: 0,
      preferredSources: [],
      fallbackSources: ["legacy_trace"],
      missingEffect: "旧 trace 缺少 N56 必需证据结构，不能据此判定新金融契约已生效。",
      notWinCondition: true
    }],
    challengePolicy: {
      mustTargetClaimId: true,
      allowedChallengeTypes: ["legacy_trace_missing"],
      invalidChallengePatterns: ["旧 trace 不具备 N56 challengePolicy。"],
      missingEvidenceCanOnlyCap: true
    }
  };
}

function toCoreFinanceDuel(summary: HexMatchLabFinanceDuelSummary): HexRoundFinanceDuel {
  const decisionQuestion = summary.decisionQuestion ?? buildLegacyDecisionQuestionFallback(summary);
  return {
    schemaVersion: 1,
    source: "hex_round_finance_duel",
    roundNumber: summary.roundNumber,
    halfIndex: summary.halfIndex,
    roundInHalf: summary.roundInHalf,
    mirrorRoundNumber: summary.mirrorRoundNumber,
    overtimeUnsupported: false,
    attackTeamId: summary.attackChallenge.teamId,
    defenseTeamId: summary.defenseThesis.teamId,
    topic: {
      roundNumber: summary.roundInHalf,
      roundKey: summary.topicKey,
      topicTitle: summary.topicTitle,
      decisionQuestion: decisionQuestion.question,
      decisionObject: decisionQuestion.decisionObject,
      horizon: decisionQuestion.horizon,
      benchmark: decisionQuestion.benchmark,
      allowedStance: [...decisionQuestion.allowedStance],
      requiredOutput: [...decisionQuestion.requiredOutput],
      requiredEvidenceSchema: decisionQuestion.requiredEvidenceSchema.map((item) => ({ ...item })),
      challengePolicy: {
        mustTargetClaimId: decisionQuestion.challengePolicy.mustTargetClaimId,
        allowedChallengeTypes: [...decisionQuestion.challengePolicy.allowedChallengeTypes],
        invalidChallengePatterns: [...decisionQuestion.challengePolicy.invalidChallengePatterns],
        missingEvidenceCanOnlyCap: decisionQuestion.challengePolicy.missingEvidenceCanOnlyCap
      },
      defenseThesisFocus: summary.defenseThesisFocus,
      attackChallengeFocus: summary.attackChallengeFocus
    },
    decisionQuestion,
    defenseThesis: {
      thesisId: `web_finance_thesis_${summary.roundNumber}_${summary.defenseThesis.teamId}_${summary.topicKey}`,
      teamId: summary.defenseThesis.teamId,
      side: "defense",
      topicKey: summary.topicKey,
      thesis: summary.defenseThesis.thesis,
      keyAssumptions: [...summary.defenseThesis.keyAssumptions],
      evidenceRefs: [...summary.defenseThesis.evidenceRefs],
      riskBoundary: summary.defenseThesis.riskBoundary
    },
    attackChallenge: {
      challengeId: `web_finance_challenge_${summary.roundNumber}_${summary.attackChallenge.teamId}_${summary.topicKey}`,
      teamId: summary.attackChallenge.teamId,
      side: "attack",
      topicKey: summary.topicKey,
      thesis: summary.attackChallenge.thesis,
      challengePoints: [...summary.attackChallenge.challengePoints],
      requiredDefense: [...summary.attackChallenge.requiredDefense],
      evidenceRefs: [...summary.attackChallenge.evidenceRefs]
    },
    agentAssignments: summary.assignments.map((assignment) => ({
      assignmentId: `web_finance_assignment_${assignment.agentId}_${summary.topicKey}`,
      agentId: assignment.agentId,
      teamId: assignment.teamId,
      side: assignment.side === "defense" ? "defense" : "attack",
      role: assignment.role,
      topicKey: summary.topicKey,
      ...(assignment.side === "defense"
        ? { linkedThesisId: `web_finance_thesis_${summary.roundNumber}_${summary.defenseThesis.teamId}_${summary.topicKey}` }
        : { linkedChallengeId: `web_finance_challenge_${summary.roundNumber}_${summary.attackChallenge.teamId}_${summary.topicKey}` }),
      financeTask: assignment.financeTask,
      evidenceRules: [
        "Web projection uses this assignment for human audit only."
      ]
    })),
    evidencePackRef: {
      mapBindingId: "web_projection",
      financeMapSlug: "dust2-nonferrous",
      generatedAt: "",
      aggregateEvidencePath: ""
    },
    evidence: {
      facts: summary.evidence.promptFacts.map((fact) => ({
        factId: fact.factId,
        statement: fact.shortText,
        metricName: "web_prompt_fact",
        source: "FINANCE_DUEL_SUMMARY",
        sourceType: "web_projection",
        evidenceId: fact.evidenceId,
        confidence: 0.5,
        dataMode: "trace_summary"
      })),
      promptFacts: summary.evidence.promptFacts.map((fact) => ({ ...fact })),
      missingEvidence: [...summary.evidence.missingEvidence],
      scoreCaps: summary.evidence.scoreCaps.map((cap) => ({ ...cap })),
      judgeLedger: {
        allowedClaims: [],
        cappedClaims: [],
        prohibitedClaims: []
      },
      sourceWarnings: []
    },
    sideSwapPolicy: {},
    sourceAudit: {
      mode: "generated_evidence_pack",
      materialPaths: {},
      notes: ["web_projection_for_agent_evidence_slice"]
    }
  };
}

function buildHumanPhaseStory(
  phase: HexMatchLabPhaseSummary,
  openingBriefsByAgentId: Map<string, HexMatchLabHumanAgentOpeningBrief>,
  roundStartOutputsByOutputId: Map<string, HexMatchLabRoundStartAgentOutput>,
  agentIdentities: Map<string, AgentIdentity>
): HexMatchLabHumanPhaseStory {
  const actionStories = phase.actions.map((action) => {
    const brief = openingBriefsByAgentId.get(action.agentId);
    const roundStartOutput = action.roundStartOutputId ? roundStartOutputsByOutputId.get(action.roundStartOutputId) : undefined;
    const displayName = brief?.displayName ?? agentIdentities.get(action.agentId)?.displayName ?? action.agentId;
    const actionSummaryZh = [
      `${displayName} 本阶段${humanizeActionType(action.actionType)}`,
      action.targetCellId ? "目标格已记录，具体 cell id 见技术细节" : "目标未记录",
      action.actionRationaleZh || action.businessIntent ? `理由：${action.actionRationaleZh ?? action.businessIntent}` : "理由：未记录",
      roundStartOutput
        ? `引用真实 ${roundStartOutput.cardKind === "stance" ? "立场卡" : roundStartOutput.cardKind === "challenge" ? "挑战卡" : "开局输出"}：${roundStartOutput.cardSummaryZh ?? roundStartOutput.openingStatementZh}`
        : brief
          ? `引用系统输入卡：${brief.roleQuestionZh ?? brief.roundTaskZh}`
          : "未记录开局引用"
    ].join("；");
    const repairSummaryZh = action.fallbackReason
      ? `本行动被降级：${humanizeReason(action.fallbackReason)}`
      : action.validationErrors.length > 0
        ? `本行动被拒绝：${action.validationErrors.map(humanizeReason).join("、")}`
        : action.repairedFields.length > 0
          ? `本行动被修复：${action.repairedFields.map(humanizeReason).join("、")}`
          : undefined;
    return {
      agentId: action.agentId,
      displayName,
      actionSummaryZh,
      openingBriefRef: action.briefRefId ?? brief?.briefId,
      roundStartOutputRef: action.roundStartOutputId ?? roundStartOutput?.outputId,
      phase0Ref: (action as { phase0RefId?: string | undefined }).phase0RefId,
      repairSummaryZh,
      technicalRefs: {
        targetCellId: action.targetCellId,
        requestArtifactId: action.requestArtifactId,
        responseArtifactId: action.responseArtifactId,
        roundStartOutputId: action.roundStartOutputId,
        phase0RefId: (action as { phase0RefId?: string | undefined }).phase0RefId,
        validationErrors: [...action.validationErrors],
        repairedFields: [...action.repairedFields]
      }
    };
  });
  return {
    phaseId: phase.phaseId,
    phaseIndex: phase.phaseIndex,
    ...(phase.phaseLabel ? { phaseLabel: phase.phaseLabel } : {}),
    summaryZh: phase.isSetupPhase
      ? "准备阶段：展示出生、经济、C4 和本局信息卡，不产生 LLM 调用。"
      : `本阶段接受 ${phase.acceptedActionCount} 个行动，拒绝 ${phase.rejectedDraftCount} 个草案，降级 ${phase.fallbackActionCount} 个行动，形成 ${phase.combatResolutionCount} 个战斗裁定。`,
    phaseValidationSummaryZh: buildHumanPhaseValidationSummary(phase),
    actionStories,
    combatStories: phase.combats.map((combat) => buildHumanCombatStory(combat, agentIdentities))
  };
}

function buildHumanPhaseValidationSummary(phase: HexMatchLabPhaseSummary): string {
  if (phase.isSetupPhase) {
    return "准备阶段不调用 LLM，只展示出生、经济、C4 与开局信息卡。";
  }
  const warnings = [
    phase.rejectedDraftCount > 0 ? `拒绝 ${phase.rejectedDraftCount} 个草案` : "",
    phase.fallbackActionCount > 0 ? `降级 ${phase.fallbackActionCount} 个行动` : "",
    phase.llmAudit.providerErrors.length > 0 ? `provider 失败 ${phase.llmAudit.providerErrors.length} 条` : "",
    phase.combats.length > 0 && phase.combats.every((combat) => !combat.financeEvidenceAdoption)
      ? "战斗未记录证据采信链"
      : ""
  ].filter(Boolean);
  return warnings.length > 0
    ? `本阶段可验收，但存在：${warnings.join("；")}。`
    : "本阶段行动、证据采信和战斗裁定字段完整。";
}

function buildHumanCombatStory(
  combat: HexMatchLabCombatSummary,
  agentIdentities: Map<string, AgentIdentity>
): HexMatchLabHumanCombatStory {
  const killText = combat.killAttributions.length > 0
    ? combat.killAttributions.map((item) => {
      const killer = item.killerAgentId ? formatAgentName(item.killerAgentId, agentIdentities) : "未分配击杀者";
      const target = formatAgentName(item.targetAgentId, agentIdentities);
      const assists = item.assisterAgentIds.length > 0
        ? `，助攻：${item.assisterAgentIds.map((agentId) => formatAgentName(agentId, agentIdentities)).join("、")}`
        : "";
      return `${killer} 击倒 ${target}${assists}`;
    }).join("；")
    : combat.suppressions.length > 0
      ? `形成压制：${combat.suppressions.map((item) => humanizeSuppression(item, agentIdentities)).join("、")}`
      : "没有形成击杀或压制事实";
  return {
    contactId: combat.contactId,
    verdictZh: humanizeFinanceVerdict(combat.financeVerdict ?? combat.businessVerdict),
    contactThreatZh: humanizeContactThreat(combat),
    impactZh: `${killText}。${combat.regionControlHint ? `控图倾向：${combat.regionControlHint}。` : ""}`,
    reasonsZh: [
      humanizeContactThreat(combat),
      ...(combat.financeProjection?.projectionReasonsZh ?? []).slice(0, 2),
      ...combat.financeReasonZh.slice(0, 3),
      ...combat.csReasonZh.slice(0, 3),
      ...combat.financeReasons.slice(0, 3).map(humanizeReason),
      ...combat.csReasons.slice(0, 3).map(humanizeReason)
    ],
    acceptedEvidenceZh: buildEvidenceAdoptionListZh(combat.financeEvidenceAdoption, "accepted"),
    rejectedEvidenceZh: buildEvidenceAdoptionListZh(combat.financeEvidenceAdoption, "rejected"),
    missingEvidenceZh: buildEvidenceAdoptionListZh(combat.financeEvidenceAdoption, "missing"),
    financeReasonZh: combat.financeReasonZh,
    csReasonZh: combat.csReasonZh,
    technicalRefs: {
      participants: [...combat.participants],
      rawFinanceVerdict: combat.financeVerdict,
      rawBusinessVerdict: combat.businessVerdict,
      rawReasons: [...combat.financeReasons, ...combat.businessReasons, ...combat.csReasons, ...(combat.financeProjection?.projectionReasons ?? []), ...(combat.financeProjection?.projectionReasonsZh ?? []), ...combat.financeReasonZh, ...combat.csReasonZh]
    }
  };
}

function humanizeContactThreat(combat: HexMatchLabCombatSummary): string {
  const threat = combat.contactThreatLevel === "lethal"
    ? "致命接触"
    : combat.contactThreatLevel === "suppression"
      ? "压制接触"
      : combat.contactThreatLevel === "observation"
        ? "观察接触"
        : "旧 trace 未记录接触强度";
  const exposureDetails = [
    combat.lineOfFireExposure ? "枪线暴露" : undefined,
    combat.openSightNoCover ? "开阔无掩体" : undefined,
    combat.samePointExposure ? "同点位暴露" : undefined,
    combat.objectiveExposure ? "包点/下包/拆包暴露" : undefined,
    combat.implicitDuelFromMovement ? "移动触发隐式交火" : undefined,
    combat.coverBlockedLethal ? "掩体阻断致命升级" : undefined
  ].filter((item): item is string => Boolean(item));
  const details = exposureDetails.length > 0 ? `接触细节：${exposureDetails.join("、")}。` : "";
  if (combat.lethalEligible) {
    return `${threat}，已通过致命门槛。${details}`;
  }
  const blocked = combat.lethalGateBlockedReasons.length > 0
    ? `原因：${combat.lethalGateBlockedReasons.map(humanizeReason).join("、")}`
    : "原因未记录";
  return `${threat}，未通过致命门槛，不能直接击杀。${details}${blocked}。`;
}

function buildEvidenceAdoptionListZh(
  adoption: HexMatchLabFinanceEvidenceAdoptionSummary | undefined,
  kind: "accepted" | "rejected" | "missing"
): string[] {
  if (!adoption) {
    return ["旧 trace 未记录证据采信链。"];
  }
  const sides = [adoption.attack, adoption.defense];
  return sides.flatMap((side) => {
    const sideLabel = side.side === "attack" ? "攻方" : "守方";
    if (kind === "accepted") {
      return side.acceptedEvidenceRefs.length > 0 ? [`${sideLabel}采信：${side.acceptedEvidenceRefs.join("、")}`] : [`${sideLabel}没有被采信的正向证据。`];
    }
    if (kind === "rejected") {
      return side.rejectedEvidenceRefs.length > 0 ? [`${sideLabel}未采信：${side.rejectedEvidenceRefs.join("、")}`] : [];
    }
    return side.missingEvidenceApplied.length > 0 ? [`${sideLabel}缺失证据影响：${side.missingEvidenceApplied.join("、")}`] : [];
  });
}

function buildHumanEvidenceBoundary(financeDuel: HexMatchLabFinanceDuelSummary): string {
  const missing = financeDuel.evidence.missingEvidence.length > 0
    ? `缺失证据：${financeDuel.evidence.missingEvidence.slice(0, 4).join("、")}。`
    : "缺失证据：当前未记录。";
  const caps = financeDuel.evidence.scoreCaps.length > 0
    ? `评分上限：${financeDuel.evidence.scoreCaps.slice(0, 3).map((cap) => `${cap.condition} 最高 ${cap.maxScore}`).join("；")}。`
    : "评分上限：当前未记录。";
  return `${financeDuel.defenseThesis.riskBoundary} ${missing}${caps}`.trim();
}

function formatAllowedStanceZh(value: string): string {
  if (value === "bullish") return "看多";
  if (value === "bearish") return "看空";
  if (value === "neutral") return "中性";
  if (value === "structural") return "结构性分化";
  if (value === "conditional_bullish") return "条件看多";
  if (value === "conditional_bearish") return "条件看空";
  if (value === "no_trade") return "暂不交易但给触发条件";
  return value;
}

function humanizeBuyConstraint(economy: HexMatchLabEconomySummary["agents"][number] | undefined): string {
  if (!economy) {
    return "经济未记录；按保守行动处理。";
  }
  const base = `买型 ${economy.buyType ?? "未知"}，资源 ${economy.resourceTier ?? "未知"}，当前经济 ${economy.currentEconomy ?? economy.tokenBankAfterDrop ?? "未记录"}，本局花费 ${economy.spend ?? 0}。`;
  if (economy.resourceTier === "high") {
    return `${base} 可以承担主攻或主防论证。`;
  }
  if (economy.resourceTier === "medium") {
    return `${base} 适合关键配合和局部论证。`;
  }
  if (economy.resourceTier === "forced") {
    return `${base} 只适合有限执行和风险暴露。`;
  }
  if (economy.resourceTier === "low") {
    return `${base} 只适合窄问题试探、信息收集或保守挑战。`;
  }
  return base;
}

function humanizeActionType(actionType: string): string {
  const labels: Record<string, string> = {
    hold_position: "留守当前位置",
    move: "移动到目标点位",
    watch_angle: "架住角度",
    peek: "主动试探",
    gather_info: "收集信息",
    use_utility: "尝试使用道具",
    map_control: "争夺地图控制",
    prepare_trade: "准备补枪配合",
    seek_duel: "主动寻找对抗",
    execute_site: "执行进点",
    plant_bomb: "尝试下包",
    defuse_bomb: "尝试拆包",
    retake: "尝试回防",
    rotate: "转点支援",
    save: "保守保存",
    lurk: "潜伏牵制",
    fake: "假打牵制",
    boost: "尝试双架"
  };
  return labels[actionType] ?? `执行未翻译行动 ${actionType}`;
}

function humanizeFinanceVerdict(value: string | undefined): string {
  const labels: Record<string, string> = {
    challenge_landed: "挑战方击中关键主张",
    thesis_defended: "立场方判断暂时守住",
    contested_no_finance_resolution: "金融决策未分胜负",
    proof_rebutted_challenge: "立场方回应挑战",
    challenge_succeeded: "挑战方挑战成功",
    contested_no_business_resolution: "攻防争夺未分胜负"
  };
  return value ? labels[value] ?? `未翻译裁定：${value}` : "未记录金融裁定";
}

function humanizeReason(reason: string): string {
  const labels: Record<string, string> = {
    challenge_landed: "挑战方击中关键主张",
    thesis_defended: "立场方判断暂时守住",
    contested_no_finance_resolution: "金融决策未分胜负",
    decisive_combat_margin: "战斗优势明显，形成击杀",
    contested_combat: "交火僵持，形成压制",
    target_bombsite_exposure: "目标暴露在包点交火区",
    validated_ap_path: "行动路径和 AP 合法",
    line_of_fire_exposure: "双方处于可射击枪线暴露关系",
    open_sight_no_cover: "双方在开阔无掩体位置相对",
    same_point_exposure: "双方争夺同一战术点位",
    objective_exposure: "包点、入口、下包或拆包附近暴露",
    implicit_duel_from_movement: "移动或转点进入可射击关系，按隐式交火处理",
    cover_blocks_lethal: "掩体或遮蔽阻断致命升级",
    finance_intent_present: "行动理由已引用金融攻防任务",
    finance_score_cap_applied_without_evidence_reference: "证据引用不足，金融得分被封顶",
    phase_repeated_round_thesis: "阶段行动复述了开局金融论点，已拒绝",
    phase_action_reason_too_long: "阶段行动理由过长，疑似重新写金融作文",
    repaired_missing_briefRefId: "已补齐开局信息卡引用",
    repaired_invalid_briefRefId: "已修正为当前选手自己的开局信息卡",
    repaired_missing_roundStartOutputId: "已补齐真实开局输出引用",
    repaired_invalid_roundStartOutputId: "已修正为当前选手自己的真实开局输出",
    repaired_invalid_phase0_ref: "已修正为当前选手自己的 phase0 claim / challenge 引用",
    repaired_actionType_from_move_to_plant_bomb_due_to_c4_phase_clock: "C4 已在可下包位置，系统将普通移动修正为下包行动",
    repaired_actionType_from_move_to_defuse_bomb_due_to_phase_clock: "防守方已在拆包位置，系统将普通移动修正为拆包行动",
    repaired_actionType_from_move_to_retake_due_to_phase_clock: "残局/拆包压力下，系统将普通移动修正为回防行动",
    repaired_actionType_from_move_to_execute_pressure_due_to_phase_clock: "阶段压力下进入包点路径，系统将普通移动修正为包点执行/主动接战",
    repaired_actionType_from_move_to_duel_pressure_due_to_phase_clock: "进入枪线或接触风险区，系统将普通移动修正为主动对枪压力",
    "draft:invalid_phase0RefId": "phase0 claim / challenge 引用无效",
    "draft:final_phase_future_setup_intent": "最后阶段仍写为后续铺垫，已拒绝",
    provider_error: "真实模型供应器失败",
    external_blocked: "外部调用被阻断",
    no_accepted_finance_evidence: "没有被裁判正向采信的金融证据",
    fallback_not_positive_finance_evidence: "降级行动不能作为正向金融证据",
    invalid_action_not_positive_finance_evidence: "无效行动不能作为正向金融证据",
    unknown_evidence_ref: "引用了不存在的证据编号",
    unavailable_observation_not_adopted_as_fact: "不可用观测不能当作真实事实采信",
    configured_proxy_fact_score_cap: "配置型代理事实触发评分上限",
    proxy_fact_boundary: "代理事实只能作为弱证据",
    target_cell_occupied: "目标格已被占用",
    max_llm_calls_reached: "已达到本阶段 LLM 调用上限",
    dead_agent_skipped: "选手已阵亡，跳过行动",
    economy_disallows_action: "经济约束不允许该行动"
  };
  return labels[reason] ?? `未翻译技术原因：${reason}`;
}

function humanizeSuppression(value: string, agentIdentities: Map<string, AgentIdentity>): string {
  const [agentId, result] = value.split(":");
  const name = agentId ? formatAgentName(agentId, agentIdentities) : "未知选手";
  return `${name}${result ? ` ${humanizeReason(result)}` : ""}`;
}

function humanizeHardWinner(condition: HexMatchLabHardConditionSummary): string {
  const winner = condition.winnerTeamId ? `胜方 ${condition.winnerTeamId}` : "尚无胜方";
  const winType = condition.roundWinType ?? condition.judgeRoundWinType ?? "未记录胜利方式";
  const reason = condition.reason ? humanizeReason(condition.reason) : "未记录原因";
  return `硬胜负：${winner}，方式 ${winType}，原因 ${reason}。最终胜负不由 LLM 或前端决定。`;
}

function formatAgentName(agentId: string, agentIdentities: Map<string, AgentIdentity>): string {
  return agentIdentities.get(agentId)?.displayName ?? agentId;
}

function buildFinanceReview(input: {
  financeDuel: HexMatchLabFinanceDuelSummary;
  phaseSummaries: HexMatchLabPhaseSummary[];
  finalHardCondition?: HexMatchLabHardConditionSummary | undefined;
  roundQualityStatus?: string | undefined;
  roundQualityReasons?: string[] | undefined;
  roundQualitySummaryZh?: string | undefined;
  roundQualityCounts?: Record<string, number> | undefined;
  tacticalAudit?: HexMatchLabTacticalAuditSummary | undefined;
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
      summary: input.financeDuel.decisionQuestion
        ? `本回合金融决策题是「${input.financeDuel.decisionQuestion.question}」。立场方在允许立场内给出投资判断，挑战方必须攻击具体主张或证据链断点；缺失证据只能降权，不能直接赢。`
        : `旧 trace 未记录 N56 决策题契约；旧小主题是「${input.financeDuel.topicTitle}」。`,
      defenseSummary: `立场方 ${input.financeDuel.defenseThesis.teamId} 任务：${input.financeDuel.defenseThesis.thesis}`,
      attackSummary: `挑战方 ${input.financeDuel.attackChallenge.teamId} 任务：${input.financeDuel.attackChallenge.thesis}`,
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
  roundQualityStatus?: string | undefined;
  roundQualityReasons?: string[] | undefined;
  roundQualitySummaryZh?: string | undefined;
  roundQualityCounts?: Record<string, number> | undefined;
  tacticalAudit?: HexMatchLabTacticalAuditSummary | undefined;
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
      repairedFields: audit?.repairedFields ?? [],
      businessIntent: action.businessIntent,
      briefRefId: action.briefRefId,
      roundStartOutputId: action.roundStartOutputId,
      phase0RefId: (action as { phase0RefId?: string | undefined }).phase0RefId,
      actionRationaleZh: action.actionRationaleZh,
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
      contactThreatLevel: resolution.audit.contactThreat?.level,
      lethalEligible: resolution.audit.contactThreat?.lethalEligible,
      lethalGateReasons: resolution.audit.contactThreat?.lethalGateReasons ?? [],
      lethalGateBlockedReasons: resolution.audit.contactThreat?.lethalGateBlockedReasons ?? [],
      lineOfFireExposure: resolution.audit.contactThreat?.lineOfFireExposure,
      openSightNoCover: resolution.audit.contactThreat?.openSightNoCover,
      samePointExposure: resolution.audit.contactThreat?.samePointExposure,
      objectiveExposure: resolution.audit.contactThreat?.objectiveExposure,
      implicitDuelFromMovement: resolution.audit.contactThreat?.implicitDuelFromMovement,
      coverBlockedLethal: resolution.audit.contactThreat?.coverBlockedLethal,
      businessVerdict: resolution.businessVerdict,
      financeVerdict: resolution.financeVerdict,
      businessReasons: resolution.businessReasons ?? [],
      financeReasons: resolution.financeReasons ?? [],
      csReasons: resolution.csReasons ?? [],
      financeEvidenceAdoption: resolution.financeEvidenceAdoption ? {
        attack: cloneFinanceEvidenceAdoptionSide(resolution.financeEvidenceAdoption.attack),
        defense: cloneFinanceEvidenceAdoptionSide(resolution.financeEvidenceAdoption.defense)
      } : undefined,
      financeProjection: resolution.financeProjection ? cloneFinanceProjection(resolution.financeProjection) : undefined,
      financeReasonZh: resolution.financeReasonZh ?? [],
      csReasonZh: resolution.csReasonZh ?? [],
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
  const tacticalAudit = summarizeTacticalAudit(trace.audit);
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
    strategyVariant: trace.audit.strategyVariant,
    roundQualityStatus: trace.audit.roundQualityStatus,
    roundQualityReasons: trace.audit.roundQualityReasons ?? [],
    roundQualitySummaryZh: trace.audit.roundQualitySummaryZh,
    roundQualityCounts: trace.audit.roundQualityCounts,
    tacticalAudit
  };
}

function summarizeTacticalAudit(audit: HexRoundTrace["audit"]): HexMatchLabTacticalAuditSummary | undefined {
  const tacticalAudit = (audit as HexRoundTrace["audit"] & { tacticalAudit?: HexRoundTrace["audit"]["tacticalAudit"] }).tacticalAudit;
  if (!tacticalAudit) {
    return undefined;
  }
  return {
    selectedVariant: tacticalAudit.selectedVariant,
    selectedAttackVariant: tacticalAudit.selectedAttackVariant,
    selectedDefenseVariant: tacticalAudit.selectedDefenseVariant,
    c4SitePreference: tacticalAudit.c4SitePreference,
    selectionReasons: [...(tacticalAudit.selectionReasons ?? [])],
    previousRoundSignals: [...(tacticalAudit.previousRoundSignals ?? [])],
    antiRepeatPenalties: [...(tacticalAudit.antiRepeatPenalties ?? [])],
    antiRepeatRegions: [...(tacticalAudit.antiRepeatRegions ?? [])],
    antiRepeatPoints: [...(tacticalAudit.antiRepeatPoints ?? [])],
    economyAdjustment: [...(tacticalAudit.economyAdjustment ?? [])],
    routeDiversityWarnings: [...(tacticalAudit.routeDiversityWarnings ?? [])],
    attackFocusRegions: [...(tacticalAudit.attackFocusRegions ?? [])],
    defenseFocusRegions: [...(tacticalAudit.defenseFocusRegions ?? [])],
    attackAvoidRegions: [...(tacticalAudit.attackAvoidRegions ?? [])],
    defenseAvoidRegions: [...(tacticalAudit.defenseAvoidRegions ?? [])],
    roleRouteAssignments: (tacticalAudit.roleRouteAssignments ?? []).map((assignment) => ({
      side: assignment.side,
      role: assignment.role,
      routeIntent: assignment.routeIntent,
      focusRegions: [...(assignment.focusRegions ?? [])],
      focusPoints: [...(assignment.focusPoints ?? [])],
      avoidRegions: assignment.avoidRegions ? [...assignment.avoidRegions] : undefined
    }))
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

function cloneFinanceProjection(value: Partial<HexMatchLabFinanceProjectionSummary>): HexMatchLabFinanceProjectionSummary {
  return {
    financialResult: value.financialResult ?? "contested",
    combatEffectAllowed: [...(value.combatEffectAllowed ?? [])],
    appliedEffect: value.appliedEffect ?? "none",
    blockedEffects: [...(value.blockedEffects ?? [])],
    projectionReasons: [...(value.projectionReasons ?? [])],
    projectionReasonsZh: [...(value.projectionReasonsZh ?? [])],
    financeMayExplainKill: Boolean(value.financeMayExplainKill),
    financeMayApplyPressure: Boolean(value.financeMayApplyPressure),
    financeMayForceReposition: Boolean(value.financeMayForceReposition),
    financeMayApplyMapControl: Boolean(value.financeMayApplyMapControl)
  };
}
function cloneFinanceEvidenceAdoptionSide(value: Partial<HexMatchLabFinanceEvidenceAdoptionSideSummary> & { side?: string | undefined }): HexMatchLabFinanceEvidenceAdoptionSideSummary {
  return {
    side: value.side ?? "unknown",
    acceptedEvidenceRefs: [...(value.acceptedEvidenceRefs ?? [])],
    rejectedEvidenceRefs: [...(value.rejectedEvidenceRefs ?? [])],
    missingEvidenceApplied: [...(value.missingEvidenceApplied ?? [])],
    scoreCapRefs: [...(value.scoreCapRefs ?? [])],
    scoreCaps: (value.scoreCaps ?? []).map((cap) => ({ ...cap })),
    acceptedClaims: [...(value.acceptedClaims ?? [])],
    rejectedClaims: [...(value.rejectedClaims ?? [])],
    acceptedChallenges: [...(value.acceptedChallenges ?? [])],
    rejectedChallenges: [...(value.rejectedChallenges ?? [])],
    sideScore: value.sideScore,
    stanceScore: value.stanceScore,
    challengeScore: value.challengeScore,
    financialResult: value.financialResult,
    combatEffectAllowed: [...(value.combatEffectAllowed ?? [])],
    adoptionReasons: [...(value.adoptionReasons ?? [])],
    rejectionReasons: [...(value.rejectionReasons ?? [])],
    financeReasonZh: [...(value.financeReasonZh ?? [])],
    auditReasons: [...(value.auditReasons ?? [])]
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

function readDraftRecord(value: unknown): Record<string, unknown> | undefined {
  const record = parseRecord(value);
  if (!record) {
    return undefined;
  }
  const nestedDraft = parseRecord(record.draft);
  if (nestedDraft) {
    return nestedDraft;
  }
  const actions = Array.isArray(record.actions) ? record.actions : undefined;
  const firstAction = actions && actions.length === 1 ? parseRecord(actions[0]) : undefined;
  if (firstAction) {
    return firstAction;
  }
  const drafts = Array.isArray(record.drafts) ? record.drafts : undefined;
  const firstDraft = drafts && drafts.length === 1 ? parseRecord(drafts[0]) : undefined;
  return firstDraft ?? record;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function firstText(values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}

function truncateText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) {
    return undefined;
  }
  const text = value.trim().replace(/\s+/g, " ");
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function previewRecord(value: Record<string, unknown> | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return truncateText(JSON.stringify(value), 420);
}

function formatFinanceVerdictForText(value: string | undefined): string {
  if (value === "challenge_landed") return "挑战方击中关键主张";
  if (value === "thesis_defended") return "立场方判断暂时守住";
  if (value === "contested_no_finance_resolution") return "金融决策未分胜负";
  return value ? humanizeReason(value) : "未记录金融裁定";
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
