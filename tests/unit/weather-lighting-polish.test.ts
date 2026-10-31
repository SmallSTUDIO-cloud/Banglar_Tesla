import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { QUALITY } from '../../src/core/config';
import { EnvironmentSystem, sampleDayLighting } from '../../src/world/environment';
import { targetBlendFor } from '../../src/world/weatherDirector';

function environment() {
  const scene = new THREE.Scene();
  const env = new EnvironmentSystem(scene, QUALITY.balanced);
  env.setClockMinutes(12 * 60);
  env.setPhase('noon');
  return { env, scene };
}

describe('integrated weather and light polish', () => {
  it('keeps dawn, dusk and the midnight wrap continuous across all key outputs', () => {
    for (const minute of [0, 295, 450, 750, 1005, 1105, 1275, 1440]) {
      const before = sampleDayLighting(minute - 0.01);
      const after = sampleDayLighting(minute + 0.01);
      expect(Math.abs(before.night - after.night)).toBeLessThan(0.001);
      expect(Math.abs(before.cfg.ambient - after.cfg.ambient)).toBeLessThan(0.001);
      expect(Math.abs(before.cfg.fogDensity - after.cfg.fogDensity)).toBeLessThan(0.0001);
      expect(Math.abs(before.cfg.exposure - after.cfg.exposure)).toBeLessThan(0.001);
    }
  });

  it('makes storm rain at least as dense as rainy weather, with a warmer clear sky', () => {
    expect(targetBlendFor('storm').rain).toBeGreaterThanOrEqual(targetBlendFor('rain').rain);
    const { env } = environment();
    env.setWeather('sunny');
    const clear = (env as any).skyUniforms.uZenith.value.clone() as THREE.Color;
    env.setWeather('storm');
    const storm = (env as any).skyUniforms.uZenith.value as THREE.Color;
    expect(storm.getHSL({ h: 0, s: 0, l: 0 }).l).toBeLessThan(clear.getHSL({ h: 0, s: 0, l: 0 }).l);
    env.dispose();
  });

  it('retains dark storm fog at midnight and lights the environment briefly without a white wipe', () => {
    const { env, scene } = environment();
    env.setWeather('storm');
    const dayFog = (scene.fog as THREE.FogExp2).color.clone();
    env.setClockMinutes(0);
    env.setPhase('night');
    const nightFog = (scene.fog as THREE.FogExp2).color.clone();
    expect(nightFog.getHSL({ h: 0, s: 0, l: 0 }).l).toBeLessThan(dayFog.getHSL({ h: 0, s: 0, l: 0 }).l);
    const before = env.sun.intensity;
    env.strike(1, true);
    env.update(1 / 60, new THREE.Vector3());
    expect(env.sun.intensity).toBeGreaterThan(before);
    expect(env.sun.intensity).toBeLessThan(before + 2);
    const flashed = env.sun.intensity;
    for (let i = 0; i < 35; i++) env.update(1 / 60, new THREE.Vector3());
    expect(env.sun.intensity).toBeLessThan(flashed);
    env.dispose();
  });

  it('keeps the clock/weather fog when a mobile quality preset changes', () => {
    const { env, scene } = environment();
    env.setClockMinutes(22 * 60);
    env.setPhase('night');
    env.setWeather('storm');
    const before = (scene.fog as THREE.FogExp2).density;
    env.setQuality({ ...QUALITY.low, viewDistance: 120 });
    const after = (scene.fog as THREE.FogExp2).density;
    expect(after / before).toBeCloseTo(1.45, 3);
    env.dispose();
  });

  it('advects pooled rainfall against the moving player without reallocating or relocating after teleports', () => {
    const { env } = environment();
    env.setWeather('rain');
    env.setRainGraphics('dynamic', 'medium', true, true);
    const drops = (env as any).rainDrops as Float32Array;
    const geo = (env as any).rainGeo as THREE.BufferGeometry;
    const focus = new THREE.Vector3(0, 0, 0);
    env.update(1 / 30, focus);
    const idx = Array.from({ length: 70 }, (_, i) => i).find((i) => drops[i * 3 + 1] > 9 && Math.abs(drops[i * 3]) < 15 && Math.abs(drops[i * 3 + 2]) < 15)!;
    expect(idx).toBeDefined();
    const beforeX = drops[idx * 3];
    const beforeZ = drops[idx * 3 + 2];
    env.update(1 / 30, focus.set(4, 0, 3));
    expect(drops).toBe((env as any).rainDrops);
    expect(geo).toBe((env as any).rainGeo);
    expect(drops[idx * 3]).toBeLessThan(beforeX - 1.7);
    expect(drops[idx * 3 + 2]).toBeLessThan(beforeZ - 1.4);
    const teleported = drops[idx * 3];
    env.update(1 / 30, focus.set(500, 0, 300));
    expect(Math.abs(drops[idx * 3] - teleported)).toBeLessThan(1);
    env.dispose();
  });
});
