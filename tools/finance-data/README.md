# Finance data tools

This directory contains low-frequency finance data collectors for the Finance Major prototype.

Rules:

- Read secrets only from `AgentsMajor/.env.local` or the current process environment.
- Never print API keys, token previews, or full raw API responses.
- Write only small normalized fact bank snapshots under `data/materials/generated/finance/fact-bank/`.
- Treat Python packages and HTTP clients as access providers / collectors. Data can be used when the source publisher, endpoint, fields, date, and transform are recorded.

Generate / overwrite the Dust2 nonferrous Fact Bank v2:

```powershell
..\.venv\Scripts\python.exe tools\finance-data\collectors\collect_fact_bank.py --map dust2-nonferrous
```

Primary output stays on the existing fact bank path:

```text
data/materials/generated/finance/fact-bank/dust2-nonferrous/latest.json
```

N57 does not create a parallel `fact-bank-v2` library. Split files in the same directory are components of the same snapshot.

Validate generated finance materials:

```powershell
node data/materials/scripts/validate-finance-evidence.mjs --map dust2-nonferrous --fact-bank
```

Probe N57 candidate data sources before generating Fact Bank v2:

```powershell
..\.venv\Scripts\python.exe tools\finance-data\probes\probe_finance_sources.py --map dust2-nonferrous
node data/materials/scripts/validate-finance-evidence.mjs --map dust2-nonferrous --source-probes
```

Probe outputs:

```text
data/materials/generated/finance/source-probes/dust2-nonferrous/source-probe-report.json
docs/finance/n57-data-source-probe-report.md
```

Current collector scope:

- FRED: global metal price derived facts.
- BaoStock: A-share company market, valuation, liquidity, and relative benchmark proxies.
- AKShare: access provider for SHFE / INE futures data when endpoint-level provenance is clear.
- World Bank: public annual macro background proxy.
- UN Comtrade: lagged trade-flow proxy with period / flow / direct HTTP fallback.

N57 pre-probe scope:

- AKShare can aggressively probe SHFE / INE / GFEX. Its data is usable when publisher, endpoint, fields, dates, and transforms are recorded.
- World Bank uses the public API without a user-provided key and is only a lagged macro proxy.
- UN Comtrade must be diagnosed by year, flow, HS code, package path, and HTTP fallback.
- Probe reports are not Fact Bank v2 and must not be fed directly to agents.

After generating Fact Bank v2, regenerate round evidence packs:

```powershell
node data/materials/scripts/generate-finance-evidence.mjs --map dust2-nonferrous
node data/materials/scripts/validate-finance-evidence.mjs --map dust2-nonferrous --fact-bank
node data/materials/scripts/validate-finance-evidence.mjs --map dust2-nonferrous
```
