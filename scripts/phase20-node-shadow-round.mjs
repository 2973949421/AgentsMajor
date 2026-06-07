#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { runDust2NodeShadowExperimentAsync } from "../packages/core/dist/node-shadow-experiment.js";

const llmShadowEnabled = process.argv.includes("--llm-shadow");
const agentActionLlmShadowEnabled = process.argv.includes("--agent-action-llm-shadow");
const providerIndex = process.argv.indexOf("--provider");
const providerMode =
  providerIndex >= 0 && process.argv[providerIndex + 1] === "real"
    ? "real"
    : llmShadowEnabled
      ? "fixture"
      : "none";
const agentActionProviderIndex = process.argv.indexOf("--agent-action-provider");
const agentActionProviderMode =
  agentActionProviderIndex >= 0 && process.argv[agentActionProviderIndex + 1] === "real"
    ? "real"
    : agentActionLlmShadowEnabled
      ? "fixture"
      : "none";
const maxCallsIndex = process.argv.indexOf("--max-llm-calls");
const parsedMaxCalls =
  maxCallsIndex >= 0 && process.argv[maxCallsIndex + 1] ? Number.parseInt(process.argv[maxCallsIndex + 1], 10) : undefined;
const maxLlmCalls = Number.isFinite(parsedMaxCalls) && parsedMaxCalls > 0 ? parsedMaxCalls : 5;
const maxAgentActionCallsIndex = process.argv.indexOf("--max-agent-action-llm-calls");
const parsedMaxAgentActionCalls =
  maxAgentActionCallsIndex >= 0 && process.argv[maxAgentActionCallsIndex + 1]
    ? Number.parseInt(process.argv[maxAgentActionCallsIndex + 1], 10)
    : undefined;
const maxAgentActionLlmCalls = Number.isFinite(parsedMaxAgentActionCalls) && parsedMaxAgentActionCalls > 0 ? parsedMaxAgentActionCalls : 5;

const result = await runDust2NodeShadowExperimentAsync({
  llmShadow: llmShadowEnabled,
  providerMode: providerMode === "real" ? "real" : "fixture",
  maxLlmCalls,
  agentActionLlmShadow: agentActionLlmShadowEnabled,
  agentActionProviderMode: agentActionProviderMode === "real" ? "real" : "fixture",
  maxAgentActionLlmCalls,
  env: {
    ...process.env,
    ...readEnvLocal()
  }
});

console.log(
  JSON.stringify(
    {
      source: result.summary.source,
      status: result.summary.status,
      roundId: result.summary.roundId,
      phaseCount: result.summary.phaseCount,
      finalWinnerSide: result.summary.finalWinnerSide,
      finalWinnerTeamId: result.summary.finalWinnerTeamId,
      finalRoundWinType: result.summary.finalRoundWinType,
      finalBombState: result.summary.finalBombState,
      activeNodeCount: result.summary.activeNodeCount,
      endedEarly: result.summary.endedEarly,
      reportSource: result.report.source,
      callsLlm: result.report.audit.callsLlm,
      providerMode: result.summary.providerMode,
      modelId: result.summary.modelId,
      llmShadowEnabled: result.summary.llmShadowEnabled,
      llmCallsAttempted: result.summary.llmCallsAttempted,
      llmFallbackCount: result.summary.llmFallbackCount,
      fallbackReasons: result.summary.fallbackReasons,
      ignoredLlmFields: result.summary.ignoredLlmFields,
      draftValidCount: result.summary.draftValidCount,
      draftRejectedCount: result.summary.draftRejectedCount,
      contentLength: result.summary.contentLength,
      reasoningContentLength: result.summary.reasoningContentLength,
      jsonTruncated: result.summary.jsonTruncated,
      reasoningExhausted: result.summary.reasoningExhausted,
      agentActionLlmEnabled: result.summary.agentActionLlmEnabled,
      agentActionProviderMode: result.summary.agentActionProviderMode,
      agentActionModelId: result.summary.agentActionModelId,
      agentActionCallsAttempted: result.summary.agentActionCallsAttempted,
      agentActionFallbackCount: result.summary.agentActionFallbackCount,
      agentActionFallbackReasons: result.summary.agentActionFallbackReasons,
      agentActionIgnoredFields: result.summary.agentActionIgnoredFields,
      agentActionDraftAcceptedCount: result.summary.agentActionDraftAcceptedCount,
      agentActionDraftRejectedCount: result.summary.agentActionDraftRejectedCount,
      agentActionContentLength: result.summary.agentActionContentLength,
      agentActionReasoningContentLength: result.summary.agentActionReasoningContentLength,
      agentActionJsonTruncated: result.summary.agentActionJsonTruncated,
      agentActionReasoningExhausted: result.summary.agentActionReasoningExhausted,
      writesDb: result.report.audit.writesDb,
      replacesLegacyRoundPath: result.report.audit.replacesLegacyRoundPath
    },
    null,
    2
  )
);

function readEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) {
    return {};
  }
  const result = {};
  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    result[key] = stripOptionalQuotes(rawValue);
  }
  return result;
}

function stripOptionalQuotes(value) {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
