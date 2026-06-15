from __future__ import annotations

import contextlib
import io
from typing import Any

from common import confidence_for_tier, load_local_env, observation_fact, source_by_id, unavailable_fact


def _best_value(row: dict[str, Any], names: list[str]) -> Any:
    for name in names:
        if name in row and row[name] not in (None, ""):
            return row[name]
    return None


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
                collector=collector_id,
                domain="trade",
                entity="configured_hs_codes",
                locator="configured_hs_codes",
                original_location="un-comtrade-hs-codes.json",
                policy_notes=configs["unComtradeHsCodes"].get("limitations", []),
                unavailable_reason="missing_un_comtrade_key",
                source_warning="UN_COMTRADE_KEY was not detected in .env.local or process environment.",
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
        warning = f"UN Comtrade package unavailable: {exc.__class__.__name__}"
        facts.append(
            unavailable_fact(
                fact_id="COM001",
                statement_zh="UN Comtrade Python 包不可用，未形成进出口滞后线索事实。",
                metric_name="china_import_export_proxy",
                source="UN_COMTRADE",
                source_type=source["defaultQualityTier"],
                collector=collector_id,
                domain="trade",
                entity="configured_hs_codes",
                locator="configured_hs_codes",
                original_location="un-comtrade-hs-codes.json",
                policy_notes=configs["unComtradeHsCodes"].get("limitations", []),
                unavailable_reason=warning,
                source_warning="UN Comtrade collector package unavailable.",
            )
        )
        return {
            "sourceId": "un_comtrade",
            "collector": collector_id,
            "dataMode": "unavailable_observation",
            "facts": facts,
            "warnings": [warning],
        }

    query = configs["unComtradeHsCodes"]["defaultQueryShape"]
    for index, item in enumerate(configs["unComtradeHsCodes"]["hsCodes"], start=1):
        fact_id = f"COM{index:03d}"
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                data = comtradeapicall.getFinalData(
                    subscription_key=key,
                    typeCode=query.get("typeCode", "C"),
                    freqCode=query.get("freqCode", "A"),
                    clCode=query.get("classificationCode", "HS"),
                    period=period,
                    reporterCode=query.get("reporterCode", 156),
                    cmdCode=item["cmdCode"],
                    flowCode=query.get("flowCode", "M"),
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
            records = data if isinstance(data, list) else data.to_dict("records") if hasattr(data, "to_dict") else []
            if not records:
                raise ValueError("no records returned")
            row = records[0]
            trade_value = _best_value(row, ["primaryValue", "TradeValue", "tradeValue", "fobvalue"])
            quantity = _best_value(row, ["netWgt", "NetWeight", "qty", "qtyUnitAbbr"])
            facts.append(
                observation_fact(
                    fact_id=fact_id,
                    statement_zh=(
                        f"UN Comtrade {period} 年 HS {item['cmdCode']}（{item['displayName']}）"
                        f"返回贸易值 {trade_value}，可作为滞后进出口代理线索，不能替代国内库存或现货证据。"
                    ),
                    metric_name="china_import_export_proxy",
                    value=trade_value,
                    unit="reported_trade_value",
                    period=period,
                    source="UN_COMTRADE",
                    source_type=source["defaultQualityTier"],
                    collector=collector_id,
                    confidence=confidence,
                    domain="trade",
                    entity=item["cmdCode"],
                    locator=item["cmdCode"],
                    original_location=f"un_comtrade:{item['cmdCode']}:{period}",
                    policy_notes=configs["unComtradeHsCodes"].get("limitations", []),
                    observed_at=period,
                    extra={
                        "cmdCode": item["cmdCode"],
                        "displayName": item["displayName"],
                        "commodity": item.get("commodity"),
                        "quantity": quantity,
                    },
                )
            )
        except Exception as exc:  # noqa: BLE001
            warning = f"UN Comtrade HS {item['cmdCode']} unavailable: {exc.__class__.__name__}"
            warnings.append(warning)
            facts.append(
                unavailable_fact(
                    fact_id=fact_id,
                    statement_zh=f"UN Comtrade 未能采集 HS {item['cmdCode']}（{item['displayName']}）的可用观测。",
                    metric_name="china_import_export_proxy",
                    source="UN_COMTRADE",
                    source_type=source["defaultQualityTier"],
                    collector=collector_id,
                    domain="trade",
                    entity=item["cmdCode"],
                    locator=item["cmdCode"],
                    original_location=f"un-comtrade-hs-codes.json:{item['cmdCode']}",
                    policy_notes=configs["unComtradeHsCodes"].get("limitations", []),
                    unavailable_reason=warning,
                    source_warning="UN Comtrade query failed; do not treat this HS code as observed evidence.",
                )
            )

    return {
        "sourceId": "un_comtrade",
        "collector": collector_id,
        "dataMode": "offline_observation_fact" if any(f["dataMode"] == "offline_observation_fact" for f in facts) else "unavailable_observation",
        "facts": facts,
        "warnings": warnings,
    }
