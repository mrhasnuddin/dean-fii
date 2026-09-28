// Canvas-generated maps for the keychain coin: an engraved (recessed, matte, darkened) D-star on a
// polished field. Front carries the full mark; back carries the star and the studio name.
import * as THREE from 'three';
import { D_PATH, LOGO_CENTER, STAR_PATH } from '../brand/logo';

type Face = 'front' | 'back';
type Channel = 'color' | 'bump' | 'rough';

const SIZE = 1024;
const FIELD: Record<Channel, string> = { color: '#e6cd97', bump: '#ffffff', rough: '#3a3a3a' };
const RECESS: Record<Channel, string> = { color: '#8a6a3a', bump: '#000000', rough: '#b4b4b4' };

function drawFace(ctx: CanvasRenderingContext2D, face: Face, ch: Channel): void {
  ctx.fillStyle = FIELD[ch];
  ctx.fillRect(0, 0, SIZE, SIZE);
  if (ch === 'rough') speckle(ctx);

  // Softened edges on the height map read as bevelled engraving walls.
  ctx.filter = ch === 'bump' ? 'blur(3px)' : 'none';
  ctx.fillStyle = RECESS[ch];
  ctx.strokeStyle = RECESS[ch];

  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, SIZE * 0.458, 0, Math.PI * 2);
  ctx.stroke();

  if (face === 'front') {
    const k = (SIZE * 0.6) / 100;
    ctx.save();
    ctx.translate(SIZE / 2 - LOGO_CENTER.x * k, SIZE / 2 - LOGO_CENTER.y * k);
    ctx.scale(k, k);
    ctx.fill(new Path2D(D_PATH));
    ctx.fill(new Path2D(STAR_PATH));
    ctx.restore();
  } else {
    const k = (SIZE * 0.22) / 24; // the star alone spans 24 units
    ctx.save();
    ctx.translate(SIZE / 2 - 80 * k, SIZE / 2 - 17 * k);
    ctx.scale(k, k);
    ctx.fill(new Path2D(STAR_PATH));
    ctx.restore();
    arcText(ctx, 'DEAN  STUDIO', SIZE * 0.36);
  }
  ctx.filter = 'none';
}

function arcText(ctx: CanvasRenderingContext2D, text: string, radius: number): void {
  ctx.font = '600 58px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = 0.105;
  const start = -Math.PI / 2 - ((text.length - 1) * step) / 2;
  [...text].forEach((c, i) => {
    const a = start + i * step;
    ctx.save();
    ctx.translate(SIZE / 2 + Math.cos(a) * radius, SIZE / 2 + Math.sin(a) * radius);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillText(c, 0, 0);
    ctx.restore();
  });
}

// Fine micro-scratch variation so the polished field doesn't look like plastic.
function speckle(ctx: CanvasRenderingContext2D): void {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  ctx.globalAlpha = 0.18;
  for (let i = 0; i < 2600; i++) {
    const v = 40 + Math.floor(rand() * 60);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(rand() * SIZE, rand() * SIZE, 1 + rand() * 18, 1);
  }
  ctx.globalAlpha = 1;
}

function texture(face: Face, ch: Channel): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  drawFace(c.getContext('2d')!, face, ch);
  const t = new THREE.CanvasTexture(c);
  if (ch === 'color') t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function coinFaceMaps(face: Face) {
  return { map: texture(face, 'color'), bumpMap: texture(face, 'bump'), roughnessMap: texture(face, 'rough') };
}

/** Milled (reeded) edge: vertical ridges around the coin's rim band. */
export function reedingMap(ridges = 180): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 2;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 16, 2);
  ctx.fillStyle = '#000';
  ctx.fillRect(8, 0, 8, 2);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(ridges, 1);
  return t;
}
