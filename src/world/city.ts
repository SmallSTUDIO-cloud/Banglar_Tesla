/**
 * Procedural city builder — one compact Old-Dhaka-inspired neighbourhood.
 *
 * Everything is authored from the data in `layout.ts`, merged into a handful of
 * meshes, and returns cheap AABB colliders used by the rickshaw, camera and AI.
 */

import * as THREE from 'three';
import { Bucket, tintedMaterial, type UvRect } from './geo';
import {
  asphaltTexture,
  plasterTexture,
  brickTexture,
  shutterTexture,
  clothTexture,
  pavementTexture,
  awningTexture,
  paintTexture,
  posterTexture,
  SignAtlas,
  waterTexture,
} from './textures';
import { BLOCKS, ROADS, SIGN_POOL, type BlockDef, type RoadDef, type SignDef } from './layout';
import { mulberry32, clamp } from '../core/mathx';

export interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  /** Tall structures block the camera; low ones (kerbs, ledges) do not. */
  cameraBlocking: boolean;
  kind: 'building' | 'prop' | 'wall';
}

export interface SpeedHump {
  x: number;
  z: number;
  halfWidth: number;
  depth: number;
  height: number;
  /** 'z' = hump crosses a road running along Z (varies with z). */
  axis: 'x' | 'z';
}

export interface CityResult {
  group: THREE.Group;
  colliders: Collider[];
  humps: SpeedHump[];
  /** Signed height of the road surface at a world position. */
  heightAt: (x: number, z: number) => number;
  lampPositions: THREE.Vector3[];
  signAnchors: THREE.Vector3[];
  spawn: { x: number; z: number; yaw: number };
  placeAnchors: Map<string, THREE.Vector3>;
  setWetness: (wet: number) => void;
  setNight: (on: boolean) => void;
}

let resultSetWetness: (wet: number) => void = () => undefined;
let resultSetNight: (on: boolean) => void = () => undefined;

const PLASTER_TINTS = ['#e9dcc4', '#ddc9a9', '#d7bda8', '#cfd3bf', '#d8c4c8', '#c3ccd0', '#e5d2a4', '#cbb99b'];
const GROUND_TINTS = ['#8f8a80', '#9a9488', '#86827a'];

function hash2(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function smoothNoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

interface Face {
  /** Facade centre on the block edge. */
  cx: number;
  cz: number;
  /** Outward normal. */
  nx: number;
  nz: number;
  /** Horizontal tangent along the facade. */
  tx: number;
  tz: number;
  /** Facade length available. */
  length: number;
}

function plainMaterial(color: THREE.ColorRepresentation, roughness = 0.85): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05 });
}

/** Build the whole neighbourhood. */
export function buildCity(signAtlas: SignAtlas, quality: { shadows: boolean }): CityResult {
  const group = new THREE.Group();
  group.name = 'city';
  const colliders: Collider[] = [];
  const humps: SpeedHump[] = [];
  const lampPositions: THREE.Vector3[] = [];
  const signAnchors: THREE.Vector3[] = [];
  const rng = mulberry32(20240517);

  // ---------------------------------------------------------------- ground
  const groundGeo = new THREE.PlaneGeometry(300, 300, 80, 80);
  groundGeo.rotateX(-Math.PI / 2);
  const gpos = groundGeo.getAttribute('position');
  const gcolors = new Float32Array(gpos.count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < gpos.count; i++) {
    const x = gpos.getX(i);
    const z = gpos.getZ(i);
    const n = smoothNoise(x * 0.055, z * 0.055) * 0.6 + smoothNoise(x * 0.22, z * 0.22) * 0.4;
    // keep the road bright enough to read as sunlit dust-grey asphalt
    const t = 0.86 + n * 0.3;
    tmp.set(GROUND_TINTS[Math.floor(n * 2.99)]);
    gcolors[i * 3] = tmp.r * t;
    gcolors[i * 3 + 1] = tmp.g * t;
    gcolors[i * 3 + 2] = tmp.b * t;
  }
  groundGeo.setAttribute('color', new THREE.BufferAttribute(gcolors, 3));
  const asphalt = asphaltTexture();
  asphalt.repeat.set(68, 68);
  const groundMat = new THREE.MeshStandardMaterial({
    map: asphalt,
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.03,
    color: 0xffffff,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  ground.name = 'ground';
  group.add(ground);

  // ------------------------------------------------------ material buckets
  const plaster = plasterTexture();
  plaster.repeat.set(1, 1);
  const brick = brickTexture();
  brick.repeat.set(1, 1);
  const pavement = pavementTexture();
  pavement.repeat.set(4, 1);
  const cloth = clothTexture();
  cloth.repeat.set(2, 1);
  const shutter = shutterTexture();

  const bWall = new Bucket('walls', tintedMaterial(plaster, { roughness: 0.93 }));
  const bBrick = new Bucket('brick', tintedMaterial(brick, { roughness: 0.95 }));
  const bTrim = new Bucket('trim', tintedMaterial(plaster, { roughness: 0.75 }));
  const bGlass = new Bucket(
    'glass',
    tintedMaterial(null, { roughness: 0.18, metalness: 0.55, color: 0xffffff, envMapIntensity: 1.1 }),
  );
  const bMetal = new Bucket('metal', tintedMaterial(shutter, { roughness: 0.55, metalness: 0.45 }));
  const bWood = new Bucket('wood', tintedMaterial(null, { roughness: 0.82, metalness: 0.02 }));
  const bCloth = new Bucket('cloth', tintedMaterial(cloth, { roughness: 0.95, side: THREE.DoubleSide }));
  const bPave = new Bucket('pavement', tintedMaterial(pavement, { roughness: 0.94 }));
  const bPaint = new Bucket('paint', tintedMaterial(paintTexture(), { roughness: 0.7, metalness: 0.1 }));
  const bSign = new Bucket('signs', tintedMaterial(signAtlas.texture, { roughness: 0.72 }));
  const bPoster = new Bucket('posters', tintedMaterial(posterTexture(), { roughness: 0.9 }));
  // Warm shop / window light that only shows at dusk and night.
  const bGlow = new Bucket(
    'night-glow',
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );

  // ------------------------------------------------------- road furniture
  const isCovered = (axis: 'x' | 'z', coord: number, along: number): boolean => {
    for (const road of ROADS) {
      if (road.axis === axis) continue;
      if (Math.abs(coord - road.center) > road.width / 2 + road.sidewalk + 0.05) continue;
      if (along < road.from - road.width || along > road.to + road.width) continue;
      return true;
    }
    return false;
  };

  /** Strips of sidewalk + kerb along both sides of a road, split at junctions. */
  const addSidewalks = (road: RoadDef): void => {
    const half = road.width / 2;
    const sw = road.sidewalk;
    const segments: { a: number; b: number }[] = [];
    const cuts: number[] = [];
    for (const other of ROADS) {
      if (other.axis === road.axis) continue;
      if (Math.abs(other.center - road.center) > other.width / 2 + other.sidewalk + 0.2) continue;
      if (other.from > road.to || other.to < road.from) continue;
      cuts.push(other.from, other.to);
    }
    cuts.sort((a, b) => a - b);
    let cursor = road.from;
    for (const c of cuts) {
      if (c > cursor + 0.4) segments.push({ a: cursor, b: c });
      cursor = Math.max(cursor, c);
    }
    if (road.to > cursor + 0.4) segments.push({ a: cursor, b: road.to });

    for (const seg of segments) {
      if (seg.b - seg.a < 1.2) continue;
      for (const side of [-1, 1]) {
        const lateral = side * (half + sw / 2);
        const centerAlong = (seg.a + seg.b) / 2;
        const len = seg.b - seg.a;
        if (road.axis === 'z') {
          bPave.box({ x: road.center + lateral, y: 0.07, z: centerAlong }, { x: sw, y: 0.14, z: len }, '#b6b0a2');
          bPave.box(
            { x: road.center + side * (half + 0.08), y: 0.09, z: centerAlong },
            { x: 0.18, y: 0.18, z: len },
            '#d9d2c2',
          );
        } else {
          bPave.box({ x: centerAlong, y: 0.07, z: road.center + lateral }, { x: len, y: 0.14, z: sw }, '#b6b0a2');
          bPave.box(
            { x: centerAlong, y: 0.09, z: road.center + side * (half + 0.08) },
            { x: len, y: 0.18, z: 0.18 },
            '#d9d2c2',
          );
        }
      }
    }
    void isCovered;
  };
  ROADS.forEach(addSidewalks);

  /**
   * Aprons: fill the strip between the kerb and the building line so no raw
   * ground shows between the footpath and the shops (also hides seams where
   * road widths and block offsets disagree).
   */
  const addAprons = (): void => {
    for (const block of BLOCKS) {
      const width = block.x2 - block.x1;
      const depth = block.z2 - block.z1;
      const apronW = 3.4;
      for (const face of block.faces) {
        if (face === 'n' || face === 's') {
          const z = face === 'n' ? block.z1 - apronW / 2 : block.z2 + apronW / 2;
          bPave.box({ x: (block.x1 + block.x2) / 2, y: 0.07, z }, { x: width, y: 0.14, z: apronW }, '#b8b2a4');
        } else {
          const x = face === 'w' ? block.x1 - apronW / 2 : block.x2 + apronW / 2;
          bPave.box({ x, y: 0.07, z: (block.z1 + block.z2) / 2 }, { x: apronW, y: 0.14, z: depth }, '#b8b2a4');
        }
      }
    }
  };
  addAprons();

  // ------------------------------------------------------- road markings
  const addMarkings = (): void => {
    for (const road of ROADS) {
      if (!road.markings) continue;
      const dashLen = 3.2;
      const gap = 3.6;
      for (let a = road.from + 3; a < road.to - 3; a += dashLen + gap) {
        const isJunction = ROADS.some(
          (o) =>
            o.axis !== road.axis &&
            Math.abs(o.center - road.center) < o.width / 2 + o.sidewalk &&
            a > o.from - 4 &&
            a < o.to + 4,
        );
        if (isJunction) continue;
        if (road.axis === 'z') {
          bPaint.box({ x: road.center, y: 0.012, z: a + dashLen / 2 }, { x: 0.14, y: 0.02, z: dashLen }, '#e9e4d6');
        } else {
          bPaint.box({ x: a + dashLen / 2, y: 0.012, z: road.center }, { x: dashLen, y: 0.02, z: 0.14 }, '#e9e4d6');
        }
      }
      // kerb-side worn edge lines
      for (const side of [-1, 1]) {
        if (road.axis === 'z') {
          bPaint.box(
            { x: road.center + side * (road.width / 2 - 0.45), y: 0.011, z: (road.from + road.to) / 2 },
            { x: 0.1, y: 0.018, z: Math.min(180, road.to - road.from) },
            '#cfc8b6',
          );
        }
      }
    }
    // zebra crossings around the main junction
    const zebra = (cx: number, cz: number, along: 'x' | 'z'): void => {
      for (let i = -4; i <= 4; i++) {
        if (along === 'x') {
          bPaint.box({ x: cx + i * 0.62, y: 0.013, z: cz }, { x: 0.3, y: 0.02, z: 3.4 }, '#efe9d9');
        } else {
          bPaint.box({ x: cx, y: 0.013, z: cz + i * 0.62 }, { x: 3.4, y: 0.02, z: 0.3 }, '#efe9d9');
        }
      }
    };
    zebra(0, 6.4, 'x');
    zebra(0, -6.4, 'x');
    zebra(-6.4, 0, 'z');
    zebra(6.4, 0, 'z');
  };
  addMarkings();

  // ---------------------------------------------------------- speed humps
  const humpDefs: SpeedHump[] = [
    { x: 0, z: 30, halfWidth: 5.4, depth: 1.5, height: 0.17, axis: 'z' },
    { x: 0, z: -28, halfWidth: 5.4, depth: 1.4, height: 0.15, axis: 'z' },
    { x: -30, z: 0, halfWidth: 4.6, depth: 1.3, height: 0.14, axis: 'x' },
    { x: 52, z: 44, halfWidth: 3.2, depth: 1.2, height: 0.12, axis: 'x' },
  ];
  humps.push(...humpDefs);
  for (const h of humpDefs) {
    if (h.axis === 'z') {
      bPaint.box({ x: h.x, y: h.height / 2, z: h.z }, { x: h.halfWidth * 2, y: h.height, z: h.depth * 2 }, '#4a4a46');
    } else {
      bPaint.box({ x: h.x, y: h.height / 2, z: h.z }, { x: h.depth * 2, y: h.height, z: h.halfWidth * 2 }, '#4a4a46');
    }
  }

  const heightAt = (x: number, z: number): number => {
    let h = 0;
    for (const hump of humpDefs) {
      const along = hump.axis === 'z' ? z : x;
      const across = hump.axis === 'z' ? x : z;
      const d = Math.abs(along - (hump.axis === 'z' ? hump.z : hump.x));
      if (d > hump.depth || Math.abs(across - (hump.axis === 'z' ? hump.x : hump.z)) > hump.halfWidth) continue;
      const t = 1 - d / hump.depth;
      h = Math.max(h, hump.height * Math.sin((t * Math.PI) / 2) ** 1.2);
    }
    return h;
  };

  // -------------------------------------------------------------- buildings
  const addSign = (def: SignDef, pos: THREE.Vector3, width: number, height: number, yaw: number): void => {
    const uv: UvRect = signAtlas.uvFor(def);
    bSign.quad(pos, width, height, '#ffffff', { y: yaw }, uv);
    signAnchors.push(pos.clone());
  };

  const buildFacade = (block: BlockDef, face: Face, storeys: number): void => {
    const rngLocal = mulberry32(Math.floor(face.cx * 13 + face.cz * 7 + block.id.length * 31));
    let cursor = -face.length / 2;
    const yaw = Math.atan2(face.nx, face.nz);
    while (cursor < face.length / 2 - 3) {
      const width = clamp(4.4 + rngLocal() * 6.2, 4.4, Math.min(11, face.length / 2 - cursor + 4.4));
      const buildingWidth = Math.min(width, face.length / 2 - cursor);
      if (buildingWidth < 3.4) break;
      const depth = 8.5 + rngLocal() * 4.5;
      const floorCount = Math.round(storeys + (rngLocal() - 0.5) * 1.4);
      const floors = Math.max(1, Math.min(5, floorCount));
      const groundH = block.style === 'shops' ? 3.5 : 3.0;
      const upperH = 3.05;
      const height = groundH + (floors - 1) * upperH + 0.75;
      const alongOffset = cursor + buildingWidth / 2;
      cursor += buildingWidth + 0.12;

      // facade point + inward direction
      const fx = face.cx + face.tx * alongOffset;
      const fz = face.cz + face.tz * alongOffset;
      const bodyCx = fx - face.nx * (depth / 2);
      const bodyCz = fz - face.nz * (depth / 2);
      const tint = PLASTER_TINTS[Math.floor(rngLocal() * PLASTER_TINTS.length)];
      const useBrick = rngLocal() < 0.18;

      // main mass
      const sizeX = Math.abs(face.nx) > 0.5 ? depth : buildingWidth;
      const sizeZ = Math.abs(face.nx) > 0.5 ? buildingWidth : depth;
      (useBrick ? bBrick : bWall).box(
        { x: bodyCx, y: height / 2, z: bodyCz },
        { x: sizeX, y: height, z: sizeZ },
        useBrick ? '#c08b6e' : tint,
      );

      // plinth / foundation band
      bTrim.box(
        { x: bodyCx, y: 0.42, z: bodyCz },
        { x: sizeX + 0.14, y: 0.85, z: sizeZ + 0.14 },
        useBrick ? '#9c7059' : '#b9ac95',
      );

      // parapet
      const parapetH = 0.72;
      bTrim.box(
        { x: bodyCx, y: height + parapetH / 2, z: bodyCz },
        { x: sizeX + 0.16, y: parapetH, z: sizeZ + 0.16 },
        useBrick ? '#b07f63' : '#c6b795',
      );
      // roof slab line
      bTrim.box(
        { x: bodyCx, y: height + 0.06, z: bodyCz },
        { x: sizeX + 0.22, y: 0.12, z: sizeZ + 0.22 },
        '#a99b83',
      );

      const facadeX = fx + face.nx * 0.03;
      const facadeZ = fz + face.nz * 0.03;

      // ground floor: shopfront or house door
      const shop = block.style === 'shops' ? rngLocal() < 0.82 : rngLocal() < 0.32;
      if (shop) {
        const openW = buildingWidth * 0.72;
        // dark interior recess
        bGlass.box(
          { x: facadeX - face.nx * 0.45, y: groundH * 0.46, z: facadeZ - face.nz * 0.45 },
          {
            x: Math.abs(face.nx) > 0.5 ? 0.9 : openW,
            y: groundH * 0.8,
            z: Math.abs(face.nx) > 0.5 ? openW : 0.9,
          },
          '#3b3630',
        );
        // warm interior back wall so the opening reads as a lit shop, not a hole
        bCloth.quad(
          { x: facadeX - face.nx * 0.82, y: groundH * 0.44, z: facadeZ - face.nz * 0.82 },
          openW * 0.92,
          groundH * 0.7,
          rngLocal() < 0.5 ? '#6b5433' : '#4a5a4a',
          { y: yaw },
        );
        // shutter (half-open on some)
        const closed = rngLocal() < 0.45;
        const shutterH = closed ? groundH * 0.78 : groundH * 0.2;
        bMetal.box(
          {
            x: facadeX + face.nx * 0.06,
            y: groundH - shutterH / 2 - 0.05,
            z: facadeZ + face.nz * 0.06,
          },
          {
            x: Math.abs(face.nx) > 0.5 ? 0.1 : openW,
            y: shutterH,
            z: Math.abs(face.nx) > 0.5 ? openW : 0.1,
          },
          closed ? '#9aa0a4' : '#7f858a',
        );
        if (!closed && rngLocal() < 0.85) {
          // Light spilling out of the open shopfront. Sits just in front of the
          // facade so the opaque recess box never hides it.
          bGlow.quad(
            { x: facadeX + face.nx * 0.04, y: groundH * 0.5, z: facadeZ + face.nz * 0.04 },
            openW * 0.9,
            groundH * 0.62,
            rngLocal() < 0.5 ? '#ffc978' : '#ffe1ac',
            { y: yaw },
          );
        }
        // sign board above the shop
        const def = SIGN_POOL[Math.floor(rngLocal() * SIGN_POOL.length)];
        const signW = Math.min(buildingWidth * 0.86, 4.6);
        addSign(
          def,
          new THREE.Vector3(facadeX + face.nx * 0.09, groundH + 0.28, facadeZ + face.nz * 0.09),
          signW,
          0.95,
          yaw,
        );
        // striped awning
        if (rngLocal() < 0.62) {
          const awningTex = awningTexture(rngLocal() < 0.5 ? '#1f6b4f' : '#8c2f22');
          void awningTex;
          const aw = Math.min(buildingWidth * 0.8, 4.2);
          const depthA = 1.35;
          const ax = facadeX + face.nx * (depthA / 2);
          const az = facadeZ + face.nz * (depthA / 2);
          bCloth.quad(
            { x: ax, y: groundH - 0.22, z: az },
            aw,
            depthA,
            rngLocal() < 0.5 ? '#2f7d5a' : '#a83a2a',
            { x: -Math.PI / 2 + 0.18, y: yaw },
          );
        }
        // step
        bPave.box(
          { x: facadeX + face.nx * 0.3, y: 0.09, z: facadeZ + face.nz * 0.3 },
          { x: Math.abs(face.nx) > 0.5 ? 0.65 : openW + 0.3, y: 0.18, z: Math.abs(face.nx) > 0.5 ? openW + 0.3 : 0.65 },
          '#a9a294',
        );
      } else {
        // residential door + small window
        const doorW = 1.05;
        bWood.box(
          { x: facadeX + face.nx * 0.02, y: 1.05, z: facadeZ + face.nz * 0.02 },
          { x: Math.abs(face.nx) > 0.5 ? 0.12 : doorW, y: 2.1, z: Math.abs(face.nx) > 0.5 ? doorW : 0.12 },
          rngLocal() < 0.5 ? '#6d4526' : '#4e5a3c',
        );
        bTrim.box(
          { x: facadeX + face.nx * 0.05, y: 2.2, z: facadeZ + face.nz * 0.05 },
          { x: Math.abs(face.nx) > 0.5 ? 0.16 : doorW + 0.28, y: 0.14, z: Math.abs(face.nx) > 0.5 ? doorW + 0.28 : 0.16 },
          '#d8cdb4',
        );
      }

      // upper floors: windows + balconies
      const columns = Math.max(1, Math.floor(buildingWidth / 2.6));
      const spacing = buildingWidth / columns;
      for (let f = 1; f < floors; f++) {
        const floorY = groundH + (f - 1) * upperH;
        const hasBalcony = rngLocal() < 0.55;
        if (hasBalcony) {
          const balW = Math.min(buildingWidth * 0.82, columns * spacing * 0.72);
          const balDepth = 0.85;
          const bx = facadeX + face.nx * (balDepth / 2);
          const bz = facadeZ + face.nz * (balDepth / 2);
          bTrim.box(
            { x: bx, y: floorY + 0.06, z: bz },
            { x: Math.abs(face.nx) > 0.5 ? balDepth : balW, y: 0.13, z: Math.abs(face.nx) > 0.5 ? balW : balDepth },
            '#c3b699',
          );
          // railing
          const railH = 0.95;
          const railY = floorY + 0.06 + railH / 2;
          const railX = facadeX + face.nx * (balDepth - 0.05);
          const railZ = facadeZ + face.nz * (balDepth - 0.05);
          bMetal.box(
            { x: railX, y: floorY + railH, z: railZ },
            { x: Math.abs(face.nx) > 0.5 ? 0.07 : balW, y: 0.07, z: Math.abs(face.nx) > 0.5 ? balW : 0.07 },
            '#5d646a',
          );
          const bars = Math.max(3, Math.floor(balW / 0.34));
          for (let i = 0; i < bars; i++) {
            const t = -balW / 2 + (i + 0.5) * (balW / bars);
            bMetal.box(
              {
                x: railX + face.tx * t,
                y: railY + 0.06,
                z: railZ + face.tz * t,
              },
              { x: 0.05, y: railH, z: 0.05 },
              '#6a7278',
            );
          }
          // laundry on some balconies
          if (rngLocal() < 0.4) {
            const colors = ['#c9d8e8', '#e8c9c9', '#e8e0b8', '#b8e0c9', '#e8d4a8'];
            const count = 2 + Math.floor(rngLocal() * 3);
            for (let i = 0; i < count; i++) {
              const t = (i - (count - 1) / 2) * 0.55;
              bCloth.quad(
                {
                  x: railX + face.tx * t + face.nx * 0.18,
                  y: floorY + 0.05,
                  z: railZ + face.tz * t + face.nz * 0.18,
                },
                0.44,
                0.62,
                colors[Math.floor(rngLocal() * colors.length)],
                { y: yaw },
              );
            }
          }
        }
        for (let c = 0; c < columns; c++) {
          const t = -buildingWidth / 2 + (c + 0.5) * spacing;
          const wx = facadeX + face.tx * t;
          const wz = facadeZ + face.tz * t;
          const winW = Math.min(1.25, spacing * 0.55);
          const winH = 1.35;
          const wy = floorY + 1.72;
          if (rngLocal() < 0.38) {
            bGlow.quad(
              { x: wx + face.nx * 0.125, y: wy, z: wz + face.nz * 0.125 },
              winW * 0.72,
              winH * 0.7,
              rngLocal() < 0.45 ? '#ffcf88' : '#dceaff',
              { y: yaw },
            );
          }
          // glass
          bGlass.box(
            { x: wx + face.nx * 0.02, y: wy, z: wz + face.nz * 0.02 },
            { x: Math.abs(face.nx) > 0.5 ? 0.1 : winW, y: winH, z: Math.abs(face.nx) > 0.5 ? winW : 0.1 },
            rngLocal() < 0.2 ? '#3a4a52' : '#1a2a32',
          );
          // frame
          bTrim.box(
            { x: wx + face.nx * 0.06, y: wy, z: wz + face.nz * 0.06 },
            { x: Math.abs(face.nx) > 0.5 ? 0.08 : winW + 0.16, y: winH + 0.16, z: Math.abs(face.nx) > 0.5 ? winW + 0.16 : 0.08 },
            rngLocal() < 0.5 ? '#d9d0bb' : '#8a9a86',
          );
          // sill
          bTrim.box(
            { x: wx + face.nx * 0.12, y: wy - winH / 2 - 0.08, z: wz + face.nz * 0.12 },
            { x: Math.abs(face.nx) > 0.5 ? 0.24 : winW + 0.26, y: 0.08, z: Math.abs(face.nx) > 0.5 ? winW + 0.26 : 0.24 },
            '#cfc4ab',
          );
        }
      }

      // AC units / pipes / posters
      if (rngLocal() < 0.5) {
        const acCount = 1 + Math.floor(rngLocal() * 2);
        for (let i = 0; i < acCount; i++) {
          const t = (rngLocal() - 0.5) * buildingWidth * 0.7;
          const y = 3.9 + rngLocal() * Math.max(0.5, height - 4.6);
          bMetal.box(
            { x: facadeX + face.nx * 0.28 + face.tx * t, y, z: facadeZ + face.nz * 0.28 + face.tz * t },
            { x: Math.abs(face.nx) > 0.5 ? 0.5 : 0.82, y: 0.52, z: Math.abs(face.nx) > 0.5 ? 0.82 : 0.5 },
            '#a9adaf',
          );
        }
      }
      if (rngLocal() < 0.45) {
        const t = (rngLocal() - 0.5) * buildingWidth * 0.65;
        bMetal.box(
          { x: facadeX + face.nx * 0.14 + face.tx * t, y: height * 0.5, z: facadeZ + face.nz * 0.14 + face.tz * t },
          { x: 0.12, y: height, z: 0.12 },
          '#6d7276',
        );
      }
      if (rngLocal() < 0.3) {
        const t = (rngLocal() - 0.5) * buildingWidth * 0.6;
        bPoster.quad(
          {
            x: facadeX + face.nx * 0.04 + face.tx * t,
            y: 2.2 + rngLocal() * 0.8,
            z: facadeZ + face.nz * 0.04 + face.tz * t,
          },
          0.72,
          0.95,
          '#ffffff',
          { y: yaw },
        );
      }

      // rooftop clutter
      if (rngLocal() < 0.7) {
        const tankX = bodyCx + (rngLocal() - 0.5) * sizeX * 0.4;
        const tankZ = bodyCz + (rngLocal() - 0.5) * sizeZ * 0.4;
        bTrim.cylinder({ x: tankX, y: height + 1.15, z: tankZ }, 0.62, 1.15, '#c9d2d4');
        bMetal.cylinder({ x: tankX, y: height + 1.78, z: tankZ }, 0.64, 0.1, '#8b9698');
        bMetal.cylinder({ x: tankX, y: height + 0.2, z: tankZ }, 0.42, 0.5, '#7f8a8c');
      }
      if (rngLocal() < 0.35) {
        // small rooftop room / stair head
        bWall.box(
          { x: bodyCx + sizeX * 0.22, y: height + 1.1, z: bodyCz - sizeZ * 0.2 },
          { x: 2.2, y: 2.2, z: 2.0 },
          '#c9bda3',
        );
      }

      colliders.push({
        minX: bodyCx - sizeX / 2,
        maxX: bodyCx + sizeX / 2,
        minZ: bodyCz - sizeZ / 2,
        maxZ: bodyCz + sizeZ / 2,
        height,
        cameraBlocking: true,
        kind: 'building',
      });
    }
  };

  for (const block of BLOCKS) {
    const faces: Face[] = [];
    const width = block.x2 - block.x1;
    const depth = block.z2 - block.z1;
    for (const f of block.faces) {
      if (f === 'n') {
        faces.push({ cx: (block.x1 + block.x2) / 2, cz: block.z1, nx: 0, nz: -1, tx: 1, tz: 0, length: width });
      } else if (f === 's') {
        faces.push({ cx: (block.x1 + block.x2) / 2, cz: block.z2, nx: 0, nz: 1, tx: -1, tz: 0, length: width });
      } else if (f === 'w') {
        faces.push({ cx: block.x1, cz: (block.z1 + block.z2) / 2, nx: -1, nz: 0, tx: 0, tz: 1, length: depth });
      } else {
        faces.push({ cx: block.x2, cz: (block.z1 + block.z2) / 2, nx: 1, nz: 0, tx: 0, tz: -1, length: depth });
      }
    }
    const storeys = block.storeys[0] + Math.floor(rng() * (block.storeys[1] - block.storeys[0] + 1));
    for (const face of faces) buildFacade(block, face, storeys);
  }

  // --------------------------------------------------------------- far edge
  // Low boundary walls close the map so the player cannot drive into the void.
  const wallTint = '#b8ad97';
  const boundary = [
    { x: 0, z: -114, w: 240, d: 2 },
    { x: 0, z: 114, w: 240, d: 2 },
    { x: -118, z: 0, w: 2, d: 230 },
    { x: 118, z: 0, w: 2, d: 230 },
  ];
  for (const b of boundary) {
    bWall.box({ x: b.x, y: 1.4, z: b.z }, { x: b.w, y: 2.8, z: b.d }, wallTint);
    colliders.push({
      minX: b.x - b.w / 2,
      maxX: b.x + b.w / 2,
      minZ: b.z - b.d / 2,
      maxZ: b.z + b.d / 2,
      height: 2.8,
      cameraBlocking: false,
      kind: 'wall',
    });
  }

  // ------------------------------------------------------------ riverfront
  const water = waterTexture();
  water.repeat.set(6, 3);
  const riverGeo = new THREE.PlaneGeometry(260, 90, 1, 1);
  riverGeo.rotateX(-Math.PI / 2);
  const river = new THREE.Mesh(
    riverGeo,
    new THREE.MeshStandardMaterial({
      map: water,
      color: 0x88a89a,
      roughness: 0.22,
      metalness: 0.55,
      transparent: true,
      opacity: 0.94,
    }),
  );
  river.position.set(0, -0.55, -152);
  river.name = 'river';
  group.add(river);
  // ghat steps down to the water
  for (let i = 0; i < 5; i++) {
    bPave.box(
      { x: 0, y: -0.1 - i * 0.16, z: -104 - i * 1.6 },
      { x: 26, y: 0.3, z: 1.7 },
      i % 2 ? '#a9a294' : '#b6afa1',
    );
  }
  // moored boats silhouettes
  for (let i = 0; i < 4; i++) {
    const bx = -30 + i * 20 + (i % 2) * 4;
    const bz = -122 - (i % 3) * 7;
    const boat = new THREE.Mesh(
      new THREE.CapsuleGeometry(1.6, 7, 3, 8),
      plainMaterial(new THREE.Color(i % 2 ? '#5a3a1e' : '#3e5a4e'), 0.9),
    );
    boat.rotation.z = Math.PI / 2;
    boat.rotation.y = (i % 2 ? 1 : -1) * 0.25;
    boat.position.set(bx, 0.2, bz);
    boat.scale.set(1, 0.55, 1);
    group.add(boat);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 6, 5), plainMaterial('#6a5a44'));
    mast.position.set(bx, 3, bz);
    group.add(mast);
  }

  // ------------------------------------------------------------ power lines
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x6b6f70, roughness: 0.8, metalness: 0.25 });
  const poleGeo = new THREE.CylinderGeometry(0.13, 0.17, 8.6, 6);
  const polePositions: { x: number; z: number }[] = [];
  for (let z = -100; z <= 100; z += 22) {
    polePositions.push({ x: -6.6, z });
    polePositions.push({ x: 6.6, z: z + 11 });
  }
  const poleMesh = new THREE.InstancedMesh(poleGeo, poleMat, polePositions.length);
  const m = new THREE.Matrix4();
  polePositions.forEach((p, i) => {
    m.makeTranslation(p.x, 4.3, p.z);
    poleMesh.setMatrixAt(i, m);
  });
  poleMesh.instanceMatrix.needsUpdate = true;
  poleMesh.castShadow = quality.shadows;
  group.add(poleMesh);
  for (const p of polePositions) {
    colliders.push({
      minX: p.x - 0.22,
      maxX: p.x + 0.22,
      minZ: p.z - 0.22,
      maxZ: p.z + 0.22,
      height: 8.6,
      cameraBlocking: false,
      kind: 'prop',
    });
  }

  // catenary wires between poles
  const wirePoints: THREE.Vector3[] = [];
  for (let i = 0; i < polePositions.length - 1; i++) {
    const a = polePositions[i];
    const b = polePositions[i + 1];
    if (a.x !== b.x) continue;
    const sag = 0.9;
    const segs = 7;
    for (let s = 0; s < segs; s++) {
      const t0 = s / segs;
      const t1 = (s + 1) / segs;
      const p0 = new THREE.Vector3(a.x, 8.2 - Math.sin(t0 * Math.PI) * sag, a.z + (b.z - a.z) * t0);
      const p1 = new THREE.Vector3(b.x, 8.2 - Math.sin(t1 * Math.PI) * sag, a.z + (b.z - a.z) * t1);
      wirePoints.push(p0, p1);
      if (s % 2 === 0) {
        const p2 = p0.clone().add(new THREE.Vector3(0.55, -0.35 - Math.sin(t0 * Math.PI) * 0.4, 0));
        const p3 = p1.clone().add(new THREE.Vector3(0.55, -0.35 - Math.sin(t1 * Math.PI) * 0.4, 0));
        wirePoints.push(p2, p3);
      }
    }
  }
  const wireGeo = new THREE.BufferGeometry().setFromPoints(wirePoints);
  const wires = new THREE.LineSegments(
    wireGeo,
    new THREE.LineBasicMaterial({ color: 0x232a2c, transparent: true, opacity: 0.85 }),
  );
  group.add(wires);

  // street lamps at key corners
  // Lamps follow the main road so a night drive always has pools of light.
  const lampSpots = [
    { x: -5.4, z: 47 },
    { x: 5.4, z: 32 },
    { x: -5.4, z: 16 },
    { x: 5.4, z: 0 },
    { x: -5.4, z: -16 },
    { x: 5.4, z: -32 },
    { x: -5.4, z: -48 },
    { x: 5.4, z: -64 },
    { x: -30, z: 3.2 },
    { x: 30, z: -3.2 },
    { x: 3.2, z: 55 },
    { x: -3.2, z: -55 },
  ];
  for (const spot of lampSpots) {
    bMetal.cylinder({ x: spot.x, y: 3.2, z: spot.z }, 0.09, 6.4, '#4c5154');
    bMetal.box({ x: spot.x + (spot.x > 0 ? -0.5 : 0.5), y: 6.3, z: spot.z }, { x: 1.1, y: 0.12, z: 0.16 }, '#4c5154');
    bGlow.add(
      new THREE.SphereGeometry(0.16, 8, 6),
      { x: spot.x + (spot.x > 0 ? -1 : 1), y: 6.12, z: spot.z },
      { x: 1, y: 1, z: 1 },
      '#ffdca8',
    );
    lampPositions.push(new THREE.Vector3(spot.x + (spot.x > 0 ? -1 : 1), 6.15, spot.z));
  }

  // ------------------------------------------------------------ finalise
  const shadowCfg = { cast: quality.shadows, receive: true };
  const nightGroup = new THREE.Group();
  nightGroup.name = 'night-glow';
  const glowMesh = bGlow.build({ cast: false, receive: false });
  if (glowMesh) {
    glowMesh.renderOrder = 2;
    nightGroup.add(glowMesh);
  }
  nightGroup.visible = false;
  group.add(nightGroup);
  resultSetNight = (on: boolean): void => {
    nightGroup.visible = on;
  };

  for (const bucket of [bWall, bBrick, bTrim, bGlass, bMetal, bWood, bCloth, bPave, bPaint, bSign, bPoster]) {
    const mesh = bucket.build(shadowCfg);
    if (mesh) {
      if (bucket === bPaint) {
        mesh.castShadow = false;
      }
      group.add(mesh);
    }
  }

  // Wet roads: the same material darkens and gains a damp sheen as wetness
  // rises, which is cheap on phones (no extra reflections or passes).
  const dryColor = new THREE.Color('#d9d6cc');
  const wetColor = new THREE.Color('#6d7076');
  resultSetWetness = (wet: number): void => {
    const w = Math.max(0, Math.min(1, wet));
    groundMat.color.copy(dryColor).lerp(wetColor, w);
    groundMat.roughness = 0.95 - 0.55 * w;
    groundMat.metalness = 0.03 + 0.35 * w;
    groundMat.needsUpdate = true;
  };

  const placeAnchors = new Map<string, THREE.Vector3>();
  return {
    group,
    colliders,
    humps,
    heightAt,
    lampPositions,
    signAnchors,
    spawn: { x: -1.6, z: 46.5, yaw: Math.PI },
    placeAnchors,
    setWetness: resultSetWetness,
    setNight: resultSetNight,
  };
}
