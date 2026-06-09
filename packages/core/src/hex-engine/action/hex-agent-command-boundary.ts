import type { HexCell, HexMapAsset } from "@agent-major/shared";
import { getHexAgentEconomyContext, type HexRoundEconomyContext } from "../economy/index.js";
import { buildHexPathGraph, calculateHexApCost } from "../path/index.js";
import { buildHexAgentMemoryContext, type HexAgentMemoryPromptContext, type HexPhaseId, type HexRoundMemory, type HexSide } from "../state/index.js";

export const hexAgentActionTypes = [
  "hold_position",
  "move",
  "watch_angle",
  "peek",
  "gather_info",
  "use_utility",
  "map_control",
  "prepare_trade",
  "seek_duel",
  "execute_site",
  "plant_bomb",
  "defuse_bomb",
  "retake",
  "rotate",
  "save",
  "lurk",
  "fake",
  "boost"
] as const;

export type HexAgentActionType = (typeof hexAgentActionTypes)[number];

export interface HexReachableCellSummary {
  cellId: string;
  regionId?: string;
  pointIds: string[];
  flags: string[];
  apCost: number;
}

export interface HexAgentCommandRequest {
  schemaVersion: 1;
  phaseId: HexPhaseId;
  phaseIndex: number;
  map: {
    mapSlug: string;
    cellsPerAp: number;
  };
  agent: HexAgentMemoryPromptContext["agent"];
  bombState: HexAgentMemoryPromptContext["bombState"];
  knownEnemies: HexAgentMemoryPromptContext["knownEnemies"];
  lastSeenEnemies: HexAgentMemoryPromptContext["lastSeenEnemies"];
  reachableCells: HexReachableCellSummary[];
  allowedActionTypes: HexAgentActionType[];
  economy?: HexAgentEconomyPromptContext;
  constraints: string[];
  actionResultSummary?: string;
  businessExecutionSummary?: string;
}

export interface HexAgentEconomyPromptContext {
  economyPosture: string;
  buyType: string;
  loadoutPackage: string;
  outputBudget: number;
  dropSent: number;
  dropReceived: number;
  resourceTier: string;
  utilityTier: string;
  economyAllowedActionTypes: HexAgentActionType[];
  economyConstraints: string[];
  notes: string[];
}

export interface HexAgentActionDraft {
  agentId: string;
  phaseId: HexPhaseId;
  currentCellId: string;
  targetCellId: string;
  actionType: HexAgentActionType;
  businessIntent: string;
  tacticalIntent?: string;
  riskNotes?: string[];
  confidence?: number;
}

export interface NormalizeHexAgentActionDraftInput {
  rawDraft: unknown;
  request: HexAgentCommandRequest;
}

export interface NormalizeHexAgentActionDraftResult {
  draft?: HexAgentActionDraft;
  errors: string[];
  ignoredFields: string[];
}

const allowedDraftFields = new Set([
  "agentId",
  "phaseId",
  "currentCellId",
  "targetCellId",
  "actionType",
  "businessIntent",
  "tacticalIntent",
  "riskNotes",
  "confidence"
]);

const forbiddenDraftFields = new Set([
  "winner",
  "winnerTeamId",
  "roundWinType",
  "kills",
  "killLedger",
  "casualties",
  "damage",
  "bombPlanted",
  "bombDefused",
  "economyDelta",
  "dbFact",
  "roundReport",
  "hiddenEnemyPosition"
]);

export function buildHexAgentCommandRequest(input: {
  asset: HexMapAsset;
  memory: HexRoundMemory;
  agentId: string;
  allowedActionTypes?: readonly HexAgentActionType[];
  economyContext?: HexRoundEconomyContext;
}): HexAgentCommandRequest {
  const context = buildHexAgentMemoryContext({
    memory: input.memory,
    agentId: input.agentId
  });
  const reachableCells = buildReachableCellSummaries(input.asset, context.agent.currentCellId, context.agent.apRemaining);
  const economy = input.economyContext
    ? getHexAgentEconomyContext({
        economyContext: input.economyContext,
        agentId: input.agentId
      })
    : undefined;
  const request: HexAgentCommandRequest = {
    schemaVersion: 1,
    phaseId: input.memory.phaseId,
    phaseIndex: input.memory.phaseIndex,
    map: {
      mapSlug: input.asset.mapSlug,
      cellsPerAp: input.asset.apModel.cellsPerAp
    },
    agent: context.agent,
    bombState: context.bombState,
    knownEnemies: context.knownEnemies,
    lastSeenEnemies: context.lastSeenEnemies,
    reachableCells,
    allowedActionTypes: [...(input.allowedActionTypes ?? hexAgentActionTypes)],
    constraints: [
      "Only output one Hex agent action draft for the requested agent.",
      "Do not output winner, roundWinType, kills, damage, bomb results, economy deltas, database facts, or hidden enemy positions.",
      "targetCellId must come from reachableCells.",
      "currentCellId must match the agent currentCellId.",
      "businessIntent is required and must explain the business-plan purpose of the CS action.",
      "lastSeenEnemies are historical hints, not current enemy truth.",
      "The code validates movement, AP, C4 legality, and final game facts."
    ]
  };
  if (economy) {
    request.economy = {
      economyPosture: economy.economyPosture,
      buyType: economy.buyType,
      loadoutPackage: economy.loadoutPackage,
      outputBudget: economy.outputBudget,
      dropSent: economy.dropSent,
      dropReceived: economy.dropReceived,
      resourceTier: economy.resourceTier,
      utilityTier: economy.utilityTier,
      economyAllowedActionTypes: [...economy.allowedActionTypes],
      economyConstraints: [...economy.constraints],
      notes: [...economy.notes]
    };
    request.constraints.push(
      "Economy context is already resolved before this phase; do not modify buy type, drops, output budget, or economy state.",
      "Low resource agents must not claim a full execute_site without explicit future desperation support.",
      "Utility actions must respect utilityTier and cannot invent unavailable utility.",
      "Economy advantage must be converted into map control, coordination, or business evidence; it is not a winner field."
    );
  }
  if (context.actionResultSummary) {
    request.actionResultSummary = context.actionResultSummary;
  }
  if (context.businessExecutionSummary) {
    request.businessExecutionSummary = context.businessExecutionSummary;
  }
  return request;
}

export function normalizeHexAgentActionDraft(input: NormalizeHexAgentActionDraftInput): NormalizeHexAgentActionDraftResult {
  const rawDraft = extractDraftObject(input.rawDraft);
  const errors: string[] = [];
  const ignoredFields: string[] = [];

  if (!isRecord(rawDraft)) {
    return {
      errors: ["draft:not_object"],
      ignoredFields
    };
  }

  for (const key of Object.keys(rawDraft)) {
    if (!allowedDraftFields.has(key) || forbiddenDraftFields.has(key)) {
      ignoredFields.push(key);
    }
  }

  const agentId = readString(rawDraft.agentId);
  if (agentId !== input.request.agent.agentId) {
    errors.push("draft:invalid_agentId");
  }

  const phaseId = readString(rawDraft.phaseId);
  if (phaseId !== input.request.phaseId) {
    errors.push("draft:invalid_phaseId");
  }

  const currentCellId = readString(rawDraft.currentCellId);
  if (currentCellId !== input.request.agent.currentCellId) {
    errors.push("draft:invalid_currentCellId");
  }

  const targetCellId = readString(rawDraft.targetCellId);
  if (!targetCellId) {
    errors.push("draft:missing_targetCellId");
  }

  const actionType = readString(rawDraft.actionType);
  if (!isHexAgentActionType(actionType)) {
    errors.push("draft:invalid_actionType");
  }

  const businessIntent = readString(rawDraft.businessIntent);
  if (!businessIntent) {
    errors.push("draft:missing_businessIntent");
  }

  if (errors.length > 0) {
    return {
      errors,
      ignoredFields
    };
  }

  const draft: HexAgentActionDraft = {
    agentId,
    phaseId: input.request.phaseId,
    currentCellId,
    targetCellId,
    actionType: actionType as HexAgentActionType,
    businessIntent
  };
  const tacticalIntent = readOptionalString(rawDraft.tacticalIntent);
  if (tacticalIntent) {
    draft.tacticalIntent = tacticalIntent;
  }
  const riskNotes = readStringArray(rawDraft.riskNotes);
  if (riskNotes.length > 0) {
    draft.riskNotes = riskNotes;
  }
  const confidence = readConfidence(rawDraft.confidence);
  if (confidence !== undefined) {
    draft.confidence = confidence;
  }
  return {
    draft,
    errors,
    ignoredFields
  };
}

export function isHexAgentActionType(value: string): value is HexAgentActionType {
  return (hexAgentActionTypes as readonly string[]).includes(value);
}

function buildReachableCellSummaries(asset: HexMapAsset, fromCellId: string, apRemaining: number): HexReachableCellSummary[] {
  const cellsById = new Map(asset.cells.map((cell) => [cell.cellId, cell]));
  const startCell = cellsById.get(fromCellId);
  if (!startCell?.playable || apRemaining < 0) {
    return [];
  }

  const graph = buildHexPathGraph(asset);
  const bestPaths = new Map<string, { cellIds: string[]; verticalLinkIds: string[]; apCost: number }>();
  const queue: Array<{ cellId: string; cellIds: string[]; verticalLinkIds: string[] }> = [
    {
      cellId: fromCellId,
      cellIds: [fromCellId],
      verticalLinkIds: []
    }
  ];
  bestPaths.set(fromCellId, {
    cellIds: [fromCellId],
    verticalLinkIds: [],
    apCost: 0
  });

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of graph.get(current.cellId) ?? []) {
      const nextCellIds = [...current.cellIds, edge.toCellId];
      const nextVerticalLinkIds = edge.verticalLinkId ? [...current.verticalLinkIds, edge.verticalLinkId] : current.verticalLinkIds;
      const apCost = calculateHexApCost({
        asset,
        pathCellIds: nextCellIds,
        verticalLinkIds: nextVerticalLinkIds
      }).apCost;
      if (apCost > apRemaining) {
        continue;
      }
      const existing = bestPaths.get(edge.toCellId);
      if (existing && existing.apCost <= apCost) {
        continue;
      }
      bestPaths.set(edge.toCellId, {
        cellIds: nextCellIds,
        verticalLinkIds: nextVerticalLinkIds,
        apCost
      });
      queue.push({
        cellId: edge.toCellId,
        cellIds: nextCellIds,
        verticalLinkIds: nextVerticalLinkIds
      });
    }
  }

  return [...bestPaths.entries()]
    .map(([cellId, path]) => {
      const cell = cellsById.get(cellId);
      return cell?.playable ? summarizeCell(cell, path.apCost) : undefined;
    })
    .filter((cell): cell is HexReachableCellSummary => Boolean(cell))
    .sort((left, right) => left.apCost - right.apCost || left.cellId.localeCompare(right.cellId));
}

function summarizeCell(cell: HexCell, apCost: number): HexReachableCellSummary {
  const summary: HexReachableCellSummary = {
    cellId: cell.cellId,
    pointIds: [...cell.pointIds],
    flags: [...cell.flags],
    apCost
  };
  if (cell.regionId) {
    summary.regionId = cell.regionId;
  }
  return summary;
}

function extractDraftObject(rawDraft: unknown): unknown {
  if (!isRecord(rawDraft)) {
    return rawDraft;
  }
  if (isRecord(rawDraft.draft)) {
    return rawDraft.draft;
  }
  if (Array.isArray(rawDraft.drafts)) {
    return rawDraft.drafts[0];
  }
  return rawDraft;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalString(value: unknown): string | undefined {
  const text = readString(value);
  return text.length > 0 ? text : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(readString).filter((item) => item.length > 0) : [];
}

function readConfidence(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.min(1, value));
}
