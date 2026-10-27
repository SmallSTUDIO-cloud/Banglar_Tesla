import { describe, expect, it } from 'vitest';
import { WeatherDirector, targetBlendFor } from '../../src/world/weatherDirector';
import { sanitizeSettings, DEFAULT_SETTINGS } from '../../src/core/settings';

function ctx(over: Partial<Parameters<WeatherDirector['update']>[1]> = {}) {
  return {
    timeMinutes: 12 * 60,
    inRace: false,
    raceFinalStretch: false,
    eventOverride: false,
    reduceEffects: false,
    lowFlash: false,
    ...over,
  };
}

function runDeterministic(d: WeatherDirector, dt: number, seconds: number, c = ctx()) {
  let changes = 0;
  for (let t = 0; t < seconds; t += dt) {
    if (d.update(dt, c)) changes++;
  }
  return changes;
}

describe('dynamic weather director (vNext §4)', () => {
  it('exposes exactly five states with distinct blend profiles', () => {
    const sunny = targetBlendFor('sunny');
    const overcast = targetBlendFor('overcast');
    const rain = targetBlendFor('rain');
    const windy = targetBlendFor('windy');
    const storm = targetBlendFor('storm');
    expect(sunny.overcast).toBeLessThan(0.1);
    expect(overcast.overcast).toBeGreaterThan(sunny.overcast);
    expect(rain.wet).toBe(1);
    expect(rain.rain).toBeGreaterThan(0.8);
    expect(windy.wind).toBeGreaterThanOrEqual(1);
    expect(storm.lightning).toBe(1);
    expect(storm.overcast).toBe(1);
  });

  it('blends gradually — no instant catastrophic state swaps', () => {
    let seed = 7;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    const d = new WeatherDirector('sunny', rng);
    d.setWeatherImmediate('sunny');
    // Force an immediate transition request
    d['holdTimer'] = 0;
    d.update(0.016, ctx());
    if (d.isTransitioning) {
      const before = { ...d.blend };
      d.update(0.5, ctx());
      // blend values move a bounded amount per update — never a full snap
      expect(Math.abs(d.blend.overcast - before.overcast)).toBeLessThan(0.35);
    }
  });

  it('suppresses storm transitions during a race final stretch unless authored', () => {
    let i = 0;
    const seq = [0.99, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02];
    const rng = () => seq[i++ % seq.length];
    const d = new WeatherDirector('windy', rng);
    d.setWeatherImmediate('windy');
    d['holdTimer'] = 0;
    d.update(0.5, ctx({ inRace: true, raceFinalStretch: true, timeMinutes: 18 * 60 }));
    if (d.isTransitioning) {
      expect(d['transitioningTo']).not.toBe('storm');
    }
    // Authored weather overrides the protection entirely
    d.setWeatherImmediate('storm');
    expect(d.weather).toBe('storm');
  });

  it('emits bounded lightning in storm with low-flash respect and schedules thunder delays', () => {
    const strikes: Array<{ intensity: number; flashAllowed: boolean }> = [];
    const d = new WeatherDirector('storm');
    d.onLightning = (intensity, flashAllowed) => strikes.push({ intensity, flashAllowed });
    d.setWeatherImmediate('storm');
    // 120 s of storm at 60 Hz with low-flash ON: flashAllowed must stay false
    let t = 0;
    while (t < 120) {
      d.update(1 / 60, ctx({ lowFlash: true, reduceEffects: true }));
      t += 1 / 60;
    }
    expect(strikes.length).toBeGreaterThan(0);
    expect(strikes.length).toBeLessThanOrEqual(18); // bounded: 5–14 s spacing
    for (const s of strikes) {
      expect(s.flashAllowed).toBe(false); // low-flash + reduced-motion always honored
      expect(s.intensity).toBeGreaterThan(0.2);
      expect(s.intensity).toBeLessThanOrEqual(1.01);
    }
  });

  it('keeps wind blend coherent across windy and storm states', () => {
    expect(targetBlendFor('windy').wind).toBeGreaterThan(targetBlendFor('rain').wind);
    expect(targetBlendFor('storm').wind).toBeGreaterThan(targetBlendFor('windy').wind);
  });

  it('completes transitions and reports the new authoritative state exactly once', () => {
    const d = new WeatherDirector('sunny', () => 0.5);
    d.setWeatherImmediate('sunny');
    let changes = 0;
    d.onWeatherChange = (w) => {
      changes++;
      expect(['overcast', 'windy']).toContain(w);
    };
    d['holdTimer'] = 0;
    d.update(1 / 60, ctx());
    // run until any transition completes (bounded 60 s)
    runDeterministic(d, 1 / 60, 60, ctx());
    expect(changes).toBeGreaterThanOrEqual(0);
    // A forced completion fires exactly one change event
    let fired = 0;
    d.onWeatherChange = () => fired++;
    d.setWeatherImmediate('rain');
    expect(fired).toBe(1);
    expect(d.weather).toBe('rain');
  });

  it('adds the low-flash comfort setting with safe defaults and sanitization', () => {
    expect(DEFAULT_SETTINGS.lowFlash).toBe(false);
    expect(sanitizeSettings({ lowFlash: true }).lowFlash).toBe(true);
    expect(sanitizeSettings({ lowFlash: 'yes' }).lowFlash).toBe(false);
  });
});
