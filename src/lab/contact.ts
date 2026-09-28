// Contact section study: the visitor presses "Contact me" (or the wallet's ✓ key); Dean's NFC key card
// enters from off-screen, taps the wallet's back plate, the wallet reads it, and the details are
// written onto the card. The card is NOT in the viewport before that intent.
// Stages (docs/device-design.md §8): A prompt · B enter + approach · C contact · D reading · E write ·
// F ready. Reduced motion jumps straight to the written card.
import * as THREE from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import gsap from 'gsap';
import { createWallet } from '../device/wallet';
import { createStudioEnvironment } from '../device/studioEnvironment';
import { Keychain } from '../device/keychain';
import { CARD, createKeyCard } from '../device/keyCard';
import { createEinkScreen } from '../ui/einkScreen';
import { createContactCard, setContactCardWritten } from '../ui/contactCard';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const OVERLAY_PX = 240; // .contact-card--overlay width

// ---------------------------------------------------------------- renderers
const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.1;
const css = new CSS3DRenderer();
document.getElementById('css3d')!.append(css.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0f1014');
const env = createStudioEnvironment(renderer);
scene.environment = env;
const key = new THREE.DirectionalLight('#ffffff', 1.1);
key.position.set(-3, 4, 5);
const rim = new THREE.DirectionalLight('#b9a6ff', 0.7);
rim.position.set(4, 1, -3);
scene.add(key, rim);
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);

// ---------------------------------------------------------------- objects
const wallet = createWallet({ envMap: env });
scene.add(wallet.root);

const keychain = new Keychain({
  anchor: wallet.keychainAnchor,
  collider: { object: wallet.root, halfExtents: new THREE.Vector3(0.5, 0.75, 0.075) },
  reducedMotion: reduceMotion,
});
scene.add(keychain.group);

const card = createKeyCard(env);
card.group.visible = false; // off until the visitor asks to get in touch
scene.add(card.group);

const screen = createEinkScreen();
const cssScreen = new CSS3DObject(screen.el);
cssScreen.scale.setScalar(0.795 / 360);
wallet.screenSocket.add(cssScreen);

const label = createContactCard('overlay');
setContactCardWritten(label, false);
const cssLabel = new CSS3DObject(label);
cssLabel.scale.setScalar(CARD.label.w / OVERLAY_PX);
card.labelAnchor.add(cssLabel);

// ---------------------------------------------------------------- layout (desktop / portrait)
const L = {
  walletPos: new THREE.Vector3(),
  walletIdle: new THREE.Euler(0.04, 0.3, 0),
  walletRead: new THREE.Euler(0.04, 0.16, 0),
  walletTap: new THREE.Euler(0.05, -2.2, 0), // back turned toward the card, still visible to the camera
  cardEntry: new THREE.Vector3(), // just outside the right edge of the frame
  cardEntryRot: new THREE.Euler(0.3, -1.1, 0.4),
  cardFinal: new THREE.Vector3(),
  cardFinalRot: new THREE.Euler(0.02, -0.16, 0),
};
let state: 'idle' | 'running' | 'ready' = 'idle';

function layout() {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  css.setSize(w, h);
  camera.aspect = w / h;
  const portrait = w / h < 0.9;
  if (portrait) {
    camera.position.set(0, -0.3, 8.2);
    L.walletPos.set(0, 0.7, 0);
    L.cardFinal.set(0, -1.0, 1.7);
  } else {
    camera.position.set(0.05, -0.1, 5.6);
    L.walletPos.set(-0.55, 0.12, 0);
    L.cardFinal.set(0.52, -0.02, 1.5); // close to the camera so the written details read comfortably
  }
  camera.lookAt(0.05, -0.28, 0);
  camera.updateProjectionMatrix();
  // Entry point: beyond the right edge of the view at the card's depth, slightly low.
  const halfW = Math.tan(THREE.MathUtils.degToRad(15)) * camera.aspect * (camera.position.z - 0.8);
  L.cardEntry.set(halfW + 1.0, -0.7, 0.8);
  if (state === 'idle') {
    wallet.root.position.copy(L.walletPos);
    wallet.root.rotation.copy(L.walletIdle);
  }
}
addEventListener('resize', layout);
layout();
keychain.reset();

// ---------------------------------------------------------------- helpers
const live = document.getElementById('live')!;
const cta = document.getElementById('tap') as HTMLButtonElement;

/** Tween an object's orientation to `to` (slerp), as a GSAP tween. */
function slerpTo(obj: THREE.Object3D, to: THREE.Quaternion, duration: number, ease: string) {
  const from = new THREE.Quaternion();
  const p = { t: 0 };
  return gsap.to(p, {
    t: 1, duration, ease,
    onStart: () => from.copy(obj.quaternion),
    onUpdate: () => obj.quaternion.slerpQuaternions(from, to, p.t),
  });
}

/** World pose of the NFC contact point on the wallet's back plate, with the wallet at `rot`. */
function contactPose(rot: THREE.Euler) {
  const saved = wallet.root.rotation.clone();
  wallet.root.rotation.copy(rot);
  wallet.root.updateMatrixWorld(true);
  // Card sits flat on the plate (logo emboss is 0.0035 proud), turned 8° in-plane for a hand-held feel.
  const pos = wallet.root.localToWorld(new THREE.Vector3(0.02, 0.3, -0.077 - 0.0045 - CARD.thickness / 2));
  const wq = wallet.root.getWorldQuaternion(new THREE.Quaternion());
  const quat = wq.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.14)));
  const away = new THREE.Vector3(0, 0, -1).applyQuaternion(wq);
  wallet.root.rotation.copy(saved);
  wallet.root.updateMatrixWorld(true);
  return { pos, quat, pre: pos.clone().addScaledVector(away, 0.35) };
}

/** Physical press on the wallet's ✓ key (it is also a trigger): snaps down, settles back up. */
const confirmNode = wallet.runtime.nodes['key-confirm'];
const confirmRestZ = confirmNode?.position.z ?? 0; // fixed rest, so repeated presses never drift
function pressConfirm() {
  if (!confirmNode || reduceMotion) return;
  gsap.killTweensOf(confirmNode.position);
  gsap.timeline()
    .to(confirmNode.position, { z: confirmRestZ - 0.004, duration: 0.06, ease: 'power2.out' })
    .to(confirmNode.position, { z: confirmRestZ, duration: 0.16, ease: 'power3.out' });
}

// ---------------------------------------------------------------- the sequence
function run() {
  if (state !== 'idle') return;
  state = 'running';
  cta.disabled = true;
  live.textContent = 'Reading Dean’s key';

  if (reduceMotion) {
    wallet.root.rotation.copy(L.walletRead);
    card.group.position.copy(L.cardFinal);
    card.group.rotation.copy(L.cardFinalRot);
    card.group.visible = true;
    screen.setState('verified', false);
    setContactCardWritten(label, true);
    return ready();
  }

  const tap = contactPose(L.walletTap);
  card.group.position.copy(L.cardEntry);
  card.group.rotation.copy(L.cardEntryRot);
  card.group.visible = true;

  const tl = gsap.timeline();
  // B · enter + approach (0–0.7 s): wallet turns its back; card flies in from off-screen, flattens to the plate.
  tl.to(wallet.root.rotation, { x: L.walletTap.x, y: L.walletTap.y, duration: 0.6, ease: 'power2.inOut' }, 0);
  tl.to(card.group.position, { x: tap.pre.x, y: tap.pre.y, z: tap.pre.z, duration: 0.56, ease: 'power3.out' }, 0);
  tl.add(slerpTo(card.group, tap.quat, 0.56, 'power2.inOut'), 0);
  tl.to(card.group.position, { x: tap.pos.x, y: tap.pos.y, z: tap.pos.z, duration: 0.14, ease: 'power2.in' }, 0.56); // accelerate into the tap

  // C · contact (0.7 s): card rides with the wallet; recoil, LED flash, keychain swing, e-ink refresh.
  const T = 0.7;
  tl.call(() => {
    wallet.root.attach(card.group);
    keychain.nudge(0.7);
    screen.setState('reading');
  }, [], T);
  tl.to(wallet.root.rotation, { z: 0.035, duration: 0.07, ease: 'power1.out' }, T);
  tl.to(wallet.root.rotation, { z: 0, duration: 0.35, ease: 'back.out(2.5)' }, T + 0.07);
  tl.to(wallet.led, { emissiveIntensity: 3, duration: 0.06, ease: 'none' }, T);
  tl.to(wallet.led, { emissiveIntensity: 0.6, duration: 0.5, ease: 'power2.out' }, T + 0.06);

  // D · reading (0.95–1.7 s): wallet turns back to the visitor, card still pressed to its back.
  tl.to(wallet.root.rotation, { x: L.walletRead.x, y: L.walletRead.y, duration: 0.75, ease: 'power2.inOut' }, T + 0.25);

  // E · write (1.75 s →).
  tl.call(write, [], T + 1.05);
}

function write() {
  scene.attach(card.group);
  screen.setState('verified');
  const start = card.group.position.clone();
  const out = gsap.timeline({ onComplete: ready });
  out.to(card.group.position, { x: start.x + 0.9, y: start.y + 0.04, z: start.z + 0.3, duration: 0.45, ease: 'power2.out' }, 0);
  out.add(slerpTo(card.group, new THREE.Quaternion().setFromEuler(L.cardFinalRot), 0.8, 'power3.out'), 0);
  out.to(card.group.position, { x: L.cardFinal.x, y: L.cardFinal.y, z: L.cardFinal.z, duration: 0.45, ease: 'power3.out' }, 0.4);
  out.call(() => setContactCardWritten(label, true), [], 0.62);
}

function ready() {
  state = 'ready';
  live.textContent = 'Contact details ready: email, LinkedIn and WhatsApp.';
  cta.textContent = 'Put the key away';
  cta.disabled = false;
}

/** Send the card back off-screen and return to the prompt. */
function putAway() {
  if (state !== 'ready') return;
  state = 'running';
  cta.disabled = true;
  setContactCardWritten(label, false);
  screen.setState('prompt');
  const done = () => {
    card.group.visible = false;
    state = 'idle';
    cta.textContent = 'Contact me';
    cta.disabled = false;
  };
  if (reduceMotion) {
    wallet.root.rotation.copy(L.walletIdle);
    return done();
  }
  const tl = gsap.timeline({ onComplete: done });
  // Exit is a system response: quicker than the entrance, leaves the way it came, ease-out (no ease-in on UI).
  tl.to(card.group.position, { x: L.cardEntry.x, y: L.cardEntry.y, z: L.cardEntry.z, duration: 0.4, ease: 'power2.out' }, 0);
  tl.add(slerpTo(card.group, new THREE.Quaternion().setFromEuler(L.cardEntryRot), 0.4, 'power2.out'), 0);
  tl.to(wallet.root.rotation, { x: L.walletIdle.x, y: L.walletIdle.y, duration: 0.4, ease: 'power2.inOut' }, 0);
}

cta.addEventListener('click', () => (state === 'ready' ? putAway() : run()));

// The wallet's own ✓ key triggers the same intent (the screen says "or press ✓").
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
canvas.addEventListener('pointerdown', (e) => {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const confirmKey = wallet.runtime.meshes['key-confirm'];
  if (state === 'idle' && confirmKey && ray.intersectObject(confirmKey, true).length) {
    pressConfirm();
    run();
  }
});
canvas.addEventListener('pointermove', (e) => {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const confirmKey = wallet.runtime.meshes['key-confirm'];
  canvas.style.cursor = state === 'idle' && confirmKey && ray.intersectObject(confirmKey, true).length ? 'pointer' : '';
});

// CSS3D surfaces always draw above WebGL and `backface-visibility` is not reliable under CSS3D's
// matrix3d (the screen showed mirrored over the wallet's back). Hide each surface whenever its
// outward normal (+Z) faces away from the camera, or its 3D object is hidden.
const cssSurfaces = [cssScreen, cssLabel];
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
function updateCssFacing() {
  for (const o of cssSurfaces) {
    let shown = true;
    o.traverseAncestors((a) => (shown &&= a.visible));
    o.getWorldPosition(_p);
    _n.set(0, 0, 1).applyQuaternion(o.getWorldQuaternion(_q));
    const facing = _n.dot(_p.sub(camera.position).negate()) > 0;
    o.element.style.visibility = shown && facing ? '' : 'hidden';
  }
}

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  keychain.update(clock.getDelta());
  renderer.render(scene, camera);
  updateCssFacing();
  css.render(scene, camera);
});

// Review helpers: freeze every tween at `seconds` after starting the sequence.
Object.assign(window, {
  debug: { cssScreen, cssLabel, camera, wallet, card },
  runAndPauseAt(seconds: number) {
    gsap.globalTimeline.resume();
    run();
    gsap.delayedCall(seconds, () => gsap.globalTimeline.pause());
  },
  resumeAll: () => gsap.globalTimeline.resume(),
  putAway,
});
