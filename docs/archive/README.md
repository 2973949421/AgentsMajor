# 文档归档日志

本文件记录从当前主阅读路径移出的文档。归档文档只供背景追溯，不作为当前执行依据。

## 2026-06-12 文档治理

### 早期技术总览

```text
docs/meta/technical-design.md
-> docs/archive/early-technical-design.md
```

原因：该文档是早期总览，已在文首声明不是当前最终契约。移出 `meta/`，避免被误读为当前架构入口。

### Phase 1.x 历史计划

```text
docs/phase-plans/phase-1.0-engineering-plan.md
docs/phase-plans/phase-1.45-contract-code-alignment.md
docs/phase-plans/phase-1.5-real-llm-integration.md
docs/phase-plans/phase-1.6-zone-offense-defense-protocol.md
docs/phase-plans/phase-1.7-materials-runtime-integration.md
docs/phase-plans/phase-1.8-real-llm-bo3-pilot.md
docs/phase-plans/phase-1.9-broadcast-ui-main-screen.md
-> docs/archive/phase-history/
```

原因：Phase 1.x 已完成或冻结。它们仍可作为历史背景，但不能作为 Hex N35 的当前路线依据。

### Superseded Node/Sector 文档

```text
docs/phase-plans/frozen/phase-2.0-pre-node-round-engine-charter.superseded.md
docs/phase-plans/frozen/phase-2.0-pre-node-round-engine-implementation-plan.superseded.md
-> docs/archive/superseded/
```

原因：旧 Node/Sector 路线已被 HexGrid 替代，且 runtime / active Web/API 入口已退役清理。

### Meta 旧版快照

```text
docs/meta/current-state.md
docs/meta/priority-roadmap.md
docs/meta/p-phase-delivery-framework.md
docs/meta/module-map.md
-> docs/archive/meta-history/*.before-docs-reset.md
```

原因：这些文件曾长期承担历史日志和当前入口的混合职责。重写当前 meta 前保留旧版快照，避免丢失上下文。

## Archive 使用规则

```text
可以引用 archive 解释历史决策。
不得把 archive 直接作为当前实现依据。
如果需要恢复 archive 中的某个方向，必须写新的 Phase / N 计划。
```
