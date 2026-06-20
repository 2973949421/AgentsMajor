# N56-N61 Evidence-bound Round Roadmap

本文是 Finance Major 在 N55 后的正式路线。它不是路线宣言，而是后续实现必须遵守的工程依赖链契约。当前状态：N56 已完成第一版，N57 前置数据源探测已完成，N57 Fact Bank v2 已按原路径完成第一版覆盖升级；N57b 已广探 AKShare endpoint；N57c 已把当前比赛主路径收敛为 FRED + BaoStock + AKShare 三主源，并将 World Bank / UN Comtrade 冻结出 active evidence、coverage 和 round evidence packs。

核心结论：

```text
N56 已定义投资决策题、允许立场和必需证据，并接入 Dust2 有色材料、finance duel、prompt 和 Web 审计。
N57 按 N56 的必需证据补厚数据、提取低成本事实、生成派生指标和 Fact Bank v2。
N57b 已完成 AKShare endpoint 广探测，摸清期货、现货、行业、公司基本面、板块和资金等公开入口能取什么。
N57c 已用 FRED + BaoStock + AKShare 三主源覆盖升级现有 fact bank，并把 World Bank / UN Comtrade 从当前比赛主路径冻结。
N58 让 phase0 只能基于 N56/N57 的 schema 和 evidence 生成 stanceCard / challengeCard。
N59 已让裁判第一版只采信 claim 与 evidence 合法绑定的内容。
N60 继续让金融结果只能通过受限接口影响战斗投影。
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
| N57b | N57 现有事实库、AKShare 可用包、用户行研口径 | AKShare endpoint catalog / probe report，按 endpoint 标记 `ready_for_fact_bank`、`usable_with_cap`、`candidate_only`、`unavailable` | 若没有 endpoint 级字段、频率、来源发布方和 claim 边界，不得进入 N57c |
| N57c | N57b endpoint 探测结果、FRED / BaoStock 主路径 | 用 FRED + BaoStock + AKShare 三主源覆盖现有 `latest.json` 和 round evidence packs；World Bank / UN Comtrade 冻结为 candidate/frozen，不进 agent slice / judge 主路径 | 若仍把 frozen 源放进 active evidence pack，或仍缺 BaoStock 公司扩容 / 财报字段，不得进入 N59 |
| N58 | N56 的题目契约和 N57 的 evidence | `stanceCard`、`challengeCard`、结构化 claim / evidence / reasoning bridge | 已完成第一版；若 phase0 又回到自然作文、agent 能新增 evidence、challenge 不绑定 claimId，则不得进入 N59 |
| N59 | N58 的结构化卡片和 N57 的 Fact Bank v2 | `acceptedEvidenceRefs`、`rejectedEvidenceRefs`、`missingEvidenceApplied`、`scoreCaps`、stanceScore / challengeScore、financialResult、combatEffectAllowed | 已完成第一版；若无 accepted evidence 仍判金融胜负，或 Web/trace 不能追溯采信链，则 N59 不合格 |
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

注意：N57 没有新增 `fact-bank-v2` 平行库，而是覆盖升级原 `latest.json`。当前联网生成结果包含 23 条事实，其中 21 条为 `offline_observation_fact`，2 条为 `unavailable_observation`；coverage report 显示 N56 的 18 个 required evidence item 中 12 个已覆盖、6 个仍缺失。缺口主要集中在公司财务利润锚点、风险执行规则和缺失证据政策事实，不应由 FRED / BaoStock / SHFE / UN 数据强行冒充。

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

## 5. N57b：AKShare Endpoint 广探测

目标：不再继续扩散 World Bank / UN Comtrade 等弱相关源，先把 AKShare 这个公开数据入口集合吃深。N57b 不覆盖 fact bank，不改 runtime，不改 N58。它只回答一个问题：AKShare 到底能稳定取到哪些有色投研可用数据。

默认判断：

```text
FRED：照旧作为全球金属价格锚，不在 N57b 重做。
BaoStock：照旧作为 A 股公司数据主路径，N57c 再扩公司池和财报字段。
AKShare：作为 endpoint 集合激进探测；每个 endpoint 单独判断可用性。
World Bank / UN Comtrade：从当前主线冻结，不再作为 N57b 探测重点。
```

N57b 探测范围：

```text
期货：SHFE / INE 日行情、结算、成交、持仓、仓单、库存。
现货 / 商品：有色现货价格、商品价格指数、生意社 / 东方财富 / 新浪等可用入口。
公司基本面：利润表、资产负债表、现金流、主要财务指标、估值指标、分红或公告摘要如可取。
行业 / 板块：有色板块指数、概念板块、成分股、行业涨跌、相对沪深300。
资金 / 交易：成交额、换手、主力资金、北向或融资融券如可取。
宏观公开入口：PMI、PPI、工业相关公开接口如 AKShare 能稳定返回。
```

每个 endpoint 必须输出：

```text
endpointName
sourcePublisher
accessProvider = AKShare
collector = akshare_python_package_v0
testedParams
returnedRows
returnedFields
samplePeriod
frequency
entityCoverage
supportsRequiredEvidenceKeys
allowedClaimTypes
notAllowedClaimTypes
decisionForN57c
failureReason
```

`decisionForN57c` 枚举：

```text
ready_for_fact_bank：字段、频率、来源和样本都清楚，可进入 N57c。
usable_with_cap：可用但口径弱、字段不稳或频率不足，只能降权进入。
candidate_only：候选观察，不进当前比赛主路径。
unavailable：不可用或无记录。
blocked：依赖登录、付费、反爬或授权，不尝试绕过。
```


当前 N57b 探测结果：

```text
总端点：30
ready_for_fact_bank：6（SHFE 日行情 / 结算 / 仓单、INE 日行情 / 结算、Sina 财务摘要）
usable_with_cap：5（期现基差、北向 / 融资融券、PMI / 工业增加值等代理）
candidate_only：3（GFEX、SHMET 新闻等候选）
unavailable：16（多数 Eastmoney 行业 / 明细财报 / 部分资金端点本轮不可用或超时）
```

机器报告：`data/materials/generated/finance/source-probes/dust2-nonferrous/akshare-endpoint-probe-report.json`。

人类报告：`docs/finance/n57b-akshare-endpoint-probe-report.md`。
成功标准：

```text
生成 AKShare endpoint 级探测 JSON 和人类报告。
至少覆盖期货、现货/商品、公司基本面、行业/板块四类尝试。
每个可用 endpoint 都明确 sourcePublisher，不把 AKShare 写成事实发布方。
明确哪些 endpoint 能进入 N57c，哪些只能 frozen/candidate。
```

禁止：

```text
不安装新依赖。
不抓登录、付费、cookie、token 或授权数据。
不把 endpoint 探测样本直接当 final fact bank。
不因为 AKShare 能返回字段就默认可采信。
```

## 6. N57c：三主源 Active Fact Bank 覆盖重建

目标：如果 N57b 结果可用，就把当前 Dust2 有色事实库主路径收敛为 FRED + BaoStock + AKShare。N57c 仍然覆盖原路径，不新建平行库：

```text
data/materials/generated/finance/fact-bank/dust2-nonferrous/latest.json
```

active / frozen 口径：

```text
active：FRED、BaoStock、AKShare 采集到且通过 endpoint 级校验和目标品种匹配的数据。
frozen：World Bank、UN Comtrade、NBS、USGS、CNINFO、SMM、GACC 等当前不进比赛主路径。
```

N57c 不等于删除历史登记。frozen 源可以留在 source registry 和历史 probe 报告里，但不能：

```text
进入 round evidence pack 主事实。
进入 agent evidence slice。
参与 N59 裁判 accepted evidence。
提高 coverage 统计。
被 Web 主审计显示成当前可采信事实。
```

三主源分工：

```text
FRED：全球铜、铝、镍、锌等价格锚，继续输出多窗口涨跌、分位、波动、回撤、同步 / 背离。
BaoStock：扩大 A 股有色公司池，补行情、成交、估值、相对沪深300、可取财报字段和财务摘要。
AKShare：按 N57b 结果接入期货、现货/商品、资金、宏观和公司基本面 endpoint；期货、仓单、基差事实必须按 CU/AL/ZN/NI/SN/PB/AU/AG/BC 等目标品种过滤后生成，不能把端点样本行直接当全品种事实。
```

BaoStock 的目标不是替代终端级数据库，而是在免费接口范围内尽量补：

```text
核心公司池从前 5 家扩到更完整有色公司池。
收益率、成交额、换手、PE/PB、估值分位、相对沪深300。
利润表、资产负债表、现金流、主要财务指标中能稳定取到的字段。
无法取得分产品、产量、成本、套保、矿山权益时，必须写成 missingEvidence / scoreCap。
```

AKShare 事实必须保留来源链：

```text
sourcePublisher：SHFE / INE / Eastmoney / Sina / 生意社 / 其他真实发布方。
accessProvider：AKShare。
collector：akshare_python_package_v0。
endpoint：具体函数名或 URL。
fieldDefinitions：字段口径。
observedAt / period：观测时间。
transform：派生方法。
```

N57c 成功标准：

```text
latest.json 只把 active 三主源作为当前比赛可采信事实；AKShare 期货、仓单和基差必须是目标金属匹配后的事实。
World Bank / UN Comtrade 不进入 active round evidence pack。
coverage-report 只按 active 三主源计算覆盖。
round-evidence-packs.json 不再混入 frozen 源。
每条 fact 有 entity / metricName / sourcePublisher / accessProvider / endpoint / allowedClaimTypes / notAllowedClaimTypes。
N58/N59 消费的 evidenceRefs 只来自 active facts 或明确 unavailable / missing policy。
```

阻断条件：

```text
如果 AKShare endpoint 没有字段、频率和目标品种匹配说明，不能进入 active。
如果 BaoStock 没有公司池扩容或财报字段尝试，不能宣称基本面补厚。
如果 World Bank / UN Comtrade 仍参与 active judge coverage，N57c 不合格。
如果 fact 仍缺顶层 entity 字段，N59 机械采信前必须补。
```

## 7. N58：Phase0 Stance Card / Challenge Card

目标：phase0 输出结构化投资判断卡，严格消费 N56 的题目契约和 N57 的 evidence，不再生成自然作文。第一版已落地为 stance side 先生成 5 张 `stanceCard`，challenge side 再基于合法 `claimCatalog` 生成 5 张 `challengeCard`。

交付：

```text
roundStartAgentOutput 升级为 stanceCard 或 challengeCard。
stanceCard 固定 direction、target、horizon、confidence、positionSuggestion、coreClaims、evidenceRefs、reasoningBridge、riskBoundaries、invalidatingConditions。
challengeCard 固定 targetClaimId、challengeType、challengedAssumption、evidenceRefs、proxyMismatch、confidenceReduction。
phase1+ 只允许引用 phase0 的 claimId 或 challengeId。
系统输入卡继续只作为 phase0 prompt 输入材料，不能冒充 stanceCard / challengeCard。
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

## 8. N59：金融裁判证据绑定重写

目标：金融裁判从意图评分改为证据约束裁判。

当前实现状态：N59 已完成第一版。Core 已新增金融证据裁判 helper，基于 N58 的 `stanceCard / challengeCard`、N57 的 Fact Bank v2 metadata 和 N56 的 required evidence schema 生成 accepted / rejected / missing / scoreCaps、stanceScore / challengeScore、financialResult 和 combatEffectAllowed。Combat resolver 已停止把 `finance_intent_present`、`businessIntent` 或 `actionRationaleZh` 当作正向金融分；这些字段只保留为审计文本。

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
如果裁判仍用 finance_intent_present 或 narrative strength 给金融胜利，N59 不合格，不能进入 N60。
如果 accepted / rejected / missing / scoreCaps 不能在 trace 和 Web 中追溯，N59 不合格，不能进入 N61。
N60 不得重新读取金融作文分；只能消费 N59 的 financialResult 和 combatEffectAllowed。
```

## 9. N60：金融结果与 Combat Projection 解耦

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

## 10. N61：Evidence-bound Round v1 小样本验收

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
N59 已能输出 accepted / rejected / missing / score cap 第一版。
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

## 11. 当前暂停项

在 N56-N61 未完成前，暂停以下方向：

```text
继续调 combat 阈值。
扩 TMT、消费、医药地图。
扩完整赛事。
把 N55 后 combat 补丁继续写成当前主线。
用 Web 中文摘要包装无采信链的金融胜负。
```
