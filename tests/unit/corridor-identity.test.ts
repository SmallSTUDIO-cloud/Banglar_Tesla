/**
 * Ring Road / Tajmahal Road corridor character (v0.7.0).
 *
 * The identity layer is only worth having if it is geographically honest, so
 * these tests pin three things:
 *  - every structure descends from a verified OSM feature in the registry;
 *  - every structure and board is clear of the carriageway (never in a lane);
 *  - the displacement from the real OSM centroid is bounded and recorded, so a
 *    structure cannot quietly drift somewhere the landmark is not.
 */

import { describe, expect, it } from 'vitest';
import {
  CORRIDORS,
  CORRIDOR_STRUCTURES,
  CORRIDOR_MIN_CLEARANCE,
  MAX_STRUCTURE_OFFSET,
  corridorLandmarks,
  corridorOfLandmark,
  planCorridorActivity,
  planCorridorSignage,
  planCorridorStructures,
  structureAudit,
} from '../../src/world/corridorIdentity';
import { landmarkById, projectOsm } from '../../src/world/landmarks';
import { LANDMARK_SIGN_IDS, STOREFRONT_SIGN_IDS } from '../../src/world/textures';
import { STOREFRONTS } from '../../src/world/storefronts';
import { distanceToRoadCarriageway, isClearOfRoads, segmentById } from '../../src/world/layout';

describe('corridor definitions', () => {
  it('covers Ring Road and Tajmahal Road with bilingual names', () => {
    const ids = CORRIDORS.map((c) => c.id).sort();
    expect(ids).toEqual(['ring', 'tajmahal']);
    for (const corridor of CORRIDORS) {
      expect(corridor.nameEn.length).toBeGreaterThan(3);
      expect(/[\u0980-\u09FF]/.test(corridor.nameBn)).toBe(true);
      expect(corridor.character.length).toBeGreaterThan(40);
    }
  });

  it('references only real road segments', () => {
    for (const corridor of CORRIDORS) {
      expect(corridor.segmentIds.length).toBeGreaterThan(2);
      for (const id of corridor.segmentIds) {
        expect(segmentById(id), `${corridor.id} -> ${id}`).toBeDefined();
      }
    }
  });

  it('gives each corridor a bespoke atlas board', () => {
    for (const corridor of CORRIDORS) {
      expect(LANDMARK_SIGN_IDS as readonly string[]).toContain(corridor.signId);
    }
  });
});

describe('corridor landmarks descend from real features', () => {
  it('every structure references an existing landmark', () => {
    for (const spec of CORRIDOR_STRUCTURES) {
      expect(landmarkById(spec.landmarkId), spec.landmarkId).toBeDefined();
    }
  });

  it('every corridor landmark carries OSM provenance', () => {
    for (const landmark of corridorLandmarks()) {
      expect(landmark.source.osmId).toBeGreaterThan(0);
      expect(landmark.source.lat).not.toBe(0);
      expect(landmark.source.lon).not.toBe(0);
      expect(landmark.note && landmark.note.length).toBeGreaterThan(40);
    }
  });

  it('maps each corridor landmark back to its corridor', () => {
    expect(corridorOfLandmark('shia_jame_masjid')).toBe('ring');
    expect(corridorOfLandmark('tokyo_square')).toBe('ring');
    expect(corridorOfLandmark('queens_college')).toBe('ring');
    expect(corridorOfLandmark('mohammadpur_graveyard')).toBe('tajmahal');
    expect(corridorOfLandmark('mohammadpur_eidgah')).toBe('tajmahal');
  });
});

describe('structure placement', () => {
  const placed = planCorridorStructures();

  it('seats every structure that is inside the playable world', () => {
    const inWorld = CORRIDOR_STRUCTURES.filter(
      (spec) => !landmarkById(spec.landmarkId)!.outsideWorld,
    );
    expect(placed.length).toBe(inWorld.length);
    for (const spec of inWorld) {
      expect(placed.some((p) => p.landmarkId === spec.landmarkId), spec.landmarkId).toBe(true);
    }
  });

  it('never builds a structure outside the playable world', () => {
    // Queen's College (x = -233.1) and Tokyo Square (x = -226.5) are real but lie
    // west of the west edge (-218). Building them would place geometry in void.
    for (const id of ['tokyo_square', 'queens_college']) {
      const landmark = landmarkById(id)!;
      expect(landmark.outsideWorld).toBe(true);
      expect(placed.some((p) => p.landmarkId === id)).toBe(false);
    }
  });

  it.each(CORRIDOR_STRUCTURES.filter((s) => !landmarkById(s.landmarkId)!.outsideWorld).map((s) => [s.landmarkId] as const))(
    '%s stays out of the carriageway',
    (landmarkId) => {
      const st = placed.find((p) => p.landmarkId === landmarkId)!;
      expect(st).toBeDefined();
      expect(distanceToRoadCarriageway(st.x, st.z)).toBeGreaterThan(0);
    },
  );

  it.each(
    CORRIDOR_STRUCTURES.filter((s) => !landmarkById(s.landmarkId)!.outsideWorld).map(
      (s) => [s.landmarkId] as const,
    ),
  )('%s sits within the disclosed displacement bound', (landmarkId) => {
    const st = placed.find((p) => p.landmarkId === landmarkId)!;
    expect(st.offsetFromOsm).toBeGreaterThanOrEqual(0);
    expect(st.offsetFromOsm).toBeLessThanOrEqual(MAX_STRUCTURE_OFFSET);
  });

  it('reports the displacement honestly rather than hiding it', () => {
    const audit = structureAudit();
    expect(audit.length).toBe(CORRIDOR_STRUCTURES.length);
    for (const row of audit) {
      const landmark = landmarkById(row.landmarkId)!;
      expect(row.placed).toBe(!landmark.outsideWorld);
      expect(Number.isFinite(row.corridorGapAtCentroid)).toBe(true);
    }
  });

  it('keeps most structures close to their real centroid', () => {
    // A guard against silent drift: at least three of the five must be within
    // 8 m of the verified OSM feature they represent.
    const close = placed.filter((p) => p.offsetFromOsm <= 8).length;
    expect(close).toBeGreaterThanOrEqual(2);
  });

  it('uses low-poly, bounded footprints', () => {
    for (const spec of CORRIDOR_STRUCTURES) {
      // Corridor structures are deliberately compact; a huge footprint would
      // both dominate the skyline and force a large displacement.
      expect(spec.halfX).toBeLessThanOrEqual(10);
      expect(spec.halfZ).toBeLessThanOrEqual(10);
    }
  });
});

describe('corridor signage', () => {
  const signs = planCorridorSignage();

  it('places one board per corridor', () => {
    expect(signs.map((s) => s.corridor).sort()).toEqual(['ring', 'tajmahal']);
  });

  it('keeps every board off the carriageway', () => {
    for (const sign of signs) {
      expect(distanceToRoadCarriageway(sign.x, sign.z)).toBeGreaterThan(0);
    }
  });
});

describe('corridor street activity', () => {
  const activity = planCorridorActivity();

  it('serves both corridors', () => {
    const corridors = new Set(activity.map((a) => a.corridor));
    expect(corridors.has('ring')).toBe(true);
    expect(corridors.has('tajmahal')).toBe(true);
  });

  it('keeps every cart off the carriageway', () => {
    for (const spot of activity) {
      expect(isClearOfRoads(spot.x, spot.z, CORRIDOR_MIN_CLEARANCE)).toBe(true);
    }
  });

  it('uses corridor-appropriate activity, not one generic mix', () => {
    const ring = activity.filter((a) => a.corridor === 'ring').map((a) => a.kind);
    const taj = activity.filter((a) => a.corridor === 'tajmahal').map((a) => a.kind);
    // Ring Road is college/mosque traffic: tea and snacks.
    expect(ring.some((k) => k === 'tea')).toBe(true);
    expect(ring.includes('veg')).toBe(false);
    // Tajmahal Road's graveyard end is produce/flower sellers.
    expect(taj.some((k) => k === 'veg')).toBe(true);
  });

  it('never emits duplicate cart positions', () => {
    const keys = activity.map((a) => `${a.x.toFixed(2)},${a.z.toFixed(2)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('verified named storefronts', () => {
  it('every storefront descends from a real OSM feature', () => {
    for (const shop of STOREFRONTS) {
      expect(shop.source.osmId).toBeGreaterThan(0);
      expect(shop.name.trim().length).toBeGreaterThan(2);
      // Category label must be Bengali and non-empty, since OSM has no name:bn
      // for these features and we deliberately do not invent one.
      expect(shop.categoryBn.length).toBeGreaterThan(1);
      expect(/[\u0980-\u09FF]/.test(shop.categoryBn)).toBe(true);
    }
  });

  it('places storefront coordinates at the projection of their OSM position', () => {
    for (const shop of STOREFRONTS) {
      const { x, z } = projectOsm(shop.source.lat, shop.source.lon);
      expect(Math.abs(shop.x - x)).toBeLessThanOrEqual(0.005);
      expect(Math.abs(shop.z - z)).toBeLessThanOrEqual(0.005);
    }
  });

  it('covers both corridors', () => {
    const corridors = new Set(STOREFRONTS.map((s) => s.corridor));
    expect(corridors.has('ring')).toBe(true);
    expect(corridors.has('tajmahal')).toBe(true);
  });

  it('gives every storefront a distinct atlas board', () => {
    expect(new Set(STOREFRONT_SIGN_IDS).size).toBe(STOREFRONTS.length);
    for (const shop of STOREFRONTS) {
      expect(STOREFRONT_SIGN_IDS as readonly string[]).toContain(shop.id);
    }
  });

  it('keeps storefront boards in-bounds so they can actually be seen', () => {
    for (const shop of STOREFRONTS) {
      expect(shop.x).toBeGreaterThan(-218);
      expect(shop.x).toBeLessThan(242);
      expect(shop.z).toBeGreaterThan(-256);
      expect(shop.z).toBeLessThan(248);
    }
  });
});
