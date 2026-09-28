// Physical controls on the wallet + keyboard. Every control maps to one job (docs/device-design.md §2, §10):
// tabs 01–04 → sections · roller → browse · ✓ → open · Back → close · side switch → Device / List view ·
// coin → top. Two hand gestures: drag the wallet's body sideways to turn it over, and on the back,
// drag a sticker to peel it (an easter egg, §11).
// The wheel turns the roller only while the pointer is over the wallet and the list can still move;
// at a list end the wheel scrolls the page (no scroll trap).
import * as THREE from 'three';
import gsap from 'gsap';
import type { Stage } from './stage';
import type { Sticker } from '../device/stickers';
import { motion } from '../motion';
import { sfx } from '../audio/sfx';

export interface ControlHandlers {
  selectTab(index: number): void; // 1–4
  roll(delta: number): boolean; // returns false at a list end
  canRoll(delta: number): boolean; // would roll(delta) move the selection?
  confirm(): void;
  back(): void;
  toggleView(): void;
  toTop(): void;
  /** Hand turn (choreography.flip). */
  flip: { begin(): void; to(delta: number): void; release(): void };
}

export interface Controls {
  /** Lenis asks this before scrolling on a wheel event. */
  wheelConsumed(): boolean;
  /** Knob up = device view, down = list view. */
  setViewSwitch(list: boolean): void;
  /** Press a face key as if tapped (its label on the screen was tapped). */
  pressKey(id: 'key-confirm' | 'key-back'): void;
}

export function createControls(stage: Stage, canvas: HTMLCanvasElement, h: ControlHandlers): Controls {
  const { camera, wallet, keychain } = stage;
  const { nodes, meshes } = wallet.runtime;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  const parts: { id: string; obj: THREE.Object3D }[] = [
    ...['tab-01', 'tab-02', 'tab-03', 'tab-04'].map((id) => ({ id, obj: meshes[id] })),
    { id: 'roller', obj: meshes['roller'] },
    { id: 'key-confirm', obj: meshes['key-confirm'] },
    { id: 'key-back', obj: meshes['key-back'] },
    { id: 'switch-view', obj: meshes['switch-view'] },
    { id: 'coin', obj: keychain.coin },
  ].filter((p) => p.obj);

  // Hit areas: invisible boxes parented to the small controls (so they press/slide with them) make
  // every target at least ~44 px on a laptop screen. The raycaster ignores `visible`, the renderer
  // doesn't draw them; the nearest-hit rule below still lets the body and screen win where they are
  // in front (a proxy never steals a click from the glass).
  const proxyMat = new THREE.MeshBasicMaterial();
  const proxy = (id: string, size: [number, number, number], at: [number, number, number]) => {
    const mesh = meshes[id];
    if (!mesh) return;
    const p = new THREE.Mesh(new THREE.BoxGeometry(...size), proxyMat);
    p.name = `${id}-hit`;
    p.position.set(...at);
    p.visible = false;
    mesh.add(p);
  };
  // Tabs: 0.16 W square (their pitch is 0.165 W), 44 px on a phone where the wallet is ~280 px wide.
  for (const id of ['tab-01', 'tab-02', 'tab-03', 'tab-04']) proxy(id, [0.16, 0.16, 0.13], [0, 0.03, 0]);
  proxy('switch-view', [0.15, 0.24, 0.14], [0.055, 0, 0]); // grows outward, off the body edge
  // Back key: 0.12 W across (36 px on a phone); a 0.17 W ball around it. A ball needs no knowledge of
  // the key's local axes.
  if (meshes['key-back']) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 8), proxyMat);
    p.name = 'key-back-hit';
    p.visible = false;
    meshes['key-back'].add(p);
  }
  // The roller disc is Y-up in its mesh frame (the node turns it to face ±Z); a slightly larger disc.
  if (meshes['roller']) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.12, 24), proxyMat);
    p.name = 'roller-hit';
    p.visible = false;
    meshes['roller'].add(p);
  }

  // Raycast the whole wallet + keychain and take the NEAREST hit, then walk up to a part: the roller
  // disc sits mostly inside the body, so testing parts alone would let clicks on the screen hit it.
  // What was hit: a control, a sticker (only reachable when the back faces you), or the body itself.
  type Target = { kind: 'part'; id: string; point: THREE.Vector3 } | { kind: 'sticker'; sticker: Sticker; point: THREE.Vector3 } | { kind: 'body' };
  function target(e: PointerEvent | WheelEvent): Target | null {
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([wallet.root, keychain.group], true);
    if (!hits.length) return null;
    const sticker = hits[0].object.userData.sticker as Sticker | undefined;
    if (sticker) return { kind: 'sticker', sticker, point: hits[0].point };
    let o: THREE.Object3D | null = hits[0].object;
    while (o && !parts.some((p) => p.obj === o)) o = o.parent;
    const part = parts.find((p) => p.obj === o);
    return part ? { kind: 'part', id: part.id, point: hits[0].point } : { kind: 'body' };
  }
  const overWallet = (e: PointerEvent | WheelEvent) => {
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObject(wallet.root, true).length > 0;
  };

  // Press feedback: snap in (60 ms), settle out (160 ms). Fixed rest, so repeats never drift.
  const rest = new Map<string, number>();
  function press(id: string, axis: 'y' | 'z', depth: number) {
    const node = nodes[id];
    if (!node || motion.reduced()) return;
    if (!rest.has(id)) rest.set(id, node.position[axis]);
    const r = rest.get(id)!;
    gsap.killTweensOf(node.position);
    gsap.timeline()
      .to(node.position, { [axis]: r - depth, duration: 0.06, ease: 'power2.out' })
      .to(node.position, { [axis]: r, duration: 0.16, ease: 'power3.out' });
  }

  // Roller visual: one knurl (5°) per list step.
  const roller = nodes['roller'];
  function spinRoller(delta: number) {
    if (!roller || motion.reduced()) return;
    // Fires on every list step (often keyboard-driven): short, and gsap.to retargets from the current angle.
    gsap.to(roller.rotation, { z: roller.rotation.z - delta * THREE.MathUtils.degToRad(5), duration: 0.12, ease: 'power2.out' });
  }
  function roll(delta: number) {
    const moved = h.roll(delta);
    if (moved) spinRoller(delta);
    return moved;
  }

  // Hand gestures. A drag starts on press; a turn only once the pointer has clearly moved sideways
  // (so a tap on the body does nothing and vertical touch drags still scroll the page).
  type Drag =
    | { kind: 'peel'; id: number; sticker: Sticker; lastF: number; lastSound: number }
    | { kind: 'turn'; id: number; x0: number; y0: number; turning: boolean };
  let drag: Drag | null = null;
  const TURN_PER_PX = Math.PI / 260; // ~260 px of drag turns it over
  // Capture keeps the drag alive when the pointer leaves the canvas. It throws for a pointer the
  // browser no longer tracks (already lifted, or synthetic); the drag still works without it.
  const capture = (id: number) => {
    try {
      canvas.setPointerCapture(id);
    } catch {
      /* not capturable */
    }
  };

  canvas.addEventListener('pointerdown', (e) => {
    const hit = target(e);
    if (!hit) return;
    if (hit.kind === 'sticker') {
      drag = { kind: 'peel', id: e.pointerId, sticker: hit.sticker, lastF: 0, lastSound: 0 };
      hit.sticker.beginPeel(hit.point);
      capture(e.pointerId);
      canvas.style.cursor = 'grabbing';
      sfx.play('peel', { volume: 0.5 });
      return;
    }
    if (hit.kind === 'body') {
      drag = { kind: 'turn', id: e.pointerId, x0: e.clientX, y0: e.clientY, turning: false };
      capture(e.pointerId);
      return;
    }
    switch (hit.id) {
      case 'tab-01': case 'tab-02': case 'tab-03': case 'tab-04':
        h.selectTab(Number(hit.id.slice(-1)));
        break;
      case 'roller': {
        // Upper half of the exposed rim steps back, lower half steps forward. At a list end the
        // roller hits its stop (the detent tick itself comes from the screen's selection change).
        const local = roller!.worldToLocal(hit.point.clone());
        if (!roll(local.y > 0 ? -1 : 1)) sfx.play('bump');
        break;
      }
      case 'key-confirm':
      case 'key-back':
        pressKey(hit.id);
        break;
      case 'switch-view':
        h.toggleView();
        break;
      case 'coin':
        keychain.nudge(1.2);
        sfx.play('jingle');
        h.toTop();
        break;
    }
  });

  // The two face keys: tapped on the wallet, or through their labels along the screen's bottom edge.
  function pressKey(id: 'key-confirm' | 'key-back') {
    if (id === 'key-confirm') {
      press('key-confirm', 'z', 0.004);
      sfx.play('key');
      h.confirm();
    } else {
      press('key-back', 'z', 0.003);
      sfx.play('key', { rate: 0.82 }); // same mechanism as ✓, pitched down: going back sounds like it
      h.back();
    }
  }

  function endDrag(e: PointerEvent) {
    if (!drag || drag.id !== e.pointerId) return;
    if (drag.kind === 'peel') {
      const s = drag.sticker;
      // It lays back down: a soft pat when it lands.
      s.release(() => sfx.play('stick'), motion.reduced());
    } else if (drag.turning) {
      h.flip.release();
      sfx.play('swish', { volume: 0.35 });
    }
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    drag = null;
    canvas.style.cursor = '';
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // The wallet stops following the cursor once the pointer is on it (or its screen), so a key never
  // drifts from under the pointer while the tilt settles; it resumes in the open space around it.
  canvas.addEventListener('pointermove', (e) => {
    if (drag?.id === e.pointerId) {
      if (drag.kind === 'peel') {
        ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        const f = drag.sticker.drag(ray.ray);
        // Adhesive crackle while it lifts, louder for a faster pull; silent once it stops giving.
        const now = performance.now();
        if (f - drag.lastF > 0.07 && now - drag.lastSound > 120 && f < 0.97) {
          sfx.play('peel', { volume: Math.min(1, 0.35 + (f - drag.lastF) * 3) });
          drag.lastSound = now;
          drag.lastF = f;
        } else if (f < drag.lastF) drag.lastF = f;
        return;
      }
      const dx = e.clientX - drag.x0;
      const dy = e.clientY - drag.y0;
      if (!drag.turning && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
        drag.turning = true;
        h.flip.begin();
        canvas.style.cursor = 'grabbing';
      }
      if (drag.turning) h.flip.to(dx * TURN_PER_PX);
      return;
    }
    const t = target(e);
    // Controls say "press"; the body and stickers say "grab" (turn it over, peel).
    canvas.style.cursor = !t ? '' : t.kind === 'part' ? 'pointer' : 'grab';
    stage.hold(!!t);
  });
  canvas.addEventListener('pointerleave', () => stage.hold(false));
  stage.screen.el.addEventListener('pointerenter', () => stage.hold(true));
  stage.screen.el.addEventListener('pointerleave', () => stage.hold(false));

  // Wheel over the wallet (canvas or its CSS3D screen) turns the roller while the list can move.
  // Anywhere else, or at a list end, the page scrolls as normal.
  let consumed = false;
  let acc = 0;
  let last = 0;
  function onWheel(e: WheelEvent) {
    consumed = false;
    const dir = Math.sign(e.deltaY);
    if (!dir) return;
    const onScreen = e.target instanceof HTMLElement && !!e.target.closest('.eink');
    if (!onScreen && !overWallet(e)) return;
    if (!h.canRoll(dir)) return;
    consumed = true;
    e.preventDefault();
    acc += e.deltaY;
    const now = performance.now();
    if (Math.abs(acc) >= 40 && now - last >= 110) {
      roll(Math.sign(acc));
      acc = 0;
      last = now;
    }
  }
  canvas.addEventListener('wheel', onWheel, { passive: false });
  stage.screen.el.addEventListener('wheel', onWheel, { passive: false });

  // Keyboard: 1–4 sections, ↑/↓ browse (falls through to page scroll at list ends), Enter open.
  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, dialog, [contenteditable]')) return;
    if (/^[1-4]$/.test(e.key)) {
      h.selectTab(Number(e.key));
      e.preventDefault();
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !t.closest('a, button')) {
      if (roll(e.key === 'ArrowDown' ? 1 : -1)) e.preventDefault();
    } else if (e.key === 'Enter' && (t === document.body || t === canvas)) {
      h.confirm();
      e.preventDefault();
    }
  });

  // View switch knob: rests up (device view); down 0.09 W = list view (±0.045 W about the slot centre).
  const knob = nodes['switch-view'];
  const knobUp = knob?.position.y ?? 0;
  return {
    wheelConsumed: () => consumed,
    setViewSwitch(list) {
      if (!knob) return;
      gsap.to(knob.position, { y: knobUp - (list ? 0.09 : 0), duration: motion.reduced() ? 0 : 0.18, ease: 'power2.out' });
    },
    pressKey,
  };
}
