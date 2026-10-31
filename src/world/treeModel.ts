import * as THREE from 'three';
import { Bucket } from './geo';

/** A small, open-canopy street tree assembled into the existing sector detail
 * mesh. No per-tree Mesh, material, light, texture, animation or draw call. */
const trunk = new THREE.CylinderGeometry(0.115, 0.20, 1, 7);
const branch = new THREE.CylinderGeometry(0.035, 0.105, 1, 5);
// A 7×5 smooth ellipsoid gives rounded leaf masses at a fraction of the
// triangles/overdraw of individual leaves or alpha-tested cards. Indexed like
// the sector boxes, so mergeGeometries can batch the entire street frontage.
const crown = new THREE.SphereGeometry(1, 7, 5);
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
  const green = ['#335841', '#416d46', '#4a7348', '#53724b', '#396649'];
  const warm = ['#477248', '#a55a43', '#507a48', '#b56847', '#477048'];
  const palette = flowering ? warm : green;
  for (let i = 0; i < 6; i++) {
    const angle = rotate + i * Math.PI * 2 / 5;
    const center = i === 5;
    const radius = center ? 0 : 1.08 + (noise(i + 8) - 0.5) * 0.45;
    const lx = x + Math.cos(angle) * radius;
    const lz = z + Math.sin(angle) * radius;
    const y = h + (center ? 0.98 : 0.50 + (noise(i + 15) - 0.5) * 0.36);
    const width = center ? 1.24 : 1.03 + noise(i + 23) * 0.25;
    const depth = center ? 1.20 : 0.96 + noise(i + 29) * 0.23;
    bucket.add(crown, { x: lx, y, z: lz },
      { x: width, y: center ? 0.96 : 0.82 + noise(i + 35) * 0.18, z: depth },
      palette[(i + Math.floor(noise(i + 39) * 4)) % palette.length],
      { y: angle * 0.65, z: (noise(i + 44) - 0.5) * 0.24 });
  }
}
