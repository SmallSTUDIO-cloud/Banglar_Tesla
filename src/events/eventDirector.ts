/**
 * Bounded random event director (Master Upgrade vNext §7).
 *
 * Coordinates Dhaka-life events by player location, time, weather, traffic
 * state, Heat and career: traffic accident/jam, broken/stalled vehicle,
 * construction, vendor blockage, police checkpoint, weather shift, rival
 * challenge, street challenge, and rare photo/stunt moments.
 *
 * Rules enforced here:
 *   - hard caps: ≤ 1 major event per `MAJOR_COOLDOWN_S`, ≤ 2 concurrent zones
 *   - never during active missions, races, road-rage, police pursuits, modals
 *   - guaranteed cleanup requests (`onCleanup`) for every zone the director made
 *   - never packs two zones within `MIN_ZONE_SPACING` metres
 *   - pure scheduling logic (no rendering) — unit-testable with injected rng
 */

import { isInsideDrmcCampus } from '../world/drmcGeo';

export type DirectorEventKind =
  | 'traffic_accident'
  | 'broken_vehicle'
  | 'construction'
  | 'vendor_blockage'
  | 'police_checkpoint'
  | 'weather_shift'
  | 'rival_challenge'
  | 'street_challenge'
  | 'rare_photo';

export interface EventContext {
  x: number;
  z: number;
  timeMinutes: number;
  heat: number;
  trafficDensity: number;
  raining: boolean;
  inMission: boolean;
  inRace: boolean;
  policeActive: boolean;
  roadRageActive: boolean;
  cinematicActive: boolean;
  paused: boolean;
  reduceEffects: boolean;
}

export interface SpawnedEvent {
  id: string;
  kind: DirectorEventKind;
  x: number;
  z: number;
  createdAt: number;
  ttl: number;
  /** Cleanup hook provided by the game layer (roadblock pool, banners, etc.). */
  cleanup?: () => void;
}

export const MAX_CONCURRENT_EVENTS = 2;
export const MAJOR_COOLDOWN_S = 46; // bounded; allows ≤2 concurrent zones with guaranteed spacing
export const MIN_ZONE_SPACING = 38;

export class EventDirector {
  private active: SpawnedEvent[] = [];
  private lastMajorAt = -999;
  private lastKindAt = new Map<DirectorEventKind, number>();
  private eventCounter = 0;

  /** Fired when the director wants the game layer to realize an event. */
  onSpawn?: (ev: SpawnedEvent) => void;
  /** Fired when an event's TTL ends (game must run its cleanup hook). */
  onDespawn?: (ev: SpawnedEvent) => void;
  /** The director nudges the weather system (never forces extreme states). */
  onWeatherNudge?: (suggestStorm: boolean) => void;

  get activeEvents(): readonly SpawnedEvent[] {
    return this.active;
  }

  get activeCount(): number {
    return this.active.length;
  }

  private pickKind(ctx: EventContext, rng: () => number): DirectorEventKind | null {
    const pool: Array<{ kind: DirectorEventKind; w: number }> = [
      { kind: 'broken_vehicle', w: 1.0 },
      { kind: 'traffic_accident', w: ctx.trafficDensity > 0.4 ? 1.1 : 0.4 },
      { kind: 'construction', w: 0.75 },
      { kind: 'vendor_blockage', w: 0.7 },
      { kind: 'police_checkpoint', w: ctx.heat >= 1 ? 0.55 : 0.22 },
      { kind: 'weather_shift', w: 0.6 },
      { kind: 'street_challenge', w: 0.65 },
      { kind: 'rare_photo', w: 0.16 },
    ];
    const now = performance.now?.() ?? Date.now();
    void now;
    let total = 0;
    for (const item of pool) {
      const last = this.lastKindAt.get(item.kind) ?? -999;
      if (this.eventClock - last < 28) continue; // per-kind cooldown
      total += item.w;
    }
    if (total <= 0) return null;
    let r = rng() * total;
    for (const item of pool) {
      const last = this.lastKindAt.get(item.kind) ?? -999;
      if (this.eventClock - last < 28) continue;
      r -= item.w;
      if (r <= 0) return item.kind;
    }
    return null;
  }

  private eventClock = 0;

  /**
   * Advance the director. Returns the newly spawned event (if any). The game
   * realizes it through `onSpawn` and MUST call `event.cleanup` (via `onDespawn`)
   * when the TTL expires — `update` guarantees the request happens exactly once.
   */
  update(dt: number, ctx: EventContext, rng: () => number = Math.random): SpawnedEvent | null {
    this.eventClock += dt;
    // TTL expiry with guaranteed cleanup requests
    for (let i = this.active.length - 1; i >= 0; i--) {
      const ev = this.active[i];
      if (this.eventClock - ev.createdAt >= ev.ttl) {
        this.active.splice(i, 1);
        ev.cleanup?.();
        this.onDespawn?.(ev);
      }
    }
    if (ctx.paused || isInsideDrmcCampus(ctx.x, ctx.z, 2)) return null;
    if (
      ctx.inMission ||
      ctx.inRace ||
      ctx.roadRageActive ||
      ctx.policeActive ||
      ctx.cinematicActive
    ) {
      return null;
    }
    if (this.active.length >= MAX_CONCURRENT_EVENTS) return null;
    if (this.eventClock - this.lastMajorAt < MAJOR_COOLDOWN_S) return null;
    if (rng() > 0.32) return null; // bounded frequency gate

    const kind = this.pickKind(ctx, rng);
    if (!kind) return null;

    // Keep zones apart — never pack multiple disasters into one tiny area
    const angle = rng() * Math.PI * 2;
    const radius = 26 + rng() * 42;
    const x = ctx.x + Math.sin(angle) * radius;
    const z = ctx.z + Math.cos(angle) * radius;
    if (isInsideDrmcCampus(x, z, 4)) return null;
    for (const ev of this.active) {
      if (Math.hypot(ev.x - x, ev.z - z) < MIN_ZONE_SPACING) return null;
    }

    const ev: SpawnedEvent = {
      id: `ev${++this.eventCounter}:${kind}`,
      kind,
      x,
      z,
      createdAt: this.eventClock,
      ttl: kind === 'rare_photo' ? 22 : 42 + rng() * 30,
    };
    this.active.push(ev);
    this.lastMajorAt = this.eventClock;
    this.lastKindAt.set(kind, this.eventClock);
    if (kind === 'weather_shift') {
      this.onWeatherNudge?.(ctx.raining ? false : rng() < 0.18);
    }
    this.onSpawn?.(ev);
    return ev;
  }

  /** Force-clean every active event (menu entry, mission start, race start). */
  clearAll(): void {
    for (const ev of this.active) {
      ev.cleanup?.();
      this.onDespawn?.(ev);
    }
    this.active = [];
  }
}
