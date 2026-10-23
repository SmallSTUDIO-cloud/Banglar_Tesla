/**
 * Central tuning + quality configuration. Everything a designer would want to
 * tweak for feel or performance lives here instead of being scattered.
 */

export type QualityPreset = 'low' | 'balanced' | 'high';

export interface QualitySettings {
  labelKey: string;
  pixelRatioCap: number;
  renderScale: number;
  shadows: boolean;
  shadowMapSize: number;
  shadowDistance: number;
  traffic: number;
  pedestrians: number;
  rainParticles: number;
  reflections: boolean;
  bloomish: boolean;
  viewDistance: number;
  particles: 'minimal' | 'moderate' | 'full';
}

export const QUALITY: Record<QualityPreset, QualitySettings> = {
  low: {
    labelKey: 'quality.low',
    pixelRatioCap: 1.25,
    renderScale: 0.78,
    shadows: false,
    shadowMapSize: 512,
    shadowDistance: 24,
    traffic: 6,
    pedestrians: 8,
    rainParticles: 220,
    reflections: false,
    bloomish: false,
    viewDistance: 120,
    particles: 'minimal',
  },
  balanced: {
    labelKey: 'quality.balanced',
    pixelRatioCap: 2.0,
    renderScale: 1.0,
    shadows: true,
    shadowMapSize: 1024,
    shadowDistance: 38,
    traffic: 10,
    pedestrians: 16,
    rainParticles: 520,
    reflections: true,
    bloomish: false,
    viewDistance: 170,
    particles: 'moderate',
  },
  high: {
    labelKey: 'quality.high',
    pixelRatioCap: 2.6,
    renderScale: 1.0,
    shadows: true,
    shadowMapSize: 2048,
    shadowDistance: 56,
    traffic: 16,
    pedestrians: 26,
    rainParticles: 900,
    reflections: true,
    bloomish: true,
    viewDistance: 230,
    particles: 'full',
  },
};

/** Vehicle handling tune — a light, weighty three-wheeler, not a sports car. */
export const RIDE = {
  maxSpeed: 7.6, // m/s ≈ 27 km/h on flat ground
  maxReverse: 1.9,
  accel: 2.05,
  accelFalloff: 0.62, // acceleration tapers as speed approaches max
  brakeDecel: 5.0,
  coastDrag: 0.62,
  rollingDrag: 0.05,
  wheelbase: 1.62,
  maxSteerLow: 0.55, // radians at standstill
  maxSteerHigh: 0.17, // radians at max speed
  steerRate: 5.4,
  steerReturn: 6.8,
  reverseHold: 0.42, // seconds brake must be held at standstill before reversing
  bodyRadius: 0.92,
  halfLength: 1.35,
  halfWidth: 0.82,
  jumpEpsilon: 0.12,
  collisionBounce: 0.34,
  conditionLossPerHit: 2.4,
  curbPenalty: 0.55,
};

export const CAMERA = {
  distance: 5.9,
  height: 2.55,
  lookHeight: 1.15,
  lookAhead: 3.4,
  followRate: 6.5,
  yawRate: 3.4,
  fov: 58,
  closeDistance: 4.5,
  closeHeight: 2.1,
  cinematicDistance: 9.5,
  cinematicHeight: 3.6,
};

export const ECONOMY = {
  startingBalance: 500,
  fareBase: 28,
  farePerMeter: 0.09,
  farePerMinuteLate: 4,
  onTimeBonus: 22,
  smoothBonus: 18,
  comfortBonus: 14,
  perfectTip: 12,
  conditionDropPerKm: 0.55,
  repairCostPerPoint: 4.2,
  recoveryFee: 45,
  freeRecoveryInFreeRide: true,
};

export const MISSION = {
  acceptRadius: 6.5,
  pickupStopSpeed: 1.1,
  dropStopSpeed: 1.1,
  dropRadius: 7.5,
  maxJobsInQueue: 3,
  moodStart: 100,
  moodCollisionHit: 9,
  moodHardBrake: 2.5,
  moodRecklessSpeed: 4.5,
  moodSmoothGainPerSecond: 0.55,
};

export const WORLD = {
  /** Half-size of the playable neighbourhood in metres. */
  halfSize: 118,
  groundSize: 300,
  buildingGrid: 4,
  sidewalkHeight: 0.14,
  roadWidthMain: 9.2,
  roadWidthCross: 7.4,
  laneOffset: 2.15,
  playerSpawn: { x: -1.2, z: 47, yaw: Math.PI },
};

export const DAY_PHASES = ['morning', 'noon', 'golden', 'blue', 'night'] as const;
export type DayPhase = (typeof DAY_PHASES)[number];

export const WEATHER_KINDS = ['clear', 'overcast', 'rain'] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];

export const MAX_SAVE_BYTES = 48 * 1024;
