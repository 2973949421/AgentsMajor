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
  | "plant_pressure";
export type HexCombatAdvantage = "attack" | "defense" | "contested";
export type HexCombatVerdict = "kill" | "wound_or_forced_back" | "contested_suppression";
export type HexCombatControlHint = "attack" | "defense" | "contested" | "neutral";
export type HexCombatVarianceMode = "off" | "audited";
export type HexCombatBusinessVerdict =
  | "proof_rebutted_challenge"
  | "challenge_succeeded"
  | "contested_no_business_resolution";

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
  minCellDistance?: number;
}

export interface HexCombatSideEvidence {
  businessScore: number;
  csScore: number;
  totalScore: number;
  reasons: string[];
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
  csWeight: 35;
  triggerReasons: HexCombatTriggerReason[];
  variance: HexCombatVarianceAudit;
  economy: HexCombatEconomyAudit;
  sitePressure?: boolean;
  plantDenied?: boolean;
  tradeOpportunity?: boolean;
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
  scores: HexCombatScoreboard;
  advantage: HexCombatAdvantage;
  businessVerdict: HexCombatBusinessVerdict;
  businessReasons: string[];
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
