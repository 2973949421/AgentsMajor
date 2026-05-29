# Phase 2.0-pre Prompt Contract

## 1. 定位

本文档是 `Phase 2.0-pre` 的 prompt 总契约，当前版本固定为：

```text
phase20pre-prompt-contract-v2
```

本版本的重点是修复真实 LLM 输出过短的问题：`agent_action` 不再输出单句 `action`，而是输出结构化 RawOutput，供 Judge、RoundReport、证据链和后续 Output Gate 使用。

## 2. 全局硬规则

- 所有任务只能输出严格合法 JSON，不输出 markdown、代码块、解释或 JSON 外文本。
- 除 `BO3`、`MVP`、schema 字段名、地图名、队伍名、选手名等必要英文外，自然语言默认中文。
- 双方公开输入平等；经济不裁剪公开输入，只能影响未来 Output Gate 后提交给 Judge 的 `SubmittedOutput`。
- 参赛方只能知道己方真实经济、己方买型和己方计划；对手真实经济、买型、当前计划、主攻/主防点和输出内容都不是公开输入。
- 前端、replay、调试面板中的赛后展示不能回流成参赛 agent 当前回合可见的隐藏事实。
- `agent_action` 是计划性行动，不是 combat ledger；不得写成已经发生击杀、清点完成、封锁回防或补枪残局。

## 3. 输出长度目标

| 任务 | 目标 outputTokens | 用途 |
| --- | ---: | --- |
| `agent_action` | 300-500 | 单名选手结构化 RawOutput；每个自然语言字段限 1-2 句，避免长 JSON 截断。 |
| `team_plan` | 650-950 | 队伍当前回合计划。 |
| `judge` | 750-1200 | 单回合裁判判词和审计诊断。 |
| `judge_review` | 500-1000 | 可疑裁判结果复核。 |
| `coach_timeout` | 500-900 | 暂停窗口的下一回合修正单。 |
| `coach_post_match_review` | 900-1600 | 图后或 BO3 后复盘补丁。 |

这些长度是 RawOutput 质量目标，不是经济预算实装。经济系统后续通过 Output Gate 裁剪 `RawOutput -> SubmittedOutput`。

## 4. 任务契约

| 任务 | 必须输出 | 禁止行为 |
| --- | --- | --- |
| `team_plan` | `teamId / side / primaryIntent / primaryZoneId / coordinationSummary / playerDirectives / winCondition / risk / confidence` | 发明第二套总方案、读取对手真实经济、把 coach 当赛前总纲作者。 |
| `agent_action` | `roundObjective / executionPlan / coordinationPlan / roleResponsibilityUsage / riskRead / contingencyPlan / expectedContribution / confidence` | 输出短句 `action`、写已发生结果、重写整队方案、读取对手隐藏信息。 |
| `judge` | `winnerTeamId / loserTeamId / margin / roundWinType / attackWinConditionMet / defenseWinConditionMet / reason / mvpAgentId / confidence / diagnostic` | 按名气、队名、比分、区域关系自动判胜；把 agent_action 当 combat ledger。 |
| `judge_review` | 修正后的完整 `JudgeResult` | 为保留原判而补故事，忽略败方胜利条件或失败原因。 |
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

## 6. 审计要求

- 新 LLM call 必须记录 `promptContractId = phase20pre-prompt-contract-v2`。
- `promptHash` 必须纳入 `promptContractId`，避免不同契约版本共用 hash。
- Judge 当前直接消费完整结构化 `agent_action`；等经济系统实装后，再改为只消费 Output Gate 后的 `SubmittedOutput`。
- 本轮不实装 Output Gate，不改经济结算，不改胜负逻辑。
