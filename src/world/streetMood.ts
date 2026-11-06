import { PLACES, snapToNearestRoad } from './layout';
import { clamp01 } from '../core/mathx';

/** Gameplay sound/activity zoning; no invented business coordinates or claims
 * about measured real-world crowd counts. Evaluate at most a few times/second. */
export function streetMoodAt(x: number, z: number, minutes: number): number {
  const road = snapToNearestRoad(x, z).segment;
  let hub = 0;
  for (const place of PLACES) {
    if (place.id !== 'bazaar' && place.id !== 'stand' && place.id !== 'shia') continue;
    const d = Math.hypot(x - place.x, z - place.z);
    hub = Math.max(hub, clamp01(1 - d / 72));
  }
  const m = ((minutes % 1440) + 1440) % 1440;
  const day = m >= 390 && m < 1260 ? 1 : .28;
  const roadLife = road.kind === 'gali' ? .2 : road.jamProne ? .62 : .42;
  return clamp01((roadLife + hub * .52) * day);
}
