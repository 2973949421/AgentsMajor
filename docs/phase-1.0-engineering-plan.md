# Phase 1.0 工程骨架计划

## 1. 阶段目标

Phase 1.0 的目标是把 AgentsMajor 从纯文档仓库推进到可安装、可类型检查、可测试、可初始化本地数据目录的 TypeScript monorepo 工程骨架。

本阶段只建立边界和契约，不实现真实比赛推进、不接真实 LLM、不做正式 UI 体验。所有业务生成逻辑留到 Phase 1.1 之后逐步接入。

## 2. 工程边界

本阶段包含：

- `pnpm` monorepo 基础结构。
- TypeScript 严格类型配置。
- `shared` 领域类型、枚举、Zod schema。
- `db` Drizzle + SQLite schema 草案和 Repository 接口。
- `llm` LLM 网关接口与 Fake Provider。
- `queue` 本地队列接口预留。
- `core` 比赛引擎接口和 Phase 1.0 空实现。
- `cli` 本地 `data/` 初始化命令。
- `web` Next.js 应用空壳。

本阶段不包含：

- 不跑真实比赛。
- 不调用真实 LLM。
- 不实现 Judge、Round Reporter、Event Builder 的业务逻辑。
- 不实现 Web 观赛 UI。
- 不把真实 API 成本写入比赛经济系统。

## 3. Monorepo 目录

```text
AgentsMajor/
  apps/
    web/                  Next.js Web 空壳
  packages/
    shared/               领域类型、枚举、Zod schema
    core/                 比赛引擎接口与 Phase 1.0 空实现
    db/                   Drizzle schema、SQLite 路径约定、Repository 接口
    llm/                  LlmGateway、FakeProvider、LLM 调用契约
    queue/                JobQueue 接口与 SQLite-backed queue 预留
    cli/                  data 初始化命令与 CLI 入口
  data/
    exports/              本地导出目录
    tournaments/          本地赛事数据目录
```

## 4. 技术路线

基础技术栈：

- 包管理：`pnpm`
- 语言：TypeScript
- 领域校验：Zod
- 数据库：SQLite
- ORM / migration：Drizzle
- 测试：Vitest
- 本地脚本执行：tsx
- Web 空壳：Next.js + React

Phase 1.0 的 LLM 层只使用 Fake Provider。真实 Provider SDK、模型路由、失败重试、限流、成本记录放到 Phase 1.5 或更晚阶段。

## 5. 契约落地

第一批稳定领域对象：

```text
Tournament
Team
Agent
DriverModel
Match
MapGame
Round
RoundReport
EconomyState
Event
TimelineEvent
Artifact
LlmCall
Job
```

关键约束：

- `Agent` 使用 `driverModelId`，不使用 `driver_model`。
- `Event` 是事实源，必须包含 `globalSequence`、`scopeType`、`scopeId`、`sequenceInScope`、`payload.schemaVersion`。
- `TimelineEvent` 是播放层事件，必须包含 `sourceEventIds`，不能替代事实源。
- `EconomyState` 是 Agent 级经济，必须包含 `agentId`，不保存真实 API 成本。

## 6. 数据路径

本地 SQLite 约定路径：

```text
data/agent-major.sqlite
```

本阶段只建立 schema 草案和 Repository 接口。Repository 可以暂时不接线，业务层不得绕过 Repository 接口直接散落数据库访问逻辑。

## 7. 根级脚本

```text
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm dev
pnpm data:init
```

验收重点：

- `pnpm typecheck` 覆盖所有 packages 和 Web 空壳。
- `pnpm test` 验证 schema、枚举、Fake Provider、data 初始化。
- `pnpm build` 确认 packages 可构建，Web 空壳可构建。
- `pnpm data:init` 可重复运行，不破坏已有目录。

## 8. Phase 1.1 入口条件

Phase 1.1 可以开始的条件：

- 工程可以完整安装、类型检查、测试和构建。
- `data/` 初始化命令可重复执行。
- `shared` 契约足以描述单回合 replay 的输入输出。
- `core` 已有 `playNextRound` 入口，但仍未实现业务行为。
- `llm` 已有 Fake Provider，可用于单回合 replay 的确定性测试。
- `db` 已有事件、战报、时间线、LLM 调用、任务队列相关表结构草案。

Phase 1.1 的首要目标应是单回合 replay：用 fake provider 生成确定性占位输出，写入结构化 `RoundReport`、`Event` 和 `TimelineEvent`，再由 Web 或 CLI 读取并播放。
