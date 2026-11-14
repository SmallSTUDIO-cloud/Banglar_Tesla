import { describe, expect, it } from 'vitest';
import { POIS, POIS_IN_WORLD, poiById } from '../../src/world/poiRegistry';

/**
 * Provenance gate for the POI registry (pure geometry, no Node builtins).
 *
 * Re-derives every coordinate from the stored lat/lon with the same projection
 * the world uses, so a hand-nudged x/z cannot pass.
 *
 * Cross-checking the stored OSM ids / lat / lon against the imported dataset
 * lives in `tests/map_import/test_poi_provenance.py`, following the same split
 * as the landmark provenance gate: this project ships no Node typings and the
 * build type-checks test files too.
 */

const LAT0 = 23.7624;
const LON0 = 90.3646;
const SCALE = 0.36;

function project(lat: number, lon: number): { x: number; z: number } {
  return {
    x: (lon - LON0) * 111320 * Math.cos((LAT0 * Math.PI) / 180) * SCALE,
    z: (LAT0 - lat) * 111132 * SCALE,
  };
}

describe('POI registry provenance', () => {
  it('has a usable number of entries', () => {
    expect(POIS.length).toBeGreaterThanOrEqual(12);
  });

  it('has unique ids and unique OSM feature ids', () => {
    expect(new Set(POIS.map((p) => p.id)).size).toBe(POIS.length);
    expect(new Set(POIS.map((p) => p.osmId)).size).toBe(POIS.length);
  });

  it.each(POIS.map((p) => [p.id, p] as const))('%s re-projects to its stored coordinate', (id, poi) => {
    const derived = project(poi.lat, poi.lon);
    const drift = Math.hypot(derived.x - poi.x, derived.z - poi.z);
    expect(drift, `${id} drifted ${drift.toFixed(4)} m`).toBeLessThan(0.005);
  });

  it('marks out-of-world features rather than pretending they are reachable', () => {
    const XMIN = -218;
    const XMAX = 242;
    const ZMIN = -256;
    const ZMAX = 248;
    for (const poi of POIS) {
      const inside = poi.x >= XMIN && poi.x <= XMAX && poi.z >= ZMIN && poi.z <= ZMAX;
      expect(poi.insideWorld, `${poi.id} insideWorld flag disagrees with the extent`).toBe(inside);
    }
  });

  it('keeps a Bengali name and a note on every entry', () => {
    for (const poi of POIS) {
      expect(poi.nameBn.length, poi.id).toBeGreaterThan(0);
      expect(poi.note.length, poi.id).toBeGreaterThan(0);
    }
  });

  it('exposes lookups consistently with the filtered list', () => {
    expect(POIS_IN_WORLD.every((p) => p.insideWorld)).toBe(true);
    expect(POIS_IN_WORLD.length).toBeLessThan(POIS.length);
    expect(poiById(POIS[0].id)).toBe(POIS[0]);
    expect(poiById('does-not-exist')).toBeUndefined();
  });
});
