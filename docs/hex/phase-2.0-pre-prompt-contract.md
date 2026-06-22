# Phase 2.0-pre Prompt Contract

## 1. 定位

本文档是 `Phase 2.0-pre` 的 prompt 总契约，当前版本固定为：

```text
phase20pre-prompt-contract-v6
```

本版本的重点是稳定长 RawOutput 之后的裁判与战斗链路：`agent_action` 继续使用结构化 RawOutput；`judge` 拆成 `judge_verdict` 与 `judge_narrative`；`judge_verdict` 必须先按代码生成的 `rubricProfile` 输出 `judgeScorecard`，再锁定 verdict；默认战斗事实由代码生成和校验，`combat_resolution` 只作为显式 opt-in 的受限草案增强层。

## 2. 全局硬规则

- 所有任务只能输出严格合法 JSON，不输出 markdown、代码块、解释或 JSON 外文本。
- 除 `BO3`、`MVP`、schema 字段名、地图名、队伍名、选手名等必要英文外，自然语言默认中文。
- 双方公开输入平等；经济不裁剪公开输入，只能影响 Output Gate 后提交给 Judge 的 `SubmittedOutput`。
- 参赛方只能知道己方真实经济、己方买型和己方计划；对手真实经济、买型、当前计划、主攻/主防点和输出内容都不是公开输入。
- 前端、replay、调试面板中的赛后展示不能回流成参赛 agent 当前回合可见的隐藏事实。
- `agent_action` 是计划性行动，不是 combat ledger；不得写成已经发生击杀、清点完成、封锁回防或补枪残局。

## 3. 输出长度目标

| 任务 | 目标 outputTokens | 用途 |
| --- | ---: | --- |
| `agent_action` | 300-500 | 单名选手结构化 RawOutput；每个自然语言字段限 1-2 句，避免长 JSON 截断。 |
| `team_plan` | 650-950 | 队伍当前回合计划。 |
| `judge_verdict` | 750-1100 | 评分表 + 短结构裁决，锁定 scorecard、胜方、败方、胜法、MVP、区域关系和 diagnostic。 |
| `judge_narrative` | 450-850 | 基于已锁定 verdict 生成中文判词和 `judgeInference`，不得改变 verdict 事实。 |
| `judge_review` | 500-1000 | 可疑裁判结果复核。 |
| `combat_resolution` | 600-1100 | 显式 opt-in 的受限战斗草案；代码 validator 通过后才可能成为最终 combat facts。 |
| `coach_timeout` | 500-900 | 暂停窗口的下一回合修正单。 |
| `coach_post_match_review` | 900-1600 | 图后或 BO3 后复盘补丁。 |

这些长度是 RawOutput 质量目标，不是经济预算实装。经济系统后续通过 Output Gate 裁剪 `RawOutput -> SubmittedOutput`。

## 4. 任务契约

| 任务 | 必须输出 | 禁止行为 |
| --- | --- | --- |
| `team_plan` | `teamId / side / primaryIntent / primaryZoneId / coordinationSummary / playerDirectives / winCondition / risk / confidence` | 发明第二套总方案、读取对手真实经济、把 coach 当赛前总纲作者。 |
| `agent_action` | `roundObjective / executionPlan / coordinationPlan / roleResponsibilityUsage / riskRead / contingencyPlan / expectedContribution / confidence` | 输出短句 `action`、写已发生结果、重写整队方案、读取对手隐藏信息。 |
| `judge_verdict` | `winnerTeamId / loserTeamId / margin / roundWinType / attackWinConditionMet / defenseWinConditionMet / mvpAgentId / confidence / judgeScorecard / diagnostic` | 写长判词、输出 `reason`、输出 `judgeInference`、跳过 `zoneRelation`、自造评分维度。 |
| `judge_narrative` | `reason / judgeInference` | 改变 verdict 中的胜负、胜法、MVP、主攻区、主守区或 margin。 |
| `judge_review` | 修正后的完整 `JudgeResult` | 为保留原判而补故事，忽略败方胜利条件或失败原因。 |
| `combat_resolution` | `killEvents / plantEvent / defuseEvent / explosionEvent / survivors / openingDuel / tradeSequence / clutchTag / mvpEvidence` | 改变 `roundWinType`、让同一选手重复死亡、制造不成立的 `one_v_x`、写与胜法矛盾的爆弹事件。 |
| `coach_timeout` | 下一回合修正单和逐人调整 | 重写地图命题、重写队伍母方案、五人全部压成单点 all-in。 |
| `coach_post_match_review` | 下一场可采纳升级建议 | 改写已完成 BO3 事实，写成赛中指挥。 |

## 5. `agent_action` 新结构

新版 `AgentActionDecision` 固定包含：

- `roundObjective`：本回合目标，必须接回地图命题、队伍计划和自身职责。
- `executionPlan`：可执行路径、站位、节奏、观察、牵制或转点意图。
- `coordinationPlan`：与队友、`team_plan`、`playerDirective`、coach 修正的衔接。
- `roleResponsibilityUsage`：本行动具体使用了哪些长期职责。
- `riskRead`：风险、证据不足处或失败触发点。
- `contingencyPlan`：首选动作受阻后的修正方案。
- `expectedContribution`：如果执行正确，会给 Judge 提供什么可审计贡献。
- `confidence`：0 到 1 的数字。
- `fingerprint`：可选稳定短标记。

新生成回合不再把短句式 `action` 作为主事实。历史 replay 中旧 `action` 只做只读降级展示。

### 5.1 Hex N35 回合级商业攻防输入

HexGrid N35 起，`agent_action` 可以收到 round-level（回合级）`businessDuel` 和当前 agent 的 `businessAssignment`。

规则：

- `businessDuel` 每 round 只生成一次。
- Dust2 第一版一张地图固定 6 个小主题，上下半场复用同一组主题并攻防互换。
- `agent_action` 只能说明自己的 CS 行动如何承载当前自证/质疑职责。
- `agent_action` 不能新增、删除或改写 `defenseProof`、`attackChallenge`、`agentAssignments`、`subthemeId`、`teamId` 或 `agentId`。
- 如果输出中包含这些回合级字段，代码只能记录为 ignored/forbidden field（忽略/禁止字段），不能写入事实层。
- fallback 文本不能作为正向商业自证或质疑证据。

### 5.2 Hex N37 行动草案稳定识别

真实 LLM 的 `agent_action` 输出必须走稳定识别策略：

- 单元素 `actions[]` 可以被规范化为一个行动，并记录 `repaired_single_action_array`。
- 多元素 `actions[]` 不允许由代码任选其一，必须稳定拒绝并记录 `multiple_actions_not_allowed`。
- `phaseId / currentCellId` 这类代码已知上下文字段可安全修复，但必须记录 repair reason。
- `actionType / targetCellId / businessIntent` 仍严格校验；代码不能替模型补业务意图。
- 输出出现明显中文编码损坏时直接 fail，不做同义词猜测。
- 原始输出、规范化行动、修复字段、拒绝原因和 request / response artifact id 必须进入审计链。

### 5.3 Hex N39 紧凑请求与中文语义审计

HexGrid N39 起，真实 LLM 的 `agent_action` 不再直接接收完整 `HexAgentCommandRequest`。代码必须先生成 `compact_match` 请求，只把当前 agent 决策必要上下文发给模型。

紧凑请求必须保留：

- 当前 `phaseId / phaseIndex / phaseObjective`。
- 当前 agent 的 side、当前位置、AP、C4 携带状态。
- 当前 round 主题、当前金融任务摘要和该 agent 的职责摘要；N56 起应使用 decisionQuestion、stance / challenge 摘要，而不是旧自证 / 质疑主语。
- C4 状态、经济摘要、top-N 合法目标候选。
- friendly occupied / reserved cell 摘要。
- top-N `lastSeenEnemies`，且必须标注 lastSeen 是历史信息，不是当前真实位置。
- 输出 schema 摘要。

紧凑请求不得发送：

- 完整 `reachableCells` 大列表。
- 完整地图资产。
- 完整队伍材料。
- 与当前 agent 决策无关的长历史上下文。

审计要求：

- request artifact 必须同时保存 full request 和 compact request，便于对照。
- response artifact 必须记录 request size metrics。
- 如果 provider 返回 prompt token usage，必须写入审计。
- `businessIntent / tacticalIntent / riskNotes` 等自然语言语义字段必须中文优先。
- `agentId / phaseId / currentCellId / targetCellId / actionType` 等代码字段必须保持英文标识。
- 英文或中英混杂语义字段不直接当作中文事实，必须记录 `language_mismatch` audit。

### 5.4 N42 Finance Major prompt 切换（N56 前旧 financeDuel 版本）

N42 起，下一阶段候选主线是 Finance Major（金融投资对抗）原型。该原型复用 HexGrid 运行结构，但 prompt 语义必须从旧 business duel（商业攻防）切换到 finance duel（金融投资攻防）。

切换原则：

- 不把 finance prompt 写成旧 business prompt 的同义词替换。
- 不继续使用“闭环、信任、价值放大、执行力”这类泛商业模板作为主证据。
- 旧版本曾使用投资主张自证和反证挑战作为 financeDuel 主语。
- N56 起，金融层必须改成 stance side / challenge side：立场方提出投资判断，挑战方攻击具体 claim。
- agent 行动应承载专家职责、材料引用、假设、反证、风险边界或可执行结论。
- agent 只能使用 `roundEvidencePack` 中的 compact facts（短事实），不能自由引入新数字或外部网页内容。
- 核心金融结论必须引用 `evidence_id`；没有 `evidence_id` 的数字只能标记为证据不足，不能当作事实。
- JSON 字段名、`agentId`、`phaseId`、`cellId`、`actionType` 等代码标识仍保持英文。
- 自然语言语义字段默认中文。

Finance prompt 第一版应围绕：

```text
地图：Dust2 有色。
轮次：行业判断。
round：全球价格、市场反应、估值是否 price in、进出口线索、证据缺口、有限配置结论。
队伍：投资风格 + 行业理解 + 五专家 agent + coach。
```

第一版数据事实边界：

```text
自动源：FRED + BaoStock + 可选 UN Comtrade。
CNINFO、国家统计局、工信部、SHFE、SMM 等只作为后置证据锚点或商业化替换源。
prompt 不能把代理事实写成完整中国有色行业判断。
prompt 必须传入 missingEvidence 和 scoreCaps，让 agent 明确哪些结论不能下。
```

短期兼容：

- 底层仍可暂时保留 `businessIntent` 字段名以减少 schema 震荡。
- 但 prompt 文案和审计语义必须标注为 finance / investment intent。
- 后续应通过 adapter 迁移到 `financeIntent` 或 `investmentIntent`，不能让旧商业底色继续污染新样本。

### 5.5 N45 Finance Duel Runtime prompt 接入（N56 前兼容）

N45 起，Hex real provider 的 `compact_match` 请求必须优先消费 `financeDuel`。

N45 版本的 `financeDuel` 至少包含：

- round 小主题。
- 当前守方 `defenseThesis`。
- 当前攻方 `attackChallenge`。
- 当前 agent 的 `financeAssignment`。
- `promptFacts`、`missingEvidence`、`scoreCaps`。

兼容规则：

- `businessIntent` 仍可作为行动草案字段名存在。
- 当请求包含 `financeDuel` 时，`businessIntent` 的语义必须解释金融投资自证 / 质疑如何通过本次 CS 行动承载。
- compact request 不应同时把旧 `businessDuel` 作为主语义发送给模型。
- 模型不能新增事实、不能补全缺失数据、不能把代理事实写成完整行业判断。

N56 起，新的 real provider prompt 不应继续把 `defenseThesis / attackChallenge` 作为金融层主语。兼容字段可以暂留，但 prompt 语义必须转为：

```text
decisionQuestion
stanceCard / challengeCard
claimId / challengeId
accepted / rejected / missing / score cap
```

### 5.6 N49 回合信息层 / 局内行动层拆分

N49 起，Hex 金融对抗的 `agent_action` 必须区分两层：

```text
回合信息层：roundOpeningBrief / agentOpeningBrief
局内行动层：当前 phase 的行动草案
```

`roundOpeningBrief` 第一版由系统确定性生成，不新增额外 LLM 调用。N56 前来源只能是：

- `financeDuel.topic`
- `financeDuel.defenseThesis`
- `financeDuel.attackChallenge`
- `financeDuel.agentAssignments`
- `agentEvidenceSlice`
- `economyContext`
- agent role / team / side

每名 agent 的 `agentOpeningBrief` 必须包含：

- 本 round 金融职责。
- 专家角色：PM / Macro / Commodity / Company / Risk。
- `sliceId` 和当前 agent 的证据切片摘要。
- `roleQuestionZh`：该专家本局要回答的问题。
- `usableFactsZh` 和 `evidenceRefs`：可用事实和证据引用。
- 自证或质疑摘要。
- 证据边界。
- 按经济买型裁剪后的行动约束。
- 局内行动提示。

局内 `agent_action` 不再负责重写完整 `financeDuel`。它只能输出：

- `actionType`
- `targetCellId`
- `businessIntent`：兼容字段名，只表示本阶段行动理由。
- 可选 `briefRefId`
- 可选 `actionRationaleZh`
- 可选 `tacticalIntent / riskNotes / confidence`

当请求包含 `agentOpeningBrief` 时：

- `businessIntent` 必须引用该信息卡的任务、证据边界或行动约束。
- 不得重新生成完整守方自证、攻方质疑或全局金融论文。
- 不得引用不属于该 agent 的证据切片来伪造专家差异。
- 如果模型在 phase 内大段复述开局信息，代码必须记录 `phase_repeated_round_thesis` 审计警告。

### 5.7 N51 专家证据切片

N51 起，`agentOpeningBrief` 不能只复制 team thesis。每个 round 必须先生成 10 份 `agentEvidenceSlice`：

```text
PM / IGL：配置强度、风险收益、组合观点。
Macro / AWPer：FRED 全球金属价格、宏观和周期锚。
Commodity / entry：供需、品种、UN Comtrade 贸易线索或 unavailable observation。
Company / star rifler：BaoStock 公司行情、估值代理和市场反应。
Risk / support：missingEvidence、scoreCaps、反证、止损和仓位降级。
```

约束：

- `financeRole` 不得默认为 `unknown`；无法从 team asset 解析时，必须用 CS role 或 roster slot fallback，并记录 `roleFallbackReason`。
- 同队 5 张信息卡的 `roleQuestionZh / usableFactsZh / evidenceRefs` 不应完全相同。
- AKShare 是可用采集入口；通过它取得的 SHFE / INE / GFEX 等数据可以进入事实切片，但必须保留 sourcePublisher、accessProvider、collector、endpoint 和字段口径。
- fact bank 不完整时，必须显示 missing evidence 和 score cap，不能让 LLM 补事实。

审计展示规则：

- Web 主审计默认展示中文人类投影，不直接展示 raw enum、agentId、cellId 或 artifactId。
- 技术字段必须完整保留在折叠的“技术细节”中。
- 未识别 reason 不允许静默丢弃，必须显示为“未翻译技术原因”并保留原文。

### 5.8 N52 回合信息层 / 局内行动层硬隔离

N52 起，`agent_action` 的 compact request 必须把金融观点层和局内行动层硬隔离。

真实 provider 发送的 compact request 不得携带完整 `financeDuel.defenseThesis.thesis`、`financeDuel.attackChallenge.thesis` 或长 claims / challenge points。完整请求仍可保存在 request artifact 中用于审计和调试，但不能作为 real provider 的主输入。

compact request 只允许发送：

- 当前局势、`phaseId`、当前位置、AP、C4、lastSeen、targetCandidates、occupied / reserved cells。
- 当前 agent 的 `agentOpeningBrief` 和 `agentEvidenceSlice` 摘要。
- round 小主题标题和极短侧向目标。

当存在 `agentOpeningBrief` 时，输出契约为：

- `briefRefId` 等价于必填。
- 缺失 `briefRefId` 时，代码只能修正为当前 agent 自己的 `briefId`，并记录 `repaired_missing_briefRefId`。
- 错写为其他 agent 或不存在的 `briefRefId` 时，代码只能修正为当前 agent 自己的 `briefId`，并记录 `repaired_invalid_briefRefId`。
- `businessIntent` 只是 legacy 字段名，只能表示本阶段行动理由。
- `actionRationaleZh` 是优先展示的中文阶段行动理由。

阶段行动输出不得重新写完整金融论文：

- 如果 `businessIntent / actionRationaleZh` 大段复述开局自证、质疑、角色问题、证据边界或可用事实，必须记录 `phase_repeated_round_thesis` 并拒绝草案。
- 如果行动理由明显超长，必须记录 `phase_action_reason_too_long` 并拒绝草案。
- 短句引用开局信息卡允许通过；完整复述不允许通过。

Web 审计默认展示中文行动摘要：

```text
行动 -> 目标 -> 引用哪张开局信息卡 -> 简短行动理由 -> 修复 / 拒绝 / 降级原因
```

raw `briefRefId`、`agentId`、`cellId`、artifact id 和英文枚举仍必须保留在技术细节中，不能为了中文展示而删除审计事实。

### 5.9 N55 收口修正：phase0 真实开局输出层

N55 收口修正起，Hex 金融对抗必须显式区分：

```text
phase0 / round-start：真实开局输出层
phase1+：局内行动层
```

固定规则：

- 每个新 round 开始前，10 名 agent 都必须各生成一次 `roundStartAgentOutput`。
- `roundStartAgentOutput` 必须来自真实 response artifact 或 fixture response，不能由 `agentOpeningBrief`、`agentEvidenceSlice` 或 Web 摘要冒充。
- `agentOpeningBrief` 继续存在，但它只作为系统输入卡，用来提示 phase0 模型生成本局开局输出。
- `roundStartAgentOutput` 只有在 `source` 为 `llm_response_artifact` 或 `fixture_response`、存在成功响应、结构校验通过、证据引用合法时，才允许进入后续 phase action。
- `provider_error`、`invalid_response`、非法 `evidenceRefs` 或 normalization / validation 失败的开局输出只能作为失败审计保存，不得进入 compact request，也不得计入“真实开局输出”成功数。
- `evidenceRefs` 必须来自当前 agent 系统输入卡的证据白名单；模型编造的证据编号必须记录 `rejected_invalid_round_start_evidence_ref` 或等价错误，并使该开局输出不可消费。
- N58 起，`roundStartAgentOutput` 当前主线必须包含：
  - `cardKind`
  - `stanceCard` 或 `challengeCard`
  - `cardSummaryZh`
  - `allowedPhaseRefs`
  - `evidenceRefs`
  - `riskBoundaryZh`
  - `buyConstraintAppliedZh`
  - `phaseActionCarryoverZh`
- `openingStatementZh` 保留为旧 trace / Web 兼容摘要字段，不能再作为 N58 的主要输出契约。
- `stanceCard / challengeCard` 是本局真实 phase0 投资卡片，不是局内行动，也不能输出地图 cell、击杀、胜负或经济变化。

后续 phase 的 `agent_action` compact request 只允许发送：

- 当前局势。
- 当前 agent 自己的 `roundStartAgentOutput` 摘要。
- 极短的 round 主题提示。

后续 phase 不得重新生成完整金融论文：

- 如果 `businessIntent / actionRationaleZh` 大段复述 `roundStartAgentOutput`，必须记录 `phase_repeated_round_thesis` 并拒绝或降级。
- 当 `roundStartAgentOutput` 存在时，阶段行动必须带 `roundStartOutputId`。
- 缺失或错写 `roundStartOutputId` 时，只能修复为当前 agent 自己的输出，并记录：
  - `repaired_missing_roundStartOutputId`
  - `repaired_invalid_roundStartOutputId`

审计层口径固定为：

- phase0 主视图展示“本局真实结构化立场卡 / 挑战卡”。
- `agentOpeningBrief` 只能显示为“系统输入卡（非 agent 输出）”。
- 没有 round-start response artifact 时，不得用系统输入卡、fallback 文案或 Web 文案伪装成 agent 已输出。

### 5.10 N55 后窄修：phase0 材料依据与 phase1+ 局内行动胜负欲

N55 后的 combat 窄修固定两层分工：

```text
phase0 / roundStartAgentOutput：本局材料依据，包含资产、证据、角色判断、风险边界和经济买型裁剪。
phase1+ / agent_action：局内行动执行，包含清点、抢枪线、补枪、换人、护包、拆包、转点、保枪和风险处理。
```

阶段行动提示词必须满足：

- 可以短句引用 `roundStartAgentOutput`，但不得复述或重写完整金融材料。
- `businessIntent` 仍是兼容字段名，只表示本阶段行动理由。
- `actionRationaleZh` 必须解释行动如何服务赢回合，而不是抽象“完成验证”。
- 当目标进入包点入口、开阔枪线、下包 / 拆包附近或已知敌人接近时，输出应说明如何清点、抢枪线、补枪、换人、护包、拆包或退让。
- LLM 仍不得写 winner、kill、damage、economyDelta、hidden enemy truth 或 DB fact。

事实边界固定为：

```text
Prompt 负责行动意图与胜负欲表达。
Combat code 负责枪线暴露、掩体阻断、隐式交火、致命门槛和伤亡事实。
前端只能展示 trace，不得补写战斗结果。
```

### 5.11 N56 证据绑定投资决策 prompt

N56 起，Finance Major prompt 的主目标从“证明 / 反驳”改为“投资决策与挑战”。N56 只要求模型输入包含机器可校验的题目契约，不要求本轮直接完成 N58 的结构化卡片。

N56 的 phase0 request 必须包含：

```text
decisionQuestion：本 round 投资决策题。
allowedStance：看多、看空、中性、结构性分化、条件方向或暂不交易。
requiredEvidenceSchema：本题必需证据、最低事实数、优先源、fallback 和缺失影响。
challengePolicy：挑战必须攻击具体 claim、证据缺口、代理错配、时间窗口、推理桥或风险收益；缺失证据只能降权。
```

N58 起，phase0 才升级为结构化卡片：

```text
stanceCard：立场方输出，包含 direction、target、horizon、confidence、positionSuggestion、coreClaims、evidenceRefs、reasoningBridge、riskBoundaries、invalidatingConditions。
challengeCard：挑战方输出，包含 targetClaimId、challengeType、challengedAssumption、evidenceRefs、proxyMismatch、confidenceReduction。
```

N56 的 phase1+ 已经只能引用当前 agent 自己的 phase0 输出摘要和当前局势。N58 起，phase1+ 进一步只能引用：

```text
claimId
challengeId
当前 agent 自己的 phase0 输出摘要
当前局势、目标点位、风险和 CS 行动理由
```

行动输出如果引用 phase0 金融材料，必须通过 `phase0RefId` 指向当前 agent 自己卡片中的 `claimId` 或 `challengeId`。错写时只能在唯一可修复的情况下修到当前 agent 自己的合法引用，并记录 `repaired_invalid_phase0_ref`；不能修到其他 agent 的 claim / challenge。

phase1+ 禁止：

```text
新增投资立场。
新增 evidence。
重写完整金融论文。
把 missingEvidence 当作正向事实。
把无 accepted evidence 的局部结果包装成金融胜利。
```

prompt 必须明确：缺失证据只能限制结论、降低置信度或限制战斗投影，不能直接成为获胜理由。

### 5.12 N61 后行动急迫感与 phaseClock 补丁

N61 后真实 map 审计发现：provider、phase0 和 action 都正常时，agent 仍可能在有限 phase 内持续写“为后续准备”、C4 折返、不下包、不主动处理枪线，最终 timeout。该问题属于局内行动约束，不属于金融裁判或 hard winner。

`agent_action` compact request 必须包含 `phaseClock`：

```text
totalPhases
phaseNumber
remainingPhases
isFinalPhase
urgencyLevel
clockPressureZh
```

`phaseClock` 只能表达阶段预算和硬条件风险，不能写成“固定第几个 phase 必须决胜负”。最后阶段 attack 未下包时，prompt 必须明确不能继续写“为后续下包 / 后续决策创造空间”，应选择下包、包点执行、主动对枪换人、保枪或说明无法执行。defense 在最后阶段应阻止最后下包路线；已下包时应 retake / defuse。

阶段行动边界补充：

```text
C4 carrier 在中后期应向合法包点或包点路径收敛。
同一 round 内重复旧 cell / region / point 会进入路线候选降权。
进入长门、包点入口、开阔枪线、已知敌人接近、下包 / 拆包附近时，不应只写 move。
必要时 normalizer 可以把 move 安全修复为 plant_bomb、defuse_bomb、retake、execute_site、seek_duel 或 peek，并记录 repairedFields。
```

仍然禁止：

```text
LLM 写 winner / kill / damage / economyDelta。
前端补战斗事实。
为了急迫感降低 combat lethal gate 或伪造 plant。
```
## 6. Judge Scorecard v6

`judge_verdict` 必须输出 `judgeScorecard`。评分标准由代码生成并写入输入中的 `rubricProfile`，LLM 只能消费，不能修改。

固定评分根基为 7 维：

- `objectiveScore`
- `mapControlScore`
- `submissionQualityScore`
- `coordinationScore`
- `economyAdjustedScore`
- `riskControlScore`
- `proofScore`

地图和回合差异只能通过 `rubricProfile.dimensionWeights / mapAdjustment / roundAdjustment / evidenceRequirements` 表达。`winnerTeamId` 必须等于 `judgeScorecard.winnerFromScore`，`margin` 必须等于 `judgeScorecard.marginFromScore`。

禁止项：

- 不允许因为防守方写了 `defendedCoreProposition` 就天然判防守胜。
- 不允许把历史连胜、比分领先、节目效果或追分需求写成评分证据。
- 不允许读取 RawOutput 或 omittedFields。

## 7. 审计要求

- 新 LLM call 必须记录 `promptContractId = phase20pre-prompt-contract-v6`。
- `promptHash` 必须纳入 `promptContractId`，避免不同契约版本共用 hash。
- `simulation_runs.promptContractId` 必须锁定创建 run 时的契约版本；旧契约或混合契约 run 只能阅读，不能继续生成。
- Judge 默认只消费第一版 Output Gate 后的 `SubmittedOutput`；完整 `RawOutput` 只保留给审计和调试层。
- 本轮已接入最小 Output Gate，但不改经济结算和胜负权重。

## 7. v5 运行链路

v5 的真实回合调用顺序固定为：

```text
team_plan x2
agent_action x10
judge_verdict x1
judge_narrative x1
```

默认每回合约 14 次真实 LLM 调用。`judge_verdict` 是权威结构，`judge_narrative` 只能解释它。战斗事实默认由 deterministic resolver 生成并校验，避免 `combat_resolution` 每回合失败拖垮真实 run。

`combat_resolution` 仍保留为显式 opt-in 增强层，不是最终事实源；代码必须校验胜法、生死、重复死亡、存活列表、爆弹事件、区域、`clutchTag` 和 MVP 击杀上限。草案不合法时直接回退 deterministic resolver，round 不应因此失败。
