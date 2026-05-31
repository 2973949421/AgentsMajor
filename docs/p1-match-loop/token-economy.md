# P1.2 Token 经济说明（Token Economy Spec）

## 1. 文档定位

这份文档定义 Agent Major 的比赛内 Token 经济系统。它回答的问题是：

```text
谁拥有经济？
谁能购买装备？
经济如何影响本回合能提交多少有效输出？
Agent 之间如何 drop？
经济事件如何进入事件日志？
经济结果如何被 RoundReport、Judge、统计和转播消费？
```

P1.2 不定义真实 API 成本，不定义大模型供应商价格，也不决定 `driverModelId`。真实大模型调用完整生成，比赛经济只限制智能体（Agent）本回合能提交给裁判的有效内容。

## 2. 核心边界

### 2.1 Agent 级经济

Token 经济归属于单个智能体（Agent），不是队伍。

```text
Agent.tokenBank = 该智能体当前比赛内经济
团队经济（Team economy）= 队内所有 Agent tokenBank 的加总展示
```

团队经济只用于比分牌、数据面板、解说和统计，不是购买主体。购买类型（BuyType）、强起（Force Buy）、保经济（Save）、Drop 都是单个 Agent 的行为。

### 2.2 真实调用与比赛提交分离

真实大模型调用按完整任务生成 `RawOutput`。比赛经济不截断真实调用，而是通过输出闸门（Output Gate）裁剪出 `SubmittedOutput`。

```text
RawOutput:
真实 LLM 完整输出，本地临时保存，不直接作为比赛事实提交给 Judge。

SubmittedOutput:
根据本回合购买预算裁剪后的有效输出，进入 Judge、RoundReport、事件拆解和转播素材。
```

### 2.3 `visibleContextBudget` 兼容字段边界

`visibleContextBudget` 是历史兼容字段，不是真实 API 输入 token 限额。`Phase 2.0-pre` 不使用它按经济裁剪双方共同的公开输入。

```text
真实 API 输入 token：
工程成本和可观测性问题，由 LLM Driver / Observability 记录。

visibleContextBudget：
当前冻结为兼容字段，不参与经济闭环，不裁剪地图、比分、攻守方、公开历史、回合子命题等公开输入。

outputBudget：
Agent 本回合能提交给 Judge 的有效输出预算。
```

经济系统不制造赛前公开输入差；它只制造有效提交差、文本火力差和论证完整度差。真实供应商 token 限额、价格或模型上下文窗口不能混入比赛经济。

### 2.4 不进入经济系统的内容

以下内容不进入第一版比赛经济：

- 真实 API token 用量。
- 真实 API 价格。
- 模型供应商差异。
- `driverModelId` 切换。
- 模型档位（model tier）。

真实成本只进入可观测性与成本控制模块。

## 3. 经济常量

第一版采用可调默认值：

| 名称 | 代码名 | 默认值 | 说明 |
|---|---|---:|---|
| Agent 经济上限 | `agentTokenCap` | `16000` | 单个 Agent 最大 tokenBank。 |
| 地图初始经济 | `initialTokenBank` | `800` | 每个半场手枪局前每个 Agent 的初始经济。 |
| T 舒服 AK 线 | `tComfortRifleMin` | `4800` | T 方标准长枪舒适线。 |
| CT 舒服 M4 线 | `ctComfortRifleMin` | `5500` | CT 方标准长枪舒适线。 |
| T AWP 线 | `tAwpMin` | `6500` | T 方不难受 AWP 线。 |
| CT AWP 线 | `ctAwpMin` | `7000` | CT 方不难受 AWP 线。 |
| Coach 暂停成本 | `coachTimeoutCost` | `2500` | 触发 Coach 暂停时的比赛内经济成本。 |
| 输出偏差 | `outputBudgetDeviation` | `10%` | SubmittedOutput 与预算的允许偏差。 |

说明：

- 数值是第一版平衡默认值。
- 后续可以通过平衡文档调整。
- 修改数值不应改变 `EconomyState`、事件或 `RoundReport` 的结构。

## 4. 经济状态（EconomyState）

`EconomyState` 表示某个 Agent 在某张地图或某个回合前后的比赛内经济状态。

核心字段：

| 中文字段 | 代码字段 | 类型草案 | 必填 | 说明 |
|---|---|---|---|---|
| 经济状态 ID | `id` | `string` | 是 | 稳定引用 ID。 |
| 智能体 ID | `agentId` | `string` | 是 | 指向 Agent。 |
| 队伍 ID | `teamId` | `string` | 是 | 用于聚合团队经济。 |
| 地图局 ID | `mapGameId` | `string` | 是 | 指向 MapGame。 |
| 回合 ID | `roundId` | `string` | 否 | 可表示某回合前后状态。 |
| token 银行 | `tokenBank` | `number` | 是 | Agent 当前比赛内经济。 |
| 购买类型 | `buyType` | `BuyType` | 是 | fullBuy、halfBuy、eco、forceBuy、save。 |
| 连败次数 | `lossStreak` | `number` | 否 | 历史兼容字段。 |
| CS2 loss count | `lossCount` | `number` | 是 | 当前半场从 `1` 开始；输 `+1`、赢 `-1`，范围 `0-4`。 |
| 可用暂停数 | `timeoutsRemaining` | `number` | 是 | Coach 相关资源。 |
| 兼容上下文字段 | `visibleContextBudget` | `number` | 否 | Phase 2.0-pre 兼容保留，不参与当前经济闭环，不裁剪公开输入。 |
| 输出预算 | `outputBudget` | `number` | 否 | 本回合 SubmittedOutput 预算。 |
| 创建时间 | `createdAt` | `string` | 是 | ISO 时间字符串。 |

约束：

- `tokenBank <= agentTokenCap`。
- `tokenBank` 不能为负。
- `EconomyState` 不保存真实 API 成本。
- `EconomyState` 不决定切换哪个 `driverModelId`。

## 5. 购买类型（BuyType）

### 5.1 Full Buy

触发条件：

```text
达到本侧舒服长枪线，且不是 bonus / broken buy / save 等上下文态势
```

行为：

- 允许高比例 SubmittedOutput。
- 默认提交 80%-100%。
- 优先使用 `multi_slice`。
- 适合 star_rifler、awper、带 closer 副标签的关键回合角色。

### 5.2 Half Buy

触发条件：

```text
当前回合可形成战斗力，但仍需为下一回合留钱；通常落在 T 2500-4000、CT 2800-4000 一带
```

行为：

- 默认提交 40%-60%。
- 优先使用 `core_window`。
- 能保留核心论点，但可能缺少铺垫或补充论据。

### 5.3 Eco

触发条件：

```text
现金不足以形成完整长枪，或策略上主动放弃完整输出
```

行为：

- 默认提交 15%-25%。
- 优先使用 `random_window`。
- 允许内容残缺。
- 如果 Eco Agent 赢下关键回合，可成为高光候选。

### 5.4 Force Buy

触发条件：

```text
未达到本侧舒服长枪线，且 Agent 主动投入大部分或全部当前经济去抢当前回合
```

行为：

- 花光或接近花光当前 `tokenBank`。
- 按预算尽量多截取 SubmittedOutput。
- 默认使用 `random_window` 或 `multi_slice_lite`。
- 即使花光经济，未达到 full buy 门槛时仍可能丢失关键段。

### 5.5 Save

触发条件：

```text
Agent 主动低消耗，保留经济到后续回合
```

行为：

- 默认提交 5%-10%。
- 优先使用 `front_cut` 或 `random_window`。
- 只花极少预算。
- 回合结束后保留经济优势。

补充硬约束：

```text
save_play 只能由明确保枪、明确省钱、上回合已存在 save 上下文或明确战术意图触发。
save_play 不能作为经济态势判定的默认兜底。
light_buy 不等于全员强起；在个人买型层必须允许 light_buy 落到 halfBuy / eco / 局部 force 的有限分化。
```

## 6. 购买阶段流程

每个回合开始后、Agent 行动前，进入购买阶段：

```text
1. 读取每个 active Agent 的 EconomyState。
2. Agent 独立决定 buyType。
3. 允许 Agent 之间执行 drop。
4. 确认每个 Agent 的 spendBudget、outputBudget；visibleContextBudget 仅保留兼容值，不参与当前经济闭环。
5. 写入 economy_snapshot_created、buy_type_decided、drop_created 等事件。
6. LLM Driver 完整生成 RawOutput。
7. Output Gate 根据 spendBudget 裁剪 SubmittedOutput。
8. SubmittedOutput 进入 Judge、RoundReport 和事件拆解。
```

Coach 默认不常驻整理输出。只有触发战术暂停或 Coach 行为时，Coach Agent 才工作，并写入对应事件。第一版默认从 Coach Agent 的 `tokenBank` 扣除 `coachTimeoutCost`。

### 6.2 回合经济汇总字段

`RoundReport.economyDelta` 里的汇总字段语义固定为：

```text
teamTotals:
回合结束后双方真实队伍总经济，用于前端金额展示、经济优势判断和转播消费。

teamNetDelta:
本回合双方净变化，用于 economy swing、经济波动标签和回合级解说。
```

禁止继续把 `teamTotals` 当作“本回合净变化”使用。

### 6.1 区域资源分配（Phase 1.6 预留）

区域资源分配用于解释“本回合有效输出重点打哪里”，它从 Agent 级经济派生，不是新的经济主体。

```text
Agent.tokenBank 仍然是唯一经济主体。
buyType / spendBudget / outputBudget 仍然按 Agent 计算。
ZoneResourceAllocation 只说明这些预算在 A 点、B 点、中路、连接区、经济区之间如何分配。
```

类型草案：

```ts
type ZoneResourceAllocation = {
  zoneId: string;
  weight: number;
  activeAgentIds: string[];
  intent:
    | "attack_execute"
    | "attack_feint"
    | "info_control"
    | "defense_anchor"
    | "defense_rotate"
    | "economy_pressure";
};
```

约束：

```text
同一队伍同一回合的 weight 建议合计为 100。
weight 不等于真实 API token，也不等于新增预算。
区域分配不能让 Agent 绕过 Output Gate。
区域分配不能改变 buyType、tokenBank、真实 provider 成本或 driverModelId。
```

示例：

```text
攻方强打 A：conversion_site_a 70，buyer_mid 20，pricing_ramp 10。
守方默认分散：conversion_site_a 35，conversion_site_b 35，buyer_mid 15，retention_connector 15。
守方重防 A：conversion_site_a 60，retention_connector 20，buyer_mid 10，conversion_site_b 10。
```

RoundReport 和 Judge 可以消费区域资源分配摘要，但经济结算仍以 Agent 级 `EconomyState` 为准。

## 7. Drop 规则

Drop 是 Agent 之间的 token 转移，只能发生在购买阶段。

规则：

- 发送方必须拥有足够余额。
- 接收方不能超过 `agentTokenCap`。
- Drop 不能让发送方 `tokenBank` 变成负数。
- Drop 必须写入 `drop_created` 事件。
- Drop 完成后双方都需要进入经济更新。

推荐约束：

```text
dropAmount <= sender.tokenBank
dropAmount <= agentTokenCap - receiver.tokenBank
```

如果接收方 cap 剩余额度不足，第一版直接禁止该次 drop，而不是吞掉超出部分。

## 8. 收入与赏金

### 8.1 回合基础收入

| 场景 | 收入 |
|---|---:|
| 胜方 Agent | `+3000` |
| 败方 Agent | `+4200` |

败方收入更高，用于避免经济死循环，并制造 CS 式经济节奏。

### 8.2 连败补偿

| 连败次数 | 额外补偿 |
|---:|---:|
| 1 | `+800` |
| 2 | `+1600` |
| 3 及以上 | `+2400` |

连败补偿按队伍连败状态计算，但发放到队内每个 Agent。

### 8.3 表现赏金

表现赏金由回合关键事件候选触发，发放给对应 Agent。关键事件候选在 JudgeResult 之后、`economy_updated` 之前形成；随后 `RoundReport.keyEvents` 必须引用同一批稳定事件 ID，避免经济结算依赖已经落库的 RoundReport。

第一版直接引用 P1.1 的 `RoundKeyEventType`，避免经济系统再维护一套近义枚举。

| RoundKeyEventType | 赏金 |
|---|---:|
| `entry` | `+600` |
| `trade` | `+700` |
| `clutch` | `+1200` |
| `economy_swing` | `+800` |
| `conversion` | `+900` |
| `highlight` | `+1000` |

扩展接口：

```text
bountyRules[] = {
  roundKeyEventType,
  amount,
  enabled,
  seasonId?,
  notes?
}
```

后续新增 `RoundKeyEventType` 时，只需追加赏金规则，不应改写既有事件含义。高光触发规则不在 P1.2 完整展开。P1.2 只提供经济与关键事件的连接入口。

### 8.4 结算上限

任何收入、赏金、save 保留、drop 结算后都执行上限：

```text
tokenBank = min(tokenBank, agentTokenCap)
```

超过上限的部分不进入团队经济。

## 9. 输出闸门（Output Gate）

Output Gate 把完整生成的 `RawOutput` 转换为比赛内可提交的 `SubmittedOutput`。

输入：

```text
agentId
roundId
rawOutput
rawOutputTokenEstimate
buyType
spendBudget
cutMode
randomSeed
```

输出：

```text
submittedOutput
submittedOutputTokenEstimate
spentBudget
remainingTokenBank
truncationRatio
cutMode
randomSeed
```

要求：

- 裁剪必须可复现。
- 同一个 `randomSeed` 和同一个 `RawOutput` 必须得到同一个 `SubmittedOutput`。
- `SubmittedOutput` 与 `spendBudget` 的偏差不应超过 `±10%`。
- `RawOutput` 本地临时保存为产物，不直接作为 Judge 的输入。

## 10. 裁剪模式

| 裁剪模式 | 说明 | 适用场景 |
|---|---|---|
| `front_cut` | 截取开头 | 稳健输出、Save。 |
| `core_window` | 截取中间核心段 | Half Buy。 |
| `random_window` | 可复现随机窗口 | Eco、Force Buy 的节目效果。 |
| `multi_slice` | 多段拼接 | Full Buy、star_rifler / awper Agent。 |
| `multi_slice_lite` | 少量多段拼接 | Force Buy。 |
| `summary_cut` | 先压缩再提交 | Coach、IGL 特例。 |

默认映射：

| 购买类型 | 提交比例 | 默认裁剪模式 |
|---|---:|---|
| Full Buy | 80%-100% | `multi_slice` |
| Half Buy | 40%-60% | `core_window` |
| Eco | 15%-25% | `random_window` |
| Force Buy | 按当前余额尽量多截 | `random_window` 或 `multi_slice_lite` |
| Save | 5%-10% | `front_cut` 或 `random_window` |
| Coach / IGL 特例 | 由触发条件决定 | `summary_cut` |

## 11. 事件契约

P1.2 需要产生或消费以下事件。

### 11.1 `economy_snapshot_created`

记录单个 Agent 的经济快照。

核心 payload：

```json
{
  "schemaVersion": 1,
  "agentId": "agent_nav_star",
  "teamId": "team_ghost_nav",
  "mapGameId": "map_001",
  "roundId": "round_004",
  "tokenBank": 8200,
  "buyType": "halfBuy"
}
```

### 11.2 `buy_type_decided`

记录每个 active Agent 的购买类型和预算约束。

核心 payload：

```json
{
  "schemaVersion": 1,
  "roundId": "round_004",
  "buyTypeByAgent": {
    "agent_nav_star": "forceBuy",
    "agent_nav_support": "save"
  },
  "constraintsByAgent": {
    "agent_nav_star": {
      "spendBudget": 7600,
      "visibleContextBudget": 2400,
      "outputBudget": 7600
    }
  }
}
```

`visibleContextBudget` 在该 payload 中仅为历史兼容字段。Phase 2.0-pre 不得用它制造双方公开输入差。

### 11.3 `drop_created`

记录 Agent 之间的 token 转移。

核心 payload：

```json
{
  "schemaVersion": 1,
  "roundId": "round_004",
  "fromAgentId": "agent_nav_support",
  "toAgentId": "agent_nav_star",
  "amount": 2200,
  "reason": "Support 给 star_rifler 起关键回合装备。"
}
```

### 11.4 `timeout_used`

记录 Coach 暂停触发和消耗。

核心 payload：

```json
{
  "schemaVersion": 1,
  "teamId": "team_ghost_nav",
  "coachAgentId": "agent_nav_coach",
  "roundId": "round_004",
  "cost": 2500,
  "timeoutsRemaining": 1,
  "reason": "连续丢失地图控制后触发 Coach 调整。"
}
```

### 11.5 `save_called`

记录单个 Agent 保经济。

核心 payload：

```json
{
  "schemaVersion": 1,
  "agentId": "agent_fur_lurker",
  "teamId": "team_ghost_fur",
  "roundId": "round_005",
  "spendBudget": 600,
  "savedTokenEstimate": 9400,
  "reason": "本回合胜率较低，保留经济进入下一回合。"
}
```

### 11.6 `force_buy_called`

记录单个 Agent 强起。

核心 payload：

```json
{
  "schemaVersion": 1,
  "agentId": "agent_nav_star",
  "teamId": "team_ghost_nav",
  "roundId": "round_004",
  "spendBudget": 7600,
  "riskLevel": "high",
  "reason": "落后地图控制但希望抢节奏。"
}
```

### 11.7 `output_gate_applied`

记录 RawOutput 到 SubmittedOutput 的裁剪结果。

核心 payload：

```json
{
  "schemaVersion": 1,
  "agentId": "agent_nav_star",
  "roundId": "round_004",
  "rawOutputArtifactId": "artifact_raw_agent_nav_star_r004",
  "rawOutputTokenEstimate": 5000,
  "submittedOutputTokenEstimate": 3000,
  "spendBudget": 3000,
  "cutMode": "random_window",
  "randomSeed": "round_004_agent_nav_star",
  "truncationRatio": 0.6
}
```

### 11.8 `economy_updated`

记录回合结算后的 Agent 经济变化。

核心 payload：

```json
{
  "schemaVersion": 1,
  "roundId": "round_004",
  "deltaByAgent": {
    "agent_nav_star": {
      "before": 7600,
      "spent": -7600,
      "income": 3000,
      "bounty": 1200,
      "after": 4200
    }
  }
}
```

## 12. 与 RoundReport 的关系

RoundReport 应消费或引用以下 P1.2 结果：

```text
buyTypeByAgent
economyDeltaByAgent
outputGateResults
tokenUsageByAgent
highlightTags
```

说明：

- `buyTypeByAgent` 用于解释每个 Agent 的装备状态。
- `economyDeltaByAgent` 用于统计和经济面板。
- `outputGateResults` 用于追溯 SubmittedOutput 的裁剪来源。
- `tokenUsageByAgent` 是比赛内预算使用，不是真实 API token 成本。
- `highlightTags` 可标记 `eco_clutch`、`force_buy_miracle` 等候选，但完整高光规则留给后续文档。

## 13. 验收标准

完成 P1.2 后应满足：

- 能解释每个 Agent 为什么是 fullBuy、halfBuy、eco、forceBuy 或 save。
- 能从单个 Agent 的 `EconomyState` 推导本回合 `spendBudget` 与 `outputBudget`，并确认 `visibleContextBudget` 仅兼容保留。
- 能验证 drop 不会让接收方超过 `agentTokenCap`。
- 能验证 forceBuy 会花光或接近花光当前 Agent 经济。
- 能验证 save 只消耗极少预算，并在回合结算后保留经济优势。
- 能验证 Output Gate 在相同 `randomSeed` 下裁剪结果可复现。
- 能验证 SubmittedOutput 长度与 spendBudget 偏差不超过 `±10%`。
- 能验证 `driverModelId` 不会被经济状态修改。
- 能验证真实 API 用量只进入可观测性，不进入 `EconomyState`。

## 14. 与后续文档的关系

| 后续文档 | P1.2 提供 | 对方负责 |
|---|---|---|
| P1.1 回合战报契约 | buyTypeByAgent、economyDeltaByAgent、outputGateResults | RoundReport 完整结构和 key event 类型。 |
| P1.3 大模型驾驶员契约 | RawOutput / SubmittedOutput 边界 | provider、prompt、parser、retry。 |
| P1.4 比赛 / 地图 / 回合引擎说明 | 购买阶段、Drop、Output Gate、结算流程 | 状态机和执行顺序。 |
| P2.1 直播时间线说明 | 可投影经济事件 | 时间线 kind 和播放节奏。 |
| P3.1 数据统计与奖项说明 | Agent 级经济数据 | 评级公式和奖项计算。 |
