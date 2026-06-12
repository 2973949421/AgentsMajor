# 当前必读文档

## 1. 当前状态

```text
docs/current/current-state.md
docs/current/priority-roadmap.md
docs/current/delivery-framework.md
docs/current/module-map.md
```

先读 `current-state.md`，再读 roadmap 和交付规则。

## 2. HexGrid 当前主线

```text
docs/hex/phase-2.0-pre-hex-engine-implementation-plan.md
docs/hex/phase-2.0-pre-hex-engine-runtime-contract.md
docs/hex/phase-2.0-pre-hex-engine-reset-charter.md
docs/hex/phase-2.0-pre-combat-realism-freeze.md
docs/hex/phase-2.0-pre-llm-field-stability-addendum.md
```

这些文档定义当前 HexGrid route、runtime contract、Web 验收、旧 Node/Sector 清理和已冻结的真实性问题。

## 3. Phase 2.0-pre 横向契约

```text
docs/hex/phase-2.0-pre-semantic-calibration-charter.md
docs/hex/phase-2.0-pre-information-boundary-contract.md
docs/hex/phase-2.0-pre-evidence-layer-contract.md
docs/hex/phase-2.0-pre-judge-audit-contract.md
docs/hex/phase-2.0-pre-prompt-contract.md
docs/hex/phase-2.0-pre-defender-thesis-judge-contract.md
```

这些约束优先于早期 Phase 文档中关于 LLM、judge、经济、信息边界的旧表述。

## 4. P 级契约

```text
docs/contracts/foundation/
docs/contracts/match-loop/
docs/contracts/broadcast-viewer/
```

P0/P1/P2 是长期契约层。它们可能包含历史增量说明，但仍是 schema、event、RoundReport、LLM、persistence 和 broadcast 的重要参考。

## 5. Materials 当前资产

```text
data/materials/processed/maps/dust2/
data/materials/processed/maps/dust2/hex/dust2-hex-map.json
data/materials/processed/teams/<team-slug>/initial-proposal.json
data/materials/processed/teams/<team-slug>/initial-proposal.md
```

不要把旧的“按队伍再按地图拆分方案”的目录当作 runtime 方案入口。

## 6. 兼容与历史

```text
Phase18 replay / live replay：保留兼容线。
旧 Node/Sector：已退役并清理 active 入口。
历史文档：docs/archive/。
长期设想：docs/backlog/。
```

如果当前文档和 archive 文档冲突，以当前文档为准。
