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

- 只在 Dust2 单图启用节点化 experimental path。
- 不扩展 BO3 和其他地图。

验收：

- 至少一次节点化 Dust2 round 完成。
- 至少一次节点化 Dust2 round 因全歼提前结束。
- 至少一次节点化 Dust2 round 进入下包 / 守包 / 拆包阶段。
- 经济状态能影响行动能力。
- 商业意图进入节点冲突。
- 旧路径仍可手动回退。
- artifact 能审计每个阶段的节点状态、AP、局部裁判和胜负条件。

禁止：

- 不扩展到其他地图。
- 不扩展到完整 BO3。
- 不把一次真实样本比分当作机制成功。

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
| 阶段 8：真实生成验收 | 外部网络有波动 | N9 才进入真实节点化验收。 |

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

### 9.1 每次计划模式必须引用的检查项

后续任何节点化相关计划必须写清：

- 当前处于 N0-N9 哪一阶段。
- 本轮要完成哪个阶段，哪些阶段不碰。
- 是否修改旧回合路径。
- 是否影响 `engine.ts`。
- 是否影响 Economy/Output 规则。
- 是否影响 JudgePipeline。
- 是否调用真实 LLM。
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

节点化第一版预算原则：

- 不以 request 数无限扩展为默认策略。
- 每回合目标控制在约 8-16 次 LLM 调用。
- 每个时间点优先双队合并行动，或双方各一次行动。
- 局部裁判每个时间点一次。
- 非关键 agent 使用继承 / 保持位置 / 代码模板，减少无效调用。
- repair 和 finalizer 保持短输入、短输出。
- 真实 LLM 验收只在 N9 或明确需要时进行，N1-N4 优先本地 deterministic 测试。

如果未来成本上升，优先减少 LLM 参与节点，而不是放宽校验。

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

以下问题已经被识别，但不应阻塞 N1-N4：

- 完整 HP / 护甲 / 枪械弹道。
- 每颗道具的物理落点和精确持续时间。
- 更真实的个人枪法差异。
- 完整观赛 UI 的节点地图展示。
- BO3 长期版本演化。
- 16 队扩展。
- 最终比分平衡和地图攻守微调。

这些问题应该在节点化骨架稳定后按专项处理。

## 14. 当前下一步建议

当前已完成 N0 的大部分文档和资产工作。

下一步不应直接写完整节点化 runtime，而应先完成：

1. 审阅并修正 Dust2 node graph。
2. 补齐 node graph 中遗漏的重要点位或不合理连接。
3. 固化 AP 第一版动作成本表。
4. 编写 N1 Schema 层计划。
5. 执行 N1：定义类型和 validator，不接真实 LLM。

只有 N1 / N2 稳定后，才进入 N3 economy adapter 和 N4 shadow runner。

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
| N9 | 待填 | 待填 | 待填 | real Dust2 run |

如果某阶段只是部分完成，必须写“部分完成”，不能包装成完成。
