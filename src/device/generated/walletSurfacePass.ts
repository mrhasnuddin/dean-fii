import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

// bevelEnabled defaults to true on THREE.ExtrudeGeometry and rounds every
// corner — sharp/pointed profiles (blades, fork tines, spikes) need
// bevelEnabled: false plus lineTo()-only path segments near the tip, since a
// curve command cannot produce a true converging point.
function buildExtrudeShape(points: [number, number][], holes?: [number, number][][]): THREE.Shape {
  const shape = new THREE.Shape();
  if (points.length > 0) {
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i][0], points[i][1]);
    }
  }
  // Cutouts (e.g. an oval wire-cutter hole) as THREE.Path added to shape.holes —
  // dep-free boolean subtraction via the tessellator, no CSG library needed.
  for (const loop of holes ?? []) {
    if (loop.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(loop[0][0], loop[0][1]);
    for (let i = 1; i < loop.length; i += 1) path.lineTo(loop[i][0], loop[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

// Build an N-gon oval loop (for hole authoring from a compact {cx,cy,rx,ry} descriptor).
function ovalLoop(cx: number, cy: number, rx: number, ry: number, seg = 24): [number, number][] {
  const loop: [number, number][] = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    loop.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return loop;
}

function buildExtrudeGeometry(profile: { points: [number, number][]; depth: number; holes?: [number, number][][]; ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[] }): THREE.ExtrudeGeometry {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  return new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: false,
    steps: 1,
  });
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
  //
  // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
  // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
  // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
  // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
  // it matters most, because the transfer curve is steepest near black.
  return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless as { declared?: boolean } | undefined)?.declared === true;
  const textures = textureless
    ? null
    : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: DeanFi hardware wallet
// Sculpt build pass: surface-pass
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createDeanFiHardwareWalletModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "DeanFi hardware wallet";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "Form-factor review uses a front three-quarter camera (yaw -0.45, pitch 0.08) matching ref 1; no projection (see projection-route skip)."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["shell-iridescent"] = createSculptMaterial(
    "shell-iridescent",
    {"id": "shell-iridescent", "name": "Iridescent graphite (A)", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#2a2b31", "color": "#2a2b31", "albedo": {"dominant": "#2a2b31", "secondary": ["#2a2b31"], "samplingNotes": "Designed value (docs/device-design.md), not averaged from the reference."}, "colorVariation": {"palette": ["#2a2b31"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.3, "variation": 0.04, "map": "none (uniform finish; variation via clearcoat/iridescence response)", "localResponse": "uniform finish"}, "metalness": {"base": 0.8, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Chosen in lab/materials.html (variant A). Thin-film shifts mauve to teal with view angle; needs a PMREM environment.", "materialClass": "metal", "textureless": {"declared": true, "evidence": ["front-ortho: bezel glass, frame and key read as uniform specular/diffuse fields with no visible grain at 531 px", "docs/device-design.md: finish is a designed CMF (lab/materials.html variant A), not reference pixels"]}, "physical": {"iridescence": 1.0, "iridescenceIOR": 1.8, "iridescenceThicknessRange": [250, 650], "clearcoat": 0.5, "clearcoatRoughness": 0.2, "fallback": {"color": "#15161a", "metalness": 0.35, "roughness": 0.42, "clearcoat": 0.3, "when": "low GPU tier"}}},
    options
  );
  materialMap["back-satin"] = createSculptMaterial(
    "back-satin",
    {"id": "back-satin", "name": "Iridescent graphite, satin (back)", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#2a2b31", "color": "#2a2b31", "albedo": {"dominant": "#2a2b31", "secondary": ["#2a2b31"], "samplingNotes": "Designed value (docs/device-design.md), not averaged from the reference."}, "colorVariation": {"palette": ["#2a2b31"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.42, "variation": 0.04, "map": "none (uniform finish; variation via clearcoat/iridescence response)", "localResponse": "uniform finish"}, "metalness": {"base": 0.8, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [{"id": "back-softtouch", "region": "whole plate", "roughness": 0.46, "notes": "slightly more satin than the frame so the seam reads"}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Same film as the frame, satin, so the back panel seam reads.", "materialClass": "metal", "textureless": {"declared": true, "evidence": ["front-ortho: bezel glass, frame and key read as uniform specular/diffuse fields with no visible grain at 531 px", "docs/device-design.md: finish is a designed CMF (lab/materials.html variant A), not reference pixels"]}, "physical": {"iridescence": 0.85, "iridescenceIOR": 1.8, "iridescenceThicknessRange": [250, 650], "clearcoat": 0.2, "clearcoatRoughness": 0.4}},
    options
  );
  materialMap["glass-black"] = createSculptMaterial(
    "glass-black",
    {"id": "glass-black", "name": "Black cover glass", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#0b0b0d", "color": "#0b0b0d", "albedo": {"dominant": "#0b0b0d", "secondary": ["#0b0b0d"], "samplingNotes": "Designed value (docs/device-design.md), not averaged from the reference."}, "colorVariation": {"palette": ["#0b0b0d"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.05, "variation": 0.04, "map": "none (uniform finish; variation via clearcoat/iridescence response)", "localResponse": "uniform finish"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [{"id": "window-border", "region": "display window rim", "color": "#45464d", "notes": "1 px lighter rim"}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Opaque black bezel glass; the display sits under a cut window.", "materialClass": "glass", "textureless": {"declared": true, "evidence": ["front-ortho: bezel glass, frame and key read as uniform specular/diffuse fields with no visible grain at 531 px", "docs/device-design.md: finish is a designed CMF (lab/materials.html variant A), not reference pixels"]}, "physical": {"clearcoat": 1.0, "clearcoatRoughness": 0.03, "ior": 1.5}},
    options
  );
  materialMap["eink-paper"] = createSculptMaterial(
    "eink-paper",
    {"id": "eink-paper", "name": "E-ink paper", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#e8e3d6", "color": "#e8e3d6", "albedo": {"dominant": "#e8e3d6", "secondary": ["#e8e3d6"], "samplingNotes": "Designed value (docs/device-design.md), not averaged from the reference."}, "colorVariation": {"palette": ["#e8e3d6"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.92, "variation": 0.04, "map": "none (uniform finish; variation via clearcoat/iridescence response)", "localResponse": "uniform finish"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Visually unlit (emissive = albedo x 0.85) so the paper reads identically under any key light; CSS3D HTML draws the content.", "materialClass": "plastic", "textureless": {"declared": true, "evidence": ["front-ortho: bezel glass, frame and key read as uniform specular/diffuse fields with no visible grain at 531 px", "docs/device-design.md: finish is a designed CMF (lab/materials.html variant A), not reference pixels"]}},
    options
  );
  materialMap["champagne-metal"] = createSculptMaterial(
    "champagne-metal",
    {"id": "champagne-metal", "name": "Champagne anodized metal", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#e3c894", "color": "#e3c894", "albedo": {"dominant": "#e3c894", "secondary": ["#e3c894"], "samplingNotes": "Designed value (docs/device-design.md), not averaged from the reference."}, "colorVariation": {"palette": ["#e3c894"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.24, "variation": 0.04, "map": "none (uniform finish; variation via clearcoat/iridescence response)", "localResponse": "uniform finish"}, "metalness": {"base": 1.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Roller, Confirm, active tab, logo emboss, keychain. Matches LOGO_COLOR family (#f2dfb6).", "materialClass": "metal", "textureless": {"declared": true, "evidence": ["front-ortho: bezel glass, frame and key read as uniform specular/diffuse fields with no visible grain at 531 px", "docs/device-design.md: finish is a designed CMF (lab/materials.html variant A), not reference pixels"]}, "physical": {"clearcoat": 0.0}},
    options
  );
  materialMap["key-polymer"] = createSculptMaterial(
    "key-polymer",
    {"id": "key-polymer", "name": "Graphite key polymer", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#26282f", "color": "#26282f", "albedo": {"dominant": "#26282f", "secondary": ["#26282f"], "samplingNotes": "Designed value (docs/device-design.md), not averaged from the reference."}, "colorVariation": {"palette": ["#26282f"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.45, "variation": 0.04, "map": "none (uniform finish; variation via clearcoat/iridescence response)", "localResponse": "uniform finish"}, "metalness": {"base": 0.1, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Back key, inactive tabs, switch knob.", "materialClass": "plastic", "textureless": {"declared": true, "evidence": ["front-ortho: bezel glass, frame and key read as uniform specular/diffuse fields with no visible grain at 531 px", "docs/device-design.md: finish is a designed CMF (lab/materials.html variant A), not reference pixels"]}},
    options
  );
  materialMap["led-emissive"] = createSculptMaterial(
    "led-emissive",
    {"id": "led-emissive", "name": "Confirm LED", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#e4cf9f", "color": "#e4cf9f", "albedo": {"dominant": "#e4cf9f", "secondary": ["#e4cf9f"], "samplingNotes": "Designed value (docs/device-design.md), not averaged from the reference."}, "colorVariation": {"palette": ["#e4cf9f"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.4, "variation": 0.04, "map": "none (uniform finish; variation via clearcoat/iridescence response)", "localResponse": "uniform finish"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Emissive intensity animates with the hold.", "materialClass": "plastic", "textureless": {"declared": true, "evidence": ["front-ortho: bezel glass, frame and key read as uniform specular/diffuse fields with no visible grain at 531 px", "docs/device-design.md: finish is a designed CMF (lab/materials.html variant A), not reference pixels"]}, "emissive": {"color": "#f2dfb6", "intensityIdle": 0.15, "intensityHeld": 2.2}},
    options
  );
  materialMap["port-dark"] = createSculptMaterial(
    "port-dark",
    {"id": "port-dark", "name": "Recess dark", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#060607", "color": "#060607", "albedo": {"dominant": "#060607", "secondary": ["#060607"], "samplingNotes": "Designed value (docs/device-design.md), not averaged from the reference."}, "colorVariation": {"palette": ["#060607"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.9, "variation": 0.04, "map": "none (uniform finish; variation via clearcoat/iridescence response)", "localResponse": "uniform finish"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Slots, port and rail cavities.", "materialClass": "plastic", "textureless": {"declared": true, "evidence": ["front-ortho: bezel glass, frame and key read as uniform specular/diffuse fields with no visible grain at 531 px", "docs/device-design.md: finish is a designed CMF (lab/materials.html variant A), not reference pixels"]}},
    options
  );
  materialMap["key-card-matte"] = createSculptMaterial(
    "key-card-matte",
    {"id": "key-card-matte", "name": "Key card matte soft-touch", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#2a2b30", "color": "#2a2b30", "albedo": {"dominant": "#2a2b30", "secondary": ["#2a2b30"], "samplingNotes": "Designed value (docs/device-design.md), not averaged from the reference."}, "colorVariation": {"palette": ["#2a2b30"], "pattern": "none", "amplitude": 0.0, "heightCorrelation": 0.0}, "roughness": {"base": 0.86, "variation": 0.04, "map": "none (uniform finish; variation via clearcoat/iridescence response)", "localResponse": "uniform finish"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [{"id": "star-marks", "region": "stepped corner clusters + 4 frame stars", "color": "#55565e", "roughness": 0.43, "notes": "spot-gloss, slightly raised"}, {"id": "engraving", "region": "DEAN STUDIO (front, y 0.29) / D-star (back)", "color": "#7a7b83", "roughness": 0.6, "notes": "recessed"}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Canvas-generated maps from deanfi.svg paths with seeded soft-touch grain (no image files).", "materialClass": "plastic", "textureless": {"declared": true, "evidence": ["front-ortho: bezel glass, frame and key read as uniform specular/diffuse fields with no visible grain at 531 px", "docs/device-design.md: finish is a designed CMF (lab/materials.html variant A), not reference pixels"]}, "physical": {"sheen": 0.25, "sheenRoughness": 0.8, "sheenColor": "#3a3b44", "envMapIntensity": 0.8}},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_shell_0 = makeAttachmentEndpoint(null);
  const node_shell_0 = new THREE.Group();
  node_shell_0.name = "Body shell (frame + back)__pivot";
  node_shell_0.scale.set(1, 1, 1);
  if (endpoint_shell_0) {
    node_shell_0.position.copy(endpoint_shell_0.start);
    node_shell_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shell_0.position.set(0.0, 0.0, -0.075);
    node_shell_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_shell_0.userData.sculptComponent = {"id": "shell", "name": "Body shell (frame + back)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.85, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Rounded-rectangle slab: plan corners 0.09 W, face-to-side roll-off bevel 0.03 W (4 segments) for the tight rim highlight in refs 1/3.", "geometryDescriptor": {"topologyIntent": "Rounded-rectangle slab: plan corners 0.09 W, face-to-side roll-off bevel 0.03 W (4 segments) for the tight rim highlight in refs 1/3.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.5, 0.66], [0.4969, 0.6833], [0.4879, 0.705], [0.4736, 0.7236], [0.455, 0.7379], [0.4333, 0.7469], [0.41, 0.75], [-0.41, 0.75], [-0.4333, 0.7469], [-0.455, 0.7379], [-0.4736, 0.7236], [-0.4879, 0.705], [-0.4969, 0.6833], [-0.5, 0.66], [-0.5, -0.66], [-0.4969, -0.6833], [-0.4879, -0.705], [-0.4736, -0.7236], [-0.455, -0.7379], [-0.4333, -0.7469], [-0.41, -0.75], [0.41, -0.75], [0.4333, -0.7469], [0.455, -0.7379], [0.4736, -0.7236], [0.4879, -0.705], [0.4969, -0.6833], [0.5, -0.66]], "depth": 0.15}, "handRefinement": "ExtrudeGeometry bevelEnabled (bevelSize = bevelThickness = 0.03, 4 segments) on the outline inset by 0.03; depth t − 0.06 (generator emits bevelEnabled:false)."}, "parent": null, "attachment": null, "dimensions": {"width": 1.0, "height": 1.5, "depth": 0.15, "units": "W", "confidence": 0.85}, "transform": {"position": [0, 0, -0.075], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "front-face", "localPosition": [0, 0, 0.15], "normal": [0, 0, 1]}, {"id": "keychain-anchor", "localPosition": [-0.3, -0.73, 0.075], "normal": [0, -1, 0], "notes": "src/device/keychain.ts anchor; X = bar axis"}, {"id": "card-slot", "localPosition": [0.5, -0.02, 0.075], "normal": [1, 0, 0], "notes": "Card reader mouth on the +X face; the key card's short edge enters along -X"}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-iridescent"}}, "material": "shell-iridescent", "materialLayers": ["shell-iridescent"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "edge-rolloff", "kind": "bevel", "description": "0.03 W face-to-side radius, 4 segments"}, {"id": "plan-corners", "kind": "contour", "description": "0.09 W plan-view corner radius"}, {"id": "left-roller-slot", "kind": "hole", "description": "Dark recess on the -X face behind the exposed roller rim: 0.27 x 0.07 W"}, {"id": "roller-arrows", "kind": "linework", "description": "▲ above and ▼ below the roller slot on the -X face: it reads as a scroll wheel, not a volume rocker"}, {"id": "right-switch-slot", "kind": "hole", "description": "Dark recess on the +X face: 0.19 x 0.05 W at y = 0.47"}, {"id": "switch-icons", "kind": "linework", "description": "Device glyph above the switch slot (3D view), list glyph below it (list view)"}, {"id": "top-tab-slots", "kind": "hole", "description": "Four tab openings in the top face"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.03, "bumpAmplitude": 0.001, "normalPattern": "none on the finish; engraved ▲▼ roller marks and view-switch glyphs are 0.001 W deep decals on the side bands", "displacementPattern": "", "occlusionPattern": "dark recess decals behind roller, switch and card slot (cavity read without real holes)", "edgeWearPattern": "", "notes": "Surface pass DC-2, realised in src/device/walletRefine.ts"}, "evidenceRefs": ["full-object", "front-ortho"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 43, 49, 1.0)", "secondaryAlbedo": "rgba(58, 44, 60, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "evidenceRefs": ["docs/device-design.md#body-finish"], "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(52, 40, 58, 1.0)"}, {"position": 0.5, "color": "rgba(27, 28, 33, 1.0)"}, {"position": 1.0, "color": "rgba(28, 46, 46, 1.0)"}]}}};
  node_shell_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "front-face", "localPosition": [0, 0, 0.15], "normal": [0, 0, 1]}, {"id": "keychain-anchor", "localPosition": [-0.3, -0.73, 0.075], "normal": [0, -1, 0], "notes": "src/device/keychain.ts anchor; X = bar axis"}, {"id": "card-slot", "localPosition": [0.5, -0.02, 0.075], "normal": [1, 0, 0], "notes": "Card reader mouth on the +X face; the key card's short edge enters along -X"}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-iridescent"}};
  (nodes["root"] ?? root).add(node_shell_0);
  nodes["shell"] = node_shell_0;
  const mesh_shell_0Geometry = endpoint_shell_0
    ? new THREE.CylinderGeometry(endpoint_shell_0.endRadius, endpoint_shell_0.baseRadius, endpoint_shell_0.length, 16, 6)
    : buildExtrudeGeometry({"points": [[0.5, 0.66], [0.4969, 0.6833], [0.4879, 0.705], [0.4736, 0.7236], [0.455, 0.7379], [0.4333, 0.7469], [0.41, 0.75], [-0.41, 0.75], [-0.4333, 0.7469], [-0.455, 0.7379], [-0.4736, 0.7236], [-0.4879, 0.705], [-0.4969, 0.6833], [-0.5, 0.66], [-0.5, -0.66], [-0.4969, -0.6833], [-0.4879, -0.705], [-0.4736, -0.7236], [-0.455, -0.7379], [-0.4333, -0.7469], [-0.41, -0.75], [0.41, -0.75], [0.4333, -0.7469], [0.455, -0.7379], [0.4736, -0.7236], [0.4879, -0.705], [0.4969, -0.6833], [0.5, -0.66]], "depth": 0.15});
  if (!endpoint_shell_0) {
    mesh_shell_0Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_shell_0 = new THREE.Mesh(
    mesh_shell_0Geometry,
    materialMap["shell-iridescent"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shell_0.name = "Body shell (frame + back)";
  if (endpoint_shell_0) {
    mesh_shell_0.position.copy(endpoint_shell_0.midpoint);
    mesh_shell_0.quaternion.copy(endpoint_shell_0.quaternion);
  }
  mesh_shell_0.castShadow = options.castShadow ?? true;
  mesh_shell_0.receiveShadow = options.receiveShadow ?? true;
  mesh_shell_0.userData.sculptComponent = {"id": "shell", "name": "Body shell (frame + back)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.85, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Rounded-rectangle slab: plan corners 0.09 W, face-to-side roll-off bevel 0.03 W (4 segments) for the tight rim highlight in refs 1/3.", "geometryDescriptor": {"topologyIntent": "Rounded-rectangle slab: plan corners 0.09 W, face-to-side roll-off bevel 0.03 W (4 segments) for the tight rim highlight in refs 1/3.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.5, 0.66], [0.4969, 0.6833], [0.4879, 0.705], [0.4736, 0.7236], [0.455, 0.7379], [0.4333, 0.7469], [0.41, 0.75], [-0.41, 0.75], [-0.4333, 0.7469], [-0.455, 0.7379], [-0.4736, 0.7236], [-0.4879, 0.705], [-0.4969, 0.6833], [-0.5, 0.66], [-0.5, -0.66], [-0.4969, -0.6833], [-0.4879, -0.705], [-0.4736, -0.7236], [-0.455, -0.7379], [-0.4333, -0.7469], [-0.41, -0.75], [0.41, -0.75], [0.4333, -0.7469], [0.455, -0.7379], [0.4736, -0.7236], [0.4879, -0.705], [0.4969, -0.6833], [0.5, -0.66]], "depth": 0.15}, "handRefinement": "ExtrudeGeometry bevelEnabled (bevelSize = bevelThickness = 0.03, 4 segments) on the outline inset by 0.03; depth t − 0.06 (generator emits bevelEnabled:false)."}, "parent": null, "attachment": null, "dimensions": {"width": 1.0, "height": 1.5, "depth": 0.15, "units": "W", "confidence": 0.85}, "transform": {"position": [0, 0, -0.075], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "front-face", "localPosition": [0, 0, 0.15], "normal": [0, 0, 1]}, {"id": "keychain-anchor", "localPosition": [-0.3, -0.73, 0.075], "normal": [0, -1, 0], "notes": "src/device/keychain.ts anchor; X = bar axis"}, {"id": "card-slot", "localPosition": [0.5, -0.02, 0.075], "normal": [1, 0, 0], "notes": "Card reader mouth on the +X face; the key card's short edge enters along -X"}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-iridescent"}}, "material": "shell-iridescent", "materialLayers": ["shell-iridescent"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "edge-rolloff", "kind": "bevel", "description": "0.03 W face-to-side radius, 4 segments"}, {"id": "plan-corners", "kind": "contour", "description": "0.09 W plan-view corner radius"}, {"id": "left-roller-slot", "kind": "hole", "description": "Dark recess on the -X face behind the exposed roller rim: 0.27 x 0.07 W"}, {"id": "roller-arrows", "kind": "linework", "description": "▲ above and ▼ below the roller slot on the -X face: it reads as a scroll wheel, not a volume rocker"}, {"id": "right-switch-slot", "kind": "hole", "description": "Dark recess on the +X face: 0.19 x 0.05 W at y = 0.47"}, {"id": "switch-icons", "kind": "linework", "description": "Device glyph above the switch slot (3D view), list glyph below it (list view)"}, {"id": "top-tab-slots", "kind": "hole", "description": "Four tab openings in the top face"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.03, "bumpAmplitude": 0.001, "normalPattern": "none on the finish; engraved ▲▼ roller marks and view-switch glyphs are 0.001 W deep decals on the side bands", "displacementPattern": "", "occlusionPattern": "dark recess decals behind roller, switch and card slot (cavity read without real holes)", "edgeWearPattern": "", "notes": "Surface pass DC-2, realised in src/device/walletRefine.ts"}, "evidenceRefs": ["full-object", "front-ortho"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 43, 49, 1.0)", "secondaryAlbedo": "rgba(58, 44, 60, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "evidenceRefs": ["docs/device-design.md#body-finish"], "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(52, 40, 58, 1.0)"}, {"position": 0.5, "color": "rgba(27, 28, 33, 1.0)"}, {"position": 1.0, "color": "rgba(28, 46, 46, 1.0)"}]}}};
  node_shell_0.add(mesh_shell_0);
  meshes["shell"] = mesh_shell_0;
  colliders["shell"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"};
  destructionGroups["shell"] ??= [];
  destructionGroups["shell"].push(node_shell_0);
  const socket_shell_front_face_0 = new THREE.Object3D();
  socket_shell_front_face_0.name = "front-face";
  socket_shell_front_face_0.position.set(0.0, 0.0, 0.15);
  socket_shell_front_face_0.rotation.set(0, 0, 0);
  socket_shell_front_face_0.userData.socket = {"id": "front-face", "localPosition": [0, 0, 0.15], "normal": [0, 0, 1]};
  node_shell_0.add(socket_shell_front_face_0);
  sockets["shell:front-face"] = socket_shell_front_face_0;
  const socket_shell_keychain_anchor_1 = new THREE.Object3D();
  socket_shell_keychain_anchor_1.name = "keychain-anchor";
  socket_shell_keychain_anchor_1.position.set(-0.3, -0.73, 0.075);
  socket_shell_keychain_anchor_1.rotation.set(0, 0, 0);
  socket_shell_keychain_anchor_1.userData.socket = {"id": "keychain-anchor", "localPosition": [-0.3, -0.73, 0.075], "normal": [0, -1, 0], "notes": "src/device/keychain.ts anchor; X = bar axis"};
  node_shell_0.add(socket_shell_keychain_anchor_1);
  sockets["shell:keychain-anchor"] = socket_shell_keychain_anchor_1;
  const socket_shell_card_slot_2 = new THREE.Object3D();
  socket_shell_card_slot_2.name = "card-slot";
  socket_shell_card_slot_2.position.set(0.5, -0.02, 0.075);
  socket_shell_card_slot_2.rotation.set(0, 0, 0);
  socket_shell_card_slot_2.userData.socket = {"id": "card-slot", "localPosition": [0.5, -0.02, 0.075], "normal": [1, 0, 0], "notes": "Card reader mouth on the +X face; the key card's short edge enters along -X"};
  node_shell_0.add(socket_shell_card_slot_2);
  sockets["shell:card-slot"] = socket_shell_card_slot_2;

  const endpoint_front_glass_1 = makeAttachmentEndpoint(null);
  const node_front_glass_1 = new THREE.Group();
  node_front_glass_1.name = "Front cover glass__pivot";
  node_front_glass_1.scale.set(1, 1, 1);
  if (endpoint_front_glass_1) {
    node_front_glass_1.position.copy(endpoint_front_glass_1.start);
    node_front_glass_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_front_glass_1.position.set(0.0, 0.0, 0.149);
    node_front_glass_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_front_glass_1.userData.sculptComponent = {"id": "front-glass", "name": "Front cover glass", "level": "macro", "role": "cover", "importance": 0.9, "confidence": 0.8, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Glass covers the FLAT front face only: the 0.03 W roll-off leaves 0.94 x 1.44 W (corner 0.06 W); a wider plate would overhang the rounded edge (form-refinement finding).", "geometryDescriptor": {"topologyIntent": "Glass covers the FLAT front face only: the 0.03 W roll-off leaves 0.94 x 1.44 W (corner 0.06 W); a wider plate would overhang the rounded edge (form-refinement finding).", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.47, 0.66], [0.468, 0.6755], [0.462, 0.69], [0.4524, 0.7024], [0.44, 0.712], [0.4255, 0.718], [0.41, 0.72], [-0.41, 0.72], [-0.4255, 0.718], [-0.44, 0.712], [-0.4524, 0.7024], [-0.462, 0.69], [-0.468, 0.6755], [-0.47, 0.66], [-0.47, -0.66], [-0.468, -0.6755], [-0.462, -0.69], [-0.4524, -0.7024], [-0.44, -0.712], [-0.4255, -0.718], [-0.41, -0.72], [0.41, -0.72], [0.4255, -0.718], [0.44, -0.712], [0.4524, -0.7024], [0.462, -0.69], [0.468, -0.6755], [0.47, -0.66]], "depth": 0.004}}, "parent": "shell", "attachment": null, "dimensions": {"width": 0.94, "height": 1.44, "depth": 0.004, "units": "W", "confidence": 0.8}, "transform": {"position": [0, 0, 0.149], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-child", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "glass-black"}}, "material": "glass-black", "materialLayers": ["glass-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cover-gloss", "kind": "gloss", "description": "Clearcoat 1.0, roughness 0.05: sharp environment reflections across the face"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(11, 11, 13, 1.0)", "secondaryAlbedo": "rgba(69, 70, 77, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.9, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_front_glass_1.userData.actionProfile = {"animationRole": "static-child", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "glass-black"}};
  (nodes["shell"] ?? root).add(node_front_glass_1);
  nodes["front-glass"] = node_front_glass_1;
  const mesh_front_glass_1Geometry = endpoint_front_glass_1
    ? new THREE.CylinderGeometry(endpoint_front_glass_1.endRadius, endpoint_front_glass_1.baseRadius, endpoint_front_glass_1.length, 16, 6)
    : buildExtrudeGeometry({"points": [[0.47, 0.66], [0.468, 0.6755], [0.462, 0.69], [0.4524, 0.7024], [0.44, 0.712], [0.4255, 0.718], [0.41, 0.72], [-0.41, 0.72], [-0.4255, 0.718], [-0.44, 0.712], [-0.4524, 0.7024], [-0.462, 0.69], [-0.468, 0.6755], [-0.47, 0.66], [-0.47, -0.66], [-0.468, -0.6755], [-0.462, -0.69], [-0.4524, -0.7024], [-0.44, -0.712], [-0.4255, -0.718], [-0.41, -0.72], [0.41, -0.72], [0.4255, -0.718], [0.44, -0.712], [0.4524, -0.7024], [0.462, -0.69], [0.468, -0.6755], [0.47, -0.66]], "depth": 0.004});
  if (!endpoint_front_glass_1) {
    mesh_front_glass_1Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_front_glass_1 = new THREE.Mesh(
    mesh_front_glass_1Geometry,
    materialMap["glass-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_front_glass_1.name = "Front cover glass";
  if (endpoint_front_glass_1) {
    mesh_front_glass_1.position.copy(endpoint_front_glass_1.midpoint);
    mesh_front_glass_1.quaternion.copy(endpoint_front_glass_1.quaternion);
  }
  mesh_front_glass_1.castShadow = options.castShadow ?? true;
  mesh_front_glass_1.receiveShadow = options.receiveShadow ?? true;
  mesh_front_glass_1.userData.sculptComponent = {"id": "front-glass", "name": "Front cover glass", "level": "macro", "role": "cover", "importance": 0.9, "confidence": 0.8, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Glass covers the FLAT front face only: the 0.03 W roll-off leaves 0.94 x 1.44 W (corner 0.06 W); a wider plate would overhang the rounded edge (form-refinement finding).", "geometryDescriptor": {"topologyIntent": "Glass covers the FLAT front face only: the 0.03 W roll-off leaves 0.94 x 1.44 W (corner 0.06 W); a wider plate would overhang the rounded edge (form-refinement finding).", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.47, 0.66], [0.468, 0.6755], [0.462, 0.69], [0.4524, 0.7024], [0.44, 0.712], [0.4255, 0.718], [0.41, 0.72], [-0.41, 0.72], [-0.4255, 0.718], [-0.44, 0.712], [-0.4524, 0.7024], [-0.462, 0.69], [-0.468, 0.6755], [-0.47, 0.66], [-0.47, -0.66], [-0.468, -0.6755], [-0.462, -0.69], [-0.4524, -0.7024], [-0.44, -0.712], [-0.4255, -0.718], [-0.41, -0.72], [0.41, -0.72], [0.4255, -0.718], [0.44, -0.712], [0.4524, -0.7024], [0.462, -0.69], [0.468, -0.6755], [0.47, -0.66]], "depth": 0.004}}, "parent": "shell", "attachment": null, "dimensions": {"width": 0.94, "height": 1.44, "depth": 0.004, "units": "W", "confidence": 0.8}, "transform": {"position": [0, 0, 0.149], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-child", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "glass-black"}}, "material": "glass-black", "materialLayers": ["glass-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cover-gloss", "kind": "gloss", "description": "Clearcoat 1.0, roughness 0.05: sharp environment reflections across the face"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(11, 11, 13, 1.0)", "secondaryAlbedo": "rgba(69, 70, 77, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.9, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_front_glass_1.add(mesh_front_glass_1);
  meshes["front-glass"] = mesh_front_glass_1;
  colliders["front-glass"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"};
  destructionGroups["shell"] ??= [];
  destructionGroups["shell"].push(node_front_glass_1);

  const endpoint_display_2 = makeAttachmentEndpoint(null);
  const node_display_2 = new THREE.Group();
  node_display_2.name = "E-ink display (CSS3D host)__pivot";
  node_display_2.scale.set(1, 1, 1);
  if (endpoint_display_2) {
    node_display_2.position.copy(endpoint_display_2.start);
    node_display_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_display_2.position.set(0.0, 0.115, 0.0045);
    node_display_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_display_2.userData.sculptComponent = {"id": "display", "name": "E-ink display (CSS3D host)", "level": "macro", "role": "display", "importance": 0.95, "confidence": 0.8, "primitive": "plane-card", "topologyClass": "surface-relief", "topologyRationale": "Flat matte plane just above the glass; live UI is a CSS3DObject aligned to this plane (360 x 480 CSS px).", "geometryDescriptor": {"topologyIntent": "Flat matte plane just above the glass; live UI is a CSS3DObject aligned to this plane (360 x 480 CSS px).", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "front-glass", "attachment": null, "dimensions": {"width": 0.795, "height": 1.06, "depth": 1, "units": "W", "confidence": 0.8}, "transform": {"position": [0, 0.115, 0.0045], "rotation": [0, 0, 0], "scale": [0.795, 1.06, 1]}, "actionProfile": {"animationRole": "display", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "css3d-screen", "localPosition": [0, 0, 0.0005], "normal": [0, 0, 1], "notes": "CSS3DObject scale = 0.795 / 360 per px"}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "front-glass", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "eink-paper"}}, "material": "eink-paper", "materialLayers": ["eink-paper"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "eink-surface", "kind": "decal", "description": "Matte paper #e8e3d6, content from CSS3D HTML; fallback texture when CSS3D is off; corners 0.025 W radius"}, {"id": "window-border", "kind": "linework", "description": "Lighter 1 px border: window 0.836 x 1.11 W at y = 0.113"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 227, 214, 1.0)", "secondaryAlbedo": "rgba(29, 28, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_display_2.userData.actionProfile = {"animationRole": "display", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "css3d-screen", "localPosition": [0, 0, 0.0005], "normal": [0, 0, 1], "notes": "CSS3DObject scale = 0.795 / 360 per px"}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "front-glass", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "eink-paper"}};
  (nodes["front-glass"] ?? root).add(node_display_2);
  nodes["display"] = node_display_2;
  const mesh_display_2Geometry = endpoint_display_2
    ? new THREE.CylinderGeometry(endpoint_display_2.endRadius, endpoint_display_2.baseRadius, endpoint_display_2.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_display_2) {
    mesh_display_2Geometry.scale(0.795, 1.06, 1.0);
  }
  const mesh_display_2 = new THREE.Mesh(
    mesh_display_2Geometry,
    materialMap["eink-paper"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_display_2.name = "E-ink display (CSS3D host)";
  if (endpoint_display_2) {
    mesh_display_2.position.copy(endpoint_display_2.midpoint);
    mesh_display_2.quaternion.copy(endpoint_display_2.quaternion);
  }
  mesh_display_2.castShadow = options.castShadow ?? true;
  mesh_display_2.receiveShadow = options.receiveShadow ?? true;
  mesh_display_2.userData.sculptComponent = {"id": "display", "name": "E-ink display (CSS3D host)", "level": "macro", "role": "display", "importance": 0.95, "confidence": 0.8, "primitive": "plane-card", "topologyClass": "surface-relief", "topologyRationale": "Flat matte plane just above the glass; live UI is a CSS3DObject aligned to this plane (360 x 480 CSS px).", "geometryDescriptor": {"topologyIntent": "Flat matte plane just above the glass; live UI is a CSS3DObject aligned to this plane (360 x 480 CSS px).", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "front-glass", "attachment": null, "dimensions": {"width": 0.795, "height": 1.06, "depth": 1, "units": "W", "confidence": 0.8}, "transform": {"position": [0, 0.115, 0.0045], "rotation": [0, 0, 0], "scale": [0.795, 1.06, 1]}, "actionProfile": {"animationRole": "display", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "css3d-screen", "localPosition": [0, 0, 0.0005], "normal": [0, 0, 1], "notes": "CSS3DObject scale = 0.795 / 360 per px"}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "front-glass", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "eink-paper"}}, "material": "eink-paper", "materialLayers": ["eink-paper"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "eink-surface", "kind": "decal", "description": "Matte paper #e8e3d6, content from CSS3D HTML; fallback texture when CSS3D is off; corners 0.025 W radius"}, {"id": "window-border", "kind": "linework", "description": "Lighter 1 px border: window 0.836 x 1.11 W at y = 0.113"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 227, 214, 1.0)", "secondaryAlbedo": "rgba(29, 28, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_display_2.add(mesh_display_2);
  meshes["display"] = mesh_display_2;
  colliders["display"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"};
  destructionGroups["front-glass"] ??= [];
  destructionGroups["front-glass"].push(node_display_2);
  const socket_display_css3d_screen_0 = new THREE.Object3D();
  socket_display_css3d_screen_0.name = "css3d-screen";
  socket_display_css3d_screen_0.position.set(0.0, 0.0, 0.0005);
  socket_display_css3d_screen_0.rotation.set(0, 0, 0);
  socket_display_css3d_screen_0.userData.socket = {"id": "css3d-screen", "localPosition": [0, 0, 0.0005], "normal": [0, 0, 1], "notes": "CSS3DObject scale = 0.795 / 360 per px"};
  node_display_2.add(socket_display_css3d_screen_0);
  sockets["display:css3d-screen"] = socket_display_css3d_screen_0;

  const endpoint_back_plate_3 = makeAttachmentEndpoint(null);
  const node_back_plate_3 = new THREE.Group();
  node_back_plate_3.name = "Back plate__pivot";
  node_back_plate_3.scale.set(1, 1, 1);
  if (endpoint_back_plate_3) {
    node_back_plate_3.position.copy(endpoint_back_plate_3.start);
    node_back_plate_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_back_plate_3.position.set(0.0, 0.0, -0.002);
    node_back_plate_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_back_plate_3.userData.sculptComponent = {"id": "back-plate", "name": "Back plate", "level": "macro", "role": "panel", "importance": 0.7, "confidence": 0.8, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Inset rear panel (0.03 W from the edge) with a hairline seam to the frame.", "geometryDescriptor": {"topologyIntent": "Inset rear panel (0.03 W from the edge) with a hairline seam to the frame.", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.47, 0.65], [0.4676, 0.6681], [0.4606, 0.685], [0.4495, 0.6995], [0.435, 0.7106], [0.4181, 0.7176], [0.4, 0.72], [-0.4, 0.72], [-0.4181, 0.7176], [-0.435, 0.7106], [-0.4495, 0.6995], [-0.4606, 0.685], [-0.4676, 0.6681], [-0.47, 0.65], [-0.47, -0.65], [-0.4676, -0.6681], [-0.4606, -0.685], [-0.4495, -0.6995], [-0.435, -0.7106], [-0.4181, -0.7176], [-0.4, -0.72], [0.4, -0.72], [0.4181, -0.7176], [0.435, -0.7106], [0.4495, -0.6995], [0.4606, -0.685], [0.4676, -0.6681], [0.47, -0.65]], "depth": 0.003}}, "parent": "shell", "attachment": null, "dimensions": {"width": 0.94, "height": 1.44, "depth": 0.003, "units": "W", "confidence": 0.8}, "transform": {"position": [0, 0, -0.002], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-child", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "back-satin"}}, "material": "back-satin", "materialLayers": ["back-satin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "logo-emboss", "kind": "ridge", "description": "D-star from deanfi.svg, 0.3 W tall, champagne, raised 0.004 W, centred at y = 0.3"}, {"id": "studio-text", "kind": "linework", "description": "DEAN STUDIO, letter-spaced, engraved at y = -0.64"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.04, "bumpAmplitude": 0.004, "normalPattern": "engraved DEAN STUDIO text (alpha decal)", "displacementPattern": "raised D-star emboss (0.004 W extrude, bevelled)", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface pass DC-2, realised in src/device/walletRefine.ts"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 43, 49, 1.0)", "secondaryAlbedo": "rgba(58, 44, 60, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "evidenceRefs": ["docs/device-design.md#body-finish"], "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(52, 40, 58, 1.0)"}, {"position": 0.5, "color": "rgba(27, 28, 33, 1.0)"}, {"position": 1.0, "color": "rgba(28, 46, 46, 1.0)"}]}}};
  node_back_plate_3.userData.actionProfile = {"animationRole": "static-child", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "back-satin"}};
  (nodes["shell"] ?? root).add(node_back_plate_3);
  nodes["back-plate"] = node_back_plate_3;
  const mesh_back_plate_3Geometry = endpoint_back_plate_3
    ? new THREE.CylinderGeometry(endpoint_back_plate_3.endRadius, endpoint_back_plate_3.baseRadius, endpoint_back_plate_3.length, 16, 6)
    : buildExtrudeGeometry({"points": [[0.47, 0.65], [0.4676, 0.6681], [0.4606, 0.685], [0.4495, 0.6995], [0.435, 0.7106], [0.4181, 0.7176], [0.4, 0.72], [-0.4, 0.72], [-0.4181, 0.7176], [-0.435, 0.7106], [-0.4495, 0.6995], [-0.4606, 0.685], [-0.4676, 0.6681], [-0.47, 0.65], [-0.47, -0.65], [-0.4676, -0.6681], [-0.4606, -0.685], [-0.4495, -0.6995], [-0.435, -0.7106], [-0.4181, -0.7176], [-0.4, -0.72], [0.4, -0.72], [0.4181, -0.7176], [0.435, -0.7106], [0.4495, -0.6995], [0.4606, -0.685], [0.4676, -0.6681], [0.47, -0.65]], "depth": 0.003});
  if (!endpoint_back_plate_3) {
    mesh_back_plate_3Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_back_plate_3 = new THREE.Mesh(
    mesh_back_plate_3Geometry,
    materialMap["back-satin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_back_plate_3.name = "Back plate";
  if (endpoint_back_plate_3) {
    mesh_back_plate_3.position.copy(endpoint_back_plate_3.midpoint);
    mesh_back_plate_3.quaternion.copy(endpoint_back_plate_3.quaternion);
  }
  mesh_back_plate_3.castShadow = options.castShadow ?? true;
  mesh_back_plate_3.receiveShadow = options.receiveShadow ?? true;
  mesh_back_plate_3.userData.sculptComponent = {"id": "back-plate", "name": "Back plate", "level": "macro", "role": "panel", "importance": 0.7, "confidence": 0.8, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Inset rear panel (0.03 W from the edge) with a hairline seam to the frame.", "geometryDescriptor": {"topologyIntent": "Inset rear panel (0.03 W from the edge) with a hairline seam to the frame.", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.47, 0.65], [0.4676, 0.6681], [0.4606, 0.685], [0.4495, 0.6995], [0.435, 0.7106], [0.4181, 0.7176], [0.4, 0.72], [-0.4, 0.72], [-0.4181, 0.7176], [-0.435, 0.7106], [-0.4495, 0.6995], [-0.4606, 0.685], [-0.4676, 0.6681], [-0.47, 0.65], [-0.47, -0.65], [-0.4676, -0.6681], [-0.4606, -0.685], [-0.4495, -0.6995], [-0.435, -0.7106], [-0.4181, -0.7176], [-0.4, -0.72], [0.4, -0.72], [0.4181, -0.7176], [0.435, -0.7106], [0.4495, -0.6995], [0.4606, -0.685], [0.4676, -0.6681], [0.47, -0.65]], "depth": 0.003}}, "parent": "shell", "attachment": null, "dimensions": {"width": 0.94, "height": 1.44, "depth": 0.003, "units": "W", "confidence": 0.8}, "transform": {"position": [0, 0, -0.002], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-child", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "back-satin"}}, "material": "back-satin", "materialLayers": ["back-satin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "logo-emboss", "kind": "ridge", "description": "D-star from deanfi.svg, 0.3 W tall, champagne, raised 0.004 W, centred at y = 0.3"}, {"id": "studio-text", "kind": "linework", "description": "DEAN STUDIO, letter-spaced, engraved at y = -0.64"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.04, "bumpAmplitude": 0.004, "normalPattern": "engraved DEAN STUDIO text (alpha decal)", "displacementPattern": "raised D-star emboss (0.004 W extrude, bevelled)", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface pass DC-2, realised in src/device/walletRefine.ts"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 43, 49, 1.0)", "secondaryAlbedo": "rgba(58, 44, 60, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.8, "evidenceRefs": ["docs/device-design.md#body-finish"], "colorGradient": {"type": "linear", "stops": [{"position": 0.0, "color": "rgba(52, 40, 58, 1.0)"}, {"position": 0.5, "color": "rgba(27, 28, 33, 1.0)"}, {"position": 1.0, "color": "rgba(28, 46, 46, 1.0)"}]}}};
  node_back_plate_3.add(mesh_back_plate_3);
  meshes["back-plate"] = mesh_back_plate_3;
  colliders["back-plate"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"};
  destructionGroups["shell"] ??= [];
  destructionGroups["shell"].push(node_back_plate_3);

  const attachment_key_confirm_4 = {"parentId": "shell", "parentSocket": "front-face", "baseRadius": 0.085, "endRadius": 0.085, "contactType": "embed", "contactNormal": [0, 0, 1], "embedDepth": 0.003, "gapTolerance": 0.0015, "evidenceRefs": ["blueprint"], "localStart": [0.3, -0.59, 0.147], "localEnd": [0.3, -0.59, 0.161]};
  const endpoint_key_confirm_4 = makeAttachmentEndpoint(attachment_key_confirm_4);
  const node_key_confirm_4 = new THREE.Group();
  node_key_confirm_4.name = "Confirm key (hold)__pivot";
  node_key_confirm_4.scale.set(1, 1, 1);
  if (endpoint_key_confirm_4) {
    node_key_confirm_4.position.copy(endpoint_key_confirm_4.start);
    node_key_confirm_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_key_confirm_4.position.set(0.3, -0.59, 0.154);
    node_key_confirm_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_key_confirm_4.userData.sculptComponent = {"id": "key-confirm", "name": "Confirm key (hold)", "level": "meso", "role": "button", "importance": 0.9, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Round key proud of the glass by 0.006 W; D-star engraved on the cap.", "geometryDescriptor": {"topologyIntent": "Round key proud of the glass by 0.006 W; D-star engraved on the cap.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.006, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "shell", "attachment": {"parentId": "shell", "parentSocket": "front-face", "baseRadius": 0.085, "endRadius": 0.085, "contactType": "embed", "contactNormal": [0, 0, 1], "embedDepth": 0.003, "gapTolerance": 0.0015, "evidenceRefs": ["blueprint"], "localStart": [0.3, -0.59, 0.147], "localEnd": [0.3, -0.59, 0.161]}, "dimensions": {"width": 0.17, "height": 0.17, "depth": 0.014, "units": "W", "confidence": 0.8}, "transform": {"position": [0.3, -0.59, 0.154], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "control-press", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, -1], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "champagne-metal"}}, "material": "champagne-metal", "materialLayers": ["champagne-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cap", "kind": "groove", "description": "Engraved D-star on the cap, 0.09 W"}, {"id": "led-ring", "kind": "emissive", "description": "Emissive ring fill 0..1 while held (see confirm-led-ring)"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.02, "bumpAmplitude": 0.0016, "normalPattern": "engraved D-star cap face (coin face bump map)", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface pass DC-2, realised in src/device/walletRefine.ts"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(227, 200, 148, 1.0)", "secondaryAlbedo": "rgba(143, 127, 92, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.9, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_key_confirm_4.userData.actionProfile = {"animationRole": "control-press", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, -1], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "champagne-metal"}};
  (nodes["shell"] ?? root).add(node_key_confirm_4);
  nodes["key-confirm"] = node_key_confirm_4;
  const mesh_key_confirm_4Geometry = endpoint_key_confirm_4
    ? new THREE.CylinderGeometry(endpoint_key_confirm_4.endRadius, endpoint_key_confirm_4.baseRadius, endpoint_key_confirm_4.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_key_confirm_4) {
    mesh_key_confirm_4Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_key_confirm_4 = new THREE.Mesh(
    mesh_key_confirm_4Geometry,
    materialMap["champagne-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_key_confirm_4.name = "Confirm key (hold)";
  if (endpoint_key_confirm_4) {
    mesh_key_confirm_4.position.copy(endpoint_key_confirm_4.midpoint);
    mesh_key_confirm_4.quaternion.copy(endpoint_key_confirm_4.quaternion);
  }
  mesh_key_confirm_4.castShadow = options.castShadow ?? true;
  mesh_key_confirm_4.receiveShadow = options.receiveShadow ?? true;
  mesh_key_confirm_4.userData.sculptComponent = {"id": "key-confirm", "name": "Confirm key (hold)", "level": "meso", "role": "button", "importance": 0.9, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Round key proud of the glass by 0.006 W; D-star engraved on the cap.", "geometryDescriptor": {"topologyIntent": "Round key proud of the glass by 0.006 W; D-star engraved on the cap.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.006, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "shell", "attachment": {"parentId": "shell", "parentSocket": "front-face", "baseRadius": 0.085, "endRadius": 0.085, "contactType": "embed", "contactNormal": [0, 0, 1], "embedDepth": 0.003, "gapTolerance": 0.0015, "evidenceRefs": ["blueprint"], "localStart": [0.3, -0.59, 0.147], "localEnd": [0.3, -0.59, 0.161]}, "dimensions": {"width": 0.17, "height": 0.17, "depth": 0.014, "units": "W", "confidence": 0.8}, "transform": {"position": [0.3, -0.59, 0.154], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "control-press", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, -1], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "champagne-metal"}}, "material": "champagne-metal", "materialLayers": ["champagne-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cap", "kind": "groove", "description": "Engraved D-star on the cap, 0.09 W"}, {"id": "led-ring", "kind": "emissive", "description": "Emissive ring fill 0..1 while held (see confirm-led-ring)"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.02, "bumpAmplitude": 0.0016, "normalPattern": "engraved D-star cap face (coin face bump map)", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface pass DC-2, realised in src/device/walletRefine.ts"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(227, 200, 148, 1.0)", "secondaryAlbedo": "rgba(143, 127, 92, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.9, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_key_confirm_4.add(mesh_key_confirm_4);
  meshes["key-confirm"] = mesh_key_confirm_4;
  colliders["key-confirm"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"};
  destructionGroups["shell"] ??= [];
  destructionGroups["shell"].push(node_key_confirm_4);

  const endpoint_confirm_led_ring_5 = makeAttachmentEndpoint(null);
  const node_confirm_led_ring_5 = new THREE.Group();
  node_confirm_led_ring_5.name = "Confirm LED ring__pivot";
  node_confirm_led_ring_5.scale.set(1, 1, 1);
  if (endpoint_confirm_led_ring_5) {
    node_confirm_led_ring_5.position.copy(endpoint_confirm_led_ring_5.start);
    node_confirm_led_ring_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_confirm_led_ring_5.position.set(0.3, -0.59, 0.1515);
    node_confirm_led_ring_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_confirm_led_ring_5.userData.sculptComponent = {"id": "confirm-led-ring", "name": "Confirm LED ring", "level": "micro", "role": "indicator", "importance": 0.6, "confidence": 0.8, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Thin emissive ring set into the glass around the key (TorusGeometry 0.45 scaled to R 0.105; tube 0.006 W).", "geometryDescriptor": {"topologyIntent": "Thin emissive ring set into the glass around the key (TorusGeometry 0.45 scaled to R 0.105; tube 0.006 W).", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.0571}, "parent": "shell", "attachment": null, "dimensions": {"width": 0.21, "height": 0.21, "depth": 0.012, "units": "W", "confidence": 0.8}, "transform": {"position": [0.3, -0.59, 0.1515], "rotation": [0, 0, 0], "scale": [0.2333333333333333, 0.2333333333333333, 0.2333333333333333]}, "actionProfile": {"animationRole": "indicator", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "led-emissive"}}, "material": "led-emissive", "materialLayers": ["led-emissive"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(227, 200, 148, 1.0)", "secondaryAlbedo": "rgba(143, 127, 92, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.9, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_confirm_led_ring_5.userData.actionProfile = {"animationRole": "indicator", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "led-emissive"}};
  (nodes["shell"] ?? root).add(node_confirm_led_ring_5);
  nodes["confirm-led-ring"] = node_confirm_led_ring_5;
  const mesh_confirm_led_ring_5Geometry = endpoint_confirm_led_ring_5
    ? new THREE.CylinderGeometry(endpoint_confirm_led_ring_5.endRadius, endpoint_confirm_led_ring_5.baseRadius, endpoint_confirm_led_ring_5.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.0257, 12, 48);
  if (!endpoint_confirm_led_ring_5) {
    mesh_confirm_led_ring_5Geometry.scale(0.2333333333333333, 0.2333333333333333, 0.2333333333333333);
  }
  const mesh_confirm_led_ring_5 = new THREE.Mesh(
    mesh_confirm_led_ring_5Geometry,
    materialMap["led-emissive"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_confirm_led_ring_5.name = "Confirm LED ring";
  if (endpoint_confirm_led_ring_5) {
    mesh_confirm_led_ring_5.position.copy(endpoint_confirm_led_ring_5.midpoint);
    mesh_confirm_led_ring_5.quaternion.copy(endpoint_confirm_led_ring_5.quaternion);
  }
  mesh_confirm_led_ring_5.castShadow = options.castShadow ?? true;
  mesh_confirm_led_ring_5.receiveShadow = options.receiveShadow ?? true;
  mesh_confirm_led_ring_5.userData.sculptComponent = {"id": "confirm-led-ring", "name": "Confirm LED ring", "level": "micro", "role": "indicator", "importance": 0.6, "confidence": 0.8, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Thin emissive ring set into the glass around the key (TorusGeometry 0.45 scaled to R 0.105; tube 0.006 W).", "geometryDescriptor": {"topologyIntent": "Thin emissive ring set into the glass around the key (TorusGeometry 0.45 scaled to R 0.105; tube 0.006 W).", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.0571}, "parent": "shell", "attachment": null, "dimensions": {"width": 0.21, "height": 0.21, "depth": 0.012, "units": "W", "confidence": 0.8}, "transform": {"position": [0.3, -0.59, 0.1515], "rotation": [0, 0, 0], "scale": [0.2333333333333333, 0.2333333333333333, 0.2333333333333333]}, "actionProfile": {"animationRole": "indicator", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "led-emissive"}}, "material": "led-emissive", "materialLayers": ["led-emissive"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(227, 200, 148, 1.0)", "secondaryAlbedo": "rgba(143, 127, 92, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.9, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_confirm_led_ring_5.add(mesh_confirm_led_ring_5);
  meshes["confirm-led-ring"] = mesh_confirm_led_ring_5;
  colliders["confirm-led-ring"] = {"type": "none", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"};
  destructionGroups["shell"] ??= [];
  destructionGroups["shell"].push(node_confirm_led_ring_5);

  const attachment_key_back_6 = {"parentId": "shell", "parentSocket": "front-face", "baseRadius": 0.06, "endRadius": 0.06, "contactType": "embed", "contactNormal": [0, 0, 1], "embedDepth": 0.003, "gapTolerance": 0.0015, "evidenceRefs": ["blueprint"], "localStart": [-0.32, -0.59, 0.148], "localEnd": [-0.32, -0.59, 0.158]};
  const endpoint_key_back_6 = makeAttachmentEndpoint(attachment_key_back_6);
  const node_key_back_6 = new THREE.Group();
  node_key_back_6.name = "Back key__pivot";
  node_key_back_6.scale.set(1, 1, 1);
  if (endpoint_key_back_6) {
    node_key_back_6.position.copy(endpoint_key_back_6.start);
    node_key_back_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_key_back_6.position.set(-0.32, -0.59, 0.153);
    node_key_back_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_key_back_6.userData.sculptComponent = {"id": "key-back", "name": "Back key", "level": "meso", "role": "button", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small round key; chevron glyph engraved.", "geometryDescriptor": {"topologyIntent": "Small round key; chevron glyph engraved.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.005, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "shell", "attachment": {"parentId": "shell", "parentSocket": "front-face", "baseRadius": 0.06, "endRadius": 0.06, "contactType": "embed", "contactNormal": [0, 0, 1], "embedDepth": 0.003, "gapTolerance": 0.0015, "evidenceRefs": ["blueprint"], "localStart": [-0.32, -0.59, 0.148], "localEnd": [-0.32, -0.59, 0.158]}, "dimensions": {"width": 0.12, "height": 0.12, "depth": 0.01, "units": "W", "confidence": 0.8}, "transform": {"position": [-0.32, -0.59, 0.153], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "control-press", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, -1], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": false}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "key-polymer"}}, "material": "key-polymer", "materialLayers": ["key-polymer"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "glyph", "kind": "groove", "description": "Engraved chevron ‹, 0.04 W"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.03, "bumpAmplitude": 0.0014, "normalPattern": "engraved chevron glyph (blurred canvas bump map)", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface pass DC-2, realised in src/device/walletRefine.ts"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(38, 40, 47, 1.0)", "secondaryAlbedo": "rgba(74, 76, 85, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_key_back_6.userData.actionProfile = {"animationRole": "control-press", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, -1], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": false}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "key-polymer"}};
  (nodes["shell"] ?? root).add(node_key_back_6);
  nodes["key-back"] = node_key_back_6;
  const mesh_key_back_6Geometry = endpoint_key_back_6
    ? new THREE.CylinderGeometry(endpoint_key_back_6.endRadius, endpoint_key_back_6.baseRadius, endpoint_key_back_6.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_key_back_6) {
    mesh_key_back_6Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_key_back_6 = new THREE.Mesh(
    mesh_key_back_6Geometry,
    materialMap["key-polymer"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_key_back_6.name = "Back key";
  if (endpoint_key_back_6) {
    mesh_key_back_6.position.copy(endpoint_key_back_6.midpoint);
    mesh_key_back_6.quaternion.copy(endpoint_key_back_6.quaternion);
  }
  mesh_key_back_6.castShadow = options.castShadow ?? true;
  mesh_key_back_6.receiveShadow = options.receiveShadow ?? true;
  mesh_key_back_6.userData.sculptComponent = {"id": "key-back", "name": "Back key", "level": "meso", "role": "button", "importance": 0.75, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small round key; chevron glyph engraved.", "geometryDescriptor": {"topologyIntent": "Small round key; chevron glyph engraved.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.005, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "shell", "attachment": {"parentId": "shell", "parentSocket": "front-face", "baseRadius": 0.06, "endRadius": 0.06, "contactType": "embed", "contactNormal": [0, 0, 1], "embedDepth": 0.003, "gapTolerance": 0.0015, "evidenceRefs": ["blueprint"], "localStart": [-0.32, -0.59, 0.148], "localEnd": [-0.32, -0.59, 0.158]}, "dimensions": {"width": 0.12, "height": 0.12, "depth": 0.01, "units": "W", "confidence": 0.8}, "transform": {"position": [-0.32, -0.59, 0.153], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "control-press", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, -1], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": false}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "key-polymer"}}, "material": "key-polymer", "materialLayers": ["key-polymer"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "glyph", "kind": "groove", "description": "Engraved chevron ‹, 0.04 W"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.03, "bumpAmplitude": 0.0014, "normalPattern": "engraved chevron glyph (blurred canvas bump map)", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface pass DC-2, realised in src/device/walletRefine.ts"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(38, 40, 47, 1.0)", "secondaryAlbedo": "rgba(74, 76, 85, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_key_back_6.add(mesh_key_back_6);
  meshes["key-back"] = mesh_key_back_6;
  colliders["key-back"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"};
  destructionGroups["shell"] ??= [];
  destructionGroups["shell"].push(node_key_back_6);

  const attachment_roller_7 = {"parentId": "shell", "parentSocket": "left-face", "baseRadius": 0.18, "endRadius": 0.18, "contactType": "embed", "contactNormal": [0, 0, 1], "embedDepth": 0.15, "gapTolerance": 0.0015, "evidenceRefs": ["blueprint"], "localStart": [-0.37, 0.29, 0.045], "localEnd": [-0.37, 0.29, 0.105]};
  const endpoint_roller_7 = makeAttachmentEndpoint(attachment_roller_7);
  const node_roller_7 = new THREE.Group();
  node_roller_7.name = "Thumb roller__pivot";
  node_roller_7.scale.set(1, 1, 1);
  if (endpoint_roller_7) {
    node_roller_7.position.copy(endpoint_roller_7.start);
    node_roller_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_roller_7.position.set(-0.37, 0.29, 0.075);
    node_roller_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_roller_7.userData.sculptComponent = {"id": "roller", "name": "Thumb roller", "level": "meso", "role": "wheel", "importance": 0.85, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Disc (axis Z) mostly inside the body; rim protrudes 0.05 W from the -X face giving a 0.26 W visible chord (DC-2: was 0.03, too little to find or hit).", "geometryDescriptor": {"topologyIntent": "Disc (axis Z) mostly inside the body; rim protrudes 0.05 W from the -X face giving a 0.26 W visible chord (DC-2: was 0.03, too little to find or hit).", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "shell", "attachment": {"parentId": "shell", "parentSocket": "left-face", "baseRadius": 0.18, "endRadius": 0.18, "contactType": "embed", "contactNormal": [0, 0, 1], "embedDepth": 0.15, "gapTolerance": 0.0015, "evidenceRefs": ["blueprint"], "localStart": [-0.37, 0.29, 0.045], "localEnd": [-0.37, 0.29, 0.105]}, "dimensions": {"width": 0.36, "height": 0.36, "depth": 0.06, "units": "W", "confidence": 0.8}, "transform": {"position": [-0.37, 0.29, 0.075], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "control-rotate", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": false}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "champagne-metal"}}, "material": "champagne-metal", "materialLayers": ["champagne-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "knurl", "kind": "ridge", "description": "72 radial ridges around the rim (repetition system roller-knurl)"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.02, "bumpAmplitude": 0.0, "normalPattern": "ridge edges catch the rim light", "displacementPattern": "72 knurl ridges as instanced geometry every 5°", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface pass DC-2, realised in src/device/walletRefine.ts"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(227, 200, 148, 1.0)", "secondaryAlbedo": "rgba(143, 127, 92, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.9, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_roller_7.userData.actionProfile = {"animationRole": "control-rotate", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": false}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "champagne-metal"}};
  (nodes["shell"] ?? root).add(node_roller_7);
  nodes["roller"] = node_roller_7;
  const mesh_roller_7Geometry = endpoint_roller_7
    ? new THREE.CylinderGeometry(endpoint_roller_7.endRadius, endpoint_roller_7.baseRadius, endpoint_roller_7.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_roller_7) {
    mesh_roller_7Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_roller_7 = new THREE.Mesh(
    mesh_roller_7Geometry,
    materialMap["champagne-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_roller_7.name = "Thumb roller";
  if (endpoint_roller_7) {
    mesh_roller_7.position.copy(endpoint_roller_7.midpoint);
    mesh_roller_7.quaternion.copy(endpoint_roller_7.quaternion);
  }
  mesh_roller_7.castShadow = options.castShadow ?? true;
  mesh_roller_7.receiveShadow = options.receiveShadow ?? true;
  mesh_roller_7.userData.sculptComponent = {"id": "roller", "name": "Thumb roller", "level": "meso", "role": "wheel", "importance": 0.85, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Disc (axis Z) mostly inside the body; rim protrudes 0.05 W from the -X face giving a 0.26 W visible chord (DC-2: was 0.03, too little to find or hit).", "geometryDescriptor": {"topologyIntent": "Disc (axis Z) mostly inside the body; rim protrudes 0.05 W from the -X face giving a 0.26 W visible chord (DC-2: was 0.03, too little to find or hit).", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "shell", "attachment": {"parentId": "shell", "parentSocket": "left-face", "baseRadius": 0.18, "endRadius": 0.18, "contactType": "embed", "contactNormal": [0, 0, 1], "embedDepth": 0.15, "gapTolerance": 0.0015, "evidenceRefs": ["blueprint"], "localStart": [-0.37, 0.29, 0.045], "localEnd": [-0.37, 0.29, 0.105]}, "dimensions": {"width": 0.36, "height": 0.36, "depth": 0.06, "units": "W", "confidence": 0.8}, "transform": {"position": [-0.37, 0.29, 0.075], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "control-rotate", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": false}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "champagne-metal"}}, "material": "champagne-metal", "materialLayers": ["champagne-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "knurl", "kind": "ridge", "description": "72 radial ridges around the rim (repetition system roller-knurl)"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.02, "bumpAmplitude": 0.0, "normalPattern": "ridge edges catch the rim light", "displacementPattern": "72 knurl ridges as instanced geometry every 5°", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface pass DC-2, realised in src/device/walletRefine.ts"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(227, 200, 148, 1.0)", "secondaryAlbedo": "rgba(143, 127, 92, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.9, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_roller_7.add(mesh_roller_7);
  meshes["roller"] = mesh_roller_7;
  colliders["roller"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"};
  destructionGroups["shell"] ??= [];
  destructionGroups["shell"].push(node_roller_7);

  const endpoint_tabs_8 = makeAttachmentEndpoint(null);
  const node_tabs_8 = new THREE.Group();
  node_tabs_8.name = "Section tab rail__pivot";
  node_tabs_8.scale.set(1, 1, 1);
  if (endpoint_tabs_8) {
    node_tabs_8.position.copy(endpoint_tabs_8.start);
    node_tabs_8.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_tabs_8.position.set(0.0, 0.7515, 0.075);
    node_tabs_8.rotation.set(0.0, 0.0, 0.0);
  }
  node_tabs_8.userData.sculptComponent = {"id": "tabs", "name": "Section tab rail", "level": "meso", "role": "rail", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Dark strip on the top face that the four tabs rise from.", "geometryDescriptor": {"topologyIntent": "Dark strip on the top face that the four tabs rise from.", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "shell", "attachment": null, "dimensions": {"width": 0.62, "height": 0.004, "depth": 0.09, "units": "W", "confidence": 0.8}, "transform": {"position": [0, 0.7515, 0.075], "rotation": [0, 0, 0], "scale": [0.62, 0.004, 0.09]}, "actionProfile": {"animationRole": "static-child", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "port-dark"}}, "material": "port-dark", "materialLayers": ["port-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rail", "kind": "hole", "description": "Dark strip the tabs rise from"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(6, 6, 7, 1.0)", "secondaryAlbedo": "rgba(58, 59, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_tabs_8.userData.actionProfile = {"animationRole": "static-child", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "port-dark"}};
  (nodes["shell"] ?? root).add(node_tabs_8);
  nodes["tabs"] = node_tabs_8;
  const mesh_tabs_8Geometry = endpoint_tabs_8
    ? new THREE.CylinderGeometry(endpoint_tabs_8.endRadius, endpoint_tabs_8.baseRadius, endpoint_tabs_8.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_tabs_8) {
    mesh_tabs_8Geometry.scale(0.62, 0.004, 0.09);
  }
  const mesh_tabs_8 = new THREE.Mesh(
    mesh_tabs_8Geometry,
    materialMap["port-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tabs_8.name = "Section tab rail";
  if (endpoint_tabs_8) {
    mesh_tabs_8.position.copy(endpoint_tabs_8.midpoint);
    mesh_tabs_8.quaternion.copy(endpoint_tabs_8.quaternion);
  }
  mesh_tabs_8.castShadow = options.castShadow ?? true;
  mesh_tabs_8.receiveShadow = options.receiveShadow ?? true;
  mesh_tabs_8.userData.sculptComponent = {"id": "tabs", "name": "Section tab rail", "level": "meso", "role": "rail", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Dark strip on the top face that the four tabs rise from.", "geometryDescriptor": {"topologyIntent": "Dark strip on the top face that the four tabs rise from.", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "shell", "attachment": null, "dimensions": {"width": 0.62, "height": 0.004, "depth": 0.09, "units": "W", "confidence": 0.8}, "transform": {"position": [0, 0.7515, 0.075], "rotation": [0, 0, 0], "scale": [0.62, 0.004, 0.09]}, "actionProfile": {"animationRole": "static-child", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "port-dark"}}, "material": "port-dark", "materialLayers": ["port-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rail", "kind": "hole", "description": "Dark strip the tabs rise from"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(6, 6, 7, 1.0)", "secondaryAlbedo": "rgba(58, 59, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_tabs_8.add(mesh_tabs_8);
  meshes["tabs"] = mesh_tabs_8;
  colliders["tabs"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"};
  destructionGroups["shell"] ??= [];
  destructionGroups["shell"].push(node_tabs_8);

  const endpoint_tab_01_9 = makeAttachmentEndpoint(null);
  const node_tab_01_9 = new THREE.Group();
  node_tab_01_9.name = "Section tab 01 (Works)__pivot";
  node_tab_01_9.scale.set(1, 1, 1);
  if (endpoint_tab_01_9) {
    node_tab_01_9.position.copy(endpoint_tab_01_9.start);
    node_tab_01_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_tab_01_9.position.set(-0.25, 0.0185, 0.0);
    node_tab_01_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_tab_01_9.userData.sculptComponent = {"id": "tab-01", "name": "Section tab 01 (Works)", "level": "meso", "role": "button", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Rounded key cap rising 0.08 W from the rail (DC-2: was 0.03 W, a sliver seen edge-on); pressed = active section, sunk 0.02 W. The screen's top row labels each tab directly beneath it (softkey labels).", "geometryDescriptor": {"topologyIntent": "Rounded key cap rising 0.08 W from the rail (DC-2: was 0.03 W, a sliver seen edge-on); pressed = active section, sunk 0.02 W. The screen's top row labels each tab directly beneath it (softkey labels).", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tabs", "attachment": null, "dimensions": {"width": 0.12, "height": 0.08, "depth": 0.08, "units": "W", "confidence": 0.8}, "transform": {"position": [-0.25, 0.0185, 0], "rotation": [0, 0, 0], "scale": [0.12, 0.08, 0.08]}, "actionProfile": {"animationRole": "control-press", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, -1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tabs", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "champagne-metal"}}, "material": "champagne-metal", "materialLayers": ["champagne-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "numeral", "kind": "groove", "description": "'01' engraved on the +Z face, 0.04 W tall, so the tab reads from the front"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.03, "bumpAmplitude": 0.0012, "normalPattern": "engraved '01' on the +Z face (canvas type decal)", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface pass DC-2, realised in src/device/walletRefine.ts"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(227, 200, 148, 1.0)", "secondaryAlbedo": "rgba(143, 127, 92, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.9, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_tab_01_9.userData.actionProfile = {"animationRole": "control-press", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, -1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tabs", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "champagne-metal"}};
  (nodes["tabs"] ?? root).add(node_tab_01_9);
  nodes["tab-01"] = node_tab_01_9;
  const mesh_tab_01_9Geometry = endpoint_tab_01_9
    ? new THREE.CylinderGeometry(endpoint_tab_01_9.endRadius, endpoint_tab_01_9.baseRadius, endpoint_tab_01_9.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_tab_01_9) {
    mesh_tab_01_9Geometry.scale(0.12, 0.08, 0.08);
  }
  const mesh_tab_01_9 = new THREE.Mesh(
    mesh_tab_01_9Geometry,
    materialMap["champagne-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tab_01_9.name = "Section tab 01 (Works)";
  if (endpoint_tab_01_9) {
    mesh_tab_01_9.position.copy(endpoint_tab_01_9.midpoint);
    mesh_tab_01_9.quaternion.copy(endpoint_tab_01_9.quaternion);
  }
  mesh_tab_01_9.castShadow = options.castShadow ?? true;
  mesh_tab_01_9.receiveShadow = options.receiveShadow ?? true;
  mesh_tab_01_9.userData.sculptComponent = {"id": "tab-01", "name": "Section tab 01 (Works)", "level": "meso", "role": "button", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Rounded key cap rising 0.08 W from the rail (DC-2: was 0.03 W, a sliver seen edge-on); pressed = active section, sunk 0.02 W. The screen's top row labels each tab directly beneath it (softkey labels).", "geometryDescriptor": {"topologyIntent": "Rounded key cap rising 0.08 W from the rail (DC-2: was 0.03 W, a sliver seen edge-on); pressed = active section, sunk 0.02 W. The screen's top row labels each tab directly beneath it (softkey labels).", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tabs", "attachment": null, "dimensions": {"width": 0.12, "height": 0.08, "depth": 0.08, "units": "W", "confidence": 0.8}, "transform": {"position": [-0.25, 0.0185, 0], "rotation": [0, 0, 0], "scale": [0.12, 0.08, 0.08]}, "actionProfile": {"animationRole": "control-press", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, -1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tabs", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "champagne-metal"}}, "material": "champagne-metal", "materialLayers": ["champagne-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "numeral", "kind": "groove", "description": "'01' engraved on the +Z face, 0.04 W tall, so the tab reads from the front"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.03, "bumpAmplitude": 0.0012, "normalPattern": "engraved '01' on the +Z face (canvas type decal)", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface pass DC-2, realised in src/device/walletRefine.ts"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(227, 200, 148, 1.0)", "secondaryAlbedo": "rgba(143, 127, 92, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.9, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_tab_01_9.add(mesh_tab_01_9);
  meshes["tab-01"] = mesh_tab_01_9;
  colliders["tab-01"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"};
  destructionGroups["tabs"] ??= [];
  destructionGroups["tabs"].push(node_tab_01_9);

  const endpoint_tab_02_10 = makeAttachmentEndpoint(null);
  const node_tab_02_10 = new THREE.Group();
  node_tab_02_10.name = "Section tab 02 (Chronicle)__pivot";
  node_tab_02_10.scale.set(1, 1, 1);
  if (endpoint_tab_02_10) {
    node_tab_02_10.position.copy(endpoint_tab_02_10.start);
    node_tab_02_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_tab_02_10.position.set(-0.085, 0.0385, 0.0);
    node_tab_02_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_tab_02_10.userData.sculptComponent = {"id": "tab-02", "name": "Section tab 02 (Chronicle)", "level": "meso", "role": "button", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Rounded key cap rising 0.08 W from the rail (DC-2: was 0.03 W, a sliver seen edge-on); pressed = active section, sunk 0.02 W. The screen's top row labels each tab directly beneath it (softkey labels).", "geometryDescriptor": {"topologyIntent": "Rounded key cap rising 0.08 W from the rail (DC-2: was 0.03 W, a sliver seen edge-on); pressed = active section, sunk 0.02 W. The screen's top row labels each tab directly beneath it (softkey labels).", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tabs", "attachment": null, "dimensions": {"width": 0.12, "height": 0.08, "depth": 0.08, "units": "W", "confidence": 0.8}, "transform": {"position": [-0.085, 0.0385, 0], "rotation": [0, 0, 0], "scale": [0.12, 0.08, 0.08]}, "actionProfile": {"animationRole": "control-press", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, -1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tabs", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "key-polymer"}}, "material": "key-polymer", "materialLayers": ["key-polymer"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "numeral", "kind": "groove", "description": "'02' engraved on the +Z face, 0.04 W tall, so the tab reads from the front"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.03, "bumpAmplitude": 0.0012, "normalPattern": "engraved '02' on the +Z face (canvas type decal)", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface pass DC-2, realised in src/device/walletRefine.ts"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(38, 40, 47, 1.0)", "secondaryAlbedo": "rgba(74, 76, 85, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_tab_02_10.userData.actionProfile = {"animationRole": "control-press", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, -1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tabs", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "key-polymer"}};
  (nodes["tabs"] ?? root).add(node_tab_02_10);
  nodes["tab-02"] = node_tab_02_10;
  const mesh_tab_02_10Geometry = endpoint_tab_02_10
    ? new THREE.CylinderGeometry(endpoint_tab_02_10.endRadius, endpoint_tab_02_10.baseRadius, endpoint_tab_02_10.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_tab_02_10) {
    mesh_tab_02_10Geometry.scale(0.12, 0.08, 0.08);
  }
  const mesh_tab_02_10 = new THREE.Mesh(
    mesh_tab_02_10Geometry,
    materialMap["key-polymer"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tab_02_10.name = "Section tab 02 (Chronicle)";
  if (endpoint_tab_02_10) {
    mesh_tab_02_10.position.copy(endpoint_tab_02_10.midpoint);
    mesh_tab_02_10.quaternion.copy(endpoint_tab_02_10.quaternion);
  }
  mesh_tab_02_10.castShadow = options.castShadow ?? true;
  mesh_tab_02_10.receiveShadow = options.receiveShadow ?? true;
  mesh_tab_02_10.userData.sculptComponent = {"id": "tab-02", "name": "Section tab 02 (Chronicle)", "level": "meso", "role": "button", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Rounded key cap rising 0.08 W from the rail (DC-2: was 0.03 W, a sliver seen edge-on); pressed = active section, sunk 0.02 W. The screen's top row labels each tab directly beneath it (softkey labels).", "geometryDescriptor": {"topologyIntent": "Rounded key cap rising 0.08 W from the rail (DC-2: was 0.03 W, a sliver seen edge-on); pressed = active section, sunk 0.02 W. The screen's top row labels each tab directly beneath it (softkey labels).", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tabs", "attachment": null, "dimensions": {"width": 0.12, "height": 0.08, "depth": 0.08, "units": "W", "confidence": 0.8}, "transform": {"position": [-0.085, 0.0385, 0], "rotation": [0, 0, 0], "scale": [0.12, 0.08, 0.08]}, "actionProfile": {"animationRole": "control-press", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, -1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tabs", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "key-polymer"}}, "material": "key-polymer", "materialLayers": ["key-polymer"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "numeral", "kind": "groove", "description": "'02' engraved on the +Z face, 0.04 W tall, so the tab reads from the front"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.03, "bumpAmplitude": 0.0012, "normalPattern": "engraved '02' on the +Z face (canvas type decal)", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface pass DC-2, realised in src/device/walletRefine.ts"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(38, 40, 47, 1.0)", "secondaryAlbedo": "rgba(74, 76, 85, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_tab_02_10.add(mesh_tab_02_10);
  meshes["tab-02"] = mesh_tab_02_10;
  colliders["tab-02"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"};
  destructionGroups["tabs"] ??= [];
  destructionGroups["tabs"].push(node_tab_02_10);

  const endpoint_tab_03_11 = makeAttachmentEndpoint(null);
  const node_tab_03_11 = new THREE.Group();
  node_tab_03_11.name = "Section tab 03 (About)__pivot";
  node_tab_03_11.scale.set(1, 1, 1);
  if (endpoint_tab_03_11) {
    node_tab_03_11.position.copy(endpoint_tab_03_11.start);
    node_tab_03_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_tab_03_11.position.set(0.085, 0.0385, 0.0);
    node_tab_03_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_tab_03_11.userData.sculptComponent = {"id": "tab-03", "name": "Section tab 03 (About)", "level": "meso", "role": "button", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Rounded key cap rising 0.08 W from the rail (DC-2: was 0.03 W, a sliver seen edge-on); pressed = active section, sunk 0.02 W. The screen's top row labels each tab directly beneath it (softkey labels).", "geometryDescriptor": {"topologyIntent": "Rounded key cap rising 0.08 W from the rail (DC-2: was 0.03 W, a sliver seen edge-on); pressed = active section, sunk 0.02 W. The screen's top row labels each tab directly beneath it (softkey labels).", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tabs", "attachment": null, "dimensions": {"width": 0.12, "height": 0.08, "depth": 0.08, "units": "W", "confidence": 0.8}, "transform": {"position": [0.085, 0.0385, 0], "rotation": [0, 0, 0], "scale": [0.12, 0.08, 0.08]}, "actionProfile": {"animationRole": "control-press", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, -1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tabs", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "key-polymer"}}, "material": "key-polymer", "materialLayers": ["key-polymer"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "numeral", "kind": "groove", "description": "'03' engraved on the +Z face, 0.04 W tall, so the tab reads from the front"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.03, "bumpAmplitude": 0.0012, "normalPattern": "engraved '03' on the +Z face (canvas type decal)", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface pass DC-2, realised in src/device/walletRefine.ts"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(38, 40, 47, 1.0)", "secondaryAlbedo": "rgba(74, 76, 85, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_tab_03_11.userData.actionProfile = {"animationRole": "control-press", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, -1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tabs", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "key-polymer"}};
  (nodes["tabs"] ?? root).add(node_tab_03_11);
  nodes["tab-03"] = node_tab_03_11;
  const mesh_tab_03_11Geometry = endpoint_tab_03_11
    ? new THREE.CylinderGeometry(endpoint_tab_03_11.endRadius, endpoint_tab_03_11.baseRadius, endpoint_tab_03_11.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_tab_03_11) {
    mesh_tab_03_11Geometry.scale(0.12, 0.08, 0.08);
  }
  const mesh_tab_03_11 = new THREE.Mesh(
    mesh_tab_03_11Geometry,
    materialMap["key-polymer"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tab_03_11.name = "Section tab 03 (About)";
  if (endpoint_tab_03_11) {
    mesh_tab_03_11.position.copy(endpoint_tab_03_11.midpoint);
    mesh_tab_03_11.quaternion.copy(endpoint_tab_03_11.quaternion);
  }
  mesh_tab_03_11.castShadow = options.castShadow ?? true;
  mesh_tab_03_11.receiveShadow = options.receiveShadow ?? true;
  mesh_tab_03_11.userData.sculptComponent = {"id": "tab-03", "name": "Section tab 03 (About)", "level": "meso", "role": "button", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Rounded key cap rising 0.08 W from the rail (DC-2: was 0.03 W, a sliver seen edge-on); pressed = active section, sunk 0.02 W. The screen's top row labels each tab directly beneath it (softkey labels).", "geometryDescriptor": {"topologyIntent": "Rounded key cap rising 0.08 W from the rail (DC-2: was 0.03 W, a sliver seen edge-on); pressed = active section, sunk 0.02 W. The screen's top row labels each tab directly beneath it (softkey labels).", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tabs", "attachment": null, "dimensions": {"width": 0.12, "height": 0.08, "depth": 0.08, "units": "W", "confidence": 0.8}, "transform": {"position": [0.085, 0.0385, 0], "rotation": [0, 0, 0], "scale": [0.12, 0.08, 0.08]}, "actionProfile": {"animationRole": "control-press", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, -1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tabs", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "key-polymer"}}, "material": "key-polymer", "materialLayers": ["key-polymer"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "numeral", "kind": "groove", "description": "'03' engraved on the +Z face, 0.04 W tall, so the tab reads from the front"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.03, "bumpAmplitude": 0.0012, "normalPattern": "engraved '03' on the +Z face (canvas type decal)", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface pass DC-2, realised in src/device/walletRefine.ts"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(38, 40, 47, 1.0)", "secondaryAlbedo": "rgba(74, 76, 85, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_tab_03_11.add(mesh_tab_03_11);
  meshes["tab-03"] = mesh_tab_03_11;
  colliders["tab-03"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"};
  destructionGroups["tabs"] ??= [];
  destructionGroups["tabs"].push(node_tab_03_11);

  const endpoint_tab_04_12 = makeAttachmentEndpoint(null);
  const node_tab_04_12 = new THREE.Group();
  node_tab_04_12.name = "Section tab 04 (Contact)__pivot";
  node_tab_04_12.scale.set(1, 1, 1);
  if (endpoint_tab_04_12) {
    node_tab_04_12.position.copy(endpoint_tab_04_12.start);
    node_tab_04_12.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_tab_04_12.position.set(0.25, 0.0385, 0.0);
    node_tab_04_12.rotation.set(0.0, 0.0, 0.0);
  }
  node_tab_04_12.userData.sculptComponent = {"id": "tab-04", "name": "Section tab 04 (Contact)", "level": "meso", "role": "button", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Rounded key cap rising 0.08 W from the rail (DC-2: was 0.03 W, a sliver seen edge-on); pressed = active section, sunk 0.02 W. The screen's top row labels each tab directly beneath it (softkey labels).", "geometryDescriptor": {"topologyIntent": "Rounded key cap rising 0.08 W from the rail (DC-2: was 0.03 W, a sliver seen edge-on); pressed = active section, sunk 0.02 W. The screen's top row labels each tab directly beneath it (softkey labels).", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tabs", "attachment": null, "dimensions": {"width": 0.12, "height": 0.08, "depth": 0.08, "units": "W", "confidence": 0.8}, "transform": {"position": [0.25, 0.0385, 0], "rotation": [0, 0, 0], "scale": [0.12, 0.08, 0.08]}, "actionProfile": {"animationRole": "control-press", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, -1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tabs", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "key-polymer"}}, "material": "key-polymer", "materialLayers": ["key-polymer"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "numeral", "kind": "groove", "description": "'04' engraved on the +Z face, 0.04 W tall, so the tab reads from the front"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.03, "bumpAmplitude": 0.0012, "normalPattern": "engraved '04' on the +Z face (canvas type decal)", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface pass DC-2, realised in src/device/walletRefine.ts"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(38, 40, 47, 1.0)", "secondaryAlbedo": "rgba(74, 76, 85, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_tab_04_12.userData.actionProfile = {"animationRole": "control-press", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, -1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tabs", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "key-polymer"}};
  (nodes["tabs"] ?? root).add(node_tab_04_12);
  nodes["tab-04"] = node_tab_04_12;
  const mesh_tab_04_12Geometry = endpoint_tab_04_12
    ? new THREE.CylinderGeometry(endpoint_tab_04_12.endRadius, endpoint_tab_04_12.baseRadius, endpoint_tab_04_12.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_tab_04_12) {
    mesh_tab_04_12Geometry.scale(0.12, 0.08, 0.08);
  }
  const mesh_tab_04_12 = new THREE.Mesh(
    mesh_tab_04_12Geometry,
    materialMap["key-polymer"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tab_04_12.name = "Section tab 04 (Contact)";
  if (endpoint_tab_04_12) {
    mesh_tab_04_12.position.copy(endpoint_tab_04_12.midpoint);
    mesh_tab_04_12.quaternion.copy(endpoint_tab_04_12.quaternion);
  }
  mesh_tab_04_12.castShadow = options.castShadow ?? true;
  mesh_tab_04_12.receiveShadow = options.receiveShadow ?? true;
  mesh_tab_04_12.userData.sculptComponent = {"id": "tab-04", "name": "Section tab 04 (Contact)", "level": "meso", "role": "button", "importance": 0.8, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Rounded key cap rising 0.08 W from the rail (DC-2: was 0.03 W, a sliver seen edge-on); pressed = active section, sunk 0.02 W. The screen's top row labels each tab directly beneath it (softkey labels).", "geometryDescriptor": {"topologyIntent": "Rounded key cap rising 0.08 W from the rail (DC-2: was 0.03 W, a sliver seen edge-on); pressed = active section, sunk 0.02 W. The screen's top row labels each tab directly beneath it (softkey labels).", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tabs", "attachment": null, "dimensions": {"width": 0.12, "height": 0.08, "depth": 0.08, "units": "W", "confidence": 0.8}, "transform": {"position": [0.25, 0.0385, 0], "rotation": [0, 0, 0], "scale": [0.12, 0.08, 0.08]}, "actionProfile": {"animationRole": "control-press", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, -1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tabs", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "key-polymer"}}, "material": "key-polymer", "materialLayers": ["key-polymer"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "numeral", "kind": "groove", "description": "'04' engraved on the +Z face, 0.04 W tall, so the tab reads from the front"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.03, "bumpAmplitude": 0.0012, "normalPattern": "engraved '04' on the +Z face (canvas type decal)", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface pass DC-2, realised in src/device/walletRefine.ts"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(38, 40, 47, 1.0)", "secondaryAlbedo": "rgba(74, 76, 85, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_tab_04_12.add(mesh_tab_04_12);
  meshes["tab-04"] = mesh_tab_04_12;
  colliders["tab-04"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"};
  destructionGroups["tabs"] ??= [];
  destructionGroups["tabs"].push(node_tab_04_12);

  const endpoint_switch_view_13 = makeAttachmentEndpoint(null);
  const node_switch_view_13 = new THREE.Group();
  node_switch_view_13.name = "View switch (Device \u2194 List)__pivot";
  node_switch_view_13.scale.set(1, 1, 1);
  if (endpoint_switch_view_13) {
    node_switch_view_13.position.copy(endpoint_switch_view_13.start);
    node_switch_view_13.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_switch_view_13.position.set(0.5125, 0.515, 0.075);
    node_switch_view_13.rotation.set(0.0, 0.0, 0.0);
  }
  node_switch_view_13.userData.sculptComponent = {"id": "switch-view", "name": "View switch (Device ↔ List)", "level": "meso", "role": "switch", "importance": 0.7, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "DC-2: the side switch toggles the 3D device view and the plain list view (Contra's calculator/spreadsheet toggle). Knob proud of the +X face by 0.03 W, travels ±0.045 W along Y: up = device, down = list.", "geometryDescriptor": {"topologyIntent": "DC-2: the side switch toggles the 3D device view and the plain list view (Contra's calculator/spreadsheet toggle). Knob proud of the +X face by 0.03 W, travels ±0.045 W along Y: up = device, down = list.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "shell", "attachment": null, "dimensions": {"width": 0.035, "height": 0.07, "depth": 0.04, "units": "W", "confidence": 0.8}, "transform": {"position": [0.5125, 0.515, 0.075], "rotation": [0, 0, 0], "scale": [0.035, 0.07, 0.04]}, "actionProfile": {"animationRole": "control-slide", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "key-polymer"}}, "material": "key-polymer", "materialLayers": ["key-polymer"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "grip", "kind": "ridge", "description": "Three horizontal grip ridges on the +X face of the knob"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.03, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "three horizontal grip ridges on the +X face", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface pass DC-2, realised in src/device/walletRefine.ts"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(38, 40, 47, 1.0)", "secondaryAlbedo": "rgba(74, 76, 85, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_switch_view_13.userData.actionProfile = {"animationRole": "control-slide", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "key-polymer"}};
  (nodes["shell"] ?? root).add(node_switch_view_13);
  nodes["switch-view"] = node_switch_view_13;
  const mesh_switch_view_13Geometry = endpoint_switch_view_13
    ? new THREE.CylinderGeometry(endpoint_switch_view_13.endRadius, endpoint_switch_view_13.baseRadius, endpoint_switch_view_13.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_switch_view_13) {
    mesh_switch_view_13Geometry.scale(0.035, 0.07, 0.04);
  }
  const mesh_switch_view_13 = new THREE.Mesh(
    mesh_switch_view_13Geometry,
    materialMap["key-polymer"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_switch_view_13.name = "View switch (Device \u2194 List)";
  if (endpoint_switch_view_13) {
    mesh_switch_view_13.position.copy(endpoint_switch_view_13.midpoint);
    mesh_switch_view_13.quaternion.copy(endpoint_switch_view_13.quaternion);
  }
  mesh_switch_view_13.castShadow = options.castShadow ?? true;
  mesh_switch_view_13.receiveShadow = options.receiveShadow ?? true;
  mesh_switch_view_13.userData.sculptComponent = {"id": "switch-view", "name": "View switch (Device ↔ List)", "level": "meso", "role": "switch", "importance": 0.7, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "DC-2: the side switch toggles the 3D device view and the plain list view (Contra's calculator/spreadsheet toggle). Knob proud of the +X face by 0.03 W, travels ±0.045 W along Y: up = device, down = list.", "geometryDescriptor": {"topologyIntent": "DC-2: the side switch toggles the 3D device view and the plain list view (Contra's calculator/spreadsheet toggle). Knob proud of the +X face by 0.03 W, travels ±0.045 W along Y: up = device, down = list.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "shell", "attachment": null, "dimensions": {"width": 0.035, "height": 0.07, "depth": 0.04, "units": "W", "confidence": 0.8}, "transform": {"position": [0.5125, 0.515, 0.075], "rotation": [0, 0, 0], "scale": [0.035, 0.07, 0.04]}, "actionProfile": {"animationRole": "control-slide", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "key-polymer"}}, "material": "key-polymer", "materialLayers": ["key-polymer"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "grip", "kind": "ridge", "description": "Three horizontal grip ridges on the +X face of the knob"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.03, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "three horizontal grip ridges on the +X face", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Surface pass DC-2, realised in src/device/walletRefine.ts"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(38, 40, 47, 1.0)", "secondaryAlbedo": "rgba(74, 76, 85, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_switch_view_13.add(mesh_switch_view_13);
  meshes["switch-view"] = mesh_switch_view_13;
  colliders["switch-view"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": true, "notes": "Raycast/click proxy for this control"};
  destructionGroups["shell"] ??= [];
  destructionGroups["shell"].push(node_switch_view_13);

  const endpoint_card_slot_14 = makeAttachmentEndpoint(null);
  const node_card_slot_14 = new THREE.Group();
  node_card_slot_14.name = "Card reader slot__pivot";
  node_card_slot_14.scale.set(1, 1, 1);
  if (endpoint_card_slot_14) {
    node_card_slot_14.position.copy(endpoint_card_slot_14.start);
    node_card_slot_14.rotation.set(0.0, 1.5708, 0.0);
  } else {
    node_card_slot_14.position.set(0.5004, -0.02, 0.075);
    node_card_slot_14.rotation.set(0.0, 1.5708, 0.0);
  }
  node_card_slot_14.userData.sculptComponent = {"id": "card-slot", "name": "Card reader slot", "level": "meso", "role": "slot", "importance": 0.8, "confidence": 0.8, "primitive": "plane-card", "topologyClass": "surface-relief", "topologyRationale": "DC-2: the Contact payoff. Dean's key card goes in here (short edge first, 0.5 W deep) and comes back out with the details written on it. Mouth on the +X face below the view switch, centred in the body's thickness.", "geometryDescriptor": {"topologyIntent": "DC-2: the Contact payoff. Dean's key card goes in here (short edge first, 0.5 W deep) and comes back out with the details written on it. Mouth on the +X face below the view switch, centred in the body's thickness.", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "shell", "attachment": null, "dimensions": {"width": 0.03, "height": 0.58, "depth": 1, "units": "W", "confidence": 0.8}, "transform": {"position": [0.5004, -0.02, 0.075], "rotation": [0, 1.5708, 0], "scale": [0.03, 0.58, 1]}, "actionProfile": {"animationRole": "static-child", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "port-dark"}}, "material": "port-dark", "materialLayers": ["port-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "mouth", "kind": "hole", "description": "0.58 x 0.03 W dark opening"}, {"id": "lip", "kind": "bevel", "description": "Chamfered champagne lip around the mouth so the slot reads from a three-quarter view"}, {"id": "reader-led", "kind": "emissive", "description": "Status LED dot above the mouth: blinks while reading, holds when written"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "mouth reads as a deep dark cavity; champagne lip catches light", "edgeWearPattern": "", "notes": "Surface pass DC-2, realised in src/device/walletRefine.ts"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(6, 6, 7, 1.0)", "secondaryAlbedo": "rgba(58, 59, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_card_slot_14.userData.actionProfile = {"animationRole": "static-child", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "port-dark"}};
  (nodes["shell"] ?? root).add(node_card_slot_14);
  nodes["card-slot"] = node_card_slot_14;
  const mesh_card_slot_14Geometry = endpoint_card_slot_14
    ? new THREE.CylinderGeometry(endpoint_card_slot_14.endRadius, endpoint_card_slot_14.baseRadius, endpoint_card_slot_14.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_card_slot_14) {
    mesh_card_slot_14Geometry.scale(0.03, 0.58, 1.0);
  }
  const mesh_card_slot_14 = new THREE.Mesh(
    mesh_card_slot_14Geometry,
    materialMap["port-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_card_slot_14.name = "Card reader slot";
  if (endpoint_card_slot_14) {
    mesh_card_slot_14.position.copy(endpoint_card_slot_14.midpoint);
    mesh_card_slot_14.quaternion.copy(endpoint_card_slot_14.quaternion);
  }
  mesh_card_slot_14.castShadow = options.castShadow ?? true;
  mesh_card_slot_14.receiveShadow = options.receiveShadow ?? true;
  mesh_card_slot_14.userData.sculptComponent = {"id": "card-slot", "name": "Card reader slot", "level": "meso", "role": "slot", "importance": 0.8, "confidence": 0.8, "primitive": "plane-card", "topologyClass": "surface-relief", "topologyRationale": "DC-2: the Contact payoff. Dean's key card goes in here (short edge first, 0.5 W deep) and comes back out with the details written on it. Mouth on the +X face below the view switch, centred in the body's thickness.", "geometryDescriptor": {"topologyIntent": "DC-2: the Contact payoff. Dean's key card goes in here (short edge first, 0.5 W deep) and comes back out with the details written on it. Mouth on the +X face below the view switch, centred in the body's thickness.", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "shell", "attachment": null, "dimensions": {"width": 0.03, "height": 0.58, "depth": 1, "units": "W", "confidence": 0.8}, "transform": {"position": [0.5004, -0.02, 0.075], "rotation": [0, 1.5708, 0], "scale": [0.03, 0.58, 1]}, "actionProfile": {"animationRole": "static-child", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "port-dark"}}, "material": "port-dark", "materialLayers": ["port-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "mouth", "kind": "hole", "description": "0.58 x 0.03 W dark opening"}, {"id": "lip", "kind": "bevel", "description": "Chamfered champagne lip around the mouth so the slot reads from a three-quarter view"}, {"id": "reader-led", "kind": "emissive", "description": "Status LED dot above the mouth: blinks while reading, holds when written"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "mouth reads as a deep dark cavity; champagne lip catches light", "edgeWearPattern": "", "notes": "Surface pass DC-2, realised in src/device/walletRefine.ts"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(6, 6, 7, 1.0)", "secondaryAlbedo": "rgba(58, 59, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_card_slot_14.add(mesh_card_slot_14);
  meshes["card-slot"] = mesh_card_slot_14;
  colliders["card-slot"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"};
  destructionGroups["shell"] ??= [];
  destructionGroups["shell"].push(node_card_slot_14);

  const endpoint_port_15 = makeAttachmentEndpoint(null);
  const node_port_15 = new THREE.Group();
  node_port_15.name = "USB-C port__pivot";
  node_port_15.scale.set(1, 1, 1);
  if (endpoint_port_15) {
    node_port_15.position.copy(endpoint_port_15.start);
    node_port_15.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_port_15.position.set(0.0, -0.7515, 0.075);
    node_port_15.rotation.set(0.0, 0.0, 0.0);
  }
  node_port_15.userData.sculptComponent = {"id": "port", "name": "USB-C port", "level": "micro", "role": "port", "importance": 0.4, "confidence": 0.8, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Stadium-shaped dark opening with a light tongue, centred on the bottom face.", "geometryDescriptor": {"topologyIntent": "Stadium-shaped dark opening with a light tongue, centred on the bottom face.", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "shell", "attachment": null, "dimensions": {"width": 0.15, "height": 0.004, "depth": 0.04, "units": "W", "confidence": 0.8}, "transform": {"position": [0, -0.7515, 0.075], "rotation": [0, 0, 0], "scale": [0.15, 0.004, 0.04]}, "actionProfile": {"animationRole": "static-child", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "port-dark"}}, "material": "port-dark", "materialLayers": ["port-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "usb-c", "kind": "hole", "description": "0.15 x 0.04 W stadium opening + 0.09 W tongue"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(6, 6, 7, 1.0)", "secondaryAlbedo": "rgba(58, 59, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_port_15.userData.actionProfile = {"animationRole": "static-child", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "port-dark"}};
  (nodes["shell"] ?? root).add(node_port_15);
  nodes["port"] = node_port_15;
  const mesh_port_15Geometry = endpoint_port_15
    ? new THREE.CylinderGeometry(endpoint_port_15.endRadius, endpoint_port_15.baseRadius, endpoint_port_15.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_port_15) {
    mesh_port_15Geometry.scale(0.15, 0.004, 0.04);
  }
  const mesh_port_15 = new THREE.Mesh(
    mesh_port_15Geometry,
    materialMap["port-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_port_15.name = "USB-C port";
  if (endpoint_port_15) {
    mesh_port_15.position.copy(endpoint_port_15.midpoint);
    mesh_port_15.quaternion.copy(endpoint_port_15.quaternion);
  }
  mesh_port_15.castShadow = options.castShadow ?? true;
  mesh_port_15.receiveShadow = options.receiveShadow ?? true;
  mesh_port_15.userData.sculptComponent = {"id": "port", "name": "USB-C port", "level": "micro", "role": "port", "importance": 0.4, "confidence": 0.8, "primitive": "box", "topologyClass": "surface-relief", "topologyRationale": "Stadium-shaped dark opening with a light tongue, centred on the bottom face.", "geometryDescriptor": {"topologyIntent": "Stadium-shaped dark opening with a light tongue, centred on the bottom face.", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "shell", "attachment": null, "dimensions": {"width": 0.15, "height": 0.004, "depth": 0.04, "units": "W", "confidence": 0.8}, "transform": {"position": [0, -0.7515, 0.075], "rotation": [0, 0, 0], "scale": [0.15, 0.004, 0.04]}, "actionProfile": {"animationRole": "static-child", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "port-dark"}}, "material": "port-dark", "materialLayers": ["port-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "usb-c", "kind": "hole", "description": "0.15 x 0.04 W stadium opening + 0.09 W tongue"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(6, 6, 7, 1.0)", "secondaryAlbedo": "rgba(58, 59, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_port_15.add(mesh_port_15);
  meshes["port"] = mesh_port_15;
  colliders["port"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"};
  destructionGroups["shell"] ??= [];
  destructionGroups["shell"].push(node_port_15);

  const endpoint_lanyard_slot_16 = makeAttachmentEndpoint(null);
  const node_lanyard_slot_16 = new THREE.Group();
  node_lanyard_slot_16.name = "Lanyard slot__pivot";
  node_lanyard_slot_16.scale.set(1, 1, 1);
  if (endpoint_lanyard_slot_16) {
    node_lanyard_slot_16.position.copy(endpoint_lanyard_slot_16.start);
    node_lanyard_slot_16.rotation.set(1.5708, 0.0, 0.0);
  } else {
    node_lanyard_slot_16.position.set(-0.3, -0.7504, 0.075);
    node_lanyard_slot_16.rotation.set(1.5708, 0.0, 0.0);
  }
  node_lanyard_slot_16.userData.sculptComponent = {"id": "lanyard-slot", "name": "Lanyard slot", "level": "micro", "role": "slot", "importance": 0.6, "confidence": 0.8, "primitive": "plane-card", "topologyClass": "surface-relief", "topologyRationale": "Flush rounded-rect opening with bevel lip (createLanyardSlot in src/device/keychain.ts); the keychain bar sits 0.02 W inside.", "geometryDescriptor": {"topologyIntent": "Flush rounded-rect opening with bevel lip (createLanyardSlot in src/device/keychain.ts); the keychain bar sits 0.02 W inside.", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "shell", "attachment": null, "dimensions": {"width": 0.046, "height": 0.066, "depth": 1, "units": "W", "confidence": 0.8}, "transform": {"position": [-0.3, -0.7504, 0.075], "rotation": [1.5708, 0, 0], "scale": [0.046, 0.066, 1]}, "actionProfile": {"animationRole": "static-child", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "port-dark"}}, "material": "port-dark", "materialLayers": ["port-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "opening", "kind": "hole", "description": "0.04 x 0.06 W opening + 0.003 W lip (smaller charm, DC-2), within the flat part of the bottom face"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(6, 6, 7, 1.0)", "secondaryAlbedo": "rgba(58, 59, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_lanyard_slot_16.userData.actionProfile = {"animationRole": "static-child", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "port-dark"}};
  (nodes["shell"] ?? root).add(node_lanyard_slot_16);
  nodes["lanyard-slot"] = node_lanyard_slot_16;
  const mesh_lanyard_slot_16Geometry = endpoint_lanyard_slot_16
    ? new THREE.CylinderGeometry(endpoint_lanyard_slot_16.endRadius, endpoint_lanyard_slot_16.baseRadius, endpoint_lanyard_slot_16.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_lanyard_slot_16) {
    mesh_lanyard_slot_16Geometry.scale(0.046, 0.066, 1.0);
  }
  const mesh_lanyard_slot_16 = new THREE.Mesh(
    mesh_lanyard_slot_16Geometry,
    materialMap["port-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lanyard_slot_16.name = "Lanyard slot";
  if (endpoint_lanyard_slot_16) {
    mesh_lanyard_slot_16.position.copy(endpoint_lanyard_slot_16.midpoint);
    mesh_lanyard_slot_16.quaternion.copy(endpoint_lanyard_slot_16.quaternion);
  }
  mesh_lanyard_slot_16.castShadow = options.castShadow ?? true;
  mesh_lanyard_slot_16.receiveShadow = options.receiveShadow ?? true;
  mesh_lanyard_slot_16.userData.sculptComponent = {"id": "lanyard-slot", "name": "Lanyard slot", "level": "micro", "role": "slot", "importance": 0.6, "confidence": 0.8, "primitive": "plane-card", "topologyClass": "surface-relief", "topologyRationale": "Flush rounded-rect opening with bevel lip (createLanyardSlot in src/device/keychain.ts); the keychain bar sits 0.02 W inside.", "geometryDescriptor": {"topologyIntent": "Flush rounded-rect opening with bevel lip (createLanyardSlot in src/device/keychain.ts); the keychain bar sits 0.02 W inside.", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "shell", "attachment": null, "dimensions": {"width": 0.046, "height": 0.066, "depth": 1, "units": "W", "confidence": 0.8}, "transform": {"position": [-0.3, -0.7504, 0.075], "rotation": [1.5708, 0, 0], "scale": [0.046, 0.066, 1]}, "actionProfile": {"animationRole": "static-child", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": false, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "port-dark"}}, "material": "port-dark", "materialLayers": ["port-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "opening", "kind": "hole", "description": "0.04 x 0.06 W opening + 0.003 W lip (smaller charm, DC-2), within the flat part of the bottom face"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(6, 6, 7, 1.0)", "secondaryAlbedo": "rgba(58, 59, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_lanyard_slot_16.add(mesh_lanyard_slot_16);
  meshes["lanyard-slot"] = mesh_lanyard_slot_16;
  colliders["lanyard-slot"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"};
  destructionGroups["shell"] ??= [];
  destructionGroups["shell"].push(node_lanyard_slot_16);

  const endpoint_contact_card_17 = makeAttachmentEndpoint(null);
  const node_contact_card_17 = new THREE.Group();
  node_contact_card_17.name = "Key card (inserted pose)__pivot";
  node_contact_card_17.scale.set(1, 1, 1);
  if (endpoint_contact_card_17) {
    node_contact_card_17.position.copy(endpoint_contact_card_17.start);
    node_contact_card_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_contact_card_17.position.set(0.43, -0.02, 0.075);
    node_contact_card_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_contact_card_17.userData.sculptComponent = {"id": "contact-card", "name": "Key card (inserted pose)", "level": "macro", "role": "card", "importance": 0.7, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Dean's key card (src/device/keyCard.ts), recovery-key card language in Dean's branding at bank-card proportions (DC-2, ISO ID-1 ratio): charcoal matte soft-touch, four-point-star marks in stepped clusters at two corners, four larger stars framing the centre, DEAN STUDIO engraved; debossed D-star on the back. Shown here fully inserted in the card-slot (0.5 W deep, 0.36 W proud). It enters blank and ejects with the details written inside the frame. Not in the viewport until the visitor asks to contact Dean.", "geometryDescriptor": {"topologyIntent": "Dean's key card (src/device/keyCard.ts), recovery-key card language in Dean's branding at bank-card proportions (DC-2, ISO ID-1 ratio): charcoal matte soft-touch, four-point-star marks in stepped clusters at two corners, four larger stars framing the centre, DEAN STUDIO engraved; debossed D-star on the back. Shown here fully inserted in the card-slot (0.5 W deep, 0.36 W proud). It enters blank and ejects with the details written inside the frame. Not in the viewport until the visitor asks to contact Dean.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "shell", "attachment": null, "dimensions": {"width": 0.86, "height": 0.54, "depth": 0.02, "units": "W", "confidence": 0.8}, "transform": {"position": [0.43, -0.02, 0.075], "rotation": [0, 0, 0], "scale": [0.86, 0.54, 0.02]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [{"id": "css3d-card", "localPosition": [0, 0, 0.0105], "normal": [0, 0, 1], "notes": "details overlay inside the star frame"}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": ["contact-card"], "breakImpulse": 0.0, "debrisMaterial": "key-card-matte"}}, "material": "key-card-matte", "materialLayers": ["key-card-matte"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.12, "bumpAmplitude": 0.0012, "normalPattern": "seeded soft-touch grain; star marks raised, engraving recessed", "displacementPattern": "", "occlusionPattern": "engraved letters darker in the cavity", "edgeWearPattern": "", "notes": "Surface pass DC-2, realised in src/device/walletRefine.ts"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 23, 27, 1.0)", "secondaryAlbedo": "rgba(228, 207, 159, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_contact_card_17.userData.actionProfile = {"animationRole": "detachable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [{"id": "css3d-card", "localPosition": [0, 0, 0.0105], "normal": [0, 0, 1], "notes": "details overlay inside the star frame"}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": ["contact-card"], "breakImpulse": 0.0, "debrisMaterial": "key-card-matte"}};
  (nodes["shell"] ?? root).add(node_contact_card_17);
  nodes["contact-card"] = node_contact_card_17;
  const mesh_contact_card_17Geometry = endpoint_contact_card_17
    ? new THREE.CylinderGeometry(endpoint_contact_card_17.endRadius, endpoint_contact_card_17.baseRadius, endpoint_contact_card_17.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_contact_card_17) {
    mesh_contact_card_17Geometry.scale(0.86, 0.54, 0.02);
  }
  const mesh_contact_card_17 = new THREE.Mesh(
    mesh_contact_card_17Geometry,
    materialMap["key-card-matte"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_contact_card_17.name = "Key card (inserted pose)";
  if (endpoint_contact_card_17) {
    mesh_contact_card_17.position.copy(endpoint_contact_card_17.midpoint);
    mesh_contact_card_17.quaternion.copy(endpoint_contact_card_17.quaternion);
  }
  mesh_contact_card_17.castShadow = options.castShadow ?? true;
  mesh_contact_card_17.receiveShadow = options.receiveShadow ?? true;
  mesh_contact_card_17.userData.sculptComponent = {"id": "contact-card", "name": "Key card (inserted pose)", "level": "macro", "role": "card", "importance": 0.7, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Dean's key card (src/device/keyCard.ts), recovery-key card language in Dean's branding at bank-card proportions (DC-2, ISO ID-1 ratio): charcoal matte soft-touch, four-point-star marks in stepped clusters at two corners, four larger stars framing the centre, DEAN STUDIO engraved; debossed D-star on the back. Shown here fully inserted in the card-slot (0.5 W deep, 0.36 W proud). It enters blank and ejects with the details written inside the frame. Not in the viewport until the visitor asks to contact Dean.", "geometryDescriptor": {"topologyIntent": "Dean's key card (src/device/keyCard.ts), recovery-key card language in Dean's branding at bank-card proportions (DC-2, ISO ID-1 ratio): charcoal matte soft-touch, four-point-star marks in stepped clusters at two corners, four larger stars framing the centre, DEAN STUDIO engraved; debossed D-star on the back. Shown here fully inserted in the card-slot (0.5 W deep, 0.36 W proud). It enters blank and ejects with the details written inside the frame. Not in the viewport until the visitor asks to contact Dean.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "shell", "attachment": null, "dimensions": {"width": 0.86, "height": 0.54, "depth": 0.02, "units": "W", "confidence": 0.8}, "transform": {"position": [0.43, -0.02, 0.075], "rotation": [0, 0, 0], "scale": [0.86, 0.54, 0.02]}, "actionProfile": {"animationRole": "detachable", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [{"id": "css3d-card", "localPosition": [0, 0, 0.0105], "normal": [0, 0, 1], "notes": "details overlay inside the star frame"}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shell", "seamRefs": [], "detachableFragments": ["contact-card"], "breakImpulse": 0.0, "debrisMaterial": "key-card-matte"}}, "material": "key-card-matte", "materialLayers": ["key-card-matte"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.12, "bumpAmplitude": 0.0012, "normalPattern": "seeded soft-touch grain; star marks raised, engraving recessed", "displacementPattern": "", "occlusionPattern": "engraved letters darker in the cavity", "edgeWearPattern": "", "notes": "Surface pass DC-2, realised in src/device/walletRefine.ts"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 23, 27, 1.0)", "secondaryAlbedo": "rgba(228, 207, 159, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.8, "evidenceRefs": ["docs/device-design.md#body-finish"]}};
  node_contact_card_17.add(mesh_contact_card_17);
  meshes["contact-card"] = mesh_contact_card_17;
  colliders["contact-card"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "static proxy"};
  destructionGroups["shell"] ??= [];
  destructionGroups["shell"].push(node_contact_card_17);
  const socket_contact_card_css3d_card_0 = new THREE.Object3D();
  socket_contact_card_css3d_card_0.name = "css3d-card";
  socket_contact_card_css3d_card_0.position.set(0.0, 0.0, 0.0105);
  socket_contact_card_css3d_card_0.rotation.set(0, 0, 0);
  socket_contact_card_css3d_card_0.userData.socket = {"id": "css3d-card", "localPosition": [0, 0, 0.0105], "normal": [0, 0, 1], "notes": "details overlay inside the star frame"};
  node_contact_card_17.add(socket_contact_card_css3d_card_0);
  sockets["contact-card:css3d-card"] = socket_contact_card_css3d_card_0;

  // repetition system: roller-knurl (InstancedMesh, radial, count=72, level=meso)
  {
    const parent = nodes["roller"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    const mat = materialMap["champagne-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.1, 0.1, 0.1];
    const axis = new THREE.Vector3(0.0, 0.0, 1.0).normalize();
    const radius = 0.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 72);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 72; i++) {
      const ang = ((0.0) + (i * 360) / 72) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "roller-knurl";
    parent.add(cluster);
  }

  // repetition system: section-tabs (InstancedMesh, radial, count=4, level=meso)
  {
    const parent = nodes["tabs"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    const mat = materialMap["key-polymer"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.1, 0.1, 0.1];
    const axis = new THREE.Vector3(0.0, 0.0, 1.0).normalize();
    const radius = 0.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 4);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 4; i++) {
      const ang = ((0.0) + (i * 360) / 4) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "section-tabs";
    parent.add(cluster);
  }

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "balanced", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."], "qualityPriorityRationale": "Surfaces are an ORIGINAL designed CMF (docs/device-design.md, lab/materials.html), deliberately not the reference's; reference-fidelity texture extraction would import Ledger trade dress. Form factor is still gated against the photo (Tier-1 silhouette) and every material is declared textureless with evidence."};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createDeanFiHardwareWalletLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "DeanFi hardware wallet look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = [{"type": "environment", "source": "RoomEnvironment PMREM (sigma 0.04)", "notes": "reflections drive iridescence and glass"}, {"type": "key", "direction": [-3, 4, 5], "intensity": 1.3, "notes": "upper-left key light, matches ref 1 highlight side"}, {"type": "rim", "direction": [4, 1, -3], "intensity": 0.8, "color": "#b9a6ff", "notes": "cool rim light separates the dark edge from the page background"}, {"type": "tone", "notes": "AgX tone mapping, exposure 1.1, sRGB output"}, {"type": "shadow", "notes": "soft contact shadow (blurred ground-shadow plane / ContactShadows) under the device; no hard shadow maps"}];
  lights.userData.lookDevTargets = {"qualityPriority": "balanced", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."], "qualityPriorityRationale": "Surfaces are an ORIGINAL designed CMF (docs/device-design.md, lab/materials.html), deliberately not the reference's; reference-fidelity texture extraction would import Ledger trade dress. Form factor is still gated against the photo (Tier-1 silhouette) and every material is declared textureless with evidence."};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createDeanFiHardwareWalletEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameDeanFiHardwareWalletCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createDeanFiHardwareWalletPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureDeanFiHardwareWalletRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createDeanFiHardwareWalletInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
