# 当前工作状态

本文是 Agent Major 的当前状态锚点，只回答“现在在哪里、什么是主线、下一步候选是什么”。历史执行记录见 `docs/archive/`，长期设想见 `docs/backlog/`。

## 1. 当前主线

```text
当前主线：HexGrid（蜂巢格）Phase 2.0-pre。
当前进度：N20-N55 已完成第一版 Web 中文审计收口；N55 收口修正已新增 phase0 真实开局输出层，并把后续 phase 行动改成只引用可消费开局输出。N56 已把金融 round 改成投资决策题，N57 已覆盖升级现有 fact bank 到 v2，N58 已把 phase0 输出从自然语言段落升级为结构化 `stanceCard / challengeCard`。provider 失败、无效响应、非法证据引用、非法立场或非法 targetClaimId 只能作为失败审计保存，不能进入局内行动层。N59 已完成第一版金融证据绑定裁判：裁判从 `stanceCard / challengeCard`、Fact Bank v2 metadata 和 required evidence schema 产出 accepted / rejected / missing / scoreCaps、stanceScore / challengeScore、financialResult 和 combatEffectAllowed；没有 accepted evidence 时只能是 `no_financial_win_allowed` 或 `contested`，不能判金融胜利。N55 后 combat 窄修补丁已完成接触门槛和低分差伤亡修正；下一步主线是 N60，把 N59 金融结果与 combat projection 做受限解耦。
当前入口：/hex-lab/match。
当前底层事实：official Dust2 Hex map、Hex phase memory、Hex action/combat/economy/round runner、Hex map runner、Hex trace artifacts。
下一阶段候选：N56 已完成第一版，N57 前置数据源探测已完成，N57 Fact Bank v2 已按原路径完成第一版覆盖升级；N57b 已完成 AKShare endpoint 广探测；N57c 已完成三主源 active fact bank 收敛；N58 已完成第一版结构化 phase0 卡片；N59 已完成第一版金融裁判证据绑定重写。下一步进入 N60：金融结果与 Combat Projection 解耦。
```

HexGrid 现在是新的比赛事实主线。它负责地图可走性、AP、阶段记忆、agent action、局部 combat、economy evidence、单回合提交、完整 Dust2 地图灰度和 Web 验收。

N55 后 combat 第二个窄修补丁的当前口径：`lethalEligible=true` 后不再继续等 `margin >= 12` 才产生击杀；高烈度致命接触会进入低分差对枪结算，分差 3 以上可击杀，分差 1-2 至少受伤或退让，分差 0 时用直接对枪压力作确定性判定。非致命接触仍禁止击杀。该补丁已经停止作为下一阶段主线，后续先修 Finance Major 的证据绑定链路。

当前最高风险：

```text
N59 已把 acceptedEvidenceRefs 设为金融胜负硬门槛，缺数据、泛金融意图、角色任务或风险提示不能再直接形成金融胜负。
没有 acceptedEvidenceRefs 时，金融层只能是 no_financial_win_allowed 或 contested。
missingEvidence 只能降权、触发 score cap 或限制投影权限，不能直接赢。
N60 仍需继续把金融结果与 combat projection 完整解耦，避免战斗解释混淆金融主动权与 CS 执行事实。
```

N56-N61 必须按强依赖链执行，不能跳步：

```text
N56 已定义 decisionQuestion、allowedStance、requiredEvidenceSchema 和 challengePolicy，并接入 Dust2 有色材料、finance duel、prompt 和 Web 审计。
N57 前置已探测 FRED / BaoStock / AKShare-SHFE/INE/GFEX / World Bank / UN Comtrade，并输出 source-probe JSON 和人类报告；N57 已把现有 `latest.json` 覆盖升级为 Fact Bank v2，并生成 coverage report。N57b 已进一步探测 30 个 AKShare endpoint：6 个 `ready_for_fact_bank`、5 个 `usable_with_cap`、3 个 `candidate_only`、16 个 `unavailable`。N57c 已把 active 主路径收敛为 FRED + BaoStock + AKShare，World Bank / UN Comtrade 只保留 frozen/candidate 状态。
N58 已基于 N56 / N57 生成 stanceCard / challengeCard，phase1+ 只能引用当前 agent 自己的 claimId / challengeId，不能让 agent 自由发明 evidence 或新增 stance。
N59 已完成第一版机械采信：校验 claimType 与 evidence.allowedClaimTypes，只有 accepted evidence 才能支撑金融胜负，并输出 financialResult / combatEffectAllowed。
N60 继续把 financialResult / combatEffectAllowed 作为唯一金融投影接口，不能让金融作文分直接拉爆 margin。
N61 用最小样本验收整条链，不能用主观观感替代采信链。
```

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
docs/finance/finance-decision-question-contract.md：N56 起的决策题、stance card、challenge card 和 claim/evidence 契约。
docs/finance/finance-evidence-mvp.md：免费 API 代理事实版证据层契约。
docs/finance/finance-evidence-bound-round-roadmap.md：N56-N61 证据绑定投资决策攻防路线。
docs/finance/n57-data-source-probe-report.md：N57 前置数据源探测报告。
docs/finance/finance-data-asset-contract.md：金融数据资产、环境变量和地图绑定隔离契约。
docs/finance/finance-n48-n55-iteration-log.md：N48-N55 条件验收、事实库、证据切片、审计和 phase0 开局输出收口日志。
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

当前下一步不建议继续调 combat，也不建议立刻做结构封板第二轮。N42-N55 已经把 Finance Major（金融投资对抗）原型接入到证据包、队伍资产、真实 phase0 输出、局内行动、裁判采信链和 Web 中文审计；N56 已把旧“守方自证 / 攻方质疑”的证明题口径改成“决策题 + 立场方 / 挑战方 + 必需证据结构”；N57 已按原路径覆盖升级 Fact Bank v2；N57b / N57c 已把 active 数据底座收敛为 FRED + BaoStock + AKShare 三主源；N58 已把 phase0 变成结构化 stance / challenge 卡片；N59 已把金融裁判改为证据绑定第一版。下一步是 N60：金融结果与 Combat Projection 解耦。

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
N52：回合信息层 / 局内行动层硬隔离。（已完成第一版）
N53：金融裁判证据采信事实化。（已完成第一版）
N54：中文人类审计与真实样本验收。（Web 收口完成；real 成功样本 blocked）
N55：真实 LLM 输出人类审计摘要与系统输入卡隔离。（已完成第一版）
N55 收口修正：phase0 真实开局输出层、失败态隔离与局内行动隔离。（已完成）
N55 后 combat 窄修补丁：接触门槛与伤亡门槛分层，远距离抽象接触禁止击杀，近距离和开阔枪线暴露允许受伤 / 退让 / 击杀，move / rotate 进入暴露关系可触发隐式交火。（已完成）
N56：决策题与立场 / 挑战契约。（已完成第一版）
N57 前置：数据源探测与接口统一审计。（已完成）
N57：数据菜单扩充与 Fact Bank v2。（已完成联网覆盖升级；N57c active coverage 15/18，剩余缺口进入 N58/N59 的 score cap）
N57b：AKShare Endpoint 广探测。（已完成；30 个 endpoint，6 ready、5 usable、3 candidate）
N57c：三主源 Active Fact Bank 覆盖重建。（已完成目标品种匹配补丁；94 条 active facts，coverage 15/18，World Bank / UN Comtrade 已冻结出 active path）
N58：Phase0 Stance Card / Challenge Card。（已完成第一版）
N59：金融裁判证据绑定重写。（已完成第一版）
N60：金融结果与 Combat Projection 解耦。
N61：Evidence-bound Round v1 小样本验收。
```

Finance Major 的核心不是重写 HexGrid，而是保留最新 Hex 工程骨架，把旧泛商业语义替换为金融投资决策攻防。第一版测试范围固定为 `Dust2 有色 / 行业判断 / 6 round`。N56 已把金融层从“守方自证 / 攻方质疑”改成“立场方 / 挑战方”：round 是投资决策题，stance 可以看多、看空、中性、结构性分化、条件判断或暂不交易，challenge 必须攻击具体 claimId。CS 层仍保留 attack / defense。

这里的 N57 不是单纯字段升级。它必须补厚金融事实库：

```text
根据 N56 的 requiredEvidenceSchema 提取或验证数据源。
对 FRED / BaoStock 做 1 / 3 / 6 / 12 个月变化、分位、波动、回撤和相对表现等派生指标。
验证 World Bank、SHFE / INE 等低成本源能否进入数据菜单；USGS、NBS 仍是后续候选。
输出 coverage report，说明每个 round 的证据覆盖和缺口。
```

数据层口径必须保持克制：

```text
Dust2 有色第一版是免费 API 代理事实版，不是完整中国有色行业基本面系统。
N57c 后默认 active 自动源：FRED + BaoStock + AKShare。
World Bank、UN Comtrade、CNINFO、国家统计局、工信部、SMM、USGS 等先作为 frozen / candidate，不进入当前比赛主路径。
裁判必须展示 missingEvidence 和 scoreCaps，不能让 LLM 用代理事实冒充完整事实。
```

固定执行口径见：

```text
docs/finance/finance-major-prototype-plan.md
docs/finance/finance-evidence-mvp.md
docs/finance/finance-data-asset-contract.md
docs/finance/finance-decision-question-contract.md
docs/finance/finance-evidence-bound-round-roadmap.md
```

金融数据资产已经独立放在：

```text
data/materials/processed/finance/
```

它只管理 source registry、evidence policy、Dust2 有色主题绑定、回合证据模板和数据源 universe，不承载 Hex cell / region / point 等地图空间事实。

当前必须承认的 N51-N55 前置事实：

```text
FRED / BaoStock / UN Comtrade / AKShare 已被登记。
N57 已覆盖升级 `data/materials/generated/finance/fact-bank/dust2-nonferrous/latest.json` 到 schemaVersion 2。
FRED、BaoStock、SHFE、INE、World Bank、UN Comtrade 已进入同一个事实库；失败字段保留为 unavailable observation。
当前 generated round evidence pack 优先消费 Fact Bank v2；只有真实缺口才保留 unavailable / score cap。
N57b 已证明 AKShare 可用端点主要集中在 SHFE/INE 期货、Sina 财务摘要、部分资金和宏观公开项；N57c 的目标是把 active 事实库再收敛为三主源：FRED 价格锚、BaoStock 公司行情/估值/可取财报字段、AKShare 可用 endpoint；World Bank / UN Comtrade 从 active pack 和 agent slice 中冻结。
比赛运行时读到了 evidence pack，但不是实时 API 数据。
N51 已按专家角色切片给 agent；N52 已硬隔离行动边界；N53 已完成裁判采信链第一版；N54 已处理中文人工审计；N55 已隔离真实 LLM 输出摘要和系统输入卡；N59 已完成金融证据绑定裁判第一版；真实成功样本仍需 N61 小样本验收。
N55 收口修正已新增 `roundStartAgentOutputs`，它们是真实 phase0 开局输出；`agentOpeningBrief` 继续存在，但只作为系统输入卡。只有 `llm_response_artifact` 或 `fixture_response` 且校验通过、证据引用合法的输出可以进入后续 phase；`provider_error`、`invalid_response` 和非法 evidence refs 只能作为失败审计展示。N55 后 combat 窄修补丁又新增接触强度审计：`observation / suppression / lethal`，只有通过 lethal gate 的接触才能产生击杀；枪线暴露、开阔无掩体、同点位、包点暴露和移动触发的隐式交火都进入审计链。金融采信为 0 时，combat trace 不得把局部胜负包装成金融裁判胜利。
```
