"""Build the site's sound sprite from code. No samples: every sound is synthesised here.

Each sound is modelled on the part that makes it (docs/device-design.md §7):
- polymer tabs and keys: short modal clicks over a dome thump
- champagne roller: a tiny metal detent tick
- e-ink panel: a faint crackle and swish
- key card: an air whoosh, then a hard tap on the back plate
- D-star coin: an inharmonic plate ring (free circular plate mode ratios), chain links: tiny ticks
Only the device's own feedback (open, verified, sound-on) is tonal. It uses D major pentatonic, so
every chime agrees with the tab pitches (01-04 = D E F# A).

Outputs
  public/audio/sfx.webm   Opus, the main file
  public/audio/sfx.mp3    fallback for browsers without WebM Opus
  src/audio/sprite.json   {name: [offsetMs, durationMs]} for Howler
  .cache/sfx/             one WAV per sound + sheet.png (waveform and spectrogram) with --sheet

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

# Pitches (Hz), D major pentatonic.
D5, D6, E6, FS6, A6, D7 = 587.33, 1174.66, 1318.51, 1479.98, 1760.0, 2349.32
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


def tone(f, dur, tau, attack=0.006, bright=1.0):
    """Soft struck tone: fundamental + fast-decaying 2nd and 4th partials + a tiny felt 'tok'."""
    t = tt(dur)
    x = np.sin(2 * np.pi * f * t)
    x += 0.12 * bright * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / (tau * 0.45))
    x += 0.04 * bright * np.sin(2 * np.pi * 4.0 * f * t) * np.exp(-t / (tau * 0.2))
    atk = np.sin(np.pi / 2 * np.minimum(t / attack, 1.0)) ** 2
    x *= atk * np.exp(-t / tau)
    place(x, lp(transient(0.002, 300, 6000), 3000), 0, 0.08)
    return edges(x, fin=0.0, fout=0.02)


def coin_hit(base, ring=1.0, dur=0.6):
    spec = [(base * r * rng.uniform(0.995, 1.005), rng.uniform(0.09, 0.22) * ring / (1 + 0.35 * i), rng.uniform(0.35, 1.0) * 0.82**i)
            for i, r in enumerate(PLATE)]
    return click(spec, dur, tr=(0.001, 4000, 16000), tr_amp=0.45)


def link_tick():
    return click([(rng.uniform(5600, 7800), 0.018, 1.0), (rng.uniform(8600, 10800), 0.011, 0.55)], 0.07,
                 tr=(0.0008, 5000, 16000), tr_amp=0.7)


# ---------------------------------------------------------------- the sounds
def s_tick():  # roller detent: metal knurl over a detent spring
    return click([(3200, 0.004, 1.0), (5100, 0.003, 0.6), (7400, 0.002, 0.35), (900, 0.005, 0.3)], 0.045,
                 tr=(0.0015, 3000, 12000), tr_amp=0.7)


def s_tab():  # polymer tab on a metal dome; the site shifts its pitch 01 -> 04
    return click([(1650, 0.008, 1.0), (2900, 0.006, 0.55), (4300, 0.004, 0.35)], 0.09,
                 tr=(0.002, 2000, 9000), tr_amp=0.8, thump=(220, 0.012, 0.6))


def s_key():  # round chin key: press, then a softer release as it springs back
    x = zeros(0.2)
    place(x, click([(1200, 0.009, 1.0), (2400, 0.006, 0.5), (3700, 0.004, 0.3)], 0.12,
                   tr=(0.0025, 1500, 8000), tr_amp=0.7, thump=(160, 0.015, 0.7)), 0)
    place(x, click([(1400, 0.006, 1.0), (2800, 0.004, 0.4)], 0.08, tr=(0.0015, 2500, 9000), tr_amp=0.5), 0.09, 0.35)
    return edges(x)


def s_bump():  # roller at its end stop: dull and low, with enough 400-900 Hz to survive phone speakers
    return edges(lp(click([(180, 0.025, 1.0), (420, 0.014, 0.8), (900, 0.008, 0.6)], 0.1,
                          tr=(0.003, 200, 1400), tr_amp=0.5), 3000))


def s_switch():  # slide switch: a little friction, then the detent snap
    x = zeros(0.12)
    fr = bp(noise(0.03), 1500, 4500) * (tt(0.03) / 0.03) ** 1.5
    place(x, norm(fr), 0, 0.22)
    place(x, click([(2200, 0.005, 1.0), (3800, 0.003, 0.6), (6000, 0.002, 0.4)], 0.09,
                   tr=(0.0015, 3000, 12000), tr_amp=0.8, thump=(300, 0.008, 0.5)), 0.028)
    return edges(x)


def s_eink():  # full refresh: two faint swishes (matching the screen's double flash) + crackle
    d = 0.23
    x = zeros(d)
    for at, ln in [(0.0, 0.07), (0.12, 0.06)]:
        t = tt(ln)
        env = np.minimum(t / 0.006, 1) * np.exp(-t / 0.02)
        place(x, norm(bp(noise(ln), 4000, 9000) * env), at)
    crackle = np.zeros(n_(d))
    hits = rng.random(n_(d)) < 260 / SR
    crackle[hits] = rng.uniform(-1, 1, hits.sum())
    x += 0.35 * norm(hp(crackle, 5000)) * np.exp(-tt(d) / 0.12)
    return edges(x)


def s_write():  # one line written on the key card: a printhead step
    return click([(8500, 0.0015, 1.0), (6200, 0.002, 0.5)], 0.03, tr=(0.001, 5000, 14000), tr_amp=0.9)


def s_open():  # panel opens: D6 -> A6
    x = zeros(0.5)
    place(x, tone(D6, 0.43, 0.15), 0)
    place(x, tone(A6, 0.43, 0.19), 0.07, 0.9)
    return x


def s_close():  # panel closes: soft low click + a falling breath of air
    d = 0.22
    x = zeros(d)
    place(x, click([(420, 0.01, 1.0), (900, 0.006, 0.4)], 0.06, tr=(0.0015, 400, 3000), tr_amp=0.4), 0)
    t = tt(0.18)
    air = svf_bp(noise(0.18), 2800 * (700 / 2800) ** (t / 0.18), 0.9) * np.minimum(t / 0.01, 1) * np.exp(-t / 0.06)
    place(x, norm(air), 0.005, 0.6)
    return edges(x)


def air(speed: np.ndarray, q=1.4):
    """Moving-air noise driven by a speed curve (0..1): louder and brighter as the card goes faster."""
    d = len(speed) / SR
    t = tt(d)
    fc = 400 + 1800 * speed
    a = norm(svf_bp(noise(d), fc, q)) * speed**1.5
    paper = norm(hp(noise(d), 3000)) * speed**1.5 * (1 + 0.5 * np.sin(2 * np.pi * 23 * t)) * 0.15
    return a + paper


def s_whoosh():
    """Key card entrance. Follows contactSequence.ts: power3.out over 0.56 s (fastest as it enters),
    then power2.in for 0.14 s into the tap at 0.70 s. The tap sound covers the cut."""
    d = 0.7
    t = tt(d)
    approach = 3 * np.clip(1 - t / 0.56, 0, 1) ** 2  # d/dt of power3.out
    impact = np.where(t > 0.56, 2 * (t - 0.56) / 0.14, 0) * 0.25  # d/dt of power2.in, shorter travel
    speed = np.maximum(approach / 3, impact)
    speed *= np.minimum(t / 0.025, 1)  # it enters from off-screen, not from nothing
    return edges(air(speed), fin=0.002, fout=0.004)


def s_swish():  # card swinging out or being put away: power2.out, fastest first
    d = 0.4
    t = tt(d)
    speed = (1 - t / d) ** 1.4 * np.minimum(t / 0.02, 1)
    return edges(air(speed, q=1.2))


def s_insert():  # key card pushed into the side reader: card-stock friction rising, then the latch
    d = 0.42
    x = zeros(d)
    t = tt(0.3)
    fr = bp(noise(0.3), 1800, 6500) * (0.25 + 0.75 * (t / 0.3) ** 1.3) * (1 + 0.3 * np.sin(2 * np.pi * 31 * t))
    place(x, edges(norm(fr), fin=0.01, fout=0.008), 0, 0.45)
    latch = click([(2800, 0.006, 1.0), (4500, 0.004, 0.6), (1300, 0.012, 0.5)], 0.1, tr=(0.0015, 2500, 12000), tr_amp=0.9, thump=(260, 0.012, 0.6))
    place(x, latch, 0.3)
    return edges(x)


def s_eject():  # reader spring pushes the written key back out: a soft thunk, then a short slide
    d = 0.4
    x = zeros(d)
    place(x, click([(320, 0.02, 1.0), (1200, 0.01, 0.5), (2600, 0.005, 0.3)], 0.12, tr=(0.002, 400, 5000), tr_amp=0.5), 0)
    t = tt(0.3)
    fr = bp(noise(0.3), 1600, 6000) * (1 - t / 0.3) ** 1.6
    place(x, edges(norm(fr), fin=0.004, fout=0.01), 0.02, 0.35)
    return edges(x)


def s_peel():  # sticker adhesive letting go: dense tiny crackles over a soft tearing hiss
    d = 0.26
    t = tt(d)
    env = np.minimum(t / 0.02, 1) * np.exp(-t / 0.09)
    hiss = norm(bp(noise(d), 2500, 9000)) * env * 0.35
    crack = np.zeros(n_(d))
    hits = rng.random(n_(d)) < (900 / SR) * env
    crack[hits] = rng.uniform(-1, 1, hits.sum())
    crack = norm(hp(crack, 3500)) * 0.9
    return edges(hiss + crack, fin=0.002, fout=0.02)


def s_stick():  # sticker lands back flat: a soft pat and a last tiny crackle
    x = zeros(0.12)
    place(x, click([(190, 0.018, 1.0), (520, 0.008, 0.4)], 0.1, tr=(0.003, 300, 2500), tr_amp=0.6), 0)
    crack = np.zeros(n_(0.05))
    hits = rng.random(n_(0.05)) < 500 / SR
    crack[hits] = rng.uniform(-1, 1, hits.sum())
    place(x, norm(hp(crack, 4000)) * np.exp(-tt(0.05) / 0.02), 0.008, 0.25)
    return edges(x)


def s_tap():  # card meets the back plate: metal shell ring + card thump
    return click([(1350, 0.035, 1.0), (2700, 0.022, 0.6), (4100, 0.014, 0.45), (5600, 0.009, 0.3)], 0.22,
                 tr=(0.0015, 1200, 12000), tr_amp=1.0, thump=(240, 0.018, 0.9))


def s_verified():  # key read: D6 F#6 A6, with a D7 sparkle on the last note
    x = zeros(0.8)
    place(x, tone(D6, 0.5, 0.13), 0)
    place(x, tone(FS6, 0.5, 0.15), 0.055, 0.9)
    place(x, tone(A6, 0.65, 0.3), 0.11, 0.95)
    place(x, tone(D7, 0.5, 0.25, bright=0.5), 0.11, 0.25)
    return x


def s_jingle():  # coin tapped: coin rings, chain links rattle, dying away
    x = zeros(0.75)
    base = 3400 * rng.uniform(0.97, 1.03)
    for at, amp, kind in [(0, 1, "c"), (0.045, 0.7, "l"), (0.095, 0.55, "c"), (0.16, 0.4, "l"), (0.25, 0.3, "c"), (0.33, 0.18, "l")]:
        hit = coin_hit(base * rng.uniform(0.98, 1.02)) if kind == "c" else link_tick()
        place(x, norm(hit), at + rng.uniform(-0.008, 0.008) if at else 0, amp)
    return edges(x)


def s_clink():  # coin swings into the wallet: one coin hit + a short shell tick
    x = zeros(0.45)
    place(x, norm(coin_hit(3400, ring=0.8, dur=0.45)), 0)
    place(x, click([(1350, 0.012, 1.0), (2700, 0.008, 0.5)], 0.05, tr=(0.001, 1500, 9000), tr_amp=0.6), 0, 0.5)
    return edges(x)


def s_boot():  # sound switched on: the panel wakes (crackle), then D5 -> D6
    x = zeros(0.95)
    place(x, s_eink(), 0, 0.5)
    place(x, tone(D5, 0.9, 0.35, attack=0.06), 0.02, 0.8)
    place(x, tone(D6, 0.75, 0.3, attack=0.01), 0.16, 0.55)
    return edges(x, fout=0.05)


# name -> (builder, peak dBFS). Levels are the mix: quiet for frequent sounds, louder for payoffs.
SOUNDS = {
    "tick": (s_tick, -21), "tab": (s_tab, -15), "key": (s_key, -14), "bump": (s_bump, -13),
    "switch": (s_switch, -15), "eink": (s_eink, -26), "write": (s_write, -22), "open": (s_open, -17),
    "close": (s_close, -20), "whoosh": (s_whoosh, -15), "swish": (s_swish, -18), "tap": (s_tap, -9),
    "insert": (s_insert, -13), "eject": (s_eject, -14), "peel": (s_peel, -19), "stick": (s_stick, -17),
    "verified": (s_verified, -14),
    "jingle": (s_jingle, -12), "clink": (s_clink, -12), "boot": (s_boot, -14),
}
LEAD = 0.05  # silence before the first sound (absorbs codec priming)
GAP = 0.12  # silence between sounds: no bleed at any playback rate the site uses
TAIL = 0.04  # extra ms in each sprite entry past the sound's end


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
    run = lambda *a: subprocess.run([ff, "-y", "-hide_banner", "-loglevel", "error", "-i", str(master), *a], check=True)
    run("-ac", "1", "-c:a", "libopus", "-b:a", "48k", "-application", "audio", str(out / "sfx.webm"))
    run("-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "64k", str(out / "sfx.mp3"))
    (ROOT / "src" / "audio").mkdir(parents=True, exist_ok=True)
    (ROOT / "src" / "audio" / "sprite.json").write_text(json.dumps(sprite, indent=2) + "\n", encoding="utf-8")

    if args.sheet:
        for name, x in clips.items():
            write_wav(CACHE / f"{name}.wav", x)
        sheet(clips, CACHE / "sheet.png")

    kb = lambda p: (out / p).stat().st_size / 1024
    print(f"{len(clips)} sounds, {total:.2f} s  ->  sfx.webm {kb('sfx.webm'):.1f} KB, sfx.mp3 {kb('sfx.mp3'):.1f} KB")
    for name, (o, d) in sprite.items():
        print(f"  {name:9s} {o:8.1f} ms  {d:6.1f} ms  peak {20 * np.log10(np.max(np.abs(clips[name]))):6.1f} dBFS")


if __name__ == "__main__":
    main()
