# Phase 1.6 区域化攻防回合协议计划

## 1. 阶段定位

Phase 1.6 的目标是在 Phase 1.5 真实 LLM 小范围接入后，把“CS 式攻防 + 技术 / 运营 / 商业文本对抗”正式落成回合模拟协议。

它解决的问题是：

```text
每个回合谁是攻方，谁是守方？
攻方这一局主攻 A、主攻 B、控中转点，还是假打转点？
守方如何在不知道攻方真实意图的情况下做 A / B / 中路部署？
Token 预算如何体现为不同区域的文本火力、有效提交额度和 agent 输出投入？
Judge 如何根据攻守双方提交后的有效内容判定突破、防守、转点、假打或经济偷点？
RoundReport 如何把这些战术事实结构化保存，并交给 2D 地图和转播系统消费？
```

## 2. 核心原则

```text
地图区域先成为战术语义，再成为 UI 表现。
攻防计划是回合输入，不是转播包装。
区域资源分配是 Agent 级经济的战术视图，不是新的经济主体。
守方信息不完全，攻方也不知道守方完整部署。
双方公开输入平等，经济不裁剪公开输入。
Judge 只看 SubmittedOutput、战术摘要、裁判结算层经济状态和公开上下文，不看未提交 rawOutput。
转播系统只包装已写入事实，不能发明攻防部署。
```

## 3. 关键对象

### 3.1 攻守方分配（SideAssignment）

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

规则：

```text
MR6 前 6 回合使用初始攻守关系。
第 7 回合换边。
加时攻守规则由 P0.3 赛制文档最终定义。
```

### 3.2 攻方方案（AttackPlan）

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

第一批战术：

```text
fast_execute：快打目标区。
slow_control：慢控铺垫后进攻。
mid_control_then_execute：先争中路信息，再打 A / B。
fake_then_rotate：假打一个点，再转另一个点。
eco_steal：低预算偷弱防区。
default_probe：默认试探，不暴露全部资源。
```

### 3.3 守方部署（DefenseDeployment）

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

第一批部署：

```text
heavy_a：重防 A 点转化区。
heavy_b：重防 B 点转化区。
default_split：A / B 分散防守。
mid_push：中路前压，争取提前识破进攻。
retake_setup：保连接区，允许先丢点再回防。
save_weak_hold：经济不足时弱防，优先保留后续资源。
```

### 3.4 区域资源分配（ZoneResourceAllocation）

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
weight 是战术权重，不是新增 token。
同一队伍同一回合的 weight 建议合计为 100。
实际可提交内容仍由 Agent 的 outputBudget 和 Output Gate 决定。
```

### 3.5 战术碰撞（TacticalCollision）

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

## 4. 区域语义

```text
conversion_site_a：A 点转化区，适合承载商业闭环、付费路径、产品核心论证。
conversion_site_b：B 点转化区，适合承载备用路径、转点方案、差异化增长入口。
buyer_mid：中路信息区，适合争夺 buyer 定义、需求判断、市场切入点。
retention_connector：连接 / 回防区，适合处理留存、复购、转点和反制。
pricing_ramp：战术准备区，适合堆叠定价、价值锚点、技术壁垒和进入门槛。
token_economy：经济压力区，适合体现 force buy、eco、save、预算裁剪和资源波动。
spawn_a / spawn_b：队伍起点，用于播放和上下半场换边表达，不作为主要交火点。
```

## 5. 回合流水线

Phase 1.6 后的一回合建议流程：

```text
1. 生成 SideAssignment。
2. 选择 active agents。
3. 执行购买阶段，得到 agent 级预算。
4. 攻方生成 AttackPlan。
5. 守方生成 DefenseDeployment。
6. 根据信息边界构建双方 Prompt Context；双方公开输入平等，队内私有计划和经济只进入本队。
7. LLM Driver 生成 RawOutput。
8. Output Gate 裁剪出 SubmittedOutput。
9. Judge 根据 SubmittedOutput、战术摘要、裁判结算层经济状态和公开上下文判定 TacticalCollision。
10. RoundReport 保存关键区域、战术碰撞结果、胜者、比分、经济和高光标签。
11. Event Log 写入事实事件。
12. P2.2 地图和 P2.3 转播消费这些事实，生成伪直播表现。
```

## 6. 信息边界

```text
公开信息层：双方平等可见地图、回合、比分、攻守方、公开 roster / role、地图命题、回合子命题、公开历史摘要和已提交裁判结论。
队内私有层：本队可见己方真实经济、己方 buyType、己方 outputBudget、己方 AttackPlan / DefenseDeployment、己方 coach 修正和己方输出。
对手不可见：当前计划、主攻点、主防点、假打意图、exact economy、buyType、outputBudget、RawOutput、SubmittedOutput 在结算前的内容。
Judge 结算层可见：双方 SubmittedOutput、双方战术摘要、双方真实经济、公开上下文。
观众可见：回合事实写入后的战术结果，不提前剧透隐藏计划；观赛 / 调试层不能回流成参赛 prompt 的隐藏事实。
```

## 7. 文档勾稽

```text
P1.4 simulation-engine.md：主协议和回合流水线。
P1.2 token-economy.md：区域资源分配从 agent 预算派生，不新增经济主体。
P1.1 round-report-contract.md：预留 tacticalContext / TacticalRoundSnapshot。
P0.2 event-taxonomy.md：预留 side_assignment、tactical_plan、zone_deployment、site_execute 类事件。
P2.2 tactical-map.md：定义 zone 的攻防语义，但不反写事实。
P2.3 broadcast-system.md：只消费攻防事实，不决定攻防部署。
```

## 8. 非目标

```text
不在 Phase 1.6 做真实 CS 物理移动。
不做实时并发直播。
不让地图 UI 决定胜负。
不把真实 API 成本混入区域资源。
不要求 Phase 1.5 在接入真实 LLM 时同时完成该协议。
```

## 9. 验收标准

```text
每个 round 都能确定攻守方。
MR6 第 7 回合能换边。
攻方能生成主攻 zone 和资源分配。
守方能生成防守部署和弱防区。
Judge 能输出 TacticalCollision。
RoundReport 能引用战术事实且仍保持比分 / 胜者一致。
Event Log 能追溯攻防计划来源。
P2.2 能点亮主战区、弱防区、转点路径和高光区。
P2.3 能根据事实生成“重防 A”“假打转 B”“B 点空虚被打穿”等转播话术。
```

## 10. 当前结论

区域化攻防协议是 Agent Major 从“AI 输出比赛”走向“可解释战术比赛”的关键升级。它应该在 Phase 1.5 验证真实 LLM 接入链路后进入 Phase 1.6，而不是回塞到 Phase 1.45 或阻塞 Phase 1.5。
## 11. Phase 1.6 落地状态

Phase 1.6 已落地为 deterministic rule-based tactical protocol。

代码边界：

- `phase16:*` 单独启用战术协议，`phase13:*` 和 `phase15:*` 不改变。
- `AttackPlan`、`DefenseDeployment` 和 `TacticalCollision` 全部由规则生成，不调用真实 LLM。
- `RoundReport.tacticalContext` 持久化到现有 `round_reports.tactical_context_json`，没有新增 SQLite 表。
- Web 只读取公开 `tacticalRound`，不暴露 hidden plan、rawOutput、driverModelId、modelName、token、cost、apiKey、authorization。

验收命令：

```text
pnpm typecheck
pnpm test
pnpm build
pnpm phase16:match
pnpm phase16:replay
pnpm phase16:export
```
