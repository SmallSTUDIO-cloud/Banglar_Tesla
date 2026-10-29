import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PedestrianSystem, PED_PATHS } from '../../src/ai/pedestrians';
import { QUALITY } from '../../src/core/config';
import { isInsideDrmcCampus } from '../../src/world/drmcGeo';
import { isClearOfRoads } from '../../src/world/layout';
import { PassengerActor, archetypeById } from '../../src/missions/actors';

type CrowdInternals = {
  peds: { pathIdx: number; worldX: number; worldZ: number; roadsideReserved: boolean; roadsideCooldownUntil: number }[];
  body: THREE.InstancedMesh; head: THREE.InstancedMesh; hair: THREE.InstancedMesh;
  armL: THREE.InstancedMesh; armR: THREE.InstancedMesh; legL: THREE.InstancedMesh; legR: THREE.InstancedMesh;
  skirt: THREE.InstancedMesh; bag: THREE.InstancedMesh;
};

describe('roadside caller crowd identity and cleanup', () => {
  it('borrows one real walker without duplicating its instances and retains its individual cooldown', () => {
    const crowd = new PedestrianSystem(QUALITY.pc_high);
    const inner = crowd as unknown as CrowdInternals;
    let caller: ReturnType<typeof crowd.reserveRoadsideCaller> = null;
    let px = 0, pz = 0, yaw = 0;
    for (const ped of inner.peds.slice(0, crowd.activePedestrianCount)) {
      const path = PED_PATHS[ped.pathIdx];
      px = ped.worldX - path.ux * 18; pz = ped.worldZ - path.uz * 18; yaw = path.fwdYaw;
      caller = crowd.reserveRoadsideCaller(px, pz, yaw, 100, () => 0);
      if (caller) break;
    }
    expect(caller).not.toBeNull();
    const { id, stop, appearance } = caller!;
    expect(isInsideDrmcCampus(stop.actor.x, stop.actor.z, 2)).toBe(false);
    expect(isClearOfRoads(stop.actor.x, stop.actor.z, 0.15)).toBe(true);
    expect(appearance.shirt).toMatch(/^#[0-9a-f]{6}$/);
    expect(inner.peds[id].roadsideCooldownUntil).toBe(280);
    const matrix = new THREE.Matrix4();
    for (const mesh of [inner.body, inner.head, inner.hair, inner.armL, inner.armR, inner.legL, inner.legR, inner.skirt, inner.bag]) {
      mesh.getMatrixAt(id, matrix);
      expect(matrix.elements[0]).toBe(0);
      expect(matrix.elements[5]).toBe(0);
      expect(matrix.elements[10]).toBe(0);
    }
    crowd.update(0.1, px, pz, 0, yaw);
    inner.body.getMatrixAt(id, matrix);
    expect(matrix.elements[0]).toBe(0); // no duplicate after simulation
    crowd.releaseRoadsideCaller(id, stop.departure.x, stop.departure.z);
    expect(inner.peds[id].roadsideReserved).toBe(false);
    // Isolate the same identity to prove cooldown is per person, not merely per location.
    for (let i = 0; i < inner.peds.length; i++) if (i !== id) inner.peds[i].roadsideReserved = true;
    expect(crowd.reserveRoadsideCaller(px, pz, yaw, 279, () => 0)).toBeNull();
    const same = crowd.reserveRoadsideCaller(px, pz, yaw, 281, () => 0);
    expect(same?.id).toBe(id);
    crowd.releaseRoadsideCaller(id, stop.departure.x, stop.departure.z);
    crowd.dispose();
  });

  it('releases an actor once with its world position, even when it is parented to a seat', () => {
    const scene = new THREE.Group(), seat = new THREE.Group();
    scene.add(seat); seat.position.set(18, 0.82, -7);
    const released: number[][] = [];
    const actor = new PassengerActor(archetypeById('student'), { onDispose: (x, z) => released.push([x, z]) });
    actor.seat(seat);
    actor.dispose(); actor.dispose();
    expect(released).toEqual([[18, -7]]);
    expect(actor.group.parent).toBeNull();
  });
});
