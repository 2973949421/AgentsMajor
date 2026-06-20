from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import traceback
from pathlib import Path
from typing import Any, Callable


SCHEMA_VERSION = 1
REPORT_FILE_NAME = "source-probe-report.json"
VALID_DECISIONS = {
    "ready_for_n57",
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


def load_local_env() -> dict[str, str]:
    env = dict(os.environ)
    env_path = repo_root() / ".env.local"
    if not env_path.exists():
        return env
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in env:
            env[key] = value
    return env


def sanitize_error(exc: BaseException) -> dict[str, str]:
    message = str(exc).replace("\n", " ").strip()
    message = re.sub(r"(?i)(api[_-]?key=)[^&\s)]+", r"\1<redacted>", message)
    message = re.sub(r"(?i)(subscription[_-]?key=)[^&\s)]+", r"\1<redacted>", message)
    message = re.sub(r"(?i)(Ocp-Apim-Subscription-Key['\"]?\s*[:=]\s*)[^,\s}]+", r"\1<redacted>", message)
    if len(message) > 500:
        message = f"{message[:500]}..."
    return {
        "errorType": type(exc).__name__,
        "message": message,
    }


def safe_fields(frame_or_rows: Any) -> list[str]:
    if frame_or_rows is None:
        return []
    columns = getattr(frame_or_rows, "columns", None)
    if columns is not None:
        return [str(column) for column in list(columns)[:80]]
    if isinstance(frame_or_rows, list) and frame_or_rows:
        first = frame_or_rows[0]
        if isinstance(first, dict):
            return [str(key) for key in list(first.keys())[:80]]
    if isinstance(frame_or_rows, dict):
        return [str(key) for key in list(frame_or_rows.keys())[:80]]
    return []


def safe_row_count(value: Any) -> int:
    if value is None:
        return 0
    shape = getattr(value, "shape", None)
    if shape is not None and len(shape) >= 1:
        return int(shape[0])
    if isinstance(value, dict):
        total = 0
        for item in value.values():
            total += safe_row_count(item)
        return total if total else len(value)
    if isinstance(value, list):
        return len(value)
    return 1


def detect_sample_period(value: Any) -> str | None:
    fields = safe_fields(value)
    candidate_names = ["date", "日期", "trade_date", "交易日", "year", "period", "TIME_PERIOD"]
    if getattr(value, "empty", True) is False:
        for field in candidate_names:
            if field in value.columns:
                try:
                    series = value[field].dropna().astype(str)
                    if not series.empty:
                        return f"{series.iloc[0]}..{series.iloc[-1]}"
                except Exception:
                    return None
    if isinstance(value, list) and value:
        for field in candidate_names:
            values = [str(row.get(field)) for row in value if isinstance(row, dict) and row.get(field)]
            if values:
                return f"{values[0]}..{values[-1]}"
    if fields:
        return None
    return None


def source_probe(
    *,
    source_id: str,
    display_name: str,
    collector_id: str,
    source_role: str,
    requires_api_key: bool,
    api_key_present: bool | None,
    source_type: str,
    reliability_tier: str,
    tested_endpoints: list[dict[str, Any]],
    tested_symbols: list[str],
    supports_required_evidence_keys: list[str],
    allowed_claim_types: list[str],
    not_allowed_claim_types: list[str],
    decision_for_n57: str,
    probe_status: str,
    returned_rows: int = 0,
    returned_fields: list[str] | None = None,
    sample_period: str | None = None,
    failure_reason: str | None = None,
    notes: list[str] | None = None,
) -> dict[str, Any]:
    if decision_for_n57 not in VALID_DECISIONS:
        raise ValueError(f"Invalid decisionForN57: {decision_for_n57}")
    return {
        "sourceId": source_id,
        "displayName": display_name,
        "collectorId": collector_id,
        "sourceRole": source_role,
        "requiresApiKey": requires_api_key,
        "apiKeyPresent": api_key_present,
        "sourceType": source_type,
        "probeStatus": probe_status,
        "testedEndpoints": tested_endpoints,
        "testedSymbols": sorted(set(tested_symbols)),
        "returnedRows": returned_rows,
        "returnedFields": returned_fields or [],
        "samplePeriod": sample_period,
        "supportsRequiredEvidenceKeys": sorted(set(supports_required_evidence_keys)),
        "allowedClaimTypes": sorted(set(allowed_claim_types)),
        "notAllowedClaimTypes": sorted(set(not_allowed_claim_types)),
        "reliabilityTier": reliability_tier,
        "decisionForN57": decision_for_n57,
        "failureReason": failure_reason,
        "notes": notes or [],
    }


def collect_required_keys(map_slug: str) -> list[str]:
    topics = read_json(processed_finance_root() / "maps" / map_slug / "round-topics.json")
    keys: set[str] = set()
    for round_item in topics.get("rounds", []):
        for evidence_item in round_item.get("requiredEvidenceSchema", []):
            key = evidence_item.get("requiredKey")
            if key:
                keys.add(str(key))
    return sorted(keys)


def run_endpoint(label: str, call: Callable[[], Any]) -> dict[str, Any]:
    try:
        value = call()
        rows = safe_row_count(value)
        fields = safe_fields(value)
        return {
            "label": label,
            "status": "success" if rows > 0 else "empty",
            "returnedRows": rows,
            "returnedFields": fields,
            "samplePeriod": detect_sample_period(value),
        }
    except BaseException as exc:
        return {
            "label": label,
            "status": "error",
            "failureReason": sanitize_error(exc),
        }


def endpoint_summary(endpoints: list[dict[str, Any]]) -> tuple[str, int, list[str], str | None, str | None]:
    returned_rows = sum(int(item.get("returnedRows", 0)) for item in endpoints if item.get("status") == "success")
    fields: list[str] = []
    periods: list[str] = []
    failures: list[str] = []
    for item in endpoints:
        fields.extend(str(field) for field in item.get("returnedFields", []))
        if item.get("samplePeriod"):
            periods.append(str(item["samplePeriod"]))
        if item.get("status") == "error":
            failure = item.get("failureReason") or {}
            failures.append(f"{item.get('label')}: {failure.get('errorType')} {failure.get('message')}")
    status = "partial" if returned_rows > 0 and failures else ("success" if returned_rows > 0 else ("error" if failures else "empty"))
    failure_reason = "; ".join(failures)[:1200] if failures and returned_rows == 0 else None
    sample_period = "; ".join(periods[:3]) if periods else None
    return status, returned_rows, sorted(set(fields)), sample_period, failure_reason


def probe_fred(env: dict[str, str], map_slug: str) -> dict[str, Any]:
    config = read_json(processed_finance_root() / "maps" / map_slug / "fred-series.json")
    series = config.get("series", [])
    api_key_present = bool(env.get("FRED_API_KEY"))
    endpoints: list[dict[str, Any]] = []
    if not api_key_present:
        endpoints.append({
            "label": "FRED series_observations",
            "status": "skipped",
            "failureReason": {"errorType": "MissingApiKey", "message": "FRED_API_KEY is not present."},
        })
    else:
        import requests

        for item in series[:2]:
            series_id = item.get("seriesId")
            url = "https://api.stlouisfed.org/fred/series/observations"

            def call(url: str = url, series_id: str = series_id) -> list[dict[str, Any]]:
                response = requests.get(
                    url,
                    params={
                        "series_id": series_id,
                        "api_key": env["FRED_API_KEY"],
                        "file_type": "json",
                        "sort_order": "desc",
                        "limit": 3,
                    },
                    timeout=20,
                )
                response.raise_for_status()
                return response.json().get("observations", [])

            endpoints.append(run_endpoint(f"series_observations:{series_id}", call))
    status, rows, fields, sample_period, failure_reason = endpoint_summary(endpoints)
    decision = "ready_for_n57" if rows > 0 else ("blocked" if not api_key_present else "unavailable")
    return source_probe(
        source_id="fred",
        display_name="FRED",
        collector_id="fred_http_api_v1",
        source_role="official_api",
        requires_api_key=True,
        api_key_present=api_key_present,
        source_type="macro_commodity_time_series",
        reliability_tier="official_api",
        tested_endpoints=endpoints,
        tested_symbols=[str(item.get("seriesId")) for item in series[:2] if item.get("seriesId")],
        returned_rows=rows,
        returned_fields=fields,
        sample_period=sample_period,
        supports_required_evidence_keys=[
            "commodity_price_momentum",
            "commodity_context",
            "commodity_price_context",
            "available_positive_proxy",
            "portfolio_stance_evidence_mix",
        ],
        allowed_claim_types=[
            "commodity_trend",
            "relative_allocation_signal",
            "commodity_to_equity_transmission",
            "valuation_vs_commodity_signal",
            "trade_price_consistency",
        ],
        not_allowed_claim_types=[
            "china_supply_demand_confirmed",
            "domestic_inventory_confirmed",
            "company_earnings_confirmed",
        ],
        decision_for_n57=decision,
        probe_status=status,
        failure_reason=failure_reason,
        notes=["FRED 可以做全球金属价格和宏观代理，不能证明中国国内库存、现货升贴水或公司盈利。"],
    )


def probe_baostock(map_slug: str) -> dict[str, Any]:
    universe = read_json(processed_finance_root() / "maps" / map_slug / "baostock-company-universe.json")
    companies = universe.get("coreUniverse", [])[:1]
    endpoints: list[dict[str, Any]] = []
    tested_symbols: list[str] = []
    try:
        import baostock as bs
    except BaseException as exc:
        endpoints.append({
            "label": "baostock import",
            "status": "error",
            "failureReason": sanitize_error(exc),
        })
    else:
        for company in companies:
            code = company.get("bsCode") or company.get("code")
            if not code:
                continue
            tested_symbols.append(str(code))

            def call(code: str = str(code)) -> list[dict[str, Any]]:
                login = bs.login()
                if getattr(login, "error_code", "0") != "0":
                    raise RuntimeError(f"BaoStock login failed: {getattr(login, 'error_msg', '')}")
                try:
                    query = bs.query_history_k_data_plus(
                        code,
                        "date,code,close,volume,amount,turn,pctChg,peTTM,pbMRQ",
                        start_date="2026-01-01",
                        end_date=dt.date.today().isoformat(),
                        frequency="d",
                        adjustflag="3",
                    )
                    rows: list[dict[str, Any]] = []
                    while query.next():
                        fields = query.fields
                        rows.append(dict(zip(fields, query.get_row_data())))
                    return rows[-5:]
                finally:
                    bs.logout()

            endpoints.append(run_endpoint(f"query_history_k_data_plus:{code}", call))
    status, rows, fields, sample_period, failure_reason = endpoint_summary(endpoints)
    return source_probe(
        source_id="baostock",
        display_name="BaoStock",
        collector_id="baostock_python_package_v0",
        source_role="community_api",
        requires_api_key=False,
        api_key_present=None,
        source_type="a_share_market_and_valuation",
        reliability_tier="market_data_proxy",
        tested_endpoints=endpoints,
        tested_symbols=tested_symbols,
        returned_rows=rows,
        returned_fields=fields,
        sample_period=sample_period,
        supports_required_evidence_keys=[
            "equity_transmission_proxy",
            "equity_market_reaction",
            "valuation_proxy",
            "valuation_level",
            "available_positive_proxy",
            "portfolio_stance_evidence_mix",
        ],
        allowed_claim_types=[
            "a_share_relative_allocation",
            "a_share_relative_performance",
            "market_confirmation",
            "valuation_support",
            "price_in_assessment",
        ],
        not_allowed_claim_types=[
            "industry_fundamental_confirmed",
            "commodity_supply_demand_confirmed",
            "company_margin_confirmed",
        ],
        decision_for_n57="ready_for_n57" if rows > 0 else "unavailable",
        probe_status=status,
        failure_reason=failure_reason,
        notes=["BaoStock 可做 A 股代表公司市场反应、成交和估值代理，不能单独证明行业基本面。"],
    )


def recent_trade_dates(limit: int = 8) -> list[str]:
    today = dt.date.today()
    dates: list[str] = []
    offset = 0
    while len(dates) < limit and offset < 30:
        day = today - dt.timedelta(days=offset)
        if day.weekday() < 5:
            dates.append(day.strftime("%Y%m%d"))
        offset += 1
    return dates


def first_successful_ak_call(label: str, call_factory: Callable[[str], Any], dates: list[str]) -> list[dict[str, Any]]:
    endpoints: list[dict[str, Any]] = []
    for date_value in dates:
        result = run_endpoint(f"{label}:{date_value}", lambda date_value=date_value: call_factory(date_value))
        endpoints.append(result)
        if result.get("status") == "success":
            break
    return endpoints


def run_ak_subprocess(label: str, function_name: str, kwargs: dict[str, Any], timeout_seconds: int = 25) -> dict[str, Any]:
    child_code = r"""
import json
import sys
kwargs = json.loads(sys.argv[2])
try:
    import akshare as ak
    value = getattr(ak, sys.argv[1])(**kwargs)
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
            return result[:80]
        if isinstance(obj, list) and obj and isinstance(obj[0], dict):
            return [str(item) for item in list(obj[0].keys())[:80]]
        return []
    def rows(obj):
        shape = getattr(obj, "shape", None)
        if shape is not None:
            return int(shape[0])
        if isinstance(obj, dict):
            total = 0
            for val in obj.values():
                total += rows(val)
            return total if total else len(obj)
        if isinstance(obj, list):
            return len(obj)
        return 0 if obj is None else 1
    print(json.dumps({"rows": rows(value), "fields": fields(value)}, ensure_ascii=False))
except BaseException as exc:
    print(json.dumps({"errorType": type(exc).__name__, "message": str(exc)[:500]}, ensure_ascii=False))
    sys.exit(2)
"""
    try:
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
    except subprocess.TimeoutExpired:
        return {
            "label": label,
            "status": "error",
            "failureReason": {"errorType": "TimeoutExpired", "message": f"AKShare endpoint exceeded {timeout_seconds}s."},
        }
    stdout = (completed.stdout or "").strip().splitlines()
    payload_text = stdout[-1] if stdout else "{}"
    try:
        payload = json.loads(payload_text)
    except json.JSONDecodeError:
        payload = {"errorType": "InvalidProbeOutput", "message": payload_text[:500]}
    if completed.returncode != 0 or payload.get("errorType"):
        return {
            "label": label,
            "status": "error",
            "failureReason": {
                "errorType": payload.get("errorType", f"Exit{completed.returncode}"),
                "message": payload.get("message", (completed.stderr or "")[:500]),
            },
        }
    rows = int(payload.get("rows", 0))
    return {
        "label": label,
        "status": "success" if rows > 0 else "empty",
        "returnedRows": rows,
        "returnedFields": payload.get("fields", []),
        "samplePeriod": None,
    }


def first_successful_ak_subprocess(label: str, function_name: str, kwargs_for_date: Callable[[str], dict[str, Any]], dates: list[str]) -> list[dict[str, Any]]:
    endpoints: list[dict[str, Any]] = []
    for date_value in dates[:4]:
        endpoint_label = f"{label}:{date_value}"
        result = run_ak_subprocess(endpoint_label, function_name, kwargs_for_date(date_value))
        endpoints.append(result)
        if result.get("status") == "success":
            break
    return endpoints


def probe_akshare_futures() -> list[dict[str, Any]]:
    try:
        child_env = dict(os.environ)
        child_env["PYTHONIOENCODING"] = "utf-8"
        completed = subprocess.run(
            [sys.executable, "-c", "import akshare; print('ok')"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=child_env,
            timeout=20,
        )
        if completed.returncode != 0:
            raise RuntimeError((completed.stderr or completed.stdout or "akshare import failed")[:500])
    except BaseException as exc:
        failure = sanitize_error(exc)
        return [
            source_probe(
                source_id=source_id,
                display_name=display_name,
                collector_id="akshare_python_package_v0",
                source_role="official_exchange_via_collector",
                requires_api_key=False,
                api_key_present=None,
                source_type=source_type,
                reliability_tier="exchange_data_via_named_collector",
                tested_endpoints=[{"label": "akshare import", "status": "error", "failureReason": failure}],
                tested_symbols=[],
                supports_required_evidence_keys=[],
                allowed_claim_types=[],
                not_allowed_claim_types=["final_official_fact_without_source_review"],
                decision_for_n57="blocked",
                probe_status="error",
                failure_reason=f"{failure['errorType']}: {failure['message']}",
                notes=["AKShare 包不可导入，无法探测交易所数据。"],
            )
            for source_id, display_name, source_type in [
                ("shfe", "SHFE via AKShare", "domestic_futures_exchange_data"),
                ("ine", "INE via AKShare", "domestic_futures_exchange_data"),
                ("gfex", "GFEX via AKShare", "domestic_futures_exchange_data"),
            ]
        ]

    dates = recent_trade_dates()
    probes: list[dict[str, Any]] = []

    shfe_endpoints: list[dict[str, Any]] = []
    shfe_endpoints.extend(first_successful_ak_subprocess("get_shfe_daily", "get_shfe_daily", lambda d: {"date": d}, dates))
    shfe_endpoints.extend(first_successful_ak_subprocess("futures_settle_shfe", "futures_settle_shfe", lambda d: {"date": d}, dates))
    shfe_endpoints.extend(first_successful_ak_subprocess("futures_stock_shfe_js", "futures_stock_shfe_js", lambda d: {"date": d}, dates))
    shfe_endpoints.extend(first_successful_ak_subprocess("futures_shfe_warehouse_receipt", "futures_shfe_warehouse_receipt", lambda d: {"date": d}, dates))
    shfe_endpoints.append(run_ak_subprocess("get_receipt:CU/AL/ZN/NI/SN/PB/AU/AG", "get_receipt", {"start_date": dates[-1], "end_date": dates[0], "vars_list": ["CU", "AL", "ZN", "NI", "SN", "PB", "AU", "AG"]}))
    status, rows, fields, sample_period, failure_reason = endpoint_summary(shfe_endpoints)
    probes.append(
        source_probe(
            source_id="shfe",
            display_name="SHFE 上期所（AKShare 采集器）",
            collector_id="akshare_python_package_v0",
            source_role="official_exchange_via_collector",
            requires_api_key=False,
            api_key_present=None,
            source_type="domestic_futures_exchange_data",
            reliability_tier="exchange_data_via_named_collector",
            tested_endpoints=shfe_endpoints,
            tested_symbols=["CU", "AL", "ZN", "NI", "SN", "PB", "AU", "AG"],
            returned_rows=rows,
            returned_fields=fields,
            sample_period=sample_period,
            supports_required_evidence_keys=[
                "commodity_price_momentum",
                "commodity_price_context",
                "china_supply_demand_proxy",
                "domestic_inventory_or_spot_proxy",
                "risk_reward_boundary",
            ],
            allowed_claim_types=[
                "commodity_trend",
                "china_supply_demand",
                "inventory_pressure",
                "risk_reward",
                "trade_price_consistency",
            ],
            not_allowed_claim_types=[
                "final_official_fact_without_source_review",
                "company_earnings_confirmed",
            ],
            decision_for_n57="usable_with_cap" if rows > 0 else "unavailable",
            probe_status=status,
            failure_reason=failure_reason,
            notes=["AKShare 是可用采集入口；若进入 N57，fact 必须写清 sourcePublisher=SHFE、accessProvider=AKShare、collector=akshare_python_package_v0、endpoint 和字段口径。质量等级由具体 endpoint 决定。"],
        )
    )

    ine_endpoints: list[dict[str, Any]] = []
    ine_endpoints.extend(first_successful_ak_subprocess("futures_settle_ine", "futures_settle_ine", lambda d: {"date": d}, dates))
    ine_endpoints.append(run_ak_subprocess("futures_zh_daily_sina:BC0", "futures_zh_daily_sina", {"symbol": "BC0"}))
    status, rows, fields, sample_period, failure_reason = endpoint_summary(ine_endpoints)
    probes.append(
        source_probe(
            source_id="ine",
            display_name="INE 上海国际能源交易中心（AKShare / Sina 采集器）",
            collector_id="akshare_python_package_v0",
            source_role="official_exchange_or_market_feed_via_collector",
            requires_api_key=False,
            api_key_present=None,
            source_type="domestic_futures_exchange_data",
            reliability_tier="exchange_data_via_named_collector",
            tested_endpoints=ine_endpoints,
            tested_symbols=["BC"],
            returned_rows=rows,
            returned_fields=fields,
            sample_period=sample_period,
            supports_required_evidence_keys=[
                "commodity_price_momentum",
                "commodity_price_context",
                "china_supply_demand_proxy",
            ],
            allowed_claim_types=["commodity_trend", "trade_price_consistency"],
            not_allowed_claim_types=["domestic_inventory_confirmed", "company_earnings_confirmed"],
            decision_for_n57="usable_with_cap" if rows > 0 else "candidate_only",
            probe_status=status,
            failure_reason=failure_reason,
            notes=["INE 国际铜可作为铜价或市场交易代理；若只有 Sina 行情可用，不能包装成官方仓单或供需事实。"],
        )
    )

    gfex_endpoints: list[dict[str, Any]] = []
    gfex_endpoints.extend(first_successful_ak_subprocess("futures_settle_gfex", "futures_settle_gfex", lambda d: {"date": d}, dates))
    gfex_endpoints.extend(first_successful_ak_subprocess("futures_gfex_warehouse_receipt", "futures_gfex_warehouse_receipt", lambda d: {"date": d}, dates))
    gfex_endpoints.append(run_ak_subprocess("futures_zh_daily_sina:LC0", "futures_zh_daily_sina", {"symbol": "LC0"}))
    gfex_endpoints.append(run_ak_subprocess("futures_zh_daily_sina:SI0", "futures_zh_daily_sina", {"symbol": "SI0"}))
    status, rows, fields, sample_period, failure_reason = endpoint_summary(gfex_endpoints)
    probes.append(
        source_probe(
            source_id="gfex",
            display_name="GFEX 广期所（AKShare / Sina 采集器）",
            collector_id="akshare_python_package_v0",
            source_role="official_exchange_or_market_feed_via_collector",
            requires_api_key=False,
            api_key_present=None,
            source_type="domestic_futures_exchange_data",
            reliability_tier="exchange_data_via_named_collector",
            tested_endpoints=gfex_endpoints,
            tested_symbols=["LC", "SI"],
            returned_rows=rows,
            returned_fields=fields,
            sample_period=sample_period,
            supports_required_evidence_keys=[
                "commodity_price_momentum",
                "commodity_price_context",
                "domestic_inventory_or_spot_proxy",
                "risk_reward_boundary",
            ],
            allowed_claim_types=["commodity_trend", "inventory_pressure", "risk_reward"],
            not_allowed_claim_types=["a_share_nonferrous_broad_allocation_without_mapping"],
            decision_for_n57="candidate_only" if rows > 0 else "unavailable",
            probe_status=status,
            failure_reason=failure_reason,
            notes=["GFEX LC/SI 与 Dust2 有色铜铝锌镍主线不是完全同一资产，可作为新能源金属候选，不直接进入 v1 核心结论。"],
        )
    )
    return probes


def probe_world_bank() -> dict[str, Any]:
    import requests

    indicators = {
        "NV.IND.TOTL.KD.ZG": "industry_value_added_growth",
        "NV.IND.MANF.KD.ZG": "manufacturing_value_added_growth",
        "NE.GDI.FTOT.KD.ZG": "gross_fixed_capital_formation_growth",
        "NY.GDP.MKTP.KD.ZG": "gdp_growth",
        "TX.VAL.MRCH.CD.WT": "merchandise_exports",
        "TM.VAL.MRCH.CD.WT": "merchandise_imports",
    }
    endpoints: list[dict[str, Any]] = []
    for indicator, label in indicators.items():
        url = f"https://api.worldbank.org/v2/country/CHN/indicator/{indicator}"

        def call(url: str = url) -> list[dict[str, Any]]:
            response = requests.get(
                url,
                params={"format": "json", "date": "2018:2026", "per_page": 1000},
                timeout=20,
            )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, list) or len(payload) < 2:
                return []
            return [row for row in payload[1] if row.get("value") is not None]

        endpoints.append(run_endpoint(f"indicator:{indicator}:{label}", call))
    status, rows, fields, sample_period, failure_reason = endpoint_summary(endpoints)
    return source_probe(
        source_id="world_bank",
        display_name="World Bank Indicators API",
        collector_id="world_bank_http_api_v2",
        source_role="official_public_api",
        requires_api_key=False,
        api_key_present=None,
        source_type="macro_demand_time_series",
        reliability_tier="official_api_lagged",
        tested_endpoints=endpoints,
        tested_symbols=list(indicators.keys()),
        returned_rows=rows,
        returned_fields=fields,
        sample_period=sample_period,
        supports_required_evidence_keys=["macro_demand_proxy", "global_cycle_signal", "risk_reward_boundary"],
        allowed_claim_types=["macro_demand", "global_cycle_signal", "horizon_context"],
        not_allowed_claim_types=[
            "short_term_china_spot_supply_demand",
            "company_earnings_confirmed",
            "inventory_pressure_confirmed",
        ],
        decision_for_n57="usable_with_cap" if rows > 0 else "unavailable",
        probe_status=status,
        failure_reason=failure_reason,
        notes=["World Bank 无 key public API 可做年度宏观背景，频率偏低，不能直接支撑 1-3 个月国内有色供需判断。"],
    )


def probe_un_comtrade(env: dict[str, str], map_slug: str) -> dict[str, Any]:
    config = read_json(processed_finance_root() / "maps" / map_slug / "un-comtrade-hs-codes.json")
    hs_items = config.get("hsCodes") or config.get("commodities") or []
    hs_codes = [item.get("cmdCode") for item in hs_items if item.get("cmdCode")]
    api_key_present = bool(env.get("UN_COMTRADE_KEY"))
    endpoints: list[dict[str, Any]] = []
    if not api_key_present:
        endpoints.append({
            "label": "UN Comtrade key presence",
            "status": "skipped",
            "failureReason": {"errorType": "MissingApiKey", "message": "UN_COMTRADE_KEY is not present."},
        })
    else:
        try:
            import comtradeapicall
        except BaseException as exc:
            endpoints.append({"label": "comtradeapicall import", "status": "error", "failureReason": sanitize_error(exc)})
        else:
            for period in ["2025", "2024", "2023"]:
                for flow in ["M", "X"]:
                    for code in hs_codes[:2]:
                        def call(period: str = period, flow: str = flow, code: str = str(code)) -> Any:
                            return comtradeapicall.getFinalData(
                                env["UN_COMTRADE_KEY"],
                                typeCode="C",
                                freqCode="A",
                                clCode="HS",
                                period=period,
                                reporterCode="156",
                                cmdCode=code,
                                flowCode=flow,
                                partnerCode="0",
                                partner2Code=None,
                                customsCode=None,
                                motCode=None,
                                maxRecords=1,
                                format_output="JSON",
                                aggregateBy=None,
                                breakdownMode="classic",
                                countOnly=None,
                                includeDesc=True,
                            )

                        endpoints.append(run_endpoint(f"getFinalData:{period}:{flow}:{code}", call))
                        if endpoints[-1].get("status") == "success":
                            break
                    if endpoints and endpoints[-1].get("status") == "success":
                        break
                if endpoints and endpoints[-1].get("status") == "success":
                    break
            if all(item.get("status") != "success" for item in endpoints):
                import requests

                def direct_call() -> list[dict[str, Any]]:
                    response = requests.get(
                        "https://comtradeapi.un.org/data/v1/get/C/A/HS",
                        params={
                            "cmdCode": str(hs_codes[0]) if hs_codes else "260300",
                            "flowCode": "M",
                            "period": "2024",
                            "reporterCode": "156",
                            "partnerCode": "0",
                            "maxRecords": 1,
                            "includeDesc": "true",
                        },
                        headers={"Ocp-Apim-Subscription-Key": env["UN_COMTRADE_KEY"]},
                        timeout=20,
                    )
                    response.raise_for_status()
                    payload = response.json()
                    data = payload.get("data") or payload.get("Data") or []
                    return data if isinstance(data, list) else []

                endpoints.append(run_endpoint("direct_http:data/v1/get/C/A/HS", direct_call))
    status, rows, fields, sample_period, failure_reason = endpoint_summary(endpoints)
    decision = "usable_with_cap" if rows > 0 else ("blocked" if not api_key_present else "unavailable")
    notes = [
        "UN Comtrade 是滞后贸易流线索；成功也不能单独证明国内库存、现货或公司盈利。",
        "本探测会区分 key 缺失、package 错误、空结果和 direct HTTP fallback 错误。",
    ]
    return source_probe(
        source_id="un_comtrade",
        display_name="UN Comtrade",
        collector_id="un_comtrade_python_package_v1",
        source_role="official_api",
        requires_api_key=True,
        api_key_present=api_key_present,
        source_type="international_trade_time_series",
        reliability_tier="official_api_lagged",
        tested_endpoints=endpoints,
        tested_symbols=[str(code) for code in hs_codes[:5]],
        returned_rows=rows,
        returned_fields=fields,
        sample_period=sample_period,
        supports_required_evidence_keys=["trade_flow_proxy"],
        allowed_claim_types=["trade_flow_signal", "supply_demand_proxy"],
        not_allowed_claim_types=[
            "domestic_inventory_confirmed",
            "spot_premium_confirmed",
            "company_earnings_confirmed",
        ],
        decision_for_n57=decision,
        probe_status=status,
        failure_reason=failure_reason,
        notes=notes,
    )


def candidate_probe(
    *,
    source_id: str,
    display_name: str,
    source_type: str,
    supports: list[str],
    allowed: list[str],
    note: str,
) -> dict[str, Any]:
    return source_probe(
        source_id=source_id,
        display_name=display_name,
        collector_id="not_implemented_in_n57_pre_probe",
        source_role="candidate_source",
        requires_api_key=False,
        api_key_present=None,
        source_type=source_type,
        reliability_tier="candidate_unverified",
        tested_endpoints=[{"label": "documented candidate only", "status": "skipped"}],
        tested_symbols=[],
        supports_required_evidence_keys=supports,
        allowed_claim_types=allowed,
        not_allowed_claim_types=["ready_for_runtime_without_collector", "final_fact_without_probe"],
        decision_for_n57="candidate_only",
        probe_status="skipped",
        notes=[note],
    )


def candidate_probes() -> list[dict[str, Any]]:
    return [
        candidate_probe(
            source_id="nbs",
            display_name="国家统计局 NBS",
            source_type="china_macro_and_industrial_statistics",
            supports=["macro_demand_proxy", "china_supply_demand_proxy", "risk_reward_boundary"],
            allowed=["macro_demand", "china_supply_demand", "industrial_activity"],
            note="权威但接口稳定性待单独验证；本前置不采集。",
        ),
        candidate_probe(
            source_id="gacc",
            display_name="中国海关总署 GACC",
            source_type="china_customs_trade_data",
            supports=["trade_flow_proxy"],
            allowed=["trade_flow_signal"],
            note="可作为中国本地贸易锚点候选；本前置不抓取网页或登录数据。",
        ),
        candidate_probe(
            source_id="usgs",
            display_name="USGS Mineral Commodity Summaries",
            source_type="annual_mineral_supply_background",
            supports=["china_supply_demand_proxy", "commodity_context"],
            allowed=["supply_background", "resource_structure"],
            note="适合年度供给背景和行业底蕴，不适合短周期交易判断；本前置不解析 PDF。",
        ),
        candidate_probe(
            source_id="smm",
            display_name="上海有色网 SMM",
            source_type="paid_or_authorized_industry_data",
            supports=["domestic_inventory_or_spot_proxy", "china_supply_demand_proxy"],
            allowed=["inventory_pressure", "spot_premium"],
            note="可能覆盖现货、库存、升贴水，但需要授权；不可免费抓取或假设可用。",
        ),
        candidate_probe(
            source_id="cninfo",
            display_name="巨潮资讯 CNINFO",
            source_type="filing_anchor_and_company_disclosure",
            supports=["earnings_transmission_proxy", "valuation_level"],
            allowed=["company_disclosure_anchor", "filing_locator"],
            note="可作为财报页码和公司披露锚点；本前置不解析全文 PDF。",
        ),
    ]


def build_summary(probes: list[dict[str, Any]]) -> dict[str, Any]:
    by_decision: dict[str, int] = {decision: 0 for decision in sorted(VALID_DECISIONS)}
    for probe in probes:
        by_decision[probe["decisionForN57"]] = by_decision.get(probe["decisionForN57"], 0) + 1
    return {
        "totalSources": len(probes),
        "byDecisionForN57": by_decision,
        "futuresInterfaceConclusionZh": "现有正式 collector 不含期货数据；AKShare 可作为期货采集入口探测 SHFE / INE / GFEX。N57 fact 必须记录发布方、接入方、采集器、endpoint 和字段口径。",
        "worldBankConclusionZh": "World Bank public API 无需用户申请 key；若 smoke test 返回数据，可进入 N57 作为年度宏观代理，但不能支撑短周期国内供需。",
        "unComtradeConclusionZh": "UN Comtrade 需要按 package、参数年份、flow、空结果和 direct HTTP fallback 分层记录，不能再只写 ValueError。",
        "scenarioNamingConclusionZh": "data/materials/processed/finance/maps 是历史命名；当前 dust2-nonferrous 实际是 finance scenario，不是 Hex tactical map。本前置只文档标注，不迁移目录。",
    }


def markdown_report(report: dict[str, Any]) -> str:
    probes = report["sourceProbes"]
    rows = "\n".join(
        f"| `{probe['sourceId']}` | {probe['displayName']} | `{probe['collectorId']}` | `{probe['probeStatus']}` | `{probe['decisionForN57']}` | {probe['returnedRows']} | {', '.join(probe['supportsRequiredEvidenceKeys']) or '无'} |"
        for probe in probes
    )
    failures = "\n".join(
        f"- `{probe['sourceId']}`：{probe['failureReason']}"
        for probe in probes
        if probe.get("failureReason")
    ) or "- 本次报告没有记录阻塞级失败原因。"
    partial_failures: list[str] = []
    for probe in probes:
        for endpoint in probe.get("testedEndpoints", []):
            if endpoint.get("status") == "error":
                failure = endpoint.get("failureReason") or {}
                partial_failures.append(
                    f"- `{probe['sourceId']}` / `{endpoint.get('label')}`：{failure.get('errorType')} {failure.get('message')}"
                )
    partial_failure_text = "\n".join(partial_failures[:20]) or "- 无部分失败 endpoint。"
    akshare = [probe for probe in probes if probe["collectorId"] == "akshare_python_package_v0"]
    ak_rows = "\n".join(
        f"- `{probe['sourceId']}`：{probe['decisionForN57']}，返回 {probe['returnedRows']} 行，字段：{', '.join(probe['returnedFields'][:12]) or '无'}"
        for probe in akshare
    ) or "- 未生成 AKShare 探测项。"
    n56_keys = "\n".join(f"- `{key}`" for key in report["n56RequiredEvidenceKeys"])
    return f"""# N57 前置数据源探测报告

生成时间：`{report['generatedAt']}`

金融场景：`{report['financeScenarioSlug']}`

Hex 地图：`{report['hexMapSlug']}`

## 1. 结论

```text
现有正式 collector 不包含期货数据。
AKShare 可以激进探测 SHFE / INE / GFEX。它是采集入口；数据能不能用取决于具体 endpoint、字段口径和原始发布方。
World Bank public API 可作为无 key 宏观代理候选，频率偏低。
UN Comtrade 必须区分 key、package、参数、空结果和 direct HTTP fallback，不能再只写 ValueError。
finance/maps 是历史命名，dust2-nonferrous 当前实际是 finance scenario，不是 Hex 战术地图。
```

## 2. N56 必需证据键

{n56_keys}

## 3. 数据源探测表

| source | 名称 | collector | 状态 | N57 决策 | 行数 | 支持的证据键 |
|---|---|---|---|---|---:|---|
{rows}

## 4. AKShare 探测说明

{ak_rows}

如果 N57 使用 AKShare 探测结果，每条 fact 必须写清 `sourcePublisher=SHFE/INE/GFEX/Sina`、`accessProvider=AKShare`、`collector=akshare_python_package_v0`、endpoint、字段、日期和变换口径。AKShare 本身不是问题，不能省略来源链才是问题。

## 5. 失败与不可用说明

{failures}

### 部分失败 endpoint

{partial_failure_text}

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
data/materials/generated/finance/source-probes/{report['financeScenarioSlug']}/source-probe-report.json
```
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Probe Finance Major data sources before N57.")
    parser.add_argument("--map", default="dust2-nonferrous")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    map_slug = args.map
    env = load_local_env()
    required_keys = collect_required_keys(map_slug)
    probes: list[dict[str, Any]] = []
    probe_errors: list[dict[str, Any]] = []
    for label, probe_fn in [
        ("fred", lambda: [probe_fred(env, map_slug)]),
        ("baostock", lambda: [probe_baostock(map_slug)]),
        ("akshare_futures", probe_akshare_futures),
        ("world_bank", lambda: [probe_world_bank()]),
        ("un_comtrade", lambda: [probe_un_comtrade(env, map_slug)]),
        ("candidates", candidate_probes),
    ]:
        try:
            probes.extend(probe_fn())
        except BaseException as exc:
            error = sanitize_error(exc)
            error["traceTail"] = traceback.format_exc().splitlines()[-3:]
            probe_errors.append({"probe": label, **error})
    report = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": utc_now(),
        "financeScenarioSlug": map_slug,
        "hexMapSlug": "dust2",
        "n56RequiredEvidenceKeys": required_keys,
        "sourceProbes": probes,
        "summary": build_summary(probes),
        "probeErrors": probe_errors,
        "secretsPolicy": {
            "storedApiKeyValues": False,
            "storedRawResponses": False,
            "apiKeysRecordedAsPresenceOnly": True,
        },
    }
    output_path = generated_probe_root() / map_slug / REPORT_FILE_NAME
    write_json(output_path, report)
    write_text(docs_finance_root() / "n57-data-source-probe-report.md", markdown_report(report))
    print(f"Wrote {output_path}")
    print(f"Wrote {docs_finance_root() / 'n57-data-source-probe-report.md'}")
    if probe_errors:
        print(f"Probe-level errors: {len(probe_errors)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
