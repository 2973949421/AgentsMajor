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
  buildSubmittedFinanceOutputs,
  type HexRoundFinanceDuel,
  type HexSubmittedFinanceOutput
} from "../finance/index.js";
import {
  buildHexCombatContacts,
  materializeHexCombatMemoryEvents,
  resolveHexCombat,
  type HexCombatContact,
  type HexCombatAttributionHistory,
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
  createEnvHexRoundStartAgentOutputProvider,
  createFixtureHexAgentCommandProvider,
  createFixtureHexRoundStartAgentOutputProvider,
  buildHexRoundOpeningBrief,
  runHexAgentPhaseCommandHarness,
  runHexRoundStartAgentOutputHarness,
  isUsableRoundStartAgentOutput,
  type HexValidatedAgentAction,
  type HexAgentCommandProvider,
  type HexAgentCommandProviderMode,
  type HexAgentPhaseCommandHarnessResult,
  type HexAgentCommandProgressSink,
  type HexRoundStartAgentOutput,
  type HexRoundStartAgentOutputProvider,
  type HexRoleRouteAssignment,
  type HexRoundRouteMemory,
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
  displayName?: string;
  role?: string;
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
  roundStartProvider?: HexRoundStartAgentOutputProvider;
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
  priorRoundTacticalSummaries?: readonly HexPriorRoundTacticalSummary[];
  env?: Record<string, string | undefined>;
}

export interface HexPriorRoundTacticalSummary {
  roundNumber: number;
  attackVariant?: string | undefined;
  defenseVariant?: string | undefined;
  c4SitePreference?: "a" | "b" | undefined;
  roundWinType?: string | undefined;
  winnerSide?: HexSide | undefined;
  roundQualityStatus?: string | undefined;
  attackFocusRegions?: string[] | undefined;
  defenseFocusRegions?: string[] | undefined;
  attackFocusPoints?: string[] | undefined;
  defenseFocusPoints?: string[] | undefined;
  bombPlanted?: boolean | undefined;
}

export interface HexRoundTacticalAudit {
  selectedVariant: string;
  selectedAttackVariant: string;
  selectedDefenseVariant: string;
  c4SitePreference: "a" | "b";
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
  roleRouteAssignments: HexRoleRouteAssignment[];
}

export interface BuildRoundTacticalPlanInput {
  roundNumber: number;
  roundId?: string | undefined;
  economyContext?: HexRoundEconomyContext | undefined;
  priorRounds?: readonly HexPriorRoundTacticalSummary[] | undefined;
}

export interface RoundTacticalPlanSelection {
  plan: HexRoundTacticalPlan;
  audit: HexRoundTacticalAudit;
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
  roundStartAgentOutputs: HexRoundStartAgentOutput[];
  submittedFinanceOutputs: HexSubmittedFinanceOutput[];
  phases: HexRoundPhaseTrace[];
  finalWinCondition: HexWinConditionResult;
  audit: {
    providerMode: HexAgentCommandProviderMode;
    modelId?: string;
    totalLlmCallsAttempted: number;
    fallbackCount: number;
    providerRetryRecoveredCount?: number;
    providerRetryFinalFailureCount?: number;
    roundStartLlmCallsAttempted: number;
    combatResolutionCount: number;
    rejectedEventCount: number;
    roundStrategySeed: string;
    strategyVariant: string;
    roundQualityStatus: HexRoundQualityStatus;
    roundQualityReasons: HexRoundQualityReason[];
    roundQualitySummaryZh: string;
    roundQualityCounts: HexRoundQualityCounts;
    tacticalAudit: HexRoundTacticalAudit;
  };
}

const maxPhaseIndex = hexPhaseIds.length - 1;

export type HexRoundQualityStatus = "valid" | "provider_degraded" | "action_degraded" | "invalid_round";

export type HexRoundQualityReason =
  | "phase0_stance_insufficient"
  | "phase0_challenge_insufficient"
  | "phase0_challenge_partial"
  | "no_usable_phase0"
  | "phase_action_provider_failed"
  | "phase_action_degraded"
  | "provider_error_threshold_exceeded"
  | "action_fallback_threshold_exceeded"
  | "phase_action_fallback_present"
  | "round_start_partial_failure";

export interface HexRoundQualityCounts {
  usableRoundStartCount: number;
  usableStanceCount: number;
  usableChallengeCount: number;
  roundStartProviderErrorCount: number;
  roundStartInvalidCount: number;
  totalActionFallbackCount: number;
  maxPhaseFallbackCount: number;
  consecutiveDegradedPhaseCount: number;
  phaseActionProviderErrorCount: number;
}

interface HexRoundQualityAudit {
  roundQualityStatus: HexRoundQualityStatus;
  roundQualityReasons: HexRoundQualityReason[];
  roundQualitySummaryZh: string;
  counts: HexRoundQualityCounts;
}

export async function runDust2HexRound(input: RunDust2HexRoundInput): Promise<HexRoundTrace> {
  const asset = loadOfficialDust2HexMap();
  const providerSetup = resolveProvider(input);
  const bombCarrierAgentId = input.activeAgents.find((agent) => agent.side === "attack" && agent.carryingC4)?.agentId
    ?? input.activeAgents.find((agent) => agent.side === "attack")?.agentId;
  const initialAgents = materializeInitialAgents({
    asset,
    activeAgents: input.activeAgents,
    attackTeamId: input.attackTeamId,
    defenseTeamId: input.defenseTeamId,
    roundId: input.roundId,
    roundNumber: input.roundNumber
  });
  let memory = initializeHexRoundMemory({
    asset,
    agents: initialAgents,
    ...(bombCarrierAgentId ? { bombCarrierAgentId } : {})
  });
  const economyContext = buildHexRoundEconomyContext({
    teamEconomyPlans: input.teamEconomyPlans,
    memory
  });
  let roundRouteMemory = buildInitialRoundRouteMemory(asset, memory);
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
  const tacticalSelection = selectRoundTacticalPlan({
    roundNumber: input.roundNumber,
    roundId: input.roundId,
    economyContext,
    priorRounds: input.priorRoundTacticalSummaries ?? []
  });
  const tacticalPlan = tacticalSelection.plan;
  const roundOpeningBrief = buildHexRoundOpeningBrief({
    financeDuel,
    economyContext,
    agents: input.activeAgents.map((agent) => ({
      agentId: agent.agentId,
      teamId: agent.teamId,
      side: agent.side,
      ...(agent.displayName ? { displayName: agent.displayName } : {}),
      ...(agent.role ? { role: agent.role } : {})
    }))
  });
  const roundStartProviderSetup = resolveRoundStartProvider(input, providerSetup);
  const artifactOwner = input.artifactStore
    ? {
        ownerType: "round",
        ownerId: input.roundId,
        ...(input.artifactOwner?.tournamentId ? { tournamentId: input.artifactOwner.tournamentId } : {}),
        ...(input.artifactOwner?.matchId ? { matchId: input.artifactOwner.matchId } : {}),
        ...(input.artifactOwner?.mapGameId ? { mapGameId: input.artifactOwner.mapGameId } : {}),
        roundId: input.roundId
      }
    : undefined;
  const roundStartAgentOutputs = await runHexRoundStartAgentOutputHarness({
    roundId: input.roundId,
    roundOpeningBrief,
    economyContext,
    provider: roundStartProviderSetup.provider,
    providerMode: roundStartProviderSetup.providerMode,
    ...(roundStartProviderSetup.modelId ? { modelId: roundStartProviderSetup.modelId } : {}),
    ...(input.artifactStore ? { artifactStore: input.artifactStore } : {}),
    ...(artifactOwner ? { artifactOwner } : {})
  });
  const usableRoundStartAgentOutputs = roundStartAgentOutputs.filter(isUsableRoundStartAgentOutput);
  const submittedFinanceOutputs = buildSubmittedFinanceOutputs({
    financeDuel,
    economyContext,
    roundStartAgentOutputs: usableRoundStartAgentOutputs
  });
  const phases: HexRoundPhaseTrace[] = [];
  let roundQualityAudit = buildHexRoundQualityAudit(roundStartAgentOutputs, phases);
  let finalWinCondition: HexWinConditionResult | undefined;
  const attributionHistory = createHexCombatAttributionHistory();

  if (roundQualityAudit.roundQualityStatus === "invalid_round") {
    finalWinCondition = buildInvalidRoundWinCondition(memory, roundQualityAudit);
  }

  for (let phasePosition = 0; !finalWinCondition && phasePosition < hexPhaseIds.length; phasePosition += 1) {
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
      roundStartAgentOutputs: usableRoundStartAgentOutputs,
      roundRouteMemory,
      callIdPrefix: `hex_${input.roundId}_${phaseIndex}`
    });
    const acceptedActions = commandResult.acceptedActions;
    roundRouteMemory = updateRoundRouteMemory(asset, roundRouteMemory, acceptedActions);
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
    const phaseAttributionHistory = cloneHexCombatAttributionHistory(attributionHistory);
    const combatResolutionDrafts = combatContacts.map((contact) => {
      const resolution = resolveHexCombat({
        asset,
        memory: memoryAfterMovement,
        contact,
        actions: acceptedActions,
        economyContext,
        businessDuel,
        financeDuel,
        submittedFinanceOutputs,
        roundStartAgentOutputs: usableRoundStartAgentOutputs,
        attributionHistory: phaseAttributionHistory
      });
      return resolution;
    });
    const combatResolutions = dedupeHexPhaseCombatResolutions({
      memoryBeforeCombat: memoryAfterMovement,
      resolutions: combatResolutionDrafts
    });
    recordHexCombatAttributionHistory(attributionHistory, combatResolutions, phaseIndex);
    const combatEvents = combatResolutions.flatMap((resolution) => resolution.memoryEvents);
    const memoryAfterCombat = applyHexPhaseMemoryEvents({
      asset,
      memory: memoryAfterMovement,
      events: combatEvents
    });
    const objectiveEvents = acceptedActions.flatMap((action) => actionToObjectiveEvents(action, memoryAfterCombat, asset));
    const actionResultEvents = acceptedActions.map((action) => actionToActionResultEvent(action, objectiveEvents));
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

    roundQualityAudit = buildHexRoundQualityAudit(roundStartAgentOutputs, phases);
    if (roundQualityAudit.roundQualityStatus === "invalid_round") {
      finalWinCondition = buildInvalidRoundWinCondition(memoryAfter, roundQualityAudit);
      break;
    }

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
    roundStartAgentOutputs,
    submittedFinanceOutputs,
    phases,
    finalWinCondition,
    audit: {
      providerMode: providerSetup.providerMode,
      ...(providerSetup.modelId ? { modelId: providerSetup.modelId } : {}),
      totalLlmCallsAttempted: roundStartAgentOutputs.length + phases.reduce((sum, phase) => sum + phase.commandResult.totalCallsAttempted, 0),
      fallbackCount: phases.reduce((sum, phase) => sum + phase.commandResult.fallbackCount, 0),
      providerRetryRecoveredCount: phases.reduce((sum, phase) => sum + countRecoveredProviderRetries(phase.commandResult), 0),
      providerRetryFinalFailureCount: phases.reduce((sum, phase) => sum + countFinalProviderRetryFailures(phase.commandResult), 0),
      roundStartLlmCallsAttempted: roundStartAgentOutputs.length,
      combatResolutionCount: phases.reduce((sum, phase) => sum + phase.combatResolutions.length, 0),
      rejectedEventCount: phases.reduce((sum, phase) => sum + phase.memoryAfter.rejectedEvents.length, 0),
      roundStrategySeed: buildRoundStrategySeed(input.roundId, input.roundNumber, tacticalPlan.attackVariant, financeDuel.topic.roundKey),
      strategyVariant: `${tacticalPlan.attackVariant} / ${tacticalPlan.defenseVariant}`,
      roundQualityStatus: roundQualityAudit.roundQualityStatus,
      roundQualityReasons: [...roundQualityAudit.roundQualityReasons],
      roundQualitySummaryZh: roundQualityAudit.roundQualitySummaryZh,
      roundQualityCounts: { ...roundQualityAudit.counts },
      tacticalAudit: tacticalSelection.audit
    }
  };
}

function buildHexRoundQualityAudit(
  roundStartAgentOutputs: readonly HexRoundStartAgentOutput[],
  phases: readonly HexRoundPhaseTrace[]
): HexRoundQualityAudit {
  const usableRoundStartOutputs = roundStartAgentOutputs.filter(isUsableRoundStartAgentOutput);
  const counts: HexRoundQualityCounts = {
    usableRoundStartCount: usableRoundStartOutputs.length,
    usableStanceCount: usableRoundStartOutputs.filter((output) => output.cardKind === "stance").length,
    usableChallengeCount: usableRoundStartOutputs.filter((output) => output.cardKind === "challenge").length,
    roundStartProviderErrorCount: roundStartAgentOutputs.filter((output) => output.source === "provider_error").length,
    roundStartInvalidCount: roundStartAgentOutputs.filter((output) => output.source === "invalid_response").length,
    totalActionFallbackCount: phases.reduce((sum, phase) => sum + countQualityFallbackActions(phase.commandResult), 0),
    maxPhaseFallbackCount: phases.reduce((max, phase) => Math.max(max, countQualityFallbackActions(phase.commandResult)), 0),
    consecutiveDegradedPhaseCount: countConsecutiveDegradedPhases(phases),
    phaseActionProviderErrorCount: phases.reduce((sum, phase) => sum + countProviderErrorAudits(phase.commandResult), 0)
  };
  const reasons = new Set<HexRoundQualityReason>();
  if (counts.usableRoundStartCount === 0) {
    reasons.add("no_usable_phase0");
  }
  if (counts.usableStanceCount < 5) {
    reasons.add("phase0_stance_insufficient");
  }
  if (counts.usableChallengeCount < 4) {
    reasons.add("phase0_challenge_insufficient");
  } else if (counts.usableChallengeCount < 5) {
    reasons.add("phase0_challenge_partial");
  }
  if (counts.roundStartProviderErrorCount >= 5) {
    reasons.add("provider_error_threshold_exceeded");
  }
  if (counts.roundStartProviderErrorCount > 0 || counts.roundStartInvalidCount > 0) {
    reasons.add("round_start_partial_failure");
  }
  if (phases.some((phase) => isAllLiveActionFallback(phase.commandResult))) {
    reasons.add("phase_action_provider_failed");
  }
  if (counts.consecutiveDegradedPhaseCount >= 2) {
    reasons.add("phase_action_degraded");
  }
  if (counts.totalActionFallbackCount > 20) {
    reasons.add("action_fallback_threshold_exceeded");
  }
  if (counts.totalActionFallbackCount > 0) {
    reasons.add("phase_action_fallback_present");
  }

  const invalidReasons: HexRoundQualityReason[] = [
    "no_usable_phase0",
    "phase0_stance_insufficient",
    "phase0_challenge_insufficient",
    "provider_error_threshold_exceeded",
    "phase_action_provider_failed",
    "phase_action_degraded",
    "action_fallback_threshold_exceeded"
  ];
  const roundQualityReasons = [...reasons];
  const hasProviderDegradation = roundQualityReasons.some((reason) =>
    reason === "round_start_partial_failure"
    || reason === "phase0_challenge_partial"
    || reason === "provider_error_threshold_exceeded"
  ) || counts.phaseActionProviderErrorCount > 0 || (counts.roundStartProviderErrorCount > 0 && counts.roundStartProviderErrorCount < 5);
  const hasActionDegradation = roundQualityReasons.some((reason) => reason === "phase_action_fallback_present");
  const roundQualityStatus: HexRoundQualityStatus = roundQualityReasons.some((reason) => invalidReasons.includes(reason))
    ? "invalid_round"
    : hasProviderDegradation
      ? "provider_degraded"
      : hasActionDegradation
        ? "action_degraded"
        : "valid";

  return {
    roundQualityStatus,
    roundQualityReasons,
    roundQualitySummaryZh: buildRoundQualitySummaryZh(roundQualityStatus, roundQualityReasons, counts),
    counts
  };
}

function countQualityFallbackActions(commandResult: HexAgentPhaseCommandHarnessResult): number {
  return commandResult.fallbackActions.filter((action) => !isBenignSkippedFallback(action.fallbackReason)).length;
}

function countProviderErrorAudits(commandResult: HexAgentPhaseCommandHarnessResult): number {
  return commandResult.audits.filter((audit) => !audit.providerRecovered && audit.errors.some((error) => error.startsWith("provider_error"))).length;
}

function countRecoveredProviderRetries(commandResult: HexAgentPhaseCommandHarnessResult): number {
  return commandResult.audits.filter((audit) => audit.providerRecovered).length;
}

function countFinalProviderRetryFailures(commandResult: HexAgentPhaseCommandHarnessResult): number {
  return commandResult.audits.filter((audit) => (audit.providerRetryCount ?? 0) > 0 && !audit.providerRecovered && audit.errors.some((error) => error.startsWith("provider_error"))).length;
}

function countConsecutiveDegradedPhases(phases: readonly HexRoundPhaseTrace[]): number {
  let max = 0;
  let current = 0;
  for (const phase of phases) {
    if (countQualityFallbackActions(phase.commandResult) >= 8) {
      current += 1;
      max = Math.max(max, current);
    } else {
      current = 0;
    }
  }
  return max;
}

function isAllLiveActionFallback(commandResult: HexAgentPhaseCommandHarnessResult): boolean {
  const qualityFallbackCount = countQualityFallbackActions(commandResult);
  const liveActionCount = commandResult.actions.filter((action) => !isBenignSkippedFallback(action.fallbackReason)).length;
  return liveActionCount > 0 && qualityFallbackCount === liveActionCount;
}

function isBenignSkippedFallback(reason: string | undefined): boolean {
  return reason === "dead_agent_skipped" || reason === "ap_empty_agent_skipped";
}

function buildInvalidRoundWinCondition(memory: HexRoundMemory, quality: HexRoundQualityAudit): HexWinConditionResult {
  return {
    isRoundOver: true,
    reason: `Hex round invalidated by quality gate: ${quality.roundQualityReasons.join(",") || "unknown"}.`,
    evidence: [
      `roundQualityStatus=${quality.roundQualityStatus}`,
      ...quality.roundQualityReasons.map((reason) => `roundQualityReason=${reason}`),
      `usableRoundStartCount=${quality.counts.usableRoundStartCount}`,
      `usableStanceCount=${quality.counts.usableStanceCount}`,
      `usableChallengeCount=${quality.counts.usableChallengeCount}`,
      `totalActionFallbackCount=${quality.counts.totalActionFallbackCount}`,
      `maxPhaseFallbackCount=${quality.counts.maxPhaseFallbackCount}`
    ],
    phaseId: memory.phaseId,
    phaseIndex: memory.phaseIndex
  };
}

function buildRoundQualitySummaryZh(
  status: HexRoundQualityStatus,
  reasons: readonly HexRoundQualityReason[],
  counts: HexRoundQualityCounts
): string {
  if (status === "valid") {
    return "本 round 通过质量闸门，可作为正式比赛样本审计。";
  }
  const reasonZh = reasons.map(formatRoundQualityReasonZh).join("；") || "未知质量问题";
  const prefix = status === "invalid_round"
    ? "本 round 未通过质量闸门"
    : status === "provider_degraded"
      ? "本 round 存在 provider 降级"
      : "本 round 存在行动校验降级";
  return `${prefix}：${reasonZh}。phase0 可消费 ${counts.usableRoundStartCount}/10，stance ${counts.usableStanceCount}/5，challenge ${counts.usableChallengeCount}/5，行动降级 ${counts.totalActionFallbackCount}。`;
}

function formatRoundQualityReasonZh(reason: HexRoundQualityReason): string {
  const labels: Record<HexRoundQualityReason, string> = {
    phase0_stance_insufficient: "phase0 立场卡不足",
    phase0_challenge_insufficient: "phase0 挑战卡不足",
    phase0_challenge_partial: "phase0 挑战卡部分缺失",
    no_usable_phase0: "没有可消费 phase0 真实卡片",
    phase_action_provider_failed: "某个 phase 行动层全部降级",
    phase_action_degraded: "连续 phase 行动层大面积降级",
    provider_error_threshold_exceeded: "模型供应器错误达到阈值",
    action_fallback_threshold_exceeded: "行动降级总数超过阈值",
    phase_action_fallback_present: "存在行动校验降级",
    round_start_partial_failure: "round-start 输出存在失败"
  };
  return labels[reason];
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

function resolveRoundStartProvider(
  input: RunDust2HexRoundInput,
  phaseProviderSetup: {
    providerMode: HexAgentCommandProviderMode;
    modelId?: string;
  }
): {
  provider: HexRoundStartAgentOutputProvider;
  providerMode: HexAgentCommandProviderMode;
  modelId?: string;
} {
  if (input.roundStartProvider) {
    return {
      provider: input.roundStartProvider,
      providerMode: input.providerMode ?? phaseProviderSetup.providerMode,
      ...(input.modelId ?? phaseProviderSetup.modelId ? { modelId: input.modelId ?? phaseProviderSetup.modelId } : {})
    };
  }
  if (phaseProviderSetup.providerMode === "real") {
    const setup = createEnvHexRoundStartAgentOutputProvider(input.env ?? process.env);
    return {
      provider: setup.provider,
      providerMode: setup.providerMode,
      modelId: setup.modelId
    };
  }
  return {
    provider: createFixtureHexRoundStartAgentOutputProvider(),
    providerMode: "fixture",
    modelId: input.modelId ?? phaseProviderSetup.modelId ?? "fixture_hex_round_start_agent_output"
  };
}

function materializeInitialAgents(input: {
  asset: HexMapAsset;
  activeAgents: HexRoundRunnerAgentInput[];
  attackTeamId: string;
  defenseTeamId: string;
  roundId: string;
  roundNumber: number;
}) {
  const tSpawnCells = shuffleCellsByStableSeed(
    cellsWithFlag(input.asset, "spawn_t"),
    buildSpawnSeed(input.roundId, input.roundNumber, input.attackTeamId, "attack")
  );
  const ctSpawnCells = shuffleCellsByStableSeed(
    cellsWithFlag(input.asset, "spawn_ct"),
    buildSpawnSeed(input.roundId, input.roundNumber, input.defenseTeamId, "defense")
  );
  const cellsById = new Map(input.asset.cells.map((cell) => [cell.cellId, cell]));
  const occupiedCellIds = new Set<string>();
  let attackFallbackIndex = 0;
  let defenseFallbackIndex = 0;
  let attackAssignedCount = 0;

  return input.activeAgents.map((agent) => {
    const spawnCells = agent.side === "attack" ? tSpawnCells : ctSpawnCells;
    const explicitCell = agent.startCellId ? cellsById.get(agent.startCellId) : undefined;
    const useExplicitCell = Boolean(explicitCell?.playable && !occupiedCellIds.has(explicitCell.cellId));
    const fallback = useExplicitCell
      ? undefined
      : nextUnoccupiedSpawnCell({
          cells: spawnCells,
          occupiedCellIds,
          startIndex: agent.side === "attack" ? attackFallbackIndex : defenseFallbackIndex
        });
    if (fallback) {
      if (agent.side === "attack") {
        attackFallbackIndex = fallback.nextIndex;
      } else {
        defenseFallbackIndex = fallback.nextIndex;
      }
    }
    const startCell = useExplicitCell ? explicitCell! : fallback!.cell;
    occupiedCellIds.add(startCell.cellId);
    if (agent.side === "attack") {
      attackAssignedCount += 1;
    }
    return {
      agentId: agent.agentId,
      teamId: agent.teamId,
      side: agent.side,
      startCellId: startCell.cellId,
      carryingC4: agent.carryingC4 ?? (agent.side === "attack" && attackAssignedCount === 1)
    };
  });
}

function buildSpawnSeed(roundId: string, roundNumber: number, teamId: string, side: HexSide): string {
  return `hex_spawn:${roundId}:${roundNumber}:${teamId}:${side}`;
}

function shuffleCellsByStableSeed(cells: readonly HexCell[], seed: string): HexCell[] {
  return [...cells]
    .map((cell, index) => ({
      cell,
      score: deterministicJitter(`${seed}:${cell.cellId}:${index}`)
    }))
    .sort((left, right) => left.score - right.score || left.cell.cellId.localeCompare(right.cell.cellId))
    .map(({ cell }) => cell);
}

function nextUnoccupiedSpawnCell(input: {
  cells: readonly HexCell[];
  occupiedCellIds: ReadonlySet<string>;
  startIndex: number;
}): { cell: HexCell; nextIndex: number } {
  for (let offset = 0; offset < input.cells.length; offset += 1) {
    const index = (input.startIndex + offset) % input.cells.length;
    const cell = input.cells[index]!;
    if (!input.occupiedCellIds.has(cell.cellId)) {
      return { cell, nextIndex: index + 1 };
    }
  }
  throw new Error("Official Dust2 Hex asset does not have enough unique spawn cells for the active agents.");
}
function buildInitialRoundRouteMemory(asset: HexMapAsset, memory: HexRoundMemory): HexRoundRouteMemory {
  const routeMemory: HexRoundRouteMemory = { agents: {} };
  for (const agent of memory.agents) {
    const history: HexRoundRouteMemory["agents"][string] = {
      visitedCellIds: [],
      visitedRegionIds: [],
      visitedPointIds: []
    };
    appendRouteCellToHistory(asset, history, agent.currentCellId);
    routeMemory.agents[agent.agentId] = history;
  }
  return routeMemory;
}

function updateRoundRouteMemory(
  asset: HexMapAsset,
  current: HexRoundRouteMemory,
  actions: readonly HexValidatedAgentAction[]
): HexRoundRouteMemory {
  const next: HexRoundRouteMemory = {
    agents: Object.fromEntries(Object.entries(current.agents).map(([agentId, history]) => [
      agentId,
      {
        visitedCellIds: [...history.visitedCellIds],
        visitedRegionIds: [...history.visitedRegionIds],
        visitedPointIds: [...history.visitedPointIds]
      }
    ]))
  };
  for (const action of actions) {
    if (!action.valid || action.fallbackReason) {
      continue;
    }
    const history = next.agents[action.agentId] ?? {
      visitedCellIds: [],
      visitedRegionIds: [],
      visitedPointIds: []
    };
    for (const cellId of action.pathCellIds.length > 0 ? action.pathCellIds : [action.currentCellId, action.targetCellId]) {
      appendRouteCellToHistory(asset, history, cellId);
    }
    appendRouteCellToHistory(asset, history, action.targetCellId);
    next.agents[action.agentId] = history;
  }
  return next;
}

function appendRouteCellToHistory(asset: HexMapAsset, history: HexRoundRouteMemory["agents"][string], cellId: string): void {
  const cell = asset.cells.find((candidate) => candidate.cellId === cellId);
  if (!cell) {
    return;
  }
  appendUniqueString(history.visitedCellIds, cell.cellId);
  if (cell.regionId) {
    appendUniqueString(history.visitedRegionIds, cell.regionId);
  }
  for (const pointId of cell.pointIds) {
    appendUniqueString(history.visitedPointIds, pointId);
  }
}

function appendUniqueString(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}
function cellsWithFlag(asset: HexMapAsset, flag: HexCell["flags"][number]) {
  const cells = asset.cells.filter((cell) => cell.playable && cell.flags.includes(flag));
  if (cells.length === 0) {
    throw new Error(`Official Dust2 Hex asset is missing playable cells with flag ${flag}.`);
  }
  return cells;
}

export function buildRoundTacticalPlan(input: number | BuildRoundTacticalPlanInput): HexRoundTacticalPlan {
  return selectRoundTacticalPlan(typeof input === "number" ? { roundNumber: input } : input).plan;
}

export function selectRoundTacticalPlan(input: BuildRoundTacticalPlanInput): RoundTacticalPlanSelection {
  const playbook = buildRoundTacticalPlaybook(input.roundNumber);
  const recentRounds = [...(input.priorRounds ?? [])]
    .filter((round) => round.roundNumber < input.roundNumber)
    .sort((left, right) => right.roundNumber - left.roundNumber)
    .slice(0, 4);
  const previousRoundSignals = buildPreviousRoundSignals(recentRounds);
  const antiRepeatTargets = buildAntiRepeatTargets(recentRounds.slice(0, 2));
  const economyAdjustment = buildEconomyTacticalAdjustment(input.economyContext);
  const scored = playbook.map((plan) => scoreTacticalPlan({
    plan,
    input,
    recentRounds,
    previousRoundSignals,
    economyAdjustment
  }));
  const selected = scored.sort((left, right) => right.score - left.score || left.plan.attackVariant.localeCompare(right.plan.attackVariant))[0]
    ?? scoreTacticalPlan({
      plan: playbook[0]!,
      input,
      recentRounds,
      previousRoundSignals,
      economyAdjustment
    });
  const plan: HexRoundTacticalPlan = {
    ...selected.plan,
    roundNumber: input.roundNumber,
    selectionReasons: selected.selectionReasons,
    antiRepeatReasons: selected.antiRepeatReasons,
    antiRepeatRegions: antiRepeatTargets.regions,
    antiRepeatPoints: antiRepeatTargets.points,
    economyTacticalAdjustment: selected.economyReasons,
    previousRoundSignals,
    roleRouteAssignments: selected.plan.roleRouteAssignments?.map((assignment) => ({ ...assignment }))
  };
  const audit: HexRoundTacticalAudit = {
    selectedVariant: `${plan.attackVariant} / ${plan.defenseVariant}`,
    selectedAttackVariant: plan.attackVariant,
    selectedDefenseVariant: plan.defenseVariant,
    c4SitePreference: plan.c4SitePreference,
    selectionReasons: [...selected.selectionReasons],
    previousRoundSignals,
    antiRepeatPenalties: [...selected.antiRepeatReasons],
    antiRepeatRegions: [...antiRepeatTargets.regions],
    antiRepeatPoints: [...antiRepeatTargets.points],
    economyAdjustment: [...selected.economyReasons],
    routeDiversityWarnings: buildRouteDiversityWarnings(plan),
    attackFocusRegions: [...plan.attackFocusRegions],
    defenseFocusRegions: [...plan.defenseFocusRegions],
    attackAvoidRegions: [...(plan.attackAvoidRegions ?? [])],
    defenseAvoidRegions: [...(plan.defenseAvoidRegions ?? [])],
    roleRouteAssignments: plan.roleRouteAssignments?.map((assignment) => ({ ...assignment })) ?? []
  };
  return { plan, audit };
}

function buildRoundTacticalPlaybook(roundNumber: number): HexRoundTacticalPlan[] {
  return [
    withRoleRouteAssignments({
      roundNumber,
      attackVariant: "A short split",
      defenseVariant: "A short and CT crossfire",
      attackFocusRegions: ["a_short", "mid_top_mid", "a_site"],
      defenseFocusRegions: ["a_short", "ct_mid_rotate", "a_site"],
      attackFocusPoints: ["a_short_point", "a_bombsite", "mid_xbox"],
      defenseFocusPoints: ["a_bombsite", "ct_spawn_point", "a_short_point"],
      attackAvoidRegions: ["b_tunnels"],
      defenseAvoidRegions: ["outside_tunnels"],
      c4SitePreference: "a",
      instruction: "Attack should bias toward A short pressure and a credible A plant path; defense should contest short and CT rotations."
    }),
    withRoleRouteAssignments({
      roundNumber,
      attackVariant: "B tunnels pressure",
      defenseVariant: "B anchor with mid info",
      attackFocusRegions: ["b_tunnels", "outside_tunnels", "b_site", "mid_top_mid"],
      defenseFocusRegions: ["b_site", "ct_mid_rotate", "mid_top_mid"],
      attackFocusPoints: ["upper_tunnels", "lower_tunnels", "b_bombsite", "top_mid"],
      defenseFocusPoints: ["b_bombsite", "b_doors", "top_mid"],
      attackAvoidRegions: ["a_long_approach"],
      defenseAvoidRegions: ["a_long_pit"],
      c4SitePreference: "b",
      instruction: "Attack should bias toward B tunnels or mid-to-B pressure; defense should keep B anchor and mid information."
    }),
    withRoleRouteAssignments({
      roundNumber,
      attackVariant: "Long A default",
      defenseVariant: "Long control and A anchor",
      attackFocusRegions: ["long_doors", "a_long_approach", "a_long_pit", "a_site"],
      defenseFocusRegions: ["long_corner_blue", "a_long_pit", "a_site"],
      attackFocusPoints: ["long_doors_point", "outside_long", "a_bombsite"],
      defenseFocusPoints: ["a_bombsite", "long_corner", "ct_spawn_point"],
      attackAvoidRegions: ["b_tunnels"],
      defenseAvoidRegions: ["b_site"],
      c4SitePreference: "a",
      instruction: "Attack should bias toward long A control before committing; defense should contest long and preserve A site coverage."
    }),
    withRoleRouteAssignments({
      roundNumber,
      attackVariant: "Mid split read",
      defenseVariant: "Flexible mid rotate",
      attackFocusRegions: ["mid_top_mid", "ct_mid_rotate", "a_short", "b_site"],
      defenseFocusRegions: ["mid_top_mid", "ct_mid_rotate", "a_site", "b_site"],
      attackFocusPoints: ["top_mid", "mid_xbox", "b_doors", "a_short_point"],
      defenseFocusPoints: ["top_mid", "ct_spawn_point", "b_doors", "a_bombsite"],
      attackAvoidRegions: ["long_doors"],
      defenseAvoidRegions: [],
      c4SitePreference: "b",
      instruction: "Attack should use mid control to choose a split; defense should rotate from verified pressure instead of overstacking spawn."
    }),
    withRoleRouteAssignments({
      roundNumber,
      attackVariant: "A long fake into B late",
      defenseVariant: "Long info with B late anchor",
      attackFocusRegions: ["long_doors", "mid_top_mid", "b_tunnels", "b_site"],
      defenseFocusRegions: ["long_corner_blue", "ct_mid_rotate", "b_site"],
      attackFocusPoints: ["long_doors_point", "top_mid", "upper_tunnels", "b_bombsite"],
      defenseFocusPoints: ["long_corner", "ct_spawn_point", "b_bombsite"],
      attackAvoidRegions: ["a_site"],
      defenseAvoidRegions: ["a_short"],
      c4SitePreference: "b",
      instruction: "Attack should show long pressure then pull the pack toward B late; defense should confirm before over-rotating."
    }),
    withRoleRouteAssignments({
      roundNumber,
      attackVariant: "B contact into mid pinch",
      defenseVariant: "B doors crossfire and mid support",
      attackFocusRegions: ["outside_tunnels", "b_tunnels", "mid_top_mid", "b_site"],
      defenseFocusRegions: ["b_site", "b_doors", "ct_mid_rotate"],
      attackFocusPoints: ["upper_tunnels", "lower_tunnels", "top_mid", "b_doors"],
      defenseFocusPoints: ["b_bombsite", "b_doors", "ct_spawn_point"],
      attackAvoidRegions: ["a_long_pit"],
      defenseAvoidRegions: ["a_long_approach"],
      c4SitePreference: "b",
      instruction: "Attack should pressure B contact then pinch from mid if doors control appears; defense should keep B crossfire and a mid helper."
    }),
    withRoleRouteAssignments({
      roundNumber,
      attackVariant: "Catwalk delay into A execute",
      defenseVariant: "Short retake setup",
      attackFocusRegions: ["mid_top_mid", "a_short", "a_site"],
      defenseFocusRegions: ["a_short", "a_site", "ct_mid_rotate"],
      attackFocusPoints: ["mid_xbox", "a_short_point", "a_bombsite"],
      defenseFocusPoints: ["a_short_point", "a_bombsite", "ct_spawn_point"],
      attackAvoidRegions: ["b_site"],
      defenseAvoidRegions: ["outside_tunnels"],
      c4SitePreference: "a",
      instruction: "Attack should delay on catwalk before the A hit; defense should hold short retake spacing instead of all peeking early."
    }),
    withRoleRouteAssignments({
      roundNumber,
      attackVariant: "Default spread with late call",
      defenseVariant: "Balanced anchors with one info player",
      attackFocusRegions: ["mid_top_mid", "long_doors", "outside_tunnels"],
      defenseFocusRegions: ["a_site", "b_site", "ct_mid_rotate"],
      attackFocusPoints: ["top_mid", "long_doors_point", "upper_tunnels"],
      defenseFocusPoints: ["a_bombsite", "b_bombsite", "ct_spawn_point"],
      attackAvoidRegions: [],
      defenseAvoidRegions: [],
      c4SitePreference: roundNumber % 2 === 0 ? "b" : "a",
      instruction: "Attack should spread for information and make a late call; defense should keep balanced anchors and one safe info player."
    })
  ];
}

function withRoleRouteAssignments(plan: Omit<HexRoundTacticalPlan, "roleRouteAssignments">): HexRoundTacticalPlan {
  const attackPrimaryRegions = plan.attackFocusRegions.slice(0, 2);
  const attackSecondaryRegions = uniqueStrings([...plan.attackFocusRegions.slice(1), ...plan.attackFocusRegions.slice(0, 1)]);
  const defensePrimaryRegions = plan.defenseFocusRegions.slice(0, 2);
  const defenseSecondaryRegions = uniqueStrings([...plan.defenseFocusRegions.slice(1), ...plan.defenseFocusRegions.slice(0, 1)]);
  const attackPrimaryPoints = plan.attackFocusPoints.slice(0, 2);
  const attackSecondaryPoints = uniqueStrings([...plan.attackFocusPoints.slice(1), ...plan.attackFocusPoints.slice(0, 1)]);
  const defensePrimaryPoints = plan.defenseFocusPoints.slice(0, 2);
  const defenseSecondaryPoints = uniqueStrings([...plan.defenseFocusPoints.slice(1), ...plan.defenseFocusPoints.slice(0, 1)]);
  return {
    ...plan,
    roleRouteAssignments: [
      roleRoute("attack", "entry", "take first contact on the primary lane", attackPrimaryRegions, attackPrimaryPoints, plan.attackAvoidRegions),
      roleRoute("attack", "star_rifler", "trade the entry and convert pressure toward the bombsite", attackSecondaryRegions, attackSecondaryPoints, plan.attackAvoidRegions),
      roleRoute("attack", "awper", "hold the long angle or mid lane that supports the pack", preferAngleRegions(plan.attackFocusRegions), preferAnglePoints(plan.attackFocusPoints), plan.attackAvoidRegions),
      roleRoute("attack", "igl", "keep the pack route coherent and call the late commitment", plan.attackFocusRegions, plan.attackFocusPoints, plan.attackAvoidRegions),
      roleRoute("attack", "support", "escort C4 and prepare trade utility on the selected site path", preferSiteRegions(plan.attackFocusRegions), preferSitePoints(plan.attackFocusPoints), plan.attackAvoidRegions),
      roleRoute("defense", "entry", "contest safe early information without abandoning the anchor", defensePrimaryRegions, defensePrimaryPoints, plan.defenseAvoidRegions),
      roleRoute("defense", "star_rifler", "anchor the highest pressure lane and prepare a trade", defenseSecondaryRegions, defenseSecondaryPoints, plan.defenseAvoidRegions),
      roleRoute("defense", "awper", "hold the longest available angle and delay the hit", preferAngleRegions(plan.defenseFocusRegions), preferAnglePoints(plan.defenseFocusPoints), plan.defenseAvoidRegions),
      roleRoute("defense", "igl", "keep rotate discipline and avoid overstacking the previous route", plan.defenseFocusRegions, plan.defenseFocusPoints, plan.defenseAvoidRegions),
      roleRoute("defense", "support", "support the anchor and preserve retake spacing", preferSiteRegions(plan.defenseFocusRegions), preferSitePoints(plan.defenseFocusPoints), plan.defenseAvoidRegions)
    ]
  };
}

function roleRoute(
  side: HexSide,
  role: string,
  routeIntent: string,
  focusRegions: readonly string[],
  focusPoints: readonly string[],
  avoidRegions: readonly string[] | undefined
): HexRoleRouteAssignment {
  return {
    side,
    role,
    routeIntent,
    focusRegions: [...focusRegions],
    focusPoints: [...focusPoints],
    ...(avoidRegions?.length ? { avoidRegions: [...avoidRegions] } : {})
  };
}

function scoreTacticalPlan(input: {
  plan: HexRoundTacticalPlan;
  input: BuildRoundTacticalPlanInput;
  recentRounds: HexPriorRoundTacticalSummary[];
  previousRoundSignals: string[];
  economyAdjustment: string[];
}): {
  plan: HexRoundTacticalPlan;
  score: number;
  selectionReasons: string[];
  antiRepeatReasons: string[];
  economyReasons: string[];
} {
  const recent = input.recentRounds[0];
  const recentTwo = input.recentRounds.slice(0, 2);
  let score = 100 + deterministicJitter(`${input.input.roundId ?? "round"}:${input.input.roundNumber}:${input.plan.attackVariant}`);
  const selectionReasons = [`selected_from_playbook:${input.plan.attackVariant}`];
  const antiRepeatReasons: string[] = [];
  const economyReasons = [...input.economyAdjustment];

  if (recent?.attackVariant === input.plan.attackVariant) {
    score -= 70;
    antiRepeatReasons.push(`上一局已使用 ${input.plan.attackVariant}，本局强制降权。`);
  }
  if (recentTwo.some((round) => round.attackVariant === input.plan.attackVariant)) {
    score -= 25;
    antiRepeatReasons.push(`最近两局出现过 ${input.plan.attackVariant}，降低重复概率。`);
  }
  if (recent?.c4SitePreference === input.plan.c4SitePreference) {
    score -= 16;
    antiRepeatReasons.push(`上一局 C4 偏向 ${input.plan.c4SitePreference.toUpperCase()}，本局避免连续同包点默认。`);
  }
  const repeatedAttackRegions = countOverlap(recent?.attackFocusRegions ?? [], input.plan.attackFocusRegions);
  if (repeatedAttackRegions >= 2) {
    score -= repeatedAttackRegions * 8;
    antiRepeatReasons.push(`进攻主要区域与上一局重叠 ${repeatedAttackRegions} 个。`);
  }
  const repeatedDefenseRegions = countOverlap(recent?.defenseFocusRegions ?? [], input.plan.defenseFocusRegions);
  if (repeatedDefenseRegions >= 2) {
    score -= repeatedDefenseRegions * 4;
  }

  if (recent?.roundWinType === "defense_timeout" || recent?.roundWinType === "time_expired") {
    if (/execute|contact|pressure|split/i.test(input.plan.attackVariant)) {
      score += 18;
      selectionReasons.push("上一局疑似进攻超时，本局提高推进和下包路径权重。 ");
    }
  }
  if (recent?.roundWinType === "defense_elimination" || recent?.winnerSide === "defense") {
    if (recent.attackVariant !== input.plan.attackVariant && recent.c4SitePreference !== input.plan.c4SitePreference) {
      score += 14;
      selectionReasons.push("上一局进攻被压制，本局切换主路线和包点。 ");
    }
  }
  if (recent?.roundWinType === "attack_elimination" || recent?.winnerSide === "attack") {
    if (recent.attackVariant !== input.plan.attackVariant) {
      score += 8;
      selectionReasons.push("上一局进攻成功但不复读同一默认路线。 ");
    }
  }

  const attackResource = summarizeSideResource(input.input.economyContext, "attack");
  if (attackResource.lowOrForced >= 3) {
    if (/contact|fake|default|tunnels/i.test(input.plan.attackVariant)) {
      score += 12;
      economyReasons.push("进攻资源偏低，选择短路径、接触换人或默认骗转。 ");
    } else {
      score -= 10;
    }
  }
  if (attackResource.highOrMedium >= 3) {
    if (/execute|split|long|short/i.test(input.plan.attackVariant)) {
      score += 10;
      economyReasons.push("进攻资源足够，允许更完整的控图或包点执行。 ");
    }
  }

  if (antiRepeatReasons.length === 0) {
    antiRepeatReasons.push("未命中强反重复惩罚，按经济与上一局结果微调。 ");
  }
  if (economyReasons.length === 0) {
    economyReasons.push("经济未触发强制路线调整。 ");
  }

  return {
    plan: input.plan,
    score,
    selectionReasons,
    antiRepeatReasons,
    economyReasons
  };
}

function buildAntiRepeatTargets(rounds: readonly HexPriorRoundTacticalSummary[]): { regions: string[]; points: string[] } {
  return {
    regions: uniqueStrings(rounds.flatMap((round) => [
      ...(round.attackFocusRegions ?? []),
      ...(round.defenseFocusRegions ?? [])
    ])),
    points: uniqueStrings(rounds.flatMap((round) => [
      ...(round.attackFocusPoints ?? []),
      ...(round.defenseFocusPoints ?? [])
    ]))
  };
}

function buildPreviousRoundSignals(rounds: readonly HexPriorRoundTacticalSummary[]): string[] {
  if (rounds.length === 0) {
    return ["无上一局战术摘要，本局按 playbook 与经济状态选择。"];
  }
  return rounds.slice(0, 3).map((round) => {
    const variant = round.attackVariant ? `${round.attackVariant}/${round.defenseVariant ?? "unknown"}` : "未记录战术";
    const result = round.roundWinType ?? round.winnerSide ?? "未记录胜负";
    return `R${round.roundNumber}: ${variant}, result=${result}`;
  });
}

function buildEconomyTacticalAdjustment(economyContext: HexRoundEconomyContext | undefined): string[] {
  const attack = summarizeSideResource(economyContext, "attack");
  const defense = summarizeSideResource(economyContext, "defense");
  const notes: string[] = [];
  if (attack.lowOrForced >= 3) {
    notes.push("进攻低/强起资源较多，避免默认长时间控图，优先短路径换人或骗转。 ");
  }
  if (attack.highOrMedium >= 3) {
    notes.push("进攻中高资源较多，可以承担完整控图和包点执行。 ");
  }
  if (defense.lowOrForced >= 3) {
    notes.push("防守资源偏低，避免过早前压丢点，保留交叉火力。 ");
  }
  if (defense.highOrMedium >= 3) {
    notes.push("防守资源足够，可安排信息位和补防交叉。 ");
  }
  return notes;
}

function summarizeSideResource(economyContext: HexRoundEconomyContext | undefined, side: HexSide): { lowOrForced: number; highOrMedium: number } {
  const agents = economyContext?.agents.filter((agent) => agent.side === side) ?? [];
  return {
    lowOrForced: agents.filter((agent) => agent.resourceTier === "low" || agent.resourceTier === "forced").length,
    highOrMedium: agents.filter((agent) => agent.resourceTier === "medium" || agent.resourceTier === "high").length
  };
}

function buildRouteDiversityWarnings(plan: HexRoundTacticalPlan): string[] {
  const warnings: string[] = [];
  if (new Set(plan.attackFocusRegions).size <= 1) {
    warnings.push("进攻路线过窄，仅覆盖一个主要区域。 ");
  }
  if (new Set(plan.roleRouteAssignments?.filter((assignment) => assignment.side === "attack").map((assignment) => assignment.routeIntent)).size <= 2) {
    warnings.push("进攻角色路线分工偏少，需要人工审计是否复读。 ");
  }
  return warnings;
}

function preferAngleRegions(regions: readonly string[]): string[] {
  const preferred = regions.filter((region) => /long|mid|doors|ct/i.test(region));
  return preferred.length > 0 ? preferred : regions.slice(0, 2);
}

function preferAnglePoints(points: readonly string[]): string[] {
  const preferred = points.filter((point) => /long|mid|doors|ct|top/i.test(point));
  return preferred.length > 0 ? preferred : points.slice(0, 2);
}

function preferSiteRegions(regions: readonly string[]): string[] {
  const preferred = regions.filter((region) => /site|short|tunnels/i.test(region));
  return preferred.length > 0 ? preferred : regions.slice(-2);
}

function preferSitePoints(points: readonly string[]): string[] {
  const preferred = points.filter((point) => /bombsite|short|tunnels|doors/i.test(point));
  return preferred.length > 0 ? preferred : points.slice(-2);
}

function countOverlap(left: readonly string[], right: readonly string[]): number {
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item)).length;
}

function deterministicJitter(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (Math.imul(31, hash) + seed.charCodeAt(index)) | 0;
  }
  return Math.abs(hash % 1000) / 1000;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function buildRoundStrategySeed(roundId: string, roundNumber: number, attackVariant: string, subthemeId: string): string {
  return `hex_strategy:${roundId}:${roundNumber}:${attackVariant}:${subthemeId}`;
}

function createHexCombatAttributionHistory(): HexCombatAttributionHistory {
  return {
    roundKillCountsByAgent: {},
    phaseKillCountsByAgent: {},
    lastKillPhaseIndexByAgent: {}
  };
}

function cloneHexCombatAttributionHistory(history: HexCombatAttributionHistory): HexCombatAttributionHistory {
  return {
    roundKillCountsByAgent: { ...history.roundKillCountsByAgent },
    phaseKillCountsByAgent: { ...history.phaseKillCountsByAgent },
    lastKillPhaseIndexByAgent: { ...history.lastKillPhaseIndexByAgent }
  };
}

function recordHexCombatAttributionHistory(
  history: HexCombatAttributionHistory,
  resolutions: readonly HexCombatResolution[],
  phaseIndex: number
): void {
  for (const resolution of resolutions) {
    for (const casualty of resolution.casualties) {
      if (casualty.result !== "killed" || !casualty.killerAgentId) {
        continue;
      }
      history.roundKillCountsByAgent[casualty.killerAgentId] = (history.roundKillCountsByAgent[casualty.killerAgentId] ?? 0) + 1;
      history.phaseKillCountsByAgent[casualty.killerAgentId] = (history.phaseKillCountsByAgent[casualty.killerAgentId] ?? 0) + 1;
      history.lastKillPhaseIndexByAgent[casualty.killerAgentId] = phaseIndex;
    }
  }
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
