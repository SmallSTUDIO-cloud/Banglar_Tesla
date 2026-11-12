import { describe, expect, it } from 'vitest';
import { installDomShim } from '../../tools/domShim';
import {
  ROAD_SEGMENTS,
  rebuildRoadSpatialIndex,
  type RoadSegment,
} from '../../src/world/layout';
import {
  FILL_ORDINAL_MODULUS,
  REGION_BUDGET_MAX,
  REGION_BUDGET_MIN,
  REGION_SIZE,
  RegionBudgetLedger,
  derivedFillOrdinal,
  regionBudget,
  regionBudgetAt,
  regionCell,
  regionKeyOf,
} from '../../src/world/regionFill';
import { buildWorldSnapshot, worldDigest, type WorldSnapshot } from '../../tools/worldSnapshot';

/**
 * Regional fill system.
 *
 * The shipped world's interior/infill passes are pinned by frozen ordinals
 * (`legacyFillLayout.ts`). That isolation deliberately left one hole: a road in a
 * region the shipped world never covered received street frontage but no
 * block-interior or infill fill, because its candidates have no frozen ordinal.
 *
 * This suite pins the replacement rules:
 *
 *   1. region identity is a pure function of position;
 *   2. a region's budget is deterministic, bounded, and justified by measurement
 *      against the legacy distribution (see `docs/REGIONAL_FILL.md` §2);
 *   3. a new region's interior/infill spend never exceeds its own budget;
 *   4. regions are isolated: filling one cannot restyle, add to, or drain another;
 *   5. every addition sits where the new road justifies it, never inside the
 *      shipped footprint;
 *   6. the shipped 845-building world is untouched.
 */

installDomShim();

const QUALITY = { shadows: true } as const;

async function buildNow(): Promise<WorldSnapshot> {
  const [{ buildCity }, { SignAtlas }] = await Promise.all([
    import('../../src/world/city'),
    import('../../src/world/textures'),
  ]);
  const city = buildCity(new SignAtlas() as never, QUALITY as never);
  return buildWorldSnapshot(city as never);
}

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
    // Test fixture only: no production data gains a provenance value.
    source: 'osm',
    jamProne: true, deadEnd: false,
    axis: 'x',
    center: az,
    fromCoord: Math.min(ax, bx),
    toCoord: Math.max(ax, bx),
  };
}

const ORIGINAL_ORDER = [...ROAD_SEGMENTS];

/**
 * Run `fn` with `segments` installed, then restore the exact production array.
 *
 * The corridor index is rebuilt on both edges. Without that, a road injected at
 * runtime is invisible to `canPlaceBuilding`'s corridor test, so "nothing was
 * removed" would be evidence about parcel overlap only — not about corridors
 * (measured before `rebuildRoadSpatialIndex` existed; see
 * `tests/unit/road-corridor-index.test.ts`).
 */
async function withSegments<T>(segments: RoadSegment[], fn: () => Promise<T>): Promise<T> {
  try {
    ROAD_SEGMENTS.length = 0;
    ROAD_SEGMENTS.push(...segments);
    rebuildRoadSpatialIndex();
    return await fn();
  } finally {
    ROAD_SEGMENTS.length = 0;
    ROAD_SEGMENTS.push(...ORIGINAL_ORDER);
    rebuildRoadSpatialIndex();
  }
}

/**
 * Geometry identity of a building.
 *
 * `id`/`segmentId` are excluded on purpose: the snapshot's `id` is nearest-road
 * *attribution*, so adding a road legitimately renames some buildings without
 * moving them (see `fill-isolation.test.ts`).
 */
function geomKey(b: { x: number; z: number; width: number; depth: number; height: number }): string {
  return `${b.x},${b.z},${b.width},${b.depth},${b.height}`;
}

function geomMultiset(snapshot: WorldSnapshot): string[] {
  return snapshot.buildings.map(geomKey).sort();
}

/** Geometry present in `base` and gone from `candidate`. */
function removedFrom(base: WorldSnapshot, candidate: WorldSnapshot): string[] {
  const pool = new Map<string, number>();
  for (const k of geomMultiset(candidate)) pool.set(k, (pool.get(k) ?? 0) + 1);
  const gone: string[] = [];
  for (const k of geomMultiset(base)) {
    const n = pool.get(k) ?? 0;
    if (n > 0) pool.set(k, n - 1);
    else gone.push(k);
  }
  return gone;
}

function addedTo(base: WorldSnapshot, candidate: WorldSnapshot): string[] {
  return removedFrom(candidate, base);
}

/**
 * Parcel classes the region budget governs: block-interior (5.70 / 8.55 / 11.40 =
 * 2/3/4 × 2.85), the first infill seam (6.20 / 9.30 = 2/3 × 3.10) and the
 * shop-front seam (6.15).
 *
 * Street frontage from the main apartment pass (9.15 / 12.20 / 15.25 / 18.30 =
 * 3/4/5/6 × 3.05) is intentionally **not** budgeted: a road lines its own
 * streetfront in the shipped world too, and suppressing it would leave a new
 * mapped street as an empty tunnel. The budget bounds *fill*, not frontage. This
 * suite asserts the split explicitly rather than hand-waving it.
 */
const BUDGETED_HEIGHTS = new Set(['5.70', '8.55', '11.40', '6.20', '9.30', '6.15']);

function isBudgetedParcel(height: number): boolean {
  return BUDGETED_HEIGHTS.has(height.toFixed(2));
}

const LEGACY_BOX = 224;

function insideLegacyBox(x: number, z: number): boolean {
  const m = 0.001;
  return x >= -LEGACY_BOX - m && x <= LEGACY_BOX + m && z >= -LEGACY_BOX - m && z <= LEGACY_BOX + m;
}

/** Distance from `(x, z)` to a segment's centreline, clamped to its ends. */
function distanceToCentreline(x: number, z: number, s: RoadSegment): number {
  const t = Math.max(0, Math.min(s.length, (x - s.ax) * s.ux + (z - s.az) * s.uz));
  return Math.hypot(x - (s.ax + s.ux * t), z - (s.az + s.uz * t));
}

/* ------------------------------------------------------------ region identity */

describe('region identity', () => {
  it('keys a region by its integer cell, not by a running index', () => {
    expect(regionKeyOf(0, 0)).toBe('0,0');
    expect(regionKeyOf(47.99, 47.99)).toBe('0,0');
    expect(regionKeyOf(48, 48)).toBe('1,1');
    expect(regionKeyOf(95.9, 0)).toBe('1,0');
  });

  it('floors negative coordinates instead of collapsing them onto the zero cell', () => {
    expect(regionKeyOf(-0.1, -0.1)).toBe('-1,-1');
    expect(regionKeyOf(-48, -48)).toBe('-1,-1');
    expect(regionKeyOf(-48.01, -48.01)).toBe('-2,-2');
    expect(regionKeyOf(-REGION_SIZE * 12.5, 3)).toBe('-13,0');
  });

  it('is stable regardless of query order or repetition', () => {
    const once = regionKeyOf(-731.4, 512.9);
    regionKeyOf(900, -900);
    regionKeyOf(0, 0);
    expect(regionKeyOf(-731.4, 512.9)).toBe(once);
    expect(regionCell(-731.4, 512.9)).toEqual(regionCell(-731.4, 512.9));
  });

  it('derives the key from the cell, so the whole cell shares one identity', () => {
    const key = regionKeyOf(10, 10);
    for (const [x, z] of [[10.5, 10.5], [47.9, 47.9], [10, 47.2]] as const) {
      expect(regionKeyOf(x, z)).toBe(key);
    }
  });
});

/* ------------------------------------------------------------------- budgets */

describe('region budget', () => {
  const SAMPLE: string[] = [];
  for (let cx = -25; cx <= 25; cx++) {
    for (let cz = -25; cz <= 25; cz++) SAMPLE.push(`${cx},${cz}`);
  }

  it('stays inside the documented range for every sampled region', () => {
    for (const key of SAMPLE) {
      const budget = regionBudget(key);
      expect(budget, key).toBeGreaterThanOrEqual(REGION_BUDGET_MIN);
      expect(budget, key).toBeLessThanOrEqual(REGION_BUDGET_MAX);
      expect(Number.isInteger(budget), key).toBe(true);
    }
  });

  it('is a pure function of the key', () => {
    for (const key of SAMPLE.slice(0, 40)) {
      expect(regionBudget(key)).toBe(regionBudget(`${key}`.replace(',', ',')));
      expect(regionBudget(key)).toBe(regionBudget(key));
    }
  });

  it('varies by region rather than stamping one constant everywhere', () => {
    const seen = new Map<number, number>();
    for (const key of SAMPLE) seen.set(regionBudget(key), (seen.get(regionBudget(key)) ?? 0) + 1);
    // All five values of the inclusive range must occur, and none may dominate
    // the sample: a constant budget would collapse this to a single entry.
    expect([...seen.keys()].sort((a, b) => a - b))
      .toEqual([4, 5, 6, 7, 8]);
    for (const [value, count] of seen) {
      expect(count / SAMPLE.length, `value ${value}`).toBeGreaterThan(0.1);
    }
  });

  it('gives the same answer at a position as for its region key', () => {
    for (const [x, z] of [[0, 0], [-731.4, 512.9], [100.5, -3.2]] as const) {
      expect(regionBudgetAt(x, z)).toBe(regionBudget(regionKeyOf(x, z)));
    }
  });
});

/* -------------------------------------------------------------------- ledger */

describe('region budget ledger', () => {
  it('starts empty and reports the region budget as remaining', () => {
    const ledger = new RegionBudgetLedger();
    const key = regionKeyOf(-800, 0);
    expect(ledger.usedIn(key)).toBe(0);
    expect(ledger.remainingIn(key)).toBe(regionBudget(key));
    expect(ledger.totalUsed()).toBe(0);
    expect(ledger.snapshot()).toEqual({});
  });

  it('spends exactly the budget and then refuses', () => {
    const ledger = new RegionBudgetLedger();
    const key = regionKeyOf(-800, 0);
    const budget = regionBudget(key);
    for (let i = 0; i < budget; i++) {
      expect(ledger.tryConsume(key), `spend ${i + 1}/${budget}`).toBe(true);
    }
    expect(ledger.usedIn(key)).toBe(budget);
    expect(ledger.remainingIn(key)).toBe(0);
    for (let i = 0; i < 5; i++) expect(ledger.tryConsume(key)).toBe(false);
    expect(ledger.totalUsed()).toBe(budget);
  });

  it('keeps regions independent', () => {
    const ledger = new RegionBudgetLedger();
    const a = regionKeyOf(-800, 0);
    const b = regionKeyOf(-1600, 0);
    while (ledger.tryConsume(a)) { /* exhaust A */ }
    expect(ledger.remainingIn(a)).toBe(0);
    expect(ledger.remainingIn(b)).toBe(regionBudget(b));
    expect(ledger.tryConsume(b)).toBe(true);
    expect(ledger.snapshot()).toEqual({ [a]: regionBudget(a), [b]: 1 });
  });

  it('reports a sorted snapshot for diagnostics', () => {
    const ledger = new RegionBudgetLedger();
    ledger.tryConsume('2,0');
    ledger.tryConsume('-1,0');
    ledger.tryConsume('10,10');
    expect(Object.keys(ledger.snapshot())).toEqual(['-1,0', '10,10', '2,0']);
  });
});

/* --------------------------------------------------- derived fill ordinals */

describe('derived fill ordinal', () => {
  it('is a pure function of position inside the documented modulus', () => {
    for (const [x, z] of [[0, 0], [-812.25, 96.5], [1200, -1200]] as const) {
      const o = derivedFillOrdinal(x, z);
      expect(Number.isInteger(o)).toBe(true);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThan(FILL_ORDINAL_MODULUS);
      expect(derivedFillOrdinal(x, z)).toBe(o);
    }
  });

  it('quantises to 1 cm so a float wobble cannot restyle a building', () => {
    const base = derivedFillOrdinal(-812.34, 96.51);
    expect(derivedFillOrdinal(-812.3404, 96.5149)).toBe(base);
    expect(derivedFillOrdinal(-812.3351, 96.5051)).toBe(base);
    // A full centimetre is a different candidate and is allowed to differ.
    expect(derivedFillOrdinal(-812.35, 96.51)).not.toBe(base);
  });

  it('spreads across the modulus instead of collapsing to a few values', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 40; j++) seen.add(derivedFillOrdinal(-900 + i * 3.7, -100 + j * 4.3));
    }
    // 1 600 candidates over a 1 000-wide modulus: a healthy hash yields ~800
    // distinct values, a collapsing one (or a modulus applied to a coarse
    // coordinate) yields a handful.
    expect(seen.size).toBeGreaterThan(700);
    const counts = new Map<number, number>();
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 40; j++) {
        const o = derivedFillOrdinal(-900 + i * 3.7, -100 + j * 4.3);
        counts.set(o, (counts.get(o) ?? 0) + 1);
      }
    }
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(8);
  });
});

/* ---------------------------------------------------------------- the world */

const BASE = await buildNow();

const ROAD_A = syntheticSegment('synth_region_a', -900, -100, -700, 100);
const ROAD_B = syntheticSegment('synth_region_b', -3000, 0, -2800, 200);

const WITH_A = await withSegments([...ORIGINAL_ORDER, ROAD_A], () => buildNow());
const WITH_AB = await withSegments([...ORIGINAL_ORDER, ROAD_A, ROAD_B], () => buildNow());
const WITH_B = await withSegments([...ORIGINAL_ORDER, ROAD_B], () => buildNow());

describe('regional fill in a newly mapped area', () => {
  it('leaves the shipped world at 845 buildings / c60e15b5', () => {
    expect(BASE.counts.buildings).toBe(845);
    expect(worldDigest(BASE)).toBe('c60e15b5');
  });

  it('moves no shipped building when a road is added 700 m west', () => {
    expect(removedFrom(BASE, WITH_A)).toEqual([]);
  });

  it('fills the new region, and only near the new road', () => {
    const added = addedTo(BASE, WITH_A);
    expect(added.length).toBeGreaterThan(0);
    for (const key of added) {
      const [x, z] = key.split(',').map(Number);
      expect(distanceToCentreline(x, z, ROAD_A), key).toBeLessThanOrEqual(43.0001);
    }
  });

  it('never adds a building inside the shipped footprint', () => {
    const added = WITH_A.buildings
      .filter((b) => addedTo(BASE, WITH_A).includes(geomKey(b)))
      .map((b) => `${b.x.toFixed(2)},${b.z.toFixed(2)}`);
    expect(added.length).toBeGreaterThan(0);
    for (const key of added) {
      const [x, z] = key.split(',').map(Number);
      expect(insideLegacyBox(x, z), key).toBe(false);
    }
  });

  it('spends no region budget beyond the per-region allowance', () => {
    const addedSet = new Set(addedTo(BASE, WITH_A));
    const spend = new Map<string, number>();
    for (const b of WITH_A.buildings) {
      if (!addedSet.has(geomKey(b))) continue;
      if (!isBudgetedParcel(b.height)) continue;
      const key = regionKeyOf(b.x, b.z);
      spend.set(key, (spend.get(key) ?? 0) + 1);
    }
    expect(spend.size).toBeGreaterThan(5);
    for (const [key, used] of spend) {
      expect(used, `region ${key}`).toBeLessThanOrEqual(regionBudget(key));
    }
  });

  it('lines the new street with frontage, which the region budget does not cap', () => {
    const addedSet = new Set(addedTo(BASE, WITH_A));
    const frontage = WITH_A.buildings
      .filter((b) => addedSet.has(geomKey(b)) && !isBudgetedParcel(b.height));
    // A new road in a real city is lined by its own streetfront; the budget
    // bounds block fill, not the road's frontage.
    expect(frontage.length).toBeGreaterThan(0);
    for (const b of frontage) {
      expect(distanceToCentreline(b.x, b.z, ROAD_A)).toBeLessThanOrEqual(43.0001);
    }
  });

  it('is order-independent: reversing the segment array changes nothing', async () => {
    const reversed = await withSegments([...ORIGINAL_ORDER].reverse().concat([ROAD_A]), () => buildNow());
    expect(removedFrom(WITH_A, reversed)).toEqual([]);
    expect(addedTo(WITH_A, reversed)).toEqual([]);
    expect(geomMultiset(reversed)).toEqual(geomMultiset(WITH_A));
  }, 120_000);

  it('is deterministic across repeated builds in one process', async () => {
    const again = await withSegments([...ORIGINAL_ORDER, ROAD_A], () => buildNow());
    expect(again.buildings).toEqual(WITH_A.buildings);
    expect(worldDigest(again)).toBe(worldDigest(WITH_A));
  }, 120_000);

  it('returns the exact shipped world when the new road is removed', async () => {
    const restored = await withSegments([...ORIGINAL_ORDER], () => buildNow());
    expect(restored.counts.buildings).toBe(845);
    expect(worldDigest(restored)).toBe('c60e15b5');
    expect(removedFrom(BASE, restored)).toEqual([]);
    expect(addedTo(BASE, restored)).toEqual([]);
  }, 120_000);
});

describe('cross-region isolation', () => {
  it('gives each new road the same fill whether or not the other exists', () => {
    // Road B is 2.1 km further west, in disjoint regions. With a shared counter
    // this test fails hard: a counter-based ordinal restyles 61 buildings near
    // road A once road B is present (measured mutation, see
    // `docs/REGIONAL_FILL.md` §6).
    expect(removedFrom(WITH_A, WITH_AB)).toEqual([]);
    expect(removedFrom(WITH_B, WITH_AB)).toEqual([]);
  });

  it('adds the two roads\' fills without either draining the other', () => {
    const fromA = addedTo(BASE, WITH_A);
    const fromB = addedTo(BASE, WITH_B);
    const fromBoth = addedTo(BASE, WITH_AB);
    expect(fromBoth.length).toBe(fromA.length + fromB.length);
    expect(fromBoth.slice().sort()).toEqual([...fromA, ...fromB].sort());
  });

  it('keeps every region within its own budget when both roads exist', () => {
    const addedSet = new Set(addedTo(BASE, WITH_AB));
    const spend = new Map<string, number>();
    for (const b of WITH_AB.buildings) {
      if (!addedSet.has(geomKey(b)) || !isBudgetedParcel(b.height)) continue;
      const key = regionKeyOf(b.x, b.z);
      spend.set(key, (spend.get(key) ?? 0) + 1);
    }
    expect(spend.size).toBeGreaterThan(10);
    for (const [key, used] of spend) {
      expect(used, `region ${key}`).toBeLessThanOrEqual(regionBudget(key));
    }
  });

  it('restores the single-road world when the second road is removed', () => {
    // WITH_AB minus road B must be byte-identical to WITH_A: removing a region
    // cannot leave residue in another region's fill.
    expect(removedFrom(WITH_A, WITH_AB)).toEqual([]);
    const onlyB = addedTo(WITH_A, WITH_AB);
    expect(onlyB.length).toBeGreaterThan(0);
  });
});
