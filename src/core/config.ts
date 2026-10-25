/**
 * Central tuning constants for Banglar Tesla (Mohammadpur, Dhaka edition).
 * Keeping numbers in one module makes balancing, testing and profiling trivial.
 */

export type QualityPreset = 'low' | 'balanced' | 'high';

export const CAMERA_MODES = [
  'chase',
  'close',
  'wide',
  'low',
  'front',
  'cockpit',
  'side',
] as const;

export type CameraMode = (typeof CAMERA_MODES)[number];

export interface QualityConfig {
  label: string;
  pixelRatioCap: number;
  shadows: boolean;
  shadowMapSize: number;
  shadowDistance: number;
  trafficCount: number;
  pedestrianCount: number;
  pedestrians: number;
  propDensity: number;
  rainParticles: number;
  particles: 'minimal' | 'moderate' | 'rich';
  lampLights: number;
  drawDistance: number;
  viewDistance: number;
  antialias: boolean;
}

export type QualitySettings = QualityConfig;

export const QUALITY: Record<QualityPreset, QualityConfig> = {
  low: {
    label: 'Low',
    pixelRatioCap: 1.0,
    shadows: false,
    shadowMapSize: 512,
    shadowDistance: 24,
    trafficCount: 18,
    pedestrianCount: 36,
    pedestrians: 36,
    propDensity: 0.78,
    rainParticles: 160,
    particles: 'minimal',
    lampLights: 0,
    drawDistance: 175,
    viewDistance: 135,
    antialias: false,
  },
  balanced: {
    label: 'Balanced',
    pixelRatioCap: 1.35,
    shadows: true,
    shadowMapSize: 1024,
    shadowDistance: 36,
    trafficCount: 32,
    pedestrianCount: 68,
    pedestrians: 68,
    propDensity: 0.92,
    rainParticles: 340,
    particles: 'moderate',
    lampLights: 4,
    drawDistance: 235,
    viewDistance: 195,
    antialias: false,
  },
  high: {
    label: 'High',
    pixelRatioCap: 1.75,
    shadows: true,
    shadowMapSize: 1536,
    shadowDistance: 48,
    trafficCount: 46,
    pedestrianCount: 98,
    pedestrians: 98,
    propDensity: 1.0,
    rainParticles: 560,
    particles: 'rich',
    lampLights: 6,
    drawDistance: 300,
    viewDistance: 260,
    antialias: true,
  },
};

/** Base cycle-rickshaw physics parameters (modified by vehicle + upgrades). */
export const RIDE = {
  wheelbase: 1.48,
  frontAxleZ: 0.8,
  rearAxleZ: -0.68,
  rearTrackHalf: 0.49,
  frontWheelRadius: 0.37,
  rearWheelRadius: 0.386,
  /** Classic pedal rickshaw street cruising speed (~20.3 km/h). */
  maxSpeed: 5.65,
  maxReverse: 1.95,
  accel: 2.95, // m/s^2 crisp low-speed launch
  accelFalloff: 0.56, // smooth progressive pull to cruising speed
  coastDrag: 0.64, // natural slowdown when not pedalling
  rollingDrag: 0.068, // aerodynamic/rolling resistance per m/s
  brakeDecel: 5.4,
  handbrakeDecel: 6.8,
  maxSteerLow: 0.68, // rad (~39 deg) — tight pivot in narrow Mohammadpur lanes
  maxSteerHigh: 0.165, // rad (~9.5 deg) — calm >8.8m radius at cruising/boost speed
  steerRate: 4.4, // rad/s progressive response
  steerReturn: 5.8,
  lateralGrip: 9.2,
  lateralGripWet: 6.6,
  /** Tight rickshaw body width radius (eliminates oversized 0.86m air bubble). */
  bodyRadius: 0.53,
  bodyHalfWidth: 0.52,
  bodyHalfLength: 0.94,
  frontCircleZ: 0.44,
  rearCircleZ: -0.46,
  circleRadius: 0.50,
  collisionBounce: 0.18,
  conditionLossPerHit: 2.8, // % per m/s of genuine impact above threshold
  reverseHold: 0.28, // s of holding brake at standstill before reversing
} as const;

/** Hold-to-boost extreme arcade Turbo (`টার্বো`) tuning (separate from `টান`). */
export const TURBO = {
  speedMultiplier: 3.0, // ~61 km/h on classic rickshaw
  maxSpeedCap: 18.0, // ~64.8 km/h hard safety cap
  accelMultiplier: 2.4,
  drainPerSec: 25.0,
  autoRechargeMoving: 4.4,
  autoRechargeIdle: 1.8,
  minActivateCharge: 8.0,
  nearMissGain: 9.0,
  cleanDrivingPerSec: 2.6,
  checkpointGain: 12.0,
  escapeGain: 28.0,
} as const;

export const MISSION = {
  acceptRadius: 5.8,
  dropRadius: 6.2,
  pickupStopSpeed: 0.95,
  dropStopSpeed: 1.05,
  moodStart: 88,
  moodCollisionHit: 9,
  moodHardBrake: 2.4,
  moodPotholeHit: 1.8,
  moodSmoothGainPerSecond: 0.45,
} as const;

export const ECONOMY = {
  startingTaka: 500,
  fareBase: 30,
  farePerMeter: 0.22,
  onTimeBonus: 20,
  smoothBonusMax: 25,
  tipMax: 30,
  damagePenaltyPerHit: 8,
  repairPerPoint: 2.2,
  trafficBonusMax: 22,
} as const;

export const WORLD = {
  /** Playable Mohammadpur district half-extent in metres around Town Hall / Asad Ave. */
  halfExtent: 265,
  groundExtent: 640,
  /** Starting rickshaw stand at Mohammadpur Bus Stand (Asad Avenue west junction). */
  playerSpawn: { x: -124, z: 108, yaw: 0.98 },
} as const;

export type DayPhase = 'morning' | 'noon' | 'golden' | 'blue' | 'night';
export type WeatherKind = 'clear' | 'overcast' | 'rain';
