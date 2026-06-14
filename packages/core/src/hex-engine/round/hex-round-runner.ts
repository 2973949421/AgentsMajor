import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { HexCell, HexMapAsset } from "@agent-major/shared";
import type { ArtifactStore } from "../../ports.js";
import {
  buildHexRoundEconomyContext,
  type HexRoundEconomyContext
} from "../economy/index.js";
import {
  buildFixtureHexRoundBusinessDuel,
  type HexRoundBusinessDuel
} from "../business/index.js";
import {
  buildHexRoundFinanceDuel,
  type HexRoundFinanceDuel
} from "../finance/index.js";
import {
  buildHexCombatContacts,
  materializeHexCombatMemoryEvents,
  resolveHexCombat,
  type HexCombatContact,
  type HexCombatCasualty,
  type HexCombatResolution
} from "../combat/index.js";
import type { TeamEconomyPlan } from "../../economy/economy-rules.js";
import {
  advanceHexPhaseMemory,
  applyHexPhaseMemoryEvents,
  hexPhaseIds,
  initializeHexRoundMemory,
  prepareHexPhaseStartMemory,
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
  type HexAgentPhaseCommandHarnessResult,
  type HexAgentCommandProgressSink,
  type HexRoundTacticalPlan
} from "../action/index.js";
import {
  materializeHexWinCondition,
  type HexWinConditionResult
} from "../win-condition/index.js";
import { actionToActionResultEvent, actionToMovementEvents, actionToObjectiveEvents } from "./hex-round-action-events.js";

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
  progressSink?: HexAgentCommandProgressSink;
  businessDuel?: HexRoundBusinessDuel;
  financeDuel?: HexRoundFinanceDuel;
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
  businessDuel: HexRoundBusinessDuel;
  financeDuel: HexRoundFinanceDuel;
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
    roundStrategySeed: string;
    strategyVariant: string;
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
  const businessDuel = input.businessDuel ?? buildFixtureHexRoundBusinessDuel({
    roundNumber: input.roundNumber,
    attackTeamId: input.attackTeamId,
    defenseTeamId: input.defenseTeamId,
    agents: input.activeAgents
  });
  const financeDuel = input.financeDuel ?? buildHexRoundFinanceDuel({
    roundNumber: input.roundNumber,
    attackTeamId: input.attackTeamId,
    defenseTeamId: input.defenseTeamId,
    agents: input.activeAgents
  });
  const tacticalPlan = buildRoundTacticalPlan(input.roundNumber);
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
      ...(input.progressSink ? { progressSink: input.progressSink } : {}),
      tacticalPlan,
      businessDuel,
      financeDuel,
      callIdPrefix: `hex_${input.roundId}_${phaseIndex}`
    });
    const acceptedActions = commandResult.acceptedActions;
    const movementEvents = acceptedActions.flatMap((action) => actionToMovementEvents(action, memory));
    const memoryAfterMovement = applyHexPhaseMemoryEvents({
      asset,
      memory,
      events: movementEvents
    });
    const combatContacts = buildHexCombatContacts({
      asset,
      memory: memoryAfterMovement,
      actions: acceptedActions,
      businessDuel
    });
    const combatResolutions = dedupeHexPhaseCombatResolutions({
      memoryBeforeCombat: memoryAfterMovement,
      resolutions: combatContacts.map((contact) => resolveHexCombat({
        asset,
        memory: memoryAfterMovement,
        contact,
        actions: acceptedActions,
        economyContext,
        businessDuel
      }))
    });
    const combatEvents = combatResolutions.flatMap((resolution) => resolution.memoryEvents);
    const memoryAfterCombat = applyHexPhaseMemoryEvents({
      asset,
      memory: memoryAfterMovement,
      events: combatEvents
    });
    const objectiveEvents = acceptedActions.flatMap((action) => actionToObjectiveEvents(action, memoryAfterCombat, asset));
    const actionResultEvents = acceptedActions.map(actionToActionResultEvent);
    const memoryEvents = [
      ...movementEvents,
      ...combatEvents,
      ...objectiveEvents,
      ...actionResultEvents,
      { type: "phase_closed" as const }
    ];
    const nextPhaseId = hexPhaseIds[Math.min(phasePosition + 1, hexPhaseIds.length - 1)]!;
    const memoryAfter = applyHexPhaseMemoryEvents({
      asset,
      memory: memoryAfterCombat,
      events: [...objectiveEvents, ...actionResultEvents, { type: "phase_closed" as const }]
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

    memory = prepareHexPhaseStartMemory({
      previousMemory: memoryAfter,
      nextPhaseId,
      nextPhaseIndex: phaseIndex + 1
    });
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
    businessDuel,
    financeDuel,
    economyContext,
    phases,
    finalWinCondition,
    audit: {
      providerMode: providerSetup.providerMode,
      ...(providerSetup.modelId ? { modelId: providerSetup.modelId } : {}),
      totalLlmCallsAttempted: phases.reduce((sum, phase) => sum + phase.commandResult.totalCallsAttempted, 0),
      fallbackCount: phases.reduce((sum, phase) => sum + phase.commandResult.fallbackCount, 0),
      combatResolutionCount: phases.reduce((sum, phase) => sum + phase.combatResolutions.length, 0),
      rejectedEventCount: phases.reduce((sum, phase) => sum + phase.memoryAfter.rejectedEvents.length, 0),
      roundStrategySeed: buildRoundStrategySeed(input.roundId, input.roundNumber, tacticalPlan.attackVariant, financeDuel.topic.roundKey),
      strategyVariant: `${tacticalPlan.attackVariant} / ${tacticalPlan.defenseVariant}`
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

export function buildRoundTacticalPlan(roundNumber: number): HexRoundTacticalPlan {
  const variants: HexRoundTacticalPlan[] = [
    {
      roundNumber,
      attackVariant: "A short split",
      defenseVariant: "A short and CT crossfire",
      attackFocusRegions: ["a_short", "mid_top_mid", "a_site"],
      defenseFocusRegions: ["a_short", "ct_mid_rotate", "a_site"],
      attackFocusPoints: ["a_short_point", "a_bombsite", "mid_xbox"],
      defenseFocusPoints: ["a_bombsite", "ct_spawn_point", "a_short_point"],
      c4SitePreference: "a",
      instruction: "Attack should bias toward A short pressure and a credible A plant path; defense should contest short and CT rotations."
    },
    {
      roundNumber,
      attackVariant: "B tunnels pressure",
      defenseVariant: "B anchor with mid info",
      attackFocusRegions: ["b_tunnels", "outside_tunnels", "b_site", "mid_top_mid"],
      defenseFocusRegions: ["b_site", "ct_mid_rotate", "mid_top_mid"],
      attackFocusPoints: ["upper_tunnels", "lower_tunnels", "b_bombsite", "top_mid"],
      defenseFocusPoints: ["b_bombsite", "b_doors", "top_mid"],
      c4SitePreference: "b",
      instruction: "Attack should bias toward B tunnels or mid-to-B pressure; defense should keep B anchor and mid information."
    },
    {
      roundNumber,
      attackVariant: "Long A default",
      defenseVariant: "Long control and A anchor",
      attackFocusRegions: ["long_doors", "a_long_approach", "a_long_pit", "a_site"],
      defenseFocusRegions: ["long_corner_blue", "a_long_pit", "a_site"],
      attackFocusPoints: ["long_doors_point", "outside_long", "a_bombsite"],
      defenseFocusPoints: ["a_bombsite", "long_corner", "ct_spawn_point"],
      c4SitePreference: "a",
      instruction: "Attack should bias toward long A control before committing; defense should contest long and preserve A site coverage."
    },
    {
      roundNumber,
      attackVariant: "Mid split read",
      defenseVariant: "Flexible mid rotate",
      attackFocusRegions: ["mid_top_mid", "ct_mid_rotate", "a_short", "b_site"],
      defenseFocusRegions: ["mid_top_mid", "ct_mid_rotate", "a_site", "b_site"],
      attackFocusPoints: ["top_mid", "mid_xbox", "b_doors", "a_short_point"],
      defenseFocusPoints: ["top_mid", "ct_spawn_point", "b_doors", "a_bombsite"],
      c4SitePreference: "b",
      instruction: "Attack should use mid control to choose a split; defense should rotate from verified pressure instead of overstacking spawn."
    }
  ];
  const selected = variants[Math.abs(roundNumber - 1) % variants.length]!;
  return { ...selected, roundNumber };
}

function buildRoundStrategySeed(roundId: string, roundNumber: number, attackVariant: string, subthemeId: string): string {
  return `hex_strategy:${roundId}:${roundNumber}:${attackVariant}:${subthemeId}`;
}

export function dedupeHexPhaseCombatResolutions(input: {
  memoryBeforeCombat: HexRoundMemory;
  resolutions: HexCombatResolution[];
}): HexCombatResolution[] {
  const deadBeforeCombat = new Set(
    input.memoryBeforeCombat.agents
      .filter((agent) => agent.lifeStatus === "dead")
      .map((agent) => agent.agentId)
  );
  const selectedCasualties = new Map<string, { resolutionIndex: number; casualty: HexCombatCasualty }>();

  input.resolutions.forEach((resolution, resolutionIndex) => {
    for (const casualty of resolution.casualties) {
      if (deadBeforeCombat.has(casualty.agentId)) {
        continue;
      }
      const current = selectedCasualties.get(casualty.agentId);
      if (!current || casualtySeverity(casualty) > casualtySeverity(current.casualty)) {
        selectedCasualties.set(casualty.agentId, { resolutionIndex, casualty });
      }
    }
  });

  return input.resolutions.map((resolution, resolutionIndex) => {
    const casualties = resolution.casualties.filter((casualty) => {
      const selected = selectedCasualties.get(casualty.agentId);
      return selected?.resolutionIndex === resolutionIndex && selected.casualty === casualty;
    });
    if (casualties.length === resolution.casualties.length) {
      return resolution;
    }
    return {
      ...resolution,
      casualties,
      memoryEvents: materializeHexCombatMemoryEvents({
        ...resolution,
        casualties
      })
    };
  });
}

function casualtySeverity(casualty: HexCombatCasualty): number {
  return casualty.result === "killed" ? 2 : 1;
}

function isEliminationWin(winCondition: HexWinConditionResult): boolean {
  return winCondition.roundWinType === "attack_elimination" || winCondition.roundWinType === "defense_elimination";
}
