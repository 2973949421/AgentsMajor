import type { LlmMessage } from "@agent-major/llm";

export const PHASE20_PRE_PROMPT_CONTRACT_ID = "phase20pre-prompt-contract-v6";

export const PHASE20_PRE_PROMPT_TASKS = [
  "team_plan",
  "agent_action",
  "judge_verdict",
  "judge_narrative",
  "judge_review",
  "combat_resolution",
  "coach_timeout",
  "coach_post_match_review"
] as const;

export type Phase20PrePromptTask = (typeof PHASE20_PRE_PROMPT_TASKS)[number];

export interface Phase20PrePromptHashInput {
  task: Phase20PrePromptTask;
  schemaName: string;
  requestInput: unknown;
  promptContractId?: string;
}

export interface Phase20PreStructuredMessageInput extends Phase20PrePromptHashInput {
  contextSummary: string;
}

export function buildPhase20PrePromptHashSource(input: Phase20PrePromptHashInput): string {
  return JSON.stringify({
    promptContractId: input.promptContractId ?? PHASE20_PRE_PROMPT_CONTRACT_ID,
    task: input.task,
    schemaName: input.schemaName,
    input: input.requestInput
  });
}

export function buildPhase20PreStructuredMessages(input: Phase20PreStructuredMessageInput): LlmMessage[] {
  const promptContractId = input.promptContractId ?? PHASE20_PRE_PROMPT_CONTRACT_ID;
  return [
    {
      role: "system",
      content: [
        "你是 Agent Major Phase 2.0-pre 的结构化对局引擎。",
        `promptContractId: ${promptContractId}`,
        "你必须只输出严格合法的 JSON。不要输出 markdown、代码块、解释、前后缀或任何 JSON 之外的文本。",
        "除 BO3、MVP、schema 字段名、地图名、队伍名、选手名等必要英文外，自然语言内容默认使用中文，不要写中英混杂句。",
        "只能使用输入中的地图命题、队伍方案、team_plan、agent_action、coach 修正、judge rubric 和公开回合摘要；禁止补写未提供事实。",
        "双方公开输入必须平等；经济不裁剪公开输入，只影响 RawOutput -> SubmittedOutput 后提交给 Judge 的有效内容。",
        "参赛方只能知道己方真实经济、己方买型和己方计划；对手真实经济、买型、当前计划、主攻/主防点和输出内容都不是公开输入。",
        "agent_action 是计划性行动，不是 combat ledger。不能把它写成已经发生击杀、清点完成、封锁回防或补枪残局的事实来源。",
        "judge 可以在结算层生成击杀、下包、拆包、清场等结果推断，但必须写入 judgeInference，并明确这些是裁判推断，不是 agent_action 原始事实。",
        buildPhase20PreSchemaContract(input.schemaName),
        buildPhase20PreTaskInstruction(input.task)
      ].join("\n\n")
    },
    {
      role: "user",
      content: [
        `任务：${input.task}`,
        `Prompt Contract：${promptContractId}`,
        "这不是自由叙事，也不是通用 Counter-Strike 模拟。你必须把给定比赛资产当作唯一事实来源。",
        "当上下文存在时，必须围绕 mapSemanticContext、judgeRubricContext、initialProposal、initialProposalSummary、proposalAnchor、coachContext、teamPlan、playerDirective、roleResponsibilities、teamMemoryOverlay、coachCorrection、coachAdjustment 回答。",
        input.contextSummary,
        "结构化输入 JSON：",
        JSON.stringify(input.requestInput, null, 2)
      ].join("\n\n")
    }
  ];
}

export function buildPhase20PreSchemaContract(schemaName: string): string {
  if (schemaName === "AgentActionDecision") {
    return [
      "JSON 输出契约：只返回一个顶层对象，必须包含 roundObjective、executionPlan、coordinationPlan、roleResponsibilityUsage、riskRead、contingencyPlan、expectedContribution、confidence，可选 fingerprint。",
      "目标长度：总输出约 300-500 output tokens。每个自然语言字段限 1-2 句完整中文，不要只写短语，也不要无限展开导致 JSON 截断。",
      "roundObjective：说明这名选手本回合要帮助队伍证明什么，必须接回地图命题、队伍计划和自身职责。",
      "executionPlan：说明可执行路径、站位/节奏/观察/牵制/转点意图，但只能写计划性动作，不能写已经完成的结果。",
      "coordinationPlan：说明与队友、team_plan、playerDirective、coachAdjustment 的衔接方式。",
      "roleResponsibilityUsage：明确使用了哪些长期职责，不能泛泛写“执行职责”。",
      "riskRead：说明本行动可能暴露的风险、证据不足处或失败触发点。",
      "contingencyPlan：说明首选动作受阻时如何修正，不能写锁死胜利结果。",
      "expectedContribution：说明如果行动被正确执行，会给 Judge 提供什么可审计贡献。",
      "confidence 必须是 0 到 1 之间的数字。fingerprint 如提供，必须是稳定短标记。",
      "禁止输出 action 字段；新版 AgentActionDecision 不再使用短句式 action。"
    ].join("\n");
  }

  if (schemaName === "TeamRoundPlanDecision") {
    return [
      "JSON 输出契约：只返回一个顶层对象，字段包括 teamId、side、primaryIntent、primaryZoneId、可选 secondaryZoneId、coordinationSummary、playerDirectives、可选 economyIntent、winCondition、risk、confidence、可选 fingerprint。",
      "目标长度：总输出约 650-950 output tokens。primaryIntent、coordinationSummary、winCondition、risk 要写成完整中文段落。",
      "playerDirectives 必须是数组，每名 active player 恰好出现一次，每项形如 {\"agentId\":\"agent_x\",\"directive\":\"...\"}。",
      "economyIntent 如提供，必须服务于己方经济决策，只能基于己方真实经济、己方 loss count、已保下装备和公开历史给出 posture / drop / save / force 倾向，不能把对手真实经济当事实写入。",
      "economyIntent.buyIntentByAgent 如提供，必须是数组；每项形如 {\"agentId\":\"agent_x\",\"targetPosture\":\"rifle_buy\",\"preferredLoadout\":\"rifle_full_t_pack\",\"note\":\"...\"}，且只能引用 active player。",
      "team_plan 只能使用己方真实经济和公开历史；对手经济最多只能作为基于公开历史的估计，且不得当作事实。",
      "side 必须与输入 side 一致，confidence 必须是 0 到 1 之间的数字。"
    ].join("\n");
  }

  if (schemaName === "JudgeResult") {
    return [
      "JSON 输出契约：只返回一个顶层对象，字段包括 winnerTeamId、loserTeamId、margin、roundWinType、attackWinConditionMet、defenseWinConditionMet、reason、mvpAgentId、confidence、judgeInference、judgeScorecard、diagnostic。",
      "目标长度：总输出约 750-1200 output tokens。reason 必须是完整中文裁判判词，diagnostic 必须完整。",
      "judgeScorecard 必须按输入 rubricProfile 打分，不能新增评分维度，不能改写 rubricProfile；winnerTeamId 必须等于 judgeScorecard.winnerFromScore，margin 必须等于 judgeScorecard.marginFromScore。",
      "roundWinType 必须严格是 attack_elimination、attack_bomb_explosion、defense_elimination、defense_timeout_no_plant、defense_defuse 五者之一。",
      "attackWinConditionMet 和 defenseWinConditionMet 必须是布尔值，且只能有一方为 true；它们必须与 roundWinType 和 winnerTeamId 一致。",
      "judgeInference 必须包含 source=\"judge_inference\"、boundary、csResolution、combatNarrative、evidenceBasis。boundary 必须明确：击杀/下包/拆包/清场属于裁判推断，不是 agent_action 原始事实。",
      "diagnostic 必须包含 currentSubTheme、attackedOpportunityGap、defendedCoreProposition、mainAttackZoneId、mainDefenseZoneId、zoneRelation、decisiveEvidence。",
      "zoneRelation 必须包含 attackZoneId、defenseZoneId、relationType、relationSummary、outcomeImpact；attackZoneId 必须等于 mainAttackZoneId，defenseZoneId 必须等于 mainDefenseZoneId。",
      "relationType 必须是 same_focus、cross_hit、split_pressure、failed_probe、rotation_test、weak_side_hit 之一。",
      "Judge 可以在结算层读取双方买型和双方 SubmittedOutput，但不得引用 RawOutput 中未提交给自己的内容或被 Output Gate 裁掉的内容。",
      "agent_action 只能作为意图、职责、计划执行和风险判断证据，不是 combat ledger；如果 reason 写击杀链、清点、回防、全歼、下包、拆包，必须由 judgeInference 承担来源边界。",
      "margin 必须严格是 narrow、standard、decisive 三者之一，不要使用 clear、close、solid、dominant 等同义词。",
      "reason 必须同时解释胜方为什么成功、败方为什么失败，并说明 CS 胜利方式与商业攻防命题如何对应。"
    ].join("\n");
  }

  if (schemaName === "JudgeVerdictDecision") {
    return [
      "JSON 输出契约：只返回一个短结构对象，字段包括 winnerTeamId、loserTeamId、margin、roundWinType、attackWinConditionMet、defenseWinConditionMet、mvpAgentId、confidence、judgeScorecard、diagnostic。",
      "目标长度：总输出约 750-1100 output tokens。不要写长判词，不要写自由叙事；reason 和 judgeInference 由 judge_narrative 生成。",
      "必须先按输入 rubricProfile 给双方分别打 7 维分，再由分数推导 winnerTeamId、margin 和 roundWinType。禁止先写结论再补分。",
      "judgeScorecard.rubricProfile 必须与输入 rubricProfile 一致；全局维度固定为 objectiveScore、mapControlScore、submissionQualityScore、coordinationScore、economyAdjustedScore、riskControlScore、proofScore。",
      "teamScores 必须包含 teamAId 和 teamBId 两个 key；每队每个维度必须包含 score、evidence、evidenceSource。evidenceSource 只能是 team_plan、submitted_output、economy、zone_relation、map_semantic_context、judge_rubric_context、round_context、combat_resolution、public_history。",
      "winnerTeamId 必须等于 judgeScorecard.winnerFromScore；margin 必须等于 judgeScorecard.marginFromScore。scoreOverride 默认不要使用，只有结构化分数与硬性 CS 胜法冲突时才允许。",
      "防守方不能只因为 defendedCoreProposition 听起来成立而获胜；攻方目标推进、下包/全歼、区域突破、SubmittedOutput 质量必须在同一评分根基下被量化。",
      "双方经济恢复或 rubricProfile.forbiddenBiases 包含连胜/领先约束时，禁止把历史连胜、比分领先或节目效果写成评分证据。",
      "agentOutputsByTeam 是经济闸门后的 SubmittedOutput，不是完整 RawOutput；不得引用 omittedFields 对应的被裁剪细节。",
      "roundWinType 必须严格是 attack_elimination、attack_bomb_explosion、defense_elimination、defense_timeout_no_plant、defense_defuse 五者之一。",
      "attackWinConditionMet 和 defenseWinConditionMet 必须与 roundWinType、攻守方、winnerTeamId 一致，且只能一方为 true。",
      "diagnostic 必须包含 currentSubTheme、attackedOpportunityGap、defendedCoreProposition、mainAttackZoneId、mainDefenseZoneId、zoneRelation、decisiveEvidence。",
      "zoneRelation.attackZoneId 必须等于 mainAttackZoneId；zoneRelation.defenseZoneId 必须等于 mainDefenseZoneId。",
      "margin 必须严格是 narrow、standard、decisive 三者之一。"
    ].join("\n");
  }

  if (schemaName === "JudgeNarrativeDecision") {
    return [
      "JSON 输出契约：只返回一个顶层对象，字段包括 reason、judgeInference。",
      "目标长度：总输出约 450-850 output tokens。reason 必须是完整中文裁判判词。",
      "你只能解释输入 verdict 中已经确定的胜方、败方、胜法、区域和 diagnostic，禁止更改胜负、roundWinType、MVP、主攻区或主守区。",
      "judgeInference 必须包含 source=\"judge_inference\"、boundary、csResolution、combatNarrative、evidenceBasis。",
      "boundary 必须明确：击杀、清点、回防、全歼、下包、拆包等结果叙事属于裁判推断，不是 agent_action 原始事实。",
      "reason 必须同时解释胜方为什么成功、败方为什么失败，并说明 CS 胜利方式与商业攻防命题如何对应。",
      "如果 verdict.roundWinType 不是 attack_bomb_explosion 或 defense_defuse，reason 不得写“成功下包并赢下回合”作为胜因。"
    ].join("\n");
  }

  if (schemaName === "CombatResolutionDraft") {
    return [
      "JSON 输出契约：只返回一个受限战斗草案对象，字段包括 roundWinType、killEvents、plantEvent、defuseEvent、explosionEvent、survivors、openingDuel、tradeSequence、clutchTag、mvpEvidence、可选 consistencyNotes。",
      "该草案不是最终事实，代码校验器会决定是否采用。你必须服从输入 verdict.roundWinType、winnerTeamId、attackerTeamId、defenderTeamId、active rosters 和主区域。",
      "硬约束：attack_elimination 必须守方全灭；defense_elimination 必须攻方全灭；attack_bomb_explosion 必须有 plantEvent 和 explosionEvent 且无 defuseEvent；defense_defuse 必须有 plantEvent 和 defuseEvent 且无 explosionEvent；defense_timeout_no_plant 不得有任何爆弹事件。",
      "killEvents 中同一 targetAgentId 只能死亡一次，actor 与 target 必须属于不同队伍且都是 active roster。",
      "clutchTag=one_v_x 只有在真实一人残局条件成立时才允许，否则用 none。MVP 通常不应超过 3 杀，除非 survivorship 和胜法确实支持残局。"
    ].join("\n");
  }

  if (schemaName === "CoachTimeoutCorrection") {
    return [
      "JSON 输出契约：只返回一个顶层对象，字段包括 teamId、triggerRoundNumber、triggerReason、diagnosedFailure、nextRoundObjective、ownCoreToHold、opponentGapToHit、zonePriorityShift、teamDirective、playerAdjustments、expiresAfterRoundNumber、confidence、可选 fingerprint。",
      "目标长度：总输出约 500-900 output tokens。它是一张影响下一回合的修正单，不是重写整图方案。",
      "playerAdjustments 必须是数组，每名 active player 恰好出现一次。",
      "必须保持主区优先 + 次区预警/回防的平衡，不允许五人全部压向同一个单点 all-in。"
    ].join("\n");
  }

  if (schemaName === "CoachPostMatchReview") {
    return [
      "JSON 输出契约：只返回一个顶层对象，字段包括 teamId、matchId、keptBeliefs、brokenBeliefs、effectiveAttacks、effectiveDefenses、timeoutQualityReview、nextMatchUpgrades、proposedStrategyPatch、confidence、可选 fingerprint。",
      "目标长度：总输出约 900-1600 output tokens。复盘只服务下一场比赛，不允许回写已经完成的 BO3 事实。",
      "数组字段必须是中文字符串数组；proposedStrategyPatch 必须是可人工采纳的策略补丁。"
    ].join("\n");
  }

  return "JSON 输出契约：只返回一个与指定 schema 完全一致的顶层对象。";
}

export function buildPhase20PreTaskInstruction(task: Phase20PrePromptTask): string {
  switch (task) {
    case "team_plan":
      return [
        "任务说明：生成一份贴合当前地图命题、裁判规程与队伍唯一方案的回合计划。",
        "进攻方必须说明本局要打对手方案的哪个缺口；防守方必须说明本局要守住己方方案的哪个核心成立点。",
        "不要输出通用点位模板，也不要临时发明另一套总方案。你必须把 initialProposal 翻译成当前回合的局部执行方案。",
        "playerDirectives 必须给每名 active player 一个职责不同、可执行、能服务团队目标的指令。",
        "自然语言内容使用中文，必要英文名词只作为锚点。"
      ].join("\n");
    case "agent_action":
      return [
        "任务说明：为单名选手生成一份结构化、可审计、足够详细的本回合计划性行动。",
        "你要把 roleResponsibilities、teamPlan、playerDirective、proposalAnchor、coachContext 和 coachAdjustment 合并成单名选手能执行的行动设计。",
        "不要重写整队方案；不要把行动写成已经发生的战斗结果；不要臆造隐藏情报、对手当前计划、对手真实经济或对手买型。",
        "输出必须让人能判断这名选手是否真的在履行长期职责、是否和队伍计划配合、风险在哪里、失败后如何修正。",
        "目标是 300-500 output tokens；短句、口号、单行动描述都不合格。"
      ].join("\n");
    case "judge_verdict":
      return [
        "任务说明：先按 rubricProfile 生成 judgeScorecard，再生成短结构裁决 verdict，不写长判词。",
        "先判断双方计划分别想证明什么，再按 7 个基础维度评分，再判断 CS 胜利方式，最后用 scoreDelta 推导商业攻防命题更支持哪一方。",
        "区域关系只能作为证据，不能作为自动胜负规则；必须用 diagnostic.zoneRelation 结构化说明，不要依赖 reason 里的固定桥接句。",
        "rubricProfile 是代码生成的只读评分标准；地图/回合修正只能来自该 profile，禁止临场发明评分标准。",
        "不要输出 reason 或 judgeInference；它们由 judge_narrative 在 verdict 锁定后生成。"
      ].join("\n");
    case "judge_narrative":
      return [
        "任务说明：基于已锁定 verdict 生成可读裁判判词和裁判推断边界。",
        "不得改变 verdict 中的胜负、胜法、MVP、主攻区、主守区、margin 或 confidence。",
        "可以生成 CS 结果推断，但必须放进 judgeInference 的边界内；reason 可以引用该推断，不能把它伪装成 agent_action 原始事实。",
        "reason 必须完整解释胜方成功、败方失败、MVP 为什么成立，以及结论为什么符合当前地图命题。"
      ].join("\n");
    case "judge_review":
      return [
        "任务说明：在同一裁判规程下，带着更强的反偏置要求复核上一版裁判结果。",
        "必须重新检查双方胜利条件、计划执行、选手行动证据、CS 胜利方式和商业命题之间是否一致。",
        "如果上一版只是叙事偏置或理由残缺，请直接纠正，而不是补故事保留原判。"
      ].join("\n");
    case "combat_resolution":
      return [
        "任务说明：根据已锁定 judge verdict、judge narrative、双方行动和当前 roster 生成受限战斗草案。",
        "你不是最终裁判，不能改变胜方、败方或 roundWinType；代码校验器会拒绝矛盾草案并回退 deterministic resolver。",
        "战斗草案要比固定 1v1 更自然，但必须严格遵守生死、爆弹事件、区域和 clutch 条件。"
      ].join("\n");
    case "coach_timeout":
      return [
        "任务说明：你处在战术暂停窗口，只能输出影响下一回合的修正单。",
        "只能诊断问题、统一重点、重排区域优先级，不能重写地图命题、队伍母方案或单图初始方案。",
        "修正必须具体到队伍目标和每名选手调整，但保持主区优先 + 次区预警/回防。"
      ].join("\n");
    case "coach_post_match_review":
      return [
        "任务说明：你在整场 BO3 结束后输出赛后复盘，目标是为下一场比赛提供可人工采纳的升级建议。",
        "不能改写已经结束的 BO3 事实；只能总结保留信念、破损信念、有效进攻、有效防守、timeout 质量和下一场升级。"
      ].join("\n");
  }
}
