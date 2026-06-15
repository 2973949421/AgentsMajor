from __future__ import annotations

from typing import Any

import requests

from common import confidence_for_tier, load_local_env, observation_fact, source_by_id, unavailable_fact


def _to_float(value: Any) -> float | None:
    try:
        if value in (None, "", "."):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _trend(values: list[float]) -> tuple[str, float | None]:
    if len(values) < 2:
        return "insufficient_history", None
    latest = values[-1]
    base = values[0]
    if base == 0:
        return "insufficient_history", None
    change_pct = ((latest - base) / abs(base)) * 100
    if change_pct > 3:
        return "up", round(change_pct, 2)
    if change_pct < -3:
        return "down", round(change_pct, 2)
    return "flat", round(change_pct, 2)


def collect_fred_facts(configs: dict[str, Any], *, limit: int) -> dict[str, Any]:
    env = load_local_env()
    source = source_by_id(configs["sourceRegistry"], "fred")
    confidence = confidence_for_tier(configs["policy"], source["defaultQualityTier"])
    collector_id = source["collector"]["collectorId"]
    base_url = env.get("FRED_BASE_URL", "https://api.stlouisfed.org/fred").rstrip("/")
    api_key = env.get("FRED_API_KEY")
    facts: list[dict[str, Any]] = []
    warnings: list[str] = []

    for index, series in enumerate(configs["fredSeries"]["series"], start=1):
        fact_id = f"FRED{index:03d}"
        if not api_key:
            facts.append(
                unavailable_fact(
                    fact_id=fact_id,
                    statement_zh=f"FRED 序列 {series['seriesId']}（{series['displayName']}）缺少 API key，未形成离线观测事实。",
                    metric_name=series["displayName"],
                    source="FRED",
                    source_type=source["defaultQualityTier"],
                    collector=collector_id,
                    domain="commodity",
                    entity=series["seriesId"],
                    locator=series["seriesId"],
                    original_location=f"fred-series.json:{series['seriesId']}",
                    policy_notes=configs["fredSeries"].get("limitations", []),
                    unavailable_reason="missing_fred_api_key",
                    source_warning="FRED_API_KEY was not detected in .env.local or process environment.",
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
                    "limit": limit,
                },
                timeout=20,
            )
            response.raise_for_status()
            payload = response.json()
            observations = list(reversed(payload.get("observations", [])))
            usable = [(item.get("date"), _to_float(item.get("value"))) for item in observations]
            usable = [(date, value) for date, value in usable if date and value is not None]
            if not usable:
                raise ValueError("no numeric observations returned")
            latest_date, latest_value = usable[-1]
            trend_direction, change_pct = _trend([value for _, value in usable])
            facts.append(
                observation_fact(
                    fact_id=fact_id,
                    statement_zh=(
                        f"FRED {series['displayName']} 最近观测为 {latest_value:g} {series['unit']}（{latest_date}），"
                        f"近 {len(usable)} 个有效观测趋势为 {trend_direction}。该事实只能作为全球价格代理，不能证明中国国内供需。"
                    ),
                    metric_name=series["displayName"],
                    value=latest_value,
                    unit=series["unit"],
                    period=latest_date,
                    source="FRED",
                    source_type=source["defaultQualityTier"],
                    collector=collector_id,
                    confidence=confidence,
                    domain="commodity",
                    entity=series["seriesId"],
                    locator=series["seriesId"],
                    original_location=f"fred:{series['seriesId']}:{latest_date}",
                    policy_notes=configs["fredSeries"].get("limitations", []),
                    observed_at=latest_date,
                    extra={
                        "seriesId": series["seriesId"],
                        "commodity": series.get("commodity"),
                        "lookbackObservationCount": len(usable),
                        "trendDirection": trend_direction,
                        "lookbackChangePct": change_pct,
                    },
                )
            )
        except Exception as exc:  # noqa: BLE001 - collector must isolate source failures
            warning = f"FRED series {series['seriesId']} unavailable: {exc.__class__.__name__}"
            warnings.append(warning)
            facts.append(
                unavailable_fact(
                    fact_id=fact_id,
                    statement_zh=f"FRED 序列 {series['seriesId']}（{series['displayName']}）采集失败，未形成离线观测事实。",
                    metric_name=series["displayName"],
                    source="FRED",
                    source_type=source["defaultQualityTier"],
                    collector=collector_id,
                    domain="commodity",
                    entity=series["seriesId"],
                    locator=series["seriesId"],
                    original_location=f"fred-series.json:{series['seriesId']}",
                    policy_notes=configs["fredSeries"].get("limitations", []),
                    unavailable_reason=warning,
                    source_warning="FRED collector failed; do not treat this series as observed evidence.",
                )
            )

    return {
        "sourceId": "fred",
        "collector": collector_id,
        "dataMode": "offline_observation_fact" if any(f["dataMode"] == "offline_observation_fact" for f in facts) else "unavailable_observation",
        "facts": facts,
        "warnings": warnings,
    }
