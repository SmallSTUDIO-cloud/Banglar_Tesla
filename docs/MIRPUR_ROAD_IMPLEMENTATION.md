# Mirpur Road — research, tested patch, and the blocker that stopped it

**Status: NOT IMPLEMENTED. Reverted to pristine.** The working tree is byte-identical
to `b8ef1b1`. This document records a complete, validated implementation that was
written, type-checked, ran, and then **deliberately reverted** because it tripped a
stop condition the mission defines explicitly. The patch is reproduced in §7 so it
can be applied the moment the blocker in §5 is resolved.

Nothing here is estimated. Every number was produced by executing the real modules
against `data/mohammadpur/mohammadpur.osm.json` (sha256 `9d88fd3b…d100ec8`).

---

## 1. The gap

`audit:roads` reports Mirpur Road as the single largest absent corridor in the
playable box: OSM `highway=trunk`, ~1.3 km inside the boundary, and **zero**
representation in the runtime graph. The game currently models the streets
*behind* its own trunk road.

## 2. Verified source geometry

Mirpur Road is **not one way** — it is a dual carriageway of 10 OSM ways forming
two one-way 3-lane chains that run in opposite directions:

| chain | OSM ways | direction | in-box length |
|---|---|---|---|
| A | `712156153` → `566490698` → `506461944` → `1063495698` | north → south | 226.27 u = **628.5 m** |
| B | `1094741052` → `1063495688` → `1530347555` → `1063495684` → `1059473760` | south → north | 240.73 u = **668.7 m** |
| | | **total** | 467.00 u = **1,297.2 m** |

**1,297.2 m reproduces the audit's "1,297 m" exactly** — confirming that figure
means *both carriageways combined*, which is the correct basis because the game's
own 15.3 km graph length is likewise summed over centrelines.

Chain endpoints, clipped to the playable box (`x −218..242`, `z −256..248`):

| chain | enters box | leaves box |
|---|---|---|
| A | (163.14, −256.00) on the north edge | (242.00, −43.96) on the east edge |
| B | (242.00, −30.75) on the east edge | (157.23, −256.00) on the north edge |

Measured carriageway separation (min/median/max over chain A's vertices):
**10.6 m / 13.9 m / 19.2 m**. Each carriageway is `width=9.0 m`,
`widthSource="estimated:lanes"` (3 lanes × 3 m), `oneway=yes`, `surface=asphalt`.

### Width, and what is estimated vs measured

- **Measured**: carriageway-centre separation, 13.9 m median (from OSM geometry).
- **Estimated, not surveyed**: the 9.0 m carriageway width. OSM derives it from
  lane count, not from a survey. It must never be described as an official
  measurement.
- **Derived total cross-section**: 13.9 + 9.0 = **22.9 m** kerb-to-kerb. This is
  arithmetic on the two figures above, not a third guess.

## 3. Why one centreline and not two carriageways

The engine's lane builder (`src/ai/routes.ts:62-70`) emits **exactly two lanes per
segment** — `fwd` and `rev` — with **no one-way support**. Modelling both
carriageways as separate segments would therefore put opposing traffic on each
one-way carriageway: two wrong-way lanes per carriageway.

The user's own `docs/ASAD_AVENUE_ARCHITECTURE_REVIEW.md` reaches the same
conclusion for Asad Avenue (Option A first, dual-carriageway Option B deferred),
and the engine has no `median` field at all.

So the model is **one two-way segment on a derived centreline at the full
22.9 m cross-section**. The 4.9 m median cannot be rendered and is a documented
fidelity loss, consistent with how Asad Avenue and Ring Road are already modelled.

## 4. Derived centreline (the actual geometry to use)

Method: sample the true midline (for each vertex of chain A, midpoint to the
nearest point on chain B) → 67 stations; clip to the box → 13 vertices;
Douglas–Peucker at 0.35 u (~0.97 m) → **4 vertices**, max deviation from the
sampled midline **0.90 m**.

```
[0] (160.22, -256.00)   north box edge
[1] (194.05, -162.49)
[2] (226.77, -74.11)
[3] (242.00,  -37.83)   east box edge
```

Total polyline length **647.3 m**.

The real road turns out to be almost straight (chord 196.81 u vs arc 196.81 u for
the first span) with a genuine 0.9 m bow — which is why the polyline is kept
rather than replaced by a chord: the bow is real and the polyline costs two extra
vertices.

## 5. THE BLOCKER — why this was reverted

### What the implementation produced

The patch in §7 was applied in full. It type-checked, built the graph correctly
(73 segments, 45 nodes, 146 lanes, correct `nextLaneIds`), and produced **zero
geometric collisions**: no new segment crosses any existing segment, nearest
approach 50.2–50.3 m.

The **lane baseline** delta was exactly and only what the mission authorises:

```
laneCount                                    140 -> 146     (+2 per new segment)
lanes[aurangzeb_2:fwd].nextLaneIds.length      2 -> 3
lanes[aurangzeb_2:fwd].nextLaneIds[0]   "iqbal_2:rev" -> "aurangzeb_3:fwd"
```

That is a genuine, verified intersection at `iqbal_aurangzeb`, where the real
Aurangzeb Road continues to Mirpur Road.

### What the world baseline did

```
[world] 1645 field(s) would change (digest c60e15b5 -> 243b05b0)
  buildingsBySegment: 61 segment(s) changed
    buildingsBySegment.asad_3    4 -> 3
    buildingsBySegment.chanmia_s 33 -> 29
    buildingsBySegment.babar_link_e 13 -> 4
    ...
```

Measured on the building list itself rather than the per-segment counts:

| | count |
|---|---|
| buildings geometrically identical | **94** |
| buildings that moved or disappeared | **751** |
| new buildings | **750** |
| total | 845 → 844 |

**751 of 845 buildings moved.** That is precisely the outcome the mission
forbids: *"Do not accept broad building redistribution as an automatic
consequence of adding a road."*

### Root cause (isolated experimentally)

1. **Not geometry.** Moving the three new nodes to `(5000, 5000)` — far outside
   the map, touching nothing — still displaced **773** buildings. So the
   disturbance is independent of where the road is.
2. **Not the signal flag.** Removing `signal: true` from the new junction changed
   nothing.
3. **It is the RNG stream offset.** `buildCity` creates **one** generator,
   `mulberry32(20261207)` (`city.ts:228`), and never re-seeds it. The props/tree/
   hump loops draw from it per segment (24 draws per segment), and then the
   **building loop continues on the same stream**. Instrumenting the counter at
   the top of the building loop:

   | segment count | RNG draws consumed before buildings |
   |---|---|
   | 70 (pristine) | **1136** |
   | 73 (with Mirpur) | **1208** |

   The building loop therefore starts reading at stream position 1208 instead of
   1136, so *every* building — starting with the second one on the very first
   segment, `asad_0` — is generated from different random numbers.

**This is a pre-existing architectural coupling, not a defect introduced by
Mirpur Road.** It means *any* future road, gali or corridor added to this map
reshuffles almost the entire city. Until it is fixed, the map cannot grow.

### Why it is a stop, and not something I fixed here

The minimal fix is small and I have validated it conceptually: give the building
generation its **own** generator (`mulberry32(BUILDING_SEED)`) instead of
inheriting the props offset, or seed a sub-stream per segment id. Either makes
building placement independent of the segment count, so adding a road adds only
that road's buildings.

But **that fix itself regenerates all 845 buildings once**, because they would
start from stream position 0 instead of 1136. So it is a one-time, whole-city
baseline change: an approval decision about world generation, *not* part of the
Mirpur Road addition. The mission authorises baseline updates for "the Mirpur Road
addition and directly necessary verified connections" — not for a city-wide
regeneration needed first.

Doing both in one commit would have buried a 845-building city-wide change inside
"added a road", which is exactly the kind of unexplained drift the baseline
policy exists to prevent. **Stopped, documented, patch preserved.**

## 6. What is needed to proceed

1. **Approve the RNG decoupling** (§5), with its one-time 845-building
   regeneration, as its own reviewed change.
2. Then apply §7 unchanged: it will then add ~±2 buildings along Mirpur Road and
   leave the other 845 untouched (to be verified, not assumed).
3. Decide the cross-section: 22.9 m derived (§2) vs the 9.0 m single-carriageway
   figure. This mission chose 22.9 m on the grounds that the modelled roadway
   represents both carriageways.

## 7. The tested patch (apply after §6.1)

### 7a. `src/world/layout.ts` — authored OSM centrelines

Add after `COLLINEAR_SUBDIVISIONS`:

```ts
const CURVED_CENTRELINES: Record<string, readonly Vec2[]> = {
  mirpur_0: [
    { x: 160.22, z: -256.0 },
    { x: 194.05, z: -162.49 },
    { x: 227.88, z: -71.19 },
  ],
  aurangzeb_3: [
    { x: 214, z: -58 },
    { x: 220.04, z: -68.0 },
    { x: 227.88, z: -71.19 },
  ],
};

function applyCurvedCentrelines(): void {
  for (const [id, authored] of Object.entries(CURVED_CENTRELINES)) {
    const seg = segmentMap.get(id);
    if (!seg) throw new Error(`[layout] curved centreline targets unknown segment "${id}"`);
    if (authored.length < 2) throw new Error(`[layout] curved centreline for "${id}" needs at least 2 vertices`);
    if (seg.vertices) throw new Error(`[layout] "${id}" already has a computed centreline`);
    seg.vertices = authored.map((v, i) => {
      if (i === 0) return { x: seg.ax, z: seg.az };
      if (i === authored.length - 1) return { x: seg.bx, z: seg.bz };
      return { x: v.x, z: v.z };
    });
  }
}

applyCollinearSubdivisions();
applyCurvedCentrelines();
```

The endpoint pinning is deliberate: a transcription slip in the first or last
vertex cannot detach a road from its junction.

### 7b. `src/world/mohammadpurData.ts` — nodes

```ts
{ id: 'mirpur_n', x: 160.22, z: -256.00, label: 'Mirpur Road (north gate)' },
{ id: 'mirpur_aurangzeb', x: 227.88, z: -71.19, label: 'Mirpur × Aurangzeb' },
{ id: 'mirpur_e', x: 242.00, z: -37.83, label: 'Mirpur Road (east gate)' },
```

### 7c. `src/world/mohammadpurData.ts` — edges

```ts
{ id: 'mirpur_0', from: 'mirpur_n', to: 'mirpur_aurangzeb', nameEn: 'Mirpur Road', nameBn: 'মিরপুর রোড', kind: 'main', width: 22.9, sidewalk: 2.6, source: 'osm', osmWayId: 566490698 },
{ id: 'mirpur_1', from: 'mirpur_aurangzeb', to: 'mirpur_e', nameEn: 'Mirpur Road', nameBn: 'মিরপুর রোড', kind: 'main', width: 22.9, sidewalk: 2.6, source: 'osm', osmWayId: 506461944 },
{ id: 'aurangzeb_3', from: 'iqbal_aurangzeb', to: 'mirpur_aurangzeb', nameEn: 'Aurangzeb Road', nameBn: 'আওরঙ্গজেব রোড', kind: 'medium', width: 8.8, sidewalk: 2.2, source: 'osm', osmWayId: 1193710462 },
```

`aurangzeb_3` width 8.8 m and `kind: 'medium'` match the two existing Aurangzeb
segments exactly.

> **Note on node coordinates.** These three nodes are *not* on the legacy integer
> grid, because they are projected OSM geometry. That is the correct outcome, but
> `tests/map_import/test_road_provenance.py::test_nodes_have_finite_integer_coordinates`
> asserts integrality for every node and will fail. That test encodes a property of
> the hand-placed graph, not a requirement; it should be narrowed to the legacy
> node set (or replaced by the bbox check, which already exists) when this lands.

## 8. Verification performed on the patch

| check | result |
|---|---|
| TypeScript typecheck | exit 0 |
| Graph | 73 segments / 45 nodes / 146 lanes |
| Endpoints pinned to junctions | yes, all three segments |
| Chord vs arc | `mirpur_0` 196.81 / 196.81 u; `aurangzeb_3` 19.15 / 20.15 u |
| Crossings with existing segments | **0** for all three |
| Nearest approach to existing segments | 50.3 m (`mirpur_0`), 50.2 m (`mirpur_1`) |
| Lane delta | +6 lanes; one `nextLaneIds` insertion at `iqbal_aurangzeb` |
| World baseline | **FAILED** — 751/845 buildings moved (§5) |

The last row is why nothing was committed.

## 9. Connectivity evidence (why this is not an invented connector)

Mirpur Road's real geometry does **not** touch any existing game road — the
nearest game segment is 41.7 m away and **zero** game segment chords cross either
carriageway polyline. Adding Mirpur without a connector would be a disconnected
ribbon: visual coverage with no navigational value.

The connector is real, not invented. Searching the OSM drivable graph from
Mirpur Road over **non-Mirpur ways only**, the nearest approach to any game node
is:

- game node `shahjahan_s` at (58, −22)
- corresponding OSM node at (57.95, −21.53) — **1.3 m away**
- via real ways `1193710462` (Aurangzeb Road) → `1357827144` (Shahjahan Road)

And the current eastern end of the game's Aurangzeb Road, `iqbal_aurangzeb` at
(214, −58), is the real Aurangzeb Road's own alignment; the real road simply
continues east to Mirpur. The two roads share OSM nodes at the junction:

| carriageway | shared OSM node | world |
|---|---|---|
| Aurangzeb eastbound `1193710462` | `6687521117` | (224.44, −73.40) |
| Aurangzeb westbound `566643585` | `5895444920` | (226.69, −67.22) |

Their midpoint (225.56, −70.31) snapped onto the Mirpur midline gives the
junction node **(227.88, −71.19)**, a 6.88 m offset — well inside the 22.9 m
carriageway and correct for a single-centreline model where the two carriageway
junctions sit at slightly different stations.

`aurangzeb_3` therefore extends an already-modelled road along its own real
alignment to a real, OSM-verified junction. It relocates no existing node.
