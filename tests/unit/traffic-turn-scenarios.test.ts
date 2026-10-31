import { describe, expect, it } from 'vitest';
import { QUALITY } from '../../src/core/config';
import { TrafficSystem } from '../../src/ai/traffic';
import { getLaneGraph, sampleLane } from '../../src/ai/routes';
import { getTrafficArchetype } from '../../src/ai/vehicles';
import { distanceToRoadCarriageway } from '../../src/world/layout';

function driveTurn(kind: 'car' | 'bus' | 'truck', sourceId: string, targetId: string) {
  const graph = getLaneGraph();
  const source = graph.byId.get(sourceId)!;
  const traffic = new TrafficSystem(QUALITY.low);
  // Isolate one real fleet agent; do not alter the shared road graph or fake
  // positions after the hand-off. This exercises the live AI update path.
  const t = traffic as any;
  const a = t.agents[0];
  t.agents = [a];
  a.kind = kind;
  a.arch = getTrafficArchetype(kind);
  a.lane = source;
  a.s = source.length - 9;
  a.speed = 4;
  a.cruise = 6.5;
  a.lateralOffset = a.targetLateral = 0;
  a.turnOffsetX = a.turnOffsetZ = 0;
  a.dwellTimer = a.dwellCooldown = a.roadRageHold = a.stuckTimer = 0;
  const point = { x: 0, z: 0, yaw: 0 };
  sampleLane(source, a.s, 0, point);
  a.x = point.x; a.z = point.z; a.yaw = point.yaw;
  traffic.setPlayer(a.x + 38, a.z + 38, 0);
  const chosenIndex = source.nextLaneIds.indexOf(targetId);
  expect(chosenIndex).toBeGreaterThanOrEqual(0);
  t.rng = () => (chosenIndex + 0.02) / source.nextLaneIds.length;
  let maxStep = 0, maxYawStep = 0, maxRoadOutside = -Infinity, maxFootOutside = -Infinity, changed = false;
  for (let i = 0; i < 200; i++) {
    const px = a.x, pz = a.z, yaw = a.yaw;
    traffic.update(1 / 30);
    maxStep = Math.max(maxStep, Math.hypot(a.x - px, a.z - pz));
    maxYawStep = Math.max(maxYawStep, Math.abs(Math.atan2(Math.sin(a.yaw-yaw), Math.cos(a.yaw-yaw))));
    if (a.lane.id === targetId) changed = true;
    maxRoadOutside = Math.max(maxRoadOutside, distanceToRoadCarriageway(a.x, a.z));
    for (const side of [-1, 1]) for (const end of [-1, 1]) {
      const x = a.x + Math.cos(a.yaw) * side * a.arch.halfWidth + Math.sin(a.yaw) * end * a.arch.halfLength;
      const z = a.z - Math.sin(a.yaw) * side * a.arch.halfWidth + Math.cos(a.yaw) * end * a.arch.halfLength;
      maxFootOutside = Math.max(maxFootOutside, distanceToRoadCarriageway(x, z));
    }
    if (changed && a.s > 12) break;
  }
  const result = { changed, maxStep, maxYawStep, maxRoadOutside, maxFootOutside, lane: a.lane.id };
  traffic.dispose();
  return result;
}

describe('live graph NPC turns', () => {
  it('traces a left turn continuously without jumping or clipping a corridor', () => {
    const r = driveTurn('car', 'asad_0:rev', 'ring_0:fwd');
    console.log('turn fit', r);
    expect(r.changed).toBe(true);
    expect(r.maxStep).toBeLessThan(0.6);
    expect(r.maxYawStep).toBeLessThan(0.06);
    expect(r.maxRoadOutside).toBeLessThan(0.5);
  });
  it('turns a full-size truck without clipping the carriageway', () => {
    const r = driveTurn('truck', 'ring_0:rev', 'asad_0:fwd');
    expect(r.changed).toBe(true);
    expect(r.maxRoadOutside).toBeLessThan(0.5);
    expect(r.maxFootOutside).toBeLessThan(0.7);
  });
  it('turns a full-size bus right without teleporting or wildly rotating', () => {
    const r = driveTurn('bus', 'ring_0:rev', 'asad_0:fwd');
    console.log('turn fit', r);
    expect(r.changed).toBe(true);
    expect(r.maxStep).toBeLessThan(0.6);
    expect(r.maxYawStep).toBeLessThan(0.04);
    expect(r.maxRoadOutside).toBeLessThan(0.5);
  });
});

function isolatedNpc(speed = 5) {
  const lane = getLaneGraph().byId.get('asad_0:rev')!;
  const t = new TrafficSystem(QUALITY.low) as any;
  const a = t.agents[0];
  t.agents = [a];
  a.kind = 'car'; a.arch = getTrafficArchetype('car');
  a.lane = lane; a.plannedLaneId = null;
  a.s = lane.length * 0.35;
  a.lateralOffset = a.targetLateral = 0;
  a.speed = speed; a.cruise = 6.5;
  a.dwellTimer = a.dwellCooldown = a.roadRageHold = a.stuckTimer = 0;
  a.turnOffsetX = a.turnOffsetZ = 0;
  const p = { x: 0, z: 0, yaw: 0 };
  sampleLane(lane, a.s, 0, p);
  a.x = p.x; a.z = p.z; a.yaw = p.yaw;
  return { t: t as TrafficSystem, a, lane };
}

describe('actual NPC stop/recovery simulation', () => {
  it('waits behind a stopped player and resumes once the lane is genuinely clear', () => {
    const { t, a, lane } = isolatedNpc(6);
    const start = a.s;
    const player = { x: lane.ax + lane.ux * (start + 8), z: lane.az + lane.uz * (start + 8) };
    t.setPlayer(player.x, player.z, 0);
    for (let i = 0; i < 140; i++) t.update(1 / 30);
    expect(a.speed).toBeLessThan(0.9);
    expect(Math.hypot(a.x - player.x, a.z - player.z)).toBeGreaterThan(2.4);
    t.setPlayer(a.x - lane.ux * 4, a.z - lane.uz * 4, 0); // now behind
    for (let i = 0; i < 75; i++) t.update(1 / 30);
    expect(a.speed).toBeGreaterThan(2);
    t.dispose();
  });

  it('does not stop for a nearby player behind, even on a slow street', () => {
    const { t, a, lane } = isolatedNpc(4);
    const before = a.s;
    t.setPlayer(a.x - lane.ux * 3.5, a.z - lane.uz * 3.5, 0);
    for (let i = 0; i < 50; i++) t.update(1 / 30);
    expect(a.s).toBeGreaterThan(before + 5);
    expect(a.speed).toBeGreaterThan(3.4);
    t.dispose();
  });

  it('does not wrap a temporarily disconnected route back to its start', () => {
    const { t, a, lane } = isolatedNpc(4);
    const ids = lane.nextLaneIds;
    try {
      lane.nextLaneIds = [];
      a.s = lane.length - 0.4;
      sampleLane(lane, a.s, 0, a);
      a.yaw = lane.yaw;
      t.setPlayer(a.x + 20, a.z + 20, 0);
      for (let i = 0; i < 100; i++) t.update(1 / 30);
      expect(a.lane).toBe(lane);
      expect(a.s).toBeGreaterThan(lane.length - 1);
      expect(a.speed).toBe(0);
    } finally {
      lane.nextLaneIds = ids;
      t.dispose();
    }
  });
});

describe('committed junction exit and safe waiting', () => {
  function approach(blockSelectedExit: boolean) {
    const graph = getLaneGraph();
    const source = graph.byId.get('asad_5:rev')!;
    const exit = graph.byId.get('post_shahjahan:fwd')!;
    const unrelated = graph.byId.get('zakir_3:fwd')!;
    const t = new TrafficSystem(QUALITY.low) as any;
    const a = t.agents[0], b = t.agents[1];
    t.agents = [a, b];
    a.kind = 'car'; a.arch = getTrafficArchetype('car');
    a.lane = source; a.plannedLaneId = null; a.s = source.length - 12;
    a.lateralOffset = a.targetLateral = 0; a.turnOffsetX = a.turnOffsetZ = 0;
    a.speed = 5; a.cruise = 7; a.dwellTimer = a.dwellCooldown = a.stuckTimer = 0;
    sampleLane(source, a.s, 0, a); a.yaw = source.yaw;
    const obstructionLane = blockSelectedExit ? exit : unrelated;
    b.lane = obstructionLane; b.plannedLaneId = null; b.s = 1;
    b.speed = 0; b.dwellTimer = 10; b.dwellCooldown = 10; b.stuckTimer = 0;
    b.lateralOffset = b.targetLateral = 0;
    sampleLane(obstructionLane, b.s, 0, b); b.yaw = obstructionLane.yaw;
    t.setPlayer(a.x + 35, a.z + 35, 0);
    const index = source.nextLaneIds.indexOf(exit.id);
    expect(index).toBeGreaterThanOrEqual(0);
    t.rng = () => (index + 0.05) / source.nextLaneIds.length;
    for (let i = 0; i < 65; i++) t.update(1 / 30);
    const result = { speed: a.speed, s: a.s, lane: a.lane.id, planned: a.plannedLaneId };
    t.dispose();
    return result;
  }

  it('brakes for a car on its chosen exit, not an unrelated junction arm', () => {
    const blocked = approach(true);
    const clear = approach(false);
    expect(blocked.speed).toBeLessThan(clear.speed);
    expect(blocked.s).toBeLessThan(clear.s + 10);
  });
});
