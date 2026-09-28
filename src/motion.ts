// Motion preference: the header toggle and the wallet's motion switch share it. Persisted in
// localStorage['dean-motion'] (same key as DeanFi2); the system reduced-motion setting always wins.
const KEY = 'dean-motion';
const system = matchMedia('(prefers-reduced-motion: reduce)');
type Listener = (reduced: boolean) => void;
const listeners = new Set<Listener>();

function readUser(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}
let userOn = readUser();

export const motion = {
  /** True when motion should be reduced (system setting or the visitor switched it off). */
  reduced: () => system.matches || !userOn,
  userOn: () => userOn,
  systemReduced: () => system.matches,
  set(on: boolean) {
    userOn = on;
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      /* storage unavailable: keep the in-memory value */
    }
    listeners.forEach((l) => l(motion.reduced()));
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
system.addEventListener('change', () => listeners.forEach((l) => l(motion.reduced())));
