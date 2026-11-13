/**
 * Mohammadpur (Dhaka-1207) procedural city builder driven by the connected
 * OpenStreetMap street graph in `layout.ts`.
 *
 * Enforces strict geometric invariants (Sections 4, 5, 9, 11, 16):
 *   1. Coherent connected road ribbons + circular junction pads + cul-de-sacs.
 *   2. Sidewalks trimmed against cross-streets (`distanceToRoadCarriageway > 0.08`)
 *      so kerbs never slice across T-junctions or 4-way intersections.
 *   3. Every streetlight, electric pole, signal post and tree is validated via
 *      `isClearOfRoads(x, z, 0.95)` — zero driving-lane intrusions anywhere.
 *   4. Flush Dhaka WASA manhole covers, roadside drain grates, bitumen patches,
 *      cracks, visible shallow potholes, puddles and angled speed humps.
 *   5. Dense multi-storey Bangladeshi buildings bucketed into a 4x4 spatial
 *      sector grid so Three.js frustum culling skips ~70% of off-screen city
 *      triangles automatically every frame.
 */

import * as THREE from 'three';
import type { QualitySettings } from '../core/config';
import { WORLD } from '../core/config';
import { clamp, mulberry32 } from '../core/mathx';
import { buildingRngFor, postBuildingRng } from './buildingRng';
import {
  canonicalSegments,
  isLegacyRoadSegment,
  legacyInfillOrdinal,
  legacyInteriorOrdinal,
} from './legacyFillLayout';
import { legacyFrontageDecision } from './frontageLayout';
import { buildTownHall, isInTownHallSite } from './townHall';
import {
  derivedFillOrdinal,
  RegionBudgetLedger,
  regionKeyOf,
} from './regionFill';
import type { BreakableProp } from './destruction';
import { Bucket, matteMaterial, tintedMaterial } from './geo';
import { addStreetTree, type StreetTree } from './treeModel';
import { planCorridorStructures } from './corridorIdentity';
import { arcLengthOf, placementAt, renderStrips } from './roadGeometry';
import { PosterAtlas } from './posterAtlas';
import { EDUCATION_POSTERS, educationPosterTexture, snackPacketAtlas } from './streetPrint';
import { DAMAGE_ZONES, roadDamageAt } from './roadDamage';
import {
  GRAPH_NODES,
  PLACES,
  ROAD_SEGMENTS,
  SIGNALS,
  distanceToRoadCarriageway,
  isClearOfRoads,
  isFootprintClearOfCorridor,
  distanceToRoadCorridor,
  snapToNearestRoad,
} from './layout';
import {
  SignAtlas,
  asphaltTexture,
  courtyardGroundTexture,
  brickTexture,
  plasterFacadeTexture,
  shutterTexture,
  sidewalkTexture,
} from './textures';

export interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  cameraBlocking: boolean;
  kind: 'building' | 'prop' | 'wall';
  disabled?: boolean;
  breakableId?: number;
  /** Optional oriented bounding box (OBB) in world XZ for rotated buildings/stalls/barriers. */
  cx?: number;
  cz?: number;
  halfX?: number;
  halfZ?: number;
  yaw?: number;
}

export interface SpeedHump {
  x: number;
  z: number;
  /** Unit road tangent along which the vehicle crosses the hump. */
  ux: number;
  uz: number;
  halfWidth: number;
  depth: number;
  height: number;
  axis: 'x' | 'z';
}

export interface AuthoredPothole {
  x: number;
  z: number;
  radius: number;
  depth: number;
  roadId: string;
}

interface SurfaceBump {
  x: number;
  z: number;
  radius: number;
  deltaY: number;
}

export interface CityResult {
  group: THREE.Group;
  colliders: Collider[];
  breakableLamps: BreakableProp[];
  humps: SpeedHump[];
  potholes: readonly AuthoredPothole[];
  potholeDepthAt: (x: number, z: number) => number;
  roadDamageAt: (x: number, z: number) => number;
  heightAt: (x: number, z: number) => number;
  lampPositions: THREE.Vector3[];
  signAnchors: THREE.Vector3[];
  spawn: { x: number; z: number; yaw: number };
  placeAnchors: Map<string, THREE.Vector3>;
  setWetness: (wet: number) => void;
  setNight: (intensity: number) => void;
  litterCount: number;
  infillCount: number;
  posterCount: number;
  billboardCount: number;
  groceryCount: number;
  educationPosterCount: number;
  treeCount: number;
  treeSites: readonly { x: number; z: number }[];
  utilityPoleSites: readonly { x: number; z: number }[];
  /**
   * Verified corridor landmark structures actually built this session (Ring Road
   * and Tajmahal Road). Exposed so the live geography validator can assert they
   * never overlap a building. Empty when none could be seated.
   */
  landmarkStructures: readonly {
    landmarkId: string;
    kind: string;
    x: number;
    z: number;
    halfX: number;
    halfZ: number;
  }[];
  /**
   * Stall posts inside the Town Hall bazaar. `PedestrianSystem` borrows walkers
   * to staff them, so the market reads as occupied without any new meshes.
   */
  marketVendorPosts: readonly import('./townHall').MarketVendorPost[];
  interiorCount: number;
  courtyardCount: number;
  courtyardSites: readonly { x: number; z: number }[];
  pocketPlazaCount: number;
  updateStreetLitter: (dt: number, windStrength: number, playerX: number, playerZ: number) => void;
  registerShadowCasters: (root: THREE.Object3D) => void;
  updateShadowFocus: (x: number, z: number, shadowRadius: number, shadowsEnabled: boolean, force?: boolean) => void;
  withPrewarmState: (run: () => void) => void;
}

const PLASTER_TINTS = [
  '#eadcc5',
  '#dfc8a7',
  '#d7bda6',
  '#cbd4c0',
  '#dcc6ca',
  '#c4cfd4',
  '#e6d2a2',
  '#cfc2ab',
  '#c9d3c7', // muted washed green, not a saturated painted block
  '#dbc9b2',
  '#c7c9c4',
  '#d6c6b7',
];

const AWNING_COLORS = ['#a73a30', '#29644c', '#315a77', '#ad7935', '#793955'];
const SHUTTER_TINTS = ['#cfd6de', '#c3cfce', '#d1c8ba', '#bcc8d1', '#d0d1c8', '#c3d2c4', '#c8c3cb'];

const SECTOR_GRID = 4;
const SECTOR_COUNT = SECTOR_GRID * SECTOR_GRID;
const SECTOR_MIN = -285;
const SECTOR_SPAN = 570;

/**
 * Extent of the world the shipped road graph generates buildings over
 * (`[-224, 224]` on both axes — the block-interior candidate grid).
 *
 * Region fill is scoped to areas *outside* this box. A road that happens to run
 * through the mapped blocks is a different, unresolved question (building-vs-road
 * precedence, `docs/REGIONAL_FILL.md` §7.2), and this system must not answer it by
 * quietly adding or evicting shipped buildings.
 */
const SHIPPED_EXTENT = 224;

function insideShippedExtent(x: number, z: number): boolean {
  return Math.abs(x) <= SHIPPED_EXTENT && Math.abs(z) <= SHIPPED_EXTENT;
}

function sectorIndex(x: number, z: number): number {
  const sx = clamp(Math.floor(((x - SECTOR_MIN) / SECTOR_SPAN) * SECTOR_GRID), 0, SECTOR_GRID - 1);
  const sz = clamp(Math.floor(((z - SECTOR_MIN) / SECTOR_SPAN) * SECTOR_GRID), 0, SECTOR_GRID - 1);
  return sz * SECTOR_GRID + sx;
}

/** One small, scalloped road-surface basin, built only for the authored holes.
 * The shared asphalt ribbon cannot be cut locally without fragmenting every
 * road chunk; a shallow sloping lip and inset bottom give normal-camera depth
 * while the existing heightAt/contact depression remains the physical truth. */
function potholeSurface(radius: number, seed: number, lip: boolean): THREE.BufferGeometry {
  const positions: number[] = [], uv: number[] = [];
  const n = 15;
  const point = (i: number, inner: boolean): [number, number, number] => {
    const a = (i / n) * Math.PI * 2;
    const irregular = 1 + 0.10 * Math.sin(i * 2.71 + seed * 1.3) +
      0.065 * Math.cos(i * 1.63 + seed * 2.1);
    const r = radius * irregular * (inner ? 0.81 : 1.14);
    return [Math.cos(a) * r, inner ? 0.022 : 0.041, Math.sin(a) * r];
  };
  const triangle = (a: number[], b: number[], c: number[]) => {
    // Winding must face +Y when viewed from the driving camera.
    if ((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) < 0) [b, c] = [c, b];
    for (const v of [a, b, c]) {
      positions.push(v[0], v[1], v[2]);
      uv.push(0.5 + v[0] / (2.5 * radius), 0.5 + v[2] / (2.5 * radius));
    }
  };
  for (let i = 0; i < n; i++) {
    if (lip) {
      triangle(point(i, true), point(i + 1, true), point(i + 1, false));
      triangle(point(i, true), point(i + 1, false), point(i, false));
    } else {
      const a = point(i, true), b = point(i + 1, true);
      triangle([0, 0.020, 0], [a[0], 0.022, a[2]], [b[0], 0.022, b[2]]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // Bucket merges indexed Box/Cylinder geometries; this small basin must share
  // that index layout or the entire road/sidewalk chunk silently disappears.
  geo.setIndex(Array.from({ length: positions.length / 3 }, (_, i) => i));
  geo.computeVertexNormals();
  return geo;
}

export function buildCity(signAtlas: SignAtlas, quality: QualitySettings): CityResult {
  const group = new THREE.Group();
  group.name = 'mohammadpur-city';
  const colliders: Collider[] = [];
  const breakableLamps: BreakableProp[] = [];
  const humps: SpeedHump[] = [];
  const microBumps: SurfaceBump[] = [];
  const potholes: AuthoredPothole[] = [];
  let regularPotholeCount = 0;
  const lampPositions: THREE.Vector3[] = [];
  const signAnchors: THREE.Vector3[] = [];
  const placeAnchors = new Map<string, THREE.Vector3>();
  const wirePairs: [THREE.Vector3, THREE.Vector3][] = [];
  const streetTrees: StreetTree[] = [];
  const utilityPoleSites: { x: number; z: number }[] = [];
  const rng = mulberry32(20261207);

  // Shared world materials:
  // Glossy/metallic PBR (`MeshStandardMaterial`) reserved for wet-reactive asphalt,
  // reflective puddles, corrugated steel shutters & street hardware; matte diffuse
  // (`MeshLambertMaterial` + baked vertex ground/overhang AO) used for plaster,
  // concrete sidewalks, brick, foliage & painted shop signs to avoid wasteful
  // per-pixel GGX + PMREM dual-mip CubeUV shader loops on Mali-G72 MP3.
  const asphalt = asphaltTexture();
  asphalt.map.repeat.set(1, 1);
  const roadMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    map: asphalt.map,
    roughnessMap: asphalt.rough,
    roughness: 0.9,
    metalness: 0.05,
  });
  const walkTex = sidewalkTexture();
  const walkMat = matteMaterial(walkTex);
  // A warm mineral base keeps sunlit plaster from clipping to paper white;
  // per-building vertex tints still supply the existing facade variety.
  const facadeTex = plasterFacadeTexture(0, '#eee9df');
  const wallMat = matteMaterial(facadeTex);
  const brickMat = matteMaterial(brickTexture());
  const shutterMat = tintedMaterial(shutterTexture(), { roughness: 0.55, metalness: 0.45 });
  const metalMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.42,
    metalness: 0.65,
  });
  const detailMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
  });
  const puddleMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.24,
    metalness: 0.28,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const signMat = new THREE.MeshLambertMaterial({
    map: signAtlas.texture,
  });
  const posterAtlas = new PosterAtlas();
  const posterMat = new THREE.MeshLambertMaterial({ map: posterAtlas.texture });
  const educationMat = new THREE.MeshLambertMaterial({ map: educationPosterTexture() });
  const snackAtlas = snackPacketAtlas();
  const snackMat = new THREE.MeshLambertMaterial({ map: snackAtlas.texture });
  const glowMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  // A few occupied windows reveal warm interiors after dusk. These are
  // unlit, shared-material panes: no point lights, shadow maps or textures.
  const windowLightMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0, depthWrite: false,
    side: THREE.FrontSide,
  });

  // Ground base plane beneath everything (urban earth / courtyard compound floor)
  const groundPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.groundExtent * 2, WORLD.groundExtent * 2),
    new THREE.MeshLambertMaterial({ map: courtyardGroundTexture(), color: 0xffffff }),
  );
  groundPlane.rotation.x = -Math.PI / 2;
  groundPlane.position.y = -0.02;
  groundPlane.receiveShadow = true;
  groundPlane.matrixAutoUpdate = false;
  groundPlane.updateMatrix();
  group.add(groundPlane);

  // Global buckets for roads, sidewalks, props & night glow
  const bRoad = new Bucket('roads.asphalt', roadMat);
  const bWalk = new Bucket('roads.sidewalk', walkMat, true);
  const bMetal = new Bucket('city.metal', metalMat, true);
  const bPuddle = new Bucket('roads.puddles', puddleMat);
  const bGlow = new Bucket('city.nightGlow', glowMat);

  // 6x6 sector-chunked buckets with baked ground/eave AO for buildings, foliage & signs
  const sectorWalls = Array.from({ length: SECTOR_COUNT }, (_, i) => new Bucket(`sec.${i}.wall`, wallMat, true));
  const sectorDetails = Array.from({ length: SECTOR_COUNT }, (_, i) => new Bucket(`sec.${i}.detail`, detailMat, true));
  const sectorShutters = Array.from({ length: SECTOR_COUNT }, (_, i) => new Bucket(`sec.${i}.shutter`, shutterMat, true));
  const sectorBricks = Array.from({ length: SECTOR_COUNT }, (_, i) => new Bucket(`sec.${i}.brick`, brickMat, true));
  // Thin atlas quads do not need sixteen separate draw calls. Four broad
  // 2x2-sector groups retain district culling while reducing main/night passes;
  // building bodies and opaque details remain tightly culled per sector.
  const decalGroup = (sector: number) => Math.floor((sector % SECTOR_GRID) / 2) +
    2 * Math.floor(Math.floor(sector / SECTOR_GRID) / 2);
  const signGroups = Array.from({ length: 4 }, (_, i) => new Bucket(`signs.district.${i}`, signMat));
  const posterGroups = Array.from({ length: 4 }, (_, i) => new Bucket(`posters.district.${i}`, posterMat));
  const educationGroups = Array.from({ length: 4 }, (_, i) => new Bucket(`education.district.${i}`, educationMat));
  const snackGroups = Array.from({ length: 4 }, (_, i) => new Bucket(`snacks.district.${i}`, snackMat));
  const lightGroups = Array.from({ length: 4 }, (_, i) => new Bucket(`lights.district.${i}`, windowLightMat));
  const sectorSigns = Array.from({ length: SECTOR_COUNT }, (_, i) => signGroups[decalGroup(i)]);
  const sectorPosters = Array.from({ length: SECTOR_COUNT }, (_, i) => posterGroups[decalGroup(i)]);
  const sectorEducation = Array.from({ length: SECTOR_COUNT }, (_, i) => educationGroups[decalGroup(i)]);
  const sectorSnacks = Array.from({ length: SECTOR_COUNT }, (_, i) => snackGroups[decalGroup(i)]);
  let posterCount = 0, billboardCount = 0, educationPosterCount = 0, groceryCount = 0;
  const sectorWindowLights = Array.from({ length: SECTOR_COUNT }, (_, i) => lightGroups[decalGroup(i)]);
  const litWindow = (sec: number, x: number, y: number, z: number,
    yaw: number, width: number, height: number): void => {
    // Stable per-pane occupancy, independent of the city's seeded layout RNG.
    const hash = (Math.imul(Math.round(x * 10), 73856093) ^
      Math.imul(Math.round(z * 10), 19349663) ^
      Math.imul(Math.round(y * 10), 83492791)) >>> 0;
    if (hash % 3 !== 0) return; // most homes stay dark; staggered occupancy
    sectorWindowLights[sec].quad({ x, y, z }, width, height,
      ['#dfa468', '#c78650', '#b7a380'][(hash >>> 4) % 3], { y: yaw });
  };

  // ---------------- 1. JUNCTION DISCS & CONNECTED ROAD RIBBONS (Section 16)
  for (const node of GRAPH_NODES) {
    // Annular pedestrian apron, NOT a solid raised disc. A full sidewalk disc
    // covered the asphalt at junctions by 6 cm and made buses look as though
    // they were crossing a tiled plaza despite following the real road graph.
    const apron = new THREE.RingGeometry(node.radius + 0.03, node.outerRadius, 32);
    bWalk.add(apron, { x: node.x, y: 0.065, z: node.z },
      { x: 1, y: 1, z: 1 }, '#958d7e', { x: -Math.PI / 2 });
    apron.dispose();
    // Circular asphalt junction pad at y = 0.014 (connects every angle cleanly without gaps!)
    bRoad.cylinder({ x: node.x, y: 0.008, z: node.z }, node.radius, 0.016, '#84888e');
    if (node.deadEnd) {
      // Neat cul-de-sac kerb bollard ring outside dead-end turnaround
      for (let k = 0; k < 5; k++) {
        const ang = (k / 5) * Math.PI * 2;
        const bx = node.x + Math.cos(ang) * (node.radius + 0.9);
        const bz = node.z + Math.sin(ang) * (node.radius + 0.9);
        if (isClearOfRoads(bx, bz, 0.65)) {
          bMetal.cylinder({ x: bx, y: 0.38, z: bz }, 0.09, 0.76, k % 2 === 0 ? '#f2b938' : '#24292e');
        }
      }
    }
  }

  for (const seg of ROAD_SEGMENTS) {
    const yaw = Math.atan2(seg.ux, seg.uz);
    const asphaltTint = seg.kind === 'main' ? '#868b92' : seg.kind === 'medium' ? '#7f8389' : '#777a7e';

    // Continuous asphalt carriageway ribbon between junction centres (flush y = 0.014).
    //
    // Emitted once per polyline span so an authored centreline paints as a real
    // ribbon rather than a straight chord. For a segment with no `vertices` this
    // is a single box identical to the previous one. For the collinear Phase 1
    // prototype (`asad_4`) it is two half-length boxes that tile the original
    // footprint exactly — the seam sits at the midpoint with no gap and no
    // overlap, so nothing about the surface changes.
    for (const span of renderStrips(seg)) {
      bRoad.box(
        { x: (span.ax + span.bx) * 0.5, y: 0.007, z: (span.az + span.bz) * 0.5 },
        { x: seg.width, y: 0.014, z: span.length },
        asphaltTint,
        { y: Math.atan2(span.ux, span.uz) },
      );
    }

    // Dashed white centreline + solid main-avenue edge lines (trimmed away from junction centres)
    const trimStart = Math.min(seg.length * 0.35, 8.5);
    const trimEnd = Math.max(trimStart, seg.length - 8.5);
    if (seg.kind !== 'gali' && trimEnd - trimStart > 8) {
      for (let d = trimStart; d <= trimEnd - 2.5; d += 6.2) {
        const pf1 = placementAt(seg, (d + 1.4), 0);
        const px = pf1.x;
        const pz = pf1.z;
        bRoad.box({ x: px, y: 0.016, z: pz }, { x: 0.13, y: 0.003, z: 2.6 }, '#e6e2d3', { y: yaw });
      }
    }
    if (seg.kind === 'main' && trimEnd - trimStart > 8) {
      const innerLen = trimEnd - trimStart;
      const pf2 = placementAt(seg, (trimStart + innerLen * 0.5), 0);
      const imx = pf2.x;
      const imz = pf2.z;
      for (const side of [-1, 1]) {
        const ex = imx + pf2.leftX * (seg.halfWidth - 0.38) * side;
        const ez = imz + pf2.leftZ * (seg.halfWidth - 0.38) * side;
        bRoad.box({ x: ex, y: 0.016, z: ez }, { x: 0.11, y: 0.003, z: innerLen }, '#e0b94c', { y: yaw });
      }
    }

    // Zebra pedestrian crossings near signalised ends
    for (const end of [
      { dist: 9.2, active: seg.kind !== 'gali' && seg.length > 26 },
      { dist: seg.length - 9.2, active: seg.kind === 'main' && seg.length > 34 },
    ]) {
      if (!end.active) continue;
      const pf3 = placementAt(seg, end.dist, 0);
      const zx = pf3.x;
      const zz = pf3.z;
      const stripes = Math.floor((seg.width - 1.4) / 0.85);
      for (let s = 0; s < stripes; s++) {
        const off = -((stripes - 1) * 0.5) * 0.85 + s * 0.85;
        bRoad.box(
          { x: zx + pf3.leftX * off, y: 0.017, z: zz + pf3.leftZ * off },
          { x: 0.42, y: 0.003, z: 2.1 },
          '#ece8da',
          { y: yaw },
        );
      }
    }

    // Segmented sidewalks on BOTH sides — clipped wherever any cross-road or junction passes!
    const stepLen = 4.2;
    const steps = Math.max(1, Math.floor(seg.length / stepLen));
    const actualLen = seg.length / steps;
    for (const side of [-1, 1]) {
      const lateralCenter = (seg.halfWidth + seg.sidewalk * 0.5) * side;
      const kerbCenter = (seg.halfWidth + 0.09) * side;
      for (let i = 0; i < steps; i++) {
        const along = (i + 0.5) * actualLen;
        const pf4 = placementAt(seg, along, lateralCenter);
        const sx = pf4.x;
        const sz = pf4.z;
        const pf5 = placementAt(seg, (along - actualLen * 0.44), lateralCenter);
        const s0x = pf5.x;
        const s0z = pf5.z;
        const pf6 = placementAt(seg, (along + actualLen * 0.44), lateralCenter);
        const s1x = pf6.x;
        const s1z = pf6.z;
        // Skip slab if ANY part of it would intrude into a crossing carriageway or junction!
        if (
          distanceToRoadCarriageway(sx, sz) < seg.sidewalk * 0.38 ||
          distanceToRoadCarriageway(s0x, s0z) < 0.12 ||
          distanceToRoadCarriageway(s1x, s1z) < 0.12
        ) {
          continue;
        }
        bWalk.box(
          { x: sx, y: 0.045, z: sz },
          { x: seg.sidewalk, y: 0.09, z: actualLen + 0.04 },
          '#a79f90',
          { y: yaw },
        );
        // Black-and-white / yellow-and-black painted Dhaka concrete kerb stone!
        const pf7 = placementAt(seg, along, kerbCenter);
        const kx = pf7.x;
        const kz = pf7.z;
        const kerbCol = seg.kind === 'main' ? (i % 2 === 0 ? '#e6ebe8' : '#23282d') : '#7b756b';
        bWalk.box({ x: kx, y: 0.055, z: kz }, { x: 0.18, y: 0.11, z: actualLen + 0.02 }, kerbCol, { y: yaw });
      }
    }

    // ------- 2. FLUSH BANGLADESHI ROAD SURFACE DETAILS & CULVERT CRESTS ------
    // Purpose-built Mohammadpur box-culvert / embankment crests on long corridors:
    // rises & falls smoothly via a raised cosine profile matched in both 3D asphalt
    // slabs and `heightAt(x, z)` so tyres track slopes/crests with <1cm error!
    const CREST_HEIGHT_BY_SEG: Record<string, number> = {
      asad_0: 0.44, // Beribadh Embankment Approach ramp
      ring_2: 0.40, // Ring Road Shia Mosque Overpass crest
      babar_2: 0.46, // Babor Road Canal Box-Culvert bridge
      satmasjid_2: 0.42, // Satmasjid Road Southern Culvert rise
      asad_5: 0.36, // Asad Gate Crown straight
    };
    const crestH = CREST_HEIGHT_BY_SEG[seg.id] ?? 0;
    if (crestH > 0 && seg.length >= 46) {
      const cd = seg.length * 0.5;
      const pf8 = placementAt(seg, cd, 0);
      const cxp = pf8.x;
      const czp = pf8.z;
      const crestDepth = Math.min(26, seg.length - 20);
      humps.push({
        x: cxp,
        z: czp,
        ux: seg.ux,
        uz: seg.uz,
        halfWidth: seg.halfWidth + 0.15,
        depth: crestDepth,
        height: crestH,
        axis: seg.axis,
      });
      const slabCount = 9;
      const slabLen = crestDepth / slabCount;
      for (let s = 0; s < slabCount; s++) {
        const uMid = -crestDepth * 0.5 + (s + 0.5) * slabLen;
        const u0 = uMid - slabLen * 0.5;
        const u1 = uMid + slabLen * 0.5;
        const y0 = Math.cos((u0 / (crestDepth * 0.5)) * (Math.PI * 0.5)) * crestH;
        const y1 = Math.cos((u1 / (crestDepth * 0.5)) * (Math.PI * 0.5)) * crestH;
        const yMid = (y0 + y1) * 0.5;
        const pitch = -Math.atan2(y1 - y0, slabLen);
        bRoad.box(
          { x: cxp + seg.ux * uMid, y: 0.008 + yMid * 0.5, z: czp + seg.uz * uMid },
          { x: seg.width + 0.12, y: Math.max(0.02, yMid + 0.016), z: slabLen + 0.08 },
          '#81868e',
          { y: yaw, x: pitch * 0.35 },
        );
      }
      // Low painted concrete culvert guard-kerbs strictly outside the carriageway!
      for (const side of [-1, 1] as const) {
        const px = cxp + pf8.leftX * (seg.halfWidth + 0.32) * side;
        const pz = czp + pf8.leftZ * (seg.halfWidth + 0.32) * side;
        if (isClearOfRoads(px, pz, 0.15)) {
          bWalk.box(
            { x: px, y: crestH * 0.55 + 0.24, z: pz },
            { x: 0.24, y: crestH + 0.38, z: crestDepth * 0.72 },
            '#d9cbb3',
            { y: yaw },
          );
          bMetal.box(
            { x: px, y: crestH + 0.46, z: pz },
            { x: 0.26, y: 0.08, z: crestDepth * 0.72 },
            '#eab308',
            { y: yaw },
          );
        }
      }
    }

    // Speed breakers on busy approaches (never inside junctions or on culvert crests)
    if (crestH === 0 && seg.length > 44 && (seg.jamProne || seg.kind === 'medium') && rng() < 0.46) {
      const hd = seg.length * (0.42 + rng() * 0.16);
      const pf9 = placementAt(seg, hd, 0);
      const hx = pf9.x;
      const hz = pf9.z;
      const hHeight = seg.kind === 'main' ? 0.058 : 0.065;
      humps.push({
        x: hx,
        z: hz,
        ux: seg.ux,
        uz: seg.uz,
        halfWidth: seg.halfWidth - 0.25,
        depth: 1.55,
        height: hHeight,
        axis: seg.axis,
      });
      bRoad.box(
        { x: hx, y: hHeight * 0.5 + 0.01, z: hz },
        { x: seg.width - 0.5, y: hHeight, z: 1.45 },
        '#4c5056',
        { y: yaw },
      );
      const chevronCount = Math.floor((seg.width - 1.0) / 0.9);
      for (let c = 0; c < chevronCount; c++) {
        const off = -((chevronCount - 1) * 0.5) * 0.9 + c * 0.9;
        bRoad.box(
          { x: hx + pf9.leftX * off, y: hHeight + 0.012, z: hz + pf9.leftZ * off },
          { x: 0.38, y: 0.005, z: 1.25 },
          c % 2 === 0 ? '#f2be38' : '#f2efe4',
          { y: yaw },
        );
      }
    }

    // Flush Dhaka WASA cast-iron manhole covers + roadside drain grates + patches + potholes + puddles
    const numManholes = Math.max(1, Math.floor(seg.length / 42));
    for (let m = 0; m < numManholes; m++) {
      const d = 12 + ((m + 0.45) / numManholes) * Math.max(8, seg.length - 24);
      const off = (rng() - 0.5) * (seg.width * 0.42);
      const pf10 = placementAt(seg, d, off);
      const mxp = pf10.x;
      const mzp = pf10.z;
      // Outer concrete collar + dark cast-iron WASA manhole lid + waffle inner ring (flush at y = 0.018!)
      bWalk.cylinder({ x: mxp, y: 0.013, z: mzp }, 0.52, 0.012, '#6d6960');
      bMetal.cylinder({ x: mxp, y: 0.017, z: mzp }, 0.40, 0.012, '#3a342f');
      bMetal.cylinder({ x: mxp, y: 0.021, z: mzp }, 0.27, 0.006, '#524941');
      bMetal.box({ x: mxp, y: 0.022, z: mzp }, { x: 0.48, y: 0.005, z: 0.05 }, '#282320', { y: yaw });
      bMetal.box({ x: mxp, y: 0.022, z: mzp }, { x: 0.05, y: 0.005, z: 0.48 }, '#282320', { y: yaw });
      microBumps.push({ x: mxp, z: mzp, radius: 0.45, deltaY: 0.008 });

      // Roadside cast-iron storm-drain grate right next to the left/right curb!
      const side = m % 2 === 0 ? 1 : -1;
      const pf11 = placementAt(seg, d, (seg.halfWidth - 0.34) * side);
      const gx = pf11.x;
      const gz = pf11.z;
      bMetal.box({ x: gx, y: 0.016, z: gz }, { x: 0.46, y: 0.01, z: 0.78 }, '#22262a', { y: yaw });
      for (let sl = -2; sl <= 2; sl++) {
        const sx = gx + seg.ux * sl * 0.13;
        const sz = gz + seg.uz * sl * 0.13;
        bMetal.box({ x: sx, y: 0.021, z: sz }, { x: 0.38, y: 0.004, z: 0.04 }, '#4e555d', { y: yaw });
      }
    }

    // Bitumen asphalt repair patches, tar cracks, shallow visible potholes & wet puddles
    const wearCount = Math.max(1, Math.floor(seg.length / 32));
    for (let w = 0; w < wearCount; w++) {
      const d = 10 + rng() * Math.max(6, seg.length - 20);
      const off = (rng() - 0.5) * (seg.width * 0.65);
      const pf12 = placementAt(seg, d, off);
      const wx = pf12.x;
      const wz = pf12.z;
      const roll = rng();
      if (roll < 0.38) {
        // Dark fresh bitumen repair patch + tar seam border
        const pw = 1.1 + rng() * 1.3;
        const pl = 1.6 + rng() * 2.2;
        bRoad.box({ x: wx, y: 0.0155, z: wz }, { x: pw + 0.14, y: 0.003, z: pl + 0.14 }, '#23262b', {
          y: yaw + (rng() - 0.5) * 0.2,
        });
        bRoad.box({ x: wx, y: 0.017, z: wz }, { x: pw, y: 0.003, z: pl }, '#3f434a', {
          y: yaw + (rng() - 0.5) * 0.2,
        });
      } else if (roll < 0.66) {
        // Repaired zigzag tar road crack
        for (let c = 0; c < 4; c++) {
          const cx = wx + pf12.ux * c * 0.55 + pf12.leftX * ((c % 2 === 0 ? 1 : -1) * 0.14);
          const cz = wz + pf12.uz * c * 0.55 + pf12.leftZ * ((c % 2 === 0 ? 1 : -1) * 0.14);
          bRoad.box(
            { x: cx, y: 0.0165, z: cz },
            { x: 0.07, y: 0.003, z: 0.68 },
            '#1d2024',
            { y: yaw + (c % 2 === 0 ? 0.34 : -0.34) },
          );
        }
      } else if (roll < 0.84) {
        // Visible weathered shallow pothole (pale broken concrete rim + dark gravelly depression)
        const pr = 0.42 + rng() * 0.28;
        bWalk.cylinder({ x: wx, y: 0.015, z: wz }, pr + 0.11, 0.006, '#7a756b');
        bRoad.cylinder({ x: wx, y: 0.017, z: wz }, pr, 0.005, '#262320');
        microBumps.push({ x: wx, z: wz, radius: pr + 0.1, deltaY: -0.024 });
      } else {
        // Glossy roadside rainwater / tea-wash puddle near the curb!
        const side = rng() < 0.5 ? 1 : -1;
        const pf13 = placementAt(seg, d, (seg.halfWidth - 0.85) * side);
        const px = pf13.x;
        const pz = pf13.z;
        bPuddle.cylinder({ x: px, y: 0.017, z: pz }, 0.72 + rng() * 0.55, 0.003, '#3b4a56');
      }
    }

    // Four fictional worn stretches, authored against real *road topology*, not
    // asserted as observations of real current road condition. Broken paving,
    // tar seams and two physical wheel contacts per stretch share existing
    // road/sidewalk buckets; no new material or object per crack.
    const damage = DAMAGE_ZONES.find((zone) => zone.segment === seg);
    if (damage) {
      const span = damage.end - damage.begin;
      for (let k = 0; k < 7; k++) {
        const along = damage.begin + span * (k + .5) / 7;
        const off = (k % 3 - 1) * seg.halfWidth * .38;
        const pf14 = placementAt(seg, along, off);
        const x = pf14.x;
        const z = pf14.z;
        bRoad.box({ x, y: .0155, z }, { x: 1.7, y: .003, z: 2.5 },
          k % 2 ? '#646266' : '#595b60', { y: yaw + (k % 2 ? .13 : -.09) });
        for (let seam = 0; seam < 3; seam++) {
          bRoad.box({ x: x + pf14.leftX * (seam - 1) * .48, y: .018, z: z + pf14.leftZ * (seam - 1) * .48 },
            { x: .035, y: .002, z: 1.0 }, '#25272b', { y: yaw + (seam % 2 ? .35 : -.32) });
        }
      }
      for (const fraction of [.36, .67]) {
        const along = damage.begin + span * fraction;
        const off = fraction < .5 ? -.9 : .9;
        const pf15 = placementAt(seg, along, off);
        const x = pf15.x;
        const z = pf15.z;
        if (PLACES.some((place) => Math.hypot(place.x - x, place.z - z) < 12)) continue;
        const radius = .63, depth = .055;
        const basin = potholeSurface(radius, potholes.length + 37, false);
        const lip = potholeSurface(radius, potholes.length + 37, true);
        bRoad.add(basin, { x, y: 0, z }, { x: 1, y: 1, z: 1 }, '#383735');
        bWalk.add(lip, { x, y: 0, z }, { x: 1, y: 1, z: 1 }, '#85766b');
        basin.dispose(); lip.dispose();
        potholes.push({ x, z, radius, depth, roadId: seg.id });
        microBumps.push({ x, z, radius, deltaY: -depth });
      }
    }

    // Curated rough-road contact zones: away from junctions, destinations,
    // spawn and other hazards. Their exact polygon is shared with physics.
    if (regularPotholeCount < 8 && seg.kind !== 'gali' && seg.length > 58) {
      const d = seg.length * 0.56;
      const off = Math.min(1.15, seg.halfWidth * 0.32);
      const pf16 = placementAt(seg, d, off);
      const px = pf16.x;
      const pz = pf16.z;
      if (        Math.hypot(px - WORLD.playerSpawn.x, pz - WORLD.playerSpawn.z) > 20 &&
        PLACES.every((place) => Math.hypot(place.x - px, place.z - pz) > 16) &&
        potholes.every((hole) => Math.hypot(hole.x - px, hole.z - pz) > 35)) {
        const radius = 0.78;
        // A broken irregular lip slopes into a smaller gravel-dark basin;
        // no circular concrete decal or raised collision lip. Different seed
        // per authored site, with exactly the existing eight physical centers.
        const seed = regularPotholeCount + 1;
        const basin = potholeSurface(radius, seed, false);
        const lip = potholeSurface(radius, seed, true);
        bRoad.add(basin, { x: px, y: 0, z: pz }, { x: 1, y: 1, z: 1 }, '#44423e');
        bWalk.add(lip, { x: px, y: 0, z: pz }, { x: 1, y: 1, z: 1 }, '#877664');
        basin.dispose(); lip.dispose();
        potholes.push({ x: px, z: pz, radius, depth: 0.065, roadId: seg.id });
        regularPotholeCount++;
        microBumps.push({ x: px, z: pz, radius, deltaY: -0.065 });
      }
    }

    // ------- 3. VALIDATED STREETLIGHTS, ELECTRIC POLES & TREES (Section 16) --
    // Every single pole/lamp/tree is checked via `isClearOfRoads(x, z, 0.95)`!
    const lampSpacing = seg.kind === 'main' ? 28 : seg.kind === 'medium' ? 34 : 44;
    let prevPole: THREE.Vector3 | null = null;
    for (let d = 11, idx = 0; d <= seg.length - 11; d += lampSpacing, idx++) {
      const side: 1 | -1 = seg.kind === 'main' ? (idx % 2 === 0 ? 1 : -1) : 1;
      const curbDist = seg.halfWidth + Math.min(seg.sidewalk * 0.72, 1.55);
      const pf17 = placementAt(seg, d, curbDist * side);
      const lx = pf17.x;
      const lz = pf17.z;
      if (!isClearOfRoads(lx, lz, 0.95)) continue;

      // Inward normal toward road centre: (-leftX * side, -leftZ * side)
      const inX = -pf17.leftX * side;
      const inZ = -pf17.leftZ * side;
      const armYaw = Math.atan2(inX, inZ);

      // Galvanized streetlamp column + concrete plinth + overhanging cobra-head LED luminaire
      // Plinth stays anchored on sidewalk; column + arm + cobra-head + bulb are breakable on high-speed impact!
      const lampBreakId = lampPositions.length;
      bWalk.cylinder({ x: lx, y: 0.22, z: lz }, 0.19, 0.44, '#7d786e');
      bMetal.setTag(lampBreakId);
      bGlow.setTag(lampBreakId);
      bMetal.cylinder({ x: lx, y: 3.1, z: lz }, 0.075, 5.8, '#535a62');
      bMetal.box(
        { x: lx + inX * 0.62, y: 5.92, z: lz + inZ * 0.62 },
        { x: 0.10, y: 0.09, z: 1.35 },
        '#535a62',
        { y: armYaw, x: -0.14 },
      );
      const headX = lx + inX * 1.18;
      const headZ = lz + inZ * 1.18;
      bMetal.box({ x: headX, y: 5.98, z: headZ }, { x: 0.26, y: 0.08, z: 0.46 }, '#363c42', { y: armYaw });
      bGlow.box({ x: headX, y: 5.93, z: headZ }, { x: 0.22, y: 0.03, z: 0.38 }, '#ffe0a6', { y: armYaw });
      bMetal.setTag(-1);
      bGlow.setTag(-1);
      lampPositions.push(new THREE.Vector3(headX, 5.9, headZ));
      const lampCollider: Collider = {
        minX: lx - 0.14,
        maxX: lx + 0.14,
        minZ: lz - 0.14,
        maxZ: lz + 0.14,
        height: 5.5,
        cameraBlocking: false,
        kind: 'prop',
        breakableId: lampBreakId,
        cx: lx,
        cz: lz,
        halfX: 0.14,
        halfZ: 0.14,
        yaw: 0,
      };
      colliders.push(lampCollider);
      breakableLamps.push({
        id: lampBreakId,
        kind: 'lamp',
        x: lx,
        z: lz,
        yaw: armYaw,
        collider: lampCollider,
        slices: [],
        lampIndex: lampBreakId,
      });

      // Concrete DESCO utility pole + transformer crossbar on opposite/same sidewalk for overhead wires
      const poleSide: 1 | -1 = -side as 1 | -1;
      const pf18 = placementAt(seg, d, curbDist * poleSide);
      const ex = pf18.x;
      const ez = pf18.z;
      if (isClearOfRoads(ex, ez, 0.95)) {
        bWalk.box({ x: ex, y: 3.6, z: ez }, { x: 0.22, y: 7.2, z: 0.22 }, '#8a857c', { y: yaw });
        // Only the concrete column is solid, not its crossbar, wires or paper
        // notice. Static grid indexing already used by buildings/lamps handles
        // these tiny non-breakable colliders without any per-frame mesh work.
        const poleHalf = 0.14;
        colliders.push({ minX: ex - poleHalf, maxX: ex + poleHalf,
          minZ: ez - poleHalf, maxZ: ez + poleHalf, height: 7.2,
          cameraBlocking: false, kind: 'prop',
          cx: ex, cz: ez, halfX: poleHalf, halfZ: poleHalf, yaw: 0 });
        utilityPoleSites.push({ x: ex, z: ez });
        // Occasional high-mounted meter/service cabinet on the EXISTING pole;
        // no ground obstacle or footprint added to the pedestrian corridor.
        if (lampBreakId % 4 === 2) {
          const px = ex - pf18.leftX * poleSide * 0.15;
          const pz = ez - pf18.leftZ * poleSide * 0.15;
          const cabinetYaw = Math.atan2(-pf18.leftX * poleSide, -pf18.leftZ * poleSide);
          const detail = sectorDetails[sectorIndex(ex, ez)];
          detail.box({ x: px, y: 3.05, z: pz },
            { x: 0.43, y: 0.52, z: 0.24 }, '#777d76', { y: cabinetYaw });
          detail.box({ x: px - pf18.leftX * poleSide * 0.126, y: 3.05,
            z: pz - pf18.leftZ * poleSide * 0.126 },
            { x: 0.28, y: 0.30, z: 0.016 }, '#4c5754', { y: cabinetYaw });
        }
        bMetal.box({ x: ex, y: 6.85, z: ez }, { x: 1.15, y: 0.08, z: 0.08 }, '#41474e', { y: yaw });
        // Signature Dhaka coiled fibre-optic cable loop on utility pole!
        bMetal.torus({ x: ex, y: 5.3, z: ez }, 0.28, '#1b1e22', { y: yaw });
        const curPole = new THREE.Vector3(ex, 6.85, ez);
        if (prevPole && prevPole.distanceTo(curPole) < 52) {
          wirePairs.push([prevPole, curPole]);
        }
        prevPole = curPole;
        // Occasional pasted teaching/community notice, tightly flush to the
        // pole. No separate collider, transparent foliage or runtime update.
        if (lampBreakId % 7 === 1 && posterCount < 90) {
          const faceX = -pf18.leftX * poleSide, faceZ = -pf18.leftZ * poleSide;
          const posterYaw = Math.atan2(faceX, faceZ);
          sectorPosters[sectorIndex(ex, ez)].quad(
            { x: ex + faceX * 0.128, y: 2.12, z: ez + faceZ * 0.128 },
            0.38, 0.54, '#ffffff', { y: posterYaw }, posterAtlas.poster(lampBreakId % 3));
          posterCount++;
        }
        // Selected utility poles carry a small printed edition of the supplied
        // poster. The larger wall editions below retain full reading size.
        if (lampBreakId % 23 === 4 && educationPosterCount < 12) {
          const nx = -pf18.leftX * poleSide, nz = -pf18.leftZ * poleSide;
          const boardYaw = Math.atan2(nx, nz);
          const design = educationPosterCount % 2;
          const w = design === 0 ? 0.72 : 0.86;
          const h = design === 0 ? 1.02 : 0.86;
          bMetal.box({ x: ex + nx * 0.16, y: 2.30, z: ez + nz * 0.16 },
            { x: w + 0.08, y: h + 0.08, z: 0.035 }, '#d6d1c2', { y: boardYaw });
          sectorEducation[sectorIndex(ex, ez)].quad(
            { x: ex + nx * 0.188, y: 2.30, z: ez + nz * 0.188 },
            w, h, '#ffffff', { y: boardYaw }, EDUCATION_POSTERS[design]);
          educationPosterCount++;
        }
      }

      // Keep the existing roadside positions and RNG draw count. Defer the
      // mesh until buildings are placed, so trunks cannot end up inside infill.
      const td = d + lampSpacing * 0.48;
      if (td <= seg.length - 10) {
        const pf19 = placementAt(seg, td, (curbDist + 0.18) * side);
        const tx = pf19.x;
        const tz = pf19.z;
        if (isClearOfRoads(tx, tz, 1.15)) {
          const height = 3.2 + rng() * 1.4;
          const flowering = rng() < 0.22;
          if (!flowering) rng(); // prior two-step foliage choice used this draw
          const seed = Math.imul(Math.round(tx * 10), 73856093) ^
            Math.imul(Math.round(tz * 10), 19349663);
          streetTrees.push({ x: tx, z: tz, height, seed, flowering });
        }
      }
    }
  }

  // Traffic signal poles at signalised Mohammadpur intersections (strictly outside road radius!)
  for (const sig of SIGNALS) {
    for (let corner = 0; corner < 2; corner++) {
      const ang = corner * Math.PI + 0.65;
      const sx = sig.x + Math.cos(ang) * (sig.radius + 1.55);
      const sz = sig.z + Math.sin(ang) * (sig.radius + 1.55);
      if (!isClearOfRoads(sx, sz, 0.95)) continue;
      bMetal.cylinder({ x: sx, y: 1.95, z: sz }, 0.08, 3.9, '#2b3036');
      bMetal.box({ x: sx, y: 3.55, z: sz }, { x: 0.28, y: 0.78, z: 0.24 }, '#1c2024');
      bGlow.cylinder({ x: sx, y: 3.76, z: sz + 0.13 }, 0.075, 0.02, '#ff3b30', { x: Math.PI / 2 });
      bGlow.cylinder({ x: sx, y: 3.55, z: sz + 0.13 }, 0.075, 0.02, '#ffcc00', { x: Math.PI / 2 });
      bGlow.cylinder({ x: sx, y: 3.34, z: sz + 0.13 }, 0.075, 0.02, '#34c759', { x: Math.PI / 2 });
    }
  }

  // ---------------- 4. DENSE STREET-ALIGNED MOHAMMADPUR BUILDINGS (Section 9)
  interface PlacedFootprint {
    x: number;
    z: number;
    halfX: number;
    halfZ: number;
    yaw: number;
    radius: number;
    /** True when contributed by a legacy segment (see `legacyPrecedence`). */
    legacy?: boolean;
  }
  const placedBuildings: PlacedFootprint[] = [];
  /**
   * Footprints contributed by *legacy* segments only.
   *
   * The block-interior pass orders its candidates by distance to the nearest
   * placed building. Using the full list would let a building added by a new
   * road reorder interior candidates across the whole city, so the pass reads
   * this frozen-scope snapshot instead. For the shipped 70-segment graph the
   * two lists are identical at that point.
   */
  const legacyPlacedBuildings: PlacedFootprint[] = [];
  let collectLegacyFootprints = true;


  // Static parcel broad phase: test only neighboring center cells before SAT.
  // This changes neither the ordered candidate set nor the overlap rule; it
  // avoids repeatedly scanning every apartment while filling narrow lots.
  const PARCEL_CELL = 24;
  const parcelCells = new Map<string, PlacedFootprint[]>();
  let maxParcelRadius = 0;
  const parcelKey = (x: number, z: number): string => `${x},${z}`;
  const addFootprint = (footprint: PlacedFootprint): void => {
    if (collectLegacyFootprints) footprint.legacy = true;
    placedBuildings.push(footprint);
    if (collectLegacyFootprints) legacyPlacedBuildings.push(footprint);
    maxParcelRadius = Math.max(maxParcelRadius, footprint.radius);
    const key = parcelKey(Math.floor(footprint.x / PARCEL_CELL), Math.floor(footprint.z / PARCEL_CELL));
    let cell = parcelCells.get(key);
    if (!cell) { cell = []; parcelCells.set(key, cell); }
    cell.push(footprint);
  };

  // --- Reserve verified landmark parcels before any building is generated ---
  // Corridor landmarks (Ring Road Shia Jame Masjid, Tajmahal Road graveyard and
  // Eidgah) are real places whose parcels procedural infill would otherwise
  // occupy: seating the mosque *after* the frontage existed left it overlapping
  // a 15.25 m block by 5.6 x 2.9 m. Registering the footprint through
  // `addFootprint` (so the parcel broad phase sees it too) makes the landmark
  // take precedence over generated infill, which is the correct ordering.
  const corridorStructures = planCorridorStructures();
  for (const st of corridorStructures) {
    addFootprint({
      x: st.x,
      z: st.z,
      halfX: st.halfX,
      halfZ: st.halfZ,
      yaw: st.yaw,
      radius: Math.hypot(st.halfX, st.halfZ),
    });
  }

  // Bounding circles used to reject neighboring angled facades with large
  // empty wedges between their real footprints. A SAT test allows close,
  // staggered street frontage without merging buildings or narrowing roads.
  const footprintSeparated = (a: PlacedFootprint, b: PlacedFootprint, gap: number): boolean => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    if (dx * dx + dz * dz >= (a.radius + b.radius + gap) ** 2) return true;
    const ac = Math.cos(a.yaw), as = Math.sin(a.yaw);
    const bc = Math.cos(b.yaw), bs = Math.sin(b.yaw);
    const axes: [number, number][] = [[ac, -as], [as, ac], [bc, -bs], [bs, bc]];
    for (const [ux, uz] of axes) {
      const projectedDistance = Math.abs(dx * ux + dz * uz);
      const ra = a.halfX * Math.abs(ux * ac - uz * as) + a.halfZ * Math.abs(ux * as + uz * ac);
      const rb = b.halfX * Math.abs(ux * bc - uz * bs) + b.halfZ * Math.abs(ux * bs + uz * bc);
      if (projectedDistance >= ra + rb + gap) return true;
    }
    return false;
  };

  const canPlaceBuilding = (
    cx: number,
    cz: number,
    width: number,
    depth: number,
    yaw: number,
    /**
     * Legacy precedence. When true the candidate belongs to the shipped world,
     * so buildings contributed by *new* roads may not evict it. Without this a
     * road added today would silently delete an existing building by placing a
     * fresh one beside it — a world change dressed up as locality.
     *
     * Corridor checks are unaffected: a legacy building is still refused when a
     * road carriageway itself covers it. Only the building-vs-building parcel
     * contest is weighted, and only in favour of what already existed.
     */
    legacyPrecedence = false,
  ): boolean => {
    if (!isFootprintClearOfCorridor(cx, cz, width, depth, yaw, 0.55)) return false;
    // The Town Hall Market envelope is authored (`townHall.ts`), so the generic
    // generator must not drop a block through it. This is the only deliberate
    // removal from the shipped 845-building world; the frontage walk keeps its
    // positions and draws, so a suppressed candidate costs exactly itself.
    if (isInTownHallSite(cx, cz)) return false;
    const candidate: PlacedFootprint = {
      x: cx, z: cz, halfX: width / 2, halfZ: depth / 2, yaw,
      radius: Math.hypot(width, depth) / 2,
    };
    // A 28 cm service joint is too narrow for a rickshaw, but still leaves
    // separate facades/rooflines. Public lanes, sidewalks, POIs and junctions
    // remain protected by the independent corridor and anchor checks above.
    const gx = Math.floor(cx / PARCEL_CELL), gz = Math.floor(cz / PARCEL_CELL);
    const reach = Math.ceil((candidate.radius + maxParcelRadius + 0.28) / PARCEL_CELL);
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const cell = parcelCells.get(parcelKey(gx + dx, gz + dz));
        if (cell && !cell.every((other) => {
          if (legacyPrecedence && other.legacy !== true) return true;
          return footprintSeparated(candidate, other, 0.28);
        })) return false;
      }
    }
    return true;
  };

  let signCursor = 0;
  for (const seg of canonicalSegments(ROAD_SEGMENTS)) {
    collectLegacyFootprints = isLegacyRoadSegment(seg.id);
    // Per-segment, id-seeded stream: building output no longer depends on how
    // many draws props/trees consumed, nor on how many segments precede this one.
    // See `src/world/buildingRng.ts`.
    const bRng = buildingRngFor(seg.id);
    // Walk the building frontage by ARC length: on a curved road a straight
    // walk would under-count, because the chord is shorter than the road.
    const arc = arcLengthOf(seg);
    for (const side of [-1, 1] as const) {
      let along = 9.5;
      let step = 0;
      while (along < arc - 9.5) {
        // --- Candidate identity, decided before anything is tested ----------
        //
        // Every draw this candidate will ever use is taken here, in the order
        // the accepted path has always taken them (width, depth, setback,
        // floors, tint, brick, commercial, gap). Placement is a pure filter
        // applied afterwards, so a rejected candidate can no longer shift its
        // neighbours' geometry *or* their randomness — the two couplings that
        // turned one road into 35 unexplained evictions
        // (docs/SYNTHETIC_ROAD_AUDIT.md).
        //
        // Shipped segments replay the accept/reject pattern they were generated
        // with (`frontageLayout.ts`), which also fixes the walk's step length.
        // A segment added later has no frozen pattern and is decided live; its
        // step length is still derived from its own width, never from the
        // outcome.
        const frozen = legacyFrontageDecision(seg.id, side, step);
        const bWidth = seg.kind === 'main' ? 9.5 + bRng() * 5.5 : 7.5 + bRng() * 4.5;
        const bDepth = 8.2 + bRng() * 4.4;
        const setback = seg.halfWidth + seg.sidewalk + bDepth * 0.5 + 0.95 + bRng() * 0.65;
        if (frozen === 'r') {
          // The shipped world left this lot empty (parcel contest, sector budget
          // or an authored anchor). Only 3 draws are consumed, exactly as the
          // original walk did, and the step keeps its 4.5 m retry length.
          along += 4.5;
          step++;
          continue;
        }
        const drawFloors = bRng();
        const drawTint = bRng();
        const drawBrick = bRng();
        // Commercial-ness is only rolled on residential galis: on any other
        // kind the original expression short-circuited before drawing, so
        // drawing unconditionally here would shift every later value.
        const drawCommercial = seg.kind === 'gali' ? bRng() : 1;
        const drawGap = bRng();
        // Step length is a property of the candidate, not of the outcome.
        const advance = bWidth + (drawGap < 0.88 ? 0.32 : 0.72);
        // Local polyline frame at this building's own centre. On a straight or
        // collinear segment this is bit-identical to the chord maths it replaces.
        // On a curve the building follows the road it actually fronts and its box
        // is rotated to the local tangent instead of to a line crossing it.
        const frame = placementAt(seg, along + bWidth * 0.5, setback * side);
        const cx = frame.x;
        const cz = frame.z;
        const yaw = frame.yaw;

        // Face normal pointing FROM building TOWARD the street: (-leftX * side, -leftZ * side)
        const faceYaw = Math.atan2(-frame.leftX * side, -frame.leftZ * side);

        if (!canPlaceBuilding(cx, cz, bDepth, bWidth, yaw)) {
          // Rejected now (a road added later covers this parcel): skip the
          // building, keep the walk and the stream exactly where they were.
          along += advance;
          step++;
          continue;
        }
        {
          addFootprint({
            x: cx, z: cz, halfX: bDepth / 2, halfZ: bWidth / 2, yaw,
            radius: Math.hypot(bDepth, bWidth) / 2,
          });

          const floors =
            seg.kind === 'main'
              ? 3 + Math.floor(drawFloors * 4) // 3..6 storeys on Asad Ave / Ring Rd
              : seg.kind === 'medium'
                ? 2 + Math.floor(drawFloors * 4) // 2..5 storeys on Tajmahal / Nurjahan / Sher Shah Suri
                : 2 + Math.floor(drawFloors * 3); // 2..4 storeys on residential galis
          const floorH = 3.05;
          const height = floors * floorH;
          const secIdx = sectorIndex(cx, cz);
          const bWall = sectorWalls[secIdx];
          const bDet = sectorDetails[secIdx];
          const bShut = sectorShutters[secIdx];
          const bBrk = sectorBricks[secIdx];
          const bSgn = sectorSigns[secIdx];
          const bPoster = sectorPosters[secIdx];

          const tint = PLASTER_TINTS[Math.floor(drawTint * PLASTER_TINTS.length)];
          const useBrick = drawBrick < 0.18;
          // Coordinate-derived style does not consume the seeded layout RNG:
          // building footprints, signs, stalls and navigation stay unchanged.
          const frontageStyle = Math.abs(Math.round(cx * 13 + cz * 7)) % 7;
          const windowShade = ['#20313b', '#334043', '#2b3733', '#34444b'][frontageStyle % 4];
          if (useBrick) {
            bBrk.box({ x: cx, y: height * 0.5, z: cz }, { x: bDepth, y: height, z: bWidth }, '#d8b8a8', {
              y: yaw,
            });
          } else {
            bWall.box({ x: cx, y: height * 0.5, z: cz }, { x: bDepth, y: height, z: bWidth }, tint, {
              y: yaw,
            });
          }

          // Grounded concrete foundation plinth + shopfront entrance apron bridging onto footpath!
          const fx = -frame.leftX * side;
          const fz = -frame.leftZ * side;
          bDet.box(
            { x: cx + fx * 0.55, y: 0.13, z: cz + fz * 0.55 },
            { x: bDepth + 1.35, y: 0.26, z: bWidth + 0.28 },
            '#7d776c',
            { y: yaw },
          );

          // 4-sided concrete floor-slab stringcourses (`ছাদের কার্নিশ`) & side-wall windows + sunshades!
          const sideYawL = Math.atan2(frame.ux, frame.uz);
          const sideYawR = Math.atan2(-frame.ux, -frame.uz);
          for (let fl = 1; fl <= floors; fl++) {
            const slabY = fl * floorH;
            bDet.box(
              { x: cx, y: slabY, z: cz },
              { x: bDepth + 0.18, y: 0.12, z: bWidth + 0.18 },
              '#b8b0a2',
              { y: yaw },
            );
            if (fl < floors) {
              const winY = fl * floorH + 1.48;
              for (const sDir of [-1, 1] as const) {
                const wx = cx + frame.ux * (bWidth * 0.5 + 0.03) * sDir;
                const wz = cz + frame.uz * (bWidth * 0.5 + 0.03) * sDir;
                const sYaw = sDir === 1 ? sideYawL : sideYawR;
                for (const dOff of [-bDepth * 0.24, bDepth * 0.24]) {
                  const ox = wx - fx * dOff;
                  const oz = wz - fz * dOff;
                  bDet.box({ x: ox, y: winY, z: oz }, { x: 1.18, y: 1.12, z: 0.06 }, windowShade, { y: sYaw });
                  litWindow(secIdx, ox + frame.ux * 0.075 * sDir, winY,
                    oz + frame.uz * 0.075 * sDir, sYaw, 0.96, 0.88);
                  bDet.box(
                    { x: ox + frame.ux * 0.18 * sDir, y: winY + 0.62, z: oz + frame.uz * 0.18 * sDir },
                    { x: 1.42, y: 0.08, z: 0.42 },
                    '#9a9386',
                    { y: sYaw },
                  );
                }
              }
            }
          }

          // Previously blank ground-floor side walls now have service doors,
          // ventilation grilles and drain downpipes; all remain inside the OBB.
          if (bWidth > 8.5) {
            for (const sideDir of [-1, 1] as const) {
              const sideX = cx + frame.ux * (bWidth * 0.5 + 0.025) * sideDir;
              const sideZ = cz + frame.uz * (bWidth * 0.5 + 0.025) * sideDir;
              const sideFace = sideDir === 1 ? sideYawL : sideYawR;
              bShut.quad({ x: sideX - fx * 1.35, y: 1.15, z: sideZ - fz * 1.35 },
                1.55, 2.1, '#4d5b59', { y: sideFace });
              bDet.box({ x: sideX + fx * 0.9, y: 2.0, z: sideZ + fz * 0.9 },
                { x: 0.84, y: 0.45, z: 0.08 }, '#41525a', { y: sideFace });
              bDet.cylinder({ x: sideX + fx * 2.2, y: height * 0.46,
                z: sideZ + fz * 2.2 }, 0.035, height * 0.89, '#5c6260');
              if (sideDir === 1 && (frontageStyle === 0 || frontageStyle === 4) &&
                  bDepth >= 9 && educationPosterCount < 28) {
                const design = (Math.abs(Math.round(cx * 7 + cz * 13)) % 2);
                const w = design === 0 ? 1.78 : 2.05;
                const h = design === 0 ? 2.53 : 2.05;
                const px = sideX - fx * 3.35 + frame.ux * 0.065;
                const pz = sideZ - fz * 3.35 + frame.uz * 0.065;
                bDet.box({ x: px - frame.ux * 0.018, y: 1.63, z: pz - frame.uz * 0.018 },
                  { x: w + 0.09, y: h + 0.09, z: 0.028 }, '#eee9db', { y: sideYawL });
                sectorEducation[secIdx].quad({ x: px, y: 1.63, z: pz },
                  w, h, '#ffffff', { y: sideYawL }, EDUCATION_POSTERS[design]);
                educationPosterCount++;
              }
              if (sideDir === 1 && frontageStyle === 0 && posterCount < 90) {
                const posterX = sideX - fx * 2.7 + frame.ux * 0.045;
                const posterZ = sideZ - fz * 2.7 + frame.uz * 0.045;
                const design = Math.abs(Math.round(cx * 7 + cz * 11));
                // One in eleven printed notices is non-partisan civic/election
                // information; most are education, markets and cleanliness.
                bPoster.quad({ x: posterX, y: 1.68, z: posterZ },
                  0.72, 1.05, '#ffffff', { y: sideYawL },
                  posterAtlas.poster(design % 11 === 0 ? 3 : design % 3));
                posterCount++;
              }
            }
          }

          // Rooftop parapet wall + black Gazi plastic water tank + concrete stairhead room (`চিলেকোঠা`)
          bDet.box(
            { x: cx, y: height + 0.42, z: cz },
            { x: bDepth + 0.24, y: 0.84, z: bWidth + 0.24 },
            tint,
            { y: yaw },
          );
          const tankX = cx - fx * (1.1 + frontageStyle * 0.11);
          const tankZ = cz - fz * (1.1 + frontageStyle * 0.11);
          bDet.cylinder(
            { x: tankX, y: height + 1.05, z: tankZ },
            frontageStyle % 3 === 0 ? 0.64 : 0.72,
            1.45,
            frontageStyle % 4 === 0 ? '#253b3b' : '#1d2228',
          );
          if (floors >= 3) {
            bDet.box(
              { x: cx + frame.ux * 1.5, y: height + 1.25, z: cz + frame.uz * 1.5 },
              { x: 2.6, y: 2.5, z: 2.8 },
              tint,
              { y: yaw },
            );
          }

          // A few framed rooftop boards: no roadside poles in traffic, no
          // floating sign planes. All hardware is merged into sector details.
          if (floors >= 3 && billboardCount < 8 &&
              Math.abs(Math.round(cx * 3 + cz * 2)) % 31 === 0) {
            const bx = cx + fx * (bDepth * 0.5 - 1.05);
            const bz = cz + fz * (bDepth * 0.5 - 1.05);
            bDet.box({ x: bx, y: height + 2.03, z: bz },
              { x: 4.08, y: 1.82, z: 0.09 }, '#36454a', { y: faceYaw });
            bPoster.quad({ x: bx + fx * 0.055, y: height + 2.03, z: bz + fz * 0.055 },
              3.84, 1.60, '#ffffff', { y: faceYaw }, posterAtlas.billboard(billboardCount));
            for (const side of [-1, 1]) {
              bDet.box({ x: bx + frame.ux * side * 1.42 - fx * 0.06,
                y: height + 0.85, z: bz + frame.uz * side * 1.42 - fz * 0.06 },
                { x: 0.10, y: 1.55, z: 0.11 }, '#525652', { y: faceYaw });
            }
            billboardCount++;
          }

          // Street-facing facade details: ground-floor Dokan shutters + pilasters, striped awning, Bangla signboard & upper balconies!
          const frontX = cx + fx * (bDepth * 0.5 + 0.04);
          const frontZ = cz + fz * (bDepth * 0.5 + 0.04);
          // Intermittent limewash edge and rain-stained sill distinguish the
          // otherwise uniform upper blocks. Both join the sector detail mesh.
          if (!useBrick && (frontageStyle === 2 || frontageStyle === 6)) {
            bDet.box({ x: frontX + frame.ux * (bWidth * 0.45) + fx * 0.035,
              y: height * 0.54, z: frontZ + frame.uz * (bWidth * 0.45) + fz * 0.035 },
              { x: 0.19, y: height * 0.76, z: 0.045 },
              frontageStyle === 2 ? '#aeb6a3' : '#ada99b', { y: faceYaw });
          }

          const isCommercial = seg.kind !== 'gali' || drawCommercial < 0.45;
          // A few occupied shops stay warm at dusk; the pane and small ground
          // spill join the existing sector light mesh (zero real-time lights).
          if (isCommercial && frontageStyle === 0 && bWidth > 9) {
            sectorWindowLights[secIdx].quad(
              { x: frontX + fx * .105, y: 1.56, z: frontZ + fz * .105 },
              1.32, 1.28, '#e3a96c', { y: faceYaw });
            sectorWindowLights[secIdx].quad(
              { x: frontX + fx * .58, y: .102, z: frontZ + fz * .58 },
              1.45, .95, '#8b6744', { x: -Math.PI / 2, y: faceYaw });
          }
          if (isCommercial) {
            const shopBays = Math.max(1, Math.floor(bWidth / 3.8));
            for (let sb = 0; sb < shopBays; sb++) {
              const bayOff = -((shopBays - 1) * 0.5) * 3.4 + sb * 3.4;
              const sx = frontX + frame.ux * bayOff;
              const sz = frontZ + frame.uz * bayOff;
              const isGrocery = sb === 0 && [1, 3, 4, 5].includes(frontageStyle);
              if ((frontageStyle === 1 || frontageStyle === 4) && sb === 0) {
                // Busy mudi dokan: dark recessed shelves, pale rice/lentil sacks,
                // packaged goods and a timber counter, merged with facade
                // details. No new collision volume or actor update.
                bDet.box({ x: sx + fx * 0.045, y: 1.43, z: sz + fz * 0.045 },
                  { x: 2.64, y: 2.54, z: 0.035 }, '#263632', { y: faceYaw });
                for (const shelfY of [0.68, 1.30, 1.94]) {
                  bDet.box({ x: sx + fx * 0.13, y: shelfY, z: sz + fz * 0.13 },
                    { x: 2.35, y: 0.075, z: 0.24 }, '#76533c', { y: faceYaw });
                  for (let item = -2; item <= 2; item++) {
                    const color = ['#c69f56', '#e3c681', '#6d965f', '#be7141', '#b6a880'][item + 2];
                    bDet.box({ x: sx + frame.ux * item * 0.43 + fx * 0.19,
                      y: shelfY + 0.18, z: sz + frame.uz * item * 0.43 + fz * 0.19 },
                      { x: 0.31, y: 0.27, z: 0.13 }, color, { y: faceYaw });
                  }
                }
                bDet.box({ x: sx + fx * 0.30, y: 0.66, z: sz + fz * 0.30 },
                  { x: 1.65, y: 0.15, z: 0.42 }, '#8b603e', { y: faceYaw });
                for (const end of [-1, 1]) {
                  bDet.box({ x: sx + frame.ux * end * 0.94 + fx * 0.20,
                    y: 0.35, z: sz + frame.uz * end * 0.94 + fz * 0.20 },
                    { x: 0.40, y: 0.56, z: 0.25 }, '#c0a16e', { y: faceYaw });
                }
              } else if ((frontageStyle === 3 || frontageStyle === 5) && sb === 0) {
                // Two occupied dokan variants: shaded entrance, inset jambs and
                // a low counter. All detail stays on the building side of the
                // established facade/collider, never on the footpath.
                bDet.box({ x: sx + fx * 0.07, y: 1.42, z: sz + fz * 0.07 },
                  { x: 2.65, y: 2.55, z: 0.035 }, '#263137', { y: faceYaw });
                for (const edge of [-1, 1] as const) {
                  bDet.box({ x: sx + frame.ux * edge * 1.26 + fx * 0.11, y: 1.45,
                    z: sz + frame.uz * edge * 1.26 + fz * 0.11 },
                    { x: 0.11, y: 2.65, z: 0.12 }, '#796f60', { y: faceYaw });
                }
                bDet.box({ x: sx + fx * 0.15, y: 0.82, z: sz + fz * 0.15 },
                  { x: 2.1, y: 0.12, z: 0.38 }, '#715039', { y: faceYaw });
                bDet.box({ x: sx + fx * 0.10, y: 0.37, z: sz + fz * 0.10 },
                  { x: 2.0, y: 0.65, z: 0.07 }, '#554134', { y: faceYaw });
                // Visible shelves and folded cloth keep the dark entrance from
                // reading as an empty black hole at pavement eye level.
                for (const shelfY of [1.42, 2.12]) {
                  bDet.box({ x: sx + fx * 0.115, y: shelfY, z: sz + fz * 0.115 },
                    { x: 1.86, y: 0.07, z: 0.13 }, '#8a6548', { y: faceYaw });
                }
                for (let bundle = -1; bundle <= 1; bundle++) {
                  bDet.box({ x: sx + frame.ux * bundle * 0.52 + fx * 0.12,
                    y: 1.66, z: sz + frame.uz * bundle * 0.52 + fz * 0.12 },
                    { x: 0.38, y: 0.31, z: 0.09 },
                    frontageStyle === 5
                      ? ['#b99452', '#637948', '#91775c'][bundle + 1]
                      : ['#ad6d42', '#5e8269', '#c6a67a'][bundle + 1], { y: faceYaw });
                }
                if (frontageStyle === 5) {
                  // Produce sacks and a shallow street-facing display shelf;
                  // no change to footprint/collision or sidewalk clearance.
                  for (let sack = -1; sack <= 1; sack++) {
                    bDet.box({ x: sx + frame.ux * sack * 0.53 + fx * 0.23,
                      y: 0.43, z: sz + frame.uz * sack * 0.53 + fz * 0.23 },
                      { x: 0.38, y: 0.38, z: 0.24 },
                      ['#b69a72', '#9b8565', '#b7a180'][sack + 1], { y: faceYaw });
                  }
                }
              } else if (frontageStyle === 2 && sb === 0) {
                // Half-raised shutter reveals a low goods counter instead of
                // another fully locked frontage. No actual indoor navigation.
                bDet.box({ x: sx + fx * 0.075, y: 1.01, z: sz + fz * 0.075 },
                  { x: 2.65, y: 1.65, z: 0.035 }, '#34403c', { y: faceYaw });
                bShut.quad({ x: sx + fx * 0.09, y: 2.22, z: sz + fz * 0.09 },
                  2.65, 0.96, SHUTTER_TINTS[frontageStyle], { y: faceYaw });
                bDet.box({ x: sx + fx * 0.13, y: 0.67, z: sz + fz * 0.13 },
                  { x: 1.97, y: 0.80, z: 0.27 }, '#77573d', { y: faceYaw });
                for (let item = -1; item <= 1; item++) {
                  bDet.box({ x: sx + frame.ux * item * 0.48 + fx * 0.23,
                    y: 1.16, z: sz + frame.uz * item * 0.48 + fz * 0.23 },
                    { x: 0.30, y: 0.21, z: 0.20 },
                    ['#b08e61', '#7d8a69', '#bd9971'][item + 1], { y: faceYaw });
                }
              } else {
                bShut.quad({ x: sx, y: 1.42, z: sz }, 2.65, 2.55,
                  SHUTTER_TINTS[frontageStyle], { y: faceYaw });
              }
              if (isGrocery) {
                groceryCount++;
                // Hanging strips of crimped snack packets just beyond the
                // shopfront, under the existing canopy. Small two-triangle
                // packets are batched across the district: 0 shadow casters,
                // 0 per-packet draw calls, no animated texture or collider.
                bDet.box({ x: sx + fx * 0.32, y: 2.39, z: sz + fz * 0.32 },
                  { x: 2.30, y: 0.027, z: 0.025 }, '#5e4d39', { y: faceYaw });
                for (let string = -1; string <= 1; string++) {
                  const off = string * 0.77;
                  bDet.box({ x: sx + frame.ux * off + fx * 0.33,
                    y: 1.86, z: sz + frame.uz * off + fz * 0.33 },
                    { x: 0.014, y: 1.05, z: 0.014 }, '#d3c3a3');
                  for (let packet = 0; packet < 3; packet++) {
                    const px = sx + frame.ux * off + fx * 0.36;
                    const pz = sz + frame.uz * off + fz * 0.36;
                    sectorSnacks[secIdx].quad(
                      { x: px, y: 2.16 - packet * 0.37, z: pz },
                      0.32, 0.34, '#ffffff', { y: faceYaw },
                      snackAtlas.slots[(groceryCount + string + packet + 4) % 4]);
                  }
                }
              }
              // Vertical shopfront concrete pilaster beside shutter bay
              bDet.box(
                { x: sx + frame.ux * 1.48, y: 1.45, z: sz + frame.uz * 1.48 },
                { x: 0.24, y: 2.65, z: 0.18 },
                '#9e9688',
                { y: faceYaw },
              );
            }
            // Colourful Bangla shop signboard from SignAtlas!
            const slot = signAtlas.slot(signCursor++);
            bSgn.quad(
              { x: frontX + fx * 0.06, y: 3.15, z: frontZ + fz * 0.06 },
              Math.min(bWidth * 0.78, 5.4),
              1.05,
              '#ffffff',
              { y: faceYaw },
              slot,
            );
            signAnchors.push(new THREE.Vector3(frontX, 3.15, frontZ));

            // Slanted shopfront sun/rain awning
            const awningCol = AWNING_COLORS[signCursor % AWNING_COLORS.length];
            bDet.box(
              { x: frontX + fx * 0.52, y: 2.68, z: frontZ + fz * 0.52 },
              { x: Math.min(bWidth * 0.84, 6.2), y: 0.08, z: 1.05 },
              awningCol,
              { y: faceYaw, x: 0.28 },
            );
          } else {
            // Residential iron boundary gate + masonry pillars
            bShut.quad({ x: frontX, y: 1.25, z: frontZ }, 2.8, 2.3, '#2d3b42', { y: faceYaw });
            // Road-facing editions remain visible from the rickshaw, not only
            // from narrow party-wall alleys. Keep the actual gate/sign legible.
            if (bWidth >= 10 && frontageStyle % 2 === 0 && educationPosterCount < 55) {
              const design = educationPosterCount % 2;
              const w = design === 0 ? 1.72 : 1.95;
              const h = design === 0 ? 2.44 : 1.95;
              const px = frontX + frame.ux * 3.7 + fx * 0.075;
              const pz = frontZ + frame.uz * 3.7 + fz * 0.075;
              bDet.box({ x: px - fx * 0.018, y: 1.58, z: pz - fz * 0.018 },
                { x: w + 0.09, y: h + 0.09, z: 0.028 }, '#e7e2d5', { y: faceYaw });
              sectorEducation[secIdx].quad({ x: px, y: 1.58, z: pz },
                w, h, '#ffffff', { y: faceYaw }, EDUCATION_POSTERS[design]);
              educationPosterCount++;
            }
            for (const pDir of [-1.55, 1.55]) {
              bDet.box(
                { x: frontX + frame.ux * pDir, y: 1.32, z: frontZ + frame.uz * pDir },
                { x: 0.32, y: 2.55, z: 0.28 },
                '#8f8779',
                { y: faceYaw },
              );
            }
          }

          // Projecting Bangladeshi apartment balconies (`বারান্দা`) + sliding glass doors + planters + split AC units
          for (let fl = 1; fl < floors; fl++) {
            const by = fl * floorH + 0.55;
            const balW = Math.min(bWidth * 0.72, 5.8);
            const railCol = fl % 2 === 0 ? '#3d5a52' : '#4a4e54';
            bDet.box(
              { x: frontX + fx * 0.42, y: by - 0.38, z: frontZ + fz * 0.42 },
              { x: balW, y: 0.14, z: 0.88 },
              '#8a8478',
              { y: faceYaw },
            );
            if (frontageStyle === 1 || (frontageStyle === 6 && fl % 2 === 1)) {
              // Iron railings on old balconies, with occasional open upper
              // galleries. Everything stays in the existing detail bucket.
              for (const railY of [by - 0.25, by + 0.42]) {
                bDet.box({ x: frontX + fx * 0.82, y: railY, z: frontZ + fz * 0.82 },
                  { x: balW, y: 0.065, z: 0.065 }, railCol, { y: faceYaw });
              }
              const bars = frontageStyle === 1 ? 2 : 1;
              for (let bar = -bars; bar <= bars; bar++) {
                bDet.box({ x: frontX + fx * 0.82 + frame.ux * (balW * bar / (bars + 3)),
                  y: by + 0.08, z: frontZ + fz * 0.82 + frame.uz * (balW * bar / (bars + 3)) },
                  { x: 0.045, y: 0.72, z: 0.06 }, '#676963', { y: faceYaw });
              }
            } else if (seg.kind !== 'gali' && (frontageStyle === 2 || frontageStyle === 5)) {
              // Mixed concrete/iron balustrade, selected visible frontages only.
              bDet.box({ x: frontX + fx * 0.82, y: by - 0.08, z: frontZ + fz * 0.82 },
                { x: balW, y: 0.48, z: 0.07 }, railCol, { y: faceYaw });
              bDet.box({ x: frontX + fx * 0.82, y: by + 0.46, z: frontZ + fz * 0.82 },
                { x: balW, y: 0.055, z: 0.065 }, '#545d58', { y: faceYaw });
              for (let bar = -2; bar <= 2; bar++) {
                bDet.box({ x: frontX + fx * 0.82 + frame.ux * balW * bar / 6,
                  y: by + 0.29, z: frontZ + fz * 0.82 + frame.uz * balW * bar / 6 },
                  { x: 0.045, y: 0.35, z: 0.05 }, '#545d58', { y: faceYaw });
              }
            } else {
              bDet.box(
                { x: frontX + fx * 0.82, y: by + 0.08, z: frontZ + fz * 0.82 },
                { x: balW, y: 0.82, z: 0.06 }, railCol, { y: faceYaw });
            }
            // Balcony side-return grilles + recessed dark balcony doorway + top sunshade canopy
            for (const bSide of [-1, 1] as const) {
              bDet.box(
                {
                  x: frontX + fx * 0.42 + frame.ux * (balW * 0.49) * bSide,
                  y: by + 0.08,
                  z: frontZ + fz * 0.42 + frame.uz * (balW * 0.49) * bSide,
                },
                { x: 0.06, y: 0.82, z: 0.84 },
                railCol,
                { y: faceYaw },
              );
            }
            bDet.box(
              { x: frontX + fx * 0.03, y: by + 0.62, z: frontZ + fz * 0.03 },
              { x: Math.min(balW * 0.52, 2.4), y: 1.85, z: 0.06 },
              windowShade,
              { y: faceYaw },
            );
            // One sliding-door mullion breaks the large unlit dark rectangles
            // without introducing transparent glass or per-window objects.
            bDet.box({ x: frontX + fx * 0.078 + frame.ux * (frontageStyle === 4 ? 0.36 : -0.12),
              y: by + 0.62,
              z: frontZ + fz * 0.078 + frame.uz * (frontageStyle === 4 ? 0.36 : -0.12) },
              { x: 0.045, y: 1.85, z: 0.045 },
              frontageStyle === 4 ? '#b0a99a' : '#738180', { y: faceYaw });
            // A single faded cloth panel on occasional balconies suggests an
            // occupied home without glass transparency or extra texture passes.
            if ((frontageStyle === 0 || frontageStyle === 5) && fl % 2 === 1) {
              bDet.quad({ x: frontX + fx * 0.098 + frame.ux * 0.41,
                y: by + 0.69, z: frontZ + fz * 0.098 + frame.uz * 0.41 },
                0.70, 1.55, frontageStyle === 0 ? '#b6a888' : '#839d94',
                { y: faceYaw });
            }
            if (frontageStyle === 2 && fl % 2 === 0) {
              bDet.box({ x: frontX + fx * 0.84, y: by + 0.40,
                z: frontZ + fz * 0.84 },
                { x: balW * 0.92, y: 0.045, z: 0.045 }, '#b0a68c', { y: faceYaw });
            }
            litWindow(secIdx, frontX + fx * 0.1, by + 1.0,
              frontZ + fz * 0.1, faceYaw, Math.min(balW * 0.38, 1.55), 0.85);
            // On wider street-facing floors the narrow bay beside the balcony
            // gets a framed two-pane window. Keep it clear of the AC on the
            // opposite side; skip narrow plots and all interior/side faces.
            if (bWidth >= 9.7 && seg.kind !== 'gali' && (fl + frontageStyle) % 2 === 0) {
              const wx = frontX - frame.ux * (balW * 0.5 + 0.88);
              const wz = frontZ - frame.uz * (balW * 0.5 + 0.88);
              const wy = by + 0.86;
              bDet.box({ x: wx + fx * 0.065, y: wy, z: wz + fz * 0.065 },
                { x: 1.30, y: 1.24, z: 0.028 }, '#2e3d42', { y: faceYaw });
              for (const edge of [-1, 1]) {
                bDet.box({ x: wx + fx * 0.09 + frame.ux * edge * 0.65, y: wy,
                  z: wz + fz * 0.09 + frame.uz * edge * 0.65 },
                  { x: 0.055, y: 1.30, z: 0.07 }, '#a29c8d', { y: faceYaw });
              }
              bDet.box({ x: wx + fx * 0.095, y: wy - 0.65, z: wz + fz * 0.095 },
                { x: 1.52, y: 0.09, z: 0.19 }, '#a49d90', { y: faceYaw });
              bDet.box({ x: wx + fx * 0.09, y: wy + 0.65, z: wz + fz * 0.09 },
                { x: 1.38, y: 0.065, z: 0.13 }, '#b9b1a2', { y: faceYaw });
              bDet.box({ x: wx + fx * 0.105, y: wy, z: wz + fz * 0.105 },
                { x: 0.035, y: 1.21, z: 0.045 }, '#a4aaa2', { y: faceYaw });
              if (frontageStyle % 2 === 0) {
                bDet.quad({ x: wx + fx * 0.112 - frame.ux * 0.32, y: wy,
                  z: wz + fz * 0.112 - frame.uz * 0.32 },
                  0.47, 1.09, '#8c938b', { y: faceYaw });
              }
              litWindow(secIdx, wx + fx * 0.116, wy, wz + fz * 0.116,
                faceYaw, 0.48, 0.98);
            }
            if ((fl + secIdx) % 3 === 0) {
              // Terracotta balcony planter pot + greenery
              bDet.cylinder(
                { x: frontX + fx * 0.64 - frame.ux * (balW * 0.32), y: by - 0.16, z: frontZ + fz * 0.64 - frame.uz * (balW * 0.32) },
                0.16,
                0.26,
                '#9c4a2d',
              );
              bDet.cone(
                { x: frontX + fx * 0.64 - frame.ux * (balW * 0.32), y: by + 0.12, z: frontZ + fz * 0.64 - frame.uz * (balW * 0.32) },
                0.24,
                0.38,
                '#2f6f3e',
              );
            }
            // A few older plaster facades show short rain-stained seams below
            // the cornice; keep them high, matte and off shop signs/windows.
            if (frontageStyle === 0 && fl % 2 === 1 && !useBrick) {
              bDet.box({ x: frontX + frame.ux * (bWidth * 0.43) + fx * 0.075,
                y: by + 1.15, z: frontZ + frame.uz * (bWidth * 0.43) + fz * 0.075 },
                { x: 0.18, y: 0.92, z: 0.016 }, '#aca596', { y: faceYaw });
            }
            // Wall-mounted outdoor split AC: painted casing, inset dark fan
            // grille, radial blades, louvers, bracket and copper drain line.
            // Everything joins the existing sector detail mesh (no new pass).
            if ((fl + secIdx) % 2 === 0) {
              const ax = frontX + frame.ux * (bWidth * 0.38) + fx * 0.22;
              const az = frontZ + frame.uz * (bWidth * 0.38) + fz * 0.22;
              const ay = by + 0.9;
              bDet.box({ x: ax, y: ay, z: az }, { x: 0.78, y: 0.54, z: 0.34 }, '#d8dedb', { y: faceYaw });
              bDet.box({ x: ax + fx * 0.177, y: ay, z: az + fz * 0.177 },
                { x: 0.62, y: 0.39, z: 0.013 }, '#3a4b4f', { y: faceYaw });
              // Alternating louvers read as a real condenser even at chase FOV.
              for (let vent = -2; vent <= 2; vent++) {
                bDet.box({ x: ax + fx * 0.188, y: ay + vent * 0.063, z: az + fz * 0.188 },
                  { x: 0.58, y: 0.017, z: 0.012 }, '#a8b4ad', { y: faceYaw });
              }
              bDet.cylinder({ x: ax + fx * 0.199, y: ay, z: az + fz * 0.199 },
                0.115, 0.012, '#293b3d', { x: Math.PI / 2, y: faceYaw });
              for (let blade = 0; blade < 3; blade++) {
                bDet.box({ x: ax + fx * 0.213, y: ay, z: az + fz * 0.213 },
                  { x: 0.20, y: 0.024, z: 0.014 }, '#bdc8bf',
                  { y: faceYaw, z: blade * Math.PI / 3 });
              }
              for (const side of [-1, 1]) {
                bDet.box({ x: ax + frame.ux * side * 0.26 - fx * 0.035,
                  y: ay - 0.31, z: az + frame.uz * side * 0.26 - fz * 0.035 },
                  { x: 0.08, y: 0.09, z: 0.24 }, '#687675', { y: faceYaw });
              }
              bDet.box({ x: ax + frame.ux * 0.43 - fx * 0.16, y: ay - 0.22,
                z: az + frame.uz * 0.43 - fz * 0.16 },
                { x: 0.035, y: 0.44, z: 0.035 }, '#997657');
            }
          }

          // Oriented bounding box (OBB) matching exact rotated building footprint
          // + tight AABB envelope for spatial grid broad-phase (zero road/sidewalk air jutting!).
          const cosA = Math.abs(Math.cos(yaw));
          const sinA = Math.abs(Math.sin(yaw));
          const obbHalfX = bDepth * 0.5;
          const obbHalfZ = bWidth * 0.5;
          const envHalfX = obbHalfX * cosA + obbHalfZ * sinA;
          const envHalfZ = obbHalfX * sinA + obbHalfZ * cosA;
          colliders.push({
            minX: cx - envHalfX,
            maxX: cx + envHalfX,
            minZ: cz - envHalfZ,
            maxZ: cz + envHalfZ,
            height,
            cameraBlocking: true,
            kind: 'building',
            cx,
            cz,
            halfX: obbHalfX,
            halfZ: obbHalfZ,
            yaw,
          });

        }
        // One advance for both outcomes: whether this candidate was placed
        // cannot move the next one.
        along += advance;
        step++;
      }
    }
  }

  // Slender infill where the primary apartment pass left an actual empty lot.
  // The same oriented-footprint/road-corridor checks protect driving width.
  // One ledger per build. Created here because three passes consult it: the two
  // infill passes and the block-interior region phase.
  const regionBudgetLedger = new RegionBudgetLedger();
  const legacySegments = canonicalSegments(ROAD_SEGMENTS).filter((sg) => isLegacyRoadSegment(sg.id));
  const newSegments = canonicalSegments(ROAD_SEGMENTS).filter((sg) => !isLegacyRoadSegment(sg.id));
  let infillCount = 0;
  const infillBySector = new Uint8Array(SECTOR_COUNT);
  for (const seg of canonicalSegments(ROAD_SEGMENTS)) {
    collectLegacyFootprints = isLegacyRoadSegment(seg.id);
    if (infillCount >= 112) break;
    const arc = arcLengthOf(seg);
    for (const side of [-1, 1] as const) {
      for (let along = 9.5; along < arc - 9.5 && infillCount < 112; along += 5.2) {
        const width = 4.55, depth = 6.4;
        const frontDist = seg.halfWidth + seg.sidewalk + 1.0;
        // Local polyline frame; identical on straight and collinear segments.
        const frame = placementAt(seg, along, (frontDist + depth / 2) * side);
        const cx = frame.x;
        const cz = frame.z;
        const yaw = frame.yaw;
        // Region fill comes only from a *new* road, and only outside the shipped
        // extent. An unfrozen candidate along a shipped road is a lot the
        // shipped world left empty (sector budget, count cap, or a rejected
        // overlap) and must stay empty, or fill would occupy parcels the
        // shipped passes resolve later and evict shipped buildings (measured:
        // 3 of 845 before this rule, `docs/REGIONAL_FILL.md` §7.1).
        if (legacyInfillOrdinal(cx, cz) === undefined &&
            (isLegacyRoadSegment(seg.id) || insideShippedExtent(cx, cz))) continue;
        if (!canPlaceBuilding(cx, cz, depth, width, yaw)) continue;
        const sec = sectorIndex(cx, cz);
        // Distribute the frontage pass across the city instead of consuming
        // the whole budget on the first long road's empty parcels.
        if (infillBySector[sec] >= 8) continue;
        const faceX = -frame.leftX * side, faceZ = -frame.leftZ * side;
        const frontX = cx + faceX * (depth / 2 + 0.025);
        const frontZ = cz + faceZ * (depth / 2 + 0.025);
        const faceYaw = Math.atan2(faceX, faceZ);
        // Frozen ordinal for the shipped world; a new road's frontage derives its
        // own ordinal from position and spends a per-region budget, so it can
        // neither take a legacy lot nor exhaust another region's allowance.
        const legacyOrdA = legacyInfillOrdinal(cx, cz);
        const isLegacyA = legacyOrdA !== undefined;
        const ord = isLegacyA ? (legacyOrdA as number) : derivedFillOrdinal(cx, cz);
        if (!isLegacyA) {
          if (!regionBudgetLedger.tryConsume(regionKeyOf(cx, cz))) continue;
          collectLegacyFootprints = false;
        } else {
          collectLegacyFootprints = true;
        }
        const tint = PLASTER_TINTS[(ord * 3 + sec) % PLASTER_TINTS.length];
        const floors = (ord + sec) % 3 === 0 ? 3 : 2;
        const height = floors * 3.1;
        sectorWalls[sec].box({ x: cx, y: height / 2, z: cz }, { x: depth, y: height, z: width }, tint, { y: yaw });
        sectorDetails[sec].box({ x: cx, y: height + 0.08, z: cz }, { x: depth + 0.15, y: 0.16, z: width + 0.15 }, '#9d9888', { y: yaw });
        sectorShutters[sec].quad({ x: frontX, y: 1.28, z: frontZ }, 3.1, 2.5, '#a4aeb4', { y: faceYaw });
        for (let fl = 1; fl < floors; fl++) {
          const wy = fl * 3.1 + 1.7;
          sectorDetails[sec].box({ x: frontX + faceX * 0.18, y: wy,
            z: frontZ + faceZ * 0.18 }, { x: 1.7, y: 1.15, z: 0.10 }, '#213940', { y: faceYaw });
          litWindow(sec, frontX + faceX * 0.26, wy,
            frontZ + faceZ * 0.26, faceYaw, 1.35, 0.9);
        }
        sectorSigns[sec].quad({ x: frontX + faceX * 0.06, y: 3.17, z: frontZ + faceZ * 0.06 },
          3.4, 0.72, '#ffffff', { y: faceYaw }, signAtlas.slot(signCursor++));
        addFootprint({ x: cx, z: cz, halfX: depth / 2, halfZ: width / 2,
          yaw, radius: Math.hypot(depth, width) / 2 });
        const ex = Math.abs(Math.cos(yaw)) * depth / 2 + Math.abs(Math.sin(yaw)) * width / 2;
        const ez = Math.abs(Math.sin(yaw)) * depth / 2 + Math.abs(Math.cos(yaw)) * width / 2;
        colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez,
          height, cameraBlocking: true, kind: 'building', cx, cz,
          halfX: depth / 2, halfZ: width / 2, yaw });
        infillCount++;
        infillBySector[sec]++;
      }
    }
  }

  // Complete block interiors, not just the first ring of road-facing boxes.
  // These are compact, occupied *game-layout* parcels derived from the existing
  // public road graph, never inferred real-world property lines. The same SAT
  // footprint and sidewalk clearance as the main buildings keeps junctions,
  // vendor courts, missions and vehicle lanes free. Sector budgets bound cost.
  let interiorCount = 0;
  const interiorBySector = new Uint8Array(SECTOR_COUNT);

  // Every interior candidate comes from the frozen legacy list, so its footprint
  // is legacy by construction. Set this explicitly: the flag is otherwise left
  // holding whatever the last infill segment set, which after a new road would be
  // `false` and would let a later pass evict these buildings.
  collectLegacyFootprints = true;
  // `regionFill` marks a candidate produced by the extension grid, i.e. one the
  // shipped world never considered. Candidates *inside* the legacy box that the
  // shipped world happened to leave unused also lack a frozen ordinal, but they
  // must stay unused — giving them region budgets would add buildings to the
  // shipped city (measured: +135 before this flag existed).
  const interiorCandidates: Array<{ x: number; z: number; sec: number; order: number; regionFill: boolean }> = [];
  for (let gz = -224; gz <= 224; gz += 11.8) {
    for (let gx = -224; gx <= 224; gx += 11.8) {
      const x = gx + (Math.floor((gz + 224) / 11.8) % 2 ? 3.1 : 0);
      const z = gz + ((Math.floor((gx + 224) / 11.8) % 3) - 1) * 1.6;
      const roadDistance = distanceToRoadCorridor(x, z);
      if (roadDistance < 2.2 || roadDistance > 43 ||
          PLACES.some((place) => Math.hypot(x - place.x, z - place.z) < 16) ||
          GRAPH_NODES.some((node) => Math.hypot(x - node.x, z - node.z) < node.outerRadius + 7)) continue;
      // Spatially shuffled once at build, not front-loaded into the first row
      // of each sector. Adjacent block interiors and the former vacant site
      // receive comparable attention without special-casing a landmark.
      const tie = (Math.imul(Math.round(x * 4), 73856093) ^
        Math.imul(Math.round(z * 4), 19349663)) >>> 0;
      const gap = legacyPlacedBuildings.reduce((d, b) =>
        Math.min(d, Math.hypot(x - b.x, z - b.z) - b.radius), 50);
      // Fill the actual largest unexplained voids first; jitter breaks ties
      // without turning the city into a regular checkerboard of identical lots.
      interiorCandidates.push({ x, z, sec: sectorIndex(x, z), order: -gap + tie / 4294967296, regionFill: false });
    }
  }

  // Region-fill candidate grid for areas the shipped world never covered.
  //
  // The legacy loop above is untouched and still runs over exactly [-224, 224],
  // so every shipped candidate keeps its exact coordinates and `order` value.
  // This second pass runs ONLY when non-legacy segments exist, and only covers
  // their extent, so with the shipped 70-segment graph it contributes nothing and
  // the world is unchanged. Legacy segments deliberately do not widen the box:
  // widening it without new roads would add buildings to the shipped world.
  if (newSegments.length > 0) {
    const LEGACY_BOX = SHIPPED_EXTENT;
    const step = 11.8;
    const pad = 48;
    // Seeded from the segments themselves, not from the legacy box: seeding a
    // max accumulator with `-LEGACY_BOX` clips it at `-224`, which let a road far
    // west of the city drag the grid 470 m back toward the shipped blocks
    // (measured: 154 buildings with no new road within 43 m of them).
    let extMinX = Infinity, extMaxX = -Infinity;
    let extMinZ = Infinity, extMaxZ = -Infinity;
    for (const sg of newSegments) {
      extMinX = Math.min(extMinX, sg.ax, sg.bx);
      extMaxX = Math.max(extMaxX, sg.ax, sg.bx);
      extMinZ = Math.min(extMinZ, sg.az, sg.bz);
      extMaxZ = Math.max(extMaxZ, sg.az, sg.bz);
    }
    // Centreline distance to the nearest new segment. The corridor test below
    // measures against *all* roads, so without this a candidate in the pad ring
    // could be filled merely because a legacy road is nearby, sprouting new
    // buildings just outside the shipped blocks with no new road to justify them.
    const newRoadDistance = (x: number, z: number): number => {
      let best = Infinity;
      for (const sg of newSegments) {
        const t = Math.max(0, Math.min(sg.length,
          (x - sg.ax) * sg.ux + (z - sg.az) * sg.uz));
        const d = Math.hypot(x - (sg.ax + sg.ux * t), z - (sg.az + sg.uz * t));
        if (d < best) best = d;
      }
      return best;
    };
    const startX = Math.floor((extMinX - pad) / step) * step;
    const startZ = Math.floor((extMinZ - pad) / step) * step;
    for (let gz = startZ; gz <= extMaxZ + pad; gz += step) {
      for (let gx = startX; gx <= extMaxX + pad; gx += step) {
        // The legacy box is entirely covered by the loop above.
        if (gx >= -LEGACY_BOX && gx <= LEGACY_BOX && gz >= -LEGACY_BOX && gz <= LEGACY_BOX) continue;
        const x = gx + (Math.floor((gz + LEGACY_BOX) / step) % 2 ? 3.1 : 0);
        const z = gz + ((Math.floor((gx + LEGACY_BOX) / step) % 3) - 1) * 1.6;
        const roadDistance = distanceToRoadCorridor(x, z);
        if (roadDistance < 2.2 || roadDistance > 43 || newRoadDistance(x, z) > 43 ||
            PLACES.some((place) => Math.hypot(x - place.x, z - place.z) < 16) ||
            GRAPH_NODES.some((node) => Math.hypot(x - node.x, z - node.z) < node.outerRadius + 7)) continue;
        const tie = (Math.imul(Math.round(x * 4), 73856093) ^
          Math.imul(Math.round(z * 4), 19349663)) >>> 0;
        const gap = legacyPlacedBuildings.reduce((d, b) =>
          Math.min(d, Math.hypot(x - b.x, z - b.z) - b.radius), 50);
        interiorCandidates.push({ x, z, sec: sectorIndex(x, z), order: -gap + tie / 4294967296, regionFill: true });
      }
    }
  }
  interiorCandidates.sort((a, b) => a.order - b.order);

  // Two phases, in this order, and never interleaved.
  //
  // Phase 1 is the shipped world: identical candidates, identical order, identical
  // counters, therefore identical output. Phase 2 is everything the shipped world
  // did not contain, governed by per-region budgets from `regionFill.ts`.
  //
  // Ordering matters. If a new region's candidate were visited during phase 1 it
  // could claim a sector's last slot, or spend the global cap, and change the
  // shipped city. Running the legacy phase to completion first makes that
  // impossible by construction rather than by a tuning constant.
  const legacyPhase = interiorCandidates.filter((c) => !c.regionFill);
  const regionPhase = interiorCandidates.filter((c) => c.regionFill);

  for (const { x, z, sec, regionFill } of [...legacyPhase, ...regionPhase]) {
      const legacyOrd = legacyInteriorOrdinal(x, z);
      if (!regionFill && legacyOrd === undefined) continue;
      const isLegacy = !regionFill;
      // Frozen ordinal: a legacy candidate's size and style are properties of
      // the candidate itself, not of a running counter, so losing one candidate
      // elsewhere in the city can no longer resize this one
      // (see `legacyFillLayout.ts`). A new-region candidate derives its ordinal
      // from its own position for exactly the same reason.
      const ord: number = isLegacy ? (legacyOrd as number) : derivedFillOrdinal(x, z);
      const regionKey = regionKeyOf(x, z);
      if (isLegacy) {
        if (interiorBySector[sec] >= 12 || interiorCount >= 160) continue;
      } else if (regionBudgetLedger.remainingIn(regionKey) <= 0) {
        continue;
      }
      // Frozen road scope for legacy candidates: a road added later must not
      // re-orient an existing interior building by becoming its nearest
      // centreline. New-region candidates use the full graph, because for them
      // the new road *is* their context.
      const road = snapToNearestRoad(x, z, true, isLegacy ? legacySegments : ROAD_SEGMENTS).segment;
      const yaw = Math.atan2(road.ux, road.uz);
      const width = 5.9 + ((ord + sec) % 3) * 0.75;
      const depth = 6.3 + ((ord + sec * 2) % 3) * 0.62;
      if (!canPlaceBuilding(x, z, depth, width, yaw, isLegacy)) continue;
      if (!isLegacy && !regionBudgetLedger.tryConsume(regionKey)) continue;
      // Legacy footprints earn legacy precedence; new-region ones do not.
      collectLegacyFootprints = isLegacy;
      const floorCount = 2 + (ord + sec) % 3;
      const h = floorCount * 2.85;
      const tint = PLASTER_TINTS[(ord * 5 + sec) % PLASTER_TINTS.length];
      const wall = sectorWalls[sec], details = sectorDetails[sec];
      wall.box({ x, y: h / 2, z }, { x: depth, y: h, z: width }, tint, { y: yaw });
      details.box({ x, y: h + 0.2, z }, { x: depth + 0.22, y: 0.4, z: width + 0.22 }, '#999186', { y: yaw });
      // Recessed-looking window pairs, concrete sills and a grounded threshold
      // make the secondary buildings read as occupied, not blank filler boxes.
      const face = (x - road.ax) * road.leftX + (z - road.az) * road.leftZ > 0 ? -1 : 1;
      const fx = road.leftX * face, fz = road.leftZ * face;
      const frontX = x + fx * (depth / 2 + 0.035);
      const frontZ = z + fz * (depth / 2 + 0.035);
      const faceYaw = Math.atan2(fx, fz);
      details.box({ x: frontX + fx * 0.06, y: 1.14, z: frontZ + fz * 0.06 },
        { x: 1.42, y: 2.05, z: 0.075 }, '#4e5b56', { y: faceYaw });
      for (let fl = 1; fl < floorCount; fl++) {
        for (const side of [-1, 1]) {
          const wx = frontX + road.ux * side * (width * 0.24) + fx * 0.04;
          const wz = frontZ + road.uz * side * (width * 0.24) + fz * 0.04;
          details.box({ x: wx, y: fl * 2.85 + 1.35, z: wz },
            { x: 1.0, y: 1.12, z: 0.07 }, '#3d4b4e', { y: faceYaw });
          litWindow(sec, wx + fx * 0.085, fl * 2.85 + 1.35,
            wz + fz * 0.085, faceYaw, 0.8, 0.88);
          details.box({ x: wx + fx * 0.13, y: fl * 2.85 + 0.76, z: wz + fz * 0.13 },
            { x: 1.25, y: 0.09, z: 0.24 }, '#b5aa94', { y: faceYaw });
        }
      }
      if ((ord + sec) % 4 === 0) {
        details.box({ x: x - fx * 1.2, y: h + 0.95, z: z - fz * 1.2 },
          { x: 1.9, y: 1.5, z: 2.15 }, tint, { y: yaw });
      }
      addFootprint({ x, z, halfX: depth / 2, halfZ: width / 2,
        yaw, radius: Math.hypot(depth, width) / 2 });
      const ex = Math.abs(Math.cos(yaw)) * depth / 2 + Math.abs(Math.sin(yaw)) * width / 2;
      const ez = Math.abs(Math.sin(yaw)) * depth / 2 + Math.abs(Math.cos(yaw)) * width / 2;
      colliders.push({ minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez,
        height: h, cameraBlocking: true, kind: 'building', cx: x, cz: z,
        halfX: depth / 2, halfZ: width / 2, yaw });
      // Only the shipped world's candidates advance the legacy counters; a new
      // region's consumption is already recorded by its own region ledger.
      if (isLegacy) {
        interiorBySector[sec]++;
        interiorCount++;
      }
  }
  // Every later pass reasons about legacy footprints only, so restore the flag.
  collectLegacyFootprints = true;

  // Genuine open frontage is often too shallow for even a two-storey shop.
  // Fill eligible lots with small roofed tea stalls / planted courtyards, not
  // solid walls or giant floor slabs. Reject every road/building overlap
  // using the same oriented footprint checker as the apartments. These are
  // set back from the footpath so pedestrians and junction sightlines survive.
  let courtyardCount = 0;
  const courtyardSites: { x: number; z: number }[] = [];
  const courtyardBySector = new Uint8Array(SECTOR_COUNT);
  for (const seg of canonicalSegments(ROAD_SEGMENTS)) {
    if (courtyardCount >= 36) break;
    const arc = arcLengthOf(seg);
    for (const side of [-1, 1] as const) {
      for (let along = 18; along < arc - 18 && courtyardCount < 36; along += 9.5) {
        const width = 5.2, depth = 3.4;
        const distance = seg.halfWidth + seg.sidewalk + 1.25 + depth / 2;
        const frame = placementAt(seg, along, distance * side);
        const x = frame.x;
        const z = frame.z;
        const yaw = frame.yaw;
        // Same scope rule as the infill passes: a new road through the mapped
        // blocks does not claim courtyards there.
        if (!isLegacyRoadSegment(seg.id) && insideShippedExtent(x, z)) continue;
        const sec = sectorIndex(x, z);
        if (courtyardBySector[sec] >= 3 || !canPlaceBuilding(x, z, depth, width, yaw)) continue;
        const frontX = -frame.leftX * side, frontZ = -frame.leftZ * side;
        const d = sectorDetails[sec];
        // Terracotta/brick pavers break the monotonous gray ground plane;
        // a narrow shop counter and woven roof identify the occupied parcel.
        d.box({ x, y: 0.035, z }, { x: depth, y: 0.07, z: width },
          courtyardCount % 3 === 0 ? '#92705b' : '#a08b72', { y: yaw });
        d.box({ x: x - frontX * 0.85, y: 0.75, z: z - frontZ * 0.85 },
          { x: width - 0.45, y: 0.12, z: 0.72 }, '#735039', { y: Math.atan2(frontX, frontZ) });
        d.box({ x, y: 2.6, z }, { x: depth + 0.4, y: 0.13, z: width + 0.45 },
          ['#ac4933', '#365d51', '#ad823d'][courtyardCount % 3], { y: yaw, x: 0.06 });
        // Grounded merchandise, tea utensils and reused timber crates give
        // each roofed parcel a purpose. All sit inside the validated lot and
        // merge into its existing opaque sector (no extra draw/material pass).
        const stallKind = courtyardCount % 3;
        if (stallKind === 0) {
          // Small fruit display on the established rear counter.
          for (let row = 0; row < 2; row++) {
            for (let item = -2; item <= 2; item++) {
              const px = x - frontX * (0.85 + row * 0.16) + seg.ux * item * 0.36;
              const pz = z - frontZ * (0.85 + row * 0.16) + seg.uz * item * 0.36;
              d.cone({ x: px, y: 0.94 + row * 0.025, z: pz },
                0.105, 0.19, item % 3 === 0 ? '#b58134' : '#758342');
            }
          }
          for (const end of [-1, 1]) {
            d.box({ x: x + seg.ux * end * 1.35 - frontX * 0.55, y: 0.31,
              z: z + seg.uz * end * 1.35 - frontZ * 0.55 },
              { x: 0.52, y: 0.62, z: 0.48 }, '#796044', { y: yaw });
          }
        } else if (stallKind === 1) {
          // Metal tea urn and stacked cups; not a new light or actor.
          d.cylinder({ x: x - frontX * 0.82, y: 1.02, z: z - frontZ * 0.82 },
            0.20, 0.43, '#aab0a7');
          d.cone({ x: x - frontX * 0.82, y: 1.29, z: z - frontZ * 0.82 },
            0.22, 0.11, '#676b65');
          for (let cup = -1; cup <= 1; cup++) {
            d.cylinder({ x: x + seg.ux * cup * 0.33 - frontX * 0.82,
              y: 0.86, z: z + seg.uz * cup * 0.33 - frontZ * 0.82 },
              0.055, 0.10, '#c2b9a6');
          }
        } else {
          // Market bags and woven baskets beside the timber counter.
          for (const end of [-1, 1]) {
            d.cylinder({ x: x + seg.ux * end * 1.15 - frontX * 0.5, y: 0.29,
              z: z + seg.uz * end * 1.15 - frontZ * 0.5 },
              0.27, 0.55, '#826147');
            d.cone({ x: x + seg.ux * end * 1.15 - frontX * 0.5, y: 0.63,
              z: z + seg.uz * end * 1.15 - frontZ * 0.5 },
              0.23, 0.28, '#57704c');
          }
        }
        // Some approved lots have a parked commuter bike alongside the stall.
        // It is stationary scenery, not a new traffic agent or spawn point.
        if (courtyardCount % 5 === 2) {
          const bx = x + frontX * 0.57 + seg.ux * 0.63;
          const bz = z + frontZ * 0.57 + seg.uz * 0.63;
          for (const end of [-1, 1]) {
            d.cylinder({ x: bx + seg.ux * end * 0.46, y: 0.29,
              z: bz + seg.uz * end * 0.46 },
              0.27, 0.075, '#242c2c', { y: yaw, z: Math.PI / 2 });
          }
          d.box({ x: bx, y: 0.66, z: bz },
            { x: 0.36, y: 0.26, z: 0.68 },
            courtyardCount % 2 ? '#9c3e31' : '#496474', { y: yaw });
          d.box({ x: bx - seg.ux * 0.18, y: 0.82, z: bz - seg.uz * 0.18 },
            { x: 0.32, y: 0.075, z: 0.39 }, '#262b30', { y: yaw });
          d.box({ x: bx + seg.ux * 0.44, y: 0.87, z: bz + seg.uz * 0.44 },
            { x: 0.55, y: 0.055, z: 0.045 }, '#a8aaa2', { y: yaw });
          // Tight stationary OBB, contained by the already verified parcel.
          const extent = 1.18; // conservative AABB; OBB below is the actual bike
          colliders.push({ minX: bx - extent, maxX: bx + extent,
            minZ: bz - extent, maxZ: bz + extent, height: 0.95,
            cameraBlocking: false, kind: 'prop', cx: bx, cz: bz,
            halfX: 0.30, halfZ: 0.88, yaw });
        }
        for (const end of [-1, 1] as const) {
          const px = x + seg.ux * (width * 0.43) * end + frontX * 0.85;
          const pz = z + seg.uz * (width * 0.43) * end + frontZ * 0.85;
          d.box({ x: px, y: 1.3, z: pz }, { x: 0.1, y: 2.6, z: 0.1 }, '#574b38');
          d.cylinder({ x: px - frontX * 0.45, y: 0.22, z: pz - frontZ * 0.45 },
            0.25, 0.43, '#8f5140');
          d.cone({ x: px - frontX * 0.45, y: 0.74, z: pz - frontZ * 0.45 },
            0.37, 0.85, '#346445');
        }
        addFootprint({ x, z, halfX: depth / 2, halfZ: width / 2,
          yaw, radius: Math.hypot(depth, width) / 2 });
        courtyardSites.push({ x, z });
        courtyardBySector[sec]++;
        courtyardCount++;
      }
    }
  }

  // The narrow open lot behind the chase corridor was visibly an unbroken
  // gray void. Treat it as a pocket tea court instead of forcing a tall block
  // between two apartment footprints. The same SAT, road checks
  // prevent this authored frontage from becoming a junction obstruction.
  let pocketPlazaCount = 0;
  let plazaX = -13, plazaZ = 12;
  let plazaFits = false;
  for (let radius = 0; radius <= 4 && !plazaFits; radius++) {
    for (let gx = -radius; gx <= radius && !plazaFits; gx++) {
      for (let gz = -radius; gz <= radius && !plazaFits; gz++) {
        if (Math.max(Math.abs(gx), Math.abs(gz)) !== radius) continue;
        const x = -13 + gx * 0.75, z = 12 + gz * 0.75;
        if (canPlaceBuilding(x, z, 2.4, 2.4, 0)) {
          plazaX = x; plazaZ = z; plazaFits = true;
        }
      }
    }
  }
  if (plazaFits) {
    const d = sectorDetails[sectorIndex(plazaX, plazaZ)];
    const sgn = sectorSigns[sectorIndex(plazaX, plazaZ)];
    // Brick paving is raised just 4 cm and stays within the empty parcel.
    d.box({ x: plazaX, y: 0.025, z: plazaZ }, { x: 2.4, y: 0.05, z: 2.4 }, '#a17960');
    d.box({ x: plazaX, y: 0.70, z: plazaZ - 0.45 }, { x: 2.15, y: 1.40, z: 0.58 }, '#786c51');
    d.box({ x: plazaX, y: 1.25, z: plazaZ + 0.16 }, { x: 2.1, y: 0.14, z: 0.62 }, '#664536');
    d.box({ x: plazaX, y: 2.48, z: plazaZ }, { x: 2.5, y: 0.13, z: 2.3 }, '#b04b35');
    for (const end of [-1, 1] as const) {
      d.box({ x: plazaX + end * 1.02, y: 1.25, z: plazaZ + 0.95 },
        { x: 0.10, y: 2.5, z: 0.10 }, '#624b34');
      d.cylinder({ x: plazaX + end * 0.98, y: 0.2, z: plazaZ + 1.18 },
        0.20, 0.40, '#a25d44');
      d.cone({ x: plazaX + end * 0.98, y: 0.62, z: plazaZ + 1.18 },
        0.29, 0.78, '#427049');
    }
    sgn.quad({ x: plazaX, y: 1.95, z: plazaZ + 0.78 }, 1.9, 0.55,
      '#ffffff', { y: 0 }, signAtlas.slot(signCursor++));
    addFootprint({ x: plazaX, z: plazaZ, halfX: 1.2, halfZ: 1.2,
      yaw: 0, radius: Math.hypot(1.2, 1.2) });
    // A low, tight counter collider rather than a full roof footprint keeps
    // the adjacent side lane traversable for both the player and traffic.
    colliders.push({ minX: plazaX - 1.05, maxX: plazaX + 1.05,
      minZ: plazaZ - 0.75, maxZ: plazaZ - 0.15, height: 1.4,
      cameraBlocking: false, kind: 'building' });
    pocketPlazaCount = 1;
  }

  // Second parcel size for leftover narrow street-front seams. The large
  // apartment pass cannot fit here, but actual shop-houses often can. Keep a
  // clear junction sightline and every authored mission/POI forecourt.
  for (const seg of canonicalSegments(ROAD_SEGMENTS)) {
    collectLegacyFootprints = isLegacyRoadSegment(seg.id);
    if (infillCount >= 126) break;
    const arc = arcLengthOf(seg);
    for (const side of [-1, 1] as const) {
      for (let along = 9; along < arc - 9 && infillCount < 126; along += 3.4) {
        const width = 3.05, depth = 4.6;
        const distance = seg.halfWidth + seg.sidewalk + 0.85 + depth / 2;
        const frame = placementAt(seg, along, distance * side);
        const cx = frame.x;
        const cz = frame.z;
        const yaw = frame.yaw;
        // Same rule as the first seam pass: region fill only from new roads,
        // only outside the shipped extent.
        if (legacyInfillOrdinal(cx, cz) === undefined &&
            (isLegacyRoadSegment(seg.id) || insideShippedExtent(cx, cz))) continue;
        const sec = sectorIndex(cx, cz);
        if (infillBySector[sec] >= 12 ||
            PLACES.some(p => Math.hypot(cx - p.x, cz - p.z) < 10) ||
            GRAPH_NODES.some(n => Math.hypot(cx - n.x, cz - n.z) < n.outerRadius + 4) ||
            !canPlaceBuilding(cx, cz, depth, width, yaw)) continue;
        const fx = -frame.leftX * side, fz = -frame.leftZ * side;
        const faceYaw = Math.atan2(fx, fz);
        const x = cx + fx * (depth / 2 + 0.03);
        const z = cz + fz * (depth / 2 + 0.03);
        const height = 6.15;
        const legacyOrdB = legacyInfillOrdinal(cx, cz);
        const isLegacyB = legacyOrdB !== undefined;
        const ord = isLegacyB ? (legacyOrdB as number) : derivedFillOrdinal(cx, cz);
        if (!isLegacyB) {
          if (!regionBudgetLedger.tryConsume(regionKeyOf(cx, cz))) continue;
          collectLegacyFootprints = false;
        } else {
          collectLegacyFootprints = true;
        }
        sectorWalls[sec].box({ x: cx, y: height / 2, z: cz },
          { x: depth, y: height, z: width }, PLASTER_TINTS[(sec + ord) % PLASTER_TINTS.length], { y: yaw });
        sectorDetails[sec].box({ x: cx, y: height + 0.12, z: cz },
          { x: depth + 0.15, y: 0.24, z: width + 0.12 }, '#9c9383', { y: yaw });
        sectorShutters[sec].quad({ x, y: 1.42, z }, 2.47, 2.51, '#536b6d', { y: faceYaw });
        sectorDetails[sec].box({ x: x + fx * 0.08, y: 4.65, z: z + fz * 0.08 },
          { x: 1.42, y: 1.13, z: 0.07 }, '#32484c', { y: faceYaw });
        sectorSigns[sec].quad({ x: x + fx * 0.065, y: 3.15, z: z + fz * 0.065 },
          2.65, 0.63, '#ffffff', { y: faceYaw }, signAtlas.slot(signCursor++));
        addFootprint({ x: cx, z: cz, halfX: depth / 2, halfZ: width / 2,
          yaw, radius: Math.hypot(depth, width) / 2 });
        const ex = Math.abs(Math.cos(yaw)) * depth / 2 + Math.abs(Math.sin(yaw)) * width / 2;
        const ez = Math.abs(Math.sin(yaw)) * depth / 2 + Math.abs(Math.cos(yaw)) * width / 2;
        colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez,
          height, cameraBlocking: true, kind: 'building', cx, cz,
          halfX: depth / 2, halfZ: width / 2, yaw });
        infillCount++; infillBySector[sec]++;
      }
    }
  }

  // Canopies are merged into existing cullable sector detail meshes: no
  // individual tree objects or new material/draw-call family. Trunk clearance
  // is checked after the entire block infill pass, not against an empty lot.
  const treeSites: { x: number; z: number }[] = [];
  for (const tree of streetTrees) {
    const footprint: PlacedFootprint = { x: tree.x, z: tree.z, halfX: 0.22,
      halfZ: 0.22, yaw: 0, radius: Math.SQRT2 * 0.22 };
    if (!placedBuildings.every((building) => footprintSeparated(footprint, building, 0.25))) continue;
    addStreetTree(sectorDetails[sectorIndex(tree.x, tree.z)], tree);
    treeSites.push({ x: tree.x, z: tree.z });
    // Match the 20 cm flared base of treeModel's trunk. Canopy and branches
    // deliberately stay non-collidable; this is a firm, non-breakable trunk.
    const trunkHalf = 0.20;
    colliders.push({ minX: tree.x - trunkHalf, maxX: tree.x + trunkHalf,
      minZ: tree.z - trunkHalf, maxZ: tree.z + trunkHalf,
      height: tree.height * 0.94, cameraBlocking: false, kind: 'prop',
      cx: tree.x, cz: tree.z, halfX: trunkHalf, halfZ: trunkHalf, yaw: 0 });
  }

  // ---- Corridor landmark structures (v0.7.0 identity layer) --------------
  // Ring Road and Tajmahal Road previously had no recognisable landmark at all.
  // Each structure below is seated from a verified OSM feature (see
  // `corridorIdentity.ts`), merged into the existing per-sector detail buckets so
  // this adds NO draw calls, no new material and no new geometry family — which
  // is what keeps it affordable on mid-range Android.
  //
  // Placement was already validated against road corridors before this point;
  // the `isFootprintClearOfCorridor` re-check here is a belt-and-braces guard so
  // no structure can ever be built into a carriageway.
  const builtLandmarkStructures: CityResult['landmarkStructures'] = [];
  for (const st of corridorStructures) {
    if (!isFootprintClearOfCorridor(st.x, st.z, st.halfX * 2, st.halfZ * 2, st.yaw, 0.5)) continue;
    (builtLandmarkStructures as unknown as Array<Record<string, unknown>>).push({
      landmarkId: st.landmarkId,
      kind: st.kind,
      x: st.x,
      z: st.z,
      halfX: st.halfX,
      halfZ: st.halfZ,
    });
    const bDet = sectorDetails[sectorIndex(st.x, st.z)];
    const hx = st.halfX;
    const hz = st.halfZ;

    if (st.kind === 'mosque') {
      // Compact neighbourhood mosque: prayer hall, dome, four corner minarets.
      const bodyH = 6.4;
      bDet.box({ x: st.x, y: bodyH / 2, z: st.z }, { x: hx * 2, y: bodyH, z: hz * 2 }, st.body, { y: st.yaw });
      bDet.box({ x: st.x, y: bodyH + 0.15, z: st.z }, { x: hx * 2 + 0.2, y: 0.3, z: hz * 2 + 0.2 }, st.body, { y: st.yaw });
      bDet.cone({ x: st.x, y: bodyH + 2.3, z: st.z }, Math.min(hx, hz) * 0.78, 2.6, st.accent);
      for (const [ox, oz] of [
        [-hx + 0.5, -hz + 0.5],
        [hx - 0.5, -hz + 0.5],
        [-hx + 0.5, hz - 0.5],
        [hx - 0.5, hz - 0.5],
      ]) {
        const mx = st.x + ox * Math.cos(st.yaw) + oz * Math.sin(st.yaw);
        const mz = st.z - ox * Math.sin(st.yaw) + oz * Math.cos(st.yaw);
        bDet.cylinder({ x: mx, y: bodyH * 0.72, z: mz }, 0.42, bodyH * 1.44, st.body);
        bDet.cone({ x: mx, y: bodyH * 1.44 + 0.55, z: mz }, 0.56, 1.25, st.accent);
      }
    } else if (st.kind === 'commercial') {
      // Tokyo Square: stepped commercial mass with a signage band.
      const h1 = 13.2;
      bDet.box({ x: st.x, y: h1 / 2, z: st.z }, { x: hx * 2, y: h1, z: hz * 2 }, st.body, { y: st.yaw });
      bDet.box({ x: st.x, y: h1 * 0.62, z: st.z }, { x: hx * 2 + 0.5, y: 1.5, z: hz * 2 + 0.5 }, st.accent, { y: st.yaw });
      bDet.box({ x: st.x, y: h1 + 0.2, z: st.z }, { x: hx * 1.5, y: 0.4, z: hz * 1.5 }, '#9c9383', { y: st.yaw });
      // Ground-floor colonnade, cheap: two lintel boxes.
      bDet.box({ x: st.x, y: 3.1, z: st.z }, { x: hx * 2 + 0.7, y: 0.35, z: hz * 2 + 0.7 }, '#b9b2a3', { y: st.yaw });
    } else if (st.kind === 'college') {
      // Queen's College: long institutional block, low-pitch roof, portico.
      const h2 = 10.6;
      bDet.box({ x: st.x, y: h2 / 2, z: st.z }, { x: hx * 2, y: h2, z: hz * 2 }, st.body, { y: st.yaw });
      bDet.box({ x: st.x, y: h2 + 0.55, z: st.z }, { x: hx * 2 + 0.6, y: 0.9, z: hz * 2 + 0.6 }, st.accent, { y: st.yaw });
      // Entrance portico facing the road.
      bDet.box({ x: st.x, y: 2.9, z: st.z }, { x: 4.6, y: 5.8, z: 1.4 }, '#eef0ec', { y: st.yaw });
      bDet.box({ x: st.x, y: 6.1, z: st.z }, { x: 5.4, y: 0.45, z: 2.0 }, st.accent, { y: st.yaw });
    } else if (st.kind === 'grave-yard') {
      // Low boundary wall plus a scatter of headstones. No new materials.
      const wallH = 1.15;
      bDet.box({ x: st.x, y: wallH / 2, z: st.z }, { x: hx * 2, y: wallH, z: 0.22 }, st.body, { y: st.yaw });
      bDet.box({ x: st.x, y: wallH / 2, z: st.z }, { x: 0.22, y: wallH, z: hz * 2 }, st.body, { y: st.yaw });
      for (let i = 0; i < 7; i++) {
        const ox = -hx + 1.4 + (i % 3) * (hx * 0.85);
        const oz = -hz + 1.6 + Math.floor(i / 3) * (hz * 0.62);
        const gx = st.x + ox * Math.cos(st.yaw) + oz * Math.sin(st.yaw);
        const gz = st.z - ox * Math.sin(st.yaw) + oz * Math.cos(st.yaw);
        bDet.box({ x: gx, y: 0.34, z: gz }, { x: 0.5, y: 0.68, z: 0.28 }, st.accent, { y: st.yaw });
      }
    } else {
      // Eidgah: open prayer ground — paved slab, low wall, mihrab arch.
      bDet.quad({ x: st.x, y: 0.06, z: st.z }, hx * 2, hz * 2, st.body, {
        x: -Math.PI / 2,
        y: st.yaw,
      });
      bDet.box({ x: st.x, y: 0.55, z: st.z }, { x: hx * 2, y: 1.1, z: 0.2 }, st.accent, { y: st.yaw });
      bDet.box({ x: st.x, y: 0.55, z: st.z }, { x: 0.2, y: 1.1, z: hz * 2 }, st.accent, { y: st.yaw });
      // Mihrab niche: two piers plus a lintel.
      for (const side of [-1, 1]) {
        const px2 = st.x + side * 1.5;
        bDet.box({ x: px2, y: 1.6, z: st.z }, { x: 0.45, y: 3.2, z: 0.5 }, st.body);
      }
      bDet.box({ x: st.x, y: 3.4, z: st.z }, { x: 3.6, y: 0.45, z: 0.55 }, st.accent);
    }

    colliders.push({
      minX: st.x - hx - 0.3,
      maxX: st.x + hx + 0.3,
      minZ: st.z - hz - 0.3,
      maxZ: st.z + hz + 0.3,
      height: st.kind === 'commercial' ? 13.2 : st.kind === 'college' ? 11 : 8,
      cameraBlocking: true,
      kind: 'building',
    });
  }

  // Mohammadpur Town Hall Market. Authored geometry drawn into the buckets that
  // already exist, so it adds no draw calls; its colliders join the static set.
  // The site exclusion above keeps the generator out of the same ground.
  const townHall = buildTownHall({
    signAtlas,
    sectorOf: sectorIndex,
    walls: sectorWalls,
    details: sectorDetails,
    signs: sectorSigns,
    shutters: sectorShutters,
    bricks: sectorBricks,
    metal: bMetal,
    walk: bWalk,
    glow: bGlow,
    signSlotStart: signCursor,
    wirePairs,
    utilityPoleSites,
  });
  for (const c of townHall.colliders) colliders.push(c);

  // Overhead Dhaka utility cables chunked by 6x6 sector so off-screen wires
  // frustum-cull cleanly and opaque dark charcoal avoids full-city alpha overdraw!
  const wireBuckets: number[][] = Array.from({ length: SECTOR_COUNT }, () => []);
  const wireMat = new THREE.LineBasicMaterial({ color: 0x20262b });
  for (const [a, b] of wirePairs) {
    const sIdx = sectorIndex((a.x + b.x) * 0.5, (a.z + b.z) * 0.5);
    const dst = wireBuckets[sIdx];
    const segs = 5;
    for (let strand = 0; strand < 2; strand++) {
      const yOff = strand * -0.38;
      for (let s = 0; s < segs; s++) {
        const t0 = s / segs;
        const t1 = (s + 1) / segs;
        const sag0 = Math.sin(t0 * Math.PI) * 0.68;
        const sag1 = Math.sin(t1 * Math.PI) * 0.68;
        dst.push(
          a.x + (b.x - a.x) * t0,
          a.y + yOff - sag0,
          a.z + (b.z - a.z) * t0,
          a.x + (b.x - a.x) * t1,
          a.y + yOff - sag1,
          a.z + (b.z - a.z) * t1,
        );
      }
    }
  }
  for (let i = 0; i < SECTOR_COUNT; i++) {
    const verts = wireBuckets[i];
    if (verts.length === 0) continue;
    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    wireGeo.computeBoundingSphere();
    const wires = new THREE.LineSegments(wireGeo, wireMat);
    wires.name = `wires.sec.${i}`;
    wires.matrixAutoUpdate = false;
    wires.updateMatrix();
    group.add(wires);
  }

  // Track static shadow-caster sector meshes for O(1) distance-based shadow culling
  interface SectorShadowCaster {
    mesh: THREE.Mesh;
    cx: number;
    cz: number;
    radius: number;
  }
  const shadowCasters: SectorShadowCaster[] = [];
  const registerCasterMesh = (m: THREE.Mesh): void => {
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    const bs = m.geometry.boundingSphere!;
    shadowCasters.push({ mesh: m, cx: bs.center.x, cz: bs.center.z, radius: bs.radius });
  };

  // Build 3x3 spatially chunked road/sidewalk/metal & 4x4 sector-chunked building meshes
  for (const m of bRoad.buildChunked(3, 280, { cast: false, receive: true })) group.add(m);
  for (const m of bWalk.buildChunked(3, 280, { cast: false, receive: true })) group.add(m);
  for (const m of bMetal.buildChunked(3, 280, { cast: quality.shadows, receive: true })) {
    group.add(m);
    registerCasterMesh(m);
  }
  const puddleMeshes = bPuddle.buildChunked(3, 280, { cast: false, receive: false });
  for (const m of puddleMeshes) {
    m.visible = false; // no white/blue puddle circles on a bone-dry road
    group.add(m);
  }

  for (let i = 0; i < SECTOR_COUNT; i++) {
    // 3D architectural mass, awnings/trees & boundary walls cast crisp shadows;
    // flush 6cm shutters & painted signboards receive shadows without wasting shadow-map tris!
    for (const sb of [sectorWalls[i], sectorDetails[i], sectorBricks[i]]) {
      const m = sb.build({ cast: quality.shadows, receive: true });
      if (m) {
        group.add(m);
        registerCasterMesh(m);
      }
    }
    const shutter = sectorShutters[i].build({ cast: false, receive: true });
    if (shutter) group.add(shutter);
  }
  for (const decalBucket of [...signGroups, ...posterGroups, ...educationGroups, ...snackGroups]) {
    const m = decalBucket.build({ cast: false, receive: true });
    if (m) group.add(m);
  }

  const nightGroup = new THREE.Group();
  nightGroup.name = 'night-glow';
  for (const gm of bGlow.buildChunked(2, 280, { cast: false, receive: false })) {
    nightGroup.add(gm);
  }
  // Keep each sector independently cullable and the panes out of shadow maps.
  for (const bucket of lightGroups) {
    const mesh = bucket.build({ cast: false, receive: false });
    if (mesh) nightGroup.add(mesh);
  }
  nightGroup.visible = false;
  group.add(nightGroup);

  const metalSlices = bMetal.getTagSlices();
  const glowSlices = bGlow.getTagSlices();
  for (let i = 0; i < breakableLamps.length; i++) {
    const bl = breakableLamps[i];
    const mList = metalSlices.get(bl.id);
    const gList = glowSlices.get(bl.id);
    if (mList) bl.slices.push(...mList);
    if (gList) bl.slices.push(...gList);
  }

  const registerShadowCasters = (root: THREE.Object3D): void => {
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.castShadow) {
        registerCasterMesh(obj);
      }
    });
  };

  let lastShadowX = 1e9;
  let lastShadowZ = 1e9;
  let lastShadowRad = -1;
  let lastShadowOn = !quality.shadows;
  const updateShadowFocus = (
    x: number,
    z: number,
    shadowRadius: number,
    shadowsEnabled: boolean,
    force = false,
  ): void => {
    if (
      !force &&
      shadowsEnabled === lastShadowOn &&
      shadowRadius === lastShadowRad &&
      (x - lastShadowX) * (x - lastShadowX) + (z - lastShadowZ) * (z - lastShadowZ) < 36
    ) {
      return;
    }
    lastShadowX = x;
    lastShadowZ = z;
    lastShadowRad = shadowRadius;
    lastShadowOn = shadowsEnabled;
    if (!shadowsEnabled) {
      for (let i = 0; i < shadowCasters.length; i++) shadowCasters[i].mesh.castShadow = false;
      return;
    }
    const maxDist = shadowRadius + 24;
    for (let i = 0; i < shadowCasters.length; i++) {
      const sc = shadowCasters[i];
      const dx = x - sc.cx;
      const dz = z - sc.cz;
      const limit = maxDist + sc.radius;
      sc.mesh.castShadow = dx * dx + dz * dz <= limit * limit;
    }
  };

  for (const p of PLACES) {
    placeAnchors.set(p.id, new THREE.Vector3(p.x, 0, p.z));
  }

  // O(1) spatial hash grid for speed humps & road surface relief (manholes/potholes)
  const BUMP_GRID = 28;
  const BUMP_MIN = -312;
  const BUMP_CELL = 24;
  const humpCells: SpeedHump[][] = Array.from({ length: BUMP_GRID * BUMP_GRID }, () => []);
  const microCells: SurfaceBump[][] = Array.from({ length: BUMP_GRID * BUMP_GRID }, () => []);
  const toBumpCell = (v: number): number => clamp(Math.floor((v - BUMP_MIN) / BUMP_CELL), 0, BUMP_GRID - 1);

  for (const hp of humps) {
    const pad = hp.halfWidth + hp.depth + 2;
    const c0x = toBumpCell(hp.x - pad);
    const c1x = toBumpCell(hp.x + pad);
    const c0z = toBumpCell(hp.z - pad);
    const c1z = toBumpCell(hp.z + pad);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) humpCells[cz * BUMP_GRID + cx].push(hp);
    }
  }
  for (const mb of microBumps) {
    const pad = mb.radius + 0.5;
    const c0x = toBumpCell(mb.x - pad);
    const c1x = toBumpCell(mb.x + pad);
    const c0z = toBumpCell(mb.z - pad);
    const c1z = toBumpCell(mb.z + pad);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) microCells[cz * BUMP_GRID + cx].push(mb);
    }
  }

  // Exact ground height query: road/sidewalk + O(1) speed humps + flush manhole/pothole relief
  const heightAt = (x: number, z: number): number => {
    let h = 0.014;
    const dRoad = distanceToRoadCarriageway(x, z);
    if (dRoad > 0.08) {
      // Smooth sidewalk curb ramp so tyres climb kerbs naturally without sinking!
      const kerbT = clamp((dRoad - 0.08) / 0.24, 0, 1);
      h = 0.014 + kerbT * 0.076;
    }

    const cell = toBumpCell(z) * BUMP_GRID + toBumpCell(x);
    const localHumps = humpCells[cell];
    for (let i = 0; i < localHumps.length; i++) {
      const hp = localHumps[i];
      const dx = x - hp.x;
      const dz = z - hp.z;
      const maxExt = Math.max(hp.halfWidth, hp.depth * 0.5) + 1.5;
      if (Math.abs(dx) > maxExt || Math.abs(dz) > maxExt) continue;
      const along = dx * hp.ux + dz * hp.uz;
      const across = Math.abs(-dx * hp.uz + dz * hp.ux);
      if (across <= hp.halfWidth && Math.abs(along) <= hp.depth * 0.5) {
        const phase = (along / (hp.depth * 0.5)) * (Math.PI * 0.5);
        h = Math.max(h, 0.014 + Math.cos(phase) * hp.height);
      }
    }

    const localMicro = microCells[cell];
    for (let i = 0; i < localMicro.length; i++) {
      const mb = localMicro[i];
      const dx = x - mb.x;
      const dz = z - mb.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < mb.radius * mb.radius) {
        const t = 1 - Math.sqrt(d2) / mb.radius;
        h += mb.deltaY * t;
      }
    }
    return h;
  };

  const potholeDepthAt = (x: number, z: number): number => {
    // Eight authored zones maximum; no per-frame allocations or colliders.
    let depth = 0;
    for (const hole of potholes) {
      const distance = Math.hypot(x - hole.x, z - hole.z);
      if (distance < hole.radius) depth = Math.max(depth, hole.depth * (1 - distance / hole.radius));
    }
    return depth;
  };

  const dryColor = new THREE.Color('#ffffff');
  const wetColor = new THREE.Color('#454d56');
  const setWetness = (wet: number): void => {
    const w = clamp(wet, 0, 1);
    roadMat.color.copy(dryColor).lerp(wetColor, w * 0.8);
    // Asphalt stays dielectric; the thin water film lowers roughness rather
    // than pretending the road is polished metal. Reuse its existing roughness
    // texture and environment probe, with no reflective screen-space pass.
    roadMat.roughness = 0.9 - 0.29 * w;
    roadMat.metalness = 0.025;
    // Damp plaster, shutters and paving also respond to monsoon weather.
    // Shared materials make this a few uniform updates, not extra meshes,
    // texture uploads or a full-screen reflection pass on mobile GPUs.
    wallMat.color.setRGB(1 - 0.14 * w, 1 - 0.15 * w, 1 - 0.14 * w);
    brickMat.color.setRGB(1 - 0.17 * w, 1 - 0.16 * w, 1 - 0.14 * w);
    walkMat.color.setRGB(1 - 0.12 * w, 1 - 0.13 * w, 1 - 0.12 * w);
    shutterMat.roughness = 0.55 - 0.08 * w;
    puddleMat.opacity = 0.08 + 0.46 * w;
    const puddlesVisible = w > 0.03;
    for (const mesh of puddleMeshes) mesh.visible = puddlesVisible;
  };

  const setNight = (intensity: number): void => {
    const v = clamp(intensity, 0, 1);
    // Small cool moon/sky fill on asphalt only. With the normal night key the
    // dark albedo became nearly black between lamps; a constant low-level
    // dielectric fill keeps edges visible without a new light or draw pass.
    roadMat.emissive.setRGB(0.012 * v, 0.016 * v, 0.022 * v);
    glowMat.opacity = v;
    windowLightMat.opacity = v * 0.88;
    nightGroup.visible = v > 0.005;
  };

  const withPrewarmState = (run: () => void): void => {
    const prevNight = nightGroup.visible;
    const prevPuddles = puddleMeshes.map((mesh) => mesh.visible);
    // Wet patches are normally hidden in sunlight. Upload/compile them at boot
    // so the first monsoon does not allocate seven geometries mid-drive.
    for (const mesh of puddleMeshes) mesh.visible = true;
    const prevCast = shadowCasters.map((sc) => sc.mesh.castShadow);
    nightGroup.visible = true;
    for (let i = 0; i < shadowCasters.length; i++) shadowCasters[i].mesh.castShadow = true;
    try {
      run();
    } finally {
      nightGroup.visible = prevNight;
      for (let i = 0; i < puddleMeshes.length; i++) puddleMeshes[i].visible = prevPuddles[i];
      for (let i = 0; i < shadowCasters.length; i++) shadowCasters[i].mesh.castShadow = prevCast[i];
    }
  };

  // --- §30 Sparse Instanced Non-Collidable Street-Paper / Litter (1 draw call, 0 colliders!) ---
  const LITTER_COLORS = ['#ebe4d3', '#dfd5c3', '#f4d36e', '#7bc4e2', '#c89b62', '#e2ece9'];
  interface LitterItem {
    baseX: number;
    baseZ: number;
    ux: number;
    uz: number;
    baseYaw: number;
    phase: number;
    scale: number;
  }
  const litterItems: LitterItem[] = [];
  // Litter used to continue the shared stream and therefore began at absolute
  // draw 7,151. Pinning that exact state keeps it bit-identical while removing
  // its dependence on the props stage and the building pass.
  const litterRng = postBuildingRng();
  for (let si = 0; si < ROAD_SEGMENTS.length && litterItems.length < 136; si++) {
    const seg = ROAD_SEGMENTS[si];
    const perSeg = seg.jamProne ? 4 : seg.kind === 'main' ? 3 : 2;
    for (let k = 0; k < perSeg && litterItems.length < 136; k++) {
      // Arc length, so a curved road is not under-sampled at its far end.
      const along = 6 + litterRng() * Math.max(4, arcLengthOf(seg) - 12);
      const side: 1 | -1 = litterRng() < 0.5 ? 1 : -1;
      const lat = (seg.halfWidth - 0.35 + litterRng() * 0.65) * side;
      const frame = placementAt(seg, along, lat);
      litterItems.push({
        baseX: frame.x,
        baseZ: frame.z,
        ux: frame.ux,
        uz: frame.uz,
        baseYaw: litterRng() * Math.PI * 2,
        phase: litterRng() * Math.PI * 2,
        scale: 0.75 + litterRng() * 0.65,
      });
    }
  }

  const litterMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide });
  const litterBucket = new Bucket('city.streetLitter', litterMat);
  // Creased 2-flap street paper / flyer scrap (non-collidable, low-poly: 4 triangles per instance!)
  litterBucket.quad({ x: -0.055, y: 0.008, z: 0 }, 0.13, 0.19, '#ffffff', { x: -Math.PI * 0.5 + 0.14, z: 0.12 });
  litterBucket.quad({ x: 0.055, y: 0.008, z: 0 }, 0.13, 0.19, '#f2eee6', { x: -Math.PI * 0.5 - 0.10, z: -0.14 });
  const litterProto = litterBucket.build({ cast: false, receive: false })!;
  const streetLitterMesh = new THREE.InstancedMesh(litterProto.geometry, litterMat, litterItems.length);
  streetLitterMesh.name = 'city.streetLitter';
  streetLitterMesh.castShadow = false;
  streetLitterMesh.receiveShadow = false;
  streetLitterMesh.frustumCulled = false;

  const litMatrix = new THREE.Matrix4();
  const litPos = new THREE.Vector3();
  const litQuat = new THREE.Quaternion();
  const litEuler = new THREE.Euler();
  const litScale = new THREE.Vector3();
  const litColor = new THREE.Color();
  for (let i = 0; i < litterItems.length; i++) {
    const it = litterItems[i];
    const gy = heightAt(it.baseX, it.baseZ) + 0.009;
    litPos.set(it.baseX, gy, it.baseZ);
    litEuler.set(0, it.baseYaw, 0, 'YXZ');
    litQuat.setFromEuler(litEuler);
    litScale.set(it.scale, it.scale, it.scale);
    litMatrix.compose(litPos, litQuat, litScale);
    streetLitterMesh.setMatrixAt(i, litMatrix);
    litColor.set(LITTER_COLORS[i % LITTER_COLORS.length]);
    streetLitterMesh.setColorAt(i, litColor);
  }
  streetLitterMesh.instanceMatrix.needsUpdate = true;
  if (streetLitterMesh.instanceColor) streetLitterMesh.instanceColor.needsUpdate = true;
  group.add(streetLitterMesh);

  let litterWindClock = 0;
  const updateStreetLitter = (
    dt: number,
    windStrength: number,
    playerX: number,
    playerZ: number,
  ): void => {
    // Strictly zero CPU/GPU matrix upload cost on calm windless frames!
    if (windStrength <= 0.05 || dt <= 0) return;
    litterWindClock += dt * (1.8 + windStrength * 2.6);
    let touched = false;
    for (let i = 0; i < litterItems.length; i++) {
      const it = litterItems[i];
      const dx = it.baseX - playerX;
      const dz = it.baseZ - playerZ;
      if (dx * dx + dz * dz > 48 * 48) continue;
      const wave = Math.sin(litterWindClock + it.phase);
      const drift = wave * 0.28 * windStrength;
      const wx = it.baseX + it.ux * drift;
      const wz = it.baseZ + it.uz * drift;
      const wy = heightAt(it.baseX, it.baseZ) + 0.010 + Math.abs(wave) * 0.022 * windStrength;
      litPos.set(wx, wy, wz);
      litEuler.set(wave * 0.18 * windStrength, it.baseYaw + wave * 0.35 * windStrength, 0, 'YXZ');
      litQuat.setFromEuler(litEuler);
      litScale.set(it.scale, it.scale, it.scale);
      litMatrix.compose(litPos, litQuat, litScale);
      streetLitterMesh.setMatrixAt(i, litMatrix);
      touched = true;
    }
    if (touched) streetLitterMesh.instanceMatrix.needsUpdate = true;
  };

  return {
    group,
    colliders,
    breakableLamps,
    humps,
    potholes,
    potholeDepthAt,
    roadDamageAt,
    heightAt,
    landmarkStructures: builtLandmarkStructures,
    lampPositions,
    signAnchors,
    spawn: { ...WORLD.playerSpawn },
    placeAnchors,
    setWetness,
    setNight,
    litterCount: litterItems.length,
    infillCount,
    posterCount,
    billboardCount,
    groceryCount,
    educationPosterCount,
    treeCount: treeSites.length,
    treeSites,
    utilityPoleSites,
    marketVendorPosts: townHall.vendorPosts,
    interiorCount,
    courtyardCount,
    courtyardSites,
    pocketPlazaCount,
    updateStreetLitter,
    registerShadowCasters,
    updateShadowFocus,
    withPrewarmState,
  };
}
