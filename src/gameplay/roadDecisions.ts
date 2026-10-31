/** A detour is earned by actually driving a safe alternative, not selecting one
 * in the minimap. Session-only; offers and fares remain backward compatible. */
export class SafeDetourProgress {
  private distance = 0;
  private time = 0;
  private initialHits = 0;
  private armed = false;
  private failed = false;
  private paid = false;

  reset(): void {
    this.distance = this.time = this.initialHits = 0;
    this.armed = this.failed = this.paid = false;
  }
  arm(hits: number): void {
    if (this.armed || this.failed || this.paid) return;
    this.armed = true;
    this.initialHits = hits;
  }
  disqualify(): void { this.failed = true; }
  advance(dt: number, distance: number, hits: number, onSidewalk: boolean, validRoute: boolean): boolean {
    if (!this.armed || this.paid || this.failed || !validRoute) return false;
    if (onSidewalk || hits > this.initialHits) { this.failed = true; return false; }
    if (!Number.isFinite(dt) || !Number.isFinite(distance) || dt <= 0 || distance < 0) return false;
    const step = Math.min(dt, 0.1);
    this.time += step;
    this.distance += Math.min(20 * step, distance); // no teleport/debug-step farming
    if (this.time < 8 || this.distance < 35) return false;
    this.paid = true;
    return true;
  }
}

/** Contextual advisory only; a dangerous close pass never earns resources. */
export function isUnsafeClosePass(speed: number, distanceSq: number, vehicleHalfWidth: number, cooldown: number): boolean {
  return cooldown <= 0 && Number.isFinite(distanceSq) &&
    Math.abs(speed) >= 5.2 && distanceSq < (vehicleHalfWidth + 1.35) ** 2;
}

/** Existing fare fields, no price migration; protected flat bargains are unchanged. */
export function contextualCareBonus(goal: string | null, wet: boolean, mood: number, impacts: number, hardBrakes: number): number {
  if (goal !== 'rain' || !wet || mood < 75 || impacts > 0 || hardBrakes > 1) return 0;
  return 12;
}
