import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { InstancedTrafficFleet, getTrafficArchetype, TRAFFIC_TYPES } from '../../src/ai/vehicles';

const state = (kind: (typeof TRAFFIC_TYPES)[number], z: number) => ({
  kind, x: 0, y: 0, z, yaw: 0, wheelSpin: 2, variant: 0,
  visible: true, braking: false, nearLod: true,
});
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 150);
camera.lookAt(0, 0, -1);
camera.updateMatrixWorld();
const frustum = new THREE.Frustum().setFromProjectionMatrix(
  new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
);

describe('live bounds on native-cullable traffic instances', () => {
  it.each(TRAFFIC_TYPES)('%s restores all body and wheel layers after leaving and re-entering the view', (kind) => {
    const parent = new THREE.Group(), fleet = new InstancedTrafficFleet(parent, 2);
    const body = parent.getObjectByName(`traffic.${kind}.primary`) as THREE.InstancedMesh;
    const detail = parent.getObjectByName(`traffic.${kind}.detail`) as THREE.InstancedMesh;
    const wheels = parent.getObjectByName(`traffic.wheels.${getTrafficArchetype(kind).spokedWheels ? 'spoked' : 'disc'}`) as THREE.InstancedMesh;
    const originalChildren = parent.children.length;
    for (let i = 0; i < 6; i++) {
      fleet.sync([state(kind, -20)]);
      for (const mesh of [body, detail, wheels]) {
        expect(mesh.frustumCulled).toBe(true);
        expect(mesh.boundingSphere).not.toBeNull();
        expect(frustum.intersectsObject(mesh)).toBe(true);
      }
      fleet.sync([state(kind, 20)]);
      for (const mesh of [body, detail, wheels]) expect(frustum.intersectsObject(mesh)).toBe(false);
      fleet.sync([{ ...state(kind, -20), visible: false }]);
      expect(body.count).toBe(0);
      expect(wheels.count).toBe(0);
      expect(parent.children.length).toBe(originalChildren);
    }
  });

  it('keeps separated wheel, glass and steering layers in view for a partially visible vehicle', () => {
    const parent = new THREE.Group(), fleet = new InstancedTrafficFleet(parent, 1);
    fleet.sync([{ ...state('cng', -20), x: 10 }]);
    for (const name of ['traffic.cng.primary','traffic.cng.detail','traffic.cng.windscreen','traffic.cng.steering.0','traffic.wheels.disc']) {
      const mesh = parent.getObjectByName(name) as THREE.InstancedMesh;
      expect(mesh.count).toBeGreaterThan(0);
      expect(frustum.intersectsObject(mesh), name).toBe(true);
    }
  });
});
