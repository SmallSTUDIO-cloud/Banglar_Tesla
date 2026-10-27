import { describe, it, expect, beforeEach } from 'vitest';
import {
  createDefaultProgress,
  migrateProgress,
  sanitizeProgress,
  SaveStore,
  SAVE_VERSION,
  SAVE_KEY,
  BACKUP_KEY,
} from '../../src/core/save';
import { SettingsStore, DEFAULT_SETTINGS } from '../../src/core/settings';
import { GameState } from '../../src/core/gameState';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.has(k) ? (this.data.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
}

describe('save format', () => {
  it('creates a valid default progress', () => {
    const p = createDefaultProgress(1000);
    expect(p.version).toBe(SAVE_VERSION);
    expect(p.balance).toBe(500);
    expect(p.ownedVehicles).toContain('classic');
    expect(p.condition).toBeGreaterThan(50);
    expect(p.tapes).toContain('cassette');
  });

  it('migrates a v1 save and keeps the balance', () => {
    const migrated = migrateProgress({ version: 1, balance: 1234, upgrades: { tyres: 2 } }) as Record<string, unknown>;
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.balance).toBe(1234);
    expect((migrated.ownedCosmetics as string[]).length).toBeGreaterThan(0);
    // vNext §4 weather rename: legacy default 'clear' migrates to 'sunny'
    expect(migrated.weather).toBe('sunny');
    expect(migrated.lastMode).toBe('duty');
  });

  it('migrates legacy weather names to the five-state director states', () => {
    expect(sanitizeProgress({ version: 2, weather: 'clear' }).weather).toBe('sunny');
    expect(sanitizeProgress({ version: 2, weather: 'overcast' }).weather).toBe('overcast');
    expect(sanitizeProgress({ version: 2, weather: 'rain' }).weather).toBe('rain');
    expect(sanitizeProgress({ version: 2, weather: 'windy' }).weather).toBe('windy');
    expect(sanitizeProgress({ version: 2, weather: 'storm' }).weather).toBe('storm');
    expect(sanitizeProgress({ version: 2, weather: 'hurricane' }).weather).toBe('sunny');
  });

  it('sanitises hostile values instead of trusting them', () => {
    const p = sanitizeProgress({
      balance: -5000,
      condition: 900,
      rides: -3,
      ownedVehicles: ['nonsense', 'classic'],
      selectedVehicle: 'not-a-vehicle',
      cosmetics: { paint: 'paint.blue', tassel: 'bogus' },
      achievements: 'not-an-array',
      spawn: { x: 1e9, z: -1e9, yaw: 0 },
    });
    expect(p.balance).toBe(0);
    expect(p.condition).toBe(100);
    expect(p.rides).toBe(0);
    expect(p.ownedVehicles).toContain('classic');
    expect(p.selectedVehicle).toBe('classic');
    expect(p.cosmetics.paint).toBe('paint.blue');
    expect(Array.isArray(p.achievements)).toBe(true);
    expect(Math.abs(p.spawn!.x)).toBeLessThanOrEqual(500);
  });

  it('round-trips through storage', () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage);
    const progress = createDefaultProgress(10);
    progress.balance = 777;
    progress.rides = 4;
    expect(store.save(progress, 20)).toBe(true);
    const loaded = store.load(30);
    expect(loaded.progress?.balance).toBe(777);
    expect(loaded.progress?.rides).toBe(4);
  });

  it('recovers from a corrupt save using the backup', () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage);
    const good = createDefaultProgress(10);
    good.balance = 999;
    store.save(good, 20);
    store.save({ ...good, balance: 1000 }, 30); // now BACKUP holds balance 999
    storage.setItem(SAVE_KEY, '{ this is not json');
    const loaded = store.load(40);
    expect(loaded.recovered).toBe(true);
    expect(loaded.progress?.balance).toBe(999);
    // the corrupt payload is preserved for debugging
    const corruptKeys = [...storage.data.keys()].filter((k) => k.includes('.corrupt.'));
    expect(corruptKeys.length).toBe(1);
  });

  it('returns null (not a crash) when there is no save', () => {
    const store = new SaveStore(new MemoryStorage());
    expect(store.hasSave()).toBe(false);
    expect(store.load().progress).toBeNull();
  });

  it('keeps a backup key after two saves', () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage);
    store.save(createDefaultProgress(1), 1);
    store.save(createDefaultProgress(2), 2);
    expect(storage.getItem(BACKUP_KEY)).toBeTruthy();
  });
});

describe('settings', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('persists and reloads', () => {
    const store = new SettingsStore(storage);
    store.set({ language: 'en', quality: 'high', music: 0.2 });
    const reloaded = new SettingsStore(storage);
    expect(reloaded.get().language).toBe('en');
    expect(reloaded.get().quality).toBe('high');
    expect(reloaded.get().music).toBeCloseTo(0.2);
  });

  it('clamps out-of-range values', () => {
    const store = new SettingsStore(storage);
    store.set({ music: 5, renderScale: -2, deadzone: 99 });
    expect(store.get().music).toBe(1);
    expect(store.get().renderScale).toBe(0.6);
    expect(store.get().deadzone).toBe(0.4);
  });

  it('ignores unknown enum values from disk', () => {
    storage.setItem('banglar-tesla.settings.v1', JSON.stringify({ ...DEFAULT_SETTINGS, language: 'fr', quality: 'ultra' }));
    const store = new SettingsStore(storage);
    expect(store.get().language).toBe('bn');
    expect(store.get().quality).toBe('balanced');
  });

  it('reset restores defaults', () => {
    const store = new SettingsStore(storage);
    store.set({ muted: true });
    store.reset();
    expect(store.get().muted).toBe(false);
  });
});

describe('GameState economy guards', () => {
  const makeState = (): GameState => {
    const storage = new MemoryStorage();
    return new GameState(storage, () => 1000);
  };

  it('starts with the documented starter balance', () => {
    const state = makeState();
    expect(state.balance).toBe(500);
  });

  it('cannot spend more than the balance', () => {
    const state = makeState();
    expect(state.spend(10_000)).toBe(false);
    expect(state.balance).toBe(500);
    expect(state.spend(200)).toBe(true);
    expect(state.balance).toBe(300);
  });

  it('blocks a purchase with insufficient funds and explains the shortage', () => {
    const state = makeState();
    state.spend(400); // balance is now 100, bearings cost 360
    const res = state.buyUpgrade('bearings');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('insufficient');
    expect(state.balance).toBe(100);
    expect(state.upgradeLevel('bearings')).toBe(0);
  });

  it('a single purchase cannot be applied twice', () => {
    const state = makeState();
    state.addMoney(2000);
    const first = state.buyUpgrade('brakes');
    const second = state.buyUpgrade('brakes');
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true); // second level, not a duplicate of the first
    expect(state.upgradeLevel('brakes')).toBe(2);
    expect(state.balance).toBe(2500 - 280 - 680);
  });

  it('cosmetics are owned once and equipped without double charging', () => {
    const state = makeState();
    state.addMoney(1000);
    const buy = state.buyCosmetic('tassel.gold');
    const again = state.buyCosmetic('tassel.gold');
    expect(buy.ok).toBe(true);
    expect(again.ok).toBe(false);
    expect(state.balance).toBe(1500 - 160);
    expect(state.progress.cosmetics.tassel).toBe('tassel.gold');
  });

  it('cannot equip a cosmetic that is not owned', () => {
    const state = makeState();
    const res = state.equipCosmetic('art.cinema');
    expect(res.ok).toBe(false);
  });

  it('locks vehicles until the ride requirement is met', () => {
    const state = makeState();
    state.addMoney(10_000);
    const res = state.buyVehicle('cinema');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('locked');
    state.progress.rides = 12;
    const ok = state.buyVehicle('cinema');
    expect(ok.ok).toBe(true);
    expect(state.selectedVehicleId).toBe('cinema');
  });

  it('records a ride, pays out and unlocks tapes', () => {
    const state = makeState();
    state.recordRide({ earned: 120, distance: 400, mood: 95, damage: 0, mode: 'duty', wet: false });
    expect(state.balance).toBe(620);
    expect(state.progress.rides).toBe(1);
    expect(state.progress.achievements).toContain('ach.firstRide');
    expect(state.progress.tapes).toContain('cassette');
    expect(state.progress.tapes).not.toContain('radio'); // needs 2 rides
    state.recordRide({ earned: 80, distance: 200, mood: 60, damage: 1, mode: 'duty', wet: true });
    expect(state.progress.tapes).toContain('radio');
    expect(state.progress.achievements).toContain('ach.rainRide');
  });

  it('repairs only when the condition is down and money exists', () => {
    const state = makeState();
    state.progress.condition = 100;
    expect(state.repair().ok).toBe(false);
    state.progress.condition = 60;
    const before = state.balance;
    const res = state.repair();
    expect(res.ok).toBe(true);
    expect(state.progress.condition).toBe(100);
    expect(state.balance).toBeLessThan(before);
  });

  it('new game resets everything to defaults', () => {
    const state = makeState();
    state.addMoney(5000);
    state.resetProgress();
    expect(state.balance).toBe(500);
    expect(state.progress.rides).toBe(0);
  });
});
