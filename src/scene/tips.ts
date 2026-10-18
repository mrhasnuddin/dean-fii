// The eye's callouts (docs/device-design.md §36): a short tutorial for the three site settings on the wallet's left
// face (the Motion slider, the volume knob and the Sound slider). All three callouts come up together, each with a
// line to its part, say what it does, and go together after about 4.6 s. The parts are on the device the whole
// time; this only points at them. Callouts follow their parts as the wallet moves, only show while the left face
// is turned toward the visitor, and sit beside the part on whichever side has room (over the wallet on a phone).
import * as THREE from 'three';
import type { Stage } from './stage';

const SHOW_MS = 4600; // how long the callouts stay once the left face is in view
const RESUME_MS = 1800; // after the pointer leaves a callout it was resting on
const GIVE_UP_MS = 9000; // the face never turned toward the visitor: let it go
const FACING = 0.25; // cosine of the angle the left face must be turned toward the camera for its callouts to show
const GAP = 34; // px from the part to the callout
const NS = 'http://www.w3.org/2000/svg';

/** What each callout points at: a node of the wallet and a point in its local frame (outward is local −X, or +Y for the knob). */
const ANCHORS = [
  { id: 'motion', node: 'motion-switch', at: new THREE.Vector3(-0.012, 0, 0) },
  { id: 'volume', node: 'volume-knob', at: new THREE.Vector3(0, 0.05, 0) },
  { id: 'sound', node: 'sound-switch', at: new THREE.Vector3(-0.012, 0, 0) },
] as const;

export interface Tips {
  show(): void;
  hide(): void;
  isOn(): boolean;
  /** True when the left face is turned toward the visitor, so the callouts would show. */
  facing(): boolean;
  /** Called when the callouts go (their time ran out, or hide()). */
  onHide(cb: () => void): void;
}

export function createTips(stage: Stage, host: HTMLElement): Tips {
  const { wallet, camera } = stage;
  const cards = ANCHORS.map((a) => host.querySelector<HTMLElement>(`.tip[data-tip="${a.id}"]`)!);
  const svg = host.querySelector('svg')!;
  const lines = ANCHORS.map(() => {
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('pathLength', '1');
    const d = document.createElementNS(NS, 'circle');
    d.setAttribute('r', '3.5');
    svg.append(l, d);
    return { l, d };
  });
  const nodes = ANCHORS.map((a) => wallet.runtime.nodes[a.node]);
  let on = false;
  let armed = false; // the time has started: the callouts are in view
  let timer = 0;
  let offAt = -1e9;
  const cbs: (() => void)[] = [];
  const v = new THREE.Vector3();
  const w = new THREE.Vector3();
  const n = new THREE.Vector3();
  const q = new THREE.Quaternion();

  function facing(): boolean {
    nodes[1].getWorldPosition(v);
    n.set(-1, 0, 0).applyQuaternion(wallet.root.getWorldQuaternion(q));
    return n.dot(w.copy(camera.position).sub(v).normalize()) > FACING;
  }

  function hide() {
    if (!on) return;
    on = false;
    armed = false;
    offAt = performance.now();
    clearTimeout(timer);
    host.classList.remove('on');
    cbs.forEach((cb) => cb());
  }
  const arm = (ms: number) => {
    clearTimeout(timer);
    timer = window.setTimeout(hide, ms);
  };

  /** Once a frame while the callouts are up or fading: put each beside its part, with its line. */
  function place() {
    const face = facing();
    if (on && face && !armed) {
      armed = true;
      arm(SHOW_MS);
    }
    const W = innerWidth;
    const H = innerHeight;
    cards.forEach((card, i) => {
      nodes[i].localToWorld(v.copy(ANCHORS[i].at));
      v.project(camera);
      const x = ((v.x + 1) / 2) * W;
      const y = ((1 - v.y) / 2) * H;
      const cw = card.offsetWidth;
      const ch = card.offsetHeight;
      const left = x - GAP - cw >= 8;
      const cx = THREE.MathUtils.clamp(left ? x - GAP - cw : x + GAP, 8, W - cw - 8);
      const cy = THREE.MathUtils.clamp(y - ch / 2, 74, H - ch - 8);
      card.style.setProperty('--x', `${cx.toFixed(1)}px`);
      card.style.setProperty('--y', `${cy.toFixed(1)}px`);
      card.classList.toggle('face', face);
      const { l, d } = lines[i];
      const ex = cx + (cx < x ? cw : 0);
      l.setAttribute('x1', ex.toFixed(1));
      l.setAttribute('y1', (cy + ch / 2).toFixed(1));
      l.setAttribute('x2', x.toFixed(1));
      l.setAttribute('y2', y.toFixed(1));
      d.setAttribute('cx', x.toFixed(1));
      d.setAttribute('cy', y.toFixed(1));
      l.classList.toggle('face', face);
      d.classList.toggle('face', face);
    });
  }
  stage.onFrame(() => {
    if (on || performance.now() - offAt < 500) place();
  });

  // A callout the pointer is resting on stays; a tap or click on one sends them all away.
  for (const card of cards) {
    card.addEventListener('pointerenter', () => on && armed && clearTimeout(timer));
    card.addEventListener('pointerleave', () => on && armed && arm(RESUME_MS));
    card.addEventListener('click', hide);
  }

  return {
    show() {
      if (on) return;
      on = true;
      armed = false;
      host.classList.add('on');
      arm(GIVE_UP_MS); // replaced by the real time as soon as the left face is in view (place() below, or a frame later)
      place();
    },
    hide,
    isOn: () => on,
    facing,
    onHide: (cb) => cbs.push(cb),
  };
}
