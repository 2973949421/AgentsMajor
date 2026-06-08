import type { AgentActionDecision } from "@agent-major/shared";

export function normalizeAgentActionDecision(decision: AgentActionDecision): AgentActionDecision {
  return {
    ...decision,
    roundObjective: normalizeChineseFirstTacticalText(decision.roundObjective),
    executionPlan: normalizeChineseFirstTacticalText(decision.executionPlan),
    coordinationPlan: normalizeChineseFirstTacticalText(decision.coordinationPlan),
    roleResponsibilityUsage: normalizeChineseFirstTacticalText(decision.roleResponsibilityUsage),
    riskRead: normalizeChineseFirstTacticalText(decision.riskRead),
    contingencyPlan: normalizeChineseFirstTacticalText(decision.contingencyPlan),
    expectedContribution: normalizeChineseFirstTacticalText(decision.expectedContribution)
  };
}

function normalizeChineseFirstTacticalText(value: string): string {
  let output = value.trim();
  const replacements: Array<{ source: string; target: string }> = [
    { source: "with controlled aggression", target: "以可控侵略性" },
    { source: "controlled aggression", target: "可控侵略性" },
    { source: "primary task", target: "首要任务" },
    { source: "do not overcommit", target: "不要过度投入" },
    { source: "overcommit", target: "过度投入" },
    { source: "immediately", target: "立即" },
    { source: "toward", target: "朝向" },
    { source: "probe", target: "试探" },
    { source: "rotation", target: "轮转" },
    { source: "rotations", target: "轮转" },
    { source: "window control", target: "窗口控制" },
    { source: "window", target: "窗口" },
    { source: "spawn", target: "出生点" },
    { source: "crossfire", target: "交叉火力" },
    { source: "sightlines", target: "枪线" },
    { source: "sightline", target: "枪线" },
    { source: "flank", target: "侧翼" },
    { source: "closeout", target: "收束" }
  ];
  for (const replacement of replacements) {
    output = output.replace(buildLiteralPattern(replacement.source), replacement.target);
  }
  return output.replace(/\s{2,}/g, " ").trim();
}

function buildLiteralPattern(value: string): RegExp {
  const escaped = escapeRegExp(value);
  return /^[A-Za-z0-9_]+$/.test(value) ? new RegExp(`\\b${escaped}\\b`, "gi") : new RegExp(escaped, "gi");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
