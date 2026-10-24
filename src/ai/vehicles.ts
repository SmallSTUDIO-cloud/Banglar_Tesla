/**
 * Authentic Dhaka traffic fleet models (Section 8) with cached merged geometry
 * templates for low draw calls, zero GPU leaks, and exact wheel-ground contact:
 *   - cng       : Dhaka green CNG auto-rickshaw with black security grill cage
 *   - rickshaw  : NPC Bangladeshi passenger cycle rickshaw with puller & hood
 *   - easybike  : Bangladeshi battery-powered Electric Rickshaw / Auto
 *   - bus       : Mohammadpur route city bus with window bays, roof rack & door
 *   - car       : Sculpted Dhaka sedan with cabin pillars, grille & mirrors
 *   - truck     : Colourful Bangladeshi painted cargo truck with crown header
 *   - van       : Urban covered market/parcel delivery pickup van
 *   - motorbike : 150cc commuter motorcycle with helmeted rider & exhaust
 */

import * as THREE from 'three';
import { Bucket, createWheel } from '../world/geo';

export type TrafficType =
  | 'cng'
  | 'rickshaw'
  | 'easybike'
  | 'bus'
  | 'car'
  | 'truck'
  | 'van'
  | 'motorbike';

export interface BuiltTrafficMesh {
  root: THREE.Group;
  wheels: THREE.Object3D[];
  wheelRadius: number;
  halfLength: number;
  halfWidth: number;
  radius: number;
  brakeMat: THREE.MeshStandardMaterial | null;
}

const bodyPaintMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.44,
  metalness: 0.28,
  side: THREE.DoubleSide,
});
bodyPaintMat.userData.shared = true;

const trimMetalMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.28,
  metalness: 0.78,
});
trimMetalMat.userData.shared = true;

const glassMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.14,
  metalness: 0.65,
});
glassMat.userData.shared = true;

const headGlowMat = new THREE.MeshStandardMaterial({
  color: 0xfff5cf,
  emissive: 0xffdf9a,
  emissiveIntensity: 0.75,
  roughness: 0.25,
});
headGlowMat.userData.shared = true;

interface CachedBodyTemplate {
  paintGeo: THREE.BufferGeometry | null;
  metalGeo: THREE.BufferGeometry | null;
  glassGeo: THREE.BufferGeometry | null;
  headGeo: THREE.BufferGeometry | null;
  brakeGeo: THREE.BufferGeometry | null;
  wheelPositions: { x: number; y: number; z: number }[];
  wheelRadius: number;
  spokedWheels: boolean;
  halfLength: number;
  halfWidth: number;
  radius: number;
}

const templateCache = new Map<string, CachedBodyTemplate>();

function buildDiscWheel(outerRadius: number, width: number): THREE.Group {
  const key = `disc:${outerRadius.toFixed(3)}:${width.toFixed(3)}`;
  const cached = discWheelGeoCache.get(key);
  let tireGeo: THREE.BufferGeometry;
  let hubGeo: THREE.BufferGeometry;
  if (cached) {
    tireGeo = cached.tireGeo;
    hubGeo = cached.hubGeo;
  } else {
    const bTire = new Bucket('disc.tire', bodyPaintMat);
    bTire.cylinder({ x: 0, y: 0, z: 0 }, outerRadius, width, '#1a1c1f', { z: Math.PI / 2 });
    const bHub = new Bucket('disc.hub', trimMetalMat);
    bHub.cylinder({ x: 0, y: 0, z: 0 }, outerRadius * 0.58, width + 0.012, '#cfd6de', { z: Math.PI / 2 });
    bHub.cylinder({ x: 0, y: 0, z: 0 }, outerRadius * 0.2, width + 0.024, '#5a626a', { z: Math.PI / 2 });
    tireGeo = bTire.build()!.geometry;
    hubGeo = bHub.build()!.geometry;
    tireGeo.userData.shared = true;
    hubGeo.userData.shared = true;
    discWheelGeoCache.set(key, { tireGeo, hubGeo });
  }
  const g = new THREE.Group();
  const m1 = new THREE.Mesh(tireGeo, bodyPaintMat);
  const m2 = new THREE.Mesh(hubGeo, trimMetalMat);
  m1.castShadow = true;
  m1.userData.shared = true;
  m2.userData.shared = true;
  g.add(m1, m2);
  return g;
}
const discWheelGeoCache = new Map<string, { tireGeo: THREE.BufferGeometry; hubGeo: THREE.BufferGeometry }>();

function getOrBuildTemplate(type: TrafficType, variant: number): CachedBodyTemplate {
  const v = ((variant % 4) + 4) % 4;
  const key = `${type}:${v}`;
  const hit = templateCache.get(key);
  if (hit) return hit;

  const paint = new Bucket(`${key}.paint`, bodyPaintMat);
  const metal = new Bucket(`${key}.metal`, trimMetalMat);
  const glass = new Bucket(`${key}.glass`, glassMat);
  const head = new Bucket(`${key}.head`, headGlowMat);
  const brake = new Bucket(`${key}.brake`, headGlowMat);

  let wheelRadius = 0.32;
  let spokedWheels = false;
  let halfLength = 1.9;
  let halfWidth = 0.85;
  let radius = 1.5;
  const wheelPositions: { x: number; y: number; z: number }[] = [];

  if (type === 'cng') {
    // Dhaka Green CNG Auto-Rickshaw with black security grill doors!
    wheelRadius = 0.25;
    halfLength = 1.34;
    halfWidth = 0.68;
    radius = 1.15;
    const green = ['#177245', '#12653c', '#1e7f4f', '#155d39'][v];
    // Lower tub + tapered front nose + rear engine bay
    paint.box({ x: 0, y: 0.46, z: -0.18 }, { x: 1.24, y: 0.42, z: 1.72 }, green);
    paint.box({ x: 0, y: 0.48, z: 0.86 }, { x: 0.82, y: 0.40, z: 0.56 }, green);
    paint.box({ x: 0, y: 0.34, z: 1.02 }, { x: 0.30, y: 0.12, z: 0.34 }, green); // front fender
    // Yellow/black Dhaka meter band + canvas canopy top
    paint.box({ x: 0, y: 0.69, z: -0.18 }, { x: 1.26, y: 0.06, z: 1.74 }, '#e6b832');
    paint.box({ x: 0, y: 1.48, z: -0.10 }, { x: 1.24, y: 0.10, z: 1.84 }, '#1d221e');
    paint.box({ x: 0, y: 1.54, z: -0.12 }, { x: 1.12, y: 0.06, z: 1.66 }, '#2a302b');
    // Windshield frame + glass + wiper
    metal.box({ x: 0, y: 1.08, z: 0.78 }, { x: 1.06, y: 0.68, z: 0.05 }, green, { x: -0.22 });
    glass.box({ x: 0, y: 1.09, z: 0.80 }, { x: 0.94, y: 0.54, z: 0.03 }, '#1e3a48', { x: -0.22 });
    metal.box({ x: 0.06, y: 1.04, z: 0.83 }, { x: 0.02, y: 0.42, z: 0.02 }, '#111111', { x: -0.22, z: 0.32 });
    // Signature Dhaka CNG welded steel grill side doors!
    for (const sx of [-0.61, 0.61]) {
      metal.cylinder({ x: sx, y: 1.08, z: -0.95 }, 0.018, 0.78, '#1e2226');
      metal.cylinder({ x: sx, y: 1.08, z: 0.55 }, 0.018, 0.78, '#1e2226');
      for (let g = 0; g < 5; g++) {
        metal.box({ x: sx, y: 0.78 + g * 0.14, z: -0.15 }, { x: 0.018, y: 0.016, z: 1.46 }, '#202428');
      }
      for (let vz = -0.75; vz <= 0.45; vz += 0.3) {
        metal.box({ x: sx, y: 1.06, z: vz }, { x: 0.018, y: 0.62, z: 0.016 }, '#202428');
      }
      // Side mirrors
      metal.box({ x: sx * 1.12, y: 1.12, z: 0.76 }, { x: 0.10, y: 0.08, z: 0.03 }, '#cfd6de');
    }
    // Interior passenger seat + driver + rear spare wheel
    paint.box({ x: 0, y: 0.68, z: -0.58 }, { x: 1.08, y: 0.28, z: 0.45 }, '#542a1c');
    paint.cylinder({ x: 0, y: 1.02, z: 0.25 }, 0.16, 0.46, '#2b4c72');
    paint.cylinder({ x: 0, y: 0.86, z: -1.07 }, 0.22, 0.11, '#1a1c1f', { x: Math.PI / 2 });
    // Headlight + amber indicators + tail brake lamps
    head.cylinder({ x: 0, y: 0.64, z: 1.15 }, 0.085, 0.03, '#fff6cf', { x: Math.PI / 2 });
    for (const sx of [-0.34, 0.34]) {
      head.box({ x: sx, y: 0.62, z: 1.14 }, { x: 0.08, y: 0.05, z: 0.02 }, '#ffb428');
      brake.box({ x: sx * 1.4, y: 0.62, z: -1.05 }, { x: 0.14, y: 0.08, z: 0.025 }, '#e52521');
    }
    wheelPositions.push(
      { x: 0, y: wheelRadius, z: 0.96 },
      { x: 0.56, y: wheelRadius, z: -0.68 },
      { x: -0.56, y: wheelRadius, z: -0.68 },
    );
  } else if (type === 'rickshaw') {
    // NPC Bangladeshi Passenger Cycle Rickshaw (dense lane traffic!)
    wheelRadius = 0.375;
    spokedWheels = true;
    halfLength = 1.25;
    halfWidth = 0.58;
    radius = 1.02;
    const hoodColors = ['#b31329', '#126499', '#1c7c54', '#9e2870'];
    const trimColors = ['#f2b938', '#ffd166', '#4ef0b8', '#ff9f43'];
    const hood = hoodColors[v];
    const trim = trimColors[v];
    // Frame, footboard, carriage, quilted seat, ornate backplate & arched hood
    metal.cylinder({ x: 0, y: 0.38, z: -0.66 }, 0.02, 1.08, '#9aa3ad', { z: Math.PI / 2 });
    metal.cylinder({ x: 0, y: 0.66, z: 0.38 }, 0.022, 0.92, '#145a44', { x: 0.98 });
    metal.cylinder({ x: 0, y: 0.88, z: 0.36 }, 0.018, 0.84, '#145a44', { x: Math.PI / 2 });
    metal.cylinder({ x: 0, y: 0.94, z: 0.78 }, 0.02, 0.42, '#cfd6de', { x: -0.14 });
    metal.cylinder({ x: 0, y: 1.15, z: 0.73 }, 0.014, 0.42, '#dce3ea', { z: Math.PI / 2 });
    paint.box({ x: 0, y: 0.53, z: -0.34 }, { x: 0.88, y: 0.04, z: 0.36 }, '#5e3c20');
    paint.box({ x: 0, y: 0.65, z: -0.76 }, { x: 0.90, y: 0.22, z: 0.54 }, '#145a44');
    paint.box({ x: 0, y: 0.78, z: -0.74 }, { x: 0.84, y: 0.11, z: 0.46 }, '#a61c2b');
    paint.box({ x: 0, y: 1.02, z: -0.98 }, { x: 0.88, y: 0.56, z: 0.06 }, trim);
    paint.box({ x: 0, y: 1.02, z: -1.015 }, { x: 0.78, y: 0.46, z: 0.02 }, hood);
    for (const side of [-1, 1]) {
      paint.box({ x: side * 0.44, y: 0.92, z: -0.74 }, { x: 0.05, y: 0.36, z: 0.52 }, hood);
      paint.box({ x: side * 0.52, y: 0.72, z: -0.66 }, { x: 0.12, y: 0.06, z: 0.72 }, '#145a44');
    }
    // Arched folding hood + front valance
    paint.box({ x: 0, y: 1.44, z: -0.96 }, { x: 0.96, y: 0.32, z: 0.06 }, hood, { x: 0.32 });
    paint.box({ x: 0, y: 1.66, z: -0.64 }, { x: 0.96, y: 0.10, z: 0.68 }, hood);
    paint.box({ x: 0, y: 1.71, z: -0.64 }, { x: 0.98, y: 0.025, z: 0.12 }, trim);
    paint.box({ x: 0, y: 1.52, z: -0.26 }, { x: 0.96, y: 0.09, z: 0.03 }, trim);
    // Puller in lungi & shirt + occasional passenger
    paint.box({ x: 0, y: 1.22, z: 0.04 }, { x: 0.32, y: 0.40, z: 0.20 }, ['#d98236', '#2e86ab', '#6ab04c', '#eb4d4b'][v], { x: 0.25 });
    paint.cylinder({ x: 0, y: 1.49, z: 0.12 }, 0.09, 0.18, '#8b5e3c');
    paint.cylinder({ x: 0, y: 0.92, z: 0.02 }, 0.15, 0.36, '#1f4e70');
    if (v % 2 === 0) {
      paint.box({ x: 0.12, y: 1.12, z: -0.74 }, { x: 0.32, y: 0.38, z: 0.22 }, '#f0b429');
      paint.cylinder({ x: 0.12, y: 1.38, z: -0.74 }, 0.085, 0.17, '#8b5e3c');
    }
    head.cylinder({ x: 0, y: 0.90, z: 0.85 }, 0.045, 0.03, '#ffe7a8', { x: Math.PI / 2 });
    brake.box({ x: -0.32, y: 0.60, z: -1.03 }, { x: 0.06, y: 0.05, z: 0.02 }, '#e52521');
    brake.box({ x: 0.32, y: 0.60, z: -1.03 }, { x: 0.06, y: 0.05, z: 0.02 }, '#e52521');
    wheelPositions.push(
      { x: 0, y: wheelRadius, z: 0.78 },
      { x: 0.52, y: wheelRadius, z: -0.66 },
      { x: -0.52, y: wheelRadius, z: -0.66 },
    );
  } else if (type === 'easybike') {
    // Bangladeshi Battery-Powered Electric Auto / EasyBike!
    wheelRadius = 0.28;
    halfLength = 1.48;
    halfWidth = 0.72;
    radius = 1.24;
    const bodyCol = ['#0f7a8c', '#c92a3e', '#1d5fa7', '#d97b16'][v];
    paint.box({ x: 0, y: 0.48, z: -0.15 }, { x: 1.32, y: 0.38, z: 2.05 }, bodyCol);
    paint.box({ x: 0, y: 0.52, z: 0.98 }, { x: 0.88, y: 0.44, z: 0.52 }, bodyCol);
    paint.box({ x: 0, y: 1.62, z: -0.05 }, { x: 1.34, y: 0.08, z: 2.28 }, '#f4f1e6');
    paint.box({ x: 0, y: 1.67, z: -0.05 }, { x: 1.26, y: 0.04, z: 2.18 }, bodyCol);
    glass.box({ x: 0, y: 1.16, z: 0.94 }, { x: 1.06, y: 0.62, z: 0.04 }, '#204254', { x: -0.16 });
    for (const sx of [-0.63, 0.63]) {
      metal.cylinder({ x: sx, y: 1.15, z: 0.90 }, 0.018, 0.92, '#dce3ea');
      metal.cylinder({ x: sx, y: 1.15, z: -0.12 }, 0.016, 0.92, '#dce3ea');
      metal.cylinder({ x: sx, y: 1.15, z: -1.10 }, 0.018, 0.92, '#dce3ea');
      metal.box({ x: sx, y: 0.86, z: -0.45 }, { x: 0.03, y: 0.24, z: 1.26 }, bodyCol);
    }
    // Dual facing passenger benches + under-seat battery bank
    paint.box({ x: 0, y: 0.32, z: -0.35 }, { x: 0.96, y: 0.16, z: 0.95 }, '#1d242b');
    paint.box({ x: 0, y: 0.72, z: -0.82 }, { x: 1.16, y: 0.18, z: 0.42 }, '#7a2323');
    paint.box({ x: 0, y: 0.72, z: -0.12 }, { x: 1.16, y: 0.18, z: 0.38 }, '#7a2323');
    head.cylinder({ x: 0, y: 0.74, z: 1.25 }, 0.09, 0.03, '#e8fbff', { x: Math.PI / 2 });
    brake.box({ x: -0.46, y: 0.56, z: -1.18 }, { x: 0.16, y: 0.08, z: 0.025 }, '#e52521');
    brake.box({ x: 0.46, y: 0.56, z: -1.18 }, { x: 0.16, y: 0.08, z: 0.025 }, '#e52521');
    wheelPositions.push(
      { x: 0, y: wheelRadius, z: 1.06 },
      { x: 0.60, y: wheelRadius, z: -0.78 },
      { x: -0.60, y: wheelRadius, z: -0.78 },
    );
  } else if (type === 'bus') {
    // Mohammadpur / Dhaka Local Minibus (Projapoti / BRTC / Taranga Plus style!)
    wheelRadius = 0.46;
    halfLength = 3.85;
    halfWidth = 1.22;
    radius = 2.75;
    const schemes = [
      { low: '#b7282e', mid: '#f4efe0', stripe: '#1c7c54' },
      { low: '#165a8a', mid: '#eef3f7', stripe: '#f2a922' },
      { low: '#1e6f50', mid: '#f5f0dc', stripe: '#d93829' },
      { low: '#8a2b52', mid: '#f6efe4', stripe: '#229ebc' },
    ];
    const sc = schemes[v];
    // Lower skirt, upper window belt, curved roof cap + AC unit
    paint.box({ x: 0, y: 0.92, z: 0 }, { x: 2.38, y: 0.96, z: 7.42 }, sc.low);
    paint.box({ x: 0, y: 1.38, z: 0 }, { x: 2.41, y: 0.14, z: 7.46 }, sc.stripe);
    paint.box({ x: 0, y: 2.08, z: 0 }, { x: 2.36, y: 1.26, z: 7.36 }, sc.mid);
    paint.box({ x: 0, y: 2.78, z: 0 }, { x: 2.22, y: 0.18, z: 7.12 }, sc.low);
    paint.box({ x: 0, y: 2.94, z: 0.4 }, { x: 1.56, y: 0.20, z: 2.6 }, '#cfd6de'); // rooftop AC pod
    metal.box({ x: 0, y: 0.46, z: 3.74 }, { x: 2.40, y: 0.24, z: 0.14 }, '#282d33'); // steel front bumper
    metal.box({ x: 0, y: 0.46, z: -3.74 }, { x: 2.40, y: 0.24, z: 0.14 }, '#282d33');
    // Panoramic front windshield + destination board + rear glass
    glass.box({ x: 0, y: 2.02, z: 3.69 }, { x: 2.14, y: 0.96, z: 0.05 }, '#193240');
    paint.box({ x: 0, y: 2.62, z: 3.70 }, { x: 1.68, y: 0.22, z: 0.05 }, '#102419');
    head.box({ x: 0, y: 2.62, z: 3.73 }, { x: 1.48, y: 0.12, z: 0.02 }, '#ffd65a'); // illuminated route sign
    glass.box({ x: 0, y: 2.06, z: -3.69 }, { x: 1.98, y: 0.78, z: 0.05 }, '#193240');
    // 6 framed side passenger windows + left-side Dhaka boarding door recess
    for (let wz = -2.8; wz <= 2.6; wz += 1.05) {
      glass.box({ x: -1.19, y: 2.06, z: wz }, { x: 0.04, y: 0.74, z: 0.84 }, '#1a3544');
      if (wz < 1.6) {
        glass.box({ x: 1.19, y: 2.06, z: wz }, { x: 0.04, y: 0.74, z: 0.84 }, '#1a3544');
      }
    }
    glass.box({ x: 1.16, y: 1.48, z: 2.35 }, { x: 0.08, y: 1.75, z: 0.86 }, '#111920'); // boarding doorway
    // Grille + twin headlamps + long bus mirrors + tail lamps
    metal.box({ x: 0, y: 0.92, z: 3.73 }, { x: 1.36, y: 0.42, z: 0.04 }, '#22282e');
    for (const sx of [-1, 1]) {
      head.box({ x: sx * 0.88, y: 0.88, z: 3.73 }, { x: 0.34, y: 0.20, z: 0.04 }, '#fff3c4');
      brake.box({ x: sx * 0.92, y: 1.02, z: -3.73 }, { x: 0.28, y: 0.34, z: 0.04 }, '#e52521');
      metal.box({ x: sx * 1.28, y: 2.18, z: 3.78 }, { x: 0.14, y: 0.30, z: 0.06 }, '#1e2226');
    }
    wheelPositions.push(
      { x: 1.06, y: wheelRadius, z: 2.35 },
      { x: -1.06, y: wheelRadius, z: 2.35 },
      { x: 1.06, y: wheelRadius, z: -2.25 },
      { x: -1.06, y: wheelRadius, z: -2.25 },
    );
  } else if (type === 'truck') {
    // Bangladeshi Painted Cargo Truck (Tata / Bedford style with ornate crown!)
    wheelRadius = 0.45;
    halfLength = 3.25;
    halfWidth = 1.15;
    radius = 2.4;
    const cabCol = ['#d97724', '#1d6fa5', '#2a8c55', '#b83232'][v];
    const bedCol = ['#1f5f4b', '#8c2d3c', '#2c4c7e', '#6d4c2f'][v];
    // Chassis rails
    metal.box({ x: 0, y: 0.56, z: 0 }, { x: 1.86, y: 0.20, z: 6.1 }, '#262b30');
    // Driver cab + ornate Taj crown luton header above cab!
    paint.box({ x: 0, y: 1.38, z: 1.98 }, { x: 2.14, y: 1.48, z: 1.86 }, cabCol);
    paint.box({ x: 0, y: 2.36, z: 1.88 }, { x: 2.18, y: 0.52, z: 1.42 }, '#f2b938');
    paint.box({ x: 0, y: 2.42, z: 2.60 }, { x: 1.86, y: 0.34, z: 0.06 }, '#b31329');
    glass.box({ x: 0, y: 1.62, z: 2.92 }, { x: 1.86, y: 0.64, z: 0.04 }, '#1d3746');
    metal.box({ x: 0, y: 0.94, z: 2.93 }, { x: 1.48, y: 0.46, z: 0.05 }, '#cfd6de'); // chrome grille
    // Slatted wooden/steel high-sided Bangladeshi cargo body + tarpaulin arch
    paint.box({ x: 0, y: 1.48, z: -1.08 }, { x: 2.22, y: 1.68, z: 4.02 }, bedCol);
    for (let s = 0; s < 4; s++) {
      paint.box({ x: 0, y: 0.88 + s * 0.38, z: -1.08 }, { x: 2.26, y: 0.08, z: 4.06 }, '#f2c14e');
    }
    paint.box({ x: 0, y: 2.44, z: -1.08 }, { x: 2.08, y: 0.28, z: 3.92 }, '#355c7d');
    for (const sx of [-0.82, 0.82]) {
      head.cylinder({ x: sx, y: 0.88, z: 2.93 }, 0.12, 0.04, '#fff2c2', { x: Math.PI / 2 });
      brake.box({ x: sx, y: 0.78, z: -3.11 }, { x: 0.24, y: 0.14, z: 0.04 }, '#e52521');
    }
    wheelPositions.push(
      { x: 0.98, y: wheelRadius, z: 1.98 },
      { x: -0.98, y: wheelRadius, z: 1.98 },
      { x: 0.98, y: wheelRadius, z: -1.92 },
      { x: -0.98, y: wheelRadius, z: -1.92 },
    );
  } else if (type === 'van') {
    // Dhaka Compact Pickup / Covered Parcel Delivery Van (1-ton market carrier!)
    wheelRadius = 0.33;
    halfLength = 2.15;
    halfWidth = 0.92;
    radius = 1.68;
    const cabCol = ['#f2f4f7', '#1d6fa5', '#e8a829', '#2b8a62'][v];
    const boxCol = ['#e9edf2', '#ffd15c', '#18624a', '#d9483b'][v];
    paint.box({ x: 0, y: 0.62, z: 0.98 }, { x: 1.68, y: 0.62, z: 1.72 }, cabCol);
    paint.box({ x: 0, y: 1.24, z: 0.78 }, { x: 1.60, y: 0.68, z: 1.18 }, cabCol);
    glass.box({ x: 0, y: 1.26, z: 1.38 }, { x: 1.44, y: 0.52, z: 0.04 }, '#1d3746', { x: -0.26 });
    // Corrugated rear delivery box
    paint.box({ x: 0, y: 1.18, z: -0.78 }, { x: 1.76, y: 1.56, z: 2.48 }, boxCol);
    metal.box({ x: 0, y: 1.18, z: -2.03 }, { x: 1.62, y: 1.42, z: 0.03 }, '#cfd6de');
    for (const sx of [-0.62, 0.62]) {
      head.box({ x: sx, y: 0.66, z: 1.85 }, { x: 0.24, y: 0.14, z: 0.04 }, '#fff3c4');
      brake.box({ x: sx, y: 0.62, z: -2.04 }, { x: 0.22, y: 0.12, z: 0.04 }, '#e52521');
    }
    wheelPositions.push(
      { x: 0.78, y: wheelRadius, z: 1.18 },
      { x: -0.78, y: wheelRadius, z: 1.18 },
      { x: 0.78, y: wheelRadius, z: -1.18 },
      { x: -0.78, y: wheelRadius, z: -1.18 },
    );
  } else if (type === 'motorbike') {
    // 150cc Dhaka Commuter Motorcycle + Helmeted Rider
    wheelRadius = 0.29;
    spokedWheels = true;
    halfLength = 1.02;
    halfWidth = 0.38;
    radius = 0.76;
    const tankCol = ['#d62828', '#1d3557', '#2a9d8f', '#f77f00'][v];
    metal.box({ x: 0, y: 0.48, z: 0 }, { x: 0.14, y: 0.26, z: 0.86 }, '#2a2f35'); // engine block
    metal.cylinder({ x: 0.11, y: 0.34, z: -0.32 }, 0.038, 0.92, '#cfd6de', { x: Math.PI / 2 - 0.08 }); // chrome exhaust
    paint.box({ x: 0, y: 0.74, z: 0.18 }, { x: 0.28, y: 0.22, z: 0.48 }, tankCol, { x: -0.12 }); // fuel tank
    paint.box({ x: 0, y: 0.70, z: -0.34 }, { x: 0.24, y: 0.12, z: 0.62 }, '#1e2024'); // stepped seat
    metal.cylinder({ x: 0, y: 0.62, z: 0.56 }, 0.024, 0.66, '#dce3ea', { x: -0.34 }); // front forks
    metal.cylinder({ x: 0, y: 0.95, z: 0.44 }, 0.015, 0.58, '#dce3ea', { z: Math.PI / 2 }); // handlebars
    // Rider + full-face helmet
    paint.box({ x: 0, y: 1.08, z: -0.10 }, { x: 0.36, y: 0.46, z: 0.24 }, ['#264653', '#457b9d', '#6d597a', '#354f52'][v], { x: 0.32 });
    paint.cylinder({ x: 0, y: 1.40, z: 0.02 }, 0.12, 0.22, tankCol);
    glass.box({ x: 0, y: 1.40, z: 0.12 }, { x: 0.18, y: 0.09, z: 0.04 }, '#142430');
    head.cylinder({ x: 0, y: 0.80, z: 0.64 }, 0.075, 0.04, '#fff6d1', { x: Math.PI / 2 });
    brake.box({ x: 0, y: 0.72, z: -0.72 }, { x: 0.10, y: 0.06, z: 0.03 }, '#e52521');
    wheelPositions.push(
      { x: 0, y: wheelRadius, z: 0.66 },
      { x: 0, y: wheelRadius, z: -0.64 },
    );
  } else {
    // Dhaka Private Sedan (Toyota Premio / Corolla Allion street staple!)
    wheelRadius = 0.32;
    halfLength = 2.08;
    halfWidth = 0.88;
    radius = 1.62;
    const carCol = ['#e8ecef', '#1f2933', '#7f1d1d', '#1e4e79'][v];
    // Lower body + bumpers + sculpted hood & trunk + greenhouse cabin
    paint.box({ x: 0, y: 0.54, z: 0 }, { x: 1.72, y: 0.48, z: 4.02 }, carCol);
    paint.box({ x: 0, y: 0.38, z: 1.98 }, { x: 1.74, y: 0.24, z: 0.22 }, carCol);
    paint.box({ x: 0, y: 0.38, z: -1.98 }, { x: 1.74, y: 0.24, z: 0.22 }, carCol);
    paint.box({ x: 0, y: 1.06, z: -0.14 }, { x: 1.48, y: 0.56, z: 2.02 }, carCol);
    // Sloped front & rear windshields + side glass + chrome grille + mirrors
    glass.box({ x: 0, y: 1.04, z: 0.92 }, { x: 1.38, y: 0.52, z: 0.05 }, '#1c3544', { x: -0.62 });
    glass.box({ x: 0, y: 1.04, z: -1.18 }, { x: 1.34, y: 0.48, z: 0.05 }, '#1c3544', { x: 0.58 });
    glass.box({ x: 0, y: 1.06, z: -0.14 }, { x: 1.50, y: 0.42, z: 1.58 }, '#1c3544');
    metal.box({ x: 0, y: 0.54, z: 2.02 }, { x: 0.88, y: 0.20, z: 0.04 }, '#cfd6de');
    for (const sx of [-1, 1]) {
      paint.box({ x: sx * 0.90, y: 0.92, z: 0.62 }, { x: 0.14, y: 0.09, z: 0.12 }, carCol);
      head.box({ x: sx * 0.62, y: 0.60, z: 2.02 }, { x: 0.30, y: 0.14, z: 0.04 }, '#fff6d6');
      brake.box({ x: sx * 0.62, y: 0.64, z: -2.02 }, { x: 0.34, y: 0.14, z: 0.04 }, '#e52521');
    }
    wheelPositions.push(
      { x: 0.78, y: wheelRadius, z: 1.24 },
      { x: -0.78, y: wheelRadius, z: 1.24 },
      { x: 0.78, y: wheelRadius, z: -1.24 },
      { x: -0.78, y: wheelRadius, z: -1.24 },
    );
  }

  const pMesh = paint.build();
  const mMesh = metal.build();
  const gMesh = glass.build();
  const hMesh = head.build();
  const bMesh = brake.build();
  for (const m of [pMesh, mMesh, gMesh, hMesh, bMesh]) {
    if (m) m.geometry.userData.shared = true;
  }

  const built: CachedBodyTemplate = {
    paintGeo: pMesh ? pMesh.geometry : null,
    metalGeo: mMesh ? mMesh.geometry : null,
    glassGeo: gMesh ? gMesh.geometry : null,
    headGeo: hMesh ? hMesh.geometry : null,
    brakeGeo: bMesh ? bMesh.geometry : null,
    wheelPositions,
    wheelRadius,
    spokedWheels,
    halfLength,
    halfWidth,
    radius,
  };
  templateCache.set(key, built);
  return built;
}

export function buildTrafficMesh(type: TrafficType, variant = 0): BuiltTrafficMesh {
  const tpl = getOrBuildTemplate(type, variant);
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';

  if (tpl.paintGeo) {
    const m = new THREE.Mesh(tpl.paintGeo, bodyPaintMat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.shared = true;
    root.add(m);
  }
  if (tpl.metalGeo) {
    const m = new THREE.Mesh(tpl.metalGeo, trimMetalMat);
    m.castShadow = false;
    m.userData.shared = true;
    root.add(m);
  }
  if (tpl.glassGeo) {
    const m = new THREE.Mesh(tpl.glassGeo, glassMat);
    m.userData.shared = true;
    root.add(m);
  }
  if (tpl.headGeo) {
    const m = new THREE.Mesh(tpl.headGeo, headGlowMat);
    m.userData.shared = true;
    root.add(m);
  }

  let brakeMat: THREE.MeshStandardMaterial | null = null;
  if (tpl.brakeGeo) {
    brakeMat = new THREE.MeshStandardMaterial({
      color: 0xc81e1e,
      emissive: 0xff2218,
      emissiveIntensity: 0.25,
      roughness: 0.35,
    });
    const bm = new THREE.Mesh(tpl.brakeGeo, brakeMat);
    bm.userData.shared = true;
    root.add(bm);
  }

  const wheels: THREE.Object3D[] = [];
  for (const wp of tpl.wheelPositions) {
    const w = tpl.spokedWheels
      ? createWheel(tpl.wheelRadius, '#1a1c1f', '#d4dbe2', 14)
      : buildDiscWheel(tpl.wheelRadius, tpl.wheelRadius > 0.4 ? 0.26 : 0.19);
    w.position.set(wp.x, wp.y, wp.z);
    root.add(w);
    wheels.push(w);
  }

  return {
    root,
    wheels,
    wheelRadius: tpl.wheelRadius,
    halfLength: tpl.halfLength,
    halfWidth: tpl.halfWidth,
    radius: tpl.radius,
    brakeMat,
  };
}
