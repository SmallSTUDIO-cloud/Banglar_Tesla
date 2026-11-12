/**
 * Deterministic per-region fill budgets for newly mapped areas.
 *
 * ## Why this exists
 *
 * `docs/INTERIOR_INFILL_ISOLATION.md` §3.2 replaced the mutable `interiorCount` /
 * `infillCount` counters with frozen ordinals looked up by candidate coordinate.
 * That made the shipped world topology-local, but it left one deliberate hole: a
 * candidate with **no** frozen ordinal was *skipped*, so a road added to a region
 * the shipped world never covered received main-pass frontage only — no infill, no
 * block-interior fill.
 *
 * This module gives such candidates their own budget, without reintroducing a
 * shared counter.
 *
 * ## Region identity
 *
 * A region is a square cell of `REGION_SIZE` world units, keyed by its integer
 * cell coordinates: `"floor(x/SIZE),floor(z/SIZE)"`.
 *
 * The key depends only on position, so it is stable across runs, processes,
 * machines and segment array order. Two roads that never share a cell can never
 * affect each other's budget.
 *
 * ## Why 48 units
 *
 * Measured from the shipped world's 160 frozen interior candidates
 * (see `docs/REGIONAL_FILL.md` §2 for the full table). At a 48-unit cell the
 * legacy world occupies 53 regions carrying:
 *
 *   min 1 · median 3 · p75 4 · max 10
 *
 * A 36-unit cell fragments the same buildings across 67 mostly-1-building regions;
 * a 96-unit cell pools them into a lumpy 1–14 distribution. 48 keeps each region a
 * believable city block while leaving the most populated legacy region (10) above
 * the budget ceiling, so no new region can out-densify the densest shipped one.
 *
 * ## Why the budget is a range, not a constant
 *
 * `4..8`, derived from a stable hash of the region key:
 *   - the floor (4) is the legacy p75, so a newly mapped area reaches ordinary
 *     legacy density rather than looking sparse;
 *   - the ceiling (8) stays under the legacy maximum (10), so new regions cannot
 *     out-densify anything that ships today;
 *   - varying it by region avoids a uniform stamp while staying deterministic.
 *
 * ## What this deliberately does not do
 *
 * It does not renumber, reorder or otherwise influence legacy candidates. Those
 * are resolved by `legacyFillLayout.ts` before this module is consulted, and the
 * legacy phase never reads a region budget.
 */

import { hashString } from '../core/mathx';

/** Side length of one fill region, in world units. See the module doc for why. */
export const REGION_SIZE = 48;

/** Inclusive lower bound of a region's interior/infill budget. */
export const REGION_BUDGET_MIN = 4;

/** Inclusive upper bound of a region's interior/infill budget. */
export const REGION_BUDGET_MAX = 8;

/** Stable integer cell coordinates for a world position. */
export function regionCell(x: number, z: number): { cx: number; cz: number } {
  // `Math.floor` (not truncation) so negative coordinates get their own cells
  // instead of collapsing onto the zero cell.
  return { cx: Math.floor(x / REGION_SIZE), cz: Math.floor(z / REGION_SIZE) };
}

/** Stable region identity for a world position. */
export function regionKeyOf(x: number, z: number): string {
  const { cx, cz } = regionCell(x, z);
  return `${cx},${cz}`;
}

/**
 * Budget for one region, in the inclusive range `REGION_BUDGET_MIN..MAX`.
 *
 * A pure function of the region key: no counter, no global state, no dependence
 * on iteration order or on how many regions were considered before this one.
 */
export function regionBudget(regionKey: string): number {
  const span = REGION_BUDGET_MAX - REGION_BUDGET_MIN + 1;
  return REGION_BUDGET_MIN + (hashString(regionKey) % span);
}

/** Convenience overload: budget for the region containing `(x, z)`. */
export function regionBudgetAt(x: number, z: number): number {
  return regionBudget(regionKeyOf(x, z));
}

/**
 * Deterministic fill ordinal for a non-legacy candidate.
 *
 * Legacy candidates use their frozen ordinal from `legacyFillLayout.ts`. A
 * candidate outside the shipped world has no such ordinal, and must **not** take
 * one from a shared running counter — that is the coupling this whole line of
 * work removes. Instead its ordinal is derived from its own quantised position,
 * so it is stable regardless of what else is generated, and every styled property
 * (width, depth, floor count, tint, stall variant) becomes a property of the
 * candidate rather than of the order it happened to be visited in.
 *
 * The value is squeezed into `0..MODULUS-1`; callers only ever use it modulo a
 * small constant, so the absolute magnitude is meaningless.
 */
export const FILL_ORDINAL_MODULUS = 1000;

export function derivedFillOrdinal(x: number, z: number): number {
  // 1 cm quantisation: two distinct candidate centres never collide in practice,
  // and a sub-centimetre float wobble cannot change the derived style.
  const qx = Math.round(x * 100);
  const qz = Math.round(z * 100);
  return hashString(`${qx}:${qz}`) % FILL_ORDINAL_MODULUS;
}

/**
 * Per-region usage ledger.
 *
 * Owned by a single `buildCity()` call and never shared across calls, so a build
 * always starts with every region empty. `tryConsume` is the only mutator: it
 * spends one unit of a region's budget and reports whether it was available.
 */
export class RegionBudgetLedger {
  private readonly used = new Map<string, number>();

  /** Units already spent in `regionKey`. */
  usedIn(regionKey: string): number {
    return this.used.get(regionKey) ?? 0;
  }

  /** Units still available in `regionKey`. */
  remainingIn(regionKey: string): number {
    return regionBudget(regionKey) - this.usedIn(regionKey);
  }

  /** Spend one unit. Returns false when the region is already at its budget. */
  tryConsume(regionKey: string): boolean {
    const spent = this.usedIn(regionKey);
    if (spent >= regionBudget(regionKey)) return false;
    this.used.set(regionKey, spent + 1);
    return true;
  }

  /** Snapshot for diagnostics and tests; keyed by region, sorted by key. */
  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const key of [...this.used.keys()].sort()) out[key] = this.used.get(key)!;
    return out;
  }

  /** Total units spent across every region. */
  totalUsed(): number {
    let total = 0;
    for (const n of this.used.values()) total += n;
    return total;
  }
}
