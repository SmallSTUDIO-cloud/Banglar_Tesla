import * as THREE from 'three';
import { Bucket } from './geo';

/** A small, open-canopy street tree assembled into the existing sector detail
 * mesh. No per-tree Mesh, material, light, texture, animation or draw call. */
const trunk = new THREE.CylinderGeometry(0.115, 0.20, 1, 7);
const branch = new THREE.CylinderGeometry(0.035, 0.105, 1, 5);
// One softly irregular low-poly crown shared by all trees. Four overlapping
// masses replace six disconnected bright globes; the opaque sector bucket and
// indexed geometry keep the same draw-call count without alpha-leaf overdraw.
const crown = new THREE.SphereGeometry(1, 8, 6);
const crownPositions = crown.getAttribute('position') as THREE.BufferAttribute;
for (let i = 0; i < crownPositions.count; i++) {
  const x = crownPositions.getX(i), y = crownPositions.getY(i), z = crownPositions.getZ(i);
  const radius = 1 + 0.075 * Math.sin(x * 9 + z * 7 + y * 5) +
    0.05 * Math.cos(x * 5 - z * 11);
  crownPositions.setXYZ(i, x * radius, y * (1 + 0.055 * Math.sin(x * 7 + z * 4)), z * radius);
}
crown.computeVertexNormals();
const up = new THREE.Vector3(0, 1, 0);

export interface StreetTree {
  x: number;
  z: number;
  height: number;
  seed: number;
  flowering: boolean;
}

/** Height is the clear trunk height; the crown begins above a pedestrian. */
export function addStreetTree(bucket: Bucket, tree: StreetTree): void {
  const { x, z, height: h, seed, flowering } = tree;
  // A separate coordinate hash leaves the city's seeded building/traffic
  // layout untouched. Only authored variety (shape/colour) depends on this.
  const noise = (n: number): number => {
    let value = (seed ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0;
    value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
    value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
  };
  const rotate = noise(1) * Math.PI * 2;
  bucket.add(trunk, { x, y: h * 0.47, z }, { x: 1, y: h * 0.94, z: 1 }, '#68523a');

  // Real branching reads from below; the old trees were a pole with two cones.
  // Every fork ends under foliage, so short branches have no exposed cut ends.
  for (let i = 0; i < 3; i++) {
    const angle = rotate + i * Math.PI * 2 / 3;
    const reach = 0.95 + noise(i + 2) * 0.36;
    const from = new THREE.Vector3(x, h * (0.65 + 0.035 * i), z);
    const to = new THREE.Vector3(x + Math.cos(angle) * reach, h + 0.28 + noise(i + 5) * 0.25,
      z + Math.sin(angle) * reach);
    const delta = to.clone().sub(from);
    const euler = new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion().setFromUnitVectors(up, delta.clone().normalize()), 'YXZ');
    bucket.add(branch, from.add(to).multiplyScalar(0.5), { x: 1, y: delta.length(), z: 1 },
      '#70563c', { x: euler.x, y: euler.y, z: euler.z });
  }

  // Uneven overlapping broadleaf lobes: a flattened interior crown with a
  // broken outer silhouette. Opaque rounded masses match the stylised city
  // without translucent leaf cards (costly overdraw on mobile GPUs).
  const greens = ['#365b43', '#436a48', '#4e704e', '#3f6545', '#567653'];
  // The centre overlaps three lower crowns, producing a single shaded canopy
  // rather than individual balloons. Coordinate hash varies each silhouette.
  const green = greens[Math.floor(noise(41) * greens.length)];
  bucket.add(crown, { x, y: h + 0.76, z },
    { x: 1.45 + noise(10) * 0.20, y: 0.99, z: 1.38 + noise(11) * 0.22 }, green,
    { y: rotate * 0.4, z: (noise(12) - 0.5) * 0.12 });
  for (let i = 0; i < 3; i++) {
    const angle = rotate + i * Math.PI * 2 / 3;
    const radius = 0.70 + noise(i + 8) * 0.19;
    const lx = x + Math.cos(angle) * radius;
    const lz = z + Math.sin(angle) * radius;
    bucket.add(crown, { x: lx, y: h + 0.43 + noise(i + 15) * 0.21, z: lz },
      { x: 0.95 + noise(i + 23) * 0.18, y: 0.77 + noise(i + 35) * 0.13,
        z: 0.92 + noise(i + 29) * 0.18 },
      greens[(Math.floor(noise(i + 39) * greens.length) + i) % greens.length],
      { y: angle * 0.6, z: (noise(i + 44) - 0.5) * 0.20 });
  }
  // Flowering trees stay leafy; only three small clusters carry muted colour.
  if (flowering) {
    for (let i = 0; i < 3; i++) {
      const angle = rotate + i * Math.PI * 2 / 3;
      const r = 1.12 + noise(i + 50) * 0.18;
      bucket.add(crown,
        { x: x + Math.cos(angle) * r, y: h + 0.78 + noise(i + 53) * 0.25,
          z: z + Math.sin(angle) * r },
        { x: 0.22, y: 0.14, z: 0.22 },
        i % 2 ? '#ae806f' : '#aa796d');
    }
  }
}
