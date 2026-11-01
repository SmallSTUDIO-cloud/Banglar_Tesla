import { describe, expect, it } from 'vitest';
import { QUALITY } from '../../src/core/config';
import { TrafficSystem } from '../../src/ai/traffic';
import { getLaneGraph, sampleLane, type LaneEdge } from '../../src/ai/routes';
import { getTrafficArchetype, type TrafficType } from '../../src/ai/vehicles';

// Scripted real-graph/real-fleet simulation, NOT player-driven gameplay.
const graph = getLaneGraph();
function fixture(kinds: TrafficType[], laneId = 'asad_0:rev') {
  const traffic = new TrafficSystem(QUALITY.low);
  const internal = traffic as any;
  const lane = graph.byId.get(laneId)!;
  const agents = internal.agents.slice(0, kinds.length);
  internal.agents = agents;
  const at = (index: number, which: LaneEdge, s: number, speed: number) => {
    const a = agents[index];
    a.kind = kinds[index]; a.arch = getTrafficArchetype(a.kind);
    a.lane = which; a.s = s; a.speed = speed; a.cruise = 7;
    a.plannedLaneId = null; a.turnLane = null; a.turnT = 0;
    a.turnOffsetX = a.turnOffsetZ = 0;
    a.lateralOffset = a.targetLateral = 0;
    a.dwellTimer = a.dwellCooldown = a.stuckTimer = a.roadRageHold = 0;
    sampleLane(which, s, 0, a); a.yaw = which.yaw;
    return a;
  };
  const a = at(0, lane, lane.length * 0.35, 5);
  traffic.setPlayer(a.x + 60, a.z + 60, 0);
  return { traffic, internal, agents, a, lane, at };
}
const run = (t: TrafficSystem, n: number) => { for (let i = 0; i < n; i++) t.update(1 / 30); };

describe('advanced traffic, scripted real-fleet scenarios', () => {
  it('does not stop for a player approaching from behind', () => {
    const { traffic, a, lane } = fixture(['car']);
    const initial = a.s;
    for (let i = 0; i < 40; i++) {
      traffic.setPlayer(a.x - lane.ux * 4, a.z - lane.uz * 4, 6, lane.yaw);
      traffic.update(1 / 30);
    }
    expect(a.speed).toBeGreaterThan(5);
    expect(a.s).toBeGreaterThan(initial + 6);
    traffic.dispose();
  });
  it('brakes earlier for an oncoming player than a stationary player far ahead', () => {
    const oncoming = fixture(['car']);
    const stopped = fixture(['car']);
    for (let i = 0; i < 25; i++) {
      for (const f of [oncoming, stopped]) {
        f.traffic.setPlayer(f.a.x + f.lane.ux * 17, f.a.z + f.lane.uz * 17,
          f === oncoming ? 6 : 0, f.lane.yaw + Math.PI);
        f.traffic.update(1 / 30);
      }
    }
    expect(oncoming.a.speed).toBeLessThan(stopped.a.speed);
    oncoming.traffic.dispose(); stopped.traffic.dispose();
  });
  it('stops for a player directly ahead, resumes after player leaves', () => {
    const f = fixture(['bus']);
    const px = f.a.x + f.lane.ux * 11, pz = f.a.z + f.lane.uz * 11;
    f.traffic.setPlayer(px, pz, 0);
    run(f.traffic, 150);
    expect(f.a.speed).toBeLessThan(0.6);
    expect(Math.hypot(f.a.x - px, f.a.z - pz)).toBeGreaterThan(3);
    f.traffic.setPlayer(px + 50, pz + 50, 0);
    run(f.traffic, 70);
    expect(f.a.speed).toBeGreaterThan(2);
    f.traffic.dispose();
  });
  it('ignores a player travelling alongside in a different lane', () => {
    const f = fixture(['cng']);
    const start = f.a.s;
    for (let i = 0; i < 48; i++) {
      f.traffic.setPlayer(f.a.x + f.lane.ux * 5 + f.lane.uz * 3.6,
        f.a.z + f.lane.uz * 5 - f.lane.ux * 3.6, 4, f.lane.yaw);
      f.traffic.update(1 / 30);
    }
    expect(f.a.s).toBeGreaterThan(start + 6);
    f.traffic.dispose();
  });
  it('follows a moving leader without freezing and brakes behind a stopped leader', () => {
    const f = fixture(['car', 'rickshaw']);
    const b = f.at(1, f.lane, f.a.s + 13, 4);
    run(f.traffic, 100);
    expect(f.a.speed).toBeGreaterThan(1);
    expect(b.s - f.a.s).toBeGreaterThan(f.a.arch.halfLength + b.arch.halfLength);
    b.dwellTimer = 10;
    run(f.traffic, 120);
    expect(f.a.speed).toBeLessThan(1);
    expect(b.s - f.a.s).toBeGreaterThan(f.a.arch.halfLength + b.arch.halfLength);
    b.dwellTimer = 0;
    run(f.traffic, 90);
    expect(f.a.speed).toBeGreaterThan(1);
    f.traffic.dispose();
  });
  it('commits to a left and a right connector without jumps, reverse motion or side teleport', () => {
    for (const [kind, from, to] of [
      ['car', 'asad_0:rev', 'ring_0:fwd'],
      ['bus', 'ring_0:rev', 'asad_0:fwd'],
      ['truck', 'ring_0:rev', 'asad_0:fwd'],
    ] as const) {
      const f = fixture([kind], from);
      f.at(0, f.lane, f.lane.length - 13, 4);
      f.a.plannedLaneId = to;
      let maxStep = 0, maxHeading = 0, changed = false;
      for (let i = 0; i < 270; i++) {
        const x = f.a.x, z = f.a.z, yaw = f.a.yaw;
        f.traffic.update(1 / 30);
        const dx = f.a.x - x, dz = f.a.z - z;
        maxStep = Math.max(maxStep, Math.hypot(dx, dz));
        if (Math.hypot(dx, dz) > 0.03)
          maxHeading = Math.max(maxHeading, Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - yaw), Math.cos(Math.atan2(dx, dz) - yaw))));
        if (f.a.lane.id === to) { changed = true; if (f.a.s > 10) break; }
      }
      expect(changed, `${kind}: ${from} -> ${to}`).toBe(true);
      expect(maxStep).toBeLessThan(0.5);
      expect(maxHeading).toBeLessThan(0.9);
      f.traffic.dispose();
    }
  });
  it('waits for a blocked chosen exit and recovers without switching to another road', () => {
    const f = fixture(['car', 'car'], 'asad_5:rev');
    const exit = graph.byId.get('post_shahjahan:fwd')!;
    f.at(0, f.lane, f.lane.length - 12, 5);
    f.a.plannedLaneId = exit.id;
    const b = f.at(1, exit, 1, 0);
    b.dwellTimer = 100;
    run(f.traffic, 180);
    expect(f.a.lane).toBe(f.lane);
    expect(f.a.speed).toBeLessThan(0.7);
    // Move the blocker naturally through the same lane, rather than teleporting it.
    b.dwellTimer = 0; b.cruise = 7;
    run(f.traffic, 260);
    expect(f.a.lane.id).toBe(exit.id);
    f.traffic.dispose();
  });
  it('keeps mixed vehicle classes and a wide bus at different bounded accelerations', () => {
    const f = fixture(['bus', 'motorbike', 'easybike', 'truck', 'cng', 'van', 'rickshaw', 'car']);
    const starts = f.agents.map((a: any, i: number) => {
      f.at(i, graph.lanes[(i * 11) % graph.lanes.length], 5, 0);
      return a.speed;
    });
    run(f.traffic, 15);
    expect(starts.every((v: number) => v === 0)).toBe(true);
    expect(f.agents[1].speed).toBeGreaterThan(f.agents[0].speed);
    expect(f.agents[0].speed).toBeGreaterThan(f.agents[6].speed);
    expect(f.agents.every((a: any) => a.speed >= 0 && a.speed <= a.cruise + 0.8)).toBe(true);
    f.traffic.dispose();
  });
});

describe('junction reservation on the real road graph', () => {
  it('yields to an earlier conflicting approach, then proceeds after that vehicle clears', () => {
    const f = fixture(['car', 'cng'], 'asad_0:rev');
    const incoming = graph.lanes.find((l) => l.toNode === f.lane.toNode && l.id !== f.lane.id)!;
    expect(incoming).toBeDefined();
    const exit = graph.byId.get('ring_0:fwd')!;
    f.at(0, f.lane, f.lane.length - 12, 4);
    f.a.plannedLaneId = exit.id;
    const b = f.at(1, incoming, incoming.length - 4, 3);
    // Keep the leading conflict present long enough to measure yielding.
    b.dwellTimer = 1;
    const start = f.a.s;
    run(f.traffic, 30);
    expect(f.a.s - start).toBeLessThan(4);
    b.dwellTimer = 0;
    run(f.traffic, 210);
    expect(f.a.lane.id).toBe(exit.id);
    f.traffic.dispose();
  });
});
