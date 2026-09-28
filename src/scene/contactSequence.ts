// Contact: Dean's NFC key card taps the wallet (docs/device-design.md §8). Moves the `actor` (not the
// scroll rig), so scrolling and the sequence never fight. The card is off-screen until requested.
import * as THREE from 'three';
import gsap from 'gsap';
import { CARD } from '../device/keyCard';
import { setContactCardWritten } from '../ui/contactCard';
import type { Stage } from './stage';
import { motion } from '../motion';
import { sfx } from '../audio/sfx';

export type ContactState = 'idle' | 'running' | 'ready';

export interface ContactSequence {
  state(): ContactState;
  run(): void;
  putAway(immediate?: boolean): void;
  onState(cb: (s: ContactState) => void): void;
}

export function createContactSequence(
  stage: Stage,
  layout: { cardEntry: THREE.Vector3; cardFinal: THREE.Vector3 },
  announce: (msg: string) => void,
): ContactSequence {
  const { scene, tilt, actor, wallet, keychain, card, screen, label } = stage;
  const TAP = new THREE.Euler(0.01, -2.5, 0); // actor offset: back turned toward the incoming card
  const READ = new THREE.Euler(0, -0.14, 0);
  const ENTRY_ROT = new THREE.Euler(0.3, -1.1, 0.4);
  const FINAL_ROT = new THREE.Euler(0.02, -0.16, 0);
  let state: ContactState = 'idle';
  const cbs: ((s: ContactState) => void)[] = [];
  const set = (s: ContactState) => {
    state = s;
    cbs.forEach((cb) => cb(s));
  };
  let tl: gsap.core.Timeline | null = null;

  function slerpTo(obj: THREE.Object3D, to: THREE.Quaternion, duration: number, ease: string) {
    const from = new THREE.Quaternion();
    const p = { t: 0 };
    return gsap.to(p, { t: 1, duration, ease, onStart: () => from.copy(obj.quaternion), onUpdate: () => obj.quaternion.slerpQuaternions(from, to, p.t) });
  }

  // Where the card meets the back plate, with the cursor tilt and float at rest: follow is switched
  // off when the sequence starts and settles well before the tap at 0.7 s.
  function contactPose() {
    const saved = { rot: actor.rotation.clone(), tq: tilt.quaternion.clone(), tp: tilt.position.clone(), ts: tilt.scale.clone() };
    actor.rotation.copy(TAP);
    tilt.quaternion.identity();
    tilt.position.set(0, 0, 0);
    tilt.scale.setScalar(1);
    wallet.root.updateMatrixWorld(true);
    const pos = wallet.root.localToWorld(new THREE.Vector3(0.02, 0.3, -0.077 - 0.0045 - CARD.thickness / 2));
    const wq = wallet.root.getWorldQuaternion(new THREE.Quaternion());
    const quat = wq.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.14)));
    const away = new THREE.Vector3(0, 0, -1).applyQuaternion(wq);
    actor.rotation.copy(saved.rot);
    tilt.quaternion.copy(saved.tq);
    tilt.position.copy(saved.tp);
    tilt.scale.copy(saved.ts);
    wallet.root.updateMatrixWorld(true);
    return { pos, quat, pre: pos.clone().addScaledVector(away, 0.35) };
  }

  function ready() {
    tl = null;
    set('ready');
    announce('Contact details ready: email, LinkedIn and WhatsApp.');
  }

  // The details are written line by line (contactCard.css staggers them 80 ms): one printhead step each.
  function writeDetails() {
    setContactCardWritten(label, true);
    [0, 80, 160].forEach((ms) => setTimeout(() => state !== 'idle' && sfx.play('write'), ms));
  }

  function run() {
    if (state !== 'idle') return;
    set('running');
    stage.follow(false);
    announce('Reading Dean’s key');
    if (motion.reduced()) {
      actor.rotation.copy(READ);
      card.group.position.copy(layout.cardFinal);
      card.group.rotation.copy(FINAL_ROT);
      card.group.visible = true;
      screen.setContactState('verified');
      sfx.play('verified');
      writeDetails();
      return ready();
    }
    const tap = contactPose();
    card.group.position.copy(layout.cardEntry);
    card.group.rotation.copy(ENTRY_ROT);
    card.group.visible = true;
    const T = 0.7;
    sfx.play('whoosh'); // shaped to this timeline's speed curve (scripts/audio/build_sfx.py)
    tl = gsap.timeline();
    tl.to(actor.rotation, { x: TAP.x, y: TAP.y, duration: 0.6, ease: 'power2.inOut' }, 0);
    tl.to(card.group.position, { x: tap.pre.x, y: tap.pre.y, z: tap.pre.z, duration: 0.56, ease: 'power3.out' }, 0);
    tl.add(slerpTo(card.group, tap.quat, 0.56, 'power2.inOut'), 0);
    tl.to(card.group.position, { x: tap.pos.x, y: tap.pos.y, z: tap.pos.z, duration: 0.14, ease: 'power2.in' }, 0.56); // impact
    tl.call(() => {
      wallet.root.attach(card.group);
      keychain.nudge(0.7);
      sfx.play('tap');
      screen.setContactState('reading');
    }, [], T);
    tl.to(actor.rotation, { z: 0.035, duration: 0.07, ease: 'power1.out' }, T);
    tl.to(actor.rotation, { z: 0, duration: 0.35, ease: 'back.out(2.5)' }, T + 0.07);
    tl.to(wallet.led, { emissiveIntensity: 3, duration: 0.06, ease: 'none' }, T);
    tl.to(wallet.led, { emissiveIntensity: 0.6, duration: 0.5, ease: 'power2.out' }, T + 0.06);
    tl.to(actor.rotation, { x: READ.x, y: READ.y, duration: 0.75, ease: 'power2.inOut' }, T + 0.25);
    tl.call(() => {
      scene.attach(card.group);
      screen.setContactState('verified');
      sfx.play('verified');
      sfx.play('swish', { volume: 0.7 }); // the card swinging out toward the visitor
      const start = card.group.position.clone();
      const f = layout.cardFinal;
      const out = gsap.timeline({ onComplete: ready });
      out.to(card.group.position, { x: start.x + 0.9, y: start.y + 0.04, z: start.z + 0.3, duration: 0.45, ease: 'power2.out' }, 0);
      out.add(slerpTo(card.group, new THREE.Quaternion().setFromEuler(FINAL_ROT), 0.8, 'power3.out'), 0);
      out.to(card.group.position, { x: f.x, y: f.y, z: f.z, duration: 0.45, ease: 'power3.out' }, 0.4);
      out.call(writeDetails, [], 0.62);
      tl = out;
    }, [], T + 1.05);
  }

  function putAway(immediate = false) {
    if (state === 'idle') return;
    tl?.kill();
    tl = null;
    if (card.group.parent !== scene) scene.attach(card.group);
    setContactCardWritten(label, false);
    screen.setContactState('prompt');
    const done = () => {
      card.group.visible = false;
      stage.follow(true);
      set('idle');
    };
    if (immediate || motion.reduced()) {
      actor.rotation.set(0, 0, 0);
      wallet.led.emissiveIntensity = 0.15;
      return done();
    }
    set('running');
    sfx.play('swish'); // 0.4 s power2.out, like the motion
    const out = gsap.timeline({ onComplete: done });
    const e = layout.cardEntry;
    out.to(card.group.position, { x: e.x, y: e.y, z: e.z, duration: 0.4, ease: 'power2.out' }, 0);
    out.add(slerpTo(card.group, new THREE.Quaternion().setFromEuler(ENTRY_ROT), 0.4, 'power2.out'), 0);
    out.to(actor.rotation, { x: 0, y: 0, z: 0, duration: 0.4, ease: 'power2.inOut' }, 0);
    out.to(wallet.led, { emissiveIntensity: 0.15, duration: 0.3, ease: 'power2.out' }, 0);
  }

  return { state: () => state, run, putAway, onState: (cb) => cbs.push(cb) };
}
