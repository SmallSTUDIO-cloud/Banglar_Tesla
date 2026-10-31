import { describe, expect, it } from 'vitest';
import { RickshawController, potholeWheelImpulse } from '../../src/vehicle/rickshawController';
import { npcPotholeResponse } from '../../src/ai/traffic';

const depth = (x: number, z: number) => Math.max(0, 0.065 * (1 - Math.hypot(x, z) / 0.78));
const input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
function cross(speed: number, x = 0, suspension = 0): { bump: number; pitch: number; roll: number; endSpeed: number } {
  const c = new RickshawController([], (px, pz) => 0.014 - depth(px, pz), () => 'road', depth);
  c.setTuning({ maxSpeed: 12, accel: 3, brakeDecel: 7, steerMaxLow: 0.5, steerMaxHigh: 0.25,
    grip: 0.75, suspensionSmoothing: suspension });
  c.reset(x, -3, 0);
  c.speed = speed;
  let bump = 0, pitch = 0, roll = 0;
  for (let i = 0; i < 110; i++) {
    const ev = c.step(1 / 60, input, 1, 0);
    bump = Math.max(bump, ev.roughBump);
    pitch = Math.max(pitch, Math.abs(c.bodyPitchOffset));
    roll = Math.max(roll, Math.abs(c.roll));
  }
  return { bump, pitch, roll, endSpeed: c.speed };
}

describe('visible pothole wheel contact response', () => {
  it('has no effect at rest or when wheels miss; higher speed raises bounded response', () => {
    expect(potholeWheelImpulse(0, 0.065, 0)).toBe(0);
    expect(potholeWheelImpulse(6, 0, 0)).toBe(0);
    const miss = cross(6, 3);
    const crawl = cross(1.5);
    const quick = cross(6);
    expect(miss.bump).toBe(0);
    expect(quick.bump).toBeGreaterThan(crawl.bump);
    expect(quick.roll).toBeGreaterThan(miss.roll);
    expect(quick.pitch).toBeLessThan(0.08);
    expect(quick.roll).toBeLessThan(0.11);
    expect(quick.endSpeed).toBeGreaterThan(0);
  });
  it('the existing seat/suspension upgrade actually attenuates high speed impact', () => {
    expect(potholeWheelImpulse(8, 0.06, 0.66)).toBeLessThan(potholeWheelImpulse(8, 0.06, 0));
    expect(cross(6, 0, 0.66).roll).toBeLessThan(cross(6, 0, 0).roll);
  });
  it('different NPC wheelbases/mass have distinct controlled amplitudes', () => {
    expect(npcPotholeResponse('motorbike', 7, 0.06)).toBeGreaterThan(npcPotholeResponse('cng', 7, 0.06));
    expect(npcPotholeResponse('cng', 7, 0.06)).toBeGreaterThan(npcPotholeResponse('truck', 7, 0.06));
    expect(npcPotholeResponse('bus', 30, 0.065)).toBeLessThan(0.075);
  });
});
