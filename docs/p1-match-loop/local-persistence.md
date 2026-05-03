# P1.5 本地持久化说明（Local Persistence Spec）

## 1. 文档定位

这份文档定义 Agent Major 本地版的数据保存方式。它回答的问题是：

```text
比赛事实保存在哪里？
哪些内容必须入库？
哪些大文本或文件型产物保存到项目内 data/？
系统重启后如何继续比赛？
一场 BO3 如何完整回放、导出和复盘？
后期迁移到 Web / Postgres / 对象存储时，哪些接口不需要改？
```

P1.5 不是最终数据库迁移文件，不是 ORM 实现，也不是 API 文档。它是本地版工程实现前必须固定的持久化契约。

## 2. 用户决策

本地持久化遵循以下已确认决策：

- RawOutput 默认本地永久保存。
- 数据库和数据文件统一放在项目内 `data/`，不写入用户目录，不污染系统环境。
- 必须支持一键导出整场比赛 / 整届赛事为 JSON。
- 解说、弹幕、新闻、回放卡、支持率等包装内容全文入库，同时可按需关联 Artifact。

## 3. 上游与下游

### 3.1 上游依赖

| 上游文档 | 本文档消费内容 |
|---|---|
| P0.1 领域模型 | Tournament、Team、Agent、DriverModel、Match、MapGame、Round、RoundReport、EconomyState、Event、TimelineEvent、Summary、Highlight、BroadcastItem、Award、Article、Artifact。 |
| P0.2 事件分类 | Event 通用字段、事件大类、事件类型、payload 版本、artifact_saved、article_generated 等事件。 |
| P0.3 规则与赛制说明 | 16 队单败、BO3、地图禁选、MR6、比赛生命周期。 |
| P1.1 回合战报契约 | RoundReport、AgentOutput、RawOutput、SubmittedOutput、keyEvents、sourceAgentOutputIds。 |
| P1.2 Token 经济说明 | Agent 级 EconomyState、Drop、Output Gate、经济事件、SubmittedOutput 裁剪结果。 |
| P1.3 大模型驾驶员契约 | LLM Gateway、DriverModel、RawOutput、调用记录、失败重试。 |
| P1.4 比赛模拟引擎 | playNextRound 流程、事件写入顺序、同步关键路径、异步任务边界。 |

### 3.2 下游消费者

| 下游模块 | 消费内容 |
|---|---|
| 工程实现 | SQLite schema、Repository 接口、Artifact Store、事务边界。 |
| P2.1 直播时间线 | Event 和 TimelineEvent 缓存。 |
| P2.2 2D 战术地图 | RoundReport.keyEvents、TimelineEvent、MapGame 状态。 |
| P2.3 转播系统 | BroadcastItem、Event、RoundReport、Article / Replay Artifact。 |
| P3 数据与奖项 | Event、RoundReport、EconomyState、Highlight、Award。 |
| P4 Web 迁移 | Repository、ArtifactStore、JobQueue 的可替换接口。 |

## 4. 持久化原则

### 4.1 Event 是事实账本

事件（Event）是系统事实源。任何可追溯的比赛行为、裁判结果、经济变化、转播包装、新闻生成、人工修正，都应该能追溯到 Event。

规则：

- Event 默认不可硬删除。
- 需要隐藏或撤回时使用软删除字段，或追加管理操作事件。
- Event payload 必须保留 `schemaVersion`。
- 派生内容必须保存 `sourceEventIds` 或可追溯的上游对象 ID。

### 4.2 RoundReport 是回合结构化结果

回合战报（RoundReport）是从模拟结果到事件、2D 地图、击杀播报、解说、统计和新闻的桥梁。

规则：

- RoundReport 必须入库。
- RoundReport 的结构化 JSON 必须完整保存。
- RoundReport.summary 可冗余为文本字段，便于查询和列表展示。
- RawOutput 不直接写入 RoundReport 主表正文，只通过 AgentOutput 字段或 Artifact 引用追溯。

### 4.3 Artifact 保存重内容

产物文件（Artifact）负责保存大文本、原始响应、导出文件、回放快照和调试日志。

第一版本地策略：

- 所有 Artifact 文件保存在项目内 `data/`。
- Artifact 元数据入库。
- RawOutput 和原始 LLM 响应默认永久保存。
- 后期可以增加清理策略，但不作为第一版默认行为。

### 4.4 包装内容全文入库

解说、弹幕、击杀播报、支持率更新、回放卡、新闻文章都需要全文入库。

原因：

- 本地硬盘空间充足。
- 全文入库便于搜索、调试、回放和导出。
- Artifact 可作为补充，不替代数据库正文。

### 4.5 派生物可以重生成

TimelineEvent、Summary、Highlight、BroadcastItem、Article、Award 都是派生物，但第一版本地仍建议入库。

边界：

- 它们可以重生成。
- 它们不能改写 Event。
- 它们不能替代 RoundReport、JudgeResult 或 EconomyState。

## 5. 本地目录结构

本地数据统一放在项目内：

```text
AgentsMajor/
  data/
    agent-major.sqlite
    exports/
      tournaments/
      matches/
    tournaments/
      <tournamentId>/
        artifacts/
          raw-output/
          raw-llm-response/
          submitted-output/
          articles/
          replay/
          exports/
          debug/
        logs/
```

说明：

- `data/agent-major.sqlite` 是本地 SQLite 主数据库。
- `data/tournaments/<tournamentId>/artifacts/` 存赛事相关文件型产物。
- `data/exports/` 存一键导出的 JSON 包。
- 路径全部相对项目根目录，避免污染用户目录。

## 6. SQLite 表总览

P1 工程实现必须优先定义核心必需表。它们支撑本地运行、事实恢复、回合推进和基础审计。

```text
tournaments
teams
agents
driver_models
matches
map_games
rounds
round_reports
economy_states
events
artifacts
llm_calls
jobs
admin_audit_logs
```

P2 / P3 预留派生表可以在专项文档完成后再冻结字段。P1.5 只给出本地持久化方向，不把它们作为已锁死 schema：

```text
timeline_events
summaries
highlights
broadcast_items
articles
awards
stats_snapshots
```

可后置表：

```text
team_profiles
agent_parameter_profiles
map_materials
broadcast_materials
```

后置表不阻塞最小 BO3 闭环。

## 7. 核心表设计

### 7.1 tournaments

保存赛事顶层容器。

| 字段 | 类型草案 | 说明 |
|---|---|---|
| `id` | `text primary key` | 赛事 ID。 |
| `name` | `text` | 赛事名称。 |
| `status` | `text` | draft / running / completed / archived。 |
| `format` | `text` | 第一版为 single_elimination_16。 |
| `championTeamId` | `text null` | 冠军队伍。 |
| `createdAt` | `text` | 创建时间。 |
| `startedAt` | `text null` | 开始时间。 |
| `completedAt` | `text null` | 完成时间。 |

### 7.2 teams

保存幽灵战队。

| 字段 | 类型草案 | 说明 |
|---|---|---|
| `id` | `text primary key` | 队伍 ID。 |
| `tournamentId` | `text index` | 所属赛事。 |
| `displayName` | `text` | 展示名称。 |
| `shortName` | `text` | 短名称。 |
| `seed` | `integer` | 种子顺位。 |
| `sourceJson` | `text null` | TeamSource JSON。 |
| `teamProfileId` | `text null` | 未来队伍风格参数入口。 |
| `createdAt` | `text` | 创建时间。 |
| `updatedAt` | `text null` | 更新时间。 |

### 7.3 agents

保存智能体角色，不保存模型实现细节。

| 字段 | 类型草案 | 说明 |
|---|---|---|
| `id` | `text primary key` | 智能体 ID。 |
| `teamId` | `text index` | 所属队伍。 |
| `driverModelId` | `text index` | 指向 DriverModel。 |
| `parameterProfileId` | `text null` | 未来智能体参数入口。 |
| `role` | `text` | coach / igl / awper / entry / star_rifler / lurker / support / rifler / stand_in。 |
| `secondaryRolesJson` | `text null` | AgentRoleTag[]，保存 anchor / flex / closer / system_architect 等副标签。 |
| `roleProfileJson` | `text null` | AgentRoleProfile JSON，保存 materials raw position、confidence、positionTags 和职责说明。 |
| `materialRefJson` | `text null` | AgentMaterialRef JSON，保存 materials entity id、team slug、json path、binding version 与 runtimeEnabled。 |
| `displayName` | `text` | 展示名称。 |
| `baseProfileJson` | `text` | AgentBaseProfile JSON。 |
| `currentState` | `text` | ready / active / hot 等。 |
| `createdAt` | `text` | 创建时间。 |
| `updatedAt` | `text null` | 更新时间。 |

Phase 1.7 兼容规则：

```text
读取旧数据时 star 映射为 star_rifler。
读取旧数据时 closer 映射为 rifler。
新写入不再产生 star 或 closer primary role。
closer 只允许作为 secondaryRolesJson 中的副标签保留。
materialRefJson.runtimeEnabled 在 Phase 1.7 必须为 false。
```

### 7.4 driver_models

保存大模型驾驶员配置。

| 字段 | 类型草案 | 说明 |
|---|---|---|
| `id` | `text primary key` | 驾驶员模型 ID。 |
| `provider` | `text` | 模型供应商。 |
| `modelName` | `text` | 模型名称。 |
| `capabilitiesJson` | `text` | 能力标签 JSON。 |
| `limitsJson` | `text null` | 限制信息 JSON。 |
| `defaultUseCaseJson` | `text null` | 默认用途 JSON。 |
| `enabled` | `integer` | 0 / 1。 |
| `createdAt` | `text` | 创建时间。 |
| `updatedAt` | `text null` | 更新时间。 |

### 7.5 matches

保存 BO3 比赛状态。

| 字段 | 类型草案 | 说明 |
|---|---|---|
| `id` | `text primary key` | 比赛 ID。 |
| `tournamentId` | `text index` | 所属赛事。 |
| `roundName` | `text` | round_of_16 / quarterfinal / semifinal / final。 |
| `teamAId` | `text` | A 队。 |
| `teamBId` | `text` | B 队。 |
| `status` | `text` | scheduled / veto / running / completed / failed / cancelled。 |
| `bestOf` | `integer` | 第一版为 3。 |
| `teamAMapsWon` | `integer` | A 队地图胜场。 |
| `teamBMapsWon` | `integer` | B 队地图胜场。 |
| `winnerTeamId` | `text null` | 胜者。 |
| `scheduledOrder` | `integer` | 赛程顺序。 |
| `createdAt` | `text` | 创建时间。 |
| `startedAt` | `text null` | 开始时间。 |
| `completedAt` | `text null` | 完成时间。 |

### 7.6 map_games

保存单张地图局状态。

| 字段 | 类型草案 | 说明 |
|---|---|---|
| `id` | `text primary key` | 地图局 ID。 |
| `matchId` | `text index` | 所属比赛。 |
| `mapName` | `text` | DUST2 / INFERNO 等。 |
| `order` | `integer` | BO3 第几张地图。 |
| `status` | `text` | scheduled / running / overtime / completed / failed / cancelled。 |
| `runControlState` | `text null` | idle / running_map / review_window / operator_pause / technical_pause / map_review_window / waiting_for_next_map；不参与胜负结算。 |
| `teamAScore` | `integer` | A 队地图比分。 |
| `teamBScore` | `integer` | B 队地图比分。 |
| `currentRoundNumber` | `integer` | 当前回合号。 |
| `winnerTeamId` | `text null` | 地图胜者。 |
| `summaryId` | `text null` | 当前地图摘要。 |
| `createdAt` | `text` | 创建时间。 |
| `startedAt` | `text null` | 开始时间。 |
| `completedAt` | `text null` | 完成时间。 |

### 7.7 rounds

保存回合同步状态。

| 字段 | 类型草案 | 说明 |
|---|---|---|
| `id` | `text primary key` | 回合 ID。 |
| `mapGameId` | `text index` | 所属地图局。 |
| `roundNumber` | `integer` | 地图内回合号。 |
| `status` | `text` | scheduled / running / judging / completed / failed。 |
| `phase` | `text null` | buying / generating / output_gate / judging / reporting / committing；执行阶段，不是生命周期状态。 |
| `teamABuyType` | `text null` | A 队展示用主购买类型，可由 Agent 级聚合得到。 |
| `teamBBuyType` | `text null` | B 队展示用主购买类型，可由 Agent 级聚合得到。 |
| `teamAActiveAgentIdsJson` | `text` | A 队激活智能体 ID JSON。 |
| `teamBActiveAgentIdsJson` | `text` | B 队激活智能体 ID JSON。 |
| `winnerTeamId` | `text null` | 回合胜者。 |
| `roundReportId` | `text null` | 回合战报。 |
| `errorJson` | `text null` | 失败信息。 |
| `createdAt` | `text` | 创建时间。 |
| `startedAt` | `text null` | 开始时间。 |
| `completedAt` | `text null` | 完成时间。 |

### 7.8 round_reports

保存完整结构化回合战报。

| 字段 | 类型草案 | 说明 |
|---|---|---|
| `id` | `text primary key` | 回合战报 ID。 |
| `roundId` | `text unique` | 所属回合。 |
| `winnerTeamId` | `text` | 回合胜者。 |
| `scoreAfterRoundJson` | `text` | 回合后比分。 |
| `judgeResultJson` | `text` | 裁判结果。 |
| `agentOutputsJson` | `text` | AgentOutput 列表，含 submittedOutput 和 artifact 引用。 |
| `keyEventsJson` | `text` | RoundKeyEvent 列表。 |
| `economySummaryJson` | `text` | 队伍和 Agent 级经济摘要。 |
| `highlightTagsJson` | `text null` | 高光标签。 |
| `sourceEventIdsJson` | `text null` | 来源事件。 |
| `summary` | `text` | 简短自然语言战报。 |
| `createdAt` | `text` | 创建时间。 |

### 7.9 economy_states

保存 Agent 级经济状态。

| 字段 | 类型草案 | 说明 |
|---|---|---|
| `id` | `text primary key` | 经济状态 ID。 |
| `agentId` | `text index` | 所属智能体。 |
| `teamId` | `text index` | 所属队伍，用于聚合展示。 |
| `mapGameId` | `text index` | 所属地图。 |
| `roundId` | `text null index` | 所属回合，可为空表示地图初始状态。 |
| `phase` | `text` | before_buy / after_buy / after_round。 |
| `tokenBank` | `integer` | 当前比赛内经济。 |
| `buyType` | `text` | fullBuy / halfBuy / eco / forceBuy / save。 |
| `lossStreak` | `integer` | 连败次数。 |
| `timeoutsRemaining` | `integer` | 暂停数。 |
| `visibleContextBudget` | `integer null` | 可见上下文预算。 |
| `outputBudget` | `integer null` | 有效提交预算。 |
| `createdAt` | `text` | 创建时间。 |

约束：

- `tokenBank >= 0`。
- `phase` 用于同一回合保存多个快照。
- 团队经济通过 `teamId + roundId + phase` 聚合，不单独作为购买主体。

### 7.10 events

保存事件日志。

| 字段 | 类型草案 | 说明 |
|---|---|---|
| `id` | `text primary key` | 事件 ID。 |
| `type` | `text index` | EventType。 |
| `category` | `text index` | EventCategory。 |
| `tournamentId` | `text index` | 所属赛事。 |
| `matchId` | `text null index` | 所属比赛。 |
| `mapGameId` | `text null index` | 所属地图局。 |
| `roundId` | `text null index` | 所属回合。 |
| `payloadJson` | `text` | 事件 payload JSON。 |
| `payloadSchemaVersion` | `integer` | payload.schemaVersion。 |
| `globalSequence` | `integer unique` | 事实账本内的单调递增顺序，用于恢复、审计和导出。 |
| `scopeType` | `text` | tournament / match / map / round。 |
| `scopeId` | `text index` | 与 scopeType 对应的业务对象 ID。 |
| `sequenceInScope` | `integer` | 同一 scope 内的稳定顺序，回合内事件重放优先使用它。 |
| `timelineMs` | `integer null` | 伪直播播放排序。 |
| `sourceModule` | `text null` | 来源模块。 |
| `createdAt` | `text` | 创建时间。 |
| `updatedAt` | `text null` | 更新时间。 |
| `deletedAt` | `text null` | 软删除时间。 |
| `deletedReason` | `text null` | 软删除原因。 |

索引建议：

```text
(tournamentId, createdAt)
(matchId, createdAt)
(mapGameId, roundId, createdAt)
(scopeType, scopeId, sequenceInScope)
(type, createdAt)
(category, createdAt)
```

排序规则：

- `globalSequence` 是事实账本的最终审计顺序，不依赖 `createdAt`。
- `sequenceInScope` 是局部确定顺序，回合内 replay、统计和恢复优先读取 round scope。
- `timelineMs` 只服务伪直播播放，不作为事实顺序依据。

### 7.11 派生表说明

以下 `timeline_events`、`summaries`、`highlights`、`broadcast_items`、`articles`、`awards` 是 P2 / P3 预留派生表草案。它们可以在专项文档完成后调整字段，不应反向修改 P1 核心事实表和引擎契约。

### 7.12 timeline_events

保存伪直播时间线缓存。它不是事实源，可以重生成。

| 字段 | 类型草案 | 说明 |
|---|---|---|
| `id` | `text primary key` | 时间线事件 ID。 |
| `tournamentId` | `text index` | 所属赛事。 |
| `matchId` | `text null index` | 所属比赛。 |
| `mapGameId` | `text null index` | 所属地图。 |
| `roundId` | `text null index` | 所属回合。 |
| `sourceEventIdsJson` | `text` | 来源事件 ID。 |
| `atMs` | `integer` | 播放时间点。 |
| `kind` | `text` | TimelineEventKind。 |
| `payloadJson` | `text` | 前端渲染 payload。 |
| `createdAt` | `text` | 创建时间。 |

### 7.13 summaries

保存摘要和上下文燃料。

| 字段 | 类型草案 | 说明 |
|---|---|---|
| `id` | `text primary key` | 摘要 ID。 |
| `scope` | `text` | round / map / match / team_tactical_memory。 |
| `tournamentId` | `text index` | 所属赛事。 |
| `matchId` | `text null index` | 所属比赛。 |
| `mapGameId` | `text null index` | 所属地图。 |
| `roundId` | `text null index` | 所属回合。 |
| `teamId` | `text null index` | 所属队伍。 |
| `content` | `text` | 摘要正文。 |
| `sourceEventIdsJson` | `text null` | 来源事件。 |
| `createdAt` | `text` | 创建时间。 |
| `updatedAt` | `text null` | 更新时间。 |

### 7.14 highlights

保存高光。

| 字段 | 类型草案 | 说明 |
|---|---|---|
| `id` | `text primary key` | 高光 ID。 |
| `tournamentId` | `text index` | 所属赛事。 |
| `matchId` | `text null index` | 所属比赛。 |
| `mapGameId` | `text null index` | 所属地图。 |
| `roundId` | `text null index` | 所属回合。 |
| `title` | `text` | 标题。 |
| `highlightType` | `text` | clutch / eco_clutch / coach_call 等。 |
| `summary` | `text` | 摘要。 |
| `sourceEventIdsJson` | `text` | 来源事件。 |
| `sourceRoundReportId` | `text null` | 来源战报。 |
| `createdAt` | `text` | 创建时间。 |

### 7.15 broadcast_items

保存所有转播包装内容全文。

| 字段 | 类型草案 | 说明 |
|---|---|---|
| `id` | `text primary key` | 转播条目 ID。 |
| `kind` | `text index` | caster_line / barrage / kill_feed / support_rate / replay_card。 |
| `tournamentId` | `text index` | 所属赛事。 |
| `matchId` | `text null index` | 所属比赛。 |
| `mapGameId` | `text null index` | 所属地图。 |
| `roundId` | `text null index` | 所属回合。 |
| `title` | `text null` | 标题。 |
| `content` | `text` | 全文内容。 |
| `payloadJson` | `text null` | 结构化补充。 |
| `sourceEventIdsJson` | `text null` | 来源事件。 |
| `artifactId` | `text null` | 可选产物。 |
| `createdAt` | `text` | 创建时间。 |

### 7.16 articles

保存新闻文章全文。

| 字段 | 类型草案 | 说明 |
|---|---|---|
| `id` | `text primary key` | 文章 ID。 |
| `articleType` | `text index` | pre_match / live_flash / post_match_report / interview / recap。 |
| `tournamentId` | `text index` | 所属赛事。 |
| `matchId` | `text null index` | 所属比赛。 |
| `mapGameId` | `text null index` | 所属地图。 |
| `roundId` | `text null index` | 所属回合。 |
| `title` | `text` | 标题。 |
| `summary` | `text null` | 摘要。 |
| `content` | `text` | 全文。 |
| `sourceEventIdsJson` | `text` | 来源事件。 |
| `artifactId` | `text null` | 可选产物。 |
| `createdAt` | `text` | 创建时间。 |

### 7.17 awards

保存奖项。

| 字段 | 类型草案 | 说明 |
|---|---|---|
| `id` | `text primary key` | 奖项 ID。 |
| `tournamentId` | `text index` | 所属赛事。 |
| `matchId` | `text null index` | 所属比赛。 |
| `awardType` | `text index` | MVP / EVP / best_clutch 等。 |
| `targetType` | `text` | team / agent / match / round。 |
| `targetId` | `text` | 获奖对象。 |
| `title` | `text` | 展示标题。 |
| `reason` | `text` | 解释全文。 |
| `basisJson` | `text` | 基础统计和来源依据。 |
| `sourceEventIdsJson` | `text` | 来源事件。 |
| `createdAt` | `text` | 创建时间。 |

### 7.18 artifacts

保存产物文件元数据。

| 字段 | 类型草案 | 说明 |
|---|---|---|
| `id` | `text primary key` | 产物 ID。 |
| `artifactType` | `text index` | raw_output / raw_llm_response / export_json / replay_snapshot / debug_log / article_file。 |
| `tournamentId` | `text index` | 所属赛事。 |
| `matchId` | `text null index` | 所属比赛。 |
| `mapGameId` | `text null index` | 所属地图。 |
| `roundId` | `text null index` | 所属回合。 |
| `agentId` | `text null index` | 关联智能体。 |
| `uri` | `text` | 项目内相对路径或未来对象存储 URI。 |
| `mimeType` | `text null` | 文件类型。 |
| `sizeBytes` | `integer null` | 文件大小。 |
| `checksum` | `text null` | 校验值。 |
| `status` | `text` | pending / ready / failed。 |
| `sourceEventIdsJson` | `text null` | 来源事件。 |
| `createdAt` | `text` | 创建时间。 |

### 7.19 llm_calls

保存真实大模型调用记录。它只用于调试、成本和可观测性，不进入比赛经济。

| 字段 | 类型草案 | 说明 |
|---|---|---|
| `id` | `text primary key` | 调用 ID。 |
| `tournamentId` | `text null index` | 所属赛事。 |
| `matchId` | `text null index` | 所属比赛。 |
| `roundId` | `text null index` | 所属回合。 |
| `agentId` | `text null index` | 关联智能体。 |
| `driverModelId` | `text index` | 使用的驾驶员模型。 |
| `taskType` | `text index` | agent_action / judge / caster / barrage / news 等。 |
| `promptHash` | `text null` | prompt 指纹。 |
| `requestArtifactId` | `text null` | 请求产物。 |
| `responseArtifactId` | `text null` | 响应产物。 |
| `inputTokens` | `integer null` | 真实输入 token。 |
| `outputTokens` | `integer null` | 真实输出 token。 |
| `estimatedCost` | `real null` | 估算成本。 |
| `latencyMs` | `integer null` | 延迟。 |
| `status` | `text` | pending / success / failed / retried。 |
| `errorJson` | `text null` | 错误。 |
| `createdAt` | `text` | 创建时间。 |

### 7.20 jobs

保存本地任务队列状态。

| 字段 | 类型草案 | 说明 |
|---|---|---|
| `id` | `text primary key` | 任务 ID。 |
| `type` | `text index` | simulate_round / generate_barrage 等。 |
| `status` | `text index` | pending / running / completed / failed / cancelled。 |
| `priority` | `integer` | 优先级。 |
| `payloadJson` | `text` | 任务 payload。 |
| `attempts` | `integer` | 已尝试次数。 |
| `maxAttempts` | `integer` | 最大尝试次数。 |
| `runAfter` | `text null` | 延迟执行时间。 |
| `lockedAt` | `text null` | 运行锁时间。 |
| `completedAt` | `text null` | 完成时间。 |
| `errorJson` | `text null` | 错误。 |
| `createdAt` | `text` | 创建时间。 |

### 7.21 admin_audit_logs

保存人工干预审计记录。

| 字段 | 类型草案 | 说明 |
|---|---|---|
| `id` | `text primary key` | 审计 ID。 |
| `action` | `text index` | correction / soft_delete / regenerate / resume 等。 |
| `targetType` | `text` | event / round / artifact / job 等。 |
| `targetId` | `text` | 目标 ID。 |
| `beforeJson` | `text null` | 修改前。 |
| `afterJson` | `text null` | 修改后。 |
| `reason` | `text` | 原因。 |
| `createdAt` | `text` | 创建时间。 |

## 8. JSON 字段规则

SQLite 第一版可以使用 `text` 保存 JSON 字段，工程层统一做解析和校验。

规则：

- 所有 `xxxJson` 字段必须是合法 JSON 字符串。
- 入库前由 Zod 或等价结构校验。
- `payloadJson` 必须包含 `schemaVersion`。
- 读取时 Repository 返回结构化对象，不把 JSON 解析散落在 UI 或业务流程里。

## 9. Artifact 保存规则

### 9.1 Artifact 类型

第一版 Artifact 类型：

```text
raw_output
raw_llm_response
submitted_output
export_json
replay_snapshot
debug_log
article_file
prompt_request
```

### 9.2 RawOutput 保存

RawOutput 默认保存：

- 数据库 `round_reports.agentOutputsJson` 保存 `rawOutputRef`、`rawOutputSummary`、token 估算。
- 文件系统保存完整 RawOutput 文本。
- `artifacts` 表保存文件元数据。
- `llm_calls` 表保存真实调用数据和响应 Artifact。

### 9.3 文件写入顺序

建议流程：

```text
1. 创建 artifacts 记录，status = pending。
2. 写入文件到临时路径。
3. 计算 size / checksum。
4. 原子重命名到正式路径。
5. 更新 artifacts.status = ready。
6. 写入 artifact_saved 事件。
```

如果失败：

```text
1. artifacts.status = failed。
2. 保存 error 信息。
3. 关键事实流程可根据 artifact 类型决定是否中断。
```

RawOutput 保存失败时，建议中断回合推进，因为 RoundReport 需要可追溯。

## 10. 事务边界

### 10.1 playNextRound 核心事务

一次 `playNextRound` 至少要保证核心事实一致。

建议分成两个阶段：

```text
阶段 A：外部生成阶段
调用 LLM、保存 RawOutput Artifact、Output Gate、Judge、RoundReport 构造。

阶段 B：数据库提交阶段
在 SQLite transaction 中写入 RoundReport、EconomyState、Event、Round、MapGame、Summary、Jobs。
```

原因：

- LLM 调用耗时长，不适合放在数据库事务里。
- 数据库提交必须短事务，避免锁住本地 SQLite。
- Artifact 写入在事务前完成时，必须有失败清理和 pending 状态。

### 10.2 阶段 B 写入顺序

```text
1. upsert / update Round。
2. insert round_reports。
3. insert economy_states。
4. insert events。
5. update Round winnerTeamId / roundReportId / status。
6. update MapGame score / currentRoundNumber / status。
7. update Match status / score if needed。
8. insert / update summaries。
9. insert jobs for async broadcast / highlight / stats / news。
10. commit。
```

### 10.3 幂等键

为避免重复点击或恢复重试导致重复写入，建议定义幂等键：

```text
round_reports.roundId unique
rounds(mapGameId, roundNumber) unique
events.id stable
jobs.id stable
artifacts.id stable
```

对于可重试任务，任务 payload 应包含：

```text
tournamentId
matchId
mapGameId
roundId
idempotencyKey
```

## 11. 暂停、恢复与重放

### 11.1 恢复比赛

恢复比赛读取：

```text
Match.status
MapGame.status
Round.status
latest EconomyState per Agent
latest Summary per scope
Event Log
pending / failed Jobs
```

恢复规则：

- 如果 Round 是 completed，允许推进下一回合。
- 如果 Round 是 failed，允许重新运行该回合或人工修正。
- 如果 Job 是 failed，不阻塞比赛事实恢复。
- 如果 Artifact pending 超时，应标记 failed 并进入人工处理。

### 11.2 回放比赛

回放优先读取：

```text
timeline_events
```

如果 timeline_events 不存在或需要重建：

```text
Event Log -> Timeline Projection -> timeline_events
```

规则：

- TimelineEvent 不是事实源。
- TimelineEvent 可以清空后重建。
- 回放不应读取 RawOutput 正文，除非用户进入审计或复盘视图。

### 11.3 重放与复盘

复盘页面可以读取：

```text
RoundReport
Event
EconomyState
BroadcastItem
Highlight
Article
Artifact metadata
```

RawOutput 默认保存，但默认不展示，避免观赛页面被未提交内容污染。

## 12. 导出与导入

### 12.1 导出范围

必须支持：

```text
导出整届赛事
导出单场比赛
导出单张地图
导出单个回合
```

第一版必须优先支持整场比赛和整届赛事导出。

### 12.2 导出内容

导出 JSON 包含：

```text
tournaments
teams
agents
driver_models
matches
map_games
rounds
round_reports
economy_states
events
timeline_events
summaries
highlights
broadcast_items
articles
awards
artifacts metadata
llm_calls metadata
jobs metadata
```

Artifact 文件可以有两种策略：

```text
metadata_only:
只导出 artifact 元数据和相对路径。

bundle:
导出 JSON，同时复制 artifact 文件到 exports bundle 目录。
```

第一版建议支持 `metadata_only`，同时为 `bundle` 预留字段。

### 12.3 导出目录

```text
data/
  exports/
    tournaments/
      <tournamentId>.json
    matches/
      <matchId>.json
```

### 12.4 导入边界

第一版可以只定义导入格式，不一定实现完整导入。

导入时必须处理：

- ID 冲突。
- Artifact 路径是否存在。
- schemaVersion 是否兼容。
- 是否导入 llm_calls 和 debug logs。

## 13. Repository 接口

工程实现中，核心业务不应直接操作 SQLite。建议定义仓储接口：

```text
TournamentRepository
TeamRepository
AgentRepository
DriverModelRepository
MatchRepository
MapGameRepository
RoundRepository
RoundReportRepository
EconomyRepository
EventRepository
TimelineRepository
SummaryRepository
BroadcastRepository
ArticleRepository
AwardRepository
ArtifactRepository
LlmCallRepository
JobRepository
AdminAuditRepository
```

接口原则：

- Repository 返回结构化对象，不返回未解析 JSON 字符串。
- Repository 负责 JSON parse / stringify。
- 业务层不拼 SQL。
- 后期 SQLite 实现可以替换为 Postgres 实现。

## 14. 本地 Job Queue 持久化

第一版本地队列可以是 SQLite backed queue。

任务生命周期：

```text
pending
running
completed
failed
cancelled
```

规则：

- 同步比赛事实不依赖异步转播任务成功。
- 转播、弹幕、高光、新闻、奖项可以失败后重试。
- jobs 表必须记录 attempts、maxAttempts、errorJson。
- 应支持人工重新入队。

## 15. SQLite 到 Postgres 迁移预留

### 15.1 保持字段类型简单

SQLite 第一版使用：

```text
text
integer
real
```

JSON 暂存为 text，后期 Postgres 可迁移为 `jsonb`。

### 15.2 保持接口稳定

后期迁移时替换：

```text
SQLiteRepository -> PostgresRepository
LocalArtifactStore -> ObjectArtifactStore
SQLiteJobQueue -> BullMQJobQueue
```

不应改变：

```text
Core Engine
RoundReport contract
Event taxonomy
Simulation flow
```

### 15.3 Artifact URI 抽象

本地：

```text
data/tournaments/<tournamentId>/artifacts/raw-output/<artifactId>.md
```

Web：

```text
s3://bucket/tournaments/<tournamentId>/artifacts/raw-output/<artifactId>.md
```

业务层只读取 `Artifact.uri`，不关心底层存储。

## 16. 最小实现顺序

P1.5 进入工程实现时，建议顺序：

```text
1. 建立 data/ 目录和 SQLite 文件位置。
2. 定义 schema migration。
3. 实现 EventRepository。
4. 实现 ArtifactRepository 和 LocalArtifactStore。
5. 实现 RoundReportRepository / EconomyRepository。
6. 实现 Match / MapGame / Round 仓储。
7. 实现 JobRepository。
8. 实现导出 JSON。
9. 用 fake provider 跑一场 BO3 并验证可恢复。
```

## 17. MVP 验收标准

完成 P1.5 后，应该满足：

- 数据库和产物文件都保存在 `AgentsMajor/data/`。
- RawOutput、原始 LLM 响应、SubmittedOutput 引用可追溯。
- Event Log 可以完整恢复一场比赛事实。
- RoundReport、EconomyState、Event、Artifact 能在一次回合推进后保持一致。
- 解说、弹幕、新闻、回放卡等包装内容全文入库。
- 系统重启后可以找到当前 Match、MapGame、Round、EconomyState 并继续推进。
- 可以导出一场比赛或一届赛事的 JSON。
- TimelineEvent 可以从 Event 重建，不被当作比赛事实。
- 真实 API token / 成本只写入 llm_calls，不进入比赛经济。
- 后期迁移 Postgres / 对象存储时，不需要重写核心比赛引擎。

## 18. 待确认问题

当前没有阻塞 P1.5 的问题。

后续工程实现前可以再确认：

- 是否需要导出 bundle 模式同时复制 Artifact 文件。
- 是否需要提供一键清理 RawOutput 的管理功能。
- 是否需要给每个赛事生成独立 SQLite 文件，而不是单个全局 `agent-major.sqlite`。
