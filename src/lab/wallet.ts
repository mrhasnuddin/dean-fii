// Review harness for the generated wallet factory: fixed review cameras, light/dark backgrounds,
// and "capture all views" which saves PNGs through the dev-only /__capture endpoint.
// URL: /lab/wallet.html?pass=blockout
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { applyRestState, refineForm, refineMaterials, runtimeOf, type GpuTier } from '../device/walletRefine';
import { Keychain } from '../device/keychain';

const PASS_ORDER = ['blockout', 'structural-pass', 'form-refinement', 'material-pass', 'surface-pass', 'lighting-pass', 'interaction-pass', 'optimization-pass'];

type Factory = { create: () => THREE.Group };
const modules = import.meta.glob('../device/generated/wallet*.ts');
const pass = new URLSearchParams(location.search).get('pass') ?? 'blockout';
const file = `../device/generated/wallet${pass.split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join('')}.ts`;

// Review cameras (azimuth about +Y from the front, elevation), matching the spec's reviewViewpoints.
// `tilt` pitches the MODEL about its X axis (degrees) before the orbit camera looks at it: a product
// shot of a tilted device gives slanted vertical edges with level top/bottom edges (a shear), which no
// camera orbit or roll reproduces.
const VIEWS: Record<string, { az: number; el: number; dist?: number; size?: [number, number]; roll?: number; tilt?: number; fy?: number }> = {
  // Matches references/wallet/1.png framing (front-right, right edge visible): object fills ~85% of
  // the frame height, bbox aspect 0.63 (measured with PIL on both images).
  // Pose fitted by two 27-point grids scored with the Tier-1 formulas (.img2threejs/iou.py) against
  // .img2threejs/analysis/ref1-silhouette.png: az 40, tilt −10, el 0 → IoU 0.929, aspectΔ 0.001, scaleΔ 0.012.
  'ref-match': { az: 40, el: 0, dist: 3.85, tilt: -10, size: [758, 986] }, // 2× the reference's 379×493 frame
  'three-quarter': { az: -32, el: 8 }, // site hero pose: left edge (roller) toward the camera
  front: { az: 0, el: 0 },
  left: { az: -90, el: 0 },
  right: { az: 90, el: 0 },
  rear: { az: 180, el: 0 },
  top: { az: 0, el: 89 },
  bottom: { az: 0, el: -89 },
  'chin-closeup': { az: -18, el: -8, dist: 2.2 },
  // Surface pass (DC-2): the affordance details up close.
  'right-closeup': { az: 62, el: 6, dist: 2.6 }, // card slot + lip + reader LED, view switch + icons
  'left-closeup': { az: -62, el: 6, dist: 2.6 }, // roller + ▲▼ marks
  'top-closeup': { az: 0, el: 28, dist: 1.5, fy: 0.66 }, // numbered tabs 01–04, focused on the top edge
  'underside': { az: -30, el: -40, dist: 3.2 },
  // Showcase: site hero pose with room for the keychain below.
  hero: { az: -28, el: 6, dist: 6.2, tilt: -4, size: [900, 1200], fy: -0.35 },
  'hero-back': { az: 150, el: 8, dist: 6.2, size: [900, 1200], fy: -0.35 },
};

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const status = document.getElementById('status')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(800, 1000, false);
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const key = new THREE.DirectionalLight('#ffffff', 1.3);
key.position.set(-3, 4, 5);
const rim = new THREE.DirectionalLight('#b9a6ff', 0.8);
rim.position.set(4, 1, -3);
scene.add(key, rim);

const camera = new THREE.PerspectiveCamera(28, 0.8, 0.01, 50);
const controls = new OrbitControls(camera, canvas);

function setBg(mode: string) {
  scene.background = new THREE.Color(mode === 'dark' ? '#0f1014' : '#f2f2f2');
}

let model: THREE.Object3D | null = null;

function setView(name: string) {
  const v = VIEWS[name];
  if (model) model.rotation.set(THREE.MathUtils.degToRad(v.tilt ?? 0), 0, 0);
  const [w, h] = v.size ?? [800, 1000];
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const dist = v.dist ?? 5.2;
  const az = THREE.MathUtils.degToRad(v.az);
  const el = THREE.MathUtils.degToRad(v.el);
  const focus = name === 'chin-closeup' ? new THREE.Vector3(0, -0.55, 0) : new THREE.Vector3(0, v.fy ?? 0, 0);
  camera.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist).add(focus);
  camera.up.set(0, Math.abs(v.el) > 80 ? 0 : 1, Math.abs(v.el) > 80 ? -Math.sign(v.el) : 0);
  controls.target.copy(focus);
  camera.lookAt(focus);
  controls.update();
  // Camera roll (degrees, +ve = image rotates clockwise); OrbitControls resets it on the next
  // interactive update, captures render straight after setView so they keep it.
  if (v.roll) camera.rotateZ(THREE.MathUtils.degToRad(v.roll));
}

async function main() {
  const load = modules[file];
  if (!load) {
    status.textContent = `no generated factory for pass "${pass}" (${file})`;
    return;
  }
  const mod = (await load()) as Record<string, unknown>;
  const createName = Object.keys(mod).find((k) => /^create.*Model$/.test(k))!;
  const factory: Factory = { create: mod[createName] as () => THREE.Group };
  model = factory.create();
  const passIndex = PASS_ORDER.indexOf(pass);
  if (passIndex >= PASS_ORDER.indexOf('form-refinement')) {
    refineForm(model);
    applyRestState(model);
  }
  const tier = (new URLSearchParams(location.search).get('tier') ?? 'high') as GpuTier;
  if (passIndex >= PASS_ORDER.indexOf('material-pass')) refineMaterials(model, tier, scene.environment);
  scene.add(model);
  status.textContent = `pass: ${pass} · ${createName}`;

  // ?keychain=1 hangs the real keychain module from the wallet's keychain-anchor socket.
  let keychain: Keychain | null = null;
  const anchor = runtimeOf(model).sockets['shell:keychain-anchor'];
  if (new URLSearchParams(location.search).get('keychain') === '1' && anchor) {
    keychain = new Keychain({ anchor, collider: { object: model, halfExtents: new THREE.Vector3(0.5, 0.75, 0.075) } });
    scene.add(keychain.group);
    model.updateMatrixWorld(true);
    keychain.update(1 / 60);
  }
  const clock = new THREE.Clock();

  const viewSel = document.getElementById('view') as HTMLSelectElement;
  const bgSel = document.getElementById('bg') as HTMLSelectElement;
  Object.keys(VIEWS).forEach((n) => viewSel.add(new Option(n, n)));
  viewSel.onchange = () => setView(viewSel.value);
  bgSel.onchange = () => setBg(bgSel.value);
  setBg('light');
  setView('three-quarter');

  document.getElementById('capture')!.onclick = () => captureAll();
  Object.assign(window, { captureAll, captureView, VIEWS });

  renderer.setAnimationLoop(() => {
    if (capturing) return;
    keychain?.update(clock.getDelta());
    controls.update();
    renderer.render(scene, camera);
  });
  Object.assign(window, { keychain, model });
}

let capturing = false; // the interactive loop must not re-render (and reset roll) mid-capture

async function captureView(name: string, bg = 'light', outName = `${pass}-${name}`) {
  capturing = true;
  setBg(bg);
  setView(name);
  renderer.render(scene, camera);
  const png = canvas.toDataURL('image/png');
  capturing = false;
  await fetch(`/__capture?name=${outName}`, { method: 'POST', body: png });
  return outName;
}

async function captureAll(bg = 'light') {
  capturing = true;
  setBg(bg);
  const saved: string[] = [];
  for (const name of Object.keys(VIEWS)) {
    setView(name);
    renderer.render(scene, camera);
    const png = canvas.toDataURL('image/png');
    const id = `${pass}-${name}${bg === 'dark' ? '-dark' : ''}`;
    await fetch(`/__capture?name=${id}`, { method: 'POST', body: png });
    saved.push(id);
  }
  // Map-stripped evidence: same ref-match camera, every material replaced by an unlit flat colour.
  setView('ref-match');
  const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    originals.set(m, m.material);
    const src = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    m.material = new THREE.MeshBasicMaterial({ color: src.color ?? new THREE.Color('#888888') });
  });
  renderer.render(scene, camera);
  await fetch(`/__capture?name=${pass}-ref-match-stripped`, { method: 'POST', body: canvas.toDataURL('image/png') });
  originals.forEach((mat, m) => (m.material = mat));
  saved.push(`${pass}-ref-match-stripped`);

  setView('three-quarter');
  capturing = false;
  status.textContent = `captured ${saved.length} views for ${pass}`;
  return saved;
}

main();
