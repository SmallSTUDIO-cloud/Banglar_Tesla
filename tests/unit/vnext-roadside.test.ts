import { describe, expect, it } from 'vitest';
import { PED_PATHS } from '../../src/ai/pedestrians';
import { FareNegotiation, chooseRoadsideStop, nearestSafeSidewalk, roadsideStopKey, shouldCallForRide } from '../../src/missions/roadside';
import { isInsideDrmcCampus } from '../../src/world/drmcGeo';
import { isClearOfRoads, PLACES } from '../../src/world/layout';

describe('roadside passenger offers', () => {
  it('uses a separate 30% call roll and a stable waiting-point cooldown key', () => {
    expect(shouldCallForRide(() => 0.2999)).toBe(true);
    expect(shouldCallForRide(() => 0.3)).toBe(false);
    let calls = 0;
    for (let i = 0; i < 100; i++) if (shouldCallForRide(() => i / 100)) calls++;
    expect(calls).toBe(30);
    const stop = chooseRoadsideStop(PED_PATHS, 42, 106, 0, () => 0)!;
    expect(roadsideStopKey(stop)).toBe(roadsideStopKey({ ...stop, actor: { ...stop.actor } }));
    expect(roadsideStopKey(stop)).not.toBe(roadsideStopKey({ ...stop, actor: { ...stop.actor, x: stop.actor.x + 3 } }));
  });
  it('uses exactly one 50% negotiation roll, revising the offer on success', () => {
    let rolls = 0;
    const offer = new FareNegotiation(100);
    expect(offer.attempt(() => { rolls++; return 0.4999; })).toBe('accepted');
    expect(offer.fare).toBe(120);
    expect(offer.attempt(() => { rolls++; return 0; })).toBe('already-attempted');
    expect(rolls).toBe(1);
    const rejected = new FareNegotiation(100);
    expect(rejected.attempt(() => 0.5)).toBe('rejected');
    expect(rejected.attempt(() => 0)).toBe('already-attempted');
    expect(rejected.fare).toBe(100);
    let successes = 0;
    for (let i = 0; i < 100; i++) if (new FareNegotiation(100).attempt(() => i / 100) === 'accepted') successes++;
    expect(successes).toBe(50);
  });
  it('keeps mission pickup and drop-off pedestrians on public sidewalks, including DRMC places', () => {
    for (const place of PLACES) {
      const spot = nearestSafeSidewalk(PED_PATHS, place.x, place.z);
      expect(spot, place.id).not.toBeNull();
      expect(isInsideDrmcCampus(spot!.x, spot!.z, 1.6), place.id).toBe(false);
      expect(isClearOfRoads(spot!.x, spot!.z, 0.15), place.id).toBe(true);
      expect(Math.hypot(spot!.x-place.x, spot!.z-place.z), place.id).toBeLessThan(35);
    }
  });
  it('chooses nearby road-connected sidewalk locations outside the campus and avoids rejected locations', () => {
    for (const [x,z] of [[42,106], [-126,-136], [31,-56], [134,-38]]) {
      const stop = chooseRoadsideStop(PED_PATHS, x, z, 0, () => 0.5);
      expect(stop).not.toBeNull();
      if (!stop) continue;
      expect(Math.hypot(stop.actor.x-x, stop.actor.z-z)).toBeGreaterThanOrEqual(10);
      expect(Math.hypot(stop.actor.x-x, stop.actor.z-z)).toBeLessThanOrEqual(35);
      expect(isClearOfRoads(stop.actor.x, stop.actor.z, 0.1)).toBe(true);
      expect(isInsideDrmcCampus(stop.actor.x, stop.actor.z, 2)).toBe(false);
      expect(isInsideDrmcCampus(stop.pickup.x, stop.pickup.z, 1.5)).toBe(false);
      expect(isInsideDrmcCampus(stop.departure.x, stop.departure.z, 1.6)).toBe(false);
      expect(chooseRoadsideStop(PED_PATHS, x, z, 0, () => 0, () => false)).toBeNull();
    }
  });
});
