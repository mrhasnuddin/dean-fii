// Design flow figure (docs/device-design.md §57), built with the vendored anatomy kit: a nine-key macropad (a knob and a slider on its
// plate) joined by a cable to a small desk screen. One key per stage of a project's flow, numbered from 1; a key press shows the
// stage's name on the screen. The knob steps through the stages, the slider scrubs them. Everything static is built once as SVG
// strings with the parts the page moves marked `data-part`; the page is live.ts. Plain ESM, so the page and the Node checks share it.
// World units are about 1 px of the real thing; x runs toward the viewer, y to the left, z up.
import * as k from '../../vendor/anatomy/iso-kit.mjs';
import * as G from '../../vendor/anatomy/lathe.mjs';
import * as T from '../../vendor/anatomy/tube.mjs';
import { bench, dot, drawKit, fitEqual, line, matPoints, pa, rr } from '../kit/draw.mjs';

export const W = 900;
export const MAX_KEYS = 9;

// ---------------------------------------------------------------- layout
const BENCH = { x: -14, y: -14, w: 220, d: 444, r: 10 };
const DEV = { x: 20, y: 20, w: 110, d: 150, r: 9 }; // the screen device's base
const DEV_H = 22;
const WEDGE = { poly: [[38, DEV_H], [38, 64], [94, 30], [94, DEV_H]], y0: 34, y1: 156 }; // the screen block, in (x, z), from y0 to y1
const PAD = { x: 24, y: 240, w: 142, d: 176, r: 10 };
const PAD_H = 8;
const KEY_X = [66, 100, 134]; // key rows, back to front
const KEY_Y = [380, 346, 312]; // key columns, left to right
const CAP_UP = PAD_H + 3; // the cap's bottom
const CAP_H = 8;
const KNOB = [76, 268];
const SLIDER = { x: 38, from: 388, to: 304 }; // the thumb's travel along y: stage 0 at the left end
const DETENT_R = 23;
const CR = 3.2; // the cable's radius

// The box fits what is drawn (the mat and the screen block's top), the same gap on every side.
const FIT = fitEqual([...matPoints(BENCH), [38, 34, 64], [38, 156, 64]], W, { pad: 36, azimuth: 30, elevation: 28 });
export const P = FIT.P;
export const H = FIT.H;
const V = G.viewOf(P);
const D = drawKit(P);
export const iso3 = (p) => k.iso(p, P);
const KZ = iso3([0, 0, 0])[1] - iso3([0, 0, 1])[1];
const f1 = (v) => Math.round(v * 10) / 10;
/** A matrix that lays flat shapes, and text that reads left to right, on a horizontal face: u runs right on screen (world -y), v down (world +x). */
const topM = (cx, cy, z) => D.M([cx, cy, z], [0, -1, 0], [1, 0, 0]);
/** The point at angle phi (degrees, clockwise from "up" on screen) and radius r round a centre, on the pad. */
const ringPt = (c, phi, r) => [c[0] - r * Math.cos((phi * Math.PI) / 180), c[1] - r * Math.sin((phi * Math.PI) / 180)];

// ---------------------------------------------------------------- the screen device: a base, a screen block and its glass, a light strip, a port
export const SCREEN = (() => {
  const dx = WEDGE.poly[2][0] - WEDGE.poly[1][0], dz = WEDGE.poly[2][1] - WEDGE.poly[1][1];
  const len = Math.hypot(dx, dz);
  return { w: WEDGE.y1 - WEDGE.y0, h: len, down: [dx / len, 0, dz / len] };
})();
function device() {
  const out = [D.halo(DEV, 0, DEV_H)];
  out.push(D.slab(DEV, 0, DEV_H, 'hi', { bevel: 1.2, steps: 6, inner: D.Ln(k.sideSeam(DEV, 11, P, 6), { tone: 'faint' }) }));
  out.push(k.dotsSvg(k.pointsAt(k.corners(DEV, 5).map(([x, y]) => [x, y, DEV_H]), P), { size: 0.55 }));
  // the screen block: a wedge that leans toward the viewer, in the one lit tone
  const F = { o: [0, WEDGE.y1, 0], u: [1, 0, 0], v: [0, 0, 1], a: [0, -1, 0] };
  out.push(D.S(G.prismOf(F, WEDGE.poly, 0, SCREEN.w, P), { tone: 'hi', lit: true }));
  const face = [];
  face.push(pa('bz', rr(4, 4, SCREEN.w - 4, SCREEN.h - 4, 6)), line('lo', rr(4, 4, SCREEN.w - 4, SCREEN.h - 4, 6)));
  face.push(pa('lcd', rr(9, 9, SCREEN.w - 9, SCREEN.h - 9, 3)));
  face.push(`<rect data-part="flash" class="scr-flash" x="9" y="9" width="${SCREEN.w - 18}" height="${SCREEN.h - 18}" rx="3" style="opacity:0"/>`);
  face.push(`<g data-part="scrText"><text class="scr-t" data-part="t1" x="${SCREEN.w / 2}" y="${SCREEN.h / 2}" text-anchor="middle"></text><text class="scr-t" data-part="t2" x="${SCREEN.w / 2}" y="${SCREEN.h / 2}" text-anchor="middle"></text></g>`);
  face.push(pa('glass', `M13 11H${13 + 46}L11 ${11 + 40}V13Z`));
  out.push(D.deco(D.M([WEDGE.poly[1][0], WEDGE.y1, WEDGE.poly[1][1]], [0, -1, 0], SCREEN.down), face.join('')));
  // the front of the base: a button and the light strip, which glows as keys are pressed
  const fr = [pa('pnl', rr(12, 8, 30, 16, 4)), pa('dk', rr(70, 7, 140, 17, 3.2)), `<g data-part="strip">${pa('gd', rr(73, 9.4, 137, 14.6, 2.6))}${pa('gd3', rr(69, 6, 141, 18, 5))}</g>`];
  out.push(D.deco(D.xFace(DEV, DEV_H), fr.join('')));
  // the port on the side that faces the pad, with the plug that sits in it
  out.push(D.deco(D.yFace(DEV, DEV_H), pa('dk', rr(48, 7, 72, 15.4, 2.2))));
  out.push(D.halo({ x: 72, y: 171, w: 16, d: 15, r: 3 }, 3, 16), D.slab({ x: 72, y: 171, w: 16, d: 15, r: 3 }, 3, 16, 'mid', { steps: 3, bevel: 0.6, inner: D.Ln(k.sideSeam({ x: 72, y: 171, w: 16, d: 15, r: 3 }, 11, P, 3), { tone: 'faint' }) }));
  return out.join('');
}

// ---------------------------------------------------------------- the cable
const ROUTE = G.fillet([[100, 241, 5.5], [100, 228, CR], [118, 228, CR], [118, 204, CR], [80, 204, CR], [80, 196, 11], [80, 186, 11]], 9, 8, { P, tube: CR });
function cable() {
  return T.tubePieces(ROUTE, CR, P, { maxLength: 400 })
    .sort((a, b) => G.dot3(a.mid, V) - G.dot3(b.mid, V))
    .map((p) => T.tubeSvg(p, { tone: 'mid' }))
    .join('');
}
const ROUTE_LEN = G.pathLength(ROUTE);
/** Screen points along the cable, from the pad to the screen device (a signal pulse runs along them). */
const PULSE = Array.from({ length: 48 }, (_, i) => iso3(G.pointAlong(ROUTE, (ROUTE_LEN * i) / 47)).map(f1));

// ---------------------------------------------------------------- the pad
const slotY = (n, i) => (n < 2 ? SLIDER.from : SLIDER.from + ((SLIDER.to - SLIDER.from) * i) / (n - 1));
const knobStep = (n) => Math.min(34, 200 / Math.max(1, n - 1));
const KNOB_BASE = -100;

function key(i, n) {
  const r = Math.floor(i / 3), c = i % 3;
  const cx = KEY_X[r], cy = KEY_Y[c];
  const live = i < n;
  const house = D.slab({ x: cx - 16, y: cy - 16, w: 32, d: 32, r: 5 }, PAD_H, 3, 'lo', { steps: 4, bevel: 0.4 });
  const glow = live ? `<g data-part="glow${i}" style="opacity:0">${D.Ln(k.planOutline({ x: cx - 14.6, y: cy - 14.6, w: 29.2, d: 29.2, r: 4.2 }, PAD_H + 3.05, P, 4), { tone: 'lit' })}</g>` : '';
  const capPlan = { x: cx - 13.5, y: cy - 13.5, w: 27, d: 27, r: 4.5 };
  const inner = D.Ln(k.planOutline(k.insetPlan(capPlan, 3), CAP_UP + CAP_H, P, 4), { tone: 'faint' });
  const cap = D.slab(capPlan, CAP_UP, CAP_H, live ? 'mid' : 'lo', { steps: 5, bevel: 1.4, inner });
  const num = live ? D.deco(topM(cx, cy, CAP_UP + CAP_H + 0.05), `<text class="key-n" data-part="kn${i}" x="0" y="4.6" text-anchor="middle">${i + 1}</text>`) : '';
  const attrs = live ? ` data-key="${i}"` : '';
  return { depth: k.depthOf([cx, cy, PAD_H + 6], P), svg: `<g${attrs}>${house}${glow}<g data-part="cap${i}">${cap}${num}</g></g>` };
}

function knob(n) {
  const [cx, cy] = KNOB;
  const out = [D.S(k.cylinder(cx, cy, 17, PAD_H, 2, P, 40, 0.4), { tone: 'lo' })];
  out.push(D.S(k.cylinder(cx, cy, 13, PAD_H + 2, 16, P, 40, 0.8), { tone: 'hi', inner: D.Ln(k.knurl(cx, cy, 13, PAD_H + 2, PAD_H + 18, 30, P), { tone: 'faint' }) }));
  out.push(D.S(k.cylinder(cx, cy, 11, PAD_H + 18, 2, P, 36, 0.5), { tone: 'mid' }));
  out.push(D.deco(topM(cx, cy, PAD_H + 20.05), `<g data-part="knobMark"><path class="knob-ln" d="M0 -3.5V-10"/><circle class="gd" cx="0" cy="-10.6" r="1.5"/></g>`));
  void n;
  return { depth: k.depthOf([cx, cy, PAD_H + 8], P), svg: `<g data-knob>${out.join('')}</g>` };
}

function thumb(n) {
  const y0 = slotY(n, 0);
  const plan = { x: SLIDER.x - 8, y: y0 - 8, w: 16, d: 16, r: 3 };
  const grip = [-3.5, 0, 3.5].map((j) => k.lineOnTop([SLIDER.x - 5, y0 + j], [SLIDER.x + 5, y0 + j], PAD_H + 7, P)).join('');
  const s = D.slab(plan, PAD_H, 7, 'hi', { steps: 4, bevel: 0.8, inner: D.Ln(grip, { tone: 'mid' }) });
  // a transparent strip over the slot, so a press anywhere along it grabs the slider
  const hit = k.onTop(k.ringOf({ x: SLIDER.x - 12, y: slotY(n, n - 1) - 14, w: 24, d: slotY(n, 0) - slotY(n, n - 1) + 28, r: 8 }, 4), PAD_H + 1, P, true);
  // The thumb runs along the back edge, behind every key and the knob wherever it is, so it is painted first (its depth at stage 0 would put
  // it in front of the keys it slides past at the other end).
  return { depth: -1e9, svg: `<g data-slider><path class="hit" d="${hit}"/><g data-part="thumb">${D.halo(plan, PAD_H, 1)}${s}</g></g>` };
}

/** What lies flat on the plate: an inset line, the slider's slot and its notches, the knob's recess and its detents, a lamp, a flag. */
function plateDecals(n) {
  const L = (x, y) => [x - PAD.x, y - PAD.y];
  const t = [line('faint', rr(8, 8, PAD.w - 8, PAD.d - 8, 6))];
  // the slider
  const [su, sv0] = L(SLIDER.x, SLIDER.from + 16), [, sv1] = L(SLIDER.x, SLIDER.to - 16);
  t.push(pa('dk', rr(su - 7, sv1, su + 7, sv0, 7)), line('lo', rr(su - 7, sv1, su + 7, sv0, 7)), line('mid', `M${su} ${sv1 + 6}V${sv0 - 6}`));
  for (let i = 0; i < n; i++) {
    const [u, v] = L(SLIDER.x + 14, slotY(n, i));
    t.push(dot('nt', u, v, 1.5), dot('gd', u, v, 1.5, ` data-part="nt${i}" style="opacity:0"`));
  }
  // the knob: a dark recess and a ring of detents, one per stage
  const [ku, kv] = L(KNOB[0], KNOB[1]);
  t.push(pa('dk', `M${ku - 19} ${kv}A19 19 0 1 1 ${ku + 19} ${kv}A19 19 0 1 1 ${ku - 19} ${kv}Z`));
  for (let i = 0; i < n; i++) {
    const [x, y] = ringPt(KNOB, KNOB_BASE + i * knobStep(n), DETENT_R);
    const [u, v] = L(x, y);
    t.push(dot('nt', f1(u), f1(v), 1.5), dot('gd', f1(u), f1(v), 1.5, ` data-part="det${i}" style="opacity:0"`));
  }
  // the lamp that says the flow is playing by itself, a chequered flag and some rule lines (no text)
  const [lu, lv] = L(KNOB[0] + 38, KNOB[1]);
  t.push(dot('gd3', lu, lv, 4, ' data-part="autoG" style="opacity:0"'), dot('gd', lu, lv, 1.8, ' data-part="auto" style="opacity:0.25"'));
  const [fu, fv] = L(118, 252);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) if ((r + c) % 2 === 0) t.push(pa('pnl', `M${fu + c * 5} ${fv + r * 5}h5v5h-5Z`));
  t.push(line('lo', `M${fu} ${fv + 20}H${fu + 20}M${fu} ${fv + 24}H${fu + 14}`, true));
  return D.deco(D.tFace(PAD, PAD_H), t.join(''));
}

function pad(n) {
  const out = [D.halo(PAD, 0, PAD_H)];
  out.push(D.slab(PAD, 0, PAD_H, 'lo', { bevel: 1.2, steps: 6, inner: D.Ln(k.sideSeam(PAD, 4, P, 6), { tone: 'faint' }) }));
  out.push(plateDecals(n));
  out.push(k.dotsSvg(k.pointsAt(k.corners(PAD, 6).map(([x, y]) => [x, y, PAD_H]), P), { size: 0.8, tone: 'hi' }));
  const items = [knob(n), thumb(n)];
  for (let i = 0; i < MAX_KEYS; i++) items.push(key(i, n));
  items.sort((a, b) => a.depth - b.depth);
  return out.join('') + items.map((i) => i.svg).join('');
}

/** The figure for n stages (1 to 9): its markup, back to front, and what the page needs to move and read it. */
export function buildFlow(n) {
  const count = Math.max(1, Math.min(MAX_KEYS, n));
  const pulse = `<g data-part="pulse" style="opacity:0"><circle class="gd3" r="7"/><circle class="gd" r="2.2"/></g>`;
  const body = [bench(P, BENCH), device(), cable(), pulse, pad(count)];
  return {
    n: count, P, KZ, body,
    ay: k.axisVector(P, [0, 1, 0]),
    sliderA: iso3([SLIDER.x, slotY(count, 0), PAD_H + 7]),
    sliderB: iso3([SLIDER.x, slotY(count, count - 1), PAD_H + 7]),
    slotY: Array.from({ length: count }, (_, i) => slotY(count, i)),
    knobC: iso3([KNOB[0], KNOB[1], PAD_H + 20]),
    knobBase: KNOB_BASE,
    knobStep: knobStep(count),
    pulse: PULSE,
  };
}
