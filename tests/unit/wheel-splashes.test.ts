import { describe, expect, it } from 'vitest';
import { WheelSplashes } from '../../src/world/wheelSplashes';

describe('pooled wheel rain splashes', () => {
  it('emits only at moving wet wheel contacts and recycles a fixed 48-instance mesh', () => {
    const fx = new WheelSplashes();
    expect(fx.group.children).toHaveLength(1);
    const mesh = fx.group.children[0];
    for (let i = 0; i < 90; i++) fx.update(1 / 60, 1, 0, 2, 0, 8, 1, true);
    expect(fx.activeCount).toBeGreaterThan(0);
    expect(fx.activeCount).toBeLessThanOrEqual(48);
    expect(fx.group.children[0]).toBe(mesh);
    for (let i = 0; i < 120; i++) fx.update(1 / 60, 1, 0, 2, 0, 0, 0, false);
    expect(fx.activeCount).toBe(0);
    expect((mesh as { count: number }).count).toBe(0);
    fx.dispose();
  });
});
