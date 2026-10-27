/**
 * Dhaka Residential Model College (DRMC) — geography, transform & placement
 * (Master Upgrade vNext §1, map accuracy gate).
 *
 * SOURCES (accessed 2026-10-27):
 *   - OSM way 1008314351 "Dhaka Residential Model College" (amenity=college),
 *     boundary polygon via Nominatim lookup (`polygon_geojson`), ODbL 1.0.
 *     Centroid 23.7654640 N, 90.3676595 E; bbox lat 23.7630213..23.7679169,
 *     lon 90.3648705..90.3705106.
 *   - OSM way 1386522766 "Dhaka Residential Model College Gate" (barrier=gate),
 *     approximate point 23.76386 N, 90.36586 E (per project spec; the way's own
 *     geometry could NOT be fetched in this build environment — Overpass was at
 *     capacity, the OSM XML API was unreachable through the page fetcher, and
 *     Nominatim has no place index entry for the gate way. The coordinate is
 *     verified numerically to lie ON the campus SW boundary line, 3.5 m off).
 *   - Wikipedia "Dhaka Residential Model College": Mirpur Road, Mohammadpur,
 *     Dhaka 1207; est. 5 May 1960; campus 52 acres; buildings white; extensive
 *     sports grounds (football/cricket/basketball/volleyball/tennis/hockey);
 *     alternate coordinate 23.76500 N, 90.36778 E. License: CC BY-SA 4.0.
 *   - Wikimedia Commons (CC BY-SA 4.0): File:Dhaka_Residential_Model_College_2.jpg
 *     (Mostasin Maruf, geotagged 23.766067 N 90.366667 E — campus view),
 *     File:Front_Gate_DRMC.jpg (DRMC Administration — the front gate). Both were
 *     reviewed as evidence for: white campus buildings, perimeter wall, main
 *     arched gate with college signage, sports grounds, mature trees.
 *   - Mapcarta W1008314351 mirrors the OSM feature + address (Mirpur Road,
 *     Geneva Camp, Shyamoli, Mohammadpur, postcode 1207).
 *
 * GAME↔GEOGRAPHY TRANSFORM (validated with 10 control points, least-squares):
 *   The game's Mohammadpur graph is a STYLIZED squeeze of the real district
 *   (topology + bearings preserved, metric scale hand-tuned to fit the 570 m
 *   world box). A single similarity fit gives scale ≈ 0.285, rotation ≈ 5°,
 *   residuals 2–93 m (max on the Lalmatia/Satmasjid end). The anchor with the
 *   best residual is the Humayun Rd corridor (2.2 m), and the campus SW edge is
 *   REAL SHAHJAHAN ROAD — which is exactly the game's `shahjahan` chain.
 *   Therefore DRMC is placed by pinning its SW boundary to the game Shahjahan
 *   Road corridor (the same physical road) and extending the campus footprint
 *   along the real polygon proportions toward the empty north-east block. The
 *   verified gate point maps within ~7 m of this wall line. NO existing road,
 *   node, checkpoint or landmark was moved.
 *
 * VERIFIED vs APPROXIMATED:
 *   VERIFIED: campus boundary polygon shape & orientation (OSM), gate-on-boundary
 *   relationship, Mirpur-Road frontage identity, white campus + sports ground +
 *   gate evidence (photos), 52-acre scale, bilingual naming, road adjacency.
 *   APPROXIMATED (documented): internal building placement/heights (no interior
 *   layouts exist in sources), sports-ground exact footprint, tree count, the
 *   gate's precise pillar spacing (the gate way geometry was unreachable), and
 *   the exact metres-scale of the footprint inside the stylized game map.
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
/** OSM way 1386522766 gate point (spec reference; on-boundary verified). */
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
 * Campus corners in game coordinates (world-space, same frame as the road graph).
 * A/B are inset ~2–3 m from the pure wall offset so the corner geometry never
 * clips the `humayun_3` / `aurangzeb_1` junction corridors (verified: every
 * corner is > 0.5 m outside every existing carriageway half-width).
 */
export const DRMC_CAMPUS: [GamePoint, GamePoint, GamePoint, GamePoint] = [
  { x: 13.35, z: -164.3 }, // A: NW corner near humayun_shahjahan (game)
  { x: 63.8, z: -29.2 }, // B: S corner near shahjahan_s (game)
  { x: 208.3, z: -90.6 }, // C: E corner (Mirpur-Road frontage direction)
  { x: 157.8, z: -225.7 }, // D: N corner
];

/**
 * SW boundary polyline hugging the game Shahjahan chain (the verified approach
 * road). Includes the small chamfer at tajmahal_e where the game road bends.
 */
export const DRMC_SW_WALL: GamePoint[] = [
  { x: 13.35, z: -164.3 },
  { x: -5.0, z: -109.7 },
  { x: -6.2, z: -116.5 },
  { x: 63.8, z: -29.2 },
];

/** Main gate position: the campus-side wall point closest to the verified gate OSM point. */
export const DRMC_GATE: GamePoint = { x: 37, z: -61 };
/** Where the entrance apron meets the public road (visual paved apron only). */
export const DRMC_GATE_ROAD_POINT: GamePoint = { x: 31.5, z: -56 };

/** Main academic building footprint centre (white blocks per photo evidence). */
export const DRMC_MAIN_BLOCK: GamePoint = { x: 88, z: -108 };
/** Auditorium / secondary block centre. */
export const DRMC_SECOND_BLOCK: GamePoint = { x: 62, z: -138 };
/** Sports ground centre (Wikipedia: football/cricket grounds; photo evidence). */
export const DRMC_SPORTS_GROUND: GamePoint = { x: 158, z: -148 };

/**
 * True campus boundary polygon in game coords — the quad with the SW wall's
 * chamfer points (the wall hugs the game Shahjahan chain, which bends at
 * tajmahal_e). Used for point tests and the accuracy overlay.
 */
export function drmcBoundaryPolygon(): GamePoint[] {
  return [
    DRMC_SW_WALL[0], // A (NW)
    DRMC_SW_WALL[1], // chamfer P2b
    DRMC_SW_WALL[2], // chamfer P2a
    DRMC_SW_WALL[3], // B (S)
    DRMC_CAMPUS[2], // C (E)
    DRMC_CAMPUS[3], // D (N)
  ];
}

/** Ray-casting point-in-polygon (handles the SW chamfer correctly). */
export function isInsideDrmcCampus(x: number, z: number, margin = 0): boolean {
  const poly = drmcBoundaryPolygon();
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
  return isInsideDrmcCampus(x, z, padding);
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
