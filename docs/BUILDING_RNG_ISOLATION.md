# Building RNG Isolation

**Status:** implemented on `arena/f78d620e-banglar-tesla`, verified by automated test and by
before/after screenshots. Does **not** add Mirpur Road — see [What this unblocks](#what-this-unblocks).

---

## 1. The defect

`buildCity()` ran a single generator, `mulberry32(20261207)`, from the first road prop to
the last piece of street litter:

| stage | source lines | consumes |
|---|---|---|
| speed humps, cracks, manholes, wear, puddles | `city.ts` ~539–646 | per segment, count depends on geometry |
| trees | `city.ts` ~850–853 | per tree site |
| **buildings** | `city.ts` ~976–1533 | 3 draws per placement attempt, +4 or +5 on success |
| litter | `city.ts` ~2296–2307 | 6 draws per litter item |

The building pass therefore consumed the *continuation* of the same stream. Its values
depended on how many draws every earlier stage happened to make, and prop counts are
geometry-dependent. Consequences:

- **Inserting one road segment shifted the entire building pass** and rearranged most of the
  city. Measured on the previous commit: adding the Mirpur chain moved **751–773 of 845
  buildings even with both new junctions parked at (5000, 5000)** — 5 km away.
- A segment's output also depended on its *position in the list*, not just its own geometry.

This blocked every road addition, including the Mirpur Road work in
`docs/MIRPUR_ROAD_IMPLEMENTATION.md`.

---

## 2. The frozen offsets

A temporary trace of the shared stream recorded, for each segment, the absolute draw index at
which its building pass began. The trace was then removed; the numbers are frozen in
`src/world/buildingRng.ts` as `LEGACY_BUILDING_OFFSETS`.

```
asad_0: 1136      ...      johuri_bypass: 7064      (70 entries, strictly increasing)
```

### Exact reconciliation of the numbers

Earlier notes quoted 1,136 / 7,064 / 7,151 / 12–218 / 5,928 and described 7,151 as the
building pass's draw count. **That was wrong.** 7,151 is an *absolute stream index*, not a
count. The figures reconcile as follows, and every one of them is now asserted in
`tests/unit/building-rng.test.ts`:

| figure | meaning | derivation |
|---|---|---|
| **1,136** | draws consumed *before* the first segment's building pass | props/chevrons/manholes/wear/puddles + trees |
| **7,064** | absolute index where the **last** segment's pass begins | table's final entry |
| **7,151** | absolute index where the building pass **ends** | 7,064 + 87 (last segment) |
| **6,015** | **draws the building pass itself consumes** | `3×1210 + 4×435 + 5×129` |
| **12–218** | per-segment draw counts | min/max over the 70 segments |
| **5,928** | sum of the **69 inter-segment gaps** | 7,064 − 1,136; excludes the last segment's 87 |

The 6,015 decomposition, from the trace:

- **1,210** placement attempts → 3 draws each (`bWidth`, `bDepth`, `setback`) = 3,630
- **564** successful placements → 435 non-gali × 4 + 129 gali × 5 = 2,385
- **646** failures → no draws; the walk advances by a fixed `along += 4.5`

`canPlaceBuilding()` failing is *why* the stream position was so fragile: a segment's draw
count depends on how many of its candidate positions happened to fit, which depends on the
parcel grid, which depends on what earlier segments already placed.

Verified: offsets are **contiguous** — each segment starts exactly where the previous one
stopped — so the table contains no gaps and no duplicate ids (asserted: the id set equals the
real `ROAD_SEGMENTS` id set exactly, 70 = 70).

---

## 3. The design: pinned per-segment legacy streams

Each segment's building pass gets **its own generator**, seeded to the exact state the old
shared stream held at that segment.

`mulberry32` advances by a **constant** on every call (`a = (a + 0x6d2b79f5) >>> 0`), so the
state after *N* draws is closed-form and needs no replay:

```ts
export function advance(seed: number, n: number): number {
  return (seed + Math.imul(n, MULBERRY_STEP)) >>> 0;
}
```

| case | seed |
|---|---|
| legacy segment | `advance(20261207, LEGACY_BUILDING_OFFSETS[id])` |
| new segment | `(NEW_SEGMENT_SEED ^ hashString(id)) >>> 0`, `NEW_SEGMENT_SEED = 0x5b17d4a1` |
| litter (post-building) | `advance(20261207, 7151)` |

Chosen over the alternatives: a fresh shared building stream (regenerates all 845 buildings —
forbidden), hash-only seeds for legacy segments (same cost, same regeneration), or freezing a
placement dataset (would end procedural generation).

**Why offsets are looked up by id, not accumulated:** accumulation would reintroduce exactly
the coupling being removed. The seed is a pure function of `(id, frozen table)`.

---

## 4. Evidence

### 4.1 Buildings — exact identity

| check | result |
|---|---|
| building count | 845 → 845 |
| per-building id / segment / x / z / width / depth / height | **0 differences** across all 845 |
| order-independent digest `worldDigest` | `c60e15b5` unchanged (golden baseline) |
| per-segment distribution | no drift |
| full golden payload (`tests/unit/world-baseline.test.ts`) | no drift |

### 4.2 Downstream consumer — litter

Litter continues to begin at absolute index 7,151 via `postBuildingRng()`, so it is
bit-identical while no longer depending on the props stage or the building pass.

Proven by a full-build A/B against pristine commit `c56eb4a`: for all **136** litter items,
`segId`/`baseX`/`baseZ`/`baseYaw`/`phase`/`scale` serialised to 6 decimals were
**byte-identical**. Trees (108 sites) and utility poles (133) in the same dump were also
byte-identical.

*Limitation, stated plainly:* the world snapshot records only the litter **count**, and that
count is capped at 136 which the legacy world already reaches, so the permanent test can only
assert the count. The positional proof above is a one-off A/B comparison, reproducible with
the procedure in §6, not a standing regression test. Litter *stream* isolation is unit-tested.

### 4.3 Isolation — mutation-tested

`tests/unit/building-rng-isolation.test.ts` inserts synthetic segments **before the first**,
**in the middle**, **after the last**, and all four at once, then asserts every legacy building
is unchanged.

The tests were run against **pre-migration code** (`c56eb4a`) to prove they detect the coupling:

| test | on pre-migration code |
|---|---|
| segment added after the last | **FAIL** |
| segment added before the first | **FAIL** |
| segment inserted in the middle | **FAIL** |
| several segments at once | **FAIL** |
| reference world builds (845) | pass |
| inserted segment really places buildings | pass |
| inserted segment perturbs the shared prop stream | pass |
| litter count stable | pass |
| rebuild is deterministic | pass |
| legacy digest stable | pass |

**4 fail before, 0 fail after.** Two guards keep the equality from passing vacuously: the
synthetic segment must place buildings of its own, and it must visibly shift the shared prop
stream (trees/humps/props) — if it did neither, the equality would prove nothing.

Synthetic segments are parked at x ≈ 5,000, far from the city. This is deliberate:
`canPlaceBuilding()` resolves frontages first-come through a shared parcel grid, so a road
dropped *through* existing buildings will legitimately suppress some. That is a geometric
conflict to report, not RNG drift to hide.

### 4.4 Visual verification — performed, not blocked

A headless browser (`@sparticuz/chromium`) was available. Five fixed-viewpoint screenshots
were captured from **both** builds — this branch and pristine `c56eb4a` — and compared pixel by
pixel.

| view | differing pixels |
|---|---|
| `corridor:ring-street` | **0** (pixel-identical, 518,400 px) |
| `corridor:ring-queens` | **0** (pixel-identical) |
| `density-town` | 8,301 (1.601 %) |
| `density-north` | 7,095 (1.369 %) |
| `density-south` | 13,418 (2.588 %) |

Every non-zero difference was inspected on a difference mask and resolves to time-dependent
animation, not geometry: **pedestrians**, **distant moving traffic**, **foliage sway**, and the
**fading intro toast** ("ফ্রি রাইড — মোহাম্মদপুর ঘুরে দেখুন"). No facade, roofline, window,
balcony, shopfront, sidewalk, or road surface is flagged in any view. The two corridor views
being bit-identical confirms the render path itself is deterministic; the density views differ
only because their frames contain moving agents.

---

## 5. What this guarantees, and what it does not

**Guaranteed:**
1. A segment's buildings depend only on `(stable id, frozen offset)`.
2. Adding, inserting, removing or reordering **other** segments cannot shift an existing
   segment's frontage.
3. Extra prop, tree or litter draws cannot shift any building.
4. Deterministic across runs, processes and platforms (pure integer arithmetic; no
   `Math.random`, no wall clock, no iteration-order dependence).
5. The existing 70-segment world reproduces its pre-migration output exactly.
6. Gameplay, world and lane baselines unchanged.
7. Accidental coupling is caught by tests — proven by the mutation run in §4.3.

**Not guaranteed:** a new road that physically overlaps an existing building can still
suppress that building through `canPlaceBuilding()`. That is a real geometric conflict and
must be reported, not attributed to RNG.

**Two frontages that contend for the same parcel are still resolved in list order**, because
they share one parcel grid. RNG isolation does not make segment *order* irrelevant to
*conflicting* geometry — only to non-conflicting geometry.

---

## 6. Reproducing the evidence

```bash
npm ci
npx vitest run tests/unit/building-rng.test.ts \
               tests/unit/building-rng-isolation.test.ts \
               tests/unit/world-baseline.test.ts

# Before/after screenshots (needs the built dist/):
npm run build && node tests/e2e/shoot.mjs density-town,density-south,corridor:ring-street
```

To re-derive the offset table from source (only needed if the legacy world is ever
deliberately redesigned): temporarily wrap the shared `rng` in `buildCity()` with a counter,
record `_n` at the top of the segment loop and after the building pass, run a full build, then
remove the instrumentation. **Do not regenerate the table to make a test pass** — the table
*is* the current city. Changing an entry deliberately rebuilds that segment's frontage.

---

## 7. What this unblocks

Mirpur Road (§ `docs/MIRPUR_ROAD_IMPLEMENTATION.md`) can now be added without moving the 845
existing buildings — which is what blocked it before. That work is **not** done here and
remains gated on its own verification.
