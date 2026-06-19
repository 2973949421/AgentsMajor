from __future__ import annotations

from typing import Any

import requests

from common import confidence_for_tier, observation_fact, pct_change, source_by_id, to_float, unavailable_fact


WORLD_BANK_INDICATORS = {
    "NV.IND.TOTL.KD.ZG": {
        "label": "China industry value added growth",
        "metric": "macro_industry_growth_proxy",
        "requiredKeys": ["macro_demand_proxy", "global_cycle_signal"],
    },
    "NV.IND.MANF.KD.ZG": {
        "label": "China manufacturing value added growth",
        "metric": "macro_manufacturing_growth_proxy",
        "requiredKeys": ["macro_demand_proxy"],
    },
    "NE.GDI.FTOT.KD.ZG": {
        "label": "China gross fixed capital formation growth",
        "metric": "macro_fixed_investment_growth_proxy",
        "requiredKeys": ["macro_demand_proxy"],
    },
    "NY.GDP.MKTP.KD.ZG": {
        "label": "China GDP growth",
        "metric": "macro_gdp_growth_proxy",
        "requiredKeys": ["global_cycle_signal"],
    },
    "TX.VAL.MRCH.CD.WT": {
        "label": "China merchandise exports",
        "metric": "macro_trade_export_proxy",
        "requiredKeys": ["trade_flow_proxy", "global_cycle_signal"],
    },
    "TM.VAL.MRCH.CD.WT": {
        "label": "China merchandise imports",
        "metric": "macro_trade_import_proxy",
        "requiredKeys": ["trade_flow_proxy", "global_cycle_signal"],
    },
}

MACRO_ALLOWED_CLAIMS = [
    "macro_demand",
    "macro_demand_proxy",
    "global_cycle_signal",
    "horizon_context",
    "risk_reward",
]

MACRO_NOT_ALLOWED_CLAIMS = [
    "short_term_china_spot_supply_demand",
    "inventory_pressure_confirmed",
    "company_earnings_confirmed",
    "a_share_relative_allocation_confirmed",
]


def _unavailable(
    *,
    fact_id: str,
    source: dict[str, Any],
    collector_id: str,
    indicator: str,
    config: dict[str, Any],
    reason: str,
) -> dict[str, Any]:
    return unavailable_fact(
        fact_id=fact_id,
        statement_zh=f"World Bank 指标 {indicator}（{config['label']}）未形成年度宏观背景事实：{reason}。",
        metric_name=config["metric"],
        source="WORLD_BANK",
        source_type=source["defaultQualityTier"],
        source_publisher="World Bank",
        access_provider="World Bank Indicators API",
        collector=collector_id,
        endpoint=f"country/CHN/indicator/{indicator}",
        domain="macro",
        entity=indicator,
        locator=indicator,
        original_location=f"world_bank:{indicator}",
        policy_notes=source.get("limitations", []),
        unavailable_reason=reason,
        source_warning="World Bank indicator unavailable; do not treat this macro proxy as observed evidence.",
        reliability_tier=source["defaultQualityTier"],
        allowed_claim_types=MACRO_ALLOWED_CLAIMS,
        not_allowed_claim_types=MACRO_NOT_ALLOWED_CLAIMS,
        interpretation_hint="World Bank 指标缺失时，宏观背景或全球周期判断必须降权。",
        score_cap_policy="missing annual macro background caps macro demand and global cycle claims.",
    )


def collect_world_bank_facts(configs: dict[str, Any]) -> dict[str, Any]:
    source = source_by_id(configs["sourceRegistry"], "world_bank")
    confidence = confidence_for_tier(configs["policy"], source["defaultQualityTier"])
    collector_id = source["collector"]["collectorId"]
    facts: list[dict[str, Any]] = []
    warnings: list[str] = []
    base_url = "https://api.worldbank.org/v2"

    for index, (indicator, config) in enumerate(WORLD_BANK_INDICATORS.items(), start=1):
        fact_id = f"WB{index:03d}"
        try:
            response = requests.get(
                f"{base_url}/country/CHN/indicator/{indicator}",
                params={"format": "json", "date": "2016:2026", "per_page": 1000},
                timeout=20,
            )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, list) or len(payload) < 2:
                raise ValueError("unexpected World Bank payload shape")
            rows = [row for row in payload[1] if row.get("value") is not None]
            rows.sort(key=lambda row: str(row.get("date")))
            if not rows:
                raise ValueError("no non-null values returned")
            latest = rows[-1]
            previous = rows[-2] if len(rows) >= 2 else None
            latest_value = to_float(latest.get("value"))
            previous_value = to_float(previous.get("value")) if previous else None
            if latest_value is None:
                raise ValueError("latest value is not numeric")
            yoy_delta = round(latest_value - previous_value, 2) if previous_value is not None and config["metric"].endswith("_growth_proxy") else pct_change(latest_value, previous_value)
            facts.append(
                observation_fact(
                    fact_id=fact_id,
                    statement_zh=(
                        f"World Bank {config['label']} 最近可用年度观测为 {latest_value:g}（{latest.get('date')}），"
                        f"较上一可用年度变化为 {yoy_delta}。该事实只能作为年度宏观背景和长周期需求代理，"
                        "不能证明 1-3 个月国内有色供需、库存或公司盈利。"
                    ),
                    metric_name=config["metric"],
                    value=latest_value,
                    unit=str(latest.get("unit") or "reported_indicator_value"),
                    period=str(latest.get("date")),
                    source="WORLD_BANK",
                    source_type=source["defaultQualityTier"],
                    source_publisher="World Bank",
                    access_provider="World Bank Indicators API",
                    collector=collector_id,
                    endpoint=f"country/CHN/indicator/{indicator}",
                    confidence=confidence,
                    domain="macro",
                    entity=indicator,
                    locator=indicator,
                    original_location=f"world_bank:{indicator}:{latest.get('date')}",
                    policy_notes=source.get("limitations", []),
                    observed_at=str(latest.get("date")),
                    transform="latest annual indicator value and previous-period change from World Bank public API",
                    reliability_tier=source["defaultQualityTier"],
                    allowed_claim_types=MACRO_ALLOWED_CLAIMS,
                    not_allowed_claim_types=MACRO_NOT_ALLOWED_CLAIMS,
                    interpretation_hint="可支持宏观背景、需求代理和周期语境；不可支持短周期国内供需强结论。",
                    score_cap_policy="World Bank annual macro facts can support background only and cap short-horizon supply-demand claims.",
                    extra={
                        "indicator": indicator,
                        "indicatorLabel": config["label"],
                        "previousValue": previous_value,
                        "previousPeriod": previous.get("date") if previous else None,
                        "deltaVsPrevious": yoy_delta,
                        "requiredEvidenceKeys": config["requiredKeys"],
                    },
                )
            )
        except Exception as exc:  # noqa: BLE001
            warning = f"World Bank indicator {indicator} unavailable: {exc.__class__.__name__}: {exc}"
            warnings.append(warning)
            facts.append(_unavailable(fact_id=fact_id, source=source, collector_id=collector_id, indicator=indicator, config=config, reason=warning))

    return {
        "sourceId": "world_bank",
        "collector": collector_id,
        "dataMode": "offline_observation_fact" if any(f["dataMode"] == "offline_observation_fact" for f in facts) else "unavailable_observation",
        "facts": facts,
        "warnings": warnings,
    }
