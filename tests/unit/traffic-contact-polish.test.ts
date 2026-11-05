import { describe, expect, it } from 'vitest';
import { QUALITY } from '../../src/core/config';
import { TrafficSystem } from '../../src/ai/traffic';

function isolated(kind: 'car' | 'cng' | 'bus' | 'truck' | 'motorbike' | 'easybike' | 'rickshaw' | 'van') {
  const traffic = new TrafficSystem(QUALITY.low);
  const t = traffic as any;
  const a = t.agents[0];t.agents = [a];
  const index = traffic.debugPositionAgentForTest(kind, 3.7, -3.7, -2.76, 0);
  return { traffic, a: t.agents[index], index, t };
}

describe('bounded NPC contact without changing navigation', () => {
  it('moves a stationary car in-lane on a gentle contact and refuses an immediate repeat', () => {
    const {traffic,a,index} = isolated('car');
    const before={x:a.x,z:a.z,s:a.s,lane:a.lane.id};
    const step=traffic.nudgeFromPlayer(index,3.2,a.lane.ux,a.lane.uz);
    expect(step).toBeGreaterThan(0.08);
    expect(step).toBeLessThan(0.18);
    expect(a.s-before.s).toBeCloseTo(step);
    expect(Math.hypot(a.x-before.x,a.z-before.z)).toBeCloseTo(step);
    expect(a.lane.id).toBe(before.lane);
    expect(traffic.nudgeFromPlayer(index,10,a.lane.ux,a.lane.uz)).toBe(0);
    traffic.dispose();
  });

  it('gives light vehicles a different response from a bus without launching either', () => {
    const light=isolated('car'),heavy=isolated('bus');
    const carStep=light.traffic.nudgeFromPlayer(light.index,5,light.a.lane.ux,light.a.lane.uz);
    const busStep=heavy.traffic.nudgeFromPlayer(heavy.index,5,heavy.a.lane.ux,heavy.a.lane.uz);
    expect(carStep).toBeGreaterThan(busStep*5);
    expect(busStep).toBeLessThan(0.025);
    light.traffic.dispose();heavy.traffic.dispose();
  });

  it('gives side contact a small recoverable lateral response, but rejects reverse, turns and overlaps', () => {
    const {traffic,a,index,t}=isolated('car');
    expect(traffic.nudgeFromPlayer(index,4,-a.lane.ux,-a.lane.uz)).toBe(0);
    const lane=a.lane.id, originalS=a.s, originalLat=a.lateralOffset;
    const sideStep=traffic.nudgeFromPlayer(index,4,a.lane.uz,-a.lane.ux);
    expect(sideStep).toBeGreaterThan(0.01);
    expect(sideStep).toBeLessThan(0.05);
    expect(a.s).toBeCloseTo(originalS);
    expect(a.lateralOffset).toBeGreaterThan(originalLat);
    expect(a.lane.id).toBe(lane);
    a.contactCooldown=0;
    a.turnT=0.2;expect(traffic.nudgeFromPlayer(index,4,a.lane.ux,a.lane.uz)).toBe(0);
    a.turnT=0;a.visible=false;expect(traffic.nudgeFromPlayer(index,4,a.lane.ux,a.lane.uz)).toBe(0);
    a.visible=true;
    const other={...a,x:a.x+a.lane.ux*1.8,z:a.z+a.lane.uz*1.8};
    t.agents.push(other);
    expect(traffic.nudgeFromPlayer(index,4,a.lane.ux,a.lane.uz)).toBe(0);
    traffic.dispose();
  });

  it('caps repeated contact, keeps finite lane state, and recovers into the existing AI', () => {
    const {traffic,a,index}=isolated('car');
    const originalLane=a.lane.id, initial=a.s;
    traffic.setPlayer(a.x-4,a.z-4,0);
    for(let i=0;i<150;i++){
      traffic.nudgeFromPlayer(index,8,a.lane.ux,a.lane.uz);
      traffic.update(1/60);
      expect([a.x,a.z,a.s,a.speed,a.yaw].every(Number.isFinite)).toBe(true);
    }
    expect(a.s).toBeGreaterThan(initial);
    expect(a.contactTravel).toBeLessThanOrEqual(1.1);
    expect(a.lane.id).toBe(originalLane);
    const pushed=a.s;
    traffic.setPlayer(a.x+40,a.z+40,0);
    for(let i=0;i<150;i++)traffic.update(1/60);
    expect(a.s).toBeGreaterThanOrEqual(pushed);
    expect(a.speed).toBeGreaterThan(0);
    expect([a.x,a.z,a.s,a.speed,a.yaw].every(Number.isFinite)).toBe(true);
    traffic.dispose();
  });
});
