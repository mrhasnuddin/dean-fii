// Stickers on the wallet's back plate (an easter egg): die-cut vinyl stickers of three logos with a
// holographic foil border, placed at random on every visit. Grab one and its nearest corner peels up
// with a real curl (showing the adhesive side), harder the further it goes, and never past ~70 %;
// let go and it lays back down.
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
  /** Printed logo width, W (the border adds to it). */
  width: number;
  /** Max random rotation, radians. */
  tilt: number;
}

export const STICKERS: StickerSpec[] = [
  { src: '/OC.svg', width: 0.36, tilt: 0.3 },
  { src: '/aseanlabs.svg', width: 0.25, tilt: 0.45 },
  { src: '/mydac.svg', width: 0.19, tilt: 0.5 },
];

const BODY_PAD = 0.012; // vinyl around the print (W)
const BORDER = 0.016; // holographic foil border (W)
const PX_PER_W = 1600; // texture resolution
const SEG = 48; // plane subdivisions per side (peel smoothness)
const CURL_R = 0.014; // curl radius (W): how stiff the vinyl is
const MAX_FRACTION = 0.7; // how far along the peel direction it can go
// Peel angle (0 = flat, π = folded flat back over itself). A corner that has come unstuck stands up
// at a shallow angle; one being pulled rolls back past vertical, so the viewer sees its adhesive
// side (at ~90° the flap is edge-on to a camera looking at the back, and simply vanishes).
const REST_ANGLE = 0.75;
const PULL_ANGLE = [1.85, 2.8] as const; // just grabbed → at the limit
const ANGLE_TAU = 0.07; // s: the flap swings to its new angle instead of snapping

export interface Sticker {
  mesh: THREE.Mesh; // front (print) side; raycast target (userData.sticker = this)
  group: THREE.Group;
  beginPeel(worldPoint: THREE.Vector3): void;
  /** Pointer ray while dragging. Returns the peel fraction 0..1 (of the allowed maximum). */
  drag(ray: THREE.Ray): number;
  /** Let go: it lays back down (`instant` under reduced motion). */
  release(onSettled?: () => void, instant?: boolean): void;
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

interface Built {
  art: THREE.CanvasTexture; // RGBA: foil base / vinyl / print; alpha = die-cut
  surface: THREE.CanvasTexture; // R iridescence, G roughness, B metalness
  bump: THREE.CanvasTexture;
  alpha: THREE.CanvasTexture; // die-cut for the adhesive side
  width: number; // W incl. border
  height: number;
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
  return { art: tex(art, true), surface: tex(surf), bump: tex(bump), alpha: tex(al), width, height };
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
function makeSticker(b: Built, box: Box, z: number, envMap: THREE.Texture | null, hint: number, rand: () => number): Sticker {
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
  underside.raycast = () => {}; // the front mesh is the one hit target
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

  const group = new THREE.Group();
  group.add(mesh, underside, shadow);
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
    dirty = false;
  }

  // The hint: one sticker rests with a corner just lifted.
  const hc = [[-1, -1], [1, -1], [1, 1], [-1, 1]][Math.floor(rand() * 4)];
  setCorner((hc[0] * b.width) / 2, (hc[1] * b.height) / 2);
  rest = hint;
  a = rest;
  deform();

  const self: Sticker = {
    mesh,
    group,
    beginPeel(worldPoint) {
      settle?.kill();
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
      a = Math.max(0.004, maxA * (1 - Math.exp(-raw / maxA)));
      angleTo = PULL_ANGLE[0] + (PULL_ANGLE[1] - PULL_ANGLE[0]) * (a / maxA);
      dirty = true;
      return a / maxA;
    },
    release(onSettled, instant = false) {
      settle?.kill();
      angleTo = REST_ANGLE;
      if (instant) angle = REST_ANGLE;
      const p = { a };
      // Vinyl springs back fast: most of the travel lands in the first ~100 ms.
      settle = gsap.to(p, {
        a: rest,
        duration: instant ? 0 : 0.28,
        ease: 'power3.out',
        onUpdate: () => {
          a = p.a;
          dirty = true;
        },
        onComplete: onSettled,
      });
    },
    update(dt) {
      if (Math.abs(angleTo - angle) > 1e-3) {
        angle += (angleTo - angle) * (1 - Math.exp(-dt / ANGLE_TAU));
        dirty = true;
      }
      if (dirty) deform();
    },
  };
  mesh.userData.sticker = self;
  return self;
}

/**
 * Builds the three stickers (async: the SVGs load first) and places them at random on the back plate
 * of `root`, at `backZ` (the plate's outer face, root space). Resolves with a group to add to `root`.
 */
export async function createStickers(backZ: number, envMap: THREE.Texture | null): Promise<{ group: THREE.Group; stickers: Sticker[] }> {
  const rand = Math.random;
  const built = await Promise.all(STICKERS.map((s) => buildTextures(s, rand)));
  const boxes = place(built.map((b, i) => ({ hw: b.width / 2, hh: b.height / 2, tilt: STICKERS[i].tilt })), rand);
  const hintIndex = Math.floor(rand() * built.length);
  const group = new THREE.Group();
  group.name = 'back-stickers';
  const stickers: Sticker[] = [];
  built.forEach((b, i) => {
    const box = boxes[i];
    if (!box) return;
    const s = makeSticker(b, box, backZ - 0.0012 - i * 0.0003, envMap, i === hintIndex ? 0.022 : 0, rand);
    group.add(s.group);
    stickers.push(s);
  });
  return { group, stickers };
}
