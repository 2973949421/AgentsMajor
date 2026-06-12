# 当前优先路线图

本文只记录近期优先级和长期方向。旧 Phase 执行历史见 `docs/archive/phase-history/`，旧长期设想的展开稿见 `docs/backlog/`。

## 1. 当前原则

```text
Simulation First, Broadcast Second.
事实链先稳定，再做转播包装、新闻、奖项和生态。
```

当前主线是 HexGrid，不是旧 Node/Sector，也不是继续扩 Phase18。

## 2. 已收口的主线状态

```text
Phase18 replay / live replay：保留为兼容线，不继续作为新事实主线扩展。
HexGrid N20-N34c：已完成地图、路径、状态、行动、战斗、经济、单回合提交、完整 Dust2 地图灰度、Web 验收台、结构封板第一轮和旧 Node/Sector 清理。
Node/Sector 实验线：已退役并清理 active mode / runtime / Web progress / UI 分支。
```

## 3. 近期优先级

### P0：文档治理收口

目标是让 `docs/README.md`、`docs/index/`、`docs/meta/current-state.md` 成为可信入口，避免后续 agent 被旧 Phase 1.x 或旧 Node/Sector 文档带偏。

### P1：N35 候选一，Hex 结构封板第二轮

建议拆分重点：

```text
hex-agent-command-harness
hex-agent-command-boundary
hex-phase-memory
hex-combat-resolver
hex-round-runner
server-hex-match-lab projection
```

目标是降低 N20-N34 快速推进带来的文件体积和职责混杂，不调比赛规则。

### P2：N35 候选二，Hex real LLM / Web 验收质量专项

建议聚焦：

```text
real provider request / response artifact 审计
accepted / rejected / fallback 的 phase-agent 级展示
小地图 maxRounds 验收模式
provider error / external blocked 的产品化失败状态
```

目标是提高真实 LLM 验收稳定性，不让 LLM 写 winner、kills、economyDelta 或 DB fact。

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
docs/index/backlog-index.md
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
