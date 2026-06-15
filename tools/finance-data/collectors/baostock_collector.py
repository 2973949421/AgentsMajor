from __future__ import annotations

import datetime as dt
import contextlib
import io
from typing import Any

from common import confidence_for_tier, observation_fact, source_by_id, unavailable_fact


def _to_float(value: Any) -> float | None:
    try:
        if value in (None, "", "None"):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _query_rows(bs: Any, code: str, fields: list[str], start_date: str, end_date: str) -> list[dict[str, str]]:
    rs = bs.query_history_k_data_plus(code, ",".join(fields), start_date=start_date, end_date=end_date, frequency="d", adjustflag="3")
    rows: list[dict[str, str]] = []
    while rs.error_code == "0" and rs.next():
        rows.append(dict(zip(rs.fields, rs.get_row_data(), strict=False)))
    if rs.error_code != "0":
        raise RuntimeError(f"baostock query failed for {code}: {rs.error_msg}")
    return rows


def collect_baostock_facts(configs: dict[str, Any], *, core_limit: int) -> dict[str, Any]:
    source = source_by_id(configs["sourceRegistry"], "baostock")
    confidence = confidence_for_tier(configs["policy"], source["defaultQualityTier"])
    collector_id = source["collector"]["collectorId"]
    facts: list[dict[str, Any]] = []
    warnings: list[str] = []
    fields = configs["baostockUniverse"].get("firstPhaseFields", ["date", "code", "close", "volume", "amount", "peTTM", "pbMRQ"])
    end_date = dt.date.today().isoformat()
    start_date = (dt.date.today() - dt.timedelta(days=240)).isoformat()

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
                    statement_zh="BaoStock Python 包不可用，未能形成 A 股市场代理事实。",
                    metric_name="representative_company_market_proxy",
                    source="BAOSTOCK",
                    source_type=source["defaultQualityTier"],
                    collector=collector_id,
                    domain="stock",
                    entity="core_universe",
                    locator="core_universe",
                    original_location="baostock-company-universe.json",
                    policy_notes=configs["baostockUniverse"].get("limitations", []),
                    unavailable_reason=warning,
                    source_warning="BaoStock collector did not run; do not treat configured company universe as observed evidence.",
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
        for index, company in enumerate(configs["baostockUniverse"]["coreUniverse"][:core_limit], start=1):
            fact_id = f"BAO{index:03d}"
            try:
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    rows = _query_rows(bs, company["code"], fields, start_date, end_date)
                rows = [row for row in rows if _to_float(row.get("close")) is not None]
                if not rows:
                    raise ValueError("no numeric daily close returned")
                first = rows[0]
                latest = rows[-1]
                first_close = _to_float(first.get("close"))
                latest_close = _to_float(latest.get("close"))
                if first_close is None or latest_close is None:
                    raise ValueError("missing close")
                return_pct = round(((latest_close - first_close) / abs(first_close)) * 100, 2) if first_close else None
                facts.append(
                    observation_fact(
                        fact_id=fact_id,
                        statement_zh=(
                            f"BaoStock 显示 {company['name']}（{company['code']}）最近收盘价为 {latest_close:g}，"
                            f"自 {first.get('date')} 至 {latest.get('date')} 区间收益率约 {return_pct}%。"
                            "该事实只能作为市场反应和估值代理，不能证明行业基本面。"
                        ),
                        metric_name="representative_company_market_proxy",
                        value=latest_close,
                        unit="CNY/share",
                        period=f"{first.get('date')}..{latest.get('date')}",
                        source="BAOSTOCK",
                        source_type=source["defaultQualityTier"],
                        collector=collector_id,
                        confidence=confidence,
                        domain="stock",
                        entity=company["code"],
                        locator=company["code"],
                        original_location=f"baostock:{company['code']}:{latest.get('date')}",
                        policy_notes=configs["baostockUniverse"].get("limitations", []),
                        observed_at=latest.get("date"),
                        extra={
                            "companyName": company["name"],
                            "primaryExposure": company.get("primaryExposure"),
                            "bucket": company.get("bucket"),
                            "startClose": first_close,
                            "latestClose": latest_close,
                            "returnPct": return_pct,
                            "latestAmount": _to_float(latest.get("amount")),
                            "latestVolume": _to_float(latest.get("volume")),
                            "peTTM": _to_float(latest.get("peTTM")),
                            "pbMRQ": _to_float(latest.get("pbMRQ")),
                        },
                    )
                )
            except Exception as exc:  # noqa: BLE001
                warning = f"BaoStock company {company['code']} unavailable: {exc.__class__.__name__}"
                warnings.append(warning)
                facts.append(
                    unavailable_fact(
                        fact_id=fact_id,
                        statement_zh=f"BaoStock 未能采集 {company['name']}（{company['code']}）的可用行情观测。",
                        metric_name="representative_company_market_proxy",
                        source="BAOSTOCK",
                        source_type=source["defaultQualityTier"],
                        collector=collector_id,
                        domain="stock",
                        entity=company["code"],
                        locator=company["code"],
                        original_location=f"baostock-company-universe.json:{company['code']}",
                        policy_notes=configs["baostockUniverse"].get("limitations", []),
                        unavailable_reason=warning,
                        source_warning="BaoStock company query failed; do not treat this company as observed evidence.",
                    )
                )
    except Exception as exc:  # noqa: BLE001
        warning = f"BaoStock login failed: {exc.__class__.__name__}"
        warnings.append(warning)
        facts = [
            unavailable_fact(
                fact_id="BAO001",
                statement_zh="BaoStock 登录失败，未能形成 A 股市场代理事实。",
                metric_name="representative_company_market_proxy",
                source="BAOSTOCK",
                source_type=source["defaultQualityTier"],
                collector=collector_id,
                domain="stock",
                entity="core_universe",
                locator="core_universe",
                original_location="baostock-company-universe.json",
                policy_notes=configs["baostockUniverse"].get("limitations", []),
                unavailable_reason=warning,
                source_warning="BaoStock login failed; do not treat configured company universe as observed evidence.",
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
