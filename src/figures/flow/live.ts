// The Design flow keypad, live (docs/device-design.md §57): a macropad joined by a cable to a small desk screen. One key per stage of the
// project's flow, numbered from 1; pressing a key shows the stage's name on the screen (a quick refresh, a pulse along the cable, the
// light strip flaring). The knob steps through the stages (drag it; arrow keys when focused) and a press on it pauses or resumes the
// flow playing by itself; the slider scrubs them and snaps to a stage. The chips under the figure press the keys too (hold(i)) and
// hear every stage picked (onPick). It plays by itself while nobody touches it, stops when it is off screen, and with Motion off it is
// still: no animation, but every control still works.
import '../../vendor/anatomy/iso.css';
import '../story/story.css';
import './flow.css';
import { figureSvg } from '../../vendor/anatomy/iso-kit.mjs';
import { driveLoop } from '../kit/loop';
import { attr, sty } from '../run/dom';
import { H, SCREEN, W, buildFlow } from './scene.mjs';

export interface KeypadHandle {
  /** Presses stage i's key from outside, as a chip does (and rests the flow's own play); -1 lets go. */
  hold(i: number): void;
  destroy(): void;
}
export interface KeypadOptions {
  /** Hears every stage picked, by a key, the knob, the slider, a chip or the play. */
  onPick?: (i: number) => void;
  /** The flow plays by itself while nobody touches it (default true). */
  auto?: boolean;
  label?: string;
}

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (t: number) => 1 - (1 - t) ** 3;
const f2 = (v: number) => Math.round(v * 100) / 100;
interface Spring { x: number; v: number }
/** A spring with a little overshoot: it settles on `target` like a detent does. */
function follow(s: Spring, target: number, dt: number, k = 420, c = 30) {
  s.v += (k * (target - s.x) - c * s.v) * dt;
  s.x += s.v * dt;
}

const KEY_DOWN = 0.06, KEY_UP = 0.16, KEY_TRAVEL = 3; // seconds, seconds, world units
const DWELL = 2.3, RESUME = 7; // seconds on a stage while playing; seconds of calm before the play resumes
const STEP = 0.45; // radians of knob drag per stage
const PULSE = 0.55; // seconds for the signal to cross the cable

export function mountKeypad(host: HTMLElement, readEl: HTMLElement | null, flow: { steps: string[] }, opts: KeypadOptions = {}): KeypadHandle {
  const names = flow.steps.slice(0, 9);
  const n = names.length;
  const fig = buildFlow(n);
  const label = opts.label ?? `A keypad with ${n} numbered keys, one for each stage of the design flow, joined by a cable to a small screen that shows the stage's name.`;
  host.innerHTML = `<div class="iso dia flow-fig" data-theme="dark"><div class="dia-stage">${figureSvg({ width: W, height: H, label, body: fig.body })}</div></div>`;
  const stage = host.querySelector<HTMLElement>('.dia-stage')!;
  const svg = stage.querySelector('svg')!;
  svg.setAttribute('role', 'group');
  const el = <T extends SVGElement = SVGElement>(sel: string) => svg.querySelector<T>(sel)!;

  const keys = Array.from({ length: n }, (_, i) => ({
    g: el(`[data-key="${i}"]`),
    cap: el(`[data-part="cap${i}"]`),
    glow: el(`[data-part="glow${i}"]`),
    num: el(`[data-part="kn${i}"]`),
    nt: el(`[data-part="nt${i}"]`),
    det: el(`[data-part="det${i}"]`),
  }));
  const knobG = el('[data-knob]'), knobMark = el('[data-part="knobMark"]'), thumb = el('[data-part="thumb"]');
  const t1 = el<SVGTextElement>('[data-part="t1"]'), t2 = el<SVGTextElement>('[data-part="t2"]'), scrText = el('[data-part="scrText"]'), flash = el('[data-part="flash"]');
  const strip = el('[data-part="strip"]'), pulse = el('[data-part="pulse"]');
  const pulseOuter = pulse.children[0], pulseInner = pulse.children[1];
  const auto = el('[data-part="auto"]'), autoG = el('[data-part="autoG"]');

  // ---- state
  let idx = 0; // the stage the screen is on
  let autoOn = (opts.auto ?? true) && n > 1; // the flow plays by itself (the knob's press toggles it)
  let idleUntil = 0; // seconds (the loop's clock): the play waits until then
  let nextAuto = 0;
  let held = false; // a chip holds a stage
  let downKey = -1; // the key under a finger
  let hover = -1;
  let dragging: null | { kind: 'knob'; id: number; last: number; acc: number; moved: boolean; t: number } | { kind: 'slider'; id: number } = null;
  const pressAt: number[] = Array(n).fill(-1); // when each key went down (clock seconds), or -1
  const releaseAt: number[] = Array(n).fill(-1);
  const lift = Array(n).fill(0); // hover
  const act = Array(n).fill(0); // the lit key
  const knobA: Spring = { x: fig.knobBase, v: 0 };
  const sliderP: Spring = { x: 0, v: 0 };
  let sliderTarget = 0;
  let commitAt = -10; // when the screen last changed
  let shown = -1; // the stage whose name the screen shows
  let swapped = true; // the new name has been written for this change
  let lastClock = 0, now = 0;

  // ---- the screen
  function layout(name: string) {
    const words = name.split(' ');
    let lines = [name];
    if (name.length > 10 && words.length > 1) {
      let best = 1, gap = Infinity;
      for (let k = 1; k < words.length; k++) {
        const a = words.slice(0, k).join(' ').length;
        if (Math.abs(a - (name.length - a - 1)) < gap) { gap = Math.abs(a - (name.length - a - 1)); best = k; }
      }
      lines = [words.slice(0, best).join(' '), words.slice(best).join(' ')];
    }
    const base = lines.length > 1 ? 19 : 23;
    t1.textContent = lines[0];
    t2.textContent = lines[1] ?? '';
    t1.style.fontSize = t2.style.fontSize = `${base}px`;
    const len = Math.max(t1.getComputedTextLength(), lines[1] ? t2.getComputedTextLength() : 0);
    const fs = len > SCREEN.w - 34 ? (base * (SCREEN.w - 34)) / len : base;
    t1.style.fontSize = t2.style.fontSize = `${f2(fs)}px`;
    const c = SCREEN.h / 2;
    if (lines[1]) {
      attr(t1, 'y', String(f2(c - 0.215 * fs)));
      attr(t2, 'y', String(f2(c - 0.215 * fs + 1.15 * fs)));
    } else attr(t1, 'y', String(f2(c + 0.36 * fs)));
  }

  /** Makes stage i the one on the screen. `press`: the key goes down on its own (a chip, the knob, the slider, the play), as a finger would. */
  function commit(i: number, press: boolean) {
    i = clamp(Math.round(i), 0, n - 1);
    if (i === idx) return;
    idx = i;
    commitAt = now;
    swapped = false;
    if (readEl) readEl.textContent = names[i];
    if (press) {
      pressAt[i] = now;
      releaseAt[i] = now + KEY_DOWN + 0.06;
    }
    sliderTarget = i;
    pick(i);
    loop.wake();
  }

  // ---- drawing
  function draw(_t: number, clock: number, still: boolean) {
    now = clock;
    const dt = Math.min(clock - lastClock || 1 / 60, 0.05);
    lastClock = clock;
    if (still) {
      // Motion off: everything is at rest, the screen shows the stage at once
      knobA.x = fig.knobBase + idx * fig.knobStep; knobA.v = 0;
      if (!dragging) { sliderP.x = idx; sliderP.v = 0; }
      if (shown !== idx) { shown = idx; layout(names[idx]); }
      swapped = true;
    } else {
      follow(knobA, fig.knobBase + idx * fig.knobStep, dt);
      if (!dragging) follow(sliderP, sliderTarget, dt);
      // the play: while nobody has touched anything for a while, press the next key now and then
      if (autoOn && !held && !dragging && n > 1) {
        if (!nextAuto) nextAuto = clock + 1.4;
        if (clock >= Math.max(nextAuto, idleUntil)) {
          nextAuto = clock + (idx === n - 1 ? DWELL + 0.8 : DWELL);
          commit(idx === n - 1 ? 0 : idx + 1, true);
        }
      }
    }
    // keys
    keys.forEach((k, i) => {
      let press = 0;
      if (pressAt[i] >= 0) {
        const down = ease(clamp((clock - pressAt[i]) / KEY_DOWN));
        const up = releaseAt[i] >= 0 ? ease(clamp((clock - releaseAt[i]) / KEY_UP)) : 0;
        press = still ? 0 : down * (1 - up);
        if (releaseAt[i] >= 0 && up >= 1) { pressAt[i] = -1; releaseAt[i] = -1; }
      }
      lift[i] += ((hover === i && !still ? 1 : 0) - lift[i]) * Math.min(1, dt * 16);
      act[i] += ((i === idx ? 1 : 0) - act[i]) * (still ? 1 : Math.min(1, dt * 14));
      attr(k.cap, 'transform', `translate(0 ${f2((press * KEY_TRAVEL - lift[i] * 0.8) * fig.KZ)})`);
      sty(k.glow, 'opacity', Math.min(1, act[i] * 0.95 + lift[i] * 0.35));
      sty(k.num, 'fillOpacity', 0.55 + 0.45 * Math.max(act[i], lift[i], press));
      sty(k.nt, 'opacity', act[i]);
      sty(k.det, 'opacity', act[i]);
    });
    // knob and slider
    attr(knobMark, 'transform', `rotate(${f2(knobA.x)})`);
    const pos = clamp(sliderP.x, -0.15, n - 1 + 0.15);
    const dy = n > 1 ? ((fig.slotY[n - 1] - fig.slotY[0]) * pos) / (n - 1) : 0;
    attr(thumb, 'transform', `translate(${f2(dy * fig.ay[0])} ${f2(dy * fig.ay[1])})`);
    // the screen: the old name goes out, the new one comes in, a faint refresh flashes
    const since = clock - commitAt;
    if (!swapped && (since >= 0.09 || still)) {
      swapped = true;
      shown = idx;
      layout(names[idx]);
    }
    const fade = still ? 1 : swapped ? ease(clamp((since - 0.09) / 0.16)) : 1 - clamp(since / 0.09);
    sty(scrText, 'opacity', commitAt < 0 ? 1 : fade);
    const fl = still ? 0 : Math.exp(-Math.max(0, since) / 0.14);
    sty(flash, 'opacity', 0.14 * fl);
    // the light strip: it breathes a little and flares with each stage
    const breathe = still ? 0.8 : 0.72 + 0.1 * Math.sin(clock * 2.2);
    sty(strip, 'opacity', clamp(breathe + 0.28 * fl));
    // the pulse along the cable
    const p = since / PULSE;
    if (!still && p >= 0 && p < 1) {
      const at = fig.pulse[Math.min(fig.pulse.length - 1, Math.floor(p * (fig.pulse.length - 1)))];
      const tf = `translate(${at[0]} ${at[1]})`;
      attr(pulseOuter, 'transform', tf);
      attr(pulseInner, 'transform', tf);
      sty(pulse, 'opacity', Math.sin(Math.PI * p));
    } else sty(pulse, 'opacity', 0);
    // the lamp by the knob: lit while the flow plays by itself
    const playing = autoOn ? (still ? 0.8 : 0.65 + 0.35 * Math.sin(clock * 3)) : 0.18;
    sty(auto, 'opacity', playing);
    sty(autoG, 'opacity', autoOn ? 0.5 * playing : 0);
  }

  // ---- the pointer
  const toSvg = (e: PointerEvent) => {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = svg.getScreenCTM();
    return m ? pt.matrixTransform(m.inverse()) : pt;
  };
  const touched = () => { idleUntil = now + RESUME; };
  const keyOf = (t: EventTarget | null) => Number((t as Element | null)?.closest?.('[data-key]')?.getAttribute('data-key') ?? -1);
  const sliderAt = (e: PointerEvent) => {
    const p = toSvg(e);
    const [ax, ay] = fig.sliderA, [bx, by] = fig.sliderB;
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
    return clamp(((p.x - ax) * (bx - ax) + (p.y - ay) * (by - ay)) / len2) * (n - 1);
  };

  svg.addEventListener('pointerdown', (e) => {
    const k = keyOf(e.target);
    const target = e.target as Element;
    if (k >= 0) {
      touched();
      const had = k === idx; // the same key again: the chips still hear it
      commit(k, false);
      pressAt[k] = now;
      releaseAt[k] = -1;
      if (had) pick(k);
      downKey = k;
      loop.wake();
    } else if (target.closest('[data-knob]')) {
      touched();
      const p = toSvg(e);
      dragging = { kind: 'knob', id: e.pointerId, last: Math.atan2(p.y - fig.knobC[1], p.x - fig.knobC[0]), acc: 0, moved: false, t: performance.now() };
      svg.setPointerCapture(e.pointerId);
      knobG.classList.add('is-grab');
      e.preventDefault();
    } else if (target.closest('[data-slider]')) {
      touched();
      dragging = { kind: 'slider', id: e.pointerId };
      svg.setPointerCapture(e.pointerId);
      sliderP.x = sliderAt(e);
      commit(sliderP.x, true);
      e.preventDefault();
      loop.wake();
    }
  });
  svg.addEventListener('pointermove', (e) => {
    if (dragging && dragging.id === e.pointerId) {
      touched();
      if (dragging.kind === 'knob') {
        const p = toSvg(e);
        const a = Math.atan2(p.y - fig.knobC[1], p.x - fig.knobC[0]);
        let d = a - dragging.last;
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        dragging.last = a;
        dragging.acc += d;
        if (Math.abs(d) > 0.01) dragging.moved = true;
        while (Math.abs(dragging.acc) >= STEP) {
          const s = Math.sign(dragging.acc);
          dragging.acc -= s * STEP;
          commit(idx + s, true);
        }
      } else {
        sliderP.x = sliderAt(e);
        commit(sliderP.x, true);
      }
      loop.wake();
      return;
    }
    if (e.pointerType === 'mouse') {
      const k = keyOf(e.target);
      if (k !== hover) {
        hover = k;
        loop.wake();
      }
    }
  });
  const release = (e: PointerEvent) => {
    if (dragging && dragging.id === e.pointerId) {
      if (dragging.kind === 'knob') {
        knobG.classList.remove('is-grab');
        // a press that did not turn the knob toggles the flow's own play
        if (!dragging.moved && performance.now() - dragging.t < 500 && e.type === 'pointerup') togglePlay();
      }
      dragging = null;
      sliderTarget = idx;
      svg.releasePointerCapture?.(e.pointerId);
    }
    if (downKey >= 0) {
      releaseAt[downKey] = Math.max(now, pressAt[downKey] + KEY_DOWN + 0.03);
      downKey = -1;
    }
    loop.wake();
  };
  svg.addEventListener('pointerup', release);
  svg.addEventListener('pointercancel', release);
  svg.addEventListener('pointerleave', () => {
    if (hover >= 0) {
      hover = -1;
      loop.wake();
    }
  });
  function togglePlay() {
    if (n < 2) return;
    autoOn = !autoOn;
    nextAuto = 0;
    loop.wake();
  }

  // ---- the keyboard: the keys are one tab stop (arrows move between them), the knob is another
  keys.forEach((k, i) => {
    k.g.setAttribute('role', 'button');
    k.g.setAttribute('aria-label', `${i + 1}, ${names[i]}`);
    k.g.setAttribute('tabindex', i === 0 ? '0' : '-1');
  });
  knobG.setAttribute('role', 'slider');
  knobG.setAttribute('tabindex', '0');
  knobG.setAttribute('aria-label', 'Stage');
  knobG.setAttribute('aria-valuemin', '1');
  knobG.setAttribute('aria-valuemax', String(n));
  const syncAria = () => {
    knobG.setAttribute('aria-valuenow', String(idx + 1));
    knobG.setAttribute('aria-valuetext', names[idx]);
    keys.forEach((k, i) => k.g.setAttribute('tabindex', i === idx ? '0' : '-1'));
  };
  syncAria();
  function pick(i: number) {
    syncAria();
    opts.onPick?.(i);
  }
  svg.addEventListener('keydown', (e) => {
    const target = e.target as Element;
    const move = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    const k = keyOf(target);
    if (k >= 0) {
      if (move) {
        e.preventDefault();
        const to = clamp(k + move, 0, n - 1);
        touched();
        commit(to, true);
        syncAria();
        keys[to].g.focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        touched();
        pressAt[k] = now;
        releaseAt[k] = now + KEY_DOWN + 0.06;
        commit(k, false);
        loop.wake();
      }
    } else if (target.closest('[data-knob]')) {
      if (move) {
        e.preventDefault();
        touched();
        commit(idx + move, true);
        syncAria();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        togglePlay();
      }
    }
  });

  const loop = driveLoop({ stage, length: 1e9, poster: 0, draw });
  document.fonts?.ready.then(() => shown >= 0 && layout(names[shown]));
  if (readEl) readEl.textContent = names[0];
  pick(0);

  return {
    hold(i) {
      if (i < 0) {
        held = false;
        idleUntil = now + 4;
        nextAuto = 0;
        loop.wake();
        return;
      }
      held = true;
      const k = clamp(i, 0, n - 1);
      const same = k === idx;
      commit(k, true);
      if (same) {
        pressAt[k] = now;
        releaseAt[k] = now + KEY_DOWN + 0.06;
      }
      loop.wake();
    },
    destroy() {
      loop.destroy();
      host.innerHTML = '';
    },
  };
}
