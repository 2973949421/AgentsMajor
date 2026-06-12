# Agent Major 技术设计 v1

> 归档说明：本文是早期技术总览，用于保留项目初始架构判断和演进脉络；它不是当前工程实现的最终契约。后续实现以 `domain-schema.md`、`event-taxonomy.md`、`rules-format.md`、`round-report-contract.md`、`token-economy.md`、`llm-driver-contract.md`、`simulation-engine.md`、`local-persistence.md`、`live-timeline.md` 和 `p-phase-delivery-framework.md` 为准。

## 1. 项目定位

Agent Major 不是一个 IDEA 评分器，也不是实时多人 agent 直播系统。

它的核心定义是：

> 以 CS Major 为叙事外壳、以 AI agent 对抗为内容核心、以 token 经济为比赛机制、以伪直播回放为主要表现形式的 AI 电竞赛事系统。

第一版应优先采用：

```text
Simulation First, Broadcast Second
```

也就是先逐 round 批处理模拟比赛，生成结构化事实，再把这些事实包装成直播流、2D 战场、解说、弹幕、支持率、高光和赛后内容。

## 2. 设计目标

### 必须满足

- 本地优先：第一版可以在本机完整跑通赛事、存储数据、回放比赛。
- Web 预留：后续可以迁移到 Web，不重写核心比赛引擎。
- 事件驱动：所有比赛事实都写入本地 event log，模型不承担长期记忆。
- 伪直播：前端播放结构化事件时间轴，而不是依赖真实实时 agent 并发。
- 成本可控：每回合 LLM 调用、token 预算、并发数量都必须可估算、可降级。
- 内容可沉淀：比赛结果可以生成高光、战报、MVP、EVP、数据榜、新闻和回放。

### 暂不追求

- 真正实时 12 agent 并发对战。
- 3D 比赛直播。
- 复杂多人在线观赛。
- 真实赔率或赌博机制。
- 完整复刻真实 CS 队伍、选手、解说人格。

## 3. 推荐技术栈

### 第一阶段：本地版

```text
Language: TypeScript
App: Next.js
Database: SQLite
ORM: Drizzle ORM
Validation: Zod
Queue: 本地任务队列 / PQueue / Bottleneck
Realtime: SSE
LLM: Provider Gateway 抽象层
Storage: 本地文件系统 + SQLite event log
```

### 后期 Web 版

```text
App: Next.js
Database: Postgres
Queue: Redis + BullMQ
Worker: 独立 Node.js worker
Realtime: SSE 优先，WebSocket 可选
Object Storage: S3 / R2 / Vercel Blob 类对象存储
Deployment: Web app + worker + managed database + managed Redis
```

### 为什么这样选

- Next.js 可以同时承载本地 UI、API、后期 Web 页面。
- TypeScript 让前后端共享 schema、event 类型、LLM 输出类型。
- SQLite 适合本地快速落地，Postgres 适合后期 Web 扩展。
- Drizzle 可以降低 SQLite 到 Postgres 的迁移成本。
- SSE 足够支持伪直播事件流，比 WebSocket 简单。
- 队列从本地抽象开始，后期替换为 BullMQ，不影响比赛引擎。

## 4. 总体架构

```text
┌─────────────────────────────────────────────────────────┐
│                     Next.js Web UI                       │
│  Tournament / Match / 2D Live / Replay / Stats / News    │
└───────────────────────────┬─────────────────────────────┘
                            │ REST / SSE
┌───────────────────────────▼─────────────────────────────┐
│                        API Layer                         │
│  commands, queries, stream endpoints, admin operations    │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│                    Application Services                  │
│ TournamentService / MatchService / BroadcastService       │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│                       Core Engine                        │
│ Bracket / Match / Map / Round / Economy / Judge / Events  │
└───────────────┬─────────────────────────────┬───────────┘
                │                             │
┌───────────────▼──────────────┐   ┌──────────▼───────────┐
│          LLM Gateway          │   │      Queue Layer      │
│ provider, model, budget, zod  │   │ local queue / BullMQ  │
└───────────────┬──────────────┘   └──────────┬───────────┘
                │                             │
┌───────────────▼─────────────────────────────▼───────────┐
│                    Persistence Layer                     │
│ SQLite/Postgres tables + local/object artifacts + logs    │
└─────────────────────────────────────────────────────────┘
```

核心原则：`Core Engine` 不应该依赖 Next.js、SQLite、Redis 或具体 LLM 厂商。它只依赖接口。

## 5. 推荐目录结构

```text
AgentsMajor/
  apps/
    web/
      app/
      components/
      server/
  packages/
    core/
      tournament/
      match/
      map/
      round/
      economy/
      events/
      scoring/
    db/
      schema/
      repositories/
      migrations/
    llm/
      gateway/
      prompts/
      schemas/
    queue/
      local/
      bullmq/
    shared/
      types/
      constants/
      utils/
  docs/
    technical-design.md
```

如果第一版想更轻，也可以先做单应用结构：

```text
AgentsMajor/
  app/
  components/
  lib/
    core/
    db/
    llm/
    queue/
  docs/
```

但建议从一开始就把 `core`、`db`、`llm`、`queue` 分层清楚，否则后期 Web 化会痛。

## 6. 核心模块

### Tournament Engine

负责赛事生命周期：

- 创建赛事。
- 导入 16 支 ghost teams。
- 生成 16 队单败 bracket。
- 推进 16 强、8 强、4 强、决赛。
- 记录冠军、MVP、EVP、奖项。

### Match Engine

负责 BO3：

- 地图 veto。
- 地图顺序。
- 当前 series score。
- 地图胜负。
- 晋级淘汰。

### Map Engine

负责单张地图：

- MR6 规则。
- 先到 7 分胜。
- 6 回合换边。
- 加时规则。
- 当前地图 summary。
- 当前经济、士气、控制区、状态。

### Round Engine

负责单回合模拟：

- 选择 active agents。
- 读取当前比分、经济、短期上下文、地图 summary。
- 调用双方 agent action。
- 调用 judge。
- 构造 round report。
- 写入 event log。
- 更新 summary 和 economy。

### Economy Engine

负责 token 经济：

- 每个 Agent 的 token bank。
- buy type 判定。
- Agent 之间的 Drop。
- Output Gate 裁剪。
- income / loss bonus。
- force buy、save、drop、timeout。
- 根据经济决定 buy type、Output Gate、timeout 可用性和输出预算；不根据经济裁剪双方共同的公开输入。
- 不根据经济切换 `driverModelId`。`Agent` 是比赛角色，`LLM driver` 是执行引擎，两者通过调度层绑定，但不进入第一版经济平衡。

### Broadcast Engine

负责伪直播包装：

- kill feed。
- event feed。
- caster lines。
- barrage pool。
- support rate changes。
- replay cards。
- highlight labels。

Broadcast Engine 可以异步执行，不阻塞核心比赛推进。

### News / Awards Engine

负责外围生态：

- 赛前前瞻。
- 赛后战报。
- MVP / EVP。
- 今日五佳。
- 高光榜。
- 数据复盘。
- 支持率总结。

这部分第一版可以在比赛结束后后台生成。

## 7. 数据模型

### 主实体

```text
Tournament
Team
Agent
Match
MapGame
Round
Event
RoundReport
EconomySnapshot
BroadcastItem
Highlight
Article
Award
Summary
Artifact
```

### Tournament

```ts
type Tournament = {
  id: string;
  name: string;
  status: "draft" | "running" | "completed" | "archived";
  format: "single_elimination_16";
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  championTeamId?: string;
};
```

### Team

```ts
type Team = {
  id: string;
  tournamentId: string;
  displayName: string;
  shortName: string;
  seed: number;
  source?: {
    provider: "manual" | "hltv" | "valve";
    sourceName?: string;
    sourceUrl?: string;
    importedAt?: string;
  };
  dna: {
    aggression: number;
    structure: number;
    creativity: number;
    clutch: number;
    riskTolerance: number;
    commercialInstinct: number;
  };
};
```

### Agent

```ts
type Agent = {
  id: string;
  teamId: string;
  role:
    | "coach"
    | "igl"
    | "awper"
    | "entry"
    | "star_rifler"
    | "lurker"
    | "support"
    | "rifler"
    | "stand_in";
  secondaryRoles?: string[];
  roleProfile?: unknown;
  materialRef?: unknown;
  displayName: string;
  driverModelId: string;
  traits: string[];
  strengths: string[];
  weaknesses: string[];
  stats: {
    impact: number;
    discipline: number;
    creativity: number;
    clutch: number;
    tokenEfficiency: number;
  };
};
```

### Match

```ts
type Match = {
  id: string;
  tournamentId: string;
  roundName: "round_of_16" | "quarterfinal" | "semifinal" | "final";
  teamAId: string;
  teamBId: string;
  status: "scheduled" | "veto" | "running" | "completed";
  bestOf: 3;
  teamAMapsWon: number;
  teamBMapsWon: number;
  winnerTeamId?: string;
  scheduledOrder: number;
};
```

### MapGame

```ts
type MapGame = {
  id: string;
  matchId: string;
  mapName:
    | "DUST2"
    | "INFERNO"
    | "OVERPASS"
    | "MIRAGE"
    | "ANUBIS"
    | "NUKE"
    | "ANCIENT";
  order: number;
  status: "scheduled" | "running" | "completed";
  teamAScore: number;
  teamBScore: number;
  currentRoundNumber: number;
  winnerTeamId?: string;
  summaryId?: string;
};
```

### Event

Event 是系统事实源。所有前端直播、回放、战报、数据榜都应该从 event 派生。

```ts
type Event = {
  id: string;
  tournamentId: string;
  matchId?: string;
  mapGameId?: string;
  roundId?: string;
  globalSequence: number;
  scopeType: "tournament" | "match" | "map" | "round";
  scopeId: string;
  sequenceInScope: number;
  type:
    | "match_started"
    | "map_veto_completed"
    | "map_started"
    | "round_started"
    | "output_gate_applied"
    | "judge_decision_created"
    | "score_updated"
    | "economy_updated"
    | "round_report_created"
    | "round_completed"
    | "kill_feed_created"
    | "highlight_detected"
    | "caster_line_created"
    | "barrage_created"
    | "support_rate_updated"
    | "map_completed"
    | "match_completed"
    | "award_granted"
    | "article_generated";
  payload: unknown;
  timelineMs?: number;
  createdAt: string;
};
```

## 8. RoundReport 结构

RoundReport 不能只是自然语言。它必须是机器可消费结构，用于驱动 2D 地图、kill feed、解说、弹幕、支持率、经济变化和高光回放。

```ts
type RoundReport = {
  roundNumber: number;
  winnerTeamId: string;
  scoreAfterRound: {
    teamA: number;
    teamB: number;
  };
  buyType: {
    teamA: "full_buy" | "half_buy" | "eco" | "force_buy" | "save";
    teamB: "full_buy" | "half_buy" | "eco" | "force_buy" | "save";
  };
  activeAgents: {
    teamA: string[];
    teamB: string[];
  };
  keyEvents: Array<{
    type:
      | "entry"
      | "trade"
      | "clutch"
      | "economy_swing"
      | "conversion"
      | "highlight";
    actorAgentId: string;
    targetAgentId?: string;
    zoneId: string;
    impact: string;
  }>;
  economyDelta: {
    teamA: number;
    teamB: number;
  };
  tokenUsage: {
    teamA: number;
    teamB: number;
    judge: number;
    broadcast?: number;
  };
  highlightTags: string[];
  judgeReason: string;
  summary: string;
};
```

## 9. 单回合执行流程

### 同步关键路径

```text
1. Match Engine 读取当前 match / map / score / economy / summary。
2. Economy Engine 根据经济决定 buy type。
3. Round Engine 选择双方 active agents。
4. Context Builder 生成短上下文。
5. LLM Gateway 调用 Team A active agents。
6. LLM Gateway 调用 Team B active agents。
7. Judge Engine 调用 judge，判定胜负与关键原因。
8. Round Reporter 生成结构化 RoundReport。
9. Event Builder 写入核心 events。
10. Summary Engine 更新 map_summary / match_summary。
11. Economy Engine 更新 token bank。
12. Map Engine 判断地图是否结束。
```

### 异步非关键路径

```text
1. Caster Agent 生成官解。
2. Barrage Agent 生成弹幕池。
3. Highlight Agent 生成高光卡片。
4. Support Rate Agent 更新支持率。
5. News Agent 生成赛中快讯或赛后战报。
6. Awards Agent 更新 MVP race / EVP race。
```

同步路径保证比赛能推进。异步路径保证节目效果，但失败时可以重试或延后生成。

## 10. LLM 调用预算

### 推荐约束

```text
全局并发限制：2-5
单场比赛并发限制：1-3
单回合 LLM 调用：4-8 次
broadcast / news / replay：后台队列生成
```

### 单回合基础调用

```text
Team A action: 1-2 次
Team B action: 1-2 次
Judge: 1 次
RoundReport/EventBuilder: 1 次
Caster/Barrage/Highlight: 0-3 次，异步
```

### 降级策略

当触发限流、token 不足、失败重试过多时：

```text
1. active agents 从 3 个降到 2 个。
2. 读取完整历史改成读取 summary。
3. 高级模型改成低成本模型。
4. 解说、弹幕、高光延后生成。
5. 输出 token 上限降低。
6. Coach timeout 暂不可用。
7. Judge 保持优先级最高。
```

核心原则：

> agent 数量是角色设定，不是并发调用数量。

## 11. MR6 赛制与经济规则

### 地图规则

```text
每图最多 12 个常规 round
先到 7 分获胜
6 回合换边
6-6 进入加时
```

### MVP 阶段可选短赛制

```text
MR3
每图最多 6 个常规 round
先到 4 分获胜
3 回合换边
3-3 sudden death 或 BO3 overtime
```

### Token 经济建议

第一版经济系统以 Agent 为主体。团队经济只是队内 Agent `tokenBank` 的加总展示，不是购买主体。完整规则以 `docs/p1-match-loop/token-economy.md` 为准。

```text
agentTokenCap: 16000
initialTokenBank: 8000
Full Buy: >= 10000
Half Buy: 5000-9999
Eco: <5000
Force Buy: 低于 full buy 时主动花掉大部分或全部当前经济
Save: 只花极少预算，保留经济到后续回合
```

真实 LLM 调用完整生成 RawOutput；比赛内 Token 经济通过 Output Gate 裁剪 SubmittedOutput。Judge 只评价 SubmittedOutput 和裁判结算层经济状态，`driverModelId` 不因经济状态变化。

### Buy Type 对提交输出的影响

```text
Full Buy:
  submittedOutput: 80%-100%
  cutMode: multi_slice

Half Buy:
  submittedOutput: 40%-60%
  cutMode: core_window

Eco:
  submittedOutput: 15%-25%
  cutMode: random_window

Force Buy:
  submittedOutput: 按当前余额尽量多截
  cutMode: random_window 或 multi_slice_lite

Save:
  submittedOutput: 5%-10%
  cutMode: front_cut 或 random_window
```

## 12. 记忆与上下文

### 三层上下文

```text
Round 独立输入:
当前任务、地图目标、比分、经济、active agents、buy type。

短期上下文:
最近 2-3 个 round 的关键事件、战术变化、经济变化。

长期上下文:
map_summary、match_summary、双方风格、已暴露弱点、MVP race。
```

### 事实源与摘要源

```text
event_log:
完整事实源，不丢，不依赖模型记忆。

map_summary / match_summary:
压缩后的上下文燃料，供下一 round 使用。
```

模型下一轮不应该读取完整历史，而应该读取：

```text
- 当前比分
- 当前经济
- 当前地图目标
- 最近关键事件
- 已压缩 summary
- 对方暴露弱点
- 本队战术倾向
```

## 13. 伪直播前端

### Live 页面核心区域

```text
顶部:
赛事名 / BO3 比分 / 当前地图 / 当前 round / 双方队伍

中央:
2D 战术地图 / 区域控制 / agent 位置 / 动作轨迹 / 高光标记

左右:
双方队伍面板 / agent 状态 / rating / token 经济 / coach 状态

底部:
kill feed / event feed / 官解 / 弹幕 / 支持率
```

### 前端消费的数据

前端不需要知道 LLM 细节，只消费 timeline events：

```ts
type TimelineEvent = {
  id: string;
  atMs: number;
  kind:
    | "map_control"
    | "agent_move"
    | "kill_feed"
    | "score_update"
    | "economy_update"
    | "caster_line"
    | "barrage_burst"
    | "highlight_flash"
    | "support_rate_update";
  payload: unknown;
};
```

### 播放方式

```text
1. round 完成后生成 timeline events。
2. 前端按 atMs 播放 20-60 秒。
3. 用户感知为直播，系统本质是回放。
4. 用户可以暂停、快进、重播高光。
```

## 14. API 设计

本地版和 Web 版使用同一套 API 语义。

### Tournament

```text
POST /api/tournaments
GET  /api/tournaments
GET  /api/tournaments/:id
POST /api/tournaments/:id/start
```

### Teams

```text
POST /api/tournaments/:id/import-teams
GET  /api/tournaments/:id/teams
GET  /api/teams/:teamId
```

### Matches

```text
GET  /api/tournaments/:id/matches
GET  /api/matches/:matchId
POST /api/matches/:matchId/start
POST /api/matches/:matchId/veto
POST /api/matches/:matchId/play-next-round
```

### Live / Replay

```text
GET /api/matches/:matchId/events
GET /api/matches/:matchId/stream
GET /api/matches/:matchId/replay
GET /api/rounds/:roundId/report
```

### Stats / Content

```text
GET /api/tournaments/:id/stats
GET /api/tournaments/:id/highlights
GET /api/tournaments/:id/awards
GET /api/tournaments/:id/articles
```

### SSE stream

```text
GET /api/matches/:matchId/stream
```

事件格式：

```ts
type StreamMessage = {
  type: "event_created" | "round_completed" | "map_completed" | "match_completed";
  data: unknown;
};
```

## 15. Queue 设计

### 本地 Queue 接口

```ts
interface JobQueue {
  enqueue<TPayload>(job: {
    type: string;
    payload: TPayload;
    priority?: number;
    delayMs?: number;
  }): Promise<string>;

  process<TPayload>(
    type: string,
    handler: (payload: TPayload) => Promise<void>
  ): void;
}
```

### 推荐 job 类型

```text
simulate_round
generate_caster_lines
generate_barrage
detect_highlights
generate_replay_card
update_support_rate
generate_match_article
update_mvp_race
```

本地版可用内存队列。Web 版替换成 BullMQ，handler 不变。

## 16. LLM Gateway 设计

### 统一接口

```ts
interface LlmGateway {
  generateStructured<T>(request: {
    task: string;
    modelTier: "cheap" | "standard" | "strong";
    system: string;
    prompt: string;
    schemaName: string;
    maxOutputTokens: number;
    temperature?: number;
    budget: {
      maxInputTokens: number;
      maxOutputTokens: number;
      maxCostCents?: number;
    };
  }): Promise<{
    data: T;
    usage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      estimatedCostCents?: number;
    };
    rawText?: string;
  }>;
}
```

### 为什么必须结构化输出

- RoundReport 要驱动前端。
- Judge result 要更新比分。
- economy delta 要更新 token bank。
- highlight tags 要触发回放。
- support rate 要更新图表。
- 新闻和解说可以是文本，但来源必须是结构化事实。

## 17. 本地持久化策略

### SQLite 保存

```text
tournaments
teams
agents
matches
map_games
rounds
events
round_reports
economy_snapshots
summaries
highlights
broadcast_items
articles
awards
llm_calls
jobs
```

### 文件系统保存

```text
data/
  tournaments/
    <tournamentId>/
      exports/
      artifacts/
      logs/
```

适合保存：

- 原始 LLM 响应。
- 赛事导出 JSON。
- 高光卡片渲染结果。
- 新闻 markdown。
- 调试日志。

Web 版迁移时，把文件系统 artifact 替换成对象存储。

## 18. Web 迁移预留

从第一天开始保留这些抽象：

```text
StorageRepository
ArtifactStore
JobQueue
LlmGateway
RateLimiter
Clock
IdGenerator
EventPublisher
```

本地实现：

```text
SQLiteStorageRepository
LocalArtifactStore
InMemoryJobQueue
LocalRateLimiter
SseEventPublisher
```

Web 实现：

```text
PostgresStorageRepository
ObjectArtifactStore
BullMqJobQueue
RedisRateLimiter
SseOrWebSocketEventPublisher
```

只要 Core Engine 依赖接口，不依赖实现，后期 Web 迁移成本会低很多。

## 19. 安全与版权边界

第一版可以使用真实公开排名作为灵感来源，但公开产品应注意：

- 不直接使用真实队伍 logo。
- 不声称获得真实赛事、队伍、选手或解说授权。
- 不复刻真实选手人格。
- 不把真实解说语料做成拟真人格复制。
- 使用 ghost team / inspired roster / fictional caster desk。
- 支持率、预测率、爆冷指数不能设计成真实赌博或真钱押注。

推荐表述：

```text
Ghost teams inspired by public esports roster structures.
Fictional caster desk inspired by Chinese esports broadcast culture.
Support rate is an entertainment metric, not betting odds.
```

## 20. 开发阶段

### Phase 0：静态原型

目标：证明 2D Live 页面和赛事气质。

- 手写 2 支队伍。
- 手写 1 场 BO1 的 round events。
- 前端播放伪直播 timeline。
- 展示 kill feed、解说、弹幕、支持率。

### Phase 1：本地比赛引擎

目标：真实跑通一场 BO3。

- Match / Map / Round 状态机。
- MR3 或 MR6。
- SQLite event log。
- 本地 queue。
- LLM 生成 RoundReport。
- Judge 判定。

### Phase 2：16 队赛事

目标：跑完整 Agent Major。

- 16 队 bracket。
- BO3 单败。
- 地图 veto。
- token 经济。
- MVP / EVP 初版。
- 高光回放。

### Phase 3：赛事生态

目标：形成内容工厂。

- AM News。
- AM Stats。
- AM Replay。
- AM Pulse。
- 赛后节目台。
- 数据榜和奖项页。

### Phase 4：Web 化

目标：支持部署和多人访问。

- SQLite 迁移 Postgres。
- 本地 queue 迁移 BullMQ。
- worker 独立部署。
- artifact 迁移对象存储。
- 加入用户、权限、分享链接。

## 21. 第一版最小闭环

建议第一版只追求这个闭环：

```text
创建赛事
→ 创建 2 支 ghost teams
→ 开始一场 BO3
→ play next round
→ LLM 生成 RoundReport
→ Judge 判定
→ 写入 events
→ 前端播放伪直播
→ 地图结束
→ 比赛结束
→ 生成 MVP 和战报
```

这个闭环跑通后，再扩到 16 队。

## 22. 关键技术风险

### 结构化输出不稳定

应对：

- 所有 LLM 输出用 Zod 校验。
- 失败时自动 repair。
- repair 失败则降级为 fallback judge / fallback report。

### 长赛事内容重复

应对：

- 地图目标差异化。
- team DNA 影响 prompt。
- economy 影响上下文和策略。
- highlight detector 只奖励真正的变化。

### 成本失控

应对：

- 每回合预算预估。
- 全局 token cap。
- 每场 match cap。
- broadcast 异步和可跳过。
- cheap / standard / strong 模型分层。

### 本地到 Web 迁移困难

应对：

- Core Engine 不依赖 Next.js。
- Queue / Storage / LLM 全部接口化。
- SQLite schema 尽量贴近 Postgres。
- 业务状态通过 DB 和 event log 表达，不放内存。

## 23. 当前建议

Phase 1.8 / 1.9 已完成工程和 UI 收口，当前不要继续扩展真实 LLM pilot 或观赛界面细节；下一步先执行 Phase 2.0-pre 单图 / 定制 BO3 赛事语义校准，不要先做复杂新闻站。

P / Phase 的具体协作规则以 `docs/meta/p-phase-delivery-framework.md` 为准。P0-P4 是模块契约优先级，Phase 0-4 是工程交付阶段，二者互相勾稽但不一一对应。

当前推进状态是：P0 / P1 / P2.1 / P2.2 已冻结，P2.3 在 Phase 1 范围内可按 Frozen 执行，Phase 1.0 / 1.1 / 1.2 / 1.3 / 1.4 / 1.45 / 1.5 / 1.6 / 1.7 / 1.8 / 1.9 已完成。项目已经从“工程骨架和单回合 replay”推进到“BO3 match replay + 极简伪直播播放器 + 可消费的赛事语义事件 + 2D 战术地图消费契约 + 转播包装层 + 真实 caster_line 小范围接入 + deterministic tactical protocol + materials runtime integration + 本地真实 LLM BO3 pilot + Phase 1.8 only 观赛主屏”。下一步主线应先进入 Phase 2.0-pre 的单图 / 定制 BO3 赛事语义校准，而不是直接扩展到完整 16 队 bracket。

P2.1 之后的工作模式仍然是“代码主线，文档随行”：只有当实现会改变核心契约时，才先补文档再写代码。核心契约包括 EventType / payload、RoundReport、状态机、Token 经济、DriverModel 接口、SQLite 核心表和 Event -> TimelineEvent 投影。Repository 内部实现、fake provider 样例、CLI 输出、极简页面布局和测试 seed 不应阻塞代码推进。

当前后的实现顺序应更新为：

```text
已完成：建 TypeScript 项目骨架。
已完成：定义核心 domain types 和 Zod schemas。
已完成：建 SQLite schema。
已完成：实现 fake LLM provider。
已完成：单回合 replay。
已完成：单张地图 replay。
已完成：BO3 fake provider。
已完成：极简伪直播播放器基础版消费 timeline events。
已完成：收口 RoundReport / TimelineEvent / keyRounds / highlight 的赛事可信度。
已完成：P2.2 2D 战术地图说明。
已完成：P2.3 转播系统说明。
已完成：Phase 1.5 真实 LLM 小范围接入，真实 provider 只替换 caster_line。
已完成：Phase 1.6 区域化攻防回合协议已收口。
已完成：Phase 1.7 materials runtime integration 与角色契约升级。
已完成：Phase 1.8 本地真实 LLM BO3 pilot，暂时冻结。
已完成：Phase 1.9 Phase18 观赛主屏 / 调试控制台，暂时冻结。
当前：Phase 2.0-pre 单图 / 定制 BO3 赛事语义校准。
```

先用 fake provider 是关键，它能让 UI、状态机、数据库、回放全部先跑起来，不被 LLM 成本和不稳定性拖住。
