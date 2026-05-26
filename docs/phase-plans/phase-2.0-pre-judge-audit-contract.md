# Phase 2.0-pre 裁判可审计契约

## 1. 定位

这份文档冻结 `Phase 2.0-pre / Dust2` 主校准线的裁判契约。

judge 不是比分播报器，不是文风评审，也不是自由叙事者。  
judge 的职责固定为：

- 判定本局 `CS 胜负方式`
- 判定本局 `商业攻防是否成立`
- 产出可落库、可回放、可供 coach 与前端消费的结构化证据

## 2. 输出分层

每个真实 LLM judge 结果都必须同时返回两层内容：

- `reason`
  - 给人读的最终判词
  - 必须解释本局是怎么赢的、胜方为什么成功、败方为什么失败
- `diagnostic`
  - 给系统审计、前端展示、coach 暂停修正与赛后复盘消费的结构化裁判事实

仅有 `reason` 不算完成裁判输出。`diagnostic` 不能在后处理阶段从 `reason` 反推伪造。

## 3. JudgeResult 必填字段

真实 LLM judge 必须返回以下基础字段：

- `winnerTeamId`
- `loserTeamId`
- `margin`
- `roundWinType`
- `attackWinConditionMet`
- `defenseWinConditionMet`
- `reason`
- `mvpAgentId`
- `confidence`
- `diagnostic`

### 3.1 胜负方式字段

`roundWinType` 只允许以下 5 种值：

- `attack_elimination`
- `attack_bomb_explosion`
- `defense_elimination`
- `defense_timeout_no_plant`
- `defense_defuse`

对应口径固定为：

- 进攻方：`全歼` / `下包并引爆`
- 防守方：`全歼` / `时间耗尽未下包` / `拆包成功`

`attackWinConditionMet` 与 `defenseWinConditionMet` 必须是布尔值，并且只能有一方为 `true`。  
它们必须与 `roundWinType`、`winnerTeamId`、本局攻守关系一致。

## 4. diagnostic 六字段

`diagnostic` 在本阶段固定为 6 个字段：

- `currentSubTheme`
- `attackedOpportunityGap`
- `defendedCoreProposition`
- `mainAttackZoneId`
- `mainDefenseZoneId`
- `decisiveEvidence`

### 4.1 字段含义

- `currentSubTheme`
  - 当前回合子命题，必须对应当前地图命题与 round theme
- `attackedOpportunityGap`
  - 攻方本局实际打中的机会缺口
  - 不能只写抽象词，必须写出“对象 + 缺口 + 为什么”
- `defendedCoreProposition`
  - 守方试图守住的核心成立点
  - 不能只写抽象词，必须写出“对象 + 成立点 + 为什么”
- `mainAttackZoneId`
  - 本局主攻落点 / 主执行区
- `mainDefenseZoneId`
  - 守方试图捍卫的核心命题焦点区
- `decisiveEvidence`
  - 决定性证据
  - 必须能回指到当前事实层，不允许纯叙事填充

### 4.2 区域说明

`mainAttackZoneId` 和 `mainDefenseZoneId` 可以相同，也可以不同。  
若不同，`reason` 必须明确解释：

- 为什么本局主攻落点在这个区
- 为什么守方真正试图捍卫的命题焦点在另一个区
- 这种区域关系如何回到双方计划、选手行动、CS 胜利方式和商业命题

也就是说，前端展示时必须允许：

- “主攻落点”
- “守方命题焦点”

不是同一个概念。

区域关系只是一种事实结构，不是胜负捷径。judge 禁止做以下推导：

- 因为守方守 A、攻方也打 A，所以守方天然更合理或天然获胜
- 因为守方守 A、攻方打 B，所以守方天然失败
- 因为主攻区与主守区相同，所以任一方自动占优
- 因为主攻区与主守区不同，所以任一方自动占优

真正的裁判依据只能来自：

- 双方计划是否贴合当前子命题
- 选手行动是否执行了计划
- CS 胜利方式是否成立
- 回合结果是否验证了商业命题

## 5. 允许引用的证据层

judge 只能引用当前已给出的真实事实层：

- `team_plan`
- `agent_action`
- `mapSemanticContext`
- `judgeRubricContext`
- `sideAssignment`
- `buy type / economy tags`
- 当前已公开的回合摘要

如果 `mapSemanticContext`、`judgeRubricContext`、`team_plan`、`agent_action`、`reason` 或 `diagnostic` 出现明显中文编码损坏，当前 round 必须 fail。系统不能把乱码当作同义词容错，也不能继续把损坏上下文送入 judge。

证据边界优先于文采。当前没有完整、可供 judge 引用的 combat ledger 时，judge 不得为了让 replay 更精彩而扩写微观战斗过程。

judge 不允许补写未被支持的微观事实，例如：

- 精确枪线
- 秒级交火顺序
- 具体清点包点过程
- 封锁回防路径
- 完成首杀 / 多杀 / 击杀链
- 未落库的投掷物落点
- 未落库的击杀链细节
- 未在事实层出现的隐藏信息

如果某个具体动作已经原样出现在本回合 `agent_action` 中，judge 可以保守引用该动作，但不得继续扩写成未落库的击杀链、秒级动作或精确枪线。

原则固定为：

```text
裁判可以保守地解释真实事实，不能主动脑补精彩细节。
```

## 6. 非法输出

以下情况都必须判定为非法 judge 输出，并使当前 round fail：

- `diagnostic` 缺失
- `diagnostic` 任一字段缺失或为空
- `roundWinType` 缺失
- `attackWinConditionMet / defenseWinConditionMet` 缺失或互相冲突
- `winnerTeamId / loserTeamId / roundWinType` 与本局攻守关系冲突
- `currentSubTheme` 与当前回合子命题不匹配
- `mainAttackZoneId / mainDefenseZoneId` 不是合法地图区域 id
- `attackedOpportunityGap / defendedCoreProposition` 只有抽象词，没有对象与解释
- `decisiveEvidence` 只是空泛评论，没有事实锚点
- `reason` 只夸胜方，不解释败方失败
- `reason` 与 `diagnostic` 明显冲突
- `reason` 把区域相同或不同当成自动胜负规则
- 输入或输出出现明显中文编码损坏
- `reason` 或 `decisiveEvidence` 出现未被事实层支持的微观战斗细节
- `margin` 或 `confidence` 与理由强度显著不匹配
- 用户可见层仍出现 `Team Alpha / Team Bravo` 这类占位命名

失败率优化只允许减少误杀与改善 prompt 命中率，不允许降低上述硬契约。被挡下的 judge 必须能归入明确类别，例如缺字段、区域自动胜负、`decisive` 证据不足、未支撑微观战斗细节或真实结构冲突。

非法输出不得提交：

- `rounds`
- `round_reports`
- 比分
- replay facts

但必须保留：

- failed LLM call
- artifacts
- error message

## 7. Coach 与前端消费方式

### 7.1 Coach

`judgeDiagnostic` 是 coach 的主证据来源，不再只是辅助解释。

timeout 与赛后复盘至少要消费：

- `attackedOpportunityGap`
- `defendedCoreProposition`
- `mainAttackZoneId`
- `mainDefenseZoneId`
- `roundWinType`

### 7.2 Frontend

前端主观赛层默认展示：

- 本局胜方
- 本局胜利方式
- 当前子命题
- 主攻落点
- 守方命题焦点
- 攻方打中的机会缺口
- 守方守住或失守的核心成立点
- 决定性证据
- 最终判词

原始 LLM 文本、内部调试字段、低层 artifacts 只进入折叠调试层。

## 8. 当前阶段结论

`Phase 2.0-pre` 对 judge 的要求不再是“写得像”，而是：

```text
会判、能证、可验。
```

只有当 judge 输出同时满足：

- 结构完整
- 胜负方式明确
- 商业攻防可解释
- 证据边界保守真实
- 前端可直接读懂

才算真正进入后续 `经济系统 + 击杀判断` 的增强阶段。
