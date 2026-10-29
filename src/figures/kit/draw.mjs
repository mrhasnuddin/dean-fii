// Drawing helpers shared by the story figures, Problem and Idea (docs/device-design.md §56): the same few
// moves the "How I work" instrument's scene makes (src/figures/run/scene.mjs), as one factory over a projection. Plain ESM, so the
// page and the Node checks share it. There is no text in any figure; everything here draws shapes.
import * as k from '../../vendor/anatomy/iso-kit.mjs';
import * as G from '../../vendor/anatomy/lathe.mjs';

export const rr = (x0, y0, x1, y1, r) => `M${x0 + r} ${y0}H${x1 - r}A${r} ${r} 0 0 1 ${x1} ${y0 + r}V${y1 - r}A${r} ${r} 0 0 1 ${x1 - r} ${y1}H${x0 + r}A${r} ${r} 0 0 1 ${x0} ${y1 - r}V${y0 + r}A${r} ${r} 0 0 1 ${x0 + r} ${y0}Z`;
export const box = (x0, y0, x1, y1) => `M${x0} ${y0}H${x1}V${y1}H${x0}Z`;
export const pa = (cls, d, extra = '') => `<path class="${cls}"${extra} d="${d}"/>`;
/** `free`: rule lines that stand for printed text, so their ends are meant to stop. */
export const line = (tone, d, free = false) => `<path class="iso-line" data-tone="${tone}"${free ? ' data-free' : ''} d="${d}"/>`;
export const dot = (cls, x, y, r, extra = '') => `<circle class="${cls}"${extra} cx="${x}" cy="${y}" r="${r}"/>`;
const f4 = (v) => +v.toFixed(4);

/** The extremes of a rounded mat (its outline at the foot and the top), for fitEqual. */
export const matPoints = (plan) => k.ringOf(plan, 8).flatMap(([x, y]) => [[x, y, -4], [x, y, 0]]);
/** Fits a camera to the width and sizes the box to the content: `pad` of empty space on all four sides, whatever the content's shape.
    `points` are the extremes of everything that is drawn (world units). Returns the projection and the box's height. */
export function fitEqual(points, width, { pad = 24, azimuth = k.AZIMUTH, elevation = k.ELEVATION } = {}) {
  const unit = { origin: [0, 0], scale: 1, azimuth, elevation };
  const flat = points.map((p) => k.iso(p, unit));
  const xs = flat.map(([x]) => x), ys = flat.map(([, y]) => y);
  const left = Math.min(...xs), right = Math.max(...xs), up = Math.min(...ys), down = Math.max(...ys);
  const scale = (width - pad * 2) / (right - left);
  return { P: { origin: [pad - left * scale, pad - up * scale], scale, azimuth, elevation }, H: Math.round((down - up) * scale + pad * 2) };
}

export function drawKit(P) {
  const iso = (p) => k.iso(p, P);
  const S = (paths, style) => k.solidSvg(paths, style);
  const Ln = (d, style) => k.lineSvg(d, style);
  const slab = (plan, z0, h, tone, o = {}) => S(k.slabOf(plan, z0, h, P, o.steps ?? 4, o.bevel ?? 0), { tone, inner: o.inner ?? '', lit: o.lit });
  const halo = (plan, z0, h) => `<path class="iso-halo" d="${k.haloOf(plan, z0, h, P)}"/>`;
  /** An affine map from a face's own units (u right, v down) onto the screen, to lay decals on a face. */
  const M = (o, ux, uy) => {
    const a = iso(o), b = iso(G.add3(o, ux)), c = iso(G.add3(o, uy));
    return `matrix(${f4(b[0] - a[0])} ${f4(b[1] - a[1])} ${f4(c[0] - a[0])} ${f4(c[1] - a[1])} ${f4(a[0])} ${f4(a[1])})`;
  };
  /** Decals on the three faces of a box: the front (+y), the right (+x) and the top. u runs right, v runs down the face. */
  const yFace = (pl, zTop) => M([pl.x, pl.y + pl.d + 0.05, zTop], [1, 0, 0], [0, 0, -1]);
  const xFace = (pl, zTop) => M([pl.x + pl.w + 0.05, pl.y + pl.d, zTop], [0, -1, 0], [0, 0, -1]);
  const tFace = (pl, z) => M([pl.x, pl.y, z + 0.05], [1, 0, 0], [0, 1, 0]);
  const deco = (m, inner, attrs = '') => `<g${attrs} transform="${m}">${inner}</g>`;
  return { iso, S, Ln, slab, halo, M, yFace, xFace, tFace, deco };
}

/** The bench every figure stands on: a rounded mat with a groove, a grid, tick rulers on two edges and four screws (the way the
    "How I work" instrument stands on its cutting mat). Returns the markup; `plan` is the mat in world units, `h` its thickness. */
export function bench(P, plan, h = 4, { grid = 20, tick = 4 } = {}) {
  const { S, Ln } = drawKit(P);
  const out = [`<path class="iso-halo" d="${k.haloOf(plan, -h, h, P)}"/>`];
  out.push(S(k.slabOf(plan, -h, h, P, 8, 1.2), { tone: 'lo' }));
  const inner = k.insetPlan(plan, 9);
  out.push(Ln(k.planOutline(inner, 0, P, 6), { tone: 'faint' }));
  const g = [];
  for (let x = inner.x + grid; x < inner.x + inner.w - 4; x += grid) g.push(k.lineOnTop([x, inner.y], [x, inner.y + inner.d], 0, P));
  for (let y = inner.y + grid; y < inner.y + inner.d - 4; y += grid) g.push(k.lineOnTop([inner.x, y], [inner.x + inner.w, y], 0, P));
  out.push(Ln(g.join(''), { tone: 'faint' }));
  const front = k.topTicks(inner.x + 4, inner.x + inner.w - 4, tick, 5, inner.y + inner.d, 0, [2, 3.6], P);
  out.push(Ln(front.minor, { tone: 'lo' }), Ln(front.major, { tone: 'mid' }));
  const side = k.topTicks(inner.y + 4, inner.y + inner.d - 4, tick, 5, inner.x + inner.w, 0, [2, 3.6], P, 'y');
  out.push(Ln(side.minor, { tone: 'lo' }), Ln(side.major, { tone: 'mid' }));
  const sc = k.corners(plan, 5).map(([x, y]) => [x, y, 0]);
  out.push(k.dotsSvg(k.pointsAt(sc, P), { size: 0.55 }));
  return out.join('');
}
