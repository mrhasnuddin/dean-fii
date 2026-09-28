// Physical controls on the wallet + keyboard. Every control maps to one job (docs/device-design.md §2):
// tabs 01–04 → sections · roller → browse · ✓ → open · Back → close · switch → motion · coin → top.
// The wheel turns the roller only while the pointer is over the wallet and the list can still move;
// at a list end the wheel scrolls the page (no scroll trap).
import * as THREE from 'three';
import gsap from 'gsap';
import type { Stage } from './stage';
import { motion } from '../motion';
import { sfx } from '../audio/sfx';

export interface ControlHandlers {
  gotoSection(index: number): void; // 1–4
  roll(delta: number): boolean; // returns false at a list end
  canRoll(delta: number): boolean; // would roll(delta) move the selection?
  confirm(): void;
  back(): void;
  toggleMotion(): void;
  toTop(): void;
}

export interface Controls {
  /** Lenis asks this before scrolling on a wheel event. */
  wheelConsumed(): boolean;
  setMotionSwitch(on: boolean): void;
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
    { id: 'switch-motion', obj: meshes['switch-motion'] },
    { id: 'coin', obj: keychain.coin },
  ].filter((p) => p.obj);

  // Raycast the whole wallet + keychain and take the NEAREST hit, then walk up to a part: the roller
  // disc sits mostly inside the body, so testing parts alone would let clicks on the screen hit it.
  function pick(e: PointerEvent | WheelEvent) {
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([wallet.root, keychain.group], true);
    if (!hits.length) return null;
    let o: THREE.Object3D | null = hits[0].object;
    while (o && !parts.some((p) => p.obj === o)) o = o.parent;
    const part = parts.find((p) => p.obj === o);
    return part ? { id: part.id, point: hits[0].point } : null;
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

  canvas.addEventListener('pointerdown', (e) => {
    const hit = pick(e);
    if (!hit) return;
    switch (hit.id) {
      case 'tab-01': case 'tab-02': case 'tab-03': case 'tab-04':
        h.gotoSection(Number(hit.id.slice(-1)));
        break;
      case 'roller': {
        // Upper half of the exposed rim steps back, lower half steps forward. At a list end the
        // roller hits its stop (the detent tick itself comes from the screen's selection change).
        const local = roller!.worldToLocal(hit.point.clone());
        if (!roll(local.y > 0 ? -1 : 1)) sfx.play('bump');
        break;
      }
      case 'key-confirm':
        press('key-confirm', 'z', 0.004);
        sfx.play('key');
        h.confirm();
        break;
      case 'key-back':
        press('key-back', 'z', 0.003);
        sfx.play('key', { rate: 0.82 }); // same mechanism as ✓, pitched down: going back sounds like it
        h.back();
        break;
      case 'switch-motion':
        h.toggleMotion();
        break;
      case 'coin':
        keychain.nudge(1.2);
        sfx.play('jingle');
        h.toTop();
        break;
    }
  });
  // The wallet stops following the cursor once the pointer is on it (or its screen), so a key never
  // drifts from under the pointer while the tilt settles; it resumes in the open space around it.
  canvas.addEventListener('pointermove', (e) => {
    canvas.style.cursor = pick(e) ? 'pointer' : '';
    stage.hold(ray.intersectObjects([wallet.root, keychain.group], true).length > 0);
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
      h.gotoSection(Number(e.key));
      e.preventDefault();
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !t.closest('a, button')) {
      if (roll(e.key === 'ArrowDown' ? 1 : -1)) e.preventDefault();
    } else if (e.key === 'Enter' && (t === document.body || t === canvas)) {
      h.confirm();
      e.preventDefault();
    }
  });

  // Motion switch knob: up = motion on, down = off.
  const knob = nodes['switch-motion'];
  const knobRest = knob?.position.y ?? 0;
  return {
    wheelConsumed: () => consumed,
    setMotionSwitch(on) {
      if (!knob) return;
      gsap.to(knob.position, { y: knobRest + (on ? 0.015 : -0.015), duration: motion.reduced() ? 0 : 0.2, ease: 'power2.out' });
    },
  };
}
