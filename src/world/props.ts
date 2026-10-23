/**
 * Street-level life: tea stalls, fruit carts, crate stacks, tyre piles,
 * construction barriers, the rickshaw stand and hand-painted road signs.
 * All merged into a few meshes; each prop contributes cheap AABB colliders.
 */

import * as THREE from 'three';
import { Bucket } from './geo';
import { PROPS, SIGN_POOL } from './layout';
import { SignAtlas, clothTexture, posterTexture } from './textures';
import { FONT_FAMILY } from './textures';
import { mulberry32, TAU } from '../core/mathx';
import type { Collider } from './city';

function roadSignTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 320;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 320);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 10;
  ctx.strokeRect(12, 12, 232, 296);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 52px ${FONT_FAMILY}`;
  const words = text.split(' ');
  words.forEach((w, i) => ctx.fillText(w, 128, 110 + i * 62));
  ctx.font = `400 26px ${FONT_FAMILY}`;
  ctx.fillText('SPEED BUMP', 128, 272);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export interface PropsResult {
  group: THREE.Group;
  colliders: Collider[];
}

export function buildProps(signAtlas: SignAtlas): PropsResult {
  const group = new THREE.Group();
  group.name = 'props';
  const colliders: Collider[] = [];
  const rng = mulberry32(4242);

  const wood = new Bucket(
    'prop-wood',
    new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85, metalness: 0.03 }),
  );
  const metal = new Bucket(
    'prop-metal',
    new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.5, metalness: 0.55 }),
  );
  const cloth = new Bucket(
    'prop-cloth',
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      map: clothTexture(),
      roughness: 0.95,
      side: THREE.DoubleSide,
    }),
  );
  const paint = new Bucket(
    'prop-paint',
    new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.62, metalness: 0.15 }),
  );
  const signBucket = new Bucket(
    'prop-signs',
    new THREE.MeshStandardMaterial({ color: 0xffffff, map: signAtlas.texture, roughness: 0.7, vertexColors: true }),
  );
  const posterMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: posterTexture(), roughness: 0.9 });

  const addCollider = (x: number, z: number, halfX: number, halfZ: number, height: number): void => {
    colliders.push({
      minX: x - halfX,
      maxX: x + halfX,
      minZ: z - halfZ,
      maxZ: z + halfZ,
      height,
      cameraBlocking: false,
      kind: 'prop',
    });
  };

  // -------------------------------------------------------------- tea stall
  const teaStall = (x: number, z: number, yaw: number): void => {
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    const at = (ox: number, oz: number) => ({ x: x + ox * c + oz * s, z: z - ox * s + oz * c });
    // counter
    let p = at(0, 0);
    wood.box({ x: p.x, y: 0.46, z: p.z }, { x: 2.4, y: 0.92, z: 0.75 }, '#8a5a2b', { y: yaw });
    wood.box({ x: p.x, y: 0.96, z: p.z }, { x: 2.5, y: 0.08, z: 0.85 }, '#a8703a', { y: yaw });
    // bamboo posts
    for (const [ox, oz] of [
      [-1.3, -1.2],
      [1.3, -1.2],
      [-1.3, 0.6],
      [1.3, 0.6],
    ]) {
      p = at(ox, oz);
      wood.cylinder({ x: p.x, y: 1.5, z: p.z }, 0.045, 3.0, '#b58a4a');
    }
    // tarp roof
    p = at(0, -0.3);
    cloth.quad({ x: p.x, y: 2.95, z: p.z }, 3.4, 2.6, '#1f6b4f', { x: -Math.PI / 2, y: yaw });
    cloth.quad({ x: p.x, y: 2.72, z: p.z }, 3.4, 0.5, '#1f6b4f', { y: yaw });
    // bunting
    for (let i = 0; i < 6; i++) {
      const t = -1.5 + i * 0.6;
      p = at(t, -1.25);
      paint.box({ x: p.x, y: 2.55, z: p.z }, { x: 0.16, y: 0.24, z: 0.02 }, i % 2 ? '#d63b2f' : '#f0a500', {
        y: yaw,
        z: 0.5,
      });
    }
    // kettle + stove + cups
    p = at(-0.55, 0);
    metal.cylinder({ x: p.x, y: 1.12, z: p.z }, 0.16, 0.26, '#b9bcc0');
    metal.cylinder({ x: p.x + 0.16, y: 1.18, z: p.z }, 0.03, 0.2, '#9aa0a4', { z: -0.7 });
    p = at(-0.95, 0);
    metal.cylinder({ x: p.x, y: 1.05, z: p.z }, 0.12, 0.14, '#3c3c3c');
    for (let i = 0; i < 5; i++) {
      p = at(0.2 + i * 0.16, 0.1);
      paint.cylinder({ x: p.x, y: 1.08, z: p.z }, 0.035, 0.08, '#f0e6d2');
    }
    // bench
    p = at(1.7, 0.4);
    wood.box({ x: p.x, y: 0.24, z: p.z }, { x: 1.6, y: 0.08, z: 0.34 }, '#8a5a2b', { y: yaw });
    wood.box({ x: p.x, y: 0.5, z: p.z + 0.2 }, { x: 1.6, y: 0.5, z: 0.06 }, '#8a5a2b', { y: yaw });
    // sign
    p = at(0, -1.3);
    const uv = signAtlas.uvFor(SIGN_POOL[0]);
    signBucket.quad({ x: p.x, y: 2.15, z: p.z }, 1.5, 0.55, '#ffffff', { y: yaw }, uv);
    addCollider(x, z, 1.5, 1.1, 2.9);
  };

  // ------------------------------------------------------------- fruit cart
  const fruitCart = (x: number, z: number, yaw: number): void => {
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    const at = (ox: number, oz: number) => ({ x: x + ox * c + oz * s, z: z - ox * s + oz * c });
    let p = at(0, 0);
    wood.box({ x: p.x, y: 0.72, z: p.z }, { x: 1.9, y: 0.16, z: 0.95 }, '#b98a4a', { y: yaw });
    wood.box({ x: p.x, y: 0.38, z: p.z }, { x: 1.8, y: 0.5, z: 0.85 }, '#8a6531', { y: yaw });
    for (const ox of [-0.85, 0.85]) {
      p = at(ox, 0);
      metal.cylinder({ x: p.x, y: 0.34, z: p.z }, 0.34, 0.09, '#2f2f2f', { z: Math.PI / 2, y: yaw });
    }
    // fruit crates
    const fruitColors = ['#e8a01c', '#d64a2a', '#2f8a3c', '#7a1f6a', '#e8d02a'];
    for (let i = 0; i < 4; i++) {
      p = at(-0.62 + i * 0.42, 0);
      paint.box({ x: p.x, y: 0.9, z: p.z }, { x: 0.36, y: 0.2, z: 0.6 }, '#c8a06a', { y: yaw });
      for (let f = 0; f < 5; f++) {
        paint.add(
          new THREE.SphereGeometry(0.075, 6, 5),
          { x: p.x + (rng() - 0.5) * 0.26, y: 1.0 + rng() * 0.06, z: p.z + (rng() - 0.5) * 0.44 },
          { x: 1, y: 1, z: 1 },
          fruitColors[(i + f) % fruitColors.length],
        );
      }
    }
    // umbrella
    p = at(0, -0.1);
    wood.cylinder({ x: p.x, y: 1.55, z: p.z }, 0.03, 1.6, '#8a7a5a');
    cloth.cone({ x: p.x, y: 2.4, z: p.z }, 1.15, 0.5, '#b8352a', { x: Math.PI, y: yaw });
    addCollider(x, z, 1.15, 0.8, 2.4);
  };

  const crateStack = (x: number, z: number, yaw: number): void => {
    for (let i = 0; i < 5; i++) {
      const ox = (rng() - 0.5) * 0.5;
      const oz = (rng() - 0.5) * 0.5;
      const y = 0.22 + Math.floor(i / 2) * 0.42;
      wood.box({ x: x + ox, y, z: z + oz }, { x: 0.62, y: 0.4, z: 0.5 }, i % 2 ? '#a8783c' : '#8a5f2c', {
        y: yaw + (rng() - 0.5) * 0.4,
      });
    }
    addCollider(x, z, 0.6, 0.55, 1.3);
  };

  const tirePile = (x: number, z: number): void => {
    for (let i = 0; i < 4; i++) {
      metal.add(
        new THREE.TorusGeometry(0.34, 0.11, 5, 12),
        { x, y: 0.12 + i * 0.21, z },
        { x: 1, y: 1, z: 1 },
        '#22242a',
        { x: Math.PI / 2, z: (rng() - 0.5) * 0.2 },
      );
    }
    addCollider(x, z, 0.45, 0.45, 0.9);
  };

  const barrier = (x: number, z: number, yaw: number): void => {
    for (let i = 0; i < 3; i++) {
      const ox = (i - 1) * 1.5;
      const s = Math.sin(yaw);
      const c = Math.cos(yaw);
      const px = x + ox * c;
      const pz = z - ox * s;
      paint.box({ x: px, y: 0.72, z: pz }, { x: 1.35, y: 0.28, z: 0.1 }, i % 2 ? '#d63b2f' : '#f2eee2', { y: yaw });
      paint.box({ x: px, y: 0.34, z: pz }, { x: 0.1, y: 0.68, z: 0.1 }, '#f2eee2', { y: yaw });
    }
    addCollider(x, z, 2.2, 0.25, 0.9);
  };

  const bins = (x: number, z: number): void => {
    metal.cylinder({ x, y: 0.42, z }, 0.28, 0.82, '#2f6b4a');
    metal.cylinder({ x: x + 0.5, y: 0.36, z: z + 0.2 }, 0.24, 0.7, '#3c5a7a');
    addCollider(x + 0.2, z, 0.6, 0.4, 0.85);
  };

  const bench = (x: number, z: number, yaw: number): void => {
    wood.box({ x, y: 0.24, z }, { x: 1.8, y: 0.08, z: 0.4 }, '#8a5a2b', { y: yaw });
    for (const ox of [-0.75, 0.75]) {
      const s = Math.sin(yaw);
      const c = Math.cos(yaw);
      wood.box({ x: x + ox * c, y: 0.12, z: z - ox * s }, { x: 0.1, y: 0.24, z: 0.36 }, '#6d4526', { y: yaw });
    }
    addCollider(x, z, 0.95, 0.35, 0.35);
  };

  /** Parked rickshaw at the stand (simplified but reads correctly). */
  const parkedRickshaw = (x: number, z: number, yaw: number, tint: string): void => {
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    const at = (ox: number, oz: number) => ({ x: x + ox * c + oz * s, z: z - ox * s + oz * c });
    let p = at(0, 0);
    // wheels
    for (const [ox, oz] of [
      [0, 0.62],
      [-0.52, -0.5],
      [0.52, -0.5],
    ]) {
      p = at(ox, oz);
      metal.add(
        new THREE.TorusGeometry(0.34, 0.035, 5, 14),
        { x: p.x, y: 0.34, z: p.z },
        { x: 1, y: 1, z: 1 },
        '#1e1e1e',
        { y: Math.PI / 2 + yaw },
      );
    }
    p = at(0, -0.1);
    paint.box({ x: p.x, y: 0.62, z: p.z }, { x: 1.0, y: 0.35, z: 1.3 }, tint, { y: yaw });
    p = at(0, -0.55);
    cloth.box({ x: p.x, y: 1.35, z: p.z }, { x: 1.15, y: 0.9, z: 0.95 }, '#1b1b1b', { y: yaw });
    p = at(0, 0.1);
    paint.box({ x: p.x, y: 1.02, z: p.z }, { x: 0.95, y: 0.16, z: 0.55 }, '#7a2a24', { y: yaw });
    addCollider(x, z, 0.75, 0.85, 1.9);
  };

  for (const spot of PROPS) {
    const yaw = spot.yaw ?? 0;
    switch (spot.kind) {
      case 'tea':
        teaStall(spot.x, spot.z, yaw);
        break;
      case 'cart':
        fruitCart(spot.x, spot.z, yaw);
        break;
      case 'crates':
        crateStack(spot.x, spot.z, yaw);
        break;
      case 'tires':
        tirePile(spot.x, spot.z);
        break;
      case 'barrier':
        barrier(spot.x, spot.z, yaw);
        break;
      case 'bins':
        bins(spot.x, spot.z);
        break;
      case 'bench':
        bench(spot.x, spot.z, yaw);
        break;
      case 'stand':
        parkedRickshaw(spot.x, spot.z, yaw, '#b8322a');
        parkedRickshaw(spot.x - 1.2, spot.z + 2.2, yaw + 0.12, '#1c5a3a');
        parkedRickshaw(spot.x + 1.4, spot.z + 3.4, yaw - 0.1, '#1c3f7a');
        break;
      case 'poles':
        break;
    }
  }

  // extra parked rickshaws near the tea stall for life
  parkedRickshaw(8.6, 16.5, 0.3, '#1c5a3a');

  // hand-painted "ধীরে চলুন" boards near humps
  const slowSign = roadSignTexture('ধীরে চলুন', '#f3ead2', '#8c2f22');
  const slowMat = new THREE.MeshStandardMaterial({ map: slowSign, roughness: 0.8 });
  const slowSpots = [
    { x: -5.6, z: 27 },
    { x: 5.6, z: -25 },
    { x: -33, z: 3.8 },
  ];
  for (const s of slowSpots) {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.78), slowMat);
    board.position.set(s.x, 1.5, s.z);
    board.rotation.y = s.x > 0 ? Math.PI : 0;
    board.castShadow = false;
    group.add(board);
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 1.5, 5),
      new THREE.MeshStandardMaterial({ color: 0x6b6f70, metalness: 0.4, roughness: 0.6 }),
    );
    post.position.set(s.x, 0.75, s.z);
    group.add(post);
  }

  // wall poster boards near the market
  for (const spot of [
    { x: -8.6, z: 22, yaw: Math.PI / 2 },
    { x: 8.6, z: -32, yaw: -Math.PI / 2 },
    { x: -8.7, z: -44, yaw: Math.PI / 2 },
  ]) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.3), posterMat);
    mesh.position.set(spot.x, 1.9, spot.z);
    mesh.rotation.y = spot.yaw;
    group.add(mesh);
  }

  // strings of plastic bunting across the tea lane
  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    const x = -4.5 + t * 9;
    const y = 5.4 - Math.sin(t * Math.PI) * 1.1;
    paint.box({ x, y, z: 14 }, { x: 0.2, y: 0.28, z: 0.02 }, i % 3 === 0 ? '#f0a500' : i % 3 === 1 ? '#d63b2f' : '#2f8a6a', {
      z: 0.15,
    });
  }

  for (const bucket of [wood, metal, cloth, paint, signBucket]) {
    const mesh = bucket.build({ cast: true, receive: true });
    if (mesh) group.add(mesh);
  }

  void TAU;
  return { group, colliders };
}
