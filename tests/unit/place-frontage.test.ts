/**
 * v0.7.0 audit of the legacy `PLACES` markers.
 *
 * Background: `makePlaceOnSegment` offsets a place marker onto its road by
 * `halfWidth * 0.58`, which is *inside* the asphalt. That makes 12 of the 14
 * markers sit in the carriageway. Markers are not geometry — they do not block
 * traffic — but a landmark marker standing in the middle of a lane is both
 * visually wrong and a poor anchor for shopfront-facing location identity.
 *
 * These tests pin the three properties that must hold both BEFORE and AFTER a
 * marker is moved, so relocation can never silently break gameplay:
 *
 *  1. FRONTAGE — the marker is off the asphalt (not in a traffic corridor).
 *  2. REACHABILITY — a rickshaw on the road can still get within
 *     `MISSION.acceptRadius` of the marker, otherwise pickups become
 *     impossible. This is the constraint that makes naive relocation dangerous.
 *  3. TRANSPORT — the debug/approach pose used to teleport to a place still
 *     lands on the carriageway, not on the sidewalk or inside a building.
 */

import { describe, expect, it } from 'vitest';
import { MISSION } from '../../src/core/config';
import {
  PLACES,
  distanceToRoadCarriageway,
  placeApproachPose,
  placeById,
  segmentById,
} from '../../src/world/layout';

/** Extra margin kept inside the accept radius so the pickup is comfortably reachable. */
const REACH_MARGIN = 1.0;

/** Distance from a point to the nearest carriageway edge (positive = outside). */
function roadGap(placeId: string): number {
  const p = placeById(placeId)!;
  return distanceToRoadCarriageway(p.x, p.z);
}

describe('PLACES audit — every marker is on a real road segment', () => {
  it.each(PLACES.map((p) => [p.id, p] as const))(
    '%s references a segment that exists',
    (_id, place) => {
      expect(segmentById(place.segmentId)).toBeDefined();
    },
  );

  it.each(PLACES.map((p) => [p.id, p] as const))(
    '%s is within 12 m of the carriageway it fronts',
    (id) => {
      // A marker far from any asphalt would be an unreachable or floating anchor.
      const gap = roadGap(id);
      expect(Math.abs(gap)).toBeLessThan(12);
    },
  );
});

describe('PLACES audit — markers stay out of traffic corridors', () => {
  // This is the check that was missing before v0.7.0.
  it.each(PLACES.map((p) => [p.id, p] as const))(
    '%s marker is not inside the carriageway',
    (id) => {
      expect(roadGap(id)).toBeGreaterThan(0);
    },
  );
});

describe('PLACES audit — pickups remain reachable', () => {
  // Constraint that stops a relocation from breaking missions: the marker must
  // stay close enough to the asphalt that a vehicle on the road is within the
  // mission accept radius.
  it.each(PLACES.map((p) => [p.id, p] as const))(
    '%s marker is within reach of a vehicle on the carriageway',
    (id) => {
      const gap = roadGap(id);
      expect(gap).toBeLessThan(MISSION.acceptRadius - REACH_MARGIN);
    },
  );
});

describe('PLACES audit — approach/teleport pose lands on the road', () => {
  it.each(PLACES.map((p) => [p.id, p] as const))(
    '%s snaps to a drivable pose',
    (_id, place) => {
      const snap = placeApproachPose(place.id)!;
      // Must be on (or beside) asphalt, never inside a block interior.
      expect(distanceToRoadCarriageway(snap.x, snap.z)).toBeLessThanOrEqual(0.05);
      // And it must still be close to the marker it represents.
      expect(Math.hypot(snap.x - place.x, snap.z - place.z)).toBeLessThan(
        MISSION.acceptRadius,
      );
      expect(segmentById(place.segmentId)).toBeDefined();
    },
  );
});

describe('PLACES audit — ids and i18n keys stay stable', () => {
  it('keeps the historical place ids so missions and races still resolve', () => {
    // Race waypoints and mission offers reference these by string; renaming any
    // of them silently breaks existing content.
    const expected = [
      'stand', 'bazaar', 'tea', 'school', 'garage', 'pharmacy', 'launch',
      'mosque', 'market', 'bridge', 'library', 'salimullah', 'humayun', 'zakir',
    ];
    expect(PLACES.map((p) => p.id).sort()).toEqual([...expected].sort());
  });

  it('gives every place a name key and a marker radius', () => {
    for (const place of PLACES) {
      expect(place.nameKey.startsWith('place.')).toBe(true);
      expect(place.marker).toBeGreaterThan(0);
    }
  });
});
