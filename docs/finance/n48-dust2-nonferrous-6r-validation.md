# N48 Dust2 有色 / 行业判断 6R 小样本验收

## 1. 验收结论

```text
结论：条件通过。
可通过部分：Finance Duel 结构链路、金融裁判字段、Web 金融审计入口已能在 6R 样本中闭环。
未通过部分：本轮没有完成新的 real provider 金融 6R 样本；现有最近 real 6R 是旧 businessDuel 轨迹，不能算 N48 金融样本。
下一步：不建议直接扩大到 TMT / 消费 / 医药；应先做 N49，补 real provider 金融样本与请求成本/语义质量验收。
```

N48 是验收关口，不是新机制开发。本轮没有修改 AP、经济、硬胜负、KDA 归因或 Web 大布局。

## 2. 样本来源

### 2.1 当前可用 real 样本

最新可用 real 小样本：

```text
mapGameId：map_hex_lab_1781372260956_60976f25
rounds：6
score：4 - 2
状态：running
```

审计结果：

- 这组样本有 real LLM request / response artifact。
- 但 round trace 中主结构仍是 `businessDuel`，不是 N45-N47 后应验收的 `financeDuel`。
- 因此它只能作为历史对照，不能作为 N48 的金融验收样本。

### 2.2 本轮生成的 fixture 结构样本

本轮用当前代码生成了一组不消耗真实模型的 fixture 样本：

```text
mapGameId：map_hex_lab_1781488695700_31bac8bf
provider：fixture
rounds：6
score：0 - 6
状态：running
```

这组样本用于验证结构链路，不用于证明 real LLM 输出质量。

## 3. 6R 结构验收摘要

| Round | 小主题 | Winner | Win Type | Duel | Accepted / Fallback / Rejected | Combat | Finance Verdict |
|---|---|---|---|---|---:|---:|---|
| R1 | 机会识别与高价值切口 | defense | timeout_no_plant | financeDuel | 50 / 0 / 0 | 15 | 15 contested |
| R2 | 信息差与中路控制 | defense | timeout_no_plant | financeDuel | 44 / 6 / 0 | 15 | 5 thesis_defended, 10 contested |
| R3 | 资源集中与关键位突破 | defense | timeout_no_plant | financeDuel | 50 / 0 / 0 | 15 | 15 contested |
| R4 | 执行闭环与边界修补 | defense | timeout_no_plant | financeDuel | 44 / 6 / 0 | 15 | 5 thesis_defended, 10 contested |
| R5 | 叙事误导与转点响应 | defense | timeout_no_plant | financeDuel | 50 / 0 / 0 | 15 | 15 contested |
| R6 | 终局主张与反证压力 | defense | timeout_no_plant | financeDuel | 44 / 6 / 0 | 15 | 4 thesis_defended, 11 contested |

聚合结果：

```text
rounds with financeDuel：6 / 6
actions：300
acceptedActions：282
fallbackActions：18
rejectedDrafts：0
combatResolutions：90
combatResolutions with finance fields：90
request artifacts：282
response artifacts：282
average request size：约 364 KB / call
```

## 4. 金融攻防链路是否成立

### 已成立

结构层面已经成立：

- 每个 round 都有金融小主题。
- 每个 round 都有守方投资主张和攻方反证质疑。
- 每个 round 都写入证据编号和 missingEvidence。
- combat resolver 已输出 `financeVerdict`、`financeReasons`、`financeScore`。
- hard winner 仍由 `finalWinCondition` 给出，没有被金融裁判或前端重写。

样例：

```text
R2 小主题：信息差与中路控制
守方主张：用代表公司股价、成交和估值变化说明市场正在反映价格预期。
攻方质疑：市场表现不能证明行业基本面，也可能只是风险偏好或资金风格变化。
裁判输出：5 个 thesis_defended，10 个 contested_no_finance_resolution。
硬胜负：defense_timeout_no_plant。
```

### 尚未成立

质量层面尚未成立：

- fixture 行动仍带有旧兼容文案：`business-plan action`。
- fixture 不能证明真实模型会产出有效金融研究行动。
- 大部分裁定仍是 `contested_no_finance_resolution`，说明金融证据没有形成足够强的胜负差异。
- 连续 6 回合都是 `timeout_no_plant`，对局结果仍偏单调。
- request artifact 平均约 364 KB，成本问题仍明显。

## 5. 代理事实使用情况

本轮结构样本能诚实暴露数据缺口：

- R1 缺失：`domestic_inventory`、`domestic_spot_premium`、`shfe_warehouse_receipt`。
- R2 缺失：`company_margin_breakdown`、`product_exposure`、`fund_flow`。
- R3 缺失：`cninfo_page_locator`、`profit_sensitivity`、`cost_curve`。
- R4 缺失：`china_customs_local_series`、`domestic_inventory`、`industry_profit`。
- R5 缺失：`domestic_inventory`、`domestic_spot_premium`、`company_product_margin`、`official_filing_page_locator`。
- R6 缺失：`domestic_micro_data`、`filing_page_anchor`、`positioning_and_crowding`。

这符合免费 API 代理事实版边界：FRED、BaoStock、可选 UN Comtrade 只能做低频代理事实，不能冒充完整中国有色基本面系统。

## 6. N48 判定

```text
结构链路：通过。
金融裁判字段：通过。
Web 金融审计入口：通过。
真实 LLM 金融样本：未通过，本轮没有新的 financeDuel real 样本。
对局质量：未通过，fixture 6R 全部 timeout_no_plant。
调用成本：未通过，平均 request artifact 仍约 364 KB。
是否扩大到其他地图：暂不建议。
```

综合判定为 **条件通过**。

条件通过的含义：

- 可以确认 N42-N47 第一版没有只停留在文档和字段；当前代码能生成 `financeDuel`，combat 能消费金融裁判字段，Web 能展示金融链路。
- 不能确认真实模型质量已经达标。
- 不能确认金融攻防已经足够像“有色行业判断比赛”。
- 不能直接进入 TMT / 消费 / 医药扩图。

## 7. 下一步建议

建议 N49 不做新地图，先做：

```text
N49：Finance real 6R 样本与成本/语义质量修复。
```

N49 应重点解决：

- real provider 必须生成新的 `financeDuel` 样本。
- compact request 需要进一步生效，避免 300KB+ 单请求。
- LLM 输出必须围绕投资主张、反证质疑、证据编号和缺失证据。
- fixture provider 文案应从旧 `business-plan action` 改为金融兼容文案，避免污染验收。
- 对局不能长期全部 `timeout_no_plant`，至少要能解释为什么未下包。

N49 之前不建议扩大到新行业地图。
