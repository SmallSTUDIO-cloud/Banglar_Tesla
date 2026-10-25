/**
 * Dynamic Accelerated In-Game Time System (v0.5.0).
 *
 * Design invariants:
 *   - Uses an accelerated 24-hour Dhaka clock (`minutesOfDay` in [0, 1440)) rather
 *     than the device's real-world wall clock.
 *   - Default start time: 07:30 AM (450 minutes).
 *   - Default progression rate: 0.5 in-game minutes per real gameplay second
 *     (1 in-game minute every 2.0s; full 24h cycle = 48 minutes of active driving).
 *   - Pauses whenever gameplay is paused, in main menu, showroom, or blocking modals.
 *   - Formats identically as zero-padded 12-hour `07:30 AM` / `06:45 PM` in both
 *     Bangla (`bn`) and English (`en`) modes, and caches the formatted string per
 *     whole minute so HUD code performs zero per-frame DOM updates or string churn.
 *   - Synchronizes safely with `EnvironmentSystem` (`DayPhase`) and exposes an
 *     extensible hook registry for time-of-day events.
 */

import type { DayPhase } from '../core/config';
import type { Locale } from '../core/i18n';

export const MINUTES_PER_DAY = 1440;
export const DEFAULT_START_MINUTES = 7 * 60 + 30; // 07:30 AM
/** In-game minutes elapsed per 1.0 real second of unpaused driving. */
export const DEFAULT_MINUTES_PER_REAL_SECOND = 0.5;

export interface TimeEventRegistration {
  id: string;
  /** Minute of day [0..1439] at which this event triggers when crossed. */
  triggerMinute: number;
  callback: (minute: number, phase: DayPhase) => void;
}

/** Map a DayPhase to a representative starting clock minute for legacy saves or debugSetPhase. */
export function canonicalMinutesForPhase(phase: DayPhase): number {
  switch (phase) {
    case 'morning':
      return 7 * 60 + 30; // 07:30 AM
    case 'noon':
      return 12 * 60 + 30; // 12:30 PM
    case 'golden':
      return 16 * 60 + 45; // 04:45 PM
    case 'blue':
      return 18 * 60 + 25; // 06:25 PM
    case 'night':
      return 21 * 60 + 15; // 09:15 PM
  }
}

/** Map any minute of day [0, 1440) onto the safe existing EnvironmentSystem DayPhase. */
export function phaseForMinutes(rawMinutes: number): DayPhase {
  const m = normalizeMinutes(rawMinutes);
  if (m >= 330 && m < 630) return 'morning'; // 05:30 AM – 10:29 AM
  if (m >= 630 && m < 960) return 'noon'; // 10:30 AM – 03:59 PM
  if (m >= 960 && m < 1080) return 'golden'; // 04:00 PM – 05:59 PM
  if (m >= 1080 && m < 1170) return 'blue'; // 06:00 PM – 07:29 PM
  return 'night'; // 07:30 PM – 05:29 AM
}

export function normalizeMinutes(rawMinutes: number): number {
  if (!Number.isFinite(rawMinutes)) return DEFAULT_START_MINUTES;
  const mod = rawMinutes % MINUTES_PER_DAY;
  return mod < 0 ? mod + MINUTES_PER_DAY : mod;
}

/**
 * Format in-game minutes [0, 1440) as `07:30 AM` / `06:45 PM` in both Bangla
 * and English modes (zero-padded 2-digit hour 01..12 + 2-digit minute + AM/PM).
 */
export function formatGameClock(rawMinutes: number, _locale: Locale = 'bn'): string {
  const whole = Math.floor(normalizeMinutes(rawMinutes));
  const hour24 = Math.floor(whole / 60) % 24;
  const minute = whole % 60;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const hh = hour12 < 10 ? `0${hour12}` : String(hour12);
  const mm = minute < 10 ? `0${minute}` : String(minute);
  return `${hh}:${mm} ${period}`;
}

export class GameTimeSystem {
  private minutes: number;
  private ratePerSecond: number;
  private cachedWholeMinute = -1;
  private cachedFormatted = '07:30 AM';
  private currentPhase: DayPhase;
  private lastHour = -1;
  private events: TimeEventRegistration[] = [];

  onPhaseChange?: (phase: DayPhase, minutes: number) => void;
  onHourChange?: (hour24: number, phase: DayPhase) => void;

  constructor(
    initialMinutes = DEFAULT_START_MINUTES,
    ratePerSecond = DEFAULT_MINUTES_PER_REAL_SECOND,
  ) {
    this.minutes = normalizeMinutes(initialMinutes);
    this.ratePerSecond = Math.max(0, ratePerSecond);
    this.currentPhase = phaseForMinutes(this.minutes);
    this.syncCache();
  }

  get minutesOfDay(): number {
    return this.minutes;
  }

  get wholeMinute(): number {
    return this.cachedWholeMinute;
  }

  get formatted(): string {
    return this.cachedFormatted;
  }

  get phase(): DayPhase {
    return this.currentPhase;
  }

  get isNight(): boolean {
    return this.currentPhase === 'night' || this.currentPhase === 'blue';
  }

  setRate(minutesPerRealSecond: number): void {
    if (Number.isFinite(minutesPerRealSecond) && minutesPerRealSecond >= 0) {
      this.ratePerSecond = minutesPerRealSecond;
    }
  }

  /** Set exact time of day (e.g. on save load, mission/event sync, or debug phase). */
  setMinutes(minutes: number, silent = false): void {
    this.minutes = normalizeMinutes(minutes);
    const prevPhase = this.currentPhase;
    this.currentPhase = phaseForMinutes(this.minutes);
    this.syncCache();
    if (!silent && this.currentPhase !== prevPhase) {
      this.onPhaseChange?.(this.currentPhase, this.minutes);
    }
  }

  /** Set clock to match a requested DayPhase while keeping phase & clock synchronized. */
  syncToPhase(phase: DayPhase, silent = false): void {
    if (this.currentPhase === phase) return;
    this.setMinutes(canonicalMinutesForPhase(phase), silent);
  }

  registerEvent(ev: TimeEventRegistration): () => void {
    this.events.push(ev);
    return () => {
      const idx = this.events.indexOf(ev);
      if (idx >= 0) this.events.splice(idx, 1);
    };
  }

  /**
   * Advance the clock by `dt` real gameplay seconds.
   * Call ONLY when gameplay is actively unpaused.
   * Returns `true` ONLY when the displayed whole minute changed.
   */
  update(dt: number): boolean {
    if (dt <= 0 || this.ratePerSecond <= 0) return false;
    const prevMin = this.cachedWholeMinute;
    const prevRaw = this.minutes;
    const advance = dt * this.ratePerSecond;
    this.minutes = normalizeMinutes(prevRaw + advance);

    const changedMinute = Math.floor(this.minutes) !== prevMin;
    if (changedMinute) {
      this.syncCache();
      const nextPhase = phaseForMinutes(this.minutes);
      if (nextPhase !== this.currentPhase) {
        this.currentPhase = nextPhase;
        this.onPhaseChange?.(nextPhase, this.minutes);
      }
      const hr = Math.floor(this.cachedWholeMinute / 60);
      if (hr !== this.lastHour) {
        this.lastHour = hr;
        this.onHourChange?.(hr, this.currentPhase);
      }
      if (this.events.length > 0) {
        for (let i = 0; i < this.events.length; i++) {
          const ev = this.events[i];
          if (ev.triggerMinute === this.cachedWholeMinute) {
            ev.callback(this.cachedWholeMinute, this.currentPhase);
          }
        }
      }
    }
    return changedMinute;
  }

  private syncCache(): void {
    const whole = Math.floor(this.minutes);
    if (whole !== this.cachedWholeMinute) {
      this.cachedWholeMinute = whole;
      this.cachedFormatted = formatGameClock(whole);
      this.lastHour = Math.floor(whole / 60);
    }
  }
}
