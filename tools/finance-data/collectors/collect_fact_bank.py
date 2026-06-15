from __future__ import annotations

from typing import Any

from baostock_collector import collect_baostock_facts
from common import PARSER_VERSION, generated_fact_bank_root, load_common_configs, parse_args, utc_now, write_json
from fred_collector import collect_fred_facts
from un_comtrade_collector import collect_un_comtrade_facts


def akshare_status() -> dict[str, Any]:
    return {
        "sourceId": "akshare",
        "collector": "akshare_python_package_v0",
        "dataMode": "registered_collector_not_used",
        "facts": [],
        "warnings": [
            "AKShare is registered as a collector candidate only. It is not used as a final fact source in N50."
        ],
    }


def main() -> None:
    args = parse_args()
    configs = load_common_configs(args.map)
    generated_at = utc_now()

    fred = collect_fred_facts(configs, limit=args.fred_limit)
    baostock = collect_baostock_facts(configs, core_limit=args.core_limit)
    un_comtrade = collect_un_comtrade_facts(configs, period=args.comtrade_period)
    akshare = akshare_status()

    source_outputs = [fred, baostock, un_comtrade, akshare]
    facts = [fact for output in source_outputs for fact in output["facts"]]
    source_status = [
        {
            "sourceId": output["sourceId"],
            "collector": output["collector"],
            "dataMode": output["dataMode"],
            "factCount": len(output["facts"]),
            "warnings": output["warnings"],
        }
        for output in source_outputs
    ]

    latest = {
        "schemaVersion": 1,
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
            "N50 fact bank is a low-frequency audit snapshot, not a high-frequency market data system.",
            "FRED supports global metal price proxies only.",
            "BaoStock supports A-share market and valuation proxies only.",
            "UN Comtrade is optional and lagged.",
            "AKShare is registered but not used as a final source.",
        ],
    }

    output_root = generated_fact_bank_root() / args.map
    write_json(output_root / "fred-facts.json", fred)
    write_json(output_root / "baostock-facts.json", baostock)
    write_json(output_root / "un-comtrade-facts.json", un_comtrade)
    write_json(output_root / "latest.json", latest)
    print(f"Generated finance fact bank for {args.map}: {len(facts)} facts at {output_root}")


if __name__ == "__main__":
    main()
