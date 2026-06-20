# Finance Data Asset Contract：金融数据资产与环境规整契约

## 1. 目标

本契约固定 Finance Major（金融投资对抗）第一版的数据资产和环境管理方式。

用户已经验证过 BaoStock、UN Comtrade、FRED、AKShare 等 Python 接口可用，但这些验证脚本和上层虚拟环境不应直接散落进运行时主线。本契约的目标是：

```text
统一登记数据接口。
只把仓库内 .env.local 作为正式本地环境入口。
把金融数据资产放入独立 finance materials 目录。
不把金融数据源和 Hex 地图资产杂糅。
不迁移外部历史测试脚本。
不保存 API key 或密钥预览。
```

## 2. 当前事实

当前外部环境已经存在：

```text
B:\sharewithlight\LegendProject\.venv
B:\sharewithlight\LegendProject\.env
B:\sharewithlight\LegendProject\requirements.txt
B:\sharewithlight\metal_project\test_baostock.py
B:\sharewithlight\metal_project\test_comtrade.py
B:\sharewithlight\metal_project\test_comtrade_key.py
```

这些文件证明接口曾经跑通，但不作为 Agent Major 的长期运行入口。

正式入口固定为：

```text
B:\sharewithlight\LegendProject\AgentsMajor\.env.local
```

密钥只允许放在本地环境文件中，不能写入 `data/materials/`、`docs/`、测试快照或 artifact（产物）。

## 3. 资产目录

金融数据资产放在：

```text
data/materials/processed/finance/
```

当前结构：

```text
data/materials/processed/finance/README.md
data/materials/processed/finance/source-registry.json
data/materials/processed/finance/evidence-source-policy.json
data/materials/processed/finance/maps/dust2-nonferrous/finance-map-binding.json
data/materials/processed/finance/maps/dust2-nonferrous/round-topics.json
data/materials/processed/finance/maps/dust2-nonferrous/fred-series.json
data/materials/processed/finance/maps/dust2-nonferrous/baostock-company-universe.json
data/materials/processed/finance/maps/dust2-nonferrous/un-comtrade-hs-codes.json
data/materials/processed/finance/maps/dust2-nonferrous/evidence-pack-template.json
```

N44 后，生成型证据包放在：

```text
data/materials/generated/finance/maps/dust2-nonferrous/round-evidence-packs.json
data/materials/generated/finance/maps/dust2-nonferrous/round-<n>-evidence-pack.json
```

`processed/` 是人工维护的资产真相；`generated/` 是由脚本生成的低成本证据包。`generated/` 可以提交小型、可审计的 evidence pack（证据包）样本，但不得提交 raw cache、API key、网页全文或大体积 PDF。

Python 依赖清单放在：

```text
tools/finance-data/requirements.txt
```

它是金融数据工具的依赖记录，不代表要在 agent 环境里重装依赖。默认仍禁止运行 `pnpm install`，Python 环境也不在本轮自动重建。

## 4. 数据源与采集器边界

必须区分：

```text
collector（采集器） != source（事实来源） != evidence（证据） != prompt context（模型上下文）
```

第一版正式源：

| sourceId | 定位 | 入口 |
|---|---|---|
| `fred` | 全球金属价格和宏观代理事实 | HTTP API，`FRED_API_KEY` |
| `baostock` | A 股代表公司行情和估值代理事实 | Python package，无 key |
| `un_comtrade` | 进出口滞后线索，N57c 后冻结出 active 主路径 | Python package，`UN_COMTRADE_KEY` |
| `akshare` | 当前 active 采集入口 / access provider | Python package |

`AKShare` 和 `BaoStock` 本质上都属于接入入口 / 采集器。区别不在于“谁高谁低”，而在于每条 fact 是否能说清楚来源链。若用 AKShare 抽取 SHFE、INE、GFEX、Sina 或其他页面，证据必须保留：

```text
sourcePublisher：原始发布方，例如 SHFE / INE / GFEX / Sina。
accessProvider：接入提供方，例如 AKShare。
collector：项目内采集器，例如 akshare_python_package_v0。
endpoint：具体函数或 URL。
fieldDefinitions：字段口径。
observedAt / period：观测时间和数据期。
transform：派生指标如何计算。
```

不能省略来源链后只写“AKShare 证明了某事实”。但如果 endpoint 字段清楚、时间清楚、发布方清楚，AKShare 采集到的数据可以进入 N57。

## 5. 与地图资产的隔离

Hex 地图资产继续放在：

```text
data/materials/processed/maps/dust2/
```

金融主题绑定放在：

```text
data/materials/processed/finance/maps/dust2-nonferrous/
```

这里的 `finance/maps` 是历史命名。它当前实际表示 Finance scenario（金融场景包），不是 Hex tactical map（战术地图）。为避免 N57 前置阶段扩大迁移风险，本轮不搬目录，只固定解释：

```text
data/materials/processed/maps/dust2/
  Hex 战术地图：cell / region / point / cover / objective。

data/materials/processed/finance/maps/dust2-nonferrous/
  金融场景包：decisionQuestion、requiredEvidenceSchema、source universe、evidence template。
```

后续如做结构治理，可把 `finance/maps` 迁移为 `finance/scenarios`，但必须单独规划，不和数据接入混做。

两者关系：

```text
Hex map 负责空间、路径、区域、点位、可走性。
Finance map binding 负责行业主题、回合子命题、证据源、证据缺口和裁判上限。
```

禁止把金融数据源配置塞进 `dust2-hex-map.json`。也禁止把 Hex cell、region、point 写进金融 source registry。

## 6. 外部测试脚本处理

`B:\sharewithlight\metal_project` 中的测试脚本不迁移。

原因：

```text
它们是历史验证脚本，不是正式 collector。
其中 key 检查脚本会打印 key 长度和预览，不适合进入仓库。
正式项目只需要吸收“接口可用”和“调用形态”的结论。
```

后续如果要实现正式 collector，应新建项目内代码，并遵守：

```text
不打印 key。
不把 raw PDF 塞入 prompt。
不把外部脚本原样复制成 runtime。
不把 proxy fact 冒充完整行业基本面。
```

## 7. 当前第一版数据边界

当前绑定名：

```text
有色行业判断
```

第一版公司池包含：

```text
coreUniverse：10 家代表公司。
extendedUniverse：25 家扩展公司。
```

默认验收可先用 coreUniverse；如果样本太少，再扩大到 extendedUniverse。扩容不改变数据源边界：BaoStock 仍只能证明市场反应和估值代理事实，不能证明完整行业基本面。

## 8. 后续实施入口

N44 Finance Evidence MVP 接入时，应优先读取：

```text
data/materials/processed/finance/source-registry.json
data/materials/processed/finance/evidence-source-policy.json
data/materials/processed/finance/maps/dust2-nonferrous/finance-map-binding.json
```

然后按回合读取：

```text
round-topics.json
fred-series.json
baostock-company-universe.json
un-comtrade-hs-codes.json
evidence-pack-template.json
```

N44 第一版已新增：

```text
data/materials/scripts/generate-finance-evidence.mjs
data/materials/scripts/validate-finance-evidence.mjs
```

当前脚本先生成 configured proxy facts，不在没有稳定 live adapter（实时适配器）时伪造市场数值。N45 runtime 应优先读取 `round-evidence-packs.json`，而不是重新扫描 source registry 或直接调用外部 API。

## 9. N50-N55 离线事实库、证据链与真实输出审计补充契约

N49 后的审计结论是：当前金融数据接口已经完成登记，但尚未真正把 API 观测值转化为比赛事实。`round-evidence-packs.json` 已经被 runtime 消费，但其中大量事实仍是：

```text
dataMode = configured_proxy_fact
period = configured
value = null
```

N50 不改变“比赛时不临场联网”的原则。新的数据路线必须分阶段落地：

```text
N50：先离线采集，再归一化成 fact bank。
N51：从 fact bank / round evidence pack 切成 agent evidence slice。
N52：agent 在局内只引用信息卡，不重新生成整段金融论点。
N53：裁判明确采信 / 拒绝 / 降权哪些证据。
N54：Web 用中文人类审计展示真实样本。
N55：Web 主审计只展示真实 response artifact 摘要，系统输入卡不得冒充 agent 输出。
```

新增事实类型建议：

```text
offline_observation_fact
```

它必须至少包含：

```text
factId
statement
metricName
value
unit
period
source
sourceType
collector
evidenceId
confidence
rawHash
parserVersion
originalLocation
policyNotes
dataMode
observedAt 或 generatedAt
```

如果某个 API 未能取回数据，不允许静默写空值。必须写入：

```text
dataMode = unavailable_observation
unavailableReason
sourceWarning
```

N50 的第一版默认策略：

| 数据源 | N50 状态 | 说明 |
|---|---|---|
| FRED | 必通主路径 | 全球金属价格和宏观代理事实 |
| BaoStock | 必通主路径 | A 股代表公司行情、成交和估值代理 |
| UN Comtrade | 可选 | 进出口滞后线索，失败不阻塞 |
| AKShare | 可用采集入口 | 可探测 SHFE / INE / GFEX 等源；N50 第一版未启用，N57 可按 endpoint 结果使用 |

N50 生成的事实库建议放在：

```text
data/materials/generated/finance/fact-bank/
```

事实库主入口固定为：

```text
data/materials/generated/finance/fact-bank/dust2-nonferrous/latest.json
```

N57 不另起 `fact-bank-v2` 平行库，而是在同一路径覆盖升级。当前同目录拆分文件包括：

```text
data/materials/generated/finance/fact-bank/dust2-nonferrous/fred-facts.json
data/materials/generated/finance/fact-bank/dust2-nonferrous/baostock-facts.json
data/materials/generated/finance/fact-bank/dust2-nonferrous/shfe-facts.json
data/materials/generated/finance/fact-bank/dust2-nonferrous/ine-facts.json
data/materials/generated/finance/fact-bank/dust2-nonferrous/world-bank-facts.json
data/materials/generated/finance/fact-bank/dust2-nonferrous/un-comtrade-facts.json
data/materials/generated/finance/fact-bank/dust2-nonferrous/coverage-report.json
```

当前状态：

```text
Fact Bank v2：schemaVersion=2，覆盖原 latest.json。
FRED：已生成多窗口价格变化、36 个月分位、波动、回撤和多金属同步 / 背离事实。
BaoStock：已生成核心公司收益窗口、相对沪深300表现、估值和流动性代理。
SHFE / INE：通过 AKShare 访问入口接入，事实保留 sourcePublisher、accessProvider、collector、endpoint 和字段口径；期货、仓单和基差必须按目标金属过滤，不能把非有色样本行当成有色事实。
World Bank：public API 接入，作为年度宏观背景；部分指标无记录时写入 unavailable_observation。
UN Comtrade：使用 period / flow / direct HTTP fallback，成功时作为滞后贸易线索，失败时写入 unavailable_observation。
```

N57b / N57c 后的 active/frozen 口径：

```text
active：FRED、BaoStock、AKShare 采集到且通过 endpoint 级校验和目标品种匹配的数据。
frozen：World Bank、UN Comtrade、NBS、USGS、CNINFO、SMM、GACC 等当前不进比赛主路径。
```

frozen 不等于删除。frozen 源仍可保留在 source registry、历史 source probe、文档和后续候选计划里，但不得进入当前：

```text
round evidence pack 主事实。
agent evidence slice。
N59 accepted evidence。
coverage report 的 active 覆盖统计。
Web 主审计可采信事实。
```

比赛运行时仍读取：

```text
data/materials/generated/finance/maps/dust2-nonferrous/round-evidence-packs.json
```

但这个 evidence pack 应由 fact bank 派生，而不是只由配置文件派生。后续 agent 看到 `configured_proxy_fact` 时，必须理解它只是兜底脚手架，不代表用户准备的金融数据接口已经真正进入比赛事实层。

N51 以后，`agentOpeningBrief` 不应直接复制 round thesis，而应引用 `agentEvidenceSlice`。N53 以后，裁判不能只因为 evidence 字段存在就给正向金融分，必须输出采信 / 拒绝 / 缺失证据链。

## 10. N57 前置数据源探测补充契约

N57 正式生成 Fact Bank v2 前，必须先运行 source probe（数据源探测），回答“接口是否真实可用、返回什么字段、支持哪个 N56 必需证据键、进入 N57 的决策是什么”。

探测命令：

```powershell
..\.venv\Scripts\python.exe tools\finance-data\probes\probe_finance_sources.py --map dust2-nonferrous
node data/materials/scripts/validate-finance-evidence.mjs --map dust2-nonferrous --source-probes
```

探测产物：

```text
data/materials/generated/finance/source-probes/dust2-nonferrous/source-probe-report.json
docs/finance/n57-data-source-probe-report.md
```

探测必须区分：

```text
source：事实源，例如 FRED、BaoStock、SHFE、INE、GFEX、World Bank、UN Comtrade。
collector：采集器，例如 fred_http_api_v1、baostock_python_package_v0、akshare_python_package_v0、world_bank_http_api_v2。
scenario：金融场景，例如 dust2-nonferrous。
generated output：探测报告或事实库产物。
```

N57 前置探测的当前结论：

| source | collector | N57 决策 | 说明 |
|---|---|---|---|
| FRED | `fred_http_api_v1` | `ready_for_n57` | 全球金属价格和宏观代理主路径。 |
| BaoStock | `baostock_python_package_v0` | `ready_for_n57` | A 股公司行情、成交、估值代理主路径。 |
| SHFE | `akshare_python_package_v0` | `usable_with_cap` | 期货日行情 / 结算可取，仓单 / 库存路径部分失败；N57 fact 需写清 sourcePublisher=SHFE、accessProvider=AKShare。 |
| INE | `akshare_python_package_v0` | `usable_with_cap` | 国际铜相关行情 / 结算可取，需写清 endpoint 与字段口径。 |
| GFEX | `akshare_python_package_v0` | `candidate_only` | 碳酸锂 / 工业硅与 Dust2 有色 v1 主线不完全一致，先作候选。 |
| World Bank | `world_bank_http_api_v2` | `usable_with_cap` | 无 key public API，可做年度宏观代理，不能证明短周期国内供需。 |
| UN Comtrade | `un_comtrade_python_package_v1` / direct HTTP | `usable_with_cap` | 2025 可能无记录，2024 指定 HS / flow 可返回；滞后贸易线索。 |

任何进入 N57 的 fact 都不得省略来源链。如果通过 AKShare 抽取 SHFE / INE / GFEX，事实必须保留原交易所或行情发布方、接入提供方、采集器、endpoint、字段、日期和变换口径。质量等级由具体 endpoint 与字段稳定性决定，不由“AKShare”这个名字一刀切决定。

## 11. N57b / N57c 数据源收敛契约

N57b 是 AKShare endpoint 广探测，已输出 endpoint 级 JSON 和人类报告；N57c 是三主源 active fact bank 覆盖重建。它们不新增比赛 runtime 规则，也不改 N58 stance / challenge 结构。

N57b 输出：

```text
AKShare endpoint catalog。
每个 endpoint 的 sourcePublisher、endpointName、testedParams、returnedFields、returnedRows、samplePeriod、frequency、entityCoverage。
每个 endpoint 的 requiredEvidenceKey 映射。
每个 endpoint 的 decisionForN57c：ready_for_fact_bank / usable_with_cap / candidate_only / unavailable / blocked。
```

N57c 输出：

```text
覆盖原 fact bank latest.json。
覆盖 round-evidence-packs.json。
coverage-report 只按 active 三主源计算。
sourceStatus 区分 active / frozen。
World Bank / UN Comtrade 从当前比赛主路径冻结。
```

三主源职责：

```text
FRED：全球金属价格锚和价格动量派生。
BaoStock：A 股有色公司池、行情、估值、相对表现和可取财报字段。
AKShare：期货、现货、行业/板块、资金/交易、公司基本面和其他公开 endpoint 的广覆盖入口。
```

N57c 必须补的结构欠账：

```text
每条 fact 必须有顶层 entity 字段，不能只把实体藏在 evidenceId 或 statementZh。
每条 AKShare fact 必须有 sourcePublisher / accessProvider / collector / endpoint / fieldDefinitions；期货、仓单和基差类 fact 还必须保留 targetSymbol / targetNameZh / matchedRecordCount。
每条 fact 必须保留 allowedClaimTypes / notAllowedClaimTypes / interpretationHint / scoreCapPolicy。
```

## 12. N57c 目标品种匹配补丁契约

```text
端点成功不等于目标金属事实成功。
SHFE 日行情 / 结算必须按 CU、AL、ZN、NI、SN、PB、AU、AG 拆成单品种事实。
SHFE 仓单必须用 VARID / VARNAME 匹配目标品种；沥青、纸浆、螺纹钢等非有色样本不得进入有色事实。
INE 国际铜必须匹配 BC；如果端点只返回 SC、EC 等其他合约，只能写 unavailable。
现货 / 基差入口必须按目标品种拆分，BC 缺失时写缺口，不用其他品种顶替。
coverage-report 和 round-evidence-packs 只能按匹配后的 active facts 统计和选择。
```

## 13. N57c ????????????????

N57c ????????????????????????????????????????? active fact bank ???????

```text
data/materials/generated/finance/fact-bank/dust2-nonferrous/latest.json
```

??????????

```text
BaoStock????? A ??????1/3/6/12 ?????????300?????PE/PB/PS/PCF ?????????
AKShare / Sina Finance??? stock_financial_abstract ????????????????????????????ROE?????????????????????EPS ???? facts?
```

??????? facts ?????

```text
sourcePublisher ??? Sina Finance ? BaoStock ?????????? AKShare?
accessProvider ??? AKShare?
collector ??? akshare_python_package_v0?
???????? earnings_transmission_proxy?company_quality_proxy?valuation_proxy?risk_reward_boundary ??????
???? company_earnings_confirmed?product_margin_confirmed?mine_output_confirmed?cost_curve_confirmed?trade_flow_confirmed?
```

???????

```text
data/materials/generated/finance/fact-bank/dust2-nonferrous/company-fundamental-facts.json
data/materials/generated/finance/fact-bank/dust2-nonferrous/company-profile-facts.json
```

`round-evidence-packs.json` ??? / ?? / ???????????????????? facts??? `company_financial_abstract_table_summary` ?????????????????? agent evidence slice?
