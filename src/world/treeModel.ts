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
  // Break the spherical outline at the existing vertex budget; shadows and
  // daylight now catch irregular branch-sized lobes rather than smooth balls.
  const radius = 1 + 0.13 * Math.sin(x * 9 + z * 7 + y * 5) +
    0.075 * Math.cos(x * 5 - z * 11);
  crownPositions.setXYZ(i, x * radius, y * (1 + 0.08 * Math.sin(x * 7 + z * 4)), z * radius);
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
  // Three silhouettes at the same four-crown budget: spreading shade trees,
  // compact roadside trees and taller, narrower crowns. No extra meshes.
  const species = Math.floor(noise(70) * 3);
  const spread = species === 1 ? 0.91 : species === 2 ? 0.92 : 1;
  const lift = species === 2 ? 0.24 : species === 1 ? -0.09 : 0;
  bucket.add(trunk, { x, y: h * 0.47, z }, { x: 1, y: h * 0.94, z: 1 }, '#68523a');
  // Two low planted clumps make the curbside tree read as layered greenery
  // from the driving camera. Both share the opaque sector bucket and stay
  // inside the already-clear tree footprint (no new foliage transparency).
  for (let i = 0; i < 2; i++) {
    const a = rotate + i * Math.PI;
    bucket.cone({ x: x + Math.cos(a) * 0.27, y: 0.20, z: z + Math.sin(a) * 0.27 },
      0.23, 0.40, i === 0 ? '#365845' : '#466b49');
  }

  // A few tree pits carry self-seeded roadside undergrowth. Tiny, non-solid
  // clumps remain within the validated clear radius around the trunk.
  if (noise(72) < 0.38) {
    for (let i = 0; i < 3; i++) {
      const a = rotate + i * 2.40;
      const r = 0.48 + noise(i + 73) * 0.18;
      bucket.cone({ x: x + Math.cos(a) * r, y: 0.15 + i * 0.025,
        z: z + Math.sin(a) * r }, 0.14 + noise(i + 77) * 0.055,
        0.29 + noise(i + 81) * 0.13,
        i % 2 ? '#4b6941' : '#61704b');
    }
  }

  // Real branching reads from below; the old trees were a pole with two cones.
  // Every fork ends under foliage, so short branches have no exposed cut ends.
  for (let i = 0; i < 3; i++) {
    const angle = rotate + i * Math.PI * 2 / 3;
    const reach = (0.95 + noise(i + 2) * 0.36) * spread;
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
  bucket.add(crown, { x, y: h + 0.76 + lift, z },
    { x: (1.45 + noise(10) * 0.20) * spread, y: species === 2 ? 1.28 : 0.99,
      z: (1.38 + noise(11) * 0.22) * spread }, green,
    { y: rotate * 0.4, z: (noise(12) - 0.5) * 0.12 });
  for (let i = 0; i < 3; i++) {
    const angle = rotate + i * Math.PI * 2 / 3;
    const radius = (0.70 + noise(i + 8) * 0.19) * spread;
    const lx = x + Math.cos(angle) * radius;
    const lz = z + Math.sin(angle) * radius;
    bucket.add(crown, { x: lx, y: h + 0.43 + lift + noise(i + 15) * 0.21, z: lz },
      { x: (0.95 + noise(i + 23) * 0.18) * spread,
        y: (0.77 + noise(i + 35) * 0.13) * (species === 2 ? 1.24 : 1),
        z: (0.92 + noise(i + 29) * 0.18) * spread },
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
