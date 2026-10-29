// The Problem figure, live (docs/device-design.md §56): a Rubik's cube floating over a pad. A loop of about nine seconds: the cube
// sits, tumbles with its layers twisting at random (seeded, so every loop is different and a check can reproduce it), comes to rest
// scrambled, and a question mark is painted across each of the faces you see, like the question blocks of a platform game; then
// the marks fade and the next loop scrambles it further. The 27 cubies are redrawn only while the cube is turning (the rest of the
// time it floats by one transform), the figure stops when it is off screen, and with Motion off (or the system setting) it is one
// still frame: scrambled, with the marks showing.
import '../../vendor/anatomy/iso.css';
import './story.css';
import { figureSvg } from '../../vendor/anatomy/iso-kit.mjs';
import { driveLoop } from '../kit/loop';
import { attr, sty } from '../run/dom';
import { BEAT, FACES, FACE_D, H, KZ, PAD_AT, SHADOW_D, STICKER_D, W, applyMove, cubeShapes, planOf, poster, spinOf, staticBody, twistOf, type Cubie, type Plan } from './cube.mjs';
import { QUESTION_DOT, QUESTION_STROKE } from './glyph.mjs';

export interface StoryHandle {
  /** Holds loop `n` still at `t` seconds in (for the lab and the checks). */
  seek(n: number, t: number): void;
  destroy(): void;
}
export interface StoryOptions {
  /** The figure's own description for screen readers. */
  label?: string;
}

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
/** Overshoots, then settles: the pop. */
const easeOutBack = (t: number) => {
  const x = t - 1;
  return 1 + 2.9 * x * x * x + 1.9 * x * x;
};
const SHADES = [0, 1, 2, 3];
let instances = 0;

export function mountProblem(host: HTMLElement, opts: StoryOptions = {}): StoryHandle {
  const uid = String(++instances);
  const label = opts.label ?? 'A Rubik’s cube floating over a pad. It spins and its layers twist at random, it comes to rest scrambled, and a question mark appears painted across its faces.';

  let cubies: Cubie[] = poster();
  const drawn = cubies.filter((c) => c.st.length); // the centre cubie is never seen
  const cubieMarkup = drawn
    .map(
      (c) =>
        `<g class="cubie" data-c="${c.id}"><path class="iso-fill"/>${SHADES.map((i) => `<path class="iso-shade" data-shade="${i}"/>`).join('')}<path class="iso-top"/><path class="iso-line iso-crease" data-tone="faint"/><path class="iso-line iso-edge" data-tone="lo"/>${c.st
          .map((s) => `<g class="stk-g stk-hide"><path class="stk stk${s.c}" d="${STICKER_D}"/><path class="stk-sh" d="${STICKER_D}"/></g>`)
          .join('')}</g>`,
    )
    .join('');
  // the question mark, painted on each face you see at rest: a dark veil over the stickers, then the mark with a soft glow under it
  const marks = FACES.map(
    (f, i) =>
      `<g data-part="face${i}" transform="${f.matrix}" style="opacity:0"><path class="q-veil" d="${FACE_D}"/><g clip-path="url(#q-clip-${uid})" style="opacity:${(0.6 + 0.4 * f.light).toFixed(2)}"><g data-part="mark${i}"><g transform="translate(0 -4) scale(0.8)"><path class="q-glow" d="${QUESTION_STROKE}"/><circle class="q-glow" cx="${QUESTION_DOT.x}" cy="${QUESTION_DOT.y}" r="${QUESTION_DOT.r}"/><path class="q-s" d="${QUESTION_STROKE}"/><circle class="q-f" cx="${QUESTION_DOT.x}" cy="${QUESTION_DOT.y}" r="${QUESTION_DOT.r}"/></g></g></g></g>`,
  ).join('');
  const body = [
    `<defs><clipPath id="q-clip-${uid}"><path d="${FACE_D}"/></clipPath></defs>`,
    ...staticBody().map((s) => s.replace(/\{\{u\}\}/g, uid)),
    `<g data-part="shadow"><path class="iso-halo" d="${SHADOW_D}"/></g>`,
    `<g data-part="cube"><g data-part="cubes">${cubieMarkup}</g><g data-part="marks">${marks}</g></g>`,
  ];
  host.innerHTML = `<div class="iso dia" data-theme="dark"><div class="dia-stage">${figureSvg({ width: W, height: H, label, body })}</div></div>`;
  const stage = host.querySelector<HTMLElement>('.dia-stage')!;
  const svg = stage.querySelector('svg')!;
  const el = <T extends SVGElement = SVGElement>(sel: string) => svg.querySelector<T>(sel)!;

  const cubeG = el('[data-part="cube"]'), layer = el('[data-part="cubes"]'), shadow = el('[data-part="shadow"]');
  const pad = el('[data-part="pad"]'), beam = el('[data-part="beam"]');
  const emit = [0, 1, 2, 3].map((i) => el(`[data-part="emit${i}"]`));
  const faces = FACES.map((_, i) => ({ g: el(`[data-part="face${i}"]`), mark: el(`[data-part="mark${i}"]`) }));
  const parts = new Map(
    drawn.map((c) => {
      const g = el(`[data-c="${c.id}"]`);
      const q = (sel: string) => g.querySelector<SVGElement>(sel)!;
      return [c.id, { g, fill: q('.iso-fill'), shades: SHADES.map((i) => q(`.iso-shade[data-shade="${i}"]`)), top: q('.iso-top'), crease: q('.iso-crease'), edge: q('.iso-edge'), stk: [...g.querySelectorAll<SVGGElement>('.stk-g')].map((s) => ({ g: s, sh: s.querySelector<SVGElement>('.stk-sh')! })) }] as const;
    }),
  );

  // ------------------------------------------------------------ state
  let n = 0;
  let plan: Plan = planOf(0);
  let applied = 0; // moves of this loop that have finished and been written into the cubies
  let dirty = true; // the cubies must be redrawn (first frame, a finished twist, a new loop, a seek)
  let seeking = false; // a seek (the lab) plays the loop's moves into the cubies even though nothing runs
  let order = '';

  function paintCubes(t: number, play: boolean) {
    // the poster is a still frame: only a loop that is playing, or a seek, writes its twists into the cubies
    while (play && applied < plan.moves.length && t >= plan.moves[applied].t0 + plan.moves[applied].dur) applyMove(cubies, plan.moves[applied++]);
    const tw = twistOf(plan, t);
    const shapes = cubeShapes(cubies, spinOf(plan, t), tw ? tw.move : null, tw ? tw.u * (Math.PI / 2) * tw.move.dir : 0).filter((s) => parts.has(s.id));
    for (const s of shapes) {
      const p = parts.get(s.id)!;
      attr(p.fill, 'd', s.paths.fill);
      p.shades.forEach((e, i) => attr(e, 'd', s.paths.shades[i] || ''));
      attr(p.top, 'd', s.paths.top || '');
      attr(p.crease, 'd', s.paths.crease || '');
      attr(p.edge, 'd', s.paths.outline);
      s.stickers.forEach((st, j) => {
        const k = p.stk[j];
        if (!st) return void attr(k.g, 'class', 'stk-g stk-hide');
        attr(k.g, 'class', 'stk-g');
        attr(k.g, 'transform', st.matrix);
        sty(k.sh, 'fillOpacity', st.shade);
      });
    }
    // back to front: the nearer cubie is painted later (the DOM is reordered only when the order changes)
    shapes.sort((a, b) => a.key - b.key);
    const key = shapes.map((s) => s.id).join();
    if (key !== order) {
      order = key;
      layer.append(...shapes.map((s) => parts.get(s.id)!.g));
    }
  }

  function draw(t: number, clock: number, calm: boolean) {
    if (dirty || (t >= BEAT.rest - 0.02 && t <= BEAT.tumble + 0.05)) {
      paintCubes(t, !calm || seeking);
      dirty = false;
    }
    // the marks: each face gets its mark a moment after the one before, with an overshoot; the cube hops once, as a block does when struck
    const since = t - BEAT.pop;
    const gone = t >= BEAT.hold ? clamp((t - BEAT.hold) / 0.3) : 0;
    faces.forEach((f, i) => {
      const u = clamp((since - i * 0.08) / 0.5);
      sty(f.g, 'opacity', clamp((since - i * 0.08) / 0.18) * (1 - gone));
      attr(f.mark, 'transform', `scale(${(0.5 + 0.5 * easeOutBack(u)).toFixed(3)})`);
    });
    const hop = since > 0 && since < 0.55 ? 7 * Math.sin((Math.PI * since) / 0.55) : 0;
    const dz = (calm ? 0 : 5 * Math.sin((clock * Math.PI * 2) / 3.4)) + hop; // how high the cube floats (world units)
    attr(cubeG, 'transform', `translate(0 ${(-dz * KZ).toFixed(2)})`);
    const sc = 1 - dz * 0.012;
    attr(shadow, 'transform', `translate(${PAD_AT[0].toFixed(1)} ${PAD_AT[1].toFixed(1)}) scale(${sc.toFixed(3)}) translate(${(-PAD_AT[0]).toFixed(1)} ${(-PAD_AT[1]).toFixed(1)})`);
    sty(shadow, 'opacity', 0.9 - dz * 0.03);
    const strike = since > 0 && since < 0.6 ? 0.35 * Math.sin((Math.PI * since) / 0.6) : 0; // the pad and the beam flare as it is struck
    const pulse = (ph = 0) => (calm ? 0.8 : 0.7 + 0.3 * Math.sin((clock * Math.PI * 2) / 1.7 + ph)) + strike;
    sty(pad, 'opacity', pulse());
    sty(beam, 'opacity', pulse(0.8));
    emit.forEach((e, i) => sty(e, 'opacity', (calm ? 0.8 : 0.55 + 0.45 * Math.sin((clock * Math.PI * 2) / 1.7 + i * 1.57)) + strike));
  }

  const loop = driveLoop({
    stage,
    length: BEAT.loop,
    poster: BEAT.pop + 1.6, // scrambled, with the marks showing
    draw: (t, clock, calm) => {
      if (t < 0.05 && !calm) dirty = true; // the poster gives way to the loop
      draw(t, clock, calm);
    },
    onWrap: () => {
      n++;
      plan = planOf(n);
      applied = 0;
      dirty = true;
    },
  });

  return {
    seek(loopNo, time) {
      cubies = poster();
      for (let i = 0; i < loopNo; i++) planOf(i).moves.forEach((m) => applyMove(cubies, m));
      n = loopNo;
      plan = planOf(loopNo);
      applied = 0;
      dirty = true;
      seeking = true;
      order = '';
      loop.seek(time);
    },
    destroy() {
      loop.destroy();
      host.innerHTML = '';
    },
  };
}
