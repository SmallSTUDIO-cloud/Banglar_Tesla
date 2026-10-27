/**
 * Banglar Tesla Audio Engine (v0.4 — Bundled Dhaka Soundscape + WebAudio Synthesis).
 *
 * Architecture:
 *  - Loads real bundled offline RIFF PCM .wav assets from `public/audio/` using
 *    Vite `import.meta.env.BASE_URL` so paths work identically in Android APK
 *    (`assets/public/audio/...`), local dev/preview (`./audio/...`), and GitHub
 *    Pages (`/Banglar_Tesla/audio/...`).
 *  - Separates Master, Music, SFX, Ambience, Traffic, Vehicle, Dialogue, and UI
 *    gain buses with persisted Music/SFX/Mute/Calm-Ambience controls.
 *  - Handles browser/WebView autoplay unlock cleanly with an observable unlock
 *    state (`unlocked`, `onUnlockChange`) and full `visibilitychange` suspend/resume
 *    recovery (never stacking notes or leaking AudioBufferSourceNodes).
 *  - Enforces a strict active one-shot cap (`MAX_ONE_SHOTS = 8`) for Samsung
 *    Galaxy M21 CPU/mixer stability.
 */

import { clamp, clamp01 } from '../core/mathx';
import { PLACES } from '../world/layout';
import { dialogueLine, introStingForRival } from './dialogueManifest';

export interface VolumeState {
  master: number;
  music: number;
  sfx: number;
  ambience: number;
  traffic: number;
  vehicle: number;
  dialogue: number;
  ui: number;
  muted: boolean;
  musicEnabled: boolean;
  sfxEnabled: boolean;
  reduceNoisyAmbience: boolean;
}

export type MusicSceneMode = 'menu' | 'driving' | 'paused';
export type TapeId = 'cassette' | 'radio' | 'brishti';

export interface SpatialVendorSpot {
  x: number;
  z: number;
  kind: 'fuchka' | 'jhalmuri' | 'tea' | 'market';
  broken?: boolean;
}

type AssetKey =
  | 'musicMenu'
  | 'musicDrive'
  | 'musicBrishti'
  | 'ambStreet'
  | 'ambBazaar'
  | 'ambTea'
  | 'ambHawker1'
  | 'ambHawker2'
  | 'ambConstruction'
  | 'sfxChain'
  | 'sfxTan'
  | 'sfxLampCrash'
  | 'sfxStallCrash'
  | 'sfxTurboIgnite'
  | 'sfxTurboLoop'
  | 'sfxTurboRelease'
  | 'sfxCrashHeavy'
  | 'sfxPoliceSiren'
  | 'dlgDriver'
  | 'dlgDriverEn'
  | 'dlgPlayer'
  | 'dlgPlayerEn'
  | 'dlgRivalBn'
  | 'dlgRivalEn'
  | 'dlgPoliceBn'
  | 'dlgPoliceEn'
  | 'ambWind'
  | 'sfxThunder1'
  | 'sfxThunder2';

export type DialogueClipRole = 'driver' | 'player' | 'rival' | 'police';

const ASSET_PATHS: Record<AssetKey, string> = {
  musicMenu: 'audio/music/menu-dhaka-sondhya.wav',
  musicDrive: 'audio/music/drive-asad-groove.wav',
  musicBrishti: 'audio/music/drive-brishti-dusk.wav',
  ambStreet: 'audio/ambience/dhaka-street-bed.wav',
  ambBazaar: 'audio/ambience/bazaar-crowd-loop.wav',
  ambTea: 'audio/ambience/tea-stall-clink.wav',
  ambHawker1: 'audio/ambience/hawker-call-1.wav',
  ambHawker2: 'audio/ambience/hawker-call-2.wav',
  ambConstruction: 'audio/ambience/construction-tap.wav',
  sfxChain: 'audio/sfx/rickshaw-chain-loop.wav',
  sfxTan: 'audio/sfx/tan-boost.wav',
  sfxLampCrash: 'audio/sfx/lamp-crash.wav',
  sfxStallCrash: 'audio/sfx/stall-crash.wav',
  sfxTurboIgnite: 'audio/sfx/turbo-ignite.wav',
  sfxTurboLoop: 'audio/sfx/turbo-loop.wav',
  sfxTurboRelease: 'audio/sfx/turbo-release.wav',
  sfxCrashHeavy: 'audio/sfx/crash-heavy.wav',
  sfxPoliceSiren: 'audio/sfx/police-siren-loop.wav',
  dlgDriver: 'audio/dialogue/roadrage-driver-cue.wav',
  dlgDriverEn: 'audio/dialogue/roadrage-driver-en.wav',
  dlgPlayer: 'audio/dialogue/roadrage-player-cue.wav',
  dlgPlayerEn: 'audio/dialogue/roadrage-player-en.wav',
  dlgRivalBn: 'audio/dialogue/rival-taunt-bn.wav',
  dlgRivalEn: 'audio/dialogue/rival-taunt-en.wav',
  dlgPoliceBn: 'audio/dialogue/police-alert-bn.wav',
  dlgPoliceEn: 'audio/dialogue/police-alert-en.wav',
  ambWind: 'audio/ambience/wind-gust-loop.wav',
  sfxThunder1: 'audio/sfx/thunder-rumble-1.wav',
  sfxThunder2: 'audio/sfx/thunder-rumble-2.wav',
};

const CONSTRUCTION_SPOTS = [
  { x: -36, z: 44 },  // Salimullah Rd mid-rise site
  { x: 74, z: -52 },  // Shahjahan Rd site
] as const;

const MAX_ONE_SHOTS = 6;

function resolveAudioAssetUrl(relPath: string): string {
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const cleanRel = relPath.startsWith('/') ? relPath.slice(1) : relPath;
  return `${normalizedBase}${cleanRel}`;
}

interface LoopChannel {
  key: AssetKey;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain!: GainNode;
  private musicBus!: GainNode;
  private musicDuckGain!: GainNode;
  private ambienceBus!: GainNode;
  private ambienceDuckGain!: GainNode;
  private trafficBus!: GainNode;
  private trafficDuckGain!: GainNode;
  private vehicleBus!: GainNode;
  private dialogueBus!: GainNode;
  private uiBus!: GainNode;
  private noiseBuffer: AudioBuffer | null = null;

  private buffers = new Map<AssetKey, AudioBuffer>();
  private loadingPromise: Promise<void> | null = null;
  private assetsLoaded = false;

  // Music crossfade state
  private sceneMode: MusicSceneMode = 'menu';
  private currentTrack: TapeId = 'cassette';
  private activeMusic: LoopChannel | null = null;
  private fadingMusic: LoopChannel | null = null;
  private dialogueDucked = false;

  // Continuous ambience & vehicle loops
  private streetLoop: LoopChannel | null = null;
  private bazaarLoop: LoopChannel | null = null;
  private chainLoop: LoopChannel | null = null;
  private turboLoop: LoopChannel | null = null;
  private sirenLoop: LoopChannel | null = null;
  private turboAudioActive = false;
  private rainFilter: BiquadFilterNode | null = null;
  private rainGain: GainNode | null = null;
  private rainSource: AudioBufferSourceNode | null = null;
  private eMotorOsc: OscillatorNode | null = null;
  private eMotorGain: GainNode | null = null;

  // State parameters
  private speed = 0;
  private throttle = 0;
  private rainAmount = 0;
  private wetness = 0;
  private crowdAmount = 0.25;
  private bazaarProximity = 0;
  private electricMode = false;
  private tanBoostActive = false;

  // Spatial Dhaka street spots & non-spam cooldowns
  private vendorSpots: SpatialVendorSpot[] = [];
  private teaTimer = 2.4;
  private hawkerTimer = 4.2;
  private constructionTimer = 6.0;
  private crowTimer = 7.5;
  private pedShoutCooldown = 0;
  private hornBurstCooldown = 0;

  // Active node tracking for Galaxy M21 budget
  private activeOneShots = 0;
  private activeDialogueSource: AudioBufferSourceNode | null = null;
  private unlockListeners = new Set<(unlocked: boolean) => void>();
  private globalListenersBound = false;
  private suspendedByVisibility = false;

  private volumes: VolumeState = {
    master: 0.85,
    music: 0.62,
    sfx: 0.8,
    ambience: 0.7,
    traffic: 0.6,
    vehicle: 0.75,
    dialogue: 0.85,
    ui: 0.7,
    muted: false,
    musicEnabled: true,
    sfxEnabled: true,
    reduceNoisyAmbience: false,
  };

  constructor() {
    this.bindGlobalLifecycle();
  }

  get currentSceneMode(): MusicSceneMode {
    return this.sceneMode;
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  get unlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  get hasLoadedAssets(): boolean {
    return this.assetsLoaded;
  }

  get loadedAssetCount(): number {
    return this.buffers.size;
  }

  /** Total active WebAudio source nodes (loops + active one-shots) for profiling. */
  get activeSourceCount(): number {
    let loops = 0;
    if (this.activeMusic) loops++;
    if (this.fadingMusic) loops++;
    if (this.streetLoop) loops++;
    if (this.bazaarLoop) loops++;
    if (this.chainLoop) loops++;
    if (this.turboLoop) loops++;
    if (this.sirenLoop) loops++;
    if (this.rainSource) loops++;
    if (this.eMotorOsc) loops++;
    if (this.activeDialogueSource) loops++;
    return loops + this.activeOneShots;
  }

  get dialogueGainLevel(): number {
    if (!this.dialogueBus || this.volumes.muted || !this.volumes.sfxEnabled) return 0;
    return Number((this.dialogueBus.gain.value * this.volumes.master).toFixed(3));
  }

  get isDialogueDucking(): boolean {
    return this.dialogueDucked;
  }

  onUnlockChange(fn: (unlocked: boolean) => void): () => void {
    this.unlockListeners.add(fn);
    return () => this.unlockListeners.delete(fn);
  }

  private notifyUnlockState(): void {
    const isRun = this.unlocked;
    for (const fn of this.unlockListeners) fn(isRun);
  }

  private bindGlobalLifecycle(): void {
    if (this.globalListenersBound || typeof window === 'undefined' || typeof document === 'undefined') return;
    this.globalListenersBound = true;

    const unlockHandler = (): void => {
      void this.init();
    };
    window.addEventListener('pointerdown', unlockHandler, { capture: true, passive: true });
    window.addEventListener('touchstart', unlockHandler, { capture: true, passive: true });
    window.addEventListener('keydown', unlockHandler, { capture: true, passive: true });

    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) {
        if (this.ctx.state === 'running') {
          this.suspendedByVisibility = true;
          this.stopDialogueClip();
          this.stopIntroSting();
          if (this.windGain) this.windGain.gain.value = 0;
          void this.ctx.suspend().catch(() => {});
        }
      } else if (this.suspendedByVisibility) {
        this.suspendedByVisibility = false;
        if (!this.volumes.muted) {
          void this.ctx.resume().then(() => {
            this.syncBuses();
            this.syncMusicTrack();
            this.notifyUnlockState();
          }).catch(() => {});
        }
      }
    });
  }

  setVendorSpots(spots: SpatialVendorSpot[]): void {
    this.vendorSpots = spots;
  }

  /** Idempotent: creates/resumes AudioContext on user gesture and loads bundled WAVs. */
  async init(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return false;
      try {
        const ctx = new Ctor();
        this.ctx = ctx;
        ctx.addEventListener('statechange', () => {
          this.notifyUnlockState();
        });
        this.setupGraph(ctx);
      } catch (err) {
        console.warn('[audio] failed to construct AudioContext', err);
        this.ctx = null;
        return false;
      }
    }

    if (this.ctx.state === 'suspended' && (typeof document === 'undefined' || !document.hidden)) {
      try {
        await this.ctx.resume();
      } catch {
        /* still waiting for trusted user gesture */
      }
    }

    void this.ensureAssetsLoaded();
    this.syncBuses();
    this.syncMusicTrack();
    this.notifyUnlockState();
    return this.ctx.state === 'running';
  }

  private setupGraph(ctx: AudioContext): void {
    this.masterGain = ctx.createGain();
    this.masterGain.connect(ctx.destination);

    this.musicDuckGain = ctx.createGain();
    this.musicDuckGain.gain.value = 1;
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.musicDuckGain);
    this.musicDuckGain.connect(this.masterGain);

    this.ambienceDuckGain = ctx.createGain();
    this.ambienceDuckGain.gain.value = 1;
    this.ambienceBus = ctx.createGain();
    this.ambienceBus.connect(this.ambienceDuckGain);
    this.ambienceDuckGain.connect(this.masterGain);

    this.trafficDuckGain = ctx.createGain();
    this.trafficDuckGain.gain.value = 1;
    this.trafficBus = ctx.createGain();
    this.trafficBus.connect(this.trafficDuckGain);
    this.trafficDuckGain.connect(this.masterGain);

    this.vehicleBus = ctx.createGain();
    this.dialogueBus = ctx.createGain();
    this.uiBus = ctx.createGain();

    this.vehicleBus.connect(this.masterGain);
    // Gentle soft-knee vocal compressor on dialogueBus so voices stay loud & clip-free
    if (typeof ctx.createDynamicsCompressor === 'function') {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 16;
      comp.ratio.value = 3.5;
      comp.attack.value = 0.005;
      comp.release.value = 0.14;
      this.dialogueBus.connect(comp).connect(this.masterGain);
    } else {
      this.dialogueBus.connect(this.masterGain);
    }
    this.uiBus.connect(this.masterGain);

    this.noiseBuffer = this.makeNoise(ctx, 2.0);
    this.startProceduralContinuousBeds(ctx);
  }

  private makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      data[i] = clamp((b0 + b1 + b2 + white * 0.1848) * 0.16, -1, 1);
    }
    return buf;
  }

  private startProceduralContinuousBeds(ctx: AudioContext): void {
    if (!this.noiseBuffer) return;

    // Monsoon rain + wet tyre spray bed (0% gain when dry)
    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = this.noiseBuffer;
    rainSrc.loop = true;
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'bandpass';
    rainFilter.frequency.value = 1350;
    rainFilter.Q.value = 0.65;
    const rainGain = ctx.createGain();
    rainGain.gain.value = 0;
    rainSrc.connect(rainFilter).connect(rainGain).connect(this.ambienceBus);
    rainSrc.start();
    this.rainSource = rainSrc;
    this.rainFilter = rainFilter;
    this.rainGain = rainGain;

    // Subtle electric rickshaw BLDC traction inverter hum (0% gain on pedal rickshaws)
    const eOsc = ctx.createOscillator();
    eOsc.type = 'triangle';
    eOsc.frequency.value = 115;
    const eFilter = ctx.createBiquadFilter();
    eFilter.type = 'lowpass';
    eFilter.frequency.value = 520;
    const eGain = ctx.createGain();
    eGain.gain.value = 0;
    eOsc.connect(eFilter).connect(eGain).connect(this.vehicleBus);
    eOsc.start();
    this.eMotorOsc = eOsc;
    this.eMotorGain = eGain;
  }

  private async ensureAssetsLoaded(): Promise<void> {
    if (this.assetsLoaded || !this.ctx || typeof fetch !== 'function') return;
    if (this.loadingPromise) return this.loadingPromise;

    const ctx = this.ctx;
    this.loadingPromise = (async () => {
      const entries = Object.entries(ASSET_PATHS) as [AssetKey, string][];
      await Promise.all(
        entries.map(async ([key, rel]) => {
          if (this.buffers.has(key)) return;
          try {
            const res = await fetch(resolveAudioAssetUrl(rel));
            if (!res.ok) return;
            const arr = await res.arrayBuffer();
            const decoded = await ctx.decodeAudioData(arr.slice(0));
            this.buffers.set(key, decoded);
          } catch {
            /* graceful offline/unit-test fallback */
          }
        }),
      );
      this.assetsLoaded = this.buffers.size > 0;
      this.startBundledLoops();
      this.syncMusicTrack();
    })();
    return this.loadingPromise;
  }

  private startBundledLoops(): void {
    const ctx = this.ctx;
    if (!ctx) return;

    if (!this.streetLoop && this.buffers.has('ambStreet')) {
      this.streetLoop = this.createLoop('ambStreet', this.ambienceBus, 0.24);
    }
    if (!this.bazaarLoop && this.buffers.has('ambBazaar')) {
      this.bazaarLoop = this.createLoop('ambBazaar', this.ambienceBus, 0.0);
    }
    if (!this.chainLoop && this.buffers.has('sfxChain')) {
      this.chainLoop = this.createLoop('sfxChain', this.vehicleBus, 0.0);
    }
  }

  private createLoop(key: AssetKey, dest: AudioNode, initialGain: number): LoopChannel | null {
    const ctx = this.ctx;
    const buf = this.buffers.get(key);
    if (!ctx || !buf) return null;
    const source = ctx.createBufferSource();
    source.buffer = buf;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = initialGain;
    source.connect(gain).connect(dest);
    source.start();
    return { key, source, gain };
  }

  // --------------------------------------------------------- music & crossfade
  setSceneMode(mode: MusicSceneMode): void {
    if (this.sceneMode === mode) return;
    this.sceneMode = mode;
    if (mode !== 'driving') {
      this.stopTurboAudioImmediate();
      this.stopPoliceSirenImmediate();
    }
    this.syncBuses();
    this.syncMusicTrack();
  }

  setTrack(track: TapeId): void {
    if (this.currentTrack === track) return;
    this.currentTrack = track;
    this.syncMusicTrack();
  }

  setMusicEnabled(enabled: boolean): void {
    this.volumes.musicEnabled = enabled;
    this.syncBuses();
    this.syncMusicTrack();
  }

  setDialogueDuck(active: boolean): void {
    this.dialogueDucked = active;
    if (!this.ctx || !this.musicDuckGain) return;
    const now = this.ctx.currentTime;
    const musicTarget = active ? 0.2 : this.sceneMode === 'paused' ? 0.42 : 1.0;
    const ambTarget = active ? 0.25 : 1.0;
    const trafficTarget = active ? 0.28 : 1.0;
    this.musicDuckGain.gain.cancelScheduledValues(now);
    this.musicDuckGain.gain.setTargetAtTime(musicTarget, now, 0.08);
    if (this.ambienceDuckGain) {
      this.ambienceDuckGain.gain.cancelScheduledValues(now);
      this.ambienceDuckGain.gain.setTargetAtTime(ambTarget, now, 0.08);
    }
    if (this.trafficDuckGain) {
      this.trafficDuckGain.gain.cancelScheduledValues(now);
      this.trafficDuckGain.gain.setTargetAtTime(trafficTarget, now, 0.08);
    }
  }

  private desiredMusicAsset(): AssetKey | null {
    if (this.volumes.muted || !this.volumes.musicEnabled || this.volumes.music <= 0.005) {
      return null;
    }
    if (this.sceneMode === 'menu') return 'musicMenu';
    return this.currentTrack === 'brishti' ? 'musicBrishti' : 'musicDrive';
  }

  private syncMusicTrack(): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const desired = this.desiredMusicAsset();
    const now = ctx.currentTime;

    // Update pause/dialogue ducking envelope
    const duckTarget = this.dialogueDucked ? 0.24 : this.sceneMode === 'paused' ? 0.42 : 1.0;
    this.musicDuckGain.gain.setTargetAtTime(duckTarget, now, 0.1);

    if (!desired || !this.buffers.has(desired)) {
      if (this.activeMusic) {
        const prev = this.activeMusic;
        this.activeMusic = null;
        prev.gain.gain.setTargetAtTime(0, now, 0.12);
        window.setTimeout(() => {
          try {
            prev.source.stop();
            prev.source.disconnect();
            prev.gain.disconnect();
          } catch {
            /* already stopped */
          }
        }, 420);
      }
      return;
    }

    if (this.activeMusic && this.activeMusic.key === desired) {
      this.activeMusic.gain.gain.setTargetAtTime(0.76, now, 0.16);
      return;
    }

    // Crossfade previous music loop out cleanly
    if (this.fadingMusic) {
      try {
        this.fadingMusic.source.stop();
        this.fadingMusic.source.disconnect();
        this.fadingMusic.gain.disconnect();
      } catch {
        /* ignore */
      }
      this.fadingMusic = null;
    }
    if (this.activeMusic) {
      const outgoing = this.activeMusic;
      this.fadingMusic = outgoing;
      outgoing.gain.gain.cancelScheduledValues(now);
      outgoing.gain.gain.setTargetAtTime(0, now, 0.16);
      window.setTimeout(() => {
        if (this.fadingMusic === outgoing) this.fadingMusic = null;
        try {
          outgoing.source.stop();
          outgoing.source.disconnect();
          outgoing.gain.disconnect();
        } catch {
          /* ignore */
        }
      }, 650);
    }

    const incoming = this.createLoop(desired, this.musicBus, 0.001);
    if (incoming) {
      incoming.gain.gain.setValueAtTime(0.001, now);
      incoming.gain.gain.linearRampToValueAtTime(0.76, now + 0.45);
      this.activeMusic = incoming;
    }
  }

  // --------------------------------------------------------------- volume buses
  setVolumes(partial: Partial<VolumeState>): void {
    Object.assign(this.volumes, partial);
    this.syncBuses();
    this.syncMusicTrack();
  }

  private syncBuses(): void {
    if (!this.ctx) return;
    const v = this.volumes;
    const now = this.ctx.currentTime;
    const master = v.muted ? 0 : clamp01(v.master);
    const sfxMaster = v.sfxEnabled ? clamp01(v.sfx) : 0;
    const calmScale = v.reduceNoisyAmbience ? 0.42 : 1.0;
    const pausedAmbScale = this.sceneMode === 'paused' ? 0.15 : this.sceneMode === 'menu' ? 0.45 : 1.0;

    this.masterGain.gain.setTargetAtTime(master, now, 0.04);
    this.musicBus.gain.setTargetAtTime(v.musicEnabled ? clamp01(v.music) : 0, now, 0.06);
    this.ambienceBus.gain.setTargetAtTime(clamp01(v.ambience) * sfxMaster * calmScale * pausedAmbScale, now, 0.08);
    this.trafficBus.gain.setTargetAtTime(clamp01(v.traffic) * sfxMaster * calmScale * pausedAmbScale, now, 0.08);
    this.vehicleBus.gain.setTargetAtTime(
      clamp01(v.vehicle) * sfxMaster * (this.sceneMode === 'driving' ? 1 : 0),
      now,
      0.06,
    );
    this.dialogueBus.gain.setTargetAtTime(
      clamp(v.dialogue * 1.18, 0, 1.35) * (v.sfxEnabled ? 1 : 0),
      now,
      0.05,
    );
    this.uiBus.gain.setTargetAtTime(clamp01(v.ui) * sfxMaster, now, 0.04);
  }

  // ----------------------------------------------------- continuous modulation
  setElectricMode(electric: boolean): void {
    this.electricMode = electric;
  }

  setTanBoost(active: boolean): void {
    this.tanBoostActive = active;
  }

  setVehicleSpeed(speed: number, throttle: number): void {
    this.speed = Math.abs(speed);
    this.throttle = clamp01(throttle);
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const sNorm = clamp01(this.speed / 12.5);

    if (this.chainLoop) {
      if (this.electricMode || this.sceneMode !== 'driving') {
        this.chainLoop.gain.gain.setTargetAtTime(0, now, 0.08);
      } else {
        const boostFactor = this.tanBoostActive ? 1.32 : 1.0;
        const rate = clamp((0.68 + sNorm * 1.15 + this.throttle * 0.16) * boostFactor, 0.55, 2.25);
        const gain = this.speed < 0.18 ? 0 : clamp(0.08 + sNorm * 0.28 + this.throttle * 0.07, 0, 0.42);
        this.chainLoop.source.playbackRate.setTargetAtTime(rate, now, 0.07);
        this.chainLoop.gain.gain.setTargetAtTime(gain, now, 0.07);
      }
    }

    if (this.eMotorOsc && this.eMotorGain) {
      if (!this.electricMode || this.sceneMode !== 'driving' || this.speed < 0.12) {
        this.eMotorGain.gain.setTargetAtTime(0, now, 0.08);
      } else {
        const freq = 95 + this.speed * (this.tanBoostActive ? 29 : 23) + this.throttle * 26;
        const gain = clamp(0.025 + sNorm * 0.075 + (this.tanBoostActive ? 0.025 : 0), 0, 0.13);
        this.eMotorOsc.frequency.setTargetAtTime(freq, now, 0.06);
        this.eMotorGain.gain.setTargetAtTime(gain, now, 0.07);
      }
    }
  }

  setRain(amount: number, wetness = amount): void {
    this.rainAmount = clamp01(amount);
    this.wetness = clamp01(wetness);
    if (!this.ctx || !this.rainGain || !this.rainFilter) return;
    const now = this.ctx.currentTime;
    const wetTyreHiss = this.sceneMode === 'driving' ? clamp01(this.speed / 9) * this.wetness * 0.09 : 0;
    this.rainGain.gain.setTargetAtTime(this.rainAmount * 0.24 + wetTyreHiss, now, 0.25);
    this.rainFilter.frequency.setTargetAtTime(1250 + this.speed * 55 * this.wetness, now, 0.2);
  }

  setCrowd(amount: number): void {
    this.crowdAmount = clamp01(amount);
  }

  /** Spatial Dhaka ambience tick — updates zone loops & triggers distance-attenuated street life. */
  update(dt: number, playerX = 0, playerZ = 0): void {
    this.pedShoutCooldown = Math.max(0, this.pedShoutCooldown - dt);
    this.hornBurstCooldown = Math.max(0, this.hornBurstCooldown - dt);
    if (!this.ctx || this.ctx.state !== 'running' || this.volumes.muted) return;

    const now = this.ctx.currentTime;

    // 1. Compute proximity to lively Dhaka hubs (Town Hall Bazaar, Bus Stand, Shia Mosque)
    let bestHubDist = 999;
    for (let i = 0; i < PLACES.length; i++) {
      const p = PLACES[i];
      if (p.id === 'bazaar' || p.id === 'stand' || p.id === 'shia') {
        const d = Math.hypot(p.x - playerX, p.z - playerZ);
        if (d < bestHubDist) bestHubDist = d;
      }
    }
    const hubFactor = clamp01(1 - (bestHubDist - 12) / 68);
    this.bazaarProximity = clamp01(Math.max(hubFactor, this.crowdAmount * 0.72));

    if (this.streetLoop) {
      const targetStreet = this.sceneMode === 'menu' ? 0.16 : 0.22 + this.crowdAmount * 0.1;
      this.streetLoop.gain.gain.setTargetAtTime(targetStreet, now, 0.25);
    }
    if (this.bazaarLoop) {
      const targetBazaar = this.sceneMode === 'driving' ? this.bazaarProximity * 0.34 : 0.06;
      this.bazaarLoop.gain.gain.setTargetAtTime(targetBazaar, now, 0.3);
    }

    if (this.sceneMode !== 'driving' || this.volumes.reduceNoisyAmbience) return;

    // 2. Nearby roadside tea stall clinks & kettle hiss
    this.teaTimer -= dt;
    if (this.teaTimer <= 0) {
      this.teaTimer = 4.2 + Math.random() * 5.2;
      const spot = this.nearestVendor(playerX, playerZ, 'tea', 24);
      if (spot) {
        this.playSpatialBuffer('ambTea', this.ambienceBus, spot.dx, spot.dist, 24, 0.36, 0.96 + Math.random() * 0.08);
      }
    }

    // 3. Nearby street hawkers (fuchka bell / jhalmuri tin shake)
    this.hawkerTimer -= dt;
    if (this.hawkerTimer <= 0) {
      this.hawkerTimer = 5.5 + Math.random() * 6.5;
      const fuchka = this.nearestVendor(playerX, playerZ, 'fuchka', 28);
      const jhal = this.nearestVendor(playerX, playerZ, 'jhalmuri', 28);
      if (fuchka && (!jhal || fuchka.dist <= jhal.dist)) {
        this.playSpatialBuffer('ambHawker1', this.ambienceBus, fuchka.dx, fuchka.dist, 28, 0.34, 0.97 + Math.random() * 0.06);
      } else if (jhal) {
        this.playSpatialBuffer('ambHawker2', this.ambienceBus, jhal.dx, jhal.dist, 28, 0.32, 0.96 + Math.random() * 0.08);
      }
    }

    // 4. Localized Mohammadpur construction tap
    this.constructionTimer -= dt;
    if (this.constructionTimer <= 0) {
      this.constructionTimer = 6.5 + Math.random() * 7.5;
      for (let i = 0; i < CONSTRUCTION_SPOTS.length; i++) {
        const c = CONSTRUCTION_SPOTS[i];
        const dx = c.x - playerX;
        const dz = c.z - playerZ;
        const dist = Math.hypot(dx, dz);
        if (dist < 44) {
          this.playSpatialBuffer('ambConstruction', this.ambienceBus, dx, dist, 44, 0.28, 0.95 + Math.random() * 0.1);
          break;
        }
      }
    }

    // 5. Occasional Dhaka crow overhead when dry
    this.crowTimer -= dt;
    if (this.crowTimer <= 0 && this.rainAmount < 0.5) {
      this.crowTimer = 9 + Math.random() * 12;
      this.crow();
    }
  }

  private nearestVendor(
    px: number,
    pz: number,
    kind: SpatialVendorSpot['kind'],
    maxDist: number,
  ): { dx: number; dist: number } | null {
    let bestDist = maxDist;
    let bestDx = 0;
    let found = false;
    for (let i = 0; i < this.vendorSpots.length; i++) {
      const s = this.vendorSpots[i];
      if (s.broken || s.kind !== kind) continue;
      const dx = s.x - px;
      const dz = s.z - pz;
      const d = Math.hypot(dx, dz);
      if (d < bestDist) {
        bestDist = d;
        bestDx = dx;
        found = true;
      }
    }
    return found ? { dx: bestDx, dist: bestDist } : null;
  }

  private playOneShotBuffer(
    key: AssetKey,
    dest: AudioNode,
    gainValue: number,
    rate = 1,
    pan = 0,
  ): boolean {
    if (!this.ctx || this.ctx.state !== 'running' || this.volumes.muted || !this.volumes.sfxEnabled) return false;
    if (this.activeOneShots >= MAX_ONE_SHOTS || this.activeSourceCount >= 13) return false;
    const buf = this.buffers.get(key);
    if (!buf) return false;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = clamp(gainValue, 0, 1.2);

    if (pan !== 0 && typeof this.ctx.createStereoPanner === 'function') {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = clamp(pan, -0.85, 0.85);
      src.connect(g).connect(panner).connect(dest);
    } else {
      src.connect(g).connect(dest);
    }

    this.activeOneShots++;
    src.onended = () => {
      this.activeOneShots = Math.max(0, this.activeOneShots - 1);
      try {
        src.disconnect();
        g.disconnect();
      } catch {
        /* ignore */
      }
    };
    src.start();
    return true;
  }

  private playSpatialBuffer(
    key: AssetKey,
    dest: AudioNode,
    dx: number,
    dist: number,
    maxDist: number,
    baseGain: number,
    rate = 1,
  ): void {
    const atten = clamp01(1 - dist / maxDist);
    if (atten <= 0.04) return;
    this.playOneShotBuffer(key, dest, baseGain * atten * atten, rate, clamp(dx / 18, -0.75, 0.75));
  }

  // ------------------------------------------------------------- one-shot SFX
  bell(variant: string = 'classic'): void {
    if (!this.ctx || this.volumes.muted || !this.volumes.sfxEnabled) return;
    if (this.activeOneShots >= MAX_ONE_SHOTS) return;
    const now = this.ctx.currentTime;
    const base = variant === 'brass' ? 1480 : 1760;
    const ringOnce = (t0: number, amp: number): void => {
      const partials = [1, 2.72, 4.18];
      for (let i = 0; i < partials.length; i++) {
        const osc = this.ctx!.createOscillator();
        const g = this.ctx!.createGain();
        osc.type = 'sine';
        osc.frequency.value = base * partials[i];
        const peak = (amp / (i * 1.4 + 1)) * 0.24;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(peak, t0 + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.52 / (i * 0.55 + 1));
        osc.connect(g).connect(this.vehicleBus);
        osc.start(t0);
        osc.stop(t0 + 0.56);
      }
    };
    this.trackSynthOneShot(0.6);
    ringOnce(now, 1);
    if (variant === 'double') ringOnce(now + 0.11, 0.85);
    else ringOnce(now + 0.085, 0.55);
  }

  playTanBoost(): void {
    if (this.activeOneShots >= MAX_ONE_SHOTS) return;
    if (this.playOneShotBuffer('sfxTan', this.vehicleBus, 0.62, 1.0)) return;
    if (!this.ctx || this.volumes.muted || !this.volumes.sfxEnabled) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(210, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.28);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.18, now + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    osc.connect(g).connect(this.vehicleBus);
    osc.start(now);
    osc.stop(now + 0.36);
    this.trackSynthOneShot(0.36);
  }

  playTeaSip(): void {
    if (this.playOneShotBuffer('ambTea', this.uiBus, 0.72, 1.02)) return;
    this.uiConfirm();
  }

  teaClink(): void {
    this.playTeaSip();
  }

  successStinger(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    for (let i = 0; i < notes.length; i++) {
      this.uiTone(notes[i], 0.22, 0.12, i * 0.075);
    }
  }

  failStinger(): void {
    const notes = [392.0, 349.23, 311.13];
    for (let i = 0; i < notes.length; i++) {
      this.uiTone(notes[i], 0.24, 0.12, i * 0.095);
    }
  }

  playBreakableCrash(kind: 'lamp' | 'stall'): void {
    if (this.activeOneShots >= MAX_ONE_SHOTS) return;
    const key: AssetKey = kind === 'lamp' ? 'sfxLampCrash' : 'sfxStallCrash';
    if (this.playOneShotBuffer(key, this.vehicleBus, 0.78, 0.94 + Math.random() * 0.12)) return;
    this.bump(1.6);
  }

  playRoadRageAlert(): void {
    if (!this.ctx || this.volumes.muted || !this.volumes.sfxEnabled) return;
    if (this.activeOneShots >= MAX_ONE_SHOTS) return;
    const now = this.ctx.currentTime;
    // Urgent angry car dual-tone horn blast!
    for (const freq of [392, 494]) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now);
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1450;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.16, now + 0.02);
      g.gain.setValueAtTime(0.15, now + 0.36);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
      osc.connect(lp).connect(g).connect(this.trafficBus);
      osc.start(now);
      osc.stop(now + 0.5);
    }
    this.trackSynthOneShot(0.5);
  }

  playScuffle(): void {
    if (!this.ctx || this.volumes.muted || !this.volumes.sfxEnabled) return;
    if (this.activeOneShots >= MAX_ONE_SHOTS) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const t0 = now + i * 0.24;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(155 - i * 18, t0);
      osc.frequency.exponentialRampToValueAtTime(48, t0 + 0.15);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.24, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      osc.connect(g).connect(this.vehicleBus);
      osc.start(t0);
      osc.stop(t0 + 0.2);
    }
    this.trackSynthOneShot(0.75);
  }

  /** Layered hold-to-boost `টার্বো` ignition, sustained flame rush loop, and release blow-off. */
  setTurboBoostAudio(active: boolean, blend = 1, playReleaseCue = true): void {
    if (!this.ctx || this.volumes.muted || !this.volumes.sfxEnabled || this.sceneMode !== 'driving') {
      this.stopTurboAudioImmediate();
      return;
    }
    const now = this.ctx.currentTime;
    if (active) {
      if (!this.turboAudioActive) {
        this.turboAudioActive = true;
        this.playOneShotBuffer('sfxTurboIgnite', this.vehicleBus, 0.72, 1.0);
        if (!this.turboLoop && this.buffers.has('sfxTurboLoop')) {
          this.turboLoop = this.createLoop('sfxTurboLoop', this.vehicleBus, 0.01);
        }
      }
      if (this.turboLoop) {
        this.turboLoop.gain.gain.setTargetAtTime(0.46 * clamp01(0.35 + blend * 0.65), now, 0.05);
        this.turboLoop.source.playbackRate.setTargetAtTime(0.96 + blend * 0.28, now, 0.06);
      }
    } else if (this.turboAudioActive) {
      this.turboAudioActive = false;
      this.stopTurboAudioImmediate();
      if (playReleaseCue) {
        this.playOneShotBuffer('sfxTurboRelease', this.vehicleBus, 0.56, 1.0);
      }
    }
  }

  stopTurboAudioImmediate(): void {
    this.turboAudioActive = false;
    if (this.turboLoop) {
      const lp = this.turboLoop;
      this.turboLoop = null;
      try {
        lp.source.stop();
        lp.source.disconnect();
        lp.gain.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  /** Continuous distance- & heat-scaled Police Patrol Siren loop; stops cleanly on escape/pause. */
  setPoliceSirenAudio(active: boolean, proximity01: number, heat: number): void {
    if (!active || !this.ctx || this.volumes.muted || !this.volumes.sfxEnabled || this.sceneMode !== 'driving') {
      this.stopPoliceSirenImmediate();
      return;
    }
    if (!this.sirenLoop && this.buffers.has('sfxPoliceSiren')) {
      this.sirenLoop = this.createLoop('sfxPoliceSiren', this.trafficBus, 0.001);
    }
    if (this.sirenLoop) {
      const now = this.ctx.currentTime;
      const gain = clamp(0.08 + proximity01 * 0.34 + heat * 0.025, 0, 0.48);
      const rate = clamp(0.96 + heat * 0.045 + proximity01 * 0.06, 0.92, 1.26);
      this.sirenLoop.gain.gain.setTargetAtTime(gain, now, 0.1);
      this.sirenLoop.source.playbackRate.setTargetAtTime(rate, now, 0.12);
    }
  }

  stopPoliceSirenImmediate(): void {
    if (this.sirenLoop) {
      const lp = this.sirenLoop;
      this.sirenLoop = null;
      try {
        lp.source.stop();
        lp.source.disconnect();
        lp.gain.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  playArcadeCrash(tier: 'minor' | 'medium' | 'major', intensity: number): void {
    if (tier === 'minor') {
      this.bump(clamp(intensity, 0.4, 1.2));
      return;
    }
    const rate = tier === 'major' ? 0.92 + Math.random() * 0.1 : 1.04 + Math.random() * 0.1;
    const gain = tier === 'major' ? 0.88 : 0.62;
    if (!this.playOneShotBuffer('sfxCrashHeavy', this.vehicleBus, gain, rate)) {
      this.bump(tier === 'major' ? 2.1 : 1.45);
    }
  }

  // ------------------------------------------------------------------
  // Weather audio (Master Upgrade vNext §4): bounded wind loop + thunder rolls
  // ------------------------------------------------------------------

  private windSource: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;

  /**
   * Seamlessly loop the bundled wind bed at a strength in 0..1.35.
   * Reuses ONE source (created once) — never spawns per-frame, never leaks.
   */
  setWindAudio(strength: number): void {
    const target = clamp(strength, 0, 1.35) * 0.5;
    if (!this.ctx || this.ctx.state !== 'running' || this.volumes.muted || this.volumes.ambience <= 0.01) {
      if (this.windGain && this.ctx) {
        this.windGain.gain.value = 0;
      }
      return;
    }
    if (!this.windSource) {
      const buf = this.buffers.get('ambWind');
      if (!buf) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      src.connect(g).connect(this.ambienceBus);
      src.start();
      this.windSource = src;
      this.windGain = g;
    }
    if (this.windGain) {
      this.windGain.gain.value = target;
    }
  }

  /**
   * Thunder roll one-shot with a plausible distance delay (seconds) + gain.
   * Uses one of two pooled rumbles; respects one-shot caps and mute state.
   */
  playThunder(distanceSec: number, intensity: number): void {
    const delay = clamp(distanceSec, 0, 8);
    window.setTimeout(() => {
      const variant = Math.random() < 0.5 ? 'sfxThunder1' : 'sfxThunder2';
      this.playOneShotBuffer(variant, this.ambienceBus, clamp(intensity, 0.2, 1) * 0.9, 0.92 + Math.random() * 0.16);
    }, delay * 1000);
  }

  // ------------------------------------------------------------------
  // Manifest dialogue lines (Master Upgrade vNext §3)
  // Lazy bounded LRU of decoded per-line clips; never touches the boot gate.
  // ------------------------------------------------------------------

  private static readonly LINE_CACHE_CAP = 14;
  private readonly lineBuffers = new Map<string, AudioBuffer>();
  private readonly lineLoading = new Map<string, Promise<AudioBuffer | null>>();
  private activeStingSource: AudioBufferSourceNode | null = null;

  private async loadLineBuffer(relPath: string): Promise<AudioBuffer | null> {
    const hit = this.lineBuffers.get(relPath);
    if (hit) {
      // LRU touch
      this.lineBuffers.delete(relPath);
      this.lineBuffers.set(relPath, hit);
      return hit;
    }
    const inflight = this.lineLoading.get(relPath);
    if (inflight) return inflight;
    const promise = (async (): Promise<AudioBuffer | null> => {
      if (!this.ctx) return null;
      try {
        const res = await fetch(resolveAudioAssetUrl(relPath));
        if (!res.ok) return null;
        const arr = await res.arrayBuffer();
        const buf = await this.ctx.decodeAudioData(arr.slice(0));
        this.lineBuffers.set(relPath, buf);
        while (this.lineBuffers.size > AudioEngine.LINE_CACHE_CAP) {
          const oldest = this.lineBuffers.keys().next().value as string | undefined;
          if (oldest === undefined) break;
          this.lineBuffers.delete(oldest);
        }
        return buf;
      } catch {
        return null;
      } finally {
        this.lineLoading.delete(relPath);
      }
    })();
    this.lineLoading.set(relPath, promise);
    return promise;
  }

  /** Warm a dialogue line (and its English companion) without playing it. */
  prefetchDialogueLine(lineId: string): void {
    const line = dialogueLine(lineId);
    if (!line) return;
    if (line.wavBn) void this.loadLineBuffer(line.wavBn);
    if (line.wavEn) void this.loadLineBuffer(line.wavEn);
  }

  /** Warm a rival's intro sting without playing it. */
  prefetchIntroSting(rivalId: string): void {
    const sting = introStingForRival(rivalId);
    if (sting) void this.loadLineBuffer(sting.wav);
  }

  /**
   * Play one exact manifest dialogue line in the requested locale (Bangla-first).
   * Playback stops any active dialogue/line first (no overlapping duplicate lines).
   * Returns true if playback started; false if muted/unloaded (callers keep the
   * subtitle visible either way — a missing clip is a QA failure, never a silent skip).
   */
  playManifestLine(lineId: string, locale: 'bn' | 'en' = 'bn', onEnded?: () => void): void {
    const line = dialogueLine(lineId);
    if (!line) {
      onEnded?.();
      return;
    }
    const relPath = locale === 'en' && line.wavEn ? line.wavEn : line.wavBn;
    if (!relPath) {
      // English companion intentionally absent for local callouts -> subtitle only.
      onEnded?.();
      return;
    }
    this.stopDialogueClip();
    if (!this.ctx || this.ctx.state !== 'running' || this.volumes.muted || !this.volumes.sfxEnabled) {
      // Still report completion so intro sequencing continues with subtitles only.
      onEnded?.();
      return;
    }
    void this.loadLineBuffer(relPath).then((buf) => {
      if (!buf || !this.ctx || this.ctx.state !== 'running') {
        onEnded?.();
        return;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = 1.0;
      src.connect(g).connect(this.dialogueBus);
      this.activeDialogueSource = src;
      this.setDialogueDuck(true);
      src.onended = () => {
        if (this.activeDialogueSource === src) {
          this.activeDialogueSource = null;
          this.setDialogueDuck(false);
        }
        try {
          src.disconnect();
          g.disconnect();
        } catch {
          /* ignore */
        }
        onEnded?.();
      };
      src.start();
    });
  }

  /**
   * Play a Blacklist rival's distinct intro music sting (short original cue under
   * the cinematic dialogue). Non-overlapping; stopped by `stopIntroSting()`.
   */
  playIntroSting(rivalId: string, onEnded?: () => void): void {
    const sting = introStingForRival(rivalId);
    if (!sting) {
      onEnded?.();
      return;
    }
    this.stopIntroSting();
    if (!this.ctx || this.ctx.state !== 'running' || this.volumes.muted || !this.volumes.musicEnabled) {
      onEnded?.();
      return;
    }
    void this.loadLineBuffer(sting.wav).then((buf) => {
      if (!buf || !this.ctx || this.ctx.state !== 'running') {
        onEnded?.();
        return;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = 0.62;
      src.connect(g).connect(this.musicDuckGain);
      this.activeStingSource = src;
      src.onended = () => {
        if (this.activeStingSource === src) this.activeStingSource = null;
        try {
          src.disconnect();
          g.disconnect();
        } catch {
          /* ignore */
        }
        onEnded?.();
      };
      src.start();
    });
  }

  stopIntroSting(): void {
    if (this.activeStingSource) {
      const s = this.activeStingSource;
      this.activeStingSource = null;
      try {
        s.onended = null;
        s.stop();
        s.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  /** Diagnostics: how many manifest line clips are decoded + resident (LRU size). */
  get loadedDialogueLineCount(): number {
    return this.lineBuffers.size;
  }

  /** Total bundled core assets that `init()` preloads (tests assert full coverage). */
  get expectedAssetCount(): number {
    return Object.keys(ASSET_PATHS).length;
  }

  /**
   * Plays bundled offline phonetic speech WAV (`bn` or `en`) when no verified
   * native Android TTS or browser `SpeechSynthesisVoice` is installed.
   */
  playBundledDialogue(
    role: DialogueClipRole,
    locale: 'bn' | 'en' = 'bn',
    onEnded?: () => void,
  ): boolean {
    this.stopDialogueClip();
    if (!this.ctx || this.ctx.state !== 'running' || this.volumes.muted || !this.volumes.sfxEnabled) {
      return false;
    }
    const keyMap: Record<DialogueClipRole, { bn: AssetKey; en: AssetKey }> = {
      driver: { bn: 'dlgDriver', en: 'dlgDriverEn' },
      player: { bn: 'dlgPlayer', en: 'dlgPlayerEn' },
      rival: { bn: 'dlgRivalBn', en: 'dlgRivalEn' },
      police: { bn: 'dlgPoliceBn', en: 'dlgPoliceEn' },
    };
    const key = keyMap[role][locale];
    const buf = this.buffers.get(key);
    if (!buf) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = 1.0;
    src.connect(g).connect(this.dialogueBus);
    this.activeDialogueSource = src;
    this.setDialogueDuck(true);
    src.onended = () => {
      if (this.activeDialogueSource === src) {
        this.activeDialogueSource = null;
        this.setDialogueDuck(false);
      }
      try {
        src.disconnect();
        g.disconnect();
      } catch {
        /* ignore */
      }
      onEnded?.();
    };
    src.start();
    return true;
  }

  /** Plays bundled fallback vocal clip for road-rage (backward-compatible helper). */
  playDialogueClip(speaker: 'driver' | 'player', onEnded?: () => void, locale: 'bn' | 'en' = 'bn'): boolean {
    return this.playBundledDialogue(speaker, locale, onEnded);
  }

  stopDialogueClip(): void {
    if (this.activeDialogueSource) {
      const s = this.activeDialogueSource;
      this.activeDialogueSource = null;
      try {
        s.onended = null;
        s.stop();
        s.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.setDialogueDuck(false);
  }

  bump(intensity: number): void {
    if (!this.ctx || !this.noiseBuffer || this.volumes.muted || !this.volumes.sfxEnabled) return;
    if (this.activeOneShots >= MAX_ONE_SHOTS) return;
    const now = this.ctx.currentTime;
    const amt = clamp(intensity, 0.1, 2.2);

    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(118, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.18);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.28 * amt, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    osc.connect(g).connect(this.vehicleBus);
    osc.start(now);
    osc.stop(now + 0.26);

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1150;
    const rg = this.ctx.createGain();
    rg.gain.setValueAtTime(0.0001, now);
    rg.gain.exponentialRampToValueAtTime(0.14 * amt, now + 0.015);
    rg.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    src.connect(bp).connect(rg).connect(this.vehicleBus);
    src.start(now);
    src.stop(now + 0.22);
    this.trackSynthOneShot(0.26);
  }

  uiTap(): void {
    this.uiTone(520, 0.045, 0.08);
  }

  uiConfirm(): void {
    this.uiTone(523.25, 0.07, 0.1);
    this.uiTone(659.25, 0.09, 0.1, 0.055);
  }

  uiError(): void {
    this.uiTone(220, 0.09, 0.1);
    this.uiTone(185, 0.12, 0.1, 0.07);
  }

  coin(): void {
    this.uiTone(988, 0.08, 0.11);
    this.uiTone(1319, 0.16, 0.11, 0.06);
  }

  private uiTone(freq: number, dur: number, gain: number, delay = 0): void {
    if (!this.ctx || this.volumes.muted || !this.volumes.sfxEnabled) return;
    if (this.activeOneShots >= MAX_ONE_SHOTS) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.uiBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
    this.trackSynthOneShot(delay + dur + 0.02);
  }

  /**
   * Distance-attenuated & stereo-panned Dhaka traffic horn.
   * `dx` and `dz` are relative to the player (`hornWorld - playerWorld`) so
   * close vehicles sound crisp and distant vehicles attenuate smoothly to 0.
   */
  trafficHorn(
    dx: number,
    dz: number,
    kind = 'cng',
  ): void {
    if (!this.ctx || this.volumes.muted || !this.volumes.sfxEnabled) return;
    if (this.volumes.reduceNoisyAmbience && Math.random() < 0.65) return;
    if (this.hornBurstCooldown > 0 || this.activeOneShots >= MAX_ONE_SHOTS) return;

    const dist = Math.hypot(dx, dz);
    const maxDist = kind === 'bus' ? 54 : 42;
    if (dist > maxDist) return;
    const atten = clamp01(1 - dist / maxDist);
    if (atten <= 0.05) return;

    this.hornBurstCooldown = 0.28;
    if (kind === 'rickshaw') {
      this.bell('classic');
      return;
    }

    const now = this.ctx.currentTime;
    const freq = kind === 'bus' ? 196 : kind === 'car' ? 415 : kind === 'motorbike' ? 520 : 345;
    const dur = kind === 'bus' ? 0.36 : 0.2;
    const osc = this.ctx.createOscillator();
    osc.type = kind === 'car' || kind === 'motorbike' ? 'triangle' : 'sawtooth';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.setValueAtTime(freq * 1.03, now + dur * 0.45);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = kind === 'bus' ? 860 : 1380;
    const g = this.ctx.createGain();
    const peak = (0.04 + 0.13 * atten * atten) * (kind === 'bus' ? 1.15 : 0.9);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(peak, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    if (typeof this.ctx.createStereoPanner === 'function') {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = clamp(dx / 18, -0.8, 0.8);
      osc.connect(filter).connect(g).connect(panner).connect(this.trafficBus);
    } else {
      osc.connect(filter).connect(g).connect(this.trafficBus);
    }
    osc.start(now);
    osc.stop(now + dur + 0.02);
    this.trackSynthOneShot(dur + 0.02);
  }

  pedestrianShout(): void {
    if (!this.ctx || this.volumes.muted || !this.volumes.sfxEnabled) return;
    if (this.pedShoutCooldown > 0 || this.activeOneShots >= MAX_ONE_SHOTS) return;
    this.pedShoutCooldown = 0.45;
    const now = this.ctx.currentTime;
    const base = 240 + Math.random() * 95;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.linearRampToValueAtTime(base * 1.24, now + 0.08);
    osc.frequency.linearRampToValueAtTime(base * 0.92, now + 0.22);
    const f1 = this.ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 780;
    f1.Q.value = 3.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.09, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    osc.connect(f1).connect(g).connect(this.dialogueBus);
    osc.start(now);
    osc.stop(now + 0.26);
    this.trackSynthOneShot(0.26);
  }

  private crow(): void {
    if (!this.ctx || this.activeOneShots >= MAX_ONE_SHOTS || this.activeSourceCount >= 13) return;
    const now = this.ctx.currentTime;
    for (let c = 0; c < 2; c++) {
      const t0 = now + c * 0.24;
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(640, t0);
      osc.frequency.linearRampToValueAtTime(500, t0 + 0.16);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1280;
      bp.Q.value = 2.4;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.032, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      osc.connect(bp).connect(g).connect(this.ambienceBus);
      osc.start(t0);
      osc.stop(t0 + 0.2);
    }
    this.trackSynthOneShot(0.45);
  }

  private trackSynthOneShot(durationSec: number): void {
    this.activeOneShots++;
    window.setTimeout(() => {
      this.activeOneShots = Math.max(0, this.activeOneShots - 1);
    }, Math.max(40, Math.round(durationSec * 1000)));
  }

  dispose(): void {
    this.stopDialogueClip();
    this.stopIntroSting();
    if (this.windSource) {
      try {
        this.windSource.stop();
        this.windSource.disconnect();
      } catch {
        /* ignore */
      }
      this.windSource = null;
      this.windGain = null;
    }
    this.lineBuffers.clear();
    this.lineLoading.clear();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}

export const audio = new AudioEngine();
