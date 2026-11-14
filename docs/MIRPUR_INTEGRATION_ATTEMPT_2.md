# Mirpur Road integration — attempt 2 (after RNG isolation)

**Outcome: REVERTED. Not integrated.**
**Verdict:** the RNG isolation milestone is **DONE**; road integration is **BLOCKED** by
two *different* couplings that RNG isolation does not address.

This document records what was actually run, what it produced, and why it was undone.
Nothing here is a plan — every number below came from a build.

---

## 1. What was attempted

The preserved, previously geometry-verified patch from
[`MIRPUR_ROAD_IMPLEMENTATION.md`](./MIRPUR_ROAD_IMPLEMENTATION.md) was applied verbatim
on top of commit `2e4d3a2` (RNG isolation landed):

- 3 nodes: `mirpur_n` (160.22, −256.00), `mirpur_aurangzeb` (227.88, −71.19),
  `mirpur_e` (242.00, −37.83)
- 3 edges: `mirpur_0`, `mirpur_1` (kind `main`, 22.9 m), `aurangzeb_3` (kind `medium`, 8.8 m)
- 2 authored curved centrelines (`mirpur_0`, `aurangzeb_3`) with junction endpoints pinned
- `aurangzeb_3` extends Aurangzeb Road along its own OSM alignment to the real OSM
  Mirpur junction; it relocates no existing node

Graph after patch: **73 segments / 45 nodes** (from 70 / 42).

This road section is in scope: `docs/MOHAMMADPUR_MAP_SCOPE.md` measures **1,704 m of
Mirpur Road inside the documented Mohammadpur ring**.

---

## 2. What it produced

| Check | Result |
|---|---|
| Typecheck | pass |
| Graph | 73 segments / 45 nodes |
| Building count | 845 → **847** |
| World digest | `c60e15b5` → **`39ea8b17`** |
| Building rectangles byte-identical | **714 of 845** |
| Replaced rectangles | **131** |
| Net new rectangles | +2 (133 added, 131 replaced) |

**The acceptance gate — all 845 buildings unchanged — FAILED.** The patch was therefore
reverted rather than tuned to fit.

---

## 3. This is not RNG drift

Before the patch, the same build produced **0/845** building differences and digest
`c60e15b5`. The per-segment RNG streams did exactly what they were designed to do.

The 131 changes come from two other couplings. They were separated by classifying every
replaced rectangle by the **only** formula that can produce its height:

| Generator | Height formula | Heights |
|---|---|---|
| Main apartment pass | `floors × 3.05` | 6.1 / 9.15 / 12.2 / 15.25 / 18.3 |
| Infill strip | `floors × 3.1` | 6.2 / 9.3 |
| Block interior | `2.85 × (2…4)` | **5.7 / 8.55 / 11.4** |

| Replaced height | Count | Generator |
|---|---:|---|
| 5.7 | 35 | block interior |
| 8.55 | 39 | block interior |
| 11.4 | 26 | block interior |
| 6.1 | 7 | main apartment |
| 9.15 | 7 | main apartment |
| 12.2 | 11 | main apartment |
| 15.25 | 4 | main apartment |
| 6.2 | 1 | infill |
| 9.3 | 1 | infill |

**100 block-interior + 29 main-apartment + 2 infill = 131.**

---

## 4. Root cause A — the block-interior pass has a global budget

`src/world/city.ts`, the block-interior pass (immediately after infill):

```ts
const roadDistance = distanceToRoadCorridor(x, z);   // consults ALL segments
const gap = placedBuildings.reduce(...);             // consults ALL placed buildings
interiorCandidates.push({ x, z, sec, order: -gap + tie / 4294967296 });
...
interiorCandidates.sort((a, b) => a.order - b.order); // city-wide re-sort
for (const { x, z, sec } of interiorCandidates) {
  if (interiorBySector[sec] >= 12 || interiorCount >= 160) continue;
  const width = 5.9 + ((interiorCount + sec) % 3) * 0.75;   // GLOBAL COUNTER
  const depth = 6.3 + ((interiorCount + sec * 2) % 3) * 0.62; // GLOBAL COUNTER
  const floorCount = 2 + (interiorCount + sec) % 3;           // GLOBAL COUNTER
  ...
  interiorCount++;
}
```

Adding a road changes `roadDistance` for candidates near it, and adding buildings changes
`gap` for candidates near them. The candidate list is then **sorted globally**, so a change
anywhere can reorder entries anywhere, and `interiorCount` — which drives width, depth and
height — is consumed in that order.

**Measured:** all 100 replaced interior buildings are at a **median 248.5 m** from the new
Mirpur segments. Only 14 of 100 are within 40 m. They are nowhere near the new road; their
appearance changed because their position in a global budget changed.

This is a genuine defect: **the block-interior pass is order- and geometry-coupled to the
whole road network at once.**

---

## 5. Root cause B — the new carriageway physically covers existing buildings

Distance from each replaced main-pass building centre to the nearest new segment:

| Within | Count (of 31 main/infill) |
|---|---:|
| 20 m | 18 |
| 40 m | 28 |
| > 40 m | 3 |

Nearest examples: **6.4 m**, 6.5 m, 7.1 m, 7.3 m, 7.8 m, 9.2 m, 9.5 m, 9.9 m.

Mirpur Road's corridor is `halfWidth 11.45 + sidewalk 2.6 = 14.05 m` from the centreline.
Buildings at 6.4–9.9 m sit **inside the new carriageway**. `isFootprintClearOfCorridor`
correctly refuses to place them.

This is physically correct behaviour — a road cannot be laid over a standing building —
but it directly contradicts the milestone's "every pre-existing building retains its exact
transform" gate. **This is a product decision, not a bug**, and it was not made silently
here.

---

## 6. Root cause C — infill budget reallocation

The infill pass has the same shape: it iterates every segment with a global cap
(`infillCount >= 112`) and a per-sector cap (`infillBySector[sec] >= 8`). Adding segments
changes which empty lots consume the budget. Measured effect here: **2 buildings**.

---

## 7. Experiment: does segment ordering explain the main-pass changes?

Hypothesis: legacy segments running after the new ones see a populated parcel grid.

Change: iterate `[...legacySegments, ...newSegments]` in the main building pass, so new
roads are additive.

Result: **131 replaced → 131 replaced. No change whatsoever.**

This rules out iteration order as the cause of the main-pass changes and confirms root
cause B (corridor overlap) instead. The experiment was reverted.

---

## 8. Why RNG isolation was still necessary

Without it, the same patch moved **751–773 of 845** buildings. With it, the damage fell to
131 — and, more importantly, the 714 that survived did so for the *right reason*: their
streams are now pinned to stable ids. The remaining coupling is structural, not stochastic,
so it is now tractable: each cause has a known location and a measured size.

RNG isolation removed the coupling that could not be reasoned about. What is left can be.

---

## 9. What must happen before any road lands

### 9.1 Isolate the block-interior and infill passes (engineering, no product decision)

Make both passes depend only on the **legacy** world:

1. Compute interior `roadDistance` against legacy segments only.
2. Compute interior `gap` from the building list **snapshotted after the last legacy
   segment**, not from the final list.
3. Keep the candidate list and `interiorCount` order frozen — identical inputs must give
   an identical sequence, which they already do when the segment set is unchanged.
4. Do the same for the infill budget.

Because the inputs are unchanged for the current 70 segments, output stays byte-identical
(845 / `c60e15b5`). That is the testable contract, and it is the same technique that made
`buildingRng.ts` work.

New roads then get main-pass frontage only, and gain interior/infill fill in a deliberate
later step rather than as a side effect.

### 9.2 Decide the displacement policy (product decision — needs approval)

A road laid across existing buildings must remove them. Options:

- (a) Accept a documented, enumerated list of displacements per corridor, with before/after
  screenshots, and relax the "all 845 unchanged" gate to "all 845 unchanged except N
  enumerated footprints the carriageway occupies".
- (b) Choose corridors that do not overlap existing buildings (Beribadh Road is 100 %
  absent from the graph and may offer a cleaner first candidate).
- (c) Allow the corridor to shift its centreline to avoid buildings, at the cost of
  geographic accuracy — **not recommended**; it is the kind of drift this project has
  avoided.

Until one is chosen, no road should be integrated.

---

## 10. Reproducing

```bash
# apply the patch from MIRPUR_ROAD_IMPLEMENTATION.md, then:
npx vite-node <script that builds the city and dumps colliders>
# compare against the same dump at 2e4d3a2
```

The collider dump used here filtered `city.colliders` to `kind === 'building'` and sorted
`minX,maxX,minZ,maxZ,height` at 3 decimals. 714 exact matches, 131 replaced, 133 added.

---

## 11. Status of the two documents

| Document | Status |
|---|---|
| `MIRPUR_ROAD_IMPLEMENTATION.md` §5 "the blocker" | **Superseded.** The blocker was the RNG stream. That is fixed. |
| `MIRPUR_ROAD_IMPLEMENTATION.md` §7 patch | **Still valid geometry** — verified again: 0 crossings, endpoints pinned, connected at a real OSM junction. |
| This document | **Current blocker.** Two structural couplings + one product decision. |
