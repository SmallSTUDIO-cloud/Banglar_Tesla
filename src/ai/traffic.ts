/**
 * Traffic system: vehicles follow closed left-hand-drive routes with simple
 * car-following, junction signals, obstacle avoidance and distance recycling.
 */

import * as THREE from 'three';
import { buildTrafficRoutes, sampleRoute, type Route } from './routes';
import {
  TRAFFIC_PALETTE,
  VEHICLE_MAKERS,
  type TrafficModel,
  type VehicleKind,
} from './vehicles';
import { clamp, mulberry32 } from '../core/mathx';
import type { QualitySettings } from '../core/config';

interface TrafficVehicle {
  kind: VehicleKind;
  route: Route;
  s: number;
  speed: number;
  cruise: number;
  model: TrafficModel;
  brakeLight: THREE.Mesh;
  wheelRadius: number;
  length: number;
  /** Blocked by the player / another vehicle this frame. */
  blocked: boolean;
  honked: number;
}

export interface TrafficObstacle {
  x: number;
  z: number;
  radius: number;
  kind: VehicleKind;
}

export interface TrafficSignals {
  mainGreen: boolean;
  /** 0 = green, 1 = amber, 2 = red for the main road. */
  state: 0 | 1 | 2;
}

export class TrafficSystem {
  readonly group = new THREE.Group();
  private vehicles: TrafficVehicle[] = [];
  private routes: Route[];
  private rng = mulberry32(99117);
  private signalGroup = new THREE.Group();
  private signalLamps: { main: THREE.Mesh[]; cross: THREE.Mesh[] } = { main: [], cross: [] };
  private cycle = 0;
  signal: TrafficSignals = { mainGreen: true, state: 0 };
  private playerX = 0;
  private playerZ = 0;
  private playerSpeed = 0;
  onHorn?: (x: number, z: number, kind: VehicleKind) => void;
  private hornCooldown = 0;

  constructor(quality: QualitySettings) {
    this.routes = buildTrafficRoutes();
    this.group.name = 'traffic';
    this.buildSignals();
    this.setQuality(quality);
  }

  private buildSignals(): void {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x33383a, roughness: 0.7, metalness: 0.4 });
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x1f2325, roughness: 0.8 });
    const spots = [
      { x: -6.6, z: 6.2, rot: 0 },
      { x: 6.6, z: -6.2, rot: Math.PI },
      { x: 6.6, z: 6.2, rot: Math.PI / 2 },
      { x: -6.6, z: -6.2, rot: -Math.PI / 2 },
    ];
    for (const spot of spots) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.4, 6), poleMat);
      pole.position.set(spot.x, 1.7, spot.z);
      this.signalGroup.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.9, 0.26), boxMat);
      head.position.set(spot.x, 3.5, spot.z);
      head.rotation.y = spot.rot;
      this.signalGroup.add(head);
      const lamps: THREE.Mesh[] = [];
      for (let i = 0; i < 3; i++) {
        const lamp = new THREE.Mesh(
          new THREE.CircleGeometry(0.1, 10),
          new THREE.MeshStandardMaterial({
            color: i === 0 ? 0x1f4a2a : i === 1 ? 0x4a3f1a : 0x4a1f1f,
            emissive: 0x000000,
            emissiveIntensity: 1.4,
          }),
        );
        lamp.position.set(spot.x, 3.78 - i * 0.28, spot.z);
        lamp.rotation.y = spot.rot;
        lamp.translateZ(0.14);
        this.signalGroup.add(lamp);
        lamps.push(lamp);
      }
      if (Math.abs(spot.x) > Math.abs(spot.z)) {
        this.signalLamps.main.push(...lamps);
      } else {
        this.signalLamps.cross.push(...lamps);
      }
    }
    this.group.add(this.signalGroup);
  }

  setQuality(quality: QualitySettings): void {
    const wanted = quality.traffic;
    while (this.vehicles.length > wanted) {
      const v = this.vehicles.pop();
      if (v) this.group.remove(v.model.group);
    }
    while (this.vehicles.length < wanted) {
      this.vehicles.push(this.spawnVehicle());
    }
  }

  private spawnVehicle(): TrafficVehicle {
    const kinds: VehicleKind[] = ['bus', 'car', 'cng', 'motorcycle', 'rickshaw', 'truck', 'car', 'rickshaw', 'cng'];
    const kind = kinds[Math.floor(this.rng() * kinds.length)];
    const palette = TRAFFIC_PALETTE[kind];
    const color = palette[Math.floor(this.rng() * palette.length)];
    const maker = VEHICLE_MAKERS[kind];
    const model = maker(color);
    model.group.name = `traffic-${kind}`;
    this.group.add(model.group);

    const brakeLight = new THREE.Mesh(
      new THREE.BoxGeometry(kind === 'bus' ? 2.3 : 0.4, 0.14, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x5a1010, emissive: 0xb01808, emissiveIntensity: 0.4 }),
    );
    brakeLight.position.set(0, kind === 'bus' ? 0.85 : 0.6, -model.halfLength - 0.02);
    model.group.add(brakeLight);

    const route = this.routes[Math.floor(this.rng() * this.routes.length)];
    const cruiseBase = kind === 'bus' ? 5.2 : kind === 'truck' ? 4.8 : kind === 'rickshaw' ? 3.6 : kind === 'motorcycle' ? 8.2 : 6.4;
    return {
      kind,
      route,
      s: this.rng() * route.length,
      speed: cruiseBase * 0.6,
      cruise: cruiseBase * (0.85 + this.rng() * 0.3),
      model,
      brakeLight,
      wheelRadius: kind === 'bus' || kind === 'truck' ? 0.5 : 0.32,
      length: model.halfLength * 2,
      blocked: false,
      honked: 0,
    };
  }

  setPlayer(x: number, z: number, speed: number): void {
    this.playerX = x;
    this.playerZ = z;
    this.playerSpeed = speed;
  }

  /** Container collisions for the player rickshaw. */
  obstacles(): TrafficObstacle[] {
    const out: TrafficObstacle[] = [];
    for (const v of this.vehicles) {
      if (!v.model.group.visible) continue;
      out.push({ x: v.model.group.position.x, z: v.model.group.position.z, radius: v.model.halfLength * 0.55, kind: v.kind });
    }
    return out;
  }

  update(dt: number): void {
    this.cycle = (this.cycle + dt) % 26;
    const green = this.cycle < 12;
    const amber = this.cycle >= 12 && this.cycle < 14.5;
    this.signal.mainGreen = green;
    this.signal.state = green ? 0 : amber ? 1 : 2;
    this.updateSignalVisuals();

    this.hornCooldown = Math.max(0, this.hornCooldown - dt);

    for (const v of this.vehicles) {
      const sample = sampleRoute(v.route, v.s, { x: 0, z: 0, yaw: 0 });

      // ---- car following: nearest vehicle on the same route ahead
      let gap = 999;
      for (const other of this.vehicles) {
        if (other === v) continue;
        if (other.route !== v.route) continue;
        let diff = other.s - v.s;
        if (diff < 0) diff += v.route.length;
        if (diff > 0.1 && diff < 30) {
          gap = Math.min(gap, diff - (other.length + v.length) * 0.5);
        }
      }
      // ---- player as a dynamic obstacle
      const dx = this.playerX - sample.x;
      const dz = this.playerZ - sample.z;
      const distToPlayer = Math.hypot(dx, dz);
      if (distToPlayer < 16) {
        const forwardX = Math.sin(sample.yaw);
        const forwardZ = Math.cos(sample.yaw);
        const aheadDot = dx * forwardX + dz * forwardZ;
        const lateral = Math.abs(dx * forwardZ - dz * forwardX);
        // a parked rickshaw blocks more of the lane than a moving one
        const blockingWidth = this.playerSpeed < 0.5 ? 2.9 : 2.4;
        if (aheadDot > 0.5 && lateral < blockingWidth) {
          gap = Math.min(gap, aheadDot - 1.4);
        }
      }

      // ---- junction behaviour
      let junctionStop = false;
      if (!this.signal.mainGreen) {
        const nearMain = Math.abs(sample.x) < 5.5 && Math.abs(sample.z) < 13 && Math.abs(sample.z) > 4.4;
        const nearCross = Math.abs(sample.z) < 4.4 && Math.abs(sample.x) < 12;
        const travelsMain = Math.abs(Math.sin(sample.yaw)) < 0.5;
        if ((travelsMain && nearMain && nearCross) || (!travelsMain && nearCross)) junctionStop = true;
      }

      // ---- desired speed (simple IDM-ish)
      let target = v.cruise * v.route.speedFactor;
      if (gap < 14) target = Math.min(target, Math.max(0, (gap - 2.2) * 0.9));
      if (junctionStop && gap > 2) target = Math.min(target, 0.6);
      if (v.kind === 'bus' && Math.abs(sample.z) > 30) target *= 0.94;

      const accel = clamp(target - v.speed, -6.5, 2.4);
      v.speed = clamp(v.speed + accel * dt, 0, v.cruise + 1.2);
      // gentle speed wobble for life
      v.s = (v.s + v.speed * dt) % v.route.length;
      v.blocked = gap < 4.5;

      // honk occasionally when blocked
      v.honked = Math.max(0, v.honked - dt);
      if (v.blocked && v.honked <= 0 && this.hornCooldown <= 0) {
        v.honked = 4 + this.rng() * 6;
        this.hornCooldown = 2.5;
        this.onHorn?.(sample.x, sample.z, v.kind);
      }

      const pos = sampleRoute(v.route, v.s, { x: 0, z: 0, yaw: 0 });
      v.model.group.position.set(pos.x, 0, pos.z);
      v.model.group.rotation.y = pos.yaw;
      // Wheels are baked into one mesh per vehicle (see vehicles.ts), so there
      // is nothing to spin here; the brake light still communicates motion. 
      const brakeMat = v.brakeLight.material as THREE.MeshStandardMaterial;
      brakeMat.emissiveIntensity = v.speed < 0.4 ? 2.2 : accel < -1.2 ? 1.6 : 0.3;
      const nearPlayer = Math.hypot(pos.x - this.playerX, pos.z - this.playerZ) < 90;
      v.model.group.visible = nearPlayer;
    }
  }

  private updateSignalVisuals(): void {
    const setLamp = (lamp: THREE.Mesh, index: number, active: boolean): void => {
      const mat = lamp.material as THREE.MeshStandardMaterial;
      const colors = [0x2fbf5a, 0xf0b41c, 0xd93b2b];
      mat.emissive.setHex(active ? colors[index] : 0x000000);
      mat.emissiveIntensity = active ? 2.2 : 0;
      mat.color.setHex(active ? colors[index] : 0x2a2a2a);
    };
    const state = this.signal.state;
    for (const lamp of this.signalLamps.main) {
      const index = this.signalLamps.main.indexOf(lamp) % 3;
      setLamp(lamp, index, state === index);
    }
    for (const lamp of this.signalLamps.cross) {
      const index = this.signalLamps.cross.indexOf(lamp) % 3;
      setLamp(lamp, index, state === 2 ? index === 0 : false);
    }
  }

  dispose(): void {
    for (const v of this.vehicles) {
      v.model.group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material.dispose();
        }
      });
    }
    this.group.clear();
  }
}
