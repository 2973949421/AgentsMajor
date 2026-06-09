# Dust2 Hex Draft Asset

This directory contains the first HexGrid draft assets for Dust2.

`dust2-hex-map.draft.json` is the user-authored working draft. It is useful for manual editing history and validation, but it is not the recommended runtime candidate yet.

`dust2-hex-map.agent-refined.json` is the current cleaned audit candidate for N23. It is based on the draft, with region/point indexes normalized, CT spawn split into an explicit region, disconnected cells removed, and dirty connector semantics reduced.

The draft assets validate:

- 50x50 grid metadata.
- First-version AP model: `10 cells = 1 AP`.
- T/CT spawn flags.
- A/B bombsite flags.
- Region and point references.
- Route hint references.

The final Dust2 Hex map should be reviewed and saved from `/hex-lab/editor` during N22/N23.
