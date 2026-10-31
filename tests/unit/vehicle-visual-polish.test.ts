import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { QUALITY } from '../../src/core/config';
import { InstancedTrafficFleet, TRAFFIC_TYPES, getTrafficArchetype } from '../../src/ai/vehicles';
import { TrafficSystem } from '../../src/ai/traffic';
import { DEFAULT_LOOK, RickshawRig } from '../../src/vehicle/rickshawModel';

const pose = { steerAngle: 0, wheelSpin: 1.2, pedalPhase: 0, roll: 0, pitch: 0, nightFactor: 0 };

describe('vehicle presentation without gameplay changes', () => {
  it('keeps pedal rickshaw feet anti-phased with real crank height and travel', () => {
    const rig = new RickshawRig(DEFAULT_LOOK, { isPlayer: true });
    const left = rig.puller.getObjectByName('leftLeg')!;
    const right = rig.puller.getObjectByName('rightLeg')!;
    rig.applyDynamics({ ...pose, wheelSpin: 0 });
    expect(left.position.y).toBeGreaterThan(right.position.y);
    expect(left.position.z).toBeCloseTo(right.position.z);
    expect(rig.crank.rotation.x).toBe(0);
    rig.applyDynamics({ ...pose, pedalPhase: Math.PI / 2 });
    expect(left.position.y).toBeCloseTo(right.position.y);
    expect(left.position.z).toBeGreaterThan(right.position.z);
    expect(rig.crank.rotation.x).toBeCloseTo(Math.PI / 2);
    rig.applyDynamics({ ...pose, pedalPhase: Math.PI });
    expect(left.position.y).toBeLessThan(right.position.y);
    rig.dispose();
  });

  it('keeps steering hands connected and wheel radius synchronized in the hero rig', () => {
    const rig = new RickshawRig(DEFAULT_LOOK, { isPlayer: true });
    expect((rig as any).driverArms).toHaveLength(2);
    rig.applyDynamics({ ...pose, steerAngle: -0.4 });
    expect(rig.steering.rotation.y).toBeCloseTo(0.4);
    expect(rig.frontWheel.rotation.x).toBeCloseTo(1.2 * rig.rearWheelRadius / rig.frontWheelRadius);
    expect(rig.rearWheels[0].rotation.x).toBeCloseTo(rig.rearWheels[1].rotation.x);
    for (const arm of (rig as any).driverArms) {
      expect(arm.hand.position.y).toBeCloseTo(1.17);
      expect(arm.hand.position.distanceTo(arm.fore.position)).toBeLessThan(0.35);
    }
    rig.dispose();
  });

  it('keeps the exact same wheel phase when traffic crosses either side of its LOD band', () => {
    const parent = new THREE.Group();
    const fleet = new InstancedTrafficFleet(parent, 2);
    const matrix = new THREE.Matrix4();
    const near = new THREE.Quaternion(), far = new THREE.Quaternion();
    for (const kind of ['car', 'rickshaw', 'motorbike'] as const) {
      const agent = { kind, x: 0, y: 0, z: 0, yaw: 0.2, wheelSpin: 1.2,
        variant: 0, visible: true, braking: false, nearLod: true };
      const wheels = parent.getObjectByName(kind === 'car' ? 'traffic.wheels.disc' : 'traffic.wheels.spoked') as THREE.InstancedMesh;
      fleet.sync([agent]);
      wheels.getMatrixAt(0, matrix);
      matrix.decompose(new THREE.Vector3(), near, new THREE.Vector3());
      fleet.sync([{ ...agent, nearLod: false }]);
      expect(wheels.count).toBe(getTrafficArchetype(kind).wheelMounts.length);
      wheels.getMatrixAt(0, matrix);
      matrix.decompose(new THREE.Vector3(), far, new THREE.Vector3());
      expect(near.angleTo(far)).toBeLessThan(0.0002);
    }
  });

  it('keeps visible far vehicles spinning while they move at the existing reduced AI rate', () => {
    const traffic = new TrafficSystem(QUALITY.low);
    const t = traffic as any;
    const agent = t.agents[0];t.agents = [agent];
    agent.speed = 4;agent.cruise = 7;agent.dwellTimer = 0;
    const before = agent.wheelSpin;
    traffic.setPlayer(agent.x + 120, agent.z, 0);
    for (let i = 0; i < 60; i++) traffic.update(1 / 30);
    expect(agent.nearLod).toBe(false);
    expect(agent.visible).toBe(true);
    expect(agent.wheelSpin).toBeGreaterThan(before + 2);
    traffic.dispose();
  });

  it('keeps all eight fleet silhouettes grounded and using their original wheel counts', () => {
    const wheels = [3, 3, 3, 4, 4, 4, 4, 2];
    for (const [i, kind] of TRAFFIC_TYPES.entries()) {
      const arch = getTrafficArchetype(kind);
      expect(arch.wheelMounts).toHaveLength(wheels[i]);
      expect(arch.wheelMounts.every(m => m.y === arch.wheelRadius)).toBe(true);
      expect(arch.wheelRadius).toBeGreaterThan(0.2);
    }
  });
});
