// The memory card (docs/device-design.md §34), now the archive cartridge: it goes into a slot in the bottom edge
// when the archive page opens, and comes back out when it closes. The same family as the contact card (matte
// graphite, a printed label), but a small SD-style card: notched corner, gold contacts on its leading end, a
// champagne label. Units: W (device body width = 1). Card space: +Y is the leading (inserted) end, +Z the front.
import * as THREE from 'three';
import { archiveWorks } from '../content/portfolio';
import { roundedRectShape } from './shapes';

export const MEMORY = {
  w: 0.21,
  h: 0.29,
  t: 0.02,
  /** How far into the body it goes; the rest (h − inside = 0.13 W) is left to hold. */
  inside: 0.16,
  /** x of the slot on the bottom face. */
  x: -0.3,
} as const;

function cardShape(): THREE.Shape {
  const w = MEMORY.w / 2;
  const h = MEMORY.h / 2;
  const r = 0.014;
  const c = 0.05; // the SD notch on the leading end's corner
  const s = new THREE.Shape();
  s.moveTo(-w + r, -h);
  s.lineTo(w - r, -h);
  s.absarc(w - r, -h + r, r, -Math.PI / 2, 0, false);
  s.lineTo(w, h - r);
  s.absarc(w - r, h - r, r, 0, Math.PI / 2, false);
  s.lineTo(-w + c, h);
  s.lineTo(-w, h - c);
  s.lineTo(-w, -h + r);
  s.absarc(-w + r, -h + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** The printed label: DEAN STUDIO small, ARCHIVE large, how many projects it holds; transparent around it. */
function labelTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 384; // 0.17 × 0.126 W
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')! as CanvasRenderingContext2D & { letterSpacing: string };
  ctx.fillStyle = '#e3c894';
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, 34);
  ctx.fill();
  ctx.fillStyle = '#1d1c1a';
  ctx.textBaseline = 'middle';
  ctx.font = '600 30px ui-monospace, Consolas, monospace';
  ctx.letterSpacing = '5px';
  ctx.fillText('DEAN STUDIO', 40, 70);
  ctx.font = '700 84px ui-monospace, Consolas, monospace';
  ctx.letterSpacing = '2px';
  ctx.fillText('ARCHIVE', 40, 190);
  // how many projects it holds, in a ring
  ctx.beginPath();
  ctx.arc(W - 100, H - 90, 46, 0, Math.PI * 2);
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#1d1c1a';
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.font = '700 44px ui-monospace, Consolas, monospace';
  ctx.letterSpacing = '0px';
  ctx.fillText(`+${archiveWorks.length}`, W - 100, H - 88);
  ctx.textAlign = 'left';
  ctx.font = '500 24px ui-monospace, Consolas, monospace';
  ctx.letterSpacing = '3px';
  ctx.fillText(`${archiveWorks.length} PROJECTS`, 40, H - 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** The card, centred on its own origin. */
export function createMemoryCard(envMap: THREE.Texture | null): THREE.Group {
  const g = new THREE.Group();
  g.name = 'memory-card';
  const b = 0.003;
  const body = new THREE.Mesh(
    new THREE.ExtrudeGeometry(cardShape(), {
      depth: MEMORY.t - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 12,
    }).translate(0, 0, -MEMORY.t / 2 + b),
    new THREE.MeshStandardMaterial({ color: '#2b2c32', roughness: 0.72, metalness: 0.1, envMap }),
  );
  body.name = 'memory-card-body';
  g.add(body);

  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(0.17, 0.126),
    new THREE.MeshStandardMaterial({ map: labelTexture(), transparent: true, roughness: 0.5, metalness: 0.3, envMap }),
  );
  label.position.set(0, -0.055, MEMORY.t / 2 + 0.0003);
  g.add(label);

  // Gold contacts on the leading end (seen while it flies in, hidden once it is home).
  const gold = new THREE.MeshStandardMaterial({ color: '#d8b66a', metalness: 1, roughness: 0.25, envMap });
  for (let i = 0; i < 7; i++) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.0125, 0.05), gold);
    strip.position.set(-0.066 + i * 0.0225, MEMORY.h / 2 - 0.04, MEMORY.t / 2 + 0.0003);
    g.add(strip);
  }
  g.traverse((o) => (o.userData.explodeWithParent = true));
  return g;
}

/** The slot's opening on the bottom face (add at the slot socket): a champagne lip round a dark mouth. */
export function createMemorySlot(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'memory-slot';
  const lipShape = roundedRectShape(MEMORY.w + 0.034, MEMORY.t + 0.032, 0.012);
  lipShape.holes.push(roundedRectShape(MEMORY.w + 0.012, MEMORY.t + 0.012, 0.007) as unknown as THREE.Path);
  const lip = new THREE.Mesh(
    new THREE.ShapeGeometry(lipShape, 6),
    new THREE.MeshStandardMaterial({ color: '#e3c894', metalness: 1, roughness: 0.3, envMapIntensity: 1.7, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  const mouth = new THREE.Mesh(
    new THREE.ShapeGeometry(roundedRectShape(MEMORY.w + 0.012, MEMORY.t + 0.012, 0.007), 6),
    new THREE.MeshBasicMaterial({ color: '#040405', polygonOffset: true, polygonOffsetFactor: -3 }),
  );
  for (const m of [lip, mouth]) {
    m.rotation.x = Math.PI / 2; // shape XY → faces −Y (out of the bottom face)
    m.position.y = -0.0004;
    g.add(m);
  }
  return g;
}
