import { describe, expect, it } from 'vitest';
import { PLACES, ROAD_SEGMENTS, findRoute, distanceToRoadCorridor, isFootprintClearOfCorridor } from '../../src/world/layout';
import { PED_PATHS } from '../../src/ai/pedestrians';
import { getLaneGraph } from '../../src/ai/routes';
import { Scrapbook } from '../../src/career/scrapbook';

// The site is an in-game area, not a claim about real property boundaries.
describe('removed landmark and retained public Mohammadpur graph', () => {
  it('has no retired destination or POI while the ordinary street network remains connected', () => {
    expect(PLACES.some(p => /drmc|residential model college/i.test(p.id + p.nameKey))).toBe(false);
    for (const [x,z] of [[-126,-136],[42,106],[162,-172]]) {
      const plan = findRoute(x, z, 42, 106);
      expect(plan.segmentIds.length).toBeGreaterThan(x === 42 && z === 106 ? -1 : 0);
    }
    expect(ROAD_SEGMENTS.some(s => s.id === 'shahjahan_2')).toBe(true);
    expect(getLaneGraph().lanes.length).toBeGreaterThan(100);
    expect(PED_PATHS.length).toBeGreaterThan(80);
  });
  it('uses the same footprint clearance on former open ground and all public roads', () => {
    expect(isFootprintClearOfCorridor(42,106,7,7,0)).toBe(false);
    expect(distanceToRoadCorridor(42,106)).toBeLessThan(1);
    expect(isFootprintClearOfCorridor(74,-105,6,7,0)).toBe(true);
  });
  it('does not resurrect the retired visit from an existing save', () => {
    const make = (id: string) => ({ id, category: 'milestone' as const, titleBn: 'ভ্রমণ',
      titleEn: 'Visit', detailBn: '', detailEn: '', minutesOfDay: 500, vehicleId: 'classic', createdAtRealMs: 100 });
    const saved = { records: [make('landmark:drmc'), make('milestone:other')], totalTakaEarned: 70 };
    const migrated = Scrapbook.fromJSON(saved);
    expect(migrated.snapshot.records.map(r => r.id)).toEqual(['milestone:other']);
    expect(migrated.snapshot.totalTakaEarned).toBe(70);
  });
});
