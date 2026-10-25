import { describe, expect, it } from 'vitest';
import { GameTimeSystem } from '../../src/world/timeSystem';
import {
  RickshawController,
  testRickshawCapsuleVsObb,
} from '../../src/vehicle/rickshawController';
import { RIDE, TURBO } from '../../src/core/config';
import { deriveVehicle } from '../../src/economy/economy';
import { vehicleById } from '../../src/economy/catalog';
import { migrateProgress, sanitizeProgress, SAVE_VERSION } from '../../src/core/save';
import { GameState } from '../../src/core/gameState';
import {
  BanglaSpeechService,
  hasBanglaScript,
  isVerifiedBengaliVoice,
} from '../../src/audio/speech';
import {
  BLACKLIST_RIVALS,
  OPEN_STREET_EVENTS,
  rivalByRank,
  type RivalEventKind,
} from '../../src/blacklist/blacklistCatalog';
import { PLACES } from '../../src/world/layout';
import { RoadblockSystem } from '../../src/ai/roadblocks';
import { PolicePursuitSystem } from '../../src/ai/police';
import { classifyCrashTier } from '../../src/world/arcadeVfx';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

describe('v0.5.0 Upgrade Suite — Dynamic Time, Physics, OBB, Turbo, Speech, Blacklist & Police', () => {
  it('formats accelerated in-game clock as 07:30 AM / 06:45 PM with whole-minute dirty checks and DayPhase sync', () => {
    const clock = new GameTimeSystem(7 * 60 + 30); // 07:30 AM
    expect(clock.formatted).toBe('07:30 AM');
    expect(clock.phase).toBe('morning');

    // Sub-minute advance must return false (zero per-frame DOM updates!)
    expect(clock.update(0.5)).toBe(false);
    expect(clock.formatted).toBe('07:30 AM');

    // Crossing a whole in-game minute returns true exactly once
    expect(clock.update(2.0)).toBe(true);
    expect(clock.formatted).toBe('07:31 AM');
    expect(clock.update(0.1)).toBe(false);

    const seenPhases: string[] = [];
    clock.onPhaseChange = (p) => seenPhases.push(p);

    clock.setMinutes(12 * 60);
    expect(clock.formatted).toBe('12:00 PM');
    expect(clock.phase).toBe('noon');

    clock.setMinutes(16 * 60 + 45);
    expect(clock.formatted).toBe('04:45 PM');
    expect(clock.phase).toBe('golden');

    clock.setMinutes(18 * 60 + 45);
    expect(clock.formatted).toBe('06:45 PM');
    expect(clock.phase).toBe('blue');

    clock.setMinutes(21 * 60 + 15);
    expect(clock.formatted).toBe('09:15 PM');
    expect(clock.phase).toBe('night');
    expect(seenPhases).toEqual(['noon', 'golden', 'blue', 'night']);
  });

  it('delivers calibrated Classic speed (~20 km/h), টান (~1.95x), and hold-only টার্বো (~3.0x) with instant release stop', () => {
    const ctrl = new RickshawController([], () => 0, () => 'road');
    const derived = deriveVehicle(vehicleById('classic'), {}, 100, 0);
    ctrl.setTuning({
      maxSpeed: derived.maxSpeed,
      accel: derived.accel,
      brakeDecel: derived.brakeDecel,
      steerMaxLow: derived.steerMaxLow,
      steerMaxHigh: derived.steerMaxHigh,
      steerRateMultiplier: derived.steerRateMultiplier,
      grip: derived.grip,
      roughSurfaceKeep: derived.roughSurfaceKeep,
      rollingDragScale: derived.rollingDragScale,
      isElectric: false,
      batteryDrainMultiplier: 1,
      regenFactor: 0,
      turboDrainMultiplier: 1,
      turboRechargeMultiplier: 1,
    });

    // 1. Normal cruising speed (~20.3 km/h)
    for (let i = 0; i < 600; i++) {
      ctrl.step(1 / 60, { throttle: 1, brake: 0, steer: 0, handbrake: false, turbo: false }, 1, 0.08);
    }
    const normalKmh = ctrl.speed * 3.6;
    expect(normalKmh).toBeGreaterThan(19.2);
    expect(normalKmh).toBeLessThan(21.2);

    // 2. টান toggle boost (~1.95x)
    ctrl.stamina = 100;
    expect(ctrl.setTanActive(true)).toBe(true);
    for (let i = 0; i < 360; i++) {
      ctrl.stamina = 100;
      ctrl.step(1 / 60, { throttle: 1, brake: 0, steer: 0, handbrake: false, turbo: false }, 1, 0.08);
    }
    const tanRatio = (ctrl.speed * 3.6) / normalKmh;
    expect(tanRatio).toBeGreaterThan(1.88);
    expect(tanRatio).toBeLessThan(2.02);
    ctrl.setTanActive(false);

    // 3. Hold-to-boost টার্বো (~3.0x, ~60 km/h) + instant stop on release!
    ctrl.turboCharge = 100;
    for (let i = 0; i < 300; i++) {
      ctrl.turboCharge = 100;
      ctrl.step(1 / 60, { throttle: 1, brake: 0, steer: 0, handbrake: false, turbo: true }, 1, 0.08);
    }
    expect(ctrl.turboActive).toBe(true);
    const turboKmh = ctrl.speed * 3.6;
    expect(turboKmh).toBeGreaterThan(56);
    expect(turboKmh).toBeLessThanOrEqual(TURBO.maxSpeedCap * 3.6 + 0.5);

    // Releasing turbo input stops turboActive on the VERY NEXT physics step!
    ctrl.step(1 / 60, { throttle: 1, brake: 0, steer: 0, handbrake: false, turbo: false }, 1, 0.08);
    expect(ctrl.turboActive).toBe(false);
  });

  it('prevents phantom air hits on close OBB passes and slides cleanly past angled walls without 0 km/h stuck lock', () => {
    // Rotated sedan OBB (halfWidth=0.88, halfLength=2.08) tilted at 32 deg
    const obbYaw = 0.56;
    const rightX = Math.cos(obbYaw);
    const rightZ = -Math.sin(obbYaw);
    // Place rickshaw parallel to the car with ~0.18m lateral clearance between hulls
    const clearanceDist = 0.88 + RIDE.circleRadius + 0.18;
    const closePass = testRickshawCapsuleVsObb(
      rightX * clearanceDist,
      rightZ * clearanceDist,
      obbYaw,
      0,
      0,
      0.88,
      2.08,
      obbYaw,
    );
    expect(closePass.hit).toBe(false);

    // Genuine hull overlap must register cleanly
    const overlap = testRickshawCapsuleVsObb(
      rightX * (0.88 + RIDE.circleRadius - 0.15),
      rightZ * (0.88 + RIDE.circleRadius - 0.15),
      obbYaw,
      0,
      0,
      0.88,
      2.08,
      obbYaw,
    );
    expect(overlap.hit).toBe(true);

    // Angled building wall scrape (28 deg incidence): rickshaw slides forward instead of sticking at 0 km/h!
    const wallYaw = 0.48;
    const ctrl = new RickshawController(
      [
        {
          minX: -12,
          maxX: 12,
          minZ: -12,
          maxZ: 12,
          height: 4,
          cx: 1.35,
          cz: 8,
          halfX: 1.0,
          halfZ: 10.0,
          yaw: wallYaw,
        },
      ],
      () => 0,
      () => 'road',
    );
    ctrl.reset(0, 0, 0);
    for (let i = 0; i < 180; i++) {
      ctrl.step(1 / 60, { throttle: 1, brake: 0, steer: 0, handbrake: false, turbo: false }, 1, 0.08);
    }
    expect(ctrl.z).toBeGreaterThan(4.0);
    expect(ctrl.stuck).toBe(false);
  });

  it('migrates v0.4.0 saves cleanly and enforces edge-triggered রিকশার অবস্থা কম warning without spam', () => {
    const legacyV1 = {
      version: 1,
      balance: 1450,
      rides: 14,
      distanceTravelled: 4200,
      ownedVehicles: ['classic', 'electric'],
      selectedVehicle: 'electric',
      upgrades: { bearings: 2, brakes: 1 },
      ownedCosmetics: ['paint.blue'],
      cosmetics: { paint: 'paint.blue' },
      condition: 62,
      stamina: 84,
      tutorialDone: true,
    };
    const migrated = sanitizeProgress(migrateProgress(legacyV1), 1000);
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.balance).toBe(1450);
    expect(migrated.selectedVehicle).toBe('electric');
    expect(migrated.rep).toBeGreaterThan(0);
    expect(migrated.blacklistNextRank).toBe(10);
    expect(migrated.upgrades.turboCap ?? 0).toBe(0);
    expect(migrated.upgrades.turboRecharge ?? 0).toBe(0);

    // Edge-triggered low condition warning check
    const state = new GameState(new MemoryStorage());
    let lowWarnCount = 0;
    state.on('toast', (t) => {
      if (t.key === 'toast.conditionLow') lowWarnCount++;
    });

    state.damageCondition(70); // drops below 35: fires ONCE
    expect(state.progress.condition).toBeLessThan(35);
    expect(lowWarnCount).toBe(1);

    // Repeated minor bumps while < 35 must NEVER spam the warning again!
    state.damageCondition(5);
    state.damageCondition(5);
    state.damageCondition(5);
    expect(lowWarnCount).toBe(1);

    // Repairing to 100 resets the latch cleanly
    state.addMoney(500);
    expect(state.repair().ok).toBe(true);
    expect(state.progress.condition).toBe(100);
    state.damageCondition(70);
    expect(lowWarnCount).toBe(2);
  });

  it('strictly blocks English voices from synthesizing Bangla text and falls back to intelligible Bangla WAV', () => {
    expect(hasBanglaScript('ওই হারামজাদা, দাঁড়া!')).toBe(true);
    expect(hasBanglaScript('Pull over right now!')).toBe(false);

    expect(isVerifiedBengaliVoice({ lang: 'en-US', name: 'Google US English' } as SpeechSynthesisVoice)).toBe(false);
    expect(isVerifiedBengaliVoice({ lang: 'en-GB', name: 'English UK' } as SpeechSynthesisVoice)).toBe(false);
    expect(isVerifiedBengaliVoice({ lang: 'bn-BD', name: 'Bangla Bangladesh' } as SpeechSynthesisVoice)).toBe(true);
    expect(isVerifiedBengaliVoice({ lang: 'bn_IN', name: 'Bengali India' } as SpeechSynthesisVoice)).toBe(true);

    let playedRole: string | null = null;
    let playedLocale: string | null = null;
    const mockAudio = {
      playBundledDialogue: (role: string, locale: string, onEnd?: () => void) => {
        playedRole = role;
        playedLocale = locale;
        if (onEnd) setTimeout(onEnd, 5);
        return true;
      },
      stopDialogueClip: () => undefined,
      setDialogueDuck: () => undefined,
      getMeasuredDialogueGain: () => 0.92,
      isDialogueDucked: () => true,
    };
    const svc = new BanglaSpeechService(mockAudio as never);
    const backend = svc.speak({
      speaker: 'rival',
      text: 'মোহাম্মদপুরের রাস্তা আজ আমার!',
      locale: 'bn',
      priority: 3,
      volume: 0.9,
      muted: false,
    });
    expect(backend).toBe('bundled-fallback');
    expect(playedRole).toBe('rival');
    expect(playedLocale).toBe('bn');
    const diag = svc.getDiagnostics();
    expect(diag.engine).toBe('bundled-fallback');
    expect(diag.dialoguePriority).toBe(3);
  });

  it('validates #10 -> #1 Blacklist rivals, all 7 event kinds, smashable roadblocks, and 5-Heat police pursuit cleanup', () => {
    expect(BLACKLIST_RIVALS.length).toBe(10);
    const ranks = BLACKLIST_RIVALS.map((r) => r.rank);
    expect(ranks).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);

    const placeIds = new Set(PLACES.map((p) => p.id));
    const seenKinds = new Set<RivalEventKind>();
    for (const r of BLACKLIST_RIVALS) {
      seenKinds.add(r.bossEvent.kind);
      for (const wp of r.bossEvent.waypointPlaceIds) {
        expect(placeIds.has(wp)).toBe(true);
      }
    }
    for (const ev of OPEN_STREET_EVENTS) {
      seenKinds.add(ev.kind);
      for (const wp of ev.waypointPlaceIds) {
        expect(placeIds.has(wp)).toBe(true);
      }
    }
    expect(seenKinds.size).toBe(7);
    expect(rivalByRank(1)?.nameBn).toContain('সম্রাট');

    // Tiered crash classifier
    expect(classifyCrashTier(0.2)).toBeNull();
    expect(classifyCrashTier(0.6)).toBe('minor');
    expect(classifyCrashTier(1.4)).toBe('medium');
    expect(classifyCrashTier(3.0)).toBe('major');

    // Roadblocks & 5-Heat Police Pursuit lifecycle + clean teardown
    const rb = new RoadblockSystem(() => 0);
    const pol = new PolicePursuitSystem(rb, {
      heightAt: () => 0,
      onDispatchRadio: () => undefined,
      onPursuitEscaped: () => undefined,
      onPlayerBusted: () => undefined,
      onHeatEscalated: () => undefined,
    });
    pol.startPursuit(3, 0, 0, 0);
    expect(pol.isActive).toBe(true);
    expect(pol.heatLevel).toBe(3);
    pol.update(0.5, 0, 0, 0, 8, false);
    expect(pol.activeUnitCount).toBeGreaterThanOrEqual(2);

    pol.stopPursuit(true);
    expect(pol.isActive).toBe(false);
    expect(pol.activeUnitCount).toBe(0);
    expect(rb.activeCount).toBe(0);
  });
});
