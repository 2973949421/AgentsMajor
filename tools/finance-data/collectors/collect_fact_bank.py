from __future__ import annotations

from typing import Any

from akshare_futures_collector import collect_akshare_futures_facts
from baostock_collector import collect_baostock_facts
from common import PARSER_VERSION, generated_fact_bank_root, load_common_configs, parse_args, read_json, utc_now, write_json
from coverage_report import build_coverage_report
from fred_collector import collect_fred_facts
from un_comtrade_collector import collect_un_comtrade_facts
from world_bank_collector import collect_world_bank_facts


def has_observed(output: dict[str, Any]) -> bool:
    return any(fact.get("dataMode") == "offline_observation_fact" for fact in output.get("facts", []))


def upgrade_legacy_fact(fact: dict[str, Any]) -> dict[str, Any]:
    source = str(fact.get("source", "")).upper()
    if source == "FRED":
        allowed = ["commodity_trend", "commodity_price_momentum", "valuation_vs_commodity_signal", "limited_positive_stance", "limited_negative_stance"]
        disallowed = ["china_supply_demand", "inventory_pressure", "company_earnings_confirmed", "a_share_relative_allocation_confirmed"]
        hint = "旧快照升级事实：可支持全球商品价格动量，不能证明国内供需或公司盈利。"
        score_cap = "legacy FRED snapshot caps domestic supply-demand and equity transmission claims unless paired with N57 facts."
        publisher = "FRED"
        provider = "FRED API"
        endpoint = "legacy_snapshot:series/observations"
    elif source == "BAOSTOCK":
        allowed = ["a_share_relative_performance", "market_confirmation", "valuation_support", "price_in_assessment", "commodity_to_equity_transmission"]
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
        "transform": fact.get("transform") or "legacy N50 snapshot upgraded to N57 field contract",
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
        "warnings": ["Current run could not refresh this source; upgraded prior snapshot facts were retained to avoid overwriting usable local evidence with unavailable placeholders."],
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
    akshare_futures = collect_akshare_futures_facts(configs)
    world_bank = collect_world_bank_facts(configs)
    un_comtrade = collect_un_comtrade_facts(configs, period=args.comtrade_period)

    source_outputs = [fred, baostock, akshare_futures, world_bank, un_comtrade]
    facts = [fact for output in source_outputs for fact in output["facts"]]
    source_status = [
        {
            "sourceId": output["sourceId"],
            "collector": output["collector"],
            "dataMode": output["dataMode"],
            "factCount": len(output["facts"]),
            "warnings": output["warnings"],
            **({"candidateOnly": output["candidateOnly"]} if output.get("candidateOnly") else {}),
        }
        for output in source_outputs
    ]

    latest = {
        "schemaVersion": 2,
        "generatedAt": generated_at,
        "parserVersion": PARSER_VERSION,
        "mapBindingId": configs["binding"]["bindingId"],
        "financeMapSlug": configs["binding"]["financeMapSlug"],
        "dataMode": "offline_fact_bank_snapshot",
        "scope": {
            "map": args.map,
            "coreUniverseLimit": args.core_limit,
            "fredObservationLimit": args.fred_limit,
            "comtradePeriod": args.comtrade_period,
        },
        "sourceStatus": source_status,
        "facts": facts,
        "policyNotes": [
            "N57 Fact Bank v2 overwrites the existing Dust2 nonferrous fact bank path; it is not a parallel library.",
            "FRED supports global metal price proxies only.",
            "BaoStock supports A-share market, valuation and liquidity proxies only.",
            "AKShare is an access provider / collector; SHFE and INE remain the source publishers for exchange facts.",
            "World Bank supports annual macro background only and is lagged.",
            "UN Comtrade is optional, lagged, and must not replace domestic inventory or spot evidence.",
        ],
    }
    coverage = build_coverage_report(map_slug=args.map, latest=latest)

    write_json(output_root / "fred-facts.json", fred)
    write_json(output_root / "baostock-facts.json", baostock)
    write_json(output_root / "shfe-facts.json", {
        **akshare_futures,
        "sourceId": "shfe",
        "facts": [fact for fact in akshare_futures["facts"] if fact.get("source") == "SHFE"],
    })
    write_json(output_root / "ine-facts.json", {
        **akshare_futures,
        "sourceId": "ine",
        "facts": [fact for fact in akshare_futures["facts"] if fact.get("source") == "INE"],
    })
    write_json(output_root / "world-bank-facts.json", world_bank)
    write_json(output_root / "un-comtrade-facts.json", un_comtrade)
    write_json(output_root / "coverage-report.json", coverage)
    write_json(output_root / "latest.json", latest)
    print(f"Generated finance fact bank v2 for {args.map}: {len(facts)} facts at {output_root}")


if __name__ == "__main__":
    main()
