// Scroll choreography: each section has a wallet pose; scrolling between sections interpolates the
// rig (GSAP ScrollTrigger, scrubbed). Entering a section presses its tab, swaps the screen mode.
// Chronicle → About spins the wallet once, showing the D-star on the back as About arrives.
import * as THREE from 'three';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type { Stage } from './stage';
import type { ScreenMode } from '../ui/screen';
import { CARD } from '../device/keyCard';
import { motion } from '../motion';
import { sfx } from '../audio/sfx';

gsap.registerPlugin(ScrollTrigger);

export const SECTIONS = ['hello', 'works', 'chronicle', 'about', 'contact'] as const;
export type SectionId = (typeof SECTIONS)[number];

type Pose = { x: number; y: number; z: number; rx: number; ry: number; rz: number };
const CARD_W = CARD.size;
const TAB_FOR: Partial<Record<SectionId, string>> = { works: 'tab-01', chronicle: 'tab-02', about: 'tab-03', contact: 'tab-04' };
// Tab click pitch rises 01 → 04 (D, E, F♯, A), so the sound tells you where you are.
const TAB_RATE: Partial<Record<SectionId, number>> = { works: 1, chronicle: 2 ** (2 / 12), about: 2 ** (4 / 12), contact: 2 ** (7 / 12) };

export interface Choreography {
  active(): SectionId;
  onActive(cb: (id: SectionId) => void): void;
  /** Contact layout: where the card flies in from and settles (world space). */
  cardEntry: THREE.Vector3;
  cardFinal: THREE.Vector3;
}

export function createChoreography(stage: Stage, sections: HTMLElement[]): Choreography {
  const { rig, wallet, screen } = stage;
  let poses: Record<SectionId, Pose>;
  const cardEntry = new THREE.Vector3();
  const cardFinal = new THREE.Vector3();

  // The wallet is the hero: centred and framed by the camera (stage.ts), so poses are mostly
  // rotations. Hero: a three-quarter view from above that shows the top tabs and the roller edge
  // (the controls). Lists face front so the screen reads. Contact steps left to give the card room.
  function computePoses() {
    const portrait = stage.portrait();
    poses = {
      // The tilt brings the top edge forward (and up on screen): sit a little lower to keep a margin.
      hello: { x: 0, y: -0.04, z: 0, rx: 0.3, ry: 0.52, rz: -0.12 },
      works: { x: 0, y: 0, z: 0, rx: 0.06, ry: 0.12, rz: 0 },
      chronicle: { x: 0, y: 0, z: 0, rx: 0.06, ry: -0.14, rz: 0 },
      // −2π: one full turn from Chronicle, so the back (D-star) faces the visitor mid-way.
      // Reduced motion drops the spin: a scroll-linked 360° turn is a vestibular trigger.
      about: { x: 0, y: 0, z: 0, rx: 0.1, ry: 0.3 - (motion.reduced() ? 0 : Math.PI * 2), rz: -0.04 },
      // Centred like every section (the title keeps the bottom-left clear); turned toward the card.
      contact: { x: 0, y: 0, z: 0, rx: 0.04, ry: 0.26, rz: 0 },
    };
    const cam = stage.camera;
    const t = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    // Where the written card settles, as a screen position + size, then back to world space.
    // Phones: in front of the wallet, ~83 % of the width (details near their design size).
    // Landscape: in the space right of the wallet: 40 % of the height, or smaller if that would
    // cross the right gutter (narrow landscape windows).
    let d: number;
    let ndc: { x: number; y: number };
    if (portrait) {
      d = CARD_W / (2 * 0.83 * t * cam.aspect);
      ndc = { x: 0, y: 0.1 };
    } else {
      const walletEdge = 0.56 / (t * cam.aspect * cam.position.z); // half-width incl. the ry turn, NDC
      const room = 0.93 - walletEdge - 0.05; // NDC width between wallet (+gap) and the gutter
      d = Math.max(CARD_W / (2 * 0.4 * t), CARD_W / (room * t * cam.aspect));
      const half = CARD_W / (2 * t * cam.aspect * d);
      ndc = { x: walletEdge + 0.05 + half, y: 0.12 };
    }
    cardFinal.set(ndc.x * t * cam.aspect * d, cam.position.y + ndc.y * t * d, cam.position.z - d);
    cardEntry.set(stage.halfWidthAt(0.8) + 1.0, -0.7, 0.8);
  }

  const apply = (pp: Pose) => {
    rig.position.set(pp.x, pp.y, pp.z);
    rig.rotation.set(pp.rx, pp.ry, pp.rz);
  };

  let tweens: gsap.core.Tween[] = [];
  function build() {
    tweens.forEach((t) => t.scrollTrigger?.kill());
    tweens.forEach((t) => t.kill());
    tweens = [];
    computePoses();
    apply(poses.hello);
    // Lenis already smooths the scroll; a long scrub on top of it double-smooths and feels floaty.
    const scrub = motion.reduced() ? true : 0.35;
    for (let i = 1; i < SECTIONS.length; i++) {
      const from = poses[SECTIONS[i - 1]];
      const to = poses[SECTIONS[i]];
      const proxy = { ...from };
      tweens.push(
        gsap.to(proxy, {
          ...to,
          ease: 'none', // the scrub smoothing is the easing; a curve here would double it
          immediateRender: false,
          onUpdate: () => apply(proxy),
          scrollTrigger: { trigger: sections[i], start: 'top bottom', end: 'top 20%', scrub },
        }),
      );
    }
    ScrollTrigger.refresh();
  }

  // Active section: press its tab, swap the screen mode.
  let active: SectionId = 'hello';
  const listeners: ((id: SectionId) => void)[] = [];
  const tabRestY = wallet.runtime.nodes['tab-02']?.position.y ?? 0;
  const mats = wallet.root.userData.materials as { champagne: THREE.Material; polymer: THREE.Material };
  function pressTab(id: SectionId) {
    for (const t of ['tab-01', 'tab-02', 'tab-03', 'tab-04']) {
      const node = wallet.runtime.nodes[t];
      const mesh = wallet.runtime.meshes[t];
      if (!node || !mesh) continue;
      const on = TAB_FOR[id] === t;
      mesh.material = on ? mats.champagne : mats.polymer;
      gsap.to(node.position, { y: on ? tabRestY - 0.012 : tabRestY, duration: motion.reduced() ? 0 : 0.18, ease: 'power2.out' });
    }
  }
  function setActive(id: SectionId) {
    if (id === active) return;
    active = id;
    screen.setMode(id as ScreenMode);
    pressTab(id);
    if (TAB_RATE[id]) sfx.play('tab', { rate: TAB_RATE[id] });
    listeners.forEach((l) => l(id));
  }
  sections.forEach((el, i) =>
    ScrollTrigger.create({
      trigger: el,
      start: 'top 55%',
      end: 'bottom 55%',
      onToggle: (self) => self.isActive && setActive(SECTIONS[i]),
    }),
  );

  // Outgoing copy fades as its section leaves, so two headings never stack under the header.
  // Triggered by the SECTION: the copy is position: sticky, whose measured position shifts with scroll.
  sections.forEach((el, i) => {
    const copy = el.querySelector<HTMLElement>('.section-copy');
    if (!copy || i === sections.length - 1) return;
    gsap.fromTo(copy, { opacity: 1 }, {
      opacity: 0, ease: 'none', immediateRender: false,
      scrollTrigger: { trigger: el, start: 'bottom 60%', end: 'bottom 30%', scrub: true },
    });
  });

  pressTab('hello');
  build();
  stage.onResize(build);
  motion.subscribe(build);

  return {
    active: () => active,
    onActive: (cb) => listeners.push(cb),
    cardEntry,
    cardFinal,
  };
}
