/**
 * Mohammadpur Town Hall Market — the authored reconstruction.
 *
 * ## Why this site
 *
 * OSM way 223068917 is the real market: a 12-node polygon of **5 010 m²
 * (1.24 acres)**, centred on (64.93, 98.11), fronting Asad Avenue on its north
 * side for its whole length (see `docs/TOWN_HALL_RESEARCH.md`).
 *
 * The polygon cannot be used verbatim. The shipped Asad Avenue runs 21–35 m
 * north of the OSM centreline in front of the market — a pre-existing
 * approximation of the road, which is out of scope to move — so the real polygon
 * laid down at its absolute coordinates lies across the game's carriageway. 98 %
 * of it is inside a road corridor.
 *
 * The site below is therefore expressed in the **road's own frame**: `s` is arc
 * length along `asad_4` from the Town Hall junction, `v` is lateral distance to
 * the north (left) side. It reproduces the real frontage relationship — the
 * market runs from the junction eastward along the north kerb — while keeping
 * every solid outside the corridor. The absolute position inherits the road's
 * offset; that is recorded in the research report rather than hidden.
 *
 * ## What it costs the shipped world
 *
 * The ground is not empty: eight generated apartment blocks stand on it. They
 * are suppressed by `isInTownHallSite()` inside `canPlaceBuilding()`, which is a
 * deliberate, verified local change to the 845-building baseline (see the test in
 * `tests/unit/town-hall.test.ts` for the exact count and keys). The frontage walk
 * keeps its positions and its draws, so only those few blocks disappear.
 *
 * ## Layout, and where it comes from
 *
 * | element | evidence |
 * |---|---|
 * | long shopfront terrace on the north kerb | 2015 photographs; 163 mapped shops on Asad Ave |
 * | two-to-three-storey mass, stacked signboards | photographs 1432/1435/1436 |
 * | red-brick arcade with arched bays | photograph 1439 |
 * | fish hall nearer the street, vegetable hall behind it | OSM: fish (78.95, 93.73), veg (77.19, 85.42) — veg is 8 m further north |
 * | butcher row on the west part of the frontage | OSM: *MD Bikram Mangsho Bitan*, *Jonopriyo Meat Shop* |
 * | bazaar street spine behind the frontage | IJSMR: 500 ft × 25–10 ft, east–west |
 * | Town Hall Mosque + minaret behind the west frontage | OSM node 3030299890; minaret visible in 1439 |
 *
 * Signboards use `SignAtlas`: the market's own landmark board plus verified
 * storefront boards whose OSM positions fall in each bay, so a named board only
 * ever appears near the business it names.
 */

import * as THREE from 'three';
import { mulberry32 } from '../core/mathx';
import type { Bucket } from './geo';
import { segmentById } from './layout';
import { placementAt, projectOntoPolyline } from './roadGeometry';
import type { SignAtlas } from './textures';
import type { Collider } from './city';

/** The segment whose north kerb the market fronts. */
export const TOWN_HALL_SEGMENT_ID = 'asad_4';

/**
 * The market envelope, in `asad_4` road-local units.
 *
 * `s` runs from just east of the Town Hall junction to short of the Post Office;
 * `v` starts at the kerb (the corridor edge is 8.9) and reaches the back of the
 * hall. 51 × 20.4 units, i.e. 142 m × 57 m of real frontage — the same order as
 * the OSM polygon's 134 m frontage.
 */
export const TOWN_HALL_SITE = {
  s0: 9.0,
  s1: 60.0,
  v0: 9.0,
  v1: 29.4,
} as const;

interface Frame {
  s: number;
  v: number;
}

/**
 * Road-local coordinates of a world point, or `null` when it is not within the
 * segment's lateral span (Bézier-free straight projection is enough here: the
 * polygon is only used as a rectangular envelope).
 */
function localOf(seg: Parameters<typeof placementAt>[0], x: number, z: number): Frame | null {
  const p = projectOntoPolyline(seg, x, z) as { s: number; lateral: number } | null;
  if (!p) return null;
  return { s: p.s, v: p.lateral };
}

/**
 * True when a world point lies inside the market envelope.
 *
 * Used by `canPlaceBuilding()` as an exclusion: the market is authored, so the
 * generator must not drop an apartment block through it. Returns `false` (never
 * throws) when the road graph is missing the segment, e.g. in a stripped test.
 */
export function isInTownHallSite(x: number, z: number): boolean {
  const seg = segmentById(TOWN_HALL_SEGMENT_ID);
  if (!seg) return false;
  // Cheap reject before touching the polyline maths.
  if (x < 35 || x > 100 || z < 55 || z > 100) return false;
  const local = localOf(seg, x, z);
  if (!local) return false;
  return (
    local.s >= TOWN_HALL_SITE.s0 &&
    local.s <= TOWN_HALL_SITE.s1 &&
    local.v >= TOWN_HALL_SITE.v0 &&
    local.v <= TOWN_HALL_SITE.v1
  );
}

/** Bounds of the market envelope in world units, for tests and diagnostics. */
export function townHallSiteBounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const seg = segmentById(TOWN_HALL_SEGMENT_ID);
  if (!seg) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let s = TOWN_HALL_SITE.s0; s <= TOWN_HALL_SITE.s1; s += 1) {
    for (const v of [TOWN_HALL_SITE.v0, TOWN_HALL_SITE.v1]) {
      const p = placementAt(seg, s, v);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
  }
  return { minX, maxX, minZ, maxZ };
}

/** Buckets and shared materials the market draws into, all owned by `buildCity`. */
export interface TownHallContext {
  signAtlas: SignAtlas;
  /** `sectorIndex()` from `buildCity`, so market geometry joins the city's chunked meshes. */
  sectorOf: (x: number, z: number) => number;
  /** Sector-chunked buckets, indexed by `sectorOf()`. */
  walls: Bucket[];
  details: Bucket[];
  signs: Bucket[];
  /** Corrugated-shutter / painted-steel bucket. */
  metal: Bucket;
  /** Sidewalk & paving bucket. */
  walk: Bucket;
  /** Unlit night-glow bucket. */
  glow: Bucket;
  /** First free sign-atlas slot; the market consumes a contiguous run. */
  signSlotStart: number;
  /**
   * The city's overhead-cable pair list and pole registry. The market appends to
   * them so its kerbside cables are drawn by the existing sagging-wire builder
   * instead of adding a second one.
   */
  wirePairs: [THREE.Vector3, THREE.Vector3][];
  utilityPoleSites: { x: number; z: number }[];
}

export interface TownHallResult {
  colliders: Collider[];
  /** Next free sign slot, so the caller's cursor stays consistent. */
  signSlotEnd: number;
}

/* ------------------------------------------------------------------ palette */

/**
 * Colours sampled from the 2015 photographs: sun-bleached cream and pale green
 * plaster, dusty terracotta brick, oxidised blue-grey shutters, and the faded
 * red of the arcade block. Deliberately desaturated — the reference frames are
 * overcast and the signage, not the walls, carries the colour.
 */
const PLASTER = ['#e8e1d2', '#dfe3d8', '#e9e2df', '#d9d3c4', '#e3ddcd'] as const;
const ARCADE_BRICK = '#9b5f4a';
const ARCADE_BRICK_DARK = '#7d4a39';
const SHUTTER = ['#8e9aa0', '#7f8d93', '#96a1a5'] as const;
const AWNING = ['#c9b25a', '#b8543f', '#3f6f8c', '#5b7f4b'] as const;
const ROOF_TIN = '#8d8f8a';
const TARPAULIN = ['#2f5f8a', '#b4622f', '#3f6b4a'] as const;
const PRODUCE = ['#c8552f', '#7f9c3a', '#d8a52c', '#8a4a2a', '#b5402f', '#5f8f3a'] as const;

/** One bay of the frontage terrace: 8 units wide, six of them span the market. */
const BAY = 8;
const BAYS = 6;

/** Depth of each layer, measured outward from the kerb (`v`). */
const FOOTPATH_V = 9.0;
const TERRACE_V = 11.1;      // front elevation, road-facing
const TERRACE_DEPTH = 7.0;   // to 18.1
const STREET_V = 18.1;       // bazaar street starts
const STREET_WIDTH = 4.2;    // to 22.3 — 12 ft at the narrow end
const HALL_V = 22.3;         // covered halls
const HALL_DEPTH = 7.1;      // to 29.4

/**
 * Verified storefronts from the OSM extract, with the bay each board belongs to.
 *
 * `s` is the business's own arc position along `asad_4`; the board goes on the
 * nearest bay of the rebuilt terrace, which is the same frontage its real
 * address faces. Nothing is invented: every name and coordinate is in
 * `data/mohammadpur/mohammadpur.osm.json`.
 */
const TERRACE_STOREFRONTS: readonly { id: string; s: number }[] = [
  { id: 'sf_th_tehari', s: 16.4 },      // Shoykat Tehari Ghor
  { id: 'sf_th_cork_sheet', s: 28.7 },  // Cork Sheet Box Shop
  { id: 'sf_th_butcher', s: 30.0 },     // MD Bikram Mangsho Bitan
  { id: 'sf_th_tailors', s: 31.3 },     // Liton Master Tailors and Fabrics
  { id: 'sf_th_rice', s: 31.7 },        // Monipur Rice Store
  { id: 'sf_th_electronics', s: 39.2 }, // Modina Electronics
  { id: 'sf_th_sweets', s: 41.1 },      // Bikrampur Sweets
  { id: 'sf_th_pharma', s: 5.5 },       // Khan Pharma
];

/* ------------------------------------------------------------------ builder */

/**
 * Builds the market into the caller's buckets and returns its colliders.
 *
 * Draw calls: none added. Every primitive goes into the city's existing
 * sector-chunked wall/detail/sign buckets and the shared metal/walk/glow
 * buckets, so the market merges into meshes the renderer already draws.
 */
export function buildTownHall(ctx: TownHallContext): TownHallResult {
  const seg = segmentById(TOWN_HALL_SEGMENT_ID);
  if (!seg) return { colliders: [], signSlotEnd: ctx.signSlotStart };

  const colliders: Collider[] = [];
  const { signAtlas, sectorOf, walls, details, signs, metal, walk, glow } = ctx;
  let slot = ctx.signSlotStart;

  /**
   * Draw layer for a primitive. Wall/detail/sign geometry joins the city's
   * sector-chunked buckets so the market adds **no** draw calls; the shared
   * metal/walk/glow buckets are single meshes for the whole district.
   */
  type Layer = 'wall' | 'detail' | 'sign' | 'metal' | 'walk' | 'glow';
  const pick = (layer: Layer, x: number, z: number): Bucket => {
    const sec = sectorOf(x, z);
    if (layer === 'wall') return walls[sec];
    if (layer === 'detail') return details[sec];
    if (layer === 'sign') return signs[sec];
    if (layer === 'metal') return metal;
    if (layer === 'walk') return walk;
    return glow;
  };

  /** Road-frame placement: `s` along Asad Ave, `v` north of its centreline. */
  const at = (s: number, v: number) => placementAt(seg, s, v);

  /** Generic sign slot, wrapping so the atlas is never over-indexed. */
  const nextSign = () => signAtlas.slot(slot++);

  /** Axis-aligned-in-road-frame box. `along` is the `s` size, `across` the `v` size. */
  const roadBox = (
    layer: Layer,
    s: number,
    v: number,
    along: number,
    across: number,
    y: number,
    height: number,
    color: THREE.ColorRepresentation,
  ): void => {
    const p = at(s, v);
    pick(layer, p.x, p.z).box({ x: p.x, y, z: p.z }, { x: across, y: height, z: along }, color, { y: p.yaw });
  };

  /** A vertical panel facing the road (the frontage elevation). */
  const frontPanel = (
    layer: Layer,
    s: number,
    v: number,
    width: number,
    height: number,
    y: number,
    color: THREE.ColorRepresentation,
    uv?: { u0: number; v0: number; u1: number; v1: number },
  ): void => {
    const p = at(s, v);
    // The elevation faces the road: normal pointing at -left (south).
    const faceYaw = Math.atan2(-p.leftX, -p.leftZ);
    pick(layer, p.x, p.z).quad({ x: p.x, y, z: p.z }, width, height, color, { y: faceYaw }, uv);
  };

  /** Solid, camera-blocking footprint for one authored mass. */
  const addCollider = (
    s: number,
    v: number,
    along: number,
    across: number,
    height: number,
    kind: Collider['kind'] = 'building',
  ): void => {
    const p = at(s, v);
    const yaw = p.yaw;
    const cosA = Math.abs(Math.cos(yaw));
    const sinA = Math.abs(Math.sin(yaw));
    const halfX = across / 2;
    const halfZ = along / 2;
    const envHalfX = halfX * cosA + halfZ * sinA;
    const envHalfZ = halfX * sinA + halfZ * cosA;
    colliders.push({
      minX: p.x - envHalfX,
      maxX: p.x + envHalfX,
      minZ: p.z - envHalfZ,
      maxZ: p.z + envHalfZ,
      height,
      cameraBlocking: true,
      kind,
      cx: p.x,
      cz: p.z,
      halfX,
      halfZ,
      yaw,
    });
  };

  /* ------------------------------------------------------ 1. the footpath */

  // Apron between the kerb and the shopfronts: 2.1 units (~6 m) of paving, on
  // which the kacha bazaar sits. Kept clear of every carriageway by starting at
  // the corridor edge.
  for (let s = TOWN_HALL_SITE.s0 + 1; s < TOWN_HALL_SITE.s1 - 1; s += 4) {
    roadBox('walk', s + 2, (FOOTPATH_V + TERRACE_V) / 2, 4.1, TERRACE_V - FOOTPATH_V, 0.04, 0.08, '#b9b3a4');
  }
  // Bazaar street floor: packed earth / broken concrete, darker than the apron.
  for (let s = 18; s < 56; s += 4) {
    roadBox('walk', s + 2, STREET_V + STREET_WIDTH / 2, 4.1, STREET_WIDTH, 0.03, 0.06, '#8f8878');
  }

  /* ------------------------------------------- 2. the frontage terrace (6 bays) */

  // `+v` runs AWAY from the carriageway, so a surface that faces the road sits
  // at the SMALLEST v of its mass and every panel is placed just proud of that
  // plane (`FACE - e`), never just behind it.
  const FACE = TERRACE_V;
  const PROUD = 0.07;

  for (let bay = 0; bay < BAYS; bay++) {
    const bayStart = TOWN_HALL_SITE.s0 + 1 + bay * BAY;
    const cs = bayStart + BAY / 2;
    const isArcade = bay === 1;
    const floors = isArcade ? 3 : bay === 0 || bay === 4 ? 3 : 2;
    const height = floors * 3.1;
    const plaster = PLASTER[bay % PLASTER.length];

    // Main mass, set back from the kerb so the apron stays walkable.
    roadBox('wall', cs, FACE + TERRACE_DEPTH / 2, BAY - 0.15, TERRACE_DEPTH, height / 2, height, plaster);
    // Parapet band: a storey-height cornice that reads against the sky.
    roadBox('detail', cs, FACE + 0.35, BAY - 0.15, 0.7, height + 0.35, 0.7, isArcade ? ARCADE_BRICK : '#cfc7b4');

    if (isArcade) {
      // The red-brick arcade from photograph 1439: three arched bays at ground
      // level, deep shade behind them, brick piers between.
      // Solid brick piers carrying a deep, shaded arcade. The piers are wide and
      // few: a row of thin slats reads as a fence, not as masonry.
      const pierW = 0.7;
      const openingW = BAY - pierW * 4; // 5.2 units across three openings
      for (let k = 0; k <= 3; k++) {
        const ps = bayStart + pierW / 2 + k * (pierW + openingW / 3);
        roadBox('wall', ps, FACE - 0.34, pierW, 0.92, 1.75, 3.5, ARCADE_BRICK);
      }
      for (let k = 0; k < 3; k++) {
        const os = bayStart + pierW + (k + 0.5) * (openingW / 3);
        // Recessed opening: dark, inset behind the pier face.
        frontPanel('detail', os, FACE - 0.03, openingW / 3 - 0.12, 2.7, 1.4, '#201b17');
        // A single flat arch head spanning the opening, then solid brick above.
        roadBox('wall', os, FACE - 0.3, openingW / 3 - 0.06, 0.8, 3.05, 0.45, ARCADE_BRICK_DARK);
      }
      // Spandrel: continuous brick band from the arch heads to the string course.
      roadBox('wall', cs, FACE - 0.3, BAY - 0.12, 0.85, 3.72, 1.0, ARCADE_BRICK);
      roadBox('detail', cs, FACE - 0.36, BAY - 0.1, 0.42, 4.3, 0.26, ARCADE_BRICK_DARK);
    } else {
      // Shopfront: three shuttered bays with a deep reveal, plus a sign band.
      for (let k = 0; k < 3; k++) {
        const ss = bayStart + 1.1 + k * 2.5;
        frontPanel('detail', ss, FACE - PROUD, 2.15, 2.5, 1.3, SHUTTER[(bay + k) % SHUTTER.length]);
        // One bay per shop is open — the dark interior every Dhaka shopfront has.
        if ((bay + k) % 3 === 0) frontPanel('detail', ss + 0.55, FACE - PROUD - 0.01, 0.75, 2.3, 1.2, '#1f1a16');
        frontPanel('detail', ss, FACE - PROUD, 2.3, 0.16, 2.62, '#4a4a44');
        // Corrugation. A flat grey rectangle reads as a blank wall from the
        // road; six shallow ribs are what makes it read as a rolling shutter.
        for (let r = 0; r < 6; r++) {
          frontPanel('detail', ss, FACE - PROUD - 0.02, 2.13, 0.05, 0.32 + r * 0.36,
            r % 2 === 0 ? '#6f7c82' : '#a4aeb2');
        }
        // Half-shut shutter on the street's edge bay: one shop still opening up.
        if (k === 2 && bay % 2 === 0) {
          frontPanel('detail', ss, FACE - PROUD - 0.05, 2.13, 0.95, 1.98, '#7f8d93');
        }
      }
      // Slanted sun/rain awning over the shopfront, as in every reference frame.
      const ap = at(cs, FACE - 0.55);
      pick('detail', ap.x, ap.z).box(
        { x: ap.x, y: 2.72, z: ap.z },
        { x: 1.1, y: 0.07, z: BAY - 1.6 },
        AWNING[bay % AWNING.length],
        { y: ap.yaw, x: 0.26 },
      );
    }

    // Stacked boards: the single most recognisable trait of the real frontage —
    // two to three per bay, one above the other, covering the first-floor face.
    // A verified storefront board takes the main position on its own bay.
    const verified = TERRACE_STOREFRONTS.filter((f) => f.s >= bayStart && f.s < bayStart + BAY);
    const mainSign = verified.length > 0 ? signAtlas.storefrontSlot(verified[0].id) : undefined;
    frontPanel('sign', cs, FACE - PROUD, BAY - 1.3, 1.0, 3.55, '#ffffff', mainSign ?? nextSign());
    frontPanel('sign', cs, FACE - PROUD, BAY - 2.0, 0.72, 4.55, '#ffffff', nextSign());
    frontPanel('sign', bayStart + 1.5, FACE - PROUD, 2.3, 0.66, 5.35, '#ffffff', nextSign());
    // A projecting vertical board at the party wall, as seen hanging over the
    // pavement in the reference frames.
    if (bay % 2 === 1) {
      const vp = at(bayStart + 0.45, FACE - 0.85);
      pick('sign', vp.x, vp.z).quad({ x: vp.x, y: 4.2, z: vp.z }, 0.62, 2.6, '#ffffff',
        { y: Math.atan2(vp.ux, vp.uz) + Math.PI / 2 }, nextSign());
    }

    // Upper storeys: windows, balconies with railings, and the odd AC unit.
    for (let f = 1; f < floors; f++) {
      for (let k = 0; k < 3; k++) {
        const ws = bayStart + 1.3 + k * 2.3;
        frontPanel('detail', ws, FACE - PROUD, 1.5, 1.15, f * 3.1 + 1.5, '#233a41');
        frontPanel('detail', ws, FACE - PROUD - 0.01, 1.62, 0.1, f * 3.1 + 0.9, '#8d8474');
      }
      if (f === 1) {
        // Balcony slab + three-bar railing, the most common facade element here.
        roadBox('detail', cs, FACE - 0.42, BAY - 2.2, 0.85, 3.28, 0.14, '#c4bca8');
        for (let r = 0; r < 5; r++) {
          const rs = bayStart + 1.9 + r * 1.05;
          roadBox('detail', rs, FACE - 0.72, 0.06, 0.06, 3.72, 0.8, '#6d6a60');
        }
        roadBox('detail', cs, FACE - 0.72, BAY - 2.2, 0.08, 4.1, 0.07, '#6d6a60');
      }
      if (f === 1 && bay % 2 === 0) {
        const ap = at(bayStart + BAY - 1.4, FACE - 0.5);
        pick('detail', ap.x, ap.z).box({ x: ap.x, y: 4.9, z: ap.z }, { x: 0.55, y: 0.5, z: 0.7 }, '#c9ccc6', { y: ap.yaw });
      }
    }
    // Rooftop clutter — water tank, stair headroom, parapet posts. Nothing says
    // "Dhaka mid-rise" faster from an aerial or a balcony view.
    const roofY = height + 0.05;
    const rp = at(bayStart + 2.2, FACE + 2.4);
    pick('detail', rp.x, rp.z).cylinder({ x: rp.x, y: roofY + 0.75, z: rp.z }, 0.62, 1.5, '#20262b');
    pick('detail', rp.x, rp.z).box({ x: rp.x, y: roofY + 0.12, z: rp.z }, { x: 1.5, y: 0.24, z: 1.5 }, '#9c9484', { y: rp.yaw });
    if (bay % 2 === 0) {
      const sp = at(bayStart + 6.2, FACE + 4.6);
      pick('detail', sp.x, sp.z).box({ x: sp.x, y: roofY + 1.35, z: sp.z },
        { x: 2.2, y: 2.7, z: 2.6 }, '#cfc7b4', { y: sp.yaw });
    } else {
      const sp = at(bayStart + 5.4, FACE + 5.2);
      pick('detail', sp.x, sp.z).cylinder({ x: sp.x, y: roofY + 0.55, z: sp.z }, 0.5, 1.1, '#2b3138');
    }
    addCollider(cs, FACE + TERRACE_DEPTH / 2, BAY, TERRACE_DEPTH, height);
  }

  /* --------------------------------------------- 3. the covered market hall */

  // Two storeys behind the bazaar street, open arcade on the street side. The
  // fish section sits nearer the street and the vegetable hall behind it, which
  // is the real relative arrangement (fish at v=1.5, vegetable at v=10.0 in OSM
  // terms — the vegetable hall is the deeper one).
  const hallS0 = 18;
  const hallS1 = 52;
  const hallHeight = 6.4;
  roadBox('wall', (hallS0 + hallS1) / 2, HALL_V + HALL_DEPTH / 2, hallS1 - hallS0, HALL_DEPTH, hallHeight / 2, hallHeight, '#ddd6c6');
  roadBox('detail', (hallS0 + hallS1) / 2, HALL_V + HALL_DEPTH / 2, hallS1 - hallS0 + 0.4, HALL_DEPTH + 0.4, hallHeight + 0.15, 0.3, '#b9b09c');
  // Sawtooth corrugated roof over the halls: alternating slopes read as ridges
  // from above and as a busy tin skyline from the street.
  for (let s = hallS0 + 1; s < hallS1; s += 2.4) {
    const r = at(s + 1.2, HALL_V + HALL_DEPTH / 2);
    pick('detail', r.x, r.z).box({ x: r.x, y: hallHeight + 0.55, z: r.z },
      { x: HALL_DEPTH + 0.5, y: 0.1, z: 2.5 }, ROOF_TIN, { y: r.yaw, x: 0.22 });
  }
  // Long lean-to roof over the bazaar street, closing the gap between terrace
  // and hall — the "tin roof over the spine" reading from the photographs.
  for (let s = 18; s < 54; s += 4) {
    // Alternate spans are left open to the sky: real bazaar spines are covered
    // in patches, not sealed, and the light gaps are what stop the underside
    // reading as one long grey slab.
    if (Math.round((s - 18) / 4) % 2 === 1) continue;
    const p = at(s + 2, STREET_V + STREET_WIDTH / 2);
    pick('detail', p.x, p.z).box(
      { x: p.x, y: 5.45, z: p.z },
      { x: STREET_WIDTH + 0.6, y: 0.12, z: 4.2 },
      ROOF_TIN,
      { y: p.yaw, x: 0.1 },
    );
    // Purlins under the sheet, so the underside is not a blank slab.
    for (const off of [-1.4, 1.4]) {
      const pp = at(s + 2 + off, STREET_V + STREET_WIDTH / 2);
      pick('detail', pp.x, pp.z).box({ x: pp.x, y: 5.34, z: pp.z },
        { x: STREET_WIDTH + 0.5, y: 0.08, z: 0.1 }, '#6f6a5e', { y: pp.yaw });
    }
  }
  // Arcade: piers on the street face with deep shade between them, so the hall
  // reads as an open market hall rather than a blank wall.
  for (let s = hallS0 + 1; s < hallS1; s += 3.2) {
    roadBox('wall', s, HALL_V - 0.35, 0.55, 0.9, 1.65, 3.3, '#cfc7b3');
    frontPanel('detail', s + 1.6, HALL_V - 0.05, 2.6, 3.0, 1.5, '#2b2620');
  }
  addCollider((hallS0 + hallS1) / 2, HALL_V + HALL_DEPTH / 2, hallS1 - hallS0, HALL_DEPTH, hallHeight);

  // Upper-floor window band on the hall's street elevation.
  for (let s = hallS0 + 2; s < hallS1 - 1; s += 2.6) {
    frontPanel('detail', s, HALL_V - 0.07, 1.4, 1.05, 4.6, '#263c43');
  }

  // Section boards: the real market's own name and its two mapped halls.
  const marketBoard = signAtlas.landmarkSlot('town_hall_bazar') ?? nextSign();
  frontPanel('sign', hallS0 + 8, HALL_V - 0.07, 6.4, 1.3, 6.75, '#ffffff', marketBoard);
  const fishBoard = signAtlas.storefrontSlot('sf_th_fish') ?? nextSign();
  frontPanel('sign', 43, HALL_V - 0.09, 5.0, 0.95, 3.85, '#ffffff', fishBoard);
  const vegBoard = signAtlas.storefrontSlot('sf_th_veg') ?? nextSign();
  frontPanel('sign', 46.5, HALL_V - 0.09, 5.0, 0.95, 3.85, '#ffffff', vegBoard);

  /* ------------------------------------------------- 4. the Town Hall Mosque */

  // OSM node 3030299890 — the mosque whose minaret stands behind the west end
  // of the frontage in photograph 1439. Its forecourt occupies the ground the
  // real mosque faces onto.
  const mosqueS = 13.6;
  const mosqueV = 23.2;
  roadBox('wall', mosqueS, mosqueV, 5.6, 5.4, 2.0, 4.0, '#e6e2d4');
  roadBox('detail', mosqueS, mosqueV, 6.0, 5.8, 4.1, 0.35, '#cbc4ae');
  // Drum + shallow dome.
  const dome = at(mosqueS, mosqueV);
  pick('wall', dome.x, dome.z).cylinder({ x: dome.x, y: 4.5, z: dome.z }, 2.1, 0.5, '#dfdacb');
  pick('wall', dome.x, dome.z).cone({ x: dome.x, y: 5.3, z: dome.z }, 2.15, 1.5, '#cdc6b0');
  addCollider(mosqueS, mosqueV, 5.6, 5.4, 4.0);

  // Minaret at the mosque's road-side corner: 15 m, so it clears the 9.3 m
  // terrace behind which it stands — exactly the silhouette in 1439.
  const minaretS = mosqueS - 2.1;
  const minaretV = mosqueV - 2.2;
  const mp = at(minaretS, minaretV);
  const mw = pick('wall', mp.x, mp.z);
  mw.box({ x: mp.x, y: 7.4, z: mp.z }, { x: 1.35, y: 14.8, z: 1.35 }, '#efeade', { y: mp.yaw });
  mw.box({ x: mp.x, y: 4.6, z: mp.z }, { x: 1.62, y: 0.22, z: 1.62 }, '#d8d2c0', { y: mp.yaw });
  mw.box({ x: mp.x, y: 11.2, z: mp.z }, { x: 1.75, y: 0.2, z: 1.75 }, '#d8d2c0', { y: mp.yaw });
  mw.cylinder({ x: mp.x, y: 15.1, z: mp.z }, 0.85, 0.6, '#efeade');
  mw.cone({ x: mp.x, y: 15.9, z: mp.z }, 0.9, 1.0, '#cdc6b0');
  addCollider(minaretS, minaretV, 1.6, 1.6, 14.8, 'wall');

  /* ------------------------------------------------- 5. the kacha bazaar */

  // Produce, baskets and vans on the apron between kerb and shopfronts. Every
  // item is placed from the deterministic layout RNG so the market is identical
  // on every build and on every device.
  const rng = mulberry32(0x70ad4a11);
  for (let s = TOWN_HALL_SITE.s0 + 1.5; s < TOWN_HALL_SITE.s1 - 2; s += 1.7) {
    const v = 9.95 + rng() * 0.85;
    const roll = rng();
    const p = at(s, v);
    const tint = PRODUCE[Math.floor(rng() * PRODUCE.length)];
    if (roll < 0.34) {
      // Wicker basket of vegetables, sitting on the paving.
      pick('detail', p.x, p.z).cylinder({ x: p.x, y: 0.22, z: p.z }, 0.46, 0.44, '#a9884f');
      pick('detail', p.x, p.z).cone({ x: p.x, y: 0.52, z: p.z }, 0.42, 0.28, tint);
    } else if (roll < 0.62) {
      // Slatted crate with a heap of produce.
      pick('detail', p.x, p.z).box({ x: p.x, y: 0.24, z: p.z }, { x: 0.95, y: 0.42, z: 1.15 }, '#9a7b47', { y: p.yaw });
      pick('detail', p.x, p.z).box({ x: p.x, y: 0.52, z: p.z }, { x: 0.82, y: 0.2, z: 1.02 }, tint, { y: p.yaw });
    } else if (roll < 0.8) {
      // Jute sack of rice/potatoes, slumped.
      pick('detail', p.x, p.z).cylinder({ x: p.x, y: 0.3, z: p.z }, 0.36, 0.6, '#b9a87c');
    } else if (roll < 0.93) {
      // Vendor's low stool and a tarpaulin shade over the produce.
      pick('detail', p.x, p.z).box({ x: p.x, y: 0.18, z: p.z }, { x: 0.5, y: 0.36, z: 0.5 }, '#6d5a3c', { y: p.yaw });
      const tp = at(s, v - 0.75);
      pick('detail', tp.x, tp.z).box({ x: tp.x, y: 2.0, z: tp.z }, { x: 2.0, y: 0.05, z: 1.5 }, TARPAULIN[Math.floor(rng() * TARPAULIN.length)], { y: tp.yaw, x: 0.16 });
      for (const ds of [-0.8, 0.8]) {
        const pp = at(s + ds, v - 0.7);
        pick('detail', pp.x, pp.z).cylinder({ x: pp.x, y: 1.0, z: pp.z }, 0.035, 2.0, '#6f6a5e');
      }
    } else {
      // Cycle-van with a canopy, the way vegetables actually arrive.
      const van = at(s, v + 0.15);
      pick('detail', van.x, van.z).box({ x: van.x, y: 0.55, z: van.z }, { x: 0.85, y: 0.5, z: 1.7 }, '#4a5a63', { y: van.yaw });
      pick('detail', van.x, van.z).box({ x: van.x, y: 1.15, z: van.z }, { x: 0.9, y: 0.7, z: 1.4 }, tint, { y: van.yaw });
      for (const wz of [-0.62, 0.62]) {
        pick('detail', van.x, van.z).cylinder({ x: van.x, y: 0.34, z: van.z + wz }, 0.33, 0.09, '#2c2c2c', { x: Math.PI / 2, y: van.yaw });
      }
      addCollider(s, v + 0.15, 1.8, 1.0, 1.4, 'prop');
    }
  }

  // Stalls inside the bazaar street: counters with tin hoods on both sides.
  const STALL_WOOD = ['#8a7c5f', '#7d6a4a', '#96876a', '#6f6047'] as const;
  for (let s = 20; s < 54; s += 4.4) {
    for (const side of [0, 1] as const) {
      const v = side === 0 ? STREET_V + 0.95 : STREET_V + STREET_WIDTH - 0.95;
      const p = at(s, v);
      const stallRng = mulberry32(0x5 + Math.round(s * 7) + side * 31);
      const wood = STALL_WOOD[Math.floor(stallRng() * STALL_WOOD.length)];
      // Counter, then a heap of goods along it, then the tin hood.
      pick('detail', p.x, p.z).box({ x: p.x, y: 0.45, z: p.z }, { x: 1.25, y: 0.9, z: 3.0 }, wood, { y: p.yaw });
      for (let k = 0; k < 3; k++) {
        const gs = s - 0.9 + k * 0.9;
        const gp = at(gs, v - (side === 0 ? 0.28 : -0.28));
        const tint = PRODUCE[Math.floor(stallRng() * PRODUCE.length)];
        if (stallRng() < 0.5) {
          pick('detail', gp.x, gp.z).box({ x: gp.x, y: 1.0, z: gp.z },
            { x: 0.72, y: 0.22, z: 0.72 }, tint, { y: gp.yaw });
          pick('detail', gp.x, gp.z).cone({ x: gp.x, y: 1.18, z: gp.z }, 0.34, 0.22, tint);
        } else {
          pick('detail', gp.x, gp.z).cylinder({ x: gp.x, y: 1.02, z: gp.z }, 0.3, 0.24, '#a9884f');
          pick('detail', gp.x, gp.z).cone({ x: gp.x, y: 1.2, z: gp.z }, 0.28, 0.2, tint);
        }
      }
      // Hanging stock under the hood: narrow bolts of cloth, not a wall panel.
      const hangTint = TARPAULIN[Math.floor(stallRng() * TARPAULIN.length)];
      for (const hz of [-0.9, 0, 0.9]) {
        const hp = at(s + hz, v - (side === 0 ? 0.62 : -0.62));
        pick('detail', hp.x, hp.z).box({ x: hp.x, y: 2.02, z: hp.z },
          { x: 0.12, y: 0.44, z: 0.62 }, hangTint, { y: hp.yaw });
      }
      pick('detail', p.x, p.z).box({ x: p.x, y: 2.35, z: p.z }, { x: 1.7, y: 0.08, z: 3.4 }, ROOF_TIN, { y: p.yaw, x: 0.07 });
      for (const ds of [-1.4, 1.4]) {
        const pp = at(s + ds, v);
        pick('detail', pp.x, pp.z).cylinder({ x: pp.x, y: 1.2, z: pp.z }, 0.05, 2.4, '#6f6a5e');
      }
    }
  }

  /* --------------------------------------- 6. kerbside poles and wire tangle */

  // The reference frames are dominated by cable runs along the kerb. Poles go at
  // the corridor edge; the wires are handed to `buildCity`'s existing sagging
  // line builder so they cost nothing extra.
  let prevPole: THREE.Vector3 | null = null;
  for (let s = TOWN_HALL_SITE.s0 + 2; s < TOWN_HALL_SITE.s1 - 1; s += 11.5) {
    const p = at(s, FOOTPATH_V + 0.35);
    pick('walk', p.x, p.z).box({ x: p.x, y: 4.4, z: p.z }, { x: 0.24, y: 8.8, z: 0.24 }, '#8a857c', { y: p.yaw });
    pick('metal', p.x, p.z).box({ x: p.x, y: 8.35, z: p.z }, { x: 1.3, y: 0.09, z: 0.09 }, '#41474e', { y: p.yaw });
    pick('metal', p.x, p.z).torus({ x: p.x, y: 6.4, z: p.z }, 0.3, '#1b1e22', { y: p.yaw });
    const head = new THREE.Vector3(p.x, 8.35, p.z);
    if (prevPole) ctx.wirePairs.push([prevPole, head]);
    prevPole = head;
    ctx.utilityPoleSites.push({ x: p.x, z: p.z });
  }

  // The terrace's rear elevation faces the spine; paint it and give it windows so
  // the bazaar street is enclosed by building, not by a dark void.
  for (let s = TOWN_HALL_SITE.s0 + 3; s < TOWN_HALL_SITE.s1 - 3; s += 3.4) {
    const bp = at(s, TERRACE_V + TERRACE_DEPTH - 0.06);
    const backYaw = Math.atan2(bp.leftX, bp.leftZ);
    pick('detail', bp.x, bp.z).quad({ x: bp.x, y: 1.6, z: bp.z }, 2.4, 3.2, '#cdc5b2', { y: backYaw });
    if (Math.round(s) % 2 === 0) {
      pick('detail', bp.x, bp.z).quad({ x: bp.x, y: 4.3, z: bp.z }, 1.1, 0.95, '#25373d', { y: backYaw });
    }
  }

  /* ------------------------------------------------ 6a. hoardings over the kerb */

  // The reference frames are dominated by large boards on poles above the shop
  // line. Two of them, on the empty stretches of apron, at the height they
  // actually sit.
  for (const [bs, bw] of [[21.5, 4.6], [45.5, 5.4]] as const) {
    const bp = at(bs, FOOTPATH_V + 0.55);
    const faceYaw = Math.atan2(-bp.leftX, -bp.leftZ);
    for (const ds of [-bw / 2 + 0.35, bw / 2 - 0.35]) {
      const pp = at(bs + ds, FOOTPATH_V + 0.55);
      pick('metal', pp.x, pp.z).cylinder({ x: pp.x, y: 2.6, z: pp.z }, 0.11, 5.2, '#6b6f70');
    }
    // Frame slab first, then a printed face proud of it on BOTH sides, so the
    // hoarding reads as advertising from either approach instead of a grey lump.
    pick('detail', bp.x, bp.z).box({ x: bp.x, y: 3.9, z: bp.z }, { x: bw + 0.3, y: bw * 0.5 + 0.3, z: 0.14 },
      '#4a4d4a', { y: faceYaw });
    const nx = -bp.leftX;
    const nz = -bp.leftZ;
    pick('sign', bp.x, bp.z).quad({ x: bp.x + nx * 0.09, y: 3.9, z: bp.z + nz * 0.09 },
      bw, bw * 0.5, '#ffffff', { y: faceYaw }, nextSign());
    pick('sign', bp.x, bp.z).quad({ x: bp.x - nx * 0.09, y: 3.9, z: bp.z - nz * 0.09 },
      bw, bw * 0.5, '#f3efe4', { y: faceYaw + Math.PI }, nextSign());
  }

  /* ------------------------------------------------- 6b. the bazaar gate */

  // A gated, boarded entrance where the spine opens onto Asad Avenue — the way
  // these bazaars announce themselves, and the quickest read that this is a
  // market and not a row of shops.
  for (const gs of [STREET_V + 0.35, STREET_V + STREET_WIDTH - 0.35]) {
    const gp = at(hallS0 - 0.6, gs);
    pick('wall', gp.x, gp.z).box({ x: gp.x, y: 2.3, z: gp.z }, { x: 0.34, y: 4.6, z: 0.34 }, '#d9d3c4', { y: gp.yaw });
  }
  const lintel = at(hallS0 - 0.6, STREET_V + STREET_WIDTH / 2);
  pick('wall', lintel.x, lintel.z).box({ x: lintel.x, y: 4.75, z: lintel.z },
    { x: STREET_WIDTH + 0.5, y: 0.5, z: 0.4 }, '#d9d3c4', { y: lintel.yaw });
  const gateSign = signAtlas.landmarkSlot('town_hall_bazar') ?? nextSign();
  pick('sign', lintel.x, lintel.z).quad({ x: lintel.x, y: 4.05, z: lintel.z },
    3.6, 0.95, '#ffffff', { y: Math.atan2(lintel.ux, lintel.uz) + Math.PI }, gateSign);

  /* --------------------------------------------------- 7. night-lit sign glow */

  // Sign bands catch the last light; a shared unlit bucket keeps it free.
  for (let bay = 0; bay < BAYS; bay++) {
    const cs = TOWN_HALL_SITE.s0 + 1 + bay * BAY + BAY / 2;
    const p = at(cs, TERRACE_V - 0.16);
    pick('glow', p.x, p.z).quad({ x: p.x, y: 3.55, z: p.z }, BAY - 1.3, 1.0, '#ffd9a0',
      { y: Math.atan2(-p.leftX, -p.leftZ) });
  }

  return { colliders, signSlotEnd: slot };
}
