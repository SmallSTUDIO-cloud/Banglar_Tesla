import { describe, expect, it } from 'vitest';
import { EventDirector, type EventContext } from '../../src/events/eventDirector';
import { TrafficSystem } from '../../src/ai/traffic';
import { ROAD_SEGMENTS, findRoute } from '../../src/world/layout';
import { isDrmcKeepClear, isInsideDrmcCampus } from '../../src/world/drmcGeo';
import { QUALITY } from '../../src/core/config';

const context = (over: Partial<EventContext> = {}): EventContext => ({
  x: 42, z: 106, timeMinutes: 12 * 60, heat: 0, trafficDensity: 0.8,
  raining: false, inMission: false, inRace: false, policeActive: false,
  roadRageActive: false, cinematicActive: false, paused: false,
  reduceEffects: false, autoWeather: false, ...over,
});
function seeded(n: number): () => number {
  let state = n >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function collect(seed: number, contextAt: EventContext = context()) {
  const director = new EventDirector();
  const rng = seeded(seed);
  const events: Array<{ kind: string; x: number; z: number; id: string }> = [];
  let cleaned = 0;
  director.onSpawn = (ev) => {
    events.push({ id: ev.id, kind: ev.kind, x: ev.x, z: ev.z });
    ev.cleanup = () => cleaned++;
  };
  for (let i = 0; i < 1200; i++) director.update(0.5, contextAt, rng);
  director.clearAll();
  return { events, cleaned, active: director.activeCount };
}

describe('Dhaka-first event safety', () => {
  it('is reproducible for a seed, anchored on public road midpoints, never a random plot or gate', () => {
    const a = collect(922), b = collect(922);
    expect(a).toEqual(b);
    expect(a.events.length).toBeGreaterThan(0);
    expect(a.events.length).toBeLessThan(12);
    expect(a.cleaned).toBe(a.events.length);
    expect(a.active).toBe(0);
    for (const ev of a.events) {
      const site = ROAD_SEGMENTS.find((s) => Math.hypot(ev.x - (s.ax + s.bx) / 2, ev.z - (s.az + s.bz) / 2) < 0.01);
      expect(site, ev.id).toBeDefined();
      expect(site!.deadEnd).toBe(false);
      expect(site!.kind).not.toBe('gali');
      expect(isInsideDrmcCampus(ev.x, ev.z, 12)).toBe(false);
      expect(isDrmcKeepClear(ev.x, ev.z, 12)).toBe(false);
      expect(Math.hypot(ev.x - 42, ev.z - 106)).toBeGreaterThanOrEqual(32);
      expect(['market_slowdown', 'weather_shift']).toContain(ev.kind);
      if (ev.kind === 'market_slowdown') expect(site!.jamProne).toBe(true);
    }
  });

  it('does not override manual weather, invent a photographed scene, or start during protected play', () => {
    const manual = collect(22, context({ autoWeather: false }));
    expect(manual.events.every((ev) => ev.kind === 'market_slowdown')).toBe(true);
    const auto = collect(22, context({ autoWeather: true }));
    expect(auto.events.some((ev) => ev.kind === 'weather_shift')).toBe(true);
    for (const blocked of ['inRace', 'inMission', 'policeActive', 'roadRageActive', 'cinematicActive', 'paused'] as const) {
      expect(collect(22, context({ [blocked]: true })).events, blocked).toEqual([]);
    }
  });

  it('keeps a short market routing slowdown temporary without altering graph or save schema', () => {
    const site = ROAD_SEGMENTS.find((s) => s.id === 'asad_3')!;
    const x = (site.ax + site.bx) / 2, z = (site.az + site.bz) / 2;
    const traffic = new TrafficSystem(QUALITY.balanced, () => 0);
    const route0 = findRoute(42, 106, -112, 194);
    expect(route0.segmentIds.length).toBeGreaterThan(0);
    traffic.induceCongestionNear(x, z, 1.35, 24);
    const boosted = traffic.getCongestionMultiplier(site.id);
    expect(boosted).toBeGreaterThan(1);
    // The injected contribution decays; independent live traffic may create
    // its own congestion in the same interval, so exact return to 1 is false.
    traffic.update(10);
    expect(traffic.getCongestionMultiplier(site.id)).toBeLessThan(boosted);
    expect(findRoute(42, 106, -112, 194).segmentIds).toEqual(route0.segmentIds);
    traffic.dispose();
  });

  it('cleans exactly once after explicit cancellation; resumes eligibility after cooldown', () => {
    const d = new EventDirector();
    let cleaned = 0, spawned = 0;
    d.onSpawn = (ev) => { spawned++; ev.cleanup = () => cleaned++; };
    for (let i = 0; i < 20 && !d.activeCount; i++) d.update(10, context(), () => 0);
    expect(d.activeCount).toBe(1);
    d.clearAll(); d.clearAll();
    expect(cleaned).toBe(1);
    for (let i = 0; i < 40; i++) d.update(10, context(), () => 0);
    expect(spawned).toBeGreaterThan(1);
    d.clearAll();
    expect(cleaned).toBe(spawned);
  });
});
