// Dean's NFC key card: the object tapped on the wallet in the Contact section.
// Follows the recovery-key card language (matte black soft-touch, marks clustered at two opposite
// corners, a framed centre) but in Dean's branding: the four-point star from the D-star mark replaces
// the "+" marks, four larger stars replace corner brackets (Ledger's logo motif), and "DEAN STUDIO"
// sits in the frame. Contact details are written inside the frame (CSS3D HTML at `labelAnchor`).
// Units: W (wallet body width = 1). Card 0.81 × 0.81 × 0.02 W.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { D_PATH, LOGO_CENTER, STAR_PATH } from '../brand/logo';
import { roundedRectShape } from './walletRefine';

export const CARD = {
  size: 0.81,
  thickness: 0.02,
  radius: 0.035,
  /** Details panel, centred in the frame just below the engraved studio name. */
  label: { w: 0.56, h: 0.3, y: -0.05 },
} as const;

type Face = 'front' | 'back';
type Channel = 'color' | 'rough' | 'bump';
const TEX = 1024;

// Card-space layout in 0..1 texture units (y down).
const FRAME_INSET = 0.13; // corner stars sit on this inset
const CELL = 0.053; // pattern pitch: clusters reach ~⅓ across, like the reference card
const TL_ROWS = [6, 5, 3, 2, 2, 1]; // stepped cluster, fading away from the corner (mirrored bottom-right)

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
  const img = ctx.getImageData(0, 0, TEX, TEX);
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
  const s = TEX;
  ctx.fillStyle = FIELD[ch];
  ctx.fillRect(0, 0, s, s);
  grain(ctx, ch);

  ctx.filter = ch === 'bump' ? 'blur(1px)' : 'none';
  ctx.fillStyle = MARK[ch];
  const mark = CELL * s * 0.5;
  // Two stepped clusters at opposite corners (top-left, bottom-right), like the reference card.
  TL_ROWS.forEach((count, row) => {
    for (let i = 0; i < count; i++) {
      const x = (0.045 + i * CELL) * s;
      const y = (0.045 + row * CELL) * s;
      star(ctx, x, y, mark);
      star(ctx, s - x, s - y, mark);
    }
  });
  // Four larger stars mark the frame corners (instead of bracket corners).
  for (const [fx, fy] of [[FRAME_INSET, FRAME_INSET], [1 - FRAME_INSET, FRAME_INSET], [FRAME_INSET, 1 - FRAME_INSET], [1 - FRAME_INSET, 1 - FRAME_INSET]]) {
    star(ctx, fx * s, fy * s, mark * 2.6);
  }

  ctx.fillStyle = INK[ch];
  if (face === 'front') {
    ctx.font = `600 ${Math.round(s * 0.026)}px ui-monospace, Consolas, monospace`;
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${Math.round(s * 0.012)}px`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DEAN STUDIO', s / 2, s * 0.29);
  } else {
    // Back: a small debossed D-star, centred (the side seen while the card is pressed to the wallet).
    const k = (s * 0.16) / 100;
    ctx.save();
    ctx.translate(s / 2 - LOGO_CENTER.x * k, s / 2 - LOGO_CENTER.y * k);
    ctx.scale(k, k);
    ctx.fill(new Path2D(D_PATH));
    ctx.fill(new Path2D(STAR_PATH));
    ctx.restore();
  }
  ctx.filter = 'none';
}

function faceTexture(face: Face, ch: Channel): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  drawFace(c.getContext('2d', { willReadFrequently: true })!, face, ch);
  const t = new THREE.CanvasTexture(c);
  if (ch === 'color') t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Rounded-square face plate with UVs mapped 0..1 across the card (ShapeGeometry UVs are shape coords).
 * The back plate is the same geometry turned 180° about Y, so its texture reads correctly from behind
 * without flipping u (flipping as well would mirror it).
 */
function facePlate(face: Face, material: THREE.Material): THREE.Mesh {
  const size = CARD.size - 0.004;
  const g = new THREE.ShapeGeometry(roundedRectShape(size, size, CARD.radius - 0.002), 12);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const u = pos.getX(i) / size + 0.5;
    uv.setXY(i, u, pos.getY(i) / size + 0.5);
  }
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
    new RoundedBoxGeometry(CARD.size, CARD.size, CARD.thickness, 4, 0.006),
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
