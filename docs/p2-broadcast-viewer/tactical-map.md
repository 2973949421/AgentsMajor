# P2.2 2D 战术地图说明（2D Tactical Map Spec）

## 1. 文档状态

```text
P 编号：P2.2
模块：M10 2D 战术渲染器（2D Tactical Renderer）
当前状态：Frozen for Phase 1 fake provider MVP
首版日期：2026-05-02
覆盖范围：DUST2 / INFERNO / MIRAGE 的抽象区域图
```

P2.2 定义 2D 战术地图如何消费现有比赛事实源。它不是复杂美术地图实现，而是一个表现层契约：把 `RoundReport.keyEvents`、`TimelineEvent`、`highlightTags` 和 `MapGame.mapName` 映射成可播放的地图区域、控制变化、路径提示、状态徽标和高光闪烁。

## 2. 目标与非目标

### 2.1 目标

- 定义地图区域（map zones）的稳定 ID、展示名、角色和坐标。
- 定义智能体位置（agent positions）的第一版表达方式。
- 定义控制区域（control regions）如何从关键事件中推导。
- 定义行动路径（action path）如何从区域连接中表达。
- 定义状态徽标（state badge）和高光闪烁（highlight flash）的触发规则。
- 定义缺少地图素材、缺少坐标或未知 `zoneId` 时的降级规则。

### 2.2 非目标

- 不做真实地图复刻。
- 不做物理级移动模拟。
- 不反写比赛事实源。
- 不参与 Judge 判定、比分结算或经济结算。
- 不修改现有 `RoundReport`、`TimelineEvent`、`Event` 或 SQLite 核心结构。
- 不依赖真实美术素材、图片地图或外部地图编辑器。

## 3. 数据来源与勾稽关系

P2.2 的输入只来自既有事实源和播放投影。

| 来源 | 字段 / 类型 | 用途 |
|---|---|---|
| 地图局（MapGame） | `mapName` | 选择战术地图布局。 |
| 回合战报（RoundReport） | `keyEvents[].zoneId` | 地图渲染主入口。 |
| 回合战报（RoundReport） | `keyEvents[].type` | 决定视觉效果类型。 |
| 回合战报（RoundReport） | `keyEvents[].actorTeamId` | 决定控制色和主动方。 |
| 回合战报（RoundReport） | `keyEvents[].actorAgentId` | 决定 agent 标记。 |
| 回合战报（RoundReport） | `highlightTags` | 决定高光徽标。 |
| 时间线事件（TimelineEvent） | `round_intro.payload.mapName` | 播放开始时选择布局。 |
| 时间线事件（TimelineEvent） | `kill_feed_item.payload.zoneId` | 播放到该时间点时激活区域。 |
| 时间线事件（TimelineEvent） | `highlight_reveal.payload.tags` | 触发高光闪烁和徽标。 |
| 地图摘要（map_summary） | `payload.keyRounds` | 只用于高光跳转，不直接驱动地图动画。 |

关键原则：

```text
Event / RoundReport / TimelineEvent 是事实源和播放投影。
TacticalMapLayout 是渲染素材。
2D 战术地图只消费它们，不产生比赛事实。
```

## 4. 战术地图布局契约

### 4.1 类型草案

```ts
type KnownTacticalMapName = "DUST2" | "INFERNO" | "MIRAGE";

type TacticalMapLayout = {
  mapName: KnownTacticalMapName | "DEFAULT";
  version: number;
  canvas: { width: number; height: number };
  zones: TacticalMapZone[];
  connections: TacticalZoneConnection[];
  fallbackZoneId: string;
};

type TacticalMapZone = {
  zoneId: string;
  displayName: string;
  role: "spawn" | "mid" | "site" | "connector" | "economy" | "utility";
  position: { x: number; y: number };
  radius: number;
};

type TacticalZoneConnection = {
  fromZoneId: string;
  toZoneId: string;
  pathType: "attack" | "rotate" | "fallback" | "economy";
};
```

### 4.2 坐标规则

- `canvas.width` 和 `canvas.height` 第一版固定为 `1000 x 640`。
- `position.x` 和 `position.y` 使用同一虚拟画布坐标，不直接绑定 CSS 像素。
- 前端可以按容器大小等比缩放。
- `radius` 表示区域热区半径，不表示真实地图面积。
- 第一版区域形状只要求圆形或圆角节点，后续可扩展为 polygon。

### 4.3 稳定性规则

- `zoneId` 是机器稳定引用，不能随展示名变化。
- `displayName` 中文优先，可根据赛事风格调整。
- 同一个 `zoneId` 在不同地图中允许坐标不同，但语义要保持一致。
- `fallbackZoneId` 必须存在于 `zones` 中。
- 当前代码已经产出的 `buyer_mid`、`conversion_site_a`、`token_economy` 必须在首批三张地图中全部存在。
- 布局函数入参使用 `mapName: string`，命中首批三图时返回对应布局，未命中时返回 `mapName: "DEFAULT"` 的通用 8 区域布局。

## 5. 首批三图区域定义

### 5.1 必备稳定区域

每张首批地图至少包含以下 8 个稳定区域：

| zoneId | 中文展示名 | role | 用途 |
|---|---|---|---|
| `spawn_a` | A 队出发点 | `spawn` | A 队默认起点。 |
| `spawn_b` | B 队出发点 | `spawn` | B 队默认起点。 |
| `buyer_mid` | 买家中路 | `mid` | 入口控制、信息争夺、第一波突破。 |
| `conversion_site_a` | 转化 A 点 | `site` | 优势转化、残局收束、得分点。 |
| `conversion_site_b` | 转化 B 点 | `site` | 备用得分点和转点目标。 |
| `retention_connector` | 留存连接区 | `connector` | 回防、转线、连接区控制。 |
| `pricing_ramp` | 定价斜坡 | `utility` | 战术准备、压力堆叠、价值锚点。 |
| `token_economy` | Token 经济区 | `economy` | 经济波动、购买态势、资源压力。 |

### 5.1.1 区域战术语义（Phase 1.6 预留）

Phase 1.45 中，区域只负责展示：不是每个回合、每个区域都会被点亮，只有被 `RoundReport.keyEvents`、`TimelineEvent` 或高光揭示命中的区域才会激活。

Phase 1.6 后，区域会进一步成为攻防回合协议的战术词汇：

| zoneId | 攻方语义 | 守方语义 | 转播语义 |
|---|---|---|---|
| `conversion_site_a` | 主攻 A 点，集中完成商业闭环或核心转化论证。 | 重防 A，用产品壁垒、技术论证、运营数据或商业防线顶住强攻。 | A 点爆破、A 点重防、A 点被打穿。 |
| `conversion_site_b` | 主攻 B 点，作为备用得分点、转点目标或差异化增长入口。 | 重防 B，防止对手绕过 A 点主防线。 | B 点偷袭、转 B、B 点空虚。 |
| `buyer_mid` | 控中路，争夺 buyer 定义、市场切入点和信息优势。 | 中路前压，提前识破对手主攻方向。 | 中路控制、信息压制、提前读到战术。 |
| `retention_connector` | 转点、残局收束、打连接区形成回防压力。 | 回防、转线、保留二次防守能力。 | 转点成功、回防迟缓、连接区残局。 |
| `pricing_ramp` | 用定价、价值锚点、技术门槛堆叠进攻压力。 | 用价格反制、壁垒证明或方案复杂度拖慢进攻。 | 价值坡道、价格压力、壁垒交火。 |
| `token_economy` | 利用 force buy / eco / save 制造低预算突破。 | 根据预算选择重防、弱防或保存资源。 | 经济局、强起、保经济、低配翻盘。 |

边界：

```text
P2.2 只定义 zone 的展示和语义映射。
攻方 AttackPlan、守方 DefenseDeployment 和 TacticalCollision 由 P1.4 / Phase 1.6 负责。
P2.2 不根据 UI 反推攻防计划，也不决定 Judge 结果。
```

### 5.2 DUST2 布局草案

```ts
const dust2Layout: TacticalMapLayout = {
  mapName: "DUST2",
  version: 1,
  canvas: { width: 1000, height: 640 },
  fallbackZoneId: "buyer_mid",
  zones: [
    { zoneId: "spawn_a", displayName: "NAV 出发点", role: "spawn", position: { x: 120, y: 520 }, radius: 44 },
    { zoneId: "spawn_b", displayName: "FUR 出发点", role: "spawn", position: { x: 880, y: 120 }, radius: 44 },
    { zoneId: "buyer_mid", displayName: "买家中路", role: "mid", position: { x: 500, y: 320 }, radius: 62 },
    { zoneId: "conversion_site_a", displayName: "转化 A 点", role: "site", position: { x: 760, y: 230 }, radius: 58 },
    { zoneId: "conversion_site_b", displayName: "转化 B 点", role: "site", position: { x: 270, y: 225 }, radius: 58 },
    { zoneId: "retention_connector", displayName: "留存连接区", role: "connector", position: { x: 510, y: 210 }, radius: 46 },
    { zoneId: "pricing_ramp", displayName: "定价斜坡", role: "utility", position: { x: 665, y: 420 }, radius: 48 },
    { zoneId: "token_economy", displayName: "Token 经济区", role: "economy", position: { x: 500, y: 585 }, radius: 52 }
  ],
  connections: [
    { fromZoneId: "spawn_a", toZoneId: "buyer_mid", pathType: "attack" },
    { fromZoneId: "spawn_b", toZoneId: "buyer_mid", pathType: "fallback" },
    { fromZoneId: "buyer_mid", toZoneId: "conversion_site_a", pathType: "attack" },
    { fromZoneId: "buyer_mid", toZoneId: "conversion_site_b", pathType: "attack" },
    { fromZoneId: "conversion_site_a", toZoneId: "retention_connector", pathType: "rotate" },
    { fromZoneId: "conversion_site_b", toZoneId: "retention_connector", pathType: "rotate" },
    { fromZoneId: "pricing_ramp", toZoneId: "conversion_site_a", pathType: "attack" },
    { fromZoneId: "token_economy", toZoneId: "buyer_mid", pathType: "economy" }
  ]
};
```

### 5.3 INFERNO 布局草案

```ts
const infernoLayout: TacticalMapLayout = {
  mapName: "INFERNO",
  version: 1,
  canvas: { width: 1000, height: 640 },
  fallbackZoneId: "buyer_mid",
  zones: [
    { zoneId: "spawn_a", displayName: "NAV 出发点", role: "spawn", position: { x: 130, y: 500 }, radius: 44 },
    { zoneId: "spawn_b", displayName: "FUR 出发点", role: "spawn", position: { x: 860, y: 150 }, radius: 44 },
    { zoneId: "buyer_mid", displayName: "买家中路", role: "mid", position: { x: 470, y: 345 }, radius: 60 },
    { zoneId: "conversion_site_a", displayName: "转化 A 点", role: "site", position: { x: 740, y: 170 }, radius: 58 },
    { zoneId: "conversion_site_b", displayName: "转化 B 点", role: "site", position: { x: 725, y: 500 }, radius: 58 },
    { zoneId: "retention_connector", displayName: "留存连接区", role: "connector", position: { x: 590, y: 330 }, radius: 48 },
    { zoneId: "pricing_ramp", displayName: "定价斜坡", role: "utility", position: { x: 320, y: 440 }, radius: 48 },
    { zoneId: "token_economy", displayName: "Token 经济区", role: "economy", position: { x: 500, y: 585 }, radius: 52 }
  ],
  connections: [
    { fromZoneId: "spawn_a", toZoneId: "pricing_ramp", pathType: "attack" },
    { fromZoneId: "pricing_ramp", toZoneId: "buyer_mid", pathType: "attack" },
    { fromZoneId: "buyer_mid", toZoneId: "retention_connector", pathType: "rotate" },
    { fromZoneId: "retention_connector", toZoneId: "conversion_site_a", pathType: "attack" },
    { fromZoneId: "retention_connector", toZoneId: "conversion_site_b", pathType: "attack" },
    { fromZoneId: "spawn_b", toZoneId: "retention_connector", pathType: "fallback" },
    { fromZoneId: "conversion_site_a", toZoneId: "conversion_site_b", pathType: "rotate" },
    { fromZoneId: "token_economy", toZoneId: "pricing_ramp", pathType: "economy" }
  ]
};
```

### 5.4 MIRAGE 布局草案

```ts
const mirageLayout: TacticalMapLayout = {
  mapName: "MIRAGE",
  version: 1,
  canvas: { width: 1000, height: 640 },
  fallbackZoneId: "buyer_mid",
  zones: [
    { zoneId: "spawn_a", displayName: "NAV 出发点", role: "spawn", position: { x: 110, y: 500 }, radius: 44 },
    { zoneId: "spawn_b", displayName: "FUR 出发点", role: "spawn", position: { x: 880, y: 145 }, radius: 44 },
    { zoneId: "buyer_mid", displayName: "买家中路", role: "mid", position: { x: 500, y: 315 }, radius: 64 },
    { zoneId: "conversion_site_a", displayName: "转化 A 点", role: "site", position: { x: 720, y: 235 }, radius: 58 },
    { zoneId: "conversion_site_b", displayName: "转化 B 点", role: "site", position: { x: 280, y: 235 }, radius: 58 },
    { zoneId: "retention_connector", displayName: "留存连接区", role: "connector", position: { x: 545, y: 215 }, radius: 48 },
    { zoneId: "pricing_ramp", displayName: "定价斜坡", role: "utility", position: { x: 650, y: 450 }, radius: 48 },
    { zoneId: "token_economy", displayName: "Token 经济区", role: "economy", position: { x: 500, y: 585 }, radius: 52 }
  ],
  connections: [
    { fromZoneId: "spawn_a", toZoneId: "pricing_ramp", pathType: "attack" },
    { fromZoneId: "spawn_a", toZoneId: "buyer_mid", pathType: "attack" },
    { fromZoneId: "spawn_b", toZoneId: "retention_connector", pathType: "fallback" },
    { fromZoneId: "buyer_mid", toZoneId: "retention_connector", pathType: "rotate" },
    { fromZoneId: "retention_connector", toZoneId: "conversion_site_a", pathType: "attack" },
    { fromZoneId: "buyer_mid", toZoneId: "conversion_site_b", pathType: "attack" },
    { fromZoneId: "pricing_ramp", toZoneId: "conversion_site_a", pathType: "attack" },
    { fromZoneId: "token_economy", toZoneId: "buyer_mid", pathType: "economy" }
  ]
};
```

## 6. 事件到视觉效果映射

### 6.1 关键事件映射

| RoundKeyEvent.type | 默认 zone | 视觉效果 | 展示文案 |
|---|---|---|---|
| `entry` | `keyEvent.zoneId` | 区域控制闪烁，画入口路径 | 入口控制 |
| `conversion` | `keyEvent.zoneId` | 区域变为得分方控制色 | 优势转化 |
| `clutch` | `keyEvent.zoneId` | 高光闪烁，显示 MVP / clutch 徽标 | 残局收束 |
| `economy_swing` | `token_economy` 优先 | 点亮经济区，显示资源波动徽标 | 经济波动 |
| `trade` | `keyEvent.zoneId` | 双方颜色短暂交替 | 交换 |
| `highlight` | `keyEvent.zoneId` | 强高光闪烁 | 高光事件 |
| 未识别类型 | `keyEvent.zoneId` 或 fallback | 只显示区域标签 | 关键事件 |

智能体标记映射：

- `keyEvent.actorAgentId` 生成 `markerType: "actor"`。
- `keyEvent.targetAgentId` 存在时生成 `markerType: "target"`。
- `judgeResult.mvpAgentId` 或回合高光主角可在 `highlight_reveal` 阶段生成 `markerType: "mvp"`。
- 所有 marker 都挂到已解析的 `zoneId` 上；P2.2 不表达真实站位、速度或朝向。

### 6.2 TimelineEvent 映射

| TimelineEvent.kind | 地图行为 |
|---|---|
| `round_intro` | 选择 `mapName` 对应布局，重置本回合地图状态。 |
| `kill_feed_item` | 根据 `payload.keyEventId` 和 `payload.zoneId` 激活对应区域。 |
| `economy_panel_update` | 如经济差显著，可轻量点亮 `token_economy`。 |
| `highlight_reveal` | 对本回合所有 key event zone 做最终高光揭示。 |
| `round_result` | 固定最终控制色，停止新增路径动画。 |
| 其他类型 | 不影响地图，交给对应 UI 面板消费。 |

### 6.3 高光标签映射

| highlight tag | 视觉徽标 |
|---|---|
| `map_closeout` | 地图收官 |
| `map_point_conversion` | 兑现局点 |
| `map_point_denial` | 顶住局点 |
| `overtime_round` | 加时 |
| `overtime_reset` | 加时重置 |
| `economy_swing` | 经济波动 |
| `force_buy_conversion` | 强起得分 |
| `buy_disadvantage_win` | 低配翻盘 |
| `lead_take` | 建立领先 |
| `score_equalizer` | 扳平比分 |

未知高光标签可以展示原始 tag，不应中断播放。

## 7. 地图 ViewModel 实现路线

P2.2 不要求本轮实现 UI，但后续代码应按以下路线落地。

### 7.1 前端布局模块

新增前端模块：

```text
apps/web/app/tactical-map-layout.ts
```

职责：

- 内置 `DUST2`、`INFERNO`、`MIRAGE` 三张抽象布局。
- 暴露 `getTacticalMapLayout(mapName: string)`。
- 未命中地图时返回通用 8 区域默认布局。
- 提供 `resolveTacticalZone(layout, zoneId)`，未知 zone 返回 fallback zone，并标记 `weak: true`。

### 7.2 播放 ViewModel 扩展

当前 `LiveRoundFrame.zones` 可从纯 `VirtualZone` 逐步升级为：

```ts
type TacticalZoneFrame = {
  zoneId: string;
  displayName: string;
  role: TacticalMapZone["role"];
  position: { x: number; y: number };
  radius: number;
  actorTeamId?: string;
  agentMarkers: TacticalAgentMarker[];
  active: boolean;
  weak: boolean;
  effect: "idle" | "control_flash" | "conversion" | "clutch_flash" | "economy_flash" | "highlight_flash";
  badge?: string;
  impact?: string;
};

type TacticalAgentMarker = {
  agentId: string;
  teamId: string;
  markerType: "actor" | "target" | "mvp";
};
```

约束：

- `TacticalZoneFrame` 是播放 ViewModel，不是事实源。
- `agentMarkers` 只表达播放标记，不表达精确站位、速度或朝向。
- `weak: true` 表示降级渲染，不代表比赛事实错误。
- 如果一个区域在同一时刻被多个 key event 命中，以最新可见 `TimelineEvent.atMs` 为准。

### 7.3 UI 渲染路线

第一版 UI 可替换当前简单 zone 列表：

```text
背景：抽象渐变或网格。
区域：圆形 / 圆角节点。
连接：SVG line / path。
控制色：按 actorTeamId 映射队伍颜色。
agent 标记：显示 agent id 的短标或角色徽标。
高光：CSS animation 闪烁。
```

不要求第一版实现：

```text
真实地图轮廓。
复杂路径曲线。
碰撞、速度、朝向。
多 agent 精确站位。
Canvas / WebGL。
```

## 8. 降级规则

| 异常 | 降级行为 |
|---|---|
| `zoneId` 不存在 | 使用 `fallbackZoneId`，`weak: true`。 |
| 地图布局缺失 | 使用通用 8 区域默认布局。 |
| 缺少 `actorAgentId` | 只显示队伍控制，不显示 agent 标记。 |
| 缺少 `actorTeamId` | 使用中性色，不改变控制归属。 |
| 缺少连接路径 | 只闪烁起止 zone，不画路径。 |
| 缺少 `highlightTags` | 不显示高光徽标，但继续播放 key event。 |
| 未识别 `RoundKeyEvent.type` | 只显示区域标签和 impact。 |
| 未识别 `TimelineEvent.kind` | 忽略地图效果，不影响其他 UI。 |

降级规则的优先级：

```text
不中断播放 > 保留事实可追溯 > 标记弱渲染 > 等后续素材补齐
```

## 9. 与其他 P 文档关系

| 文档 | P2.2 消费内容 | P2.2 输出内容 |
|---|---|---|
| P1.1 回合战报契约 | `RoundReport.keyEvents`、`zoneId`、`highlightTags` | 地图区域消费规则。 |
| P1.4 比赛引擎说明 | `MapGame.mapName`、回合推进顺序 | 地图布局选择规则。 |
| P2.1 直播时间线说明 | `TimelineEvent.kind`、`payload`、`atMs` | 地图播放效果映射。 |
| P2.3 转播系统说明 | 高光、解说、弹幕共享事件语义 | 2D 地图高光依据。 |
| P3.3 素材库说明 | 未来可导入地图布局和美术素材 | 可替换的 layout 契约。 |

## 10. 验收标准

### 10.1 文档验收

- `docs/p2-broadcast-viewer/tactical-map.md` 明确目标、非目标、数据来源、schema、三图 zone、事件映射和降级规则。
- `DUST2`、`INFERNO`、`MIRAGE` 都有 `TacticalMapLayout` 草案。
- 每张首批地图都定义 `spawn_a`、`spawn_b`、`buyer_mid`、`conversion_site_a`、`conversion_site_b`、`retention_connector`、`pricing_ramp`、`token_economy`。
- 当前代码产出的 `buyer_mid`、`conversion_site_a`、`token_economy` 在三图中全部可解析。
- 文档明确 2D 战术地图不反写事实源。

### 10.2 后续代码验收

- 前端存在三张地图的 `TacticalMapLayout`。
- 每个 `RoundReport.keyEvents[].zoneId` 都能解析到 zone 或 fallback zone。
- `entry`、`conversion`、`clutch`、`economy_swing` 都能映射到视觉效果。
- 缺失 zone 时 fallback，不崩溃。
- 当前 Phase 1.4 播放器测试继续通过。

## 11. 当前结论

P2.2 的第一版边界已经清晰：

```text
先用抽象区域图把比赛事实“画出来”。
不做复杂地图美术。
不修改事实源。
不让表现层反向污染 Judge / 经济 / 比分。
```

P2.2 完成后，下一步应进入 P2.3 转播系统说明，定义 Caster、Barrage、Highlight、Replay Clip 如何消费同一套事实源。
## Phase 1.6 增量：攻防协议地图展示已落地

Phase 1.6 后，2D Tactical Map 除继续消费 `RoundReport.keyEvents` 和 timeline 外，还消费公开的 `RoundReport.tacticalContext` 与 `map_control_update` 投影。

地图展示规则：

| 状态 | 展示含义 |
|---|---|
| 主攻区 | 攻方本回合主要进攻点 |
| 二攻/转点区 | 攻方备用目标或转点目标 |
| 重防区 | 守方资源集中区域 |
| 弱防区 | 守方资源薄弱区域 |
| 碰撞区 | TacticalCollision 的主要结算区域 |
| fallback zone | 未知 zone 降级后的弱提示区 |

地图仍然只是表现层：它不生成 AttackPlan，不生成 DefenseDeployment，不判定 TacticalCollision，也不反写 RoundReport、Event Log、比分或经济。
