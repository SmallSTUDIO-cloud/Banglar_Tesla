/**
 * Authentic Mohammadpur street life & Bangladeshi street-food vendors (Section 10):
 *   - Fuchka & Chotpoti carts (`মামা স্পেশাল ফুচকা` — glass showcase of crispy
 *     fuchka spheres, aluminum chotpoti pot, tamarind tok jars, umbrella, vendor & customers)
 *   - Jhalmuri sellers (`ঢাকাইয়া ঝালমুড়ি` — tall puffed-rice tin, masala spice
 *     compartments, mustard-oil bottle, paper cones, mixing bowl, vendor & customers)
 *   - Tong tea stalls (`চায়ের টং` — steaming kettle, hanging banana bunches,
 *     biscuit jars, blue tarp roof & wooden adda bench)
 *   - Fruit & green-coconut (`ডাব`) pushcarts, vegetable bazaar mats, rickshaw
 *     tyre-repair corners, and Mohammadpur Bus Stand shelter.
 *
 * Every prop is strictly validated via `isClearOfRoads` so zero stalls or
 * customers ever intrude into driving lanes or intersections.
 */

import * as THREE from 'three';
import { mulberry32 } from '../core/mathx';
import type { Collider } from './city';
import type { BreakableKind, BreakableProp } from './destruction';
import { Bucket } from './geo';
import { ROAD_SEGMENTS, isClearOfRoads } from './layout';
import { SignAtlas, clothTexture } from './textures';

export interface VendorSpot {
  x: number;
  z: number;
  kind: 'fuchka' | 'jhalmuri' | 'tea' | 'market';
  broken?: boolean;
}

export interface PropsResult {
  group: THREE.Group;
  colliders: Collider[];
  vendorSpots: VendorSpot[];
  breakableStalls: BreakableProp[];
}

export function buildProps(signAtlas: SignAtlas): PropsResult {
  const group = new THREE.Group();
  group.name = 'mohammadpur-props';
  const colliders: Collider[] = [];
  const vendorSpots: VendorSpot[] = [];
  const breakableStalls: BreakableProp[] = [];
  const rng = mulberry32(90210);

  const solidMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
  });
  const metalMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.32,
    metalness: 0.76,
  });
  const clothMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    map: clothTexture(),
    side: THREE.DoubleSide,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.16,
    metalness: 0.35,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
  });
  const signMat = new THREE.MeshLambertMaterial({
    map: signAtlas.texture,
  });

  const solid = new Bucket('props.solid', solidMat, true);
  const metal = new Bucket('props.metal', metalMat, true);
  const cloth = new Bucket('props.cloth', clothMat, true);
  const glass = new Bucket('props.glass', glassMat);
  const signs = new Bucket('props.signs', signMat);

  const placedStalls: { x: number; z: number; r: number }[] = [];
  const canPlaceStall = (x: number, z: number, r: number): boolean => {
    if (!isClearOfRoads(x, z, r + 0.55)) return false;
    for (const p of placedStalls) {
      if (Math.hypot(x - p.x, z - p.z) < r + p.r + 1.5) return false;
    }
    placedStalls.push({ x, z, r });
    return true;
  };

  const setAllTags = (tag: number): void => {
    solid.setTag(tag);
    metal.setTag(tag);
    cloth.setTag(tag);
    glass.setTag(tag);
    signs.setTag(tag);
  };

  const addPropCollider = (
    x: number,
    z: number,
    halfX: number,
    halfZ: number,
    height: number,
    yaw = 0,
    breakableId?: number,
  ): Collider => {
    const cosA = Math.abs(Math.cos(yaw));
    const sinA = Math.abs(Math.sin(yaw));
    const envX = halfX * cosA + halfZ * sinA;
    const envZ = halfX * sinA + halfZ * cosA;
    const col: Collider = {
      minX: x - envX,
      maxX: x + envX,
      minZ: z - envZ,
      maxZ: z + envZ,
      height,
      cameraBlocking: false,
      kind: 'prop',
      breakableId,
      cx: x,
      cz: z,
      halfX,
      halfZ,
      yaw,
    };
    colliders.push(col);
    return col;
  };

  // Helper to place a standing vendor or customer figure on the sidewalk (y = 0.09)
  // Human figures are excluded from breakable stall geometry tags so only the stall/cart breaks!
  const addPersonFigure = (
    px: number,
    pz: number,
    yaw: number,
    shirt: string,
    lower: string,
    apronColor?: string,
  ): void => {
    const prevTag = solid.currentTagId;
    setAllTags(-1);
    const base = 0.09;
    solid.cylinder({ x: px, y: base + 0.42, z: pz }, 0.14, 0.82, lower);
    solid.box({ x: px, y: base + 1.02, z: pz }, { x: 0.34, y: 0.46, z: 0.21 }, shirt, { y: yaw });
    if (apronColor) {
      cloth.box(
        { x: px + Math.sin(yaw) * 0.11, y: base + 0.90, z: pz + Math.cos(yaw) * 0.11 },
        { x: 0.28, y: 0.52, z: 0.03 },
        apronColor,
        { y: yaw },
      );
    }
    solid.cylinder({ x: px, y: base + 1.38, z: pz }, 0.10, 0.21, '#8d5e3c');
    solid.cylinder({ x: px, y: base + 1.48, z: pz }, 0.105, 0.06, '#1c1715');
    setAllTags(prevTag);
  };

  // ----------------- 1. FUCHKA & CHOTPOTI STALL (`ফুচকা ও চটপটি ভ্যান`)
  const buildFuchkaStall = (x: number, z: number, yaw: number): void => {
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    const at = (ox: number, oz: number) => ({ x: x + ox * c + oz * s, z: z - ox * s + oz * c });
    const groundY = 0.09;

    // 4 spoked pushcart wheels touching sidewalk cleanly
    const wr = 0.24;
    for (const [wx, wz] of [
      [-0.78, -0.42],
      [0.78, -0.42],
      [-0.78, 0.42],
      [0.78, 0.42],
    ]) {
      const wp = at(wx, wz);
      solid.cylinder({ x: wp.x, y: groundY + wr, z: wp.z }, wr, 0.06, '#1e2024', {
        y: yaw,
        x: Math.PI / 2,
      });
      metal.cylinder({ x: wp.x, y: groundY + wr, z: wp.z }, wr * 0.55, 0.07, '#cfd6de', {
        y: yaw,
        x: Math.PI / 2,
      });
    }

    // Colourful hand-painted wooden pushcart body + red/gold trim + Bangla Fuchka sign (slot 2)
    solid.box({ x, y: groundY + 0.68, z }, { x: 1.88, y: 0.52, z: 0.98 }, '#8a1c4a', { y: yaw });
    solid.box({ x, y: groundY + 0.96, z }, { x: 1.98, y: 0.07, z: 1.08 }, '#f4c04a', { y: yaw });
    const frontFace = at(0, 0.505);
    signs.quad({ x: frontFace.x, y: groundY + 0.68, z: frontFace.z }, 1.65, 0.44, '#ffffff', { y: yaw }, signAtlas.slot(2));

    // Glass Fuchka showcase cabinet stacked with golden crispy fuchka mounds!
    const cab = at(-0.42, 0.05);
    glass.box({ x: cab.x, y: groundY + 1.28, z: cab.z }, { x: 0.86, y: 0.56, z: 0.68 }, '#dff6ff', { y: yaw });
    metal.box({ x: cab.x, y: groundY + 1.57, z: cab.z }, { x: 0.90, y: 0.04, z: 0.72 }, '#d5dce4', { y: yaw });
    for (const [fx, fy, fz, fr] of [
      [-0.58, 1.14, 0.05, 0.22],
      [-0.28, 1.16, 0.08, 0.24],
      [-0.43, 1.30, 0.04, 0.19],
    ]) {
      const fp = at(fx, fz);
      solid.cone({ x: fp.x, y: groundY + fy, z: fp.z }, fr, 0.28, '#e39b32');
    }

    // Gleaming round aluminum Chotpoti pot (`হাড়ি`) + twin Tamarind Tok (`তেঁতুল পানি`) jars + stacked plates
    const pot = at(0.36, 0.04);
    metal.cylinder({ x: pot.x, y: groundY + 1.15, z: pot.z }, 0.24, 0.30, '#dce3ea');
    solid.cylinder({ x: pot.x, y: groundY + 1.30, z: pot.z }, 0.21, 0.03, '#c97a2b'); // hot yellow chotpoti!
    for (const [jx, jz, col] of [
      [0.72, 0.22, '#5a2614'],
      [0.72, -0.14, '#2a7c4f'],
    ] as const) {
      const jp = at(jx, jz);
      solid.cylinder({ x: jp.x, y: groundY + 1.14, z: jp.z }, 0.11, 0.28, col);
      metal.cylinder({ x: jp.x, y: groundY + 1.29, z: jp.z }, 0.08, 0.04, '#e5383b');
    }
    const plates = at(0.08, 0.32);
    metal.cylinder({ x: plates.x, y: groundY + 1.06, z: plates.z }, 0.11, 0.12, '#e2e8f0');

    // Striped garden umbrella + warm glowing street-food bulb
    const pole = at(0.15, -0.15);
    metal.cylinder({ x: pole.x, y: groundY + 1.75, z: pole.z }, 0.03, 1.8, '#cfd6de');
    cloth.cone({ x: pole.x, y: groundY + 2.75, z: pole.z }, 1.55, 0.58, '#d93829');
    cloth.cone({ x: pole.x, y: groundY + 2.78, z: pole.z }, 1.12, 0.54, '#ffd166');
    solid.cylinder({ x: x, y: groundY + 2.22, z }, 0.07, 0.12, '#ffe89c');

    // Standing Fuchka Mama behind cart + 2 sidewalk customers enjoying Fuchka!
    const vendorPos = at(0.15, -0.82);
    addPersonFigure(vendorPos.x, vendorPos.z, yaw, '#e9c46a', '#1d4e70', '#ffffff');
    const cust1 = at(-0.55, 0.96);
    if (isClearOfRoads(cust1.x, cust1.z, 0.6)) {
      addPersonFigure(cust1.x, cust1.z, yaw + Math.PI - 0.2, '#d62828', '#2b2d42');
    }
    const cust2 = at(0.48, 0.98);
    if (isClearOfRoads(cust2.x, cust2.z, 0.6)) {
      addPersonFigure(cust2.x, cust2.z, yaw + Math.PI + 0.25, '#2a9d8f', '#264653');
    }

    addPropCollider(x, z, 0.94, 0.50, 2.4, yaw);
    vendorSpots.push({ x, z, kind: 'fuchka' });
  };

  // ----------------- 2. JHALMURI SELLER (`ঝালমুড়িওয়ালা`)
  const buildJhalmuriStall = (x: number, z: number, yaw: number): void => {
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    const at = (ox: number, oz: number) => ({ x: x + ox * c + oz * s, z: z - ox * s + oz * c });
    const groundY = 0.09;

    // Compact wooden X-trestle stand / push-frame + Bangla Jhalmuri placard (slot 3)
    solid.box({ x, y: groundY + 0.44, z }, { x: 1.32, y: 0.78, z: 0.76 }, '#a33b16', { y: yaw });
    solid.box({ x, y: groundY + 0.86, z }, { x: 1.42, y: 0.07, z: 0.86 }, '#ffd166', { y: yaw });
    const front = at(0, 0.395);
    signs.quad({ x: front.x, y: groundY + 0.48, z: front.z }, 1.18, 0.38, '#ffffff', { y: yaw }, signAtlas.slot(3));

    // Iconic tall cylindrical gleaming steel Puffed-Rice Tin (`মুড়ির টিন`)!
    const tin = at(-0.36, 0.02);
    metal.cylinder({ x: tin.x, y: groundY + 1.18, z: tin.z }, 0.21, 0.58, '#e2e8f0');
    solid.cylinder({ x: tin.x, y: groundY + 1.48, z: tin.z }, 0.16, 0.04, '#f8f3dc'); // white puffed muri!

    // Compartmentalized Masala Tray (chopped onion, green chilli, chanachur, coriander) + Mustard Oil bottle!
    for (const [mx, mz, col] of [
      [0.08, 0.14, '#e76f51'], // chanachur
      [0.32, 0.14, '#2a9d8f'], // green chilli & dhonia
      [0.08, -0.12, '#d8b4e2'], // chopped red onion
      [0.32, -0.12, '#e9c46a'], // roasted boot/peas
    ] as const) {
      const mp = at(mx, mz);
      metal.box({ x: mp.x, y: groundY + 0.95, z: mp.z }, { x: 0.20, y: 0.10, z: 0.20 }, '#cbd5e1', { y: yaw });
      solid.box({ x: mp.x, y: groundY + 1.01, z: mp.z }, { x: 0.17, y: 0.03, z: 0.17 }, col, { y: yaw });
    }
    // Golden mustard oil (`সরিষার তেল`) bottle + steel mixing pot (`বাটি`) + paper cone (`ঠোঙা`) stack!
    const oil = at(0.54, 0.16);
    solid.cylinder({ x: oil.x, y: groundY + 1.04, z: oil.z }, 0.055, 0.28, '#f4a91c');
    const bowl = at(0.50, -0.14);
    metal.cylinder({ x: bowl.x, y: groundY + 0.99, z: bowl.z }, 0.12, 0.18, '#e2e8f0');
    const cones = at(-0.04, 0.28);
    solid.cone({ x: cones.x, y: groundY + 1.03, z: cones.z }, 0.08, 0.22, '#ede4cc', { x: Math.PI });

    // Overhead bamboo shade + warm street lantern
    const p1 = at(-0.62, -0.32);
    const p2 = at(0.62, -0.32);
    solid.cylinder({ x: p1.x, y: groundY + 1.45, z: p1.z }, 0.035, 2.2, '#9c7242');
    solid.cylinder({ x: p2.x, y: groundY + 1.45, z: p2.z }, 0.035, 2.2, '#9c7242');
    cloth.box({ x, y: groundY + 2.48, z }, { x: 1.75, y: 0.05, z: 1.35 }, '#1f6f54', { y: yaw, x: 0.12 });

    // Jhalmuri Mama + eager customer
    const vPos = at(0, -0.68);
    addPersonFigure(vPos.x, vPos.z, yaw, '#f4a261', '#284b63', '#c92a2a');
    const cPos = at(0.18, 0.84);
    if (isClearOfRoads(cPos.x, cPos.z, 0.6)) {
      addPersonFigure(cPos.x, cPos.z, yaw + Math.PI, '#457b9d', '#1d3557');
    }

    addPropCollider(x, z, 0.68, 0.42, 2.2, yaw);
    vendorSpots.push({ x, z, kind: 'jhalmuri' });
  };

  // ----------------- 3. TONG TEA STALL (`চায়ের টং`) & FRUIT/VEG CARTS
  const buildTeaTong = (x: number, z: number, yaw: number): void => {
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    const at = (ox: number, oz: number) => ({ x: x + ox * c + oz * s, z: z - ox * s + oz * c });
    const groundY = 0.09;

    solid.box({ x, y: groundY + 0.46, z }, { x: 2.1, y: 0.88, z: 0.82 }, '#7a4e28', { y: yaw });
    solid.box({ x, y: groundY + 0.93, z }, { x: 2.22, y: 0.07, z: 0.92 }, '#9c6635', { y: yaw });
    for (const [ox, oz] of [
      [-1.02, -0.42],
      [1.02, -0.42],
      [-1.02, 0.42],
      [1.02, 0.42],
    ]) {
      const p = at(ox, oz);
      solid.cylinder({ x: p.x, y: groundY + 1.35, z: p.z }, 0.04, 2.5, '#a87d44');
    }
    cloth.box({ x, y: groundY + 2.58, z }, { x: 2.55, y: 0.06, z: 1.75 }, '#195d82', { y: yaw, x: 0.10 });
    // Aluminum tea kettle + biscuit jars + hanging yellow banana bunches (`কলার ছড়া`)!
    const kt = at(-0.48, 0.08);
    metal.cylinder({ x: kt.x, y: groundY + 1.12, z: kt.z }, 0.18, 0.30, '#dce3ea');
    for (let j = 0; j < 3; j++) {
      const jp = at(0.18 + j * 0.28, 0.14);
      glass.cylinder({ x: jp.x, y: groundY + 1.10, z: jp.z }, 0.10, 0.26, '#f6d89e');
      solid.cylinder({ x: jp.x, y: groundY + 1.24, z: jp.z }, 0.085, 0.04, '#d62828');
    }
    for (const bx of [-0.82, 0.82]) {
      const bp = at(bx, 0.42);
      solid.cylinder({ x: bp.x, y: groundY + 2.05, z: bp.z }, 0.12, 0.36, '#f2c938');
    }
    // Sidewalk wooden adda bench
    const bench = at(0, 0.92);
    if (isClearOfRoads(bench.x, bench.z, 0.65)) {
      solid.box({ x: bench.x, y: groundY + 0.26, z: bench.z }, { x: 1.55, y: 0.06, z: 0.34 }, '#6e4522', { y: yaw });
      solid.box({ x: bench.x, y: groundY + 0.13, z: bench.z }, { x: 1.35, y: 0.24, z: 0.26 }, '#543419', { y: yaw });
    }
    const vPos = at(0, -0.68);
    addPersonFigure(vPos.x, vPos.z, yaw, '#e76f51', '#1d4e6e');
    addPropCollider(x, z, 1.04, 0.45, 2.5, yaw);
    vendorSpots.push({ x, z, kind: 'tea' });
  };

  const buildFruitOrVegCart = (x: number, z: number, yaw: number, isCoconut: boolean): void => {
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    const at = (ox: number, oz: number) => ({ x: x + ox * c + oz * s, z: z - ox * s + oz * c });
    const groundY = 0.09;

    solid.box({ x, y: groundY + 0.56, z }, { x: 1.72, y: 0.22, z: 1.02 }, '#6a4626', { y: yaw });
    for (const [wx, wz] of [
      [-0.65, -0.45],
      [0.65, -0.45],
      [-0.65, 0.45],
      [0.65, 0.45],
    ]) {
      const wp = at(wx, wz);
      solid.cylinder({ x: wp.x, y: groundY + 0.25, z: wp.z }, 0.25, 0.06, '#1f2226', { y: yaw, x: Math.PI / 2 });
    }
    for (let r = -1; r <= 1; r++) {
      for (let col = -2; col <= 2; col++) {
        const fp = at(col * 0.28, r * 0.26);
        const fruitCol = isCoconut
          ? '#4ea832' // green Daab coconuts!
          : (col + r) % 2 === 0
            ? '#f59f00' // Rajshahi mangoes!
            : '#e03131'; // apples / pomegranates!
        solid.cylinder({ x: fp.x, y: groundY + 0.78, z: fp.z }, 0.13, 0.20, fruitCol);
      }
    }
    addPropCollider(x, z, 0.86, 0.50, 1.2, yaw);
    vendorSpots.push({ x, z, kind: 'market' });
  };

  // Place stalls systematically along Mohammadpur sidewalks & market hubs!
  let stallTypeCounter = 0;
  for (const seg of ROAD_SEGMENTS) {
    if (seg.length < 30) continue;
    const density = seg.jamProne ? 2 : seg.kind !== 'gali' ? 1 : rng() < 0.4 ? 1 : 0;
    for (let i = 0; i < density; i++) {
      const side: 1 | -1 = (i + stallTypeCounter) % 2 === 0 ? 1 : -1;
      const along = seg.length * (density === 1 ? 0.52 : 0.32 + i * 0.36);
      // Sit back onto the outer sidewalk / shopfront apron so road stays 100% clear!
      const lateral = (seg.halfWidth + seg.sidewalk * 0.78 + 0.38) * side;
      const sx = seg.ax + seg.ux * along + seg.leftX * lateral;
      const sz = seg.az + seg.uz * along + seg.leftZ * lateral;
      // Face inward toward the street & pedestrians!
      const faceYaw = Math.atan2(-seg.leftX * side, -seg.leftZ * side);

      if (!canPlaceStall(sx, sz, 1.35)) continue;
      const mod = stallTypeCounter % 5;
      stallTypeCounter++;
      const stallId = 1000 + breakableStalls.length;
      setAllTags(stallId);
      if (mod === 0) buildFuchkaStall(sx, sz, faceYaw);
      else if (mod === 1) buildJhalmuriStall(sx, sz, faceYaw);
      else if (mod === 2) buildTeaTong(sx, sz, faceYaw);
      else buildFruitOrVegCart(sx, sz, faceYaw, mod === 3);
      setAllTags(-1);

      const stallCol = colliders[colliders.length - 1];
      const spot = vendorSpots[vendorSpots.length - 1];
      stallCol.breakableId = stallId;
      const bKind: BreakableKind =
        mod === 0 ? 'fuchka' : mod === 1 ? 'jhalmuri' : mod === 2 ? 'tea' : 'market';
      breakableStalls.push({
        id: stallId,
        kind: bKind,
        x: sx,
        z: sz,
        yaw: faceYaw,
        collider: stallCol,
        slices: [],
        vendorSpot: spot,
      });
    }
  }

  // Mohammadpur Bus Stand Passenger Waiting Shelter (`bus_stand` sidewalk pocket)
  const standSeg = ROAD_SEGMENTS.find((s) => s.id === 'asad_1');
  if (standSeg) {
    const bx = standSeg.ax + standSeg.ux * 14 + standSeg.leftX * (standSeg.halfWidth + 2.3);
    const bz = standSeg.az + standSeg.uz * 14 + standSeg.leftZ * (standSeg.halfWidth + 2.3);
    const byaw = Math.atan2(-standSeg.leftX, -standSeg.leftZ);
    if (canPlaceStall(bx, bz, 2.2)) {
      metal.box({ x: bx, y: 2.55, z: bz }, { x: 4.6, y: 0.12, z: 1.8 }, '#145a44', { y: byaw });
      metal.box({ x: bx, y: 1.35, z: bz - Math.cos(byaw) * 0.78 }, { x: 4.4, y: 2.3, z: 0.08 }, '#24343e', {
        y: byaw,
      });
      solid.box({ x: bx, y: 0.48, z: bz }, { x: 3.8, y: 0.08, z: 0.46 }, '#d99b38', { y: byaw });
      addPropCollider(bx, bz, 2.1, 0.86, 2.6, byaw);
    }
  }

  const buckets = [
    { bucket: solid, cast: true },
    { bucket: metal, cast: false },
    { bucket: cloth, cast: true },
    { bucket: glass, cast: false },
    { bucket: signs, cast: false },
  ];
  for (const b of buckets) {
    for (const m of b.bucket.buildChunked(3, 280, { cast: b.cast, receive: true })) group.add(m);
  }
  for (let i = 0; i < breakableStalls.length; i++) {
    const bs = breakableStalls[i];
    for (const b of buckets) {
      const list = b.bucket.getTagSlices().get(bs.id);
      if (list) bs.slices.push(...list);
    }
  }

  return { group, colliders, vendorSpots, breakableStalls };
}
