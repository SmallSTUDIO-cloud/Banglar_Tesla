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

import { isDrmcKeepClear, isInsideDrmcCampus } from '../world/drmcGeo';
import { ROAD_SEGMENTS } from '../world/layout';

export type DirectorEventKind =
  | 'market_slowdown'
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
  /** Explicit auto-weather preference; manual weather must never be overridden. */
  autoWeather?: boolean;
  /** Player forward unit vector, needed for visible roadside construction. */
  headingX?: number;
  headingZ?: number;
}

export interface SpawnedEvent {
  id: string;
  kind: DirectorEventKind;
  x: number;
  z: number;
  /** Public graph segment; event props must belong to this exact road. */
  segmentId?: string;
  createdAt: number;
  ttl: number;
  /** Cleanup hook provided by the game layer (roadblock pool, banners, etc.). */
  cleanup?: () => void;
}

export const MAX_CONCURRENT_EVENTS = 2;
export const MAJOR_COOLDOWN_S = 90; // quiet opening; optional events are not constant interruptions
export const MIN_ZONE_SPACING = 38;

// Authored road midpoints only. Do not place events at arbitrary polar offsets,
// dead ends, restricted gates, or unverified pedestrian-only shortcuts.
const EVENT_SITES = ROAD_SEGMENTS.filter((s) =>
  s.kind !== 'gali' && s.length >= 38 && !s.deadEnd &&
  !isDrmcKeepClear((s.ax + s.bx) / 2, (s.az + s.bz) / 2, 12),
).map((s) => ({ x: (s.ax + s.bx) / 2, z: (s.az + s.bz) / 2, segmentId: s.id, market: s.jamProne, width: s.width }));

export class EventDirector {
  private active: SpawnedEvent[] = [];
  private lastMajorAt = 0;
  private lastKindAt = new Map<DirectorEventKind, number>();
  private eventCounter = 0;

  /** Fired when the director wants the game layer to realize an event. */
  /** Returning false rejects a failed physical spawn without announcing it. */
  onSpawn?: (ev: SpawnedEvent) => unknown;
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
      // Illustrative game quiet-hours envelope, not a claim about real shop hours.
      { kind: 'market_slowdown', w: ctx.timeMinutes >= 6 * 60 && ctx.timeMinutes < 22 * 60
        ? (ctx.trafficDensity > 0.4 ? 1.1 : 0.55) : 0 },
      { kind: 'construction', w: ctx.headingX !== undefined && ctx.headingZ !== undefined &&
        ctx.timeMinutes >= 8 * 60 && ctx.timeMinutes < 17 * 60 && !ctx.raining && ctx.heat < 1 ? 0.3 : 0 },
      { kind: 'police_checkpoint', w: ctx.headingX !== undefined && ctx.headingZ !== undefined &&
        ctx.timeMinutes >= 7 * 60 && ctx.timeMinutes < 21 * 60 && ctx.heat >= 1 ? 0.22 : 0 },
      // Roadworks only where the pre-pooled barrier has a safe owned slot and
      // a forward, wide public-road site; never in wet or quiet-hour traffic.
      { kind: 'weather_shift', w: ctx.autoWeather === false || ctx.raining ? 0 : 0.55 },
      // Rare photo is not scheduled: no shutter or user photo action exists.
      // Preserve its type for old callers, but do not award a fake capture.
    ];
    let total = 0;
    for (const item of pool) {
      const last = this.lastKindAt.get(item.kind) ?? -999;
      if (item.w <= 0 || this.eventClock - last < 120) continue; // per-kind cooldown
      total += item.w;
    }
    if (total <= 0) return null;
    let r = rng() * total;
    for (const item of pool) {
      const last = this.lastKindAt.get(item.kind) ?? -999;
      if (item.w <= 0 || this.eventClock - last < 120) continue;
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
    if (!Number.isFinite(dt) || dt < 0) return null;
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
    const candidates = EVENT_SITES.filter((site) => {
      const dx = site.x - ctx.x, dz = site.z - ctx.z;
      const d = Math.hypot(dx, dz);
      return d >= (kind === 'construction' || kind === 'police_checkpoint' ? 50 : 32) && d <= 90 &&
        ((kind !== 'construction' && kind !== 'police_checkpoint') || (site.width >= 7.2 &&
          (dx * ctx.headingX! + dz * ctx.headingZ!) / d >= 0.38)) &&
        // A jam only belongs on a mixed-use connector, not a quiet housing lane.
        (kind !== 'market_slowdown' || site.market) &&
        this.active.every((ev) => Math.hypot(ev.x - site.x, ev.z - site.z) >= MIN_ZONE_SPACING);
    });
    if (!candidates.length) return null;
    const site = candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))];
    const { x, z } = site;
    for (const ev of this.active) {
      if (Math.hypot(ev.x - x, ev.z - z) < MIN_ZONE_SPACING) return null;
    }

    const ev: SpawnedEvent = {
      id: `ev${++this.eventCounter}:${kind}`,
      kind,
      x,
      z,
      segmentId: site.segmentId,
      createdAt: this.eventClock,
      ttl: kind === 'market_slowdown' ? 9 : 42 + rng() * 30,
    };
    this.active.push(ev);
    if (this.onSpawn?.(ev) === false) {
      this.active.pop();
      ev.cleanup?.();
      return null;
    }
    this.lastMajorAt = this.eventClock;
    this.lastKindAt.set(kind, this.eventClock);
    if (kind === 'weather_shift') this.onWeatherNudge?.(true);
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
