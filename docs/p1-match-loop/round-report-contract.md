# P1.1 回合战报契约（RoundReport Contract）

## 1. 文档定位

这份文档定义 Agent Major 一回合结束后必须生成的结构化回合战报。

它回答的问题是：

```text
一回合结束后，系统必须产出什么结构化结果？
这些结果如何驱动事件日志、2D 战场、击杀播报、解说、弹幕、高光、统计和新闻？
裁判到底看什么？
比赛内 token 经济到底限制什么？
哪些字段现在必须稳定，哪些细节留给后续专项文档？
```

P1.1 是从比赛模拟到内容生态的桥梁：

```text
Round + AgentOutputs + JudgeResult + EconomySnapshot
→ RoundReport
→ Event Projection
→ Broadcast / Timeline / Stats / News
```

### 1.1 本文档负责

- 定义回合战报（RoundReport）顶层结构。
- 定义裁判结果（JudgeResult）结构。
- 定义智能体输出（AgentOutput）结构。
- 定义关键事件（RoundKeyEvent）结构。
- 定义关键事件类型的第一批稳定枚举。
- 定义地图区域引用方式。
- 定义经济变化与提交额度记录方式。
- 定义高光标签的第一批稳定枚举。
- 定义回合战报如何投影成事件。
- 定义下游模块如何消费回合战报字段。
- 给出普通回合和高光回合两个完整 JSON 示例。

### 1.2 本文档不负责

- 不定义完整 Token 经济公式。
- 不定义收入、连败补偿、购买类型阈值。
- 不定义大模型供应商、提示词、重试、降级。
- 不定义 2D 地图坐标。
- 不定义解说、弹幕、新闻的文风。
- 不定义比赛 / 地图 / 回合状态机。
- 不定义最终出招模式是同时出招、固定先后手，还是多阶段回合。

这些内容分别由后续文档负责：

| 内容 | 后续文档 |
|---|---|
| Token 经济公式 | P1.2 Token 经济说明 |
| 大模型驾驶员 | P1.3 大模型驾驶员契约 |
| 比赛模拟引擎 | P1.4 比赛 / 地图 / 回合引擎说明 |
| 2D 地图坐标 | P2.2 2D 战术地图说明 |
| 解说与弹幕 | P2.3 转播系统说明 |

## 2. 设计原则

### 2.1 回合战报是结算契约

回合（Round）是同步模拟单位。

回合战报（RoundReport）是这个同步单位完成后的结算契约。它必须足够结构化，能被机器稳定消费。

### 2.2 裁判只看有效提交内容

智能体（Agent）可以完整生成原始输出（rawOutput），但裁判只看经过比赛内 token 经济裁剪后的有效提交内容（submittedOutput）。

```text
rawOutput：完整生成内容，保存为存档，不默认展示。
submittedOutput：受比赛经济限制后的有效提交内容，进入裁判和事件拆解。
```

### 2.3 P1.1 只记录提交额度边界

P1.1 中的 token 经济不是实际 API 成本。

在本文档范围内，token 经济只记录一个已经发生的结果：

```text
选手 agent 本回合能提交给比赛世界的内容长度。
```

完整 Token 经济系统是否还影响激活智能体数量、上下文长度、战术暂停、信息可见度和输出预算，由 P1.2 Token 经济说明定义。P1.1 不提前锁死这些规则，只保存回合结束后实际采用的提交额度。

P1.1 中的提交额度不限制：

```text
真实 API token 成本
裁判 token
解说 token
弹幕 token
新闻 token
回放 token
系统摘要 token
结构化解析 token
```

真实 API token 和真实成本进入可观测性与成本控制，不进入 P1.1 判定。

### 2.4 关键事件要混合电竞语言和产品语义

关键事件不是纯产品术语，也不是纯 CS 术语。

它应该把两者结合起来：

```text
中路控制突破 = 找到核心用户痛点或关键切入点
转化 A 点爆破 = 完成商业闭环突破
潜伏偷点 = 发现对手忽略的增长入口
残局收束 = 把混乱方案压成可落地 MVP
教练调整 = 方向重构或战术 pivot
```

### 2.5 事实和包装分离

回合战报提供结构化事实。

解说、弹幕、新闻、回放卡片是包装层内容，不能修改比赛事实。

### 2.6 行动顺序保持兼容

P1.1 不锁死最终行动顺序。

行动顺序由 `AgentOutput` 承载，而不是重复写入 `RoundKeyEvent`。

```text
AgentOutput.actionPhase
AgentOutput.sequenceIndex
```

这允许后续支持：

```text
同时出招
固定先后手
开局 / 反制 / 收束 多阶段回合
```

约束：

- `RoundKeyEvent` 只记录关键事实归因、区域和影响说明。
- 播放顺序由 `TimelineEvent` 和事件数组顺序负责。
- P2.2 2D 战术地图不能依赖 `RoundKeyEvent.actionPhase` 或 `RoundKeyEvent.sequenceIndex`，因为当前工程 schema 中没有这两个字段。

## 3. 输入与输出关系

### 3.1 上游输入

回合战报的上游输入包括：

| 输入 | 来源 | 用途 |
|---|---|---|
| 回合（Round） | 比赛模拟引擎 | 提供 roundId、roundNumber、active agents、购买类型。 |
| 智能体输出（AgentOutputs） | 大模型驾驶员层 / 比赛模拟引擎 | 提供 rawOutput 和 submittedOutput。 |
| 裁判结果（JudgeResult） | 裁判与评分 | 提供胜负、理由、影响等级。 |
| 经济快照（EconomySnapshot） | Token 经济系统 | 提供购买类型、花费、输出额度、经济变化。 |
| 地图规则 | 规则与赛制说明 | 提供 mapName、地图主题、回合目标。 |
| 事件分类 | 事件分类文档 | 提供可投影事件类型。 |

### 3.2 下游输出

回合战报的下游消费者包括：

| 下游模块 | 消费内容 |
|---|---|
| 事件日志（Event Log） | 裁判结果、比分、经济变化、关键事件、高光标签。 |
| 2D 战术渲染器（2D Tactical Renderer） | `keyEvents[].zoneId`、`keyEvents[].type`、`actorTeamId`、`actorAgentId`、`impact`。 |
| 击杀播报（Kill Feed） | 关键事件的 actor、target、zoneId 和 impact。 |
| 转播与伪直播（Broadcast & Pseudo Live） | summary、keyEvents、highlightTags、submittedOutputSummary。 |
| 数据统计与奖项（Stats & Awards） | winnerTeamId、judgeResult.mvpAgentId、keyEvents[].actorAgentId、buyType、highlightTags。 |
| 新闻与媒体（News & Media） | summary、judgeResult、highlightTags、sourceEventIds。 |

### 3.3 数据流

```text
Round
  + AgentOutputs
  + JudgeResult
  + EconomySnapshot
  + Map Context
    ↓
RoundReport
    ↓
Event Projection
    ↓
Event Log
    ↓
Broadcast / Timeline / Stats / News
```

约束：

- RoundReport 不直接控制 UI。
- RoundReport 不直接生成新闻。
- RoundReport 不直接生成 TimelineEvent。
- RoundReport 只提供结构化事实和投影依据。

## 4. 回合战报顶层结构（RoundReport）

### 4.1 字段表

| 中文字段 | 代码字段 | 类型草案 | 必填 | 说明 |
|---|---|---|---|---|
| 回合战报 ID | `id` | `string` | 是 | 稳定引用 ID。 |
| 赛事 ID | `tournamentId` | `string` | 是 | 指向 Tournament。 |
| 比赛 ID | `matchId` | `string` | 是 | 指向 Match。 |
| 地图局 ID | `mapGameId` | `string` | 是 | 指向 MapGame。 |
| 回合 ID | `roundId` | `string` | 是 | 指向 Round。 |
| 回合号 | `roundNumber` | `number` | 是 | 地图内回合号。 |
| 地图名 | `mapName` | `MapName` | 是 | DUST2、MIRAGE 等稳定代码值。 |
| 胜者队伍 ID | `winnerTeamId` | `string` | 是 | 本回合唯一胜者。 |
| 回合前比分 | `scoreBeforeRound` | `ScorePair` | 是 | 回合开始前地图比分。 |
| 回合后比分 | `scoreAfterRound` | `ScorePair` | 是 | 回合结束后地图比分。 |
| 裁判结果 | `judgeResult` | `JudgeResult` | 是 | 裁判结算结构。 |
| 智能体输出 | `agentOutputs` | `AgentOutput[]` | 是 | 本回合激活智能体输出记录。 |
| 关键事件 | `keyEvents` | `RoundKeyEvent[]` | 是 | 2-5 个关键事件。 |
| 经济变化 | `economyDelta` | `RoundEconomyDelta` | 是 | 队伍和 agent 经济变化。 |
| 提交额度记录 | `tokenSubmission` | `TokenSubmissionRecord` | 是 | 比赛内提交额度边界。 |
| 高光标签 | `highlightTags` | `HighlightTag[]` | 否 | 高光候选标签。 |
| 摘要 | `summary` | `string` | 是 | 简短自然语言战报。 |
| 事件投影 | `eventProjection` | `EventProjection` | 是 | 可拆事件声明。 |
| 创建时间 | `createdAt` | `string` | 是 | ISO 时间字符串。 |

### 4.2 顶层结构草案

```ts
type RoundReport = {
  id: string;
  tournamentId: string;
  matchId: string;
  mapGameId: string;
  roundId: string;
  roundNumber: number;
  mapName: MapName;
  winnerTeamId: string;
  scoreBeforeRound: ScorePair;
  scoreAfterRound: ScorePair;
  judgeResult: JudgeResult;
  agentOutputs: AgentOutput[];
  keyEvents: RoundKeyEvent[];
  economyDelta: RoundEconomyDelta;
  tokenSubmission: TokenSubmissionRecord;
  highlightTags?: HighlightTag[];
  summary: string;
  eventProjection: EventProjection;
  createdAt: string;
};
```

### 4.3 顶层约束

- `winnerTeamId` 必须与 `judgeResult.winnerTeamId` 一致。
- `scoreAfterRound` 必须体现本回合胜者得分变化。
- `agentOutputs` 必须覆盖本回合所有激活智能体。
- `keyEvents` 建议 2-5 个。
- `keyEvents` 不能引用不存在的 `agentOutputs.id`。
- `tokenSubmission.mode` 第一版固定为 `output_submission_budget`。
- `eventProjection` 只声明可投影事件，不替代真正 Event 实例。

### 4.4 战术上下文扩展（Phase 1.6 预留）

区域化攻防协议落地后，RoundReport 需要保存“攻守双方为什么在某个区域发生碰撞”的结构化事实。该字段不进入 Phase 1.45 当前代码，也不阻塞 Phase 1.5；真正实现前必须同步更新 schema、事件投影和测试。

推荐扩展：

```ts
type RoundReport = {
  // existing fields...
  tacticalContext?: TacticalRoundSnapshot;
};

type TacticalRoundSnapshot = {
  sideAssignment: SideAssignment;
  attackPlan: PublicAttackPlanSummary;
  defenseDeployment: PublicDefenseDeploymentSummary;
  collision: TacticalCollision;
};

type PublicAttackPlanSummary = {
  teamId: string;
  primaryTargetZoneId: string;
  secondaryTargetZoneId?: string;
  approach:
    | "fast_execute"
    | "slow_control"
    | "mid_control_then_execute"
    | "fake_then_rotate"
    | "eco_steal"
    | "default_probe";
  revealedAfterRound: true;
};

type PublicDefenseDeploymentSummary = {
  teamId: string;
  setup:
    | "heavy_a"
    | "heavy_b"
    | "default_split"
    | "mid_push"
    | "retake_setup"
    | "save_weak_hold";
  heavyZoneId?: string;
  weakZoneIds: string[];
  revealedAfterRound: true;
};

type TacticalCollision = {
  primaryZoneId: string;
  result:
    | "attack_breakthrough"
    | "defense_hold"
    | "trade_even"
    | "fake_success"
    | "rotate_success"
    | "economy_steal";
  decisiveReason: string;
};
```

边界：

```text
tacticalContext 是回合结束后的公开事实摘要，不是赛前隐藏计划原文。
隐藏计划原文如果需要保存，应进入 Artifact 或受限 Event，不默认下发给观众页面。
keyEvents[].zoneId 仍然是 2D 地图的主入口。
tacticalContext 只能解释 keyEvents 和 JudgeResult，不能覆盖 winnerTeamId 或 scoreAfterRound。
```

## 5. 裁判结果（JudgeResult）

### 5.1 字段表

| 中文字段 | 代码字段 | 类型草案 | 必填 | 说明 |
|---|---|---|---|---|
| 胜者队伍 ID | `winnerTeamId` | `string` | 是 | 本回合唯一胜者。 |
| 败者队伍 ID | `loserTeamId` | `string` | 是 | 本回合败者。 |
| 胜利理由 | `winReason` | `string` | 是 | 为什么胜者赢。 |
| 失败理由 | `loseReason` | `string` | 是 | 为什么败者输。 |
| 决定性因素 | `decisiveFactors` | `string[]` | 是 | 影响胜负的关键因素。 |
| 分数影响 | `scoreImpact` | `ScoreImpact` | 是 | 本回合对比分和局势的影响。 |
| 回合影响等级 | `roundImpactLevel` | `RoundImpactLevel` | 是 | 险胜、常规胜、大胜等。 |

### 5.2 类型草案

```ts
type JudgeResult = {
  winnerTeamId: string;
  loserTeamId: string;
  winReason: string;
  loseReason: string;
  decisiveFactors: string[];
  scoreImpact: {
    roundWinnerPoint: 1;
    momentumDelta: "small" | "medium" | "large";
    economyPressureDelta?: "none" | "small" | "medium" | "large";
  };
  roundImpactLevel: "narrow_win" | "standard_win" | "dominant_win";
};
```

### 5.3 约束

- 每回合必须有唯一胜者。
- 不支持争议判罚。
- 不支持平局。
- 可以描述“险胜 / 常规胜 / 大胜”，但不改变胜负唯一性。
- 裁判依据只能来自 `submittedOutput`、经济状态、地图目标和回合上下文。
- 裁判不能使用未提交的 `rawOutput` 作为判定依据。

## 6. 智能体输出（AgentOutput）

### 6.1 字段表

| 中文字段 | 代码字段 | 类型草案 | 必填 | 说明 |
|---|---|---|---|---|
| 输出 ID | `id` | `string` | 是 | 稳定引用 ID，供 keyEvents 追溯。 |
| 智能体 ID | `agentId` | `string` | 是 | 指向 Agent。 |
| 队伍 ID | `teamId` | `string` | 是 | 指向 Team。 |
| 行动阶段 | `actionPhase` | `ActionPhase` | 是 | 开局、反制、收束等。 |
| 顺序索引 | `sequenceIndex` | `number` | 是 | 用于排序。 |
| 原始输出引用 | `rawOutputRef` | `string` | 否 | 指向 Artifact，不默认展示。 |
| 原始输出摘要 | `rawOutputSummary` | `string` | 否 | 用于审计和复盘。 |
| 有效提交内容 | `submittedOutput` | `string` | 是 | 裁判可见文本。 |
| 有效提交摘要 | `submittedOutputSummary` | `string` | 是 | 转播、新闻、统计可用摘要。 |
| 原始输出 token 数 | `rawOutputTokens` | `number` | 否 | 估算或实际值。 |
| 有效提交 token 数 | `submittedTokens` | `number` | 是 | 进入比赛的有效提交量。 |
| 输出预算 | `outputBudget` | `number` | 是 | 本回合买到的提交额度。 |
| 购买类型 | `buyType` | `BuyType` | 是 | fullBuy、eco 等。 |
| 是否裁剪 | `wasTrimmed` | `boolean` | 是 | 是否因经济额度裁剪。 |
| 裁剪原因 | `trimReason` | `TrimReason` | 否 | 裁剪时必填。 |

### 6.2 类型草案

```ts
type AgentOutput = {
  id: string;
  agentId: string;
  teamId: string;
  actionPhase: ActionPhase;
  sequenceIndex: number;
  rawOutputRef?: string;
  rawOutputSummary?: string;
  submittedOutput: string;
  submittedOutputSummary: string;
  rawOutputTokens?: number;
  submittedTokens: number;
  outputBudget: number;
  buyType: BuyType;
  wasTrimmed: boolean;
  trimReason?: TrimReason;
};
```

### 6.3 行动阶段（ActionPhase）

第一版先定义兼容阶段：

| 中文名 | 代码值 | 说明 |
|---|---|---|
| 开局出招 | `opening` | 本回合第一段行动。 |
| 反制回应 | `counter` | 对对手动作做反制。 |
| 中盘调整 | `mid_round` | 中段修正方向。 |
| 残局收束 | `closing` | 最后收束方案。 |
| 团队执行 | `team_execute` | 多 agent 协同执行。 |

### 6.4 裁剪原因（TrimReason）

| 中文名 | 代码值 | 说明 |
|---|---|---|
| 输出预算限制 | `output_budget_limit` | 超过本回合买到的提交额度。 |
| 保经济策略 | `save_strategy` | 主动保经济导致提交很短。 |
| 经济局限制 | `eco_limit` | 经济局提交额度较低。 |
| 强起后截断 | `force_buy_limit` | 强起后仍不足以提交完整内容。 |

### 6.5 约束

- `submittedOutput` 是裁判可见文本。
- `submittedOutput` 是事件拆解的主要依据。
- `rawOutput` 可以保存为 Artifact，但不默认展示。
- `rawOutputRef` 存在时，应可追溯到产物文件。
- `wasTrimmed = true` 时，`trimReason` 必填。
- `submittedTokens` 不应大于 `outputBudget`。
- P1.1 不定义 token 预算公式，只记录本回合实际结果。

## 7. 关键事件（RoundKeyEvent）

当前工程已经采用压缩版 `RoundKeyEvent`。它只保存后续模块必须消费的事实入口：事件类型、行动方、可选目标方、区域、影响说明和来源输出。展示名、徽标、权重、投影提示属于转播层或播放投影，不写回当前 `RoundReport.keyEvents`。

### 7.1 字段表

| 中文字段 | 代码字段 | 类型草案 | 必填 | 说明 |
|---|---|---|---|---|
| 关键事件 ID | `id` | `string` | 是 | 稳定引用 ID。 |
| 类型 | `type` | `RoundKeyEventType` | 是 | 当前稳定枚举，见 8.1。 |
| 行动智能体 ID | `actorAgentId` | `string` | 是 | 事件主导 agent。 |
| 行动队伍 ID | `actorTeamId` | `string` | 是 | 事件发起队伍。 |
| 目标智能体 ID | `targetAgentId` | `string` | 否 | 被影响的主要对手 agent；团队 / 经济事件可为空。 |
| 目标队伍 ID | `targetTeamId` | `string` | 否 | 被影响队伍；纯己方强化事件可为空。 |
| 地图区域 ID | `zoneId` | `string` | 是 | P2.2 2D 战术地图的主入口。 |
| 影响说明 | `impact` | `string` | 是 | 面向解说、击杀播报和复盘的简短事实说明。 |
| 来源输出 ID | `sourceAgentOutputIds` | `string[]` | 是 | 追溯到 `AgentOutput`。 |

### 7.2 类型草案

```ts
type RoundKeyEventType =
  | "entry"
  | "trade"
  | "clutch"
  | "economy_swing"
  | "conversion"
  | "highlight";

type RoundKeyEvent = {
  id: string;
  type: RoundKeyEventType;
  actorAgentId: string;
  actorTeamId: string;
  targetAgentId?: string;
  targetTeamId?: string;
  zoneId: string;
  impact: string;
  sourceAgentOutputIds: string[];
};
```

### 7.3 归因规则

- `actorAgentId` 是当前事件的主导智能体。
- 多 agent 参与不再通过 `actorAgentIds` 表达，而是通过 `sourceAgentOutputIds` 追溯到多个 `AgentOutput`。
- MVP / rating 的主归因来自 `judgeResult.mvpAgentId`，不是 `RoundKeyEvent.primaryActorAgentId`。
- `targetAgentId` 和 `targetTeamId` 是可选字段，适合击杀播报、地图标记和复盘文案使用。

### 7.4 影响说明

当前 `impact` 是字符串，不是结构化数值对象。结构化结算已经由 `judgeResult`、`scoreAfterRound`、`economyDelta` 和 `highlightTags` 承载。

如果后续需要结构化 `controlDelta`、`momentumDelta` 或 `statImpact`，必须先修改 schema 和本文档，不能在示例里单独扩展。

### 7.5 投影提示

当前 `RoundKeyEvent` 不包含 `projectionHints` 和 `highlightWeight`。

投影关系由三处共同决定：

```text
RoundKeyEvent.type
RoundKeyEvent.zoneId
TimelineEvent / highlightTags
```

### 7.6 关键约束

- 每个 keyEvent 必须有 `actorAgentId`、`actorTeamId` 和 `zoneId`。
- 经济类事件也必须落到区域，当前统一使用 `token_economy`。
- `sourceAgentOutputIds` 必须能在同一份 `RoundReport.agentOutputs` 中找到。
- 当前不使用 `displayName`、`description`、`target`、`zone`、`actionPhase`、`sequenceIndex`、`projectionHints`、`highlightWeight`。
- 建议每个 RoundReport 包含 2-5 个 keyEvents。

## 8. 关键事件类型

P1.1 第一批稳定事件类型必须和当前工程 schema 保持一致。

### 8.1 稳定枚举

| 中文展示名 | 代码值 | 适用场景 | 2D 地图用途 | 高光候选 |
|---|---|---|---|---|
| 入口突破 | `entry` | 打开关键区域或论点入口。 | 区域控制闪烁、入口路径。 | 可选 |
| 交换反制 | `trade` | 双方围绕同一区域完成攻防交换。 | 双方控制色短暂交替。 | 可选 |
| 残局收束 | `clutch` | 低经济、劣势或高压下完成收束。 | 强高光闪烁、MVP 标记。 | 是 |
| 经济波动 | `economy_swing` | 经济差、强起、eco、保经济或资源效率形成影响。 | 点亮 `token_economy`。 | 是 |
| 优势转化 | `conversion` | 把入口优势转成得分、商业闭环或执行闭环。 | 目标区域变为得分方控制色。 | 是 |
| 高光事件 | `highlight` | 无法归类但需要进入高光池的关键事实。 | 强高光闪烁。 | 是 |

### 8.2 事件类型解释

#### 入口突破（entry）

通过关键论点、用户切口、技术入口或执行动作拿到区域主动权。

#### 交换反制（trade）

针对对手上一段行动完成有效交换或反制，例如拆掉假设、指出漏洞、补回区域控制。

#### 残局收束（clutch）

在信息、经济或回合局势不利的情况下，由某个 agent 完成最终收束。

#### 经济波动（economy_swing）

通过更高效的提交额度使用、强起成功、eco 翻盘或让对手被迫高消耗形成经济叙事。

#### 优势转化（conversion）

把中路、入口或论点优势推进成可计分结果，例如明确 buyer、定价、转化路径、工程交付路径。

#### 高光事件（highlight）

当某个关键事实无法稳定归入前五类，但需要被直播、回放、奖项或新闻消费时使用。

## 9. 地图区域引用

P1.1 只在 `RoundKeyEvent.zoneId` 中保存稳定区域 ID，不定义 2D 坐标、展示名、地图素材或区域角色。完整布局由 P2.2 `docs/p2-broadcast-viewer/tactical-map.md` 负责。

### 9.1 字段表

| 中文字段 | 代码字段 | 类型草案 | 必填 | 说明 |
|---|---|---|---|---|
| 区域 ID | `zoneId` | `string` | 是 | 机器稳定引用，供 Timeline、2D 地图、击杀播报和高光回放消费。 |

### 9.2 示例区域

| 中文展示名 | 代码值 | 语义 |
|---|---|---|
| 买家中路 | `buyer_mid` | 买家识别、核心切口和中路控制。 |
| 转化 A 点 | `conversion_site_a` | 转化路径、商业闭环或执行闭环。 |
| Token 经济区 | `token_economy` | 经济差、强起、eco、资源波动。 |
| 转化 B 点 | `conversion_site_b` | 第二落点、转点或替代闭环。 |
| 留存连接区 | `retention_connector` | 留存、运营循环、反馈机制。 |
| 定价斜坡 | `pricing_ramp` | 定价、套餐、价值锚点。 |

### 9.3 约束

- `zoneId` 必须稳定。
- 当前 fake provider 已产出的 `buyer_mid`、`conversion_site_a`、`token_economy` 必须在 P2.2 三图布局中存在。
- 未知区域的 fallback 规则属于 P2.2，不反写 `RoundReport`。

## 10. 经济变化与提交额度

P1.1 只记录结果，不定义经济公式。

### 10.1 经济变化（RoundEconomyDelta）

```ts
type RoundEconomyDelta = {
  teamEconomyDelta: TeamEconomyAggregateDelta[];
  agentSubmissionDelta: AgentSubmissionDelta[];
};
```

### 10.2 队伍经济聚合变化（TeamEconomyAggregateDelta）

队伍经济是队内 Agent 经济的加总展示，不是购买主体。P1.2 已确定购买、强起、保经济和 Drop 都发生在 Agent 级。

| 中文字段 | 代码字段 | 类型草案 | 必填 | 说明 |
|---|---|---|---|---|
| 队伍 ID | `teamId` | `string` | 是 | 指向 Team。 |
| 回合前队伍经济 | `teamBankBefore` | `number` | 是 | 队内 Agent 回合前 tokenBank 加总。 |
| 回合花费 | `teamSpend` | `number` | 是 | 队内 Agent 本回合花费加总。 |
| 回合收入 | `teamIncome` | `number` | 是 | 队内 Agent 回合后收入加总。 |
| 回合后队伍经济 | `teamBankAfter` | `number` | 是 | 队内 Agent 回合后 tokenBank 加总。 |

### 10.3 智能体提交额度变化（AgentSubmissionDelta）

P1.2 已确定经济主体是单个 Agent。这里记录的是每个智能体本回合实际购买类型、提交额度、花费和裁剪结果。

| 中文字段 | 代码字段 | 类型草案 | 必填 | 说明 |
|---|---|---|---|---|
| 智能体 ID | `agentId` | `string` | 是 | 指向 Agent。 |
| 购买类型 | `buyType` | `BuyType` | 是 | fullBuy、eco 等。 |
| 花费 | `spend` | `number` | 是 | 本回合买提交额度花费，来自该 Agent 的 tokenBank。 |
| 输出预算 | `outputBudget` | `number` | 是 | 本回合买到的 submittedOutput 额度。 |
| 有效提交 token 数 | `submittedTokens` | `number` | 是 | 实际进入比赛的提交量。 |
| 是否裁剪 | `wasTrimmed` | `boolean` | 是 | 是否因为提交额度被裁剪。 |

### 10.4 提交额度记录（TokenSubmissionRecord）

```ts
type TokenSubmissionRecord = {
  mode: "output_submission_budget";
  affectedScope: "player_agent_outputs_only";
  excludedScopes: Array<
    | "judge"
    | "caster"
    | "barrage"
    | "news"
    | "replay"
    | "system_summary"
    | "real_api_cost"
  >;
};
```

第一版固定：

```json
{
  "mode": "output_submission_budget",
  "affectedScope": "player_agent_outputs_only",
  "excludedScopes": [
    "judge",
    "caster",
    "barrage",
    "news",
    "replay",
    "system_summary",
    "real_api_cost"
  ]
}
```

### 10.5 经济边界

- 比赛内 token 是装备经济。
- 比赛内 token 限制 `submittedOutput`，不限制 `rawOutput`。
- 真实 API token / 调用成本进入 P4 可观测性，不进入 P1.1 判定。
- 裁判、解说、弹幕、新闻、回放、系统摘要不受比赛经济限制。
- agent 背后的 DriverModel 不因经济变化而切换。

## 11. 高光标签（HighlightTags）

P1.1 定义第一批高光标签。完整高光检测规则留给后续高光 / 回放文档。

| 中文名 | 代码值 | 触发依据 | 来源字段 | 进入 `highlight_detected` | 用于奖项 / 新闻 |
|---|---|---|---|---|---|
| 经济局残局 | `eco_clutch` | 经济局或低额度下赢下回合。 | economyDelta、judgeResult | 是 | 是 |
| 强起奇迹 | `force_buy_miracle` | 强起投入后赢下高压回合。 | economyDelta、keyEvents | 是 | 是 |
| 明星位接管 | `star_carry` | Star agent 贡献多个高影响事件。 | keyEvents、AgentRole | 是 | 是 |
| 教练调整成功 | `coach_adjustment_success` | 教练调整后回合胜利。 | keyEvents | 是 | 是 |
| 潜伏偷家 | `lurker_backdoor` | Lurker 找到隐蔽突破口。 | keyEvents | 是 | 是 |
| 商业闭环突破 | `conversion_breakthrough` | 付费和转化逻辑被打通。 | keyEvents | 是 | 是 |
| 技术救场 | `technical_save` | 技术风险被关键拆解。 | keyEvents | 是 | 是 |
| 增长偷点 | `growth_steal` | 找到被忽视增长入口。 | keyEvents | 是 | 是 |
| 翻盘回合 | `comeback_round` | 落后局势下赢回合。 | scoreBeforeRound、judgeResult | 是 | 是 |
| 截断节目效果 | `output_trim_drama` | 输出被裁剪但仍产生关键影响。 | agentOutputs、keyEvents | 是 | 是 |

## 12. 事件投影（EventProjection）

事件投影说明 RoundReport 关联哪些核心事实，以及可拆出哪些包装事件。

P1.1 只定义投影规则，不实际生成 Event 实例。

### 12.1 字段结构

```ts
type EventProjection = {
  coreEventsLinkedByRoundReport: ProjectedEvent[];
  optionalEvents: ProjectedEvent[];
};

type ProjectedEvent = {
  eventType: string;
  category: string;
  sourceFields: string[];
  notes?: string;
};
```

### 12.2 RoundReport 必须关联的核心事件

这里的“必须”只指 RoundReport 必须能稳定关联这些核心事件，不代表这些事件都由 RoundReport 生成。`judge_decision_created`、`score_updated`、`economy_updated` 通常早于 `round_report_created` 写入；RoundReport 负责引用同一批事实结果，供后续转播、统计和复盘消费。

| 事件类型 | 大类 | 来源字段 | 说明 |
|---|---|---|---|
| `judge_decision_created` | judge | `judgeResult` | 记录裁判判定。 |
| `score_updated` | judge | `scoreBeforeRound`、`scoreAfterRound` | 更新比分牌。 |
| `economy_updated` | economy | `economyDelta` | 记录经济变化。 |
| `round_report_created` | judge | `id`、`roundId` | 记录回合战报已生成。 |

### 12.3 可选投影事件

| 事件类型 | 大类 | 来源字段 | 说明 |
|---|---|---|---|
| `kill_feed_created` | broadcast | `keyEvents`、`TimelineEvent` | 可投影击杀播报时生成。 |
| `highlight_detected` | broadcast | `highlightTags`、`keyEvents` | 形成高光候选。 |
| `support_rate_updated` | broadcast | `judgeResult`、`keyEvents` | 支持率变化依据。 |

### 12.4 投影约束

- `round_completed` 由模拟引擎生命周期产生，不由 RoundReport 自己决定。
- `kill_feed_created` 属于转播包装事件。
- `support_rate_updated` 属于转播包装事件。
- `highlight_detected` 是派生候选，不改写回合事实。
- Event 生成后必须引用 `roundReportId` 或可追溯到 `roundId`。

## 13. 下游消费矩阵

| 下游模块 | 消费字段 | 用途 |
|---|---|---|
| M08 事件日志 | `judgeResult`、`scoreAfterRound`、`economyDelta`、`keyEvents`、`eventProjection` | 拆解事实事件和包装候选。 |
| M09 转播与伪直播 | `keyEvents`、`summary`、`highlightTags`、`agentOutputs.submittedOutputSummary` | 生成解说、弹幕、击杀播报、支持率。 |
| M10 2D 战术渲染器 | `keyEvents[].zoneId`、`keyEvents[].type`、`keyEvents[].impact`、`keyEvents[].actorTeamId`、`keyEvents[].actorAgentId` | 更新地图控制、路径、agent 标记和高光闪烁。 |
| M11 数据统计与奖项 | `winnerTeamId`、`judgeResult.mvpAgentId`、`keyEvents[].actorAgentId`、`buyType`、`highlightTags` | 更新 rating、impact、clutch、经济效率。 |
| M12 新闻与媒体 | `summary`、`judgeResult`、`highlightTags`、`sourceAgentOutputIds` | 生成战报、快讯、复盘素材。 |

## 14. 示例一：普通回合

场景：MIRAGE 商业闭环图，第 4 回合，Ghost NAV 常规全起，通过买家中路控制和转化 A 点突破赢下回合。

```json
{
  "id": "rr_004",
  "tournamentId": "t_agent_major_001",
  "matchId": "match_001",
  "mapGameId": "map_001",
  "roundId": "round_004",
  "roundNumber": 4,
  "mapName": "MIRAGE",
  "winnerTeamId": "team_ghost_nav",
  "scoreBeforeRound": {
    "teamA": 2,
    "teamB": 1
  },
  "scoreAfterRound": {
    "teamA": 3,
    "teamB": 1
  },
  "judgeResult": {
    "winnerTeamId": "team_ghost_nav",
    "loserTeamId": "team_ghost_fur",
    "winReason": "Ghost NAV 明确了企业买家、付费触发点和转化路径，商业闭环更完整。",
    "loseReason": "Ghost FUR 的方案仍停留在泛用户价值，缺少明确付费人群和价格锚点。",
    "decisiveFactors": [
      "买家定义清晰",
      "转化路径完整",
      "对手付费动机不足"
    ],
    "scoreImpact": {
      "roundWinnerPoint": 1,
      "momentumDelta": "medium",
      "economyPressureDelta": "small"
    },
    "roundImpactLevel": "standard_win"
  },
  "agentOutputs": [
    {
      "id": "ao_nav_star_004",
      "agentId": "agent_nav_star",
      "teamId": "team_ghost_nav",
      "actionPhase": "opening",
      "sequenceIndex": 1,
      "rawOutputRef": "artifact://raw/round_004/nav_star.md",
      "rawOutputSummary": "提出以招聘团队负责人为 buyer，并用复盘效率和候选人质量作为付费理由。",
      "submittedOutput": "我们不卖泛用 AI 工具，而是卖给招聘团队负责人一个面试复盘工作台。付费触发点是减少无效面试、沉淀候选人评估证据、降低招聘复盘成本。",
      "submittedOutputSummary": "明确招聘团队负责人为 buyer，并给出付费触发点。",
      "rawOutputTokens": 1820,
      "submittedTokens": 420,
      "outputBudget": 700,
      "buyType": "fullBuy",
      "wasTrimmed": false
    },
    {
      "id": "ao_nav_support_004",
      "agentId": "agent_nav_support",
      "teamId": "team_ghost_nav",
      "actionPhase": "mid_round",
      "sequenceIndex": 2,
      "rawOutputRef": "artifact://raw/round_004/nav_support.md",
      "rawOutputSummary": "补齐转化路径、套餐形态和首批试点用户。",
      "submittedOutput": "首版套餐可以按招聘岗位数计费，从 3 个试点团队开始，提供面试记录、复盘模板、候选人对比和招聘经理周报。",
      "submittedOutputSummary": "补齐套餐和试点路径。",
      "rawOutputTokens": 980,
      "submittedTokens": 260,
      "outputBudget": 500,
      "buyType": "halfBuy",
      "wasTrimmed": false
    },
    {
      "id": "ao_fur_igl_004",
      "agentId": "agent_fur_igl",
      "teamId": "team_ghost_fur",
      "actionPhase": "counter",
      "sequenceIndex": 3,
      "rawOutputRef": "artifact://raw/round_004/fur_igl.md",
      "rawOutputSummary": "尝试反击招聘场景过窄，但没有提出更强付费路径。",
      "submittedOutput": "招聘场景可能太窄，产品应该服务所有知识工作者的会议复盘。",
      "submittedOutputSummary": "反击场景过窄，但付费路径变泛。",
      "rawOutputTokens": 1100,
      "submittedTokens": 180,
      "outputBudget": 350,
      "buyType": "halfBuy",
      "wasTrimmed": false
    }
  ],
  "keyEvents": [
    {
      "id": "rke_004_001",
      "type": "entry",
      "actorAgentId": "agent_nav_star",
      "actorTeamId": "team_ghost_nav",
      "targetAgentId": "agent_fur_igl",
      "targetTeamId": "team_ghost_fur",
      "zoneId": "buyer_mid",
      "impact": "Ghost NAV Star 把 buyer 从泛用户压缩到招聘团队负责人，拿到买家中路控制权。",
      "sourceAgentOutputIds": ["ao_nav_star_004"]
    },
    {
      "id": "rke_004_002",
      "type": "conversion",
      "actorAgentId": "agent_nav_support",
      "actorTeamId": "team_ghost_nav",
      "targetAgentId": "agent_fur_lurker",
      "targetTeamId": "team_ghost_fur",
      "zoneId": "conversion_site_a",
      "impact": "Ghost NAV Support 补齐套餐、试点和转化路径，在转化 A 点完成商业闭环。",
      "sourceAgentOutputIds": ["ao_nav_support_004", "ao_nav_star_004"]
    }
  ],
  "economyDelta": {
    "teamEconomyDelta": [
      {
        "teamId": "team_ghost_nav",
        "teamBankBefore": 9400,
        "teamSpend": 1200,
        "teamIncome": 2000,
        "teamBankAfter": 10200
      },
      {
        "teamId": "team_ghost_fur",
        "teamBankBefore": 7600,
        "teamSpend": 650,
        "teamIncome": 2800,
        "teamBankAfter": 9750
      }
    ],
      "agentSubmissionDelta": [
      {
        "agentId": "agent_nav_star",
        "buyType": "fullBuy",
        "spend": 700,
        "outputBudget": 700,
        "submittedTokens": 420,
        "wasTrimmed": false
      },
      {
        "agentId": "agent_nav_support",
        "buyType": "halfBuy",
        "spend": 500,
        "outputBudget": 500,
        "submittedTokens": 260,
        "wasTrimmed": false
      },
      {
        "agentId": "agent_fur_igl",
        "buyType": "halfBuy",
        "spend": 350,
        "outputBudget": 350,
        "submittedTokens": 180,
        "wasTrimmed": false
      }
    ]
  },
  "tokenSubmission": {
    "mode": "output_submission_budget",
    "affectedScope": "player_agent_outputs_only",
    "excludedScopes": [
      "judge",
      "caster",
      "barrage",
      "news",
      "replay",
      "system_summary",
      "real_api_cost"
    ]
  },
  "highlightTags": ["conversion_breakthrough"],
  "summary": "Ghost NAV 在 MIRAGE 第 4 回合通过 Star 的买家中路突破和 Support 的转化 A 点补枪，明确招聘团队负责人、套餐和试点路径，拿下商业闭环回合。",
  "eventProjection": {
    "coreEventsLinkedByRoundReport": [
      {
        "eventType": "judge_decision_created",
        "category": "judge",
        "sourceFields": ["judgeResult"]
      },
      {
        "eventType": "score_updated",
        "category": "judge",
        "sourceFields": ["scoreBeforeRound", "scoreAfterRound"]
      },
      {
        "eventType": "economy_updated",
        "category": "economy",
        "sourceFields": ["economyDelta"]
      },
      {
        "eventType": "round_report_created",
        "category": "judge",
        "sourceFields": ["id", "roundId"]
      }
    ],
    "optionalEvents": [
      {
        "eventType": "kill_feed_created",
        "category": "broadcast",
        "sourceFields": ["keyEvents"]
      },
      {
        "eventType": "highlight_detected",
        "category": "broadcast",
        "sourceFields": ["highlightTags", "keyEvents"]
      },
      {
        "eventType": "support_rate_updated",
        "category": "broadcast",
        "sourceFields": ["judgeResult", "keyEvents"]
      }
    ]
  },
  "createdAt": "2026-04-29T12:04:00.000Z"
}
```

## 15. 示例二：高光回合

场景：INFERNO 留存运营图，第 9 回合。Ghost FUR 低经济强起，Lurker 原始输出很长，但只能提交很短内容。提交内容被裁剪后仍抓住一个低成本增长入口，完成翻盘。

```json
{
  "id": "rr_009",
  "tournamentId": "t_agent_major_001",
  "matchId": "match_001",
  "mapGameId": "map_002",
  "roundId": "round_009",
  "roundNumber": 9,
  "mapName": "INFERNO",
  "winnerTeamId": "team_ghost_fur",
  "scoreBeforeRound": {
    "teamA": 5,
    "teamB": 3
  },
  "scoreAfterRound": {
    "teamA": 5,
    "teamB": 4
  },
  "judgeResult": {
    "winnerTeamId": "team_ghost_fur",
    "loserTeamId": "team_ghost_nav",
    "winReason": "Ghost FUR 在输出额度极低的情况下抓住了可执行的社区分发入口，并把增长动作压缩到一个具体循环。",
    "loseReason": "Ghost NAV 的方案更完整，但增长动作偏重资源投入，没有回应低成本冷启动问题。",
    "decisiveFactors": [
      "低成本增长入口明确",
      "裁剪后的提交仍保留关键策略",
      "对手增长方案成本过高"
    ],
    "scoreImpact": {
      "roundWinnerPoint": 1,
      "momentumDelta": "large",
      "economyPressureDelta": "large"
    },
    "roundImpactLevel": "narrow_win"
  },
  "agentOutputs": [
    {
      "id": "ao_fur_lurker_009",
      "agentId": "agent_fur_lurker",
      "teamId": "team_ghost_fur",
      "actionPhase": "closing",
      "sequenceIndex": 3,
      "rawOutputRef": "artifact://raw/round_009/fur_lurker.md",
      "rawOutputSummary": "完整提出 6 条增长路径，包括社群种子用户、模板分发、KOL 合作、SEO、招聘论坛和用户转介绍。",
      "submittedOutput": "先不要投广告。切招聘复盘这个垂直场景，把“面试复盘模板”做成可转发资产，投放到招聘经理社群和候选人复盘帖子里。每个模板尾部带团队复盘入口，形成低成本循环。",
      "submittedOutputSummary": "用面试复盘模板作为可转发资产，打招聘经理社群和候选人复盘场景。",
      "rawOutputTokens": 10400,
      "submittedTokens": 220,
      "outputBudget": 220,
      "buyType": "forceBuy",
      "wasTrimmed": true,
      "trimReason": "output_budget_limit"
    },
    {
      "id": "ao_fur_support_009",
      "agentId": "agent_fur_support",
      "teamId": "team_ghost_fur",
      "actionPhase": "mid_round",
      "sequenceIndex": 2,
      "rawOutputRef": "artifact://raw/round_009/fur_support.md",
      "rawOutputSummary": "补充模板分发的数据回收方式。",
      "submittedOutput": "模板页只收集两个字段：岗位类型和面试轮次，用来反向生成下一批模板。",
      "submittedOutputSummary": "补充轻量数据回收方式。",
      "rawOutputTokens": 1400,
      "submittedTokens": 95,
      "outputBudget": 120,
      "buyType": "eco",
      "wasTrimmed": true,
      "trimReason": "eco_limit"
    },
    {
      "id": "ao_nav_star_009",
      "agentId": "agent_nav_star",
      "teamId": "team_ghost_nav",
      "actionPhase": "opening",
      "sequenceIndex": 1,
      "rawOutputRef": "artifact://raw/round_009/nav_star.md",
      "rawOutputSummary": "提出付费广告、内容 SEO 和销售外呼组合增长方案。",
      "submittedOutput": "我们可以通过招聘 SaaS 关键词 SEO、HR 社群内容投放和销售外呼组合获取首批企业客户。",
      "submittedOutputSummary": "提出 SEO、社群内容和销售外呼组合增长方案。",
      "rawOutputTokens": 2100,
      "submittedTokens": 330,
      "outputBudget": 650,
      "buyType": "fullBuy",
      "wasTrimmed": false
    }
  ],
  "keyEvents": [
    {
      "id": "rke_009_001",
      "type": "economy_swing",
      "actorAgentId": "agent_fur_lurker",
      "actorTeamId": "team_ghost_fur",
      "targetTeamId": "team_ghost_nav",
      "zoneId": "token_economy",
      "impact": "Ghost FUR Lurker 原始输出超过一万 token，但强起预算只允许提交 220 token，仍保留关键增长动作。",
      "sourceAgentOutputIds": ["ao_fur_lurker_009"]
    },
    {
      "id": "rke_009_002",
      "type": "clutch",
      "actorAgentId": "agent_fur_lurker",
      "actorTeamId": "team_ghost_fur",
      "targetAgentId": "agent_nav_star",
      "targetTeamId": "team_ghost_nav",
      "zoneId": "retention_connector",
      "impact": "Ghost FUR Lurker 用极短提交抓住面试复盘模板这个可转发增长资产，在留存连接区完成残局收束。",
      "sourceAgentOutputIds": ["ao_fur_lurker_009", "ao_fur_support_009"]
    }
  ],
  "economyDelta": {
    "teamEconomyDelta": [
      {
        "teamId": "team_ghost_fur",
        "teamBankBefore": 2100,
        "teamSpend": 340,
        "teamIncome": 2000,
        "teamBankAfter": 3760
      },
      {
        "teamId": "team_ghost_nav",
        "teamBankBefore": 9700,
        "teamSpend": 650,
        "teamIncome": 2800,
        "teamBankAfter": 11850
      }
    ],
    "agentSubmissionDelta": [
      {
        "agentId": "agent_fur_lurker",
        "buyType": "forceBuy",
        "spend": 220,
        "outputBudget": 220,
        "submittedTokens": 220,
        "wasTrimmed": true
      },
      {
        "agentId": "agent_fur_support",
        "buyType": "eco",
        "spend": 120,
        "outputBudget": 120,
        "submittedTokens": 95,
        "wasTrimmed": true
      },
      {
        "agentId": "agent_nav_star",
        "buyType": "fullBuy",
        "spend": 650,
        "outputBudget": 650,
        "submittedTokens": 330,
        "wasTrimmed": false
      }
    ]
  },
  "tokenSubmission": {
    "mode": "output_submission_budget",
    "affectedScope": "player_agent_outputs_only",
    "excludedScopes": [
      "judge",
      "caster",
      "barrage",
      "news",
      "replay",
      "system_summary",
      "real_api_cost"
    ]
  },
  "highlightTags": [
    "force_buy_miracle",
    "growth_steal",
    "output_trim_drama"
  ],
  "summary": "Ghost FUR 在 INFERNO 第 9 回合低经济强起，Lurker 的原始长方案被裁剪到 220 token，但仍保留了面试复盘模板这个低成本增长入口，在留存连接区完成残局收束并扳回一分。",
  "eventProjection": {
    "coreEventsLinkedByRoundReport": [
      {
        "eventType": "judge_decision_created",
        "category": "judge",
        "sourceFields": ["judgeResult"]
      },
      {
        "eventType": "score_updated",
        "category": "judge",
        "sourceFields": ["scoreBeforeRound", "scoreAfterRound"]
      },
      {
        "eventType": "economy_updated",
        "category": "economy",
        "sourceFields": ["economyDelta"]
      },
      {
        "eventType": "round_report_created",
        "category": "judge",
        "sourceFields": ["id", "roundId"]
      }
    ],
    "optionalEvents": [
      {
        "eventType": "kill_feed_created",
        "category": "broadcast",
        "sourceFields": ["keyEvents"]
      },
      {
        "eventType": "highlight_detected",
        "category": "broadcast",
        "sourceFields": ["highlightTags", "keyEvents"]
      },
      {
        "eventType": "support_rate_updated",
        "category": "broadcast",
        "sourceFields": ["judgeResult", "keyEvents"]
      }
    ]
  },
  "createdAt": "2026-04-29T12:39:00.000Z"
}
```

## 16. 待确认问题

以下问题不阻塞 P1.1 契约，但会影响后续专项文档：

- 最终出招模式采用同时出招、固定先后手，还是多阶段回合。
- P1.2 中具体经济公式、收入、阈值、Drop 和 Output Gate 已由 `docs/p1-match-loop/token-economy.md` 定义；P1.1 只引用结果。
- P2.2 中每张地图的具体 zone 列表和 2D 坐标。
- P2.3 中解说、弹幕、支持率变化的生成策略。
- P1.4 中模拟引擎如何选择 active agents 和 actionPhase。
- Phase 1.6 区域化攻防协议落地时，是否把 `tacticalContext` 作为 RoundReport 正式可选字段。

## 17. 人工验收标准

完成 P1.1 后，应能满足：

- 能用本文档结构写出一个完整 RoundReport。
- 能让 RoundReport 稳定关联 `score_updated`、`economy_updated`，并拆出 `kill_feed_created`、`highlight_detected` 等包装事件。
- 能解释裁判为什么只看 `submittedOutput`。
- 能解释 `rawOutput` 为什么保存但不默认展示。
- 能说明比赛内 token 经济和真实 API token 成本的边界。
- 能让后续 P1.2、P1.3、P1.4 无需重新定义 RoundReport 核心结构。

## 18. 与其他文档的关系

| 文档 | 关系 |
|---|---|
| P0.1 领域模型 | P1.1 细化 RoundReport、RoundKeyEvent、EconomyDelta。 |
| P0.2 事件分类 | P1.1 引用事件类型并定义投影来源。 |
| P0.3 规则与赛制说明 | P1.1 引用地图池、MR6、BO3 和地图主题。 |
| P1.2 Token 经济说明 | P1.1 只记录经济结果，P1.2 定义公式。 |
| P1.3 大模型驾驶员契约 | P1.1 不定义模型调用，只记录 agent 输出结果。 |
| P1.4 比赛模拟引擎 | P1.1 为回合完成后的输出契约。 |
| P2.2 2D 战术地图说明 | P1.1 提供 zone 引用和 keyEvents。 |
| P2.3 转播系统说明 | P1.1 提供解说、弹幕、击杀播报、高光依据。 |
