#!/usr/bin/env python3
"""Compose one original, copyright-safe, offline chase/race music bed.

16 bars, 160 BPM, E-minor; hand-drum breaks, bass, plucked melodic answer,
shakers and a quiet sustained harmonic bed. Deterministic PCM, no downloads,
licensed loops, runtime synthesizers, speech or per-frame allocations.
"""
from __future__ import annotations
import math
import random
import wave
from array import array
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / 'public/audio/music/race-pursuit-pulse.wav'
SR, BPM, BARS = 22050, 160, 16
BEAT = 60 / BPM
N = round(SR * BEAT * 4 * BARS)
buf = [0.0] * N
rng = random.Random(20261031)


def freq(midi: int) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def add_note(when: float, dur: float, note: int, amp: float, kind: str) -> None:
    start = round(when * SR)
    length = round(dur * SR)
    hz = freq(note)
    for i in range(length):
        t = i / SR
        if kind == 'bass':
            env = (1 - math.exp(-t * 140)) * math.exp(-t * 3.4)
            value = (math.sin(2 * math.pi * hz * t) + .27 * math.sin(4 * math.pi * hz * t)) * env
        elif kind == 'pluck':
            env = (1 - math.exp(-t * 170)) * math.exp(-t * 8)
            value = (math.sin(2 * math.pi * hz * t) +
                     .36 * math.sin(4 * math.pi * hz * t) +
                     .14 * math.sin(6 * math.pi * hz * t)) * env
        else:  # organ-like low bed, subtly changing each chord
            env = min(1, t * 10) * min(1, max(0, (dur - t) * 8))
            value = (.70 * math.sin(2 * math.pi * hz * t) +
                     .15 * math.sin(4 * math.pi * hz * t)) * env
        buf[(start + i) % N] += amp * value


def drum(when: float, kind: str, accent: float = 1) -> None:
    start = round(when * SR)
    dur = .27 if kind == 'kick' else .18 if kind == 'snare' else .065
    for i in range(round(dur * SR)):
        t = i / SR
        if kind == 'kick':
            phase = 2 * math.pi * (53 * t + 54 * (1 - math.exp(-28 * t)) / 28)
            value = .67 * math.sin(phase) * math.exp(-13 * t)
            value += (rng.random() - .5) * .12 * math.exp(-130 * t)
        elif kind == 'snare':
            value = (rng.random() * 2 - 1) * .23 * math.exp(-24 * t)
            value += .28 * math.sin(2 * math.pi * 188 * t) * math.exp(-19 * t)
        else:
            value = (rng.random() * 2 - 1) * .10 * math.exp(-75 * t)
        buf[(start + i) % N] += value * accent


# Em / C / G / D, with stronger Em / Am / C / B turnaround in the final half.
roots = [40, 36, 43, 38, 40, 36, 43, 38, 40, 36, 43, 38, 40, 45, 36, 35]
chords = [(52, 55, 59), (48, 52, 55), (50, 55, 59), (50, 54, 57)]
lead = [64, 67, 69, 71, 74, 71, 69, 67, 64, 67, 69, 67, 76, 74, 71, 69]
for bar in range(BARS):
    offset = bar * 4 * BEAT
    root = roots[bar]
    for beat in range(4):
        t = offset + beat * BEAT
        drum(t, 'kick', 1.0 if beat in (0, 2) else .72)
        if beat in (1, 3):
            drum(t, 'snare', 1.0 if beat == 3 else .82)
        drum(t + BEAT * .5, 'hat', .76)
        if bar >= 4:
            drum(t + BEAT * .25, 'hat', .36)
            if beat in (1, 3):
                drum(t + BEAT * .75, 'hat', .48)
        if beat in (0, 2):
            add_note(t, BEAT * .92, root, .15, 'bass')
        else:
            add_note(t, BEAT * .68, root + 7, .095, 'bass')
    if bar % 4 == 3:
        for off in (3.5, 3.72, 3.85):
            drum(offset + BEAT * off, 'snare', .38)
    for note in chords[bar % 4]:
        add_note(offset, BEAT * 3.98, note, .011, 'bed')
    for step in range(8):
        if step % 4 == 3 and bar < 8:
            continue  # a breath in the melody before the denser final section
        at = offset + step * BEAT * .5
        pitch = lead[(step + bar * 3) % len(lead)]
        if step in (0, 4):
            pitch = root + 24  # answer with the chord root
        add_note(at, .29 if step % 2 else .37, pitch, .044 if step % 2 else .065, 'pluck')

# Smooth the PCM wrap without trimming any attack or adding a silent gap.
xf = round(SR * .085)
for i in range(xf):
    mix = (i + 1) / (xf + 1)
    first, last = buf[i], buf[-xf + i]
    blend = mix * first + (1 - mix) * last
    buf[i] = blend
    buf[-xf + i] = blend
peak = max(abs(sample) for sample in buf)
scale = .84 / max(.84, peak)
pcm = array('h', (round(max(-1, min(1, math.tanh(sample * scale * 1.18))) * 29600)
                  for sample in buf))
DEST.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(DEST), 'wb') as sound:
    sound.setnchannels(1)
    sound.setsampwidth(2)
    sound.setframerate(SR)
    sound.writeframes(pcm.tobytes())
print(f'{DEST.relative_to(ROOT)}: {N / SR:.2f}s, {DEST.stat().st_size:,} bytes, peak {max(abs(v) for v in pcm)}')
