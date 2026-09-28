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
import type { ScreenIntent } from './ui/screen';
import { buildListView, storeView, storedView, type ViewMode } from './ui/listView';
import { events, profile, projects } from './content/portfolio';
import { contact, mailtoHref, whatsappHref } from './content/contact';
import { copyText } from './ui/clipboard';
import { motion } from './motion';
import { sfx } from './audio/sfx';

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
document.querySelector('[data-bio]')!.textContent = profile.bio.join(' '); // both lines: the Hero already says the roles
document.querySelector('[data-list="works"]')!.innerHTML = projects.map((p) => `<li><a href="#/work/${p.id}">${p.title}</a></li>`).join('');
document.querySelector('[data-list="chronicle"]')!.innerHTML = events.map((e) => `<li><a href="#/stage/${e.id}">${e.place}: ${e.title}</a></li>`).join('');

// ---------------------------------------------------------------- smooth scroll + Hero ↔ Console snap
let controls: Controls | null = null;
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
  if (lenis) lenis.scrollTo(el, { duration: 1.1, force: true, immediate, onComplete: () => done?.() });
  else {
    const y = typeof el === 'number' ? el : el.getBoundingClientRect().top + scrollY;
    scrollTo({ top: y, behavior: immediate || motion.reduced() ? 'auto' : 'smooth' });
    if (done) setTimeout(done, immediate || motion.reduced() ? 0 : 900);
  }
}
// Between the Hero and the Console there is no resting place: when the scroll settles in between,
// finish the move in the direction it was going. The Console is the end of the page.
let snapTimer = 0;
let lastRest = 0;
function queueSnap() {
  clearTimeout(snapTimer);
  snapTimer = window.setTimeout(() => {
    if (!lenis || view === 'list' || detail.isOpen() || lenis.isScrolling) return;
    const y = scrollY;
    const top = consoleEl.offsetTop;
    if (y <= 2 || Math.abs(y - top) <= 2 || y > top) {
      lastRest = y;
      return;
    }
    const target = y > lastRest ? top : 0;
    lastRest = target;
    lenis.scrollTo(target, { duration: 0.9 });
  }, 150);
}
startLenis();

// ---------------------------------------------------------------- loader (index.html)
// Lifts once the page is usable and the mark has drawn. Never traps the page: 8 s cap.
const loader = document.getElementById('loader')!;
const LOADER_MIN_MS = 1350; // the D has risen and the sparkle has appeared
function liftLoader(ready: Promise<unknown>, then: () => void) {
  const min = motion.reduced() ? 0 : Math.max(0, LOADER_MIN_MS - performance.now());
  const settled = Promise.race([Promise.all([ready, document.fonts.ready]), new Promise((r) => setTimeout(r, 8000))]);
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
    sfx.play(ok ? 'write' : 'bump');
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
  sfx.play(detail.isOpen() ? 'tick' : 'open');
  lenis?.stop(); // the page behind the panel stays put; the panel scrolls natively (data-lenis-prevent)
  detail.open(t);
  onDetailOpen(t);
  if (push && location.hash !== hashFor(t)) history.pushState(null, '', hashFor(t));
}
const isDetailHash = () => /^#\/(work|stage)\/[\w-]+$|^#\/(about|tools)$/.test(location.hash);
detail.onClose(() => {
  sfx.play('close');
  lenis?.start();
  if (!isDetailHash()) return; // closed by navigation already
  if (openedFromLoad) history.replaceState(null, '', location.pathname + location.search);
  else history.back();
  openedFromLoad = false;
});
detail.onNavigate((t) => {
  sfx.play('tick');
  detail.open(t);
  onDetailOpen(t);
  history.replaceState(null, '', hashFor(t));
});
detail.onInvite(() => selectTab('contact'));

function route(initial = false) {
  const h = location.hash;
  let m: RegExpMatchArray | null;
  if ((m = h.match(/^#\/work\/([\w-]+)$/)) && projects.some((p) => p.id === m![1])) return openDetail({ kind: 'project', id: m[1] }, false);
  if ((m = h.match(/^#\/stage\/([\w-]+)$/)) && events.some((e) => e.id === m![1])) return openDetail({ kind: 'event', id: m[1] }, false);
  if (h === '#/about' || h === '#/tools') return openDetail({ kind: 'about' }, false);
  detail.close();
  const jump: Record<string, TabId> = { '#/work': 'works', '#/stage': 'chronicle', '#/contact': 'contact' };
  if (h in jump) selectTab(jump[h]);
  else if (h === '#hello') scrollToEl(0);
  else if (initial && h && h !== '#/') history.replaceState(null, '', location.pathname + location.search);
}
addEventListener('hashchange', () => route());

// ---------------------------------------------------------------- preferences
const motionBtn = document.getElementById('motion-toggle') as HTMLButtonElement;
function updateMotionUi() {
  const reduced = motion.reduced();
  motionBtn.setAttribute('aria-pressed', String(!reduced));
  motionBtn.title = motion.systemReduced() ? 'Motion (reduced by your system setting)' : 'Motion';
  document.documentElement.classList.toggle('motion-off', reduced);
}
motionBtn.addEventListener('click', () => {
  sfx.play('switch');
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
  sfx.play('switch');
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
  const stage = createStage(document.getElementById('webgl') as HTMLCanvasElement, document.getElementById('css3d')!);
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
  // A deep link or ✓ opens a detail: the Console behind it shows the same section and item.
  onDetailOpen = (t) => {
    const tab = TAB_FOR[t.kind];
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
    return m === 'works' ? projects.length : m === 'chronicle' ? events.length : 0;
  };
  function handleIntent(i: ScreenIntent) {
    switch (i.type) {
      case 'project': return openDetail({ kind: 'project', id: i.id });
      case 'event': return openDetail({ kind: 'event', id: i.id });
      case 'about': return openDetail({ kind: 'about' });
      case 'contact': return contactSeq.run();
      case 'tab': return selectTab(i.tab);
      case 'channel':
        sfx.play('open');
        if (i.channel === 'email') location.href = mailtoHref();
        else window.open(i.channel === 'whatsapp' ? whatsappHref() : contact.linkedin.url, '_blank', 'noopener,noreferrer');
        return;
    }
  }
  screen.onIntent(handleIntent);
  screen.onSelect(() => sfx.play('tick')); // roller, arrow keys or a row tap: one detent per step

  // The coin swinging into the wallet: a clink as loud as the hit. Resting contact under gravity
  // registers ≈0.2 W/s, so only real swings pass the floor.
  const CLINK_MIN = 0.45;
  stage.onFrame(() => {
    const v = stage.keychain.takeImpact();
    if (v > CLINK_MIN) sfx.play('clink', { volume: Math.min(1, 0.25 + (v - CLINK_MIN) / 2) });
  });

  controls = createControls(stage, document.getElementById('webgl') as HTMLCanvasElement, {
    selectTab: (n) => selectTab(TABS[n - 1]),
    roll: (d) => screen.move(d),
    canRoll: (d) => {
      const n = listLength();
      const i = screen.selectedIndex();
      return n > 0 && i + d >= 0 && i + d < n;
    },
    confirm: () => handleIntent(screen.confirm()),
    back: () => {
      if (detail.isOpen()) detail.close();
      else if (contactSeq.state() === 'ready') contactSeq.putAway();
    },
    // The side switch: the knob visibly slides first, then the page changes view.
    toggleView: () => {
      sfx.play('switch');
      controls?.setViewSwitch(true);
      setTimeout(() => setView('list'), motion.reduced() ? 0 : 220);
    },
    toTop: () => scrollToEl(0),
  });
  onViewChange = (v) => {
    stage.setActive(v === 'device');
    controls?.setViewSwitch(v === 'list');
    if (v === 'list') contactSeq.putAway(true);
  };

  // Contact: the panel's CTA runs or ends the card reader; the primary action goes there from anywhere.
  cta.addEventListener('click', () => (contactSeq.state() === 'ready' ? contactSeq.putAway() : contactSeq.run()));
  const goContact = (e: Event) => {
    e.preventDefault();
    detail.close();
    if (view === 'list') return selectTab('contact');
    chor.setTab('contact');
    showTab('contact');
    scrollToEl(consoleEl, () => contactSeq.state() === 'idle' && contactSeq.run());
  };
  hire.addEventListener('click', goContact);
  contactSeq.onState((s) => {
    consoleEl.dataset.card = s; // phones fade the title while the card is out (site.css)
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
route(true);
