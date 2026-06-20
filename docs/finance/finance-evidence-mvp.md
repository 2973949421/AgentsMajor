# Finance Evidence MVP：免费 API 代理事实版

## 1. 结论

第一阶段不能包装成“完整中国有色行业基本面系统”。

当前可落地口径应改为：

```text
Dust2 有色：免费 API 代理事实版。
```

原因很明确：

```text
没有一个免费、稳定、官方、可直接 API 化的数据源，能在第一阶段完整支撑中国有色行业判断。
免费稳定 API 有，但大多不是中国有色行业专用。
中国有色行业最关键的数据源有，但很多不是稳定开放 API。
A 股结构化行情和估值能免费自动化，但它只能证明市场表现，不能证明行业基本面。
```

所以第一阶段目标不是做完整金融数据库，而是先跑通：

```text
collector（采集器）
-> raw cache（原始缓存）
-> normalized facts（标准化事实）
-> evidence_id（证据编号）
-> round evidence pack（回合证据包）
-> LLM compact facts（模型短事实输入）
-> judge evidence ledger（裁判证据账本）
-> Web audit（网页审计）
```

LLM 只能读取短事实包，不能自由上网、不能编数字、不能把代理事实冒充完整行业判断。

N44 第一版已经落地材料层证据包生成：

```text
生成脚本：data/materials/scripts/generate-finance-evidence.mjs
校验脚本：data/materials/scripts/validate-finance-evidence.mjs
生成结果：data/materials/generated/finance/maps/dust2-nonferrous/
```

当前生成模式是 `fixture-or-live`：脚本读取真实 source registry、round topics、map overlay 和 universe 配置，生成可审计的 configured proxy facts（已配置代理事实）。它不会伪造实时价格、估值或进出口数值；如果 live collector（实时采集器）尚未启用，就用明确标注的配置事实和 source warnings 支撑 N45 接入测试。

## 2. 数据源分层

后续设计必须区分四个概念：

```text
collector（采集器） != source（事实来源） != evidence（证据） != prompt context（模型上下文）
```

例如用 AKShare、BaoStock 或其他接入入口抓到数据时，接入入口和事实发布方都要写清。用 AKShare 抓到 SHFE 相关数据时，可以这样登记：

```json
{
  "sourcePublisher": "SHFE",
  "accessProvider": "AKShare",
  "collector": "akshare_python_package_v0",
  "endpoint": "futures_settle_shfe",
  "sourceType": "official_web_anchor",
  "qualityTier": "exchange_data_via_named_collector"
}
```

禁止的是省略来源链后只写“AKShare 证明了某事实”或“模型输出证明了某事实”。如果原始发布方、接入入口、endpoint、字段口径和时间都清楚，采集器取得的数据可以进入事实库。

| 层级 | 含义 | 第一阶段策略 |
|---|---|---|
| 免费稳定 API | 有正式 API 或低维护类 API，适合自动接入 | 优先接 |
| 社区类 API / 采集入口 | 能拉数据，需记录发布方 / 接入方 / endpoint / 字段口径 | 可用；质量等级按具体 endpoint 判断 |
| 官方证据锚点 | 权威但不稳定自动化 | 只存 URL / hash / 元数据 |
| 后置源 | 有价值但第一阶段不碰 | 后续再接 |
| 付费替换源 | 商业化后增强 | 暂不考虑 |

## 3. 第一阶段推荐数据源

第一阶段自动源最多 2-3 个：

```text
FRED
BaoStock
AKShare（作为公开数据接入入口，按 endpoint 标来源链）
```

对应资产注册表已经固定在：

```text
data/materials/processed/finance/source-registry.json
data/materials/processed/finance/evidence-source-policy.json
data/materials/processed/finance/maps/dust2-nonferrous/
```

正式环境变量只从 `AgentsMajor/.env.local` 读取。上层 `.env` 和外部 `metal_project/` 只作为历史测试痕迹，不进入运行时。

### FRED

定位：

```text
全球金属价格与宏观代理事实源。
```

用途：

```text
全球铜、铝、镍、锌等月度价格。
部分宏观时间序列。
```

限制：

```text
不是中国现货价格。
不是国内期货价格。
不能证明国内库存、仓单、升贴水或供需缺口。
```

裁判口径：

```text
FRED 可支持“全球金属价格趋势”判断。
不能单独支持“中国有色行业景气上行”完整结论。
```

### BaoStock

定位：

```text
A 股代表公司行情、估值和成交数据的低成本类 API。
```

用途：

```text
股价表现。
成交额。
PE TTM。
PB。
PS。
PCF。
```

限制：

```text
不是官方交易所 API。
不能证明公司主营业务暴露、分产品毛利率、资源自给率或套保影响。
不能证明行业基本面。
```

裁判口径：

```text
BaoStock 可支持“市场是否已经 price in”。
不能单独支持“行业供需改善”或“公司盈利弹性已被证明”。
```

### UN Comtrade（可选）

定位：

```text
中国有色相关进出口代理事实源。
```

用途：

```text
铜矿砂及其精矿。
精炼铜。
铝土矿。
镍、锌、锡等相关 HS 商品。
```

限制：

```text
需要 HS code 映射。
数据有滞后。
不能替代中国海关的完整本地口径。
```

裁判口径：

```text
UN Comtrade 可支持“进出口趋势线索”。
不能单独支持国内供需强弱。
N57c 后暂时冻结出当前 active 主路径，避免滞后贸易数据污染 1-3 个月有色判断。
```

## 4. 第一阶段不自动接入的源

这些源有价值，但不能在第一阶段包装成免费稳定 API。

| 数据源 | 第一阶段定位 | 原因 |
|---|---|---|
| CNINFO 巨潮 | 公告 / 年报证据锚点 | 不做全文 PDF 解析，不把年报塞进 prompt |
| 国家统计局 | 官方证据锚点 | 权威但不是低维护稳定 API |
| 工信部 | 官方文本证据锚点 | 文本短且有价值，但不是结构化 API |
| SHFE | 商品价格 / 库存权威锚点 | 不默认免费稳定自动化，用户经验显示可能偏付费或受限 |
| SMM | 授权后付费增强 | 未授权不抓取 |
| TuShare Pro | 后置结构化增强 | 依赖 token / 积分权限 |
| AKShare | 可用采集入口 | 可抽取 SHFE / INE / GFEX 等数据；必须保留原始发布方和 endpoint 字段口径 |
| LME | 后置海外商品锚点 | 免费层有限，详细数据多需授权 |
| 海关统计 | 后置官方锚点 | 自动化比 API 更复杂 |

## 5. 第一版能做什么

第一版可以支撑：

```text
全球金属价格趋势。
A 股有色代表公司市场表现。
A 股有色代表公司估值。
中国有色相关进出口趋势。
基于证据缺口的裁判降分。
```

第一版不能假装支撑：

```text
完整中国有色行业景气判断。
国内供需紧张。
国内库存去化。
现货升贴水改善。
SHFE 仓单变化。
公司分产品盈利弹性。
套保影响。
资源自给率。
公司深度。
```

## 6. Round 设计调整

`Dust2 有色 / 行业判断` 第一版应从“完整基本面判断”降级为“代理事实判断”。N56 起，round 进一步从“证明题”改成“投资决策题”，不预设看多或看空。

| Round | 决策题 | 第一版证据 | 裁判限制 |
|---|---|---|---|
| R1 | 当前全球金属价格趋势是否足以支持未来 1-3 个月 A 股有色相对超配？ | FRED 金属价格 | 不能证明中国国内供需，只能支持商品价格动量 |
| R2 | A 股有色代表公司市场表现是否确认商品价格信号？ | BaoStock 股价、成交、PE/PB | 不能证明行业基本面，只能证明市场反应 |
| R3 | 当前估值是否已经 price in 商品价格预期？ | BaoStock 估值、收益率 | 缺少公司财报页码时不能做盈利弹性强结论 |
| R4 | 在贸易数据可用性有限时，进出口线索是否足以影响行业判断？ | N57c 后默认不使用 UN Comtrade active fact，可用 AKShare / SHFE / INE 等代理与 missingEvidence 约束 | 缺少中国海关与库存时只算弱线索 |
| R5 | 当前证据缺口下，哪些结论必须被限制置信度？ | missingEvidence / scoreCaps | 缺失证据只能降权或限制结论，不能自动赢 |
| R6 | 基于固定数据菜单，当前有色配置建议应如何落地？ | FRED + BaoStock + AKShare active facts | 只能给有限置信度配置建议和触发条件 |

任何 round 都允许看多、看空、中性、结构性分化、条件判断或暂不交易。暂不交易必须给出触发条件，不能只写“无法判断”。

## 7. 裁判证据上限

裁判必须显式暴露证据缺口，不能让 LLM 用代理事实冒充完整行业判断。

```text
没有国内库存，供需判断最高分受限。
没有 SHFE / SMM，国内价格判断最高分受限。
没有 CNINFO 页码，公司盈利传导最高分受限。
只有 BaoStock，不能证明行业基本面。
只有 FRED，不能证明中国国内有色供需。
只有 UN Comtrade，不能证明国内库存和利润传导。
```

建议第一版 score cap：

| 缺口 | 分数上限建议 |
|---|---|
| 只有 BaoStock | 行业判断最高 50-60 |
| 只有 FRED | 中国有色供需最高 55-65 |
| FRED + BaoStock | 代理事实判断最高 70 |
| FRED + BaoStock + AKShare active facts | 代理事实判断最高 75 |
| 无 CNINFO 页码 | 公司深度最高 50-60 |
| 无 SHFE / SMM / LME | 国内商品价格与库存判断最高 60-70 |

## 7.1 N57 数据菜单扩充与 Fact Bank v2

N57 不是单纯给 fact 增加字段。N57 的任务是根据 N56 的 `requiredEvidenceSchema` 补厚金融事实库。

当前第一版实现已经覆盖升级原事实库入口：

```text
data/materials/generated/finance/fact-bank/dust2-nonferrous/latest.json
```

它没有新建平行 `fact-bank-v2` 目录。N57c 最新联网生成已把 `latest.json` 收敛为 FRED、BaoStock 和 AKShare 访问到的 SHFE / INE / Sina Finance / Eastmoney / SSE / 公开宏观端点；World Bank / UN Comtrade 已冻结出 active facts、coverage 和 round evidence packs。

必须交付：

```text
dataMenu：当前 round 允许使用哪些数据类别和来源。
factBankV2：结构化事实库。
derivedMetrics：从原始观测派生出的变化率、分位、波动、回撤和相对表现。
coverageReport：每个 requiredEvidenceKey 的覆盖、缺口和 score cap。
```

第一版优先做已有源深加工：

```text
FRED：
  铜、铝、镍、锌价格。
  如稳定可取，补美元、利率、通胀、全球宏观代理。
  生成 1 / 3 / 6 / 12 个月变化、36 个月分位、波动和趋势。

BaoStock：
  有色公司池收益、成交、换手、PE/PB。
  生成相对沪深300表现、估值分位、波动、回撤和公司池分化。

UN Comtrade：
  成功时只作为贸易线索。
  失败时只作为 unavailableObservation 和 missingEvidence，不得当真实贸易事实。
```

第一版可验证的候选源：

```text
World Bank：长期宏观和国家指标，已接入无 key public API；只作为年度宏观背景。
USGS：低频矿产供给背景，优先作为年度结构事实。
NBS：权威中国宏观和工业数据，先验证接口或抓取稳定性。
SHFE / INE：已通过 AKShare 接入交易所行情 / 结算代理；仓单、库存或更细字段失败时仍作为 missingEvidence 和后续候选。
```

每个 round 的 `coverageReport` 至少说明：

```text
哪些 requiredEvidenceKey 已覆盖。
每类覆盖了多少条 fact。
哪些 fact 可支持 strong claim。
哪些 fact 只能支持 proxy claim。
哪些缺口触发 scoreCapPolicy。
哪些 round 仍只能做弱判断。
```

如果 N57 没有生成新的派生指标和覆盖率报告，就不能进入 N58。

## 7.2 Fact Bank v2 证据字段

N57 起，每条 fact 不仅要说明数值，还要说明可用边界。建议最小字段：

```text
allowedClaimTypes：这条证据可以支持的主张类型。
notAllowedClaimTypes：这条证据不能支持的主张类型。
reliabilityTier：官方 API、社区采集、官方锚点、不可用事实等可靠性层级。
interpretationHint：面向 agent 的解释提示。
scoreCapPolicy：该证据触发或解除哪些评分上限。
```

示例：

```json
{
  "factId": "FRED_COPPER_3M_MOMENTUM",
  "source": "FRED",
  "metricName": "Global price of Copper",
  "allowedClaimTypes": ["commodity_price_momentum", "global_cycle_signal"],
  "notAllowedClaimTypes": ["china_domestic_supply_demand", "company_earnings_confirmed"],
  "reliabilityTier": "official_api",
  "interpretationHint": "可支持全球铜价动量偏强，但不能单独证明中国国内供需或 A 股公司盈利改善。",
  "scoreCapPolicy": ["domestic_supply_demand_cap", "company_earnings_cap"]
}
```

裁判只能在 `claimType` 被 `allowedClaimTypes` 支持时采信该证据。若 agent 把证据用于 `notAllowedClaimTypes`，对应 claim 必须进入 rejected。

## 7.3 Missing Evidence 定义

`missingEvidence` 不能由 agent 临场发明。它必须来自当前 round 的 `requiredEvidenceSchema`。

有效 missing evidence 必须包含：

```text
missingKey：缺失项。
requiredForClaimTypes：它限制哪些主张类型。
effect：置信度上限、score cap、可执行性降级或战斗投影限制。
reason：为什么该缺口影响当前决策题。
```

固定规则：

```text
缺失证据不能自动让 challenge 方获胜。
缺失证据不能作为正向事实。
缺失证据只能限制结论强度、降低置信度或阻止强投影。
```

例如：

```text
没有国内库存数据 -> 可以限制“国内供需紧张”主张。
不能推出“对方一定错误”。
不能替代真实库存事实。
```

## 8. Evidence ID

建议格式：

```text
EVID:{source}:{domain}:{entity}:{metric}:{period}:{locator}:{hash8}
```

示例：

```text
EVID:FRED:commodity:PCOPPUSDM:price:2026M05:api:9a81f3c2
EVID:BAOSTOCK:stock:000630:pe_ttm:20260612:api:7e12a0bc
EVID:UNCOMTRADE:trade:CHN_HS2603:import_qty:2025M12:api:62dd9a1e
EVID:CNINFO:filing:000630:annual_report:2025A:index:33c9b8f1
```

每条 evidence 至少保留：

```text
source
collector
url 或 endpoint
publishDate / observationDate
fetchTime
metricName
value
unit
period
sourceType
confidence
rawHash
parserVersion
originalLocation
```

## 9. Round Evidence Pack

每个 round 给 LLM 的事实包应控制在 20-40 条短事实。

示例：

```json
{
  "roundId": "R1",
  "title": "全球有色价格是否支持行业景气上行？",
  "facts": [
    {
      "fact_id": "F001",
      "statement": "全球铜价最近一个已更新月份为 2026-05，单位为 USD/metric ton。",
      "metricName": "Global price of Copper",
      "value": 13483.75154,
      "unit": "USD/metric ton",
      "period": "2026-05",
      "source": "FRED",
      "sourceType": "official_api",
      "evidence_id": "EVID:FRED:commodity:PCOPPUSDM:price:2026M05:api:hash8",
      "confidence": 0.95
    }
  ],
  "missingEvidence": [
    "domestic_inventory",
    "domestic_spot_premium",
    "industry_profit",
    "company_product_margin"
  ],
  "scoreCaps": {
    "maxIndustryFundamentalScore": 70,
    "reason": "未接入国内库存、现货升贴水、行业利润和公司公告页码证据。"
  }
}
```

N44 生成物已经固定为两层：

```text
round-evidence-packs.json              # 6R 聚合包，供 runtime / Web 一次性读取
round-<n>-evidence-pack.json           # 单 round 拆分包，供人工审计和测试
```

每个 pack 必须保留：

```text
sideSwapPolicy：攻守互换策略，防止把队伍风格写死成固定攻守。
sourceWarnings：说明哪些 live 数据未抓取或可选源不可用。
judgeLedger：allowed / capped / prohibited claims。
scoreCaps：代理事实导致的裁判上限。
missingEvidence：本 round 仍缺失的关键证据。
```

## 10. Web Audit 要求

Web 不应只展示 LLM 的投资作文，而应展示：

```text
本 round 用了哪些 evidence_id。
每个 evidence_id 来自哪个 source。
collector 是谁。
数据值、单位、期间和抓取时间。
哪些关键证据缺失。
裁判因此设置了哪些 scoreCaps。
哪些结论只能算代理判断。
```

## 11. 后续地图候选

如果 `Dust2 有色` 免费数据太弱，可以把更适合免费 API 的金融地图放到后续：

| 地图候选 | 数据底座 | 适配性 |
|---|---|---|
| 美股科技 | SEC EDGAR + Alpha Vantage / Stooq + FRED | 免费 API 更成熟，财报结构化更好 |
| 全球宏观 | FRED + World Bank + IMF / OECD | 最适合低频 API |
| A 股估值风格对抗 | BaoStock + TuShare + 少量公告锚点 | 更贴近中国市场，但依赖权限 |

这些不是第一阶段替代 Dust2 有色的强制项，而是当数据源证明有色难以低成本支撑时的后续地图选项。
## 7.3 N57b / N57c 数据源收敛

N57 第一版证明了多源可以进同一个 fact bank，但用户行研复盘后的当前策略是少接口、深加工：

```text
active 主源：FRED + BaoStock + AKShare。
frozen / candidate：World Bank、UN Comtrade、NBS、USGS、CNINFO、SMM、GACC 等。
```

N57b 只做 AKShare endpoint 广探测，不覆盖正式 fact bank。重点尝试：

```text
期货：SHFE / INE 日行情、结算、成交、持仓、仓单、库存。
现货 / 商品：有色现货价格、商品价格指数、生意社 / 东方财富 / 新浪等公开入口。
公司基本面：利润表、资产负债表、现金流、主要财务指标、估值指标。
行业 / 板块：有色板块指数、概念板块、成分股和行业涨跌。
资金 / 交易：成交额、换手、主力资金、北向或融资融券如可取。
```

N57c 根据 N57b 的 endpoint 结果覆盖升级原 fact bank，且不新建平行库。N57c 后：

```text
World Bank / UN Comtrade 不进入 active round evidence pack。
World Bank / UN Comtrade 不进入 agent evidence slice。
World Bank / UN Comtrade 不参与 N59 accepted evidence。
FRED 继续做全球金属价格锚。
BaoStock 扩大公司池并补可取财报字段。
AKShare 按 endpoint 进入期货、现货、行业、公司基本面或资金事实。
```

这不是否定 World Bank / UN Comtrade 的历史可用性，而是承认它们对当前 1-3 个月有色行业判断帮助有限，先冻结出比赛主路径。
