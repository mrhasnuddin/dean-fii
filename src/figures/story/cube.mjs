// Problem figure (docs/device-design.md §56), built with the vendored anatomy kit: a Rubik's cube floating over a levitation pad on a
// small bench, with a loose piece beside it. The cube is the problem: it tumbles, its layers twist at random,
// it comes to rest scrambled, and a question mark is painted on each face you see. There is no text in it (the "?" is a drawn glyph). Everything static is
// built once as SVG strings; the page (problem.ts) redraws the 27 cubies while the cube turns. Plain ESM, so the page and the Node
// checks share it.
import * as k from '../../vendor/anatomy/iso-kit.mjs';
import * as G from '../../vendor/anatomy/lathe.mjs';
import { bench, dot, drawKit, fitEqual, matPoints, pa, rr } from '../kit/draw.mjs';

export const W = 520;

// ---------------------------------------------------------------- layout (world units, about 1 px; x, y on the floor, z up)
const BENCH = { x: -104, y: -92, w: 208, d: 184, r: 9 };
const PAD_R = 54;
export const EDGE = 27; // a cubie's edge
const HALF = EDGE / 2;
export const MIDZ = 104; // the cube's centre, floating above the pad (z = 10)
const SPARE = [-62, 56, HALF]; // the loose piece's centre

// The box fits what is drawn (the mat and the cube at rest, its back corner at the top), the same gap on every side. The cube's
// tumble reaches a little higher still, into the top gap.
const FIT = fitEqual([...matPoints(BENCH), ...[[-1, -1], [1, 1], [1, -1], [-1, 1]].map(([i, j]) => [i * 1.5 * EDGE, j * 1.5 * EDGE, MIDZ + 1.5 * EDGE])], W, { pad: 30, azimuth: 45 });
export const P = FIT.P;
export const H = FIT.H;
const V = G.viewOf(P);
const L = G.lightOf(P);
export const iso3 = (p) => k.iso(p, P);
/** Screen pixels (in the figure's own units) a part moves up for each world unit it is lifted. */
export const KZ = iso3([0, 0, 0])[1] - iso3([0, 0, 1])[1];
const D = drawKit(P);

/** Where the shadow and the pad's glow are centred on the screen (the pad's top, 10 up). */
export const PAD_AT = iso3([0, 0, 10]);

// ---------------------------------------------------------------- the cube model
const I3 = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const mulMV = (M, v) => [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2], M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2], M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]];
const mulMM = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const col = (M, j) => [M[0][j], M[1][j], M[2][j]];
export const rotAxis = (axis, a) => {
  const c = Math.cos(a), s = Math.sin(a);
  if (axis === 0) return [[1, 0, 0], [0, c, -s], [0, s, c]];
  if (axis === 1) return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
};

/** Sticker colours by face: top white, bottom gold, right red, left orange, front green, back blue. */
const FACE_COLOR = { '2+': 0, '2-': 1, '0+': 2, '0-': 3, '1+': 4, '1-': 5 };
/** The two in-face axes of a face whose normal is axis a. */
const TANGENTS = [[1, 2], [2, 0], [0, 1]];

/** 27 cubies on a 3 × 3 × 3 grid; a cubie carries a sticker on each face that starts on the outside. */
export function makeCube() {
  const cubies = [];
  for (let x = -1; x <= 1; x++)
    for (let y = -1; y <= 1; y++)
      for (let z = -1; z <= 1; z++) {
        const pos = [x, y, z];
        const st = [];
        pos.forEach((v, axis) => {
          if (!v) return;
          const n = [0, 0, 0];
          n[axis] = v;
          st.push({ n, c: FACE_COLOR[`${axis}${v > 0 ? '+' : '-'}`], t: TANGENTS[axis] });
        });
        cubies.push({ id: cubies.length, pos, R: I3(), st });
      }
  return cubies;
}
/** A quarter turn of one layer: { axis 0 x | 1 y | 2 z, layer -1 | 0 | 1, dir ±1 }. */
export function applyMove(cubies, { axis, layer, dir }) {
  const Rq = rotAxis(axis, (dir * Math.PI) / 2);
  for (const c of cubies) {
    if (c.pos[axis] !== layer) continue;
    c.pos = mulMV(Rq, c.pos).map(Math.round);
    c.R = mulMM(Rq, c.R).map((r) => r.map((v) => Math.round(v * 1e6) / 1e6));
  }
}

// ---------------------------------------------------------------- one cubie, drawn
const C = 2.8; // the chamfer on a cubie's vertical edges
const POLY = [[-HALF + C, -HALF], [HALF - C, -HALF], [HALF, -HALF + C], [HALF, HALF - C], [HALF - C, HALF], [-HALF + C, HALF], [-HALF, HALF - C], [-HALF, -HALF + C]];
const STICK = HALF - 2.8;
/** The sticker's path in its own units (centred), and how dark each light band makes it. */
export const STICKER_D = rr(-STICK, -STICK, STICK, STICK, 2.6);
const SHADE = [0.34, 0.24, 0.13, 0.05, 0];

/** One cubie: its solid paths, its depth key and the matrix and shade of each sticker that faces the viewer. `at` is its centre. */
export function cubieShape(c, Rg, Rl, at) {
  let v = [c.pos[0] * EDGE, c.pos[1] * EDGE, c.pos[2] * EDGE];
  let M = c.R;
  if (Rl) {
    v = mulMV(Rl, v);
    M = mulMM(Rl, M);
  }
  v = mulMV(Rg, v);
  M = mulMM(Rg, M);
  const o = [v[0] + at[0], v[1] + at[1], v[2] + at[2]];
  const paths = G.prismOf({ o, a: col(M, 2), u: col(M, 0), v: col(M, 1) }, POLY, -HALF, HALF, P);
  const stickers = c.st.map((s) => {
    const n = mulMV(M, s.n);
    if (G.dot3(n, V) < 0.02) return null;
    const centre = G.add3(o, G.mul3(n, HALF + 0.12));
    const a = iso3(centre);
    const t1 = iso3(G.add3(centre, col(M, s.t[0])));
    const t2 = iso3(G.add3(centre, col(M, s.t[1])));
    const f = (x) => Math.round(x * 1000) / 1000;
    return { c: s.c, matrix: `matrix(${f(t1[0] - a[0])} ${f(t1[1] - a[1])} ${f(t2[0] - a[0])} ${f(t2[1] - a[1])} ${f(a[0])} ${f(a[1])})`, shade: SHADE[G.bandOf(G.dot3(n, L))] };
  });
  return { id: c.id, key: G.dot3(o, V), paths, stickers };
}
/** All the cubies of a cube posed by the whole-cube rotation Rg and, mid-twist, one layer's turn. */
export function cubeShapes(cubies, Rg, move, theta, z0 = MIDZ) {
  const Rl = move ? rotAxis(move.axis, theta) : null;
  return cubies.map((c) => cubieShape(c, Rg, move && c.pos[move.axis] === move.layer ? Rl : null, [0, 0, z0]));
}

// ---------------------------------------------------------------- the random spin (seeded, so a still frame and a check can reproduce it)
export function prng(seed) {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Beats of one loop, in seconds. */
export const BEAT = { rest: 0.5, tumble: 4.6, pop: 5.5, hold: 8.6, loop: 9.3 };
/** The plan for loop number n: the layer twists (when and what) and the tumble (yaw turns, two tilts), all from the seed. */
export function planOf(n) {
  const r = prng(n + 7);
  const moves = [];
  let last = -1;
  for (let i = 0; i < 5; i++) {
    let axis = Math.floor(r() * 3);
    if (axis === last) axis = (axis + 1) % 3;
    last = axis;
    moves.push({ axis, layer: r() < 0.5 ? -1 : 1, dir: r() < 0.5 ? -1 : 1, t0: 0.9 + i * 0.74, dur: 0.46 });
  }
  return { moves, turns: 1 + (n % 2), tiltA: 0.42 + r() * 0.12, tiltB: 0.36 + r() * 0.12, fa: 1.6 + r() * 0.8, fb: 1.1 + r() * 0.8, pa: r() * 6.28, pb: r() * 6.28 };
}
const smooth = (t) => t * t * (3 - 2 * t);
/** The whole cube's rotation at time t of loop plan `p`: yaw turns that end where they began, and tilts that die out at both ends. */
export function spinOf(p, t) {
  const u = Math.min(1, Math.max(0, (t - BEAT.rest) / (BEAT.tumble - BEAT.rest)));
  const yaw = 0.14 + p.turns * 2 * Math.PI * smooth(u);
  const env = Math.sin(Math.PI * u);
  const a = p.tiltA * env * Math.sin(p.fa * Math.PI * 2 * u + p.pa);
  const b = p.tiltB * env * Math.sin(p.fb * Math.PI * 2 * u + p.pb);
  return mulMM(rotAxis(2, yaw), mulMM(rotAxis(0, a), rotAxis(1, b)));
}
/** The twist on show at time t: the move and how far through it is (0 to 1, eased), or null between twists. */
export function twistOf(p, t) {
  for (const m of p.moves) if (t >= m.t0 && t < m.t0 + m.dur) return { move: m, u: smooth((t - m.t0) / m.dur) };
  return null;
}
/** The first frame and the still frame: the cube scrambled by twelve fixed moves, at rest. */
export function poster() {
  const cubies = makeCube();
  const r = prng(3);
  let last = -1;
  for (let i = 0; i < 14; i++) {
    let axis = Math.floor(r() * 3);
    if (axis === last) axis = (axis + 1) % 3;
    last = axis;
    applyMove(cubies, { axis, layer: Math.floor(r() * 3) - 1, dir: r() < 0.5 ? -1 : 1 });
  }
  return cubies;
}
export const REST = () => rotAxis(2, 0.14);

// ---------------------------------------------------------------- the static scene
function sticker(s) {
  return `<g transform="${s.matrix}"><path class="stk stk${s.c}" d="${STICKER_D}"/><path class="stk-sh" style="fill-opacity:${s.shade}" d="${STICKER_D}"/></g>`;
}
function spare() {
  const c = { id: 'spare', pos: [0, 0, 0], R: rotAxis(2, 0.5), st: [{ n: [1, 0, 0], c: 2, t: TANGENTS[0] }, { n: [0, 1, 0], c: 4, t: TANGENTS[1] }, { n: [0, 0, 1], c: 0, t: TANGENTS[2] }] };
  const s = cubieShape(c, I3(), null, SPARE);
  return `${D.halo({ x: SPARE[0] - 13, y: SPARE[1] - 13, w: 26, d: 26, r: 6 }, 0, 4)}<g class="cubie">${D.S(s.paths, { tone: 'lo' })}${s.stickers.filter(Boolean).map(sticker).join('')}</g>`;
}

function pedestal() {
  const out = [D.halo({ x: -PAD_R - 2, y: -PAD_R - 2, w: PAD_R * 2 + 4, d: PAD_R * 2 + 4, r: PAD_R + 2 }, 0, 8)];
  out.push(D.S(k.cylinder(0, 0, PAD_R, 0, 8, P, 56, 0.8), { tone: 'hi', inner: D.Ln(k.sideArc(0, 0, PAD_R, 4, P, 28), { tone: 'faint' }) }));
  // a ruler strip round the rim: ticks hang from the ring at 47
  out.push(D.Ln(k.ring(0, 0, 47, 8, P, 56), { tone: 'lo' }));
  const ticks = k.radialTicks(0, 0, 47, 48, 4, 8, [1.8, 3.2], P);
  out.push(D.Ln(ticks.minor, { tone: 'lo' }), D.Ln(ticks.major, { tone: 'mid' }));
  // the four emitters round the pad, each with a lamp on top
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const ex = Math.cos(a) * 38, ey = Math.sin(a) * 38;
    out.push(D.S(k.cylinder(ex, ey, 3.4, 8, 6, P, 18, 0.4), { tone: 'mid' }));
    const [lx, ly] = iso3([ex, ey, 14.4]);
    out.push(`<g data-part="emit${i}">${dot('gd', Math.round(lx * 10) / 10, Math.round(ly * 10) / 10, 1.5)}</g>`);
  }
  // the pad: a disc that glows under the cube
  out.push(D.S(k.cylinder(0, 0, 32, 8, 2, P, 48, 0.4), { tone: 'mid', lit: true }));
  out.push(`<g data-part="pad">${pa('gd3', k.onTop(k.circleRing(0, 0, 30, 48), 10.1, P, true))}${D.Ln(k.ring(0, 0, 24, 10.1, P, 48), { tone: 'lit' })}</g>`);
  return out.join('');
}

/** The levitation beam: a faint column of light from the pad up to the cube (the page pulses it). */
function beam() {
  const ring = (r, z) => k.circleRing(0, 0, r, 40).map(([x, y]) => iso3([x, y, z]));
  const zTop = MIDZ - 3 * HALF + 2;
  const hull = G.hullOf([...ring(26, 10.4), ...ring(21, zTop)]);
  const y0 = iso3([0, 0, zTop])[1], y1 = iso3([0, 0, 10.4])[1];
  return `<defs><linearGradient id="dia-beam-{{u}}" gradientUnits="userSpaceOnUse" x1="0" y1="${y0.toFixed(1)}" x2="0" y2="${y1.toFixed(1)}"><stop offset="0" stop-color="#e4cf9f" stop-opacity="0"/><stop offset="1" stop-color="#e4cf9f" stop-opacity="0.3"/></linearGradient></defs><g data-part="beam"><path d="${k.pathOf(hull, true)}" fill="url(#dia-beam-{{u}})"/></g>`;
}

/** Back to front: the bench, the loose piece, the pedestal, the beam. The shadow and the cube are the page's.
    The markup has `{{u}}` where an id must be unique; the page replaces it. */
export function staticBody() {
  return [bench(P, BENCH), spare(), pedestal(), beam()];
}
/** The soft shadow of the cube on the pad (the page scales it as the cube floats). */
export const SHADOW_D = k.onTop(k.circleRing(0, 0, 26, 40), 10.2, P, true);

// ---------------------------------------------------------------- the question mark painted on the cube
/** Half the painted area of a face (a face is three cubies across). */
export const FACE_HALF = 1.5 * EDGE - 1.4;
export const FACE_D = rr(-FACE_HALF, -FACE_HALF, FACE_HALF, FACE_HALF, 4);
/** The three faces of the cube you see at rest (right, left, top), each with the matrix that lays a mark centred on it, reading
    upright for the viewer (right and down as drawn on screen), and how much light the face gets. The page fades the marks in when
    the spin ends and out when the next one starts. */
export const FACES = (() => {
  const Rg = REST();
  const reach = 1.5 * EDGE + 0.3;
  const faces = [
    { n: [1, 0, 0], right: [0, -1, 0], down: [0, 0, -1] },
    { n: [0, 1, 0], right: [1, 0, 0], down: [0, 0, -1] },
    { n: [0, 0, 1], right: [1, 0, 0], down: [0, 1, 0] },
  ];
  const f = (x) => Math.round(x * 1000) / 1000;
  return faces.map((s) => {
    const n = mulMV(Rg, s.n), right = mulMV(Rg, s.right), down = mulMV(Rg, s.down);
    const c = [n[0] * reach, n[1] * reach, n[2] * reach + MIDZ];
    const a = iso3(c), b = iso3(G.add3(c, right)), e = iso3(G.add3(c, down));
    return { matrix: `matrix(${f(b[0] - a[0])} ${f(b[1] - a[1])} ${f(e[0] - a[0])} ${f(e[1] - a[1])} ${f(a[0])} ${f(a[1])})`, light: 1 - SHADE[G.bandOf(G.dot3(n, L))] };
  });
})();
