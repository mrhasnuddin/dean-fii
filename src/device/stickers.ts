// Stickers on the wallet's back plate (an easter egg): die-cut vinyl stickers of three logos with a
// holographic foil border, placed at random on every visit. Grab one and its nearest corner peels up
// with a real curl (showing the adhesive side), harder the further it goes, and never past ~70 %;
// let go and it lays back down.
//
// Underneath each one is a second sticker: a QR code to the partner's site (the hidden part of the
// easter egg). Pull a sticker all the way (past COMMIT of its travel) and let go: the flap stays rolled
// back and the QR is revealed. Tap the QR to visit the site, or tap the flap to put the sticker back.
// The QR is the largest square that fits inside the sticker's die-cut shape, so it is never seen early.
// Putting it back plays the peel in reverse: the fold travels back to the corner while the flap's angle
// follows the same curve it took on the way up (`angleFor`), then a tiny press as it lands.
//
// Construction (all procedural, from the SVGs in public/):
// - Die-cut shape = the logo dilated (stamped around a circle) with enclosed counters filled, so the
//   sticker follows the artwork like a real die-cut, with a thick border. The border is holographic
//   foil (thin-film iridescence, metallic); the body is vinyl in a colour that suits the print (dark
//   under white logos, off-white under black ones); the print sits on top.
// - One packed surface map drives the material: R = iridescence (foil only), G = roughness,
//   B = metalness. A bump map adds orange-peel texture, a slightly raised print and a couple of
//   trapped air bubbles.
// - Peel = a page curl on a subdivided plane: vertices past the fold wrap a small cylinder (vinyl's
//   stiffness) and leave it as a straight flap at a peel angle that steepens as it lifts.
// Units: W (wallet width = 1). Sticker local +Z points away from the back plate.
import * as THREE from 'three';
import gsap from 'gsap';

export interface StickerSpec {
  src: string;
  /** Partner name (announced when its QR is revealed). */
  name: string;
  /** Where the QR under the sticker leads. */
  url: string;
  /** Printed logo width, W (the border adds to it). */
  width: number;
  /** Max random rotation, radians. */
  tilt: number;
}

export const STICKERS: StickerSpec[] = [
  { src: '/OC.svg', name: 'Open Crew', url: 'https://open-crew.vercel.app/', width: 0.36, tilt: 0.3 },
  { src: '/aseanlabs.svg', name: 'ASEAN Labs', url: 'https://aseanlabs.io/', width: 0.25, tilt: 0.45 },
  { src: '/mydac.svg', name: 'MyDAC', url: 'https://www.mydac.org.my/', width: 0.19, tilt: 0.5 },
];

const BODY_PAD = 0.012; // vinyl around the print (W)
const BORDER = 0.016; // holographic foil border (W)
const PX_PER_W = 1600; // texture resolution
const SEG = 48; // plane subdivisions per side (peel smoothness)
const CURL_R = 0.014; // curl radius (W): how stiff the vinyl is
const MAX_FRACTION = 0.9; // how far along the peel direction it can go (nearly off: the QR beneath is revealed)
const RESIST = 0.7; // rubber band: smaller = the pull reaches the limit sooner
/** Released past this share of the travel, the flap stays rolled back (QR revealed) instead of laying down. */
export const COMMIT = 0.8;
const LATCH_ANGLE = 2.85; // a latched flap hangs folded almost flat back over itself
// Peel angle (0 = flat, π = folded flat back over itself). A corner that has come unstuck stands up
// at a shallow angle; one being pulled rolls back past vertical, so the viewer sees its adhesive
// side (at ~90° the flap is edge-on to a camera looking at the back, and simply vanishes).
const REST_ANGLE = 0.75;
const PULL_ANGLE = [1.85, 2.8] as const; // just grabbed → at the limit
const ANGLE_TAU = 0.07; // s: the flap swings to its new angle instead of snapping
const HEAL_FULL = 0.85; // s: a latched flap laying back down (shorter from a partial peel); sfx 'unpeel' is cut to this
const SETTLE = 0.4; // s: a flap let go before it latches, springing back
const GENTLE = 0.3; // s: the longest any of it takes under reduced motion (quick, but still a movement, not a jump)

export interface Sticker {
  mesh: THREE.Mesh; // front (print) side; raycast target (userData.sticker = this)
  group: THREE.Group;
  name: string;
  url: string;
  /** "mydac.org.my": what the link pill shows. */
  host: string;
  /** The QR sticker beneath (raycastable only while the flap is latched open); null if no square fits. */
  qr: THREE.Mesh | null;
  /** The flap is latched open and the QR is showing. */
  isOpen(): boolean;
  beginPeel(worldPoint: THREE.Vector3): void;
  /** Pointer ray while dragging. Returns the peel fraction 0..1 (of the allowed maximum). */
  drag(ray: THREE.Ray): number;
  /**
   * Let go. Past COMMIT it latches open and returns true; otherwise it lays back down, calls `onSettled`
   * when flat, and returns false. `gentle` (reduced motion): the same movement, quicker and without the
   * press as it lands; it is never skipped, because it answers the visitor's own gesture.
   */
  release(onSettled?: () => void, gentle?: boolean): boolean;
  /** Put a latched sticker back: the flap lays down over the QR (the peel in reverse). */
  heal(onSettled?: () => void, gentle?: boolean): void;
  update(dt: number): void;
}

// ---------------------------------------------------------------- textures from the SVG
async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  return img;
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Stamp `src` around circles up to radius r (a dilation), then fill enclosed holes. Returns alpha 0/255. */
function dieCut(src: HTMLCanvasElement, r: number): Uint8ClampedArray {
  const w = src.width;
  const h = src.height;
  const c = canvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const rings = Math.max(1, Math.ceil(r / 4));
  ctx.drawImage(src, 0, 0);
  for (let k = 1; k <= rings; k++) {
    const rr = (r * k) / rings;
    const n = Math.max(12, Math.round(rr * 1.4));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      ctx.drawImage(src, Math.cos(a) * rr, Math.sin(a) * rr);
    }
  }
  const data = ctx.getImageData(0, 0, w, h).data;
  // Flood-fill "outside" from the border; everything not reached is inside the sticker.
  const inside = new Uint8ClampedArray(w * h).fill(255);
  const stack: number[] = [];
  const push = (i: number) => {
    if (inside[i] && data[i * 4 + 3] < 128) {
      inside[i] = 0;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
  return inside;
}

// ---------------------------------------------------------------- the QR sticker beneath
const QR_MARGIN = 2; // quiet zone, modules: the sticker's own white (the dark plate lies beyond it)
const QR_RIM = 0.9; // holographic border, modules

/** The QR as a die-cut rounded-square sticker: foil rim, white vinyl, black modules. */
function qrTexture(modules: boolean[][]): THREE.CanvasTexture {
  const PX = 20; // pixels per module: edges stay crisp up close
  const n = modules.length;
  const S = Math.round((n + 2 * QR_MARGIN + 2 * QR_RIM) * PX);
  const c = canvas(S, S);
  const ctx = c.getContext('2d')!;
  const rim = QR_RIM * PX;
  const foil = ctx.createLinearGradient(0, 0, S, S * 0.6);
  ['#9fd0ff', '#e6b8ff', '#ffd6a8', '#b6ffd9', '#9fd0ff'].forEach((col, i, all) => foil.addColorStop(i / (all.length - 1), col));
  ctx.fillStyle = foil;
  ctx.beginPath();
  ctx.roundRect(0, 0, S, S, S * 0.1);
  ctx.fill();
  ctx.fillStyle = '#f6f3ec';
  ctx.beginPath();
  ctx.roundRect(rim, rim, S - 2 * rim, S - 2 * rim, S * 0.075);
  ctx.fill();
  ctx.fillStyle = '#0f0f12';
  const o = rim + QR_MARGIN * PX;
  modules.forEach((row, y) => row.forEach((on, x) => on && ctx.fillRect(o + x * PX, o + y * PX, PX, PX)));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * The largest square (centre and side, W, sticker space: origin at its centre, y up) that lies inside the
 * die-cut `mask` and stays clear of the curl however the sticker is peeled: whichever corner is lifted, the
 * fold stops at MAX_FRACTION of the diagonal, and the square must end before it.
 */
function fitSquare(mask: Uint8ClampedArray, wPx: number, hPx: number, w: number, h: number): { cx: number; cy: number; side: number } | null {
  const iw = wPx + 1;
  const sum = new Int32Array(iw * (hPx + 1)); // integral image of the mask: any box's coverage in O(1)
  for (let y = 0; y < hPx; y++) {
    let row = 0;
    for (let x = 0; x < wPx; x++) {
      row += mask[y * wPx + x] > 0 ? 1 : 0;
      sum[(y + 1) * iw + x + 1] = sum[y * iw + x + 1] + row;
    }
  }
  const full = (x0: number, y0: number, x1: number, y1: number) =>
    sum[y1 * iw + x1] - sum[y0 * iw + x1] - sum[y1 * iw + x0] + sum[y0 * iw + x0] === (x1 - x0) * (y1 - y0);
  const E = Math.hypot(w, h);
  const free = (MAX_FRACTION - 0.5) * E - CURL_R - 0.012; // the fold's reach past the centre, less the curl and a margin
  const dirs = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sy]) => [(-sx * w) / E, (-sy * h) / E]); // peel directions
  const STEP = 6; // px between candidate centres
  for (let side = Math.min(w, h) * 0.92; side >= 0.07; side -= 0.004) {
    const half = Math.round((side * PX_PER_W) / 2) + 4; // 4 px of vinyl to spare all round
    let best: { cx: number; cy: number; side: number } | null = null;
    let bestD = Infinity;
    for (let py = half; py <= hPx - half; py += STEP) {
      for (let px = half; px <= wPx - half; px += STEP) {
        const cx = (px - wPx / 2) / PX_PER_W;
        const cy = (hPx / 2 - py) / PX_PER_W;
        const d = Math.hypot(cx, cy);
        if (d >= bestD) continue;
        if (dirs.some(([ux, uy]) => cx * ux + cy * uy + (side / 2) * (Math.abs(ux) + Math.abs(uy)) > free)) continue;
        if (!full(px - half, py - half, px + half, py + half)) continue;
        best = { cx, cy, side };
        bestD = d;
      }
    }
    if (best) return best;
  }
  return null;
}

interface Built {
  art: THREE.CanvasTexture; // RGBA: foil base / vinyl / print; alpha = die-cut
  surface: THREE.CanvasTexture; // R iridescence, G roughness, B metalness
  bump: THREE.CanvasTexture;
  alpha: THREE.CanvasTexture; // die-cut for the adhesive side
  width: number; // W incl. border
  height: number;
  /** The QR sticker beneath: its texture, side and centre (W, sticker space); null if none fits. */
  qr: { tex: THREE.CanvasTexture; side: number; cx: number; cy: number } | null;
}

async function buildTextures(spec: StickerSpec, rand: () => number): Promise<Built> {
  const img = await loadImage(spec.src);
  const aspect = img.naturalHeight / img.naturalWidth || 1;
  const pad = BODY_PAD + BORDER;
  const width = spec.width + 2 * pad;
  const height = spec.width * aspect + 2 * pad;
  const W = Math.round(width * PX_PER_W);
  const H = Math.round(height * PX_PER_W);
  const padPx = pad * PX_PER_W;

  // The print, rasterised once at the right place.
  const print = canvas(W, H);
  const pctx = print.getContext('2d', { willReadFrequently: true })!;
  pctx.drawImage(img, padPx, padPx, W - 2 * padPx, H - 2 * padPx);
  const printData = pctx.getImageData(0, 0, W, H).data;

  const body = dieCut(print, BODY_PAD * PX_PER_W);
  const outer = dieCut(print, pad * PX_PER_W);

  // Print luminance decides the vinyl: white logos on dark vinyl, dark logos on off-white.
  let lum = 0;
  let n = 0;
  for (let i = 0; i < printData.length; i += 4) {
    if (printData[i + 3] > 128) {
      lum += (0.2126 * printData[i] + 0.7152 * printData[i + 1] + 0.0722 * printData[i + 2]) / 255;
      n++;
    }
  }
  const vinyl = (n ? lum / n : 0) > 0.5 ? [24, 25, 30] : [236, 234, 228];

  const art = canvas(W, H);
  const actx = art.getContext('2d')!;
  const artImg = actx.createImageData(W, H);
  const surf = canvas(W, H);
  const sctx = surf.getContext('2d')!;
  const surfImg = sctx.createImageData(W, H);
  const al = canvas(W, H);
  const alctx = al.getContext('2d')!;
  const alImg = alctx.createImageData(W, H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const inOuter = outer[i] > 0;
    const inBody = body[i] > 0;
    const pa = printData[p + 3] / 255;
    // Foil: holographic vinyl carries a soft diffraction rainbow in diagonal bands; the thin film
    // on top shifts it further as the wallet turns.
    let base = vinyl;
    if (!inBody) {
      const x = i % W;
      const y = (i / W) | 0;
      const h = ((x + y * 0.6) / (W * 0.28)) % 1;
      base = [
        200 + 45 * Math.cos(2 * Math.PI * h),
        200 + 45 * Math.cos(2 * Math.PI * (h - 1 / 3)),
        205 + 45 * Math.cos(2 * Math.PI * (h - 2 / 3)),
      ];
    }
    artImg.data[p] = base[0] * (1 - pa) + printData[p] * pa;
    artImg.data[p + 1] = base[1] * (1 - pa) + printData[p + 1] * pa;
    artImg.data[p + 2] = base[2] * (1 - pa) + printData[p + 2] * pa;
    artImg.data[p + 3] = inOuter ? 255 : 0;
    const foil = inOuter && !inBody;
    surfImg.data[p] = foil ? 255 : 0; // iridescence
    surfImg.data[p + 1] = foil ? 46 : Math.round(110 + 40 * pa); // roughness: foil 0.18, vinyl 0.43, ink 0.59
    surfImg.data[p + 2] = foil ? 235 : 0; // metalness
    surfImg.data[p + 3] = 255;
    alImg.data[p] = alImg.data[p + 1] = alImg.data[p + 2] = inOuter ? 255 : 0;
    alImg.data[p + 3] = 255;
  }
  actx.putImageData(artImg, 0, 0);
  sctx.putImageData(surfImg, 0, 0);
  alctx.putImageData(alImg, 0, 0);

  // Bump: orange peel + raised ink + two or three trapped air bubbles inside the vinyl.
  const bump = canvas(W, H);
  const bctx = bump.getContext('2d')!;
  const bImg = bctx.createImageData(W, H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const v = 128 + (rand() - 0.5) * 10 + (printData[p + 3] / 255) * 10;
    bImg.data[p] = bImg.data[p + 1] = bImg.data[p + 2] = v;
    bImg.data[p + 3] = 255;
  }
  bctx.putImageData(bImg, 0, 0);
  bctx.filter = 'blur(1.2px)';
  bctx.drawImage(bump, 0, 0);
  bctx.filter = 'none';
  const bubbles = 2 + Math.floor(rand() * 2);
  for (let k = 0; k < bubbles; k++) {
    for (let tries = 0; tries < 20; tries++) {
      const x = Math.floor(padPx + rand() * (W - 2 * padPx));
      const y = Math.floor(padPx + rand() * (H - 2 * padPx));
      if (!body[y * W + x]) continue;
      const r = (0.006 + rand() * 0.01) * PX_PER_W;
      const g = bctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.18)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      bctx.fillStyle = g;
      bctx.beginPath();
      bctx.arc(x, y, r, 0, Math.PI * 2);
      bctx.fill();
      break;
    }
  }

  const tex = (c: HTMLCanvasElement, color = false) => {
    const t = new THREE.CanvasTexture(c);
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  // The QR beneath: the biggest square that hides entirely under this sticker's die-cut.
  let qr: Built['qr'] = null;
  const fit = fitSquare(outer, W, H, width, height);
  if (fit) {
    const { encode } = await import('uqr'); // its own small chunk, fetched with the stickers
    qr = { tex: qrTexture(encode(spec.url, { ecc: 'L', border: 0 }).data), side: fit.side, cx: fit.cx, cy: fit.cy };
  }
  return { art: tex(art, true), surface: tex(surf), bump: tex(bump), alpha: tex(al), width, height, qr };
}

// ---------------------------------------------------------------- placement (back view, W)
// Back-view coordinates: looking at the back plate, +x to the viewer's right. Keep clear of the
// embossed D-star, the engraved DEAN STUDIO and the plate's rounded edge.
const PLATE = { hx: 0.44, hy: 0.68 };
const KEEP_OUT = [
  { x0: -0.19, x1: 0.19, y0: 0.12, y1: 0.48 }, // D-star emboss
  { x0: -0.28, x1: 0.28, y0: -0.69, y1: -0.58 }, // DEAN STUDIO
];

type Box = { x: number; y: number; hw: number; hh: number; rot: number };
function corners(b: Box): [number, number][] {
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [b.x + i * b.hw * c - j * b.hh * s, b.y + i * b.hw * s + j * b.hh * c]);
}
function overlap(a: [number, number][], b: [number, number][]): boolean {
  // Separating axis test for two convex quads.
  for (const poly of [a, b]) {
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % 4];
      const nx = y2 - y1;
      const ny = x1 - x2;
      const pa = a.map(([x, y]) => x * nx + y * ny);
      const pb = b.map(([x, y]) => x * nx + y * ny);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
  }
  return true;
}
function place(sizes: { hw: number; hh: number; tilt: number }[], rand: () => number): (Box | null)[] {
  const placed: Box[] = [];
  const out: (Box | null)[] = [];
  const zones = KEEP_OUT.map((z) => corners({ x: (z.x0 + z.x1) / 2, y: (z.y0 + z.y1) / 2, hw: (z.x1 - z.x0) / 2, hh: (z.y1 - z.y0) / 2, rot: 0 }));
  for (const s of sizes) {
    let best: Box | null = null;
    // If a roll leaves no room, the sticker gets a little smaller and tries again (never overlaps).
    for (let t = 0; t < 1200 && !best; t++) {
      const k = t < 400 ? 1 : t < 800 ? 0.9 : 0.8;
      const b: Box = { x: (rand() * 2 - 1) * PLATE.hx, y: (rand() * 2 - 1) * PLATE.hy, hw: s.hw * k, hh: s.hh * k, rot: (rand() * 2 - 1) * s.tilt };
      const c = corners(b);
      if (c.some(([x, y]) => Math.abs(x) > PLATE.hx || Math.abs(y) > PLATE.hy)) continue;
      if (zones.some((z) => overlap(c, z))) continue;
      if (placed.some((p) => overlap(c, corners({ ...p, hw: p.hw + 0.01, hh: p.hh + 0.01 })))) continue;
      best = b;
    }
    // Still no room (very unlikely at these sizes): leave that sticker off rather than overlap.
    if (best) placed.push(best);
    out.push(best);
  }
  return out;
}

// ---------------------------------------------------------------- one sticker
function makeSticker(b: Built, spec: StickerSpec, box: Box, z: number, envMap: THREE.Texture | null, hint: number, rand: () => number): Sticker {
  const geo = new THREE.PlaneGeometry(b.width, b.height, SEG, SEG);
  const base = Float32Array.from(geo.attributes.position.array as Float32Array);
  const front = new THREE.MeshPhysicalMaterial({
    name: 'sticker-vinyl',
    map: b.art,
    alphaTest: 0.5,
    roughness: 1,
    roughnessMap: b.surface,
    metalness: 1,
    metalnessMap: b.surface,
    iridescence: 1,
    iridescenceMap: b.surface,
    iridescenceIOR: 1.6,
    iridescenceThicknessRange: [300, 900],
    clearcoat: 0.55, // laminate
    clearcoatRoughness: 0.22,
    bumpMap: b.bump,
    bumpScale: 0.6,
    envMap,
    envMapIntensity: 1.2,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  // Adhesive side: warm off-white with a tacky satin sheen and the same fine grain.
  const back = new THREE.MeshStandardMaterial({
    name: 'sticker-adhesive',
    color: '#f2ece0',
    // A rolled-back flap gets little of the studio light, so a touch of self-light keeps the backing
    // reading as pale vinyl rather than a grey hole.
    emissive: '#3b362d',
    roughness: 0.5,
    envMapIntensity: 1.4,
    bumpMap: b.bump,
    bumpScale: 0.3,
    alphaMap: b.alpha,
    alphaTest: 0.5,
    side: THREE.BackSide,
    envMap,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const mesh = new THREE.Mesh(geo, front);
  mesh.name = 'sticker';
  const underside = new THREE.Mesh(geo, back);
  underside.name = 'sticker-adhesive';
  // A flap rolled back past vertical shows its adhesive side to the camera, which is then what a tap
  // lands on (the front mesh's back faces are culled); a sticker lying flat is only ever hit on the front.
  // Flap shadow: the curl's footprint flattened onto the surface, darker where the flap is higher,
  // nudged away from the key light. Depth-tested, so the flap itself always covers its own shadow.
  const shadowGeo = new THREE.BufferGeometry();
  shadowGeo.setIndex(geo.index);
  shadowGeo.setAttribute('uv', geo.attributes.uv);
  shadowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(base.length), 3));
  shadowGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array((base.length / 3) * 4), 4));
  const shadow = new THREE.Mesh(
    shadowGeo,
    new THREE.MeshBasicMaterial({ color: '#000000', vertexColors: true, transparent: true, depthWrite: false, alphaMap: b.alpha, polygonOffset: true, polygonOffsetFactor: -3 }),
  );
  shadow.name = 'sticker-shadow';
  shadow.raycast = () => {};
  const shadowOff = new THREE.Vector2(0.22, -0.3).rotateAround(new THREE.Vector2(), -box.rot);

  // The QR sticker beneath: matte white vinyl with black modules, just under the sticker (it is hidden
  // by it until the flap comes away). Only raycastable once the flap is latched open.
  let open = false;
  let qrMesh: THREE.Mesh | null = null;
  let qrHit: THREE.Mesh | null = null;
  if (b.qr) {
    qrMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(b.qr.side, b.qr.side),
      new THREE.MeshStandardMaterial({
        name: 'sticker-qr',
        map: b.qr.tex,
        alphaTest: 0.5,
        roughness: 0.6,
        metalness: 0,
        envMap,
        envMapIntensity: 0.6, // even light: the code has to stay readable
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    );
    qrMesh.name = 'sticker-qr';
    qrMesh.position.set(b.qr.cx, b.qr.cy, -0.0006);
    qrMesh.visible = false; // until something is peeled
    qrMesh.raycast = () => {};
    // The tap target is a plane 1.8× the code (it is ~30 px on a phone), unseen and live only while latched open.
    qrHit = new THREE.Mesh(new THREE.PlaneGeometry(b.qr.side * 1.8, b.qr.side * 1.8), new THREE.MeshBasicMaterial());
    qrHit.name = 'sticker-qr-hit';
    qrHit.visible = false; // the raycaster ignores `visible`, the renderer doesn't draw it
    qrHit.position.copy(qrMesh.position);
    const hit = THREE.Mesh.prototype.raycast;
    qrHit.raycast = function (rc, hits) {
      if (open) hit.call(this, rc, hits);
    };
  }

  const group = new THREE.Group();
  group.add(mesh, underside, shadow);
  if (qrMesh && qrHit) group.add(qrMesh, qrHit);
  group.scale.setScalar((box.hw * 2) / b.width); // the placer may have shrunk it to fit
  // Back plate faces −Z: turn the sticker around (π about Y), mirror x so the layout reads from behind.
  group.position.set(-box.x, box.y, z);
  group.rotation.set(0, Math.PI, box.rot);

  // Peel state: `corner` = the sticker corner being lifted (local 2D), `a` = fold distance from it.
  const corner = new THREE.Vector2();
  const u = new THREE.Vector2();
  let s0 = 0;
  let maxA = 0;
  let a = 0;
  let rest = 0; // resting lift (the hint corner)
  let angle = REST_ANGLE;
  let angleTo = REST_ANGLE;
  let dirty = true;
  const grab = new THREE.Vector2();
  const plane = new THREE.Plane();
  const tmp = new THREE.Vector3();
  let settle: gsap.core.Tween | null = null;

  function setCorner(cx: number, cy: number) {
    corner.set(cx, cy);
    u.set(-cx, -cy).normalize(); // peel travels from the corner toward the centre
    s0 = corner.dot(u);
    const ext = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => (i * b.width) / 2 * u.x + (j * b.height) / 2 * u.y);
    maxA = (Math.max(...ext) - Math.min(...ext)) * MAX_FRACTION;
  }

  function deform() {
    const pos = geo.attributes.position.array as Float32Array;
    const alpha = angle;
    const sf = s0 + a;
    const arc = alpha * CURL_R;
    const sinA = Math.sin(alpha);
    const cosA = Math.cos(alpha);
    for (let i = 0; i < pos.length; i += 3) {
      const x = base[i];
      const y = base[i + 1];
      const s = x * u.x + y * u.y;
      if (s >= sf || a <= 0) {
        pos[i] = x;
        pos[i + 1] = y;
        pos[i + 2] = 0;
        continue;
      }
      const tx = x - s * u.x;
      const ty = y - s * u.y;
      const d = sf - s;
      let s2: number;
      let z2: number;
      if (d <= arc) {
        const th = d / CURL_R;
        s2 = sf - CURL_R * Math.sin(th);
        z2 = CURL_R * (1 - Math.cos(th));
      } else {
        s2 = sf - CURL_R * sinA - cosA * (d - arc);
        z2 = CURL_R * (1 - cosA) + sinA * (d - arc);
      }
      pos[i] = tx + s2 * u.x;
      pos[i + 1] = ty + s2 * u.y;
      pos[i + 2] = z2;
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const sp = shadowGeo.attributes.position.array as Float32Array;
    const sc = shadowGeo.attributes.color.array as Float32Array;
    for (let i = 0, v = 0; i < pos.length; i += 3, v += 4) {
      const z = pos[i + 2];
      sp[i] = pos[i] + z * shadowOff.x;
      sp[i + 1] = pos[i + 1] + z * shadowOff.y;
      sp[i + 2] = 0.0004;
      sc[v] = sc[v + 1] = sc[v + 2] = 0;
      sc[v + 3] = Math.min(1, z / 0.035) * 0.5;
    }
    shadowGeo.attributes.position.needsUpdate = true;
    shadowGeo.attributes.color.needsUpdate = true;
    shadowGeo.computeBoundingSphere();
    shadow.visible = a > 0;
    if (qrMesh) qrMesh.visible = a > 0;
    dirty = false;
  }

  // The hint: one sticker rests with a corner just lifted.
  const hc = [[-1, -1], [1, -1], [1, 1], [-1, 1]][Math.floor(rand() * 4)];
  setCorner((hc[0] * b.width) / 2, (hc[1] * b.height) / 2);
  rest = hint;
  a = rest;
  deform();

  /** The flap angle that goes with a fold distance, on the way up (pull) or down (heal): the same curve, so a
   *  heal is the peel run backwards. The last stretch eases down to the resting lift angle. */
  function angleFor(fold: number) {
    const x = maxA ? Math.min(1, fold / maxA) : 0;
    const w = Math.min(1, x / 0.12);
    const pulled = PULL_ANGLE[0] + (LATCH_ANGLE - PULL_ANGLE[0]) * x;
    return REST_ANGLE + (pulled - REST_ANGLE) * w * w * (3 - 2 * w);
  }

  /**
   * The flap lays back down by reversing the peel: the fold line travels back to the corner while the angle
   * follows `angleFor` (driven by the same number, so the two can't drift apart). `ease` and `seconds` set
   * the character: a deliberate heal eases in and out; a flap let go springs back, fast at first.
   */
  let healing = false;
  const baseScale = (box.hw * 2) / b.width;
  function lay(onSettled: (() => void) | undefined, gentle: boolean, seconds: number, ease: string) {
    settle?.kill();
    healing = true;
    const p = { a };
    settle = gsap.to(p, {
      a: rest,
      duration: gentle ? Math.min(seconds, GENTLE) : seconds,
      ease: gentle ? 'power2.out' : ease,
      onUpdate: () => {
        a = p.a;
        angle = angleTo = angleFor(a);
        dirty = true;
      },
      onComplete: () => {
        healing = false;
        a = rest;
        angle = angleTo = REST_ANGLE;
        dirty = true;
        if (!gentle) {
          // It touches down: a barely-there press into the plate.
          gsap.timeline()
            .to(group.scale, { x: baseScale * 0.992, y: baseScale * 0.992, duration: 0.07, ease: 'power2.out' })
            .to(group.scale, { x: baseScale, y: baseScale, duration: 0.18, ease: 'power3.out' });
        }
        onSettled?.();
      },
    });
  }

  const self: Sticker = {
    mesh,
    group,
    name: spec.name,
    url: spec.url,
    host: new URL(spec.url).host.replace(/^www\./, ''),
    qr: qrMesh,
    beginPeel(worldPoint) {
      settle?.kill();
      healing = false;
      mesh.worldToLocal(tmp.copy(worldPoint));
      grab.set(tmp.x, tmp.y);
      // Lift the corner nearest to where it was grabbed.
      setCorner(Math.sign(grab.x || 1) * (b.width / 2), Math.sign(grab.y || 1) * (b.height / 2));
      a = Math.max(a, 0.004);
      angleTo = PULL_ANGLE[0];
      dirty = true;
    },
    drag(ray) {
      // Where the pointer meets the sticker's resting plane, in sticker space.
      mesh.updateWorldMatrix(true, false);
      plane.setFromNormalAndCoplanarPoint(tmp.set(0, 0, 1).transformDirection(mesh.matrixWorld), mesh.getWorldPosition(new THREE.Vector3()));
      const hit = ray.intersectPlane(plane, new THREE.Vector3());
      if (!hit) return maxA ? a / maxA : 0;
      mesh.worldToLocal(hit);
      const dx = hit.x - grab.x;
      const dy = hit.y - grab.y;
      // Pulling toward the centre peels most; any pull lifts a little. The fold line runs at a bit
      // over half the pull, which keeps the rolled-back tip near the pointer. Resistance grows toward
      // the limit (rubber band), so the last stretch takes more and more effort and then stops.
      const raw = Math.max(0, dx * u.x + dy * u.y) * 0.55 + Math.hypot(dx, dy) * 0.2;
      a = Math.max(0.004, maxA * (1 - Math.exp(-raw / (maxA * RESIST))));
      angleTo = PULL_ANGLE[0] + (PULL_ANGLE[1] - PULL_ANGLE[0]) * (a / maxA);
      dirty = true;
      return a / maxA;
    },
    isOpen: () => open,
    release(onSettled, gentle = false) {
      settle?.kill();
      if (maxA > 0 && a / maxA >= COMMIT) {
        // Pulled to the end: the flap stays rolled back and the QR beneath is showing.
        open = true;
        angleTo = LATCH_ANGLE;
        const p = { a };
        settle = gsap.to(p, {
          a: maxA,
          duration: gentle ? 0.2 : 0.35,
          ease: 'power3.out',
          onUpdate: () => {
            a = p.a;
            dirty = true;
          },
        });
        return true;
      }
      lay(onSettled, gentle, SETTLE, 'power3.out');
      return false;
    },
    heal(onSettled, gentle = false) {
      open = false;
      const x = maxA ? Math.min(1, a / maxA) : 0;
      lay(onSettled, gentle, 0.35 + (HEAL_FULL - 0.35) * x, 'power2.inOut'); // the further it has to go, the longer
    },
    update(dt) {
      if (!healing && Math.abs(angleTo - angle) > 1e-3) {
        angle += (angleTo - angle) * (1 - Math.exp(-dt / ANGLE_TAU));
        dirty = true;
      }
      if (dirty) deform();
    },
  };
  mesh.userData.sticker = self;
  underside.userData.sticker = self;
  if (qrHit) qrHit.userData.qrOf = self;
  return self;
}

/**
 * Builds the three stickers (async: the SVGs load first) and places them at random on the back plate
 * of `root`, at `backZ` (the plate's outer face, root space). Resolves with a group to add to `root`.
 */
export async function createStickers(
  backZ: number,
  envMap: THREE.Texture | null,
  /** Awaited between stickers: each one's textures are ~0.5 s of pixel work, so frames get a turn in between. */
  pause: () => Promise<void> = () => Promise.resolve(),
): Promise<{ group: THREE.Group; stickers: Sticker[] }> {
  const rand = Math.random;
  const built: Built[] = [];
  for (const s of STICKERS) {
    built.push(await buildTextures(s, rand));
    await pause();
  }
  const boxes = place(built.map((b, i) => ({ hw: b.width / 2, hh: b.height / 2, tilt: STICKERS[i].tilt })), rand);
  const hintIndex = Math.floor(rand() * built.length);
  const group = new THREE.Group();
  group.name = 'back-stickers';
  const stickers: Sticker[] = [];
  built.forEach((b, i) => {
    const box = boxes[i];
    if (!box) return;
    const s = makeSticker(b, STICKERS[i], box, backZ - 0.0012 - i * 0.0003, envMap, i === hintIndex ? 0.022 : 0, rand);
    group.add(s.group);
    stickers.push(s);
  });
  return { group, stickers };
}
