# N56-N61 Evidence-bound Round Roadmap

本文是 Finance Major 在 N55 后的正式路线。它不是路线宣言，而是后续实现必须遵守的工程依赖链契约。当前状态：N56 已完成第一版，N57 前置数据源探测已完成，N57 Fact Bank v2 已按原路径完成第一版覆盖升级；当前环境外部网络受限，本次生成保留 FRED / BaoStock 旧快照升级事实，并把 SHFE / INE / World Bank / UN Comtrade 写为明确 unavailable，联网环境重跑 collector 后可刷新真实观测。

核心结论：

```text
N56 已定义投资决策题、允许立场和必需证据，并接入 Dust2 有色材料、finance duel、prompt 和 Web 审计。
N57 按 N56 的必需证据补厚数据、提取低成本事实、生成派生指标和 Fact Bank v2。
N58 让 phase0 只能基于 N56/N57 的 schema 和 evidence 生成 stanceCard / challengeCard。
N59 让裁判只采信 claim 与 evidence 合法绑定的内容。
N60 让金融结果只能通过受限接口影响战斗投影。
N61 用一个小样本证明整条链真的跑通。
```

如果某个 N 的阻断条件没有解决，不能靠下一个 N 的 prompt、Web 展示或 combat 阈值补过去。

## 1. 当前问题

N55 后对局暴露出一个根本问题：金融底座未闭环。

典型失败形态：

```text
裁判输出 challenge_landed 或 thesis_defended。
但 acceptedEvidenceRefs 为空。
金融分仍放大战斗 margin。
Web 看起来有金融胜负，实际没有证据采信链。
```

这不是 combat 阈值问题，也不是 Web 展示问题，而是金融裁判还在用“意图、角色任务、缺失证据、泛化风险提示”冒充投资判断成立。

必须改成：

```text
固定数据菜单
-> 决策题 round
-> 立场方 stance
-> 挑战方 challenge
-> 裁判采信 accepted / rejected / missing / score cap
-> 金融结果只提供主动权和战斗投影权限
-> CS 行动层决定击杀 / 压制 / 退让
-> hard winner 仍来自硬条件
```

## 2. 总依赖链

| N | 必须输入 | 必须输出 | 不能进入下一步的阻断条件 |
|---|---|---|---|
| N56 | Dust2 有色任务、行业判断目标、现有资产和事实库边界 | `decisionQuestion`、`allowedStance`、`requiredEvidenceSchema`、`challengePolicy`、Dust2 6 个开放决策题 | 已完成第一版；若新地图仍是证明题，不得进入 N57 |
| N57 | N56 的 `requiredEvidenceSchema` 和当前 fact bank | 扩充后的 `dataMenu`、提取 / 派生事实、Fact Bank v2、coverage report | 已完成第一版覆盖升级；若联网重跑后仍无法形成新增源观测，N58 只能把对应证据作为 unavailable / score cap 使用 |
| N58 | N56 的题目契约和 N57 的 evidence | `stanceCard`、`challengeCard`、结构化 claim / evidence / reasoning bridge | phase0 仍自然作文；agent 能新增 evidence；challenge 不绑定 claimId |
| N59 | N58 的结构化卡片和 N57 的 Fact Bank v2 | `acceptedEvidenceRefs`、`rejectedEvidenceRefs`、`missingEvidenceApplied`、`scoreCaps`、金融结果 | 无 accepted evidence 却判金融胜负；只看字段存在或话术强弱 |
| N60 | N59 的金融结果和 combat effect 权限 | 金融结果到战斗投影的受限接口 | combat 直接读金融作文分；金融无采信仍放大战斗 margin |
| N61 | N56-N60 的完整链路 | Evidence-bound Round v1 验收报告 | Web 不能回答谁主张、谁挑战、哪些证据采信 / 拒绝、为什么产生战斗投影 |

## 3. N56：决策题与立场 / 挑战契约

目标：把金融 round 从证明题改为投资决策题，并且提前定义本题需要哪些证据。

N56 不是简单改名。它必须产出后续 N57 数据补厚的输入规格。

交付：

```text
金融层命名改为 stance side / challenge side。
CS 层继续保留 attack / defense。
每个 round 固定 decisionQuestion，不预设看多或看空。
每个 round 定义 allowedStance。
每个 round 定义 requiredEvidenceSchema。
每个 round 定义 challengePolicy。
Dust2 有色 6 个 round 全部改成开放决策题。
```

`requiredEvidenceSchema` 最少包含：

```text
requiredKey：证据需求，例如 commodity_price、macro_demand、equity_performance、valuation、risk、supply_inventory。
requiredForClaimTypes：限制哪些 claimType。
minimumFactCount：最低事实数量。
preferredSources：优先数据源。
fallbackSources：可接受代理源。
missingEffect：缺失时触发的 score cap、置信度上限或投影限制。
notWinCondition：明确缺失证据不能让 challenge 自动获胜。
```

`challengePolicy` 最少包含：

```text
challenge 必须绑定 targetClaimId。
challenge 必须说明 challengeType。
challenge 不能只说“数据不足”。
challenge 只能攻击证据缺口、代理错配、时间窗口错配、推理桥断裂、风险收益不成立或替代解释。
```

成功标准：

```text
当前执行文档不再要求守方证明上行、攻方反驳上行。
Dust2 有色 6 个 round 全部是开放决策题。
每个 round 都有 requiredEvidenceSchema。
数据不足只能触发置信度上限、score cap 或可执行性降级，不能直接赢。
```

阻断条件：

```text
如果 round 没有 requiredEvidenceSchema，不能进入 N57。
如果 allowedStance 不包含看多、看空、中性、结构性分化、条件判断和暂不交易，不能进入 N58。
如果 challenge 仍可泛泛攻击“数据不足”，不能进入 N59。
```

## 4. N57：数据菜单扩充与 Fact Bank v2

当前第一版产物：

```text
data/materials/generated/finance/fact-bank/dust2-nonferrous/latest.json
data/materials/generated/finance/fact-bank/dust2-nonferrous/coverage-report.json
data/materials/generated/finance/maps/dust2-nonferrous/round-evidence-packs.json
```

注意：N57 没有新增 `fact-bank-v2` 平行库，而是覆盖升级原 `latest.json`。本次受 Codex 环境外部网络限制，生成结果中 FRED / BaoStock 使用旧快照升级保底，SHFE / INE / World Bank / UN Comtrade 以 unavailable 事实保留采集失败原因；这不是成功观测，应在联网环境重跑 collector 后刷新。

目标：按 N56 的 requiredEvidenceSchema 补厚数据底座，让 agent 在系统给定的数据菜单内判断，而不是自己发明数据框架。

N57 不是单纯字段升级。N57 的主任务是：

```text
扩充数据菜单。
提取低成本可审计数据。
生成派生指标。
生成 Fact Bank v2。
输出证据覆盖率报告。
```

N57 正式实施前必须先通过 source probe（数据源探测）闸门。当前前置探测已生成：

```text
data/materials/generated/finance/source-probes/dust2-nonferrous/source-probe-report.json
docs/finance/n57-data-source-probe-report.md
```

探测结论必须作为 N57 输入，而不是另写一套数据源愿望清单：

| source | 当前 N57 决策 | 口径 |
|---|---|---|
| FRED | `ready_for_n57` | 全球金属价格和宏观代理主路径。 |
| BaoStock | `ready_for_n57` | A 股公司行情、成交和估值代理主路径。 |
| SHFE | `usable_with_cap` | 通过 AKShare 采集器可取部分期货日行情 / 结算数据；仓单 / 库存路径存在部分失败。 |
| INE | `usable_with_cap` | 国际铜相关交易数据可作商品价格上下文，质量需上限。 |
| GFEX | `candidate_only` | 碳酸锂 / 工业硅偏候选方向，不直接成为 Dust2 有色 v1 核心证据。 |
| World Bank | `usable_with_cap` | 无 key public API，可做年度宏观背景，不支撑短周期国内供需。 |
| UN Comtrade | `usable_with_cap` | 2025 指定 HS 可能为空，2024 可返回贸易记录；只作滞后贸易线索。 |
| NBS / GACC / USGS / SMM / CNINFO | `candidate_only` | 本前置未采集，不得包装为已接入事实。 |

AKShare 是可用采集入口。任何通过 AKShare 取得的数据都必须写清 sourcePublisher、accessProvider、collector、endpoint、字段口径和时间；质量等级由具体 endpoint 与字段稳定性决定，不由 AKShare 名称一刀切决定。

第一版必须优先做已有数据源的深加工：

```text
FRED：铜、铝、镍、锌价格，以及可稳定取得的美元、利率、通胀、全球宏观代理。
BaoStock：有色公司池收益、相对沪深300、成交额、换手、PE/PB、估值分位、波动、回撤。
UN Comtrade：成功则作为贸易线索；失败则保留 unavailable_observation，不能当真实贸易事实。
```

第一版可新增或验证的低成本源：

```text
World Bank：长期宏观和国家级指标，优先验证无 key 稳定 API。
USGS：低频矿产供给背景，优先作为年度结构事实。
NBS：权威中国宏观和工业数据，先验证接口 / 抓取稳定性。
SHFE：有色价格、成交、持仓、仓单或库存锚点；若不免费稳定，先作为候选源和 missingEvidence，不冒充已接入。
```

派生指标必须覆盖：

```text
1 / 3 / 6 / 12 个月变化。
36 个月分位。
波动率。
最大回撤。
多金属同步 / 背离。
公司相对沪深300表现。
估值分位。
数据可用性和更新时间。
```

Fact Bank v2 每条 fact 至少包含：

```text
factId
source
sourceType
collector
metricName
entity
value
unit
period
transform
reliabilityTier
allowedClaimTypes
notAllowedClaimTypes
interpretationHint
scoreCapPolicy
rawHash
generatedAt
```

覆盖率报告必须按 N56 的 `requiredEvidenceSchema` 输出：

```text
requiredKey 是否覆盖。
覆盖了多少条 fact。
哪些 source 可用。
哪些 source 不可用。
缺口触发什么 score cap。
哪些 round 仍只能做弱判断。
```

成功标准：

```text
每条证据都说明能证明什么、不能证明什么。
每个 Dust2 有色 round 至少能看到 commodity、equity、valuation、risk 中的若干可用证据。
agent 不再把“我还需要某某数据框架”作为主回答。
evidence pack 能支持有限判断，而不是只支撑无法判断。
```

阻断条件：

```text
如果 N57 只改 allowedClaimTypes 字段而没有生成新派生指标，不能进入 N58。
如果 coverage report 显示某个 round 没有最低事实覆盖，不能把该 round 标为可验收。
如果 fact 没有 allowedClaimTypes / notAllowedClaimTypes，不能进入 N59。
```

## 5. N58：Phase0 Stance Card / Challenge Card

目标：phase0 输出结构化投资判断卡，严格消费 N56 的题目契约和 N57 的 evidence，不再生成自然作文。

交付：

```text
roundStartAgentOutput 升级为 stanceCard 或 challengeCard。
stanceCard 固定 direction、target、horizon、confidence、positionSuggestion、coreClaims、evidenceRefs、reasoningBridge、riskBoundaries、invalidatingConditions。
challengeCard 固定 targetClaimId、challengeType、challengedAssumption、evidenceRefs、proxyMismatch、confidenceReduction。
phase1+ 只允许引用 phase0 的 claimId 或 challengeId。
```

stanceCard 的每个 `coreClaim` 必须包含：

```text
claimId
claimType
claimZh
evidenceRefs
reasoningBridge
confidence
unsupportedIfEvidenceRejected
```

challengeCard 的每个 challenge 必须包含：

```text
challengeId
targetClaimId
challengeType
evidenceRefs
challengeReasonZh
expectedEffect
```

成功标准：

```text
phase0 是完整但受控的投资判断。
phase0 不能新增 evidence，只能选择 N57 fact bank 中的 evidenceRefs。
phase1+ 是行动，不重写金融论文。
Web 审计能区分真实立场、真实挑战、系统输入卡和裁判后处理。
```

阻断条件：

```text
如果 phase0 没有 claimId / evidenceRefs / reasoningBridge，不能进入 N59。
如果 challenge 不绑定 targetClaimId，不能进入 N59。
如果 phase1+ 仍新增投资立场或 evidence，不能进入 N60。
```

## 6. N59：金融裁判证据绑定重写

目标：金融裁判从意图评分改为证据约束裁判。

N59 的核心不是“更聪明地评分”，而是机械校验：

```text
claim 是否绑定 evidence。
evidence 是否存在。
claimType 是否被 evidence.allowedClaimTypes 支持。
是否把代理事实过度外推。
missingEvidence 是否来自 requiredEvidenceSchema。
```

交付：

```text
裁判输出 acceptedEvidenceRefs、rejectedEvidenceRefs、missingEvidenceApplied、scoreCaps、stanceScore、challengeScore、financialResult、combatEffectAllowed。
裁判检查 claimType 是否被 evidence.allowedClaimTypes 支持。
不存在 evidence id 的 claim 无效。
代理事实过度外推进入 rejected。
missing evidence 只能触发 score cap 或 projection cap。
```

硬规则：

```text
没有 acceptedEvidenceRefs，不能判金融胜利。
没有 reasoningBridge，不能判强金融胜利。
不存在 evidence id 的 claim 直接 unsupported。
只有 missingEvidence 不能让 challenge 自动赢。
只写“数据不足”不能形成正向 challenge 分。
```

成功标准：

```text
抽样 20 个 finance verdict，不得出现无 accepted evidence 却判金融胜负。
金融胜负必须追溯到 claim + evidence + reasoningBridge。
缺失证据只能影响 score cap，不能变成正向事实。
rejected evidence 必须说明是 hallucinated id、proxy mismatch、overreach、horizon mismatch 还是 role mismatch。
```

阻断条件：

```text
如果裁判仍用 finance_intent_present 或 narrative strength 给金融胜利，不能进入 N60。
如果 accepted / rejected / missing / scoreCaps 不能在 trace 和 Web 中追溯，不能进入 N61。
```

## 7. N60：金融结果与 Combat Projection 解耦

目标：防止金融虚分继续放大战斗击杀。

金融裁判只允许输出：

```text
stance_survives
challenge_breaks_stance
contested
no_financial_win_allowed
```

combat 只能消费 `combatEffectAllowed`：

```text
no_effect
minor_delay
pressure
force_reposition
map_control
possible_kill
```

固定规则：

```text
没有金融采信时，金融不能放大 combat margin。
没有金融采信时，金融不能解释击杀。
CS 枪线、站位、目标暴露仍可独立产生击杀。
金融成立但地图位置不允许时，也不能强行击杀。
```

成功标准：

```text
金融无采信时，combat 不再显示成金融胜利。
击杀解释能分清金融主动权和 CS 执行事实。
combat 不再读取金融作文分数直接拉爆 margin。
Web 能分开展示金融链和 CS 链。
```

阻断条件：

```text
如果 combat 仍直接读取 businessIntent / actionRationaleZh 的强弱加杀伤分，不能进入 N61。
如果 Web 仍把纯 CS 击杀包装成金融胜利，不能进入 N61。
```

## 8. N61：Evidence-bound Round v1 小样本验收

目标：用一个最小闭环验证新金融底座，而不是扩地图。

固定样本：

```text
地图：Dust2 有色
任务：行业判断
Round：未来 1-3 个月 A 股有色相对沪深300是否应超配？
```

验收前置：

```text
N56 的 decisionQuestion 和 requiredEvidenceSchema 已冻结。
N57 至少准备 20-40 条结构化 evidence。
N58 能输出 stanceCard / challengeCard。
N59 能输出 accepted / rejected / missing / score cap。
N60 能把金融结果限制为 combatEffectAllowed。
```

证据最低结构：

```text
商品价格：至少 4-8 条。
权益表现：至少 4-8 条。
估值 / 风险：至少 4-8 条。
宏观或供需代理：至少 4-8 条；若不可用必须形成 missingEvidence 和 scoreCap。
不可用事实：必须明确 unavailable，不得当成事实。
```

验收内容：

```text
立场方输出 stance card。
挑战方攻击具体 claimId。
裁判输出 accepted / rejected / missing / score cap。
phase1+ 只行动和引用 claim。
combat 只投影经过允许的金融结果和 CS 事实。
```

成功标准：

```text
Web 审计能回答：
谁提出了什么立场。
引用了哪些证据。
哪些证据被采信。
哪些证据被拒绝。
哪些缺口限制结论。
为什么金融层成立或不成立。
为什么战斗层发生击杀、压制或退让。
```

量化验收门槛：

```text
抽样 20 个 finance verdict：0 个无 accepted evidence 却判金融胜利。
抽样 10 个 phase0 输出：100% claim 有 claimId、claimType、evidenceRefs 或明确 unsupported。
抽样 10 个 challenge：80% 以上绑定 targetClaimId。
抽样 10 个 combat 解释：100% 能分清金融原因和 CS 原因。
```

失败标准：

```text
如果 agent 仍主要回答“无法判断”而不是有限 stance，N57 / N58 不合格。
如果 challenge 仍主要说“数据不足”，N56 / N58 不合格。
如果裁判仍无 accepted evidence 判金融胜负，N59 不合格。
如果战斗仍把金融无采信包装成金融优势，N60 不合格。
```

## 9. 当前暂停项

在 N56-N61 未完成前，暂停以下方向：

```text
继续调 combat 阈值。
扩 TMT、消费、医药地图。
扩完整赛事。
把 N55 后 combat 补丁继续写成当前主线。
用 Web 中文摘要包装无采信链的金融胜负。
```
