# Dhaka Reality Notes — research first (31 October 2026)

This is design evidence, **not** a surveyed geospatial map or current traffic census. All geographic names in the game must be checked against the existing authored road graph before use. No code was changed before these notes were drafted.

## Transport and street-life profile

UNESCAP's **2019** Dhaka transport brief describes mixed road use by buses, cars, CNGs, rickshaws, motorcycles and bicycles. Its speed and population estimates are historical/projections, **not 2026 measurements**. A 2021 Bangladesh pedestrian decision-making study (AUST/BUET/Southampton) explains that pedestrian decisions depend on past experience and immediate environmental cues, supporting readable crossing/edge behavior, not randomized collision-seeking. A 2024 land-use study by Rahman and Nilufar (KUET/BUET) identifies multiple Dhaka activity nodes and poor pedestrian/transit integration; it supports distinct connected street functions rather than uniform decoration. Avoid automatic permanent jams, continuous horns or forcing every intersection to act the same.

## Mohammadpur-specific profile

Kabir's **2023** AUST architecture case study treats Mohammadpur Town Hall as an old neighborhood node combining bazaar, small shops, civic office, mosque and open space, and describes parts of Mohammadpur as planned in the 1950s with a grid. This is site research and a redevelopment **proposal**, not proof its proposed plaza exists now. A **25 July 2026** Daily Star essay by Bengal Institute researcher Mohammad Arfar Razi reports a recent walk of three linked Mohammadpur streets: a market road near Town Hall, a residential alley and a tree-lined pedestrian lane. Their different experiences suggest a connected market → residential → shaded-lane sequence, with crossing/footpath accessibility concerns. It is an attributed local observation, not a representative citywide count. Bangladesh Tourism Board confirms Sat Gambuj Mosque is in Mohammadpur/Jafarbad-Katasur and dates the heritage monument to the Mughal era; its historic floodplain description should not be copied as current topography. Precise relation of in-game coordinates to these sites is **unverified** until map audit.

## Visual and audio reference checklist (conservative design cues, not surveyed counts)

- Planned/block-like residential streets next to commercial frontage and finer local connections; only where the authored graph supports them (Kabir; Razi).
- Market activity at appropriate node, shop entrance, bazaar pickup, daylight pedestrian room; keep footpath and travel lane usable (Kabir; Razi; Debnath et al.).
- Existing local rickshaw/CNG/bus/car/motorbike mix, distance-controlled horns and restrained market murmur; no claim of current proportions (UNESCAP 2019).
- Local heritage sign/name only with a verified in-game location; never fabricate a new replica at a convenient coordinate (Tourism Board).
- Monsoon puddles and slippery roads can motivate weather-aware passenger cues; no blanket claim every street floods (general Dhaka context; location-specific evidence missing).
- Verify any new signs, shop goods, architecture, greenery or sound **in context** before asset creation; no copyrighted audio or invented shop brands.

## Source-backed gameplay opportunities

| Idea | Supporting evidence | Safe interpretation |
|---|---|---|
| Market-edge pickup versus quiet residential pickup | Kabir 2023; Razi 2026 | Reuse existing valid passenger pickup nodes and vary contextual message, without placing crowds/roadblocks in lanes. |
| Pedestrian-aware patient driving | Debnath et al. 2021; Razi 2026 | Cues for safe slowing/comfort rather than a reward for near misses or collision. |
| Rain request on an existing accessible route | UNESCAP mixed-mode context; existing in-game weather | Weather-dependent passenger preference only; do not assert specific real-world flooded streets. |
| Mixed-mode queue/brief stopping | UNESCAP 2019 | Only after checking existing junction/race safeguards, reversible and recoverable; not automatic road blockage. |

## Evidence classification

| Detail | Classification | Limitation |
|---|---|---|
| Town Hall market functions as a local node; Sat Gambuj Mosque in Mohammadpur | Verified by cited site descriptions | Neither verifies exact game placement or present building condition. |
| Mohammadpur grid-like planned portions, market/park/mosque adjacency | Dated site description (Kabir 2023) | Do not generalize to every lane or construct the proposed redesign. |
| 2019 vehicle mix and old speed/population numbers | Historical/dated | Do not present numerical speeds/shares as current. |
| 2026 observation of market road, residential alley, shaded lane | Local reporting/field observation | Small qualitative exercise; not a representative traffic survey. |
| Contextual passenger comfort, rain requests, market pickups | Reasonable game-design interpretation | Not a documented customary fare or present transport regulation. |
| Exact real-world road alignment, mosque/market coordinates in game, contemporary vehicle percentages, legal stopping rules and on-street waterlogging location | Unknown | Require georeferenced verification before representing as precise geography. |

## Sources actually read (retrieved 31 October 2026)

1. **Sustainable urban transport index: Dhaka, Bangladesh**, UNESCAP, policy brief **23 Dec 2019**, https://www.unescap.org/resources/suti-mobility-assessment-report-dhaka — historic mixed-mode context; speed forecasts are dated and must not be used as live measurements. High confidence in publication identity, low applicability of old statistics to 2026.
2. **An investigation of urban pedestrian behaviour in Bangladesh using the Perceptual Cycle Model**, Mithun Debnath et al., *Safety Science* **2021**, https://pmc.ncbi.nlm.nih.gov/articles/PMC8190833/ — pedestrian environment/decision-making; Bangladesh sample not a Mohammadpur street census. High confidence for study scope.
3. **An investigation into the land use pattern of Dhaka: identifying activity nodes for a compact city**, Md. Muktadir Rahman and Farida Nilufar, **2024**, https://doiserbia.nb.rs/img/doi/1450-569X/2024/1450-569X2452001R.pdf — activity node concept; its map does not validate arbitrary in-game coordinates. Medium-high confidence on study, low on translating placement.
4. **Re-Thinking Townhall Market as An Urban Marketplace to Meet the Future with It’s Lost Vibrant**, Shahriar Kabir, AUST, **2023**, https://ijsmr.in/doc/ijsmr06_103.pdf — Town Hall/Mohammadpur site history and functions. Proposal and old conditions are not current building-state verification. Medium confidence.
5. **Sat Gambuj Mosque**, Bangladesh Tourism Board, undated page (read **31 Oct 2026**), https://beautifulbangladesh.gov.bd/district-destination/dhaka/heritage/103 — confirms Mohammadpur heritage identity; historical floodplain description does not prove current surrounding land use. High confidence on heritage identity.
6. **Republic of the footpath**, Mohammad Arfar Razi, *The Daily Star*, **25 Jul 2026**, https://www.thedailystar.net/slow-reads/unheard-voices/news/republic-the-footpath-4231611 — recent attributed Mohammadpur street observations. Qualitative essay; not a representative census. Medium confidence for described walk.

A supplied World Bank PDF URL returned **403 Forbidden**, so it was **not used** as a read source. The other supplied PDFs/guide URLs were not all fetched; do not imply they were read. Further local verification is needed for exact place geometry.
