"""Compose and render the site's background music: lo-fi café, polished for a product showcase. From code.

76 BPM, lightly swung, in D major, 16 bars that loop with no seam. The mood is a quiet café with the lights down:
- a warm Rhodes-style electric piano on jazzy rootless chords (Dmaj9 Bm9 Gmaj9 A7 / F#m9 Bm9 Em9 A13 / ...),
  strummed a little off the grid, with slow auto-pan and chorus
- a soft sub bass and a sparse, glassy music-box melody through a dotted-8th ping-pong echo
- the beat is soft and electronic, nothing like a real kit: a round sine thump (no click), a muted finger-snap
  where a snare would be, and a swelling shaker instead of a hi-hat; the keys and bass dip a little with each thump
- tape warmth (a slow wobble, saturation, a roll-off above 7.6 kHz), only a trace of vinyl crackle, a plate-like reverb
It is polished the way a product reel is: clean, quiet (-19 dBFS rms) and never sharp.

Seamless by construction: every note wraps around the loop end, delays and reverb are circular, filters run on a
3x tiled copy, and the tape wobble is periodic. The file holds the loop with 0.1 s of its own end in front and
0.5 s of its start behind, and the player loops the window in between (sample-accurate; see src/audio/music.ts).

(Alternative: build_music_calm.py, a calm electronic loop with no drums at all.)

Outputs
  public/audio/music.webm|mp3   Opus + mp3 fallback (stereo)
  src/audio/music.json          {"loop": [startMs, durationMs, true]} for Howler
  .cache/music/                 with --sheet: loop.wav, overview.png (spectrogram), bar.png (two bars, zoomed)

Run: python scripts/audio/build_music.py [--sheet]     (needs numpy, scipy, ffmpeg; Pillow for --sheet)
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
from scipy import signal

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_sfx import CACHE as SFX_CACHE, ROOT, SR, bp, find_ffmpeg, hp, lp, n_, tt  # noqa: E402

CACHE = SFX_CACHE.parent / "music"
rng = np.random.default_rng(20261001)  # fixed: rebuilds are identical before encoding

# ---------------------------------------------------------------- the song
BPM = 76
BEAT = 60 / BPM
BARS = 16
SWING = 0.56  # 8th-note swing: the off-beat sits at 56 % of the beat (50 % = straight); a light lilt
L = int(round(BARS * 4 * BEAT * SR))  # loop length, samples
LDUR = L / SR
T = np.arange(L) / SR
LEAD_IN = 0.1  # s of the loop's end placed before it in the file (absorbs codec priming)
LEAD_OUT = 0.5  # s of the loop's start placed after it

# Rootless voicings (MIDI) over a bass root; the bass supplies the root (kept at D2..B2: warm and audible, not rumble).
CHORDS = {
    "Dmaj9": (38, [54, 57, 61, 64]),
    "Bm9": (35, [50, 54, 57, 61]),
    "Gmaj9": (43, [57, 59, 62, 66]),
    "A7": (45, [59, 61, 64, 67]),
    "F#m9": (42, [57, 61, 64, 68]),
    "Em9": (40, [55, 59, 62, 66]),
    "A13": (45, [55, 59, 61, 66]),
    "Em7": (40, [55, 59, 62, 67]),
}
PROGRESSION = ["Dmaj9", "Bm9", "Gmaj9", "A7", "F#m9", "Bm9", "Em9", "A13",
               "Dmaj9", "Bm9", "Gmaj9", "Em7", "Gmaj9", "F#m9", "Em9", "A7"]

# Keys: how the chord is played each bar (beat position, length in beats, velocity).
COMP = [
    [(0, 2.2, 1.0), (2.5, 1.2, 0.65)],
    [(0, 1.6, 0.95), (1.5, 0.7, 0.6), (3, 0.9, 0.55)],
    [(0, 2.0, 1.0), (1.5, 1.0, 0.6)],
    [(0, 1.4, 0.95), (1.5, 0.6, 0.55), (2.5, 0.7, 0.6)],
]

# Melody (D major pentatonic plus chord tones): per bar, (beat, MIDI, length in beats).
MELODY = [
    [(0, 81, 1.0), (1.5, 78, 0.5), (2, 76, 1.0)],
    [(0, 74, 1.5), (2.5, 78, 0.5), (3, 76, 0.9)],
    [(0, 71, 1.5), (2, 74, 0.75), (3, 76, 0.9)],
    [(0, 73, 1.0), (1.5, 76, 0.5), (2.5, 73, 0.5), (3, 69, 0.9)],
    [(0, 73, 1.5), (2, 76, 0.75), (3, 78, 0.9)],
    [(0.5, 74, 0.75), (1.5, 71, 0.5), (2.5, 69, 0.9)],
    [(0, 74, 1.0), (1.5, 71, 0.5), (2, 67, 1.5)],
    [(0, 73, 0.9), (1.5, 71, 0.5), (2, 69, 0.9)],
    [(0, 78, 1.0), (1.5, 81, 0.5), (2, 83, 1.0)],
    [(0, 81, 1.5), (2.5, 78, 0.5), (3, 74, 0.9)],
    [(0, 79, 1.0), (1.5, 78, 0.5), (2, 74, 1.0)],
    [(0, 76, 1.5), (2.5, 74, 0.5), (3, 71, 0.9)],
    [(0.5, 74, 0.5), (1, 78, 1.5), (3, 76, 0.9)],
    [(0, 73, 1.0), (1.5, 76, 0.5), (2, 81, 1.0)],
    [(0, 78, 1.5), (2.5, 76, 0.5), (3, 74, 0.9)],
    [(0, 76, 1.0), (1.5, 73, 0.5), (2, 69, 1.5)],
]

# Mix (linear gains) and sound-design knobs.
MIX = dict(keys=0.7, bass=0.7, lead=0.6, kick=0.5, snare=0.42, hats=0.4, reverb=0.95, crackle=0.28, hiss=0.3)
TARGET_RMS_DB = -19.0  # the player sets the listening level; quiet and even, with room for the soft beat
CEILING = 0.89


# ---------------------------------------------------------------- helpers
def rn(sec: float) -> np.ndarray:
    return rng.standard_normal(n_(sec))


def mtof(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def swung(x: float) -> float:
    """Beat position -> swung beat position (8ths and 16ths both swing)."""
    b = np.floor(x)
    f = x - b
    f2 = f * 2 * SWING if f < 0.5 else SWING + (f - 0.5) * 2 * (1 - SWING)
    return float(b + f2)


def when(bar: int, x: float, jitter: float = 0.0, late: float = 0.0) -> float:
    return (bar * 4 + swung(x)) * BEAT + late + (rng.normal(0, jitter) if jitter else 0.0)


def addc(buf: np.ndarray, sig: np.ndarray, t0: float, gain: float = 1.0) -> None:
    """Add `sig` into the circular buffer at t0 seconds: what passes the end wraps to the start."""
    i = int(round(t0 * SR))
    m = min(len(sig), L)
    idx = (i + np.arange(m)) % L
    buf[idx] += gain * sig[:m]


def circ(fn, x: np.ndarray) -> np.ndarray:
    """Run a causal filter on a 3x tiled copy and keep the middle: no seam at the loop point."""
    y = fn(np.concatenate([x, x, x], axis=-1))
    return y[..., L : 2 * L]


def sos(kind: str, f, order: int = 2):
    return signal.butter(order, f, btype=kind, fs=SR, output="sos")


def rolled_delay(x: np.ndarray, sec: float) -> np.ndarray:
    return np.roll(x, int(round(sec * SR)))


def mod_delay(x: np.ndarray, base: float, depth: float, cycles: int, phase: float = 0.0) -> np.ndarray:
    """Chorus: a delay line whose length swings `depth` s around `base` s, `cycles` times per loop."""
    d = (base + depth * np.sin(2 * np.pi * cycles * T / LDUR + phase)) * SR
    pos = np.arange(L) - d
    i0 = np.floor(pos).astype(int)
    fr = pos - i0
    return x[i0 % L] * (1 - fr) + x[(i0 + 1) % L] * fr


# ---------------------------------------------------------------- instruments
def ep_note(f: float, dur: float, vel: float) -> np.ndarray:
    """Electric piano: FM tine that mellows as it rings, a short bell overtone and a felt thump."""
    t = tt(dur + 1.4)
    bright = 0.6 + 0.8 * vel
    idx = bright * 2.2 * np.exp(-t / 0.5) + 0.32
    ph = 2 * np.pi * f * t
    x = np.sin(ph + idx * np.sin(ph))
    x += 0.10 * bright * np.sin(2 * np.pi * f * 7.02 * t) * np.exp(-t / 0.05)
    tau = 1.5 * (262 / f) ** 0.35
    env = np.sin(np.pi / 2 * np.minimum(t / 0.004, 1)) ** 2 * np.exp(-t / tau)
    env *= np.where(t > dur, np.exp(-(t - dur) / 0.16), 1.0)
    thump = lp(rn(0.02), 900) * np.exp(-tt(0.02) / 0.006) * 0.25
    x = x * env
    x[: len(thump)] += thump * vel
    return x * vel


def bass_note(f: float, dur: float, vel: float) -> np.ndarray:
    t = tt(dur + 0.25)
    ph = 2 * np.pi * np.cumsum(f * (1 + 0.04 * np.exp(-t / 0.02))) / SR
    x = np.sin(ph) + 0.30 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph)
    env = np.sin(np.pi / 2 * np.minimum(t / 0.022, 1)) ** 2 * np.exp(-t / 0.9)
    env *= np.where(t > dur, np.exp(-(t - dur) / 0.07), 1.0)
    return np.tanh(1.8 * x * env) * vel * 0.7  # saturated: harmonics carry it on small speakers


def lead_note(f: float, dur: float, vel: float) -> np.ndarray:
    """A soft glassy music-box pluck."""
    t = tt(dur + 1.0)
    ph = 2 * np.pi * f * t
    x = np.sin(ph) + 0.35 * np.sin(2 * ph) * np.exp(-t / 0.12) + 0.10 * np.sin(3 * ph) * np.exp(-t / 0.06)
    x += 0.10 * np.sin(2 * np.pi * f * 4.17 * t) * np.exp(-t / 0.09)  # a music-box glint
    env = np.sin(np.pi / 2 * np.minimum(t / 0.005, 1)) ** 2 * np.exp(-t / 0.5)
    env *= np.where(t > dur, np.exp(-(t - dur) / 0.2), 1.0)
    return lp(x * env, 4200) * vel


def kick(vel: float) -> np.ndarray:
    """A round electronic thump: a sine that settles as it fades, rising in over 6 ms. No beater click."""
    t = tt(0.45)
    ph = 2 * np.pi * np.cumsum(58 + 70 * np.exp(-t / 0.04)) / SR
    x = np.sin(ph) * np.sin(np.pi / 2 * np.clip(t / 0.006, 0, 1)) ** 2 * np.exp(-t / 0.17)
    return np.tanh(1.2 * x) * vel


def snap(vel: float) -> np.ndarray:
    """A muted finger-snap: a woody ping and a soft puff of air. No snare rattle, no sharp edge."""
    t = tt(0.22)
    ping = 0.5 * np.sin(2 * np.pi * 340 * t) * np.exp(-t / 0.03) + 0.25 * np.sin(2 * np.pi * 820 * t) * np.exp(-t / 0.015)
    puff = bp(rn(0.22), 1400, 3800) * np.sin(np.pi / 2 * np.clip(t / 0.004, 0, 1)) ** 2 * np.exp(-t / 0.05)
    return lp(ping + 0.9 * puff / max(np.max(np.abs(puff)), 1e-9), 4200) * vel


def shaker(vel: float) -> np.ndarray:
    """A soft swelling shaker (12 ms in), not a hi-hat's tick."""
    t = tt(0.09)
    x = bp(rn(0.09), 4500, 9500) * np.sin(np.pi / 2 * np.clip(t / 0.012, 0, 1)) ** 2 * np.exp(-t / 0.03)
    return x / max(np.max(np.abs(x)), 1e-9) * vel


# ---------------------------------------------------------------- compose
def render() -> np.ndarray:
    keys, bass, lead = np.zeros(L), np.zeros(L), np.zeros(L)
    kicks, snares, hats = np.zeros(L), np.zeros(L), np.zeros(L)
    kick_times: list[float] = []

    for bar, name in enumerate(PROGRESSION):
        root, voicing = CHORDS[name]
        # keys: strummed, off the grid, a hair of detune (tape)
        for pos, ln, vel in COMP[bar % 4]:
            t0 = when(bar, pos, jitter=0.004)
            v = vel * (1 + rng.normal(0, 0.05))
            for k, m in enumerate(voicing):
                f = mtof(m) * 2 ** (rng.normal(0, 3) / 1200)
                addc(keys, ep_note(f, ln * BEAT, v * (0.92 + 0.04 * k)), t0 + k * 0.011 + abs(rng.normal(0, 0.003)))
        # bass: the root on the downbeat and a push on 2&, a fifth walking into the next bar every 4th
        addc(bass, bass_note(mtof(root), 1.5 * BEAT, 1.0), when(bar, 0, 0.002))
        addc(bass, bass_note(mtof(root), 0.9 * BEAT, 0.7), when(bar, 2.5, 0.003))
        if bar % 4 == 3:
            addc(bass, bass_note(mtof(root + 7), 0.4 * BEAT, 0.6), when(bar, 3.5, 0.003))
        # melody
        for pos, m, ln in MELODY[bar]:
            addc(lead, lead_note(mtof(m), ln * BEAT, 0.8 + rng.normal(0, 0.05)), when(bar, pos, 0.004))
        # the soft beat: a thump on 1 and 2&, a third on odd bars, a muted snap on 2 and 4, a swelling shaker
        ks = [(0, 1.0), (1.5, 0.75)] + ([(2.75, 0.5)] if bar % 2 else [])
        for pos, v in ks:
            t0 = when(bar, pos, 0.003)
            addc(kicks, kick(v), t0)
            kick_times.append(t0)
        for pos in (1, 3):
            addc(snares, snap(1.0 + rng.normal(0, 0.05)), when(bar, pos, 0.003, late=0.012))
        if bar % 2:
            addc(snares, snap(0.2), when(bar, 3.75, 0.004, late=0.012))
        if bar in (7, 15):
            addc(snares, snap(0.3), when(bar, 3.5, 0.004))
            addc(snares, snap(0.45), when(bar, 3.75, 0.004))
        for k in range(8):
            if rng.random() < 0.1:
                continue
            addc(hats, shaker((0.9 if k % 2 == 0 else 0.5) * (1 + rng.normal(0, 0.12))), when(bar, k / 2, 0.004))

    # drums get a sampler-style crunch: held at 24 kHz
    for d in (kicks, snares, hats):
        d[:] = np.repeat(d[::2], 2)[:L]

    # sidechain: the keys and bass dip a little with every kick
    dip = np.zeros(L)
    tk = np.arange(n_(0.6)) / SR
    for k0 in kick_times:
        addc(dip, 0.18 * np.exp(-tk / 0.13), k0)
    duck = 1 - np.clip(dip, 0, 0.26)
    keys *= duck
    bass *= duck

    # keys: slow auto-pan (one cycle per 2 beats) and a chorus
    th = np.pi / 4 + 0.28 * np.sin(2 * np.pi * (BARS * 2) * T / LDUR)
    ch1 = mod_delay(keys, 0.011, 0.003, 20)
    ch2 = mod_delay(keys, 0.011, 0.003, 20, np.pi)
    keys_l = keys * np.cos(th) + 0.35 * ch1
    keys_r = keys * np.sin(th) + 0.35 * ch2

    # lead: dotted-8th ping-pong echo, darker each repeat
    lead_l, lead_r = lead * 0.6, lead * 0.6
    dly = 0.75 * BEAT
    for k in range(1, 6):
        echo = circ(lambda z: signal.sosfilt(sos("lowpass", 2200), z), rolled_delay(lead, dly * k)) * 0.5**k * 1.6
        (lead_r if k % 2 else lead_l).__iadd__(echo)

    # a plate-like reverb: one decorrelated impulse response per side, applied circularly
    def ir(seed: int) -> np.ndarray:
        r = np.random.default_rng(seed)
        t = tt(2.4)
        x = r.standard_normal(len(t)) * np.exp(-t / 0.3)
        x = np.concatenate([np.zeros(n_(0.022)), x])
        return signal.sosfilt(sos("lowpass", 4200), x)

    send_l = 0.30 * keys_l + 0.35 * lead_l + 0.30 * snares + 0.05 * hats
    send_r = 0.30 * keys_r + 0.35 * lead_r + 0.30 * snares + 0.05 * hats
    mid = np.fft.rfft((send_l + send_r) / 2, L)
    wet_l = np.fft.irfft(mid * np.fft.rfft(ir(1), L), L) * 0.05
    wet_r = np.fft.irfft(mid * np.fft.rfft(ir(2), L), L) * 0.05

    hat_pan_r, hat_pan_l = hats * 0.82, hats * 0.58
    left = MIX["keys"] * keys_l + MIX["bass"] * bass + MIX["lead"] * lead_l + MIX["kick"] * kicks + MIX["snare"] * snares \
        + MIX["hats"] * hat_pan_l + MIX["reverb"] * wet_l
    right = MIX["keys"] * keys_r + MIX["bass"] * bass + MIX["lead"] * lead_r + MIX["kick"] * kicks + MIX["snare"] * snares \
        + MIX["hats"] * hat_pan_r + MIX["reverb"] * wet_r
    mix = np.stack([left, right])

    # master: tape (wobble, warmth, saturation), then vinyl on top
    mix = circ(lambda z: signal.sosfilt(sos("highpass", 46, 3), z, axis=-1), mix)
    mix = circ(lambda z: signal.sosfilt(sos("lowpass", 7600, 2), z, axis=-1), mix)
    mix = wobble(mix)
    mix = mix + 0.5 * circ(lambda z: signal.sosfilt(sos("highpass", 1500), z, axis=-1), mix)  # presence: a soft shelf above 1.5 kHz
    mix *= 0.12 / np.sqrt(np.mean(mix**2))  # a known level into the saturator (peaks reach ~0.5)
    mix = np.tanh(2.4 * mix) / 2.4  # gentle tape saturation: unity gain for small signals
    mix *= 10 ** (TARGET_RMS_DB / 20) / np.sqrt(np.mean(mix**2))
    mix += vinyl()
    return CEILING * np.tanh(mix / CEILING)


def wobble(x: np.ndarray) -> np.ndarray:
    """Tape wow (~0.5 Hz) and flutter (~6 Hz). Whole cycles per loop, so the loop point doesn't jump."""
    k1, k2 = 26, 311
    d = (0.00095 * np.sin(2 * np.pi * k1 * T / LDUR + 0.7) + 0.000016 * np.sin(2 * np.pi * k2 * T / LDUR)) * SR
    pos = np.arange(L) + d
    i0 = np.floor(pos).astype(int)
    fr = pos - i0
    return np.stack([c[i0 % L] * (1 - fr) + c[(i0 + 1) % L] * fr for c in x])


def vinyl() -> np.ndarray:
    """Crackle (small ticks, a few low pops) and a thin hiss. Independent per side."""
    out = []
    for _ in range(2):
        ticks = np.zeros(L)
        k = int(LDUR * 16)
        ticks[rng.integers(0, L, k)] += rng.exponential(0.25, k) * rng.choice([-1, 1], k)
        ticks = circ(lambda z: signal.sosfilt(sos("bandpass", [1500, 8000]), z), ticks)
        pops = np.zeros(L)
        k = int(LDUR * 1.5)
        pops[rng.integers(0, L, k)] += rng.uniform(0.5, 1.0, k) * rng.choice([-1, 1], k)
        pops = circ(lambda z: signal.sosfilt(sos("bandpass", [70, 700]), z), pops) * 2.2
        hiss = circ(lambda z: signal.sosfilt(sos("bandpass", [900, 6500]), z), rng.standard_normal(L))
        out.append(MIX["crackle"] * 0.012 * (ticks + pops) + MIX["hiss"] * 0.0016 * hiss)
    return np.stack(out)


# ---------------------------------------------------------------- output
def write_wav_stereo(path: Path, x: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = np.clip(np.round(x.T * 32767), -32768, 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def overview(x: np.ndarray, out: Path, t0: float = 0.0, span: float | None = None, size=(1500, 420)) -> None:
    from PIL import Image

    mono = x.mean(axis=0)
    a = int(t0 * SR)
    b = len(mono) if span is None else a + int(span * SR)
    seg = mono[a:b]
    f, _, S = signal.spectrogram(seg, SR, nperseg=2048, noverlap=1536)
    S = 10 * np.log10(S + 1e-12)
    S = np.clip((S - (S.max() - 75)) / 75, 0, 1)
    ys = np.geomspace(60, 14000, size[1])[::-1]
    S = S[np.searchsorted(f, ys).clip(0, len(f) - 1)]
    img = np.array(Image.fromarray((S * 255).astype("uint8")).resize(size))
    rgb = np.stack([img, (img * 0.85).astype("uint8"), (img * 0.6).astype("uint8")], -1)
    Image.fromarray(rgb).save(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", action="store_true", help="also write loop.wav and spectrogram images to .cache/music")
    args = ap.parse_args()

    loop = render()
    peak = np.max(np.abs(loop))
    print(f"loop {LDUR:.2f} s ({BARS} bars at {BPM} BPM), peak {20 * np.log10(peak):.1f} dBFS, "
          f"rms {20 * np.log10(np.sqrt(np.mean(loop**2))):.1f} dBFS")

    file = np.concatenate([loop[:, -n_(LEAD_IN):], loop, loop[:, : n_(LEAD_OUT)]], axis=1)
    CACHE.mkdir(parents=True, exist_ok=True)
    wav = CACHE / "music.wav"
    write_wav_stereo(wav, file)
    ff = find_ffmpeg()
    out = ROOT / "public" / "audio"
    out.mkdir(parents=True, exist_ok=True)
    enc = lambda *a: subprocess.run([ff, "-y", "-hide_banner", "-loglevel", "error", "-i", str(wav), *a], check=True)
    enc("-c:a", "libopus", "-b:a", "64k", "-application", "audio", str(out / "music.webm"))
    enc("-ar", "44100", "-c:a", "libmp3lame", "-b:a", "96k", str(out / "music.mp3"))
    (ROOT / "src" / "audio").mkdir(parents=True, exist_ok=True)
    (ROOT / "src" / "audio" / "music.json").write_text(
        json.dumps({"loop": [round(LEAD_IN * 1000, 3), round(LDUR * 1000, 3), True]}, indent=2) + "\n", encoding="utf-8")
    kb = lambda p: (out / p).stat().st_size / 1024
    print(f"music.webm {kb('music.webm'):.0f} KB, music.mp3 {kb('music.mp3'):.0f} KB")

    if args.sheet:
        write_wav_stereo(CACHE / "loop.wav", loop)
        overview(loop, CACHE / "overview.png")
        overview(loop, CACHE / "bar.png", t0=0.0, span=4 * BEAT * 2, size=(1500, 420))
        print(f"wrote {CACHE}")


if __name__ == "__main__":
    main()
