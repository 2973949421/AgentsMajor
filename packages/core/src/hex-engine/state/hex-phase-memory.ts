import type { HexCell, HexMapAsset } from "@agent-major/shared";
import { validateHexMoveBudget } from "../path/index.js";

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
  | "agent_not_carrying_c4";

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

export function initializeHexRoundMemory(input: InitializeHexRoundMemoryInput): HexRoundMemory {
  const cellsById = buildCellsById(input.asset);
  const phaseIndex = input.phaseIndex ?? 0;
  const phaseId = input.phaseId ?? "default_opening";
  const apBudget = input.asset.apModel.baseApPerPhase;

  const agents = input.agents.map((agent): HexAgentPhaseMemory => {
    const cell = requirePlayableCell(cellsById, agent.startCellId);
    const carryingC4 = agent.carryingC4 ?? agent.agentId === input.bombCarrierAgentId;
    const memory: HexAgentPhaseMemory = {
      agentId: agent.agentId,
      teamId: agent.teamId,
      side: agent.side,
      currentCellId: cell.cellId,
      currentPointIds: cell.pointIds,
      lifeStatus: agent.lifeStatus ?? "alive",
      apBudget,
      apSpent: 0,
      apRemaining: apBudget,
      knownEnemies: [],
      lastSeenEnemies: [],
      carryingC4
    };
    if (cell.regionId) {
      memory.currentRegionId = cell.regionId;
    }
    return memory;
  });

  const carrierAgentId = input.bombCarrierAgentId ?? agents.find((agent) => agent.carryingC4)?.agentId;
  return {
    phaseIndex,
    phaseId,
    agents,
    bombState: carrierAgentId
      ? {
          carrierAgentId,
          planted: false,
          defused: false
        }
      : {
          planted: false,
          defused: false
        },
    phaseEvents: [],
    rejectedEvents: []
  };
}

export function advanceHexPhaseMemory(input: AdvanceHexPhaseMemoryInput): HexRoundMemory {
  const cellsById = buildCellsById(input.asset);
  const nextMemory = prepareHexPhaseStartMemory(input);

  for (const event of input.events) {
    applyEvent({
      asset: input.asset,
      cellsById,
      memory: nextMemory,
      event
    });
  }

  return nextMemory;
}

export function prepareHexPhaseStartMemory(input: PrepareHexPhaseStartMemoryInput): HexRoundMemory {
  const nextPhaseIndex = input.nextPhaseIndex ?? input.previousMemory.phaseIndex + 1;
  return {
    phaseIndex: nextPhaseIndex,
    phaseId: input.nextPhaseId,
    agents: input.previousMemory.agents.map((agent) => resetAgentForNextPhase(agent, nextPhaseIndex)),
    bombState: { ...input.previousMemory.bombState },
    phaseEvents: [],
    rejectedEvents: [...input.previousMemory.rejectedEvents]
  };
}

export function buildHexAgentMemoryContext(input: BuildHexAgentMemoryContextInput): HexAgentMemoryPromptContext {
  const agent = input.memory.agents.find((candidate) => candidate.agentId === input.agentId);
  if (!agent) {
    throw new Error(`Unknown hex memory agent: ${input.agentId}`);
  }

  const agentContext: HexAgentMemoryPromptContext["agent"] = {
    agentId: agent.agentId,
    teamId: agent.teamId,
    side: agent.side,
    currentCellId: agent.currentCellId,
    currentPointIds: agent.currentPointIds,
    lifeStatus: agent.lifeStatus,
    apBudget: agent.apBudget,
    apSpent: agent.apSpent,
    apRemaining: agent.apRemaining,
    carryingC4: agent.carryingC4
  };
  if (agent.currentRegionId) {
    agentContext.currentRegionId = agent.currentRegionId;
  }

  const context: HexAgentMemoryPromptContext = {
    phaseIndex: input.memory.phaseIndex,
    phaseId: input.memory.phaseId,
    agent: agentContext,
    bombState: { ...input.memory.bombState },
    knownEnemies: agent.knownEnemies.map((enemy) => ({ ...enemy, pointIds: [...enemy.pointIds] })),
    lastSeenEnemies: agent.lastSeenEnemies.map((enemy) => ({
      ...enemy,
      pointIds: [...enemy.pointIds],
      note: "historical_last_seen_not_current_truth"
    }))
  };
  if (agent.actionResultSummary) {
    context.actionResultSummary = agent.actionResultSummary;
  }
  if (agent.businessExecutionSummary) {
    context.businessExecutionSummary = agent.businessExecutionSummary;
  }
  return context;
}

function applyEvent(input: {
  asset: HexMapAsset;
  cellsById: Map<string, HexCell>;
  memory: HexRoundMemory;
  event: HexPhaseMemoryEvent;
}): void {
  switch (input.event.type) {
    case "move":
      applyMoveEvent({
        asset: input.asset,
        cellsById: input.cellsById,
        memory: input.memory,
        event: input.event
      });
      return;
    case "action_result":
      applyActionResultEvent(input.memory, input.event);
      return;
    case "enemy_spotted":
      applyEnemySpottedEvent(input.memory, input.cellsById, input.event);
      return;
    case "enemy_lost":
      applyEnemyLostEvent(input.memory, input.event);
      return;
    case "life_status_changed":
      applyLifeStatusChangedEvent(input.memory, input.event);
      return;
    case "bomb_carrier_changed":
      applyBombCarrierChangedEvent(input.memory, input.event);
      return;
    case "bomb_planted":
      applyBombPlantedEvent(input.memory, input.cellsById, input.event);
      return;
    case "bomb_defused":
      input.memory.bombState.defused = true;
      input.memory.phaseEvents.push(input.event);
      return;
    case "phase_closed":
      input.memory.phaseEvents.push(input.event);
      return;
  }
}

function applyMoveEvent(input: {
  asset: HexMapAsset;
  cellsById: Map<string, HexCell>;
  memory: HexRoundMemory;
  event: HexMoveMemoryEvent;
}): void {
  const agent = findMutableAgent(input.memory, input.event.agentId);
  if (!agent) {
    reject(input.memory, input.event, "unknown_agent", `Unknown agent ${input.event.agentId}`);
    return;
  }
  if (agent.lifeStatus === "dead") {
    reject(input.memory, input.event, "dead_agent_cannot_act", `Dead agent ${agent.agentId} cannot move`);
    return;
  }
  const targetCell = input.cellsById.get(input.event.toCellId);
  if (!targetCell) {
    reject(input.memory, input.event, "unknown_cell", `Unknown target cell ${input.event.toCellId}`);
    return;
  }
  if (!targetCell.playable) {
    reject(input.memory, input.event, "unplayable_cell", `Target cell ${input.event.toCellId} is not playable`);
    return;
  }

  const budget = validateHexMoveBudget({
    asset: input.asset,
    fromCellId: agent.currentCellId,
    toCellId: input.event.toCellId,
    apBudget: agent.apRemaining
  });
  if (!budget.reachable) {
    reject(input.memory, input.event, "move_no_path", budget.failureReason ?? "Move has no reachable path");
    return;
  }
  if (!budget.withinBudget || budget.apCost === undefined) {
    reject(input.memory, input.event, "move_over_budget", `Move costs ${budget.apCost ?? "unknown"} AP, remaining ${agent.apRemaining}`);
    return;
  }

  agent.currentCellId = targetCell.cellId;
  if (targetCell.regionId) {
    agent.currentRegionId = targetCell.regionId;
  } else {
    delete agent.currentRegionId;
  }
  agent.currentPointIds = [...targetCell.pointIds];
  agent.apSpent = roundAp(agent.apSpent + budget.apCost);
  agent.apRemaining = Math.max(0, roundAp(agent.apBudget - agent.apSpent));
  input.memory.phaseEvents.push(input.event);
}

function applyActionResultEvent(memory: HexRoundMemory, event: HexActionResultMemoryEvent): void {
  const agent = findMutableAgent(memory, event.agentId);
  if (!agent) {
    reject(memory, event, "unknown_agent", `Unknown agent ${event.agentId}`);
    return;
  }
  agent.actionResultSummary = `${event.status}: ${event.summary}`;
  if (event.businessExecutionSummary) {
    agent.businessExecutionSummary = event.businessExecutionSummary;
  }
  memory.phaseEvents.push(event);
}

function applyEnemySpottedEvent(memory: HexRoundMemory, cellsById: Map<string, HexCell>, event: HexEnemySpottedMemoryEvent): void {
  const observer = findMutableAgent(memory, event.observerAgentId);
  if (!observer) {
    reject(memory, event, "unknown_agent", `Unknown observer ${event.observerAgentId}`);
    return;
  }
  const enemyCell = cellsById.get(event.enemyCellId);
  if (!enemyCell) {
    reject(memory, event, "unknown_cell", `Unknown enemy cell ${event.enemyCellId}`);
    return;
  }

  observer.lastSeenEnemies = observer.lastSeenEnemies.filter((enemy) => enemy.enemyAgentId !== event.enemyAgentId);
  observer.knownEnemies = [
    ...observer.knownEnemies.filter((enemy) => enemy.enemyAgentId !== event.enemyAgentId),
    materializeEnemyInfo(event, enemyCell, memory.phaseIndex)
  ];
  memory.phaseEvents.push(event);
}

function applyEnemyLostEvent(memory: HexRoundMemory, event: HexEnemyLostMemoryEvent): void {
  const observer = findMutableAgent(memory, event.observerAgentId);
  if (!observer) {
    reject(memory, event, "unknown_agent", `Unknown observer ${event.observerAgentId}`);
    return;
  }
  const enemy = observer.knownEnemies.find((candidate) => candidate.enemyAgentId === event.enemyAgentId);
  if (enemy) {
    observer.knownEnemies = observer.knownEnemies.filter((candidate) => candidate.enemyAgentId !== event.enemyAgentId);
    observer.lastSeenEnemies = upsertLastSeen(observer.lastSeenEnemies, demoteKnownEnemy(enemy, memory.phaseIndex));
  }
  memory.phaseEvents.push(event);
}

function applyLifeStatusChangedEvent(memory: HexRoundMemory, event: HexLifeStatusChangedMemoryEvent): void {
  const agent = findMutableAgent(memory, event.agentId);
  if (!agent) {
    reject(memory, event, "unknown_agent", `Unknown agent ${event.agentId}`);
    return;
  }
  agent.lifeStatus = event.lifeStatus;
  if (event.lifeStatus === "dead") {
    agent.apRemaining = 0;
    if (agent.carryingC4) {
      agent.carryingC4 = false;
      delete memory.bombState.carrierAgentId;
    }
  }
  memory.phaseEvents.push(event);
}

function applyBombCarrierChangedEvent(memory: HexRoundMemory, event: HexBombCarrierChangedMemoryEvent): void {
  for (const agent of memory.agents) {
    agent.carryingC4 = event.carrierAgentId === agent.agentId;
  }
  if (event.carrierAgentId) {
    memory.bombState.carrierAgentId = event.carrierAgentId;
  } else {
    delete memory.bombState.carrierAgentId;
  }
  memory.phaseEvents.push(event);
}

function applyBombPlantedEvent(memory: HexRoundMemory, cellsById: Map<string, HexCell>, event: HexBombPlantedMemoryEvent): void {
  const agent = findMutableAgent(memory, event.agentId);
  if (!agent) {
    reject(memory, event, "unknown_agent", `Unknown agent ${event.agentId}`);
    return;
  }
  if (!agent.carryingC4) {
    reject(memory, event, "agent_not_carrying_c4", `Agent ${event.agentId} is not carrying C4`);
    return;
  }
  const cell = cellsById.get(event.cellId);
  if (!cell) {
    reject(memory, event, "unknown_cell", `Unknown plant cell ${event.cellId}`);
    return;
  }
  if (!cell.flags.includes("bombsite_a") && !cell.flags.includes("bombsite_b")) {
    reject(memory, event, "invalid_bombsite", `Cell ${event.cellId} is not a bombsite`);
    return;
  }
  agent.carryingC4 = false;
  memory.bombState.planted = true;
  memory.bombState.plantedCellId = event.cellId;
  memory.bombState.plantedAtPhaseIndex = memory.phaseIndex;
  delete memory.bombState.carrierAgentId;
  memory.phaseEvents.push(event);
}

function resetAgentForNextPhase(agent: HexAgentPhaseMemory, nextPhaseIndex: number): HexAgentPhaseMemory {
  const lastSeen = [
    ...agent.lastSeenEnemies.map((enemy) => decayLastSeenEnemy(enemy, nextPhaseIndex)),
    ...agent.knownEnemies.map((enemy) => decayLastSeenEnemy(demoteKnownEnemy(enemy, nextPhaseIndex), nextPhaseIndex))
  ];
  const reset: HexAgentPhaseMemory = {
    agentId: agent.agentId,
    teamId: agent.teamId,
    side: agent.side,
    currentCellId: agent.currentCellId,
    currentPointIds: [...agent.currentPointIds],
    lifeStatus: agent.lifeStatus,
    apBudget: agent.lifeStatus === "dead" ? 0 : agent.apBudget,
    apSpent: 0,
    apRemaining: agent.lifeStatus === "dead" ? 0 : agent.apBudget,
    knownEnemies: [],
    lastSeenEnemies: dedupeLastSeen(lastSeen),
    carryingC4: agent.carryingC4
  };
  if (agent.currentRegionId) {
    reset.currentRegionId = agent.currentRegionId;
  }
  if (agent.actionResultSummary) {
    reset.actionResultSummary = agent.actionResultSummary;
  }
  if (agent.businessExecutionSummary) {
    reset.businessExecutionSummary = agent.businessExecutionSummary;
  }
  return reset;
}

function materializeEnemyInfo(event: HexEnemySpottedMemoryEvent, cell: HexCell, phaseIndex: number): HexEnemyInfo {
  const info: HexEnemyInfo = {
    enemyAgentId: event.enemyAgentId,
    enemyTeamId: event.enemyTeamId,
    cellId: cell.cellId,
    pointIds: [...cell.pointIds],
    source: event.source,
    seenAtPhaseIndex: phaseIndex,
    confidence: 1
  };
  if (cell.regionId) {
    info.regionId = cell.regionId;
  }
  return info;
}

function demoteKnownEnemy(enemy: HexEnemyInfo, phaseIndex: number): HexLastSeenEnemyInfo {
  return {
    ...enemy,
    pointIds: [...enemy.pointIds],
    lastSeenPhaseIndex: enemy.seenAtPhaseIndex,
    confidence: 0.65,
    stale: phaseIndex - enemy.seenAtPhaseIndex > 2,
    historical: true
  };
}

function decayLastSeenEnemy(enemy: HexLastSeenEnemyInfo, phaseIndex: number): HexLastSeenEnemyInfo {
  const phaseAge = Math.max(0, phaseIndex - enemy.lastSeenPhaseIndex);
  const confidence = Math.max(0, roundConfidence(enemy.confidence - 0.2));
  return {
    ...enemy,
    pointIds: [...enemy.pointIds],
    confidence,
    stale: confidence <= 0.25 || phaseAge > 2,
    historical: true
  };
}

function dedupeLastSeen(enemies: HexLastSeenEnemyInfo[]): HexLastSeenEnemyInfo[] {
  const byEnemyId = new Map<string, HexLastSeenEnemyInfo>();
  for (const enemy of enemies) {
    const existing = byEnemyId.get(enemy.enemyAgentId);
    if (!existing || enemy.confidence > existing.confidence) {
      byEnemyId.set(enemy.enemyAgentId, enemy);
    }
  }
  return [...byEnemyId.values()];
}

function upsertLastSeen(enemies: HexLastSeenEnemyInfo[], nextEnemy: HexLastSeenEnemyInfo): HexLastSeenEnemyInfo[] {
  return [...enemies.filter((enemy) => enemy.enemyAgentId !== nextEnemy.enemyAgentId), nextEnemy];
}

function findMutableAgent(memory: HexRoundMemory, agentId: string): HexAgentPhaseMemory | undefined {
  return memory.agents.find((agent) => agent.agentId === agentId);
}

function buildCellsById(asset: HexMapAsset): Map<string, HexCell> {
  return new Map(asset.cells.map((cell) => [cell.cellId, cell]));
}

function requirePlayableCell(cellsById: Map<string, HexCell>, cellId: string): HexCell {
  const cell = cellsById.get(cellId);
  if (!cell) {
    throw new Error(`Unknown hex cell: ${cellId}`);
  }
  if (!cell.playable) {
    throw new Error(`Hex cell is not playable: ${cellId}`);
  }
  return cell;
}

function reject(memory: HexRoundMemory, event: HexPhaseMemoryEvent, reason: HexMemoryRejectionReason, detail: string): void {
  memory.rejectedEvents.push({
    event,
    reason,
    detail
  });
}

function roundAp(value: number): number {
  return Number(value.toFixed(4));
}

function roundConfidence(value: number): number {
  return Number(value.toFixed(2));
}
