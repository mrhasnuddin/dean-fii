// Contact: Dean's key card goes into the wallet's card reader (the +X side slot) blank, and comes
// back out with Dean's details written on it (docs/device-design.md §10). Moves the `actor` (not the
// scroll rig or the section pose), so scrolling, tabs and the sequence never fight. The card is
// off-screen until requested.
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

// Card positions in wallet-local space (W). The reader mouth is on the +X face at y = −0.02; the card's
// short edge goes in first, 0.5 W deep, leaving 0.36 W to hold.
const SLOT_Y = -0.02;
const OUTSIDE_X = 0.5 + CARD.w / 2 + 0.02; // leading edge just clear of the mouth
const INSIDE_X = 0.5 - 0.5 + CARD.w / 2; // inserted 0.5 W

export function createContactSequence(
  stage: Stage,
  layout: { cardEntry: THREE.Vector3; cardFinal: THREE.Vector3 },
  announce: (msg: string) => void,
): ContactSequence {
  const { scene, tilt, actor, wallet, keychain, card, screen, label } = stage;
  const SIDE = new THREE.Euler(0.04, -0.5, 0); // actor: the reader side turned toward the visitor
  const READ = new THREE.Euler(0, 0.22, 0); // actor: back toward the visitor, card sticking out right
  const ENTRY_ROT = new THREE.Euler(0.35, -0.9, 0.3);
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

  // World pose of the card lined up at the mouth, computed as the wallet will stand when it arrives:
  // actor turned to SIDE, cursor tilt and float at rest (follow is off and settles in < 0.4 s).
  function mouthPose() {
    const saved = { rot: actor.rotation.clone(), tq: tilt.quaternion.clone(), tp: tilt.position.clone(), ts: tilt.scale.clone() };
    actor.rotation.copy(SIDE);
    tilt.quaternion.identity();
    tilt.position.set(0, 0, 0);
    tilt.scale.setScalar(1);
    wallet.root.updateMatrixWorld(true);
    const pos = wallet.root.localToWorld(new THREE.Vector3(OUTSIDE_X, SLOT_Y, 0));
    const quat = wallet.root.getWorldQuaternion(new THREE.Quaternion());
    actor.rotation.copy(saved.rot);
    tilt.quaternion.copy(saved.tq);
    tilt.position.copy(saved.tp);
    tilt.scale.copy(saved.ts);
    wallet.root.updateMatrixWorld(true);
    return { pos, quat };
  }

  // The details are written line by line (contactCard.css staggers them 80 ms).
  function showDetails() {
    card.labelAnchor.visible = true;
    setContactCardWritten(label, true);
  }

  function ready() {
    tl = null;
    set('ready');
    announce('Dean’s key is written: email, LinkedIn and WhatsApp.');
  }

  function run() {
    if (state !== 'idle') return;
    set('running');
    stage.follow(false);
    announce('Writing Dean’s key');
    card.group.visible = true;
    if (motion.reduced()) {
      card.group.position.copy(layout.cardFinal);
      card.group.rotation.copy(FINAL_ROT);
      screen.setContactState('verified');
      sfx.play('success');
      showDetails();
      return ready();
    }
    const mouth = mouthPose();
    card.labelAnchor.visible = false; // CSS3D would draw the (blank) label through the wallet body
    card.group.position.copy(layout.cardEntry);
    card.group.rotation.copy(ENTRY_ROT);
    sfx.play('air');
    const IN = 0.55; // card lined up at the mouth
    const LATCH = IN + 0.28; // pushed home: fast in, slowed by the slot's friction; the recoil is the latch
    tl = gsap.timeline();
    tl.to(actor.rotation, { x: SIDE.x, y: SIDE.y, z: 0, duration: 0.55, ease: 'power2.inOut' }, 0);
    tl.to(card.group.position, { x: mouth.pos.x, y: mouth.pos.y, z: mouth.pos.z, duration: IN, ease: 'power3.out' }, 0);
    tl.add(slerpTo(card.group, mouth.quat, IN, 'power2.out'), 0);
    tl.call(() => {
      wallet.root.attach(card.group); // from here it moves with the wallet
      card.group.position.set(OUTSIDE_X, SLOT_Y, 0);
      card.group.quaternion.identity();
    }, [], IN);
    tl.to(card.group.position, { x: INSIDE_X, duration: LATCH - IN, ease: 'power3.out' }, IN);
    tl.call(() => {
      keychain.nudge(0.5);
      screen.setContactState('reading');
      sfx.play('toggle'); // the card seats
      sfx.play('process'); // and the reader writes (the screen's stepped bar runs 750 ms)
    }, [], LATCH);
    tl.to(actor.rotation, { z: 0.02, duration: 0.06, ease: 'power1.out' }, LATCH);
    tl.to(actor.rotation, { z: 0, duration: 0.3, ease: 'back.out(2.5)' }, LATCH + 0.06);
    tl.to(wallet.led, { emissiveIntensity: 3, duration: 0.06, ease: 'none' }, LATCH);
    tl.to(wallet.led, { emissiveIntensity: 1.2, duration: 0.4, ease: 'power2.out' }, LATCH + 0.06);
    tl.to(actor.rotation, { x: READ.x, y: READ.y, duration: 0.7, ease: 'power2.inOut' }, LATCH + 0.15);
    // Written: eject on the reader's spring, then the card floats out to be read.
    const EJECT = LATCH + 1.0;
    tl.call(() => {
      screen.setContactState('verified');
      sfx.play('toggle', { rate: 1.25 }); // the reader's spring: a lighter thock
    }, [], EJECT);
    tl.to(card.group.position, { x: OUTSIDE_X + 0.04, duration: 0.34, ease: 'back.out(1.6)' }, EJECT);
    tl.to(wallet.led, { emissiveIntensity: 0.6, duration: 0.4, ease: 'power2.out' }, EJECT);
    tl.call(() => {
      scene.attach(card.group);
      sfx.play('success');
      sfx.play('air', { volume: 0.7 });
      const out = gsap.timeline({ onComplete: ready });
      const f = layout.cardFinal;
      out.to(card.group.position, { x: f.x, y: f.y, z: f.z, duration: 0.6, ease: 'power3.out' }, 0);
      out.add(slerpTo(card.group, new THREE.Quaternion().setFromEuler(FINAL_ROT), 0.6, 'power3.out'), 0);
      out.call(showDetails, [], 0.3);
      tl = out;
    }, [], EJECT + 0.36);
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
      card.labelAnchor.visible = true;
      stage.follow(true);
      set('idle');
    };
    if (immediate || motion.reduced()) {
      actor.rotation.set(0, 0, 0);
      wallet.led.emissiveIntensity = 0.15;
      return done();
    }
    set('running');
    sfx.play('air');
    const out = gsap.timeline({ onComplete: done });
    const e = layout.cardEntry;
    out.to(card.group.position, { x: e.x, y: e.y, z: e.z, duration: 0.4, ease: 'power2.out' }, 0);
    out.add(slerpTo(card.group, new THREE.Quaternion().setFromEuler(ENTRY_ROT), 0.4, 'power2.out'), 0);
    out.to(actor.rotation, { x: 0, y: 0, z: 0, duration: 0.4, ease: 'power2.inOut' }, 0);
    out.to(wallet.led, { emissiveIntensity: 0.15, duration: 0.3, ease: 'power2.out' }, 0);
  }

  return { state: () => state, run, putAway, onState: (cb) => cbs.push(cb) };
}
