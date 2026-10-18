// Button-driven choreography (docs/device-design.md §10). The page has two places: the Hero (the
// wallet at a three-quarter angle) and the Console (the wallet facing you, pinned while the page
// text follows it). Scroll only moves between the two; inside the Console the wallet's own top tabs
// (and keys 1–4, the on-page tab bar, deep links) choose the section, and each section has its own
// short device move. Layers: `rig` = scroll pose, `pose` = section move, then tilt/actor (stage.ts).
import * as THREE from 'three';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type { Stage } from './stage';
import { motion } from '../motion';
import { sfx } from '../audio/sfx';

gsap.registerPlugin(ScrollTrigger);

export const TABS = ['works', 'chronicle', 'about', 'contact'] as const;
export type TabId = (typeof TABS)[number];
export type Place = 'hero' | 'console';

type Pose = { x: number; y: number; z: number; rx: number; ry: number; rz: number };
const TAB_MESH: Record<TabId, string> = { works: 'tab-01', chronicle: 'tab-02', about: 'tab-03', contact: 'tab-04' };
// Tab click pitch rises 01 → 04 (D, E, F♯, A), so the sound tells you where you are.
// Section moves (yaw, on top of the Console pose). Works faces you; Events turns a little;
// About spins once to show the D-star on the back; Contact turns its right side (the card reader) in.
const TAB_YAW: Record<TabId, number> = { works: 0.08, chronicle: -0.14, about: 0.16, contact: -0.36 };
const TAB_PRESS = 0.02; // the active tab sits sunk into the rail (W)

export interface Choreography {
  place(): Place;
  tab(): TabId;
  /** Choose a section. Only acts on the device in the Console; the caller scrolls there first. */
  setTab(tab: TabId): void;
  onTab(cb: (tab: TabId) => void): void;
  onPlace(cb: (place: Place) => void): void;
  /**
   * The visitor's own view of the wallet (§35): turn it freely by hand (any way round, up to 80° up or down)
   * and pan or zoom the camera (stage.look). It stays where it is left, and goes home on any action.
   */
  view: {
    /** Start a drag: stops any coast or settle in progress. */
    begin(): void;
    /** Drag: turn by these radians (right and down are positive). */
    by(turn: number, pitch: number): void;
    /** Let go at this speed (rad/s): it coasts, and a stop near face-up or face-down is pulled onto it. */
    release(turnSpeed: number, pitchSpeed: number): void;
    /** Turn to a chosen view and stay there (the eye shows the left face, where the settings are). `turn` is the wallet's whole turn: the section's own angle (Contact turns it the other way) is taken off first. */
    show(turn: number, pitch: number): void;
    /** Back to the pose (section change, scroll, Contact, Reset view). `instant` skips the move. */
    reset(instant?: boolean): void;
    /** True while the back faces the visitor. */
    isBack(): boolean;
    /** True when turned, panned or zoomed away from the pose. */
    isOff(): boolean;
    /** How many times the visitor has taken hold of the wallet to turn it (to tell their own turn from a programmed one). */
    grabs(): number;
    /** Called when isOff changes (the Reset view chip). */
    onChange(cb: (off: boolean) => void): void;
  };
  /** Contact layout (world space): where the key card flies in from and leaves to. */
  cardEntry: THREE.Vector3;
}

export function createChoreography(stage: Stage, hero: HTMLElement, consoleEl: HTMLElement): Choreography {
  const { rig, pose, tilt, actor, wallet, screen } = stage;
  const cardEntry = new THREE.Vector3();
  // Hero: three-quarter from above, showing the top tabs and the roller edge (the controls).
  // Console: facing you, tipped back a little so the numbered tabs read from the front.
  const HERO: Pose = { x: 0, y: -0.04, z: 0, rx: 0.3, ry: 0.52, rz: -0.12 };
  const CONSOLE: Pose = { x: 0, y: -0.06, z: 0, rx: 0.14, ry: 0, rz: 0 }; // lower: the tipped-back top rises
  // Phones: the Hero's copy is taller than the Console's, so the wallet starts a little smaller there
  // (its keychain clears the title) and comes up to full size on the way into the Console.
  const HERO_SCALE_PORTRAIT = 0.9;

  // Where the key card flies in from (and leaves to): just past the right edge of the frame.
  function computeCard() {
    cardEntry.set(stage.halfWidthAt(0.4) + 0.9, stage.restY() + 0.1, 0.4);
  }

  // ---------------------------------------------------------------- scroll: Hero ↔ Console
  let progress = 0; // 0 = Hero pose, 1 = Console pose
  const apply = () => {
    const k = progress;
    rig.position.set(HERO.x + (CONSOLE.x - HERO.x) * k, HERO.y + (CONSOLE.y - HERO.y) * k, 0);
    rig.rotation.set(HERO.rx + (CONSOLE.rx - HERO.rx) * k, HERO.ry + (CONSOLE.ry - HERO.ry) * k, HERO.rz + (CONSOLE.rz - HERO.rz) * k);
    rig.scale.setScalar(stage.portrait() ? HERO_SCALE_PORTRAIT + (1 - HERO_SCALE_PORTRAIT) * k : 1);
    stage.focus.set(k); // the camera comes in on the screen as the Console arrives (stage.ts, §37)
  };
  /** Where the wallet's centre is in the world at the Console pose, with every other layer at rest. */
  function aimFocus() {
    const layers = [rig.position, rig.rotation, rig.scale, pose.rotation, tilt.position, tilt.rotation, tilt.scale, actor.rotation];
    const keep = layers.map((o) => o.clone());
    rig.position.set(CONSOLE.x, CONSOLE.y, 0);
    rig.rotation.set(CONSOLE.rx, CONSOLE.ry, CONSOLE.rz);
    rig.scale.setScalar(1);
    pose.rotation.set(0, 0, 0);
    tilt.position.set(0, 0, 0);
    tilt.rotation.set(0, 0, 0);
    tilt.scale.setScalar(1);
    actor.rotation.set(0, 0, 0);
    rig.updateMatrixWorld(true);
    const d = wallet.root.getWorldPosition(new THREE.Vector3());
    layers.forEach((o, i) => o.copy(keep[i] as never));
    rig.updateMatrixWorld(true);
    stage.focus.aim(d.y);
  }
  let trigger: ScrollTrigger | null = null;
  function build() {
    trigger?.kill();
    computeCard();
    aimFocus();
    // Lenis already smooths the scroll; a long scrub on top of it double-smooths and feels floaty.
    trigger = ScrollTrigger.create({
      trigger: consoleEl,
      start: 'top bottom',
      // clamp(): on a phone the page can end before the Console's top (see queueSnap in main.ts); the
      // move still has to finish there.
      end: 'clamp(top top)',
      scrub: motion.reduced() ? true : 0.35,
      onUpdate: (self) => {
        progress = self.progress;
        apply();
      },
    });
    progress = trigger.progress;
    apply();
    ScrollTrigger.refresh();
  }

  // ---------------------------------------------------------------- section moves (the `pose` layer)
  // Yaw eases toward the section's value (interruptible: gsap retargets from the current angle);
  // the About spin is a separate channel so a quick tab change can cut it short cleanly. Both fade
  // in with the scroll progress, so the Hero pose is never offset by the last section.
  const move = { yaw: 0, spin: 0, turn: 0, pitch: 0 };
  let spinTween: gsap.core.Tween | null = null;
  // The About spin is a first-visit delight: once per page view. Repeating it (tab, key 3) would hide
  // the About screen behind 0.8 s of spin every time the visitor asks for it.
  let aboutSpun = false;
  // Hand turn: 1:1 with the drag while held; on release it coasts to a stop, and a stop near face-up or
  // face-down is pulled onto it (so getting back to a straight-on view is easy). Pitch is limited so the
  // wallet never goes over the top. Anything that changes the view brings it back to the pose.
  const PITCH_MAX = 1.4; // rad, about 80°
  const COAST = 3.5; // 1/s: how fast a release slows
  const MAGNET = 0.2; // rad: a stop this close to face-up or face-down snaps onto it
  const TAU = Math.PI * 2;
  const vel = { turn: 0, pitch: 0 };
  let held = false;
  let settleTween: gsap.core.Tween | null = null;
  const clampPitch = (v: number) => THREE.MathUtils.clamp(v, -PITCH_MAX, PITCH_MAX);
  const wrap = (a: number) => ((a % TAU) + TAU) % TAU;
  const offNow = () => Math.abs(Math.atan2(Math.sin(move.turn), Math.cos(move.turn))) > 0.02 || Math.abs(move.pitch) > 0.02 || stage.look.isOff();
  const viewCbs: ((off: boolean) => void)[] = [];
  let lastOff = false;
  const settle = (turn: number, pitch: number, instant = false) => {
    settleTween?.kill();
    vel.turn = vel.pitch = 0;
    settleTween = gsap.to(move, {
      turn,
      pitch,
      duration: instant || motion.reduced() ? 0 : 0.55,
      ease: 'power3.out',
      // Keep the angle small so the next turn starts from a clean 0 or π.
      onComplete: () => void (move.turn = wrap(move.turn)),
    });
    if (instant || motion.reduced()) settleTween.progress(1); // land now, so a caller can rely on the pose
  };
  const applyPose = () => pose.rotation.set(move.pitch, move.yaw * progress + move.spin + move.turn, 0);
  stage.onFrame((dt) => {
    if (!held && (vel.turn !== 0 || vel.pitch !== 0)) {
      move.turn += vel.turn * dt;
      move.pitch = clampPitch(move.pitch + vel.pitch * dt);
      if (Math.abs(move.pitch) === PITCH_MAX) vel.pitch = 0;
      const decay = Math.exp(-COAST * dt);
      vel.turn *= decay;
      vel.pitch *= decay;
      if (Math.abs(vel.turn) < 0.02 && Math.abs(vel.pitch) < 0.02) vel.turn = vel.pitch = 0;
    }
    applyPose();
    const off = offNow();
    stage.calm(off); // the cursor follow would fight a view the visitor chose
    if (off !== lastOff) {
      lastOff = off;
      viewCbs.forEach((cb) => cb(off));
    }
  });
  let grabCount = 0;
  const view = {
    begin() {
      grabCount++;
      settleTween?.kill();
      vel.turn = vel.pitch = 0;
      held = true;
    },
    by(turn: number, pitch: number) {
      move.turn += turn;
      move.pitch = clampPitch(move.pitch + pitch);
    },
    release(turnSpeed: number, pitchSpeed: number) {
      held = false;
      if (motion.reduced()) {
        turnSpeed = pitchSpeed = 0;
      }
      // Where the coast will end, to see whether it is near a face.
      const endTurn = move.turn + turnSpeed / COAST;
      const endPitch = clampPitch(move.pitch + pitchSpeed / COAST);
      const face = Math.round(endTurn / Math.PI) * Math.PI;
      if (Math.abs(endTurn - face) < MAGNET && Math.abs(endPitch) < MAGNET) return settle(face, 0);
      vel.turn = turnSpeed;
      vel.pitch = pitchSpeed;
    },
    show(turn: number, pitch: number) {
      held = false;
      settle(turn - move.yaw * progress - move.spin, pitch);
    },
    reset(instant = false) {
      held = false;
      stage.look.reset(instant);
      if (!offNow() && !settleTween?.isActive() && vel.turn === 0 && vel.pitch === 0) return;
      settle(Math.round(move.turn / TAU) * TAU, 0, instant);
      // An instant reset is asked for by code that reads the wallet's world pose in the same tick (the Contact
      // sequence aims the key card at the reader): the pose must be home now, not on the next frame.
      if (instant) applyPose();
    },
    isBack: () => Math.abs(wrap(move.turn) - Math.PI) < Math.PI / 2,
    isOff: offNow,
    grabs: () => grabCount,
    onChange: (cb: (off: boolean) => void) => viewCbs.push(cb),
  };
  function moveTo(tab: TabId) {
    const reduced = motion.reduced();
    gsap.to(move, { yaw: TAB_YAW[tab], duration: reduced ? 0 : 0.55, ease: 'power3.out', overwrite: 'auto' });
    spinTween?.kill();
    if (tab === 'about' && !reduced && !aboutSpun) {
      aboutSpun = true;
      spinTween = gsap.fromTo(move, { spin: 0 }, { spin: -Math.PI * 2, duration: 0.8, ease: 'power3.inOut', onComplete: () => void (move.spin = 0) });
    } else if (move.spin !== 0) {
      // Interrupted mid-spin: finish the nearer way round, quickly.
      const to = move.spin < -Math.PI ? -Math.PI * 2 : 0;
      spinTween = gsap.to(move, { spin: to, duration: reduced ? 0 : 0.3, ease: 'power2.out', onComplete: () => void (move.spin = 0) });
    }
  }

  // ---------------------------------------------------------------- tabs: press + screen + page
  const tabRestY: Record<TabId, number> = Object.fromEntries(TABS.map((t) => [t, wallet.runtime.nodes[TAB_MESH[t]]?.position.y ?? 0])) as Record<TabId, number>;
  const mats = wallet.root.userData.materials as { champagne: THREE.Material; polymer: THREE.Material };
  function pressTab(active: TabId | null) {
    for (const t of TABS) {
      const node = wallet.runtime.nodes[TAB_MESH[t]];
      const mesh = wallet.runtime.meshes[TAB_MESH[t]];
      if (!node || !mesh) continue;
      const on = t === active;
      mesh.material = on ? mats.champagne : mats.polymer;
      gsap.to(node.position, { y: tabRestY[t] - (on ? TAB_PRESS : 0), duration: motion.reduced() ? 0 : 0.16, ease: 'power2.out' });
    }
  }

  let place: Place = 'hero';
  let tab: TabId = 'works';
  const tabCbs: ((t: TabId) => void)[] = [];
  const placeCbs: ((p: Place) => void)[] = [];

  function setPlace(p: Place) {
    if (p === place) return;
    place = p;
    view.reset();
    if (p === 'console') {
      pressTab(tab);
      screen.setMode(tab);
      moveTo(tab);
    } else {
      pressTab(null);
      screen.setMode('hello');
    }
    placeCbs.forEach((cb) => cb(p));
  }
  // Enter / leave-back, not onToggle: the Console is the end of the page, and ScrollTrigger counts the
  // exact end of its range as "left", which would flip the screen back to Hello at the bottom.
  ScrollTrigger.create({
    trigger: consoleEl,
    start: 'top 55%',
    onEnter: () => setPlace('console'),
    onLeaveBack: () => setPlace('hero'),
    onRefresh: (self) => setPlace(self.progress > 0 || scrollY >= self.start ? 'console' : 'hero'),
  });

  function setTab(next: TabId) {
    if (next === tab) return;
    tab = next;
    view.reset();
    if (place === 'console') {
      pressTab(tab);
      screen.setMode(tab);
      moveTo(tab);
      sfx.play('press');
    }
    tabCbs.forEach((cb) => cb(tab));
  }

  // The Hero copy fades as the Console arrives, so the two titles never stack. Triggered by the
  // SECTION: the copy is position: sticky, whose measured position shifts with scroll.
  const heroCopy = hero.querySelector<HTMLElement>('.section-copy');
  if (heroCopy) {
    gsap.fromTo(heroCopy, { opacity: 1 }, {
      opacity: 0, ease: 'none', immediateRender: false,
      scrollTrigger: { trigger: hero, start: 'bottom 70%', end: 'bottom 35%', scrub: true },
    });
  }

  pressTab(null);
  build();
  stage.onResize(build);
  motion.subscribe(build);

  return {
    place: () => place,
    tab: () => tab,
    setTab,
    onTab: (cb) => tabCbs.push(cb),
    onPlace: (cb) => placeCbs.push(cb),
    view,
    cardEntry,
  };
}
