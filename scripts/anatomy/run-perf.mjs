// Performance harness for the "How I work" instrument (docs/device-design.md §32): drives headless Chrome over the DevTools
// protocol (software WebGL, so a GPU-less number is the pessimistic one), emulates a desktop or a phone with a throttled CPU,
// plays scenarios against a running copy of the site (a production build served by `vite preview` is the fair target) and
// reports frame times, main-thread cost, the hottest functions and leaks.
//
//   node scripts/anatomy/run-perf.mjs http://127.0.0.1:5190 [--profile desktop|desktop-4x|mobile|lowend]
//        [--only tour,switch,scroll,resize,idle,rest,leak,list,nogl] [--seconds 30] [--json out.json]
//
// Needs Chrome (CHROME=path to override) and the anatomy skill's chrome-port.mjs (for starting Chrome).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  return at < 0 ? fallback : argv[at + 1];
};
const BASE = argv[0]?.startsWith('http') ? argv[0].replace(/\/$/, '') : 'http://127.0.0.1:5190';
const PROFILE = flag('--profile', 'desktop');
const ONLY = (flag('--only', 'floor,tour,trace,switch,scroll,resize,idle,rest,leak,list,nogl')).split(',');
const SECONDS = Number(flag('--seconds', 0));
const JSON_OUT = flag('--json', null);

const PROFILES = {
  desktop: { w: 1440, h: 900, dpr: 1, mobile: false, cpu: 1 },
  'desktop-4x': { w: 1440, h: 900, dpr: 1, mobile: false, cpu: 4 },
  'mobile-2x': { w: 390, h: 844, dpr: 3, mobile: true, cpu: 2 }, // a fast phone; also the one that does not saturate, so costs can be told apart
  mobile: { w: 390, h: 844, dpr: 3, mobile: true, cpu: 4 }, // a mid-range phone
  lowend: { w: 360, h: 740, dpr: 2.75, mobile: true, cpu: 6 }, // a low-end phone
};
const P = PROFILES[PROFILE];
if (!P) throw new Error(`profile ${PROFILE}?`);
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';

const { chromePort } = await import(pathToFileURL(join(homedir(), '.claude/skills/anatomy/scripts/chrome-port.mjs')).href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- Chrome and the protocol
const profileDir = mkdtempSync(join(tmpdir(), 'run-perf-'));
const chrome = spawn(process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-features=CalculateNativeWinOcclusion', 'about:blank',
]);
const port = await chromePort(chrome, profileDir);
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
let nextId = 0;
const pending = new Map();
const handlers = new Map();
const on = (method, fn) => handlers.set(method, fn);
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (!msg.id) return void handlers.get(msg.method)?.(msg.params);
  const p = pending.get(msg.id);
  pending.delete(msg.id);
  msg.error ? p.rej(new Error(`${p.method}: ${msg.error.message}`)) : p.res(msg.result);
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++nextId;
  pending.set(id, { res, rej, method });
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const finish = () => {
  try { ws.close(); } catch {}
  chrome.kill();
  setTimeout(() => rmSync(profileDir, { recursive: true, force: true }), 500);
};

// What every page gets before its own scripts: a frame recorder, a long-task and long-animation-frame recorder, a context counter.
const HOOK = `(() => {
  const W = (window.__perf = { on: false, frames: [], long: [], loaf: [], run: [], noGl: ${argv.includes('--no-webgl')} });
  let last = 0, running = false;
  const loop = (t) => { if (!W.on) { running = false; last = 0; return; } if (last) W.frames.push(t - last); last = t; requestAnimationFrame(loop); };
  W.start = () => { if (!running) { running = true; last = 0; requestAnimationFrame(loop); } };
  W.reset = () => { W.frames.length = 0; W.long.length = 0; W.loaf.length = 0; };
  try { new PerformanceObserver((l) => { if (W.on) for (const e of l.getEntries()) W.long.push(e.duration); }).observe({ type: 'longtask' }); } catch {}
  try { new PerformanceObserver((l) => { if (W.on) for (const e of l.getEntries()) W.loaf.push({ d: e.duration, block: e.blockingDuration, scripts: e.scripts.map((s) => [(s.sourceFunctionName || s.invoker || '').slice(0, 50), Math.round(s.duration)]) }); }).observe({ type: 'long-animation-frame' }); } catch {}
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    if (/webgl/.test(type) && this.classList.contains('run-gl')) { if (W.noGl) return null; const c = get.call(this, type, ...rest); if (c) W.run.push(new WeakRef(c)); return c; }
    return get.call(this, type, ...rest);
  };
})();`;

await send('Page.enable');
await send('Runtime.enable');
await send('Performance.enable');
await send('Profiler.enable');
await send('HeapProfiler.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
if (argv.includes('--calm')) await send('Page.addScriptToEvaluateOnNewDocument', { source: `document.documentElement.classList.add('motion-off');` }); // the figure holds still: a control for what the page costs without it
const CSS = flag('--css', ''); // rules injected into every page, to try a rendering idea without a rebuild
if (CSS) await send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(CSS)}; document.head.appendChild(s); });` });
async function emulate(w = P.w, h = P.h) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: P.dpr, mobile: P.mobile });
  await send('Emulation.setTouchEmulationEnabled', { enabled: P.mobile });
  await send('Emulation.setCPUThrottlingRate', { rate: P.cpu });
  if (P.mobile) await send('Emulation.setUserAgentOverride', { userAgent: UA });
}
await emulate();

// ---------------------------------------------------------------- measuring
const metricsNow = async () => Object.fromEntries((await send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : 0);
const r1 = (v) => Math.round(v * 10) / 10;

function hotspots(profile, top = 10) {
  const by = new Map();
  const node = new Map(profile.nodes.map((n) => [n.id, n]));
  let total = 0, idle = 0;
  profile.samples.forEach((id, i) => {
    const dt = (profile.timeDeltas[i] ?? 0) / 1000; // ms
    total += dt;
    const n = node.get(id);
    const f = n.callFrame;
    if (f.functionName === '(idle)') return void (idle += dt);
    const file = f.url.split('/').slice(-2).join('/') || '';
    const key = `${f.functionName || '(anon)'}  ${file}:${f.lineNumber + 1}`;
    by.set(key, (by.get(key) ?? 0) + dt);
  });
  const rows = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => ({ fn: k, ms: r1(v) }));
  // who calls the native functions that come out on top: self time by the calling function
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const calls = new Map();
  profile.samples.forEach((id, i) => {
    const n = node.get(id);
    if (!/^(getBoundingClientRect|setAttribute|querySelector|querySelectorAll|getImageData|getComputedStyle)$/.test(n.callFrame.functionName)) return;
    const up = node.get(parent.get(id));
    const key = `${n.callFrame.functionName} <- ${up?.callFrame.functionName || '(root)'} ${(up?.callFrame.url || '').split('/').slice(-1)[0]}:${(up?.callFrame.lineNumber ?? 0) + 1}`;
    calls.set(key, (calls.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
  });
  const callers = [...calls.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => ({ fn: k, ms: r1(v) }));
  const own = (re) => r1([...by.entries()].filter(([k]) => re.test(k)).reduce((a, [, v]) => a + v, 0));
  // the figure and the kit are one lazy chunk (live-*.js); the accordion is in the main chunk
  return { total: r1(total), idle: r1(idle), busy: r1(total - idle), figure: own(/assets\/live-/), rows, callers };
}

/** Runs `action` (or waits `seconds`) while recording; returns the numbers. collect = false leaves the frame recorder off (an idle test must not drive frames itself). */
async function measure(label, seconds, action, { collect = true } = {}) {
  await send('HeapProfiler.collectGarbage');
  const m0 = await metricsNow();
  await ev(`window.__perf.reset(); window.__perf.on = ${collect}; ${collect ? 'window.__perf.start();' : ''} true`);
  await send('Profiler.setSamplingInterval', { interval: 250 });
  await send('Profiler.start');
  const t0 = Date.now();
  if (action) await action();
  else await sleep(seconds * 1000);
  const secs = (Date.now() - t0) / 1000;
  const { profile } = await send('Profiler.stop');
  const snap = await ev(`(() => { const W = window.__perf; W.on = false; return { frames: W.frames.slice(), long: W.long.slice(), loaf: W.loaf.slice() }; })()`);
  const m1 = await metricsNow();
  const f = snap.frames.slice().sort((a, b) => a - b);
  const d = (k) => (m1[k] - m0[k]) / secs;
  const out = {
    label, secs: r1(secs),
    fps: collect ? r1(snap.frames.length / secs) : null,
    frame_ms: collect ? { p50: r1(pct(f, 50)), p95: r1(pct(f, 95)), p99: r1(pct(f, 99)), max: r1(f[f.length - 1] ?? 0) } : null,
    over25: f.filter((x) => x > 25).length, over50: f.filter((x) => x > 50).length, over100: f.filter((x) => x > 100).length,
    jank_ms_per_s: collect ? r1(f.reduce((a, x) => a + Math.max(0, x - 16.7), 0) / secs) : null,
    longtasks: snap.long.length, longest_task: r1(Math.max(0, ...snap.long)),
    loaf: snap.loaf.length, worst_loaf: snap.loaf.sort((a, b) => b.d - a.d).slice(0, 2),
    main_thread_busy_pct: r1(d('TaskDuration') * 100),
    net_busy_pct: floorBusy === null ? null : r1((d('TaskDuration') - floorBusy) * 100),
    net_ms_per_frame: collect && floorBusy !== null ? r1(((d('TaskDuration') - floorBusy) * 1000) / (snap.frames.length / secs)) : null,
    ms_per_frame: collect ? r1((d('TaskDuration') * 1000) / (snap.frames.length / secs)) : null, script_pct: r1(d('ScriptDuration') * 100),
    style_ms_per_s: r1(d('RecalcStyleDuration') * 1000), layout_ms_per_s: r1(d('LayoutDuration') * 1000),
    style_per_s: Math.round(d('RecalcStyleCount')), layouts_per_s: Math.round(d('LayoutCount')),
    heap_mb_delta: r1((m1.JSHeapUsedSize - m0.JSHeapUsedSize) / 1048576), nodes: m1.Nodes, listeners: m1.JSEventListeners,
    hot: hotspots(profile),
  };
  return out;
}

let floorBusy = null; // main-thread seconds per second the site costs on its own with About open (set by the floor scenario)
let boot = 0; // seconds the site's own start-up kept the main thread busy before it went quiet
/** Waits until the main thread has been under 40 % busy for two seconds in a row (the site bakes textures after it loads; on its own with About open it sits at 25 to 30 % at a 4x throttle). */
async function settle(maxSec = 40) {
  const t0 = Date.now();
  let quiet = 0;
  while ((Date.now() - t0) / 1000 < maxSec) {
    const a = await metricsNow();
    await sleep(1000);
    const b = await metricsNow();
    const busy = (b.TaskDuration - a.TaskDuration) / (b.Timestamp - a.Timestamp || 1);
    quiet = busy < 0.4 ? quiet + 1 : 0;
    if (quiet >= 2) break;
  }
  boot = Math.round((Date.now() - t0) / 1000);
}
let fresh = false; // the About page is already loaded: later scenarios close it and open it again (a fresh figure, no reload of the site)
// Reopening the page inside a loaded site makes the site resume its own heavy work (minutes at a throttled CPU), so every scenario but the leak test loads the page fresh.
async function open(url = `${BASE}/#/about`, before = '', reload = true) {
  if (fresh && !reload) {
    await ev(`(() => { document.querySelector('.dt-close')?.click(); return true; })()`);
    await sleep(500);
    await ev(`location.hash = ''; true`);
    await sleep(200);
    await ev(`location.hash = '#/about'; true`);
  } else {
    await send('Page.navigate', { url: 'about:blank' });
    await sleep(200);
    const added = before ? (await send('Page.addScriptToEvaluateOnNewDocument', { source: before })).identifier : null;
    await send('Page.navigate', { url });
    if (added) setTimeout(() => send('Page.removeScriptToEvaluateOnNewDocument', { identifier: added }).catch(() => {}), 4000);
    fresh = url === `${BASE}/#/about`;
  }
  await ev(`new Promise((res, rej) => { const t0 = Date.now(); const f = () => document.querySelector('.run-stage') ? res(true) : Date.now() - t0 > 60000 ? rej(new Error('figure never mounted')) : setTimeout(f, 100); f(); })`);
  await settle();
}
const reveal = async (list = false) => {
  await ev(`(() => { (document.getElementById('${list ? 'lv-how' : 'dt-s-how'}')).scrollIntoView(); return true; })()`);
  await sleep(2500); // the tour starts when the figure is seen
};

async function traced(seconds) {
  const chunks = [];
  let done;
  const complete = new Promise((r) => (done = r));
  on('Tracing.tracingComplete', (e) => done(e.stream));
  await send('Tracing.start', { transferMode: 'ReturnAsStream', traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.execute'] } });
  await ev(`window.__perf.reset(); window.__perf.on = true; window.__perf.start(); true`);
  await sleep(seconds * 1000);
  await ev(`window.__perf.on = false; true`);
  await send('Tracing.end');
  const stream = await complete;
  for (;;) {
    const r = await send('IO.read', { handle: stream, size: 1 << 20 });
    chunks.push(r.data);
    if (r.eof) break;
  }
  await send('IO.close', { handle: stream });
  const events = JSON.parse(chunks.join('')).traceEvents ?? [];
  // the page's main thread: the one that fires animation frames the most
  const frames = new Map();
  for (const e of events) if (e.name === 'FireAnimationFrame') frames.set(`${e.pid}:${e.tid}`, (frames.get(`${e.pid}:${e.tid}`) ?? 0) + 1);
  const [main] = [...frames.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const by = new Map();
  let span = 0;
  for (const e of events) {
    if (`${e.pid}:${e.tid}` !== main || e.ph !== 'X' || !e.dur) continue;
    by.set(e.name, (by.get(e.name) ?? 0) + e.dur / 1000);
    if (e.name === 'RunTask') span += e.dur / 1000;
  }
  const rows = [...by.entries()].filter(([n]) => !/^(RunTask|ThreadControllerImpl::RunTask|RunMicrotasks)$/.test(n)).sort((a, b) => b[1] - a[1]).slice(0, 14);
  return { seconds, tasksMs: r1(span), nFrames: frames.get(main) ?? 0, rows: rows.map(([n, v]) => ({ name: n, ms: r1(v), perSec: r1(v / seconds) })) };
}

// ---------------------------------------------------------------- scenarios
const results = [];
const SCEN = {
  async floor() {
    await open();
    await reveal();
    await ev(`(() => { document.querySelector('.dt-scroll').scrollTop = 0; return true; })()`);
    await sleep(2000);
    const r = await measure('floor: the site on its own with About open, figure off screen', SECONDS || 8, null, { collect: false });
    floorBusy = r.main_thread_busy_pct / 100;
    return r;
  },
  async tour() {
    await open();
    await reveal();
    return measure('tour (the 9 stops, in order)', SECONDS || 52);
  },
  async switch() {
    await open();
    await reveal();
    return measure('rapid switching (a step or sub-step every 110 ms)', 0, () =>
      ev(`(async () => { const hs = [...document.querySelectorAll('.dt-wf .wf-hd')], ss = [...document.querySelectorAll('.dt-wf .wf-sh')]; const end = performance.now() + ${(SECONDS || 20) * 1000}; while (performance.now() < end) { const pool = Math.random() < 0.3 ? ss : hs; pool[Math.floor(Math.random() * pool.length)].click(); await new Promise((r) => setTimeout(r, 110)); } return true; })()`));
  },
  async scroll() {
    await open();
    await reveal();
    return measure('scrolling the page while the tour plays', 0, () =>
      ev(`(async () => { const sc = document.querySelector('.dt-scroll'); const max = sc.scrollHeight - sc.clientHeight; const end = performance.now() + ${(SECONDS || 20) * 1000}; const t0 = performance.now(); while (performance.now() < end) { await new Promise(requestAnimationFrame); const x = (Math.sin((performance.now() - t0) / 1800) + 1) / 2; sc.scrollTop = x * max; } return true; })()`));
  },
  async resize() {
    await open();
    await reveal();
    const widths = P.mobile ? [390, 430, 360, 412, 375] : [1440, 1100, 820, 600, 390, 1280];
    return measure('resizing the window every 600 ms', 0, async () => {
      const end = Date.now() + (SECONDS || 15) * 1000;
      for (let i = 0; Date.now() < end; i++) {
        await emulate(widths[i % widths.length], P.h);
        await sleep(600);
      }
      await emulate();
    });
  },
  async idle() {
    await open();
    await reveal();
    await ev(`(() => { document.querySelector('.dt-scroll').scrollTop = 0; return true; })()`); // the figure is off screen: it should rest
    await sleep(2000);
    return measure('idle: figure scrolled off screen', SECONDS || 8, null, { collect: false });
  },
  async rest() {
    await open();
    await reveal();
    await ev(`(() => { document.querySelectorAll('.dt-wf .wf-hd')[5].click(); return true; })()`); // Ship, held: it plays once and rests
    await sleep(10000);
    return measure('rest: a held step after it has finished', SECONDS || 8, null, { collect: false });
  },
  async nogl() {
    await open(`${BASE}/#/about`, 'window.__perf && (window.__perf.noGl = true);', true);
    await reveal();
    const r = await measure('tour without WebGL (the SVG bead)', SECONDS || 30);
    fresh = false; // this page has WebGL off: the next scenario loads a new one
    return r;
  },
  async list() {
    await send('Page.navigate', { url: 'about:blank' });
    await sleep(200);
    await send('Page.navigate', { url: `${BASE}/` });
    await sleep(500);
    await ev(`localStorage.setItem('dean-view', 'list'); true`);
    await open(`${BASE}/`, '', true);
    // the List view's own floor (the page with the figure off screen), not About's
    await sleep(1500);
    const fl = await measure('list floor', 6, null, { collect: false });
    const keep = floorBusy;
    floorBusy = fl.main_thread_busy_pct / 100;
    await reveal(true);
    const r = await measure(`List view: the tour in the page   [the List view's own floor ${fl.main_thread_busy_pct}%]`, SECONDS || 30);
    floorBusy = keep;
    await ev(`localStorage.removeItem('dean-view'); true`);
    return r;
  },
  async listtrace() {
    await send('Page.navigate', { url: `${BASE}/` });
    await sleep(500);
    await ev(`localStorage.setItem('dean-view', 'list'); true`);
    await open(`${BASE}/`, '', true);
    await reveal(true);
    const t = await traced(SECONDS || 20);
    await ev(`localStorage.removeItem('dean-view'); true`);
    return { label: 'trace in the List view', trace: t };
  },
  async trace() {
    await open();
    await reveal();
    const t = await traced(SECONDS || 20);
    return { label: 'trace: where the main thread spends the time (inclusive; events nest)', trace: t };
  },
  async leak() {
    await open(undefined, '', true);
    await reveal();
    const snap = async () => {
      await send('HeapProfiler.collectGarbage');
      const m = await metricsNow();
      const dom = await send('Memory.getDOMCounters');
      const live = await ev(`window.__perf.run.filter((r) => { const g = r.deref(); return g && !g.isContextLost(); }).length`);
      const canv = await ev(`document.querySelectorAll('canvas').length`);
      return { heap_mb: r1(m.JSHeapUsedSize / 1048576), nodes: dom.nodes, listeners: dom.jsEventListeners, glLive: live, canvases: canv, glMade: await ev(`window.__perf.run.length`) };
    };
    const cycle = async () => {
      await ev(`document.querySelector('.dt-close').click(); true`);
      await sleep(450);
      await ev(`location.hash = '#/about'; true`);
      await ev(`new Promise((res) => { const f = () => document.querySelector('.dt-wf .run-stage') ? res(true) : setTimeout(f, 50); f(); })`);
      await ev(`document.getElementById('dt-s-how').scrollIntoView(); true`);
      await sleep(600);
    };
    for (let i = 0; i < 3; i++) await cycle(); // warm up
    const before = await snap();
    const N = 30;
    for (let i = 0; i < N; i++) await cycle();
    const after = await snap();
    return { label: `leak: ${N} open/close cycles of the About page`, before, after, delta: Object.fromEntries(Object.keys(before).map((k) => [k, r1(after[k] - before[k])])) };
  },
};

// ---------------------------------------------------------------- run and report
console.log(`profile ${PROFILE}: ${P.w}x${P.h} @${P.dpr}x, CPU x${P.cpu}${P.mobile ? ', touch' : ''}   target ${BASE}\n`);
for (const name of ONLY) {
  if (!SCEN[name]) continue;
  process.stdout.write(`… ${name}\n`);
  try {
    const r = await SCEN[name]();
    results.push({ profile: PROFILE, scenario: name, ...r });
    if (r.trace) {
      console.log(`  ${r.label}\n  main-thread tasks ${r.trace.tasksMs} ms over ${r.trace.seconds} s (${r1((r.trace.tasksMs / (r.trace.seconds * 10)))}% busy), ${r.trace.nFrames} animation frames`);
      for (const x of r.trace.rows) console.log(`    ${String(x.ms).padStart(8)} ms  ${String(x.perSec).padStart(7)} ms/s  ${x.name}`);
      console.log('');
    } else if (r.fps !== undefined) {
      console.log(`  ${r.label}   [site start-up work before this: ${boot} s]`);
      console.log(`  fps ${r.fps ?? '-'}   frame ms p50 ${r.frame_ms?.p50 ?? '-'} p95 ${r.frame_ms?.p95 ?? '-'} p99 ${r.frame_ms?.p99 ?? '-'} max ${r.frame_ms?.max ?? '-'}   >25ms ${r.over25}  >50ms ${r.over50}  >100ms ${r.over100}   jank ${r.jank_ms_per_s ?? '-'} ms/s`);
      if (r.net_busy_pct !== null) console.log(`  minus the site's own floor: figure ≈ ${r.net_busy_pct}% of the thread${r.net_ms_per_frame !== null ? `, ${r.net_ms_per_frame} ms per frame` : ''}`);
      console.log(`  main thread busy ${r.main_thread_busy_pct}%  script ${r.script_pct}%  style ${r.style_ms_per_s} ms/s (${r.style_per_s}/s)  layout ${r.layout_ms_per_s} ms/s (${r.layouts_per_s}/s)  long tasks ${r.longtasks} (longest ${r.longest_task} ms)  LoAF ${r.loaf}`);
      console.log(`  per frame: ${r.ms_per_frame ?? '-'} ms of main thread (at 60 fps that is ${r.ms_per_frame ? r1(r.ms_per_frame * 6) : '-'}% of the thread)`);
      console.log(`  cpu profile: busy ${r.hot.busy} of ${r.hot.total} ms; the figure's chunk ${r.hot.figure} ms`);
      for (const h of r.hot.rows.slice(0, 7)) console.log(`    ${String(h.ms).padStart(7)} ms  ${h.fn}`);
      if (r.hot.callers.length) console.log(`  callers: ${r.hot.callers.map((c) => `${c.fn} ${c.ms} ms`).join('  |  ')}`);
      if (r.worst_loaf.length) console.log(`  worst long frames: ${r.worst_loaf.map((l) => `${Math.round(l.d)} ms [${l.scripts.map((s) => s.join(' ')).join('; ')}]`).join('  |  ')}`);
      console.log(`  heap Δ ${r.heap_mb_delta} MB  nodes ${r.nodes}  listeners ${r.listeners}\n`);
    } else {
      console.log(`  ${r.label}\n  before ${JSON.stringify(r.before)}\n  after  ${JSON.stringify(r.after)}\n  delta  ${JSON.stringify(r.delta)}\n`);
    }
  } catch (e) {
    console.log(`  FAILED: ${e.message}\n`);
    results.push({ profile: PROFILE, scenario: name, error: e.message });
  }
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(results, null, 1));
finish();
