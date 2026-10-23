/**
 * Static-geometry helpers. To keep draw calls phone-friendly every building,
 * kerb, window and prop is authored as small primitives and merged into a
 * handful of meshes (one per material family) at the end of world building.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface UvRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);
const UNIT_CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1, false);
const UNIT_CONE = new THREE.ConeGeometry(0.5, 1, 10);

const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpVec = new THREE.Vector3();
const tmpScale = new THREE.Vector3();

/** Merge bucket: collects transformed primitives and emits one mesh. */
export class Bucket {
  private parts: THREE.BufferGeometry[] = [];
  private material: THREE.Material;
  readonly name: string;

  constructor(name: string, material: THREE.Material) {
    this.name = name;
    this.material = material;
  }

  get count(): number {
    return this.parts.length;
  }

  /** Add a primitive with a TRS transform and a tint (vertex colour). */
  add(
    source: THREE.BufferGeometry,
    pos: THREE.Vector3 | { x: number; y: number; z: number },
    scale: THREE.Vector3 | { x: number; y: number; z: number },
    color: THREE.ColorRepresentation,
    rotation?: { x?: number; y?: number; z?: number },
    uv?: UvRect,
  ): void {
    const geo = source.clone();
    tmpEuler.set(rotation?.x ?? 0, rotation?.y ?? 0, rotation?.z ?? 0, 'YXZ');
    tmpQuat.setFromEuler(tmpEuler);
    tmpMatrix.compose(
      tmpVec.set(pos instanceof THREE.Vector3 ? pos.x : pos.x, pos instanceof THREE.Vector3 ? pos.y : pos.y, pos instanceof THREE.Vector3 ? pos.z : pos.z),
      tmpQuat,
      tmpScale.set(
        scale instanceof THREE.Vector3 ? scale.x : scale.x,
        scale instanceof THREE.Vector3 ? scale.y : scale.y,
        scale instanceof THREE.Vector3 ? scale.z : scale.z,
      ),
    );
    geo.applyMatrix4(tmpMatrix);

    if (uv) {
      const attr = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
      if (attr) {
        for (let i = 0; i < attr.count; i++) {
          const u = attr.getX(i);
          const v = attr.getY(i);
          attr.setXY(i, uv.u0 + (uv.u1 - uv.u0) * u, uv.v0 + (uv.v1 - uv.v0) * v);
        }
        attr.needsUpdate = true;
      }
    }

    const c = new THREE.Color(color);
    const colors = new Float32Array(geo.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = c.r;
      colors[i + 1] = c.g;
      colors[i + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // mergeGeometries needs identical attribute sets
    if (!geo.getAttribute('uv')) {
      const count = geo.getAttribute('position').count;
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    this.parts.push(geo);
  }

  box(
    pos: { x: number; y: number; z: number },
    size: { x: number; y: number; z: number },
    color: THREE.ColorRepresentation,
    rotation?: { x?: number; y?: number; z?: number },
  ): void {
    this.add(UNIT_BOX, pos, size, color, rotation);
  }

  /** Axis-aligned box from min/max corners (easier for buildings). */
  boxMinMax(min: THREE.Vector3, max: THREE.Vector3, color: THREE.ColorRepresentation): void {
    this.box(
      { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 },
      { x: Math.abs(max.x - min.x), y: Math.abs(max.y - min.y), z: Math.abs(max.z - min.z) },
      color,
    );
  }

  cylinder(
    pos: { x: number; y: number; z: number },
    radius: number,
    height: number,
    color: THREE.ColorRepresentation,
    rotation?: { x?: number; y?: number; z?: number },
  ): void {
    this.add(UNIT_CYL, pos, { x: radius * 2, y: height, z: radius * 2 }, color, rotation);
  }

  cone(
    pos: { x: number; y: number; z: number },
    radius: number,
    height: number,
    color: THREE.ColorRepresentation,
    rotation?: { x?: number; y?: number; z?: number },
  ): void {
    this.add(UNIT_CONE, pos, { x: radius * 2, y: height, z: radius * 2 }, color, rotation);
  }

  /** A vertical quad facing +Z by default; rotate to face a direction. */
  quad(
    pos: { x: number; y: number; z: number },
    width: number,
    height: number,
    color: THREE.ColorRepresentation,
    rotation?: { x?: number; y?: number; z?: number },
    uv?: UvRect,
  ): void {
    this.add(UNIT_PLANE, pos, { x: width, y: height, z: 1 }, color, rotation, uv);
  }

  build(shadows: { cast: boolean; receive: boolean } = { cast: true, receive: true }): THREE.Mesh | null {
    if (this.parts.length === 0) return null;
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    if (!merged) {
      console.warn(`[geo] merge failed for bucket ${this.name}`);
      return null;
    }
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    const mesh = new THREE.Mesh(merged, this.material);
    mesh.name = this.name;
    mesh.castShadow = shadows.cast;
    mesh.receiveShadow = shadows.receive;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  dispose(): void {
    for (const p of this.parts) p.dispose();
    this.parts = [];
  }
}

/** Shared PBR material for tinted merged geometry. */
export function tintedMaterial(
  map: THREE.Texture | null,
  opts: Partial<THREE.MeshStandardMaterialParameters> = {},
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    map,
    roughness: 0.86,
    metalness: 0.02,
    ...opts,
  });
  if (map) {
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
  }
  return mat;
}

/**
 * Build a wheel with spokes, ready for rotation around its local X axis.
 * Origin is at the hub, wheel lies in the YZ plane (axle along X).
 */
export function createWheel(radius: number, tireColor = '#1b1b1b', rimColor = '#c9c9c9', spokes = 16): THREE.Group {
  const group = new THREE.Group();
  const tireGeo = new THREE.TorusGeometry(radius, Math.max(0.022, radius * 0.075), 6, 22);
  const tire = new THREE.Mesh(
    tireGeo,
    new THREE.MeshStandardMaterial({ color: new THREE.Color(tireColor), roughness: 0.92, metalness: 0.02 }),
  );
  tire.rotation.y = Math.PI / 2;
  tire.castShadow = true;
  group.add(tire);

  const rimGeo = new THREE.TorusGeometry(radius * 0.9, radius * 0.022, 5, 20);
  const rimMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(rimColor), roughness: 0.35, metalness: 0.75 });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.rotation.y = Math.PI / 2;
  group.add(rim);

  const spokeGeo = new THREE.CylinderGeometry(radius * 0.012, radius * 0.012, radius * 0.88, 4);
  const spokeMat = new THREE.MeshStandardMaterial({ color: 0xbfbfbf, metalness: 0.8, roughness: 0.35 });
  const spokeMesh = new THREE.InstancedMesh(spokeGeo, spokeMat, spokes);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    // spokes sit in the YZ plane, angled from hub outward
    e.set(0, 0, 0);
    q.setFromEuler(e);
    const dir = new THREE.Vector3(0, Math.cos(a), Math.sin(a));
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    m.compose(dir.clone().multiplyScalar(radius * 0.44), q, new THREE.Vector3(1, 1, 1));
    spokeMesh.setMatrixAt(i, m);
  }
  spokeMesh.instanceMatrix.needsUpdate = true;
  group.add(spokeMesh);

  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.14, radius * 0.14, radius * 0.22, 10),
    new THREE.MeshStandardMaterial({ color: 0x8d8d8d, metalness: 0.7, roughness: 0.4 }),
  );
  hub.rotation.z = Math.PI / 2;
  group.add(hub);
  return group;
}
