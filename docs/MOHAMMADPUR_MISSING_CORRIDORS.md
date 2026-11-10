# Mohammadpur — ranked absent corridors

Priority C output of the 2026-10-29 mission. **Documentation only; no road was
added.** Every corridor below is blocked by the same pre-existing world-generation
coupling documented in `docs/MIRPUR_ROAD_IMPLEMENTATION.md` §5: `buildCity` runs
one unbroken RNG stream across props and buildings, so *any* added segment
displaces ~750 of 845 buildings. That must be decoupled before the map can grow.

## Method (reproducible)

Same basis as `npm run audit:roads`: OSM geometry projected with
`projectOsm()` (origin 23.7624 N / 90.3646 E, 0.36 world units per metre),
clipped to the playable box (`x −218..242`, `z −256..248`) with Liang–Barsky,
restricted to `trunk / secondary / tertiary` and their `_link` variants.

Three columns beyond length, chosen because the mission defines them as the
ranking criteria:

- **POIs** — OSM POIs whose centre is within 40 m of an in-box vertex of that
  corridor. A proxy for "destinations served", not a claim that the game would
  model them.
- **nearest game road** — distance from the corridor's nearest in-box vertex to
  the nearest existing runtime segment. A small value means the corridor can
  attach without inventing a connector.
- **present?** — excluded from the table when the runtime graph already names it
  or cites one of its ways.

## The ranked table

| # | corridor | class | in-box length | POIs | nearest game road | note |
|---|---|---|---|---|---|---|
| 1 | **Mirpur Road** | **trunk** | **1,297 m** | 18 | 42 m | highest class; plan and tested patch in `MIRPUR_ROAD_IMPLEMENTATION.md` |
| 2 | **Sher-E-Bangla Road** | tertiary | 660 m | **87** | **0.5 m** | best destination density *and* touches the graph already |
| 3 | (unnamed links) | secondary_link | 709 m | 75 | 2 m | real but unnamed; cannot be labelled honestly as a named street |
| 4 | Mohammadpur Beribadh Connecting Road | secondary | 595 m | 41 | 35 m | the game's `asad_0` is named "Beribadh Connecting Rd" but cites Asad Avenue's way — not this road |
| 5 | Sher-E-Bangla Main Road | tertiary | 104 m | 23 | 45 m | likely a continuation of #2 |
| 6 | Glass Factory Road | tertiary | 103 m | 1 | 6 m | short, almost no destinations |
| 7 | Sadek Khan Road | tertiary | 72 m | 2 | 51 m | short, sparse |

### Why #1 is Mirpur Road but #2 is the better *next* target

Ranking by class alone puts Mirpur Road first, and it remains the most important
structural gap: the game models the streets behind its own trunk road. But by the
mission's own criteria — destinations served and connection feasibility — **Sher-E-Bangla
Road is the stronger actionable target**:

- **87 POIs vs 18.** Nearly five times the destination density.
- **0.48 m from existing segment `ring_1`** (nearest vertex at (−206.93, 58.86)),
  and **11.3 m from game node `ring_nurjahan`**. It would attach to the existing
  graph at a real point rather than needing a new connector road at all — which
  is exactly the property Mirpur Road lacks (its nearest game road is 42 m away
  and nothing crosses it).
- It is `tertiary` rather than `trunk`, so it changes the hierarchy less.

Its OSM source: ways `626341186` (20 pts, width 6 m, `estimated:lanes`) and
`1181775078` (4 pts, width 7 m, `estimated:road-class`), extent
x −210..−128, z 2..211 — the south-west of the playable box.

Neither road should be started until §5's coupling is resolved, because starting
one produces a 750-building reshuffle that cannot be isolated from the road change.

## What this table does *not* do

- It does not claim these corridors are the *only* missing ones. It lists the
  named high-class ones; the 1,026 `residential` and 144 `living_street` ways —
  the galis that actually give Mohammadpur its fabric — are the bulk of the
  missing 68 % and are deliberately out of scope for a hand-placed graph.
- It does not change the playable box. The mission forbids expanding it to
  improve coverage metrics.
- It does not propose invented connectors. Where a corridor does not touch the
  graph, the fix is to find the real road that does (as was done for Mirpur), not
  to draw a line.

## Recommended order once unblocked

1. Decouple the building RNG stream (one-time 845-building regeneration, its own
   reviewed commit).
2. Sher-E-Bangla Road — attaches at a real point, highest destination density.
3. Mirpur Road — highest structural importance; patch already written and tested.
4. Beribadh Connecting Road — completes the western edge.
