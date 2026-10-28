// Cold-load measurement (docs/device-design.md §55): a Brotli-serving static server for a production build (npm run build) and headless Chrome with an empty cache; reports FCP, LCP, when the loader lifts, requests and bytes, long tasks and a CPU profile.
// node scripts/perf/cold-load.mjs <distDir> [--profile desktop|mobile] [--view device|list] [--hash '#/about']
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';
import { extname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const DIST = argv[0];
const flag = (n, d) => (argv.indexOf(n) < 0 ? d : argv[argv.indexOf(n) + 1]);
const PROFILE = flag('--profile', 'desktop'), VIEW = flag('--view', 'device'), HASH = flag('--hash', '');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.json': 'application/json', '.dat': 'application/octet-stream', '.txt': 'text/plain', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.glb': 'model/gltf-binary' };
const cache = new Map();
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(DIST, p);
  if (!existsSync(f) || statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
  const ext = extname(f);
  const raw = readFileSync(f);
  const compress = /\.(html|js|css|svg|json|txt|dat|woff2?)$/.test(ext) && !/woff2$/.test(ext);
  let body = raw;
  const h = { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable', 'accept-ranges': 'none' };
  if (compress && /br/.test(req.headers['accept-encoding'] ?? '')) {
    body = cache.get(f) ?? (cache.set(f, brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } })), cache.get(f));
    h['content-encoding'] = 'br';
  }
  h['content-length'] = body.length;
  res.writeHead(200, h);
  res.end(body);
});
await new Promise((r) => server.listen(5199, '127.0.0.1', r));

const { chromePort } = await import(pathToFileURL(join(homedir(), '.claude/skills/anatomy/scripts/chrome-port.mjs')).href);
const dir = mkdtempSync(join(tmpdir(), 'coldload-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--hide-scrollbars', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', 'about:blank']);
const port = await chromePort(chrome, dir);
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
let id = 0; const pend = new Map(); const ev = [];
ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id) { pend.get(x.id)?.(x.result ?? x.error); pend.delete(x.id); } else ev.push(x); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.value;

const M = PROFILE === 'mobile' ? { w: 390, h: 844, dpr: 3, mobile: true, cpu: 4, net: { down: 1.6e6 / 8, up: 0.75e6 / 8, lat: 150 } } : { w: 1440, h: 900, dpr: 1, mobile: false, cpu: 1, net: null };
await send('Page.enable'); await send('Network.enable'); await send('Runtime.enable'); await send('Performance.enable');
await send('Emulation.setDeviceMetricsOverride', { width: M.w, height: M.h, deviceScaleFactor: M.dpr, mobile: M.mobile });
await send('Emulation.setCPUThrottlingRate', { rate: M.cpu });
if (M.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true });
if (M.net) await send('Network.emulateNetworkConditions', { offline: false, downloadThroughput: M.net.down, uploadThroughput: M.net.up, latency: M.net.lat });
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  ${VIEW === 'list' ? "try { localStorage.setItem('dean-view','list'); } catch {}" : "try { localStorage.removeItem('dean-view'); } catch {}"}
  window.__c = { fcp: 0, lcp: 0, loader: 0, long: [], gl: 0 };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') __c.fcp = e.startTime; }).observe({ type: 'paint', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) __c.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) __c.long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true });
  const mo = new MutationObserver(() => { const l = document.getElementById('loader'); if (!__c.loader && (!l || l.classList.contains('done'))) __c.loader = performance.now(); });
  document.addEventListener('DOMContentLoaded', () => mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] }));
` });
const reqs = new Map();
const t0 = Date.now();
await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 500 }); await send('Profiler.start');
await send('Page.navigate', { url: `http://127.0.0.1:5199/${HASH}` });
const WAIT = M.mobile ? 45 : 14;
await sleep(WAIT * 1000);
const c = await evalJs('JSON.stringify(window.__c)');
const res = await evalJs(`JSON.stringify(performance.getEntriesByType('resource').map((r) => [r.name.replace(location.origin, ''), Math.round(r.transferSize), Math.round(r.decodedBodySize), Math.round(r.responseEnd), r.initiatorType]))`);
const nav = await evalJs(`JSON.stringify(performance.getEntriesByType('navigation')[0] && { dcl: Math.round(performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd), load: Math.round(performance.getEntriesByType('navigation')[0].loadEventEnd) })`);
const m = Object.fromEntries((await send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
const cm = JSON.parse(c), rs = JSON.parse(res);
const lift = cm.loader || 0;
const sum = (list) => Math.round(list.reduce((a, r) => a + r[1], 0) / 1024);
const before = rs.filter((r) => !lift || r[3] <= lift);
const kind = (r) => (/\.js/.test(r[0]) ? 'js' : /\.css/.test(r[0]) ? 'css' : /\.(woff2)/.test(r[0]) ? 'font' : /\.(webp|png|jpg|svg)/.test(r[0]) ? 'img' : /\.(mp4)/.test(r[0]) ? 'video' : /\.(mp3|ogg)/.test(r[0]) ? 'audio' : 'other');
const byKind = {}; for (const r of rs) byKind[kind(r)] = (byKind[kind(r)] ?? 0) + r[1];
console.log(`\n== ${PROFILE} ${VIEW}${HASH ? ' ' + HASH : ''}  (cold cache, brotli${M.net ? ', 1.6 Mbps / 150 ms' : ''}${M.cpu > 1 ? ', CPU x' + M.cpu : ''})`);
console.log(`FCP ${Math.round(cm.fcp)} ms   LCP ${Math.round(cm.lcp)} ms   loader lifted ${lift ? Math.round(lift) + ' ms' : 'not within ' + WAIT + ' s'}   DOMContentLoaded ${JSON.parse(nav).dcl} ms   load ${JSON.parse(nav).load} ms`);
console.log(`requests ${rs.length}   transferred ${sum(rs)} KB   (before the loader lifts: ${before.length} requests, ${sum(before)} KB)`);
console.log('by kind (KB): ' + Object.entries(byKind).map(([k, v]) => `${k} ${Math.round(v / 1024)}`).join('  '));
console.log(`long tasks ${cm.long.length}, total ${cm.long.reduce((a, l) => a + l[1], 0)} ms, longest ${Math.max(0, ...cm.long.map((l) => l[1]))} ms   main thread: script ${Math.round(m.ScriptDuration * 1000)} ms, layout ${Math.round(m.LayoutDuration * 1000)} ms, style ${Math.round(m.RecalcStyleDuration * 1000)} ms, task ${Math.round(m.TaskDuration * 1000)} ms in ${WAIT} s`);
console.log('biggest: ' + rs.slice().sort((a, b) => b[1] - a[1]).slice(0, 6).map((r) => `${r[0].split('/').pop()} ${Math.round(r[1] / 1024)}KB@${r[3]}ms`).join('  '));
const prof = (await send('Profiler.stop')).profile;
const { summarize } = await import(pathToFileURL(join(import.meta.dirname, 'profsummary.mjs')).href);
summarize(prof);
try { ws.close(); } catch {}
chrome.kill(); server.close();
setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} process.exit(0); }, 800);
