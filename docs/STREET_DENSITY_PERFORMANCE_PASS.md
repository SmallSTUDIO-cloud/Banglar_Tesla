# Street density, mudi dokans and poster pass (v0.6.3 branch)

## Evidence and scope

- Mohammadpur Town Hall is documented as a mixed formal/informal market, with residential ground-floor shops and relatively close 4–5-storey neighborhood frontage (2023 urban-design paper: https://ijsmr.in/doc/ijsmr06_103.pdf). This is **context**, not a parcel survey or claim that every modeled building is in its real location.
- A 2025 account describes Mohammadpur's compact mid-rise housing and mixed-use commercialization (https://www.thedailystar.net/supplements/your-property-guru/news/developing-dhaka-inside-the-real-estate-markets-mohammadpur-basila-and-lalmatia-3939711). Road connectivity remains the game's existing graph; this pass does not move a real street, site, mosque or POI.
- The two education ads were supplied by the user. They refer to 2020/2025 campaigns and are depicted as **historical pasted posters**, not advertised as current offers. No other photos or untrusted external assets were downloaded.

## Implementation

- Existing main frontages, POIs, courts and interiors remain; a second narrow-lot pass fills additional *eligible* frontage only after the older occupancy passes. Both sizes use the unchanged road-corridor and OBB separation checks. Near junctions and mission forecourts the narrow pass keeps an additional clearance. No new lane, road or collision shortcut.
- Four occupied grocery variants now include shelves, stacked goods, sacks and nine hanging illustrated snack packets per shop. The wrappers are original Bengali artwork packed into one tiny canvas atlas and four merged district meshes; no individually animated bags, new colliders or per-shop draw calls.
- The two user images are packed into a 1024×2048 WebP atlas (244 KB on disk), retained at high resolution for large wall prints; smaller versions appear on selected existing poles. No stretched phone screenshot or fabricated replacement text. PWA precaches the atlas and rotates its cache key.
- Camera anti-clipping used to scan all colliders for each of 16 ray samples, per frame. It now indexes static candidate memberships in 16 m cells with a 0.65 m search pad. Exact height, OBB and disabled/breakable checks still run for every nearby candidate. The cell rebuilds if the collider array or its length changes. Unit coverage compares 250 sample points against the original full scan, plus disabled/append cases.
- Parcel placement also uses a center-cell broad phase before the same SAT, reducing one-time world generation comparisons without changing the rejection rule.

## Verification (Linux headless Chromium / SwiftShader, **not a phone FPS test**)

| Metric | Previous v0.6.3 | This branch |
| --- | ---: | ---: |
| Balanced scene draw calls | 170 | 174 |
| Balanced scene triangles | 931,911 | 971,989 |
| Low scene draw calls | 126 | 130 |
| Low scene triangles | 548,051 | 570,181 |
| Infill shops/buildings | not remeasured in prior checkout | 118 |
| Mudi dokans / batched packet faces | not present | 298 / 2,682 |
| Supplied-poster placements / photo batches | not present | 40 / 4 |
| Colliders / representative camera-cell candidates | not previously measured | 1,288 / 5 |

A same-page 4,000-point camera-query microbenchmark measured **102.6 ms full scan vs 4.3 ms indexed**, with 432 hits for each. This measures one CPU subsystem only, not total frame time. Scene triangles and draw calls increased modestly to preserve and add details; **no overall FPS improvement, device FPS, or absence of lag is claimed**. GPU render and mobile-device behavior still need testing on the user's actual target device. Refuse to raise quality automatically just because the CPU clipping scan got cheaper.

Checks: 234 unit tests; browser general 21/21, spec 12/12, mobile 13/13, vNext 9/9, upgrade 17/17; targeted tree/pole contact and landscape Blacklist tests; new street-density texture/geometry/performance guard; local and Pages-base builds including a live photo-atlas request. The outdated `graphics-road.mjs` assertion expected 4–8 holes; it now checks the already-authored eight curated plus eight damage-zone potholes (16), and the fixture passes. No actual APK rebuild, live-site deployment or physical-device measurement in this pass.
