/**
 * Versioned, crash-tolerant local save. Pure helpers are exported for tests;
 * `SaveStore` adds storage, backup and throttled autosave.
 *
 * A save is always *data*; live objects are rebuilt from it on load.
 */

import type { DayPhase, WeatherKind } from './config';
import { clamp } from './mathx';
import { DEFAULT_COSMETICS, cosmeticById, UPGRADES, VEHICLES, TAPES } from '../economy/catalog';
import type { CosmeticCategory } from '../economy/catalog';
import type { StorageLike } from './settings';
import { canonicalMinutesForPhase, DEFAULT_START_MINUTES, normalizeMinutes } from '../world/timeSystem';

export const SAVE_VERSION = 4; // v4: per-rank Blacklist preparation
export const SAVE_KEY = 'banglar-tesla.save';
export const BACKUP_KEY = 'banglar-tesla.save.bak';

export type GameMode = 'duty' | 'free' | 'daily';

export interface Progress {
  version: number;
  balance: number;
  rep: number;
  ownedVehicles: string[];
  selectedVehicle: string;
  upgrades: Record<string, number>;
  ownedCosmetics: string[];
  cosmetics: Record<CosmeticCategory, string>;
  condition: number;
  stamina: number;
  rides: number;
  totalEarned: number;
  distanceTravelled: number;
  achievements: string[];
  tapes: string[];
  tutorialDone: boolean;
  dailyDoneDate: string;
  lastMode: GameMode;
  spawn: { x: number; z: number; yaw: number } | null;
  dayPhase: DayPhase;
  clockMinutes: number;
  weather: WeatherKind;
  /** vNext §10: bounded deduplicated permanent career scrapbook. */
  scrapbook: unknown;
  /** Next Blacklist rank to defeat: 10 (#10) down to 1 (#1), 0 = Champion crowned. */
  blacklistNextRank: number;
  blacklistDefeated: number[];
  blacklistIntroSeen: boolean;
  /** Completed, per-rank challenge tasks (e.g. "7:escape"). */
  blacklistTasks: string[];
  completedEvents: string[];
  heat: number;
  createdAt: number;
  updatedAt: number;
}

export function createDefaultProgress(now = Date.now()): Progress {
  return {
    version: SAVE_VERSION,
    scrapbook: { records: [] },
    balance: 500,
    rep: 0,
    ownedVehicles: VEHICLES.filter((v) => v.ownedByDefault && !v.comingSoon).map((v) => v.id),
    selectedVehicle: 'classic',
    upgrades: {},
    ownedCosmetics: ['bell.classic'],
    cosmetics: { ...DEFAULT_COSMETICS },
    condition: 86,
    stamina: 100,
    rides: 0,
    totalEarned: 0,
    distanceTravelled: 0,
    achievements: [],
    tapes: TAPES.filter((t) => t.unlockRides === 0).map((t) => t.id),
    tutorialDone: false,
    dailyDoneDate: '',
    lastMode: 'duty',
    spawn: null,
    dayPhase: 'morning',
    clockMinutes: DEFAULT_START_MINUTES,
    weather: 'sunny',
    blacklistNextRank: 10,
    blacklistDefeated: [],
    blacklistIntroSeen: false,
    blacklistTasks: [],
    completedEvents: [],
    heat: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function num(v: unknown, fallback: number, lo = -Infinity, hi = Infinity): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

/** Migrate older save shapes forward. Each step is a pure function. */
export function migrateProgress(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const data = { ...raw };
  const version = num(data.version, 1, 0, 99);

  if (version < 1) {
    data.version = 1;
    data.upgrades = isRecord(data.upgrades) ? data.upgrades : {};
  }
  if (version < 2) {
    // v2 added cosmetics ownership tracking, daily date and the phase state.
    data.version = 2;
    const owned = strArray(data.ownedCosmetics);
    if (!owned.includes('bell.classic')) owned.push('bell.classic');
    data.ownedCosmetics = owned;
    if (typeof data.dailyDoneDate !== 'string') data.dailyDoneDate = '';
    if (!['morning', 'noon', 'golden', 'blue', 'night'].includes(String(data.dayPhase))) {
      data.dayPhase = 'morning';
    }
    if (data.lastMode !== 'duty' && data.lastMode !== 'free' && data.lastMode !== 'daily') {
      data.lastMode = 'duty';
    }
  }
  if (version < 3) {
    // v3 (Master Upgrade vNext): five-state weather rename + permanent scrapbook.
    data.version = 3;
    const legacyWeather = String(data.weather);
    if (legacyWeather === 'clear') data.weather = 'sunny'; // v0.5.x -> v0.6.0 weather rename
    if (!['sunny', 'overcast', 'rain', 'windy', 'storm'].includes(String(data.weather))) {
      data.weather = 'sunny';
    }
    if (!isRecord(data.scrapbook)) {
      data.scrapbook = { records: [] };
    }
  }
  if (version < 4) {
    data.version = 4;
    if (!Array.isArray(data.blacklistTasks)) data.blacklistTasks = [];
  }
  return data;
}

/** Coerce untrusted data into a valid Progress, falling back to defaults. */
export function sanitizeProgress(raw: unknown, now = Date.now()): Progress {
  const def = createDefaultProgress(now);
  if (!isRecord(raw)) return def;
  const data = raw as Record<string, unknown>;

  // Never allow comingSoon vehicles (e.g. 'roadster') into ownedVehicles
  const validPurchasableIds = new Set(VEHICLES.filter((v) => !v.comingSoon).map((v) => v.id));
  const ownedVehicles: string[] = [];
  for (const id of strArray(data.ownedVehicles)) {
    if (validPurchasableIds.has(id) && !ownedVehicles.includes(id)) ownedVehicles.push(id);
  }
  if (!ownedVehicles.includes('classic')) ownedVehicles.unshift('classic');

  const selected = typeof data.selectedVehicle === 'string' ? data.selectedVehicle : def.selectedVehicle;
  const selectedVehicle = ownedVehicles.includes(selected) ? selected : ownedVehicles[0];

  const upgrades: Record<string, number> = {};
  if (isRecord(data.upgrades)) {
    for (const [key, value] of Object.entries(data.upgrades)) {
      const defUp = UPGRADES.find((u) => u.id === key);
      const cap = defUp ? defUp.maxLevel : 3;
      const level = num(value, 0, 0, cap);
      if (level > 0) upgrades[key] = Math.floor(level);
    }
  }

  const cosmetics = { ...def.cosmetics };
  if (isRecord(data.cosmetics)) {
    for (const key of Object.keys(cosmetics) as CosmeticCategory[]) {
      const value = data.cosmetics[key];
      if (typeof value === 'string' && cosmeticById(value)) {
        cosmetics[key] = value;
      }
    }
  }

  const ownedCosmetics = strArray(data.ownedCosmetics).filter((id) => !!cosmeticById(id));
  for (const id of Object.values(cosmetics)) {
    if (id && !ownedCosmetics.includes(id)) ownedCosmetics.push(id);
  }

  const spawnRaw = data.spawn;
  let spawn: Progress['spawn'] = null;
  if (isRecord(spawnRaw)) {
    spawn = {
      x: num(spawnRaw.x, 0, -500, 500),
      z: num(spawnRaw.z, 0, -500, 500),
      yaw: num(spawnRaw.yaw, 0, -Math.PI * 4, Math.PI * 4),
    };
  }

  const dayPhase =
    (['morning', 'noon', 'golden', 'blue', 'night'] as const).find((p) => p === data.dayPhase) ??
    'morning';
  const rawClock =
    typeof data.clockMinutes === 'number' && Number.isFinite(data.clockMinutes)
      ? normalizeMinutes(data.clockMinutes)
      : canonicalMinutesForPhase(dayPhase);

  const defeatedSet = new Set<number>();
  if (Array.isArray(data.blacklistDefeated)) {
    for (const r of data.blacklistDefeated) {
      if (typeof r === 'number' && Number.isFinite(r)) {
        const rk = Math.floor(r);
        if (rk >= 1 && rk <= 10) defeatedSet.add(rk);
      }
    }
  }
  const blacklistDefeated = [...defeatedSet].sort((a, b) => b - a);
  let derivedNext = 10;
  while (derivedNext >= 1 && defeatedSet.has(derivedNext)) {
    derivedNext -= 1;
  }
  const rawNext =
    typeof data.blacklistNextRank === 'number' && Number.isFinite(data.blacklistNextRank)
      ? Math.floor(clamp(data.blacklistNextRank, 0, 10))
      : derivedNext;
  const blacklistNextRank = Math.min(rawNext, derivedNext);

  const ridesCount = Math.max(0, Math.floor(num(data.rides, 0, 0, 1_000_000)));
  const defaultLegacyRep = typeof data.rep === 'number' ? 0 : ridesCount * 45;

  return {
    version: SAVE_VERSION,
    balance: Math.max(0, Math.floor(num(data.balance, def.balance, 0, 10_000_000))),
    rep: Math.max(0, Math.floor(num(data.rep, defaultLegacyRep, 0, 100_000_000))),
    ownedVehicles,
    selectedVehicle,
    upgrades,
    ownedCosmetics,
    cosmetics,
    condition: num(data.condition, def.condition, 5, 100),
    stamina: num(data.stamina, def.stamina, 0, 100),
    rides: ridesCount,
    totalEarned: Math.max(0, Math.floor(num(data.totalEarned, 0, 0, 1_000_000_000))),
    distanceTravelled: Math.max(0, num(data.distanceTravelled, 0, 0, 1e9)),
    achievements: strArray(data.achievements).slice(0, 64),
    tapes: strArray(data.tapes).filter((id) => TAPES.some((t) => t.id === id)),
    tutorialDone: data.tutorialDone === true,
    dailyDoneDate: typeof data.dailyDoneDate === 'string' ? data.dailyDoneDate.slice(0, 10) : '',
    lastMode: data.lastMode === 'free' || data.lastMode === 'daily' ? data.lastMode : 'duty',
    spawn,
    dayPhase,
    clockMinutes: rawClock,
    weather:
      (['sunny', 'overcast', 'rain', 'windy', 'storm'] as const).find((w) => w === data.weather) ?? 'sunny',
    scrapbook:
      typeof data.scrapbook === 'object' && data.scrapbook !== null ? data.scrapbook : { records: [] },
    blacklistNextRank,
    blacklistDefeated,
    blacklistIntroSeen: data.blacklistIntroSeen === true,
    blacklistTasks: [...new Set(strArray(data.blacklistTasks).filter((id) => /^(10|[1-9]):(race|fare|escape)$/.test(id)))].slice(0, 30),
    completedEvents: strArray(data.completedEvents).slice(0, 128),
    heat: num(data.heat, 0, 0, 5),
    createdAt: num(data.createdAt, now, 0, 9e15),
    updatedAt: num(data.updatedAt, now, 0, 9e15),
  };
}

export interface LoadResult {
  progress: Progress | null;
  recovered: boolean;
  error?: string;
}

export class SaveStore {
  private lastWrite = 0;
  private dirty = false;

  constructor(private storage: StorageLike | null) {}

  hasSave(): boolean {
    if (!this.storage) return false;
    try {
      return this.storage.getItem(SAVE_KEY) !== null;
    } catch {
      return false;
    }
  }

  load(now = Date.now()): LoadResult {
    if (!this.storage) return { progress: null, recovered: false };
    let rawText: string | null = null;
    try {
      rawText = this.storage.getItem(SAVE_KEY);
    } catch {
      return { progress: null, recovered: false, error: 'storage-unavailable' };
    }
    if (!rawText) return { progress: null, recovered: false };

    try {
      const parsed = JSON.parse(rawText);
      const migrated = migrateProgress(parsed);
      return { progress: sanitizeProgress(migrated, now), recovered: false };
    } catch (err) {
      // Corrupt main save: keep a copy so nothing is silently destroyed, then
      // try the backup written by the previous successful save.
      try {
        this.storage.setItem(`${SAVE_KEY}.corrupt.${now}`, rawText.slice(0, 20_000));
      } catch {
        /* best effort only */
      }
      try {
        const backup = this.storage.getItem(BACKUP_KEY);
        if (backup) {
          const parsed = JSON.parse(backup);
          return {
            progress: sanitizeProgress(migrateProgress(parsed), now),
            recovered: true,
            error: String(err),
          };
        }
      } catch {
        /* fall through */
      }
      return { progress: null, recovered: false, error: String(err) };
    }
  }

  /** Save immediately (call at safe points: mission end, garage exit, pause). */
  save(progress: Progress, now = Date.now()): boolean {
    if (!this.storage) return false;
    const payload: Progress = { ...progress, version: SAVE_VERSION, updatedAt: now };
    try {
      const previous = this.storage.getItem(SAVE_KEY);
      if (previous) this.storage.setItem(BACKUP_KEY, previous);
      this.storage.setItem(SAVE_KEY, JSON.stringify(payload));
      this.lastWrite = now;
      this.dirty = false;
      return true;
    } catch (err) {
      console.warn('[save] write failed', err);
      return false;
    }
  }

  /** Throttled autosave — at most once every `intervalMs` unless forced. */
  autosave(progress: Progress, now = Date.now(), intervalMs = 20_000): boolean {
    if (now - this.lastWrite < intervalMs) {
      this.dirty = true;
      return false;
    }
    return this.save(progress, now);
  }

  flush(progress: Progress, now = Date.now()): void {
    if (this.dirty) this.save(progress, now);
  }

  clear(): void {
    if (!this.storage) return;
    try {
      this.storage.removeItem(SAVE_KEY);
      this.storage.removeItem(BACKUP_KEY);
    } catch {
      /* ignore */
    }
  }
}
