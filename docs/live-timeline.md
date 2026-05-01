# P2.1 直播时间线说明（Live Timeline Spec）

## 1. 文档定位

P2.1 定义 Agent Major 的伪直播播放层。

它回答的问题是：

```text
比赛事实已经写入 Event Log 后，观众应该在第几秒看到什么？
一回合如何被播放成 60-90 秒的直播体验？
CLI replay 和 Web Live 页面如何消费同一套播放契约？
TimelineEvent 如何入库、重建、倍速播放和追溯事实来源？
```

一句话：

> 事件（Event）记录真实发生了什么；时间线事件（TimelineEvent）决定观众在第几秒看到什么。

P2.1 是从事实账本到观赛体验的投影层。它不是比赛模拟、不是裁判、不是 2D 地图细节、也不是解说生成系统。

## 2. 本文档负责

- 定义时间线事件（TimelineEvent）的结构。
- 定义时间线类型（TimelineEventKind）。
- 定义事件（Event）到时间线事件（TimelineEvent）的投影规则。
- 定义单回合 60-90 秒播放节奏。
- 定义地图内自动连续播放规则。
- 定义倍速、暂停、跳转、高光回放规则。
- 定义持续弹幕的时间线表达。
- 定义单主解说的时间线表达。
- 定义高光只能在回合结束后播放。
- 定义 CLI Player 和 Web Live Player 共用同一套 TimelineEvent。
- 定义 TimelineEvent 必须入库，但不是事实源，可以重建。
- 定义 debug mode 和 viewer mode 的播放差异。

## 3. 本文档不负责

- 不决定比赛胜负。
- 不生成裁判判定。
- 不定义 RoundReport 完整结构。
- 不定义 Token 经济公式。
- 不定义 2D 地图具体美术和动画细节。
- 不生成解说文本。
- 不生成弹幕文本。
- 不定义新闻、奖项、数据统计公式。
- 不读取大模型原始输出（RawOutput）。

## 4. 核心边界

### 4.1 Event 是事实源

事件（Event）是系统事实账本。

```text
Event 可以用于恢复比赛事实。
Event 可以用于统计、新闻、奖项、审计。
Event 不应被随意修改。
```

典型事实事件：

```text
round_started
buy_type_decided
output_gate_applied
judge_decision_created
score_updated
economy_updated
round_report_created
round_completed
```

### 4.2 TimelineEvent 是播放投影

时间线事件（TimelineEvent）是播放脚本。

```text
TimelineEvent 从 Event 投影生成。
TimelineEvent 必须入库缓存。
TimelineEvent 可以删除后重建。
TimelineEvent 不能成为比赛事实依据。
TimelineEvent 不能反写 Event。
```

典型播放事件：

```text
round_intro
scoreboard_update
economy_panel_update
map_control_update
kill_feed_item
caster_line
barrage_stream
highlight_reveal
round_result
round_outro
```

### 4.3 事实顺序不等于播放顺序

事件日志中的 `globalSequence` 和 `sequenceInScope` 表示事实顺序。

时间线事件中的 `atMs` 表示播放时间点。

```text
事实顺序用于恢复和审计。
播放顺序用于观赛体验。
```

例如 `round_report_created` 可能一次性包含关键事件、高光标签、经济变化和摘要，但播放时需要拆成几十秒的地图控制、击杀播报、解说、弹幕和回合结算。

## 5. 播放模式

### 5.1 观众模式（viewer mode）

观众模式用于最终展示。

规则：

- 地图内自动连续播放。
- 回合结束后自动进入下一回合。
- 不显示审查窗口。
- 不显示调试信息。
- 允许暂停、倍速、跳高光，但不允许修改内容。

### 5.2 调试模式（debug mode）

调试模式仅给操作者使用。

规则：

- 回合结束后可以进入审查窗口。
- 审查窗口可以暂停地图自动运行。
- 可以查看来源事件、投影结果、原始 RoundReport、Artifact 引用。
- 可以触发重建 TimelineEvent。
- 可以重生成包装内容，但必须保留审计事件。

### 5.3 审查窗口边界

审查窗口不是观众体验的一部分。

```text
viewer mode: 不展示审查窗口，自动继续播放。
debug mode: 展示审查窗口，仅管理员可见。
```

审查窗口不改变比赛事实。任何修正必须通过管理事件或修正流程追溯。

## 6. 时间线事件结构

### 6.1 顶层字段

| 中文字段 | 代码字段 | 类型草案 | 必填 | 说明 |
|---|---|---|---|---|
| 时间线事件 ID | `id` | `string` | 是 | 稳定引用 ID。 |
| 所属赛事 ID | `tournamentId` | `string` | 是 | 指向 Tournament。 |
| 所属比赛 ID | `matchId` | `string` | 否 | 比赛相关时间线必填。 |
| 所属地图局 ID | `mapGameId` | `string` | 否 | 地图相关时间线必填。 |
| 所属回合 ID | `roundId` | `string` | 否 | 回合相关时间线必填。 |
| 来源事件 ID 列表 | `sourceEventIds` | `string[]` | 是 | 追溯事实来源。 |
| 播放时间点 | `atMs` | `number` | 是 | 相对当前播放作用域的毫秒时间。 |
| 播放持续时间 | `durationMs` | `number` | 否 | 对持续类事件有效。 |
| 时间线类型 | `kind` | `TimelineEventKind` | 是 | 前端或 CLI 渲染类型。 |
| 载荷 | `payload` | `unknown` | 是 | 渲染所需数据。 |
| 播放作用域 | `playbackScope` | `PlaybackScope` | 是 | round / map / match。 |
| 作用域 ID | `playbackScopeId` | `string` | 是 | 对应 roundId / mapGameId / matchId。 |
| 顺序索引 | `sequenceIndex` | `number` | 是 | 同一 atMs 下的稳定顺序。 |
| 创建时间 | `createdAt` | `string` | 是 | 投影生成时间。 |

### 6.2 类型草案

```ts
type TimelineEvent = {
  id: string;
  tournamentId: string;
  matchId?: string;
  mapGameId?: string;
  roundId?: string;
  sourceEventIds: string[];
  atMs: number;
  durationMs?: number;
  kind: TimelineEventKind;
  payload: unknown;
  playbackScope: "round" | "map" | "match";
  playbackScopeId: string;
  sequenceIndex: number;
  createdAt: string;
};
```

### 6.3 约束

- `sourceEventIds` 不能为空。
- `atMs >= 0`。
- 同一 `playbackScope + playbackScopeId` 内，`atMs + sequenceIndex` 必须稳定排序。
- `durationMs` 只用于持续类事件，例如弹幕持续飘过、地图控制状态保持、解说显示时长。
- TimelineEvent 不保存比赛事实，只保存播放投影。
- TimelineEvent 入库是为了缓存、回放性能和本地恢复，不表示它是事实源。

## 7. 播放作用域

### 7.1 回合时间线（Round Timeline）

回合时间线是 P2.1 的最小播放单位。

```text
playbackScope = round
playbackScopeId = roundId
```

用途：

- 单回合 replay。
- CLI 验证事实链。
- Web 页面播放一回合。
- 高光回放卡片跳转。

### 7.2 地图时间线（Map Timeline）

地图时间线由多个回合时间线串联而成。

```text
playbackScope = map
playbackScopeId = mapGameId
```

用途：

- 地图内自动连续播放。
- 回合之间插入短过渡。
- `map_completed` 后进入地图总结或下一张地图。

### 7.3 比赛时间线（Match Timeline）

比赛时间线由地图禁选、地图时间线和比赛结算组成。

```text
playbackScope = match
playbackScopeId = matchId
```

用途：

- BO3 replay。
- 比赛页完整回放。
- 赛后复盘入口。

## 8. 时间线类型

### 8.1 第一版必须支持

| 类型 | 中文名 | 作用域 | 用途 |
|---|---|---|---|
| `round_intro` | 回合开场 | round | 展示回合号、比分、地图、双方队伍。 |
| `scoreboard_update` | 比分牌更新 | round / map / match | 更新比分、BO3 分数、回合结果。 |
| `economy_panel_update` | 经济面板更新 | round | 展示双方购买类型、Agent 经济、drop、save、force buy。 |
| `agent_state_update` | 智能体状态更新 | round | 展示激活智能体、状态、输出额度裁剪。 |
| `map_control_update` | 地图控制变化 | round | 第一版虚拟控制区变化。 |
| `kill_feed_item` | 击杀播报条目 | round | 由关键事件或 `kill_feed_created` 投影。 |
| `caster_line` | 主解说台词 | round / map / match | 展示唯一主解说发言。 |
| `barrage_stream` | 持续弹幕流 | round | 按时间持续飘过弹幕。 |
| `highlight_reveal` | 高光揭示 | round | 回合结束后展示高光判定。 |
| `round_result` | 回合结果 | round | 展示胜者、比分变化、胜负手。 |
| `round_outro` | 回合收尾 | round | 自动进入下一回合或进入 debug 审查窗口。 |
| `pause_marker` | 暂停标记 | map / match | debug 或技术暂停播放标记。 |

### 8.2 第一版预留但可以不实现

| 类型 | 中文名 | 预留原因 |
|---|---|---|
| `agent_move` | 智能体移动 | 后期更细 2D 地图和 Agent 移动效果。 |
| `agent_path` | 智能体路径 | 后期路径动画。 |
| `zone_pressure_update` | 区域压力变化 | 后期比 `map_control_update` 更细。 |
| `replay_card_teaser` | 回放卡片预告 | 后期 Top Plays 或回放页。 |
| `map_outro` | 地图收尾 | 后期地图结算动画。 |
| `match_outro` | 比赛收尾 | 后期赛后节目台。 |

### 8.3 不建议第一版加入

- 多解说席。
- 复杂镜头切换。
- 逐字字幕流。
- Agent 精确坐标动画。
- 观众互动投票。

这些内容会明显扩大 P2.1 范围，应放到 P2.2 / P2.3 或后续阶段。

## 9. 单回合播放时长

### 9.1 时长范围

每回合播放时长为 60-90 秒。

```text
普通回合：60 秒
信息量大回合：75 秒
关键回合 / 高光候选回合：90 秒
硬上限：90 秒
```

这里的时长是伪直播播放时长，不是模型生成时长，也不是数据库处理时长。

### 9.2 时长判定

Timeline Projector 可以根据以下信号选择时长：

| 信号 | 建议时长 |
|---|---:|
| 无高光标签，关键事件数量 <= 2 | 60 秒 |
| 关键事件数量 3-4，包含经济事件或比分转折 | 75 秒 |
| 包含高光标签、强起翻盘、经济局残局、赛点、图点 | 90 秒 |

### 9.3 确定性要求

相同输入事件和相同投影配置必须生成相同时间线。

如果需要随机弹幕 lane、弹幕间隔或轻微节奏偏移，必须使用稳定 `projectionSeed`。

## 10. 单回合播放节奏模板

### 10.1 普通回合：60 秒

```text
0ms      round_intro
5000ms   economy_panel_update
10000ms  agent_state_update
15000ms  map_control_update
22000ms  kill_feed_item
28000ms  caster_line
32000ms  barrage_stream start
42000ms  scoreboard_update
48000ms  round_result
54000ms  highlight_reveal 可选
58000ms  round_outro
60000ms  自动进入下一回合
```

### 10.2 信息量大回合：75 秒

```text
0ms      round_intro
6000ms   economy_panel_update
12000ms  agent_state_update
18000ms  map_control_update
26000ms  kill_feed_item
34000ms  caster_line
38000ms  barrage_stream start
52000ms  scoreboard_update
60000ms  round_result
67000ms  highlight_reveal 可选
73000ms  round_outro
75000ms  自动进入下一回合
```

### 10.3 关键回合：90 秒

```text
0ms      round_intro
7000ms   economy_panel_update
14000ms  agent_state_update
22000ms  map_control_update
32000ms  kill_feed_item
43000ms  caster_line
48000ms  barrage_stream start
63000ms  scoreboard_update
72000ms  round_result
80000ms  highlight_reveal
87000ms  round_outro
90000ms  自动进入下一回合
```

### 10.4 节奏约束

- `round_result` 必须晚于 `scoreboard_update` 或与其同一播放段。
- `highlight_reveal` 必须晚于 `round_result`。
- `round_outro` 必须是回合内最后一类 TimelineEvent。
- 弹幕可以跨多个时间点持续飘过，但不能早于可触发它的来源事实。
- 解说台词不能提前剧透还未播放的结果，除非它本身在 `round_result` 之后。

## 11. 自动连续播放

### 11.1 地图内自动播放

观众模式下，地图内回合必须自动连续播放：

```text
Round 1 round_outro
→ Round 2 round_intro
→ ...
→ map_completed
```

播放器可以短暂插入 2-5 秒的回合间隔，但不需要用户点击下一回合。

### 11.2 地图之间

地图之间第一版可以暂停在地图结算页。

原因：

- BO3 地图切换更适合做短停顿。
- 后续可加入地图总结、赛间解说、支持率变化。
- Phase 1 可以先自动或手动进入下一图，具体由播放器配置决定。

### 11.3 debug mode

debug mode 下，回合结束后可以插入仅管理员可见审查窗口：

```text
round_outro
→ review_window
→ continue / regenerate / pause
```

这个窗口不应出现在 viewer mode。

## 12. 倍速播放

### 12.1 第一版支持

```text
1x
1.5x
2x
instant
```

### 12.2 规则

- 倍速不改变 `TimelineEvent.atMs`。
- 倍速只改变播放器时钟。
- `instant` 表示立即按顺序播放所有事件，主要用于 CLI 验证和测试。
- 暂停后恢复时，播放器继续从当前播放时间点计算。

### 12.3 CLI 与 Web 一致性

CLI Player 和 Web Live Player 必须基于同一批 TimelineEvent。它们可以有不同渲染方式，但不能有不同播放顺序。

## 13. 弹幕持续飘过规则

### 13.1 设计选择

弹幕不是一次性全部出现，也不是永久停留在屏幕上。

弹幕必须按照时间线持续飘过，模拟真实直播间效果。

### 13.2 BarragePayload

```ts
type BarrageStreamPayload = {
  intensity: "low" | "medium" | "high";
  source: "barrage_created" | "fallback_template";
  messages: Array<{
    id: string;
    text: string;
    startOffsetMs: number;
    durationMs: number;
    lane?: number;
    weight?: number;
  }>;
};
```

字段说明：

| 字段 | 说明 |
|---|---|
| `intensity` | 弹幕密度，低 / 中 / 高。 |
| `startOffsetMs` | 相对于该 `barrage_stream.atMs` 的弹幕开始时间。 |
| `durationMs` | 弹幕从进入到离开屏幕的时长。 |
| `lane` | 可选弹幕轨道，Web 用；CLI 可忽略。 |
| `weight` | 可选权重，用于排序或高亮。 |

### 13.3 弹幕密度建议

| 强度 | 消息数量 | 持续时间 |
|---|---:|---:|
| low | 3-5 | 10-15 秒 |
| medium | 6-10 | 15-25 秒 |
| high | 10-18 | 20-35 秒 |

### 13.4 CLI 表达

CLI 不需要模拟飘动，但必须保留时间顺序。

例如：

```text
[32.0s] 弹幕 x6 开始
[34.2s] 这波强起真敢打
[36.8s] NAV 这个 Star 顶住了
```

## 14. 单主解说规则

### 14.1 第一版只做一名主解说

第一版只支持一名主解说，不做分析师、嘉宾、毒舌位。

原因：

- 产品风格更集中。
- 生成和展示更稳定。
- 不需要多 speaker 调度。
- 后续扩展不影响当前契约。

### 14.2 CasterLinePayload

```ts
type CasterLinePayload = {
  speakerRole: "main_caster";
  line: string;
  tone: "calm" | "hype" | "analysis" | "recap";
  displayDurationMs: number;
  sourceEventIds: string[];
};
```

### 14.3 约束

- `speakerRole` 第一版固定为 `main_caster`。
- 一条 `caster_line` 可以显示 6-12 秒。
- 解说不能改写比赛事实。
- 解说文本来自 `caster_line_created` 事件或 fallback 模板。
- 如果解说生成失败，可以用模板解说兜底，不阻塞播放。

## 15. 高光回合后判定

### 15.1 设计选择

高光必须在回合结束后揭示，而不是在回合中途闪出。

原因：

- 避免中途剧透。
- 保持完整观看节奏。
- 让观众先看过程，再看“本回合高光结算”。
- 高光依赖 `round_completed`、`round_report_created` 和 `highlight_detected`，更适合回合后生成。

### 15.2 HighlightRevealPayload

```ts
type HighlightRevealPayload = {
  highlightType: string;
  title: string;
  summary: string;
  weight: number;
  sourceEventIds: string[];
  sourceRoundReportId?: string;
};
```

### 15.3 约束

- `highlight_reveal.atMs` 必须晚于 `round_result.atMs`。
- 没有高光时可以不生成 `highlight_reveal`。
- 高光揭示可以作为回放卡片入口。
- 高光不是比赛事实，只是对事实的派生标记。

## 16. 虚拟地图控制变化

### 16.1 第一版范围

第一版只做虚拟控制变化，不做复杂 Agent 移动效果。

必须支持：

```text
map_control_update
zone_pressure_update 可预留
```

可以暂不支持：

```text
agent_move
agent_path
precise_position_update
```

### 16.2 MapControlPayload

```ts
type MapControlPayload = {
  mapName: string;
  updates: Array<{
    zoneId: string;
    zoneName: string;
    controllingTeamId?: string;
    pressure: "neutral" | "teamA_light" | "teamA_heavy" | "teamB_light" | "teamB_heavy" | "contested";
    reason: string;
    sourceKeyEventIds: string[];
  }>;
};
```

### 16.3 约束

- `zoneId` 必须能追溯到地图素材或 RoundReport 的地图区域引用。
- 如果地图素材还不完整，可以用虚拟区域：

```text
mid
site_a
site_b
connector
spawn_a
spawn_b
```

- 第一版 UI 可以只用颜色、压力条或区域标签表达控制变化。
- 后期 P2.2 可以扩展成详细地图与 Agent 移动效果。

## 17. 事件投影规则

### 17.1 基础投影表

| 来源事件 | 时间线类型 | 说明 |
|---|---|---|
| `round_started` | `round_intro` | 回合开场。 |
| `round_started` | `scoreboard_update` | 展示回合前比分。 |
| `economy_snapshot_created` | `economy_panel_update` | 展示经济快照。 |
| `buy_type_decided` | `economy_panel_update` | 展示购买类型。 |
| `drop_created` | `economy_panel_update` | 展示 drop。 |
| `save_called` | `economy_panel_update` | 展示保经济。 |
| `force_buy_called` | `economy_panel_update` | 展示强起。 |
| `output_gate_applied` | `agent_state_update` | 展示输出裁剪、提交额度。 |
| `round_report_created` | `map_control_update` | 从 keyEvents 投影控制变化。 |
| `kill_feed_created` | `kill_feed_item` | 展示击杀播报。 |
| `caster_line_created` | `caster_line` | 展示主解说。 |
| `barrage_created` | `barrage_stream` | 展示持续弹幕。 |
| `score_updated` | `scoreboard_update` | 更新比分。 |
| `round_completed` | `round_result` | 展示回合结果。 |
| `highlight_detected` | `highlight_reveal` | 回合后揭示高光。 |
| `round_completed` | `round_outro` | 回合收尾。 |
| `operator_pause_started` | `pause_marker` | debug / 管理播放标记。 |
| `technical_pause_started` | `pause_marker` | 技术暂停播放标记。 |

### 17.2 组合投影

多个 Event 可以合并成一个 TimelineEvent。

例如：

```text
economy_snapshot_created + buy_type_decided + drop_created
→ economy_panel_update
```

一个 Event 也可以拆成多个 TimelineEvent。

例如：

```text
round_report_created
→ map_control_update
→ kill_feed_item fallback
→ round_result supplement
```

### 17.3 fallback 投影

如果某些包装事件尚未生成，P2.1 允许使用模板投影兜底：

```text
没有 kill_feed_created:
  从 RoundReport.keyEvents 生成基础 kill_feed_item。

没有 caster_line_created:
  从 RoundReport.summary 生成模板 caster_line。

没有 barrage_created:
  从 highlightTags / buyType / winnerTeamId 生成低密度模板 barrage_stream。
```

兜底投影必须标记：

```text
payload.source = "fallback_template"
```

## 18. CLI Player 与 Web Live Player

### 18.1 共同输入

CLI Player 和 Web Live Player 必须消费同一批入库的 TimelineEvent。

```text
timeline_events table
  -> CLI Player
  -> Web Live Player
```

不能出现两套投影逻辑：

```text
禁止：CLI 自己解析 Event，Web 自己解析 Event。
必须：Event -> TimelineEvent 只有一套 Timeline Projector。
```

### 18.2 CLI Player 目标

CLI Player 用于快速验证事实链和播放顺序。

必须展示：

- 回合号。
- 播放时间点。
- 比分变化。
- 经济摘要。
- 击杀播报。
- 主解说。
- 弹幕摘要。
- 高光揭示。
- 来源事件 ID。

CLI 不需要实现：

- 真正弹幕飘动。
- 2D 地图绘制。
- 复杂动画。

### 18.3 Web Live Player 目标

Web Live Player 用于验证观赛感觉。

第一版必须展示：

- 比分牌。
- 当前地图和回合。
- 虚拟地图控制区。
- 经济面板。
- 击杀播报。
- 主解说。
- 持续弹幕。
- 回合结果。
- 高光揭示。

Web 第一版不要求：

- 完整视觉设计。
- 复杂地图细节。
- 多解说席。
- 完整新闻/奖项生态。

## 19. 入库与重生成规则

### 19.1 必须入库

TimelineEvent 必须入库。

原因：

- 本地回放速度更快。
- CLI 和 Web 可以共用同一批数据。
- 重启后可以继续播放。
- 后期 Web 化可直接迁移到数据库查询。

### 19.2 不是事实源

TimelineEvent 入库不改变它的边界。

```text
TimelineEvent 是缓存和播放脚本。
Event 才是事实源。
```

### 19.3 重生成触发

以下情况可以重建 TimelineEvent：

- 播放节奏规则调整。
- 弹幕密度调整。
- 高光展示时机调整。
- 虚拟地图控制投影规则调整。
- 包装事件重生成。
- 前端需要新的 payload 结构。

### 19.4 重生成约束

- 重生成必须基于 Event、RoundReport、BroadcastItem、Highlight。
- 重生成不能修改 Event。
- 重生成必须保留 `sourceEventIds`。
- 同一投影配置和同一 `projectionSeed` 下结果必须稳定。
- 如果保留历史投影，需要写入投影版本或审计记录；第一版可以直接清空并重建。

## 20. 时间线生成器

### 20.1 Timeline Projector

时间线生成器（Timeline Projector）负责：

```text
读取 Event Log
读取 RoundReport
读取 BroadcastItem / Highlight 可选内容
根据播放配置生成 TimelineEvent
写入 timeline_events
```

### 20.2 输入

```text
tournamentId
matchId
mapGameId
roundId 可选
playbackScope
projectionConfig
projectionSeed
```

### 20.3 输出

```text
TimelineEvent[]
projectionSummary
warnings[]
```

### 20.4 ProjectionConfig

```ts
type ProjectionConfig = {
  mode: "viewer" | "debug";
  roundDurationStrategy: "auto_60_90" | "fixed_60" | "fixed_75" | "fixed_90";
  autoplayWithinMap: boolean;
  allowDebugReviewWindow: boolean;
  barrageEnabled: boolean;
  barrageDensity: "low" | "medium" | "high" | "auto";
  casterMode: "main_caster_only";
  highlightRevealTiming: "after_round_result";
  mapControlMode: "virtual_control_only";
  playbackSpeeds: Array<"1x" | "1.5x" | "2x" | "instant">;
};
```

第一版默认：

```json
{
  "mode": "viewer",
  "roundDurationStrategy": "auto_60_90",
  "autoplayWithinMap": true,
  "allowDebugReviewWindow": false,
  "barrageEnabled": true,
  "barrageDensity": "auto",
  "casterMode": "main_caster_only",
  "highlightRevealTiming": "after_round_result",
  "mapControlMode": "virtual_control_only",
  "playbackSpeeds": ["1x", "1.5x", "2x", "instant"]
}
```

## 21. 数据库关系

### 21.1 timeline_events 表

P1.5 已预留 `timeline_events` 表。P2.1 要求该表至少支持：

```text
id
tournamentId
matchId
mapGameId
roundId
sourceEventIdsJson
atMs
durationMs
kind
payloadJson
playbackScope
playbackScopeId
sequenceIndex
createdAt
```

如果 P1.5 当前表缺少 `durationMs`、`playbackScope`、`playbackScopeId`、`sequenceIndex`，工程实现时应补齐或通过 payload 临时承载。

### 21.2 索引建议

```text
index(matchId, atMs)
index(mapGameId, atMs)
index(roundId, atMs)
index(playbackScope, playbackScopeId, atMs, sequenceIndex)
```

### 21.3 查询方式

```text
单回合 replay:
  where playbackScope = "round" and playbackScopeId = roundId

单图 replay:
  where mapGameId = ?

BO3 replay:
  where matchId = ?
```

## 22. 播放器状态

### 22.1 PlayerState

```ts
type PlayerState = {
  mode: "viewer" | "debug";
  status: "idle" | "playing" | "paused" | "completed";
  speed: "1x" | "1.5x" | "2x" | "instant";
  currentAtMs: number;
  currentTimelineEventId?: string;
  playbackScope: "round" | "map" | "match";
  playbackScopeId: string;
};
```

### 22.2 控制命令

第一版播放器至少支持：

```text
play
pause
resume
setSpeed
seekToMs
skipToNextRound
skipToHighlight
restart
```

### 22.3 事实边界

播放器状态不写入比赛事实。

如果需要记录用户操作或审查操作，应写入 admin / runtime_control 事件，而不是修改 TimelineEvent 或 Event。

## 23. 高光跳转

### 23.1 跳转来源

高光跳转可以来自：

- `highlight_reveal` TimelineEvent。
- Highlight 派生实体。
- `highlight_detected` Event。

### 23.2 跳转目标

第一版跳转到对应回合的 `round_intro`，而不是直接跳到 `highlight_reveal`。

原因：

- 高光需要上下文。
- 观众应该先看到完整过程。

后续可支持：

```text
jumpToRoundStart
jumpToKeyEvent
jumpToHighlightReveal
```

## 24. 与其他文档的关系

| 文档 | P2.1 消费内容 | P2.1 输出内容 |
|---|---|---|
| P0.1 领域模型 | TimelineEvent 边界、Event 事实源 | TimelineEventKind 细化。 |
| P0.2 事件分类 | 可投影事件、payload、timelineMs 边界 | 具体投影规则和播放节奏。 |
| P0.3 规则赛制 | BO3、MR6、地图、回合结构 | 地图/回合/比赛播放作用域。 |
| P1.1 回合战报契约 | RoundReport、keyEvents、highlightTags | map_control_update、kill_feed_item、highlight_reveal。 |
| P1.2 Token 经济说明 | buyType、Output Gate、economy events | economy_panel_update、agent_state_update。 |
| P1.3 大模型驾驶员契约 | caster / barrage 生成来源 | caster_line、barrage_stream 的播放契约。 |
| P1.4 比赛引擎说明 | 事件写入顺序、审查窗口 | 自动连续播放、debug mode 审查窗口。 |
| P1.5 本地持久化说明 | timeline_events 表 | 必须入库、重生成、查询索引要求。 |
| P2.2 2D 战术地图 | 后续消费地图相关 TimelineEvent | 地图动画细节。 |
| P2.3 转播系统 | 后续消费 caster / barrage / kill feed 契约 | 解说、弹幕、击杀播报生成细节。 |

## 25. MVP 验收标准

完成 P2.1 后，应满足：

- 可以从一组 Event 和 RoundReport 投影出 TimelineEvent。
- TimelineEvent 必须写入数据库缓存。
- TimelineEvent 可以从 Event 重新生成。
- 单回合默认播放时长在 60-90 秒。
- 地图内可以自动连续播放多个回合。
- 支持 `1x`、`1.5x`、`2x`、`instant`。
- 弹幕按时间线持续飘过，不一次性全部显示。
- 第一版只有一名主解说。
- 高光只在回合结果之后揭示。
- 第一版地图只要求虚拟控制区变化。
- CLI Player 和 Web Live Player 消费同一批 TimelineEvent。
- 前端或 CLI 不读取 RawOutput 正文。
- viewer mode 不显示审查窗口。
- debug mode 可以显示仅管理员可见审查窗口。
- TimelineEvent 不被统计、裁判、新闻当作比赛事实。

## 26. Phase 1 最小实现建议

### Phase 1.1 单回合 replay

最小目标：

```text
Event + RoundReport
→ Timeline Projector
→ timeline_events
→ CLI Player 打印一回合
→ 极简 Web 页面播放同一回合
```

### Phase 1.2 单张地图

最小目标：

```text
多个 Round Timeline
→ Map Timeline 自动串联
→ viewer mode 自动播放
→ debug mode 可在回合后暂停
```

### Phase 1.3 BO3 fake provider

最小目标：

```text
完整 BO3 Event Log
→ Match Timeline
→ CLI 可重放
→ Web 可播放
```

## 27. 待确认问题

当前没有阻塞 Phase 1.0 / Phase 1.1 的问题。

后续可在 P2.2 / P2.3 再细化：

- 详细地图区域与 Agent 移动效果。
- 弹幕车道算法。
- 解说风格素材库。
- 高光回放卡片视觉结构。
- 地图间节目包装。

