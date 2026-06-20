from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
from typing import Any


PARSER_VERSION = "finance-fact-bank-collector-v2"


CLAIM_TYPE_TO_REQUIRED_KEYS = {
    "commodity_trend": ["commodity_price_context", "commodity_price_momentum"],
    "commodity_price_momentum": ["commodity_price_momentum"],
    "commodity_price_context": ["commodity_price_context"],
    "global_price_anchor": ["commodity_price_context"],
    "valuation_vs_commodity_signal": ["commodity_price_context", "valuation_proxy"],
    "commodity_to_equity_transmission": ["equity_transmission_proxy"],
    "trade_price_consistency": ["commodity_price_context"],
    "china_supply_demand": ["china_supply_demand_proxy"],
    "inventory_pressure": ["domestic_inventory_or_spot_proxy"],
    "risk_reward": ["risk_reward_boundary"],
    "risk_reward_boundary": ["risk_reward_boundary"],
    "a_share_relative_performance": ["equity_market_reaction"],
    "market_confirmation": ["equity_market_reaction"],
    "valuation_support": ["valuation_proxy", "valuation_level"],
    "price_in_assessment": ["valuation_level"],
    "earnings_transmission_proxy": ["earnings_transmission_proxy"],
    "macro_demand_proxy": ["macro_demand_proxy"],
    "relative_allocation_signal": ["commodity_price_momentum", "portfolio_stance_evidence_mix"],
    "a_share_relative_allocation": ["equity_transmission_proxy", "portfolio_stance_evidence_mix"],
    "commodity_to_company_earnings": ["earnings_transmission_proxy"],
    "profit_sensitivity": ["earnings_transmission_proxy"],
    "company_quality_proxy": ["earnings_transmission_proxy", "risk_reward_boundary"],
    "supply_demand_proxy": ["china_supply_demand_proxy"],
    "trade_flow_signal": ["trade_flow_proxy"],
    "risk_boundary": ["risk_reward_boundary"],
    "executability": ["risk_execution_rule", "risk_reward_boundary"],
    "invalidating_condition": ["risk_reward_boundary"],
    "confidence_cap": ["declared_missing_evidence", "missing_evidence_policy"],
    "no_trade_condition": ["declared_missing_evidence"],
    "projection_limit": ["missing_evidence_policy"],
    "portfolio_allocation": ["portfolio_stance_evidence_mix"],
    "position_sizing": ["portfolio_stance_evidence_mix", "risk_reward_boundary"],
    "limited_positive_stance": ["available_positive_proxy"],
    "limited_negative_stance": ["available_positive_proxy"],
}


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def processed_finance_root() -> Path:
    return repo_root() / "data" / "materials" / "processed" / "finance"


def generated_fact_bank_root() -> Path:
    return repo_root() / "data" / "materials" / "generated" / "finance" / "fact-bank"


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


def hash8(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()[:8]


def to_float(value: Any) -> float | None:
    try:
        if value in (None, "", ".", "None", "nan", "NaN"):
            return None
        if isinstance(value, str):
            cleaned = value.strip().replace(",", "")
            if cleaned in ("", ".", "--", "-", "None", "nan", "NaN"):
                return None
            if cleaned.endswith("%"):
                cleaned = cleaned[:-1].strip()
            return float(cleaned)
        return float(value)
    except (TypeError, ValueError):
        return None


def pct_change(latest: float | None, base: float | None) -> float | None:
    if latest is None or base is None or base == 0:
        return None
    return round(((latest - base) / abs(base)) * 100, 2)


def percentile_rank(values: list[float], latest: float | None = None) -> float | None:
    clean = [value for value in values if value is not None]
    if not clean:
        return None
    target = clean[-1] if latest is None else latest
    below_or_equal = sum(1 for value in clean if value <= target)
    return round((below_or_equal / len(clean)) * 100, 2)


def annualized_volatility_from_returns(returns: list[float], periods_per_year: int = 12) -> float | None:
    clean = [value for value in returns if value is not None]
    if len(clean) < 2:
        return None
    mean = sum(clean) / len(clean)
    variance = sum((value - mean) ** 2 for value in clean) / (len(clean) - 1)
    return round((variance ** 0.5) * (periods_per_year ** 0.5), 4)


def max_drawdown_pct(values: list[float]) -> float | None:
    clean = [value for value in values if value is not None]
    if len(clean) < 2:
        return None
    peak = clean[0]
    max_drawdown = 0.0
    for value in clean:
        peak = max(peak, value)
        if peak:
            max_drawdown = min(max_drawdown, (value - peak) / abs(peak))
    return round(max_drawdown * 100, 2)


def value_n_periods_ago(values: list[float], periods: int) -> float | None:
    clean = [value for value in values if value is not None]
    if len(clean) <= periods:
        return None
    return clean[-1 - periods]


def source_label(source: str) -> str:
    return source.upper().replace("_", " ")


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


def confidence_for_tier(policy: dict[str, Any], tier: str) -> float:
    for item in policy.get("sourceTiers", []):
        if item.get("tier") == tier:
            return float(item.get("maxConfidence", 0.5))
    return 0.5


def source_by_id(source_registry: dict[str, Any], source_id: str) -> dict[str, Any]:
    for source in source_registry.get("sources", []):
        if source.get("sourceId") == source_id:
            return source
    raise ValueError(f"Missing source registry item: {source_id}")


def evidence_id(source: str, domain: str, entity: str, metric: str, period: str, locator: str, raw_hash: str) -> str:
    clean_metric = "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in metric.lower())
    return f"EVID:{source}:{domain}:{entity}:{clean_metric}:{period}:{locator}:{raw_hash}"


def required_keys_for_claim_types(claim_types: list[str] | None) -> list[str]:
    result: set[str] = set()
    for claim_type in claim_types or []:
        result.update(CLAIM_TYPE_TO_REQUIRED_KEYS.get(claim_type, []))
    return sorted(result)


def observation_fact(
    *,
    fact_id: str,
    statement_zh: str,
    metric_name: str,
    value: Any,
    unit: str,
    period: str,
    source: str,
    source_type: str,
    collector: str,
    confidence: float,
    domain: str,
    entity: str,
    locator: str,
    original_location: str,
    policy_notes: list[str],
    observed_at: str | None = None,
    extra: dict[str, Any] | None = None,
    source_publisher: str | None = None,
    access_provider: str | None = None,
    endpoint: str | None = None,
    transform: str = "raw_observation",
    reliability_tier: str | None = None,
    allowed_claim_types: list[str] | None = None,
    not_allowed_claim_types: list[str] | None = None,
    interpretation_hint: str | None = None,
    score_cap_policy: str | None = None,
    frequency: str = "unspecified",
    required_evidence_keys: list[str] | None = None,
    active_source_status: str = "active",
) -> dict[str, Any]:
    raw_hash = hash8(
        {
            "statementZh": statement_zh,
            "metricName": metric_name,
            "value": value,
            "unit": unit,
            "period": period,
            "source": source,
            "entity": entity,
            "locator": locator,
        }
    )
    fact = {
        "factId": fact_id,
        "statementZh": statement_zh,
        "metricName": metric_name,
        "value": value,
        "unit": unit,
        "period": period,
        "source": source,
        "domain": domain,
        "entity": entity,
        "locator": locator,
        "sourceType": source_type,
        "sourcePublisher": source_publisher or source,
        "accessProvider": access_provider or collector,
        "collector": collector,
        "endpoint": endpoint or original_location,
        "evidenceId": evidence_id(source, domain, entity, metric_name, period, locator, raw_hash),
        "confidence": confidence,
        "rawHash": raw_hash,
        "parserVersion": PARSER_VERSION,
        "originalLocation": original_location,
        "transform": transform,
        "reliabilityTier": reliability_tier or source_type,
        "allowedClaimTypes": allowed_claim_types or [],
        "notAllowedClaimTypes": not_allowed_claim_types or [],
        "interpretationHint": interpretation_hint or "",
        "scoreCapPolicy": score_cap_policy or "",
        "requiredEvidenceKeys": required_evidence_keys or required_keys_for_claim_types(allowed_claim_types),
        "frequency": frequency,
        "activeSourceStatus": active_source_status,
        "policyNotes": policy_notes,
        "dataMode": "offline_observation_fact",
        "observedAt": observed_at,
        "generatedAt": utc_now(),
    }
    if extra:
        fact.update(extra)
    return fact

def unavailable_fact(
    *,
    fact_id: str,
    statement_zh: str,
    metric_name: str,
    source: str,
    source_type: str,
    collector: str,
    domain: str,
    entity: str,
    locator: str,
    original_location: str,
    policy_notes: list[str],
    unavailable_reason: str,
    source_warning: str,
    source_publisher: str | None = None,
    access_provider: str | None = None,
    endpoint: str | None = None,
    transform: str = "unavailable_observation",
    reliability_tier: str | None = None,
    allowed_claim_types: list[str] | None = None,
    not_allowed_claim_types: list[str] | None = None,
    interpretation_hint: str | None = None,
    score_cap_policy: str | None = None,
    frequency: str = "unavailable",
    required_evidence_keys: list[str] | None = None,
    active_source_status: str = "active",
) -> dict[str, Any]:
    raw_hash = hash8(
        {
            "statementZh": statement_zh,
            "metricName": metric_name,
            "source": source,
            "entity": entity,
            "unavailableReason": unavailable_reason,
        }
    )
    return {
        "factId": fact_id,
        "statementZh": statement_zh,
        "metricName": metric_name,
        "value": None,
        "unit": "",
        "period": "unavailable",
        "source": source,
        "domain": domain,
        "entity": entity,
        "locator": locator,
        "sourceType": source_type,
        "sourcePublisher": source_publisher or source,
        "accessProvider": access_provider or collector,
        "collector": collector,
        "endpoint": endpoint or original_location,
        "evidenceId": evidence_id(source, domain, entity, metric_name, "unavailable", locator, raw_hash),
        "confidence": 0,
        "rawHash": raw_hash,
        "parserVersion": PARSER_VERSION,
        "originalLocation": original_location,
        "transform": transform,
        "reliabilityTier": reliability_tier or source_type,
        "allowedClaimTypes": allowed_claim_types or [],
        "notAllowedClaimTypes": not_allowed_claim_types or [],
        "interpretationHint": interpretation_hint or "",
        "scoreCapPolicy": score_cap_policy or "",
        "requiredEvidenceKeys": required_evidence_keys or required_keys_for_claim_types(allowed_claim_types),
        "frequency": frequency,
        "activeSourceStatus": active_source_status,
        "policyNotes": policy_notes,
        "dataMode": "unavailable_observation",
        "unavailableReason": unavailable_reason,
        "sourceWarning": source_warning,
        "generatedAt": utc_now(),
    }

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect Finance Major fact bank snapshots.")
    parser.add_argument("--map", default="dust2-nonferrous")
    parser.add_argument("--core-limit", type=int, default=35)
    parser.add_argument("--fred-limit", type=int, default=36)
    parser.add_argument("--comtrade-period", default=str(dt.datetime.now().year - 1))
    return parser.parse_args()


def load_common_configs(map_slug: str) -> dict[str, Any]:
    finance_root = processed_finance_root()
    map_root = finance_root / "maps" / map_slug
    return {
        "sourceRegistry": read_json(finance_root / "source-registry.json"),
        "policy": read_json(finance_root / "evidence-source-policy.json"),
        "binding": read_json(map_root / "finance-map-binding.json"),
        "fredSeries": read_json(map_root / "fred-series.json"),
        "baostockUniverse": read_json(map_root / "baostock-company-universe.json"),
        "unComtradeHsCodes": read_json(map_root / "un-comtrade-hs-codes.json"),
    }
