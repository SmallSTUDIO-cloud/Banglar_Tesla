/**
 * Event-driven dynamic weather director (Master Upgrade vNext §4).
 *
 * Five states: Sunny, Overcast (Normal), Rainy, Windy, Thunderstorm.
 * - Bounded random transitions with clock-aware weights (sunny/overcast dominate
 *   daytime; rain/storm lean toward late afternoon/evening; storms are rare).
 * - Gradual: every change is announced as a *blend* (0..1 over ~14–26 s) so
 *   light, fog, rain and audio ramp — never an instant catastrophic scene swap.
 * - Coordinated: the game suppresses new storm/rain transitions during the final
 *   stretch of a race unless the event authored that weather, and passes
 *   reduced-motion/low-flash flags to the environment for lightning comfort.
 * - Pure simulation logic (no rendering/DOM) so unit tests can drive it.
 */

import type { WeatherKind } from '../core/config';

export interface WeatherContext {
  /** In-game minutes-of-day [0, 1440). */
  timeMinutes: number;
  /** True while an active race/rival event is running. */
  inRace: boolean;
  /** True inside the final ~35% of a race (protect critical finishes). */
  raceFinalStretch: boolean;
  /** Authored event weather overrides director freedom. */
  eventOverride: boolean;
  reduceEffects: boolean;
  lowFlash: boolean;
}

export interface WeatherBlend {
  /** 0 = clear sun, 1 = fully overcast/storm sky. */
  overcast: number;
  /** 0..1 wet road target. */
  wet: number;
  /** 0..1.35 wind strength (drives litter/canopy/awning sway + wind audio). */
  wind: number;
  /** 0..1 rain particle intensity. */
  rain: number;
  /** 0..1 lightning flash likelihood scaling (storm only). */
  lightning: number;
}

const HOLD_SECONDS: Record<WeatherKind, [number, number]> = {
  sunny: [110, 240],
  overcast: [90, 200],
  rain: [80, 170],
  windy: [80, 170],
  storm: [60, 120],
};

const TARGETS: Record<WeatherKind, WeatherBlend> = {
  sunny: { overcast: 0, wet: 0, wind: 0.15, rain: 0, lightning: 0 },
  overcast: { overcast: 0.55, wet: 0.12, wind: 0.38, rain: 0, lightning: 0 },
  rain: { overcast: 0.72, wet: 1, wind: 0.82, rain: 1, lightning: 0 },
  windy: { overcast: 0.18, wet: 0, wind: 1.0, rain: 0, lightning: 0 },
  storm: { overcast: 1, wet: 1, wind: 1.35, rain: 1, lightning: 1 },
};

/** Blend targets reachable from a state (bounded transition graph). */
const NEIGHBOURS: Record<WeatherKind, WeatherKind[]> = {
  sunny: ['overcast', 'windy'],
  overcast: ['sunny', 'rain', 'windy'],
  rain: ['overcast', 'storm', 'windy'],
  windy: ['sunny', 'overcast', 'storm'],
  storm: ['rain', 'windy'],
};

/** Instant blend target for a state (used by env preset jumps + director completion). */
export function targetBlendFor(weather: WeatherKind): WeatherBlend {
  return { ...TARGETS[weather] };
}

function damp(cur: number, target: number, rate: number, dt: number): number {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}

export class WeatherDirector {
  private current: WeatherKind;
  private holdTimer = 0;
  private blendTimer = 0;
  private transitioningTo: WeatherKind | null = null;
  private blendRate = 0.055; // ~1/e over 18s
  private lightningTimer = 4;
  private stormStrikeCount = 0;

  readonly blend: WeatherBlend;

  /** Fired the moment a NEW state becomes authoritative (after blend completes). */
  onWeatherChange?: (weather: WeatherKind) => void;
  /** Lightning bolt request: `intensity` 0..1, `flashAllowed` false under low-flash. */
  onLightning?: (intensity: number, flashAllowed: boolean) => void;

  constructor(
    initial: WeatherKind = 'sunny',
    private readonly rng: () => number = Math.random,
  ) {
    this.current = initial;
    this.blend = { ...TARGETS[initial] };
  }

  get weather(): WeatherKind {
    return this.current;
  }

  get isTransitioning(): boolean {
    return this.transitioningTo !== null;
  }

  /** Live blended weather parameters (overcast/wet/wind/rain/lightning). */
  get weatherBlend(): Readonly<WeatherBlend> {
    return this.blend;
  }

  private pickNext(ctx: WeatherContext): WeatherKind {
    const hour = ctx.timeMinutes / 60;
    const weights = new Map<WeatherKind, number>();
    for (const cand of NEIGHBOURS[this.current]) {
      let w = 1;
      if (cand === 'sunny') w += hour >= 6 && hour <= 16 ? 1.2 : 0.25;
      if (cand === 'overcast') w += 0.8;
      if (cand === 'windy') w += 0.45;
      if (cand === 'rain') w += hour >= 14 ? 0.9 : 0.3;
      if (cand === 'storm') {
        // Rare, and never forced onto a critical race finish.
        if (ctx.raceFinalStretch && !ctx.eventOverride) continue;
        w += hour >= 15 && hour <= 21 ? 0.22 : 0.06;
      }
      if (ctx.inRace && !ctx.eventOverride && (cand === 'storm' || cand === 'rain')) {
        w *= 0.35; // keep races readable unless authored
      }
      weights.set(cand, w);
    }
    let total = 0;
    for (const w of weights.values()) total += w;
    let r = this.rng() * total;
    for (const [cand, w] of weights) {
      r -= w;
      if (r <= 0) return cand;
    }
    return this.current;
  }

  /**
   * Advance the director. Returns true when the authoritative weather changed
   * (callers re-apply environment presets / audio mix at that exact moment).
   */
  update(dt: number, ctx: WeatherContext): boolean {
    if (dt <= 0) return false;
    let changed = false;

    if (this.transitioningTo) {
      const target = TARGETS[this.transitioningTo];
      this.blend.overcast = damp(this.blend.overcast, target.overcast, this.blendRate * 1.15, dt);
      this.blend.wet = damp(this.blend.wet, target.wet, this.blendRate * 0.8, dt);
      this.blend.wind = damp(this.blend.wind, target.wind, this.blendRate * 1.35, dt);
      this.blend.rain = damp(this.blend.rain, target.rain, this.blendRate * 1.25, dt);
      this.blend.lightning = damp(this.blend.lightning, target.lightning, this.blendRate, dt);
      this.blendTimer += dt;
      const d = Math.abs(this.blend.overcast - target.overcast) +
        Math.abs(this.blend.wet - target.wet) * 0.7 +
        Math.abs(this.blend.rain - target.rain);
      if (d < 0.025 || this.blendTimer > 30) {
        this.blend.overcast = target.overcast;
        this.blend.wet = target.wet;
        this.blend.wind = target.wind;
        this.blend.rain = target.rain;
        this.blend.lightning = target.lightning;
        this.current = this.transitioningTo;
        this.transitioningTo = null;
        const [lo, hi] = HOLD_SECONDS[this.current];
        this.holdTimer = lo + this.rng() * (hi - lo);
        this.onWeatherChange?.(this.current);
        changed = true;
      }
    } else {
      this.holdTimer -= dt;
      if (this.holdTimer <= 0 && !ctx.eventOverride) {
        const next = this.pickNext(ctx);
        if (next !== this.current) {
          this.transitioningTo = next;
          this.blendTimer = 0;
          this.blendRate = 0.045 + this.rng() * 0.02; // 14–26 s blends
        } else {
          const [lo, hi] = HOLD_SECONDS[this.current];
          this.holdTimer = lo + this.rng() * (hi - lo);
        }
      }
    }

    // Lightning scheduling (storm only) — bounded, reduced-flash aware.
    if (this.blend.lightning > 0.45) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 5 + this.rng() * 9;
        this.stormStrikeCount = Math.min(2, this.stormStrikeCount + 1);
        const intensity = 0.55 + this.rng() * 0.45;
        const flashAllowed = !ctx.lowFlash && !ctx.reduceEffects;
        this.onLightning?.(intensity, flashAllowed);
      }
    } else {
      this.stormStrikeCount = Math.max(0, this.stormStrikeCount - dt * 0.2);
    }

    return changed;
  }

  /** Force a state immediately (authored event weather / mission setup). */
  setWeatherImmediate(weather: WeatherKind): void {
    this.current = weather;
    this.transitioningTo = null;
    const target = TARGETS[weather];
    this.blend.overcast = target.overcast;
    this.blend.wet = target.wet;
    this.blend.wind = target.wind;
    this.blend.rain = target.rain;
    this.blend.lightning = target.lightning;
    const [lo, hi] = HOLD_SECONDS[weather];
    this.holdTimer = lo + this.rng() * (hi - lo);
    this.onWeatherChange?.(weather);
  }
}
