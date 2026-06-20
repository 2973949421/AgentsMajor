from __future__ import annotations

import argparse
import datetime as dt
import inspect
import json
import os
import re
import subprocess
import sys
import traceback
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
REPORT_FILE_NAME = "akshare-endpoint-probe-report.json"
MARKDOWN_REPORT_FILE_NAME = "n57b-akshare-endpoint-probe-report.md"
ACCESS_PROVIDER = "AKShare"
COLLECTOR_ID = "akshare_python_package_v0"
DECISIONS = {
    "ready_for_fact_bank",
    "usable_with_cap",
    "candidate_only",
    "unavailable",
    "blocked",
}


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def processed_finance_root() -> Path:
    return repo_root() / "data" / "materials" / "processed" / "finance"


def generated_probe_root() -> Path:
    return repo_root() / "data" / "materials" / "generated" / "finance" / "source-probes"


def docs_finance_root() -> Path:
    return repo_root() / "docs" / "finance"


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(value, file, ensure_ascii=False, indent=2)
        file.write("\n")


def write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")


def sanitize_message(value: Any) -> str:
    raw_text = str(value)
    text = raw_text.replace("\r", " ").replace("\n", " ").strip()
    text = re.sub(r"(?i)(api[_-]?key\s*[=:]\s*)[^&\s,)]+", r"\1<redacted>", text)
    text = re.sub(r"(?i)(token\s*[=:]\s*)[^&\s,)]+", r"\1<redacted>", text)
    text = re.sub(r"(?i)(cookie\s*[=:]\s*)[^&\s,)]+", r"\1<redacted>", text)
    lowered = text.lower()
    if "name or service not known" in lowered or "getaddrinfo failed" in lowered:
        return "NetworkError: DNS resolution failed."
    if "max retries exceeded" in lowered and ("newconnectionerror" in lowered or "name resolution" in lowered):
        return "NetworkError: upstream host cannot be reached."
    if "connecttimeout" in lowered or "read timed out" in lowered or "timed out" in lowered:
        return "NetworkError: request timed out."
    if "connection refused" in lowered or "connection aborted" in lowered:
        return "NetworkError: connection failed."
    if "traceback (most recent call last)" in lowered:
        lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
        last_line = lines[-1] if lines else text
        last_line = re.sub(r"(?i)(api[_-]?key\s*[=:]\s*)[^&\s,)]+", r"\1<redacted>", last_line)
        last_line = re.sub(r"(?i)(token\s*[=:]\s*)[^&\s,)]+", r"\1<redacted>", last_line)
        last_line = re.sub(r"(?i)(cookie\s*[=:]\s*)[^&\s,)]+", r"\1<redacted>", last_line)
        return f"EndpointError: {last_line[:180]}"
    if len(text) > 240:
        return f"{text[:240]}..."
    return text


def safe_param_summary(params: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in params.items():
        if re.search(r"(?i)key|token|cookie|secret|password", key):
            result[key] = "<redacted>"
        elif isinstance(value, list):
            result[key] = [str(item)[:40] for item in value[:12]]
        else:
            result[key] = str(value)[:80]
    return result


def collect_required_keys(map_slug: str) -> list[str]:
    topics = read_json(processed_finance_root() / "maps" / map_slug / "round-topics.json")
    keys: set[str] = set()
    for round_item in topics.get("rounds", []):
        for evidence_item in round_item.get("requiredEvidenceSchema", []):
            key = evidence_item.get("requiredKey")
            if key:
                keys.add(str(key))
    return sorted(keys)


def recent_trade_dates(limit: int = 4) -> list[str]:
    today = dt.date.today()
    dates: list[str] = []
    offset = 0
    while len(dates) < limit and offset < 20:
        day = today - dt.timedelta(days=offset)
        if day.weekday() < 5:
            dates.append(day.strftime("%Y%m%d"))
        offset += 1
    for fixed in ["20260119", "20240419", "20240122", "20221223"]:
        if fixed not in dates:
            dates.append(fixed)
    return dates[: limit + 4]


def default_start_end() -> tuple[str, str]:
    end = dt.date.today()
    start = end - dt.timedelta(days=120)
    return start.strftime("%Y%m%d"), end.strftime("%Y%m%d")


def endpoint_catalog() -> list[dict[str, Any]]:
    start, end = default_start_end()
    dates = recent_trade_dates()
    shfe_symbols = ["CU", "AL", "ZN", "NI", "SN", "PB", "AU", "AG"]
    all_symbols = shfe_symbols + ["BC", "LC", "SI"]
    return [
        {
            "category": "futures_exchange",
            "endpointName": "get_shfe_daily",
            "functionName": "get_shfe_daily",
            "sourcePublisher": "SHFE",
            "testedParamSets": [{"date": date} for date in dates],
            "frequency": "daily",
            "entityCoverage": shfe_symbols,
            "supportsRequiredEvidenceKeys": ["commodity_price_context", "commodity_price_momentum", "china_supply_demand_proxy"],
            "allowedClaimTypes": ["commodity_trend", "china_futures_context", "risk_reward"],
            "notAllowedClaimTypes": ["company_earnings_confirmed", "full_industry_fundamentals_confirmed"],
        },
        {
            "category": "futures_exchange",
            "endpointName": "futures_settle_shfe",
            "functionName": "futures_settle_shfe",
            "sourcePublisher": "SHFE",
            "testedParamSets": [{"date": date} for date in dates],
            "frequency": "daily",
            "entityCoverage": shfe_symbols,
            "supportsRequiredEvidenceKeys": ["commodity_price_context", "risk_reward_boundary"],
            "allowedClaimTypes": ["commodity_trend", "china_futures_context", "risk_reward"],
            "notAllowedClaimTypes": ["company_earnings_confirmed"],
        },
        {
            "category": "futures_exchange",
            "endpointName": "futures_shfe_warehouse_receipt",
            "functionName": "futures_shfe_warehouse_receipt",
            "sourcePublisher": "SHFE",
            "testedParamSets": [{"date": date} for date in dates],
            "frequency": "daily",
            "entityCoverage": shfe_symbols,
            "supportsRequiredEvidenceKeys": ["domestic_inventory_or_spot_proxy", "china_supply_demand_proxy"],
            "allowedClaimTypes": ["inventory_pressure", "china_supply_demand"],
            "notAllowedClaimTypes": ["company_earnings_confirmed", "a_share_relative_allocation_confirmed"],
        },
        {
            "category": "futures_exchange",
            "endpointName": "futures_stock_shfe_js",
            "functionName": "futures_stock_shfe_js",
            "sourcePublisher": "SHFE",
            "testedParamSets": [{"date": date} for date in dates],
            "frequency": "daily",
            "entityCoverage": shfe_symbols,
            "supportsRequiredEvidenceKeys": ["domestic_inventory_or_spot_proxy"],
            "allowedClaimTypes": ["inventory_pressure", "china_supply_demand"],
            "notAllowedClaimTypes": ["company_earnings_confirmed"],
        },
        {
            "category": "futures_exchange",
            "endpointName": "get_receipt",
            "functionName": "get_receipt",
            "sourcePublisher": "Chinese futures exchanges",
            "testedParamSets": [{"start_date": dates[2], "end_date": dates[0], "vars_list": all_symbols}],
            "frequency": "daily",
            "entityCoverage": all_symbols,
            "supportsRequiredEvidenceKeys": ["domestic_inventory_or_spot_proxy", "china_supply_demand_proxy"],
            "allowedClaimTypes": ["inventory_pressure", "china_supply_demand"],
            "notAllowedClaimTypes": ["company_earnings_confirmed"],
        },
        {
            "category": "futures_exchange",
            "endpointName": "get_ine_daily",
            "functionName": "get_ine_daily",
            "sourcePublisher": "INE",
            "testedParamSets": [{"date": date} for date in dates],
            "frequency": "daily",
            "entityCoverage": ["BC"],
            "supportsRequiredEvidenceKeys": ["commodity_price_context", "commodity_price_momentum"],
            "allowedClaimTypes": ["commodity_trend", "china_futures_context"],
            "notAllowedClaimTypes": ["company_earnings_confirmed"],
        },
        {
            "category": "futures_exchange",
            "endpointName": "futures_settle_ine",
            "functionName": "futures_settle_ine",
            "sourcePublisher": "INE",
            "testedParamSets": [{"date": date} for date in dates],
            "frequency": "daily",
            "entityCoverage": ["BC"],
            "supportsRequiredEvidenceKeys": ["commodity_price_context", "risk_reward_boundary"],
            "allowedClaimTypes": ["commodity_trend", "china_futures_context", "risk_reward"],
            "notAllowedClaimTypes": ["company_earnings_confirmed"],
        },
        {
            "category": "futures_exchange",
            "endpointName": "get_gfex_daily",
            "functionName": "get_gfex_daily",
            "sourcePublisher": "GFEX",
            "testedParamSets": [{"date": date} for date in dates],
            "frequency": "daily",
            "entityCoverage": ["LC", "SI"],
            "supportsRequiredEvidenceKeys": ["commodity_price_context", "risk_reward_boundary"],
            "allowedClaimTypes": ["commodity_trend", "candidate_battery_metal_context"],
            "notAllowedClaimTypes": ["broad_nonferrous_allocation_confirmed"],
            "decisionHint": "candidate_only",
        },
        {
            "category": "futures_exchange",
            "endpointName": "futures_gfex_warehouse_receipt",
            "functionName": "futures_gfex_warehouse_receipt",
            "sourcePublisher": "GFEX",
            "testedParamSets": [{"date": date} for date in dates],
            "frequency": "daily",
            "entityCoverage": ["LC", "SI"],
            "supportsRequiredEvidenceKeys": ["domestic_inventory_or_spot_proxy"],
            "allowedClaimTypes": ["inventory_pressure", "candidate_battery_metal_context"],
            "notAllowedClaimTypes": ["broad_nonferrous_allocation_confirmed"],
            "decisionHint": "candidate_only",
        },
        {
            "category": "spot_commodity",
            "endpointName": "futures_spot_price",
            "functionName": "futures_spot_price",
            "sourcePublisher": "Chinese futures market public feeds",
            "testedParamSets": [{"date": dates[0], "vars_list": all_symbols}, {"date": "20240430", "vars_list": all_symbols}],
            "frequency": "daily",
            "entityCoverage": all_symbols,
            "supportsRequiredEvidenceKeys": ["domestic_inventory_or_spot_proxy", "commodity_price_context"],
            "allowedClaimTypes": ["spot_futures_basis_proxy", "commodity_trend"],
            "notAllowedClaimTypes": ["company_earnings_confirmed"],
        },
        {
            "category": "spot_commodity",
            "endpointName": "futures_spot_price_daily",
            "functionName": "futures_spot_price_daily",
            "sourcePublisher": "Chinese futures market public feeds",
            "testedParamSets": [{"start_day": start, "end_day": end, "vars_list": all_symbols}],
            "frequency": "daily",
            "entityCoverage": all_symbols,
            "supportsRequiredEvidenceKeys": ["domestic_inventory_or_spot_proxy", "commodity_price_context"],
            "allowedClaimTypes": ["spot_futures_basis_proxy", "commodity_trend"],
            "notAllowedClaimTypes": ["company_earnings_confirmed"],
        },
        {
            "category": "spot_commodity",
            "endpointName": "spot_goods",
            "functionName": "spot_goods",
            "sourcePublisher": "Sina commodity public feed",
            "testedParamSets": [{"symbol": "铜"}, {"symbol": "铝"}, {"symbol": "锌"}, {"symbol": "镍"}],
            "frequency": "daily_or_snapshot",
            "entityCoverage": ["copper", "aluminum", "zinc", "nickel"],
            "supportsRequiredEvidenceKeys": ["commodity_price_context", "domestic_inventory_or_spot_proxy"],
            "allowedClaimTypes": ["spot_price_proxy", "commodity_trend"],
            "notAllowedClaimTypes": ["company_earnings_confirmed", "domestic_inventory_confirmed"],
        },
        {
            "category": "spot_commodity",
            "endpointName": "futures_news_shmet",
            "functionName": "futures_news_shmet",
            "sourcePublisher": "SHMET",
            "testedParamSets": [{"symbol": "全部"}],
            "frequency": "news_snapshot",
            "entityCoverage": ["nonferrous_news"],
            "supportsRequiredEvidenceKeys": ["commodity_price_context"],
            "allowedClaimTypes": ["contextual_market_news"],
            "notAllowedClaimTypes": ["final_fact_without_manual_review", "company_earnings_confirmed"],
            "decisionHint": "candidate_only",
        },
        {
            "category": "company_fundamentals",
            "endpointName": "stock_financial_abstract",
            "functionName": "stock_financial_abstract",
            "sourcePublisher": "Sina Finance",
            "testedParamSets": [{"symbol": "601899"}, {"symbol": "600362"}, {"symbol": "601600"}],
            "frequency": "quarterly_or_report",
            "entityCoverage": ["Zijin Mining", "Jiangxi Copper", "Chalco"],
            "supportsRequiredEvidenceKeys": ["earnings_transmission_proxy", "valuation_proxy", "valuation_level"],
            "allowedClaimTypes": ["company_financial_proxy", "earnings_transmission_proxy", "valuation_support"],
            "notAllowedClaimTypes": ["product_margin_confirmed", "mine_output_confirmed"],
        },
        {
            "category": "company_fundamentals",
            "endpointName": "stock_financial_analysis_indicator",
            "functionName": "stock_financial_analysis_indicator",
            "sourcePublisher": "Sina Finance",
            "testedParamSets": [{"symbol": "601899", "start_year": "2021"}, {"symbol": "600362", "start_year": "2021"}],
            "frequency": "quarterly_or_report",
            "entityCoverage": ["Zijin Mining", "Jiangxi Copper"],
            "supportsRequiredEvidenceKeys": ["earnings_transmission_proxy", "valuation_proxy", "risk_reward_boundary"],
            "allowedClaimTypes": ["company_financial_proxy", "profitability_proxy", "risk_reward"],
            "notAllowedClaimTypes": ["product_margin_confirmed", "commodity_supply_demand_confirmed"],
        },
        {
            "category": "company_fundamentals",
            "endpointName": "stock_profit_sheet_by_report_em",
            "functionName": "stock_profit_sheet_by_report_em",
            "sourcePublisher": "Eastmoney",
            "testedParamSets": [{"symbol": "SH601899"}, {"symbol": "SH600362"}, {"symbol": "SH601600"}],
            "frequency": "quarterly_or_report",
            "entityCoverage": ["Zijin Mining", "Jiangxi Copper", "Chalco"],
            "supportsRequiredEvidenceKeys": ["earnings_transmission_proxy"],
            "allowedClaimTypes": ["income_statement_proxy", "earnings_transmission_proxy"],
            "notAllowedClaimTypes": ["product_margin_confirmed", "mine_output_confirmed"],
        },
        {
            "category": "company_fundamentals",
            "endpointName": "stock_balance_sheet_by_report_em",
            "functionName": "stock_balance_sheet_by_report_em",
            "sourcePublisher": "Eastmoney",
            "testedParamSets": [{"symbol": "SH601899"}, {"symbol": "SH600362"}, {"symbol": "SH601600"}],
            "frequency": "quarterly_or_report",
            "entityCoverage": ["Zijin Mining", "Jiangxi Copper", "Chalco"],
            "supportsRequiredEvidenceKeys": ["risk_reward_boundary", "earnings_transmission_proxy"],
            "allowedClaimTypes": ["balance_sheet_proxy", "risk_reward"],
            "notAllowedClaimTypes": ["product_margin_confirmed", "commodity_supply_demand_confirmed"],
        },
        {
            "category": "company_fundamentals",
            "endpointName": "stock_cash_flow_sheet_by_report_em",
            "functionName": "stock_cash_flow_sheet_by_report_em",
            "sourcePublisher": "Eastmoney",
            "testedParamSets": [{"symbol": "SH601899"}, {"symbol": "SH600362"}, {"symbol": "SH601600"}],
            "frequency": "quarterly_or_report",
            "entityCoverage": ["Zijin Mining", "Jiangxi Copper", "Chalco"],
            "supportsRequiredEvidenceKeys": ["risk_reward_boundary", "earnings_transmission_proxy"],
            "allowedClaimTypes": ["cash_flow_proxy", "risk_reward"],
            "notAllowedClaimTypes": ["product_margin_confirmed", "commodity_supply_demand_confirmed"],
        },
        {
            "category": "industry_sector",
            "endpointName": "stock_board_industry_name_em",
            "functionName": "stock_board_industry_name_em",
            "sourcePublisher": "Eastmoney",
            "testedParamSets": [{}],
            "frequency": "snapshot",
            "entityCoverage": ["A-share industries"],
            "supportsRequiredEvidenceKeys": ["equity_market_reaction", "portfolio_stance_evidence_mix"],
            "allowedClaimTypes": ["sector_mapping", "market_confirmation"],
            "notAllowedClaimTypes": ["company_earnings_confirmed"],
        },
        {
            "category": "industry_sector",
            "endpointName": "stock_board_industry_cons_em",
            "functionName": "stock_board_industry_cons_em",
            "sourcePublisher": "Eastmoney",
            "testedParamSets": [{"symbol": "小金属"}, {"symbol": "贵金属"}],
            "frequency": "snapshot",
            "entityCoverage": ["minor_metals", "precious_metals"],
            "supportsRequiredEvidenceKeys": ["equity_market_reaction", "portfolio_stance_evidence_mix"],
            "allowedClaimTypes": ["sector_constituent_mapping", "market_confirmation"],
            "notAllowedClaimTypes": ["company_product_exposure_confirmed"],
        },
        {
            "category": "industry_sector",
            "endpointName": "stock_board_industry_hist_em",
            "functionName": "stock_board_industry_hist_em",
            "sourcePublisher": "Eastmoney",
            "testedParamSets": [{"symbol": "小金属", "start_date": start, "end_date": end, "period": "日k", "adjust": ""}],
            "frequency": "daily",
            "entityCoverage": ["minor_metals"],
            "supportsRequiredEvidenceKeys": ["equity_market_reaction", "portfolio_stance_evidence_mix"],
            "allowedClaimTypes": ["sector_price_momentum", "market_confirmation"],
            "notAllowedClaimTypes": ["company_earnings_confirmed"],
        },
        {
            "category": "industry_sector",
            "endpointName": "stock_board_concept_cons_em",
            "functionName": "stock_board_concept_cons_em",
            "sourcePublisher": "Eastmoney",
            "testedParamSets": [{"symbol": "稀土永磁"}, {"symbol": "锂电池"}],
            "frequency": "snapshot",
            "entityCoverage": ["rare_earth", "lithium_battery"],
            "supportsRequiredEvidenceKeys": ["equity_market_reaction", "portfolio_stance_evidence_mix"],
            "allowedClaimTypes": ["sector_constituent_mapping", "structural_allocation"],
            "notAllowedClaimTypes": ["company_product_exposure_confirmed"],
        },
        {
            "category": "funds_trading",
            "endpointName": "stock_sector_fund_flow_rank",
            "functionName": "stock_sector_fund_flow_rank",
            "sourcePublisher": "Eastmoney",
            "testedParamSets": [{"indicator": "今日", "sector_type": "行业资金流"}],
            "frequency": "daily_or_intraday",
            "entityCoverage": ["A-share industries"],
            "supportsRequiredEvidenceKeys": ["risk_reward_boundary", "equity_market_reaction"],
            "allowedClaimTypes": ["fund_flow_proxy", "risk_reward"],
            "notAllowedClaimTypes": ["fundamental_demand_confirmed"],
        },
        {
            "category": "funds_trading",
            "endpointName": "stock_main_fund_flow",
            "functionName": "stock_main_fund_flow",
            "sourcePublisher": "Eastmoney",
            "testedParamSets": [{"symbol": "全部股票"}],
            "frequency": "daily_or_intraday",
            "entityCoverage": ["A-share market"],
            "supportsRequiredEvidenceKeys": ["risk_reward_boundary", "equity_market_reaction"],
            "allowedClaimTypes": ["fund_flow_proxy", "risk_reward"],
            "notAllowedClaimTypes": ["fundamental_demand_confirmed"],
        },
        {
            "category": "funds_trading",
            "endpointName": "stock_individual_fund_flow",
            "functionName": "stock_individual_fund_flow",
            "sourcePublisher": "Eastmoney",
            "testedParamSets": [{"stock": "601899", "market": "sh"}, {"stock": "000630", "market": "sz"}],
            "frequency": "daily_or_intraday",
            "entityCoverage": ["Zijin Mining", "Tongling Nonferrous"],
            "supportsRequiredEvidenceKeys": ["risk_reward_boundary", "equity_market_reaction"],
            "allowedClaimTypes": ["stock_fund_flow_proxy", "risk_reward"],
            "notAllowedClaimTypes": ["company_earnings_confirmed"],
        },
        {
            "category": "funds_trading",
            "endpointName": "stock_hsgt_fund_flow_summary_em",
            "functionName": "stock_hsgt_fund_flow_summary_em",
            "sourcePublisher": "Eastmoney",
            "testedParamSets": [{}],
            "frequency": "daily",
            "entityCoverage": ["northbound_fund_flow"],
            "supportsRequiredEvidenceKeys": ["risk_reward_boundary"],
            "allowedClaimTypes": ["fund_flow_proxy", "risk_reward"],
            "notAllowedClaimTypes": ["company_earnings_confirmed"],
        },
        {
            "category": "funds_trading",
            "endpointName": "stock_margin_sse",
            "functionName": "stock_margin_sse",
            "sourcePublisher": "SSE",
            "testedParamSets": [{"start_date": start, "end_date": end}],
            "frequency": "daily",
            "entityCoverage": ["SSE margin trading"],
            "supportsRequiredEvidenceKeys": ["risk_reward_boundary"],
            "allowedClaimTypes": ["leverage_proxy", "risk_reward"],
            "notAllowedClaimTypes": ["company_earnings_confirmed"],
        },
        {
            "category": "macro_public",
            "endpointName": "macro_china_pmi",
            "functionName": "macro_china_pmi",
            "sourcePublisher": "China official macro public feed via AKShare",
            "testedParamSets": [{}],
            "frequency": "monthly",
            "entityCoverage": ["China PMI"],
            "supportsRequiredEvidenceKeys": ["macro_demand_proxy"],
            "allowedClaimTypes": ["macro_demand_proxy", "global_cycle_signal"],
            "notAllowedClaimTypes": ["short_term_inventory_confirmed", "company_earnings_confirmed"],
            "decisionHint": "usable_with_cap",
        },
        {
            "category": "macro_public",
            "endpointName": "macro_china_ppi",
            "functionName": "macro_china_ppi",
            "sourcePublisher": "China official macro public feed via AKShare",
            "testedParamSets": [{}],
            "frequency": "monthly",
            "entityCoverage": ["China PPI"],
            "supportsRequiredEvidenceKeys": ["macro_demand_proxy", "risk_reward_boundary"],
            "allowedClaimTypes": ["macro_demand_proxy", "inflation_context"],
            "notAllowedClaimTypes": ["short_term_inventory_confirmed", "company_earnings_confirmed"],
            "decisionHint": "usable_with_cap",
        },
        {
            "category": "macro_public",
            "endpointName": "macro_china_gyzjz",
            "functionName": "macro_china_gyzjz",
            "sourcePublisher": "China official macro public feed via AKShare",
            "testedParamSets": [{}],
            "frequency": "monthly",
            "entityCoverage": ["China industrial value added"],
            "supportsRequiredEvidenceKeys": ["macro_demand_proxy"],
            "allowedClaimTypes": ["macro_demand_proxy", "industrial_activity"],
            "notAllowedClaimTypes": ["short_term_inventory_confirmed", "company_earnings_confirmed"],
            "decisionHint": "usable_with_cap",
        },
    ]


def run_akshare_call(function_name: str, params: dict[str, Any], timeout_seconds: int) -> dict[str, Any]:
    child_code = r"""
import json
import sys
import akshare as ak

function_name = sys.argv[1]
params = json.loads(sys.argv[2])
func = getattr(ak, function_name)
value = func(**params)

def row_count(obj):
    shape = getattr(obj, "shape", None)
    if shape is not None:
        return int(shape[0])
    if isinstance(obj, dict):
        total = 0
        for val in obj.values():
            total += row_count(val)
        return total if total else len(obj)
    if isinstance(obj, list):
        return len(obj)
    return 0 if obj is None else 1

def fields(obj):
    columns = getattr(obj, "columns", None)
    if columns is not None:
        return [str(item) for item in list(columns)[:80]]
    if isinstance(obj, dict):
        result = []
        for key, val in obj.items():
            result.append(str(key))
            columns = getattr(val, "columns", None)
            if columns is not None:
                result.extend(str(item) for item in list(columns)[:40])
            elif isinstance(val, list) and val and isinstance(val[0], dict):
                result.extend(str(item) for item in list(val[0].keys())[:40])
        return result[:80]
    if isinstance(obj, list) and obj and isinstance(obj[0], dict):
        return [str(item) for item in list(obj[0].keys())[:80]]
    return []

def sample_period(obj):
    names = ["date", "日期", "trade_date", "交易日", "year", "period", "报告期", "公告日期", "时间"]
    columns = getattr(obj, "columns", None)
    if columns is not None:
        for name in names:
            if name in obj.columns:
                series = obj[name].dropna().astype(str)
                if not series.empty:
                    return f"{series.iloc[0]}..{series.iloc[-1]}"
    if isinstance(obj, dict):
        for val in obj.values():
            period = sample_period(val)
            if period:
                return period
    if isinstance(obj, list) and obj:
        for name in names:
            values = [str(row.get(name)) for row in obj if isinstance(row, dict) and row.get(name)]
            if values:
                return f"{values[0]}..{values[-1]}"
    return None

print("__AK_PROBE_JSON__" + json.dumps({
    "returnedRows": row_count(value),
    "returnedFields": fields(value),
    "samplePeriod": sample_period(value),
}, ensure_ascii=False))
"""
    child_env = dict(os.environ)
    child_env["PYTHONIOENCODING"] = "utf-8"
    try:
        completed = subprocess.run(
            [sys.executable, "-c", child_code, function_name, json.dumps(params, ensure_ascii=False)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=child_env,
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired:
        return {
            "status": "error",
            "returnedRows": 0,
            "returnedFields": [],
            "samplePeriod": None,
            "failureReason": {"errorType": "TimeoutExpired", "message": f"endpoint exceeded {timeout_seconds}s"},
        }
    stdout = (completed.stdout or "").strip().splitlines()
    payload_text = "{}"
    for line in reversed(stdout):
        if line.startswith("__AK_PROBE_JSON__"):
            payload_text = line.replace("__AK_PROBE_JSON__", "", 1)
            break
    try:
        payload = json.loads(payload_text)
    except json.JSONDecodeError:
        payload = {"errorType": "InvalidProbeOutput", "message": sanitize_message(payload_text)}
    if completed.returncode != 0 or payload.get("errorType"):
        return {
            "status": "error",
            "returnedRows": 0,
            "returnedFields": [],
            "samplePeriod": None,
            "failureReason": {
                "errorType": payload.get("errorType", f"Exit{completed.returncode}"),
                "message": sanitize_message(payload.get("message") or completed.stderr or completed.stdout),
            },
        }
    rows = int(payload.get("returnedRows", 0) or 0)
    return {
        "status": "success" if rows > 0 else "empty",
        "returnedRows": rows,
        "returnedFields": [str(item) for item in payload.get("returnedFields", [])[:80]],
        "samplePeriod": payload.get("samplePeriod"),
        "failureReason": None,
    }


def available_akshare_functions() -> tuple[str, dict[str, str]]:
    import akshare as ak

    version = str(getattr(ak, "__version__", "unknown"))
    signatures: dict[str, str] = {}
    for name in dir(ak):
        if name.startswith("_"):
            continue
        value = getattr(ak, name, None)
        if callable(value):
            try:
                signatures[name] = str(inspect.signature(value))
            except (TypeError, ValueError):
                signatures[name] = "(signature unavailable)"
    return version, signatures


def classify_endpoint(spec: dict[str, Any], attempts: list[dict[str, Any]], function_exists: bool) -> str:
    if not function_exists:
        return "unavailable"
    if spec.get("blocked"):
        return "blocked"
    successful = [item for item in attempts if item["status"] == "success"]
    if not successful:
        return "unavailable"
    hint = spec.get("decisionHint")
    if hint in DECISIONS:
        return hint
    if not spec.get("sourcePublisher") or str(spec.get("sourcePublisher")).lower().startswith("unknown"):
        return "candidate_only"
    fields = {field for item in successful for field in item.get("returnedFields", [])}
    if len(fields) < 3:
        return "usable_with_cap"
    if spec["category"] in {"macro_public", "spot_commodity", "funds_trading"}:
        return "usable_with_cap"
    return "ready_for_fact_bank"


def probe_endpoint(spec: dict[str, Any], signatures: dict[str, str], timeout_seconds: int) -> dict[str, Any]:
    function_name = spec["functionName"]
    function_exists = function_name in signatures
    attempts: list[dict[str, Any]] = []
    if function_exists:
        for params in spec.get("testedParamSets", [{}]):
            result = run_akshare_call(function_name, params, timeout_seconds)
            attempts.append({
                "params": safe_param_summary(params),
                **result,
            })
            if result["status"] == "success":
                break
    else:
        attempts.append({
            "params": {},
            "status": "error",
            "returnedRows": 0,
            "returnedFields": [],
            "samplePeriod": None,
            "failureReason": {"errorType": "MissingFunction", "message": f"{function_name} is not available in current AKShare package."},
        })
    successful = [item for item in attempts if item["status"] == "success"]
    returned_rows = sum(int(item.get("returnedRows", 0)) for item in successful)
    returned_fields = sorted({str(field) for item in successful for field in item.get("returnedFields", [])})
    sample_periods = [str(item["samplePeriod"]) for item in successful if item.get("samplePeriod")]
    decision = classify_endpoint(spec, attempts, function_exists)
    failure_reason = None
    if decision in {"unavailable", "blocked"}:
        failures = [item.get("failureReason") for item in attempts if item.get("failureReason")]
        empties = [item for item in attempts if item.get("status") == "empty"]
        if failures:
            failure_reason = "; ".join(
                f"{failure.get('errorType')}: {failure.get('message')}" for failure in failures if isinstance(failure, dict)
            )[:1000]
        elif empties:
            failure_reason = "no_records_returned"
    return {
        "category": spec["category"],
        "endpointName": spec["endpointName"],
        "functionName": function_name,
        "functionSignature": signatures.get(function_name),
        "sourcePublisher": spec.get("sourcePublisher", "unknown_publisher"),
        "accessProvider": ACCESS_PROVIDER,
        "collector": COLLECTOR_ID,
        "testedParams": [item["params"] for item in attempts],
        "attempts": attempts,
        "returnedRows": returned_rows,
        "returnedFields": returned_fields,
        "samplePeriod": "; ".join(sample_periods[:3]) if sample_periods else None,
        "frequency": spec.get("frequency", "unknown"),
        "entityCoverage": spec.get("entityCoverage", []),
        "supportsRequiredEvidenceKeys": sorted(set(spec.get("supportsRequiredEvidenceKeys", []))),
        "allowedClaimTypes": sorted(set(spec.get("allowedClaimTypes", []))),
        "notAllowedClaimTypes": sorted(set(spec.get("notAllowedClaimTypes", []))),
        "decisionForN57c": decision,
        "failureReason": failure_reason,
        "notes": claim_boundary_notes(spec, decision),
    }


def claim_boundary_notes(spec: dict[str, Any], decision: str) -> list[str]:
    category = spec["category"]
    notes = [
        "AKShare 是访问入口；事实发布方、endpoint、字段和变换口径必须保留。",
    ]
    if category == "futures_exchange":
        notes.append("可支持国内期货价格、结算、成交、持仓或库存/仓单代理；不能单独证明公司盈利。")
    elif category == "spot_commodity":
        notes.append("可支持现货或商品价格上下文；不能直接证明库存、产量或公司利润。")
    elif category == "company_fundamentals":
        notes.append("可支持公司财务代理；若无分产品、成本、产量字段，不能证明具体金属盈利弹性。")
    elif category == "industry_sector":
        notes.append("可支持板块表现、成分和结构性线索；不能替代官方行业基本面。")
    elif category == "funds_trading":
        notes.append("可支持资金和交易拥挤度代理；不能证明基本面需求。")
    elif category == "macro_public":
        notes.append("可作为宏观背景代理；不能直接证明 1-3 个月国内有色供需。")
    if decision == "usable_with_cap":
        notes.append("进入 N57c 时必须降权使用，并设置 score cap。")
    if decision == "candidate_only":
        notes.append("当前只作为候选观察，不进入 N57c active fact bank 第一版。")
    return notes


def reflected_candidates(signatures: dict[str, str], catalog_names: set[str]) -> list[dict[str, Any]]:
    keywords = [
        "futures",
        "shfe",
        "ine",
        "gfex",
        "spot",
        "stock_financial",
        "balance",
        "cash_flow",
        "profit",
        "indicator",
        "valuation",
        "board",
        "sector",
        "fund_flow",
        "macro_china",
    ]
    matches = [
        name for name in sorted(signatures)
        if name not in catalog_names and any(keyword in name.lower() for keyword in keywords)
    ]
    return [
        {
            "endpointName": name,
            "functionName": name,
            "functionSignature": signatures.get(name),
            "sourcePublisher": "unknown_publisher",
            "accessProvider": ACCESS_PROVIDER,
            "collector": COLLECTOR_ID,
            "candidateReason": "matched_reflection_keyword",
            "decisionForN57c": "candidate_only",
        }
        for name in matches[:240]
    ]


def build_summary(endpoints: list[dict[str, Any]]) -> dict[str, Any]:
    by_decision = {decision: 0 for decision in sorted(DECISIONS)}
    by_category: dict[str, dict[str, int]] = {}
    for endpoint in endpoints:
        decision = endpoint["decisionForN57c"]
        category = endpoint["category"]
        by_decision[decision] = by_decision.get(decision, 0) + 1
        category_counts = by_category.setdefault(category, {item: 0 for item in sorted(DECISIONS)})
        category_counts[decision] = category_counts.get(decision, 0) + 1
    return {
        "totalEndpoints": len(endpoints),
        "byDecisionForN57c": by_decision,
        "byCategoryAndDecision": by_category,
        "readyOrUsableEndpointCount": sum(1 for item in endpoints if item["decisionForN57c"] in {"ready_for_fact_bank", "usable_with_cap"}),
        "conclusionZh": "N57b 只判断 AKShare endpoint 可用性；可用 endpoint 仍需在 N57c 中转换成事实并写清来源链和 claim 边界。",
    }


def markdown_report(report: dict[str, Any]) -> str:
    endpoints = report["akshareEndpointProbes"]
    generated_at = report["generatedAt"]
    rows = "\n".join(
        "| `{endpointName}` | {category} | {sourcePublisher} | `{decision}` | {returnedRows} | {fields} | {keys} |".format(
            endpointName=item["endpointName"],
            category=item["category"],
            sourcePublisher=item["sourcePublisher"],
            decision=item["decisionForN57c"],
            returnedRows=item["returnedRows"],
            fields=", ".join(item["returnedFields"][:10]) or "无",
            keys=", ".join(item["supportsRequiredEvidenceKeys"]) or "无",
        )
        for item in endpoints
    )
    category_sections: list[str] = []
    for category in ["futures_exchange", "spot_commodity", "company_fundamentals", "industry_sector", "funds_trading", "macro_public"]:
        items = [item for item in endpoints if item["category"] == category]
        if not items:
            category_sections.append(f"### {category}\n\n未探测到该类别 endpoint。\n")
            continue
        lines = []
        for item in items:
            status = item["decisionForN57c"]
            reason = f"失败原因：{item['failureReason']}" if item.get("failureReason") else "可返回字段或已记录空结果。"
            lines.append(f"- `{item['endpointName']}`：{status}，返回 {item['returnedRows']} 行；{reason}")
        category_sections.append(f"### {category}\n\n" + "\n".join(lines) + "\n")
    ready = [item for item in endpoints if item["decisionForN57c"] == "ready_for_fact_bank"]
    usable = [item for item in endpoints if item["decisionForN57c"] == "usable_with_cap"]
    candidates = [item for item in endpoints if item["decisionForN57c"] == "candidate_only"]
    unavailable = [item for item in endpoints if item["decisionForN57c"] in {"unavailable", "blocked"}]
    return f"""# N57b AKShare Endpoint 广探测报告

生成时间：`{generated_at}`

金融场景：`{report['financeScenarioSlug']}`

AKShare 版本：`{report['akshareVersion']}`

## 1. 大白话结论

```text
本报告只说明 AKShare 端点能不能取到数据，不把样例数据写进事实库。
FRED 和 BaoStock 不在 N57b 重做；World Bank / UN Comtrade 当前冻结出 active 主路径。
AKShare 可以作为采集入口，但事实发布方必须逐 endpoint 记录。
ready_for_fact_bank 和 usable_with_cap 是 N57c 的候选输入；candidate_only / unavailable / blocked 不能进入 active fact bank。
```

汇总：

```text
总端点：{report['summary']['totalEndpoints']}
ready_for_fact_bank：{report['summary']['byDecisionForN57c'].get('ready_for_fact_bank', 0)}
usable_with_cap：{report['summary']['byDecisionForN57c'].get('usable_with_cap', 0)}
candidate_only：{report['summary']['byDecisionForN57c'].get('candidate_only', 0)}
unavailable：{report['summary']['byDecisionForN57c'].get('unavailable', 0)}
blocked：{report['summary']['byDecisionForN57c'].get('blocked', 0)}
```

## 2. N57c 可优先考虑

ready_for_fact_bank：

{chr(10).join(f"- `{item['endpointName']}`：{item['category']} / {item['sourcePublisher']}" for item in ready) or "- 无。"}

usable_with_cap：

{chr(10).join(f"- `{item['endpointName']}`：{item['category']} / {item['sourcePublisher']}" for item in usable) or "- 无。"}

candidate_only：

{chr(10).join(f"- `{item['endpointName']}`：{item['category']} / {item['sourcePublisher']}" for item in candidates[:30]) or "- 无。"}

unavailable / blocked：

{chr(10).join(f"- `{item['endpointName']}`：{item['decisionForN57c']} / {item.get('failureReason') or '无返回'}" for item in unavailable[:30]) or "- 无。"}

## 3. 分类别说明

{chr(10).join(category_sections)}

## 4. Endpoint 明细

| endpoint | 类别 | 发布方 | N57c 决策 | 行数 | 字段样例 | 支持证据键 |
|---|---|---|---|---:|---|---|
{rows}

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
data/materials/generated/finance/source-probes/{report['financeScenarioSlug']}/{REPORT_FILE_NAME}
```
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Probe AKShare endpoints for N57b.")
    parser.add_argument("--map", default="dust2-nonferrous")
    parser.add_argument("--timeout", type=int, default=18)
    parser.add_argument("--skip-reflection", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    map_slug = args.map
    probe_errors: list[dict[str, Any]] = []
    endpoints: list[dict[str, Any]] = []
    akshare_version = "unknown"
    reflected: list[dict[str, Any]] = []
    try:
        akshare_version, signatures = available_akshare_functions()
        catalog = endpoint_catalog()
        catalog_names = {item["functionName"] for item in catalog}
        for spec in catalog:
            try:
                endpoints.append(probe_endpoint(spec, signatures, args.timeout))
            except BaseException as exc:  # noqa: BLE001
                probe_errors.append({
                    "endpointName": spec.get("endpointName"),
                    "errorType": type(exc).__name__,
                    "message": sanitize_message(exc),
                    "traceTail": traceback.format_exc().splitlines()[-3:],
                })
        if not args.skip_reflection:
            reflected = reflected_candidates(signatures, catalog_names)
    except BaseException as exc:  # noqa: BLE001
        probe_errors.append({
            "endpointName": "__akshare_import_or_catalog__",
            "errorType": type(exc).__name__,
            "message": sanitize_message(exc),
            "traceTail": traceback.format_exc().splitlines()[-3:],
        })
        signatures = {}
    required_keys = collect_required_keys(map_slug)
    report = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": utc_now(),
        "financeScenarioSlug": map_slug,
        "hexMapSlug": "dust2",
        "akshareVersion": akshare_version,
        "accessProvider": ACCESS_PROVIDER,
        "collector": COLLECTOR_ID,
        "n56RequiredEvidenceKeys": required_keys,
        "decisionEnum": sorted(DECISIONS),
        "akshareEndpointProbes": endpoints,
        "reflectedCandidateEndpoints": reflected,
        "summary": build_summary(endpoints),
        "probeErrors": probe_errors,
        "secretsPolicy": {
            "storedApiKeyValues": False,
            "storedCookies": False,
            "storedTokens": False,
            "storedRawResponses": False,
        },
        "nonMutationPolicy": {
            "factBankLatestWritten": False,
            "roundEvidencePacksWritten": False,
            "runtimeTouched": False,
        },
    }
    output_path = generated_probe_root() / map_slug / REPORT_FILE_NAME
    markdown_path = docs_finance_root() / MARKDOWN_REPORT_FILE_NAME
    write_json(output_path, report)
    write_text(markdown_path, markdown_report(report))
    print(f"Wrote {output_path}")
    print(f"Wrote {markdown_path}")
    if probe_errors:
        print(f"Probe errors: {len(probe_errors)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
