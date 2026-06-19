from __future__ import annotations

import datetime as dt
import json
import os
import subprocess
import sys
from typing import Any

from common import confidence_for_tier, observation_fact, unavailable_fact


FUTURES_ALLOWED_CLAIMS = [
    "china_supply_demand",
    "inventory_pressure",
    "commodity_price_momentum",
    "commodity_price_context",
    "risk_reward",
    "limited_positive_stance",
    "limited_negative_stance",
]

FUTURES_NOT_ALLOWED_CLAIMS = [
    "company_earnings_confirmed",
    "a_share_relative_allocation_confirmed",
    "full_industry_fundamentals_confirmed",
]


SHFE_SYMBOLS = ["CU", "AL", "ZN", "NI", "SN", "PB", "AU", "AG"]
INE_SYMBOLS = ["BC"]


def _recent_trade_dates(limit: int = 8) -> list[str]:
    today = dt.date.today()
    dates: list[str] = []
    offset = 0
    while len(dates) < limit and offset < 30:
        day = today - dt.timedelta(days=offset)
        if day.weekday() < 5:
            dates.append(day.strftime("%Y%m%d"))
        offset += 1
    return dates


def _to_records(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if hasattr(value, "to_dict"):
        return value.to_dict("records")
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, dict):
        records: list[dict[str, Any]] = []
        for key, item in value.items():
            if hasattr(item, "to_dict"):
                for row in item.to_dict("records"):
                    row["bucket"] = key
                    records.append(row)
            elif isinstance(item, list):
                for row in item:
                    if isinstance(row, dict):
                        row["bucket"] = key
                        records.append(row)
        return records
    return []


def _pick(row: dict[str, Any], names: list[str]) -> Any:
    lower_map = {str(key).lower(): key for key in row}
    for name in names:
        if name in row and row[name] not in (None, ""):
            return row[name]
        key = lower_map.get(name.lower())
        if key and row.get(key) not in (None, ""):
            return row[key]
    return None


def _matching_records(records: list[dict[str, Any]], symbols: list[str]) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    for row in records:
        text = " ".join(str(value).upper() for value in row.values() if value is not None)
        if any(symbol in text for symbol in symbols):
            matches.append(row)
    return matches[:20]


def _unavailable(
    *,
    fact_id: str,
    source_id: str,
    source_publisher: str,
    metric_name: str,
    statement: str,
    entity: str,
    endpoint: str,
    reason: str,
) -> dict[str, Any]:
    return unavailable_fact(
        fact_id=fact_id,
        statement_zh=statement,
        metric_name=metric_name,
        source=source_id,
        source_type="exchange_data_via_named_collector",
        source_publisher=source_publisher,
        access_provider="AKShare",
        collector="akshare_python_package_v0",
        endpoint=endpoint,
        domain="futures",
        entity=entity,
        locator=endpoint,
        original_location=f"akshare:{endpoint}:{entity}",
        policy_notes=[
            "AKShare 是访问入口；事实发布方和端点字段必须保留。",
            "交易所或市场行情代理不能单独证明公司盈利或全行业基本面。",
        ],
        unavailable_reason=reason,
        source_warning="AKShare futures endpoint failed or returned no usable records; do not treat this as observed exchange evidence.",
        reliability_tier="exchange_data_via_named_collector",
        allowed_claim_types=FUTURES_ALLOWED_CLAIMS,
        not_allowed_claim_types=FUTURES_NOT_ALLOWED_CLAIMS,
        interpretation_hint="交易所期货或仓单数据缺失时，国内供需、库存或价格代理必须降权。",
        score_cap_policy="missing SHFE/INE facts cap China supply-demand and domestic price context claims.",
    )


def _call_first_success(callables: list[tuple[str, Any]]) -> tuple[str, list[dict[str, Any]], str | None]:
    errors: list[str] = []
    for endpoint, callback in callables:
        try:
            records = _to_records(callback())
            if records:
                return endpoint, records, None
            errors.append(f"{endpoint}: empty")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{endpoint}: {exc.__class__.__name__}: {exc}")
    return callables[0][0] if callables else "unknown", [], "; ".join(errors)[:1000]


def _run_akshare_endpoint(function_name: str, kwargs: dict[str, Any], *, timeout_seconds: int = 8) -> list[dict[str, Any]]:
    child_code = r"""
import json
import sys
kwargs = json.loads(sys.argv[2])
import akshare as ak
value = getattr(ak, sys.argv[1])(**kwargs)
if hasattr(value, "head"):
    value = value.head(80)
if hasattr(value, "to_dict"):
    records = value.to_dict("records")
elif isinstance(value, list):
    records = [item for item in value if isinstance(item, dict)][:80]
elif isinstance(value, dict):
    records = []
    for key, item in value.items():
        if hasattr(item, "head"):
            item = item.head(80)
        if hasattr(item, "to_dict"):
            for row in item.to_dict("records"):
                row["bucket"] = key
                records.append(row)
        elif isinstance(item, list):
            for row in item:
                if isinstance(row, dict):
                    row["bucket"] = key
                    records.append(row)
else:
    records = []
clean = []
for row in records[:80]:
    clean.append({str(key): None if value is None else str(value) for key, value in row.items()})
print(json.dumps(clean, ensure_ascii=False))
"""
    child_env = dict(os.environ)
    child_env["PYTHONIOENCODING"] = "utf-8"
    completed = subprocess.run(
        [sys.executable, "-c", child_code, function_name, json.dumps(kwargs, ensure_ascii=False)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=child_env,
        timeout=timeout_seconds,
    )
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or completed.stdout or f"{function_name} failed")[:500])
    text = (completed.stdout or "").strip().splitlines()
    if not text:
        return []
    return json.loads(text[-1])


def _build_exchange_fact(
    *,
    fact_id: str,
    source_id: str,
    source_publisher: str,
    metric_name: str,
    endpoint: str,
    records: list[dict[str, Any]],
    symbols: list[str],
    confidence: float,
    statement_prefix: str,
) -> dict[str, Any]:
    matched = _matching_records(records, symbols)
    sample = matched[0] if matched else records[0]
    symbol_value = _pick(sample, ["symbol", "合约", "品种", "variety", "INSTRUMENTID", "contract"])
    price_value = _pick(sample, ["close", "收盘价", "settlement", "结算价", "price", "最新价"])
    volume_value = _pick(sample, ["volume", "成交量", "成交", "turnover", "持仓量", "open_interest"])
    date_value = _pick(sample, ["date", "日期", "trade_date", "交易日"]) or dt.date.today().isoformat()
    fields = sorted({str(key) for row in records[:10] for key in row.keys()})
    return observation_fact(
        fact_id=fact_id,
        statement_zh=(
            f"{statement_prefix} 通过 AKShare 访问 {source_publisher} / {endpoint}，返回 {len(records)} 行，"
            f"目标品种匹配 {len(matched)} 行；样本合约或品种为 {symbol_value}，价格字段样本为 {price_value}，"
            f"成交或持仓字段样本为 {volume_value}。该事实可作为国内期货价格、交易或仓单/库存代理，不能证明公司盈利。"
        ),
        metric_name=metric_name,
        value=price_value if price_value not in (None, "") else len(records),
        unit="reported_exchange_field",
        period=str(date_value),
        source=source_id,
        source_type="exchange_data_via_named_collector",
        source_publisher=source_publisher,
        access_provider="AKShare",
        collector="akshare_python_package_v0",
        endpoint=endpoint,
        confidence=confidence,
        domain="futures",
        entity="/".join(symbols),
        locator=endpoint,
        original_location=f"akshare:{endpoint}:{date_value}",
        policy_notes=[
            "AKShare 是访问入口；事实发布方和端点字段必须保留。",
            "交易所或市场行情代理不能单独证明公司盈利或全行业基本面。",
        ],
        observed_at=str(date_value),
        transform="endpoint rows summarized into exchange proxy fact with matched target symbols and sample fields",
        reliability_tier="exchange_data_via_named_collector",
        allowed_claim_types=FUTURES_ALLOWED_CLAIMS,
        not_allowed_claim_types=FUTURES_NOT_ALLOWED_CLAIMS,
        interpretation_hint="可支持国内期货价格、交易、库存或仓单代理；需要与商品、权益和风险证据配合。",
        score_cap_policy="exchange proxy facts support domestic context but cannot alone justify A-share allocation.",
        extra={
            "testedSymbols": symbols,
            "matchedRecordCount": len(matched),
            "returnedRecordCount": len(records),
            "returnedFields": fields[:80],
            "sampleRecord": {str(key): str(value)[:120] for key, value in sample.items()},
        },
    )


def collect_akshare_futures_facts(configs: dict[str, Any]) -> dict[str, Any]:
    facts: list[dict[str, Any]] = []
    warnings: list[str] = []
    confidence = confidence_for_tier(configs["policy"], "market_data_proxy")
    dates = _recent_trade_dates()

    shfe_calls: list[tuple[str, Any]] = []
    for date in dates[:1]:
        shfe_calls.extend(
            [
                (f"get_shfe_daily:{date}", lambda date=date: _run_akshare_endpoint("get_shfe_daily", {"date": date})),
                (f"futures_settle_shfe:{date}", lambda date=date: _run_akshare_endpoint("futures_settle_shfe", {"date": date})),
            ]
        )
    shfe_calls.append(("get_receipt", lambda: _run_akshare_endpoint("get_receipt", {"start_date": dates[-1], "end_date": dates[0], "vars_list": SHFE_SYMBOLS})))
    shfe_endpoint, shfe_records, shfe_error = _call_first_success(shfe_calls)
    if shfe_records:
        facts.append(
            _build_exchange_fact(
                fact_id="SHFE001",
                source_id="SHFE",
                source_publisher="SHFE",
                metric_name="domestic_futures_exchange_proxy",
                endpoint=shfe_endpoint,
                records=shfe_records,
                symbols=SHFE_SYMBOLS,
                confidence=confidence,
                statement_prefix="SHFE 铜、铝、锌、镍、锡、铅、金、银期货或仓单代理事实",
            )
        )
    else:
        warnings.append(shfe_error or "SHFE endpoints returned no usable records.")
        facts.append(
            _unavailable(
                fact_id="SHFE001",
                source_id="SHFE",
                source_publisher="SHFE",
                metric_name="domestic_futures_exchange_proxy",
                statement="AKShare 未能采集 SHFE 可用期货、结算、库存或仓单观测。",
                entity="/".join(SHFE_SYMBOLS),
                endpoint=shfe_endpoint,
                reason=shfe_error or "no_records_returned",
            )
        )

    ine_calls: list[tuple[str, Any]] = []
    for date in dates[:1]:
        ine_calls.append((f"futures_settle_ine:{date}", lambda date=date: _run_akshare_endpoint("futures_settle_ine", {"date": date})))
    ine_calls.append(("futures_zh_daily_sina:BC0", lambda: _run_akshare_endpoint("futures_zh_daily_sina", {"symbol": "BC0"})))
    ine_endpoint, ine_records, ine_error = _call_first_success(ine_calls)
    if ine_records:
        facts.append(
            _build_exchange_fact(
                fact_id="INE001",
                source_id="INE",
                source_publisher="INE",
                metric_name="international_copper_futures_proxy",
                endpoint=ine_endpoint,
                records=ine_records,
                symbols=INE_SYMBOLS,
                confidence=confidence,
                statement_prefix="INE 国际铜期货代理事实",
            )
        )
    else:
        warnings.append(ine_error or "INE endpoints returned no usable records.")
        facts.append(
            _unavailable(
                fact_id="INE001",
                source_id="INE",
                source_publisher="INE",
                metric_name="international_copper_futures_proxy",
                statement="AKShare 未能采集 INE 国际铜可用期货观测。",
                entity="/".join(INE_SYMBOLS),
                endpoint=ine_endpoint,
                reason=ine_error or "no_records_returned",
            )
        )

    return {
        "sourceId": "akshare_futures",
        "collector": "akshare_python_package_v0",
        "dataMode": "offline_observation_fact" if any(f["dataMode"] == "offline_observation_fact" for f in facts) else "unavailable_observation",
        "facts": facts,
        "warnings": warnings,
        "candidateOnly": {
            "sourceId": "GFEX",
            "reason": "GFEX LC/SI 与 Dust2 有色铜铝锌镍主线不是完全同一资产，N57 只保留 candidate status。",
            "accessProvider": "AKShare",
        },
    }
