from __future__ import annotations

from typing import Any

from akshare_active_collector import collect_akshare_active_facts
from baostock_collector import collect_baostock_facts
from common import PARSER_VERSION, generated_fact_bank_root, load_common_configs, parse_args, read_json, utc_now, write_json
from coverage_report import build_coverage_report
from fred_collector import collect_fred_facts


ACTIVE_SOURCE_IDS = {"FRED", "BAOSTOCK", "SHFE", "INE", "CHINA_FUTURES_SPOT", "SINA_FINANCE", "EASTMONEY", "SSE", "CHINA_MACRO_PUBLIC"}
FROZEN_SOURCES = [
    {"sourceId": "world_bank", "displayName": "World Bank", "reason": "N57c freezes World Bank from active match evidence because it is annual and lagged."},
    {"sourceId": "un_comtrade", "displayName": "UN Comtrade", "reason": "N57c freezes UN Comtrade from active match evidence; trade flow is represented as a missing evidence gap."},
    {"sourceId": "nbs", "displayName": "NBS", "reason": "Candidate official source; not active in N57c collectors."},
    {"sourceId": "usgs", "displayName": "USGS", "reason": "Candidate annual supply background; not active in N57c collectors."},
    {"sourceId": "gacc", "displayName": "China Customs", "reason": "Candidate China trade anchor; not active in N57c collectors."},
    {"sourceId": "gfex", "displayName": "GFEX", "reason": "N57b classified GFEX as candidate_only for Dust2 nonferrous v1."},
    {"sourceId": "shmet_news", "displayName": "SHMET News", "reason": "News endpoint requires manual review and cannot become active fact."},
]


def has_observed(output: dict[str, Any]) -> bool:
    return any(fact.get("dataMode") == "offline_observation_fact" for fact in output.get("facts", []))


def upgrade_legacy_fact(fact: dict[str, Any]) -> dict[str, Any]:
    source = str(fact.get("source", "")).upper()
    if source == "FRED":
        allowed = ["commodity_trend", "commodity_price_momentum", "commodity_price_context", "relative_allocation_signal", "limited_positive_stance", "limited_negative_stance"]
        disallowed = ["china_supply_demand", "inventory_pressure", "company_earnings_confirmed", "a_share_relative_allocation_confirmed"]
        hint = "旧快照升级事实：可支持全球商品价格动量，不能证明国内供需或公司盈利。"
        score_cap = "legacy FRED snapshot caps domestic supply-demand and equity transmission claims unless paired with active N57c facts."
        publisher = "FRED"
        provider = "FRED API"
        endpoint = "legacy_snapshot:series/observations"
    elif source == "BAOSTOCK":
        allowed = ["a_share_relative_performance", "a_share_relative_allocation", "market_confirmation", "valuation_support", "valuation_proxy", "valuation_level", "commodity_to_equity_transmission", "portfolio_allocation", "position_sizing"]
        disallowed = ["industry_fundamentals_confirmed", "company_earnings_confirmed", "china_supply_demand", "inventory_pressure"]
        hint = "旧快照升级事实：可支持 A 股市场反应和估值代理，不能证明行业基本面。"
        score_cap = "legacy BaoStock snapshot caps A-share allocation claims unless paired with commodity and risk facts."
        publisher = "BaoStock"
        provider = "BaoStock Python package"
        endpoint = "legacy_snapshot:query_history_k_data_plus"
    else:
        allowed = fact.get("allowedClaimTypes") or []
        disallowed = fact.get("notAllowedClaimTypes") or []
        hint = fact.get("interpretationHint") or "旧快照升级事实，按原 policyNotes 使用。"
        score_cap = fact.get("scoreCapPolicy") or "legacy snapshot fact should be treated with original policy boundaries."
        publisher = fact.get("sourcePublisher") or source
        provider = fact.get("accessProvider") or fact.get("collector")
        endpoint = fact.get("endpoint") or f"legacy_snapshot:{fact.get('originalLocation', source)}"
    return {
        **fact,
        "sourcePublisher": fact.get("sourcePublisher") or publisher,
        "accessProvider": fact.get("accessProvider") or provider,
        "endpoint": fact.get("endpoint") or endpoint,
        "domain": fact.get("domain") or "legacy",
        "entity": fact.get("entity") or fact.get("locator") or fact.get("source") or source,
        "locator": fact.get("locator") or fact.get("originalLocation") or source,
        "frequency": fact.get("frequency") or "legacy_snapshot",
        "requiredEvidenceKeys": fact.get("requiredEvidenceKeys") or [],
        "activeSourceStatus": "active",
        "transform": fact.get("transform") or "legacy N50 snapshot upgraded to N57c field contract",
        "reliabilityTier": fact.get("reliabilityTier") or fact.get("sourceType"),
        "allowedClaimTypes": fact.get("allowedClaimTypes") or allowed,
        "notAllowedClaimTypes": fact.get("notAllowedClaimTypes") or disallowed,
        "interpretationHint": fact.get("interpretationHint") or hint,
        "scoreCapPolicy": fact.get("scoreCapPolicy") or score_cap,
        "parserVersion": PARSER_VERSION,
        "legacySnapshotFallback": True,
    }


def legacy_output(previous_latest: dict[str, Any] | None, *, source_id: str, collector: str, source_values: set[str]) -> dict[str, Any] | None:
    if not previous_latest:
        return None
    facts = [
        upgrade_legacy_fact(fact)
        for fact in previous_latest.get("facts", [])
        if str(fact.get("source", "")).upper() in source_values
    ]
    observed = [fact for fact in facts if fact.get("dataMode") == "offline_observation_fact"]
    if not observed:
        return None
    return {
        "sourceId": source_id,
        "collector": collector,
        "dataMode": "offline_observation_fact",
        "facts": facts,
        "warnings": ["Current run could not refresh this source; upgraded prior active snapshot facts were retained."],
    }


def source_status_for(output: dict[str, Any]) -> dict[str, Any]:
    return {
        "sourceId": output["sourceId"],
        "collector": output["collector"],
        "sourceStatus": "active",
        "dataMode": output["dataMode"],
        "factCount": len(output["facts"]),
        "observedFactCount": sum(1 for fact in output["facts"] if fact.get("dataMode") == "offline_observation_fact"),
        "warnings": output.get("warnings", []),
        **({"candidateOnly": output["candidateOnly"]} if output.get("candidateOnly") else {}),
    }


def main() -> None:
    args = parse_args()
    configs = load_common_configs(args.map)
    generated_at = utc_now()
    output_root = generated_fact_bank_root() / args.map
    previous_latest = read_json(output_root / "latest.json") if (output_root / "latest.json").exists() else None

    fred = collect_fred_facts(configs, limit=args.fred_limit)
    if not has_observed(fred):
        fred = legacy_output(previous_latest, source_id="fred", collector="fred_http_api_v1", source_values={"FRED"}) or fred

    baostock = collect_baostock_facts(configs, core_limit=args.core_limit)
    if not has_observed(baostock):
        baostock = legacy_output(previous_latest, source_id="baostock", collector="baostock_python_package_v0", source_values={"BAOSTOCK"}) or baostock

    akshare_active = collect_akshare_active_facts(configs)
    source_outputs = [fred, baostock, akshare_active]
    facts = [fact for output in source_outputs for fact in output["facts"] if str(fact.get("source", "")).upper() in ACTIVE_SOURCE_IDS]
    for fact in facts:
        fact["activeSourceStatus"] = "active"

    source_status = [source_status_for(output) for output in source_outputs]
    frozen_source_policy = {
        "schemaVersion": 1,
        "generatedAt": generated_at,
        "financeScenarioSlug": args.map,
        "activeSourceIds": sorted(ACTIVE_SOURCE_IDS),
        "frozenSources": [{**item, "sourceStatus": "frozen"} for item in FROZEN_SOURCES],
        "policyNotes": [
            "Frozen sources are not deleted from history, but N57c excludes them from latest.json facts, coverage, and round evidence packs.",
            "World Bank and UN Comtrade must not be used as accepted active evidence in N58/N59 until explicitly reactivated.",
        ],
    }

    latest = {
        "schemaVersion": 2,
        "generatedAt": generated_at,
        "parserVersion": PARSER_VERSION,
        "mapBindingId": configs["binding"]["bindingId"],
        "financeMapSlug": configs["binding"]["financeMapSlug"],
        "dataMode": "offline_fact_bank_snapshot",
        "activeFactBankVersion": "N57c-three-source-active",
        "scope": {
            "map": args.map,
            "companyUniverseLimit": args.core_limit,
            "fredObservationLimit": args.fred_limit,
            "activeSources": sorted(ACTIVE_SOURCE_IDS),
            "frozenSourceIds": [item["sourceId"] for item in FROZEN_SOURCES],
        },
        "sourceStatus": source_status,
        "frozenSources": frozen_source_policy["frozenSources"],
        "facts": facts,
        "policyNotes": [
            "N57c overwrites the existing Dust2 nonferrous fact bank path; it is not a parallel library.",
            "Active evidence is limited to FRED, BaoStock, and AKShare-accessed public endpoints with explicit sourcePublisher.",
            "World Bank, UN Comtrade, NBS, USGS, GACC, SMM, CNINFO, GFEX and news endpoints are frozen from the active match path.",
            "AKShare is an access provider / collector; it must not appear as sourcePublisher.",
        ],
    }
    coverage = build_coverage_report(map_slug=args.map, latest=latest)

    write_json(output_root / "fred-facts.json", fred)
    write_json(output_root / "baostock-facts.json", baostock)
    write_json(output_root / "akshare-active-facts.json", akshare_active)
    write_json(output_root / "shfe-facts.json", {**akshare_active, "sourceId": "shfe", "facts": [fact for fact in akshare_active["facts"] if fact.get("source") == "SHFE"]})
    write_json(output_root / "ine-facts.json", {**akshare_active, "sourceId": "ine", "facts": [fact for fact in akshare_active["facts"] if fact.get("source") == "INE"]})
    sina_facts = [fact for fact in akshare_active["facts"] if fact.get("source") == "SINA_FINANCE"]
    write_json(output_root / "akshare-company-facts.json", {**akshare_active, "sourceId": "sina_finance", "facts": sina_facts})
    write_json(
        output_root / "company-fundamental-facts.json",
        {
            **akshare_active,
            "sourceId": "company_fundamentals_standardized",
            "facts": [
                fact
                for fact in sina_facts
                if fact.get("metricName") not in {"company_financial_abstract_table_summary", "company_profile_summary"}
            ],
        },
    )
    write_json(
        output_root / "company-profile-facts.json",
        {
            **akshare_active,
            "sourceId": "company_profiles_standardized",
            "facts": [fact for fact in sina_facts if fact.get("metricName") == "company_profile_summary"],
        },
    )
    write_json(output_root / "akshare-market-facts.json", {**akshare_active, "sourceId": "akshare_market", "facts": [fact for fact in akshare_active["facts"] if fact.get("source") in {"CHINA_FUTURES_SPOT", "EASTMONEY", "SSE"}]})
    write_json(output_root / "akshare-macro-facts.json", {**akshare_active, "sourceId": "akshare_macro", "facts": [fact for fact in akshare_active["facts"] if fact.get("source") == "CHINA_MACRO_PUBLIC"]})
    write_json(output_root / "frozen-source-policy.json", frozen_source_policy)
    write_json(output_root / "coverage-report.json", coverage)
    write_json(output_root / "latest.json", latest)
    print(f"Generated N57c active finance fact bank for {args.map}: {len(facts)} active facts at {output_root}")


if __name__ == "__main__":
    main()