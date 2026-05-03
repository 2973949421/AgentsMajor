# P0.2 事件分类（Event Taxonomy）

## 1. 文档定位

这份文档定义 Agent Major 的事件语言。它回答的问题是：

```text
系统里发生过哪些事情？
这些事情应该用什么事件类型记录？
每种事件的 payload 应该包含哪些稳定信息？
哪些事件是比赛事实，哪些事件只是转播包装？
哪些事件可以投影成伪直播时间线？
未来新增事件时应该如何扩展而不破坏旧赛事？
```

这不是数据库表设计，不是 API 文档，也不是最终 TypeScript / Zod 实现。它是事件日志（Event Log）、回合战报（RoundReport）、伪直播（Pseudo Live）、统计、新闻和奖项共同遵守的事件契约。

## 2. 设计原则

### 2.1 事件是事实账本

事件（Event）是系统的事实源。比赛模拟、裁判判定、经济变化、转播包装、统计更新、新闻生成和管理操作，都必须能追溯到事件。

### 2.2 时间线是播放投影

时间线事件（TimelineEvent）不是事实源。它从事件（Event）投影生成，用于前端伪直播播放，可以重生成，不能反向修改比赛事实。

### 2.3 包装层不能改写事实

转播条目（BroadcastItem）、新闻文章（Article）、奖项解释（Award explanation）可以包装和解释事实，但不能创造或修改比赛事实。

### 2.4 中文优先，英文稳定

文档展示使用中文（英文）形式，例如：

```text
回合开始（round_started）
裁判判定生成（judge_decision_created）
```

代码值使用 snake_case 英文，作为长期稳定的 `EventType`。

### 2.5 中粒度优先

P0.2 只定义稳定事件类型和 payload 骨架。地图区域、关键事件细节、时间线动画类型、统计公式等细节留给后续专项文档。

## 3. 通用事件结构

所有事件共享以下字段。

| 中文字段 | 代码字段 | 类型草案 | 必填 | 说明 |
|---|---|---|---|---|
| 事件 ID | `id` | `string` | 是 | 稳定引用 ID。 |
| 事件类型 | `type` | `EventType` | 是 | snake_case 英文代码值。 |
| 事件大类 | `category` | `EventCategory` | 是 | simulation、judge、economy 等。 |
| 所属赛事 ID | `tournamentId` | `string` | 是 | 指向 Tournament。 |
| 所属比赛 ID | `matchId` | `string` | 否 | 比赛相关事件必填。 |
| 所属地图局 ID | `mapGameId` | `string` | 否 | 地图相关事件必填。 |
| 所属回合 ID | `roundId` | `string` | 否 | 回合相关事件必填。 |
| 载荷 | `payload` | `unknown` | 是 | 具体结构由事件类型决定。 |
| 载荷版本 | `payload.schemaVersion` | `number` | 是 | 第一版固定为 `1`。 |
| 全局事件序号 | `globalSequence` | `number` | 是 | 事实账本内的单调递增顺序，用于恢复、审计和导出。 |
| 作用域类型 | `scopeType` | `EventScopeType` | 是 | tournament / match / map / round。 |
| 作用域 ID | `scopeId` | `string` | 是 | 与 scopeType 对应的业务对象 ID。 |
| 作用域内序号 | `sequenceInScope` | `number` | 是 | 同一 scope 内的稳定顺序，回合内事件重放优先使用它。 |
| 时间线毫秒 | `timelineMs` | `number` | 否 | 可投影播放时使用。 |
| 来源模块 | `sourceModule` | `string` | 否 | 例如 simulation、judge、broadcast。 |
| 创建时间 | `createdAt` | `string` | 是 | ISO 时间字符串。 |
| 更新时间 | `updatedAt` | `string` | 否 | 事件被编辑后写入。 |
| 软删除时间 | `deletedAt` | `string` | 否 | 软删除后写入。 |
| 软删除原因 | `deletedReason` | `string` | 否 | 解释为什么隐藏该事件。 |

排序规则：

- `globalSequence` 是事实账本的最终审计顺序，不依赖 `createdAt`。
- `sequenceInScope` 是作用域内顺序；回合内重放、统计和恢复优先使用 round scope 的 `sequenceInScope`。
- `timelineMs` 只用于伪直播播放节奏，不代表事实写入顺序。

通用示例：

```json
{
  "id": "evt_round_004_completed",
  "type": "round_completed",
  "category": "simulation",
  "tournamentId": "t_agent_major_001",
  "matchId": "match_001",
  "mapGameId": "map_001",
  "roundId": "round_004",
  "globalSequence": 128,
  "scopeType": "round",
  "scopeId": "round_004",
  "sequenceInScope": 13,
  "payload": {
    "schemaVersion": 1,
    "winnerTeamId": "team_ghost_nav",
    "scoreAfterRound": {
      "teamA": 3,
      "teamB": 1
    }
  },
  "timelineMs": 42000,
  "sourceModule": "simulation",
  "createdAt": "2026-04-29T12:00:00.000Z"
}
```

## 4. 事件大类

| 中文大类 | 代码值 | 职责边界 | 是否可作为事实依据 |
|---|---|---|---|
| 比赛模拟 | `simulation` | 赛事、比赛、地图、回合生命周期。 | 是 |
| 裁判评分 | `judge` | 裁判判定、比分更新、回合战报生成。 | 是 |
| Token 经济 | `economy` | 经济快照、购买类型、经济变化、暂停、强起、保经济。 | 是 |
| 转播包装 | `broadcast` | 击杀播报、解说、弹幕、支持率、高光、回放卡片。 | 否，除高光可作为候选引用 |
| 时间线投影 | `timeline` | Event 到 TimelineEvent 的播放投影记录。 | 否 |
| 数据统计 | `stats` | 统计更新、评级更新、奖项授予。 | 是，基于事实事件派生 |
| 新闻媒体 | `media` | 新闻、采访、日报生成。 | 否，只能引用事实 |
| 管理操作 | `admin` | 人工修正、事件快照、软删除、产物保存。 | 是，用于审计和调试 |

## 5. 事件类型目录

### 5.1 比赛模拟（simulation）

| 中文名 | 事件类型 | 事实性 | 上游来源 | 下游消费者 | 可投影时间线 |
|---|---|---|---|---|---|
| 赛事创建 | `tournament_created` | 事实 | 管理与控制台 | 赛事列表、新闻 | 否 |
| 赛事开始 | `tournament_started` | 事实 | 赛事领域 | 首页、新闻 | 是 |
| 比赛创建 | `match_created` | 事实 | 对阵树 | 赛程、统计 | 否 |
| 比赛开始 | `match_started` | 事实 | 比赛模拟引擎 | 直播页、新闻 | 是 |
| 地图禁选完成 | `map_veto_completed` | 事实 | 比赛模拟引擎 | 直播页、解说 | 是 |
| 地图开始 | `map_started` | 事实 | 比赛模拟引擎 | 直播页、2D 地图 | 是 |
| 回合开始 | `round_started` | 事实 | 比赛模拟引擎 | 直播页、2D 地图 | 是 |
| 回合结束 | `round_completed` | 事实 | 比赛模拟引擎 | 统计、新闻、转播 | 是 |
| 地图结束 | `map_completed` | 事实 | 比赛模拟引擎 | 统计、新闻 | 是 |
| 比赛结束 | `match_completed` | 事实 | 比赛模拟引擎 | 统计、奖项、新闻 | 是 |
| 赛事结束 | `tournament_completed` | 事实 | 赛事领域 | 冠军页、奖项、新闻 | 是 |

### 5.2 裁判评分（judge）

| 中文名 | 事件类型 | 事实性 | 上游来源 | 下游消费者 | 可投影时间线 |
|---|---|---|---|---|---|
| 裁判判定生成 | `judge_decision_created` | 事实 | 裁判与评分 | 回合战报、统计 | 是 |
| 比分更新 | `score_updated` | 事实 | 裁判与评分 | 比分牌、统计 | 是 |
| 回合战报生成 | `round_report_created` | 事实 | 回合战报生成器 | 事件拆解、转播、新闻 | 否 |

### 5.3 Token 经济（economy）

| 中文名 | 事件类型 | 事实性 | 上游来源 | 下游消费者 | 可投影时间线 |
|---|---|---|---|---|---|
| 经济快照创建 | `economy_snapshot_created` | 事实 | Token 经济系统 | 比赛模拟、统计 | 否 |
| 购买类型决定 | `buy_type_decided` | 事实 | Token 经济系统 | 回合输入、解说 | 是 |
| Drop 创建 | `drop_created` | 事实 | Token 经济系统 | 经济面板、解说 | 是 |
| 经济更新 | `economy_updated` | 事实 | Token 经济系统 | 经济面板、统计 | 是 |
| 战术暂停使用 | `timeout_used` | 事实 | Token 经济系统 | 解说、新闻 | 是 |
| 保经济调用 | `save_called` | 事实 | Token 经济系统 | 解说、统计 | 是 |
| 强起调用 | `force_buy_called` | 事实 | Token 经济系统 | 解说、高光 | 是 |
| 输出闸门应用 | `output_gate_applied` | 事实 | Token 经济系统 | 回合战报、裁判、调试 | 是 |

### 5.4 转播包装（broadcast）

| 中文名 | 事件类型 | 事实性 | 上游来源 | 下游消费者 | 可投影时间线 |
|---|---|---|---|---|---|
| 击杀播报生成 | `kill_feed_created` | 包装 | 回合战报、转播系统 | 直播页、回放 | 是 |
| 解说台词生成 | `caster_line_created` | 包装 | 转播系统 | 直播页、回放 | 是 |
| 弹幕生成 | `barrage_created` | 包装 | 转播系统 | 直播页 | 是 |
| 支持率更新 | `support_rate_updated` | 包装 | 转播系统 | 支持率面板 | 是 |
| 高光识别 | `highlight_detected` | 派生候选 | 回合战报、事件日志 | 回放、奖项、新闻 | 是 |
| 回放卡片生成 | `replay_card_created` | 包装 | 回放系统 | 回放页、新闻 | 是 |

### 5.5 数据统计（stats）

| 中文名 | 事件类型 | 事实性 | 上游来源 | 下游消费者 | 可投影时间线 |
|---|---|---|---|---|---|
| 数据统计更新 | `stats_updated` | 派生事实 | 数据统计系统 | 数据页、新闻 | 否 |
| 评级更新 | `rating_updated` | 派生事实 | 数据统计系统 | 数据页、奖项 | 否 |
| 奖项授予 | `award_granted` | 派生事实 | 奖项系统 | 奖项页、新闻 | 是 |

### 5.6 新闻媒体（media）

| 中文名 | 事件类型 | 事实性 | 上游来源 | 下游消费者 | 可投影时间线 |
|---|---|---|---|---|---|
| 新闻文章生成 | `article_generated` | 包装 | 新闻与媒体 | 门户页、归档 | 否 |
| 采访生成 | `interview_generated` | 包装 | 新闻与媒体 | 赛后页、归档 | 否 |
| 每日总结生成 | `daily_recap_generated` | 包装 | 新闻与媒体 | 门户页、归档 | 否 |

### 5.7 管理操作（admin）

| 中文名 | 事件类型 | 事实性 | 上游来源 | 下游消费者 | 可投影时间线 |
|---|---|---|---|---|---|
| 人工修正应用 | `admin_correction_applied` | 审计事实 | 管理与控制台 | 调试、审计 | 否 |
| 事件修改快照创建 | `event_revision_created` | 审计事实 | 管理与控制台 | 调试、恢复 | 否 |
| 事件软删除 | `event_soft_deleted` | 审计事实 | 管理与控制台 | 调试、恢复 | 否 |
| 产物保存 | `artifact_saved` | 审计事实 | 持久化与存储 | 调试、归档 | 否 |

### 5.8 运行控制（runtime_control）

| 中文名 | 事件类型 | 事实性 | 上游来源 | 下游消费者 | 可投影时间线 |
|---|---|---|---|---|---|
| 回合审查窗口开始 | `review_window_started` | 运行审计事实 | 比赛模拟引擎 | 管理控制台、调试 | 否 |
| 回合审查窗口过期 | `review_window_expired` | 运行审计事实 | 比赛模拟引擎 | 管理控制台、调试 | 否 |
| 审查暂停请求 | `review_pause_requested` | 运行审计事实 | 管理与控制台 | 管理控制台、调试 | 否 |
| 操作员暂停开始 | `operator_pause_started` | 运行审计事实 | 管理与控制台 | 管理控制台、调试 | 是 |
| 操作员暂停解除 | `operator_pause_resolved` | 运行审计事实 | 管理与控制台 | 管理控制台、调试 | 是 |
| 技术暂停开始 | `technical_pause_started` | 运行审计事实 | 比赛模拟引擎 | 管理控制台、调试 | 是 |
| 技术暂停解除 | `technical_pause_resolved` | 运行审计事实 | 管理与控制台 | 管理控制台、调试 | 是 |
| 地图审查窗口开始 | `map_review_window_started` | 运行审计事实 | 比赛模拟引擎 | 管理控制台、调试 | 否 |
| 地图审查确认 | `map_review_window_confirmed` | 运行审计事实 | 管理与控制台 | 管理控制台、调试 | 否 |

`runtime_control` 事件只记录运行流程、暂停、恢复和审查动作，不参与裁判判定、比分、经济结算、统计或奖项。

### 5.9 时间线投影（timeline）

P0.2 不注册标准 `timeline` 事件类型。时间线事件（TimelineEvent）是从 Event 投影出的派生物，不是比赛事实源。

`timeline` 大类保留给未来需要记录投影审计时使用，例如未来可能新增 `timeline_projected` 或 `timeline_regenerated`，但第一版不需要。

### 5.10 区域化攻防事件预留（Phase 1.6）

区域化攻防协议会新增赛前隐藏计划和回合后公开战术摘要。由于这些事件会影响 Judge 输入、RoundReport 扩展和 replay 兼容性，不能在代码中临时发明；Phase 1.6 实现前必须正式补齐 payload 契约。

预留事件：

| 中文名 | 事件类型 | 建议大类 | 事实性 | 上游来源 | 下游消费者 | 可投影时间线 |
|---|---|---|---|---|---|---|
| 攻守方分配 | `side_assignment_created` | `simulation` | 事实 | 比赛模拟引擎 | Round Context、转播 | 是 |
| 战术计划提交 | `tactical_plan_submitted` | `simulation` | 受限事实 | 攻方 / 守方 agent | Judge、审计 | 否 |
| 区域部署锁定 | `zone_deployment_committed` | `simulation` | 受限事实 | 比赛模拟引擎 | Judge、RoundReport | 否 |
| 区域碰撞判定 | `site_execute_resolved` | `judge` | 事实 | Judge | RoundReport、2D 地图、转播 | 是 |

边界：

```text
受限事实可以进入本地存档和审计，但不应在回合开始前暴露给观众。
tactical_plan_submitted 保存的是计划摘要或 artifact 引用，不应直接把完整 rawOutput 下发给前端。
site_execute_resolved 必须引用 JudgeResult、SubmittedOutput 或 RoundReport，不能单独决定比分。
```

## 6. Payload 契约

所有 payload 必须包含：

```json
{
  "schemaVersion": 1
}
```

本节给每个标准事件类型的最小 payload 示例。示例字段是 P0.2 稳定骨架，后续专项文档可以扩展，但不应删除已定义字段。

### 6.1 比赛模拟（simulation）payload

#### 赛事创建（tournament_created）

字段：`schemaVersion`、`tournamentId`、`name`、`format`。

```json
{
  "schemaVersion": 1,
  "tournamentId": "t_agent_major_001",
  "name": "Agent Major: Champions Bracket",
  "format": "single_elimination_16"
}
```

#### 赛事开始（tournament_started）

字段：`schemaVersion`、`tournamentId`、`startedAt`。

```json
{
  "schemaVersion": 1,
  "tournamentId": "t_agent_major_001",
  "startedAt": "2026-04-29T12:00:00.000Z"
}
```

#### 比赛创建（match_created）

字段：`schemaVersion`、`matchId`、`roundName`、`teamAId`、`teamBId`、`bestOf`。

```json
{
  "schemaVersion": 1,
  "matchId": "match_001",
  "roundName": "round_of_16",
  "teamAId": "team_ghost_nav",
  "teamBId": "team_ghost_fur",
  "bestOf": 3
}
```

#### 比赛开始（match_started）

字段：`schemaVersion`、`matchId`、`teamAId`、`teamBId`、`seriesScore`。

```json
{
  "schemaVersion": 1,
  "matchId": "match_001",
  "teamAId": "team_ghost_nav",
  "teamBId": "team_ghost_fur",
  "seriesScore": {
    "teamA": 0,
    "teamB": 0
  }
}
```

#### 地图禁选完成（map_veto_completed）

字段：`schemaVersion`、`matchId`、`bans`、`picks`、`deciderMapName`、`mapOrder`。

```json
{
  "schemaVersion": 1,
  "matchId": "match_001",
  "bans": [
    { "teamId": "team_ghost_nav", "mapName": "OVERPASS" },
    { "teamId": "team_ghost_fur", "mapName": "ANCIENT" }
  ],
  "picks": [
    { "teamId": "team_ghost_nav", "mapName": "MIRAGE" },
    { "teamId": "team_ghost_fur", "mapName": "NUKE" }
  ],
  "deciderMapName": "DUST2",
  "mapOrder": ["MIRAGE", "NUKE", "DUST2"]
}
```

#### 地图开始（map_started）

字段：`schemaVersion`、`mapGameId`、`mapName`、`order`、`score`。

```json
{
  "schemaVersion": 1,
  "mapGameId": "map_001",
  "mapName": "MIRAGE",
  "order": 1,
  "score": {
    "teamA": 0,
    "teamB": 0
  }
}
```

#### 回合开始（round_started）

字段：`schemaVersion`、`roundId`、`roundNumber`、`scoreBeforeRound`、`activeAgentIds`。

```json
{
  "schemaVersion": 1,
  "roundId": "round_004",
  "roundNumber": 4,
  "scoreBeforeRound": {
    "teamA": 2,
    "teamB": 1
  },
  "activeAgentIds": {
    "teamA": ["agent_nav_star", "agent_nav_closer"],
    "teamB": ["agent_fur_igl", "agent_fur_support"]
  }
}
```

#### 回合结束（round_completed）

字段：`schemaVersion`、`roundId`、`winnerTeamId`、`scoreAfterRound`、`roundReportId`。

```json
{
  "schemaVersion": 1,
  "roundId": "round_004",
  "winnerTeamId": "team_ghost_nav",
  "scoreAfterRound": {
    "teamA": 3,
    "teamB": 1
  },
  "roundReportId": "rr_004"
}
```

#### 地图结束（map_completed）

字段：`schemaVersion`、`mapGameId`、`winnerTeamId`、`finalScore`。

```json
{
  "schemaVersion": 1,
  "mapGameId": "map_001",
  "winnerTeamId": "team_ghost_nav",
  "finalScore": {
    "teamA": 7,
    "teamB": 4
  }
}
```

#### 比赛结束（match_completed）

字段：`schemaVersion`、`matchId`、`winnerTeamId`、`seriesScore`、`advancedTo`。

```json
{
  "schemaVersion": 1,
  "matchId": "match_001",
  "winnerTeamId": "team_ghost_nav",
  "seriesScore": {
    "teamA": 2,
    "teamB": 0
  },
  "advancedTo": "quarterfinal"
}
```

#### 赛事结束（tournament_completed）

字段：`schemaVersion`、`tournamentId`、`championTeamId`、`completedAt`。

```json
{
  "schemaVersion": 1,
  "tournamentId": "t_agent_major_001",
  "championTeamId": "team_ghost_nav",
  "completedAt": "2026-04-29T18:30:00.000Z"
}
```

### 6.2 裁判评分（judge）payload

#### 裁判判定生成（judge_decision_created）

字段：`schemaVersion`、`roundId`、`winnerTeamId`、`reason`、`scoreDelta`、`keyAgentIds`。

```json
{
  "schemaVersion": 1,
  "roundId": "round_004",
  "winnerTeamId": "team_ghost_nav",
  "reason": "Ghost NAV 在强起下完成 Buyer Mid 控制，并在 Conversion Site A 收束商业化路径。",
  "scoreDelta": 1,
  "keyAgentIds": ["agent_nav_star", "agent_nav_closer"]
}
```

#### 比分更新（score_updated）

字段：`schemaVersion`、`scope`、`teamAScore`、`teamBScore`、`reasonEventId`。

```json
{
  "schemaVersion": 1,
  "scope": "map",
  "teamAScore": 3,
  "teamBScore": 1,
  "reasonEventId": "evt_judge_004"
}
```

#### 回合战报生成（round_report_created）

字段：`schemaVersion`、`roundReportId`、`roundId`、`summary`、`keyEventCount`。

```json
{
  "schemaVersion": 1,
  "roundReportId": "rr_004",
  "roundId": "round_004",
  "summary": "Ghost NAV 强起成功，通过 Star 的突破和 Closer 的商业化收束拿下回合。",
  "keyEventCount": 2
}
```

### 6.3 Token 经济（economy）payload

#### 经济快照创建（economy_snapshot_created）

字段：`schemaVersion`、`agentId`、`teamId`、`mapGameId`、`roundId`、`tokenBank`、`buyType`。

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

#### 购买类型决定（buy_type_decided）

字段：`schemaVersion`、`roundId`、`buyTypeByAgent`、`constraintsByAgent`。

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

#### Drop 创建（drop_created）

字段：`schemaVersion`、`roundId`、`fromAgentId`、`toAgentId`、`amount`、`reason`。

```json
{
  "schemaVersion": 1,
  "roundId": "round_004",
  "fromAgentId": "agent_nav_support",
  "toAgentId": "agent_nav_star",
  "amount": 2200,
  "reason": "Support 给 Star 起关键回合装备。"
}
```

#### 经济更新（economy_updated）

字段：`schemaVersion`、`roundId`、`deltaByAgent`。

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

#### 战术暂停使用（timeout_used）

字段：`schemaVersion`、`teamId`、`coachAgentId`、`roundId`、`cost`、`timeoutsRemaining`、`reason`。

```json
{
  "schemaVersion": 1,
  "teamId": "team_ghost_fur",
  "coachAgentId": "agent_fur_coach",
  "roundId": "round_004",
  "cost": 2500,
  "timeoutsRemaining": 1,
  "reason": "连续丢失中路控制后请求教练调整。"
}
```

#### 保经济调用（save_called）

字段：`schemaVersion`、`agentId`、`teamId`、`roundId`、`spendBudget`、`savedTokenEstimate`、`reason`。

```json
{
  "schemaVersion": 1,
  "agentId": "agent_fur_lurker",
  "teamId": "team_ghost_fur",
  "roundId": "round_005",
  "spendBudget": 600,
  "savedTokenEstimate": 9400,
  "reason": "本回合胜率过低，保留资源进入下一回合。"
}
```

#### 强起调用（force_buy_called）

字段：`schemaVersion`、`agentId`、`teamId`、`roundId`、`spendBudget`、`riskLevel`、`reason`。

```json
{
  "schemaVersion": 1,
  "agentId": "agent_nav_star",
  "teamId": "team_ghost_nav",
  "roundId": "round_004",
  "spendBudget": 7600,
  "riskLevel": "high",
  "reason": "落后地图控制但希望用 Star 位抢节奏。"
}
```

#### 输出闸门应用（output_gate_applied）

字段：`schemaVersion`、`agentId`、`roundId`、`rawOutputArtifactId`、`rawOutputTokenEstimate`、`submittedOutputTokenEstimate`、`spendBudget`、`cutMode`、`randomSeed`、`truncationRatio`。

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

### 6.4 转播包装（broadcast）payload

#### 击杀播报生成（kill_feed_created）

字段：`schemaVersion`、`roundId`、`items`、`sourceEventIds`。

```json
{
  "schemaVersion": 1,
  "roundId": "round_004",
  "items": [
    {
      "actorAgentId": "agent_nav_star",
      "targetAgentId": "agent_fur_support",
      "verb": "击穿",
      "zone": "Buyer Mid"
    }
  ],
  "sourceEventIds": ["evt_round_report_004"]
}
```

#### 解说台词生成（caster_line_created）

字段：`schemaVersion`、`speakerRole`、`line`、`tone`、`sourceEventIds`。

```json
{
  "schemaVersion": 1,
  "speakerRole": "play_by_play",
  "line": "这波 Ghost NAV 明明是强起，结果 Star 直接把中路打穿了。",
  "tone": "hype",
  "sourceEventIds": ["evt_force_buy_004", "evt_judge_004"]
}
```

#### 弹幕生成（barrage_created）

字段：`schemaVersion`、`messages`、`intensity`、`sourceEventIds`。

```json
{
  "schemaVersion": 1,
  "messages": ["这也能赢？", "强起真有说法", "Star 今天太猛了"],
  "intensity": "high",
  "sourceEventIds": ["evt_round_completed_004"]
}
```

#### 支持率更新（support_rate_updated）

字段：`schemaVersion`、`scope`、`teamASupportRate`、`teamBSupportRate`、`reason`。

```json
{
  "schemaVersion": 1,
  "scope": "map",
  "teamASupportRate": 68,
  "teamBSupportRate": 32,
  "reason": "Ghost NAV 在强起回合获胜后支持率上升。"
}
```

#### 高光识别（highlight_detected）

字段：`schemaVersion`、`highlightType`、`title`、`roundId`、`sourceEventIds`。

```json
{
  "schemaVersion": 1,
  "highlightType": "force_buy_clutch",
  "title": "强起翻盘：Star 打穿中路",
  "roundId": "round_004",
  "sourceEventIds": ["evt_force_buy_004", "evt_judge_004", "evt_round_completed_004"]
}
```

#### 回放卡片生成（replay_card_created）

字段：`schemaVersion`、`highlightId`、`title`、`summary`、`sourceEventIds`。

```json
{
  "schemaVersion": 1,
  "highlightId": "hl_004",
  "title": "强起也能赢",
  "summary": "Ghost NAV 在低经济下完成中路突破，并用 Closer 收束商业化方案。",
  "sourceEventIds": ["evt_highlight_004"]
}
```

### 6.5 数据统计（stats）payload

#### 数据统计更新（stats_updated）

字段：`schemaVersion`、`scope`、`entityId`、`statsPatch`、`sourceEventIds`。

```json
{
  "schemaVersion": 1,
  "scope": "team",
  "entityId": "team_ghost_nav",
  "statsPatch": {
    "roundsWon": 3,
    "forceBuyWins": 1
  },
  "sourceEventIds": ["evt_round_completed_004"]
}
```

#### 评级更新（rating_updated）

字段：`schemaVersion`、`agentId`、`ratingAfter`、`reason`、`sourceEventIds`。

```json
{
  "schemaVersion": 1,
  "agentId": "agent_nav_star",
  "ratingAfter": 1.28,
  "reason": "强起回合完成关键突破。",
  "sourceEventIds": ["evt_judge_004", "evt_kill_feed_004"]
}
```

#### 奖项授予（award_granted）

字段：`schemaVersion`、`awardType`、`winnerEntityId`、`basisEventIds`、`explanation`。

```json
{
  "schemaVersion": 1,
  "awardType": "match_mvp",
  "winnerEntityId": "agent_nav_star",
  "basisEventIds": ["evt_rating_star_001", "evt_highlight_004"],
  "explanation": "Star 位在关键强起回合打出最高影响力。"
}
```

### 6.6 新闻媒体（media）payload

#### 新闻文章生成（article_generated）

字段：`schemaVersion`、`articleId`、`articleType`、`title`、`sourceEventIds`。

```json
{
  "schemaVersion": 1,
  "articleId": "article_match_001",
  "articleType": "post_match_report",
  "title": "Ghost NAV 强起破局，首轮晋级",
  "sourceEventIds": ["evt_match_completed_001", "evt_highlight_004"]
}
```

#### 采访生成（interview_generated）

字段：`schemaVersion`、`interviewId`、`subjectEntityId`、`topic`、`sourceEventIds`。

```json
{
  "schemaVersion": 1,
  "interviewId": "interview_nav_star_001",
  "subjectEntityId": "agent_nav_star",
  "topic": "强起回合后的战术选择",
  "sourceEventIds": ["evt_highlight_004"]
}
```

#### 每日总结生成（daily_recap_generated）

字段：`schemaVersion`、`recapId`、`date`、`coveredMatchIds`、`sourceEventIds`。

```json
{
  "schemaVersion": 1,
  "recapId": "recap_2026_04_29",
  "date": "2026-04-29",
  "coveredMatchIds": ["match_001", "match_002"],
  "sourceEventIds": ["evt_match_completed_001", "evt_match_completed_002"]
}
```

### 6.7 管理操作（admin）payload

#### 人工修正应用（admin_correction_applied）

字段：`schemaVersion`、`targetEventId`、`operator`、`reason`、`changedFields`。

```json
{
  "schemaVersion": 1,
  "targetEventId": "evt_caster_004",
  "operator": "local_admin",
  "reason": "解说文本重复，需要人工修正。",
  "changedFields": ["payload.line"]
}
```

#### 事件修改快照创建（event_revision_created）

字段：`schemaVersion`、`targetEventId`、`revisionId`、`previousType`、`previousPayload`、`reason`。

```json
{
  "schemaVersion": 1,
  "targetEventId": "evt_caster_004",
  "revisionId": "rev_evt_caster_004_001",
  "previousType": "caster_line_created",
  "previousPayload": {
    "schemaVersion": 1,
    "speakerRole": "play_by_play",
    "line": "重复台词"
  },
  "reason": "修改前快照。"
}
```

#### 事件软删除（event_soft_deleted）

字段：`schemaVersion`、`targetEventId`、`deletedReason`、`operator`。

```json
{
  "schemaVersion": 1,
  "targetEventId": "evt_barrage_bad_001",
  "deletedReason": "弹幕内容不适合展示。",
  "operator": "local_admin"
}
```

#### 产物保存（artifact_saved）

字段：`schemaVersion`、`artifactId`、`artifactType`、`path`、`sourceEventIds`。

```json
{
  "schemaVersion": 1,
  "artifactId": "artifact_raw_llm_004",
  "artifactType": "raw_llm_response",
  "path": "data/tournaments/t_agent_major_001/artifacts/raw_llm_004.json",
  "sourceEventIds": ["evt_round_report_004"]
}
```

### 6.8 运行控制（runtime_control）payload

`runtime_control` payload 必须能回答：哪个运行对象被控制、为什么进入该状态、谁或什么触发了它、如何恢复。

#### 回合审查窗口开始（review_window_started）

字段：`schemaVersion`、`matchId`、`mapGameId`、`roundId`、`durationMs`、`startedAt`。

```json
{
  "schemaVersion": 1,
  "matchId": "match_001",
  "mapGameId": "map_001",
  "roundId": "round_004",
  "durationMs": 15000,
  "startedAt": "2026-04-29T12:08:00.000Z"
}
```

#### 回合审查窗口过期（review_window_expired）

字段：`schemaVersion`、`matchId`、`mapGameId`、`roundId`、`expiredAt`、`nextAction`。

```json
{
  "schemaVersion": 1,
  "matchId": "match_001",
  "mapGameId": "map_001",
  "roundId": "round_004",
  "expiredAt": "2026-04-29T12:08:15.000Z",
  "nextAction": "continue_next_round"
}
```

#### 审查暂停请求（review_pause_requested）

字段：`schemaVersion`、`matchId`、`mapGameId`、`roundId`、`operator`、`reason`。

```json
{
  "schemaVersion": 1,
  "matchId": "match_001",
  "mapGameId": "map_001",
  "roundId": "round_004",
  "operator": "local_admin",
  "reason": "需要检查本回合战报结构。"
}
```

#### 操作员暂停开始（operator_pause_started）

字段：`schemaVersion`、`matchId`、`mapGameId`、`roundId`、`operator`、`reason`、`startedAt`。

```json
{
  "schemaVersion": 1,
  "matchId": "match_001",
  "mapGameId": "map_001",
  "roundId": "round_004",
  "operator": "local_admin",
  "reason": "人工检查经济结算。",
  "startedAt": "2026-04-29T12:08:10.000Z"
}
```

#### 操作员暂停解除（operator_pause_resolved）

字段：`schemaVersion`、`matchId`、`mapGameId`、`roundId`、`operator`、`resolution`、`resolvedAt`。

```json
{
  "schemaVersion": 1,
  "matchId": "match_001",
  "mapGameId": "map_001",
  "roundId": "round_004",
  "operator": "local_admin",
  "resolution": "confirmed_no_change",
  "resolvedAt": "2026-04-29T12:09:00.000Z"
}
```

#### 技术暂停开始（technical_pause_started）

字段：`schemaVersion`、`matchId`、`mapGameId`、`roundId`、`failureType`、`failedStep`、`reason`、`startedAt`。

```json
{
  "schemaVersion": 1,
  "matchId": "match_001",
  "mapGameId": "map_001",
  "roundId": "round_004",
  "failureType": "schema_validation_failed",
  "failedStep": "round_report",
  "reason": "RoundReport 缺少 keyEvents。",
  "startedAt": "2026-04-29T12:08:20.000Z"
}
```

#### 技术暂停解除（technical_pause_resolved）

字段：`schemaVersion`、`matchId`、`mapGameId`、`roundId`、`resolution`、`resolvedBy`、`resolvedAt`。

```json
{
  "schemaVersion": 1,
  "matchId": "match_001",
  "mapGameId": "map_001",
  "roundId": "round_004",
  "resolution": "regenerated_round_report",
  "resolvedBy": "local_admin",
  "resolvedAt": "2026-04-29T12:10:00.000Z"
}
```

#### 地图审查窗口开始（map_review_window_started）

字段：`schemaVersion`、`matchId`、`mapGameId`、`summaryArtifactId`、`startedAt`。

```json
{
  "schemaVersion": 1,
  "matchId": "match_001",
  "mapGameId": "map_001",
  "summaryArtifactId": "artifact_map_summary_001",
  "startedAt": "2026-04-29T12:30:00.000Z"
}
```

#### 地图审查确认（map_review_window_confirmed）

字段：`schemaVersion`、`matchId`、`mapGameId`、`operator`、`confirmedAt`、`nextAction`。

```json
{
  "schemaVersion": 1,
  "matchId": "match_001",
  "mapGameId": "map_001",
  "operator": "local_admin",
  "confirmedAt": "2026-04-29T12:31:00.000Z",
  "nextAction": "start_next_map"
}
```

## 7. 事实事件与包装事件边界

### 7.1 可作为事实依据的事件

以下事件可以作为统计、新闻、奖项、回放依据：

```text
simulation
judge
economy
stats
admin
```

其中 `stats` 是派生事实，只能基于已有事实事件产生。
`runtime_control` 是运行审计事实，可以解释暂停、恢复和审查流程，但不能作为裁判、比分、经济结算、统计或奖项依据。

### 7.2 不能作为比赛事实的事件

以下事件不能作为裁判判定、比分修改、经济结算依据：

```text
broadcast
media
timeline
runtime_control
```

例如：

- 解说台词不能证明某队赢了。
- 弹幕不能成为 MVP 评分依据。
- 新闻不能创造未发生过的高光。
- 时间线事件不能成为统计依据。
- 运行控制事件不能改变比赛结果，只能说明系统为何暂停、恢复或等待确认。

### 7.3 高光的特殊边界

`highlight_detected` 是包装层派生候选，可以进入回放、奖项和新闻，但必须引用事实事件或回合。

## 8. 时间线投影规则

### 8.1 可投影事件

以下事件通常可以投影成时间线事件：

```text
tournament_started
match_started
map_veto_completed
map_started
round_started
buy_type_decided
drop_created
force_buy_called
save_called
timeout_used
output_gate_applied
judge_decision_created
score_updated
economy_updated
round_report_created
round_completed
kill_feed_created
caster_line_created
barrage_created
support_rate_updated
highlight_detected
replay_card_created
operator_pause_started
operator_pause_resolved
technical_pause_started
technical_pause_resolved
map_completed
match_completed
tournament_completed
award_granted
```

### 8.2 投影边界

- TimelineEvent 必须包含 `sourceEventIds`。
- 一个 Event 可以投影成多个 TimelineEvent。
- 多个 Event 可以合并成一个 TimelineEvent。
- TimelineEvent 可以重生成。
- TimelineEvent 不反写 Event。
- TimelineEvent 的具体 `kind` 和前端 payload 留给 `P2.1 直播时间线说明`。

### 8.3 播放时间

P0.2 只规定 `timelineMs` 是相对播放时间，不规定动画节奏。后续 P2.1 可决定：

- 回合播放总时长。
- 解说和弹幕出现时间。
- 高光闪烁时间。
- 快进和重放规则。

## 9. 修改、软删除与快照

### 9.1 修改策略

允许修改主 Event，但修改前必须写入事件修改快照（EventRevision）。主查询读取最新 Event。

### 9.2 EventRevision 概念字段

| 中文字段 | 代码字段 | 类型草案 | 必填 | 说明 |
|---|---|---|---|---|
| 修改快照 ID | `id` | `string` | 是 | 稳定引用 ID。 |
| 目标事件 ID | `targetEventId` | `string` | 是 | 被修改的 Event。 |
| 修改前类型 | `previousType` | `EventType` | 是 | 修改前事件类型。 |
| 修改前载荷 | `previousPayload` | `unknown` | 是 | 修改前 payload。 |
| 修改人 / 模块 | `operator` | `string` | 是 | local_admin 或 sourceModule。 |
| 修改原因 | `reason` | `string` | 是 | 必须可读。 |
| 创建时间 | `createdAt` | `string` | 是 | ISO 时间字符串。 |

### 9.3 事实事件慎改

事实事件可以修改，但必须：

- 先创建 `event_revision_created`。
- 再应用修改。
- 再创建 `admin_correction_applied`。
- 写明修改原因。

包装事件也应创建修改快照，但原因可以更轻量。

### 9.4 软删除规则

- 删除事件时只写 `deletedAt` 和 `deletedReason`。
- 默认查询隐藏软删除事件。
- 管理与调试视图可以查看软删除事件。
- 软删除时应创建 `event_soft_deleted`。
- 不使用硬删除作为默认策略。

## 10. 扩展事件接口

### 10.1 命名空间

官方事件类型使用本文档定义的 snake_case。未来自定义事件使用：

```text
custom.*
extension.*
```

示例：

```text
custom.viewer_vote_created
extension.fantasy_pick_locked
```

### 10.2 扩展规则

- 自定义事件不能覆盖官方事件类型。
- 自定义事件 payload 必须包含 `schemaVersion`。
- 自定义事件必须声明 `category`。
- 自定义事件默认不能作为裁判、统计、奖项依据。
- 如果自定义事件要进入统计或奖项，必须由后续专项文档显式注册。

### 10.3 兼容规则

新增 payload 字段允许；删除已定义字段不允许。改变字段含义时必须提升 `schemaVersion`。

## 11. 事件序列样例

### 11.1 一回合完整事件序列

```text
1. 回合开始（round_started）
2. 经济快照创建（economy_snapshot_created）
3. 购买类型决定（buy_type_decided）
4. Drop 创建（drop_created，可选）
5. 强起调用（force_buy_called，可选）
6. 保经济调用（save_called，可选）
7. 战术暂停使用（timeout_used，可选）
8. 输出闸门应用（output_gate_applied）
9. 裁判判定生成（judge_decision_created）
10. 比分更新（score_updated）
11. 经济更新（economy_updated）
12. 回合战报生成（round_report_created）
13. 回合结束（round_completed）
14. 击杀播报生成（kill_feed_created）
15. 解说台词生成（caster_line_created）
16. 弹幕生成（barrage_created）
17. 支持率更新（support_rate_updated）
18. 高光识别（highlight_detected）
19. 数据统计更新（stats_updated）
20. 评级更新（rating_updated）
```

说明：

- 1-13 是同步核心路径或核心事实。
- 14-20 可以异步生成或后补。
- 转播包装失败不应阻塞回合完成。

### 11.2 一场 BO3 比赛生命周期序列

```text
1. 比赛创建（match_created）
2. 比赛开始（match_started）
3. 地图禁选完成（map_veto_completed）
4. 地图开始（map_started）
5. 多个回合事件序列
6. 地图结束（map_completed）
7. 地图开始（map_started）
8. 多个回合事件序列
9. 地图结束（map_completed）
10. 如有决胜图，重复地图开始到地图结束
11. 比赛结束（match_completed）
12. 奖项授予（award_granted）
13. 新闻文章生成（article_generated）
14. 采访生成（interview_generated）
15. 产物保存（artifact_saved）
```

## 12. 与后续文档关系

| 后续文档 | 消费 P0.2 的内容 | 后续负责细化 |
|---|---|---|
| P1.1 回合战报契约 | `round_report_created`、`round_completed`、`judge_decision_created`、`keyEvents` 的事件拆解关系 | RoundReport 完整结构和 key event 类型。 |
| P1.2 Token 经济说明 | economy 类事件、BuyType、Drop、Output Gate 相关 payload | Agent 级经济公式、阈值、资源约束和输出裁剪。 |
| P1.4 比赛 / 地图 / 回合引擎说明 | simulation、judge、economy 核心事件序列 | 状态机和执行流程。 |
| P2.1 直播时间线说明 | 可投影事件、`sourceEventIds`、`timelineMs` 边界 | TimelineEvent kind、动画、播放节奏。 |
| P2.2 2D 战术地图说明 | `round_started`、`kill_feed_created`、`highlight_detected` 等事件来源 | 地图区域、控制变化、前端渲染 payload。 |
| P2.3 转播系统说明 | broadcast 类事件 | 解说、弹幕、支持率、回放卡片生成规则。 |
| P3.1 数据统计与奖项说明 | stats 类事件和事实事件边界 | 统计公式、MVP/EVP 评分。 |
| P3.2 新闻与媒体说明 | media 类事件和事实引用规则 | 新闻模板、引用格式、栏目结构。 |

## 13. 验收标准

完成 P0.2 后，应满足：

- 每个事件大类都有职责边界。
- 每个标准事件类型都有中文名、英文 type、事实性、上游、下游、是否可投影时间线。
- 每个标准事件类型都有 payload 示例。
- 每个 payload 示例都包含 `schemaVersion`。
- 明确哪些事件可用于统计、新闻、奖项，哪些只能用于转播播放。
- 明确 Event 与 TimelineEvent 的投影边界，但不抢 P2.1 的详细 kind 设计。
- 明确 RoundReport 如何拆成回合、裁判、比分、经济、击杀播报、高光等事件。
- 明确 2D 地图只消费事件，不反写比赛事实。
- 明确新闻、统计、奖项不能引用解说或弹幕作为事实。
- 明确事件允许修改，但必须创建 EventRevision 快照。
- 明确默认删除策略是软删除，不使用硬删除。
- 明确未来自定义事件使用 `custom.*` 或 `extension.*` 命名空间。
## Phase 1.6 增量：区域化攻防事件已落地

Phase 1.6 在不新增 SQLite 表的前提下，补入 4 个稳定战术事实事件：

| 中文名 | EventType | 用途 |
|---|---|---|
| 攻守方分配已创建 | `side_assignment_created` | 记录本回合攻方、守方、半场、是否换边 |
| 进攻计划已提交 | `tactical_plan_submitted` | restricted 事件，只保存公开摘要、主攻点、二攻点、打法，不保存隐藏原文 |
| 防守部署已提交 | `zone_deployment_committed` | restricted 事件，只保存公开摘要、重防区、弱防区、回防策略，不保存隐藏原文 |
| 点位执行已结算 | `site_execute_resolved` | public_after_round 事件，公开碰撞区、攻防摘要、TacticalCollision 结果 |

这些事件属于比赛事实链路，但不独立改写胜负、比分或经济。`winnerTeamId`、`scoreBeforeRound`、`scoreAfterRound`、`economyDelta` 仍由既有 Judge、Engine、Economy 模块负责。

所有 Phase 1.6 tactical event payload 禁止出现以下字段：`rawOutput`、`driverModelId`、`providerId`、`modelName`、`token`、`cost`、`apiKey`、`authorization`。受限事件允许保存 `artifactId` 引用，但当前 Phase 1.6 v1 不要求写隐藏 artifact 原文。

## Phase 1.7 增量：事件中的角色身份边界

Phase 1.7 后，事件 payload 中的 `agentId` 只作为稳定实体引用，不能再通过 id 后缀解析角色。旧示例中的 `agent_nav_star`、`agent_nav_closer` 只代表历史样例 ID，不代表当前 primary role 契约。

当前规则：

```text
角色展示读取 Replay / Match safe agentsById 视图。
主角色读取 Agent.role。
副标签读取 Agent.secondaryRoles。
star 旧数据读取时映射为 star_rifler。
closer 旧数据读取时映射为 rifler，closer 特质可作为 secondary role tag 保留。
```

事件和公开 replay payload 不得暴露 `driverModelId`、`modelName`、`llm_calls`、API key、Authorization 或 future LLM binding 全量 JSON。
