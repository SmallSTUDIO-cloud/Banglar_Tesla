/**
 * Offline Bangla-First + Bilingual Speech & Dialogue Service (v0.5.0 — Sections 8 & 26.6).
 *
 * Strictly zero cloud API calls, zero API keys, 100% offline.
 * Enforces non-negotiable voice authenticity rules:
 *   1. Bangla script (`[\u0980-\u09FF]`) is NEVER sent to an English or non-`bn`
 *      TTS voice under any circumstance.
 *   2. In Bangla mode (`bn`):
 *        a) Native Android `TextToSpeech` ONLY if `window.__btAndroidTts.isBengaliAvailable()`
 *           verified an installed `bn-BD` -> `bn-IN` -> `bn` `Voice` without `notInstalled`.
 *        b) Browser `speechSynthesis` ONLY if an installed `SpeechSynthesisVoice` has
 *           strict `voice.lang` matching `/^bn([-_]|$)/i` (`bn-BD` -> `bn-IN` -> `bn`).
 *        c) Otherwise plays the bundled offline phonetic Bengali WAV clip
 *           (`public/audio/dialogue/*.wav` rendered via `libespeak-ng` `bn`).
 *   3. In English mode (`en`):
 *        a) Browser `speechSynthesis` verified `en-*` voice if available, else
 *        b) Bundled offline English WAV clip (`*-en.wav`).
 *   4. Priority queue (`priority` 1..3) prevents low-priority callouts from cutting
 *      off critical confrontation/story dialogue, while `AudioEngine.setDialogueDuck`
 *      ducks music, ambience, and low-priority traffic smoothly during speech.
 *   5. Exposes full DEV speech diagnostics (`getDiagnostics()`).
 */

import { clamp01 } from '../core/mathx';
import type { AudioEngine, DialogueClipRole } from './audio';

export interface AndroidTtsBridge {
  isBengaliAvailable(): boolean;
  speak(text: string, pitch: number, rate: number, volume: number): boolean;
  stop(): void;
}

declare global {
  interface Window {
    __btAndroidTts?: AndroidTtsBridge;
  }
}

export type SpeechBackend =
  | 'android-bn'
  | 'web-bn'
  | 'web-en'
  | 'bundled-fallback'
  | 'silent-muted';

export interface SpeakOptions {
  speaker: DialogueClipRole;
  text: string;
  locale?: 'bn' | 'en';
  /** Priority 1 (low callout) .. 3 (critical confrontation / cinematic). Default 2. */
  priority?: 1 | 2 | 3;
  volume: number;
  muted: boolean;
  onEnd?: () => void;
}

export interface SpeechDiagnostics {
  engine: SpeechBackend;
  selectedVoice: string;
  locale: string;
  languageMode: 'bn' | 'en';
  fallbackReason: string;
  dialoguePriority: number;
  measuredDialogueGain: number;
  duckingActive: boolean;
  spokenCount: number;
}

const BANGLA_SCRIPT_RE = /[\u0980-\u09FF]/;
const STRICT_BN_LANG_RE = /^bn([-_]|$)/i;
const STRICT_EN_LANG_RE = /^en([-_]|$)/i;

export function hasBanglaScript(text: string): boolean {
  return BANGLA_SCRIPT_RE.test(text);
}

export function isVerifiedBengaliVoice(voice: Pick<SpeechSynthesisVoice, 'lang' | 'name'> | null | undefined): boolean {
  if (!voice || typeof voice.lang !== 'string') return false;
  return STRICT_BN_LANG_RE.test(voice.lang.trim());
}

export class BanglaSpeechService {
  private webBnVoice: SpeechSynthesisVoice | null = null;
  private webEnVoice: SpeechSynthesisVoice | null = null;
  private voicesChecked = false;
  private activeTimer: number | null = null;
  private seqToken = 0;
  private isSpeaking = false;
  private activePriority = 0;

  private lastBackend: SpeechBackend = 'bundled-fallback';
  private lastSelectedVoice = 'libespeak-ng:bn';
  private lastLocale = 'bn-BD';
  private languageMode: 'bn' | 'en' = 'bn';
  private lastFallbackReason = 'initial';
  private totalSpoken = 0;
  private lastText = '';

  constructor(private audioEngine: AudioEngine) {
    this.initWebVoices();
  }

  setLanguageMode(mode: 'bn' | 'en'): void {
    this.languageMode = mode === 'en' ? 'en' : 'bn';
  }

  private initWebVoices(): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const refresh = (): void => {
      try {
        const voices = window.speechSynthesis.getVoices() ?? [];
        this.voicesChecked = true;
        // Strict `bn-*` check on `v.lang` ONLY — never trust `v.name` if `v.lang` is `en-*`!
        const bnVoices = voices.filter((v) => isVerifiedBengaliVoice(v));
        bnVoices.sort((a, b) => {
          const rank = (l: string) => (/bd/i.test(l) ? 0 : /in/i.test(l) ? 1 : 2);
          const diff = rank(a.lang) - rank(b.lang);
          if (diff !== 0) return diff;
          return (b.localService ? 1 : 0) - (a.localService ? 1 : 0);
        });
        this.webBnVoice = bnVoices[0] ?? null;

        const enVoices = voices.filter((v) => STRICT_EN_LANG_RE.test(v.lang ?? ''));
        enVoices.sort((a, b) => (b.localService ? 1 : 0) - (a.localService ? 1 : 0));
        this.webEnVoice = enVoices[0] ?? null;
      } catch {
        this.webBnVoice = null;
        this.webEnVoice = null;
      }
    };
    refresh();
    try {
      window.speechSynthesis.addEventListener?.('voiceschanged', refresh);
    } catch {
      /* older WebViews without EventTarget on speechSynthesis */
    }
  }

  /** Detect whether running inside the native Banglar Tesla Android APK shell. */
  isAndroidApp(): boolean {
    if (typeof window === 'undefined') return false;
    if (window.__btAndroidTts) return true;
    return window.location?.hostname === 'appassets.androidplatform.net';
  }

  /** Report which Bengali speech backend is currently available on this device/browser. */
  detectAvailableBackend(): 'android-bn' | 'web-bn' | 'bundled-fallback' {
    if (typeof window !== 'undefined' && window.__btAndroidTts) {
      try {
        if (window.__btAndroidTts.isBengaliAvailable()) return 'android-bn';
      } catch {
        /* bridge error -> fall through */
      }
    }
    if (!this.voicesChecked) this.initWebVoices();
    if (this.webBnVoice && isVerifiedBengaliVoice(this.webBnVoice)) return 'web-bn';
    return 'bundled-fallback';
  }

  get activeBackend(): SpeechBackend {
    return this.lastBackend;
  }

  get spokenCount(): number {
    return this.totalSpoken;
  }

  get lastSpokenText(): string {
    return this.lastText;
  }

  getDiagnostics(): SpeechDiagnostics {
    return {
      engine: this.lastBackend,
      selectedVoice: this.lastSelectedVoice,
      locale: this.lastLocale,
      languageMode: this.languageMode,
      fallbackReason: this.lastFallbackReason,
      dialoguePriority: this.activePriority,
      measuredDialogueGain: this.audioEngine.dialogueGainLevel,
      duckingActive: this.audioEngine.isDialogueDucking,
      spokenCount: this.totalSpoken,
    };
  }

  /**
   * Speak a Bangla or English dialogue line once (never per-frame) with priority
   * arbitration, multi-bus audio ducking, and deterministic completion callback.
   */
  speak(opts: SpeakOptions): SpeechBackend {
    const priority = opts.priority ?? 2;
    if (this.isSpeaking && priority < this.activePriority) {
      this.lastFallbackReason = 'suppressed-by-higher-priority';
      opts.onEnd?.();
      return this.lastBackend;
    }

    this.stop();
    const token = ++this.seqToken;
    this.totalSpoken++;
    this.lastText = opts.text;
    this.activePriority = priority;
    this.isSpeaking = true;

    const containsBn = hasBanglaScript(opts.text);
    // Hard safety rule: any string containing Bangla Unicode MUST use a Bangla route!
    const effectiveLocale: 'bn' | 'en' = containsBn
      ? 'bn'
      : (opts.locale ?? this.languageMode);
    const vol = clamp01(opts.volume);

    const markDone = (): void => {
      if (this.seqToken === token) {
        this.isSpeaking = false;
        this.activePriority = 0;
      }
    };

    if (opts.muted || vol <= 0.01) {
      this.lastBackend = 'silent-muted';
      this.lastSelectedVoice = 'none';
      this.lastLocale = effectiveLocale === 'bn' ? 'bn-BD' : 'en-US';
      this.lastFallbackReason = 'muted-or-zero-volume';
      if (opts.onEnd) {
        this.activeTimer = window.setTimeout(() => {
          if (this.seqToken === token) {
            markDone();
            opts.onEnd?.();
          }
        }, 1650);
      } else {
        markDone();
      }
      return 'silent-muted';
    }

    const pitch =
      opts.speaker === 'driver'
        ? 0.88
        : opts.speaker === 'rival'
          ? 0.92
          : opts.speaker === 'police'
            ? 0.95
            : 1.08;
    const rate = opts.speaker === 'player' ? 1.02 : 1.03;
    const estimatedMs =
      opts.speaker === 'rival'
        ? 3600
        : opts.speaker === 'police'
          ? 3100
          : opts.speaker === 'player'
            ? 2350
            : 1900;

    if (effectiveLocale === 'bn') {
      // 1. Verified Native Android TextToSpeech (`bn-BD` -> `bn-IN` -> `bn` installed Voice)
      if (typeof window !== 'undefined' && window.__btAndroidTts) {
        try {
          if (window.__btAndroidTts.isBengaliAvailable()) {
            const started = window.__btAndroidTts.speak(opts.text, pitch, rate, vol);
            if (started) {
              this.lastBackend = 'android-bn';
              this.lastSelectedVoice = 'android-tts:bn';
              this.lastLocale = 'bn-BD';
              this.lastFallbackReason = 'none';
              this.audioEngine.setDialogueDuck(true);
              this.activeTimer = window.setTimeout(() => {
                if (this.seqToken !== token) return;
                markDone();
                this.audioEngine.setDialogueDuck(false);
                opts.onEnd?.();
              }, estimatedMs);
              return 'android-bn';
            }
          }
        } catch {
          /* fall through cleanly */
        }
      }

      // 2. Browser SpeechSynthesis ONLY with a strictly verified `bn-*` voice
      if (!this.voicesChecked) this.initWebVoices();
      if (
        this.webBnVoice &&
        isVerifiedBengaliVoice(this.webBnVoice) &&
        typeof window !== 'undefined' &&
        'speechSynthesis' in window &&
        typeof SpeechSynthesisUtterance !== 'undefined'
      ) {
        try {
          window.speechSynthesis.cancel();
          const utter = new SpeechSynthesisUtterance(opts.text);
          utter.voice = this.webBnVoice;
          utter.lang = this.webBnVoice.lang || 'bn-BD';
          utter.pitch = pitch;
          utter.rate = rate;
          utter.volume = vol;
          let finished = false;
          const finish = (): void => {
            if (finished || this.seqToken !== token) return;
            finished = true;
            if (this.activeTimer !== null) {
              window.clearTimeout(this.activeTimer);
              this.activeTimer = null;
            }
            markDone();
            this.audioEngine.setDialogueDuck(false);
            opts.onEnd?.();
          };
          utter.onend = finish;
          utter.onerror = finish;
          this.audioEngine.setDialogueDuck(true);
          window.speechSynthesis.speak(utter);
          this.activeTimer = window.setTimeout(finish, estimatedMs + 950);
          this.lastBackend = 'web-bn';
          this.lastSelectedVoice = this.webBnVoice.name || 'web-speech:bn';
          this.lastLocale = this.webBnVoice.lang || 'bn-BD';
          this.lastFallbackReason = 'none';
          return 'web-bn';
        } catch {
          /* fall through to bundled Bengali WAV */
        }
      }

      // 3. Bundled offline phonetic Bengali WAV clip (`libespeak-ng` `bn` render)
      this.lastBackend = 'bundled-fallback';
      this.lastSelectedVoice = `bundled-wav:bn:${opts.speaker}`;
      this.lastLocale = 'bn-BD';
      this.lastFallbackReason = 'no-installed-native-or-browser-bn-voice';
      return this.playBundledClip(opts.speaker, 'bn', token, estimatedMs, markDone, opts.onEnd);
    }

    // English mode (`effectiveLocale === 'en'` and text has zero Bangla script)
    if (!this.voicesChecked) this.initWebVoices();
    if (
      this.webEnVoice &&
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      typeof SpeechSynthesisUtterance !== 'undefined'
    ) {
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(opts.text);
        utter.voice = this.webEnVoice;
        utter.lang = this.webEnVoice.lang || 'en-US';
        utter.pitch = pitch;
        utter.rate = rate;
        utter.volume = vol;
        let finished = false;
        const finish = (): void => {
          if (finished || this.seqToken !== token) return;
          finished = true;
          if (this.activeTimer !== null) {
            window.clearTimeout(this.activeTimer);
            this.activeTimer = null;
          }
          markDone();
          this.audioEngine.setDialogueDuck(false);
          opts.onEnd?.();
        };
        utter.onend = finish;
        utter.onerror = finish;
        this.audioEngine.setDialogueDuck(true);
        window.speechSynthesis.speak(utter);
        this.activeTimer = window.setTimeout(finish, estimatedMs + 950);
        this.lastBackend = 'web-en';
        this.lastSelectedVoice = this.webEnVoice.name || 'web-speech:en';
        this.lastLocale = this.webEnVoice.lang || 'en-US';
        this.lastFallbackReason = 'none';
        return 'web-en';
      } catch {
        /* fall through to bundled English WAV */
      }
    }

    this.lastBackend = 'bundled-fallback';
    this.lastSelectedVoice = `bundled-wav:en:${opts.speaker}`;
    this.lastLocale = 'en-US';
    this.lastFallbackReason = 'no-installed-browser-en-voice';
    return this.playBundledClip(opts.speaker, 'en', token, estimatedMs, markDone, opts.onEnd);
  }

  private playBundledClip(
    role: DialogueClipRole,
    locale: 'bn' | 'en',
    token: number,
    estimatedMs: number,
    markDone: () => void,
    onEnd?: () => void,
  ): SpeechBackend {
    let done = false;
    const finishFallback = (): void => {
      if (done || this.seqToken !== token) return;
      done = true;
      if (this.activeTimer !== null) {
        clearTimeout(this.activeTimer);
        this.activeTimer = null;
      }
      markDone();
      this.audioEngine.setDialogueDuck(false);
      onEnd?.();
    };
    const played =
      typeof this.audioEngine.playBundledDialogue === 'function'
        ? this.audioEngine.playBundledDialogue(role, locale, finishFallback)
        : (role === 'driver' || role === 'player') &&
            typeof this.audioEngine.playDialogueClip === 'function'
          ? this.audioEngine.playDialogueClip(role, finishFallback)
          : false;
    if (!played) {
      this.activeTimer = setTimeout(finishFallback, estimatedMs) as unknown as number;
    } else {
      this.activeTimer = setTimeout(finishFallback, estimatedMs + 1200) as unknown as number;
    }
    return 'bundled-fallback';
  }

  stop(): void {
    this.seqToken++;
    this.isSpeaking = false;
    this.activePriority = 0;
    if (this.activeTimer !== null) {
      clearTimeout(this.activeTimer);
      this.activeTimer = null;
    }
    if (typeof window !== 'undefined') {
      try {
        window.__btAndroidTts?.stop();
      } catch {
        /* ignore */
      }
      try {
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
    }
    this.audioEngine.stopDialogueClip();
  }
}
