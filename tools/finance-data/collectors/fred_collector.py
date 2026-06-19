from __future__ import annotations

from typing import Any

import requests

from common import (
    annualized_volatility_from_returns,
    confidence_for_tier,
    load_local_env,
    max_drawdown_pct,
    observation_fact,
    pct_change,
    percentile_rank,
    source_by_id,
    to_float,
    unavailable_fact,
    value_n_periods_ago,
)


PRICE_ALLOWED_CLAIMS = [
    "commodity_trend",
    "commodity_price_momentum",
    "valuation_vs_commodity_signal",
    "limited_positive_stance",
    "limited_negative_stance",
]

PRICE_NOT_ALLOWED_CLAIMS = [
    "china_supply_demand",
    "inventory_pressure",
    "company_earnings_confirmed",
    "a_share_relative_allocation_confirmed",
]


def _monthly_returns(values: list[float]) -> list[float]:
    returns: list[float] = []
    for index in range(1, len(values)):
        change = pct_change(values[index], values[index - 1])
        if change is not None:
            returns.append(change / 100)
    return returns


def _window_changes(values: list[float]) -> dict[str, float | None]:
    latest = values[-1] if values else None
    return {
        "change1mPct": pct_change(latest, value_n_periods_ago(values, 1)),
        "change3mPct": pct_change(latest, value_n_periods_ago(values, 3)),
        "change6mPct": pct_change(latest, value_n_periods_ago(values, 6)),
        "change12mPct": pct_change(latest, value_n_periods_ago(values, 12)),
    }


def _trend_label(change_3m: float | None) -> str:
    if change_3m is None:
        return "history_insufficient"
    if change_3m > 3:
        return "up"
    if change_3m < -3:
        return "down"
    return "flat"


def _unavailable(
    *,
    fact_id: str,
    series: dict[str, Any],
    source: dict[str, Any],
    collector_id: str,
    configs: dict[str, Any],
    reason: str,
    warning: str,
) -> dict[str, Any]:
    return unavailable_fact(
        fact_id=fact_id,
        statement_zh=f"FRED 序列 {series['seriesId']}（{series['displayName']}）未形成可用派生事实：{reason}。",
        metric_name="commodity_price_momentum_derived",
        source="FRED",
        source_type=source["defaultQualityTier"],
        source_publisher="FRED",
        access_provider="FRED API",
        collector=collector_id,
        endpoint="series/observations",
        domain="commodity",
        entity=series["seriesId"],
        locator=series["seriesId"],
        original_location=f"fred-series.json:{series['seriesId']}",
        policy_notes=configs["fredSeries"].get("limitations", []),
        unavailable_reason=reason,
        source_warning=warning,
        reliability_tier=source["defaultQualityTier"],
        allowed_claim_types=PRICE_ALLOWED_CLAIMS,
        not_allowed_claim_types=PRICE_NOT_ALLOWED_CLAIMS,
        interpretation_hint="FRED 缺失时不能用该金属价格支持商品动量或配置方向。",
        score_cap_policy="missing commodity price momentum caps related stance claims.",
    )


def collect_fred_facts(configs: dict[str, Any], *, limit: int) -> dict[str, Any]:
    env = load_local_env()
    source = source_by_id(configs["sourceRegistry"], "fred")
    confidence = confidence_for_tier(configs["policy"], source["defaultQualityTier"])
    collector_id = source["collector"]["collectorId"]
    base_url = env.get("FRED_BASE_URL", "https://api.stlouisfed.org/fred").rstrip("/")
    api_key = env.get("FRED_API_KEY")
    facts: list[dict[str, Any]] = []
    warnings: list[str] = []
    observed_series: list[dict[str, Any]] = []
    fetch_limit = max(limit, 48)

    for index, series in enumerate(configs["fredSeries"]["series"], start=1):
        fact_id = f"FRED{index:03d}"
        if not api_key:
            facts.append(
                _unavailable(
                    fact_id=fact_id,
                    series=series,
                    source=source,
                    collector_id=collector_id,
                    configs=configs,
                    reason="missing_fred_api_key",
                    warning="FRED_API_KEY was not detected in .env.local or process environment.",
                )
            )
            continue

        try:
            response = requests.get(
                f"{base_url}/series/observations",
                params={
                    "series_id": series["seriesId"],
                    "api_key": api_key,
                    "file_type": "json",
                    "sort_order": "desc",
                    "limit": fetch_limit,
                },
                timeout=20,
            )
            response.raise_for_status()
            payload = response.json()
            observations = list(reversed(payload.get("observations", [])))
            usable = [(item.get("date"), to_float(item.get("value"))) for item in observations]
            usable = [(date, value) for date, value in usable if date and value is not None]
            if len(usable) < 13:
                raise ValueError("fewer than 13 numeric observations returned")

            dates = [date for date, _ in usable]
            values = [float(value) for _, value in usable]
            latest_date = dates[-1]
            latest_value = values[-1]
            changes = _window_changes(values)
            trend_direction = _trend_label(changes["change3mPct"])
            percentile_36m = percentile_rank(values[-36:])
            volatility = annualized_volatility_from_returns(_monthly_returns(values[-36:]), periods_per_year=12)
            max_drawdown = max_drawdown_pct(values[-36:])
            observed_series.append(
                {
                    "seriesId": series["seriesId"],
                    "commodity": series.get("commodity"),
                    "latestDate": latest_date,
                    "latestValue": latest_value,
                    **changes,
                }
            )

            facts.append(
                observation_fact(
                    fact_id=fact_id,
                    statement_zh=(
                        f"FRED {series['displayName']} 最近观测为 {latest_value:g} {series['unit']}（{latest_date}）；"
                        f"1/3/6/12个月变化分别为 {changes['change1mPct']}%、{changes['change3mPct']}%、"
                        f"{changes['change6mPct']}%、{changes['change12mPct']}%，36个月分位约 {percentile_36m}，"
                        f"36个月年化波动约 {volatility}，最大回撤约 {max_drawdown}%。"
                        "该事实只能作为全球商品价格动量代理，不能证明中国国内库存、现货升贴水或公司盈利。"
                    ),
                    metric_name="commodity_price_momentum_derived",
                    value=latest_value,
                    unit=series["unit"],
                    period=f"{dates[0]}..{latest_date}",
                    source="FRED",
                    source_type=source["defaultQualityTier"],
                    source_publisher="FRED",
                    access_provider="FRED API",
                    collector=collector_id,
                    endpoint="series/observations",
                    confidence=confidence,
                    domain="commodity",
                    entity=series["seriesId"],
                    locator=series["seriesId"],
                    original_location=f"fred:{series['seriesId']}:{latest_date}",
                    policy_notes=configs["fredSeries"].get("limitations", []),
                    observed_at=latest_date,
                    transform="latest value plus 1/3/6/12 month percent changes, 36 month percentile, volatility, max drawdown",
                    reliability_tier=source["defaultQualityTier"],
                    allowed_claim_types=PRICE_ALLOWED_CLAIMS,
                    not_allowed_claim_types=PRICE_NOT_ALLOWED_CLAIMS,
                    interpretation_hint="可支持商品价格动量和商品背景，不可直接支持中国国内供需或公司盈利确认。",
                    score_cap_policy="FRED commodity facts can support price momentum claims but cap China supply-demand and equity transmission claims unless paired with domestic or equity facts.",
                    extra={
                        "seriesId": series["seriesId"],
                        "commodity": series.get("commodity"),
                        "lookbackObservationCount": len(usable),
                        "trendDirection": trend_direction,
                        **changes,
                        "percentile36m": percentile_36m,
                        "annualizedVolatility36m": volatility,
                        "maxDrawdown36mPct": max_drawdown,
                    },
                )
            )
        except Exception as exc:  # noqa: BLE001 - collector must isolate source failures
            warning = f"FRED series {series['seriesId']} unavailable: {exc.__class__.__name__}: {exc}"
            warnings.append(warning)
            facts.append(
                _unavailable(
                    fact_id=fact_id,
                    series=series,
                    source=source,
                    collector_id=collector_id,
                    configs=configs,
                    reason=warning,
                    warning="FRED collector failed; do not treat this series as observed evidence.",
                )
            )

    if observed_series:
        up_count = sum(1 for item in observed_series if (item.get("change3mPct") or 0) > 3)
        down_count = sum(1 for item in observed_series if (item.get("change3mPct") or 0) < -3)
        if up_count >= max(2, len(observed_series) // 2):
            sync_label = "multi_metal_upward_sync"
            statement = f"{up_count}/{len(observed_series)} 个 FRED 有色金属价格 3 个月变化超过 3%，显示多金属上行动量同步。"
        elif down_count >= max(2, len(observed_series) // 2):
            sync_label = "multi_metal_downward_sync"
            statement = f"{down_count}/{len(observed_series)} 个 FRED 有色金属价格 3 个月变化低于 -3%，显示多金属下行动量同步。"
        else:
            sync_label = "multi_metal_divergence"
            statement = "FRED 有色金属 3 个月变化方向分化，不能支持全有色一致景气判断。"
        facts.append(
            observation_fact(
                fact_id="FRED999",
                statement_zh=f"{statement} 该事实只能作为全球商品价格同步或背离代理，不能证明中国国内供需。",
                metric_name="multi_metal_price_sync_divergence",
                value=up_count - down_count,
                unit="series_count_net",
                period=";".join(sorted({item["latestDate"] for item in observed_series})),
                source="FRED",
                source_type=source["defaultQualityTier"],
                source_publisher="FRED",
                access_provider="FRED API",
                collector=collector_id,
                endpoint="series/observations",
                confidence=confidence,
                domain="commodity",
                entity="multi_metal",
                locator="fred_multi_metal",
                original_location="fred-series.json:multi_metal",
                policy_notes=configs["fredSeries"].get("limitations", []),
                observed_at=max(item["latestDate"] for item in observed_series),
                transform="count 3 month positive/negative changes across configured FRED metal series",
                reliability_tier=source["defaultQualityTier"],
                allowed_claim_types=["commodity_trend", "relative_allocation_signal", "limited_positive_stance", "limited_negative_stance"],
                not_allowed_claim_types=PRICE_NOT_ALLOWED_CLAIMS,
                interpretation_hint="多金属同步可增强商品背景；方向分化时只能支持结构性判断。",
                score_cap_policy="multi metal divergence caps broad nonferrous allocation claims.",
                extra={
                    "syncLabel": sync_label,
                    "observedSeries": observed_series,
                    "upCount3m": up_count,
                    "downCount3m": down_count,
                },
            )
        )

    return {
        "sourceId": "fred",
        "collector": collector_id,
        "dataMode": "offline_observation_fact" if any(f["dataMode"] == "offline_observation_fact" for f in facts) else "unavailable_observation",
        "facts": facts,
        "warnings": warnings,
    }
