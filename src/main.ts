// DeanFi3 entry: one page, one wallet (docs/device-design.md §10). Two places, no footer: the Hero
// and the Console. Scroll only moves between them; in the Console the wallet's top tabs, the on-page tab bar,
// keys 1–4 and deep links choose the section. The e-ink screen, roller, ✓ and Back drive the content;
// details open in a panel with shareable hash routes (#/work/:id, #/stage/:id, #/about; legacy
// #/tools → About). A List view shows everything as a plain page, without 3D.
import '@fontsource/instrument-serif/400.css';
import '@fontsource-variable/inter';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/700.css';
import './styles/site.css';
import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { createStage } from './scene/stage';
import { createChoreography, TABS, type TabId } from './scene/choreography';
import { createControls, type Controls } from './scene/controls';
import { createContactSequence, type ContactSequence } from './scene/contactSequence';
import { createDetail, type DetailTarget } from './ui/detail';
import type { ScreenIntent, WorksPage } from './ui/screen';
import { buildListView, storeView, storedView, type ViewMode } from './ui/listView';
import { events, profile, projects } from './content/portfolio';
import { contact, emailAddress, mailtoHref, whatsappHref } from './content/contact';
import { copyText } from './ui/clipboard';
import { motion } from './motion';
import { sfx } from './audio/sfx';
import { music } from './audio/music';
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
document.querySelector('[data-list="works"]')!.innerHTML = projects.map((p) => `<li><a href="#/work/${p.id}">${p.title}</a></li>`).join('');
document.querySelector('[data-list="chronicle"]')!.innerHTML = events.map((e) => `<li><a href="#/stage/${e.id}">${e.place}: ${e.title}</a></li>`).join('');

// ---------------------------------------------------------------- smooth scroll + Hero ↔ Console snap
let controls: Controls | null = null;
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
const FACES = ['400 1em "IBM Plex Mono"', '500 1em "IBM Plex Mono"', '700 1em "IBM Plex Mono"', '400 1em "Instrument Serif"', '400 1em "Inter Variable"'];
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
  if ((m = h.match(/^#\/work\/([\w-]+)$/)) && projects.some((p) => p.id === m![1])) return openDetail({ kind: 'project', id: m[1] }, false);
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
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
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
  const chor = createChoreography(stage, hero, consoleEl);
  const contactSeq: ContactSequence = createContactSequence(stage, chor, announce);
  const { screen } = stage;
  if (import.meta.env.DEV) Object.assign(window, { __stage: stage, __chor: chor }); // console debugging only

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
  chor.onPlace((place) => {
    if (place === 'hero' && contactSeq.state() !== 'idle') contactSeq.putAway(true);
  });
  // Works' two pages (§31): WEB, the projects, and APPS, mobile apps (coming soon). Flipped by pressing
  // 01 again (the wallet key, the softkey or key 1), ← →, WEB/APPS on the screen or the switch beside the
  // wallet; the Back key on APPS goes back to WEB. The switch and its text follow the screen.
  const kindBtns = [...document.querySelectorAll<HTMLButtonElement>('.work-kind [data-kind]')];
  function flipWorks(page?: WorksPage) {
    const to = page ?? (screen.worksPage() === 'web' ? 'apps' : 'web');
    if (to === screen.worksPage()) return;
    sfx.play('press');
    screen.setWorksPage(to);
  }
  screen.onPage((page) => {
    kindBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === page)));
    document.querySelectorAll<HTMLElement>('[data-kind-text]').forEach((el) => (el.hidden = el.dataset.kindText !== page));
    if (chor.tab() === 'works') announce(page === 'apps' ? 'Mobile apps: coming soon' : 'Web projects');
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
    flipWorks(e.key === 'ArrowRight' ? 'apps' : 'web');
  });

  // A deep link or ✓ opens a detail: the Console behind it shows the same section and item.
  onDetailOpen = (t) => {
    const tab = TAB_FOR[t.kind];
    if (t.kind === 'project') flipWorks('web');
    if (chor.tab() !== tab) selectTab(tab);
    if (chor.place() !== 'console' && view === 'device') scrollToEl(consoleEl, undefined, true);
    const list = t.kind === 'project' ? projects : t.kind === 'event' ? events : null;
    if (list && 'id' in t) {
      const i = list.findIndex((x) => x.id === t.id);
      if (i >= 0 && screen.mode() === tab) screen.select(i);
    }
  };

  const listLength = () => {
    const m = screen.mode();
    return m === 'works' ? (screen.worksPage() === 'web' ? projects.length : 0) : m === 'chronicle' ? events.length : 0;
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
        chor.flip.reset(true);
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
  screen.onSelect(() => sfx.play('detent')); // roller, arrow keys or a row tap: one detent per step

  // The coin swinging into the wallet: a coin tick as loud as the hit (quieter than a tap on it). Only a hit from a free swing counts
  // (keychain.ts), only real swings pass the floor, and clinks are at least 300 ms apart (sfx.ts).
  const CLINK_MIN = 0.45;
  stage.onFrame(() => {
    const v = stage.keychain.takeImpact();
    if (v > CLINK_MIN) sfx.play('coin', { volume: Math.min(0.7, 0.2 + (v - CLINK_MIN) / 3) });
  });

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
    if (qrOpen && !chor.flip.isBack()) controls?.healSticker();
  });

  controls = createControls(stage, document.getElementById('webgl') as HTMLCanvasElement, {
    sticker: showQr,
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
      else if (chor.flip.isBack()) chor.flip.reset();
      else if (contactSeq.state() === 'ready') contactSeq.putAway();
      else if (screen.mode() === 'works' && screen.worksPage() === 'apps') flipWorks('web');
    },
    // The side switch: the knob visibly slides first, then the page changes view.
    toggleView: () => {
      sfx.play('toggle');
      controls?.setViewSwitch(true);
      setTimeout(() => setView('list'), motion.reduced() ? 0 : 220);
    },
    toTop: () => scrollToEl(0),
    flip: chor.flip,
  });
  onViewChange = (v) => {
    stage.setActive(v === 'device');
    controls?.setViewSwitch(v === 'list');
    if (v === 'list') contactSeq.putAway(true);
  };

  // Contact: the panel's CTA runs or ends the card reader; the primary action goes there from anywhere.
  cta.addEventListener('click', () => {
    if (contactSeq.state() === 'ready') return contactSeq.putAway();
    chor.flip.reset(true); // the reader is on the front-facing wallet's side
    contactSeq.run();
  });
  const goContact = (e: Event) => {
    e.preventDefault();
    detail.close();
    if (view === 'list') return selectTab('contact');
    chor.setTab('contact');
    showTab('contact');
    chor.flip.reset(true);
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
