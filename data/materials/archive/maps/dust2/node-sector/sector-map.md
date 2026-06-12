# Dust2 Sector Map

This is the first-pass display aggregation layer for the Phase 2.0-pre node round engine.

It does not replace `node-graph.json`. The 39 detailed nodes remain the runtime fact layer. This sector map groups those nodes into 13 larger visual sectors so Node Lab can show the round state in a CS-like map view without overwhelming the page.

## Source References

- `visuals/source/dust2-callout-reference.jpg`: callout names and spatial reference.
- `visuals/source/dust2-user-sector-sketch.jpg`: user-provided first-pass sector split. This is the primary N17 visual reference.
- `visuals/source/dust2-radar-green-reference.jpg`: radar-style color reference.
- `visuals/source/dust2-flat-clean-reference.jpg`: clean flat map reference for future overlays.

## Sectors

| Sector | Chinese name | Area type | Detailed nodes |
|---|---|---|---|
| `ct_cross` | CT连接 | Rotate | `ct_spawn`, `a_ninja`, `a_lift` |
| `ct_b_rotate` | CT转B | Rotate | `b_window`, `b_doors`, `mid_doors` |
| `b_site` | B点 | B | `b_site`, `b_default`, `b_back_site`, `b_plat`, `b_big_box`, `b_fence`, `b_car`, `b_headshot` |
| `b_tunnels` | B洞 | Tunnel | `upper_tunnels`, `lower_tunnels`, `b_tunnel_exit` |
| `outside_tunnels` | B洞外 | Tunnel | `outside_tunnels` |
| `t_spawn` | T出生点 | Spawn | `t_spawn` |
| `long_approach` | A大外 | Long | `outside_long` |
| `long_doors` | A大门 | Long | `long_doors` |
| `long_corner_blue` | A大拐角 | Long | `blue`, `long_corner` |
| `a_long_pit` | A大与坑 | Long | `pit`, `a_long`, `a_car` |
| `a_site` | A点 | A | `a_ramp`, `a_default`, `a_safe`, `a_quad`, `a_goose` |
| `a_short` | A小 | A | `a_short`, `short_stairs`, `cat` |
| `mid_top_mid` | 中路 | Mid | `top_mid`, `mid`, `xbox`, `green`, `suicide` |

## Runtime Rules

- Sectors are display and audit summaries only.
- Sectors must not decide winner, economy, AP, kill facts, bomb result, or LLM behavior.
- Every node in `node-graph.json` must belong to exactly one primary sector.
- Node Lab may use sectors as its default map view and keep detailed nodes as a secondary/debug view.

## Visual Metadata

N17 adds radar-style visual metadata to every sector:

- `visual.svgPath`: a hand-traced 0-100 SVG path used by Node Lab as the primary sector mask.
- `visual.labelAnchor`: a 0-100 point used for the sector label and A/D counts.
- `visual.labelPriority`: controls whether a label is visible by default or only when active/selected.
- `visual.labelShort`: compact label for the radar-style view.

The old `polygon` field remains as a fallback and for quick audits. The preferred Node Lab rendering order is:

1. `apps/web/public/node-lab/dust2/dust2-radar-base.jpg`
2. `visual.svgPath` sector masks
3. low-opacity control state fill
4. compact labels and win-check markers

Graph edges and the 39 detailed nodes are debug layers. They should not be shown in the default spectator map.
