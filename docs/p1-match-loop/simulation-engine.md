# P1.4 比赛 / 地图 / 回合引擎说明（Simulation Engine）

## 1. 文档定位

这份文档定义 Agent Major 的比赛模拟引擎。它回答的问题是：

```text
系统如何从一场未开始的比赛推进到 BO3 结束？
地图禁选、地图开始、回合推进、地图结束、比赛结束分别如何发生？
每次点击“推进下一回合”时，系统内部读什么、写什么、调用什么？
回合战报、Token 经济、大模型驾驶员、事件日志之间如何串起来？
哪些步骤是同步关键路径，哪些步骤是异步转播任务？
失败时如何重试、降级、暂停和恢复？
如何不接真实 LLM，也能用假模型供应商跑完一场 BO3？
```

P1.4 的目标是把前面已经完成的契约变成一条可执行流程：

```text
领域对象 + 事件分类 + 赛制规则 + 回合战报 + Token 经济 + 大模型驾驶员
  ↓
比赛 / 地图 / 回合状态机
  ↓
可逐回合推进、可追溯、可回放、可统计、可转播的一场 BO3
```

## 2. 上游与下游

### 2.1 上游依赖

| 上游文档 | 引擎消费内容 |
|---|---|
| P0.1 领域模型 | Tournament、Team、Agent、DriverModel、Match、MapGame、Round、RoundReport、EconomyState、Event。 |
| P0.2 事件分类 | 必须写入的事件类型、事件大类、payload 骨架、可投影边界。 |
| P0.3 规则与赛制说明 | 16 队单败、BO3、地图池、地图禁选、MR6、加时、晋级规则。 |
| P1.1 回合战报契约 | AgentOutput、JudgeResult、RoundKeyEvent、RoundReport、事件投影入口。 |
| P1.2 Token 经济说明 | Agent 级经济、购买阶段、Drop、Output Gate、SubmittedOutput。 |
| P1.3 大模型驾驶员契约 | LLM Gateway、DriverModel、PromptTask、RawOutput、结构化输出、重试降级、假模型供应商。 |

### 2.2 下游消费者

| 下游模块 | 消费内容 |
|---|---|
| P1.5 本地持久化 | 需要保存的状态、事件、回合战报、原始输出、产物引用。 |
| P2.1 直播时间线 | 从事件日志中投影可播放时间线。 |
| P2.2 2D 战术地图 | 消费回合关键事件和地图区域引用。 |
| P2.3 转播系统 | 消费回合战报、事件、比分、经济变化，生成解说、弹幕、回放卡。 |
| P3 数据与奖项 | 消费 round_completed、score_updated、economy_updated、highlight_detected 等事实和派生事件。 |
| P4 API / 队列 / 可观测性 | 消费命令、任务、调用记录、失败记录、成本与延迟。 |

## 3. 引擎边界

### 3.1 本文档负责

- 定义比赛模拟引擎的职责边界。
- 定义 Match、MapGame、Round 的状态流转。
- 定义核心命令。
- 定义一回合同步流水线。
- 定义事件写入顺序。
- 定义异步任务触发边界。
- 定义地图内自动运行、回合审查窗口和地图总结审查窗口。
- 定义人工修正、技术暂停和操作员暂停的恢复边界。
- 定义失败、重试、暂停、恢复规则。
- 定义假模型供应商跑通 BO3 的路径。
- 给出一场 BO3 的最小事件序列。

### 3.2 本文档不负责

- 不定义数据库表结构。
- 不定义 API 路由。
- 不定义最终 TypeScript / Zod 实现。
- 不定义具体 prompt 文案。
- 不定义 2D 地图坐标。
- 不定义解说、弹幕、新闻文风。
- 不定义真实 API 成本统计面板。
- 不定义 Web 部署方式。

### 3.3 核心原则

```text
Simulation Engine 只产生比赛事实和必要派生任务。
Broadcast / News / Replay 可以包装事实，但不能改写事实。
TimelineEvent 是播放投影，不进入比赛判定。
真实 API 成本只进入可观测性，不进入 Token 经济。
```

## 4. 引擎分层

### 4.1 Tournament Engine

职责：

- 创建赛事级对阵。
- 推进 16 强、8 强、半决赛、决赛。
- 接收 Match 胜者。
- 创建下一轮 Match。
- 在决赛完成后写入冠军。

P1.4 只要求它能消费 Match 结果，不展开完整赛事调度细节。

### 4.2 Match Engine

职责：

- 启动 BO3。
- 执行地图禁选。
- 创建地图局。
- 接收 MapGame 胜者。
- 更新 BO3 地图比分。
- 判断比赛是否结束。
- 写入比赛结束事件。

### 4.3 Map Engine

职责：

- 按地图池和地图顺序启动地图。
- 管理 MR6 回合数、比分、换边、加时。
- 接收 Round 胜者。
- 更新地图比分。
- 判断地图是否结束。
- 写入地图结束事件。

### 4.4 Round Engine

职责：

- 执行购买阶段。
- 选择或确认 active agents。
- 构建本回合上下文。
- 调用大模型驾驶员生成 RawOutput。
- 调用 Output Gate 生成 SubmittedOutput。
- 调用 Judge。
- 生成 RoundReport。
- 拆解并写入核心事件。
- 更新回合、经济、地图比分和摘要。
- 触发异步转播任务。

Round Engine 是 P1.4 的核心。

### 4.5 Map Runner

职责：

- 在用户手动启动一张地图后，自动运行地图内回合。
- 内部循环调用 `playNextRound`。
- 每回合完成后进入审查窗口。
- 审查窗口无操作时自动继续下一回合。
- 用户暂停、技术暂停、地图完成时停止自动运行。
- 地图完成后进入地图总结审查窗口，不自动启动下一张地图。

Map Runner 是地图内自动化控制器，不替代 `playNextRound`。`playNextRound` 仍是单回合推进的底层命令。

## 5. 状态机

### 5.1 Match 状态

```text
scheduled
  -> veto
  -> running
  -> completed
```

允许失败恢复：

```text
running
  -> failed
```

操作员暂停和技术暂停不写入 Match.status，而是写入运行控制事件和 RunControlState，避免把运行控制态混入比赛生命周期。

### 5.2 MapGame 状态

```text
scheduled
  -> running
  -> completed
```

加时：

```text
running
  -> overtime
  -> running
  -> completed
```

### 5.3 Round 状态

```text
scheduled
  -> running
  -> judging
  -> completed
```

失败：

```text
running / judging
  -> failed
```

失败回合不自动跳过。第一版要求人工或重试恢复，避免比赛事实被静默污染。

回合内部执行阶段使用 RoundPhase 表示，不扩展 RoundStatus：

```text
buying
generating
output_gate
judging
reporting
committing
```

### 5.4 地图运行状态

地图内自动运行需要额外的运行状态。该状态可以先作为运行控制状态保存，不必立即扩展 P0.1 的 `MapGameStatus`。

```text
idle
  -> running_map
  -> review_window
  -> running_map
```

暂停：

```text
running_map / review_window
  -> operator_pause
  -> running_map
```

技术暂停：

```text
running_map / review_window
  -> technical_pause
  -> running_map / review_window
```

地图总结审查：

```text
map_completed
  -> map_review_window
  -> waiting_for_next_map
```

边界：

- `operator_pause` 是用户主动暂停地图自动运行。
- `technical_pause` 是系统失败或修复失败后的技术暂停。
- `map_review_window` 必须手动确认，不能自动继续到下一张地图。
- RunControlState 不参与裁判、比分、经济结算、统计或奖项。
- 已完成回合默认锁定，只允许修改当前审查窗口内的回合；已锁定回合只能通过高级修复台打开，默认不推荐。

## 6. 核心命令

### 6.1 startMatch

用途：启动一场 BO3。

前置条件：

- Match 存在。
- Match.status = `scheduled`。
- 两支队伍和队内智能体存在。
- 地图池存在。

同步动作：

```text
1. 校验 Match、Team、Agent、DriverModel。
2. 更新 Match.status = veto。
3. 写入 match_started 事件。
4. 准备地图禁选上下文。
```

输出：

- 更新后的 Match。
- `match_started` 事件。

### 6.2 completeVeto

用途：完成地图禁选，确定 BO3 地图顺序。

前置条件：

- Match.status = `veto`。
- 地图池至少 7 张。
- 双方队伍存在。

第一版禁选策略：

```text
Team A ban 1
Team B ban 1
Team A pick 1
Team B pick 1
Team A ban 1
Team B ban 1
剩余地图作为 decider
```

第一版可以用确定性假策略：

```text
按 seed 和地图顺序自动生成 bans / picks / decider。
```

同步动作：

```text
1. 生成 veto 结果。
2. 写入 map_veto_completed 事件。
3. 创建最多 3 个 MapGame，状态为 scheduled。
4. 更新 Match.status = running。
5. 等待用户手动执行 startMap。
```

输出：

- MapGame[]。
- `map_veto_completed` 事件。

### 6.3 startMap

用途：启动 BO3 中的一张地图。

前置条件：

- Match.status = `running`。
- MapGame.status = `scheduled`。
- 前置地图已完成，或这是第一张地图。
- Match 尚未有队伍赢下 2 张地图。

同步动作：

```text
1. 更新 MapGame.status = running。
2. 初始化 MapGame.teamAScore = 0，teamBScore = 0。
3. 初始化 currentRoundNumber = 1。
4. 为每个 Agent 创建地图初始 EconomyState。
5. 写入 economy_snapshot_created 事件。
6. 写入 map_started 事件。
7. 创建第一回合 Round，状态为 scheduled。
```

输出：

- 更新后的 MapGame。
- 初始 EconomyState[]。
- `map_started` 事件。
- 第一个 Round。

后续动作：

- `startMap` 只启动当前地图，不自动启动后续地图。
- 地图内自动化由 `runCurrentMap` 控制。
- 地图结束后必须等待用户在地图总结审查窗口手动确认，才能启动下一张地图。

### 6.4 runCurrentMap

用途：在当前地图内自动运行回合，直到地图结束、用户暂停或技术暂停。

前置条件：

- Match.status = `running`。
- MapGame.status = `running` 或 `overtime`。
- 地图尚未完成。
- 当前没有 running / judging 状态的未完成 Round。

运行规则：

```text
1. 调用 playNextRound 完成一个回合。
2. 投递转播包装和派生统计任务。
3. 必要时生成模板化基础 kill feed。
4. 进入回合审查窗口。
5. 审查窗口默认 15 秒，可配置。
6. 审查窗口内无操作则继续下一回合。
7. 用户点击暂停则进入 operator_pause，暂停整张地图自动运行。
8. 技术失败则进入 technical_pause。
9. 地图达到胜利条件后调用 completeMap。
10. 进入地图总结审查窗口。
11. 停止自动运行，等待用户手动确认下一张地图。
```

输出：

- 当前地图运行结果。
- 每回合的 Round / RoundReport / Event[]。
- 回合审查记录。
- 可能出现的暂停状态。

### 6.5 playNextRound

用途：推进当前地图的下一回合。

前置条件：

- Match.status = `running`。
- MapGame.status = `running` 或 `overtime`。
- 地图尚未完成。
- 当前没有 running / judging 状态的未完成 Round。

同步动作概要：

```text
1. 创建或读取 scheduled Round。
2. 写入 round_started。
3. 选择候选 active agents。
4. 执行购买阶段、Drop、Output Gate 预算计算。
5. 得到最终 active agents 和 EconomyPlan。
6. 构建回合上下文。
7. 调用 active agents 的 DriverModel 生成 RawOutput。
8. 通过 Output Gate 生成 SubmittedOutput。
9. 写入 output_gate_applied。
10. 调用 Judge 生成 JudgeResult。
11. 生成或确认 RoundKeyEvent 候选。
12. 计算 EconomyState 结算结果。
13. 生成 RoundReport。
14. 按顺序写入 judge_decision_created、score_updated、economy_updated、round_report_created、round_completed。
15. 更新 Round、MapGame、Summary。
16. 判断地图是否完成。
17. 投递回合收尾任务。
```

输出：

- Round。
- AgentOutput[]。
- JudgeResult。
- RoundReport。
- Event[]。
- 更新后的 EconomyState[]。
- 可能更新的 MapGame / Match。
- 已投递的异步包装任务列表。
- 模板化降级产物列表。

边界：

- `playNextRound` 只负责一个回合的比赛事实推进。
- `playNextRound` 可以返回 `mapShouldComplete`。
- 是否继续下一回合由 `runCurrentMap` 决定。
- 如果地图完成，`runCurrentMap` 调用 `completeMap`，然后进入地图总结审查窗口。

### 6.6 completeMap

用途：在地图达到胜利条件后结算地图。

前置条件：

- MapGame 达到胜利条件。
- 当前 Round 已 completed。

MR6 胜利条件：

```text
常规：先到 7 分。
如果 6-6：进入 overtime。
加时规则由 P0.3 定义，P1.4 只消费结论。
```

同步动作：

```text
1. 写入 MapGame.winnerTeamId。
2. 更新 MapGame.status = completed。
3. 写入 map_completed 事件。
4. 更新 Match.teamAMapsWon / teamBMapsWon。
5. 判断 Match 是否完成。
6. 如果 Match 未完成，将下一张 MapGame 保持为 scheduled。
7. 生成地图总结审查内容。
8. 进入 map_review_window。
```

输出：

- 更新后的 MapGame。
- 更新后的 Match。
- `map_completed` 事件。
- 地图总结审查窗口内容。

边界：

- `completeMap` 不自动启动下一张地图。
- 地图之间的切换必须由用户手动确认。
- 地图总结审查窗口必须手动确认，不使用 15 秒自动继续。

### 6.7 completeMatch

用途：在某队赢下 2 张地图后结算比赛。

前置条件：

- Match 中某队 mapsWon = 2。

同步动作：

```text
1. 写入 Match.winnerTeamId。
2. 更新 Match.status = completed。
3. 写入 match_completed 事件。
4. 通知 Tournament Engine 晋级胜者。
5. 触发赛后异步任务。
```

输出：

- 更新后的 Match。
- `match_completed` 事件。
- 异步任务：赛后战报、MVP 候选更新、回放卡片生成等。

### 6.8 updateSummary

用途：更新回合、地图、比赛、队伍战术记忆。

边界：

- Summary 是上下文燃料，不是事实源。
- Summary 可以基于 Event 重生成。
- Summary 更新失败不应删除或修改 Event。

同步要求：

```text
回合完成后至少更新 map_summary。
match_summary 可以按地图结束或固定回合间隔更新。
team_tactical_memory 可以异步生成。
```

## 7. 单回合流水线

### 7.1 总流程

```text
Round scheduled
  ↓
round_started
  ↓
候选 active agents 选择
  ↓
购买阶段（Economy + Drop + BuyType）
  ↓
最终 active agents + EconomyPlan
  ↓
上下文构建（Context Builder）
  ↓
Agent RawOutput 生成（LLM Driver）
  ↓
Output Gate 裁剪 SubmittedOutput
  ↓
Judge 判定
  ↓
RoundKeyEvent 候选确认
  ↓
经济结算结果计算
  ↓
RoundReport 生成
  ↓
按顺序写入 judge / score / economy / report / completed 事件
  ↓
状态更新：Round / MapGame / EconomyState / Summary
  ↓
投递异步包装任务：kill feed / caster / barrage / stats
  ↓
回合审查窗口：默认 15 秒，可配置
  ↓
继续下一回合 / operator_pause / technical_pause / map_review_window
```

### 7.2 active agents 选择

第一版建议采用确定性规则，避免引擎过早复杂：

```text
每队每回合默认激活 2 个 Agent。
关键回合可激活 3 个 Agent。
Coach 只在 timeout 或特殊策略触发时激活。
```

关键回合判定：

```text
地图点：任一队即将拿到第 7 分。
淘汰点：当前地图会决定 BO3 胜负。
经济高风险：force buy / eco 对 full buy。
加时回合。
```

输出：

- 候选 `teamAActiveAgentIds`。
- 候选 `teamBActiveAgentIds`。

后续购买阶段可根据经济、Drop 和 Output Gate 预算裁剪候选列表，得到最终 active agents。

### 7.2.1 区域化攻防回合协议（Phase 1.6 预留）

该协议把 2D 战术区域从“回合结束后的展示节点”升级为“回合开始前的战术博弈输入”。它不属于 Phase 1.45 已落地代码范围，也不阻塞 Phase 1.5 真实 LLM 小范围接入；但它会影响后续真实 LLM prompt、Judge 输入和 RoundReport 扩展，因此需要先在文档层建立边界。

核心类比：

```text
攻方 = 主动提出进攻方案的一方。
守方 = 根据资源和信息不完全做区域部署的一方。
A / B 点 = 转化目标区，不是传统炸点复刻，而是商业闭环、产品论证或运营路径的强输出战场。
中路 / 连接区 = 信息控制、转点、回防和反制区域。
Token 经济 = 决定本回合能把多少有效文本、上下文和 agent 输出投入到对应区域。
```

#### 攻守方分配

MR6 常规回合下，攻守方按半场切换：

```text
第 1-6 回合：初始攻守关系。
第 7-12 回合：换边，攻守方互换。
加时：按加时规则重新分配或沿用半场切换规则，具体由 P0.3 定义。
```

第一版可使用确定性规则：

```ts
type SideAssignment = {
  roundId: string;
  roundNumber: number;
  attackingTeamId: string;
  defendingTeamId: string;
  half: "first_half" | "second_half" | "overtime";
  sideSwitched: boolean;
};
```

#### 攻方进攻方案

攻方每回合至少需要形成一个主攻方向。它可以选择强打 A、强打 B、控中转点、假打后转点或经济局偷点。

```ts
type AttackPlan = {
  teamId: string;
  primaryTargetZoneId: string;
  secondaryTargetZoneId?: string;
  approach:
    | "fast_execute"
    | "slow_control"
    | "mid_control_then_execute"
    | "fake_then_rotate"
    | "eco_steal"
    | "default_probe";
  feintZoneId?: string;
  resourceAllocationByZone: ZoneResourceAllocation[];
  activeAgentIds: string[];
  intentSummary: string;
};
```

示例：

```text
强打 A：70% 资源投入 conversion_site_a，20% 投入 buyer_mid 铺垫，10% 投入 pricing_ramp 做价值锚点。
假打 A 转 B：40% 投入 conversion_site_a 制造压力，45% 投入 conversion_site_b 完成真实转化，15% 投入 retention_connector 处理转点。
经济局偷点：低预算集中打对方弱防区，只要求保留一个可执行突破点。
```

#### 守方文档部署

守方不知道攻方真实主攻点，只能根据比分、经济、历史弱点和自身风格做区域部署。

```ts
type DefenseDeployment = {
  teamId: string;
  setup:
    | "heavy_a"
    | "heavy_b"
    | "default_split"
    | "mid_push"
    | "retake_setup"
    | "save_weak_hold";
  heavyZoneId?: string;
  weakZoneIds: string[];
  resourceAllocationByZone: ZoneResourceAllocation[];
  anchorAgentIds: string[];
  rotatePolicy: "fast_rotate" | "hold_sites" | "info_first" | "save_first";
  deploymentSummary: string;
};
```

示例：

```text
重防 A：把主要资源放在 conversion_site_a，用技术壁垒、转化数据、商业论证或产品护城河顶住强攻。
默认分散：A / B 两点各留资源，中路保留信息控制，适合不知道对手倾向时使用。
中路前压：把资源投入 buyer_mid，争取提前识破攻方主攻方向。
保守回防：减少前压，优先留存 retention_connector，等待攻方暴露意图后再转点。
```

#### 区域资源分配

区域资源分配是从 Agent 级经济派生出的战术视图，不是新的经济主体。

```ts
type ZoneResourceAllocation = {
  zoneId: string;
  weight: number;
  activeAgentIds: string[];
  intent:
    | "attack_execute"
    | "attack_feint"
    | "info_control"
    | "defense_anchor"
    | "defense_rotate"
    | "economy_pressure";
};
```

约束：

```text
同一队伍同一回合的 weight 建议合计为 100。
资源分配只能解释 outputBudget 如何用于不同区域。
资源分配不能制造额外 token。
资源分配不能修改 agentTokenBank、buyType 或真实 API 成本。
```

#### 裁判碰撞判定

Judge 在回合判定时应看到双方已经提交的有效内容和区域意图，但不应看到未提交的 rawOutput。第一版可以把区域碰撞归纳为以下结果：

```ts
type TacticalCollision = {
  primaryZoneId: string;
  attackApproach: AttackPlan["approach"];
  defenseSetup: DefenseDeployment["setup"];
  result:
    | "attack_breakthrough"
    | "defense_hold"
    | "trade_even"
    | "fake_success"
    | "rotate_success"
    | "economy_steal";
  decisiveReason: string;
};
```

典型关系：

```text
攻方强打 A，守方重防 A：进入硬碰硬，Judge 比较 A 点有效输出质量、预算和历史上下文。
攻方强打 B，守方重防 A：B 点可能成为弱防突破，高概率生成 entry / conversion。
攻方假打 A 转 B，守方回防慢：可能生成 fake_success / rotate_success 高光。
守方中路前压成功：可能提前压制攻方主攻意图，生成 defense_hold 或 trade_even。
```

#### 回合流水线插入点

Phase 1.6 后，`playNextRound` 的同步关键路径可扩展为：

```text
1. 生成 SideAssignment。
2. 选择 active agents。
3. 执行购买阶段，得到每个 active Agent 的预算。
4. 攻方生成 AttackPlan。
5. 守方生成 DefenseDeployment。
6. 根据计划构建双方各自可见的 Prompt Context。
7. LLM Driver 生成 RawOutput。
8. Output Gate 生成 SubmittedOutput。
9. Judge 使用 SubmittedOutput + 战术计划摘要 + 经济状态做碰撞判定。
10. RoundReport 写入关键区域、战术碰撞结果和高光标签。
```

信息边界：

```text
攻方不知道守方完整部署。
守方不知道攻方真实主攻点。
Judge 可以看到双方提交后的有效内容和必要战术摘要。
转播系统只能在事实写入后包装这些信息。
```

非目标：

```text
不做真实 CS 物理移动。
不做实时并发对抗。
不让 P2.2 地图 UI 反向决定战术。
不让真实 API token 成本进入区域资源分配。
不在 Phase 1.5 直接强制实现完整攻防协议。
```

### 7.3 购买阶段

输入：

- 候选 active Agent 列表。
- 每个 active Agent 的 EconomyState。
- 当前比分。
- 当前地图。
- 最近经济事件。

动作：

```text
1. 每个 active Agent 决定 buyType。
2. 处理 Drop。
3. 计算 spendBudget、visibleContextBudget、outputBudget。
4. 写入 economy_snapshot_created。
5. 写入 buy_type_decided。
6. 如有 Drop，写入 drop_created。
7. 如有战术暂停，写入 timeout_used。
8. 根据预算得到最终 active agents。
```

输出：

- 本回合 EconomyPlan。
- 更新前后的 EconomyState。
- 经济事件。
- 最终 active agents。

### 7.4 上下文构建

上下文输入：

```text
当前 Tournament / Match / MapGame / Round。
当前地图主题和回合目标。
当前比分。
当前 EconomyPlan。
当前 SideAssignment（Phase 1.6 后）。
当前 AttackPlan / DefenseDeployment 摘要（Phase 1.6 后）。
active Agent 档案。
最近 2-3 个 RoundReport 摘要。
map_summary。
关键事件和暴露弱点。
```

上下文不应包含：

```text
完整历史事件全文。
真实 API Key。
未提交的对手 RawOutput。
已被 Output Gate 裁掉的内容。
```

输出：

- AgentActionPromptContext。
- JudgePromptContext。
- RoundReportPromptContext。

### 7.5 Agent RawOutput 生成

输入：

- active Agent。
- Agent.driverModelId。
- AgentActionPromptContext。
- LLM Gateway。

动作：

```text
1. 按 active Agent 逐个或限并发调用 DriverModel。
2. 每个调用生成 RawOutput。
3. 记录真实 token 用量到调用记录，不进入 EconomyState。
4. RawOutput 存为 Artifact 或 LLM call record。
```

第一版并发建议：

```text
单回合 Agent 输出并发：1-2。
Judge 必须优先成功。
Broadcast 任务不进入同步关键路径。
```

输出：

- RawOutput[]。
- LLM usage records。

### 7.6 Output Gate

输入：

- RawOutput。
- EconomyPlan.outputBudget。
- buyType。
- Output Gate 策略。

动作：

```text
1. 根据 spendBudget / outputBudget 裁剪 RawOutput。
2. 生成 SubmittedOutput。
3. 记录裁剪策略，例如 core_window、multi_slice、random_window。
4. 将 SubmittedOutput 写入 AgentOutput。
5. 写入 output_gate_applied。
```

约束：

- Judge 只看 SubmittedOutput。
- RoundReport 只把 SubmittedOutput 作为比赛提交事实。
- RawOutput 可以归档，但不默认展示，也不进入判定。

### 7.7 Judge 判定

输入：

- 双方 SubmittedOutput。
- 当前地图主题。
- 当前回合目标。
- 当前比分。
- 经济背景。
- 必要的最近上下文摘要。

动作：

```text
1. 调用 judge DriverModel。
2. 生成 JudgeResult。
3. 校验结构。
4. 失败时执行 retry / repair / fallback。
5. 写入 judge_decision_created。
6. 写入 score_updated。
```

输出：

- JudgeResult。
- winnerTeamId。
- scoreAfterRound。

### 7.8 RoundReport 生成

输入：

- Round。
- AgentOutput[]。
- JudgeResult。
- EconomySnapshot / EconomyDelta。
- 地图上下文。

动作：

```text
1. 生成 RoundReport。
2. 校验 RoundReport 必填字段。
3. 校验 keyEvents 是否引用存在的 team / agent / zone。
4. 校验 scoreAfterRound 是否与 JudgeResult 一致。
5. 准备 round_report_created，实际写入顺序以 7.9 / 8.4 为准。
```

输出：

- RoundReport。
- 可拆事件声明。

### 7.9 事件拆解与状态更新

必须写入：

```text
round_started
economy_snapshot_created
buy_type_decided
output_gate_applied
judge_decision_created
score_updated
economy_updated
round_report_created
round_completed
```

条件写入：

```text
drop_created
timeout_used
save_called
force_buy_called
highlight_detected
```

状态更新：

```text
Round.status = completed
Round.winnerTeamId = JudgeResult.winnerTeamId
Round.roundReportId = RoundReport.id
MapGame.teamAScore / teamBScore = RoundReport.scoreAfterRound
MapGame.currentRoundNumber += 1，除非地图完成
EconomyState 更新到回合后状态
Summary 更新或排队更新
```

### 7.10 回合收尾任务

回合完成后，转播、弹幕、高光和新闻等包装任务进入异步队列。它们不能修改 JudgeResult，默认也不能阻塞下一回合。

基础收尾任务：

```text
generate_kill_feed
generate_caster_lines
generate_barrage
update_basic_stats
```

关键规则：

- 这些任务失败不回滚 Round。
- `generate_kill_feed` 必须有模板化降级版本，可以直接从 `RoundReport.keyEvents` 生成基础击杀播报。
- `update_basic_stats` 应优先由结构化事实同步或短超时完成；失败时进入后台重试，不阻塞比赛事实推进。
- `generate_caster_lines`、`generate_barrage` 必须异步执行，失败后保留空位或占位内容，不阻塞下一回合。
- 这些任务不能修改 JudgeResult。
- 这些任务只能追加 broadcast / stats / admin 事件。

后台任务：

```text
update_support_rate
detect_highlights
generate_replay_card
generate_news_flash
update_mvp_race
update_complex_leaderboards
```

说明：

- 转播包装失败不阻塞比赛事实推进，也不阻塞地图自动推进。
- 击杀播报缺失时先使用模板化基础版本，后续可由高级转播任务覆盖或补充。
- 高光检测、回放卡片、新闻、赛后文章、复杂榜单、MVP race 均可后补。

### 7.11 回合审查窗口

每回合核心事实写入完成，并投递异步包装任务后，进入审查窗口。

默认规则：

```text
reviewWindowMs = 15000
```

该值必须可配置。

审查窗口展示内容：

- 本回合胜者。
- 比分变化。
- 经济变化。
- 关键事件。
- RoundReport 摘要。
- Judge 理由。
- 高光标签。
- 原始 Agent 输出入口。

无操作：

```text
审查窗口到期后，runCurrentMap 自动继续下一回合。
```

用户暂停：

```text
1. 进入 operator_pause。
2. 暂停整张地图自动运行。
3. 当前回合已结算，状态已记录。
4. 下一回合尚未开始。
```

### 7.12 人工修正

人工修正只允许默认修改当前审查窗口内的回合。已锁定回合只能通过高级修复台打开，默认不推荐。

第一版可修改范围：

- 本回合胜者。
- 比分。
- 关键事件。
- Judge 理由。
- RoundReport 摘要。
- 经济变化。
- 基础统计。
- 是否标记高光。
- 是否重生成解说 / 弹幕 / 击杀播报。

修正规则：

- 必须保留修改前版本和修改后版本。
- 不直接删除原始 JudgeResult 或原始事件。
- 写入 `admin_correction_applied`。
- 后续流程使用修正后的 effective result。
- 如果修改胜者、比分或经济，必须重算 MapGame 比分、EconomyState、map_summary 和基础统计。
- 如果只修改文案，只重生成对应转播内容，不重算比分和经济。

### 7.13 地图总结审查窗口

地图完成后进入地图总结审查窗口。该窗口必须由用户手动确认，不自动继续。

必须生成完成：

- 地图胜者。
- 地图比分。
- 地图 MVP。
- 关键回合列表。
- 经济转折点。
- 双方地图总结。
- 下一张地图提示。

如果地图总结生成失败：

```text
进入地图总结技术暂停。
修复后回到地图总结审查窗口。
```

地图总结审查窗口确认后：

- 如果 Match 未完成，允许用户手动启动下一张地图。
- 如果 Match 已完成，进入 completeMatch。

## 8. 事件写入顺序

### 8.1 启动比赛

```text
match_started
```

### 8.2 地图禁选

```text
map_veto_completed
```

### 8.3 启动地图

```text
economy_snapshot_created
map_started
```

### 8.4 推进回合

标准顺序：

```text
round_started
economy_snapshot_created
buy_type_decided
drop_created                可选
timeout_used                可选
force_buy_called            可选
save_called                 可选
output_gate_applied
judge_decision_created
score_updated
economy_updated
round_report_created
round_completed
kill_feed_created           可后补；缺失时使用模板化基础版本
caster_line_created         异步，可后补
barrage_created             异步，可后补
stats_updated               派生统计，可后补或短超时同步
support_rate_updated        可选，不阻塞
highlight_detected          可选，不阻塞，可后补
replay_card_created         仅高光时生成，不阻塞
```

说明：

- `round_completed` 表示回合事实已经结算。
- `economy_updated` 必须早于 `round_completed`，保证下一回合读取到完整经济状态。
- 每个事件必须写入 `globalSequence` 和当前 scope 的 `sequenceInScope`；事实顺序以这两个字段为准，不以 `createdAt` 或 `timelineMs` 为准。
- `highlight_detected` 如果依赖异步检测，可以在 `round_completed` 后追加。
- `caster_line_created`、`barrage_created`、`kill_feed_created`、`stats_updated` 不应阻塞下一回合；其中基础 kill feed 可由模板化降级即时生成。
- `support_rate_updated`、`highlight_detected`、`replay_card_created` 可以后补。

### 8.5 完成地图

```text
map_completed
map_review_window_started
map_review_window_confirmed
```

说明：

- `map_review_window_started` 进入地图总结审查窗口。
- `map_review_window_confirmed` 必须由用户手动确认后写入。
- `map_review_window_confirmed` 后才允许启动下一张地图。

### 8.6 完成比赛

```text
match_completed
```

### 8.7 运行控制事件

P1.4 使用以下运行控制事件，它们归属 P0.2 的 `runtime_control` 分类。

```text
review_window_started
review_window_expired
review_pause_requested
operator_pause_started
operator_pause_resolved
technical_pause_started
technical_pause_resolved
map_review_window_started
map_review_window_confirmed
admin_correction_applied
```

边界：

- `review_window_started` / `review_window_expired` 属于回合审查流程。
- `operator_pause_*` 属于用户主动暂停。
- `technical_pause_*` 属于系统失败后的修复流程。
- `map_review_window_*` 属于地图结束后的总结审查。
- 以上事件只记录运行流程和审计链，不能改变裁判判定、比分、经济结算、统计或奖项。
- `admin_correction_applied` 用于保留人工修正的前后版本和追溯关系。

## 9. 失败处理

### 9.1 Agent RawOutput 失败

处理顺序：

```text
1. 按 LLM Driver 契约重试。
2. 尝试一次 fallback driver 或 fake provider。
3. 写入 admin / artifact 记录。
```

如果仍失败：

```text
Round.status = failed
不写 round_completed
进入 technical_pause
等待修复台处理
```

### 9.2 Output Gate 失败

Output Gate 属于确定性本地逻辑，失败通常是输入坏了。

处理：

```text
1. 校验 RawOutput 是否为空。
2. 为空则生成极短 SubmittedOutput，并标记 output_gate_fallback。
3. 写入管理审计事件。
4. 继续进入 Judge。
```

### 9.3 Judge 失败

Judge 是同步关键路径。

处理顺序：

```text
1. retry。
2. schema repair。
3. 尝试一次 fallback judge driver 或 deterministic judge fallback。
```

如果仍失败：

```text
Round.status = failed
不更新比分
不写 round_completed
进入 technical_pause
```

### 9.4 RoundReport 失败

处理顺序：

```text
1. schema repair。
2. 使用 JudgeResult + AgentOutput 本地构造最小 RoundReport。
3. 如果 keyEvents 不合法，生成 minimal_key_event。
```

如果仍失败：

```text
Round.status = failed
JudgeResult 不落为 completed 回合
进入 technical_pause
```

### 9.5 事件写入失败

事件写入失败是严重错误。

处理：

```text
1. 停止当前回合推进。
2. 不更新下游状态。
3. 保留临时执行结果到 Artifact。
4. 等待重试写入或人工恢复。
```

原则：

```text
宁可停在未完成回合，也不要出现状态已更新但事件缺失。
```

### 9.6 异步任务失败

处理：

```text
1. retry。
2. 失败后进入 dead letter。
3. 不回滚比赛事实。
4. 管理界面可重新生成。
```

异步收尾任务：

```text
kill feed / caster / barrage / basic stats 失败
  -> 进入后台重试或 dead letter
  -> 不回滚 Round
  -> 不阻塞下一回合
```

基础 kill feed 允许使用模板化降级结果立即补位；高级解说、弹幕和复杂统计失败后按普通异步失败处理，不阻塞地图运行。

### 9.7 技术暂停与操作员暂停

回合技术暂停：

- 发生在回合事实生成、同步校验或审查窗口修复期间。
- 修复后回到当前地图自动运行。
- 如果修复失败或需要用户确认，保持暂停。

地图总结技术暂停：

- 发生在地图总结审查窗口生成失败时。
- 修复后回到地图总结审查窗口。

操作员暂停：

- 由用户主动触发。
- 暂停整张地图自动运行。
- 恢复后从下一个未开始回合继续。
- 不重跑已完成回合。

修复台权限：

- 普通修复：重跑 Agent、重跑 Judge、重建 RoundReport、指定胜者、重算经济、跳过非阻塞内容。
- 高级命令区：修正坏事件、重建摘要、打开已锁定回合、从检查点恢复。
- 主要由 Agent 辅助用户完成修复，用户做确认和决策。

## 10. 假模型供应商模式

P1.4 必须支持不接真实 LLM 跑完一场 BO3。

### 10.1 fake provider 目标

- 验证状态机。
- 验证事件写入顺序。
- 验证经济变化。
- 验证 RoundReport 结构。
- 验证地图和比赛完成逻辑。
- 为 P1.5 持久化和 P2 伪直播提供固定样例。

### 10.2 fake provider 行为

Agent 输出：

```text
根据 agent role、mapName、roundNumber、buyType 生成确定性 RawOutput。
```

Judge 输出：

```text
根据 roundNumber、seed、buyType、简单权重生成确定性 winnerTeamId。
```

RoundReport 输出：

```text
生成 2-3 个 keyEvents。
保证 scoreAfterRound、winnerTeamId、economyDelta 一致。
```

### 10.3 fake BO3 验收路径

```text
1. 创建 Match。
2. startMatch。
3. completeVeto。
4. startMap。
5. runCurrentMap。
6. runCurrentMap 内部连续 playNextRound，直到 map_completed 或暂停。
7. 校验每回合都完成核心事实写入，并将转播包装任务投递到异步队列。
8. 地图完成后进入地图总结审查窗口。
9. 用户确认后，如果 Match 未完成，手动 startMap 下一张。
10. 直到 match_completed。
11. 校验每个 completed Round 都有 RoundReport。
12. 校验每个 RoundReport 都能追溯到 Event。
13. 校验 Match 有 winnerTeamId。
```

## 11. 同步路径与异步路径

### 11.1 同步关键路径

必须成功，比赛才能推进：

```text
Match / Map / Round 状态更新
购买阶段
Agent RawOutput 或 fallback RawOutput
Output Gate
JudgeResult
RoundReport
核心 Event 写入
比分更新
EconomyState 更新
地图 / 比赛完成判断
```

### 11.2 异步非关键路径

失败不阻塞比赛推进：

```text
基础击杀播报，缺失时使用模板化降级版本
高级击杀播报
解说
弹幕
基础统计后补
支持率
高光检测
回放卡片，且只在高光时生成
新闻快讯
MVP race 更新
复杂榜单
```

转播包装和派生统计可以异步生成。基础击杀播报可以使用模板化降级版本先补位，高级解说、弹幕、复杂统计失败后进入后台重试或 dead letter，不进入技术暂停，也不阻塞下一回合。

### 11.3 边界规则

```text
同步路径产生事实。
异步路径包装事实。
异步路径不能修改同步路径事实。
异步路径可以追加事件。
```

## 12. 上下文与摘要

### 12.1 回合上下文最小输入

```text
matchId
mapGameId
roundNumber
mapName
mapTheme
scoreBeforeRound
seriesScore
activeAgentProfiles
economyPlan
recentRoundSummaries
mapSummary
knownWeaknesses
```

### 12.2 摘要更新时机

```text
每回合完成后：更新 map_summary。
每张地图完成后：更新 match_summary。
每场比赛完成后：更新 team_tactical_memory 和 match recap。
```

### 12.3 摘要失败处理

- 摘要失败不回滚事件。
- 可以使用最近 RoundReport.summary 拼接成临时 summary。
- 后续可从 Event 重生成。

## 13. 验收标准

完成 P1.4 后，应满足：

- 能说明 `startMatch` 到 `completeMatch` / `match_completed` 的完整流程。
- 能说明 Match / MapGame / Round 的状态流转。
- 能说明 `playNextRound` 的完整同步流水线。
- 能说明 `runCurrentMap` 如何在一张地图内自动循环推进回合。
- 能说明回合审查窗口默认 15 秒、可配置、无操作自动继续。
- 能说明用户暂停会暂停整张地图自动运行。
- 能说明每一步必须写入哪些事件。
- 能说明 Token 经济如何进入购买阶段和 Output Gate。
- 能说明 DriverModel 如何进入 Agent RawOutput、Judge、RoundReport。
- 能说明 RoundReport 如何拆解成事件和异步任务。
- 能说明转播包装为什么不阻塞下一回合，以及基础 kill feed 如何模板化降级。
- 能说明人工修正如何保留前后版本，并通过 `admin_correction_applied` 追溯。
- 能说明地图总结审查窗口为什么必须手动确认。
- 能说明 fake provider 如何跑完一场 BO3。
- 能为 P1.5 本地持久化提供明确保存对象和事务边界。

## 14. 当前开放问题

### 14.1 active agents 选择策略

第一版建议使用确定性规则。后续是否要让 Coach 或 IGL 参与选择 active agents，需要在智能体参数体系或比赛策略文档中补充。

### 14.2 veto 是否由模型参与

第一版建议用确定性禁选策略。后续可以让 Coach Agent 参与地图禁选，但不应阻塞 P1.4。

### 14.3 加时规则细化

P0.3 已锁定 MR6 和加时存在。具体加时回合数、经济重置方式，如果 P0.3 已定义则按 P0.3；如果未定义，P1.4 暂只保留接口。

### 14.4 RoundReport 生成方式

第一版可由模型生成，也可由 JudgeResult + AgentOutput 本地构造最小 RoundReport。工程实现时建议两者都保留，保证 fake provider 和 fallback 可用。

### 14.5 区域化攻防协议落地顺序

区域化攻防会改变 Round Context、Judge 输入、RoundReport 扩展和事件类型，不应塞回 Phase 1.45。建议顺序是：

```text
Phase 1.5：先接真实 LLM 的 caster_line，验证 provider / fallback / llm_calls 链路。
Phase 1.6：再实现 SideAssignment、AttackPlan、DefenseDeployment、TacticalCollision。
```

这样可以避免真实 LLM 接入、经济系统、地图区域和 Judge 判定同时变化，降低调试复杂度。
