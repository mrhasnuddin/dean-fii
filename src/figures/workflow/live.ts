// The AI-native workflow figure, live (docs/device-design.md §32): Dean's handheld sends each step down the
// cable and the cube makes that move; after the ninth the cube is solved. It plays itself while nobody
// touches it; a step chosen on the page (hover, focus, tap), the D-pad, A/B or the arrow keys takes over.
import '../../vendor/anatomy/iso.css';
import './workflow.css';
import { figureSvg, plateHtml } from '../../vendor/anatomy/iso-kit.mjs';
import { burst, glCamera, glLayer, settle } from '../../vendor/anatomy/gl.mjs';
import { MOVES, MOVE_COUNT, STEPS, cubeAt, endOf, markable, stepOf, turn, type Cubie } from './model.mjs';
import { CABLE, CART_RISE, GL_DATA, H, LCD, P, W, cartDown, cubeSvg, iso3, sceneSvg } from './scene.mjs';

export interface WorkflowOptions {
  /** Hears the step on show: -1 before the brief, then 0–5; `sub` is Framework's sub-step. */
  onStep?: (step: number, sub: number) => void;
  /** While the tour runs: how far through the step on show it is (0–1) and through Framework's sub-step; -1 when not timing. */
  onTimer?: (step: number, sub: number) => void;
  /** The figure's own description for screen readers. */
  label?: string;
}
export interface WorkflowHandle {
  /** Shows step i (its moves played quickly), as the pointer on a step would; -1 lets go. */
  hold(step: number): void;
  destroy(): void;
}

const SEND = 0.62; // s: the pulse runs down the cable before the cube turns
const TWIST = 0.72; // s: one quarter turn
const HAND_TAU = 0.16; // s: the spring the cube follows a step chosen by hand (and the rewind)
const HAND_MAX = 3.2; // moves a second at most, so a long jump stays readable
const HOLD_STEP = 3.1; // s on each step
const HOLD_SUB = 2.3; // s on each of Framework's sub-steps
const HOLD_SHIP = 3.8; // s on the solved cube before it is scrambled again
const RESUME = 3.6; // s after the last touch before the tour comes back

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function mountWorkflow(host: HTMLElement, opts: WorkflowOptions = {}): WorkflowHandle {
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => still.matches || document.documentElement.classList.contains('motion-off');
  const label =
    opts.label ??
    "A handheld console standing in a dock, wired by a cable to a Rubik's cube on a stand. Each step of Dean's workflow is sent from the handheld to the cube, which makes one move; after the last step the cube is solved.";
  const stage = `<div class="wf-stage" tabindex="0" role="group" aria-label="AI-native workflow. Arrow keys step through it.">${figureSvg({
    width: W,
    height: H,
    label,
    body: [sceneSvg().under, '<g data-part="cube"></g><circle class="wf-bead" r="2.2" cx="-9" cy="-9"/>'],
  })}<canvas class="wf-gl" aria-hidden="true"></canvas><span class="wf-sr" role="status" aria-live="polite"></span></div>`;
  host.innerHTML = `<div class="iso wf" data-theme="dark">${plateHtml({ fig: 'Fig 1', title: 'AI-native workflow', hint: 'Hover a step · ◀ ▶', readout: '', body: stage })}</div>`;

  const root = host.querySelector<HTMLElement>('.wf-stage')!;
  const svg = root.querySelector('svg')!;
  const cubeEl = svg.querySelector<SVGGElement>('[data-part="cube"]')!;
  const lcdEl = svg.querySelector<SVGGElement>('[data-part="lcd"]')!;
  const cartEl = svg.querySelector<SVGGElement>('[data-part="cart"]')!;
  const dockLed = svg.querySelector<SVGGElement>('[data-part="dock-led"]')!;
  const bead = svg.querySelector<SVGCircleElement>('.wf-bead')!;
  const readout = host.querySelector<HTMLElement>('[data-readout]')!;
  const status = root.querySelector<HTMLElement>('.wf-sr')!;
  lcdEl.setAttribute('class', 'wf-screen');

  // ------------------------------------------------------------ state
  let cubies: Cubie[] = cubeAt(0);
  let made = 0; // moves done
  let target = 0; // where the hand (or the tour) wants the cube
  // The cube's progress is one continuous number: `pos` moves made, the fraction being the next move's turn so far.
  // The tour plays one move at a time (`tw`: the pulse, then the turn); the hand moves `pos` on a spring toward
  // `target`, so it can stop, speed up or turn back mid-move without a jump.
  let pos = 0, vel = 0;
  let tw: { from: number; t: number; send: number; twist: number } | null = null;
  let touring = !reduced();
  let tourWait = 1.2; // s before the tour's next move
  let held = false;
  let idleTimer = 0;
  let shipAt = -9; // clock time the cube was solved
  let clock = 0;
  const cart = { x: CART_RISE, v: 0 };
  let restSvg = '';
  let shownLcd = '';
  // Each finished step plugs one cubie of the layer it turned, with its icon: cubie id → { sticker, step, lit }.
  const marks = new Map<number, { f: number; icon: number; on: boolean }>();
  const byStep: number[] = STEPS.map(() => -1);
  // The step on show has its cubie pulled right out of the cube; it goes home when the next step starts,
  // before any layer turns. x runs 0 (home) to 1 (out), on a critically damped spring.
  let out: { id: number; x: number; v: number; goal: number } | null = null;
  const OUT_DIST = 31; // a cubie's length (21.2) and a clear gap
  let restKey = '';
  let cubeShown = '';
  const stepEnding = (m: number) => STEPS.findIndex((_, i) => endOf(i) === m); // the step whose last move is m, or -1
  /** Plugs step s into a cubie of the face move m turned (one whose sticker faces the viewer once solved). */
  function place(s: number, list: Cubie[], m: number) {
    const options = markable(list, m, new Set(marks.keys()));
    const pick = options[Math.floor(Math.random() * options.length)];
    if (!pick) return -1;
    marks.set(pick.id, { f: pick.f, icon: s, on: false });
    byStep[s] = pick.id;
    return pick.id;
  }
  function unplug(s: number) {
    marks.delete(byStep[s]);
    byStep[s] = -1;
  }
  /** Pulls out the cubie of the step that ends at `m` moves, if any (already out under reduced motion). */
  function pullOut(m: number) {
    const s = stepEnding(m);
    out = s >= 0 && byStep[s] >= 0 ? { id: byStep[s], x: reduced() ? 1 : 0, v: 0, goal: 1 } : null;
  }
  let litStep = -2;
  /** Lights the cubie of the step on show (its sticker's outline), so the pill and its cubie read as one. */
  function light(step: number) {
    if (step === litStep) return;
    litStep = step;
    for (const mk of marks.values()) mk.on = mk.icon === step;
    restSvg = '';
  }

  // ------------------------------------------------------------ drawing
  function drawCube() {
    const lift = out && out.x > 0.002 ? { id: out.id, by: OUT_DIST * out.x } : null;
    const frac = pos - made;
    if (frac > 1e-4 && made < MOVE_COUNT) {
      const move = MOVES[made];
      cubeEl.innerHTML = cubeSvg(cubies, move, move[1] * (Math.PI / 2) * frac, marks, lift);
      cubeShown = '';
      return;
    }
    const key = lift ? `${lift.id}:${lift.by.toFixed(2)}` : '';
    if (!restSvg || key !== restKey) (restSvg = cubeSvg(cubies, null, 0, marks, lift)), (restKey = key);
    if (cubeShown !== restSvg) cubeEl.innerHTML = cubeShown = restSvg; // only when it changed
  }

  const pad2 = (n: number) => String(n).padStart(2, '0');
  function lcdFor(m: number) {
    const lines = { head: 'STEP --/06', title: 'READY', line: 'NEW BRIEF', filled: 0, part: 0 };
    if (m > 0) {
      const { step, sub } = stepOf(m);
      const s = STEPS[step];
      lines.head = `STEP ${pad2(step + 1)}/06`;
      lines.title = s.title;
      lines.line = s.subs ? `${sub + 1}/4 ${s.subs[sub]}` : s.line;
      lines.filled = step;
      lines.part = s.subs ? (sub + 1) / s.subs.length : 1;
    }
    return lines;
  }
  function drawLcd(m: number, flicker = true) {
    const l = lcdFor(m);
    const key = JSON.stringify(l);
    if (key === shownLcd) return;
    shownLcd = key;
    // face coordinates: x right, y down; the window spans LCD.x0..x1 and -LCD.y1..-LCD.y0
    const left = LCD.x0 + 3, top = -LCD.y1;
    const seg = (LCD.x1 - LCD.x0 - 6 - 5 * 1.2) / 6;
    const bars = Array.from({ length: 6 }, (_, i) => {
      const x = left + i * (seg + 1.2);
      const fill = i < l.filled ? 1 : i === l.filled && m > 0 ? l.part : 0;
      return `<rect class="wf-seg" x="${x.toFixed(2)}" y="${(top + 31).toFixed(2)}" width="${seg.toFixed(2)}" height="2.6"/>${fill > 0 ? `<rect class="wf-seg-on" x="${x.toFixed(2)}" y="${(top + 31).toFixed(2)}" width="${(seg * fill).toFixed(2)}" height="2.6"/>` : ''}`;
    }).join('');
    lcdEl.innerHTML = `<g class="wf-lcd-in">
      <text class="wf-t-small" x="${left}" y="${top + 7.4}">${l.head}</text>
      <text class="wf-t-big" x="${left}" y="${top + 18.4}">${l.title}</text>
      <text class="wf-t-small" x="${left}" y="${top + 26}">${l.line}</text>${bars}</g>`;
    if (flicker && !reduced()) {
      lcdEl.classList.remove('wf-refresh');
      void lcdEl.getBoundingClientRect();
      lcdEl.classList.add('wf-refresh'); // the panel redraws: a short flicker, like a cheap LCD
    }
  }

  function say(m: number, scrambling = false) {
    const text = scrambling ? 'scrambling · new brief' : m === 0 ? 'ready · 0 / 9 moves' : m === MOVE_COUNT ? 'solved · shipped' : (() => {
      const { step, sub } = stepOf(m);
      const s = STEPS[step];
      return `${s.title.toLowerCase()}${s.subs ? ` ${sub + 1}/4` : ''} · move ${m} / 9`;
    })();
    if (readout.textContent !== text) readout.textContent = text;
  }

  let lastStep = -2, lastSub = -1;
  function report(m: number) {
    const { step, sub } = m === 0 ? { step: -1, sub: 0 } : stepOf(m);
    if (step === lastStep && sub === lastSub) return;
    lastStep = step;
    lastSub = sub;
    opts.onStep?.(step, sub);
  }

  // ------------------------------------------------------------ the cable's pulse (WebGL, or an SVG bead)
  const route = CABLE.points;
  const lengths = [0];
  for (let i = 1; i < route.length; i++) lengths.push(lengths[i - 1] + Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1], route[i][2] - route[i - 1][2]));
  const total = lengths[lengths.length - 1];
  function along(f: number): number[] {
    const d = Math.min(Math.max(f, 0), 1) * total;
    let i = 1;
    while (i < lengths.length - 1 && lengths[i] < d) i++;
    const t = (d - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1);
    return route[i - 1].map((v, a) => v + (route[i][a] - v) * t);
  }

  const FRAGMENT = `
uniform vec4 uPulse;   // xyz the bead, w its strength
uniform float uShip;   // the solved glow
uniform float uLcd;    // the screen's backlight
uniform vec3 uLo; uniform vec3 uLu; uniform vec3 uLv; uniform vec3 uLn; uniform vec3 uLh; // lcd plane, half size, radius
uniform vec4 uRing;    // xyz centre, w radius
uniform vec3 uCube;
const vec3 GOLD=vec3(.89,.80,.60);
float sdRound(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}
float boxHit(vec3 o,vec3 d,vec3 c,float h){vec3 inv=1./d;vec3 t0=(c-h-o)*inv,t1=(c+h-o)*inv;vec3 lo=min(t0,t1),hi=max(t0,t1);float a=max(max(lo.x,lo.y),lo.z),b=min(min(hi.x,hi.y),hi.z);return step(0.,b)*step(a,b);}
void main(){
  vec2 vb=viewOf(gl_FragCoord.xy);
  vec3 V=towardViewer();
  vec3 col=vec3(0.);
  // the screen's backlight: faint inside the window, a little bloom onto the bezel
  if(uLcd>.001){
    float dn=dot(uLn,V);
    vec3 p0=rayOf(vb);
    float t=dot(uLo-p0,uLn)/dn;
    vec3 q=p0+t*V-uLo;
    vec2 uv=vec2(dot(q,uLu),dot(q,uLv));
    float d=sdRound(uv,uLh.xy,uLh.z);
    float inside=1.-smoothstep(-.6,.6,d);
    float bloom=exp(-max(d,0.)*max(d,0.)/6.)*(1.-inside);
    col+=GOLD*uLcd*(inside*.07+bloom*.10);
  }
  // the bead: a small bright core, a soft halo, and the light it throws on the mat
  if(uPulse.w>.001){
    float d=length(vb-project(uPulse.xyz))/uK;
    vec3 f=onFloor(vb,0.);
    float pool=exp(-dot(f.xy-uPulse.xy,f.xy-uPulse.xy)/90.);
    col+=GOLD*uPulse.w*(1.3*exp(-d*d/2.2)+.38*exp(-d*d/26.)+.16*pool);
  }
  // solved: the stand's light ring and a pool on the mat, hidden where the cube is in front
  if(uShip>.001){
    vec3 f=onFloor(vb,uRing.z);
    float r=length(f.xy-uRing.xy);
    float behind=boxHit(f,V,uCube,36.);
    float ring=exp(-(r-uRing.w)*(r-uRing.w)/1.6)*(1.-behind);
    vec3 g=onFloor(vb,0.);
    float rg=length(g.xy-uRing.xy);
    float pool=exp(-max(rg-uRing.w-4.,0.)*max(rg-uRing.w-4.,0.)/220.)*smoothstep(uRing.w+1.,uRing.w+5.,rg);
    col+=GOLD*uShip*(ring*1.1+pool*.22);
  }
  col=tonemap(col,1.15);
  float m=max(col.r,max(col.g,col.b));
  float n=(hash12(gl_FragCoord.xy+fract(uTime*.61)*91.)+hash12(gl_FragCoord.yx*1.37+fract(uTime*.37)*57.)-1.)/255.;
  col=max(col+n*smoothstep(0.,1.5/255.,m),0.);
  gl_FragColor=vec4(col,max(col.r,max(col.g,col.b)));
}`;
  const canvas = root.querySelector<HTMLCanvasElement>('.wf-gl')!;
  const L = GL_DATA.lcd;
  const layer = glLayer({
    canvas,
    fragment: FRAGMENT,
    view: [W, H],
    camera: glCamera(P),
    uniforms: ['uPulse', 'uShip', 'uLcd'],
    fixed: { uLo: L.o, uLu: L.u, uLv: L.v, uLn: L.n, uLh: [L.half[0], L.half[1], L.r], uRing: [...GL_DATA.ring.c, GL_DATA.ring.r], uCube: GL_DATA.cube },
    onError: () => {},
  });
  if (layer) root.setAttribute('data-gl', '');
  const lcdLight = { x: 0, v: 0 };
  let glKey = '';

  // ------------------------------------------------------------ motion
  /**
   * Moves the cube to `p` moves made. Each whole move crossed is applied to the model (forward or back): a step
   * finished takes its mark on a cubie of the face it turned, a step undone gives its mark back.
   */
  function setPos(p: number) {
    p = Math.min(MOVE_COUNT, Math.max(0, p));
    while (made < MOVE_COUNT && p >= made + 1 - 1e-6) {
      turn(cubies, MOVES[made]);
      made++;
      const s = stepEnding(made);
      if (s >= 0) place(s, cubies, made);
      litStep = -2;
      restSvg = '';
    }
    while (made > 0 && p < made - 1e-6) {
      made--;
      const move = MOVES[made];
      turn(cubies, [move[0], -move[1]]);
      const s = stepEnding(made + 1);
      if (s >= 0) unplug(s);
      restSvg = '';
    }
    pos = p;
  }
  /** The cube came to rest on a whole move: the step that move ended (if any) has its cubie pulled out. */
  function landed() {
    pos = made;
    vel = 0;
    pullOut(made);
    if (made === MOVE_COUNT) shipAt = clock;
  }
  /** How long the tour holds after move m: a sub-step, a step, or the solved cube. */
  function holdAfter(m: number) {
    const { step } = stepOf(m);
    return STEPS[step].subs && m < endOf(step) ? HOLD_SUB : m === MOVE_COUNT ? HOLD_SHIP : HOLD_STEP;
  }
  // The pills' timer: time spent on the step (and sub-step) on show over that plus the time the tour has left on it.
  let tStep = -2, tSub = -1, stepStart = 0, subStart = 0, timing = false;
  function timer(showing: number, rewinding: boolean) {
    const { step, sub } = showing === 0 ? { step: -1, sub: 0 } : stepOf(showing);
    if (step !== tStep) (tStep = step), (stepStart = clock), (tSub = -1);
    if (sub !== tSub) (tSub = sub), (subStart = clock);
    if (!touring || reduced() || rewinding || step < 0) {
      if (timing) opts.onTimer?.(-1, -1);
      timing = false;
      return;
    }
    const subLeft = tw ? tw.send + tw.twist - tw.t + holdAfter(made + 1) : pos === target ? Math.max(0, Number.isNaN(tourWait) ? 0.6 : tourWait) : 0;
    let left = subLeft;
    for (let m = (tw ? made + 1 : made) + 1; m <= endOf(step); m++) left += SEND + TWIST + holdAfter(m);
    const spent = clock - stepStart, subSpent = clock - subStart;
    timing = true;
    opts.onTimer?.(spent / (spent + left || 1), STEPS[step].subs ? subSpent / (subSpent + subLeft || 1) : -1);
  }
  /** The tour: one move at a time, held a while, then (solved) a pause and a quick rewind to the scramble. */
  function tourStep(dt: number) {
    if (tw || pos !== target) return;
    if (Number.isNaN(tourWait)) tourWait = made === MOVE_COUNT ? HOLD_SHIP : 0.6; // back from the hand: a short beat, or the solved cube's hold
    tourWait -= dt;
    if (tourWait > 0) return;
    if (made === MOVE_COUNT) {
      target = 0; // rewind, on the hand's spring
      tourWait = 1.4;
      return;
    }
    target = made + 1;
    tw = { from: made, t: 0, send: SEND, twist: TWIST };
    if (out) out.goal = 0; // the cubie that is out goes home during the pulse
    tourWait = holdAfter(made + 1);
  }

  let frame = 0, last = 0, visible = false;
  function tick(now: number) {
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    clock += dt;
    const calm = reduced();
    if (touring && !calm) tourStep(dt);
    const rewinding = touring && target < pos;
    let pulse = 0, beadAt: number[] | null = null;
    let outMoving = false;
    if (out) {
      if (pos !== target && !tw) out.goal = 0; // the hand asks for another step: the cubie goes home first
      const quick = !touring || rewinding;
      outMoving = settle(out, out.goal, dt, (out.goal ? 0.14 : 0.08) * (quick ? 0.6 : 1), calm);
      if (!outMoving && out.goal === 0) (out = null), (restSvg = '');
    }
    const blocked = out !== null && out.x > 0.02; // no layer turns until the cubie is home
    if (tw) {
      tw.t += dt;
      if (tw.t > tw.send && blocked) tw.t = tw.send;
      const f = tw.t / tw.send;
      beadAt = along(ease(Math.min(f, 1)));
      pulse = Math.min(1, f * 6) * (f < 1 ? 1 : Math.max(0, 1 - (tw.t - tw.send) / 0.25));
      setPos(tw.from + ease((tw.t - tw.send) / tw.twist));
      if (tw.t >= tw.send + tw.twist) {
        tw = null;
        setPos(target);
        landed();
      }
    } else if (pos !== target && !blocked) {
      if (calm) setPos(target);
      else {
        // a critically damped spring toward the target, its speed capped
        const w = 1 / HAND_TAU;
        vel += (w * w * (target - pos) - 2 * w * vel) * dt;
        vel = Math.max(-HAND_MAX, Math.min(HAND_MAX, vel));
        setPos(pos + vel * dt);
      }
      if (calm || (Math.abs(target - pos) < 0.003 && Math.abs(vel) < 0.05)) {
        setPos(target);
        landed();
      }
    }
    // the screen shows the step being sent from the moment it is sent; a rewind is a fresh start
    const showing = rewinding ? 0 : tw ? tw.from + 1 : touring ? made : target; // by hand: the step asked for
    drawLcd(showing, touring);
    light(showing === 0 ? -1 : stepOf(showing).step);
    drawCube();
    say(showing, rewinding);
    report(showing);
    timer(showing, rewinding);
    // the cartridge goes home once the skills are installed (Framework's first move)
    const cartGoal = showing >= 3 ? 0 : CART_RISE;
    const cartMoving = settle(cart, cartGoal, dt, 0.16, calm);
    cartEl.setAttribute('transform', cartDown(CART_RISE - cart.x));
    dockLed.toggleAttribute('data-on', pulse > 0.05);
    const ship = calm ? (made === MOVE_COUNT ? 0.6 : 0) : made === MOVE_COUNT ? burst(clock - shipAt, 0.12, 1.6) * 0.8 + 0.25 : 0;
    root.toggleAttribute('data-solved', made === MOVE_COUNT);
    settle(lcdLight, 1, dt, 0.5, calm);
    if (layer) {
      const values = { uPulse: beadAt ? [...beadAt, pulse] : [0, 0, 0, 0], uShip: ship, uLcd: lcdLight.x };
      const key = JSON.stringify(values);
      if (key !== glKey) {
        glKey = key;
        layer.draw(values, calm ? 0.8 : clock);
      }
    } else if (beadAt) {
      const [x, y] = iso3(beadAt);
      bead.setAttribute('cx', x.toFixed(1));
      bead.setAttribute('cy', y.toFixed(1));
      bead.style.opacity = String(pulse);
    } else bead.style.opacity = '0';
    const busy = (touring && !calm) || tw !== null || outMoving || pos !== target || cartMoving || lcdLight.x < 1 || (ship > 0.26 && !calm);
    frame = visible && busy ? requestAnimationFrame(tick) : 0;
  }
  const run = () => {
    if (!frame && visible) {
      last = 0;
      frame = requestAnimationFrame(tick);
    }
  };
  const io = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1].isIntersecting;
    if (visible) run();
  }, { rootMargin: '120px 0px' });
  io.observe(root);

  // ------------------------------------------------------------ taking over
  function takeOver() {
    touring = false;
    tw = null; // a tour move in progress carries on under the hand's spring, from where it is
    clearTimeout(idleTimer);
    if (held) return;
    idleTimer = window.setTimeout(() => {
      if (reduced()) return;
      touring = true; // carries on from wherever the hand left it, once any moves it asked for are done
      tourWait = NaN; // decided once the moves the hand asked for are done (tourStep)
      stepStart = subStart = clock; // and its pill times only what is left
      run();
    }, RESUME * 1000);
  }
  function goTo(m: number) {
    target = Math.max(0, Math.min(MOVE_COUNT, m));
    if (reduced()) {
      // no motion: jump there
      tw = null;
      setPos(target);
      landed();
    }
    run();
  }
  function stepBy(d: number) {
    takeOver();
    const { step } = target === 0 ? { step: -1 } : stepOf(target); // from where the cube is headed
    const at = target === 0 ? -1 : target === endOf(step) ? step : step - 1;
    const to = Math.max(-1, Math.min(STEPS.length - 1, at + d));
    goTo(to < 0 ? 0 : endOf(to));
    status.textContent = to < 0 ? 'Ready for a new brief.' : `Step ${to + 1}: ${STEPS[to].title.toLowerCase()}.`;
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') stepBy(1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') stepBy(-1);
    else if (e.key === 'Home') (takeOver(), goTo(0));
    else if (e.key === 'End') (takeOver(), goTo(MOVE_COUNT));
    else return;
    e.preventDefault();
  };
  root.addEventListener('keydown', onKey);
  const onClick = (e: MouseEvent) => {
    const hit = (e.target as Element).closest<SVGGElement>('[data-hit]');
    if (!hit) return;
    const id = hit.dataset.hit;
    if (id === 'a') stepBy(1);
    else if (id === 'b') stepBy(-1);
    else if (id === 'dpad') {
      const box = hit.getBoundingClientRect();
      stepBy(e.clientX < box.left + box.width / 2 ? -1 : 1);
    }
    hit.toggleAttribute('data-press', true);
    setTimeout(() => hit.removeAttribute('data-press'), 140);
    root.focus({ preventScroll: true });
  };
  svg.addEventListener('click', onClick);

  if (reduced()) {
    // a representative still: the solved cube, the last step on the screen
    target = MOVE_COUNT;
    setPos(MOVE_COUNT);
    landed();
    cart.x = 0;
  }
  drawLcd(made);
  drawCube();
  say(made);
  report(made);

  return {
    hold(step) {
      if (step < 0) {
        held = false;
        takeOver();
        return;
      }
      held = true;
      touring = false;
      clearTimeout(idleTimer);
      goTo(endOf(step));
    },
    destroy() {
      cancelAnimationFrame(frame);
      clearTimeout(idleTimer);
      io.disconnect();
      root.removeEventListener('keydown', onKey);
      svg.removeEventListener('click', onClick);
      layer?.gl.getExtension('WEBGL_lose_context')?.loseContext();
      host.innerHTML = '';
    },
  };
}
