import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { RivalVisualBatch } from '../../src/blacklist/rivalBatch';

describe('race rival material batching', () => {
  it('preserves each animated source vertex through parent, wheel and arm transforms and restores on disposal', () => {
    const scene = new THREE.Scene();
    const parent = new THREE.Group();
    parent.position.set(7, 2, -4);
    parent.rotation.y = 0.4;
    scene.add(parent);
    const root = new THREE.Group();
    root.position.set(-3, 1, 9);
    parent.add(root);
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    const geom = new THREE.BoxGeometry(1, 1, 1);
    geom.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geom.getAttribute('position').count * 3).fill(1), 3));
    const first = new THREE.Mesh(geom, material);
    const second = new THREE.Mesh(geom, material);
    first.position.set(1, 0.5, -1);
    second.position.set(-2, 1, 2);
    second.scale.set(1, 0.4, 1);
    second.rotation.z = 0.7;
    root.add(first, second);
    const batch = new RivalVisualBatch(parent, [root]);
    const merged = parent.children.find((x): x is THREE.SkinnedMesh => x instanceof THREE.SkinnedMesh);
    expect(merged).toBeDefined();
    expect(first.visible).toBe(false);
    expect(second.visible).toBe(false);
    const count = geom.index!.count;
    for (const twist of [0, -0.55, 0.55]) {
      root.rotation.y = twist;
      first.rotation.x = twist * 2;
      second.scale.y = 0.2 + Math.abs(twist);
      scene.updateMatrixWorld(true);
      merged!.skeleton.update();
      for (const [source, offset] of [[first, 0], [second, count]] as const) {
        const index = geom.index!.getX(0);
        const expected = new THREE.Vector3().fromBufferAttribute(geom.getAttribute('position'), index).applyMatrix4(source.matrixWorld);
        const actual = merged!.getVertexPosition(offset, new THREE.Vector3()).applyMatrix4(merged!.matrixWorld);
        expect(actual.distanceTo(expected)).toBeLessThan(1e-6);
      }
    }
    const before = parent.children.length;
    batch.dispose();
    expect(first.visible).toBe(true);
    expect(second.visible).toBe(true);
    expect(parent.children.length).toBe(before - 1);
    expect(first.children).toHaveLength(0);
    expect(second.children).toHaveLength(0);
    geom.dispose(); material.dispose();
  });
});
