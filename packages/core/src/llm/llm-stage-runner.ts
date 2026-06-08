import type { Repositories } from "@agent-major/db";
import type { LlmGateway, LlmMessage, LlmResponse } from "@agent-major/llm";
import type { Agent, Event, MapGame, Match, Round } from "@agent-major/shared";

import type { ArtifactStore } from "../ports.js";
import {
  PHASE20_PRE_PROMPT_CONTRACT_ID,
  buildPhase20PrePromptHashSource
} from "../phase18/phase20-pre-prompt-contract.js";

export type LlmStageRetryMode = "full_round" | "resume_from_stage";

export type LlmStageTask =
  | "team_plan"
  | "agent_action"
  | "judge_verdict"
  | "judge_narrative"
  | "judge_review"
  | "combat_resolution"
  | "coach_timeout"
  | "coach_post_match_review";

export interface StructuredStageInput<TData> {
  callId: string;
  stageId?: string | undefined;
  retryMode?: LlmStageRetryMode | undefined;
  attemptNumber: number;
  task: LlmStageTask;
  schemaName: string;
  driverModelId: string;
  requestInput: unknown;
  responseFormat: "json_object";
  seed: string;
  modelTier: "cheap" | "standard" | "strong";
  temperature: number;
  maxOutputTokens?: number | undefined;
  extraParams?: Record<string, unknown> | undefined;
  match: Match;
  mapGame: MapGame;
  round: Round;
  roundNumber: number;
  agent?: Agent | undefined;
  validateResponseData?: ((data: unknown) => TData) | undefined;
}

export type ObservedLlmStageResponse<TData> = LlmResponse<TData> & {
  requestArtifactId?: string | undefined;
  responseArtifactId?: string | undefined;
};

export interface MatchStructuredStageInput<TData> {
  callId: string;
  task: "coach_post_match_review";
  schemaName: string;
  driverModelId: string;
  requestInput: unknown;
  responseFormat: "json_object";
  seed: string;
  modelTier: "cheap" | "standard" | "strong";
  temperature: number;
  maxOutputTokens?: number | undefined;
  match: Match;
  validateResponseData?: ((data: unknown) => TData) | undefined;
}

export interface LlmStageRunner {
  runStructuredStage<TData>(input: StructuredStageInput<TData>): Promise<ObservedLlmStageResponse<TData>>;
  runMatchStructuredStage<TData>(input: MatchStructuredStageInput<TData>): Promise<ObservedLlmStageResponse<TData>>;
}

export interface RealLlmStageRunnerInput {
  repositories: Repositories;
  llmGateway: LlmGateway;
  artifactStore?: ArtifactStore | undefined;
  eventSourceModule?: string | undefined;
  buildMessages(input: { task: LlmStageTask; schemaName: string; requestInput: unknown }): LlmMessage[];
  assertNoMojibakePayload(value: unknown, label: string): void;
}

export function createLlmStageRunner(input:
  | {
      runStructuredStage: <TData>(stageInput: StructuredStageInput<TData>) => Promise<ObservedLlmStageResponse<TData>>;
    }
  | RealLlmStageRunnerInput
): LlmStageRunner {
  if ("runStructuredStage" in input) {
    return {
      runStructuredStage: input.runStructuredStage,
      runMatchStructuredStage: async () => {
        throw new Error("Match structured stages are not supported by this delegated LLM stage runner.");
      }
    };
  }

  return new ObservedLlmStageRunner(input);
}

class ObservedLlmStageRunner implements LlmStageRunner {
  constructor(private readonly context: RealLlmStageRunnerInput) {}

  async runMatchStructuredStage<TData>(input: MatchStructuredStageInput<TData>): Promise<ObservedLlmStageResponse<TData>> {
    const promptContractId = PHASE20_PRE_PROMPT_CONTRACT_ID;
    const promptHash = stableHex(buildPhase20PrePromptHashSource({
      task: input.task,
      schemaName: input.schemaName,
      requestInput: input.requestInput,
      promptContractId
    }));
    const startedAt = timestamp();
    const requestArtifactId = await this.writeLlmArtifact({
      callId: input.callId,
      suffix: "request",
      artifactType: "llm_request",
      match: input.match,
      content: {
        schemaVersion: 1,
        taskType: input.task,
        driverModelId: input.driverModelId,
        schemaName: input.schemaName,
        promptContractId,
        promptHash,
        input: input.requestInput
      }
    });
    await this.appendEvent({
      id: `evt_${input.callId}_started`,
      type: "llm_call_started",
      category: "system",
      tournamentId: input.match.tournamentId,
      matchId: input.match.id,
      scopeType: "match",
      scopeId: input.match.id,
      payload: {
        schemaVersion: 1,
        callId: input.callId,
        taskType: input.task,
        driverModelId: input.driverModelId,
        promptContractId,
        status: "started",
        startedAt
      },
      createdAt: startedAt
    });
    await this.context.repositories.llmCalls.save(removeUndefined({
      id: input.callId,
      tournamentId: input.match.tournamentId,
      matchId: input.match.id,
      driverModelId: input.driverModelId,
      taskType: input.task,
      promptContractId,
      promptHash,
      requestArtifactId,
      status: "started",
      createdAt: startedAt
    }));

    let latestResponse: LlmResponse<TData> | undefined;
    try {
      this.context.assertNoMojibakePayload(input.requestInput, `${input.task} request`);
      const messages = this.context.buildMessages({
        task: input.task,
        schemaName: input.schemaName,
        requestInput: input.requestInput
      });
      this.context.assertNoMojibakePayload(messages, `${input.task} prompt messages`);
      const response = await this.context.llmGateway.generateStructured<TData, unknown>({
        task: input.task,
        driverModelId: input.driverModelId,
        input: input.requestInput,
        schemaName: input.schemaName,
        messages,
        responseFormat: input.responseFormat,
        seed: input.seed,
        modelTier: input.modelTier,
        temperature: input.temperature,
        ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {})
      });
      latestResponse = response;
      this.context.assertNoMojibakePayload(response.rawText, `${input.task} raw response`);
      this.context.assertNoMojibakePayload(response.structuredRepair?.originalRawText, `${input.task} repair original response`);
      this.context.assertNoMojibakePayload(response.structuredRepair?.repairRawText, `${input.task} repair response`);
      this.context.assertNoMojibakePayload(response.data, `${input.task} structured response`);
      const data = input.validateResponseData ? input.validateResponseData(response.data) : response.data;
      const validatedResponse: LlmResponse<TData> = { ...response, data };
      const completedAt = timestamp();
      const responseArtifactId = await this.writeLlmArtifact({
        callId: input.callId,
        suffix: "response",
        artifactType: "llm_response",
        match: input.match,
        content: {
          schemaVersion: 1,
          taskType: input.task,
          driverModelId: input.driverModelId,
          promptContractId,
          ok: true,
          rawText: validatedResponse.rawText,
          usage: validatedResponse.usage,
          providerDiagnostics: validatedResponse.providerDiagnostics,
          structuredRepair: validatedResponse.structuredRepair,
          data: validatedResponse.data
        }
      });
      await this.context.repositories.llmCalls.save(removeUndefined({
        id: input.callId,
        tournamentId: input.match.tournamentId,
        matchId: input.match.id,
        driverModelId: input.driverModelId,
        taskType: input.task,
        promptContractId,
        promptHash,
        requestArtifactId,
        responseArtifactId,
        inputTokens: validatedResponse.usage.promptTokens,
        outputTokens: validatedResponse.usage.completionTokens,
        status: "completed",
        completedAt,
        latencyMs: Date.parse(completedAt) - Date.parse(startedAt),
        repaired: Boolean(validatedResponse.structuredRepair),
        createdAt: startedAt
      }));
      await this.appendEvent({
        id: `evt_${input.callId}_completed`,
        type: "llm_call_completed",
        category: "system",
        tournamentId: input.match.tournamentId,
        matchId: input.match.id,
        scopeType: "match",
        scopeId: input.match.id,
        payload: {
          schemaVersion: 1,
          callId: input.callId,
          taskType: input.task,
          driverModelId: input.driverModelId,
          promptContractId,
          status: "completed",
          startedAt,
          completedAt,
          latencyMs: Date.parse(completedAt) - Date.parse(startedAt),
          inputTokens: validatedResponse.usage.promptTokens,
          outputTokens: validatedResponse.usage.completionTokens,
          repaired: Boolean(validatedResponse.structuredRepair),
          providerDiagnostics: validatedResponse.providerDiagnostics,
          rawTextPreview: previewText(validatedResponse.structuredRepair?.originalRawText),
          repairRawTextPreview: previewText(validatedResponse.structuredRepair?.repairRawText)
        },
        createdAt: completedAt
      });
      return {
        ...validatedResponse,
        requestArtifactId,
        responseArtifactId
      };
    } catch (error) {
      const failedAt = timestamp();
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorKind = classifyLlmErrorKind(errorMessage);
      const diagnostic = readLlmErrorDiagnostic(error);
      const failedRawText = latestResponse?.rawText ?? diagnostic.rawText;
      const failedUsage = latestResponse?.usage ?? diagnostic.usage;
      const responseArtifactId = await this.writeLlmArtifact({
        callId: input.callId,
        suffix: "response",
        artifactType: "llm_response",
        match: input.match,
        content: {
          schemaVersion: 1,
          taskType: input.task,
          driverModelId: input.driverModelId,
          promptContractId,
          ok: false,
          rawText: failedRawText,
          rawTextPreview: previewText(failedRawText),
          parseCandidatePreview: previewText(diagnostic.parseCandidate),
          usage: failedUsage,
          providerDiagnostics: latestResponse?.providerDiagnostics ?? diagnostic.providerDiagnostics,
          data: latestResponse?.data,
          structuredRepair: latestResponse?.structuredRepair,
          errorKind,
          error: errorMessage
        }
      });
      await this.context.repositories.llmCalls.save(removeUndefined({
        id: input.callId,
        tournamentId: input.match.tournamentId,
        matchId: input.match.id,
        driverModelId: input.driverModelId,
        taskType: input.task,
        promptContractId,
        promptHash,
        requestArtifactId,
        responseArtifactId,
        inputTokens: failedUsage?.promptTokens,
        outputTokens: failedUsage?.completionTokens,
        status: "failed",
        error: errorMessage,
        completedAt: failedAt,
        latencyMs: Date.parse(failedAt) - Date.parse(startedAt),
        repaired: Boolean(latestResponse?.structuredRepair),
        createdAt: startedAt
      }));
      await this.appendEvent({
        id: `evt_${input.callId}_failed`,
        type: "llm_call_failed",
        category: "system",
        tournamentId: input.match.tournamentId,
        matchId: input.match.id,
        scopeType: "match",
        scopeId: input.match.id,
        payload: {
          schemaVersion: 1,
          callId: input.callId,
          taskType: input.task,
          driverModelId: input.driverModelId,
          promptContractId,
          status: "failed",
          startedAt,
          failedAt,
          latencyMs: Date.parse(failedAt) - Date.parse(startedAt),
          inputTokens: failedUsage?.promptTokens,
          outputTokens: failedUsage?.completionTokens,
          responseArtifactId,
          rawTextPreview: previewText(failedRawText),
          parseCandidatePreview: previewText(diagnostic.parseCandidate),
          providerDiagnostics: latestResponse?.providerDiagnostics ?? diagnostic.providerDiagnostics,
          errorKind,
          error: errorMessage
        },
        createdAt: failedAt
      });
      throw error;
    }
  }

  async runStructuredStage<TData>(input: StructuredStageInput<TData>): Promise<ObservedLlmStageResponse<TData>> {
    const promptContractId = PHASE20_PRE_PROMPT_CONTRACT_ID;
    const stageId = input.stageId ?? `${input.task}:${input.agent?.id ?? "round"}`;
    const promptHash = stableHex(buildPhase20PrePromptHashSource({
      task: input.task,
      schemaName: input.schemaName,
      requestInput: input.requestInput,
      promptContractId
    }));
    if (input.retryMode === "resume_from_stage") {
      const checkpoint = await this.readValidatedRoundStageCheckpoint<TData>({
        matchId: input.match.id,
        roundId: input.round.id,
        stageId,
        task: input.task,
        schemaName: input.schemaName,
        promptContractId,
        promptHash
      });
      if (checkpoint) {
        const reusedAt = timestamp();
        await this.appendEvent({
          id: `evt_${input.callId}_stage_reused`,
          type: "round_generation_stage_reused",
          category: "runtime_control",
          tournamentId: input.match.tournamentId,
          matchId: input.match.id,
          mapGameId: input.mapGame.id,
          scopeType: "map",
          scopeId: input.mapGame.id,
          payload: removeUndefined({
            schemaVersion: 1,
            attemptNumber: input.attemptNumber,
            callId: input.callId,
            reusedFromCallId: checkpoint.callId,
            stageId,
            taskType: input.task,
            schemaName: input.schemaName,
            roundId: input.round.id,
            roundNumber: input.roundNumber,
            agentId: input.agent?.id,
            promptContractId,
            promptHash,
            requestArtifactId: checkpoint.requestArtifactId,
            responseArtifactId: checkpoint.responseArtifactId,
            reusedAt
          }),
          createdAt: reusedAt
        });
        return {
          data: checkpoint.data,
          usage: {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0
          },
          requestArtifactId: checkpoint.requestArtifactId,
          responseArtifactId: checkpoint.responseArtifactId
        };
      }
    }
    const staleRecovery =
      input.retryMode === "resume_from_stage"
        ? await this.recoverStaleStartedRoundStageCalls({
            matchId: input.match.id,
            mapGameId: input.mapGame.id,
            tournamentId: input.match.tournamentId,
            roundId: input.round.id,
            roundNumber: input.roundNumber,
            stageId,
            task: input.task,
            schemaName: input.schemaName,
            promptContractId,
            attemptNumber: input.attemptNumber,
            promptHash,
            agentId: input.agent?.id
          })
        : { hasPriorStageActivity: false, nextCallIndex: 0 };
    const callId =
      staleRecovery.hasPriorStageActivity && !/_resume_\d+$/.test(input.callId)
        ? `${input.callId}_resume_${staleRecovery.nextCallIndex}`
        : input.callId;
    const startedAt = timestamp();
    await this.appendEvent({
      id: `evt_${callId}_stage_started`,
      type: "round_generation_stage_started",
      category: "runtime_control",
      tournamentId: input.match.tournamentId,
      matchId: input.match.id,
      mapGameId: input.mapGame.id,
      scopeType: "map",
      scopeId: input.mapGame.id,
      payload: removeUndefined({
        schemaVersion: 1,
        attemptNumber: input.attemptNumber,
        callId,
        ...(callId !== input.callId ? { originalCallId: input.callId } : {}),
        stageId,
        taskType: input.task,
        schemaName: input.schemaName,
        roundId: input.round.id,
        roundNumber: input.roundNumber,
        agentId: input.agent?.id,
        promptContractId,
        promptHash,
        retryMode: input.retryMode ?? "full_round",
        startedAt
      }),
      createdAt: startedAt
    });
    const requestArtifactId = await this.writeLlmArtifact({
      callId,
      suffix: "request",
      artifactType: "llm_request",
      match: input.match,
      mapGame: input.mapGame,
      agent: input.agent,
      content: {
        schemaVersion: 1,
        attemptNumber: input.attemptNumber,
        taskType: input.task,
        driverModelId: input.driverModelId,
        schemaName: input.schemaName,
        promptContractId,
        promptHash,
        ...(input.extraParams ? { extraParams: input.extraParams } : {}),
        input: input.requestInput
      }
    });
    await this.appendEvent({
      id: `evt_${callId}_started`,
      type: "llm_call_started",
      category: "system",
      tournamentId: input.match.tournamentId,
      matchId: input.match.id,
      mapGameId: input.mapGame.id,
      scopeType: "map",
      scopeId: input.mapGame.id,
      payload: {
        schemaVersion: 1,
        attemptNumber: input.attemptNumber,
        callId,
        ...(callId !== input.callId ? { originalCallId: input.callId } : {}),
        taskType: input.task,
        roundId: input.round.id,
        roundNumber: input.roundNumber,
        agentId: input.agent?.id,
        driverModelId: input.driverModelId,
        promptContractId,
        status: "started",
        startedAt
      },
      createdAt: startedAt
    });
    await this.context.repositories.llmCalls.save(removeUndefined({
      id: callId,
      tournamentId: input.match.tournamentId,
      matchId: input.match.id,
      agentId: input.agent?.id,
      driverModelId: input.driverModelId,
      taskType: input.task,
      promptContractId,
      promptHash,
      requestArtifactId,
      status: "started",
      createdAt: startedAt
    }));

    let latestResponse: LlmResponse<TData> | undefined;
    try {
      this.context.assertNoMojibakePayload(input.requestInput, `${input.task} request`);
      const messages = this.context.buildMessages({
        task: input.task,
        schemaName: input.schemaName,
        requestInput: input.requestInput
      });
      this.context.assertNoMojibakePayload(messages, `${input.task} prompt messages`);
      const response = await this.context.llmGateway.generateStructured<TData, unknown>({
        task: input.task,
        driverModelId: input.driverModelId,
        input: input.requestInput,
        schemaName: input.schemaName,
        messages,
        responseFormat: input.responseFormat,
        seed: input.seed,
        modelTier: input.modelTier,
        temperature: input.temperature,
        ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
        ...(input.extraParams ? { extraParams: input.extraParams } : {})
      });
      latestResponse = response;
      this.context.assertNoMojibakePayload(response.rawText, `${input.task} raw response`);
      this.context.assertNoMojibakePayload(response.structuredRepair?.originalRawText, `${input.task} repair original response`);
      this.context.assertNoMojibakePayload(response.structuredRepair?.repairRawText, `${input.task} repair response`);
      this.context.assertNoMojibakePayload(response.data, `${input.task} structured response`);
      const data = input.validateResponseData ? input.validateResponseData(response.data) : response.data;
      const validatedResponse: LlmResponse<TData> = { ...response, data };
      const completedAt = timestamp();
      const responseArtifactId = await this.writeLlmArtifact({
        callId,
        suffix: "response",
        artifactType: "llm_response",
        match: input.match,
        mapGame: input.mapGame,
        agent: input.agent,
        content: {
          schemaVersion: 1,
          attemptNumber: input.attemptNumber,
          taskType: input.task,
          driverModelId: input.driverModelId,
          promptContractId,
          ...(input.extraParams ? { extraParams: input.extraParams } : {}),
          ok: true,
          rawText: validatedResponse.rawText,
          usage: validatedResponse.usage,
          providerDiagnostics: validatedResponse.providerDiagnostics,
          structuredRepair: validatedResponse.structuredRepair,
          data: validatedResponse.data
        }
      });
      await this.appendEvent({
        id: `evt_${callId}_stage_validated`,
        type: "round_generation_stage_validated",
        category: "runtime_control",
        tournamentId: input.match.tournamentId,
        matchId: input.match.id,
        mapGameId: input.mapGame.id,
        scopeType: "map",
        scopeId: input.mapGame.id,
        payload: removeUndefined({
          schemaVersion: 1,
          attemptNumber: input.attemptNumber,
          callId,
          ...(callId !== input.callId ? { originalCallId: input.callId } : {}),
          stageId,
          taskType: input.task,
          schemaName: input.schemaName,
          roundId: input.round.id,
          roundNumber: input.roundNumber,
          agentId: input.agent?.id,
          promptContractId,
          promptHash,
          requestArtifactId,
          responseArtifactId,
          validatedData: validatedResponse.data,
          validatedAt: completedAt
        }),
        createdAt: completedAt
      });
      await this.context.repositories.llmCalls.save(removeUndefined({
        id: callId,
        tournamentId: input.match.tournamentId,
        matchId: input.match.id,
        agentId: input.agent?.id,
        driverModelId: input.driverModelId,
        taskType: input.task,
        promptContractId,
        promptHash,
        requestArtifactId,
        responseArtifactId,
        inputTokens: validatedResponse.usage.promptTokens,
        outputTokens: validatedResponse.usage.completionTokens,
        status: "completed",
        completedAt,
        latencyMs: Date.parse(completedAt) - Date.parse(startedAt),
        repaired: Boolean(validatedResponse.structuredRepair),
        createdAt: startedAt
      }));
      await this.appendEvent({
        id: `evt_${callId}_completed`,
        type: "llm_call_completed",
        category: "system",
        tournamentId: input.match.tournamentId,
        matchId: input.match.id,
        mapGameId: input.mapGame.id,
        scopeType: "map",
        scopeId: input.mapGame.id,
        payload: {
          schemaVersion: 1,
          attemptNumber: input.attemptNumber,
          callId,
          ...(callId !== input.callId ? { originalCallId: input.callId } : {}),
          taskType: input.task,
          roundId: input.round.id,
          roundNumber: input.roundNumber,
          agentId: input.agent?.id,
          driverModelId: input.driverModelId,
          promptContractId,
          status: "completed",
          startedAt,
          completedAt,
          latencyMs: Date.parse(completedAt) - Date.parse(startedAt),
          inputTokens: validatedResponse.usage.promptTokens,
          outputTokens: validatedResponse.usage.completionTokens,
          repaired: Boolean(validatedResponse.structuredRepair),
          providerDiagnostics: validatedResponse.providerDiagnostics,
          rawTextPreview: previewText(validatedResponse.structuredRepair?.originalRawText),
          repairRawTextPreview: previewText(validatedResponse.structuredRepair?.repairRawText)
        },
        createdAt: completedAt
      });
      return {
        ...validatedResponse,
        requestArtifactId,
        responseArtifactId
      };
    } catch (error) {
      const failedAt = timestamp();
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorKind = classifyLlmErrorKind(errorMessage);
      const diagnostic = readLlmErrorDiagnostic(error);
      const failedRawText = latestResponse?.rawText ?? diagnostic.rawText;
      const failedUsage = latestResponse?.usage ?? diagnostic.usage;
      const responseArtifactId = await this.writeLlmArtifact({
        callId,
        suffix: "response",
        artifactType: "llm_response",
        match: input.match,
        mapGame: input.mapGame,
        agent: input.agent,
        content: {
          schemaVersion: 1,
          attemptNumber: input.attemptNumber,
          taskType: input.task,
          driverModelId: input.driverModelId,
          promptContractId,
          ...(input.extraParams ? { extraParams: input.extraParams } : {}),
          ok: false,
          rawText: failedRawText,
          rawTextPreview: previewText(failedRawText),
          parseCandidatePreview: previewText(diagnostic.parseCandidate),
          usage: failedUsage,
          providerDiagnostics: latestResponse?.providerDiagnostics ?? diagnostic.providerDiagnostics,
          data: latestResponse?.data,
          structuredRepair: latestResponse?.structuredRepair,
          errorKind,
          error: errorMessage
        }
      });
      await this.context.repositories.llmCalls.save(removeUndefined({
        id: callId,
        tournamentId: input.match.tournamentId,
        matchId: input.match.id,
        agentId: input.agent?.id,
        driverModelId: input.driverModelId,
        taskType: input.task,
        promptContractId,
        promptHash,
        requestArtifactId,
        responseArtifactId,
        inputTokens: failedUsage?.promptTokens,
        outputTokens: failedUsage?.completionTokens,
        status: "failed",
        error: errorMessage,
        completedAt: failedAt,
        latencyMs: Date.parse(failedAt) - Date.parse(startedAt),
        repaired: Boolean(latestResponse?.structuredRepair),
        createdAt: startedAt
      }));
      await this.appendEvent({
        id: `evt_${callId}_failed`,
        type: "llm_call_failed",
        category: "system",
        tournamentId: input.match.tournamentId,
        matchId: input.match.id,
        mapGameId: input.mapGame.id,
        scopeType: "map",
        scopeId: input.mapGame.id,
        payload: {
          schemaVersion: 1,
          attemptNumber: input.attemptNumber,
          callId,
          ...(callId !== input.callId ? { originalCallId: input.callId } : {}),
          taskType: input.task,
          roundId: input.round.id,
          roundNumber: input.roundNumber,
          agentId: input.agent?.id,
          driverModelId: input.driverModelId,
          promptContractId,
          status: "failed",
          startedAt,
          failedAt,
          latencyMs: Date.parse(failedAt) - Date.parse(startedAt),
          inputTokens: failedUsage?.promptTokens,
          outputTokens: failedUsage?.completionTokens,
          responseArtifactId,
          rawTextPreview: previewText(failedRawText),
          parseCandidatePreview: previewText(diagnostic.parseCandidate),
          providerDiagnostics: latestResponse?.providerDiagnostics ?? diagnostic.providerDiagnostics,
          errorKind,
          error: errorMessage
        },
        createdAt: failedAt
      });
      await this.appendEvent({
        id: `evt_${callId}_stage_failed`,
        type: "round_generation_stage_failed",
        category: "runtime_control",
        tournamentId: input.match.tournamentId,
        matchId: input.match.id,
        mapGameId: input.mapGame.id,
        scopeType: "map",
        scopeId: input.mapGame.id,
        payload: removeUndefined({
          schemaVersion: 1,
          attemptNumber: input.attemptNumber,
          callId,
          ...(callId !== input.callId ? { originalCallId: input.callId } : {}),
          stageId,
          taskType: input.task,
          schemaName: input.schemaName,
          roundId: input.round.id,
          roundNumber: input.roundNumber,
          agentId: input.agent?.id,
          promptContractId,
          promptHash,
          responseArtifactId,
          errorKind,
          providerDiagnostics: latestResponse?.providerDiagnostics ?? diagnostic.providerDiagnostics,
          error: errorMessage,
          failedAt
        }),
        createdAt: failedAt
      });
      throw error;
    }
  }

  private async readValidatedRoundStageCheckpoint<TData>(input: {
    matchId: string;
    roundId: string;
    stageId: string;
    task: LlmStageTask;
    schemaName: string;
    promptContractId: string;
    promptHash: string;
  }): Promise<{
    data: TData;
    callId: string;
    requestArtifactId?: string;
    responseArtifactId?: string;
  } | null> {
    const events = await this.context.repositories.events.listByMatch(input.matchId);
    for (const event of [...events].sort((left, right) => right.globalSequence - left.globalSequence)) {
      if (event.type !== "round_generation_stage_validated") {
        continue;
      }
      const payload = isRecord(event.payload) ? event.payload : null;
      if (
        !payload ||
        payload.roundId !== input.roundId ||
        payload.stageId !== input.stageId ||
        payload.taskType !== input.task ||
        payload.schemaName !== input.schemaName ||
        payload.promptContractId !== input.promptContractId ||
        payload.promptHash !== input.promptHash ||
        typeof payload.callId !== "string" ||
        typeof payload.validatedData === "undefined"
      ) {
        continue;
      }

      return {
        data: payload.validatedData as TData,
        callId: payload.callId,
        ...(typeof payload.requestArtifactId === "string" ? { requestArtifactId: payload.requestArtifactId } : {}),
        ...(typeof payload.responseArtifactId === "string" ? { responseArtifactId: payload.responseArtifactId } : {})
      };
    }

    return null;
  }

  private async recoverStaleStartedRoundStageCalls(input: {
    matchId: string;
    mapGameId: string;
    tournamentId: string;
    roundId: string;
    roundNumber: number;
    stageId: string;
    task: LlmStageTask;
    schemaName: string;
    promptContractId: string;
    attemptNumber: number;
    promptHash: string;
    agentId?: string | undefined;
  }): Promise<{ hasPriorStageActivity: boolean; nextCallIndex: number }> {
    const history = await this.readRoundStageHistory(input);
    if (history.length === 0) {
      return { hasPriorStageActivity: false, nextCallIndex: 0 };
    }

    const terminalCallIds = new Set(
      history
        .filter(
          (event) =>
            event.type === "round_generation_stage_validated" ||
            event.type === "round_generation_stage_failed" ||
            event.type === "round_generation_stage_stale_recovered"
        )
        .map((event) => event.callId)
    );
    const staleStartedCallIds = unique(
      history
        .filter((event) => event.type === "round_generation_stage_started" && !terminalCallIds.has(event.callId))
        .map((event) => event.callId)
    );

    for (const callId of staleStartedCallIds) {
      const existing = await this.context.repositories.llmCalls.getById(callId);
      const recoveredAt = timestamp();
      const staleReason =
        existing?.responseArtifactId
          ? "stale_started_call_after_process_interrupt: LLM call had a response artifact but no validated stage; rerunning the stage."
          : "stale_started_call_after_process_interrupt: LLM call was left started after an interrupted process; rerunning the stage.";
      if (existing?.status === "started") {
        await this.context.repositories.llmCalls.save(removeUndefined({
          ...existing,
          status: "failed",
          error: staleReason,
          completedAt: recoveredAt,
          latencyMs: 0
        }));
      }
      await this.appendEvent({
        id: `evt_${callId}_stale_marked_failed`,
        type: "llm_call_stale_marked_failed",
        category: "system",
        tournamentId: input.tournamentId,
        matchId: input.matchId,
        mapGameId: input.mapGameId,
        scopeType: "map",
        scopeId: input.mapGameId,
        payload: removeUndefined({
          schemaVersion: 1,
          attemptNumber: input.attemptNumber,
          callId,
          stageId: input.stageId,
          taskType: input.task,
          schemaName: input.schemaName,
          roundId: input.roundId,
          roundNumber: input.roundNumber,
          agentId: input.agentId,
          promptContractId: input.promptContractId,
          promptHash: input.promptHash,
          requestArtifactId: existing?.requestArtifactId,
          responseArtifactId: existing?.responseArtifactId,
          status: "failed",
          errorKind: "stale_started_call_after_process_interrupt",
          error: staleReason,
          recoveredAt
        }),
        createdAt: recoveredAt
      });
      await this.appendEvent({
        id: `evt_${callId}_stage_stale_recovered`,
        type: "round_generation_stage_stale_recovered",
        category: "runtime_control",
        tournamentId: input.tournamentId,
        matchId: input.matchId,
        mapGameId: input.mapGameId,
        scopeType: "map",
        scopeId: input.mapGameId,
        payload: removeUndefined({
          schemaVersion: 1,
          attemptNumber: input.attemptNumber,
          callId,
          stageId: input.stageId,
          taskType: input.task,
          schemaName: input.schemaName,
          roundId: input.roundId,
          roundNumber: input.roundNumber,
          agentId: input.agentId,
          promptContractId: input.promptContractId,
          promptHash: input.promptHash,
          requestArtifactId: existing?.requestArtifactId,
          responseArtifactId: existing?.responseArtifactId,
          errorKind: "stale_started_call_after_process_interrupt",
          error: staleReason,
          recoveredAt
        }),
        createdAt: recoveredAt
      });
    }

    return {
      hasPriorStageActivity: true,
      nextCallIndex: unique(history.map((event) => event.callId)).length + 1
    };
  }

  private async readRoundStageHistory(input: {
    matchId: string;
    roundId: string;
    stageId: string;
    task: LlmStageTask;
    schemaName: string;
    promptContractId: string;
  }): Promise<Array<{ type: string; callId: string }>> {
    const events = await this.context.repositories.events.listByMatch(input.matchId);
    const history: Array<{ type: string; callId: string }> = [];
    for (const event of events) {
      if (
        event.type !== "round_generation_stage_started" &&
        event.type !== "round_generation_stage_validated" &&
        event.type !== "round_generation_stage_failed" &&
        event.type !== "round_generation_stage_stale_recovered"
      ) {
        continue;
      }
      const payload = isRecord(event.payload) ? event.payload : null;
      if (
        !payload ||
        payload.roundId !== input.roundId ||
        payload.stageId !== input.stageId ||
        payload.taskType !== input.task ||
        payload.schemaName !== input.schemaName ||
        payload.promptContractId !== input.promptContractId ||
        typeof payload.callId !== "string"
      ) {
        continue;
      }
      history.push({
        type: event.type,
        callId: payload.callId
      });
    }

    return history;
  }

  private async writeLlmArtifact(input: {
    callId: string;
    suffix: "request" | "response";
    artifactType: string;
    match: Match;
    mapGame?: MapGame | undefined;
    round?: Round | undefined;
    agent?: Agent | undefined;
    content: unknown;
  }): Promise<string | undefined> {
    if (!this.context.artifactStore) {
      return undefined;
    }

    try {
      const artifact = await this.context.artifactStore.write({
        ownerType: "llm_call",
        ownerId: input.callId,
        artifactType: input.artifactType,
        relativePath: `llm/${input.callId}-${input.suffix}.json`,
        content: `${JSON.stringify(input.content, null, 2)}\n`,
        tournamentId: input.match.tournamentId,
        matchId: input.match.id,
        ...(input.mapGame ? { mapGameId: input.mapGame.id } : {}),
        ...(input.round ? { roundId: input.round.id } : {}),
        ...(input.agent ? { agentId: input.agent.id } : {})
      });
      return artifact.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to write LLM artifact ${input.callId}-${input.suffix}: ${message}`);
    }
  }

  private async appendEvent(input: Omit<Event, "globalSequence" | "sequenceInScope">): Promise<Event> {
    const [globalSequence, sequenceInScope] = await Promise.all([
      this.context.repositories.events.getMaxGlobalSequence(),
      this.context.repositories.events.getMaxSequenceInScope(input.scopeType, input.scopeId)
    ]);
    const event: Event = {
      ...input,
      globalSequence: globalSequence + 1,
      sequenceInScope: sequenceInScope + 1,
      sourceModule: input.sourceModule ?? this.context.eventSourceModule ?? "core.phase12"
    };
    return this.context.repositories.events.append(event);
  }
}

function timestamp(): string {
  return "2026-05-01T00:00:00.000Z";
}

function stableHex(input: string): string {
  let hash = 2166136261;
  for (const char of input) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item !== "undefined")) as T;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function readLlmErrorDiagnostic(error: unknown): {
  rawText?: string;
  usage?: LlmResponse["usage"];
  parseCandidate?: string;
  providerDiagnostics?: LlmResponse["providerDiagnostics"];
} {
  if (!isRecord(error)) {
    return {};
  }

  return {
    ...(typeof error.rawText === "string" ? { rawText: error.rawText } : {}),
    ...(isRecord(error.usage) &&
    typeof error.usage.promptTokens === "number" &&
    typeof error.usage.completionTokens === "number" &&
    typeof error.usage.totalTokens === "number"
      ? {
          usage: {
            promptTokens: error.usage.promptTokens,
            completionTokens: error.usage.completionTokens,
            totalTokens: error.usage.totalTokens
          }
        }
      : {}),
    ...(typeof error.parseCandidate === "string" ? { parseCandidate: error.parseCandidate } : {}),
    ...(isRecord(error.providerDiagnostics) ? { providerDiagnostics: error.providerDiagnostics as LlmResponse["providerDiagnostics"] } : {})
  };
}

function classifyLlmErrorKind(errorMessage: string): string {
  if (errorMessage.includes("stale_started_call_after_process_interrupt")) {
    return "stale_started_call_after_process_interrupt";
  }
  if (errorMessage.includes("repair_invalid_agent_id")) {
    return "repair_invalid_agent_id";
  }
  if (errorMessage.includes("reasoning_exhausted_empty_content")) {
    return "reasoning_exhausted_empty_content";
  }
  if (errorMessage.includes("provider_empty_content")) {
    return "provider_empty_content";
  }
  if (errorMessage.includes("json_truncated")) {
    return "json_truncated";
  }
  if (errorMessage.includes("does not parse as JSON")) {
    return "json_parse_error";
  }
  if (errorMessage.includes("invalid_enum_value")) {
    return "schema_enum_alias";
  }
  if (errorMessage.includes("Required") || errorMessage.includes("required") || errorMessage.includes("is required")) {
    return "schema_required_fact";
  }
  if (errorMessage.includes("provider request failed") || errorMessage.includes("timed out")) {
    return "provider_error";
  }
  return "schema_validation";
}

function previewText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.length > 800 ? `${trimmed.slice(0, 800)}...` : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
