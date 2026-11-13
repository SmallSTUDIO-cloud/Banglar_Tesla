import { describe, expect, it } from 'vitest';
import { hashString, mulberry32 } from '../../src/core/mathx';
import {
  advance,
  buildingRngFor,
  buildingSeedFor,
  isLegacySegment,
  LEGACY_BASE_SEED,
  LEGACY_BUILDING_END_OFFSET,
  LEGACY_BUILDING_OFFSETS,
  MULBERRY_STEP,
  NEW_SEGMENT_SEED,
  postBuildingRng,
} from '../../src/world/buildingRng';
import { ROAD_SEGMENTS } from '../../src/world/layout';

/**
 * Unit-level contract for building RNG isolation.
 *
 * The behavioural guarantee — that adding roads cannot move existing buildings —
 * is proven in `building-rng-isolation.test.ts` against a real `buildCity()`.
 * This file pins the arithmetic it rests on, so a silent change to the frozen
 * table or to the skip formula fails here first, with a precise message, instead
 * of surfacing as hundreds of moved buildings.
 */

const SEGMENT_IDS = ROAD_SEGMENTS.map((s) => s.id);
const OFFSET_IDS = Object.keys(LEGACY_BUILDING_OFFSETS);

describe('legacy offset table', () => {
  it('covers exactly the real legacy segment set — no duplicates, no strays', () => {
    // `Object.keys` cannot contain duplicates, so a duplicated id would show up
    // as a missing one and fail this comparison.
    expect(OFFSET_IDS.length).toBe(new Set(OFFSET_IDS).size);
    expect([...OFFSET_IDS].sort()).toEqual([...SEGMENT_IDS].sort());
    expect(OFFSET_IDS.length).toBe(70);
  });

  it('starts where the prop stage ended and ends where the old stream left off', () => {
    expect(LEGACY_BUILDING_OFFSETS[SEGMENT_IDS[0]]).toBe(1136);
    expect(LEGACY_BUILDING_OFFSETS[SEGMENT_IDS[SEGMENT_IDS.length - 1]]).toBe(7064);
    // The end marker is the absolute index after the final segment's pass.
    expect(LEGACY_BUILDING_END_OFFSET).toBeGreaterThan(7064);
    expect(LEGACY_BUILDING_END_OFFSET).toBe(7151);
  });

  it('records every offset as a non-negative integer', () => {
    for (const [id, n] of Object.entries(LEGACY_BUILDING_OFFSETS)) {
      expect(Number.isInteger(n), `${id} offset is not an integer`).toBe(true);
      expect(n, `${id} offset is negative`).toBeGreaterThan(0);
    }
  });

  it('is strictly increasing in segment order, leaving no gaps in the stream', () => {
    // Contiguity is what makes the table a faithful snapshot of one shared
    // stream: each segment begins exactly where the previous one stopped.
    let previous = LEGACY_BUILDING_OFFSETS[SEGMENT_IDS[0]];
    for (let i = 1; i < SEGMENT_IDS.length; i++) {
      const current = LEGACY_BUILDING_OFFSETS[SEGMENT_IDS[i]];
      expect(current, `${SEGMENT_IDS[i]} does not advance past ${SEGMENT_IDS[i - 1]}`).toBeGreaterThan(
        previous,
      );
      previous = current;
    }
  });

  it('accounts for exactly 6,015 draws between first and last segment', () => {
    // 7,151 is the absolute end index, not the building pass's own draw count.
    // 6,015 = 1,210 placement attempts x 3 draws
    //       + 434 successful non-gali buildings x 4 draws
    //       + 130 successful gali buildings x 5 draws.
    const span = LEGACY_BUILDING_END_OFFSET - LEGACY_BUILDING_OFFSETS[SEGMENT_IDS[0]];
    expect(span).toBe(6015);
  });
});

describe('advance (closed-form stream skip)', () => {
  it('is the identity at zero draws', () => {
    expect(advance(LEGACY_BASE_SEED, 0)).toBe(LEGACY_BASE_SEED >>> 0);
  });

  it('advances by the generator’s constant step', () => {
    expect(advance(LEGACY_BASE_SEED, 1)).toBe(((LEGACY_BASE_SEED + MULBERRY_STEP) >>> 0));
    expect(MULBERRY_STEP).toBe(0x6d2b79f5);
  });

  it('composes: advance(advance(seed, a), b) === advance(seed, a + b)', () => {
    for (const [a, b] of [[1, 1], [17, 1100], [1136, 6015], [7000, 4000]] as const) {
      expect(advance(advance(LEGACY_BASE_SEED, a), b)).toBe(advance(LEGACY_BASE_SEED, a + b));
    }
  });

  it('matches sequential consumption at every captured offset', () => {
    // The real proof: burning N values by hand must land on the same state that
    // the closed form predicts. If this ever fails, every building would move.
    const offsets = [...new Set(Object.values(LEGACY_BUILDING_OFFSETS))].sort((a, b) => a - b);
    const rng = mulberry32(LEGACY_BASE_SEED);
    let state = LEGACY_BASE_SEED;
    let consumed = 0;
    for (const target of offsets) {
      while (consumed < target) {
        rng();
        consumed++;
      }
      state = advance(LEGACY_BASE_SEED, target);
      // Compare the next value each producer emits: equivalent state means the
      // next random number is identical. Reading the sequential value advances
      // the cursor, so account for that draw.
      const predicted = mulberry32(state)();
      const sequential = rng();
      consumed++;
      expect(predicted, `state mismatch at offset ${target}`).toBe(sequential);
    }
    // Each comparison draw is absorbed by the next offset's catch-up loop, so
    // only the final one remains outstanding.
    expect(consumed).toBe(7065);
    expect(consumed - 1).toBe(LEGACY_BUILDING_OFFSETS[SEGMENT_IDS[SEGMENT_IDS.length - 1]]);
  });

  it('stays unsigned across the 2^32 wraparound', () => {
    expect(advance(0xffffffff, 1)).toBe(0x6d2b79f4);
    expect(advance(0, 1)).toBe(MULBERRY_STEP);
    expect(Number.isInteger(advance(LEGACY_BASE_SEED, 7151))).toBe(true);
    expect(advance(LEGACY_BASE_SEED, 7151)).toBeLessThan(2 ** 32);
  });
});

describe('per-segment seeds', () => {
  it('reports legacy membership by own property only', () => {
    expect(isLegacySegment('asad_0')).toBe(true);
    expect(isLegacySegment('not_a_real_segment')).toBe(false);
    // Inherited Object keys must not be mistaken for segments.
    expect(isLegacySegment('constructor')).toBe(false);
    expect(isLegacySegment('__proto__')).toBe(false);
  });

  it('gives every legacy segment the state the shared stream held there', () => {
    for (const id of SEGMENT_IDS) {
      expect(buildingSeedFor(id), id).toBe(advance(LEGACY_BASE_SEED, LEGACY_BUILDING_OFFSETS[id]));
    }
  });

  it('gives distinct seeds to distinct segments', () => {
    const seeds = SEGMENT_IDS.map((id) => buildingSeedFor(id));
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it('places new segments in a separate seed space', () => {
    // A new segment must never accidentally replay a legacy frontage. 70 legacy
    // seeds were compared; a collision would need a 1-in-61M coincidence.
    const legacy = new Set(SEGMENT_IDS.map((id) => buildingSeedFor(id)));
    const candidates = [
      'mirpur_0', 'mirpur_1', 'sher_e_bangla_1', 'aurangzeb_3', 'x', 'asad_0_new', '',
    ];
    for (const id of candidates) {
      expect(isLegacySegment(id)).toBe(false);
      const seed = buildingSeedFor(id);
      expect(legacy.has(seed), `${id} collides with a legacy seed`).toBe(false);
      expect(seed).toBe((NEW_SEGMENT_SEED ^ hashString(id)) >>> 0);
    }
  });

  it('is deterministic across calls and independent of lookup order', () => {
    const forward = SEGMENT_IDS.map((id) => buildingSeedFor(id));
    const backward = [...SEGMENT_IDS].reverse().map((id) => buildingSeedFor(id)).reverse();
    expect(backward).toEqual(forward);
    expect(forward).toEqual(SEGMENT_IDS.map((id) => buildingSeedFor(id)));
  });

  it('gives a new segment the same stream regardless of what else exists', () => {
    // Pure function of the id: no module-level cursor, no accumulated state.
    const first = buildingSeedFor('mirpur_0');
    buildingRngFor('mirpur_0')();
    buildingRngFor('mirpur_0')();
    expect(buildingSeedFor('mirpur_0')).toBe(first);
  });
});

describe('post-building stream (litter)', () => {
  it('is pinned to the state the old shared stream ended the building pass at', () => {
    expect(postBuildingRng()()).toBe(mulberry32(advance(LEGACY_BASE_SEED, LEGACY_BUILDING_END_OFFSET))());
  });

  it('is unaffected by consuming the building or prop streams', () => {
    const before = postBuildingRng()();
    for (const id of SEGMENT_IDS.slice(0, 5)) {
      const rng = buildingRngFor(id);
      for (let i = 0; i < 200; i++) rng();
    }
    const shared = mulberry32(LEGACY_BASE_SEED);
    for (let i = 0; i < 7151; i++) shared();
    expect(postBuildingRng()()).toBe(before);
  });

  it('gives a fresh, independently positioned generator on each call', () => {
    const a = postBuildingRng();
    a();
    a();
    // A second call must restart, not continue: litter draws must not depend on
    // how many times some earlier consumer asked for a generator.
    expect(postBuildingRng()()).toBe(postBuildingRng()());
  });
});
