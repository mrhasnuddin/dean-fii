// DeanFi3 entry: one page, one wallet (docs/device-design.md §10). Two places, no footer: the Hero
// and the Console. Scroll only moves between them; in the Console the wallet's top tabs, the on-page tab bar,
// keys 1–4 and deep links choose the section. The e-ink screen, ✓ and Back drive the content;
// details open in a panel with shareable hash routes (#/work/:id, #/stage/:id, #/about; legacy
// #/tools → About). A List view shows everything as a plain page, without 3D.
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/hanken-grotesk';
import '@fontsource-variable/jetbrains-mono';
import './styles/site.css';
import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { createStage } from './scene/stage';
import { createChoreography, TABS, type TabId } from './scene/choreography';
import { createControls, type Controls } from './scene/controls';
import { createContactSequence, type ContactSequence } from './scene/contactSequence';
import { createMemorySequence } from './scene/memorySequence';
import { createPower } from './scene/power';
import { createTips } from './scene/tips';
import { createVolumePill, usePill, type VolumePill } from './scene/volumePill';
import { createDetail, type DetailTarget } from './ui/detail';
import type { ScreenIntent, WorksPage } from './ui/screen';
import { buildListView, storeView, storedView, type ViewMode } from './ui/listView';
import { apps, events, profile, projects } from './content/portfolio';
import { contact, emailAddress, mailtoHref, whatsappHref } from './content/contact';
import { copyText } from './ui/clipboard';
import { motion } from './motion';
import { sfx } from './audio/sfx';
import { music } from './audio/music';
import { volume } from './audio/volume';
import { loadBakedEnvironment } from './device/studioEnvironment';
import type { Sticker } from './device/stickers';

const studioEnv = loadBakedEnvironment(); // fetched and decoded while the rest of the page sets up
gsap.registerPlugin(ScrollTrigger);

const hero = document.getElementById('hello')!;
const consoleEl = document.getElementById('console')!;
const listEl = document.getElementById('list-view')!;
const live = document.getElementById('live')!;
const announce = (msg: string) => {
  live.textContent = '';
  requestAnimationFrame(() => (live.textContent = msg));
};

// ---------------------------------------------------------------- page content (DOM twins of the screen)
// About: both lines (the Hero already says the roles). Phones show only the second: the first is
// close to the Hero's own line, which sits one scroll above.
{
  const lead = document.createElement('span');
  lead.className = 'bio-lead';
  lead.textContent = `${profile.bio[0]} `;
  document.querySelector('[data-bio]')!.append(lead, profile.bio.slice(1).join(' '));
}
document.querySelector('[data-list="works"]')!.innerHTML = [...projects, ...apps].map((p) => `<li><a href="#/work/${p.id}">${p.title}</a></li>`).join('');
document.querySelector('[data-list="chronicle"]')!.innerHTML = events.map((e) => `<li><a href="#/stage/${e.id}">${e.place}: ${e.title}</a></li>`).join('');

// ---------------------------------------------------------------- smooth scroll + Hero ↔ Console snap
let controls: Controls | null = null;
let volumePill: VolumePill | null = null; // docs §40: the touch stand-in for the knob
let qrOpen: Sticker | null = null; // the back sticker whose QR is showing (see showQr)
let lenis: Lenis | null = null;
let view: ViewMode = 'device';
function startLenis() {
  if (lenis || motion.reduced()) return;
  lenis = new Lenis({ autoRaf: false, virtualScroll: () => !controls?.wheelConsumed() });
  lenis.on('scroll', ScrollTrigger.update);
  lenis.on('scroll', queueSnap);
}
gsap.ticker.add((t) => lenis?.raf(t * 1000));
gsap.ticker.lagSmoothing(0);
// `force`: a panel may be closing in the same click (Invite, Work with Dean) with Lenis still stopped.
function scrollToEl(el: HTMLElement | number, done?: () => void, immediate = false) {
  // Honour scroll-margin-top (List view sections clear the fixed header with it); Lenis ignores it.
  const margin = typeof el === 'number' ? 0 : parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  if (lenis) lenis.scrollTo(el, { offset: -margin, duration: 1.1, force: true, immediate, onComplete: () => done?.() });
  else {
    const y = typeof el === 'number' ? el : el.getBoundingClientRect().top + scrollY - margin;
    scrollTo({ top: y, behavior: immediate || motion.reduced() ? 'auto' : 'smooth' });
    if (done) setTimeout(done, immediate || motion.reduced() ? 0 : 900);
  }
}
// Between the Hero and the Console there is no resting place: when the scroll settles in between,
// finish the move in the direction it was going. The Console is the end of the page.
// "At the Console" is the Console's top OR the end of the page, whichever comes first: on a phone the
// places are 100svh tall, and once the address bar hides the viewport is taller than that, so the page
// ends 50–100 px before the Console's top. A small drift (a finger settling on the wallet, the address
// bar coming back) goes back to where the page rested; only a real scroll (over SNAP_DEADZONE) changes
// place. Before both, any scroll event at all, such as a tap on the wallet, sent a phone back to the Hero.
const SNAP_DEADZONE = 48; // px
let snapTimer = 0;
let restAt: 'hero' | 'console' = 'hero';
let restY = 0;
function queueSnap() {
  clearTimeout(snapTimer);
  snapTimer = window.setTimeout(() => {
    if (!lenis || view === 'list' || detail.isOpen() || lenis.isScrolling) return;
    const y = scrollY;
    const top = Math.min(consoleEl.offsetTop, lenis.limit);
    if (y <= 2 || y >= top - 2) {
      restAt = y <= 2 ? 'hero' : 'console';
      restY = y;
      return;
    }
    const drift = y - restY;
    const toConsole = Math.abs(drift) < SNAP_DEADZONE ? restAt === 'console' : drift > 0;
    restAt = toConsole ? 'console' : 'hero';
    restY = toConsole ? top : 0;
    lenis.scrollTo(restY, { duration: 0.9 });
  }, 150);
}
startLenis();

// ---------------------------------------------------------------- loader (index.html)
// Lifts once the page is usable and the mark has drawn. Never traps the page: 8 s cap.
const loader = document.getElementById('loader')!;
const LOADER_MIN_MS = 1350; // the mark has faded in (450 ms) and the sparkle has twinkled once (900 ms)
// Every face the page draws, requested now. A face is otherwise fetched only when text first uses it, and
// the screen's mono 500/700 were first used after the reveal, so its text swapped fonts in front of the visitor.
const FACES = ['400 1em "JetBrains Mono Variable"', '500 1em "JetBrains Mono Variable"', '700 1em "JetBrains Mono Variable"', '500 1em "Bricolage Grotesque Variable"', '400 1em "Hanken Grotesk Variable"', '600 1em "Hanken Grotesk Variable"'];
const fontsLoaded = Promise.all(FACES.map((f) => document.fonts.load(f))).then(() => document.fonts.ready);
function liftLoader(ready: Promise<unknown>, then: () => void) {
  const min = motion.reduced() ? 0 : Math.max(0, LOADER_MIN_MS - performance.now());
  const settled = Promise.race([Promise.all([ready, fontsLoaded]), new Promise((r) => setTimeout(r, 8000))]);
  Promise.all([settled, new Promise((r) => setTimeout(r, min))]).then(() => {
    loader.classList.add('done');
    setTimeout(() => loader.remove(), 500);
    then();
  });
}

// ---------------------------------------------------------------- Share (header; beside Contact on phones)
// The native share sheet on touch devices, otherwise copy the link.
function share(label: Element | null) {
  return async () => {
    const url = location.origin + location.pathname;
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ title: document.title, url });
      } catch {
        /* dismissed */
      }
      return;
    }
    const ok = await copyText(url);
    sfx.play(ok ? 'detent' : 'toggle', ok ? {} : { rate: 0.8 });
    announce(ok ? 'Link copied' : 'Couldn’t copy the link');
    if (!label) return;
    label.textContent = ok ? 'Link copied' : 'Couldn’t copy';
    setTimeout(() => (label.textContent = 'Share'), 1800);
  };
}
const shareBtn = document.getElementById('share')!;
shareBtn.addEventListener('click', share(shareBtn.querySelector('.share-label')));
const inlineShare = document.getElementById('share-inline')!;
inlineShare.addEventListener('click', share(inlineShare));

// ---------------------------------------------------------------- tab bar (mirrors the wallet's tabs)
const tabButtons = [...document.querySelectorAll<HTMLButtonElement>('.tabbar [role="tab"]')];
function showTab(tab: TabId) {
  for (const b of tabButtons) {
    const on = b.dataset.tab === tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  document.querySelectorAll<HTMLElement>('[data-panel]').forEach((el) => el.toggleAttribute('data-active', el.dataset.panel === tab));
}
// Chosen elsewhere until the stage exists (or without WebGL, where the tab bar still works).
let selectTab: (tab: TabId) => void = (tab) => showTab(tab);
tabButtons.forEach((b, i) => {
  b.addEventListener('click', () => selectTab(b.dataset.tab as TabId));
  // Mouse only, like the wallet's own keys: a tiny tick as the pointer arrives (never on touch).
  b.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && b.getAttribute('aria-selected') !== 'true' && sfx.play('hover'));
  // Tabs pattern: arrows move between tabs (and select them), Home/End jump to the ends.
  b.addEventListener('keydown', (e) => {
    const n = tabButtons.length;
    const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    tabButtons[to].focus();
    selectTab(tabButtons[to].dataset.tab as TabId);
  });
});

// ---------------------------------------------------------------- detail panel + routes
const detail = createDetail();
let openedFromLoad = false;
const hashFor = (t: DetailTarget) => (t.kind === 'project' ? `#/work/${t.id}` : t.kind === 'event' ? `#/stage/${t.id}` : '#/about');
const TAB_FOR: Record<DetailTarget['kind'], TabId> = { project: 'works', event: 'chronicle', about: 'about' };
let onDetailOpen: (t: DetailTarget) => void = () => {};
function openDetail(t: DetailTarget, push = true) {
  sfx.play(detail.isOpen() ? 'detent' : 'press');
  lenis?.stop(); // the page behind the panel stays put; the panel scrolls natively (data-lenis-prevent)
  detail.open(t);
  onDetailOpen(t);
  if (push && location.hash !== hashFor(t)) history.pushState(null, '', hashFor(t));
}
const isDetailHash = () => /^#\/(work|stage)\/[\w-]+$|^#\/(about|tools)$/.test(location.hash);
detail.onClose(() => {
  sfx.play('press', { rate: 0.85 });
  lenis?.start();
  if (!isDetailHash()) return; // closed by navigation already
  if (openedFromLoad) history.replaceState(null, '', location.pathname + location.search);
  else history.back();
  openedFromLoad = false;
});
detail.onNavigate((t) => {
  sfx.play('detent');
  detail.open(t);
  onDetailOpen(t);
  history.replaceState(null, '', hashFor(t));
});
detail.onInvite(() => selectTab('contact'));

function route() {
  const h = location.hash;
  let m: RegExpMatchArray | null;
  if ((m = h.match(/^#\/work\/([\w-]+)$/)) && [...projects, ...apps].some((p) => p.id === m![1])) return openDetail({ kind: 'project', id: m[1] }, false);
  if ((m = h.match(/^#\/stage\/([\w-]+)$/)) && events.some((e) => e.id === m![1])) return openDetail({ kind: 'event', id: m[1] }, false);
  if (h === '#/about' || h === '#/tools') return openDetail({ kind: 'about' }, false);
  detail.close();
  const jump: Record<string, TabId> = { '#/work': 'works', '#/stage': 'chronicle', '#/contact': 'contact' };
  // Section links (…/#/contact) are ways in, not places to stay: once the section is showing, the
  // address goes back to the plain site address. Only an open detail panel keeps a hash (it is
  // shareable, and Back closes it). A link to a panel that doesn't exist is tidied away too.
  if (h in jump) selectTab(jump[h]);
  else if (h === '#hello') scrollToEl(0);
  if (h) history.replaceState(null, '', location.pathname + location.search); // valid panel links returned above
}
addEventListener('hashchange', () => route());

// In-page links (the logo, the skip link, List view's section links) scroll without writing their
// target into the address bar: "…/#hello" told a visitor nothing and followed every copied link.
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
  const id = a?.getAttribute('href')!.slice(1);
  if (!a || !id || id.startsWith('/')) return; // "#/…" links are routes: route() handles them
  const target = id === 'hello' ? null : document.getElementById(id);
  if (id !== 'hello' && !target) return;
  e.preventDefault();
  scrollToEl(target ?? 0);
  // The skip link hands keyboard focus on, as the browser does for a followed "#" link.
  if (id === 'console') tabButtons.find((b) => b.getAttribute('aria-selected') === 'true')?.focus({ preventScroll: true });
});

// ---------------------------------------------------------------- preferences
// The eye (§36). On the device it is a short tutorial: callouts on the wallet's three site settings (the volume knob
// and the Motion and Sound sliders), all at once, for about 4.6 s. The List view has no device, so there it opens the
// settings tray (real controls) and keeps it open until pressed again.
const eyeBtn = document.getElementById('eye-toggle') as HTMLButtonElement;
let tipsOn = false; // device view: the callouts are up
let trayOpen = false; // List view: the tray is open
let onTips: (on: boolean) => void = () => {};
const syncEye = () => {
  eyeBtn.setAttribute('aria-pressed', String(view === 'list' ? trayOpen : tipsOn));
  document.documentElement.classList.toggle('settings-open', trayOpen);
};
eyeBtn.addEventListener('click', () => {
  if (view === 'list') {
    trayOpen = !trayOpen;
    sfx.play('toggle', { rate: trayOpen ? 1.15 : 0.9 });
    announce(trayOpen ? 'Settings shown' : 'Settings hidden');
  } else {
    tipsOn = !tipsOn;
    sfx.play('toggle', { rate: tipsOn ? 1.15 : 0.9 });
    onTips(tipsOn);
  }
  syncEye();
});
const motionBtn = document.getElementById('motion-toggle') as HTMLButtonElement;
function updateMotionUi() {
  const reduced = motion.reduced();
  motionBtn.setAttribute('aria-pressed', String(!reduced));
  motionBtn.title = motion.systemReduced() ? 'Motion (reduced by your system setting)' : 'Motion';
  document.documentElement.classList.toggle('motion-off', reduced);
}
motionBtn.addEventListener('click', () => {
  sfx.play('toggle');
  motion.set(!motion.userOn());
});
const soundBtn = document.getElementById('sound-toggle') as HTMLButtonElement;
const updateSoundUi = () => soundBtn.setAttribute('aria-pressed', String(sfx.enabled()));
// Level meter: the bars jump while a sound plays (site.css .is-playing), and rest otherwise.
let meterTimer = 0;
sfx.onPlay(() => {
  soundBtn.classList.add('is-playing');
  clearTimeout(meterTimer);
  meterTimer = window.setTimeout(() => soundBtn.classList.remove('is-playing'), 450);
});
soundBtn.addEventListener('click', () => sfx.set(!sfx.enabled()));
// Volume: the device's knob sets it; this twin (visually hidden, still a real range input) is for the keyboard
// and screen readers, and keeps the knob in step both ways.
const volumeInput = document.getElementById('volume') as HTMLInputElement;
volumeInput.value = String(Math.round(volume.level() * 100));
volume.subscribe((l) => (volumeInput.value = String(Math.round(l * 100))));
volumeInput.addEventListener('input', () => volume.set(Number(volumeInput.value) / 100));
sfx.subscribe(updateSoundUi);
updateSoundUi();
// Music: its own switch (the record spins while it is on). The click sound is the toggle's own, so
// switching music off is still heard (if effects are on).
const musicBtn = document.getElementById('music-toggle') as HTMLButtonElement;
const updateMusicUi = () => musicBtn.setAttribute('aria-pressed', String(music.enabled()));
musicBtn.addEventListener('click', () => {
  sfx.play('toggle');
  music.set(!music.enabled());
});
music.subscribe(updateMusicUi);
updateMusicUi();
motion.subscribe((reduced) => {
  controls?.setMotionSwitch(!reduced);
  if (reduced) {
    lenis?.destroy();
    lenis = null;
  } else startLenis();
  updateMotionUi();
});
updateMotionUi();

// ---------------------------------------------------------------- Device / List view
const viewBtn = document.getElementById('view-toggle') as HTMLButtonElement;
let onViewChange: (v: ViewMode) => void = () => {};
function setView(v: ViewMode, persist = true) {
  view = v;
  const list = v === 'list';
  document.documentElement.classList.toggle('is-list', list);
  viewBtn.setAttribute('aria-checked', String(list));
  listEl.hidden = !list;
  if (list) buildListView(listEl);
  if (persist) storeView(v);
  onViewChange(v);
  scrollToEl(0, undefined, true);
  ScrollTrigger.refresh();
}
viewBtn.addEventListener('click', () => {
  sfx.play('toggle');
  setView(view === 'list' ? 'device' : 'list');
  announce(view === 'list' ? 'List view' : 'Device view');
});

const cta = document.getElementById('contact-cta') as HTMLButtonElement;
const hire = document.getElementById('hire') as HTMLAnchorElement;

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext(); // only a probe: free its context now (iOS keeps few alive, and a pull-to-refresh reload overlaps the old page)
    return !!gl;
  } catch {
    return false;
  }
}

if (!webglAvailable()) {
  // No 3D: the list view is the site.
  document.documentElement.classList.add('no-webgl');
  setView('list', false);
  selectTab = (tab) => document.getElementById(`lv-${tab}`)?.scrollIntoView({ behavior: 'auto' });
  hire.addEventListener('click', (e) => (e.preventDefault(), selectTab('contact')));
  liftLoader(Promise.resolve(), () => {});
} else {
  const stage = createStage(document.getElementById('webgl') as HTMLCanvasElement, document.getElementById('css3d')!, await studioEnv);
  // A reload (pull-to-refresh) leaves the old page's GPU memory alive while the new one starts, which iOS Safari can't always afford.
  // `persisted` pages go to the back-forward cache and come back as they were, so only a real unload frees the context.
  addEventListener('pagehide', (e) => {
    if (e.persisted) return;
    stage.renderer.dispose();
    stage.renderer.forceContextLoss();
  });
  const chor = createChoreography(stage, hero, consoleEl);
  const contactSeq: ContactSequence = createContactSequence(stage, chor, announce);
  const { screen } = stage;
  const memory = createMemorySequence(stage, announce);
  const power = createPower(stage);
  stage.onFrame((dt) => power.update(dt));
  power.onChange((plugged) => announce(plugged ? 'Charger plugged in. The device is charging.' : 'Charger unplugged. The device is on battery.'));
  if (import.meta.env.DEV) Object.assign(window, { __stage: stage, __chor: chor, __power: power }); // console debugging only

  // One way in for every tab source (wallet tabs, tab bar, keys 1–4, softkeys, deep links).
  selectTab = (tab) => {
    if (view === 'list') return document.getElementById(`lv-${tab}`)?.scrollIntoView({ behavior: motion.reduced() ? 'auto' : 'smooth' });
    chor.setTab(tab);
    showTab(tab);
    if (chor.place() !== 'console') scrollToEl(consoleEl);
  };
  chor.onTab((tab) => {
    showTab(tab);
    if (tab !== 'contact' && contactSeq.state() !== 'idle') contactSeq.putAway(contactSeq.state() === 'running');
  });
  // Focus (§37): in the Console the camera comes in on the screen, and the page copy goes quiet (`html.focus`,
  // site.css): what the screen already says is out of sight, what only the copy says stays.
  const syncFocus = () => document.documentElement.classList.toggle('focus', stage.focus.enabled && chor.place() === 'console');
  chor.onPlace((place) => {
    if (place === 'hero' && contactSeq.state() !== 'idle') contactSeq.putAway(true);
    syncFocus();
  });
  syncFocus();
  // Works' three pages (§31, §34, §42): WEB, the projects; APPS, mobile apps; MOTION, motion design (coming
  // soon). Flipped by pressing 01 again (the wallet key, the softkey or key 1), ← →, the names on the screen,
  // the switch beside the wallet, or the memory-card slot (MOTION); the Back key on a coming-soon page goes
  // back to WEB. The switch and its text follow the screen, and the memory card is in the slot exactly while
  // MOTION shows.
  const PAGES: WorksPage[] = ['web', 'apps', 'motion'];
  const PAGE_SAYS: Record<WorksPage, string> = { web: 'Web projects', apps: 'Mobile apps', motion: 'Motion reel: coming soon' };
  const kindBtns = [...document.querySelectorAll<HTMLButtonElement>('.work-kind [data-kind]')];
  function flipWorks(page?: WorksPage) {
    const to = page ?? PAGES[(PAGES.indexOf(screen.worksPage()) + 1) % PAGES.length];
    if (to === screen.worksPage()) return;
    sfx.play('press');
    screen.setWorksPage(to);
  }
  screen.onPage((page) => {
    kindBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === page)));
    document.querySelectorAll<HTMLElement>('[data-kind-text]').forEach((el) => (el.hidden = el.dataset.kindText !== page));
    if (page === 'motion') memory.insert();
    else memory.eject();
    if (chor.tab() === 'works') announce(PAGE_SAYS[page]);
  });
  kindBtns.forEach((b) => b.addEventListener('click', () => flipWorks(b.dataset.kind as WorksPage)));
  /** A tab key or softkey: pressed again on Works, it flips Works' page; otherwise it chooses the section. */
  function pressTab(tab: TabId) {
    if (tab === 'works' && chor.tab() === 'works' && chor.place() === 'console' && view === 'device') return flipWorks();
    selectTab(tab);
  }
  addEventListener('keydown', (e) => {
    if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (view !== 'device' || detail.isOpen() || screen.mode() !== 'works' || chor.place() !== 'console') return;
    if ((e.target as HTMLElement).closest?.('input, textarea, select, dialog, [contenteditable], [role="tab"], a, button')) return;
    e.preventDefault();
    const i = PAGES.indexOf(screen.worksPage()) + (e.key === 'ArrowRight' ? 1 : -1);
    flipWorks(PAGES[Math.min(PAGES.length - 1, Math.max(0, i))]);
  });

  // A deep link or ✓ opens a detail: the Console behind it shows the same section and item.
  onDetailOpen = (t) => {
    const tab = TAB_FOR[t.kind];
    const isApp = t.kind === 'project' && apps.some((a) => a.id === t.id);
    if (t.kind === 'project') flipWorks(isApp ? 'apps' : 'web');
    if (chor.tab() !== tab) selectTab(tab);
    if (chor.place() !== 'console' && view === 'device') scrollToEl(consoleEl, undefined, true);
    const list = t.kind === 'project' ? (isApp ? apps : projects) : t.kind === 'event' ? events : null;
    if (list && 'id' in t) {
      const i = list.findIndex((x) => x.id === t.id);
      if (i >= 0 && screen.mode() === tab) screen.select(i);
    }
  };

  const listLength = () => {
    const m = screen.mode();
    return m === 'works' ? (screen.worksPage() === 'web' ? projects.length : screen.worksPage() === 'apps' ? apps.length : 0) : m === 'chronicle' ? events.length : 0;
  };
  // Copy Dean's email (the screen's Copy key, or C on the keyboard while Email is selected): the address
  // is only joined here, on request, like the mailto link.
  async function copyEmail() {
    const ok = await copyText(emailAddress());
    sfx.play(ok ? 'detent' : 'toggle', ok ? {} : { rate: 0.8 });
    screen.copied(ok);
    announce(ok ? 'Email address copied' : 'Couldn’t copy the email address. Use Open instead.');
  }
  addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'c' || e.metaKey || e.ctrlKey || e.altKey || view !== 'device') return;
    if ((e.target as HTMLElement).closest?.('input, textarea, select, dialog, [contenteditable]')) return;
    const sel = screen.confirm();
    if (screen.mode() === 'contact' && sel.type === 'channel' && sel.channel === 'email') {
      e.preventDefault();
      void copyEmail();
    }
  });
  function handleIntent(i: ScreenIntent) {
    switch (i.type) {
      case 'project': return openDetail({ kind: 'project', id: i.id });
      case 'event': return openDetail({ kind: 'event', id: i.id });
      case 'about': return openDetail({ kind: 'about' });
      case 'contact':
        chor.view.reset(true);
        return contactSeq.run();
      case 'tab': return pressTab(i.tab);
      case 'page': return flipWorks(i.page);
      case 'key':
        if (i.key === 'copy') return void copyEmail();
        return controls?.pressKey(i.key === 'back' ? 'key-back' : 'key-confirm');
      case 'channel':
        sfx.play('press');
        if (i.channel === 'email') location.href = mailtoHref();
        else window.open(i.channel === 'whatsapp' ? whatsappHref() : contact.linkedin.url, '_blank', 'noopener,noreferrer');
        return;
    }
  }
  screen.onIntent(handleIntent);
  screen.onSelect(() => sfx.play('detent')); // the wheel, arrow keys or a row tap: one detent per step

  // Easter egg (§24): a back sticker latched open shows its site as a link pill; it heals when the wallet
  // is turned back to the front by any route (tab, Back key, scroll).
  const qrPill = document.getElementById('qr-pill')!;
  const qrLink = qrPill.querySelector<HTMLAnchorElement>('.qr-link')!;
  let qrHide = 0;
  function showQr(s: Sticker | null) {
    qrOpen = s;
    clearTimeout(qrHide);
    if (s) {
      qrLink.href = s.url;
      qrLink.querySelector('.qr-host')!.textContent = s.host;
      qrPill.hidden = false;
      void qrPill.offsetWidth; // so the first state is painted and the entrance can transition
      qrPill.classList.add('in');
      announce(`${s.name} sticker peeled back. Its QR code leads to ${s.host}; the link is at the bottom of the page.`);
    } else {
      qrPill.classList.remove('in');
      qrHide = window.setTimeout(() => (qrPill.hidden = true), 220);
    }
  }
  qrLink.addEventListener('click', () => controls?.healSticker());
  qrPill.querySelector('.qr-close')!.addEventListener('click', () => controls?.healSticker());
  stage.onFrame(() => {
    if (qrOpen && !chor.view.isBack()) controls?.healSticker();
  });

  controls = createControls(stage, document.getElementById('webgl') as HTMLCanvasElement, {
    sticker: showQr,
    knobTap: () => usePill() && !!volumePill && (volumePill.open(), true),
    selectTab: (n) => pressTab(TABS[n - 1]),
    roll: (d) => screen.move(d),
    canRoll: (d) => {
      const n = listLength();
      const i = screen.selectedIndex();
      return n > 0 && i + d >= 0 && i + d < n;
    },
    confirm: () => handleIntent(screen.confirm()),
    back: () => {
      if (qrOpen) controls?.healSticker();
      else if (detail.isOpen()) detail.close();
      else if (chor.view.isOff()) chor.view.reset();
      else if (contactSeq.state() === 'ready') contactSeq.putAway();
      else if (screen.mode() === 'works' && screen.worksPage() !== 'web') flipWorks('web');
    },
    // The side switch: the knob visibly slides first, then the page changes view.
    toggleView: () => {
      sfx.play('toggle');
      controls?.setViewSwitch(true);
      setTimeout(() => setView('list'), motion.reduced() ? 0 : 220);
    },
    toggleMotion: () => motion.set(!motion.userOn()),
    // The Sound slider: effects and music together (the tray still has them apart).
    toggleSound: () => {
      const on = !(sfx.enabled() || music.enabled());
      music.set(on);
      sfx.set(on);
    },
    // The memory-card slot: on the Motion page it sends the card away (back to WEB); anywhere else the card
    // flies in from below, and once it is home the page opens.
    toggleMemory: () => {
      if (screen.mode() === 'works' && screen.worksPage() === 'motion') return flipWorks('web');
      selectTab('works');
      memory.insert(() => (chor.tab() === 'works' ? flipWorks('motion') : memory.eject())); // chor.tab() is set at once; screen.mode() trails it
    },
    togglePlug: () => power.toggle(),
    // The pinhole: reboot. The screen shows its boot mark, then the place it was; the card goes out, the cable
    // goes back in, WEB comes back.
    reset: () => {
      sfx.play('power');
      chor.view.reset();
      memory.eject();
      power.plug();
      flipWorks('web');
      const back = () => screen.setMode(chor.place() === 'console' ? chor.tab() : 'hello');
      screen.setMode('boot');
      setTimeout(back, motion.reduced() ? 0 : 1200);
      announce('Device restarted');
    },
    view: chor.view,
  });
  controls.setMotionSwitch(!motion.reduced());
  volumePill = createVolumePill(stage, document.getElementById('vol-pill') as HTMLElement, controls);
  const syncSound =() => controls?.setSoundSwitch(sfx.enabled() || music.enabled());
  sfx.subscribe(syncSound);
  music.subscribe(syncSound);
  syncSound();

  // The eye on the device: callouts on the three settings (tips.ts), each part makes a small move to show what it
  // does, and the wallet turns to show its left face if that is not toward the visitor already. When the callouts
  // go, it turns back, unless the visitor took hold of it in the meantime.
  const tips = createTips(stage, document.getElementById('tips') as HTMLElement);
  const volumeTip = document.querySelector('.tip[data-tip="volume"] span') as HTMLElement;
  // Its callout is the big target the sliver of a knob is not: a tap on it opens the pill too (the callouts go with the tap).
  volumeTip.parentElement!.addEventListener('click', () => usePill() && volumePill?.open());
  let turnedByEye = false;
  let grabsAtTurn = 0;
  onTips = (on) => {
    if (!on) return tips.hide();
    volumeTip.textContent = usePill() ? 'Tap for a volume slider.' : 'Drag, scroll or tap to mute.';
    announce(`Device settings. The knob sets the volume: ${usePill() ? 'tap it for a volume slider' : 'drag it, scroll over it or tap it to mute'}. The top slider turns motion on or off. The bottom slider turns sound on or off.`);
    turnedByEye = !tips.facing();
    if (turnedByEye) {
      grabsAtTurn = chor.view.grabs();
      chor.view.show(0.75, 0.06);
    }
    stage.focus.hold(true); // the whole wallet in view, for the left face
    tips.show();
    controls?.nudge();
  };
  tips.onHide(() => {
    stage.focus.hold(false);
    tipsOn = false;
    syncEye();
    if (turnedByEye && chor.view.grabs() === grabsAtTurn) chor.view.reset();
    turnedByEye = false;
  });
  addEventListener('keydown', (e) => e.key === 'Escape' && tips.isOn() && tips.hide());

  // The Reset view chip (§35) shows while the wallet is turned, panned or zoomed away from its pose.
  const resetChip = document.getElementById('view-reset') as HTMLButtonElement;
  let viewOff = false;
  const syncChips = () => {
    resetChip.hidden = !viewOff || view !== 'device';
  };
  chor.view.onChange((off) => {
    viewOff = off;
    syncChips();
  });
  resetChip.addEventListener('click', () => {
    sfx.play('press', { rate: 0.9 });
    chor.view.reset();
  });
  syncChips();
  // A walkthrough clip playing in a panel: the 3D scene behind it rests (one heavy thing at a time on a phone).
  // It waits for the scene's first frame and its entrance: a clip that starts on a deep link must not freeze an empty canvas.
  let clipPlaying = false;
  let sceneUp = false;
  const restScene = () => stage.setActive(!(clipPlaying && sceneUp) && view === 'device');
  void stage.ready.then(() => setTimeout(() => ((sceneUp = true), restScene()), 2200));
  detail.onMotion((playing) => ((clipPlaying = playing), restScene()));
  onViewChange = (v) => {
    stage.setActive(v === 'device');
    controls?.setViewSwitch(v === 'list');
    if (v === 'list') {
      contactSeq.putAway(true);
      tips.hide();
    }
    syncChips();
    syncEye();
  };

  // Contact: the panel's CTA runs or ends the card reader; the primary action goes there from anywhere.
  cta.addEventListener('click', () => {
    if (contactSeq.state() === 'ready') return contactSeq.putAway();
    chor.view.reset(true); // the reader is on the front-facing wallet's side
    contactSeq.run();
  });
  const goContact = (e: Event) => {
    e.preventDefault();
    detail.close();
    if (view === 'list') return selectTab('contact');
    chor.setTab('contact');
    showTab('contact');
    chor.view.reset(true);
    scrollToEl(consoleEl, () => contactSeq.state() === 'idle' && contactSeq.run());
  };
  hire.addEventListener('click', goContact);
  contactSeq.onState((s) => {
    cta.disabled = s === 'running';
    cta.textContent = s === 'ready' ? 'Put the key away' : 'Contact me';
  });

  // Arrival: the wallet waits below its pose, turned away, while the loader draws the mark. As the
  // loader lifts it rises and turns in (expo out: most of the travel inside the loader's fade), then
  // the e-ink panel refreshes from its boot mark to the place's screen.
  if (!motion.reduced()) Object.assign(stage.intro, { y: -0.45, ry: 0.6, s: -0.1 });
  const startView = storedView();
  if (startView === 'list') setView('list', false);
  liftLoader(startView === 'list' ? Promise.resolve() : stage.ready, () => {
    gsap.to(stage.intro, { y: 0, ry: 0, s: 0, duration: 1.4, ease: 'expo.out' });
    setTimeout(() => screen.setMode(chor.place() === 'console' ? chor.tab() : 'hello'), motion.reduced() ? 0 : 300);
  });
}

openedFromLoad = isDetailHash();
route();
