from __future__ import annotations

from typing import Any

from common import processed_finance_root, read_json, utc_now


SOURCE_ALIASES = {
    "FRED": {"FRED"},
    "BaoStock": {"BAOSTOCK"},
    "BAOSTOCK": {"BAOSTOCK"},
    "UN_COMTRADE": {"UN_COMTRADE"},
    "SHFE": {"SHFE"},
    "INE": {"INE"},
    "WorldBank": {"WORLD_BANK"},
    "WORLD_BANK": {"WORLD_BANK"},
    "World Bank": {"WORLD_BANK"},
    "company_financials": {"SINA_FINANCE", "BAOSTOCK"},
    "CNINFO": {"SINA_FINANCE"},
    "ChinaCustoms": {"UN_COMTRADE"},
    "NBS": {"CHINA_MACRO_PUBLIC"},
    "marketRiskProxy": {"BAOSTOCK", "SHFE", "INE", "EASTMONEY", "SSE", "CHINA_FUTURES_SPOT"},
    "scoreCapPolicy": {"BAOSTOCK", "SHFE", "INE", "EASTMONEY", "SSE", "CHINA_FUTURES_SPOT"},
    "riskPolicy": {"BAOSTOCK", "SHFE", "INE", "EASTMONEY", "SSE", "CHINA_FUTURES_SPOT"},
    "configured_proxy_fact": {"CONFIGURED_PROXY"},
    "unavailable_observation": {"UNAVAILABLE"},
    "missingEvidence": {"MISSING"},
    "requiredEvidenceSchema": {"SCHEMA"},
    "judgeLedger": {"JUDGE_LEDGER"},
}


def _source_set(source_names: list[str]) -> set[str]:
    result: set[str] = set()
    for name in source_names:
        result.update(SOURCE_ALIASES.get(name, {name.upper()}))
    return result


def _fact_source(fact: dict[str, Any]) -> str:
    return str(fact.get("source") or fact.get("sourcePublisher") or "").upper()


def _claim_overlap(fact: dict[str, Any], claim_types: list[str]) -> bool:
    allowed = set(fact.get("allowedClaimTypes") or [])
    if not allowed:
        return True
    return bool(allowed.intersection(claim_types))


REQUIRED_KEY_ALIASES = {
    "commodity_context": {"commodity_context", "commodity_price_context"},
    "commodity_price_context": {"commodity_price_context", "commodity_context"},
}


def _required_key_overlap(fact: dict[str, Any], required_key: str | None) -> bool:
    keys = set(fact.get("requiredEvidenceKeys") or [])
    if not required_key or not keys:
        return True
    aliases = REQUIRED_KEY_ALIASES.get(required_key, {required_key})
    return bool(keys.intersection(aliases))


def _observed_facts(facts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        fact
        for fact in facts
        if fact.get("dataMode") == "offline_observation_fact"
        and fact.get("activeSourceStatus", "active") == "active"
        and _fact_source(fact) not in {"WORLD_BANK", "UN_COMTRADE"}
    ]


def build_coverage_report(*, map_slug: str, latest: dict[str, Any]) -> dict[str, Any]:
    topics = read_json(processed_finance_root() / "maps" / map_slug / "round-topics.json")
    observed = _observed_facts(latest.get("facts", []))
    items: list[dict[str, Any]] = []
    for round_item in topics.get("rounds", []):
        for schema_item in round_item.get("requiredEvidenceSchema", []):
            preferred_sources = _source_set(schema_item.get("preferredSources", []))
            fallback_sources = _source_set(schema_item.get("fallbackSources", []))
            claim_types = schema_item.get("requiredForClaimTypes", [])
            required_key = schema_item.get("requiredKey")
            preferred_matches = [
                fact
                for fact in observed
                if _fact_source(fact) in preferred_sources and _required_key_overlap(fact, required_key) and _claim_overlap(fact, claim_types)
            ]
            fallback_matches = [
                fact
                for fact in observed
                if _fact_source(fact) in fallback_sources and _required_key_overlap(fact, required_key) and _claim_overlap(fact, claim_types)
            ]
            minimum = int(schema_item.get("minimumFactCount", 1))
            matched = preferred_matches if len(preferred_matches) >= minimum else preferred_matches + fallback_matches
            if len(preferred_matches) >= minimum:
                status = "covered"
            elif matched:
                status = "partial"
            else:
                status = "missing"
            items.append(
                {
                    "roundNumber": round_item.get("roundNumber"),
                    "roundKey": round_item.get("roundKey"),
                    "decisionQuestion": round_item.get("decisionQuestion"),
                    "requiredEvidenceKey": schema_item.get("requiredKey"),
                    "requiredForClaimTypes": claim_types,
                    "minimumFactCount": minimum,
                    "preferredSources": schema_item.get("preferredSources", []),
                    "fallbackSources": schema_item.get("fallbackSources", []),
                    "matchedFactIds": [fact.get("factId") for fact in matched],
                    "activeSourcePublishers": sorted({str(fact.get("sourcePublisher") or fact.get("source") or "") for fact in matched}),
                    "matchedEvidenceIds": [fact.get("evidenceId") for fact in matched],
                    "coverageStatus": status,
                    "supportedClaimTypes": sorted({claim for fact in matched for claim in fact.get("allowedClaimTypes", []) if claim in claim_types or not claim_types}),
                    "remainingGaps": [] if status == "covered" else [schema_item.get("missingEffect")],
                    "scoreCapPolicy": schema_item.get("missingEffect"),
                    "notWinCondition": schema_item.get("notWinCondition") is True,
                    "frozenSourcesExcluded": ["WORLD_BANK", "UN_COMTRADE"],
                }
            )
    summary = {
        "totalRequiredEvidenceItems": len(items),
        "covered": sum(1 for item in items if item["coverageStatus"] == "covered"),
        "partial": sum(1 for item in items if item["coverageStatus"] == "partial"),
        "missing": sum(1 for item in items if item["coverageStatus"] == "missing"),
    }
    return {
        "schemaVersion": 1,
        "generatedAt": utc_now(),
        "financeScenarioSlug": map_slug,
        "factBankParserVersion": latest.get("parserVersion"),
        "summary": summary,
        "coverageItems": items,
    }
