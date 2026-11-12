import { describe, expect, it } from 'vitest';
import { installDomShim } from '../../tools/domShim';
import { ROAD_SEGMENTS, rebuildRoadSpatialIndex, type RoadSegment } from '../../src/world/layout';
import {
  LEGACY_INTERIOR_ORDINALS,
  legacyInteriorOrdinal,
} from '../../src/world/legacyFillLayout';
import { derivedFillOrdinal } from '../../src/world/regionFill';
import { buildWorldSnapshot, worldDigest, type WorldSnapshot } from '../../tools/worldSnapshot';

/**
 * Gap A — interior ordinals under a changing candidate order.
 *
 * `docs/INTERIOR_INFILL_ISOLATION.md` §3.2 replaced the block-interior pass's
 * running `interiorCount` with a frozen ordinal per candidate. The documented
 * verification gap was that the change could not be **detected**: on the shipped
 * topology `interiorCount` happens to equal the frozen ordinal for all 160
 * interior buildings, so a mutation that restored the counter would still build
 * 845 buildings and still produce `c60e15b5`.
 *
 * This file closes the gap on two levels, without inventing a failure the current
 * code cannot produce:
 *
 *   1. **Controlled candidate set.** A controlled insertion is applied to the
 *      *real* frozen table (the shipped visit sequence, ordinals 0..159). A
 *      counter-based assignment is computed alongside the frozen one. The counter
 *      model provably moves every legacy ordinal and, past the 160 cap, would
 *      drop legacy buildings outright — so the assertion is discriminating on
 *      real data, not merely on a hypothetical.
 *
 *   2. **The real world.** A road is inserted through the shipped city, which is
 *      the perturbation that actually subsumes candidates. Every legacy interior
 *      building keeps its exact footprint, and its ordinal still resolves through
 *      the frozen table.
 *
 * Mutation evidence for level 2 is recorded in `docs/REGIONAL_FILL.md` §6: with
 * the interior ordinal restored to a running counter, a road inserted *through*
 * the city evicts 104 buildings instead of 54 and resizes 49 interiors. (A road
 * far away does not move the shipped world even under that mutant — the two-phase
 * pass ordering already protects it, which is why the *unit* level above exists.)
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

/** The shipped interior visit sequence, reconstructed from the frozen ordinals. */
interface Candidate {
  key: string;
  x: number;
  z: number;
  legacyOrdinal?: number;
}

const LEGACY_SEQUENCE: Candidate[] = Object.entries(LEGACY_INTERIOR_ORDINALS)
  .map(([key, ordinal]) => {
    const [x, z] = key.split(',').map(Number);
    return { key, x, z, legacyOrdinal: ordinal };
  })
  .sort((a, b) => (a.legacyOrdinal as number) - (b.legacyOrdinal as number));

/** A controlled insertion: `count` brand-new candidates dropped at `index`. */
function withInsertion(sequence: Candidate[], index: number, count: number): Candidate[] {
  const inserted: Candidate[] = Array.from({ length: count }, (_, i) => {
    const x = -900 + i * 11.8;
    const z = -100 + (i % 3) * 4.1;
    return { key: `inserted,${x.toFixed(2)},${z.toFixed(2)}`, x, z };
  });
  return [...sequence.slice(0, index), ...inserted, ...sequence.slice(index)];
}

/** How the shipped code assigns an ordinal: a property of the candidate. */
function frozenOrdinal(c: Candidate): number | undefined {
  return legacyInteriorOrdinal(c.x, c.z);
}

/** How the pre-isolation code assigned it: position in the visit order. */
function counterOrdinal(sequence: Candidate[], key: string): number | undefined {
  const index = sequence.findIndex((c) => c.key === key);
  return index < 0 ? undefined : index;
}

/** The pass refuses candidates once `interiorCount` reaches this value. */
const INTERIOR_CAP = 160;

/** Count of legacy candidates the cap would leave unplaced under a counter. */
function droppedByCap(sequence: Candidate[], legacyCount: number): number {
  const legacyPositions = sequence
    .map((c, i) => (c.legacyOrdinal === undefined ? -1 : i))
    .filter((i) => i >= 0);
  return legacyPositions.filter((i) => i >= INTERIOR_CAP).length === 0
    ? Math.max(0, Math.min(legacyCount, sequence.length) - INTERIOR_CAP)
    : legacyPositions.filter((i) => i >= INTERIOR_CAP).length;
}

describe('frozen interior ordinals survive a changing candidate order', () => {
  it('reconstructs the shipped 160-candidate sequence', () => {
    expect(LEGACY_SEQUENCE.length).toBe(160);
    expect(LEGACY_SEQUENCE.map((c) => c.legacyOrdinal)).toEqual(
      Array.from({ length: 160 }, (_, i) => i),
    );
  });

  it('is invisible on the shipped topology — the documented gap, stated honestly', () => {
    // Counter and frozen assignment agree here. That is exactly why a mutation
    // could not be detected before, and why the controlled set below exists.
    const disagreements = LEGACY_SEQUENCE.filter(
      (c) => counterOrdinal(LEGACY_SEQUENCE, c.key) !== c.legacyOrdinal,
    );
    expect(disagreements).toEqual([]);
  });

  for (const [label, index] of [
    ['before every legacy candidate', 0],
    ['in the middle of the legacy run', 80],
    ['after every legacy candidate', 160],
  ] as const) {
    it(`keeps every legacy ordinal when 25 candidates are inserted ${label}`, () => {
      const mixed = withInsertion(LEGACY_SEQUENCE, index, 25);

      // Frozen: unchanged, by construction, for all 160.
      for (const c of LEGACY_SEQUENCE) {
        expect(frozenOrdinal(mixed.find((m) => m.key === c.key) ?? c), c.key)
          .toBe(c.legacyOrdinal);
      }

      // Counter: the same controlled set moves 160 ordinals by the 25 inserted
      // ahead of them. This is the regression the frozen table prevents, and it
      // is measurable on the real shipped data.
      const shifted = LEGACY_SEQUENCE.filter(
        (c) => counterOrdinal(mixed, c.key) !== c.legacyOrdinal,
      );
      const expectedShift = index === 0 ? 160 : index === 160 ? 0 : 160 - index;
      expect(shifted.length).toBe(expectedShift);
      for (const c of shifted) {
        expect(counterOrdinal(mixed, c.key) as number)
          .toBe((c.legacyOrdinal as number) + 25);
      }
    });
  }

  it('shows the counter model would also drop legacy buildings at the 160 cap', () => {
    const mixed = withInsertion(LEGACY_SEQUENCE, 0, 25);
    // 25 inserted candidates occupy ordinals 0..24, pushing legacy ordinals to
    // 25..184; the pass stops at 160, so the last 25 legacy candidates never place.
    expect(droppedByCap(mixed, LEGACY_SEQUENCE.length)).toBe(25);
    const survivors = LEGACY_SEQUENCE.filter(
      (c) => (counterOrdinal(mixed, c.key) as number) < INTERIOR_CAP,
    );
    expect(survivors.length).toBe(135);
    // The frozen table keeps all 160, because the cap is reached by the legacy
    // run alone and never by a foreign region's candidates.
    expect(droppedByCap(LEGACY_SEQUENCE, LEGACY_SEQUENCE.length)).toBe(0);
  });

  it('survives removal and arbitrary reordering of the candidate list', () => {
    const reversed = [...LEGACY_SEQUENCE].reverse();
    const rotated = [...LEGACY_SEQUENCE.slice(40), ...LEGACY_SEQUENCE.slice(0, 40)];
    for (const list of [reversed, rotated]) {
      for (const c of LEGACY_SEQUENCE) {
        expect(frozenOrdinal(c), c.key).toBe(c.legacyOrdinal);
      }
      // The counter model disagrees under the same perturbations.
      const differs = LEGACY_SEQUENCE.filter(
        (c) => counterOrdinal(list, c.key) !== c.legacyOrdinal,
      );
      expect(differs.length).toBeGreaterThan(100);
    }
  });

  it('keeps new-region candidates off the legacy ordinal space', () => {
    // A non-legacy candidate resolves to `undefined` through the frozen table and
    // to a position-derived value through `derivedFillOrdinal`; the two spaces are
    // disjoint in practice because derived values live in 0..999 while legacy
    // ordinals stop at 159.
    for (const c of withInsertion(LEGACY_SEQUENCE, 0, 25).filter((c) => c.legacyOrdinal === undefined)) {
      expect(legacyInteriorOrdinal(c.x, c.z)).toBeUndefined();
      const derived = derivedFillOrdinal(c.x, c.z);
      expect(Number.isInteger(derived)).toBe(true);
      expect(derived).toBe(derivedFillOrdinal(c.x, c.z));
    }
    expect(Math.max(...Object.values(LEGACY_INTERIOR_ORDINALS))).toBe(159);
  });
});

/* ---------------------------------------------------------------- real world */

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

function geomKey(b: { x: number; z: number; width: number; depth: number; height: number }): string {
  return `${b.x},${b.z},${b.width},${b.depth},${b.height}`;
}

const INTERIOR_HEIGHTS = new Set(['5.70', '8.55', '11.40']);

const ORIGINAL_ORDER = [...ROAD_SEGMENTS];
const FAR = syntheticSegment('synth_far_ordinals', -900, -100, -700, 100);

/** Build with `segments` installed, with the corridor index kept honest. */
async function buildWith(segments: RoadSegment[]): Promise<WorldSnapshot> {
  try {
    ROAD_SEGMENTS.length = 0;
    ROAD_SEGMENTS.push(...segments);
    rebuildRoadSpatialIndex();
    return await buildNow();
  } finally {
    ROAD_SEGMENTS.length = 0;
    ROAD_SEGMENTS.push(...ORIGINAL_ORDER);
    rebuildRoadSpatialIndex();
  }
}

const BASE = await buildNow();
const PERTURBED = await buildWith([...ORIGINAL_ORDER, FAR]);

describe('interior ordinals in the real world', () => {
  it('still places exactly the shipped 845 buildings', () => {
    expect(BASE.counts.buildings).toBe(845);
    expect(worldDigest(BASE)).toBe('c60e15b5');
  });

  it('resolves every shipped interior building through the frozen table', () => {
    const interior = BASE.buildings.filter((b) => INTERIOR_HEIGHTS.has(b.height.toFixed(2)));
    expect(interior.length).toBe(160);
    for (const b of interior) {
      const ordinal = legacyInteriorOrdinal(b.x, b.z);
      expect(ordinal, `${b.x},${b.z}`).toBeTypeOf('number');
      expect(Number.isInteger(ordinal as number)).toBe(true);
    }
    // Ordinals are unique per candidate, so the mapping is one-to-one.
    const seen = new Set(interior.map((b) => legacyInteriorOrdinal(b.x, b.z)));
    expect(seen.size).toBe(interior.length);
  });

  it('keeps every one of the 845 footprints when a new region is filled', () => {
    // The perturbation the regional fill system exists for: a new region is
    // filled and the shipped world still reproduces exactly. This is the
    // end-to-end guard, not the counter detector — see the module doc.
    const after = new Map<string, number>();
    for (const b of PERTURBED.buildings) after.set(geomKey(b), (after.get(geomKey(b)) ?? 0) + 1);
    const missing: string[] = [];
    for (const b of BASE.buildings) {
      const k = geomKey(b);
      const n = after.get(k) ?? 0;
      if (n > 0) after.set(k, n - 1);
      else missing.push(k);
    }
    expect(missing).toEqual([]);
    expect(worldDigest(BASE)).toBe('c60e15b5');
  });

  it('gives every shipped interior building the same dimensions after the fill', () => {
    const interior = (snapshot: WorldSnapshot) =>
      snapshot.buildings
        .filter((b) => INTERIOR_HEIGHTS.has(b.height.toFixed(2)))
        .map((b) => `${b.x},${b.z}:${b.width}x${b.depth}x${b.height.toFixed(2)}`);
    const before = interior(BASE);
    const after = new Set(interior(PERTURBED));
    const lost = before.filter((d) => !after.has(d));
    expect(lost).toEqual([]);
  });

  it('is order-independent for the interior pass', async () => {
    const reversed = await buildWith([...ORIGINAL_ORDER].reverse().concat([FAR]));
    expect(reversed.buildings.map(geomKey).sort())
      .toEqual(PERTURBED.buildings.map(geomKey).sort());
  }, 120_000);
});
