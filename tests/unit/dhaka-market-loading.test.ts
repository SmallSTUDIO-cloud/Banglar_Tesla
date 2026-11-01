import { describe, expect, it } from 'vitest';
import { TrafficSystem } from '../../src/ai/traffic';
import { PedestrianSystem } from '../../src/ai/pedestrians';
import { getLaneGraph, sampleLane } from '../../src/ai/routes';
import { getTrafficArchetype } from '../../src/ai/vehicles';
import { QUALITY } from '../../src/core/config';
import { ROAD_SEGMENTS } from '../../src/world/layout';

function fixture(kind: 'van' | 'bus' | 'car' = 'van') {
  const traffic = new TrafficSystem(QUALITY.low);
  const graph = getLaneGraph();
  const seg = ROAD_SEGMENTS.find(s => s.id === 'asad_4')!;
  const lane = graph.bySegment.get(seg.id)![0];
  const a = (traffic as any).agents[0];
  (traffic as any).agents = [a];
  a.kind = kind;a.arch = getTrafficArchetype(kind);a.lane=lane;a.s=lane.length/2;
  a.speed=6;a.cruise=6;a.visible=true;a.nearLod=true;a.dwellTimer=0;a.dwellCooldown=0;
  a.turnLane=null;a.plannedLaneId=null;a.targetLateral=0;a.lateralOffset=0;
  sampleLane(lane,a.s,0,a);a.yaw=lane.yaw;
  traffic.setPlayer(0,120,0,0);
  return {traffic,a,seg,lane,x:(seg.ax+seg.bx)/2,z:(seg.az+seg.bz)/2};
}

describe('a real market-edge loading pause, never a conjured vehicle', () => {
  it('lets only existing, non-reserved sidewalk walkers pause briefly without moving them or spawning a crowd', () => {
    const p=new PedestrianSystem(QUALITY.low) as any;
    const n=p.activePedestrianCount;
    const near=p.peds[0], reserved=p.peds[1], far=p.peds[2];
    near.worldX=81;near.worldZ=95;near.pause=0;
    reserved.worldX=79;reserved.worldZ=95;reserved.pause=0;reserved.roadsideReserved=true;
    far.worldX=120;far.worldZ=120;far.pause=0;
    const before={x:near.worldX,z:near.worldZ};
    expect(p.noticeRoadsideLoading(80,95)).toBeGreaterThanOrEqual(1);
    expect(near.pause).toBeGreaterThanOrEqual(0.85);
    expect([near.worldX,near.worldZ]).toEqual([before.x,before.z]);
    expect(reserved.pause).toBe(0);
    expect(far.pause).toBe(0);
    expect(p.activePedestrianCount).toBe(n);
    p.dispose();
  });
  it('brakes an existing van and then releases the queue without teleporting or infinite stop', () => {
    const f=fixture();const {a,traffic}=f;
    const start={x:a.x,z:a.z};
    expect(traffic.scheduleMarketLoading(f.seg.id,f.x,f.z,0,120)).toBe(true);
    expect(a.x).toBe(start.x);expect(a.z).toBe(start.z);
    expect(a.dwellTimer).toBe(4.5);expect(a.dwellCooldown).toBe(60);
    expect(traffic.scheduleMarketLoading(f.seg.id,f.x,f.z,0,120)).toBe(false);
    let maxStep=0,prev={x:a.x,z:a.z};
    for(let i=0;i<210;i++){
      traffic.update(1/30);
      const step=Math.hypot(a.x-prev.x,a.z-prev.z);
      maxStep=Math.max(step,maxStep);prev={x:a.x,z:a.z};
    }
    expect(maxStep).toBeLessThan(0.5);
    expect(a.dwellTimer).toBe(0);
    expect(a.speed).toBeGreaterThan(0.2);
    traffic.dispose();
  });
  it('rejects blocked sites, near-player spawns, noncommercial lanes and ineligible classes', () => {
    const f=fixture('car');
    expect(f.traffic.scheduleMarketLoading(f.seg.id,f.x,f.z,0,120)).toBe(false);
    f.a.kind='van';
    expect(f.traffic.scheduleMarketLoading(f.seg.id,f.x,f.z,f.x,f.z)).toBe(false);
    expect(f.traffic.scheduleMarketLoading('not-an-edge',f.x,f.z,0,120)).toBe(false);
    f.a.dwellCooldown=6;
    expect(f.traffic.scheduleMarketLoading(f.seg.id,f.x,f.z,0,120)).toBe(false);
    f.traffic.dispose();
  });
});
