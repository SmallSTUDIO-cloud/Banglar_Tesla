/**
 * Traffic vehicle models, built from merged primitives. Each returns a Group
 * with a `wheels` array so the caller can spin them.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const geoCache = new Map<string, THREE.BufferGeometry>();

function boxGeo(w: number, h: number, d: number, color: string, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  const c = new THREE.Color(color);
  const count = g.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged ?? new THREE.BufferGeometry();
}

const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.28 });
const glassMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.16,
  metalness: 0.6,
  color: 0xffffff,
});
const tireMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.95 });

export interface TrafficModel {
  group: THREE.Group;
  wheels: THREE.Object3D[];
  halfLength: number;
  halfWidth: number;
  height: number;
}

function wheel(radius = 0.34, width = 0.22): THREE.Mesh {
  const key = `wheel:${radius}:${width}`;
  let geo = geoCache.get(key);
  if (!geo) {
    geo = new THREE.CylinderGeometry(radius, radius, width, 12);
    geo.rotateZ(Math.PI / 2);
    geoCache.set(key, geo);
  }
  const mesh = new THREE.Mesh(geo, tireMat);
  mesh.castShadow = true;
  return mesh;
}

function addWheels(group: THREE.Group, positions: [number, number, number][], radius: number, width: number): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const [x, y, z] of positions) {
    const w = wheel(radius, width);
    w.position.set(x, y, z);
    group.add(w);
    out.push(w);
  }
  return out;
}

/** Big painted bus with fictional operator livery. */
export function makeBus(bodyColor = '#c0392b', accent = '#f0d070'): TrafficModel {
  const group = new THREE.Group();
  const parts: THREE.BufferGeometry[] = [
    boxGeo(2.45, 1.55, 8.8, bodyColor, 0, 1.15, 0),
    boxGeo(2.42, 1.15, 8.6, '#ded6c4', 0, 2.42, 0),
    boxGeo(2.5, 0.14, 8.9, accent, 0, 3.05, 0),
    boxGeo(2.3, 0.6, 8.2, bodyColor, 0, 3.35, 0),
    boxGeo(2.52, 0.18, 8.9, '#2c2c2c', 0, 0.5, 0),
    // bumpers
    boxGeo(2.5, 0.3, 0.3, '#3a3a3a', 0, 0.6, 4.45),
    boxGeo(2.5, 0.3, 0.3, '#3a3a3a', 0, 0.6, -4.45),
    // roof rack
    boxGeo(2.0, 0.1, 3.2, '#6b5a44', 0, 3.75, -0.6),
  ];
  const glass: THREE.BufferGeometry[] = [
    boxGeo(2.3, 0.72, 7.6, '#16232c', 0, 2.42, 0.2),
    boxGeo(2.20, 0.9, 0.12, '#16232c', 0, 2.35, 4.34),
    boxGeo(2.2, 0.9, 0.12, '#16232c', 0, 2.35, -4.34),
  ];
  const body = new THREE.Mesh(merge(parts), bodyMat);
  body.castShadow = true;
  const windows = new THREE.Mesh(merge(glass), glassMat);
  group.add(body, windows);
  const wheels = addWheels(
    group,
    [
      [-1.2, 0.52, 2.9],
      [1.2, 0.52, 2.9],
      [-1.2, 0.52, -2.6],
      [1.2, 0.52, -2.6],
    ],
    0.52,
    0.34,
  );
  return { group, wheels, halfLength: 4.5, halfWidth: 1.3, height: 3.8 };
}

export function makeCar(color = '#d9d4c6'): TrafficModel {
  const group = new THREE.Group();
  const parts = [
    boxGeo(1.78, 0.62, 4.2, color, 0, 0.62, 0),
    boxGeo(1.6, 0.52, 2.1, color, 0, 1.16, -0.15),
    boxGeo(1.82, 0.14, 4.24, '#2b2b2b', 0, 0.34, 0),
    boxGeo(1.7, 0.12, 0.22, '#c9c9c9', 0, 0.72, 2.12),
    boxGeo(1.7, 0.12, 0.22, '#c9c9c9', 0, 0.72, -2.12),
  ];
  const glass = [boxGeo(1.5, 0.44, 1.9, '#1b2b33', 0, 1.16, -0.15)];
  const body = new THREE.Mesh(merge(parts), bodyMat);
  body.castShadow = true;
  group.add(body, new THREE.Mesh(merge(glass), glassMat));
  const wheels = addWheels(
    group,
    [
      [-0.84, 0.32, 1.35],
      [0.84, 0.32, 1.35],
      [-0.84, 0.32, -1.35],
      [0.84, 0.32, -1.35],
    ],
    0.32,
    0.2,
  );
  return { group, wheels, halfLength: 2.2, halfWidth: 0.95, height: 1.6 };
}

/** CNG auto-rickshaw — visually distinct from the pedal rickshaw. */
export function makeCNG(): TrafficModel {
  const group = new THREE.Group();
  const parts = [
    boxGeo(1.3, 0.85, 2.2, '#1f7a4f', 0, 0.72, -0.1),
    boxGeo(1.25, 0.8, 0.9, '#1f7a4f', 0, 0.7, 1.15),
    boxGeo(1.34, 0.1, 2.4, '#c9c9c9', 0, 0.32, 0),
    boxGeo(1.24, 0.42, 1.35, '#2b8f5f', 0, 1.5, -0.55),
    boxGeo(1.28, 0.1, 1.4, '#d8d2c4', 0, 1.72, -0.55),
    boxGeo(0.5, 0.28, 0.06, '#f0d070', 0, 1.35, 1.62),
  ];
  const glass = [
    boxGeo(1.12, 0.5, 0.9, '#1a2a32', 0, 1.14, 1.0),
    boxGeo(1.12, 0.42, 0.06, '#1a2a32', 0, 1.2, 1.58),
  ];
  const body = new THREE.Mesh(merge(parts), bodyMat);
  body.castShadow = true;
  group.add(body, new THREE.Mesh(merge(glass), glassMat));
  const wheels = addWheels(
    group,
    [
      [0, 0.3, 1.35],
      [-0.62, 0.3, -0.75],
      [0.62, 0.3, -0.75],
    ],
    0.3,
    0.16,
  );
  return { group, wheels, halfLength: 1.5, halfWidth: 0.7, height: 1.9 };
}

export function makeMotorcycle(): TrafficModel {
  const group = new THREE.Group();
  const parts = [
    boxGeo(0.22, 0.3, 1.3, '#1b3a7a', 0, 0.62, 0),
    boxGeo(0.42, 0.12, 0.6, '#2a2a2a', 0, 0.86, -0.15),
    boxGeo(0.3, 0.1, 0.5, '#3a3a3a', 0, 1.0, -0.35),
    boxGeo(0.55, 0.5, 0.25, '#c95a3a', 0, 1.15, 0.0),
    boxGeo(0.24, 0.24, 0.24, '#8a5a3c', 0, 1.55, 0.0),
    boxGeo(0.5, 0.08, 0.12, '#2a2a2a', 0, 1.28, 0.15),
  ];
  const body = new THREE.Mesh(merge(parts), bodyMat);
  body.castShadow = true;
  group.add(body);
  const wheels = addWheels(
    group,
    [
      [0, 0.3, 0.68],
      [0, 0.3, -0.66],
    ],
    0.3,
    0.1,
  );
  return { group, wheels, halfLength: 0.9, halfWidth: 0.3, height: 1.7 };
}

/** Another pedal rickshaw (simplified) for traffic variety. */
export function makeRickshaw(color = '#b8322a'): TrafficModel {
  const group = new THREE.Group();
  const parts = [
    boxGeo(1.0, 0.5, 1.35, color, 0, 0.62, -0.25),
    boxGeo(1.06, 0.16, 0.7, '#7a1f18', 0, 0.9, -0.62),
    boxGeo(0.95, 0.12, 0.5, '#2a2a2a', 0, 0.42, -0.25),
    boxGeo(0.06, 0.75, 0.06, '#2f2f2f', 0, 0.75, 0.5),
    boxGeo(0.5, 0.06, 0.08, '#c9c9c9', 0, 1.12, 0.5),
    boxGeo(1.1, 0.55, 0.9, '#332a24', 0, 1.42, -0.75),
    boxGeo(1.14, 0.78, 0.06, '#d8a24a', 0, 0.86, -1.02),
    boxGeo(1.0, 0.75, 0.08, '#e8b25a', 0, 0.9, -1.0),
    boxGeo(0.5, 0.55, 0.42, '#d8d0c0', 0, 1.12, 0.1),
    boxGeo(0.24, 0.24, 0.24, '#8a5a3c', 0, 1.5, 0.12),
  ];
  const body = new THREE.Mesh(merge(parts), bodyMat);
  body.castShadow = true;
  group.add(body);
  const wheels = addWheels(
    group,
    [
      [0, 0.34, 0.62],
      [-0.53, 0.34, -0.45],
      [0.53, 0.34, -0.45],
    ],
    0.34,
    0.08,
  );
  return { group, wheels, halfLength: 1.25, halfWidth: 0.6, height: 1.75 };
}

export function makeTruck(color = '#3f5a7a'): TrafficModel {
  const group = new THREE.Group();
  const parts = [
    boxGeo(2.1, 1.5, 2.2, color, 0, 1.25, 2.0),
    boxGeo(2.2, 2.1, 4.2, '#d6c49a', 0, 1.6, -1.3),
    boxGeo(2.24, 0.5, 4.24, '#8a6a3a', 0, 2.5, -1.3),
    boxGeo(2.24, 0.14, 6.4, '#4a4a4a', 0, 0.42, 0),
    boxGeo(2.2, 0.2, 0.3, '#2a2a2a', 0, 0.55, 3.2),
  ];
  const glass = [boxGeo(1.95, 0.6, 0.1, '#1a2a32', 0, 1.75, 3.08)];
  const body = new THREE.Mesh(merge(parts), bodyMat);
  body.castShadow = true;
  group.add(body, new THREE.Mesh(merge(glass), glassMat));
  const wheels = addWheels(
    group,
    [
      [-0.95, 0.45, 2.2],
      [0.95, 0.45, 2.2],
      [-0.95, 0.45, -1.6],
      [0.95, 0.45, -1.6],
    ],
    0.45,
    0.3,
  );
  return { group, wheels, halfLength: 3.2, halfWidth: 1.15, height: 2.8 };
}

export const VEHICLE_MAKERS = {
  bus: makeBus,
  car: makeCar,
  cng: makeCNG,
  motorcycle: makeMotorcycle,
  rickshaw: makeRickshaw,
  truck: makeTruck,
} as const;

export type VehicleKind = keyof typeof VEHICLE_MAKERS;

export const TRAFFIC_PALETTE: Record<VehicleKind, string[]> = {
  bus: ['#c0392b', '#1f6b4f', '#2b4c7e', '#8a3a2a'],
  car: ['#d9d4c6', '#2b2b2b', '#b8c4cc', '#7a2a2a', '#365a7a', '#e0d8a8'],
  cng: ['#1f7a4f'],
  motorcycle: ['#1b3a7a', '#7a1f18', '#2a2a2a'],
  rickshaw: ['#b8322a', '#1c5a3a', '#1c3f7a', '#7a1f5a'],
  truck: ['#3f5a7a', '#6b4a2a', '#4a6b3a'],
};
