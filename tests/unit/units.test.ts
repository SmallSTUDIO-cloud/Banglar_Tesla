import { describe, expect, it } from 'vitest';
import {
  METERS_PER_WORLD_UNIT,
  PROJECTION_ORIGIN,
  UnitError,
  WORLD_SCALE,
  looksLikeMeters,
  meters,
  projectLatLon,
  toMeterLength,
  toMeters,
  toWorldLength,
  toWorldUnits,
  unprojectToLatLon,
  worldDistance,
  worldUnits,
  worldUnitsBetween,
} from '../../src/world/units';
import { PROJECTION, projectOsm } from '../../src/world/landmarks';

/**
 * The unit contract exists because this project stores two different length
 * spaces and used to blur them. These tests pin the arithmetic, pin the
 * projection to the one already shipped in `landmarks.ts`, and make the
 * width/length distinction explicit so it cannot quietly regress.
 */
describe('world unit contract', () => {
  describe('scale constants', () => {
    it('uses the documented 0.36 compression', () => {
      expect(WORLD_SCALE).toBe(0.36);
      expect(METERS_PER_WORLD_UNIT).toBeCloseTo(2.7777777, 6);
      // One real metre is well under one world unit — that asymmetry is the
      // whole reason a metre value mixed with a coordinate is so damaging.
      expect(toWorldUnits(meters(1))).toBeCloseTo(0.36, 12);
    });
  });

  describe('round trips', () => {
    it('metres -> world units -> metres is lossless', () => {
      for (const value of [0, 0.5, 3, 6, 12.2, 14.4, 219.8, 1254, 1e6]) {
        const roundTrip = toMeters(toWorldUnits(meters(value)));
        expect(roundTrip).toBeCloseTo(value, 9);
      }
    });

    it('world units -> metres -> world units is lossless', () => {
      for (const value of [0, 1, 6.1, 79.12, 453.09, 9999]) {
        const roundTrip = toWorldUnits(toMeters(worldUnits(value)));
        expect(roundTrip).toBeCloseTo(value, 9);
      }
    });

    it('length helpers use the same scale as the coordinate helpers', () => {
      expect(toWorldLength(meters(6))).toBeCloseTo(toWorldUnits(meters(6)), 12);
      expect(toMeterLength(worldUnits(12.2))).toBeCloseTo(toMeters(worldUnits(12.2)), 12);
    });
  });

  describe('geographic projection', () => {
    it('matches the projection already shipped in landmarks.ts', () => {
      expect(PROJECTION_ORIGIN.lat0).toBe(PROJECTION.lat0);
      expect(PROJECTION_ORIGIN.lon0).toBe(PROJECTION.lon0);
      expect(WORLD_SCALE).toBe(PROJECTION.scale);
    });

    it('produces identical coordinates to projectOsm for real features', () => {
      const samples: [number, number][] = [
        [23.7599477, 90.3663704], // town_hall_bazar (OSM way 223068917)
        [23.7683996, 90.3654545], // town_hall_mosque
        [23.764942675, 90.3584258], // an Asad Avenue corridor landmark
        [PROJECTION_ORIGIN.lat0, PROJECTION_ORIGIN.lon0],
      ];
      for (const [lat, lon] of samples) {
        const ours = projectLatLon(lat, lon);
        const theirs = projectOsm(lat, lon);
        expect(ours.x).toBeCloseTo(theirs.x, 9);
        expect(ours.z).toBeCloseTo(theirs.z, 9);
      }
    });

    it('puts the projection origin at the world origin', () => {
      const p = projectLatLon(PROJECTION_ORIGIN.lat0, PROJECTION_ORIGIN.lon0);
      expect(p.x).toBe(0);
      expect(p.z).toBe(0);
    });

    it('applies the expected scale over a known distance', () => {
      // 0.001 degrees of latitude = 111.132 real m = 40.0075 world units.
      const a = projectLatLon(23.7624, 90.3646);
      const b = projectLatLon(23.7634, 90.3646);
      const metres = worldDistance(a, b);
      expect(metres).toBeCloseTo(111.132, 2);
      expect(b.z - a.z).toBeCloseTo(-111.132 * WORLD_SCALE, 2);
    });

    it('unproject is the inverse of project', () => {
      const lat = 23.7601;
      const lon = 90.3672;
      const back = unprojectToLatLon(projectLatLon(lat, lon));
      expect(back.lat).toBeCloseTo(lat, 9);
      expect(back.lon).toBeCloseTo(lon, 9);
    });
  });

  describe('distance helpers', () => {
    it('reports world distance in real metres', () => {
      const d = worldDistance({ x: worldUnits(0), z: worldUnits(0) }, { x: worldUnits(30), z: worldUnits(40) });
      expect(d).toBeCloseTo(50 / WORLD_SCALE, 6);
    });

    it('agrees with the raw helper', () => {
      expect(worldUnitsBetween(0, 0, 3, 4)).toBeCloseTo(5, 12);
    });
  });

  describe('width and length are different spaces', () => {
    it('documents the live asad_4 distortion rather than hiding it', () => {
      // asad_4 at 6aa8146: length 79.12 world units, width authored as 12.2.
      const lengthUnits = 79.12;
      const widthAsAuthoredMeters = 12.2;
      const lengthMeters = toMeters(worldUnits(lengthUnits));

      // The width is authored at 1:1 metres, so drawn/real aspect do not match.
      const drawnAspect = widthAsAuthoredMeters / lengthUnits;
      const realAspect = widthAsAuthoredMeters / lengthMeters;

      expect(lengthMeters).toBeCloseTo(219.778, 2);
      // This is the measured 2.35x distortion from the architecture review §4.2.
      expect(drawnAspect / realAspect).toBeCloseTo(METERS_PER_WORLD_UNIT, 2);
      expect(drawnAspect / realAspect).toBeGreaterThan(2.3);
    });

    it('converting a width to world units removes the distortion', () => {
      const lengthUnits = worldUnits(79.12);
      const widthUnits = toWorldLength(meters(12.2));
      // Comparable magnitudes once both are in the same space.
      expect(Number(widthUnits) / Number(lengthUnits)).toBeLessThan(0.1);
      expect(toMeters(widthUnits)).toBeCloseTo(12.2, 9);
    });

    it('flags implausibly large "world units" as probably metres', () => {
      // Real carriageway widths in world units for this map: ~1.1-7.2.
      expect(looksLikeMeters([12.2, 11.5, 9.2])).toBe(true);
      expect(looksLikeMeters([toWorldLength(meters(12.2))])).toBe(false);
    });
  });

  describe('invalid and ambiguous inputs', () => {
    it('rejects NaN and Infinity', () => {
      expect(() => toWorldUnits(meters(Number.NaN))).toThrow(UnitError);
      expect(() => toMeters(worldUnits(Number.POSITIVE_INFINITY))).toThrow(UnitError);
      expect(() => worldUnits(Number.NaN)).toThrow(UnitError);
      expect(() => meters(Number.NEGATIVE_INFINITY)).toThrow(UnitError);
    });

    it('rejects non-positive dimensions, where zero or negative is always a bug', () => {
      expect(() => toWorldLength(meters(0))).toThrow(UnitError);
      expect(() => toWorldLength(meters(-6))).toThrow(UnitError);
      expect(() => toMeterLength(worldUnits(0))).toThrow(UnitError);
      expect(() => toMeterLength(worldUnits(-1))).toThrow(UnitError);
    });

    it('allows signed values through the plain converters', () => {
      // A signed offset is legitimate; only *dimensions* are constrained.
      expect(toWorldUnits(meters(-6))).toBeCloseTo(-2.16, 12);
    });

    it('rejects out-of-range and non-finite geographic input', () => {
      expect(() => projectLatLon(91, 90)).toThrow(UnitError);
      expect(() => projectLatLon(-91, 90)).toThrow(UnitError);
      expect(() => projectLatLon(23, 181)).toThrow(UnitError);
      expect(() => projectLatLon(Number.NaN, 90)).toThrow(UnitError);
    });

    it('rejects non-finite distance inputs rather than returning NaN', () => {
      expect(() => worldDistance({ x: worldUnits(0), z: worldUnits(0) }, { x: worldUnits(Number.NaN), z: worldUnits(0) })).toThrow(
        UnitError,
      );
      expect(() => worldUnitsBetween(0, 0, Number.NaN, 0)).toThrow(UnitError);
    });

    it('names the failing argument so a mixed-space bug is diagnosable', () => {
      // NaN is caught at the constructor that declares the space, i.e. as early
      // as possible, and the message names that constructor.
      expect(() => meters(Number.NaN)).toThrow(/meters must be a finite number/);
      expect(() => worldUnits(Number.NaN)).toThrow(/worldUnits must be a finite number/);
      expect(() => toWorldLength(meters(-1))).toThrow(/positive dimension/);
      // Out-of-range geography names the offending axis.
      expect(() => projectLatLon(91, 90)).toThrow(/lat out of range/);
      expect(() => projectLatLon(23, 181)).toThrow(/lon out of range/);
    });
  });
});
