import {
  DashScopeOpenAiProvider,
  loadAgentMajorLlmConfig,
  type LlmProviderDiagnostics,
  type LlmUsage
} from "@agent-major/llm";
import type { AgentPhaseAction, MapNodeGraph, RoundNodeStateSnapshot } from "@agent-major/shared";

import type { NodeRoundEconomyResources } from "./economy-resource-adapter.js";
import {
  applyNodeAgentActionDrafts,
  buildNodeAgentActionRequest,
  normalizeNodeAgentActionDrafts,
  type NodeAgentActionDraft,
  type NodeAgentActionRequest
} from "./node-agent-action-boundary.js";

export type NodeAgentActionProviderMode = "none" | "fixture" | "real";

export interface NodeAgentActionDraftProviderResult {
  rawDrafts: unknown;
  providerMode?: NodeAgentActionProviderMode;
  modelId?: string;
  rawText?: string;
  usage?: LlmUsage;
  providerDiagnostics?: LlmProviderDiagnostics;
}

export type NodeAgentActionDraftProvider =
  | ((request: NodeAgentActionRequest) => Promise<unknown | NodeAgentActionDraftProviderResult> | unknown | NodeAgentActionDraftProviderResult);

export interface RunNodeAgentActionShadowStageInput {
  graph: MapNodeGraph;
  phaseSnapshot: RoundNodeStateSnapshot;
  economyResources: NodeRoundEconomyResources;
  deterministicActions: AgentPhaseAction[];
  provider: NodeAgentActionDraftProvider;
  maxLlmCallsRemaining: number;
  providerMode?: NodeAgentActionProviderMode;
  modelId?: string;
}

export interface NodeAgentActionLlmStageAudit {
  enabled: true;
  providerMode: NodeAgentActionProviderMode;
  modelId?: string;
  callsAttempted: number;
  fallbackCount: number;
  fallbackReasons: string[];
  ignoredFields: string[];
  draftAcceptedCount: number;
  draftRejectedCount: number;
  contentLength?: number;
  reasoningContentLength?: number;
  jsonTruncated: boolean;
  reasoningExhausted: boolean;
}

export interface NodeAgentActionShadowStageResult {
  agentActions: AgentPhaseAction[];
  deterministicActions: AgentPhaseAction[];
  audit: NodeAgentActionLlmStageAudit;
}

export async function runNodeAgentActionShadowStage(input: RunNodeAgentActionShadowStageInput): Promise<NodeAgentActionShadowStageResult> {
  if (input.maxLlmCallsRemaining <= 0) {
    return fallback(input.deterministicActions, ["max_agent_action_llm_calls_reached"], 0, [], {
      providerMode: input.providerMode ?? "fixture",
      ...(input.modelId ? { modelId: input.modelId } : {})
    });
  }

  const request = buildNodeAgentActionRequest({
    graph: input.graph,
    phaseSnapshot: input.phaseSnapshot,
    economyResources: input.economyResources,
    baselineActions: input.deterministicActions
  });

  try {
    const providerResult = normalizeProviderResult(await input.provider(request));
    const normalized = normalizeNodeAgentActionDrafts({
      rawDrafts: providerResult.rawDrafts,
      request
    });
    const agentActions = applyNodeAgentActionDrafts({
      baselineActions: input.deterministicActions,
      drafts: normalized.drafts
    });

    return {
      agentActions,
      deterministicActions: input.deterministicActions,
      audit: {
        enabled: true,
        providerMode: providerResult.providerMode ?? input.providerMode ?? "fixture",
        ...(providerResult.modelId ?? input.modelId ? { modelId: providerResult.modelId ?? input.modelId } : {}),
        callsAttempted: 1,
        fallbackCount: normalized.errors.length,
        fallbackReasons: normalized.errors,
        ignoredFields: normalized.ignoredFields,
        draftAcceptedCount: normalized.drafts.length,
        draftRejectedCount: normalized.errors.length,
        ...(providerResult.providerDiagnostics?.contentLength !== undefined
          ? { contentLength: providerResult.providerDiagnostics.contentLength }
          : providerResult.rawText !== undefined
            ? { contentLength: providerResult.rawText.length }
            : {}),
        ...(providerResult.providerDiagnostics?.reasoningContentLength !== undefined
          ? { reasoningContentLength: providerResult.providerDiagnostics.reasoningContentLength }
          : {}),
        jsonTruncated: normalized.errors.some((reason) => providerFailureHasKind(reason, "json_truncated")),
        reasoningExhausted: normalized.errors.some((reason) => providerFailureHasKind(reason, "reasoning_exhausted"))
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fallback(input.deterministicActions, [`provider_error:${message}`], 1, [], {
      providerMode: input.providerMode ?? "fixture",
      ...(input.modelId ? { modelId: input.modelId } : {}),
      draftRejectedCount: input.deterministicActions.length,
      jsonTruncated: providerFailureHasKind(message, "json_truncated"),
      reasoningExhausted: providerFailureHasKind(message, "reasoning_exhausted")
    });
  }
}

export function createFixtureNodeAgentActionDraftProvider(): NodeAgentActionDraftProvider {
  return (request) => ({
    providerMode: "fixture",
    modelId: "fixture_node_agent_action",
    rawDrafts: request.agents.map(
      (agent): NodeAgentActionDraft => ({
        agentId: agent.agentId,
        phaseId: request.phaseId,
        currentNodeId: agent.currentNodeId,
        targetNodeId: agent.baselineTargetNodeId,
        actionType: agent.baselineActionType,
        apCost: Math.min(agent.baseAp, agent.baselineActionType === "hold_position" ? 0 : 1),
        businessIntent: `${agent.teamId} 的 ${agent.agentId} 通过 fixture LLM action 继续验证 ${agent.baselineTargetNodeId} 的商业计划执行质量。`,
        tacticalIntent: `fixture action keeps ${agent.baselineActionType}`,
        riskNotes: [`fixture risk:${agent.economyPosture}:${agent.riskProfile}`],
        confidence: 0.72
      })
    )
  });
}

export interface EnvNodeAgentActionDraftProviderFactoryResult {
  provider: NodeAgentActionDraftProvider;
  providerMode: "real";
  modelId: string;
}

export function createEnvNodeAgentActionDraftProvider(
  env: Record<string, string | undefined> = process.env
): EnvNodeAgentActionDraftProviderFactoryResult {
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
      const response = await gateway.generateStructured<Record<string, unknown>, NodeAgentActionRequest>({
        task: "agent_action",
        driverModelId: modelId,
        input: request,
        schemaName: "NodeAgentPhaseActionDraftBundle",
        responseFormat: "json_object",
        modelTier: "standard",
        temperature: 0.35,
        maxOutputTokens: 1200,
        extraParams: { thinking: { type: "disabled" } },
        messages: buildRealNodeAgentActionMessages(request)
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
  deterministicActions: AgentPhaseAction[],
  fallbackReasons: string[],
  callsAttempted: number,
  ignoredFields: string[] = [],
  metadata: {
    providerMode?: NodeAgentActionProviderMode;
    modelId?: string;
    rawText?: string;
    providerDiagnostics?: LlmProviderDiagnostics;
    draftRejectedCount?: number;
    jsonTruncated?: boolean;
    reasoningExhausted?: boolean;
  } = {}
): NodeAgentActionShadowStageResult {
  return {
    agentActions: deterministicActions,
    deterministicActions,
    audit: {
      enabled: true,
      providerMode: metadata.providerMode ?? "fixture",
      ...(metadata.modelId ? { modelId: metadata.modelId } : {}),
      callsAttempted,
      fallbackCount: fallbackReasons.length > 0 ? 1 : 0,
      fallbackReasons,
      ignoredFields,
      draftAcceptedCount: 0,
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

function normalizeProviderResult(value: unknown | NodeAgentActionDraftProviderResult): NodeAgentActionDraftProviderResult {
  if (isRecord(value) && "rawDrafts" in value) {
    return value as unknown as NodeAgentActionDraftProviderResult;
  }
  return {
    rawDrafts: value
  };
}

function buildRealNodeAgentActionMessages(request: NodeAgentActionRequest): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content:
        "你是节点化 CS x 商业计划对抗的阶段行动编排助手。只输出 JSON object，形状为 {\"drafts\":[...]}。不得输出 final winner、roundWinType、kill ledger、DB fact、经济参数修改、未知 nodeId。"
    },
    {
      role: "user",
      content: JSON.stringify({
        outputShape: {
          drafts: [
            {
              agentId: "<agents 中的 agentId>",
              phaseId: request.phaseId,
              currentNodeId: "<当前节点，可省略>",
              targetNodeId: "<该 agent allowedTargetNodeIds 中的节点>",
              actionType: "<该 agent allowedActionTypes 中的行动>",
              apCost: 1,
              businessIntent: "<一句中文，必须说明 CS 行动如何验证商业计划/分工>",
              tacticalIntent: "<可选，短战术意图>",
              riskNotes: ["<可选，短风险说明>"],
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
