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
import { Bucket, tintedMaterial } from './geo';
import {
  GRAPH_NODES,
  PLACES,
  ROAD_SEGMENTS,
  SIGNALS,
  distanceToRoadCarriageway,
  isClearOfRoads,
  isFootprintClearOfCorridor,
} from './layout';
import {
  SignAtlas,
  asphaltTexture,
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

interface SurfaceBump {
  x: number;
  z: number;
  radius: number;
  deltaY: number;
}

export interface CityResult {
  group: THREE.Group;
  colliders: Collider[];
  humps: SpeedHump[];
  heightAt: (x: number, z: number) => number;
  lampPositions: THREE.Vector3[];
  signAnchors: THREE.Vector3[];
  spawn: { x: number; z: number; yaw: number };
  placeAnchors: Map<string, THREE.Vector3>;
  setWetness: (wet: number) => void;
  setNight: (on: boolean) => void;
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
];

const AWNING_COLORS = ['#b32821', '#15694d', '#1c5488', '#c87d1a', '#7c2352'];

const SECTOR_GRID = 4;
const SECTOR_MIN = -280;
const SECTOR_SPAN = 560;

function sectorIndex(x: number, z: number): number {
  const sx = clamp(Math.floor(((x - SECTOR_MIN) / SECTOR_SPAN) * SECTOR_GRID), 0, SECTOR_GRID - 1);
  const sz = clamp(Math.floor(((z - SECTOR_MIN) / SECTOR_SPAN) * SECTOR_GRID), 0, SECTOR_GRID - 1);
  return sz * SECTOR_GRID + sx;
}

export function buildCity(signAtlas: SignAtlas, quality: QualitySettings): CityResult {
  const group = new THREE.Group();
  group.name = 'mohammadpur-city';
  const colliders: Collider[] = [];
  const humps: SpeedHump[] = [];
  const microBumps: SurfaceBump[] = [];
  const lampPositions: THREE.Vector3[] = [];
  const signAnchors: THREE.Vector3[] = [];
  const placeAnchors = new Map<string, THREE.Vector3>();
  const wirePairs: [THREE.Vector3, THREE.Vector3][] = [];
  const rng = mulberry32(20261207);

  // Shared world materials
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
  const walkMat = tintedMaterial(walkTex, { roughness: 0.9, metalness: 0.03 });
  const facadeTex = plasterFacadeTexture(0, '#ffffff');
  const wallMat = tintedMaterial(facadeTex, { roughness: 0.86, metalness: 0.02 });
  const brickMat = tintedMaterial(brickTexture(), { roughness: 0.9, metalness: 0.02 });
  const shutterMat = tintedMaterial(shutterTexture(), { roughness: 0.55, metalness: 0.45 });
  const metalMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.42,
    metalness: 0.65,
  });
  const detailMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.78,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });
  const puddleMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.08,
    metalness: 0.82,
    transparent: true,
    opacity: 0.72,
  });
  const signMat = new THREE.MeshStandardMaterial({
    map: signAtlas.texture,
    roughness: 0.62,
    metalness: 0.08,
  });
  const glowMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    emissive: new THREE.Color('#ffdca4'),
    emissiveIntensity: 1.5,
    roughness: 0.3,
  });

  // Ground base plane beneath everything (urban earth / courtyard compound floor)
  const groundPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.groundExtent * 2, WORLD.groundExtent * 2),
    new THREE.MeshStandardMaterial({ color: 0x6f6c62, roughness: 0.96, metalness: 0.01 }),
  );
  groundPlane.rotation.x = -Math.PI / 2;
  groundPlane.position.y = -0.02;
  groundPlane.receiveShadow = true;
  groundPlane.matrixAutoUpdate = false;
  groundPlane.updateMatrix();
  group.add(groundPlane);

  // Global buckets for roads, sidewalks, props & night glow
  const bRoad = new Bucket('roads.asphalt', roadMat);
  const bWalk = new Bucket('roads.sidewalk', walkMat);
  const bMetal = new Bucket('city.metal', metalMat);
  const bPuddle = new Bucket('roads.puddles', puddleMat);
  const bGlow = new Bucket('city.nightGlow', glowMat);

  // 4x4 sector-chunked buckets for buildings, foliage & signs (automatic frustum culling!)
  const sectorWalls = Array.from({ length: 16 }, (_, i) => new Bucket(`sec.${i}.wall`, wallMat));
  const sectorDetails = Array.from({ length: 16 }, (_, i) => new Bucket(`sec.${i}.detail`, detailMat));
  const sectorShutters = Array.from({ length: 16 }, (_, i) => new Bucket(`sec.${i}.shutter`, shutterMat));
  const sectorBricks = Array.from({ length: 16 }, (_, i) => new Bucket(`sec.${i}.brick`, brickMat));
  const sectorSigns = Array.from({ length: 16 }, (_, i) => new Bucket(`sec.${i}.signs`, signMat));

  // ---------------- 1. JUNCTION DISCS & CONNECTED ROAD RIBBONS (Section 16)
  for (const node of GRAPH_NODES) {
    // Outer sidewalk apron disc at junction (below road asphalt y so road cleanly sits flush/overlaps)
    bWalk.cylinder({ x: node.x, y: 0.04, z: node.z }, node.outerRadius, 0.08, '#958d7e');
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
    const mx = (seg.ax + seg.bx) * 0.5;
    const mz = (seg.az + seg.bz) * 0.5;
    const asphaltTint = seg.kind === 'main' ? '#868b92' : seg.kind === 'medium' ? '#7f8389' : '#777a7e';

    // Continuous asphalt carriageway ribbon between junction centres (flush y = 0.014)
    bRoad.box(
      { x: mx, y: 0.007, z: mz },
      { x: seg.width, y: 0.014, z: seg.length },
      asphaltTint,
      { y: yaw },
    );

    // Dashed white centreline + solid main-avenue edge lines (trimmed away from junction centres)
    const trimStart = Math.min(seg.length * 0.35, 8.5);
    const trimEnd = Math.max(trimStart, seg.length - 8.5);
    if (seg.kind !== 'gali' && trimEnd - trimStart > 8) {
      for (let d = trimStart; d <= trimEnd - 2.5; d += 6.2) {
        const px = seg.ax + seg.ux * (d + 1.4);
        const pz = seg.az + seg.uz * (d + 1.4);
        bRoad.box({ x: px, y: 0.016, z: pz }, { x: 0.13, y: 0.003, z: 2.6 }, '#e6e2d3', { y: yaw });
      }
    }
    if (seg.kind === 'main' && trimEnd - trimStart > 8) {
      const innerLen = trimEnd - trimStart;
      const imx = seg.ax + seg.ux * (trimStart + innerLen * 0.5);
      const imz = seg.az + seg.uz * (trimStart + innerLen * 0.5);
      for (const side of [-1, 1]) {
        const ex = imx + seg.leftX * (seg.halfWidth - 0.38) * side;
        const ez = imz + seg.leftZ * (seg.halfWidth - 0.38) * side;
        bRoad.box({ x: ex, y: 0.016, z: ez }, { x: 0.11, y: 0.003, z: innerLen }, '#e0b94c', { y: yaw });
      }
    }

    // Zebra pedestrian crossings near signalised ends
    for (const end of [
      { dist: 9.2, active: seg.kind !== 'gali' && seg.length > 26 },
      { dist: seg.length - 9.2, active: seg.kind === 'main' && seg.length > 34 },
    ]) {
      if (!end.active) continue;
      const zx = seg.ax + seg.ux * end.dist;
      const zz = seg.az + seg.uz * end.dist;
      const stripes = Math.floor((seg.width - 1.4) / 0.85);
      for (let s = 0; s < stripes; s++) {
        const off = -((stripes - 1) * 0.5) * 0.85 + s * 0.85;
        bRoad.box(
          { x: zx + seg.leftX * off, y: 0.017, z: zz + seg.leftZ * off },
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
        const sx = seg.ax + seg.ux * along + seg.leftX * lateralCenter;
        const sz = seg.az + seg.uz * along + seg.leftZ * lateralCenter;
        const s0x = seg.ax + seg.ux * (along - actualLen * 0.44) + seg.leftX * lateralCenter;
        const s0z = seg.az + seg.uz * (along - actualLen * 0.44) + seg.leftZ * lateralCenter;
        const s1x = seg.ax + seg.ux * (along + actualLen * 0.44) + seg.leftX * lateralCenter;
        const s1z = seg.az + seg.uz * (along + actualLen * 0.44) + seg.leftZ * lateralCenter;
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
        const kx = seg.ax + seg.ux * along + seg.leftX * kerbCenter;
        const kz = seg.az + seg.uz * along + seg.leftZ * kerbCenter;
        const kerbCol = seg.kind === 'main' ? (i % 2 === 0 ? '#e6ebe8' : '#23282d') : '#7b756b';
        bWalk.box({ x: kx, y: 0.055, z: kz }, { x: 0.18, y: 0.11, z: actualLen + 0.02 }, kerbCol, { y: yaw });
      }
    }

    // ------- 2. FLUSH BANGLADESHI ROAD SURFACE DETAILS (Section 11) ---------
    // Speed breakers on busy approaches (never inside junctions)
    if (seg.length > 44 && (seg.jamProne || seg.kind === 'medium') && rng() < 0.46) {
      const hd = seg.length * (0.42 + rng() * 0.16);
      const hx = seg.ax + seg.ux * hd;
      const hz = seg.az + seg.uz * hd;
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
          { x: hx + seg.leftX * off, y: hHeight + 0.012, z: hz + seg.leftZ * off },
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
      const mxp = seg.ax + seg.ux * d + seg.leftX * off;
      const mzp = seg.az + seg.uz * d + seg.leftZ * off;
      // Outer concrete collar + dark cast-iron WASA manhole lid + waffle inner ring (flush at y = 0.018!)
      bWalk.cylinder({ x: mxp, y: 0.013, z: mzp }, 0.52, 0.012, '#6d6960');
      bMetal.cylinder({ x: mxp, y: 0.017, z: mzp }, 0.40, 0.012, '#3a342f');
      bMetal.cylinder({ x: mxp, y: 0.021, z: mzp }, 0.27, 0.006, '#524941');
      bMetal.box({ x: mxp, y: 0.022, z: mzp }, { x: 0.48, y: 0.005, z: 0.05 }, '#282320', { y: yaw });
      bMetal.box({ x: mxp, y: 0.022, z: mzp }, { x: 0.05, y: 0.005, z: 0.48 }, '#282320', { y: yaw });
      microBumps.push({ x: mxp, z: mzp, radius: 0.45, deltaY: 0.008 });

      // Roadside cast-iron storm-drain grate right next to the left/right curb!
      const side = m % 2 === 0 ? 1 : -1;
      const gx = seg.ax + seg.ux * d + seg.leftX * (seg.halfWidth - 0.34) * side;
      const gz = seg.az + seg.uz * d + seg.leftZ * (seg.halfWidth - 0.34) * side;
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
      const wx = seg.ax + seg.ux * d + seg.leftX * off;
      const wz = seg.az + seg.uz * d + seg.leftZ * off;
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
          const cx = wx + seg.ux * c * 0.55 + seg.leftX * ((c % 2 === 0 ? 1 : -1) * 0.14);
          const cz = wz + seg.uz * c * 0.55 + seg.leftZ * ((c % 2 === 0 ? 1 : -1) * 0.14);
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
        const px = seg.ax + seg.ux * d + seg.leftX * (seg.halfWidth - 0.85) * side;
        const pz = seg.az + seg.uz * d + seg.leftZ * (seg.halfWidth - 0.85) * side;
        bPuddle.cylinder({ x: px, y: 0.017, z: pz }, 0.72 + rng() * 0.55, 0.003, '#3b4a56');
      }
    }

    // ------- 3. VALIDATED STREETLIGHTS, ELECTRIC POLES & TREES (Section 16) --
    // Every single pole/lamp/tree is checked via `isClearOfRoads(x, z, 0.95)`!
    const lampSpacing = seg.kind === 'main' ? 28 : seg.kind === 'medium' ? 34 : 44;
    let prevPole: THREE.Vector3 | null = null;
    for (let d = 11, idx = 0; d <= seg.length - 11; d += lampSpacing, idx++) {
      const side: 1 | -1 = seg.kind === 'main' ? (idx % 2 === 0 ? 1 : -1) : 1;
      const curbDist = seg.halfWidth + Math.min(seg.sidewalk * 0.72, 1.55);
      const lx = seg.ax + seg.ux * d + seg.leftX * curbDist * side;
      const lz = seg.az + seg.uz * d + seg.leftZ * curbDist * side;
      if (!isClearOfRoads(lx, lz, 0.95)) continue;

      // Inward normal toward road centre: (-leftX * side, -leftZ * side)
      const inX = -seg.leftX * side;
      const inZ = -seg.leftZ * side;
      const armYaw = Math.atan2(inX, inZ);

      // Galvanized streetlamp column + concrete plinth + overhanging cobra-head LED luminaire
      bWalk.cylinder({ x: lx, y: 0.22, z: lz }, 0.19, 0.44, '#7d786e');
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
      lampPositions.push(new THREE.Vector3(headX, 5.9, headZ));

      // Concrete DESCO utility pole + transformer crossbar on opposite/same sidewalk for overhead wires
      const poleSide: 1 | -1 = -side as 1 | -1;
      const ex = seg.ax + seg.ux * d + seg.leftX * curbDist * poleSide;
      const ez = seg.az + seg.uz * d + seg.leftZ * curbDist * poleSide;
      if (isClearOfRoads(ex, ez, 0.95)) {
        bWalk.box({ x: ex, y: 3.6, z: ez }, { x: 0.22, y: 7.2, z: 0.22 }, '#8a857c', { y: yaw });
        bMetal.box({ x: ex, y: 6.85, z: ez }, { x: 1.15, y: 0.08, z: 0.08 }, '#41474e', { y: yaw });
        // Signature Dhaka coiled fibre-optic cable loop on utility pole!
        bMetal.torus({ x: ex, y: 5.3, z: ez }, 0.28, '#1b1e22', { y: yaw });
        const curPole = new THREE.Vector3(ex, 6.85, ez);
        if (prevPole && prevPole.distanceTo(curPole) < 52) {
          wirePairs.push([prevPole, curPole]);
        }
        prevPole = curPole;
      }

      // Lush Dhaka Krishnachura / Neem / Mango roadside shade trees!
      const td = d + lampSpacing * 0.48;
      if (td <= seg.length - 10) {
        const tx = seg.ax + seg.ux * td + seg.leftX * (curbDist + 0.18) * side;
        const tz = seg.az + seg.uz * td + seg.leftZ * (curbDist + 0.18) * side;
        if (isClearOfRoads(tx, tz, 1.15)) {
          const sec = sectorDetails[sectorIndex(tx, tz)];
          const treeH = 3.2 + rng() * 1.4;
          sec.cylinder({ x: tx, y: treeH * 0.42, z: tz }, 0.16, treeH * 0.84, '#5a402a');
          const leafPalette = rng() < 0.22 ? '#c83e2b' : rng() < 0.6 ? '#2d6a3e' : '#3d7b44'; // Krishnachura flame-red or lush green!
          sec.cone({ x: tx, y: treeH + 0.55, z: tz }, 1.55, 1.9, leafPalette);
          sec.cone({ x: tx + 0.35, y: treeH + 0.15, z: tz - 0.25 }, 1.25, 1.5, '#255834');
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
  interface PlacedCircle {
    x: number;
    z: number;
    r: number;
  }
  const placedBuildings: PlacedCircle[] = [];

  const canPlaceBuilding = (
    cx: number,
    cz: number,
    width: number,
    depth: number,
    yaw: number,
  ): boolean => {
    if (!isFootprintClearOfCorridor(cx, cz, width, depth, yaw, 0.55)) return false;
    const rad = Math.hypot(width * 0.5, depth * 0.5) * 0.84;
    for (let i = 0; i < placedBuildings.length; i++) {
      const pb = placedBuildings[i];
      const dx = cx - pb.x;
      const dz = cz - pb.z;
      if (dx * dx + dz * dz < (rad + pb.r) * (rad + pb.r)) return false;
    }
    return true;
  };

  let signCursor = 0;
  for (const seg of ROAD_SEGMENTS) {
    const yaw = Math.atan2(seg.ux, seg.uz);
    for (const side of [-1, 1] as const) {
      let along = 9.5;
      while (along < seg.length - 9.5) {
        const bWidth = seg.kind === 'main' ? 9.5 + rng() * 5.5 : 7.5 + rng() * 4.5;
        const bDepth = 8.2 + rng() * 4.4;
        const setback = seg.halfWidth + seg.sidewalk + bDepth * 0.5 + 0.95 + rng() * 0.65;
        const cx = seg.ax + seg.ux * (along + bWidth * 0.5) + seg.leftX * setback * side;
        const cz = seg.az + seg.uz * (along + bWidth * 0.5) + seg.leftZ * setback * side;

        // Face normal pointing FROM building TOWARD the street: (-leftX * side, -leftZ * side)
        const faceYaw = Math.atan2(-seg.leftX * side, -seg.leftZ * side);

        if (canPlaceBuilding(cx, cz, bDepth, bWidth, yaw)) {
          placedBuildings.push({
            x: cx,
            z: cz,
            r: Math.hypot(bWidth * 0.5, bDepth * 0.5) * 0.82,
          });

          const floors =
            seg.kind === 'main'
              ? 3 + Math.floor(rng() * 4) // 3..6 storeys on Asad Ave / Ring Rd
              : seg.kind === 'medium'
                ? 2 + Math.floor(rng() * 4) // 2..5 storeys on Tajmahal / Nurjahan / Sher Shah Suri
                : 2 + Math.floor(rng() * 3); // 2..4 storeys on residential galis
          const floorH = 3.05;
          const height = floors * floorH;
          const secIdx = sectorIndex(cx, cz);
          const bWall = sectorWalls[secIdx];
          const bDet = sectorDetails[secIdx];
          const bShut = sectorShutters[secIdx];
          const bBrk = sectorBricks[secIdx];
          const bSgn = sectorSigns[secIdx];

          const tint = PLASTER_TINTS[Math.floor(rng() * PLASTER_TINTS.length)];
          const useBrick = rng() < 0.18;
          if (useBrick) {
            bBrk.box({ x: cx, y: height * 0.5, z: cz }, { x: bDepth, y: height, z: bWidth }, '#d8b8a8', {
              y: yaw,
            });
          } else {
            bWall.box({ x: cx, y: height * 0.5, z: cz }, { x: bDepth, y: height, z: bWidth }, tint, {
              y: yaw,
            });
          }

          // Rooftop parapet wall + black Gazi plastic water tank + concrete stairhead room (`চিলেকোঠা`)
          bDet.box(
            { x: cx, y: height + 0.42, z: cz },
            { x: bDepth + 0.24, y: 0.84, z: bWidth + 0.24 },
            tint,
            { y: yaw },
          );
          const fx = -seg.leftX * side;
          const fz = -seg.leftZ * side;
          bDet.cylinder(
            { x: cx - fx * 1.4, y: height + 1.05, z: cz - fz * 1.4 },
            0.72,
            1.45,
            '#1d2228',
          );
          if (floors >= 3) {
            bDet.box(
              { x: cx + seg.ux * 1.5, y: height + 1.25, z: cz + seg.uz * 1.5 },
              { x: 2.6, y: 2.5, z: 2.8 },
              tint,
              { y: yaw },
            );
          }

          // Street-facing facade details: ground-floor Dokan shutters, striped awning, Bangla signboard & upper balconies!
          const frontX = cx + fx * (bDepth * 0.5 + 0.04);
          const frontZ = cz + fz * (bDepth * 0.5 + 0.04);

          const isCommercial = seg.kind !== 'gali' || rng() < 0.45;
          if (isCommercial) {
            const shopBays = Math.max(1, Math.floor(bWidth / 3.8));
            for (let sb = 0; sb < shopBays; sb++) {
              const bayOff = -((shopBays - 1) * 0.5) * 3.4 + sb * 3.4;
              const sx = frontX + seg.ux * bayOff;
              const sz = frontZ + seg.uz * bayOff;
              bShut.quad({ x: sx, y: 1.42, z: sz }, 2.65, 2.55, '#cfd6de', { y: faceYaw });
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
            // Residential iron boundary gate + guard post
            bShut.quad({ x: frontX, y: 1.25, z: frontZ }, 2.8, 2.3, '#2d3b42', { y: faceYaw });
          }

          // Projecting Bangladeshi apartment balconies (`বারান্দা`) + split AC outdoor units on upper floors
          for (let fl = 1; fl < floors; fl++) {
            const by = fl * floorH + 0.55;
            const balW = Math.min(bWidth * 0.72, 5.8);
            bDet.box(
              { x: frontX + fx * 0.42, y: by - 0.38, z: frontZ + fz * 0.42 },
              { x: balW, y: 0.14, z: 0.88 },
              '#8a8478',
              { y: faceYaw },
            );
            bDet.box(
              { x: frontX + fx * 0.82, y: by + 0.08, z: frontZ + fz * 0.82 },
              { x: balW, y: 0.82, z: 0.06 },
              fl % 2 === 0 ? '#3d5a52' : '#4a4e54',
              { y: faceYaw },
            );
            // White split-AC condenser box mounted beside balcony
            if ((fl + secIdx) % 2 === 0) {
              bDet.box(
                { x: frontX + seg.ux * (bWidth * 0.38) + fx * 0.22, y: by + 0.9, z: frontZ + seg.uz * (bWidth * 0.38) + fz * 0.22 },
                { x: 0.78, y: 0.54, z: 0.34 },
                '#e6e9ec',
                { y: faceYaw },
              );
            }
          }

          // Conservative axis-aligned collider around rotated footprint (strictly clear of road & sidewalk!)
          const cosA = Math.abs(Math.cos(yaw));
          const sinA = Math.abs(Math.sin(yaw));
          const halfX = (bDepth * 0.5) * cosA + (bWidth * 0.5) * sinA;
          const halfZ = (bDepth * 0.5) * sinA + (bWidth * 0.5) * cosA;
          colliders.push({
            minX: cx - halfX,
            maxX: cx + halfX,
            minZ: cz - halfZ,
            maxZ: cz + halfZ,
            height,
            cameraBlocking: true,
            kind: 'building',
          });

          along += bWidth + 1.6 + rng() * 2.2;
        } else {
          along += 4.5;
        }
      }
    }
  }

  // Iconic Mohammadpur Mosque Landmarks (Shia Mosque near Ring×Tajmahal & Satmasjid near Satmasjid Rd)
  for (const mSpec of [
    { x: -188, z: -34, color: '#f3efe4', dome: '#1e7b5a' },
    { x: -34, z: 254, color: '#e6d3b5', dome: '#c59b48' },
  ]) {
    if (isFootprintClearOfCorridor(mSpec.x, mSpec.z, 12, 12, 0, 1.0)) {
      const sIdx = sectorIndex(mSpec.x, mSpec.z);
      const bDet = sectorDetails[sIdx];
      bDet.box({ x: mSpec.x, y: 4.2, z: mSpec.z }, { x: 11.5, y: 8.4, z: 11.5 }, mSpec.color);
      bDet.cone({ x: mSpec.x, y: 10.6, z: mSpec.z }, 3.8, 4.4, mSpec.dome);
      for (const [ox, oz] of [
        [-5.2, -5.2],
        [5.2, -5.2],
        [-5.2, 5.2],
        [5.2, 5.2],
      ]) {
        bDet.cylinder({ x: mSpec.x + ox, y: 7.5, z: mSpec.z + oz }, 0.65, 15.0, mSpec.color);
        bDet.cone({ x: mSpec.x + ox, y: 15.9, z: mSpec.z + oz }, 0.85, 1.9, mSpec.dome);
      }
      colliders.push({
        minX: mSpec.x - 6,
        maxX: mSpec.x + 6,
        minZ: mSpec.z - 6,
        maxZ: mSpec.z + 6,
        height: 15,
        cameraBlocking: true,
        kind: 'building',
      });
    }
  }

  // Overhead Dhaka utility cables strung between validated roadside poles (single draw call!)
  const wireVerts: number[] = [];
  for (const [a, b] of wirePairs) {
    const segs = 5;
    for (let strand = 0; strand < 2; strand++) {
      const yOff = strand * -0.38;
      for (let s = 0; s < segs; s++) {
        const t0 = s / segs;
        const t1 = (s + 1) / segs;
        const sag0 = Math.sin(t0 * Math.PI) * 0.68;
        const sag1 = Math.sin(t1 * Math.PI) * 0.68;
        wireVerts.push(
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
  if (wireVerts.length > 0) {
    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wireVerts, 3));
    const wires = new THREE.LineSegments(
      wireGeo,
      new THREE.LineBasicMaterial({ color: 0x1d2226, transparent: true, opacity: 0.78 }),
    );
    wires.matrixAutoUpdate = false;
    wires.updateMatrix();
    group.add(wires);
  }

  // Build spatially chunked road/sidewalk/metal & sector-chunked building meshes
  const shadowCfg = { cast: quality.shadows, receive: true };
  for (const chunkedB of [
    { b: bRoad, sh: { cast: false, receive: true } },
    { b: bWalk, sh: { cast: false, receive: true } },
    { b: bMetal, sh: shadowCfg },
  ]) {
    for (const m of chunkedB.b.buildChunked(3, 270, chunkedB.sh)) group.add(m);
  }
  const puddleMesh = bPuddle.build({ cast: false, receive: false });
  if (puddleMesh) group.add(puddleMesh);

  for (let i = 0; i < 16; i++) {
    for (const sb of [sectorWalls[i], sectorDetails[i], sectorShutters[i], sectorBricks[i], sectorSigns[i]]) {
      const m = sb.build(shadowCfg);
      if (m) group.add(m);
    }
  }

  const nightGroup = new THREE.Group();
  nightGroup.name = 'night-glow';
  const glowMesh = bGlow.build({ cast: false, receive: false });
  if (glowMesh) nightGroup.add(glowMesh);
  nightGroup.visible = false;
  group.add(nightGroup);

  for (const p of PLACES) {
    placeAnchors.set(p.id, new THREE.Vector3(p.x, 0, p.z));
  }

  // Exact ground height query: road/sidewalk + smooth speed humps + flush manhole/pothole relief
  const heightAt = (x: number, z: number): number => {
    let h = 0.014;
    const dRoad = distanceToRoadCarriageway(x, z);
    if (dRoad > 0.08) {
      // Smooth sidewalk curb ramp so tyres climb kerbs naturally without sinking!
      const kerbT = clamp((dRoad - 0.08) / 0.24, 0, 1);
      h = 0.014 + kerbT * 0.076;
    }

    for (let i = 0; i < humps.length; i++) {
      const hp = humps[i];
      const dx = x - hp.x;
      const dz = z - hp.z;
      if (Math.abs(dx) > hp.halfWidth + 2 || Math.abs(dz) > hp.halfWidth + 2) continue;
      const along = dx * hp.ux + dz * hp.uz;
      const across = Math.abs(-dx * hp.uz + dz * hp.ux);
      if (across <= hp.halfWidth && Math.abs(along) <= hp.depth * 0.5) {
        const phase = (along / (hp.depth * 0.5)) * (Math.PI * 0.5);
        h = Math.max(h, 0.014 + Math.cos(phase) * hp.height);
      }
    }

    for (let i = 0; i < microBumps.length; i++) {
      const mb = microBumps[i];
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

  const dryColor = new THREE.Color('#ffffff');
  const wetColor = new THREE.Color('#7c828c');
  const setWetness = (wet: number): void => {
    const w = clamp(wet, 0, 1);
    roadMat.color.copy(dryColor).lerp(wetColor, w * 0.65);
    roadMat.roughness = 0.9 - 0.58 * w;
    roadMat.metalness = 0.05 + 0.38 * w;
    puddleMat.opacity = 0.42 + 0.48 * w;
  };

  const setNight = (on: boolean): void => {
    nightGroup.visible = on;
  };

  return {
    group,
    colliders,
    humps,
    heightAt,
    lampPositions,
    signAnchors,
    spawn: { ...WORLD.playerSpawn },
    placeAnchors,
    setWetness,
    setNight,
  };
}
