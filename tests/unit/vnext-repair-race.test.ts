import { describe, expect, it } from 'vitest';
import { BLACKLIST_RIVALS, OPEN_STREET_EVENTS } from '../../src/blacklist/blacklistCatalog';
import { buildAiWaypointsForTendency, buildRaceCourse } from '../../src/blacklist/raceRoutes';
import { RivalRaceSystem } from '../../src/blacklist/raceSystem';
import { angleDelta } from '../../src/core/mathx';
import { findRoute } from '../../src/world/layout';

describe('race starts', () => {
  it('aims each starting grid toward a forward launch waypoint', () => {
    const bad: string[] = [];
    for (const event of [...BLACKLIST_RIVALS.map((r) => r.bossEvent), ...OPEN_STREET_EVENTS]) {
      const course = buildRaceCourse(event);
      for (const slot of course.gridSlots.slice(0, 3)) {
        for (const tendency of ['clean_line', 'aggressive_overtaker', 'shortcut_seeker'] as const) {
          const wp = buildAiWaypointsForTendency(course, slot, tendency)[0];
          const forward = wp && (wp.x - slot.x) * Math.sin(slot.yaw) + (wp.z - slot.z) * Math.cos(slot.yaw);
          if (forward == null || forward <= 0.5 || !wp?.isLaunch) bad.push(`${event.id}/${slot.slotIndex}/${tendency}: ${forward?.toFixed(1)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('places the first mandatory gate ahead of every player grid', () => {
    for (const event of [...BLACKLIST_RIVALS.map((r) => r.bossEvent), ...OPEN_STREET_EVENTS]) {
      const course = buildRaceCourse(event);
      const gate = course.allCheckpoints[0];
      for (const slot of course.gridSlots) {
        const signed = (gate.x - slot.x) * Math.sin(slot.yaw) + (gate.z - slot.z) * Math.cos(slot.yaw);
        expect(signed, `${event.id} slot ${slot.slotIndex}`).toBeGreaterThan(0);
      }
    }
  });

  it('respawns facing the next non-degenerate road leg after each checkpoint, and resets on restart', () => {
    for (const original of [...BLACKLIST_RIVALS.map((r) => r.bossEvent), ...OPEN_STREET_EVENTS]) {
      const event = { ...original, targetSeconds: 1000 };
      const course = buildRaceCourse(event);
      const race = new RivalRaceSystem(() => 0);
      const grid = race.startEvent(event, null, 0);
      for (let n = 0; n < 181; n++) race.update(1/60, grid.x, grid.z, 0, n/60);
      for (let i = 0; i < course.allCheckpoints.length - 1; i++) {
        const gate = course.allCheckpoints[i], next = course.allCheckpoints[i + 1];
        race.update(1/60, gate.x, gate.z, 0, 4 + i/60);
        const pose = race.getSafeRespawnPose();
        expect(pose, `${event.id} checkpoint ${i}`).not.toBeNull();
        expect(Math.abs(angleDelta(pose!.yaw, gate.yaw)), `${event.id} checkpoint ${i}`).toBeLessThan(1e-5);
        const point = findRoute(gate.x, gate.z, next.x, next.z).points.find((p) => Math.hypot(p.x-gate.x, p.z-gate.z) > 0.5) ?? next;
        const forward = (point.x-gate.x) * Math.sin(pose!.yaw) + (point.z-gate.z) * Math.cos(pose!.yaw);
        expect(forward, `${event.id} checkpoint ${i} orientation`).toBeGreaterThan(0);
      }
      expect(race.startEvent(event, null, 0)).toEqual(grid);
      expect(race.getSafeRespawnPose()).toEqual(grid);
      race.cancel();
    }
  }, 30000);

  it('accelerates forwards after countdown and restart for all courses and AI tendencies', () => {
    const bad: string[] = [];
    for (const original of [...BLACKLIST_RIVALS.map((r) => r.bossEvent), ...OPEN_STREET_EVENTS]) {
      // Optional-race format exercises all three tendencies on every blueprint.
      const event = { ...original, blacklistRank: undefined };
      const race = new RivalRaceSystem(() => 0);
      for (let attempt = 0; attempt < 2; attempt++) {
        const grid = race.startEvent(event, null, 0);
        expect(race.getSafeRespawnPose()).toEqual(grid);
        for (let n = 0; n < 181; n++) race.update(1 / 60, 9999, 9999, 0, n / 60);
        const start = race.getAiRacersSnapshot();
        for (let n = 0; n < 60; n++) race.update(1 / 60, 9999, 9999, 0, 4 + n / 60);
        const after = race.getAiRacersSnapshot();
        for (let i = 0; i < start.length; i++) {
          const a = start[i];
          const b = after[i];
          const forward = (b.x - a.x) * Math.sin(a.yaw) + (b.z - a.z) * Math.cos(a.yaw);
          if (forward < 1 || Math.abs(angleDelta(a.yaw, b.yaw)) > Math.PI / 2) {
            bad.push(`${event.id}/${a.tendency}/restart${attempt}: ${forward.toFixed(2)}, yaw ${angleDelta(a.yaw, b.yaw).toFixed(2)}`);
          }
        }
      }
      race.cancel();
    }
    expect(bad).toEqual([]);
  }, 30000);
});

describe('race formats and route completion', () => {
  it('uses the actual ranked rival in every 1v1 and keeps optional events four-racer', () => {
    const race = new RivalRaceSystem(() => 0);
    for (const rival of BLACKLIST_RIVALS) {
      const start = race.startEvent(rival.bossEvent, rival, 0);
      expect(race.getAiRacersSnapshot()).toHaveLength(1);
      expect(race.getAiRacersSnapshot()[0].id).toBe(rival.id);
      const hud = race.update(0, start.x, start.z, 0, 0);
      expect(hud.totalRacers).toBe(2);
      expect(race.getStandings(start.x, start.z)).toHaveLength(2);
    }
    for (const event of OPEN_STREET_EVENTS) {
      const start = race.startEvent(event, null, 0);
      expect(race.getAiRacersSnapshot()).toHaveLength(3);
      expect(new Set(race.getAiRacersSnapshot().map((r) => r.id)).size).toBe(3);
      expect(race.update(0, start.x, start.z, 0, 0).totalRacers).toBe(4);
    }
    race.cancel();
  });
  it('finishes every complete course without teleporting when given enough time', () => {
    const bad: string[] = [];
    for (const event of [...BLACKLIST_RIVALS.map((r) => r.bossEvent), ...OPEN_STREET_EVENTS]) {
      const race = new RivalRaceSystem(() => 0);
      race.startEvent({ ...event, targetSeconds: 1000 }, null, 0);
      let final = race.getStandings(9999, 9999);
      for (let i=0; i < 360 * 15 && race.isActive; i++) {
        race.update(1/15, 9999, 9999, 0, i/15);
        final = race.getStandings(9999, 9999);
      }
      const ai = final.filter((s) => !s.isPlayer);
      if (ai.some((s) => !s.finished)) bad.push(`${event.id}: ${ai.map((s) => `${s.checkpointsCleared}/${s.checkpointTotal}${s.finished ? 'F' : ''}`).join(', ')}`);
      race.cancel();
    }
    expect(bad).toEqual([]);
  }, 30000);
});

it('approaches the #10 mid-block tea finish directly without routing past it and doubling back', () => {
  const course = buildRaceCourse(BLACKLIST_RIVALS[0].bossEvent);
  const route = buildAiWaypointsForTendency(course, course.gridSlots[0], 'shortcut_seeker');
  const lastGateIndex = course.allCheckpoints.length - 1;
  const leg = route.filter((point) => point.targetGateIndex === lastGateIndex);
  const finish = course.allCheckpoints[lastGateIndex];
  expect(leg.length).toBe(1);
  expect(leg[0].x).toBeCloseTo(finish.x, 4);
  expect(leg[0].z).toBeCloseTo(finish.z, 4);
});
