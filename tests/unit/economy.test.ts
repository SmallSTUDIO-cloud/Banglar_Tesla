import { describe, it, expect } from 'vitest';
import { computeFare, repairCost, levelForRides, deriveVehicle, canAfford, vehicleStats } from '../../src/economy/economy';
import { VEHICLES, vehicleById } from '../../src/economy/catalog';
import { ECONOMY } from '../../src/core/config';

describe('fare math', () => {
  it('pays base + distance for a short trip', () => {
    const fare = computeFare({ distance: 200, timeTaken: 40, targetTime: 90, mood: 60, damage: 0 });
    expect(fare.base).toBe(ECONOMY.fareBase);
    expect(fare.distance).toBe(Math.round(200 * ECONOMY.farePerMeter));
    expect(fare.onTime).toBe(true);
    expect(fare.time).toBe(ECONOMY.onTimeBonus);
    expect(fare.total).toBeGreaterThan(fare.base);
  });

  it('never returns a negative total', () => {
    const fare = computeFare({ distance: 0, timeTaken: 900, targetTime: 10, mood: 0, damage: 400 });
    expect(fare.total).toBeGreaterThanOrEqual(0);
  });

  it('penalises late delivery and rewards happiness', () => {
    const onTime = computeFare({ distance: 300, timeTaken: 60, targetTime: 120, mood: 100, damage: 0 });
    const late = computeFare({ distance: 300, timeTaken: 240, targetTime: 120, mood: 40, damage: 0 });
    expect(onTime.total).toBeGreaterThan(late.total);
    expect(onTime.tip).toBeGreaterThan(0);
    expect(late.tip).toBe(0);
    expect(onTime.stars).toBe(5);
    expect(late.stars).toBeLessThan(3);
  });

  it('applies the daily multiplier and damage deduction', () => {
    const base = computeFare({ distance: 200, timeTaken: 40, targetTime: 90, mood: 85, damage: 0 });
    const daily = computeFare({ distance: 200, timeTaken: 40, targetTime: 90, mood: 85, damage: 0, fareMultiplier: 1.35 });
    expect(daily.total).toBeGreaterThan(base.total);
    const damaged = computeFare({ distance: 200, timeTaken: 40, targetTime: 90, mood: 85, damage: 3 });
    expect(damaged.damage).toBeGreaterThan(0);
    expect(damaged.total).toBeLessThan(base.total);
  });

  it('is deterministic for identical input', () => {
    const a = computeFare({ distance: 123, timeTaken: 45, targetTime: 80, mood: 77, damage: 1 });
    const b = computeFare({ distance: 123, timeTaken: 45, targetTime: 80, mood: 77, damage: 1 });
    expect(a).toEqual(b);
  });
});

describe('economy guards', () => {
  it('repair cost scales with damage and is zero at full condition', () => {
    expect(repairCost(100)).toBe(0);
    expect(repairCost(90)).toBeGreaterThan(0);
    expect(repairCost(50)).toBeGreaterThan(repairCost(90));
  });

  it('canAfford rejects negative balances and prices', () => {
    expect(canAfford(100, 100)).toBe(true);
    expect(canAfford(99, 100)).toBe(false);
    expect(canAfford(100, -5)).toBe(false);
    expect(canAfford(Number.NaN, 10)).toBe(false);
  });

  it('levels follow the ride ladder', () => {
    expect(levelForRides(0).level).toBe(1);
    expect(levelForRides(5).level).toBe(2);
    expect(levelForRides(12).level).toBe(3);
    expect(levelForRides(99).level).toBe(4);
  });
});

describe('vehicle stats', () => {
  it('upgrades raise the derived stats but never above 1', () => {
    const v = vehicleById('classic');
    const base = vehicleStats(v, {});
    const upgraded = vehicleStats(v, { bearings: 3, steering: 3, seat: 3, brakes: 3 });
    expect(upgraded.speed).toBeGreaterThan(base.speed);
    expect(upgraded.handling).toBeGreaterThan(base.handling);
    expect(upgraded.comfort).toBeGreaterThan(base.comfort);
    expect(upgraded.braking).toBeGreaterThan(base.braking);
    for (const key of ['speed', 'handling', 'comfort', 'braking'] as const) {
      expect(upgraded[key]).toBeLessThanOrEqual(1);
    }
  });

  it('a damaged rickshaw is slower but still drivable', () => {
    const v = vehicleById('classic');
    const good = deriveVehicle(v, {}, 100);
    const bad = deriveVehicle(v, {}, 20);
    expect(bad.maxSpeed).toBeLessThan(good.maxSpeed);
    expect(bad.maxSpeed).toBeGreaterThan(0.5 * good.maxSpeed);
  });

  it('wet roads reduce grip, tyres recover some of it', () => {
    const v = vehicleById('classic');
    const dry = deriveVehicle(v, {}, 100, 0);
    const wet = deriveVehicle(v, {}, 100, 1);
    const wetTyres = deriveVehicle(v, { tyres: 3 }, 100, 1);
    expect(wet.grip).toBeLessThan(dry.grip);
    expect(wetTyres.grip).toBeGreaterThan(wet.grip);
  });

  it('every vehicle is well-formed', () => {
    for (const v of VEHICLES) {
      expect(v.id.length).toBeGreaterThan(0);
      expect(v.price).toBeGreaterThanOrEqual(0);
      expect(v.palette.body).toMatch(/^#[0-9a-f]{6}$/i);
      for (const key of ['speed', 'handling', 'comfort', 'braking'] as const) {
        expect(v.stats[key]).toBeGreaterThan(0);
        expect(v.stats[key]).toBeLessThanOrEqual(1);
      }
    }
  });
});
