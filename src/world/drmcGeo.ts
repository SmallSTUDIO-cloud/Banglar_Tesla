/**
 * DRMC source notes and compact, deliberately approximate game placement.
 *
 * OSM way 1008314351 supplies the geographic campus polygon (ODbL); it is kept
 * below for the developer overlay. The district similarity fit has ~46 m RMS
 * residual and cannot accurately locate a gate. The spec's candidate gate
 * coordinate was not verified against way 1386522766: its geometry could not be
 * retrieved. The OSM polygon, official college gallery and Wikimedia Commons
 * photos establish general context, not a surveyed in-game layout.
 *
 * The main portal takes its broad white frame, red piers and dark lettering from
 * the viewed Commons Front_Gate_DRMC.jpg thumbnail. Commons lists DRMC
 * Administration and CC BY-SA 4.0, while the image bears a MINHAZ NION
 * watermark; photographic authorship has not been independently verified and
 * the photo itself is not bundled. Blocks, courts and vegetation are original
 * approximations informed by viewed campus photos.
 * The second gate's appearance and exact location could not be verified and are
 * a clearly provisional, functional design, NOT a claim about the real gate.
 *
 * In v0.6 the nominal parcel crossed six existing roads. The game parcel is now
 * compressed into the adjacent road block so those roads and their navigation
 * stay intact. Its dimensions, internal layout and two road frontages are
 * gameplay approximations of the 52-acre campus, not a faithful scale map.
 */

export interface GeoPoint {
  lon: number;
  lat: number;
}

export interface GamePoint {
  x: number;
  z: number;
}

/** OSM way 1008314351 campus boundary (GeoJSON winding, [lon, lat]). */
export const DRMC_OSM_POLYGON: GeoPoint[] = [
  { lon: 90.3648705, lat: 23.7666087 },
  { lon: 90.3661172, lat: 23.7630213 },
  { lon: 90.3705106, lat: 23.7643194 },
  { lon: 90.369065, lat: 23.7679169 },
];

export const DRMC_OSM_CENTROID: GeoPoint = { lon: 90.3676595, lat: 23.765464 };
/** Alternate documented reference point (Wikipedia infobox). */
export const DRMC_WIKI_POINT: GeoPoint = { lon: 90.36778, lat: 23.765 };
/** Project-spec candidate only; the named OSM gate way geometry was unavailable. */
export const DRMC_GATE_OSM: GeoPoint = { lon: 90.36586, lat: 23.76386 };

/** Least-squares similarity control points: real OSM lon/lat ↔ game node coords. */
export const DRMC_TRANSFORM_CONTROLS: Array<{ name: string; lon: number; lat: number; x: number; z: number }> = [
  { name: 'bus_stand', lon: 90.36174, lat: 23.75699, x: -112, z: 194 },
  { name: 'town_hall', lon: 90.36641, lat: 23.75998, x: 42, z: 106 },
  { name: 'asad_post', lon: 90.36793, lat: 23.76017, x: 118, z: 84 },
  { name: 'ring_humayun', lon: 90.35876, lat: 23.76528, x: -216, z: -106 },
  { name: 'humayun_w', lon: 90.36209, lat: 23.7664, x: -126, z: -136 },
  { name: 'humayun_shahjahan', lon: 90.36475, lat: 23.76737, x: 6, z: -168 },
  { name: 'humayun_e', lon: 90.36647, lat: 23.76793, x: 84, z: -188 },
  { name: 'humayun_far_e', lon: 90.36821, lat: 23.7685, x: 162, z: -172 },
  { name: 'satmasjid_se', lon: 90.36762, lat: 23.75181, x: 18, z: 248 },
  { name: 'asad_gate_e', lon: 90.37308, lat: 23.76021, x: 242, z: 78 },
];

export interface SimilarityFit {
  scale: number;
  rotationDeg: number;
  tx: number;
  tz: number;
  /** RMS residual in game metres over the control set. */
  rms: number;
  maxResidual: number;
  project: (lon: number, lat: number) => GamePoint;
}

const LAT0 = 23.7624;
const LON0 = 90.3646;
const M_LAT = 110574;
const M_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);

/**
 * Least-squares 2D similarity fit (real ENU metres -> game x/z with z = south)
 * over the 10 control points. Characterizes the stylized base map honestly.
 */
export function fitDrmcTransform(
  controls: typeof DRMC_TRANSFORM_CONTROLS = DRMC_TRANSFORM_CONTROLS,
): SimilarityFit {
  const list = controls.map((c) => {
    const E = (c.lon - LON0) * M_LON;
    const S = -(c.lat - LAT0) * M_LAT;
    return { ...c, E, S };
  });
  const n = list.length;
  let se = 0;
  let ss = 0;
  let sx = 0;
  let sz = 0;
  for (const p of list) {
    se += p.E;
    ss += p.S;
    sx += p.x;
    sz += p.z;
  }
  const me = se / n;
  const ms = ss / n;
  const mx = sx / n;
  const mz = sz / n;
  let a = 0;
  let b = 0;
  let den = 0;
  for (const p of list) {
    const de = p.E - me;
    const dS = p.S - ms;
    const dx = p.x - mx;
    const dz = p.z - mz;
    a += de * dx + dS * dz;
    b += de * dz - dS * dx;
    den += de * de + dS * dS;
  }
  const scale = Math.hypot(a, b) / den;
  const rotation = Math.atan2(b, a);
  const c = Math.cos(rotation) * scale;
  const s = Math.sin(rotation) * scale;
  const tx = mx - (c * me - s * ms);
  const tz = mz - (s * me + c * ms);
  const project = (lon: number, lat: number): GamePoint => {
    const E = (lon - LON0) * M_LON;
    const S = -(lat - LAT0) * M_LAT;
    return { x: c * E - s * S + tx, z: s * E + c * S + tz };
  };
  let sumSq = 0;
  let maxResidual = 0;
  for (const p of list) {
    const q = project(p.lon, p.lat);
    const r = Math.hypot(q.x - p.x, q.z - p.z);
    sumSq += r * r;
    if (r > maxResidual) maxResidual = r;
  }
  return {
    scale,
    rotationDeg: (rotation * 180) / Math.PI,
    tx,
    tz,
    rms: Math.sqrt(sumSq / n),
    maxResidual,
    project,
  };
}

// ---------------------------------------------------------------------------
// In-game placement (anchored to the game Shahjahan chain = real Shahjahan Rd,
// which IS the campus SW boundary in real geography).
// ---------------------------------------------------------------------------

/**
 * Compact campus parcel between the existing Shahjahan, Humayun, Aurangzeb
 * and Geneva Camp connector roads. The original v0.6 polygon cut across six
 * public roads. This smaller stylized footprint preserves those roads instead;
 * its exact corners and the second entrance are not a surveyed reconstruction.
 */
export const DRMC_CAMPUS: [GamePoint, GamePoint, GamePoint, GamePoint] = [
  { x: 14, z: -158 },
  { x: 64, z: -32 },
  { x: 123, z: -51 },
  { x: 75, z: -176 },
];

/** Western boundary follows the outside of the existing Shahjahan sidewalks. */
export const DRMC_SW_WALL: GamePoint[] = [
  DRMC_CAMPUS[0], { x: 4, z: -113 }, { x: 10.1, z: -95 }, { x: 13.1, z: -90.54 }, DRMC_CAMPUS[1],
];
// Keep the portal exactly on the revised wall, which clears the full public
// Shahjahan sidewalk rather than only the asphalt/traffic envelope.
const MAIN_GATE_Z = -61.37;
const mainWallStart = DRMC_SW_WALL[3];
const mainWallEnd = DRMC_SW_WALL[4];
export const DRMC_GATE: GamePoint = {
  x: mainWallStart.x + (mainWallEnd.x - mainWallStart.x) * (MAIN_GATE_Z - mainWallStart.z) / (mainWallEnd.z - mainWallStart.z),
  z: MAIN_GATE_Z,
};
const mainWallLength = Math.hypot(mainWallEnd.x - mainWallStart.x, mainWallEnd.z - mainWallStart.z);
export const DRMC_GATE_ROAD_POINT: GamePoint = {
  x: DRMC_GATE.x - 9 * (mainWallEnd.z - mainWallStart.z) / mainWallLength,
  z: DRMC_GATE.z + 9 * (mainWallEnd.x - mainWallStart.x) / mainWallLength,
};
/** Provisional secondary gate on the opposite public-road frontage. */
export const DRMC_SIDE_GATE: GamePoint = { x: 99, z: -113.5 };
export const DRMC_SIDE_GATE_ROAD_POINT: GamePoint = { x: 107.85, z: -116.45 };

export const DRMC_MAIN_BLOCK: GamePoint = { x: 48, z: -112 };
export const DRMC_SECOND_BLOCK: GamePoint = { x: 47, z: -147 };
export const DRMC_SPORTS_GROUND: GamePoint = { x: 80, z: -105 };

/** True perimeter, including the western road bend. Keep a shared copy for
 * per-frame pursuit checks; callers requesting the polygon receive their own array. */
const DRMC_BOUNDARY: readonly GamePoint[] = [...DRMC_SW_WALL, DRMC_CAMPUS[2], DRMC_CAMPUS[3]];
export function drmcBoundaryPolygon(): GamePoint[] {
  return [...DRMC_BOUNDARY];
}

/** Ray-casting point-in-polygon (handles the SW chamfer correctly). */
export function isInsideDrmcCampus(x: number, z: number, margin = 0): boolean {
  const poly = DRMC_BOUNDARY;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z || 1e-9) + a.x) {
      inside = !inside;
    }
  }
  if (inside) return true;
  if (margin > 0) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if (distToSeg2D(x, z, poly[j], poly[i]) <= margin) return true;
    }
  }
  return false;
}

function distToSeg2D(px: number, pz: number, a: GamePoint, b: GamePoint): number {
  const vx = b.x - a.x;
  const vz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (pz - a.z) * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(px - (a.x + vx * t), pz - (a.z + vz * t));
}

/**
 * Deterministic exclusion test used by the city builder: true when a building,
 * tree, lamp or prop footprint must be skipped because it falls inside the
 * campus grounds (walls/buildings are placed by `drmc.ts` instead). Boundary
 * counts as campus so the gate/forecourt apron stays building-free.
 */
export function isDrmcKeepClear(x: number, z: number, padding = 1.2): boolean {
  // Protect both short road-to-gate aprons as well as the grounds themselves.
  return isInsideDrmcCampus(x, z, padding) ||
    distToSeg2D(x, z, DRMC_GATE, DRMC_GATE_ROAD_POINT) < 6.8 + padding ||
    distToSeg2D(x, z, DRMC_SIDE_GATE, DRMC_SIDE_GATE_ROAD_POINT) < 5.4 + padding;
}

/** Test an ambient route/sidewalk, not only its endpoints, against the boundary. */
export function crossesDrmcCampus(ax: number, az: number, bx: number, bz: number, margin = 0): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (isInsideDrmcCampus(ax + (bx - ax) * t, az + (bz - az) * t, margin)) return true;
  }
  return false;
}

/** Campus polygon in game coords (for the DEV accuracy overlay + minimap). */
export function drmcGamePolygon(): GamePoint[] {
  return drmcBoundaryPolygon().map((p) => ({ ...p }));
}

export interface DrmcOverlayReport {
  fit: SimilarityFit;
  projectedOsmPolygon: GamePoint[];
  projectedGate: GamePoint;
  gateToWallDistance: number;
}

/** Report used by tests + DEV overlay to compare map placement against sources. */
export function drmcOverlayReport(): DrmcOverlayReport {
  const fit = fitDrmcTransform();
  const projectedOsmPolygon = DRMC_OSM_POLYGON.map((p) => fit.project(p.lon, p.lat));
  const projectedGate = fit.project(DRMC_GATE_OSM.lon, DRMC_GATE_OSM.lat);
  // distance from the projected gate to the nearest game wall point
  let gateToWallDistance = Infinity;
  for (let i = 0; i < DRMC_SW_WALL.length - 1; i++) {
    const a = DRMC_SW_WALL[i];
    const b = DRMC_SW_WALL[i + 1];
    gateToWallDistance = Math.min(gateToWallDistance, distToSeg2D(projectedGate.x, projectedGate.z, a, b));
  }
  return { fit, projectedOsmPolygon, projectedGate, gateToWallDistance };
}
