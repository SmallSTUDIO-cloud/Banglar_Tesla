/**
 * Deterministic, isolated random streams for `buildCity()`.
 *
 * ## Why this module exists
 *
 * `buildCity()` ran **one** generator — `mulberry32(20261207)` — end to end:
 * road props, chevrons, manholes, wear, puddles, trees, then the building pass,
 * then litter. The building pass therefore consumed the *continuation* of that
 * stream, so the values it saw depended on how many draws every earlier stage
 * had happened to make. Because props are drawn per segment and their counts
 * depend on geometry, **adding one road segment moved the building pass
 * thousands of positions down the stream** and rearranged most of the city.
 *
 * Measured on the unmodified baseline (70 segments): the props/tree stages
 * consume **1,136** draws, the building pass consumes **6,015**, and it ends at
 * absolute stream index **7,151**.
 *
 * ## The strategy: pinned per-segment legacy streams
 *
 * Each segment's building pass gets its **own** generator, seeded to the exact
 * state the old shared stream held when that segment began. On the unchanged
 * world the sequence of values is therefore bit-identical to before, so no
 * building is regenerated, moved or resized.
 *
 * `mulberry32` advances its state by a *constant* on every call
 * (`a = (a + 0x6d2b79f5) >>> 0`), so the state after N draws is closed-form and
 * needs no replay. `advance()` is that arithmetic; the test suite proves it
 * equals sequential consumption for every captured offset.
 *
 * ## What this guarantees, and what it does not
 *
 * Guaranteed — a segment's buildings depend only on (stable id, frozen offset):
 *   - adding, inserting, removing or reordering **other** segments cannot shift
 *     it, because offsets are looked up by id rather than accumulated;
 *   - consuming more draws for props, trees or litter cannot shift it, because
 *     those no longer share its generator.
 *
 * Not guaranteed — a new road that physically overlaps an existing building can
 * still suppress that building through `canPlaceBuilding()`. That is a real
 * geometric conflict to be reported, not silent drift; see the isolation tests.
 *
 * ## Regenerating the table
 *
 * Do **not** regenerate it. It records the seeds the current city was built
 * from; changing a value deliberately rebuilds that segment's frontage. The
 * capture procedure (a temporary trace of the shared stream during the building
 * pass) is documented in `docs/BUILDING_RNG_ISOLATION.md`, and
 * `tests/unit/building-rng.test.ts` fails if the table stops covering exactly
 * the legacy segment set or if any baseline building moves.
 */

import { hashString, mulberry32 } from '../core/mathx';

/** Seed of the original shared `buildCity()` stream. Never change. */
export const LEGACY_BASE_SEED = 20261207;

/** `mulberry32`'s per-call state increment (mod 2^32). */
export const MULBERRY_STEP = 0x6d2b79f5;

/**
 * Draw index at which each legacy segment's building pass began, in the
 * original single-stream build. Values are absolute stream positions, not
 * per-segment draw counts; they are contiguous, so
 * `offsets[i+1] === offsets[i] + drawsConsumedBy(segment i)`.
 *
 * (Earlier notes described "7,151 building draws" — that was wrong. 7,151 is
 * the absolute end index; the building pass itself consumes 6,015.)
 */
export const LEGACY_BUILDING_OFFSETS: Readonly<Record<string, number>> = {
  asad_0: 1136,
  asad_1: 1183,
  asad_2: 1224,
  asad_3: 1276,
  asad_4: 1335,
  asad_5: 1409,
  asad_6: 1481,
  satmasjid_1: 1511,
  satmasjid_2: 1568,
  zakir_1: 1639,
  zakir_2: 1727,
  zakir_3: 1840,
  zakir_4: 1937,
  zakir_5: 2016,
  zakir_6: 2121,
  ring_0: 2239,
  ring_1: 2369,
  ring_2: 2417,
  ring_3: 2507,
  ring_4: 2548,
  nurjahan_1: 2635,
  nurjahan_2: 2768,
  nurjahan_w: 2871,
  chanmia_s: 3002,
  salimullah_1: 3172,
  salimullah_2: 3292,
  salimullah_link: 3381,
  shershah_1: 3444,
  shershah_2: 3546,
  shershah_cross: 3635,
  shershah_deadend: 3695,
  tajmahal_1: 3762,
  tajmahal_2: 3833,
  tajmahal_3: 3889,
  tajmahal_4: 3951,
  tajmahal_5: 4016,
  aziz_1: 4064,
  aziz_2: 4136,
  aziz_3: 4228,
  shahjahan_1: 4280,
  shahjahan_2: 4367,
  shahjahan_3: 4499,
  post_shahjahan: 4556,
  aurangzeb_1: 4709,
  aurangzeb_2: 4800,
  iqbal_1: 4895,
  iqbal_2: 4990,
  iqbal_gate: 5043,
  humayun_1: 5155,
  humayun_2: 5262,
  humayun_3: 5433,
  humayun_4: 5522,
  humayun_taj: 5618,
  aurangzeb_humayun: 5682,
  iqbal_humayun: 5900,
  babar_0: 6048,
  babar_1: 6134,
  babar_2: 6277,
  babar_3: 6362,
  babar_link_w: 6459,
  babar_link_m: 6551,
  babar_link_h: 6622,
  babar_link_e: 6672,
  babar_deadend: 6745,
  bazar_cut_n: 6757,
  bazar_cut_se: 6775,
  krishi_cut_s: 6877,
  krishi_cut_n: 6949,
  lalmatia_cut: 7014,
  johuri_bypass: 7064,
};

/** Absolute stream index when the original building pass finished. */
export const LEGACY_BUILDING_END_OFFSET = 7151;

/**
 * Seed namespace for segments that are not in the legacy table. Distinct from
 * `LEGACY_BASE_SEED` so a new road can never collide with a legacy stream.
 */
export const NEW_SEGMENT_SEED = 0x5b17d4a1;

/**
 * `mulberry32` state after `n` draws, without consuming them.
 *
 * `state(n) = seed + n * STEP (mod 2^32)`. `Math.imul` keeps the product exact
 * in 32-bit space; `>>> 0` keeps the sum unsigned.
 */
export function advance(seed: number, n: number): number {
  return (seed + Math.imul(n, MULBERRY_STEP)) >>> 0;
}

/** True when this segment predates RNG isolation. */
export function isLegacySegment(segmentId: string): boolean {
  return Object.prototype.hasOwnProperty.call(LEGACY_BUILDING_OFFSETS, segmentId);
}

/**
 * Seed for one segment's building pass.
 *
 * Legacy segments replay their frozen absolute offset. New segments hash their
 * stable id into a separate seed space, so they are deterministic across runs,
 * processes and platforms, and independent of iteration order.
 */
export function buildingSeedFor(segmentId: string): number {
  if (isLegacySegment(segmentId)) {
    return advance(LEGACY_BASE_SEED, LEGACY_BUILDING_OFFSETS[segmentId]);
  }
  return (NEW_SEGMENT_SEED ^ hashString(segmentId)) >>> 0;
}

/** A fresh generator for one segment's building pass. */
export function buildingRngFor(segmentId: string): () => number {
  return mulberry32(buildingSeedFor(segmentId));
}

/**
 * Generator for post-building consumers (litter).
 *
 * Previously these continued the same shared stream and so began at absolute
 * index 7,151. Pinning that exact state keeps litter bit-identical while
 * decoupling it from both the props stage and the building pass.
 */
export function postBuildingRng(): () => number {
  return mulberry32(advance(LEGACY_BASE_SEED, LEGACY_BUILDING_END_OFFSET));
}
