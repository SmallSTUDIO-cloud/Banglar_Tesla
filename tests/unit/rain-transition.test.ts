import { describe, expect, it } from 'vitest';
import { rainDrawCount } from '../../src/world/environment';

describe('bounded continuous rain pool allocation', () => {
  it('fades from storm through drizzle to zero rather than holding a fixed rainy minimum', () => {
    const counts = [1, 0.7, 0.4, 0.1, 0.025, 0].map((n) => rainDrawCount(n, 320, 'medium', 'dynamic'));
    expect(counts[0]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(counts[2]);
    expect(counts[2]).toBeGreaterThan(counts[3]);
    expect(counts[3]).toBeGreaterThan(counts[4]);
    expect(counts[4]).toBeLessThan(60);
    expect(counts[5]).toBe(0);
    expect(rainDrawCount(0.6, 320, 'medium', 'dynamic')).toBeGreaterThan(rainDrawCount(0.6, 320, 'medium', 'normal'));
    expect(rainDrawCount(1, 50000, 'high', 'dynamic')).toBe(700);
    expect(rainDrawCount(Number.NaN, 320, 'medium', 'normal')).toBe(0);
  });
});
