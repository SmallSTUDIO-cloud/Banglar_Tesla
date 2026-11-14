/**
 * The synthetic road used by the eviction audit.
 *
 * This is the exact segment the existing perturbation tests insert
 * (`tests/unit/road-corridor-index.test.ts`, `tests/unit/fill-isolation.test.ts`):
 * a 9 m main road cutting diagonally through the mapped blocks from
 * (-60, -200) to (60, 160). It exists only in this diagnostic process — it is
 * pushed into the live `ROAD_SEGMENTS` array, the spatial index is rebuilt, and
 * the array is restored afterwards. No production data is touched.
 */

import type { RoadSegment } from '../../src/world/layout';

export const SYNTHETIC_ROAD_ID = 'synth_near';

export function makeSyntheticRoad(
  id = SYNTHETIC_ROAD_ID,
  ax = -60,
  az = -200,
  bx = 60,
  bz = 160,
): RoadSegment {
  const length = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / length;
  const uz = (bz - az) / length;
  return {
    id,
    from: `${id}_a`,
    to: `${id}_b`,
    ax, az, bx, bz,
    length, ux, uz,
    leftX: uz, leftZ: -ux,
    width: 9, halfWidth: 4.5, sidewalk: 1.5,
    kind: 'main',
    nameEn: 'Synthetic Audit Road',
    nameBn: 'Synthetic Audit Road',
    source: 'osm',
    jamProne: true,
    deadEnd: false,
    axis: 'x',
    center: az,
    fromCoord: Math.min(ax, bx),
    toCoord: Math.max(ax, bx),
  };
}

export const SYNTHETIC_ROAD = makeSyntheticRoad();
