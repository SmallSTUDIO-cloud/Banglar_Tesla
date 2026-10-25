/**
 * Authentic Dhaka traffic fleet models (Section 8) with GPU-instanced
 * `InstancedTrafficFleet` batching across all 8 Bangladeshi vehicle types:
 *   - cng       : Dhaka green CNG auto-rickshaw with black security grill cage
 *   - rickshaw  : NPC Bangladeshi passenger cycle rickshaw with puller & hood
 *   - easybike  : Bangladeshi battery-powered Electric Rickshaw / Auto
 *   - bus       : Mohammadpur route city bus with window bays, roof AC & door
 *   - car       : Sculpted Dhaka sedan with cabin pillars, grille & mirrors
 *   - truck     : Colourful Bangladeshi painted cargo truck with crown header
 *   - van       : Urban covered market/parcel delivery pickup van
 *   - motorbike : 150cc commuter motorcycle with helmeted rider & exhaust
 *
 * Performance architecture:
 *   Replaces 32–46 multi-mesh Object3D hierarchies (~550–740 scene nodes and
 *   32–46 duplicate per-vehicle brake materials) with 20 shared InstancedMeshes
 *   (8 primary tintable bodies + 8 multi-tone detail/cabin/figure bodies +
 *   spoked wheel instancer + motor wheel instancer + headlamp instancer +
 *   dynamic brake-lamp instancer) while preserving 100% of every vehicle's 3D
 *   geometry, per-instance colour variety, spinning wheels, and live brake glow.
 */

import * as THREE from 'three';
import { Bucket } from '../world/geo';

export type TrafficType =
  | 'cng'
  | 'rickshaw'
  | 'easybike'
  | 'bus'
  | 'car'
  | 'truck'
  | 'van'
  | 'motorbike';

export const TRAFFIC_TYPES: readonly TrafficType[] = [
  'cng',
  'rickshaw',
  'easybike',
  'bus',
  'car',
  'truck',
  'van',
  'motorbike',
];

export interface LampBox {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  color: THREE.Color;
}

export interface WheelMount {
  x: number;
  y: number;
  z: number;
  width: number;
}

export interface TrafficArchetype {
  type: TrafficType;
  primaryGeo: THREE.BufferGeometry;
  detailGeo: THREE.BufferGeometry;
  glossyPrimary: boolean;
  schemes: THREE.Color[];
  wheelMounts: WheelMount[];
  wheelRadius: number;
  spokedWheels: boolean;
  headLamps: LampBox[];
  brakeLamps: LampBox[];
  halfLength: number;
  halfWidth: number;
  radius: number;
}

export interface InstancedVehicleState {
  kind: TrafficType;
  variant: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  wheelSpin: number;
  braking: boolean;
  visible: boolean;
  nearLod: boolean;
}

const dummyMat = new THREE.MeshLambertMaterial({ vertexColors: true });

const glossyFleetMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  vertexColors: true,
  roughness: 0.42,
  metalness: 0.24,
});

const matteFleetMat = new THREE.MeshLambertMaterial({
  color: 0xffffff,
  vertexColors: true,
});

const detailFleetMat = new THREE.MeshLambertMaterial({
  color: 0xffffff,
  vertexColors: true,
});

const wheelInstMat = new THREE.MeshLambertMaterial({
  color: 0xffffff,
  vertexColors: true,
});

const lampInstMat = new THREE.MeshBasicMaterial({
  color: 0xffffff,
});

const BRAKE_ON = new THREE.Color('#ff2b24');
const BRAKE_OFF = new THREE.Color('#4f0d0d');

const archetypeCache = new Map<TrafficType, TrafficArchetype>();

function buildUnitSpokedWheelGeo(): THREE.BufferGeometry {
  // Unit outer-radius (R = 1.0) spoked cycle/rickshaw wheel; scaled by wheelRadius per instance!
  const b = new Bucket('inst.wheel.spoked', wheelInstMat);
  const tube = 0.088;
  const centerR = 1.0 - tube;
  const tireSrc = new THREE.TorusGeometry(centerR, tube, 6, 16);
  b.add(tireSrc, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, '#1a1c1f', { y: Math.PI / 2 });
  const rimR = centerR - tube * 0.58;
  const rimSrc = new THREE.TorusGeometry(rimR, 0.032, 5, 16);
  b.add(rimSrc, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, '#d8dee4', { y: Math.PI / 2 });
  tireSrc.dispose();
  rimSrc.dispose();

  b.cylinder({ x: 0, y: 0, z: 0 }, 0.09, 0.22, '#b6bec6', { z: Math.PI / 2 });
  const spokes = 8;
  const spokeLen = rimR * 0.96;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const fx = i % 2 === 0 ? 0.035 : -0.035;
    b.cylinder(
      { x: fx, y: Math.cos(a) * spokeLen * 0.5, z: Math.sin(a) * spokeLen * 0.5 },
      0.011,
      spokeLen,
      '#d4dbe2',
      { x: a },
    );
  }
  const mesh = b.build({ cast: false, receive: false })!;
  return mesh.geometry;
}

function buildUnitDiscWheelGeo(): THREE.BufferGeometry {
  // Unit outer-radius (R = 1.0, unit X-width = 1.0) motor tyre + silver hubcap!
  const b = new Bucket('inst.wheel.disc', wheelInstMat);
  b.cylinder({ x: 0, y: 0, z: 0 }, 1.0, 1.0, '#1a1c1f', { z: Math.PI / 2 });
  b.cylinder({ x: 0, y: 0, z: 0 }, 0.58, 1.06, '#cfd6de', { z: Math.PI / 2 });
  b.cylinder({ x: 0, y: 0, z: 0 }, 0.22, 1.12, '#5a626a', { z: Math.PI / 2 });
  const mesh = b.build({ cast: false, receive: false })!;
  return mesh.geometry;
}

export function getTrafficArchetype(type: TrafficType): TrafficArchetype {
  const cached = archetypeCache.get(type);
  if (cached) return cached;

  const primary = new Bucket(`${type}.primary`, dummyMat);
  const detail = new Bucket(`${type}.detail`, dummyMat);
  const wheelMounts: WheelMount[] = [];
  const headLamps: LampBox[] = [];
  const brakeLamps: LampBox[] = [];

  let wheelRadius = 0.32;
  let spokedWheels = false;
  let glossyPrimary = true;
  let halfLength = 1.9;
  let halfWidth = 0.85;
  let radius = 1.5;
  let schemeHexes: string[] = ['#ffffff'];

  const addHead = (x: number, y: number, z: number, sx: number, sy: number, sz: number, col = '#fff5cf'): void => {
    headLamps.push({ x, y, z, sx, sy, sz, color: new THREE.Color(col) });
  };
  const addBrake = (x: number, y: number, z: number, sx: number, sy: number, sz: number): void => {
    brakeLamps.push({ x, y, z, sx, sy, sz, color: BRAKE_OFF });
  };

  if (type === 'cng') {
    wheelRadius = 0.25;
    halfLength = 1.34;
    halfWidth = 0.68;
    radius = 1.15;
    schemeHexes = ['#177245', '#12653c', '#1e7f4f', '#155d39'];
    primary.box({ x: 0, y: 0.46, z: -0.18 }, { x: 1.24, y: 0.42, z: 1.72 }, '#ffffff');
    primary.box({ x: 0, y: 0.48, z: 0.86 }, { x: 0.82, y: 0.40, z: 0.56 }, '#ffffff');
    primary.box({ x: 0, y: 0.34, z: 1.02 }, { x: 0.30, y: 0.12, z: 0.34 }, '#ffffff');
    primary.box({ x: 0, y: 1.08, z: 0.78 }, { x: 1.06, y: 0.68, z: 0.05 }, '#ffffff', { x: -0.22 });

    detail.box({ x: 0, y: 0.69, z: -0.18 }, { x: 1.26, y: 0.06, z: 1.74 }, '#e6b832');
    detail.box({ x: 0, y: 1.48, z: -0.10 }, { x: 1.24, y: 0.10, z: 1.84 }, '#1d221e');
    detail.box({ x: 0, y: 1.54, z: -0.12 }, { x: 1.12, y: 0.06, z: 1.66 }, '#2a302b');
    detail.box({ x: 0, y: 1.09, z: 0.805 }, { x: 0.94, y: 0.54, z: 0.03 }, '#1e3a48', { x: -0.22 });
    detail.box({ x: 0.06, y: 1.04, z: 0.83 }, { x: 0.02, y: 0.42, z: 0.02 }, '#111111', { x: -0.22, z: 0.32 });
    for (const sx of [-0.61, 0.61]) {
      detail.cylinder({ x: sx, y: 1.08, z: -0.95 }, 0.018, 0.78, '#1e2226');
      detail.cylinder({ x: sx, y: 1.08, z: 0.55 }, 0.018, 0.78, '#1e2226');
      for (let g = 0; g < 5; g++) {
        detail.box({ x: sx, y: 0.78 + g * 0.14, z: -0.15 }, { x: 0.018, y: 0.016, z: 1.46 }, '#202428');
      }
      for (let vz = -0.75; vz <= 0.45; vz += 0.3) {
        detail.box({ x: sx, y: 1.06, z: vz }, { x: 0.018, y: 0.62, z: 0.016 }, '#202428');
      }
      detail.box({ x: sx * 1.12, y: 1.12, z: 0.76 }, { x: 0.10, y: 0.08, z: 0.03 }, '#cfd6de');
    }
    detail.box({ x: 0, y: 0.68, z: -0.58 }, { x: 1.08, y: 0.28, z: 0.45 }, '#542a1c');
    detail.cylinder({ x: 0, y: 1.02, z: 0.25 }, 0.16, 0.46, '#2b4c72');
    detail.cylinder({ x: 0, y: 0.86, z: -1.07 }, 0.22, 0.11, '#1a1c1f', { x: Math.PI / 2 });
    addHead(0, 0.64, 1.15, 0.16, 0.16, 0.04, '#fff6cf');
    for (const sx of [-0.34, 0.34]) {
      addHead(sx, 0.62, 1.14, 0.08, 0.05, 0.03, '#ffb428');
      addBrake(sx * 1.4, 0.62, -1.05, 0.14, 0.08, 0.03);
    }
    wheelMounts.push(
      { x: 0, y: wheelRadius, z: 0.96, width: 0.16 },
      { x: 0.56, y: wheelRadius, z: -0.68, width: 0.16 },
      { x: -0.56, y: wheelRadius, z: -0.68, width: 0.16 },
    );
  } else if (type === 'rickshaw') {
    wheelRadius = 0.375;
    spokedWheels = true;
    glossyPrimary = false;
    halfLength = 1.25;
    halfWidth = 0.58;
    radius = 1.02;
    schemeHexes = ['#b31329', '#126499', '#1c7c54', '#9e2870', '#c86419', '#1a7a6c'];

    // Arched hood + side curtains tinted per-instance via primaryGeo!
    primary.box({ x: 0, y: 1.02, z: -1.015 }, { x: 0.78, y: 0.46, z: 0.02 }, '#ffffff');
    for (const side of [-1, 1]) {
      primary.box({ x: side * 0.44, y: 0.92, z: -0.74 }, { x: 0.05, y: 0.36, z: 0.52 }, '#ffffff');
    }
    primary.box({ x: 0, y: 1.44, z: -0.96 }, { x: 0.96, y: 0.32, z: 0.06 }, '#ffffff', { x: 0.32 });
    primary.box({ x: 0, y: 1.66, z: -0.64 }, { x: 0.96, y: 0.10, z: 0.68 }, '#ffffff');

    // Frame, footboard, carriage, gold trim, puller & seated passenger in detailGeo
    detail.cylinder({ x: 0, y: 0.38, z: -0.66 }, 0.02, 1.08, '#9aa3ad', { z: Math.PI / 2 });
    detail.cylinder({ x: 0, y: 0.66, z: 0.38 }, 0.022, 0.92, '#145a44', { x: 0.98 });
    detail.cylinder({ x: 0, y: 0.88, z: 0.36 }, 0.018, 0.84, '#145a44', { x: Math.PI / 2 });
    detail.cylinder({ x: 0, y: 0.94, z: 0.78 }, 0.02, 0.42, '#cfd6de', { x: -0.14 });
    detail.cylinder({ x: 0, y: 1.15, z: 0.73 }, 0.014, 0.42, '#dce3ea', { z: Math.PI / 2 });
    detail.box({ x: 0, y: 0.53, z: -0.34 }, { x: 0.88, y: 0.04, z: 0.36 }, '#5e3c20');
    detail.box({ x: 0, y: 0.65, z: -0.76 }, { x: 0.90, y: 0.22, z: 0.54 }, '#145a44');
    detail.box({ x: 0, y: 0.78, z: -0.74 }, { x: 0.84, y: 0.11, z: 0.46 }, '#a61c2b');
    detail.box({ x: 0, y: 1.02, z: -0.98 }, { x: 0.88, y: 0.56, z: 0.06 }, '#f2b938');
    for (const side of [-1, 1]) {
      detail.box({ x: side * 0.52, y: 0.72, z: -0.66 }, { x: 0.12, y: 0.06, z: 0.72 }, '#145a44');
    }
    detail.box({ x: 0, y: 1.71, z: -0.64 }, { x: 0.98, y: 0.025, z: 0.12 }, '#f2b938');
    detail.box({ x: 0, y: 1.52, z: -0.26 }, { x: 0.96, y: 0.09, z: 0.03 }, '#f2b938');
    detail.box({ x: 0, y: 1.22, z: 0.04 }, { x: 0.32, y: 0.40, z: 0.20 }, '#d98236', { x: 0.25 });
    detail.cylinder({ x: 0, y: 1.49, z: 0.12 }, 0.09, 0.18, '#8b5e3c');
    detail.cylinder({ x: 0, y: 0.92, z: 0.02 }, 0.15, 0.36, '#1f4e70');
    detail.box({ x: 0.08, y: 1.12, z: -0.74 }, { x: 0.32, y: 0.38, z: 0.22 }, '#f0b429');
    detail.cylinder({ x: 0.08, y: 1.38, z: -0.74 }, 0.085, 0.17, '#8b5e3c');
    addHead(0, 0.90, 0.85, 0.08, 0.08, 0.03, '#ffe7a8');
    addBrake(-0.32, 0.60, -1.03, 0.06, 0.05, 0.025);
    addBrake(0.32, 0.60, -1.03, 0.06, 0.05, 0.025);
    wheelMounts.push(
      { x: 0, y: wheelRadius, z: 0.78, width: 0.06 },
      { x: 0.52, y: wheelRadius, z: -0.66, width: 0.06 },
      { x: -0.52, y: wheelRadius, z: -0.66, width: 0.06 },
    );
  } else if (type === 'easybike') {
    wheelRadius = 0.28;
    halfLength = 1.48;
    halfWidth = 0.72;
    radius = 1.24;
    schemeHexes = ['#0f7a8c', '#c92a3e', '#1d5fa7', '#d97b16'];
    primary.box({ x: 0, y: 0.48, z: -0.15 }, { x: 1.32, y: 0.38, z: 2.05 }, '#ffffff');
    primary.box({ x: 0, y: 0.52, z: 0.98 }, { x: 0.88, y: 0.44, z: 0.52 }, '#ffffff');
    primary.box({ x: 0, y: 1.67, z: -0.05 }, { x: 1.26, y: 0.04, z: 2.18 }, '#ffffff');
    for (const sx of [-0.63, 0.63]) {
      primary.box({ x: sx, y: 0.86, z: -0.45 }, { x: 0.03, y: 0.24, z: 1.26 }, '#ffffff');
      detail.cylinder({ x: sx, y: 1.15, z: 0.90 }, 0.018, 0.92, '#dce3ea');
      detail.cylinder({ x: sx, y: 1.15, z: -0.12 }, 0.016, 0.92, '#dce3ea');
      detail.cylinder({ x: sx, y: 1.15, z: -1.10 }, 0.018, 0.92, '#dce3ea');
    }
    detail.box({ x: 0, y: 1.62, z: -0.05 }, { x: 1.34, y: 0.08, z: 2.28 }, '#f4f1e6');
    detail.box({ x: 0, y: 1.16, z: 0.94 }, { x: 1.06, y: 0.62, z: 0.04 }, '#204254', { x: -0.16 });
    detail.box({ x: 0, y: 0.32, z: -0.35 }, { x: 0.96, y: 0.16, z: 0.95 }, '#1d242b');
    detail.box({ x: 0, y: 0.72, z: -0.82 }, { x: 1.16, y: 0.18, z: 0.42 }, '#7a2323');
    detail.box({ x: 0, y: 0.72, z: -0.12 }, { x: 1.16, y: 0.18, z: 0.38 }, '#7a2323');
    addHead(0, 0.74, 1.25, 0.16, 0.14, 0.04, '#e8fbff');
    addBrake(-0.46, 0.56, -1.18, 0.16, 0.08, 0.03);
    addBrake(0.46, 0.56, -1.18, 0.16, 0.08, 0.03);
    wheelMounts.push(
      { x: 0, y: wheelRadius, z: 1.06, width: 0.18 },
      { x: 0.60, y: wheelRadius, z: -0.78, width: 0.18 },
      { x: -0.60, y: wheelRadius, z: -0.78, width: 0.18 },
    );
  } else if (type === 'bus') {
    wheelRadius = 0.46;
    halfLength = 3.85;
    halfWidth = 1.22;
    radius = 2.75;
    schemeHexes = ['#b7282e', '#165a8a', '#1e6f50', '#8a2b52'];
    primary.box({ x: 0, y: 0.92, z: 0 }, { x: 2.38, y: 0.96, z: 7.42 }, '#ffffff');
    primary.box({ x: 0, y: 2.78, z: 0 }, { x: 2.22, y: 0.18, z: 7.12 }, '#ffffff');

    detail.box({ x: 0, y: 1.38, z: 0 }, { x: 2.41, y: 0.14, z: 7.46 }, '#f2a922');
    detail.box({ x: 0, y: 2.08, z: 0 }, { x: 2.36, y: 1.26, z: 7.36 }, '#f4efe0');
    detail.box({ x: 0, y: 2.94, z: 0.4 }, { x: 1.56, y: 0.20, z: 2.6 }, '#cfd6de');
    detail.box({ x: 0, y: 0.46, z: 3.74 }, { x: 2.40, y: 0.24, z: 0.14 }, '#282d33');
    detail.box({ x: 0, y: 0.46, z: -3.74 }, { x: 2.40, y: 0.24, z: 0.14 }, '#282d33');
    detail.box({ x: 0, y: 2.02, z: 3.69 }, { x: 2.14, y: 0.96, z: 0.05 }, '#193240');
    detail.box({ x: 0, y: 2.62, z: 3.70 }, { x: 1.68, y: 0.22, z: 0.05 }, '#102419');
    detail.box({ x: 0, y: 2.06, z: -3.69 }, { x: 1.98, y: 0.78, z: 0.05 }, '#193240');
    for (let wz = -2.8; wz <= 2.6; wz += 1.05) {
      detail.box({ x: -1.19, y: 2.06, z: wz }, { x: 0.04, y: 0.74, z: 0.84 }, '#1a3544');
      if (wz < 1.6) {
        detail.box({ x: 1.19, y: 2.06, z: wz }, { x: 0.04, y: 0.74, z: 0.84 }, '#1a3544');
      }
    }
    detail.box({ x: 1.16, y: 1.48, z: 2.35 }, { x: 0.08, y: 1.75, z: 0.86 }, '#111920');
    detail.box({ x: 0, y: 0.92, z: 3.73 }, { x: 1.36, y: 0.42, z: 0.04 }, '#22282e');
    addHead(0, 2.62, 3.73, 1.48, 0.12, 0.03, '#ffd65a');
    for (const sx of [-1, 1]) {
      addHead(sx * 0.88, 0.88, 3.73, 0.34, 0.20, 0.04, '#fff3c4');
      addBrake(sx * 0.92, 1.02, -3.73, 0.28, 0.34, 0.04);
      detail.box({ x: sx * 1.28, y: 2.18, z: 3.78 }, { x: 0.14, y: 0.30, z: 0.06 }, '#1e2226');
    }
    wheelMounts.push(
      { x: 1.06, y: wheelRadius, z: 2.35, width: 0.28 },
      { x: -1.06, y: wheelRadius, z: 2.35, width: 0.28 },
      { x: 1.06, y: wheelRadius, z: -2.25, width: 0.28 },
      { x: -1.06, y: wheelRadius, z: -2.25, width: 0.28 },
    );
  } else if (type === 'truck') {
    wheelRadius = 0.45;
    glossyPrimary = false;
    halfLength = 3.25;
    halfWidth = 1.15;
    radius = 2.4;
    schemeHexes = ['#d97724', '#1d6fa5', '#2a8c55', '#b83232'];
    primary.box({ x: 0, y: 1.38, z: 1.98 }, { x: 2.14, y: 1.48, z: 1.86 }, '#ffffff');

    detail.box({ x: 0, y: 0.56, z: 0 }, { x: 1.86, y: 0.20, z: 6.1 }, '#262b30');
    detail.box({ x: 0, y: 2.36, z: 1.88 }, { x: 2.18, y: 0.52, z: 1.42 }, '#f2b938');
    detail.box({ x: 0, y: 2.42, z: 2.60 }, { x: 1.86, y: 0.34, z: 0.06 }, '#b31329');
    detail.box({ x: 0, y: 1.62, z: 2.92 }, { x: 1.86, y: 0.64, z: 0.04 }, '#1d3746');
    detail.box({ x: 0, y: 0.94, z: 2.93 }, { x: 1.48, y: 0.46, z: 0.05 }, '#cfd6de');
    detail.box({ x: 0, y: 1.48, z: -1.08 }, { x: 2.22, y: 1.68, z: 4.02 }, '#1f5f4b');
    for (let s = 0; s < 4; s++) {
      detail.box({ x: 0, y: 0.88 + s * 0.38, z: -1.08 }, { x: 2.26, y: 0.08, z: 4.06 }, '#f2c14e');
    }
    detail.box({ x: 0, y: 2.44, z: -1.08 }, { x: 2.08, y: 0.28, z: 3.92 }, '#355c7d');
    for (const sx of [-0.82, 0.82]) {
      addHead(sx, 0.88, 2.93, 0.22, 0.22, 0.04, '#fff2c2');
      addBrake(sx, 0.78, -3.11, 0.24, 0.14, 0.04);
    }
    wheelMounts.push(
      { x: 0.98, y: wheelRadius, z: 1.98, width: 0.28 },
      { x: -0.98, y: wheelRadius, z: 1.98, width: 0.28 },
      { x: 0.98, y: wheelRadius, z: -1.92, width: 0.28 },
      { x: -0.98, y: wheelRadius, z: -1.92, width: 0.28 },
    );
  } else if (type === 'van') {
    wheelRadius = 0.33;
    glossyPrimary = false;
    halfLength = 2.15;
    halfWidth = 0.92;
    radius = 1.68;
    schemeHexes = ['#f2f4f7', '#1d6fa5', '#e8a829', '#2b8a62'];
    primary.box({ x: 0, y: 0.62, z: 0.98 }, { x: 1.68, y: 0.62, z: 1.72 }, '#ffffff');
    primary.box({ x: 0, y: 1.24, z: 0.78 }, { x: 1.60, y: 0.68, z: 1.18 }, '#ffffff');

    detail.box({ x: 0, y: 1.26, z: 1.38 }, { x: 1.44, y: 0.52, z: 0.04 }, '#1d3746', { x: -0.26 });
    detail.box({ x: 0, y: 1.18, z: -0.78 }, { x: 1.76, y: 1.56, z: 2.48 }, '#e9edf2');
    detail.box({ x: 0, y: 1.18, z: -2.03 }, { x: 1.62, y: 1.42, z: 0.03 }, '#cfd6de');
    for (const sx of [-0.62, 0.62]) {
      addHead(sx, 0.66, 1.85, 0.24, 0.14, 0.04, '#fff3c4');
      addBrake(sx, 0.62, -2.04, 0.22, 0.12, 0.04);
    }
    wheelMounts.push(
      { x: 0.78, y: wheelRadius, z: 1.18, width: 0.22 },
      { x: -0.78, y: wheelRadius, z: 1.18, width: 0.22 },
      { x: 0.78, y: wheelRadius, z: -1.18, width: 0.22 },
      { x: -0.78, y: wheelRadius, z: -1.18, width: 0.22 },
    );
  } else if (type === 'motorbike') {
    wheelRadius = 0.29;
    spokedWheels = true;
    halfLength = 1.02;
    halfWidth = 0.38;
    radius = 0.76;
    schemeHexes = ['#d62828', '#1d3557', '#2a9d8f', '#f77f00'];
    primary.box({ x: 0, y: 0.74, z: 0.18 }, { x: 0.28, y: 0.22, z: 0.48 }, '#ffffff', { x: -0.12 });
    primary.cylinder({ x: 0, y: 1.40, z: 0.02 }, 0.12, 0.22, '#ffffff');

    detail.box({ x: 0, y: 0.48, z: 0 }, { x: 0.14, y: 0.26, z: 0.86 }, '#2a2f35');
    detail.cylinder({ x: 0.11, y: 0.34, z: -0.32 }, 0.038, 0.92, '#cfd6de', { x: Math.PI / 2 - 0.08 });
    detail.box({ x: 0, y: 0.70, z: -0.34 }, { x: 0.24, y: 0.12, z: 0.62 }, '#1e2024');
    detail.cylinder({ x: 0, y: 0.62, z: 0.56 }, 0.024, 0.66, '#dce3ea', { x: -0.34 });
    detail.cylinder({ x: 0, y: 0.95, z: 0.44 }, 0.015, 0.58, '#dce3ea', { z: Math.PI / 2 });
    detail.box({ x: 0, y: 1.08, z: -0.10 }, { x: 0.36, y: 0.46, z: 0.24 }, '#264653', { x: 0.32 });
    detail.box({ x: 0, y: 1.40, z: 0.12 }, { x: 0.18, y: 0.09, z: 0.04 }, '#142430');
    addHead(0, 0.80, 0.64, 0.13, 0.13, 0.04, '#fff6d1');
    addBrake(0, 0.72, -0.72, 0.10, 0.06, 0.03);
    wheelMounts.push(
      { x: 0, y: wheelRadius, z: 0.66, width: 0.09 },
      { x: 0, y: wheelRadius, z: -0.64, width: 0.09 },
    );
  } else {
    // Dhaka Private Sedan (Toyota Premio / Corolla Allion street staple!)
    wheelRadius = 0.32;
    halfLength = 2.08;
    halfWidth = 0.88;
    radius = 1.62;
    schemeHexes = ['#e8ecef', '#25323f', '#8a2020', '#1e4e79', '#d6cfc2'];
    primary.box({ x: 0, y: 0.54, z: 0 }, { x: 1.72, y: 0.48, z: 4.02 }, '#ffffff');
    primary.box({ x: 0, y: 0.38, z: 1.98 }, { x: 1.74, y: 0.24, z: 0.22 }, '#ffffff');
    primary.box({ x: 0, y: 0.38, z: -1.98 }, { x: 1.74, y: 0.24, z: 0.22 }, '#ffffff');
    primary.box({ x: 0, y: 1.06, z: -0.14 }, { x: 1.48, y: 0.56, z: 2.02 }, '#ffffff');
    for (const sx of [-1, 1]) {
      primary.box({ x: sx * 0.90, y: 0.92, z: 0.62 }, { x: 0.14, y: 0.09, z: 0.12 }, '#ffffff');
      addHead(sx * 0.62, 0.60, 2.02, 0.30, 0.14, 0.04, '#fff6d6');
      addBrake(sx * 0.62, 0.64, -2.02, 0.34, 0.14, 0.04);
    }
    detail.box({ x: 0, y: 1.04, z: 0.92 }, { x: 1.38, y: 0.52, z: 0.05 }, '#1c3544', { x: -0.62 });
    detail.box({ x: 0, y: 1.04, z: -1.18 }, { x: 1.34, y: 0.48, z: 0.05 }, '#1c3544', { x: 0.58 });
    detail.box({ x: 0, y: 1.06, z: -0.14 }, { x: 1.50, y: 0.42, z: 1.58 }, '#1c3544');
    detail.box({ x: 0, y: 0.54, z: 2.02 }, { x: 0.88, y: 0.20, z: 0.04 }, '#cfd6de');
    wheelMounts.push(
      { x: 0.78, y: wheelRadius, z: 1.24, width: 0.21 },
      { x: -0.78, y: wheelRadius, z: 1.24, width: 0.21 },
      { x: 0.78, y: wheelRadius, z: -1.24, width: 0.21 },
      { x: -0.78, y: wheelRadius, z: -1.24, width: 0.21 },
    );
  }

  const pMesh = primary.build({ cast: true, receive: true })!;
  const dMesh = detail.build({ cast: true, receive: true })!;
  const arch: TrafficArchetype = {
    type,
    primaryGeo: pMesh.geometry,
    detailGeo: dMesh.geometry,
    glossyPrimary,
    schemes: schemeHexes.map((h) => new THREE.Color(h)),
    wheelMounts,
    wheelRadius,
    spokedWheels,
    headLamps,
    brakeLamps,
    halfLength,
    halfWidth,
    radius,
  };
  archetypeCache.set(type, arch);
  return arch;
}

interface TypeLayerPair {
  arch: TrafficArchetype;
  primary: THREE.InstancedMesh;
  detail: THREE.InstancedMesh;
}

/**
 * Batched GPU-instanced renderer for the entire Dhaka NPC vehicle fleet.
 * Packs only visible vehicles into contiguous instance slots each frame and
 * eliminates 500+ scene-graph child nodes and duplicate materials.
 */
export class InstancedTrafficFleet {
  private layers = new Map<TrafficType, TypeLayerPair>();
  private spokedWheels: THREE.InstancedMesh;
  private discWheels: THREE.InstancedMesh;
  private headLampMesh: THREE.InstancedMesh;
  private brakeLampMesh: THREE.InstancedMesh;
  private unitBox = new THREE.BoxGeometry(1, 1, 1);

  private tmpMat = new THREE.Matrix4();
  private tmpQuat = new THREE.Quaternion();
  private tmpWheelQuat = new THREE.Quaternion();
  private tmpSpinQuat = new THREE.Quaternion();
  private tmpPos = new THREE.Vector3();
  private tmpScale = new THREE.Vector3(1, 1, 1);
  private yAxis = new THREE.Vector3(0, 1, 0);
  private xAxis = new THREE.Vector3(1, 0, 0);
  private whiteColor = new THREE.Color(0xffffff);

  constructor(parent: THREE.Group, maxVehicles = 56) {
    for (const type of TRAFFIC_TYPES) {
      const arch = getTrafficArchetype(type);
      const pMat = arch.glossyPrimary ? glossyFleetMat : matteFleetMat;
      const primary = new THREE.InstancedMesh(arch.primaryGeo, pMat, maxVehicles);
      primary.name = `traffic.${type}.primary`;
      primary.castShadow = true;
      primary.receiveShadow = true;
      primary.frustumCulled = false;
      primary.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Pre-initialise instanceColor buffer once so setColorAt never allocates mid-frame
      for (let i = 0; i < maxVehicles; i++) primary.setColorAt(i, this.whiteColor);
      primary.count = 0;

      const detail = new THREE.InstancedMesh(arch.detailGeo, detailFleetMat, maxVehicles);
      detail.name = `traffic.${type}.detail`;
      detail.castShadow = true;
      detail.receiveShadow = true;
      detail.frustumCulled = false;
      detail.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      detail.count = 0;

      parent.add(primary, detail);
      this.layers.set(type, { arch, primary, detail });
    }

    const maxSpoked = maxVehicles * 3;
    this.spokedWheels = new THREE.InstancedMesh(buildUnitSpokedWheelGeo(), wheelInstMat, maxSpoked);
    this.spokedWheels.name = 'traffic.wheels.spoked';
    this.spokedWheels.frustumCulled = false;
    this.spokedWheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.spokedWheels.count = 0;

    const maxDisc = maxVehicles * 4;
    this.discWheels = new THREE.InstancedMesh(buildUnitDiscWheelGeo(), wheelInstMat, maxDisc);
    this.discWheels.name = 'traffic.wheels.disc';
    this.discWheels.frustumCulled = false;
    this.discWheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.discWheels.count = 0;

    const maxLamps = maxVehicles * 3;
    this.headLampMesh = new THREE.InstancedMesh(this.unitBox, lampInstMat, maxLamps);
    this.headLampMesh.name = 'traffic.lamps.head';
    this.headLampMesh.frustumCulled = false;
    this.headLampMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < maxLamps; i++) this.headLampMesh.setColorAt(i, this.whiteColor);
    this.headLampMesh.count = 0;

    this.brakeLampMesh = new THREE.InstancedMesh(this.unitBox, lampInstMat, maxLamps);
    this.brakeLampMesh.name = 'traffic.lamps.brake';
    this.brakeLampMesh.frustumCulled = false;
    this.brakeLampMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < maxLamps; i++) this.brakeLampMesh.setColorAt(i, BRAKE_OFF);
    this.brakeLampMesh.count = 0;

    parent.add(this.spokedWheels, this.discWheels, this.headLampMesh, this.brakeLampMesh);
  }

  /**
   * Pack all visible traffic agents into contiguous GPU instance buffers.
   * Zero heap allocations per frame.
   */
  sync(agents: readonly InstancedVehicleState[]): void {
    for (const pair of this.layers.values()) {
      pair.primary.count = 0;
      pair.detail.count = 0;
    }
    let spokedCount = 0;
    let discCount = 0;
    let headCount = 0;
    let brakeCount = 0;

    const unitScale = this.tmpScale.set(1, 1, 1);

    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      if (!a.visible) continue;
      const pair = this.layers.get(a.kind)!;
      const arch = pair.arch;
      const slot = pair.primary.count;

      const sinY = Math.sin(a.yaw);
      const cosY = Math.cos(a.yaw);
      this.tmpQuat.setFromAxisAngle(this.yAxis, a.yaw);
      this.tmpPos.set(a.x, a.y, a.z);
      this.tmpMat.compose(this.tmpPos, this.tmpQuat, unitScale);

      pair.primary.setMatrixAt(slot, this.tmpMat);
      pair.primary.setColorAt(slot, arch.schemes[a.variant % arch.schemes.length]);
      pair.detail.setMatrixAt(slot, this.tmpMat);
      pair.primary.count = slot + 1;
      pair.detail.count = slot + 1;

      // Full spinning wheels & live lamps within near/mid gameplay range (~82m);
      // beyond 82m wheels/lamps are sub-pixel so skipping them saves ~180 matrix writes!
      if (!a.nearLod) continue;

      this.tmpSpinQuat.setFromAxisAngle(this.xAxis, a.wheelSpin);
      this.tmpWheelQuat.multiplyQuaternions(this.tmpQuat, this.tmpSpinQuat);
      const r = arch.wheelRadius;
      const mounts = arch.wheelMounts;

      if (arch.spokedWheels) {
        this.tmpScale.set(1, r, r);
        for (let w = 0; w < mounts.length; w++) {
          const m = mounts[w];
          this.tmpPos.set(a.x + m.x * cosY + m.z * sinY, a.y + m.y, a.z - m.x * sinY + m.z * cosY);
          this.tmpMat.compose(this.tmpPos, this.tmpWheelQuat, this.tmpScale);
          this.spokedWheels.setMatrixAt(spokedCount++, this.tmpMat);
        }
      } else {
        for (let w = 0; w < mounts.length; w++) {
          const m = mounts[w];
          this.tmpScale.set(m.width, r, r);
          this.tmpPos.set(a.x + m.x * cosY + m.z * sinY, a.y + m.y, a.z - m.x * sinY + m.z * cosY);
          this.tmpMat.compose(this.tmpPos, this.tmpWheelQuat, this.tmpScale);
          this.discWheels.setMatrixAt(discCount++, this.tmpMat);
        }
      }

      const heads = arch.headLamps;
      for (let h = 0; h < heads.length; h++) {
        const l = heads[h];
        this.tmpScale.set(l.sx, l.sy, l.sz);
        this.tmpPos.set(a.x + l.x * cosY + l.z * sinY, a.y + l.y, a.z - l.x * sinY + l.z * cosY);
        this.tmpMat.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
        this.headLampMesh.setMatrixAt(headCount, this.tmpMat);
        this.headLampMesh.setColorAt(headCount, l.color);
        headCount++;
      }

      const brakes = arch.brakeLamps;
      const bCol = a.braking ? BRAKE_ON : BRAKE_OFF;
      for (let b = 0; b < brakes.length; b++) {
        const l = brakes[b];
        this.tmpScale.set(l.sx, l.sy, l.sz);
        this.tmpPos.set(a.x + l.x * cosY + l.z * sinY, a.y + l.y, a.z - l.x * sinY + l.z * cosY);
        this.tmpMat.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
        this.brakeLampMesh.setMatrixAt(brakeCount, this.tmpMat);
        this.brakeLampMesh.setColorAt(brakeCount, bCol);
        brakeCount++;
      }
      unitScale.set(1, 1, 1);
    }

    for (const pair of this.layers.values()) {
      const c = pair.primary.count;
      pair.primary.visible = c > 0;
      pair.detail.visible = c > 0;
      if (c > 0) {
        pair.primary.instanceMatrix.needsUpdate = true;
        if (pair.primary.instanceColor) pair.primary.instanceColor.needsUpdate = true;
        pair.detail.instanceMatrix.needsUpdate = true;
      }
    }

    this.spokedWheels.count = spokedCount;
    this.spokedWheels.visible = spokedCount > 0;
    if (spokedCount > 0) this.spokedWheels.instanceMatrix.needsUpdate = true;

    this.discWheels.count = discCount;
    this.discWheels.visible = discCount > 0;
    if (discCount > 0) this.discWheels.instanceMatrix.needsUpdate = true;

    this.headLampMesh.count = headCount;
    this.headLampMesh.visible = headCount > 0;
    if (headCount > 0) {
      this.headLampMesh.instanceMatrix.needsUpdate = true;
      if (this.headLampMesh.instanceColor) this.headLampMesh.instanceColor.needsUpdate = true;
    }

    this.brakeLampMesh.count = brakeCount;
    this.brakeLampMesh.visible = brakeCount > 0;
    if (brakeCount > 0) {
      this.brakeLampMesh.instanceMatrix.needsUpdate = true;
      if (this.brakeLampMesh.instanceColor) this.brakeLampMesh.instanceColor.needsUpdate = true;
    }
  }

  /** Ensure every instanced mesh has >=1 valid matrix visible during boot pipeline prewarm. */
  withPrewarmState(run: () => void): void {
    const id = this.tmpMat.identity();
    const savedCounts: number[] = [];
    const meshes: THREE.InstancedMesh[] = [
      this.spokedWheels,
      this.discWheels,
      this.headLampMesh,
      this.brakeLampMesh,
    ];
    for (const pair of this.layers.values()) {
      meshes.push(pair.primary, pair.detail);
    }
    for (const m of meshes) {
      savedCounts.push(m.count);
      if (m.count === 0) {
        m.setMatrixAt(0, id);
        m.instanceMatrix.needsUpdate = true;
        m.count = 1;
      }
      m.visible = true;
    }
    try {
      run();
    } finally {
      for (let i = 0; i < meshes.length; i++) {
        meshes[i].count = savedCounts[i];
        meshes[i].visible = savedCounts[i] > 0;
      }
    }
  }
}
