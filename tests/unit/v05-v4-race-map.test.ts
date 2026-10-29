import { describe, expect, it } from 'vitest';
import {
  buildRaceCourse,
  validateRaceCourse,
} from '../../src/blacklist/raceRoutes';
import {
  BLACKLIST_RIVALS,
  OPEN_STREET_EVENTS,
  eventById,
  renderRivalPortraitSvg,
  selectRaceRivalTrio,
} from '../../src/blacklist/blacklistCatalog';
import { RivalRaceSystem } from '../../src/blacklist/raceSystem';
import { QUALITY } from '../../src/core/config';
import { sanitizeSettings } from '../../src/core/settings';
import { distanceToRoadCarriageway } from '../../src/world/layout';
import { PedestrianSystem } from '../../src/ai/pedestrians';
import { TRAFFIC_TYPES, getTrafficArchetype } from '../../src/ai/vehicles';

describe('v0.5.0 v4 Purpose-Built Mohammadpur Race-Map, 4-Racer Mode & Rival Characters', () => {
  it('validates all 17 Mohammadpur race blueprints (grid clearance, carriageway bounds, reachability & shortcuts)', () => {
    const allEvents = [
      ...BLACKLIST_RIVALS.map((r) => r.bossEvent),
      ...OPEN_STREET_EVENTS,
    ];
    expect(allEvents.length).toBe(17);

    for (const ev of allEvents) {
      const report = validateRaceCourse(ev);
      expect(report.issues, `Course ${ev.id} failed validation: ${report.issues.join('; ')}`).toEqual([]);
      expect(report.valid).toBe(true);

      const course = buildRaceCourse(ev);
      expect(course.gridSlots.length).toBe(4);
      // All 4 racers fit cleanly inside road carriageway and have >= 2.2m pairwise separation
      for (let i = 0; i < course.gridSlots.length; i++) {
        const s = course.gridSlots[i];
        expect(distanceToRoadCarriageway(s.x, s.z)).toBeLessThanOrEqual(0.05);
        for (let j = i + 1; j < course.gridSlots.length; j++) {
          const b = course.gridSlots[j];
          expect(Math.hypot(s.x - b.x, s.z - b.z)).toBeGreaterThanOrEqual(2.2);
        }
      }
      // Every documented shortcut saves meaningful distance vs main route
      for (const sc of course.shortcuts) {
        expect(sc.shortcutDistanceM).toBeLessThan(sc.mainDistanceM);
      }
    }

    // Circuit courses have 2 laps
    expect(buildRaceCourse(eventById('bl_boss_07')!).laps).toBe(2);
    expect(buildRaceCourse(eventById('bl_boss_01')!).laps).toBe(2);
    expect(buildRaceCourse(eventById('ev_street_asad')!).laps).toBe(2);
  });

  it('gives all 10 Blacklist rivals distinct 3D character specs, SVG portraits, and 3-tendency race trios', () => {
    const hairSet = new Set(BLACKLIST_RIVALS.map((r) => r.character.hairStyle));
    const comboSet = new Set(
      BLACKLIST_RIVALS.map(
        (r) => `${r.character.hairStyle}:${r.character.outfitStyle}:${r.character.topHex}`,
      ),
    );
    expect(hairSet.size).toBeGreaterThanOrEqual(8);
    expect(comboSet.size).toBe(10);

    for (const rival of BLACKLIST_RIVALS) {
      const svg = renderRivalPortraitSvg(rival);
      expect(svg).toContain('<svg');
      expect(svg).toContain(rival.accentHex);

      const trio = selectRaceRivalTrio(rival.bossEvent, rival);
      expect(trio.length).toBe(3);
      expect(trio[0].rival.id).toBe(rival.id);
      const ids = new Set(trio.map((x) => x.rival.id));
      expect(ids.size).toBe(3);
      const tendencies = new Set(trio.map((x) => x.tendency));
      expect(tendencies.size).toBe(3);
    }
  });

  it('runs 4-rickshaw RivalRaceSystem with non-teleporting AI, 1/4..4/4 standings, top-speed & single-fire rewards', () => {
    const race = new RivalRaceSystem(() => 0);
    const rival10 = BLACKLIST_RIVALS[0]; // Rank #10 Raju
    let finishedCount = 0;
    let lastSummary: import('../../src/blacklist/raceSystem').RaceResultSummary | null = null;
    race.onRaceFinished = (s) => {
      finishedCount++;
      lastSummary = s;
    };

    // The open race format still supports four; ladder bosses are now 1v1.
    const grid = race.startEvent({ ...rival10.bossEvent, blacklistRank: undefined }, rival10, 0);
    expect(race.participantCount).toBe(4);
    expect(race.getAiRacersSnapshot().length).toBe(3);
    for (const aiSnap of race.getAiRacersSnapshot()) {
      expect(aiSnap.hasVisibleDriver).toBe(true);
    }

    // Clear 3s countdown
    for (let i = 0; i < 200; i++) {
      race.update(1 / 60, grid.x, grid.z, 0, i / 60);
    }
    const snapStart = race.update(0, grid.x, grid.z, 0, 3.4);
    expect(snapStart.phase).toBe('racing');
    expect(snapStart.totalRacers).toBe(4);
    expect(snapStart.rivals.length).toBe(3);

    // Step AI for 4 seconds and verify continuous non-teleporting movement (< 0.5m per 1/60s step)
    const prevPos = race.getAiRacersSnapshot().map((r) => ({ x: r.x, z: r.z }));
    for (let step = 0; step < 240; step++) {
      race.recordPlayerSpeed(14.5); // ~52.2 km/h
      race.update(1 / 60, grid.x, grid.z, 0, 3.5 + step / 60);
      const curSnap = race.getAiRacersSnapshot();
      for (let k = 0; k < curSnap.length; k++) {
        const cur = curSnap[k];
        const stepDist = Math.hypot(cur.x - prevPos[k].x, cur.z - prevPos[k].z);
        expect(stepDist).toBeLessThan(0.5);
        prevPos[k] = { x: cur.x, z: cur.z };
      }
    }

    // Drive player through every checkpoint to win 1/4
    for (const cp of race.checkpoints.slice()) {
      race.update(1 / 60, cp.x, cp.z, 0, 12.0);
    }
    // Extra post-finish updates must NEVER double-fire rewards!
    race.update(1 / 60, grid.x, grid.z, 0, 12.5);
    race.update(1 / 60, grid.x, grid.z, 0, 13.0);

    expect(finishedCount).toBe(1);
    expect(lastSummary).not.toBeNull();
    expect(lastSummary!.won).toBe(true);
    expect(lastSummary!.playerPosition).toBe(1);
    expect(lastSummary!.totalRacers).toBe(4);
    expect(lastSummary!.standings.length).toBe(4);
    expect(lastSummary!.topSpeedKmh).toBeGreaterThanOrEqual(52);
  });

  it('supports Performance, Balanced, High, and Web/PC High quality profiles safely', () => {
    expect(sanitizeSettings({ quality: 'pc_high' }).quality).toBe('pc_high');
    expect(sanitizeSettings({ quality: 'ultra' }).quality).toBe('balanced');
    expect(QUALITY.low.shadows).toBe(false);
    expect(QUALITY.low.propDensity).toBeGreaterThanOrEqual(0.85);
    expect(QUALITY.low.pedestrianCount).toBeGreaterThanOrEqual(40);
    expect(QUALITY.pc_high.shadows).toBe(true);
    expect(QUALITY.pc_high.trafficCount).toBeGreaterThanOrEqual(QUALITY.high.trafficCount);
  });

  it('upgrades NPC pedestrians (head/face, hair/headwear, left & right arms/hands, legs) and preserves traffic collider bounds', () => {
    const peds = new PedestrianSystem(QUALITY.balanced);
    const summary = peds.getCharacterMeshSummary();
    expect(summary.activeCount).toBe(QUALITY.balanced.pedestrians);
    expect(summary.hasHead).toBe(true);
    expect(summary.hasHair).toBe(true);
    expect(summary.hasLeftArm).toBe(true);
    expect(summary.hasRightArm).toBe(true);
    expect(summary.hasLegs).toBe(true);
    peds.update(1 / 60, 0, 0, 4.0, 0);
    peds.dispose();

    for (const kind of TRAFFIC_TYPES) {
      const arch = getTrafficArchetype(kind);
      expect(arch.primaryGeo.attributes.position.count).toBeGreaterThan(20);
      expect(arch.detailGeo.attributes.position.count).toBeGreaterThan(60);
      expect(arch.halfWidth).toBeGreaterThan(0.2);
      expect(arch.halfLength).toBeGreaterThan(0.8);
    }
  });
});
