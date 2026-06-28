interface FinanceSummarySubmittedOutput {
  economyClipTier?: string | undefined;
  clippingTier?: string | undefined;
  spend?: number | undefined;
  spendUnit?: number | undefined;
  charsPerSpendUnit?: number | undefined;
  submittedBudgetChars: number;
  cutMode?: string | undefined;
  omittedFields: string[];
  cappedFields: string[];
  budgetClampReason?: string | undefined;
  combatEffectCap: string;
  rawOpinionTargetMinChars: number;
  rawOpinionTargetMaxChars: number;
  rawOpinionCharCount: number;
  submittedOpinionCharCount: number;
  submittedBudgetUtilization: number;
  rawOpinionUnderTarget: boolean;
  rawOpinionUnderfilled: boolean;
}

export function buildFinanceClippingSummary(submitted: FinanceSummarySubmittedOutput | undefined): string {
  if (!submitted) {
    return "旧 trace 未记录经济裁剪结果。";
  }
  const tier = formatFinanceClippingTierZh(submitted.economyClipTier ?? submitted.clippingTier);
  const spend = typeof submitted.spend === "number" ? `花费 ${submitted.spend}` : "花费未记录";
  const exchange = typeof submitted.spendUnit === "number" && typeof submitted.charsPerSpendUnit === "number"
    ? `汇率 ${submitted.spendUnit}=${submitted.charsPerSpendUnit}字`
    : "汇率未记录";
  const budget = submitted.submittedBudgetChars > 0 ? `提交预算 ${submitted.submittedBudgetChars} 字` : "提交预算未记录";
  const cutMode = submitted.cutMode ? `模式 ${formatFinanceCutModeZh(submitted.cutMode)}` : "裁剪模式未记录";
  const omitted = submitted.omittedFields.length > 0 ? `被裁剪 ${submitted.omittedFields.length} 项` : "无被裁剪字段";
  const capped = submitted.cappedFields.length > 0 ? `封顶 ${submitted.cappedFields.length} 项` : "无额外封顶字段";
  const clamp = submitted.budgetClampReason && submitted.budgetClampReason !== "within_tier" ? `预算被档位限制：${formatBudgetClampReasonZh(submitted.budgetClampReason)}` : "预算未被档位额外限制";
  return `经济剪裁：${tier}；${spend}；${exchange}；${budget}；${cutMode}；金融火力上限：${formatFinanceCapLevelZh(submitted.combatEffectCap)}；${clamp}；${omitted}；${capped}。`;
}
export function buildFinanceLengthSummary(submitted: FinanceSummarySubmittedOutput | undefined): string {
  if (!submitted) {
    return "旧 trace 未记录 N62C 长度审计。";
  }
  if (submitted.rawOpinionTargetMinChars <= 0 || submitted.rawOpinionTargetMaxChars <= 0 || submitted.submittedBudgetChars <= 0) {
    return "旧 trace 未记录 N62C 原文目标或提交预算。";
  }
  const utilizationPct = Math.round(submitted.submittedBudgetUtilization * 100);
  const underTarget = submitted.rawOpinionUnderTarget ? "；原文短于目标" : "";
  const underfilled = submitted.rawOpinionUnderfilled ? "；原文短于提交预算，系统未补写内容" : "";
  return `原文长度：${submitted.rawOpinionCharCount} / 目标 ${submitted.rawOpinionTargetMinChars}-${submitted.rawOpinionTargetMaxChars}；提交长度：${submitted.submittedOpinionCharCount} / 预算 ${submitted.submittedBudgetChars}；预算使用率 ${utilizationPct}%${underTarget}${underfilled}。`;
}

function formatFinanceClippingTierZh(tier: string): string {
  if (tier === "high_full") return "高配 / AWP";
  if (tier === "rifle_full") return "完整长枪";
  if (tier === "half") return "半起 / 奖励局";
  if (tier === "light") return "轻买 / 手枪甲";
  if (tier === "force") return "强起 / 破产混起";
  if (tier === "pistol") return "手枪局";
  if (tier === "eco") return "eco 经济局";
  if (tier === "save") return "保枪 / 全 eco";
  if (tier === "full") return "完整";
  if (tier === "standard") return "标准";
  return tier ? `未知(${tier})` : "未知";
}

function formatFinanceCutModeZh(mode: string): string {
  if (mode === "front_cut") return "开头短截";
  if (mode === "tiny_random_window") return "极短随机窗口";
  if (mode === "random_window") return "随机窗口";
  if (mode === "pistol_core_window") return "手枪局核心窗口";
  if (mode === "core_window") return "核心窗口";
  if (mode === "random_core_window") return "核心附近随机窗口";
  if (mode === "multi_slice_lite") return "轻量多片段";
  if (mode === "multi_slice") return "多片段";
  if (mode === "multi_slice_plus") return "增强多片段";
  return mode;
}

function formatBudgetClampReasonZh(reason: string): string {
  if (reason === "raised_to_tier_min") return "按买型下限抬高";
  if (reason === "capped_to_tier_max") return "按买型上限封顶";
  if (reason === "fallback_no_economy") return "缺经济数字，使用保守 fallback";
  if (reason === "within_tier") return "未限制";
  return reason;
}
function formatFinanceCapLevelZh(cap: string): string {
  if (cap === "possible_kill") return "高";
  if (cap === "possible_wound" || cap === "forced_back" || cap === "suppression") return "中";
  if (cap === "weak_pressure" || cap === "minor_delay" || cap === "none") return "低";
  return "未知";
}
