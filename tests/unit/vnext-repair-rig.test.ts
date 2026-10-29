import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { RickshawRig, DEFAULT_LOOK } from '../../src/vehicle/rickshawModel';
import { RIDE } from '../../src/core/config';
import { PassengerActor, archetypeById } from '../../src/missions/actors';

const vec = (mesh: THREE.Object3D, x: number, y: number, z: number) => mesh.localToWorld(new THREE.Vector3(x, y, z));

describe('rendered arm continuity', () => {
  it('connects the actual player/rival meshes to both steering grips throughout a turn', () => {
    const rig = new RickshawRig(DEFAULT_LOOK);
    for (const steerAngle of [-0.68, -0.3, 0, 0.3, 0.68]) {
      rig.applyDynamics({ steerAngle, wheelSpin: 0, pedalPhase: 0, roll: 0, pitch: 0, nightFactor: 0 });
      rig.root.updateMatrixWorld(true);
      for (const [side, name] of [[1, 'leftArm'], [-1, 'rightArm']] as const) {
        const arm = rig.puller.getObjectByName(name)!;
        expect(arm.children).toHaveLength(3);
        const upper = arm.getObjectByName('upperArm')!;
        const fore = arm.getObjectByName('foreArm')!;
        const hand = arm.getObjectByName('gripHand')!;
        const shoulder = vec(rig.puller, side * 0.185, 1.38, 0.08);
        const grip = vec(rig.steering, side * 0.275, 1.17, -0.195);
        expect(vec(upper, 0, -0.5, 0).distanceTo(shoulder)).toBeLessThan(1e-5);
        expect(vec(upper, 0, 0.5, 0).distanceTo(vec(fore, 0, -0.5, 0))).toBeLessThan(1e-5);
        expect(vec(fore, 0, 0.5, 0).distanceTo(vec(hand, 0, 0, 0))).toBeLessThan(1e-5);
        expect(vec(hand, 0, 0, 0).distanceTo(grip)).toBeLessThan(1e-5);
      }
    }
    expect(rig.steering.position.z).toBe(RIDE.frontAxleZ);
    rig.dispose();
  });

  it('keeps passenger hair and both hands attached when boarding and leaving', () => {
    const actor = new PassengerActor(archetypeById('shopper'));
    const scene = new THREE.Group();
    const seat = new THREE.Group();
    seat.position.y = 0.82; // actual rickshaw passenger mount height
    scene.add(actor.group, seat);
    actor.seat(seat);
    expect(actor.group.parent).toBe(seat);
    scene.updateMatrixWorld(true);
    for (const side of ['Left', 'Right']) {
      const thigh = actor.group.getObjectByName(`passenger${side}Leg`)!;
      const shin = actor.group.getObjectByName(`passenger${side}Shin`)!;
      expect(shin.visible).toBe(true);
      expect(vec(thigh, 0, -0.19, 0).distanceTo(vec(shin, 0, 0.14, 0))).toBeLessThan(1e-6);
      expect(vec(shin, 0, -0.14, 0).y).toBeCloseTo(0.57, 6); // footboard top
    }
    for (const name of ['passengerLeftArm', 'passengerRightArm']) {
      expect(actor.group.getObjectByName(name)?.getObjectByName('passengerHand')).toBeDefined();
    }
    const heads = actor.group.children.filter((o) => o instanceof THREE.Mesh && Math.abs(o.position.y - 0.74) < 1e-8);
    expect(heads).toHaveLength(2);
    actor.leave(scene, 0, 0, 0, 2, 0);
    expect(actor.group.parent).toBe(scene);
    expect(actor.group.getObjectByName('passengerLeftShin')!.visible).toBe(false);
    expect(actor.group.getObjectByName('passengerRightShin')!.visible).toBe(false);
    scene.updateMatrixWorld(true);
    for (const side of ['Left', 'Right']) {
      expect(vec(actor.group.getObjectByName(`passenger${side}Leg`)!, 0, -0.35, 0).y).toBeCloseTo(0, 6);
    }
    expect(actor.group.getObjectByName('passengerBag')!.position.toArray()).toEqual([0.22, 1.0, -0.04]);
    actor.dispose();
  });
});

import { InstancedTrafficFleet, NPC_STEERING_ANGLES, npcSteeringPose, type SteeringDriverType } from '../../src/ai/vehicles';

it('renders two continuous steering chains on the actual instanced NPC meshes at every pose and LOD', () => {
  const parent = new THREE.Group();
  const fleet = new InstancedTrafficFleet(parent, 3);
  const cylinderVerts = new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1, false).getAttribute('position').count;
  const boxVerts = new THREE.BoxGeometry(1, 1, 1).getAttribute('position').count;
  const types: SteeringDriverType[] = ['rickshaw', 'cng', 'easybike'];
  for (const type of types) for (const angle of NPC_STEERING_ANGLES) for (const nearLod of [false, true]) {
    fleet.sync([{ kind: type, x: 0, y: 0, z: 0, yaw: 0, wheelSpin: 0, variant: 0, visible: true, braking: false, nearLod, steerAngle: angle }]);
    const mesh = parent.getObjectByName(`traffic.${type}.steering.${angle}`) as THREE.InstancedMesh;
    expect(mesh.count).toBe(1);
    const wheels = parent.getObjectByName(type === 'rickshaw' ? 'traffic.wheels.spoked' : 'traffic.wheels.disc') as THREE.InstancedMesh;
    expect(wheels.count).toBe(3); // near and far LODs must both retain their wheels
    if (type !== 'rickshaw') {
      const pane = parent.getObjectByName(`traffic.${type}.windscreen`) as THREE.InstancedMesh;
      expect(pane.count).toBe(1);
      expect((pane.material as THREE.Material).transparent).toBe(true);
      expect((pane.material as THREE.Material).opacity).toBeLessThan(0.5);
    }
    const pos = mesh.geometry.getAttribute('position');
    const pose = npcSteeringPose(type, angle);
    for (let side = 0; side < 2; side++) {
      const arm = pose[side];
      const start = side * (2 * cylinderVerts + boxVerts);
      const handStart = start + 2 * cylinderVerts;
      const handCentre = new THREE.Vector3();
      for (let i = handStart; i < handStart + boxVerts; i++) handCentre.add(new THREE.Vector3().fromBufferAttribute(pos, i));
      handCentre.multiplyScalar(1 / boxVerts);
      expect(handCentre.distanceTo(new THREE.Vector3(arm.grip.x, arm.grip.y, arm.grip.z))).toBeLessThan(1e-5);
      expect(arm.upper.to).toEqual(arm.fore.from);
      expect(arm.fore.to).toEqual(arm.hand.center);
      // The merged cylinder vertices really reach both ends of each calculated segment.
      for (const [index, segment] of [[start, arm.upper], [start + cylinderVerts, arm.fore]] as const) {
        const from = new THREE.Vector3(segment.from.x, segment.from.y, segment.from.z);
        const to = new THREE.Vector3(segment.to.x, segment.to.y, segment.to.z);
        const axis = to.clone().sub(from).normalize();
        let min = Infinity, max = -Infinity;
        for (let i = index; i < index + cylinderVerts; i++) {
          const projection = new THREE.Vector3().fromBufferAttribute(pos, i).sub(from).dot(axis);
          min = Math.min(min, projection); max = Math.max(max, projection);
        }
        expect(Math.abs(min)).toBeLessThan(1e-5);
        expect(Math.abs(max - segment.length)).toBeLessThan(1e-5);
      }
    }
  }
});

it('does not leak far-wheel scaling into the next vehicle instance', () => {
  const parent = new THREE.Group();
  const fleet = new InstancedTrafficFleet(parent, 2);
  const base = { kind: 'rickshaw' as const, y: 0, z: 0, yaw: 0, wheelSpin: 0, variant: 0, visible: true, braking: false };
  fleet.sync([{ ...base, x: 0, nearLod: false }, { ...base, x: 10, nearLod: true }]);
  const body = parent.getObjectByName('traffic.rickshaw.primary') as THREE.InstancedMesh;
  const transform = new THREE.Matrix4();
  body.getMatrixAt(1, transform);
  const scale = new THREE.Vector3();
  transform.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
  expect(scale.toArray()).toEqual([1, 1, 1]);
  expect((parent.getObjectByName('traffic.wheels.spoked') as THREE.InstancedMesh).count).toBe(6);
});
