/**
 * Arcade-simulation rickshaw controller. Deliberately engine-free (no three.js)
 * so the whole driving model can be unit-tested in node.
 *
 * Coordinate convention (Three.js right-handed world, +Y up):
 *   - Vehicle faces local +Z -> world forward = (sin(yaw), 0, cos(yaw))
 *   - Vehicle right side      = forward x up  = (-cos(yaw), 0, sin(yaw))
 *   - Vehicle left side       = up x forward  = ( cos(yaw), 0, -sin(yaw))
 *   - Input steer: -1 = LEFT, +1 = RIGHT
 *   - Because d(forward)/d(yaw) = (cos(yaw), 0, -sin(yaw)) = LEFT,
 *     steering RIGHT (steer > 0, speed > 0) decreases yaw (yawRate < 0),
 *     and steering LEFT (steer < 0, speed > 0) increases yaw (yawRate > 0).
 */

import { RIDE } from '../core/config';
import { clamp, clamp01, lerp, moveTowards, TAU } from '../core/mathx';

export interface BoxCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  disabled?: boolean;
  breakableId?: number;
}

export interface DriveInput {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
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
  suspensionSmoothing?: number;
}

export interface StepEvents {
  /** Collision impulse magnitude (0 = none). */
  impact: number;
  impactX: number;
  impactZ: number;
  distance: number;
  /** True when the wheels are on a raised footpath. */
  onSidewalk: boolean;
  stuck: boolean;
  roughBump: number;
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
  /** Local pitch for Three.js YXZ Euler (< 0 = nose up, > 0 = nose down). */
  pitch = 0;
  roll = 0;
  lateralAccel = 0;
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
  /** Temporary speed/handling penalty after a road-rage street scuffle (seconds). */
  scufflePenaltyTimer = 0;

  onBreakableHit?: (
    breakableId: number,
    impactSpeed: number,
    x: number,
    z: number,
    yaw: number,
  ) => boolean;
  onTanAutoStop?: (reason: 'stamina' | 'battery') => void;
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
    roughSurfaceKeep: 0.78,
    rollingDragScale: 1,
    isElectric: false,
    batteryDrainMultiplier: 1,
    regenFactor: 0,
    suspensionSmoothing: 0,
  };

  constructor(
    private colliders: BoxCollider[],
    private heightAt: HeightSampler,
    private surfaceAt: SurfaceSampler,
  ) {}

  setTuning(t: DriveTuning): void {
    this.tuning = { ...this.tuning, ...t };
  }

  setColliders(colliders: BoxCollider[]): void {
    this.colliders = colliders;
  }

  rechargeBattery(amount = 100): void {
    this.battery = clamp(this.battery + amount, 0, 100);
  }

  restoreStamina(amount = 100): void {
    this.stamina = clamp(this.stamina + amount, 0, 100);
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
    if (this.tuning.isElectric) {
      this.battery = clamp(this.battery - 18, 5, 100);
    } else {
      this.stamina = clamp(this.stamina - 55, 8, 100);
    }
  }

  reset(x: number, z: number, yaw: number): void {
    this.x = x;
    this.z = z;
    this.yaw = ((yaw % TAU) + TAU) % TAU;
    this.speed = 0;
    this.steerAngle = 0;
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const front = this.heightAt(x + fx * RIDE.frontAxleZ, z + fz * RIDE.frontAxleZ);
    const rear = this.heightAt(x + fx * RIDE.rearAxleZ, z + fz * RIDE.rearAxleZ);
    this.frontHeight = front;
    this.rearHeight = rear;
    this.prevFrontHeight = front;
    const rearWeight = -RIDE.rearAxleZ / RIDE.wheelbase;
    this.y = rear + (front - rear) * rearWeight;
    this.pitch = -Math.atan2(front - rear, RIDE.wheelbase);
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
    this.scufflePenaltyTimer = 0;
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
    const surface = this.surfaceAt(this.x, this.z);
    this.onSidewalk = surface === 'sidewalk';
    const roughKeep = t.roughSurfaceKeep ?? 0.78;
    const surfacePenalty =
      surface === 'road' ? 1 : surface === 'sidewalk' ? roughKeep : Math.max(0.58, roughKeep - 0.14);

    const throttle = clamp01(input.throttle);
    const brake = clamp01(input.brake);

    // ------------------------------------------------------ টান boost & stamina
    const activelyBoosting = this.tanActive && throttle > 0.04 && this.speed >= -0.05;
    if (!t.isElectric) {
      if (activelyBoosting) {
        this.stamina = Math.max(0, this.stamina - 13.5 * dt);
        if (this.stamina <= 0.01) {
          this.stamina = 0;
          this.tanActive = false;
          this.onTanAutoStop?.('stamina');
        }
      } else if (!this.tanActive) {
        const regenRate = throttle > 0.1 ? 4.4 : 9.2;
        this.stamina = Math.min(100, this.stamina + regenRate * dt);
      } else if (Math.abs(this.speed) < 0.25) {
        this.stamina = Math.min(100, this.stamina + 3.0 * dt);
      }
    } else if (this.tanActive && this.battery <= 2.0) {
      this.tanActive = false;
      this.onTanAutoStop?.('battery');
    }

    const tanSpeedMul = this.tanActive ? 1.95 : 1;
    const tanAccelMul = this.tanActive && throttle > 0.04 ? 2.15 : 1;
    const scuffleScale = this.scufflePenaltyTimer > 0 ? 0.76 : 1;

    // Electric rickshaw enters gentle eco-limp only if battery reaches 0;
    // Efficiency upgrade dramatically extends charge + adds regenerative braking.
    const batteryScale = t.isElectric ? (this.battery > 8 ? 1 : 0.68 + 0.32 * (this.battery / 8)) : 1;
    const maxSpeed = t.maxSpeed * tanSpeedMul * scuffleScale * surfacePenalty * batteryScale;

    // ------------------------------------------------------------- steering
    // steer < 0 = LEFT, steer > 0 = RIGHT (works when stationary too for fork visual).
    const speedFactor = clamp01(Math.abs(this.speed) / Math.max(0.1, t.maxSpeed));
    const highSteerCap = this.tanActive && Math.abs(this.speed) > t.maxSpeed ? t.steerMaxHigh * 0.88 : t.steerMaxHigh;
    const steerMax = lerp(t.steerMaxLow, highSteerCap, speedFactor);
    const rawSteer = Math.abs(input.steer) < deadzone ? 0 : clamp(input.steer, -1, 1);
    const eased = Math.sign(rawSteer) * Math.pow(clamp01(Math.abs(rawSteer)), 1.2);
    const target = clamp(eased * steerMax * clamp(steeringSensitivity, 0.4, 1.6), -steerMax * 1.15, steerMax * 1.15);
    const rateMul = t.steerRateMultiplier ?? 1;
    const rate = (Math.abs(target) < 0.01 ? RIDE.steerReturn : RIDE.steerRate) * rateMul;
    this.steerAngle = moveTowards(this.steerAngle, target, rate * dt * steerMax * 3.5);

    // -------------------------------------------------------- longitudinal

    if (brake > 0.02) {
      if (this.speed > 0.02) {
        const before = this.speed;
        const decel = (input.handbrake ? Math.max(t.brakeDecel, RIDE.handbrakeDecel) : t.brakeDecel) * brake * dt;
        this.speed = Math.max(0, this.speed - decel);
        if (t.isElectric && (t.regenFactor ?? 0) > 0) {
          this.battery = clamp(this.battery + (before - this.speed) * (t.regenFactor ?? 0) * 0.45, 0, 100);
        }
        if (this.speed < 0.05) this.speed = 0;
        if (before > 3.4 && this.speed < before - 2.4) this.hardBrakes++;
        this.reverseTimer = 0;
      } else if (throttle < 0.05) {
        // deliberate reverse: hold the brake while stopped
        this.reverseTimer += dt;
        if (this.reverseTimer > RIDE.reverseHold) {
          this.speed = Math.max(-RIDE.maxReverse, this.speed - t.accel * 0.55 * dt);
        }
      }
    } else {
      this.reverseTimer = 0;
    }

    if (throttle > 0.02 && this.speed >= -0.02) {
      const falloffCurve = t.isElectric ? RIDE.accelFalloff * 0.72 : RIDE.accelFalloff;
      const falloff = 1 - clamp01(this.speed / Math.max(0.1, maxSpeed)) * falloffCurve;
      this.speed += t.accel * tanAccelMul * scuffleScale * batteryScale * throttle * Math.max(0.08, falloff) * dt;
      if (t.isElectric) {
        const tanDrainMul = this.tanActive ? 3.4 : 1;
        const drain =
          (0.36 + 0.28 * speedFactor) * throttle * (t.batteryDrainMultiplier ?? 1) * tanDrainMul * dt;
        this.battery = clamp(this.battery - drain, 0, 100);
        if (this.tanActive && this.battery <= 2.0) {
          this.tanActive = false;
          this.onTanAutoStop?.('battery');
        }
      }
    } else if (throttle > 0.02 && this.speed < -0.02) {
      // pedalling/throttling while rolling backwards brakes smoothly first
      this.speed = Math.min(0, this.speed + t.brakeDecel * 0.75 * dt);
    } else if (t.isElectric && Math.abs(this.speed) < 0.15) {
      // Gentle trickle recovery when parked at stands
      this.battery = clamp(this.battery + 0.22 * dt, 0, 100);
    }

    // coasting drag (improved by bearings + efficiency upgrades)
    if (throttle < 0.02 && brake < 0.02) {
      const dragScale = t.rollingDragScale ?? 1;
      const drag = (RIDE.coastDrag + RIDE.rollingDrag * Math.abs(this.speed)) * dragScale * dt;
      this.speed = Math.abs(this.speed) <= drag ? 0 : this.speed - Math.sign(this.speed) * drag;
    }
    this.speed = clamp(this.speed, -RIDE.maxReverse, Math.max(maxSpeed, 0.5));

    // --------------------------------------------------------------- yaw
    // Three.js right-handed world (+Y up):
    //   steerAngle > 0 (RIGHT) with speed > 0 -> yawRate < 0 (turns toward right = forward x up).
    //   steerAngle < 0 (LEFT)  with speed > 0 -> yawRate > 0 (turns toward left  = up x forward).
    //   Reversing (speed < 0) naturally flips yawRate sign so backing up swings the rear into the steered side.
    const gripFactor = 0.72 + 0.34 * t.grip;
    const yawRate = -(this.speed / RIDE.wheelbase) * Math.tan(this.steerAngle) * gripFactor;
    const clampedYawRate = clamp(yawRate, -2.65, 2.65);
    this.yaw = (this.yaw + clampedYawRate * dt) % TAU;
    if (this.yaw < 0) this.yaw += TAU;

    // Positive lateralAccel = turning right, negative = turning left.
    const latAccel = this.speed * -clampedYawRate;
    this.lateralAccel = latAccel;

    // ---------------------------------------------------------- integrate
    const prevX = this.x;
    const prevZ = this.z;
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const stepDist = this.speed * dt;
    this.x += fx * stepDist;
    this.z += fz * stepDist;

    // --------------------------------------------------------- collisions
    const impact = this.resolveCollisions();
    const netMoved = Math.hypot(this.x - prevX, this.z - prevZ);
    this.distanceDriven += netMoved;
    this.lastImpact = impact.magnitude;
    if (impact.magnitude > 0.4) this.hits++;

    // ------------------------------------------------------------ ground
    // Sample ground at exact front (+0.80m) and rear (-0.68m) wheel contact points.
    const front = this.heightAt(this.x + fx * RIDE.frontAxleZ, this.z + fz * RIDE.frontAxleZ);
    const rear = this.heightAt(this.x + fx * RIDE.rearAxleZ, this.z + fz * RIDE.rearAxleZ);
    const roughBump = Math.abs(front - this.prevFrontHeight) * Math.abs(this.speed);
    this.prevFrontHeight = front;
    this.frontHeight = front;
    this.rearHeight = rear;

    const rearWeight = -RIDE.rearAxleZ / RIDE.wheelbase; // 0.68 / 1.48
    const targetY = rear + (front - rear) * rearWeight;
    this.y += (targetY - this.y) * clamp01(dt * 22);

    const suspDamp = 1 - clamp01((t.suspensionSmoothing ?? 0) * 0.35);
    // In Three.js YXZ Euler, negative pitch lifts +Z (front wheel) up onto slopes/humps.
    const targetPitch = -Math.atan2(front - rear, RIDE.wheelbase);
    this.pitch += (targetPitch - this.pitch) * clamp01(dt * 14);

    // Centrifugal body lean: turning right (latAccel > 0) rolls slightly outward (-Z roll)
    const targetRoll =
      clamp(-latAccel * 0.014 * suspDamp, -0.068, 0.068) +
      (surface === 'sidewalk' ? Math.sin(this.distanceDriven * 9) * 0.0035 * suspDamp : 0);
    this.roll += (targetRoll - this.roll) * clamp01(dt * 9);

    this.acceleration = (this.speed - this.prevSpeed) / Math.max(dt, 0.0001);
    this.prevSpeed = this.speed;

    // --------------------------------------------------------- stuck check
    this.stuckWindow += dt;
    this.stuckTravelled += netMoved;
    if (this.stuckWindow >= 0.5) {
      const netWindowDist = Math.hypot(this.x - this.stuckAnchorX, this.z - this.stuckAnchorZ);
      const movedPerSecond = netWindowDist / this.stuckWindow;
      if (throttle > 0.4 && movedPerSecond < 0.35) this.stuckTimer += this.stuckWindow;
      else this.stuckTimer = Math.max(0, this.stuckTimer - this.stuckWindow * 1.6);
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
      distance: netMoved,
      onSidewalk: this.onSidewalk,
      stuck: this.stuck,
      roughBump,
    };
  }

  /** Circle-vs-AABB resolution against the static world. */
  private resolveCollisions(): { magnitude: number; nx: number; nz: number } {
    const radius = RIDE.bodyRadius;
    let magnitude = 0;
    let nx = 0;
    let nz = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (const c of this.colliders) {
        if (c.disabled || c.height < 0.35) continue;
        const closestX = clamp(this.x, c.minX, c.maxX);
        const closestZ = clamp(this.z, c.minZ, c.maxZ);
        let dx = this.x - closestX;
        let dz = this.z - closestZ;
        let dist = Math.hypot(dx, dz);
        if (dist >= radius) continue;

        const preSpeed = Math.abs(this.speed);
        if (c.breakableId !== undefined && this.onBreakableHit) {
          const broke = this.onBreakableHit(c.breakableId, preSpeed, this.x, this.z, this.yaw);
          if (broke) {
            c.disabled = true;
            const smashMag = Math.min(2.6, preSpeed * 0.36 + 0.35);
            if (smashMag > magnitude) {
              magnitude = smashMag;
              nx = dist > 0.001 ? dx / dist : -Math.sin(this.yaw);
              nz = dist > 0.001 ? dz / dist : -Math.cos(this.yaw);
            }
            this.speed *= 0.68;
            continue;
          }
        }
        if (dist < 0.0001) {
          const toMinX = this.x - c.minX;
          const toMaxX = c.maxX - this.x;
          const toMinZ = this.z - c.minZ;
          const toMaxZ = c.maxZ - this.z;
          const min = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
          if (min === toMinX) {
            dx = -1;
            dz = 0;
          } else if (min === toMaxX) {
            dx = 1;
            dz = 0;
          } else if (min === toMinZ) {
            dx = 0;
            dz = -1;
          } else {
            dx = 0;
            dz = 1;
          }
          dist = 1;
          this.x = closestX + dx * (radius + 0.02);
          this.z = closestZ + dz * (radius + 0.02);
        } else {
          this.x += (dx / dist) * (radius - dist + 0.01);
          this.z += (dz / dist) * (radius - dist + 0.01);
        }
        const nxLocal = dx / (dist || 1);
        const nzLocal = dz / (dist || 1);
        const forwardDot = Math.sin(this.yaw) * nxLocal + Math.cos(this.yaw) * nzLocal;
        const speedInto = -Math.abs(this.speed * forwardDot);
        const mag = Math.min(3, Math.abs(speedInto) * 0.55 + 0.25);
        if (mag > magnitude) {
          magnitude = mag;
          nx = nxLocal;
          nz = nzLocal;
        }
        this.speed *= 1 - RIDE.collisionBounce * 0.6;
        if (Math.abs(this.speed) < 0.05) this.speed = 0;
      }
    }
    return { magnitude, nx, nz };
  }
}
