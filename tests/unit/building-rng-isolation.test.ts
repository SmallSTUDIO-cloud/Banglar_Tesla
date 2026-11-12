import { afterEach, describe, expect, it } from 'vitest';
import { installDomShim } from '../../tools/domShim';
import { ROAD_SEGMENTS, type RoadSegment } from '../../src/world/layout';
import {
  buildWorldSnapshot,
  worldDigest,
  type WorldSnapshot,
} from '../../tools/worldSnapshot';

/**
 * End-to-end isolation proof for building RNG.
 *
 * Background: `buildCity()` used to run one shared generator for props, trees,
 * buildings and litter. The building pass consumed the *continuation* of that
 * stream, so inserting a road segment shifted every later building. Measured
 * before this work: adding the Mirpur chain moved 751–773 of 845 buildings even
 * with its nodes parked at (5000, 5000), i.e. nowhere near the city.
 *
 * These tests insert synthetic segments at three positions — before the first
 * legacy segment, between two, and after the last — and assert that every legacy
 * building keeps its id, position and dimensions. They also assert the synthetic
 * segment is genuinely *doing* something, so the guarantee cannot pass vacuously.
 *
 * Scope note: the synthetic segments are parked far from the city. That is
 * deliberate. Two frontages that physically contend for the same parcel are
 * resolved first-come by `canPlaceBuilding()`, so a road dropped *through*
 * existing buildings will legitimately suppress some. That is a geometry
 * conflict to be reported, not RNG drift to be hidden.
 */

installDomShim();

const BASELINE_QUALITY = { shadows: true } as const;

/** Far from every real segment, so no parcel or corridor can be contested. */
const REMOTE_X = 5000;

async function buildNow(): Promise<WorldSnapshot> {
  const [{ buildCity }, { SignAtlas }] = await Promise.all([
    import('../../src/world/city'),
    import('../../src/world/textures'),
  ]);
  const city = buildCity(new SignAtlas() as never, BASELINE_QUALITY as never);
  return buildWorldSnapshot(city as never);
}

/** A straight, valid segment that reuses the real segment schema. */
function syntheticSegment(id: string, index: number): RoadSegment {
  const ax = REMOTE_X + index * 400;
  const az = 0;
  const bx = ax + 180;
  const bz = az;
  const length = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / length;
  const uz = (bz - az) / length;
  return {
    id,
    from: `${id}_a`,
    to: `${id}_b`,
    ax,
    az,
    bx,
    bz,
    length,
    ux,
    uz,
    leftX: uz,
    leftZ: -ux,
    width: 9,
    halfWidth: 4.5,
    sidewalk: 1.5,
    kind: 'main',
    nameEn: `Synthetic ${id}`,
    nameBn: `Synthetic ${id}`,
    // Test fixture only: reuses the closest existing source tag; nothing is
    // exported or persisted, and no production data gains a new provenance value.
    source: 'osm',
    jamProne: true,
    deadEnd: false,
    axis: 'x',
    center: (az + bz) * 0.5,
    fromCoord: Math.min(ax, bx),
    toCoord: Math.max(ax, bx),
  };
}

/** Insert while a build is running, then restore the array exactly. */
async function buildWith(insertions: Array<{ index: number; seg: RoadSegment }>): Promise<WorldSnapshot> {
  const original = [...ROAD_SEGMENTS];
  try {
    const ordered = [...insertions].sort((a, b) => b.index - a.index);
    for (const { index, seg } of ordered) {
      ROAD_SEGMENTS.splice(index, 0, seg);
    }
    return await buildNow();
  } finally {
    ROAD_SEGMENTS.length = 0;
    ROAD_SEGMENTS.push(...original);
  }
}

const LEGACY_IDS = [...ROAD_SEGMENTS.map((s) => s.id)];
const LEGACY_COUNT = ROAD_SEGMENTS.length;

const LIVE = await buildNow();

/** Buildings belonging to real segments, in a stable order. */
function legacyBuildings(snapshot: WorldSnapshot) {
  return snapshot.buildings.filter((b) => LEGACY_IDS.includes(b.segmentId));
}

afterEach(() => {
  // A leaked synthetic segment would corrupt every later test in this file.
  expect(ROAD_SEGMENTS.length).toBe(LEGACY_COUNT);
});

describe('building RNG isolation', () => {
  it('builds a stable reference world', () => {
    expect(LIVE.counts.buildings).toBe(845);
    expect(LEGACY_IDS.length).toBe(70);
  });

  it('keeps every legacy building when a segment is added after the last one', async () => {
    const candidate = await buildWith([
      { index: ROAD_SEGMENTS.length, seg: syntheticSegment('synth_tail', 0) },
    ]);
    expect(legacyBuildings(candidate)).toEqual(legacyBuildings(LIVE));
    expect(candidate.counts.buildings).toBeGreaterThan(LIVE.counts.buildings);
  });

  it('keeps every legacy building when a segment is added before the first one', async () => {
    const candidate = await buildWith([{ index: 0, seg: syntheticSegment('synth_head', 0) }]);
    expect(legacyBuildings(candidate)).toEqual(legacyBuildings(LIVE));
  });

  it('keeps every legacy building when a segment is inserted in the middle', async () => {
    const candidate = await buildWith([{ index: 35, seg: syntheticSegment('synth_mid', 0) }]);
    expect(legacyBuildings(candidate)).toEqual(legacyBuildings(LIVE));
  });

  it('is unaffected by several segments at once, in several places', async () => {
    const candidate = await buildWith([
      { index: 0, seg: syntheticSegment('synth_a', 0) },
      { index: 20, seg: syntheticSegment('synth_b', 1) },
      { index: 55, seg: syntheticSegment('synth_c', 2) },
      { index: ROAD_SEGMENTS.length, seg: syntheticSegment('synth_d', 3) },
    ]);
    expect(legacyBuildings(candidate)).toEqual(legacyBuildings(LIVE));
  });

  it('is not vacuous: the inserted segment really does run its building pass', async () => {
    // If the synthetic segment produced nothing, the equality above would prove
    // nothing about the stream. Assert it placed buildings of its own.
    const candidate = await buildWith([
      { index: 0, seg: syntheticSegment('synth_probe', 0) },
    ]);
    const mine = candidate.buildings.filter((b) => b.segmentId === 'synth_probe');
    expect(mine.length).toBeGreaterThan(0);
    expect(candidate.buildingsBySegment.synth_probe).toBe(mine.length);
  });

  it('is not vacuous: the inserted segment perturbs the shared prop stream', async () => {
    // Trees, humps and puddles still draw from the original shared stream, so a
    // long jam-prone segment must shift them. That shift is what used to drag
    // every building with it; the buildings above stayed put regardless.
    const candidate = await buildWith([
      { index: 0, seg: syntheticSegment('synth_props', 0) },
    ]);
    const propsMoved =
      candidate.counts.trees !== LIVE.counts.trees ||
      candidate.counts.speedHumps !== LIVE.counts.speedHumps ||
      candidate.counts.props !== LIVE.counts.props;
    expect(propsMoved, 'synthetic segment did not perturb the prop stream, so isolation is untested').toBe(true);
  });

  it('keeps the litter count stable when a segment is added', async () => {
    // Litter is a downstream consumer pinned past the building pass, so a new
    // road cannot reshuffle existing litter.
    //
    // Honest limitation: the world snapshot records only the litter *count*, and
    // that count is capped at 136, which the legacy world already reaches. So
    // this assertion would hold under any implementation that fills the cap, and
    // it is not by itself proof that litter positions are unchanged. The
    // positional proof was done out-of-band: a full build of this branch and of
    // commit `c56eb4a` produced byte-identical litter positions, yaw, phase and
    // scale for all 136 items (method recorded in docs/BUILDING_RNG_ISOLATION.md).
    // The stream-level guarantee is unit-tested in building-rng.test.ts.
    const candidate = await buildWith([
      { index: 0, seg: syntheticSegment('synth_litter', 0) },
    ]);
    expect(candidate.counts.litter).toBe(LIVE.counts.litter);
  });

  it('produces the same world regardless of how many times it is asked', async () => {
    const a = await buildNow();
    const b = await buildNow();
    expect(worldDigest(b)).toBe(worldDigest(a));
    expect(b.buildings).toEqual(a.buildings);
  }, 60_000);

  it('keeps the legacy digest stable across an isolated rebuild', async () => {
    const rebuilt = await buildNow();
    expect(worldDigest(rebuilt)).toBe(worldDigest(LIVE));
  });
});
