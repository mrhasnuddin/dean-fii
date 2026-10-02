// The fixed 3D stage: renderer + CSS3D layer, dark studio environment, the wallet (rig → pose →
// tilt → actor → wallet.root), keychain, key card, the e-ink screen and the card's written details.
// `rig` is posed by scroll (Hero ↔ Console); `pose` holds the section move (choreography); `tilt`
// follows the cursor, floats, and carries the intro; `actor` holds transient offsets (contact
// sequence, recoil). No two systems share a transform.
import * as THREE from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import { createWallet, type Wallet } from '../device/wallet';
import { createStudioEnvironment } from '../device/studioEnvironment';
import { Keychain } from '../device/keychain';
import { CARD, createKeyCard, type KeyCard } from '../device/keyCard';
import type { GpuTier } from '../device/walletRefine';
import { createStickers, type Sticker } from '../device/stickers';
import { createScreen, type Screen } from '../ui/screen';
import { createContactCard, setContactCardWritten } from '../ui/contactCard';
import { motion } from '../motion';

const OVERLAY_PX = 240;

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rig: THREE.Group;
  pose: THREE.Group;
  tilt: THREE.Group;
  actor: THREE.Group;
  /** Intro offsets (tweened to 0 as the loader lifts): drop in W, turn in rad, scale delta. */
  intro: { y: number; ry: number; s: number };
  /** Cursor follow + idle float. Off during the contact sequence so the card meets a still plate. */
  follow(on: boolean): void;
  /** Hold the current tilt while the pointer is on the wallet, so a key never drifts under it. */
  hold(on: boolean): void;
  /** Resolves once shaders are compiled and the first frame is on screen. */
  ready: Promise<void>;
  /** Run or pause the render loop (list view pauses it: no 3D is shown). */
  setActive(on: boolean): void;
  wallet: Wallet;
  keychain: Keychain;
  card: KeyCard;
  screen: Screen;
  label: HTMLElement;
  /** Back-plate stickers (easter egg); filled once built, after the first frame. */
  stickers: Sticker[];
  /** Viewport half-width at depth z (world units), for layout. */
  halfWidthAt(z: number): number;
  onFrame(cb: (dt: number) => void): void;
  onResize(cb: () => void): void;
  portrait(): boolean;
}

function gpuTier(renderer: THREE.WebGLRenderer): GpuTier {
  const forced = new URLSearchParams(location.search).get('tier');
  if (forced === 'low' || forced === 'high') return forced;
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  // Software rasterisers can't afford thin-film iridescence at 60 fps.
  return /swiftshader|llvmpipe|software|basic render/i.test(name) ? 'low' : 'high';
}

/** `studioEnv`: the baked environment (loadBakedEnvironment); null generates it here, which is slow. */
export function createStage(canvas: HTMLCanvasElement, cssHost: HTMLElement, studioEnv: THREE.Texture | null): Stage {
  // alpha: the page's radial glow (site.css .stage) shows through behind the wallet.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  const coarse = matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 2));
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.1;
  const css = new CSS3DRenderer();
  cssHost.append(css.domElement);

  const scene = new THREE.Scene(); // no background: transparent over the page's glow
  const env = studioEnv ?? createStudioEnvironment(renderer);
  scene.environment = env;
  const key = new THREE.DirectionalLight('#ffffff', 1.1);
  key.position.set(-3, 4, 5);
  const rimLight = new THREE.DirectionalLight('#b9a6ff', 0.7);
  rimLight.position.set(4, 1, -3);
  scene.add(key, rimLight);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 60);

  const rig = new THREE.Group();
  rig.name = 'wallet-rig';
  const pose = new THREE.Group();
  pose.name = 'wallet-pose';
  const tilt = new THREE.Group();
  tilt.name = 'wallet-tilt';
  const actor = new THREE.Group();
  actor.name = 'wallet-actor';
  rig.add(pose);
  pose.add(tilt);
  tilt.add(actor);
  scene.add(rig);
  const wallet = createWallet({ envMap: env, tier: gpuTier(renderer) });
  actor.add(wallet.root);

  const keychain = new Keychain({
    anchor: wallet.keychainAnchor,
    collider: { object: wallet.root, halfExtents: new THREE.Vector3(0.5, 0.75, 0.075) },
    reducedMotion: motion.reduced(),
  });
  scene.add(keychain.group);
  motion.subscribe((r) => (keychain.reducedMotion = r));

  const card = createKeyCard(env);
  card.group.visible = false;
  scene.add(card.group);

  const screen = createScreen();
  const cssScreen = new CSS3DObject(screen.el);
  cssScreen.scale.setScalar(0.795 / 360);
  wallet.screenSocket.add(cssScreen);

  const label = createContactCard('overlay');
  setContactCardWritten(label, false);
  const cssLabel = new CSS3DObject(label);
  cssLabel.scale.setScalar(CARD.label.w / OVERLAY_PX);
  card.labelAnchor.add(cssLabel);

  // CSS3D always draws above WebGL and backface-visibility is unreliable under its matrix3d:
  // hide a surface when it faces away from the camera or its 3D parent is hidden.
  const surfaces = [cssScreen, cssLabel];
  const n = new THREE.Vector3();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  function cssFacing() {
    for (const o of surfaces) {
      let shown = true;
      o.traverseAncestors((a) => (shown &&= a.visible));
      o.getWorldPosition(p);
      n.set(0, 0, 1).applyQuaternion(o.getWorldQuaternion(q));
      o.element.style.visibility = shown && n.dot(p.sub(camera.position).negate()) > 0 ? '' : 'hidden';
    }
    // WebGL can't occlude CSS3D: when the key card is in front of the screen and overlaps it on
    // screen (phones bring the card forward over the wallet), hide the screen's HTML.
    if (card.group.visible && cssScreen.element.style.visibility === '') {
      const a = projectedRect(wallet.screenSocket, 0.4, 0.53);
      const b = projectedRect(card.group, CARD.w / 2, CARD.h / 2);
      const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
      if (overlap && b.depth < a.depth) cssScreen.element.style.visibility = 'hidden';
    }
  }
  const corner = new THREE.Vector3();
  function projectedRect(o: THREE.Object3D, hx: number, hy: number) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      corner.set(sx * hx, sy * hy, 0);
      o.localToWorld(corner).project(camera);
      x0 = Math.min(x0, corner.x); x1 = Math.max(x1, corner.x);
      y0 = Math.min(y0, corner.y); y1 = Math.max(y1, corner.y);
    }
    return { x0, y0, x1, y1, depth: o.getWorldPosition(corner).distanceTo(camera.position) };
  }

  const frameCbs: ((dt: number) => void)[] = [];
  const resizeCbs: (() => void)[] = [];
  const isPortrait = () => innerWidth / innerHeight < 0.9;

  // Framing: the wallet (1 × 1.5 W) is the hero, centred. Landscape: its body fills 66 % of the
  // height, centred 40 % from the top, so the keychain (≈0.5 W below the slot) still hangs inside
  // the frame with a margin. Portrait (phones) is laid out in pixels instead: the top keys start
  // under the header, and the body plus the hanging keychain end above the page copy, so neither the
  // header nor the tab bar covers a key. Short phones keep the wallet at least 62 % of the width (up
  // to 240 px) and let the coin tuck behind the title. Portrait tablets use the desktop header and
  // the taller stacked copy.
  const PORTRAIT = {
    above: 0.83, // W: top keys above the body centre, as posed in the Console
    below: 1.1, // W: keychain coin below the body centre
    phone: { top: 78, copy: 196 }, // px: header (68) + a gap; Console copy (title, text, tab bar) + a gap
    tablet: { top: 92, copy: 280 }, // header 83; title, text, hint and the preferences row
  };
  function resize() {
    const w = innerWidth;
    const h = innerHeight;
    renderer.setSize(w, h, false);
    css.setSize(w, h);
    const aspect = w / h;
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    let dist: number;
    let y: number;
    if (isPortrait()) {
      const { top, copy } = w <= 760 ? PORTRAIT.phone : PORTRAIT.tablet; // 760: the CSS phone breakpoint
      const fit = (h - top - copy) / (PORTRAIT.above + PORTRAIT.below);
      const px = Math.min(w / 1.25, Math.max(Math.min(w * 0.62, 240), fit)); // px per W
      dist = h / px / (2 * t);
      y = (top + PORTRAIT.above * px - h / 2) / px; // world y = 0 lands there, px from the top
    } else {
      dist = Math.max(1.5 / 0.66 / (2 * t), 1.25 / (2 * t * aspect));
      y = 2 * t * dist * (0.4 - 0.5); // world y = 0 lands 40 % from the top
    }
    camera.aspect = aspect;
    camera.position.set(0, y, dist);
    camera.lookAt(0, y, 0);
    camera.updateProjectionMatrix();
    resizeCbs.forEach((cb) => cb());
  }
  addEventListener('resize', resize);

  // Cursor follow (mouse only): the wallet turns toward the pointer, damped, like picking it up to
  // look at it. Plus a slow float so it never sits dead still. Both off under reduced motion.
  const pointer = { x: 0, y: 0 };
  const cur = { x: 0, y: 0, amt: 1 };
  const intro = { y: 0, ry: 0, s: 0 };
  let followOn = true;
  let held = false;
  let time = 0;
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = -((e.clientY / innerHeight) * 2 - 1);
  });
  document.documentElement.addEventListener('mouseleave', () => (pointer.x = pointer.y = 0));
  function followStep(dt: number) {
    time += dt;
    const live = followOn && !motion.reduced();
    // Settling to rest (contact sequence) is quicker than following, so the card meets a still plate.
    const k = 1 - Math.exp(-dt * (live ? 4 : 9));
    if (!(live && held)) {
      cur.x += ((live ? pointer.x : 0) - cur.x) * k;
      cur.y += ((live ? pointer.y : 0) - cur.y) * k;
    }
    cur.amt += ((live ? 1 : 0) - cur.amt) * k;
    const f = cur.amt;
    tilt.rotation.set(-cur.y * 0.14 + Math.sin(time * 0.7) * 0.012 * f, cur.x * 0.22 + intro.ry, Math.sin(time * 0.5) * 0.008 * f);
    tilt.position.set(cur.x * 0.03, intro.y + Math.sin(time * 0.9) * 0.018 * f, 0);
    tilt.scale.setScalar(1 + intro.s);
  }

  const clock = new THREE.Clock();
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((r) => (resolveReady = r));
  let frames = 0;
  let compiled = false;
  let active = true;
  // One place decides whether frames run: compiled, visible, and not paused by the list view.
  const loop = () => {
    renderer.setAnimationLoop(compiled && active && !document.hidden ? frame : null);
    clock.getDelta();
  };
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.1);
    followStep(dt);
    frameCbs.forEach((cb) => cb(dt));
    keychain.update(dt);
    renderer.render(scene, camera);
    cssFacing();
    css.render(scene, camera);
    if (++frames <= 2) performance.mark(`stage:frame-${frames}`);
    if (frames === 2) resolveReady();
  }
  // Compile every shader before the first frame (in parallel where the driver allows), so the loader
  // covers the compile instead of the first visible frames stalling. D3D11 (ANGLE) takes 0.3–1 s per
  // physical program, so the key card, first seen in Contact, compiles afterwards in the background.
  //
  // That background work (the card's shaders, the stickers) is 0.4–1 s of blocked main thread per piece.
  // It waits for the entrance to settle (the loader lifts right after the first frame and the wallet rises
  // over ~1.4 s) and then for an idle moment, so it never lands on the arrival animation.
  const idle = () =>
    new Promise<void>((r) => ('requestIdleCallback' in window ? requestIdleCallback(() => r(), { timeout: 2000 }) : setTimeout(r, 100)));
  const settled = ready.then(() => new Promise<void>((r) => setTimeout(r, 2500))).then(idle);
  queueMicrotask(() => {
    resize();
    performance.mark('stage:compile-start');
    scene.remove(card.group);
    renderer
      .compileAsync(scene, camera)
      .catch(() => {})
      .then(() => {
        performance.mark('stage:compiled');
        scene.add(card.group);
        clock.getDelta();
        compiled = true;
        loop();
        return settled.then(() => renderer.compileAsync(scene, camera)).catch(() => {});
      });
  });
  // Pause rendering while the tab is hidden; resume without a time jump (keychain re-hangs on big dt).
  document.addEventListener('visibilitychange', () => {
    loop();
    clock.getDelta();
  });

  // Stickers (easter egg): built from the SVGs once the entrance has settled and compiled in the background,
  // so the loader never waits for them; then stuck to the back plate's outer face.
  const stickers: Sticker[] = [];
  settled
    .then(async () => {
      const plate = wallet.runtime.meshes['back-plate'];
      if (!plate) return;
      wallet.root.updateMatrixWorld(true);
      plate.geometry.computeBoundingBox();
      const toRoot = new THREE.Matrix4().copy(wallet.root.matrixWorld).invert().multiply(plate.matrixWorld);
      const backZ = plate.geometry.boundingBox!.clone().applyMatrix4(toRoot).min.z;
      const made = await createStickers(backZ, env, idle);
      await renderer.compileAsync(made.group, camera, scene).catch(() => {});
      wallet.root.add(made.group);
      stickers.push(...made.stickers);
    })
    .catch(() => {});
  frameCbs.push((dt) => stickers.forEach((s) => s.update(dt)));

  const stage: Stage = {
    renderer, scene, camera, rig, pose, tilt, actor, wallet, keychain, card, screen, label, intro, ready, stickers,
    follow: (on) => (followOn = on),
    hold: (on) => (held = on),
    setActive(on) {
      active = on;
      loop();
    },
    halfWidthAt: (z) => Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect * (camera.position.z - z),
    onFrame: (cb) => frameCbs.push(cb),
    onResize: (cb) => resizeCbs.push(cb),
    portrait: isPortrait,
  };
  return stage;
}
