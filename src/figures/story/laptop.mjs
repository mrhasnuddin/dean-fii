// Idea figure (docs/device-design.md §56), built with the vendored anatomy kit: a laptop on a small desk, dark, with its keyboard, a
// tilted lid on two hinges, a mug, and a charger on its cable. It wakes: the screen lights, a soft glow spreads round it
// and a light bulb lights on the screen. There is no text in it (the bulb is a drawn glyph). Everything static is built once as SVG strings; the page
// (idea.ts) moves opacities and a few transforms. Plain ESM, so the page and the Node checks share it.
import * as k from '../../vendor/anatomy/iso-kit.mjs';
import * as G from '../../vendor/anatomy/lathe.mjs';
import * as T from '../../vendor/anatomy/tube.mjs';
import { bench, dot, drawKit, fitEqual, line, matPoints, pa, rr } from '../kit/draw.mjs';
import { bulbSvg } from './glyph.mjs';

export const W = 520;

// ---------------------------------------------------------------- layout (world units, about 1 px; x, y on the floor, z up)
const BENCH = { x: -112, y: -88, w: 226, d: 176, r: 9 };
const BASE = { x: -84, y: -40, w: 144, d: 96, r: 6 };
const BASE_H = 6.5;
const DECK_Z = BASE_H + 0.8;
const LID = { w: 144, h: 92, t: 4.6, tilt: (14 * Math.PI) / 180, r: 5 };
const XC = BASE.x + BASE.w / 2; // the laptop's centre line
const HINGE = [XC, BASE.y + 3, BASE_H + 2];
const MUG = { x: 90, y: 44 };
const BRICK = { x: 86, y: -82, w: 28, d: 18, r: 4 };
const BRICK_H = 12;
const PORT_Y = -8; // where the charger's cable plugs into the laptop's right side

const HALO_R = 190; // how far the glow reaches, in pixels
const SIN = Math.sin(LID.tilt), COS = Math.cos(LID.tilt);
const LID_UP = [0, -SIN, COS]; // along the lid, upward
const LID_OUT = [0, COS, SIN]; // out of the screen, toward the viewer
const LID_TOP = HINGE[2] + LID.h * COS;
const LIGHT_Y = HINGE[1] - LID.h * SIN; // the lid's top edge, in y

// The box fits what is drawn (the mat and the lid's top edge; the glow is soft and may run to the edge), the same gap on every side.
const FIT = fitEqual([...matPoints(BENCH), [XC - LID.w / 2, LIGHT_Y, LID_TOP], [XC + LID.w / 2, LIGHT_Y, LID_TOP]], W, { pad: 28, azimuth: 45 });
export const P = FIT.P;
export const H = FIT.H;
const V = G.viewOf(P);
export const iso3 = (p) => k.iso(p, P);
const D = drawKit(P);

// ---------------------------------------------------------------- the laptop's base: deck, keys, trackpad, standby lamp, ports
function base() {
  const out = [D.halo(BASE, 0, BASE_H)];
  out.push(D.slab(BASE, 0, BASE_H, 'hi', { bevel: 0.9, steps: 5, inner: D.Ln(k.sideSeam(BASE, 3, P, 5), { tone: 'faint' }) }));
  out.push(D.slab(k.insetPlan(BASE, 4), BASE_H, 0.8, 'lo', { steps: 4 }));
  out.push(D.slab({ x: XC - 25, y: 24, w: 50, d: 26, r: 3 }, DECK_Z, 0.6, 'mid', { steps: 3 })); // the trackpad
  out.push(k.dotsSvg(k.pointsAt(k.corners(BASE, 3).map(([x, y]) => [x, y, BASE_H]), P), { size: 0.5 }));
  // the keys: four rows of twelve and a bottom row (three, the space bar, three), each a small solid, painted back to front
  const keys = [];
  const kw = 9, kd = 8.2, pitch = 10.6;
  const x0 = XC - (12 * pitch - (pitch - kw)) / 2;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 12; c++) keys.push({ x: x0 + c * pitch, y: -31 + r * 9.8, w: kw, d: kd });
  const yb = -31 + 4 * 9.8;
  for (let c = 0; c < 3; c++) keys.push({ x: x0 + c * pitch, y: yb, w: kw, d: kd });
  keys.push({ x: x0 + 3 * pitch, y: yb, w: 5 * pitch - (pitch - kw), d: kd });
  for (let c = 0; c < 3; c++) keys.push({ x: x0 + (8 + c) * pitch, y: yb, w: kw, d: kd });
  keys.sort((a, b) => G.dot3([a.x + a.w / 2, a.y + a.d / 2, 0], V) - G.dot3([b.x + b.w / 2, b.y + b.d / 2, 0], V));
  for (const key of keys) out.push(D.slab({ ...key, r: 1.4 }, DECK_Z, 1.4, 'mid', { steps: 2 }));
  // the front: a thumb notch and the standby lamp; the right side: the charging port and two more, and a vent
  out.push(D.deco(D.yFace(BASE, BASE_H), pa('dk', rr(60, 2, 84, 3.8, 0.8)) + dot('gd', 134, 3.4, 1.2, ' data-lamp="stby"') + dot('gd3', 134, 3.4, 2.8, ' data-glow="stby"')));
  const s = [];
  s.push(pa('dk', rr(8, 1.8, 20, 4.8, 1)), pa('dk', rr(26, 1.8, 38, 4.8, 1)), pa('dk', rr(BASE.y + BASE.d - PORT_Y - 4, 1.8, BASE.y + BASE.d - PORT_Y + 4, 4.8, 1)), line('lo', 'M76 3H92M76 5H92', true));
  out.push(D.deco(D.xFace(BASE, BASE_H), s.join('')));
  return out.join('');
}

// ---------------------------------------------------------------- the lid: two hinges, the lid, the screen
export const SCREEN_LOCAL = { x: 7, y: 7, w: LID.w - 14, h: LID.h - 17, r: 3 };
const LID_FRAME = { o: HINGE, a: LID_OUT, u: [1, 0, 0], v: LID_UP };
/** The screen once it is awake: a wash of gold with a soft glow in its middle, and on it the light bulb (it lights a moment later, and
    a ring ripples out from it). All in the face's own units, centred on the glass. No text. */
function screenUi(s) {
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2 + 3;
  const wash = `<g data-part="screen">${pa('lit-bg', rr(s.x, s.y, s.x + s.w, s.y + s.h, s.r))}<circle cx="${cx}" cy="${cy}" r="48" fill="url(#dia-glow-{{u}})"/></g>`;
  const art = `<g transform="translate(${cx} ${cy})"><circle class="gl-ripple" data-part="ripple" r="24"/><g data-part="idea" style="opacity:0">${bulbSvg()}</g></g>`;
  return wash + art;
}
function lid() {
  const out = [];
  for (const dx of [-LID.w / 2 + 14, LID.w / 2 - 14]) {
    const F = G.frameAlong([XC + dx - 8, HINGE[1] + 0.4, HINGE[2] - 0.2], [1, 0, 0]);
    out.push(D.S(G.disc(0, 16, 3.4, F, P), { tone: 'mid' }));
  }
  const ring = k.ringOf({ x: -LID.w / 2, y: 0, w: LID.w, d: LID.h, r: LID.r }, 4);
  out.push(D.S(G.prismOf(LID_FRAME, ring, -LID.t, 0, P), { tone: 'hi' }));
  // the screen side: the bezel, the glass (the page lights it), the camera, a glint
  const topLeft = G.add3(G.add3(G.add3(HINGE, G.mul3(LID_UP, LID.h)), G.mul3(LID_OUT, 0.06)), [-LID.w / 2, 0, 0]);
  const s = SCREEN_LOCAL;
  const f = [];
  f.push(pa('bz', rr(2.4, 2.4, LID.w - 2.4, LID.h - 2.4, 4)), line('lo', rr(2.4, 2.4, LID.w - 2.4, LID.h - 2.4, 4)), line('mid', rr(4, 4, LID.w - 4, LID.h - 4, 3)));
  f.push(pa('lcd', rr(s.x, s.y, s.x + s.w, s.y + s.h, s.r)));
  f.push(screenUi(s));
  f.push(dot('pnl', LID.w / 2, 4.6, 1.2), pa('glass', `M${s.x + 4} ${s.y + 2}H${s.x + 44}L${s.x + 2} ${s.y + 40}V${s.y + 4}Z`), pa('dk', rr(LID.w / 2 - 14, LID.h - 7.4, LID.w / 2 + 14, LID.h - 6, 0.7)));
  out.push(D.deco(D.M(topLeft, [1, 0, 0], G.mul3(LID_UP, -1)), f.join('')));
  return out.join('');
}

// ---------------------------------------------------------------- the desk's other things
function mug() {
  const out = [D.halo({ x: MUG.x - 18, y: MUG.y - 18, w: 36, d: 36, r: 18 }, 0, 2)];
  out.push(D.S(k.cylinder(MUG.x, MUG.y, 17, 0, 1.6, P, 36, 0.3), { tone: 'lo' }));
  out.push(D.slab({ x: MUG.x + 10, y: MUG.y - 3, w: 8, d: 6, r: 2.4 }, 7, 14, 'mid', { steps: 3 })); // the handle
  out.push(D.S(k.cylinder(MUG.x, MUG.y, 12, 1.6, 24, P, 36, 0.5), { tone: 'hi', inner: D.Ln(k.sideArc(MUG.x, MUG.y, 12, 17, P, 24), { tone: 'faint' }) }));
  out.push(D.S(k.cylinder(MUG.x, MUG.y, 12.6, 25.6, 2.6, P, 36, 0.3), { tone: 'mid' })); // the lid
  out.push(D.S(k.cylinder(MUG.x + 3.4, MUG.y - 3, 1.5, 28, 17, P, 12), { tone: 'mid' })); // the straw
  return out.join('');
}
const CABLE_R = 1.7;
const BX = BRICK.x + BRICK.w / 2;
/** The charger's cable centreline, from the laptop's right side to the brick's front. */
export const ROUTE = G.fillet(
  [[BASE.x + BASE.w, PORT_Y, 3.3], [BASE.x + BASE.w + 12, PORT_Y, 3.3], [BASE.x + BASE.w + 12, PORT_Y, CABLE_R], [BX, PORT_Y, CABLE_R], [BX, -50, CABLE_R], [BX, -50, 6], [BX, BRICK.y + BRICK.d + 0.1, 6]],
  6, 8, { P, tube: CABLE_R },
);
function charger() {
  const out = [D.halo(BRICK, 0, BRICK_H)];
  out.push(D.slab(BRICK, 0, BRICK_H, 'hi', { bevel: 0.7, steps: 4, inner: D.Ln(k.sideSeam(BRICK, 6, P, 4), { tone: 'faint' }) }));
  out.push(D.deco(D.yFace(BRICK, BRICK_H), pa('dk', rr(BRICK.w / 2 - 3.4, 3.4, BRICK.w / 2 + 3.4, 8.6, 1.4)) + dot('gd', 5, 4.6, 1, ' data-lamp="chg"')));
  out.push(D.deco(D.tFace(BRICK, BRICK_H), line('faint', 'M6 3V16M10 3V16M14 3V16M18 3V16M22 3V16') + line('faint', rr(4, 3, 26, 16, 2))));
  return out.join('');
}
function cable() {
  return T.tubePieces(ROUTE, CABLE_R, P, { maxLength: 400 })
    .sort((a, b) => G.dot3(a.mid, V) - G.dot3(b.mid, V))
    .map((p) => T.tubeSvg(p, { tone: 'mid' }))
    .join('');
}

// ---------------------------------------------------------------- the light: the glow round the screen and the pool on the desk
function defs() {
  const c = iso3([XC, 30, 0]);
  // the halo is centred on the glass and falls off smoothly (no edge to see); the pool is the same on the desk
  const g = iso3(G.add3(G.add3(HINGE, G.mul3(LID_UP, LID.h * 0.6)), G.mul3(LID_OUT, 4)));
  const falloff = [[0, 0.3], [0.2, 0.22], [0.4, 0.12], [0.6, 0.055], [0.8, 0.016], [1, 0]].map(([o, a]) => `<stop offset="${o}" stop-color="#e4cf9f" stop-opacity="${a}"/>`).join('');
  return `<defs>
    <radialGradient id="dia-glow-{{u}}"><stop offset="0" stop-color="#e4cf9f" stop-opacity="0.42"/><stop offset="1" stop-color="#e4cf9f" stop-opacity="0"/></radialGradient>
    <radialGradient id="dia-halo-{{u}}" gradientUnits="userSpaceOnUse" cx="${g[0].toFixed(1)}" cy="${g[1].toFixed(1)}" r="${HALO_R}" gradientTransform="translate(${g[0].toFixed(1)} ${g[1].toFixed(1)}) scale(1 0.78) translate(${(-g[0]).toFixed(1)} ${(-g[1]).toFixed(1)})">${falloff}</radialGradient>
    <radialGradient id="dia-pool-{{u}}" gradientUnits="userSpaceOnUse" cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="105"><stop offset="0" stop-color="#e4cf9f" stop-opacity="0.26"/><stop offset="1" stop-color="#e4cf9f" stop-opacity="0"/></radialGradient></defs>`;
}
/** The glow round the screen: a square of radial gradient behind the lid, so only the light that spills past the lid shows. */
function halo() {
  const g = iso3(G.add3(G.add3(HINGE, G.mul3(LID_UP, LID.h * 0.6)), G.mul3(LID_OUT, 4)));
  const r = HALO_R;
  return `<g data-part="halo"><rect x="${(g[0] - r).toFixed(1)}" y="${(g[1] - r).toFixed(1)}" width="${2 * r}" height="${2 * r}" fill="url(#dia-halo-{{u}})"/></g>`;
}
const pool = () => `<g data-part="pool"><path d="${k.onTop(k.circleRing(XC, 30, 58, 48), 0.2, P, true)}" fill="url(#dia-pool-{{u}})"/></g>`;

/** Back to front: the bench, the desk's glow, the charger, the laptop, the cable, the mug. The glow sits behind the lid so it never washes the screen. The screen's light and the bulb are the page's.
    The markup has `{{u}}` where an id must be unique; the page replaces it. */
export function staticBody() {
  return [defs(), bench(P, BENCH), pool(), charger(), base(), halo(), lid(), cable(), mug()];
}
