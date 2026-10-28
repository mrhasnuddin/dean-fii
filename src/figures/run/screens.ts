// What the instrument's screens show (docs/device-design.md §32): wireframe pictures built from blocks, no text. Each
// scene is markup plus a run(t, pose, stop) that sets attributes on its own parts from the script's times (script.ts),
// so what the CRT draws and what the hardware does are one timeline. A Screen holds a screen's scenes and cross-fades
// between them.
import { attr, r2, sty } from './dom';
import { BRIEF, IDEA, ITER, MOTION, PROMPT, PROTO, SHIP, TOKENS, bump, clamp, ease, easeOut, prog, type Pose, type SceneId } from './script';

const n = r2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const R = (cls: string, x: number, y: number, w: number, h: number, key = '', rx = 0) =>
  `<rect class="${cls}"${key ? ` data-k="${key}"` : ''} x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${rx ? ` rx="${rx}"` : ''}/>`;
const ARROW = 'M0 0l0 8l2.2 -2l2 4l1.6 -0.8l-2 -4l3.2 -0.2z';
type El = SVGElement | undefined;
type Refs = Record<string, SVGElement>;
const bindRefs = (g: SVGElement): Refs => {
  const m: Refs = {};
  g.querySelectorAll<SVGElement>('[data-k]').forEach((e) => {
    m[e.dataset.k!] = e;
  });
  return m;
};
const setO = (e: El, v: number) => sty(e, 'opacity', clamp(v));
const setFo = (e: El, v: number) => sty(e, 'fillOpacity', clamp(v));
const setR = (e: El, x: number, y: number, w: number, h: number) => {
  attr(e, 'x', String(n(x)));
  attr(e, 'y', String(n(y)));
  attr(e, 'width', String(n(Math.max(0, w))));
  attr(e, 'height', String(n(Math.max(0, h))));
};
const setT = (e: El, s: string) => attr(e, 'transform', s);
const at = (x: number, y: number) => `translate(${n(x)} ${n(y)})`;
const pop = (s: number, cx: number, cy: number) => `translate(${n(cx)} ${n(cy)}) scale(${n(s)}) translate(${n(-cx)} ${n(-cy)})`;
/** A path drawn on from its start (pathLength 1): p 0–1. */
const drawOn = (e: El, p: number) => {
  sty(e, 'strokeDashoffset', 1 - p);
  sty(e, 'opacity', p > 0.001 ? 1 : 0);
};
const cursorAt = (e: El, x: number, y: number, s = 0.85) => setT(e, `${at(x, y)} scale(${s})`);

export interface Scene {
  svg: string;
  run(t: number, p: Pose, stop: number): void;
}
/** A scene's parts, found once its markup is in the document. */
type Maker = (refs: () => Refs) => Scene;
const wrap = (id: string, svg: string) => `<g data-scene="${id}" style="display:none">${svg}</g>`;

// ---------------------------------------------------------------- Brief: a checklist ticks itself off
const brief: Maker = (R_) => {
  const widths = [38, 30, 44, 26];
  let s = R('gd', 0, 0, 14, 3.4, 'hd', 1) + R('gd', 0, 0, 3.4, 5.6, 'sb');
  for (let i = 0; i < 3; i++) s += R('gd3', 40 + i * 9, 0.8, 6, 1.8, `nv${i}`);
  widths.forEach((w, i) => {
    const y = 11 + i * 11;
    s += `<g data-k="row${i}"><rect class="gl" x="0.6" y="${y}" width="6" height="6" rx="1.4"/><path class="gld" data-k="tick${i}" pathLength="1" d="M1.8 ${y + 3.2}l1.8 1.8l3 -3.6"/>`
      + `${R('gd2', 10.5, y + 0.4, w, 3.2, `bar${i}`, 1.2)}${R('gd3', 10.5, y + 4.6, w * 0.55, 1.6, `sub${i}`, 0.8)}</g>`;
  });
  return {
    svg: s,
    run(t) {
      const r = R_();
      const show = prog(t, BRIEF.show, 0.3);
      for (const k of ['hd', 'nv0', 'nv1', 'nv2']) setO(r[k], show);
      setO(r.sb, t < BRIEF.show ? (Math.floor(t * 2) % 2 === 0 ? 1 : 0.15) : 0); // the standby cursor blinks until the brief arrives
      widths.forEach((w, i) => {
        const t0 = BRIEF.rows[i];
        const b = easeOut(prog(t, t0 - 0.3, 0.45));
        setO(r[`row${i}`], prog(t, t0 - 0.35, 0.15));
        attr(r[`bar${i}`], 'width', String(n(w * b)));
        attr(r[`sub${i}`], 'width', String(n(w * 0.55 * b)));
        drawOn(r[`tick${i}`], easeOut(prog(t, t0, 0.3)));
      });
    },
  };
};

// ---------------------------------------------------------------- Ideation: a moodboard, one tile chosen and grown into the page
const TW = 21, TH = 16.67, TG = 2.5;
const tileXY = (i: number): [number, number] => [(i % 3) * (TW + TG), Math.floor(i / 3) * (TH + TG)];
const GLYPHS: [string, number, number, number, number, number?][][] = [
  [['gd', 2, 2, 8, 1.6], ['gd2', 2, 5.5, 17, 6.5], ['gd3', 2, 13, 7, 1.6]],
  [['gd2', 2, 2, 7.5, 12.6], ['gd3', 11, 2, 8, 5], ['gd3', 11, 8.4, 8, 6.2]],
  [['gd3', 2, 2, 17, 12.6], ['gd', 5, 5, 8, 1.8], ['gd2', 5, 8.6, 12, 1.6], ['gd2', 5, 11.2, 8, 1.6]],
  [['gd2', 2, 2, 7.5, 5.6], ['gd2', 11.5, 2, 7.5, 5.6], ['gd2', 2, 9.4, 7.5, 5.2], ['gd2', 11.5, 9.4, 7.5, 5.2]],
  [['gd', 2, 1.6, 5, 1.4], ['gd3', 2, 4.2, 17, 5.2], ['gd', 3.4, 5.4, 7, 1.5], ['gd2', 2, 10.6, 5, 4.4], ['gd2', 8, 10.6, 5, 4.4], ['gd2', 14, 10.6, 5, 4.4]],
  [['gd2', 2, 2, 17, 2], ['gd3', 2, 5.6, 17, 2.4], ['gd3', 2, 9, 17, 2.4], ['gd3', 2, 12.4, 17, 2.2]],
  [['gd3', 2, 2, 17, 12.6], ['gd2', 7.5, 3.6, 6, 6, 3], ['gd', 4, 11, 13, 1.5]],
  [['gd2', 2, 2, 9, 12.6], ['gd3', 12.5, 2, 6.5, 12.6], ['gd', 3.6, 3.6, 6, 1.4]],
  [['gd3', 2, 2, 17, 12.6], ['gd2', 4, 4, 13, 3.2], ['gd2', 4, 8.4, 13, 2.6], ['gd', 4, 12, 5, 1.6]],
];
const ideation: Maker = (R_) => {
  let s = '';
  GLYPHS.forEach((g, i) => {
    s += `<g data-k="t${i}">${R('gd3', 0, 0, TW, TH, '', 1.4)}${g.map(([c, x, y, w, h, rx]) => R(c, x, y, w, h, '', rx ?? 0.6)).join('')}</g>`;
  });
  s += `<rect class="gl" data-k="ring" rx="1.8" width="${TW + 2}" height="${TH + 2}"/><path class="cur" data-k="cur" d="${ARROW}"/>`;
  const centre = (i: number): [number, number] => {
    const [x, y] = tileXY(i);
    return [x + TW / 2, y + TH / 2];
  };
  return {
    svg: s,
    run(t) {
      const r = R_();
      const win = IDEA.win;
      const done = easeOut(prog(t, IDEA.pick + 0.1, 0.4)); // the others fade once the tile is chosen
      const grow = ease(prog(t, IDEA.expand, 0.95)); // a tile growing into the page: in and out
      for (let i = 0; i < 9; i++) {
        const [x, y] = tileXY(i);
        const a = easeOut(prog(t, IDEA.tiles + i * 0.09, 0.35));
        if (i === win && grow > 0) {
          const sx = lerp(1, 68 / TW, grow), sy = lerp(1, 55 / TH, grow);
          setT(r[`t${i}`], `${at(lerp(x, 0, grow), lerp(y, 0, grow))} scale(${n(sx)} ${n(sy)})`);
        } else setT(r[`t${i}`], `${at(x, y)}${pop(0.7 + 0.3 * a, TW / 2, TH / 2)}`);
        setO(r[`t${i}`], a * (i === win ? 1 : 1 - 0.88 * done));
      }
      // the cursor hops tile to tile with each D-pad press
      let from = 0, pos: [number, number] = centre(0);
      for (const h of IDEA.hops) {
        if (t >= h.t) {
          const e = ease(prog(t, h.t, 0.28)); // the cursor travels
          const [ax, ay] = centre(from), [bx, by] = centre(h.to);
          pos = [lerp(ax, bx, e), lerp(ay, by, e)];
          from = h.to;
        }
      }
      const shown = prog(t, IDEA.cursor, 0.2) * (1 - prog(t, IDEA.pick + 0.2, 0.2));
      cursorAt(r.cur, pos[0] + 3, pos[1] + 2);
      setO(r.cur, shown);
      setT(r.ring, at(pos[0] - TW / 2 - 1, pos[1] - TH / 2 - 1));
      setO(r.ring, shown * (0.55 + 0.45 * bump(t, IDEA.pick - 0.05, 0.4) + 0.3 * (t >= IDEA.pick ? 1 : 0)));
    },
  };
};

// ---------------------------------------------------------------- Skills: the cartridge's nine cells, mirrored as installed files
const CS = 13, CG = 3, CX0 = 11.5, CY0 = 1;
const skills: Maker = (R_) => {
  let s = R('gd3', CX0, 50, 45, 2.6, '', 1.3) + R('gd', CX0, 50, 0, 2.6, 'bar', 1.3);
  for (let i = 0; i < 9; i++) {
    const x = CX0 + (i % 3) * (CS + CG), y = CY0 + Math.floor(i / 3) * (CS + CG);
    s += `<g data-k="c${i}" transform="${at(x, y)}">${R('gd3', 0, 0, CS, CS, `f${i}`, 2)}<rect class="gl" data-k="o${i}" width="${CS}" height="${CS}" rx="2"/>`
      + `<path class="gl2" data-k="g${i}" d="M3.6 2.6H8L10.2 4.8V10.4H3.6ZM8 2.6V4.8H10.2M5.2 7H8.6M5.2 8.8H8.6"/></g>`;
  }
  return {
    svg: s,
    run(t, p) {
      const r = R_();
      for (let i = 0; i < 9; i++) {
        const x = CX0 + (i % 3) * (CS + CG), y = CY0 + Math.floor(i / 3) * (CS + CG);
        const a = easeOut(prog(t, 0.2 + i * 0.05, 0.3));
        const lit = clamp(p.cells - i);
        setT(r[`c${i}`], `${at(x, y)}${pop(0.8 + 0.2 * a, CS / 2, CS / 2)}`);
        setO(r[`c${i}`], a);
        setFo(r[`f${i}`], lerp(0.16, 0.34, lit));
        setO(r[`o${i}`], lit);
        setO(r[`g${i}`], 0.6 + 0.4 * lit);
      }
      attr(r.bar, 'width', String(n(45 * clamp(p.cells / 9))));
    },
  };
};

// ---------------------------------------------------------------- Design system: tokens first, then the parts built on them
const SW: [number, number][] = [[0, 0], [11.5, 0], [0, 11.5], [11.5, 11.5]];
const SW_CLS = ['gd', 'gd2', 'gd3', 'pnl'];
const tokens: Maker = (R_) => {
  let s = '';
  SW.forEach(([x, y], i) => (s += R(SW_CLS[i], x, y, 9, 9, `sw${i}`, 1.2)));
  s += `<rect class="gl" data-k="sel" width="11.4" height="11.4" rx="1.8"/>`;
  s += R('gd', 26, 1, 24, 4.2, 'ty0', 1) + R('gd2', 26, 8, 32, 2.8, 'ty1', 1) + R('gd2', 26, 13.5, 22, 1.8, 'ty2', 1);
  s += `<rect class="gl" data-k="rad" x="55" y="0.5" width="12" height="12" rx="0.5"/>`;
  s += R('gd3', 0, 25, 20, 8, 'btn', 1.5) + `<rect class="gl2" data-k="inp" x="24" y="25" width="26" height="8" rx="1.5"/>`;
  s += `<rect class="gl2" data-k="tog" x="54" y="26" width="12" height="6" rx="3"/><circle class="gd" data-k="tgk" cx="59" cy="29" r="2"/>`;
  s += R('gd3', 0, 37, 68, 17, 'card', 2) + R('gd2', 3, 40, 20, 2.6, 'cd0', 1) + R('gd3', 3, 45, 40, 1.8, 'cd1', 0.9) + R('gd3', 3, 48.6, 30, 1.8, 'cd2', 0.9) + R('gd', 50, 46.5, 15, 4.4, 'cd3', 1.2);
  return {
    svg: s,
    run(t, p) {
      const r = R_();
      SW.forEach((_, i) => {
        const a = easeOut(prog(t, TOKENS.swatches + i * 0.12, 0.3));
        setO(r[`sw${i}`], a);
        setT(r[`sw${i}`], pop(0.6 + 0.4 * a, SW[i][0] + 4.5, SW[i][1] + 4.5));
      });
      // the frame hops between swatches as the console's slider moves
      const u = clamp((p.slider - 0.2) / 0.6) * 3;
      const i0 = Math.min(3, Math.floor(u));
      const e = ease(u - i0);
      const [ax, ay] = SW[i0], [bx, by] = SW[Math.min(3, i0 + 1)];
      setT(r.sel, at(lerp(ax, bx, e) - 1.2, lerp(ay, by, e) - 1.2));
      setO(r.sel, prog(t, 0.8, 0.2));
      [24, 32, 22].forEach((w, i) => attr(r[`ty${i}`], 'width', String(n(w * easeOut(prog(t, TOKENS.type + i * 0.2, 0.45))))));
      const rx = 0.5 + 5.5 * easeOut(prog(t, TOKENS.radius, 0.8));
      setO(r.rad, prog(t, TOKENS.radius - 0.2, 0.3));
      attr(r.rad, 'rx', String(n(rx)));
      const part = (k: string, t0: number, dy = 2) => {
        const a = easeOut(prog(t, t0, 0.35));
        setO(r[k], a);
        setT(r[k], at(0, (1 - a) * dy));
      };
      part('btn', TOKENS.parts); part('inp', TOKENS.parts + 0.2); part('tog', TOKENS.parts + 0.4); part('tgk', TOKENS.parts + 0.4);
      part('card', TOKENS.parts + 0.6, 3);
      for (const k of ['cd0', 'cd1', 'cd2', 'cd3']) part(k, TOKENS.parts + 0.7);
      for (const k of ['btn', 'inp']) attr(r[k], 'rx', String(n(1 + 0.5 * rx)));
      setFo(r.btn, lerp(0.16, 1, easeOut(prog(t, TOKENS.adopt, 0.4)))); // the chosen colour lands on the button
    },
  };
};

// ---------------------------------------------------------------- Motion: an easing curve, a box riding it, a button that answers
const BZ = (u: number): [number, number] => {
  const m = 1 - u;
  const c = (a: number, b: number, c2: number, d: number) => m * m * m * a + 3 * m * m * u * b + 3 * m * u * u * c2 + u * u * u * d;
  return [c(2, 14, 22, 34), c(32, 32, 3, 3)];
};
const motion: Maker = (R_) => {
  let s = `<path class="gl2" d="M2 1V32H36"/><path class="gl2" data-k="lin" pathLength="1" d="M2 32L34 3" style="stroke-dasharray:0.04 0.03"/>`;
  s += `<path class="gld" data-k="curve" pathLength="1" d="M2 32C14 32 22 3 34 3"/><circle class="gd" data-k="dot" r="1.9"/>`;
  s += R('gd3', 40, 10.5, 26, 3, 'groove', 1.5) + R('gd', 40, 8, 7, 8, 'box', 1.5);
  s += R('gd2', 40, 26.5, 22, 9, 'bt', 4.5) + `<circle class="gl" data-k="rip" cx="51" cy="31" r="3"/>`;
  for (let i = 0; i < 3; i++) s += R(i === 1 ? 'gd' : 'gd2', 2 + i * 12, 43, 9, 9, `st${i}`, 1.4);
  return {
    svg: s,
    run(t, p) {
      const r = R_();
      const u = clamp(p.knob / 270);
      setO(r.lin, prog(t, MOTION.axes, 0.4));
      drawOn(r.curve, easeOut(prog(t, MOTION.axes + 0.2, 0.7)));
      const [dx, dy] = BZ(u);
      attr(r.dot, 'cx', String(n(dx)));
      attr(r.dot, 'cy', String(n(dy)));
      setO(r.dot, prog(t, MOTION.turn - 0.1, 0.2));
      setO(r.groove, prog(t, MOTION.track - 0.4, 0.3));
      const bx = 40 + 19 * ease(prog(t, MOTION.track, 1.3)); // the same in-out curve that is plotted, as a box on a track
      setT(r.box, at(bx - 40, 0));
      setO(r.box, prog(t, MOTION.track - 0.4, 0.3));
      const press = bump(t, MOTION.press, 0.28);
      setT(r.bt, pop(1 - 0.08 * press, 51, 31));
      setO(r.bt, prog(t, MOTION.track + 0.2, 0.3));
      const rp = prog(t, MOTION.press + 0.1, 0.8);
      attr(r.rip, 'r', String(n(3 + 12 * easeOut(rp))));
      setO(r.rip, rp > 0 ? 0.9 * (1 - rp) : 0);
      for (let i = 0; i < 3; i++) {
        const a = easeOut(prog(t, 3.0 + i * 0.22, 0.4)); // a staggered entrance
        setO(r[`st${i}`], a);
        setT(r[`st${i}`], at(0, (1 - a) * 5));
      }
    },
  };
};

// ---------------------------------------------------------------- Prompting: prompt, build, review, refine, again
type Item = { k: string; cls: string; at: number; geo: (v: number) => [number, number, number, number]; rx?: number; o?: (v: number) => number; fo?: (v: number) => number };
const promptItems = (): Item[] => {
  const it: Item[] = [
    { k: 'logo', cls: 'gd', at: 0, geo: () => [0, 0, 16, 3], rx: 1 },
    { k: 'hero', cls: 'gd3', at: 0, geo: (v) => [0, 6, 68, lerp(17, 14, v)], rx: 1.5 },
    { k: 'h1', cls: 'gd', at: 0.25, geo: (v) => [4, 9.4, lerp(28, 36, v), 4], rx: 1 },
    { k: 'h2', cls: 'gd2', at: 0.4, geo: () => [4, 16, 22, 2.2], rx: 1 },
    { k: 'im', cls: 'gd2', at: 0.3, geo: (v) => [42, 9, 22, lerp(11, 8, v)], rx: 1.2 },
  ];
  for (let c = 0; c < 3; c++) {
    const x = c * 23.5;
    const y = (v: number) => lerp(26, 22, v);
    it.push({ k: `cb${c}`, cls: 'gd3', at: 0.5 + c * 0.2, geo: (v) => [x, y(v), 21, 15], rx: 1.4, fo: (v) => (c === 1 ? lerp(0.16, 0.42, v) : 0.16) });
    it.push({ k: `ci${c}`, cls: 'gd2', at: 0.55 + c * 0.2, geo: (v) => [x + 2, y(v) + 2, 17, 7], rx: 1 });
    it.push({ k: `cl${c}`, cls: 'gd2', at: 0.6 + c * 0.2, geo: (v) => [x + 2, y(v) + 11, 12, 1.8], rx: 0.9 });
  }
  it.push({ k: 'strip', cls: 'gd2', at: 1, geo: () => [0, 41, 68, 3.4], rx: 1.2 });
  return it;
};
const itemMarkup = (items: Item[]) => items.map((i) => R(i.cls, 0, 0, 0, 0, i.k, i.rx ?? 0)).join('');
const prompt: Maker = (R_) => {
  const items = promptItems();
  let s = itemMarkup(items);
  s += `<rect class="gl2" x="0" y="47" width="68" height="8" rx="4"/>${R('gd2', 2, 48.6, 0, 4.8, 'typed', 2.4)}${R('gd', 2, 48.6, 1.2, 4.8, 'caret')}<circle class="gd" data-k="send" cx="63" cy="51" r="2.6"/>`;
  s += `<g data-k="loop"><path class="gl" d="M-3.4 0A3.4 3.4 0 1 1 0 3.4M-1.6 1.7L0 3.4L1.9 1.8"/></g>`;
  const LEN = [26, 42, 22];
  return {
    svg: s,
    run(t) {
      const r = R_();
      const sent = (k: number) => PROMPT.press[k] + 0.6; // the pass is built once the prompt has reached the console
      const v = ease(prog(t, sent(2) + 0.2, 0.7)); // pass 3 refines what pass 1 and 2 built
      for (const it of items) {
        const pass = it.at >= 1 ? 2 : it.at >= 0.5 ? 1 : 0;
        const t0 = sent(pass) + it.at - (pass === 1 ? 0.5 : pass === 2 ? 1 : 0);
        const a = easeOut(prog(t, t0, 0.3));
        const e = r[it.k];
        const [x, y, w, h] = it.geo(v);
        setR(e, x, y + (1 - a) * 2, w, h);
        setO(e, a);
        if (it.fo) setFo(e, it.fo(v));
      }
      // the prompt bar types, sends and clears; the loop mark turns the whole time
      let typed = 0;
      PROMPT.press.forEach((press, k) => {
        const g = prog(t, press - 0.75, 0.6);
        if (t < press + 0.12) typed = Math.max(typed, g * LEN[k]);
      });
      attr(r.typed, 'width', String(n(typed)));
      setR(r.caret, 2 + typed + 1, 48.6, 1.2, 4.8);
      setO(r.caret, Math.floor(t * 3) % 2 === 0 ? 1 : 0.2);
      const flash = PROMPT.press.reduce((m, press) => Math.max(m, bump(t, press, 0.3)), 0);
      attr(r.send, 'r', String(n(2.6 + 1.6 * flash)));
      setT(r.loop, `${at(62, 3.6)} rotate(${n(t * 150)})`);
    },
  };
};

// ---------------------------------------------------------------- the page itself (CRT and phone): built, shipped, changed after feedback
type Page = { items: Item[]; extra: string };
const crtPage = (): Page => {
  const it: Item[] = [
    { k: 'logo', cls: 'gd', at: 0, geo: () => [2, 2, 12, 3.2], rx: 1 },
    { k: 'n0', cls: 'gd2', at: 0.04, geo: () => [42, 2.8, 5, 1.8], rx: 0.9 },
    { k: 'n1', cls: 'gd2', at: 0.06, geo: () => [50, 2.8, 5, 1.8], rx: 0.9 },
    { k: 'n2', cls: 'gd2', at: 0.08, geo: () => [58, 2.8, 6, 1.8], rx: 0.9 },
    { k: 'hero', cls: 'gd3', at: 0.1, geo: () => [0, 9, 68, 23], rx: 1.5 },
    // the hero's text and picture swap sides after the changes: two sets, cross-faded
    { k: 'h1', cls: 'gd', at: 0.18, geo: () => [4, 13, 28, 4.2], rx: 1, o: (v) => 1 - v },
    { k: 'h2', cls: 'gd2', at: 0.22, geo: () => [4, 20, 20, 2.2], rx: 1, o: (v) => 1 - v },
    { k: 'bt', cls: 'gd', at: 0.26, geo: () => [4, 25, 11, 4.4], rx: 1.2, o: (v) => 1 - v },
    { k: 'im', cls: 'gd2', at: 0.2, geo: () => [38, 12, 26, 17], rx: 1.5, o: (v) => 1 - v },
    { k: 'h1b', cls: 'gd', at: 0.18, geo: () => [38, 13, 26, 4.2], rx: 1, o: (v) => v },
    { k: 'h2b', cls: 'gd2', at: 0.22, geo: () => [38, 20, 18, 2.2], rx: 1, o: (v) => v },
    { k: 'btb', cls: 'gd', at: 0.26, geo: () => [38, 25, 15, 4.4], rx: 1.2, o: (v) => v },
    { k: 'imb', cls: 'gd2', at: 0.2, geo: () => [4, 12, 28, 17], rx: 1.5, o: (v) => v },
  ];
  for (let c = 0; c < 3; c++) {
    const x = c * 23.5;
    it.push({ k: `cb${c}`, cls: 'gd3', at: 0.36 + c * 0.1, geo: () => [x, 36, 21, 18], rx: 1.4, fo: (v) => (c === 1 ? lerp(0.16, 0.42, v) : 0.16) });
    it.push({ k: `ci${c}`, cls: 'gd2', at: 0.4 + c * 0.1, geo: () => [x + 2, 38, 17, 9], rx: 1, fo: (v) => (c === 1 ? lerp(0.5, 1, v) : 0.5) });
    it.push({ k: `cl${c}`, cls: 'gd2', at: 0.44 + c * 0.1, geo: () => [x + 2, 49, 12, 1.8], rx: 0.9 });
  }
  const extra = `<rect class="gl" data-k="fl0" x="-0.6" y="8.4" width="69.2" height="24.2" rx="2"/><rect class="gl" data-k="fl1" x="22.9" y="35.4" width="22.2" height="19.2" rx="2"/>`
    + `<g data-k="badge"><circle class="gd" cx="51" cy="20.5" r="7.6"/><path class="gk" data-k="check" pathLength="1" d="M47.2 20.8l2.9 2.9l5.6 -6"/></g><path class="cur" data-k="cur" d="${ARROW}"/>`;
  return { items: it, extra };
};
const phonePage = (): Page => {
  const it: Item[] = [
    { k: 'logo', cls: 'gd', at: 0, geo: () => [0, 0, 8, 2.2], rx: 0.8 },
    { k: 'n0', cls: 'gd2', at: 0.04, geo: () => [17, 0.5, 3, 1.2], rx: 0.6 },
    { k: 'n1', cls: 'gd2', at: 0.06, geo: () => [21, 0.5, 3, 1.2], rx: 0.6 },
    { k: 'hero', cls: 'gd3', at: 0.1, geo: () => [0, 5, 25, 17], rx: 1.2 },
    { k: 'h1', cls: 'gd', at: 0.18, geo: () => [2, 7.5, 12, 3], rx: 0.8, o: (v) => 1 - v },
    { k: 'h2', cls: 'gd2', at: 0.22, geo: () => [2, 12, 9, 1.6], rx: 0.8, o: (v) => 1 - v },
    { k: 'bt', cls: 'gd', at: 0.26, geo: () => [2, 15.4, 7, 3], rx: 0.9, o: (v) => 1 - v },
    { k: 'im', cls: 'gd2', at: 0.2, geo: () => [14.5, 7, 8.5, 12.5], rx: 1, o: (v) => 1 - v },
    { k: 'h1b', cls: 'gd', at: 0.18, geo: () => [12, 7.5, 11, 3], rx: 0.8, o: (v) => v },
    { k: 'h2b', cls: 'gd2', at: 0.22, geo: () => [12, 12, 9, 1.6], rx: 0.8, o: (v) => v },
    { k: 'btb', cls: 'gd', at: 0.26, geo: () => [12, 15.4, 9, 3], rx: 0.9, o: (v) => v },
    { k: 'imb', cls: 'gd2', at: 0.2, geo: () => [2, 7, 8.5, 12.5], rx: 1, o: (v) => v },
  ];
  for (let c = 0; c < 4; c++) {
    const x = (c % 2) * 13.5, y = 25 + Math.floor(c / 2) * 15;
    it.push({ k: `cb${c}`, cls: 'gd3', at: 0.36 + c * 0.09, geo: () => [x, y, 11.5, 13], rx: 1.2, fo: (v) => (c === 1 ? lerp(0.16, 0.42, v) : 0.16) });
    it.push({ k: `ci${c}`, cls: 'gd2', at: 0.4 + c * 0.09, geo: () => [x + 1.5, y + 1.5, 8.5, 6.5], rx: 0.9, fo: (v) => (c === 1 ? lerp(0.5, 1, v) : 0.5) });
    it.push({ k: `cl${c}`, cls: 'gd2', at: 0.44 + c * 0.09, geo: () => [x + 1.5, y + 9.5, 6, 1.4], rx: 0.7 });
  }
  const extra = `<g data-k="bub"><path class="dk" d="M2.5 27H21.5A1.4 1.4 0 0 1 23 28.4V35.6A1.4 1.4 0 0 1 21.5 37H8L4.6 40.2V37H2.5A1.4 1.4 0 0 1 1.1 35.6V28.4A1.4 1.4 0 0 1 2.5 27Z"/>`
    + `<path class="gl" d="M2.5 27H21.5A1.4 1.4 0 0 1 23 28.4V35.6A1.4 1.4 0 0 1 21.5 37H8L4.6 40.2V37H2.5A1.4 1.4 0 0 1 1.1 35.6V28.4A1.4 1.4 0 0 1 2.5 27Z"/>`
    + `${R('gd2', 4, 29.6, 14, 1.6, '', 0.8)}${R('gd2', 4, 32.8, 9, 1.6, '', 0.8)}<path class="gld" data-k="btick" pathLength="1" d="M16 33.4l1.6 1.6l3 -3.4"/></g>`
    + `<g data-k="badge"><circle class="gd" cx="12.5" cy="31" r="6.2"/><path class="gk" data-k="check" pathLength="1" d="M9.6 31.2l2.3 2.3l4.4 -4.8"/></g>`;
  return { items: it, extra };
};
const pageScene = (kind: 'crt' | 'phone'): Maker => (R_) => {
  const { items, extra } = kind === 'crt' ? crtPage() : phonePage();
  const svg = itemMarkup(items) + extra;
  return {
    svg,
    run(t, p, stop) {
      const r = R_();
      // stop 6 builds the page; 7 and 8 find it built
      const build = stop === 6 ? (kind === 'crt' ? prog(t, PROTO.build, 1.4) : prog(t, PROTO.phone, 1.1)) : 1;
      const v = kind === 'crt' ? p.crtV : p.phoneV;
      for (const it of items) {
        const a = easeOut(prog(build, it.at, 0.25));
        const e = r[it.k];
        const [x, y, w, h] = it.geo(v);
        setR(e, x, y + (1 - a) * 2, w, h);
        setO(e, a * (it.o ? it.o(v) : 1));
        if (it.fo) setFo(e, it.fo(v));
      }
      const flash = Math.sin(Math.PI * clamp(v)) * (stop === 7 ? 1 : 0);
      setO(r.fl0, flash);
      setO(r.fl1, flash);
      const ship = stop === 8 ? prog(t, kind === 'crt' ? SHIP.tick : SHIP.phoneTick, 0.4) : 0;
      setO(r.badge, ship);
      setT(r.badge, kind === 'crt' ? pop(0.5 + 0.5 * easeOut(ship), 51, 20.5) : pop(0.5 + 0.5 * easeOut(ship), 12.5, 31));
      drawOn(r.check, easeOut(prog(ship, 0.25, 0.6)));
      if (kind === 'crt') {
        // the pointer idles on the page, then goes to the hero's button when the changes are made
        const go = stop === 7 ? ease(prog(t, ITER.crt - 0.4, 0.5)) : stop === 8 ? 1 : 0;
        const x = lerp(46 + 3 * Math.sin(t * 0.9), 20, go), y = lerp(31 + 2 * Math.cos(t * 0.7), 29, go);
        cursorAt(r.cur, x, y);
        setO(r.cur, stop === 8 ? 0 : build > 0.8 ? 1 : 0);
      } else {
        const bub = stop === 7 ? easeOut(prog(t, ITER.bubble, 0.35)) : 0;
        setO(r.bub, bub);
        setT(r.bub, pop(0.6 + 0.4 * bub, 2, 40));
        drawOn(r.btick, stop === 7 ? easeOut(prog(t, ITER.tick, 0.3)) : 0);
      }
    },
  };
};

// ---------------------------------------------------------------- the light unit's screen: two lines typing
const lite: Maker = (R_) => ({
  svg: R('gd', 0, 0.6, 5, 1.6, 'l0', 0.8) + R('gd2', 0, 3.4, 3, 1.6, 'l1', 0.8) + R('gd', 0, 0.4, 1, 2, 'lc'),
  run(t, p) {
    const r = R_();
    attr(r.l0, 'width', String(n(4 + 17 * p.typing)));
    attr(r.l1, 'width', String(n(3 + 21 * clamp(p.typing * 1.3 - 0.1))));
    setT(r.lc, at(4 + 17 * p.typing, 0));
    setO(r.lc, p.typing > 0 && p.typing < 1 ? (Math.floor(t * 4) % 2 === 0 ? 1 : 0.1) : 0);
  },
});

// ---------------------------------------------------------------- the screen host
const MAKERS: Record<SceneId, Maker> = { brief, ideation, skills, tokens, motion, prompt, page: pageScene('crt') };

export class Screen {
  private scenes = new Map<string, { g: SVGGElement; sc: Scene; o: number; refs: Refs }>();
  private cur = '';
  constructor(slot: SVGGElement, origin: [number, number], makers: Record<string, Maker>) {
    const ns = 'http://www.w3.org/2000/svg';
    const root = document.createElementNS(ns, 'g');
    root.setAttribute('transform', at(origin[0], origin[1]));
    slot.appendChild(root);
    for (const [id, make] of Object.entries(makers)) {
      let refs: Refs = {};
      const sc = make(() => refs);
      const tmp = document.createElementNS(ns, 'g');
      tmp.innerHTML = wrap(id, sc.svg);
      const g = tmp.firstElementChild as SVGGElement;
      root.appendChild(g);
      refs = bindRefs(g);
      this.scenes.set(id, { g, sc, o: 0, refs });
    }
    this.root = root;
  }
  private root: SVGGElement;
  /** Runs the scene on show and cross-fades the others out; true while a fade is still going. */
  draw(id: string, t: number, p: Pose, stop: number, dt: number, calm: boolean, on = 1) {
    const first = this.cur === '';
    this.cur = id;
    let fading = false;
    for (const [k, s] of this.scenes) {
      const target = k === id ? 1 : 0;
      s.o = calm || (first && k === id) ? target : s.o + (target - s.o) * Math.min(1, dt * 14);
      if (Math.abs(target - s.o) < 0.02) s.o = target;
      if (s.o !== target) fading = true;
      const shown = s.o > 0 ? '' : 'none';
      if (s.g.style.display !== shown) s.g.style.display = shown;
      sty(s.g, 'opacity', s.o);
    }
    this.scenes.get(id)?.sc.run(t, p, stop);
    sty(this.root, 'opacity', clamp(on));
    return fading;
  }
}

export const crtScreen = (slot: SVGGElement) => new Screen(slot, [16, 16], MAKERS);
export const phoneScreen = (slot: SVGGElement) => new Screen(slot, [5.5, 9], { page: pageScene('phone') });
export const liteScreen = (slot: SVGGElement) => new Screen(slot, [9, 7.5], { lite });
