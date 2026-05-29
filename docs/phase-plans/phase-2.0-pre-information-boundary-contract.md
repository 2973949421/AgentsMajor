# Phase 2.0-pre 信息边界硬约束

## 1. 定位

本文件冻结 `Phase 2.0-pre` 的信息可见边界，优先级高于早期文档中关于经济裁剪输入或暴露对手资源的旧表述。

核心结论固定为：

```text
双方赛前公开输入平等。
经济不裁剪公开输入。
经济只影响 RawOutput 经过 Output Gate 后能提交给 Judge 的 SubmittedOutput。
对手真实经济、买型、当前计划和输出内容不公开。
Judge 在结算层可以看双方提交后的有效事实和双方真实经济。
```

## 2. 三层信息模型

### 2.1 公开信息层

公开信息层会平等进入双方 `team_plan` 和 `agent_action` 的输入，不受经济状态影响。

公开信息包括：

- 当前地图、地图命题、回合子命题。
- 当前回合编号、比分、攻守方、上下半场状态。
- 公开 roster、选手位置、长期职责摘要。
- 双方公开的队伍母方案摘要和 initial proposal 公共摘要。
- 已提交回合的公开摘要、已落库裁判结论、公开高光标签。
- 已公开的 coach 赛后修正或 timeout 结果摘要。

公开信息不包括：

- 对手当前 `team_plan`。
- 对手主攻点、主防点、假打意图、转点意图。
- 对手 exact economy、buyType、outputBudget、spendBudget。
- 对手 `RawOutput`。
- 对手 `SubmittedOutput` 在裁判结算前的内容。

### 2.2 队内私有信息层

队内私有信息只进入本队，不进入对手 prompt。

队内私有信息包括：

- 己方当前 `team_plan`、己方 player directive、己方攻防布置。
- 己方 coach timeout / halftime / post-map 修正。
- 己方 exact economy、buyType、outputBudget、spendBudget。
- 己方 `RawOutput` 和经 Output Gate 后得到的己方 `SubmittedOutput`。

参赛队伍可以基于公开历史推测对手经济，但推测必须被标注为估计，不得当成事实输入。第一版实现可以不提供对手经济估计。

### 2.3 裁判结算层

Judge 在结算层可以看到：

- 公开信息层。
- 双方 `team_plan`。
- 双方 `SubmittedOutput`。
- 双方真实经济、buyType、outputBudget、spendBudget。
- 地图命题、裁判规程、回合子命题、攻守关系。

Judge 不得使用：

- 任一方 `RawOutput`。
- 被 Output Gate 裁剪掉的内容。
- 未落库的击杀链、秒级交火、具体投掷物落点或隐藏情报。
- 真实 API token 用量、供应商价格、模型档位或 `driverModelId` 差异。

## 3. 经济系统边界

经济系统的作用是制造有效提交差、文本火力差和论证完整度差，不制造赛前公开输入差。

因此：

- `RawOutput` 仍由真实 LLM 完整生成。
- `SubmittedOutput` 由 `buyType / outputBudget / Output Gate` 决定。
- Judge 原则上只把 `SubmittedOutput` 当成有效行动证据。
- 低经济方可以通过 eco / force buy / save 打出不确定性，但不能因为经济低而少看公开信息。
- 对手经济不是公开信息，只能从公开历史中估计。

## 4. `visibleContextBudget` 冻结口径

`visibleContextBudget` 在 `Phase 2.0-pre` 中冻结为历史兼容字段。

固定约束：

- 不得用它按经济裁剪双方共同的公开输入。
- 不得用它制造赛前公开输入差。
- 不得把它等同于真实 API 输入 token 上限。
- 当前经济闭环只使用 `outputBudget / spendBudget / SubmittedOutput`。

如果后续重新启用 `visibleContextBudget`，必须另写独立契约，先定义它影响的是哪一类非公开摘要，不能破坏本文件的公开输入平等原则。

## 5. 前端与调试层

前端、调试面板和 replay 可以在回合提交后展示双方经济、买型、输出裁剪比例和 LLM 调用明细。

但这些展示属于观赛 / 调试层，不代表参赛 agent 在生成本回合时可见这些信息，也不能回流成下一次 prompt 的隐藏事实。

## 6. 验收口径

任何 Phase 2.0-pre 后续计划、prompt 或实现，如果出现以下表述，都视为与本契约冲突：

- 经济系统制造赛前公开输入差。
- 经济决定 agent 能看到多少公开上下文。
- 低经济方在开局前少看地图命题、比分、攻守方或公开历史。
- 参赛方直接知道对手 exact economy / buyType / outputBudget。
- Judge 使用 `RawOutput` 或被裁剪掉的内容判胜负。
