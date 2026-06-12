# P / Phase 交付框架

本文定义项目交付方法。它不是历史日志；历史 Phase 记录见 `docs/archive/phase-history/`。

## 1. P 线与 Phase 线

```text
P 线：长期模块契约，回答“系统边界和数据语义是什么”。
Phase 线：工程交付阶段，回答“当前实现推进到哪里”。
```

P 文档优先稳定契约；Phase 文档记录实施计划和验收。

## 2. 文档状态等级

```text
Current：当前执行口径。
Contract：长期契约，修改需同步代码和测试。
Frozen：冻结兼容，只修阻断性问题。
Backlog：长期方向，不是当前执行项。
Archive：历史记录，不作为当前决策依据。
Superseded：已被替代，仅保留背景。
```

新增或移动文档时必须在 `docs/index/current-docs.md`、`docs/index/archive-log.md` 或 `docs/index/backlog-index.md` 中登记。

## 3. 当前阶段判断

```text
Phase18 replay / live replay：Frozen compatibility。
HexGrid Phase 2.0-pre N20-N34c：Current mainline 已完成第一轮收口。
Node/Sector 实验线：Retired / Archive。
```

当前不再把 Phase 1.x 执行历史作为下一步判断来源。下一步应基于 Hex N34c 后的真实状态选择 N35。

## 4. 当前 P 文档状态

```text
P0 Foundation：Contract。
P1 Match Loop：Contract，含历史 Phase18 兼容语义。
P2 Broadcast Viewer：Contract / Frozen for Phase18；Hex Web 验收以 phase-plans/Hex 文档为准。
P3 Ecosystem：Backlog。
P4 Web Ops：Backlog。
```

P0-P2 暂不移动目录；它们仍是 schema、event、RoundReport、LLM、persistence 和 broadcast 的契约来源。

## 5. 当前 Phase 文档状态

```text
Phase 1.x：Archive，位于 docs/archive/phase-history/。
旧 Node/Sector Phase 2.0-pre：Superseded，位于 docs/archive/superseded/。
HexGrid Phase 2.0-pre：Current，位于 docs/phase-plans/phase-2.0-pre-*.md。
```

Hex 当前最重要文档：

```text
docs/phase-plans/phase-2.0-pre-hex-engine-implementation-plan.md
docs/phase-plans/phase-2.0-pre-hex-engine-runtime-contract.md
docs/phase-plans/phase-2.0-pre-hex-engine-reset-charter.md
```

## 6. 交付要求

每个新 N / Phase 计划必须说明：

```text
1. 目标。
2. 成功标准。
3. 已知上下文与初步判断。
4. 范围边界。
5. 技术实现路径。
6. 分阶段执行步骤。
7. 预期改动清单。
8. 风险、未知项与替代方案。
9. 自动化验证。
10. 人工验收流程。
11. 阻塞性问题。
12. 最小化与回滚策略。
13. 下一步交付物。
```

如果实现改变核心契约，必须先补文档再改代码。

## 7. 验证要求

```text
改 core：跑相关 core tests / typecheck。
改 shared schema 或 db：至少覆盖 shared/db/core 相关测试。
改 web：跑相关 web tests，必要时 Next build。
改 materials：跑 materials validate 或等效 JSON / path 检查。
改 docs：检查 UTF-8、链接路径、当前状态是否与 docs/index 对齐。
```

不得通过 `pnpm install` 解决普通验证问题。

## 8. 下一步选择规则

N35 不应从旧 Phase 1.x 文档推导，而应从以下事实选择：

```text
HexGrid 已可跑 Dust2 map + Web 验收。
旧 Node/Sector 已退役清理。
Phase18 replay/live replay 保留兼容。
N20-N34 快速推进留下结构债。
real LLM / Web 验收仍有质量专项空间。
```

优先候选：

```text
N35A：Hex 结构封板第二轮。
N35B：Hex real LLM / Web 验收质量专项。
```
