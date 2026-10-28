// Functional check of the lazy 3D engine (docs/device-design.md §55): serves a production build with Brotli and drives headless Chrome through the device start, the List start, switching between them and deep links, on desktop or --mobile.
// node scripts/perf/view-flow.mjs <distDir> [--mobile]
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';
import { extname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const DIST = process.argv[2];
const MOBILE = process.argv.includes('--mobile');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.json': 'application/json', '.dat': 'application/octet-stream', '.txt': 'text/plain' };
const cache = new Map();
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(DIST, p);
  if (!existsSync(f) || statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
  const ext = extname(f), raw = readFileSync(f);
  let body = raw;
  const h = { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': 'no-store' };
  if (/\.(html|js|css|svg|json|txt|dat)$/.test(ext) && /br/.test(req.headers['accept-encoding'] ?? '')) {
    body = cache.get(f) ?? (cache.set(f, brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })), cache.get(f));
    h['content-encoding'] = 'br';
  }
  h['content-length'] = body.length;
  res.writeHead(200, h);
  res.end(body);
});
await new Promise((r) => server.listen(5198, '127.0.0.1', r));

const { chromePort } = await import(pathToFileURL(join(homedir(), '.claude/skills/anatomy/scripts/chrome-port.mjs')).href);
const dir = mkdtempSync(join(tmpdir(), 'viewflow-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--hide-scrollbars', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', 'about:blank']);
const port = await chromePort(chrome, dir);
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
let id = 0; const pend = new Map(); let requests = []; let errors = [];
ws.onmessage = (m) => {
  const x = JSON.parse(m.data);
  if (x.id) { pend.get(x.id)?.(x.result ?? x.error); pend.delete(x.id); return; }
  if (x.method === 'Network.requestWillBeSent') requests.push([Date.now(), x.params.request.url.replace('http://127.0.0.1:5198', '')]);
  if (x.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (x.params.exceptionDetails.exception?.description ?? x.params.exceptionDetails.text).split('\n')[0]);
  if (x.method === 'Runtime.consoleAPICalled' && x.params.type === 'error') errors.push('console.error: ' + x.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 160));
  if (x.method === 'Log.entryAdded' && x.params.entry.level === 'error') errors.push('log: ' + x.params.entry.text.slice(0, 160));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval'); return r.result?.value; };
await send('Page.enable'); await send('Network.enable'); await send('Runtime.enable'); await send('Log.enable');
if (MOBILE) { await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await send('Emulation.setTouchEmulationEnabled', { enabled: true }); }
else await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const SETUP = (view) => `try { ${view === 'list' ? "localStorage.setItem('dean-view','list')" : "localStorage.removeItem('dean-view')"}; } catch {}`;
let scriptId = null;
async function load(view, hash = '') {
  if (scriptId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId });
  scriptId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: SETUP(view) })).identifier;
  await send('Page.navigate', { url: 'about:blank' }); await sleep(300);
  requests = []; errors = [];
  await send('Page.navigate', { url: `http://127.0.0.1:5198/${hash}` });
}
const until = async (expr, ms = 90000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(expr).catch(() => false)) return Date.now() - t0; await sleep(150); } return -1; };
const has = (re) => requests.some((r) => re.test(r[1]));
const state = () => js(`JSON.stringify({ list: document.documentElement.classList.contains('is-list'), loader: document.querySelectorAll('.loader').length, canvas: (() => { const c = document.getElementById('webgl'); return c ? c.width + 'x' + c.height : null; })(), detail: !!document.querySelector('.detail[open]'), toggle: document.getElementById('view-toggle')?.getAttribute('aria-checked') })`).then(JSON.parse);
const out = [];
const check = (name, ok, extra = '') => { out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

// ---- A: the device view first (the default)
await load('device');
let t = await until(`!document.getElementById('loader')`);
let s = await state();
check('A device-first: loader lifts', t > 0, `${t} ms`);
check('A device-first: engine chunk and environment fetched', has(/assets\/engine-.*\.js/) && has(/studio-env.*\.dat/));
check('A device-first: the 3D canvas has a size and the page is not in list mode', s.canvas && !s.canvas.startsWith('0x') && !s.list, JSON.stringify(s));
check('A device-first: no errors', errors.length === 0, errors.join(' | '));
const aErr = errors.length;
// switch to the list and back: no new engine request, no cover
requests = [];
await js(`document.getElementById('view-toggle').click(); true`); await sleep(600);
s = await state();
check('A: toggle to list works', s.list && s.toggle === 'true', JSON.stringify(s));
await js(`document.getElementById('view-toggle').click(); true`); await sleep(800);
s = await state();
check('A: toggle back to device is instant (no cover, no new engine request)', !s.list && s.loader === 0 && !has(/engine-|studio-env/), JSON.stringify(s));
check('A: still no errors after switching', errors.length === aErr, errors.join(' | '));

// ---- B: the list view first
await load('list');
t = await until(`!document.getElementById('loader')`, 120000);
s = await state();
check('B list-first: loader lifts', t > 0, `${t} ms`);
check('B list-first: the engine and the environment are NOT fetched', !has(/assets\/engine-/) && !has(/studio-env/), requests.filter((r) => /\.js|\.dat/.test(r[1])).map((r) => r[1].split('/').pop()).join(', '));
check('B list-first: list mode, no 3D canvas size', s.list && (!s.canvas || s.canvas.startsWith('0x') || s.canvas === '300x150'), JSON.stringify(s));
check('B list-first: no errors', errors.length === 0, errors.join(' | '));
// the tab bar and Work with Dean work in list mode before the engine exists
await js(`document.getElementById('hire').click(); true`); await sleep(500);
check('B list-first: "Work with Dean" scrolls to Contact without the engine', !has(/assets\/engine-/), `scrollY ${await js('Math.round(scrollY)')}`);
// first switch to the device
const tClick = Date.now();
await js(`document.getElementById('view-toggle').click(); true`);
await sleep(400);
s = await state();
check('B: switching shows the loader cover at once', s.loader === 1 && !s.list, JSON.stringify(s));
t = await until(`document.querySelectorAll('.loader').length === 0`, 150000);
s = await state();
check('B: the cover lifts and the device view is up', t > 0 && s.canvas && !s.canvas.startsWith('0x') && s.canvas !== '300x150' && !s.list, `${Date.now() - tClick} ms after the click; ${JSON.stringify(s)}`);
check('B: the engine and the environment were fetched by the switch', has(/assets\/engine-/) && has(/studio-env/));
check('B: no errors through the switch', errors.length === 0, errors.join(' | '));
requests = [];
await js(`document.getElementById('view-toggle').click(); true`); await sleep(600);
await js(`document.getElementById('view-toggle').click(); true`); await sleep(800);
s = await state();
check('B: a second switch is instant', !s.list && s.loader === 0 && !has(/engine-|studio-env/), JSON.stringify(s));

// ---- C: a deep link in the list view, and the engine afterwards
await load('list', '#/about');
t = await until(`!document.getElementById('loader') && !!document.querySelector('.detail[open]')`, 120000);
s = await state();
check('C list + #/about: the panel opens without the engine', t > 0 && s.detail && !has(/assets\/engine-/), `${t} ms ${JSON.stringify(s)}`);
await js(`document.querySelector('.dt-close').click(); true`); await sleep(700);
await js(`document.getElementById('view-toggle').click(); true`);
t = await until(`document.querySelectorAll('.loader').length === 0`, 150000);
s = await state();
check('C: after closing the panel, switching to the device works', t > 0 && !s.list && s.canvas && s.canvas !== '300x150', JSON.stringify(s));
check('C: no errors', errors.length === 0, errors.join(' | '));

// ---- D: a deep link in the device view
await load('device', '#/work/kairma');
t = await until(`!document.getElementById('loader') && !!document.querySelector('.detail[open]')`, 120000);
s = await state();
check('D device + #/work/kairma: the project panel opens', t > 0 && s.detail && has(/assets\/engine-/), `${t} ms`);
check('D: no errors', errors.length === 0, errors.join(' | '));

console.log(`\n${MOBILE ? 'mobile' : 'desktop'} flows\n` + out.join('\n'));
try { ws.close(); } catch {}
chrome.kill(); server.close();
setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} process.exit(out.some((l) => l.startsWith('FAIL')) ? 1 : 0); }, 800);
