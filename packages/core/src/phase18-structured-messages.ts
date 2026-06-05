import type { LlmMessage } from "@agent-major/llm";

import {
  buildPhase20PreStructuredMessages,
  type Phase20PrePromptTask
} from "./phase20-pre-prompt-contract.js";

export function buildPhase18StructuredMessages(input: {
  task: Phase20PrePromptTask;
  schemaName: string;
  requestInput: unknown;
}): LlmMessage[] {
  const contextSummary = buildPhase18PromptContextSummary(input.requestInput);
  return buildPhase20PreStructuredMessages({
    task: input.task,
    schemaName: input.schemaName,
    requestInput: input.requestInput,
    contextSummary
  });
}

function buildPhase18PromptContextSummary(requestInput: unknown): string {
  const record = readUnknownRecord(requestInput);
  if (!record) {
    return "上下文摘要：不可用。";
  }

  const roundNumber = typeof record.roundNumber === "number" ? record.roundNumber : undefined;
  const mapName = typeof record.mapName === "string" ? record.mapName : undefined;
  const mapSemantic = readUnknownRecord(record.mapSemanticContext);
  const proposition = readUnknownRecord(mapSemantic?.proposition);
  const judgeRubric = readUnknownRecord(record.judgeRubricContext) ?? readUnknownRecord(mapSemantic?.judgeRubric);
  const defenderThesisContext = readUnknownRecord(record.defenderThesisContext);
  const initialProposal = readUnknownRecord(record.initialProposal);
  const proposalAnchor = readUnknownRecord(record.proposalAnchor);
  const coachContext = readUnknownRecord(record.coachContext);
  const teamMemoryOverlay = readUnknownRecord(record.teamMemoryOverlay);
  const teamPlan = readUnknownRecord(record.teamPlan);
  const coachCorrection = readUnknownRecord(record.coachCorrection);
  const coachAdjustment = readUnknownRecord(record.coachAdjustment);
  const playerDirective = readUnknownRecord(record.playerDirective);
  const evaluationOrder = Array.isArray(record.evaluationOrder)
    ? record.evaluationOrder
        .map((entry) => readUnknownRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];

  const lines = [
    `地图：${mapName ?? "unknown"}`,
    ...(roundNumber ? [`回合：${roundNumber}`] : []),
    ...(proposition
      ? [
          `地图主题：${pickString(proposition, "mapTheme") ?? "unknown"}`,
          `核心问题：${pickString(proposition, "coreQuestion") ?? "unknown"}`,
          ...(() => {
            const subTheme = resolvePhase18SubTheme(proposition, roundNumber);
            return subTheme ? [`当前子命题：${subTheme}`] : [];
          })(),
          ...(() => {
            const displayZoneNames = readUnknownRecord(proposition.displayZoneNames);
            if (!displayZoneNames) {
              return [];
            }

            const zonePairs = Object.entries(displayZoneNames)
              .filter(([, value]) => typeof value === "string")
              .map(([zoneId, value]) => `${zoneId}=${value}`)
              .slice(0, 8);
            return zonePairs.length > 0 ? [`区域别名：${zonePairs.join("；")}`] : [];
          })(),
          ...(() => {
            const attackFocus = pickStringArray(proposition, "attackFocus");
            return attackFocus.length > 0 ? [`进攻焦点：${attackFocus.join(" / ")}`] : [];
          })(),
          ...(() => {
            const defenseFocus = pickStringArray(proposition, "defenseFocus");
            return defenseFocus.length > 0 ? [`防守焦点：${defenseFocus.join(" / ")}`] : [];
          })()
        ]
      : []),
    ...(judgeRubric
      ? [
          `裁判轴：${pickString(judgeRubric, "coreJudgmentAxis") ?? "unknown"}`,
          ...(() => {
            const reasonMustCover = pickStringArray(judgeRubric, "reasonMustCover");
            return reasonMustCover.length > 0 ? [`判词必须覆盖：${reasonMustCover.join(" / ")}`] : [];
          })(),
          ...(() => {
            const biasGuardrails = pickStringArray(judgeRubric, "biasGuardrails");
            return biasGuardrails.length > 0 ? [`反偏置约束：${biasGuardrails.join(" / ")}`] : [];
          })()
        ]
      : []),
    ...(defenderThesisContext
      ? [
          `半场守方主命题：${pickString(defenderThesisContext, "defenderTeamThesis") ?? "unknown"}`,
          `攻方挑战任务：${pickString(defenderThesisContext, "attackerChallengeBrief") ?? "unknown"}`,
          ...(() => {
            const mustHoldClaims = pickStringArray(defenderThesisContext, "defenderMustHoldClaims");
            return mustHoldClaims.length > 0 ? [`守方必须守住：${mustHoldClaims.join(" / ")}`] : [];
          })()
        ]
      : []),
    ...(initialProposal
      ? [
          `队伍唯一方案：${pickString(initialProposal, "teamThesis") ?? "unknown"}`,
          ...(() => {
            const mustHoldClaims = pickStringArray(initialProposal, "mustHoldClaims");
            return mustHoldClaims.length > 0 ? [`必须守住：${mustHoldClaims.join(" / ")}`] : [];
          })(),
          ...(() => {
            const failureModes = pickStringArray(initialProposal, "failureModes");
            return failureModes.length > 0 ? [`已知失败模式：${failureModes.join(" / ")}`] : [];
          })(),
          ...(() => {
            const frontendSummary = pickString(initialProposal, "frontendSummary");
            return frontendSummary ? [`方案摘要：${frontendSummary}`] : [];
          })()
        ]
      : []),
    ...(coachContext
      ? [
          `教练窗口：${pickString(coachContext, "displayName") ?? "unknown"} | ${
            pickString(coachContext, "dutySummary") ?? "no duty summary"
          }`
        ]
      : []),
    ...(proposalAnchor
      ? [
          `选手方案锚点：${pickString(proposalAnchor, "teamThesis") ?? "unknown"}`,
          ...(() => {
            const playerOperatingPrinciples = pickStringArray(proposalAnchor, "playerOperatingPrinciples");
            return playerOperatingPrinciples.length > 0 ? [`选手执行原则：${playerOperatingPrinciples.join(" / ")}`] : [];
          })()
        ]
      : []),
    ...(teamMemoryOverlay
      ? [
          `已采纳长期补丁：${pickString(teamMemoryOverlay, "proposedStrategyPatch") ?? pickString(teamMemoryOverlay, "timeoutQualityReview") ?? "已存在"}`
        ]
      : []),
    ...evaluationOrder.flatMap((entry) => {
      const initialProposalSummary = readUnknownRecord(entry.initialProposalSummary);
      const summarizedPlan = readUnknownRecord(entry.teamPlan);
      const teamName = pickString(entry, "teamName") ?? pickString(entry, "teamId") ?? "unknown";
      const nextLines = [`裁判待评队伍：${teamName}`];
      if (initialProposalSummary) {
        nextLines.push(`方案主张：${pickString(initialProposalSummary, "teamThesis") ?? "unknown"}`);
      }
      if (summarizedPlan) {
        nextLines.push(`当前意图：${pickString(summarizedPlan, "primaryIntent") ?? "unknown"}`);
      }
      return nextLines;
    }),
    ...(teamPlan
      ? [
          `队伍意图：${pickString(teamPlan, "primaryIntent") ?? "unknown"}`,
          `队伍胜利条件：${pickString(teamPlan, "winCondition") ?? "unknown"}`
        ]
      : []),
    ...(coachCorrection
      ? [
          `暂停修正重点：${pickString(coachCorrection, "nextRoundObjective") ?? "unknown"}`,
          `暂停修正主令：${pickString(coachCorrection, "teamDirective") ?? "unknown"}`
        ]
      : []),
    ...(coachAdjustment ? [`教练单兵修正：${pickString(coachAdjustment, "adjustment") ?? "unknown"}`] : []),
    ...(playerDirective ? [`选手指令：${pickString(playerDirective, "directive") ?? "unknown"}`] : [])
  ];

  return `上下文摘要：\n${lines.join("\n")}`;
}

function resolvePhase18SubTheme(proposition: Record<string, unknown>, roundNumber: number | undefined): string | undefined {
  if (!roundNumber) {
    return undefined;
  }

  const regulationRoundThemes = Array.isArray(proposition.regulationRoundThemes)
    ? proposition.regulationRoundThemes
    : Array.isArray(proposition.regulation_round_themes)
      ? proposition.regulation_round_themes
      : [];
  const overtimeRoundThemes = Array.isArray(proposition.overtimeRoundThemes)
    ? proposition.overtimeRoundThemes
    : Array.isArray(proposition.overtime_round_themes)
      ? proposition.overtime_round_themes
      : [];
  const inRegulation = roundNumber <= 12;
  const themeSource = inRegulation ? regulationRoundThemes : overtimeRoundThemes;
  const normalizedRound = inRegulation ? ((roundNumber - 1) % 6) + 1 : ((roundNumber - 13) % 3) + 1;
  const matchLabel = inRegulation ? `R${normalizedRound}` : `OT${normalizedRound}`;
  const theme = themeSource.find((entry) => readUnknownRecord(entry)?.round === matchLabel);
  return pickString(readUnknownRecord(theme), "theme");
}

function pickString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  return record && typeof record[key] === "string" ? (record[key] as string) : undefined;
}

function pickStringArray(record: Record<string, unknown> | undefined, key: string): string[] {
  if (!record || !Array.isArray(record[key])) {
    return [];
  }

  return (record[key] as unknown[]).filter((item): item is string => typeof item === "string");
}

function readUnknownRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
