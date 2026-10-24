/**
 * Authoritative in-memory progression state + guarded economy transactions.
 * All money changes flow through here so nothing can double-spend or go NaN.
 */

import { Emitter } from './events';
import { clamp } from './mathx';
import {
  cosmeticById,
  TAPES,
  upgradeById,
  vehicleById,
  VEHICLES,
  type CosmeticCategory,
  type VehicleDef,
} from '../economy/catalog';
import { canAfford, levelForRides, repairCost } from '../economy/economy';
import {
  createDefaultProgress,
  SaveStore,
  type GameMode,
  type Progress,
} from './save';
import type { StorageLike } from './settings';

export type PurchaseResult =
  | { ok: true; balance: number }
  | {
      ok: false;
      reason: 'insufficient' | 'owned' | 'maxed' | 'locked' | 'coming-soon' | 'unknown' | 'busy';
      shortage?: number;
    };

interface StateEvents {
  balance: number;
  progress: Readonly<Progress>;
  achievement: string;
  unlock: string;
  saved: boolean;
  toast: { key: string; params?: Record<string, string | number>; tone?: 'good' | 'bad' };
}

export class GameState extends Emitter<StateEvents> {
  readonly store: SaveStore;
  progress: Progress;
  readonly recoveredFromBackup: boolean;
  private txBusy = false;

  constructor(storage: StorageLike | null, now = () => Date.now()) {
    super();
    this.store = new SaveStore(storage);
    const loaded = this.store.load(now());
    this.recoveredFromBackup = loaded.recovered;
    this.progress = loaded.progress ?? createDefaultProgress(now());
    this.now = now;
  }

  private now: () => number;

  get balance(): number {
    return this.progress.balance;
  }

  get selectedVehicleId(): string {
    return this.progress.selectedVehicle;
  }

  vehicle(): VehicleDef {
    return vehicleById(this.progress.selectedVehicle);
  }

  get level(): number {
    return levelForRides(this.progress.rides).level;
  }

  // ----------------------------------------------------------------- money
  addMoney(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    const add = Math.round(amount);
    this.progress.balance = clamp(this.progress.balance + add, 0, 10_000_000);
    this.progress.totalEarned += add;
    this.emit('balance', this.progress.balance);
    this.emit('progress', this.progress);
  }

  spend(amount: number): boolean {
    if (!canAfford(this.progress.balance, amount)) return false;
    this.progress.balance -= Math.round(amount);
    this.emit('balance', this.progress.balance);
    this.emit('progress', this.progress);
    return true;
  }

  // --------------------------------------------------------------- upgrades
  upgradeLevel(id: string): number {
    return this.progress.upgrades[id] ?? 0;
  }

  nextUpgradePrice(id: string): number | null {
    const def = upgradeById(id);
    if (!def) return null;
    const level = this.upgradeLevel(id);
    if (level >= def.maxLevel) return null;
    return def.prices[level] ?? null;
  }

  buyUpgrade(id: string): PurchaseResult {
    if (this.txBusy) return { ok: false, reason: 'busy' };
    this.txBusy = true;
    try {
      const def = upgradeById(id);
      if (!def) return { ok: false, reason: 'unknown' };
      const level = this.upgradeLevel(id);
      if (level >= def.maxLevel) return { ok: false, reason: 'maxed' };
      const price = def.prices[level];
      if (!canAfford(this.progress.balance, price)) {
        return { ok: false, reason: 'insufficient', shortage: price - this.progress.balance };
      }
      this.spend(price);
      this.progress.upgrades[id] = level + 1;
      this.unlockAchievement('ach.firstUpgrade');
      this.saveNow();
      return { ok: true, balance: this.progress.balance };
    } finally {
      this.txBusy = false;
    }
  }

  // --------------------------------------------------------------- vehicles
  ownsVehicle(id: string): boolean {
    const def = VEHICLES.find((v) => v.id === id);
    if (!def || def.comingSoon) return false;
    return this.progress.ownedVehicles.includes(id);
  }

  isVehicleComingSoon(id: string): boolean {
    return !!VEHICLES.find((v) => v.id === id)?.comingSoon;
  }

  vehicleUnlocked(id: string): boolean {
    const def = VEHICLES.find((v) => v.id === id);
    if (!def || def.comingSoon) return false;
    return this.progress.rides >= def.ridesRequired || this.ownsVehicle(id);
  }

  buyVehicle(id: string): PurchaseResult {
    if (this.txBusy) return { ok: false, reason: 'busy' };
    this.txBusy = true;
    try {
      const def = VEHICLES.find((v) => v.id === id);
      if (!def) return { ok: false, reason: 'unknown' };
      if (def.comingSoon) return { ok: false, reason: 'coming-soon' };
      if (this.ownsVehicle(id)) return { ok: false, reason: 'owned' };
      if (!this.vehicleUnlocked(id)) return { ok: false, reason: 'locked' };
      if (!canAfford(this.progress.balance, def.price)) {
        return { ok: false, reason: 'insufficient', shortage: def.price - this.progress.balance };
      }
      this.spend(def.price);
      this.progress.ownedVehicles.push(id);
      this.progress.selectedVehicle = id;
      if (id === 'electric') this.unlockAchievement('ach.electricOwner');
      this.saveNow();
      return { ok: true, balance: this.progress.balance };
    } finally {
      this.txBusy = false;
    }
  }

  selectVehicle(id: string): boolean {
    if (!this.ownsVehicle(id)) return false;
    this.progress.selectedVehicle = id;
    this.emit('progress', this.progress);
    this.saveNow();
    return true;
  }

  // -------------------------------------------------------------- cosmetics
  ownsCosmetic(id: string): boolean {
    const def = cosmeticById(id);
    if (!def) return false;
    if (def.price === 0) return true;
    return this.progress.ownedCosmetics.includes(id);
  }

  buyCosmetic(id: string): PurchaseResult {
    if (this.txBusy) return { ok: false, reason: 'busy' };
    this.txBusy = true;
    try {
      const def = cosmeticById(id);
      if (!def) return { ok: false, reason: 'unknown' };
      if (this.ownsCosmetic(id)) return { ok: false, reason: 'owned' };
      if (!canAfford(this.progress.balance, def.price)) {
        return { ok: false, reason: 'insufficient', shortage: def.price - this.progress.balance };
      }
      this.spend(def.price);
      this.progress.ownedCosmetics.push(id);
      this.progress.cosmetics[def.category] = id;
      this.saveNow();
      return { ok: true, balance: this.progress.balance };
    } finally {
      this.txBusy = false;
    }
  }

  equipCosmetic(id: string, category?: CosmeticCategory): PurchaseResult {
    if (id === '' && category) {
      this.progress.cosmetics[category] = '';
      this.saveNow();
      return { ok: true, balance: this.progress.balance };
    }
    const def = cosmeticById(id);
    if (!def) return { ok: false, reason: 'unknown' };
    if (!this.ownsCosmetic(id)) return { ok: false, reason: 'locked' };
    this.progress.cosmetics[def.category] = id;
    this.saveNow();
    return { ok: true, balance: this.progress.balance };
  }

  // -------------------------------------------------------------- condition
  damageCondition(amount: number): void {
    if (amount <= 0) return;
    this.progress.condition = clamp(this.progress.condition - amount, 5, 100);
    if (this.progress.condition < 35) {
      this.emit('toast', { key: 'toast.conditionLow', tone: 'bad' });
    }
  }

  repairQuote(): number {
    return repairCost(this.progress.condition);
  }

  repair(): PurchaseResult {
    const price = this.repairQuote();
    if (price === 0) return { ok: false, reason: 'maxed' };
    if (!canAfford(this.progress.balance, price)) {
      return { ok: false, reason: 'insufficient', shortage: price - this.progress.balance };
    }
    this.spend(price);
    this.progress.condition = 100;
    this.saveNow();
    return { ok: true, balance: this.progress.balance };
  }

  // -------------------------------------------------------------- rides
  recordRide(opts: { earned: number; distance: number; mood: number; damage: number; mode: GameMode; wet: boolean }): void {
    this.progress.rides += 1;
    this.progress.distanceTravelled += Math.max(0, opts.distance);
    this.progress.lastMode = opts.mode;
    this.addMoney(opts.earned);

    if (this.progress.rides === 1) this.unlockAchievement('ach.firstRide');
    if (this.progress.rides >= 10) this.unlockAchievement('ach.tenRides');
    if (opts.damage === 0 && opts.mood >= 80) this.unlockAchievement('ach.cleanRun');
    if (opts.wet) this.unlockAchievement('ach.rainRide');
    if (this.progress.distanceTravelled >= 3000) this.unlockAchievement('ach.explorer');

    for (const tape of TAPES) {
      if (this.progress.rides >= tape.unlockRides && !this.progress.tapes.includes(tape.id)) {
        this.progress.tapes.push(tape.id);
        this.emit('unlock', tape.id);
      }
    }
    this.saveNow();
  }

  unlockAchievement(id: string): void {
    if (this.progress.achievements.includes(id)) return;
    this.progress.achievements.push(id);
    this.emit('achievement', id);
  }

  markTutorialDone(): void {
    this.progress.tutorialDone = true;
    this.saveNow();
  }

  setMode(mode: GameMode): void {
    this.progress.lastMode = mode;
  }

  setSpawn(x: number, z: number, yaw: number): void {
    this.progress.spawn = { x, z, yaw };
  }

  // ------------------------------------------------------------ persistence
  saveNow(): void {
    const ok = this.store.save(this.progress, this.now());
    if (ok) this.emit('saved', true);
  }

  autosave(): void {
    if (this.store.autosave(this.progress, this.now())) this.emit('saved', true);
  }

  resetProgress(): void {
    this.store.clear();
    this.progress = createDefaultProgress(this.now());
    this.store.save(this.progress, this.now());
    this.emit('balance', this.progress.balance);
    this.emit('progress', this.progress);
  }
}
