import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { HexCell, HexMapAsset } from "@agent-major/shared";
import type { ArtifactStore } from "../../ports.js";
import {
  buildHexRoundEconomyContext,
  type HexRoundEconomyContext
} from "../economy/index.js";
import {
  buildHexCombatContacts,
  resolveHexCombat,
  type HexCombatContact,
  type HexCombatResolution
} from "../combat/index.js";
import type { TeamEconomyPlan } from "../../economy/economy-rules.js";
import {
  advanceHexPhaseMemory,
  hexPhaseIds,
  initializeHexRoundMemory,
  type HexPhaseId,
  type HexPhaseMemoryEvent,
  type HexRoundMemory,
  type HexSide
} from "../state/index.js";
import {
  createEnvHexAgentCommandProvider,
  createFixtureHexAgentCommandProvider,
  runHexAgentPhaseCommandHarness,
  type HexValidatedAgentAction,
  type HexAgentCommandProvider,
  type HexAgentCommandProviderMode,
  type HexAgentPhaseCommandHarnessResult
} from "../action/index.js";
import {
  materializeHexWinCondition,
  type HexWinConditionResult
} from "../win-condition/index.js";

export interface HexRoundRunnerAgentInput {
  agentId: string;
  teamId: string;
  side: HexSide;
  startCellId?: string;
  carryingC4?: boolean;
}

export interface RunDust2HexRoundInput {
  roundId: string;
  roundNumber: number;
  attackTeamId: string;
  defenseTeamId: string;
  activeAgents: HexRoundRunnerAgentInput[];
  teamEconomyPlans: Record<string, TeamEconomyPlan>;
  provider?: HexAgentCommandProvider;
  providerMode?: HexAgentCommandProviderMode;
  modelId?: string;
  maxLlmCallsPerPhase?: number;
  artifactStore?: ArtifactStore;
  artifactOwner?: {
    tournamentId?: string;
    matchId?: string;
    mapGameId?: string;
  };
  env?: Record<string, string | undefined>;
}

export interface HexRoundPhaseTrace {
  phaseId: HexPhaseId;
  phaseIndex: number;
  memoryBefore: HexRoundMemory;
  commandResult: HexAgentPhaseCommandHarnessResult;
  combatContacts: HexCombatContact[];
  combatResolutions: HexCombatResolution[];
  memoryEvents: HexPhaseMemoryEvent[];
  memoryAfter: HexRoundMemory;
  winCondition: HexWinConditionResult;
}

export interface HexRoundTrace {
  schemaVersion: 1;
  source: "hex_round_engine_trace";
  roundId: string;
  roundNumber: number;
  mapSlug: "dust2";
  attackTeamId: string;
  defenseTeamId: string;
  economyContext: HexRoundEconomyContext;
  phases: HexRoundPhaseTrace[];
  finalWinCondition: HexWinConditionResult;
  audit: {
    providerMode: HexAgentCommandProviderMode;
    modelId?: string;
    totalLlmCallsAttempted: number;
    fallbackCount: number;
    combatResolutionCount: number;
    rejectedEventCount: number;
  };
}

const maxPhaseIndex = hexPhaseIds.length - 1;

export async function runDust2HexRound(input: RunDust2HexRoundInput): Promise<HexRoundTrace> {
  const asset = loadOfficialDust2HexMap();
  const providerSetup = resolveProvider(input);
  const bombCarrierAgentId = input.activeAgents.find((agent) => agent.side === "attack" && agent.carryingC4)?.agentId
    ?? input.activeAgents.find((agent) => agent.side === "attack")?.agentId;
  let memory = initializeHexRoundMemory({
    asset,
    agents: materializeInitialAgents({
      asset,
      activeAgents: input.activeAgents,
      attackTeamId: input.attackTeamId
    }),
    ...(bombCarrierAgentId ? { bombCarrierAgentId } : {})
  });
  const economyContext = buildHexRoundEconomyContext({
    teamEconomyPlans: input.teamEconomyPlans,
    memory
  });
  const phases: HexRoundPhaseTrace[] = [];
  let finalWinCondition: HexWinConditionResult | undefined;

  for (let phasePosition = 0; phasePosition < hexPhaseIds.length; phasePosition += 1) {
    const phaseId = memory.phaseId;
    const phaseIndex = memory.phaseIndex;
    const commandResult = await runHexAgentPhaseCommandHarness({
      asset,
      memory,
      provider: providerSetup.provider,
      providerMode: providerSetup.providerMode,
      ...(providerSetup.modelId ? { modelId: providerSetup.modelId } : {}),
      maxLlmCalls: input.maxLlmCallsPerPhase ?? 10,
      economyContext,
      ...(input.artifactStore ? { artifactStore: input.artifactStore } : {}),
      ...(input.artifactStore
        ? {
            artifactOwner: {
              ownerType: "round",
              ownerId: input.roundId,
              ...(input.artifactOwner?.tournamentId ? { tournamentId: input.artifactOwner.tournamentId } : {}),
              ...(input.artifactOwner?.matchId ? { matchId: input.artifactOwner.matchId } : {}),
              ...(input.artifactOwner?.mapGameId ? { mapGameId: input.artifactOwner.mapGameId } : {}),
              roundId: input.roundId
            }
          }
        : {}),
      callIdPrefix: `hex_${input.roundId}_${phaseIndex}`
    });
    const acceptedActions = commandResult.acceptedActions;
    const combatContacts = buildHexCombatContacts({
      asset,
      memory,
      actions: acceptedActions
    });
    const combatResolutions = combatContacts.map((contact) => resolveHexCombat({
      asset,
      memory,
      contact,
      actions: acceptedActions,
      economyContext
    }));
    const memoryEvents = [
      ...acceptedActions.flatMap((action) => actionToMemoryEvents(action)),
      ...combatResolutions.flatMap((resolution) => resolution.memoryEvents),
      { type: "phase_closed" as const }
    ];
    const nextPhaseId = hexPhaseIds[Math.min(phasePosition + 1, hexPhaseIds.length - 1)]!;
    const memoryAfter = advanceHexPhaseMemory({
      asset,
      previousMemory: memory,
      events: memoryEvents,
      nextPhaseId,
      nextPhaseIndex: phaseIndex + 1
    });
    const winCondition = materializeHexWinCondition({
      memory: memoryAfter,
      phaseId,
      phaseIndex,
      combatResolutions,
      maxPhaseIndex,
      attackTeamId: input.attackTeamId,
      defenseTeamId: input.defenseTeamId
    });

    phases.push({
      phaseId,
      phaseIndex,
      memoryBefore: memory,
      commandResult,
      combatContacts,
      combatResolutions,
      memoryEvents,
      memoryAfter,
      winCondition
    });

    if (winCondition.isRoundOver && (phaseIndex >= 1 || isEliminationWin(winCondition))) {
      finalWinCondition = winCondition;
      break;
    }

    memory = memoryAfter;
  }

  finalWinCondition ??= phases.at(-1)?.winCondition;
  if (!finalWinCondition?.isRoundOver) {
    finalWinCondition = materializeHexWinCondition({
      memory,
      phaseId: memory.phaseId,
      phaseIndex: maxPhaseIndex,
      combatResolutions: [],
      maxPhaseIndex,
      attackTeamId: input.attackTeamId,
      defenseTeamId: input.defenseTeamId
    });
  }

  return {
    schemaVersion: 1,
    source: "hex_round_engine_trace",
    roundId: input.roundId,
    roundNumber: input.roundNumber,
    mapSlug: "dust2",
    attackTeamId: input.attackTeamId,
    defenseTeamId: input.defenseTeamId,
    economyContext,
    phases,
    finalWinCondition,
    audit: {
      providerMode: providerSetup.providerMode,
      ...(providerSetup.modelId ? { modelId: providerSetup.modelId } : {}),
      totalLlmCallsAttempted: phases.reduce((sum, phase) => sum + phase.commandResult.totalCallsAttempted, 0),
      fallbackCount: phases.reduce((sum, phase) => sum + phase.commandResult.fallbackCount, 0),
      combatResolutionCount: phases.reduce((sum, phase) => sum + phase.combatResolutions.length, 0),
      rejectedEventCount: phases.reduce((sum, phase) => sum + phase.memoryAfter.rejectedEvents.length, 0)
    }
  };
}

export function loadOfficialDust2HexMap(): HexMapAsset {
  const raw = readFileSync(join(findWorkspaceRoot(process.cwd()), "data/materials/processed/maps/dust2/hex/dust2-hex-map.json"), "utf8");
  return JSON.parse(raw) as HexMapAsset;
}

function findWorkspaceRoot(startDirectory: string): string {
  let current = resolve(startDirectory);
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = resolve(current, "..");
    if (parent === current) {
      return resolve(startDirectory);
    }
    current = parent;
  }
  return resolve(startDirectory);
}

function resolveProvider(input: RunDust2HexRoundInput): {
  provider: HexAgentCommandProvider;
  providerMode: HexAgentCommandProviderMode;
  modelId?: string;
} {
  if (input.provider) {
    return {
      provider: input.provider,
      providerMode: input.providerMode ?? "fixture",
      ...(input.modelId ? { modelId: input.modelId } : {})
    };
  }
  if (input.providerMode === "real") {
    const setup = createEnvHexAgentCommandProvider(input.env ?? process.env);
    return {
      provider: setup.provider,
      providerMode: setup.providerMode,
      modelId: setup.modelId
    };
  }
  return {
    provider: createFixtureHexAgentCommandProvider(),
    providerMode: "fixture",
    modelId: input.modelId ?? "fixture_hex_agent_command"
  };
}

function materializeInitialAgents(input: {
  asset: HexMapAsset;
  activeAgents: HexRoundRunnerAgentInput[];
  attackTeamId: string;
}) {
  const tSpawnCells = cellsWithFlag(input.asset, "spawn_t");
  const ctSpawnCells = cellsWithFlag(input.asset, "spawn_ct");
  let attackIndex = 0;
  let defenseIndex = 0;
  return input.activeAgents.map((agent) => {
    const fallbackCell = agent.side === "attack"
      ? tSpawnCells[attackIndex++ % tSpawnCells.length]!
      : ctSpawnCells[defenseIndex++ % ctSpawnCells.length]!;
    return {
      agentId: agent.agentId,
      teamId: agent.teamId,
      side: agent.side,
      startCellId: agent.startCellId ?? fallbackCell.cellId,
      carryingC4: agent.carryingC4 ?? (agent.side === "attack" && attackIndex === 1)
    };
  });
}

function cellsWithFlag(asset: HexMapAsset, flag: HexCell["flags"][number]) {
  const cells = asset.cells.filter((cell) => cell.playable && cell.flags.includes(flag));
  if (cells.length === 0) {
    throw new Error(`Official Dust2 Hex asset is missing playable cells with flag ${flag}.`);
  }
  return cells;
}

function actionToMemoryEvents(action: HexValidatedAgentAction): HexPhaseMemoryEvent[] {
  if (!action.valid) {
    return [];
  }
  const events: HexPhaseMemoryEvent[] = [];
  if (action.targetCellId !== action.currentCellId) {
    events.push({
      type: "move",
      agentId: action.agentId,
      toCellId: action.targetCellId
    });
  }
  if (action.actionType === "plant_bomb") {
    events.push({
      type: "bomb_planted",
      agentId: action.agentId,
      cellId: action.targetCellId
    });
  }
  if (action.actionType === "defuse_bomb") {
    events.push({
      type: "bomb_defused",
      agentId: action.agentId
    });
  }
  events.push({
    type: "action_result",
    agentId: action.agentId,
    status: "success",
    summary: `Hex action ${action.actionType} ${action.currentCellId}->${action.targetCellId}.`,
    businessExecutionSummary: action.businessIntent
  });
  return events;
}

function isEliminationWin(winCondition: HexWinConditionResult): boolean {
  return winCondition.roundWinType === "attack_elimination" || winCondition.roundWinType === "defense_elimination";
}
