from __future__ import annotations

import datetime as dt
import re
from typing import Any

from akshare_futures_collector import _run_akshare_endpoint
from common import confidence_for_tier, observation_fact, to_float, unavailable_fact
from company_fundamentals_normalizer import financial_table_claim_boundary, normalize_company_financial_facts


SHFE_TARGETS = {
    "CU": {"nameZh": "铜", "aliases": ["铜", "阴极铜", "沪铜"]},
    "AL": {"nameZh": "铝", "aliases": ["铝", "沪铝"]},
    "ZN": {"nameZh": "锌", "aliases": ["锌", "沪锌"]},
    "NI": {"nameZh": "镍", "aliases": ["镍", "沪镍"]},
    "SN": {"nameZh": "锡", "aliases": ["锡", "沪锡"]},
    "PB": {"nameZh": "铅", "aliases": ["铅", "沪铅"]},
    "AU": {"nameZh": "金", "aliases": ["黄金", "金", "沪金"]},
    "AG": {"nameZh": "银", "aliases": ["白银", "银", "沪银"]},
}
INE_TARGETS = {
    "BC": {"nameZh": "国际铜", "aliases": ["国际铜", "BC"]},
}
SPOT_TARGETS = {**SHFE_TARGETS, **INE_TARGETS}

AK_FUTURES_ALLOWED = [
    "commodity_trend",
    "commodity_price_momentum",
    "commodity_price_context",
    "china_supply_demand",
    "supply_demand_proxy",
    "inventory_pressure",
    "trade_price_consistency",
    "risk_reward",
    "risk_boundary",
    "executability",
    "limited_positive_stance",
    "limited_negative_stance",
]

AK_COMPANY_ALLOWED = [
    "commodity_to_company_earnings",
    "profit_sensitivity",
    "valuation_support",
    "valuation_proxy",
    "valuation_level",
    "commodity_to_equity_transmission",
    "a_share_relative_allocation",
    "limited_positive_stance",
    "limited_negative_stance",
]

AK_RISK_ALLOWED = [
    "risk_reward",
    "risk_boundary",
    "executability",
    "invalidating_condition",
    "position_sizing",
]

AK_MACRO_ALLOWED = [
    "macro_demand_proxy",
    "confidence_cap",
    "projection_limit",
    "limited_positive_stance",
    "limited_negative_stance",
]

AK_NOT_ALLOWED = [
    "company_earnings_confirmed",
    "full_industry_fundamentals_confirmed",
    "a_share_relative_allocation_confirmed",
    "trade_flow_confirmed",
]

CODE_FIELDS = [
    "symbol",
    "variety",
    "VARID",
    "合约",
    "INSTRUMENTID",
    "contract",
    "near_contract",
    "dominant_contract",
    "交易代码",
]
NAME_FIELDS = ["VARNAME", "品种", "品种名称", "商品名称", "bucket"]
DATE_FIELDS = ["date", "日期", "trade_date", "交易日", "月份", "发布时间", "信用交易日期"]
VALUE_FIELDS = [
    "close",
    "settle",
    "settle_price",
    "spot_price",
    "near_basis",
    "dom_basis",
    "dominant_contract_price",
    "WRTWGHTS",
    "WRTCHANGE",
    "指数",
    "同比增长",
    "资金净流入",
    "融资融券余额",
    "成交净买额",
]


def _recent_trade_dates(limit: int = 8) -> list[str]:
    today = dt.date.today()
    dates: list[str] = []
    offset = 0
    while len(dates) < limit and offset < 45:
        day = today - dt.timedelta(days=offset)
        if day.weekday() < 5:
            dates.append(day.strftime("%Y%m%d"))
        offset += 1
    return dates


def _with_known_fallback_dates(dates: list[str]) -> list[str]:
    return list(dict.fromkeys(dates + ["20260618", "20240430", "20240419", "20240122"]))


def _call_first_success(function_name: str, param_list: list[dict[str, Any]], *, timeout_seconds: int = 8) -> tuple[str, list[dict[str, Any]], str | None]:
    errors: list[str] = []
    for params in param_list:
        try:
            records = _run_akshare_endpoint(function_name, params, timeout_seconds=timeout_seconds)
            if records:
                label = ":".join([function_name, *[str(value) for value in params.values() if value not in (None, "")]])
                return label, records, None
            errors.append(f"{function_name}{params}: empty")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{function_name}{params}: {exc.__class__.__name__}: {exc}")
    return function_name, [], "; ".join(errors)[:1200]


def _call_first_success_with_target(
    function_name: str,
    param_list: list[dict[str, Any]],
    targets: dict[str, dict[str, Any]],
    *,
    timeout_seconds: int = 8,
) -> tuple[str, list[dict[str, Any]], str | None]:
    errors: list[str] = []
    for params in param_list:
        try:
            records = _run_akshare_endpoint(function_name, params, timeout_seconds=timeout_seconds)
            if not records:
                errors.append(f"{function_name}{params}: empty")
                continue
            matched_count = sum(len(_filter_records_for_symbol(records, symbol, targets[symbol])) for symbol in targets)
            if matched_count > 0:
                label = ":".join([function_name, *[str(value) for value in params.values() if value not in (None, "")]])
                return label, records, None
            errors.append(f"{function_name}{params}: {len(records)} rows but no target metal rows")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{function_name}{params}: {exc.__class__.__name__}: {exc}")
    return function_name, [], "; ".join(errors)[:1200]


def _pick(row: dict[str, Any], names: list[str]) -> Any:
    lower_map = {str(key).lower(): key for key in row}
    for name in names:
        if name in row and row[name] not in (None, ""):
            return row[name]
        key = lower_map.get(name.lower())
        if key and row.get(key) not in (None, ""):
            return row[key]
    return None


def _fields(records: list[dict[str, Any]]) -> list[str]:
    return sorted({str(key) for row in records[:20] for key in row})[:100]


def _normalize_code(value: Any) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())


def _field_values(row: dict[str, Any], field_names: list[str]) -> list[str]:
    values: list[str] = []
    lower_map = {str(key).lower(): key for key in row}
    for field_name in field_names:
        key = field_name if field_name in row else lower_map.get(field_name.lower())
        if key and row.get(key) not in (None, ""):
            values.append(str(row[key]))
    return values


def _row_matches_symbol(row: dict[str, Any], symbol: str, target: dict[str, Any]) -> bool:
    normalized_symbol = _normalize_code(symbol)
    for value in _field_values(row, CODE_FIELDS):
        code = _normalize_code(value)
        if code == normalized_symbol or code.startswith(normalized_symbol):
            return True
    for value in _field_values(row, NAME_FIELDS):
        clean = str(value).strip().replace(" ", "")
        for alias in target.get("aliases", []):
            alias_text = str(alias).strip().replace(" ", "")
            if not alias_text:
                continue
            if clean == alias_text or clean.startswith(alias_text):
                return True
    return False


def _filter_records_for_symbol(records: list[dict[str, Any]], symbol: str, target: dict[str, Any]) -> list[dict[str, Any]]:
    return [row for row in records if _row_matches_symbol(row, symbol, target)]


def _period_from_sample(sample: dict[str, Any], endpoint: str) -> str:
    picked = _pick(sample, DATE_FIELDS)
    if picked not in (None, ""):
        return str(picked)
    match = re.search(r"20\d{6}", endpoint)
    if match:
        return match.group(0)
    return dt.date.today().isoformat()


def _numeric(row: dict[str, Any], names: list[str]) -> float | None:
    return to_float(_pick(row, names))


def _best_sample(records: list[dict[str, Any]]) -> dict[str, Any]:
    if not records:
        return {}
    priority_fields = ["open_interest", "持仓量", "volume", "成交量", "WRTWGHTS", "spot_price", "close", "settle_price"]
    return max(records, key=lambda row: max([_numeric(row, [field]) or 0 for field in priority_fields]))


def _fact_value(records: list[dict[str, Any]]) -> tuple[Any, str, str]:
    warehouse_values = [_numeric(row, ["WRTWGHTS"]) for row in records]
    warehouse_values = [value for value in warehouse_values if value is not None]
    if warehouse_values:
        return round(sum(warehouse_values), 4), "reported_warehouse_weight", "sum(WRTWGHTS) over matched target rows"
    sample = _best_sample(records)
    value = _pick(sample, VALUE_FIELDS)
    return value if value not in (None, "") else len(records), "reported_public_field", "sample matched target row field"


def _source_unavailable(
    *,
    fact_id: str,
    source: str,
    source_publisher: str,
    metric_name: str,
    entity: str,
    endpoint: str,
    reason: str,
    allowed_claim_types: list[str],
    required_keys: list[str],
) -> dict[str, Any]:
    return unavailable_fact(
        fact_id=fact_id,
        statement_zh=f"AKShare 访问 {source_publisher} / {endpoint} 未形成 {entity} 可用事实：{reason}。",
        metric_name=metric_name,
        source=source,
        source_type="public_data_via_named_collector",
        source_publisher=source_publisher,
        access_provider="AKShare",
        collector="akshare_python_package_v0",
        endpoint=endpoint,
        domain="finance_public_endpoint",
        entity=entity,
        locator=f"{endpoint}:{entity}",
        original_location=f"akshare:{endpoint}:{entity}",
        policy_notes=[
            "AKShare 是访问入口，不是事实发布方。",
            "端点失败或目标品种未匹配时只能记录缺口，不能补写事实。",
        ],
        unavailable_reason=reason,
        source_warning="AKShare endpoint failed, returned no usable records, or returned no target metal rows; do not treat it as observed evidence.",
        reliability_tier="public_data_via_named_collector",
        allowed_claim_types=allowed_claim_types,
        not_allowed_claim_types=AK_NOT_ALLOWED,
        interpretation_hint="端点或目标品种不可用时，相关证据键必须按缺口或降权处理。",
        score_cap_policy="missing AKShare active endpoint facts cap related N56 claims.",
        required_evidence_keys=required_keys,
    )


def _records_fact(
    *,
    fact_id: str,
    source: str,
    source_publisher: str,
    metric_name: str,
    endpoint: str,
    records: list[dict[str, Any]],
    entity: str,
    entity_name_zh: str,
    confidence: float,
    allowed_claim_types: list[str],
    required_keys: list[str],
    statement_prefix: str,
    score_cap_policy: str,
    frequency: str,
    reliability_tier: str = "public_data_via_named_collector",
) -> dict[str, Any]:
    sample = _best_sample(records)
    period = _period_from_sample(sample, endpoint)
    value, unit, value_transform = _fact_value(records)
    field_list = _fields(records)
    symbol_value = _pick(sample, [*CODE_FIELDS, *NAME_FIELDS])
    return observation_fact(
        fact_id=fact_id,
        statement_zh=(
            f"{statement_prefix}：{entity_name_zh}（{entity}）。通过 AKShare 访问 {source_publisher} / {endpoint}，"
            f"目标品种匹配 {len(records)} 行，样本期为 {period}，样本合约或品种为 {symbol_value}，"
            f"字段包括 {', '.join(field_list[:12])}。"
            "该事实只能按字段口径作为公开代理证据，不能单独证明完整行业基本面或公司盈利。"
        ),
        metric_name=metric_name,
        value=value,
        unit=unit,
        period=period,
        source=source,
        source_type=reliability_tier,
        source_publisher=source_publisher,
        access_provider="AKShare",
        collector="akshare_python_package_v0",
        endpoint=endpoint,
        confidence=confidence,
        domain="finance_public_endpoint",
        entity=entity,
        locator=f"{endpoint}:{entity}",
        original_location=f"akshare:{endpoint}:{entity}:{period}",
        policy_notes=[
            "AKShare 是访问入口，事实发布方和 endpoint 必须保留。",
            "公开端点字段只能支持相应代理 claim，不能过度外推。",
            "本事实已按目标金属过滤，未匹配目标金属的返回行不计入事实。",
        ],
        observed_at=period,
        transform=f"filter endpoint rows to target metal {entity}; {value_transform}",
        reliability_tier=reliability_tier,
        allowed_claim_types=allowed_claim_types,
        not_allowed_claim_types=AK_NOT_ALLOWED,
        interpretation_hint="可用于 N56 requiredEvidenceSchema 的对应代理证据；强结论需要其他证据配合。",
        score_cap_policy=score_cap_policy,
        frequency=frequency,
        required_evidence_keys=required_keys,
        extra={
            "targetSymbol": entity,
            "targetNameZh": entity_name_zh,
            "matchedRecordCount": len(records),
            "returnedFields": field_list,
            "sampleRecord": {str(key): str(value)[:120] for key, value in sample.items()},
        },
    )


def _append_target_facts(
    *,
    facts: list[dict[str, Any]],
    warnings: list[str],
    fact_prefix: str,
    source: str,
    source_publisher: str,
    function_name: str,
    params: list[dict[str, Any]],
    metric_name: str,
    targets: dict[str, dict[str, Any]],
    allowed: list[str],
    keys: list[str],
    prefix: str,
    cap: str,
    frequency: str,
    confidence: float,
    timeout_seconds: int = 8,
) -> None:
    endpoint, records, error = _call_first_success_with_target(function_name, params, targets, timeout_seconds=timeout_seconds)
    if error and not records:
        warnings.append(error)
    for symbol, target in targets.items():
        matched = _filter_records_for_symbol(records, symbol, target) if records else []
        fact_id = f"{fact_prefix}-{symbol}"
        if matched:
            facts.append(
                _records_fact(
                    fact_id=fact_id,
                    source=source,
                    source_publisher=source_publisher,
                    metric_name=metric_name,
                    endpoint=endpoint,
                    records=matched,
                    entity=symbol,
                    entity_name_zh=target["nameZh"],
                    confidence=confidence,
                    allowed_claim_types=allowed,
                    required_keys=keys,
                    statement_prefix=prefix,
                    score_cap_policy=cap,
                    frequency=frequency,
                )
            )
        else:
            reason = error or f"endpoint returned {len(records)} rows but no {symbol} target rows"
            facts.append(
                _source_unavailable(
                    fact_id=fact_id,
                    source=source,
                    source_publisher=source_publisher,
                    metric_name=metric_name,
                    entity=symbol,
                    endpoint=endpoint,
                    reason=reason,
                    allowed_claim_types=allowed,
                    required_keys=keys,
                )
            )



def _clean_records(value: Any) -> list[dict[str, Any]]:
    if hasattr(value, "to_dict"):
        rows = value.to_dict(orient="records")
    elif isinstance(value, list):
        rows = value
    elif isinstance(value, dict):
        rows = [value]
    else:
        return []
    clean_rows: list[dict[str, Any]] = []
    for row in rows:
        clean_row: dict[str, Any] = {}
        for key, item in dict(row).items():
            if item != item:  # NaN check
                clean_row[str(key)] = None
            else:
                clean_row[str(key)] = item
        clean_rows.append(clean_row)
    return clean_rows


def _call_stock_financial_abstract_direct(symbol: str) -> tuple[str, list[dict[str, Any]], str | None]:
    try:
        import akshare as ak  # type: ignore

        value = ak.stock_financial_abstract(symbol=symbol)
        records = _clean_records(value)
        if records:
            return f"stock_financial_abstract:{symbol}", records, None
        return f"stock_financial_abstract:{symbol}", [], "empty"
    except Exception as exc:  # noqa: BLE001
        return f"stock_financial_abstract:{symbol}", [], f"{exc.__class__.__name__}: {exc}"

def _company_symbol(code: str) -> str:
    return code.split(".")[-1]


def collect_akshare_active_facts(configs: dict[str, Any]) -> dict[str, Any]:
    confidence = confidence_for_tier(configs["policy"], "market_data_proxy")
    facts: list[dict[str, Any]] = []
    warnings: list[str] = []
    dates = _with_known_fallback_dates(["20260618", *_recent_trade_dates(3)])

    _append_target_facts(
        facts=facts,
        warnings=warnings,
        fact_prefix="AKF-SHFE-DAILY",
        source="SHFE",
        source_publisher="SHFE",
        function_name="get_shfe_daily",
        params=[{"date": date} for date in dates],
        metric_name="shfe_daily_futures_price_volume_proxy",
        targets=SHFE_TARGETS,
        allowed=AK_FUTURES_ALLOWED,
        keys=["china_supply_demand_proxy", "commodity_price_context", "commodity_price_momentum"],
        prefix="SHFE 期货日行情代理事实",
        cap="SHFE daily data can support domestic futures context but cannot alone prove full A-share allocation.",
        frequency="daily",
        confidence=confidence,
    )

    _append_target_facts(
        facts=facts,
        warnings=warnings,
        fact_prefix="AKF-SHFE-SETTLE",
        source="SHFE",
        source_publisher="SHFE",
        function_name="futures_settle_shfe",
        params=[{"date": date} for date in dates],
        metric_name="shfe_settlement_margin_fee_proxy",
        targets=SHFE_TARGETS,
        allowed=AK_FUTURES_ALLOWED,
        keys=["commodity_price_context", "risk_reward_boundary"],
        prefix="SHFE 期货结算、保证金和手续费代理事实",
        cap="SHFE settlement and margin facts support risk-reward boundaries with score caps.",
        frequency="daily",
        confidence=confidence,
    )

    _append_target_facts(
        facts=facts,
        warnings=warnings,
        fact_prefix="AKF-SHFE-WAREHOUSE",
        source="SHFE",
        source_publisher="SHFE",
        function_name="futures_shfe_warehouse_receipt",
        params=[{"date": date} for date in ["20260618", "20260617", "20240419", "20240122"]],
        metric_name="shfe_warehouse_receipt_proxy",
        targets=SHFE_TARGETS,
        allowed=AK_FUTURES_ALLOWED,
        keys=["china_supply_demand_proxy", "domestic_inventory_or_spot_proxy"],
        prefix="SHFE 仓单或库存代理事实",
        cap="SHFE warehouse receipt facts support inventory proxy claims but cannot alone prove demand quality or company earnings.",
        frequency="daily",
        confidence=confidence,
    )

    _append_target_facts(
        facts=facts,
        warnings=warnings,
        fact_prefix="AKF-INE-DAILY",
        source="INE",
        source_publisher="INE",
        function_name="get_ine_daily",
        params=[{"date": date} for date in dates],
        metric_name="ine_daily_international_copper_proxy",
        targets=INE_TARGETS,
        allowed=AK_FUTURES_ALLOWED,
        keys=["commodity_price_context", "commodity_price_momentum"],
        prefix="INE 国际铜日行情代理事实",
        cap="INE facts support copper futures context with score caps for broad allocation claims.",
        frequency="daily",
        confidence=confidence,
    )

    _append_target_facts(
        facts=facts,
        warnings=warnings,
        fact_prefix="AKF-INE-SETTLE",
        source="INE",
        source_publisher="INE",
        function_name="futures_settle_ine",
        params=[{"date": date} for date in dates],
        metric_name="ine_settlement_margin_fee_proxy",
        targets=INE_TARGETS,
        allowed=AK_FUTURES_ALLOWED,
        keys=["commodity_price_context", "risk_reward_boundary"],
        prefix="INE 国际铜结算、保证金和手续费代理事实",
        cap="INE settlement facts support risk-reward boundaries but cannot prove company earnings.",
        frequency="daily",
        confidence=confidence,
    )

    _append_target_facts(
        facts=facts,
        warnings=warnings,
        fact_prefix="AKF-SPOT-BASIS",
        source="CHINA_FUTURES_SPOT",
        source_publisher="Chinese futures market public feeds",
        function_name="futures_spot_price",
        params=[{"date": date, "vars_list": list(SPOT_TARGETS)} for date in ["20240430", "20260618", *_recent_trade_dates(2)]],
        metric_name="domestic_futures_spot_basis_proxy",
        targets=SPOT_TARGETS,
        allowed=AK_FUTURES_ALLOWED,
        keys=["commodity_price_context", "domestic_inventory_or_spot_proxy"],
        prefix="国内期货现货或基差公开入口代理事实",
        cap="spot and basis facts are usable with cap; they cannot alone prove full supply-demand tightness.",
        frequency="daily",
        confidence=confidence,
    )

    company_universe = configs["baostockUniverse"].get("coreUniverse", []) + configs["baostockUniverse"].get("extendedUniverse", [])
    table_claim_boundary = financial_table_claim_boundary()
    for offset, company in enumerate(company_universe, start=1):
        endpoint, records, error = _call_stock_financial_abstract_direct(_company_symbol(company["code"]))
        table_fact_id = f"AKC-TABLE-{offset:03d}"
        if records:
            normalized_facts, summary = normalize_company_financial_facts(
                company_index=offset,
                company=company,
                records=records,
                endpoint=endpoint,
                confidence=confidence,
            )
            facts.extend(normalized_facts)
            facts.append(
                _records_fact(
                    fact_id=table_fact_id,
                    source="SINA_FINANCE",
                    source_publisher="Sina Finance",
                    metric_name="company_financial_abstract_table_summary",
                    endpoint=endpoint,
                    records=records,
                    entity=company["code"],
                    entity_name_zh=company["name"],
                    confidence=confidence,
                    allowed_claim_types=table_claim_boundary["allowedClaimTypes"],
                    required_keys=table_claim_boundary["requiredEvidenceKeys"],
                    statement_prefix=f"{company['name']}?{company['code']}?????????????",
                    score_cap_policy="Table-level financial abstract summaries are technical trace only; use standardized metric facts for evidence.",
                    frequency="quarterly_or_annual_reported_fields",
                )
            )
            if summary.get("missingMetrics"):
                warnings.append(f"stock_financial_abstract {company['code']} missing standardized metrics: {', '.join(summary['missingMetrics'])}")
        else:
            warnings.append(error or f"stock_financial_abstract {company['code']} returned no records")
            facts.append(
                _source_unavailable(
                    fact_id=f"AKC-MISSING-{offset:03d}",
                    source="SINA_FINANCE",
                    source_publisher="Sina Finance",
                    metric_name="company_financial_metric_standardization_missing",
                    entity=company["code"],
                    endpoint="stock_financial_abstract",
                    reason=error or "no_records_returned",
                    allowed_claim_types=AK_COMPANY_ALLOWED,
                    required_keys=["earnings_transmission_proxy", "valuation_level", "valuation_proxy"],
                )
            )

    risk_and_macro_specs = [
        ("AKR001", "EASTMONEY", "Eastmoney", "stock_hsgt_fund_flow_summary_em", [{}], "northbound_fund_flow_proxy", "northbound_market_risk_proxy", "北向资金", AK_RISK_ALLOWED, ["risk_reward_boundary"], "北向资金公开汇总代理事实", "fund flow facts are usable with cap for risk appetite only.", "daily"),
        ("AKR002", "SSE", "SSE", "stock_margin_sse", [{"start_date": (dt.date.today() - dt.timedelta(days=120)).strftime("%Y%m%d"), "end_date": dt.date.today().strftime("%Y%m%d")}], "sse_margin_financing_proxy", "margin_trading_risk_proxy", "融资融券", AK_RISK_ALLOWED, ["risk_reward_boundary"], "上交所融资融券公开数据代理事实", "SSE margin facts are usable with cap for leverage and risk boundaries only.", "daily"),
        ("AKM001", "CHINA_MACRO_PUBLIC", "China public macro feed", "macro_china_pmi", [{}], "china_pmi_public_proxy", "macro_demand_proxy", "PMI", AK_MACRO_ALLOWED, ["macro_demand_proxy"], "中国 PMI 公开宏观代理事实", "PMI facts are lagged macro proxies and cannot prove short-cycle supply-demand alone.", "monthly"),
        ("AKM002", "CHINA_MACRO_PUBLIC", "China public macro feed", "macro_china_gyzjz", [{}], "china_industrial_value_added_proxy", "macro_demand_proxy", "工业增加值", AK_MACRO_ALLOWED, ["macro_demand_proxy"], "中国工业增加值公开宏观代理事实", "industrial value-added facts are macro background proxies with score caps.", "monthly"),
    ]
    for fact_id, source, publisher, function_name, params, metric_name, entity, entity_name_zh, allowed, keys, prefix, cap, frequency in risk_and_macro_specs:
        endpoint, records, error = _call_first_success(function_name, params, timeout_seconds=6)
        if records:
            facts.append(
                _records_fact(
                    fact_id=fact_id,
                    source=source,
                    source_publisher=publisher,
                    metric_name=metric_name,
                    endpoint=endpoint,
                    records=records,
                    entity=entity,
                    entity_name_zh=entity_name_zh,
                    confidence=confidence,
                    allowed_claim_types=allowed,
                    required_keys=keys,
                    statement_prefix=prefix,
                    score_cap_policy=cap,
                    frequency=frequency,
                )
            )
        else:
            warnings.append(error or f"{function_name} returned no records")
            facts.append(
                _source_unavailable(
                    fact_id=fact_id,
                    source=source,
                    source_publisher=publisher,
                    metric_name=metric_name,
                    entity=entity,
                    endpoint=function_name,
                    reason=error or "no_records_returned",
                    allowed_claim_types=allowed,
                    required_keys=keys,
                )
            )

    return {
        "sourceId": "akshare_active",
        "collector": "akshare_python_package_v0",
        "dataMode": "offline_observation_fact" if any(fact["dataMode"] == "offline_observation_fact" for fact in facts) else "unavailable_observation",
        "facts": facts,
        "warnings": warnings,
        "candidateOnly": [
            {"sourceId": "GFEX", "reason": "N57b classified GFEX as candidate_only for Dust2 nonferrous v1."},
            {"sourceId": "SHMET_NEWS", "reason": "News endpoints require manual review and do not enter active fact bank."},
        ],
    }
