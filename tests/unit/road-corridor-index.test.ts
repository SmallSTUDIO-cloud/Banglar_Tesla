import { describe, expect, it } from 'vitest';
import { installDomShim } from '../../tools/domShim';
import {
  GRAPH_NODES,
  ROAD_SEGMENTS,
  distanceToRoadCarriageway,
  isFootprintClearOfCorridor,
  rebuildRoadSpatialIndex,
  roadSpatialIndexHasSegmentAt,
  roadSpatialIndexStats,
  type RoadSegment,
} from '../../src/world/layout';
import { buildWorldSnapshot, type WorldSnapshot } from '../../tools/worldSnapshot';

/**
 * Gap B — is a newly added road actually in the corridor index?
 *
 * The corridor index (a 28 × 28 spatial hash of segments and graph nodes, cell
 * size 24) was built **once**, at `layout.ts` module load. Any segment added to
 * `ROAD_SEGMENTS` afterwards was invisible to `distanceToRoadCarriageway`,
 * `distanceToRoadCorridor` and `isFootprintClearOfCorridor` until reload.
 *
 * That made earlier collision evidence hollow: perturbation tests that injected a
 * road reported "0 buildings removed", but the check that should have blocked
 * placement on the new carriageway could not see the road at all. The behaviour
 * is not hypothetical — at the same probe point below the stale index reports a
 * footprint 17.81 m clear of every carriageway, and the rebuilt index reports it
 * 4.50 m *inside* the new one.
 *
 * This suite pins three things: the index's explicit rebuild lifecycle, that the
 * rebuilt index really does resolve the injected road, and that no building in
 * the generated world occupies any carriageway — new road included.
 */

installDomShim();

const QUALITY = { shadows: true } as const;

interface CityLike {
  colliders: unknown[];
}

/** The live generator output: colliders carry the oriented footprints. */
async function buildCityNow(): Promise<CityLike> {
  const [{ buildCity }, { SignAtlas }] = await Promise.all([
    import('../../src/world/city'),
    import('../../src/world/textures'),
  ]);
  return buildCity(new SignAtlas() as never, QUALITY as never) as unknown as CityLike;
}

async function buildNow(): Promise<WorldSnapshot> {
  return buildWorldSnapshot((await buildCityNow()) as never);
}

/** Colliders that carry an oriented footprint; the rest cannot be SAT-tested. */
interface Footprinted {
  cx: number;
  cz: number;
  yaw: number;
  halfX: number;
  halfZ: number;
  height: number;
  kind: string;
}

function hasFootprint(c: unknown): c is Footprinted {
  const v = c as Record<string, unknown>;
  return typeof v.cx === 'number' && typeof v.cz === 'number'
    && typeof v.yaw === 'number' && typeof v.halfX === 'number'
    && typeof v.halfZ === 'number' && typeof v.height === 'number';
}

function syntheticSegment(id: string, ax: number, az: number, bx: number, bz: number): RoadSegment {
  const length = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / length;
  const uz = (bz - az) / length;
  return {
    id, from: `${id}_a`, to: `${id}_b`,
    ax, az, bx, bz,
    length, ux, uz, leftX: uz, leftZ: -ux,
    width: 9, halfWidth: 4.5, sidewalk: 1.5,
    kind: 'main', nameEn: id, nameBn: id,
    source: 'osm',
    jamProne: true, deadEnd: false,
    axis: 'x', center: az,
    fromCoord: Math.min(ax, bx), toCoord: Math.max(ax, bx),
  };
}

/**
 * A road driven straight through the mapped blocks. The probe is a point 20 %
 * along it, chosen because it sits on empty ground in the shipped world (17.81 m
 * from any carriageway) and under the new road once the index knows about it.
 */
const NEAR = syntheticSegment('synth_corridor', -60, -200, 60, 160);
const PROBE = { x: -36, z: -128 };

const ORIGINAL_ORDER = [...ROAD_SEGMENTS];

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

const BASE_STATS = roadSpatialIndexStats();

/**
 * SAT corridor test over every *building* collider that has an oriented
 * footprint. Props (trees, benches, signposts, plaza dressing — 387 of them) are
 * deliberately excluded: they sit on sidewalks and are not buildings.
 */
function scores(colliders: readonly unknown[]): { checked: number; violations: Footprinted[] } {
  const buildings = colliders.filter((c) => (c as { kind?: string }).kind === 'building');
  const withFoot = buildings.filter(hasFootprint);
  const violations = withFoot.filter((c) => !isFootprintClearOfCorridor(c.cx, c.cz, c.halfX * 2, c.halfZ * 2, c.yaw, 0.55));
  return { checked: withFoot.length, violations };
}

/**
 * Minimum carriageway distance over a 9 × 9 sample of an axis-aligned box.
 *
 * The three authored height-8 structures carry no `yaw`, so SAT cannot be run on
 * them; sampling their box is the honest substitute, and it is what lets this
 * suite test them instead of skipping them.
 */
function minCarriagewayDistance(c: { minX: number; maxX: number; minZ: number; maxZ: number }): number {
  let min = Infinity;
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) {
      const x = c.minX + ((c.maxX - c.minX) * i) / 8;
      const z = c.minZ + ((c.maxZ - c.minZ) * j) / 8;
      min = Math.min(min, distanceToRoadCarriageway(x, z));
    }
  }
  return min;
}

describe('corridor index lifecycle', () => {
  it('indexes the whole shipped graph at module load', () => {
    expect(BASE_STATS.cells).toBe(28 * 28);
    expect(BASE_STATS.cellSize).toBe(24);
    expect(BASE_STATS.gridMin).toBe(-312);
    expect(BASE_STATS.gridCols).toBe(28);
    expect(BASE_STATS.distinctSegments).toBe(ROAD_SEGMENTS.length);
    expect(BASE_STATS.distinctSegments).toBe(70);
    // Bucketed per cell, so segments appear in several cells and the entry count
    // exceeds the distinct count. Nodes are bucketed the same way.
    expect(BASE_STATS.segmentEntries).toBeGreaterThan(BASE_STATS.distinctSegments);
    expect(BASE_STATS.nodeEntries).toBeGreaterThanOrEqual(GRAPH_NODES.length);
  });

  it('is idempotent and leaves no residue after a rebuild', () => {
    const before = roadSpatialIndexStats();
    rebuildRoadSpatialIndex();
    expect(roadSpatialIndexStats()).toEqual(before);
    rebuildRoadSpatialIndex();
    expect(roadSpatialIndexStats()).toEqual(before);
  });

  it('only sees a new segment after an explicit rebuild — the lifecycle gap', () => {
    // Documents *why* every perturbation test must rebuild: pushing to the array
    // alone changes nothing the corridor test can observe.
    try {
      ROAD_SEGMENTS.push(NEAR);
      expect(roadSpatialIndexHasSegmentAt(PROBE.x, PROBE.z, NEAR.id)).toBe(false);
      expect(distanceToRoadCarriageway(PROBE.x, PROBE.z)).toBeCloseTo(17.81, 2);
      // The stale index reports a 7 m footprint here as clear of every road:
      // a building could have been placed on the new carriageway unchallenged.
      expect(isFootprintClearOfCorridor(PROBE.x, PROBE.z, 7, 7, 0, 0.55)).toBe(true);

      rebuildRoadSpatialIndex();

      expect(roadSpatialIndexHasSegmentAt(PROBE.x, PROBE.z, NEAR.id)).toBe(true);
      expect(distanceToRoadCarriageway(PROBE.x, PROBE.z)).toBeCloseTo(-4.5, 2);
      expect(isFootprintClearOfCorridor(PROBE.x, PROBE.z, 7, 7, 0, 0.55)).toBe(false);
      expect(roadSpatialIndexStats().distinctSegments).toBe(BASE_STATS.distinctSegments + 1);
    } finally {
      ROAD_SEGMENTS.length = 0;
      ROAD_SEGMENTS.push(...ORIGINAL_ORDER);
      rebuildRoadSpatialIndex();
    }
    expect(roadSpatialIndexStats()).toEqual(BASE_STATS);
  });

  it('resolves the new road along its whole length, not just at one probe', () => {
    try {
      ROAD_SEGMENTS.push(NEAR);
      rebuildRoadSpatialIndex();
      const hidden: string[] = [];
      for (let t = 0.05; t < 1; t += 0.05) {
        const x = NEAR.ax + NEAR.ux * NEAR.length * t;
        const z = NEAR.az + NEAR.uz * NEAR.length * t;
        if (!roadSpatialIndexHasSegmentAt(x, z, NEAR.id)) hidden.push(`${x.toFixed(1)},${z.toFixed(1)}`);
        // Every sampled centreline point is inside the carriageway.
        expect(distanceToRoadCarriageway(x, z), `${x.toFixed(1)},${z.toFixed(1)}`).toBeLessThan(0);
      }
      expect(hidden).toEqual([]);
    } finally {
      ROAD_SEGMENTS.length = 0;
      ROAD_SEGMENTS.push(...ORIGINAL_ORDER);
      rebuildRoadSpatialIndex();
    }
  });
});

describe('generated buildings versus carriageways', () => {
  it('leaves no shipped building on any carriageway', async () => {
    const city = await withSegments(ORIGINAL_ORDER, () => buildCityNow());
    const { checked, violations } = scores(city.colliders);
    expect(violations).toEqual([]);
    // 827 building colliders; 3 are pocket-plaza counters with no `yaw`, so they
    // have no oriented footprint to test (asserted separately below).
    expect(checked).toBeGreaterThan(800);
  }, 120_000);

  it('tests the three footprint-less authored structures instead of skipping them', async () => {
    const city = await withSegments(ORIGINAL_ORDER, () => buildCityNow());
    const without = city.colliders.filter((c) => !hasFootprint(c) && (c as { kind?: string }).kind === 'building');
    // Three 8 m authored structures (a market row and two apron sheds) are
    // axis-aligned and carry no `yaw`, so SAT has nothing to orient.
    expect(without.length).toBe(3);
    for (const c of without) {
      const box = c as unknown as Record<string, number>;
      expect(box.height).toBe(8);
      expect(minCarriagewayDistance(box as never)).toBeGreaterThan(0.55);
    }
  }, 120_000);

  it('keeps every building off the new carriageway when a road cuts through the city', async () => {
    const city = await withSegments([...ORIGINAL_ORDER, NEAR], () => buildCityNow());
    const { checked, violations } = scores(city.colliders);
    expect(checked).toBeGreaterThan(800);
    expect(violations).toEqual([]);

    // The test is not vacuous: the generator visibly fills the new road's
    // frontage band, and every one of those parcels still clears the carriageway.
    const distanceFromNewRoad = (x: number, z: number): number => {
      const t = Math.max(0, Math.min(NEAR.length, (x - NEAR.ax) * NEAR.ux + (z - NEAR.az) * NEAR.uz));
      return Math.hypot(x - (NEAR.ax + NEAR.ux * t), z - (NEAR.az + NEAR.uz * t));
    };
    const nearRoad = (city.colliders as unknown[])
      .filter((c) => (c as { kind?: string }).kind === 'building')
      .filter(hasFootprint)
      .filter((c) => distanceFromNewRoad(c.cx, c.cz) <= 43);
    expect(nearRoad.length).toBeGreaterThan(10);
    for (const c of nearRoad) {
      expect(isFootprintClearOfCorridor(c.cx, c.cz, c.halfX * 2, c.halfZ * 2, c.yaw, 0.55), `${c.cx},${c.cz}`)
        .toBe(true);
      // Strictly outside the new carriageway, not merely clear of the sidewalk.
      expect(distanceFromNewRoad(c.cx, c.cz)).toBeGreaterThan(4.5 + 1.5);
    }

    // The three yaw-less structures are sampled, not skipped, here too.
    const without = (city.colliders as unknown[]).filter(
      (c) => !hasFootprint(c) && (c as { kind?: string }).kind === 'building',
    );
    for (const c of without) expect(minCarriagewayDistance(c as never)).toBeGreaterThan(0.55);
  }, 120_000);

  it('evicts only the 19 buildings the road actually conflicts with — fill adds none', async () => {
    // With a correct corridor index a road through the mapped blocks evicts the
    // buildings it and its corridor displace. The number used to be 54 because a
    // rejected frontage candidate shifted its neighbours (29 re-rolls + 6
    // propagated); that coupling is fixed in `src/world/frontageLayout.ts`, and
    // the audit (`docs/SYNTHETIC_ROAD_AUDIT.md` §11) shows the remaining 19 are
    // exactly the footprints under the asphalt (17) or in the sidewalk band (2).
    // The regional fill system must not add to that number, and does not: with
    // region budgets disabled the count is 19 as well.
    const base = await withSegments(ORIGINAL_ORDER, () => buildNow());
    const out = await withSegments([...ORIGINAL_ORDER, NEAR], () => buildNow());
    const key = (b: { x: number; z: number; width: number; depth: number; height: number }) =>
      `${b.x},${b.z},${b.width},${b.depth},${b.height}`;
    const after = new Map<string, number>();
    for (const b of out.buildings) after.set(key(b), (after.get(key(b)) ?? 0) + 1);
    let evicted = 0;
    for (const b of base.buildings) {
      const n = after.get(key(b)) ?? 0;
      if (n > 0) after.set(key(b), n - 1);
      else evicted++;
    }
    expect(evicted).toBe(19);
  }, 120_000);
});
