import {
  DashScopeOpenAiProvider,
  loadAgentMajorLlmConfig,
  type LlmProviderDiagnostics,
  type LlmUsage
} from "@agent-major/llm";
import type { HexMapAsset } from "@agent-major/shared";
import type { ArtifactStore } from "../../ports.js";
import type { HexRoundBusinessDuel } from "../business/index.js";
import type { HexRoundEconomyContext } from "../economy/index.js";
import type { HexRoundFinanceDuel } from "../finance/index.js";
import type { HexRoundMemory } from "../state/index.js";
import {
  auditHexAgentDraftSemanticLanguage,
  buildHexAgentCompactCommandRequest,
  buildHexAgentCommandRequest,
  calculateHexAgentCommandRequestSizeMetrics,
  normalizeHexAgentActionDraft,
  type HexAgentCommandRequestSizeMetrics,
  type HexAgentCompactCommandRequest,
  type HexAgentActionDraft,
  type HexAgentCommandRequest,
  type HexAgentSemanticLanguageAudit,
  type HexRoundRouteMemory,
  type HexRoundTacticalPlan
} from "./hex-agent-command-boundary.js";
import type { HexRoundStartAgentOutputForAction } from "./hex-round-start-agent-output.js";
import {
  buildHexAgentFallbackAction,
  validateHexAgentActionDraft,
  type HexAgentActionValidationError,
  type HexValidatedAgentAction
} from "./hex-agent-action-validator.js";

export type HexAgentCommandProviderMode = "fixture" | "real";

export interface HexAgentCommandProviderResult {
  rawDraft: unknown;
  providerMode?: HexAgentCommandProviderMode;
  modelId?: string;
  rawText?: string;
  usage?: LlmUsage;
  providerDiagnostics?: LlmProviderDiagnostics;
}

export type HexAgentCommandProvider =
  (request: HexAgentCommandRequest) => Promise<unknown | HexAgentCommandProviderResult> | unknown | HexAgentCommandProviderResult;

export type HexAgentCommandProgressStatus =
  | "queued"
  | "skipped"
  | "running"
  | "provider_retry"
  | "provider_retry_recovered"
  | "request_artifact_written"
  | "response_artifact_written"
  | "accepted"
  | "repaired"
  | "rejected"
  | "fallback"
  | "provider_error";

export interface HexAgentCommandProgressEvent {
  phaseId: HexRoundMemory["phaseId"];
  phaseIndex: number;
  agentId: string;
  callId: string;
  callIndex: number;
  expectedCalls: number;
  status: HexAgentCommandProgressStatus;
  message?: string | undefined;
  requestArtifactId?: string | undefined;
  responseArtifactId?: string | undefined;
  repairedFields?: string[] | undefined;
  errors?: string[] | undefined;
  fallbackReason?: string | undefined;
  providerMode?: HexAgentCommandProviderMode | undefined;
  modelId?: string | undefined;
}

export type HexAgentCommandProgressSink = (event: HexAgentCommandProgressEvent) => void | Promise<void>;

export interface HexAgentCommandArtifactOwner {
  ownerType: string;
  ownerId: string;
  tournamentId?: string;
  matchId?: string;
  mapGameId?: string;
  roundId?: string;
}

export interface RunHexAgentPhaseCommandHarnessInput {
  asset: HexMapAsset;
  memory: HexRoundMemory;
  provider: HexAgentCommandProvider;
  providerMode?: HexAgentCommandProviderMode;
  modelId?: string;
  maxLlmCalls?: number;
  economyContext?: HexRoundEconomyContext;
  artifactStore?: ArtifactStore;
  artifactOwner?: HexAgentCommandArtifactOwner;
  callIdPrefix?: string;
  progressSink?: HexAgentCommandProgressSink;
  tacticalPlan?: HexRoundTacticalPlan;
  businessDuel?: HexRoundBusinessDuel;
  financeDuel?: HexRoundFinanceDuel;
  roundStartAgentOutputs?: readonly HexRoundStartAgentOutputForAction[];
  roundRouteMemory?: HexRoundRouteMemory | undefined;
  providerRetryPolicy?: {
    maxRetries: number;
  };
}

export interface HexAgentCommandAudit {
  agentId: string;
  callId: string;
  called: boolean;
  accepted: boolean;
  fallback: boolean;
  fallbackReason?: string;
  ignoredFields: string[];
  repairedFields: string[];
  errors: string[];
  requestArtifactId?: string;
  responseArtifactId?: string;
  providerMode?: HexAgentCommandProviderMode;
  modelId?: string;
  contentLength?: number;
  reasoningContentLength?: number;
  requestSizeMetrics?: HexAgentCommandRequestSizeMetrics;
  semanticLanguage?: HexAgentSemanticLanguageAudit["semanticLanguage"];
  languageMismatch?: boolean;
  inspectedSemanticFields?: string[];
  providerAttemptCount?: number;
  providerRetryCount?: number;
  providerRecovered?: boolean;
  providerAttemptErrors?: string[];
  recoveredProviderErrors?: string[];
}

export interface HexAgentPhaseCommandHarnessResult {
  actions: HexValidatedAgentAction[];
  acceptedActions: HexValidatedAgentAction[];
  fallbackActions: HexValidatedAgentAction[];
  rejectedDrafts: Array<{
    agentId: string;
    errors: string[];
    ignoredFields: string[];
  }>;
  audits: HexAgentCommandAudit[];
  totalCallsAttempted: number;
  fallbackCount: number;
}

export async function runHexAgentPhaseCommandHarness(input: RunHexAgentPhaseCommandHarnessInput): Promise<HexAgentPhaseCommandHarnessResult> {
  const actions: HexValidatedAgentAction[] = [];
  const audits: HexAgentCommandAudit[] = [];
  const rejectedDrafts: HexAgentPhaseCommandHarnessResult["rejectedDrafts"] = [];
  const maxLlmCalls = input.maxLlmCalls ?? Number.POSITIVE_INFINITY;
  let callSlotsAttempted = 0;
  let callsAttempted = 0;
  const expectedCalls = input.memory.agents.filter((agent) => agent.lifeStatus !== "dead" && agent.apRemaining > 0).length;
  const occupiedCellOwners = new Map<string, HexCellOccupant>();
  const reservedCellOwners = new Map<string, HexCellOccupant>();
  for (const agent of input.memory.agents) {
    if (agent.lifeStatus !== "dead") {
      occupiedCellOwners.set(agent.currentCellId, {
        agentId: agent.agentId,
        teamId: agent.teamId,
        side: agent.side
      });
    }
  }

  for (const agent of input.memory.agents) {
    const callId = buildCallId(input, agent.agentId);
    const callIndex = Math.min(callsAttempted + 1, expectedCalls);
    if (agent.lifeStatus === "dead" || agent.apRemaining <= 0) {
      const fallback = buildHexAgentFallbackAction({
        memory: input.memory,
        agent,
        reason: agent.lifeStatus === "dead" ? "dead_agent_skipped" : "ap_empty_agent_skipped"
      });
      await emitProgress(input, {
        agentId: agent.agentId,
        callId,
        callIndex,
        expectedCalls,
        status: "skipped",
        fallbackReason: fallback.fallbackReason ?? "agent_skipped",
        errors: [fallback.fallbackReason ?? "agent_skipped"]
      });
      actions.push(fallback);
      audits.push({
        agentId: agent.agentId,
        callId,
        called: false,
        accepted: false,
        fallback: true,
        fallbackReason: fallback.fallbackReason ?? "agent_skipped",
        ignoredFields: [],
        repairedFields: [],
        errors: [fallback.fallbackReason ?? "agent_skipped"]
      });
      continue;
    }

    if (callSlotsAttempted >= maxLlmCalls) {
      const fallback = buildHexAgentFallbackAction({
        memory: input.memory,
        agent,
        reason: "max_llm_calls_reached"
      });
      await emitProgress(input, {
        agentId: agent.agentId,
        callId,
        callIndex,
        expectedCalls,
        status: "fallback",
        fallbackReason: "max_llm_calls_reached",
        errors: ["max_llm_calls_reached"]
      });
      actions.push(fallback);
      audits.push({
        agentId: agent.agentId,
        callId,
        called: false,
        accepted: false,
        fallback: true,
        fallbackReason: "max_llm_calls_reached",
        ignoredFields: [],
        repairedFields: [],
        errors: ["max_llm_calls_reached"]
      });
      continue;
    }

    const friendlyOccupiedCellIds = [...occupiedCellOwners.entries()]
      .filter(([, owner]) => owner.teamId === agent.teamId && owner.agentId !== agent.agentId)
      .map(([cellId]) => cellId);
    const friendlyReservedCellIds = [...reservedCellOwners.entries()]
      .filter(([, owner]) => owner.teamId === agent.teamId && owner.agentId !== agent.agentId)
      .map(([cellId]) => cellId);
    const request = buildHexAgentCommandRequest({
      asset: input.asset,
      memory: input.memory,
      agentId: agent.agentId,
      occupiedCellIds: friendlyOccupiedCellIds,
      reservedCellIds: friendlyReservedCellIds,
      ...(input.tacticalPlan ? { tacticalPlan: input.tacticalPlan } : {}),
      ...(input.businessDuel ? { businessDuel: input.businessDuel } : {}),
      ...(input.financeDuel ? { financeDuel: input.financeDuel } : {}),
      ...(input.roundStartAgentOutputs ? { roundStartAgentOutputs: input.roundStartAgentOutputs } : {}),
      ...(input.roundRouteMemory ? { roundRouteMemory: input.roundRouteMemory } : {}),
      ...(input.economyContext ? { economyContext: input.economyContext } : {})
    });
    const compactRequest = buildHexAgentCompactCommandRequest(request);
    const requestSizeMetrics = calculateHexAgentCommandRequestSizeMetrics({
      fullRequest: request,
      compactRequest
    });
    await emitProgress(input, {
      agentId: agent.agentId,
      callId,
      callIndex,
      expectedCalls,
      status: "queued",
      providerMode: input.providerMode,
      ...(input.modelId ? { modelId: input.modelId } : {})
    });
    await emitProgress(input, {
      agentId: agent.agentId,
      callId,
      callIndex,
      expectedCalls,
      status: "running",
      providerMode: input.providerMode,
      ...(input.modelId ? { modelId: input.modelId } : {})
    });
    const requestArtifactId = await writeHarnessArtifact(input, {
      callId,
      agentId: agent.agentId,
      suffix: "request",
      artifactType: "hex_llm_request",
      content: {
        schemaVersion: 1,
        callId,
        request,
        fullRequest: request,
        compactRequest,
        compactRequestMode: compactRequest.requestMode,
        requestSizeMetrics
      }
    });
    if (requestArtifactId) {
      await emitProgress(input, {
        agentId: agent.agentId,
        callId,
        callIndex,
        expectedCalls,
        status: "request_artifact_written",
        requestArtifactId,
        providerMode: input.providerMode,
        ...(input.modelId ? { modelId: input.modelId } : {})
      });
    }

    callSlotsAttempted += 1;
    const maxProviderRetries = resolveProviderMaxRetries(input);
    const providerAttemptErrors: string[] = [];
    let providerAttemptCount = 0;
    let resolvedProviderResult: HexAgentCommandProviderResult | undefined;
    for (let attemptIndex = 0; attemptIndex <= maxProviderRetries; attemptIndex += 1) {
      providerAttemptCount += 1;
      callsAttempted += 1;
      if (attemptIndex > 0) {
        await emitProgress(input, {
          agentId: agent.agentId,
          callId,
          callIndex,
          expectedCalls,
          status: "provider_retry",
          requestArtifactId,
          errors: [...providerAttemptErrors],
          providerMode: input.providerMode ?? "fixture",
          ...(input.modelId ? { modelId: input.modelId } : {})
        });
      }
      try {
        resolvedProviderResult = normalizeProviderResult(await input.provider(request));
        if (attemptIndex > 0) {
          await emitProgress(input, {
            agentId: agent.agentId,
            callId,
            callIndex,
            expectedCalls,
            status: "provider_retry_recovered",
            requestArtifactId,
            errors: [...providerAttemptErrors],
            providerMode: resolvedProviderResult.providerMode ?? input.providerMode ?? "fixture",
            ...(resolvedProviderResult.modelId ?? input.modelId ? { modelId: resolvedProviderResult.modelId ?? input.modelId } : {})
          });
        }
        break;
      } catch (error) {
        providerAttemptErrors.push(formatProviderError(error));
      }
    }
    const providerRetryCount = Math.max(0, providerAttemptCount - 1);
    const providerRecovered = providerRetryCount > 0 && resolvedProviderResult !== undefined;
    const recoveredProviderErrors = providerRecovered ? [...providerAttemptErrors] : [];
    if (!resolvedProviderResult) {
      const errors = providerAttemptErrors.length > 0 ? providerAttemptErrors : ["provider_error:unknown_provider_error"];
      const fallback = buildHexAgentFallbackAction({
        memory: input.memory,
        agent,
        reason: errors[errors.length - 1] ?? "provider_error:unknown_provider_error"
      });
      actions.push(fallback);
      rejectedDrafts.push({
        agentId: agent.agentId,
        errors,
        ignoredFields: []
      });
      const audit: HexAgentCommandAudit = {
        agentId: agent.agentId,
        callId,
        called: true,
        accepted: false,
        fallback: true,
        ignoredFields: [],
        repairedFields: [],
        errors,
        ...(requestArtifactId ? { requestArtifactId } : {}),
        providerMode: input.providerMode ?? "fixture",
        ...(input.modelId ? { modelId: input.modelId } : {}),
        providerAttemptCount,
        providerRetryCount,
        providerRecovered: false,
        providerAttemptErrors: errors
      };
      if (fallback.fallbackReason) {
        audit.fallbackReason = fallback.fallbackReason;
      }
      audits.push(audit);
      await emitProgress(input, {
        agentId: agent.agentId,
        callId,
        callIndex,
        expectedCalls,
        status: "provider_error",
        requestArtifactId,
        errors,
        fallbackReason: fallback.fallbackReason,
        providerMode: input.providerMode ?? "fixture",
        ...(input.modelId ? { modelId: input.modelId } : {})
      });
      await emitProgress(input, {
        agentId: agent.agentId,
        callId,
        callIndex,
        expectedCalls,
        status: "fallback",
        requestArtifactId,
        errors,
        fallbackReason: fallback.fallbackReason,
        providerMode: input.providerMode ?? "fixture",
        ...(input.modelId ? { modelId: input.modelId } : {})
      });
      continue;
    }
    const providerResult = resolvedProviderResult;
      const normalized = normalizeHexAgentActionDraft({
        rawDraft: providerResult.rawDraft,
        request
      });
      const semanticLanguageAudit = auditHexAgentDraftSemanticLanguage(normalized.draft);
      const responseRequestSizeMetrics = calculateHexAgentCommandRequestSizeMetrics({
        fullRequest: request,
        compactRequest,
        providerPromptTokens: providerResult.usage?.promptTokens
      });
      const responseArtifactId = await writeHarnessArtifact(input, {
        callId,
        agentId: agent.agentId,
        suffix: "response",
        artifactType: "hex_llm_response",
        content: {
          schemaVersion: 1,
          callId,
          rawText: providerResult.rawText,
          usage: providerResult.usage,
          providerDiagnostics: providerResult.providerDiagnostics,
          rawDraft: providerResult.rawDraft,
          normalized,
          semanticLanguageAudit,
          requestSizeMetrics: responseRequestSizeMetrics
        }
      });
      if (responseArtifactId) {
        await emitProgress(input, {
          agentId: agent.agentId,
          callId,
          callIndex,
          expectedCalls,
          status: "response_artifact_written",
          requestArtifactId,
          responseArtifactId,
          providerMode: providerResult.providerMode ?? input.providerMode,
          ...(providerResult.modelId ?? input.modelId ? { modelId: providerResult.modelId ?? input.modelId } : {})
        });
      }

      if (!normalized.draft) {
        const fallback = buildHexAgentFallbackAction({
          memory: input.memory,
          agent,
          reason: normalized.errors.join(";") || "invalid_draft"
        });
        actions.push(fallback);
        rejectedDrafts.push({
          agentId: agent.agentId,
          errors: normalized.errors,
          ignoredFields: normalized.ignoredFields
        });
        audits.push(buildAudit({
          agentId: agent.agentId,
          callId,
          called: true,
          action: fallback,
          errors: normalized.errors,
          ignoredFields: normalized.ignoredFields,
          repairedFields: normalized.repairedFields,
          requestArtifactId,
          responseArtifactId,
          providerResult,
          requestSizeMetrics: responseRequestSizeMetrics,
          semanticLanguageAudit,
          input,
          providerAttemptCount,
          providerRetryCount,
          providerRecovered,
          providerAttemptErrors,
          recoveredProviderErrors
        }));
        await emitProgress(input, {
          agentId: agent.agentId,
          callId,
          callIndex,
          expectedCalls,
          status: "rejected",
          requestArtifactId,
          responseArtifactId,
          repairedFields: normalized.repairedFields,
          errors: normalized.errors,
          fallbackReason: fallback.fallbackReason,
          providerMode: providerResult.providerMode ?? input.providerMode,
          ...(providerResult.modelId ?? input.modelId ? { modelId: providerResult.modelId ?? input.modelId } : {})
        });
        await emitProgress(input, {
          agentId: agent.agentId,
          callId,
          callIndex,
          expectedCalls,
          status: "fallback",
          requestArtifactId,
          responseArtifactId,
          repairedFields: normalized.repairedFields,
          errors: normalized.errors,
          fallbackReason: fallback.fallbackReason,
          providerMode: providerResult.providerMode ?? input.providerMode,
          ...(providerResult.modelId ?? input.modelId ? { modelId: providerResult.modelId ?? input.modelId } : {})
        });
        continue;
      }

      let validated = validateHexAgentActionDraft({
        asset: input.asset,
        memory: input.memory,
        draft: normalized.draft,
        ...(input.economyContext ? { economyContext: input.economyContext } : {})
      });
      if (validated.valid && isTargetCellOccupiedByFriendly(validated, occupiedCellOwners, reservedCellOwners)) {
        validated = tryRepairOccupiedTarget({
          asset: input.asset,
          memory: input.memory,
          original: validated,
          draft: normalized.draft,
          request,
          ...(input.economyContext ? { economyContext: input.economyContext } : {}),
          occupiedCellOwners,
          reservedCellOwners
        }) ?? buildOccupiedCellFallback(input.memory, agent);
      }
      actions.push(validated);
      if (!validated.valid) {
        rejectedDrafts.push({
          agentId: agent.agentId,
          errors: validated.validationErrors,
          ignoredFields: normalized.ignoredFields
        });
      }
      audits.push(buildAudit({
        agentId: agent.agentId,
        callId,
        called: true,
        action: validated,
        errors: validated.validationErrors,
        ignoredFields: normalized.ignoredFields,
        repairedFields: normalized.repairedFields,
        requestArtifactId,
        responseArtifactId,
        providerResult,
        requestSizeMetrics: responseRequestSizeMetrics,
        semanticLanguageAudit,
        input,
        providerAttemptCount,
        providerRetryCount,
        providerRecovered,
        providerAttemptErrors,
        recoveredProviderErrors
      }));
      if (normalized.repairedFields.length > 0) {
        await emitProgress(input, {
          agentId: agent.agentId,
          callId,
          callIndex,
          expectedCalls,
          status: "repaired",
          requestArtifactId,
          responseArtifactId,
          repairedFields: normalized.repairedFields,
          providerMode: providerResult.providerMode ?? input.providerMode,
          ...(providerResult.modelId ?? input.modelId ? { modelId: providerResult.modelId ?? input.modelId } : {})
        });
      }
      await emitProgress(input, {
        agentId: agent.agentId,
        callId,
        callIndex,
        expectedCalls,
        status: validated.valid ? "accepted" : "rejected",
        requestArtifactId,
        responseArtifactId,
        repairedFields: normalized.repairedFields,
        errors: validated.validationErrors,
        fallbackReason: validated.fallbackReason,
        providerMode: providerResult.providerMode ?? input.providerMode,
        ...(providerResult.modelId ?? input.modelId ? { modelId: providerResult.modelId ?? input.modelId } : {})
      });
      if (!validated.valid) {
        await emitProgress(input, {
          agentId: agent.agentId,
          callId,
          callIndex,
          expectedCalls,
          status: "fallback",
          requestArtifactId,
          responseArtifactId,
          repairedFields: normalized.repairedFields,
          errors: validated.validationErrors,
          fallbackReason: validated.fallbackReason,
          providerMode: providerResult.providerMode ?? input.providerMode,
          ...(providerResult.modelId ?? input.modelId ? { modelId: providerResult.modelId ?? input.modelId } : {})
        });
      } else {
        reservedCellOwners.set(validated.targetCellId, {
          agentId: validated.agentId,
          teamId: validated.teamId,
          side: validated.side
        });
      }
  }

  const acceptedActions = actions.filter((action) => action.valid);
  const fallbackActions = actions.filter((action) => !action.valid);
  return {
    actions,
    acceptedActions,
    fallbackActions,
    rejectedDrafts,
    audits,
    totalCallsAttempted: callsAttempted,
    fallbackCount: fallbackActions.length
  };
}

interface HexCellOccupant {
  agentId: string;
  teamId: string;
  side: HexRoundMemory["agents"][number]["side"];
}

function isTargetCellOccupiedByFriendly(
  action: HexValidatedAgentAction,
  occupiedCellOwners: ReadonlyMap<string, HexCellOccupant>,
  reservedCellOwners: ReadonlyMap<string, HexCellOccupant>
): boolean {
  const occupiedBy = occupiedCellOwners.get(action.targetCellId);
  if (occupiedBy && occupiedBy.agentId !== action.agentId && occupiedBy.teamId === action.teamId) {
    return true;
  }
  const reservedBy = reservedCellOwners.get(action.targetCellId);
  return Boolean(reservedBy && reservedBy.agentId !== action.agentId && reservedBy.teamId === action.teamId);
}

function buildOccupiedCellFallback(memory: HexRoundMemory, agent: HexRoundMemory["agents"][number]): HexValidatedAgentAction {
  const validationErrors: HexAgentActionValidationError[] = ["target_cell_occupied"];
  return {
    ...buildHexAgentFallbackAction({
      memory,
      agent,
      reason: "target_cell_occupied"
    }),
    validationErrors
  };
}

function tryRepairOccupiedTarget(input: {
  asset: HexMapAsset;
  memory: HexRoundMemory;
  original: HexValidatedAgentAction;
  draft: HexAgentActionDraft;
  request: HexAgentCommandRequest;
  economyContext?: HexRoundEconomyContext;
  occupiedCellOwners: ReadonlyMap<string, HexCellOccupant>;
  reservedCellOwners: ReadonlyMap<string, HexCellOccupant>;
}): HexValidatedAgentAction | undefined {
  const candidates = input.request.targetCandidates.length > 0 ? input.request.targetCandidates : input.request.routeCandidates;
  for (const candidate of candidates) {
    if (candidate.targetCellId === input.original.targetCellId) {
      continue;
    }
    if (isFriendlyCellBlocked(candidate.targetCellId, input.original.agentId, input.original.teamId, input.occupiedCellOwners, input.reservedCellOwners)) {
      continue;
    }
    if (input.original.actionType === "move" && candidate.targetCellId === input.original.currentCellId) {
      continue;
    }
    const repaired = validateHexAgentActionDraft({
      asset: input.asset,
      memory: input.memory,
      draft: {
        ...input.draft,
        targetCellId: candidate.targetCellId
      },
      ...(input.economyContext ? { economyContext: input.economyContext } : {})
    });
    if (repaired.valid && !isTargetCellOccupiedByFriendly(repaired, input.occupiedCellOwners, input.reservedCellOwners)) {
      return {
        ...repaired,
        repairReasons: [...(repaired.repairReasons ?? []), "repaired_target_cell_occupied"],
        riskNotes: [...repaired.riskNotes, "repaired_target_cell_occupied"]
      };
    }
  }
  return undefined;
}

function isFriendlyCellBlocked(
  cellId: string,
  agentId: string,
  teamId: string,
  occupiedCellOwners: ReadonlyMap<string, HexCellOccupant>,
  reservedCellOwners: ReadonlyMap<string, HexCellOccupant>
): boolean {
  const occupiedBy = occupiedCellOwners.get(cellId);
  if (occupiedBy && occupiedBy.agentId !== agentId && occupiedBy.teamId === teamId) {
    return true;
  }
  const reservedBy = reservedCellOwners.get(cellId);
  return Boolean(reservedBy && reservedBy.agentId !== agentId && reservedBy.teamId === teamId);
}

async function emitProgress(
  input: RunHexAgentPhaseCommandHarnessInput,
  event: Omit<HexAgentCommandProgressEvent, "phaseId" | "phaseIndex">
): Promise<void> {
  if (!input.progressSink) {
    return;
  }
  await input.progressSink({
    phaseId: input.memory.phaseId,
    phaseIndex: input.memory.phaseIndex,
    ...event
  });
}

export function createFixtureHexAgentCommandProvider(): HexAgentCommandProvider {
  return (request) => ({
    providerMode: "fixture",
    modelId: "fixture_hex_agent_command",
    rawDraft: {
      agentId: request.agent.agentId,
      phaseId: request.phaseId,
      currentCellId: request.agent.currentCellId,
      targetCellId: request.reachableCells[0]?.cellId ?? request.agent.currentCellId,
      actionType: "hold_position",
      businessIntent: `${request.agent.teamId}/${request.agent.agentId} uses fixture Hex command to preserve a legal business-plan action.`,
      tacticalIntent: "fixture keeps the agent inside validated Hex state",
      riskNotes: ["fixture"],
      confidence: 0.7
    }
  });
}

export interface EnvHexAgentCommandProviderFactoryResult {
  provider: HexAgentCommandProvider;
  providerMode: "real";
  modelId: string;
}

export function createEnvHexAgentCommandProvider(
  env: Record<string, string | undefined> = process.env
): EnvHexAgentCommandProviderFactoryResult {
  const config = loadAgentMajorLlmConfig(env);
  const modelId = config.phase18DriverModelId;
  if (!config.enabled || !config.baseUrl || !config.apiKey) {
    return {
      providerMode: "real",
      modelId,
      provider: () => {
        throw new Error(`real_llm_disabled:${config.disabledReason ?? "missing_configuration"}`);
      }
    };
  }

  const gateway = new DashScopeOpenAiProvider({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    providerId: config.providerId,
    ...(config.modelName ? { modelName: config.modelName } : {}),
    reasoningMode: config.reasoningMode,
    reasoningEffort: config.reasoningEffort,
    timeoutMs: config.timeoutMs,
    maxRetries: Math.min(config.maxRetries, 1)
  });

  return {
    providerMode: "real",
    modelId: config.modelName ?? modelId,
    provider: async (request) => {
      const compactRequest = buildHexAgentCompactCommandRequest(request);
      const response = await gateway.generateStructured<Record<string, unknown>, HexAgentCompactCommandRequest>({
        task: "agent_action",
        driverModelId: modelId,
        input: compactRequest,
        schemaName: "HexAgentActionDraft",
        responseFormat: "json_object",
        modelTier: "standard",
        temperature: 0.35,
        maxOutputTokens: 900,
        extraParams: { thinking: { type: "disabled" } },
        messages: buildRealHexAgentCommandMessages(compactRequest)
      });
      return {
        providerMode: "real",
        modelId: config.modelName ?? modelId,
        rawDraft: response.data.draft ?? response.data,
        ...(response.rawText !== undefined ? { rawText: response.rawText } : {}),
        usage: response.usage,
        ...(response.providerDiagnostics ? { providerDiagnostics: response.providerDiagnostics } : {})
      };
    }
  };
}

export function buildRealHexAgentCommandMessages(request: HexAgentCompactCommandRequest) {
  return [
    {
      role: "system" as const,
      content: [
        "你是 HexGrid 金融投资对抗比赛的 agent 行动草案生成器，CS 地图只是移动、接触和回合包装。",
        "只输出一个 JSON object。",
        "businessIntent、tacticalIntent、riskNotes 必须使用中文。",
        "businessIntent 是兼容字段名，内容只写本阶段行动理由，不要重写整段金融自证或质疑。",
        "phase0 / roundStartAgentOutput 是本局材料依据；phase1+ 是局内行动执行。你可以短句引用 phase0，但不能复述或重写完整金融材料。",
        "如果请求包含 roundStartAgentOutput，优先引用真实开局输出；输出 roundStartOutputId 和 actionRationaleZh，但不要复述完整开局判断。",
        "如果请求只有 agentOpeningBrief，它只是系统输入卡；可以短句引用 briefRefId，但不能冒充 agent 开局输出。",
        "tacticalIntent、riskNotes 也必须使用中文。",
        "如果请求包含 financeDuel，只把它当作本回合小主题摘要；局内行动必须根据当前局势、AP、目标候选和信息卡决策。",
        "你必须有赢回合意识：遇到包点入口、开阔枪线、残局、下包/拆包、已知敌人接近时，优先清点、抢枪线、补枪、换人、护包、拆包或转点支援。",
        "move 或 rotate 不是散步；如果目标会进入枪线或包点暴露，actionRationaleZh 要写清楚如何处理交火、补枪或退让风险。",
        "JSON 字段名、actionType、phaseId、agentId、cell id 必须严格保持请求里的英文标识。",
        "不要输出 winner、kills、damage、bomb result、economy delta、hidden enemy truth、database facts 或 round report fields。",
        "targetCellId 只能从 targetCandidates 中选择。",
        "lastSeenEnemies 是历史提示，不是当前敌人真实位置。"
      ].join("\n")
    },
    {
      role: "user" as const,
      content: JSON.stringify(request)
    }
  ];
}

function normalizeProviderResult(value: unknown | HexAgentCommandProviderResult): HexAgentCommandProviderResult {
  if (isProviderResult(value)) {
    return value;
  }
  return {
    rawDraft: value
  };
}

function isProviderResult(value: unknown): value is HexAgentCommandProviderResult {
  return typeof value === "object" && value !== null && "rawDraft" in value;
}

function resolveProviderMaxRetries(input: RunHexAgentPhaseCommandHarnessInput): number {
  const configured = input.providerRetryPolicy?.maxRetries;
  if (configured !== undefined) {
    return Math.max(0, Math.floor(configured));
  }
  return input.providerMode === "real" ? 1 : 0;
}

function formatProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `provider_error:${message}`;
}

async function writeHarnessArtifact(
  input: RunHexAgentPhaseCommandHarnessInput,
  artifact: {
    callId: string;
    agentId: string;
    suffix: "request" | "response";
    artifactType: string;
    content: unknown;
  }
): Promise<string | undefined> {
  if (!input.artifactStore || !input.artifactOwner) {
    return undefined;
  }
  const written = await input.artifactStore.write({
    ownerType: input.artifactOwner.ownerType,
    ownerId: input.artifactOwner.ownerId,
    artifactType: artifact.artifactType,
    relativePath: `hex-agent-command/${artifact.callId}-${artifact.suffix}.json`,
    content: JSON.stringify(artifact.content, null, 2),
    agentId: artifact.agentId,
    ...(input.artifactOwner.tournamentId ? { tournamentId: input.artifactOwner.tournamentId } : {}),
    ...(input.artifactOwner.matchId ? { matchId: input.artifactOwner.matchId } : {}),
    ...(input.artifactOwner.mapGameId ? { mapGameId: input.artifactOwner.mapGameId } : {}),
    ...(input.artifactOwner.roundId ? { roundId: input.artifactOwner.roundId } : {})
  });
  return written.id;
}

function buildAudit(input: {
  agentId: string;
  callId: string;
  called: boolean;
  action: HexValidatedAgentAction;
  errors: readonly string[];
  ignoredFields: readonly string[];
  repairedFields: readonly string[];
  requestArtifactId: string | undefined;
  responseArtifactId: string | undefined;
  providerResult: HexAgentCommandProviderResult;
  requestSizeMetrics: HexAgentCommandRequestSizeMetrics;
  semanticLanguageAudit: HexAgentSemanticLanguageAudit;
  input: RunHexAgentPhaseCommandHarnessInput;
  providerAttemptCount?: number;
  providerRetryCount?: number;
  providerRecovered?: boolean;
  providerAttemptErrors?: readonly string[];
  recoveredProviderErrors?: readonly string[];
}): HexAgentCommandAudit {
  const audit: HexAgentCommandAudit = {
    agentId: input.agentId,
    callId: input.callId,
    called: input.called,
    accepted: input.action.valid,
    fallback: !input.action.valid,
    ignoredFields: [...input.ignoredFields],
    repairedFields: [...input.repairedFields, ...(input.action.repairReasons ?? [])],
    errors: input.errors.map(String),
    providerMode: input.providerResult.providerMode ?? input.input.providerMode ?? "fixture",
    requestSizeMetrics: input.requestSizeMetrics,
    semanticLanguage: input.semanticLanguageAudit.semanticLanguage,
    languageMismatch: input.semanticLanguageAudit.languageMismatch,
    inspectedSemanticFields: [...input.semanticLanguageAudit.inspectedSemanticFields]
  };
  if (input.action.fallbackReason) {
    audit.fallbackReason = input.action.fallbackReason;
  }
  if (input.requestArtifactId) {
    audit.requestArtifactId = input.requestArtifactId;
  }
  if (input.responseArtifactId) {
    audit.responseArtifactId = input.responseArtifactId;
  }
  if (input.providerAttemptCount !== undefined) {
    audit.providerAttemptCount = input.providerAttemptCount;
  }
  if (input.providerRetryCount !== undefined) {
    audit.providerRetryCount = input.providerRetryCount;
  }
  if (input.providerRecovered !== undefined) {
    audit.providerRecovered = input.providerRecovered;
  }
  if (input.providerAttemptErrors && input.providerAttemptErrors.length > 0) {
    audit.providerAttemptErrors = [...input.providerAttemptErrors];
  }
  if (input.recoveredProviderErrors && input.recoveredProviderErrors.length > 0) {
    audit.recoveredProviderErrors = [...input.recoveredProviderErrors];
  }
  const modelId = input.providerResult.modelId ?? input.input.modelId;
  if (modelId) {
    audit.modelId = modelId;
  }
  if (input.providerResult.providerDiagnostics?.contentLength !== undefined) {
    audit.contentLength = input.providerResult.providerDiagnostics.contentLength;
  } else if (input.providerResult.rawText !== undefined) {
    audit.contentLength = input.providerResult.rawText.length;
  }
  if (input.providerResult.providerDiagnostics?.reasoningContentLength !== undefined) {
    audit.reasoningContentLength = input.providerResult.providerDiagnostics.reasoningContentLength;
  }
  return audit;
}

function buildCallId(input: RunHexAgentPhaseCommandHarnessInput, agentId: string): string {
  const prefix = input.callIdPrefix ?? "hex_agent_cmd";
  return `${prefix}_${input.memory.phaseIndex}_${agentId}`;
}
