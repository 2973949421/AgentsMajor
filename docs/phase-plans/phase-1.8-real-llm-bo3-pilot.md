# Phase 1.8 Real LLM BO3 Pilot 收口记录

## 1. Stage Position

Phase 1.8 已在 2026-05-04 收口并暂时冻结。

本阶段目标是把 Phase 1.7 的 canon showcase 升级为本地真实 LLM BO3 pilot：

```text
Match: Falcon-7B vs VitaLLMty
Maps: DUST2 / INFERNO / MIRAGE
Runtime: local real LLM
Primary mode: Run Next Round
```

冻结含义：

```text
后续只修阻断性 bug。
不在 Phase 1.8 继续扩展 prompt 质量、胜负分布、更多队伍或正式赛制。
Phase 2.0 可以复用它作为真实 LLM 调用与观测基线。
```

## 2. Final Scope

已完成能力：

```text
Phase18 canon ids 与独立 seeding。
只导入两队 5v5 active players。
coach 不进入 Phase 1.8 runtime。
统一使用 AGENT_MAJOR_PHASE18_DRIVER_MODEL_ID 作为共享真实模型入口。
每回合顺序为 2 team_plan -> 10 agent_action -> judge。
可疑高置信连胜触发 judge_review。
player action 与 judge result 写入 round outcome、round report 和 replay 事实链。
失败时保留 llm_calls、artifact 和 system events 观测痕迹。
```

调试入口：

```text
pnpm phase18:round
pnpm phase18:map
pnpm phase18:match
pnpm phase18:replay
pnpm phase18:export
```

Web 入口：

```text
Run Next Round
Run Current Map
Run Full BO3
```

## 3. Final Boundaries

Phase 1.8 不做：

```text
不启用 per-agent materials future_driver_binding 路由。
不接 coach runtime。
不把 caster/barrage 纳入成功标准。
不开放换队和换图。
不程序改判 judge 结果。
不把 prompt 质量和胜负分布打磨作为收口阻塞项。
```

## 4. Acceptance

收口验收口径：

```text
CLI 可逐回合、逐地图和整场 BO3 运行。
Web 可触发 Phase18 next-round/current-map/full-bo3。
Web progress 可显示 expected/completed/running/failed 和全量 LLM 调用明细。
旧 replay guard 生效，失败时不播放旧预设结果误导判断。
event id 使用 attempt scope，失败重跑不再触发 completed event conflict。
```

最后验证：

```text
pnpm --filter @agent-major/core test -- src/phase18.test.ts
pnpm --filter @agent-major/cli test -- src/phase18.test.ts
pnpm --filter @agent-major/web test
pnpm build:web
```

## 5. Known Residual Risks

冻结后仍保留的质量风险：

```text
单场 BO3 结果分布仍可能呈现模式化。
judge reason 与 team plan 的解释质量仍需后续多场次验证。
prompt、战术信息密度、败方 win condition 解释标准仍不是最终版。
真实模型成本与并发策略仍属于本地 pilot 级别，不是生产任务系统。
```

这些风险转入 Phase 2.0 / 后续质量阶段，不阻塞 Phase 1.8 工程收口。
