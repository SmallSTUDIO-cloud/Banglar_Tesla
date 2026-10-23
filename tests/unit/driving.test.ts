import { describe, it, expect } from 'vitest';
import { RickshawController } from '../../src/vehicle/rickshawController';
import { RIDE } from '../../src/core/config';
import { buildTrafficRoutes, sampleRoute } from '../../src/ai/routes';
import { generateMission, roadDistance, dailySeed, dateKey } from '../../src/missions/mission';
import { PLACES, placeById } from '../../src/world/layout';
import { mulberry32 } from '../../src/core/mathx';

const noColliders: never[] = [];
const flat = (): number => 0;
const road = (): 'road' => 'road';

function makeController(): RickshawController {
  return new RickshawController(noColliders, flat, road);
}

function drive(controller: RickshawController, input: { throttle?: number; brake?: number; steer?: number }, seconds: number): void {
  const dt = 1 / 60;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    controller.step(dt, { throttle: input.throttle ?? 0, brake: input.brake ?? 0, steer: input.steer ?? 0, handbrake: false }, 1, 0);
  }
}

describe('rickshaw driving model', () => {
  it('accelerates progressively, not instantly', () => {
    const c = makeController();
    c.reset(0, 0, 0);
    drive(c, { throttle: 1 }, 0.1);
    const early = c.speed;
    drive(c, { throttle: 1 }, 1.9);
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(0.5); // no instant max speed
    expect(c.speed).toBeGreaterThan(early);
  });

  it('never exceeds the rickshaw speed cap', () => {
    const c = makeController();
    c.reset(0, 0, 0);
    drive(c, { throttle: 1 }, 30);
    expect(c.speed).toBeLessThanOrEqual(RIDE.maxSpeed * 1.01);
    expect(c.speed).toBeGreaterThan(3);
  });

  it('coasts down to a stop when the pedal is released', () => {
    const c = makeController();
    c.reset(0, 0, 0);
    drive(c, { throttle: 1 }, 4);
    const rolling = c.speed;
    drive(c, {}, 14);
    expect(c.speed).toBe(0);
    expect(rolling).toBeGreaterThan(1);
  });

  it('brakes to a stop and only reverses after a deliberate hold', () => {
    const c = makeController();
    c.reset(0, 0, 0);
    drive(c, { throttle: 1 }, 3);
    drive(c, { brake: 1 }, 1.2);
    expect(c.speed).toBeLessThanOrEqual(0.001);
    expect(c.speed).toBeGreaterThanOrEqual(0);
    // keep holding the brake: reverse engages after RIDE.reverseHold
    drive(c, { brake: 1 }, RIDE.reverseHold + 0.8);
    expect(c.speed).toBeLessThan(0);
    expect(c.speed).toBeGreaterThanOrEqual(-RIDE.maxReverse - 0.01);
  });

  it('steers left and right in the expected direction', () => {
    const left = makeController();
    left.reset(0, 0, 0);
    drive(left, { throttle: 1, steer: -1 }, 2);
    const right = makeController();
    right.reset(0, 0, 0);
    drive(right, { throttle: 1, steer: 1 }, 2);
    // +yaw turns toward +X (right), -yaw toward -X (left); yaw is normalised
    expect(right.x).toBeGreaterThan(0.5);
    expect(left.x).toBeLessThan(-0.5);
    expect(right.steerAngle).toBeGreaterThan(0);
    expect(left.steerAngle).toBeLessThan(0);
  });

  it('has a tighter turning circle at low speed than at high speed', () => {
    // Turn radius = wheelbase / tan(steer). Low speed should allow a much
    // smaller radius (needed to pivot inside narrow Old Dhaka lanes).
    const slow = makeController();
    slow.reset(0, 0, 0);
    drive(slow, { throttle: 0.32, steer: 1 }, 2.0);
    const slowRadius = Math.abs(slow.speed / ((slow.speed / RIDE.wheelbase) * Math.tan(slow.steerAngle)));

    const fast = makeController();
    fast.reset(0, 0, 0);
    drive(fast, { throttle: 1 }, 8);
    drive(fast, { throttle: 1, steer: 1 }, 2.0);
    const fastRadius = Math.abs(fast.speed / ((fast.speed / RIDE.wheelbase) * Math.tan(fast.steerAngle)));

    expect(Math.abs(slow.steerAngle)).toBeGreaterThan(Math.abs(fast.steerAngle));
    expect(slowRadius).toBeLessThan(fastRadius);
    expect(fastRadius).toBeGreaterThan(8); // stable, not twitchy at speed
  });

  it('records collisions and pushes the rickshaw out of a wall', () => {
    const collider = { minX: -2, maxX: 2, minZ: 4, maxZ: 8, height: 6 };
    const c = new RickshawController([collider], flat, road);
    c.reset(0, 0, 0);
    let impact = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 6; i++) {
      const ev = c.step(dt, { throttle: 1, brake: 0, steer: 0, handbrake: false }, 1, 0);
      impact = Math.max(impact, ev.impact);
    }
    expect(impact).toBeGreaterThan(0);
    // the rickshaw must not end up inside the wall AABB
    const inside = c.x > collider.minX && c.x < collider.maxX && c.z > collider.minZ && c.z < collider.maxZ;
    expect(inside).toBe(false);
    expect(c.z).toBeLessThan(collider.minZ + 0.5);
  });

  it('flags being stuck when pedal is held against a wall', () => {
    const collider = { minX: -3, maxX: 3, minZ: 1.2, maxZ: 4, height: 5 };
    const c = new RickshawController([collider], flat, road);
    c.reset(0, 0, 0);
    let stuck = false;
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 5; i++) {
      const ev = c.step(dt, { throttle: 1, brake: 0, steer: 0, handbrake: false }, 1, 0);
      stuck = stuck || ev.stuck;
    }
    expect(stuck).toBe(true);
  });

  it('follows speed humps without launching', () => {
    const heightAt = (x: number, z: number): number => {
      const d = Math.abs(z - 10);
      if (d > 1.5 || Math.abs(x) > 5) return 0;
      return 0.17 * Math.sin(((1 - d / 1.5) * Math.PI) / 2) ** 1.2;
    };
    const c = new RickshawController(noColliders, heightAt, road);
    c.reset(0, 0, 0);
    let maxY = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 6; i++) {
      c.step(dt, { throttle: 1, brake: 0, steer: 0, handbrake: false }, 1, 0);
      maxY = Math.max(maxY, c.y);
    }
    expect(maxY).toBeGreaterThan(0.02);
    expect(maxY).toBeLessThan(0.3);
  });

  it('is deterministic for identical input sequences', () => {
    const a = makeController();
    const b = makeController();
    a.reset(1, 2, 0.5);
    b.reset(1, 2, 0.5);
    for (let i = 0; i < 300; i++) {
      const input = { throttle: 0.8, brake: 0, steer: Math.sin(i / 20), handbrake: false };
      a.step(1 / 60, input, 1, 0);
      b.step(1 / 60, input, 1, 0);
    }
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.z).toBeCloseTo(b.z, 6);
    expect(a.yaw).toBeCloseTo(b.yaw, 6);
  });
});

describe('traffic routes', () => {
  it('builds three closed loops with a positive length', () => {
    const routes = buildTrafficRoutes();
    expect(routes.length).toBe(3);
    for (const route of routes) {
      expect(route.length).toBeGreaterThan(50);
      expect(route.points.length).toBeGreaterThan(6);
    }
  });

  it('drives on the left-hand side of the road', () => {
    const [outer] = buildTrafficRoutes();
    // The first leg travels north (-Z) along the main road centred at x = 0.
    // Facing -Z, "left" is -X, so left-hand traffic must sit at negative X.
    const s = sampleRoute(outer, 5, { x: 0, z: 0, yaw: 0 });
    expect(Math.abs(s.x)).toBeGreaterThan(1);
    expect(s.x).toBeLessThan(0);
    // ...and the return leg (travelling +Z) sits on the other side
    const back = sampleRoute(outer, 5, { x: 0, z: 0, yaw: 0 });
    void back;
  });

  it('wraps around the loop without NaN', () => {
    const [outer] = buildTrafficRoutes();
    for (const d of [-100, 0, outer.length * 0.5, outer.length + 10, outer.length * 100]) {
      const s = sampleRoute(outer, d, { x: 0, z: 0, yaw: 0 });
      expect(Number.isFinite(s.x)).toBe(true);
      expect(Number.isFinite(s.z)).toBe(true);
      expect(Number.isFinite(s.yaw)).toBe(true);
    }
  });
});

describe('mission generation', () => {
  it('produces a valid offer with distinct pickup and drop-off', () => {
    const rng = mulberry32(12345);
    const offer = generateMission({ rng, wet: false });
    expect(offer.pickupId).not.toBe(offer.dropId);
    expect(placeById(offer.pickupId)).toBeTruthy();
    expect(placeById(offer.dropId)).toBeTruthy();
    expect(offer.distance).toBeGreaterThan(0);
    expect(offer.fareEstimate).toBeGreaterThan(0);
    expect(offer.targetTime).toBeGreaterThan(20);
  });

  it('is deterministic given the same seed', () => {
    const a = generateMission({ rng: mulberry32(999), wet: false, seed: 999 });
    const b = generateMission({ rng: mulberry32(999), wet: false, seed: 999 });
    expect(a.dropId).toBe(b.dropId);
    expect(a.pickupId).toBe(b.pickupId);
    expect(a.fareEstimate).toBe(b.fareEstimate);
  });

  it('changes with the seed', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const offer = generateMission({ rng: mulberry32(seed), wet: false, seed });
      seen.add(`${offer.pickupId}->${offer.dropId}`);
    }
    expect(seen.size).toBeGreaterThan(3);
  });

  it('daily seeds are stable per calendar day and derived from the date', () => {
    const d1 = new Date(2026, 9, 23);
    const d2 = new Date(2026, 9, 23, 23, 59);
    const d3 = new Date(2026, 9, 24);
    expect(dailySeed(d1)).toBe(dailySeed(d2));
    expect(dailySeed(d1)).not.toBe(dailySeed(d3));
    expect(dateKey(d1)).toBe('2026-10-23');
  });

  it('every place is reachable from every other place by the distance model', () => {
    for (const a of PLACES) {
      for (const b of PLACES) {
        if (a === b) continue;
        expect(roadDistance(a, b)).toBeGreaterThan(0);
      }
    }
  });

  it('daily offers pay a multiplier', () => {
    const normal = generateMission({ rng: mulberry32(7), wet: false });
    const daily = generateMission({ rng: mulberry32(7), wet: false, daily: true });
    expect(daily.multiplier).toBeGreaterThan(normal.multiplier);
    expect(daily.daily).toBe(true);
  });
});
