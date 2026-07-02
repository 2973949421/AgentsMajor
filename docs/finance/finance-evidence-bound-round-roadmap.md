# N56-N65 Evidence-bound Round Roadmap

本文是 Finance Major 在 N55 后的正式路线。它不是路线宣言，而是后续实现必须遵守的工程依赖链契约。当前状态：N56-N61 已完成第一版闭环，N62 已完成 phase0 raw 金融卡到 submitted finance card 的经济裁剪提交门；外部静态审查指出当前最大偏差不是方向错误，而是 N60 安全隔离过头：金融证据链已可审计，但 phase0 有效观点火力没有真正作为 combat 主火力进入伤亡裁定。因此 N62-N65 不扩成长串路线，但必须按 PRO 修订为：N62、N63、N65-lite、N64、N65-full。N65-lite 是 N65 的前置薄层，不新增大阶段，只为 N64 提供压力归属 key。

核心结论：

```text
N56 已定义投资决策题、允许立场和必需证据，并接入 Dust2 有色材料、finance duel、prompt 和 Web 审计。
N57 按 N56 的必需证据补厚数据、提取低成本事实、生成派生指标和 Fact Bank v2。
N57b 已完成 AKShare endpoint 广探测，摸清期货、现货、行业、公司基本面、板块和资金等公开入口能取什么。
N57c 已用 FRED + BaoStock + AKShare 三主源覆盖升级现有 fact bank，并把 World Bank / UN Comtrade 从当前比赛主路径冻结。
N58 让 phase0 只能基于 N56/N57 的 schema 和 evidence 生成 stanceCard / challengeCard。
N59 已让裁判第一版只采信 claim 与 evidence 合法绑定的内容。
N60 已让金融结果只能通过受限接口影响战斗投影。
N61 已用 real provider 小样本验证链路；第 7 局 10/10 phase0 卡片可消费，N59/N60 安全链路有效，当前可以宣称 pass。
N62 已补齐 phase0 金融卡的 raw -> economy clipped submitted card -> judge 输入门。
N63 已完成第一版：submitted finance output 经 N59 裁判形成 financeFirepowerScore，并接回 combat totalScore，恢复“phase0 有效观点火力 60-70% + phase1+ CS 执行 30-40%”的主链口径。
N65-lite 必须在 N64 前先提供最小 duelPair / fireLane / pressureKey，否则持续压力会继续在 side-level 或 region-level 上污染归因。
N64 必须基于 N65-lite 的 pressureKey 做持续对枪压力、质量闸门和 Web 首屏审计闭环，证明同点位/开阔枪线不会长期纯压制，同时 Web 能看懂 raw / clipped / judge / combat 链。
N65-full 必须补齐 N 对 N / 1 对 N 的完整配对和归因规则，避免 side-level winner + 单 target + 单 killer 把多人混战压扁成伪 1v1。
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
| N60 | N59 的金融结果和 combat effect 权限 | 已完成第一版：`financeProjection`、金融分 audit-only、combat 总分只看 CS / 非金融旧兼容分 | 若 combat 再直接读金融作文分、金融无采信仍放大战斗 margin，则 N60 回归 |
| N61 | N56-N60 的完整链路 | Evidence-bound Round v1 验收报告 | 已完成 real provider 小样本验收；第 7 局 pass，10/10 phase0 卡片可消费，金融胜负硬门槛和金融 / CS 分离均达标。 |
| N62 | N58 的 raw phase0 card、经济 / 买型 / 装备预算、N57 evidence pack | `submittedFinanceOutputs`、raw/submitted diff、clipping audit；N59 judge 只读 submitted（已落地） | 若 judge 仍直接读 raw phase0 card，或经济裁剪只是 prompt 文案，不能进入 N63 |
| N63 | N62 submitted finance output、N59 accepted/rejected/missing、N60 projection gate、CS action score | 已完成第一版：`financeFirepowerScore.pressureScore / lethalScore / totalScore / appliedToCombatScore / blockedLethalScore` 进入 combat；finance 60-70%、CS 30-40%，但 kill 仍受 contact/lethal/casualty gate 限制 | 若 no accepted evidence 可产生金融 firepower，或 financeScore 回到 audit-only，N63 回归 |
| N65-lite | N63 combat firepower、contact candidates、agent positions/actions、cover/LoS | 最小 `duelPair / fireLane / objectiveExposure` 与 `pressureKey`；N64 只能基于这些 key 累积压力 | 若 N64 仍按 team/side/region 累积压力，N65-lite 不合格 |
| N64 | N65-lite pressureKey、持续接触压力、round quality、Web audit projection | 持续对枪压力、forced_back / casualty 收敛、Web 首屏链路：quality -> hard winner -> submitted finance -> combat -> raw 技术细节 | 若同点位/开阔枪线仍长期纯压制，或 Web 仍需要读 raw JSON 才能理解，N64 不合格 |
| N65-full | N64 pressure history、combat participants、role/equipment、assist/attribution history | 完整 1vN surrounded pressure、NvN 多枪线贡献、assist attribution、per-phase casualty cap 和去重后归因 | 若 N 对 N 仍只按 side-level winner 选一个 target / killer，或支援/IGL/多人夹击归因混乱，N65-full 不合格 |

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

#### fork-p1-finance-judge-balance 并行补丁

该 fork 是 N59 的窄修，不改变 N56-N58 输入契约，也不绕过 P0 round 质量闸门。它只修金融裁判平衡层的三类偏差：

```text
claimType 安全同义词可以归一，但必须写入 auditReasons，不能静默采信。
scoreCaps 必须真正封顶 stanceScore / challengeScore，不能只记录不生效。
missingEvidence-only challenge 只能形成 score cap / 降权提示，不能凭“缺数据”打出 challenge_breaks_stance。
```

新增硬门槛：

```text
stance_survives 必须同时有 accepted stance claim、accepted stance evidence，并且封顶后的 stanceScore 至少领先 15 分。
challenge_breaks_stance 必须同时有 accepted challenge、accepted challenge evidence，并且封顶后的 challengeScore 至少领先 15 分。
missing-only challenge 默认封顶到 35 分；即便重复指出多个缺口，也不得形成金融胜利。
configured_proxy_fact、缺关键 evidence key 或弱代理事实触发的 score cap 必须影响最终分数。
```

这意味着：如果一方只是更会指出数据缺口，但没有用合法证据击中具体 claim，它可以限制对方结论强度，却不能赢下金融层。相反，如果 claimType 只是字段命名偏差，例如 `commodity_price_signal` 与 `commodity_price_momentum`，系统可以在白名单内归一化并留下审计痕迹，避免真实模型因安全别名被误拒。

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
N60 已停止重新读取金融作文分；combat 只消费 N59 的 financialResult 和 combatEffectAllowed，并把实际应用写入 `financeProjection`。
```

## 9. N60：金融结果与 Combat Projection 解耦

目标：防止金融虚分继续放大战斗击杀。当前实现状态：N60 已完成第一版。Combat resolver 保留 `financeScore` 作为审计字段，但在 Finance Major 模式下 `totalScore` 不再加入金融分；新增 `financeProjection` 记录金融投影的 `appliedEffect`、`blockedEffects`、中文原因和是否允许解释击杀。

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
如果 combat 重新把 finance_intent_present、businessIntent、actionRationaleZh 或 N59 分数计入总分，N60 回归，不能进入 N61。
如果 Web 仍把纯 CS 击杀包装成金融胜利，不能进入 N61。
如果 `financeProjection` 缺失或不能说明 applied / blocked effect，不能进入 N61。
```

## 10. N61：Evidence-bound Round v1 小样本验收

目标：用一个最小闭环验证新金融底座，而不是扩地图。当前状态：real provider 样本已执行，整体 N61 状态为 `pass`。第 7 局真实 trace 中 10 条 phase0 输出全部可消费，5 张 stanceCard 和 5 张 challengeCard 均可追溯。

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
N60 已把金融结果限制为 combatEffectAllowed，并在 trace / Web 中展示 `financeProjection`。
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

当前验收结果：

```text
fixture 样本：2 个 round，30 个 finance verdict，10 个 claim，10 个 challenge，30 个 combat explanation。
无 accepted evidence 却判金融胜利：0。
claim 合规率：100%。
challenge 绑定 targetClaimId：100%。
金融理由 / CS 理由分离率：100%。
real provider：已执行，结论 pass。第 7 局 phase0 真实结构化卡片 10/10 可消费。
报告：docs/finance/n61-evidence-bound-round-validation-report.md。
机器结果：data/materials/generated/finance/validation/dust2-nonferrous/n61-evidence-bound-round-report.json。
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
## 12. N62：Phase0 金融经济裁剪提交门

目标：恢复 Finance Major 原始经济口径。Agent 在 phase0 可以生成 raw 金融观点，但进入 N59 裁判和 N63 战斗火力前，必须先按经济 / 买型 / 装备预算裁剪成 submitted finance card。

当前实现状态：N62B 已把提交门语义修正为 `rawFinanceOpinionZh` 原始金融观点文本 -> 经济裁剪后的 `submittedOpinionZh` 摘录与 `submittedTextSpanRefs` 标注 -> submitted structured card -> N59 judge。N59 新路径只读 `submittedFinanceOutputs`，并写入 `judge_input:submitted_finance_outputs` / `judge_input:submitted_finance_outputs_n62b` 审计原因。Raw 原文保留给 Web 高亮审计，不能绕过 submitted gate 进入 judge 或 combat。

交付：

```text
保留 phase0 raw stanceCard / challengeCard artifact。
新增 SubmittedFinanceOutput：submittedOutputId、rawOutputId、agentId、cardKind、rawFinanceOpinionZh、submittedOpinionZh、submittedTextSpanRefs、rawOpinionLinkStatus、unlocatedSubmittedItems、submittedStanceCard / submittedChallengeCard、buyType、economyPosture、loadoutPackage、outputBudget、clippingTier、omittedFields、cappedFields、rawFingerprint、submittedFingerprint、gateSummary。
补充追溯字段：combatEffectCap、judgeInputRef、factBankSnapshotId、decisionQuestionId、evidenceMenuVersion、clippingPolicyVersion、rawParseStatus、submittedUsableForJudge、submittedUsableForCombat。
N59 judge 输入从 roundStartAgentOutputs 改为 submittedFinanceOutputs。
Web 默认展示一份 rawFinanceOpinionZh 原始金融观点，并用颜色标明 submitted 保留、裁掉、封顶和禁用的原文片段；normalized card、submitted JSON、artifact id 和 enum 进入技术细节折叠。
```

裁剪规则：

```text
full_buy / rifle_full：最多保留 2-3 个 claim，每个 claim 2-3 条 evidence，confidence cap 0.9，combatEffectCap 最高 possible_kill。
standard：最多 2 个 claim，每个 claim 1-2 条 evidence，confidence cap 0.75，combatEffectCap 最高 possible_wound / forced_back。
force / light / pistol armor：最多 1 个 claim + 1 条核心 evidence，只能中低仓位建议，confidence cap 0.6，combatEffectCap 最高 suppression / forced_back。
eco：只保留 1 个观察型或风险型 claim，不能形成 possible_kill finance firepower，confidence cap 0.45，combatEffectCap 最高 weak_pressure。
full_eco / save：只保留 auditSummary / weak stance，最多 minor_delay / low pressure。
```

硬边界：

```text
裁剪只能按 deterministic budget policy 删减、截断、降 confidence、限制 combatEffectCap。
裁剪不能扫描 Fact Bank 后替 agent 挑更优 evidence。
裁剪不能删除会让 agent 显得更差的 evidence，除非它超出预算且按原始顺序或 agent 显式 priority 被裁掉。
裁剪不能新增 claim、evidence、reasoningBridge、targetClaimId 或结论。
裁剪不能把低质量 raw card 修成高质量 submitted card；Finance clipping is budget truncation, not semantic improvement。
Judge 和 combat 只消费 submitted 结构与 submitted 文本摘录；Web 主审计只展示一份 raw 原文并高亮 submitted 摘录，raw JSON / normalized card 只用于折叠排查。
```

challenge 特殊边界：

```text
如果 challengeCard 的 targetClaimId 指向的 raw claim 在对方 submitted card 中被经济裁剪掉，该 challenge 变为 orphaned_challenge。
系统不能把 orphaned challenge 自动改指向别的 claim。
orphaned_challenge 可进入 rejected / not_applicable audit，但不给 challenge specificity 分，也不给 combat firepower。
Web 必须显示 target claim clipped out before judge。
```

成功标准：

```text
同一 raw card 在 full buy 与 eco 下生成不同 submitted card。
N59 accepted / rejected / missing 只基于 submitted card。
裁剪不允许提高 raw card 的语义质量。
Web 能区分 agent 原始输出、系统经济裁剪和真正进入 judge 的内容。
测试覆盖：raw evidenceRefs = [unknownEvidence, acceptedEvidence] 且预算只保留 1 条时，submitted 必须按原始顺序保留 unknownEvidence，不能自动跳到 acceptedEvidence；除非 agent raw 中显式 priority 指向 acceptedEvidence。
```

## 13. N63：Finance Firepower 接回 Combat 主链路

目标：修正 N60 过度隔离。金融裁判仍不能写 kill / winner，但 N59 采信后的 submitted 金融观点必须重新成为 combat 主火力。

交付：

```text
新增或显式固化 financeFirepowerScore。
financeFirepowerScore.pressureScore：可用于 suppression / forced_back，但受 financeProjection 与 combat gate 限制。
financeFirepowerScore.lethalScore：可用于 wound / kill 候选，但必须同时通过 contact gate、lethal gate、casualty gate。
financeFirepowerScore.totalScore：归一化到 0-65。
financeFirepowerScore.caps：记录 combatEffectCap、scoreCapPolicy、missing/rejected/unavailable 产生的限制。
保留 tacticalExecutionScore：0-35。
combat 总压力 = financeFirepowerScore.totalScore + tacticalExecutionScore，并写入 audit。
financeProjection 继续存在，但它是解释和权限层，不是唯一金融接入口。
```

financeFirepowerScore 来源：

```text
card 结构合法：0-5。
accepted evidence 覆盖：0-25。
reasoningBridge 清晰度：0-12。
challenge specificity / targetClaimId 命中：0-10。
riskBoundary / invalidatingConditions：0-6。
decisionQuestion / horizon / target relevance：0-7。
missing / rejected / unavailable / score cap：负向封顶或扣分。
```

硬规则：

```text
financialResult != combat result。
financialResult = stance_survives / challenge_breaks_stance 只表示金融层站得住或挑战击中，不自动产生击杀。
financialResult = contested 也不等于 0 firepower；只要存在 accepted evidence 与部分 reasoning，可形成 capped pressure firepower。
no accepted evidence：financeFirepowerScore.pressureScore / lethalScore 均为 0，不得产生金融火力。
accepted evidence + eco / full_eco：pressureScore 可以存在，但 lethalScore 被 economy combatEffectCap 限制。
rejected evidence 不给火力；missing evidence 只能降 cap，不能单独支持金融胜负。
cover_blocks_lethal / distance_exceeds_lethal_gate：金融火力只能压制或迫退，不能穿掩体乱杀。
kill 仍必须通过 contact gate、lethal gate、casualty gate。
```

测试矩阵：

```text
strong finance + weak CS：accepted evidence 高，但隔掩体 / 远距离，只能 suppression / forced_back，不 kill。
strong finance + strong CS：accepted evidence 高，近距离 / open line / active duel，可 wound / kill。
weak finance + strong CS：no accepted evidence，但贴脸 active duel，可由 CS execution 造成 kill，但 audit 不能写 finance kill。
missing-only finance + average CS：不能 financial win，不能 finance lethal，只能低压制或无效果。
rejected evidence + strong wording：中文话术再强也不给 finance firepower。
eco submitted card + strong raw card：raw 强不算，submitted cap 后只能 pressure。
```

成功标准：

```text
相同 CS 站位下，accepted submitted evidence 更强的一方获得更高 firepower。
无 accepted evidence 仍不能金融胜利或金融 lethalScore。
近距离 / 开阔枪线 / 包点入口接触时，finance firepower 与 CS 执行能共同推动 forced_back / casualty。
```

## 14. N65-lite：最小 duel pair / fire lane pressure key

目标：在 N64 压力收敛前先建立最低限度的对枪配对层。N65-lite 不做完整 NvN 模型，只负责让持续压力知道“谁和谁、在哪条枪线、因为什么持续接触”。

交付：

```text
ContactCandidate：agentA、agentB、contactType、distance、lineOfSight、coverState、actionMatch、roleMatch、lethalEligible、pressureEligible。
DuelPair：pairId、primaryAgentId、targetAgentId、laneId、objectiveId、directnessScore、lethalGateStatus、pressureKey。
pressureKey 只能来自 duelPairId / fireLaneId / objectiveExposureId / cellContactId，不允许只用 team / side / region。
N64 pressure accumulation 必须消费 pressureKey。
```

硬边界：

```text
N65-lite 不负责完整 1vN surrounded pressure、crossfire angle separation、escape route 或 assist attribution。
N65-lite 只保证 N64 不再把压力累积到 side-level。
支援贡献者 / IGL 在 N65-lite 中可以成为 contributor，但默认不成为 primary duelist，除非没有其他 direct candidate。
```

成功标准：

```text
同一 A long 枪线连续接触，pressure history 绑定到具体 pair / lane，而不是 attack side vs defense side。
Web / trace 能看到 pairId、laneId 或 objectiveExposureId。
后续 N64 无需重写 pressure history key 即可继续演进。
```

## 15. N64：Combat 压力收敛与审计首屏

目标：不再靠继续调 kill 阈值解决观感，而是让持续对枪有确定性结果，并让人类能一眼读懂整条链。

交付：

```text
deterministic combat pressure：同点位、包点入口、开阔枪线连续接触会按 N65-lite pressureKey 累积压力。
pressure 只能升级为 suppression / forced_back / casualty 中符合 gate 的结果；隔掩体远距离仍不能乱杀。
wound 第一版只作为 audit-only intermediate effect，不引入 HP / injury 状态机。
final phase 空转、no_active_combat_action 过多、C4 非包点折返必须进入 actionQualityWarning / urgencyFailure，不自动变成 invalid_round。
Web 首屏顺序固定为：roundQuality -> hardWinner -> submitted finance adoption -> combat firepower / CS execution -> player phase timeline -> raw 技术细节。
N61 验收脚本增加 N63/N64/N65 检查：finance firepower 是否应用、同点位长期纯压制是否出现、duel pairs / fire lanes 是否提供、Web projection 是否提供链路字段。
```

pressure reset / decay：

```text
reset：pair 不再 contact、LoS 被 cover / smoke / wall 切断、任一方 forced_back 成功、任一方 rotate 离开 fire lane、victim 已 casualty、new round starts。
decay：contact 断开 1 phase，pressure -X；contact 断开 2 phase，pressure 清零。
pressure 不得跨不同 lane / objectiveExposure 迁移。
```

质量边界：

```text
provider / schema / phase0 invalid：可以导致 invalid_round。
tactical bad choice：进入 actionQualityWarning / urgencyFailure，通常不导致 invalid_round。
final phase T 有 C4 在包点却不 plant：这是战术失败，应让 defense 正常赢 timeout/no_plant，不让 attack 逃避失败。
```

成功标准：

```text
同点位或开阔枪线连续 2-3 phase active duel，不再无限 contested_suppression。
远距离隔掩体、只 known enemy、只 same_region 仍不能 kill。
A 点 pressure 不会在双方转点后污染 B 点接触。
Web 不需要读 raw JSON 就能回答：谁的观点火力更强、谁的行动位置更好、为什么压制/退让/击杀。
```

N64 implementation note（2026-06-28）：第一版已按 pressureKey 增加 pressure history helper、resolver pressure audit、round runner accumulation / decay / reset，以及 Web / N61 可见性；不改 N59、N62D、N63 公式和 combat gate。

## 16. N65-full：N 对 N / 1 对 N 对枪配对与归因

目标：补齐多人接触模型。当前 combat 仍容易把多人接触压扁成“side-level winner -> losing side 选一个 target -> winning side 选一个 killer”。N65-full 不改变 N63 的金融火力和 N64 的压力收敛，而是在 contact 内建立完整的 duel pairing / fire lane pairing 与多人归因。

交付：

```text
1v1：按 financeFirepower + tacticalExecution + lethal gate 判主 duel。
1vN：生成 surrounded pressure；单人若无 cover / escape / strong firepower，应更容易 forced_back / wound_pressure / killed。
NvN：按距离、枪线、同点位、包点入口、角色动作生成若干 duel pairs / fire lanes。
每个 agent 每 phase 可主参与有限 pair；多余贡献转为 assist / suppression。
每个 victim 每 phase 最多最终落账一次 casualty；保留 dedupe 后归因历史。
```

归因规则：

```text
killer 优先来自 direct duel pair 中的 active duelist：entry / star rifler / AWPer / rifler。
支援贡献者 / IGL 默认进入 assist / suppression。
支援贡献者 / IGL fallback killer 必须同时满足：lethal gate passed、direct contact exists、no entry/rifler/AWPer direct candidate、actionType 不是纯 gather_info / rotate / map_control，并写明 sole_direct_candidate_allowed。
AWPer long-range kill 必须满足：open line、distance in AWP lethal band、cover not blocking lethal、actionType in watch_angle / peek / seek_duel。
多人夹击时，主杀来自最强直接枪线，其他有效枪线进入 assisterAgentIds 或 suppression reasons。
objective actor 暴露、C4 carrier、plant / defuse 行为提高 target vulnerability，但不能绕过 lethal gate。
```

成功标准：

```text
1vN 不再只表现为普通 side score 小幅优势，而能解释“被多人夹击”。
NvN 不再只选一个笼统 target / killer；审计能看到 duel pairs / fire lanes / assist contributors。
同一 victim 同 phase 只落账一次 casualty，被 dedupe 删除的 casualty 不污染 attribution history。
连续多个 round 不应出现固定索引式 5 个 1v1 对位。
```

## N63a 状态补充（2026-06-26）

- N59 裁判结果现在记录 `acceptedEvidenceRefsByItemId`，把被采信的 claim / challenge 映射到实际 accepted evidence refs。
- N63 金融火力现在只从当前 contact participant 的 submitted card + N59 item-evidence 映射取证据；缺映射时不会退回 side-level 平均分配。
- Web 审计已把 `rawFinanceOpinionZh` 改称“模型输出的可提交原文”，完整 LLM response 只在 artifact 可读时作为技术细节核对。
- N61 验收脚本已支持 `{ source, trace }` wrapper，并增加 N63a 映射缺失 / 火力未应用检查。

## N62C：Phase0 RAW 原文增量与预算使用率审计

目标：解决 `rawFinanceOpinionZh` 偏短导致 fullBuy 等高预算买型在 Web 审计里优势不明显的问题。

交付口径：

```text
stance rawFinanceOpinionZh 目标 420-650 中文字。
challenge rawFinanceOpinionZh 目标 320-520 中文字。
phase0 maxOutputTokens 提高到 2200。
submitted 裁剪预算表不变：full 320、standard 220、force 120、eco 80、save 40。
submittedFinanceOutputs 增加 raw/submitted 长度、目标区间、预算和使用率审计。
```

边界：N62C 只增加 raw 原文长度目标与审计可见性，不增加结构化 claim / challenge 数量，不改 N59 / N63 / combat。新 map 跑完后先统计 raw 长度和预算使用率，再决定是否进入裁剪汇率表校准或 N64。

## N62D：经济数字汇率裁剪与买型菜单隔离

目标：把 N62 submitted 裁剪从固定字数表改成经济数字汇率。新链路是：`spend -> economyClipTier -> charsPerSpendUnit -> submittedBudgetChars -> cutMode -> submittedOpinionZh / submitted finance card`。

规则：

```text
baseUnit = $50
枪械局：$50 = 4 中文字
手枪局：$50 = 6 中文字
submittedBudgetChars = clamp(floor(spend / 50) * charsPerSpendUnit, tierMinChars, tierMaxChars)
```

第一版档位：

```text
save / full_eco：40-60 字，front_cut，minor_delay
eco：40-90 字，random_window，weak_pressure
pistol_round：80-110 字，pistol_core_window，suppression
light_buy / pistol_armor_force：110-180 字，core_window，suppression / forced_back
force_buy / broken_buy：200-280 字，multi_slice_lite / random_core_window，forced_back
half_buy / bonus_round：150-320 字，core_window，possible_wound
rifle_buy：380-450 字，multi_slice，possible_kill
awp_buy / double_awp：500-580 字，multi_slice_plus，possible_kill
```

边界：LLM 不接触 submitted 字数预算、cutMode 或 combatEffectCap；submitted 文本只能摘自 rawFinanceOpinionZh，不能补写、不能替 agent 换证据、不能改 targetClaimId。N62D 不修改 N59 采信规则、N63 火力公式、combat gate、经济结算或 hard winner。

## N62D 后经济行为验收方向

N62D 之后，经济系统已经能把 spend、buy pattern、cut mode、submitted budget 和 combatEffectCap 写进 submitted finance output。但 2-7 map 验收显示，经济优势还没有稳定转化成行动风格差异，且 rifle_buy 存在预算未吃满的 watch 项。

已知事实：

```text
pistol_round：平均 submitted 85.5，pistol_core_window。
eco：平均 submitted 40，random_window。
force_buy：平均 submitted 224.4，multi_slice_lite。
half_buy：平均 submitted 217.7，core_window。
rifle_buy：平均 budget 383.6，但 submitted 平均约 209.8。
```

后续不先改 N59 / N63 公式，而在 N67 中处理经济行为口径：

```text
经济不只影响 submitted 字数，也要影响风险偏好和执行方式。
T eco 可以抱团爆点，CT eco 可以赌点 / 叠点 / 前压。
CT full 可以守点、反清或控图，T full 可以慢控也可以提速。
force 花得狠时可以更极端，但不能自动升级成 full buy 火力。
```

禁止：

```text
不让 LLM 直接决定 submitted budget / cutMode / combatEffectCap。
不让 raw 绕过 submitted gate。
不把经济行为做成固定模板。
不通过金融火力公式硬修行动空转。
```

## N67-role 角色口径补充（2026-07-02）

Finance Major 的金融专家身份继续独立：PM / Macro / Commodity / Company / Risk 不等于局内 CS 主角色。局内 CS 主角色统一为 `IGL / AWPer / rifler / lurker / entry`；新生成 active roster 要求每队五名上场选手各占一类；`star / supportive / anchor / flex / stand_in` 作为标签或状态进入轻量倾向，不作为主角色；展示层主角色保持英文。`supportContributorAgentIds` 是 combat 结构字段，不是选手主角色。