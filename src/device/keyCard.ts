// Dean's key card: it goes into the wallet's card reader in the Contact section and comes back out
// with Dean's details written on it (docs/device-design.md §10).
// Follows the recovery-key card language (matte black soft-touch, marks clustered at two opposite
// corners, a framed centre) but in Dean's branding: the four-point star from the D-star mark replaces
// the "+" marks, four larger stars replace corner brackets (Ledger's logo motif), and "DEAN STUDIO"
// sits in the frame. Contact details are written inside the frame (CSS3D HTML at `labelAnchor`).
// Units: W (wallet body width = 1). Bank-card proportions (ISO ID-1 ratio): 0.86 × 0.54 × 0.02 W.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { D_PATH, LOGO_CENTER, STAR_PATH } from '../brand/logo';
import { roundedRectShape } from './walletRefine';

export const CARD = {
  w: 0.86,
  h: 0.54,
  thickness: 0.02,
  radius: 0.035,
  /** Details panel, centred in the frame just below the engraved studio name (height set by the HTML). */
  label: { w: 0.46, y: -0.05 },
} as const;

type Face = 'front' | 'back';
type Channel = 'color' | 'rough' | 'bump';
const TEX_W = 1024;
const TEX_H = 640; // 0.54 / 0.86 of the width
const PX = TEX_W / CARD.w; // texture px per W

// Card-space layout in W, from the top-left corner (y down).
const FRAME_INSET = 0.105; // corner stars sit this far in from both edges
const CELL = 0.043; // pattern pitch (same star spacing as the square card)
// Stepped clusters, fading away from the corner (mirrored bottom-right). Wider and shallower than on
// the square card so they still reach about a third across without crowding the short side.
const TL_ROWS = [8, 6, 3, 1];

// Charcoal, not pure black: the reference card reads mid-dark grey under light, and a near-black card
// vanished against the #0f1014 page in the first render.
const FIELD: Record<Channel, string> = { color: '#2a2b30', rough: '#dcdcdc', bump: '#808080' }; // matte ≈ 0.86
const MARK: Record<Channel, string> = { color: '#55565e', rough: '#6e6e6e', bump: '#b4b4b4' }; // spot-gloss, slightly raised
const INK: Record<Channel, string> = { color: '#7a7b83', rough: '#9a9a9a', bump: '#5a5a5a' }; // engraved text: recessed

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  // STAR_PATH spans 24 units centred on (80, 17) in the logo's 100-unit box.
  const k = size / 24;
  ctx.save();
  ctx.translate(cx - 80 * k, cy - 17 * k);
  ctx.scale(k, k);
  ctx.fill(new Path2D(STAR_PATH));
  ctx.restore();
}

/** Soft-touch grain: deterministic speckle (seeded), so every reload renders the same surface. */
function grain(ctx: CanvasRenderingContext2D, ch: Channel): void {
  if (ch === 'color') return;
  let seed = 42;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const img = ctx.getImageData(0, 0, TEX_W, TEX_H);
  const amp = ch === 'bump' ? 26 : 14;
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * amp;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function drawFace(ctx: CanvasRenderingContext2D, face: Face, ch: Channel): void {
  const W = TEX_W;
  const H = TEX_H;
  ctx.fillStyle = FIELD[ch];
  ctx.fillRect(0, 0, W, H);
  grain(ctx, ch);

  ctx.filter = ch === 'bump' ? 'blur(1px)' : 'none';
  ctx.fillStyle = MARK[ch];
  const mark = CELL * PX * 0.5;
  // Two stepped clusters at opposite corners (top-left, bottom-right), like the reference card.
  TL_ROWS.forEach((count, row) => {
    for (let i = 0; i < count; i++) {
      const x = (0.036 + i * CELL) * PX;
      const y = (0.036 + row * CELL) * PX;
      star(ctx, x, y, mark);
      star(ctx, W - x, H - y, mark);
    }
  });
  // Four larger stars mark the frame corners (instead of bracket corners).
  const fi = FRAME_INSET * PX;
  for (const [fx, fy] of [[fi, fi], [W - fi, fi], [fi, H - fi], [W - fi, H - fi]]) star(ctx, fx, fy, mark * 2.6);

  ctx.fillStyle = INK[ch];
  if (face === 'front') {
    ctx.font = `600 ${Math.round(W * 0.026)}px ui-monospace, Consolas, monospace`;
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${Math.round(W * 0.012)}px`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DEAN STUDIO', W / 2, H * 0.3);
  } else {
    // Back: a small debossed D-star, centred.
    const k = (H * 0.2) / 100;
    ctx.save();
    ctx.translate(W / 2 - LOGO_CENTER.x * k, H / 2 - LOGO_CENTER.y * k);
    ctx.scale(k, k);
    ctx.fill(new Path2D(D_PATH));
    ctx.fill(new Path2D(STAR_PATH));
    ctx.restore();
  }
  ctx.filter = 'none';
}

function faceTexture(face: Face, ch: Channel): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = TEX_W;
  c.height = TEX_H;
  drawFace(c.getContext('2d', { willReadFrequently: true })!, face, ch);
  const t = new THREE.CanvasTexture(c);
  if (ch === 'color') t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Rounded-rectangle face plate with UVs mapped 0..1 across the card (ShapeGeometry UVs are shape coords).
 * The back plate is the same geometry turned 180° about Y, so its texture reads correctly from behind
 * without flipping u (flipping as well would mirror it).
 */
function facePlate(face: Face, material: THREE.Material): THREE.Mesh {
  const w = CARD.w - 0.004;
  const h = CARD.h - 0.004;
  const g = new THREE.ShapeGeometry(roundedRectShape(w, h, CARD.radius - 0.002), 12);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
  const m = new THREE.Mesh(g, material);
  m.name = `key-card-${face}`;
  m.position.z = (face === 'front' ? 1 : -1) * (CARD.thickness / 2 + 0.0002);
  if (face === 'back') m.rotation.y = Math.PI;
  return m;
}

function faceMaterial(face: Face, envMap: THREE.Texture | null): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    name: `key-card-${face}-matte`,
    map: faceTexture(face, 'color'),
    color: '#ffffff',
    roughness: 1,
    roughnessMap: faceTexture(face, 'rough'),
    bumpMap: faceTexture(face, 'bump'),
    bumpScale: 0.5,
    metalness: 0,
    sheen: 0.25, // soft-touch coatings scatter a faint velvet sheen at grazing angles
    sheenRoughness: 0.8,
    sheenColor: '#3a3b44',
    envMap,
    envMapIntensity: 0.8,
  });
}

export interface KeyCard {
  group: THREE.Group;
  /** Centre of the details panel inside the frame, +Z facing; parent the CSS3D details here. */
  labelAnchor: THREE.Object3D;
  dispose(): void;
}

export function createKeyCard(envMap: THREE.Texture | null = null): KeyCard {
  const group = new THREE.Group();
  group.name = 'key-card';

  const edge = new THREE.Mesh(
    new RoundedBoxGeometry(CARD.w, CARD.h, CARD.thickness, 4, 0.006),
    new THREE.MeshStandardMaterial({ name: 'key-card-edge', color: '#202125', roughness: 0.75, metalness: 0, envMap, envMapIntensity: 0.8 }),
  );
  edge.name = 'key-card-body';
  group.add(edge, facePlate('front', faceMaterial('front', envMap)), facePlate('back', faceMaterial('back', envMap)));

  const labelAnchor = new THREE.Object3D();
  labelAnchor.name = 'key-card-label-anchor';
  labelAnchor.position.set(0, CARD.label.y, CARD.thickness / 2 + 0.0008);
  group.add(labelAnchor);

  return {
    group,
    labelAnchor,
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        const mat = m.material as THREE.MeshStandardMaterial;
        for (const tex of [mat.map, mat.roughnessMap, mat.bumpMap]) tex?.dispose();
        mat.dispose();
      });
    },
  };
}
