// Button-driven choreography (docs/device-design.md §10). The page has two places: the Hero (the
// wallet at a three-quarter angle) and the Console (the wallet facing you, pinned while the page
// text follows it). Scroll only moves between the two; inside the Console the wallet's own top tabs
// (and keys 1–4, the on-page tab bar, deep links) choose the section, and each section has its own
// short device move. Layers: `rig` = scroll pose, `pose` = section move, then tilt/actor (stage.ts).
import * as THREE from 'three';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type { Stage } from './stage';
import { CARD } from '../device/keyCard';
import { motion } from '../motion';
import { sfx } from '../audio/sfx';

gsap.registerPlugin(ScrollTrigger);

export const TABS = ['works', 'chronicle', 'about', 'contact'] as const;
export type TabId = (typeof TABS)[number];
export type Place = 'hero' | 'console';

type Pose = { x: number; y: number; z: number; rx: number; ry: number; rz: number };
const TAB_MESH: Record<TabId, string> = { works: 'tab-01', chronicle: 'tab-02', about: 'tab-03', contact: 'tab-04' };
// Tab click pitch rises 01 → 04 (D, E, F♯, A), so the sound tells you where you are.
const TAB_RATE: Record<TabId, number> = { works: 1, chronicle: 2 ** (2 / 12), about: 2 ** (4 / 12), contact: 2 ** (7 / 12) };
// Section moves (yaw, on top of the Console pose). Works faces you; Chronicle turns a little;
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
  /** Turn the wallet over by hand (drag its body sideways): see the back and its stickers. */
  flip: {
    /** Start a drag: stops any settle in progress. */
    begin(): void;
    /** Drag: turn by `delta` radians from where the drag began. */
    to(delta: number): void;
    /** Let go: settle face-up or face-down, whichever is nearer. */
    release(): void;
    /** Back to face-up (section change, scroll, Contact). `instant` skips the turn. */
    reset(instant?: boolean): void;
    /** True while the back faces the visitor. */
    isBack(): boolean;
  };
  /** Contact layout (world space): where the card flies in from and where the written card settles. */
  cardEntry: THREE.Vector3;
  cardFinal: THREE.Vector3;
}

export function createChoreography(stage: Stage, hero: HTMLElement, consoleEl: HTMLElement): Choreography {
  const { rig, pose, wallet, screen } = stage;
  const cardEntry = new THREE.Vector3();
  const cardFinal = new THREE.Vector3();
  // Hero: three-quarter from above, showing the top tabs and the roller edge (the controls).
  // Console: facing you, tipped back a little so the numbered tabs read from the front.
  const HERO: Pose = { x: 0, y: -0.04, z: 0, rx: 0.3, ry: 0.52, rz: -0.12 };
  const CONSOLE: Pose = { x: 0, y: -0.06, z: 0, rx: 0.14, ry: 0, rz: 0 }; // lower: the tipped-back top rises

  function computeCard() {
    const portrait = stage.portrait();
    const cam = stage.camera;
    const t = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    // Phones: in front of the wallet, ~86 % of the width (details near their design size).
    // Landscape: right of the wallet, ~32 % of the width, smaller if it would cross the gutter.
    let d: number;
    let ndc: { x: number; y: number };
    if (portrait) {
      d = CARD.w / (2 * 0.86 * t * cam.aspect);
      ndc = { x: 0, y: 0.08 };
    } else {
      const walletEdge = 0.56 / (t * cam.aspect * cam.position.z); // half-width incl. a turn, NDC
      const room = 0.93 - walletEdge - 0.05;
      d = Math.max(CARD.w / (0.64 * t * cam.aspect), CARD.w / (room * t * cam.aspect));
      const half = CARD.w / (2 * t * cam.aspect * d);
      ndc = { x: walletEdge + 0.05 + half, y: 0.1 };
    }
    cardFinal.set(ndc.x * t * cam.aspect * d, cam.position.y + ndc.y * t * d, cam.position.z - d);
    cardEntry.set(stage.halfWidthAt(0.4) + 0.9, cam.position.y + 0.1, 0.4);
  }

  // ---------------------------------------------------------------- scroll: Hero ↔ Console
  let progress = 0; // 0 = Hero pose, 1 = Console pose
  const apply = () => {
    const k = progress;
    rig.position.set(HERO.x + (CONSOLE.x - HERO.x) * k, HERO.y + (CONSOLE.y - HERO.y) * k, 0);
    rig.rotation.set(HERO.rx + (CONSOLE.rx - HERO.rx) * k, HERO.ry + (CONSOLE.ry - HERO.ry) * k, HERO.rz + (CONSOLE.rz - HERO.rz) * k);
  };
  let trigger: ScrollTrigger | null = null;
  function build() {
    trigger?.kill();
    computeCard();
    // Lenis already smooths the scroll; a long scrub on top of it double-smooths and feels floaty.
    trigger = ScrollTrigger.create({
      trigger: consoleEl,
      start: 'top bottom',
      end: 'top top',
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
  const move = { yaw: 0, spin: 0, flip: 0 };
  let spinTween: gsap.core.Tween | null = null;
  // The About spin is a first-visit delight: once per page view. Repeating it (tab, key 3) would hide
  // the About screen behind 0.8 s of spin every time the visitor asks for it.
  let aboutSpun = false;
  stage.onFrame(() => pose.rotation.set(0, move.yaw * progress + move.spin + move.flip, 0));

  // Hand turn: 1:1 with the drag while held; on release it settles to the nearer face (a quick
  // ease-out, like setting a phone down). Anything that changes the view turns it face-up again.
  let flipTween: gsap.core.Tween | null = null;
  let flipStart = 0;
  const settleFlip = (to: number, instant = false) => {
    flipTween?.kill();
    flipTween = gsap.to(move, {
      flip: to,
      duration: instant || motion.reduced() ? 0 : 0.5,
      ease: 'power3.out',
      // Keep the angle small so the next turn starts from a clean 0 or π.
      onComplete: () => void (move.flip = ((move.flip % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)),
    });
  };
  const flip = {
    begin() {
      flipTween?.kill();
      flipStart = move.flip;
    },
    to(delta: number) {
      move.flip = flipStart + delta;
    },
    release() {
      settleFlip(Math.round(move.flip / Math.PI) * Math.PI);
    },
    reset(instant = false) {
      if (move.flip === 0 && !flipTween?.isActive()) return;
      settleFlip(Math.round(move.flip / (Math.PI * 2)) * Math.PI * 2, instant);
    },
    isBack: () => Math.abs(((move.flip % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI) < Math.PI / 2,
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
    flip.reset();
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
    flip.reset();
    if (place === 'console') {
      pressTab(tab);
      screen.setMode(tab);
      moveTo(tab);
      sfx.play('tab', { rate: TAB_RATE[tab] });
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
    flip,
    cardEntry,
    cardFinal,
  };
}
