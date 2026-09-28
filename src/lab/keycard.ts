// Key card look-dev: the foil card tilting under the site's dark studio environment (default) or the
// neutral RoomEnvironment, so the reflection and thin-film shift can be judged. ?capture=1 saves frames.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createKeyCard } from '../device/keyCard';
import { createStudioEnvironment } from '../device/studioEnvironment';

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0f1014');
const studio = createStudioEnvironment(renderer);
const room = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
// Same direct lights as the site's contact scene: matte surfaces live on diffuse light, not reflections.
const key = new THREE.DirectionalLight('#ffffff', 1.1);
key.position.set(-3, 4, 5);
const rim = new THREE.DirectionalLight('#b9a6ff', 0.7);
rim.position.set(4, 1, -3);
scene.add(key, rim);

const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
camera.position.set(0, 0, 2.4);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

let env: THREE.Texture = studio;
let card = createKeyCard(env);
scene.add(card.group);

function setEnv(next: THREE.Texture) {
  env = next;
  scene.remove(card.group);
  card.dispose();
  card = createKeyCard(env);
  scene.add(card.group);
}

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

let spin = true;
const $ = (id: string) => document.getElementById(id)!;
$('env').onclick = (e) => {
  const useStudio = env !== studio;
  setEnv(useStudio ? studio : room);
  (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(useStudio));
  (e.currentTarget as HTMLElement).textContent = useStudio ? 'Studio env (site)' : 'Room env (neutral)';
};
$('spin').onclick = (e) => {
  spin = !spin;
  (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(spin));
};

async function captureTilts() {
  const out: string[] = [];
  for (const [i, [rx, ry]] of [[0.0, 0.0], [0.12, -0.35], [0.05, Math.PI], [0.15, 0.6]].entries()) {
    card.group.rotation.set(rx, ry, 0);
    renderer.render(scene, camera);
    const name = `keycard-tilt-${i}`;
    await fetch(`/__capture?name=${name}`, { method: 'POST', body: canvas.toDataURL('image/png') });
    out.push(name);
  }
  return out;
}
Object.assign(window, { captureTilts });

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
  if (spin) card.group.rotation.set(Math.sin(t * 0.5) * 0.14, Math.sin(t * 0.35) * 0.6, 0);
  controls.update();
  renderer.render(scene, camera);
});
