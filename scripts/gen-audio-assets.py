#!/usr/bin/env python3
"""
Deterministic offline audio asset generator for Banglar Tesla (Dhaka Edition).
Produces 100% original, royalty-free RIFF PCM .wav assets in public/audio/:
  - music/menu-dhaka-sondhya.wav   (Menu / Garage / Dokan instrumental loop)
  - music/drive-asad-groove.wav    (Driving folk-percussion & dotara loop)
  - music/drive-brishti-dusk.wav   (Alternate evening/monsoon driving loop)
  - ambience/dhaka-street-bed.wav  (Distant Dhaka city & traffic bed loop)
  - ambience/bazaar-crowd-loop.wav (Town Hall Market / bazaar crowd loop)
  - ambience/tea-stall-clink.wav   (Roadside tong tea glass clink + kettle steam)
  - ambience/hawker-call-1.wav     (Street vendor call cadence + brass bell)
  - ambience/hawker-call-2.wav     (Jhalmuri tin shake + street vendor cadence)
  - ambience/construction-tap.wav  (Localized masonry hammer / rebar clink)
  - sfx/rickshaw-chain-loop.wav    (Cycle-rickshaw freewheel + chain cadence loop)
  - sfx/tan-boost.wav              (টান boost wind rush + chain surge)
  - sfx/lamp-crash.wav             (Hollow steel streetlamp crash + sparks)
  - sfx/stall-crash.wav            (Wooden cart splinter + tin/pot clatter)
  - dialogue/roadrage-driver-cue.wav (Expressive baritone Bangla cadence fallback)
  - dialogue/roadrage-player-cue.wav (Expressive apologetic Bangla cadence fallback)
"""

from __future__ import annotations

import math
import random
import struct
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUDIO_DIR = ROOT / "public" / "audio"


def midi_hz(note: float) -> float:
    return 440.0 * (2.0 ** ((note - 69.0) / 12.0))


def write_wav(path: Path, samples: list[float], sr: int, seamless_fade_ms: float = 0.0) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    n = len(samples)
    if seamless_fade_ms > 0:
        xf = min(n // 8, int(sr * seamless_fade_ms / 1000.0))
        for i in range(xf):
            w = i / max(1, xf)
            samples[i] = samples[i] * w + samples[n - xf + i] * (1.0 - w)
    peak = max((abs(x) for x in samples), default=1e-6)
    norm = 0.88 / max(peak, 0.88)
    raw = bytearray(n * 2)
    for i, s in enumerate(samples):
        v = max(-1.0, min(1.0, s * norm))
        # Soft tape saturation for warm analog character
        v = math.tanh(v * 1.18) / math.tanh(1.18)
        iv = int(round(v * 32767.0))
        struct.pack_into("<h", raw, i * 2, max(-32768, min(32767, iv)))
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(bytes(raw))
    print(f"[audio-gen] Wrote {path.relative_to(ROOT)} ({path.stat().st_size:,} bytes, {n/sr:.2f}s @ {sr}Hz)")


def karplus_pluck(sr: int, freq: float, dur: float, brightness: float = 0.492, seed: int = 1) -> list[float]:
    """Karplus-Strong plucked string model evoking a dotara/ektara string."""
    rng = random.Random(seed)
    period = max(4, int(round(sr / max(30.0, freq))))
    ring = [rng.uniform(-1.0, 1.0) for _ in range(period)]
    # Gentle lowpass on initial excitation so pluck sounds woody, not harsh
    for i in range(1, period):
        ring[i] = 0.65 * ring[i] + 0.35 * ring[i - 1]
    total = int(sr * dur)
    out = [0.0] * total
    idx = 0
    for i in range(total):
        cur = ring[idx]
        nxt = ring[(idx + 1) % period]
        # Slight body resonance vibrato
        out[i] = cur
        ring[idx] = (cur + nxt) * brightness
        idx = (idx + 1) % period
    return out


def add_into(buf: list[float], start: int, clip: list[float], gain: float = 1.0, wrap: bool = True) -> None:
    n = len(buf)
    for i, v in enumerate(clip):
        pos = start + i
        if wrap:
            buf[pos % n] += v * gain
        elif 0 <= pos < n:
            buf[pos] += v * gain


def synth_tabla_bol(sr: int, kind: str, seed: int = 7) -> list[float]:
    """Synthesize tabla/dholak strokes: 'dha' (bayan+dayan), 'tin' (resonant rim), 'ta' (crisp slap), 'ge' (bass)."""
    rng = random.Random(seed)
    dur = 0.34 if kind in ("dha", "ge") else 0.20
    n = int(sr * dur)
    out = [0.0] * n
    for i in range(n):
        t = i / sr
        s = 0.0
        if kind in ("dha", "ge"):
            # Bayan pitch-swept bass membrane
            f_bass = 78.0 + 48.0 * math.exp(-t * 22.0) + 8.0 * math.sin(t * 19.0)
            s += 0.62 * math.sin(2.0 * math.pi * f_bass * t) * math.exp(-t * 9.5)
        if kind in ("dha", "tin"):
            # Tuned dayan D4/A4 harmonic ring (syahi overtone)
            f_dayan = 293.66
            s += 0.36 * math.sin(2.0 * math.pi * f_dayan * t) * math.exp(-t * 13.0)
            s += 0.16 * math.sin(2.0 * math.pi * (f_dayan * 2.01) * t) * math.exp(-t * 19.0)
        if kind == "ta":
            s += 0.28 * math.sin(2.0 * math.pi * 440.0 * t) * math.exp(-t * 28.0)
        # Finger skin transient
        s += (0.26 if kind == "ta" else 0.15) * rng.uniform(-1.0, 1.0) * math.exp(-t * 65.0)
        out[i] = s
    return out


def gen_menu_music() -> None:
    """9.6s warm Dhaka evening menu instrumental (100 BPM, 4 bars of 4/4 in D Khamaj/Mixolydian)."""
    sr = 22050
    bpm = 100.0
    step_sec = (60.0 / bpm) / 4.0  # 0.15s per 16th note, 64 steps = 9.6s exact loop!
    steps = 64
    total = int(round(sr * step_sec * steps))
    buf = [0.0] * total

    # Soft harmonium/reed drone & warm chord progression (D - C - G/B - D)
    chords = [
        (50, 57, 62, 66),  # D major
        (48, 55, 60, 64),  # C major (Khamaj b7)
        (47, 55, 59, 62),  # G/B
        (50, 57, 62, 64),  # Dsus2 -> D
    ]
    bar_samples = total // 4
    for b, chord in enumerate(chords):
        start = b * bar_samples
        for i in range(bar_samples + int(sr * 0.2)):
            t = i / sr
            dur = bar_samples / sr + 0.2
            env = math.sin(min(1.0, t / 0.18) * math.pi * 0.5) * math.sin(min(1.0, (dur - t) / 0.22) * math.pi * 0.5)
            val = 0.0
            for idx, m in enumerate(chord):
                f = midi_hz(m)
                # Harmonium reed harmonics (1x + 0.35*2x + 0.12*3x)
                val += (0.055 if idx > 0 else 0.075) * (
                    math.sin(2 * math.pi * f * t)
                    + 0.32 * math.sin(2 * math.pi * f * 2 * t)
                    + 0.10 * math.sin(2 * math.pi * f * 3 * t)
                )
            buf[(start + i) % total] += val * max(0.0, env)

    # Tabla groove (gentle Keherwa 8-step cycle)
    pattern = ["dha", ".", "tin", ".", "ta", "tin", "dha", "ge"]
    bol_cache = {k: synth_tabla_bol(sr, k, seed=10 + idx) for idx, k in enumerate(("dha", "tin", "ta", "ge"))}
    rng = random.Random(42)
    for st in range(steps):
        pos = int(round(st * step_sec * sr))
        bol = pattern[st % 8]
        if bol != ".":
            add_into(buf, pos, bol_cache[bol], gain=0.42 if st % 4 == 0 else 0.30)
        # Subtle ghungroo / shaker pulse on 8ths
        if st % 2 == 0:
            sh_len = int(sr * 0.055)
            sh = [rng.uniform(-1, 1) * math.exp(-i / (sr * 0.014)) * (1 if i % 3 != 0 else -0.5) for i in range(sh_len)]
            add_into(buf, pos, sh, gain=0.045)

    # Original Dotara melody (original lyrical motif in D Khamaj: D5 E5 F#5 A5 G5 F#5 E5 D5 ...)
    melody = [
        (0, 62, 0.55), (3, 64, 0.40), (6, 66, 0.55), (10, 69, 0.60), (14, 67, 0.42),
        (16, 64, 0.55), (20, 62, 0.45), (22, 60, 0.58), (26, 62, 0.48), (30, 64, 0.42),
        (32, 67, 0.56), (36, 66, 0.45), (38, 64, 0.42), (42, 62, 0.55), (46, 59, 0.42),
        (48, 62, 0.62), (52, 66, 0.46), (56, 64, 0.46), (60, 62, 0.65),
    ]
    for idx, (st, note, dur) in enumerate(melody):
        pos = int(round(st * step_sec * sr))
        pluck = karplus_pluck(sr, midi_hz(note), dur, brightness=0.494, seed=100 + idx)
        add_into(buf, pos, pluck, gain=0.38)
        # Sympathetic drone pluck on D4 at bar starts
        if st % 16 == 0:
            drone = karplus_pluck(sr, midi_hz(50), 0.9, brightness=0.496, seed=200 + idx)
            add_into(buf, pos, drone, gain=0.22)

    write_wav(AUDIO_DIR / "music" / "menu-dhaka-sondhya.wav", buf, sr)


def gen_drive_music() -> None:
    """9.6s upbeat Asad Avenue rickshaw driving groove (125 BPM, 5 bars / 80 steps -> let's use 120 BPM, 64 steps = 8.0s exact!)."""
    sr = 22050
    bpm = 122.0
    step_sec = (60.0 / bpm) / 4.0  # 64 steps = ~7.87s seamless loop
    steps = 64
    total = int(round(sr * step_sec * steps))
    buf = [0.0] * total

    # Driving Dholak + Bassline in G Mixolydian / Folk Groove
    bol_cache = {k: synth_tabla_bol(sr, k, seed=30 + idx) for idx, k in enumerate(("dha", "tin", "ta", "ge"))}
    groove = ["dha", ".", "ta", "ge", "tin", ".", "dha", "ta", "dha", "ge", "tin", ".", "ta", "dha", "ge", "tin"]
    bass_notes = [
        (0, 43), (3, 43), (6, 46), (8, 43), (12, 48), (14, 50),
        (16, 43), (19, 43), (22, 41), (24, 43), (28, 46), (30, 48),
        (32, 43), (35, 43), (38, 46), (40, 48), (44, 50), (46, 48),
        (48, 41), (51, 41), (54, 43), (56, 43), (60, 46), (62, 45),
    ]
    for st, bnote in bass_notes:
        pos = int(round(st * step_sec * sr))
        blen = int(sr * 0.24)
        f = midi_hz(bnote)
        bass = [
            0.34 * (math.sin(2 * math.pi * f * (i / sr)) + 0.45 * math.sin(2 * math.pi * f * 2 * (i / sr)))
            * math.exp(-(i / sr) * 8.5)
            for i in range(blen)
        ]
        add_into(buf, pos, bass, gain=0.68)

    rng = random.Random(77)
    for st in range(steps):
        pos = int(round(st * step_sec * sr))
        bol = groove[st % 16]
        if bol != ".":
            add_into(buf, pos, bol_cache[bol], gain=0.52 if st % 4 == 0 else 0.36)
        # Crisp folk kartal/shaker on offbeats
        if st % 2 == 1:
            sh_len = int(sr * 0.045)
            sh = [rng.uniform(-1, 1) * math.exp(-i / (sr * 0.011)) for i in range(sh_len)]
            add_into(buf, pos, sh, gain=0.07)

    # Energetic original Dotara + Ektara riff
    riff = [
        (0, 67, 0.36), (2, 70, 0.28), (4, 72, 0.36), (6, 74, 0.42), (10, 72, 0.30), (12, 70, 0.34), (14, 67, 0.36),
        (16, 67, 0.36), (18, 65, 0.28), (20, 67, 0.36), (22, 70, 0.42), (26, 67, 0.35), (30, 65, 0.32),
        (32, 67, 0.36), (34, 70, 0.28), (36, 74, 0.40), (40, 75, 0.35), (42, 74, 0.32), (44, 72, 0.34), (46, 70, 0.32),
        (48, 65, 0.38), (52, 67, 0.42), (56, 70, 0.36), (58, 67, 0.32), (60, 65, 0.30), (62, 67, 0.40),
    ]
    for idx, (st, note, dur) in enumerate(riff):
        pos = int(round(st * step_sec * sr))
        pluck = karplus_pluck(sr, midi_hz(note), dur, brightness=0.495, seed=300 + idx)
        add_into(buf, pos, pluck, gain=0.42)

    # Warm reed stabs on beats 2 & 4
    stab_notes = (55, 59, 62)
    for bar in range(4):
        for beat in (4, 12):
            pos = int(round((bar * 16 + beat) * step_sec * sr))
            slen = int(sr * 0.16)
            stab = []
            for i in range(slen):
                t = i / sr
                env = math.sin(min(1.0, t / 0.015) * math.pi * 0.5) * math.exp(-t * 14.0)
                v = sum(math.sin(2 * math.pi * midi_hz(m) * t) + 0.3 * math.sin(4 * math.pi * midi_hz(m) * t) for m in stab_notes)
                stab.append(v * env * 0.09)
            add_into(buf, pos, stab, gain=0.8)

    write_wav(AUDIO_DIR / "music" / "drive-asad-groove.wav", buf, sr)


def gen_brishti_music() -> None:
    """8.4s reflective monsoon/dusk driving track (A Dorian pentatonic)."""
    sr = 22050
    bpm = 108.0
    step_sec = (60.0 / bpm) / 4.0
    steps = 64
    total = int(round(sr * step_sec * steps))
    buf = [0.0] * total

    chords = [(45, 52, 57, 60), (43, 50, 55, 59), (41, 48, 53, 57), (43, 50, 55, 62)]
    bar_samples = total // 4
    for b, ch in enumerate(chords):
        start = b * bar_samples
        for i in range(bar_samples + int(sr * 0.2)):
            t = i / sr
            dur = bar_samples / sr + 0.2
            env = math.sin(min(1.0, t / 0.2) * math.pi * 0.5) * math.sin(min(1.0, (dur - t) / 0.25) * math.pi * 0.5)
            v = sum(0.055 * math.sin(2 * math.pi * midi_hz(m) * t) for m in ch)
            buf[(start + i) % total] += v * max(0.0, env)

    bol_cache = {k: synth_tabla_bol(sr, k, seed=60 + idx) for idx, k in enumerate(("dha", "tin", "ta", "ge"))}
    pat = ["dha", ".", ".", "tin", ".", "ta", "dha", ".", "tin", ".", "ge", "tin", "ta", ".", "dha", "."]
    for st in range(steps):
        bol = pat[st % 16]
        if bol != ".":
            add_into(buf, int(round(st * step_sec * sr)), bol_cache[bol], gain=0.40)

    notes = [
        (0, 69, 0.55), (4, 72, 0.45), (8, 74, 0.55), (12, 76, 0.50),
        (16, 74, 0.55), (20, 72, 0.45), (24, 69, 0.60), (30, 67, 0.40),
        (32, 65, 0.55), (36, 69, 0.45), (40, 72, 0.55), (44, 69, 0.45),
        (48, 67, 0.55), (52, 69, 0.50), (56, 64, 0.50), (60, 69, 0.55),
    ]
    for idx, (st, note, dur) in enumerate(notes):
        pluck = karplus_pluck(sr, midi_hz(note), dur, brightness=0.495, seed=500 + idx)
        add_into(buf, int(round(st * step_sec * sr)), pluck, gain=0.38)

    write_wav(AUDIO_DIR / "music" / "drive-brishti-dusk.wav", buf, sr)


def gen_street_ambience() -> None:
    """6.0s seamless Dhaka urban street & distant traffic bed."""
    sr = 16000
    n = sr * 6
    rng = random.Random(101)
    buf = [0.0] * n
    lp1 = 0.0
    lp2 = 0.0
    for i in range(n):
        t = i / sr
        w = rng.uniform(-1.0, 1.0)
        lp1 += 0.035 * (w - lp1)
        lp2 += 0.012 * (lp1 - lp2)
        # Subtle distant CNG 2-stroke / auto-rickshaw engine hum
        cng = 0.045 * math.sin(2 * math.pi * (66.0 + 4.0 * math.sin(2 * math.pi * t / 6.0)) * t)
        cng += 0.022 * math.sin(2 * math.pi * 132.0 * t)
        buf[i] = lp2 * 0.55 + cng

    # Distant soft rickshaw bell tings so the street feels alive without harshness
    for sec, f0 in ((1.1, 2180.0), (1.23, 2460.0), (3.8, 1980.0), (3.94, 2240.0)):
        start = int(sec * sr)
        blen = int(0.28 * sr)
        for j in range(blen):
            tj = j / sr
            bell = (math.sin(2 * math.pi * f0 * tj) + 0.4 * math.sin(2 * math.pi * f0 * 2.72 * tj)) * math.exp(-tj * 16.0)
            buf[(start + j) % n] += bell * 0.055

    write_wav(AUDIO_DIR / "ambience" / "dhaka-street-bed.wav", buf, sr, seamless_fade_ms=140.0)


def gen_bazaar_crowd() -> None:
    """5.0s seamless Town Hall Market crowd murmur & bustle."""
    sr = 16000
    n = sr * 5
    rng = random.Random(202)
    buf = [0.0] * n
    # Layered formant-filtered murmur voices at varying conversational syllabic rates
    bp_a = 0.0
    bp_b = 0.0
    for i in range(n):
        t = i / sr
        w = rng.uniform(-1.0, 1.0)
        bp_a += 0.14 * (w - bp_a)
        bp_b += 0.04 * (bp_a - bp_b)
        band = bp_a - bp_b
        # Conversational amplitude modulation across 4 asynchronous voices
        mod = (
            0.35 + 0.25 * math.sin(2 * math.pi * 3.2 * t + 0.3)
            + 0.20 * math.sin(2 * math.pi * 4.8 * t + 1.7)
            + 0.20 * math.sin(2 * math.pi * 2.2 * t + 2.9)
        )
        # Subtle voiced harmonic murmur
        voiced = (
            0.03 * math.sin(2 * math.pi * (165 + 14 * math.sin(2 * math.pi * 1.4 * t)) * t)
            + 0.025 * math.sin(2 * math.pi * (215 + 18 * math.cos(2 * math.pi * 1.8 * t)) * t)
        ) * max(0.1, mod)
        buf[i] = band * 0.38 * mod + voiced

    # Subtle scale/crate clink inside bazaar
    for sec, f in ((1.6, 1340.0), (3.6, 1580.0)):
        st = int(sec * sr)
        for j in range(int(0.14 * sr)):
            tj = j / sr
            buf[(st + j) % n] += 0.05 * math.sin(2 * math.pi * f * tj) * math.exp(-tj * 28.0)

    write_wav(AUDIO_DIR / "ambience" / "bazaar-crowd-loop.wav", buf, sr, seamless_fade_ms=140.0)


def gen_tea_stall_clink() -> None:
    """Roadside tong tea glass + spoon stir + kettle steam."""
    sr = 16000
    n = int(sr * 2.0)
    rng = random.Random(303)
    buf = [0.0] * n
    # Soft kettle steam hiss
    lp = 0.0
    for i in range(n):
        t = i / sr
        w = rng.uniform(-1.0, 1.0)
        lp += 0.25 * (w - lp)
        steam_env = math.sin(min(1.0, t / 0.25) * math.pi * 0.5) * math.exp(-max(0.0, t - 0.5) * 1.8)
        buf[i] = (w - lp) * 0.065 * steam_env

    # Characteristic Dhaka tea glass spoon stir clinks ('ting-ting-ting')
    for sec, freq, amp in ((0.18, 2860.0, 0.38), (0.33, 3120.0, 0.34), (0.52, 2890.0, 0.28), (0.88, 2740.0, 0.25)):
        st = int(sec * sr)
        for j in range(int(0.22 * sr)):
            if st + j >= n:
                break
            tj = j / sr
            c = (
                math.sin(2 * math.pi * freq * tj)
                + 0.48 * math.sin(2 * math.pi * (freq * 2.38) * tj)
            ) * math.exp(-tj * 24.0)
            buf[st + j] += c * amp

    write_wav(AUDIO_DIR / "ambience" / "tea-stall-clink.wav", buf, sr)


def synth_formant_phrase(sr: int, syllables: list[tuple[float, float, float, float, float]], breath_seed: int) -> list[float]:
    """
    Synthesize a short voiced syllable contour:
    each tuple = (start_s, dur_s, f0_hz, f1_hz, f2_hz).
    """
    rng = random.Random(breath_seed)
    end_s = max(s + d for s, d, _, _, _ in syllables) + 0.15
    n = int(sr * end_s)
    buf = [0.0] * n
    for start_s, dur_s, f0, f1, f2 in syllables:
        st = int(start_s * sr)
        ln = int(dur_s * sr)
        phase0 = 0.0
        for j in range(ln):
            if st + j >= n:
                break
            t = j / sr
            prog = t / max(0.01, dur_s)
            env = math.sin(min(1.0, prog / 0.14) * math.pi * 0.5) * math.sin(min(1.0, (1.0 - prog) / 0.22) * math.pi * 0.5)
            # Natural human pitch inflection + micro-vibrato
            pitch = f0 * (1.0 + 0.06 * math.sin(prog * math.pi) + 0.012 * math.sin(2 * math.pi * 5.6 * t))
            phase0 += pitch / sr
            # Glottal pulse approximation weighted around F1 and F2 formants
            h1 = max(1, round(f1 / pitch))
            h2 = max(h1 + 1, round(f2 / pitch))
            glottal = (
                0.45 * math.sin(2 * math.pi * phase0)
                + 0.55 * math.sin(2 * math.pi * phase0 * h1)
                + 0.32 * math.sin(2 * math.pi * phase0 * (h1 + 1))
                + 0.28 * math.sin(2 * math.pi * phase0 * h2)
                + 0.06 * rng.uniform(-1.0, 1.0)
            )
            buf[st + j] += glottal * max(0.0, env) * 0.34
    return buf


def gen_hawker_and_construction() -> None:
    sr = 16000
    # Hawker 1: Brass hand-bell + warm street vendor call ("এই গরম ফুচকা..." cadence)
    buf1 = synth_formant_phrase(
        sr,
        [
            (0.26, 0.24, 195.0, 520.0, 1480.0),
            (0.54, 0.22, 212.0, 620.0, 1180.0),
            (0.80, 0.38, 184.0, 700.0, 1260.0),
        ],
        breath_seed=401,
    )
    while len(buf1) < int(sr * 1.5):
        buf1.append(0.0)
    # Leading fuchka/ice-cream vendor brass bell
    for sec in (0.04, 0.14):
        st = int(sec * sr)
        for j in range(int(0.18 * sr)):
            tj = j / sr
            buf1[st + j] += 0.25 * (math.sin(2 * math.pi * 2320 * tj) + 0.4 * math.sin(2 * math.pi * 5180 * tj)) * math.exp(-tj * 22.0)
    write_wav(AUDIO_DIR / "ambience" / "hawker-call-1.wav", buf1, sr)

    # Hawker 2: Jhalmuri tin-canister rhythmic shake + spoon tap
    rng = random.Random(402)
    n2 = int(sr * 1.5)
    buf2 = [0.0] * n2
    for shake_t, gain in ((0.06, 0.36), (0.24, 0.26), (0.42, 0.40), (0.68, 0.28), (0.86, 0.35)):
        st = int(shake_t * sr)
        for j in range(int(0.13 * sr)):
            if st + j >= n2:
                break
            tj = j / sr
            grain = rng.uniform(-1.0, 1.0) * math.exp(-tj * 26.0)
            tin = 0.45 * math.sin(2 * math.pi * 1840.0 * tj) * math.exp(-tj * 35.0)
            buf2[st + j] += (grain * 0.55 + tin) * gain
    write_wav(AUDIO_DIR / "ambience" / "hawker-call-2.wav", buf2, sr)

    # Construction tap: localized distant masonry hammer / steel rod clink
    nc = int(sr * 1.4)
    bufc = [0.0] * nc
    for hit_t, f_rod, gain in ((0.08, 1180.0, 0.42), (0.46, 1210.0, 0.36), (0.84, 1165.0, 0.39)):
        st = int(hit_t * sr)
        for j in range(int(0.28 * sr)):
            if st + j >= nc:
                break
            tj = j / sr
            metal = (
                math.sin(2 * math.pi * f_rod * tj)
                + 0.55 * math.sin(2 * math.pi * (f_rod * 2.14) * tj)
                + 0.25 * rng.uniform(-1, 1) * math.exp(-tj * 70.0)
            ) * math.exp(-tj * 18.0)
            bufc[st + j] += metal * gain
    write_wav(AUDIO_DIR / "ambience" / "construction-tap.wav", bufc, sr)


def gen_sfx_and_dialogue() -> None:
    sr = 16000
    rng = random.Random(505)

    # 1. Cycle-rickshaw chain + freewheel ratchet + light frame rattle loop (2.0s seamless)
    n_chain = sr * 2
    chain = [0.0] * n_chain
    # 16 freewheel clicks per 2.0s (8 Hz base @ playbackRate=1.0) + soft chain roller texture
    clicks = 16
    step = n_chain // clicks
    lp = 0.0
    for i in range(n_chain):
        w = rng.uniform(-1.0, 1.0)
        lp += 0.18 * (w - lp)
        # Subtle tyre/chain rolling bed
        chain[i] = (w - lp) * 0.055 + lp * 0.04
    for c in range(clicks):
        st = c * step
        for j in range(int(0.032 * sr)):
            tj = j / sr
            click = (
                0.35 * math.sin(2 * math.pi * (2650.0 + (c % 3) * 90.0) * tj)
                + 0.25 * math.sin(2 * math.pi * 4120.0 * tj)
                + 0.25 * rng.uniform(-1, 1)
            ) * math.exp(-tj * 115.0)
            chain[(st + j) % n_chain] += click * (0.55 if c % 2 == 0 else 0.38)
    write_wav(AUDIO_DIR / "sfx" / "rickshaw-chain-loop.wav", chain, sr, seamless_fade_ms=40.0)

    # 2. টান speed boost activation: energetic wind whoosh + rapid chain spin-up
    n_tan = int(sr * 1.0)
    tan_buf = [0.0] * n_tan
    lp_t = 0.0
    for i in range(n_tan):
        t = i / sr
        w = rng.uniform(-1.0, 1.0)
        cutoff = 0.08 + 0.34 * math.sin(min(1.0, t / 0.45) * math.pi)
        lp_t += cutoff * (w - lp_t)
        env = math.sin(min(1.0, t / 0.12) * math.pi * 0.5) * math.exp(-max(0.0, t - 0.18) * 3.2)
        # Rising tonal air + chain spin
        chirp = 0.22 * math.sin(2 * math.pi * (180.0 + 260.0 * t) * t) * env
        tan_buf[i] = lp_t * 0.65 * env + chirp
    for k in range(9):
        st = int((0.04 + k * 0.065) * sr)
        for j in range(int(0.022 * sr)):
            if st + j < n_tan:
                tj = j / sr
                tan_buf[st + j] += 0.28 * math.sin(2 * math.pi * (2900 + k * 140) * tj) * math.exp(-tj * 130.0)
    write_wav(AUDIO_DIR / "sfx" / "tan-boost.wav", tan_buf, sr)

    # 3. Street lamp crash: hollow galvanized pole ring + bulb pop/spark
    n_lamp = int(sr * 1.1)
    lamp_buf = [0.0] * n_lamp
    for i in range(n_lamp):
        t = i / sr
        thud = 0.55 * math.sin(2 * math.pi * (95.0 * math.exp(-t * 8.0) + 48.0) * t) * math.exp(-t * 9.0)
        pole = (
            0.34 * math.sin(2 * math.pi * 418.0 * t) * math.exp(-t * 5.2)
            + 0.24 * math.sin(2 * math.pi * 912.0 * t) * math.exp(-t * 7.5)
            + 0.16 * math.sin(2 * math.pi * 1680.0 * t) * math.exp(-t * 11.0)
        )
        spark = 0.35 * rng.uniform(-1, 1) * math.exp(-t * 32.0)
        lamp_buf[i] = thud + pole + spark
    # Secondary glass/spark crackle at 0.18s
    for s_t, f_g in ((0.16, 3650.0), (0.24, 4280.0), (0.31, 3190.0)):
        st = int(s_t * sr)
        for j in range(int(0.08 * sr)):
            if st + j < n_lamp:
                tj = j / sr
                lamp_buf[st + j] += 0.24 * (math.sin(2 * math.pi * f_g * tj) + rng.uniform(-0.5, 0.5)) * math.exp(-tj * 45.0)
    write_wav(AUDIO_DIR / "sfx" / "lamp-crash.wav", lamp_buf, sr)

    # 4. Roadside stall crash: wooden cart crack + tumbling tin canisters/pots
    n_stall = int(sr * 1.2)
    stall_buf = [0.0] * n_stall
    for i in range(n_stall):
        t = i / sr
        wood_thud = 0.58 * math.sin(2 * math.pi * (115.0 * math.exp(-t * 12.0) + 52.0) * t) * math.exp(-t * 12.0)
        splinter = 0.48 * rng.uniform(-1, 1) * math.exp(-t * 24.0)
        stall_buf[i] = wood_thud + splinter
    # Cascading tin pots / plates clattering on pavement
    for s_t, f_p, amp in ((0.09, 1420.0, 0.32), (0.21, 1960.0, 0.28), (0.36, 1280.0, 0.25), (0.54, 2240.0, 0.20), (0.74, 1680.0, 0.16)):
        st = int(s_t * sr)
        for j in range(int(0.18 * sr)):
            if st + j < n_stall:
                tj = j / sr
                clatter = (
                    math.sin(2 * math.pi * f_p * tj)
                    + 0.45 * math.sin(2 * math.pi * (f_p * 1.62) * tj)
                ) * math.exp(-tj * 20.0)
                stall_buf[st + j] += clatter * amp
    write_wav(AUDIO_DIR / "sfx" / "stall-crash.wav", stall_buf, sr)

    # 5. Dialogue fallback cues (used ONLY when no native Android bn-BD TTS or browser bn-* voice exists)
    # Angry car driver ("ওই হারামজাদা, দাঁড়া!" - 7 emphatic baritone syllables)
    driver_cue = synth_formant_phrase(
        sr,
        [
            (0.05, 0.19, 152.0, 500.0, 980.0),   # ওই
            (0.28, 0.16, 166.0, 740.0, 1280.0),  # হা-
            (0.45, 0.17, 174.0, 680.0, 1340.0),  # -রাম-
            (0.63, 0.16, 158.0, 700.0, 1240.0),  # -জা-
            (0.80, 0.20, 144.0, 720.0, 1180.0),  # -দা,
            (1.08, 0.22, 178.0, 740.0, 1280.0),  # দাঁ-
            (1.31, 0.24, 138.0, 680.0, 1150.0),  # -ড়া!
        ],
        breath_seed=601,
    )
    write_wav(AUDIO_DIR / "dialogue" / "roadrage-driver-cue.wav", driver_cue, sr)

    # Apologetic player ("মাফ করে দেন ভাই, ভুলে লেগে গেছে!" - faster nervous higher register)
    player_cue = synth_formant_phrase(
        sr,
        [
            (0.04, 0.17, 210.0, 720.0, 1240.0),  # মাফ
            (0.23, 0.13, 198.0, 540.0, 1080.0),  # ক-
            (0.37, 0.14, 206.0, 480.0, 1780.0),  # -রে
            (0.53, 0.16, 196.0, 520.0, 1720.0),  # দেন
            (0.71, 0.22, 184.0, 720.0, 1380.0),  # ভাই,
            (1.00, 0.14, 208.0, 380.0, 960.0),   # ভু-
            (1.15, 0.14, 198.0, 480.0, 1760.0),  # -লে
            (1.31, 0.13, 202.0, 490.0, 1800.0),  # লে-
            (1.45, 0.14, 194.0, 480.0, 1750.0),  # -গে
            (1.61, 0.15, 190.0, 500.0, 1740.0),  # গে-
            (1.77, 0.20, 174.0, 480.0, 1680.0),  # -ছে!
        ],
        breath_seed=602,
    )
    write_wav(AUDIO_DIR / "dialogue" / "roadrage-player-cue.wav", player_cue, sr)


def main() -> None:
    gen_menu_music()
    gen_drive_music()
    gen_brishti_music()
    gen_street_ambience()
    gen_bazaar_crowd()
    gen_tea_stall_clink()
    gen_hawker_and_construction()
    gen_sfx_and_dialogue()
    total_bytes = sum(p.stat().st_size for p in AUDIO_DIR.rglob("*.wav"))
    print(f"\n[audio-gen] Generated all 15 original bundled audio assets ({total_bytes / (1024 * 1024):.2f} MB total).")


if __name__ == "__main__":
    main()
