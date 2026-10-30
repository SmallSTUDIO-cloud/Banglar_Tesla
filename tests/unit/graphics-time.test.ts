import { describe, expect, it } from 'vitest';
import { sampleDayLighting } from '../../src/world/environment';

function colorDifference(a: string, b: string): number {
  return Math.max(...[0, 2, 4].map((i) => Math.abs(parseInt(a.slice(i + 1, i + 3), 16) - parseInt(b.slice(i + 1, i + 3), 16))));
}

describe('continuous lighting across the accelerated Dhaka day', () => {
  it('has no hard changes at the old golden, blue and night phase boundaries', () => {
    for (const boundary of [330, 630, 960, 1080, 1170, 1439.99, 0, 420]) {
      const before = sampleDayLighting(boundary - 0.01);
      const after = sampleDayLighting(boundary + 0.01);
      expect(Math.abs(before.cfg.sunIntensity - after.cfg.sunIntensity)).toBeLessThan(0.005);
      expect(Math.abs(before.cfg.lamps - after.cfg.lamps)).toBeLessThan(0.005);
      expect(colorDifference(before.cfg.horizon, after.cfg.horizon)).toBeLessThan(2);
    }
  });
  it('develops lights and stars progressively rather than snapping', () => {
    const evening = [1050, 1105, 1170, 1275].map(sampleDayLighting);
    expect(evening[0].night).toBeLessThan(evening[1].night);
    expect(evening[1].night).toBeLessThan(evening[2].night);
    expect(evening[2].night).toBeLessThan(evening[3].night);
    expect(evening[0].cfg.lamps).toBeLessThan(evening[3].cfg.lamps);
    expect(sampleDayLighting(1440).night).toBe(sampleDayLighting(0).night);
  });
});
