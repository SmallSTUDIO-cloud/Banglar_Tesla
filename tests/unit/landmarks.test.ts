/**
 * v0.7.0 geographic-accuracy validation (pure geometry, no Node builtins).
 *
 * These tests make fabricated or hand-nudged geography fail CI:
 *  - every landmark's game coordinate must be the *computed* projection of its
 *    stored OSM lat/lon, so a hand-tuned anchor cannot pass;
 *  - every landmark must land inside the playable world;
 *  - market place markers and vendor carts must stay off the carriageway.
 *
 * Cross-checking the stored OSM ids / lat / lon against the imported dataset
 * lives in `tests/map_import/test_landmark_provenance.py`, because this project
 * does not ship Node typings and the build type-checks test files too.
 */

import { describe, expect, it } from 'vitest';
import {
  LANDMARKS,
  MARKET_LANDMARK_IDS,
  PROJECTION,
  landmarkById,
  projectOsm,
} from '../../src/world/landmarks';
import { PLACES, distanceToRoadCarriageway, isClearOfRoads, segmentById } from '../../src/world/layout';
import {
  APRON_MIN_CLEARANCE,
  planMarketApron,
  planMarketSignage,
} from '../../src/world/marketApron';
import { LANDMARK_SIGN_IDS } from '../../src/world/textures';

/** Playable world extent, matching the road graph / buildable grid. */
const WORLD = { minX: -218, maxX: 242, minZ: -256, maxZ: 248 };

describe('landmark projection', () => {
  it('uses the documented Mohammadpur projection constants', () => {
    expect(PROJECTION.lat0).toBe(23.7624);
    expect(PROJECTION.lon0).toBe(90.3646);
    expect(PROJECTION.scale).toBe(0.36);
  });

  it('reproduces the documented Chan Miya Housing reference point', () => {
    // Documented in PHASE 6: 23.7598997, 90.3580661 -> x ~= -239.6, z ~= 100.0
    const { x, z } = projectOsm(23.7598997, 90.3580661);
    expect(x).toBeCloseTo(-239.6, 0);
    expect(z).toBeCloseTo(100.0, 0);
  });

  it.each(LANDMARKS.map((l) => [l.id, l] as const))(
    '%s game coordinate is the computed projection, not a hand-picked number',
    (_id, landmark) => {
      const { x, z } = projectOsm(landmark.source.lat, landmark.source.lon);
      // Stored to 2 dp; anything drifting further would be a fabricated anchor.
      expect(Math.abs(landmark.x - x)).toBeLessThanOrEqual(0.005);
      expect(Math.abs(landmark.z - z)).toBeLessThanOrEqual(0.005);
    },
  );
});

describe('landmark registry', () => {
  it('has unique ids', () => {
    const ids = LANDMARKS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('carries bilingual names and a provenance note', () => {
    for (const landmark of LANDMARKS) {
      expect(landmark.nameEn.length).toBeGreaterThan(2);
      expect(landmark.nameBn.length).toBeGreaterThan(2);
      // Bengali script sanity check (U+0980..U+09FF).
      expect(/[\u0980-\u09FF]/.test(landmark.nameBn)).toBe(true);
      expect(landmark.note && landmark.note.length).toBeGreaterThan(30);
      expect(landmark.source.osmId).toBeGreaterThan(0);
    }
  });

  it('declares a frontage road that actually exists for market landmarks', () => {
    for (const id of MARKET_LANDMARK_IDS) {
      const landmark = landmarkById(id)!;
      expect(landmark.frontageSegmentId, `${id} needs a frontage road`).toBeTruthy();
      expect(segmentById(landmark.frontageSegmentId!)).toBeDefined();
      expect([1, -1]).toContain(landmark.frontageSide);
    }
  });

  it('documents uncertainty rather than hiding it', () => {
    // Geneva Camp has two conflicting polygons in the extract; the registry
    // must record which feature it chose and why.
    const geneva = landmarkById('geneva_camp')!;
    expect(geneva.note).toContain('481245650');
    expect(geneva.source.osmType).toBe('node');
  });
});

describe('landmark placement', () => {
  it('every landmark projects inside the playable world', () => {
    for (const landmark of LANDMARKS) {
      expect(landmark.x).toBeGreaterThan(WORLD.minX);
      expect(landmark.x).toBeLessThan(WORLD.maxX);
      expect(landmark.z).toBeGreaterThan(WORLD.minZ);
      expect(landmark.z).toBeLessThan(WORLD.maxZ);
    }
  });
});

describe('market place markers', () => {
  it.each(['bazaar', 'market'])('%s marker sits off the carriageway', (placeId) => {
    const place = PLACES.find((p) => p.id === placeId)!;
    expect(place).toBeDefined();
    expect(distanceToRoadCarriageway(place.x, place.z)).toBeGreaterThan(0);
  });

  it.each([
    ['bazaar', 'town_hall_bazar'],
    ['market', 'krishi_market'],
  ])('%s marker is anchored to its real OSM market within 15 m', (placeId, landmarkId) => {
    const place = PLACES.find((p) => p.id === placeId)!;
    const landmark = landmarkById(landmarkId)!;
    expect(Math.hypot(place.x - landmark.x, place.z - landmark.z)).toBeLessThan(15);
  });

  it('does not leave the two named markets on the wrong road', () => {
    // Regression guard: before v0.7.0 "Town Hall Kacha Bazar" sat ~39 m west on
    // asad_3 and "Krishi Market Corner" sat on Ring Road, 55-75 m off.
    expect(PLACES.find((p) => p.id === 'bazaar')!.segmentId).toBe('asad_4');
    expect(PLACES.find((p) => p.id === 'market')!.segmentId).toBe('humayun_1');
  });
});

describe('market apron vendor plan', () => {
  const plan = planMarketApron();

  it('populates both authoritative markets', () => {
    const places = new Set(plan.map((s) => s.placeId));
    expect(places.has('bazaar')).toBe(true);
    expect(places.has('market')).toBe(true);
  });

  it('keeps every cart clear of the carriageway', () => {
    for (const stall of plan) {
      expect(isClearOfRoads(stall.x, stall.z, APRON_MIN_CLEARANCE)).toBe(true);
    }
  });

  it('keeps carts on the market frontage it belongs to', () => {
    for (const stall of plan) {
      const landmarkId = stall.placeId === 'bazaar' ? 'town_hall_bazar' : 'krishi_market';
      const landmark = landmarkById(landmarkId)!;
      const d = Math.hypot(stall.x - landmark.x, stall.z - landmark.z);
      expect(d).toBeGreaterThan(4);
      expect(d).toBeLessThan(30);
    }
  });

  it('weights the frontage toward vegetable vans and fruit carts', () => {
    const produce = plan.filter((s) => s.kind === 'veg' || s.kind === 'fruit').length;
    expect(produce / plan.length).toBeGreaterThan(0.5);
  });

  it('never emits duplicate cart positions', () => {
    const keys = plan.map((s) => `${s.x.toFixed(2)},${s.z.toFixed(2)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('market entrance boards', () => {
  const signs = planMarketSignage();
  const stalls = planMarketApron();

  it('gives each authoritative market one named board', () => {
    expect(signs.map((s) => s.placeId).sort()).toEqual(['bazaar', 'market']);
    expect(signs.map((s) => s.landmarkId).sort()).toEqual(['krishi_market', 'town_hall_bazar']);
  });

  it('draws the boards from the atlas named slots', () => {
    // Both market ids must have a bespoke board, otherwise the props layer
    // silently falls back to no signage at all.
    for (const id of MARKET_LANDMARK_IDS) {
      expect(LANDMARK_SIGN_IDS as readonly string[]).toContain(id);
    }
  });

  it('keeps boards off the carriageway', () => {
    for (const sign of signs) {
      expect(isClearOfRoads(sign.x, sign.z, APRON_MIN_CLEARANCE)).toBe(true);
    }
  });

  it('never overlaps a vendor cart', () => {
    // Board occupies |localX| <= 2.45 and |localZ| <= 0.35; a cart is ~1.1 m.
    for (const sign of signs) {
      const c = Math.cos(sign.yaw);
      const sn = Math.sin(sign.yaw);
      for (const stall of stalls) {
        if (stall.placeId !== sign.placeId) continue;
        const dx = stall.x - sign.x;
        const dz = stall.z - sign.z;
        const lx = dx * c - dz * sn;
        const lz = dx * sn + dz * c;
        const gapX = Math.max(0, Math.abs(lx) - 2.45);
        const gapZ = Math.max(0, Math.abs(lz) - 0.35);
        expect(Math.hypot(gapX, gapZ)).toBeGreaterThanOrEqual(1.1);
      }
    }
  });
});
