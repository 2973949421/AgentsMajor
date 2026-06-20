# N57b AKShare Endpoint 广探测报告

生成时间：`2026-06-19T15:37:20Z`

金融场景：`dust2-nonferrous`

AKShare 版本：`1.18.64`

## 1. 大白话结论

```text
本报告只说明 AKShare 端点能不能取到数据，不把样例数据写进事实库。
FRED 和 BaoStock 不在 N57b 重做；World Bank / UN Comtrade 当前冻结出 active 主路径。
AKShare 可以作为采集入口，但事实发布方必须逐 endpoint 记录。
ready_for_fact_bank 和 usable_with_cap 是 N57c 的候选输入；candidate_only / unavailable / blocked 不能进入 active fact bank。
```

汇总：

```text
总端点：30
ready_for_fact_bank：6
usable_with_cap：5
candidate_only：3
unavailable：16
blocked：0
```

## 2. N57c 可优先考虑

ready_for_fact_bank：

- `get_shfe_daily`：futures_exchange / SHFE
- `futures_settle_shfe`：futures_exchange / SHFE
- `futures_shfe_warehouse_receipt`：futures_exchange / SHFE
- `get_ine_daily`：futures_exchange / INE
- `futures_settle_ine`：futures_exchange / INE
- `stock_financial_abstract`：company_fundamentals / Sina Finance

usable_with_cap：

- `futures_spot_price`：spot_commodity / Chinese futures market public feeds
- `stock_hsgt_fund_flow_summary_em`：funds_trading / Eastmoney
- `stock_margin_sse`：funds_trading / SSE
- `macro_china_pmi`：macro_public / China official macro public feed via AKShare
- `macro_china_gyzjz`：macro_public / China official macro public feed via AKShare

candidate_only：

- `get_gfex_daily`：futures_exchange / GFEX
- `futures_gfex_warehouse_receipt`：futures_exchange / GFEX
- `futures_news_shmet`：spot_commodity / SHMET

unavailable / blocked：

- `futures_stock_shfe_js`：unavailable / no_records_returned
- `get_receipt`：unavailable / Exit1: EndpointError: ValueError: No tables found
- `futures_spot_price_daily`：unavailable / TimeoutExpired: endpoint exceeded 18s
- `spot_goods`：unavailable / Exit1: EndpointError: KeyError: '铜'; Exit1: EndpointError: KeyError: '铝'; Exit1: EndpointError: KeyError: '锌'; Exit1: EndpointError: KeyError: '镍'
- `stock_financial_analysis_indicator`：unavailable / TimeoutExpired: endpoint exceeded 18s; TimeoutExpired: endpoint exceeded 18s
- `stock_profit_sheet_by_report_em`：unavailable / TimeoutExpired: endpoint exceeded 18s; TimeoutExpired: endpoint exceeded 18s; Exit1: NetworkError: connection failed.
- `stock_balance_sheet_by_report_em`：unavailable / TimeoutExpired: endpoint exceeded 18s; TimeoutExpired: endpoint exceeded 18s; TimeoutExpired: endpoint exceeded 18s
- `stock_cash_flow_sheet_by_report_em`：unavailable / TimeoutExpired: endpoint exceeded 18s; TimeoutExpired: endpoint exceeded 18s; TimeoutExpired: endpoint exceeded 18s
- `stock_board_industry_name_em`：unavailable / TimeoutExpired: endpoint exceeded 18s
- `stock_board_industry_cons_em`：unavailable / Exit1: NetworkError: connection failed.; Exit1: NetworkError: connection failed.
- `stock_board_industry_hist_em`：unavailable / Exit1: NetworkError: connection failed.
- `stock_board_concept_cons_em`：unavailable / Exit1: NetworkError: connection failed.; Exit1: NetworkError: connection failed.
- `stock_sector_fund_flow_rank`：unavailable / Exit1: EndpointError: requests.exceptions.JSONDecodeError: Expecting value: line 1 column 1 (char 0)
- `stock_main_fund_flow`：unavailable / Exit1: EndpointError: requests.exceptions.HTTPError: 502 Server Error: Bad Gateway for url: https://push2.eastmoney.com/api/qt/clist/get?fid=f184&po=1&pz=100&pn=1&np=1&fltt=2&invt=2&fields=f2%2Cf3%2Cf12
- `stock_individual_fund_flow`：unavailable / Exit1: NetworkError: connection failed.; Exit1: NetworkError: connection failed.
- `macro_china_ppi`：unavailable / TimeoutExpired: endpoint exceeded 18s

## 3. 分类别说明

### futures_exchange

- `get_shfe_daily`：ready_for_fact_bank，返回 305 行；可返回字段或已记录空结果。
- `futures_settle_shfe`：ready_for_fact_bank，返回 302 行；可返回字段或已记录空结果。
- `futures_shfe_warehouse_receipt`：ready_for_fact_bank，返回 404 行；可返回字段或已记录空结果。
- `futures_stock_shfe_js`：unavailable，返回 0 行；失败原因：no_records_returned
- `get_receipt`：unavailable，返回 0 行；失败原因：Exit1: EndpointError: ValueError: No tables found
- `get_ine_daily`：ready_for_fact_bank，返回 67 行；可返回字段或已记录空结果。
- `futures_settle_ine`：ready_for_fact_bank，返回 64 行；可返回字段或已记录空结果。
- `get_gfex_daily`：candidate_only，返回 48 行；可返回字段或已记录空结果。
- `futures_gfex_warehouse_receipt`：candidate_only，返回 91 行；可返回字段或已记录空结果。

### spot_commodity

- `futures_spot_price`：usable_with_cap，返回 10 行；可返回字段或已记录空结果。
- `futures_spot_price_daily`：unavailable，返回 0 行；失败原因：TimeoutExpired: endpoint exceeded 18s
- `spot_goods`：unavailable，返回 0 行；失败原因：Exit1: EndpointError: KeyError: '铜'; Exit1: EndpointError: KeyError: '铝'; Exit1: EndpointError: KeyError: '锌'; Exit1: EndpointError: KeyError: '镍'
- `futures_news_shmet`：candidate_only，返回 10 行；可返回字段或已记录空结果。

### company_fundamentals

- `stock_financial_abstract`：ready_for_fact_bank，返回 80 行；可返回字段或已记录空结果。
- `stock_financial_analysis_indicator`：unavailable，返回 0 行；失败原因：TimeoutExpired: endpoint exceeded 18s; TimeoutExpired: endpoint exceeded 18s
- `stock_profit_sheet_by_report_em`：unavailable，返回 0 行；失败原因：TimeoutExpired: endpoint exceeded 18s; TimeoutExpired: endpoint exceeded 18s; Exit1: NetworkError: connection failed.
- `stock_balance_sheet_by_report_em`：unavailable，返回 0 行；失败原因：TimeoutExpired: endpoint exceeded 18s; TimeoutExpired: endpoint exceeded 18s; TimeoutExpired: endpoint exceeded 18s
- `stock_cash_flow_sheet_by_report_em`：unavailable，返回 0 行；失败原因：TimeoutExpired: endpoint exceeded 18s; TimeoutExpired: endpoint exceeded 18s; TimeoutExpired: endpoint exceeded 18s

### industry_sector

- `stock_board_industry_name_em`：unavailable，返回 0 行；失败原因：TimeoutExpired: endpoint exceeded 18s
- `stock_board_industry_cons_em`：unavailable，返回 0 行；失败原因：Exit1: NetworkError: connection failed.; Exit1: NetworkError: connection failed.
- `stock_board_industry_hist_em`：unavailable，返回 0 行；失败原因：Exit1: NetworkError: connection failed.
- `stock_board_concept_cons_em`：unavailable，返回 0 行；失败原因：Exit1: NetworkError: connection failed.; Exit1: NetworkError: connection failed.

### funds_trading

- `stock_sector_fund_flow_rank`：unavailable，返回 0 行；失败原因：Exit1: EndpointError: requests.exceptions.JSONDecodeError: Expecting value: line 1 column 1 (char 0)
- `stock_main_fund_flow`：unavailable，返回 0 行；失败原因：Exit1: EndpointError: requests.exceptions.HTTPError: 502 Server Error: Bad Gateway for url: https://push2.eastmoney.com/api/qt/clist/get?fid=f184&po=1&pz=100&pn=1&np=1&fltt=2&invt=2&fields=f2%2Cf3%2Cf12
- `stock_individual_fund_flow`：unavailable，返回 0 行；失败原因：Exit1: NetworkError: connection failed.; Exit1: NetworkError: connection failed.
- `stock_hsgt_fund_flow_summary_em`：usable_with_cap，返回 4 行；可返回字段或已记录空结果。
- `stock_margin_sse`：usable_with_cap，返回 79 行；可返回字段或已记录空结果。

### macro_public

- `macro_china_pmi`：usable_with_cap，返回 221 行；可返回字段或已记录空结果。
- `macro_china_ppi`：unavailable，返回 0 行；失败原因：TimeoutExpired: endpoint exceeded 18s
- `macro_china_gyzjz`：usable_with_cap，返回 202 行；可返回字段或已记录空结果。


## 4. Endpoint 明细

| endpoint | 类别 | 发布方 | N57c 决策 | 行数 | 字段样例 | 支持证据键 |
|---|---|---|---|---:|---|---|
| `get_shfe_daily` | futures_exchange | SHFE | `ready_for_fact_bank` | 305 | close, date, high, index, low, open, open_interest, pre_settle, settle, symbol | china_supply_demand_proxy, commodity_price_context, commodity_price_momentum |
| `futures_settle_shfe` | futures_exchange | SHFE | `ready_for_fact_bank` | 302 | close_today_fee_ratio, date, hedge_long_margin_ratio, hedge_short_margin_ratio, is_close_today, settle_price, spec_long_margin_ratio, spec_short_margin_ratio, symbol, trade_fee_ratio | commodity_price_context, risk_reward_boundary |
| `futures_shfe_warehouse_receipt` | futures_exchange | SHFE | `ready_for_fact_bank` | 404 | REGNAME, ROWSTATUS, VARID, VARNAME, WGHTUNIT, WHABBRNAME, WHROWS, WHTYPE, WRTCHANGE, WRTWGHTS | china_supply_demand_proxy, domestic_inventory_or_spot_proxy |
| `futures_stock_shfe_js` | futures_exchange | SHFE | `unavailable` | 0 | 无 | domestic_inventory_or_spot_proxy |
| `get_receipt` | futures_exchange | Chinese futures exchanges | `unavailable` | 0 | 无 | china_supply_demand_proxy, domestic_inventory_or_spot_proxy |
| `get_ine_daily` | futures_exchange | INE | `ready_for_fact_bank` | 67 | close, date, high, low, open, open_interest, pre_settle, settle, symbol, turnover | commodity_price_context, commodity_price_momentum |
| `futures_settle_ine` | futures_exchange | INE | `ready_for_fact_bank` | 64 | close_today_fee_ratio, date, hedge_long_margin_ratio, hedge_short_margin_ratio, is_close_today, settle_price, spec_long_margin_ratio, spec_short_margin_ratio, symbol, trade_fee_ratio | commodity_price_context, risk_reward_boundary |
| `get_gfex_daily` | futures_exchange | GFEX | `candidate_only` | 48 | close, date, high, low, open, open_interest, pre_settle, settle, symbol, turnover | commodity_price_context, risk_reward_boundary |
| `futures_gfex_warehouse_receipt` | futures_exchange | GFEX | `candidate_only` | 91 | LC, PD, PS, PT, SI, 今日仓单量, 仓库/分库, 品种, 增减, 昨日仓单量 | domestic_inventory_or_spot_proxy |
| `futures_spot_price` | spot_commodity | Chinese futures market public feeds | `usable_with_cap` | 10 | date, dom_basis, dom_basis_rate, dominant_contract, dominant_contract_price, dominant_month, near_basis, near_basis_rate, near_contract, near_contract_price | commodity_price_context, domestic_inventory_or_spot_proxy |
| `futures_spot_price_daily` | spot_commodity | Chinese futures market public feeds | `unavailable` | 0 | 无 | commodity_price_context, domestic_inventory_or_spot_proxy |
| `spot_goods` | spot_commodity | Sina commodity public feed | `unavailable` | 0 | 无 | commodity_price_context, domestic_inventory_or_spot_proxy |
| `futures_news_shmet` | spot_commodity | SHMET | `candidate_only` | 10 | 内容, 发布时间 | commodity_price_context |
| `stock_financial_abstract` | company_fundamentals | Sina Finance | `ready_for_fact_bank` | 80 | 20051231, 20061231, 20070630, 20070930, 20071231, 20080331, 20080630, 20080930, 20081231, 20090331 | earnings_transmission_proxy, valuation_level, valuation_proxy |
| `stock_financial_analysis_indicator` | company_fundamentals | Sina Finance | `unavailable` | 0 | 无 | earnings_transmission_proxy, risk_reward_boundary, valuation_proxy |
| `stock_profit_sheet_by_report_em` | company_fundamentals | Eastmoney | `unavailable` | 0 | 无 | earnings_transmission_proxy |
| `stock_balance_sheet_by_report_em` | company_fundamentals | Eastmoney | `unavailable` | 0 | 无 | earnings_transmission_proxy, risk_reward_boundary |
| `stock_cash_flow_sheet_by_report_em` | company_fundamentals | Eastmoney | `unavailable` | 0 | 无 | earnings_transmission_proxy, risk_reward_boundary |
| `stock_board_industry_name_em` | industry_sector | Eastmoney | `unavailable` | 0 | 无 | equity_market_reaction, portfolio_stance_evidence_mix |
| `stock_board_industry_cons_em` | industry_sector | Eastmoney | `unavailable` | 0 | 无 | equity_market_reaction, portfolio_stance_evidence_mix |
| `stock_board_industry_hist_em` | industry_sector | Eastmoney | `unavailable` | 0 | 无 | equity_market_reaction, portfolio_stance_evidence_mix |
| `stock_board_concept_cons_em` | industry_sector | Eastmoney | `unavailable` | 0 | 无 | equity_market_reaction, portfolio_stance_evidence_mix |
| `stock_sector_fund_flow_rank` | funds_trading | Eastmoney | `unavailable` | 0 | 无 | equity_market_reaction, risk_reward_boundary |
| `stock_main_fund_flow` | funds_trading | Eastmoney | `unavailable` | 0 | 无 | equity_market_reaction, risk_reward_boundary |
| `stock_individual_fund_flow` | funds_trading | Eastmoney | `unavailable` | 0 | 无 | equity_market_reaction, risk_reward_boundary |
| `stock_hsgt_fund_flow_summary_em` | funds_trading | Eastmoney | `usable_with_cap` | 4 | 上涨数, 下跌数, 交易日, 交易状态, 当日资金余额, 成交净买额, 持平数, 指数涨跌幅, 板块, 相关指数 | risk_reward_boundary |
| `stock_margin_sse` | funds_trading | SSE | `usable_with_cap` | 79 | 信用交易日期, 融券余量, 融券余量金额, 融券卖出量, 融资买入额, 融资余额, 融资融券余额 | risk_reward_boundary |
| `macro_china_pmi` | macro_public | China official macro public feed via AKShare | `usable_with_cap` | 221 | 制造业-同比增长, 制造业-指数, 月份, 非制造业-同比增长, 非制造业-指数 | macro_demand_proxy |
| `macro_china_ppi` | macro_public | China official macro public feed via AKShare | `unavailable` | 0 | 无 | macro_demand_proxy, risk_reward_boundary |
| `macro_china_gyzjz` | macro_public | China official macro public feed via AKShare | `usable_with_cap` | 202 | 发布时间, 同比增长, 月份, 累计增长 | macro_demand_proxy |

## 5. 进入 N57c 的硬边界

```text
AKShare 不是事实发布方，只是 accessProvider。
来源不清的 endpoint 不得进入 ready_for_fact_bank。
公司基本面如果没有分产品、产量、成本、矿山权益，就只能做财务代理，不能证明金属盈利弹性。
资金流只能做风险收益或拥挤度代理，不能证明基本面需求。
宏观公开项只能做背景，不证明 1-3 个月有色供需。
```

机器报告：

```text
data/materials/generated/finance/source-probes/dust2-nonferrous/akshare-endpoint-probe-report.json
```
