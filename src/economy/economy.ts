/**
 * Pure economy math: fares, tips, repair quotes, driver level and the derived
 * vehicle parameters produced by combining a frame + upgrades + condition.
 *
 * Kept pure (no DOM, no three.js) so unit tests exercise the real numbers.
 */

import { ECONOMY, RIDE } from '../core/config';
import { clamp, clamp01 } from '../core/mathx';
import type { VehicleDef } from './catalog';

export interface FareInput {
  /** Straight-line or route distance in metres. */
  distance: number;
  /** Seconds elapsed since passenger boarded. */
  timeTaken: number;
  /** Target seconds for the trip. */
  targetTime: number;
  /** Final passenger mood, 0..100. */
  mood: number;
  /** Collision count during the ride. */
  damage: number;
  /** Multiplier for daily challenge / special jobs. */
  fareMultiplier?: number;
  /** Bonus earned for navigating around heavy congestion cleanly. */
  trafficBonus?: number;
}

export interface FareBreakdown {
  base: number;
  distance: number;
  time: number;
  smooth: number;
  tip: number;
  traffic: number;
  damage: number;
  total: number;
  stars: 1 | 2 | 3 | 4 | 5;
  onTime: boolean;
  mood: number;
}

export function computeFare(input: FareInput): FareBreakdown {
  const mult = input.fareMultiplier ?? 1;
  const dist = Math.max(0, input.distance);
  const mood = clamp(input.mood, 0, 100);
  const base = ECONOMY.fareBase;
  const distance = Math.round(dist * ECONOMY.farePerMeter);
  const onTime = input.timeTaken <= input.targetTime * 1.05;
  const time = onTime ? ECONOMY.onTimeBonus : 0;

  const smoothRatio = clamp01((mood - 50) / 50) * (input.damage === 0 ? 1 : 0.45);
  const smooth = Math.round(ECONOMY.smoothBonusMax * smoothRatio);

  const tipRatio = clamp01((mood - 62) / 38) * (onTime ? 1 : 0.35);
  const tip = Math.round(ECONOMY.tipMax * tipRatio);

  const traffic = Math.max(0, Math.round(input.trafficBonus ?? 0));
  const damage = Math.min(base + distance, Math.round(Math.max(0, input.damage) * ECONOMY.damagePenaltyPerHit));

  const subtotal = Math.max(10, base + distance + time + smooth + tip + traffic - damage);
  const total = Math.max(0, Math.round(subtotal * mult));

  let stars: 1 | 2 | 3 | 4 | 5 = 3;
  const score = mood * 0.65 + (onTime ? 22 : 0) + (input.damage === 0 ? 13 : Math.max(0, 10 - input.damage * 4));
  if (score >= 90) stars = 5;
  else if (score >= 76) stars = 4;
  else if (score >= 56) stars = 3;
  else if (score >= 38) stars = 2;
  else stars = 1;

  return { base, distance, time, smooth, tip, traffic, damage, total, stars, onTime, mood };
}

export function repairCost(condition: number): number {
  const missing = clamp(100 - condition, 0, 100);
  if (missing < 1) return 0;
  return Math.max(10, Math.round(missing * ECONOMY.repairPerPoint));
}

export interface DriverLevel {
  level: number;
  titleKey: string;
  nextAt: number | null;
}

const LEVELS: { at: number; titleKey: string }[] = [
  { at: 0, titleKey: 'title.rookie' },
  { at: 5, titleKey: 'title.regular' },
  { at: 12, titleKey: 'title.veteran' },
  { at: 25, titleKey: 'title.legend' },
];

export function levelForRides(rides: number): DriverLevel {
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (rides >= LEVELS[i].at) idx = i;
  }
  const next = LEVELS[idx + 1]?.at ?? null;
  return { level: idx + 1, titleKey: LEVELS[idx].titleKey, nextAt: next };
}

export interface DerivedVehicle {
  isElectric: boolean;
  maxSpeed: number;
  accel: number;
  brakeDecel: number;
  steerMaxLow: number;
  steerMaxHigh: number;
  steerRateMultiplier: number;
  grip: number;
  roughSurfaceKeep: number;
  rollingDragScale: number;
  comfortBonus: number;
  damageMultiplier: number;
  batteryDrainMultiplier: number;
  regenFactor: number;
  turboDrainMultiplier: number;
  turboRechargeMultiplier: number;
  rainShield: number;
  nightBeam: number;
}

/**
 * Combine the chosen rickshaw frame, upgrade levels (0..3) and mechanical
 * condition (0..100) into concrete numbers fed to the physics step.
 *
 * Every upgrade category produces a clear, measurable gameplay difference:
 *  - bearings (Drivetrain / Motor): +top speed & +acceleration
 *  - brakes:                        +brake deceleration (shorter stopping distance)
 *  - tyres:                         +grip, less rain slip, better rough-road speed
 *  - steering (Handling):           +steer rate, tighter low-speed lock, calmer high-speed
 *  - seat (Durability/Suspension):  -collision damage, -bump/pothole penalty, +comfort
 *  - efficiency (Electric/Roll):    -battery drain, +regen braking, -rolling drag
 */
export function deriveVehicle(
  vehicle: VehicleDef,
  upgrades: Record<string, number>,
  condition: number,
  wetness = 0,
): DerivedVehicle {
  const tyres = clamp(upgrades.tyres ?? 0, 0, 3);
  const brakes = clamp(upgrades.brakes ?? 0, 0, 3);
  const bearings = clamp(upgrades.bearings ?? 0, 0, 3);
  const steering = clamp(upgrades.steering ?? 0, 0, 3);
  const seat = clamp(upgrades.seat ?? 0, 0, 3);
  const efficiency = clamp(upgrades.efficiency ?? 0, 0, 3);
  const turboCap = clamp(upgrades.turboCap ?? 0, 0, 3);
  const turboRecharge = clamp(upgrades.turboRecharge ?? 0, 0, 3);
  const canopy = clamp(upgrades.canopy ?? 0, 0, 2);
  const lights = clamp(upgrades.lights ?? 0, 0, 2);

  // Condition gently trims performance below 85% while keeping worn rickshaws brisk (~18+ km/h).
  const condFactor = 0.85 + 0.15 * clamp01(condition / 85);
  const wetGripLoss = wetness * 0.22 * (1 - tyres * 0.22);
  const isElectric = vehicle.kind === 'electric';

  const motorSpeedBoost = bearings * (isElectric ? 0.56 : 0.48);
  const effSpeedBoost = efficiency * (isElectric ? 0.16 : 0.08);
  const maxSpeed = (RIDE.maxSpeed + vehicle.topSpeedBonus + motorSpeedBoost + effSpeedBoost) * condFactor;

  const accel =
    RIDE.accel *
    vehicle.accelMultiplier *
    (1 + bearings * 0.12 + efficiency * 0.03) *
    condFactor;

  const brakeDecel =
    (RIDE.brakeDecel + (vehicle.brakeBonus ?? 0) + brakes * 0.85) *
    (1 - wetGripLoss * 0.72);

  const steerMaxLow = RIDE.maxSteerLow + steering * 0.045;
  const steerMaxHigh = RIDE.maxSteerHigh + steering * 0.015;
  const steerRateMultiplier = 1 + steering * 0.15;

  const grip = clamp(0.64 + (vehicle.gripBonus ?? 0) + tyres * 0.09 - wetGripLoss, 0.38, 0.99);
  const roughSurfaceKeep = clamp(0.84 + tyres * 0.03 + seat * 0.02, 0.8, 0.97);
  const rollingDragScale = clamp(1 - bearings * 0.05 - efficiency * 0.08, 0.62, 1);

  const comfortBonus = seat * 0.2 + canopy * 0.06;
  const damageMultiplier = clamp(1 - seat * 0.16, 0.48, 1);
  const batteryDrainMultiplier = clamp(1 - efficiency * 0.16, 0.48, 1);
  const regenFactor = isElectric ? 0.12 + efficiency * 0.11 : 0;
  const turboDrainMultiplier = clamp(1 - turboCap * 0.14, 0.54, 1);
  const turboRechargeMultiplier = 1 + turboRecharge * 0.22;

  return {
    isElectric,
    maxSpeed,
    accel,
    brakeDecel,
    steerMaxLow,
    steerMaxHigh,
    steerRateMultiplier,
    grip,
    roughSurfaceKeep,
    rollingDragScale,
    comfortBonus,
    damageMultiplier,
    batteryDrainMultiplier,
    regenFactor,
    turboDrainMultiplier,
    turboRechargeMultiplier,
    rainShield: canopy * 0.4,
    nightBeam: 1 + lights * 0.55 + (isElectric ? 0.35 : 0),
  };
}

export interface VehicleStatInfo {
  speed: number;
  accel: number;
  handling: number;
  comfort: number;
  braking: number;
  durability: number;
  efficiency: number;
}

/** Stat bars for the garage & Dokan UI (0..1), reflecting frame + upgrades. */
export function vehicleStats(vehicle: VehicleDef, upgrades: Record<string, number>): VehicleStatInfo {
  const tyres = clamp(upgrades.tyres ?? 0, 0, 3);
  const brakes = clamp(upgrades.brakes ?? 0, 0, 3);
  const bearings = clamp(upgrades.bearings ?? 0, 0, 3);
  const steering = clamp(upgrades.steering ?? 0, 0, 3);
  const seat = clamp(upgrades.seat ?? 0, 0, 3);
  const efficiency = clamp(upgrades.efficiency ?? 0, 0, 3);
  const canopy = clamp(upgrades.canopy ?? 0, 0, 2);
  const baseEff = vehicle.kind === 'electric' ? 0.72 : 0.54;
  return {
    speed: clamp01(vehicle.stats.speed + bearings * 0.075 + efficiency * 0.02),
    accel: clamp01(vehicle.stats.speed * 0.88 + (vehicle.kind === 'electric' ? 0.14 : 0) + bearings * 0.085 + efficiency * 0.025),
    handling: clamp01(vehicle.stats.handling + tyres * 0.05 + steering * 0.055),
    comfort: clamp01(vehicle.stats.comfort + seat * 0.075 + canopy * 0.04),
    braking: clamp01(vehicle.stats.braking + brakes * 0.085),
    durability: clamp01(0.55 + (vehicle.kind === 'electric' ? 0.1 : 0) + seat * 0.11 + tyres * 0.03),
    efficiency: clamp01(baseEff + efficiency * 0.09 + bearings * 0.02),
  };
}

/** Guard against double-click / negative-price / insufficient-funds bugs. */
export function canAfford(balance: number, price: number): boolean {
  if (!Number.isFinite(balance) || !Number.isFinite(price)) return false;
  if (price < 0) return false;
  return balance >= price;
}
