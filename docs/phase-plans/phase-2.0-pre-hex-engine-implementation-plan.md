# Phase 2.0-pre HexGrid 回合引擎实施计划

## 0. 当前阶段定位

本计划是 `Phase 2.0-pre` 在节点化实验后的路线重置实施计划。

当前事实：

- `packages/core/src/node-engine/` 已存在，说明旧 Node/Sector 实验层已经形成。
- Dust2 旧资产仍包含 `node-graph.json`、`node-graph.md`、`sector-map.json`、`sector-map.md`。
- 旧 Node Lab 已经能展示节点化实验结果，但当前路线已经偏离新的目标：真实地图空间应由可编辑的 `HexGrid（蜂巢格）` 承载。
- 用户明确要求更果断地停止旧实验路线，未来不要无限归档和堆叠旧上下文。

本轮 N20 不改 runtime（运行时）、不改 UI（界面）、不改 DB（数据库）、不改比赛规则。它只做路线重置和文档封板，为 N21-N31 提供稳定依据。

具体比赛运行规则不在 N20 或 N21 单独定义，而由 `phase-2.0-pre-hex-engine-runtime-contract.md` 作为 N21-N31 的共同技术契约承载。后续 schema（结构定义）、runtime（运行时）、LLM boundary（大语言模型边界）、combat resolver（战斗裁定器）和 report bridge（报告桥接）都必须先对齐该契约。

## 1. 目标

N20 的目标：

- 新增 HexGrid（蜂巢格）路线重置纲领。
- 新增 HexGrid（蜂巢格）实施计划。
- 将旧节点化纲领与旧节点化实施计划移入 `docs/phase-plans/frozen/`，并标记为 superseded（已替代）。
- 明确旧 `NodeGraph（节点图）/ SectorMap（区块图）` 实验层停止扩展。
- 明确未来 N20-N31 的新路线。
- 明确旧实验层何时删除，而不是永久保留。

路线长期目标：

- 用 50x50 蜂巢画布承载 Dust2 地图空间。
- 由用户手动选择可比赛格、划分区域、命名点位。
- 用代码计算路径、AP、状态继承和胜负条件。
- 每个 agent 每个 phase 调用 LLM 生成行动草案。
- `Combat（战斗）` 进入结构化裁定，而不是只看占点或人数。
- 当前经济系统平滑接入 Hex 回合。
- 最终用 Hex 引擎跑完 Dust2 当前地图。
- Hex 单图跑通后删除旧 Node/Sector 实验层。

## 2. 成功标准

N20 完成后必须满足：

- `docs/phase-plans/phase-2.0-pre-hex-engine-reset-charter.md` 存在。
- `docs/phase-plans/phase-2.0-pre-hex-engine-implementation-plan.md` 存在。
- `docs/phase-plans/phase-2.0-pre-hex-engine-runtime-contract.md` 存在，并作为 N21-N31 共同技术契约。
- 旧 `phase-2.0-pre-node-round-engine-charter.md` 已从主计划目录移入 `docs/phase-plans/frozen/phase-2.0-pre-node-round-engine-charter.superseded.md`。
- 旧 `phase-2.0-pre-node-round-engine-implementation-plan.md` 已从主计划目录移入 `docs/phase-plans/frozen/phase-2.0-pre-node-round-engine-implementation-plan.superseded.md`。
- frozen（冻结）目录有 README，明确旧文档只用于历史追溯，不得作为 N20+ 主线依据。
- 新文档包含 N20-N31 阶段表。
- 新文档包含旧 Node/Sector 停止扩展和删除里程碑。
- 新文档包含 LLM 与代码约束边界。
- 不修改任何 runtime code（运行时代码）。
- 不修改旧比赛提交路径。

## 3. 范围边界

In scope（本轮范围）：

- 写 HexGrid 路线纲领。
- 写 HexGrid 实施计划。
- 将旧节点化文档移入 frozen（冻结）目录并标记为 superseded（已替代）。
- 明确 N20-N31。
- 明确删除旧 Node/Sector 的阶段条件。

Out of scope（本轮不做）：

- 不实现 HexGrid schema。
- 不实现 HexMapEditor。
- 不实现 pathfinding（寻路）。
- 不实现 AP 计算。
- 不实现 agent phase memory。
- 不调用真实 LLM。
- 不改旧 Node Lab。
- 不删除旧 node-engine 文件。
- 不改 `engine.ts`。
- 不改经济参数。
- 不改 winner 规则。
- 不改 DB。

## 4. 技术实现路线

### A. 文档封板

新增：

```text
docs/phase-plans/phase-2.0-pre-hex-engine-reset-charter.md
docs/phase-plans/phase-2.0-pre-hex-engine-implementation-plan.md
```

更新：

```text
docs/phase-plans/phase-2.0-pre-node-round-engine-charter.md
docs/phase-plans/phase-2.0-pre-node-round-engine-implementation-plan.md
```

旧文档不保留在主计划目录，因为它仍然会污染后续计划入口。旧文档只能保留在 frozen（冻结）目录作为历史背景，并且必须明确标注：

- 已被 HexGrid（蜂巢格）路线替代。
- 不再作为 N20+ 主线依据。
- 旧 Node/Sector 路线停止扩展。
- 后续按里程碑删除。

### B. HexGrid 数据结构方向

N21 开始定义：

- `HexCell（蜂巢格）`
  - `q/r` 或 `col/row` 坐标。
  - 是否可比赛。
  - 所属 region。
  - 所属 point。
  - terrain（地形）。
  - cover（掩体）。
  - choke（狭道）。
  - bombsite（包点）。
  - spawn（出生点）。
  - visionFeature（视野特征）。
- `HexRegion（蜂巢区域）`
  - 大区名称，如 A大、B洞、中路。
  - 包含 cell ids。
  - 商业语义说明。
- `HexPoint（小点位）`
  - A default、Pit、Long Doors 等。
  - 对应若干 cell。
- `HexMapAsset（蜂巢地图资产）`
  - 地图 slug。
  - grid size。
  - cells。
  - regions。
  - points。
  - validation rules。

### C. HexMapEditor 前端方向

N22 开始建立：

```text
/hex-lab/editor
```

第一版能力：

- 50x50 蜂巢画布。
- Dust2 radar image（雷达图）底图叠加。
- 画笔选择可比赛格。
- 橡皮擦删除格。
- 区域模式给格分配 region。
- 点位模式给格分配 point。
- 保存和加载 `dust2-hex-map.json`。

第一版不做：

- 不做自动图像识别。
- 不做复杂地图设计软件。
- 不做多人协作编辑。

### D. Hex 比赛运行方向

N24-N30 建立新 runtime：

```text
HexRoundRunner（蜂巢回合推进器）
HexAgentCommandPipeline（蜂巢智能体命令管线）
HexCombatResolver（蜂巢战斗裁定器）
HexWinConditionMaterializer（蜂巢胜负条件物化器）
HexRoundCommitter（蜂巢回合提交器）
HexReportBridge（蜂巢报告桥接）
```

LLM 输入必须来自当前 Hex 状态：

- 当前 cell/region/point。
- 可走路径。
- AP 剩余。
- 本队计划。
- 自己角色职责。
- 上一 phase 记忆。
- 队友/敌人已知信息。
- 当前经济和装备。
- 当前道具能力。
- 当前 phase 目标。

LLM 输出必须被代码校验：

- 不能走出可比赛区域。
- 不能穿墙或跳过不存在路径。
- 不能超 AP。
- 不能使用不存在道具。
- 死亡 agent 不能行动。
- 不能直接写 winner。
- 不能伪造击杀事实。

### E. 旧 Node/Sector 删除方向

删除分三步：

- N29 后：删除旧 Node Lab 主入口和旧 sector UI 主控。
- N30 后：删除旧 node/sector runtime 依赖。
- N31：删除旧 `node-engine` 中不再被引用的 action/judge/graph/sector 模块，并清理旧 Dust2 node/sector 资产。

### F. 过渡期隔离规则

当前实验新引擎不是旧 `Phase18`，但也不是 HexGrid（蜂巢格）终局方向。它必须冻结为历史实验层，不能继续作为第二条主线扩张。

N21 起执行以下硬边界：

- Hex runtime 新增代码必须放在 `packages/core/src/hex-engine/`。
- Hex shared schema 必须使用独立 `hex` 命名，不复用 node/sector 作为主结构。
- Hex 地图资产必须放在 `data/materials/processed/maps/<mapSlug>/hex/`。
- Hex 前端入口必须走 `/hex-lab/*`，不继续扩 Node Lab 主控。
- `hex-engine` 不得 import 旧 `node-engine/action`、`node-engine/judge`、`node-engine/graph`、`node-engine/sector` runtime 模块。
- Hex pathfinding 不得依赖 `node-graph.json`。
- Hex AP 不得依赖旧 node edge 成本。
- Hex combat 不得依赖 `local-node-judge` 作为主裁定器。

允许复用的是经验和非 node/sector 业务能力：

- artifact / audit / fallback 的记录思路。
- provider real/fixture 切换经验。
- Web progress 展示经验。
- RoundReport bridge 经验。
- economy/output 系统。
- team context 和 coach context。
- LLM boundary 校验思想。

禁止复用的是旧路线主模型：

- `node-graph.json` 不再作为未来路径真相。
- `sector-map.json` 不再作为未来地图区域真相。
- node trace 不得混写为 hex trace。
- local node judge 不得升级为 Hex Combat Resolver。

## 5. 分阶段执行步骤

### N20：路线重置与文档封板

目的：固定新主线，停止旧 Node/Sector 上下文污染。

验收：

- 新 charter 和 implementation plan 存在。
- 旧文档移入 frozen（冻结）目录，并有 superseded 标记。
- 后续 N20-N31 表完整。

### N21：HexGrid Schema（蜂巢格结构）

目的：先让地图资产有机器结构。

第一版落地内容：

- `packages/shared/src/hex-schemas.ts`：定义 HexGrid schema/type。
- `packages/core/src/hex-engine/map/hex-map-validator.ts`：校验 Hex map asset 的跨字段一致性。
- `data/materials/processed/maps/dust2/hex/dust2-hex-map.draft.json`：只用于 N21 测试的 Dust2 draft asset，不是正式地图。

验收：

- 50x50 grid、cell、region、point schema 可测试。
- 非法 cell、重复 region、悬空 point 能被测试抓住。
- `10 cells = 1 AP` 写入 asset/config。
- T/CT spawn、A/B bombsite、route hint 能被表达和校验。
- `packages/core/src/hex-engine/architecture-boundary.test.ts` 通过，证明 HexEngine 不依赖旧 Node/Sector runtime 或旧 Dust2 node/sector 资产。
- N21 不实现编辑器、比赛运行、LLM 调用或正式 Dust2 地图。

### N22：HexMapEditor（蜂巢地图编辑器）

目的：让用户能手工画 Dust2，而不是让 LLM 或前端猜地图。

验收：

- 可勾选 cell。
- 可划 region。
- 可命名 point。
- 可保存 JSON。
- 刷新后能重新加载。

### N23：Dust2 Hex Asset（Dust2 蜂巢资产）

目的：形成第一张可运行地图资产。

验收：

- 所有可比赛区域、区域、点位、出生点、包点都被标注。
- asset validator 通过。

### N24：Hex Pathfinding + AP（路径与行动点）

目的：让移动和行动成本有真实空间依据。

验收：

- 非法路径失败。
- 远距离移动成本更高。
- 装备/道具修正影响 AP。
- agent 不能超 AP。

### N25：Agent Phase Memory（阶段记忆）

目的：每阶段继承上一阶段事实。

验收：

- 第二 phase 能读取第一 phase 的位置、行动、已知信息和状态。
- 死亡、受伤、消耗道具、包状态能传递。

### N26：Agent 每 phase LLM Harness（调用骨架）

目的：让 agent 真正逐阶段决策。

验收：

- 10 个 agent 的 phase command 可审计。
- request/response artifact 完整。
- 失败可断点恢复。

### N27：Hex Combat Harness（蜂巢战斗裁定）

目的：让交火进入结构化裁定，不再只是占点状态。

验收：

- 交火结果包含伤亡、道具、地理、经济、角色、商业计划证据。
- combat 不直接伪造最终 round winner。

### N28：Economy 接入 Hex Round（经济接入）

目的：当前经济系统服务新 Hex 回合。

验收：

- 经济继承稳定。
- 购买、道具、发枪、保枪影响行动能力。
- 经济不直接控 winner。

### N29：Hex Round Commit（单回合提交）

目的：正式提交一个 Hex Dust2 回合。

验收：

- RoundReport 引用 hex trace。
- winner 来自 Hex hard condition。
- 旧 Phase18 不受影响。

### N30：Hex Dust2 Map（完整地图灰度）

目的：跑完整 Dust2 地图。

验收：

- 地图完成。
- trace 完整。
- 失败原因可分类。
- 前端可查看每回合每 phase。

### N31：旧 Node/Sector 删除收口

目的：清理实验路线，避免项目杂乱。

验收：

- 旧 node/sector runtime 不再被引用。
- 旧 Node Lab 主入口删除。
- 旧 Dust2 node/sector 资产不再污染主线。

## 6. 预期改动清单

预计新增：

- HexGrid 路线文档。
- HexGrid schema/type。
- HexMapEditor 前端。
- Dust2 Hex map asset。
- Hex pathfinding/AP 模块。
- Hex agent phase command 模块。
- Hex combat resolver。
- Hex round/map runner。
- Hex trace/report bridge。

预计修改：

- 旧节点化文档移入 frozen（冻结）目录并标记 superseded。
- Node Lab 后续迁移为 Hex Lab 或删除。
- core export 暴露 Hex 主线。
- Web 控制台入口改为 Hex 实验台。

预计删除：

- 旧 `node-graph.json` runtime 依赖。
- 旧 `sector-map.json` runtime 依赖。
- 旧 node/sector 展示组件。
- 旧 node-engine 中不再被 Hex 引擎引用的模块。

## 7. 风险与替代方案

风险：

- 50x50 Hex 编辑器如果没有底图叠加，手工画图会困难。
- 每 agent 每 phase 调 LLM 调用量大，可能卡住或成本高。
- Combat 一上来做理想结构，debug 成本会高。
- 删除旧模块过早会破坏当前可运行实验路径。

对策：

- 删除按里程碑执行，不无限归档，也不无序删除。
- N20-N24 不删除旧可运行路径，只停止扩展。
- N29 单回合 Hex 提交成功后，开始删旧 Node Lab 主控。
- N30 完整地图成功后，删除旧 node/sector runtime。
- 每个 Hex LLM 调用必须有 artifact 和 audit，不允许黑箱。

替代方案：

- 如果 HexMapEditor 进度不稳，先完成 schema 和离线 JSON 资产，再接编辑器。
- 如果真实 LLM 成本过高，先跑低 phase 数、低回合数验收，但结构仍按每 agent 每 phase 设计。
- 如果 Hex Combat 复杂度过高，先保证输入结构完整，再逐步增强裁定模型；不能退回纯人数规则。

## 8. 自动化验证

N20 文档阶段：

- 检查文档 UTF-8 可读。
- 检查旧节点化文档已移入 frozen（冻结）目录并保留 superseded 标记。
- 检查未来 N20-N31 表完整。

N21-N24 地图阶段：

- Hex schema tests。
- Hex map asset validation。
- pathfinding tests。
- AP cost tests。
- editor serialization tests。
- typecheck。
- package build。
- Next build。

N25-N30 比赛阶段：

- agent memory tests。
- LLM boundary tests。
- combat resolver tests。
- economy adapter tests。
- round commit tests。
- map runner tests。
- Hex Lab UI tests。
- real LLM 小上限验收。

## 9. 人工验收流程

### N22 编辑器验收

1. 打开 `/hex-lab/editor`。
2. 看到 50x50 蜂巢画布。
3. 叠加 Dust2 底图。
4. 用画笔选中可比赛区域。
5. 划分 A区、B区、中路、A大、B洞、出生点。
6. 给小点位命名。
7. 保存 JSON。
8. 刷新后能重新加载。

### N26 LLM 行动验收

1. 跑单回合小上限。
2. 每个 agent 每个 phase 都有 request/response。
3. 页面显示谁在第几 phase 调用了 LLM。
4. 能看到行动草案、被拒原因、fallback。
5. 死亡或 AP 不足时 agent 不能继续非法行动。

### N30 完整地图验收

1. 用 Hex 引擎跑 Dust2 当前地图。
2. 能看到每回合每 phase 的位置、行动、战斗、经济和胜负。
3. 完整地图可结束。
4. 每个 winner 都能追溯到 Hex trace 和 hard condition。
5. 旧 Node/Sector 不再作为主控路径出现。

## 10. 阻塞性问题

当前无阻塞问题。

默认决策：

- 使用 50x50 作为第一版蜂巢画布。
- 使用 Dust2 底图叠加编辑。
- 第一版 HexMapEditor 只做够用编辑器，不做复杂地图设计软件。
- 每 agent 每 phase 调 LLM 是目标方案。
- 经济系统保留并接入。
- 旧 Node/Sector 删除是目标，不做永久归档。

## 11. 最小化与回滚策略

最小化策略：

- N20 只写文档。
- N21 只做 schema/type。
- N22 只做可用编辑器。
- N23 只做 Dust2 第一版资产。
- N24 只做路径/AP。
- 不在 N20-N24 删除旧可运行路径。

回滚策略：

- 如果 HexMapEditor 失败，保留新文档和 schema，不删除旧 Node/Sector。
- 如果 Hex AP 失败，回退 AP 模块，不回退编辑器和地图资产。
- 如果 Hex Combat 失败，保留 trace 和失败证据，不回退地图空间层。
- 如果 Hex 单回合提交失败，不进入旧模块删除阶段。

删除策略：

- N20-N24：冻结旧 Node/Sector，不新增功能。
- N29 后：删除旧 Node Lab 主入口和旧 sector UI。
- N30 后：删除旧 node/sector runtime 依赖。
- N31：删除旧 node-engine 中不再被引用的模块，并清理旧 Dust2 node/sector 资产。

## 12. 下一步交付物

N20 交付：

1. `phase-2.0-pre-hex-engine-reset-charter.md`。
2. `phase-2.0-pre-hex-engine-implementation-plan.md`。
3. 旧节点化文档移入 frozen（冻结）目录并保留 superseded 标记。
4. N20-N31 阶段表。
5. 删除旧 Node/Sector 的里程碑规则。
6. 人工验收说明。
7. 后续 N21 执行计划入口。

N20 完成后，不直接写比赛逻辑；下一步进入 N21：HexGrid schema/type 与第一版 50x50 画布数据结构。
