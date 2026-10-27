import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { RickshawController } from '../../src/vehicle/rickshawController';
import type { Collider } from '../../src/world/city';
import { deriveVehicle } from '../../src/economy/economy';
import { VEHICLES } from '../../src/economy/catalog';
import { SaveStore, SAVE_KEY, sanitizeProgress } from '../../src/core/save';
import { SettingsStore } from '../../src/core/settings';
import { Bucket } from '../../src/world/geo';
import { DestructionSystem, type BreakableProp } from '../../src/world/destruction';
import { BanglaSpeechService } from '../../src/audio/speech';
import {
  ROADRAGE_DRIVER_LINE,
  ROADRAGE_ESCAPED_TEXT,
  ROADRAGE_PLAYER_LINE,
  RoadRageSystem,
} from '../../src/ai/roadRage';
import type { AudioEngine } from '../../src/audio/audio';
import type { TrafficSystem } from '../../src/ai/traffic';

function memStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

function stepController(
  c: RickshawController,
  throttle: number,
  seconds: number,
  brake = 0,
): void {
  const dt = 1 / 60;
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    c.step(dt, { throttle, brake, steer: 0, handbrake: false }, 1, 0);
  }
}

describe('Master Upgrade v2 — Save, Settings & Wet Braking', () => {
  it('migrates legacy saves without stamina to stamina = 100 and clamps invalid values', () => {
    const legacy = memStorage({
      [SAVE_KEY]: JSON.stringify({ version: 2, balance: 750, rides: 4 }),
    });
    const loaded = new SaveStore(legacy).load().progress;
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBeGreaterThanOrEqual(2);
    expect(loaded!.balance).toBe(750);
    expect(loaded!.stamina).toBe(100);

    expect(sanitizeProgress({ version: 2, stamina: 245 }).stamina).toBe(100);
    expect(sanitizeProgress({ version: 2, stamina: -30 }).stamina).toBe(0);
  });

  it('fills new audio settings defaults cleanly from pre-v0.4 settings storage', () => {
    const store = memStorage({
      'banglar-tesla.settings.v1': JSON.stringify({ language: 'bn', music: 0.5, muted: true }),
    });
    const sm = new SettingsStore(store);
    const s = sm.get();
    expect(s.master).toBe(0.85);
    expect(s.music).toBe(0.5);
    expect(s.sfx).toBe(0.8);
    expect(s.musicEnabled).toBe(true);
    expect(s.sfxEnabled).toBe(true);
    expect(s.reduceNoisyAmbience).toBe(false);
    expect(s.muted).toBe(true);
  });

  it('applies subtle wet-road traction and braking reduction during monsoon rain', () => {
    const classic = VEHICLES[0];
    const dry = deriveVehicle(classic, {}, 100, 0);
    const wet = deriveVehicle(classic, {}, 100, 1);
    expect(wet.grip).toBeLessThan(dry.grip);
    expect(wet.brakeDecel).toBeLessThan(dry.brakeDecel);
    expect(wet.brakeDecel).toBeGreaterThan(dry.brakeDecel * 0.75);
  });
});

describe('Master Upgrade v2 — টান Speed Boost, Pedal Stamina & Electric Battery', () => {
  it('boosts classic pedal rickshaw ~1.95x, drains stamina to 0, auto-stops, and regenerates', () => {
    const baseC = new RickshawController([], () => 0, () => 'road');
    baseC.reset(0, 0, 0);
    stepController(baseC, 1, 10);
    const normalTopSpeed = baseC.speed;

    let autoStopReason: string | null = null;
    const boostC = new RickshawController([], () => 0, () => 'road');
    boostC.onTanAutoStop = (reason) => {
      autoStopReason = reason;
    };
    boostC.reset(0, 0, 0);
    expect(boostC.setTanActive(true)).toBe(true);
    stepController(boostC, 1, 4.5);
    const boostPeak = boostC.speed;

    expect(boostPeak).toBeGreaterThan(normalTopSpeed * 1.88);
    expect(boostPeak).toBeLessThan(normalTopSpeed * 2.02);
    expect(boostC.stamina).toBeLessThan(55);

    // Continue pedaling until stamina reaches 0 -> auto-stops cleanly (and starts gentle regen)
    stepController(boostC, 1, 5.0);
    expect(boostC.stamina).toBeLessThan(12);
    expect(boostC.tanActive).toBe(false);
    expect(autoStopReason).toBe('stamina');

    // Cannot re-enable immediately below 12 stamina recovery threshold
    expect(boostC.setTanActive(true)).toBe(false);

    // Regenerates when টান is off
    stepController(boostC, 0, 4.0);
    expect(boostC.stamina).toBeGreaterThan(25);
    expect(boostC.setTanActive(true)).toBe(true);
  });

  it('boosts electric rickshaw without using pedal stamina while draining battery faster', () => {
    const tuning = {
      maxSpeed: 8.8,
      accel: 4.5,
      brakeDecel: 8.5,
      steerMaxLow: 0.6,
      steerMaxHigh: 0.25,
      steerRateMultiplier: 1,
      grip: 7.5,
      roughSurfaceKeep: 0.85,
      rollingDragScale: 1,
      isElectric: true,
      batteryDrainMultiplier: 1,
      regenFactor: 0.25,
    };

    const normalE = new RickshawController([], () => 0, () => 'road');
    normalE.setTuning(tuning);
    normalE.reset(0, 0, 0);
    stepController(normalE, 1, 6.0);

    const tanE = new RickshawController([], () => 0, () => 'road');
    tanE.setTuning(tuning);
    tanE.reset(0, 0, 0);
    expect(tanE.setTanActive(true)).toBe(true);
    stepController(tanE, 1, 6.0);

    expect(tanE.speed).toBeGreaterThan(normalE.speed * 1.88);
    expect(tanE.stamina).toBe(100);
    const normalUsed = 100 - normalE.battery;
    const tanUsed = 100 - tanE.battery;
    expect(tanUsed).toBeGreaterThan(normalUsed * 2.5);
  });
});

describe('Master Upgrade v2 — Breakable Street Lamps & Roadside Stalls', () => {
  it('ignores gentle bumps, smashes once above speed threshold, disables collider, and pools debris cleanly', () => {
    const bucket = new Bucket('test-lamp', new THREE.MeshStandardMaterial());
    bucket.setTag(1);
    bucket.add(new THREE.BoxGeometry(1, 1, 1), { x: 10, y: 2, z: 10 }, { x: 0.2, y: 4.0, z: 0.2 }, 0x888888);
    bucket.setTag(-1);

    const mesh = bucket.build()!;
    expect(mesh).toBeTruthy();
    const tagged = bucket.getTagSlices().get(1) ?? [];
    expect(tagged.length).toBeGreaterThan(0);

    const col: Collider = {
      minX: 9.8,
      maxX: 10.2,
      minZ: 9.8,
      maxZ: 10.2,
      height: 4.0,
      cameraBlocking: false,
      kind: 'prop',
      breakableId: 1,
    };
    const lampVec = new THREE.Vector3(10, 4.2, 10);
    const prop: BreakableProp = {
      id: 1,
      kind: 'lamp',
      x: 10,
      z: 10,
      yaw: 0,
      collider: col,
      slices: tagged,
      lampIndex: 0,
      broken: false,
    };

    const sys = new DestructionSystem(() => 0);
    sys.registerProps([prop], [lampVec]);
    expect(sys.totalRegistered).toBe(1);

    // Gentle tap (< 3.1 m/s) should NOT break the prop
    expect(sys.tryBreak(1, 1.5, 10, 8, 0)).toBe(false);
    expect(prop.broken).toBe(false);
    expect(col.disabled).toBeFalsy();

    // High-impact smash (>= 3.1 m/s) breaks once, disables collider, culls lamp light, spawns pooled debris
    expect(sys.tryBreak(1, 6.4, 10, 8, 0)).toBe(true);
    sys.update(1 / 60);
    expect(prop.broken).toBe(true);
    expect(col.disabled).toBe(true);
    expect(lampVec.y).toBeLessThan(-500);
    expect(sys.brokenCount).toBe(1);
    expect(sys.activePieceCount).toBeGreaterThan(0);

    // Cannot break a second time
    expect(sys.tryBreak(1, 8.0, 10, 8, 0)).toBe(false);
    expect(sys.brokenCount).toBe(1);

    // Pooled debris & puffs settle and despawn back to 0 active pieces
    for (let i = 0; i < 180; i++) sys.update(1 / 60);
    expect(sys.activePieceCount).toBe(0);
  });
});

describe('Master Upgrade v2 — Bangla Speech & Road-Rage Encounter System', () => {
  it('uses exact Bangla Unicode dialogue lines and selects Android bn TTS or bundled fallback cleanly', () => {
    expect(ROADRAGE_DRIVER_LINE).toBe('ওই হারামজাদা, দাঁড়া!');
    expect(ROADRAGE_PLAYER_LINE).toBe('মাফ করে দেন ভাই, ভুলে লেগে গেছে!');
    expect(ROADRAGE_ESCAPED_TEXT).toBe('পালাতে পেরেছেন!');

    let ducked = false;
    let fallbackClips = 0;
    const fakeAudio = {
      setDialogueDuck: (a: boolean) => {
        ducked = a;
      },
      playDialogueClip: (_who: 'driver' | 'player', onEnded?: () => void) => {
        fallbackClips++;
        onEnded?.();
        return true;
      },
      stopDialogueClip: () => undefined,
    } as unknown as AudioEngine;

    const g = globalThis as unknown as {
      window?: Record<string, unknown>;
    };
    const prevWin = g.window;

    const spokenNative: string[] = [];
    g.window = {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      __btAndroidTts: {
        isBengaliAvailable: () => true,
        speak: (txt: string) => {
          spokenNative.push(txt);
          return true;
        },
        stop: () => undefined,
      },
    };
    const svcNative = new BanglaSpeechService(fakeAudio);
    const b1 = svcNative.speak({
      speaker: 'driver',
      text: ROADRAGE_DRIVER_LINE,
      volume: 0.9,
      muted: false,
    });
    expect(b1).toBe('android-bn');
    expect(spokenNative).toEqual(['ওই হারামজাদা, দাঁড়া!']);
    expect(ducked).toBe(true);
    svcNative.stop();

    // When Android/Web Bengali TTS is unavailable, cleanly uses bundled offline audio clip
    g.window = {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      __btAndroidTts: {
        isBengaliAvailable: () => false,
        speak: () => false,
        stop: () => undefined,
      },
    };
    const svcFallback = new BanglaSpeechService(fakeAudio);
    const b2 = svcFallback.speak({
      speaker: 'player',
      text: ROADRAGE_PLAYER_LINE,
      volume: 0.9,
      muted: false,
    });
    expect(b2).toBe('bundled-fallback');
    expect(fallbackClips).toBe(1);

    g.window = prevWin;
  });

  it('triggers ONLY on private cars, enforces uninterrupted 5.0s escape, and handles catch + settlement/scuffle', () => {
    const g = globalThis as unknown as { window?: Record<string, unknown> };
    const prevWin = g.window;
    g.window = {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    };

    const subtitles: Array<{ who: string; line: string }> = [];
    let escapedCount = 0;
    let modalOpen = false;
    let scuffleFinished = false;

    const fakeTraffic = {
      canTriggerRoadRage: (idx: number) => idx === 7, // 7 = private car, others = cng/rickshaw/bus
      pullOverCar: (idx: number) => (idx === 7 ? { x: 0, y: 0, z: 0, yaw: 0 } : null),
      releaseCar: () => undefined,
    } as unknown as TrafficSystem;

    const fakeAudio = {
      playRoadRageAlert: () => undefined,
      setDialogueDuck: () => undefined,
      playDialogueClip: () => false,
      stopDialogueClip: () => undefined,
    } as unknown as AudioEngine;

    const speech = new BanglaSpeechService(fakeAudio);
    const scene = new THREE.Scene();
    const rr = new RoadRageSystem(scene, fakeTraffic, speech, fakeAudio, {
      heightAt: () => 0,
      getDialogueSettings: () => ({ volume: 0.85, muted: true, subtitles: true }),
      onAlertBanner: () => undefined,
      onSubtitle: (who, line) => subtitles.push({ who, line }),
      onEscaped: () => {
        escapedCount++;
      },
      onOpenConfrontation: () => {
        modalOpen = true;
      },
      onCloseConfrontation: () => {
        modalOpen = false;
      },
      onScuffleStart: () => undefined,
      onScuffleComplete: () => {
        scuffleFinished = true;
      },
    });

    // Non-car vehicles (e.g. CNG / rickshaw / bus -> idx !== 7) NEVER trigger road rage
    expect(rr.tryStart(2, 3, 3)).toBe(false);
    expect(rr.currentState).toBe('idle');

    // Private car triggers encounter
    expect(rr.tryStart(7, 3, 3)).toBe(true);
    expect(rr.currentState).toBe('exiting');
    expect(subtitles[0]).toEqual({ who: 'roadrage.speaker.driver', line: 'ওই হারামজাদা, দাঁড়া!' });

    // Duplicate collision during active encounter is ignored
    expect(rr.tryStart(7, 3, 3)).toBe(false);

    // Step past 0.85s exit animation into pursuit, move player far away (50m) for 3.0s
    for (let i = 0; i < 60; i++) rr.update(1 / 60, 0, 50);
    expect(rr.currentState).toBe('pursuing');
    for (let i = 0; i < 180; i++) rr.update(1 / 60, 0, 55);
    expect(rr.escapeSecondsRemaining).toBeLessThan(2.5);

    // Dipping back inside 17.5m range resets escape timer back to 5.0s!
    const dp = rr.driverPosition;
    rr.update(1 / 60, dp.x, dp.z + 10);
    expect(rr.escapeSecondsRemaining).toBe(5);

    // Staying >= 17.5m away for a full uninterrupted 5.0s escapes!
    for (let i = 0; i < 310; i++) rr.update(1 / 60, dp.x, dp.z + 60);
    expect(escapedCount).toBe(1);
    expect(rr.currentState).toBe('idle');

    // Wait out 18s cooldown (1150 steps at 60 Hz) and test catch -> insufficient funds -> scuffle
    for (let i = 0; i < 1150; i++) rr.update(1 / 60, 0, 0);
    expect(rr.tryStart(7, 2, 2)).toBe(true);
    for (let i = 0; i < 120; i++) rr.update(1 / 60, 1.5, 1.5);
    expect(rr.currentState).toBe('confronting');
    expect(modalOpen).toBe(true);

    // Cannot settle if player cannot afford ৳100
    expect(rr.settleWithPayment(() => false)).toBe(false);
    expect(rr.currentState).toBe('confronting');

    // Choosing দেব না triggers brief non-graphic scuffle and resolves cleanly
    rr.refusePayment();
    expect(rr.currentState).toBe('scuffling');
    expect(modalOpen).toBe(false);
    for (let i = 0; i < 110; i++) rr.update(1 / 60, 1.5, 1.5);
    expect(scuffleFinished).toBe(true);
    expect(rr.currentState).toBe('idle');

    g.window = prevWin;
  });
});
