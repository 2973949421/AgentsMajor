# Phase 2.0-pre 裁判可审计契约

## 1. 定位

这份文档冻结 `Phase 2.0-pre / Dust2` 主校准线的裁判契约。

judge 不是比分播报器，不是文风评审，也不是自由叙事者。  
judge 的职责固定为：

- 判定本局 `CS 胜负方式`
- 判定本局 `商业攻防是否成立`
- 产出可落库、可回放、可供 coach 与前端消费的结构化证据

## 2. 输出分层

`phase20pre-prompt-contract-v5` 起，真实 LLM judge 拆成两段；`phase20pre-prompt-contract-v6` 起，`judge_verdict` 必须先产出评分表再产出裁决：

- `judge_verdict`
  - 短结构裁决
  - 锁定 `winnerTeamId / loserTeamId / margin / roundWinType / attackWinConditionMet / defenseWinConditionMet / mvpAgentId / judgeScorecard / diagnostic`
  - `judgeScorecard` 必须使用代码生成的 `rubricProfile`
  - 不写长判词，不输出 `judgeInference`
- `judge_narrative`
  - 给人读的最终判词和裁判推断边界
  - 只能解释已锁定 verdict，不能改变胜负、胜法、MVP 或区域焦点
- 最终落库仍组合为兼容的 `JudgeResult`

每个真实 LLM judge 最终结果都必须同时返回两层内容：

- `reason`
  - 给人读的最终判词
  - 必须解释本局是怎么赢的、胜方为什么成功、败方为什么失败
- `diagnostic`
  - 给系统审计、前端展示、coach 暂停修正与赛后复盘消费的结构化裁判事实
- `judgeScorecard`
  - 给系统审计、前端展示和赛后复盘消费的结构化评分表
  - 必须解释 winner 与 margin 如何从分数得出

仅有 `reason` 不算完成裁判输出。`diagnostic` 不能在后处理阶段从 `reason` 反推伪造。新 run 中仅有 `diagnostic` 也不算完成裁判输出，必须有 `judgeScorecard`。

## 3. JudgeResult 必填字段

真实 LLM judge 必须返回以下基础字段：

- `winnerTeamId`
- `loserTeamId`
- `margin`
- `roundWinType`
- `attackWinConditionMet`
- `defenseWinConditionMet`
- `reason`
- `mvpAgentId`
- `confidence`
- `judgeInference`
- `judgeScorecard`
- `diagnostic`

## 3.1 judgeScorecard 评分根基

`judgeScorecard` 是新裁判主审计层，必须在 `judge_verdict` 阶段生成。评分表采用“全局根基 + 地图修正 + 回合修正”：

- 全局根基固定为 `baseJudgeRubric-v1`
- 地图修正只能来自 `judgeRubricContext`
- 回合修正只能来自 `currentSubTheme / roundNumber / sideAssignment / economyPosture`
- LLM 只能消费代码生成的 `rubricProfile`，不能自造评分标准

固定 7 个评分维度：

- `objectiveScore`
- `mapControlScore`
- `submissionQualityScore`
- `coordinationScore`
- `economyAdjustedScore`
- `riskControlScore`
- `proofScore`

每个维度必须包含：

- `score`：0-10
- `evidence`：一句中文证据
- `evidenceSource`：只能来自 `team_plan / submitted_output / economy / zone_relation / map_semantic_context / judge_rubric_context / round_context / combat_resolution / public_history`

硬约束：

- `teamScores` 必须同时包含双方
- `totalScore` 必须等于各维度加权分
- `winnerTeamId` 必须等于 `winnerFromScore`
- `margin` 必须等于 `marginFromScore`
- `dimensionWeights` 总和必须为 1
- 单维度权重只能在基础等权附近有限浮动，不能出现地图黑箱偏置
- `public_history` 不能作为直接评分证据，只能作为公开背景

防偏置规则：

- 防守方不能只凭 `defendedCoreProposition` 获胜，必须在当前回合证据中获得分数优势
- 攻方的目标推进、区域突破、下包/全歼和有效提交质量必须被同等量化
- 双方经济恢复后，历史连胜/连败不能影响分数
- 不允许隐藏 comeback bonus、追分剧本或节目效果加分

### 3.2 胜负方式字段

`roundWinType` 只允许以下 5 种值：

- `attack_elimination`
- `attack_bomb_explosion`
- `defense_elimination`
- `defense_timeout_no_plant`
- `defense_defuse`

对应口径固定为：

- 进攻方：`全歼` / `下包并引爆`
- 防守方：`全歼` / `时间耗尽未下包` / `拆包成功`

`attackWinConditionMet` 与 `defenseWinConditionMet` 必须是布尔值，并且只能有一方为 `true`。  
它们必须与 `roundWinType`、`winnerTeamId`、本局攻守关系一致。

## 4. diagnostic 六字段

`diagnostic` 在本阶段固定为 6 个字段：

- `currentSubTheme`
- `attackedOpportunityGap`
- `defendedCoreProposition`
- `mainAttackZoneId`
- `mainDefenseZoneId`
- `decisiveEvidence`

### 4.1 字段含义

- `currentSubTheme`
  - 当前回合子命题，必须对应当前地图命题与 round theme
- `attackedOpportunityGap`
  - 攻方本局实际打中的机会缺口
  - 不能只写抽象词，必须写出“对象 + 缺口 + 为什么”
- `defendedCoreProposition`
  - 守方试图守住的核心成立点
  - 不能只写抽象词，必须写出“对象 + 成立点 + 为什么”
- `mainAttackZoneId`
  - 本局主攻落点 / 主执行区
- `mainDefenseZoneId`
  - 守方试图捍卫的核心命题焦点区
- `decisiveEvidence`
  - 决定性证据
  - 必须能回指到当前事实层，不允许纯叙事填充

### 4.2 区域说明

`mainAttackZoneId` 和 `mainDefenseZoneId` 可以相同，也可以不同。  
若不同，`reason` 必须明确解释：

- 为什么本局主攻落点在这个区
- 为什么守方真正试图捍卫的命题焦点在另一个区
- 这种区域关系如何回到双方计划、选手行动、CS 胜利方式和商业命题

也就是说，前端展示时必须允许：

- “主攻落点”
- “守方命题焦点”

不是同一个概念。

区域关系只是一种事实结构，不是胜负捷径。judge 禁止做以下推导：

- 因为守方守 A、攻方也打 A，所以守方天然更合理或天然获胜
- 因为守方守 A、攻方打 B，所以守方天然失败
- 因为主攻区与主守区相同，所以任一方自动占优
- 因为主攻区与主守区不同，所以任一方自动占优

真正的裁判依据只能来自：

- 双方计划是否贴合当前子命题
- 选手行动是否执行了计划
- CS 胜利方式是否成立
- 回合结果是否验证了商业命题

## 5. 允许引用的证据层

judge 只能引用当前已给出的真实事实层：

- `team_plan`
- `agent_action`
- `mapSemanticContext`
- `judgeRubricContext`
- `sideAssignment`
- 裁判结算层的 `buy type / economy tags`，它们不是双方参赛 prompt 的公开输入
- 当前已公开的回合摘要

如果 `mapSemanticContext`、`judgeRubricContext`、`team_plan`、`agent_action`、`reason` 或 `diagnostic` 出现明显中文编码损坏，当前 round 必须 fail。系统不能把乱码当作同义词容错，也不能继续把损坏上下文送入 judge。

证据边界优先于文采。Judge 可以在结算层读取双方真实经济和双方 `SubmittedOutput`，但不得引用 `RawOutput` 或被 Output Gate 裁掉的内容。当前没有完整、可供 judge 引用的 combat ledger 时，judge 的微观战斗叙事只能停留在 `judgeInference`，并且必须明确是裁判推断；后续由 `roundCombatResolution` 代码校验器落成最终事实。

judge 允许在 `judgeInference` 中生成“裁判推断”的结果叙事，包括击杀、全歼、下包、拆包、回防等，但必须明确这些是结算层推断，不是 `agent_action` 原始事实。未标注推断边界的微观事实仍然非法。

judge 不允许补写未被支持且未标注为裁判推断的微观事实，例如：

- 精确枪线
- 秒级交火顺序
- 具体清点包点过程
- 封锁回防路径
- 完成首杀 / 多杀 / 击杀链
- 未落库的投掷物落点
- 未落库的击杀链细节
- 未在事实层出现的隐藏信息

如果某个具体动作已经原样出现在本回合 `agent_action` 中，judge 可以保守引用该动作，但不得继续扩写成未落库的击杀链、秒级动作或精确枪线。

原则固定为：

```text
裁判可以保守地解释真实事实，不能主动脑补精彩细节。
```

## 6. 非法输出

以下情况都必须判定为非法 judge 输出，并使当前 round fail：

- `diagnostic` 缺失
- `diagnostic` 任一字段缺失或为空
- `roundWinType` 缺失
- `attackWinConditionMet / defenseWinConditionMet` 缺失或互相冲突
- `winnerTeamId / loserTeamId / roundWinType` 与本局攻守关系冲突
- `currentSubTheme` 与当前回合子命题不匹配
- `mainAttackZoneId / mainDefenseZoneId` 不是合法地图区域 id
- `attackedOpportunityGap / defendedCoreProposition` 只有抽象词，没有对象与解释
- `decisiveEvidence` 只是空泛评论，没有事实锚点
- `reason` 只夸胜方，不解释败方失败
- `reason` 与 `diagnostic` 明显冲突
- `reason` 把区域相同或不同当成自动胜负规则
- `judge_narrative` 改变 `judge_verdict` 已锁定的胜负、胜法、MVP 或区域
- `reason / judgeInference` 与 `roundWinType` 冲突，例如 `attack_elimination` 却把“成功下包爆炸”写成本局胜因
- 输入或输出出现明显中文编码损坏
- `reason` 或 `decisiveEvidence` 出现未被事实层支持的微观战斗细节
- `margin` 或 `confidence` 与理由强度显著不匹配
- 用户可见层仍出现 `Team Alpha / Team Bravo` 这类占位命名

失败率优化只允许减少误杀与改善 prompt 命中率，不允许降低上述硬契约。被挡下的 judge 必须能归入明确类别，例如缺字段、区域自动胜负、`decisive` 证据不足、未支撑微观战斗细节或真实结构冲突。

非法输出不得提交：

- `rounds`
- `round_reports`
- 比分
- replay facts

但必须保留：

- failed LLM call
- artifacts
- error message

## 7. Coach 与前端消费方式

### 7.1 Coach

`judgeDiagnostic` 是 coach 的主证据来源，不再只是辅助解释。

timeout 与赛后复盘至少要消费：

- `attackedOpportunityGap`
- `defendedCoreProposition`
- `mainAttackZoneId`
- `mainDefenseZoneId`
- `roundWinType`

### 7.2 Frontend

前端主观赛层默认展示：

- 本局胜方
- 本局胜利方式
- 当前子命题
- 主攻落点
- 守方命题焦点
- 攻方打中的机会缺口
- 守方守住或失守的核心成立点
- 决定性证据
- 最终判词

原始 LLM 文本、内部调试字段、低层 artifacts 只进入折叠调试层。

## 8. 当前阶段结论

### 8.1 Hex N36 商业攻防战斗裁定

HexGrid N36 起，战斗裁判审计必须把商业攻防和 CS 执行证据分开记录：

- `businessVerdict` 记录本次交火是守方自证驳回质疑、攻方质疑成功，还是争夺未决。
- `businessReasons` 只记录与小主题、自证/质疑、选手职责和合法行动有关的理由。
- `csReasons` 只记录位置、路径、接触点、压制、补枪、经济证据等 CS 层理由。
- `killerAgentId / targetAgentId / assisterAgentIds` 是 KDA 与 killLedger 的唯一事实来源。
- fallback 文本不能成为正向商业理由。
- combat verdict 不能写 round winner，最终胜负仍由 hard win condition 物化。

### 8.2 Hex N40 角色感知归因与关键接触

HexGrid N40 起，战斗裁判还必须满足以下归因边界：

- `combatContacts` 只能保留关键接触，不能把同一区域所有攻守组合都提交给 resolver 形成全互联噪声。
- 每个保留接触必须有 `retentionReasons`，例如包点争夺、C4 压力、突破对枪、补枪准备、辅助压制。
- 被裁掉的候选接触只能进入审计计数，不能参与击杀、压制、KDA 或 RoundReport。
- `roleContributions` 只用于 killer / assister 归因排序，不改变 `businessVerdict`、hard winner 或经济事实。
- AWPer、star rifler、entry 的角色贡献必须依附有效行动和接触事实，不能硬指定击杀。
- IGL、support 的角色贡献主要进入助攻、控图、补枪准备或辅助压制，不应因排序偏置长期刷 kill。
- fallback 行动不能提供正向角色贡献。
- `targetSelectionReasons` 必须说明 casualty target 为什么被选择，不能只取 losing side participant 的第一个。

N40 后，KDA 的审计路径固定为：

```text
combat contact -> combat resolution -> casualties -> killerAgentId / targetAgentId / assisterAgentIds -> KDA / killLedger
```

前端和报告桥接层只能消费这条路径，不能补猜击杀、助攻或死亡。

### 8.3 Hex N41 商业攻防审计主线

HexGrid N41 起，Web 验收台必须把商业攻防放在回合审计主入口，而不是把它藏在 raw JSON 或低层调试字段里。

`/hex-lab/match` 至少要能按以下顺序解释一个 selected round / selected phase：

- 当前 round 小主题是什么。
- 守方自证是什么。
- 攻方质疑是什么。
- 当前 agent 的商业职责是什么。
- LLM 原始行动与规范化行动如何承载自证或质疑。
- 战斗裁判如何判定 `businessVerdict`。
- `businessReasons` 和 `csReasons` 分别是什么。
- killer / target / assister 如何从 combat trace 得出。
- 最终胜负为什么仍只来自 hard condition。

前端展示规则固定为：

- 可以组织和翻译已有 trace 事实，让用户更容易读懂。
- 不得重新计算 winner、AP、combat、KDA、C4 状态或 economy delta。
- 不得把 fallback / rejected 文本包装成正向商业证据。
- 不得把 raw JSON 当作主要验收入口；raw JSON 只能作为折叠排查层。
- 旧 trace 缺少 N41 字段时，页面应显示“当前 trace 未记录”，不能伪造 business story。

### 8.4 N42 Finance Major 裁判切换

N42 起，下一阶段候选主线是 Finance Major（金融投资对抗）。它保留 HexGrid 的 trace、combat、RoundReport、hard condition 和 Web 验收边界，但裁判主证据应从旧 business evidence（商业证据）切换为 finance evidence（金融研究证据）。

目标比例：

```text
financeScore：60-70%
executionScore：30-40%
```

financeScore 至少评估：

- 事实和材料引用质量。
- 行业假设是否清楚且可检验。
- 供需、价格、估值、风险和配置推导是否一致。
- 是否处理关键反证。
- 收益风险比是否清楚。
- 结论是否可执行。
- 攻方 challenge 是否击中守方核心假设。

executionScore 至少评估：

- agent 是否符合专家职责。
- action 是否围绕当前 round 子命题。
- 团队观点是否协同。
- 是否保留风险边界和修正路径。
- 是否仍满足 Hex action/path/AP 等运行事实。

Finance verdict 第一版建议：

```text
thesis_defended：守方投资主张守住。
challenge_landed：攻方反证挑战成立。
contested_no_finance_resolution：金融争点未决。
```

Finance Evidence MVP 第一版必须引入证据上限：

```text
没有国内库存，供需判断最高分受限。
没有 SHFE / SMM，国内价格判断最高分受限。
没有 CNINFO 页码，公司盈利传导最高分受限。
只有 BaoStock，不能证明行业基本面。
只有 FRED，不能证明中国国内有色供需。
只有 UN Comtrade，不能证明国内库存和利润传导。
```

裁判输出必须包含：

```text
submittedEvidenceIds
missingEvidence
scoreCaps
proxyFactWarning
```

当 evidence pack 只有 FRED + BaoStock + 可选 UN Comtrade 时，裁判只能评价“代理事实判断”，不能把结论写成完整中国有色基本面判断。

禁止：

- 不让 LLM 直接写 winner、kill、economyDelta 或 DB fact。
- 不用文风好坏决定胜负。
- 不把旧商业闭环词汇当作 finance evidence。
- 不把没有材料引用和可检验假设的宏大判断当强证据。
- 不让前端把金融解释改写成新的比赛事实。
- 不让代理事实冒充完整行业事实。

`Phase 2.0-pre` 对 judge 的要求不再是“写得像”，而是：

```text
会判、能证、可验。
```

只有当 judge 输出同时满足：

- 结构完整
- 胜负方式明确
- 商业攻防可解释
- 证据边界保守真实
- 前端可直接读懂

才算真正进入后续 `经济系统 + 击杀判断` 的增强阶段。

### 8.5 N53 金融证据采信链（N56 前旧 financeDuel 版本）

N53 起，Finance Major（金融投资对抗）的局部 combat 裁判不能只输出 `financeVerdict` 或 `financeReasons`。裁判必须把 evidence adoption（证据采信）写成 trace fact（轨迹事实），至少包含：

- `acceptedEvidenceRefs`：本次局部裁定正向采信的证据。
- `rejectedEvidenceRefs`：出现但未被采信的证据，例如不存在、不可用、越权、来自 fallback。
- `missingEvidenceApplied`：实际影响裁定的缺失证据。
- `scoreCapRefs`：触发降权或评分上限的证据边界。
- `financeReasonZh`：中文金融裁判理由。
- `csReasonZh`：中文 CS 执行理由。

固定规则：

- `challenge_landed` 必须能说明挑战方击中了哪条证据、假设或缺口。
- `thesis_defended` 必须能说明立场方用哪些证据、边界或风险承认守住挑战。
- 没有有效证据采信时，金融分必须被封顶或降权。
- fallback、invalid action、复述开局论点、行动理由明显超长，都不能形成正向金融证据。
- `configured_proxy_fact` 只能作为弱代理事实，并触发 score cap 或边界提示。
- `unavailable_observation` 不能被写成真实事实。
- Web 可以翻译和组织采信链，但不能替 trace 编造采信理由。

KDA / killLedger（击杀记录）仍只能消费 combat trace 中的 `killerAgentId / targetAgentId / assisterAgentIds`。金融采信可以解释局部击杀、压制、退让和控图的贡献，但不能写 hard winner（硬胜负）。

### 8.6 N55 真实 LLM 输出审计来源

N55 起，Web human audit（人类审计）必须区分“系统输入”和“agent 真实输出”：

- `roundOpeningBrief`、`agentOpeningBrief`、`agentEvidenceSlice` 都是系统输入卡，只能说明模型收到的上下文。
- 真实 agent 输出只能来自 `hex_llm_response` artifact 中的 `rawDraft / rawText / normalized / semanticLanguageAudit`。
- 没有 response artifact 时，Web 必须显示“没有真实模型输出”，不能用系统输入卡、fallback 文案或前端推断补写。
- 真实输出摘要可以做确定性微处理，例如提取行动、理由、风险、证据引用、修复、拒绝和采信状态。
- Web 不能调用新的 LLM 来总结 agent 输出，避免形成二次黑箱。
- raw JSON、artifact id、agent id、cell id 和英文枚举可以折叠保留，但不能作为主审计入口。

### 8.7 N55 / N58：phase0 真实输出审计

N55 收口修正后，审计链必须再往前推进一层；N58 后，这一层的当前主线是结构化 `stanceCard / challengeCard`，旧自然语言 `openingStatementZh` 只保留为兼容摘要：

- 每个新 round 都要记录 10 条 `roundStartAgentOutputs`。
- 这些输出是真实 phase0 结构化卡片，必须来源于 response artifact 或 fixture response。
- 立场方输出 `stanceCard`，挑战方输出 `challengeCard`；挑战方的 `targetClaimId` 必须来自已经校验通过的立场方 claimCatalog。
- `agentOpeningBrief`、`agentEvidenceSlice` 只能作为生成 phase0 输出的系统输入材料，不能在主视图里冒充“本局观点”。

Web human audit 的默认解释顺序必须是：

```text
本局真实结构化立场卡 / 挑战卡
-> phase1+ 行动如何引用 claimId / challengeId
-> 金融裁判采信 / 未采信 / 缺失证据
-> CS 执行理由
-> hard winner
-> 系统输入卡（折叠）
-> 技术细节（折叠）
```

审计硬规则：

- 如果某名 agent 没有 `roundStartAgentOutput` response artifact，主视图必须显示“本局没有真实 phase0 结构化卡片”，不能用系统输入卡、fallback 文案或 phase 行动摘要补写。
- 如果 `roundStartAgentOutput` 的 `source` 是 `provider_error` 或 `invalid_response`，或其 `usableForPhaseAction` 为 false，Web 必须把它显示为“phase0 卡片失败”，不能计入“真实 phase0 卡片”成功数。
- 非法 `evidenceRefs` 必须作为失败原因展示；Web 可以翻译错误原因，但不能删除失败痕迹或把非法引用当作可采信证据。
- 非法 `direction`、缺失 `reasoningBridge`、缺失 `evidenceRefs`、非法 `targetClaimId` 都必须作为失败原因展示；Web 不能用旧自然语言摘要补成成功卡片。
- phase1+ 行动必须能追溯 `roundStartOutputId`；缺失或错写的修复只能指向当前 agent 自己的开局输出，并且要保留：
  - `repaired_missing_roundStartOutputId`
  - `repaired_invalid_roundStartOutputId`
- phase1+ 如果引用 phase0 金融材料，还必须能追溯 `phase0RefId`；错写时只能在唯一可修复时修到当前 agent 自己的合法 `claimId / challengeId`，并记录 `repaired_invalid_phase0_ref`。
- 如果当前 agent 没有可消费 `roundStartAgentOutput`，phase1+ 不得把失败输出、系统输入卡或 fallback 文案绑定成 `roundStartOutputId`。
- phase1+ 如果大段复述 phase0 输出，必须在审计中显示 `phase_repeated_round_thesis`，并明确这是被拒绝或降级的原因，而不是“更完整的 agent 发言”。
- 系统输入卡在主视图必须明确标注“非 agent 输出”，避免再次把输入材料和真实输出混淆。

### 8.8 N56-N61 Finance Major 证据绑定裁判

当前实现状态：N56 已完成第一版，决策题、允许立场、必需证据结构和挑战规则已经进入材料、finance duel、prompt 和 Web 审计；N58 已提供结构化 `stanceCard / challengeCard`；N59 已完成第一版证据绑定裁判，能够输出 accepted / rejected / missing / scoreCaps、stanceScore / challengeScore、financialResult 和 combatEffectAllowed。N60 已完成第一版：金融结果只通过 `financeProjection` 受限投影接口影响战斗解释，不能重新读取金融作文分。

N56 起，Finance Major 的金融层不再使用“守方自证 / 攻方质疑”作为当前主语。CS 层仍可使用 attack / defense，金融层必须使用：

- `stance side`：提出投资立场。
- `challenge side`：挑战具体主张。
- `claim`：可被证据支持或反驳的主张。
- `evidence`：系统事实库中的证据。
- `reasoningBridge`：证据到结论的推理桥。

金融裁判必须遵守以下硬规则：

```text
没有 acceptedEvidenceRefs，不能判金融胜利。
missingEvidence 只能降权、限制置信度或限制战斗投影，不能直接赢。
不存在的 evidence id 让对应 claim 无效。
代理事实过度外推必须进入 rejectedEvidenceRefs。
数据不足不能作为正向事实。
```

金融裁判输出至少包含：

```text
acceptedEvidenceRefs
rejectedEvidenceRefs
missingEvidenceApplied
scoreCaps
acceptedClaims
rejectedClaims
acceptedChallenges
rejectedChallenges
stanceScore
challengeScore
financialResult
combatEffectAllowed
auditReasons
```

`financialResult` 第一版建议只允许：

```text
stance_survives
challenge_breaks_stance
contested
no_financial_win_allowed
```

`combatEffectAllowed` 第一版建议只允许：

```text
no_effect
minor_delay
pressure
force_reposition
map_control
possible_kill
```

N59 已落实的硬门槛：`finance_intent_present`、`businessIntent`、`actionRationaleZh` 和系统角色任务不能形成正向金融胜负；没有 accepted evidence 时，金融层只能输出 `no_financial_win_allowed` 或 `contested`。

fork-p1-finance-judge-balance 追加硬约束：

```text
claimType 只允许在明确白名单内做安全同义归一，归一结果必须写入 auditReasons。
scoreCaps 必须作用到最终 stanceScore / challengeScore，不能只作为审计装饰。
missingEvidence-only challenge 只能触发降权、score cap 或投影限制，不能形成 challenge_breaks_stance。
stance_survives / challenge_breaks_stance 必须基于封顶后的分数差，且分差至少 15。
challenge_breaks_stance 必须有 accepted challenge evidence；只指出 requiredEvidenceSchema 缺口不算采信证据。
```

该补丁只调整 N59 裁判平衡，不改变 N58 卡片生成、不改变 N60 战斗投影接口、不绕过 P0 round 质量闸门。

N60 已落实的边界：金融结果与 combat projection（战斗投影）必须解耦。Combat resolver 保留金融分作为审计字段，但 Finance Major 模式下 combat 总分不直接加入金融分；战斗裁定新增 `financeProjection`，记录 `financialResult`、`combatEffectAllowed`、`appliedEffect`、`blockedEffects`、中文投影原因，以及金融是否可参与击杀解释：

- 金融无采信时，金融层不能放大 combat margin。
- 金融无采信时，金融层不能解释击杀、全歼或战斗胜负。
- CS 枪线、站位、目标暴露、人数和行动仍可独立产生击杀、受伤、压制或退让。
- 如果击杀由纯 CS 事实产生，Web 审计必须显示为 CS 执行结果，不能包装成金融胜利。
- possible_kill 只是解释权限，不是击杀事实；仍必须先通过 CS 致命接触和 casualty 生成。

Web 可以组织和翻译裁判链路，但不能替 trace 编造 accepted evidence、rejected evidence、score cap 或 financialResult。

### 8.9 fork-p0-round-quality-gate：Round 质量闸门

N61 后真实 map 样本暴露出新的 P0 风险：当 provider 断线、phase0 结构化卡片不可消费、phase action 大面积 fallback 时，系统不能继续把 timeout、no plant 或 elimination 包装成正常比赛结果。

质量闸门固定为 trace 事实，而不是 Web 文案：

- `roundQualityStatus` 只能是 `valid`、`provider_degraded` 或 `invalid_round`。
- `roundQualityReasons` 必须记录触发原因，例如 `phase0_stance_insufficient`、`phase0_challenge_insufficient`、`no_usable_phase0`、`phase_action_provider_failed`、`phase_action_degraded`、`provider_error_threshold_exceeded`、`action_fallback_threshold_exceeded`。
- `roundQualityCounts` 必须记录 phase0 可消费数、provider error 数、invalid 数、fallback 数、最大 phase fallback 和连续降级 phase 数。
- `invalid_round` 必须保留 trace、artifact、已完成 phase 和错误原因，但不得作为正常 hard winner 或正式 map 计分样本展示。
- Web 和 N61 验收必须优先读取 `roundQualityStatus`；如果质量状态不是 `valid`，hard winner 只能进入技术细节，不能作为人类审计主结论。
- 旧 trace 没有质量闸门字段时，页面和脚本必须显示“旧 trace 未记录质量闸门”，不能假定它是有效 round。

第一版闸门只拦截明显坏样本，不修金融评分、战术重复、击杀归因或 combat 阈值。后续 P1/P2 fork 不能绕过该质量状态来包装失败样本。

P0/P1 合并修复后，提交层也必须遵守同一质量事实：

- `invalid_round` 可以保存 failed `Round` 和 `hex_round_trace` artifact，用于审计和排障。
- `invalid_round` 不生成 `RoundReport`，不写正常 `round_completed` / `hex_round_experimental_committed` 事件，不推进 map 分数、经济或 KDA。
- Web / map progress / N61 验收必须能读取没有 `RoundReport` 的 trace-only invalid round，并把它展示为“未通过质量闸门”，不能再显示成正常 timeout/no plant 或 elimination 胜负。
- map summary 中 `roundsCommitted` 只统计正常 committed round；invalid attempt 只能进入 invalid round 统计和 trace artifact 列表。
- 如果旧 trace 没有质量字段，只能标注旧 trace 缺字段，不能反推为 valid。
