# Agent Major 文档索引

## 1. 阅读顺序

当前文档按 P 级契约和 Phase 工程计划分层。P 线回答“模块边界和契约是什么”，Phase 线回答“当前工程交付到哪里”。

建议阅读顺序：

```text
1. meta/current-state.md
2. meta/priority-roadmap.md
3. meta/p-phase-delivery-framework.md
4. meta/module-map.md
5. 按当前任务阅读对应 P 级目录
```

## 2. 当前状态

```text
P 线：已完成到 P2.3，Phase 1 范围内可按 Frozen 执行。
Phase 线：已完成到 Phase 1.6 区域化攻防回合协议收口；下一步先做后续阶段的高层边界设计与路线确认，阶段编号待定义。
```

## 3. 目录说明

### meta

项目总览、状态锚点、路线图和交付规则。

```text
meta/current-state.md
meta/module-map.md
meta/priority-roadmap.md
meta/p-phase-delivery-framework.md
meta/technical-design.md
```

### p0-foundation

事实源、事件、赛制和基础边界。

```text
p0-foundation/domain-schema.md
p0-foundation/event-taxonomy.md
p0-foundation/rules-format.md
```

### p1-match-loop

最小比赛闭环：回合战报、经济、驾驶员、引擎和本地持久化。

```text
p1-match-loop/round-report-contract.md
p1-match-loop/token-economy.md
p1-match-loop/llm-driver-contract.md
p1-match-loop/simulation-engine.md
p1-match-loop/local-persistence.md
```

### p2-broadcast-viewer

伪直播、观赛体验和播放层契约。

```text
p2-broadcast-viewer/live-timeline.md
p2-broadcast-viewer/tactical-map.md
p2-broadcast-viewer/broadcast-system.md
```

### p3-ecosystem

赛事生态、统计、奖项、新闻和素材库。当前只保留目录，不提前展开实现细节。

```text
p3-ecosystem/stats-awards.md       # 待补
p3-ecosystem/news-media.md         # 待补
p3-ecosystem/materials-library.md  # 待补
```

### p4-web-ops

Web 化、API、队列、观测和迁移。当前只保留目录，不阻塞 Phase 1 主线。

```text
p4-web-ops/api-contract.md       # 待补
p4-web-ops/queue-worker.md       # 待补
p4-web-ops/observability-cost.md # 待补
p4-web-ops/web-migration.md      # 待补
```

### phase-plans

工程交付计划。这里不放模块契约，只放阶段实施计划。

```text
phase-plans/phase-1.0-engineering-plan.md
phase-plans/phase-1.5-real-llm-integration.md
phase-plans/phase-1.45-contract-code-alignment.md
phase-plans/phase-1.6-zone-offense-defense-protocol.md
```

## 4. 维护规则

```text
P 级契约文档放入对应 p* 目录。
Phase 工程计划放入 phase-plans。
项目状态、路线图、总览和规则放入 meta。
不要把单篇契约文档拆成多个碎片文件。
新增文档后必须更新本 README 和 meta/priority-roadmap.md。
文档迁移或重命名必须整体提交 docs 的删除、新增、移动和索引更新，不允许只提交半边状态。
```
