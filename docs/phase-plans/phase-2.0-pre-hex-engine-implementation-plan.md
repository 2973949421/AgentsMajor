# Phase 2.0-pre HexGrid 回合引擎实施计划

## 0. 文档定位

本文档是 Phase 2.0-pre 在旧 Node/Sector（节点/区块）实验路线之后的 HexGrid（蜂巢格）主线实施计划。

当前主线已经完成到 N30：

- N20-N24：路线重置、蜂巢地图结构、编辑器、Dust2 正式资产、pathfinding（寻路）与 AP（行动点）。
- N25-N29：agent phase memory（智能体阶段记忆）、agent command harness（智能体命令骨架）、combat resolver（战斗裁定器）、economy context（经济上下文）、Hex 单回合提交。
- N30：Dust2 完整地图 CLI（命令行）灰度，能够连续调用 N29 单回合提交器，把一张 active Dust2 mapGame（地图局）跑到 completed（完成）。

本次文档修订的核心变化：

- 不再把 N31 定义为“旧 Node/Sector 删除收口”。
- 不马上做旧 Node/Sector 删除。
- 不马上只做结构封板。
- 下一步优先让用户能在 Web（网页）里人工验收完整 Hex 对局。
- 旧 Node/Sector 删除推迟到 Hex Web 验收和真实 LLM（大语言模型）Web 稳定验收之后。

新的后续顺序为：

1. N31：Hex Web 验收台第一版。
2. N32：Hex 结构封板。
3. N33：真实 LLM Web 稳定验收。
4. N34：旧 Node/Sector 删除收口。

## 1. 当前阶段事实

仓库事实：

- `packages/core/src/hex-engine/` 已成为新主线 runtime（运行时）目录。
- Hex 主线模块已分为：
  - `map`
  - `path`
  - `state`
  - `action`
  - `combat`
  - `economy`
  - `win-condition`
  - `round`
  - `commit`
  - `map-runner`
- `architecture-boundary.test（架构边界测试）` 已阻止 Hex 主线引用旧 `node-engine（节点引擎）`、`node-graph.json（节点图资产）`、`sector-map.json（区块图资产）`。
- `dust2-hex-map.json` 是 N24+ 默认 official Hex map asset（正式蜂巢地图资产）。
- `phase20_hex_round_experimental` 已支持单回合提交。
- `phase20_hex_map_experimental` 已支持 CLI 完整地图灰度。

旧路线处理事实：

- 旧 Node/Sector 文档已经冻结，不再作为 N20+ 主线依据。
- 旧 `node-engine/` runtime 仍存在，但不得继续扩展为主线。
- 旧 Node Lab 不得继续作为 Hex 主控入口。
- 旧 node/sector 资产可以暂时保留为历史对照，但不能作为 Hex runtime 输入。

## 2. 总目标

长期目标不是只跑通 CLI，而是形成可以人工验收、真实 LLM 可审计、结构清晰、旧实验层可删除的 HexGrid 比赛引擎。

目标状态：

- 地图空间来自 HexGrid，而不是旧 node graph。
- 用户能通过 Web 编辑和审计地图。
- 用户能通过 Web 启动 Hex 单回合和 Hex 当前地图。
- 用户能通过 Web 查看完整地图级 summary、每回合 trace、每 phase 行动、combat、economy、hard win condition。
- 真实 LLM 模式下，每个 agent 每个 phase 的 request / response / accepted / rejected / fallback 都可审计。
- 代码负责硬约束：
  - 可走区域
  - 路径
  - AP
  - 经济资源
  - 生命状态
  - C4 状态
  - combat 局部裁定
  - final winner（最终胜方）
- LLM 只输出行动草案和解释，不写 winner、击杀、经济变化或 DB fact（数据库事实）。
- Hex Web 验收成熟后，再做结构封板和旧 Node/Sector 删除。

## 3. 已完成阶段

| 阶段 | 名称 | 状态 | 当前证据 |
|---|---|---|---|
| N20 | 路线重置与文档封板 | 已完成 | reset/freeze docs |
| N21 | HexGrid Schema（蜂巢格结构） | 已完成 | schema / validator / boundary tests |
| N22 | HexMapEditor（蜂巢地图编辑器） | 已完成第一版 | `/hex-lab/editor`、draft/official 读写 |
| N23 | Dust2 Hex Asset（Dust2 蜂巢地图资产） | 已完成 | `dust2-hex-map.json` |
| N24 | Hex Pathfinding + AP（寻路与行动点） | 已完成 | path/AP tests |
| N25 | Agent Phase Memory（智能体阶段记忆） | 已完成 | state tests |
| N26 | Agent 每 phase Command Harness（命令骨架） | 已完成 | action tests |
| N27 | Hex Combat Harness（战斗裁定骨架） | 已完成 | combat tests |
| N28 | Economy 接入 Hex Round（经济接入） | 已完成 | economy/action/combat tests |
| N29 | Hex Round Commit（单回合提交） | 已完成 | committer / trace / RoundReport / CLI |
| N30 | Hex Dust2 Map（完整地图 CLI 灰度） | 已完成 | map-runner / CLI smoke |

## 4. 新后续阶段表

| 阶段 | 名称 | 目标 | 结果判定 |
|---|---|---|---|
| N31 | Hex Web 验收台第一版 | 让用户能在 Web 里启动和查看 Hex 单回合 / 当前地图 | `/hex-lab/match` 可跑、可看、可审计 |
| N32 | Hex 结构封板 | 拆大文件、整理模块边界、修文档乱码、准备长期维护 | 结构更清晰，行为不变，回归通过 |
| N33 | 真实 LLM Web 稳定验收 | Web 上稳定接入 real provider，并展示完整 LLM 调用审计 | real 模式可见 request/response/fallback/rejected/accepted |
| N34 | 旧 Node/Sector 删除收口 | 删除旧 Node/Sector 主控入口、runtime 依赖和旧资产污染 | Hex 主线独立，旧实验层不再干扰检索和计划 |

## 5. N31：Hex Web 验收台第一版

### 5.1 目标

N31 解决“用户无法从 Web 人工验收完整 Hex 对局”的问题。

N30 已经能通过 CLI 跑完整 Dust2 map，但这不等于产品可验收。用户需要在 Web 里看到：

- 当前 mapGame 状态。
- 一键跑 Hex 单回合。
- 一键跑 Hex 当前地图。
- 已生成 map summary artifact。
- 每回合 trace artifact。
- 每个 phase 的 agent action。
- combat contacts / resolutions。
- economy context。
- final hard win condition。
- fallback / rejected / ignored fields。

### 5.2 新页面

新增页面建议：

```text
/hex-lab/match
```

页面定位：

- Hex 专用验收台。
- 不混旧 Node Lab。
- 不复用旧 Phase18 主控制台语义。
- 不接旧“一直生成”。
- 不跑 BO3。

### 5.3 控制区

第一版按钮：

- `运行 Hex 单回合`
- `运行 Hex 当前地图`
- `刷新当前 Hex 结果`
- `打开 Hex 地图编辑器`

第一版参数：

- provider mode（供应器模式）：
  - `fixture（夹具）`
  - `real（真实）`：可以显示但 N31 不以真实稳定为成功标准；N33 专项处理。
- maxRounds（最大回合数），默认 40，最大 60。
- maxLlmCallsPerPhase（每阶段最大 LLM 调用数），默认 10。
- mapGameId（地图局 ID），默认读取当前 active Dust2。

硬规则：

- `运行 Hex 当前地图` 调用 N30 `runDust2HexMapExperimental()`。
- `运行 Hex 单回合` 调用 N29 `commitDust2HexRoundExperimental()`。
- Web 不重新实现 runner、winner、combat、economy 或 RoundReport。

### 5.4 展示区

地图级展示：

- mode：`phase20_hex_map_experimental`
- mapGameId
- status
- initialScore / finalScore
- roundsCommitted
- completionReason
- summaryArtifactId
- writesDb=true
- replacesLegacyRoundPath=false

回合级展示：

- roundNumber
- roundId
- reportId
- winnerTeamId
- roundWinType
- scoreAfterRound
- hexTraceArtifactId
- fallbackCount
- combatResolutionCount
- finalWinCondition.reason

phase 级展示：

- phaseId
- phaseIndex
- accepted actions
- rejected actions
- fallback actions
- memory before / after 摘要
- combat contacts
- combat resolutions
- AP spent
- C4 状态

agent action 展示：

- agentId
- teamId
- side
- currentCell / targetCell
- actionType
- AP cost
- businessIntent
- validation result
- fallback reason
- ignored fields

combat 展示：

- contactId
- participants
- business evidence
- CS evidence
- score
- casualties / wounded / suppression / forcedBack
- memory events
- variance audit（若启用）

economy 展示：

- team economy posture
- agent buyType
- loadoutPackage
- outputBudget
- resourceTier
- utilityTier
- dropSent / dropReceived
- economyAllowedActionTypes
- economyConstraints

### 5.5 API

建议新增：

```text
POST /api/hex-lab/match/run
GET  /api/hex-lab/match/progress?mapGameId=...
GET  /api/hex-lab/match/artifact?artifactId=...
```

POST body：

```ts
{
  scope: "round" | "map",
  providerMode: "fixture" | "real",
  maxRounds?: number,
  maxLlmCallsPerPhase?: number,
  mapGameId?: string
}
```

GET progress 返回：

- current mapGame。
- latest hex map summary artifact。
- latest hex round trace artifacts。
- round reports。
- events。
- latest error。

### 5.6 成功标准

N31 完成后必须满足：

- `/hex-lab/match` 可打开。
- Web 能触发 Hex 单回合。
- Web 能触发 Hex 当前地图。
- Web 能读取 N30 CLI 生成的 map summary。
- Web 能展示每回合 trace 列表。
- Web 能展开每回合 phase/action/combat/economy/hard win condition。
- Web 明确标注：
  - experimental（实验）
  - writesDb=true
  - replacesLegacyRoundPath=false
  - LLM cannot write final winner（LLM 不能写最终胜负）
- 旧 Phase18 页面不混入 Hex 主控按钮。
- 旧 Node Lab 不作为 Hex 验收入口。

### 5.7 不做

- 不做结构封板。
- 不删除旧 Node/Sector。
- 不把 real provider 作为必须稳定验收。
- 不做 BO3。
- 不做完整观赛美术。
- 不调 combat/economy/AP/winner。

### 5.8 第一版落地文件

N31 第一版 Web 验收台落地在：

```text
apps/web/app/hex-lab/match/page.tsx
apps/web/app/hex-lab/match/hex-match-lab-client.tsx
apps/web/app/hex-lab/match/hex-match-lab.module.css
apps/web/app/server-hex-match-lab.ts
apps/web/app/api/hex-lab/match/run/route.ts
apps/web/app/api/hex-lab/match/progress/route.ts
apps/web/tests/hex-match-lab.test.ts
```

实现口径：

- `server-hex-match-lab.ts` 是 Web 专用适配层，负责读取 SQLite、artifact、N29 committer 和 N30 map runner。
- `POST /api/hex-lab/match/run` 只负责触发 Hex 单回合或当前地图，不重新实现 winner、combat、economy 或 RoundReport。
- `GET /api/hex-lab/match/progress` 读取最新 Dust2 mapGame、`hex_map_summary` 和 `hex_round_trace`，并输出轻量 Web 展示模型。
- `/hex-lab/match` 只展示 Hex trace 已有事实，不伪造 HP、枪械、伤害、投掷物、敌人真实位置或最终 winner。
- 首页可以提供 `/hex-lab/match` 与 `/hex-lab/editor` 入口，但旧 Phase18 replay 主屏不承担 Hex 主控职责。

N31 验收口径：

- 打开 `/hex-lab/match`，能看到 experimental、writesDb、replacesLegacyRoundPath 和 LLM 不能写最终胜负的硬边界。
- 点击“刷新最新结果”，能读取 N30 CLI 生成的完整地图 summary。
- 点击“跑 Hex 单回合”，只提交一个 Hex round。
- 点击“跑 Hex 当前 Dust2 地图”，调用 N30 薄地图 runner。
- 选中 round 后能看到 phase/action/combat/economy/hard condition。

## 6. N32：Hex 结构封板

### 6.1 目标

N32 在用户能 Web 验收完整对局之后进行。目标是让结构适合继续长期开发，避免快速实验债务继续膨胀。

### 6.2 重点拆分

优先拆：

- `hex-phase-memory.ts`
  - `hex-memory-types.ts`
  - `hex-memory-events.ts`
  - `hex-enemy-intel.ts`
  - `hex-bomb-state.ts`
- `hex-combat-resolver.ts`
  - `hex-business-evidence.ts`
  - `hex-cs-evidence.ts`
  - `hex-combat-variance.ts`
  - `hex-casualty-materializer.ts`
- `hex-round-runner.ts`
  - provider resolution
  - phase loop
  - initial placement
  - action-to-memory-events

审查但不必一次拆：

- `hex-agent-command-harness.ts`
- `hex-economy-context.ts`
- `hex-round-report-bridge.ts`

### 6.3 文档与命名债

N32 处理：

- 修复 Hex 文档乱码。
- 整理 `hex-engine/index.ts` export surface（导出面）。
- 审查 `nodeTraceArtifactId/nodeTraceSource` 兼容命名债，决定是否规划单独 migration（迁移）。
- 明确哪些旧 Node/Sector 文件仍只是历史存在，哪些仍被引用。

### 6.4 成功标准

- 行为不变，测试全过。
- 大文件明显缩小。
- Hex 主线模块职责更单一。
- architecture boundary 继续通过。
- 不新增功能。
- 不调比赛规则。

## 7. N33：真实 LLM Web 稳定验收

### 7.1 目标

N33 专门解决 Web 上 real provider（真实供应器）的稳定验收问题。

N31 允许 Web 选择 real，但不把真实稳定作为成功标准。N33 才正式要求：

- Web 能稳定发起真实 LLM Hex 单回合。
- Web 能稳定发起真实 LLM Hex 小上限地图。
- 每个 agent 每个 phase 的调用过程可见。
- provider error（供应器错误）不崩页面。
- fallback 可见。
- rejected draft 可见。
- accepted draft 可追溯。

### 7.2 展示要求

LLM 调用展示必须包含：

- providerMode
- modelId
- agentId
- phaseId
- requestArtifactId
- responseArtifactId
- prompt / compact context 摘要
- raw response 摘要
- JSON parse result
- ignored fields
- validation errors
- fallback reason
- accepted action
- latency / token usage（若可获得）

### 7.3 成功标准

- real 单回合可以从 Web 启动并完成或明确 external blocked。
- real 地图可以用 `maxRounds=4-8` 小上限验收。
- LLM 不能写 winner、kills、economyDelta、DB fact。
- 所有 provider failure 都进入审计，不包装成成功。
- fixture 与 real 的输出路径一致，只是 provider 不同。

### 7.4 不做

- 不做旧 Node/Sector 删除。
- 不改核心胜负。
- 不调经济参数。
- 不为追求“好看比分”硬改 combat。

## 8. N34：旧 Node/Sector 删除收口

### 8.1 前置条件

只有在以下条件满足后才能进入 N34：

- N31 Web 验收台能人工查看完整 Hex 对局。
- N32 结构封板完成。
- N33 真实 LLM Web 稳定验收完成或明确外部 provider 受限但路径可审计。

### 8.2 删除目标

删除或彻底降级：

- 旧 Node Lab 主控入口。
- 旧 sector UI 主控。
- 旧 `node-graph.json` runtime 依赖。
- 旧 `sector-map.json` runtime 依赖。
- `node-engine` 中不再被任何保留路径引用的 action / judge / graph / sector 模块。
- 旧 Dust2 node/sector 资产在 runtime 中的读取入口。

保留可能性：

- 历史 frozen 文档。
- 历史已生成 artifact 的读取兼容。
- 旧 RoundReport 读取兼容。

### 8.3 成功标准

- Hex 主线不再被旧 Node/Sector 文件污染检索。
- 旧 Phase18 正式链路若仍需要保留，则与 Hex 明确隔离。
- 旧历史报告仍可读取。
- architecture boundary 继续通过。
- Web 主入口只展示 Hex 验收台和旧正式比赛入口，不再混杂旧 Node 实验按钮。

## 9. 删除策略修订

旧策略“Hex 单图跑通后立即删除旧 Node/Sector”已废止。

新策略：

- N20-N30：冻结旧 Node/Sector，不新增功能。
- N31：优先做 Hex Web 验收台，不删除旧实验层。
- N32：做结构封板和文档清理，准备删除清单。
- N33：完成真实 LLM Web 稳定验收。
- N34：再删除旧 Node/Sector。

原因：

- CLI 跑通不等于用户能人工验收。
- 没有 Web 验收台就删除旧入口，会让用户短期失去可观察性。
- 先结构封板再真实 Web LLM，可以降低 N34 删除风险。

## 10. 验收总原则

后续每个 N 都必须满足：

- 目标明确。
- 成功标准明确。
- 范围边界明确。
- 不混旧 Node/Sector 主线。
- 不让 LLM 写硬事实。
- 测试和人工验收路径明确。
- 失败必须写“部分完成”或“未完成”，不能包装成完成。

## 11. 下一步

下一步应进入：

```text
N31：Hex Web 验收台第一版
```

N31 计划必须单独生成，且必须严格包含：

- 当前阶段定位。
- 目标与成功标准。
- 范围边界。
- 技术实现路径。
- API 与 UI 设计。
- 测试计划。
- 人工验收流程。
- 风险与回滚。
- 完成后阶段汇报表。
