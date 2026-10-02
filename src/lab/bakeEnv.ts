// Bakes the studio environment (docs/device-design.md §23): renders it with the PMREM generator, packs the
// half-float pixels as RGBE bytes (shared exponent, ~0.4 % error), splits them into four planes, delta-codes
// each and deflates the lot; the dev server stores it as src/device/generated/studio-env.bin.
// "Verify" decodes that file with the site's own loader and compares it with a fresh render.
import * as THREE from 'three';
import { ENV_H, ENV_W, loadBakedEnvironment, renderStudioEnvironment } from '../device/studioEnvironment';

const out = document.getElementById('out')!;
const log = (s: string) => (out.textContent += s + '\n');
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c') as HTMLCanvasElement });
const PIXELS = ENV_W * ENV_H;

function pixels(target: THREE.WebGLRenderTarget): Float32Array {
  if (target.width !== ENV_W || target.height !== ENV_H) throw new Error(`unexpected PMREM size ${target.width}×${target.height}`);
  const half = new Uint16Array(PIXELS * 4);
  renderer.readRenderTargetPixels(target, 0, 0, ENV_W, ENV_H, half);
  return Float32Array.from(half, THREE.DataUtils.fromHalfFloat);
}

async function bake() {
  const rgba = pixels(renderStudioEnvironment(renderer));
  const planes = new Uint8Array(PIXELS * 4);
  for (let i = 0; i < PIXELS; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const m = Math.max(r, g, b);
    if (!(m > 1e-9)) continue; // exponent 0 decodes to black
    const e = Math.ceil(Math.log2(m * (1 + 1e-9))); // m < 2^e, so the mantissas stay below 256
    const k = 256 / 2 ** e;
    planes[i] = Math.min(255, Math.floor(r * k));
    planes[PIXELS + i] = Math.min(255, Math.floor(g * k));
    planes[2 * PIXELS + i] = Math.min(255, Math.floor(b * k));
    planes[3 * PIXELS + i] = e + 128;
  }
  for (let p = 0; p < 4; p++) {
    let prev = 0;
    for (let i = p * PIXELS, end = i + PIXELS; i < end; i++) {
      const v = planes[i];
      planes[i] = (v - prev) & 255;
      prev = v;
    }
  }
  const zipped = new Uint8Array(await new Response(new Blob([planes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const res = await fetch('/__bake-env', { method: 'POST', body: zipped });
  log(`baked ${zipped.length.toLocaleString()} bytes (raw half-float: ${(PIXELS * 8).toLocaleString()}): ${await res.text()}`);
}

async function verify() {
  const baked = await loadBakedEnvironment();
  if (!baked) return log('no baked file could be loaded');
  const got = (baked as THREE.DataTexture).image.data as Uint16Array;
  const want = pixels(renderStudioEnvironment(renderer));
  let worst = 0, sumRel = 0, n = 0, maxWant = 0;
  for (let i = 0; i < PIXELS; i++) {
    for (let c = 0; c < 3; c++) {
      const w = want[i * 4 + c];
      const d = Math.abs(THREE.DataUtils.fromHalfFloat(got[i * 4 + c]) - w);
      worst = Math.max(worst, d);
      maxWant = Math.max(maxWant, w);
      if (w > 0.01) (sumRel += d / w), n++;
    }
  }
  log(`brightest texel ${maxWant.toFixed(2)}; worst absolute error ${worst.toFixed(4)}; mean relative error ${((100 * sumRel) / n).toFixed(3)} % over ${n.toLocaleString()} components`);
}

document.getElementById('bake')!.addEventListener('click', () => bake().catch((e) => log(String(e))));
document.getElementById('verify')!.addEventListener('click', () => verify().catch((e) => log(String(e))));
