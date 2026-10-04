// Contact: Dean's key card goes into the wallet's card reader (the +X side slot) and stays there. The
// wallet turns its screen to the visitor, the screen reads the key and then shows Dean's details: the
// screen is the primary view, the slotted card is the proof (docs/device-design.md §10, §27). "Put the
// key away" ejects it on the reader's spring and it leaves. Moves the `actor` (not the scroll rig or the
// section pose), so scrolling, tabs and the sequence never fight. The card is off-screen until requested.
import * as THREE from 'three';
import gsap from 'gsap';
import { CARD } from '../device/keyCard';
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
  layout: { cardEntry: THREE.Vector3 },
  announce: (msg: string) => void,
): ContactSequence {
  const { scene, tilt, actor, wallet, keychain, card, screen } = stage;
  const SIDE = new THREE.Euler(0.04, -0.5, 0); // actor: the reader side turned toward the visitor
  const READ = new THREE.Euler(0, 0.22, 0); // actor: screen back toward the visitor, the slotted card sticking out right
  const ENTRY_ROT = new THREE.Euler(0.35, -0.9, 0.3);
  const READ_TIME = 1.15; // s from the card seating to the details on screen (the screen's stepped bar runs 750 ms)
  // Phones: the wallet stays centred at full size and its screen faces the visitor straight on (the actor
  // turn cancels the Contact pose's −0.36): the screen and its details are what matter there, so the
  // slotted card is allowed to run off the right edge.
  const readPose = () => (stage.portrait() ? new THREE.Euler(0, 0.36, 0) : READ);
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

  /** The card in the slot: a child of the wallet, so it turns with it. */
  function seat(x = INSIDE_X) {
    wallet.root.attach(card.group);
    card.group.position.set(x, SLOT_Y, 0);
    card.group.quaternion.identity();
  }

  function ready() {
    tl = null;
    set('ready');
    announce('Dean’s key is read. Email, LinkedIn and WhatsApp are on the wallet’s screen.');
  }

  function run() {
    if (state !== 'idle') return;
    set('running');
    stage.follow(false);
    announce('Reading Dean’s key');
    card.group.visible = true;
    if (motion.reduced()) {
      seat();
      actor.rotation.copy(readPose());
      wallet.led.emissiveIntensity = 0.6;
      screen.setContactState('verified');
      sfx.play('success');
      return ready();
    }
    const mouth = mouthPose();
    card.group.position.copy(layout.cardEntry);
    card.group.rotation.copy(ENTRY_ROT);
    sfx.play('air');
    const IN = 0.55; // card lined up at the mouth
    const LATCH = IN + 0.28; // pushed home: fast in, slowed by the slot's friction; the recoil is the latch
    tl = gsap.timeline();
    tl.to(actor.rotation, { x: SIDE.x, y: SIDE.y, z: 0, duration: 0.55, ease: 'power2.inOut' }, 0);
    tl.to(card.group.position, { x: mouth.pos.x, y: mouth.pos.y, z: mouth.pos.z, duration: IN, ease: 'power3.out' }, 0);
    tl.add(slerpTo(card.group, mouth.quat, IN, 'power2.out'), 0);
    tl.call(() => seat(OUTSIDE_X), [], IN); // from here it moves with the wallet
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
    // Seated: the wallet turns its screen back to the visitor (the card stays in, sticking out of the
    // reader on the right), the screen reads the key, then shows the details. Nothing comes back out.
    const read = readPose();
    tl.to(actor.rotation, { x: read.x, y: read.y, duration: 0.7, ease: 'power2.inOut' }, LATCH + 0.15);
    tl.call(() => {
      screen.setContactState('verified');
      sfx.play('success');
    }, [], LATCH + READ_TIME);
    tl.to(wallet.led, { emissiveIntensity: 0.6, duration: 0.4, ease: 'power2.out' }, LATCH + READ_TIME);
    tl.call(ready, [], LATCH + READ_TIME + 0.1);
  }

  function putAway(immediate = false) {
    if (state === 'idle') return;
    tl?.kill();
    tl = null;
    screen.setContactState('prompt');
    const done = () => {
      if (card.group.parent !== scene) scene.attach(card.group);
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
    const out = gsap.timeline({ onComplete: done });
    const e = layout.cardEntry;
    let at = 0;
    if (card.group.parent === wallet.root) {
      // Slotted: the reader's spring pushes it out first (the reader side turns toward the visitor so
      // the eject is seen), then it is taken away.
      out.to(actor.rotation, { x: SIDE.x, y: SIDE.y, z: 0, duration: 0.45, ease: 'power2.inOut' }, 0);
      out.call(() => sfx.play('toggle', { rate: 1.25 }), [], 0.3);
      out.to(card.group.position, { x: OUTSIDE_X + 0.04, duration: 0.34, ease: 'back.out(1.6)' }, 0.3);
      out.to(wallet.led, { emissiveIntensity: 0.15, duration: 0.3, ease: 'power2.out' }, 0.3);
      at = 0.66;
      out.call(() => scene.attach(card.group), [], at);
    }
    out.call(() => sfx.play('air'), [], at);
    out.to(card.group.position, { x: e.x, y: e.y, z: e.z, duration: 0.4, ease: 'power2.out' }, at);
    out.add(slerpTo(card.group, new THREE.Quaternion().setFromEuler(ENTRY_ROT), 0.4, 'power2.out'), at);
    out.to(actor.rotation, { x: 0, y: 0, z: 0, duration: 0.4, ease: 'power2.inOut' }, at);
    out.to(wallet.led, { emissiveIntensity: 0.15, duration: 0.3, ease: 'power2.out' }, at);
  }

  return { state: () => state, run, putAway, onState: (cb) => cbs.push(cb) };
}
