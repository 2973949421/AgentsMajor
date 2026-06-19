from __future__ import annotations

import contextlib
import datetime as dt
import io
from typing import Any

from common import confidence_for_tier, observation_fact, pct_change, percentile_rank, source_by_id, to_float, unavailable_fact, value_n_periods_ago


MARKET_ALLOWED_CLAIMS = [
    "a_share_relative_performance",
    "market_confirmation",
    "valuation_support",
    "price_in_assessment",
    "commodity_to_equity_transmission",
    "limited_positive_stance",
    "limited_negative_stance",
]

MARKET_NOT_ALLOWED_CLAIMS = [
    "industry_fundamentals_confirmed",
    "company_earnings_confirmed",
    "china_supply_demand",
    "inventory_pressure",
]


def _query_rows(bs: Any, code: str, fields: list[str], start_date: str, end_date: str) -> list[dict[str, str]]:
    rs = bs.query_history_k_data_plus(code, ",".join(fields), start_date=start_date, end_date=end_date, frequency="d", adjustflag="3")
    rows: list[dict[str, str]] = []
    while rs.error_code == "0" and rs.next():
        rows.append(dict(zip(rs.fields, rs.get_row_data(), strict=False)))
    if rs.error_code != "0":
        raise RuntimeError(f"baostock query failed for {code}: {rs.error_msg}")
    return rows


def _window_returns(values: list[float]) -> dict[str, float | None]:
    latest = values[-1] if values else None
    return {
        "return1mPct": pct_change(latest, value_n_periods_ago(values, 21)),
        "return3mPct": pct_change(latest, value_n_periods_ago(values, 63)),
        "return6mPct": pct_change(latest, value_n_periods_ago(values, 126)),
        "return12mPct": pct_change(latest, value_n_periods_ago(values, 252)),
    }


def _latest_numeric(rows: list[dict[str, str]], field: str) -> float | None:
    for row in reversed(rows):
        value = to_float(row.get(field))
        if value is not None:
            return value
    return None


def _field_percentile(rows: list[dict[str, str]], field: str, latest: float | None) -> float | None:
    values = [to_float(row.get(field)) for row in rows]
    clean = [float(value) for value in values if value is not None and value > 0]
    if latest is None or not clean:
        return None
    return percentile_rank(clean, latest)


def _benchmark_returns(bs: Any, start_date: str, end_date: str) -> tuple[dict[str, float | None], str | None]:
    try:
        rows = _query_rows(bs, "sh.000300", ["date", "code", "close", "volume", "amount"], start_date, end_date)
        values = [to_float(row.get("close")) for row in rows]
        values = [float(value) for value in values if value is not None]
        if len(values) < 64:
            return {}, "hs300_benchmark_insufficient_history"
        return _window_returns(values), None
    except Exception as exc:  # noqa: BLE001
        return {}, f"hs300_benchmark_unavailable:{exc.__class__.__name__}"


def _unavailable_company(
    *,
    fact_id: str,
    company: dict[str, Any],
    source: dict[str, Any],
    collector_id: str,
    configs: dict[str, Any],
    reason: str,
) -> dict[str, Any]:
    return unavailable_fact(
        fact_id=fact_id,
        statement_zh=f"BaoStock 未能采集 {company['name']}（{company['code']}）的可用行情、估值或相对基准观测：{reason}。",
        metric_name="a_share_company_market_valuation_derived",
        source="BAOSTOCK",
        source_type=source["defaultQualityTier"],
        source_publisher="BaoStock",
        access_provider="BaoStock Python package",
        collector=collector_id,
        endpoint="query_history_k_data_plus",
        domain="stock",
        entity=company["code"],
        locator=company["code"],
        original_location=f"baostock-company-universe.json:{company['code']}",
        policy_notes=configs["baostockUniverse"].get("limitations", []),
        unavailable_reason=reason,
        source_warning="BaoStock company query failed; do not treat this company as observed evidence.",
        reliability_tier=source["defaultQualityTier"],
        allowed_claim_types=MARKET_ALLOWED_CLAIMS,
        not_allowed_claim_types=MARKET_NOT_ALLOWED_CLAIMS,
        interpretation_hint="公司行情或估值缺失时，不能用该公司支持市场确认或估值判断。",
        score_cap_policy="missing equity or valuation proxy caps A-share allocation claims.",
    )


def collect_baostock_facts(configs: dict[str, Any], *, core_limit: int) -> dict[str, Any]:
    source = source_by_id(configs["sourceRegistry"], "baostock")
    confidence = confidence_for_tier(configs["policy"], source["defaultQualityTier"])
    collector_id = source["collector"]["collectorId"]
    facts: list[dict[str, Any]] = []
    warnings: list[str] = []
    fields = configs["baostockUniverse"].get("firstPhaseFields", ["date", "code", "close", "volume", "amount", "peTTM", "pbMRQ"])
    end_date = dt.date.today().isoformat()
    start_date = (dt.date.today() - dt.timedelta(days=430)).isoformat()

    try:
        import baostock as bs  # type: ignore
    except Exception as exc:  # noqa: BLE001
        warning = f"BaoStock package unavailable: {exc.__class__.__name__}"
        return {
            "sourceId": "baostock",
            "collector": collector_id,
            "dataMode": "unavailable_observation",
            "facts": [
                unavailable_fact(
                    fact_id="BAO001",
                    statement_zh="BaoStock Python 包不可用，未能形成 A 股市场、估值和相对基准代理事实。",
                    metric_name="a_share_company_market_valuation_derived",
                    source="BAOSTOCK",
                    source_type=source["defaultQualityTier"],
                    source_publisher="BaoStock",
                    access_provider="BaoStock Python package",
                    collector=collector_id,
                    endpoint="package_import",
                    domain="stock",
                    entity="core_universe",
                    locator="core_universe",
                    original_location="baostock-company-universe.json",
                    policy_notes=configs["baostockUniverse"].get("limitations", []),
                    unavailable_reason=warning,
                    source_warning="BaoStock collector did not run; do not treat configured company universe as observed evidence.",
                    reliability_tier=source["defaultQualityTier"],
                    allowed_claim_types=MARKET_ALLOWED_CLAIMS,
                    not_allowed_claim_types=MARKET_NOT_ALLOWED_CLAIMS,
                    interpretation_hint="BaoStock 不可用时，公司市场确认和估值证据缺失。",
                    score_cap_policy="missing A-share market data caps equity transmission and allocation claims.",
                )
            ],
            "warnings": [warning],
        }

    login_result = None
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            login_result = bs.login()
        if login_result.error_code != "0":
            raise RuntimeError(login_result.error_msg)

        hs300_returns, hs300_warning = _benchmark_returns(bs, start_date, end_date)
        if hs300_warning:
            warnings.append(hs300_warning)
            facts.append(
                unavailable_fact(
                    fact_id="BAO900",
                    statement_zh=f"BaoStock 未能形成沪深300相对基准事实：{hs300_warning}。",
                    metric_name="hs300_relative_benchmark",
                    source="BAOSTOCK",
                    source_type=source["defaultQualityTier"],
                    source_publisher="BaoStock",
                    access_provider="BaoStock Python package",
                    collector=collector_id,
                    endpoint="query_history_k_data_plus:sh.000300",
                    domain="index",
                    entity="sh.000300",
                    locator="sh.000300",
                    original_location="baostock:sh.000300",
                    policy_notes=configs["baostockUniverse"].get("limitations", []),
                    unavailable_reason=hs300_warning,
                    source_warning="HS300 benchmark unavailable; relative performance claims must be capped.",
                    reliability_tier=source["defaultQualityTier"],
                    allowed_claim_types=["a_share_relative_performance", "market_confirmation"],
                    not_allowed_claim_types=MARKET_NOT_ALLOWED_CLAIMS,
                    interpretation_hint="缺少沪深300基准时，只能使用公司绝对表现，不能做强相对配置判断。",
                    score_cap_policy="missing benchmark caps relative allocation claims.",
                )
            )

        for index, company in enumerate(configs["baostockUniverse"]["coreUniverse"][:core_limit], start=1):
            fact_id = f"BAO{index:03d}"
            try:
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    rows = _query_rows(bs, company["code"], fields, start_date, end_date)
                rows = [row for row in rows if to_float(row.get("close")) is not None]
                if len(rows) < 64:
                    raise ValueError("insufficient daily close history")

                latest = rows[-1]
                closes = [float(to_float(row.get("close")) or 0) for row in rows if to_float(row.get("close")) is not None]
                returns = _window_returns(closes)
                relative_returns = {
                    key.replace("return", "relativeReturn"): (
                        round(value - hs300_returns.get(key), 2)
                        if value is not None and hs300_returns.get(key) is not None
                        else None
                    )
                    for key, value in returns.items()
                }
                latest_close = closes[-1]
                latest_amount = _latest_numeric(rows, "amount")
                latest_volume = _latest_numeric(rows, "volume")
                pe_ttm = _latest_numeric(rows, "peTTM")
                pb_mrq = _latest_numeric(rows, "pbMRQ")
                pe_percentile = _field_percentile(rows, "peTTM", pe_ttm)
                pb_percentile = _field_percentile(rows, "pbMRQ", pb_mrq)

                facts.append(
                    observation_fact(
                        fact_id=fact_id,
                        statement_zh=(
                            f"BaoStock 显示 {company['name']}（{company['code']}）最近收盘价为 {latest_close:g}（{latest.get('date')}）；"
                            f"1/3/6/12个月收益约为 {returns['return1mPct']}%、{returns['return3mPct']}%、"
                            f"{returns['return6mPct']}%、{returns['return12mPct']}%。"
                            f"相对沪深300 1/3/6/12个月表现约为 {relative_returns['relativeReturn1mPct']}%、"
                            f"{relative_returns['relativeReturn3mPct']}%、{relative_returns['relativeReturn6mPct']}%、"
                            f"{relative_returns['relativeReturn12mPct']}%。PE TTM 为 {pe_ttm}，PB MRQ 为 {pb_mrq}。"
                            "该事实只能作为市场反应、估值和权益传导代理，不能证明行业基本面或公司盈利已经改善。"
                        ),
                        metric_name="a_share_company_market_valuation_derived",
                        value=latest_close,
                        unit="CNY/share",
                        period=f"{rows[0].get('date')}..{latest.get('date')}",
                        source="BAOSTOCK",
                        source_type=source["defaultQualityTier"],
                        source_publisher="BaoStock",
                        access_provider="BaoStock Python package",
                        collector=collector_id,
                        endpoint="query_history_k_data_plus",
                        confidence=confidence,
                        domain="stock",
                        entity=company["code"],
                        locator=company["code"],
                        original_location=f"baostock:{company['code']}:{latest.get('date')}",
                        policy_notes=configs["baostockUniverse"].get("limitations", []),
                        observed_at=latest.get("date"),
                        transform="daily close based 1/3/6/12 month returns, HS300 relative return, latest PE/PB and history percentile",
                        reliability_tier=source["defaultQualityTier"],
                        allowed_claim_types=MARKET_ALLOWED_CLAIMS,
                        not_allowed_claim_types=MARKET_NOT_ALLOWED_CLAIMS,
                        interpretation_hint="可支持权益市场反应、估值代理和商品到权益传导的有限判断；不能证明行业基本面。",
                        score_cap_policy="BaoStock market facts require commodity and risk evidence before supporting full allocation conclusions.",
                        extra={
                            "companyName": company["name"],
                            "primaryExposure": company.get("primaryExposure"),
                            "bucket": company.get("bucket"),
                            "latestClose": latest_close,
                            "latestAmount": latest_amount,
                            "latestVolume": latest_volume,
                            "peTTM": pe_ttm,
                            "pbMRQ": pb_mrq,
                            "pePercentile": pe_percentile,
                            "pbPercentile": pb_percentile,
                            "hs300BenchmarkWarning": hs300_warning,
                            **returns,
                            **relative_returns,
                        },
                    )
                )
            except Exception as exc:  # noqa: BLE001
                warning = f"BaoStock company {company['code']} unavailable: {exc.__class__.__name__}: {exc}"
                warnings.append(warning)
                facts.append(
                    _unavailable_company(
                        fact_id=fact_id,
                        company=company,
                        source=source,
                        collector_id=collector_id,
                        configs=configs,
                        reason=warning,
                    )
                )
    except Exception as exc:  # noqa: BLE001
        warning = f"BaoStock login failed: {exc.__class__.__name__}: {exc}"
        warnings.append(warning)
        facts = [
            unavailable_fact(
                fact_id="BAO001",
                statement_zh="BaoStock 登录失败，未能形成 A 股市场、估值和相对基准代理事实。",
                metric_name="a_share_company_market_valuation_derived",
                source="BAOSTOCK",
                source_type=source["defaultQualityTier"],
                source_publisher="BaoStock",
                access_provider="BaoStock Python package",
                collector=collector_id,
                endpoint="login",
                domain="stock",
                entity="core_universe",
                locator="core_universe",
                original_location="baostock-company-universe.json",
                policy_notes=configs["baostockUniverse"].get("limitations", []),
                unavailable_reason=warning,
                source_warning="BaoStock login failed; do not treat configured company universe as observed evidence.",
                reliability_tier=source["defaultQualityTier"],
                allowed_claim_types=MARKET_ALLOWED_CLAIMS,
                not_allowed_claim_types=MARKET_NOT_ALLOWED_CLAIMS,
                interpretation_hint="BaoStock 登录失败时，公司市场确认和估值证据缺失。",
                score_cap_policy="missing A-share market data caps equity transmission and allocation claims.",
            )
        ]
    finally:
        try:
            if login_result is not None:
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    bs.logout()
        except Exception:
            pass

    return {
        "sourceId": "baostock",
        "collector": collector_id,
        "dataMode": "offline_observation_fact" if any(f["dataMode"] == "offline_observation_fact" for f in facts) else "unavailable_observation",
        "facts": facts,
        "warnings": warnings,
    }
