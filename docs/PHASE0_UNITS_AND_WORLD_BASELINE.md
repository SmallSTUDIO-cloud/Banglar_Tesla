# Phase 0 — unit contract and world-generation baseline

**Commit base:** `6aa8146`. No road geometry changed, no gameplay value changed,
no building added or moved.

Two things landed:

1. **A unit contract** (`src/world/units.ts`) that names the two length spaces this
   project has always mixed, so new geometry code cannot silently use the wrong one.
2. **A generated-world baseline** (`data/mohammadpur/world-baseline.json`) that pins
   the 845 buildings, which had **zero** regression coverage before this commit.

---

## 1. Why this was needed

The gameplay baseline from `6aa8146` pins the road graph and authored gameplay. It
does not pin what is *generated from* that graph. `city.ts:946` walks each segment:

```ts
let along = 9.5;
while (along < seg.length - 9.5) { … }     // building count depends on seg.length
const setback = seg.halfWidth + seg.sidewalk + bDepth * 0.5 + 0.95 + rng() * 0.65;
```

So changing a segment's length changes **how many buildings exist**, and changing its
width moves them. Measured during this phase: nudging `town_hall.z` by **one world
unit** dropped the building count from **845 to 843**. Before now, no test would have
noticed.

The unit problem is equally live. `projectOsm` compresses positions by `0.36`, but road
`width` is authored in real metres, so `asad_4` is drawn **2.35× too wide relative to
its own length** (architecture review §4.2). That distortion exists at `6aa8146` and is
now documented in an executable assertion rather than prose.

---

## 2. Unit contract — `src/world/units.ts`

### The rule

> Every stored coordinate and distance is `WorldUnits` (compressed). Every authored
> real-world dimension is `Meters`. Conversion happens only at four named boundaries.

`WorldUnits` and `Meters` are branded numbers (`number & { readonly [brand]: … }`), so
the compiler rejects crossing them. Existing call sites keep plain `number`; the brands
are opt-in for new geometry work, which is where mistakes concentrate.

### Constants

| Export | Value | Meaning |
|---|---|---|
| `WORLD_SCALE` | `0.36` | world units per real metre |
| `METERS_PER_WORLD_UNIT` | `2.7778` | real metres per world unit |
| `PROJECTION_ORIGIN` | `23.7624 N, 90.3646 E` | matches `landmarks.ts` `PROJECTION` |
| `METERS_PER_DEG_LAT` | `111132` | |
| `METERS_PER_DEG_LON` | `111320·cos(23.7624°)` | |

### Functions

| Function | Direction | Boundary |
|---|---|---|
| `projectLatLon(lat, lon)` | degrees → `WorldUnits` | 1 (ingest) |
| `unprojectToLatLon(point)` | `WorldUnits` → degrees | diagnostics |
| `toWorldUnits(m)` / `toMeters(u)` | signed convert | 2 / 4 |
| `toWorldLength(m)` / `toMeterLength(u)` | positive **dimension** convert | 2 / 4 |
| `worldDistance(a, b)` | two points → real metres | 4 |
| `worldUnitsBetween(...)` | raw pairs → world units | — |
| `looksLikeMeters(values)` | heuristic guard against unconverted metres | — |

### The four boundary rules (documented in the module header)

1. **OSM ingest** — lat/lon → world units, via `projectLatLon()`. Only place degrees are read.
2. **Cross-section data** — authored metres → world units via `toWorldLength()` *before*
   mixing with any coordinate. A median or lane width must never be added to a position raw.
3. **Rendering** — models keep real-metre *sizes* (a 3.05 m storey stays 3.05) while being
   *positioned* in world units. This single intentional mixed space is now documented.
4. **Player-facing output** — HUD, map labels and mission text use `toMeters()`.

### Validation

`UnitError` is thrown for non-finite input, non-positive dimensions
(`toWorldLength(0)` and negatives are always bugs), and out-of-range geography. Messages
name the offending argument so a mixed-space bug is diagnosable from the failure alone.

**Nothing was rescaled.** No coordinate, width, length or object dimension changed.

---

## 3. World baseline — `data/mohammadpur/world-baseline.json`

### How it is generated

The real `buildCity()` is run headless behind `tools/domShim.ts`, a **no-op canvas
shim**. Generation needs a DOM only to paint textures; building *placement* reads
segment geometry and `mulberry32(20261207)` only. Proof the shim is faithful: it yields
**845 buildings**, exactly the count the browser-based `tests/e2e/verify-geography.mjs`
reports. No generation logic was duplicated or refactored — the shipped generator runs
as-is.

Determinism was checked three ways: twice in one process, and twice in **separate
processes** (identical digest `48137446` via a raw position hash, and `c60e15b5` via
the shipped digest).

### Contents

| Field | Value at `6aa8146` |
|---|---|
| `counts.buildings` | **845** |
| `counts.props` / `walls` | 387 / 0 |
| `counts.trees` / `utilityPoles` / `lamps` | 108 / 133 / 142 |
| `counts.litter` / `infill` / `posters` | 136 / 118 / 90 |
| `counts.billboards` / `grocery` / `speedHumps` | 8 / 268 / 27 |
| `buildingsBySegment` | all **70** segments, including zeroes |
| `buildings[]` | 845 records |
| `digest` | `c60e15b5` |

Each building record carries a **stable identity** and geometry, in world units rounded
to 1 cm:

```json
{ "id": "asad_0:-197.30,214.20", "segmentId": "asad_0",
  "x": -197.3, "z": 214.2, "width": 9.49, "depth": 9.4, "height": 11.4 }
```

- **No timestamps, no indices, no random ordering.**
- Identity is **position-keyed**, not index-keyed, deliberately: inserting one building
  does not shift every later record into a thousand-line false diff. A moved building
  shows as `MISSING` + `UNEXPECTED`; a resized one keeps its id and reports only the
  changed dimension.
- Records are sorted by `(segmentId, x, z, width, depth)`, so the digest is independent
  of generation order (tested).

### Attribution, stated honestly

`buildCity` does not record which segment produced which building, and adding that field
would mean editing generation code — out of scope here and a risk to RNG ordering.
Instead each building is attributed to the **nearest segment centreline**, which is
deterministic and tie-broken by segment id. This is a derivation, not a recorded fact,
and it is labelled as such in the file's `_note`.

---

## 4. Detection proofs (all run, all passed)

Each proof was run as a real mutation and then reverted. Source and golden file were
verified restored afterwards (`0` diffs vs `HEAD`).

| # | Change made | Caught by | Reported |
|---|---|---|---|
| 1 | Road coordinate: `town_hall.z` 106 → 107 | gameplay + world | `nodes[town_hall].z` 106→107; buildings **845 → 843** |
| 2 | Road width: `asad_4` 12.2 → 12.4 | gameplay + world | `segments[asad_4].width` 12.2→12.4; **18 buildings moved** |
| 3 | Building position: one golden record `+0.5` x | world | `MISSING` / `UNEXPECTED` naming `asad_1:-87.28,156.62` |
| 4 | Building count: one record removed | world | `buildings` 845→844, `buildingsBySegment.asad_0` −1 |
| 5 | **Distribution only**: 1 building moved `asad_0`→`zakir_6`, totals unchanged | world | `buildingsBySegment.asad_0` + `.zakir_6` |

Proof 5 matters most: the total stayed at 845, so only the per-segment counts could
reveal it.

Proofs 3–5 perturb the golden file, which isolates *detection*. Proofs 1–2 are real
source edits, which additionally prove that a geometry change propagates into the
generated world and is caught end to end.

---

## 5. Updating the baseline on purpose

```bash
npm run baseline:update-world                       # dry run, prints diff, exits 1
BASELINE_ACCEPT="reason" npm run baseline:update-world
```

Same gate as the gameplay baseline: refuses without a reason, records `acceptedReason`
in the file, so the commit justifies itself. **Never** run it to make a red test green.
A change to `buildingsBySegment` in the diff means the world genuinely changed.

---

## 6. Verification

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | **440/440 in 48 files** (was 405/46; **+35 tests**) |
| `npm run build` | 1,294.39 kB / **364.62 kB gzip** (was 364.61) |
| Gameplay baseline | **unchanged** — `0` diff lines vs `HEAD` |
| Road geometry | **unchanged** — `0` diffs under `src/` |
| World baseline reproducible | `npm run baseline:update-world` → "no drift: 845 buildings, digest c60e15b5" |

The 0.01 kB gzip delta is the embedded build stamp (`__BT_BUILD__` = `6aa8146-dirty`),
not Phase 0 code: `grep` confirms `toWorldLength`, `looksLikeMeters` and
`METERS_PER_WORLD_UNIT` do **not** appear in the bundle. `units.ts` is tree-shaken
because nothing imports it yet — that is intended; it is a contract for future work.

---

## 7. Known limitations (disclosed)

- **Two tooling files sit outside `tsc`**: `scripts/update-world-baseline.ts` and
  `tools/snapshot-world.ts` use `node:fs` / top-level await, and this repo pins
  `types: ["vite/client"]` with no `@types/node`. The shared logic they call
  (`tools/worldSnapshot.ts`, `tools/worldSnapshotGenerate.ts`, `tools/domShim.ts`) **is**
  typechecked, because the drift test imports them. Both scripts were verified by
  executing them (dry-run refusal, accepted write, "no drift" re-run).
- **Building identity is derived by nearest-segment attribution**, not recorded by the
  generator. A building equidistant from two roads could attribute differently if road
  geometry changed in a way that moves the bisector.
- **The DOM shim draws nothing.** Correct for placement; it means texture *content* is
  not covered by any baseline.
- **The baseline covers generation inputs, not rendering.** It cannot catch a building
  placed inside a road — that remains the geography test's job.
- **One live build takes ~3 s**, so the world test runs at module scope once and shares
  the result; the full suite grew by roughly 3 s.

---

## 8. What Phase 0 deliberately did not do

No road geometry change. No gameplay change. No race retuning. No dual-carriageway
work. No new buildings or assets. No Phase 1 construction. No change to `main`, no
release, no force-push.
