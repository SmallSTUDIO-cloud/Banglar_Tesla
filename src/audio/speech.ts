/**
 * Offline Bangla Dialogue & Speech Service (Milestone 2).
 *
 * Strictly zero cloud API calls, zero API keys, 100% offline.
 * Selects the best genuinely supported Bengali speech route at runtime:
 *   1. Native Android `android.speech.tts.TextToSpeech` (`bn-BD` / `bn-IN` / `bn`)
 *      exposed through `window.__btAndroidTts` in the Android WebView APK when
 *      the device reports Bengali language support.
 *   2. Standard Web `window.speechSynthesis` ONLY when a real Bengali voice
 *      (`voice.lang` matching `/^bn(-|_|$)/i`) is installed on the OS/browser.
 *   3. Bundled offline expressive vocal cadence clips (`public/audio/dialogue/*.wav`)
 *      paired with exact Bangla Unicode subtitles when no Bengali TTS voice exists.
 */

import { clamp01 } from '../core/mathx';
import type { AudioEngine } from './audio';

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

export type SpeechBackend = 'android-bn' | 'web-bn' | 'bundled-fallback' | 'silent-muted';

export interface SpeakOptions {
  speaker: 'driver' | 'player';
  text: string;
  volume: number;
  muted: boolean;
  onEnd?: () => void;
}

export class BanglaSpeechService {
  private webBnVoice: SpeechSynthesisVoice | null = null;
  private voicesChecked = false;
  private activeTimer: number | null = null;
  private seqToken = 0;
  private lastBackend: SpeechBackend = 'bundled-fallback';
  private totalSpoken = 0;
  private lastText = '';

  constructor(private audioEngine: AudioEngine) {
    this.initWebVoices();
  }

  private initWebVoices(): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const refresh = (): void => {
      try {
        const voices = window.speechSynthesis.getVoices() ?? [];
        this.voicesChecked = true;
        // Prefer bn-BD first, then bn-IN, then any bn* voice
        const bnVoices = voices.filter((v) => /^bn([-_]|$)/i.test(v.lang) || /bengali|bangla/i.test(v.name));
        bnVoices.sort((a, b) => {
          const aBD = /bd/i.test(a.lang) ? 0 : /in/i.test(a.lang) ? 1 : 2;
          const bBD = /bd/i.test(b.lang) ? 0 : /in/i.test(b.lang) ? 1 : 2;
          return aBD - bBD;
        });
        this.webBnVoice = bnVoices[0] ?? null;
      } catch {
        this.webBnVoice = null;
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

  /** Report which speech backend is currently available on this device/browser. */
  detectAvailableBackend(): 'android-bn' | 'web-bn' | 'bundled-fallback' {
    if (typeof window !== 'undefined' && window.__btAndroidTts) {
      try {
        if (window.__btAndroidTts.isBengaliAvailable()) return 'android-bn';
      } catch {
        /* bridge error -> fall through */
      }
    }
    if (!this.voicesChecked) this.initWebVoices();
    if (this.webBnVoice) return 'web-bn';
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

  /**
   * Speak a Bangla line once (never per-frame) with automatic music ducking
   * and deterministic completion callback.
   */
  speak(opts: SpeakOptions): SpeechBackend {
    this.stop();
    const token = ++this.seqToken;
    this.totalSpoken++;
    this.lastText = opts.text;
    const vol = clamp01(opts.volume);

    if (opts.muted || vol <= 0.01) {
      this.lastBackend = 'silent-muted';
      if (opts.onEnd) {
        this.activeTimer = window.setTimeout(() => {
          if (this.seqToken === token) opts.onEnd?.();
        }, 1750);
      }
      return 'silent-muted';
    }

    const pitch = opts.speaker === 'driver' ? 0.88 : 1.1;
    const rate = opts.speaker === 'driver' ? 1.04 : 1.02;
    const estimatedMs = opts.speaker === 'driver' ? 1850 : 2250;

    // 1. Native Android TextToSpeech (bn-BD / bn)
    if (typeof window !== 'undefined' && window.__btAndroidTts) {
      try {
        if (window.__btAndroidTts.isBengaliAvailable()) {
          const started = window.__btAndroidTts.speak(opts.text, pitch, rate, vol);
          if (started) {
            this.lastBackend = 'android-bn';
            this.audioEngine.setDialogueDuck(true);
            this.activeTimer = window.setTimeout(() => {
              if (this.seqToken !== token) return;
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

    // 2. Browser SpeechSynthesis with verified Bengali voice
    if (!this.voicesChecked) this.initWebVoices();
    if (
      this.webBnVoice &&
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
          this.audioEngine.setDialogueDuck(false);
          opts.onEnd?.();
        };
        utter.onend = finish;
        utter.onerror = finish;
        this.audioEngine.setDialogueDuck(true);
        window.speechSynthesis.speak(utter);
        // Safety timeout in case a mobile browser drops onend
        this.activeTimer = window.setTimeout(finish, estimatedMs + 900);
        this.lastBackend = 'web-bn';
        return 'web-bn';
      } catch {
        /* fall through to bundled clip */
      }
    }

    // 3. Bundled offline vocal cadence clip fallback
    this.lastBackend = 'bundled-fallback';
    let done = false;
    const finishFallback = (): void => {
      if (done || this.seqToken !== token) return;
      done = true;
      if (this.activeTimer !== null) {
        window.clearTimeout(this.activeTimer);
        this.activeTimer = null;
      }
      this.audioEngine.setDialogueDuck(false);
      opts.onEnd?.();
    };
    const played = this.audioEngine.playDialogueClip(opts.speaker, finishFallback);
    if (!played) {
      this.activeTimer = window.setTimeout(finishFallback, estimatedMs);
    } else {
      this.activeTimer = window.setTimeout(finishFallback, estimatedMs + 600);
    }
    return 'bundled-fallback';
  }

  stop(): void {
    this.seqToken++;
    if (this.activeTimer !== null) {
      window.clearTimeout(this.activeTimer);
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
