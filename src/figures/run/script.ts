// The instrument's script (docs/device-design.md §32): for each stop (a step, or one of Framework's four sub-steps)
// what every part does second by second. Pure numbers, no DOM: poseOf(stop, t) gives the hardware's pose and the
// pulses on the cables at time t, and the screens (screens.ts) read the same constants, so the hands and the pictures
// stay in step. Every part's pose is a function of (stop, t) alone, so any stop can be played from any other.

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
/** How far through [t0, t0 + d] time t is, 0–1. */
export const prog = (t: number, t0: number, d: number) => clamp((t - t0) / d);
export const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
/** 0 → 1 → 0 over [t0, t0 + d]: a button pressed and let go. */
export const bump = (t: number, t0: number, d: number) => {
  const x = (t - t0) / d;
  return x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x);
};

export type SceneId = 'brief' | 'ideation' | 'skills' | 'tokens' | 'motion' | 'prompt' | 'page';
export interface Stop {
  step: number;
  sub: number;
  dur: number;
  scene: SceneId;
}
/** The tour's order. Framework is four stops, one per sub-step. */
export const STOPS: readonly Stop[] = [
  { step: 0, sub: 0, dur: 4.8, scene: 'brief' },
  { step: 1, sub: 0, dur: 6.2, scene: 'ideation' },
  { step: 2, sub: 0, dur: 4.4, scene: 'skills' },
  { step: 2, sub: 1, dur: 5.0, scene: 'tokens' },
  { step: 2, sub: 2, dur: 5.0, scene: 'motion' },
  { step: 2, sub: 3, dur: 5.6, scene: 'prompt' },
  { step: 3, sub: 0, dur: 5.6, scene: 'page' },
  { step: 4, sub: 0, dur: 7.2, scene: 'page' },
  { step: 5, sub: 0, dur: 5.6, scene: 'page' },
];
/** The stop a step (and Framework's sub-step) plays; -1 when there is none. */
export const stopOf = (step: number, sub = 0) => STOPS.findIndex((s) => s.step === step && s.sub === (step === 2 ? sub : 0));

// ---- the constants the screens share (seconds into the stop)
export const BRIEF = { show: 1.7, rows: [2.2, 2.7, 3.2, 3.7] };
export const IDEA = {
  tiles: 0.2,
  cursor: 1.5,
  hops: [
    { t: 1.9, dir: 'right', to: 1 },
    { t: 2.5, dir: 'right', to: 2 },
    { t: 3.1, dir: 'down', to: 5 },
    { t: 3.7, dir: 'left', to: 4 },
  ] as const,
  pick: 4.4,
  expand: 5.0,
  win: 4,
};
export const SKILLS = { drop: 0.3, dropD: 0.9, cells: 1.4, cellsD: 1.9 };
export const TOKENS = { swatches: 0.3, type: 1.2, radius: 1.9, parts: 2.4, adopt: 3.7 };
export const MOTION = { axes: 0.3, turn: 0.7, turnD: 1.9, track: 2.5, press: 4.1 };
export const PROMPT = { press: [0.9, 2.4, 3.9], pass: 0.35 };
export const PROTO = { build: 0.5, phone: 2.8 };
export const ITER = { bubble: 0.4, back: 0.8, lite: 1.9, edit: 2.6, done: 3.6, crt: 4.3, fwd: 4.9, phone: 5.8, tick: 6.5 };
export const SHIP = { tick: 0.4, run: 0.9, ring: 1.8, fin: 2.0, phoneTick: 3.0 };

// ---- pulses on the cables
/** Route names, and the way each is drawn: crt runs CRT → console, ctl console → controller, lite console → lite unit,
 *  tun console → phone, ship console → tray. */
export type Route = 'crt' | 'ctl' | 'lite' | 'tun' | 'ship';
export interface Pulse {
  route: Route;
  /** Along the route's own direction, 0–1. */
  f: number;
  a: number;
}
/** A pulse over [t0, t0 + d]; `rev` runs it against the route's drawn direction. */
function pulse(route: Route, t: number, t0: number, d: number, rev = false): Pulse | null {
  const x = (t - t0) / d;
  if (x <= 0 || x >= 1) return null;
  const f = ease(x);
  return { route, f: rev ? 1 - f : f, a: Math.min(1, x * 8, (1 - x) * 8) };
}

export interface Pose {
  card: number; // 0 floating above its seat, 1 set down
  cart: number;
  cells: number; // how many of the cartridge's nine cells are lit (0–9, the fraction is the next one coming up)
  slider: number; // 0–1
  knob: number; // degrees
  lampA: number;
  lampB: number;
  crt: number; // the CRT's backlight
  lite: number; // the light unit's screen
  phone: number; // the phone's screen
  up: number;
  down: number;
  left: number;
  right: number; // the D-pad's arms, pressed 0–1
  btnA: number;
  btnB: number;
  ring: number; // the tray's light ring
  fin: number; // the finished cartridge: 0 absent, 1 set down on the tray
  typing: number; // the light unit's screen: how much it has typed
  crtV: number; // the page on the CRT: 0 as built, 1 after the group chat's changes
  phoneV: number;
  pulses: Pulse[];
}

/** What is already true when stop i begins. */
function base(i: number): Pose {
  return {
    card: i >= 1 ? 1 : 0,
    cart: i >= 3 ? 1 : 0,
    cells: i >= 3 ? 9 : 0,
    slider: 0.56,
    knob: 0,
    lampA: 1,
    lampB: 0.2,
    crt: 1,
    lite: 0,
    phone: i >= 7 ? 1 : 0,
    up: 0, down: 0, left: 0, right: 0, btnA: 0, btnB: 0,
    ring: 0,
    fin: 0,
    typing: 0,
    crtV: i >= 8 ? 1 : 0,
    phoneV: i >= 8 ? 1 : 0,
    pulses: [],
  };
}

export function poseOf(i: number, t: number): Pose {
  const p = base(i);
  const ps: (Pulse | null)[] = [];
  switch (i) {
    case 0:
      p.card = easeOut(prog(t, 0.4, 0.9));
      ps.push(pulse('crt', t, 1.5, 0.7, true));
      break;
    case 1: {
      for (const h of IDEA.hops) {
        p[h.dir] = Math.max(p[h.dir], bump(t, h.t, 0.3));
        ps.push(pulse('ctl', t, h.t + 0.05, 0.5, true));
      }
      p.btnA = bump(t, IDEA.pick, 0.3);
      ps.push(pulse('ctl', t, IDEA.pick + 0.05, 0.5, true), pulse('crt', t, IDEA.pick + 0.6, 0.5, true));
      break;
    }
    case 2:
      p.cart = easeOut(prog(t, SKILLS.drop, SKILLS.dropD));
      p.cells = 9 * prog(t, SKILLS.cells, SKILLS.cellsD);
      p.lampB = 0.2 + 0.6 * bump(t, 0.1, 1.3);
      ps.push(pulse('crt', t, SKILLS.cells, 0.7, true));
      break;
    case 3:
      p.slider = 0.2 + 0.6 * ease(prog(t, 0.8, 2.2)) - 0.24 * ease(prog(t, 3.5, 1.0));
      ps.push(pulse('crt', t, 0.9, 0.6, true), pulse('crt', t, 2.4, 0.6, true));
      break;
    case 4:
      p.knob = 270 * ease(prog(t, MOTION.turn, MOTION.turnD));
      ps.push(pulse('crt', t, 0.8, 0.6, true), pulse('crt', t, MOTION.press - 0.5, 0.5, true));
      break;
    case 5:
      for (const at of PROMPT.press) {
        p.btnA = Math.max(p.btnA, bump(t, at, 0.3));
        ps.push(pulse('ctl', t, at + 0.05, 0.5, true), pulse('crt', t, at + 0.6, 0.5, true));
      }
      break;
    case 6:
      p.phone = easeOut(prog(t, PROTO.phone, 0.6));
      ps.push(pulse('crt', t, PROTO.build, 0.6, true), pulse('tun', t, 1.7, 1.1));
      break;
    case 7:
      p.lite = easeOut(prog(t, ITER.lite, 0.5)) - easeOut(prog(t, 4.6, 0.5));
      p.typing = prog(t, ITER.edit, ITER.done - ITER.edit);
      p.crtV = ease(prog(t, ITER.crt, 0.8));
      p.phoneV = ease(prog(t, ITER.phone, 0.6));
      ps.push(
        pulse('tun', t, ITER.back, 0.9, true),
        pulse('lite', t, ITER.lite, 0.7),
        pulse('lite', t, ITER.done, 0.7, true),
        pulse('crt', t, ITER.crt - 0.1, 0.6, true),
        pulse('tun', t, ITER.fwd, 0.9),
      );
      break;
    case 8:
      p.ring = easeOut(prog(t, SHIP.ring, 0.6));
      p.fin = easeOut(prog(t, SHIP.fin, 0.8));
      p.lampA = 1;
      ps.push(pulse('ship', t, SHIP.run, 1.0));
      break;
  }
  p.pulses = ps.filter((x): x is Pulse => x !== null);
  return p;
}
