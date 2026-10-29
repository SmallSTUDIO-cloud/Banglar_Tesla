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

describe('quiet hours', () => {
  it('gradually thins traffic after midnight and restores it before 07:00 without an hour-boundary step', async () => {
    const { quietTrafficFactor } = await import('../../src/ai/traffic');
    expect(Math.abs(quietTrafficFactor(1439.9) - quietTrafficFactor(0))).toBeLessThan(0.002);
    expect(quietTrafficFactor(10)).toBeLessThan(quietTrafficFactor(0));
    expect(quietTrafficFactor(210)).toBeCloseTo(0.45);
    expect(quietTrafficFactor(390)).toBeGreaterThan(quietTrafficFactor(300));
    expect(Math.abs(quietTrafficFactor(419.9) - quietTrafficFactor(420))).toBeLessThan(0.002);
    expect(quietTrafficFactor(430)).toBe(1);
  });
});
