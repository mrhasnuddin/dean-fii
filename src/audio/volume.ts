// Site volume (the device's volume knob, docs/device-design.md §34): one master level, 0 to 1, for the
// sound effects and the music alike. Saved in localStorage['dean-volume'] and applied to Howler's master
// gain as soon as audio exists (both audio modules call attach() when they first import Howler). The
// on/off switches (Sound, Music) stay as they are; the level sits under them.
const KEY = 'dean-volume';
const clamp = (v: number) => Math.min(1, Math.max(0, Math.round(v * 100) / 100));

function stored(): number {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? 1 : clamp(Number(v));
  } catch {
    return 1;
  }
}

let level = stored();
let master: { volume(v: number): unknown } | null = null;
const subs: ((level: number) => void)[] = [];

export const volume = {
  level: () => level,
  set(v: number) {
    v = clamp(v);
    if (v === level) return;
    level = v;
    try {
      localStorage.setItem(KEY, String(v));
    } catch {
      /* private mode: the level lasts for this visit */
    }
    master?.volume(v);
    subs.forEach((cb) => cb(v));
  },
  subscribe(cb: (level: number) => void) {
    subs.push(cb);
  },
  /** Howler's master, once imported: the saved level takes effect. */
  attach(howler: { volume(v: number): unknown }) {
    master = howler;
    howler.volume(level);
  },
};
