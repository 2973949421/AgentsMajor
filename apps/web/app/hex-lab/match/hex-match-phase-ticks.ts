import type { HexMatchLabPhaseSummary, HexMatchLabPlayerCard } from "../../server-hex-match-lab";

export interface HexMatchPhasePlaybackAgentState {
  agentId: string;
  currentCellId: string;
  moving: boolean;
  stopped: boolean;
  pathCellIds: string[];
  phaseDeathRevealed: boolean;
}

export interface HexMatchPhasePlaybackFrame {
  tickIndex: number;
  tickCount: number;
  tickLabel: string;
  tickProgressPct: number;
  legacyFallback: boolean;
  players: HexMatchLabPlayerCard[];
  agentStates: HexMatchPhasePlaybackAgentState[];
}

interface NormalizedAgentPath {
  agentId: string;
  pathCellIds: string[];
  movementSteps: number;
}

export function buildHexMatchPhasePlaybackFrame(
  phase: HexMatchLabPhaseSummary | undefined,
  requestedTickIndex: number
): HexMatchPhasePlaybackFrame {
  if (!phase) {
    return {
      tickIndex: 0,
      tickCount: 1,
      tickLabel: "Phase tick 1/1",
      tickProgressPct: 100,
      legacyFallback: true,
      players: [],
      agentStates: []
    };
  }

  const normalizedPaths = buildNormalizedAgentPaths(phase);
  const maxMovementSteps = Math.max(0, ...normalizedPaths.map((path) => path.movementSteps));
  const tickCount = Math.max(1, maxMovementSteps);
  const tickIndex = clampTickIndex(requestedTickIndex, tickCount);
  const pathByAgentId = new Map(normalizedPaths.map((path) => [path.agentId, path]));
  const killedThisPhaseAgentIds = collectKilledThisPhaseAgentIds(phase);
  const finalTick = tickIndex >= tickCount - 1;
  const agentStates: HexMatchPhasePlaybackAgentState[] = [];
  const players = phase.players.map((player) => {
    const path = pathByAgentId.get(player.agentId);
    if (!path || path.movementSteps <= 0) {
      const killedThisPhase = killedThisPhaseAgentIds.has(player.agentId);
      const lifeStatus = killedThisPhase && !finalTick ? "alive" : player.lifeStatus;
      agentStates.push({
        agentId: player.agentId,
        currentCellId: player.currentCellId,
        moving: false,
        stopped: true,
        pathCellIds: path?.pathCellIds ?? [],
        phaseDeathRevealed: lifeStatus === "dead"
      });
      return { ...player, lifeStatus };
    }

    const pathIndex = Math.min(tickIndex + 1, path.pathCellIds.length - 1);
    const currentCellId = path.pathCellIds[pathIndex] ?? player.currentCellId;
    const moving = tickIndex < path.movementSteps;
    const killedThisPhase = killedThisPhaseAgentIds.has(player.agentId);
    const lifeStatus = killedThisPhase && !finalTick ? "alive" : player.lifeStatus;
    agentStates.push({
      agentId: player.agentId,
      currentCellId,
      moving,
      stopped: !moving,
      pathCellIds: path.pathCellIds,
      phaseDeathRevealed: lifeStatus === "dead"
    });
    return { ...player, currentCellId, lifeStatus };
  });

  return {
    tickIndex,
    tickCount,
    tickLabel: `Phase tick ${tickIndex + 1}/${tickCount}`,
    tickProgressPct: ((tickIndex + 1) / tickCount) * 100,
    legacyFallback: normalizedPaths.length === 0,
    players,
    agentStates
  };
}

export function getHexMatchPhaseTickCount(phase: HexMatchLabPhaseSummary | undefined): number {
  if (!phase) return 1;
  const normalizedPaths = buildNormalizedAgentPaths(phase);
  const maxMovementSteps = Math.max(0, ...normalizedPaths.map((path) => path.movementSteps));
  return Math.max(1, maxMovementSteps);
}

function collectKilledThisPhaseAgentIds(phase: HexMatchLabPhaseSummary): Set<string> {
  const killedAgentIds = new Set<string>();
  for (const combat of phase.combats) {
    for (const attribution of combat.killAttributions ?? []) {
      if (attribution.result === "killed") killedAgentIds.add(attribution.targetAgentId);
    }
    for (const casualty of combat.casualties ?? []) {
      const [agentId, result] = casualty.split(":");
      if (agentId && result === "killed") killedAgentIds.add(agentId);
    }
  }
  return killedAgentIds;
}
function buildNormalizedAgentPaths(phase: HexMatchLabPhaseSummary): NormalizedAgentPath[] {
  const seenAgentIds = new Set<string>();
  const paths: NormalizedAgentPath[] = [];
  for (const action of phase.actions) {
    if (seenAgentIds.has(action.agentId)) continue;
    seenAgentIds.add(action.agentId);
    if (action.pathCellIds.length === 0) continue;
    const rawPath = [...action.pathCellIds];
    const startCellId = action.currentCellId;
    const pathCellIds = startCellId && rawPath[0] !== startCellId
      ? [startCellId, ...rawPath]
      : rawPath;
    const compactPath = dedupeConsecutiveCells(pathCellIds);
    const movementSteps = Math.max(0, compactPath.length - 1);
    if (movementSteps <= 0) continue;
    paths.push({ agentId: action.agentId, pathCellIds: compactPath, movementSteps });
  }
  return paths;
}

function dedupeConsecutiveCells(cellIds: string[]): string[] {
  const compact: string[] = [];
  for (const cellId of cellIds) {
    if (compact.at(-1) === cellId) continue;
    compact.push(cellId);
  }
  return compact;
}

function clampTickIndex(tickIndex: number, tickCount: number): number {
  if (!Number.isFinite(tickIndex)) return 0;
  return Math.max(0, Math.min(tickCount - 1, Math.floor(tickIndex)));
}
