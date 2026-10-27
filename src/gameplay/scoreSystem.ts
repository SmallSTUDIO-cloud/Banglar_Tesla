/**
 * Arcade stunt & combo scoring (Master Upgrade vNext §9).
 *
 * Fictional game mechanics — NOT real-world riding advice:
 *   - near-miss bonuses (existing traffic passes), controlled tilt/drift skill,
 *     sustained speed combos, impact/destruction combos.
 * - Bounded HUD feedback (dirty-checked string, no per-frame DOM writes),
 *   softlock-proof (never locks input), fast-recovery friendly.
 */

export type StuntKind = 'near_miss' | 'tilt_skill' | 'drift' | 'speed' | 'impact' | 'destruction';

export interface StuntEvent {
  kind: StuntKind;
  points: number;
  combo: number;
  labelBn: string;
  labelEn: string;
}

const BASE_POINTS: Record<StuntKind, number> = {
  near_miss: 12,
  tilt_skill: 18,
  drift: 15,
  speed: 10,
  impact: 8,
  destruction: 20,
};

const LABELS: Record<StuntKind, { bn: string; en: string }> = {
  near_miss: { bn: 'প্রায় ছুঁয়ে গেল!', en: 'Near miss!' },
  tilt_skill: { bn: 'দুর্দান্ত ব্যালেন্স!', en: 'Great balance!' },
  drift: { bn: 'দারুণ ড্রিফট!', en: 'Smooth drift!' },
  speed: { bn: 'গতির ধারা!', en: 'Speed streak!' },
  impact: { bn: 'শক্ত ধাক্কা!', en: 'Solid impact!' },
  destruction: { bn: 'ধ্বংসের ঝড়!', en: 'Destruction combo!' },
};

export class ScoreSystem {
  private combo = 0;
  private comboTimer = 0;
  private bestCombo = 0;
  private driftTimer = 0;
  private tiltTimer = 0;
  private speedTimer = 0;

  /** Fired exactly once per stunt (game shows a bounded HUD chip + optional voice). */
  onStunt?: (ev: StuntEvent) => void;
  /** Fired when a combo window lapses (optional HUD reset). */
  onComboEnd?: (bestCombo: number) => void;

  get currentCombo(): number {
    return this.combo;
  }

  get best(): number {
    return this.bestCombo;
  }

  /**
   * Per-frame sim input (bounded scalar work). `tilt` = |roll| 0..1 sustained
   * control, `drift` = |lateral| slip time, `speed` = m/s.
   */
  update(dt: number, opts: { tilt: number; lateral: number; speed: number }): void {
    if (dt <= 0) return;
    // Sustained controlled two-wheel tilt/lean (safe thresholds — stylized skill,
    // the physics never literally lifts two wheels off the ground).
    if (opts.tilt > 0.62 && opts.speed > 3.2) {
      this.tiltTimer += dt;
      if (this.tiltTimer > 1.15) {
        this.tiltTimer = -0.9; // re-arm window
        this.emit('tilt_skill');
      }
    } else {
      this.tiltTimer = Math.max(0, this.tiltTimer - dt * 0.85);
    }

    // Drift/turn-skill: sustained lateral slip at speed
    if (Math.abs(opts.lateral) > 2.6 && opts.speed > 4.0) {
      this.driftTimer += dt;
      if (this.driftTimer > 1.05) {
        this.driftTimer = -0.85;
        this.emit('drift');
      }
    } else {
      this.driftTimer = Math.max(0, this.driftTimer - dt);
    }

    // Speed combo: 6 sustained seconds above ~11.5 m/s (~41 km/h) — Turbo-friendly
    if (opts.speed > 11.5) {
      this.speedTimer += dt;
      if (this.speedTimer > 6) {
        this.speedTimer = 0;
        this.emit('speed');
      }
    } else {
      this.speedTimer = Math.max(0, this.speedTimer - dt * 0.6);
    }

    // Combo window decay
    if (this.combo > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.bestCombo = Math.max(this.bestCombo, this.combo);
        this.onComboEnd?.(this.bestCombo);
        this.combo = 0;
      }
    }
  }

  /** Near-miss / impact / destruction events from collision systems. */
  register(kind: StuntKind): void {
    this.emit(kind);
  }

  private emit(kind: StuntKind): void {
    this.combo++;
    this.comboTimer = 6.2; // combo chain window
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const multiplier = 1 + Math.min(2.5, (this.combo - 1) * 0.22);
    const pts = Math.round(BASE_POINTS[kind] * multiplier);
    this.onStunt?.({
      kind,
      points: pts,
      combo: this.combo,
      labelBn: LABELS[kind].bn,
      labelEn: LABELS[kind].en,
    });
  }

  reset(): void {
    this.combo = 0;
    this.comboTimer = 0;
    this.driftTimer = 0;
    this.tiltTimer = 0;
    this.speedTimer = 0;
  }
}
