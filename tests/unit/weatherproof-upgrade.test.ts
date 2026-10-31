import { describe, expect, it } from 'vitest';
import { GameState } from '../../src/core/gameState';
import { deriveVehicle } from '../../src/economy/economy';
import { vehicleById } from '../../src/economy/catalog';
import { sanitizeProgress } from '../../src/core/save';
import { t, setLocale } from '../../src/core/i18n';

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string): string | null { return this.data.get(k) ?? null; }
  setItem(k: string, v: string): void { this.data.set(k, v); }
  removeItem(k: string): void { this.data.delete(k); }
}

describe('weatherproof drive: real progression and wet physics', () => {
  it('requires rides and money, buys sequential levels and persists the result', () => {
    const storage = new MemoryStorage();
    const state = new GameState(storage, () => 1000);
    expect(state.buyUpgrade('sealedDrive')).toMatchObject({ ok: false, reason: 'locked' });
    expect(state.balance).toBe(500);
    state.progress.rides = 3;
    expect(state.buyUpgrade('sealedDrive').ok).toBe(true);
    expect(state.balance).toBe(80);
    expect(state.buyUpgrade('sealedDrive')).toMatchObject({ ok: false, reason: 'insufficient' });
    state.addMoney(1200);
    expect(state.buyUpgrade('sealedDrive').ok).toBe(true);
    expect(state.upgradeLevel('sealedDrive')).toBe(2);
    expect(state.buyUpgrade('sealedDrive')).toMatchObject({ ok: false, reason: 'maxed' });
    expect(new GameState(storage, () => 2000).upgradeLevel('sealedDrive')).toBe(2);
    expect(sanitizeProgress({ upgrades: { sealedDrive: 999 } }).upgrades.sealedDrive).toBe(2);
  });
  it('restores meaningful wet-road acceleration but never changes dry speed or top speed', () => {
    const vehicle = vehicleById('classic');
    const baseDry = deriveVehicle(vehicle, {}, 100, 0);
    const baseWet = deriveVehicle(vehicle, {}, 100, 1);
    const sealed = deriveVehicle(vehicle, { sealedDrive: 2 }, 100, 1);
    expect(baseWet.accel).toBeLessThan(baseDry.accel);
    expect(sealed.accel).toBeGreaterThan(baseWet.accel * 1.07);
    expect(sealed.accel).toBeLessThanOrEqual(baseDry.accel);
    expect(deriveVehicle(vehicle, { sealedDrive: 2 }, 100, 0).accel).toBe(baseDry.accel);
    expect(sealed.maxSpeed).toBe(baseWet.maxSpeed);
  });
  it('provides English and Bangla shop labels', () => {
    setLocale('en');
    expect(t('up.sealedDrive')).toContain('Motor');
    setLocale('bn');
    expect(t('up.sealedDrive')).toContain('মোটর');
    setLocale('en');
  });
});
