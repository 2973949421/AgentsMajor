import type { HexMapAsset } from "@agent-major/shared";

export const hexPhaseIds = [
  "default_opening",
  "first_contact",
  "mid_round_decision",
  "execute_or_retake",
  "post_plant_or_clutch"
] as const;

export type HexPhaseId = (typeof hexPhaseIds)[number];
export type HexSide = "attack" | "defense";
export type HexLifeStatus = "alive" | "wounded" | "dead";
export type HexEnemyInfoSource = "spotted_event" | "combat_contact" | "same_region_contact";
export type HexActionResultStatus = "success" | "partial" | "failed" | "rejected";

export interface HexEnemyInfo {
  enemyAgentId: string;
  enemyTeamId: string;
  cellId: string;
  regionId?: string;
  pointIds: string[];
  source: HexEnemyInfoSource;
  seenAtPhaseIndex: number;
  confidence: number;
}

export interface HexLastSeenEnemyInfo extends HexEnemyInfo {
  lastSeenPhaseIndex: number;
  stale: boolean;
  historical: true;
}

export interface HexAgentPhaseMemory {
  agentId: string;
  teamId: string;
  side: HexSide;
  currentCellId: string;
  currentRegionId?: string;
  currentPointIds: string[];
  lifeStatus: HexLifeStatus;
  apBudget: number;
  apSpent: number;
  apRemaining: number;
  knownEnemies: HexEnemyInfo[];
  lastSeenEnemies: HexLastSeenEnemyInfo[];
  carryingC4: boolean;
  actionResultSummary?: string;
  businessExecutionSummary?: string;
}

export interface HexBombState {
  carrierAgentId?: string;
  droppedCellId?: string;
  lastCarrierAgentId?: string;
  planted: boolean;
  plantedCellId?: string;
  plantedAtPhaseIndex?: number;
  defused: boolean;
}

export interface HexRoundMemory {
  phaseIndex: number;
  phaseId: HexPhaseId;
  agents: HexAgentPhaseMemory[];
  bombState: HexBombState;
  phaseEvents: HexPhaseMemoryEvent[];
  rejectedEvents: HexRejectedPhaseMemoryEvent[];
}

export interface HexInitialAgentInput {
  agentId: string;
  teamId: string;
  side: HexSide;
  startCellId: string;
  lifeStatus?: HexLifeStatus;
  carryingC4?: boolean;
}

export interface InitializeHexRoundMemoryInput {
  asset: HexMapAsset;
  agents: HexInitialAgentInput[];
  phaseId?: HexPhaseId;
  phaseIndex?: number;
  bombCarrierAgentId?: string;
}

export type HexPhaseMemoryEvent =
  | HexMoveMemoryEvent
  | HexActionResultMemoryEvent
  | HexEnemySpottedMemoryEvent
  | HexEnemyLostMemoryEvent
  | HexLifeStatusChangedMemoryEvent
  | HexBombCarrierChangedMemoryEvent
  | HexBombDroppedMemoryEvent
  | HexBombPickedUpMemoryEvent
  | HexBombPlantedMemoryEvent
  | HexBombDefusedMemoryEvent
  | HexPhaseClosedMemoryEvent;

export interface HexMoveMemoryEvent {
  type: "move";
  agentId: string;
  toCellId: string;
}

export interface HexActionResultMemoryEvent {
  type: "action_result";
  agentId: string;
  status: HexActionResultStatus;
  summary: string;
  businessExecutionSummary?: string;
}

export interface HexEnemySpottedMemoryEvent {
  type: "enemy_spotted";
  observerAgentId: string;
  enemyAgentId: string;
  enemyTeamId: string;
  enemyCellId: string;
  source: HexEnemyInfoSource;
}

export interface HexEnemyLostMemoryEvent {
  type: "enemy_lost";
  observerAgentId: string;
  enemyAgentId: string;
}

export interface HexLifeStatusChangedMemoryEvent {
  type: "life_status_changed";
  agentId: string;
  lifeStatus: HexLifeStatus;
}

export interface HexBombCarrierChangedMemoryEvent {
  type: "bomb_carrier_changed";
  carrierAgentId?: string;
}

export interface HexBombDroppedMemoryEvent {
  type: "bomb_dropped";
  agentId: string;
  cellId: string;
}

export interface HexBombPickedUpMemoryEvent {
  type: "bomb_picked_up";
  agentId: string;
  cellId: string;
}

export interface HexBombPlantedMemoryEvent {
  type: "bomb_planted";
  agentId: string;
  cellId: string;
}

export interface HexBombDefusedMemoryEvent {
  type: "bomb_defused";
  agentId: string;
}

export interface HexPhaseClosedMemoryEvent {
  type: "phase_closed";
}

export interface AdvanceHexPhaseMemoryInput {
  asset: HexMapAsset;
  previousMemory: HexRoundMemory;
  events: HexPhaseMemoryEvent[];
  nextPhaseId: HexPhaseId;
  nextPhaseIndex?: number;
}

export interface PrepareHexPhaseStartMemoryInput {
  previousMemory: HexRoundMemory;
  nextPhaseId: HexPhaseId;
  nextPhaseIndex?: number;
}

export type HexMemoryRejectionReason =
  | "unknown_agent"
  | "dead_agent_cannot_act"
  | "unknown_cell"
  | "unplayable_cell"
  | "move_over_budget"
  | "move_no_path"
  | "invalid_bombsite"
  | "agent_not_carrying_c4"
  | "agent_not_on_objective_cell"
  | "invalid_bomb_defuse"
  | "invalid_bomb_pickup";

export interface HexRejectedPhaseMemoryEvent {
  event: HexPhaseMemoryEvent;
  reason: HexMemoryRejectionReason;
  detail: string;
}

export interface HexAgentMemoryPromptContext {
  phaseIndex: number;
  phaseId: HexPhaseId;
  agent: {
    agentId: string;
    teamId: string;
    side: HexSide;
    currentCellId: string;
    currentRegionId?: string;
    currentPointIds: string[];
    lifeStatus: HexLifeStatus;
    apBudget: number;
    apSpent: number;
    apRemaining: number;
    carryingC4: boolean;
  };
  bombState: HexBombState;
  knownEnemies: HexEnemyInfo[];
  lastSeenEnemies: Array<HexLastSeenEnemyInfo & { note: "historical_last_seen_not_current_truth" }>;
  actionResultSummary?: string;
  businessExecutionSummary?: string;
}

export interface BuildHexAgentMemoryContextInput {
  memory: HexRoundMemory;
  agentId: string;
}
