import { describe, expect, it } from 'vitest';
import { QUALITY } from '../../src/core/config';
import { TrafficSystem, curbsidePassOffset } from '../../src/ai/traffic';
import { getLaneGraph, sampleLane } from '../../src/ai/routes';
import { getTrafficArchetype } from '../../src/ai/vehicles';

const graph = getLaneGraph();
function scenario(leader: 'rickshaw' | 'bus' | 'car' = 'rickshaw', laneId = 'asad_5:fwd') {
  const traffic = new TrafficSystem(QUALITY.low);
  const internal = traffic as any;
  const lane = graph.byId.get(laneId)!;
  const agents = internal.agents.slice(0, 2);
  internal.agents = agents;
  for (const [i, kind] of (['car', leader] as const).entries()) {
    const a = agents[i];
    a.kind = kind;
    a.arch = getTrafficArchetype(kind);
    a.lane = lane;
    a.s = i === 0 ? 11 : 24;
    a.speed = i === 0 ? 6 : 2.3;
    a.cruise = i === 0 ? 8.5 : 3.1;
    a.plannedLaneId = null;
    a.turnLane = null;
    a.turnT = 0;
    a.passing = null;
    a.passCooldown = 0;
    a.targetLateral = a.lateralOffset = 0;
    a.dwellTimer = a.dwellCooldown = a.stuckTimer = a.roadRageHold = 0;
    sampleLane(lane, a.s, 0, a);
    a.yaw = lane.yaw;
  }
  traffic.setPlayer(agents[0].x + lane.uz * 30, agents[0].z - lane.ux * 30, 0);
  return { traffic, lane, agents };
}

describe('width-aware real traffic overtaking', () => {
  it('passes a slower rickshaw on a wide road without crossing the centreline or teleporting', () => {
    const f = scenario();
    let maxStep = 0, maxOffset = 0, passed = false;
    for (let i = 0; i < 500; i++) {
      const x = f.agents[0].x, z = f.agents[0].z;
      f.traffic.update(1 / 30);
      const a = f.agents[0], b = f.agents[1];
      maxStep = Math.max(maxStep, Math.hypot(a.x - x, a.z - z));
      maxOffset = Math.max(maxOffset, a.lateralOffset);
      expect(a.lateralOffset).toBeLessThan(f.lane.halfRoadWidth * 0.54 - a.arch.halfWidth - 0.29);
      if (a.s > b.s + 4) { passed = true; break; }
    }
    expect(passed).toBe(true);
    expect(maxOffset).toBeGreaterThan(1.5);
    expect(maxStep).toBeLessThan(0.5);
    f.traffic.dispose();
  });
  it('does not squeeze past a bus or enter an opposing/narrow lane', () => {
    expect(curbsidePassOffset(3.1, 'gali', 0.88, 0.62)).toBeNull();
    expect(curbsidePassOffset(4.2, 'medium', 0.88, 1.19)).toBeNull();
    const f = scenario('bus');
    for (let i = 0; i < 110; i++) f.traffic.update(1 / 30);
    expect(f.agents[0].passing).toBeNull();
    expect(Math.abs(f.agents[0].lateralOffset)).toBeLessThan(0.2);
    f.traffic.dispose();
  });
  it('can pass a stopped player but refuses an oncoming or curbside player', () => {
    const f = scenario();
    f.agents.pop();
    const a = f.agents[0];
    for (let i = 0; i < 30; i++) {
      f.traffic.setPlayer(a.x + f.lane.ux * 10, a.z + f.lane.uz * 10, 0, f.lane.yaw);
      f.traffic.update(1 / 30);
    }
    expect(a.lateralOffset).toBeGreaterThan(0.5);
    f.traffic.dispose();

    const g = scenario();
    g.agents.pop();
    for (let i = 0; i < 30; i++) {
      const n = g.agents[0];
      g.traffic.setPlayer(n.x + g.lane.ux * 10, n.z + g.lane.uz * 10, 3, g.lane.yaw + Math.PI);
      g.traffic.update(1 / 30);
    }
    expect(g.agents[0].passing).toBeNull();
    g.traffic.dispose();

    const h = scenario();
    const n = h.agents[0];
    h.traffic.setPlayer(n.x + h.lane.ux * 10 + h.lane.uz * 2.1,
      n.z + h.lane.uz * 10 - h.lane.ux * 2.1, 0, h.lane.yaw);
    for (let i = 0; i < 20; i++) h.traffic.update(1 / 30);
    expect(n.passing).toBeNull();
    h.traffic.dispose();
  });
});
