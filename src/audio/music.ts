// Background music: one looping lo-fi café track (public/audio/music.webm, mp3 fallback), composed and
// rendered from code by scripts/audio/build_music.py (docs/device-design.md §18). It has its own toggle
// (header, a spinning record) and its own saved choice, localStorage['dean-music'], apart from the
// sound effects (sfx.ts): people often want one without the other.
//
// On by default, like the effects, but only once the visitor has clicked, tapped or pressed a key
// (browsers block audio before that), and never on a Save-Data connection unless asked for. The file
// is ~450 KB, so it starts loading a moment after that first gesture, behind the click sounds. Every
// change of state fades, never cuts: in over 3 s when it starts or is switched on, out over 1.4 s when
// switched off, out over 0.6 s when the tab is left (then paused), and back in over 1.5 s on return.
//
// The loop is played as a sprite window inside the file (music.json), which Howler loops sample-
// accurately; looping the whole file would click at the codec's padding.
import type { Howl } from 'howler';
import loopInfo from './music.json';

const KEY = 'dean-music';
const SRC = ['/audio/music.webm', '/audio/music.mp3'];
const VOLUME = 0.34; // relative to the file (rendered at -19 dBFS rms): a calm bed under the clicks, never over them
const FADE_IN = 3000; // starting, or switched on
const FADE_OUT = 1400; // switched off
const FADE_HIDE = 600; // the tab is left (it pauses once silent)
const FADE_SHOW = 1500; // the tab is back
const START_DELAY = 1200; // after the first gesture: the click sounds load first

function stored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
const saveData = () => (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;

let on = stored() === 'on' || (stored() === null && !saveData());
let gestured = false;
let howl: Howl | null = null;
let loading = false;
let id: number | null = null;
let pauseTimer = 0;
const subs: ((on: boolean) => void)[] = [];

const activated = () => gestured || navigator.userActivation?.hasBeenActive === true;

function load() {
  if (loading) return;
  loading = true;
  void import('howler').then(({ Howl }) => {
    const h: Howl = new Howl({
      src: SRC,
      sprite: { loop: loopInfo.loop as [number, number, boolean] },
      volume: 1,
      onload: () => {
        howl = h;
        sync();
      },
      onloaderror: () => {
        loading = false; // no music; the site works the same without it
      },
    });
  });
}

/** Make the player match: playing (fading in) when wanted, otherwise faded out and paused. `quick`: a tab change. */
function sync(quick = false) {
  const want = on && !document.hidden && activated();
  if (want) {
    if (!howl) return load();
    clearTimeout(pauseTimer);
    if (id === null) {
      id = howl.play('loop');
      howl.volume(0, id);
    } else if (!howl.playing(id)) howl.play(id);
    howl.fade(howl.volume(id) as number, VOLUME, quick ? FADE_SHOW : FADE_IN, id);
  } else if (howl && id !== null && howl.playing(id)) {
    const cur = id;
    const ms = quick ? FADE_HIDE : FADE_OUT;
    howl.fade(howl.volume(cur) as number, 0, ms, cur); // a scheduled ramp: it keeps its timing in a background tab
    clearTimeout(pauseTimer);
    pauseTimer = window.setTimeout(() => howl?.pause(cur), ms + 80);
  }
}

const GESTURES = ['pointerdown', 'keydown', 'touchend'] as const;
function onGesture() {
  gestured = true;
  for (const t of GESTURES) removeEventListener(t, onGesture, true);
  if (on) window.setTimeout(sync, START_DELAY);
}
for (const t of GESTURES) addEventListener(t, onGesture, { capture: true, passive: true });
document.addEventListener('visibilitychange', () => sync(true));

export const music = {
  enabled: () => on,
  set(value: boolean) {
    if (value === on) return;
    on = value;
    try {
      localStorage.setItem(KEY, value ? 'on' : 'off');
    } catch {
      /* private mode: the choice lasts for this visit */
    }
    subs.forEach((cb) => cb(value));
    sync(); // called from a click, so audio is allowed: it starts at once
  },
  subscribe(cb: (on: boolean) => void) {
    subs.push(cb);
  },
};
