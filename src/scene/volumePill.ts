// The volume pill (docs/device-design.md §40). On a touch screen up to 900 px wide the wallet's left face is edge-on,
// and the volume knob is a 32 × 48 px sliver at the screen's edge, inside Safari's swipe-back zone. A tap on the knob
// (or on its callout) opens this slider beside it instead, and it goes after a few idle seconds. With a mouse the knob
// stays the control.
import * as THREE from 'three';
import type { Stage } from './stage';
import { volume } from '../audio/volume';

const IDLE_MS = 3200;
const REACH = 22; // px from the knob to the pill's edge
const MOVED = 8; // px of page scroll that puts it away (a scroll event with no movement, as iOS fires when its toolbar slides, does not)
const touchSmall = matchMedia('(pointer: coarse) and (max-width: 900px)');
export const usePill = () => touchSmall.matches;

export interface VolumePill {
  open(): void;
  close(): void;
}

export function createVolumePill(stage: Stage, host: HTMLElement, c: { setVolume(v: number): void; toggleMute(): void }): VolumePill {
  const range = host.querySelector<HTMLInputElement>('.vol-range')!;
  const mute = host.querySelector<HTMLButtonElement>('.vol-mute')!;
  const val = host.querySelector<HTMLOutputElement>('.vol-val')!;
  const knob = stage.wallet.runtime.nodes['volume-knob'];
  const p = new THREE.Vector3();
  let timer = 0;
  let y0 = 0;

  const show = (level: number) => {
    const pct = Math.round(level * 100);
    range.value = String(pct);
    val.value = String(pct);
    host.classList.toggle('muted', level === 0);
    mute.setAttribute('aria-pressed', String(level === 0));
  };
  show(volume.level());
  volume.subscribe(show);

  const keep = () => {
    clearTimeout(timer);
    timer = window.setTimeout(close, IDLE_MS);
  };
  function open() {
    // Level with the knob and just in from it, clear of the header and the copy at the foot.
    knob.getWorldPosition(p).project(stage.camera);
    const x = ((p.x + 1) / 2) * innerWidth;
    const y = ((1 - p.y) / 2) * innerHeight;
    host.style.setProperty('--x', `${THREE.MathUtils.clamp(x + REACH, 10, innerWidth - host.offsetWidth - 10).toFixed(1)}px`);
    host.style.setProperty('--y', `${THREE.MathUtils.clamp(y - host.offsetHeight / 2, 76, innerHeight - 220).toFixed(1)}px`);
    y0 = scrollY;
    host.classList.add('open');
    keep();
  }
  function close() {
    clearTimeout(timer);
    host.classList.remove('open');
  }

  range.addEventListener('input', () => {
    c.setVolume(Number(range.value) / 100);
    keep();
  });
  mute.addEventListener('click', () => {
    c.toggleMute();
    keep();
  });
  host.addEventListener('pointerdown', keep);
  // Anything else touched, scrolled or pressed puts it away (a tap on the knob again simply reopens it).
  document.addEventListener('pointerdown', (e) => host.classList.contains('open') && !host.contains(e.target as Node) && close(), true);
  addEventListener('scroll', () => Math.abs(scrollY - y0) > MOVED && close(), { passive: true });
  addEventListener('keydown', (e) => e.key === 'Escape' && close());
  return { open, close };
}
