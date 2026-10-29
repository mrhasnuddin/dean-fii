// The Idea figure, live (docs/device-design.md §56): a laptop on a desk, dark, its standby lamp breathing. After a moment the screen
// flickers on, a soft glow spreads round it, the desk glows, and a light bulb lights on the screen itself (it pops in, a ring ripples
// across the glass, its rays flicker and then hold); then the bulb goes, the screen dims and the loop starts again. Only opacities and
// a few transforms move. The figure stops when it is off screen; with Motion off it is one still frame: awake, with the bulb lit.
import '../../vendor/anatomy/iso.css';
import './story.css';
import { figureSvg } from '../../vendor/anatomy/iso-kit.mjs';
import { driveLoop } from '../kit/loop';
import { attr, sty } from '../run/dom';
import { H, W, staticBody } from './laptop.mjs';
import type { StoryHandle, StoryOptions } from './problem';

/** Beats of one loop, in seconds. */
const BEAT = { wake: 1.1, pop: 1.55, retract: 5.0, dim: 5.5, loop: 7.2 };
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (t: number) => t * t * (3 - 2 * t);
const easeOutBack = (t: number) => {
  const x = t - 1;
  return 1 + 2.9 * x * x * x + 1.9 * x * x;
};
let instances = 0;

export function mountIdea(host: HTMLElement, opts: StoryOptions = {}): StoryHandle {
  const uid = String(++instances);
  const label = opts.label ?? 'A laptop on a desk. Its screen suddenly lights up, a soft glow spreads round it and a light bulb lights on the screen: an idea.';
  const body = staticBody().map((s) => s.replace(/\{\{u\}\}/g, uid));
  host.innerHTML = `<div class="iso dia" data-theme="dark"><div class="dia-stage">${figureSvg({ width: W, height: H, label, body })}</div></div>`;
  const stage = host.querySelector<HTMLElement>('.dia-stage')!;
  const svg = stage.querySelector('svg')!;
  const el = <T extends SVGElement = SVGElement>(sel: string) => svg.querySelector<T>(sel)!;
  const screen = el('[data-part="screen"]'), halo = el('[data-part="halo"]'), pool = el('[data-part="pool"]');
  const lamp = el('[data-lamp="stby"]'), glow = el('[data-glow="stby"]');
  const idea = el('[data-part="idea"]'), ripple = el('[data-part="ripple"]'), rays = el('[data-part="rays"]');

  function draw(t: number, clock: number, calm: boolean) {
    const u = t - BEAT.wake;
    const dim = smooth(clamp((t - BEAT.dim) / 0.9));
    // the screen flickers on (a quick rise, then a few dips that die out), and dims at the end
    let on = u >= 0 ? clamp(u / 0.1) - (u < 0.55 ? 0.4 * Math.max(0, Math.sin(u * 58)) * (1 - u / 0.55) : 0) : 0;
    on = clamp(on) * (1 - dim);
    sty(screen, 'opacity', on);
    // the light: the glow round the screen and on the desk rise a little after it, and breathe once they are up
    const rise = smooth(clamp((u - 0.05) / 0.7)) * (1 - dim);
    const breathe = calm ? 0.9 : 0.86 + 0.14 * Math.sin((clock * Math.PI * 2) / 2.4);
    sty(halo, 'opacity', rise * breathe);
    sty(pool, 'opacity', rise * breathe);
    // the standby lamp breathes while the laptop sleeps and holds steady while it is awake
    const sleep = calm ? 0.7 : 0.3 + 0.7 * (0.5 + 0.5 * Math.sin((clock * Math.PI * 2) / 2));
    const lampV = sleep + (1 - sleep) * Math.max(0, on);
    sty(lamp, 'fillOpacity', 0.2 + 0.8 * lampV);
    sty(glow, 'fillOpacity', 0.22 * lampV);

    // the bulb on the screen: pops in with an overshoot and a wobble, a ring ripples across the glass, the rays flicker and hold
    const since = t - BEAT.pop;
    let s = t >= BEAT.pop ? easeOutBack(clamp(since / 0.5)) : 0;
    if (t >= BEAT.retract) s *= 1 - clamp((t - BEAT.retract) / 0.3) ** 2;
    const wob = since > 0 && since < 1 ? Math.sin(since * 20) * 4 * Math.exp(-since * 4.5) : 0;
    sty(idea, 'opacity', s > 0.005 ? 1 : 0);
    attr(idea, 'transform', `rotate(${wob.toFixed(1)}) scale(${Math.max(s, 0).toFixed(3)})`);
    const pp = clamp(since / 0.9);
    sty(ripple, 'opacity', since > 0 && since < 0.9 ? 0.5 * (1 - pp) : 0);
    attr(ripple, 'transform', `scale(${(1 + pp * 1.3).toFixed(3)})`);
    sty(rays, 'opacity', since > 0 && since < 1.6 && !calm ? 0.7 + 0.3 * Math.sin(since * 38) : 1);
  }

  const loop = driveLoop({ stage, length: BEAT.loop, poster: BEAT.pop + 1.7, draw });
  return {
    seek: (_n, time) => loop.seek(time),
    destroy() {
      loop.destroy();
      host.innerHTML = '';
    },
  };
}
