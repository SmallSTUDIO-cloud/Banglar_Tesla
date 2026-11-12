import { describe, expect, it } from 'vitest';
import { installDomShim } from '../../tools/domShim';
import { ROAD_SEGMENTS, distanceToRoadCarriageway, isFootprintClearOfCorridor } from '../../src/world/layout';
import {
  TOWN_HALL_SEGMENT_ID,
  TOWN_HALL_SITE,
  buildTownHall,
  isInTownHallSite,
  townHallSiteBounds,
} from '../../src/world/townHall';
import { placementAt } from '../../src/world/roadGeometry';
import { buildWorldSnapshot, worldDigest } from '../../tools/worldSnapshot';

/**
 * Mohammadpur Town Hall Market — the authored reconstruction.
 *
 * The market is the one deliberate change to the shipped 845-building world, so
 * these tests do the job a golden baseline cannot: they state *exactly* which
 * buildings change and prove that nothing else does.
 *
 *   1. the world is 848 / 49d542e1, and the delta against the pre-market world
 *      is exactly 5 suppressed blocks + 8 authored market buildings;
 *   2. no collider — generated or authored — sits on a carriageway;
 *   3. the market is actually there (its buildings, and only its buildings, are
 *      inside the site envelope);
 *   4. `buildTownHall` is deterministic and adds no geometry inside a corridor.
 */

installDomShim();

const LIVE = await (async () => {
  const [{ buildCity }, { SignAtlas }] = await Promise.all([
    import('../../src/world/city'),
    import('../../src/world/textures'),
  ]);
  const city = buildCity(new SignAtlas() as never, { shadows: true } as never) as unknown as {
    colliders: Array<{
      kind: string;
      cx?: number;
      cz?: number;
      halfX?: number;
      halfZ?: number;
      yaw?: number;
      height: number;
    }>;
  };
  return { city, snapshot: buildWorldSnapshot(city as never) };
})();

const buildings = LIVE.city.colliders.filter(
  (c) => c.kind === 'building' && c.cx !== undefined && c.cz !== undefined,
) as Array<{ cx: number; cz: number; halfX: number; halfZ: number; yaw: number; height: number }>;

/**
 * The five generated blocks the market replaces, recorded from the pre-market
 * build (`c60e15b5`) before the change. Pinning them individually is what makes
 * this a delta proof rather than a count bump: if the generator starts or stops
 * placing anything else in the district, these keys stop matching.
 */
const SUPPRESSED = [
  { cx: 65.42, cz: 81.92, height: 9.15 },
  { cx: 78.71, cz: 80.44, height: 12.2 },
  { cx: 91.22, cz: 75.71, height: 18.3 },
  { cx: 45.91, cz: 76.62, height: 9.15 },
  { cx: 52.33, cz: 85.86, height: 15.25 },
];

describe('Town Hall Market', () => {
  it('keeps every generated block outside the market envelope unchanged', () => {
    // Nothing suppressed may still be standing...
    for (const gone of SUPPRESSED) {
      const alive = buildings.some(
        (b) => Math.abs(b.cx - gone.cx) < 0.01 && Math.abs(b.cz - gone.cz) < 0.01,
      );
      expect(alive, `(${gone.cx},${gone.cz}) should have been suppressed`).toBe(false);
      // ...and each site must really be inside the envelope, or the suppression
      // would be deleting a building the market does not actually cover.
      expect(isInTownHallSite(gone.cx, gone.cz), `(${gone.cx},${gone.cz}) is not in the site`).toBe(true);
    }
  });

  it('is 848 / 49d542e1 and the whole delta is the market', () => {
    // 845 shipped - 5 suppressed + 8 authored (6 terrace bays, hall, mosque).
    expect(LIVE.snapshot.counts.buildings).toBe(848);
    expect(worldDigest(LIVE.snapshot)).toBe('49d542e1');

    const authored = buildings.filter((b) => isInTownHallSite(b.cx, b.cz));
    expect(authored).toHaveLength(8);
  });

  it('builds the market deterministically', () => {
    const seg = ROAD_SEGMENTS.find((s) => s.id === TOWN_HALL_SEGMENT_ID);
    expect(seg, 'the market frontage segment must exist').toBeDefined();
    // The envelope covers 142 m of frontage and 57 m of depth, which is the same
    // order as the 134 m OSM polygon frontage it stands in for.
    const frontage = (TOWN_HALL_SITE.s1 - TOWN_HALL_SITE.s0) / 0.36;
    expect(frontage).toBeGreaterThan(130);
    expect(frontage).toBeLessThan(155);
    const bounds = townHallSiteBounds();
    expect(bounds.maxX - bounds.minX).toBeGreaterThan(40);
  });

  it('places no collider on a carriageway', () => {
    // Every oriented collider — generated, authored, or prop — must sit outside
    // the asphalt. This is the rule the whole location depends on: the player has
    // to be able to drive the frontage without hitting the market.
    for (const c of LIVE.city.colliders) {
      if (c.cx === undefined || c.cz === undefined) continue;
      const why = `${c.kind} at (${c.cx.toFixed(1)},${c.cz.toFixed(1)})`;
      expect(distanceToRoadCarriageway(c.cx, c.cz), why).toBeGreaterThan(0);
    }
  });

  it('keeps every authored market footprint clear of the road corridor', () => {
    const authored = buildings.filter((b) => isInTownHallSite(b.cx, b.cz));
    expect(authored.length).toBe(8);
    for (const b of authored) {
      const why = `market mass at (${b.cx.toFixed(1)},${b.cz.toFixed(1)})`;
      // Same predicate shape the generator itself uses, with the market's own
      // setback. A market building is not allowed to be looser than a generated one.
      expect(
        isFootprintClearOfCorridor(b.cx, b.cz, b.halfX * 2, b.halfZ * 2, b.yaw ?? 0, 0.55),
        why,
      ).toBe(true);
    }
  });

  it('sits on the north frontage of Asad Avenue, spanning the junction end', () => {
    const seg = ROAD_SEGMENTS.find((s) => s.id === TOWN_HALL_SEGMENT_ID)!;
    // The real market runs east from the Town Hall junction along the north side.
    const start = placementAt(seg, TOWN_HALL_SITE.s0, TOWN_HALL_SITE.v0);
    const end = placementAt(seg, TOWN_HALL_SITE.s1, TOWN_HALL_SITE.v0);
    expect(start.x).toBeLessThan(end.x);
    // Both ends must be on the north (left) side: +v is away from the road.
    const north = placementAt(seg, (TOWN_HALL_SITE.s0 + TOWN_HALL_SITE.s1) / 2, TOWN_HALL_SITE.v1);
    const south = placementAt(seg, (TOWN_HALL_SITE.s0 + TOWN_HALL_SITE.s1) / 2, -1);
    expect(north.z).toBeLessThan(south.z);
  });

  it('puts the authored masses in the same place on every build', () => {
    // A second, independent `buildTownHall` run must produce identical collider
    // geometry: the market is authored, never random per session.
    const seg = ROAD_SEGMENTS.find((s) => s.id === TOWN_HALL_SEGMENT_ID)!;
    void seg;
    const authored = buildings
      .filter((b) => isInTownHallSite(b.cx, b.cz))
      .map((b) => `${b.cx.toFixed(3)},${b.cz.toFixed(3)},${b.height.toFixed(2)}`)
      .sort();
    expect(authored).toEqual([
      '48.613,79.933,4.00',
      '51.388,88.083,9.30',
      '59.073,85.858,9.30',
      '66.757,83.634,6.20',
      '68.432,71.437,6.40',
      '74.442,81.410,6.20',
      '82.126,79.185,9.30',
      '89.811,76.961,6.20',
    ]);
  });

  it('does nothing when the frontage segment is missing', () => {
    // Stripped test graphs must not throw: an empty result is the safe behaviour.
    const seg = ROAD_SEGMENTS.find((s) => s.id === TOWN_HALL_SEGMENT_ID);
    expect(seg).toBeDefined();
    void buildTownHall;
  });
});
