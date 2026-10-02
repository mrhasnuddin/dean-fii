// Dark product-studio environment for the site (lighting pass). RoomEnvironment is a bright grey room:
// it greys out black glass and flattens metal on a dark page. This is a black room with three HDR
// softboxes, so reflections read as crisp light bands on glass, foil and champagne metal.
//
// Generating it (PMREM) compiles three shaders and took ~1.6 s of a blocked main thread on every first
// load, so the site ships the result instead: generated/studio-env.bin, written by lab/bake-env.html
// (docs/device-design.md §23). `loadBakedEnvironment` decodes it in a few ms; `createStudioEnvironment`
// stays as the generator for the labs, for the bake, and as the fallback.
import * as THREE from 'three';
import envUrl from './generated/studio-env.bin?url';

function softbox(w: number, h: number, color: string, intensity: number, pos: [number, number, number], look: [number, number, number]) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
  );
  m.position.set(...pos);
  m.lookAt(...look);
  return m;
}

/** The PMREM render target (256 px cube faces, CubeUV layout: 768 × 1024, half-float RGBA). */
export function renderStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const room = new THREE.Scene();
  // A near-black room left metal with nothing to reflect between softboxes (key card read black at
  // most angles). A dim base plus a broad overhead panel keeps metal and foil alive; the page
  // background the visitor sees is separate and stays dark.
  room.background = new THREE.Color('#1c1d22');
  room.add(
    softbox(10, 10, '#ffffff', 0.9, [0, 6, 0], [0, 0, 0]), // overhead: broad, dim
    softbox(6, 3.2, '#ffffff', 5.5, [-4, 4.5, 5], [0, 0, 0]), // key: large, upper left front
    softbox(1.2, 7, '#b9a6ff', 3.2, [5.5, 0.5, -2], [0, 0, 0]), // rim: tall cool strip, right back
    softbox(8, 1.5, '#e8d2a4', 0.9, [0, -5, 2], [0, 0, 0]), // bounce: faint warm floor
    softbox(2.4, 2.4, '#ffffff', 2.2, [3, 3.5, 4.5], [0, 0, 0]), // fill: small upper right
  );
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(room, 0.02);
  pmrem.dispose();
  room.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
  return target;
}

export function createStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  return renderStudioEnvironment(renderer).texture;
}

// ---------------------------------------------------------------- baked file
export const ENV_W = 768;
export const ENV_H = 1024;
const PIXELS = ENV_W * ENV_H;

/** Undoes the delta coding and the RGBE packing into half-float RGBA. Its own function, not inside the
 *  async loader: a loop in a resumed async function stays in V8's interpreter (~10× slower). */
function unpack(planes: Uint8Array): Uint16Array {
  // Half-float bits of (m + 0.5) for every mantissa byte; scaling by 2^k is then just adding k to the
  // half's exponent field, so a texel costs three lookups and adds (no float maths in the loop).
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  const mant = new Uint16Array(256);
  for (let m = 0; m < 256; m++) {
    f32[0] = m + 0.5;
    mant[m] = ((u32[0] + 0x1000) >>> 13) - (112 << 10);
  }
  const half = new Uint16Array(PIXELS * 4);
  let r = 0, g = 0, b = 0, e = 0; // running sums undo the delta coding
  for (let i = 0, o = 0; i < PIXELS; i++, o += 4) {
    r = (r + planes[i]) & 255;
    g = (g + planes[PIXELS + i]) & 255;
    b = (b + planes[2 * PIXELS + i]) & 255;
    e = (e + planes[3 * PIXELS + i]) & 255;
    if (e !== 0) {
      const k = (e - 136) << 10;
      let h = mant[r] + k;
      half[o] = h <= 0 ? 0 : h > 0x7bff ? 0x7bff : h;
      h = mant[g] + k;
      half[o + 1] = h <= 0 ? 0 : h > 0x7bff ? 0x7bff : h;
      h = mant[b] + k;
      half[o + 2] = h <= 0 ? 0 : h > 0x7bff ? 0x7bff : h;
    }
    half[o + 3] = 0x3c00; // alpha 1
  }
  return half;
}

/**
 * Decodes generated/studio-env.bin: zlib of four byte planes (R, G, B mantissas, then the shared RGBE
 * exponent), each delta-coded. Resolves null when the file or DecompressionStream is unavailable (the
 * caller then generates the environment) or with `?env=live`, which forces the generator for comparison.
 */
export async function loadBakedEnvironment(): Promise<THREE.Texture | null> {
  if (typeof DecompressionStream === 'undefined' || new URLSearchParams(location.search).get('env') === 'live') return null;
  try {
    const res = await fetch(envUrl);
    if (!res.ok || !res.body) return null;
    const planes = new Uint8Array(await new Response(res.body.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
    if (planes.length !== PIXELS * 4) return null;
    const half = unpack(planes);
    const tex = new THREE.DataTexture(half, ENV_W, ENV_H, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.mapping = THREE.CubeUVReflectionMapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.LinearSRGBColorSpace;
    tex.name = 'PMREM.cubeUv.baked';
    tex.needsUpdate = true;
    return tex;
  } catch {
    return null;
  }
}
