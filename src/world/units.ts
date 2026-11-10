/**
 * World unit contract.
 *
 * This project mixes two length spaces, and before this module that mix was
 * implicit. Getting it wrong is not hypothetical: road `width` is authored in
 * real metres while node positions and segment `length` are compressed by
 * `WORLD_SCALE`, and a metre value dropped straight into the compressed space
 * comes out **`1 / WORLD_SCALE` = 2.7778x too wide relative to the road's own
 * length**.
 *
 * The live example: `asad_4` is stored 12.2 u wide over a 79.12 u chord
 * (aspect 0.1542), where a correctly converted 12.2 m is 4.392 u (aspect
 * 0.0555) — a ratio of exactly `1 / WORLD_SCALE`. Both the derivation and the
 * live graph values are pinned by `tests/unit/units.test.ts`.
 *
 * The rule this module encodes:
 *
 *   - EVERY stored coordinate and distance is `WorldUnits` (compressed).
 *   - EVERY authored real-world dimension (width, footway, median, storey
 *     height) is `Meters`.
 *   - Conversion happens only at the boundaries listed below.
 *
 * `WorldUnits` and `Meters` are branded numbers, so the compiler rejects passing
 * one where the other is expected. Existing call sites keep using plain
 * `number`; the brands are opt-in for new geometry code, which is exactly where
 * the mistakes happen.
 *
 * ## Conversion boundaries
 *
 * 1. **OSM ingest** — WGS84 degrees -> `WorldUnits`, via `projectLatLon()`. This
 *    is the only place latitude/longitude is read. Mirrors `projectOsm()` in
 *    `landmarks.ts` exactly (asserted by test).
 * 2. **Cross-section data** — authored `Meters` -> `WorldUnits` via
 *    `toWorldLength()` before anything is mixed with a position. A median width
 *    or lane width must never be added to a coordinate unconverted.
 * 3. **Rendering** — building/vehicle models keep real-metre *sizes* (a 3.05 m
 *    storey stays 3.05) while being *positioned* in `WorldUnits`. This is the
 *    one intentional mixed space; it is documented rather than accidental.
 * 4. **Player-facing output** — HUD, map labels and mission text must show
 *    `toMeters()`, never raw world units.
 *
 * Nothing in this module changes an existing coordinate, width, length or
 * object dimension. It only names the spaces.
 */

/** Compressed world units -> real metres. 1 unit = 1 / 0.36 = 2.7778 m. */
export const WORLD_SCALE = 0.36;

/** Real metres per world unit. */
export const METERS_PER_WORLD_UNIT = 1 / WORLD_SCALE;

/** World units per real metre. */
export const WORLD_UNITS_PER_METER = WORLD_SCALE;

/** Projection origin, matching `PROJECTION` in `src/world/landmarks.ts`. */
export const PROJECTION_ORIGIN = {
  lat0: 23.7624,
  lon0: 90.3646,
} as const;

/** Metres per degree of latitude (spherical approximation, constant). */
export const METERS_PER_DEG_LAT = 111132;

/** Metres per degree of longitude at `lat0`. */
export const METERS_PER_DEG_LON = 111320 * Math.cos((PROJECTION_ORIGIN.lat0 * Math.PI) / 180);

// Branded length types -------------------------------------------------------

declare const worldUnitsBrand: unique symbol;
declare const metersBrand: unique symbol;

/** A length in compressed world units. */
export type WorldUnits = number & { readonly [worldUnitsBrand]: 'world' };

/** A length in real metres. */
export type Meters = number & { readonly [metersBrand]: 'meters' };

export class UnitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnitError';
  }
}

/** Reject values that would silently poison geometry (NaN, Infinity, non-numeric). */
function assertFinite(value: number, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new UnitError(`${label} must be a finite number, received ${String(value)}`);
  }
}

/**
 * Declare a number as already being in world units. Performs **no** scaling.
 * Use for literals that are authored directly in the compressed space.
 */
export function worldUnits(value: number): WorldUnits {
  assertFinite(value, 'worldUnits');
  return value as WorldUnits;
}

/** Declare a number as already being in real metres. Performs **no** scaling. */
export function meters(value: number): Meters {
  assertFinite(value, 'meters');
  return value as Meters;
}

/**
 * Real metres -> world units. Boundary 1 of 4.
 *
 * Use for any authored dimension that will be combined with a coordinate.
 */
export function toWorldUnits(value: Meters): WorldUnits {
  assertFinite(value, 'toWorldUnits input');
  return (value * WORLD_SCALE) as WorldUnits;
}

/**
 * World units -> real metres. Boundary 4 of 4.
 *
 * Use for anything a player reads, and for comparing against surveyed OSM
 * distances.
 */
export function toMeters(value: WorldUnits): Meters {
  assertFinite(value, 'toMeters input');
  return (value / WORLD_SCALE) as Meters;
}

/**
 * A physical dimension (width, median, footway, lane) in metres -> world units.
 *
 * Rejects negative and zero lengths: a zero-width carriageway or a negative
 * median is always a bug, never a valid input. Use `toWorldUnits` directly if a
 * signed value is genuinely needed.
 */
export function toWorldLength(value: Meters): WorldUnits {
  assertFinite(value, 'toWorldLength input');
  if (value <= 0) {
    throw new UnitError(`toWorldLength expects a positive dimension, received ${value}`);
  }
  return (value * WORLD_SCALE) as WorldUnits;
}

/** A positive physical dimension expressed in world units -> metres. */
export function toMeterLength(value: WorldUnits): Meters {
  assertFinite(value, 'toMeterLength input');
  if (value <= 0) {
    throw new UnitError(`toMeterLength expects a positive dimension, received ${value}`);
  }
  return (value / WORLD_SCALE) as Meters;
}

// Geographic projection ------------------------------------------------------

export interface WorldPoint {
  x: WorldUnits;
  z: WorldUnits;
}

/**
 * WGS84 lat/lon -> world units. Boundary 1 of 4.
 *
 * Identical arithmetic to `projectOsm()` in `landmarks.ts`; a test asserts the
 * two agree to within floating-point noise so they cannot drift apart.
 */
export function projectLatLon(lat: number, lon: number): WorldPoint {
  assertFinite(lat, 'lat');
  assertFinite(lon, 'lon');
  if (lat < -90 || lat > 90) throw new UnitError(`lat out of range: ${lat}`);
  if (lon < -180 || lon > 180) throw new UnitError(`lon out of range: ${lon}`);
  return {
    x: ((lon - PROJECTION_ORIGIN.lon0) * METERS_PER_DEG_LON * WORLD_SCALE) as WorldUnits,
    z: ((PROJECTION_ORIGIN.lat0 - lat) * METERS_PER_DEG_LAT * WORLD_SCALE) as WorldUnits,
  };
}

/** Inverse of `projectLatLon`, for diagnostics and provenance checks. */
export function unprojectToLatLon(point: WorldPoint): { lat: number; lon: number } {
  assertFinite(point.x, 'point.x');
  assertFinite(point.z, 'point.z');
  return {
    lat: PROJECTION_ORIGIN.lat0 - point.z / (METERS_PER_DEG_LAT * WORLD_SCALE),
    lon: PROJECTION_ORIGIN.lon0 + point.x / (METERS_PER_DEG_LON * WORLD_SCALE),
  };
}

// Distances ----------------------------------------------------------------

/**
 * Straight-line distance between two world-unit points, returned in real
 * metres. Because the projection is a uniform scale, the ratio is constant and
 * no per-axis correction is needed.
 */
export function worldDistance(a: WorldPoint, b: WorldPoint): Meters {
  assertFinite(a.x, 'a.x');
  assertFinite(a.z, 'a.z');
  assertFinite(b.x, 'b.x');
  assertFinite(b.z, 'b.z');
  const units = Math.hypot(b.x - a.x, b.z - a.z);
  return (units / WORLD_SCALE) as Meters;
}

/** Distance in world units between two raw coordinate pairs. */
export function worldUnitsBetween(ax: number, az: number, bx: number, bz: number): WorldUnits {
  assertFinite(ax, 'ax');
  assertFinite(az, 'az');
  assertFinite(bx, 'bx');
  assertFinite(bz, 'bz');
  return Math.hypot(bx - ax, bz - az) as WorldUnits;
}

/**
 * Guard for the most common real bug: a metre value reaching code that expects
 * world units. A road 6 m wide becomes 2.16 world units; a value that is
 * suspiciously large for its kind is a converted-by-mistake value.
 *
 * Returns `true` when the value is plausibly in world units for a carriageway.
 */
export function looksLikeMeters(valuesInWorldUnits: readonly number[]): boolean {
  // A Dhaka carriageway is 3-20 m => 1.08-7.2 world units. Anything above this
  // ceiling is, with overwhelming likelihood, an unconverted metre value.
  return valuesInWorldUnits.some((v) => Number.isFinite(v) && v > 8);
}
