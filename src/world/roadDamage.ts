import { ROAD_SEGMENTS, type RoadSegment } from './layout';

/** Authored *fictional gameplay* wear, not a claim about present-day road conditions. */
const DAMAGE_IDS = ['zakir_2', 'shershah_deadend', 'aziz_2', 'salimullah_link'] as const;
export interface DamageZone { segment: RoadSegment; begin: number; end: number }
export const DAMAGE_ZONES: readonly DamageZone[] = DAMAGE_IDS.flatMap((id) => {
  const segment = ROAD_SEGMENTS.find((s) => s.id === id);
  return segment && segment.length > 24 ? [{ segment, begin: segment.length * .28, end: segment.length * .76 }] : [];
});

/** No allocation, random sampling, or raycasts in the player/AI update path. */
export function roadDamageAt(x: number, z: number): number {
  let strength = 0;
  for (const zone of DAMAGE_ZONES) {
    const s = zone.segment, dx = x - s.ax, dz = z - s.az;
    const along = dx * s.ux + dz * s.uz;
    if (along <= zone.begin || along >= zone.end) continue;
    const across = Math.abs(dx * s.leftX + dz * s.leftZ);
    if (across > s.halfWidth - .45) continue;
    const edge = Math.min(1, (along - zone.begin) / 2, (zone.end - along) / 2);
    const shoulder = Math.min(1, (s.halfWidth - .45 - across) / 1.3);
    strength = Math.max(strength, edge * shoulder * .75);
  }
  return strength;
}
