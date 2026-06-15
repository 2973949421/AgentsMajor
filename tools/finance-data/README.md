# Finance data tools

This directory contains low-frequency finance data collectors for the Finance Major prototype.

Rules:

- Read secrets only from `AgentsMajor/.env.local` or the current process environment.
- Never print API keys, token previews, or full raw API responses.
- Write only small normalized fact bank snapshots under `data/materials/generated/finance/fact-bank/`.
- Treat collector packages as collectors, not final sources.

Generate the Dust2 nonferrous fact bank:

```powershell
..\.venv\Scripts\python.exe tools\finance-data\collectors\collect_fact_bank.py --map dust2-nonferrous
```

Validate generated finance materials:

```powershell
node data/materials/scripts/validate-finance-evidence.mjs --map dust2-nonferrous --fact-bank
```

N50 scope:

- FRED is the required global price / macro proxy source.
- BaoStock is the required A-share market / valuation proxy source.
- UN Comtrade is optional and may write unavailable observations.
- AKShare is registered but not used as a final source.
