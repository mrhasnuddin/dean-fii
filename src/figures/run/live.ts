// The "How I work" instrument, live (docs/device-design.md §32). A tour plays the six steps in order while nobody
// touches the page (Framework as four stops); a step chosen in the accordion takes over: hold(step, sub) plays that
// step's scene once and rests on its last frame, and when it is let go (hold(-1)) the tour comes back a few seconds
// later. Every part's pose is a function of (stop, time) (script.ts); the parts are springs that follow it, so a jump
// from any step to any other moves the machine there without a pop. The screens are drawn by screens.ts; the light
// (screen glow, the pulse on a cable, the tray's ring) is one WebGL layer, with an SVG dot as the fallback.
import '../../vendor/anatomy/iso.css';
import './run.css';
import { figureSvg } from '../../vendor/anatomy/iso-kit.mjs';
import { glCamera, glLayer, settle } from '../../vendor/anatomy/gl.mjs';
import { GL_DATA, H, KZ, P, RISE, ROUTES, W, iso3, sceneBody, type GlPlane } from './scene.mjs';
import { STOPS, clamp, poseOf, stopOf, type Pose, type Route } from './script';
import { attr, r2, sty } from './dom';
import { crtScreen, liteScreen, phoneScreen } from './screens';

export interface RunOptions {
  /** Hears the step on show (0–5) and Framework's sub-step (0–3, else 0). */
  onStep?: (step: number, sub: number) => void;
  /** While the tour runs: how far through the step on show it is (0–1) and through Framework's sub-step; -1 when not timing. */
  onTimer?: (step: number, sub: number) => void;
  /** The figure's own description for screen readers. */
  label?: string;
}
export interface RunHandle {
  /** Plays step i (and Framework's sub-step) and rests on it; -1 lets go, and the tour comes back after a while. */
  hold(step: number, sub?: number): void;
  /** Shows a stop frozen at `time` seconds in (for the lab and the checks). */
  seek(step: number, sub: number, time: number): void;
  destroy(): void;
}

const RESUME = 3.5; // s after a step is let go before the tour comes back
const PLUS = 0.25; // s the tour lingers on a stop's last frame before the next one starts
type Key = 'card' | 'cart' | 'cells' | 'slider' | 'knob' | 'lampA' | 'lampB' | 'crt' | 'lite' | 'phone' | 'up' | 'down' | 'left' | 'right' | 'btnA' | 'btnB' | 'ring' | 'fin' | 'typing' | 'crtV' | 'phoneV';
const KEYS: Key[] = ['card', 'cart', 'cells', 'slider', 'knob', 'lampA', 'lampB', 'crt', 'lite', 'phone', 'up', 'down', 'left', 'right', 'btnA', 'btnB', 'ring', 'fin', 'typing', 'crtV', 'phoneV'];
/** How quickly each part follows its target (seconds); the rest follow at 0.06. */
const TAU: Partial<Record<Key, number>> = { card: 0.14, cart: 0.14, knob: 0.22, slider: 0.1, ring: 0.12, fin: 0.12, up: 0.03, down: 0.03, left: 0.03, right: 0.03, btnA: 0.03, btnB: 0.03 };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
let instances = 0;

const FRAGMENT = `
uniform vec4 uB0; uniform vec4 uB1; uniform vec4 uB2; // the pulses on the cables: xyz the bead, w its strength
uniform float uGc; uniform float uGp; uniform float uGl; uniform float uRing; // the screens' backlights and the tray's ring
uniform vec3 uCo; uniform vec3 uCu; uniform vec3 uCv; uniform vec3 uCn; uniform vec3 uCh; // the CRT's window: centre, axes, normal, half size + radius
uniform vec3 uPo; uniform vec3 uPu; uniform vec3 uPv; uniform vec3 uPn; uniform vec3 uPh; // the phone's
uniform vec3 uLo; uniform vec3 uLu; uniform vec3 uLv; uniform vec3 uLn; uniform vec3 uLh; // the light unit's
uniform vec3 uRc; uniform vec3 uRh; // the tray's ring: centre xy + floor z, half size xy + radius
const vec3 GOLD=vec3(.89,.80,.60);
float sdRound(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}
float glowOf(vec2 vb,vec3 lo,vec3 lu,vec3 lv,vec3 ln,vec3 lh){
  vec3 V=towardViewer();
  float dn=dot(ln,V);
  vec3 p0=rayOf(vb);
  float t=dot(lo-p0,ln)/dn;
  vec3 q=p0+t*V-lo;
  vec2 uv=vec2(dot(q,lu),dot(q,lv));
  float d=sdRound(uv,lh.xy,lh.z);
  float inside=1.-smoothstep(-.6,.6,d);
  float bloom=exp(-max(d,0.)*max(d,0.)/6.)*(1.-inside);
  return inside*.07+bloom*.10;
}
vec3 bead(vec2 vb,vec4 b){
  if(b.w<=.001) return vec3(0.);
  float d=length(vb-project(b.xyz))/uK;
  vec3 f=onFloor(vb,0.);
  float pool=exp(-dot(f.xy-b.xy,f.xy-b.xy)/90.);
  return GOLD*b.w*(1.3*exp(-d*d/2.2)+.38*exp(-d*d/26.)+.16*pool);
}
void main(){
  vec2 vb=viewOf(gl_FragCoord.xy);
  vec3 col=vec3(0.);
  if(uGc>.001) col+=GOLD*uGc*glowOf(vb,uCo,uCu,uCv,uCn,uCh);
  if(uGp>.001) col+=GOLD*uGp*glowOf(vb,uPo,uPu,uPv,uPn,uPh);
  if(uGl>.001) col+=GOLD*uGl*glowOf(vb,uLo,uLu,uLv,uLn,uLh);
  col+=bead(vb,uB0)+bead(vb,uB1)+bead(vb,uB2);
  if(uRing>.001){
    vec3 f=onFloor(vb,uRc.z);
    float d=sdRound(f.xy-uRc.xy,uRh.xy,uRh.z);
    float ring=exp(-d*d/1.6);
    vec3 g=onFloor(vb,0.);
    float dg=sdRound(g.xy-uRc.xy,uRh.xy,uRh.z);
    float pool=exp(-max(dg-4.,0.)*max(dg-4.,0.)/220.)*smoothstep(0.,6.,dg);
    col+=GOLD*uRing*(ring*1.1+pool*.22);
  }
  col=tonemap(col,1.15);
  float m=max(col.r,max(col.g,col.b));
  float n=(hash12(gl_FragCoord.xy+fract(uTime*.61)*91.)+hash12(gl_FragCoord.yx*1.37+fract(uTime*.37)*57.)-1.)/255.;
  col=max(col+n*smoothstep(0.,1.5/255.,m),0.);
  gl_FragColor=vec4(col,max(col.r,max(col.g,col.b)));
}`;

/** The cables' centrelines with their lengths, so a pulse can be placed a fraction of the way along. */
function lineOf(points: number[][]) {
  const len = [0];
  for (let i = 1; i < points.length; i++) len.push(len[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1], points[i][2] - points[i - 1][2]));
  const total = len[len.length - 1];
  return (f: number): number[] => {
    const d = clamp(f) * total;
    let i = 1;
    while (i < len.length - 1 && len[i] < d) i++;
    const u = (d - len[i - 1]) / (len[i] - len[i - 1] || 1);
    return points[i - 1].map((v, a) => v + (points[i][a] - v) * u);
  };
}
const ALONG = Object.fromEntries((Object.keys(ROUTES) as Route[]).map((k) => [k, lineOf(ROUTES[k])])) as Record<Route, (f: number) => number[]>;
const plane = (p: GlPlane, k: string) => ({ [`u${k}o`]: p.o, [`u${k}u`]: p.u, [`u${k}v`]: p.v, [`u${k}n`]: p.n, [`u${k}h`]: p.half });

export function mountRun(host: HTMLElement, opts: RunOptions = {}): RunHandle {
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => still.matches || document.documentElement.classList.contains('motion-off');
  const uid = String(++instances);
  const label = opts.label ?? "A small retro workstation on a desk mat: a CRT screen that shows the work, a console with a skills cartridge and a brief card, a controller, a second light-work unit, a phone on a stand that shares the work, and a tray for the finished cartridge. Each step of Dean's workflow plays on it.";
  const body = [...sceneBody().map((s) => s.replace(/\{\{u\}\}/g, uid)), ...[0, 1, 2].map(() => '<circle class="run-bead" r="2.2" cx="-9" cy="-9"/>')];
  host.innerHTML = `<div class="iso run" data-theme="dark"><div class="run-stage">${figureSvg({ width: W, height: H, label, body })}<canvas class="run-gl" aria-hidden="true"></canvas></div></div>`;
  const root = host.querySelector<HTMLElement>('.run-stage')!;
  const svg = root.querySelector('svg')!;
  const el = <T extends SVGElement = SVGElement>(sel: string) => svg.querySelector<T>(sel)!;

  // ------------------------------------------------------------ parts
  const card = el('[data-part="card"]'), cart = el('[data-part="cart"]'), dpad = el('[data-part="dpad"]');
  const btnA = el('[data-part="btn-a"]'), btnB = el('[data-part="btn-b"]'), ring = el('[data-part="ring"]'), fin = el('[data-part="fin"]');
  const cells = Array.from({ length: 9 }, (_, i) => el(`[data-cell="${i}"]`));
  const sld = el('[data-k="sld"]'), cap = el('[data-k="cap"]'), knob = el('[data-k="knob"]');
  const lamp = (n: string) => el(`[data-lamp="${n}"]`), glow = (n: string) => el(`[data-glow="${n}"]`);
  const arms = { up: el('[data-arm="up"]'), down: el('[data-arm="down"]'), left: el('[data-arm="left"]'), right: el('[data-arm="right"]') };
  const beads = Array.from(svg.querySelectorAll<SVGCircleElement>('.run-bead'));
  const crt = crtScreen(el<SVGGElement>('[data-screen="crt"]'));
  const phone = phoneScreen(el<SVGGElement>('[data-screen="phone"]'));
  const lite = liteScreen(el<SVGGElement>('[data-screen="lite"]'));
  const dz = (z: number) => `translate(0 ${(-z * KZ).toFixed(2)})`;
  const move = (e: Element, z: number) => attr(e, 'transform', dz(z));
  const lamps = (['a', 'b', 'crt', 'lite'] as const).map((n) => [lamp(n), glow(n)] as const); // found once, not every frame

  // ------------------------------------------------------------ light
  const FIXED = {
    ...plane(GL_DATA.crt, 'C'), ...plane(GL_DATA.phone, 'P'), ...plane(GL_DATA.lite, 'L'),
    uRc: [GL_DATA.ring.c[0], GL_DATA.ring.c[1], GL_DATA.ring.z], uRh: GL_DATA.ring.half,
  };
  const layer = glLayer({
    canvas: root.querySelector<HTMLCanvasElement>('.run-gl')!,
    fragment: FRAGMENT,
    view: [W, H],
    camera: glCamera(P),
    uniforms: ['uB0', 'uB1', 'uB2', 'uGc', 'uGp', 'uGl', 'uRing'],
    fixed: FIXED,
    autoFit: false, // the canvas is sized when the figure is (a resize, a new stop), not measured on every draw
    onError: () => {},
  });
  if (layer) root.setAttribute('data-gl', '');
  layer?.fit();

  // ------------------------------------------------------------ state
  const spring: Record<Key, { x: number; v: number }> = Object.fromEntries(KEYS.map((k) => [k, { x: 0, v: 0 }])) as Record<Key, { x: number; v: number }>;
  const shown = { pulses: [] as Pose['pulses'] } as Pose;
  let idx = 0;
  let t = STOPS[0].dur; // the poster: the first step, finished
  let clock = 0, last = 0, frame = 0, visible = false, started = false;
  let touring = false;
  let frozen = false; // seek() holds a frame still
  let resume = 0;
  let lastReport = '';
  let lit = ''; // the light layer's last values
  let timing = false;

  function report() {
    const s = STOPS[idx];
    const key = `${s.step}.${s.sub}`;
    if (key === lastReport) return;
    lastReport = key;
    layer?.fit(); // a good moment to re-measure the canvas (the screen's pixel ratio may have changed)
    lit = '';
    opts.onStep?.(s.step, s.sub);
  }

  /** Poses the machine for the stop on show at time t: the springs follow, then every part is set from them. Returns whether anything is still moving. */
  function draw(dt: number, calm: boolean) {
    const stop = STOPS[idx];
    const tt = Math.min(t, stop.dur);
    const target = poseOf(idx, tt);
    let moving = false;
    for (const k of KEYS) {
      if (settle(spring[k], target[k], dt, TAU[k] ?? 0.06, calm)) moving = true;
      (shown as unknown as Record<Key, number>)[k] = spring[k].x;
    }
    shown.pulses = target.pulses;
    const p = shown;
    move(card, RISE * (1 - p.card));
    move(cart, RISE * (1 - p.cart));
    cells.forEach((c, i) => sty(c, 'fillOpacity', lerp(0.12, i === 4 ? 1 : 0.5, clamp(p.cells - i))));
    const w = lerp(4, 30, p.slider);
    attr(sld, 'width', String(r2(w)));
    attr(cap, 'x', String(r2(40 + w - 1.1)));
    attr(knob, 'transform', `rotate(${Math.round(p.knob * 10) / 10})`);
    [p.lampA, p.lampB, p.crt, p.lite].forEach((v, i) => {
      sty(lamps[i][0], 'fillOpacity', 0.2 + 0.8 * v);
      sty(lamps[i][1], 'fillOpacity', 0.22 * v);
    });
    const press = Math.max(p.up, p.down, p.left, p.right);
    move(dpad, -0.9 * press);
    for (const d of ['up', 'down', 'left', 'right'] as const) sty(arms[d], 'fillOpacity', p[d]);
    move(btnA, -1.3 * p.btnA);
    move(btnB, -1.3 * p.btnB);
    sty(ring, 'opacity', p.ring);
    sty(fin, 'opacity', clamp(p.fin * 1.6));
    move(fin, 14 * (1 - p.fin));
    const fading = [crt.draw(stop.scene, tt, p, idx, dt, calm), phone.draw('page', tt, p, idx, dt, calm, p.phone), lite.draw('lite', tt, p, idx, dt, calm, p.lite)].some(Boolean);

    // the pulses on the cables: three beads at most
    const bs = target.pulses.slice(0, 3).map((q) => [...ALONG[q.route](q.f), q.a]);
    if (layer) {
      const values = { uB0: bs[0] ?? [0, 0, 0, 0], uB1: bs[1] ?? [0, 0, 0, 0], uB2: bs[2] ?? [0, 0, 0, 0], uGc: p.crt * 0.9, uGp: p.phone, uGl: p.lite, uRing: p.ring };
      const key = JSON.stringify(values);
      if (key !== lit) {
        lit = key; // nothing glows differently: the canvas stays as it is
        layer.draw(values, calm ? 0.8 : clock);
      }
    } else {
      beads.forEach((b, i) => {
        const q = bs[i];
        if (q) {
          const [x, y] = iso3(q);
          attr(b, 'cx', x.toFixed(1));
          attr(b, 'cy', y.toFixed(1));
          sty(b, 'opacity', q[3]);
        } else sty(b, 'opacity', 0);
      });
    }
    return moving || fading;
  }

  function timer() {
    const s = STOPS[idx];
    if (!touring) {
      if (timing) opts.onTimer?.(-1, -1);
      timing = false;
      return;
    }
    timing = true;
    const same = STOPS.filter((x) => x.step === s.step);
    const total = same.reduce((a, x) => a + x.dur + PLUS, 0);
    const before = STOPS.slice(0, idx).filter((x) => x.step === s.step).reduce((a, x) => a + x.dur + PLUS, 0);
    opts.onTimer?.(clamp((before + t) / total), s.step === 2 ? clamp(t / (s.dur + PLUS)) : -1);
  }

  // Every update costs the browser a fixed amount (paint, layers and commit for the whole page), however little changed, so how
  // often it updates is what matters. At most about 70 a second (a 120 or 144 Hz screen redraws it every other refresh), and
  // when the page cannot keep that up (the updates average more than 26 ms apart) about 30 for good. The motion follows time,
  // not frames, so it only gets coarser, and the main thread is left to scrolling and taps.
  let gap = 16, updates = 0, coarse = false;
  function tick(now: number) {
    if (last && now - last < (coarse ? 30 : 13)) {
      frame = requestAnimationFrame(tick);
      return;
    }
    if (last && now - last < 100 && !coarse && !frozen) {
      gap += (now - last - gap) * 0.08;
      if (++updates > 40 && gap > 26) coarse = true;
    }
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    clock += dt;
    const calm = reduced();
    if (!calm && !frozen) {
      t += dt;
      if (touring && t >= STOPS[idx].dur + PLUS) {
        idx = (idx + 1) % STOPS.length;
        t = 0;
        report();
      }
    }
    const moving = draw(dt, calm);
    timer();
    const playing = !calm && !frozen && (touring || t < STOPS[idx].dur);
    frame = visible && (playing || moving) ? requestAnimationFrame(tick) : 0;
  }
  const run = () => {
    if (!frame && visible) {
      last = 0;
      frame = requestAnimationFrame(tick);
    }
  };
  const io = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1].isIntersecting;
    if (!visible) return;
    if (!started && !reduced()) {
      started = true;
      touring = true;
      idx = 0;
      t = 0;
      report();
    }
    run();
  }, { rootMargin: '120px 0px' });
  io.observe(root);
  // a resized canvas is blank: its next frame is drawn even if the light has not changed
  const ro = new ResizeObserver(() => {
    layer?.fit();
    lit = '';
    run();
  });
  ro.observe(root);

  // the poster, until the figure is on screen: the first step, finished
  for (const k of KEYS) spring[k].x = poseOf(idx, t)[k];
  draw(0, true);
  report();

  return {
    hold(step, sub = 0) {
      clearTimeout(resume);
      if (step < 0) {
        if (reduced()) return;
        resume = window.setTimeout(() => {
          touring = true;
          run();
        }, RESUME * 1000);
        return;
      }
      const i = stopOf(step, sub);
      if (i < 0) return;
      touring = false;
      frozen = false;
      started = true;
      idx = i;
      t = reduced() ? STOPS[i].dur : 0;
      report();
      if (reduced()) draw(0, true);
      run();
    },
    seek(step, sub, time) {
      const i = stopOf(step, sub);
      if (i < 0) return;
      clearTimeout(resume);
      touring = false;
      frozen = true;
      started = true;
      idx = i;
      t = time;
      report();
      draw(0, true);
    },
    destroy() {
      cancelAnimationFrame(frame);
      clearTimeout(resume);
      io.disconnect();
      ro.disconnect();
      layer?.gl.getExtension('WEBGL_lose_context')?.loseContext();
      host.innerHTML = '';
    },
  };
}
