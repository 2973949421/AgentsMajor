# Phase 2.0-pre HexGrid 回合引擎实施计划

## 0. 文档定位

本文档是 Phase 2.0-pre 在旧 Node/Sector（节点/区块）实验路线冻结后的 HexGrid（蜂巢格）主线实施计划。

当前主线判断：

- HexGrid 是后续比赛空间的底层事实。
- Region（区域）、Point（点位）、Flag（标记）都从 Hex map asset（蜂巢地图资产）产生。
- LLM（大语言模型）只输出 agent action draft（智能体行动草案）。
- 代码负责地图、路径、AP（行动点数）、经济、生命状态、C4 状态、combat（战斗裁定）和 final winner（最终胜负）。
- 旧 Node/Sector 不再扩展；N34 起不再暴露可执行入口，N34b 起旧 runtime 文件物理删除，N34c 起旧实验兼容层、progress/parser/UI 分支和 archive node-sector 资产从 active 口径移除。

本文档当前记录 N20-N34c 的 HexGrid 收口结果；下一步 N35 需基于当前状态另行规划。

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
| N31 | Hex Web 验收台 | 完成，保留已知真实度问题进入后续专项 | `/hex-lab/match` |
| N32 | Hex 结构封板 | 完成第一轮结构拆分 | memory types / combat casualties / round action events |
| N33 | 真实 LLM Web 稳定验收 | 完成第一轮入口补强 | real 小地图验收（6 回合） |
| N34 | 旧 Node/Sector 删除收口 | 完成保守退役 | Node Lab/API/CLI retired |
| N34b | 旧 Node/Sector 物理清理 | 完成安全清理 | `node-engine` 删除，Node/Sector materials archive，兼容 parser 保留 |
| N34c | Node 实验兼容层削减 | 完成 | `phase20_node_*` active mode / progress / UI 分支删除，archive node-sector assets 删除 |

## 2. 最新阶段路线

后续顺序固定为：

1. N31：Hex Web 验收台重做版。（已完成）
2. N32：Hex 结构封板。（已完成第一轮）
3. N33：真实 LLM Web 稳定验收。（已完成第一轮入口补强）
4. N34：旧 Node/Sector 删除收口。（已完成可执行入口退役）
5. N34b：旧 Node/Sector 物理清理。（已完成安全清理）
6. N34c：Node 实验兼容层削减。（已完成 active 兼容残留清理）

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

## 3.11 N31 收口补丁 B：Real LLM 行动可验收修复

N31 收口补丁 B 继续属于 Web 验收台，不进入 N32，也不调整比赛规则。

本补丁解决两个直接影响人工验收的问题：

- 比赛 UI 必须参考旧 Phase18 可取结构，形成“中央地图 + 左右选手 + 底部细节 + 悬浮控制台”的主视图，而不是把所有信息平铺成表格。
- real LLM（真实大语言模型）行动草案不能因为 `phaseId`、`currentCellId` 这类代码已知字段复述错误而全量 fallback（降级）。这些字段允许由代码安全修正并写入 audit（审计）；真正决定行动事实的 `targetCellId`、`actionType`、`businessIntent`、AP/path、C4 权限仍必须严格校验。

补丁 B 的硬边界：

- 不让 LLM 写 winner、kill、damage、economyDelta、DB fact。
- 不让前端重新计算 winner、AP、path 或 combat。
- 不伪造 HP、枪械、伤害、投掷物落点或敌人真实位置。
- request/response artifact id 必须进入 LLM audit，方便后续 N33 做真实 LLM 稳定验收。
- 如果选手没有移动，页面必须解释是 target 缺失、actionType 非法、businessIntent 缺失、AP/path 拒绝，还是 fallback，而不是前端假装移动。

补丁 B 完成后，N31 的 Web 验收台应能回答三个问题：

1. 当前 phase 中 10 名选手分别在哪里、做了什么、为什么 accepted/rejected/fallback。
2. LLM 调用了多少次，哪些请求/响应有 artifact，可否审计。
3. 最终 winner 来自哪条 hard condition，而不是来自 LLM 文本。

## 3.12 N31 收口补丁 D：前后端验收质量修复

N31 收口补丁 D 仍属于 Web 验收台收口，不进入 N32，不调 AP/combat/economy/winner 参数。

本补丁修复两类验收阻断：

- 后端比赛推进：真实 LLM 已能输出有效行动时，代码不能因为经济 allowed action 列表误拦截合法 objective action。`plant_bomb / defuse_bomb` 只跳过经济动作列表硬拦截，仍必须通过 C4、包点、阵营、路径和 AP 硬条件。
- 前端比赛观察：`/hex-lab/match` 必须优先呈现中央地图、T/CT 双侧选手、P0 准备阶段、回合/阶段回放、LLM 调用进度，而不是把地图压小并让选手栏长滚动。

补丁 D 的完成标准：

- 合法 `plant_bomb / defuse_bomb` 不再被 `economy_disallows_action` 误杀。
- 同一 phase 内 alive agent 不能被接受到同一个目标 cell；冲突必须以 `target_cell_occupied` 记录并 fallback。
- LLM request 包含 occupied/reserved cell 提示，降低模型重复选同一格的概率。
- Web projection 合成 `P0 准备阶段`，展示初始出生、C4、经济、AP 和 role，且 P0 不产生 LLM 调用。
- 地图主视图放大，左右黑区被压缩或由选手栏有效利用。
- 选手栏显示 role、KDA、ECO、AP、位置、本局花费、action、fallback/rejected，目标是在 1920x1080 下无需内部滚动即可审计 10 人。
- LLM 实时进度显示 expected/attempted、accepted/rejected/fallback、当前 agent、request/response artifact id。
- 页面中文无乱码，不伪造 HP、枪械、伤害、投掷物落点或敌人真实位置。

## 3.13 N31 收口补丁 F：真实 LLM 比赛推进修复

N31 收口补丁 F 继续属于 Web 验收台与真实 LLM 可验收链路修复，不新增 N 编号，不进入 N32。

本补丁锁定用户连续跑多回合后暴露的 7 个问题：

- AP 每 phase 必须重置。`memoryAfter` 表示当前 phase 结束状态；进入下一 phase 前必须单独生成 phase start memory，避免上一阶段 AP 消耗污染下一阶段 LLM request。
- `agentId / phaseId / currentCellId` 属于 request 已知上下文字段。LLM 缺失或复述错误时允许由代码修正并记录 `repaired_agentId / repaired_phaseId / repaired_currentCellId`；`targetCellId / actionType / businessIntent` 仍严格校验。
- target reservation 只硬拒友军占用或友军预占 cell。敌方 occupied cell 表示可能交火接触，不能被简化成 `target_cell_occupied` fallback。
- round runner 提供 deterministic tactical variation，按 roundNumber 轮换 A short、B tunnels、long A、mid split 等侧重点，减少多回合路线高度一致。
- C4 carrier 的 request 必须明确 objective chain：当前是否携带 C4、偏向 A/B、是否已在合法包点、何时 `plant_bomb` 是合法候选。
- Web KDA 来自 combat casualties 的可追溯汇总；不伪造 HP、伤害或枪械。
- `/hex-lab/match` 左右选手栏继续压缩和加宽，优先利用地图左右黑边，确保 10 名选手核心信息可一屏审计。

补丁 F 仍禁止：

- 不改 AP 汇率。
- 不改 combat 65/35 权重。
- 不改 economy 参数。
- 不改 hard winner 规则。
- 不让前端重新计算 winner。
- 不删除旧 Node/Sector。

## 3.14 N31 收口补丁 E：真实对抗可信度与路径/C4 验收修复

N31 收口补丁 E 仍属于 Web 验收台收口，不新增 N 编号，不进入 N32。它解决的是“能跑但不像真实对抗”的验收问题。

本补丁固定以下契约：

- accepted action trace 必须携带真实路径事实：`pathCellIds`、`verticalLinkIds`、`apCost`。Web 只能用这些字段画真实路径；旧 trace 缺少 `pathCellIds` 时，只能显示淡色“意图线”，不得标成路径/AP。
- C4 状态必须连续：`carrierAgentId`、`droppedCellId`、`plantedCellId`、`defused` 不能互相吞掉。C4 carrier 死亡时产生 dropped C4；T 方 alive agent 到 dropped cell 后可以 pickup；Web 必须区分 carried / dropped / planted。
- `plant_bomb / defuse_bomb` 进入 phase 内 objective window：先处理 movement，再处理 combat，最后由仍存活且满足 C4、包点、AP、阵营条件的 objective actor 写入下包/拆包事件。
- `move` 到合法包点且 businessIntent 明确包含 plant/下包意图时，可以修正为 `plant_bomb`，但必须写入 `repaired_move_to_plant_intent`，并且不能绕过 C4、bombsite、alive、AP 校验。
- site contest、choke contest、dropped bomb contest、plant pressure 进入 combat contact/audit，用于解释局部对抗，不得直接写 round winner。
- target cell 被友军占用或预占时，优先尝试同 point / 邻近可达空格修正，并写入 `repaired_target_cell_occupied`；无法修正才 fallback。
- Web marker 必须避免误导：当前 level 外的 alive player 以 ghost marker + level badge 显示；KDA 只能来自 selected round/phase 之前的 combat casualties 汇总，不伪造 HP、伤害或枪械。

补丁 E 成功后，人工验收应能回答：

1. 选手是否沿真实蜂巢路径移动，而不是穿墙直线。
2. C4 为什么被携带、掉落、拾起、下包或未下包。
3. 某次下包为什么成功或失败。
4. 某个 site/contact 为什么产生 combat verdict。
5. 地图上看似少人的情况是否只是跨 level 显示问题。
6. KDA 是否能追溯到 combat casualties。

## 4. N32：Hex 结构封板

N32 在 N31 Web 可验收后执行，第一轮已完成。

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

本轮实际收口：

- `hex-phase-memory.ts` 的类型与常量拆到 `hex-memory-types.ts`，reducer/推进逻辑继续留在原文件，保持 public API 不变。
- `hex-combat-resolver.ts` 的 casualty / suppression materializer 拆到 `hex-combat-casualties.ts`。
- `hex-round-runner.ts` 的 action -> memory event 转换拆到 `hex-round-action-events.ts`。
- `hex-engine` barrel exports 补齐新模块。
- `packages/core/src/index.ts` 不再公开导出旧 `node-engine`。
- architecture boundary 更新为：Hex 主线不依赖旧 Node/Sector，core public API 不暴露旧 Node/Sector。

## 5. N33：真实 LLM Web 稳定验收

N33 专门处理 real provider，第一轮已完成 Web 入口补强。

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

本轮实际收口：

- `/hex-lab/match` 增加 `real 小地图验收（6回合）` 控制入口。
- 该入口继续使用逐回合 real LLM 提交与刷新，不引入后台生产任务系统。
- provider error、accepted/rejected/fallback、request/response artifact 仍走现有 Hex Match Lab live run/progress 审计链。
- fixture 与 real 不混用：N31/N33 Web 主路径固定 real，fixture 仅保留为测试/显式 API 选项。

## 6. N34：旧 Node/Sector 删除收口

N34 只有在 N31-N33 完成后进入，第一轮采用“可执行入口退役 + 历史兼容读取保留”的保守收口方式。

删除目标：

- 旧 Node Lab 主控入口。
- 旧 sector UI 主控。
- 旧 `node-graph.json` runtime 依赖。
- 旧 `sector-map.json` runtime 依赖。
- `node-engine` 中不再被任何保留路径引用的 action/judge/graph/sector 模块。

N34 第一轮实际收口：

- `/node-lab` 页面改为退役说明，并引导到 `/hex-lab/match`。
- `/api/node-lab/run` 固定返回 410 retired，不再调用 Node/Sector runtime。
- `server-node-lab.ts` 改为退役 stub，保留同名导出避免残留 import 直接破坏构建。
- `phase20-node-*` CLI 脚本已删除，不再启动旧 runtime。
- `server-web-runner-policy.ts` 不再接受 `phase20_node_round_experimental` / `phase20_node_map_experimental`。
- Phase18 主页控制台中的旧 Node Lab 链接改为 Hex Web 验收台。
- `server-node-shadow-audit.ts` 不再调用旧 node shadow core；如被环境开关触发，会写 retired failure payload。

N34b 安全清理补丁：

- `packages/core/src/node-engine/**` 已物理删除，不再参与构建、导出或测试。
- 旧 Node Lab 客户端、旧 Node Lab CSS、Dust2 node layout helper 已删除；`/node-lab` 只保留退役说明页。
- `phase20-node-*` CLI 脚本已删除，不再作为可启动实验入口存在。
- architecture boundary 增加护栏：core public API 不公开旧 Node/Sector，且旧 `node-engine` runtime 目录不得回流。
- 历史 `nodeTraceArtifactId/nodeTraceSource` 兼容读取继续保留，避免破坏旧 RoundReport / replay。

N34c 兼容层削减：

- `phase20_node_round_experimental` / `phase20_node_map_experimental` 已从 shared active run modes、Web progress 和控制台 UI 中移除。
- `server-run-progress.ts` 不再解析 Node shadow / Node map experimental artifact，不再尝试恢复旧 Node 实验进度。
- `server-node-shadow-audit.ts` 已删除，Phase18 runner 不再写 Node shadow sidecar。
- `data/materials/archive/maps/dust2/node-sector/**` 已删除；frozen 文档保留旧路线决策背景，但旧 Node/Sector 资产不再作为可点击审计材料承诺。
- `nodeTraceArtifactId/nodeTraceSource` 作为历史 DB/schema 兼容字段暂留；active Hex/Web 代码应通过 trace reference 语义读取，不把字段名当作 Node runtime 入口。

保留兼容：

- 历史 frozen 文档。
- 旧 RoundReport 读取兼容。
- Phase18 replay / live replay 播放层。

## 7. 总体验收原则

后续每个 N 都必须满足：

- 目标明确。
- 成功标准明确。
- 范围边界明确。
- 不混旧 Node/Sector 主线。
- 不让 LLM 写硬事实。
- 测试和人工验收路径明确。
- 失败必须写“部分完成”或“未完成”，不能包装成完成。
