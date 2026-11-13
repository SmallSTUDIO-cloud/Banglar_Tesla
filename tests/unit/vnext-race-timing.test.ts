import { describe, expect, it } from 'vitest';
import { BLACKLIST_RIVALS, OPEN_STREET_EVENTS } from '../../src/blacklist/blacklistCatalog';
import { RivalRaceSystem } from '../../src/blacklist/raceSystem';

/**
 * Deterministic, unobstructed reference timings, not a substitute for human
 * play. A deadline should not expire before the racers can complete the course.
 *
 * This simulates up to 450 s of racing at 60 fps for every blacklist and
 * open-street event, which realistically needs 5-7 s of CPU on a dev machine.
 * It was left on vitest's 5 s default and failed intermittently for that
 * reason alone (measured 5.3-7.0 s over three consecutive runs on untouched
 * source), so it now declares the headroom it actually needs.
 */
describe('race deadline calibration', () => {
  it('gives every normal AI finisher breathing room before the authored deadline', () => {
    const events = [
      ...BLACKLIST_RIVALS.map((rival) => ({ event: rival.bossEvent, rival })),
      ...OPEN_STREET_EVENTS.map((event) => ({ event, rival: null })),
    ];
    const failures: string[] = [];
    for (const { event, rival } of events) {
      const race = new RivalRaceSystem(() => 0);
      race.startEvent({ ...event, targetSeconds: 1000 }, rival, 0);
      let standings = race.getStandings(9999, 9999);
      for (let i = 0; i < 450 * 60; i++) {
        race.update(1 / 60, 9999, 9999, 0, i / 60);
        standings = race.getStandings(9999, 9999);
        const ai = standings.filter((entry) => !entry.isPlayer);
        if (ai.length && ai.every((entry) => entry.finished)) break;
      }
      const ai = standings.filter((entry) => !entry.isPlayer);
      const times = ai.map((entry) => entry.timeSeconds);
      const slowest = Math.max(...times);
      const minimum = Math.ceil((slowest * 1.2 + 10) / 5) * 5;
      if (ai.some((entry) => !entry.finished) || event.targetSeconds < minimum) {
        failures.push(`${event.id}: limit ${event.targetSeconds}s; AI ${times.join('/')}s; minimum ${minimum}s`);
      }
      race.cancel();
    }
    expect(failures).toEqual([]);
  }, 60_000);
});
