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

## 3. Finance Major 当前原型

```text
docs/finance/README.md
docs/finance/finance-major-prototype-plan.md
docs/finance/finance-evidence-mvp.md
docs/finance/finance-data-asset-contract.md
docs/finance/finance-n48-n55-iteration-log.md
```

N42 起，Finance Major（金融投资对抗）原型已经成为 HexGrid 上的当前语义主线：保留 HexGrid 工程骨架，把旧泛商业攻防语义替换为金融研究攻防。当前测试范围是 `Dust2 有色 / 行业判断 / 6 round`。N43 已把 Falcon-7B 与 VitaLLMty 两队资产改造成金融投资风格 + 多专家 Agent 团队。

数据层第一版是“免费 API 代理事实版”：默认只自动接入 FRED、BaoStock 和可选 UN Comtrade；CNINFO、国家统计局、工信部、SHFE、SMM 等先作为后置证据锚点或商业化替换源。后续 agent 必须先读 `finance-evidence-mvp.md`，不能把代理事实冒充完整中国有色基本面系统。

N50-N55 已完成第一版收口：FRED / BaoStock / UN Comtrade / AKShare 已经进入离线事实库第一版，真实模型输出审计也已经和系统输入卡隔离。详细推进记录已经汇总到 `finance-n48-n55-iteration-log.md`，不要再从散落的单个 N 文档找当前口径：

```text
N50：离线金融事实库，只解决真实观测事实。
N51：专家证据切片，只解决 10 名 agent 差异化开局信息卡。
N52：回合信息层 / 局内行动层硬隔离，只解决 phase action 复述金融论文的问题。
N53：金融裁判证据采信事实化，只解决“证据是否真正进入裁判”的问题。
N54：中文人类审计与真实样本验收，只解决人工能否读懂真实样本的问题。
N55：真实 LLM 输出人类审计摘要，只解决“系统输入卡不能冒充 agent 输出”的问题。
N55 收口修正：phase0 真实开局输出层，只解决“开局真实输出和局内行动分离”的问题。
```

这不是让 agent 在比赛中临场拉 API，而是先离线生成可审计事实库，再逐层进入证据切片、行动边界、裁判采信和 Web 审计。

金融数据资产入口是 `data/materials/processed/finance/`，不是 Hex 地图资产目录。正式本地环境入口是 `AgentsMajor/.env.local`。

当前两队金融资产入口：

```text
data/materials/processed/teams/falcon-7b/initial-proposal.json
data/materials/processed/teams/falcon-7b/initial-proposal.md
data/materials/processed/teams/vitallmty/initial-proposal.json
data/materials/processed/teams/vitallmty/initial-proposal.md
```

选手和教练文件中的 `finance_agent_profile` 是 N43 后的金融专家职责入口；`cs_role_profile` 继续作为赛事包装和 Hex 执行层表达保留。N43b 后，`finance_agent_profile` 进一步包含跨行业 Agent Core 字段，例如 `signatureLens`、`attackStyle`、`defenseStyle`、`decisionThreshold`、`crossMapStrength` 和 `oneLineVoice`。

Dust2 有色地图专属内容不写进队伍核心资产，统一放在：

```text
data/materials/processed/finance/maps/dust2-nonferrous/map-overlay.json
```

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
