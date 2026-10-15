// The workflow figure's geometry (docs/device-design.md §32), built with the vendored anatomy kit: a cutting mat,
// a handheld standing in its dock (Dean's instructions, on its screen), a cable, and a Rubik's cube on a stand
// (the AI carrying them out). Everything static is built once as SVG strings; the cube and the screen are
// rebuilt by the page as they change. Plain ESM, so the page and the Node checks share it.
import * as k from "../../vendor/anatomy/iso-kit.mjs";
import * as G from "../../vendor/anatomy/lathe.mjs";
import { tubePieces, tubeSvg } from "../../vendor/anatomy/tube.mjs";
import { FACES, apply, rotation, inLayer } from "./model.mjs";

export const W = 600;
export const H = 430;
const A = 45; // camera azimuth; elevation is the kit's 30°
const R = (deg) => (deg * Math.PI) / 180;
const s = Math.sin(R(A)), c = Math.cos(R(A));
const RIGHT = [s, -c, 0]; // world direction that runs to the right on screen
const NEAR = [c, s, 0]; // world floor direction toward the viewer
/** A floor point from screen-right and toward-viewer distances. */
const at = (r, t, z = 0) => [r * RIGHT[0] + t * NEAR[0], r * RIGHT[1] + t * NEAR[1], z];

// ---------------------------------------------------------------- layout (world units, about 1 px)
const MAT = { x: -132, y: -96, w: 250, d: 208, r: 7 };
const MAT_H = 4;

// The handheld: faces the viewer turned 22° toward the cube, leaning back 12° in its dock.
const YAW = R(22), TILT = R(12);
const FACE_N = G.add3(G.mul3(NEAR, Math.cos(YAW)), G.mul3(RIGHT, Math.sin(YAW))); // horizontal face normal
const U = G.add3(G.mul3(RIGHT, Math.cos(YAW)), G.mul3(NEAR, -Math.sin(YAW))); // along the face, to the right
const N = [FACE_N[0] * Math.cos(TILT), FACE_N[1] * Math.cos(TILT), Math.sin(TILT)]; // the face normal
const WUP = [-FACE_N[0] * Math.sin(TILT), -FACE_N[1] * Math.sin(TILT), Math.cos(TILT)]; // up along the face
export const BODY = { w: 78, h: 124, t: 15 }; // the handheld body
const DOCK_C = at(-78, -30);
const DOCK_TOP = 9;
// The face centre, set so the body's back-bottom edge rests on the dock's floor.
const FACE_O = G.add3(G.add3(DOCK_C, G.mul3(FACE_N, 4)), [0, 0, DOCK_TOP + (BODY.h / 2) * Math.cos(TILT) + BODY.t * Math.sin(TILT)]);
const FH = G.frameOf(FACE_O, N, U, WUP); // s along the normal (0 = the face), x along U, y up the face
const onFace = (x, y, sN = 0) => G.add3(G.add3(G.add3(FACE_O, G.mul3(U, x)), G.mul3(WUP, y)), G.mul3(N, sN));

// The stand and the cube.
const STAND_C = at(70, 22);
const STAND = { base: 34, baseH: 7, post: 6, postH: 13, cup: 11, cupH: 3 };
export const PITCH = 23, CUBIE = 21.2;
const CUBE_Z = STAND.baseH + STAND.postH + STAND.cupH + PITCH * 1.5 - (PITCH - CUBIE) / 2; // the bottom cubie rests on the cup
export const CUBE_C = [STAND_C[0], STAND_C[1], CUBE_Z];

const P = k.fitProjection(
  [
    ...k.boxCorners(MAT, -MAT_H - 3, 0),
    onFace(-BODY.w / 2, BODY.h / 2 + 22, -BODY.t), onFace(BODY.w / 2, BODY.h / 2 + 22, 0),
    ...[-1, 1].flatMap((i) => [-1, 1].map((j) => [CUBE_C[0] + i * PITCH * 2.1, CUBE_C[1] + j * PITCH * 2.1, CUBE_Z + PITCH * 2.1])),
  ],
  W, H, { pad: 26, azimuth: A },
);
export { P };
const V = G.viewOf(P), L = G.lightOf(P);
const iso = (p) => k.iso(p, P);
const path = (points, closed = true) => k.pathOf(points.map(iso), closed);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const shadeOf = (normal) => G.bandOf(G.dot3(G.unit3(normal), L));
const seen = (normal) => G.dot3(normal, V) > 1e-6;

/** A rounded rectangle as points, counter-clockwise, with its own radius per corner [bl, br, tr, tl]. */
function rrect(x0, y0, x1, y1, radii, steps = 5) {
  const [bl, br, tr, tl] = typeof radii === "number" ? [radii, radii, radii, radii] : radii;
  const out = [];
  const corner = (cx, cy, r, a0) => {
    if (r <= 0) return out.push([cx, cy]);
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (i / steps) * (Math.PI / 2);
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  corner(x0 + bl, y0 + bl, bl, Math.PI);
  corner(x1 - br, y0 + br, br, -Math.PI / 2);
  corner(x1 - tr, y1 - tr, tr, 0);
  corner(x0 + tl, y1 - tl, tl, Math.PI / 2);
  return out;
}
const rot2 = (points, a, [cx, cy] = [0, 0]) => points.map(([x, y]) => [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)]);
const shift = (points, dx, dy) => points.map(([x, y]) => [x + dx, y + dy]);

/** A prism of any convex polygon in a frame, as kit paths. */
const prism = (F, polygon, s0, s1) => G.prismOf(F, polygon, s0, s1, P);
/** A frame on the handheld's face at (x, y), its axis along the face normal. */
const faceFrame = (x, y, a = 0) => G.frameOf(onFace(x, y), N, G.add3(G.mul3(U, Math.cos(a)), G.mul3(WUP, Math.sin(a))), G.add3(G.mul3(U, -Math.sin(a)), G.mul3(WUP, Math.cos(a))));

/** The SVG transform that draws flat (x right, y down) face coordinates onto the handheld's face, s along N. */
export function faceMatrix(sN = 0) {
  const o = iso(onFace(0, 0, sN));
  const ex = G.sub3(iso(onFace(1, 0, sN)), o), ey = G.sub3(iso(onFace(0, -1, sN)), o);
  const f = (v) => +v.toFixed(4);
  return `matrix(${f(ex[0])} ${f(ex[1])} ${f(ey[0])} ${f(ey[1])} ${f(o[0])} ${f(o[1])})`;
}
const flatPath = (points) => k.pathOf(points.map(([x, y]) => [x, -y]), true); // face coords → SVG (y down)

/**
 * A raised shape on the face (any simple polygon, concave too): its visible side walls, shaded by facing,
 * then its cap and outline. Used for the D-pad, which a hull would fill in.
 */
function raised(F, polygon, h, tone = "mid") {
  const pt = (x, y, sN) => G.add3(G.add3(G.add3(F.o, G.mul3(F.u, x)), G.mul3(F.v, y)), G.mul3(F.a, sN));
  const n = polygon.length;
  let area = 0;
  for (let i = 0; i < n; i++) area += polygon[i][0] * polygon[(i + 1) % n][1] - polygon[(i + 1) % n][0] * polygon[i][1];
  const ccw = area > 0;
  const walls = [[], [], [], [], []];
  const feet = [];
  const shown = polygon.map((_, i) => {
    const [x0, y0] = polygon[i], [x1, y1] = polygon[(i + 1) % n];
    const out = ccw ? [y1 - y0, -(x1 - x0)] : [-(y1 - y0), x1 - x0];
    return G.add3(G.mul3(F.u, out[0]), G.mul3(F.v, out[1]));
  });
  for (let i = 0; i < n; i++) {
    const [x0, y0] = polygon[i], [x1, y1] = polygon[(i + 1) % n];
    const vis = seen(shown[i]);
    // where the visible walls turn away, a vertical edge joins the foot to the cap: the outline closes
    if (vis !== seen(shown[(i - 1 + n) % n])) feet.push(k.pathOf([iso(pt(x0, y0, 0)), iso(pt(x0, y0, h))]));
    if (!vis) continue;
    walls[shadeOf(shown[i])].push(path([pt(x0, y0, 0), pt(x1, y1, 0), pt(x1, y1, h), pt(x0, y0, h)]));
    feet.push(k.pathOf([iso(pt(x0, y0, 0)), iso(pt(x1, y1, 0))]));
  }
  const cap = path(polygon.map(([x, y]) => pt(x, y, h)));
  return `<g class="iso-solid">${walls.slice(0, 4).map((d, i) => (d.length ? `<path class="iso-shade" data-shade="${i}" d="${d.join("")}"/>` : "")).join("")}<path class="iso-top" d="${cap}"/>${Ln(feet.join(""), { tone: "lo" })}${Ln(cap, { tone })}</g>`;
}

// ---------------------------------------------------------------- the mat
function mat() {
  const out = [`<path class="iso-halo" d="${k.haloOf(MAT, -MAT_H, MAT_H, P)}"/>`];
  out.push(S(k.slabOf(MAT, -MAT_H, MAT_H, P, 8, 1.2), { tone: "lo" }));
  const inner = k.insetPlan(MAT, 9);
  out.push(Ln(k.planOutline(inner, 0, P, 6), { tone: "faint" }));
  // a cutting-mat grid, every 20 units, edge to edge of the inset field
  const grid = [];
  for (let x = inner.x + 20; x < inner.x + inner.w - 4; x += 20) grid.push(k.lineOnTop([x, inner.y], [x, inner.y + inner.d], 0, P));
  for (let y = inner.y + 20; y < inner.y + inner.d - 4; y += 20) grid.push(k.lineOnTop([inner.x, y], [inner.x + inner.w, y], 0, P));
  out.push(Ln(grid.join(""), { tone: "faint" }));
  // ruler ticks along the two near edges, growing from the field's edge into the border
  const front = k.topTicks(inner.x + 4, inner.x + inner.w - 4, 4, 5, inner.y + inner.d, 0, [2, 3.6], P);
  out.push(Ln(front.minor, { tone: "lo" }), Ln(front.major, { tone: "mid" }));
  const side = k.topTicks(inner.y + 4, inner.y + inner.d - 4, 4, 5, inner.x + inner.w, 0, [2, 3.6], P, "y");
  out.push(Ln(side.minor, { tone: "lo" }), Ln(side.major, { tone: "mid" }));
  return out.join("");
}

// ---------------------------------------------------------------- the dock and the handheld
const DOCK_F = G.frameOf(DOCK_C, [0, 0, 1], U, FACE_N); // x along the face, y toward the viewer
const DOCK = { x0: -50, x1: 50, y0: -20, y1: 26 };
export const PORT_A = G.add3(G.add3(DOCK_C, G.add3(G.mul3(U, 36), G.mul3(FACE_N, DOCK.y1 + 0.2))), [0, 0, 4.6]); // cable socket on the dock front

function dockBack() {
  const out = [];
  const base = rrect(DOCK.x0, DOCK.y0, DOCK.x1, DOCK.y1, 6);
  const foot = base.map(([x, y]) => iso(G.add3(G.add3(DOCK_C, G.mul3(U, x)), G.mul3(FACE_N, y))));
  out.push(`<path class="iso-halo" d="${k.pathOf(G.hullOf(foot), true)}"/>`);
  out.push(S(prism(DOCK_F, base, 0, DOCK_TOP), { tone: "mid", inner: Ln(path(rrect(DOCK.x0 + 4, DOCK.y0 + 4, DOCK.x1 - 4, DOCK.y1 - 4, 3).map(([x, y]) => G.add3(G.add3(DOCK_C, G.mul3(U, x)), G.add3(G.mul3(FACE_N, y), [0, 0, DOCK_TOP])))), { tone: "faint" }) }));
  // the back rest the handheld leans on: a wedge across the dock's back
  const restF = G.frameOf(G.add3(DOCK_C, [0, 0, DOCK_TOP]), U, FACE_N, [0, 0, 1]);
  out.push(S(prism(restF, [[-18, 0], [-6, 0], [-6, 6], [-14, 24], [-18, 24]], -40, 40), { tone: "mid" }));
  // corner screws on the dock top, in front of the handheld
  const screws = [[DOCK.x0 + 6, DOCK.y1 - 6], [DOCK.x1 - 6, DOCK.y1 - 6]].map(([x, y]) => G.add3(G.add3(DOCK_C, G.mul3(U, x)), G.add3(G.mul3(FACE_N, y), [0, 0, DOCK_TOP])));
  out.push(Ln(screws.map((p) => path(G.arcPoints(G.frameOf(p, [0, 0, 1], [1, 0, 0], [0, 1, 0]), 0, 2.2, 0, Math.PI * 2, 18))).join(""), { tone: "lo" }));
  out.push(k.dotsSvg(screws.map(iso), { size: 0.5 }));
  return out.join("");
}

function dockFront() {
  const out = [];
  // the front lip that keeps the handheld's foot in place
  const lipF = G.frameOf(G.add3(DOCK_C, [0, 0, DOCK_TOP]), U, FACE_N, [0, 0, 1]);
  out.push(S(prism(lipF, [[9, 0], [16, 0], [16, 3.2], [13, 5], [9, 5]], -44, 44), { tone: "mid" }));
  // the socket the cable plugs into, on the dock's front face
  const sock = G.frameOf(G.add3(PORT_A, G.mul3(FACE_N, -0.2)), FACE_N, U, [0, 0, 1]);
  out.push(S(prism(sock, rrect(-5.5, -3, 5.5, 3, 1.4), 0, 1.6), { tone: "lo" }));
  out.push(S(prism(G.frameOf(G.add3(PORT_A, G.mul3(FACE_N, 1.4)), FACE_N, U, [0, 0, 1]), rrect(-4, -2.2, 4, 2.2, 1), 0, 4.2), { tone: "mid" }));
  // a status lamp beside the socket (lit when the dock is sending)
  out.push(`<g data-part="dock-led">${k.dotsSvg([iso(G.add3(G.add3(DOCK_C, G.add3(G.mul3(U, 22), G.mul3(FACE_N, DOCK.y1 + 0.2))), [0, 0, 4.6]))], { size: 0.85, tone: "mid" })}</g>`);
  return out.join("");
}

// Face layout in face coordinates (x right, y up, origin the face centre).
const SCREEN_BEZEL = { x0: -33, x1: 33, y0: 6, y1: 54, r: 5, depth: 1.4 };
export const LCD = { x0: -26.5, x1: 26.5, y0: 11.5, y1: 48.5, r: 2.4, depth: 1.2 };
const DPAD = [-20, -18];
const BTN_A = [26, -12], BTN_B = [12, -19];

/** The body, as a prism with the classic big corner at the bottom right. */
const bodyPoly = rrect(-BODY.w / 2, -BODY.h / 2, BODY.w / 2, BODY.h / 2, [7, 22, 7, 7], 7);

/** A recess in the face: its visible inner walls (shaded by facing) and the floor, clipped to the opening. */
let clipCount = 0;
function recess({ x0, x1, y0, y1, r, depth }, sN, floorClass, inside = "", floorExtra = "") {
  const id = `wf-clip-${clipCount++}`;
  const ring = rrect(x0, y0, x1, y1, r, 5);
  const walls = [[], [], [], [], []];
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  ring.forEach(([ax, ay], i) => {
    const [bx, by] = ring[(i + 1) % ring.length];
    let nx = by - ay, ny = -(bx - ax);
    if (nx * (cx - (ax + bx) / 2) + ny * (cy - (ay + by) / 2) < 0) [nx, ny] = [-nx, -ny]; // inward
    const normal = G.add3(G.mul3(U, nx), G.mul3(WUP, ny));
    if (!seen(normal)) return;
    walls[shadeOf(normal)].push(path([onFace(ax, ay, sN), onFace(bx, by, sN), onFace(bx, by, sN - depth), onFace(ax, ay, sN - depth)]));
  });
  const shape = flatPath(ring);
  return [
    `<clipPath id="${id}"><path transform="${faceMatrix(sN)}" d="${shape}"/></clipPath>`,
    `<g clip-path="url(#${id})">`,
    `<g transform="${faceMatrix(sN - depth)}"><path class="${floorClass}" d="${shape}"/>${floorExtra}</g>`,
    walls.slice(0, 4).map((d, i) => (d.length ? `<path class="iso-shade" data-shade="${i}" d="${d.join("")}"/>` : "")).join(""),
    walls[4].length ? `<path class="iso-top" d="${walls[4].join("")}"/>` : "",
    inside,
    `</g>`,
    `<g transform="${faceMatrix(sN)}"><path class="iso-line" data-tone="lo" d="${shape}"/></g>`,
  ].join("");
}

function handheld() {
  const out = [];
  out.push(S(prism(FH, bodyPoly, -BODY.t, 0), { tone: "hi", inner: Ln(path(rrect(-BODY.w / 2 + 3, -BODY.h / 2 + 3, BODY.w / 2 - 3, BODY.h / 2 - 3, [5, 19, 5, 5], 7).map(([x, y]) => onFace(x, y))), { tone: "faint" }) }));
  // a seam round the body's side, where the two shells meet
  const seam = bodyPoly.map(([x, y]) => onFace(x, y, -BODY.t / 2));
  const seamVis = [];
  for (let i = 0; i < seam.length; i++) {
    const [x0, y0] = bodyPoly[i], [x1, y1] = bodyPoly[(i + 1) % bodyPoly.length];
    const normal = G.add3(G.mul3(U, y1 - y0), G.mul3(WUP, -(x1 - x0)));
    if (seen(normal)) seamVis.push(k.pathOf([iso(seam[i]), iso(seam[(i + 1) % seam.length])]));
  }
  out.push(Ln(seamVis.join(""), { tone: "faint" }));
  // the screen: a bezel recess, then the LCD window recessed in it (the page draws the LCD's content)
  out.push(recess(SCREEN_BEZEL, 0, "wf-bezel", recess({ ...LCD }, -SCREEN_BEZEL.depth, "wf-lcd", "", `<g data-part="lcd"></g>`)));
  // the power lamp on the bezel and one engraved label under the screen
  out.push(`<g data-part="power">${k.dotsSvg([iso(onFace(-29.5, 44))], { size: 0.8, tone: "hi" })}</g>`);
  out.push(k.faceTextSvg(faceMatrix(0), "DEAN STUDIO", { size: 3.1, tone: "mid" }).replace("<text", `<text x="-31" y="1.6"`));
  // D-pad: a dished well, then the cross raised on it
  out.push(`<g transform="${faceMatrix(0)}">${Ln(flatPath(rrect(DPAD[0] - 13, DPAD[1] - 13, DPAD[0] + 13, DPAD[1] + 13, 13, 8)), { tone: "faint" })}</g>`);
  const arm = 4.4, reach = 11.5;
  const cross = [[-arm, -reach], [arm, -reach], [arm, -arm], [reach, -arm], [reach, arm], [arm, arm], [arm, reach], [-arm, reach], [-arm, arm], [-reach, arm], [-reach, -arm], [-arm, -arm]];
  out.push(`<g data-hit="dpad">${raised(G.frameOf(onFace(...DPAD), N, U, WUP), cross, 3, "mid")}${Ln(path(G.arcPoints(G.frameOf(onFace(...DPAD, 3), N, U, WUP), 0, 2.2, 0, Math.PI * 2, 16)), { tone: "faint" })}</g>`);
  // A and B: round buttons on a shared slanted pad
  const padPoly = rot2(rrect(-17, -6.5, 17, 6.5, 6.5, 6), R(28));
  out.push(S(prism(faceFrame((BTN_A[0] + BTN_B[0]) / 2, (BTN_A[1] + BTN_B[1]) / 2), padPoly, 0, 0.8), { tone: "lo", crease: "none" }));
  for (const [id, [x, y]] of [["b", BTN_B], ["a", BTN_A]]) {
    out.push(`<g data-hit="${id}">${S(G.disc(0.8, 4, 5.2, G.frameAlong(onFace(x, y), N), P), { tone: "hi" })}</g>`);
  }
  // Start and Select: two small pills, slanted
  for (const x of [-9, 6]) out.push(S(prism(faceFrame(x, -43, R(28)), rrect(-5.5, -1.6, 5.5, 1.6, 1.6, 4), 0, 1.6), { tone: "mid" }));
  // speaker slots, bottom right: closed slots in the face
  const slots = Array.from({ length: 6 }, (_, i) => flatPath(rot2(rrect(-1, -9, 1, 9, 1, 3), R(-28)).map(([x, y]) => [x + 9 + i * 4, y - 42 + i * 0.6])));
  out.push(`<g transform="${faceMatrix(0)}">${Ln(slots.join(""), { tone: "lo" })}</g>`);
  return out.join("");
}

// The cartridge: stands in the top slot behind the face, half out until the skills are installed.
export const CART_RISE = 11; // how far it stands proud before it is pushed home
export const cartDown = (by) => {
  const a = iso(onFace(0, 0)), b = iso(onFace(0, -by));
  return `translate(${(b[0] - a[0]).toFixed(2)} ${(b[1] - a[1]).toFixed(2)})`;
};
function cartridge() {
  const top = BODY.h / 2;
  const F = G.frameOf(onFace(0, 0, 0), N, U, WUP);
  const poly = rrect(-27, top - 10, 27, top + 4 + CART_RISE, [1, 1, 4, 4], 4);
  const body = S(prism(F, poly, -11.5, -4.5), { tone: "mid" });
  // grip ridges across the whole face, below the rounded corners, so each ends on the cartridge's edges
  const ridges = Array.from({ length: 4 }, (_, i) => path([onFace(-27, top + CART_RISE - 1.5 - i * 1.8, -4.5), onFace(27, top + CART_RISE - 1.5 - i * 1.8, -4.5)], false)).join("");
  const label = path(rrect(-18, top - 6, 18, top - 0.5 + CART_RISE - 6, 1.2).map(([x, y]) => onFace(x, y, -4.5)));
  // clipped to the space above the slot, so the part inside the body never shows; the clip stays put
  const hull = k.pathOf(G.hullOf([-29, 29].flatMap((x) => [top, top + 40].flatMap((y) => [-12.5, -3.5].map((sN) => iso(onFace(x, y, sN)))))), true);
  return `<clipPath id="wf-cart-clip"><path data-hold d="${hull}"/></clipPath><g clip-path="url(#wf-cart-clip)"><g data-part="cart">${body}${Ln(ridges, { tone: "lo" })}${Ln(label, { tone: "faint" })}</g></g>`;
}

// ---------------------------------------------------------------- the stand and the cable
export const PORT_B = (() => {
  const dir = G.unit3(G.sub3(PORT_A, STAND_C).map((v, i) => (i === 2 ? 0 : v)));
  const turned = G.unit3(G.add3(dir, G.mul3(NEAR, 0.9)));
  return { at: G.add3(STAND_C, [turned[0] * (STAND.base + 0.2), turned[1] * (STAND.base + 0.2), STAND.baseH / 2]), dir: [turned[0], turned[1], 0] };
})();

function stand() {
  const out = [];
  const [x, y] = STAND_C;
  out.push(`<path class="iso-halo" d="${k.haloOf({ x: x - STAND.base, y: y - STAND.base, w: STAND.base * 2, d: STAND.base * 2, r: STAND.base }, 0, STAND.baseH, P)}"/>`);
  out.push(S(k.cylinder(x, y, STAND.base, 0, STAND.baseH, P, 72, 1), { tone: "mid", inner: Ln(k.sideArc(x, y, STAND.base, 2.4, P, 48), { tone: "faint" }) }));
  // the light ring on the base top (it glows when the cube is solved) and degree ticks inside it
  out.push(`<g data-part="ring">${Ln(k.ring(x, y, STAND.base - 5, STAND.baseH, P, 72), { tone: "lo" })}</g>`);
  const t = k.radialTicks(x, y, STAND.base - 5.6, 48, 4, STAND.baseH, [1.4, 2.8], P);
  out.push(Ln(t.minor, { tone: "faint" }), Ln(t.major, { tone: "lo" }));
  out.push(S(k.cylinder(x, y, STAND.post + 2.4, STAND.baseH, 2, P, 32), { tone: "lo" }));
  out.push(S(k.cylinder(x, y, STAND.post, STAND.baseH + 2, STAND.postH - 2, P, 32), { tone: "mid", crease: "none", inner: Ln(k.sideArc(x, y, STAND.post, STAND.baseH + 7, P, 16), { tone: "faint" }) }));
  out.push(S(k.cylinder(x, y, STAND.cup, STAND.baseH + STAND.postH, STAND.cupH, P, 40, 0.6), { tone: "mid" }));
  // the socket on the base's side
  const F = G.frameAlong(PORT_B.at, PORT_B.dir);
  out.push(S(G.disc(-0.6, 1.2, 3.6, F, P), { tone: "lo" }));
  out.push(S(G.disc(1.2, 5.4, 2.7, F, P), { tone: "mid" }));
  return out.join("");
}

/** The cable's centreline, from the dock's plug to the stand's plug, lying on the mat between them. */
export const CABLE = (() => {
  const r = 1.5;
  const a0 = G.add3(PORT_A, G.mul3(FACE_N, 5.6));
  const a1 = G.add3(a0, G.mul3(FACE_N, 7));
  const b0 = G.add3(PORT_B.at, G.mul3(PORT_B.dir, 5.4));
  const b1 = G.add3(b0, G.mul3(PORT_B.dir, 9));
  const mid = at(-6, 38, r);
  // each end leaves its plug straight along the plug's axis before it bends down to the mat
  const pts = [a0, a1, [a1[0] + FACE_N[0] * 6, a1[1] + FACE_N[1] * 6, r], mid, [b1[0], b1[1], r], [b1[0], b1[1], b0[2]], b0];
  return { r, points: G.fillet(pts, 9, 8, { P, tube: r }) };
})();

function cable() {
  const pieces = tubePieces(CABLE.points, CABLE.r, P, { maxLength: 400 });
  return pieces.map((piece) => tubeSvg(piece, { tone: "mid" })).join("");
}

// ---------------------------------------------------------------- the cube
const STICKER = rrect(-8, -8, 8, 8, 2.6, 4);
const BODY_SQ = rrect(-CUBIE / 2, -CUBIE / 2, CUBIE / 2, CUBIE / 2, 3.2, 4);
const LOCAL = [[0, 1, 2], [0, 2, 1], [1, 2, 0]]; // for each face axis, two in-plane axes

/**
 * One cubie at its place in a turning layer, as SVG: the body (a rounded prism on its own axes) and the
 * stickers on its faces that face the viewer. `m` is the layer's turn so far (identity at rest).
 */
// The steps' icons, printed on the sticker a step plugs in (sticker units, y up): a brief, a spark, a grid of
// tokens, a browser window, a loop and a tick. Closed shapes are outlines; open ones are printed strokes.
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const arc = (r, a0, a1, n = 14) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [r * Math.cos(a), r * Math.sin(a)]; });
export const ICONS = [
  { shut: [rect(-4, -5.5, 4, 5.5)], open: [[[-2.2, 2.6], [2.2, 2.6]], [[-2.2, 0], [2.2, 0]], [[-2.2, -2.6], [1, -2.6]]] },
  { shut: [[[0, 6], [1.3, 1.3], [6, 0], [1.3, -1.3], [0, -6], [-1.3, -1.3], [-6, 0], [-1.3, 1.3]]], open: [] },
  { shut: [rect(-5, 0.6, -0.6, 5), rect(0.6, 0.6, 5, 5), rect(-5, -5, -0.6, -0.6), rect(0.6, -5, 5, -0.6)], open: [] },
  { shut: [rect(-5.5, -4.5, 5.5, 4.5)], open: [[[-5.5, 2.2], [5.5, 2.2]]] },
  { shut: [], open: [arc(4.4, R(40), R(320)), [[1.6, 5.6], [3.4, 2.8], [0.2, 1.9]]] },
  { shut: [], open: [[[-4.6, 0], [-1.6, -3.4], [4.8, 3.6]]] },
];

/**
 * One cubie at its place in a turning layer, as SVG: the body (a rounded prism on its own axes) and the
 * stickers on its faces that face the viewer. `m` is the layer's turn so far (identity at rest). `mark` is
 * the step plugged into it ({ f, icon, on }), and `lift` how far it stands out of the cube along that sticker.
 */
function cubieSvg(cubie, m, lit, mark, lift = 0) {
  const pos = apply(m, cubie.pos);
  const rest = G.add3(CUBE_C, G.mul3(pos, PITCH));
  const axes = [0, 1, 2].map((a) => apply(m, apply(cubie.rot, [a === 0 ? 1 : 0, a === 1 ? 1 : 0, a === 2 ? 1 : 0])));
  const out = mark ? G.mul3(axes[FACES[mark.f].findIndex((v) => v !== 0)], FACES[mark.f].find((v) => v !== 0)) : [0, 0, 0];
  const centre = G.add3(rest, G.mul3(out, lift));
  const body = S(prism(G.frameOf(centre, axes[2], axes[0], axes[1]), BODY_SQ, -CUBIE / 2, CUBIE / 2), { tone: lit ? "lit" : "lo", lit, crease: "lo" });
  const stickers = [];
  FACES.forEach((n, f) => {
    const colour = cubie.stickers[f];
    if (colour < 0) return;
    const axis = n.findIndex((v) => v !== 0);
    const normal = G.mul3(axes[axis], n[axis]);
    if (G.dot3(normal, V) < 0.02) return;
    const [, a1, a2] = LOCAL[axis][0] === axis ? LOCAL[axis] : [axis, ...[0, 1, 2].filter((i) => i !== axis)];
    const o = G.add3(centre, G.mul3(normal, CUBIE / 2 + 0.05));
    const d = path(STICKER.map(([x, y]) => G.add3(G.add3(o, G.mul3(axes[a1], x)), G.mul3(axes[a2], y))));
    const marked = mark && mark.f === f;
    stickers.push(`<path class="wf-st" data-c="${colour}"${marked ? ` data-mk${mark.on ? " data-on" : ""}` : ""} d="${d}"/>`);
    if (!marked) return;
    // the icon reads upright: its axes come from the sticker's facing at rest, then turn with the cubie
    const restN = apply(cubie.rot, FACES[f]);
    const ex0 = G.unit3(G.sub3(RIGHT, G.mul3(restN, G.dot3(RIGHT, restN))));
    const ey0 = G.cross3(ex0, restN);
    const ex = apply(m, ex0), ey = apply(m, ey0);
    const at = ([x, y]) => G.add3(G.add3(o, G.mul3(ex, x)), G.mul3(ey, y));
    const icon = ICONS[mark.icon];
    const d2 = icon.shut.map((pts) => path(pts.map(at))).join("") + icon.open.map((pts) => path(pts.map(at), false)).join("");
    stickers.push(`<path class="wf-ic" data-c="${colour}" data-free d="${d2}"/>`);
  });
  // once it is out past the face (its whole length), the face's plane separates it from every other cubie,
  // and it is on the viewer's side of that plane (U, R, F all face the viewer): it goes after all of them
  return { depth: G.dot3(rest, V), late: lift >= CUBIE, svg: `<g>${body}${stickers.join("")}</g>` };
}

/**
 * The whole cube, with `move` ([axis, q]) turned `angle` radians so far (or none). `marks` maps a cubie id to
 * the step plugged into it; `lift` ({ id, by }) is a cubie being plugged in. Cubies sort by their resting
 * depth: a cubie sliding out of its face keeps its neighbours' order, since the planes between them stay put.
 */
export function cubeSvg(cubies, move = null, angle = 0, marks = new Map(), lift = null) {
  const turning = move ? rotation(move[0], angle) : null;
  const still = [], moving = [];
  for (const cubie of cubies) (move && inLayer(cubie, move[0]) ? moving : still).push(cubie);
  let late = "";
  const draw = (list, m, lit) =>
    list.map((c) => cubieSvg(c, m, lit, marks.get(c.id), lift && lift.id === c.id ? lift.by : 0)).sort((a, b) => a.depth - b.depth)
      .map((x) => (x.late ? ((late = x.svg), "") : x.svg)).join("");
  const I = rotation("z", 0);
  // the turning layer is on the viewer's side of its cut (U, R and F all face the viewer), so it goes last,
  // and a cubie pulled right out goes after everything
  return draw(still, I, false) + (move ? draw(moving, turning, true) : "") + late;
}

// ---------------------------------------------------------------- assembly
export function sceneSvg() {
  return {
    under: [mat(), dockBack(), handheld(), cartridge(), dockFront(), stand(), cable()].join(""),
  };
}

/** What the shader needs: the screen's plane and size, the cable, the stand's ring. */
export const GL_DATA = {
  lcd: { o: onFace((LCD.x0 + LCD.x1) / 2, (LCD.y0 + LCD.y1) / 2, -SCREEN_BEZEL.depth - LCD.depth), u: U, v: WUP, n: N, half: [(LCD.x1 - LCD.x0) / 2, (LCD.y1 - LCD.y0) / 2], r: LCD.r },
  ring: { c: [STAND_C[0], STAND_C[1], STAND.baseH], r: STAND.base - 5 },
  cube: CUBE_C,
};
export const iso3 = iso;

/** The true shapes of what is drawn, in world units, for the anatomy audit (scripts/anatomy/workflow-audit.mjs). */
export const SHAPES = {
  mat: { plan: MAT, z: -MAT_H, h: MAT_H },
  dock: { F: DOCK_F, poly: rrect(DOCK.x0, DOCK.y0, DOCK.x1, DOCK.y1, 6), h: DOCK_TOP },
  socketA: { F: G.frameOf(G.add3(PORT_A, G.mul3(FACE_N, -0.2)), FACE_N, U, [0, 0, 1]), poly: rrect(-5.5, -3, 5.5, 3, 1.4), s: [0, 1.6] },
  plugA: { F: G.frameOf(G.add3(PORT_A, G.mul3(FACE_N, 1.4)), FACE_N, U, [0, 0, 1]), poly: rrect(-4, -2.2, 4, 2.2, 1), s: [0, 4.2] },
  body: { F: FH, poly: bodyPoly, s: [-BODY.t, 0] },
  stand: { c: STAND_C, ...STAND },
  plugB: { F: G.frameAlong(PORT_B.at, PORT_B.dir), socket: [-0.6, 1.2, 3.6], plug: [1.2, 5.4, 2.7] },
  cube: { c: CUBE_C, half: PITCH * 1.5 - (PITCH - CUBIE) / 2 },
};
