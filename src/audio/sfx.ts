// Interaction sounds: one Howler sprite (public/audio/sfx.webm, mp3 fallback), synthesised from code
// by scripts/audio/build_sfx.py (no samples). Like Contra, sound is on by default with a header
// toggle; the choice is saved in localStorage['dean-sound'].
//
// Browsers block audio until the visitor's first click, tap or key press. Sounds requested before
// then are dropped, not queued (a queue would fire all at once on unlock). Howler itself is only
// imported on that first gesture, so no AudioContext exists before it. Nothing plays in a hidden tab.
import type { Howl } from 'howler';
import sprite from './sprite.json';

export type SfxName = keyof typeof sprite;
export interface PlayOptions {
  /** Playback rate (pitch). */
  rate?: number;
  /** 0–1, relative to the sound's mixed level. */
  volume?: number;
}

const KEY = 'dean-sound';
const MASTER = 0.8;
const SRC = ['/audio/sfx.webm', '/audio/sfx.mp3'];
// Minimum gap between repeats (ms): the roller, the coin and the e-ink panel can fire in bursts.
const THROTTLE: Partial<Record<SfxName, number>> = { tick: 45, tab: 60, eink: 90, clink: 110, jingle: 300, swish: 150, write: 20 };
// Random pitch spread so repeats never sound machine-gunned.
const SPREAD: Partial<Record<SfxName, number>> = { tick: 0.04, clink: 0.06, jingle: 0.05, write: 0.05, key: 0.03, tap: 0.02, tab: 0.015 };

function stored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

let on = stored() !== 'off';
let howl: Howl | null = null;
let loading: Promise<Howl | null> | null = null;
let gestured = false;
let pending: { name: SfxName; o: PlayOptions; at: number } | null = null;
const last = new Map<SfxName, number>();
const subs: ((on: boolean) => void)[] = [];

const activated = () => gestured || navigator.userActivation?.hasBeenActive === true;

function load(): Promise<Howl | null> {
  loading ??= import('howler').then(
    ({ Howl }) =>
      new Promise<Howl | null>((resolve) => {
        const h: Howl = new Howl({
          src: SRC,
          sprite: sprite as unknown as Record<string, [number, number]>,
          volume: MASTER,
          onload: () => {
            howl = h;
            resolve(h);
            // The gesture that triggered loading gets its sound if the file arrived quickly.
            if (pending && performance.now() - pending.at < 350) start(pending.name, pending.o);
            pending = null;
          },
          onloaderror: () => resolve(null), // stay silent; the site works the same without sound
        });
      }),
  );
  return loading;
}

function start(name: SfxName, { rate = 1, volume = 1 }: PlayOptions) {
  if (!howl) return;
  const spread = SPREAD[name] ?? 0;
  const id = howl.play(name);
  howl.rate(rate * (1 + (Math.random() * 2 - 1) * spread), id);
  howl.volume(MASTER * Math.max(0, Math.min(1, volume)), id);
}

function onGesture() {
  gestured = true;
  if (on) void load();
  for (const t of GESTURES) removeEventListener(t, onGesture, true);
}
const GESTURES = ['pointerdown', 'keydown', 'touchend'] as const;
for (const t of GESTURES) addEventListener(t, onGesture, { capture: true, passive: true });

document.addEventListener('visibilitychange', () => {
  if (document.hidden) howl?.stop();
});

export const sfx = {
  enabled: () => on,
  play(name: SfxName, o: PlayOptions = {}) {
    if (!on || document.hidden || !activated()) return;
    const now = performance.now();
    const gap = THROTTLE[name];
    if (gap && now - (last.get(name) ?? -Infinity) < gap) return;
    last.set(name, now);
    if (howl) start(name, o);
    else {
      pending = { name, o, at: now };
      void load();
    }
  },
  set(value: boolean) {
    if (value === on) return;
    on = value;
    try {
      localStorage.setItem(KEY, value ? 'on' : 'off');
    } catch {
      /* private mode: the choice lasts for this visit */
    }
    if (!value) howl?.stop();
    subs.forEach((cb) => cb(value));
    // Called from a click, so audio is allowed: confirm with the power-on sound, however long the load.
    if (value) void load().then((h) => h && on && !document.hidden && start('boot', {}));
  },
  subscribe(cb: (on: boolean) => void) {
    subs.push(cb);
  },
};
