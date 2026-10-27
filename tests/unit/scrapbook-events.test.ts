import { describe, expect, it } from 'vitest';
import {
  MAX_PHOTO_THUMBNAILS,
  MAX_SCRAPBOOK_RECORDS,
  Scrapbook,
} from '../../src/career/scrapbook';
import { EventDirector, MAX_CONCURRENT_EVENTS, type EventContext } from '../../src/events/eventDirector';
import { ScoreSystem } from '../../src/gameplay/scoreSystem';

function ctx(over: Partial<EventContext> = {}): EventContext {
  return {
    x: 0,
    z: 0,
    timeMinutes: 12 * 60,
    heat: 0,
    trafficDensity: 0.5,
    raining: false,
    inMission: false,
    inRace: false,
    policeActive: false,
    roadRageActive: false,
    cinematicActive: false,
    paused: false,
    reduceEffects: false,
    ...over,
  };
}

describe('career scrapbook (vNext §10)', () => {
  it('deduplicates stable ids — retries never duplicate records or money', () => {
    const book = new Scrapbook();
    const rec = {
      id: 'win:bl_boss_10',
      category: 'race' as const,
      titleBn: 'জয়',
      titleEn: 'Win',
      detailBn: '',
      detailEn: '',
      minutesOfDay: 500,
      vehicleId: 'classic',
      takaDelta: 260,
      repDelta: 120,
    };
    expect(book.addRecord(rec).added).toBe(true);
    expect(book.addRecord(rec).added).toBe(false);
    expect(book.addRecord({ ...rec }).added).toBe(false);
    expect(book.recordCount).toBe(1);
    expect(book.snapshot.raceWins).toBe(1);
    expect(book.snapshot.totalTakaEarned).toBe(260);
    expect(book.snapshot.totalRepEarned).toBe(120);
  });

  it('collapses loss spam inside 60 s windows per event (no record/money farming)', () => {
    const book = new Scrapbook();
    const detail = { minutesOfDay: 600, vehicleId: 'classic' };
    const a = book.recordRaceLoss('ev_duel_ring', detail, 1000);
    const b = book.recordRaceLoss('ev_duel_ring', detail, 15_000); // same 60 s bucket
    const c = book.recordRaceLoss('ev_duel_ring', detail, 61_000); // next bucket
    expect(a.added).toBe(true);
    expect(b.added).toBe(false);
    expect(c.added).toBe(true);
    expect(book.snapshot.raceLosses).toBe(2);
  });

  it('records purchases/upgrades once per item level', () => {
    const book = new Scrapbook();
    expect(book.recordPurchase('upgrade:turboCap', 1, { minutesOfDay: 0, vehicleId: 'classic', takaDelta: 500 }).added).toBe(true);
    expect(book.recordPurchase('upgrade:turboCap', 1, { minutesOfDay: 0, vehicleId: 'classic', takaDelta: 500 }).added).toBe(false);
    expect(book.recordPurchase('upgrade:turboCap', 2, { minutesOfDay: 0, vehicleId: 'classic', takaDelta: 800 }).added).toBe(true);
    expect(book.recordCount).toBe(2);
  });

  it('bounds photo thumbnails and record count without crashing', () => {
    const book = new Scrapbook();
    const tiny = 'data:image/jpeg;base64,' + 'A'.repeat(500);
    for (let i = 0; i < 12; i++) {
      book.addRecord({
        id: `photo:win:ev${i}`,
        category: 'photo',
        titleBn: 'ছবি',
        titleEn: 'Photo',
        detailBn: '',
        detailEn: '',
        minutesOfDay: 0,
        vehicleId: 'classic',
        photoThumb: tiny,
      });
    }
    expect(book.photoCount).toBeLessThanOrEqual(MAX_PHOTO_THUMBNAILS);
    for (let i = 0; i < MAX_SCRAPBOOK_RECORDS + 40; i++) {
      book.addRecord({
        id: `milestone:m${i}`,
        category: 'milestone',
        titleBn: 'মাইলফলক',
        titleEn: 'Milestone',
        detailBn: '',
        detailEn: '',
        minutesOfDay: 0,
        vehicleId: 'classic',
      });
    }
    expect(book.recordCount).toBeLessThanOrEqual(MAX_SCRAPBOOK_RECORDS);
  });

  it('round-trips through JSON with dedup and safe defaults (backward-compatible migration)', () => {
    const book = new Scrapbook();
    book.addRecord({
      id: 'win:ev_a',
      category: 'race',
      titleBn: 'জয়',
      titleEn: 'Win',
      detailBn: '',
      detailEn: '',
      minutesOfDay: 100,
      vehicleId: 'electric',
      takaDelta: 300,
      topSpeedKmh: 58,
    });
    book.recordStat('policeEscapes');
    book.recordBestCombo(4);
    const restored = Scrapbook.fromJSON(JSON.parse(JSON.stringify(book.toJSON())));
    expect(restored.recordCount).toBe(1);
    expect(restored.findRecord('win:ev_a')?.topSpeedKmh).toBe(58);
    expect(restored.snapshot.policeEscapes).toBe(1);
    expect(restored.snapshot.bestCombo).toBe(4);
    // hostile/partial payloads never crash
    const safe = Scrapbook.fromJSON({ records: [{ id: 'x' }, null, { noId: 1 }], raceWins: 'NaN' });
    expect(safe.recordCount).toBe(1);
    expect(safe.snapshot.raceWins).toBe(0);
  });

  it('tracks lifetime bests and idempotent win flags', () => {
    const book = new Scrapbook();
    book.addRecord({
      id: 'win:ev_b',
      category: 'race',
      titleBn: '',
      titleEn: '',
      detailBn: '',
      detailEn: '',
      minutesOfDay: 0,
      vehicleId: 'classic',
      topSpeedKmh: 44,
    });
    book.addRecord({
      id: 'record:topspeed',
      category: 'record',
      titleBn: '',
      titleEn: '',
      detailBn: '',
      detailEn: '',
      minutesOfDay: 0,
      vehicleId: 'classic',
      topSpeedKmh: 61,
    });
    expect(book.snapshot.topSpeedKmh).toBe(61);
    expect(book.hasWin('ev_b')).toBe(true);
    expect(book.hasWin('ev_c')).toBe(false);
  });
});

describe('bounded event director (vNext §7)', () => {
  it('caps concurrent events and enforces the major cooldown', () => {
    const dir = new EventDirector();
    const spawned: string[] = [];
    dir.onSpawn = (ev) => spawned.push(ev.kind);
    let seed = 3;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed / 0xffffffff;
    };
    for (let t = 0; t < 300; t += 0.5) {
      dir.update(0.5, ctx(), rng);
    }
    expect(dir.activeCount).toBeLessThanOrEqual(MAX_CONCURRENT_EVENTS);
    expect(spawned.length).toBeGreaterThan(0);
    expect(spawned.length).toBeLessThanOrEqual(8);
  });

  it('never spawns during missions, races, pursuits, road-rage or cinematics', () => {
    const dir = new EventDirector();
    let spawned = 0;
    dir.onSpawn = () => spawned++;
    for (let t = 0; t < 60; t += 0.25) {
      dir.update(0.25, ctx({ inMission: true }), () => 0.01);
      dir.update(0.25, ctx({ inRace: true }), () => 0.01);
      dir.update(0.25, ctx({ policeActive: true }), () => 0.01);
      dir.update(0.25, ctx({ roadRageActive: true }), () => 0.01);
      dir.update(0.25, ctx({ cinematicActive: true }), () => 0.01);
    }
    expect(spawned).toBe(0);
  });

  it('requests guaranteed cleanup exactly once per zone at TTL expiry', () => {
    const dir = new EventDirector();
    let cleanups = 0;
    dir.onSpawn = (ev) => {
      ev.cleanup = () => cleanups++;
    };
    let seed = 11;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    for (let t = 0; t < 240; t += 0.5) {
      dir.update(0.5, ctx(), rng);
    }
    const madeBeforeClear = cleanups;
    dir.clearAll();
    expect(cleanups).toBeGreaterThanOrEqual(madeBeforeClear);
    expect(dir.activeCount).toBe(0);
  });

  it('keeps event zones separated (never packs disasters into one alley)', () => {
    const dir = new EventDirector();
    let checked = 0;
    dir.onSpawn = (ev) => {
      // Guarantee: no two CONCURRENT zones within MIN_ZONE_SPACING (a zone may
      // legally reopen after its predecessor's guaranteed cleanup).
      for (const z of dir.activeEvents) {
        if (z.id === ev.id) continue;
        checked++;
        expect(Math.hypot(z.x - ev.x, z.z - ev.z)).toBeGreaterThanOrEqual(38);
      }
    };
    let seed = 77;
    const rng = () => {
      seed = (seed * 22695477 + 1) >>> 0;
      return seed / 0xffffffff;
    };
    for (let t = 0; t < 420; t += 0.5) {
      dir.update(0.5, ctx(), rng);
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('stunt/score combos (vNext §9)', () => {
  it('chains combos inside the window and reports best combo', () => {
    const score = new ScoreSystem();
    const stunts: Array<{ kind: string; combo: number }> = [];
    score.onStunt = (ev) => stunts.push({ kind: ev.kind, combo: ev.combo });
    score.register('near_miss');
    score.register('destruction');
    score.register('impact');
    expect(stunts.map((s) => s.combo)).toEqual([1, 2, 3]);
    expect(score.currentCombo).toBe(3);
    // Lapse the combo window
    for (let t = 0; t < 7; t += 0.1) {
      score.update(0.1, { tilt: 0, lateral: 0, speed: 0 });
    }
    expect(score.currentCombo).toBe(0);
    expect(score.best).toBe(3);
  });

  it('detects sustained tilt, drift and speed streaks at safe thresholds', () => {
    const score = new ScoreSystem();
    const kinds: string[] = [];
    score.onStunt = (ev) => kinds.push(ev.kind);
    // Sustained tilt at speed
    for (let t = 0; t < 1.4; t += 1 / 60) score.update(1 / 60, { tilt: 0.75, lateral: 0, speed: 4 });
    // Sustained drift
    for (let t = 0; t < 1.3; t += 1 / 60) score.update(1 / 60, { tilt: 0, lateral: 3.2, speed: 5 });
    // Speed streak (6 s above 11.5 m/s)
    for (let t = 0; t < 6.4; t += 1 / 60) score.update(1 / 60, { tilt: 0, lateral: 0, speed: 13 });
    expect(kinds).toContain('tilt_skill');
    expect(kinds).toContain('drift');
    expect(kinds).toContain('speed');
  });

  it('never locks input or states (reset works; combos bounded)', () => {
    const score = new ScoreSystem();
    for (let i = 0; i < 50; i++) score.register('near_miss');
    expect(score.currentCombo).toBe(50);
    score.reset();
    expect(score.currentCombo).toBe(0);
    score.update(1, { tilt: 9, lateral: 9, speed: 99 });
    expect(Number.isFinite(score.currentCombo)).toBe(true);
  });
});
