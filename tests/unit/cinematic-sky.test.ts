import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EnvironmentSystem } from '../../src/world/environment';
import { QUALITY } from '../../src/core/config';

describe('camera-following sky for gameplay and cockpit mirrors', () => {
  it('stays inside the shortest camera far plane and uses local sky direction', () => {
    const scene = new THREE.Scene();
    const env = new EnvironmentSystem(scene, QUALITY.balanced);
    const sky = env.sky;
    const radius = (sky.geometry as THREE.SphereGeometry).parameters.radius;
    expect(radius).toBeLessThan(105); // cockpit mirror far plane
    expect(radius).toBeGreaterThan(50); // behind nearby street geometry
    expect(sky.frustumCulled).toBe(false);
    expect(sky.renderOrder).toBeLessThan(0);
    expect((sky.material as THREE.ShaderMaterial).vertexShader).toContain('normalize(position)');
    const camera = new THREE.PerspectiveCamera(54, 1, 0.18, 105);
    for (const point of [[42, 2, 106], [-115, 3, -133], [20, 6, -48]] as [number, number, number][]) {
      camera.position.set(...point);
      // Mirrors use a different camera in the same render cycle.
      sky.onBeforeRender({} as THREE.WebGLRenderer, scene, camera, sky.geometry, sky.material as THREE.Material, new THREE.Group());
      expect(sky.position.toArray()).toEqual(point);
      expect(sky.matrixWorld.elements[12]).toBeCloseTo(point[0]);
    }
    sky.geometry.dispose();
    (sky.material as THREE.Material).dispose();
  });
});
