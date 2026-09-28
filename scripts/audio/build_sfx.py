"""Build the site's sounds from code. No samples: every sound is synthesised here.

Set 2 (docs/device-design.md §15), after studying how Contra uses sound: few sounds, one family.
Interaction sounds are 10-60 ms and not pitched (a hover tick, a press, a detent, a thock), pitch is
kept for one reward (a D6 + D7 bell), and a quiet low drone in D sits under everything so the short
clicks feel like one place. Measured targets, not copies: none of Contra's audio is used.

Outputs
  public/audio/sfx.webm|mp3   the interaction sprite (Opus, mp3 fallback)
  public/audio/bed.webm|mp3   the ambient bed: a seamless 24 s loop between LOOP_IN and LOOP_IN + 24 s
  src/audio/sprite.json       {name: [offsetMs, durationMs]} for Howler, plus "bed": [in, 24000, true]
  .cache/sfx/                 one WAV per sound + sheet.png (waveform and spectrogram) with --sheet

Run: python scripts/audio/build_sfx.py [--sheet]
Needs numpy + scipy, and ffmpeg (on PATH, in $FFMPEG, or the winget Gyan.FFmpeg install).
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import shutil
import subprocess
import wave
from pathlib import Path

import numpy as np
from scipy import signal

SR = 48000
ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".cache" / "sfx"
rng = np.random.default_rng(20260928)  # fixed seed: rebuilds are byte-identical before encoding

# The site's key is D: the bell and the bed use it.
D6, D7 = 1174.66, 2349.32
# Free circular plate mode ratios (approx.): what makes a coin ring, not beep.
PLATE = [1.0, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501]


# ---------------------------------------------------------------- building blocks
def n_(sec: float) -> int:
    return int(round(sec * SR))


def tt(sec: float) -> np.ndarray:
    return np.arange(n_(sec)) / SR


def zeros(sec: float) -> np.ndarray:
    return np.zeros(n_(sec))


def noise(sec: float) -> np.ndarray:
    return rng.standard_normal(n_(sec))


def _sos(kind: str, f, order=2):
    return signal.butter(order, f, btype=kind, fs=SR, output="sos")


def bp(x, lo, hi, order=2):
    return signal.sosfilt(_sos("bandpass", [lo, hi], order), x)


def hp(x, f, order=2):
    return signal.sosfilt(_sos("highpass", f, order), x)


def lp(x, f, order=2):
    return signal.sosfilt(_sos("lowpass", f, order), x)


def svf_bp(x, fc, q):
    """Band-pass with a per-sample cutoff (TPT state-variable filter), for sweeps."""
    fc = np.broadcast_to(np.asarray(fc, float), x.shape)
    k = 1.0 / q
    ic1 = ic2 = 0.0
    out = np.empty_like(x)
    for i, v0 in enumerate(x):
        g = np.tan(np.pi * min(fc[i], SR * 0.45) / SR)
        a1 = 1.0 / (1.0 + g * (g + k))
        a2 = g * a1
        a3 = g * a2
        v3 = v0 - ic2
        v1 = a1 * ic1 + a2 * v3
        v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2 * v1 - ic1
        ic2 = 2 * v2 - ic2
        out[i] = v1
    return out


def norm(x, peak=1.0):
    m = np.max(np.abs(x))
    return x * (peak / m) if m > 0 else x


def place(buf, sig, at, gain=1.0):
    i = n_(at)
    j = min(len(buf), i + len(sig))
    buf[i:j] += gain * sig[: j - i]
    return buf


def edges(x, fin=0.0004, fout=0.006):
    """Raised-cosine fade in/out so no sound starts or ends on a step."""
    a, b = n_(fin), n_(fout)
    if a:
        x[:a] *= np.sin(np.linspace(0, np.pi / 2, a)) ** 2
    if b:
        x[-b:] *= np.cos(np.linspace(0, np.pi / 2, b)) ** 2
    return x


def mode(f, tau, dur, amp=1.0, phase=None):
    """One damped sinusoid. A random phase gives a click its own onset; tones pass phase=0."""
    t = tt(dur)
    ph = rng.uniform(0, 2 * np.pi) if phase is None else phase
    return amp * np.sin(2 * np.pi * f * t + ph) * np.exp(-t / tau)


def transient(dur, lo, hi):
    """A very short band-limited noise burst: the contact moment of any hit."""
    t = tt(dur)
    return norm(bp(noise(dur), lo, hi) * np.exp(-t / (dur / 4)))


def click(spec, dur, tr=(0.0015, 2500, 9000), tr_amp=0.6, thump=None):
    """Modal click: resonances `spec` = [(f, tau, amp)] + a noise transient + an optional low thump."""
    x = norm(sum(mode(f, tau, dur, a) for f, tau, a in spec))
    place(x, transient(*tr), 0, tr_amp)
    if thump:
        f, tau, a = thump
        x += mode(f, tau, dur, a, phase=0)
    return edges(x)




def coin_hit(base, ring=1.0, dur=0.6):
    spec = [(base * r * rng.uniform(0.995, 1.005), rng.uniform(0.09, 0.22) * ring / (1 + 0.35 * i), rng.uniform(0.35, 1.0) * 0.82**i)
            for i, r in enumerate(PLATE)]
    return click(spec, dur, tr=(0.001, 4000, 16000), tr_amp=0.45)




# ---------------------------------------------------------------- the sounds
def glide(f0, f1, tau_f, tau, dur, amp=1.0):
    """A sine whose pitch falls from f0 to f1 (time constant tau_f) as it decays: a soft body's thump."""
    t = tt(dur)
    f = f1 + (f0 - f1) * np.exp(-t / tau_f)
    return amp * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / tau)


def s_hover():  # pointer arrives on a control: a tiny tick you feel more than hear
    return click([(2950, 0.0035, 1.0), (5900, 0.0015, 0.3)], 0.02, tr=(0.0006, 3000, 9000), tr_amp=0.35)


def s_press():  # any press: a crisp snap and a mid knock over a small low body, over in ~50 ms
    x = glide(150, 100, 0.008, 0.01, 0.06, amp=0.16)
    x += norm(mode(780, 0.007, 0.06, 0.45) + mode(1650, 0.008, 0.06, 1.0) + mode(3400, 0.006, 0.06, 1.0) + mode(5200, 0.005, 0.06, 1.0) + mode(7100, 0.003, 0.06, 0.5)) * 0.8
    place(x, transient(0.003, 2500, 12000), 0, 1.0)
    return edges(x)


def s_detent():  # one step of a list or the roller: a bright, dry tick
    return click([(6900, 0.0025, 1.0), (3650, 0.003, 0.35)], 0.024, tr=(0.0008, 5000, 16000), tr_amp=0.6)


def s_toggle():  # a switch, an end stop, a card seating: a soft low thock (with enough mid for phones)
    x = glide(200, 165, 0.01, 0.014, 0.07)
    x += mode(90, 0.018, 0.07, 0.5, phase=0) + mode(520, 0.01, 0.07, 1.0)
    place(x, lp(transient(0.001, 600, 3000), 3000), 0, 0.25)
    return edges(lp(x, 3200))


def s_process():  # the reader writing the key: a faint high shimmer that flutters, then fades
    d = 0.9
    t = tt(d)
    x = zeros(d)
    for k, f in enumerate([8800, 10100, 11500, 12800, 14200]):
        rate = rng.uniform(11, 27)
        flutter = 0.5 + 0.5 * np.sin(2 * np.pi * rate * t + rng.uniform(0, 2 * np.pi))
        x += np.sin(2 * np.pi * f * t + rng.uniform(0, 2 * np.pi)) * flutter * 0.85**k
    env = np.minimum(t / 0.08, 1) * np.clip((d - t) / 0.25, 0, 1) ** 2
    return edges(x * env, fin=0.002, fout=0.01)


def s_success():  # the one pitched sound: a soft-struck bell, D6 under a brighter D7
    d = 1.3
    t = tt(d)
    atk = np.sin(np.pi / 2 * np.minimum(t / 0.05, 1)) ** 2
    x = 0.63 * np.sin(2 * np.pi * D6 * t) * np.exp(-t / 0.38)
    x += 1.0 * np.sin(2 * np.pi * D7 * t) * np.exp(-t / 0.26)
    x += 0.05 * np.sin(2 * np.pi * D7 * 2.76 * t) * np.exp(-t / 0.06)  # a glassy strike partial
    return edges(x * atk, fin=0.0, fout=0.04)


def s_power():  # sound switched on: a warm swell in D that rises, breathes and settles
    d = 1.8
    t = tt(d)
    swell = np.where(t < 0.7, np.sin(np.pi / 2 * t / 0.7) ** 2, np.cos(np.pi / 2 * np.clip((t - 0.7) / 1.1, 0, 1)) ** 2)
    x = sum(a * np.sin(2 * np.pi * f * t) for f, a in [(146.83, 0.5), (220.0, 0.3), (293.66, 0.22), (440.0, 0.06)])
    return edges(lp(x, 900) * swell, fin=0.0, fout=0.02)


def s_air():  # something moves past: a short soft swish, fastest first
    d = 0.28
    t = tt(d)
    speed = np.sin(np.pi * np.clip(t / d, 0, 1) ** 0.6) ** 2
    return edges(norm(svf_bp(noise(d), 900 + 1700 * speed, 1.2)) * speed, fin=0.002, fout=0.01)


def s_coin():  # the D-star coin: a short metal tick with a little ring
    return coin_hit(2600, ring=0.35, dur=0.14)


def s_peel():  # sticker adhesive letting go: a short soft crackle
    d = 0.18
    t = tt(d)
    env = np.minimum(t / 0.015, 1) * np.exp(-t / 0.06)
    hiss = norm(bp(noise(d), 2500, 8000)) * env * 0.25
    crack = np.zeros(n_(d))
    hits = rng.random(n_(d)) < (700 / SR) * env
    crack[hits] = rng.uniform(-1, 1, hits.sum())
    return edges(hiss + norm(hp(crack, 3500)) * 0.7, fin=0.002, fout=0.015)


# name -> (builder, peak dBFS). Levels are the mix: the frequent ones quietest.
SOUNDS = {
    "hover": (s_hover, -21), "press": (s_press, -11), "detent": (s_detent, -15), "toggle": (s_toggle, -16),
    "process": (s_process, -27), "success": (s_success, -14), "power": (s_power, -19), "air": (s_air, -24),
    "coin": (s_coin, -17), "peel": (s_peel, -23),
}


LEAD = 0.05  # silence before the first sound (absorbs codec priming)
GAP = 0.12  # silence between sounds: no bleed at any playback rate the site uses
TAIL = 0.04  # extra ms in each sprite entry past the sound's end


# ---------------------------------------------------------------- the bed
BED_T = 24.0  # loop length (s): every frequency and every slow movement repeats exactly in it
LOOP_IN = 0.1  # the loop starts this far into the file (a lead-in absorbs codec priming)


def periodic(f):
    """Nearest frequency that repeats a whole number of times in BED_T, so the loop has no seam."""
    return round(f * BED_T) / BED_T


def s_bed():
    """A quiet, warm drone in D: a sub root and fifth, a soft D3, and faint F#4 A4 E5 colour that
    swell in and out on their own slow cycles. Two detuned copies of each partial give it air."""
    t = tt(BED_T)
    x = zeros(BED_T)
    lfo = lambda cycles, ph=0.0: 0.5 + 0.5 * np.sin(2 * np.pi * cycles * t / BED_T + ph)
    parts = [(73.42, 1.0, 1, 0.15), (110.0, 0.45, 2, 0.25), (146.83, 0.3, 3, 0.5),
             (369.99, 0.05, 1, 1.0), (440.0, 0.045, 2, 1.0), (659.26, 0.035, 3, 1.0)]
    for f, a, cyc, depth in parts:
        ph = rng.uniform(0, 2 * np.pi)
        swell = 1 - depth + depth * lfo(cyc, ph)
        for df in (0.0, 2 / BED_T):  # a slow 12 s beat between the pair
            x += a * swell * np.sin(2 * np.pi * periodic(f + df) * t + rng.uniform(0, 2 * np.pi))
    # A breath of band-limited air, made periodic by shaping white noise in the frequency domain.
    spec = np.fft.rfft(rng.standard_normal(len(t)))
    fr = np.fft.rfftfreq(len(t), 1 / SR)
    spec *= np.exp(-0.5 * (np.log(np.maximum(fr, 1) / 500) / 0.6) ** 2)
    x += norm(np.fft.irfft(spec, len(t))) * 0.04 * lfo(2, 1.0)
    return x


# ---------------------------------------------------------------- output
def write_wav(path: Path, x: np.ndarray):
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = np.clip(np.round(x * 32767), -32768, 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def find_ffmpeg() -> str:
    for c in (os.environ.get("FFMPEG"), shutil.which("ffmpeg")):
        if c and Path(c).exists():
            return c
    hits = glob.glob(os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg*\*\bin\ffmpeg.exe"))
    if hits:
        return hits[0]
    raise SystemExit("ffmpeg not found: install it (winget install Gyan.FFmpeg) or set FFMPEG=path")


def sheet(clips: dict[str, np.ndarray], out: Path):
    """Waveform (top) + log spectrogram (bottom) per sound, for review without listening."""
    from PIL import Image, ImageDraw

    W, H, PAD = 360, 150, 8
    cols = 3
    rows = -(-len(clips) // cols)
    img = Image.new("RGB", (cols * (W + PAD) + PAD, rows * (H * 2 + 28 + PAD) + PAD), (16, 17, 20))
    d = ImageDraw.Draw(img)
    for k, (name, x) in enumerate(clips.items()):
        ox = PAD + (k % cols) * (W + PAD)
        oy = PAD + (k // cols) * (H * 2 + 28 + PAD)
        pk = np.max(np.abs(x))
        d.text((ox, oy), f"{name}  {len(x) / SR * 1000:.0f} ms  peak {20 * np.log10(pk):.1f} dBFS", fill=(230, 220, 190))
        wy = oy + 18
        d.rectangle([ox, wy, ox + W, wy + H], fill=(28, 29, 34))
        cols_px = np.array_split(x, W)
        for i, c in enumerate(cols_px):
            if len(c):
                lo, hi = c.min() / pk, c.max() / pk
                d.line([ox + i, wy + H / 2 - hi * H / 2, ox + i, wy + H / 2 - lo * H / 2], fill=(228, 207, 159))
        f, _, S = signal.spectrogram(x, SR, nperseg=512, noverlap=448)
        S = 10 * np.log10(S + 1e-12)
        S = np.clip((S - (S.max() - 70)) / 70, 0, 1)
        # log-frequency axis 100 Hz .. 20 kHz
        ys = np.geomspace(100, 20000, H)[::-1]
        rows_idx = np.searchsorted(f, ys).clip(0, len(f) - 1)
        spec = S[rows_idx]
        spec = np.array(Image.fromarray((spec * 255).astype("uint8")).resize((W, H)))
        rgb = np.stack([spec, (spec * 0.85).astype("uint8"), (spec * 0.6).astype("uint8")], -1)
        img.paste(Image.fromarray(rgb), (ox, wy + H + 4))
    img.save(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", action="store_true", help="also write per-sound WAVs + a review sheet to .cache/sfx")
    args = ap.parse_args()

    clips: dict[str, np.ndarray] = {}
    for name, (fn, peak_db) in SOUNDS.items():
        x = edges(hp(fn(), 25))  # strip DC from the thumps; re-fade so every clip starts and ends at 0
        clips[name] = norm(x, 10 ** (peak_db / 20))

    total = LEAD + sum(len(x) / SR + GAP for x in clips.values())
    buf = zeros(total)
    sprite, at = {}, LEAD
    for name, x in clips.items():
        place(buf, x, at)
        dur = len(x) / SR + TAIL
        sprite[name] = [round(at * 1000, 1), round(dur * 1000, 1)]
        at += len(x) / SR + GAP

    CACHE.mkdir(parents=True, exist_ok=True)
    master = CACHE / "sfx.wav"
    write_wav(master, buf)
    ff = find_ffmpeg()
    out = ROOT / "public" / "audio"
    out.mkdir(parents=True, exist_ok=True)
    enc = lambda src, *a: subprocess.run([ff, "-y", "-hide_banner", "-loglevel", "error", "-i", str(src), *a], check=True)
    enc(master, "-ac", "1", "-c:a", "libopus", "-b:a", "48k", "-application", "audio", str(out / "sfx.webm"))
    enc(master, "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "64k", str(out / "sfx.mp3"))

    # Bed: one loop with LOOP_IN s of its own end before it and 0.5 s of its start after it, so the
    # loop window [LOOP_IN, LOOP_IN + BED_T] is seamless whatever the codec does at the file's edges.
    loop = norm(s_bed(), 10 ** (-9 / 20))
    bed = np.concatenate([loop[-n_(LOOP_IN):], loop, loop[: n_(0.5)]])
    bed_wav = CACHE / "bed.wav"
    write_wav(bed_wav, bed)
    enc(bed_wav, "-ac", "1", "-c:a", "libopus", "-b:a", "40k", "-application", "audio", str(out / "bed.webm"))
    enc(bed_wav, "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "64k", str(out / "bed.mp3"))
    sprite["bed"] = [round(LOOP_IN * 1000, 1), round(BED_T * 1000, 1), True]
    (ROOT / "src" / "audio").mkdir(parents=True, exist_ok=True)
    (ROOT / "src" / "audio" / "sprite.json").write_text(json.dumps(sprite, indent=2) + "\n", encoding="utf-8")

    if args.sheet:
        for name, x in clips.items():
            write_wav(CACHE / f"{name}.wav", x)
        sheet(clips, CACHE / "sheet.png")

    kb = lambda p: (out / p).stat().st_size / 1024
    print(f"{len(clips)} sounds, {total:.2f} s  ->  sfx.webm {kb('sfx.webm'):.1f} KB, sfx.mp3 {kb('sfx.mp3'):.1f} KB")
    print(f"bed {BED_T:.0f} s loop  ->  bed.webm {kb('bed.webm'):.1f} KB, bed.mp3 {kb('bed.mp3'):.1f} KB, "
          f"rms {20 * np.log10(np.sqrt(np.mean(loop**2))):.1f} dBFS")
    for name, (o, d) in ((k, v[:2]) for k, v in sprite.items() if k != "bed"):
        print(f"  {name:9s} {o:8.1f} ms  {d:6.1f} ms  peak {20 * np.log10(np.max(np.abs(clips[name]))):6.1f} dBFS")


if __name__ == "__main__":
    main()
