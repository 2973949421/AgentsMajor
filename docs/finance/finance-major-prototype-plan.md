# Finance Major 原型契约：证据绑定的投资决策攻防

本文是 Finance Major（金融投资对抗）的当前契约摘要。历史 N42-N55 推进记录见 `finance-n48-n55-iteration-log.md`；N56-N61 路线见 `finance-evidence-bound-round-roadmap.md`。当前状态：N56 已完成第一版，Dust2 有色 6 个 round 已进入开放投资决策题口径；下一步是 N57 数据菜单扩充与 Fact Bank v2。

## 1. 定位

Finance Major 不新建第二套比赛引擎。它复用 HexGrid（蜂巢格）的空间、行动、战斗、经济、回合提交、trace（轨迹）和 Web 验收台，只替换旧的泛商业语义层。

```text
保留：HexGrid 工程骨架。
替换：business duel -> evidence-bound finance decision duel。
当前测试：Dust2 有色 / 行业判断 / 6 round。
```

新的核心口径：

```text
金融判断决定为什么有主动权。
CS 执行层证据决定怎么打。
硬条件决定谁赢。
```

当前最重要的修正：

```text
Finance Major 不是“金融观点互喷 + CS 击杀动画”。
它必须是“证据绑定的结构化投研攻防 + CS 行动投影”。
```

## 2. 比赛定义

```text
赛事主题 = 金融投资对抗。
地图 = 行业赛道，例如有色、TMT、消费、医药、金融地产。
轮次 = 研究任务类型，例如行业判断、估值建模、公司深度、组合策略、风险应对。
round = 当前任务下的投资决策题。
金融层 = 立场方提出 stance（投资立场），挑战方 challenge 具体 claim（主张）。
CS 层 = attack / defense 继续负责行动、控图、下包、拆包和交火投影。
裁判 = 基于 claim、evidence、reasoningBridge、missingEvidence 和 scoreCap 判断金融层是否成立。
```

金融层不再继承“守方必须证明某方向、攻方必须唱反调”的旧逻辑。CS 外壳仍可使用 attack / defense、T / CT、entry、AWPer、IGL、support 等表达，但这些词只是执行层包装，不是金融研究证据。

## 3. Dust2 有色 6 个决策题

半场攻守互换后继续复用同 6 个决策题。任何队伍都不能被写死为永久看多、永久看空、永久立场方或永久挑战方。

| Round | 决策题 | 可接受立场 | 挑战焦点 |
|---|---|---|---|
| R1 | 当前全球金属价格趋势是否足以支持未来 1-3 个月 A 股有色相对超配？ | 看多、看空、中性、结构性配置、暂不交易 | FRED 全球价格能否外推到中国有色权益资产 |
| R2 | A 股有色代表公司市场表现是否确认商品价格信号？ | 超配、标配、低配、只配置强暴露子方向 | BaoStock 行情和估值是否只反映市场情绪 |
| R3 | 当前估值是否已经 price in 商品价格预期？ | 估值仍有弹性、已经透支、结构性分化 | 缺少财报页码、利润弹性和分产品暴露时的结论上限 |
| R4 | 在贸易数据可用性有限时，进出口线索是否足以影响行业判断？ | 可作为弱线索、不可作为核心依据、只影响风险边界 | UN Comtrade 滞后或不可用时如何降权 |
| R5 | 当前证据缺口下，哪些结论必须被限制置信度？ | 低置信配置、暂不交易、等待触发、结构性配置 | missingEvidence 只能降权，不能直接赢 |
| R6 | 基于固定数据菜单，当前有色配置建议应如何落地？ | 超配、标配、低配、结构性配置、条件触发、暂不交易 | 证据链、风险收益、失效条件和可执行性是否一致 |

这些 round 是开放决策题，不预设答案方向。立场方必须在有限证据内给出可执行判断；挑战方必须攻击具体 claim，而不是只说“数据不够”。

## 4. 队伍与 agent 分工

两队资产仍是“投资风格 + 行业理解 + 多专家团队”，但每个专家只在自己职责内主张和挑战。

```text
Falcon-7B：进攻型周期成长，偏高 beta、供需缺口、价格弹性和集中表达。
VitaLLMty：稳健质量风控，偏安全边际、成本曲线、估值纪律和风险调整收益。
```

五类专家：

```text
PM / IGL：组合经理，负责最终 stance、仓位强度、风险收益和取舍。
Macro / AWPer：宏观与政策，负责周期、需求、美元、利率和全球价格约束。
Commodity / entry：商品供需，负责金属价格、库存、供给、贸易和品种分化。
Company / star rifler：公司与估值，负责公司池、估值、盈利传导和子行业暴露。
Risk / support：风控执行，负责反证、scoreCaps、仓位降级、止损和失效条件。
Coach：研究纪律，不作为第 6 个上场选手。
```

反方能力不是一个固定队员，而是每个角色都必须能 challenge 对应领域的 claim。Challenge 必须绑定证据、缺口、代理错配、时间窗口或风险收益，不奖励单纯唱反调。

## 5. 数据事实边界

第一版是免费 API 代理事实版，不是完整中国有色行业基本面系统。

自动源：

```text
FRED：全球金属价格和宏观代理。
BaoStock：A 股公司行情和估值代理。
UN Comtrade：可选贸易数据；失败时记录 unavailable observation。
AKShare：可用采集入口；若用于 SHFE / INE / GFEX 等数据，必须保留原始发布方、接入方、collector、endpoint 和字段口径。
```

禁止包装：

```text
FRED 全球价格不能直接证明中国国内供需。
BaoStock 市场表现不能直接证明行业基本面。
UN Comtrade 进出口线索不能替代国内库存、现货、利润和财报页码。
configured_proxy_fact 只能作为弱代理事实。
unavailable_observation 不能被写成真实事实。
missingEvidence 只能降权或限制置信度，不能自动赢。
```

数据契约详见：

```text
docs/finance/finance-evidence-mvp.md
docs/finance/finance-data-asset-contract.md
docs/finance/finance-decision-question-contract.md
```

## 6. 当前运行链路

```text
离线事实库
-> dataMenu（固定数据菜单）
-> agentEvidenceSlice（专家证据切片）
-> agentOpeningBrief（系统输入卡，非 agent 输出）
-> phase0 roundStartAgentOutput（真实结构化卡片）
-> stanceCard / challengeCard（N58 起当前结构）
-> phase1+ action（局内行动，引用 claimId / challengeId）
-> financeEvidenceAdoption（裁判采信链）
-> combat projection / KDA / hard winner
-> Web 中文审计
```

关键规则：

- `agentOpeningBrief` 是系统输入卡，不能冒充 agent 输出。
- `roundStartAgentOutput` 必须来自 response artifact 或 fixture response。
- `roundStartAgentOutput` 必须通过结构校验、证据白名单、允许立场和 targetClaimId 校验，才可进入后续 phase action。
- phase1+ 只允许引用当前 agent 自己的 claimId / challengeId，不允许重写完整金融论文。
- 裁判必须记录采信证据、未采信证据、缺失证据和 score cap。
- 没有 `acceptedEvidenceRefs`，不能判金融胜利。
- hard winner 仍只来自硬条件，不来自 LLM、金融解释或前端。

## 7. Web 审计验收

`/hex-lab/match` 默认应能按中文读懂：

```text
本 round 决策题
-> 谁提出了什么 stance
-> stance 引用了哪些 evidence
-> challenge 攻击了哪个 claim
-> 哪些证据被采信 / 拒绝
-> 哪些缺口限制了结论
-> 金融层为什么成立或不成立
-> CS 层为什么产生击杀 / 压制 / 退让
-> hard winner
-> 技术细节
```

失败现象：

- 系统输入卡被当成 agent 原始输出。
- phase1+ 继续写大段金融作文。
- 裁判只显示字段存在，不说明采信了哪条证据。
- 没有 accepted evidence 却判金融胜利。
- 用代理事实冒充完整基本面判断。
- 前端编造 trace 里没有的裁判理由。

## 8. 后续原则

下一步进入 N57，不继续把 N55 后 combat 补丁写成当前主线。N56 已解决“问题怎么问”，下一步必须解决“数据够不够”：按 N56 的必需证据结构扩充数据菜单、提取派生指标、生成覆盖率报告，再决定是否继续打磨战斗投影。

```text
N56：决策题与立场 / 挑战契约。（已完成第一版）
N57：证据菜单与 Fact Bank v2。（已完成第一版覆盖升级）
N58：Phase0 Stance Card / Challenge Card。（已完成第一版）
N59：金融裁判证据绑定重写。
N60：金融结果与 Combat Projection 解耦。
N61：Evidence-bound Round v1 小样本验收。
```
