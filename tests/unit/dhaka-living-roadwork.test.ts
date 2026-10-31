import { describe, expect, it } from 'vitest';
import { EventDirector, type EventContext } from '../../src/events/eventDirector';
import { RoadblockSystem } from '../../src/ai/roadblocks';
import { ROAD_SEGMENTS, findRoute } from '../../src/world/layout';
import { isDrmcKeepClear } from '../../src/world/drmcGeo';

const base = (): EventContext => ({ x: 0, z: 120, headingX: 1, headingZ: 0,
  timeMinutes: 12 * 60, heat: 0, trafficDensity: 0.5, raining: false,
  inMission: false, inRace: false, policeActive: false, roadRageActive: false,
  cinematicActive: false, paused: false, reduceEffects: false, autoWeather: true });
const chooseRoadwork = () => {
  const rolls = [0, 0.62, 0, 0];
  return () => rolls.shift() ?? 0;
};

describe('owned temporary Mohammadpur road repair', () => {
  it('schedules an eligible public forward site, uses one passable pooled barrier, and removes only its own slot', () => {
    const blocks = new RoadblockSystem(() => 0);
    const d = new EventDirector();
    let outcome: string | undefined;
    d.onSpawn = ev => {
      outcome = ev.kind;
      if (ev.kind !== 'construction') return;
      const ok = blocks.trySpawnAhead(0, 120, 1, 0, 2, ev.id, ev.segmentId);
      if (!ok) return false;
      ev.cleanup = () => { blocks.despawnOwned(ev.id); };
    };
    const ev = d.update(90, base(), chooseRoadwork());
    expect(ev?.kind).toBe('construction');
    const seg = ROAD_SEGMENTS.find(s => s.id === ev!.segmentId)!;
    expect(seg.kind).not.toBe('gali');
    expect(seg.width).toBeGreaterThanOrEqual(7.2);
    expect(isDrmcKeepClear(ev!.x, ev!.z, 12)).toBe(false);
    expect(Math.hypot(ev!.x, ev!.z - 120)).toBeGreaterThanOrEqual(50);
    expect(blocks.activeCount).toBe(1);
    const obbs = blocks.getActiveObbs();
    expect(obbs).toHaveLength(2);
    expect(obbs.some(o => o.smashable)).toBe(true);
    // Existing public routes remain in the graph: the barrier has an authored shoulder gap.
    expect(findRoute(0, 120, 118, 84).segmentIds.length).toBeGreaterThan(0);
    d.clearAll();d.clearAll();
    expect(blocks.activeCount).toBe(0);
    expect(blocks.getActiveObbs()).toHaveLength(0);
    expect(outcome).toBe('construction');
    blocks.dispose();
  });

  it('rejects physical spawn failures without consuming a cooldown or announcing a zone', () => {
    const d = new EventDirector();
    let attempts = 0;
    d.onSpawn = ev => { attempts++; return ev.kind === 'construction' && attempts === 1 ? false : undefined; };
    expect(d.update(90, base(), chooseRoadwork())).toBeNull();
    expect(d.activeCount).toBe(0);
    expect(d.update(0, base(), chooseRoadwork())?.kind).toBe('construction');
    expect(attempts).toBe(2);
  });

  it('uses a heat-gated, passable police checkpoint and never deletes someone else’s slot', () => {
    const blocks = new RoadblockSystem(() => 0);
    const d = new EventDirector();
    const ctx = {...base(), heat: 2};
    d.onSpawn = ev => {
      if (ev.kind !== 'police_checkpoint') return;
      if (!blocks.trySpawnAhead(ctx.x, ctx.z, 1, 0, 2, ev.id, ev.segmentId)) return false;
      ev.cleanup = () => { blocks.despawnOwned(ev.id); };
    };
    const ev = d.update(90, ctx, chooseRoadwork());
    expect(ev?.kind).toBe('police_checkpoint');
    expect(blocks.activeCount).toBe(1);
    expect(blocks.getActiveObbs().some(o => o.smashable)).toBe(true);
    expect(blocks.despawnOwned('some-other-event')).toBe(0);
    expect(blocks.activeCount).toBe(1);
    // A distinct unowned police/race slot must survive the director cleanup.
    expect(blocks.trySpawnAhead(-190, 100, 1, 0, 3)).toBe(true);
    expect(blocks.activeCount).toBe(2);
    d.clearAll();
    expect(blocks.activeCount).toBe(1);
    blocks.clearAll();
    expect(blocks.activeCount).toBe(0);
    blocks.dispose();
  });

  it('never schedules barriers in rain, at night, in missions/races, or near the campus', () => {
    for (const mod of [{raining:true},{timeMinutes:2*60},{inMission:true},{inRace:true},{policeActive:true},{x:80,z:-105}]) {
      const d = new EventDirector();
      let event = null as ReturnType<EventDirector['update']>;
      for (let i=0;i<10;i++) {
        event=d.update(90,{...base(),...mod},chooseRoadwork());
        if(event?.kind==='construction') break;
      }
      expect(event?.kind, JSON.stringify(mod)).not.toBe('construction');
    }
  });
});
