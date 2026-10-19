// Physical controls on the wallet + keyboard. Every control maps to one job (docs/device-design.md §2, §10, §34):
// tabs 01–04 → sections · ✓ → open · Back → close · right switch → Device / List view · left slider → Motion
// on/off · volume knob → the site's volume (drag, wheel, tap to mute) · memory-card slot → the Motion page ·
// the cable → plug / unplug (the battery shows it) · pinhole → reset. Two hand gestures: drag the wallet's body sideways to turn it over, and on the back,
// drag a sticker to peel it (an easter egg, §11). Pull one all the way and let go: it stays rolled back
// and the QR under it shows (§24); tap the QR to visit the site, tap the flap (or ✕, Esc, or turn the
// wallet) to put it back.
// The wheel browses the list only while the pointer is over the wallet and the list can still move;
// at a list end the wheel scrolls the page (no scroll trap). Over the knob it sets the volume instead.
import * as THREE from 'three';
import gsap from 'gsap';
import type { Stage } from './stage';
import { COMMIT, type Sticker } from '../device/stickers';
import { BODY } from '../device/walletRefine';
import { MOTION_SW, SOUND_SW } from '../device/sideParts';
import { motion } from '../motion';
import { sfx } from '../audio/sfx';
import { volume } from '../audio/volume';

export interface ControlHandlers {
  selectTab(index: number): void; // 1–4
  roll(delta: number): boolean; // returns false at a list end
  canRoll(delta: number): boolean; // would roll(delta) move the selection?
  confirm(): void;
  back(): void;
  toggleView(): void;
  /** The left slider: motion on / off. */
  toggleMotion(): void;
  /** The left Sound slider: effects and music on or off together. */
  toggleSound(): void;
  /** The memory-card slot (or the card sticking out of it): bring the Motion page in, or send it away. */
  toggleMemory(): void;
  /** The cable (or its port): unplug, or plug back in. */
  togglePlug(): void;
  /** The pinhole: reboot the device. */
  reset(): void;
  /** The visitor's own view of the wallet (choreography.view). */
  view: { begin(): void; by(turn: number, pitch: number): void; release(turnSpeed: number, pitchSpeed: number): void; reset(): void; isOff(): boolean };
  /** A sticker's flap was latched open (its QR is showing), or null once it is back down. */
  sticker(s: Sticker | null): void;
  /** A tap on the volume knob. Return true to take it (the touch volume pill, which docs §40 explains); false lets the knob mute. */
  knobTap(): boolean;
}

export interface Controls {
  /** Lenis asks this before scrolling on a wheel event. */
  wheelConsumed(): boolean;
  /** Knob up = device view, down = list view. */
  setViewSwitch(list: boolean): void;
  /** The left slider's knob: up = motion on. */
  setMotionSwitch(on: boolean): void;
  /** The Sound slider's knob: up = sound on. */
  setSoundSwitch(on: boolean): void;
  /** The eye's tutorial: each site setting makes a small move of its own (the knob turns and back, the sliders slide and back). */
  nudge(): void;
  /** Set the site volume the way the knob does: the screen's toast and a detent per 5 %. 0 to 1. */
  setVolume(v: number): void;
  /** Mute, or bring back the level from before. */
  toggleMute(): void;
  /** Press a face key as if tapped (its label on the screen was tapped). */
  pressKey(id: 'key-confirm' | 'key-back'): void;
  /** Put the open sticker back (the link pill's ✕). */
  healSticker(): void;
}

export function createControls(stage: Stage, canvas: HTMLCanvasElement, h: ControlHandlers): Controls {
  const { camera, wallet } = stage;
  const { nodes, meshes } = wallet.runtime;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  const parts: { id: string; obj: THREE.Object3D }[] = [
    ...['tab-01', 'tab-02', 'tab-03', 'tab-04'].map((id) => ({ id, obj: meshes[id] })),
    { id: 'volume-knob', obj: meshes['volume-knob'] },
    { id: 'motion-switch', obj: meshes['motion-switch'] },
    { id: 'sound-switch', obj: meshes['sound-switch'] },
    { id: 'key-confirm', obj: meshes['key-confirm'] },
    { id: 'key-back', obj: meshes['key-back'] },
    { id: 'switch-view', obj: meshes['switch-view'] },
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
  // The knob's axis is its mesh's Y (the node turns it out of the left face), so a box 0.2 across and deep
  // and 0.18 long covers it and a margin (about 44 px on a phone); the Motion slider's box grows outward off the face, taller
  // than its slot, so the whole slot is a target.
  proxy('volume-knob', [0.2, 0.18, 0.2], [0, 0.02, 0]);
  proxy('motion-switch', [0.15, 0.26, 0.14], [-0.055, 0, 0]);
  proxy('sound-switch', [0.15, 0.26, 0.14], [-0.055, 0, 0]);

  // The bottom edge: the cable (the plug, its boot and the first stretch of cable: a target in both states,
  // so the empty port can be clicked to plug back in), the memory-card slot with the card sticking out of
  // it, and the reset pinhole. They hang off the shell, so they turn with the wallet.
  const shell = nodes['shell'];
  const zMid = BODY.t / 2;
  const hit = (id: string, geo: THREE.BufferGeometry, at: [number, number, number]) => {
    const m = new THREE.Mesh(geo, proxyMat);
    m.name = `${id}-hit`;
    m.position.set(...at);
    m.visible = false;
    shell.add(m);
    parts.push({ id, obj: m });
  };
  hit('usb', new THREE.BoxGeometry(0.32, 0.36, 0.26), [0, -0.92, zMid]);
  hit('memory', new THREE.BoxGeometry(0.3, 0.24, 0.26), [-0.31, -0.85, zMid]);
  // The pinhole is on the underside, out of sight from the front; its target reaches below the bottom edge like the others.
  hit('pinhole', new THREE.BoxGeometry(0.16, 0.24, 0.26), [0.3, -0.87, zMid]);

  // Raycast the whole wallet and take the NEAREST hit, then walk up to a part: the knob sits mostly
  // inside the body, so testing parts alone would let clicks on the screen hit it.
  // What was hit: a control, a sticker (only reachable when the back faces you), or the body itself.
  type Target =
    | { kind: 'part'; id: string; point: THREE.Vector3 }
    | { kind: 'sticker'; sticker: Sticker; point: THREE.Vector3 }
    | { kind: 'qr'; sticker: Sticker }
    | { kind: 'body' };
  function target(e: MouseEvent): Target | null {
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([wallet.root], true);
    if (!hits.length) return null;
    const qrOf = hits[0].object.userData.qrOf as Sticker | undefined; // only hit while its flap is latched open
    if (qrOf) return { kind: 'qr', sticker: qrOf };
    const sticker = hits[0].object.userData.sticker as Sticker | undefined;
    if (sticker) return { kind: 'sticker', sticker, point: hits[0].point };
    let o: THREE.Object3D | null = hits[0].object;
    while (o && !parts.some((p) => p.obj === o)) o = o.parent;
    const part = parts.find((p) => p.obj === o);
    return part ? { kind: 'part', id: part.id, point: hits[0].point } : { kind: 'body' };
  }
  const overWallet = (e: MouseEvent) => {
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

  const roll = (delta: number) => h.roll(delta);

  // Volume knob: the site's volume (audio/volume.ts), 270° of turn from quietest to loudest, the pointer stripe
  // climbing as it turns up. Drag it up or down, scroll over it, or tap it to mute and unmute.
  const knobSpin = meshes['volume-knob'];
  const knobAngle = (level: number) => THREE.MathUtils.degToRad((level - 0.5) * 270);
  if (knobSpin) knobSpin.rotation.y = knobAngle(volume.level());
  volume.subscribe((level) => {
    if (!knobSpin) return;
    if (motion.reduced()) knobSpin.rotation.y = knobAngle(level);
    else gsap.to(knobSpin.rotation, { y: knobAngle(level), duration: 0.1, ease: 'power2.out', overwrite: true });
  });
  // The eye's tutorial shows each setting moving, a hint of how it works: the knob turns a little and back, then the
  // two sliders slide a little and back, one after another. The visitor using a control cancels its move (the
  // control's own tween overwrites it), and under reduced motion there is none.
  function nudge() {
    if (motion.reduced()) return;
    for (const [i, id] of ['motion-switch', 'volume-knob', 'sound-switch'].entries()) {
      const delay = 0.35 + i * 0.3;
      if (id === 'volume-knob') {
        if (knobSpin) gsap.to(knobSpin.rotation, { y: '+=0.9', duration: 0.45, delay, yoyo: true, repeat: 3, ease: 'sine.inOut', overwrite: 'auto' });
      } else if (nodes[id]) gsap.to(nodes[id].position, { y: '+=0.03', duration: 0.4, delay, yoyo: true, repeat: 3, ease: 'sine.inOut' });
    }
  }
  let beforeMute = 0.6;
  function setVolume(v: number) {
    const before = volume.level();
    volume.set(v);
    const now = volume.level();
    if (now === before) return;
    stage.screen.toast(now === 0 ? 'MUTED' : `VOLUME ${Math.round(now * 100)}`);
    // a detent every 5 %, pitched up with the level
    if (Math.floor(now * 20) !== Math.floor(before * 20)) sfx.play('detent', { rate: 0.8 + now * 0.5 });
  }
  function toggleMute() {
    if (volume.level() > 0) {
      beforeMute = volume.level();
      setVolume(0);
    } else {
      setVolume(beforeMute || 0.6);
      sfx.play('toggle');
    }
  }

  // Hand gestures. A drag starts on press; a turn only once the pointer has clearly moved sideways
  // (so a tap on the body does nothing and vertical touch drags still scroll the page).
  type Drag =
    | { kind: 'peel'; id: number; sticker: Sticker; lastF: number; lastSound: number; past: boolean }
    // A press on an open sticker: a tap on the QR visits its site, a tap on the flap puts it back.
    | { kind: 'tap'; id: number; sticker: Sticker; qr: boolean; x0: number; y0: number }
    | { kind: 'turn'; id: number; x0: number; y0: number; turning: boolean; pan: boolean; lx: number; ly: number; lt: number; vx: number; vy: number }
    // A press on the volume knob: a drag turns it, a tap mutes.
    | { kind: 'knob'; id: number; x0: number; y0: number; v0: number; moved: boolean };
  let drag: Drag | null = null;
  const TURN_PER_PX = Math.PI / 260; // ~260 px of drag turns it over
  const FREE = { still: 90 }; // ms without movement before a release counts as stopped (no coast)
  // Touch: one finger turns the wallet sideways (a vertical drag is the page's: it scrolls), two fingers pinch to zoom
  // and drag to pan. Two-finger gestures are not scrolling (the canvas allows only one-finger vertical pans), so they
  // reach us without a mode.
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; x: number; y: number } | null = null;
  const pinchOf = () => {
    const [a, b] = [...touches.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  // Capture keeps the drag alive when the pointer leaves the canvas. It throws for a pointer the
  // browser no longer tracks (already lifted, or synthetic); the drag still works without it.
  const capture = (id: number) => {
    try {
      canvas.setPointerCapture(id);
    } catch {
      /* not capturable */
    }
  };

  // The sticker whose flap is latched open (one at a time) and what happens around it.
  let openSticker: Sticker | null = null;
  const buzz = (ms: number) => {
    try {
      navigator.vibrate?.(ms); // phones that allow it; a no-op elsewhere
    } catch {
      /* blocked */
    }
  };
  function healSticker(quiet = false) {
    const s = openSticker;
    if (!s) return;
    openSticker = null;
    h.sticker(null);
    s.heal(undefined, motion.reduced());
    // 'unpeel' is the rip played backwards, cut to the length of the heal, ending in the press as it lands.
    if (!quiet) sfx.play(motion.reduced() ? 'toggle' : 'unpeel', { volume: motion.reduced() ? 0.5 : 0.85 });
  }
  function visit(s: Sticker) {
    window.open(s.url, '_blank', 'noopener,noreferrer');
    healSticker();
  }

  const startTurn = (e: PointerEvent, grab = true) => {
    drag = {
      kind: 'turn', id: e.pointerId, x0: e.clientX, y0: e.clientY, turning: false, lx: e.clientX, ly: e.clientY, lt: performance.now(), vx: 0, vy: 0,
      pan: e.pointerType === 'mouse' && (e.button === 1 || e.button === 2 || e.shiftKey),
    };
    if (grab) capture(e.pointerId);
  };
  /** Touch: note the finger; the second one turns the gesture into a pinch and pan. True when it did. */
  function trackTouch(e: PointerEvent): boolean {
    if (e.pointerType !== 'touch') return false;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size !== 2) return false;
    if (drag?.kind === 'turn' && drag.turning) h.view.release(0, 0);
    drag = null;
    pinch = pinchOf();
    capture(e.pointerId);
    return true;
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (trackTouch(e)) return;
    const hit = target(e);
    if (!hit) return;
    if (hit.kind === 'qr' || (hit.kind === 'sticker' && hit.sticker.isOpen())) {
      drag = { kind: 'tap', id: e.pointerId, sticker: hit.sticker, qr: hit.kind === 'qr', x0: e.clientX, y0: e.clientY };
      capture(e.pointerId);
      return;
    }
    if (hit.kind === 'sticker') {
      drag = { kind: 'peel', id: e.pointerId, sticker: hit.sticker, lastF: 0, lastSound: 0, past: false };
      hit.sticker.beginPeel(hit.point);
      capture(e.pointerId);
      canvas.style.cursor = 'grabbing';
      sfx.play('peel', { volume: 0.5 });
      return;
    }
    if (hit.kind === 'body') return startTurn(e);
    switch (hit.id) {
      case 'tab-01': case 'tab-02': case 'tab-03': case 'tab-04':
        h.selectTab(Number(hit.id.slice(-1)));
        break;
      case 'volume-knob':
        drag = { kind: 'knob', id: e.pointerId, x0: e.clientX, y0: e.clientY, v0: volume.level(), moved: false };
        capture(e.pointerId);
        canvas.style.cursor = 'ns-resize';
        break;
      case 'motion-switch':
        sfx.play('toggle');
        h.toggleMotion();
        break;
      case 'sound-switch':
        sfx.play('toggle'); // before it can be switched off, so the click is heard either way
        h.toggleSound();
        break;
      case 'usb':
        h.togglePlug();
        break;
      case 'memory':
        h.toggleMemory();
        break;
      case 'pinhole':
        sfx.play('press', { rate: 1.4 });
        h.reset();
        break;
      case 'key-confirm':
      case 'key-back':
        pressKey(hit.id);
        break;
      case 'switch-view':
        h.toggleView();
        break;
    }
  });

  // The two face keys: tapped on the wallet, or through their labels along the screen's bottom edge.
  function pressKey(id: 'key-confirm' | 'key-back') {
    if (id === 'key-confirm') {
      press('key-confirm', 'z', 0.004);
      sfx.play('press');
      h.confirm();
    } else {
      press('key-back', 'z', 0.003);
      sfx.play('press', { rate: 0.85 }); // the same press, pitched down: going back sounds like it
      h.back();
    }
  }

  function endDrag(e: PointerEvent) {
    if (touches.delete(e.pointerId) && touches.size < 2) pinch = null;
    if (!drag || drag.id !== e.pointerId) return;
    if (drag.kind === 'tap') {
      // A tap, not a drag that happened to end on it.
      if (e.type === 'pointerup' && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 12) {
        if (drag.qr) visit(drag.sticker);
        else healSticker();
      }
    } else if (drag.kind === 'peel') {
      const s = drag.sticker;
      // Pulled to the end: it stays rolled back, the QR showing. Otherwise it springs back down: the same
      // sound as a heal, sped up to fit the shorter spring.
      const latched = s.release(undefined, motion.reduced());
      // (a nudge too small to have torn anything stays silent)
      if (!latched && drag.lastF > 0) sfx.play(motion.reduced() ? 'toggle' : 'unpeel', { volume: motion.reduced() ? 0.5 : 0.7, rate: 2 });
      if (latched) {
        if (openSticker && openSticker !== s) healSticker(true);
        openSticker = s;
        sfx.play('success', { volume: 0.45 });
        buzz(18);
        h.sticker(s);
      }
    } else if (drag.kind === 'knob') {
      if (!drag.moved && e.type === 'pointerup' && !h.knobTap()) toggleMute(); // a cancel (the page took the touch to scroll) is not a tap
    } else if (drag.turning) {
      if (drag.pan) h.view.release(0, 0);
      else {
        const stopped = performance.now() - drag.lt > FREE.still;
        h.view.release(stopped ? 0 : drag.vx, stopped ? 0 : drag.vy);
        sfx.play('air', { volume: 0.5 });
      }
    }
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    drag = null;
    canvas.style.cursor = '';
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // The wallet stops following the cursor once the pointer is on it (or its screen), so a key never
  // drifts from under the pointer while the tilt settles; it resumes in the open space around it.
  const onPointerMove = (e: PointerEvent) => {
    if (touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && touches.size === 2) {
        const now = pinchOf();
        stage.look.zoomAt(now.d / pinch.d, now.x, now.y);
        stage.look.pan(now.x - pinch.x, now.y - pinch.y);
        pinch = now;
        return;
      }
    }
    if (drag?.id === e.pointerId) {
      if (drag.kind === 'tap') return;
      if (drag.kind === 'peel') {
        ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        const f = drag.sticker.drag(ray.ray);
        // Crossing the line where letting go keeps it open: a click under the finger (a tick on phones).
        if (f >= COMMIT && !drag.past) {
          drag.past = true;
          sfx.play('detent', { volume: 0.7 });
          buzz(8);
        } else if (f < COMMIT - 0.04) drag.past = false;
        // The adhesive tearing as it comes away: one 'rip' per pull (it lasts ~0.55 s), louder for a faster
        // pull, and not again until the flap has travelled on; silent once it stops giving.
        const now = performance.now();
        if (f - drag.lastF > 0.08 && now - drag.lastSound > 520 && f < 0.97) {
          sfx.play('rip', { volume: Math.min(1, 0.45 + (f - drag.lastF) * 2.5) });
          drag.lastSound = now;
          drag.lastF = f;
        } else if (f < drag.lastF) drag.lastF = f;
        return;
      }
      if (drag.kind === 'knob') {
        // Up or right is louder: a mouse can go either way, a finger only sideways (a vertical drag scrolls the page).
        const d = e.clientX - drag.x0 - (e.clientY - drag.y0);
        if (!drag.moved && Math.abs(d) > 3) drag.moved = true;
        if (drag.moved) setVolume(drag.v0 + d / 200); // 200 px of drag covers the whole range
        return;
      }
      const dx = e.clientX - drag.x0;
      const dy = e.clientY - drag.y0;
      // A mouse starts turning once it has clearly moved, any way; a finger only on a sideways drag, so a vertical
      // one still scrolls the page (and a finger only turns the wallet sideways).
      const free = e.pointerType !== 'touch';
      if (!drag.turning && (free ? Math.hypot(dx, dy) > 6 : Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy))) {
        drag.turning = true;
        capture(e.pointerId); // from here the canvas gets the pointer, so the screen's rows never see this as a tap
        drag.lx = e.clientX;
        drag.ly = e.clientY;
        drag.lt = performance.now();
        healSticker(); // turning the wallet away puts an open sticker back
        h.view.begin();
        canvas.style.cursor = drag.pan ? 'move' : 'grabbing';
      }
      if (drag.turning) {
        const mx = e.clientX - drag.lx;
        const my = e.clientY - drag.ly;
        const now = performance.now();
        if (drag.pan) stage.look.pan(mx, my);
        else {
          h.view.by(mx * TURN_PER_PX, free ? my * TURN_PER_PX : 0);
          const dt = Math.max(1, now - drag.lt) / 1000;
          // Smoothed speed in rad/s, for the coast after the release.
          drag.vx += (mx * TURN_PER_PX / dt - drag.vx) * 0.5;
          drag.vy += ((free ? my : 0) * TURN_PER_PX / dt - drag.vy) * 0.5;
        }
        drag.lx = e.clientX;
        drag.ly = e.clientY;
        if (mx || my) drag.lt = now;
      }
      return;
    }
    const t = target(e);
    // Controls say "press"; the body and stickers say "grab" (turn it over, peel).
    canvas.style.cursor = !t ? '' : t.kind === 'part' || t.kind === 'qr' || (t.kind === 'sticker' && t.sticker.isOpen()) ? 'pointer' : 'grab';
    stage.hold(!!t);
    // A tiny tick as the mouse arrives on a control (Contra's device buttons do this; never on touch).
    const part = t?.kind === 'part' ? t.id : null;
    if (part && part !== hovered && e.pointerType === 'mouse') sfx.play('hover');
    hovered = part;
  };
  canvas.addEventListener('pointermove', onPointerMove);
  let hovered: string | null = null;
  canvas.addEventListener('pointerleave', () => {
    stage.hold(false);
    hovered = null;
  });
  // The screen is most of the wallet's front and sits above the canvas, so a drag that starts on it turns the wallet
  // too (after 6 px; a tap still reaches its rows, and the capture in onPointerMove cancels the click of a drag).
  const screenEl = stage.screen.el;
  screenEl.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (trackTouch(e)) return;
    if (!drag) startTurn(e, false);
  });
  screenEl.addEventListener('pointermove', (e) => {
    if (drag?.id === e.pointerId || touches.has(e.pointerId)) onPointerMove(e);
  });
  screenEl.addEventListener('pointerup', endDrag);
  screenEl.addEventListener('pointercancel', endDrag);
  stage.screen.el.addEventListener('pointerenter', () => stage.hold(true));
  stage.screen.el.addEventListener('pointerleave', () => stage.hold(false));

  // Double-click the body: zoom in there, or go home when already zoomed. On empty space: back to the pose.
  canvas.addEventListener('dblclick', (e) => {
    const t = target(e);
    if (t && t.kind !== 'body') return; // a control or sticker was the point of the click
    if (t) stage.look.toggleZoom(e.clientX, e.clientY);
    else if (h.view.isOff()) h.view.reset();
  });
  // Right-drag pans, so the menu stays out of the way over the wallet.
  canvas.addEventListener('contextmenu', (e) => overWallet(e) && e.preventDefault());

  // Wheel over the wallet (canvas or its CSS3D screen) browses the list while it can move; over the
  // knob it sets the volume. Anywhere else, or at a list end, the page scrolls as normal.
  let consumed = false;
  let acc = 0;
  let last = 0;
  function onWheel(e: WheelEvent) {
    consumed = false;
    const dir = Math.sign(e.deltaY);
    if (!dir) return;
    const onScreen = e.target instanceof HTMLElement && !!e.target.closest?.('.eink');
    if (!onScreen && !overWallet(e)) return;
    if (!onScreen) {
      const t = target(e);
      if (t?.kind === 'part' && t.id === 'volume-knob') {
        consumed = true;
        e.preventDefault();
        setVolume(volume.level() - dir * 0.05);
        return;
      }
    }
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
    if (t.closest?.('input, textarea, select, dialog, [contenteditable]')) return;
    if (e.key === 'Escape' && openSticker) {
      healSticker();
      e.preventDefault();
    } else if (e.key === 'Escape' && h.view.isOff()) {
      h.view.reset();
      e.preventDefault();
    } else if (/^[1-4]$/.test(e.key)) {
      h.selectTab(Number(e.key));
      e.preventDefault();
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !t.closest?.('a, button')) {
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
    setMotionSwitch(on) {
      const sw = nodes['motion-switch'];
      if (!sw) return;
      gsap.to(sw.position, { y: MOTION_SW.y + (on ? MOTION_SW.travel : -MOTION_SW.travel), duration: motion.reduced() ? 0 : 0.18, ease: 'power2.out', overwrite: 'auto' });
    },
    setSoundSwitch(on) {
      const sw = nodes['sound-switch'];
      if (!sw) return;
      gsap.to(sw.position, { y: SOUND_SW.y + (on ? SOUND_SW.travel : -SOUND_SW.travel), duration: motion.reduced() ? 0 : 0.18, ease: 'power2.out', overwrite: 'auto' });
    },
    nudge,
    setVolume,
    toggleMute,
    pressKey,
    healSticker: () => healSticker(),
  };
}
