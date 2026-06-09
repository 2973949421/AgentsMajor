# Phase 2.0-pre HexGrid 回合引擎实施计划

## 0. 文档定位

本文档是 Phase 2.0-pre 在旧 Node/Sector（节点/区块）实验路线冻结后的 HexGrid（蜂巢格）主线实施计划。

当前主线判断：

- HexGrid 是后续比赛空间的底层事实。
- Region（区域）、Point（点位）、Flag（标记）都从 Hex map asset（蜂巢地图资产）产生。
- LLM（大语言模型）只输出 agent action draft（智能体行动草案）。
- 代码负责地图、路径、AP（行动点数）、经济、生命状态、C4 状态、combat（战斗裁定）和 final winner（最终胜负）。
- 旧 Node/Sector 不再扩展，但在 Hex Web 可验收、真实 LLM 路径可审计之前，不急于删除。

本文档的当前重点是 N31 收口补丁：把 `/hex-lab/match` 从数据调试页重做为可人工验收完整对局的 Hex Match Lab（蜂巢比赛验收台）。

## 1. 已完成阶段

| 阶段 | 名称 | 当前状态 | 证据 |
|---|---|---|---|
| N20 | 路线重置与文档封板 | 完成 | HexGrid reset / freeze 文档 |
| N21 | HexGrid Schema（蜂巢格结构） | 完成 | schema / validator / architecture boundary tests |
| N22 | HexMapEditor（蜂巢地图编辑器） | 完成第一版 | `/hex-lab/editor`，三层 level，verticalLinks |
| N23 | Dust2 Hex Asset（Dust2 蜂巢地图资产） | 完成 | `dust2-hex-map.json` |
| N24 | Hex Pathfinding + AP（寻路与行动点） | 完成 | path/AP tests |
| N25 | Agent Phase Memory（智能体阶段记忆） | 完成 | state tests |
| N26 | Agent Command Harness（智能体命令骨架） | 完成 | action tests |
| N27 | Hex Combat Harness（蜂巢战斗裁定骨架） | 完成 | combat tests |
| N28 | Economy 接入 Hex Round（经济接入） | 完成 | economy/action/combat tests |
| N29 | Hex Round Commit（蜂巢单回合提交） | 完成并收口 | committer / trace / RoundReport / CLI |
| N30 | Hex Dust2 Map（完整地图灰度） | 完成 | map runner / CLI |
| N31 | Hex Web 验收台 | 第一版完成，正在收口重做 | `/hex-lab/match` |

## 2. 最新阶段路线

后续顺序固定为：

1. N31：Hex Web 验收台重做版。
2. N32：Hex 结构封板。
3. N33：真实 LLM Web 稳定验收。
4. N34：旧 Node/Sector 删除收口。

这里的顺序很重要：先让用户能在 Web 人工看懂完整对局，再做结构拆分；先让真实 LLM 调用在 Web 可审计，再删除旧实验层。

## 3. N31 收口补丁：Hex Web 验收台重做版

### 3.1 目标

N31 收口补丁的目标是把 `/hex-lab/match` 从“数据表格调试页”重做成“比赛验收台”。

完成后，用户应能在 Web 内完成以下验收：

- 新建或安全重置一场 Hex Dust2 验收地图。
- 跑下一回合。
- 用客户端可停止的方式一直跑到地图结束。
- 选择历史 active/completed mapGame。
- 在地图上看到 Dust2 Hex 格、区域、点位、标记、选手位置、C4、交火、lastSeen（最后目击）和 action path/AP 预览。
- 通过 round/phase 时间轴回放每阶段状态。
- 看到 10 个 player card（选手卡）。
- 看到 LLM audit、combat audit、economy audit 和 hard winner audit。
- 清楚看到：LLM 不能写最终 winner，前端也不重新计算 winner。

### 3.2 页面布局

N31 重做版采用五区布局：

| 区域 | 职责 |
|---|---|
| 顶部比赛状态栏 | mapGameId、比分、回合数、状态、provider、硬边界提示 |
| 左侧控制台 | 新建、重置、跑下一回合、一直跑、停止、刷新、选择历史比赛、打开编辑器 |
| 中间地图主视图 | Dust2 Hex 地图、level 切换、图层开关、agent/C4/combat/path 标记 |
| 底部时间轴 | round 进度条 + phase 回放条 |
| 右侧审计区 | 选手卡、LLM/Combat/Economy/Hard Winner 详情抽屉入口 |

页面第一屏必须优先显示地图和选手状态，而不是纯表格。

### 3.3 运行控制语义

控制按钮语义固定如下：

- 新建 Hex 验收比赛：基于现有 Dust2 match/mapGame 创建新的实验 mapGame，不删除历史数据。
- 安全重置为新地图：第一版不破坏性清理旧 map，而是创建同源新 mapGame。
- 跑下一回合：调用 N29 `commitDust2HexRoundExperimental()`。
- 一直跑到地图结束：客户端逐回合调用“跑下一回合”，每回合后刷新 progress，用户可停止。
- 停止：只停止下一次回合调用；已经进入提交中的当前回合由 N29 自己完成事务。
- 快速跑当前地图：调用 N30 `runDust2HexMapExperimental()`，作为高级按钮，不作为主控验收路径。
- 下一 phase：只做回放选中 round 内的下一 phase，不提交半个 phase。

completed map 上不得直接把英文异常甩给用户。必须显示中文解释：

- 当前地图已完成，不能继续提交回合。
- 可以新建 Hex 验收比赛、选择 active mapGame，或安全重置为新地图。
- 不会影响旧 Phase18。
- 原始错误进入 technical details 折叠区。

### 3.4 Web API

N31 使用独立 Hex Match Lab API，不混旧 Node Lab：

```text
POST /api/hex-lab/match/run
GET  /api/hex-lab/match/progress
GET  /api/hex-lab/match/maps
POST /api/hex-lab/match/create
POST /api/hex-lab/match/reset
```

API 规则：

- `run` 的 `scope=round` 调 N29。
- `run` 的 `scope=map` 调 N30。
- `maps` 返回 active/completed Dust2 mapGame 列表。
- `create` 创建新的 Hex 验收 mapGame。
- `reset` 第一版执行安全 reset，即创建同源新 mapGame，不删除旧数据。
- 所有 API 都必须经过 Web runner access policy。
- API 不重新实现 winner、combat、economy 或 AP。

### 3.5 服务端展示模型

`server-hex-match-lab.ts` 是 Web 专用 projection（投影）层。

它负责：

- 读取 SQLite repositories。
- 读取 local artifact store。
- 调用 N29/N30 core。
- 读取 `hex_map_summary` artifact。
- 读取 `hex_round_trace` artifact。
- 从 official Dust2 Hex asset 构造只读地图视图。
- 把 trace 转换成 Web 需要的轻量结构。

它不负责：

- 重新计算 winner。
- 重新裁定 combat。
- 重新计算 AP/path。
- 伪造 HP、枪械、伤害、投掷物落点或敌人真实位置。

### 3.6 地图主视图

地图主视图使用 official `dust2-hex-map.json`。

必须展示：

- playable cell（可比赛格）。
- region（区域）。
- point（点位）。
- flag（标记）：`spawn_t / spawn_ct / bombsite_a / bombsite_b / cover / choke / high_risk / route_hint`。
- agent 当前 cell/level。
- C4 携带者或下包格。
- lastSeen 历史标记。
- combat contact/resolution。
- 当前 action path 和 AP 预览。

限制：

- 不渲染 2500 个空格，只渲染 official asset 中 playable cells。
- 不重新计算路径。
- 不把 lastSeen 当成当前敌人真实位置。
- 不做地图编辑；编辑仍在 `/hex-lab/editor`。

### 3.7 选手卡

右侧必须有 10 个 player card。

每个选手卡展示：

- team / side / agentId 或 display name。
- alive / wounded / dead。
- 当前 region / point / cell / level。
- AP spent / AP remaining。
- buy type / resource tier / utility tier / drop received。
- 当前 phase action。
- fallback / rejected reason。
- lastSeen 数量。
- C4 携带状态。

### 3.8 审计抽屉

详情抽屉分为五个标签：

- LLM：provider、model、expected/attempted calls、accepted/rejected/fallback、request/response artifact id、fallback reasons、provider errors。
- Combat：contact、participants、casualties、suppression、business score、CS score、economy evidence、variance。
- Economy：team posture、buy type、cash、outputBudget、resource tier、utility tier、drop。
- Hard Winner：isRoundOver、winnerSide、winnerTeamId、roundWinType、reason，并强调 winner 只来自 hard condition。
- Raw：trace/phase 原始 JSON 折叠查看。

### 3.9 成功标准

N31 收口补丁完成后必须满足：

- `/hex-lab/match` 第一屏像比赛验收台，不是表格页。
- 页面中文无乱码。
- completed map 不再只有英文报错。
- 地图主视图可见。
- 选手卡可见。
- round/phase 双层时间轴可见。
- LLM/combat/economy/hard winner 审计可见。
- “一直跑到地图结束”是可停止的客户端逐回合循环。
- live replay 无关文件不被修改、不被提交。
- Web tests、Hex core 回归、typecheck、package build、Next build 通过。

### 3.10 不做

N31 不做：

- N32 结构封板。
- N33 real provider 稳定专项。
- N34 旧 Node/Sector 删除。
- AP/combat/economy/winner 规则调整。
- DB migration。
- BO3。
- 直播级观赛 UI。
- 任何旧 Node Lab 改造。

## 4. N32：Hex 结构封板

N32 在 N31 Web 可验收后执行。

目标：

- 拆大文件。
- 整理 module exports。
- 修复剩余文档乱码。
- 审查历史命名债务。
- 准备旧 Node/Sector 删除清单。

优先拆分：

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

N32 不新增比赛机制，不调规则。

## 5. N33：真实 LLM Web 稳定验收

N33 专门处理 real provider。

目标：

- Web 上用 real provider 跑 Hex 单回合。
- Web 上用 real provider 跑小上限地图。
- 每 agent 每 phase 的 request/response/fallback/rejected/accepted 可审计。
- provider error 不崩页面，不包装成成功。

N33 成功标准：

- real 单回合可从 Web 启动并完成，或明确 external blocked。
- real 小地图可用 `maxRounds=4-8` 验收。
- 所有 provider failure 进入 audit。
- LLM 仍不能写 winner、kills、economyDelta、DB fact。

## 6. N34：旧 Node/Sector 删除收口

N34 只有在 N31-N33 完成后进入。

删除目标：

- 旧 Node Lab 主控入口。
- 旧 sector UI 主控。
- 旧 `node-graph.json` runtime 依赖。
- 旧 `sector-map.json` runtime 依赖。
- `node-engine` 中不再被任何保留路径引用的 action/judge/graph/sector 模块。

保留兼容：

- 历史 frozen 文档。
- 历史 artifact 读取兼容。
- 旧 RoundReport 读取兼容。

## 7. 总体验收原则

后续每个 N 都必须满足：

- 目标明确。
- 成功标准明确。
- 范围边界明确。
- 不混旧 Node/Sector 主线。
- 不让 LLM 写硬事实。
- 测试和人工验收路径明确。
- 失败必须写“部分完成”或“未完成”，不能包装成完成。
