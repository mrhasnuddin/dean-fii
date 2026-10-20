#!/usr/bin/env node
// Record a scripted walk through a live landing page and encode it as a muted looping clip (docs/device-design.md §41).
// Headless Chrome over the DevTools protocol: it scrolls the page section by section, holds on each, moves the pointer so
// hover and pointer effects run, and comes back to the top so the loop is seamless. Frames are the browser's own screencast;
// ffmpeg turns them into one MP4 (H.264, plays everywhere) plus a WebP poster.
//
//   node scripts/media/walkthrough.mjs <url> <id> [--shot out.png] [--w 1280] [--h 800] [--fps 30] [--wait 3500] [--click "skip to os"] [--stops 7] [--scroll-to "the keep"]
//
// Outputs (public/media/motion/): <id>.mp4, <id>-poster.webp. With --shot it only saves one screenshot (--scroll-to first
// scrolls to the first heading whose text matches).
// Needs Chrome (CHROME=path to override) and ffmpeg on PATH. Windows, macOS and Linux.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const [url, id] = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--'));
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const CLICK = opt('click', ''), STOPS = +opt('stops', 7), SCROLL_TO = opt('scroll-to', '');
const W = +opt('w', 1280), H = +opt('h', 800), FPS = +opt('fps', 30), SETTLE = +opt('wait', 3500), SHOT = opt('shot', '');
if (!url || !id) {
  console.error('usage: node scripts/media/walkthrough.mjs <url> <id> [--shot out.png]');
  process.exit(1);
}

const chromePath = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p));
if (!chromePath) throw new Error('Chrome not found: set CHROME');

const profile = mkdtempSync(join(tmpdir(), 'walk-profile-'));
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--hide-scrollbars', '--mute-audio',
  '--force-device-scale-factor=1', '--autoplay-policy=no-user-gesture-required', `--window-size=${W},${H}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const port = await new Promise((res, rej) => {
  let t = '';
  const timer = setTimeout(() => rej(new Error('Chrome did not start')), 20000);
  chrome.stderr.on('data', (c) => { t += c; const m = t.match(/ws:\/\/127\.0\.0\.1:(\d+)\//); if (m) { clearTimeout(timer); res(+m[1]); } });
  chrome.on('exit', (c) => rej(new Error(`Chrome exited: ${c}`)));
});
const tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let n = 0;
const waiting = new Map(), listeners = new Map();
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.id) { waiting.get(m.id)?.(m); waiting.delete(m.id); } else listeners.get(m.method)?.(m.params);
};
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++n; waiting.set(i, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
const on = (ev, fn) => listeners.set(ev, fn);
const evaluate = (expression) => send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }).then((r) => r.result.value);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const frames = [];
let work = '';
try {
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const loaded = new Promise((r) => on('Page.loadEventFired', r));
  await send('Page.navigate', { url });
  await Promise.race([loaded, sleep(20000)]);
  await sleep(SETTLE);
  if (CLICK) {
    // An intro to get past: click the first link or button whose text matches, then let the page settle again.
    const hit = await evaluate(`(() => { const re = new RegExp(${JSON.stringify(CLICK)}, 'i'); const el = [...document.querySelectorAll('a,button,[role=button]')].find((e) => re.test(e.textContent)); if (el) el.click(); return !!el; })()`);
    console.log(hit ? `clicked "${CLICK}"` : `no "${CLICK}" found`);
    await sleep(SETTLE);
  }

  if (SHOT) {
    if (SCROLL_TO) {
      await evaluate(`(() => { const re = new RegExp(${JSON.stringify(SCROLL_TO)}, 'i'); const el = [...document.querySelectorAll('h1,h2,h3')].find((e) => re.test(e.textContent)); if (el) scrollTo(0, el.getBoundingClientRect().top + scrollY - 140); })()`);
      await sleep(2200);
    }
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(SHOT, Buffer.from(data, 'base64'));
    console.log('saved', SHOT, await evaluate('document.documentElement.scrollHeight'));
  } else {
    // The choreography runs inside the page on its own clock, so scrolling is as smooth as the page allows.
    const script = `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      const max = () => Math.max(0, document.documentElement.scrollHeight - innerHeight);
      const to = (y, ms) => new Promise((done) => { const y0 = scrollY, t0 = performance.now(); (function f(now) { const k = Math.min(1, (now - t0) / ms); scrollTo(0, y0 + (y - y0) * ease(k)); k < 1 ? requestAnimationFrame(f) : done(); })(t0); });
      const stops = Array.from({ length: ${STOPS} }, (_, i) => (i + 1) / ${STOPS}); // fractions: the page can grow while it plays
      scrollTo(0, 0); await sleep(900);
      for (const f of stops) { await to(Math.round(max() * f), 1100); await sleep(800); }
      await sleep(500);
      await to(0, 1500);
      await sleep(700);
      return stops.length;
    })()`;
    // Pointer drift, so hover and pointer-driven effects run (headless draws no cursor).
    let drifting = true;
    (async () => {
      for (let t = 0; drifting; t += 0.12) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: W * (0.5 + 0.28 * Math.sin(t)), y: H * (0.5 + 0.2 * Math.cos(t * 0.7)) }).catch(() => {});
        await sleep(40);
      }
    })();
    work = mkdtempSync(join(tmpdir(), 'walk-frames-'));
    on('Page.screencastFrame', (p) => {
      send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
      frames.push({ t: p.metadata.timestamp, data: p.data });
    });
    await send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
    const stops = await evaluate(script);
    await send('Page.stopScreencast');
    drifting = false;
    const span = frames[frames.length - 1].t - frames[0].t;
    console.log(`${stops} stops, ${frames.length} frames in ${span.toFixed(1)} s = ${(frames.length / span).toFixed(1)} fps captured`);

    // Frames carry real timestamps: write them as a concat list with each frame's own duration, then resample to FPS.
    const lines = [];
    frames.forEach((f, i) => {
      const file = join(work, `f${String(i).padStart(5, '0')}.jpg`);
      writeFileSync(file, Buffer.from(f.data, 'base64'));
      lines.push(`file '${file.replace(/\\/g, '/')}'`, `duration ${((frames[i + 1]?.t ?? f.t + 1 / FPS) - f.t).toFixed(5)}`);
    });
    lines.push(lines[lines.length - 2]); // the concat demuxer needs the last file repeated
    writeFileSync(join(work, 'list.txt'), lines.join('\n'));
    const out = join(ROOT, 'public', 'media', 'motion');
    mkdirSync(out, { recursive: true });
    const base = ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(work, 'list.txt'), '-vf', `fps=${FPS},scale=${W}:${H},format=yuv420p`, '-an'];
    const run = (a) => { const r = spawnSync('ffmpeg', [...base, ...a], { stdio: 'inherit' }); if (r.status) throw new Error('ffmpeg failed'); };
    run(['-c:v', 'libx264', '-crf', '28', '-preset', 'slow', '-movflags', '+faststart', join(out, `${id}.mp4`)]);
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', join(work, 'f00000.jpg'), '-quality', '82', join(out, `${id}-poster.webp`)], { stdio: 'inherit' });
    console.log('wrote', out);
  }
} finally {
  ws.close();
  chrome.kill();
  await sleep(500);
  for (const d of [profile, work]) if (d) try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* temp */ }
}
