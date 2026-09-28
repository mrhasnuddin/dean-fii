// Keychain lab: stand-in device body + the real keychain module, cycling through scroll-like poses.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Keychain, SLOT, createLanyardSlot } from '../device/keychain';

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0f1014');
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const key = new THREE.DirectionalLight('#ffffff', 1.3);
key.position.set(-3, 4, 5);
scene.add(key);

const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

// Stand-in body (1 × 1.5 × 0.15 W) with the chosen iridescent finish. Edge radius 0.03 W matches the
// reference's face-to-side roll-off (RoundedBox can't also do the 0.09 W plan-view corners).
const device = new THREE.Group();
scene.add(device);
const body = new THREE.Mesh(
  new RoundedBoxGeometry(1, 1.5, 0.15, 5, 0.03),
  new THREE.MeshPhysicalMaterial({
    color: '#2a2b31', metalness: 0.8, roughness: 0.3,
    iridescence: 1, iridescenceIOR: 1.8, iridescenceThicknessRange: [250, 650],
    clearcoat: 0.5, clearcoatRoughness: 0.2,
  }),
);
const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 1.36), new THREE.MeshPhysicalMaterial({ color: '#0b0b0d', roughness: 0.05, clearcoat: 1 }));
glass.position.set(0, 0.03, 0.0755);
const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.79, 1.05), new THREE.MeshBasicMaterial({ color: '#e8e3d6' }));
screen.position.set(0, 0.16, 0.077);
device.add(body, glass, screen);

// Lanyard bar sits inside a slot in the bottom edge at x = −0.30 W, 0.02 W above the bottom face.
const anchor = new THREE.Object3D();
anchor.position.set(-0.3, -0.75 + SLOT.depthAboveFace, 0);
anchor.add(createLanyardSlot());
device.add(anchor);

const keychain = new Keychain({
  anchor,
  collider: { object: device, halfExtents: new THREE.Vector3(0.5, 0.75, 0.075) },
});
scene.add(keychain.group);

// Poses the site's scroll choreography will use (yaw/pitch/roll + small drift).
const poses = [
  { p: [0, 0.35, 0], r: [0.08, -0.45, 0.04] },
  { p: [0.1, 0.4, 0], r: [-0.05, 0.35, -0.03] },
  { p: [-0.05, 0.3, 0], r: [0.12, -0.95, 0.06] },
  { p: [0, 0.38, 0], r: [0.05, Math.PI - 0.35, 0] },
  { p: [0, 0.35, 0], r: [0.08, -0.45, 0.04] },
] as const;
let auto = true;
let poseT = 0;
let shakeT = -1;
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function applyPose(t: number) {
  const seg = 3.2; // 1.4 s move + 1.8 s hold
  const i = Math.floor(t / seg) % (poses.length - 1);
  const k = ease(Math.min(((t % seg) / 1.4), 1));
  const a = poses[i];
  const b = poses[i + 1];
  device.position.set(...(a.p.map((v, j) => v + (b.p[j] - v) * k) as [number, number, number]));
  device.rotation.set(...(a.r.map((v, j) => v + (b.r[j] - v) * k) as [number, number, number]));
}

type View = { pos: THREE.Vector3; target: THREE.Vector3 };
const views: Record<string, () => View> = {
  all: () => ({ pos: new THREE.Vector3(0.5, 0.2, 5.4), target: new THREE.Vector3(0, 0, 0) }),
  hook: () => {
    const t = anchor.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.1, 0));
    return { pos: t.clone().add(new THREE.Vector3(0.25, -0.12, 0.42)), target: t };
  },
  coin: () => {
    const t = keychain.coin.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.29, 0));
    return { pos: t.clone().add(new THREE.Vector3(0.12, 0.05, 0.85)), target: t };
  },
};
let flight: { from: View; to: View; t: number } | null = null;
function fly(name: keyof typeof views) {
  flight = { from: { pos: camera.position.clone(), target: controls.target.clone() }, to: views[name](), t: 0 };
}
const all = views.all();
camera.position.copy(all.pos);
controls.target.copy(all.target);

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const $ = (id: string) => document.getElementById(id)!;
$('poses').addEventListener('click', (e) => {
  auto = !auto;
  (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(auto));
});
$('shake').addEventListener('click', () => (shakeT = 0));
$('nudge').addEventListener('click', () => keychain.nudge());
$('view-all').addEventListener('click', () => fly('all'));
$('view-hook').addEventListener('click', () => fly('hook'));
$('view-coin').addEventListener('click', () => fly('coin'));

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
canvas.addEventListener('pointerdown', (e) => {
  ndc.set((e.offsetX / canvas.clientWidth) * 2 - 1, -(e.offsetY / canvas.clientHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  if (ray.intersectObject(keychain.coin, true).length) keychain.nudge(1.2);
});

applyPose(0);
keychain.reset();
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (auto) poseT += dt;
  applyPose(poseT); // re-applied every frame so the shake offset below never accumulates
  if (shakeT >= 0) {
    shakeT += dt;
    const s = Math.max(0, 1 - shakeT / 0.8);
    device.position.x += Math.sin(shakeT * 38) * 0.03 * s;
    device.rotation.z += Math.sin(shakeT * 31) * 0.02 * s;
    if (shakeT > 0.8) shakeT = -1;
  }
  keychain.update(dt);
  if (flight) {
    flight.t = Math.min(flight.t + dt / 0.9, 1);
    const k = ease(flight.t);
    camera.position.lerpVectors(flight.from.pos, flight.to.pos, k);
    controls.target.lerpVectors(flight.from.target, flight.to.target, k);
    if (flight.t === 1) flight = null;
  }
  controls.update();
  renderer.render(scene, camera);
});
