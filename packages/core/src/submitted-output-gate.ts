import type { AgentActionDecision, AgentOutput, BuyType, EconomyPosture, LoadoutPackage, SubmittedAgentOutput } from "@agent-major/shared";

import type { AgentBuyDecision } from "./economy-rules.js";
import {
  buyTypeToEconomyPosture,
  formatBuyType,
  formatEconomyPosture,
  outputBudgetForBuyType,
  outputGateTierForEconomyPosture
} from "./economy-rules.js";

export function buildSubmittedAgentOutputs(input: {
  agentOutputs: AgentOutput[];
  buyDecisionByAgent: Map<string, AgentBuyDecision>;
}): SubmittedAgentOutput[] {
  return input.agentOutputs.map((output) => {
    const buyDecision = input.buyDecisionByAgent.get(output.agentId);
    const buyType = buyDecision?.buyType ?? "eco";
    const economyPosture = buyDecision?.economyPosture;
    const loadoutPackage = buyDecision?.loadoutPackage;
    const outputBudget = buyDecision?.outputBudget ?? outputBudgetForBuyType(buyType);
    return buildSubmittedAgentOutput(output, buyType, outputBudget, economyPosture, loadoutPackage);
  });
}

function buildSubmittedAgentOutput(
  output: AgentOutput,
  buyType: BuyType,
  outputBudget: number,
  economyPosture?: EconomyPosture,
  loadoutPackage?: LoadoutPackage
): SubmittedAgentOutput {
  const rawDetail = output.actionDetail;
  const budgetTier = outputGateTierForEconomyPosture(economyPosture ?? buyTypeToEconomyPosture(buyType));
  const omittedFields: string[] = [];
  const postureLabel = economyPosture ? formatEconomyPosture(economyPosture) : formatBuyType(buyType);
  const gateSummary = `Output Gate 已按${postureLabel}提交，预算 ${outputBudget}，Judge 只能消费 SubmittedOutput，不能读取被裁剪 RawOutput。`;
  const submittedDetail: AgentActionDecision | undefined = rawDetail
    ? {
        roundObjective: gateActionText(rawDetail.roundObjective, budgetTier),
        executionPlan: gateActionText(rawDetail.executionPlan, budgetTier),
        coordinationPlan: gateActionText(rawDetail.coordinationPlan, budgetTier),
        roleResponsibilityUsage: gateActionText(rawDetail.roleResponsibilityUsage, budgetTier),
        riskRead:
          budgetTier >= 2
            ? gateActionText(rawDetail.riskRead, budgetTier)
            : recordOmittedField("riskRead", omittedFields, "经济预算不足：风险判断被压缩，Judge 只能看到核心执行意图。"),
        contingencyPlan:
          budgetTier >= 3
            ? gateActionText(rawDetail.contingencyPlan, budgetTier)
            : recordOmittedField("contingencyPlan", omittedFields, "经济预算不足：备选方案被裁剪，Judge 不能把 RawOutput 中的完整备选路径当作证据。"),
        expectedContribution:
          budgetTier >= 2
            ? gateActionText(rawDetail.expectedContribution, budgetTier)
            : recordOmittedField("expectedContribution", omittedFields, "经济预算不足：预期贡献被压缩为核心目标和执行计划。"),
        confidence: output.confidence,
        ...(rawDetail.fingerprint ? { fingerprint: rawDetail.fingerprint } : {})
      }
    : undefined;

  return {
    ...output,
    id: `sub_${output.id}`,
    rawOutputId: output.id,
    submissionKind: "submitted_output",
    buyType,
    ...(economyPosture ? { economyPosture } : {}),
    ...(loadoutPackage ? { loadoutPackage } : {}),
    outputBudget,
    ...(submittedDetail ? { actionDetail: submittedDetail } : {}),
    ...(output.action ? { action: gateActionText(output.action, budgetTier) } : {}),
    omittedFields,
    gateSummary,
    rawFingerprint: `submitted_${output.rawFingerprint}`
  };
}

function gateActionText(value: string, budgetTier: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  const maxChars = budgetTier >= 4 ? 420 : budgetTier === 3 ? 300 : budgetTier === 2 ? 220 : budgetTier === 1 ? 160 : 120;
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}...`;
}

function recordOmittedField(field: string, omittedFields: string[], replacement: string): string {
  omittedFields.push(field);
  return replacement;
}
