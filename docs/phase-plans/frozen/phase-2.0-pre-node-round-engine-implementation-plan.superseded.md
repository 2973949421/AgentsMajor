> [!IMPORTANT]
> 本文档已被 HexGrid（蜂巢格）路线重置计划替代。
>
> 新主线文档：
>
> - `docs/phase-plans/phase-2.0-pre-hex-engine-reset-charter.md`
> - `docs/phase-plans/phase-2.0-pre-hex-engine-implementation-plan.md`
>
> 本文档仅保留为历史背景，不再作为 N20+ 的实施依据。旧 `NodeGraph（节点图）/ SectorMap（区块图）` 路线停止扩展，后续按里程碑删除。

# Phase 2.0-pre 节点化回合引擎实施计划

## 0. 当前阶段定位

本计划是 `Phase 2.0-pre` 在 ENGINE 重构封板后的下一条主线，用于把当前“整回合裁判制”推进为“节点状态推进制”。

当前基础：

- `engine.ts` 已经降到编排层规模，不能再把新业务逻辑塞回 engine。
- `JudgePipeline`、`Economy/Output`、`CoachService`、`Stage Runner` 已有第一版结构。
- Dust2 已新增节点图资产：
  - `data/materials/processed/maps/dust2/node-graph.json`
  - `data/materials/processed/maps/dust2/node-graph.md`
- 节点图已经包含：
  - 重要节点。
  - 连接边。
  - 主路线。
  - T / CT 阶段可达性。
  - 时空硬约束。
- 当前共识纲领见：
  - `docs/phase-plans/phase-2.0-pre-node-round-engine-charter.md`

本计划的目标不是立刻替换整个比赛引擎，而是建立可验证、可回滚、可灰度的节点化回合引擎。

### 0.1 ENGINE 重构从 0 到 1 的阶段回顾

节点化专项不是从空地开始。它建立在前一轮 ENGINE 重构成果之上。

前一轮重构的核心目标是：

```text
把约 1.1 万行的 engine.ts 从“全能大文件”降为“回合编排层”，
把裁判、经济、coach、stage 调用、presentation、combat 等职责迁出，
并保住真实 LLM 生成的阶段性稳定成果。
```

当前结构基线：

| 模块 | 当前行数 | 当前职责 |
|---|---:|---|
| `packages/core/src/engine.ts` | 2298 | 比赛 / 地图 / 回合编排与提交事务。 |
| `packages/core/src/llm-stage-runner.ts` | 1108 | LLM stage 调用、artifact、checkpoint、llm_calls、stale recovery。 |
| `packages/core/src/judge-pipeline.ts` | 680 | 整回合裁判主链。 |
| `packages/core/src/judge-boundary.ts` | 1206 | 裁判输入输出边界、匿名化、prompt context。 |
| `packages/core/src/judge-validation.ts` | 1270 | 裁判归一化、校验、compose、fallback 判断。 |
| `packages/core/src/economy-output-service.ts` | 25 | Economy/Output 兼容入口。 |
| `packages/core/src/economy-rules.ts` | 425 | 经济规则。 |
| `packages/core/src/economy-buy-planner.ts` | 413 | 买型与购买计划。 |
| `packages/core/src/economy-state-transition.ts` | 208 | 回合经济状态继承与变化。 |
| `packages/core/src/submitted-output-gate.ts` | 87 | RawOutput 到 SubmittedOutput 的有效提交边界。 |
| `packages/core/src/coach-service.ts` | 14 | Coach 兼容入口。 |
| `packages/core/src/coach-timeout-service.ts` | 329 | 暂停触发、生成和状态更新。 |
| `packages/core/src/coach-review-service.ts` | 178 | 赛后 / 图后 review 现有逻辑。 |
| `packages/core/src/coach-validation.ts` | 242 | coach correction / review 校验。 |

从 0 到 1 的阶段性成果：

| 阶段 | 目标 | 实际结果 | 对节点化专项的意义 |
|---|---|---|---|
| R0：稳定基线保护 | 不摧毁已有真实 LLM 生成能力。 | 保留旧路径，真实 run 可继续生成；失败可被 audit 分类。 | 节点化第一版必须 shadow / experimental，不能直接替换旧路径。 |
| R1：LLM I/O 稳定 | 处理 provider、reasoning、JSON、stale started call。 | `llm-stage-runner.ts` 承接 stage 调用、artifact、checkpoint、stale recovery。 | N5 / N6 复用 Stage Runner，不重新发明 LLM 调用层。 |
| R2：JudgePipeline 抽离 | 从 engine 中迁出整回合裁判主链。 | `judge-pipeline.ts`、`judge-boundary.ts`、`judge-validation.ts` 已形成第一版。 | 节点化新增的是局部裁判，不能继续把旧 JudgePipeline 扩成新屎山。 |
| R3：Scorecard 与裁判 fallback 收口 | 去掉固定胜方模板，避免后验分数硬补。 | `judge-scorecard-materializer.ts` 已独立，scorecard fallback 不再塞 engine。 | 节点化后 winner 来源应进一步从 scorecard 转向硬胜负条件。 |
| R4：Economy/Output 抽离 | 经济和输出门从 engine 拆出。 | Economy/Output 已拆成规则、购买计划、状态转移、SubmittedOutput gate 和诊断。 | N3 只做 adapter，不推倒经济系统。 |
| R5：CoachService 抽离 | coach 不再由 engine 直接拼状态和 prompt。 | coach 拆成 timeout、review、validation，入口保持很薄。 | 后续 coach 可以读取节点轨迹做 timeout/review，但本专项不扩新 coach 能力。 |
| R6：Combat / Presentation / Diagnostics 外置 | 降低 engine 中回放、展示、诊断杂音。 | combat、round presentation、score tension、economy output diagnostic 已外置。 | 节点化事实后续通过 bridge 进入 replay，不由前端伪造。 |
| R7：审计闭环 | 能判断 latest run 是代码失败、provider 失败还是 recovered failure。 | `scripts/phase18-run-audit.mjs` 已建立并经历小修。 | 节点化实验必须保留 audit，可区分外部网络失败和机制失败。 |

当前阶段判断：

```text
ENGINE 重构从 0 到 1 已经基本完成；
后续不应再以“继续瘦 engine.ts”为主线；
新的主线是节点化回合引擎从 0 到 1。
```

### 0.2 已确认共识

后续计划和实现不得偏离以下共识：

- 项目本质是 CS 对抗骨架与商业计划 / 产品 / 运营 / 技术分工的有机结合。
- Dust2 节点必须参考真实地图结构，不能让 LLM 自行猜地点、路线和可达性。
- 地图节点是状态容器，不是 zone 字符串。
- 一回合拆成 3-5 个时间点，但回合可以提前结束。
- 胜负发生时间不确定，但胜负条件确定。
- 每个时间点可以有局部裁判，但局部裁判只裁节点事实，不直接裁整回合 winner。
- Agent 输出要有固定模板，既约束稳定性，又保留发挥空间。
- Agent 输出必须继续带商业底色。
- 有些 agent 在连续时间点可以按兵不动，这是合法行动。
- 经济信息队内共享，经济资产个人持有，每回合继承。
- 经济系统保留，但转为节点化引擎的资源约束层。
- 行动点数用于限制移动、小行动、道具、执行复杂度和商业计划负载，不直接决定对枪胜负。
- 代码与 LLM 共同工作：代码管合法性、状态和胜负条件，LLM 管行动选择、语义解释和局部碰撞。

### 0.3 默认决策

除非后续用户明确推翻，本计划采用以下默认决策：

- 第一张图只做 Dust2。
- 第一版只做单图节点化 round，不扩 BO3 和 16 队。
- 第一版保留旧路径作为 fallback。
- 第一版先 shadow / experimental，再进入 committed path。
- 第一版不做完整 CS 物理模拟。
- 第一版不做每个 agent 每个时间点单独 LLM 调用。
- 第一版每回合目标调用量控制在约 8-16 次。
- 第一版 AP 数值是工程约束，不是最终平衡参数。
- 第一版经济不调强弱，只改接入位置。
- 第一版不修比分，不硬控 winner。

## 1. 目标

目标：

- 让地图节点成为真实状态容器，而不是字符串。
- 让一回合按 3-5 个时间点推进，而不是一次性生成整回合。
- 让行动点数约束移动、道具、小行动和商业计划执行成本。
- 让经济成为资源约束层，而不是裁判 proof 的隐性放大器。
- 让局部裁判只裁定节点事实，最终胜负由代码硬条件结算。
- 保留 CS 与商业计划 / 产品 / 运营 / 技术分工的有机结合。
- 保持旧回合路径可对照、可 fallback，避免一次性摧毁当前稳定成果。

## 2. 成功标准

第一版成功标准：

- Dust2 节点图可被 runtime 加载，并通过节点 id、边、阶段可达性校验。
- `MapNodeState` 能记录人数、控制权、可见信息、道具影响、商业意图和交火前后状态。
- `RoundPhaseState` 能表示默认展开、第一接触、中盘决策、进点 / 回防、守包 / 拆包 / 残局。
- `AgentPhaseAction` 使用模板输出，包含 CS 行动与商业意图。
- 行动点数能限制：
  - 移动边数。
  - 道具动作。
  - 架枪 / 抢信息 / 转点 / 进点。
  - 下包 / 拆包。
- 经济 adapter 能把当前经济系统转换为 agent 可用资源与动作能力。
- 默认展开阶段 T 方不能合法出现在 A 默认包位或 B 默认包位。
- CT 方默认可以在 A 点、B 点、中门、A 小、B 门、B 窗等防守位置建立站位。
- 局部裁判输出不能直接写最终 winner。
- 最终胜负由代码根据全歼、下包、拆包、包炸、时间耗尽等硬条件结算。
- 新路径先支持 Dust2 单图 shadow / experimental 模式，不破坏旧路径。
- 自动测试、typecheck、package build 通过。
- 至少一次本地模拟 round 能完成节点阶段推进，并产出可审计 artifact。

## 3. 范围边界

In scope：

- Dust2 node graph runtime loader。
- 节点状态 schema。
- 时间阶段 schema。
- 行动点数模型。
- agent 阶段行动模板。
- economy adapter。
- 局部裁判 draft schema。
- 节点状态 validator。
- 胜负条件 materializer。
- 新旧回合路径兼容。
- 审计与 artifact。

Out of scope：

- 不做完整枪械弹道模拟。
- 不做 HP / 护甲精细模拟。
- 不做每颗道具物理落点。
- 不让每个 agent 每个节点单独 LLM 调用。
- 不硬控比分。
- 不随机翻盘。
- 不按队伍名补偿。
- 不让经济直接控制 winner。
- 不把节点化逻辑塞回 `engine.ts`。
- 不一次性废弃旧 `team_plan / agent_action / judge` 路径。

## 4. 总体架构

目标架构：

```text
RoundOrchestrator
  -> NodeGraphService
  -> RoundPhaseRunner
  -> EconomyResourceAdapter
  -> AgentPhaseActionPipeline
  -> LocalNodeJudgePipeline
  -> NodeStateMaterializer
  -> WinConditionMaterializer
  -> RoundReportBridge
```

职责边界：

- `engine.ts`：只编排 round 生命周期和提交事务。
- `NodeGraphService`：加载 Dust2 节点、边、路线、阶段可达性。
- `RoundPhaseRunner`：按时间阶段推进。
- `EconomyResourceAdapter`：把经济状态转换为购买、道具、行动能力。
- `AgentPhaseActionPipeline`：生成或继承 agent 阶段行动。
- `LocalNodeJudgePipeline`：裁定局部节点结果。
- `NodeStateMaterializer`：把行动和局部裁判转成节点状态变化。
- `WinConditionMaterializer`：按硬条件判断回合是否结束。
- `RoundReportBridge`：把节点化事实桥接到现有 RoundReport / replay。

### 4.1 新旧架构对照

旧链路：

```text
team_plan
-> agent_action
-> judge_verdict / judge_narrative 判整回合
-> combat / broadcast 补回放
-> round commit
```

新目标链路：

```text
node graph + economy state
-> phase state 初始化
-> agent phase actions
-> local node judge
-> node state materialize
-> win condition check
-> next phase or round commit
```

关键差异：

- 旧链路的裁判容易先定 winner，新链路让节点事实逐步积累。
- 旧链路的 combat 容易后验解释，新链路让交火成为节点状态变化的一部分。
- 旧链路的经济容易通过证据裁剪影响 judge，新链路让经济影响行动能力。
- 旧链路的地图 zone 偏语义标签，新链路的地图节点是可达、有距离、有状态的 graph。

### 4.2 模块边界要求

后续新增模块必须遵守：

- 不把节点化逻辑重新写进 `engine.ts`。
- 不把局部裁判逻辑写进 `JudgePipeline` 现有整回合裁判主链。
- 不把经济 adapter 混进 `economy-output-service.ts` 入口文件，避免重新膨胀。
- 不让 `RoundReportBridge` 反向影响节点状态。
- 不让 Web / replay 伪造节点事实。

## 5. 行动点数模型

第一版采用轻量 AP 模型。

默认：

```text
每名 agent 每个时间点基础 3 AP。
```

基础动作成本：

| 动作 | AP | 说明 |
|---|---:|---|
| 保持位置 | 0-1 | 适用于 anchor、等待信息、维持交叉火力。 |
| 架枪 / 守角 | 1 | 不直接决定对枪胜负，只提供局部优势。 |
| 移动 1 条边 | 1 | 必须沿 node graph 相邻边移动。 |
| 抢信息 | 1 | 可能暴露位置，也可能获得主动权。 |
| 丢道具 | 1 | 需要经济 / loadout 支持。 |
| 补枪准备 | 1 | 支持局部裁判判断协同。 |
| 转点 | 按边数 | 不能跨图瞬移。 |
| 进点 | 2 | 进入 A / B 包点的高风险动作。 |
| 下包 / 拆包 | 2-3 | 只能在合理时间阶段和节点发生。 |
| 保枪撤退 | 1-2 | 保留经济进入下一回合。 |

AP 不直接决定对枪胜负。

AP 决定的是：

- 当前阶段行动是否合法。
- 行动组合是否过载。
- 复杂商业计划是否超出执行能力。
- 经济弱势方是否必须取舍。

### 5.1 AP 与时空 graph 的关系

AP 不能覆盖地图时空硬约束。

例如：

- 即使 agent 有剩余 AP，默认展开阶段 T 方也不能直接出现在 A 默认包位或 B 默认包位。
- 即使 agent 想转点，也必须沿 `node-graph.json` 的边移动。
- 如果两个节点不相邻，行动必须拆成多段，且可能跨多个时间点。
- CT 方默认能先站住包点，是地图时空事实，不是裁判偏置。

AP 只在合法可达范围内生效：

```text
阶段可达性先判定
-> 节点边连接再判定
-> AP 消耗再判定
-> 经济 / 道具可用性再判定
```

### 5.2 AP 与商业计划执行成本

商业计划不能只写愿景，也要体现执行成本。

如果一个 agent 或队伍在同一时间点同时要求：

- 抢信息。
- 转点。
- 丢道具。
- 组织协同。
- 验证用户。
- 处理技术风险。
- 做运营转化。

则必须在 AP 和节点状态里体现负载过高、必须取舍或执行质量下降。

这不是惩罚复杂方案，而是防止“什么都要做、什么都能做”的空泛输出。

## 6. 经济系统接入策略

当前经济系统保留，但位置调整。

旧风险路径：

```text
经济差 -> 输出裁剪 -> judge 证据少 -> 更容易输
```

新目标路径：

```text
经济状态
-> agent 购买 / 道具 / 发枪 / 保枪能力
-> 可执行动作与行动质量
-> 节点推进与局部事实
-> 胜负条件结算
```

第一版 economy adapter 输出：

- agent 当前钱数。
- 当前 buy posture。
- 武器级别。
- 道具级别。
- 是否可承担首接触。
- 是否适合保枪。
- 是否可发枪 / 接枪。
- 当前时间点可用行动类型。
- 当前时间点行动质量修正。

明确禁止：

- 经济直接写 winner。
- 经济直接改变商业方案成立性。
- 经济直接把 scorecard 全维度压低。
- 经济通过文本裁剪暗中控分。

### 6.1 经济信息口径

经济信息口径固定为：

```text
队伍知道己方所有 agent 的经济状态。
队伍可以讨论本回合买型、发枪、保枪和风险。
每名 agent 只能花自己的钱，或接收队友发枪。
经济数据以 round 为单位继承。
经济持续影响购买、道具、行动能力、节点选择和战术复杂度。
```

后续 prompt 不应把己方经济当作隐藏信息。

但对手真实经济、对手当前买型、对手道具和对手输出预算仍不是公开输入。

### 6.2 Economy Adapter 与 Output Gate 的关系

`EconomyResourceAdapter` 不替代现有 `Economy/Output`。

它只负责把已有经济状态转换成节点化引擎可消费的资源约束：

- 可用武器级别。
- 可用道具级别。
- 可执行行动类型。
- 可承担风险类型。
- 是否适合首接触。
- 是否适合保枪。
- 是否可发枪 / 接枪。

`SubmittedOutput` 和 `Output Gate` 仍保留审计价值，但不应成为节点化 winner 的主要因果来源。

## 7. 节点化专项阶段

### 阶段 N0：文档与资产基线

目标：

- 固化节点化纲领。
- 固化 Dust2 node graph。
- 固化时空可达性。
- 固化 AP 与经济 adapter 原则。

交付物：

- `phase-2.0-pre-node-round-engine-charter.md`
- `phase-2.0-pre-node-round-engine-implementation-plan.md`
- `node-graph.json`
- `node-graph.md`

验收：

- JSON 可解析。
- 人工图能说明路线和时空关系。
- 文档明确“不让 LLM 自己猜地点和路线”。
- AP 与经济接入原则写入纲领和实施计划。

退出条件：

- `node-graph.json` 能被 Node 解析。
- `node-graph.md` 同时包含拓扑图和阶段可达图。
- 本文件能作为后续计划模式的阶段母版。

### 阶段 N1：Schema 与类型层

目标：

- 定义节点化回合引擎的最小结构类型。

预期新增：

- `MapNodeDefinition`
- `MapEdgeDefinition`
- `MapRouteDefinition`
- `MapReachabilityRule`
- `MapNodeState`
- `RoundPhaseId`
- `RoundPhaseState`
- `ActionPointBudget`
- `AgentPhaseAction`
- `LocalNodeVerdict`
- `RoundNodeStateSnapshot`

验收：

- 类型能表达节点、边、阶段、AP、行动、局部裁判。
- 不影响旧 RoundReport。
- 单元测试覆盖 schema parse / invalid node / invalid phase。
- schema 能表达按兵不动。
- schema 能表达商业意图。
- schema 能表达 AP 超支。
- schema 能表达阶段不可达。

禁止：

- 不把 schema 设计成全局 nullable。
- 不让 LLM 自由写任意 nodeId。
- 不在 N1 接真实 LLM。

### 阶段 N2：NodeGraphService

目标：

- runtime 能加载 Dust2 node graph。
- runtime 能验证节点 id、边、路线、阶段可达性。

预期新增：

- `node-graph-service.ts`

核心能力：

- `loadMapNodeGraph(mapSlug)`
- `getAdjacentNodes(nodeId)`
- `validateRoute(nodes[])`
- `getReachableNodes(side, phase)`
- `validateNodeReachability(side, phase, nodeId)`

验收：

- T 默认阶段不能到 A 默认包位 / B 默认包位。
- CT 默认阶段能到 A 点 / B 点防守位置。
- 不相邻节点移动会被拒绝。
- Dust2 graph 测试通过。
- 主路线能被枚举和校验。
- route timing notes 能被读取。
- 无效 nodeId / edge / route 报错明确。

禁止：

- 不在服务里写 winner 逻辑。
- 不在服务里写商业裁判逻辑。
- 不让 service 隐式补不存在的节点。

### 阶段 N3：EconomyResourceAdapter

目标：

- 把现有 Economy/Output 服务转换成节点化引擎可消费的资源约束。

预期新增：

- `economy-resource-adapter.ts`

核心输出：

- agent 可用动作。
- agent 道具能力。
- agent 首接触风险。
- agent 保枪倾向。
- team buy shape。
- 发枪 / 接枪提示。
- AP action quality modifier。

验收：

- ECO 仍能抢信息、抱团、赌点，但不能完整爆弹。
- full buy 可执行完整默认和进点组合，但仍受 AP 限制。
- 经济不会直接返回 winner。
- 测试覆盖 pistol / full buy / half buy / force buy / eco / overtime。
- 队伍共享经济信息能进入己方计划上下文。
- agent 个人经济限制能约束个人动作。
- 发枪 / 接枪只作为可用资源，不直接改 winner。

禁止：

- 不调经济强弱参数作为本阶段目标。
- 不把 outputBudget 差异直接翻译成 judge 胜负证据。
- 不让 adapter 返回“该队应该赢”。

### 阶段 N4：RoundPhaseRunner shadow 模式

目标：

- 新增节点阶段推进器，但不影响旧真实回合提交。
- 先在 shadow mode 生成节点状态和审计 artifact。

预期新增：

- `round-phase-runner.ts`
- `round-node-state.ts`

行为：

- 初始化默认节点状态。
- 生成 3-5 个 phase。
- 每个 phase 更新活跃节点。
- 每个 phase 检查硬胜负条件。
- shadow 输出不写正式 winner。

验收：

- 可以在不改旧 winner 的情况下产出节点状态轨迹。
- artifact 可读。
- 不影响旧 `phase18_next_round`。
- 能跑完默认展开到最后一个阶段，或因硬条件提前结束。
- shadow 输出能说明每阶段活跃节点。
- shadow 输出能说明每阶段 AP 消耗。

禁止：

- 不在 N4 替换正式 round commit。
- 不把 shadow 结果写成正式 winner。

### 阶段 N5：AgentPhaseActionPipeline

目标：

- 把 agent 行动从“整回合行动”变成“阶段行动”。
- 保留商业底色和模板约束。

预期新增：

- `agent-phase-action-pipeline.ts`

输出模板：

- 当前节点。
- 目标节点。
- 行动类型。
- AP 消耗。
- 商业意图。
- 配合对象。
- 风险判断。
- 预期结果。
- 信息传递。

验收：

- 保持位置是合法行动。
- agent 不能移动到当前阶段不可达节点。
- agent 不能超 AP 行动。
- 行动必须包含商业意图。
- 关键 agent 可展开，非关键 agent 可继承状态。
- 每个行动必须引用合法 nodeId。
- 每个行动必须有 actionType。
- 按兵不动 agent 不应被强迫编造动作。
- 低经济 agent 不能写完整高配爆弹。

禁止：

- 不让每个 agent 每个时间点都单独调用 LLM 作为默认路径。
- 不让 agent 输出 kill fact。
- 不让 agent 输出最终 winner。

### 阶段 N6：LocalNodeJudgePipeline

目标：

- 局部裁判只裁定节点事实，不直接裁定整回合 winner。

预期新增：

- `local-node-judge-pipeline.ts`

输出：

- 节点控制权变化。
- 信息优势变化。
- 局部交火结果。
- 资源消耗。
- 商业计划验证 / 破坏。
- 下一阶段主动权。
- 是否触发硬胜负条件检查。

验收：

- 局部裁判输出不能包含最终 winner。
- 局部裁判不能写不存在路线。
- 局部裁判不能写当前阶段不可达节点。
- 局部裁判不能把商业判词伪装成 kill fact。
- 局部裁判必须说明商业计划验证或被破坏的原因。
- 局部裁判必须说明节点状态变化。
- 局部裁判输出必须可被代码 materialize。

禁止：

- 不把现有 JudgePipeline 继续扩成节点裁判屎山。
- 不让局部裁判引用被 Output Gate 裁掉的 RawOutput。
- 不让局部裁判绕过 code validator。

### 阶段 N7：WinConditionMaterializer

目标：

- 最终回合胜负由代码硬条件结算。

预期新增：

- `win-condition-materializer.ts`

硬条件：

- 一方全歼。
- 包已下且爆炸。
- 包被拆除。
- 时间耗尽且未下包。
- 守包 / 回防残局结束。

验收：

- first_contact 阶段可以因全歼提前结束。
- 未下包且时间耗尽 CT 胜。
- 下包后必须进入守包 / 拆包 / 残局或直接结算。
- LLM 不能绕过硬条件写 winner。
- 胜负发生时间可早可晚，但原因必须落在硬条件中。
- 最终 roundWinType 与节点事实一致。

禁止：

- 不用 scorecard 或 proof score 直接决定 winner。
- 不用随机数翻 winner。
- 不用导演组直接改 winner。

### 阶段 N8：RoundReportBridge 与兼容运行

目标：

- 节点化事实能桥接到现有 RoundReport、replay、Web progress。
- 旧路径保留 fallback。

预期新增：

- `node-round-report-bridge.ts`

行为：

- 把节点状态轨迹写入 RoundReport 扩展字段。
- 生成兼容当前前端的 summary / combat / judge view。
- 标记 `source = node_round_engine_shadow` 或 `node_round_engine_committed`。

验收：

- 旧前端不崩。
- 新 artifact 能看到节点阶段轨迹。
- 失败时能回退旧路径。
- RoundReport 能保留节点化 trace 的引用。
- replay 能至少展示节点化摘要，不需要第一版完整 UI。
- recovered failure 不应被写成 terminal latest_error。

禁止：

- 不让前端伪造 HP / 护甲 / 精确道具落点。
- 不让 bridge 反向修改节点事实。

### 阶段 N9：Dust2 单图实验启用

目标：

- 只在 Dust2 单图启用节点化 shadow 实验入口。
- 通过本地脚本跑出完整节点化 shadow report。
- 不扩展 BO3 和其他地图。
- 不写 DB，不接 Web，不替换旧回合路径。

验收：

- `scripts/phase20-node-shadow-round.mjs` 可运行。
- 输出 `source = node_round_engine_shadow`。
- 输出 phaseCount、final win condition、active node count、是否提前结束。
- report audit 明确 `writesDb = false`、`replacesLegacyRoundPath = false`。
- 至少一次 deterministic Dust2 shadow round 完成。
- 经济状态能影响行动能力。
- 商业意图进入节点冲突。
- 旧路径完全不受影响。
- shadow report 能审计每个阶段的节点状态、AP、局部裁判和胜负条件。

禁止：

- 不扩展到其他地图。
- 不扩展到完整 BO3。
- 不把一次真实样本比分当作机制成功。
- 不把 shadow report 包装成正式 RoundReport。
- 不默认调用真实 LLM。

### 阶段 N10：Node LLM Harness

目标：

- 把节点化 LLM 接入边界正式纳入母版，而不是临时口头追加。
- 第一版只让 LLM 参与局部节点裁判解释和语义碰撞增强。
- deterministic 路径继续保留。
- LLM 失败时 fallback deterministic，不阻断 shadow round。

预期新增：

- `node-llm-boundary.ts`
- `node-llm-stage-runner.ts`
- `LocalNodeJudgePipeline` 的 `llm_shadow` 模式。
- `RoundPhaseRunner` 的 LLM shadow 运行入口。
- `NodeRoundShadowReport` 的 LLM shadow audit 字段。
- `phase20-node-shadow-round.mjs --llm-shadow --max-llm-calls N`。

LLM draft 允许字段：

- `nodeId`
- `phaseId`
- `summary`
- `controlAfterCandidate`
- `businessPlanValidated`
- `businessPlanBroken`
- `riskNotes`
- `confidence`

LLM draft 禁止字段：

- final winner。
- roundWinType。
- kill ledger。
- 任意未注册 nodeId。
- DB fact。
- 经济参数修改。
- 正式 RoundReport 字段。

验收：

- 默认脚本不调用 LLM。
- `--llm-shadow` 只显式启用节点局部裁判 shadow。
- fake / fixture provider 能跑完整 shadow report。
- LLM 返回未知 nodeId 时 fallback deterministic。
- LLM 返回 winner / roundWinType 时忽略并记录 audit。
- provider 抛错时 fallback deterministic，不写 terminal error。
- report audit 显示 `llmShadowEnabled`、`llmCallsAttempted`、`llmFallbackCount`、`fallbackReasons`。
- TypeScript noEmit、package build 和节点 LLM 测试通过。

禁止：

- 不默认调用真实 LLM。
- 不接旧 `phase18_next_round`。
- 不写 DB。
- 不让 LLM 控制最终 winner。
- 不让 LLM 自由写节点、击杀、经济或正式回合事实。

### 阶段 N11：真实 LLM 局部裁判受控实验

目标：

- 在 N10 的 fake / fixture harness 通过后，开启真实 provider 的局部节点裁判受控实验。
- 真实 LLM 只用于局部节点裁判 shadow，不参与 agent action，不参与最终 winner。
- 验证真实模型是否能遵守 nodeId、phaseId、字段边界和短 JSON 输出。

预期新增：

- `phase20-node-shadow-round.mjs --llm-shadow --provider real --max-llm-calls N` 或等价显式入口。
- 真实 provider 调用审计字段：
  - provider id。
  - model id。
  - request token 估算。
  - response content length。
  - reasoning content length。
  - fallback reason。
- 真实 LLM draft 与 deterministic verdict 的对比摘要。

验收：

- 默认仍不调用真实 LLM。
- 真实 LLM 只能通过显式参数启用。
- 单回合真实 LLM shadow 调用数可限制，例如 3-5 次。
- 真实 LLM 输出未知 nodeId、winner、roundWinType、kill fact 时不会污染节点状态。
- fallback 不阻断 shadow round。
- audit 能区分：
  - `llm_draft_valid`
  - `llm_draft_repaired`
  - `llm_draft_rejected`
  - `provider_error`
  - `reasoning_exhausted`
  - `json_truncated`
- 至少一次真实 LLM shadow round 能完成 report，或明确记录外部网络 / provider 阻断。

禁止：

- 不把真实 LLM shadow 写入 DB。
- 不让真实 LLM 控制 winner。
- 不把真实 LLM 失败包装成机制失败。
- 不绕过 provider / 安全策略。
- 不为了通过测试放宽 nodeId 或 phase 校验。

### 阶段 N12：节点化旁路审计接入旧运行链路

目标：

- 把节点化 shadow report 作为旧 `phase18` 运行链路的旁路审计信息接入。
- 旧正式回合仍由旧路径提交。
- 节点化路径只用于比较、诊断和调试，不改变 winner、score、经济和 round commit。

预期新增：

- 旧 run 可关联一个 node shadow report artifact。
- `phase18-run-audit.mjs` 能识别 node shadow report。
- Web progress 或 run audit 能展示：
  - 是否存在 node shadow。
  - shadow phase 数。
  - shadow final hard condition。
  - deterministic / LLM shadow 状态。
  - fallback count。
  - 与正式 round winner 是否冲突。

验收：

- 普通 `phase18_next_round` 仍可不用 node shadow 运行。
- 显式启用旁路审计时，旧 round commit 不受影响。
- node shadow failure 不会写成正式 latest_error。
- 旧 run audit 能列出 node shadow 状态和失败原因。
- 不存在长期 started 的 node LLM call。
- recovered node shadow failure 可见。

禁止：

- 不用 node shadow 改正式 winner。
- 不用 node shadow 改正式 economy delta。
- 不把旁路审计失败升级成正式 run terminal failure。
- 不把 node shadow report 伪装成旧 RoundReport。

### 阶段 N13：前端节点化展示适配

目标：

- 让 Web 前端能理解并展示节点化 shadow / experimental 结果。
- 前端只展示审计和轨迹，不伪造节点事实。
- 用户能看懂一回合如何从地图节点、时间阶段、AP、经济资源和局部裁判推进到硬胜负条件。

预期新增或修改：

- Web progress 显示 node shadow 状态：
  - deterministic / LLM shadow。
  - phase count。
  - fallback count。
  - latest fallback reason。
- Round / report 页面增加节点化 shadow 区域。
- 第一版前端可以先做文本 / 表格展示，不强制立即画完整交互地图。
- 展示维度：
  - 时间阶段。
  - 活跃节点。
  - 每个节点攻守人数。
  - 控制权变化。
  - agent 当前节点、目标节点、行动类型、AP 消耗。
  - businessIntent。
  - local verdict summary。
  - hard win condition。
  - LLM shadow audit。

后续可视化方向：

- Dust2 graph 小地图。
- 节点连线。
- 当前 phase 高亮。
- 攻守人数 badge。
- AP 消耗条。
- 局部裁判解释面板。
- deterministic 与 LLM shadow 对比视图。

验收：

- 旧 Web 控制台不崩。
- 没有 node shadow 的旧 run 仍正常显示。
- 有 node shadow 的 run 能看到 `source = node_round_engine_shadow`。
- 用户能按 phase 查看节点行动和局部裁判。
- 前端不允许手工推断未在 artifact 中存在的击杀、HP、装备或胜负事实。
- Web 能显示 node shadow fallback reason。

禁止：

- 不让前端伪造节点事实。
- 不在前端重新计算 winner。
- 不把 shadow 结果当正式结果展示。
- 不为了好看隐藏 fallback / rejected draft。

### 阶段 N14：LLM 阶段行动 Shadow Harness

目标：

- 在局部裁判真实 LLM shadow 验证后，再让 LLM 参与 agent phase action。
- LLM 生成阶段行动，但代码继续负责 nodeId、phase、AP、经济和合法性校验。
- deterministic action pipeline 继续作为 fallback。

预期新增：

- `node-agent-action-boundary.ts`
- `node-agent-action-stage-runner.ts`
- `AgentPhaseActionPipeline` 的 `llm_shadow` 模式。
- 每 phase 合并行动请求，避免每个 agent 单独调用。

LLM agent action 必填：

- `agentId`
- `currentNodeId`
- `targetNodeId`
- `actionType`
- `apCost`
- `businessIntent`
- `riskAssessment`
- `expectedResult`

LLM agent action 禁止：

- kill fact。
- final winner。
- 经济参数修改。
- 不存在 nodeId。
- 当前 phase 不可达节点。
- AP 超支且无明确降级。

验收：

- 默认仍 deterministic。
- 显式 `llm_shadow` 才启用 agent action LLM。
- LLM 输出 nodeId 经过 graph validator。
- LLM 输出 AP 经过 AP validator。
- LLM 输出 actionType 经过 economy resources 约束。
- 低资源 agent 不能生成完整高配爆弹。
- 按兵不动仍是合法行动。
- LLM 无效时 fallback deterministic。
- 每回合调用数仍控制在预算内。

禁止：

- 不让每个 agent 每个 phase 默认单独调用。
- 不让 LLM 输出击杀或最终胜负。
- 不放宽 AP / graph / economy 校验。

### 阶段 N15：Dust2 节点化 experimental committed round

目标：

- 在 N11-N14 shadow 通过后，开启 Dust2 单回合 experimental committed path。
- 该路径只在显式模式下运行。
- 第一版只提交单回合节点化结果，不扩完整地图。
- 旧路径保留 fallback。

预期新增：

- 新 run mode，例如 `phase20_node_round_experimental`。
- Node round committed artifact。
- 与旧 RoundReport 的兼容 bridge。
- Web 控制区显式入口，默认隐藏或标记实验。

验收：

- 一次 Dust2 node round 可正式提交。
- winner 来自 `WinConditionMaterializer` 硬条件。
- RoundReport 能引用 node trace。
- Web 能展示 node trace。
- 旧 `生成当前地图` 和 `一直生成` 不受影响。
- 节点化提交失败时能回退或明确 terminal，不污染旧 run。

禁止：

- 不默认替换旧 `phase18_next_round`。
- 不扩 BO3。
- 不扩其他地图。
- 不把 shadow report 直接当 committed report。
- 不绕过 hard win condition。

### 阶段 N16：Dust2 节点化完整地图灰度验收

目标：

- 在单回合 experimental committed path 稳定后，进行 Dust2 单图完整地图灰度。
- 验证节点化路径能跨回合继承经济、状态摘要、coach/review 输入和前端展示。
- 该阶段才允许把节点化路径作为“真实测试”的主要对象。

验收：

- 至少一张 Dust2 节点化完整地图可完成，或明确因外部 provider / 网络失败而中止。
- 每回合都有 node trace。
- 每回合经济能继承。
- 每回合 AP、agent action、local verdict、win condition 可审计。
- 至少出现一种提前结束条件。
- 至少出现一次下包 / 拆包 / 守包相关硬条件。
- 前端可查看完整地图节点化轨迹。
- 旧路径仍可手动运行对照。
- 生成质量评估不只看比分，而看：
  - node 合法性。
  - AP 合法性。
  - 商业意图质量。
  - 局部裁判是否守边界。
  - 经济是否以资源约束方式影响行动。
  - hard win condition 是否可信。

禁止：

- 不把单一样本比分当作机制成功或失败。
- 不为了让地图结束而硬控 winner。
- 不用节点化灰度结果直接覆盖旧主线。
- 不在该阶段扩 16 队、BO3 或其他地图。

### 阶段 N17：Dust2 区块地图层与 Node Lab 验收台

目标：

- 把当前 39 个细节点的展示，升级为 Dust2 真实地图分区块展示。
- 第一层只展示 10-15 个关键区块，避免前端堆叠和验收困难。
- 细节点继续保留在 graph 和 trace 中，但不作为第一屏主展示。
- Node Lab 成为新引擎验收台，而不是旧 Phase18 控制台的附属按钮。

建议第一版区块：

| 区块 | 覆盖细节点 | 主要意义 |
|---|---|---|
| T Spawn | `t_spawn` | T 方开局与分路起点。 |
| Outside Tunnels | `outside_tunnels` | B 洞集合与慢摸前置区域。 |
| B Tunnels | `upper_tunnels`、`lower_tunnels`、`b_tunnel_exit` | B 区进攻通道。 |
| B Site | `b_site`、`b_default`、`b_back_site`、`b_plat`、`b_big_box`、`b_fence`、`b_car`、`b_headshot` | B 点主交火、下包、守包区。 |
| B Doors / Window | `b_doors`、`b_window` | CT 回防、B 点信息交换与夹击入口。 |
| CT / Mid Doors | `ct_spawn`、`mid_doors` | CT 回防枢纽和中门争夺。 |
| Top Mid / Mid | `top_mid`、`mid`、`xbox`、`green`、`suicide` | 中路控图、夹 B、夹 A 的核心区。 |
| Cat / Short | `cat`、`short_stairs`、`a_short` | A 小控制和 A 点进攻入口。 |
| Long Doors | `long_doors`、`outside_long` | A 大第一接触入口。 |
| A Long / Pit | `a_long`、`long_corner`、`blue`、`pit`、`a_car` | A 大推进、防守反清、长距离交火区。 |
| A Site | `a_default`、`a_ramp`、`a_safe`、`a_quad`、`a_goose`、`a_ninja`、`a_lift` | A 点下包、守包、回防区。 |

预期新增：

- `dust2-sector-layout.ts` 或等价 Web 布局配置。
- `dust2-sector-map.ts` 或 materials 资产中的区块定义。
- Node Lab 区块地图组件：
  - 地图底图统一暗色处理。
  - 区块用半透明高亮表示控制状态。
  - 节点细节通过 hover / detail panel 展开。
- 区块级 progress：
  - round 进度条。
  - phase 进度条。
  - 当前区块状态。
  - fallback / rejected draft 标记。

验收：

- 第一屏不再渲染全部 39 个细节点。
- 用户能按 round + phase 查看区块控制状态。
- 每个区块能显示：
  - attack 人数。
  - defense 人数。
  - 控制权。
  - 是否交火。
  - 是否触发胜负检查。
  - 是否有 LLM fallback / rejected draft。
- 前端区块全部来自 graph / sector asset，不手写不存在点位。
- 没有 node trace 的旧 run 正常显示。
- Next build 和 Node Lab tests 通过。

禁止：

- 不在前端重新计算 winner。
- 不让前端伪造击杀、HP、装备、包状态。
- 不把区块图做成新的事实来源。
- 不删除细节点 graph；第一版只是展示分层。

### 阶段 N18：AP 真实化与行动合法性收口

目标：

- 让 AP 点数从展示字段变成真实比赛约束。
- AP 必须和地图距离、行动类型、装备负担、经济资源、角色职责挂钩。
- AP 不直接决定对枪胜负，但决定“能不能做、能做多少、是否需要降级”。

预期新增或扩展：

- `node-action-point-rules.ts`
- `node-action-validator.ts`
- `node-route-cost-service.ts`
- AP 审计字段：
  - `routeCost`
  - `actionCost`
  - `utilityCost`
  - `roleModifier`
  - `loadoutModifier`
  - `overBudgetReason`

第一版 AP 规则：

| 行动 | AP 成本 | 约束 |
|---|---:|---|
| 保持位置 / 架枪 | 0-1 | 合法低成本动作，可连续出现。 |
| 沿相邻边移动 | 1 / edge | 必须通过 graph route。 |
| 抢信息 / peek | 1 | 可能提高局部风险。 |
| 丢基础道具 | 1 | 需要 `utilityTier` 支持。 |
| 完整爆弹 / execute utility | 2 | 需要 buy resource 支持。 |
| 进点 / retake | 2 | 需要站位和资源条件。 |
| 下包 / 拆包 | 2 | 只能发生在合法包点和合法 phase。 |
| 大范围转点 | route cost + 1 | 超 AP 必须降级或推迟。 |

AP 与资源挂钩：

- `full_eco`：基础 AP 可保留，但禁止高配道具和复杂 execute。
- `pistol / force`：允许局部抢点和低配道具。
- `rifle / awp / full_buy`：允许完整默认、进点、回防。
- AWP / 重装备可增加移动或转点负担，但不直接降低胜率。
- entry / lurker / support / awper / IGL 可有轻量 role modifier。

验收：

- LLM 输出的 action 必须经过 AP validator。
- 超 AP 行动不会直接进入 node trace，必须降级或 fallback。
- T 默认阶段不能靠高 AP 直接跳到包点。
- 大范围转点必须消耗 route cost。
- 低经济 agent 不能通过 LLM 写完整高配爆弹。
- AP 审计在 Node Lab 可见。
- 测试覆盖 route cost、action cost、utility cost、over budget fallback。

禁止：

- 不把 AP 做成完整桌游复杂系统。
- 不让 AP 随机影响 winner。
- 不用 AP 暗中控分。
- 不为了让 LLM 输出通过而放宽 route / phase / economy 校验。

### 阶段 N19：队伍资产、角色分工与商业底色深接入

目标：

- 让队伍材料不再只是 prompt 背景，而是进入节点化行动选择。
- 队伍 strategy、initial proposal、coach context、agent role、商业分工必须影响 phase action。
- 每个行动仍然保留 CS 动作与商业计划意图的双重表达。

预期新增或扩展：

- `team-node-strategy-adapter.ts`
- `agent-role-node-profile.ts`
- `node-business-intent-materializer.ts`
- `coach-node-context-adapter.ts`

输入资产：

- team strategy。
- Dust2 initial proposal。
- coach context。
- agent profile。
- role / task 分工。
- 经济状态。
- 当前节点状态和上一 phase 结果。

角色映射：

| CS 角色 | 节点化职责 | 商业分工映射 |
|---|---|---|
| IGL | 路线选择、转点、资源调度 | 战略 / 管理 / 资源配置 |
| Entry | 第一接触、进点、承担高风险 | 市场切入 / 首批验证 |
| Support | 道具、补枪、协作动作 | 运营 / 交付 / 协同 |
| Lurker | 控图、断后、信息差 | 渠道 / 竞品观察 / 长尾机会 |
| AWPer | 关键角度、威慑、保枪 | 技术壁垒 / 高价值能力 |
| Anchor | 守点、拖延、信息反馈 | 稳定运营 / 风险防守 |

验收：

- agent action 不再只有 generic `map_control`，必须体现角色职责。
- businessIntent 必填，且不能是空泛口号。
- 队伍 strategy 能影响 route / target sector / risk profile。
- coach context 能进入 timeout / review，但不直接改 winner。
- 同一 agent 在不同角色下的合法 action 倾向不同。
- 队伍资产缺失时有明确 fallback，不编造 role。
- 测试覆盖 role adapter、strategy adapter、business intent materializer。

禁止：

- 不按队伍名硬编码强弱。
- 不让商业意图替代 CS 合法性。
- 不让 coach 直接改 round winner。
- 不把所有 agent 都生成同质化行动。

### 阶段 N20：真实 LLM 输出稳定化与调用粒度升级

目标：

- 让真实 LLM 真正产生可采纳的阶段行动和局部裁判，而不是大量 JSON 截断后 fallback。
- 在“不担心成本”的前提下，优先提高有效输出率和博弈质量。
- 调用粒度从“整 phase 合并调用”升级为“关键区块 / 关键冲突调用”，但仍保留上限和审计。

预期新增或扩展：

- `node-llm-budget-policy.ts`
- `node-llm-request-compressor.ts`
- `node-llm-output-contract.ts`
- `node-llm-call-router.ts`
- Node Lab LLM call timeline。

调用策略：

- 默认不再强行每 phase 只调用 2 次。
- 第一优先级调用 contested / high-impact sector。
- 低影响 agent 可沿用 deterministic / hold action。
- 每个区块调用输入只包含：
  - 当前区块状态。
  - 相邻区块摘要。
  - 参与 agent 资源。
  - 上一 phase 结果。
  - 允许 actionType。
  - 输出 schema 最小形状。
- repair / finalizer 继续禁用思考或低预算。
- 主行动生成可保留推理，但最终 content 必须短 JSON。

稳定性要求：

- 输出字段短。
- 每次只输出本区块或本小组。
- 不输出完整 round narrative。
- 不输出 winner。
- 不输出 kill ledger，除非 N21 已接入 combat materializer 的受控 schema。
- JSON 截断时可缩小 scope 重试，不无限扩 token。

验收：

- real provider 模式下，agent action draft accepted rate 明显高于 N16 基线。
- `json_truncated` 不再长期导致 100% fallback。
- Node Lab 可显示每次真实 LLM 调用：
  - scope。
  - sector。
  - accepted / rejected。
  - fallback reason。
  - content length。
  - reasoning length。
- `providerMode=real` 的完整地图可完成至少一个小上限样本。
- 测试覆盖 truncated fallback、unknown node rejection、over AP rejection、short contract acceptance。

禁止：

- 不为了通过而关闭所有校验。
- 不让 LLM 直接写最终 winner。
- 不让 LLM 自由发明 node / sector。
- 不把失败隐藏成成功。

### 阶段 N21：战斗与交火物化系统

目标：

- 补齐当前节点化引擎最明显缺口：交火不产生可靠伤亡，导致胜负大量 timeout。
- 让局部交火从“controlAfter 文案”升级为可审计的 combat fact。
- 战斗结果由代码和 LLM 共同产生：LLM 给局部碰撞解释和候选，代码根据人数、位置、经济、AP、角色、节点优势物化合法结果。

预期新增：

- `node-combat-materializer.ts`
- `node-engagement-resolver.ts`
- `node-casualty-ledger.ts`
- `node-combat-balance-rules.ts`

输入：

- 同一区块攻守人数。
- actionType。
- weaponTier / utilityTier。
- AP 投入。
- 节点默认优势。
- 信息优势。
- 角色。
- 商业意图是否被验证 / 破坏。
- LLM local judge draft。

输出：

- `engagementOccurred`
- `casualties`
- `survivors`
- `damageSummary`，第一版可不用 HP。
- `tradeSummary`
- `controlAfter`
- `evidence`

第一版可接受简化：

- 不做逐发子弹。
- 不做 HP / armor 精算。
- 只做人数变化、击杀归因、trade 关系和控制权。
- 允许 5v2 被反打，但必须有节点、资源、信息或商业漏洞证据。

验收：

- 至少一部分回合能因 elimination 提前结束。
- local verdict casualties 不再长期为空。
- casualties 中 agentId 必须来自 active agents。
- 死亡 agent 后续 phase 不能继续行动。
- trade / survivor 能进入 node trace。
- combat fact 能被 RoundReportBridge 展示。
- 不因战斗物化破坏旧 Phase18 主线。

禁止：

- 不随机生成击杀。
- 不按队伍名补偿击杀。
- 不让 LLM 直接写未经校验的 kill ledger。
- 不把商业文案直接等同击杀事实。

### 阶段 N22：下包、拆包、守包与残局物化系统

目标：

- 补齐 timeout 之外的核心 CS 胜负方式。
- 让下包、拆包、守包、包炸、残局成为 node trace 中的明确状态链。
- 解决当前 `bombState=not_planted -> timeout` 过多的问题。

预期新增：

- `node-bomb-state-materializer.ts`
- `node-post-plant-runner.ts`
- `node-clutch-resolver.ts`
- `node-defuse-rules.ts`

状态：

- `bombState = not_planted | planting | planted | defusing | defused | exploded`
- `plantedNodeId`
- `plantStartedByAgentId`
- `plantCompletedByAgentId`
- `defuseStartedByAgentId`
- `defuseCompletedByAgentId`
- `postPlantControl`
- `retakePressure`

规则：

- 下包只能在 A/B 合法包点区块。
- 下包需要合法 phase、活着的 T agent、足够 AP、包点控制或 contested 条件。
- 拆包需要活着的 CT agent、到达 planted node、足够 AP、局部控制条件。
- 包炸需要 planted 后进入守包 / 残局且未成功 defuse。
- 残局可以通过全歼、拆包、包炸结束。

验收：

- 完整地图样本不再全部 `timeout`。
- 至少出现：
  - `bomb_exploded`
  - `defuse`
  - `elimination`
  - `timeout`
  中的多种 win type。
- bomb state 在每个 phase 可审计。
- 下包 / 拆包 action 必须经过 AP、node、phase、alive agent 校验。
- 前端区块图能显示 bomb state。

禁止：

- 不让 LLM 直接写 `bomb_exploded` 或 `defuse`。
- 不允许非包点下包。
- 不允许 dead agent 下包 / 拆包。
- 不为了减少 timeout 硬塞 plant。

### 阶段 N23：经济系统深接入与跨回合资源闭环

目标：

- 让经济真正持续影响节点化比赛，而不是只作为行动说明或购买标签。
- 每回合经济继承、掉枪、发枪、保枪、下包奖励、拆包奖励、连败奖励、买型选择都进入节点化资源层。
- 经济影响行动能力、道具能力、风险选择和 AP 效率，但不直接决定 winner。

预期新增或扩展：

- `node-economy-state-bridge.ts`
- `node-loadout-materializer.ts`
- `node-drop-plan-materializer.ts`
- `node-save-weapon-rules.ts`
- `node-economy-audit.ts`

关键行为：

- 每回合开始读取上一回合经济状态。
- team 可共享经济信息和买型讨论。
- agent 只能使用个人金钱、获得 drop 或保留装备。
- full_eco / force / half / rifle / awp buy 映射到 loadout package。
- save 行为会影响下一回合资源。
- 下包 / 拆包 / 胜负奖励进入下一回合。
- overtime 经济不错误重置为 full_eco。

与 AP / 战斗联动：

- utilityTier 影响可用道具行动。
- weaponTier 影响交火候选质量。
- armor / rifle / awp 影响风险能力。
- 低经济不等于必败，但必须改变合理策略。
- 高经济不等于必赢，但允许复杂 execute / retake。

验收：

- 连续地图中经济状态每回合继承。
- eco round 不生成完整高配爆弹。
- full buy round 能生成完整默认和进点资源。
- save weapon 能影响下一回合。
- drop plan 能影响个人 loadout。
- 经济 audit 能解释每回合买型、预算、掉枪、保枪、奖励。
- 战斗和 AP 读取的是 node economy resources，而不是自由文本。

禁止：

- 不用经济直接控分。
- 不让 outputBudget 裁剪直接变成弱证据。
- 不按队伍名补钱。
- 不让经济系统重回 engine.ts。

### 阶段 N24：真实 LLM 节点化完整地图验收与旧引擎对照封板

目标：

- 用真实 LLM 跑 Dust2 节点化完整地图，验证新引擎是否形成真正博弈。
- 将旧 Phase18 整回合引擎定位为 fallback / 对照路径，而不是继续承载节点化核心。
- 形成进入下一阶段前的封板报告。

验收维度：

- 地图能完成。
- LLM 真实参与 agent action 和 local judge，且 accepted rate 达到可用水平。
- win type 不再长期单一 timeout。
- 至少出现多种硬胜负：
  - elimination。
  - timeout。
  - bomb_exploded。
  - defuse。
- AP 超支率可控，超支有降级或 fallback。
- 经济状态连续继承。
- 队伍 role / strategy / coach context 可在行动中被看见。
- 商业意图不是空话，能被局部裁判验证或破坏。
- 区块地图能显示 round / phase / node state / bomb state / combat state。
- 旧 Phase18 仍可作为 fallback 手动运行。
- 审计能区分：
  - provider failure。
  - schema failure。
  - AP invalid。
  - graph invalid。
  - combat materialization failure。
  - bomb materialization failure。

预期交付：

- `node-engine-readiness-report.md`
- N17-N24 测试矩阵。
- Node Lab 验收截图 / artifact 索引。
- 旧引擎保留与剥离策略：
  - 保留旧 Phase18 作为 fallback。
  - 禁止继续向旧 engine 链路加入节点化新逻辑。
  - 将旧 judge/combat/broadcast 逐步降级为对照和回放兼容。

禁止：

- 不把单局样本包装成完全成功。
- 不因真实 LLM 失败回退到假成功。
- 不在 N24 扩 BO3 / 其他地图 / 16 队。
- 不删除旧引擎 fallback，除非已有明确替代和回滚方案。

## 8. 与原阶段 0-8 的映射

| 原阶段 | 当前状态 | 节点化计划影响 |
|---|---|---|
| 阶段 0：基线保护 | 基本完成 | N0 完成后应提交文档和资产基线。 |
| 阶段 1：LLM stage runner | 基本稳定 | N5 / N6 复用 stage runner，不重写 provider。 |
| 阶段 2：LLM boundary | 基本稳定 | N5 / N6 新增阶段行动和局部裁判边界。 |
| 阶段 3：Economy/Output | 已拆分 | N3 把经济转为资源约束层。 |
| 阶段 4：JudgePipeline | 第一版完成 | N6 新增局部裁判，不回到整回合 winner-first。 |
| 阶段 5：scorecard fallback | 基本完成 | 节点化路径后续减少对 scorecard fallback 的依赖。 |
| 阶段 6：攻守/比分诊断 | 基本完成 | 节点化后通过路线、时空、AP 解释偏置来源。 |
| 阶段 7：CoachService | 基本完成 | 后续 coach 可读取节点轨迹做 timeout / review。 |
| 阶段 8：真实生成验收 | 外部网络有波动 | N11 开始真实 LLM shadow；N15 开始 experimental commit；N16 完成完整地图灰度；N17-N24 用于让灰度路径具备真实博弈质量。 |

## 9. 验证策略

每阶段必须有自动验证和人工验收。

自动验证：

- JSON 资产解析。
- schema parse。
- node graph route validation。
- phase reachability validation。
- AP budget validation。
- economy adapter validation。
- local judge output validation。
- win condition materialization。
- RoundReport bridge compatibility。
- TypeScript noEmit。
- package build。

人工验收：

- 查看 Dust2 节点图是否符合地图直觉。
- 查看 T / CT 阶段可达是否合理。
- 查看 agent 行动是否既有 CS 动作，也有商业意图。
- 查看节点状态是否连续推进。
- 查看局部裁判是否只裁节点事实。
- 查看最终 winner 是否来自硬条件，而不是 judge 直接写死。
- 查看 Dust2 区块地图是否符合真实地图空间关系。
- 查看 AP 是否真实限制移动、道具、下包、拆包、转点和回防。
- 查看经济是否按回合继承，并通过资源能力影响行动。
- 查看队伍资产、agent role、coach context 和商业分工是否进入行动。
- 查看战斗、下包、拆包、守包、残局是否形成可审计事实链。
- 查看真实 LLM 调用是否有 accepted / rejected / fallback 记录。

### 9.1 每次计划模式必须引用的检查项

后续任何节点化相关计划必须写清：

- 当前处于 N0-N24 哪一阶段。
- 本轮要完成哪个阶段，哪些阶段不碰。
- 是否修改旧回合路径。
- 是否影响 `engine.ts`。
- 是否影响 Economy/Output 规则。
- 是否影响 JudgePipeline。
- 是否调用真实 LLM。
- 是否影响 Web / 前端节点化展示。
- 是否影响 AP、战斗、下包、经济继承或队伍资产接入。
- 自动验证命令。
- 人工验收流程。
- 回滚策略。

如果计划没有这些内容，不能视为合格计划。

## 10. 风险与替代方案

风险：

- 节点化一次性切换会破坏当前稳定生成。
- AP 模型过重会变成新屎山。
- 经济 adapter 如果设计不清，会继续暗中影响 winner。
- 局部裁判调用增多会提高 LLM 失败率。
- 地图节点过细会导致 prompt 过胖。

对策：

- 先 shadow mode，不直接提交 winner。
- AP 第一版只做轻量合法性约束。
- 每回合只激活 3-5 个关键节点。
- 只让关键 agent 展开，其他 agent 可继承保持动作。
- 旧路径保留 fallback。
- 每阶段完成后再推进下一阶段。

替代方案：

- 如果节点化 LLM 成本过高，先用代码生成 agent phase action，再让 LLM 只做局部裁判。
- 如果局部裁判不稳定，先让局部裁判只输出结构化诊断，不影响状态更新。
- 如果 economy adapter 风险高，先只输出资源说明，不参与 AP。
- 如果 RoundReport bridge 太大，先只写 artifact，不进前端。

禁止尝试：

- 不在 engine.ts 中重建巨型节点逻辑。
- 不让 LLM 自己猜节点路线。
- 不让局部裁判直接写最终 winner。
- 不用经济直接控分。
- 不通过随机数制造翻盘。
- 不让 action points 变成完整桌游系统。
- 不一次性替换旧生成路径。
- 不用“节点化”名义重做大一统 engine。

## 11. 成本与调用预算

当前 OpenCode Go 截图显示，`deepseek-v4-flash` 单次调用成本大致在低千分之一美元级别。60 美元月额度足够支持实验，但仍需控制失败率和调用数。

节点化预算原则：

- N0-N16 阶段不以 request 数无限扩展为默认策略。
- N0-N16 每回合目标控制在约 8-16 次 LLM 调用，用于验证结构和边界。
- N17-N24 阶段以“形成真实博弈和提高可采纳输出率”为优先级，可以提高调用粒度。
- 每个时间点优先双队合并行动，或双方各一次行动。
- 局部裁判每个时间点一次。
- 非关键 agent 使用继承 / 保持位置 / 代码模板，减少无效调用。
- repair 和 finalizer 保持短输入、短输出。
- N0-N10 优先本地 deterministic / fixture 测试。
- N11 才允许真实 LLM 局部裁判 shadow。
- N14 才允许真实 LLM agent phase action shadow。
- N15 才允许节点化 experimental committed round。
- N16 才允许 Dust2 完整地图灰度。
- N17 才将前端验收切到 Dust2 区块地图层。
- N18 才让 AP 成为硬行动约束。
- N20 才允许按关键区块 / 关键冲突提高真实 LLM 调用粒度。
- N24 才做真实 LLM 节点化完整地图封板验收。

如果未来成本上升，优先减少 LLM 参与节点或降低低价值区块调用，而不是放宽 graph、AP、economy、combat、bomb 校验。

## 12. 观测与审计要求

节点化路径必须从第一版开始保留审计能力。

每个节点化 round 至少要能审计：

- 使用的 node graph 版本。
- 每个 phase 的 id 和名称。
- 每个 phase 的活跃节点。
- 每个 agent 的当前节点、目标节点、行动类型和 AP 消耗。
- 经济 adapter 输出摘要。
- 局部裁判输入和输出 artifact。
- 节点状态变化。
- 触发或未触发的胜负条件。
- fallback 或 recovered failure。

这些信息可以先写 artifact，不必第一版全部进前端。

## 13. 需要保留但暂不解决的问题

以下问题已经被识别，但不应阻塞 N17-N24 主线：

- 完整 HP / 护甲 / 枪械弹道。
- 每颗道具的物理落点和精确持续时间。
- 更真实的个人枪法差异。
- BO3 长期版本演化。
- 16 队扩展。
- 最终比分平衡和地图攻守微调。
- 其他地图的区块化资产。
- 更精细的道具轨迹和烟闪持续时间。

这些问题应该在 Dust2 节点化完整地图能形成可信博弈后按专项处理。

## 14. 当前下一步建议

当前 N0-N16 已完成第一版，节点化路径已经具备：

- Dust2 node graph。
- schema / graph service。
- economy resource adapter。
- phase runner。
- deterministic / LLM shadow。
- experimental committed round。
- Dust2 full map gray validation。
- Node Lab 初版。

但 N16 仍暴露出核心质量缺口：

- 前端展示仍偏节点堆叠，不像真实 CS 地图区块。
- AP 仍偏审计字段，没有成为足够强的行动合法性系统。
- 队伍资产、角色分工、商业分工进入行动还不够深。
- 真实 LLM 已接入，但 action draft 仍存在 `json_truncated` 和低采纳率。
- 战斗伤亡、下包、拆包、残局物化不足，导致 win type 容易集中在 `timeout`。
- 经济继承已有基础，但还没有与 loadout、drop、save、AP、战斗充分闭环。

下一步不得继续临时口头新增阶段。后续推进必须从本文件的 N17-N24 中选择。

建议顺序：

1. 先进入 N17：
   - 把 Node Lab 从抽象节点图升级为 Dust2 区块地图验收台。
   - 使用 10-15 个大区块作为第一层展示。
   - 保留细节点 trace，但不再让第一屏堆满 39 个节点。

2. N17 通过后进入 N18：
   - 做 AP 真实化。
   - 让移动、转点、道具、下包、拆包、回防真正受 AP 约束。

3. N18 通过后进入 N19：
   - 深接队伍 strategy、initial proposal、coach context、agent role。
   - 让队伍分工和商业底色真正影响节点行动。

4. N19 通过后进入 N20：
   - 专项解决真实 LLM 输出稳定性。
   - 提高 agent action draft 采纳率，降低 JSON 截断。
   - 将调用粒度升级为关键区块 / 关键冲突，而不是粗糙整 phase。

5. N20 通过后进入 N21：
   - 做战斗和交火物化。
   - 让 contested node 能产生 casualties、trade、survivor、controlAfter。

6. N21 通过后进入 N22：
   - 做下包、拆包、守包、包炸、残局物化。
   - 解决 win type 长期 timeout 的结构问题。

7. N22 通过后进入 N23：
   - 做经济系统深接入。
   - 让 drop、save、loadout、奖励、连败、买型影响 AP、战斗和行动能力。

8. N23 稳定后进入 N24：
   - 做真实 LLM 节点化完整地图封板验收。
   - 明确旧 Phase18 作为 fallback / 对照路径。

真正测试口径：

- N16 后可以测试：Dust2 节点化完整地图是否能跑完。
- N17 后可以测试：前端是否能按 CS 地图区块验收。
- N18 后可以测试：AP 是否真实限制行动。
- N19 后可以测试：队伍资产和角色分工是否真正进入比赛。
- N20 后可以测试：真实 LLM agent action 是否稳定可采纳。
- N21 后可以测试：交火是否产生可信伤亡和控制权变化。
- N22 后可以测试：胜负方式是否不再长期 timeout。
- N23 后可以测试：经济是否形成跨回合资源闭环。
- N24 后可以测试：真实 LLM Dust2 节点化完整地图是否具备进入下一阶段的质量。

## 15. 阶段完成记录要求

后续每次推进必须输出：

| 节点化阶段 | 计划前状态 | 本轮目标 | 实际结果 | 证据 |
|---|---|---|---|---|
| N0 | 待填 | 待填 | 待填 | 文档 / 资产 |
| N1 | 待填 | 待填 | 待填 | schema / tests |
| N2 | 待填 | 待填 | 待填 | graph service |
| N3 | 待填 | 待填 | 待填 | economy adapter |
| N4 | 待填 | 待填 | 待填 | shadow runner |
| N5 | 待填 | 待填 | 待填 | phase actions |
| N6 | 待填 | 待填 | 待填 | local judge |
| N7 | 待填 | 待填 | 待填 | win materializer |
| N8 | 待填 | 待填 | 待填 | report bridge |
| N9 | 待填 | 待填 | 待填 | Dust2 shadow experiment |
| N10 | 待填 | 待填 | 待填 | node LLM harness |
| N11 | 待填 | 待填 | 待填 | real LLM local judge shadow |
| N12 | 待填 | 待填 | 待填 | legacy run sidecar audit |
| N13 | 待填 | 待填 | 待填 | frontend node shadow viewer |
| N14 | 待填 | 待填 | 待填 | LLM agent phase action shadow |
| N15 | 待填 | 待填 | 待填 | experimental committed node round |
| N16 | 待填 | 待填 | 待填 | Dust2 full map gray validation |
| N17 | 待填 | 待填 | 待填 | Dust2 sector map and Node Lab console |
| N18 | 待填 | 待填 | 待填 | real AP legality and route cost |
| N19 | 待填 | 待填 | 待填 | team assets, roles, coach context |
| N20 | 待填 | 待填 | 待填 | stable real LLM node actions |
| N21 | 待填 | 待填 | 待填 | combat and casualty materialization |
| N22 | 待填 | 待填 | 待填 | bomb, defuse, post-plant, clutch materialization |
| N23 | 待填 | 待填 | 待填 | economy/loadout/drop/save loop |
| N24 | 待填 | 待填 | 待填 | real LLM full map readiness and old engine fallback audit |

如果某阶段只是部分完成，必须写“部分完成”，不能包装成完成。
