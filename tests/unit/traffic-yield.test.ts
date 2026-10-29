import { describe, expect, it } from 'vitest';
import { forwardPlayerGap } from '../../src/ai/traffic';

describe('NPC forward collision corridor', () => {
  const gap = (x: number, z: number, yaw = 0) => forwardPlayerGap(0, 0, yaw, 0.9, 1.7, x, z);
  it('brakes for a player stopped ahead on the same lane', () => {
    expect(gap(0, 8)).toBeCloseTo(4.95);
    expect(gap(0, 3)).toBeLessThan(0);
  });
  it('does not brake for a player approaching from behind', () => {
    expect(gap(0, -3)).toBeNull();
    expect(gap(0, -12)).toBeNull();
  });
  it('does not stop for a crossing or side-approaching player', () => {
    expect(gap(5, 6)).toBeNull();
    expect(gap(-5, 1)).toBeNull();
  });
  it('works for left and right facing turns', () => {
    expect(gap(9, 0, Math.PI / 2)).toBeGreaterThan(0);
    expect(gap(-9, 0, -Math.PI / 2)).toBeGreaterThan(0);
    expect(gap(-9, 0, Math.PI / 2)).toBeNull();
  });
});
