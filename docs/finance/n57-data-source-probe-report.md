# N57 前置数据源探测报告

生成时间：`2026-06-19T06:37:49Z`

金融场景：`dust2-nonferrous`

Hex 地图：`dust2`

## 1. 结论

```text
现有正式 collector 不包含期货数据。
AKShare 可以激进探测 SHFE / INE / GFEX。它是采集入口；数据能不能用取决于具体 endpoint、字段口径和原始发布方。
World Bank public API 可作为无 key 宏观代理候选，频率偏低。
UN Comtrade 必须区分 key、package、参数、空结果和 direct HTTP fallback，不能再只写 ValueError。
finance/maps 是历史命名，dust2-nonferrous 当前实际是 finance scenario，不是 Hex 战术地图。
```

## 2. N56 必需证据键

- `available_positive_proxy`
- `china_supply_demand_proxy`
- `commodity_context`
- `commodity_price_context`
- `commodity_price_momentum`
- `declared_missing_evidence`
- `domestic_inventory_or_spot_proxy`
- `earnings_transmission_proxy`
- `equity_market_reaction`
- `equity_transmission_proxy`
- `missing_evidence_policy`
- `portfolio_stance_evidence_mix`
- `risk_execution_rule`
- `risk_reward_boundary`
- `trade_flow_proxy`
- `valuation_level`
- `valuation_proxy`

## 3. 数据源探测表

| source | 名称 | collector | 状态 | N57 决策 | 行数 | 支持的证据键 |
|---|---|---|---|---|---:|---|
| `fred` | FRED | `fred_http_api_v1` | `success` | `ready_for_n57` | 6 | available_positive_proxy, commodity_context, commodity_price_context, commodity_price_momentum, portfolio_stance_evidence_mix |
| `baostock` | BaoStock | `baostock_python_package_v0` | `success` | `ready_for_n57` | 5 | available_positive_proxy, equity_market_reaction, equity_transmission_proxy, portfolio_stance_evidence_mix, valuation_level, valuation_proxy |
| `shfe` | SHFE 上期所（AKShare 采集器） | `akshare_python_package_v0` | `partial` | `usable_with_cap` | 607 | china_supply_demand_proxy, commodity_price_context, commodity_price_momentum, domestic_inventory_or_spot_proxy, risk_reward_boundary |
| `ine` | INE 上海国际能源交易中心（AKShare / Sina 采集器） | `akshare_python_package_v0` | `success` | `usable_with_cap` | 1416 | china_supply_demand_proxy, commodity_price_context, commodity_price_momentum |
| `gfex` | GFEX 广期所（AKShare / Sina 采集器） | `akshare_python_package_v0` | `success` | `candidate_only` | 1686 | commodity_price_context, commodity_price_momentum, domestic_inventory_or_spot_proxy, risk_reward_boundary |
| `world_bank` | World Bank Indicators API | `world_bank_http_api_v2` | `success` | `usable_with_cap` | 28 | global_cycle_signal, macro_demand_proxy, risk_reward_boundary |
| `un_comtrade` | UN Comtrade | `un_comtrade_python_package_v1` | `success` | `usable_with_cap` | 1 | trade_flow_proxy |
| `nbs` | 国家统计局 NBS | `not_implemented_in_n57_pre_probe` | `skipped` | `candidate_only` | 0 | china_supply_demand_proxy, macro_demand_proxy, risk_reward_boundary |
| `gacc` | 中国海关总署 GACC | `not_implemented_in_n57_pre_probe` | `skipped` | `candidate_only` | 0 | trade_flow_proxy |
| `usgs` | USGS Mineral Commodity Summaries | `not_implemented_in_n57_pre_probe` | `skipped` | `candidate_only` | 0 | china_supply_demand_proxy, commodity_context |
| `smm` | 上海有色网 SMM | `not_implemented_in_n57_pre_probe` | `skipped` | `candidate_only` | 0 | china_supply_demand_proxy, domestic_inventory_or_spot_proxy |
| `cninfo` | 巨潮资讯 CNINFO | `not_implemented_in_n57_pre_probe` | `skipped` | `candidate_only` | 0 | earnings_transmission_proxy, valuation_level |

## 4. AKShare 探测说明

- `shfe`：usable_with_cap，返回 607 行，字段：close, close_today_fee_ratio, date, hedge_long_margin_ratio, hedge_short_margin_ratio, high, index, is_close_today, low, open, open_interest, pre_settle
- `ine`：usable_with_cap，返回 1416 行，字段：close, close_today_fee_ratio, date, hedge_long_margin_ratio, hedge_short_margin_ratio, high, hold, is_close_today, low, open, settle, settle_price
- `gfex`：candidate_only，返回 1686 行，字段：LC, PD, PS, PT, SI, agent_tot_buy_posi_quota, client_buy_posi_quota, close, date, fall_limit, hedge_buy, hedge_buy_rate

如果 N57 使用 AKShare 探测结果，每条 fact 必须写清 `sourcePublisher=SHFE/INE/GFEX/Sina`、`accessProvider=AKShare`、`collector=akshare_python_package_v0`、endpoint、字段、日期和变换口径。AKShare 本身不是问题，不能省略来源链才是问题。

## 5. 失败与不可用说明

- 本次报告没有记录阻塞级失败原因。

### 部分失败 endpoint

- `shfe` / `futures_shfe_warehouse_receipt:20260619`：JSONDecodeError Expecting value: line 1 column 1 (char 0)
- `shfe` / `futures_shfe_warehouse_receipt:20260618`：JSONDecodeError Expecting value: line 1 column 1 (char 0)
- `shfe` / `futures_shfe_warehouse_receipt:20260617`：JSONDecodeError Expecting value: line 1 column 1 (char 0)
- `shfe` / `futures_shfe_warehouse_receipt:20260616`：JSONDecodeError Expecting value: line 1 column 1 (char 0)
- `shfe` / `get_receipt:CU/AL/ZN/NI/SN/PB/AU/AG`：ValueError No tables found

## 6. N57 入口建议

```text
ready_for_n57：可以直接进入 N57 v1 的正式数据菜单。
usable_with_cap：可以进入 N57，但必须写清来源链、字段口径、能证明什么和不能证明什么。
candidate_only：只作为候选源或后续验证项。
unavailable：当前不可用，只能映射为 missing / unavailable。
blocked：缺 key、包不可用或环境阻塞，需要先修环境。
```

N57 应先消费 `ready_for_n57` 和高价值 `usable_with_cap`，不要把候选源包装成已接入事实。

## 7. 机器报告

机器可读报告位于：

```text
data/materials/generated/finance/source-probes/dust2-nonferrous/source-probe-report.json
```
