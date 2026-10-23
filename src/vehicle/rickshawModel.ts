/**
 * The hero asset: a hand-painted Bangladeshi pedal cycle rickshaw, built from
 * primitives with a full animation rig (steering, wheels, pedalling legs,
 * canopy sway, ornaments) and swappable paint / art / tassel cosmetics.
 *
 * Local axes: +Z is forward, +Y up, origin on the ground between the rear axle
 * and the passenger bench.
 */

import * as THREE from 'three';
import { createWheel } from '../world/geo';
import { rickshawArtTexture, clothTexture, FONT_FAMILY } from '../world/textures';
import type { CosmeticCategory, VehicleDef } from '../economy/catalog';
import { damp, TAU } from '../core/mathx';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface RickshawLook {
  palette: VehicleDef['palette'];
  art: string;
  tassel: string;
  flowers: string;
  mirror: string;
  bell: string;
}

function mat(color: THREE.ColorRepresentation, roughness = 0.55, metalness = 0.1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function canopyGeometry(width: number, radius: number, length: number): THREE.BufferGeometry {
  const cols = 10;
  const rows = 8;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    const z = -length / 2 + t * length;
    for (let c = 0; c <= cols; c++) {
      const s = c / cols;
      // arched roof: lower at the sides
      const x = (s - 0.5) * width;
      const arc = Math.cos((s - 0.5) * Math.PI) ;
      const y = radius * (0.55 + 0.45 * arc) * (1 - 0.06 * Math.sin(t * Math.PI));
      positions.push(x, y, z);
      uvs.push(s, t);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + 1;
      const d = a + cols + 1;
      const e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function upholsteryTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#7d1d1a';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(240,200,120,0.55)';
  ctx.lineWidth = 2;
  for (let i = -128; i < 256; i += 22) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 128, 128);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i, 128);
    ctx.lineTo(i + 128, 0);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(240,200,120,0.8)';
  for (let y = 11; y < 128; y += 22) {
    for (let x = 11; x < 128; x += 22) {
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, TAU);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

function plateTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e8dcc0';
  ctx.fillRect(0, 0, 128, 64);
  ctx.strokeStyle = '#2a2a2a';
  ctx.lineWidth = 5;
  ctx.strokeRect(4, 4, 120, 56);
  ctx.fillStyle = '#1a1a1a';
  ctx.font = `700 30px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ঢাকা', 64, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class RickshawVisual {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly wheels: THREE.Group[] = [];
  readonly steering = new THREE.Group();
  readonly crank = new THREE.Group();
  readonly canopy = new THREE.Group();
  readonly tassels: THREE.Object3D[] = [];
  readonly legs: { thigh: THREE.Mesh; shin: THREE.Mesh; side: number; hip: THREE.Vector3 }[] = [];
  /** Anchor for the seated passenger (bench position). */
  readonly seatAnchor = new THREE.Object3D();
  private bodyMat: THREE.MeshStandardMaterial;
  private trimMat: THREE.MeshStandardMaterial;
  private artMat: THREE.MeshStandardMaterial;
  private canopyMat: THREE.MeshStandardMaterial;
  private tasselMat: THREE.MeshStandardMaterial;
  private sideMat: THREE.MeshStandardMaterial;
  private flowerMeshes: THREE.Object3D[] = [];
  private artMesh: THREE.Mesh;
  private wheelSpin = 0;
  private crankAngle = 0;
  private sway = 0;
  private roll = 0;
  private pitch = 0;
  private bob = 0;

  constructor(_vehicle: VehicleDef, look: RickshawLook) {
    this.root.name = 'player-rickshaw';
    this.root.add(this.body);

    this.seatAnchor.position.set(0, 0.74, -0.62);
    this.body.add(this.seatAnchor);

    this.bodyMat = mat(look.palette.body, 0.42, 0.22);
    this.trimMat = mat(look.palette.trim, 0.32, 0.72);
    // Real rickshaw hoods are oilcloth in dark greens, reds or blacks, but they
    // always carry a painted border. Lift the base tone so the shape reads at
    // gameplay distance instead of becoming a black hole in the frame.
    this.canopyMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(look.palette.canopy).lerp(new THREE.Color('#6d5a4a'), 0.62),
      emissive: new THREE.Color('#241c16'),
      emissiveIntensity: 0.55,
      map: clothTexture(),
      roughness: 0.9,
      metalness: 0.03,
      side: THREE.DoubleSide,
    });
    this.tasselMat = mat(look.tassel, 0.85, 0.02);
    this.sideMat = mat(new THREE.Color(look.palette.body).multiplyScalar(1.15), 0.5, 0.2);

    // ---------------------------------------------------------- chassis
    const frameMat = mat('#2a2b2e', 0.45, 0.6);
    const woodMat = mat('#7c4a22', 0.8, 0.05);
    const chrome = mat('#d3d7da', 0.22, 0.85);

    // main spine
    const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 1.7, 8), frameMat);
    spine.rotation.x = Math.PI / 2;
    spine.position.set(0, 0.5, 0.0);
    spine.castShadow = true;
    this.body.add(spine);

    // lower chassis rails to rear axle
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 1.1, 6), frameMat);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(side * 0.3, 0.42, -0.32);
      this.body.add(rail);
      const stay = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.75, 6), frameMat);
      stay.position.set(side * 0.42, 0.6, -0.5);
      stay.rotation.z = side * 0.35;
      this.body.add(stay);
    }

    // rear axle
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.24, 8), frameMat);
    axle.rotation.z = Math.PI / 2;
    axle.position.set(0, 0.36, -0.42);
    this.body.add(axle);

    // ---------------------------------------------------------- wheels
    const rearL = createWheel(0.36, '#171717', '#c9c9c9', 18);
    rearL.position.set(-0.56, 0.36, -0.42);
    const rearR = createWheel(0.36, '#171717', '#c9c9c9', 18);
    rearR.position.set(0.56, 0.36, -0.42);
    const frontWheel = createWheel(0.34, '#171717', '#c9c9c9', 18);
    frontWheel.position.set(0, 0, 0);
    this.wheels.push(rearL, rearR, frontWheel);
    this.body.add(rearL, rearR);

    // mudguards over the rear wheels
    const guardMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(look.palette.body).multiplyScalar(0.82),
      roughness: 0.5,
      metalness: 0.3,
      side: THREE.DoubleSide,
    });
    for (const side of [-1, 1]) {
      const guard = new THREE.Mesh(
        new THREE.CylinderGeometry(0.41, 0.41, 0.2, 14, 1, true, -Math.PI * 0.42, Math.PI * 0.84),
        guardMat,
      );
      guard.rotation.z = Math.PI / 2;
      guard.position.set(side * 0.56, 0.4, -0.42);
      guard.castShadow = true;
      this.body.add(guard);
    }

    // ------------------------------------------------ steering + front fork
    this.steering.position.set(0, 0, 0.76);
    this.body.add(this.steering);
    const fork = new THREE.Group();
    this.steering.add(fork);
    const forkGeo = new THREE.CylinderGeometry(0.026, 0.026, 0.64, 6);
    for (const side of [-1, 1]) {
      const blade = new THREE.Mesh(forkGeo, frameMat);
      blade.position.set(side * 0.055, 0.06, 0.02);
      blade.rotation.x = -0.12;
      fork.add(blade);
    }
    fork.add(frontWheel);
    const frontGuard = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.38, 0.13, 14, 1, true, -Math.PI * 0.45, Math.PI * 0.9),
      guardMat,
    );
    frontGuard.rotation.z = Math.PI / 2;
    frontGuard.position.set(0, 0.02, 0);
    fork.add(frontGuard);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.72, 8), frameMat);
    stem.position.set(0, 0.52, -0.02);
    stem.rotation.x = -0.18;
    this.steering.add(stem);
    // handlebar
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.62, 8), chrome);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, 0.86, -0.1);
    this.steering.add(bar);
    for (const side of [-1, 1]) {
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.14, 8), mat('#20201f', 0.9, 0.0));
      grip.rotation.z = Math.PI / 2;
      grip.position.set(side * 0.28, 0.86, -0.1);
      this.steering.add(grip);
      const brakeLever = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 4), chrome);
      brakeLever.rotation.x = Math.PI / 2.4;
      brakeLever.position.set(side * 0.24, 0.82, -0.02);
      this.steering.add(brakeLever);
    }
    // front lamp + reflector
    const lampHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.07, 0.1, 10), frameMat);
    lampHousing.rotation.x = Math.PI / 2;
    lampHousing.position.set(0, 0.72, 0.14);
    this.steering.add(lampHousing);
    const lampLens = new THREE.Mesh(
      new THREE.CircleGeometry(0.055, 12),
      new THREE.MeshStandardMaterial({ color: 0xfff2c8, emissive: 0xffe9a8, emissiveIntensity: 1.6 }),
    );
    lampLens.position.set(0, 0.72, 0.2);
    this.steering.add(lampLens);
    const headlight = new THREE.SpotLight(0xffe6b0, 0, 26, 0.5, 0.5, 1.4);
    headlight.position.set(0, 0.72, 0.24);
    headlight.target.position.set(0, 0.1, 6);
    this.steering.add(headlight, headlight.target);
    this.headlight = headlight;

    // bell on the bar
    const bell = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 10, 8, 0, TAU, 0, Math.PI / 2),
      mat('#e2b45a', 0.28, 0.85),
    );
    bell.position.set(0.16, 0.9, -0.12);
    this.steering.add(bell);
    this.bellMesh = bell;

    // ------------------------------------------------------------- seating
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.3), mat('#2b2622', 0.85, 0.02));
    saddle.position.set(0, 0.88, 0.16);
    saddle.rotation.x = 0.06;
    this.body.add(saddle);
    const seatPost = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.34, 6), chrome);
    seatPost.position.set(0, 0.71, 0.16);
    this.body.add(seatPost);

    const upholstery = upholsteryTexture();
    const benchMat = new THREE.MeshStandardMaterial({ map: upholstery, color: 0xffffff, roughness: 0.86 });
    const bench = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.12, 0.62), benchMat);
    bench.position.set(0, 0.68, -0.62);
    bench.castShadow = true;
    this.body.add(bench);
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.42, 0.09), benchMat);
    backrest.position.set(0, 0.9, -0.9);
    backrest.rotation.x = -0.12;
    this.body.add(backrest);
    // bench frame
    const benchBase = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.1, 0.7), woodMat);
    benchBase.position.set(0, 0.58, -0.62);
    this.body.add(benchBase);
    for (const side of [-1, 1]) {
      const armRail = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.2, 6), chrome);
      armRail.rotation.x = Math.PI / 2;
      armRail.position.set(side * 0.5, 0.92, -0.45);
      this.body.add(armRail);
    }

    // passenger footboard
    const footboard = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.05, 0.34), woodMat);
    footboard.position.set(0, 0.3, -0.12);
    this.body.add(footboard);

    // -------------------------------------------------------- rear panel art
    this.artMat = new THREE.MeshStandardMaterial({
      map: rickshawArtTexture(look.art, look.palette.panel, look.palette.trim),
      roughness: 0.62,
      metalness: 0.04,
    });
    const artGeo = new THREE.PlaneGeometry(0.98, 0.86);
    this.artMesh = new THREE.Mesh(artGeo, this.artMat);
    this.artMesh.position.set(0, 0.82, -1.03);
    this.artMesh.rotation.y = Math.PI;
    this.body.add(this.artMesh);
    // panel frame
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.94, 0.05), this.trimMat);
    frame.position.set(0, 0.82, -0.985);
    this.body.add(frame);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.15), new THREE.MeshStandardMaterial({ map: plateTexture() }));
    plate.position.set(0, 0.44, -1.02);
    plate.rotation.y = Math.PI;
    this.body.add(plate);

    // side panels with painted trim
    for (const side of [-1, 1]) {
      const sidePanel = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.6, 0.9), this.sideMat);
      sidePanel.position.set(side * 0.53, 0.62, -0.55);
      sidePanel.castShadow = true;
      this.body.add(sidePanel);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.08, 0.9), this.trimMat);
      stripe.position.set(side * 0.54, 0.86, -0.55);
      this.body.add(stripe);
    }

    // -------------------------------------------------------------- canopy
    this.canopy.position.set(0, 0, -0.42);
    this.body.add(this.canopy);
    const canopyMesh = new THREE.Mesh(canopyGeometry(1.24, 1.28, 1.24), this.canopyMat);
    canopyMesh.position.set(0, 0.52, 0);
    canopyMesh.castShadow = true;
    canopyMesh.receiveShadow = true;
    this.canopy.add(canopyMesh);
    for (const side of [-1, 1]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 1.2), this.trimMat);
      edge.position.set(side * 0.6, 0.78, 0);
      this.canopy.add(edge);
    }
    // painted valance along the canopy edge (bright band that separates the
    // hood from the street behind it)
    const valance = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 0.02), this.trimMat);
    valance.position.set(0, 1.1, -0.63);
    this.canopy.add(valance);
    // wooden bows
    for (const zOff of [-0.5, 0, 0.5]) {
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.022, 5, 16, Math.PI), woodMat);
      bow.rotation.y = Math.PI / 2;
      bow.rotation.z = 0;
      bow.position.set(0, 0.98, zOff);
      this.canopy.add(bow);
    }
    // rear curtain with art
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(1.04, 0.46), this.artMat);
    curtain.position.set(0, 0.66, -0.618);
    curtain.rotation.y = Math.PI;
    this.canopy.add(curtain);
    // rolled-up cloth bundle at the top of the curtain (as on a real hood)
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.08, 8), this.trimMat);
    roll.rotation.z = Math.PI / 2;
    roll.position.set(0, 0.92, -0.62);
    this.canopy.add(roll);

    // tassels along the canopy edge
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const x = -0.56 + t * 1.12;
      const tassel = new THREE.Group();
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.1, 4), this.tasselMat);
      cord.position.y = -0.05;
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.026, 6, 5), this.tasselMat);
      knot.position.y = -0.1;
      const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.12, 6), this.tasselMat);
      skirt.position.y = -0.19;
      skirt.rotation.x = Math.PI;
      tassel.add(cord, knot, skirt);
      tassel.position.set(x, 1.32, -1.0 + Math.abs(x) * 0.12);
      this.body.add(tassel);
      this.tassels.push(tassel);
    }

    // plastic flowers and mirrors on the frame
    for (const side of [-1, 1]) {
      const mirror = new THREE.Mesh(
        new THREE.CircleGeometry(0.06, 12),
        new THREE.MeshStandardMaterial({ color: 0xd8e0e4, metalness: 0.9, roughness: 0.12, side: THREE.DoubleSide }),
      );
      mirror.position.set(side * 0.3, 1.0, 0.02);
      mirror.rotation.y = side * 0.5;
      this.body.add(mirror);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.008, 4, 12), this.trimMat);
      ring.position.copy(mirror.position);
      ring.rotation.copy(mirror.rotation);
      this.body.add(ring);

      const flower = new THREE.Group();
      const petalMat = new THREE.MeshStandardMaterial({ color: 0xf0a500, roughness: 0.8 });
      for (let p = 0; p < 5; p++) {
        const petal = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), petalMat);
        const a = (p / 5) * TAU;
        petal.position.set(Math.cos(a) * 0.035, Math.sin(a) * 0.035, 0);
        petal.scale.set(1, 1, 0.5);
        flower.add(petal);
      }
      const centre = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 5), mat('#7a1f14', 0.8));
      flower.add(centre);
      flower.position.set(side * 0.5, 1.28, -0.15);
      flower.rotation.y = side * 0.6;
      this.body.add(flower);
      this.flowerMeshes.push(flower as unknown as THREE.Mesh);
    }

    // --------------------------------------------------------- rider (driver)
    const skin = mat('#8a5a3c', 0.75);
    const shirt = mat('#e8e2d2', 0.9);
    const lungi = mat('#2f5a4a', 0.92);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.34, 4, 10), shirt);
    torso.position.set(0, 1.16, 0.2);
    torso.rotation.x = 0.16;
    torso.castShadow = true;
    this.body.add(torso);
    const hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.12, 3, 8), lungi);
    hips.position.set(0, 0.92, 0.18);
    this.body.add(hips);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), skin);
    head.position.set(0, 1.47, 0.26);
    head.castShadow = true;
    this.body.add(head);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8, 0, TAU, 0, Math.PI / 2), mat('#1d4a3a', 0.9));
    cap.position.set(0, 1.5, 0.26);
    this.body.add(cap);
    const gamcha = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.028, 5, 10), mat('#c95a3a', 0.9));
    gamcha.position.set(0, 1.34, 0.27);
    gamcha.rotation.x = Math.PI / 2.2;
    this.body.add(gamcha);
    // arms reaching the handlebar
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.4, 3, 6), shirt);
      arm.position.set(side * 0.22, 1.0, 0.5);
      arm.rotation.x = 1.28;
      arm.rotation.z = side * 0.12;
      this.body.add(arm);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.038, 6, 5), skin);
      hand.position.set(side * 0.27, 0.88, 0.72);
      this.body.add(hand);
    }

    // legs (animated towards the pedals)
    for (const side of [-1, 1]) {
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.3, 3, 6), lungi);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.3, 3, 6), skin);
      this.body.add(thigh, shin);
      this.legs.push({ thigh, shin, side, hip: new THREE.Vector3(side * 0.13, 0.9, 0.16) });
    }
    // feet
    for (const side of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.16), mat('#33261c', 0.9));
      foot.position.set(side * 0.14, 0.34, 0.42);
      this.body.add(foot);
    }

    // --------------------------------------------------------------- crank
    this.crank.position.set(0, 0.4, 0.36);
    this.body.add(this.crank);
    const chainring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.016, 4, 14), chrome);
    chainring.rotation.y = Math.PI / 2;
    this.crank.add(chainring);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.2, 0.03), frameMat);
      arm.position.set(side * 0.09, side * 0.09, 0);
      this.crank.add(arm);
      const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.11), mat('#2a2a2a', 0.9));
      pedal.position.set(side * 0.135, side * 0.18, 0);
      this.crank.add(pedal);
    }
    // chain line to the rear axle
    const chain = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.8), mat('#3a3a3a', 0.6, 0.7));
    chain.position.set(0.09, 0.4, 0.0);
    this.body.add(chain);

    // reflective tape and small details
    const reflector = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.03, 0.01),
      new THREE.MeshStandardMaterial({ color: 0xd63b2f, emissive: 0x5a0f08, emissiveIntensity: 0.6 }),
    );
    reflector.position.set(0, 0.42, -1.02);
    this.body.add(reflector);

    this.mergeStaticBody();
    this.applyLook(look);
    this.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
  }

  headlight!: THREE.SpotLight;
  bellMesh!: THREE.Mesh;

  /**
   * Collapse the ~40 individual painted parts of the chassis into one mesh per
   * material. The hero vehicle is on screen every frame, so this is the single
   * biggest draw-call saving in the game (each material is also doubled by the
   * shadow pass). Animated parts (steering, wheels, crank, legs, canopy, tassels)
   * are excluded and stay as separate objects.
   */
  private mergeStaticBody(): void {
    const animated = new Set<THREE.Object3D>([
      this.steering,
      this.crank,
      this.canopy,
      ...this.wheels,
      ...this.tassels,
      ...this.legs.map((l) => l.thigh),
      ...this.legs.map((l) => l.shin),
      this.artMesh,
      this.headlight,
      this.headlight.target,
    ]);
    const byMaterial = new Map<THREE.MeshStandardMaterial, THREE.BufferGeometry[]>();
    const victims: THREE.Object3D[] = [];
    this.body.updateMatrixWorld(true);
    for (const child of [...this.body.children]) {
      if (!(child instanceof THREE.Mesh)) continue;
      if (animated.has(child)) continue;
      if (child instanceof THREE.InstancedMesh) continue;
      if (animated.has(child.parent as THREE.Object3D)) continue;
      const mat = child.material as THREE.MeshStandardMaterial;
      if (!mat || Array.isArray(mat)) continue;
      const geo = child.geometry.clone();
      geo.applyMatrix4(child.matrix);
      // keep attribute sets identical for merging
      if (!geo.getAttribute('uv')) {
        geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
      }
      if (!geo.getAttribute('color')) {
        const count = geo.getAttribute('position').count;
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
      }
      for (const name of Object.keys(geo.attributes)) {
        if (!['position', 'normal', 'uv', 'color'].includes(name)) geo.deleteAttribute(name);
      }
      let list = byMaterial.get(mat);
      if (!list) {
        list = [];
        byMaterial.set(mat, list);
      }
      list.push(geo);
      victims.push(child);
    }
    for (const child of victims) this.body.remove(child);
    for (const [mat, geos] of byMaterial) {
      if (geos.length === 0) continue;
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!merged) continue;
      if (geos.length > 1) for (const g of geos) g.dispose();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.body.add(mesh);
    }
  }

  /** Change paint / art / tassels / flowers without rebuilding the rig. */
  applyLook(look: RickshawLook): void {
    this.bodyMat.color.set(look.palette.body);
    this.trimMat.color.set(look.palette.trim);
    this.canopyMat.color.set(look.palette.canopy);
    this.tasselMat.color.set(look.tassel);
    this.artMat.map?.dispose();
    this.artMat.map = rickshawArtTexture(look.art, look.palette.panel, look.palette.trim);
    this.artMat.needsUpdate = true;
    const flowerColor = look.flowers === 'rose' ? 0xd64a6a : 0xf0a500;
    this.body.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
        if (obj.geometry instanceof THREE.SphereGeometry && obj.geometry.parameters.radius === 0.03) {
          obj.material.color.setHex(flowerColor);
        }
      }
    });
  }

  setNightLighting(on: boolean, strength = 1): void {
    this.headlight.intensity = on ? 26 * strength : 0;
    const lens = this.steering.children.find(
      (c) => c instanceof THREE.Mesh && c.geometry instanceof THREE.CircleGeometry,
    ) as THREE.Mesh | undefined;
    if (lens) {
      const m = lens.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = on ? 2.4 : 0.25;
    }
  }

  /** Drive the animation rig. */
  updateVisual(dt: number, speed: number, steer: number, throttle: number, lateralAccel: number, groundY: number): void {
    this.wheelSpin -= (speed / 0.36) * dt;
    for (const wheel of this.wheels) wheel.rotation.x = this.wheelSpin;
    this.steering.rotation.y = damp(this.steering.rotation.y, steer * 0.9, 9, dt);

    // pedalling speed follows the rickshaw speed (plus a little while pushing off)
    const pedalling = Math.abs(speed) > 0.12 || throttle > 0.1;
    this.crankAngle += (pedalling ? Math.max(1.6, Math.abs(speed) * 1.9) : 0) * dt;
    this.crank.rotation.x = this.crankAngle;

    // two-bone legs towards the pedals
    for (const leg of this.legs) {
      const pedalAngle = this.crankAngle + (leg.side > 0 ? 0 : Math.PI);
      const pedal = new THREE.Vector3(0.14 * leg.side, 0.4 + Math.cos(pedalAngle) * 0.18, 0.36 + Math.sin(pedalAngle) * 0.18);
      const hip = leg.hip;
      const toPedal = pedal.clone().sub(hip);
      const dist = toPedal.length();
      const thighLen = 0.34;
      const shinLen = 0.34;
      const clamped = Math.min(Math.max(dist, 0.06), thighLen + shinLen - 0.01);
      const dir = toPedal.clone().normalize();
      const a = (thighLen * thighLen - shinLen * shinLen + clamped * clamped) / (2 * clamped);
      const h = Math.sqrt(Math.max(0, thighLen * thighLen - a * a));
      const mid = hip.clone().addScaledVector(dir, a);
      // bend the knee forward (+Z)
      const perp = new THREE.Vector3(0, 0, 1).cross(dir).normalize();
      const side = new THREE.Vector3(1, 0, 0).cross(perp).normalize();
      const knee = mid.clone().addScaledVector(side, h * 0.9);
      this.placeLimb(leg.thigh, hip, knee, 0.34);
      this.placeLimb(leg.shin, knee, pedal, 0.32);
    }

    // suspension / body language
    this.bob = damp(this.bob, 0, 8, dt);
    this.roll = damp(this.roll, -lateralAccel * 0.022, 7, dt);
    this.pitch = damp(this.pitch, -Math.min(0.05, Math.abs(speed) * 0.004), 6, dt);
    this.body.rotation.z = this.roll;
    this.body.rotation.x = this.pitch;
    this.body.position.y = groundY * 0 - this.bob;

    // canopy sway + tassels
    this.sway = damp(this.sway, -lateralAccel * 0.02 + speed * 0.004, 4, dt);
    this.canopy.rotation.z = this.sway * 0.5;
    this.canopy.rotation.x = Math.sin(this.crankAngle * 0.5) * 0.004;
    for (let i = 0; i < this.tassels.length; i++) {
      const t = this.tassels[i];
      t.rotation.z = Math.sin(performance.now() * 0.004 + i * 0.7) * 0.16 + this.sway * 0.8;
      t.rotation.x = Math.cos(performance.now() * 0.003 + i) * 0.1;
    }
  }

  private placeLimb(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3, baseLen: number): void {
    const dir = to.clone().sub(from);
    const len = dir.length();
    mesh.position.copy(from).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    mesh.scale.set(1, Math.max(0.2, len / baseLen), 1);
  }

  setArt(style: string, panelColor: string, trim: string): void {
    this.artMat.map?.dispose();
    this.artMat.map = rickshawArtTexture(style, panelColor, trim);
    this.artMat.needsUpdate = true;
  }

  dispose(): void {
    this.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
  }
}

/** Build the look data from the selected vehicle + equipped cosmetics. */
export function lookFrom(
  vehicle: VehicleDef,
  cosmetics: Record<CosmeticCategory, string>,
  cosmeticValue: (category: CosmeticCategory) => { value: string } | undefined,
): RickshawLook {
  const paint = cosmeticValue('paint')?.value;
  const art = cosmeticValue('art')?.value;
  const tassel = cosmeticValue('tassel')?.value;
  const flowers = cosmeticValue('flowers')?.value;
  const mirror = cosmeticValue('mirror')?.value;
  const bell = cosmeticValue('bell')?.value;
  const palette = { ...vehicle.palette };
  if (paint) palette.body = paint;
  void cosmetics;
  return {
    palette,
    art: art ?? vehicle.artStyle,
    tassel: tassel ?? '#d63b2f',
    flowers: flowers ?? 'marigold',
    mirror: mirror ?? 'round',
    bell: bell ?? 'classic',
  };
}
