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
