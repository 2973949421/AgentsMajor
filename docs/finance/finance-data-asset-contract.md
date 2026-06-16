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
| `un_comtrade` | 进出口滞后线索，可选 | Python package，`UN_COMTRADE_KEY` |
| `akshare` | 采集器候选，不是事实源 | Python package |

`AKShare` 只能被登记为采集器，不能作为最终事实源。若未来用 AKShare 抽取 SHFE、国家统计局或其他页面，证据必须保留原始 source、URL、hash、抓取时间和质量降级说明。

## 5. 与地图资产的隔离

Hex 地图资产继续放在：

```text
data/materials/processed/maps/dust2/
```

金融主题绑定放在：

```text
data/materials/processed/finance/maps/dust2-nonferrous/
```

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
| AKShare | 登记采集器 | 不作为最终事实源，第一版可不启用 |

N50 生成的事实库建议放在：

```text
data/materials/generated/finance/fact-bank/
```

N50 第一版已生成：

```text
data/materials/generated/finance/fact-bank/dust2-nonferrous/latest.json
data/materials/generated/finance/fact-bank/dust2-nonferrous/fred-facts.json
data/materials/generated/finance/fact-bank/dust2-nonferrous/baostock-facts.json
data/materials/generated/finance/fact-bank/dust2-nonferrous/un-comtrade-facts.json
```

当前状态：

```text
FRED：offline_observation_fact。
BaoStock：offline_observation_fact。
UN Comtrade：optional unavailable_observation。
AKShare：registered_collector_not_used。
```

比赛运行时仍读取：

```text
data/materials/generated/finance/maps/dust2-nonferrous/round-evidence-packs.json
```

但这个 evidence pack 应由 fact bank 派生，而不是只由配置文件派生。后续 agent 看到 `configured_proxy_fact` 时，必须理解它只是兜底脚手架，不代表用户准备的金融数据接口已经真正进入比赛事实层。

N51 以后，`agentOpeningBrief` 不应直接复制 round thesis，而应引用 `agentEvidenceSlice`。N53 以后，裁判不能只因为 evidence 字段存在就给正向金融分，必须输出采信 / 拒绝 / 缺失证据链。
