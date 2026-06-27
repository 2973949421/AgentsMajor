# 当前优先路线图

本文只记录近期优先级和长期方向。旧 Phase 执行历史见 `docs/archive/phase-history/`，旧长期设想的展开稿见 `docs/backlog/`。

## 1. 当前原则

```text
Simulation First, Broadcast Second.
事实链先稳定，再做转播包装、新闻、奖项和生态。
```

当前主线仍是 HexGrid 工程骨架，不是旧 Node/Sector，也不是继续扩 Phase18。N42 起的下一阶段，是在 HexGrid 上切换到 Finance Major（金融投资对抗）原型。
N61 后真实 map 样本新增 P0：provider 断线、phase0 卡片不可消费或 phase action 大面积 fallback 时，round 必须被质量闸门拦截。P0/P1 合并修复补丁已把 `invalid_round` 提交闭环、Web/N61 可审计读取、战术 anti-repeat 实效和击杀归因去重后历史更新落地；N62B 已完成 phase0 金融经济裁剪提交门修正：rawFinanceOpinionZh 原文只保留审计，submittedOpinionZh 摘录与 submitted finance card 成为 N59 judge 主线输入。N63 已完成第一版：financeFirepowerScore 已接回 combat 主链路，仍受 submitted cap、N59 projection 和 CS gate 限制。下一步进入 N65-lite；P2 审计台大清理后移到 N65-full 后。

并行 fork 说明：`fork-p1-finance-judge-balance` 已按 N59 裁判平衡范围落地。它不能替代 P0 round 质量闸门，也不能把 provider 退化、phase0 不可消费或 action fallback 的坏样本包装成有效 round。

并行 fork 说明：`fork-p1-cs-tactical-realism` 已按第一层 CS 战术真实性落地。P0/P1 合并修复后，前局 focus 区域/点位会真实填入 `antiRepeatRegions / antiRepeatPoints`，并参与路线候选小幅降权；它不改变 combat casualty threshold、hard winner 或 finance judge。

并行 fork 说明：`fork-p1-kill-attribution-realism` 只修 killer / assister 归因集中问题。P0/P1 合并修复后，归因历史只记录 dedupe 后最终落账 casualty，避免被同 phase 后续会删除的击杀污染。它不能改变 contact gate、kill threshold、combat verdict、hard winner、金融裁判或 KDA 来源，也不能替代 P0 round 质量闸门。

窄修补记：行动急迫感、C4 收敛、主动交火与随机出生点已落地。该补丁只影响 action request、路线候选排序、normalizer 安全修复和初始出生点分配；不改变金融裁判、combat 阈值、经济、KDA 或 hard winner。

Finance Major 的当前口径是：

```text
证据绑定的投资决策攻防决定金融主动权，Hex 执行层证据决定怎么打，硬条件决定谁赢。
```

也就是：

```text
地图 = 行业赛道。
轮次 = 研究任务类型。
round = 当前任务下的投资决策题。
立场方提出 stance（投资立场）。
挑战方 challenge 具体 claim（主张）。
裁判基于 claim、evidence、reasoningBridge、missingEvidence 和 scoreCap 判断金融层是否成立。
CS 层继续保留 attack / defense，并负责行动、控图、下包、拆包和战斗投影。
```

N20-N41 的旧商业攻防口径已经完成第一版验证，但它容易输出空泛内容。后续不继续加厚旧商业文案，而是把旧 business duel 语义替换为 finance duel。

N20-N41 历史口径可在 Hex 文档中回看：

```text
docs/hex/phase-2.0-pre-n38-n41-match-quality-plan.md
```

## 2. 已收口的主线状态

```text
Phase18 replay / live replay：保留为兼容线，不继续作为新事实主线扩展。
HexGrid N20-N34c：已完成地图、路径、状态、行动、战斗、经济、单回合提交、完整 Dust2 地图灰度、Web 验收台、结构封板第一轮和旧 Node/Sector 清理。
Node/Sector 实验线：已退役并清理 active mode / runtime / Web progress / UI 分支。
```

工程修复补记：Web dev 已在 `dev` 前直接编译 shared / db / llm / core，避免重启 dev 后仍读取陈旧 core dist。Hex RoundReport 已恢复经济裁剪契约：raw action 只保留审计，SubmittedOutput 才进入 Judge / RoundReport / tokenSubmission。

## 3. 近期优先级

### Next：N63-N65 修订路线，金融火力接回战斗主链

GPT Pro 审查后的近期主线不再直接进入 P2 审计台大清理。N62 已完成提交门，当前优先级压缩为三个后续正式 N，加一个 N65-lite 前置薄层：

```text
N62：Phase0 金融经济裁剪提交门。（已完成）
N63：Finance Firepower 接回 Combat 主链路。（已完成第一版）
N65-lite：最小 duel pair / fire lane pressure key。
N64：Combat 压力收敛与审计首屏。
N65-full：N 对 N / 1 对 N 对枪配对与归因。
```

执行顺序不能颠倒：N62B 已保证经济裁剪后的 submittedOpinionZh / submitted finance card 是唯一 judge 输入；N63 已把 submitted card 经 N59 采信形成 pressureScore / lethalScore / totalScore，并与 CS 执行分共同进入 combat；下一步 N65-lite 必须先生成 duelPair / fireLane / pressureKey，避免 N64 在 side-level 或 region-level 上堆压力；N64 再用这些 key 做持续接触收敛和 Web 首屏可读性；N65-full 最后补齐 1vN / NvN、多枪线 assist、support/IGL fallback killer 和去重后归因。P2 审计台专项只作为 N64/N65-full 的展示收口，不提前替代主链修复。

### Done：P0/P1 合并修复，坏 Round 闸门与战术 / 归因收口

N42-N55 已证明 Finance Major 原型能跑进 HexGrid，但也暴露出当前最大问题：金融层可能用“缺数据 / 泛金融意图 / 角色任务 / 风险提示”冒充金融胜负。N56 已完成第一版，把 Dust2 有色 6 个 round 改成开放投资决策题，并写入 `decisionQuestion`、`allowedStance`、`requiredEvidenceSchema` 和 `challengePolicy`。N57 前置数据源探测已完成，N57 Fact Bank v2 已完成第一版覆盖升级。N57c 数据底座收敛已完成：active 主路径已收敛为 FRED + BaoStock + AKShare。N58 已完成第一版，把 phase0 从自然语言开局段落升级为结构化 `stanceCard / challengeCard`。N59 已完成第一版金融裁判证据绑定重写：无 accepted evidence 不允许金融胜利，裁判输出 accepted / rejected / missing / scoreCaps、stanceScore / challengeScore、financialResult 和 combatEffectAllowed。N60 已完成第一版：金融分只保留为审计，combat 只消费 `financeProjection` 中的受限投影权限。N61 fixture 结构验收和 real provider 小样本均已完成；第 7 局 real 样本整体状态为 `pass`，phase0 结构化卡片、金融采信门槛和金融 / CS 分离均达标。后续真实 map 暴露的坏 round 污染、战术反重复未吃到目标字段、归因历史使用 pre-dedupe casualty 三个缺口已由 P0/P1 合并修复补丁收口。

N42-N55 历史状态：

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
```

N56-N61 新路线：

```text
N56：决策题与立场 / 挑战契约。（已完成第一版）
N57 前置：数据源探测与接口统一审计。（已完成）
N57：数据菜单扩充与 Fact Bank v2。（已完成联网覆盖升级；N57c active coverage 15/18，缺口进入 score cap）
N57b：AKShare Endpoint 广探测。（已完成；30 个 endpoint，6 ready、5 usable、3 candidate）
N57c：三主源 Active Fact Bank 覆盖重建。（已完成目标品种匹配补丁；94 条 active facts，coverage 15/18，World Bank / UN Comtrade 已冻结出 active path）
N58：Phase0 Stance Card / Challenge Card。（已完成第一版）
N59：金融裁判证据绑定重写。（已完成第一版）
N60：金融结果与 Combat Projection 解耦。（已完成第一版）
N61：Evidence-bound Round v1 小样本验收。（real provider 已跑；第 7 局通过，结论 pass）
```

这六步是强依赖链，不是并列待办：

```text
N56 已解决“问题怎么问”：产出 decisionQuestion、allowedStance、requiredEvidenceSchema、challengePolicy，并进入材料、trace、prompt 和 Web 审计。
N57 前置已解决“哪些源真实能试”：确认 FRED / BaoStock 可作为主路径，AKShare 可探测 SHFE / INE / GFEX 且可作为接入入口使用，World Bank public API 可作年度宏观代理，UN Comtrade 2024 指定 HS / flow 可返回贸易记录。N57 fact 必须写清 sourcePublisher / accessProvider / collector / endpoint / 字段口径。
N57 解决“数据够不够”的第一版：按 N56 的 requiredEvidenceSchema 和前置 source probe 结果扩充数据、提取事实、生成派生指标和覆盖率报告。第一版已经覆盖原 fact bank 路径，不新增平行库；最新联网结果显示 FRED、BaoStock、SHFE、INE、World Bank、UN Comtrade 均进入同一事实库，但 coverage 仍只有 12/18。
N57b 已解决“AKShare 能不能吃深”的第一轮探测：30 个 endpoint 中，SHFE/INE 期货与 `stock_financial_abstract` 可优先进 N57c，现货基差、北向/融资融券和宏观公开项可降权使用，GFEX/SHMET 先候选，行业板块和多数财报明细端点本轮不可用。
N57c 解决“当前比赛主路径是否干净”：active 数据源收敛为 FRED + BaoStock + AKShare；World Bank / UN Comtrade 从 active pack、agent evidence slice 和 judge coverage 中冻结，避免弱相关年频/贸易数据污染当前有色投研对抗。
N58 解决“agent 怎么说”：phase0 只能输出结构化 stanceCard / challengeCard，claim 必须绑定 evidence，challenge 必须绑定真实 targetClaimId，phase1+ 只能引用当前 agent 的 claimId / challengeId。
N59 已解决第一版“裁判怎么采信”：机械校验 claimType 与 allowedClaimTypes，accepted evidence 是金融胜负硬门槛，并把 financialResult / combatEffectAllowed 写入 trace。
N60 已解决第一版“金融怎么影响战斗”：combat 不再把金融分计入总分，只记录 `financeProjection`，说明金融允许解释压制、退让、控图或 possible_kill，但击杀仍由 CS 致命接触决定。
N61 解决“是否真的闭环”：real provider 已执行，第 7 局 N58 phase0 结构化卡片 10/10 可消费，N59/N60 安全链路有效，当前闭环小样本通过。
```

任何一步不达标，都不能靠后续步骤粉饰：

```text
N56 没有 requiredEvidenceSchema，N57 就不知道补什么数据。
N57 没有足够事实和派生指标，N58 就只能继续说数据不足。
N58 没有 claimId / evidenceRefs / reasoningBridge，N59 就无法真正采信。
N59 已提供 accepted / rejected / missing / scoreCaps，N60 已只消费这些金融结果和 combatEffectAllowed。
N60 已把金融与 CS 解释拆开；N61 real 样本已验证 N59/N60 安全链路没有越权，但暴露 N58 phase0 真实结构化输出失败。
```

核心硬规则：

```text
Round 必须是投资决策题，不预设看多或看空。
金融层使用 stance side / challenge side，CS 层继续使用 attack / defense。
没有 acceptedEvidenceRefs，不能判金融胜利。
missingEvidence 只能降权或限制置信度，不能直接赢。
CS 击杀仍可由纯 CS 事实产生，但不能包装成金融胜利。
```

当前测试落点保持不变：

```text
地图：Dust2 有色。
轮次：行业判断。
round：全球价格、市场反应、估值是否 price in、进出口线索、证据缺口、有限配置结论。
队伍：两种投资风格 + 五专家 agent + coach。
数据：N57c 后以 FRED + BaoStock + AKShare 三主源为 active 主路径；World Bank / UN Comtrade 只保留 frozen/candidate 状态。
```

详见：

```text
docs/finance/finance-major-prototype-plan.md
docs/finance/finance-evidence-mvp.md
docs/finance/finance-data-asset-contract.md
```

当前文档入口：

```text
docs/finance/finance-major-prototype-plan.md
docs/finance/finance-decision-question-contract.md
docs/finance/finance-evidence-mvp.md
docs/finance/finance-evidence-bound-round-roadmap.md
```

当前必须承认的边界：

```text
Dust2 有色第一版不是完整中国有色行业基本面系统。
FRED 全球金属价格不能直接证明中国国内供需。
BaoStock 市场表现不能直接证明行业基本面。
AKShare 是公开数据入口集合，能取到的数据按 endpoint 单独分级；不能因为是 AKShare 就一刀切排斥，也不能省略 sourcePublisher / endpoint / 字段口径。
World Bank / UN Comtrade 对当前 1-3 个月有色判断帮助有限，N57c 后冻结出 active 主路径。
CNINFO、国家统计局、工信部、SMM、USGS 等先作为后置证据锚点或后续增强源。
裁判必须展示 missingEvidence 和 scoreCaps，不能让 LLM 用代理事实冒充完整事实。
```

当前金融数据资产入口：

```text
data/materials/processed/finance/
```

N48-N55 推进记录：

```text
docs/finance/finance-n48-n55-iteration-log.md
```

N48-N55 推进记录是历史日志，不再作为当前下一步执行入口。

正式本地环境入口：

```text
AgentsMajor/.env.local
```

上层 `.env`、`.venv` 和外部 `metal_project/` 是历史验证痕迹，不作为项目运行入口。

### P1：后续候选，Hex 结构封板第二轮

Finance Major 原型验证后，再评估结构封板第二轮。结构封板的目标应是拆分已稳定的事实链实现，而不是在结构整理中顺手改变比赛规则。

## 4. 已完成质量打磨记录

### Done：N38，目标行动事实链修复（已完成第一版）

目标是先修硬事实一致性，避免出现“事件显示下包成功，但 `bombState` 仍为未下包，最终又判 `timeout_no_plant`”的矛盾。

```text
bomb_planted event
bombState.planted / plantedCellId
agent final cell
hard win condition
```

这些字段必须一致。N38 不处理 KDA、request 压缩或 Web 美化。

当前结果：

```text
bomb_planted 事件只在 C4 carrier 真正站到合法包点时生成。
bomb reducer 会拒绝未站到 objective cell 的下包事件。
defuse reducer 会拒绝未站到已下包格的非法拆包。
被敌方占住的包点不会生成虚假的 bomb_planted 成功事实。
```

### Done：N39，LLM 调用成本与中文输出稳定（已完成第一版）

目标是把 real provider 每 agent request 从约 37k-39k tokens 降到 15k-22k 左右，并让商业语义字段中文为主。

```text
compact request
round business duel 摘要复用
当前 agent 必需上下文
language_mismatch audit
中文 businessIntent / riskRead / tacticalIntent
```

当前结果：

```text
real provider 使用 compact_match payload，不再直接发送完整 HexAgentCommandRequest。
request artifact 同时保留 fullRequest 和 compactRequest，便于审计和回滚。
response artifact 记录 request size metrics、provider prompt tokens（若返回）和 language_mismatch audit。
Web LLM audit 显示 compact 请求数、平均压缩率、prompt token 总数、语义语言和 mismatch 数。
```

### Done：N40，角色感知 KDA 与 combat contact 收敛（已完成第一版）

目标是让枪战归因更像真实 CS 队内分工，同时减少一回合 80-100 个 combat resolution 的噪声。

```text
AWPer / star rifler / entry 更容易形成击杀贡献
IGL / support 更容易形成助攻或控制贡献
contact builder 只保留关键接触
assist 不再长期为 0
KDA 仍只来自 combat trace
```

当前结果：

```text
combat contact builder 已收敛为关键接触优先，不再默认保留全互联噪声。
objective contact、C4 压力、补枪准备、辅助压制等接触会写入 retentionReasons。
role contribution 已进入 killer / assister 归因排序，但不写 hard winner。
KDA 仍只从 combat trace 的 killer / target / assister 链路读取。
```

### Done：N41，旧商业审计主线（历史记录）

N41 是切换 Finance Major 前的旧 business duel（商业攻防）审计尝试。它只作为历史质量打磨记录保留，不再作为当前金融层执行口径。

```text
Web progress projection 曾新增 businessReview。
/hex-lab/match 曾新增商业攻防审计标签。
raw JSON 不再是理解回合的主要入口。
```

当前 Finance Major 已转向证据绑定的投资决策攻防，不沿用 N41 的商业证明题主语。

详见：

```text
docs/hex/phase-2.0-pre-n38-n41-match-quality-plan.md
docs/hex/phase-2.0-pre-n35-n37-business-duel-quality-plan.md
```

## 5. 中期方向

```text
1. Hex 事实链稳定后，再讨论完整 BO3 / map pool。
2. Hex Web 验收可靠后，再考虑节目级观赛 UI。
3. 真实 LLM 稳定后，再扩大队伍和比赛规模。
4. 旧 Phase18 只作为 replay/live replay 兼容，不再作为新事实主线。
```

## 6. 长期 Backlog

长期方向保留，但不作为当前 N35 默认目标：

```text
完整 16 队 tournament / bracket / fixture / scheduling。
统计与奖项。
新闻与媒体站。
素材库和赛事生态。
Web ops、队列、可观测性、远端部署。
```

详见：

```text
docs/backlog/full-tournament-roadmap.md
docs/backlog/ecosystem-roadmap.md
docs/backlog/README.md
```

## 7. 当前不建议做

```text
不直接扩 16 队正式赛。
不先做新闻站或奖项站。
不恢复旧 Node/Sector runtime。
不把 Phase18 replay 误删或混成 Hex runtime。
不为真实感让前端、LLM 或经济系统写最终 winner。
不通过重装依赖解决文档或测试问题。
```

## N63a 状态补充（2026-06-26）

- N59 裁判结果现在记录 `acceptedEvidenceRefsByItemId`，把被采信的 claim / challenge 映射到实际 accepted evidence refs。
- N63 金融火力现在只从当前 contact participant 的 submitted card + N59 item-evidence 映射取证据；缺映射时不会退回 side-level 平均分配。
- Web 审计已把 `rawFinanceOpinionZh` 改称“模型输出的可提交原文”，完整 LLM response 只在 artifact 可读时作为技术细节核对。
- N61 验收脚本已支持 `{ source, trace }` wrapper，并增加 N63a 映射缺失 / 火力未应用检查。


## P0.5 已纳入：Action Provider 单次重试

- 进入 N64 前，先消除 action provider 偶发异常对 round quality 的噪声污染。
- recovered retry 只作为审计信息，不算 `provider_degraded`；少量 validator / fallback 降级归入 `action_degraded`，不再误标为 provider 断线；final retry failure 仍按 P0 质量闸门处理。
- 下一步仍是 N64：Combat 压力收敛与审计首屏。

## N62C 已纳入：Phase0 RAW 原文增量与预算使用率审计

- 当前先不急于继续 N64；N62C 用来验证经济裁剪优势是否被 raw 原文过短掩盖。
- 新 prompt 要求 stance raw 420-650 字、challenge raw 320-520 字，但不增加 claim / challenge 数量。
- `submittedFinanceOutputs` 记录 `rawOpinionCharCount`、目标区间、`submittedOpinionCharCount`、`submittedBudgetChars` 和 `submittedBudgetUtilization`。
- 若新 map 统计显示 raw 长度达标，再继续校准 submitted 裁剪汇率表或进入 N64；若 raw 仍偏短，先修 prompt/provider 稳定性。

## N62D 已纳入：经济数字汇率裁剪与买型菜单隔离

- N62D 取代固定字数表，submitted 预算由真实经济 `spend` 按 `$50` 最小单位换算；枪械局 `$50=4` 字，手枪局 `$50=6` 字。
- 买型 / 经济姿态只决定档位上下限、裁剪模式和 `combatEffectCap`；LLM 只能生成 rawFinanceOpinionZh 和结构卡，不能直接决定 submitted 预算。
- 手枪局使用独立 `pistol_round` policy；force / half / rifle / AWP 的 submitted 长度必须能用 spend、档位 clamp 和 cutMode 解释。
- 下一步先跑新 map 统计 N62D 的 spend / budget / submitted / cutMode；若经济优势可解释，再进入 N64。
