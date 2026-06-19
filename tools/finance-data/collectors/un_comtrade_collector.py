from __future__ import annotations

import contextlib
import io
from typing import Any

import requests

from common import confidence_for_tier, load_local_env, observation_fact, source_by_id, unavailable_fact


TRADE_ALLOWED_CLAIMS = [
    "trade_flow_signal",
    "supply_demand_proxy",
    "trade_price_consistency",
    "limited_positive_stance",
    "limited_negative_stance",
]

TRADE_NOT_ALLOWED_CLAIMS = [
    "domestic_inventory_confirmed",
    "spot_premium_confirmed",
    "company_earnings_confirmed",
    "short_term_supply_demand_confirmed",
]


def _best_value(row: dict[str, Any], names: list[str]) -> Any:
    for name in names:
        if name in row and row[name] not in (None, ""):
            return row[name]
    return None


def _records_from_payload(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    if hasattr(data, "to_dict"):
        return data.to_dict("records")
    if isinstance(data, dict):
        records = data.get("data") or data.get("Data") or data.get("dataset") or []
        if isinstance(records, list):
            return [row for row in records if isinstance(row, dict)]
    return []


def _direct_http_query(
    *,
    key: str,
    period: str,
    flow: str,
    cmd_code: str,
    reporter_code: str,
    partner_code: str,
) -> list[dict[str, Any]]:
    response = requests.get(
        "https://comtradeapi.un.org/data/v1/get/C/A/HS",
        params={
            "cmdCode": cmd_code,
            "flowCode": flow,
            "period": period,
            "reporterCode": reporter_code,
            "partnerCode": partner_code,
            "maxRecords": 5,
            "includeDesc": "true",
        },
        headers={"Ocp-Apim-Subscription-Key": key},
        timeout=20,
    )
    response.raise_for_status()
    return _records_from_payload(response.json())


def _unavailable(
    *,
    fact_id: str,
    item: dict[str, Any],
    source: dict[str, Any],
    collector_id: str,
    configs: dict[str, Any],
    reason: str,
) -> dict[str, Any]:
    return unavailable_fact(
        fact_id=fact_id,
        statement_zh=f"UN Comtrade 未能采集 HS {item['cmdCode']}（{item['displayName']}）的可用贸易观测：{reason}。",
        metric_name="china_import_export_proxy",
        source="UN_COMTRADE",
        source_type=source["defaultQualityTier"],
        source_publisher="UN Comtrade",
        access_provider="UN Comtrade API",
        collector=collector_id,
        endpoint="getFinalData/direct_http_fallback",
        domain="trade",
        entity=item["cmdCode"],
        locator=item["cmdCode"],
        original_location=f"un-comtrade-hs-codes.json:{item['cmdCode']}",
        policy_notes=configs["unComtradeHsCodes"].get("limitations", []),
        unavailable_reason=reason,
        source_warning="UN Comtrade query returned no usable records or failed; do not treat this HS code as observed trade evidence.",
        reliability_tier=source["defaultQualityTier"],
        allowed_claim_types=TRADE_ALLOWED_CLAIMS,
        not_allowed_claim_types=TRADE_NOT_ALLOWED_CLAIMS,
        interpretation_hint="贸易流缺失时，只能形成缺口或 score cap，不能支持贸易流或供需判断。",
        score_cap_policy="missing trade flow proxy caps supply-demand and trade-flow claims.",
    )


def collect_un_comtrade_facts(configs: dict[str, Any], *, period: str) -> dict[str, Any]:
    env = load_local_env()
    source = source_by_id(configs["sourceRegistry"], "un_comtrade")
    confidence = confidence_for_tier(configs["policy"], source["defaultQualityTier"])
    collector_id = source["collector"]["collectorId"]
    key = env.get("UN_COMTRADE_KEY") or env.get("UN_COMTRADE_SECONDARY_KEY")
    facts: list[dict[str, Any]] = []
    warnings: list[str] = []

    if not key:
        facts.append(
            unavailable_fact(
                fact_id="COM001",
                statement_zh="UN Comtrade 缺少 API key，未形成进出口滞后线索事实。",
                metric_name="china_import_export_proxy",
                source="UN_COMTRADE",
                source_type=source["defaultQualityTier"],
                source_publisher="UN Comtrade",
                access_provider="UN Comtrade API",
                collector=collector_id,
                endpoint="key_presence",
                domain="trade",
                entity="configured_hs_codes",
                locator="configured_hs_codes",
                original_location="un-comtrade-hs-codes.json",
                policy_notes=configs["unComtradeHsCodes"].get("limitations", []),
                unavailable_reason="missing_un_comtrade_key",
                source_warning="UN_COMTRADE_KEY was not detected in .env.local or process environment.",
                reliability_tier=source["defaultQualityTier"],
                allowed_claim_types=TRADE_ALLOWED_CLAIMS,
                not_allowed_claim_types=TRADE_NOT_ALLOWED_CLAIMS,
                interpretation_hint="缺 key 时贸易流证据缺失。",
                score_cap_policy="missing trade flow proxy caps supply-demand and trade-flow claims.",
            )
        )
        return {
            "sourceId": "un_comtrade",
            "collector": collector_id,
            "dataMode": "unavailable_observation",
            "facts": facts,
            "warnings": ["UN Comtrade key missing."],
        }

    try:
        import comtradeapicall  # type: ignore
    except Exception as exc:  # noqa: BLE001
        comtradeapicall = None
        warnings.append(f"UN Comtrade package unavailable: {exc.__class__.__name__}: {exc}")

    query = configs["unComtradeHsCodes"]["defaultQueryShape"]
    periods = []
    for candidate in [period, "2025", "2024", "2023"]:
        if candidate and candidate not in periods:
            periods.append(str(candidate))
    flows = [query.get("flowCode", "M"), "M", "X"]
    flows = list(dict.fromkeys(str(flow) for flow in flows if flow))

    for index, item in enumerate(configs["unComtradeHsCodes"]["hsCodes"], start=1):
        fact_id = f"COM{index:03d}"
        attempts: list[str] = []
        records: list[dict[str, Any]] = []
        used_period: str | None = None
        used_flow: str | None = None
        endpoint = "getFinalData"
        for candidate_period in periods:
            for flow in flows:
                try:
                    if comtradeapicall is None:
                        raise RuntimeError("comtradeapicall package unavailable")
                    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                        data = comtradeapicall.getFinalData(
                            subscription_key=key,
                            typeCode=query.get("typeCode", "C"),
                            freqCode=query.get("freqCode", "A"),
                            clCode=query.get("classificationCode", "HS"),
                            period=candidate_period,
                            reporterCode=query.get("reporterCode", 156),
                            cmdCode=item["cmdCode"],
                            flowCode=flow,
                            partnerCode=query.get("partnerCode", 0),
                            partner2Code=None,
                            customsCode=None,
                            motCode=None,
                            maxRecords=500,
                            format_output="JSON",
                            aggregateBy=None,
                            breakdownMode="classic",
                            countOnly=None,
                            includeDesc=True,
                        )
                    records = _records_from_payload(data)
                    attempts.append(f"package:{candidate_period}:{flow}:{'records' if records else 'empty'}")
                except Exception as exc:  # noqa: BLE001
                    attempts.append(f"package:{candidate_period}:{flow}:{exc.__class__.__name__}")
                    records = []
                if not records:
                    try:
                        records = _direct_http_query(
                            key=key,
                            period=candidate_period,
                            flow=flow,
                            cmd_code=item["cmdCode"],
                            reporter_code=str(query.get("reporterCode", 156)),
                            partner_code=str(query.get("partnerCode", 0)),
                        )
                        endpoint = "direct_http:data/v1/get/C/A/HS"
                        attempts.append(f"direct:{candidate_period}:{flow}:{'records' if records else 'empty'}")
                    except Exception as exc:  # noqa: BLE001
                        attempts.append(f"direct:{candidate_period}:{flow}:{exc.__class__.__name__}")
                        records = []
                if records:
                    used_period = candidate_period
                    used_flow = flow
                    break
            if records:
                break

        if records and used_period and used_flow:
            row = records[0]
            trade_value = _best_value(row, ["primaryValue", "TradeValue", "tradeValue", "fobvalue", "cifvalue"])
            quantity = _best_value(row, ["netWgt", "NetWeight", "qty", "qtyUnitAbbr"])
            facts.append(
                observation_fact(
                    fact_id=fact_id,
                    statement_zh=(
                        f"UN Comtrade {used_period} 年 flow={used_flow} HS {item['cmdCode']}（{item['displayName']}）"
                        f"返回贸易值 {trade_value}，数量字段样本为 {quantity}。该事实是滞后贸易流代理，"
                        "不能替代国内库存、现货升贴水或公司盈利证据。"
                    ),
                    metric_name="china_import_export_proxy",
                    value=trade_value,
                    unit="reported_trade_value",
                    period=used_period,
                    source="UN_COMTRADE",
                    source_type=source["defaultQualityTier"],
                    source_publisher="UN Comtrade",
                    access_provider="UN Comtrade API",
                    collector=collector_id,
                    endpoint=endpoint,
                    confidence=confidence,
                    domain="trade",
                    entity=item["cmdCode"],
                    locator=item["cmdCode"],
                    original_location=f"un_comtrade:{item['cmdCode']}:{used_period}:{used_flow}",
                    policy_notes=configs["unComtradeHsCodes"].get("limitations", []),
                    observed_at=used_period,
                    transform="fallback by period and flow, package first then direct HTTP, first record summarized",
                    reliability_tier=source["defaultQualityTier"],
                    allowed_claim_types=TRADE_ALLOWED_CLAIMS,
                    not_allowed_claim_types=TRADE_NOT_ALLOWED_CLAIMS,
                    interpretation_hint="可支持滞后贸易流线索；不能单独证明国内供需、库存或盈利。",
                    score_cap_policy="lagged trade facts can support trade-flow claims but cap short-horizon domestic supply-demand claims.",
                    extra={
                        "cmdCode": item["cmdCode"],
                        "displayName": item["displayName"],
                        "commodity": item.get("commodity"),
                        "flowCode": used_flow,
                        "quantity": quantity,
                        "attempts": attempts[:20],
                    },
                )
            )
        else:
            reason = "; ".join(attempts[-12:]) or "no_attempts_recorded"
            warnings.append(f"UN Comtrade HS {item['cmdCode']} unavailable: {reason}")
            facts.append(_unavailable(fact_id=fact_id, item=item, source=source, collector_id=collector_id, configs=configs, reason=reason))

    return {
        "sourceId": "un_comtrade",
        "collector": collector_id,
        "dataMode": "offline_observation_fact" if any(f["dataMode"] == "offline_observation_fact" for f in facts) else "unavailable_observation",
        "facts": facts,
        "warnings": warnings,
    }
