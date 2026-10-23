/**
 * Pure economy + vehicle-stat math. No DOM, no three.js — unit tested.
 */

import { ECONOMY, RIDE } from '../core/config';
import { clamp, clamp01 } from '../core/mathx';
import { UPGRADES, type VehicleDef } from './catalog';

export interface FareInput {
  distance: number;
  timeTaken: number;
  targetTime: number;
  mood: number;
  damage: number;
  fareMultiplier?: number;
}

export interface FareBreakdown {
  base: number;
  distance: number;
  time: number;
  smooth: number;
  tip: number;
  damage: number;
  total: number;
  mood: number;
  onTime: boolean;
  stars: number;
}

/**
 * Transparent payout: base + distance + on-time + smoothness + tip - damage.
 * Total can never go below zero.
 */
export function computeFare(input: FareInput): FareBreakdown {
  const mood = clamp(input.mood, 0, 100);
  const multiplier = input.fareMultiplier ?? 1;
  const base = ECONOMY.fareBase;
  const distance = Math.round(Math.max(0, input.distance) * ECONOMY.farePerMeter);
  const onTime = input.timeTaken <= input.targetTime;
  const time = onTime ? ECONOMY.onTimeBonus : -Math.round(Math.max(0, input.timeTaken - input.targetTime) * 0.5);
  const smooth = input.damage <= 0 && mood >= 70 ? ECONOMY.smoothBonus : 0;
  const tip = mood >= 90 ? ECONOMY.perfectTip : mood >= 78 ? Math.round(ECONOMY.perfectTip * 0.5) : 0;
  const damage = Math.round(input.damage * 9);
  const raw = (base + distance + time + smooth + tip) * multiplier - damage;
  const total = Math.max(0, Math.round(raw));
  const stars = mood >= 92 ? 5 : mood >= 82 ? 4 : mood >= 68 ? 3 : mood >= 48 ? 2 : 1;
  return { base, distance, time, smooth, tip, damage, total, mood, onTime, stars };
}

export interface DerivedVehicle {
  maxSpeed: number;
  accel: number;
  brakeDecel: number;
  steerMaxLow: number;
  steerMaxHigh: number;
  grip: number;
  comfort: number;
  rainProtection: number;
  nightLight: number;
  conditionFactor: number;
}

export interface VehicleStatInfo {
  speed: number;
  handling: number;
  comfort: number;
  braking: number;
}

/** Vehicle base stats + purchased upgrade levels → 0..1 stat bars. */
export function vehicleStats(vehicle: VehicleDef, upgrades: Record<string, number>): VehicleStatInfo {
  const lvl = (id: string): number => clamp(upgrades[id] ?? 0, 0, 3);
  const def = (id: string): number => UPGRADES.find((u) => u.id === id)?.perLevel ?? 0;
  return {
    speed: clamp01(vehicle.stats.speed + def('bearings') * lvl('bearings')),
    handling: clamp01(vehicle.stats.handling + def('steering') * lvl('steering')),
    comfort: clamp01(vehicle.stats.comfort + def('seat') * lvl('seat')),
    braking: clamp01(vehicle.stats.braking + def('brakes') * lvl('brakes')),
  };
}

export function deriveVehicle(
  vehicle: VehicleDef,
  upgrades: Record<string, number>,
  condition: number,
  wetness = 0,
): DerivedVehicle {
  const stats = vehicleStats(vehicle, upgrades);
  const tyreLevel = clamp(upgrades.tyres ?? 0, 0, 3);
  const conditionFactor = 0.8 + 0.2 * clamp01(condition / 100);
  const baseGrip = 0.62 + 0.09 * tyreLevel;
  const grip = clamp01(baseGrip * (1 - wetness * (0.3 - tyreLevel * 0.06)));
  return {
    maxSpeed: RIDE.maxSpeed * (0.86 + 0.34 * stats.speed) * conditionFactor,
    accel: RIDE.accel * (0.84 + 0.42 * stats.speed) * conditionFactor,
    brakeDecel: RIDE.brakeDecel * (0.82 + 0.44 * stats.braking),
    steerMaxLow: RIDE.maxSteerLow * (0.9 + 0.18 * stats.handling),
    steerMaxHigh: RIDE.maxSteerHigh * (0.85 + 0.35 * stats.handling) * (0.86 + 0.14 * grip),
    grip,
    comfort: stats.comfort,
    rainProtection: clamp01((upgrades.canopy ?? 0) * 0.18),
    nightLight: clamp01(0.25 + (upgrades.lights ?? 0) * 0.2),
    conditionFactor,
  };
}

/** Cost to restore condition to 100 (rounded up to the nearest taka). */
export function repairCost(condition: number): number {
  const missing = clamp(100 - condition, 0, 100);
  if (missing < 0.5) return 0;
  return Math.ceil(missing * ECONOMY.repairCostPerPoint);
}

export function conditionAfterKm(condition: number, km: number): number {
  return clamp(condition - km * ECONOMY.conditionDropPerKm, 12, 100);
}

export interface LevelInfo {
  level: number;
  titleKey: string;
  ridesForNext: number;
}

export function levelForRides(rides: number): LevelInfo {
  if (rides >= 24) return { level: 4, titleKey: 'title.legend', ridesForNext: 0 };
  if (rides >= 12) return { level: 3, titleKey: 'title.veteran', ridesForNext: 24 - rides };
  if (rides >= 5) return { level: 2, titleKey: 'title.regular', ridesForNext: 12 - rides };
  return { level: 1, titleKey: 'title.rookie', ridesForNext: 5 - rides };
}

/** Guard used by every purchase path so balance can never go negative. */
export function canAfford(balance: number, price: number): boolean {
  return Number.isFinite(balance) && Number.isFinite(price) && balance >= price && price >= 0;
}
