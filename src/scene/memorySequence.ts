// The memory card (docs/device-design.md §34), now the archive cartridge (docs/works-cartridge-blueprint.md). It comes
// up from below the device, lines up with the slot in the bottom edge, and is pushed home (the recoil is the latch);
// then the archive page opens. It stays in while the archive is showing; leaving the page pushes it back out on the
// slot's spring and it drops away. The card is a child of the slot, so it turns with the wallet.
import gsap from 'gsap';
import { MEMORY } from '../device/memoryCard';
import type { Stage } from './stage';
import { motion } from '../motion';
import { sfx } from '../audio/sfx';

export type MemoryState = 'out' | 'moving' | 'in';

export interface MemorySequence {
  state(): MemoryState;
  /** Brings the card in. `onSeat` runs the moment it is home (at once if it already is). `instant`: it is simply in (a deep link). */
  insert(onSeat?: () => void, instant?: boolean): void;
  eject(): void;
}

// Card centre along the slot's axis (+Y = into the body): lined up with the mouth (leading end at the face),
// home (0.16 W inside), and far below.
const MOUTH = -MEMORY.h / 2 - 0.012;
const HOME = MEMORY.inside - MEMORY.h / 2;
const FAR = -MEMORY.h / 2 - 1.15;

export function createMemorySequence(stage: Stage): MemorySequence {
  const { memoryCard: card, wallet } = stage;
  let state: MemoryState = 'out';
  let tl: gsap.core.Timeline | null = null;
  let seatCbs: (() => void)[] = [];
  const seated = () => {
    state = 'in';
    const cbs = seatCbs;
    seatCbs = [];
    cbs.forEach((cb) => cb());
  };

  function insert(onSeat?: () => void, instant = false) {
    if (state === 'in') return onSeat?.();
    if (onSeat) seatCbs.push(onSeat);
    if (state === 'moving' && tl && card.userData.dir === 'in') return; // already on its way
    tl?.kill();
    card.userData.dir = 'in';
    state = 'moving';
    if (motion.reduced() || instant) {
      card.visible = true;
      card.position.set(0, HOME, 0);
      return seated();
    }
    if (!card.visible) card.position.set(0, FAR, 0);
    card.visible = true;
    sfx.play('air', { volume: 0.7 });
    const run = Math.abs(card.position.y - MOUTH) / Math.abs(FAR - MOUTH);
    tl = gsap.timeline();
    tl.to(card.position, { y: MOUTH, duration: 0.15 + 0.5 * run, ease: 'power3.out' });
    tl.to(card.position, { y: HOME, duration: 0.28, ease: 'power3.out' }); // pushed home: fast in, slowed by the slot's friction
    tl.call(() => {
      sfx.play('toggle'); // seats
      sfx.play('process', { volume: 0.5 });
    }, []);
    // The latch: the device takes a small knock up, and settles.
    tl.to(wallet.root.position, { y: 0.012, duration: 0.05, ease: 'power1.out' }, '<');
    tl.to(wallet.root.position, { y: 0, duration: 0.32, ease: 'back.out(3)' });
    tl.call(() => {
      tl = null;
      seated();
    }, [], '<0.06');
  }

  function eject() {
    if (state === 'out' || (state === 'moving' && card.userData.dir === 'out')) return;
    seatCbs = []; // the page it was going to open is not wanted any more
    tl?.kill();
    card.userData.dir = 'out';
    state = 'moving';
    const away = () => {
      card.visible = false;
      tl = null;
      state = 'out';
    };
    if (motion.reduced() || !card.visible) return away();
    sfx.play('toggle', { rate: 1.25 });
    tl = gsap.timeline({ onComplete: away });
    tl.to(card.position, { y: MOUTH + 0.03, duration: 0.3, ease: 'back.out(1.7)' }); // the slot's spring pushes it out
    tl.call(() => void sfx.play('air', { volume: 0.6 }), [], '>0.05');
    tl.to(card.position, { y: FAR, duration: 0.55, ease: 'power2.in' }, '>0.05');
  }

  return { state: () => state, insert, eject };
}
