/**
 * Original, fully synthesised audio: no recordings, no copyright risk.
 *
 * Buses: music / ambience / traffic / vehicle / dialogue / ui, all routed to a
 * master with a limiter. Music is a small scheduled sequencer with three
 * original loops; SFX are built from oscillators and noise buffers.
 */

export type BusName = 'music' | 'ambience' | 'traffic' | 'vehicle' | 'dialogue' | 'ui';

export interface AudioVolumes {
  music: number;
  ambience: number;
  traffic: number;
  vehicle: number;
  dialogue: number;
  ui: number;
  muted: boolean;
}

const TRACKS = ['cassette', 'radio', 'brishti'] as const;
export type TrackId = (typeof TRACKS)[number];

/* ------------------------------------------------------------------ helpers */

function midiToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/* ------------------------------------------------------------------- engine */

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses: Partial<Record<BusName, GainNode>> = {};
  private noiseBuffer: AudioBuffer | null = null;
  private started = false;
  private volumes: AudioVolumes = {
    music: 0.62,
    ambience: 0.7,
    traffic: 0.6,
    vehicle: 0.75,
    dialogue: 0.85,
    ui: 0.7,
    muted: false,
  };

  // music state
  private track: TrackId = 'cassette';
  private musicGain!: GainNode;
  private nextNoteTime = 0;
  private step = 0;
  private tempo = 84;
  private musicEnabled = true;
  private trackVolume = 0.34;

  // continuous loops
  private crowdGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private hornTimer = 0;
  private crowTimer = 6;
  private vendorTimer = 4.5;
  private vehicleSpeed = 0;
  private electricDrive = false;

  get ready(): boolean {
    return this.started;
  }

  /** Must be called from a user gesture (tap / key press). */
  async init(): Promise<void> {
    if (this.started) {
      if (this.ctx?.state === 'suspended') await this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.18;
    this.master.connect(limiter);
    limiter.connect(ctx.destination);

    for (const name of ['music', 'ambience', 'traffic', 'vehicle', 'dialogue', 'ui'] as BusName[]) {
      const gain = ctx.createGain();
      gain.gain.value = 1;
      gain.connect(this.master);
      this.buses[name] = gain;
    }
    this.musicGain = this.ctx!.createGain();
    this.musicGain.gain.value = this.trackVolume;
    this.musicGain.connect(this.buses.music!);

    this.noiseBuffer = this.makeNoise(2.0);
    this.startAmbience();
    this.started = true;
    this.applyVolumes();
    await ctx.resume();
    this.nextNoteTime = ctx.currentTime + 0.1;
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    return buf;
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const v = this.volumes;
    const set = (bus: BusName, value: number): void => {
      const node = this.buses[bus];
      if (node) node.gain.value = v.muted ? 0 : Math.max(0, Math.min(1, value));
    };
    set('music', v.music);
    set('ambience', v.ambience);
    set('traffic', v.traffic);
    set('vehicle', v.vehicle);
    set('dialogue', v.dialogue);
    set('ui', v.ui);
  }

  setVolumes(patch: Partial<AudioVolumes>): void {
    this.volumes = { ...this.volumes, ...patch };
    this.applyVolumes();
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  /* --------------------------------------------------------------- ambience */

  private startAmbience(): void {
    const ctx = this.ctx!;
    if (!this.noiseBuffer) return;
    // low city rumble
    const rumble = ctx.createBufferSource();
    rumble.buffer = this.noiseBuffer;
    rumble.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const g = ctx.createGain();
    g.gain.value = 0.35;
    rumble.connect(lp).connect(g).connect(this.buses.ambience!);
    rumble.start();

    // crowd murmur
    const crowd = ctx.createBufferSource();
    crowd.buffer = this.noiseBuffer;
    crowd.loop = true;
    crowd.playbackRate.value = 0.7;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 620;
    bp.Q.value = 0.9;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0.14;
    crowd.connect(bp).connect(this.crowdGain).connect(this.buses.ambience!);
    crowd.start();

    // rain bed (silent until weather turns)
    const rain = ctx.createBufferSource();
    rain.buffer = this.noiseBuffer;
    rain.loop = true;
    rain.playbackRate.value = 1.6;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rain.connect(hp).connect(this.rainGain).connect(this.buses.ambience!);
    rain.start();

    // rickshaw drivetrain hum
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 44;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 220;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter).connect(this.engineGain).connect(this.buses.vehicle!);
    this.engineOsc.start();
  }

  setRain(intensity: number): void {
    if (!this.ctx || !this.rainGain) return;
    this.rainGain.gain.setTargetAtTime(Math.max(0, Math.min(0.5, intensity * 0.5)), this.ctx.currentTime, 1.2);
  }

  setCrowd(intensity: number): void {
    if (!this.ctx || !this.crowdGain) return;
    this.crowdGain.gain.setTargetAtTime(0.06 + intensity * 0.22, this.ctx.currentTime, 0.8);
  }

  /* ------------------------------------------------------------------- SFX */

  private tone(
    freq: number,
    duration: number,
    opts: {
      type?: OscillatorType;
      gain?: number;
      bus?: BusName;
      slideTo?: number;
      delay?: number;
      filter?: number;
      detune?: number;
    } = {},
  ): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), t0 + duration);
    if (opts.detune) osc.detune.value = opts.detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain ?? 0.15), t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    let node: AudioNode = osc;
    if (opts.filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = opts.filter;
      osc.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(this.buses[opts.bus ?? 'ui'] ?? this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  private noiseBurst(duration: number, freq: number, gain: number, bus: BusName, type: BiquadFilterType = 'bandpass'): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 1;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = 1.1;
    const g = ctx.createGain();
    const t0 = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(f).connect(g).connect(this.buses[bus] ?? this.master);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  /** The classic rickshaw bell: bright metallic টুং-টাং pings (plus brass & melody variants). */
  bell(variant = 'classic'): void {
    if (!this.ctx) return;
    if (variant === 'melody' || variant === 'bell-melody') {
      this.metalPing(1568, 0.0, 0.18);
      this.metalPing(1975, 0.09, 0.18);
      this.metalPing(2349, 0.18, 0.22);
      return;
    }
    if (variant === 'double' || variant === 'bell-double') {
      this.metalPing(1760, 0.0, 0.22);
      this.metalPing(1760, 0.11, 0.2);
      this.metalPing(2340, 0.22, 0.16);
      return;
    }
    const base = variant === 'brass' || variant === 'bell-brass' ? 1480 : 1760;
    this.metalPing(base, 0, 0.24);
    this.metalPing(base * 1.03, 0.13, 0.2);
  }

  /** Expressive vocal-formant alert cue when a pedestrian scolds a close rickshaw! */
  pedestrianShout(): void {
    this.tone(310, 0.13, { type: 'sawtooth', gain: 0.055, bus: 'dialogue', slideTo: 420, filter: 1450 });
    this.tone(380, 0.16, { type: 'triangle', gain: 0.05, bus: 'dialogue', slideTo: 270, delay: 0.12, filter: 1300 });
  }

  /** Subtle Bangladeshi street-vendor spoon/muri-tin/tea-glass clink around Fuchka & Jhalmuri stalls! */
  vendorSound(kind: 'fuchka' | 'jhalmuri' | 'tea' | 'market' = 'jhalmuri'): void {
    if (kind === 'jhalmuri') {
      // Rhythmic steel spoon tapping muri tin (`ঠং ঠং`)
      this.metalPing(2650, 0, 0.06);
      this.metalPing(2820, 0.09, 0.05);
      this.noiseBurst(0.14, 3400, 0.025, 'ambience', 'bandpass');
    } else if (kind === 'fuchka') {
      this.metalPing(2120, 0, 0.07);
      this.metalPing(2480, 0.11, 0.07);
    } else {
      this.teaClink();
    }
  }

  private metalPing(freq: number, delay: number, duration: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const carrier = ctx.createOscillator();
    const modulator = ctx.createOscillator();
    const modGain = ctx.createGain();
    carrier.type = 'sine';
    modulator.type = 'sine';
    carrier.frequency.value = freq;
    modulator.frequency.value = freq * 2.7;
    modGain.gain.value = freq * 0.7;
    modulator.connect(modGain).connect(carrier.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    carrier.connect(g).connect(this.buses.vehicle!);
    carrier.start(t0);
    modulator.start(t0);
    carrier.stop(t0 + duration + 0.05);
    modulator.stop(t0 + duration + 0.05);
  }

  bump(strength: number): void {
    const s = Math.min(1, Math.max(0.1, strength / 2.5));
    this.noiseBurst(0.16, 160, 0.25 * s, 'vehicle', 'lowpass');
    this.tone(70, 0.16, { type: 'sine', gain: 0.28 * s, bus: 'vehicle', slideTo: 40 });
    this.tone(220, 0.09, { type: 'square', gain: 0.05 * s, bus: 'vehicle', slideTo: 120, filter: 800 });
  }

  creak(): void {
    this.noiseBurst(0.22, 1800, 0.05, 'vehicle', 'bandpass');
  }

  brakeSqueal(): void {
    this.tone(920, 0.22, { type: 'triangle', gain: 0.05, bus: 'vehicle', slideTo: 640, filter: 2400 });
  }

  coin(): void {
    this.tone(880, 0.12, { gain: 0.12, bus: 'ui' });
    this.tone(1320, 0.16, { gain: 0.1, bus: 'ui', delay: 0.07 });
    this.tone(1760, 0.22, { gain: 0.08, bus: 'ui', delay: 0.14 });
  }

  uiTap(): void {
    this.tone(620, 0.05, { type: 'triangle', gain: 0.06, bus: 'ui', slideTo: 720 });
  }

  uiConfirm(): void {
    this.tone(520, 0.1, { gain: 0.09, bus: 'ui' });
    this.tone(780, 0.16, { gain: 0.08, bus: 'ui', delay: 0.08 });
  }

  uiError(): void {
    this.tone(220, 0.16, { type: 'square', gain: 0.06, bus: 'ui', slideTo: 160, filter: 900 });
  }

  /** Mission complete stinger — brief, toggleable bass hit + bell. */
  successStinger(): void {
    this.tone(98, 0.5, { type: 'sine', gain: 0.22, bus: 'ui', slideTo: 62 });
    this.tone(392, 0.28, { type: 'triangle', gain: 0.09, bus: 'ui', delay: 0.06 });
    this.tone(523, 0.32, { type: 'triangle', gain: 0.08, bus: 'ui', delay: 0.18 });
    this.metalPing(1760, 0.28, 0.3);
  }

  failStinger(): void {
    this.tone(220, 0.4, { type: 'sine', gain: 0.14, bus: 'ui', slideTo: 110 });
  }

  /** Traffic horn or NPC rickshaw bell, panned by distance so it never dominates. */
  trafficHorn(x: number, z: number, kind: string): void {
    if (!this.ctx) return;
    if (kind === 'rickshaw' || kind === 'easybike') {
      this.metalPing(kind === 'easybike' ? 1320 : 1680, 0, 0.14);
      this.metalPing(kind === 'easybike' ? 1350 : 1720, 0.11, 0.12);
      return;
    }
    const ctx = this.ctx;
    const base = kind === 'bus' || kind === 'truck' ? 190 : kind === 'motorbike' ? 410 : 320;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = base;
    const osc2 = ctx.createOscillator();
    osc2.type = 'sawtooth';
    osc2.frequency.value = base * 1.5;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1400;
    const g = ctx.createGain();
    const t0 = ctx.currentTime;
    const dur = 0.22 + Math.random() * 0.18;
    const vol = 0.05 + Math.min(0.06, Math.hypot(x, z) / 2400);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-0.7, Math.min(0.7, x / 60));
    osc.connect(f);
    osc2.connect(f);
    f.connect(g).connect(pan).connect(this.buses.traffic!);
    osc.start(t0);
    osc2.start(t0);
    osc.stop(t0 + dur + 0.02);
    osc2.stop(t0 + dur + 0.02);
  }

  crow(): void {
    this.tone(680, 0.1, { type: 'sawtooth', gain: 0.035, bus: 'ambience', slideTo: 420, filter: 1800 });
    this.tone(520, 0.08, { type: 'sawtooth', gain: 0.03, bus: 'ambience', slideTo: 380, filter: 1600, delay: 0.12 });
  }

  teaClink(): void {
    this.metalPing(2400, 0, 0.08);
  }

  /* ------------------------------------------------------------------ music */

  setTrack(track: TrackId): void {
    this.track = track;
    this.step = 0;
    this.tempo = track === 'radio' ? 104 : track === 'brishti' ? 76 : 84;
    if (this.ctx) this.nextNoteTime = this.ctx.currentTime + 0.05;
  }

  setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
    if (this.ctx) this.musicGain.gain.setTargetAtTime(enabled ? this.trackVolume : 0, this.ctx.currentTime, 0.4);
  }

  setElectricMode(electric: boolean): void {
    this.electricDrive = electric;
    if (this.engineOsc) {
      this.engineOsc.type = electric ? 'sine' : 'triangle';
    }
  }

  setVehicleSpeed(speed: number, throttle: number): void {
    this.vehicleSpeed = speed;
    if (!this.ctx || !this.engineGain || !this.engineOsc || !this.engineFilter) return;
    const t = this.ctx.currentTime;
    const absSpd = Math.abs(speed);
    if (this.electricDrive) {
      // Smooth brushless DC electric rickshaw inverter whine
      const target = Math.min(0.085, absSpd * 0.011 + Math.abs(throttle) * 0.018);
      this.engineGain.gain.setTargetAtTime(target, t, 0.18);
      this.engineOsc.frequency.setTargetAtTime(115 + absSpd * 24, t, 0.16);
      this.engineFilter.frequency.setTargetAtTime(420 + absSpd * 85, t, 0.2);
    } else {
      const target = Math.min(0.09, absSpd * 0.012 + Math.abs(throttle) * 0.02);
      this.engineGain.gain.setTargetAtTime(target, t, 0.25);
      this.engineOsc.frequency.setTargetAtTime(38 + absSpd * 6.2, t, 0.2);
      this.engineFilter.frequency.setTargetAtTime(180 + absSpd * 42, t, 0.25);
    }
  }

  /** Called every frame so music keeps its look-ahead schedule. */
  update(dt: number, playerX = 0, playerZ = 0): void {
    if (!this.ctx) return;
    if (this.musicEnabled) this.scheduleMusic();
    this.hornTimer -= dt;
    if (this.hornTimer <= 0) {
      this.hornTimer = 6 + Math.random() * 11;
      if (Math.random() < 0.65) {
        const roll = Math.random();
        const kind = roll < 0.36 ? 'rickshaw' : roll < 0.65 ? 'car' : 'bus';
        this.trafficHorn(playerX + (Math.random() - 0.5) * 50, playerZ + (Math.random() - 0.5) * 50, kind);
      }
    }
    this.vendorTimer -= dt;
    if (this.vendorTimer <= 0) {
      this.vendorTimer = 7 + Math.random() * 11;
      const kinds: ('fuchka' | 'jhalmuri' | 'tea')[] = ['jhalmuri', 'fuchka', 'tea'];
      this.vendorSound(kinds[Math.floor(Math.random() * kinds.length)]);
    }
    this.crowTimer -= dt;
    if (this.crowTimer <= 0) {
      this.crowTimer = 9 + Math.random() * 16;
      this.crow();
    }
  }

  private scheduleMusic(): void {
    const ctx = this.ctx!;
    const spb = 60 / this.tempo / 2; // eighth notes
    while (this.nextNoteTime < ctx.currentTime + 0.25) {
      this.playStep(this.step, this.nextNoteTime);
      this.step = (this.step + 1) % 64;
      this.nextNoteTime += spb;
    }
  }

  /** Three original 8-bar loops. */
  private playStep(step: number, time: number): void {
    const ctx = this.ctx!;
    const bar = Math.floor(step / 8) % 8;
    const beat = step % 8;
    const schedule = (
      freq: number,
      duration: number,
      type: OscillatorType,
      gain: number,
      filter?: number,
    ): void => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(gain, time + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, time + duration);
      let node: AudioNode = osc;
      if (filter) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = filter;
        osc.connect(f);
        node = f;
      }
      node.connect(g).connect(this.musicGain);
      osc.start(time);
      osc.stop(time + duration + 0.03);
    };
    const drum = (freq: number, gain: number, duration = 0.12): void => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.45, time + duration);
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + duration);
      osc.connect(g).connect(this.musicGain);
      osc.start(time);
      osc.stop(time + duration + 0.02);
    };
    const brush = (gain: number): void => {
      if (!this.noiseBuffer) return;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.playbackRate.value = 1.4;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 3200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.09);
      src.connect(f).connect(g).connect(this.musicGain);
      src.start(time);
      src.stop(time + 0.1);
    };

    if (this.track === 'cassette') {
      // Dmaj7 / Bm7 / Gmaj7 / A7, warm electric-piano-ish plucks
      const chords = [
        [50, 54, 57, 61],
        [47, 50, 54, 57],
        [43, 47, 50, 54],
        [45, 49, 52, 55],
      ];
      const chord = chords[bar % 4];
      if (beat === 0) {
        drum(80, 0.16, 0.22);
        for (const n of chord) schedule(midiToFreq(n), 0.9, 'triangle', 0.035, 2200);
      }
      if (beat === 3) schedule(midiToFreq(chord[2] + 12), 0.5, 'sine', 0.03, 1800);
      if (beat === 6) schedule(midiToFreq(chord[3]), 0.35, 'triangle', 0.028, 2000);
      if (beat === 4) drum(64, 0.1, 0.16);
      if (beat === 2 || beat === 7) brush(0.02);
      if (beat === 5 && bar % 2 === 0) schedule(midiToFreq(74), 0.3, 'sine', 0.026, 2600);
    } else if (this.track === 'radio') {
      // Am / F / C / G, plucky bass + pentatonic melody
      const roots = [45, 41, 48, 43];
      const melody = [69, 72, 76, 72, 74, 69, 67, 72];
      const root = roots[bar % 4];
      if (beat % 2 === 0) schedule(midiToFreq(root), 0.32, 'square', 0.03, 500);
      if (beat === 0 || beat === 4) drum(110, 0.1, 0.16);
      if (beat === 2 || beat === 6) drum(320, 0.05, 0.08);
      if (beat === 1 || beat === 3 || beat === 5) brush(0.018);
      if (beat % 2 === 1) {
        const note = melody[(bar * 3 + beat) % melody.length];
        schedule(midiToFreq(note + (bar % 2 ? 0 : 0)), 0.26, 'triangle', 0.028, 3400);
      }
    } else {
      // Em / Cmaj7 / G / D, airy pad with a flute line
      const pad = [
        [40, 47, 52],
        [36, 43, 48],
        [43, 47, 50],
        [38, 45, 50],
      ][bar % 4];
      if (beat === 0) {
        for (const n of pad) schedule(midiToFreq(n), 2.2, 'sine', 0.026, 1200);
        drum(58, 0.08, 0.3);
      }
      if (beat === 3) schedule(midiToFreq(67 + (bar % 3)), 0.5, 'triangle', 0.022, 2400);
      if (beat === 6 && bar % 2 === 1) schedule(midiToFreq(71), 0.6, 'sine', 0.02, 2200);
      if (beat === 5) brush(0.012);
    }
    void this.vehicleSpeed;
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.started = false;
  }
}

export const audio = new AudioEngine();
