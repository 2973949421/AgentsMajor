# Phase 2.0-pre HexGrid 回合引擎路线重置纲领

## 1. 文档定位

本文档用于正式重置 `Phase 2.0-pre` 后续比赛引擎路线。

从本文档生效起，未来 N20+ 的主线不再继续扩展旧 `NodeGraph（节点图）/ SectorMap（区块图）` 实验层，而是转向 `HexGrid（蜂巢格）` 地图底层、逐 agent（智能体）逐 phase（阶段）LLM（大语言模型）行动、代码硬约束地图/AP（行动点数）/经济/状态/胜负的完整比赛引擎。

本文档是后续计划、schema（结构定义）、runtime（运行时）、front-end（前端）实验台和旧实验层删除的最高依据。旧节点化文档已经移入 `docs/phase-plans/frozen/`，只保留历史背景，不再作为未来主线。

## 2. 重置结论

新的主线判断：

- `HexGrid（蜂巢格）` 是地图空间底层真相。
- `Region（大区域）` 和 `Point（小点位）` 从蜂巢格标注产生，不再依赖旧 `sector-map.json`。
- 旧 `node-graph.json`、`sector-map.json` 只作为临时对照，后续按里程碑删除，不永久归档。
- 每个 agent 每个 phase 单独调用 LLM，LLM 只输出行动草案。
- 代码负责合法性：蜂巢可走区域、路径、AP、经济、道具、状态继承、死亡/存活、包状态、胜负条件。
- `Combat（战斗）` 不做“人数多就赢”的简化版，直接设计完整结构化战斗裁定输入。
- 当前 `Economy/Output（经济/输出）` 系统保留，但要接入 Hex 回合状态。
- 前端主实验台从 `Node Lab（节点实验台）` 迁移到 `Hex Lab（蜂巢实验台）`，提供蜂巢地图编辑器和比赛观测台。
- 旧 Node/Sector 实验层在 Hex 单图跑通后删除，而不是无限保留。

## 3. 当前成果处理决策

### 3.1 保留并复用

- `Economy/Output（经济/输出）` 系统：继续作为资源层接入 Hex 回合。
- `Stage Runner（阶段调用器）` 的 artifact（产物）、checkpoint（断点）、stale recovery（悬挂恢复）思路。
- `Team Context（队伍上下文）`、role（角色）、coach（教练）上下文。
- `Node Lab（节点实验台）` 中真实 LLM 调用审计、fallback（降级）展示、run progress（运行进度）经验。
- `RoundReport（回合报告）` 和 artifact bridge（产物桥接）经验。
- 已完成的 `engine.ts` 瘦身成果：旧 `engine.ts` 不应重新膨胀成新业务大文件。

### 3.2 停止扩展

- 停止扩展 `node-graph.json`。
- 停止扩展 `sector-map.json`。
- 停止扩展当前 39 node（细节点）+ 13 sector（区块）展示路线。
- 停止把 `local-node-judge（局部节点裁判）` 作为未来主裁判路线。
- 停止基于 node edge（节点边）计算 AP 的旧路径成本模型。
- 停止继续美化旧 Node/Sector 地图作为主线 UI。

### 3.3 计划删除

删除不是立即执行，但必须有里程碑：

- N20-N24：冻结旧 Node/Sector，不新增功能。
- N29：Hex 单回合正式提交后，删除旧 Node Lab 主入口和旧 sector UI 主控。
- N30：Hex Dust2 完整地图跑通后，删除旧 node/sector runtime（运行时）依赖。
- N31：删除旧 `node-engine` 中不再被引用的 action/judge/graph/sector 模块，并清理旧 Dust2 node/sector 资产。

## 4. 新主线架构

Hex 主线不再让 LLM 猜地图路径。地图、区域、路径、行动点和胜负条件由代码提供硬约束。

```text
HexMapAsset（蜂巢地图资产）
  -> HexRoundState（蜂巢回合状态）
  -> HexAgentPhaseMemory（智能体阶段记忆）
  -> HexAgentCommandPipeline（智能体命令管线）
  -> HexActionValidator（行动校验器）
  -> HexCombatResolver（战斗裁定器）
  -> HexWinConditionMaterializer（胜负条件物化器）
  -> HexRoundCommitter（回合提交器）
  -> HexReportBridge（报告桥接）
```

核心边界：

- LLM 输出行动草案，不输出最终 winner（胜方）。
- LLM 不能伪造击杀、包状态、经济参数、地图路径。
- 代码校验行动合法性，再决定是否进入战斗裁定。
- 战斗裁定必须看到地理、距离、掩体、视野、道具、经济、角色、商业计划证据。
- 胜负只来自代码物化的硬条件：全歼、C4 爆炸、拆包、时间结束、保枪/无法下包等。

## 5. LLM 调用原则

未来理想比赛不是单个整回合 prompt（提示词）决定结果，而是逐 agent、逐 phase 推进。

每个 agent 每个 phase 的 request（请求）必须包含：

- 当前 cell（蜂巢格）/ region（大区域）/ point（小点位）。
- 当前可走路径和 AP 剩余。
- 本队计划。
- 自己角色职责。
- 上一 phase 的记忆。
- 队友和敌人已知信息。
- 当前经济、装备、道具能力。
- 当前 phase 目标。
- 业务/商业计划底色。

每个 response（响应）必须经过代码校验：

- 不能走出可比赛区域。
- 不能穿墙或跳过不存在路径。
- 不能超 AP。
- 不能使用不存在道具。
- 死亡 agent 不能行动。
- 不能直接写 winner。
- 不能伪造击杀事实。
- 不能修改经济参数。

所有新 LLM 调用都必须保留：

- request artifact（请求产物）。
- response artifact（响应产物）。
- validator（校验器）记录。
- fallback（降级）记录。
- rejected draft（被拒草案）原因。

## 6. 新 N 路线

| 阶段 | 名称 | 目标 | 结果判定 |
|---|---|---|---|
| N20 | 路线重置与文档封板 | 写入 HexGrid 重置纲领，冻结旧 Node/Sector 主线 | 新文档完成，旧文档移入 frozen（冻结）目录并标记 superseded（已替代） |
| N21 | HexGrid Schema（蜂巢格结构） | 定义 50x50 蜂巢坐标、cell、region、point、terrain、flags | schema/type/test 通过 |
| N22 | HexMapEditor（蜂巢地图编辑器） | 前端可勾选可比赛格、橡皮擦、区域填色、保存 JSON | 用户可手工画 Dust2 v1 |
| N23 | Dust2 Hex Asset（Dust2 蜂巢资产） | 生成 Dust2 可走区域、区域、点位、出生点、包点资产 | JSON 可加载、可校验 |
| N24 | Hex Pathfinding + AP（路径与行动点） | 用蜂巢距离、动作成本、装备/道具修正计算 AP | agent 不能走非法路线或超 AP |
| N25 | Agent Phase Memory（阶段记忆） | 每个 agent 保存上一 phase 位置、信息、职责、行动结果 | 第二阶段能继承第一阶段事实 |
| N26 | Agent 每 phase LLM Harness（调用骨架） | 每个 agent 每 phase 调一次 LLM 生成行动草案 | 10 agent x phase 调用可审计 |
| N27 | Hex Combat Harness（蜂巢战斗裁定） | 建立交火输入：距离、掩体、视野、人数、道具、经济、商业计划 | combat 不再只是 contested/neutral |
| N28 | Economy 接入 Hex Round（经济接入） | 当前经济系统驱动购买、道具、AP 负载、保枪/发枪 | 经济继承稳定，不直接控 winner |
| N29 | Hex Round Commit（单回合提交） | 用 Hex 状态正式提交 Dust2 单回合 | RoundReport 引用 hex trace |
| N30 | Hex Dust2 Map（完整地图灰度） | 用 Hex 引擎跑完 Dust2 当前地图 | 可完赛、可审计、可前端查看 |
| N31 | 旧 Node/Sector 删除收口 | 删除旧 node/sector 实验层和旧 Node Lab 主入口 | 不再污染上下文和目录 |

## 7. 后续计划规则

后续所有计划必须遵守：

- 先引用本文档和实施计划，再写具体阶段执行。
- 不再新增旧 Node/Sector 机制。
- 不再用旧 node graph 解释未来地图路径。
- 不把旧 Node Lab 作为新主线入口。
- 不为短期演示继续堆叠旧实验层。
- 删除旧模块必须按 N29/N30/N31 里程碑执行，不能无序删除。
- 如果新 Hex 路线失败，只回退当前 Hex 阶段，不复活旧 Node/Sector 主线。

## 8. 当前 N20 交付物

N20 只做路线重置，不做代码运行逻辑。

交付物：

1. 本文档。
2. `phase-2.0-pre-hex-engine-implementation-plan.md`。
3. 旧节点化纲领文档顶部 superseded（已替代）标记。
4. 旧节点化实施计划顶部 superseded（已替代）标记。
5. N20-N31 阶段路线。
6. 旧 Node/Sector 删除里程碑。
