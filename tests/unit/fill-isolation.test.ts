import { describe, expect, it } from 'vitest';
import { installDomShim } from '../../tools/domShim';
import { ROAD_SEGMENTS, rebuildRoadSpatialIndex, type RoadSegment } from '../../src/world/layout';
import {
  canonicalSegments,
  isLegacyRoadSegment,
  LEGACY_INFILL_ORDINALS,
  LEGACY_INTERIOR_ORDINALS,
  LEGACY_SEGMENT_ORDER,
  legacyInfillOrdinal,
  legacyInteriorOrdinal,
} from '../../src/world/legacyFillLayout';
import { buildWorldSnapshot, worldDigest, type WorldSnapshot } from '../../tools/worldSnapshot';

/**
 * Interior / infill generation isolation.
 *
 * Before this work, `buildCity()` generated four building passes that read road
 * order and shared running counters:
 *
 *   main apartment  -> ROAD_SEGMENTS array order
 *   infill strip    -> ROAD_SEGMENTS order + `infillCount`
 *   block interior  -> fixed grid, but ordered by distance to *every* placed
 *                      building and sized by `interiorCount`
 *   shop-front fill -> ROAD_SEGMENTS order + `infillCount` (shared)
 *
 * Merely **reversing** `ROAD_SEGMENTS` replaced 674 of 845 buildings; adding a
 * test road through the city replaced 162. Both are reproduced by the
 * perturbations below, which now expect zero.
 *
 * The perturbations mutate the live `ROAD_SEGMENTS` array inside a try/finally
 * and always restore it. Nothing is written to the repository, so the production
 * gameplay graph is untouched.
 */

installDomShim();

const BASELINE_QUALITY = { shadows: true } as const;

async function buildNow(): Promise<WorldSnapshot> {
  const [{ buildCity }, { SignAtlas }] = await Promise.all([
    import('../../src/world/city'),
    import('../../src/world/textures'),
  ]);
  const city = buildCity(new SignAtlas() as never, BASELINE_QUALITY as never);
  return buildWorldSnapshot(city as never);
}

/** A straight segment reusing the real schema, parked wherever we need it. */
function syntheticSegment(id: string, ax: number, az: number, bx: number, bz: number): RoadSegment {
  const length = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / length;
  const uz = (bz - az) / length;
  return {
    id,
    from: `${id}_a`,
    to: `${id}_b`,
    ax, az, bx, bz,
    length, ux, uz,
    leftX: uz, leftZ: -ux,
    width: 9, halfWidth: 4.5, sidewalk: 1.5,
    kind: 'main',
    nameEn: id, nameBn: id,
    // Test fixture only: reuses the closest existing source tag; nothing is
    // exported or persisted and no production data gains a new provenance value.
    source: 'osm',
    jamProne: true, deadEnd: false,
    axis: 'x',
    center: az,
    fromCoord: Math.min(ax, bx),
    toCoord: Math.max(ax, bx),
  };
}

/**
 * Run `fn` with `ro` installed as `ROAD_SEGMENTS`, then restore the exact array.
 *
 * The corridor index is rebuilt on both edges. Earlier revisions of this file did
 * not rebuild it, so a segment injected here was invisible to
 * `isFootprintClearOfCorridor`: placements could land on its carriageway and
 * perturbations reported zero removals that the index could not have seen
 * (Gap B, `docs/REGIONAL_FILL.md` §4). Every conclusion below is now drawn
 * against the index the running game would use.
 */
async function withSegments<T>(ro: RoadSegment[], fn: () => Promise<T>): Promise<T> {
  const original = [...ROAD_SEGMENTS];
  try {
    ROAD_SEGMENTS.length = 0;
    ROAD_SEGMENTS.push(...ro);
    rebuildRoadSpatialIndex();
    return await fn();
  } finally {
    ROAD_SEGMENTS.length = 0;
    ROAD_SEGMENTS.push(...original);
    rebuildRoadSpatialIndex();
  }
}

const ORIGINAL_ORDER = [...ROAD_SEGMENTS];
const ORIGINAL_IDS = ORIGINAL_ORDER.map((s) => s.id);

/**
 * Geometry identity of a building: position and footprint, no attribution.
 *
 * Deliberately excludes `id` and `segmentId`. The snapshot's `id` is
 * `<nearest segment>:<x>,<z>`, computed by `nearestSegmentId`, so it is
 * **nearest-road attribution** — not generation provenance. Adding a road
 * legitimately changes which road some buildings are nearest to, with no change
 * to the buildings themselves. Comparing ids would report 39 phantom
 * "removals" for a road that moved nothing (measured).
 */
function geomKey(b: { x: number; z: number; width: number; depth: number; height: number }): string {
  return `${b.x},${b.z},${b.width},${b.depth},${b.height}`;
}

function geomMultiset(snapshot: WorldSnapshot): string[] {
  return snapshot.buildings.map(geomKey).sort();
}

/** Geometry present before and gone after — a real vanished building. */
function removedFrom(base: WorldSnapshot, candidate: WorldSnapshot) {
  const remaining = [...geomMultiset(candidate)];
  const pool = new Map<string, number>();
  for (const k of remaining) pool.set(k, (pool.get(k) ?? 0) + 1);
  const gone: string[] = [];
  for (const k of geomMultiset(base)) {
    const n = pool.get(k) ?? 0;
    if (n > 0) pool.set(k, n - 1);
    else gone.push(k);
  }
  return gone;
}

/** Geometry present after and absent before — a genuinely new building. */
function addedTo(base: WorldSnapshot, candidate: WorldSnapshot) {
  return removedFrom(candidate, base);
}

describe('frozen legacy fill layout', () => {
  it('lists exactly the real legacy segment set, once each', () => {
    expect(LEGACY_SEGMENT_ORDER.length).toBe(70);
    expect(new Set(LEGACY_SEGMENT_ORDER).size).toBe(70);
    expect([...LEGACY_SEGMENT_ORDER].sort()).toEqual([...ORIGINAL_IDS].sort());
  });

  it('records a contiguous infill ordinal for every shipped infill candidate', () => {
    const values = Object.values(LEGACY_INFILL_ORDINALS).sort((a, b) => a - b);
    expect(values.length).toBe(118);
    expect(values).toEqual(Array.from({ length: 118 }, (_, i) => i));
  });

  it('records a contiguous interior ordinal for every shipped interior candidate', () => {
    const values = Object.values(LEGACY_INTERIOR_ORDINALS).sort((a, b) => a - b);
    expect(values.length).toBe(160);
    expect(values).toEqual(Array.from({ length: 160 }, (_, i) => i));
  });

  it('never reports a negative or non-integer ordinal', () => {
    for (const [k, v] of Object.entries({ ...LEGACY_INFILL_ORDINALS, ...LEGACY_INTERIOR_ORDINALS })) {
      expect(Number.isInteger(v), `${k} is not an integer`).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('looks ordinals up by coordinate, not by call order', () => {
    // The same key must return the same ordinal no matter what else was asked
    // for first — this is the whole point of replacing the running counter.
    const firstKey = Object.keys(LEGACY_INTERIOR_ORDINALS)[0];
    const [x, z] = firstKey.split(',').map(Number);
    const direct = legacyInteriorOrdinal(x, z);
    for (const other of Object.keys(LEGACY_INTERIOR_ORDINALS).slice(0, 20)) {
      const [ox, oz] = other.split(',').map(Number);
      legacyInteriorOrdinal(ox, oz);
    }
    expect(legacyInteriorOrdinal(x, z)).toBe(direct);
    expect(direct).toBe(LEGACY_INTERIOR_ORDINALS[firstKey]);
  });

  it('returns undefined for a candidate the shipped world never contained', () => {
    expect(legacyInteriorOrdinal(9999, 9999)).toBeUndefined();
    expect(legacyInfillOrdinal(9999, 9999)).toBeUndefined();
  });
});

describe('canonical segment order', () => {
  it('is a pure function of the id set: array order does not matter', () => {
    const forward = canonicalSegments(ROAD_SEGMENTS).map((s) => s.id);
    const backward = canonicalSegments([...ROAD_SEGMENTS].reverse()).map((s) => s.id);
    const shuffled = canonicalSegments(
      [...ROAD_SEGMENTS].sort((a, b) => (a.id < b.id ? 1 : -1)),
    ).map((s) => s.id);
    expect(backward).toEqual(forward);
    expect(shuffled).toEqual(forward);
  });

  it('keeps legacy segments in their frozen order', () => {
    expect(canonicalSegments(ROAD_SEGMENTS).map((s) => s.id)).toEqual(LEGACY_SEGMENT_ORDER);
  });

  it('places new segments after every legacy one, sorted by id', () => {
    const extra = [
      syntheticSegment('zzz_new', 900, 900, 1000, 900),
      syntheticSegment('aaa_new', 900, 950, 1000, 950),
    ];
    const order = canonicalSegments([...extra, ...ROAD_SEGMENTS]).map((s) => s.id);
    expect(order.slice(0, 70)).toEqual(LEGACY_SEGMENT_ORDER);
    expect(order.slice(70)).toEqual(['aaa_new', 'zzz_new']);
  });

  it('drops ids that are absent rather than emitting holes', () => {
    const without = ROAD_SEGMENTS.filter((s) => s.id !== 'asad_0');
    const order = canonicalSegments(without).map((s) => s.id);
    expect(order).not.toContain('asad_0');
    expect(order.length).toBe(69);
  });

  it('classifies legacy ids correctly', () => {
    expect(isLegacyRoadSegment('asad_0')).toBe(true);
    expect(isLegacyRoadSegment('mirpur_0')).toBe(false);
    expect(isLegacyRoadSegment('')).toBe(false);
  });
});

// One live build of the shipped world, shared by the perturbations below.
const BASE = await buildNow();

describe('interior / infill isolation', () => {
  it('still builds the shipped 845-building world', () => {
    expect(BASE.counts.buildings).toBe(845);
    expect(worldDigest(BASE)).toBe('c60e15b5');
  });

  it('is unaffected by reversing the segment array', () => {
    // Was 674 replaced before isolation. Array order is no longer an input.
    return withSegments([...ORIGINAL_ORDER].reverse(), async () => {
      const reversed = await buildNow();
      expect(removedFrom(BASE, reversed)).toEqual([]);
      expect(addedTo(BASE, reversed)).toEqual([]);
      // Attribution is unchanged too, so the whole snapshot matches.
      expect(worldDigest(reversed)).toBe(worldDigest(BASE));
    }).then(() => undefined);
  }, 120_000);

  it('is unaffected by an arbitrary reordering', () => {
    const shuffled = [...ORIGINAL_ORDER].sort((a, b) => (a.id.split('').reverse().join('') < b.id.split('').reverse().join('') ? -1 : 1));
    return withSegments(shuffled, async () => {
      const out = await buildNow();
      expect(removedFrom(BASE, out)).toEqual([]);
      expect(addedTo(BASE, out)).toEqual([]);
    }).then(() => undefined);
  }, 120_000);

  it('keeps every legacy building when a road is added far away', async () => {
    // Was already safe for the primary pass; the interior/infill passes were not.
    const far = syntheticSegment('synth_far', 5000, 0, 5180, 0);
    const out = await withSegments([...ORIGINAL_ORDER, far], () => buildNow());
    expect(removedFrom(BASE, out)).toEqual([]);
    // The new road does get its own frontage; that is expected and local.
    const addedGeoms = addedTo(BASE, out);
    expect(addedGeoms.length).toBeGreaterThan(0);
    for (const g of addedGeoms) expect(Number(g.split(',')[0])).toBeGreaterThan(4000);
  }, 120_000);

  it('never moves or resizes a shipped building when a road is added through the city', async () => {
    // The hard case. Before isolation 162 shipped buildings were *replaced*
    // (60 main, 70 interior, 20 infill, 12 shop-front) — displaced candidates,
    // not deliberate removals.
    //
    // What remains is a different, pre-existing question: a road driven through
    // the mapped blocks evicts the buildings it and its corridor displace. With
    // the corridor index rebuilt that is 54 buildings, and it is exactly 54 at
    // `9f3e26e` too (measured: the same set) — the building-vs-road precedence
    // policy, unchanged by fill isolation and deliberately not decided here.
    const near = syntheticSegment('synth_near', -60, -200, 60, 160);
    const out = await withSegments([...ORIGINAL_ORDER, near], () => buildNow());
    expect(removedFrom(BASE, out).length).toBe(54);

    // Isolation's actual guarantee: every building that survives is the same
    // building, byte for byte. Nothing is resized, re-styled or nudged by the
    // new road's candidates.
    const survivors = new Map<string, string>();
    for (const b of out.buildings) survivors.set(`${b.x},${b.z}`, geomKey(b));
    let resized = 0;
    for (const b of BASE.buildings) {
      const after = survivors.get(`${b.x},${b.z}`);
      if (after !== undefined && after !== geomKey(b)) resized++;
    }
    expect(resized).toBe(0);
  }, 120_000);

  it('does not let a new road resize the shipped block interiors', async () => {
    // The original form of this test asserted that *no* interior building
    // disappeared. That passed only because the corridor index was stale and
    // could not see the new road; with the index rebuilt, the 3 interiors the
    // carriageway subsumes are genuinely gone (see the eviction test above).
    // What the budget system must guarantee is that no interior building is
    // *resized* or re-styled by another region's spend.
    const near = syntheticSegment('synth_budget', -60, -200, 60, 160);
    const out = await withSegments([...ORIGINAL_ORDER, near], () => buildNow());
    const interiorHeights = new Set(['5.70', '8.55', '11.40']);
    const survivors = new Map<string, string>();
    for (const b of out.buildings) survivors.set(`${b.x},${b.z}`, geomKey(b));
    const changed: string[] = [];
    let displaced = 0;
    for (const b of BASE.buildings) {
      if (!interiorHeights.has(b.height.toFixed(2))) continue;
      const after = survivors.get(`${b.x},${b.z}`);
      if (after === undefined) displaced++;
      else if (after !== geomKey(b)) changed.push(geomKey(b));
    }
    expect(changed).toEqual([]);
    // The only interiors that may disappear are the ones the new carriageway
    // physically displaces — a handful, never the 160-building population.
    expect(displaced).toBe(3);
  }, 120_000);

  it('is deterministic across repeated builds in one process', async () => {
    const a = await buildNow();
    const b = await buildNow();
    expect(worldDigest(b)).toBe(worldDigest(a));
    expect(b.buildings).toEqual(a.buildings);
  }, 120_000);

  it('produces no duplicate building ids after a topology change', async () => {
    const near = syntheticSegment('synth_dup', -60, -200, 60, 160);
    const out = await withSegments([...ORIGINAL_ORDER, near], () => buildNow());
    const ids = out.buildings.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  }, 120_000);
});
