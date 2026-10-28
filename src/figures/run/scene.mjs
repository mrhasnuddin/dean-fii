// The "How I work" instrument's geometry (docs/device-design.md §32), built with the vendored anatomy kit: a retro
// workstation on a cutting mat. A CRT shows the output, a console is the agent (a skills cartridge and the brief card
// stand on it, two lamps show which agent is on, a slider and a knob are what gets tuned), a controller is Dean's hand,
// a small unit is the light-work agent, a phone on a stand is the shared link and a tray takes the finished cartridge.
// There is no text in it. Everything static is built once as SVG strings; the page (live.ts) moves the parts marked
// data-part, fills the screens (data-screen) and lights the lamps. Plain ESM, so the page and the Node checks share it.
import * as k from '../../vendor/anatomy/iso-kit.mjs';
import * as G from '../../vendor/anatomy/lathe.mjs';
import * as T from '../../vendor/anatomy/tube.mjs';

export const W = 800;
export const H = 570;

// ---------------------------------------------------------------- layout (world units, about 1 px; x, y on the floor, z up)
export const MAT = { x: -142, y: -144, w: 326, d: 224, r: 9 };
const MAT_H = 4;
export const CRT = { x: -128, y: -104, w: 98, d: 68, r: 6 };
export const CRT_TOP = 106;
const HUMP = { x: -120, y: -134, w: 82, d: 30, r: 7 }; // its front face is the body's back
export const CON = { x: 2, y: -100, w: 108, d: 78, r: 7 };
export const CON_H = 26;
const SEAT = CON_H + 4; // the tray on the console's top, where the cartridge and the card stand
export const CART = { x: 34, y: -80, w: 56, d: 13, r: 2.6 };
const CART_H = 56;
export const CARD = { x: 22, y: -88, w: 60, d: 3.5, r: 1.2 };
const CARD_H = 64;
export const CTL = { x: -30, y: 22, w: 92, d: 38, r: 8 };
const CTL_H = 9;
export const PKT = { x: -104, y: 6, w: 44, d: 36, r: 5 };
const PKT_H = 30;
export const TRAY = { x: 75, y: 22, w: 50, d: 44, r: 6 };
const FIN = { x: TRAY.x + 8, y: TRAY.y + 9, w: 34, d: 26, r: 2.5 };
export const PHB = { x: 128, y: -126, w: 42, d: 26, r: 4 };
export const PH = { x: 131, y: -122, w: 36, d: 5, r: 2 };
export const PH_H = 76;
const PH_TOP = 8 + PH_H;

export const RISE = 26; // how far the card and the cartridge float above their seats before they are set down

export const P = k.fitProjection(
  [
    ...k.boxCorners(MAT, -MAT_H - 3, 0),
    ...k.boxCorners({ x: -120, y: -134, w: 90, d: 100 }, 106, 110),
    [CART.x + 28, CART.y + 6, SEAT + CART_H + RISE + 4], [CARD.x + 30, CARD.y, SEAT + CARD_H + RISE + 4],
    [PH.x + 18, PH.y + 2, 90], [TRAY.x + 25, TRAY.y + 40, 14],
  ],
  W, H, { pad: 22, azimuth: 45 },
);
const V = G.viewOf(P);
export const iso3 = (p) => k.iso(p, P);
const iso = iso3;
/** Screen pixels (in the figure's own units) a part moves up for each world unit it is lifted. */
export const KZ = iso([0, 0, 0])[1] - iso([0, 0, 1])[1];

const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const slab = (plan, z0, h, tone, o = {}) => S(k.slabOf(plan, z0, h, P, o.steps ?? 4, o.bevel ?? 0), { tone, inner: o.inner ?? '', lit: o.lit });
const halo = (plan, z0, h) => `<path class="iso-halo" d="${k.haloOf(plan, z0, h, P)}"/>`;

// flat decals: u right, v down, in world units, laid on a face
const M = (o, ux, uy) => {
  const a = iso(o), b = iso(G.add3(o, ux)), c = iso(G.add3(o, uy));
  const f = (v) => +v.toFixed(4);
  return `matrix(${f(b[0] - a[0])} ${f(b[1] - a[1])} ${f(c[0] - a[0])} ${f(c[1] - a[1])} ${f(a[0])} ${f(a[1])})`;
};
const yFace = (pl, zTop) => M([pl.x, pl.y + pl.d + 0.05, zTop], [1, 0, 0], [0, 0, -1]);
const xFace = (pl, zTop) => M([pl.x + pl.w + 0.05, pl.y + pl.d, zTop], [0, -1, 0], [0, 0, -1]);
const tFace = (pl, z) => M([pl.x, pl.y, z + 0.05], [1, 0, 0], [0, 1, 0]);
const deco = (m, inner, attrs = '') => `<g${attrs} transform="${m}">${inner}</g>`;
const rr = (x0, y0, x1, y1, r) => `M${x0 + r} ${y0}H${x1 - r}A${r} ${r} 0 0 1 ${x1} ${y0 + r}V${y1 - r}A${r} ${r} 0 0 1 ${x1 - r} ${y1}H${x0 + r}A${r} ${r} 0 0 1 ${x0} ${y1 - r}V${y0 + r}A${r} ${r} 0 0 1 ${x0 + r} ${y0}Z`;
const box = (x0, y0, x1, y1) => `M${x0} ${y0}H${x1}V${y1}H${x0}Z`;
const pa = (cls, d, extra = '') => `<path class="${cls}"${extra} d="${d}"/>`;
// `free`: rule lines that stand for printed text, so their ends are meant to stop
const line = (tone, d, free = false) => `<path class="iso-line" data-tone="${tone}"${free ? ' data-free' : ''} d="${d}"/>`;
const dot = (cls, x, y, r, extra = '') => `<circle class="${cls}"${extra} cx="${x}" cy="${y}" r="${r}"/>`;

// The screens' windows, in each face's own units (x right, y down). The page fills them (screens.ts).
export const SCREEN = {
  crt: { x: 12, y: 12, w: 76, h: 63, r: 6 },
  phone: { x: 3, y: 5, w: PH.w - 6, h: PH_H - 11, r: 2.2 },
  lite: { x: 7, y: 6, w: 30, h: 9, r: 2 },
};
const clip = (id, s) => `<clipPath id="run-${id}-{{u}}"><path d="${rr(s.x, s.y, s.x + s.w, s.y + s.h, s.r)}"/></clipPath>`;
const slot = (id, name) => `<g clip-path="url(#run-${id}-{{u}})" data-screen="${name}"></g>`;

// ---------------------------------------------------------------- the mat
function mat() {
  const out = [`<path class="iso-halo" d="${k.haloOf(MAT, -MAT_H, MAT_H, P)}"/>`];
  out.push(S(k.slabOf(MAT, -MAT_H, MAT_H, P, 8, 1.2), { tone: 'lo' }));
  const inner = k.insetPlan(MAT, 9);
  out.push(Ln(k.planOutline(inner, 0, P, 6), { tone: 'faint' }));
  const grid = [];
  for (let x = inner.x + 20; x < inner.x + inner.w - 4; x += 20) grid.push(k.lineOnTop([x, inner.y], [x, inner.y + inner.d], 0, P));
  for (let y = inner.y + 20; y < inner.y + inner.d - 4; y += 20) grid.push(k.lineOnTop([inner.x, y], [inner.x + inner.w, y], 0, P));
  out.push(Ln(grid.join(''), { tone: 'faint' }));
  const front = k.topTicks(inner.x + 4, inner.x + inner.w - 4, 4, 5, inner.y + inner.d, 0, [2, 3.6], P);
  out.push(Ln(front.minor, { tone: 'lo' }), Ln(front.major, { tone: 'mid' }));
  const side = k.topTicks(inner.y + 4, inner.y + inner.d - 4, 4, 5, inner.x + inner.w, 0, [2, 3.6], P, 'y');
  out.push(Ln(side.minor, { tone: 'lo' }), Ln(side.major, { tone: 'mid' }));
  // the delivery groove: from under the console's front to the tray (a pulse runs down it on Ship)
  out.push(Ln(k.lineOnTop([SHIP[0][0], SHIP[0][1]], [SHIP[1][0], SHIP[1][1]], 0, P), { tone: 'lo' }));
  out.push(k.dotsSvg([iso([SHIP[0][0], SHIP[0][1], 0]), iso([SHIP[1][0], SHIP[1][1], 0])], { size: 0.5 }));
  // corner screws
  const sc = k.corners(MAT, 5).map(([x, y]) => [x, y, 0]);
  out.push(k.dotsSvg(k.pointsAt(sc, P), { size: 0.55 }));
  return out.join('');
}

// ---------------------------------------------------------------- the CRT (the output)
function crt() {
  const out = [halo(CRT, 0, CRT_TOP)];
  out.push(slab(HUMP, 14, 84, 'mid', { bevel: 1, steps: 5 }));
  out.push(slab({ x: -122, y: -98, w: 86, d: 56, r: 4 }, 0, 7, 'lo'));
  out.push(slab(CRT, 7, CRT_TOP - 7, 'hi', { bevel: 1.2, steps: 5, inner: Ln(k.sideSeam(CRT, 30, P, 5), { tone: 'faint' }) }));
  // the front: bezel, glass (the page lives here), a drive slot, two knobs and a lamp
  const s = SCREEN.crt;
  const f = [];
  f.push(clip('c0', s));
  f.push(line('faint', rr(3, 3, 97, 97, 7)));
  f.push(pa('bz', rr(7, 7, 93, 80, 9)), line('lo', rr(7, 7, 93, 80, 9)), line('mid', rr(9, 9, 91, 78, 7.5)));
  f.push(pa('lcd', rr(s.x, s.y, s.x + s.w, s.y + s.h, s.r)));
  f.push(slot('c0', 'crt'));
  f.push(`<path class="glass" d="M18 13H48L13 47V18Z"/>`);
  f.push(pa('dk', rr(20, 87, 62, 91, 2)), line('lo', rr(20, 87, 62, 91, 2)));
  f.push(dot('pnl', 70, 89, 2.6), dot('pnl', 78, 89, 2.6), line('mid', 'M70 87.4V89M78 87.4V89'));
  f.push(dot('gd', 88, 89, 1.7, ' data-lamp="crt"'), dot('gd3', 88, 89, 3.2, ' data-glow="crt"'));
  out.push(deco(yFace(CRT, CRT_TOP), f.join('')));
  // side vents and a speaker grille
  const v = [];
  for (let i = 0; i < 6; i++) v.push(`M6 ${52 + i * 5}H36`);
  out.push(deco(xFace(CRT, CRT_TOP), line('lo', v.join('')) + line('faint', rr(6, 49, 36, 80, 2.5))));
  const gr = [];
  for (let r = 0; r < 5; r++) for (let q = 0; q < 7; q++) gr.push(dot('off', 34 + q * 3.6, 18 + r * 3.6, 0.9));
  out.push(deco(xFace(CRT, CRT_TOP), gr.join('')));
  const tv = Array.from({ length: 5 }, (_, i) => `M${12 + i * 7} 6V56`);
  out.push(deco(tFace(CRT, CRT_TOP), line('faint', tv.join('')) + line('faint', rr(10, 6, 42, 56, 2))));
  // the cable's port on the right side, and four screws on the base
  out.push(slab({ x: -30, y: -62, w: 6, d: 12, r: 1.5 }, 14, 10, 'lo', { steps: 2 }));
  const feet = k.corners({ x: -122, y: -98, w: 86, d: 56 }, 4).map(([x, y]) => [x, y, 7]);
  out.push(k.dotsSvg(k.pointsAt(feet, P), { size: 0.5 }));
  return out.join('');
}

// ---------------------------------------------------------------- the console (the agent): cartridge, brief card, lamps, slider, knob
export const KNOB = { u: 82, z: 12 }; // on the console's front, u along the front, z up
function consoleUnit() {
  const out = [halo(CON, 0, CON_H)];
  out.push(slab(CON, 0, CON_H, 'hi', { bevel: 1, steps: 5, inner: Ln(k.sideSeam(CON, 11, P, 5), { tone: 'faint' }) }));
  const tray = k.insetPlan(CON, 10);
  out.push(slab(tray, CON_H, 4, 'mid', { steps: 4, bevel: 0.6 }));
  out.push(Ln(k.planOutline(k.insetPlan(tray, 3), SEAT, P, 4), { tone: 'faint' }));
  const sc = k.corners(CON, 4.5).map(([x, y]) => [x, y, CON_H]);
  out.push(k.dotsSvg(k.pointsAt(sc, P), { size: 0.55 }));
  // the brief: a card that stands behind the cartridge once it has been set down
  const card = slab(CARD, SEAT, CARD_H, 'lo', { steps: 2 })
    + deco(yFace(CARD, SEAT + CARD_H), pa('dk', rr(0, 1, 60, 8, 0)) + pa('gd', rr(6, 16, 20, 26, 2)) + line('lo', 'M26 20H52M26 24H44', true) + line('faint', 'M6 34H54M6 38H54', true));
  out.push(`<g data-part="card">${card}</g>`);
  // the skills cartridge: nine cells on its label, lit as the skills are installed
  out.push(slab({ ...CART, x: CART.x - 2, y: CART.y - 2, w: CART.w + 4, d: CART.d + 4, r: 3 }, SEAT, 1.2, 'lo', { steps: 3 }));
  const cells = [];
  for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) cells.push(pa('cell', box(14 + q * 10, 27 + r * 9, 22 + q * 10, 33 + r * 9), ` data-cell="${r * 3 + q}"`));
  const label = line('lo', 'M6 6H50M6 9H50M6 12H50', true) + pa('gd3', rr(7, 20, 49, 58, 3)) + line('mid', rr(7, 20, 49, 58, 3)) + cells.join('');
  out.push(`<g data-part="cart">${slab(CART, SEAT + 1.2, CART_H - 1.2, 'mid', { bevel: 0.8, steps: 3 })}${deco(yFace(CART, SEAT + CART_H), label)}</g>`);
  // the front: two lamps (which agent is on), a slider (what gets tuned), a knob and two ports
  const fr = [];
  fr.push(pa('dk', rr(40, 11, 70, 17, 3)), line('lo', rr(40, 11, 70, 17, 3)));
  fr.push(pa('gd', rr(40, 11, 52, 17, 3), ' data-k="sld"'), pa('cur', box(51, 9.6, 53.2, 18.4), ' data-k="cap"'));
  fr.push(dot('gd', 95, 6, 1.5, ' data-lamp="a"'), dot('gd3', 95, 6, 3, ' data-glow="a"'), dot('gd', 103, 6, 1.5, ' data-lamp="b"'), dot('gd3', 103, 6, 3, ' data-glow="b"'));
  fr.push(pa('dk', rr(10, 13, 18, 19, 1.5)), pa('dk', rr(24, 13, 32, 19, 1.5)));
  out.push(deco(yFace(CON, CON_H), fr.join('')));
  const kf = G.frameAlong([CON.x + KNOB.u, CON.y + CON.d + 0.1, KNOB.z], [0, 1, 0]);
  out.push(S(G.disc(0, 3.2, 5.2, kf, P), { tone: 'mid' }));
  out.push(S(G.disc(3.2, 3.8, 3.4, kf, P), { tone: 'hi' }));
  out.push(deco(M([CON.x + KNOB.u, CON.y + CON.d + 3.95, KNOB.z], [1, 0, 0], [0, 0, -1]), `<g data-k="knob"><path class="knob-tick" d="M0 -0.4V-3"/></g>`));
  out.push(slab({ x: CON.x + 10, y: CON.y + CON.d, w: 8, d: 6, r: 1.5 }, 7, 6, 'lo', { steps: 2 }));
  out.push(slab({ x: CON.x + 24, y: CON.y + CON.d, w: 8, d: 6, r: 1.5 }, 7, 6, 'lo', { steps: 2 }));
  // the right side: vents and a port; the left side: a port (the CRT's cable)
  const v = [];
  for (let i = 0; i < 4; i++) v.push(`M8 ${7 + i * 4.5}H36`);
  out.push(deco(xFace(CON, CON_H), line('lo', v.join('')) + line('faint', rr(8, 4.5, 36, 23, 2))));
  out.push(slab({ x: CON.x + CON.w, y: -60, w: 7, d: 9, r: 1.5 }, 8, 8, 'lo', { steps: 2 }));
  out.push(slab({ x: CON.x - 8, y: -72, w: 8, d: 12, r: 1.5 }, 6, 8, 'lo', { steps: 2 }));
  return out.join('');
}

// ---------------------------------------------------------------- the controller (Dean's hand)
export const PAD = { cx: CTL.x + 20.5, cy: CTL.y + 19 }; // the D-pad's centre on the controller's top
const BTN_A = [CTL.x + 77, CTL.y + 15], BTN_B = [CTL.x + 66, CTL.y + 22];
export const CTL_PLUG = { x: 26, y: CTL.y - 6, w: 8, d: 6, r: 1.5 };
function controller() {
  const out = [slab(CTL_PLUG, 2, 6, 'lo', { steps: 2 }), halo(CTL, 0, CTL_H)];
  out.push(slab(CTL, 0, CTL_H, 'hi', { bevel: 1, steps: 6, inner: Ln(k.sideSeam(CTL, 4.5, P, 6), { tone: 'faint' }) }));
  const t = [];
  t.push(pa('pnl', rr(5, 5, 36, 33, 5)), pa('pnl', rr(56, 5, 87, 33, 5)));
  t.push(pa('dk', rr(39, 17, 53, 21, 2)), pa('gd', rr(39, 17, 46, 21, 2)));
  t.push(line('faint', rr(5, 5, 36, 33, 5)), line('faint', rr(56, 5, 87, 33, 5)));
  for (let i = 0; i < 4; i++) t.push(line('lo', `M${60 + i * 6} 29.5V33`));
  out.push(deco(tFace(CTL, CTL_H), t.join('')));
  // the D-pad: a cross, with a lit tip for the arm that is pressed
  const dp = G.frameOf([PAD.cx, PAD.cy, CTL_H], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  const cross = S(G.prismOf(dp, [[-10, -3.6], [10, -3.6], [10, 3.6], [-10, 3.6]], 0, 2.2, P), { tone: 'mid', crease: 'lo' })
    + S(G.prismOf(dp, [[-3.6, -10], [3.6, -10], [3.6, -3.6], [-3.6, -3.6]], 0, 2.2, P), { tone: 'mid', crease: 'lo' })
    + S(G.prismOf(dp, [[-3.6, 3.6], [3.6, 3.6], [3.6, 10], [-3.6, 10]], 0, 2.2, P), { tone: 'mid', crease: 'lo' });
  const tips = { up: [-3.2, -10, 3.2, -6.4], down: [-3.2, 6.4, 3.2, 10], left: [-10, -3.2, -6.4, 3.2], right: [6.4, -3.2, 10, 3.2] };
  const tip = Object.entries(tips).map(([d, [a, b, c, e]]) => pa('gd arm', box(PAD.cx - CTL.x + a, PAD.cy - CTL.y + b, PAD.cx - CTL.x + c, PAD.cy - CTL.y + e), ` data-arm="${d}"`)).join('');
  out.push(`<g data-part="dpad">${cross}${deco(tFace(CTL, CTL_H + 2.2), tip)}</g>`);
  out.push(`<g data-part="btn-b">${S(k.cylinder(BTN_B[0], BTN_B[1], 4.4, CTL_H, 2.2, P, 18, 0.4), { tone: 'lo' })}</g>`);
  out.push(`<g data-part="btn-a">${S(k.cylinder(BTN_A[0], BTN_A[1], 4.4, CTL_H, 2.2, P, 18, 0.4), { tone: 'lit', lit: true })}</g>`);
  return out.join('');
}

// ---------------------------------------------------------------- the light-work unit
export const LITE_PLUG = { x: PKT.x + PKT.w, y: 17, w: 6, d: 8, r: 1.5 };
function pocket() {
  const out = [halo(PKT, 0, PKT_H)];
  out.push(slab(PKT, 0, PKT_H, 'hi', { bevel: 1, steps: 4, inner: Ln(k.sideSeam(PKT, 15, P, 4), { tone: 'faint' }) }));
  const s = SCREEN.lite;
  const f = [];
  f.push(clip('l0', s));
  f.push(pa('bz', rr(5, 4, 39, 17, 3)), line('lo', rr(5, 4, 39, 17, 3)), pa('lcd', rr(s.x, s.y, s.x + s.w, s.y + s.h, s.r)));
  f.push(slot('l0', 'lite'));
  f.push(dot('pnl', 12, 23, 3.6), dot('gd', 31, 21.5, 1.9, ' data-lamp="lite"'), dot('gd3', 31, 21.5, 3.6, ' data-glow="lite"'), dot('dk', 36, 24, 1.9));
  out.push(deco(yFace(PKT, PKT_H), f.join('')));
  const vt = Array.from({ length: 4 }, (_, i) => `M${8 + i * 6} 4V${PKT.d - 6}`);
  out.push(deco(tFace(PKT, PKT_H), line('faint', vt.join('')) + line('faint', rr(6, 4, 28, PKT.d - 6, 2))));
  out.push(slab(LITE_PLUG, 8, 6, 'lo', { steps: 2 }));
  return out.join('');
}

// ---------------------------------------------------------------- the out tray and the finished cartridge
function tray() {
  const out = [halo(TRAY, 0, 4)];
  out.push(slab(TRAY, 0, 4, 'mid', { steps: 5 }));
  const inner = k.insetPlan(TRAY, 3);
  out.push(Ln(k.planOutline(inner, 4, P, 5), { tone: 'lo' }));
  out.push(`<g data-part="ring" style="opacity:0">${Ln(k.planOutline(inner, 4, P, 5), { tone: 'lit' })}</g>`);
  out.push(k.dotsSvg(k.pointsAt(k.corners(TRAY, 5.5).map(([x, y]) => [x, y, 4]), P), { size: 0.5 }));
  const t = [];
  t.push(pa('gd3', rr(4, 4, 30, 22, 2)));
  for (let r = 0; r < 2; r++) for (let q = 0; q < 3; q++) t.push(pa(r === 0 && q === 1 ? 'gd' : 'gd2', box(7 + q * 8, 7 + r * 7, 13 + q * 8, 12 + r * 7)));
  t.push(line('mid', 'M4 25H30'));
  out.push(`<g data-part="fin" style="opacity:0">${slab(FIN, 4, 9, 'mid', { bevel: 0.6, steps: 3 })}${deco(tFace(FIN, 13), t.join(''))}</g>`);
  return out.join('');
}

// ---------------------------------------------------------------- the phone (the shared link)
export const PHONE_PLUG = { x: 142.5, y: PHB.y + PHB.d, w: 9, d: 5, r: 1.5 };
function phone() {
  const out = [halo(PHB, 0, 8)];
  out.push(slab(PHB, 0, 8, 'mid', { steps: 3, bevel: 0.6 }));
  out.push(slab(PH, 8, PH_H, 'hi', { steps: 3, bevel: 0.5 }));
  const w = PH.w, h = PH_H;
  const s = SCREEN.phone;
  const f = [];
  f.push(clip('p0', s));
  f.push(pa('bz', rr(1.5, 2, w - 1.5, h - 2, 3.4)), line('lo', rr(1.5, 2, w - 1.5, h - 2, 3.4)), pa('lcd', rr(s.x, s.y, s.x + s.w, s.y + s.h, s.r)));
  f.push(slot('p0', 'phone'));
  f.push(pa('dk', rr(w / 2 - 4, 2.9, w / 2 + 4, 4.3, 0.7)), pa('gd2', rr(w / 2 - 5, h - 4.4, w / 2 + 5, h - 3.4, 0.5)));
  f.push(`<path class="glass" d="M4 6H17L3 24V8Z"/>`);
  out.push(deco(yFace(PH, PH_TOP), f.join('')));
  out.push(slab(PHONE_PLUG, 2, 5, 'lo', { steps: 2 }));
  return out.join('');
}

// ---------------------------------------------------------------- cables
const pieces = (route, r) => T.tubePieces(route, r, P, { maxLength: 400 });
function cable(route, r, tone = 'mid', cls = '') {
  return pieces(route, r)
    .sort((a, b) => G.dot3(a.mid, V) - G.dot3(b.mid, V))
    .map((p) => (cls ? `<g class="${cls}">${T.tubeSvg(p, { tone })}</g>` : T.tubeSvg(p, { tone })))
    .join('');
}
const route = (pts, bend = 7, r = 2) => G.fillet(pts, bend, 8, { P, tube: r });
/** The cables' centrelines, filleted: the pulses ride them, and the cables are drawn from them. */
export const ROUTES = {
  crt: route([[-24, -56, 19], [-16, -56, 19], [-16, -56, 2], [-10, -66, 2], [-10, -66, 10], [-6, -66, 10]]),
  ctl: route([[30, -16, 10], [30, -6, 10], [30, -6, 2.2], [30, 9, 2.2], [30, 9, 5], [30, 16, 5]]),
  lite: route([[16, -16, 10], [16, -6, 10], [16, -6, 2], [-46, -6, 2], [-46, 21, 2], [-46, 21, 11], [-54, 21, 11]]),
  tun: route([[117, -55.5, 12], [128, -55.5, 12], [128, -55.5, 2], [128, -80, 2], [147, -80, 2], [147, -88, 4.5], [147, -95, 4.5]]),
};
/** The delivery groove on the mat (world points on the floor): from under the console's front to the tray's back edge. */
export const SHIP = [[100, -24], [100, 20]];
ROUTES.ship = [[100, -24, 0.6], [100, 20, 0.6]];

// ---------------------------------------------------------------- assembly
/** Back to front. The moving parts (data-part) keep their place in this order wherever they are lifted to. */
export function sceneBody() {
  return [
    mat(), phone(), crt(), cable(ROUTES.crt, 2), consoleUnit(), pocket(), cable(ROUTES.lite, 2, 'mid', 'blk'),
    tray(), cable(ROUTES.ctl, 2, 'mid', 'blk'), controller(), cable(ROUTES.tun, 2, 'mid', 'tun'),
  ];
}

// ---------------------------------------------------------------- the light layer's planes (world space)
/** A screen's window as the shader sees it: centre, in-plane axes, normal and half size + corner radius. */
const plane = (centre, half, r) => ({ o: centre, u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0], half: [half[0], half[1], r] });
export const GL_DATA = {
  crt: plane([CRT.x + SCREEN.crt.x + SCREEN.crt.w / 2, CRT.y + CRT.d, CRT_TOP - (SCREEN.crt.y + SCREEN.crt.h / 2)], [SCREEN.crt.w / 2, SCREEN.crt.h / 2], SCREEN.crt.r),
  phone: plane([PH.x + SCREEN.phone.x + SCREEN.phone.w / 2, PH.y + PH.d, PH_TOP - (SCREEN.phone.y + SCREEN.phone.h / 2)], [SCREEN.phone.w / 2, SCREEN.phone.h / 2], SCREEN.phone.r),
  lite: plane([PKT.x + SCREEN.lite.x + SCREEN.lite.w / 2, PKT.y + PKT.d, PKT_H - (SCREEN.lite.y + SCREEN.lite.h / 2)], [SCREEN.lite.w / 2, SCREEN.lite.h / 2], SCREEN.lite.r),
  ring: { c: [TRAY.x + TRAY.w / 2, TRAY.y + TRAY.d / 2], z: 4, half: [TRAY.w / 2 - 3, TRAY.d / 2 - 3, TRAY.r - 3] },
};

// ---------------------------------------------------------------- the true shapes, for the anatomy audit (scripts/anatomy/run-audit.mjs)
/** Every solid as plain data: { name, kind: 'slab' | 'cyl' | 'prism' | 'disc', ... }; "stand." parts rest on the floor. */
export const SOLIDS = (() => {
  const slabs = [
    ['stand.mat', MAT, -MAT_H, MAT_H],
    ['stand.phone', PHB, 0, 8], ['phone.body', PH, 8, PH_H], ['phone.plug', PHONE_PLUG, 2, 5],
    ['stand.crt.base', { x: -122, y: -98, w: 86, d: 56, r: 4 }, 0, 7], ['crt.hump', HUMP, 14, 84], ['crt.body', CRT, 7, CRT_TOP - 7], ['crt.port', { x: -30, y: -62, w: 6, d: 12, r: 1.5 }, 14, 10],
    ['stand.console', CON, 0, CON_H], ['console.tray', k.insetPlan(CON, 10), CON_H, 4],
    ['card', CARD, SEAT, CARD_H], ['cart.seat', { ...CART, x: CART.x - 2, y: CART.y - 2, w: CART.w + 4, d: CART.d + 4, r: 3 }, SEAT, 1.2], ['cart', CART, SEAT + 1.2, CART_H - 1.2],
    ['console.plugA', { x: CON.x + 10, y: CON.y + CON.d, w: 8, d: 6, r: 1.5 }, 7, 6], ['console.plugB', { x: CON.x + 24, y: CON.y + CON.d, w: 8, d: 6, r: 1.5 }, 7, 6],
    ['console.plugR', { x: CON.x + CON.w, y: -60, w: 7, d: 9, r: 1.5 }, 8, 8], ['console.plugL', { x: CON.x - 8, y: -72, w: 8, d: 12, r: 1.5 }, 6, 8],
    ['stand.controller', CTL, 0, CTL_H], ['controller.plug', CTL_PLUG, 2, 6],
    ['stand.lite', PKT, 0, PKT_H], ['lite.plug', LITE_PLUG, 8, 6],
    ['stand.tray', TRAY, 0, 4], ['fin', FIN, 4, 9],
  ].map(([name, plan, z, h]) => ({ name, kind: 'slab', plan, z, h }));
  const pad = G.frameOf([PAD.cx, PAD.cy, CTL_H], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  const knob = G.frameAlong([CON.x + KNOB.u, CON.y + CON.d + 0.1, KNOB.z], [0, 1, 0]);
  return [
    ...slabs,
    { name: 'controller.padH', kind: 'prism', F: pad, poly: [[-10, -3.6], [10, -3.6], [10, 3.6], [-10, 3.6]], s: [0, 2.2] },
    { name: 'controller.padU', kind: 'prism', F: pad, poly: [[-3.6, -10], [3.6, -10], [3.6, -3.6], [-3.6, -3.6]], s: [0, 2.2] },
    { name: 'controller.padD', kind: 'prism', F: pad, poly: [[-3.6, 3.6], [3.6, 3.6], [3.6, 10], [-3.6, 10]], s: [0, 2.2] },
    { name: 'controller.btnA', kind: 'cyl', c: BTN_A, r: 4.4, z: CTL_H, h: 2.2 },
    { name: 'controller.btnB', kind: 'cyl', c: BTN_B, r: 4.4, z: CTL_H, h: 2.2 },
    { name: 'console.knob', kind: 'disc', F: knob, s: [0, 3.2], r: 5.2 },
    { name: 'console.knobCap', kind: 'disc', F: knob, s: [3.2, 3.8], r: 3.4 },
  ];
})();
