import type { HexCell } from "@agent-major/shared";
import type { HexValidatedAgentAction } from "../action/index.js";
import type { HexEconomyCombatEvidence } from "../economy/index.js";
import type { HexPhaseMemoryEvent, HexPhaseId, HexSide } from "../state/index.js";

export type HexCombatTriggerReason =
  | "same_region"
  | "shared_point"
  | "nearby_cells"
  | "known_enemy"
  | "active_pressure"
  | "site_contest"
  | "choke_contest"
  | "dropped_bomb_contest"
  | "plant_pressure"
  | "trade_setup"
  | "support_contact";
export type HexCombatAdvantage = "attack" | "defense" | "contested";
export type HexCombatVerdict = "kill" | "wound_or_forced_back" | "contested_suppression";
export type HexCombatContactThreatLevel = "observation" | "suppression" | "lethal";
export type HexCombatControlHint = "attack" | "defense" | "contested" | "neutral";
export type HexCombatVarianceMode = "off" | "audited";
export type HexCombatBusinessVerdict =
  | "proof_rebutted_challenge"
  | "challenge_succeeded"
  | "contested_no_business_resolution";
export type HexCombatFinanceVerdict =
  | "thesis_defended"
  | "challenge_landed"
  | "contested_no_finance_resolution";

export type HexCombatFinancialResult =
  | "stance_survives"
  | "challenge_breaks_stance"
  | "contested"
  | "no_financial_win_allowed";

export type HexCombatEffectAllowed =
  | "no_effect"
  | "minor_delay"
  | "pressure"
  | "force_reposition"
  | "map_control"
  | "possible_kill";

export type HexCombatFinanceProjectionEffect = HexCombatEffectAllowed | "none";

export interface HexCombatFinanceProjection {
  financialResult: HexCombatFinancialResult;
  combatEffectAllowed: HexCombatEffectAllowed[];
  appliedEffect: HexCombatFinanceProjectionEffect;
  blockedEffects: HexCombatEffectAllowed[];
  projectionReasons: string[];
  projectionReasonsZh: string[];
  financeMayExplainKill: boolean;
  financeMayApplyPressure: boolean;
  financeMayForceReposition: boolean;
  financeMayApplyMapControl: boolean;
}

export interface HexCombatFinanceScoreCapAudit {
  condition: string;
  reason: string;
  maxScore?: number;
}

export interface HexCombatParticipant {
  agentId: string;
  teamId: string;
  side: HexSide;
  currentCellId: string;
  targetCellId: string;
  currentRegionId?: string;
  targetRegionId?: string;
  currentPointIds: string[];
  targetPointIds: string[];
  currentFlags: HexCell["flags"];
  targetFlags: HexCell["flags"];
  lifeStatus: "alive" | "wounded";
  action: HexValidatedAgentAction;
  roleLabel?: string;
  supportParticipant?: boolean;
}

export type HexCombatLethalGateStatus = "passed" | "blocked" | "suppression_only";

export interface HexCombatFireLane {
  laneId: string;
  contactId: string;
  attackAgentId: string;
  defenseAgentId: string;
  regionIds: string[];
  pointIds: string[];
  cellContactId?: string;
  objectiveExposureId?: string;
  exposureFlags: string[];
}

export interface HexCombatDuelPair {
  duelPairId: string;
  primaryAgentId: string;
  targetAgentId: string;
  side: HexSide;
  laneId: string;
  pressureKey: string;
  directnessScore: number;
  lethalGateStatus: HexCombatLethalGateStatus;
  reasons: string[];
  contributorAgentIds: string[];
}

export interface HexCombatContact {
  contactId: string;
  phaseId: HexPhaseId;
  phaseIndex: number;
  participants: HexCombatParticipant[];
  attackAgentIds: string[];
  defenseAgentIds: string[];
  triggerReasons: HexCombatTriggerReason[];
  regionIds: string[];
  pointIds: string[];
  duelPairs: HexCombatDuelPair[];
  fireLanes: HexCombatFireLane[];
  pressureKeys: string[];
  minCellDistance?: number;
  contactThreatLevel?: HexCombatContactThreatLevel;
  lethalEligible?: boolean;
  lethalGateReasons?: string[];
  lethalGateBlockedReasons?: string[];
  lineOfFireExposure?: boolean;
  openSightNoCover?: boolean;
  samePointExposure?: boolean;
  objectiveExposure?: boolean;
  implicitDuelFromMovement?: boolean;
  coverBlockedLethal?: boolean;
  relevanceScore?: number;
  retentionReasons?: string[];
  prunedCandidateCount?: number;
}

export interface HexCombatSideEvidence {
  businessScore: number;
  financeScore?: number;
  financeFirepowerScore?: HexCombatFinanceFirepowerScore;
  csScore: number;
  totalScore: number;
  reasons: string[];
  financeEvidenceAdoption?: HexCombatFinanceEvidenceAdoption;
}

export interface HexCombatFinanceFirepowerScore {
  side: HexSide;
  pressureScore: number;
  lethalScore: number;
  totalScore: number;
  appliedToCombatScore: number;
  blockedLethalScore: number;
  participantAcceptedEvidenceRefs: string[];
  participantAcceptedClaimRefs: string[];
  participantSubmittedOutputRefs: string[];
  capApplied: string;
  caps: string[];
  auditReasons: string[];
}

export interface HexCombatScoreboard {
  attack: HexCombatSideEvidence;
  defense: HexCombatSideEvidence;
  neutralScore: number;
}

export interface HexCombatCasualty {
  agentId: string;
  targetAgentId: string;
  teamId: string;
  side: HexSide;
  result: "killed" | "wounded";
  reason: string;
  killerAgentId?: string;
  assisterAgentIds: string[];
  attributionReasons?: string[];
  targetSelectionReasons?: string[];
}

export interface HexCombatAttributionHistory {
  roundKillCountsByAgent: Record<string, number>;
  phaseKillCountsByAgent: Record<string, number>;
  lastKillPhaseIndexByAgent: Record<string, number>;
}

export interface HexCombatSuppression {
  agentId: string;
  teamId: string;
  side: HexSide;
  result: "suppressed" | "forced_back";
  reason: string;
}

export interface HexCombatVarianceAudit {
  mode: HexCombatVarianceMode;
  varianceApplied: boolean;
  reason: string;
  beforeAttackScore: number;
  beforeDefenseScore: number;
  afterAttackScore: number;
  afterDefenseScore: number;
  varianceDelta: number;
  seed?: string;
}

export interface HexCombatAudit {
  businessWeight: 65;
  financeWeight?: 65;
  csWeight: 35;
  financeEvidenceApplied?: boolean;
  triggerReasons: HexCombatTriggerReason[];
  variance: HexCombatVarianceAudit;
  economy: HexCombatEconomyAudit;
  sitePressure?: boolean;
  plantDenied?: boolean;
  tradeOpportunity?: boolean;
  contactThreat?: {
    level: HexCombatContactThreatLevel;
    lethalEligible: boolean;
    lethalGateReasons: string[];
    lethalGateBlockedReasons: string[];
    lineOfFireExposure?: boolean;
    openSightNoCover?: boolean;
    samePointExposure?: boolean;
    objectiveExposure?: boolean;
    implicitDuelFromMovement?: boolean;
    coverBlockedLethal?: boolean;
  };
  contactRetention?: {
    relevanceScore?: number;
    retentionReasons: string[];
    prunedCandidateCount?: number;
  };
  duelPairing?: {
    primaryDuelPairId?: string;
    primaryPressureKey?: string;
    duelPairCount: number;
    fireLaneCount: number;
    pressureKeys: string[];
    reasons: string[];
  };
  roleContributions?: Array<{
    agentId: string;
    side: HexSide;
    roleLabel: string;
    contributionType: "killer" | "assist" | "neutral";
    scoreDelta: number;
    reasons: string[];
  }>;
}

export interface HexCombatFinanceEvidenceAdoption {
  side: HexSide;
  acceptedEvidenceRefs: string[];
  rejectedEvidenceRefs: string[];
  missingEvidenceApplied: string[];
  scoreCapRefs: string[];
  scoreCaps: HexCombatFinanceScoreCapAudit[];
  acceptedClaims: string[];
  rejectedClaims: string[];
  acceptedChallenges: string[];
  rejectedChallenges: string[];
  sideScore: number;
  stanceScore: number;
  challengeScore: number;
  financialResult: HexCombatFinancialResult;
  combatEffectAllowed: HexCombatEffectAllowed[];
  adoptionReasons: string[];
  rejectionReasons: string[];
  financeReasonZh: string[];
  auditReasons: string[];
}

export interface HexCombatEconomyAudit {
  economyEvidenceApplied: boolean;
  attack: HexEconomyCombatEvidence;
  defense: HexEconomyCombatEvidence;
  reasons: string[];
}

export interface HexCombatResolutionCore {
  contactId: string;
  phaseId: HexPhaseId;
  phaseIndex: number;
  participants: HexCombatParticipant[];
  duelPairs?: HexCombatDuelPair[];
  fireLanes?: HexCombatFireLane[];
  pressureKeys?: string[];
  scores: HexCombatScoreboard;
  advantage: HexCombatAdvantage;
  businessVerdict: HexCombatBusinessVerdict;
  financeVerdict?: HexCombatFinanceVerdict;
  financeEvidenceAdoption?: {
    attack: HexCombatFinanceEvidenceAdoption;
    defense: HexCombatFinanceEvidenceAdoption;
  };
  financeProjection?: HexCombatFinanceProjection;
  financeReasonZh?: string[];
  csReasonZh?: string[];
  businessReasons: string[];
  financeReasons?: string[];
  csReasons: string[];
  verdict: HexCombatVerdict;
  casualties: HexCombatCasualty[];
  suppressions: HexCombatSuppression[];
  regionControlHint: HexCombatControlHint;
  audit: HexCombatAudit;
}

export interface HexCombatResolution extends HexCombatResolutionCore {
  memoryEvents: HexPhaseMemoryEvent[];
}
