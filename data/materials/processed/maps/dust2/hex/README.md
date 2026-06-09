# Dust2 Hex Assets

This directory contains the HexGrid map assets for Dust2.

`dust2-hex-map.json` is the official N23-sealed Dust2 Hex map asset. Runtime code from N24 onward should read this file.

`dust2-hex-map.draft.json` is the user-authored working draft. It remains editable in `/hex-lab/editor` and must not be treated as the runtime source of truth.

`backups/` contains historical audit snapshots. Backup files are not runtime inputs.

The official asset validates:

- 50x50 grid metadata.
- First-version AP model: `10 cells = 1 AP`.
- T/CT spawn flags.
- A/B bombsite flags.
- Region and point references.
- Route hint references.
- Three levels: `-1`, `0`, and `1`.
- Explicit vertical links between levels.

Semantic contract:

- Region is spatial context.
- Point is tactical target.
- Flag is the hard-rule authority for spawn, bombsite, cover, choke, and route hints.
