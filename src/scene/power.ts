// Power (docs/device-design.md §34, §36): the USB-C cable can be unplugged and plugged back by clicking the area
// around the cable, and the battery window on the left face (five LEDs) and the battery icon on the e-ink
// screen show which it is.
//   plugged     charging, as a loop: one green bar, then two, up to five, a beat at full, and again from one
//   unplugged   on battery at a random level, new every time it is unplugged: amber for the bars it has (two
//               blinks as the plug leaves), red and blinking when it is nearly flat
// The plug slides out of the port (0.16 W), hangs a beat, then falls out of the frame with its cable; plugging
// it back brings it up from below and pushes it home, and the loop starts over at one bar when it seats.
// Reduced motion: no loop (five steady bars while charging) and the plug simply is where it should be.
import * as THREE from 'three';
import gsap from 'gsap';
import type { Stage } from './stage';
import { BATTERY } from '../device/sideParts';
import { motion } from '../motion';
import { sfx } from '../audio/sfx';

export interface Power {
  plugged(): boolean;
  toggle(): void;
  plug(): void;
  unplug(): void;
  /** What the battery shows, 0 to 1 (while charging: the bar the loop is on). */
  level(): number;
  onChange(cb: (plugged: boolean) => void): void;
  update(dt: number): void;
}

const OUT = 0.16; // W: how far the plug comes out of the port before it lets go
const FALL = 3.4; // W: far enough to be out of every frame
const STEP = 0.45; // s each bar takes to come on while charging
const HOLD = 0.9; // s at full before the loop starts over
const CYCLE = BATTERY.segs * STEP + HOLD;
const LOW = 0.22; // below this the bar is red and blinks
const GREEN = new THREE.Color('#5fd68a');
const AMBER = new THREE.Color('#f0b35a');
const RED = new THREE.Color('#ff5c4d');
const OFF = new THREE.Color('#22242a');
const randomLevel = () => 0.1 + Math.random() * 0.9; // 10 % to 100 %

export function createPower(stage: Stage): Power {
  const { wallet, screen, cable } = stage;
  const rig = wallet.usbRig;
  const restY = rig.position.y;
  const p = { out: 0, fall: 0 };
  let plugged = true; // what the visitor asked for
  let seated = true; // the plug is home: charging
  let level = randomLevel(); // the level on battery
  let shown = 1;
  let clock = 0;
  let eventAt = -9; // when the plug last left
  let chargeFrom = 0; // when the loop last started
  const lit = wallet.battery.segments.map(() => 0); // each bar's brightness while charging: it comes on fast and goes off slower
  const cbs: ((v: boolean) => void)[] = [];

  const place = () => rig.position.setY(restY - p.out - p.fall);
  const settle = () => {
    seated = true;
    chargeFrom = clock;
    sfx.play('toggle', { rate: 1.1 });
    sfx.play('success', { volume: 0.35 });
  };

  function unplug() {
    if (!plugged) return;
    plugged = false;
    seated = false;
    eventAt = clock;
    level = randomLevel();
    cbs.forEach((cb) => cb(false));
    gsap.killTweensOf(p);
    sfx.play('toggle', { rate: 0.85 });
    if (motion.reduced()) {
      Object.assign(p, { out: OUT, fall: FALL });
      place();
      cable.setPaused(true);
      return;
    }
    gsap.timeline({ onComplete: () => cable.setPaused(true) })
      .to(p, { out: OUT, duration: 0.2, ease: 'power2.out', onUpdate: place })
      .call(() => void sfx.play('air', { volume: 0.6 }), [], 0.3)
      .to(p, { fall: FALL, duration: 0.85, ease: 'power2.in', onUpdate: place }, 0.34);
  }

  function plug() {
    if (plugged) return;
    plugged = true;
    cbs.forEach((cb) => cb(true));
    gsap.killTweensOf(p);
    cable.setPaused(false);
    if (motion.reduced()) {
      Object.assign(p, { out: 0, fall: 0 });
      place();
      return settle();
    }
    sfx.play('air', { volume: 0.6 });
    gsap.timeline()
      .to(p, { fall: 0, out: OUT, duration: 0.8, ease: 'power3.out', onUpdate: place })
      .to(p, { out: 0, duration: 0.22, ease: 'back.out(2.2)', onUpdate: place })
      .call(settle, [], '>-0.06');
  }

  /** Battery LEDs and the screen's icon, once a frame. */
  function update(dt: number) {
    clock += dt;
    const age = clock - eventAt;
    // Charging: the loop's bar count (five steady ones under reduced motion). On battery: the random level.
    const bars = seated ? (motion.reduced() ? BATTERY.segs : Math.min(BATTERY.segs, Math.floor(((clock - chargeFrom) % CYCLE) / STEP) + 1)) : 0;
    shown = seated ? bars / BATTERY.segs : level;
    screen.setBattery(shown, seated);
    const solid = Math.ceil(level * BATTERY.segs);
    const low = level < LOW;
    wallet.battery.segments.forEach((mat, i) => {
      let colour: THREE.Color = OFF;
      let intensity = 0;
      if (seated) {
        colour = GREEN;
        const target = i < bars ? 1.5 : 0;
        lit[i] += (target - lit[i]) * (1 - Math.exp(-dt * (target > lit[i] ? 30 : 14)));
        intensity = lit[i];
      } else {
        lit[i] = 0;
        if (plugged) {
          // coming back up from below: not yet charging, the LEDs wait, dark
        } else if (i < solid) {
          colour = low ? RED : AMBER;
          intensity = low ? 1.2 * (Math.sin(clock * 3.2) > 0 ? 1 : 0.15) : 1.3;
          if (age < 0.6) intensity *= Math.sin(age * 30) > 0 ? 1.6 : 0.1; // two blinks as the plug leaves
        }
      }
      mat.color.copy(intensity > 0.01 ? colour : OFF).multiplyScalar(intensity > 0.01 ? 0.3 : 1);
      mat.emissive.copy(colour);
      mat.emissiveIntensity = intensity;
    });
    wallet.battery.bolt.color.copy(seated ? GREEN : new THREE.Color('#5a5b63'));
    wallet.battery.bolt.emissive.copy(GREEN);
    wallet.battery.bolt.emissiveIntensity = seated ? 0.9 + 0.6 * Math.sin(clock * 5) : 0;
  }

  return {
    plugged: () => plugged,
    toggle: () => (plugged ? unplug() : plug()),
    plug,
    unplug,
    level: () => shown,
    onChange: (cb) => cbs.push(cb),
    update,
  };
}
