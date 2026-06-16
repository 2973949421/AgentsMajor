# Finance Major 原型契约：Dust2 有色 / 行业判断

本文是 Finance Major（金融投资对抗）的当前契约摘要。历史 N42-N55 推进记录已经迁入 `finance-n48-n55-iteration-log.md`。

## 1. 定位

Finance Major 不新建第二套比赛引擎。它复用 HexGrid（蜂巢格）的空间、行动、战斗、经济、回合提交、trace（轨迹）和 Web 验收台，只替换旧的泛商业语义层。

```text
保留：HexGrid 工程骨架。
替换：business duel -> finance duel。
当前测试：Dust2 有色 / 行业判断 / 6 round。
```

核心口径：

```text
金融研究攻防决定为什么打。
Hex 执行层证据决定怎么打。
硬条件决定谁赢。
```

## 2. 比赛定义

```text
赛事主题 = 金融投资对抗
地图 = 行业赛道，例如有色、TMT、消费、医药、金融地产
轮次 = 研究任务类型，例如行业判断、估值建模、公司深度、组合策略、风险应对
round = 当前任务下的小问题 / 子命题
守方 = 提出投资主张并自证
攻方 = challenge 投资假设、估值、风险和行业逻辑
裁判 = 基于证据质量、逻辑一致性、反证处理、收益风险比和可执行性评分
```

当前版本固定：

```text
地图：Dust2 有色
轮次：行业判断
round 数：6
队伍：两种投资风格
agent：PM / Macro / Commodity / Company / Risk 五专家 + coach
```

## 3. Dust2 有色 6 个 round

半场攻守互换后继续复用同 6 个主题。任何队伍都不能被写死为永久进攻方或永久防守方。

| Round | 小主题 | 守方自证 | 攻方挑战 |
|---|---|---|---|
| R1 | 全球有色价格是否支持景气上行 | 用 FRED 金属价格说明全球价格趋势 | 全球价格不能等同于中国国内供需 |
| R2 | A 股有色代表公司是否已经反映价格预期 | 用 BaoStock 股价、成交、PE/PB 说明市场反应 | 市场表现不能证明行业基本面 |
| R3 | 估值是否已经 price in | 用 BaoStock 估值和收益率判断是否透支 | 缺少财报页码和利润弹性时不能做公司深度强结论 |
| R4 | 进出口数据是否支持供需变化 | 用可选 UN Comtrade 观察进口趋势 | 进出口滞后且不能替代国内库存、现货和行业利润 |
| R5 | 当前证据缺口下哪些结论不能下 | 主动列出 missingEvidence 和 scoreCaps | 检验守方是否用代理事实冒充完整事实 |
| R6 | 基于有限证据的配置倾向与风险边界 | 给出有限置信度配置倾向、观察指标和降级条件 | 检查结论是否承认数据边界并具备风险控制 |

## 4. 队伍与 agent 分工

两队资产是“投资风格 + 行业理解 + 多专家团队”，不是旧商业叙事。

```text
Falcon-7B：进攻型周期成长，偏高 beta、供需缺口、价格弹性和集中表达。
VitaLLMty：稳健质量风控，偏安全边际、成本曲线、估值纪律和风险调整收益。
```

五类专家：

```text
PM / IGL：组合经理，负责配置强度、风险收益和最终观点。
Macro / AWPer：宏观策略，负责全球价格、周期位置和宏观约束。
Commodity / entry：供需商品，负责品种、贸易、库存和缺失证据。
Company / star rifler：公司建模，负责公司池、估值代理和盈利弹性。
Risk / support：风控交易，负责反证、scoreCaps、仓位降级和止损边界。
Coach：研究纪律，不作为第 6 个上场选手。
```

CS 词条保留为赛事包装和执行层表达，例如 map、round、attack、defense、entry、AWPer、IGL、support、retake。金融裁判不得把这些包装词当作金融研究证据。

## 5. 数据事实边界

第一版是免费 API 代理事实版，不是完整中国有色行业基本面系统。

自动源：

```text
FRED：全球金属价格和宏观代理。
BaoStock：A 股公司行情和估值代理。
UN Comtrade：可选贸易数据；失败时记录 unavailable observation。
AKShare：登记采集器，不作为第一版最终事实源。
```

禁止包装：

```text
FRED 全球价格不能直接证明中国国内供需。
BaoStock 市场表现不能直接证明行业基本面。
UN Comtrade 进出口线索不能替代国内库存、现货、利润和财报页码。
configured_proxy_fact 只能作为弱代理事实。
unavailable_observation 不能被写成真实事实。
```

数据契约详见：

```text
docs/finance/finance-evidence-mvp.md
docs/finance/finance-data-asset-contract.md
```

## 6. 当前运行链路

```text
离线事实库
-> agentEvidenceSlice（专家证据切片）
-> agentOpeningBrief（系统输入卡，非 agent 输出）
-> phase0 roundStartAgentOutput（真实开局输出）
-> phase1+ action（局内行动，短句引用 phase0）
-> financeEvidenceAdoption（裁判采信链）
-> combat / KDA / hard winner
-> Web 中文审计
```

关键规则：

- `agentOpeningBrief` 是系统输入卡，不能冒充 agent 输出。
- `roundStartAgentOutput` 是本局真实开局输出，必须来自 response artifact 或 fixture response。
- `roundStartAgentOutput` 必须通过结构校验和证据白名单校验，才可进入后续 phase action。
- provider 失败、无效响应、非法证据引用和 fallback 文案只能作为失败审计保存，不能冒充真实输出。
- phase1+ 只允许引用当前 agent 自己的 phase0 输出，不允许重写完整金融论文。
- 裁判必须记录采信证据、未采信证据、缺失证据和 score cap。
- hard winner 仍只来自硬条件，不来自 LLM、金融解释或前端。

## 7. Web 审计验收

`/hex-lab/match` 默认应能按中文读懂：

```text
本 round 小主题
-> 10 名 agent 的真实开局输出
-> phase1+ 行动如何引用开局输出
-> 裁判采信 / 未采信 / 缺失证据
-> 金融裁判理由和 CS 执行理由
-> hard winner
-> 技术细节
```

失败现象：

- 系统输入卡被当成 agent 原始输出。
- phase1+ 继续写大段金融作文。
- 裁判只显示字段存在，不说明采信了哪条证据。
- 用代理事实冒充完整基本面判断。
- 前端编造 trace 里没有的裁判理由。

## 8. 后续原则

Finance Major 下一步应先通过用户人工审计和文档清理，再决定是否进入 N56。不要在没有审计结论前扩到 TMT、消费、医药或完整赛事。
