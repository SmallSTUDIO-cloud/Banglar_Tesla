/**
 * Passenger actors: a small, respectful cast with varied outfits and a simple
 * walk → board → sit → leave animation rig.
 */

import * as THREE from 'three';
import { damp, TAU } from '../core/mathx';

export type Archetype = 'student' | 'office' | 'shopper' | 'elder' | 'tourist' | 'singer';

export interface ArchetypeDef {
  id: Archetype;
  whoKey: string;
  greetKey: string;
  moodBias: number;
  patience: number;
  colors: { shirt: string; lower: string; skin: string; accent: string };
  /** 0 = trousers, 1 = saree/skirt */
  skirt: number;
  bag: boolean;
}

export const ARCHETYPES: ArchetypeDef[] = [
  {
    id: 'student',
    whoKey: 'who.student',
    greetKey: 'd.student.greet',
    moodBias: 4,
    patience: 1.15,
    colors: { shirt: '#d8e4ee', lower: '#2c3a4a', skin: '#8a5a3c', accent: '#c0392b' },
    skirt: 0,
    bag: true,
  },
  {
    id: 'office',
    whoKey: 'who.office',
    greetKey: 'd.office.greet',
    moodBias: -6,
    patience: 0.85,
    colors: { shirt: '#e8e2d4', lower: '#33384a', skin: '#a06a44', accent: '#2f5a7a' },
    skirt: 0,
    bag: true,
  },
  {
    id: 'shopper',
    whoKey: 'who.shopper',
    greetKey: 'd.shopper.greet',
    moodBias: 2,
    patience: 1.3,
    colors: { shirt: '#b8352a', lower: '#7a1f18', skin: '#8a5a3c', accent: '#f0c04a' },
    skirt: 1,
    bag: true,
  },
  {
    id: 'elder',
    whoKey: 'who.elder',
    greetKey: 'd.elder.greet',
    moodBias: 0,
    patience: 1.5,
    colors: { shirt: '#f2efe6', lower: '#d8d0c0', skin: '#9a6a4a', accent: '#4a6b3a' },
    skirt: 0,
    bag: false,
  },
  {
    id: 'tourist',
    whoKey: 'who.tourist',
    greetKey: 'd.tourist.greet',
    moodBias: 6,
    patience: 1.2,
    colors: { shirt: '#2f7a8a', lower: '#c9b48a', skin: '#b47a52', accent: '#e8b25a' },
    skirt: 0,
    bag: true,
  },
  {
    id: 'singer',
    whoKey: 'who.singer',
    greetKey: 'd.singer.greet',
    moodBias: -2,
    patience: 0.9,
    colors: { shirt: '#3a2a5a', lower: '#22222a', skin: '#8a5a3c', accent: '#e8644a' },
    skirt: 0,
    bag: false,
  },
];

export function archetypeById(id: Archetype): ArchetypeDef {
  return ARCHETYPES.find((a) => a.id === id) ?? ARCHETYPES[0];
}

const shared = {
  head: new THREE.SphereGeometry(0.11, 10, 8),
  torso: new THREE.CapsuleGeometry(0.16, 0.44, 3, 8),
  leg: new THREE.BoxGeometry(0.12, 0.5, 0.14),
  skirt: new THREE.ConeGeometry(0.27, 0.76, 9, 1, true),
  bag: new THREE.BoxGeometry(0.2, 0.24, 0.1),
  hair: new THREE.SphereGeometry(0.116, 10, 8, 0, TAU, 0, Math.PI / 1.7),
};

const actorMatCache = new Map<string, THREE.MeshLambertMaterial>();
function sharedActorMat(color: string, doubleSided = false): THREE.MeshLambertMaterial {
  const key = `${color}:${doubleSided ? 2 : 1}`;
  let m = actorMatCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({
      color,
      side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });
    actorMatCache.set(key, m);
  }
  return m;
}
const sharedHairMat = sharedActorMat('#1b1410');

export class PassengerActor {
  readonly group = new THREE.Group();
  readonly def: ArchetypeDef;
  private torso: THREE.Mesh;
  private head: THREE.Mesh;
  private legL: THREE.Mesh;
  private legR: THREE.Mesh;
  private skirtMesh: THREE.Mesh | null = null;
  private bagMesh: THREE.Mesh | null = null;
  private phase = 0;
  private walking = false;
  private target: THREE.Vector3 | null = null;
  private seated = false;
  private speed = 1.35;
  private onArrive: (() => void) | null = null;
  private seatYaw = 0;

  constructor(def: ArchetypeDef) {
    this.def = def;
    const shirt = sharedActorMat(def.colors.shirt);
    const skin = sharedActorMat(def.colors.skin);
    const lower = sharedActorMat(def.colors.lower);
    const accent = sharedActorMat(def.colors.accent, def.skirt > 0);

    this.torso = new THREE.Mesh(shared.torso, shirt);
    this.torso.position.y = 1.02;
    this.torso.castShadow = true;
    this.head = new THREE.Mesh(shared.head, skin);
    this.head.position.y = 1.47;
    const hair = new THREE.Mesh(shared.hair, sharedHairMat);
    hair.position.y = 1.47;
    this.legL = new THREE.Mesh(shared.leg, lower);
    this.legR = new THREE.Mesh(shared.leg, lower);
    this.legL.position.set(-0.09, 0.5, 0);
    this.legR.position.set(0.09, 0.5, 0);
    this.group.add(this.torso, this.head, hair, this.legL, this.legR);

    if (def.skirt > 0) {
      this.skirtMesh = new THREE.Mesh(shared.skirt, accent);
      this.skirtMesh.position.y = 0.74;
      this.group.add(this.skirtMesh);
    }
    if (def.bag) {
      this.bagMesh = new THREE.Mesh(shared.bag, accent);
      this.bagMesh.position.set(0.22, 1.0, -0.04);
      this.group.add(this.bagMesh);
    }
  }

  place(x: number, z: number, yaw = 0): void {
    this.group.position.set(x, 0, z);
    this.group.rotation.y = yaw;
  }

  walkTo(x: number, z: number, onArrive?: () => void): void {
    this.target = new THREE.Vector3(x, 0, z);
    this.walking = true;
    this.onArrive = onArrive ?? null;
  }

  stop(): void {
    this.walking = false;
    this.target = null;
  }

  /** Seat the passenger on the rickshaw bench (reparented to its anchor). */
  seat(anchor: THREE.Object3D): void {
    this.seated = true;
    this.walking = false;
    this.target = null;
    this.group.removeFromParent();
    anchor.add(this.group);
    this.group.position.set(0, 0, 0);
    this.group.rotation.set(0, 0, 0);
    this.torso.position.set(0, 0.32, 0);
    this.head.position.set(0, 0.74, 0);
    this.legL.position.set(-0.11, 0.16, 0.18);
    this.legR.position.set(0.11, 0.16, 0.18);
    this.legL.rotation.x = -1.35;
    this.legR.rotation.x = -1.35;
    if (this.skirtMesh) this.skirtMesh.position.set(0, 0.06, 0.04);
    if (this.bagMesh) this.bagMesh.position.set(0.24, 0.34, 0.02);
    this.seatYaw = 0;
  }

  /** Leave the bench and walk away. */
  leave(scene: THREE.Object3D, x: number, z: number, yaw: number, walkToX: number, walkToZ: number): void {
    this.seated = false;
    this.group.removeFromParent();
    scene.add(this.group);
    this.torso.position.set(0, 1.02, 0);
    this.head.position.set(0, 1.47, 0);
    this.legL.position.set(-0.09, 0.5, 0);
    this.legR.position.set(0.09, 0.5, 0);
    this.legL.rotation.x = 0;
    this.legR.rotation.x = 0;
    if (this.skirtMesh) this.skirtMesh.position.y = 0.74;
    this.group.position.set(x, 0, z);
    this.group.rotation.y = yaw;
    this.walkTo(walkToX, walkToZ);
  }

  update(dt: number): void {
    if (this.seated) {
      // subtle sway while riding
      this.group.rotation.z = Math.sin(performance.now() * 0.002) * 0.01;
      this.group.rotation.y = this.seatYaw + Math.sin(performance.now() * 0.0013) * 0.02;
      return;
    }
    if (!this.walking || !this.target) return;
    const dx = this.target.x - this.group.position.x;
    const dz = this.target.z - this.group.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.28) {
      this.walking = false;
      const cb = this.onArrive;
      this.onArrive = null;
      cb?.();
      return;
    }
    const step = Math.min(dist, this.speed * dt);
    this.group.position.x += (dx / dist) * step;
    this.group.position.z += (dz / dist) * step;
    const yaw = Math.atan2(dx, dz);
    this.group.rotation.y = damp(this.group.rotation.y, yaw, 8, dt);
    this.phase += dt * 9;
    this.legL.rotation.x = Math.sin(this.phase) * 0.55;
    this.legR.rotation.x = -Math.sin(this.phase) * 0.55;
    this.torso.position.y = 1.02 + Math.abs(Math.sin(this.phase)) * 0.03;
    this.head.position.y = 1.47 + Math.abs(Math.sin(this.phase)) * 0.03;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
