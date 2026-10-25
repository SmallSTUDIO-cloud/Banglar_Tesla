/**
 * Need for Speed: Most Wanted (2005)-inspired 7-mode camera rig:
 *   1. chase   — Classic chase
 *   2. close   — Close action chase
 *   3. wide    — Wide intersection / traffic-jam chase
 *   4. low     — Low street-level cinematic chase
 *   5. front   — Front-facing (ahead looking back at puller & rickshaw)
 *   6. cockpit — Near-driver / over-handlebar rider POV
 *   7. side    — Side cinematic tracking shot (wall-aware)
 *
 * Zero per-frame allocations, wrap-safe angle interpolation, dynamic speed FOV,
 * bounded impact trauma, and swept AABB + vehicle anti-clipping.
 */

import * as THREE from 'three';
import { CAMERA_MODES, type CameraMode } from '../core/config';
import { angleDelta, clamp, clamp01, damp } from '../core/mathx';
import type { BoxCollider } from './rickshawController';

export interface CameraDynamicObstacle {
  x: number;
  z: number;
  radius: number;
}

interface ModePreset {
  /** Signed distance behind vehicle (+behind, -in front). */
  backDist: number;
  /** Lateral offset from vehicle centreline (+left, -right). */
  sideOffset: number;
  height: number;
  /** Signed forward offset of look-at target (+ahead, -behind). */
  lookAhead: number;
  lookHeight: number;
  baseFov: number;
  speedFovBoost: number;
  speedPullback: number;
  posDamp: number;
  yawDamp: number;
}

const MODE_PRESETS: Record<CameraMode, ModePreset> = {
  chase: {
    backDist: 5.75,
    sideOffset: 0,
    height: 2.08,
    lookAhead: 2.85,
    lookHeight: 1.08,
    baseFov: 58,
    speedFovBoost: 6.5,
    speedPullback: 0.95,
    posDamp: 7.8,
    yawDamp: 6.2,
  },
  close: {
    backDist: 4.1,
    sideOffset: 0,
    height: 1.68,
    lookAhead: 2.6,
    lookHeight: 1.14,
    baseFov: 62,
    speedFovBoost: 7.0,
    speedPullback: 0.65,
    posDamp: 9.2,
    yawDamp: 7.4,
  },
  wide: {
    backDist: 8.1,
    sideOffset: 0,
    height: 3.05,
    lookAhead: 3.7,
    lookHeight: 1.2,
    baseFov: 64,
    speedFovBoost: 5.0,
    speedPullback: 1.15,
    posDamp: 6.8,
    yawDamp: 5.6,
  },
  low: {
    backDist: 4.9,
    sideOffset: 0.28,
    height: 1.06,
    lookAhead: 3.25,
    lookHeight: 1.22,
    baseFov: 66,
    speedFovBoost: 8.0,
    speedPullback: 0.75,
    posDamp: 8.5,
    yawDamp: 6.8,
  },
  front: {
    backDist: -4.55,
    sideOffset: 0.22,
    height: 1.56,
    lookAhead: -0.25,
    lookHeight: 1.16,
    baseFov: 54,
    speedFovBoost: 3.5,
    speedPullback: -0.45,
    posDamp: 8.8,
    yawDamp: 7.6,
  },
  cockpit: {
    backDist: -0.28,
    sideOffset: 0,
    height: 1.66,
    lookAhead: 9.0,
    lookHeight: 1.26,
    baseFov: 69,
    speedFovBoost: 5.5,
    speedPullback: 0,
    posDamp: 22.0,
    yawDamp: 16.0,
  },
  side: {
    backDist: 1.15,
    sideOffset: 3.65,
    height: 1.46,
    lookAhead: 0.85,
    lookHeight: 1.08,
    baseFov: 53,
    speedFovBoost: 4.0,
    speedPullback: 0.35,
    posDamp: 7.6,
    yawDamp: 6.4,
  },
};

export function nextCameraMode(current: CameraMode): CameraMode {
  const idx = CAMERA_MODES.indexOf(current);
  return CAMERA_MODES[(idx + 1) % CAMERA_MODES.length];
}

export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private currentPos = new THREE.Vector3(0, 3, -6);
  private currentLook = new THREE.Vector3(0, 1.1, 0);
  private currentQuat = new THREE.Quaternion();
  private targetQuat = new THREE.Quaternion();
  private lookMat = new THREE.Matrix4();
  private upVec = new THREE.Vector3(0, 1, 0);
  private desiredPos = new THREE.Vector3();
  private desiredLook = new THREE.Vector3();
  private anchorPos = new THREE.Vector3();

  private yaw = 0;
  private lookOffset = 0;
  private fov = 58;
  private appliedFov = 58;
  private trauma = 0;
  private shakeEnabled = true;
  private reduceMotion = false;
  private mode: CameraMode = 'chase';
  private prevYaw = 0;
  private sideSign: 1 | -1 = 1;
  private sideSwitchCooldown = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  getMode(): CameraMode {
    return this.mode;
  }

  isCockpit(): boolean {
    return this.mode === 'cockpit';
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
  }

  setShakeEnabled(enabled: boolean): void {
    this.shakeEnabled = enabled;
  }

  setReduceMotion(reduce: boolean): void {
    this.reduceMotion = reduce;
  }

  private boostFovKick = 0;
  private turboFovKick = 0;
  private accelLag = 0;
  private cameraRoll = 0;
  private rollQuat = new THREE.Quaternion();
  private zAxis = new THREE.Vector3(0, 0, 1);

  setBoostAmount(amount: number): void {
    this.boostFovKick = clamp01(amount);
  }

  setTurboAmount(amount: number): void {
    this.turboFovKick = clamp01(amount);
  }

  setLongitudinalAccel(accel: number, dt: number): void {
    const target = this.reduceMotion ? 0 : clamp(accel * 0.045, -0.26, 0.38);
    this.accelLag = damp(this.accelLag, target, 6.5, dt);
  }

  /** Kick the trauma accumulator (0..1) on collision or curb hop. */
  addTrauma(amount: number): void {
    if (!this.shakeEnabled || this.reduceMotion) return;
    this.trauma = clamp01(this.trauma + amount * 0.85);
  }

  /** Snap immediately after a respawn or mode start (no swoop from old origin). */
  snapTo(x: number, z: number, yaw: number, y = 0): void {
    this.yaw = yaw;
    this.prevYaw = yaw;
    const p = MODE_PRESETS[this.mode];
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const lx = fz;
    const lz = -fx;
    this.currentPos.set(
      x - fx * p.backDist + lx * p.sideOffset,
      y + p.height,
      z - fz * p.backDist + lz * p.sideOffset,
    );
    this.currentLook.set(x + fx * p.lookAhead, y + p.lookHeight, z + fz * p.lookAhead);
    this.fov = p.baseFov;
    this.appliedFov = p.baseFov;
    this.camera.position.copy(this.currentPos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.currentLook);
    this.currentQuat.copy(this.camera.quaternion);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  update(
    dt: number,
    targetX: number,
    targetZ: number,
    yaw: number,
    speed: number,
    colliders: BoxCollider[],
    reversing = false,
    groundY = 0,
    dynamicObstacles?: readonly CameraDynamicObstacle[],
  ): void {
    const preset = MODE_PRESETS[this.mode];
    const speedNorm = clamp01(Math.abs(speed) / 8.5);
    this.sideSwitchCooldown = Math.max(0, this.sideSwitchCooldown - dt);

    // Follow reverse direction subtly in classic chase modes without flipping violently
    const useReverseHeading =
      reversing && speed < -0.45 && (this.mode === 'chase' || this.mode === 'close' || this.mode === 'wide');
    const targetYaw = useReverseHeading ? yaw + Math.PI : yaw;
    const yawDiff = angleDelta(this.yaw, targetYaw);
    const yawK = 1 - Math.exp(-preset.yawDamp * (0.45 + 0.55 * speedNorm) * dt);
    this.yaw += yawDiff * yawK;

    // Wrap-safe yaw rate for subtle look-into-turn apex framing
    const stepYawDelta = angleDelta(this.prevYaw, yaw);
    this.prevYaw = yaw;
    const turnPeek = this.reduceMotion || this.mode === 'cockpit' || this.mode === 'front' ? 0 : clamp((stepYawDelta / Math.max(dt, 0.004)) * 0.28, -0.85, 0.85);
    this.lookOffset = damp(this.lookOffset, turnPeek, 5.5, dt);

    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    // Vehicle left vector in Three.js (+Y up): (fz, -fx)
    const lx = fz;
    const lz = -fx;

    let sideOffset = preset.sideOffset;
    if (this.mode === 'side') {
      if (this.sideSwitchCooldown <= 0) {
        const testL = this.pointBlocked(
          targetX - fx * preset.backDist + lx * preset.sideOffset,
          groundY + preset.height,
          targetZ - fz * preset.backDist + lz * preset.sideOffset,
          colliders,
          0.6,
        );
        const testR = this.pointBlocked(
          targetX - fx * preset.backDist - lx * preset.sideOffset,
          groundY + preset.height,
          targetZ - fz * preset.backDist - lz * preset.sideOffset,
          colliders,
          0.6,
        );
        if (this.sideSign === 1 && testL && !testR) {
          this.sideSign = -1;
          this.sideSwitchCooldown = 1.6;
        } else if (this.sideSign === -1 && testR && !testL) {
          this.sideSign = 1;
          this.sideSwitchCooldown = 1.6;
        }
      }
      sideOffset = preset.sideOffset * this.sideSign;
    }

    const motionScale = this.reduceMotion ? 0.35 : 1;
    const turboPull = this.mode === 'front' ? -0.55 * this.turboFovKick : 1.05 * this.turboFovKick;
    const backDist =
      preset.backDist +
      (preset.speedPullback * speedNorm + turboPull + (this.mode === 'front' ? -this.accelLag : this.accelLag)) *
        motionScale;
    const height = preset.height + (this.mode === 'wide' || this.mode === 'chase' ? speedNorm * 0.16 : 0);

    if (this.mode === 'cockpit') {
      // Lock cockpit cleanly to vehicle body orientation so handlebars stay rock-steady
      const vfx = Math.sin(yaw);
      const vfz = Math.cos(yaw);
      const vlx = vfz;
      const vlz = -vfx;
      this.desiredPos.set(
        targetX - vfx * preset.backDist,
        groundY + preset.height,
        targetZ - vfz * preset.backDist,
      );
      this.desiredLook.set(
        targetX + vfx * preset.lookAhead + vlx * this.lookOffset * 0.4,
        groundY + preset.lookHeight,
        targetZ + vfz * preset.lookAhead + vlz * this.lookOffset * 0.4,
      );
      this.currentPos.lerp(this.desiredPos, 1 - Math.exp(-preset.posDamp * dt));
      this.currentLook.lerp(this.desiredLook, 1 - Math.exp(-preset.posDamp * dt));
    } else {
      this.desiredPos.set(
        targetX - fx * backDist + lx * sideOffset,
        groundY + height,
        targetZ - fz * backDist + lz * sideOffset,
      );
      this.anchorPos.set(targetX, groundY + 1.25, targetZ);
      this.preventClipping(this.anchorPos, this.desiredPos, colliders, dynamicObstacles);
      this.desiredPos.y = Math.max(groundY + 0.52, this.desiredPos.y);

      const posAlpha = 1 - Math.exp(-preset.posDamp * dt);
      this.currentPos.lerp(this.desiredPos, posAlpha);
      this.currentPos.y = Math.max(groundY + 0.5, this.currentPos.y);

      this.desiredLook.set(
        targetX + fx * preset.lookAhead + lx * this.lookOffset * 0.85,
        groundY + preset.lookHeight,
        targetZ + fz * preset.lookAhead + lz * this.lookOffset * 0.85,
      );
      this.currentLook.lerp(this.desiredLook, 1 - Math.exp(-(preset.posDamp + 2.5) * dt));
    }

    // Dynamic FOV (speed + টান boost + টার্বো surge, calmed when Reduce Effects is enabled)
    const fovTarget =
      preset.baseFov +
      (this.reduceMotion
        ? 0
        : preset.speedFovBoost * speedNorm + this.boostFovKick * 4.2 + this.turboFovKick * 10.5);
    this.fov = damp(this.fov, fovTarget, 6.2, dt);
    if (Math.abs(this.fov - this.appliedFov) > 0.04) {
      this.camera.fov = this.fov;
      this.appliedFov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // Bounded camera shake + subtle cornering bank
    this.trauma = Math.max(0, this.trauma - dt * 1.75);
    const shake = Math.min(0.13, this.trauma * this.trauma * 0.16);
    const now = performance.now() * 0.018;
    const sx = shake > 0.0005 ? (Math.sin(now * 2.3) + Math.cos(now * 3.7)) * shake : 0;
    const sy = shake > 0.0005 ? Math.sin(now * 3.1) * shake * 0.65 : 0;

    const wantRoll =
      this.reduceMotion || (this.mode !== 'chase' && this.mode !== 'close' && this.mode !== 'low')
        ? 0
        : clamp(-this.lookOffset * 0.026, -0.028, 0.028);
    this.cameraRoll = damp(this.cameraRoll, wantRoll, 7.0, dt);

    this.camera.position.set(this.currentPos.x + sx, this.currentPos.y + sy, this.currentPos.z);
    this.lookMat.lookAt(this.camera.position, this.currentLook, this.upVec);
    this.targetQuat.setFromRotationMatrix(this.lookMat);
    if (Math.abs(this.cameraRoll) > 0.0004) {
      this.rollQuat.setFromAxisAngle(this.zAxis, this.cameraRoll);
      this.targetQuat.multiply(this.rollQuat);
    }
    const rotAlpha = this.mode === 'cockpit' ? 1 - Math.exp(-24 * dt) : 1 - Math.exp(-14 * dt);
    this.currentQuat.slerp(this.targetQuat, rotAlpha);
    this.camera.quaternion.copy(this.currentQuat);
  }

  private pointBlocked(x: number, y: number, z: number, colliders: BoxCollider[], pad: number): boolean {
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (c.disabled || c.height < y - 0.15) continue;
      if (x <= c.minX - pad || x >= c.maxX + pad || z <= c.minZ - pad || z >= c.maxZ + pad) {
        continue;
      }
      if (c.cx !== undefined && c.cz !== undefined && c.halfX !== undefined && c.halfZ !== undefined) {
        const yaw = c.yaw ?? 0;
        const cy = Math.cos(yaw);
        const sy = Math.sin(yaw);
        const wx = x - c.cx;
        const wz = z - c.cz;
        const lx = Math.abs(wx * cy - wz * sy);
        const lz = Math.abs(wx * sy + wz * cy);
        if (lx >= c.halfX + pad || lz >= c.halfZ + pad) continue;
      }
      return true;
    }
    return false;
  }

  /**
   * Sweeps from the vehicle anchor to the desired camera position and pulls the
   * camera in smoothly before any building wall, stall, or large bus/truck.
   */
  private preventClipping(
    anchor: THREE.Vector3,
    desired: THREE.Vector3,
    colliders: BoxCollider[],
    dynamicObstacles?: readonly CameraDynamicObstacle[],
  ): void {
    const pad = 0.46;
    const samples = 16;
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const px = anchor.x + (desired.x - anchor.x) * t;
      const py = anchor.y + (desired.y - anchor.y) * t;
      const pz = anchor.z + (desired.z - anchor.z) * t;

      let hit = this.pointBlocked(px, py, pz, colliders, pad);
      if (!hit && dynamicObstacles) {
        for (let j = 0; j < dynamicObstacles.length; j++) {
          const ob = dynamicObstacles[j];
          // Only pull camera out of tall/large traffic vehicles (ignore self)
          if (ob.radius < 1.15) continue;
          const dx = px - ob.x;
          const dz = pz - ob.z;
          if (dx * dx + dz * dz < (ob.radius + 0.35) * (ob.radius + 0.35) && py < 2.65) {
            hit = true;
            break;
          }
        }
      }

      if (hit) {
        const safe = Math.max(0.24, (i - 1) / samples);
        desired.x = anchor.x + (desired.x - anchor.x) * safe;
        desired.y = Math.max(anchor.y + 0.25, anchor.y + (desired.y - anchor.y) * safe + 0.22);
        desired.z = anchor.z + (desired.z - anchor.z) * safe;
        return;
      }
    }
  }
}
