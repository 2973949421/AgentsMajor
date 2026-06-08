import {
  judgeRubricProfileSchema,
  judgeScoreDimensions,
  type JudgeDimensionRequirements,
  type JudgeRubricProfile,
  type JudgeScoreDimension,
  type JudgeScoreDimensionWeights,
  type SideAssignment
} from "@agent-major/shared";

import { resolveRoundEconomyPhase, type TeamEconomyPlan } from "../economy/economy-output-service.js";

const judgeScoreDimensionLabels: Record<JudgeScoreDimension, string> = {
  objectiveScore: "CS 目标完成度",
  mapControlScore: "地图区域控制",
  submissionQualityScore: "有效提交质量",
  coordinationScore: "团队协同",
  economyAdjustedScore: "经济调整价值",
  riskControlScore: "风险控制",
  proofScore: "命题证明"
};

export const defenderThesisDimensionRequirements: JudgeDimensionRequirements = {
  objectiveScore: {
    challengeRequirement: "攻方是否明确攻击守方商业计划的关键漏洞，并把推进、清点、下包或转点转化为有效 challenge。",
    defenseRequirement: "守方是否守住商业计划的关键成立点，并通过拖时、回防、反清或拆解阻断攻方 challenge。"
  },
  mapControlScore: {
    challengeRequirement: "攻方是否打到与守方核心命题相关的主攻区、弱防区或转点路径。",
    defenseRequirement: "守方是否把资源部署在正确命题焦点区，并控制攻方进入关键论证区域。"
  },
  submissionQualityScore: {
    challengeRequirement: "攻方 SubmittedOutput 是否提出具体、可审计的 challenge，而不是泛泛反对。",
    defenseRequirement: "守方 SubmittedOutput 是否具体补强、解释或防住被挑战的商业计划。"
  },
  coordinationScore: {
    challengeRequirement: "攻方队内角色是否分工挑战守方 thesis 的不同漏洞。",
    defenseRequirement: "守方队内角色是否分工守住 thesis 的产品、用户、商业和执行闭环。"
  },
  economyAdjustedScore: {
    challengeRequirement: "攻方在当前经济和输出预算下，是否优先攻击守方最高价值漏洞。",
    defenseRequirement: "守方在当前经济和输出预算下，是否优先守住最关键成立点。"
  },
  riskControlScore: {
    challengeRequirement: "攻方是否避免稻草人式 challenge、错误攻击非核心点、过度冒进或超时。",
    defenseRequirement: "守方是否避免空泛防守、过度保守、漏掉真实漏洞或用大词掩盖断点。"
  },
  proofScore: {
    challengeRequirement: "攻方是否证明守方机会不真、痛点不足、切口不锋利、时机不对或执行不闭环。",
    defenseRequirement: "守方是否证明自身机会真实、痛点强、切口可打、时机可信且执行闭环。"
  }
};

const baseJudgeRubricWeights: JudgeScoreDimensionWeights = {
  objectiveScore: 1 / 7,
  mapControlScore: 1 / 7,
  submissionQualityScore: 1 / 7,
  coordinationScore: 1 / 7,
  economyAdjustedScore: 1 / 7,
  riskControlScore: 1 / 7,
  proofScore: 1 / 7
};

export function buildJudgeRubricProfile(input: {
  mapName: string;
  roundNumber: number;
  sideAssignment: SideAssignment;
  teamEconomyPlans: Record<string, TeamEconomyPlan>;
  mapSemanticContext?: Record<string, unknown> | undefined;
  judgeRubricContext?: Record<string, unknown> | undefined;
}): JudgeRubricProfile {
  void input.sideAssignment;
  const proposition = readUnknownRecord(input.mapSemanticContext?.proposition);
  const subTheme = proposition ? resolvePhase18SubTheme(proposition, input.roundNumber) : undefined;
  const coreAxis = pickString(input.judgeRubricContext, "coreJudgmentAxis") ?? pickString(input.judgeRubricContext, "core_judgment_axis");
  const axisText = `${coreAxis ?? ""} ${pickString(proposition, "mapTheme") ?? ""} ${pickString(proposition, "map_theme") ?? ""}`;
  const mapEmphasis = axisText.includes("opportunity")
    ? (["mapControlScore", "proofScore"] as JudgeScoreDimension[])
    : (["objectiveScore", "submissionQualityScore"] as JudgeScoreDimension[]);
  const roundEmphasis = resolveRoundRubricEmphasis({
    roundNumber: input.roundNumber,
    subTheme,
    teamEconomyPlans: input.teamEconomyPlans
  });
  const weights = normalizeJudgeRubricWeights(applyJudgeRubricEmphasis(baseJudgeRubricWeights, [...mapEmphasis, ...roundEmphasis]));
  const reasonMustCover = [
    ...pickStringArray(input.judgeRubricContext, "reasonMustCover"),
    ...pickStringArray(input.judgeRubricContext, "reason_must_cover")
  ];
  const forbiddenBiases = [
    ...pickStringArray(input.judgeRubricContext, "biasGuardrails"),
    ...pickStringArray(input.judgeRubricContext, "bias_guardrails"),
    "历史连胜偏置",
    "比分领先偏置",
    "防守命题天然成立偏置",
    "节目效果追分偏置"
  ];
  const roundPhase = resolveRoundEconomyPhase(input.roundNumber);
  return judgeRubricProfileSchema.parse({
    profileId: `rubric_${safeId(input.mapName)}_r${input.roundNumber}_${stableHex(JSON.stringify({ subTheme, coreAxis, roundPhase })).slice(0, 8)}`,
    baseVersion: "baseJudgeRubric-v1",
    dimensions: [...judgeScoreDimensions],
    dimensionWeights: weights,
    mapAdjustment: {
      source: "judgeRubricContext",
      applied: Boolean(coreAxis || input.judgeRubricContext),
      summary: coreAxis
        ? `地图裁判轴 ${coreAxis} 调整评分重点，强调 ${mapEmphasis.map((dimension) => judgeScoreDimensionLabels[dimension]).join("、")}。`
        : "未发现地图专属裁判轴，使用全局基础评分根基。",
      emphasizedDimensions: mapEmphasis
    },
    roundAdjustment: {
      source: "currentSubTheme",
      subTheme: subTheme ?? "默认回合子命题",
      summary: buildRoundRubricAdjustmentSummary({
        roundNumber: input.roundNumber,
        subTheme,
        roundPhase,
        emphasizedDimensions: roundEmphasis
      }),
      emphasizedDimensions: roundEmphasis
    },
    evidenceRequirements: [
      ...reasonMustCover,
      "必须分别引用双方 team_plan 与 SubmittedOutput。",
      "必须说明经济只如何影响 economyAdjustedScore，不能作为隐藏胜负补偿。",
      "必须说明攻方目标推进与守方核心命题在同一评分根基下如何比较。"
    ],
    forbiddenBiases: [...new Set(forbiddenBiases)]
  });
}

export function resolvePhase18SubTheme(proposition: Record<string, unknown>, roundNumber: number | undefined): string | undefined {
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

function resolveRoundRubricEmphasis(input: {
  roundNumber: number;
  subTheme?: string | undefined;
  teamEconomyPlans: Record<string, TeamEconomyPlan>;
}): JudgeScoreDimension[] {
  const phase = resolveRoundEconomyPhase(input.roundNumber);
  if (phase === "pistol_round") {
    return ["objectiveScore", "coordinationScore"];
  }
  const postures = Object.values(input.teamEconomyPlans).map((plan) => plan.posture);
  if (postures.every((posture) => posture === "rifle_buy" || posture === "awp_buy" || posture === "double_awp")) {
    return ["submissionQualityScore", "proofScore"];
  }
  const subTheme = (input.subTheme ?? "").toLowerCase();
  if (/risk|风险|reset|破产|force|强起/.test(subTheme)) {
    return ["riskControlScore", "economyAdjustedScore"];
  }
  return ["objectiveScore", "proofScore"];
}

function applyJudgeRubricEmphasis(
  baseWeights: JudgeScoreDimensionWeights,
  emphasizedDimensions: JudgeScoreDimension[]
): JudgeScoreDimensionWeights {
  const emphasized = new Set(emphasizedDimensions);
  return Object.fromEntries(
    judgeScoreDimensions.map((dimension) => [
      dimension,
      baseWeights[dimension] * (emphasized.has(dimension) ? 1.2 : 1)
    ])
  ) as JudgeScoreDimensionWeights;
}

function normalizeJudgeRubricWeights(weights: JudgeScoreDimensionWeights): JudgeScoreDimensionWeights {
  const total = judgeScoreDimensions.reduce((sum, dimension) => sum + weights[dimension], 0);
  return Object.fromEntries(
    judgeScoreDimensions.map((dimension) => [dimension, roundJudgeScore(weights[dimension] / total, 4)])
  ) as JudgeScoreDimensionWeights;
}

function buildRoundRubricAdjustmentSummary(input: {
  roundNumber: number;
  subTheme?: string | undefined;
  roundPhase: string;
  emphasizedDimensions: JudgeScoreDimension[];
}): string {
  const emphasis = input.emphasizedDimensions.map((dimension) => judgeScoreDimensionLabels[dimension]).join("、");
  return `R${input.roundNumber} ${input.subTheme ?? "默认子命题"} / ${input.roundPhase}：本回合重点检查 ${emphasis}。`;
}

function readUnknownRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
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

function roundJudgeScore(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function stableHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
