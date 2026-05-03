# Phase 1.7 Materials Runtime Integration + Role Contract Upgrade

## 1. Stage Position

Phase 1.7 的目标是把 `data/materials/processed` 稳定接入运行时，并把 materials 里的队伍、选手、角色和别名升级为工程事实源。

本阶段默认交付一场 canon BO3 showcase：

```text
Match: Falcon-7B vs VitaLLMty
Maps: DUST2 / INFERNO / MIRAGE
Mode: fake-only
```

Phase 1.7 不是 Phase 2 的完整 16 队 bracket，也不是真实 agent / judge LLM 接入阶段。materials 中的 future LLM binding 只作为资产引用保存，运行时统一 disabled。

## 2. Inputs

Phase 1.7 消费以下稳定输入：

```text
data/materials/processed
P0.1 domain schema
P1.3 LLM driver contract
P1.4 simulation engine
Phase 1.6 tactical protocol
P2.1 / P2.2 / P2.3 playback and broadcast contracts
```

`data/materials/processed` 必须提供：

```text
16 teams
5 active players per team
role index
alias index
style hooks
future LLM binding index
```

缺失队伍、缺失 active player、未知 primary role、未知 role tag、缺失 binding 或 `runtime_enabled !== false` 都必须 fail fast。

## 3. Role Contract

Phase 1.7 将 `Agent.role` 升级为 materials 主角色枚举：

```text
coach
igl
awper
entry
star_rifler
lurker
support
rifler
stand_in
```

`Agent.secondaryRoles` 用于保存副标签：

```text
anchor
flex
closer
system_architect
```

说明：

```text
star 和 closer 不再作为新写入的 primary role。
读取旧数据时 star 映射为 star_rifler。
读取旧数据时 closer 映射为 rifler。
closer 可以继续作为 secondary role tag 保留。
```

每个从 materials 导入的 Agent 必须保存：

```text
roleProfile:
  rawPosition
  confidence
  positionTags
  responsibilitySummary

materialRef:
  entityId
  entityType
  teamSlug
  jsonPath
  bindingVersion
  runtimeEnabled: false
```

## 4. Runtime Seeding

新增 Node-only package：

```text
@agent-major/materials
```

职责：

```text
只读取 data/materials/processed。
提供 loadProcessedMaterials。
提供 buildRuntimeTeamSeed。
提供 seedPhase17ShowcaseMatch。
不把 fs 逻辑放进 @agent-major/core 根导出，避免污染前端 bundle。
```

运行时 seeding 规则：

```text
创建 Phase 1.7 tournament。
创建 Falcon-7B vs VitaLLMty BO3 match。
导入两队 runtime Team。
导入 active players 和有效 coach。
所有 runtime Agent.driverModelId 使用 driver_fake_phase17。
future LLM binding 只写入 materialRef，不能影响胜负、战术或生成流程。
PhaseClan head_coach = null 时不导入 Coach TBD 作为运行时 coach agent。
```

## 5. Engine Behavior

Phase 1.7 后，active agent 排序必须按角色事实计算，不得依赖 agent id 命名：

```text
entry
star_rifler
awper
igl
rifler
lurker
support
stand_in
coach
```

MVP 候选优先级：

```text
star_rifler
awper
entry
igl
first active
```

Tactical protocol 必须通过 `Agent.role` 和 `secondaryRoles` 计算 attack / defense modifier，不再用 agent id 正则猜测角色。

## 6. Replay, Web, and Security

Replay 层需要提供安全的 `agentsById` 视图，允许前端展示：

```text
displayName
role
secondaryRoles
aliases
safe material identity
```

观众侧和公开导出不得暴露：

```text
API key
Authorization
driverModelId
modelName
llm_calls
future_driver_binding full JSON
raw materials full JSON
```

Web runner 新增 fake-only 模式：

```text
phase17_showcase_match
```

Phase 1.5 real LLM 单图模式保留为显式 legacy / debug 路径：

```text
phase15_single_map
```

## 7. CLI

新增命令：

```text
pnpm phase17:match
pnpm phase17:replay
pnpm phase17:export
```

默认参数：

```text
teamA = Falcon-7B
teamB = VitaLLMty
maps = DUST2, INFERNO, MIRAGE
```

CLI 可以显式传入 team slugs 和 map list，但仍必须维持 fake-only，不能启用 materials future LLM binding。

## 8. Non-goals

Phase 1.7 不做：

```text
不跑完整 16 队 bracket。
不启用真实 agent LLM。
不启用真实 judge LLM。
不让 materials LLM binding 影响胜负。
不让 materials LLM binding 影响战术协议。
不把 materials raw JSON 全量下发到 Web。
```

完整 16 队赛事留给 Phase 2.0。

## 9. Acceptance

最小验收：

```text
pnpm materials:validate
pnpm phase17:match
pnpm phase17:replay
pnpm phase17:export
pnpm typecheck
pnpm test
pnpm build
```

专项验收：

```text
materials loader 校验 16 队和每队 5 active players。
shared schema 接受所有 primary role。
legacy role normalization 覆盖 star -> star_rifler、closer -> rifler。
PhaseClan head_coach null 不导入运行时 coach。
unknown role fail fast。
Phase 1.6 tacticalContext 在新角色下仍生成。
Web replay/export 不暴露敏感模型字段或 future binding 全量内容。
phase13:*、phase15:*、phase16:* 保持兼容。
```

