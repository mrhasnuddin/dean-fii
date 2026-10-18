// The fixed 3D stage: renderer + CSS3D layer, dark studio environment, the wallet (rig → pose →
// tilt → actor → wallet.root), the USB-C cable, key card, memory card, the e-ink screen and the card's written details.
// `rig` is posed by scroll (Hero ↔ Console); `pose` holds the section move (choreography); `tilt`
// follows the cursor, floats, and carries the intro; `actor` holds transient offsets (contact
// sequence, recoil). No two systems share a transform.
import * as THREE from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import { createWallet, type Wallet } from '../device/wallet';
import { createStudioEnvironment } from '../device/studioEnvironment';
import { Cable, CABLE } from '../device/cable';
import { createMemoryCard } from '../device/memoryCard';
import { CARD, createKeyCard, type KeyCard } from '../device/keyCard';
import { BODY, type GpuTier } from '../device/walletRefine';
import { createStickers, type Sticker } from '../device/stickers';
import { createScreen, type Screen } from '../ui/screen';
import { motion } from '../motion';


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
  /** Settle the cursor follow to nothing while the visitor has the device turned or zoomed (§35). */
  calm(on: boolean): void;
  /**
   * Pan and zoom, done by moving the camera (the cable's physics run in world units, so scaling a group would
   * leave it the wrong size). Limits: zoom 1–1.8, pan about half the device. Pixels are client pixels.
   */
  look: {
    pan(dxPx: number, dyPx: number): void;
    /** Multiply the zoom by `ratio`, keeping the point under (clientX, clientY) where it is. */
    zoomAt(ratio: number, clientX: number, clientY: number): void;
    /** Double-click: zoom in 1.7× at the point, or go home when already zoomed. */
    toggleZoom(clientX: number, clientY: number): void;
    reset(instant?: boolean): void;
    isOff(): boolean;
  };
  /** Resolves once shaders are compiled and the first frame is on screen. */
  ready: Promise<void>;
  /** Run or pause the render loop (list view pauses it: no 3D is shown). */
  setActive(on: boolean): void;
  wallet: Wallet;
  cable: Cable;
  /** The Motion page's memory card, a child of the bottom slot (scene/memorySequence.ts). */
  memoryCard: THREE.Group;
  card: KeyCard;
  screen: Screen;
  /** Back-plate stickers (easter egg); filled once built, after the first frame. */
  stickers: Sticker[];
  /** Viewport half-width at depth z (world units), for layout. */
  halfWidthAt(z: number): number;
  /** Camera height at rest, for layout (the camera moves when the visitor pans). */
  restY(): number;
  /**
   * Focus (§37): in the Console the camera comes in a little, scrubbed by the scroll from the Hero framing (0) to the
   * whole wallet filling the free area of the view (1). `?focus=0` turns it off (to compare).
   */
  focus: {
    enabled: boolean;
    /** 0 to 1, from the scroll. */
    set(k: number): void;
    /** Give the focus up for a while (the settings tutorial needs the whole wallet), then take it back. */
    hold(on: boolean): void;
    /** Where the wallet's centre is in the world at the Console pose (choreography knows the pose); re-aims the zoom. */
    aim(walletCentreY: number): void;
    /** 0 to 1: how far in the camera is now (the cursor follow quiets as it comes in). */
    amount(): number;
  };
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

  // The USB-C cable out of the bottom port: it hangs and swings under gravity, and fades out below the device.
  const cable = new Cable({
    anchor: wallet.cableAnchor,
    collider: { object: wallet.root, halfExtents: new THREE.Vector3(BODY.w / 2, BODY.h / 2, BODY.t / 2) },
    reducedMotion: motion.reduced(),
  });
  scene.add(cable.group);
  motion.subscribe((r) => (cable.reducedMotion = r));

  // The memory card waits out of sight; it is a child of the bottom slot, so it turns with the wallet.
  const memoryCard = createMemoryCard(env);
  memoryCard.visible = false;
  wallet.memorySlot.add(memoryCard);

  const card = createKeyCard(env);
  card.group.visible = false;
  scene.add(card.group);

  const screen = createScreen();
  const cssScreen = new CSS3DObject(screen.el);
  cssScreen.scale.setScalar(0.795 / 360);
  wallet.screenSocket.add(cssScreen);

  // CSS3D always draws above WebGL and backface-visibility is unreliable under its matrix3d:
  // hide a surface when it faces away from the camera or its 3D parent is hidden.
  const surfaces = [cssScreen];
  const FACING_TAP = Math.cos(THREE.MathUtils.degToRad(55)); // the screen takes taps within 55° of face-on
  const n = new THREE.Vector3();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  function cssFacing() {
    for (const o of surfaces) {
      let shown = true;
      o.traverseAncestors((a) => (shown &&= a.visible));
      o.getWorldPosition(p);
      n.set(0, 0, 1).applyQuaternion(o.getWorldQuaternion(q));
      const facing = n.dot(p.sub(camera.position).negate().normalize());
      o.element.style.visibility = shown && facing > 0 ? '' : 'hidden';
      // Turned well away it is still drawn, but a tap on it would mean nothing: the touch goes to the device.
      o.element.style.pointerEvents = facing > FACING_TAP ? '' : 'none';
    }
    // WebGL can't occlude CSS3D: when the key card is in front of the screen and overlaps it on
    // screen (phones bring the card forward over the wallet), hide the screen's HTML.
    if (card.group.visible && card.group.parent !== wallet.root && cssScreen.element.style.visibility === '') {
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
  // Pan and zoom live as camera offsets from the framing above (`camBase`); `lookTo` is where they are going.
  const camBase = { y: 0, dist: 8 };
  const look = { cx: 0, cy: 0, z: 1 };
  const lookTo = { cx: 0, cy: 0, z: 1 };
  const ZOOM_MAX = 1.8;
  const clampLook = () => {
    lookTo.z = THREE.MathUtils.clamp(lookTo.z, 1, ZOOM_MAX);
    const lx = 0.45 + 0.4 * (lookTo.z - 1);
    const ly = 0.7 + 0.6 * (lookTo.z - 1);
    lookTo.cx = THREE.MathUtils.clamp(lookTo.cx, -lx, lx);
    lookTo.cy = THREE.MathUtils.clamp(lookTo.cy, -ly, ly);
  };
  // Focus (§37), the third layer of the camera: the scroll's own zoom onto the screen. `focusZ` and `focusDy` are
  // where it ends (set from the layout in `fitFocus`); `focusK` is how far along it is (0 Hero, 1 Console) after
  // the tutorial's hold has been taken off.
  const FOCUS_ON = new URLSearchParams(location.search).get('focus') !== '0';
  const SCREEN = { w: 0.8, h: 1.06 }; // the e-ink screen's size in W
  const focusLayout = { ready: false, w: 0, h: 0, pxW: 0, portrait: false, dy: 0 };
  let focusZ = 1;
  let focusDy = 0;
  let focusScroll = 0;
  let focusHold = 0; // 0 or 1: the tutorial has the focus out
  let focusEased = 0; // focusHold, eased
  let focusK = 0;
  const focusZoom = () => 1 + (focusZ - 1) * focusK;
  /**
   * Where the focus ends: the whole wallet in view, with a gentle zoom, so the visitor can play with every part of
   * it (Dean's call, for the desktop as well as the phone). The zoom is the largest at which the wallet fits the free
   * area of the view: 1.12 W across (the body with the knob on one side and the switch on the other) and, down, from
   * the top keys to just past the body on a desktop (1.72 W, so the plug's head still shows), or to the buttons on a
   * phone or portrait tablet (1.51 W: the lower bezel, the plug and the card may run off the foot, under the copy).
   * Never more than the screen filling the area, and capped (1.45 desktop, 1.75 portrait). The camera height puts the
   * middle of that span in the middle of the area.
   */
  function fitFocus() {
    const f = focusLayout;
    if (!f.ready) return;
    const phone = f.portrait && f.w <= 760;
    const top = f.portrait ? (phone ? 84 : 98) : 72;
    const bottom = f.h - (f.portrait ? (phone ? 190 : 200) : 20);
    const zScreen = Math.min(((bottom - top) * 0.98) / (SCREEN.h * f.pxW), ((f.w - (f.portrait ? 24 : 80)) * (f.portrait ? 0.96 : 0.9)) / (SCREEN.w * f.pxW));
    const zWallet = Math.min((f.w - 16) / (1.12 * f.pxW), ((bottom - top) * 0.98) / ((f.portrait ? 1.51 : 1.72) * f.pxW));
    focusZ = THREE.MathUtils.clamp(Math.min(zScreen, zWallet), 1, f.portrait ? 1.75 : 1.45);
    const below = (top + bottom) / 2 - f.h / 2; // px the area's centre is below the view's
    const aimY = f.dy + (f.portrait ? 0.095 : -0.01); // the middle of the span, in W from the wallet's centre
    focusDy = aimY + below / (focusZ * f.pxW) - camBase.y;
  }
  function applyCamera() {
    camera.position.set(look.cx, camBase.y + look.cy + focusDy * focusK, camBase.dist / (look.z * focusZoom()));
  }
  /** World units per client pixel on the device's plane, at the zoom the camera is heading for. */
  const unitsPerPx = () => (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (camBase.dist / (lookTo.z * focusZoom()))) / innerHeight;
  function lookStep(dt: number) {
    const k = motion.reduced() ? 1 : 1 - Math.exp(-dt * 14);
    look.cx += (lookTo.cx - look.cx) * k;
    look.cy += (lookTo.cy - look.cy) * k;
    look.z += (lookTo.z - look.z) * k;
    focusEased += (focusHold - focusEased) * (motion.reduced() ? 1 : 1 - Math.exp(-dt * 6));
    focusK = FOCUS_ON ? focusScroll * (1 - focusEased) : 0;
    applyCamera();
  }
  const lookApi: Stage['look'] = {
    pan(dxPx, dyPx) {
      const u = unitsPerPx();
      lookTo.cx -= dxPx * u;
      lookTo.cy += dyPx * u;
      clampLook();
    },
    zoomAt(ratio, clientX, clientY) {
      const u = unitsPerPx();
      const z1 = THREE.MathUtils.clamp(lookTo.z * ratio, 1, ZOOM_MAX);
      const r = z1 / lookTo.z;
      // The world point under the pointer, on the device's plane; the camera moves so it stays under the pointer.
      const px = lookTo.cx + (clientX - innerWidth / 2) * u;
      const cy0 = camBase.y + focusDy * focusK; // the camera's rest height, with the focus
      const py = cy0 + lookTo.cy - (clientY - innerHeight / 2) * u;
      lookTo.cx = px - (px - lookTo.cx) / r;
      lookTo.cy = py - (py - (cy0 + lookTo.cy)) / r - cy0;
      lookTo.z = z1;
      clampLook();
    },
    toggleZoom(clientX, clientY) {
      if (lookTo.z > 1.05) lookApi.reset();
      else lookApi.zoomAt(1.7, clientX, clientY);
    },
    reset(instant = false) {
      Object.assign(lookTo, { cx: 0, cy: 0, z: 1 });
      if (instant) {
        Object.assign(look, lookTo);
        applyCamera();
      }
    },
    isOff: () => Math.abs(lookTo.cx) > 0.01 || Math.abs(lookTo.cy) > 0.01 || lookTo.z > 1.01,
  };

  // Framing: the wallet (1 × 1.5 W) is the hero, centred. Landscape: its body fills 66 % of the
  // height, centred 40 % from the top, so the cable and the memory card (≈0.5 W below the bottom edge)
  // still show inside the frame with a margin. Portrait (phones) is laid out in pixels instead: the top keys start
  // under the header, and the body plus the hanging keychain end above the page copy, so neither the
  // header nor the tab bar covers a key. Short phones keep the wallet at least 62 % of the width (up
  // to 240 px) and let the coin tuck behind the title. Portrait tablets use the desktop header and
  // the taller stacked copy.
  const PORTRAIT = {
    above: 0.83, // W: top keys above the body centre, as posed in the Console
    below: 1.1, // W: keychain coin below the body centre
    phone: { top: 78, copy: 224 }, // px: header (68) + a gap; Console copy (title, kind pills, text, tab bar) + a gap: the memory card and the plug hang 0.3 W below the body, so they must clear it
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
    if (isPortrait()) cable.setFade(0.05, 0.3);
    else cable.setFade(CABLE.fade[0], CABLE.fade[1]);
    camera.aspect = aspect;
    camBase.y = y;
    camBase.dist = dist;
    Object.assign(focusLayout, { ready: true, w, h, pxW: h / (2 * t * dist), portrait: isPortrait() });
    fitFocus();
    applyCamera();
    camera.lookAt(camera.position.x, camera.position.y, 0); // straight ahead: the camera only ever slides, so this stays face-on
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
  let calmOn = false;
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
    lookStep(dt);
    const live = followOn && !calmOn && !motion.reduced();
    // Settling to rest (contact sequence) is quicker than following, so the card meets a still plate.
    const k = 1 - Math.exp(-dt * (live ? 4 : 9));
    if (!(live && held)) {
      cur.x += ((live ? pointer.x : 0) - cur.x) * k;
      cur.y += ((live ? pointer.y : 0) - cur.y) * k;
    }
    cur.amt += ((live ? 1 : 0) - cur.amt) * k;
    const f = cur.amt;
    const calm = 1 - 0.65 * focusK; // zoomed on the screen, the same tilt would make its text swim
    tilt.rotation.set(-cur.y * 0.14 * calm + Math.sin(time * 0.7) * 0.012 * f * calm, cur.x * 0.22 * calm + intro.ry, Math.sin(time * 0.5) * 0.008 * f * calm);
    tilt.position.set(cur.x * 0.03 * calm, intro.y + Math.sin(time * 0.9) * 0.018 * f * calm, 0);
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
    cable.update(dt);
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
  // Pause rendering while the tab is hidden; resume without a time jump (the cable re-hangs on big dt).
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
  // The memory card's shaders compile in the same idle window, with the card parked far above the frame.
  settled
    .then(async () => {
      memoryCard.position.y = 6;
      memoryCard.visible = true;
      await renderer.compileAsync(memoryCard, camera, scene).catch(() => {});
    })
    .finally(() => {
      memoryCard.visible = false;
      memoryCard.position.y = 0;
    });

  const stage: Stage = {
    renderer, scene, camera, rig, pose, tilt, actor, wallet, cable, memoryCard, card, screen, intro, ready, stickers,
    follow: (on) => (followOn = on),
    hold: (on) => (held = on),
    calm: (on) => (calmOn = on),
    look: lookApi,
    setActive(on) {
      active = on;
      loop();
    },
    focus: {
      enabled: FOCUS_ON,
      set: (k) => (focusScroll = k),
      hold: (on) => (focusHold = on ? 1 : 0),
      aim(dy) {
        focusLayout.dy = dy;
        fitFocus();
      },
      amount: () => focusK,
    },
    halfWidthAt: (z) => Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect * (camBase.dist - z),
    restY: () => camBase.y,
    onFrame: (cb) => frameCbs.push(cb),
    onResize: (cb) => resizeCbs.push(cb),
    portrait: isPortrait,
  };
  return stage;
}
