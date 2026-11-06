import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Bucket } from '../../src/world/geo';
import { addStreetTree } from '../../src/world/treeModel';

function build(seed: number): THREE.Mesh {
  const bucket = new Bucket('tree.unit', new THREE.MeshLambertMaterial({ vertexColors: true }));
  addStreetTree(bucket, { x: 0, z: 0, height: 3.8, seed, flowering: false });
  return bucket.build({ cast: false, receive: false })!;
}

describe('bounded street-tree silhouette', () => {
  it('batches tapered trunks, forked branches and opaque crowns into one indexed mesh', () => {
    const mesh = build(73);
    const positions = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colours = mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    expect(mesh.geometry.index).not.toBeNull();
    expect(positions.count).toBeGreaterThan(120);
    expect(mesh.geometry.index!.count / 3).toBeLessThan(450);
    expect(colours.count).toBe(positions.count);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.01);
    expect(box.max.y).toBeGreaterThan(4.4);
    expect(box.max.y).toBeLessThan(7.3);
    expect(box.max.x).toBeGreaterThan(1.3);
    expect(box.min.x).toBeLessThan(-1.3);
    expect(mesh.material).toBeInstanceOf(THREE.MeshLambertMaterial);
    mesh.geometry.dispose();
  });

  it('keeps the geometry deterministic per authored position without changing gameplay RNG', () => {
    const a = build(17), b = build(17), c = build(18);
    const position = (m: THREE.Mesh) => Array.from((m.geometry.getAttribute('position') as THREE.BufferAttribute).array);
    expect(position(a)).toEqual(position(b));
    expect(position(c)).not.toEqual(position(a));
    for (const mesh of [a, b, c]) mesh.geometry.dispose();
  });
});
