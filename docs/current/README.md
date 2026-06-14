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
docs/hex/phase-2.0-pre-n38-n41-match-quality-plan.md
docs/hex/phase-2.0-pre-hex-engine-reset-charter.md
docs/hex/phase-2.0-pre-combat-realism-freeze.md
docs/hex/phase-2.0-pre-llm-field-stability-addendum.md
```

这些文档定义当前 HexGrid route、runtime contract、Web 验收、旧 Node/Sector 清理、N38-N41 对局质量打磨和已冻结的真实性问题。

## 3. Finance Major 下一阶段

```text
docs/finance/README.md
docs/finance/finance-major-prototype-plan.md
docs/finance/finance-evidence-mvp.md
docs/finance/finance-data-asset-contract.md
```

N42 起，下一阶段候选方向是 Finance Major（金融投资对抗）原型：保留 HexGrid 工程骨架，把旧泛商业攻防语义替换为金融研究攻防。当前测试范围是 `Dust2 有色 / 行业判断 / 6 round`。

数据层第一版是“免费 API 代理事实版”：默认只自动接入 FRED、BaoStock 和可选 UN Comtrade；CNINFO、国家统计局、工信部、SHFE、SMM 等先作为后置证据锚点或商业化替换源。后续 agent 必须先读 `finance-evidence-mvp.md`，不能把代理事实冒充完整中国有色基本面系统。

金融数据资产入口是 `data/materials/processed/finance/`，不是 Hex 地图资产目录。正式本地环境入口是 `AgentsMajor/.env.local`。

## 4. Phase 2.0-pre 横向契约

```text
docs/hex/phase-2.0-pre-semantic-calibration-charter.md
docs/hex/phase-2.0-pre-information-boundary-contract.md
docs/hex/phase-2.0-pre-evidence-layer-contract.md
docs/hex/phase-2.0-pre-judge-audit-contract.md
docs/hex/phase-2.0-pre-prompt-contract.md
docs/hex/phase-2.0-pre-defender-thesis-judge-contract.md
```

这些约束优先于早期 Phase 文档中关于 LLM、judge、经济、信息边界的旧表述。

## 5. P 级契约

```text
docs/contracts/foundation/
docs/contracts/match-loop/
docs/contracts/broadcast-viewer/
```

P0/P1/P2 是长期契约层。它们可能包含历史增量说明，但仍是 schema、event、RoundReport、LLM、persistence 和 broadcast 的重要参考。

## 6. Materials 当前资产

```text
data/materials/processed/maps/dust2/
data/materials/processed/maps/dust2/hex/dust2-hex-map.json
data/materials/processed/teams/<team-slug>/initial-proposal.json
data/materials/processed/teams/<team-slug>/initial-proposal.md
```

不要把旧的“按队伍再按地图拆分方案”的目录当作 runtime 方案入口。

## 7. 兼容与历史

```text
Phase18 replay / live replay：保留兼容线。
旧 Node/Sector：已退役并清理 active 入口。
历史文档：docs/archive/。
长期设想：docs/backlog/。
```

如果当前文档和 archive 文档冲突，以当前文档为准。
