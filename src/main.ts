// DeanFi3 entry: one page, one wallet. Scroll drives the wallet's pose; its controls, the e-ink screen
// and the keyboard drive navigation; details open in a panel with shareable hash routes
// (#/work/:id, #/stage/:id, #/about; legacy #/tools → About).
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
import { createChoreography, SECTIONS } from './scene/choreography';
import { createControls, type Controls } from './scene/controls';
import { createContactSequence } from './scene/contactSequence';
import { createDetail, type DetailTarget } from './ui/detail';
import type { ScreenIntent } from './ui/screen';
import { events, profile, projects } from './content/portfolio';
import { contact, mailtoHref, whatsappHref } from './content/contact';
import { copyText } from './ui/clipboard';
import { motion } from './motion';
import { sfx } from './audio/sfx';

gsap.registerPlugin(ScrollTrigger);

const sections = SECTIONS.map((id) => document.getElementById(id)!);
const live = document.getElementById('live')!;
const announce = (msg: string) => {
  live.textContent = '';
  requestAnimationFrame(() => (live.textContent = msg));
};

// ---------------------------------------------------------------- page content (DOM twins of the screen)
document.querySelector('[data-bio]')!.textContent = profile.bio[0];
document.querySelector('[data-list="works"]')!.innerHTML = projects.map((p) => `<li><a href="#/work/${p.id}">${p.title}</a></li>`).join('');
document.querySelector('[data-list="chronicle"]')!.innerHTML = events.map((e) => `<li><a href="#/stage/${e.id}">${e.place}: ${e.title}</a></li>`).join('');

// ---------------------------------------------------------------- smooth scroll
let controls: Controls | null = null;
let lenis: Lenis | null = null;
function startLenis() {
  if (lenis || motion.reduced()) return;
  lenis = new Lenis({ autoRaf: false, virtualScroll: () => !controls?.wheelConsumed() });
  lenis.on('scroll', ScrollTrigger.update);
}
gsap.ticker.add((t) => lenis?.raf(t * 1000));
gsap.ticker.lagSmoothing(0);
startLenis();
// `force`: a panel may be closing in the same click (Invite, Work with Dean) with Lenis still stopped.
function scrollToEl(el: HTMLElement, done?: () => void) {
  if (lenis) lenis.scrollTo(el, { duration: 1.1, force: true, onComplete: () => done?.() });
  else {
    el.scrollIntoView({ behavior: motion.reduced() ? 'auto' : 'smooth' });
    if (done) setTimeout(done, motion.reduced() ? 0 : 900);
  }
}

// ---------------------------------------------------------------- loader (index.html)
// Lifts once the page is usable and the D has finished tracing and filling. Never traps the page:
// after 8 s it lifts whatever is still loading.
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

// ---------------------------------------------------------------- header actions
// Share (secondary): the native share sheet on touch devices, otherwise copy the link.
const shareBtn = document.getElementById('share') as HTMLButtonElement;
const shareLabel = shareBtn.querySelector('.share-label')!;
let shareTimer = 0;
shareBtn.addEventListener('click', async () => {
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
  shareLabel.textContent = ok ? 'Link copied' : 'Couldn’t copy';
  announce(ok ? 'Link copied' : 'Couldn’t copy the link');
  clearTimeout(shareTimer);
  shareTimer = window.setTimeout(() => (shareLabel.textContent = 'Share'), 1800);
});
const hire = document.getElementById('hire') as HTMLAnchorElement;

// ---------------------------------------------------------------- detail panel + routes
const detail = createDetail();
let openedFromLoad = false;
const hashFor = (t: DetailTarget) => (t.kind === 'project' ? `#/work/${t.id}` : t.kind === 'event' ? `#/stage/${t.id}` : '#/about');
function openDetail(t: DetailTarget, push = true) {
  sfx.play(detail.isOpen() ? 'tick' : 'open');
  lenis?.stop(); // the page behind the panel stays put; the panel scrolls natively (data-lenis-prevent)
  detail.open(t);
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
  history.replaceState(null, '', hashFor(t));
});
detail.onInvite(() => scrollToEl(sections[4]));

function route(initial = false) {
  const h = location.hash;
  let m: RegExpMatchArray | null;
  if ((m = h.match(/^#\/work\/([\w-]+)$/)) && projects.some((p) => p.id === m![1])) return openDetail({ kind: 'project', id: m[1] }, false);
  if ((m = h.match(/^#\/stage\/([\w-]+)$/)) && events.some((e) => e.id === m![1])) return openDetail({ kind: 'event', id: m[1] }, false);
  if (h === '#/about' || h === '#/tools') return openDetail({ kind: 'about' }, false);
  detail.close();
  const jump: Record<string, number> = { '#/work': 1, '#/stage': 2, '#/contact': 4, '#hello': 0 };
  if (h in jump) scrollToEl(sections[jump[h]]);
  else if (initial && h && h !== '#/') history.replaceState(null, '', location.pathname + location.search);
}
addEventListener('hashchange', () => route());

// ---------------------------------------------------------------- 3D stage
function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const motionBtn = document.getElementById('motion-toggle') as HTMLButtonElement;
function updateMotionUi() {
  const on = !motion.reduced();
  motionBtn.setAttribute('aria-pressed', String(on));
  motionBtn.querySelector('[data-motion-label]')!.textContent = on ? 'on' : 'off';
  motionBtn.title = motion.systemReduced() ? 'Reduced by your system setting' : '';
  controls?.setMotionSwitch(on);
}
// Header pill and the wallet's side switch do the same thing, with the switch's snap.
const toggleMotion = () => {
  sfx.play('switch');
  motion.set(!motion.userOn());
};
motionBtn.addEventListener('click', toggleMotion);

const soundBtn = document.getElementById('sound-toggle') as HTMLButtonElement;
function updateSoundUi() {
  const on = sfx.enabled();
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.querySelector('[data-sound-label]')!.textContent = on ? 'on' : 'off';
}
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

const cta = document.getElementById('contact-cta') as HTMLButtonElement;

if (!webglAvailable()) {
  document.documentElement.classList.add('no-webgl');
  cta.addEventListener('click', () => (location.href = mailtoHref()));
  liftLoader(Promise.resolve(), () => {});
} else {
  const stage = createStage(document.getElementById('webgl') as HTMLCanvasElement, document.getElementById('css3d')!);
  const chor = createChoreography(stage, sections);
  const contactSeq = createContactSequence(stage, chor, announce);
  const { screen } = stage;

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
  if (import.meta.env.DEV) Object.assign(window, { __stage: stage }); // console debugging only

  controls = createControls(stage, document.getElementById('webgl') as HTMLCanvasElement, {
    gotoSection: (n) => scrollToEl(sections[n]),
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
    toggleMotion,
    toTop: () => scrollToEl(sections[0]),
  });

  // Contact CTA ↔ sequence state. Leaving Contact puts the key away.
  cta.addEventListener('click', () => (contactSeq.state() === 'ready' ? contactSeq.putAway() : contactSeq.run()));
  // Primary header action: go to Contact and tap the key in (the payoff), from anywhere.
  hire.addEventListener('click', (e) => {
    e.preventDefault();
    detail.close();
    scrollToEl(sections[4], () => contactSeq.state() === 'idle' && contactSeq.run());
  });
  contactSeq.onState((s) => {
    sections[4].dataset.card = s; // phones fade the heading while the card is out (site.css)
    cta.disabled = s === 'running';
    cta.textContent = s === 'ready' ? 'Put the key away' : 'Contact me';
  });
  chor.onActive((id) => {
    if (id !== 'contact' && contactSeq.state() !== 'idle') contactSeq.putAway(contactSeq.state() === 'running');
  });

  // Arrival: the wallet waits below its pose, turned away, while the loader draws the D. As the
  // loader lifts it rises and turns in (expo out: most of the travel in the first 400 ms, under the
  // loader's fade), then the e-ink panel refreshes from its boot mark to the section's screen.
  if (!motion.reduced()) Object.assign(stage.intro, { y: -0.45, ry: 0.6, s: -0.1 });
  liftLoader(stage.ready, () => {
    gsap.to(stage.intro, { y: 0, ry: 0, s: 0, duration: 1.4, ease: 'expo.out' });
    setTimeout(() => screen.setMode(chor.active()), motion.reduced() ? 0 : 300);
  });
}

updateMotionUi();
openedFromLoad = isDetailHash();
route(true);
