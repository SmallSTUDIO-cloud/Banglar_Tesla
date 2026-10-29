/**
 * Detailed Bangladeshi three-wheeled passenger rickshaw rig:
 *   - Classic Pedal Rickshaw (traditional tubular steel frame, chain drive,
 *     sprung saddle, curved mudguards, brass bell, dual mirrors, hand-painted
 *     backplate art, quilted bench, bamboo-ribbed folding hood & tassels)
 *   - Banglar Bidyut Electric Rickshaw (48V battery pack, rear brushless DC
 *     hub/axle motor, finned controller, handlebar LED battery meter, dual headlamps)
 *   - Rickshaw Roadster (non-purchasable aerodynamic concept preview)
 *
 * Performance & Physics Architecture:
 *   - `root.rotation.order = 'YXZ'` prevents pitch/roll cross-talk at any yaw.
 *   - Exact tyre radii (`front = 0.370m`, `rear = 0.386m`) match `RIDE` constants
 *     in `config.ts` so tyres kiss the road without sinking on flat/sloped ground.
 *   - Static sub-parts inside `chassis` and `steering` are merged by material
 *     via `Bucket`, delivering ~160 sculpted rickshaw parts in ~12 draw calls.
 */

import * as THREE from 'three';
import { RIDE } from '../core/config';
import type { VehicleKind } from '../economy/catalog';
import { Bucket, createWheel } from '../world/geo';
import { rickshawArtTexture } from '../world/textures';

export type DriverHairStyle =
  | 'bandana'
  | 'peaked_cap'
  | 'curly'
  | 'headband'
  | 'pagri_wrap'
  | 'spiky'
  | 'bucket_hat'
  | 'topi'
  | 'ponytail_bun'
  | 'crown_bandana';

export type DriverOutfitStyle =
  | 'vest_lungi'
  | 'kurta_gamcha'
  | 'jacket_pants'
  | 'jersey_track'
  | 'raincoat'
  | 'royal_sherwani';

export type DriverExpression = 'determined' | 'grin' | 'fierce' | 'cool';
export type DriverEyewear = 'none' | 'aviator' | 'sport_visor';
export type DriverPoseMode = 'riding' | 'intro' | 'victory';

export interface DriverCharacterSpec {
  skinHex: string;
  hairStyle: DriverHairStyle;
  hairHex: string;
  headwearHex: string;
  eyewear: DriverEyewear;
  expression: DriverExpression;
  outfitStyle: DriverOutfitStyle;
  topHex: string;
  bottomHex: string;
  accentHex: string;
}

export const DEFAULT_PLAYER_CHARACTER: DriverCharacterSpec = {
  skinHex: '#8d5b3c',
  hairStyle: 'topi',
  hairHex: '#1b1614',
  headwearHex: '#f4f1ea',
  eyewear: 'none',
  expression: 'determined',
  outfitStyle: 'kurta_gamcha',
  topHex: '#d98a3c',
  bottomHex: '#1d4e6e',
  accentHex: '#c92a2a',
};

let sharedCharacterMaterial: THREE.MeshLambertMaterial | null = null;
function getSharedCharacterMaterial(): THREE.MeshLambertMaterial {
  if (!sharedCharacterMaterial) {
    sharedCharacterMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    sharedCharacterMaterial.userData = { shared: true };
  }
  return sharedCharacterMaterial;
}

export interface RickshawLook {
  frameColor: string;
  canopyColor: string;
  canopyTrim: string;
  wheelTrim: string;
  artMotif: string;
  artPrimary: string;
  artSecondary: string;
  fairyLights: boolean;
  bellUpgrade: boolean;
  bell: string;
  mirrorSet: boolean;
  flowersColor: string | null;
  kind?: VehicleKind;
  character?: DriverCharacterSpec;
}

export const DEFAULT_LOOK: RickshawLook = {
  frameColor: '#0e6b50',
  canopyColor: '#b31329',
  canopyTrim: '#f2b938',
  wheelTrim: '#d9d9d9',
  artMotif: 'lotus',
  artPrimary: '#134e3a',
  artSecondary: '#f3b93a',
  fairyLights: false,
  bellUpgrade: false,
  bell: 'classic',
  mirrorSet: false,
  flowersColor: null,
  kind: 'pedal',
};

export class RickshawRig {
  readonly root = new THREE.Group();
  readonly chassis = new THREE.Group();
  readonly steering = new THREE.Group();
  readonly frontWheel: THREE.Group;
  readonly rearWheels: [THREE.Group, THREE.Group];
  readonly crank = new THREE.Group();
  readonly puller = new THREE.Group();
  readonly passengerMount = new THREE.Group();
  readonly headlampLight: THREE.SpotLight | null;
  readonly fairyBulbMaterials: THREE.MeshStandardMaterial[] = [];
  private tasselBar = new THREE.Group();

  readonly frontWheelRadius = RIDE.frontWheelRadius;
  readonly rearWheelRadius = RIDE.rearWheelRadius;
  private look: RickshawLook;
  private isElectric: boolean;
  private driverArms: Array<{ side: 1 | -1; upper: THREE.Mesh; fore: THREE.Mesh; hand: THREE.Mesh }> = [];
  private readonly armDirection = new THREE.Vector3();
  private readonly armUp = new THREE.Vector3(0, 1, 0);

  constructor(look: RickshawLook = DEFAULT_LOOK, opts: { isPlayer?: boolean } = {}) {
    this.look = look;
    this.isElectric = look.kind === 'electric' || look.kind === 'roadster';
    const isRoadster = look.kind === 'roadster';

    this.root.name = 'rickshaw';
    // Critical: apply world Yaw (Y) first, then local Pitch (X), then local Roll (Z)!
    this.root.rotation.order = 'YXZ';
    this.root.add(this.chassis);

    // Rig-owned materials (vertexColors enabled so merged buckets carry rich multi-tone parts)
    const metalMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: isRoadster ? 0.25 : 0.36,
      metalness: isRoadster ? 0.78 : 0.62,
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.2,
      metalness: 0.88,
    });
    const fabricMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    const woodLeatherMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: this.isElectric ? 0xe6fbff : 0xffe49e,
    });

    const bMetal = new Bucket('rickshaw.chassis.metal', metalMat);
    const bChrome = new Bucket('rickshaw.chassis.chrome', chromeMat);
    const bFabric = new Bucket('rickshaw.chassis.fabric', fabricMat);
    const bWood = new Bucket('rickshaw.chassis.wood', woodLeatherMat);

    // --------------------------------------------------- 1. WHEELS (exact ground contact)
    this.frontWheel = createWheel(this.frontWheelRadius, '#1a1c1f', look.wheelTrim, 18);
    const rearL = createWheel(this.rearWheelRadius, '#1a1c1f', look.wheelTrim, 20);
    const rearR = createWheel(this.rearWheelRadius, '#1a1c1f', look.wheelTrim, 20);
    if (!opts.isPlayer) {
      for (const w of [this.frontWheel, rearL, rearR]) {
        w.traverse((node) => {
          if (node instanceof THREE.Mesh) node.castShadow = false;
        });
      }
    }
    this.rearWheels = [rearL, rearR];

    rearL.position.set(RIDE.rearTrackHalf, this.rearWheelRadius, RIDE.rearAxleZ);
    rearR.position.set(-RIDE.rearTrackHalf, this.rearWheelRadius, RIDE.rearAxleZ);
    this.chassis.add(rearL, rearR);

    // Steering pivot sits directly above the front axle (z = +0.80m)
    this.steering.position.set(0, 0, RIDE.frontAxleZ);
    this.frontWheel.position.set(0, this.frontWheelRadius, 0);
    this.steering.add(this.frontWheel);
    this.chassis.add(this.steering);

    const frameCol = look.frameColor;
    const trimCol = look.canopyTrim;
    const rearZ = RIDE.rearAxleZ; // -0.68
    const rearY = this.rearWheelRadius; // 0.386

    // ----------------------------------- 2. REAR AXLE, LEAF SPRINGS & FENDERS
    // Solid steel rear axle + central differential/sprocket drum
    bChrome.cylinder({ x: 0, y: rearY, z: rearZ }, 0.022, RIDE.rearTrackHalf * 2.08, '#9aa3ad', { z: Math.PI / 2 });
    bMetal.cylinder({ x: 0.06, y: rearY, z: rearZ }, 0.068, 0.14, '#24292e', { z: Math.PI / 2 });

    // Twin multi-leaf semi-elliptic springs + shackles under passenger carriage
    for (const sx of [-0.37, 0.37]) {
      bMetal.box({ x: sx, y: rearY + 0.055, z: rearZ }, { x: 0.048, y: 0.022, z: 0.56 }, '#2c3136');
      bMetal.box({ x: sx, y: rearY + 0.074, z: rearZ }, { x: 0.044, y: 0.018, z: 0.42 }, '#3a4046');
      bMetal.box({ x: sx, y: rearY + 0.09, z: rearZ }, { x: 0.04, y: 0.016, z: 0.28 }, '#464d54');
      bChrome.box({ x: sx, y: rearY + 0.06, z: rearZ - 0.26 }, { x: 0.055, y: 0.06, z: 0.03 }, '#b9c0c7');
      bChrome.box({ x: sx, y: rearY + 0.06, z: rearZ + 0.26 }, { x: 0.055, y: 0.06, z: 0.03 }, '#b9c0c7');
    }

    // Sculpted rear arched mudguards (segmented curved steel fenders + gold trim)
    for (const side of [-1, 1]) {
      const wx = side * RIDE.rearTrackHalf;
      const segs = 9;
      for (let i = 0; i < segs; i++) {
        const a0 = -0.35 + (i / segs) * (Math.PI + 0.45);
        const r = this.rearWheelRadius + 0.038;
        const fy = rearY + Math.sin(a0) * r;
        const fz = rearZ + Math.cos(a0) * r;
        const pitch = a0 - Math.PI * 0.5;
        bMetal.box({ x: wx, y: fy, z: fz }, { x: 0.125, y: 0.016, z: 0.155 }, frameCol, { x: -pitch });
        bMetal.box({ x: wx + side * 0.058, y: fy - 0.008, z: fz }, { x: 0.014, y: 0.032, z: 0.155 }, trimCol, { x: -pitch });
      }
      // Mudguard stay rods
      bChrome.cylinder({ x: wx + side * 0.045, y: rearY + 0.12, z: rearZ - 0.2 }, 0.006, 0.42, '#cfd6dd', { x: 0.68 });
      bChrome.cylinder({ x: wx + side * 0.045, y: rearY + 0.12, z: rearZ + 0.2 }, 0.006, 0.42, '#cfd6dd', { x: -0.68 });
      // Rear rubber mudflap with brass studs
      bWood.box({ x: wx, y: 0.21, z: rearZ - this.rearWheelRadius - 0.03 }, { x: 0.12, y: 0.14, z: 0.012 }, '#181a1d');
      bChrome.cylinder({ x: wx, y: 0.17, z: rearZ - this.rearWheelRadius - 0.038 }, 0.012, 0.01, trimCol, { x: Math.PI / 2 });
    }

    // ----------------------------------------- 3. TUBULAR STEEL BICYCLE FRAME
    // Twin lower chassis rails from rear axle forward to bottom bracket (z = 0.06, y = 0.42)
    for (const sx of [-0.36, 0.36]) {
      bMetal.cylinder({ x: sx * 0.62, y: 0.41, z: -0.30 }, 0.019, 0.86, frameCol, {
        x: Math.PI / 2 - 0.04,
        z: sx * 0.38,
      });
      bMetal.box({ x: sx, y: 0.52, z: -0.62 }, { x: 0.035, y: 0.035, z: 0.78 }, frameCol);
    }
    // Crossbars
    bMetal.cylinder({ x: 0, y: 0.52, z: -0.26 }, 0.018, 0.76, frameCol, { z: Math.PI / 2 });
    bMetal.cylinder({ x: 0, y: 0.52, z: -0.96 }, 0.018, 0.76, frameCol, { z: Math.PI / 2 });

    // Classic diamond bicycle front triangle: BB(0.06,0.42) -> SeatPost(-0.04,0.92) -> HeadTube(0.80,0.94)
    bMetal.cylinder({ x: 0, y: 0.67, z: 0.01 }, 0.02, 0.52, frameCol, { x: -0.19 }); // seat tube
    bMetal.cylinder({ x: 0, y: 0.67, z: 0.43 }, 0.022, 0.90, frameCol, { x: 0.96 }); // main down tube
    bMetal.cylinder({ x: 0, y: 0.91, z: 0.40 }, 0.019, 0.84, frameCol, { x: Math.PI / 2 - 0.05 }); // horizontal top tube
    // Bangladeshi double-bar reinforcement tube (iconic heavy-duty rickshaw truss!)
    bMetal.cylinder({ x: 0, y: 0.81, z: 0.41 }, 0.016, 0.82, trimCol, { x: Math.PI / 2 + 0.06 });

    // Sprung leather rider saddle + twin rear coil springs
    bChrome.cylinder({ x: 0, y: 0.96, z: -0.05 }, 0.013, 0.12, '#cfd6de');
    bWood.box({ x: 0, y: 1.03, z: -0.06 }, { x: 0.18, y: 0.048, z: 0.25 }, '#3b2416');
    bWood.box({ x: 0, y: 1.035, z: 0.04 }, { x: 0.09, y: 0.042, z: 0.11 }, '#3b2416');
    for (const sx of [-0.055, 0.055]) {
      bChrome.cylinder({ x: sx, y: 0.985, z: -0.13 }, 0.022, 0.055, '#b8c0c8');
    }

    // ------------------------ 4. DRIVETRAIN: CHAIN vs ELECTRIC BATTERY/MOTOR
    if (this.isElectric) {
      // Under-seat 48V battery box + yellow hazard stripe + rear brushless DC motor
      bMetal.box({ x: 0, y: 0.44, z: -0.44 }, { x: 0.54, y: 0.18, z: 0.38 }, '#1c2630');
      bMetal.box({ x: 0, y: 0.45, z: -0.245 }, { x: 0.48, y: 0.05, z: 0.015 }, '#f2b938');
      bChrome.box({ x: 0.18, y: 0.54, z: -0.44 }, { x: 0.14, y: 0.04, z: 0.22 }, '#9aa8b8'); // finned controller
      bMetal.cylinder({ x: -0.08, y: rearY, z: rearZ }, 0.105, 0.22, '#1f4e5f', { z: Math.PI / 2 }); // BLDC axle motor
      bChrome.cylinder({ x: -0.08, y: rearY, z: rearZ }, 0.11, 0.04, '#39d2c0', { z: Math.PI / 2 });
    } else {
      // Sheet-metal chain guard + upper/lower roller chain runs
      bMetal.box({ x: 0.075, y: 0.425, z: -0.28 }, { x: 0.026, y: 0.085, z: 0.72 }, frameCol, { x: 0.04 });
      bChrome.box({ x: 0.068, y: 0.445, z: -0.31 }, { x: 0.01, y: 0.012, z: 0.74 }, '#474c52', { x: 0.05 });
      bChrome.box({ x: 0.068, y: 0.375, z: -0.31 }, { x: 0.01, y: 0.012, z: 0.74 }, '#474c52', { x: 0.02 });
    }

    // Rotating crankset, chainring & rubber pedals
    this.crank.position.set(0, 0.42, 0.06);
    const bCrank = new Bucket('rickshaw.crank', chromeMat);
    bCrank.cylinder({ x: 0.065, y: 0, z: 0 }, 0.095, 0.01, '#cfd6de', { z: Math.PI / 2 });
    bCrank.cylinder({ x: 0, y: 0, z: 0 }, 0.016, 0.19, '#b8c0c8', { z: Math.PI / 2 });
    bCrank.box({ x: 0.095, y: 0.08, z: 0 }, { x: 0.014, y: 0.17, z: 0.024 }, '#d5dce4');
    bCrank.box({ x: -0.095, y: -0.08, z: 0 }, { x: 0.014, y: 0.17, z: 0.024 }, '#d5dce4');
    bCrank.box({ x: 0.135, y: 0.155, z: 0 }, { x: 0.085, y: 0.024, z: 0.055 }, '#232629');
    bCrank.box({ x: -0.135, y: -0.155, z: 0 }, { x: 0.085, y: 0.024, z: 0.055 }, '#232629');
    const crankMesh = bCrank.build({ cast: false, receive: false }, true);
    if (crankMesh) this.crank.add(crankMesh);
    this.chassis.add(this.crank);

    // ----------------------- 5. STEERING FORK, HANDLEBARS, BELL, MIRRORS, LAMP
    const bSteerMetal = new Bucket('rickshaw.steer.metal', metalMat);
    const bSteerChrome = new Bucket('rickshaw.steer.chrome', chromeMat);

    // Head tube + chrome headset cups
    bSteerMetal.cylinder({ x: 0, y: 0.89, z: -0.01 }, 0.025, 0.22, frameCol, { x: -0.16 });
    bSteerChrome.cylinder({ x: 0, y: 1.00, z: -0.03 }, 0.03, 0.025, '#dce3ea', { x: -0.16 });
    bSteerChrome.cylinder({ x: 0, y: 0.78, z: 0.01 }, 0.03, 0.025, '#dce3ea', { x: -0.16 });

    // Fork crown + twin tapered fork blades down to front axle (0, 0.370, 0)
    bSteerMetal.box({ x: 0, y: 0.76, z: 0.01 }, { x: 0.15, y: 0.038, z: 0.05 }, frameCol);
    for (const fx of [-0.058, 0.058]) {
      bSteerMetal.cylinder({ x: fx, y: 0.565, z: 0.005 }, 0.015, 0.41, frameCol);
      bSteerChrome.box({ x: fx, y: this.frontWheelRadius, z: 0 }, { x: 0.018, y: 0.05, z: 0.045 }, '#cfd6de');
    }

    // Curved front mudguard + front mudflap + stay rods
    for (let i = 0; i < 8; i++) {
      const a0 = 0.22 + (i / 8) * 2.25;
      const r = this.frontWheelRadius + 0.034;
      const fy = this.frontWheelRadius + Math.sin(a0) * r;
      const fz = Math.cos(a0) * r;
      const pitch = a0 - Math.PI * 0.5;
      bSteerMetal.box({ x: 0, y: fy, z: fz }, { x: 0.105, y: 0.015, z: 0.135 }, frameCol, { x: -pitch });
    }
    bSteerChrome.cylinder({ x: 0.05, y: 0.44, z: -0.18 }, 0.005, 0.38, '#cfd6de', { x: 0.85 });
    bSteerChrome.cylinder({ x: -0.05, y: 0.44, z: -0.18 }, 0.005, 0.38, '#cfd6de', { x: 0.85 });
    bSteerMetal.box({ x: 0, y: 0.22, z: -this.frontWheelRadius - 0.02 }, { x: 0.11, y: 0.11, z: 0.01 }, '#1b1d20');

    // Front rod/caliper brake assembly
    bSteerChrome.box({ x: 0, y: 0.73, z: 0.048 }, { x: 0.11, y: 0.03, z: 0.025 }, '#c6cdd4');
    bSteerChrome.cylinder({ x: 0.02, y: 0.94, z: 0.01 }, 0.004, 0.42, '#22262a', { x: -0.14 });

    // Stem + classic swept-back Bangladeshi chrome handlebars + brake levers
    bSteerChrome.cylinder({ x: 0, y: 1.09, z: -0.045 }, 0.016, 0.19, '#dce3ea', { x: -0.15 });
    bSteerChrome.cylinder({ x: 0, y: 1.18, z: -0.06 }, 0.014, 0.38, '#e2e8ef', { z: Math.PI / 2 });
    for (const side of [-1, 1]) {
      // Swept-back bar bends + ribbed black rubber grips + hand-brake levers
      bSteerChrome.cylinder(
        { x: side * 0.23, y: 1.175, z: -0.115 },
        0.013,
        0.14,
        '#e2e8ef',
        { x: Math.PI / 2, z: side * 0.52 },
      );
      bSteerMetal.cylinder(
        { x: side * 0.275, y: 1.17, z: -0.195 },
        0.018,
        0.13,
        '#1e2024',
        { x: Math.PI / 2 },
      );
      bSteerChrome.box(
        { x: side * 0.24, y: 1.155, z: -0.17 },
        { x: 0.012, y: 0.014, z: 0.11 },
        '#cfd6de',
        { y: side * 0.18 },
      );
    }

    // Polished brass rickshaw bell (`টুং টাং`) on handlebar!
    const bellColor = look.bellUpgrade ? '#ffd452' : '#d8a93e';
    bSteerChrome.cylinder({ x: 0.155, y: 1.215, z: -0.075 }, 0.034, 0.026, bellColor);
    bSteerChrome.cylinder({ x: 0.155, y: 1.23, z: -0.075 }, 0.022, 0.012, '#ffe680');
    bSteerChrome.box({ x: 0.185, y: 1.205, z: -0.095 }, { x: 0.028, y: 0.008, z: 0.022 }, '#cfd6de');

    // Electric handlebar digital battery display
    if (this.isElectric) {
      bSteerMetal.box({ x: 0, y: 1.21, z: -0.05 }, { x: 0.095, y: 0.042, z: 0.03 }, '#141c24', { x: -0.45 });
      bSteerChrome.box({ x: 0, y: 1.215, z: -0.062 }, { x: 0.075, y: 0.022, z: 0.008 }, '#35f2c4', { x: -0.45 });
    }

    // Both safety mirrors exist on every frame; equipped cosmetics change their finish.
    const mirrorSides = [-1, 1];
    for (const side of mirrorSides) {
      bSteerChrome.cylinder(
        { x: side * 0.29, y: 1.255, z: -0.12 },
        0.005,
        0.16,
        '#dce3ea',
        { z: -side * 0.38 },
      );
      bSteerChrome.cylinder(
        { x: side * 0.33, y: 1.325, z: -0.12 },
        0.044,
        0.014,
        look.mirrorSet ? '#ffd45a' : '#d8dfe6',
        { x: Math.PI / 2 },
      );
      bSteerChrome.cylinder(
        { x: side * 0.33, y: 1.325, z: -0.128 },
        0.038,
        0.004,
        '#9fd6ff',
        { x: Math.PI / 2 },
      );
    }

    // Front headlamp(s) + municipal rickshaw number plate
    bSteerChrome.cylinder({ x: 0, y: 0.92, z: 0.075 }, 0.052, 0.075, '#cfd6de', { x: Math.PI / 2 });
    if (this.isElectric) {
      for (const sx of [-0.11, 0.11]) {
        bSteerChrome.cylinder({ x: sx, y: 0.84, z: 0.065 }, 0.036, 0.055, '#1e2b36', { x: Math.PI / 2 });
      }
    }
    // Front Dhaka City Corporation blue/white tin number plate
    bSteerMetal.box({ x: 0, y: 0.68, z: 0.072 }, { x: 0.16, y: 0.075, z: 0.008 }, '#144b82');
    bSteerChrome.box({ x: 0, y: 0.68, z: 0.077 }, { x: 0.14, y: 0.055, z: 0.004 }, '#f4f1e4');

    const steerM1 = bSteerMetal.build({ cast: Boolean(opts.isPlayer), receive: false }, true);
    const steerM2 = bSteerChrome.build({ cast: false, receive: false }, true);
    if (steerM1) this.steering.add(steerM1);
    if (steerM2) this.steering.add(steerM2);

    // Glowing headlamp lens
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.046, 14), glowMat);
    lens.position.set(0, 0.92, 0.114);
    this.steering.add(lens);

    if (opts.isPlayer) {
      const spot = new THREE.SpotLight(this.isElectric ? 0xe8f9ff : 0xffe4ad, 0, 22, Math.PI / 4.8, 0.55, 1.3);
      spot.position.set(0, 0.92, 0.13);
      spot.target.position.set(0, 0.1, 7.5);
      this.steering.add(spot);
      this.steering.add(spot.target);
      this.headlampLight = spot;
    } else {
      this.headlampLight = null;
    }

    // --------------------- 6. PASSENGER CARRIAGE, QUILTED BENCH & FOOTBOARD
    // Slatted hardwood footboard + brass nose edging + side step plates (পাদানি)
    bWood.box({ x: 0, y: 0.545, z: -0.34 }, { x: 0.90, y: 0.036, z: 0.36 }, '#5c3b20');
    for (let s = -2; s <= 2; s++) {
      bWood.box({ x: 0, y: 0.566, z: -0.34 + s * 0.068 }, { x: 0.88, y: 0.008, z: 0.042 }, '#744c2b');
    }
    bChrome.box({ x: 0, y: 0.555, z: -0.155 }, { x: 0.91, y: 0.038, z: 0.018 }, trimCol);
    for (const side of [-1, 1]) {
      bChrome.box({ x: side * 0.50, y: 0.43, z: -0.26 }, { x: 0.11, y: 0.02, z: 0.18 }, '#c5ccd4');
      bMetal.cylinder({ x: side * 0.44, y: 0.48, z: -0.26 }, 0.012, 0.12, frameCol, { z: side * 0.45 });
    }

    // Carriage body shell (curved side panels + under-seat storage skirt + rear apron)
    bMetal.box({ x: 0, y: 0.64, z: -0.78 }, { x: 0.92, y: 0.20, z: 0.56 }, frameCol);
    for (const side of [-1, 1]) {
      bMetal.box({ x: side * 0.455, y: 0.88, z: -0.76 }, { x: 0.042, y: 0.34, z: 0.56 }, frameCol);
      // Decorative brass S-scroll trim & bolstered rexine armrest
      bChrome.box({ x: side * 0.478, y: 0.88, z: -0.74 }, { x: 0.01, y: 0.18, z: 0.44 }, trimCol);
      bFabric.box({ x: side * 0.455, y: 1.07, z: -0.73 }, { x: 0.075, y: 0.065, z: 0.52 }, look.canopyColor);
      // Chrome grab handle at front of carriage
      bChrome.cylinder({ x: side * 0.46, y: 1.06, z: -0.45 }, 0.011, 0.18, '#dce3ea', { x: 0.25 });
    }

    // Quilted passenger bench cushion + tufted backrest
    bFabric.box({ x: 0, y: 0.775, z: -0.74 }, { x: 0.85, y: 0.11, z: 0.48 }, '#a91d2c');
    bFabric.box({ x: 0, y: 0.832, z: -0.54 }, { x: 0.84, y: 0.025, z: 0.07 }, trimCol); // front piping welt
    bFabric.box({ x: 0, y: 1.06, z: -0.99 }, { x: 0.85, y: 0.48, z: 0.095 }, '#a91d2c', { x: -0.08 });
    // Quilted vertical pleats + brass upholstery buttons
    for (let q = -3; q <= 3; q++) {
      bFabric.box({ x: q * 0.11, y: 1.06, z: -0.94 }, { x: 0.015, y: 0.42, z: 0.018 }, '#811220', { x: -0.08 });
      bChrome.cylinder({ x: q * 0.11, y: 1.10, z: -0.93 }, 0.01, 0.012, trimCol, { x: Math.PI / 2 });
    }

    // Rear ornate painted tin backplate + reflectors + Dhaka rickshaw plate
    bMetal.box({ x: 0, y: 0.98, z: -1.065 }, { x: 0.92, y: 0.68, z: 0.028 }, frameCol);
    bChrome.box({ x: 0, y: 0.62, z: -1.08 }, { x: 0.94, y: 0.045, z: 0.03 }, trimCol); // rear bumper bar
    for (const sx of [-0.34, 0.34]) {
      bFabric.cylinder({ x: sx, y: 0.62, z: -1.098 }, 0.028, 0.012, '#e52521', { x: Math.PI / 2 }); // red reflectors
    }
    bMetal.box({ x: 0, y: 0.54, z: -1.075 }, { x: 0.20, y: 0.09, z: 0.01 }, '#f4f0de'); // license plate

    const artTex = rickshawArtTexture(look.artMotif, look.artPrimary, look.artSecondary);
    const artMat = new THREE.MeshStandardMaterial({ map: artTex, roughness: 0.46, metalness: 0.12 });
    const artPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.58), artMat);
    artPlate.position.set(0, 1.00, -1.082);
    artPlate.rotation.y = Math.PI;
    this.chassis.add(artPlate);

    // ----------------------- 7. FOLDING BAMBOO-RIBBED HOOD / CANOPY (`হুড`)
    const hoodY = 1.32;
    // Connected cross-sections make one continuous folding canopy. The old
    // overlapping slats left gaps once the head-obscuring side curtains were
    // removed. Thin open-side edging retains the fabric and scissor silhouette.
    const arch = [
      { y: 1.28, z: -1.08 }, { y: 1.45, z: -1.05 },
      { y: 1.60, z: -0.96 }, { y: 1.69, z: -0.79 },
      { y: 1.72, z: -0.58 }, { y: 1.67, z: -0.38 },
      { y: 1.55, z: -0.20 },
    ];
    for (let i = 0; i < arch.length - 1; i++) {
      const a = arch[i], b = arch[i + 1];
      const y = (a.y + b.y) / 2, z = (a.z + b.z) / 2;
      const pitch = -Math.atan2(b.y - a.y, b.z - a.z);
      const length = Math.hypot(b.y - a.y, b.z - a.z) + 0.018;
      bFabric.box({ x: 0, y, z }, { x: 0.98, y: 0.028, z: length }, look.canopyColor, { x: pitch });
      for (const side of [-1, 1]) {
        bFabric.box({ x: side * 0.485, y: y - 0.01, z }, { x: 0.02, y: 0.04, z: length }, look.canopyColor, { x: pitch });
      }
      bChrome.box({ x: 0, y: b.y + 0.018, z: b.z }, { x: 0.995, y: 0.014, z: 0.022 }, trimCol, { x: pitch });
    }
    // Side brass folding-hood scissor arms (authentic Bangladeshi rickshaw hood mechanism!)
    for (const side of [-1, 1]) {
      bChrome.cylinder({ x: side * 0.495, y: hoodY + 0.10, z: -0.94 }, 0.008, 0.42, '#cfd6de', { x: -0.35 });
      bChrome.cylinder({ x: side * 0.495, y: hoodY + 0.14, z: -0.74 }, 0.008, 0.52, '#cfd6de', { x: 0.35 });
      bChrome.cylinder({ x: side * 0.502, y: hoodY - 0.08, z: -0.98 }, 0.018, 0.016, trimCol, { z: Math.PI / 2 });
    }
    if (isRoadster) {
      // Concept Roadster rear wing spoiler!
      bMetal.box({ x: 0, y: 1.76, z: -1.08 }, { x: 1.06, y: 0.028, z: 0.18 }, trimCol, { x: 0.18 });
    }

    // Swinging front scalloped valance + tassels (`ঝালর`)
    this.tasselBar.position.set(0, 1.49, -0.18);
    const bTassel = new Bucket('rickshaw.tassels', fabricMat);
    bTassel.box({ x: 0, y: 0, z: 0 }, { x: 0.98, y: 0.075, z: 0.02 }, trimCol);
    for (let i = -5; i <= 5; i++) {
      const tx = i * 0.085;
      bTassel.cone({ x: tx, y: -0.058, z: 0 }, 0.022, 0.065, i % 2 === 0 ? trimCol : look.canopyColor, {
        x: Math.PI,
      });
      bTassel.cylinder({ x: tx, y: -0.095, z: 0 }, 0.006, 0.035, '#ffe885');
    }
    const tasselMesh = bTassel.build({ cast: false, receive: false }, true);
    if (tasselMesh) this.tasselBar.add(tasselMesh);
    this.chassis.add(this.tasselBar);

    // Emit merged chassis meshes (~4 draw calls for the entire carriage & frame!)
    const cm1 = bMetal.build({ cast: true, receive: true }, true);
    const cm2 = bChrome.build({ cast: false, receive: false }, true);
    const cm3 = bFabric.build({ cast: true, receive: true }, true);
    const cm4 = bWood.build({ cast: false, receive: true }, true);
    if (cm1) this.chassis.add(cm1);
    if (cm2) this.chassis.add(cm2);
    if (cm3) this.chassis.add(cm3);
    if (cm4) this.chassis.add(cm4);

    // Optional fairy-light garland around hood rim (merged into 1 vertex-colored draw call!)
    if (look.fairyLights) {
      const colors = ['#ff5e7e', '#ffd24a', '#4ef2b4', '#5cc8ff'];
      const fairyMat = new THREE.MeshBasicMaterial({ vertexColors: true });
      const bFairy = new Bucket('rickshaw.fairyLights', fairyMat);
      const bulbSrc = new THREE.SphereGeometry(0.5, 6, 6);
      for (let i = 0; i < 12; i++) {
        const t = i / 11;
        bFairy.add(
          bulbSrc,
          { x: -0.46 + t * 0.92, y: 1.54 + Math.sin(t * Math.PI) * 0.06, z: -0.17 },
          { x: 0.042, y: 0.042, z: 0.042 },
          colors[i % colors.length],
        );
      }
      bulbSrc.dispose();
      const fairyMesh = bFairy.build({ cast: false, receive: false }, true);
      if (fairyMesh) this.chassis.add(fairyMesh);
    }

    // ----------------------------------------- 8. RICKSHAWWALLAH / RIVAL CHARACTER RIG
    this.buildPuller(look.character ?? DEFAULT_PLAYER_CHARACTER);
    this.chassis.add(this.puller);

    // Passenger seat mount
    this.passengerMount.position.set(0, 0.82, -0.74);
    this.chassis.add(this.passengerMount);
  }

  private poseMode: DriverPoseMode = 'riding';
  private poseTime = 0;

  setCharacterPose(mode: DriverPoseMode, elapsed = 0): void {
    this.poseMode = mode;
    this.poseTime = elapsed;
  }

  private buildPuller(spec: DriverCharacterSpec): void {
    const mat = getSharedCharacterMaterial();

    // ---- 1. Seated Torso, Collar, Outfit Silhouette & Hip Posture ----
    const bTorso = new Bucket('rickshaw.puller.torso', mat);
    // Seated hips/lungi/pants over leather saddle (0, 1.03, -0.04)
    bTorso.cylinder({ x: 0, y: 1.03, z: -0.01 }, 0.155, 0.22, spec.bottomHex, { x: 0.18 });
    // Main torso leaning forward naturally toward handlebars
    const torsoW = spec.outfitStyle === 'jacket_pants' || spec.outfitStyle === 'raincoat' ? 0.36 : 0.33;
    bTorso.box({ x: 0, y: 1.24, z: 0.03 }, { x: torsoW, y: 0.40, z: 0.21 }, spec.topHex, { x: 0.24 });

    // Distinct outfit details so rivals never look like recolors of one mesh
    if (spec.outfitStyle === 'kurta_gamcha') {
      // Draped checkered/striped gamcha scarf over right shoulder
      bTorso.box({ x: -0.11, y: 1.35, z: 0.07 }, { x: 0.10, y: 0.24, z: 0.25 }, spec.accentHex, {
        x: 0.26,
        z: 0.12,
      });
    } else if (spec.outfitStyle === 'jacket_pants') {
      // Open street-racing jacket lapels + inner shirt chest stripe
      bTorso.box({ x: 0, y: 1.25, z: 0.135 }, { x: 0.11, y: 0.36, z: 0.03 }, spec.accentHex, { x: 0.24 });
      bTorso.box({ x: 0, y: 1.42, z: 0.08 }, { x: 0.24, y: 0.07, z: 0.18 }, spec.accentHex, { x: 0.24 });
    } else if (spec.outfitStyle === 'vest_lungi') {
      // Sleeveless athletic vest straps + bare muscular shoulder caps + waist sash
      bTorso.cylinder({ x: 0.175, y: 1.37, z: 0.07 }, 0.055, 0.09, spec.skinHex, { z: Math.PI / 2 });
      bTorso.cylinder({ x: -0.175, y: 1.37, z: 0.07 }, 0.055, 0.09, spec.skinHex, { z: Math.PI / 2 });
      bTorso.box({ x: 0, y: 1.09, z: 0.02 }, { x: 0.33, y: 0.06, z: 0.23 }, spec.accentHex, { x: 0.2 });
    } else if (spec.outfitStyle === 'jersey_track') {
      // Sport racing chest chevron & racing number stripe on back
      bTorso.box({ x: 0, y: 1.29, z: 0.04 }, { x: 0.345, y: 0.09, z: 0.22 }, spec.accentHex, { x: 0.24 });
    } else if (spec.outfitStyle === 'raincoat') {
      // Monsoon high storm collar + reflective chest tape
      bTorso.cylinder({ x: 0, y: 1.43, z: 0.09 }, 0.115, 0.08, spec.topHex, { x: 0.2 });
      bTorso.box({ x: 0, y: 1.27, z: 0.04 }, { x: 0.365, y: 0.045, z: 0.22 }, spec.accentHex, { x: 0.24 });
    } else if (spec.outfitStyle === 'royal_sherwani') {
      // Champion gold-trimmed high collar & shoulder epaulettes
      bTorso.cylinder({ x: 0, y: 1.43, z: 0.09 }, 0.105, 0.07, spec.accentHex, { x: 0.18 });
      for (const sx of [-0.17, 0.17]) {
        bTorso.box({ x: sx, y: 1.41, z: 0.08 }, { x: 0.09, y: 0.035, z: 0.12 }, spec.accentHex, { x: 0.24 });
      }
    }

    const torsoMesh = bTorso.build({ cast: true, receive: false }, true);
    if (torsoMesh) {
      torsoMesh.name = 'pullerBody';
      this.puller.add(torsoMesh);
    }

    // ---- 2. Sculpted Head with Visible Eyes, Eyebrows, Nose, Mouth & Distinct Hair/Headwear ----
    const headGroup = new THREE.Group();
    headGroup.name = 'pullerHead';
    headGroup.position.set(0, 1.45, 0.11);

    const bHead = new Bucket('rickshaw.puller.head', mat);
    // Neck + sculpted head + jaw + ears + nose bridge (+Z = front face)
    bHead.cylinder({ x: 0, y: 0.015, z: -0.01 }, 0.052, 0.08, spec.skinHex);
    bHead.cylinder({ x: 0, y: 0.105, z: 0 }, 0.094, 0.175, spec.skinHex);
    bHead.box({ x: 0, y: 0.068, z: 0.022 }, { x: 0.135, y: 0.085, z: 0.135 }, spec.skinHex);
    for (const sx of [-1, 1]) {
      bHead.box({ x: sx * 0.094, y: 0.102, z: -0.004 }, { x: 0.024, y: 0.048, z: 0.032 }, spec.skinHex);
    }
    // Nose bridge
    bHead.box({ x: 0, y: 0.098, z: 0.094 }, { x: 0.024, y: 0.042, z: 0.026 }, spec.skinHex, { x: -0.18 });

    // Eyes (white sclera + dark pupils)
    for (const sx of [-1, 1]) {
      bHead.box({ x: sx * 0.036, y: 0.116, z: 0.088 }, { x: 0.030, y: 0.018, z: 0.012 }, '#f8fafc');
      bHead.box({ x: sx * 0.035, y: 0.116, z: 0.093 }, { x: 0.015, y: 0.015, z: 0.010 }, '#111827');
      // Expressive eyebrows
      const browTilt =
        spec.expression === 'fierce'
          ? sx * 0.28
          : spec.expression === 'determined'
            ? sx * 0.16
            : spec.expression === 'grin'
              ? -sx * 0.10
              : 0;
      bHead.box(
        { x: sx * 0.038, y: 0.136, z: 0.091 },
        { x: 0.036, y: 0.009, z: 0.012 },
        spec.hairHex,
        { z: browTilt },
      );
    }

    // Mouth with readable expression
    if (spec.expression === 'grin') {
      bHead.box({ x: 0, y: 0.064, z: 0.090 }, { x: 0.052, y: 0.016, z: 0.012 }, '#4a1d1f');
      bHead.box({ x: 0, y: 0.066, z: 0.094 }, { x: 0.042, y: 0.008, z: 0.008 }, '#f8fafc');
    } else if (spec.expression === 'fierce') {
      bHead.box({ x: 0, y: 0.063, z: 0.091 }, { x: 0.046, y: 0.011, z: 0.012 }, '#3b1818', { z: 0.09 });
    } else {
      bHead.box({ x: 0, y: 0.064, z: 0.091 }, { x: 0.044, y: 0.010, z: 0.012 }, '#4a201e');
    }

    // Optional eyewear (aviator shades / sport visor)
    if (spec.eyewear === 'aviator') {
      for (const sx of [-1, 1]) {
        bHead.box({ x: sx * 0.038, y: 0.116, z: 0.098 }, { x: 0.038, y: 0.024, z: 0.010 }, '#0f172a');
      }
      bHead.box({ x: 0, y: 0.122, z: 0.099 }, { x: 0.088, y: 0.005, z: 0.008 }, '#facc15');
    } else if (spec.eyewear === 'sport_visor') {
      bHead.box({ x: 0, y: 0.118, z: 0.097 }, { x: 0.105, y: 0.024, z: 0.014 }, spec.accentHex);
    }

    // Back/side hair base so hairline never looks bald unless designed
    bHead.cylinder({ x: 0, y: 0.148, z: -0.012 }, 0.098, 0.085, spec.hairHex);
    bHead.box({ x: 0, y: 0.115, z: -0.055 }, { x: 0.175, y: 0.11, z: 0.08 }, spec.hairHex);

    // 10 Distinct Hair / Headwear Silhouettes
    switch (spec.hairStyle) {
      case 'bandana': {
        bHead.cylinder({ x: 0, y: 0.158, z: 0 }, 0.103, 0.055, spec.headwearHex);
        // Streaming knotted bandana tails at back!
        bHead.box({ x: 0.02, y: 0.135, z: -0.115 }, { x: 0.035, y: 0.028, z: 0.09 }, spec.headwearHex, { x: -0.45 });
        bHead.box({ x: -0.02, y: 0.125, z: -0.11 }, { x: 0.032, y: 0.025, z: 0.085 }, spec.accentHex, { x: -0.65 });
        break;
      }
      case 'peaked_cap': {
        bHead.cylinder({ x: 0, y: 0.172, z: 0 }, 0.102, 0.068, spec.headwearHex);
        bHead.box({ x: 0, y: 0.148, z: 0.105 }, { x: 0.145, y: 0.014, z: 0.095 }, spec.accentHex, { x: 0.14 });
        break;
      }
      case 'curly': {
        for (const [ox, oy, oz] of [
          [0, 0.195, 0.01],
          [-0.055, 0.18, 0.02],
          [0.055, 0.18, 0.02],
          [0, 0.185, -0.045],
        ]) {
          bHead.cylinder({ x: ox, y: oy, z: oz }, 0.062, 0.058, spec.hairHex);
        }
        break;
      }
      case 'headband': {
        bHead.cylinder({ x: 0, y: 0.148, z: 0.004 }, 0.103, 0.034, spec.headwearHex);
        bHead.cone({ x: 0, y: 0.215, z: 0.01 }, 0.088, 0.085, spec.hairHex);
        break;
      }
      case 'pagri_wrap': {
        // Traditional twisted cloth pagri / gamcha turban
        bHead.cylinder({ x: 0, y: 0.175, z: -0.005 }, 0.118, 0.088, spec.headwearHex, { z: 0.08 });
        bHead.cylinder({ x: 0, y: 0.205, z: 0.01 }, 0.098, 0.055, spec.accentHex, { z: -0.1 });
        break;
      }
      case 'spiky': {
        bHead.cylinder({ x: 0, y: 0.146, z: 0.004 }, 0.102, 0.03, spec.headwearHex);
        for (let s = -1; s <= 1; s++) {
          bHead.cone({ x: s * 0.038, y: 0.22, z: 0.015 - Math.abs(s) * 0.015 }, 0.048, 0.095, spec.hairHex, {
            x: 0.18,
            z: -s * 0.22,
          });
        }
        break;
      }
      case 'bucket_hat': {
        bHead.cylinder({ x: 0, y: 0.152, z: 0 }, 0.142, 0.018, spec.headwearHex, { x: 0.06 });
        bHead.cylinder({ x: 0, y: 0.186, z: 0 }, 0.098, 0.068, spec.headwearHex);
        bHead.cylinder({ x: 0, y: 0.165, z: 0 }, 0.101, 0.02, spec.accentHex);
        break;
      }
      case 'ponytail_bun': {
        bHead.cylinder({ x: 0, y: 0.168, z: 0.005 }, 0.099, 0.062, spec.hairHex);
        bHead.cylinder({ x: 0, y: 0.148, z: 0.008 }, 0.102, 0.026, spec.headwearHex);
        // Sleek tied back bun / ponytail!
        bHead.cylinder({ x: 0, y: 0.145, z: -0.115 }, 0.048, 0.075, spec.hairHex, { x: -0.7 });
        break;
      }
      case 'crown_bandana': {
        // #1 Champion gold-trimmed crown headband + flowing tail
        bHead.cylinder({ x: 0, y: 0.155, z: 0.004 }, 0.105, 0.044, spec.headwearHex);
        bHead.cone({ x: 0, y: 0.195, z: 0.085 }, 0.032, 0.055, spec.accentHex);
        bHead.box({ x: 0, y: 0.13, z: -0.115 }, { x: 0.045, y: 0.03, z: 0.095 }, spec.accentHex, { x: -0.5 });
        break;
      }
      case 'topi':
      default: {
        bHead.cylinder({ x: 0, y: 0.175, z: 0 }, 0.099, 0.062, spec.headwearHex);
        break;
      }
    }

    const headMesh = bHead.build({ cast: false, receive: false }, true);
    if (headMesh) headGroup.add(headMesh);
    this.puller.add(headGroup);

    // ---- 3. Two articulated shoulder -> elbow -> grip chains ----
    // Each visible segment has a single source. The old, baked Euler angles
    // pointed the cylinders away from one another and made two floating fists.
    const sleeveCol = spec.outfitStyle === 'vest_lungi' ? spec.skinHex : spec.topHex;
    const upperCol = spec.outfitStyle === 'jacket_pants' || spec.outfitStyle === 'raincoat' || spec.outfitStyle === 'royal_sherwani'
      ? sleeveCol : spec.skinHex;
    for (const side of [1, -1] as const) {
      const arm = new THREE.Group();
      arm.name = side === 1 ? 'leftArm' : 'rightArm';
      const makeSegment = (name: string, radius: number, color: string): THREE.Mesh => {
        const bucket = new Bucket(name, mat);
        // Unit-height cylinder; its transform is updated to the actual endpoints.
        bucket.cylinder({ x: 0, y: 0, z: 0 }, radius, 1, color);
        const mesh = bucket.build({ cast: false, receive: false }, true)!;
        mesh.name = name;
        return mesh;
      };
      const upper = makeSegment('upperArm', 0.038, upperCol);
      const fore = makeSegment('foreArm', 0.032, spec.skinHex);
      const handBucket = new Bucket('driver.hand', mat);
      handBucket.box({ x: 0, y: 0, z: 0 }, { x: 0.060, y: 0.055, z: 0.082 }, spec.skinHex);
      const hand = handBucket.build({ cast: false, receive: false }, true)!;
      hand.name = 'gripHand';
      arm.add(upper, fore, hand);
      this.puller.add(arm);
      this.driverArms.push({ side, upper, fore, hand });
    }
    this.positionDriverArms(0);

    // ---- 4. Articulated Legs + Visible Sandals/Shoes ----
    for (const side of [1, -1] as const) {
      const legGroup = new THREE.Group();
      legGroup.name = side === 1 ? 'leftLeg' : 'rightLeg';
      legGroup.position.set(side * 0.105, 0.72, 0.05);

      const bLeg = new Bucket(`rickshaw.puller.leg.${side > 0 ? 'L' : 'R'}`, mat);
      const calfCol = spec.outfitStyle === 'vest_lungi' || spec.outfitStyle === 'kurta_gamcha' ? spec.skinHex : spec.bottomHex;
      bLeg.cylinder({ x: 0, y: 0.11, z: -0.02 }, 0.054, 0.22, spec.bottomHex, { x: -0.12 });
      bLeg.cylinder({ x: 0, y: -0.09, z: 0.01 }, 0.042, 0.23, calfCol);
      // Visible foot + sandal/shoe resting on pedal/footboard
      bLeg.box({ x: 0, y: -0.215, z: 0.048 }, { x: 0.068, y: 0.036, z: 0.135 }, '#231f20');
      bLeg.box({ x: 0, y: -0.195, z: 0.035 }, { x: 0.060, y: 0.024, z: 0.095 }, spec.skinHex);

      const legMesh = bLeg.build({ cast: false, receive: false }, true);
      if (legMesh) legGroup.add(legMesh);
      this.puller.add(legGroup);
    }
  }

  private positionArmSegment(mesh: THREE.Mesh, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    this.armDirection.set(bx - ax, by - ay, bz - az);
    const length = this.armDirection.length();
    if (length < 1e-6) return;
    mesh.position.set((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
    mesh.scale.set(1, length, 1);
    mesh.quaternion.setFromUnitVectors(this.armUp, this.armDirection.multiplyScalar(1 / length));
  }

  /** Recompute connected limbs from the fixed shoulders to the rotating grips. */
  private positionDriverArms(steeringYaw: number): void {
    const c = Math.cos(steeringYaw);
    const s = Math.sin(steeringYaw);
    for (const arm of this.driverArms) {
      const side = arm.side;
      const sx = side * 0.185, sy = 1.38, sz = 0.08;
      // Grip coordinates are in the steering group's local frame.
      let gx = c * (side * 0.275) + s * -0.195;
      let gy = 1.17;
      let gz = RIDE.frontAxleZ - s * (side * 0.275) + c * -0.195;
      if (this.poseMode === 'victory' && side === -1) {
        gx = -0.27;
        gy = 1.72 + Math.sin(this.poseTime * 3.2) * 0.025;
        gz = 0.16;
      }
      const ex = (sx + gx) * 0.5 + side * 0.045;
      const ey = (sy + gy) * 0.5 - 0.025;
      const ez = (sz + gz) * 0.5 - 0.025;
      this.positionArmSegment(arm.upper, sx, sy, sz, ex, ey, ez);
      // Terminate the forearm inside the hand, never in a separate visible cap.
      this.positionArmSegment(arm.fore, ex, ey, ez, gx, gy, gz);
      arm.hand.position.set(gx, gy, gz);
      arm.hand.rotation.set(0, steeringYaw, 0);
    }
  }

  /** Hide rider torso/head only during cockpit over-handlebar camera so view is unobstructed. */
  setCockpitVisibility(inCockpit: boolean): void {
    this.puller.visible = !inCockpit;
  }

  /** Animate wheels, steering fork, pedals, puller legs, and hood tassels. */
  applyDynamics(opts: {
    steerAngle: number;
    wheelSpin: number;
    pedalPhase: number;
    roll: number;
    pitch: number;
    nightFactor: number;
  }): void {
    // CRITICAL STEERING SIGN:
    // Left input -> steerAngle < 0 -> steering.rotation.y = -steerAngle > 0 (CCW = LEFT!).
    // Right input -> steerAngle > 0 -> steering.rotation.y = -steerAngle < 0 (CW = RIGHT!).
    this.steering.rotation.y = -opts.steerAngle;

    this.frontWheel.rotation.x = opts.wheelSpin * (this.rearWheelRadius / this.frontWheelRadius);
    this.rearWheels[0].rotation.x = opts.wheelSpin;
    this.rearWheels[1].rotation.x = opts.wheelSpin;

    if (!this.isElectric) {
      this.crank.rotation.x = opts.pedalPhase;
    }

    // Subtle body pitch/roll lives on root ('YXZ') via controller; add gentle secondary suspension compliance + tassel sway
    this.chassis.rotation.z = opts.roll * 0.22;
    this.tasselBar.rotation.z = -opts.roll * 1.6;
    this.tasselBar.rotation.x = clampVal(-opts.pitch * 1.2, -0.25, 0.25);

    const ll = this.puller.getObjectByName('leftLeg');
    const rl = this.puller.getObjectByName('rightLeg');
    if (ll && rl) {
      if (this.isElectric) {
        // Relaxed footrest stance on electric rickshaw
        ll.position.y = 0.71;
        rl.position.y = 0.71;
        ll.rotation.x = 0.32;
        rl.rotation.x = 0.32;
      } else {
        const s = Math.sin(opts.pedalPhase);
        ll.position.y = 0.72 + s * 0.075;
        rl.position.y = 0.72 - s * 0.075;
        ll.rotation.x = Math.cos(opts.pedalPhase) * 0.24;
        rl.rotation.x = -Math.cos(opts.pedalPhase) * 0.24;
      }
    }

    this.positionDriverArms(this.steering.rotation.y);
    const hd = this.puller.getObjectByName('pullerHead');
    if (hd) {
      if (this.poseMode === 'victory') {
        hd.rotation.set(-0.08, 0.32 + Math.sin(this.poseTime * 1.8) * 0.08, 0);
      } else if (this.poseMode === 'intro') {
        hd.rotation.set(Math.sin(this.poseTime * 2.2) * 0.05, -0.22 + Math.sin(this.poseTime * 1.1) * 0.14, 0);
      } else {
        hd.rotation.set(clampVal(-opts.pitch * 0.35, -0.14, 0.14), -opts.steerAngle * 0.45, -opts.roll * 0.35);
      }
    }

    if (this.headlampLight) {
      this.headlampLight.intensity = opts.nightFactor * (this.isElectric ? 3.1 : 2.3);
    }
    if (this.fairyBulbMaterials.length > 0) {
      const em = 0.45 + opts.nightFactor * 1.45;
      for (const m of this.fairyBulbMaterials) m.emissiveIntensity = em;
    }
  }

  get currentLook(): RickshawLook {
    return this.look;
  }

  /**
   * Cleanly release rig-owned geometries & materials WITHOUT disposing shared
   * `wheelCache` buffers or cached `rickshawArtTexture`!
   */
  dispose(): void {
    const disposedGeo = new Set<THREE.BufferGeometry>();
    const disposedMat = new Set<THREE.Material>();
    this.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        if (!obj.geometry.userData?.shared && !disposedGeo.has(obj.geometry)) {
          disposedGeo.add(obj.geometry);
          obj.geometry.dispose();
        }
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (!m.userData?.shared && !disposedMat.has(m)) {
            disposedMat.add(m);
            m.dispose();
          }
        }
      }
    });
  }
}

function clampVal(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

import { cosmeticById, type CosmeticCategory, type VehicleDef } from '../economy/catalog';

export function lookFrom(
  vehicle: VehicleDef,
  equipped: Partial<Record<CosmeticCategory, string>>,
  _legacyGetter?: unknown,
  upgrades?: Record<string, number>,
): RickshawLook {
  const paint = equipped.paint ? cosmeticById(equipped.paint) : undefined;
  const art = equipped.art ? cosmeticById(equipped.art) : undefined;
  const tassel = equipped.tassel ? cosmeticById(equipped.tassel) : undefined;
  const bell = equipped.bell ? cosmeticById(equipped.bell) : undefined;
  const flowers = equipped.flowers ? cosmeticById(equipped.flowers) : undefined;
  const mirror = equipped.mirror ? cosmeticById(equipped.mirror) : undefined;

  return {
    frameColor: paint?.value ?? vehicle.palette.body,
    canopyColor: vehicle.palette.canopy,
    canopyTrim: tassel?.value ?? paint?.swatch[1] ?? vehicle.palette.trim,
    wheelTrim: '#dce3ea',
    artMotif: art?.value ?? 'floral',
    artPrimary: art?.swatch[0] ?? vehicle.palette.panel,
    artSecondary: art?.swatch[1] ?? vehicle.palette.trim,
    fairyLights: (upgrades?.lights ?? 0) >= 2 || vehicle.kind === 'electric',
    bellUpgrade: !!bell && bell.value !== 'classic',
    bell: bell?.value ?? 'classic',
    mirrorSet: !!mirror || vehicle.kind === 'electric',
    flowersColor: flowers?.value ?? null,
    kind: vehicle.kind,
  };
}

/**
 * High-level stateful visual wrapper around `RickshawRig` consumed by `Game`
 * and `Showroom`. Supports live look/vehicle hot-swapping without leaking
 * passenger seat anchors or shared textures.
 */
export class RickshawVisual {
  rig: RickshawRig;
  readonly root = new THREE.Group();
  readonly seatAnchor = new THREE.Group();
  private vehicle: VehicleDef;
  private lookKey = '';
  private wheelSpin = 0;
  private pedalPhase = 0;
  private nightFactor = 0;
  private isPlayer: boolean;

  constructor(vehicle: VehicleDef, look: RickshawLook, isPlayer = true) {
    this.vehicle = vehicle;
    this.isPlayer = isPlayer;
    this.root.name = 'rickshaw-visual';
    this.root.rotation.order = 'YXZ';
    this.rig = new RickshawRig({ ...look, kind: vehicle.kind }, { isPlayer });
    this.root.add(this.rig.root);
    this.rig.passengerMount.add(this.seatAnchor);
    this.lookKey = this.computeKey(vehicle, look);
  }

  private computeKey(vehicle: VehicleDef, look: RickshawLook): string {
    return JSON.stringify({ id: vehicle.id, kind: vehicle.kind, ...look });
  }

  applyLook(look: RickshawLook, vehicle = this.vehicle): void {
    const nextKey = this.computeKey(vehicle, look);
    if (nextKey === this.lookKey) return;
    this.vehicle = vehicle;
    this.lookKey = nextKey;
    this.rig.passengerMount.remove(this.seatAnchor);
    this.root.remove(this.rig.root);
    this.rig.dispose();
    this.rig = new RickshawRig({ ...look, kind: vehicle.kind }, { isPlayer: this.isPlayer });
    this.root.add(this.rig.root);
    this.rig.passengerMount.add(this.seatAnchor);
  }

  setCockpitVisibility(inCockpit: boolean): void {
    this.rig.setCockpitVisibility(inCockpit);
  }

  setCharacterPose(mode: DriverPoseMode, elapsed = 0): void {
    this.rig.setCharacterPose(mode, elapsed);
  }

  setNightLighting(on: boolean, intensity = 1): void {
    this.nightFactor = on ? intensity : 0;
    if (this.rig.headlampLight) {
      this.rig.headlampLight.intensity = this.nightFactor * (this.rig.currentLook.kind === 'electric' ? 3.1 : 2.3);
    }
  }

  updateVisual(
    dt: number,
    speed: number,
    steerAngleOrInput: number,
    throttle: number,
    lateralAccel: number,
    _groundY = 0,
    pitch = 0,
  ): void {
    this.wheelSpin += (speed * dt) / this.rig.rearWheelRadius;
    if (throttle > 0.02 || Math.abs(speed) > 0.15) {
      this.pedalPhase += dt * Math.max(0, speed) * 2.1;
    }
    const roll = clampVal(-lateralAccel * 0.015, -0.09, 0.09);
    this.rig.applyDynamics({
      steerAngle: steerAngleOrInput,
      wheelSpin: this.wheelSpin,
      pedalPhase: this.pedalPhase,
      roll,
      pitch,
      nightFactor: this.nightFactor,
    });
  }

  dispose(): void {
    this.rig.passengerMount.remove(this.seatAnchor);
    this.rig.dispose();
  }
}

