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
import { buildArmChain, buildDriverArms, type ArmChainPose } from '../characters/limbRig';

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
  /** Visual steering angle, derived from the traffic agent's current turn. */
  steerAngle?: number;
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

// ---------------------------------------------------------------------------
// Shared driver limb chains (Master Upgrade vNext §2 — one authoritative pose
// per character; eliminates the "extra/duplicated hands" misaligned-arm bug).
// Pure data: unit tests assert wrist-to-hand continuity and grip seating.
// ---------------------------------------------------------------------------

/** NPC traffic rickshaw puller gripping the handlebar cross-bar at ±0.205. */
export const NPC_RICKSHAW_PULLER_ARMS = buildDriverArms({
  shoulderX: 0.185,
  shoulderY: 1.40,
  shoulderZ: 0.10,
  gripLeft: { x: 0.205, y: 1.155, z: 0.725 },
  gripRight: { x: -0.205, y: 1.155, z: 0.725 },
  upperRadius: 0.038,
  foreRadius: 0.034,
  handSize: { x: 0.062, y: 0.058, z: 0.088 },
  elbowBend: 0.085,
  elbowLift: 0.05,
  handRotLeft: { x: 0.12, y: 0, z: -0.1 },
  handRotRight: { x: 0.12, y: 0, z: 0.1 },
});

/** NPC traffic rickshaw passenger — both hands resting naturally on the lap. */
export const NPC_RICKSHAW_PASSENGER_ARMS = buildDriverArms({
  shoulderX: 0.16,
  shoulderCenterX: 0.06,
  shoulderY: 1.26,
  shoulderZ: -0.72,
  gripLeft: { x: 0.175, y: 0.965, z: -0.575 },
  gripRight: { x: -0.055, y: 0.965, z: -0.575 },
  upperRadius: 0.036,
  foreRadius: 0.032,
  handSize: { x: 0.085, y: 0.05, z: 0.11 },
  elbowBend: 0.055,
  elbowLift: 0.02,
});

/** Dhaka CNG driver gripping the handlebar at (±0.165, 1.155, 0.70). */
export const NPC_CNG_DRIVER_ARMS = buildDriverArms({
  shoulderX: 0.155,
  shoulderY: 1.23,
  shoulderZ: 0.36,
  gripLeft: { x: 0.165, y: 1.155, z: 0.70 },
  gripRight: { x: -0.165, y: 1.155, z: 0.70 },
  upperRadius: 0.036,
  foreRadius: 0.032,
  handSize: { x: 0.058, y: 0.052, z: 0.078 },
  elbowBend: 0.07,
  elbowLift: 0.04,
  handRotLeft: { x: 0.18, y: 0, z: -0.12 },
  handRotRight: { x: 0.18, y: 0, z: 0.12 },
});

/** EasyBike driver gripping the cabin handlebar at (±0.175, 1.09, 0.84). */
export const NPC_EASYBIKE_DRIVER_ARMS = buildDriverArms({
  shoulderX: 0.165,
  shoulderY: 1.22,
  shoulderZ: 0.52,
  gripLeft: { x: 0.175, y: 1.09, z: 0.84 },
  gripRight: { x: -0.175, y: 1.09, z: 0.84 },
  upperRadius: 0.036,
  foreRadius: 0.032,
  handSize: { x: 0.058, y: 0.052, z: 0.078 },
  elbowBend: 0.06,
  elbowLift: 0.03,
  handRotLeft: { x: 0.18, y: 0, z: -0.12 },
  handRotRight: { x: 0.18, y: 0, z: 0.12 },
});

export type SteeringDriverType = 'rickshaw' | 'cng' | 'easybike';
export const NPC_STEERING_ANGLES = [-0.5, -0.25, 0, 0.25, 0.5] as const;

/** Precomputed visual poses: both hands remain on the rotating control. */
export function npcSteeringPose(type: SteeringDriverType, angle: number): [ArmChainPose, ArmChainPose] {
  const base = type === 'rickshaw' ? NPC_RICKSHAW_PULLER_ARMS : type === 'cng' ? NPC_CNG_DRIVER_ARMS : NPC_EASYBIKE_DRIVER_ARMS;
  const centre = type === 'rickshaw' ? { y: 1.155, z: 0.725 } : type === 'cng' ? { y: 1.155, z: 0.70 } : { y: 1.09, z: 0.84 };
  const c = Math.cos(angle), s = Math.sin(angle);
  const result = base.map((chain) => {
    const x = chain.grip.x;
    // All three steer via handlebars rotating around the vertical steering stem.
    const grip = { x: x * c, y: centre.y, z: centre.z - x * s };
    const midX = chain.shoulder.x + (chain.grip.x - chain.shoulder.x) * 0.52;
    const midY = chain.shoulder.y + (chain.grip.y - chain.shoulder.y) * 0.52;
    return buildArmChain({
      side: chain.side, shoulder: chain.shoulder, grip,
      upperRadius: chain.upper.radius, foreRadius: chain.fore.radius,
      handSize: chain.hand.size, handRot: chain.hand.rot,
      elbowBend: Math.abs(chain.elbow.x - midX), elbowLift: chain.elbow.y - midY,
    });
  });
  return [result[0], result[1]];
}

/**
 * Emit one contiguous arm chain into a fleet detail bucket: upper arm, elbow
 * ball, forearm (ending INSIDE the hand) and the hand box seated on the grip.
 */
function emitArmChain(bucket: Bucket, chain: ArmChainPose, skinHex: string, sleeveHex: string): void {
  const u = chain.upper;
  bucket.cylinder(u.mid, u.radius, u.length, sleeveHex, u.rot);
  const f = chain.fore;
  bucket.cylinder(f.mid, f.radius, f.length, skinHex, f.rot);
  // Hand box seated on the grip — forearm's rounded end stays buried inside it.
  bucket.box(chain.hand.center, chain.hand.size, skinHex, chain.hand.rot);
}

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
    halfLength = 1.14;
    halfWidth = 0.62;
    radius = 1.12;
    schemeHexes = ['#177245', '#12653c', '#1e7f4f', '#155d39'];
    // Sculpted rear tub, sloped front apron, rounded front mudguard & windshield frame
    primary.box({ x: 0, y: 0.46, z: -0.18 }, { x: 1.24, y: 0.42, z: 1.72 }, '#ffffff');
    primary.box({ x: 0, y: 0.50, z: 0.84 }, { x: 0.86, y: 0.44, z: 0.54 }, '#ffffff', { x: 0.08 });
    primary.cylinder({ x: 0, y: 0.48, z: 0.96 }, 0.34, 0.38, '#ffffff', { z: Math.PI / 2 });
    primary.box({ x: 0, y: 0.36, z: 1.02 }, { x: 0.32, y: 0.14, z: 0.38 }, '#ffffff');
    // The old solid front slab hid the driver entirely. Keep only the
    // painted frame; a separate translucent pane fills its opening.
    for (const sx of [-0.50, 0.50]) {
      primary.box({ x: sx, y: 1.08, z: 0.78 }, { x: 0.06, y: 0.68, z: 0.05 }, '#ffffff', { x: -0.22 });
    }
    primary.box({ x: 0, y: 1.42, z: 0.70 }, { x: 1.06, y: 0.06, z: 0.06 }, '#ffffff');
    primary.box({ x: 0, y: 0.74, z: 0.85 }, { x: 1.06, y: 0.08, z: 0.06 }, '#ffffff');

    // Yellow-black Dhaka taxi-stripe, arched black tarpaulin roof & front chrome bumper
    detail.box({ x: 0, y: 0.69, z: -0.18 }, { x: 1.26, y: 0.06, z: 1.74 }, '#e6b832');
    detail.box({ x: 0, y: 0.34, z: 1.14 }, { x: 0.92, y: 0.06, z: 0.08 }, '#cfd6de');
    detail.box({ x: 0, y: 1.46, z: -0.10 }, { x: 1.24, y: 0.09, z: 1.84 }, '#1d221e');
    detail.box({ x: 0, y: 1.53, z: -0.12 }, { x: 1.08, y: 0.08, z: 1.68 }, '#262c27');
    detail.box({ x: 0, y: 1.58, z: -0.14 }, { x: 0.84, y: 0.05, z: 1.48 }, '#2f3630');
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
    // Upholstered bench + visible CNG driver with head, hair & handlebar grip.
    detail.box({ x: 0, y: 0.68, z: -0.58 }, { x: 1.08, y: 0.28, z: 0.45 }, '#542a1c');
    detail.box({ x: 0, y: 0.73, z: 0.24 }, { x: 0.40, y: 0.09, z: 0.32 }, '#302e2a');
    for (const side of [-1, 1]) {
      detail.box({ x: side * 0.09, y: 0.64, z: 0.31 }, { x: 0.11, y: 0.20, z: 0.24 }, '#252f3a');
    }
    detail.box({ x: 0, y: 0.98, z: 0.24 }, { x: 0.34, y: 0.42, z: 0.22 }, '#2b4c72');
    detail.cylinder({ x: 0, y: 1.26, z: 0.25 }, 0.095, 0.19, '#8d5b3c');
    detail.cylinder({ x: 0, y: 1.34, z: 0.24 }, 0.098, 0.07, '#18181b');
    // The handlebar and hands are emitted together by the pose instancer.
    detail.cylinder({ x: 0, y: 1.08, z: 0.60 }, 0.018, 0.24, '#3a4046', { x: 1.12 });
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
    halfLength = 1.10;
    halfWidth = 0.53;
    radius = 0.98;
    schemeHexes = ['#b31329', '#126499', '#1c7c54', '#9e2870', '#c86419', '#1a7a6c'];

    // Arched hood + side curtains tinted per-instance via primaryGeo!
    primary.box({ x: 0, y: 1.02, z: -1.015 }, { x: 0.78, y: 0.46, z: 0.02 }, '#ffffff');
    for (const side of [-1, 1]) {
      primary.box({ x: side * 0.44, y: 0.92, z: -0.74 }, { x: 0.05, y: 0.36, z: 0.52 }, '#ffffff');
    }
    primary.box({ x: 0, y: 1.44, z: -0.96 }, { x: 0.96, y: 0.32, z: 0.06 }, '#ffffff', { x: 0.32 });
    primary.box({ x: 0, y: 1.66, z: -0.64 }, { x: 0.96, y: 0.10, z: 0.68 }, '#ffffff');

    // Frame, footboard, carriage, gold trim, full puller (head/hair/arms gripping handlebar/legs) & passenger!
    detail.cylinder({ x: 0, y: 0.38, z: -0.66 }, 0.02, 1.08, '#9aa3ad', { z: Math.PI / 2 });
    detail.cylinder({ x: 0, y: 0.66, z: 0.38 }, 0.022, 0.92, '#145a44', { x: 0.98 });
    detail.cylinder({ x: 0, y: 0.88, z: 0.36 }, 0.018, 0.84, '#145a44', { x: Math.PI / 2 });
    detail.cylinder({ x: 0, y: 0.94, z: 0.78 }, 0.02, 0.42, '#cfd6de', { x: -0.14 });
    detail.box({ x: 0, y: 0.53, z: -0.34 }, { x: 0.88, y: 0.04, z: 0.36 }, '#5e3c20');
    detail.box({ x: 0, y: 0.65, z: -0.76 }, { x: 0.90, y: 0.22, z: 0.54 }, '#145a44');
    detail.box({ x: 0, y: 0.78, z: -0.74 }, { x: 0.84, y: 0.11, z: 0.46 }, '#a61c2b');
    detail.box({ x: 0, y: 1.02, z: -0.98 }, { x: 0.88, y: 0.56, z: 0.06 }, '#f2b938');
    // The puller sits on a supported cycle saddle; feet rest on actual pedals.
    detail.cylinder({ x: 0, y: 0.84, z: 0.02 }, 0.018, 0.30, '#84918b');
    detail.box({ x: 0, y: 0.99, z: 0.02 }, { x: 0.25, y: 0.055, z: 0.28 }, '#302921');
    for (const side of [-1, 1]) {
      detail.box({ x: side * 0.52, y: 0.72, z: -0.66 }, { x: 0.12, y: 0.06, z: 0.72 }, '#145a44');
      // Pedalling leg (thigh + calf) — feet reach the crank below.
      detail.cylinder({ x: side * 0.10, y: 0.82, z: 0.05 }, 0.055, 0.44, '#1f4e70', { x: 0.16 });
      detail.box({ x: side * 0.11, y: 0.58, z: 0.12 }, { x: 0.075, y: 0.05, z: 0.16 }, '#2c2622');
      detail.box({ x: side * 0.11, y: 0.54, z: 0.12 }, { x: 0.13, y: 0.03, z: 0.10 }, '#464e4b');
    }
    detail.box({ x: 0, y: 1.71, z: -0.64 }, { x: 0.98, y: 0.025, z: 0.12 }, '#f2b938');
    detail.box({ x: 0, y: 1.52, z: -0.26 }, { x: 0.96, y: 0.09, z: 0.03 }, '#f2b938');
    detail.box({ x: 0, y: 1.22, z: 0.06 }, { x: 0.33, y: 0.40, z: 0.20 }, '#d98236', { x: 0.25 });
    detail.cylinder({ x: 0, y: 1.49, z: 0.14 }, 0.095, 0.19, '#8b5e3c');
    detail.cylinder({ x: 0, y: 1.57, z: 0.13 }, 0.098, 0.07, '#18181b');
    detail.cylinder({ x: 0, y: 1.54, z: 0.14 }, 0.102, 0.03, '#c92a2a'); // red gamcha headband!
    // Seated passenger with hair + resting arms/hands on the lap
    detail.box({ x: 0.06, y: 1.10, z: -0.74 }, { x: 0.32, y: 0.38, z: 0.22 }, '#f0b429');
    for (const side of [-1, 1]) {
      // A seated thigh and shin connect the cushion to the footboard.
      detail.box({ x: 0.06 + side * 0.09, y: 0.85, z: -0.56 }, { x: 0.12, y: 0.12, z: 0.36 }, '#33384a');
      detail.box({ x: 0.06 + side * 0.09, y: 0.71, z: -0.38 }, { x: 0.12, y: 0.28, z: 0.12 }, '#33384a');
    }
    detail.cylinder({ x: 0.06, y: 1.38, z: -0.74 }, 0.09, 0.18, '#8b5e3c');
    detail.cylinder({ x: 0.06, y: 1.46, z: -0.75 }, 0.093, 0.07, '#18181b');
    for (const passArm of NPC_RICKSHAW_PASSENGER_ARMS) {
      emitArmChain(detail, passArm, '#8b5e3c', '#f0b429');
    }
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
    halfLength = 1.22;
    halfWidth = 0.66;
    radius = 1.18;
    schemeHexes = ['#0f7a8c', '#c92a3e', '#1d5fa7', '#d97b16'];
    primary.box({ x: 0, y: 0.48, z: -0.15 }, { x: 1.32, y: 0.38, z: 2.05 }, '#ffffff');
    primary.box({ x: 0, y: 0.54, z: 0.98 }, { x: 0.90, y: 0.46, z: 0.52 }, '#ffffff', { x: 0.10 });
    primary.box({ x: 0, y: 1.67, z: -0.05 }, { x: 1.26, y: 0.04, z: 2.18 }, '#ffffff');
    for (const sx of [-0.63, 0.63]) {
      primary.box({ x: sx, y: 0.86, z: -0.45 }, { x: 0.03, y: 0.24, z: 1.26 }, '#ffffff');
      detail.cylinder({ x: sx, y: 1.15, z: 0.90 }, 0.018, 0.92, '#dce3ea');
      detail.cylinder({ x: sx, y: 1.15, z: -0.12 }, 0.016, 0.92, '#dce3ea');
      detail.cylinder({ x: sx, y: 1.15, z: -1.10 }, 0.018, 0.92, '#dce3ea');
    }
    detail.box({ x: 0, y: 1.62, z: -0.05 }, { x: 1.34, y: 0.08, z: 2.28 }, '#f4f1e6');
    detail.box({ x: 0, y: 0.36, z: 1.25 }, { x: 1.02, y: 0.08, z: 0.08 }, '#cfd6de'); // chrome bullbar
    // Transparent windscreen is emitted separately so the hands are visible.
    detail.box({ x: 0, y: 0.32, z: -0.35 }, { x: 0.96, y: 0.16, z: 0.95 }, '#1d242b');
    detail.box({ x: 0, y: 0.72, z: -0.82 }, { x: 1.16, y: 0.18, z: 0.42 }, '#7a2323');
    detail.box({ x: 0, y: 0.72, z: -0.12 }, { x: 1.16, y: 0.18, z: 0.38 }, '#7a2323');
    // Separate driver's seat, rather than leaving the torso floating in the cab.
    detail.box({ x: 0, y: 0.77, z: 0.46 }, { x: 0.40, y: 0.10, z: 0.32 }, '#302e2a');
    for (const side of [-1, 1]) {
      detail.box({ x: side * 0.09, y: 0.66, z: 0.53 }, { x: 0.11, y: 0.20, z: 0.25 }, '#242f41');
    }
    // Visible EasyBike driver with head, cap & hands on the cabin handlebar
    detail.box({ x: 0, y: 1.02, z: 0.46 }, { x: 0.34, y: 0.42, z: 0.22 }, '#1e3a8a');
    detail.cylinder({ x: 0, y: 1.31, z: 0.47 }, 0.095, 0.18, '#8d5b3c');
    detail.cylinder({ x: 0, y: 1.39, z: 0.47 }, 0.098, 0.07, '#f8fafc');
    detail.cylinder({ x: 0, y: 1.04, z: 0.80 }, 0.018, 0.12, '#8a929c', { x: 1.15 });
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
    halfLength = 3.73;
    halfWidth = 1.19;
    radius = 2.65;
    schemeHexes = ['#b7282e', '#165a8a', '#1e6f50', '#8a2b52'];
    // Lower skirt body + sloped front brow + rounded upper roof cap
    primary.box({ x: 0, y: 0.92, z: 0 }, { x: 2.38, y: 0.96, z: 7.42 }, '#ffffff');
    primary.box({ x: 0, y: 2.78, z: -0.04 }, { x: 2.24, y: 0.20, z: 7.18 }, '#ffffff');
    primary.box({ x: 0, y: 2.88, z: 0 }, { x: 1.98, y: 0.10, z: 6.92 }, '#ffffff');

    // Gold waist belt, cream window band, roof AC pods, dark wheel wells & grille slats
    detail.box({ x: 0, y: 1.38, z: 0 }, { x: 2.41, y: 0.14, z: 7.46 }, '#f2a922');
    detail.box({ x: 0, y: 2.08, z: 0 }, { x: 2.36, y: 1.26, z: 7.36 }, '#f4efe0');
    detail.box({ x: 0, y: 2.98, z: 0.4 }, { x: 1.56, y: 0.22, z: 2.6 }, '#cfd6de');
    detail.box({ x: 0, y: 2.96, z: -1.8 }, { x: 1.38, y: 0.16, z: 1.5 }, '#bfc8d2');
    detail.box({ x: 0, y: 0.46, z: 3.74 }, { x: 2.40, y: 0.26, z: 0.16 }, '#22262c');
    detail.box({ x: 0, y: 0.46, z: -3.74 }, { x: 2.40, y: 0.26, z: 0.16 }, '#22262c');
    detail.box({ x: 0, y: 0.44, z: 3.83 }, { x: 0.62, y: 0.14, z: 0.03 }, '#f8fafc'); // Dhaka Metro plate
    detail.box({ x: 0, y: 2.02, z: 3.69 }, { x: 2.16, y: 0.96, z: 0.05 }, '#193240');
    detail.box({ x: 0, y: 2.02, z: 3.71 }, { x: 0.04, y: 0.94, z: 0.04 }, '#111820'); // split windshield mullion
    detail.box({ x: 0, y: 2.62, z: 3.70 }, { x: 1.72, y: 0.24, z: 0.05 }, '#102419');
    detail.box({ x: 0, y: 2.06, z: -3.69 }, { x: 1.98, y: 0.78, z: 0.05 }, '#193240');
    // Dark wheel-well cutouts & visible RHD bus driver behind windshield
    for (const wz of [2.35, -2.25]) {
      for (const sx of [-1.18, 1.18]) {
        detail.box({ x: sx, y: 0.56, z: wz }, { x: 0.06, y: 0.64, z: 1.06 }, '#16191d');
      }
    }
    detail.box({ x: -0.62, y: 1.88, z: 3.12 }, { x: 0.40, y: 0.48, z: 0.28 }, '#e2e8f0');
    detail.cylinder({ x: -0.62, y: 2.22, z: 3.12 }, 0.11, 0.20, '#8d5b3c');
    for (let wz = -2.8; wz <= 2.6; wz += 1.05) {
      detail.box({ x: -1.19, y: 2.06, z: wz }, { x: 0.04, y: 0.74, z: 0.84 }, '#1a3544');
      detail.box({ x: -1.20, y: 2.30, z: wz }, { x: 0.045, y: 0.04, z: 0.84 }, '#cfd6de'); // upper vent bar
      if (wz < 1.6) {
        detail.box({ x: 1.19, y: 2.06, z: wz }, { x: 0.04, y: 0.74, z: 0.84 }, '#1a3544');
        detail.box({ x: 1.20, y: 2.30, z: wz }, { x: 0.045, y: 0.04, z: 0.84 }, '#cfd6de');
      }
    }
    detail.box({ x: 1.16, y: 1.48, z: 2.35 }, { x: 0.08, y: 1.75, z: 0.86 }, '#111920');
    detail.box({ x: 0, y: 0.92, z: 3.73 }, { x: 1.38, y: 0.42, z: 0.04 }, '#22282e');
    detail.box({ x: 0, y: 0.98, z: 3.75 }, { x: 1.24, y: 0.06, z: 0.04 }, '#cfd6de');
    detail.box({ x: 0, y: 0.86, z: 3.75 }, { x: 1.24, y: 0.06, z: 0.04 }, '#cfd6de');
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
    halfLength = 3.05;
    halfWidth = 1.07;
    radius = 2.3;
    schemeHexes = ['#d97724', '#1d6fa5', '#2a8c55', '#b83232'];
    primary.box({ x: 0, y: 1.38, z: 1.98 }, { x: 2.14, y: 1.48, z: 1.86 }, '#ffffff');

    detail.box({ x: 0, y: 0.56, z: 0 }, { x: 1.86, y: 0.20, z: 6.1 }, '#262b30');
    // Ornate Bangladeshi painted truck `Taj` crown + sun visor + side windows + chrome grille
    detail.box({ x: 0, y: 2.38, z: 1.92 }, { x: 2.20, y: 0.56, z: 1.48 }, '#f2b938', { x: -0.08 });
    detail.box({ x: 0, y: 2.70, z: 2.24 }, { x: 1.54, y: 0.22, z: 0.48 }, '#16a34a');
    detail.box({ x: 0, y: 2.42, z: 2.66 }, { x: 1.92, y: 0.36, z: 0.06 }, '#b31329');
    detail.box({ x: 0, y: 1.98, z: 2.96 }, { x: 2.08, y: 0.12, z: 0.24 }, '#d97706', { x: 0.22 }); // brow visor
    detail.box({ x: 0, y: 1.62, z: 2.92 }, { x: 1.86, y: 0.64, z: 0.04 }, '#1d3746');
    for (const sx of [-1.08, 1.08]) {
      detail.box({ x: sx, y: 1.62, z: 2.12 }, { x: 0.04, y: 0.58, z: 0.92 }, '#1d3746');
      detail.box({ x: sx * 1.08, y: 1.68, z: 2.72 }, { x: 0.12, y: 0.28, z: 0.06 }, '#262b30');
    }
    detail.box({ x: 0, y: 0.94, z: 2.93 }, { x: 1.48, y: 0.46, z: 0.05 }, '#cfd6de');
    detail.box({ x: 0, y: 0.52, z: 2.96 }, { x: 2.16, y: 0.24, z: 0.14 }, '#dce3ea');
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
    halfLength = 2.00;
    halfWidth = 0.88;
    radius = 1.62;
    schemeHexes = ['#f2f4f7', '#1d6fa5', '#e8a829', '#2b8a62'];
    // Sculpted pickup nose + slanted cab roof
    primary.box({ x: 0, y: 0.62, z: 0.98 }, { x: 1.68, y: 0.62, z: 1.72 }, '#ffffff');
    primary.box({ x: 0, y: 1.24, z: 0.76 }, { x: 1.58, y: 0.68, z: 1.18 }, '#ffffff');

    detail.box({ x: 0, y: 0.42, z: 1.86 }, { x: 1.72, y: 0.22, z: 0.12 }, '#262c34');
    detail.box({ x: 0, y: 0.66, z: 1.85 }, { x: 0.92, y: 0.22, z: 0.04 }, '#222830');
    detail.box({ x: 0, y: 1.26, z: 1.36 }, { x: 1.44, y: 0.52, z: 0.04 }, '#1d3746', { x: -0.26 });
    for (const sx of [-0.80, 0.80]) {
      detail.box({ x: sx, y: 1.24, z: 0.78 }, { x: 0.04, y: 0.48, z: 0.82 }, '#1d3746');
      detail.box({ x: sx * 1.08, y: 1.18, z: 1.12 }, { x: 0.11, y: 0.16, z: 0.05 }, '#262c34');
    }
    // Ribbed covered parcel box + rear barn doors & latch rods
    detail.box({ x: 0, y: 1.18, z: -0.78 }, { x: 1.76, y: 1.56, z: 2.48 }, '#e9edf2');
    for (const rz of [-1.55, -0.80, -0.05]) {
      detail.box({ x: 0, y: 1.18, z: rz }, { x: 1.79, y: 1.58, z: 0.05 }, '#d0d7e0');
    }
    detail.box({ x: 0, y: 1.18, z: -2.03 }, { x: 1.62, y: 1.42, z: 0.03 }, '#cfd6de');
    detail.box({ x: -0.22, y: 1.18, z: -2.05 }, { x: 0.03, y: 1.32, z: 0.03 }, '#64748b');
    detail.box({ x: 0.22, y: 1.18, z: -2.05 }, { x: 0.03, y: 1.32, z: 0.03 }, '#64748b');
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
    halfLength = 0.94;
    halfWidth = 0.25;
    radius = 0.72;
    schemeHexes = ['#d62828', '#1d3557', '#2a9d8f', '#f77f00'];
    // Sculpted 150cc tank, headlight bikini cowl & matching helmet
    primary.box({ x: 0, y: 0.76, z: 0.18 }, { x: 0.28, y: 0.22, z: 0.48 }, '#ffffff', { x: -0.14 });
    primary.box({ x: 0, y: 0.84, z: 0.56 }, { x: 0.22, y: 0.20, z: 0.18 }, '#ffffff', { x: -0.22 });
    primary.cylinder({ x: 0, y: 1.42, z: 0.04 }, 0.125, 0.23, '#ffffff');

    detail.box({ x: 0, y: 0.48, z: 0.04 }, { x: 0.16, y: 0.26, z: 0.78 }, '#2a2f35');
    detail.cylinder({ x: 0.11, y: 0.34, z: -0.32 }, 0.038, 0.92, '#cfd6de', { x: Math.PI / 2 - 0.08 });
    detail.box({ x: 0, y: 0.70, z: -0.34 }, { x: 0.24, y: 0.12, z: 0.62 }, '#1e2024');
    detail.cylinder({ x: 0, y: 0.62, z: 0.56 }, 0.024, 0.66, '#dce3ea', { x: -0.34 });
    detail.cylinder({ x: 0, y: 0.95, z: 0.44 }, 0.016, 0.60, '#dce3ea', { z: Math.PI / 2 });
    // Rider jacket, bent legs on footpegs, and attached arms + hands gripping handlebars!
    detail.box({ x: 0, y: 1.08, z: -0.10 }, { x: 0.36, y: 0.44, z: 0.22 }, '#264653', { x: 0.30 });
    for (const sx of [-1, 1]) {
      detail.cylinder({ x: sx * 0.20, y: 1.06, z: 0.18 }, 0.036, 0.48, '#264653', { x: -1.18, z: sx * -0.10 });
      detail.box({ x: sx * 0.23, y: 0.95, z: 0.43 }, { x: 0.05, y: 0.05, z: 0.06 }, '#1c1917');
      detail.cylinder({ x: sx * 0.13, y: 0.66, z: -0.04 }, 0.052, 0.44, '#1e293b', { x: 0.42 });
    }
    detail.box({ x: 0, y: 1.41, z: 0.15 }, { x: 0.19, y: 0.09, z: 0.04 }, '#142430');
    addHead(0, 0.80, 0.64, 0.13, 0.13, 0.04, '#fff6d1');
    addBrake(0, 0.72, -0.72, 0.10, 0.06, 0.03);
    wheelMounts.push(
      { x: 0, y: wheelRadius, z: 0.66, width: 0.09 },
      { x: 0, y: wheelRadius, z: -0.64, width: 0.09 },
    );
  } else {
    // Dhaka Private Sedan (Toyota Premio / Corolla Allion street staple — sharper greenhouse & trim!)
    wheelRadius = 0.32;
    halfLength = 2.04;
    halfWidth = 0.86;
    radius = 1.58;
    schemeHexes = ['#e8ecef', '#25323f', '#8a2020', '#1e4e79', '#d6cfc2'];
    // Sculpted waist body + gently sloped hood & trunk deck + greenhouse roof cap
    primary.box({ x: 0, y: 0.54, z: 0 }, { x: 1.72, y: 0.44, z: 3.98 }, '#ffffff');
    primary.box({ x: 0, y: 0.76, z: 1.36 }, { x: 1.64, y: 0.12, z: 1.16 }, '#ffffff', { x: 0.09 });
    primary.box({ x: 0, y: 0.78, z: -1.46 }, { x: 1.62, y: 0.12, z: 0.96 }, '#ffffff', { x: -0.06 });
    primary.box({ x: 0, y: 0.38, z: 1.98 }, { x: 1.74, y: 0.24, z: 0.22 }, '#ffffff');
    primary.box({ x: 0, y: 0.38, z: -1.98 }, { x: 1.74, y: 0.24, z: 0.22 }, '#ffffff');
    primary.box({ x: 0, y: 1.29, z: -0.14 }, { x: 1.38, y: 0.08, z: 1.68 }, '#ffffff');
    for (const sx of [-1, 1]) {
      // Slanted A-pillars & C-pillars + wing mirrors
      primary.box({ x: sx * 0.69, y: 1.04, z: 0.82 }, { x: 0.07, y: 0.52, z: 0.09 }, '#ffffff', { x: -0.58 });
      primary.box({ x: sx * 0.69, y: 1.04, z: -1.08 }, { x: 0.09, y: 0.50, z: 0.14 }, '#ffffff', { x: 0.54 });
      primary.box({ x: sx * 0.90, y: 0.92, z: 0.62 }, { x: 0.14, y: 0.09, z: 0.12 }, '#ffffff');
      addHead(sx * 0.62, 0.60, 2.02, 0.30, 0.14, 0.04, '#fff6d6');
      addBrake(sx * 0.62, 0.64, -2.02, 0.34, 0.14, 0.04);
    }
    // Tinted glass cabin, B-pillars, chrome grille, lower air dam, plates & dark wheel wells!
    detail.box({ x: 0, y: 1.03, z: -0.14 }, { x: 1.44, y: 0.46, z: 1.72 }, '#1b3240');
    detail.box({ x: 0, y: 1.04, z: 0.88 }, { x: 1.38, y: 0.52, z: 0.05 }, '#1c3544', { x: -0.60 });
    detail.box({ x: 0, y: 1.04, z: -1.14 }, { x: 1.34, y: 0.48, z: 0.05 }, '#1c3544', { x: 0.56 });
    detail.box({ x: 0, y: 0.56, z: 2.02 }, { x: 0.88, y: 0.20, z: 0.04 }, '#cfd6de');
    detail.box({ x: 0, y: 0.33, z: 2.03 }, { x: 1.18, y: 0.10, z: 0.05 }, '#1e2228');
    detail.box({ x: 0, y: 0.38, z: 2.09 }, { x: 0.44, y: 0.11, z: 0.02 }, '#f8fafc');
    detail.box({ x: 0, y: 0.62, z: -2.01 }, { x: 0.44, y: 0.11, z: 0.02 }, '#f8fafc');
    // Visible RHD driver silhouette inside cabin
    detail.cylinder({ x: -0.34, y: 1.10, z: 0.08 }, 0.095, 0.18, '#6b442a');
    for (const sx of [-1, 1]) {
      detail.box({ x: sx * 0.73, y: 1.04, z: -0.10 }, { x: 0.03, y: 0.46, z: 0.10 }, '#11161c'); // B-pillar
      detail.box({ x: sx * 0.87, y: 0.74, z: 0.15 }, { x: 0.02, y: 0.04, z: 0.14 }, '#cfd6de'); // door handle
      detail.box({ x: sx * 0.87, y: 0.74, z: -0.58 }, { x: 0.02, y: 0.04, z: 0.14 }, '#cfd6de');
      detail.box({ x: sx * 0.84, y: 0.42, z: 1.24 }, { x: 0.08, y: 0.42, z: 0.74 }, '#15181c');
      detail.box({ x: sx * 0.84, y: 0.42, z: -1.24 }, { x: 0.08, y: 0.42, z: 0.74 }, '#15181c');
    }
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
// Glass cannot share the opaque vertex-colour detail material. Two instanced
// layers retain the original pane geometry without hiding the occupants.
const glassFleetMat = new THREE.MeshLambertMaterial({ color: '#8bc2d2', transparent: true, opacity: 0.24, depthWrite: false });
const glassGeometry = {
  cng: new THREE.BoxGeometry(0.94, 0.54, 0.03).rotateX(-0.22).translate(0, 1.09, 0.805),
  easybike: new THREE.BoxGeometry(1.06, 0.62, 0.04).rotateX(-0.16).translate(0, 1.16, 0.94),
};

const steeringGeometry = new Map<string, THREE.BufferGeometry>();
function getSteeringGeometry(type: SteeringDriverType, angle: number): THREE.BufferGeometry {
  const key = `${type}:${angle}`;
  const existing = steeringGeometry.get(key);
  if (existing) return existing;
  const b = new Bucket(`traffic.${type}.steering`, detailFleetMat);
  const skin = type === 'rickshaw' ? '#8b5e3c' : '#8d5b3c';
  const sleeve = type === 'rickshaw' ? '#d98236' : type === 'cng' ? '#2b4c72' : '#1e3a8a';
  for (const chain of npcSteeringPose(type, angle)) emitArmChain(b, chain, skin, sleeve);
  const y = type === 'easybike' ? 1.09 : 1.155;
  const z = type === 'rickshaw' ? 0.725 : type === 'cng' ? 0.70 : 0.84;
  b.cylinder({ x: 0, y, z }, 0.016, type === 'rickshaw' ? 0.46 : 0.42, '#dce3ea', { y: angle, z: Math.PI / 2 });
  const geometry = b.build({ cast: false, receive: true })!.geometry;
  steeringGeometry.set(key, geometry);
  return geometry;
}

export class InstancedTrafficFleet {
  private layers = new Map<TrafficType, TypeLayerPair>();
  private steeringLayers = new Map<SteeringDriverType, THREE.InstancedMesh[]>();
  private glassLayers = new Map<'cng' | 'easybike', THREE.InstancedMesh>();
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

    // Five quantized steering poses per affected vehicle type. Each is one
    // shared instanced mesh, not an Object3D hierarchy per traffic vehicle.
    for (const type of ['rickshaw', 'cng', 'easybike'] as const) {
      const layers = NPC_STEERING_ANGLES.map((angle) => {
        const mesh = new THREE.InstancedMesh(getSteeringGeometry(type, angle), detailFleetMat, maxVehicles);
        mesh.name = `traffic.${type}.steering.${angle}`;
        mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        parent.add(mesh);
        return mesh;
      });
      this.steeringLayers.set(type, layers);
    }

    for (const type of ['cng', 'easybike'] as const) {
      const mesh = new THREE.InstancedMesh(glassGeometry[type], glassFleetMat, maxVehicles);
      mesh.name = `traffic.${type}.windscreen`;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      parent.add(mesh);
      this.glassLayers.set(type, mesh);
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
    for (const layers of this.steeringLayers.values()) for (const mesh of layers) mesh.count = 0;
    for (const mesh of this.glassLayers.values()) mesh.count = 0;
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
      const glass = this.glassLayers.get(a.kind as 'cng' | 'easybike');
      if (glass) glass.setMatrixAt(glass.count++, this.tmpMat);
      const steering = this.steeringLayers.get(a.kind as SteeringDriverType);
      if (steering) {
        const index = Math.max(0, Math.min(NPC_STEERING_ANGLES.length - 1, Math.round(((a.steerAngle ?? 0) + 0.5) / 0.25)));
        const mesh = steering[index];
        mesh.setMatrixAt(mesh.count++, this.tmpMat);
      }

      // Wheels are essential to the silhouette even at far LOD: omitting them
      // made distant vehicles float. Far wheels use a fixed orientation; near
      // wheels keep their animation. Both use the same existing instanced draw.
      this.tmpSpinQuat.setFromAxisAngle(this.xAxis, a.nearLod ? a.wheelSpin : 0);
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

      // Live lamps are sub-pixel beyond the near/mid range. Reset the shared
      // scale before continuing so the next vehicle body is not wheel-scaled.
      if (!a.nearLod) {
        unitScale.set(1, 1, 1);
        continue;
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

    for (const mesh of this.glassLayers.values()) {
      mesh.visible = mesh.count > 0;
      if (mesh.count > 0) mesh.instanceMatrix.needsUpdate = true;
    }
    for (const layers of this.steeringLayers.values()) {
      for (const mesh of layers) {
        mesh.visible = mesh.count > 0;
        if (mesh.count > 0) mesh.instanceMatrix.needsUpdate = true;
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
    for (const layers of this.steeringLayers.values()) meshes.push(...layers);
    for (const mesh of this.glassLayers.values()) meshes.push(mesh);
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
