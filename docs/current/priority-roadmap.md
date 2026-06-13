# 当前优先路线图

本文只记录近期优先级和长期方向。旧 Phase 执行历史见 `docs/archive/phase-history/`，旧长期设想的展开稿见 `docs/backlog/`。

## 1. 当前原则

```text
Simulation First, Broadcast Second.
事实链先稳定，再做转播包装、新闻、奖项和生态。
```

当前主线是 HexGrid，不是旧 Node/Sector，也不是继续扩 Phase18。

当前 Hex 对局质量打磨的核心口径是：

```text
商业攻防决定为什么打，CS 位置决定怎么打，硬条件决定谁赢。
```

也就是：

```text
每 round 有小主题。
守方自证，攻方质疑。
agent 行动承载自证 / 质疑。
战斗裁判在交火处判断自证是否驳回质疑，或质疑是否成功。
这个判断和 CS 位置证据共同形成击杀、压制、退让、控图。
最终胜负仍只来自 hard condition。
```

因此 N38-N41 不能仅凭“新增字段、接了 UI、测试通过”证明完成。每个 N 都要尽量给出一个可抽样解释的 round 样本，说明它如何让商业攻防事实链更可信。

## 2. 已收口的主线状态

```text
Phase18 replay / live replay：保留为兼容线，不继续作为新事实主线扩展。
HexGrid N20-N34c：已完成地图、路径、状态、行动、战斗、经济、单回合提交、完整 Dust2 地图灰度、Web 验收台、结构封板第一轮和旧 Node/Sector 清理。
Node/Sector 实验线：已退役并清理 active mode / runtime / Web progress / UI 分支。
```

## 3. 近期优先级

### P0：N38，目标行动事实链修复（已完成第一版）

目标是先修硬事实一致性，避免出现“事件显示下包成功，但 `bombState` 仍为未下包，最终又判 `timeout_no_plant`”的矛盾。

```text
bomb_planted event
bombState.planted / plantedCellId
agent final cell
hard win condition
```

这些字段必须一致。N38 不处理 KDA、request 压缩或 Web 美化。

当前结果：

```text
bomb_planted 事件只在 C4 carrier 真正站到合法包点时生成。
bomb reducer 会拒绝未站到 objective cell 的下包事件。
defuse reducer 会拒绝未站到已下包格的非法拆包。
被敌方占住的包点不会生成虚假的 bomb_planted 成功事实。
```

### P1：N39，LLM 调用成本与中文输出稳定（已完成第一版）

目标是把 real provider 每 agent request 从约 37k-39k tokens 降到 15k-22k 左右，并让商业语义字段中文为主。

```text
compact request
round business duel 摘要复用
当前 agent 必需上下文
language_mismatch audit
中文 businessIntent / riskRead / tacticalIntent
```

当前结果：

```text
real provider 使用 compact_match payload，不再直接发送完整 HexAgentCommandRequest。
request artifact 同时保留 fullRequest 和 compactRequest，便于审计和回滚。
response artifact 记录 request size metrics、provider prompt tokens（若返回）和 language_mismatch audit。
Web LLM audit 显示 compact 请求数、平均压缩率、prompt token 总数、语义语言和 mismatch 数。
```

### P2：N40，角色感知 KDA 与 combat contact 收敛（已完成第一版）

目标是让枪战归因更像真实 CS 队内分工，同时减少一回合 80-100 个 combat resolution 的噪声。

```text
AWPer / star rifler / entry 更容易形成击杀贡献
IGL / support 更容易形成助攻或控制贡献
contact builder 只保留关键接触
assist 不再长期为 0
KDA 仍只来自 combat trace
```

当前结果：

```text
combat contact builder 已收敛为关键接触优先，不再默认保留全互联噪声。
objective contact、C4 压力、补枪准备、辅助压制等接触会写入 retentionReasons。
role contribution 已进入 killer / assister 归因排序，但不写 hard winner。
KDA 仍只从 combat trace 的 killer / target / assister 链路读取。
```

### P3：N41，商业攻防审计主线（已完成第一版）

目标是让用户不用打开 raw JSON，也能审查商业文斗：

```text
本回合小主题
守方自证
攻方质疑
agent 商业职责
LLM 原始输出与规范化行动
战斗商业裁判
CS 证据
hard winner
```

当前结果：

```text
Web progress projection 新增 businessReview。
/hex-lab/match 的审计抽屉新增并默认进入“商业攻防”标签。
页面先展示 round 小主题、守方自证、攻方质疑、phase 行动故事、combat 裁判故事和 hard winner。
LLM / combat / economy / hard winner 标签仍保留，但 raw JSON 不再是理解回合的主要入口。
```

### P4：后续候选，Hex 结构封板第二轮

N38-N41 对局质量打磨第一轮完成后，可以重新评估结构封板第二轮。结构封板的目标应是拆分已稳定的事实链实现，而不是在结构整理中顺手改变比赛规则。

详见：

```text
docs/hex/phase-2.0-pre-n38-n41-match-quality-plan.md
docs/hex/phase-2.0-pre-n35-n37-business-duel-quality-plan.md
```

## 4. 中期方向

```text
1. Hex 事实链稳定后，再讨论完整 BO3 / map pool。
2. Hex Web 验收可靠后，再考虑节目级观赛 UI。
3. 真实 LLM 稳定后，再扩大队伍和比赛规模。
4. 旧 Phase18 只作为 replay/live replay 兼容，不再作为新事实主线。
```

## 5. 长期 Backlog

长期方向保留，但不作为当前 N35 默认目标：

```text
完整 16 队 tournament / bracket / fixture / scheduling。
统计与奖项。
新闻与媒体站。
素材库和赛事生态。
Web ops、队列、可观测性、远端部署。
```

详见：

```text
docs/backlog/full-tournament-roadmap.md
docs/backlog/ecosystem-roadmap.md
docs/backlog/README.md
```

## 6. 当前不建议做

```text
不直接扩 16 队正式赛。
不先做新闻站或奖项站。
不恢复旧 Node/Sector runtime。
不把 Phase18 replay 误删或混成 Hex runtime。
不为真实感让前端、LLM 或经济系统写最终 winner。
不通过重装依赖解决文档或测试问题。
```
