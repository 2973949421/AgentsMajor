import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { HexCell, HexMapAsset } from "@agent-major/shared";
import type { HexValidatedAgentAction } from "../action/index.js";
import { initializeHexRoundMemory, type HexInitialAgentInput, type HexRoundMemory, type HexSide } from "../state/index.js";

export function loadOfficialDust2HexMap(): HexMapAsset {
  const raw = readFileSync(join(process.cwd(), "data/materials/processed/maps/dust2/hex/dust2-hex-map.json"), "utf8");
  return JSON.parse(raw) as HexMapAsset;
}

export function initializeCombatMemory(asset: HexMapAsset, placements: Array<{ agentId: string; side: HexSide; cellId: string; wounded?: boolean }>): HexRoundMemory {
  const agents: HexInitialAgentInput[] = placements.map((placement) => ({
    agentId: placement.agentId,
    teamId: placement.side === "attack" ? "t" : "ct",
    side: placement.side,
    startCellId: placement.cellId,
    lifeStatus: placement.wounded ? "wounded" : "alive",
    carryingC4: placement.agentId === "t_0"
  }));
  const input = {
    asset,
    agents
  };
  return agents.some((agent) => agent.agentId === "t_0")
    ? initializeHexRoundMemory({ ...input, bombCarrierAgentId: "t_0" })
    : initializeHexRoundMemory(input);
}

export function buildCombatAction(input: {
  memory: HexRoundMemory;
  agentId: string;
  targetCellId?: string;
  actionType?: HexValidatedAgentAction["actionType"];
  businessIntent?: string;
  valid?: boolean;
  apCost?: number;
}): HexValidatedAgentAction {
  const agent = input.memory.agents.find((candidate) => candidate.agentId === input.agentId);
  if (!agent) {
    throw new Error(`Missing agent ${input.agentId}`);
  }
  return {
    agentId: agent.agentId,
    teamId: agent.teamId,
    side: agent.side,
    phaseId: input.memory.phaseId,
    currentCellId: agent.currentCellId,
    targetCellId: input.targetCellId ?? agent.currentCellId,
    actionType: input.actionType ?? "hold_position",
    apCost: input.apCost ?? 0,
    pathCellIds: [agent.currentCellId, input.targetCellId ?? agent.currentCellId],
    verticalLinkIds: [],
    pathSource: "pathfinding",
    businessIntent: input.businessIntent ?? `${agent.agentId} keeps a valid business intent for combat testing.`,
    riskNotes: [],
    valid: input.valid ?? true,
    validationErrors: input.valid === false ? ["missing_business_intent"] : []
  };
}

export function findCellsInRegion(asset: HexMapAsset, regionId: string, count: number): HexCell[] {
  const cells = asset.cells.filter((cell) => cell.playable && cell.regionId === regionId);
  if (cells.length < count) {
    throw new Error(`Region ${regionId} has only ${cells.length} cells`);
  }
  return cells.slice(0, count);
}

export function findCellsWithSharedPoint(asset: HexMapAsset): HexCell[] {
  const byPoint = new Map<string, HexCell[]>();
  for (const cell of asset.cells) {
    if (!cell.playable) {
      continue;
    }
    for (const pointId of cell.pointIds) {
      const next = byPoint.get(pointId) ?? [];
      next.push(cell);
      byPoint.set(pointId, next);
    }
  }
  for (const cells of byPoint.values()) {
    if (cells.length >= 2) {
      return cells.slice(0, 2);
    }
  }
  throw new Error("No shared point cells found");
}

export function findCellInDifferentRegion(asset: HexMapAsset, regionId: string): HexCell {
  const cell = asset.cells.find((candidate) => candidate.playable && candidate.regionId && candidate.regionId !== regionId);
  if (!cell) {
    throw new Error(`No cell outside ${regionId}`);
  }
  return cell;
}
