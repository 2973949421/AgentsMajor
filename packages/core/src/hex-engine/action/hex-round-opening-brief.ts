import type { HexAgentEconomyContext, HexRoundEconomyContext, HexResourceTier } from "../economy/index.js";
import type { HexRoundFinanceDuel } from "../finance/index.js";
import type { HexSide } from "../state/index.js";

export interface HexRoundOpeningBrief {
  schemaVersion: 1;
  source: "hex_round_opening_brief";
  roundNumber: number;
  topicTitle: string;
  defenseSummaryZh: string;
  attackSummaryZh: string;
  evidenceBoundaryZh: string;
  agentBriefs: HexAgentOpeningBrief[];
}

export interface HexAgentOpeningBrief {
  briefId: string;
  agentId: string;
  displayName: string;
  teamId: string;
  teamSide: HexSide;
  role: string;
  roundTaskZh: string;
  proofOrChallengeZh: string;
  evidenceBoundaryZh: string;
  buyConstraintZh: string;
  actionHintZh: string;
}

export interface BuildHexRoundOpeningBriefInput {
  financeDuel: HexRoundFinanceDuel;
  economyContext?: HexRoundEconomyContext | undefined;
  agents: Array<{
    agentId: string;
    teamId: string;
    side: HexSide;
    displayName?: string | undefined;
    role?: string | undefined;
  }>;
}

export function buildHexRoundOpeningBrief(input: BuildHexRoundOpeningBriefInput): HexRoundOpeningBrief {
  const evidenceBoundaryZh = buildEvidenceBoundary(input.financeDuel);
  return {
    schemaVersion: 1,
    source: "hex_round_opening_brief",
    roundNumber: input.financeDuel.roundNumber,
    topicTitle: input.financeDuel.topic.topicTitle,
    defenseSummaryZh: `守方自证：${input.financeDuel.defenseThesis.thesis}`,
    attackSummaryZh: `攻方质疑：${input.financeDuel.attackChallenge.thesis}`,
    evidenceBoundaryZh,
    agentBriefs: input.agents.map((agent) => buildHexAgentOpeningBrief({
      financeDuel: input.financeDuel,
      evidenceBoundaryZh,
      agent,
      economy: input.economyContext?.agents.find((candidate) => candidate.agentId === agent.agentId)
    }))
  };
}

export function buildHexAgentOpeningBrief(input: {
  financeDuel: HexRoundFinanceDuel;
  evidenceBoundaryZh?: string | undefined;
  agent: {
    agentId: string;
    teamId: string;
    side: HexSide;
    displayName?: string | undefined;
    role?: string | undefined;
  };
  economy?: HexAgentEconomyContext | undefined;
}): HexAgentOpeningBrief {
  const assignment = input.financeDuel.agentAssignments.find((candidate) => candidate.agentId === input.agent.agentId);
  const side = assignment?.side ?? input.agent.side;
  const proofOrChallengeZh = side === "defense"
    ? input.financeDuel.defenseThesis.thesis
    : input.financeDuel.attackChallenge.thesis;
  const evidenceBoundaryZh = input.evidenceBoundaryZh ?? buildEvidenceBoundary(input.financeDuel);
  const roundTaskZh = assignment?.financeTask
    ?? (side === "defense" ? input.financeDuel.topic.defenseThesisFocus : input.financeDuel.topic.attackChallengeFocus);
  const role = input.agent.role ?? assignment?.role ?? "role unknown";
  const economy = input.economy;
  const resourceTier = economy?.resourceTier;
  return {
    briefId: `opening_${input.financeDuel.roundNumber}_${input.agent.agentId}`,
    agentId: input.agent.agentId,
    displayName: input.agent.displayName ?? input.agent.agentId,
    teamId: input.agent.teamId,
    teamSide: side,
    role,
    roundTaskZh,
    proofOrChallengeZh,
    evidenceBoundaryZh,
    buyConstraintZh: buildBuyConstraintZh(economy),
    actionHintZh: buildActionHintZh({
      side,
      resourceTier,
      carryingMainClaim: assignment?.linkedThesisId !== undefined || assignment?.linkedChallengeId !== undefined
    })
  };
}

function buildEvidenceBoundary(financeDuel: HexRoundFinanceDuel): string {
  const missing = financeDuel.evidence.missingEvidence.length > 0
    ? `缺失证据：${financeDuel.evidence.missingEvidence.slice(0, 4).join("、")}。`
    : "缺失证据：当前未记录。";
  const caps = financeDuel.evidence.scoreCaps.length > 0
    ? `评分上限：${financeDuel.evidence.scoreCaps.slice(0, 3).map((cap) => `${cap.condition} 最高 ${cap.maxScore}`).join("；")}。`
    : "评分上限：当前未记录。";
  return `${financeDuel.defenseThesis.riskBoundary} ${missing}${caps}`.trim();
}

function buildBuyConstraintZh(economy: HexAgentEconomyContext | undefined): string {
  if (!economy) {
    return "经济约束未记录；按保守行动处理。";
  }
  const base = `买型 ${economy.buyType}，资源 ${economy.resourceTier}，道具 ${economy.utilityTier}，本局花费 ${economy.spend}。`;
  switch (economy.resourceTier) {
    case "high":
      return `${base} 可以承担主攻或主防论证，但仍必须承认证据边界。`;
    case "medium":
      return `${base} 可以做关键配合和局部论证，不应声称已经完成全局证明。`;
    case "forced":
      return `${base} 只适合有限执行和风险暴露，避免宣称强结论。`;
    case "low":
      return `${base} 只适合窄问题试探、信息收集或保守挑战。`;
    default:
      return base;
  }
}

function buildActionHintZh(input: {
  side: HexSide;
  resourceTier?: HexResourceTier | undefined;
  carryingMainClaim: boolean;
}): string {
  const sideHint = input.side === "defense"
    ? "局内行动应保护自证链条，优先守住关键位置、回应质疑或延缓攻方验证。"
    : "局内行动应服务质疑链条，优先取得信息、压迫关键点或验证守方风险边界。";
  if (input.resourceTier === "low") {
    return `${sideHint} 当前资源偏低，行动理由应短、窄、可回撤。`;
  }
  if (input.resourceTier === "forced") {
    return `${sideHint} 当前资源有限，允许冒险但必须说明暴露了哪个证据缺口。`;
  }
  if (input.carryingMainClaim) {
    return `${sideHint} 该选手承载本局核心任务，行动理由应引用本信息卡，不要重写整段金融论点。`;
  }
  return `${sideHint} 行动理由应引用本信息卡，不要重新生成完整金融主张。`;
}
