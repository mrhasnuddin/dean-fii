"""An alternative background track: a calm, modern electronic loop (the site's second music), from code. No samples.

Kept for comparison. It does NOT write to the site: its files go to .cache/music-calm/ (copy them over
public/audio/music.* and src/audio/music.json to use them). The site's track is build_music.py.

No drum kit. The "beat" is electronic and soft:
- a warm synth pad (detuned saws, slowly opening and closing) carries the harmony
- a sine pulse with no click stands in for percussion; the pad and arpeggio dip a little with each pulse
  (side-chain "breathing"), which gives the rhythm without any drum sound
- a gentle mallet arpeggio and a few tiny pitched ticks run through a long dotted-8th ping-pong echo
- a sub bass on the chord roots, a slow tide of filtered air, and a big soft reverb

80 BPM, D major, 16 bars (48.0 s): Dmaj9 | Bm11 | Gmaj9 | Asus | F#m11 | Bm9 | Em9 | A13sus, two bars each.
Everything is straight (no swing, no humanising): modern and still. Quiet by design: -20 dBFS rms with a
10 dB crest, nothing sharp, and the player sets the listening level (src/audio/music.ts).

Seamless by construction: notes wrap around the loop end, delays and reverb are circular, filters run on a 3x
tiled copy. The file holds the loop with 0.1 s of its own end in front and 0.5 s of its start behind; the
player loops the window in between (sample-accurate).

Outputs
  .cache/music-calm/site-files/music.webm|mp3   Opus + mp3 fallback (stereo)
  .cache/music-calm/music.json                  {"loop": [startMs, durationMs, true]} for Howler
  .cache/music-calm/                            with --sheet: loop.wav, overview.png, bar.png

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
from build_sfx import CACHE as SFX_CACHE, ROOT, SR, find_ffmpeg, lp, n_, tt  # noqa: E402

CACHE = SFX_CACHE.parent / "music-calm"
rng = np.random.default_rng(20261002)  # fixed: rebuilds are identical before encoding

# ---------------------------------------------------------------- the song
BPM = 80
BEAT = 60 / BPM
BARS = 16
L = int(round(BARS * 4 * BEAT * SR))
LDUR = L / SR
T = np.arange(L) / SR
LEAD_IN = 0.1  # s of the loop's end placed before it in the file (absorbs codec priming)
LEAD_OUT = 0.5  # s of the loop's start placed after it

# Two bars each. Pad voicings are MIDI notes (open, mid register); the bass supplies the root.
CHORDS = [
    ("Dmaj9", 38, [54, 57, 61, 64, 69]),
    ("Bm11", 35, [50, 57, 61, 64, 66]),
    ("Gmaj9", 43, [59, 62, 66, 69, 73]),
    ("Asus", 45, [57, 62, 64, 69, 71]),
    ("F#m11", 42, [57, 61, 64, 68, 71]),
    ("Bm9", 35, [57, 62, 66, 69, 73]),
    ("Em9", 40, [55, 62, 66, 69, 71]),
    ("A13sus", 45, [55, 59, 62, 64, 69]),
]

# How present the arpeggio is, bar by bar: it breathes in, stays, and settles back for the loop.
ARP_GAIN = [0.55, 0.6, 0.8, 0.85, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.95, 0.85, 0.8, 0.7, 0.6]
ARP_MASKS = [  # which of the 8 eighth-notes in a bar sound
    [1, 0, 1, 1, 0, 1, 0, 1],
    [1, 0, 0, 1, 1, 0, 1, 0],
    [1, 1, 0, 1, 0, 1, 0, 0],
    [1, 0, 1, 0, 0, 1, 1, 0],
]

# Mix (linear gains).
MIX = dict(pad=0.95, bass=0.62, pulse=0.6, arp=0.5, ticks=0.35, air=0.5, sheen=1.0, reverb=1.0)
TARGET_RMS_DB = -20.0
CEILING = 0.85


# ---------------------------------------------------------------- helpers
def mtof(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def addc(buf: np.ndarray, sig: np.ndarray, t0: float, gain: float = 1.0) -> None:
    """Add `sig` into the circular buffer at t0 seconds: what passes the end wraps to the start."""
    i = int(round(t0 * SR))
    m = min(len(sig), L)
    idx = (i + np.arange(m)) % L
    buf[idx] += gain * sig[:m]


def circ(fn, x: np.ndarray) -> np.ndarray:
    """Run a causal filter on a 3x tiled copy and keep the middle: no seam at the loop point."""
    return fn(np.concatenate([x, x, x], axis=-1))[..., L : 2 * L]


def sos(kind: str, f, order: int = 2):
    return signal.butter(order, f, btype=kind, fs=SR, output="sos")


def filt(kind: str, f, x: np.ndarray, order: int = 2) -> np.ndarray:
    return circ(lambda z: signal.sosfilt(sos(kind, f, order), z, axis=-1), x)


def mod_delay(x: np.ndarray, base: float, depth: float, cycles: int, phase: float = 0.0) -> np.ndarray:
    """Chorus: a delay line whose length swings `depth` s around `base` s, `cycles` times per loop."""
    d = (base + depth * np.sin(2 * np.pi * cycles * T / LDUR + phase)) * SR
    pos = np.arange(L) - d
    i0 = np.floor(pos).astype(int)
    fr = pos - i0
    return x[i0 % L] * (1 - fr) + x[(i0 + 1) % L] * fr


def lfo(cycles: float, phase: float = 0.0) -> np.ndarray:
    """0..1, whole cycles per loop."""
    return 0.5 + 0.5 * np.sin(2 * np.pi * cycles * T / LDUR + phase)


# ---------------------------------------------------------------- instruments
def saw(f: float, dur: float, cents: float) -> np.ndarray:
    t = tt(dur)
    return 2 * ((f * 2 ** (cents / 1200) * t + rng.random()) % 1.0) - 1


def pad_chord(notes: list[int], dur: float) -> np.ndarray:
    """A chord of detuned saws and sines that swells in over 1.6 s and releases over 2.2 s."""
    ATT, REL = 1.6, 2.2
    t = tt(dur + REL)
    env = np.sin(np.pi / 2 * np.clip(t / ATT, 0, 1)) ** 2 * np.where(t > dur, np.cos(np.pi / 2 * np.clip((t - dur) / REL, 0, 1)) ** 2, 1.0)
    out = np.zeros(len(t))
    for m in notes:
        f = mtof(m)
        tone = (saw(f, dur + REL, -9) + saw(f, dur + REL, 0) + saw(f, dur + REL, 9)) * 0.2 + 0.45 * np.sin(2 * np.pi * f * t + rng.random() * 6.28)
        out += tone
    return out * env / len(notes) * 2.2


def bass_note(f: float, dur: float) -> np.ndarray:
    """A sub with enough second harmonic to be heard on small speakers; no attack click."""
    t = tt(dur + 0.5)
    ph = 2 * np.pi * f * t
    x = np.sin(ph) + 0.45 * np.sin(2 * ph) + 0.15 * np.sin(3 * ph)
    env = np.sin(np.pi / 2 * np.clip(t / 0.04, 0, 1)) ** 2 * np.exp(-t / 3.2) * np.where(t > dur, np.exp(-(t - dur) / 0.25), 1.0)
    return x * env


def pulse(f: float, vel: float) -> np.ndarray:
    """The soft electronic pulse: a sine that settles down a little as it fades, rising in over 12 ms (no click)."""
    t = tt(0.6)
    ph = 2 * np.pi * np.cumsum(f * (1 + 0.8 * np.exp(-t / 0.035))) / SR
    env = np.sin(np.pi / 2 * np.clip(t / 0.012, 0, 1)) ** 2 * np.exp(-t / 0.2)
    return np.sin(ph) * env * vel


def mallet(f: float, vel: float) -> np.ndarray:
    """A soft marimba/kalimba-like tone: a sine and a quick octave, with a faint inharmonic top."""
    t = tt(1.6)
    x = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.55)
    x += 0.26 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / 0.22)
    x += 0.09 * np.sin(2 * np.pi * 3.99 * f * t) * np.exp(-t / 0.07)
    x *= np.sin(np.pi / 2 * np.clip(t / 0.004, 0, 1)) ** 2
    return lp(x, 7500) * vel


def tick(f: float, vel: float) -> np.ndarray:
    """A tiny pitched blip, like a UI chirp."""
    t = tt(0.06)
    return np.sin(2 * np.pi * f * t) * np.exp(-t / 0.007) * np.sin(np.pi / 2 * np.clip(t / 0.0015, 0, 1)) * vel


# ---------------------------------------------------------------- compose
def arp_pool(notes: list[int], root: int) -> list[int]:
    pcs = sorted({m % 12 for m in notes + [root]})
    base = sorted(64 + ((pc - 64) % 12) for pc in pcs)  # one octave, E4..D#5
    return sorted(base + [m + 12 for m in base if m + 12 <= 85])


def render() -> np.ndarray:
    pad, bass, pulses = np.zeros(L), np.zeros(L), np.zeros(L)
    arp, ticks = np.zeros(L), np.zeros(L)
    pulse_times: list[tuple[float, float]] = []

    for c, (name, root, notes) in enumerate(CHORDS):
        t0 = c * 2 * 4 * BEAT
        addc(pad, pad_chord(notes, 2 * 4 * BEAT), t0)
        addc(bass, bass_note(mtof(root), 2 * 4 * BEAT), t0)

    for bar in range(BARS):
        name, root, notes = CHORDS[bar // 2]
        # the pulse: beat 1 and beat 3, with a faint one on the last off-beat of every other bar
        hits = [(0.0, 1.0), (2.0, 0.7)] + ([(3.5, 0.3)] if bar % 2 else [])
        for x, v in hits:
            t0 = (bar * 4 + x) * BEAT
            addc(pulses, pulse(mtof(root), v), t0)
            pulse_times.append((t0, v))
        # the arpeggio: a gentle random walk over the chord's tones, on the bar's pattern of eighths
        pool = arp_pool(notes, root)
        if bar % 2 == 0:
            idx = int(rng.integers(len(pool) // 3, 2 * len(pool) // 3))
        for step, on in enumerate(ARP_MASKS[bar % 4]):
            if not on:
                continue
            idx = int(np.clip(idx + rng.choice([-2, -1, -1, 1, 1, 2, 3]), 0, len(pool) - 1))
            addc(arp, mallet(mtof(pool[idx]), ARP_GAIN[bar] * (0.85 + 0.15 * rng.random())), (bar * 4 + step * 0.5) * BEAT)
        # a few tiny ticks on the 16th off-beats
        for x in rng.choice([0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75], size=int(rng.integers(2, 4)), replace=False):
            addc(ticks, tick(float(rng.choice([3136.0, 4186.0, 5274.0, 6272.0])), 0.5 + 0.5 * rng.random()), (bar * 4 + x) * BEAT)

    # breathing: the pad and arpeggio dip a little with every pulse
    dip = np.zeros(L)
    tk = np.arange(n_(0.8)) / SR
    for t0, v in pulse_times:
        addc(dip, 0.32 * v * np.exp(-tk / 0.22), t0)
    duck = 1 - np.clip(dip, 0, 0.4)
    pad *= duck
    arp *= duck

    # the pad opens and closes slowly: three filtered copies crossfaded by a two-cycle LFO
    pad = filt("highpass", 90, pad)
    m = lfo(2, -1.2) * 2  # 0..2
    w_lo, w_mid, w_hi = np.clip(1 - m, 0, 1), 1 - np.abs(m - 1), np.clip(m - 1, 0, 1)
    pad = w_lo * filt("lowpass", 700, pad, 4) + w_mid * filt("lowpass", 1600, pad, 4) + w_hi * filt("lowpass", 4200, pad, 4)
    # width: a slow chorus, a different one each side
    pad_l = 0.8 * pad + 0.5 * mod_delay(pad, 0.019, 0.005, 19)
    pad_r = 0.8 * pad + 0.5 * mod_delay(pad, 0.023, 0.005, 17, np.pi)

    # the arpeggio and ticks: dotted-8th ping-pong echo, a little darker on every repeat
    echo_in = arp + 4 * MIX["ticks"] * ticks  # the ticks are heard through the echo only
    arp_l, arp_r = 0.55 * echo_in, 0.55 * echo_in
    d = int(round(0.75 * BEAT * SR))
    for k in range(1, 7):
        echo = filt("lowpass", 5400, np.roll(echo_in, d * k)) * 0.62**k * 1.5
        (arp_r if k % 2 else arp_l).__iadd__(echo)

    # air: a slow tide of filtered noise, different each side
    air = []
    for _ in range(2):
        spec = np.fft.rfft(rng.standard_normal(L))
        fr = np.fft.rfftfreq(L, 1 / SR)
        spec *= np.exp(-0.5 * (np.log(np.maximum(fr, 1) / 1100) / 0.9) ** 2)
        x = np.fft.irfft(spec, L)
        air.append(x / np.max(np.abs(x)) * lfo(2, 0.4 + len(air)) ** 2)
    air_l, air_r = air
    # sheen: a very faint, slowly drifting shimmer high up (what keeps it open rather than muffled)
    sheen = []
    for k in range(2):
        spec = np.fft.rfft(rng.standard_normal(L))
        fr = np.fft.rfftfreq(L, 1 / SR)
        spec *= np.exp(-0.5 * (np.log(np.maximum(fr, 1) / 7500) / 0.32) ** 2)
        x = np.fft.irfft(spec, L)
        sheen.append(x / np.max(np.abs(x)) * lfo(4, 1.1 + 2.1 * k) ** 2)
    sheen_l, sheen_r = sheen

    # reverb: a long soft hall, applied circularly
    def ir(seed: int) -> np.ndarray:
        r = np.random.default_rng(seed)
        t = tt(4.6)
        x = r.standard_normal(len(t)) * np.exp(-t / 0.55) * np.sin(np.pi / 2 * np.clip(t / 0.04, 0, 1))
        x = np.concatenate([np.zeros(n_(0.035)), x])
        return signal.sosfilt(sos("lowpass", 7500), x)

    send = 0.22 * (pad_l + pad_r) / 2 + 0.55 * (arp_l + arp_r) / 2 + 0.1 * pulses
    spec = np.fft.rfft(send, L)
    wet_l = np.fft.irfft(spec * np.fft.rfft(ir(11), L), L) * 0.06
    wet_r = np.fft.irfft(spec * np.fft.rfft(ir(12), L), L) * 0.06

    left = MIX["pad"] * pad_l + MIX["bass"] * bass + MIX["pulse"] * pulses + MIX["arp"] * arp_l + MIX["air"] * 0.02 * air_l + MIX["sheen"] * 0.03 * sheen_l + MIX["reverb"] * wet_l
    right = MIX["pad"] * pad_r + MIX["bass"] * bass + MIX["pulse"] * pulses + MIX["arp"] * arp_r + MIX["air"] * 0.02 * air_r + MIX["sheen"] * 0.03 * sheen_r + MIX["reverb"] * wet_r
    mix = np.stack([left, right])

    # master: clear the rumble, smooth the very top, glue gently, and set the level
    mix = filt("highpass", 32, mix)
    mix = filt("lowpass", 12000, mix)
    mix *= 0.1 / np.sqrt(np.mean(mix**2))
    mix = np.tanh(2.0 * mix) / 2.0
    mix *= 10 ** (TARGET_RMS_DB / 20) / np.sqrt(np.mean(mix**2))
    return CEILING * np.tanh(mix / CEILING)


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
    f, _, S = signal.spectrogram(mono[a:b], SR, nperseg=2048, noverlap=1536)
    S = 10 * np.log10(S + 1e-12)
    S = np.clip((S - (S.max() - 75)) / 75, 0, 1)
    ys = np.geomspace(60, 14000, size[1])[::-1]
    S = S[np.searchsorted(f, ys).clip(0, len(f) - 1)]
    img = np.array(Image.fromarray((S * 255).astype("uint8")).resize(size))
    Image.fromarray(np.stack([img, (img * 0.85).astype("uint8"), (img * 0.6).astype("uint8")], -1)).save(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", action="store_true", help="also write loop.wav and spectrogram images to .cache/music-calm")
    args = ap.parse_args()

    loop = render()
    print(f"loop {LDUR:.2f} s ({BARS} bars at {BPM} BPM), peak {20 * np.log10(np.max(np.abs(loop))):.1f} dBFS, "
          f"rms {20 * np.log10(np.sqrt(np.mean(loop**2))):.1f} dBFS")

    file = np.concatenate([loop[:, -n_(LEAD_IN):], loop, loop[:, : n_(LEAD_OUT)]], axis=1)
    CACHE.mkdir(parents=True, exist_ok=True)
    wav = CACHE / "music.wav"
    write_wav_stereo(wav, file)
    ff = find_ffmpeg()
    out = CACHE / "site-files"
    out.mkdir(parents=True, exist_ok=True)
    enc = lambda *a: subprocess.run([ff, "-y", "-hide_banner", "-loglevel", "error", "-i", str(wav), *a], check=True)
    enc("-c:a", "libopus", "-b:a", "56k", "-application", "audio", str(out / "music.webm"))
    enc("-ar", "44100", "-c:a", "libmp3lame", "-b:a", "96k", str(out / "music.mp3"))
    (CACHE / "music.json").write_text(
        json.dumps({"loop": [round(LEAD_IN * 1000, 3), round(LDUR * 1000, 3), True]}, indent=2) + "\n", encoding="utf-8")
    kb = lambda p: (out / p).stat().st_size / 1024
    print(f"music.webm {kb('music.webm'):.0f} KB, music.mp3 {kb('music.mp3'):.0f} KB")

    if args.sheet:
        write_wav_stereo(CACHE / "loop.wav", loop)
        overview(loop, CACHE / "overview.png")
        overview(loop, CACHE / "bar.png", t0=0.0, span=8 * BEAT, size=(1500, 420))
        print(f"wrote {CACHE}")


if __name__ == "__main__":
    main()
