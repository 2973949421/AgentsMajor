from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
from typing import Any


PARSER_VERSION = "finance-fact-bank-collector-v1"


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
        "sourceType": source_type,
        "collector": collector,
        "evidenceId": evidence_id(source, domain, entity, metric_name, period, locator, raw_hash),
        "confidence": confidence,
        "rawHash": raw_hash,
        "parserVersion": PARSER_VERSION,
        "originalLocation": original_location,
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
        "sourceType": source_type,
        "collector": collector,
        "evidenceId": evidence_id(source, domain, entity, metric_name, "unavailable", locator, raw_hash),
        "confidence": 0,
        "rawHash": raw_hash,
        "parserVersion": PARSER_VERSION,
        "originalLocation": original_location,
        "policyNotes": policy_notes,
        "dataMode": "unavailable_observation",
        "unavailableReason": unavailable_reason,
        "sourceWarning": source_warning,
        "generatedAt": utc_now(),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect Finance Major fact bank snapshots.")
    parser.add_argument("--map", default="dust2-nonferrous")
    parser.add_argument("--core-limit", type=int, default=5)
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
