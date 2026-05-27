# Phase 2.0-pre Evidence Layer Contract

本补充契约用于收口 `agent_action` 与 `judge` 的证据边界。

## 核心规则

- `team_plan` 表示队伍计划。
- `agent_action` 表示选手意图、职责、路线、准备动作或观察/支援/牵制/转点意图。
- `agent_action` 当前不作为硬失败入口；模型偶尔写出偏微观的战术语言时，不直接中断 round。
- `judge` 只能引用计划、行动意图、区域、买型、胜负方式和公开摘要之间的关系。
- `agent_action` 不是 `combat ledger`，不能被 judge 当作已经发生击杀、清点或封锁回防的事实来源。

## Agent Action 推荐边界

`agent_action` 应尽量避免以下结果性表述，但当前阶段不因这些表述直接 fail：

- 完成击杀、首杀、多杀。
- 补枪残局、残局收束。
- 清点完成、清角完成、清空包点。
- 架死、锁死回防、封锁回援。
- 秒级交火或具体投掷物落点。

## Judge 硬边界

`judge` 仍然必须 hard fail 以下内容：

- 把 `agent_action` 的计划性动作扩写成已发生战斗事实。
- 在没有正式 `kill/combat ledger` 输入时写玩家级微观战斗过程。
- 用“某选手清点完成”“锁死回防路径”“完成击杀链”等细节支撑裁判结论。

## Judge 允许引用的微观词上下文

微观词本身不等于违规。`judge` 可以在以下上下文里引用“秒级、清点、击杀、安包”等词：

- 引用 `team_plan` 的计划目标、要求或预期，例如“计划要求 20 秒内完成安包”。
- 引用 `agent_action` 的意图或准备动作，例如“agent_action 仅显示准备清点入口”。
- 明确否定事实层支持，例如“没有 combat ledger 支持其完成清点、安包或击杀”。
- 说明证据不足，例如“不能证明击杀链已经发生”。

真正应 hard fail 的不是“出现微观词”，而是“把未落库微观动作写成已经发生的裁判事实”。

## 合法与非法示例

- 合法：`agent_action 显示攻方围绕 A 点入口建立信息与支援职责。`
- 合法：`judge 根据 team_plan、agent_action 意图、主攻区、主守区和 roundWinType 判断攻方打中了机会缺口。`
- 合法：`teamPlan 要求 20 秒内完成安包，但没有 combat ledger 支持其完成清点、安包或击杀。`
- 非法：`agent_action 写了准备清点，所以 judge 断言包点已经被清空。`
- 非法：`judge 写某选手三秒清点并锁死回防，但当前事实层没有 combat ledger。`

后续如果经济系统与击杀判断正式接入，需要单独定义 judge 可引用的 combat fact 字段白名单。
