# 当前工作状态

本文是 Agent Major 的当前状态锚点，只回答“现在在哪里、什么是主线、下一步候选是什么”。历史执行记录见 `docs/archive/`，长期设想见 `docs/backlog/`。

## 1. 当前主线

```text
当前主线：HexGrid（蜂巢格）Phase 2.0-pre。
当前进度：N20-N55 已完成第一版 Web 中文审计收口；N55 收口修正已新增 phase0 真实开局输出层，并把后续 phase 行动改成只引用可消费开局输出。N56 已把金融 round 改成投资决策题，N57 已覆盖升级现有 fact bank 到 v2，N58 已把 phase0 输出从自然语言段落升级为结构化 `stanceCard / challengeCard`。provider 失败、无效响应、非法证据引用、非法立场或非法 targetClaimId 只能作为失败审计保存，不能进入局内行动层。N59 已完成第一版金融证据绑定裁判：裁判从 `stanceCard / challengeCard`、Fact Bank v2 metadata 和 required evidence schema 产出 accepted / rejected / missing / scoreCaps、stanceScore / challengeScore、financialResult 和 combatEffectAllowed；没有 accepted evidence 时只能是 `no_financial_win_allowed` 或 `contested`，不能判金融胜利。N60 已完成第一版金融结果与战斗投影解耦：金融分只保留为审计，combat 总分不再直接吃金融作文或 N59 分数；战斗裁定新增 `financeProjection`，只按 `combatEffectAllowed` 说明金融可解释的压制、退让、控图或 possible_kill，击杀仍必须由 CS 致命接触产生。N61 已完成 real provider 小样本验收：第 6 局失败样本暴露 N58 real schema 适配问题；随后完成 N58/N61 窄修并生成第 7 局真实 trace。第 7 局 10 条 phase0 全部为可消费真实结构化卡片，5 条 stanceCard、5 条 challengeCard，claim / challenge 绑定率 100%，33 个 finance verdict 中 0 个无采信金融胜利，33 个 combat 解释全部区分金融与 CS，整体结论为 `pass`。
当前入口：/hex-lab/match。
当前底层事实：official Dust2 Hex map、Hex phase memory、Hex action/combat/economy/round runner、Hex map runner、Hex trace artifacts。
下一阶段候选：N56-N61 已完成第一版闭环，但真实 map 样本进一步暴露 provider 断线、phase0 0/10 可消费和 action 50/50 fallback 仍会被 timeout/no plant 包装成正常结果的 P0 风险。P0/P1 合并修复补丁已把 invalid round 提交闭环、Web/N61 可审计读取、战术 anti-repeat 目标填充和击杀归因去重后历史更新落地；N62B 已把 phase0 原始金融观点 `rawFinanceOpinionZh` 接入经济裁剪提交门，生成 `submittedOpinionZh` 与 submitted structured card；N59 judge 只消费 submitted finance output。N63 已完成第一版：submitted/N59 采信结果通过 financeFirepowerScore 接回 combat totalScore，并受 N59 projection、N62 combatEffectCap 与 CS contact/lethal/casualty gate 共同限制。N65-lite 已提供最小 `duelPair / fireLane / pressureKey`；N64 已完成 pressureKey 级 pressure history、scope 稳定化与 contested pressure tie-break。N65-full 第一版进入落地：同一 pressure scope / fire lane / objective exposure 下的多个 1v1 contact 会合并为可审计的 1vN / NvN multi-pair contact，并区分 primary duel、secondary duel、support contributor 与 attribution reason。P2 审计台大清理后移到 N65-full 验证后。
```

补充状态：Hex RoundReport 已重新接回经济 Output Gate。Hex action 先作为 RawOutput 进入审计，再按 `buyType / economyPosture / outputBudget` 裁剪成 `SubmittedOutput`；`RoundReport.agentOutputs` 使用裁剪后投影，`tokenSubmission.submittedOutputs` 保存完整提交元数据，Judge / RoundReport 不再消费被裁掉的 raw 字段。Web dev 启动前已改为直接 TypeScript 编译 shared / db / llm / core，避免源码已更新但 `@agent-major/core/dist` 仍旧导致页面吃不到新内核。

HexGrid 现在是新的比赛事实主线。它负责地图可走性、AP、阶段记忆、agent action、局部 combat、economy evidence、单回合提交、完整 Dust2 地图灰度和 Web 验收。

N55 后 combat 第二个窄修补丁的当前口径：`lethalEligible=true` 后不再继续等 `margin >= 12` 才产生击杀；高烈度致命接触会进入低分差对枪结算，分差 3 以上可击杀，分差 1-2 至少受伤或退让，分差 0 时用直接对枪压力作确定性判定。非致命接触仍禁止击杀。该补丁已经停止作为下一阶段主线，后续先修 Finance Major 的证据绑定链路。

已完成并行 fork：`fork-p1-finance-judge-balance`。该分支只修 N59 金融裁判平衡：安全 claimType 同义归一、score cap 真正封顶、missing-only challenge 不能赢。它不替代 P0 round 质量闸门，也不宣称坏 round 可以进入正式 map 统计。

已完成并行 fork：`fork-p1-cs-tactical-realism`。范围只限 CS 战术真实性第一层：前局战术记忆、anti-repeat route penalty、经济感知路线、角色路线分配和 Web 战术审计展示。P0/P1 合并修复后，`antiRepeatRegions / antiRepeatPoints` 已从最近 1-2 个 prior rounds 真实派生并进入路线候选惩罚。

已完成并行 fork：`fork-p1-kill-attribution-realism`。范围只限击杀归因真实性：记录同局击杀历史，降低刚杀过人的主杀优先级，限制 IGL / 支援贡献者这类 setup 语境抢主杀，并保留可审计原因。P0/P1 合并修复后，击杀归因历史只从 dedupe 后最终落账的 combat resolutions 更新，不再吃会被去重删除的 casualty。

已完成窄修：行动急迫感、C4 收敛、主动交火与随机出生点。phaseClock 已进入 action / compact request；C4 carrier 在 late / final 阶段路线候选向合法包点收敛，并对同 round 折返旧 cell / region / point 降权；危险 move 会在有限条件下修复为下包、拆包、回防、包点执行或主动对枪；每 round spawn_t / spawn_ct 使用稳定 seed 洗牌，5 人出生点不重叠且可复盘。

当前最高风险：

```text
真实 provider 断线或输出退化时，不能再把 phase0 不可消费、action 全 fallback 的坏 round 包装成 timeout/no plant 正常胜负。fork-p0-round-quality-gate 要求 invalid round 保留 trace 和 artifact，但 Web / N61 / map 审计优先读取 roundQualityStatus，不把坏样本计为可信比赛结果。少量 action validator / fallback 降级应归为 action_degraded，不再误写成 provider_degraded。
```

```text
N59 已把 acceptedEvidenceRefs 设为金融胜负硬门槛，缺数据、泛金融意图、角色任务或风险提示不能再直接形成金融胜负。
没有 acceptedEvidenceRefs 时，金融层只能是 no_financial_win_allowed 或 contested。
missingEvidence 只能降权、触发 score cap 或限制投影权限，不能直接赢。
N60 已把金融结果限制为 `financeProjection` 投影权限：金融无采信时不放大战斗 margin、不解释击杀；CS 仍可独立产生击杀、受伤、压制或退让。
```

N56-N61 必须按强依赖链执行，不能跳步：

```text
N56 已定义 decisionQuestion、allowedStance、requiredEvidenceSchema 和 challengePolicy，并接入 Dust2 有色材料、finance duel、prompt 和 Web 审计。
N57 前置已探测 FRED / BaoStock / AKShare-SHFE/INE/GFEX / World Bank / UN Comtrade，并输出 source-probe JSON 和人类报告；N57 已把现有 `latest.json` 覆盖升级为 Fact Bank v2，并生成 coverage report。N57b 已进一步探测 30 个 AKShare endpoint：6 个 `ready_for_fact_bank`、5 个 `usable_with_cap`、3 个 `candidate_only`、16 个 `unavailable`。N57c 已把 active 主路径收敛为 FRED + BaoStock + AKShare，World Bank / UN Comtrade 只保留 frozen/candidate 状态。
N58 已基于 N56 / N57 生成 stanceCard / challengeCard，phase1+ 只能引用当前 agent 自己的 claimId / challengeId，不能让 agent 自由发明 evidence 或新增 stance。
N59 已完成第一版机械采信：校验 claimType 与 evidence.allowedClaimTypes，只有 accepted evidence 才能支撑金融胜负，并输出 financialResult / combatEffectAllowed。
N60 已把 financialResult / combatEffectAllowed 固化为唯一金融投影接口，金融分只做审计，不再进入 combat 总分。
N61 已用 real provider 小样本验收结构链路，不能用主观观感替代采信链；第 7 局 real 样本已通过，后续进入 Web 人工大审计清理。
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

当前下一步不建议继续调 combat，也不建议立刻做结构封板第二轮。N42-N55 已经把 Finance Major（金融投资对抗）原型接入到证据包、队伍资产、真实 phase0 输出、局内行动、裁判采信链和 Web 中文审计；N56 已把旧“守方自证 / 攻方质疑”的证明题口径改成“决策题 + 立场方 / 挑战方 + 必需证据结构”；N57 已按原路径覆盖升级 Fact Bank v2；N57b / N57c 已把 active 数据底座收敛为 FRED + BaoStock + AKShare 三主源；N58 已把 phase0 变成结构化 stance / challenge 卡片；N59 已把金融裁判改为证据绑定第一版，N60 已完成金融投影权限隔离第一版。N61 real 小样本已完成，第 7 局真实输出曾达标；但真实 map 样本已暴露 provider 退化坏 round 仍会污染胜负统计。P0/P1 合并修复补丁已完成质量闸门提交闭环、战术反重复输入闭环和击杀归因历史去重；N62B 已完成 phase0 金融经济裁剪提交门修正：rawFinanceOpinionZh 原文保留审计，经济系统从原文摘录 submittedOpinionZh，并让 submitted finance card 成为 N59 judge 唯一新主线输入。N63 已完成第一版：financeFirepowerScore 已进入 combat 主链路，但不绕过 CS gate。N65-lite 已完成最小 duel pair / fire lane / pressureKey；N64 已完成 pressureKey 级持续对枪压力和 Web 首屏审计；N65-full 第一版正在补齐 1vN / NvN 多人对枪配对与归因。P2 审计台大清理后移到 N65-full 验证后。

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
N60：金融结果与 Combat Projection 解耦。（已完成第一版）
N61：Evidence-bound Round v1 小样本验收。（real provider 已跑；第 7 局通过，结论 pass）
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
N51 已按专家角色切片给 agent；N52 已硬隔离行动边界；N53 已完成裁判采信链第一版；N54 已处理中文人工审计；N55 已隔离真实 LLM 输出摘要和系统输入卡；N59 已完成金融证据绑定裁判第一版；N60 已完成金融投影权限隔离第一版；N61 real provider 已执行，第 7 局真实 phase0 结构化卡片 10/10 可消费，当前结论为 pass。
N55 收口修正已新增 `roundStartAgentOutputs`，它们是真实 phase0 开局输出；`agentOpeningBrief` 继续存在，但只作为系统输入卡。只有 `llm_response_artifact` 或 `fixture_response` 且校验通过、证据引用合法的输出可以进入后续 phase；`provider_error`、`invalid_response` 和非法 evidence refs 只能作为失败审计展示。N55 后 combat 窄修补丁又新增接触强度审计：`observation / suppression / lethal`，只有通过 lethal gate 的接触才能产生击杀；枪线暴露、开阔无掩体、同点位、包点暴露和移动触发的隐式交火都进入审计链。金融采信为 0 时，combat trace 不得把局部胜负包装成金融裁判胜利。
```
## 6. 外部审查后的 N62-N65 收敛路线

GPT Pro 静态审查后的最高优先结论：项目方向正确，但 N60 安全隔离过头，导致 phase0 有效观点火力没有真正进入 combat 伤亡主链路。后续不新增长串 N，但执行顺序必须按 PRO 修订：N62、N63、N65-lite、N64、N65-full。N65-lite 是 N65 的前置薄层，不是新增大阶段；它只给 N64 提供 duelPair / fireLane / pressureKey，避免持续压力继续污染在 side-level 或 region-level 上。

```text
N62：Phase0 金融经济裁剪提交门。（已落地）
- 恢复 rawFinanceOpinionZh 原始金融观点 -> economy clipped submittedOpinionZh / submitted finance card -> judge input。
- Judge 和 combat 只消费 submitted 结构与 submitted 文本摘录，不直接消费 raw 原文或 normalized card。
- submitted 必须带 combatEffectCap、judgeInputRef、factBankSnapshotId、evidenceMenuVersion、clippingPolicyVersion。
- 裁剪只能截断 / 删除 / 降 cap，不能替 agent 挑更优证据、补推理或改 targetClaimId。
- 当前 trace 已新增 `submittedFinanceOutputs`；N59 audit 写入 `judge_input:submitted_finance_outputs`；旧 trace 缺该字段时按旧样本处理，不冒充 N62。

N63：Finance Firepower 接回 Combat 主链路。
- N59 采信后的 submitted 金融观点形成 financeFirepowerScore。
- financeFirepowerScore 拆成 pressureScore / lethalScore / totalScore / caps。
- Combat 恢复 phase0 有效观点火力 60-70% + phase1+ CS 执行 30-40%。
- 无 accepted evidence、隔掩体、远距离 blocked lethal 仍不能乱杀。

N65-lite：最小 duel pair / fire lane pressure key。
- 在 N64 前先生成 ContactCandidate / DuelPair / pressureKey。
- pressureKey 必须基于 duelPairId / fireLaneId / objectiveExposureId / cellContactId。
- N64 不允许继续按 team / side / region 粗粒度累积压力。

N64：Combat 压力收敛与审计首屏。
- 同点位、包点入口、开阔枪线连续接触必须 deterministic 地形成压制升级、退让或 casualty。
- pressure 必须有 reset / decay，不能从 A 点污染到 B 点。
- 战术空转是 actionQualityWarning / urgencyFailure，通常应正常输，不是 invalid_round。
- Web 首屏按 round quality -> hard winner -> submitted finance adoption -> combat firepower / CS execution -> raw 技术细节展示。

N65-full：N 对 N / 1 对 N 对枪配对与归因。
- 从 side-level winner + 单 target + 单 killer，升级为完整 duel pairs / fire lanes。
- 1vN 要体现被多人夹击；NvN 要能审计谁是主枪线、谁是 assist / suppression。
- 支援贡献者 / IGL 只有在唯一有效直接候选时才可 fallback killer，并必须写 sole_direct_candidate_allowed。
- 每个 victim 每 phase 只最终落账一次 casualty，归因历史只吃 dedupe 后结果。
```

这条路线完成前，不继续把 P2 审计台大清理或扩地图作为主线。

## N63a 状态补充（2026-06-26）

- N59 裁判结果现在记录 `acceptedEvidenceRefsByItemId`，把被采信的 claim / challenge 映射到实际 accepted evidence refs。
- N63 金融火力现在只从当前 contact participant 的 submitted card + N59 item-evidence 映射取证据；缺映射时不会退回 side-level 平均分配。
- Web 审计已把 `rawFinanceOpinionZh` 改称“模型输出的可提交原文”，完整 LLM response 只在 artifact 可读时作为技术细节核对。
- N61 验收脚本已支持 `{ source, trace }` wrapper，并增加 N63a 映射缺失 / 火力未应用检查。


## P0.5 Action Provider Retry（2026-06-26）

- phase1+ action provider 增加单次重试：第一次 provider exception 不立即 fallback，同一 request 原样重试一次。
- 重试成功会记录 `providerRecovered / recoveredProviderErrors`，不进入最终 provider error 质量计数。
- 重试仍失败才生成 fallback，并保留全部 `providerAttemptErrors`；round quality 继续按最终 fallback / provider_error 判定。
- 不改变 phase0、金融裁判、combat、经济、hard winner 或 N64 压力累计。

## N62C 状态补充（2026-06-27）

- Phase0 real prompt 只拉长 `rawFinanceOpinionZh`：立场方目标 420-650 中文字，挑战方目标 320-520 中文字；结构化 `stanceCard / challengeCard` 仍保持 1-2 个 claim / 1 个 challenge。
- Phase0 provider 输出上限提高到 2200 tokens，用于降低 raw 原文增长后的 JSON 截断风险。
- `submittedFinanceOutputs` 增加 raw / submitted 长度、目标区间、预算和预算使用率审计；raw 太短只记录 `rawOpinionUnderTarget`，系统不补写、不加证据、不提高 cap。
- N62C 不改 submitted 裁剪预算表，不改 N59 / N63 / combat / hard winner。下一步先跑新 map 统计 raw 长度与预算使用率，再决定是否校准裁剪汇率表或进入 N64。

## N62D 状态补充（2026-06-27）

- N62C 的固定 submitted 预算表已被 N62D 取代：新 submitted 字数预算来自 agent 当前经济 `spend`，以 `$50` 为最小单位换算。
- 枪械局默认 `$50=4` 中文字；`pistol_round` 独立使用 `$50=6` 中文字，并在 Web 审计中显示为手枪局，不再伪装成 `halfBuy`。
- 经济版型只决定预算上下限、裁剪模式和 `combatEffectCap`；LLM 不得输出 submitted 字数、裁剪模式或火力上限。
- 新裁剪模式包括 `front_cut / random_window / pistol_core_window / core_window / random_core_window / multi_slice_lite / multi_slice / multi_slice_plus`；submitted 文本必须来自 `rawFinanceOpinionZh`，系统不得补写或替换更优证据。
- Web 审计显示经济版型、spend、汇率、预算、裁剪模式、预算使用率和 raw 是否不足。N62D 不改 N59、N63、combat 阈值、经济结算或 hard winner。


## N64 状态补充（2026-06-28）

- N64 新增 combat pressure history：按 N65-lite 的 `pressureKey` 记录 previous / current pressure、streak、delta、decay / reset reason 和本次是否改变 verdict。
- pressure 只作用于当前 contact 的既有优势方，且有单次加分上限；远距离、隔掩体或 lethal gate blocked 仍不能因为压力直接击杀。
- round runner 在每个 phase 内先对未出现 key 做 decay，再把 pressure snapshot 传给 combat resolver，最后只用 dedupe 后的 combat resolution 更新历史。
- `actionQualityWarnings / urgencyFailures` 独立于 round quality，用来解释 final phase 空转、无主动交火或 C4 未下包等“正常输”的原因，不把这些战术坏选择包装成 invalid round。
- Web / N61 增加 N64 pressure audit 可见性；N64b-2 第二刀补充 contested pressure tie-break：同一 cell / objective / lane 连续接触且 pre-pressure 分数存在轻微领先方时，`contested_suppression` 可获得受限 pressure delta；非致命 cap 只能推动压制 / 退让，不能绕过 lethal gate 形成 kill。N65-full 第一版在此基础上把同 scope 多个碎 1v1 合并为 multi-pair contact，支持 1vN / NvN 审计与归因。

## N65-full 状态补充（2026-06-29）

- N65-full 第一版只处理多人对枪配对与归因，不修 C4/no plant、prompt、经济或 hard winner。
- contact builder 在同一 `primaryPressureKey` 下合并多个 direct pair，生成 `combatShape`、`primaryDuelPairId`、`secondaryDuelPairIds`、`supportContributorAgentIds`、`outnumberedAgentIds` 与 `multiPairReasons`。
- resolver 消费 multi-pair 结构增强 killer / assist 排序：primary duel 负责主对枪，secondary duel 与 support contributor 优先进入 assist / suppression；支援贡献者 / IGL 仍受主杀限制。
- N61 新增 `multiPairContactCount`、`supportPrimaryViolationCount`、`duplicateVictimCasualtyCount`、`multiPairWithoutPrimaryDuelCount` 与 `regionOrSidePressureKeyRegressionCount`，防止支援贡献者抢主杀、同 victim 重复落账或 pressure key 回退。

## N65 后当前验收结论

最新验收口径已固定在 `docs/current/hex-map-acceptance-standard-v0.1.md`。2-7 map `map_hex_lab_1782747664458_c04f2fec` 和最近 5 张 map 的验收结论是：事实链通过，战斗密度通过，KDA 表现并非当前硬失败；主要缺口是行动质量、目标执行和经济行为风格。

关键事实：

```text
2-7 map：9 round，比分 7:2。
valid：4/9。
action_degraded：5/9。
invalid_round：0。
provider_degraded：0。
平均 casualty：3.56 / round。
timeout_no_plant：3/9。
pressure audit：147/147。
N65 multi-pair：7。
C4 dropped：2，pickup：0，final unrecovered：2。
kyousuke：9-4，单 round 5K；ropz / flameZ 有 3K。
```

当前判断：

```text
N64 / N65 到 v0.1 冻结。
不要继续靠调 pressure 或多人归因解决观感。
N66 前端 phase 内逐 tick 播放已作为展示层接入，不改事实链。
N67 行动 / 目标 / 经济行为校准第一版已接入 action request、路线候选、validator、round trace、Web 审计和 N61 统计。
下一步在真实 map 验证 N67 是否降低中后期空转；若通过，再做 N68 可信选手表现方差。
```

N66 / N67 / N68 的详细路线见 `docs/current/priority-roadmap.md`。
## N67-role 状态补充（2026-07-02）

- 局内 CS 主角色统一为 5 类：`IGL / AWPer / rifler / lurker / entry`。
- `star` 不再是独立主角色，只作为英文前缀或标签，例如 `star rifler / star AWPer / star entry`；首屏主角色不翻译成中文。
- 旧 `support / anchor / flex / star_rifler / entry_fragger / stand_in` 继续兼容读取，但会映射成五类主角色并保留为 `supportive / anchor / flex / star / stand_in` 等标签。
- 金融专家身份仍独立于 CS 主角色；`supportContributorAgentIds` 是 combat 结构里的支援贡献者，不是选手主角色。
- 新生成 materials 资产要求每队 5 名 active player 各占一个主角色；Web 选手面板首屏显示英文角色名；combat/action/economy 运行逻辑均以五类主角色为准，不改变击杀阈值、经济结算、N59/N62D/N63/N64/N65 或 hard winner。

## N67 状态补充（2026-07-02）

- N67 第一版只处理行动层目标压力和经济打法倾向，不改 N59 / N62D / N63 / N64 / N65，不改 combat 阈值、经济结算、KDA 或 hard winner。
- `agent_action` full request 和 compact request 已新增 `objectivePressure`，包含 `objectivePressureLevel`、`objectiveIntent`、`economyActionStyle` 和 `actionHints`，用于提示中后期执行、接包、护包、阻止下包、回防、保枪或主动对枪。
- 路线候选已增加 C4 dropped / carrier / bombsite objective 权重；掉包恢复只对附近、可达或职责相关 T 加权，不强制全队回头。
- 低经济 agent 在 late / objective 强上下文中允许 `peek / seek_duel / prepare_trade / map_control / save` 这类主动换人或保枪动作，但 `execute_site` 仍受低资源限制，不能绕过经济约束。
- round trace 新增 `objectiveBehaviorAudit`，记录 `objectiveStallCount`、`objectiveStallPhaseIds`、`lateMeaningfulActionCount`、`c4RecoveryOpportunityCount`、`c4RecoveryAttemptCount`、`c4AbandonReasonCount` 和 `economyActionStyleCounts`。
- Web 审计新增 N67 行动质量卡；N61 报告新增 objective stall、late meaningful action 和 C4 recovery 统计。N67 统计当前是审计和验收信号，不把战术坏选择包装成 invalid round。
