// Material study: compares candidate body finishes on a stand-in slab (1 × 1.5 × 0.15 W).
// Throwaway lab page, not shipped. The real model comes from the img2threejs pipeline.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0f1014');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
camera.position.set(0, 0.1, 7.2);

const key = new THREE.DirectionalLight('#ffffff', 1.4);
key.position.set(-3, 4, 5);
scene.add(key);

// Vertical gradient that drives thin-film thickness, like heat-tinted titanium.
function thicknessGradient(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#202020');
  grad.addColorStop(0.5, '#b0b0b0');
  grad.addColorStop(1, '#505050');
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 256);
  return new THREE.CanvasTexture(c);
}

const finishes: THREE.MeshPhysicalMaterial[] = [
  new THREE.MeshPhysicalMaterial({
    color: '#2a2b31', metalness: 0.8, roughness: 0.3,
    iridescence: 1, iridescenceIOR: 1.8, iridescenceThicknessRange: [250, 650],
    clearcoat: 0.5, clearcoatRoughness: 0.2,
  }),
  new THREE.MeshPhysicalMaterial({
    color: '#3a3b42', metalness: 1, roughness: 0.22,
    iridescence: 1, iridescenceIOR: 2.0, iridescenceThicknessRange: [100, 900],
    iridescenceThicknessMap: thicknessGradient(),
  }),
  new THREE.MeshPhysicalMaterial({
    color: '#15161a', metalness: 0.35, roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.35,
  }),
];

const bodyGeo = new RoundedBoxGeometry(1, 1.5, 0.15, 6, 0.07);
const screenGeo = new THREE.PlaneGeometry(0.79, 1.05);
const screenMat = new THREE.MeshBasicMaterial({ color: '#e8e3d6' });
const glassGeo = new THREE.PlaneGeometry(0.86, 1.36);
const glassMat = new THREE.MeshPhysicalMaterial({ color: '#0b0b0d', roughness: 0.05, clearcoat: 1 });
const keyGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.02, 48);
const keyMat = new THREE.MeshPhysicalMaterial({ color: '#e4cf9f', metalness: 1, roughness: 0.28 });

const devices = finishes.map((mat, i) => {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(bodyGeo, mat));
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.position.set(0, 0.03, 0.0755);
  const screen = new THREE.Mesh(screenGeo, screenMat);
  screen.position.set(0, 0.16, 0.077);
  const k = new THREE.Mesh(keyGeo, keyMat);
  k.rotation.x = Math.PI / 2;
  k.position.set(0.3, -0.56, 0.08);
  g.add(glass, screen, k);
  g.position.x = (i - 1) * 1.7;
  scene.add(g);
  return g;
});

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Narrow screens: pull back so all three slabs fit.
  camera.position.z = w / h < 1 ? 7.2 / (w / h) * 0.75 : 7.2;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
renderer.setAnimationLoop((t) => {
  const s = reduce ? 0.6 : t / 1000;
  // Full slow turn so the back plate (the largest body surface) is visible too.
  devices.forEach((d, i) => {
    d.rotation.y = s * 0.45 + i * 0.5;
    d.rotation.x = Math.sin(s * 0.4 + i) * 0.12 - 0.05;
  });
  renderer.render(scene, camera);
});
