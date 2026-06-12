# Dust2 visual assets

This folder stores stable visual references for the Phase 2.0-pre Dust2 map work.

## Source images

- `source/dust2-callout-reference.jpg`: Dust2 callout reference used to align sector names with CS map language.
- `source/dust2-user-sector-sketch.jpg`: User-provided sector sketch. This is the first-pass authority for the 13-sector layout.
- `source/dust2-radar-green-reference.jpg`: Radar-style visual reference for unified color treatment.
- `source/dust2-flat-clean-reference.jpg`: Clean flat map reference for future polished overlays.

## Generated assets

`generated/` is reserved for derived SVG/PNG assets. Generated assets must not replace the source images.

## Runtime rule

Runtime code must read the official HexGrid asset:

```text
data/materials/processed/maps/dust2/hex/dust2-hex-map.json
```

Retired Node/Sector runtime assets are no longer retained as active or archive materials. Frozen docs may mention the old route as historical context, but runtime and Web code must not read Node/Sector map assets.
