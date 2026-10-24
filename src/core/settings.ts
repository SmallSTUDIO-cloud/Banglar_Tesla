/**
 * Player settings: graphics, audio, controls, accessibility.
 * Persisted separately from progress so that a "new game" keeps preferences.
 */

import { CAMERA_MODES, type CameraMode, type QualityPreset } from './config';
import { clamp } from './mathx';
import type { Locale } from './i18n';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface Settings {
  language: Locale;
  quality: QualityPreset;
  renderScale: number;
  shadows: boolean;
  fpsTarget: 30 | 60;
  music: number;
  ambience: number;
  traffic: number;
  vehicle: number;
  dialogue: number;
  ui: number;
  muted: boolean;
  radioMode: 'both' | 'music' | 'street';
  steering: 'buttons' | 'wheel';
  handedness: 'right' | 'left';
  sensitivity: number;
  deadzone: number;
  cameraShake: boolean;
  haptics: boolean;
  textScale: number;
  hudScale: number;
  reduceEffects: boolean;
  subtitles: boolean;
  cameraMode: CameraMode;
  showPerformance: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  language: 'bn',
  quality: 'balanced',
  renderScale: 1,
  shadows: true,
  fpsTarget: 60,
  music: 0.62,
  ambience: 0.7,
  traffic: 0.6,
  vehicle: 0.75,
  dialogue: 0.85,
  ui: 0.7,
  muted: false,
  radioMode: 'both',
  steering: 'buttons',
  handedness: 'right',
  sensitivity: 0.9,
  deadzone: 0.12,
  cameraShake: true,
  haptics: true,
  textScale: 1,
  hudScale: 1,
  reduceEffects: false,
  subtitles: true,
  cameraMode: 'chase',
  showPerformance: false,
};

const SETTINGS_KEY = 'banglar-tesla.settings.v1';

type Listener = (s: Settings) => void;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isCameraMode(v: unknown): v is CameraMode {
  return typeof v === 'string' && (CAMERA_MODES as readonly string[]).includes(v);
}

/** Validate + coerce an untrusted object into Settings. */
export function sanitizeSettings(raw: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const out: Settings = { ...base };
  if (!isRecord(raw)) return out;
  const num = (key: keyof Settings, lo: number, hi: number, fallback: number): void => {
    const v = raw[key as string];
    if (typeof v === 'number' && Number.isFinite(v)) {
      (out[key] as number) = clamp(v, lo, hi);
    } else {
      (out[key] as number) = fallback;
    }
  };
  const bool = (key: keyof Settings, fallback: boolean): void => {
    const v = raw[key as string];
    (out[key] as boolean) = typeof v === 'boolean' ? v : fallback;
  };

  if (raw.language === 'bn' || raw.language === 'en') out.language = raw.language;
  if (raw.quality === 'low' || raw.quality === 'balanced' || raw.quality === 'high') {
    out.quality = raw.quality;
  }
  if (raw.radioMode === 'both' || raw.radioMode === 'music' || raw.radioMode === 'street') {
    out.radioMode = raw.radioMode;
  }
  if (raw.steering === 'buttons' || raw.steering === 'wheel') out.steering = raw.steering;
  if (raw.handedness === 'right' || raw.handedness === 'left') out.handedness = raw.handedness;
  if (isCameraMode(raw.cameraMode)) out.cameraMode = raw.cameraMode;
  if (raw.fpsTarget === 30 || raw.fpsTarget === 60) out.fpsTarget = raw.fpsTarget;

  num('renderScale', 0.6, 1.2, base.renderScale);
  num('music', 0, 1, base.music);
  num('ambience', 0, 1, base.ambience);
  num('traffic', 0, 1, base.traffic);
  num('vehicle', 0, 1, base.vehicle);
  num('dialogue', 0, 1, base.dialogue);
  num('ui', 0, 1, base.ui);
  num('sensitivity', 0.35, 1.8, base.sensitivity);
  num('deadzone', 0, 0.4, base.deadzone);
  num('textScale', 0.85, 1.4, base.textScale);
  num('hudScale', 0.8, 1.3, base.hudScale);

  bool('shadows', base.shadows);
  bool('muted', base.muted);
  bool('cameraShake', base.cameraShake);
  bool('haptics', base.haptics);
  bool('reduceEffects', base.reduceEffects);
  bool('subtitles', base.subtitles);
  bool('showPerformance', base.showPerformance);
  return out;
}

export class SettingsStore {
  private value: Settings;
  private listeners = new Set<Listener>();

  constructor(
    private storage: StorageLike | null,
    initial?: Partial<Settings>,
  ) {
    this.value = sanitizeSettings(this.loadRaw(), { ...DEFAULT_SETTINGS, ...initial });
  }

  private loadRaw(): unknown {
    if (!this.storage) return null;
    try {
      const text = this.storage.getItem(SETTINGS_KEY);
      if (!text) return null;
      return JSON.parse(text);
    } catch (err) {
      console.warn('[settings] could not read settings, using defaults', err);
      return null;
    }
  }

  get(): Readonly<Settings> {
    return this.value;
  }

  set(patch: Partial<Settings>): void {
    const next = sanitizeSettings({ ...this.value, ...patch }, this.value);
    const changed = (Object.keys(next) as (keyof Settings)[]).some((k) => next[k] !== this.value[k]);
    if (!changed) return;
    this.value = next;
    this.persist();
    for (const fn of [...this.listeners]) fn(this.value);
  }

  reset(): void {
    this.value = { ...DEFAULT_SETTINGS };
    this.persist();
    for (const fn of [...this.listeners]) fn(this.value);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(SETTINGS_KEY, JSON.stringify(this.value));
    } catch (err) {
      console.warn('[settings] could not persist settings', err);
    }
  }
}
