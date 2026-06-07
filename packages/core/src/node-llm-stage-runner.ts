import type { AgentPhaseAction, LocalNodeVerdict, MapNodeGraph, RoundNodeStateSnapshot } from "@agent-major/shared";
import {
  DashScopeOpenAiProvider,
  loadAgentMajorLlmConfig,
  type LlmProviderDiagnostics,
  type LlmUsage
} from "@agent-major/llm";

import { buildLocalNodeVerdicts } from "./local-node-judge-pipeline.js";
import {
  buildNodeLlmJudgeRequest,
  normalizeLocalNodeJudgeDrafts,
  type LocalNodeJudgeDraft,
  type NodeLlmJudgeRequest
} from "./node-llm-boundary.js";
import type { NodeRoundEconomyResources } from "./economy-resource-adapter.js";

export type NodeLlmProviderMode = "none" | "fixture" | "real";

export interface NodeLlmDraftProviderResult {
  rawDrafts: unknown;
  providerMode?: NodeLlmProviderMode;
  modelId?: string;
  rawText?: string;
  usage?: LlmUsage;
  providerDiagnostics?: LlmProviderDiagnostics;
}

export type NodeLlmDraftProvider = (request: NodeLlmJudgeRequest) => Promise<unknown | NodeLlmDraftProviderResult> | unknown | NodeLlmDraftProviderResult;

export interface RunNodeLlmShadowStageInput {
  graph: MapNodeGraph;
  phaseSnapshot: RoundNodeStateSnapshot;
  agentActions: AgentPhaseAction[];
  economyResources?: NodeRoundEconomyResources;
  provider: NodeLlmDraftProvider;
  maxLlmCallsRemaining: number;
  providerMode?: NodeLlmProviderMode;
  modelId?: string;
}

export interface NodeLlmShadowStageAudit {
  enabled: true;
  providerMode: NodeLlmProviderMode;
  modelId?: string;
  callsAttempted: number;
  fallbackCount: number;
  fallbackReasons: string[];
  ignoredFields: string[];
  draftValidCount: number;
  draftRejectedCount: number;
  contentLength?: number;
  reasoningContentLength?: number;
  jsonTruncated: boolean;
  reasoningExhausted: boolean;
}

export interface NodeLlmShadowStageResult {
  localVerdicts: LocalNodeVerdict[];
  deterministicVerdicts: LocalNodeVerdict[];
  audit: NodeLlmShadowStageAudit;
}

export async function runNodeLlmShadowStage(input: RunNodeLlmShadowStageInput): Promise<NodeLlmShadowStageResult> {
  const deterministicVerdicts = buildLocalNodeVerdicts({
    graph: input.graph,
    phaseSnapshot: input.phaseSnapshot,
    agentActions: input.agentActions
  });

  if (input.maxLlmCallsRemaining <= 0) {
    return fallback(deterministicVerdicts, ["max_llm_calls_reached"], 0, [], {
      providerMode: input.providerMode ?? "fixture",
      ...(input.modelId ? { modelId: input.modelId } : {})
    });
  }

  const request = buildNodeLlmJudgeRequest({
    graph: input.graph,
    phaseSnapshot: input.phaseSnapshot,
    agentActions: input.agentActions,
    ...(input.economyResources ? { economyResources: input.economyResources } : {})
  });

  try {
    const providerResult = normalizeProviderResult(await input.provider(request));
    const rawDrafts = providerResult.rawDrafts;
    const normalized = normalizeLocalNodeJudgeDrafts({
      rawDrafts,
      graph: input.graph,
      phaseId: input.phaseSnapshot.phaseId,
      allowedNodeIds: request.allowedNodeIds
    });

    if (normalized.errors.length > 0) {
      return fallback(deterministicVerdicts, normalized.errors, 1, normalized.ignoredFields, {
        providerMode: providerResult.providerMode ?? input.providerMode ?? "fixture",
        ...(providerResult.modelId ?? input.modelId ? { modelId: providerResult.modelId ?? input.modelId } : {}),
        ...(providerResult.providerDiagnostics ? { providerDiagnostics: providerResult.providerDiagnostics } : {}),
        ...(providerResult.rawText !== undefined ? { rawText: providerResult.rawText } : {}),
        draftRejectedCount: normalized.errors.length
      });
    }

    const verdicts = buildLocalNodeVerdicts({
      graph: input.graph,
      phaseSnapshot: input.phaseSnapshot,
      agentActions: input.agentActions,
      mode: "llm_shadow",
      llmDrafts: normalized.drafts
    });

    return {
      localVerdicts: verdicts,
      deterministicVerdicts,
      audit: {
        enabled: true,
        providerMode: providerResult.providerMode ?? input.providerMode ?? "fixture",
        ...(providerResult.modelId ?? input.modelId ? { modelId: providerResult.modelId ?? input.modelId } : {}),
        callsAttempted: 1,
        fallbackCount: 0,
        fallbackReasons: [],
        ignoredFields: normalized.ignoredFields,
        draftValidCount: normalized.drafts.length,
        draftRejectedCount: 0,
        ...(providerResult.providerDiagnostics?.contentLength !== undefined
          ? { contentLength: providerResult.providerDiagnostics.contentLength }
          : providerResult.rawText !== undefined
            ? { contentLength: providerResult.rawText.length }
            : {}),
        ...(providerResult.providerDiagnostics?.reasoningContentLength !== undefined
          ? { reasoningContentLength: providerResult.providerDiagnostics.reasoningContentLength }
          : {}),
        jsonTruncated: providerFailureHasKind("", "json_truncated"),
        reasoningExhausted: providerFailureHasKind("", "reasoning_exhausted")
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fallback(deterministicVerdicts, [`provider_error:${message}`], 1, [], {
      providerMode: input.providerMode ?? "fixture",
      ...(input.modelId ? { modelId: input.modelId } : {}),
      ...(error instanceof Error ? {} : { rawText: String(error) }),
      draftRejectedCount: 1,
      jsonTruncated: providerFailureHasKind(message, "json_truncated"),
      reasoningExhausted: providerFailureHasKind(message, "reasoning_exhausted")
    });
  }
}

export function createFixtureNodeLlmDraftProvider(): NodeLlmDraftProvider {
  return (request) =>
    ({
      providerMode: "fixture",
      modelId: "fixture_node_llm",
      rawDrafts: request.nodes.map(
        (node): LocalNodeJudgeDraft => ({
          nodeId: node.nodeId,
          phaseId: request.phaseId,
          summary: `fixture LLM shadow: ${node.nodeId} 在 ${request.phaseId} 的商业碰撞被局部解释。`,
          controlAfterCandidate: node.controlBefore,
          businessPlanValidated: [`fixture validated:${node.nodeId}`],
          businessPlanBroken: [],
          riskNotes: [`fixture risk:${node.nodeId}`],
          confidence: 0.7
        })
      )
    });
}

export interface EnvNodeLlmDraftProviderFactoryResult {
  provider: NodeLlmDraftProvider;
  providerMode: "real";
  modelId: string;
}

export function createEnvNodeLlmDraftProvider(
  env: Record<string, string | undefined> = process.env
): EnvNodeLlmDraftProviderFactoryResult {
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
      const response = await gateway.generateStructured<Record<string, unknown>, NodeLlmJudgeRequest>({
        task: "judge_review",
        driverModelId: modelId,
        input: request,
        schemaName: "LocalNodeJudgeDraftBundle",
        responseFormat: "json_object",
        modelTier: "standard",
        temperature: 0.2,
        maxOutputTokens: 900,
        messages: buildRealNodeJudgeMessages(request)
      });
      return {
        providerMode: "real",
        modelId: config.modelName ?? modelId,
        rawDrafts: Array.isArray(response.data.drafts) ? response.data.drafts : response.data,
        ...(response.rawText !== undefined ? { rawText: response.rawText } : {}),
        usage: response.usage,
        ...(response.providerDiagnostics ? { providerDiagnostics: response.providerDiagnostics } : {})
      };
    }
  };
}

function fallback(
  deterministicVerdicts: LocalNodeVerdict[],
  fallbackReasons: string[],
  callsAttempted: number,
  ignoredFields: string[] = [],
  metadata: {
    providerMode?: NodeLlmProviderMode;
    modelId?: string;
    rawText?: string;
    providerDiagnostics?: LlmProviderDiagnostics;
    draftRejectedCount?: number;
    jsonTruncated?: boolean;
    reasoningExhausted?: boolean;
  } = {}
): NodeLlmShadowStageResult {
  return {
    localVerdicts: deterministicVerdicts,
    deterministicVerdicts,
    audit: {
      enabled: true,
      providerMode: metadata.providerMode ?? "fixture",
      ...(metadata.modelId ? { modelId: metadata.modelId } : {}),
      callsAttempted,
      fallbackCount: 1,
      fallbackReasons,
      ignoredFields,
      draftValidCount: 0,
      draftRejectedCount: metadata.draftRejectedCount ?? fallbackReasons.length,
      ...(metadata.providerDiagnostics?.contentLength !== undefined
        ? { contentLength: metadata.providerDiagnostics.contentLength }
        : metadata.rawText !== undefined
          ? { contentLength: metadata.rawText.length }
          : {}),
      ...(metadata.providerDiagnostics?.reasoningContentLength !== undefined
        ? { reasoningContentLength: metadata.providerDiagnostics.reasoningContentLength }
        : {}),
      jsonTruncated: metadata.jsonTruncated ?? fallbackReasons.some((reason) => providerFailureHasKind(reason, "json_truncated")),
      reasoningExhausted:
        metadata.reasoningExhausted ?? fallbackReasons.some((reason) => providerFailureHasKind(reason, "reasoning_exhausted"))
    }
  };
}

function normalizeProviderResult(value: unknown | NodeLlmDraftProviderResult): NodeLlmDraftProviderResult {
  if (isRecord(value) && "rawDrafts" in value) {
    return value as unknown as NodeLlmDraftProviderResult;
  }
  return {
    rawDrafts: value
  };
}

function buildRealNodeJudgeMessages(request: NodeLlmJudgeRequest): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content:
        "你是节点化 CS x 商业计划对抗的局部裁判。只输出一个 JSON object，形状为 {\"drafts\":[...]}。不得输出 final winner、roundWinType、kill ledger、DB fact、经济参数修改、未知 nodeId。"
    },
    {
      role: "user",
      content: JSON.stringify({
        outputShape: {
          drafts: [
            {
              nodeId: "<allowedNodeIds 中的节点>",
              phaseId: request.phaseId,
              summary: "<一句中文局部裁判解释>",
              controlAfterCandidate: "attack|defense|contested|neutral",
              businessPlanValidated: ["<可选，商业计划被验证点>"],
              businessPlanBroken: ["<可选，商业计划被击穿点>"],
              riskNotes: ["<可选，风险说明>"],
              confidence: 0.5
            }
          ]
        },
        request
      })
    }
  ];
}

function providerFailureHasKind(message: string, kind: "json_truncated" | "reasoning_exhausted"): boolean {
  return message.toLowerCase().includes(kind);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
