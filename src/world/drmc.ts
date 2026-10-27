/**
 * Dhaka Residential Model College (DRMC) campus exterior — vNext §1.
 *
 * Evidence-based exterior only: perimeter wall, main arched gate with bilingual
 * signage, white academic blocks, auditorium block, sports grounds and trees.
 * No interior layouts or building names are invented (see `drmcGeo.ts` for the
 * full source/verification note). Merged into 4 buckets (~4 draw calls) with
 * OBB wall/building colliders and a passable gate opening onto the grounds.
 */

import * as THREE from 'three';
import { Bucket } from './geo';
import {
  DRMC_CAMPUS,
  DRMC_GATE,
  DRMC_GATE_ROAD_POINT,
  DRMC_MAIN_BLOCK,
  DRMC_SECOND_BLOCK,
  DRMC_SPORTS_GROUND,
  DRMC_SW_WALL,
  isInsideDrmcCampus,
} from './drmcGeo';
import type { Collider } from './city';
import { makeTexture } from './textures';

export interface DrmcCampusResult {
  group: THREE.Group;
  colliders: Collider[];
  gate: { x: number; z: number };
  campusPolygon: Array<{ x: number; z: number }>;
}

function wallCollider(ax: number, az: number, bx: number, bz: number, height = 2.6): Collider {
  const cx = (ax + bx) * 0.5;
  const cz = (az + bz) * 0.5;
  const len = Math.hypot(bx - ax, bz - az) + 0.35;
  const yaw = Math.atan2(bx - ax, bz - az);
  const halfW = 0.32;
  const cos = Math.abs(Math.cos(yaw));
  const sin = Math.abs(Math.sin(yaw));
  return {
    minX: cx - (halfW * cos + (len * 0.5) * sin),
    maxX: cx + (halfW * cos + (len * 0.5) * sin),
    minZ: cz - (halfW * sin + (len * 0.5) * cos),
    maxZ: cz + (halfW * sin + (len * 0.5) * cos),
    height,
    cameraBlocking: true,
    kind: 'wall',
    cx,
    cz,
    halfX: halfW,
    halfZ: len * 0.5,
    yaw,
  };
}

/** Line-segment distance helper for the gate-gap wall split. */
function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

export function buildDrmcCampus(heightAt: (x: number, z: number) => number): DrmcCampusResult {
  const group = new THREE.Group();
  group.name = 'drmc-campus';
  const colliders: Collider[] = [];

  const wallMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const whiteMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const darkMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const fieldMat = new THREE.MeshLambertMaterial({ vertexColors: true });

  const bWall = new Bucket('drmc.wall', wallMat, true);
  const bWhite = new Bucket('drmc.white', whiteMat, true);
  const bDark = new Bucket('drmc.dark', darkMat, false);
  const bField = new Bucket('drmc.field', fieldMat, false);

  // ---------------------------------------------------------------- walls
  const WALL_H = 2.55;
  const wallRuns: Array<[number, number, number, number]> = [];
  // SW wall follows the Shahjahan chain offset polyline, split around the gate opening
  for (let i = 0; i < DRMC_SW_WALL.length - 1; i++) {
    const a = DRMC_SW_WALL[i];
    const b = DRMC_SW_WALL[i + 1];
    const gateDistA = distToSegment(a.x, a.z, DRMC_GATE.x, DRMC_GATE.z, DRMC_GATE_ROAD_POINT.x, DRMC_GATE_ROAD_POINT.z);
    void gateDistA;
    wallRuns.push([a.x, a.z, b.x, b.z]);
  }
  // Split the SW run that contains the gate into two runs leaving a 6.2 m opening
  const gateHalf = 3.1;
  const splitRuns: Array<[number, number, number, number]> = [];
  for (const [ax, az, bx, bz] of wallRuns) {
    const dGate = distToSegment(DRMC_GATE.x, DRMC_GATE.z, ax, az, bx, bz);
    if (dGate < gateHalf + 1.2) {
      // Trim this run around the gate
      const vx = bx - ax;
      const vz = bz - az;
      const len = Math.hypot(vx, vz) || 1;
      const tGate = ((DRMC_GATE.x - ax) * vx + (DRMC_GATE.z - az) * vz) / (len * len);
      const tA = Math.max(0, tGate - (gateHalf + 0.9) / len);
      const tB = Math.min(1, tGate + (gateHalf + 0.9) / len);
      if (tA > 0.02) splitRuns.push([ax, az, ax + vx * tA, az + vz * tA]);
      if (tB < 0.98) splitRuns.push([ax + vx * tB, az + vz * tB, bx, bz]);
    } else {
      splitRuns.push([ax, az, bx, bz]);
    }
  }
  // Remaining campus edges: B->C (Mirpur frontage), C->D (NE), D->A (N)
  const [A, B, C, D] = DRMC_CAMPUS;
  splitRuns.push([B.x, B.z, C.x, C.z]);
  splitRuns.push([C.x, C.z, D.x, D.z]);
  splitRuns.push([D.x, D.z, A.x, A.z]);

  for (const [ax, az, bx, bz] of splitRuns) {
    const len = Math.hypot(bx - ax, bz - az);
    const mx = (ax + bx) * 0.5;
    const mz = (az + bz) * 0.5;
    const yaw = Math.atan2(bx - ax, bz - az);
    const gy = heightAt(mx, mz);
    // Masonry wall body + darker cap course
    bWall.box({ x: mx, y: gy + WALL_H * 0.5, z: mz }, { x: 0.30, y: WALL_H, z: len }, '#e8dfc9', { y: yaw });
    bWall.box({ x: mx, y: gy + WALL_H + 0.09, z: mz }, { x: 0.40, y: 0.18, z: len + 0.05 }, '#c9bda2', { y: yaw });
    colliders.push(wallCollider(ax, az, bx, bz, WALL_H));
  }

  // ------------------------------------------------------------- main gate
  const gateYaw = Math.atan2(DRMC_GATE_ROAD_POINT.x - DRMC_GATE.x, DRMC_GATE_ROAD_POINT.z - DRMC_GATE.z);
  const gCos = Math.cos(gateYaw);
  const gSin = Math.sin(gateYaw);
  const gy = heightAt(DRMC_GATE.x, DRMC_GATE.z);
  for (const side of [-1, 1] as const) {
    const px = DRMC_GATE.x + gCos * 0.02 * side * 0 + side * (-gSin) * 3.35;
    const pz = DRMC_GATE.z + side * gCos * 3.35;
    // Gate pillars: cream masonry with dark cap + gold band
    bWall.box({ x: px, y: gy + 1.75, z: pz }, { x: 0.62, y: 3.5, z: 0.62 }, '#e8dfc9');
    bWall.box({ x: px, y: gy + 3.56, z: pz }, { x: 0.76, y: 0.16, z: 0.76 }, '#c9bda2');
    bDark.box({ x: px, y: gy + 2.85, z: pz }, { x: 0.66, y: 0.07, z: 0.66 }, '#b8912f');
    colliders.push({
      minX: px - 0.36,
      maxX: px + 0.36,
      minZ: pz - 0.36,
      maxZ: pz + 0.36,
      height: 3.6,
      cameraBlocking: true,
      kind: 'wall',
    });
  }
  // Arch beam across the opening + bilingual signboard
  bWall.box({ x: DRMC_GATE.x, y: gy + 3.78, z: DRMC_GATE.z }, { x: 0.5, y: 0.30, z: 7.4 }, '#e8dfc9', { y: gateYaw });
  bDark.box({ x: DRMC_GATE.x, y: gy + 3.60, z: DRMC_GATE.z }, { x: 0.55, y: 0.07, z: 7.2 }, '#b8912f', { y: gateYaw });

  let signTexture: THREE.Texture | null = null;
  try {
    signTexture = makeTexture(
      'drmc.gate.sign',
      512,
      128,
      (ctx: CanvasRenderingContext2D, w: number, h: number) => {
        ctx.fillStyle = '#0b3b2e';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#f2c14e';
        ctx.fillRect(0, 0, w, 7);
        ctx.fillRect(0, h - 7, w, 7);
        ctx.fillStyle = '#f7f2e2';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 30px sans-serif';
        ctx.fillText('ঢাকা রেসিডেনশিয়াল মডেল কলেজ', w / 2, h * 0.38);
        ctx.font = 'bold 22px sans-serif';
        ctx.fillStyle = '#e8dfc9';
        ctx.fillText('DHAKA RESIDENTIAL MODEL COLLEGE · DRMC', w / 2, h * 0.72);
      },
      { srgb: true },
    );
  } catch {
    signTexture = null;
  }
  if (signTexture) {
    const signMat = new THREE.MeshBasicMaterial({ map: signTexture, transparent: true });
    const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 1.45), signMat);
    signMesh.position.set(DRMC_GATE.x - gSin * 0.32, gy + 3.78, DRMC_GATE.z + gCos * 0.32);
    signMesh.rotation.set(0, gateYaw + Math.PI, 0);
    signMesh.name = 'drmc.gate.sign';
    signMesh.castShadow = false;
    signMesh.receiveShadow = false;
    group.add(signMesh);
  }

  // Entrance apron (visual paving from the gate to the road) + forecourt inside
  const apronMid = {
    x: (DRMC_GATE.x + DRMC_GATE_ROAD_POINT.x) * 0.5,
    z: (DRMC_GATE.z + DRMC_GATE_ROAD_POINT.z) * 0.5,
  };
  const apronLen = Math.hypot(
    DRMC_GATE.x - DRMC_GATE_ROAD_POINT.x,
    DRMC_GATE.z - DRMC_GATE_ROAD_POINT.z,
  );
  bDark.box(
    { x: apronMid.x, y: heightAt(apronMid.x, apronMid.z) + 0.02, z: apronMid.z },
    { x: 5.2, y: 0.045, z: apronLen + 1.2 },
    '#9a917e',
    { y: gateYaw },
  );

  // ------------------------------------------------------ academic blocks
  // Main white academic block (4 storeys, window grid, entrance steps).
  const mainYaw = Math.atan2(C.x - B.x, C.z - B.z) + Math.PI * 0.5;
  const mainY = heightAt(DRMC_MAIN_BLOCK.x, DRMC_MAIN_BLOCK.z);
  bWhite.box({ x: DRMC_MAIN_BLOCK.x, y: mainY + 6.0, z: DRMC_MAIN_BLOCK.z }, { x: 13.5, y: 12.0, z: 34 }, '#f1efe6', { y: mainYaw });
  bDark.box({ x: DRMC_MAIN_BLOCK.x, y: mainY + 12.12, z: DRMC_MAIN_BLOCK.z }, { x: 13.9, y: 0.24, z: 34.4 }, '#cfc7b2', { y: mainYaw });
  // Window grid + floor bands on both long faces
  const mCos = Math.cos(mainYaw);
  const mSin = Math.sin(mainYaw);
  for (const side of [-1, 1] as const) {
    for (let fl = 0; fl < 4; fl++) {
      for (let wi = 0; wi < 7; wi++) {
        const off = -15 + wi * 5;
        const wx = DRMC_MAIN_BLOCK.x + side * mCos * 6.82 - mSin * off;
        const wz = DRMC_MAIN_BLOCK.z - side * mSin * 6.82 + mCos * off;
        bDark.box({ x: wx, y: mainY + 1.5 + fl * 2.85, z: wz }, { x: 0.08, y: 1.25, z: 1.55 }, '#243442', { y: mainYaw });
      }
      // floor string course band
      const bx = DRMC_MAIN_BLOCK.x + side * mCos * 6.84;
      const bz = DRMC_MAIN_BLOCK.z - side * mSin * 6.84;
      if (fl > 0) {
        bWhite.box({ x: bx, y: mainY + fl * 2.85, z: bz }, { x: 0.10, y: 0.14, z: 33.6 }, '#d8d1bd', { y: mainYaw });
      }
    }
  }
  // Entrance porch + steps on the gate-facing side (toward -Z of building = campus gate side)
  const porchX = DRMC_MAIN_BLOCK.x - mCos * 7.2;
  const porchZ = DRMC_MAIN_BLOCK.z + mSin * 7.2;
  bWhite.box({ x: porchX, y: mainY + 1.65, z: porchZ }, { x: 1.9, y: 3.3, z: 5.2 }, '#efe9da', { y: mainYaw });
  bDark.box({ x: porchX, y: mainY + 3.36, z: porchZ }, { x: 2.15, y: 0.12, z: 5.5 }, '#8a7f66', { y: mainYaw });
  bDark.box({ x: porchX - mCos * 1.15, y: mainY + 0.12, z: porchZ + mSin * 1.15 }, { x: 1.4, y: 0.24, z: 4.6 }, '#b7ab91', { y: mainYaw });
  colliders.push({
    minX: DRMC_MAIN_BLOCK.x - 8.6,
    maxX: DRMC_MAIN_BLOCK.x + 8.6,
    minZ: DRMC_MAIN_BLOCK.z - 19.5,
    maxZ: DRMC_MAIN_BLOCK.z + 19.5,
    height: 12.2,
    cameraBlocking: true,
    kind: 'building',
  });

  // Secondary white block (auditorium-style, evidence-limited approximation).
  const secY = heightAt(DRMC_SECOND_BLOCK.x, DRMC_SECOND_BLOCK.z);
  bWhite.box({ x: DRMC_SECOND_BLOCK.x, y: secY + 3.4, z: DRMC_SECOND_BLOCK.z }, { x: 11, y: 6.8, z: 18 }, '#eee9dc', { y: mainYaw });
  bDark.box({ x: DRMC_SECOND_BLOCK.x, y: secY + 6.9, z: DRMC_SECOND_BLOCK.z }, { x: 11.4, y: 0.2, z: 18.4 }, '#cfc7b2', { y: mainYaw });
  bDark.box({ x: DRMC_SECOND_BLOCK.x + 2, y: secY + 2.6, z: DRMC_SECOND_BLOCK.z + 8.9 }, { x: 0.5, y: 5.2, z: 12.2 }, '#243442', { y: mainYaw });
  colliders.push({
    minX: DRMC_SECOND_BLOCK.x - 7.4,
    maxX: DRMC_SECOND_BLOCK.x + 7.4,
    minZ: DRMC_SECOND_BLOCK.z - 11.2,
    maxZ: DRMC_SECOND_BLOCK.z + 11.2,
    height: 7.0,
    cameraBlocking: true,
    kind: 'building',
  });

  // --------------------------------------------------------- sports grounds
  // Open field (football/cricket grounds per Wikipedia) + simple goal frames.
  const gy2 = heightAt(DRMC_SPORTS_GROUND.x, DRMC_SPORTS_GROUND.z);
  const fieldYaw = mainYaw;
  bField.box({ x: DRMC_SPORTS_GROUND.x, y: gy2 + 0.028, z: DRMC_SPORTS_GROUND.z }, { x: 52, y: 0.055, z: 34 }, '#5c8a4a', { y: fieldYaw });
  // Mown stripe accents (cheap vertex-coloured bands)
  for (let sIdx = -2; sIdx <= 2; sIdx++) {
    bField.box(
      { x: DRMC_SPORTS_GROUND.x + Math.cos(fieldYaw) * sIdx * 9.2, y: gy2 + 0.032, z: DRMC_SPORTS_GROUND.z - Math.sin(fieldYaw) * sIdx * 9.2 },
      { x: 1.35, y: 0.012, z: 33.5 },
      sIdx % 2 === 0 ? '#679a54' : '#55804a',
      { y: fieldYaw },
    );
  }
  // Goal posts (football) at both ends
  for (const side of [-1, 1] as const) {
    const gx = DRMC_SPORTS_GROUND.x + side * Math.cos(fieldYaw) * 24.5;
    const gz = DRMC_SPORTS_GROUND.z - side * Math.sin(fieldYaw) * 24.5;
    for (const pg of [-3.2, 3.2]) {
      bWhite.box({ x: gx + -Math.sin(fieldYaw) * pg, y: gy2 + 1.1, z: gz + Math.cos(fieldYaw) * pg }, { x: 0.12, y: 2.2, z: 0.12 }, '#f2f0e8');
    }
    bWhite.box({ x: gx, y: gy2 + 2.18, z: gz }, { x: 0.11, y: 0.11, z: 6.5 }, '#f2f0e8', { y: fieldYaw });
  }

  // ------------------------------------------------------------------ trees
  const treeSpots: Array<[number, number]> = [
    [26, -152], [30, -146], [16, -140], [96, -52], [104, -60], [118, -66],
    [150, -104], [162, -96], [44, -46], [52, -40], [128, -196], [118, -204],
  ];
  for (const [tx, tz] of treeSpots) {
    if (!isInsideDrmcCampus(tx, tz, -1.5)) continue;
    const ty = heightAt(tx, tz);
    const th = 3.1 + ((Math.abs(tx * 13 + tz * 7) % 10) / 10) * 1.6;
    bField.box({ x: tx, y: ty + th * 0.42, z: tz }, { x: 0.34, y: th * 0.84, z: 0.34 }, '#5a402a');
    bField.box({ x: tx, y: ty + th + 0.55, z: tz }, { x: 2.1, y: 1.55, z: 2.1 }, '#2f6f3e');
    bField.box({ x: tx + 0.28, y: ty + th + 1.16, z: tz - 0.2 }, { x: 1.35, y: 0.85, z: 1.35 }, '#3c8250');
  }

  const meshes = [bWall, bWhite, bDark, bField];
  for (const bucket of meshes) {
    const m = bucket.build({ cast: true, receive: true }, true);
    if (m) group.add(m);
  }

  return {
    group,
    colliders,
    gate: { x: DRMC_GATE.x, z: DRMC_GATE.z },
    campusPolygon: DRMC_CAMPUS.map((p) => ({ ...p })),
  };
}
