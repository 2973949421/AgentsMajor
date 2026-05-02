# P2.3 转播系统说明（Broadcast System Spec）

## 1. 文档状态

```text
P 编号：P2.3
模块：M09 转播与伪直播（Broadcast & Pseudo Live）
当前状态：Review-ready Draft，Phase 1.5 结束后再评估是否 Frozen
首版日期：2026-05-02
覆盖范围：击杀播报、主解说接口、弹幕接口、支持率、高光、回放卡片
```

P2.3 定义 Agent Major 的转播包装层。它回答的问题是：

```text
比赛事实已经写入 Event Log 和 RoundReport 后，如何生成观众看到的解说、弹幕、击杀播报、支持率、高光和回放卡片？
哪些转播内容可以异步、延后、重建或丢弃？
哪些内容必须追溯到事实源？
哪些内容可以进入 UI？
哪些内容必须保留为开放接口，等待后续语料库和风格库补充？
```

一句话：

> 比赛模拟（Simulation）生产事实；转播系统（Broadcast System）包装事实；包装内容不能改写事实。

P2.3 承接 P2.1 和 P2.2：

```text
P2.1 直播时间线：决定观众在第几秒看到什么。
P2.2 2D 战术地图：决定地图如何把事件画出来。
P2.3 转播系统：决定解说、弹幕、高光、支持率和回放卡片如何生成。
```

## 2. 核心结论

P2.3 的核心原则是：

```text
Fact First, Broadcast Second.
事实先行，转播后置。
```

转播系统只能消费事实源和派生投影，不能发明比赛结果：

```text
允许消费：
Event
RoundReport
TimelineEvent
MapGame
Match
map_summary
match_summary
EconomyState
Team / Agent 展示身份

禁止修改：
winnerTeamId
score
EconomyState
RoundReport
JudgeResult
Event Log
Match / MapGame / Round 状态机
```

转播包装失败不阻塞比赛：

```text
解说失败，不影响回合完成。
弹幕失败，不影响回合完成。
支持率失败，不影响回合完成。
高光卡片失败，不影响回合完成。
回放卡片失败，不影响回合完成。
```

转播系统可以重生成：

```text
BroadcastItem 可以重生成。
caster_line_created 可以重生成。
barrage_created 可以重生成。
support_rate_updated 可以重生成。
highlight_detected 可以重生成。
replay_card_created 可以重生成。
TimelineEvent 可以基于新的 BroadcastItem 重建。
```

但转播系统不能反写事实：

```text
不能因为解说说某队赢了就修改比分。
不能因为弹幕说某 agent 是 MVP 就修改 MVP。
不能因为支持率高就改变比赛结果。
不能因为回放卡片标题更刺激就新增不存在的关键事件。
```

## 3. 本文档负责

- 定义转播系统（Broadcast System）的目标和边界。
- 定义转播内容与事实源的勾稽关系。
- 定义转播编排器（Broadcast Planner）。
- 定义击杀播报生成器（Kill Feed Builder）。
- 定义主解说接口（Caster Interface），但不定义最终解说人格和语料风格。
- 定义弹幕接口（Barrage Interface），但不定义最终弹幕语料库和尺度细节。
- 定义支持率系统（Support Rate System），并确认支持率第一版可以进入 UI。
- 定义高光识别器（Highlight Detector）。
- 定义回放卡片生成器（Replay Card Builder），第一版文本卡片，后续预留视频剪辑。
- 定义转播质量闸门（Broadcast Quality Gate）。
- 定义转播降级、重生成、异步任务和验收标准。

## 4. 本文档不负责

- 不决定比赛胜负。
- 不修改裁判结果。
- 不修改比分。
- 不修改 Token 经济。
- 不修改 RoundReport 核心字段。
- 不定义真实解说员最终人格。
- 不定义最终解说语料库。
- 不定义最终弹幕语料库。
- 不定义弹幕社区运营尺度。
- 不定义新闻长文、赛后采访和媒体站。
- 不定义奖项评分公式。
- 不实现真实视频剪辑，只预留接口。
- 不公开展示真实 `driverModelId` 或 `modelName`。

## 5. 已确认产品决策

### 5.1 解说风格保持开放接口

当前阶段不冻结具体解说人格、语料库、口癖、语言风格和栏目包装。

P2.3 只定义：

```text
Caster Profile 的接口位置。
Caster Generator 的输入输出。
Caster Line 的结构。
质量闸门和事实边界。
fallback 模板规则。
后续语料库接入点。
```

不做以下假设：

```text
不假设最终解说是热血、冷静、毒舌、专业或搞笑。
不假设最终解说有固定口癖。
不假设最终解说模仿任何真实主播或真实解说。
不假设最终解说使用固定栏目格式。
```

### 5.2 弹幕尺度保持开放接口

当前阶段不冻结最终弹幕语料、直播间文化、梗库、黑话和尺度。

P2.3 只定义：

```text
Barrage Library 的接口位置。
Barrage Generator 的输入输出。
Barrage Message 的结构。
弹幕强度、时间线和来源追溯。
内容安全和降级规则。
后续弹幕资料库接入点。
```

不做以下假设：

```text
不假设最终弹幕是克制、狂热、阴阳怪气、饭圈化或纯技术讨论。
不假设最终弹幕词库。
不把当前 fallback 弹幕视为最终风格。
```

### 5.3 支持率进入 UI

支持率（Support Rate）第一版可以进入 UI。

边界：

```text
支持率是观赛氛围指标。
支持率不是赔率。
支持率不是投注建议。
支持率不接真钱。
支持率不参与裁判、统计、经济和奖项。
支持率可以进入直播页、地图间停顿页和赛后复盘页。
```

### 5.4 不公开展示真实驾驶员模型

观众页面不展示真实 `driverModelId`、`providerId`、`modelName`。

允许展示：

```text
agent displayName
agent role
team displayName
虚构风格标签
比赛内状态
```

只在管理与调试视图展示：

```text
driverModelId
providerId
modelName
llm_calls
token usage
fallback record
```

### 5.5 回放卡片第一版文本化，后续预留视频剪辑

第一版回放卡片（Replay Card）是文本卡片和跳转入口。

第一版支持：

```text
标题。
摘要。
地图名。
回合号。
高光类型。
跳转到回合开场。
来源事件 ID。
来源 RoundReport。
```

后续预留：

```text
videoClipArtifactId
clipStatus
clipStartMs
clipEndMs
clipStoryboard
clipRenderJobId
```

后续真正视频剪辑不应改变 P2.3 的事实边界。

## 6. 总体数据流

### 6.1 一回合转播流

```text
Round completed
  ↓
RoundReport created
  ↓
Event Log committed
  ↓
Broadcast Planner
  ↓
Kill Feed Builder
  ↓
Caster Generator
  ↓
Barrage Generator
  ↓
Support Rate Calculator
  ↓
Highlight Detector
  ↓
Replay Card Builder
  ↓
Broadcast Quality Gate
  ↓
BroadcastItem / broadcast Event
  ↓
Timeline Projector
  ↓
Web Live Player / CLI Replay
```

### 6.2 同步路径与异步路径

同步路径：

```text
RoundReport
Event
Score
Economy
Round / MapGame / Match 状态
```

异步或可延后路径：

```text
kill_feed_created
caster_line_created
barrage_created
support_rate_updated
highlight_detected
replay_card_created
BroadcastItem
TimelineEvent 重建
```

第一版 fake provider 可以在同一命令中顺序生成这些包装内容，但架构上必须视为可异步任务。

### 6.3 最小可用链路

P2.3 最小可用链路：

```text
RoundReport.keyEvents
  -> kill_feed

RoundReport.summary
  -> fallback caster_line

RoundReport.highlightTags + score + economy
  -> highlight

RoundReport + match state
  -> support_rate

RoundReport + highlight
  -> replay_card

BroadcastItem
  -> TimelineEvent payload
```

即使没有真实 LLM、没有最终解说库、没有最终弹幕库，也必须能生成基础转播内容。

## 7. 上游依赖

| 上游 | P2.3 消费内容 | 用途 |
|---|---|---|
| P0.1 领域模型 | Match、MapGame、Round、Team、Agent、BroadcastItem、Highlight | 业务对象关系。 |
| P0.2 事件分类 | broadcast 类事件、sourceEventIds、事实和包装边界 | 事件写入与追溯。 |
| P1.1 回合战报契约 | RoundReport、keyEvents、summary、highlightTags、agentOutputs | 生成击杀播报、解说、弹幕、高光。 |
| P1.2 Token 经济说明 | buyType、economyDelta、Output Gate 结果 | 生成经济叙事和支持率变化。 |
| P1.3 大模型驾驶员契约 | caster / barrage / replay_card 任务接口 | 后续真实 LLM 接入。 |
| P1.5 本地持久化说明 | broadcast_items、highlights、jobs、artifacts | 入库、重建和导出。 |
| P2.1 直播时间线说明 | TimelineEvent、caster_line、barrage_stream、highlight_reveal | 播放投影。 |
| P2.2 2D 战术地图说明 | zoneId、highlight flash、地图区域 | 地图与转播统一语义。 |

## 8. 下游消费者

| 下游 | 消费 P2.3 内容 | 用途 |
|---|---|---|
| Web Live Player | BroadcastItem、TimelineEvent payload、SupportRate | 直播页展示。 |
| CLI Replay | kill feed、caster、barrage 摘要、highlight | 本地验证和调试。 |
| 2D Tactical Renderer | highlight、kill feed zone、replay card jump target | 地图高光联动。 |
| News & Media | replay_card、highlight、support_rate trend | 后续新闻素材。 |
| Stats & Awards | highlight candidate | 后续奖项候选，不直接用弹幕或解说。 |
| Admin Debug | generationMode、qualityStatus、sourceEventIds | 审查、重建和问题定位。 |
| Export JSON | BroadcastItem、Highlight、ReplayCard | 完整比赛导出。 |

## 9. 核心对象

### 9.1 转播来源包（BroadcastSourceBundle）

转播生成器不应到处临时查询字段。第一版建议把一回合所需输入封装为来源包：

```ts
type BroadcastSourceBundle = {
  tournamentId: string;
  matchId: string;
  mapGameId: string;
  roundId: string;
  mapName: string;
  roundNumber: number;
  teamA: BroadcastTeamIdentity;
  teamB: BroadcastTeamIdentity;
  roundReport: RoundReport;
  sourceEvents: Event[];
  scoreContext: BroadcastScoreContext;
  economyContext: BroadcastEconomyContext;
  previousSupportRate?: SupportRateSnapshot;
  mapSummary?: Summary;
  matchSummary?: Summary;
};
```

约束：

```text
必须包含 RoundReport。
必须包含可追溯 sourceEvents。
不得包含 RawOutput 正文。
不得包含未提交的 raw agent output。
不得包含观众页不应展示的真实 modelName。
```

### 9.2 转播队伍身份（BroadcastTeamIdentity）

```ts
type BroadcastTeamIdentity = {
  teamId: string;
  displayName: string;
  shortName: string;
  agents: Array<{
    agentId: string;
    displayName: string;
    role: string;
  }>;
};
```

禁止字段：

```text
driverModelId
providerId
modelName
api usage
rawOutput
```

### 9.3 转播条目（BroadcastItem）

`BroadcastItem` 是 P2.3 的核心派生物。它保存转播包装内容全文和结构化 payload。

```ts
type BroadcastItemKind =
  | "kill_feed"
  | "caster_line"
  | "barrage"
  | "support_rate"
  | "replay_card";

type BroadcastTaskKind = BroadcastItemKind | "highlight_detection";

type BroadcastItem = {
  id: string;
  kind: BroadcastItemKind;
  tournamentId: string;
  matchId?: string;
  mapGameId?: string;
  roundId?: string;
  title?: string;
  content: string;
  payload: unknown;
  sourceEventIds: string[];
  sourceRoundReportId?: string;
  generationMode: "rule" | "llm" | "fallback_template" | "manual";
  qualityStatus: "ready" | "fallback" | "needs_review" | "rejected";
  createdAt: string;
};
```

字段约束：

- `sourceEventIds` 不能为空。
- `generationMode = "llm"` 时应能追溯到 `llm_calls` 或 Artifact。
- `qualityStatus = "rejected"` 的条目默认不进入观众 Timeline。
- `BroadcastItem` 不能作为比赛事实。
- 同一 round 同一 kind 可以重生成，但必须保留新旧版本的审计信息或稳定替换策略。

高光边界：

```text
Highlight 是独立派生实体，不是 BroadcastItem.kind。
highlight_detected 事件生成或更新 Highlight。
highlight_reveal TimelineEvent 消费 Highlight。
replay_card 是 BroadcastItem，可以引用 Highlight。
```

这样保持 P1.5 的 `highlights` 表和 `broadcast_items` 表职责分离。

### 9.4 生成模式（GenerationMode）

| 代码值 | 中文名 | 说明 |
|---|---|---|
| `rule` | 规则生成 | 不调用模型，基于结构化字段生成。 |
| `llm` | 大模型生成 | 后续真实 LLM 接入时使用。 |
| `fallback_template` | 模板兜底 | 上游缺失或生成失败时使用。 |
| `manual` | 人工修正 | 管理员手动修改或录入。 |

### 9.5 质量状态（QualityStatus）

| 代码值 | 中文名 | 是否可展示 | 说明 |
|---|---|---|---|
| `ready` | 可展示 | 是 | 通过质量闸门。 |
| `fallback` | 兜底可展示 | 是 | 内容较基础，但不影响事实。 |
| `needs_review` | 需要审查 | debug 可见 | 不进入观众模式。 |
| `rejected` | 已拒绝 | 否 | 不进入 Timeline。 |

## 10. 转播编排器（Broadcast Planner）

### 10.1 职责

转播编排器决定一个 round 需要生成哪些转播条目，以及每个条目的优先级。

输入：

```text
BroadcastSourceBundle
BroadcastConfig
已有 BroadcastItem
失败或重试记录
```

输出：

```text
BroadcastPlan
```

### 10.2 类型草案

```ts
type BroadcastPlan = {
  roundId: string;
  requiredItems: BroadcastPlannedItem[];
  optionalItems: BroadcastPlannedItem[];
  warnings: string[];
};

type BroadcastPlannedItem = {
  kind: BroadcastTaskKind;
  priority: "critical" | "normal" | "low";
  generationModePreference: Array<"rule" | "llm" | "fallback_template">;
  reason: string;
};
```

### 10.3 第一版默认计划

每个 completed round 至少生成：

```text
kill_feed：required
caster_line：required
support_rate：required
highlight_detection：optional，但有 highlightTags 时 required
replay_card：optional，高光回合 required
barrage：required for viewer demo，后续弹幕库未接入前使用普通弹幕 fallback
```

说明：

```text
kill_feed 可以规则生成，因此 required。
caster_line 即使没有最终解说库，也可以用 summary 兜底生成一句 recap。
support_rate 已确认进入 UI，因此 required。
barrage 因最终语料库后置，第一版使用普通弹幕验证功能完整性，后续由 BarrageLibrary 替换。
```

## 11. 击杀播报（Kill Feed）

### 11.1 定位

击杀播报不是传统 FPS 的真实击杀，而是把 Agent Major 的关键事件电竞化展示。

来源：

```text
RoundReport.keyEvents
RoundReport.summary
sourceEventIds
Team / Agent 展示身份
P2.2 zoneId
```

### 11.2 Payload

```ts
type KillFeedPayload = {
  items: KillFeedItem[];
  source: "round_report_key_events" | "fallback_summary";
};

type KillFeedItem = {
  id: string;
  keyEventId?: string;
  actorAgentId: string;
  actorTeamId: string;
  targetAgentId?: string;
  targetTeamId?: string;
  verb: KillFeedVerb;
  zoneId: string;
  impact: string;
  displayText: string;
};

type KillFeedVerb =
  | "击穿"
  | "反制"
  | "收束"
  | "撬动经济"
  | "完成转化"
  | "打出高光"
  | "推进";
```

### 11.3 规则映射

| RoundKeyEvent.type | 默认动词 | 说明 |
|---|---|---|
| `entry` | 击穿 | 打开关键入口或核心论点。 |
| `trade` | 反制 | 对对手动作做交换和回应。 |
| `clutch` | 收束 | 高压下完成残局。 |
| `economy_swing` | 撬动经济 | 经济差、强起、保经济或输出效率造成变化。 |
| `conversion` | 完成转化 | 把入口优势转成得分结果。 |
| `highlight` | 打出高光 | 无法归类但需要展示的关键事件。 |

### 11.4 约束

- 优先规则生成，不需要 LLM。
- 每个 keyEvent 最多生成 1 条 kill feed。
- 一回合建议展示 1-3 条。
- 如果 keyEvents 超过 3 条，优先展示 `clutch`、`conversion`、`economy_swing`。
- displayText 必须来自结构化字段拼装，不得新增不存在的事实。
- 未识别 type 时使用 `推进`。

### 11.5 降级

| 异常 | 降级 |
|---|---|
| keyEvents 为空 | 从 RoundReport.summary 生成 1 条 fallback。 |
| actorAgentId 缺失 | 使用队伍名，不显示 agent。 |
| targetAgentId 缺失 | 展示为对对手整体造成影响。 |
| zoneId 未知 | 保留原 zoneId，地图层使用 fallback zone。 |

## 12. 主解说接口（Caster Interface）

### 12.1 定位

主解说接口只定义数据结构和生成边界，不定义最终解说人格。

第一版只支持：

```text
一名主解说（main_caster）。
每个 round 至少 1 条 recap 或 analysis。
真实解说风格库后续接入。
```

不支持：

```text
多解说席。
固定最终解说人设。
固定口癖。
模仿真实主播。
完整节目台。
```

### 12.2 CasterProfile 预留接口

```ts
type CasterProfile = {
  id: string;
  displayName: string;
  version: number;
  styleLibraryId?: string;
  phraseLibraryId?: string;
  forbiddenExpressionSetId?: string;
  enabled: boolean;
};
```

第一版可以只使用默认占位：

```json
{
  "id": "caster_default_open_slot",
  "displayName": "默认主解说接口",
  "version": 1,
  "enabled": true
}
```

该对象表示接口存在，不表示最终风格已经确定。

### 12.3 Payload

```ts
type CasterLinePayload = {
  speakerRole: "main_caster";
  line: string;
  tone: "calm" | "hype" | "analysis" | "recap";
  displayDurationMs: number;
  sourceEventIds: string[];
  casterProfileId?: string;
  styleLibraryId?: string;
};
```

### 12.4 输入

```text
RoundReport.summary
RoundReport.keyEvents
RoundReport.highlightTags
scoreBeforeRound / scoreAfterRound
buyType / economyDelta
mapName / roundNumber
```

禁止输入：

```text
rawOutput 正文。
未提交的 raw agent output。
真实 modelName。
观众不可见调试字段。
```

### 12.5 第一版生成策略

在语料库未接入前，第一版采用开放接口加安全兜底：

```text
优先：如果已有 caster_line_created 或 BroadcastItem，则复用。
其次：如果后续 CasterProfile / StyleLibrary 接入，则调用对应生成器。
兜底：从 RoundReport.summary 生成 1 条 recap。
```

兜底模板只保证事实正确，不代表最终解说风格。

### 12.6 质量约束

- 不提前剧透尚未播放到的结果。
- 不新增不存在的击杀、MVP、经济结果。
- 不公开真实模型名。
- 不使用真实主播身份、口癖或可识别模仿。
- 单条建议 40-120 个中文字符。
- 不通过解说修改任何事实。

## 13. 弹幕接口（Barrage Interface）

### 13.1 定位

弹幕接口只定义结构、时间线和语料库接入点，不定义最终弹幕文化。

第一版允许：

```text
弹幕接口存在。
低风险 fallback 弹幕存在。
后续接入专门弹幕资料库和语料库。
```

第一版不冻结：

```text
最终梗库。
最终弹幕尺度。
最终直播间文化。
最终观众阵营语言。
```

### 13.2 BarrageLibrary 预留接口

```ts
type BarrageLibrary = {
  id: string;
  displayName: string;
  version: number;
  phrasePools: BarragePhrasePool[];
  forbiddenExpressionSetId?: string;
  enabled: boolean;
};

type BarragePhrasePool = {
  id: string;
  triggerTags: string[];
  intensity: "low" | "medium" | "high";
  phrases: string[];
};
```

第一版可以只保留接口，不提供正式 phrasePools。

### 13.3 Payload

```ts
type BarragePayload = {
  intensity: "low" | "medium" | "high";
  source: "barrage_library" | "llm" | "fallback_template";
  barrageLibraryId?: string;
  messages: BarrageMessage[];
};

type BarrageMessage = {
  id: string;
  text: string;
  startOffsetMs: number;
  durationMs: number;
  lane?: number;
  weight?: number;
  trigger?: string;
};
```

### 13.4 强度规则

第一版只冻结强度接口，不冻结语料风格。

| 强度 | 建议数量 | 触发条件 |
|---|---:|---|
| `low` | 3-5 | 普通回合，无显著高光。 |
| `medium` | 5-8 | 有关键事件、比分变化、经济波动。 |
| `high` | 8-12 | 加时、赛点、强起翻盘、残局、高光。 |

### 13.5 生成策略

```text
优先：使用后续 BarrageLibrary。
其次：使用 LLM 生成，但必须过质量闸门。
兜底：生成少量普通弹幕，用于验证当前弹幕功能链路。
```

兜底弹幕只用于验证时间线、UI 和基础互动感，不代表最终直播间风格。

普通弹幕 fallback 规则：

```text
普通回合：3-5 条。
信息量大回合：5-8 条。
高光回合：8-12 条。
只使用通用、低风险、事实中性的表达。
后续 BarrageLibrary 接入后，优先使用资料库内容。
```

### 13.6 内容安全底线

即使最终弹幕尺度后续再定，第一版也必须遵守底线：

```text
不做人身攻击。
不输出仇恨、歧视、色情、违法内容。
不冒充真实个人。
不引导赌博。
不泄露真实模型名或 API 信息。
不把弹幕当作事实依据。
```

## 14. 支持率系统（Support Rate System）

### 14.1 定位

支持率是直播氛围的一部分，可以进入 UI。

它表达的是：

```text
观众当前更看好哪一队。
比赛叙事的倾斜程度。
爆冷、反超、连胜、经济翻盘带来的舆论变化。
```

它不表达：

```text
赔率。
胜率模型。
投注建议。
真实用户投票。
裁判依据。
统计事实。
```

### 14.2 Payload

```ts
type SupportRatePayload = {
  scope: "match" | "map" | "round";
  teamASupportRate: number;
  teamBSupportRate: number;
  delta: {
    teamA: number;
    teamB: number;
  };
  reason: string;
  factors: SupportRateFactor[];
  sourceEventIds: string[];
};

type SupportRateSnapshot = {
  scope: "match" | "map" | "round";
  teamASupportRate: number;
  teamBSupportRate: number;
  updatedAfterRoundId?: string;
  formulaVersion: string;
  sourceEventIds: string[];
};

type SupportRateFactor = {
  type:
    | "round_win"
    | "streak"
    | "score_equalizer"
    | "lead_take"
    | "map_point"
    | "overtime"
    | "economy_swing"
    | "highlight"
    | "underdog_win";
  teamId: string;
  weight: number;
  reason: string;
};
```

### 14.3 第一版公式

第一版使用暂定确定性公式，不调用 LLM 直接决定支持率。

后续可以替换为更完善的评分细则，但必须通过显式公式配置或评分资料入口接入：

```ts
type SupportRateFormulaProfile = {
  id: string;
  version: number;
  status: "provisional" | "official";
  scoringRulesArtifactId?: string;
  notes?: string;
};
```

替换规则：

```text
可以修改 factor 权重。
可以新增 factor 类型。
可以调整单回合最大变化和上下限。
必须保留 sourceEventIds。
必须保留 SupportRatePayload 兼容字段。
不能让支持率反向影响比赛事实。
```

输入：

```text
上一回合支持率。
本回合胜者。
比分变化。
是否扳平。
是否反超。
是否图点或赛点。
是否加时。
是否经济劣势取胜。
highlightTags。
RoundReport.judgeResult.roundImpactLevel。
```

基本规则：

```text
初始支持率：50 / 50。
普通回合胜利：胜者 +2 到 +4。
强势回合：胜者 +4 到 +6。
扳平比分：扳平方 +3。
反超比分：反超方 +4。
图点 / 赛点兑现：兑现方 +5。
图点 / 赛点被顶住：防守方 +5。
加时回合：胜者 +3。
经济劣势取胜：胜者 +5。
高光回合：高光方 +3 到 +6。
```

限制：

```text
单回合最大变化不超过 12。
支持率最小为 5，最大为 95。
teamA + teamB 必须等于 100。
同一输入必须生成同一结果。
```

### 14.4 UI 规则

支持率第一版进入伪直播视频播放窗的底侧底部。

```text
主位置：伪直播视频播放窗底侧底部。
可选补充：回合结算区。
可选补充：地图间停顿页。
可选补充：赛后总结页。
```

展示文案必须避免：

```text
赔率。
下注。
稳赚。
盘口。
真实观众投票暗示。
```

推荐展示：

```text
观众支持率
直播间倾向
舆论热度
本回合支持率变化
```

### 14.5 降级

| 异常 | 降级 |
|---|---|
| 上一支持率缺失 | 使用 50 / 50。 |
| factors 计算失败 | 沿用上一回合支持率。 |
| sourceEventIds 缺失 | 不写入 support_rate_updated。 |
| UI 无法渲染 | 不展示支持率，不阻塞 replay。 |

## 15. 高光识别器（Highlight Detector）

### 15.1 定位

高光识别器把事实和回合战报派生成高光候选。

高光可以被：

```text
TimelineEvent.highlight_reveal 消费。
ReplayCard 消费。
后续 Stats / Awards 消费。
后续 News 消费。
```

高光不能：

```text
修改回合结果。
修改 MVP。
修改比分。
创造不存在的关键事件。
```

### 15.2 Payload

```ts
type HighlightPayload = {
  highlightType: string;
  title: string;
  summary: string;
  weight: number;
  tags: string[];
  primaryTeamId?: string;
  primaryAgentId?: string;
  sourceRoundReportId: string;
  sourceEventIds: string[];
};
```

### 15.3 权重规则

第一版高光权重范围：

```text
0 到 100。
60 以上可进入 highlight_reveal。
75 以上可生成 replay_card。
90 以上可作为赛后 Top Plays 候选。
```

建议加权：

| 信号 | 权重 |
|---|---:|
| `clutch` keyEvent | +20 |
| `economy_swing` keyEvent | +15 |
| `conversion` keyEvent | +10 |
| `highlightTags` 非空 | +15 |
| 强起或低配取胜 | +15 |
| 扳平或反超 | +10 |
| 图点 / 赛点 | +15 |
| 加时 | +10 |
| 地图收官 | +15 |

限制：

```text
weight 最大 100。
没有 sourceEventIds 不生成 Highlight。
没有 RoundReport 不生成 Highlight。
```

### 15.4 高光类型

第一版允许的稳定类型：

```text
clutch
economy_swing
force_buy_conversion
buy_disadvantage_win
map_point_conversion
map_point_denial
overtime_round
map_closeout
lead_take
score_equalizer
generic_highlight
```

未知高光标签：

```text
可以保留原 tag。
不能中断生成。
统一降级为 generic_highlight。
```

## 16. 回放卡片（Replay Card）

### 16.1 定位

回放卡片是高光回合的观众入口。

第一版：

```text
文本卡片。
点击跳转到 round_intro。
展示标题、摘要、地图、回合、标签。
```

后续：

```text
可接真正视频剪辑。
可生成 clip storyboard。
可生成短视频导出。
```

### 16.2 Payload

```ts
type ReplayCardPayload = {
  highlightId?: string;
  title: string;
  summary: string;
  matchId: string;
  mapGameId: string;
  roundId: string;
  roundNumber: number;
  mapName: string;
  jumpTarget: ReplayJumpTarget;
  tags: string[];
  sourceEventIds: string[];
  videoClip?: ReplayVideoClipRef;
};

type ReplayJumpTarget = {
  type: "round_intro" | "key_event" | "highlight_reveal";
  timelineEventId?: string;
  atMs?: number;
};

type ReplayVideoClipRef = {
  clipStatus: "not_generated" | "queued" | "ready" | "failed";
  videoClipArtifactId?: string;
  clipStartMs?: number;
  clipEndMs?: number;
  clipRenderJobId?: string;
};
```

### 16.3 第一版跳转规则

默认：

```text
jumpTarget.type = "round_intro"
```

原因：

```text
高光需要上下文。
观众应先看到完整回合过程。
避免直接跳到结算造成剧透。
```

后续可以支持：

```text
jumpTarget.type = "key_event"
jumpTarget.type = "highlight_reveal"
```

### 16.4 视频剪辑预留

第一版不生成视频，但必须保留字段：

```json
{
  "videoClip": {
    "clipStatus": "not_generated"
  }
}
```

后续真正视频剪辑可以由以下输入生成：

```text
TimelineEvent
TacticalMapFrame
caster_line
kill_feed
highlight_reveal
support_rate
ReplayCardPayload
```

视频剪辑生成仍然是派生物，不改变事实源。

## 17. 转播质量闸门（Broadcast Quality Gate）

### 17.1 职责

质量闸门负责在 BroadcastItem 入库或进入 Timeline 前做最小安全检查。

它不负责：

```text
判断比赛胜负。
修正 RoundReport。
改写 Event。
决定最终内容风格。
```

### 17.2 检查项

| 检查项 | 说明 | 失败处理 |
|---|---|---|
| 来源追溯 | `sourceEventIds` 非空。 | rejected。 |
| 事实一致 | 不得说错胜者、比分、地图、回合。 | rejected 或 fallback。 |
| 剧透控制 | 回合中段内容不得提前说结算。 | fallback。 |
| 长度控制 | 解说、弹幕、标题不能过长。 | 截断或 fallback。 |
| 重复度 | 同一 round 内容不能高度重复。 | 降权或重生成。 |
| 安全底线 | 不做人身攻击、歧视、违法、赌博引导。 | rejected。 |
| 模型隐藏 | 不公开 `driverModelId` / `modelName`。 | rejected。 |
| RawOutput 隔离 | 不展示 rawOutput 正文。 | rejected。 |

### 17.3 质量结果

```ts
type BroadcastQualityResult = {
  status: "ready" | "fallback" | "needs_review" | "rejected";
  warnings: string[];
  replacementContent?: string;
};
```

### 17.4 处理策略

```text
ready:
  进入 BroadcastItem 和 Timeline。

fallback:
  使用兜底内容进入 Timeline。

needs_review:
  仅 debug mode 可见，不进入 viewer mode。

rejected:
  不进入 Timeline，可记录 admin/debug。
```

## 18. 事件契约

P2.3 使用 P0.2 已定义的 broadcast 事件。

### 18.1 击杀播报生成（kill_feed_created）

```ts
type KillFeedCreatedPayload = {
  schemaVersion: 1;
  roundId: string;
  items: KillFeedItem[];
  sourceEventIds: string[];
};
```

### 18.2 解说台词生成（caster_line_created）

```ts
type CasterLineCreatedPayload = {
  schemaVersion: 1;
  speakerRole: "main_caster";
  line: string;
  tone: "calm" | "hype" | "analysis" | "recap";
  sourceEventIds: string[];
  casterProfileId?: string;
  styleLibraryId?: string;
};
```

### 18.3 弹幕生成（barrage_created）

```ts
type BarrageCreatedPayload = {
  schemaVersion: 1;
  messages: BarrageMessage[];
  intensity: "low" | "medium" | "high";
  sourceEventIds: string[];
  barrageLibraryId?: string;
};
```

### 18.4 支持率更新（support_rate_updated）

```ts
type SupportRateUpdatedPayload = {
  schemaVersion: 1;
  scope: "match" | "map" | "round";
  teamASupportRate: number;
  teamBSupportRate: number;
  delta: {
    teamA: number;
    teamB: number;
  };
  reason: string;
  factors: SupportRateFactor[];
  sourceEventIds: string[];
};
```

### 18.5 高光识别（highlight_detected）

```ts
type HighlightDetectedPayload = {
  schemaVersion: 1;
  highlightType: string;
  title: string;
  roundId: string;
  weight: number;
  tags: string[];
  sourceEventIds: string[];
  sourceRoundReportId?: string;
};
```

当前代码兼容说明：

```text
Phase 1.4 现有代码已经会写入 highlight_detected，但 payload 是最小版本：
  tags
  mvpAgentId
  reason

P2.3 中的 HighlightDetectedPayload 是后续实现目标。
Phase 1.5 前置评审期间，不要求立刻破坏旧 replay。
后续实现时可以通过兼容解析器把旧 payload 归一化为 HighlightPayload。
```

### 18.6 回放卡片生成（replay_card_created）

```ts
type ReplayCardCreatedPayload = {
  schemaVersion: 1;
  replayCardId: string;
  highlightId?: string;
  title: string;
  summary: string;
  roundId: string;
  jumpTarget: ReplayJumpTarget;
  sourceEventIds: string[];
  videoClip?: ReplayVideoClipRef;
};
```

## 19. TimelineEvent 勾稽

P2.3 不直接控制播放时间，但会为 P2.1 的 TimelineEvent 提供 payload。

| 来源对象 | 对应 TimelineEvent.kind | 说明 |
|---|---|---|
| `BroadcastItem.kind = kill_feed` | `kill_feed_item` | 展示关键事件条。 |
| `BroadcastItem.kind = caster_line` | `caster_line` | 展示主解说。 |
| `BroadcastItem.kind = barrage` | `barrage_stream` | 持续弹幕流。 |
| `BroadcastItem.kind = support_rate` | `scoreboard_update` 或后续 `support_rate_update` | UI 支持率变化。 |
| `Highlight` | `highlight_reveal` | 回合后揭示高光。 |
| `BroadcastItem.kind = replay_card` | `replay_card_teaser` 预留 | 后续回放卡片入口。 |

当前 P2.1 没有标准 `support_rate_update`，第一版可把支持率放进：

```text
scoreboard_update.payload.supportRate
round_result.payload.supportRate
```

如果后续支持率 UI 复杂化，再新增 `support_rate_update` TimelineEventKind，并先更新 P2.1。

## 20. 持久化与重生成

### 20.1 入库对象

P2.3 推荐入库：

```text
broadcast_items
highlights
events
timeline_events
jobs
artifacts 可选
llm_calls 可选
```

### 20.2 重生成触发

以下情况可以重生成转播内容：

```text
解说语料库更新。
弹幕语料库更新。
支持率公式调整。
高光权重调整。
回放卡片模板调整。
质量闸门规则调整。
Timeline payload 结构调整。
```

### 20.3 重生成约束

- 重生成必须基于相同事实源。
- 重生成不能修改 Event 事实事件。
- 重生成必须保留或重新计算 `sourceEventIds`。
- 如果覆盖旧 BroadcastItem，应保留管理审计或版本记录。
- 同一配置和同一输入下应尽量确定性输出。

## 21. 队列与任务

### 21.1 Job 类型

P2.3 建议使用以下任务类型：

```text
generate_round_broadcast
generate_kill_feed
generate_caster_line
generate_barrage
calculate_support_rate
detect_highlight
generate_replay_card
regenerate_broadcast_item
```

### 21.2 优先级

| Job | 优先级 | 原因 |
|---|---|---|
| `generate_kill_feed` | high | 直播页基础信息。 |
| `calculate_support_rate` | high | 已决定进入 UI。 |
| `detect_highlight` | normal | 高光影响回放。 |
| `generate_replay_card` | normal | 高光入口。 |
| `generate_caster_line` | normal | 有 fallback。 |
| `generate_barrage` | low | 最终语料库后置，可延后。 |

### 21.3 失败处理

| Job | 失败处理 |
|---|---|
| kill feed | 用 keyEvents 规则 fallback。 |
| caster | 用 RoundReport.summary 生成 recap fallback。 |
| barrage | 跳过或低密度 fallback。 |
| support rate | 沿用上一支持率。 |
| highlight | 只使用 highlightTags。 |
| replay card | 不展示卡片。 |

所有失败都不阻塞 M05 比赛推进。

## 22. 与真实 LLM 的关系

### 22.1 当前阶段

当前 P2.3 只冻结接口，不要求真实 LLM。

fake provider / rule builder 必须能跑通：

```text
kill feed
caster fallback
barrage fallback
support rate
highlight
replay card
```

### 22.2 后续 Phase 1.5

真实 LLM 小范围接入时，P2.3 的推荐顺序：

```text
1. 先接 caster_line。
2. 再接 barrage。
3. 再接 replay_card 文案增强。
4. 不让 LLM 直接决定 support_rate。
5. 不让 LLM 直接决定 highlight weight 的基础分，只允许生成标题和摘要。
```

原因：

```text
解说、弹幕、回放文案是包装层，失败可降级。
支持率和高光权重更适合先保持确定性，避免调试困难。
```

### 22.3 LLM 输出质量约束

LLM 生成内容必须过质量闸门。

LLM 不允许：

```text
生成不存在的比分。
生成不存在的地图结果。
生成不存在的 agent 行为。
引用 rawOutput 中未提交内容。
公开真实模型名。
绕过 sourceEventIds。
```

## 23. 安全、权益与展示边界

### 23.1 真实模型隐藏

观众页不展示：

```text
driverModelId
providerId
modelName
llm provider
真实 token
真实 cost
```

### 23.2 真实人物与真实主播边界

转播系统不能：

```text
冒充真实主播。
模仿真实主播可识别口癖。
声称官方授权。
使用真实赛事版权素材。
复刻真实队标或真实选手人格。
```

### 23.3 弹幕安全底线

弹幕资料库后续可以定义具体尺度，但第一版底线不变：

```text
不做人身攻击。
不输出歧视内容。
不引导赌博。
不泄露调试信息。
不构造真实人物谣言。
```

## 24. 配置对象

### 24.1 BroadcastConfig

```ts
type BroadcastConfig = {
  killFeed: {
    enabled: boolean;
    maxItemsPerRound: number;
  };
  caster: {
    enabled: boolean;
    mode: "open_profile_interface";
    fallbackEnabled: boolean;
    casterProfileId?: string;
  };
  barrage: {
    enabled: boolean;
    mode: "open_library_interface";
    fallbackEnabled: boolean;
    ordinaryFallbackEnabled: boolean;
    barrageLibraryId?: string;
    defaultIntensity: "low" | "medium" | "high" | "auto";
  };
  supportRate: {
    enabled: boolean;
    visibleInUi: boolean;
    uiPlacement: "video_bottom_side_bottom";
    formulaMode: "provisional_v1" | "formula_profile";
    formulaProfileId?: string;
    initialTeamASupportRate: number;
    maxSingleRoundDelta: number;
    minRate: number;
    maxRate: number;
  };
  highlight: {
    enabled: boolean;
    revealThreshold: number;
    replayCardThreshold: number;
  };
  replayCard: {
    enabled: boolean;
    defaultJumpTarget: "round_intro";
    videoClipMode: "reserved_not_generated" | "queued" | "enabled";
  };
  qualityGate: {
    enabled: boolean;
    rejectFactMismatch: boolean;
    hideDriverModelNames: boolean;
  };
};
```

### 24.2 Phase 1 默认配置

```json
{
  "killFeed": {
    "enabled": true,
    "maxItemsPerRound": 3
  },
  "caster": {
    "enabled": true,
    "mode": "open_profile_interface",
    "fallbackEnabled": true
  },
  "barrage": {
    "enabled": true,
    "mode": "open_library_interface",
    "fallbackEnabled": true,
    "ordinaryFallbackEnabled": true,
    "defaultIntensity": "auto"
  },
  "supportRate": {
    "enabled": true,
    "visibleInUi": true,
    "uiPlacement": "video_bottom_side_bottom",
    "formulaMode": "provisional_v1",
    "initialTeamASupportRate": 50,
    "maxSingleRoundDelta": 12,
    "minRate": 5,
    "maxRate": 95
  },
  "highlight": {
    "enabled": true,
    "revealThreshold": 60,
    "replayCardThreshold": 75
  },
  "replayCard": {
    "enabled": true,
    "defaultJumpTarget": "round_intro",
    "videoClipMode": "reserved_not_generated"
  },
  "qualityGate": {
    "enabled": true,
    "rejectFactMismatch": true,
    "hideDriverModelNames": true
  }
}
```

## 25. MVP 实现建议

### 25.1 最小代码模块

后续工程实现时，建议模块：

```text
packages/core/src/broadcast.ts
packages/core/src/broadcast-support-rate.ts
packages/core/src/broadcast-highlight.ts
packages/core/src/broadcast-replay-card.ts
```

或先集中在一个模块中，稳定后再拆分。

### 25.2 最小 Repository

需要或复用：

```text
BroadcastRepository
EventRepository
RoundReportRepository
TimelineRepository
JobRepository
```

第一版如果 `broadcast_items` 表尚未实现，可以先通过 broadcast events 和 Timeline payload 承载，但接口上仍保留 BroadcastItem 概念。

### 25.3 最小 UI

直播页第一版可展示：

```text
支持率条。
击杀播报。
主解说。
弹幕层。
高光卡片。
回放卡片列表。
```

支持率进入 UI 的最低要求：

```text
显示 teamA / teamB 支持率百分比。
显示本回合变化 delta。
显示一句 reason。
不出现赔率或投注措辞。
```

## 26. 验收标准

### 26.1 文档验收

- 明确 P2.3 是包装层，不是事实源。
- 明确解说风格只保留开放接口，不冻结具体人格和语料。
- 明确弹幕尺度只保留开放接口，不冻结最终语料库。
- 明确支持率可以进入 UI。
- 明确支持率第一版放在伪直播视频播放窗底侧底部。
- 明确支持率公式为暂定方案，并预留后续评分细则接口。
- 明确观众页不公开真实 `driverModelId` / `modelName`。
- 明确回放卡片第一版文本化，后续预留视频剪辑。
- 明确 Highlight 是独立派生实体，不是 BroadcastItem.kind。
- 明确每类 BroadcastItem 的输入、输出、降级和质量闸门。

### 26.2 工程验收

后续实现 P2.3 时应满足：

- 同一个 RoundReport 能生成 1-3 条 kill feed。
- 同一个 RoundReport 能生成 1 条 caster fallback。
- 同一个 RoundReport 能生成普通 barrage fallback 或 library barrage。
- 每个 round 都能计算 support_rate。
- 有高光信号的 round 能生成 highlight。
- 高光权重大于阈值时能生成 replay_card。
- 每个 BroadcastItem 都有 `sourceEventIds`。
- 质量闸门能拒绝事实错误内容。
- 观众页不展示真实模型名。
- 包装生成失败不阻塞比赛。
- TimelineEvent 可以消费 BroadcastItem。

### 26.3 回归验收

P2.3 实现后，既有验收不能退化：

```text
pnpm typecheck
pnpm test
pnpm build
pnpm phase13:match
pnpm phase13:replay
pnpm phase13:export
```

## 27. 与其他文档关系

| 文档 | P2.3 消费内容 | P2.3 输出内容 |
|---|---|---|
| P0.2 事件分类 | broadcast events、事实/包装边界 | 更细 payload 和生成规则。 |
| P1.1 回合战报契约 | keyEvents、summary、highlightTags | kill feed、caster、barrage、高光。 |
| P1.3 大模型驾驶员契约 | caster / barrage / replay_card 调用入口 | 包装任务的 LLM 边界。 |
| P1.5 本地持久化说明 | broadcast_items、highlights、jobs | 入库和重生成要求。 |
| P2.1 直播时间线说明 | TimelineEvent kind | 转播 payload 进入播放层。 |
| P2.2 2D 战术地图说明 | zoneId、highlight flash | 地图与转播高光联动。 |
| P3.1 数据统计与奖项 | 后续消费高光候选 | 奖项素材，但不让弹幕/解说决定奖项。 |
| P3.2 新闻与媒体 | 后续消费 replay_card、highlight、support trend | 新闻素材。 |
| P3.3 素材库 | 后续提供 CasterProfile、BarrageLibrary | 风格和语料库接入点。 |

## 28. 待确认问题（Open Questions）

这些问题不阻塞 P2.3 评审稿，也不阻塞 Phase 1.5 前置评审，但会影响后续实现细节。

### 28.1 已确认但后续可调

```text
支持率第一版使用暂定确定性公式。
支持率第一版进入伪直播视频播放窗底侧底部。
弹幕资料库未接入前，使用普通弹幕 fallback 验证功能链路。
解说和弹幕保留开放接口，后续由专门语料库和风格库补齐。
观众页不公开真实 driverModelId / providerId / modelName。
回放卡片第一版文本化，后续预留真正视频剪辑。
P2.3 当前不标记 Frozen，等 Phase 1.5 结束后再评估冻结。
```

### 28.2 Phase 1.5 前置评审需要确认

```text
1. 真实 LLM 第一个接入任务是 caster_line、barrage，还是 replay_card 文案增强。
2. BroadcastItem 是否在 Phase 1.5 直接落表，还是先继续由 broadcast events 和 Timeline payload 承载。
3. 现有 highlight_detected 最小 payload 何时升级到 P2.3 目标 payload。
4. 支持率 UI 在底侧底部的具体布局，是横向条、双柱条，还是小型趋势条。
5. 普通弹幕 fallback 是否需要进入快照测试和 golden sample。
6. 后续 CasterProfile / BarrageLibrary 属于 P3.3 素材库，还是在 Phase 1.5 先建立最小本地 JSON。
```

### 28.3 暂不处理

```text
不在 P2.3 当前版本定义最终解说人格。
不在 P2.3 当前版本定义最终弹幕尺度。
不在 P2.3 当前版本定义完整支持率评分细则。
不在 P2.3 当前版本实现真实视频剪辑。
不在 P2.3 当前版本公开模型驾驶员身份。
```

## 29. 当前结论

P2.3 的第一版边界已经清晰：

```text
转播系统包装事实，但不生产比赛事实。
解说和弹幕先保留开放接口，等待后续专门语料库。
支持率可以进入 UI，但不是赔率、不是事实、不是投注。
支持率第一版使用暂定公式，后续可通过公式配置替换。
支持率第一版放在伪直播视频播放窗底侧底部。
弹幕库未接入前使用普通弹幕 fallback 验证链路。
Highlight 是独立派生实体，BroadcastItem 只保存转播包装内容。
回放卡片第一版是文本入口，后续预留视频剪辑。
真实模型名不进入观众页面。
所有包装内容都必须可追溯、可降级、可重建。
```

完成 P2.3 评审稿后，Agent Major 的 Phase 1 fake provider MVP 已具备进入真实 LLM 小范围接入前的主要观看层边界。

下一步建议：

```text
先做 Phase 1.5 前置评审。
选择最小真实 LLM 接入点。
优先接入可失败降级的包装任务，而不是直接替换核心裁判路径。
```
