/**
 * Arcade-simulation rickshaw controller (v0.5.0 overhaul).
 * Deliberately engine-free (no three.js) so the whole driving, OBB collision,
 * `টান`, and hold-to-boost `টার্বো` model is deterministic and unit-tested in Node.
 *
 * Coordinate convention (Three.js right-handed world, +Y up):
 *   - Vehicle faces local +Z -> world forward = (sin(yaw), 0, cos(yaw))
 *   - Vehicle right side      = forward x up  = (-cos(yaw), 0, sin(yaw))
 *   - Vehicle left side       = up x forward  = ( cos(yaw), 0, -sin(yaw))
 *   - Input steer: -1 = LEFT, +1 = RIGHT
 *   - Steering RIGHT (steer > 0, speed > 0) decreases yaw (yawRate < 0);
 *     steering LEFT  (steer < 0, speed > 0) increases yaw (yawRate > 0).
 */

import { RIDE, TURBO } from '../core/config';
import { clamp, clamp01, lerp, moveTowards, TAU } from '../core/mathx';

export interface BoxCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  disabled?: boolean;
  breakableId?: number;
  /** Optional oriented bounding box (OBB) in XZ; falls back to AABB when omitted. */
  cx?: number;
  cz?: number;
  halfX?: number;
  halfZ?: number;
  yaw?: number;
  /** Internal stamp for allocation-free spatial grid deduplication. */
  _stamp?: number;
}

export interface DriveInput {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  /** Hold-to-boost `টার্বো`: active ONLY while held (`true`). */
  turbo?: boolean;
}

export interface DriveTuning {
  maxSpeed: number;
  accel: number;
  brakeDecel: number;
  steerMaxLow: number;
  steerMaxHigh: number;
  steerRateMultiplier?: number;
  grip: number;
  roughSurfaceKeep?: number;
  rollingDragScale?: number;
  isElectric?: boolean;
  batteryDrainMultiplier?: number;
  regenFactor?: number;
  turboDrainMultiplier?: number;
  turboRechargeMultiplier?: number;
  suspensionSmoothing?: number;
}

/** Bounded impact amplitude shared by wheel types; 0 at rest or off the hole. */
export function potholeWheelImpulse(speed: number, depth: number, suspension: number, massScale = 1): number {
  if (!Number.isFinite(speed) || !Number.isFinite(depth) || depth <= 0) return 0;
  return clamp(Math.abs(speed) / 8, 0, 1.4) * clamp(depth / 0.065, 0, 1) *
    (1 - clamp(suspension, 0, 1) * 0.55) * clamp(massScale, 0.5, 1.4);
}

export interface StepEvents {
  /** Collision impulse magnitude (0 = none). */
  impact: number;
  impactX: number;
  impactZ: number;
  contactX: number;
  contactZ: number;
  distance: number;
  /** True when the wheels are on a raised footpath. */
  onSidewalk: boolean;
  stuck: boolean;
  roughBump: number;
}

export interface ContactDebugInfo {
  active: boolean;
  x: number;
  z: number;
  nx: number;
  nz: number;
  magnitude: number;
}

export interface ObbHitResult {
  hit: boolean;
  pushX: number;
  pushZ: number;
  nx: number;
  nz: number;
  contactX: number;
  contactZ: number;
  penetration: number;
}

const SHARED_HIT: ObbHitResult = {
  hit: false,
  pushX: 0,
  pushZ: 0,
  nx: 0,
  nz: 0,
  contactX: 0,
  contactZ: 0,
  penetration: 0,
};

/**
 * Pure, zero-allocation circle-vs-OBB contact test in world XZ.
 * OBB local +X = (cos(yaw), -sin(yaw)) with half-extent `halfX` (width),
 * OBB local +Z = (sin(yaw),  cos(yaw)) with half-extent `halfZ` (length).
 */
export function testCircleVsObb(
  px: number,
  pz: number,
  radius: number,
  cx: number,
  cz: number,
  halfX: number,
  halfZ: number,
  yaw: number,
  out: ObbHitResult = SHARED_HIT,
): ObbHitResult {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const wx = px - cx;
  const wz = pz - cz;
  const lx = wx * c - wz * s;
  const lz = wx * s + wz * c;

  const clx = clamp(lx, -halfX, halfX);
  const clz = clamp(lz, -halfZ, halfZ);
  let dlx = lx - clx;
  let dlz = lz - clz;
  const distSq = dlx * dlx + dlz * dlz;
  if (distSq >= radius * radius) {
    out.hit = false;
    out.penetration = 0;
    return out;
  }

  let lnx = 0;
  let lnz = 0;
  let pen = 0;
  let contactLx = clx;
  let contactLz = clz;

  if (distSq > 1e-8) {
    const dist = Math.sqrt(distSq);
    lnx = dlx / dist;
    lnz = dlz / dist;
    pen = radius - dist;
  } else {
    // Circle centre is inside the OBB: push out along shallowest face.
    const toNegX = lx + halfX;
    const toPosX = halfX - lx;
    const toNegZ = lz + halfZ;
    const toPosZ = halfZ - lz;
    const minEdge = Math.min(toNegX, toPosX, toNegZ, toPosZ);
    if (minEdge === toNegX) {
      lnx = -1;
      contactLx = -halfX;
      pen = radius + toNegX;
    } else if (minEdge === toPosX) {
      lnx = 1;
      contactLx = halfX;
      pen = radius + toPosX;
    } else if (minEdge === toNegZ) {
      lnz = -1;
      contactLz = -halfZ;
      pen = radius + toNegZ;
    } else {
      lnz = 1;
      contactLz = halfZ;
      pen = radius + toPosZ;
    }
  }

  const nx = lnx * c + lnz * s;
  const nz = -lnx * s + lnz * c;
  out.hit = true;
  out.nx = nx;
  out.nz = nz;
  out.penetration = pen;
  out.pushX = nx * (pen + 0.008);
  out.pushZ = nz * (pen + 0.008);
  out.contactX = cx + contactLx * c + contactLz * s;
  out.contactZ = cz - contactLx * s + contactLz * c;
  return out;
}

/**
 * Pure, zero-allocation Two-Circle Rickshaw Capsule vs OBB test.
 * Matches the actual narrow front wheel/frame + wider rear axle footprint
 * (~1.00m wide × ~1.84m long) so close passes beside buses/cars/stalls never
 * hit invisible air.
 */
const TMP_FRONT: ObbHitResult = {
  hit: false,
  pushX: 0,
  pushZ: 0,
  nx: 0,
  nz: 0,
  contactX: 0,
  contactZ: 0,
  penetration: 0,
};
const TMP_REAR: ObbHitResult = {
  hit: false,
  pushX: 0,
  pushZ: 0,
  nx: 0,
  nz: 0,
  contactX: 0,
  contactZ: 0,
  penetration: 0,
};

export function testRickshawCapsuleVsObb(
  rx: number,
  rz: number,
  ryaw: number,
  cx: number,
  cz: number,
  halfX: number,
  halfZ: number,
  cyaw: number,
  out: ObbHitResult = SHARED_HIT,
): ObbHitResult {
  // Fast bounding-sphere reject before trig
  const dx = rx - cx;
  const dz = rz - cz;
  const maxReach = 0.98 + Math.hypot(halfX, halfZ);
  if (dx * dx + dz * dz > maxReach * maxReach) {
    out.hit = false;
    out.penetration = 0;
    return out;
  }

  const fx = Math.sin(ryaw);
  const fz = Math.cos(ryaw);
  const fHit = testCircleVsObb(
    rx + fx * RIDE.frontCircleZ,
    rz + fz * RIDE.frontCircleZ,
    0.47,
    cx,
    cz,
    halfX,
    halfZ,
    cyaw,
    TMP_FRONT,
  );
  const rHit = testCircleVsObb(
    rx + fx * RIDE.rearCircleZ,
    rz + fz * RIDE.rearCircleZ,
    RIDE.circleRadius,
    cx,
    cz,
    halfX,
    halfZ,
    cyaw,
    TMP_REAR,
  );

  if (!fHit.hit && !rHit.hit) {
    out.hit = false;
    out.penetration = 0;
    return out;
  }
  const best = fHit.hit && (!rHit.hit || fHit.penetration >= rHit.penetration) ? fHit : rHit;
  out.hit = true;
  out.pushX = best.pushX;
  out.pushZ = best.pushZ;
  out.nx = best.nx;
  out.nz = best.nz;
  out.contactX = best.contactX;
  out.contactZ = best.contactZ;
  out.penetration = best.penetration;
  return out;
}

/** Lightweight 16m spatial hash grid for static world colliders (zero per-step allocations). */
class StaticColliderGrid {
  private readonly cellSize = 16;
  private readonly buckets = new Map<number, BoxCollider[]>();
  private stampCounter = 1;
  readonly queryResult: BoxCollider[] = [];

  rebuild(colliders: readonly BoxCollider[]): void {
    this.buckets.clear();
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (c.height < 0.35) continue;
      const gx0 = Math.floor(c.minX / this.cellSize);
      const gx1 = Math.floor(c.maxX / this.cellSize);
      const gz0 = Math.floor(c.minZ / this.cellSize);
      const gz1 = Math.floor(c.maxZ / this.cellSize);
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gz = gz0; gz <= gz1; gz++) {
          const key = ((gx + 2048) << 12) | ((gz + 2048) & 0xfff);
          let arr = this.buckets.get(key);
          if (!arr) {
            arr = [];
            this.buckets.set(key, arr);
          }
          arr.push(c);
        }
      }
    }
  }

  queryNear(x: number, z: number, reach: number): readonly BoxCollider[] {
    this.stampCounter = (this.stampCounter + 1) & 0x3fffffff;
    const stamp = this.stampCounter;
    let count = 0;
    const gx0 = Math.floor((x - reach) / this.cellSize);
    const gx1 = Math.floor((x + reach) / this.cellSize);
    const gz0 = Math.floor((z - reach) / this.cellSize);
    const gz1 = Math.floor((z + reach) / this.cellSize);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const key = ((gx + 2048) << 12) | ((gz + 2048) & 0xfff);
        const arr = this.buckets.get(key);
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const c = arr[i];
          if (c._stamp === stamp) continue;
          c._stamp = stamp;
          this.queryResult[count++] = c;
        }
      }
    }
    this.queryResult.length = count;
    return this.queryResult;
  }
}

export type SurfaceSampler = (x: number, z: number) => 'road' | 'sidewalk' | 'offroad';
export type HeightSampler = (x: number, z: number) => number;

export class RickshawController {
  x = 0;
  z = 0;
  yaw = 0;
  speed = 0;
  /** Signed front-wheel steer angle in rad: < 0 = LEFT, > 0 = RIGHT. */
  steerAngle = 0;
  y = 0;
  /** Ground-aligned pitch for Three.js YXZ Euler (< 0 = nose up, > 0 = nose down). */
  pitch = 0;
  /** Additional chassis weight-transfer pitch offset from acceleration/braking/Turbo. */
  bodyPitchOffset = 0;
  roll = 0;
  lateralAccel = 0;
  /** Lateral slip velocity (m/s) along vehicle right axis; damped by dry/wet tyre grip. */
  lateralSlip = 0;
  acceleration = 0;
  frontHeight = 0;
  rearHeight = 0;
  distanceDriven = 0;
  reverseTimer = 0;
  stuckTimer = 0;
  stuck = false;
  /** Battery charge 0..100 for Electric Rickshaw (100 on pedal rickshaws). */
  battery = 100;
  /** Pedal driver stamina 0..100 for `টান` boost on pedal rickshaws. */
  stamina = 100;
  /** True while `টান` speed boost toggle is engaged. */
  tanActive = false;
  tanBlend = 0;
  /** Separate hold-to-boost `টার্বো` charge 0..100 (never drains stamina or battery). */
  turboCharge = 100;
  /** True ONLY while `টার্বো` input is actively held and charge > 0. */
  turboActive = false;
  turboBlend = 0;
  /** Temporary speed/handling penalty after a road-rage street scuffle (seconds). */
  scufflePenaltyTimer = 0;
  /** Brief fast-recovery post-crash steering/momentum settle timer (seconds). */
  crashRecoveryTimer = 0;

  readonly lastContact: ContactDebugInfo = {
    active: false,
    x: 0,
    z: 0,
    nx: 0,
    nz: 0,
    magnitude: 0,
  };

  onBreakableHit?: (
    breakableId: number,
    impactSpeed: number,
    x: number,
    z: number,
    yaw: number,
  ) => boolean;
  onTanAutoStop?: (reason: 'stamina' | 'battery') => void;
  onTurboStateChange?: (active: boolean, reason: 'engage' | 'release' | 'empty') => void;

  private spatialGrid = new StaticColliderGrid();
  private indexedColliderCount = -1;
  private stuckWindow = 0;
  private stuckTravelled = 0;
  lastImpact = 0;
  onSidewalk = false;
  /** Total collisions this trip (used for mission quality). */
  hits = 0;
  /** Hard braking events this trip. */
  hardBrakes = 0;

  private prevSpeed = 0;
  private prevFrontHeight = 0;
  private potholeContacts = [false, false, false];
  private potholeWheelX = new Float64Array(3);
  private potholeWheelZ = new Float64Array(3);
  private stuckAnchorX = 0;
  private stuckAnchorZ = 0;
  private tuning: DriveTuning = {
    maxSpeed: RIDE.maxSpeed,
    accel: RIDE.accel,
    brakeDecel: RIDE.brakeDecel,
    steerMaxLow: RIDE.maxSteerLow,
    steerMaxHigh: RIDE.maxSteerHigh,
    steerRateMultiplier: 1,
    grip: 0.7,
    roughSurfaceKeep: 0.84,
    rollingDragScale: 1,
    isElectric: false,
    batteryDrainMultiplier: 1,
    regenFactor: 0,
    turboDrainMultiplier: 1,
    turboRechargeMultiplier: 1,
    suspensionSmoothing: 0,
  };

  constructor(
    private colliders: BoxCollider[],
    private heightAt: HeightSampler,
    private surfaceAt: SurfaceSampler,
    private potholeDepthAt: (x: number, z: number) => number = () => 0,
  ) {
    this.rebuildSpatialGrid();
  }

  setTuning(t: DriveTuning): void {
    this.tuning = { ...this.tuning, ...t };
  }

  setColliders(colliders: BoxCollider[]): void {
    this.colliders = colliders;
    this.rebuildSpatialGrid();
  }

  getStaticColliders(): readonly BoxCollider[] {
    return this.colliders;
  }

  private rebuildSpatialGrid(): void {
    if (this.colliders.length > 24) {
      this.spatialGrid.rebuild(this.colliders);
    }
    this.indexedColliderCount = this.colliders.length;
  }

  rechargeBattery(amount = 100): void {
    this.battery = clamp(this.battery + amount, 0, 100);
  }

  restoreStamina(amount = 100): void {
    this.stamina = clamp(this.stamina + amount, 0, 100);
  }

  addTurboCharge(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.turboCharge = clamp(this.turboCharge + amount, 0, 100);
  }

  /** Immediately stop hold-to-boost Turbo (called on pause, menu, modal, or touch cancel). */
  forceStopTurbo(): void {
    if (this.turboActive) {
      this.turboActive = false;
      this.onTurboStateChange?.(false, 'release');
    }
    this.turboBlend = 0;
  }

  /**
   * Toggle or set `টান` speed boost. Returns `true` if `টান` is now active.
   */
  setTanActive(active: boolean): boolean {
    if (!active) {
      this.tanActive = false;
      return false;
    }
    if (this.tuning.isElectric) {
      if (this.battery <= 2.5) {
        this.tanActive = false;
        return false;
      }
    } else if (this.stamina < 12) {
      this.tanActive = false;
      return false;
    }
    this.tanActive = true;
    return true;
  }

  applyScufflePenalty(): void {
    this.scufflePenaltyTimer = 4.0;
    this.tanActive = false;
    this.forceStopTurbo();
    if (this.tuning.isElectric) {
      this.battery = clamp(this.battery - 18, 5, 100);
    } else {
      this.stamina = clamp(this.stamina - 55, 8, 100);
    }
  }

  /** Apply an arcade crash impulse with fast automatic recovery (< 0.55s). */
  applyCrashImpulse(yawKickRad: number, recoverySec: number): void {
    this.yaw = ((this.yaw + clamp(yawKickRad, -0.22, 0.22)) % TAU + TAU) % TAU;
    this.crashRecoveryTimer = Math.max(this.crashRecoveryTimer, clamp(recoverySec, 0, 0.55));
  }

  reset(x: number, z: number, yaw: number): void {
    this.x = x;
    this.z = z;
    this.yaw = ((yaw % TAU) + TAU) % TAU;
    this.speed = 0;
    this.lateralSlip = 0;
    this.steerAngle = 0;
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const front = this.heightAt(x + fx * RIDE.frontAxleZ, z + fz * RIDE.frontAxleZ);
    const rear = this.heightAt(x + fx * RIDE.rearAxleZ, z + fz * RIDE.rearAxleZ);
    this.frontHeight = front;
    this.rearHeight = rear;
    this.prevFrontHeight = front;
    this.potholeContacts.fill(false);
    const rearWeight = -RIDE.rearAxleZ / RIDE.wheelbase;
    this.y = rear + (front - rear) * rearWeight;
    this.pitch = -Math.atan2(front - rear, RIDE.wheelbase);
    this.bodyPitchOffset = 0;
    this.roll = 0;
    this.hits = 0;
    this.hardBrakes = 0;
    this.distanceDriven = 0;
    this.stuck = false;
    this.stuckTimer = 0;
    this.stuckWindow = 0;
    this.stuckTravelled = 0;
    this.stuckAnchorX = x;
    this.stuckAnchorZ = z;
    this.reverseTimer = 0;
    this.battery = 100;
    this.tanActive = false;
    this.tanBlend = 0;
    this.forceStopTurbo();
    this.scufflePenaltyTimer = 0;
    this.crashRecoveryTimer = 0;
    this.lastContact.active = false;
  }

  get forward(): { x: number; z: number } {
    return { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
  }

  /** Unit vector pointing to the driver's RIGHT side in world XZ. */
  get right(): { x: number; z: number } {
    return { x: -Math.cos(this.yaw), z: Math.sin(this.yaw) };
  }

  /** Unit vector pointing to the driver's LEFT side in world XZ. */
  get left(): { x: number; z: number } {
    return { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
  }

  /** One fixed physics step. `dt` should be a stable value (1/60). */
  step(dt: number, input: DriveInput, steeringSensitivity = 1, deadzone = 0): StepEvents {
    const t = this.tuning;
    this.scufflePenaltyTimer = Math.max(0, this.scufflePenaltyTimer - dt);
    this.crashRecoveryTimer = Math.max(0, this.crashRecoveryTimer - dt);
    const surface = this.surfaceAt(this.x, this.z);
    this.onSidewalk = surface === 'sidewalk';
    const roughKeep = t.roughSurfaceKeep ?? 0.84;
    const surfacePenalty =
      surface === 'road' ? 1 : surface === 'sidewalk' ? roughKeep : Math.max(0.64, roughKeep - 0.12);

    const rawThrottle = clamp01(input.throttle);
    const brake = clamp01(input.brake);

    // ----------------------------------------- Hold-to-boost টার্বো (separate!)
    const wantTurbo = Boolean(input.turbo) && brake < 0.2 && this.speed >= -0.25 && this.scufflePenaltyTimer <= 0;
    const wasTurbo = this.turboActive;
    if (wantTurbo) {
      if (this.turboActive) {
        if (this.turboCharge <= 0.02) {
          this.turboCharge = 0;
          this.turboActive = false;
          this.onTurboStateChange?.(false, 'empty');
        }
      } else if (this.turboCharge >= TURBO.minActivateCharge) {
        this.turboActive = true;
        this.onTurboStateChange?.(true, 'engage');
      }
    } else if (this.turboActive) {
      this.turboActive = false;
      this.onTurboStateChange?.(false, 'release');
    }

    if (this.turboActive) {
      const drain = TURBO.drainPerSec * (t.turboDrainMultiplier ?? 1) * dt;
      this.turboCharge = Math.max(0, this.turboCharge - drain);
      if (this.turboCharge <= 0.01) {
        this.turboCharge = 0;
        this.turboActive = false;
        if (wasTurbo) this.onTurboStateChange?.(false, 'empty');
      }
    } else if (!input.turbo) {
      const baseRegen = Math.abs(this.speed) > 1.2 ? TURBO.autoRechargeMoving : TURBO.autoRechargeIdle;
      const regen = baseRegen * (t.turboRechargeMultiplier ?? 1) * dt;
      this.turboCharge = Math.min(100, this.turboCharge + regen);
    }

    // Holding Turbo also provides forward drive thrust so one-thumb mobile Turbo works seamlessly.
    const throttle = this.turboActive ? Math.max(rawThrottle, 0.96) : rawThrottle;

    // ------------------------------------------------------ টান boost & stamina
    const activelyTanBoosting =
      this.tanActive && !this.turboActive && throttle > 0.04 && this.speed >= -0.05;
    if (!t.isElectric) {
      if (activelyTanBoosting) {
        this.stamina = Math.max(0, this.stamina - 13.5 * dt);
        if (this.stamina <= 0.01) {
          this.stamina = 0;
          this.tanActive = false;
          this.onTanAutoStop?.('stamina');
        }
      } else if (!this.tanActive) {
        const regenRate = rawThrottle > 0.1 ? 4.6 : 9.4;
        this.stamina = Math.min(100, this.stamina + regenRate * dt);
      } else if (Math.abs(this.speed) < 0.25) {
        this.stamina = Math.min(100, this.stamina + 3.0 * dt);
      }
    } else if (this.tanActive && this.battery <= 2.0) {
      this.tanActive = false;
      this.onTanAutoStop?.('battery');
    }

    this.tanBlend = moveTowards(this.tanBlend, this.tanActive ? 1 : 0, (this.tanActive ? 7.5 : 6.0) * dt);
    this.turboBlend = moveTowards(
      this.turboBlend,
      this.turboActive ? 1 : 0,
      (this.turboActive ? 9.5 : 12.0) * dt,
    );

    const tanSpeedMul = lerp(1, 1.95, this.tanBlend);
    const boostSpeedMul = lerp(tanSpeedMul, TURBO.speedMultiplier, this.turboBlend);
    const tanAccelMul = this.tanActive && throttle > 0.04 ? 2.15 : 1;
    const boostAccelMul = this.turboActive
      ? Math.max(tanAccelMul, TURBO.accelMultiplier)
      : tanAccelMul;
    const scuffleScale = this.scufflePenaltyTimer > 0 ? 0.76 : 1;

    const batteryScale = t.isElectric ? (this.battery > 8 ? 1 : 0.72 + 0.28 * (this.battery / 8)) : 1;
    const rawMaxSpeed = t.maxSpeed * boostSpeedMul * scuffleScale * surfacePenalty * batteryScale;
    const maxSpeed = this.turboBlend > 0.01 ? Math.min(rawMaxSpeed, TURBO.maxSpeedCap) : rawMaxSpeed;

    // ------------------------------------------------------------- steering
    // Progressive speed-sensitive steering: nimble in tight galis, calm & planted at boost speeds.
    const speedFactor = clamp01(Math.abs(this.speed) / Math.max(0.1, t.maxSpeed));
    const ultraSpeedFactor = clamp01((Math.abs(this.speed) - t.maxSpeed) / Math.max(1, t.maxSpeed * 1.8));
    const highSteerCap = lerp(t.steerMaxHigh, t.steerMaxHigh * 0.74, ultraSpeedFactor);
    const steerMax = lerp(t.steerMaxLow, highSteerCap, speedFactor);
    const rawSteer = Math.abs(input.steer) < deadzone ? 0 : clamp(input.steer, -1, 1);
    const eased = Math.sign(rawSteer) * Math.pow(clamp01(Math.abs(rawSteer)), 1.18);
    const target = clamp(
      eased * steerMax * clamp(steeringSensitivity, 0.4, 1.6),
      -steerMax * 1.12,
      steerMax * 1.12,
    );
    const rateMul = t.steerRateMultiplier ?? 1;
    const rate = (Math.abs(target) < 0.01 ? RIDE.steerReturn : RIDE.steerRate) * rateMul;
    this.steerAngle = moveTowards(this.steerAngle, target, rate * dt * steerMax * 3.6);

    // -------------------------------------------------------- longitudinal
    if (brake > 0.02) {
      if (this.speed > 0.02) {
        const before = this.speed;
        // Progressive braking: smooth initial bite + firm stopping power when held
        const speedBrakeBonus = 1 + clamp01(this.speed / 12) * 0.18;
        const decel =
          (input.handbrake ? Math.max(t.brakeDecel, RIDE.handbrakeDecel) : t.brakeDecel) *
          speedBrakeBonus *
          brake *
          dt;
        this.speed = Math.max(0, this.speed - decel);
        if (t.isElectric && (t.regenFactor ?? 0) > 0) {
          this.battery = clamp(
            this.battery + (before - this.speed) * (t.regenFactor ?? 0) * 0.45,
            0,
            100,
          );
        }
        if (this.speed < 0.05) this.speed = 0;
        if (before > 3.4 && this.speed < before - 2.4) this.hardBrakes++;
        this.reverseTimer = 0;
      } else if (throttle < 0.05) {
        this.reverseTimer += dt;
        if (this.reverseTimer > RIDE.reverseHold) {
          this.speed = Math.max(-RIDE.maxReverse, this.speed - t.accel * 0.58 * dt);
        }
      }
    } else {
      this.reverseTimer = 0;
    }

    if (throttle > 0.02 && this.speed >= -0.02) {
      const falloffCurve = t.isElectric ? RIDE.accelFalloff * 0.72 : RIDE.accelFalloff;
      const ratio = clamp01(this.speed / Math.max(0.1, maxSpeed));
      const falloff = 1 - ratio * ratio * falloffCurve;
      this.speed +=
        t.accel *
        boostAccelMul *
        scuffleScale *
        batteryScale *
        throttle *
        Math.max(0.12, falloff) *
        dt;
      if (t.isElectric && !this.turboActive) {
        const tanDrainMul = this.tanActive ? 3.2 : 1;
        const drain =
          (0.35 + 0.26 * speedFactor) *
          rawThrottle *
          (t.batteryDrainMultiplier ?? 1) *
          tanDrainMul *
          dt;
        this.battery = clamp(this.battery - drain, 0, 100);
        if (this.tanActive && this.battery <= 2.0) {
          this.tanActive = false;
          this.onTanAutoStop?.('battery');
        }
      }
    } else if (throttle > 0.02 && this.speed < -0.02) {
      this.speed = Math.min(0, this.speed + t.brakeDecel * 0.82 * dt);
    } else if (t.isElectric && Math.abs(this.speed) < 0.15) {
      this.battery = clamp(this.battery + 0.24 * dt, 0, 100);
    }

    // Natural coasting & over-speed settle when releasing boost
    if (throttle < 0.02 && brake < 0.02) {
      const dragScale = t.rollingDragScale ?? 1;
      const drag = (RIDE.coastDrag + RIDE.rollingDrag * Math.abs(this.speed)) * dragScale * dt;
      this.speed = Math.abs(this.speed) <= drag ? 0 : this.speed - Math.sign(this.speed) * drag;
    } else if (this.speed > maxSpeed) {
      // Smooth aerodynamic settle after releasing Turbo/টান (never snaps abruptly!)
      const overDrag = (3.8 + (this.speed - maxSpeed) * 0.65) * dt;
      this.speed = Math.max(maxSpeed, this.speed - overDrag);
    }
    this.speed = clamp(this.speed, -RIDE.maxReverse, Math.max(maxSpeed, 0.5));

    // ------------------------------------------- yaw + lateral grip separation
    const gripFactor = 0.72 + 0.34 * t.grip;
    const yawRate = -(this.speed / RIDE.wheelbase) * Math.tan(this.steerAngle) * gripFactor;
    const clampedYawRate = clamp(yawRate, -2.65, 2.65);
    this.yaw = (this.yaw + clampedYawRate * dt) % TAU;
    if (this.yaw < 0) this.yaw += TAU;

    const latAccel = this.speed * -clampedYawRate;
    this.lateralAccel = latAccel;

    // Separate lateral tyre grip: firm on dry road, controllable slide under hard rain/handbrake
    const lateralGripCoeff =
      lerp(RIDE.lateralGripWet, RIDE.lateralGrip, clamp01((t.grip - 0.38) / 0.56)) *
      (input.handbrake ? 0.58 : 1.0);
    const slipInput = Math.abs(this.speed) > 4.2 ? -latAccel * 0.045 : 0;
    this.lateralSlip += slipInput * dt;
    this.lateralSlip *= Math.exp(-lateralGripCoeff * dt);
    this.lateralSlip = clamp(this.lateralSlip, -1.35, 1.35);

    // ---------------------------------------------------------- integrate
    const prevX = this.x;
    const prevZ = this.z;
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const rx = -fz;
    const rz = fx;
    const stepDist = this.speed * dt;
    this.x += fx * stepDist + rx * (this.lateralSlip * dt);
    this.z += fz * stepDist + rz * (this.lateralSlip * dt);

    // --------------------------------------------------------- collisions
    const impact = this.resolveWorldCollisions(true);
    const netMoved = Math.hypot(this.x - prevX, this.z - prevZ);
    this.distanceDriven += netMoved;
    this.lastImpact = impact.magnitude;
    if (impact.magnitude > 0.4) this.hits++;

    // -------------------------------------------- ground & weight transfer
    const front = this.heightAt(this.x + fx * RIDE.frontAxleZ, this.z + fz * RIDE.frontAxleZ);
    const rear = this.heightAt(this.x + fx * RIDE.rearAxleZ, this.z + fz * RIDE.rearAxleZ);
    let roughBump = Math.abs(front - this.prevFrontHeight) * Math.abs(this.speed);
    this.prevFrontHeight = front;
    this.frontHeight = front;
    this.rearHeight = rear;

    const rearWeight = -RIDE.rearAxleZ / RIDE.wheelbase;
    const targetY = rear + (front - rear) * rearWeight;
    this.y += (targetY - this.y) * clamp01(dt * 24);

    const suspDamp = 1 - clamp01((t.suspensionSmoothing ?? 0) * 0.35);
    const targetPitch = -Math.atan2(front - rear, RIDE.wheelbase);
    this.pitch += (targetPitch - this.pitch) * clamp01(dt * 16);

    this.acceleration = (this.speed - this.prevSpeed) / Math.max(dt, 0.0001);
    this.prevSpeed = this.speed;

    // Dynamic longitudinal weight transfer (nose lift on Turbo/launch, nose dive on hard brake)
    const targetPitchOff = clamp(-this.acceleration * 0.0042 * suspDamp, -0.036, 0.038);
    this.bodyPitchOffset += (targetPitchOff - this.bodyPitchOffset) * clamp01(dt * 10);

    const targetRoll =
      clamp(-latAccel * 0.014 * suspDamp, -0.072, 0.072) +
      (surface === 'sidewalk' ? Math.sin(this.distanceDriven * 9) * 0.0032 * suspDamp : 0);
    this.roll += (targetRoll - this.roll) * clamp01(dt * 10);

    // Wheel-specific contact, only at entry; a stopped wheel does not rattle
    // repeatedly. Physical ground height already follows the shallow depression.
    const contactX = this.potholeWheelX;
    const contactZ = this.potholeWheelZ;
    contactX[0] = this.x + fx * RIDE.frontAxleZ;
    contactZ[0] = this.z + fz * RIDE.frontAxleZ;
    contactX[1] = this.x + fx * RIDE.rearAxleZ + rx * 0.55;
    contactZ[1] = this.z + fz * RIDE.rearAxleZ + rz * 0.55;
    contactX[2] = this.x + fx * RIDE.rearAxleZ - rx * 0.55;
    contactZ[2] = this.z + fz * RIDE.rearAxleZ - rz * 0.55;
    for (let wheel = 0; wheel < 3; wheel++) {
      const depth = this.potholeDepthAt(contactX[wheel], contactZ[wheel]);
      const touching = depth > 0.012;
      if (touching && !this.potholeContacts[wheel]) {
        const bump = potholeWheelImpulse(this.speed, depth, t.suspensionSmoothing ?? 0,
          t.isElectric ? 1.1 : 1);
        this.bodyPitchOffset += (wheel === 0 ? -1 : 0.65) * bump * 0.028;
        this.roll += (wheel === 0 ? 0 : wheel === 1 ? 1 : -1) * bump * 0.038;
        this.roll = clamp(this.roll, -0.11, 0.11);
        this.bodyPitchOffset = clamp(this.bodyPitchOffset, -0.08, 0.08);
        this.speed *= 1 - Math.min(0.018, bump * 0.012);
        roughBump = Math.max(roughBump, bump);
      }
      this.potholeContacts[wheel] = touching;
    }

    // --------------------------------------------------------- stuck check
    this.stuckWindow += dt;
    this.stuckTravelled += netMoved;
    if (this.stuckWindow >= 0.5) {
      const netWindowDist = Math.hypot(this.x - this.stuckAnchorX, this.z - this.stuckAnchorZ);
      const movedPerSecond = netWindowDist / this.stuckWindow;
      if (throttle > 0.4 && brake < 0.1 && movedPerSecond < 0.32) {
        this.stuckTimer += this.stuckWindow;
      } else {
        this.stuckTimer = Math.max(0, this.stuckTimer - this.stuckWindow * 1.8);
      }
      this.stuckWindow = 0;
      this.stuckTravelled = 0;
      this.stuckAnchorX = this.x;
      this.stuckAnchorZ = this.z;
    }
    this.stuck = this.stuckTimer > 2.2;

    return {
      impact: impact.magnitude,
      impactX: impact.nx,
      impactZ: impact.nz,
      contactX: impact.contactX,
      contactZ: impact.contactZ,
      distance: netMoved,
      onSidewalk: this.onSidewalk,
      stuck: this.stuck,
      roughBump,
    };
  }

  /**
   * Two-circle Rickshaw Capsule vs OBB/AABB resolution against static world colliders.
   * Uses tangential velocity projection so glancing wall/curb scrapes slide smoothly
   * instead of locking speed at `0 km/h`, while head-on wall hits stop cleanly.
   */
  resolveWorldCollisions(applyVelocityResponse = false): {
    magnitude: number;
    nx: number;
    nz: number;
    contactX: number;
    contactZ: number;
  } {
    if (this.colliders.length !== this.indexedColliderCount) {
      this.rebuildSpatialGrid();
    }
    let magnitude = 0;
    let nx = 0;
    let nz = 0;
    let contactX = this.x;
    let contactZ = this.z;
    if (applyVelocityResponse) {
      this.lastContact.active = false;
    }

    const candidates =
      this.colliders.length > 24
        ? this.spatialGrid.queryNear(this.x, this.z, 2.4)
        : this.colliders;

    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        if (c.disabled || c.height < 0.35) continue;
        // Fast AABB broad-phase reject with capsule margin (0.98m)
        if (
          this.x + 0.98 < c.minX ||
          this.x - 0.98 > c.maxX ||
          this.z + 0.98 < c.minZ ||
          this.z - 0.98 > c.maxZ
        ) {
          continue;
        }

        const cx = c.cx ?? (c.minX + c.maxX) * 0.5;
        const cz = c.cz ?? (c.minZ + c.maxZ) * 0.5;
        const halfX = c.halfX ?? (c.maxX - c.minX) * 0.5;
        const halfZ = c.halfZ ?? (c.maxZ - c.minZ) * 0.5;
        const cyaw = c.yaw ?? 0;

        const hit = testRickshawCapsuleVsObb(this.x, this.z, this.yaw, cx, cz, halfX, halfZ, cyaw);
        if (!hit.hit) continue;

        const preSpeed = Math.abs(this.speed);
        if (c.breakableId !== undefined && this.onBreakableHit) {
          const broke = this.onBreakableHit(c.breakableId, preSpeed, this.x, this.z, this.yaw);
          if (broke) {
            c.disabled = true;
            const smashMag = Math.min(2.6, preSpeed * 0.34 + 0.32);
            if (smashMag > magnitude) {
              magnitude = smashMag;
              nx = hit.nx;
              nz = hit.nz;
              contactX = hit.contactX;
              contactZ = hit.contactZ;
            }
            if (applyVelocityResponse) {
              this.speed *= 0.76;
            }
            continue;
          }
        }

        this.x += hit.pushX;
        this.z += hit.pushZ;

        if (applyVelocityResponse) {
          const moveSign = this.speed >= 0 ? 1 : -1;
          const dirX = Math.sin(this.yaw) * moveSign;
          const dirZ = Math.cos(this.yaw) * moveSign;
          // How directly we were moving INTO the surface normal (0 = parallel/away, 1 = head-on)
          const intoWall = Math.max(0, -(dirX * hit.nx + dirZ * hit.nz));

          if (intoWall > 0.04 && preSpeed > 0.05) {
            const speedInto = preSpeed * intoWall;
            const mag = Math.min(3.2, speedInto * 0.52 + (intoWall > 0.35 ? 0.22 : 0.05));
            if (mag > magnitude) {
              magnitude = mag;
              nx = hit.nx;
              nz = hit.nz;
              contactX = hit.contactX;
              contactZ = hit.contactZ;
            }
            // Project speed onto wall tangent so glancing scrapes glide cleanly!
            const tangentKeep = Math.sqrt(Math.max(0, 1 - intoWall * intoWall)) * 0.96;
            this.speed *= tangentKeep;
            this.lateralSlip *= 0.35;
            if (Math.abs(this.speed) < 0.05) this.speed = 0;

            // Gentle steering deflection along wall on angled contact to prevent re-wedging
            if (intoWall > 0.15 && intoWall < 0.88 && preSpeed > 1.2) {
              const cross = dirX * hit.nz - dirZ * hit.nx;
              this.yaw = ((this.yaw - Math.sign(cross) * intoWall * 0.035) % TAU + TAU) % TAU;
            }
          }
        }
      }
    }

    if (applyVelocityResponse && magnitude > 0.05) {
      this.lastContact.active = true;
      this.lastContact.x = contactX;
      this.lastContact.z = contactZ;
      this.lastContact.nx = nx;
      this.lastContact.nz = nz;
      this.lastContact.magnitude = magnitude;
    }

    return { magnitude, nx, nz, contactX, contactZ };
  }
}
