/**
 * Player progression: taka, vehicles, upgrades, cosmetics, achievements, tapes.
 * All mutations are guarded here so the balance can never go negative and a
 * purchase can never be applied twice.
 */

import { Emitter } from './events';
import { clamp } from './mathx';
import { SaveStore, createDefaultProgress, type GameMode, type Progress } from './save';
import type { StorageLike } from './settings';
import {
  COSMETICS,
  TAPES,
  UPGRADES,
  VEHICLES,
  cosmeticById,
  vehicleById,
  type CosmeticCategory,
} from '../economy/catalog';
import { repairCost, canAfford, levelForRides } from '../economy/economy';

export interface GameEvents {
  balance: number;
  progress: Progress;
  purchase: { kind: string; id: string };
  achievement: string;
  unlock: string;
  toast: { key: string; params?: Record<string, string | number>; tone?: 'good' | 'bad' };
  saved: void;
  error: string;
}

export type PurchaseResult = { ok: true } | { ok: false; reason: 'insufficient' | 'owned' | 'locked' | 'invalid' };

export class GameState extends Emitter<GameEvents> {
  progress: Progress;
  readonly saveStore: SaveStore;
  private saveTimer: number | null = null;

  constructor(
    storage: StorageLike | null,
    readonly now: () => number = Date.now,
  ) {
    super();
    this.saveStore = new SaveStore(storage);
    const loaded = this.saveStore.load(this.now());
    this.progress = loaded.progress ?? createDefaultProgress(this.now());
    if (loaded.recovered) {
      this.emit('toast', { key: 'common.saved', tone: 'bad' });
    }
  }

  get balance(): number {
    return this.progress.balance;
  }

  get selectedVehicleId(): string {
    return this.progress.selectedVehicle;
  }

  get level(): number {
    return levelForRides(this.progress.rides).level;
  }

  // ------------------------------------------------------------- money ---
  addMoney(amount: number): void {
    if (!Number.isFinite(amount) || amount === 0) return;
    this.progress.balance = Math.max(0, Math.round(this.progress.balance + amount));
    if (amount > 0) this.progress.totalEarned += Math.round(amount);
    this.emit('balance', this.progress.balance);
    this.emit('progress', this.progress);
    this.scheduleSave();
  }

  spend(amount: number): boolean {
    const price = Math.round(amount);
    if (!canAfford(this.progress.balance, price)) return false;
    this.progress.balance -= price;
    this.emit('balance', this.progress.balance);
    this.emit('progress', this.progress);
    this.scheduleSave();
    return true;
  }

  // ----------------------------------------------------------- vehicles ---
  ownsVehicle(id: string): boolean {
    return this.progress.ownedVehicles.includes(id);
  }

  vehicleUnlocked(id: string): boolean {
    const def = vehicleById(id);
    return this.progress.rides >= def.ridesRequired;
  }

  buyVehicle(id: string): PurchaseResult {
    const def = VEHICLES.find((v) => v.id === id);
    if (!def) return { ok: false, reason: 'invalid' };
    if (this.ownsVehicle(id)) return { ok: false, reason: 'owned' };
    if (!this.vehicleUnlocked(id)) return { ok: false, reason: 'locked' };
    if (!canAfford(this.progress.balance, def.price)) return { ok: false, reason: 'insufficient' };
    this.progress.balance -= def.price;
    this.progress.ownedVehicles.push(id);
    this.progress.selectedVehicle = id;
    this.afterPurchase('vehicle', id);
    return { ok: true };
  }

  selectVehicle(id: string): boolean {
    if (!this.ownsVehicle(id)) return false;
    this.progress.selectedVehicle = id;
    this.emit('progress', this.progress);
    this.scheduleSave(true);
    return true;
  }

  // ---------------------------------------------------------- upgrades ---
  upgradeLevel(id: string): number {
    return this.progress.upgrades[id] ?? 0;
  }

  nextUpgradePrice(id: string): number | null {
    const def = UPGRADES.find((u) => u.id === id);
    if (!def) return null;
    const level = this.upgradeLevel(id);
    if (level >= def.maxLevel) return null;
    return def.prices[level];
  }

  buyUpgrade(id: string): PurchaseResult {
    const def = UPGRADES.find((u) => u.id === id);
    if (!def) return { ok: false, reason: 'invalid' };
    const price = this.nextUpgradePrice(id);
    if (price === null) return { ok: false, reason: 'owned' };
    if (!canAfford(this.progress.balance, price)) return { ok: false, reason: 'insufficient' };
    this.progress.balance -= price;
    this.progress.upgrades[id] = this.upgradeLevel(id) + 1;
    this.afterPurchase('upgrade', id);
    this.unlockAchievement('ach.firstUpgrade');
    return { ok: true };
  }

  // --------------------------------------------------------- cosmetics ---
  ownsCosmetic(id: string): boolean {
    return this.progress.ownedCosmetics.includes(id);
  }

  buyCosmetic(id: string): PurchaseResult {
    const def = cosmeticById(id);
    if (!def) return { ok: false, reason: 'invalid' };
    if (this.ownsCosmetic(id)) return { ok: false, reason: 'owned' };
    if (!canAfford(this.progress.balance, def.price)) return { ok: false, reason: 'insufficient' };
    this.progress.balance -= def.price;
    this.progress.ownedCosmetics.push(id);
    this.progress.cosmetics[def.category] = id;
    this.afterPurchase('cosmetic', id);
    return { ok: true };
  }

  equipCosmetic(id: string): PurchaseResult {
    const def = cosmeticById(id);
    if (!def) return { ok: false, reason: 'invalid' };
    if (!this.ownsCosmetic(id)) return { ok: false, reason: 'locked' };
    this.progress.cosmetics[def.category as CosmeticCategory] = id;
    this.emit('progress', this.progress);
    this.scheduleSave(true);
    return { ok: true };
  }

  // ------------------------------------------------------------ repair ---
  repairQuote(): number {
    return repairCost(this.progress.condition);
  }

  repair(): PurchaseResult {
    const cost = this.repairQuote();
    if (cost <= 0) return { ok: false, reason: 'owned' };
    if (!canAfford(this.progress.balance, cost)) return { ok: false, reason: 'insufficient' };
    this.progress.balance -= cost;
    this.progress.condition = 100;
    this.emit('balance', this.progress.balance);
    this.emit('progress', this.progress);
    this.scheduleSave(true);
    return { ok: true };
  }

  damageCondition(amount: number): void {
    this.progress.condition = clamp(this.progress.condition - Math.max(0, amount), 8, 100);
    this.emit('progress', this.progress);
  }

  // ------------------------------------------------------- achievements ---
  hasAchievement(id: string): boolean {
    return this.progress.achievements.includes(id);
  }

  unlockAchievement(id: string): void {
    if (!id || this.hasAchievement(id)) return;
    this.progress.achievements.push(id);
    // The UI owns presentation/localisation: it listens for this event and
    // shows a translated toast. The state layer stays text-free.
    this.emit('achievement', id);
    this.scheduleSave();
  }

  /** Called after any successful purchase: refresh derived UI + autosave. */
  private afterPurchase(kind: string, id: string): void {
    this.emit('balance', this.progress.balance);
    this.emit('progress', this.progress);
    this.emit('purchase', { kind, id });
    this.scheduleSave(true);
  }

  // ------------------------------------------------------------- rides ---
  recordRide(info: {
    earned: number;
    distance: number;
    mood: number;
    damage: number;
    mode: GameMode;
    wet: boolean;
  }): void {
    this.progress.rides += 1;
    this.progress.distanceTravelled += Math.max(0, info.distance);
    this.progress.balance += Math.max(0, Math.round(info.earned));
    this.progress.totalEarned += Math.max(0, Math.round(info.earned));
    this.progress.condition = clamp(this.progress.condition - info.distance / 1000 * 0.55 - info.damage * 0.4, 8, 100);

    for (const tape of TAPES) {
      if (this.progress.rides >= tape.unlockRides && !this.progress.tapes.includes(tape.id)) {
        this.progress.tapes.push(tape.id);
        this.emit('unlock', tape.id);
      }
    }
    if (this.progress.rides === 1) this.unlockAchievement('ach.firstRide');
    if (this.progress.rides >= 10) this.unlockAchievement('ach.tenRides');
    if (info.damage <= 0 && info.mood >= 85) this.unlockAchievement('ach.cleanRun');
    if (info.wet) this.unlockAchievement('ach.rainRide');
    if (this.progress.rides >= 4) this.unlockAchievement('ach.explorer');

    this.emit('balance', this.progress.balance);
    this.emit('progress', this.progress);
    this.saveNow();
  }

  setMode(mode: GameMode): void {
    this.progress.lastMode = mode;
    this.scheduleSave(true);
  }

  setSpawn(x: number, z: number, yaw: number): void {
    this.progress.spawn = { x, z, yaw };
  }

  markTutorialDone(): void {
    this.progress.tutorialDone = true;
    this.scheduleSave(true);
  }

  // -------------------------------------------------------------- save ---
  private scheduleSave(immediate = false): void {
    if (immediate) {
      this.saveNow();
      return;
    }
    if (this.saveTimer !== null) return;
    this.saveTimer = this.windowSetTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, 1200);
  }

  private windowSetTimeout(fn: () => void, ms: number): number {
    const g = globalThis as { setTimeout?: (cb: () => void, t: number) => number };
    if (g.setTimeout) return g.setTimeout(fn, ms) as unknown as number;
    fn();
    return 0;
  }

  saveNow(): void {
    this.progress.updatedAt = this.now();
    const ok = this.saveStore.save(this.progress, this.now());
    if (ok) this.emit('saved', undefined);
  }

  resetProgress(): void {
    this.saveStore.clear();
    this.progress = createDefaultProgress(this.now());
    this.emit('balance', this.progress.balance);
    this.emit('progress', this.progress);
    this.saveNow();
  }

  /** Convenience: cosmetics currently equipped plus their data. */
  equippedCosmetic(category: CosmeticCategory) {
    const id = this.progress.cosmetics[category] ?? '';
    return cosmeticById(id) ?? COSMETICS[0];
  }

  vehicle() {
    return vehicleById(this.progress.selectedVehicle);
  }
}
