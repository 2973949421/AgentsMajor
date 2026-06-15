# 当前工作状态

本文是 Agent Major 的当前状态锚点，只回答“现在在哪里、什么是主线、下一步候选是什么”。历史执行记录见 `docs/archive/`，长期设想见 `docs/backlog/`。

## 1. 当前主线

```text
当前主线：HexGrid（蜂巢格）Phase 2.0-pre。
当前进度：N20-N51 已完成第一版验收。
当前入口：/hex-lab/match。
当前底层事实：official Dust2 Hex map、Hex phase memory、Hex action/combat/economy/round runner、Hex map runner、Hex trace artifacts。
下一阶段候选：N52-N54 金融事实链与审计连续收口。
```

HexGrid 现在是新的比赛事实主线。它负责地图可走性、AP、阶段记忆、agent action、局部 combat、economy evidence、单回合提交、完整 Dust2 地图灰度和 Web 验收。

## 2. 保留兼容线

### Phase18 replay / live replay

```text
状态：保留。
定位：旧正式 replay / live replay 兼容线。
限制：不继续扩展为新比赛事实主线。
```

Phase18 replay / live replay 不是旧 Node/Sector runtime，不能在清理旧实验线时误删。

### Node/Sector 实验线

```text
状态：退役并清理 active 入口。
结果：旧 node-engine runtime、旧 node/sector assets、phase20_node_* active mode、旧 Node progress/parser/UI 分支已移除。
保留：/node-lab retired stub、/api/node-lab/run 410 retired、frozen / archive 文档、历史兼容字段。
```

`nodeTraceArtifactId` / `nodeTraceSource` 仍作为历史 DB/schema 兼容字段暂留。active Hex/Web 代码应通过通用 trace reference 语义读取，不得把字段名理解为 Node runtime 入口。

## 3. 当前文档状态

```text
docs/README.md：当前总入口。
docs/current/README.md：当前必读清单。
docs/archive/README.md：历史迁移记录。
docs/backlog/README.md：长期设想索引。
docs/hex/phase-2.0-pre-hex-engine-implementation-plan.md：Hex 当前实施口径。
docs/hex/phase-2.0-pre-hex-engine-runtime-contract.md：Hex runtime 契约。
docs/finance/finance-major-prototype-plan.md：Finance Major 原型路线。
docs/finance/finance-evidence-mvp.md：免费 API 代理事实版证据层契约。
docs/finance/finance-data-asset-contract.md：金融数据资产、环境变量和地图绑定隔离契约。
docs/finance/n48-dust2-nonferrous-6r-validation.md：N48 Dust2 有色 6R 条件通过验收报告。
```

旧 Phase 1.x 计划、早期技术总览和 superseded Node/Sector 计划已经移入 archive。生态、新闻、奖项、统计、完整 16 队赛事等长期想法移入 backlog。

## 4. 当前工作区注意事项

截至当前基线，工作区存在无关改动：

```text
apps/web/app/live-replay-player.tsx
apps/web/app/live-replay-player.module.css
apps/web/.next-dev-3001.log
apps/web/.next-dev-3001.err.log
```

这些不属于文档治理，也不属于 Hex 主线清理。后续 agent 不得在无明确指令时提交、回滚或覆盖它们。

## 5. 下一步候选

当前下一步不建议继续修旧泛商业文案，也不建议立刻做结构封板第二轮。N35-N41 已经证明 HexGrid 工程骨架可运行、可提交、可 Web 验收，但旧 business duel（商业攻防）语义层容易输出空泛内容。N42-N47 已经把 Finance Major（金融投资对抗）原型接入到证据包、队伍资产、运行时 financeDuel、战斗金融裁判和 Web 金融审计。N48 已完成 Dust2 有色 / 行业判断 6R 小样本验收，结论是条件通过。N49 已完成中文可读审计和回合信息层 / 局内行动层拆分第一版。N50 已生成离线金融事实库。N51 已把事实库按 PM / Macro / Commodity / Company / Risk 五类专家角色切成 agentEvidenceSlice，并让开局信息卡引用各自的证据、缺口和边界。下一阶段继续处理局内行动层硬隔离、裁判证据采信和真实样本级中文验收。

```text
N42：Finance Evidence + Finance Duel 契约。（已完成）
N43：金融队伍资产与专家 Agent 改造。（已完成）
N44：Finance Evidence MVP 接入。（已完成第一版）
N45：Finance Duel Runtime 接入。（已完成第一版）
N46：金融裁判替换商业裁判。（已完成第一版）
N47：金融 Web 验收台改造。（已完成第一版）
N48：Dust2 有色 / 行业判断 6R 小样本验收。（条件通过）
N49：中文可读审计 + 回合信息层 / 局内行动层拆分。（已完成第一版）
N50：离线金融事实库。（已完成第一版）
N51：专家证据切片与开局信息卡差异化。（已完成第一版）
N52：回合信息层 / 局内行动层硬隔离。（下一步）
N53：金融裁判证据采信事实化。（计划）
N54：中文人类审计与真实样本验收。（计划）
```

Finance Major 的核心不是重写 HexGrid，而是保留最新 Hex 工程骨架，把旧商业语义替换为金融研究攻防。第一版测试范围固定为 `Dust2 有色 / 行业判断 / 6 round`。N48 只证明了结构链路条件通过，尚未证明真实模型金融样本质量达标。

数据层口径必须保持克制：

```text
Dust2 有色第一版是免费 API 代理事实版，不是完整中国有色行业基本面系统。
默认自动源：FRED + BaoStock + 可选 UN Comtrade。
CNINFO、国家统计局、工信部、SHFE、SMM 等先作为后置证据锚点或商业化替换源。
裁判必须展示 missingEvidence 和 scoreCaps，不能让 LLM 用代理事实冒充完整事实。
```

固定执行口径见：

```text
docs/finance/finance-major-prototype-plan.md
docs/finance/finance-evidence-mvp.md
docs/finance/finance-data-asset-contract.md
```

金融数据资产已经独立放在：

```text
data/materials/processed/finance/
```

它只管理 source registry、evidence policy、Dust2 有色主题绑定、回合证据模板和数据源 universe，不承载 Hex cell / region / point 等地图空间事实。

当前必须承认的 N51-N54 前置事实：

```text
FRED / BaoStock / UN Comtrade / AKShare 已被登记。
N50 已生成 `data/materials/generated/finance/fact-bank/dust2-nonferrous/latest.json`。
FRED 和 BaoStock 已进入 `offline_observation_fact`。
UN Comtrade 第一版为 optional unavailable observation。
当前 generated round evidence pack 仍可保留 configured_proxy_fact 兜底。
比赛运行时读到了 evidence pack，但不是实时 API 数据。
N51 已按专家角色切片给 agent；N52-N54 再处理行动边界、裁判采信和人工审计。
```
