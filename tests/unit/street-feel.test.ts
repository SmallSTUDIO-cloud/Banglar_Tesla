import { describe, expect, it } from 'vitest';
import { DAMAGE_ZONES, roadDamageAt } from '../../src/world/roadDamage';
import { streetMoodAt } from '../../src/world/streetMood';
import { identityIndex, voiceDirection } from '../../src/audio/voiceDirection';

describe('bounded, offline street feel', () => {
  it('keeps worn roads inside a few authored non-junction carriageway stretches', () => {
    expect(DAMAGE_ZONES.length).toBe(4);
    for (const { segment: s, begin, end } of DAMAGE_ZONES) {
      expect(begin).toBeGreaterThan(6);
      expect(end).toBeLessThan(s.length - 5);
      const middle = (begin + end) / 2;
      const x = s.ax + s.ux * middle, z = s.az + s.uz * middle;
      expect(roadDamageAt(x, z)).toBeGreaterThan(.6);
      expect(roadDamageAt(x + s.leftX * (s.halfWidth + 1), z + s.leftZ * (s.halfWidth + 1))).toBe(0);
    }
    expect(roadDamageAt(600, 600)).toBe(0);
  });

  it('changes mood by street and time without changing topology', () => {
    const livelyDay = streetMoodAt(42, 106, 720);
    const quietNight = streetMoodAt(42, 106, 130);
    expect(livelyDay).toBeGreaterThan(quietNight);
    expect(livelyDay).toBeGreaterThan(streetMoodAt(-86, -96, 720));
  });

  it('uses stable distinct character direction with strict bounded prosody', () => {
    expect(identityIndex('passenger:tea', 9)).toBe(identityIndex('passenger:tea', 9));
    expect(identityIndex('passenger:tea', 0)).toBe(0);
    const excited = voiceDirection('nabila', 'excited', 1, 1);
    const calm = voiceDirection('nabila', 'calm', 1, 1);
    expect(excited.pitch).toBeGreaterThan(calm.pitch);
    expect(excited.rate).toBeGreaterThan(calm.rate);
    expect(voiceDirection('rival', 'angry', 5, -1)).toEqual({ pitch: 1.5, rate: .75 });
  });
});
